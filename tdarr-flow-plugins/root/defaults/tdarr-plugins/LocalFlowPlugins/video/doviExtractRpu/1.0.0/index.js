/* eslint-disable no-await-in-loop */
/**
 * Dolby Vision: Extract RPU From Source
 *
 * The steps of the Dolby Vision / HDR10+ re-injection, one plugin per step, are wired in the Muxer flow:
 * Look In Source -> Extract (HDR10+ and/or RPU) -> Count Encode Frames -> Check RPU Frame Count -> Write Raw HEVC Stream
 * -> Inject (HDR10+, then RPU) -> Mux To MKV -> Verify Result -> Clean Up Work Files.
 * They share their results through the Flow Variables user.inj*, and every file they write is next to the working file
 * (in the job's cache folder) and listed in user.injTemp, so Clean Up (or a failure) removes it. The working file is
 * the re-encode (HEVC, no RPU, no HDR10+); the Flow Variable videoOnlySource is the video-only MKV it was made from.
 *
 * Runs dovi_tool extract-rpu on the whole video-only source (with -m 2 for Profile 7, which converts the RPU to Profile
 * 8.1) and keeps the file in user.injRpu and its frame count in user.injRpuFrames.
 *
 * Output 1: always (a failed extraction throws).
 */

const details = () => ({
  name: 'Dolby Vision: Extract RPU From Source',
  description: 'Extracts the Dolby Vision RPU of the whole video-only source (Profile 7 converted to 8.1) and counts its frames.',
  style: { borderColor: '#fc6ede' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [],
  outputs: [
    { number: 1, tooltip: 'Continue to next plugin' },
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
  const h = helpers(args, 'Dolby Vision: Extract RPU From Source');
  const { user } = h;
  const source = h.needSource();
  const rpu = h.tmp('rpu.bin');
  const started = Date.now();
  const r = await h.run('dovi_tool', [...(user.injMode === 2 ? ['-m', '2'] : []), 'extract-rpu', '-i', source, '-o', rpu]);
  if (r.code !== 0) h.fail(`dovi_tool extract-rpu failed (exit ${r.code}): ${h.tail(r.text)}`);
  user.injRpu = rpu;
  user.injRpuFrames = await h.rpuFrameCount(rpu);
  h.log(`extracted ${user.injRpuFrames} RPUs from the source in ${Math.round((Date.now() - started) / 1000)} s`);
  return h.leave(1);
};

module.exports = { details, plugin };
