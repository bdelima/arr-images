/* eslint-disable no-await-in-loop */
/**
 * HDR10+: Inject Into Stream
 *
 * The steps of the Dolby Vision / HDR10+ re-injection, one plugin per step, are wired in the Muxer flow:
 * Look In Source -> Extract (HDR10+ and/or RPU) -> Count Encode Frames -> Check RPU Frame Count -> Write Raw HEVC Stream
 * -> Inject (HDR10+, then RPU) -> Mux To MKV -> Verify Result -> Clean Up Work Files.
 * They share their results through the Flow Variables user.inj*, and every file they write is next to the working file
 * (in the job's cache folder) and listed in user.injTemp, so Clean Up (or a failure) removes it. The working file is
 * the re-encode (HEVC, no RPU, no HDR10+); the Flow Variable videoOnlySource is the video-only MKV it was made from.
 *
 * Runs hdr10plus_tool inject with the JSON from HDR10+: Extract From Source on the raw stream. This runs before the
 * Dolby Vision RPU is injected (the tools do not document an order; this order was tested). If the metadata has a
 * different number of frames than the stream, the job leaves through output 3.
 *
 * Output 1: injected, and the source also has Dolby Vision (go on to Inject RPU).
 * Output 2: injected, HDR10+ only (go on to Mux To MKV).
 * Output 3: the metadata does not fit the stream (wire it to Fail Flow).
 */

const details = () => ({
  name: 'HDR10+: Inject Into Stream',
  description: 'Injects the HDR10+ metadata of the source into the raw HEVC stream of the encode.',
  style: { borderColor: '#fc6ede' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [],
  outputs: [
    { number: 1, tooltip: 'Injected; Dolby Vision follows (Inject RPU)' },
    { number: 2, tooltip: 'Injected; HDR10+ only (Mux To MKV)' },
    { number: 3, tooltip: 'The metadata does not fit the stream (wire to Fail Flow)' },
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

  // Runs a program (no shell). stdout is only kept when collect is set; the text kept for messages is the last
  // 6000 characters of stderr (and of stdout when it is not collected).
  const run = (cmd, argv, collect) => new Promise((resolve) => {
    let text = '';
    let data = '';
    let child;
    try {
      child = spawn(cmd, argv, { env: { ...process.env, LC_ALL: 'C.UTF-8' } });
    } catch (e) {
      resolve({ code: -1, text: e.message, data });
      return;
    }
    const keep = (d) => { text = (text + d.toString()).slice(-6000); };
    child.on('error', (e) => resolve({ code: -1, text: e.code === 'ENOENT' ? 'not found' : e.message, data }));
    child.stdout.on('data', (d) => { if (collect) data += d.toString(); else keep(d); });
    child.stderr.on('data', keep);
    child.on('close', (code) => resolve({ code, text, data }));
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
  const h = helpers(args, 'HDR10+: Inject Into Stream');
  const { user } = h;
  const current = String(user.injCurrent || '');
  const json = String(user.injHdrJson || '');
  if (current === '' || json === '') h.fail('there is no raw stream or no HDR10+ JSON (Write Raw HEVC Stream and HDR10+: Extract have to run first)');
  const next = h.tmp('1-hdr10plus.hevc');
  const r = await h.run('hdr10plus_tool', ['inject', '-i', current, '-j', json, '-o', next]);
  if (r.code !== 0) h.fail(`hdr10plus_tool inject failed (exit ${r.code}): ${h.tail(r.text)}`);
  if (/mismatched lengths/i.test(r.text)) return h.reject(`hdr10plus_tool inject: ${h.tail(r.text)}`, 3);
  h.drop(current);
  user.injCurrent = next;
  h.log('HDR10+ metadata injected');
  return h.leave(user.injDv ? 1 : 2);
};

module.exports = { details, plugin };
