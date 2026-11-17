/**
 * Split Streams (ffmpeg) — Local Flow Plugin
 *
 * Reads the file ONCE and writes two Matroska files with one ffmpeg command (one input, two outputs, every stream copied):
 *
 *   1. the video-only file, which becomes the flow's working file (the Encoder works on this, never on the container);
 *   2. the audio+subs file, written to <Audio+Subs Cache Directory>/<original file name>-audiosubs.mkv, where
 *      mkvmerge Execute (mode combine) finds it later and puts the pieces back together.
 *
 * Why one command: a large remux on a hard drive takes minutes to read, and two separate passes (what the two
 * mkvmerge Execute modes audioSubs and video did) read the whole file twice. mkvmerge cannot write two outputs from
 * one read; ffmpeg can.
 *
 * Which streams go where comes from the ffmpeg command that Begin Command and the Remove Stream plugins built
 * (args.variables.ffmpegCommand.streams): the first video stream goes to the video file; every audio and subtitle
 * stream that is not marked removed goes to the audio+subs file, in source order. Streams that are removed, attachments
 * (fonts, cover images) and data streams are left out. The title and global tags are not touched here: they are removed
 * by the combine step (mkvmerge --title "" --no-global-tags). Stream language, title and default/forced flags are
 * copied. Chapters are copied into both files (mkvmerge Execute combine keeps one set, checked on a real file).
 *
 * The path of the video-only file is also stored in the Flow Variable user.videoOnlySource, so the Validator can score the
 * encode against it (Run VMAF Quality Check, Reference file) instead of against the much larger original.
 *
 * Only stream selection is translated from the command. Other ffmpeg arguments in it (output arguments, overall
 * arguments) cannot apply to a stream copy and are logged as ignored.
 *
 * Subtitles in MP4 (mov_text) cannot be copied into Matroska, so they are converted to SRT text; every other stream is
 * copied as is. Failures (no video stream, nothing to keep, ffmpeg error) throw, which fails the file, and the partly
 * written files are removed.
 */

const details = () => ({
  name: 'Split Streams (ffmpeg)',
  description: 'Writes a video-only Matroska file (the new working file) and an audio+subs Matroska file (into the '
    + 'cache directory) from the working file in one pass over it, using the streams kept by the ffmpeg command '
    + 'that Begin Command and the Remove Stream plugins built.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Audio+Subs Cache Directory',
      name: 'audioSubsDir',
      type: 'string',
      defaultValue: '/temp/.tdarr-remux-cache',
      inputUI: { type: 'text' },
      tooltip: 'The audio+subs file is written to <this directory>/<original file name without extension>'
        + '-audiosubs.mkv. mkvmerge Execute (combine) reads it from the same place.',
    },
    {
      label: 'Default Flags',
      name: 'defaultMode',
      type: 'string',
      defaultValue: 'passthrough',
      inputUI: { type: 'dropdown', options: ['passthrough', 'infer', 'infer_no_subs'] },
      tooltip: 'ffmpeg Matroska option default_mode. passthrough: every stream keeps the default flag it had in the '
        + 'source (what mkvmerge did). infer: ffmpeg marks the first stream of each type as default when none is.',
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
    { number: 1, tooltip: 'Continue to next plugin (the working file is now the video-only file)' },
  ],
});

const describe = (s) => {
  const t = s.tags || {};
  return `#${s.index} ${s.codec_type} ${s.codec_name || '?'}${t.language ? ` ${t.language}` : ''}${t.title ? ` "${t.title}"` : ''}`;
};

