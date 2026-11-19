/* eslint-disable no-await-in-loop */
/**
 * DoVi/HDR: Look In Source
 *
 * The steps of the Dolby Vision / HDR10+ re-injection, one plugin per step, are wired in the Muxer flow:
 * Look In Source -> Extract (HDR10+ and/or RPU) -> Count Encode Frames -> Check RPU Frame Count -> Write Raw HEVC Stream
 * -> Inject (HDR10+, then RPU) -> Mux To MKV -> Verify Result -> Clean Up Work Files.
 * They share their results through the Flow Variables user.inj*, and every file they write is next to the working file
 * (in the job's cache folder) and listed in user.injTemp, so Clean Up (or a failure) removes it. The working file is
 * the re-encode (HEVC, no RPU, no HDR10+); the Flow Variable videoOnlySource is the video-only MKV it was made from.
 *
 * Reads the first 10 frames of the video-only source with dovi_tool and hdr10plus_tool. Starts a new inject: it clears
 * the user.inj* Flow Variables left by an earlier file.
 *
 * Also fails the job (throws) when a tool is missing, the source or the working file is not there on this node, or the
 * working file's video is not HEVC.
 *
 * Dolby Vision Profile 7 is marked to be converted to Profile 8.1 (dovi_tool mode 2); Profile 8 is used as it is. Any
 * other Profile (4, 5, ...) leaves through output 5.
 *
 * Output 1: neither Dolby Vision nor HDR10+: nothing to inject.
 * Output 2: HDR10+ only.
 * Output 3: Dolby Vision only.
 * Output 4: Dolby Vision and HDR10+.
 * Output 5: a Dolby Vision profile that is not supported.
 */

const details = () => ({
  name: 'DoVi/HDR: Look In Source',
  description: 'Looks in the video-only source (Flow Variable videoOnlySource) for a Dolby Vision RPU and for HDR10+ metadata and sends the file down the matching path.',
  style: { borderColor: '#fc6ede' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [],
  outputs: [
    { number: 1, tooltip: 'Neither Dolby Vision nor HDR10+: nothing to inject' },
    { number: 2, tooltip: 'HDR10+ only' },
    { number: 3, tooltip: 'Dolby Vision only' },
    { number: 4, tooltip: 'Dolby Vision and HDR10+' },
    { number: 5, tooltip: 'Dolby Vision profile not supported (Profile 4, 5, ...)' },
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
  const h = helpers(args, 'DoVi/HDR: Look In Source');
  const { user } = h;
  ['injTemp', 'injSource', 'injProfile', 'injMode', 'injDv', 'injHdr', 'injRpu', 'injRpuFrames', 'injHdrJson',
    'injFrames', 'injTimestamps', 'injCurrent', 'injOutput', 'tdarrInjected'].forEach((k) => { delete user[k]; });
  user.injTemp = [];

  const source = String(user.videoOnlySource || '').trim();
  const encode = h.workingFile();
  if (source === '' || source === 'undefined') h.fail('the Flow Variable videoOnlySource is not set (nothing to take the metadata from)');
  if (!h.fs.existsSync(source)) h.fail(`the video-only source ${source} does not exist on this node`);
  if (!h.fs.existsSync(encode)) h.fail(`the working file ${encode} does not exist on this node`);
  const video = h.encodeVideo();
  if (video && video.codec_name !== 'hevc') h.fail(`the working file's video is ${video.codec_name}, not HEVC, so nothing can be injected`);

  for (const [name, cmd, flag] of [['dovi_tool', 'dovi_tool', '--version'], ['hdr10plus_tool', 'hdr10plus_tool', '--version'],
    ['mkvmerge', 'mkvmerge', '--version'], ['ffmpeg', h.ffmpeg(), '-version']]) {
    const r = await h.run(cmd, [flag]);
    if (r.code !== 0) h.fail(`${name} is not available on this node (${h.tail(r.text)}); the tdarr-dovi-tool mod provides dovi_tool and hdr10plus_tool`);
  }

  const probeRpu = h.tmp('probe.rpu');
  const probeJson = h.tmp('probe.json');
  let hasDv = false;
  let profile = 0;
  const dv = await h.run('dovi_tool', ['extract-rpu', '-l', '10', '-i', source, '-o', probeRpu]);
  if (dv.code === 0) {
    hasDv = true;
    const info = await h.run('dovi_tool', ['info', '-i', probeRpu, '-s']);
    const m = /Profile:\s*(\d+)/.exec(info.text);
    profile = m ? Number(m[1]) : 0;
  } else if (!/No RPU was found/i.test(dv.text)) {
    h.fail(`could not look for a Dolby Vision RPU in ${source}: ${h.tail(dv.text)}`);
  }
  let hasHdr = false;
  const hdr = await h.run('hdr10plus_tool', ['extract', '-l', '10', '-i', source, '-o', probeJson]);
  if (hdr.code === 0) {
    hasHdr = true;
  } else if (!/doesn't contain dynamic metadata/i.test(hdr.text)) {
    h.fail(`could not look for HDR10+ metadata in ${source}: ${h.tail(hdr.text)}`);
  }
  h.drop(probeRpu);
  h.drop(probeJson);

  user.injSource = source;
  user.injProfile = profile;
  user.injDv = hasDv;
  user.injHdr = hasHdr;
  h.log(`source ${source}: Dolby Vision ${hasDv ? `Profile ${profile || 'unknown'}` : 'no'}, HDR10+ ${hasHdr ? 'yes' : 'no'}`);

  if (!hasDv && !hasHdr) {
    h.log('no Dolby Vision RPU and no HDR10+ metadata in the source: nothing to inject');
    return h.leave(1);
  }
  if (hasDv && profile !== 7 && profile !== 8) {
    return h.reject(`Dolby Vision Profile ${profile || 'unknown'} is not supported (Profile 4 is rejected on purpose, Profile 5 is not built yet)`, 5);
  }
  user.injMode = hasDv && profile === 7 ? 2 : 0;
  if (user.injMode === 2) h.log('Profile 7: the RPU will be converted to Profile 8.1 (dovi_tool mode 2); the enhancement layer mapping is not kept');
  if (hasDv && hasHdr) return h.leave(4);
  return h.leave(hasDv ? 3 : 2);
};

module.exports = { details, plugin };
