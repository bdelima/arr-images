/* eslint-disable no-await-in-loop */
/**
 * DoVi/HDR: Verify Result
 *
 * The steps of the Dolby Vision / HDR10+ re-injection, one plugin per step, are wired in the Muxer flow:
 * Look In Source -> Extract (HDR10+ and/or RPU) -> Count Encode Frames -> Check RPU Frame Count -> Write Raw HEVC Stream
 * -> Inject (HDR10+, then RPU) -> Mux To MKV -> Verify Result -> Clean Up Work Files.
 * They share their results through the Flow Variables user.inj*, and every file they write is next to the working file
 * (in the job's cache folder) and listed in user.injTemp, so Clean Up (or a failure) removes it. The working file is
 * the re-encode (HEVC, no RPU, no HDR10+); the Flow Variable videoOnlySource is the video-only MKV it was made from.
 *
 * The working file is the injected MKV. It extracts the RPU and the HDR10+ JSON back out of it and checks:
 *   - the RPU frame count equals the source's, and for Profile 8 the RPU is byte-identical to the one injected (Profile
 *     7 was converted, so only the count is compared);
 *   - the HDR10+ JSON is byte-identical to the one injected;
 *   - the MKV has the same number of video frames as the encode.
 * On a difference the injected MKV and the work files are removed.
 *
 * Output 1: everything matches. Sets the Flow Variable tdarrInjected (for example dolby-vision-p8+hdr10plus).
 * Output 2: something differs (wire it to Fail Flow).
 */

