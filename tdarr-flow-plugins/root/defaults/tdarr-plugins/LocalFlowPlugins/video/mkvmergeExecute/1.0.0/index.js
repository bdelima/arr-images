/**
 * mkvmerge Execute — Local Flow Plugin
 *
 * Does the remuxing with mkvmerge instead of ffmpeg. The input can be any container mkvmerge reads (Matroska, MP4/MOV,
 * AVI, MPEG-TS and others); the output is always Matroska (.mkv).
 *
 * Why: ffmpeg's Matroska muxer writes bigger files than mkvmerge (it does not lace audio frames), and the ffmpeg
 * `-map_metadata -1` Stream Cleanup used to strip the title also removed every stream's language/title tags.
 * mkvmerge keeps the per-stream language, title and default/forced flags, and takes the title and the global tags
 * off with explicit options.
 *
 * It reads which streams to keep from the ffmpeg command that Begin Command and the Remove Stream plugins build
 * (args.variables.ffmpegCommand.streams, `removed` flag) and translates that into mkvmerge track selections, so the
 * existing removal nodes keep working. Only stream removal is translated. Other ffmpeg arguments in that command
 * (output arguments, overall arguments) cannot be given to mkvmerge and are logged as ignored.
 *
 * Modes:
 *   all       Every stream that is not removed, in one file.
 *   audioSubs Every audio and subtitle stream that is not removed. No video.
 *   video     Only the first video track. No audio, subtitles or attachments.
 *   combine   The working file (video, usually the encoder output) plus the audio+subs file made earlier by the
 *             audioSubs mode and copied to the cache directory. The video comes from the working file, audio and
 *             subtitles from the other file.
 *
 * Every output has the title and the global tags removed (mkvmerge --title "" --no-global-tags).
 * Attachments (fonts, cover images) are removed unless the command keeps all of them.
 *
 * Track mapping: mkvmerge track ids are matched to the command's streams by position within each type (the 2nd audio
 * stream in the command is the 2nd audio track mkvmerge reports). The counts per type must be equal and the language
 * tags must agree where both are set. If they do not, the plugin throws, so a wrong track can never be removed.
 *
 * Failures (unreadable file, mapping mismatch, mkvmerge error) throw, which fails the file. mkvmerge exit code 1
 * (warnings) is accepted.
 */

const details = () => ({
  name: 'mkvmerge Execute',
  description: 'Remuxes with mkvmerge (any container in, Matroska out) using the streams kept by the ffmpeg '
    + 'command that Begin Command and the Remove Stream plugins built. Keeps stream language/title tags, removes the '
    + 'title and global tags. Modes: all, audioSubs, video, combine.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Mode',
      name: 'mode',
      type: 'string',
      defaultValue: 'all',
      inputUI: { type: 'dropdown', options: ['all', 'audioSubs', 'video', 'combine'] },
      tooltip: 'all: every kept stream. audioSubs: kept audio and subtitles, no video. video: first video track '
        + 'only. combine: video from the working file plus the audio+subs file in the cache directory.',
    },
    {
      label: 'Source File',
      name: 'source',
      type: 'string',
      defaultValue: 'working',
      inputUI: { type: 'dropdown', options: ['working', 'original'] },
      tooltip: 'Which file to read in modes all, audioSubs and video. working: the file the flow is on now. '
        + 'original: the original library file. The stream list in the ffmpeg command has to describe that file.',
    },
    {
      label: 'Audio+Subs Cache Directory (combine mode)',
      name: 'audioSubsDir',
      type: 'string',
      defaultValue: '/downloads/.tdarr-remux-cache',
      inputUI: { type: 'text' },
      tooltip: 'Combine mode reads <this directory>/<original file name without extension>-audiosubs.mkv.',
    },
    {
      label: 'mkvmerge Path',
      name: 'mkvmergePath',
      type: 'string',
      defaultValue: '',
      inputUI: { type: 'text' },
      tooltip: 'Leave empty to use the mkvmerge next to Tdarr\'s mkvpropedit, then /usr/bin/mkvmerge, then mkvmerge '
        + 'from the PATH.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Continue to next plugin' },
  ],
});

