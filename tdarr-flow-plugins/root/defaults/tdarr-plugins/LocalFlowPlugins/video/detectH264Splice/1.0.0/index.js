/**
 * Detect H.264 SEI/SPS Splice
 *
 * Finds an H.264 video whose colour tags change part-way through, for example an episode with a studio logo spliced
 * on the end. The episode's sequence parameter sets (SPS) declare no colour, the logo's SPS declares tv range and
 * bt709, and the logo's first access unit carries its SEI NAL unit ahead of the new SPS. Two things follow from it:
 *
 *   - ffmpeg and its parsers read that SEI with the old SPS and print "SEI type 0 overread by 8 bits" (that is the
 *     trigger of this plugin, tier 1);
 *   - a GPU encode or VMAF run that keeps the frames on the GPU (-hwaccel_output_format vaapi / cuda) cannot follow the
 *     colour change: ffmpeg rebuilds the filter graph and fails with "Impossible to convert between the formats".
 *
 * Tier 1 is free: Split Streams (ffmpeg) already reads the whole file with -loglevel warning and records how many
 * "SEI type N overread" lines it saw in the Flow Variable user.h264SeiOverread. Only when that is not 0 does this plugin
 * run tier 2: one pass over the working file that lists every SPS (ffmpeg -bsf:v filter_units=pass_types=7,trace_headers)
 * with its colour tags, size and HRD flags, and counts the overread warnings again.
 *
 * Output 1: the SPS differ only in colour tags and exactly one colour description is declared, which the SPS that
 *           declare none can be given: Fix H.264 SEI/SPS Splice can repair the file. The values are in
 *           user.h264Splice.colour.
 * Output 2: nothing to fix: no overread warning (and "only when Split Streams saw the warning" is on), one SPS only, or
 *           every SPS says the same about colour.
 * Output 3: the SPS differ in a way this pair of plugins does not repair (two different declared colour descriptions,
 *           a different picture size, bit depth or chroma format). The variants are in the job log.
 *
 * The file is not changed. The result is in the Flow Variable user.h264Splice (an object: fixable, reason, colour,
 * variants, overreads, file).
 */

const details = () => ({
  name: 'Detect H.264 SEI/SPS Splice',
  description: 'When Split Streams saw an "SEI type N overread" warning, lists the SPS of the working file and finds out whether the colour tags change part-way through (a spliced-in logo) in a way Fix H.264 SEI/SPS Splice can repair. Does not change the file.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Only Scan After An SEI Warning',
      name: 'onlyAfterWarning',
      type: 'boolean',
      defaultValue: 'true',
      inputUI: { type: 'switch' },
      tooltip: 'On: the SPS scan runs only when Split Streams (ffmpeg) recorded at least one "SEI type N overread" warning '
        + '(Flow Variable h264SeiOverread). Off: always scan, whatever Split Streams saw (a whole-file read of the working file).',
    },
    {
      label: 'ffmpeg Path',
      name: 'ffmpegPath',
      type: 'string',
      defaultValue: '',
      inputUI: { type: 'text' },
      tooltip: 'Leave empty to use the ffmpeg Tdarr gives the plugin, then ffmpeg from the PATH.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'A splice that Fix H.264 SEI/SPS Splice can repair' },
    { number: 2, tooltip: 'Nothing to fix' },
    { number: 3, tooltip: 'The SPS differ in a way that is not repaired here (see the job log)' },
  ],
});

// SPS fields read from ffmpeg's trace_headers output
const FIELDS = [
  'profile_idc', 'level_idc', 'seq_parameter_set_id', 'chroma_format_idc', 'bit_depth_luma_minus8',
  'pic_width_in_mbs_minus1', 'pic_height_in_map_units_minus1', 'frame_mbs_only_flag', 'frame_cropping_flag',
  'frame_crop_left_offset', 'frame_crop_right_offset', 'frame_crop_top_offset', 'frame_crop_bottom_offset',
  'vui_parameters_present_flag', 'video_signal_type_present_flag', 'video_format', 'video_full_range_flag',
  'colour_description_present_flag', 'colour_primaries', 'transfer_characteristics', 'matrix_coefficients',
  'nal_hrd_parameters_present_flag', 'vcl_hrd_parameters_present_flag', 'pic_struct_present_flag',
];

