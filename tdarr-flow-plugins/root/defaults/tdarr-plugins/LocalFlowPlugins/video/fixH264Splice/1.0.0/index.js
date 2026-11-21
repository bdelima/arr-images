/* eslint-disable no-await-in-loop */
/**
 * Fix H.264 SEI/SPS Splice
 *
 * Repairs what Detect H.264 SEI/SPS Splice found (Flow Variable user.h264Splice, output 1 of that plugin) in the working
 * file, normally the video-only Matroska file Split Streams (ffmpeg) wrote. Nothing is removed: every SEI NAL unit is
 * kept, every frame keeps its timestamp, and the video is not re-encoded.
 *
 *   1. ffprobe lists every video packet (timestamp, size, key flag and the byte position of its block in the file).
 *   2. In every packet whose SEI NAL units come before its SPS/PPS (the logo's first access unit), the SEI NAL units are
 *      moved to just after the last SPS/PPS. The packet keeps its exact size, so this is a permutation of bytes inside
 *      the block, written in place into the working file (the job's own copy, never the library file); the original
 *      bytes are kept in memory and put back if anything fails. Read against its own SPS, the logo's SEI parses again
 *      (the "SEI type 0 overread by 8 bits" goes away).
 *   3. ffmpeg copies the file with -bsf:v h264_metadata, writing the colour description that Detect found (the one the
 *      file's own later SPS declare) into every SPS, so the colour no longer changes part-way through. h264_metadata can
 *      only do this once every SEI parses, which is why step 2 comes first. Track properties, chapters and the frame
 *      timestamps are carried over by ffmpeg's stream copy.
 *   4. The result is checked before it is used: the same frame timestamps packet by packet, the same key frames, the same
 *      language/title/flags, no "overread" warning, and every SPS declares the colour Detect found. A result that fails
 *      a check is deleted and the job fails with the reason.
 *
 * The new file is written next to the working file as <name>-h264fix.mkv and becomes the working file and the Flow
 * Variable user.videoOnlySource (the encode input and the VMAF reference); the file it was made from is deleted when it
 * is not the original library file. Matroska only.
 *
 * Output 1: fixed (the new file is the working file).
 * Output 2: nothing to fix (Detect did not find a repairable splice, or did not run).
 */

const details = () => ({
  name: 'Fix H.264 SEI/SPS Splice',
  description: 'Repairs the working file when Detect H.264 SEI/SPS Splice found a spliced-in segment whose SPS declare colour tags the rest of the file lacks: puts each SEI after its SPS (nothing removed) and gives every SPS the colour the file\'s own later SPS declares. The new file becomes the working file and videoOnlySource.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'ffmpeg Path',
      name: 'ffmpegPath',
      type: 'string',
      defaultValue: '',
      inputUI: { type: 'text' },
      tooltip: 'Leave empty to use the ffmpeg Tdarr gives the plugin, then ffmpeg from the PATH.',
    },
    {
      label: 'mkvmerge Path',
      name: 'mkvmergePath',
      type: 'string',
      defaultValue: 'mkvmerge',
      inputUI: { type: 'text' },
      tooltip: 'mkvmerge as installed in the Tdarr container (it reads the video track\'s properties, which the result is checked against).',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Fixed: the new file is the working file' },
    { number: 2, tooltip: 'Nothing to fix' },
  ],
});

const FIELDS = [
  'profile_idc', 'level_idc', 'seq_parameter_set_id', 'chroma_format_idc', 'bit_depth_luma_minus8',
  'pic_width_in_mbs_minus1', 'pic_height_in_map_units_minus1', 'frame_mbs_only_flag', 'frame_cropping_flag',
  'frame_crop_left_offset', 'frame_crop_right_offset', 'frame_crop_top_offset', 'frame_crop_bottom_offset',
  'vui_parameters_present_flag', 'video_signal_type_present_flag', 'video_format', 'video_full_range_flag',
  'colour_description_present_flag', 'colour_primaries', 'transfer_characteristics', 'matrix_coefficients',
  'nal_hrd_parameters_present_flag', 'vcl_hrd_parameters_present_flag', 'pic_struct_present_flag',
];

// The colour an SPS declares (null when it declares none), from the trace_headers fields.
const colourOf = (f) => {
  const n = (k, d) => (f[k] === undefined ? d : Number(f[k]));
  if (n('video_signal_type_present_flag', 0) !== 1 || n('colour_description_present_flag', 0) !== 1) return null;
  return {
    primaries: n('colour_primaries', 2), transfer: n('transfer_characteristics', 2), matrix: n('matrix_coefficients', 2), range: n('video_full_range_flag', 0),
  };
};