const TYPES = [
  { plan: 'video', mkv: 'video', label: 'video' },
  { plan: 'audio', mkv: 'audio', label: 'audio' },
  { plan: 'subtitle', mkv: 'subtitles', label: 'subtitle' },
];

const normLang = (l) => {
  const v = String(l || '').trim().toLowerCase();
  return (v === '' || v === 'und') ? '' : v;
};

const describe = (s) => {
  const t = s.tags || {};
  return `#${s.index} ${s.codec_name || '?'}${t.language ? ` ${t.language}` : ''}${t.title ? ` "${t.title}"` : ''}`;
};

// Translates the ffmpeg command's streams into the mkvmerge track ids to keep, per type.
// Throws when the two views of the file do not line up.
const mapTracks = (cmdStreams, identified) => {
  const out = {};
  TYPES.forEach((t) => {
    const planned = cmdStreams.filter((s) => s.codec_type === t.plan);
    const tracks = (identified.tracks || []).filter((tr) => tr.type === t.mkv);
    if (planned.length !== tracks.length) {
      throw new Error(`mkvmerge Execute: the ffmpeg command lists ${planned.length} ${t.label} stream(s) but mkvmerge `
        + `finds ${tracks.length} ${t.label} track(s) in the file, so the tracks cannot be matched safely. `
        + `ffmpeg: [${planned.map(describe).join('; ')}] mkvmerge: [${tracks.map((tr) => `#${tr.id} ${tr.codec} `
          + `${(tr.properties || {}).language || ''}`).join('; ')}]`);
    }
    planned.forEach((s, i) => {
      const a = normLang(s.tags && s.tags.language);
      const b = normLang((tracks[i].properties || {}).language);
      if (a !== '' && b !== '' && a !== b) {
        throw new Error(`mkvmerge Execute: ${t.label} stream ${i + 1} is tagged "${a}" for ffmpeg (${describe(s)}) but `
          + `"${b}" for mkvmerge (track ${tracks[i].id}), so the tracks cannot be matched safely`);
      }
    });
    out[t.plan] = planned.map((s, i) => ({ stream: s, track: tracks[i] }));
  });
  return out;
};

const trackArgs = (flag, noFlag, ids) => (ids.length > 0 ? [flag, ids.join(',')] : [noFlag]);

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const fs = require('fs');
  const path = require('path');
  const { execFile } = require('child_process');
  const { CLI } = require('../../../../FlowHelpers/1.0.0/cliUtils');
  const { getPluginWorkDir, getFileName } = require('../../../../FlowHelpers/1.0.0/fileUtils');

  const mode = String(args.inputs.mode || 'all');
  const source = String(args.inputs.source || 'working');
  if (!['all', 'audioSubs', 'video', 'combine'].includes(mode)) {
    throw new Error(`mkvmerge Execute: unknown mode "${mode}"`);
  }

  const bin = (() => {
    if (args.inputs.mkvmergePath) return String(args.inputs.mkvmergePath);
    const candidates = [];
    if (args.mkvpropeditPath) candidates.push(path.join(path.dirname(args.mkvpropeditPath), 'mkvmerge'));
    candidates.push('/usr/bin/mkvmerge');
    return candidates.find((c) => fs.existsSync(c)) || 'mkvmerge';
  })();

  // mkvmerge opens file names in the locale's encoding. With no locale set (the C locale, which a container can
  // have) it cannot open a name with accented or non-Latin characters ("The file '' could not be opened"), so run it
  // with a UTF-8 locale. Reproduced with mkvmerge 82.0 in a sandbox; not checked in the Tdarr containers.
  const env = { ...process.env, LC_ALL: 'C.UTF-8' };

  const identify = (file) => new Promise((resolve, reject) => {
    execFile(bin, ['--identification-format', 'json', '--identify', file], { maxBuffer: 64 * 1024 * 1024, env },
      (err, stdout, stderr) => {
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch (e) {
          reject(new Error(`mkvmerge Execute: could not identify ${file} with ${bin}: `
            + `${(err && err.message) || ''} ${String(stderr || stdout).slice(0, 500)}`));
          return;
        }
        if (!parsed.container || parsed.container.recognized === false || parsed.container.supported === false) {
          reject(new Error(`mkvmerge Execute: mkvmerge does not support the container of ${file} `
            + `(${(parsed.container && parsed.container.type) || 'unknown'})`));
          return;
        }
        resolve(parsed);
      });
  });

  const cmd = args.variables && args.variables.ffmpegCommand;
  const workingFile = args.inputFileObj._id;
  const originalFile = (args.originalLibraryFile && args.originalLibraryFile._id) || workingFile;
  const nameBase = (args.originalLibraryFile && args.originalLibraryFile.fileNameWithoutExtension)
    || getFileName(originalFile);

  const outDir = getPluginWorkDir(args);
  const outputFilePath = `${outDir}/${getFileName(workingFile)}.mkv`;

  const spawnArgs = ['-o', outputFilePath, '--no-global-tags', '--title', ''];

  if (mode === 'combine') {
    const audioSubsFile = path.join(String(args.inputs.audioSubsDir), `${nameBase}-audiosubs.mkv`);
    if (!fs.existsSync(audioSubsFile)) {
      throw new Error(`mkvmerge Execute: the audio+subs file ${audioSubsFile} does not exist`);
    }
    spawnArgs.push('--no-audio', '--no-subtitles', '--no-attachments', workingFile, '--no-video', audioSubsFile);
    args.jobLog(`mkvmerge Execute (combine): video from ${workingFile}, audio and subtitles from ${audioSubsFile}`);
  } else {
    if (!cmd || !Array.isArray(cmd.streams)) {
      throw new Error('mkvmerge Execute: no ffmpeg command in progress, place this after Begin Command');
    }
    const inputFile = source === 'original' ? originalFile : workingFile;
    const identified = await identify(inputFile);
    const map = mapTracks(cmd.streams, identified);

    const keptIds = (type) => map[type].filter((m) => !m.stream.removed).map((m) => m.track.id);
    if (mode === 'video') {
      if (map.video.length === 0) throw new Error(`mkvmerge Execute: ${inputFile} has no video track`);
      spawnArgs.push('--video-tracks', String(map.video[0].track.id), '--no-audio', '--no-subtitles',
        '--no-attachments');
    } else {
      const video = mode === 'audioSubs' ? [] : keptIds('video');
      const audio = keptIds('audio');
      const subs = keptIds('subtitle');
      spawnArgs.push(...trackArgs('--video-tracks', '--no-video', video));
      spawnArgs.push(...trackArgs('--audio-tracks', '--no-audio', audio));
      spawnArgs.push(...trackArgs('--subtitle-tracks', '--no-subtitles', subs));
      const attachments = cmd.streams.filter((s) => s.codec_type === 'attachment');
      const keepAttachments = attachments.length > 0 && attachments.every((s) => !s.removed);
      if (!keepAttachments) {
        spawnArgs.push('--no-attachments');
        if (attachments.some((s) => !s.removed)) {
          args.jobLog('mkvmerge Execute: only some attachments are kept in the command, but mkvmerge Execute keeps all '
            + 'or none. None are kept.');
        }
      }
    }
    spawnArgs.push(inputFile);

    const ignored = [];
    cmd.streams.forEach((s) => {
      if (!s.removed && (s.outputArgs || []).some((a) => String(a).trim() !== '')) ignored.push(`stream #${s.index}`);
    });
    if ((cmd.overallOuputArguments || []).length > 0) ignored.push('overall output arguments');
    if ((cmd.overallInputArguments || []).length > 0) ignored.push('overall input arguments');
    if (ignored.length > 0) {
      args.jobLog(`mkvmerge Execute: ffmpeg-only arguments cannot be given to mkvmerge and are ignored: `
        + `${ignored.join(', ')}`);
    }

    const summary = TYPES.map((t) => `${t.label}: ${map[t.plan].map((m) => `${m.track.id}${m.stream.removed ? 'x' : ''}`)
      .join(',') || '-'}`).join('; ');
    args.jobLog(`mkvmerge Execute (${mode}, ${source}): ${inputFile} track ids (x = removed) ${summary}`);
  }

  args.jobLog(`mkvmerge Execute: ${bin} ${spawnArgs.map((a) => (a === '' ? '""' : a)).join(' ')}`);

  // The arguments go to mkvmerge through a JSON options file (`mkvmerge @file`), not on the command line. Tdarr's CLI
  // helper drops an empty-string argument, so `--title ""` arrived as a bare `--title` and mkvmerge took the next
  // option as the title (job log 2026-11-09: "The file '0' could not be opened"). A file keeps every argument exactly,
  // the empty title and paths with spaces included.
  const optionsFile = `${outDir}/mkvmerge-options.json`;
  fs.writeFileSync(optionsFile, JSON.stringify(spawnArgs), 'utf8');

  const cli = new CLI({
    cli: bin,
    spawnArgs: [`@${optionsFile}`],
    spawnOpts: { env },
    jobLog: args.jobLog,
    outputFilePath,
    inputFileObj: args.inputFileObj,
    logFullCliOutput: args.logFullCliOutput,
    updateWorker: args.updateWorker,
    args,
  });

  // Tdarr's CLI helper only reads progress from ffmpeg, HandBrake and a few other encoders (it goes by the program
  // name), so mkvmerge showed no percentage and the step looked hung. mkvmerge prints "Progress: N%" while it works;
  // pass that on to the worker. This relies on the helper calling its parseOutput member for each chunk of output and
  // having an updateETA member for the ETA (read on Tdarr master, not checked against the installed version). If the
  // helper has no such members the percentage is still sent without an ETA, or nothing happens; the remux itself is
  // never affected.
  const originalParse = cli.parseOutput;
  let lastPercent = -1;
  cli.parseOutput = (data) => {
    try {
      if (typeof originalParse === 'function') originalParse.call(cli, data);
      const found = [...String(data).matchAll(/Progress:\s*(\d{1,3})%/g)];
      if (found.length === 0) return;
      const percentage = Math.min(100, Number(found[found.length - 1][1]));
      if (percentage <= lastPercent) return;
      lastPercent = percentage;
      if (percentage > 0 && typeof args.updateWorker === 'function') {
        args.updateWorker({ percentage });
        if (typeof cli.updateETA === 'function') Promise.resolve(cli.updateETA(percentage)).catch(() => {});
      }
    } catch (e) {
      // progress is cosmetic: never let it break the remux
    }
  };

  const res = await cli.runCli();

  try {
    fs.unlinkSync(optionsFile);
  } catch (e) {
    args.jobLog(`mkvmerge Execute: could not remove ${optionsFile}: ${e.message}`);
  }

  if (res.cliExitCode === 1 && !cli.cancelled) {
    args.jobLog('mkvmerge Execute: mkvmerge finished with warnings');
  } else if (res.cliExitCode !== 0) {
    args.jobLog('mkvmerge Execute: mkvmerge failed');
    throw new Error('mkvmerge Execute: mkvmerge failed');
  }
  if (!fs.existsSync(outputFilePath) || fs.statSync(outputFilePath).size === 0) {
    throw new Error(`mkvmerge Execute: mkvmerge reported success but ${outputFilePath} is missing or empty`);
  }

  if (cmd) cmd.init = false;

  return { outputFileObj: { _id: outputFilePath }, outputNumber: 1, variables: args.variables };
};

module.exports = { details, plugin };
