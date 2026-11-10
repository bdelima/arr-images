/* eslint-disable no-await-in-loop */
// Run VMAF Quality Check: scores the working file (the encode) against the original library file with the CUDA VMAF
// build on naples (ffmpeg-vmaf-cuda), one run at a time under a lock file, and fails the job when the mean score is
// below the minimum.
//
// It replaces the four Run CLI nodes the Validator flow used (a /bin/sh -c script each). Tdarr's CLI helper only reads
// progress from ffmpeg, HandBrake and a few other encoders (it goes by the program name), so a /bin/sh step showed no
// progress and looked hung for the 10 to 15 minutes a 2 hour file takes. This plugin starts `flock <lock> ffmpeg-vmaf-cuda`
// itself, reads the `time=` of ffmpeg's statistics lines and sends it to the worker as a percentage.
//
// The score is worked out here instead of by grep/sed/awk: the mean, min and harmonic mean come from libvmaf's
// pooled_metrics, p1 (the 1st percentile of the per-frame scores, linear interpolation between the two nearest frames)
// from the sorted per-frame scores, exactly as the shell did. The job log gets the same line as before:
//   VMAF score: mean=.. min=.. harmonic_mean=.. p1=.. n=..
// and the Flow Variables vmafMean, vmafMin and vmafP1 are set, which Tag Output Metadata writes into the TDARR_VMAF_SCORE tag.

const details = () => ({
  name: 'Run VMAF Quality Check',
  description: 'Scores the working file against the original library file with ffmpeg-vmaf-cuda (one run at a time under a '
    + 'lock file), shows progress in the Tdarr worker, logs "VMAF score: mean= min= harmonic_mean= p1= n=", sets the Flow '
    + 'Variables vmafMean, vmafMin and vmafP1, and fails the job when the mean is below the minimum or ffmpeg fails. '
    + 'Choose the pixel format (yuv420p or yuv420p10le) and the model (the default one or the 4K one) per node.',
  style: {
    borderColor: 'green',
  },
  tags: '',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      name: 'pixelFormat',
      type: 'string',
      defaultValue: 'yuv420p',
      inputUI: { type: 'dropdown', options: ['yuv420p', 'yuv420p10le'] },
      tooltip: 'Pixel format both videos are converted to on the GPU before scoring (scale_cuda). Use yuv420p10le for 10-bit video.',
    },
    {
      name: 'model',
      type: 'string',
      defaultValue: 'default',
      inputUI: { type: 'dropdown', options: ['default', 'vmaf_4k_v0.6.1'] },
      tooltip: 'VMAF model. default is libvmaf\'s built-in model (vmaf_v0.6.1); vmaf_4k_v0.6.1 is the 4K model.',
    },
    {
      name: 'minMean',
      type: 'number',
      defaultValue: '93',
      inputUI: { type: 'text' },
      tooltip: 'The job fails when the mean VMAF score is below this.',
    },
    {
      name: 'ffmpegPath',
      type: 'string',
      defaultValue: '/usr/local/bin/ffmpeg-vmaf-cuda',
      inputUI: { type: 'text' },
      tooltip: 'The CUDA VMAF ffmpeg build (from the tdarr-vmaf-cuda overlay).',
    },
    {
      name: 'flockPath',
      type: 'string',
      defaultValue: 'flock',
      inputUI: { type: 'text' },
      tooltip: 'flock, found on the PATH unless a full path is given.',
    },
    {
      name: 'lockFile',
      type: 'string',
      defaultValue: '/temp/vmaf-cuda.lock',
      inputUI: { type: 'text' },
      tooltip: 'Only one VMAF run holds this lock at a time (there is one GPU); others wait for it.',
    },
    {
      name: 'tempDir',
      type: 'string',
      defaultValue: '/temp',
      inputUI: { type: 'text' },
      tooltip: 'Where libvmaf writes its per-frame JSON log while scoring; the file is removed afterwards. Letters, digits, / . _ - only.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'VMAF mean is at or above the minimum' },
  ],
});

const num = (s) => Number(String(s).trim());