const details = () => ({
  name: 'DoVi/HDR: Verify Result',
  description: 'Reads the Dolby Vision RPU and HDR10+ metadata back out of the injected MKV and compares them with what was injected.',
  style: { borderColor: '#fc6ede' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [],
  outputs: [
    { number: 1, tooltip: 'Everything matches' },
    { number: 2, tooltip: 'Something differs (wire to Fail Flow)' },
  ],
});

// Shared by the DoVi/HDR plugins (each plugin file carries its own copy so a plugin stays one self-contained file).
// The steps pass their results on in Flow Variables (user.inj*), and every file they write is next to the working file
// (inside the job's cache folder) and listed in user.injTemp so that Clean Up, or a failure, can remove it.
const helpers = (args, label) => {
  const { spawn } = require('child_process');
  const fs = require('fs');
  const path = require('path');

  if (!args.variables) args.variables = {};
  if (!args.variables.user) args.variables.user = {};
  const { user } = args.variables;

  const log = (m) => args.jobLog(`${label}: ${m}`);
  const tail = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(-300);
  const remove = (file) => { try { fs.unlinkSync(file); } catch (e) { /* not there */ } };
  const temps = () => (Array.isArray(user.injTemp) ? user.injTemp : []);
  const cleanTemps = () => {
    const files = temps();
    files.forEach(remove);
    user.injTemp = [];
    return files.length;
  };
  // Throws away everything this job made for the inject: the work files and an injected MKV that was not accepted.
  const discard = () => {
    cleanTemps();
    if (user.injOutput) remove(String(user.injOutput));
    user.injOutput = '';
  };
  // A problem that fails the job (a missing tool or file, a command that errored): clean up and throw.
  const fail = (m) => {
    log(`FAILED: ${m}`);
    discard();
    throw new Error(`${label}: ${m}`);
  };
  // A result the flow can route (wired to Fail Flow on the canvas): clean up and leave through that output.
  const reject = (m, outputNumber) => {
    log(`FAILED: ${m}`);
    discard();
    return { outputFileObj: args.inputFileObj, outputNumber, variables: args.variables };
  };
  const leave = (outputNumber) => ({ outputFileObj: args.inputFileObj, outputNumber, variables: args.variables });

  // Progress for the worker (the percentage and ETA the Tdarr UI shows). Tdarr's own CLI helper only reads progress from
  // ffmpeg, HandBrake and a few encoders, and these steps run their programs themselves, so dovi_tool, hdr10plus_tool, ffprobe
  // and mkvmerge showed nothing and a long step looked hung. track says how to measure one run:
  //   { file } the program reads this file from start to end once: the share of it the program has read so far (the
  //            "rchar" of /proc/<pid>/io, polled every second, Linux only) is the percentage;
  //   { mkvmerge: true } the program prints "Progress: N%" itself;
  //   from / to (default 0 and 100) place the run inside a step that runs several programs one after the other.
  // Progress is cosmetic: a file that cannot be measured, an unreadable /proc or a worker without updateWorker just
  // means no percentage, and the run itself is never affected. The size figures are sent as 0, as Run VMAF does, because
  // the size of a work file says nothing about how far along the step is.
  const clock = (seconds) => {
    const t = Math.max(0, Math.round(seconds));
    return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  const tracker = (track) => {
    if (!track || typeof args.updateWorker !== 'function') return null;
    const from = track.from === undefined ? 0 : track.from;
    const to = track.to === undefined ? 100 : track.to;
    const began = Date.now();
    let last = -1;
    const report = (fraction) => {
      try {
        const f = Math.min(1, Math.max(0, fraction));
        const percentage = Math.min(Math.max(from, to - 1), Math.floor(from + (to - from) * f));
        if (percentage <= last) return;
        last = percentage;
        const update = { percentage, outputFileSizeInGbytes: 0, estSize: 0 };
        if (f > 0.01) update.ETA = clock(((Date.now() - began) / 1000) * ((1 - f) / f));
        args.updateWorker(update);
      } catch (e) {
        // cosmetic
      }
    };
    const finish = () => {
      try { args.updateWorker({ percentage: to, outputFileSizeInGbytes: 0, estSize: 0 }); } catch (e) { /* cosmetic */ }
    };
    return { report, finish };
  };

  // Runs a program (no shell). stdout is only kept when collect is set; the text kept for messages is the last
  // 6000 characters of stderr (and of stdout when it is not collected). track (see above) turns on progress reporting.
  const run = (cmd, argv, collect, track) => new Promise((resolve) => {
    let text = '';
    let data = '';
    let child;
    try {
      child = spawn(cmd, argv, { env: { ...process.env, LC_ALL: 'C.UTF-8' } });
    } catch (e) {
      resolve({ code: -1, text: e.message, data });
      return;
    }
    const progress = tracker(track);
    let timer = null;
    if (progress && track.file) {
      let total = 0;
      try { total = fs.statSync(track.file).size; } catch (e) { total = 0; }
      if (total > 0 && child.pid) {
        timer = setInterval(() => {
          try {
            const m = /^rchar:\s*(\d+)/m.exec(fs.readFileSync(`/proc/${child.pid}/io`, 'utf8'));
            if (m) progress.report(Number(m[1]) / total);
          } catch (e) {
            // no /proc, or not readable: no percentage
          }
        }, 1000);
        timer.unref();
      }
    }
    const keep = (d) => { text = (text + d.toString()).slice(-6000); };
    const watch = (d) => {
      if (!progress || !track.mkvmerge) return;
      const found = [...String(d).matchAll(/Progress:\s*(\d{1,3})%/g)];
      if (found.length > 0) progress.report(Number(found[found.length - 1][1]) / 100);
    };
    child.on('error', (e) => { clearInterval(timer); resolve({ code: -1, text: e.code === 'ENOENT' ? 'not found' : e.message, data }); });
    child.stdout.on('data', (d) => { watch(d); if (collect) data += d.toString(); else keep(d); });
    child.stderr.on('data', (d) => { watch(d); keep(d); });
    child.on('close', (code) => {
      clearInterval(timer);
      if (progress && code === 0) progress.finish();
      resolve({ code, text, data });
    });
  });

  const workingFile = () => String(args.inputFileObj && args.inputFileObj._id ? args.inputFileObj._id : '');
  const keyOf = (file) => path.basename(file).replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60);
  // A work file next to the working file; it is listed so that Clean Up (or a failure) removes it.
  const tmp = (name) => {
    const file = path.join(path.dirname(workingFile()), `${keyOf(workingFile())}-inject-${name}`);
    user.injTemp = [...temps(), file];
    return file;
  };
  // Removes a work file as soon as it is not needed any more.
  const drop = (file) => { remove(file); user.injTemp = temps().filter((f) => f !== file); };

  const ffmpeg = () => String(args.ffmpegPath || 'ffmpeg');
  // ffprobe: the sibling of Tdarr's ffmpeg first, then the usual names.
  const ffprobe = async () => {
    const base = path.basename(ffmpeg());
    const candidates = [];
    if (/ffmpeg/i.test(base)) candidates.push(path.join(path.dirname(ffmpeg()), base.replace(/ffmpeg/i, 'ffprobe')));
    candidates.push('tdarr-ffprobe', 'ffprobe');
    for (const c of candidates) {
      if ((await run(c, ['-version'])).code === 0) return c;
    }
    return fail(`ffprobe was not found (tried ${candidates.join(', ')})`);
  };
  const encodeVideo = () => {
    const streams = (args.inputFileObj && args.inputFileObj.ffProbeData && args.inputFileObj.ffProbeData.streams) || [];
    return streams.find((s) => s.codec_type === 'video');
  };
  const needSource = () => {
    const source = String(user.injSource || '');
    if (source === '' || !fs.existsSync(source)) fail(`the video-only source "${source}" is not there on this node`);
    return source;
  };
  const rpuFrameCount = async (file) => {
    const info = await run('dovi_tool', ['info', '-i', file, '-s']);
    const m = /Frames:\s*(\d+)/.exec(info.text);
    return m ? Number(m[1]) : 0;
  };

  return {
    user, log, tail, remove, run, fail, reject, leave, discard, cleanTemps, workingFile, keyOf, tmp, drop, ffmpeg, ffprobe,
    encodeVideo, needSource, rpuFrameCount, fs, path,
  };
};

const plugin = async (args) => {
  const h = helpers(args, 'DoVi/HDR: Verify Result');
  const { user } = h;
  const out = h.workingFile();
  if (out === '' || out !== String(user.injOutput || '')) h.fail('the working file is not the injected MKV (Mux To MKV has to run first)');
  const sha1 = (file) => new Promise((resolve, reject) => {
    const hash = require('crypto').createHash('sha1');
    h.fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
  const ffprobe = await h.ffprobe();
  // up to three programs read the result one after the other (RPU, HDR10+, packet count): each gets its share of 0-100
  const passes = (user.injDv ? 1 : 0) + (user.injHdr ? 1 : 0) + 1;
  let pass = 0;
  const share = () => {
    const range = { file: out, from: Math.floor((100 * pass) / passes), to: Math.floor((100 * (pass + 1)) / passes) };
    pass += 1;
    return range;
  };

  if (user.injDv) {
    const chk = h.tmp('check.rpu');
    const r = await h.run('dovi_tool', ['extract-rpu', '-i', out, '-o', chk], false, share());
    if (r.code !== 0) return h.reject(`the result does not read back (dovi_tool extract-rpu failed, exit ${r.code}): ${h.tail(r.text)}`, 2);
    const frames = await h.rpuFrameCount(chk);
    if (frames !== Number(user.injRpuFrames)) return h.reject(`the result holds ${frames} RPUs, expected ${user.injRpuFrames}`, 2);
    if (user.injProfile === 8 && (await sha1(chk)) !== (await sha1(String(user.injRpu)))) {
      return h.reject('the RPU read back from the result is not the RPU that was injected', 2);
    }
  }
  if (user.injHdr) {
    const chk = h.tmp('check.json');
    const r = await h.run('hdr10plus_tool', ['extract', '-i', out, '-o', chk], false, share());
    if (r.code !== 0) return h.reject(`the result does not read back (hdr10plus_tool extract failed, exit ${r.code}): ${h.tail(r.text)}`, 2);
    if ((await sha1(chk)) !== (await sha1(String(user.injHdrJson)))) {
      return h.reject('the HDR10+ metadata read back from the result is not what was injected', 2);
    }
  }
  const fc = await h.run(ffprobe, ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', out], true, share());
  const resultFrames = Number(String(fc.data).split('\n')[0].split(',')[0]);
  if (resultFrames !== Number(user.injFrames)) {
    return h.reject(`the result has ${Number.isFinite(resultFrames) ? resultFrames : 'an unreadable number of'} video frames, the encode had ${user.injFrames}`, 2);
  }
  const parts = [user.injDv ? `dolby-vision-p${user.injProfile === 7 ? '7to8.1' : '8'}` : '', user.injHdr ? 'hdr10plus' : ''].filter((p) => p !== '');
  user.tdarrInjected = parts.join('+');
  h.log(`read back from the result and compared: identical (${user.tdarrInjected}, ${resultFrames} frames)`);
  return h.leave(1);
};

module.exports = { details, plugin };