// One SPS (the raw field values) as the facts this plugin compares.
const describeSps = (f) => {
  const n = (k, d) => (f[k] === undefined ? d : Number(f[k]));
  const declared = n('video_signal_type_present_flag', 0) === 1 && n('colour_description_present_flag', 0) === 1;
  const colour = declared
    ? {
      primaries: n('colour_primaries', 2), transfer: n('transfer_characteristics', 2), matrix: n('matrix_coefficients', 2), range: n('video_full_range_flag', 0),
    }
    : null;
  const crop = n('frame_cropping_flag', 0) === 1
    ? [n('frame_crop_left_offset', 0), n('frame_crop_right_offset', 0), n('frame_crop_top_offset', 0), n('frame_crop_bottom_offset', 0)]
    : [0, 0, 0, 0];
  return {
    profile: n('profile_idc', -1),
    level: n('level_idc', -1),
    chroma: n('chroma_format_idc', 1),
    bitDepth: n('bit_depth_luma_minus8', 0) + 8,
    size: `${n('pic_width_in_mbs_minus1', -1) + 1}x${n('pic_height_in_map_units_minus1', -1) + 1} mbs, frame_mbs_only ${n('frame_mbs_only_flag', 1)}, crop ${crop.join(',')}`,
    colour,
    nalHrd: n('nal_hrd_parameters_present_flag', 0) === 1,
    vclHrd: n('vcl_hrd_parameters_present_flag', 0) === 1,
    picStruct: n('pic_struct_present_flag', 0) === 1,
  };
};

const colourText = (c) => (c ? `colour ${c.primaries}/${c.transfer}/${c.matrix} range ${c.range}` : 'no colour tags');
const variantText = (v) => `${v.count} x profile ${v.profile} level ${v.level}, ${v.size}, ${colourText(v.colour)}, `
  + `HRD ${v.nalHrd ? 'NAL' : ''}${v.vclHrd ? '+VCL' : ''}${!v.nalHrd && !v.vclHrd ? 'none' : ''}`;

// Parses the trace_headers lines of the SPS (the "Sequence Parameter Set" blocks). feed() takes one stderr line at a time.
const spsReader = () => {
  const variants = new Map();
  let current = null;
  let overreads = 0;
  const finish = () => {
    if (!current) return;
    const d = describeSps(current);
    const key = JSON.stringify(d);
    const known = variants.get(key);
    if (known) known.count += 1; else variants.set(key, { ...d, count: 1 });
    current = null;
  };
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
    // a line that is not a syntax element ends the SPS (the next header, a packet line, ...)
    if (!/^\d+\s/.test(line) && line !== '') finish();
  };
  return { feed, finish, result: () => { finish(); return { variants: [...variants.values()], overreads }; } };
};