// Reads the "Sequence Parameter Set" blocks of ffmpeg's trace_headers output, one stderr line at a time.
const spsReader = () => {
  const found = [];
  let current = null;
  let overreads = 0;
  const finish = () => { if (current) found.push(colourOf(current)); current = null; };
  const feed = (raw) => {
    const line = raw.replace(/^\[[^\]]*\]\s*/, '').replace(/\s+$/, '');
    if (/SEI type \d+ overread by \d+ bits/.test(raw)) overreads += 1;
    if (line === 'Sequence Parameter Set') { finish(); current = {}; return; }
    if (current === null) return;
    const m = /^\d+\s+(\w+)(?:\[\d+\])?\s+[01]*\s*=\s*(-?\d+)\s*$/.exec(line);
    if (m) {
      if (FIELDS.includes(m[1]) && current[m[1]] === undefined) current[m[1]] = m[2];
      return;
    }
    if (!/^\d+\s/.test(line) && line !== '') finish();
  };
  return { feed, result: () => { finish(); return { colours: found, overreads }; } };
};

// The NAL units at the start of one packet (length-prefixed, as Matroska stores them), up to the first slice. Returns
// { units: [{ start, end, type }], complete } where complete says the first slice (or the end of the packet) was reached.
const headerUnits = (buf, lengthSize, packetSize) => {
  const units = [];
  let at = 0;
  while (at + lengthSize <= buf.length) {
    const len = buf.readUIntBE(at, lengthSize);
    const end = at + lengthSize + len;
    if (len === 0 || end > packetSize) return { units, complete: false, bad: true };
    if (end > buf.length) return { units, complete: false };
    const type = buf[at + lengthSize] & 0x1f;
    if (type >= 1 && type <= 5) return { units, complete: true };
    units.push({ start: at, end, type });
    at = end;
  }
  return { units, complete: at >= packetSize };
};

