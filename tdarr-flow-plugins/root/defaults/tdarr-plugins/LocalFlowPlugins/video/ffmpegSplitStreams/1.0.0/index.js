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
 *
 * Timestamp repair (only for files that need it). ffmpeg has to guess the DTS of the first packets of a stream whose
 * reorder depth it does not know yet (Matroska stores presentation times only). On some files the guess is later than the
 * packet's PTS, and the stream copy then raises the PTS to the DTS: "Invalid DTS ... replacing by guess" and
 * "Non-monotonic DTS ... changing to ..." for the video output (vost#0:0). Two frames end up with the same timestamp, and
 * the Encoder's ffmpeg drops one of them, so the encode has one frame fewer than the reference (job fz2k4xc: 83018 frames
 * in, 83017 out; the original file's timestamps were fine, the copy had damaged two of them). This plugin counts those
 * warnings while it copies. When the video output produced any, it copies the video stream again, alone, through
 * the setts bitstream filter with the PTS pinned to the original and a DTS that follows the packet count, which gives
 * ffmpeg nothing to fix, and replaces the video-only file with that copy. A file that copied without those warnings is
 * left exactly as it was written, with no second read. The audio+subs file is not touched. The frame rate for the DTS
 * comes from the video stream (r_frame_rate, rounded up to a whole number); when there is none the repair is skipped and
 * logged, and the first copy stays. If the second copy fails, the first copy stays too and the failure is logged.
 */

const details = () => ({
  name: 'Split Streams (ffmpeg)',
  description: 'Writes a video-only Matroska file (the new working file) and an audio+subs Matroska file (into the '
    + 'cache directory) from the working file in one pass over it, using the streams kept by the ffmpeg command '
    + 'that Begin Command and the Remove Stream plugins built. When ffmpeg\'s stream copy rewrites video timestamps '
    + '(DTS warnings), the video is copied once more with the original timestamps kept.',
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

// ffmpeg's warnings about the video output's timestamps (output 0, stream 0: the video-only file); see Timestamp repair above
const VIDEO_DTS_WARNING = /\[vost#0:0\/copy[^\]]*\]\s*(?:Invalid DTS|Non-monotonic DTS)/;
const SEI_OVERREAD = /SEI type \d+ overread by \d+ bits/;

// How many frames the repaired copy's DTS runs behind its position in the stream. The DTS has to be no later than the PTS of
// every packet, so this must be at least the stream's reorder depth; H.264 and HEVC allow at most 16 frames of reordering.
const DTS_LAG_FRAMES = 16;
// The DTS steps of the repair are 1/fps seconds, which must stay above the time base (1 ms in Matroska).
const MAX_REPAIR_FPS = 240;

// Counts matches of a pattern in text that arrives in chunks of any size: a match split between two chunks is counted once,
// a match inside one chunk is not counted again with the next.
const createCounter = (re) => {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  let carry = '';
  let count = 0;
  return {
    feed(text) {
      const seen = carry + String(text);
      const rx = new RegExp(re.source, flags);
      let last = 0;
      let m = rx.exec(seen);
      while (m !== null) {
        count += 1;
        last = rx.lastIndex;
        if (m[0].length === 0) rx.lastIndex += 1;
        m = rx.exec(seen);
      }
      carry = seen.slice(Math.max(last, seen.length - 200));
    },
    get count() { return count; },
  };
};

// "24000/1001", "24/1" or "23.976" as a number; NaN for anything else, including "0/0"
const parseRate = (text) => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*$/.exec(text === undefined || text === null ? '' : String(text));
  if (!m) return NaN;
  const num = Number(m[1]);
  const den = m[2] === undefined ? 1 : Number(m[2]);
  return den > 0 ? num / den : NaN;
};

// The whole-number frame rate for the repair's DTS expression, from the first stream that has a usable r_frame_rate (else
// avg_frame_rate), rounded UP (23.976 -> 24): the DTS steps may be smaller than the real frame spacing, never larger, or
// the DTS would overtake the PTS. 0 when there is no rate, or it is above MAX_REPAIR_FPS (variable frame rate files report
// a very high r_frame_rate): the repair is then skipped.
const dtsFrameRate = (...streams) => {
  for (const s of streams) {
    if (s) {
      for (const key of ['r_frame_rate', 'avg_frame_rate']) {
        const rate = parseRate(s[key]);
        if (rate > 0) {
          const fps = Math.ceil(rate - 0.001);
          return fps >= 1 && fps <= MAX_REPAIR_FPS ? fps : 0;
        }
      }
    }
  }
  return 0;
};

// setts bitstream filter of the repair copy: the PTS stays what the source has, the DTS is the packet's position in the
// stream (N, counted from 0) minus DTS_LAG_FRAMES, in frames of 1/fps seconds converted to the stream's time base (TB)
const dtsRepairFilter = (fps) => `setts=pts=PTS:dts=(N-${DTS_LAG_FRAMES})/(${fps}*TB)`;

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

  // percentage from ffmpeg's own progress line (time=...) against the file's duration; cosmetic, never breaks the copy
  const duration = Number(args.inputFileObj && args.inputFileObj.ffProbeData && args.inputFileObj.ffProbeData.format
    && args.inputFileObj.ffProbeData.format.duration)
    || Number(args.inputFileObj && args.inputFileObj.meta && args.inputFileObj.meta.Duration) || 0;

  // Runs one ffmpeg command and watches its output: progress for the worker, and counts of two kinds of warning.
  // seiOverreads: ffmpeg's "SEI type N overread by M bits" warning (-loglevel warning) is how a spliced-in H.264 segment shows
  // up (new SPS after its SEI); it goes on to the Flow Variable user.h264SeiOverread, for Detect H.264 SEI/SPS Splice.
  // dtsWarnings: the timestamp warnings of the video output, see Timestamp repair above.
  const runFfmpeg = async (ffmpegArgs) => {
    const cli = new CLI({
      cli: ffmpeg,
      spawnArgs: ffmpegArgs,
      spawnOpts: {},
      jobLog: args.jobLog,
      outputFilePath: noStatsFile,
      inputFileObj: args.inputFileObj,
      logFullCliOutput: args.logFullCliOutput,
      updateWorker: args.updateWorker,
      args,
    });
    const originalParse = cli.parseOutput;
    const sei = createCounter(SEI_OVERREAD);
    const dts = createCounter(VIDEO_DTS_WARNING);
    let lastPercent = -1;
    cli.parseOutput = (data) => {
      try {
        sei.feed(data);
        dts.feed(data);
      } catch (e) {
        // counting is cosmetic
      }
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
    const res = await cli.runCli();
    return { cli, res, seiOverreads: sei.count, dtsWarnings: dts.count };
  };

  const removeQuietly = (f) => {
    try {
      fs.unlinkSync(f);
    } catch (e) {
      // not there
    }
  };

  // Timestamp repair (see the top of the file): copy the video stream again, alone, with the PTS kept and a DTS ffmpeg has
  // nothing to fix, and replace the video-only file with it. Never fails the job except for a cancel: when the second copy
  // cannot be made the first one stays, as it was before this repair existed.
  const videoFix = `${outDir}/${getFileName(workingFile)}.dtsfix.mkv`;
  const repairVideoTimestamps = async (warnings) => {
    args.jobLog(`Split Streams (ffmpeg): ffmpeg gave ${warnings} timestamp warning(s) for the video output (Invalid DTS / `
      + 'Non-monotonic DTS): its stream copy changed packet timestamps, so two frames can share one and the encode would drop '
      + 'one. Copying the video again with the original timestamps kept');
    const sourceStream = ((args.inputFileObj.ffProbeData && args.inputFileObj.ffProbeData.streams) || [])
      .find((s) => s.index === video.index);
    const fps = dtsFrameRate(video, sourceStream);
    if (!fps) {
      args.jobLog('Split Streams (ffmpeg): timestamp repair skipped: the video stream has no usable frame rate (none, or '
        + `above ${MAX_REPAIR_FPS} fps as variable frame rate files report); the first video-only file stays`);
      return;
    }
    const fixArgs = [
      '-hide_banner', '-nostdin', '-y', '-stats', '-loglevel', 'warning',
      '-i', workingFile,
      '-map', `0:${video.index}`, '-c', 'copy', '-bsf:v', dtsRepairFilter(fps), '-avoid_negative_ts', 'disabled',
      '-default_mode', defaultMode, videoFix,
    ];
    args.jobLog(`Split Streams (ffmpeg): ${ffmpeg} ${fixArgs.join(' ')}`);
    const second = await runFfmpeg(fixArgs);
    if (second.cli.cancelled) throw new Error('Split Streams (ffmpeg): ffmpeg was cancelled');
    if (second.res.cliExitCode !== 0 || !fs.existsSync(videoFix) || fs.statSync(videoFix).size === 0) {
      removeQuietly(videoFix);
      args.jobLog(`Split Streams (ffmpeg): the repair copy failed (exit ${second.res.cliExitCode}); the first video-only file `
        + 'stays, with the timestamp problem');
      return;
    }
    const firstSize = fs.statSync(videoOut).size;
    fs.renameSync(videoFix, videoOut);
    args.jobLog(`Split Streams (ffmpeg): the video-only file is now the repaired copy (${fs.statSync(videoOut).size} bytes, the `
      + `first copy was ${firstSize})`);
    if (second.dtsWarnings > 0) {
      args.jobLog(`Split Streams (ffmpeg): the repaired copy still gave ${second.dtsWarnings} timestamp warning(s); the `
        + 'encode may still lose a frame (Run VMAF Quality Check will stop the job on a frame count mismatch)');
    } else {
      args.jobLog('Split Streams (ffmpeg): the repaired copy gave no timestamp warnings');
    }
  };

  let seiOverreads = 0;
  let audioSubsRenamed = false;
  try {
    const first = await runFfmpeg(spawnArgs);
    if (first.res.cliExitCode !== 0 || first.cli.cancelled) {
      throw new Error(`Split Streams (ffmpeg): ffmpeg ${first.cli.cancelled ? 'was cancelled' : `failed (exit ${first.res.cliExitCode})`}`);
    }
    seiOverreads = first.seiOverreads;
    [videoOut, audioSubsTmp].forEach((f) => {
      if (!fs.existsSync(f) || fs.statSync(f).size === 0) {
        throw new Error(`Split Streams (ffmpeg): ffmpeg reported success but ${f} is missing or empty`);
      }
    });
    fs.renameSync(audioSubsTmp, audioSubsOut);
    audioSubsRenamed = true;
    if (first.dtsWarnings > 0) await repairVideoTimestamps(first.dtsWarnings);
  } catch (e) {
    removeQuietly(videoOut);
    removeQuietly(videoFix);
    removeQuietly(audioSubsTmp);
    if (audioSubsRenamed) removeQuietly(audioSubsOut);
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
  args.variables.user.h264SeiOverread = seiOverreads;
  if (seiOverreads > 0) {
    args.jobLog(`Split Streams (ffmpeg): ffmpeg gave ${seiOverreads} "SEI type N overread" warning(s) while copying the video `
      + '(Flow Variable h264SeiOverread); Detect H.264 SEI/SPS Splice can use this to look for a spliced-in segment');
  }

  return { outputFileObj: { _id: videoOut }, outputNumber: 1, variables: args.variables };
};

module.exports = {
  details, plugin, createCounter, parseRate, dtsFrameRate, dtsRepairFilter, VIDEO_DTS_WARNING, SEI_OVERREAD,
};