const judge = (variants) => {
  if (variants.length === 0) return { fixable: false, output: 2, reason: 'no SPS found in the file' };
  const states = new Map();
  variants.forEach((v) => states.set(v.colour ? JSON.stringify(v.colour) : 'none', v.colour));
  if (states.size === 1) return { fixable: false, output: 2, reason: 'every SPS says the same about colour' };
  const shape = (v) => `${v.size}|${v.chroma}|${v.bitDepth}`;
  if (new Set(variants.map(shape)).size > 1) {
    return { fixable: false, output: 3, reason: 'the SPS differ in picture size, bit depth or chroma format, not only in colour tags' };
  }
  const declared = [...states.entries()].filter(([k]) => k !== 'none').map(([, c]) => c);
  if (declared.length > 1) {
    return { fixable: false, output: 3, reason: 'two or more different colour descriptions are declared, so there is no single value to give the SPS without one' };
  }
  // exactly one state is "none" and exactly one is declared (two states, one of them not declared)
  return { fixable: true, output: 1, reason: 'some SPS declare no colour and the others all declare the same one', colour: declared[0] };
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);
  const { spawn } = require('child_process');
  const path = require('path');

  if (!args.variables) args.variables = {};
  if (!args.variables.user) args.variables.user = {};
  const { user } = args.variables;
  const label = 'Detect H.264 SEI/SPS Splice';
  const log = (m) => args.jobLog(`${label}: ${m}`);
  const leave = (outputNumber) => ({ outputFileObj: args.inputFileObj, outputNumber, variables: args.variables });

  const file = String(args.inputFileObj && args.inputFileObj._id ? args.inputFileObj._id : '');
  const streams = (args.inputFileObj && args.inputFileObj.ffProbeData && args.inputFileObj.ffProbeData.streams) || [];
  const video = streams.find((s) => s.codec_type === 'video');
  if (video && video.codec_name && video.codec_name !== 'h264') {
    log(`the video is ${video.codec_name}, not h264: nothing to check`);
    user.h264Splice = { fixable: false, reason: `video is ${video.codec_name}`, file };
    return leave(2);
  }

  const warnings = Number(user.h264SeiOverread || 0);
  const only = String(args.inputs.onlyAfterWarning) === 'true';
  if (only && !(warnings > 0)) {
    log('Split Streams recorded no "SEI type N overread" warning (Flow Variable h264SeiOverread is empty or 0), so the SPS scan is skipped');
    user.h264Splice = { fixable: false, reason: 'no SEI overread warning', file };
    return leave(2);
  }
  log(only ? `Split Streams recorded ${warnings} "SEI overread" warning(s): scanning the SPS of ${file}` : `scanning the SPS of ${file}`);

  const ffmpeg = String(args.inputs.ffmpegPath || '') || String(args.ffmpegPath || '') || 'ffmpeg';
  const duration = Number(args.inputFileObj && args.inputFileObj.ffProbeData && args.inputFileObj.ffProbeData.format
    && args.inputFileObj.ffProbeData.format.duration) || 0;
  const reader = spsReader();
  const scan = await new Promise((resolve) => {
    let child;
    try {
      child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-nostats', '-progress', 'pipe:1', '-v', 'trace', '-i', file,
        '-map', '0:v:0', '-c', 'copy', '-bsf:v', 'filter_units=pass_types=7,trace_headers', '-f', 'null', '-'],
      { env: { ...process.env, LC_ALL: 'C.UTF-8' } });
    } catch (e) {
      resolve({ code: -1, text: e.message });
      return;
    }
    let carry = '';
    let last = '';
    let lastPercent = -1;
    child.on('error', (e) => resolve({ code: -1, text: e.code === 'ENOENT' ? 'ffmpeg not found' : e.message }));
    child.stderr.on('data', (d) => {
      const lines = (carry + d.toString()).split(/\r?\n|\r/);
      carry = lines.pop();
      lines.forEach((l) => {
        reader.feed(l);
        if (/error|failed|invalid/i.test(l) && !/SEI type \d+ overread/.test(l)) last = l.slice(0, 300);
      });
    });
    child.stdout.on('data', (d) => {
      try {
        const m = [...String(d).matchAll(/out_time_us=(\d+)/g)];
        if (m.length === 0 || !(duration > 0) || typeof args.updateWorker !== 'function') return;
        const percentage = Math.min(99, Math.floor((Number(m[m.length - 1][1]) / 1e6 / duration) * 100));
        if (percentage > lastPercent) { lastPercent = percentage; args.updateWorker({ percentage, outputFileSizeInGbytes: 0, estSize: 0 }); }
      } catch (e) {
        // progress is cosmetic
      }
    });
    child.on('close', (code) => { if (carry) reader.feed(carry); resolve({ code, text: last }); });
  });
  if (scan.code !== 0) {
    throw new Error(`${label}: ffmpeg could not read the SPS of ${path.basename(file)} (exit ${scan.code}) ${scan.text}`);
  }

  const { variants, overreads } = reader.result();
  variants.forEach((v) => log(`SPS variant: ${variantText(v)}`));
  const verdict = judge(variants);
  log(`${verdict.output === 1 ? 'FIXABLE' : (verdict.output === 3 ? 'NOT FIXABLE HERE' : 'nothing to fix')}: ${verdict.reason}; `
    + `${overreads} overread warning(s) in this pass`);
  user.h264Splice = {
    fixable: verdict.fixable, reason: verdict.reason, colour: verdict.colour || null, variants, overreads, file,
  };
  if (verdict.fixable) {
    log(`colour to give the SPS without any: primaries ${verdict.colour.primaries}, transfer ${verdict.colour.transfer}, `
      + `matrix ${verdict.colour.matrix}, range ${verdict.colour.range}`);
  }
  return leave(verdict.output);
};

module.exports = { details, plugin, spsReader, judge, describeSps };