// The bytes of the header units with every SEI that comes before the last SPS/PPS moved to just after it; null when no
// packet change is needed. The result has the same length as the bytes it replaces.
const reorderUnits = (buf, units) => {
  let lastParam = -1;
  units.forEach((u, i) => { if (u.type === 7 || u.type === 8) lastParam = i; });
  const moved = units.filter((u, i) => u.type === 6 && i < lastParam);
  if (moved.length === 0) return null;
  const keep = units.filter((u, i) => !(u.type === 6 && i < lastParam));
  const parts = [];
  keep.forEach((u) => {
    parts.push(buf.subarray(u.start, u.end));
    if (u === units[lastParam]) moved.forEach((m) => parts.push(buf.subarray(m.start, m.end)));
  });
  return { bytes: Buffer.concat(parts), start: units[0].start, end: units[units.length - 1].end, moved: moved.length };
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);
  const { spawn } = require('child_process');
  const fs = require('fs');
  const path = require('path');

  if (!args.variables) args.variables = {};
  if (!args.variables.user) args.variables.user = {};
  const { user } = args.variables;
  const label = 'Fix H.264 SEI/SPS Splice';
  const log = (m) => args.jobLog(`${label}: ${m}`);
  const tail = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(-300);
  const remove = (f) => { try { fs.unlinkSync(f); } catch (e) { /* not there */ } };
  const leave = (outputNumber, file) => ({
    outputFileObj: file ? { _id: file } : args.inputFileObj, outputNumber, variables: args.variables,
  });

  const detected = user.h264Splice;
  if (!detected || detected.fixable !== true || !detected.colour) {
    log(`nothing to fix (${detected ? detected.reason || 'Detect found nothing repairable' : 'Detect H.264 SEI/SPS Splice has not run: Flow Variable h264Splice is not set'})`);
    return leave(2);
  }
  const working = String(args.inputFileObj && args.inputFileObj._id ? args.inputFileObj._id : '');
  if (working === '' || !fs.existsSync(working)) throw new Error(`${label}: the working file "${working}" is not there on this node`);
  if (String(detected.file) !== working) {
    throw new Error(`${label}: Detect scanned "${detected.file}" but the working file is "${working}"; run Detect on the file that is to be fixed`);
  }
  if (args.originalLibraryFile && working === args.originalLibraryFile._id) {
    throw new Error(`${label}: the working file is the original library file; this plugin repairs the job's own copy (the video-only file Split Streams (ffmpeg) writes), never the library file`);
  }
  const colour = detected.colour;
  ['primaries', 'transfer', 'matrix', 'range'].forEach((k) => {
    if (!Number.isInteger(colour[k]) || colour[k] < 0 || colour[k] > 255) throw new Error(`${label}: the colour value ${k} (${colour[k]}) from Detect is not a number the SPS can carry`);
  });

  const ffmpeg = String(args.inputs.ffmpegPath || '') || String(args.ffmpegPath || '') || 'ffmpeg';
  const mkvmerge = String(args.inputs.mkvmergePath || 'mkvmerge');
  const out = path.join(path.dirname(working), `${path.basename(working).replace(/\.[^.]*$/, '')}-h264fix.mkv`);

  // --- progress: the share of the whole job each step stands for
  const began = Date.now();
  let lastPercent = -1;
  const report = (from, to, fraction) => {
    try {
      if (typeof args.updateWorker !== 'function') return;
      const f = Math.min(1, Math.max(0, fraction));
      const percentage = Math.min(to - 1, Math.floor(from + (to - from) * f));
      if (percentage <= lastPercent) return;
      lastPercent = percentage;
      const u = { percentage, outputFileSizeInGbytes: 0, estSize: 0 };
      const done = percentage / 100;
      if (done > 0.01) {
        const t = Math.round(((Date.now() - began) / 1000) * ((1 - done) / done));
        u.ETA = `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      }
      args.updateWorker(u);
    } catch (e) {
      // cosmetic
    }
  };

  // Runs a program (no shell). onLine gets every stderr line (CR or LF ended) when given; stdout is returned when collect
  // is set. track: { from, to, file }: the share of file the program has read (the "rchar" of /proc/<pid>/io, polled every
  // second, Linux only) is the progress between from and to percent.
  const run = (cmd, argv, opts = {}) => new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, argv, { env: { ...process.env, LC_ALL: 'C.UTF-8' } });
    } catch (e) {
      resolve({ code: -1, text: e.message, data: '' });
      return;
    }
    let text = '';
    let data = '';
    let carry = '';
    let timer = null;
    const { track } = opts;
    if (track && track.file) {
      let total = 0;
      try { total = fs.statSync(track.file).size; } catch (e) { total = 0; }
      if (total > 0 && child.pid) {
        timer = setInterval(() => {
          try {
            const m = /^rchar:\s*(\d+)/m.exec(fs.readFileSync(`/proc/${child.pid}/io`, 'utf8'));
            if (m) report(track.from, track.to, Number(m[1]) / total);
          } catch (e) {
            // no /proc: no percentage
          }
        }, 1000);
        timer.unref();
      }
    }
    child.on('error', (e) => { clearInterval(timer); resolve({ code: -1, text: e.code === 'ENOENT' ? `${cmd} not found` : e.message, data }); });
    child.stdout.on('data', (d) => { if (opts.collect) data += d.toString(); else text = (text + d.toString()).slice(-6000); });
    child.stderr.on('data', (d) => {
      text = (text + d.toString()).slice(-6000);
      if (opts.onLine) {
        const lines = (carry + d.toString()).split(/\r?\n|\r/);
        carry = lines.pop();
        lines.forEach((l) => opts.onLine(l));
      }
    });
    child.on('close', (code) => { clearInterval(timer); if (carry && opts.onLine) opts.onLine(carry); resolve({ code, text, data }); });
  });

  const ffprobe = async () => {
    const base = path.basename(ffmpeg);
    const candidates = [];
    if (/ffmpeg/i.test(base)) candidates.push(path.join(path.dirname(ffmpeg), base.replace(/ffmpeg/i, 'ffprobe')));
    candidates.push('tdarr-ffprobe', 'ffprobe');
    for (const c of candidates) {
      if ((await run(c, ['-version'])).code === 0) return c;
    }
    throw new Error(`${label}: ffprobe was not found (tried ${candidates.join(', ')})`);
  };

  // every video packet in file order: pts (ms), size, byte position of its block, key flag
  const packets = async (probe, file, track) => {
    const r = await run(probe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,size,pos,flags', '-of', 'csv=p=0', file], { collect: true, track });
    if (r.code !== 0) throw new Error(`${label}: ffprobe could not read the packets of ${path.basename(file)}: ${tail(r.text)}`);
    const rows = r.data.split('\n').map((l) => l.trim()).filter((l) => l !== '').map((l) => l.split(','));
    // ffprobe prints the columns in its own order: pts_time, size, pos, flags
    const list = rows.map((c) => ({
      pts: Math.round(Number(c[0]) * 1000), size: Number(c[1]), pos: Number(c[2]), key: String(c[3] || '').includes('K'),
    }));
    if (list.length === 0 || list.some((p) => !Number.isFinite(p.pts) || !Number.isFinite(p.size))) {
      throw new Error(`${label}: ${path.basename(file)} has no video packets, or packets without a timestamp`);
    }
    return list;
  };

  const backups = [];
  let fd = -1;
  const restore = () => {
    if (backups.length === 0) return;
    try {
      const w = fs.openSync(working, 'r+');
      backups.forEach((b) => fs.writeSync(w, b.bytes, 0, b.bytes.length, b.at));
      fs.closeSync(w);
      log(`the ${backups.length} patched packet(s) of the working file were put back as they were`);
    } catch (e) {
      log(`WARNING: the patched packets of the working file could not be put back: ${e.message}`);
    }
    backups.length = 0;
  };

  try {
    const probe = await ffprobe();

    // --- the original's facts: track properties (and the NAL length size), packets
    const ident = await run(mkvmerge, ['--identify', '--identification-format', 'json', working], { collect: true });
    if (ident.code > 1 || ident.code === -1) throw new Error(`${label}: mkvmerge could not read ${working} (this plugin works on Matroska files only): ${tail(ident.text)}`);
    let props = {};
    try {
      const track = JSON.parse(ident.data).tracks.find((t) => t.type === 'video');
      props = (track && track.properties) || {};
    } catch (e) {
      throw new Error(`${label}: mkvmerge's description of ${working} could not be read: ${e.message}`);
    }
    const avcc = Buffer.from(String(props.codec_private_data || ''), 'hex');
    if (avcc.length < 7 || avcc[0] !== 1) throw new Error(`${label}: the video track of ${path.basename(working)} has no avcC codec private data (not H.264 in Matroska?)`);
    const lengthSize = (avcc[4] & 3) + 1;

    const before = await packets(probe, working, { from: 0, to: 14, file: working });
    if (before.some((p) => !Number.isFinite(p.pos) || p.pos <= 0)) throw new Error(`${label}: ffprobe gave no byte position for some packets`);
    const keys = before.filter((p) => p.key).length;
    log(`${before.length} video packets, ${keys} key frames; moving SEI after SPS/PPS and fixing the colour to ${colour.primaries}/${colour.transfer}/${colour.matrix} range ${colour.range}`);

    // --- 2. SEI after SPS/PPS, in place
    fd = fs.openSync(working, 'r+');
    let patched = 0;
    let movedUnits = 0;
    let firstPatched = -1;
    for (let i = 0; i < before.length; i += 1) {
      const p = before[i];
      let want = Math.min(p.size, 4096);
      let units = null;
      for (;;) {
        const buf = Buffer.alloc(want);
        const got = fs.readSync(fd, buf, 0, want, p.pos + 4);
        const b = buf.subarray(0, got);
        units = headerUnits(b, lengthSize, p.size);
        if (units.bad || units.complete || want >= p.size) {
          if (units.bad) units.units = [];
          const change = units.units.length > 0 && units.units.some((u) => u.type === 7 || u.type === 8) && units.units.some((u) => u.type === 6)
            ? reorderUnits(b, units.units) : null;
          if (change) {
            const first = Buffer.alloc(1);
            if (fs.readSync(fd, first, 0, 1, p.pos) !== 1) throw new Error(`${label}: packet ${i} is not where ffprobe says`);
            if ((first[0] & 0x80) === 0 || (first[0] & 0x7f) === 0) throw new Error(`${label}: the block of packet ${i} does not start with a one-byte track number`);
            backups.push({ at: p.pos + 4 + change.start, bytes: Buffer.from(b.subarray(change.start, change.end)) });
            fs.writeSync(fd, change.bytes, 0, change.bytes.length, p.pos + 4 + change.start);
            if (patched === 0) firstPatched = i;
            patched += 1;
            movedUnits += change.moved;
          }
          break;
        }
        want = Math.min(p.size, want * 16);
      }
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = -1;
    report(14, 16, 1);
    log(patched === 0
      ? 'no packet has an SEI ahead of its SPS/PPS, so only the colour tags are written'
      : `moved ${movedUnits} SEI NAL unit(s) behind the SPS/PPS in ${patched} packet(s), the first one packet ${firstPatched} (${before[firstPatched].pts} ms)`);

    // --- 3. the colour description into every SPS
    const meta = `h264_metadata=video_full_range_flag=${colour.range}:colour_primaries=${colour.primaries}:transfer_characteristics=${colour.transfer}:matrix_coefficients=${colour.matrix}`;
    const tag = await run(ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', working, '-map', '0', '-c', 'copy', '-map_chapters', '0', '-bsf:v', meta, '-default_mode', 'passthrough', '-f', 'matroska', out],
      { track: { from: 16, to: 60, file: working } });
    if (tag.code !== 0) throw new Error(`${label}: ffmpeg could not write the colour tags (exit ${tag.code}): ${tail(tag.text)}`);

    // --- 4. check the result
    const after = await packets(probe, out, { from: 60, to: 72, file: out });
    if (after.length !== before.length) throw new Error(`${label}: the result has ${after.length} video packets, the original ${before.length}`);
    const moved = after.findIndex((p, i) => p.pts !== before[i].pts || p.key !== before[i].key);
    if (moved !== -1) throw new Error(`${label}: packet ${moved} has the timestamp ${after[moved].pts} ms (key frame ${after[moved].key}) in the result, ${before[moved].pts} ms (key frame ${before[moved].key}) in the original`);
    // a packet without an SPS keeps its size (its slices are copied as they are); report, do not fail, when one does not
    const resized = after.filter((p, i) => !before[i].key && p.size !== before[i].size).length;
    if (resized > 0) log(`note: ${resized} non-key packet(s) differ in size from the original (not an error by itself)`);

    const reader = spsReader();
    const sc = await run(ffmpeg, ['-hide_banner', '-nostdin', '-nostats', '-v', 'trace', '-i', out, '-map', '0:v:0', '-c', 'copy', '-bsf:v', 'filter_units=pass_types=7,trace_headers', '-f', 'null', '-'],
      { onLine: reader.feed, track: { from: 72, to: 98, file: out } });
    if (sc.code !== 0) throw new Error(`${label}: ffmpeg could not read the SPS of the result (exit ${sc.code}): ${tail(sc.text)}`);
    const { colours, overreads } = reader.result();
    if (colours.length === 0) throw new Error(`${label}: no SPS found in the result`);
    const wrong = colours.filter((c) => !c || c.primaries !== colour.primaries || c.transfer !== colour.transfer || c.matrix !== colour.matrix || c.range !== colour.range).length;
    if (wrong > 0) throw new Error(`${label}: ${wrong} of ${colours.length} SPS in the result do not declare the wanted colour`);
    if (overreads > 0) throw new Error(`${label}: the result still gives ${overreads} "SEI overread" warning(s)`);

    const ident2 = await run(mkvmerge, ['--identify', '--identification-format', 'json', out], { collect: true });
    try {
      const p2 = (JSON.parse(ident2.data).tracks.find((t) => t.type === 'video') || {}).properties || {};
      ['language', 'track_name', 'default_track', 'forced_track'].forEach((k) => {
        if (props[k] !== undefined && p2[k] !== props[k]) throw new Error(`track property ${k} is ${JSON.stringify(p2[k])} in the result, ${JSON.stringify(props[k])} in the original`);
      });
    } catch (e) {
      throw new Error(`${label}: ${e.message}`);
    }

    // --- done: the new file replaces the old working file
    backups.length = 0;
    const original = args.originalLibraryFile && args.originalLibraryFile._id;
    if (working !== original) remove(working);
    const size = fs.statSync(out).size;
    log(`done: ${path.basename(out)} (${size} bytes, ${after.length} video packets with the original timestamps, ${keys} key frames, ${colours.length} SPS all declare colour `
      + `${colour.primaries}/${colour.transfer}/${colour.matrix} range ${colour.range}, no SEI overread warning); it is the working file and videoOnlySource now`);
    user.videoOnlySource = out;
    user.h264Splice = { ...detected, fixed: true, fixedFile: out };
    if (args.variables.ffmpegCommand) args.variables.ffmpegCommand.init = false;
    if (typeof args.updateWorker === 'function') args.updateWorker({ percentage: 100, outputFileSizeInGbytes: 0, estSize: 0 });
    return leave(1, out);
  } catch (e) {
    if (fd !== -1) { try { fs.closeSync(fd); } catch (x) { /* closed */ } }
    restore();
    remove(out);
    log(`FAILED, the result was removed and the working file is as it was: ${e.message}`);
    throw e;
  }
};

module.exports = { details, plugin, spsReader, headerUnits, reorderUnits };