// Reads libvmaf's JSON log (pretty printed: one `"vmaf": <number>` line per frame, then pooled_metrics) without loading
// the whole file: a 2 hour 50 fps file has about 400,000 frames.
const readVmafLog = async (file) => {
  const fs = require('fs');
  const readline = require('readline');
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const frames = [];
  const pooled = {};
  let inPooled = false;
  let inVmaf = false;
  for await (const line of rl) {
    if (!inPooled) {
      const m = line.match(/^\s*"vmaf"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,?\s*$/);
      if (m) {
        frames.push(Number(m[1]));
      } else if (/^\s*"pooled_metrics"\s*:/.test(line)) {
        inPooled = true;
      }
    } else if (!inVmaf) {
      if (/^\s*"vmaf"\s*:\s*\{/.test(line)) inVmaf = true;
    } else {
      if (/^\s*\}/.test(line)) break;
      const kv = line.match(/^\s*"(min|max|mean|harmonic_mean)"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
      if (kv) pooled[kv[1]] = Number(kv[2]);
    }
  }
  rl.close();
  stream.destroy();
  return { frames, pooled };
};

const percentile = (sorted, p) => {
  // p in percent; same interpolation as the shell: position (n-1)*p/100 between the two nearest sorted values
  const pos = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = pos === lo ? lo : lo + 1;
  return pos === lo ? sorted[lo] : sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo);
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const fs = require('fs');
  const path = require('path');
  const { CLI } = require('../../../../FlowHelpers/1.0.0/cliUtils');

  const log = (m) => args.jobLog(`Run VMAF: ${m}`);
  const fail = (m) => { throw new Error(`Run VMAF Quality Check: ${m}`); };

  const pixelFormat = String(args.inputs.pixelFormat).trim();
  const model = String(args.inputs.model).trim();
  const minMean = num(args.inputs.minMean);
  const ffmpegPath = String(args.inputs.ffmpegPath).trim();
  const flockPath = String(args.inputs.flockPath).trim();
  const lockFile = String(args.inputs.lockFile).trim();
  const tempDir = String(args.inputs.tempDir).trim().replace(/\/+$/, '') || '/';

  if (!['yuv420p', 'yuv420p10le'].includes(pixelFormat)) fail(`unknown pixel format "${pixelFormat}"`);
  if (!['default', 'vmaf_4k_v0.6.1'].includes(model)) fail(`unknown model "${model}"`);
  if (!Number.isFinite(minMean)) fail(`minimum mean "${args.inputs.minMean}" is not a number`);
  // the log path is written into ffmpeg's filter graph, where ':' ',' ';' quotes and spaces are special
  if (!/^[A-Za-z0-9_./-]+$/.test(tempDir)) fail(`tempDir "${tempDir}" may only contain letters, digits, / . _ -`);

  const reference = args.originalLibraryFile && args.originalLibraryFile._id;
  const distorted = args.inputFileObj._id;
  if (!reference || !fs.existsSync(reference)) fail(`the original file ${reference} does not exist on this node`);
  if (!fs.existsSync(distorted)) fail(`the working file ${distorted} does not exist on this node`);
  if (!fs.existsSync(ffmpegPath)) fail(`${ffmpegPath} does not exist on this node (is the tdarr-vmaf-cuda overlay installed?)`);
  if (path.isAbsolute(flockPath)) {
    if (!fs.existsSync(flockPath)) fail(`${flockPath} does not exist on this node`);
  } else if (!String(process.env.PATH || '').split(':').some((d) => d && fs.existsSync(path.join(d, flockPath)))) {
    fail(`${flockPath} was not found on the PATH`);
  }

  const vmafLog = `${tempDir}/vmaf-${process.pid}-${Date.now()}.json`;
  const modelPart = model === 'default' ? '' : `model=version=${model}:`;
  const filter = `[0:v]scale_cuda=format=${pixelFormat}[ref];[1:v]scale_cuda=format=${pixelFormat}[dist];`
    + `[dist][ref]libvmaf_cuda=${modelPart}log_path=${vmafLog}:log_fmt=json`;
  const ffArgs = [
    '-xerror', '-stats_period', '5',
    '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-i', reference,
    '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-i', distorted,
    '-an', '-filter_complex', filter, '-f', 'null', '-',
  ];

  // length of the video in seconds, for the percentage
  const durationOf = () => {
    const probe = args.inputFileObj.ffProbeData || {};
    const fromFormat = Number(probe.format && probe.format.duration);
    if (fromFormat > 0) return fromFormat;
    const video = (probe.streams || []).find((s) => s.codec_type === 'video' && Number(s.duration) > 0);
    if (video) return Number(video.duration);
    const fromMeta = Number(args.inputFileObj.meta && args.inputFileObj.meta.Duration);
    return fromMeta > 0 ? fromMeta : 0;
  };
  const duration = durationOf();

  log(`${model === 'default' ? 'default model' : model}, ${pixelFormat}, minimum mean ${minMean}; `
    + `${distorted} against ${reference}${duration > 0 ? '' : ' (duration unknown, so no percentage)'}`);
  log(`waiting for ${lockFile} if another VMAF run holds it, then ${ffmpegPath} runs`);

  // The helper's updateETA stats outputFilePath on every progress tick and sends the worker that file's size and an estimated
  // final size (size / percentage, kept from the first tick unless the size changes), which the worker shows as the C: and T:
  // figures. This step writes no output file (ffmpeg runs with -f null), so it must not name the working file there: a finished
  // file would be read as a growing output and show nonsense like C:5000%. A path that never exists makes the helper send 0.
  const noOutputFile = `${vmafLog}.no-output-file`;
  const cli = new CLI({
    cli: flockPath,
    spawnArgs: [lockFile, ffmpegPath, ...ffArgs],
    spawnOpts: {},
    jobLog: args.jobLog,
    outputFilePath: noOutputFile,
    inputFileObj: args.inputFileObj,
    logFullCliOutput: args.logFullCliOutput,
    updateWorker: args.updateWorker,
    args,
  });

  // Progress: ffmpeg prints "frame=  123 fps= 45 q=-0.0 size=N/A time=00:00:05.12 bitrate=N/A speed=1.5x" every 5 s.
  // This relies on Tdarr's CLI helper calling its parseOutput member for each chunk of output and having an updateETA
  // member (read on Tdarr master; on naples the worker row does show the percentage and fps). Without them the score is
  // still produced, only the percentage is missing. The helper itself recognises ffmpeg by program name only, so it does
  // nothing here.
  const startedAt = Date.now();
  const originalParse = cli.parseOutput;
  let scoring = false;
  let lastPercent = -1;
  cli.parseOutput = (data) => {
    try {
      if (typeof originalParse === 'function') originalParse.call(cli, data);
      const text = String(data);
      const times = [...text.matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
      if (times.length === 0) return;
      if (!scoring) {
        scoring = true;
        log(`scoring started after ${Math.round((Date.now() - startedAt) / 1000)} s of waiting for the lock`);
      }
      if (!(duration > 0)) return;
      const t = times[times.length - 1];
      const seconds = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
      const percentage = Math.min(99, Math.floor((100 * seconds) / duration));
      if (percentage <= lastPercent) return;
      lastPercent = percentage;
      const fps = [...text.matchAll(/fps=\s*([\d.]+)/g)];
      const update = { percentage };
      if (fps.length > 0) update.fps = Number(fps[fps.length - 1][1]);
      if (typeof args.updateWorker === 'function') {
        args.updateWorker(update);
        if (typeof cli.updateETA === 'function') Promise.resolve(cli.updateETA(percentage)).catch(() => {});
      }
    } catch (e) {
      // progress is cosmetic: never let it break the scoring
    }
  };

  let res;
  try {
    res = await cli.runCli();
    if (res.cliExitCode !== 0) {
      log(`ffmpeg-vmaf-cuda failed with exit ${res.cliExitCode}`);
      fail(`ffmpeg-vmaf-cuda failed with exit ${res.cliExitCode}`);
    }
    if (!fs.existsSync(vmafLog)) fail(`ffmpeg-vmaf-cuda finished but wrote no log at ${vmafLog}`);

    const { frames, pooled } = await readVmafLog(vmafLog);
    if (frames.length === 0) fail(`no per-frame vmaf scores in ${vmafLog}`);

    const n = frames.length;
    const sorted = Float64Array.from(frames).sort();
    const mean = Number.isFinite(pooled.mean) ? pooled.mean : frames.reduce((a, b) => a + b, 0) / n;
    const min = Number.isFinite(pooled.min) ? pooled.min : sorted[0];
    const hmean = pooled.harmonic_mean;
    const p1 = percentile(sorted, 1);
    const f = (v) => (Number.isFinite(v) ? String(Number(v.toFixed(6))) : '');
    log(`VMAF score: mean=${f(mean)} min=${f(min)} harmonic_mean=${f(hmean)} p1=${f(p1)} n=${n}`);

    const round2 = (v) => Math.round(v * 100) / 100;
    args.variables = args.variables || {};
    args.variables.vmafMean = round2(mean);
    args.variables.vmafMin = round2(min);
    args.variables.vmafP1 = round2(p1);

    if (!(mean >= minMean)) {
      fail(`the mean VMAF score ${f(mean)} is below the minimum ${minMean}`);
    }
    if (typeof args.updateWorker === 'function') {
      try { args.updateWorker({ percentage: 100 }); } catch (e) { /* cosmetic */ }
    }
    return { outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables };
  } finally {
    try {
      fs.unlinkSync(vmafLog);
    } catch (e) {
      if (e.code !== 'ENOENT') log(`could not remove ${vmafLog}: ${e.message}`);
    }
  }
};

module.exports = { details, plugin };