// "00:12:34.56" (the time= field of ffmpeg's progress line) in seconds
const parseClock = (text) => {
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(text);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const fs = require('fs');
  const path = require('path');
  const { CLI } = require('../../../../FlowHelpers/1.0.0/cliUtils');
  const { getPluginWorkDir, getFileName } = require('../../../../FlowHelpers/1.0.0/fileUtils');

  const cmd = args.variables && args.variables.ffmpegCommand;
  if (!cmd || !Array.isArray(cmd.streams)) {
    throw new Error('Split Streams (ffmpeg): no ffmpeg command in progress, place this after Begin Command and the '
      + 'Remove Stream plugins');
  }
  const defaultMode = String(args.inputs.defaultMode || 'passthrough');
  if (!['passthrough', 'infer', 'infer_no_subs'].includes(defaultMode)) {
    throw new Error(`Split Streams (ffmpeg): unknown default flags mode "${defaultMode}"`);
  }

  const workingFile = args.inputFileObj._id;
  const originalFile = (args.originalLibraryFile && args.originalLibraryFile._id) || workingFile;
  const nameBase = (args.originalLibraryFile && args.originalLibraryFile.fileNameWithoutExtension)
    || getFileName(originalFile);

  const video = cmd.streams.find((s) => s.codec_type === 'video');
  if (!video) throw new Error(`Split Streams (ffmpeg): ${workingFile} has no video stream`);
  const kept = cmd.streams.filter((s) => !s.removed && (s.codec_type === 'audio' || s.codec_type === 'subtitle'));
  if (kept.length === 0) {
    throw new Error('Split Streams (ffmpeg): no audio or subtitle stream is kept, so there is nothing to put in the '
      + 'audio+subs file');
  }

  const ignored = [];
  cmd.streams.forEach((s) => {
    if ((s === video || kept.includes(s)) && (s.outputArgs || []).some((a) => String(a).trim() !== '')) {
      ignored.push(`stream #${s.index}`);
    }
  });
  if ((cmd.overallOuputArguments || []).length > 0) ignored.push('overall output arguments');
  if ((cmd.overallInputArguments || []).length > 0) ignored.push('overall input arguments');
  if (ignored.length > 0) {
    args.jobLog(`Split Streams (ffmpeg): arguments in the ffmpeg command cannot apply to a stream copy and are `
      + `ignored: ${ignored.join(', ')}`);
  }

  const ffmpeg = String(args.inputs.ffmpegPath || '') || String(args.ffmpegPath || '') || 'ffmpeg';

  const outDir = getPluginWorkDir(args);
  const videoOut = `${outDir}/${getFileName(workingFile)}.mkv`;
  const cacheDir = String(args.inputs.audioSubsDir);
  const audioSubsOut = path.join(cacheDir, `${nameBase}-audiosubs.mkv`);
  // written under another name and renamed when ffmpeg is done, so combine mode never finds a half-written file
  const audioSubsTmp = path.join(cacheDir, `${nameBase}-audiosubs.partial.mkv`);
  fs.mkdirSync(cacheDir, { recursive: true });

  // mov_text (MP4 timed text) cannot be copied into Matroska; convert those to SRT text
  const convert = [];
  let subOut = 0;
  kept.forEach((s) => {
    if (s.codec_type !== 'subtitle') return;
    if (s.codec_name === 'mov_text') convert.push(`-c:s:${subOut}`, 'srt');
    subOut += 1;
  });

  const spawnArgs = [
    '-hide_banner', '-nostdin', '-y', '-stats', '-loglevel', 'warning',
    '-i', workingFile,
    '-map', `0:${video.index}`, '-c', 'copy', '-default_mode', defaultMode, videoOut,
    ...kept.flatMap((s) => ['-map', `0:${s.index}`]),
    '-c', 'copy', ...convert, '-map_chapters', '0', '-default_mode', defaultMode, audioSubsTmp,
  ];

  args.jobLog(`Split Streams (ffmpeg): ${workingFile}`);
  args.jobLog(`  video-only file (becomes the working file): ${describe(video)} -> ${videoOut}`);
  args.jobLog(`  audio+subs file: ${kept.map(describe).join('; ')} -> ${audioSubsOut}`);
  const left = cmd.streams.filter((s) => s !== video && !kept.includes(s));
  if (left.length > 0) args.jobLog(`  left out: ${left.map(describe).join('; ')}`);
  args.jobLog(`Split Streams (ffmpeg): ${ffmpeg} ${spawnArgs.join(' ')}`);

  // Naming a path that never exists makes the CLI helper send 0 for the output size, as mkvmerge Execute does: the
  // helper's size estimate means nothing for two outputs.
  const noStatsFile = `${videoOut}.no-size-stats`;
  const cli = new CLI({
    cli: ffmpeg,
    spawnArgs,
    spawnOpts: {},
    jobLog: args.jobLog,
    outputFilePath: noStatsFile,
    inputFileObj: args.inputFileObj,
    logFullCliOutput: args.logFullCliOutput,
    updateWorker: args.updateWorker,
    args,
  });

  // percentage from ffmpeg's own progress line (time=...) against the file's duration; cosmetic, never breaks the copy
  const duration = Number(args.inputFileObj && args.inputFileObj.ffProbeData && args.inputFileObj.ffProbeData.format
    && args.inputFileObj.ffProbeData.format.duration)
    || Number(args.inputFileObj && args.inputFileObj.meta && args.inputFileObj.meta.Duration) || 0;
  const originalParse = cli.parseOutput;
  let lastPercent = -1;
  cli.parseOutput = (data) => {
    try {
      if (typeof originalParse === 'function') originalParse.call(cli, data);
      if (!(duration > 0)) return;
      const found = [...String(data).matchAll(/time=(\d+:\d{2}:\d{2}(?:\.\d+)?)/g)];
      if (found.length === 0) return;
      const secs = parseClock(found[found.length - 1][1]);
      if (!(secs >= 0)) return;
      const percentage = Math.min(100, Math.floor((secs / duration) * 100));
      if (percentage <= lastPercent) return;
      lastPercent = percentage;
      if (percentage > 0 && typeof args.updateWorker === 'function') {
        args.updateWorker({ percentage });
        if (typeof cli.updateETA === 'function') Promise.resolve(cli.updateETA(percentage)).catch(() => {});
      }
    } catch (e) {
      // progress is cosmetic
    }
  };

  const removeQuietly = (f) => {
    try {
      fs.unlinkSync(f);
    } catch (e) {
      // not there
    }
  };

  let res;
  try {
    res = await cli.runCli();
    if (res.cliExitCode !== 0 || cli.cancelled) {
      throw new Error(`Split Streams (ffmpeg): ffmpeg ${cli.cancelled ? 'was cancelled' : `failed (exit ${res.cliExitCode})`}`);
    }
    [videoOut, audioSubsTmp].forEach((f) => {
      if (!fs.existsSync(f) || fs.statSync(f).size === 0) {
        throw new Error(`Split Streams (ffmpeg): ffmpeg reported success but ${f} is missing or empty`);
      }
    });
    fs.renameSync(audioSubsTmp, audioSubsOut);
  } catch (e) {
    removeQuietly(videoOut);
    removeQuietly(audioSubsTmp);
    args.jobLog(`Split Streams (ffmpeg): failed, the partly written files were removed: ${e.message}`);
    throw e;
  }

  args.jobLog(`Split Streams (ffmpeg): done. video-only ${fs.statSync(videoOut).size} bytes, audio+subs `
    + `${fs.statSync(audioSubsOut).size} bytes`);

  // the next Begin Command starts a fresh command on the new working file
  cmd.init = false;

  // Where the video-only file is, for later steps that want the exact file the encode is made from: Run VMAF Quality Check's
  // Reference file input reads {{{args.variables.user.videoOnlySource}}}. The file stays in the job's work directory.
  args.variables = args.variables || {};
  if (!args.variables.user) args.variables.user = {};
  args.variables.user.videoOnlySource = videoOut;

  return { outputFileObj: { _id: videoOut }, outputNumber: 1, variables: args.variables };
};

module.exports = { details, plugin };
