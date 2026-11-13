/* eslint-disable no-await-in-loop */
// Run VMAF Quality Check: scores the working file (the encode) against the original library file with the CUDA VMAF
// build on naples (ffmpeg-vmaf-cuda), one run at a time under a lock file, and checks the mean, the lowest frame (min) and
// the 1st percentile (p1) of the per-frame scores against their minimums.
//
// Outputs: 1 when every check passes, 2 when at least one check fails (the job log says which, with the score and the
// minimum). A failed quality check no longer throws, so the flow can decide what to do with the file; wire output 2 to Fail Flow
// to get the old behaviour (the job ends in error). Anything that stops a score from being produced still throws: ffmpeg
// failing, no log, a different number of video frames in the two files, missing files or tools, bad input values.
// Minimums: mean (default 93, as before), min (default 50) and p1 (default 70); min and p1 are off when set to 0.
//
// It replaces the four Run CLI nodes the Validator flow used (a /bin/sh -c script each). Tdarr's CLI helper only reads
// progress from ffmpeg, HandBrake and a few other encoders (it goes by the program name), so a /bin/sh step showed no
// progress and looked hung for the 10 to 15 minutes a 2 hour file takes. This plugin starts `flock <lock> ffmpeg-vmaf-cuda`
// itself, reads the `time=` of ffmpeg's statistics lines and sends it to the worker as a percentage.
//
// The score is worked out here instead of by grep/sed/awk: the mean, min and harmonic mean come from libvmaf's
// pooled_metrics, p1 (the 1st percentile of the per-frame scores, linear interpolation between the two nearest frames)
// from the sorted per-frame scores, exactly as the shell did. The job log gets the same line as before:
//   VMAF score: mean=.. min=.. harmonic_mean=.. p1=.. n=.. below60=.. below70=.. below75=..
// and the Flow Variables user.vmafMean, user.vmafMin, user.vmafP1 and user.vmafBelow are set, which Tag Output Metadata writes into the TDARR_VMAF_SCORE tag.
// The belowN figures count the frames whose VMAF score is under N, for each number in the countBelow input (default 60,70,75).
// They are only reported, never checked: a pass or a fail still depends on the mean, min and p1 minimums alone.
//
// Frame pairing: libvmaf's filter pairs a reference frame with a distorted frame by timestamp, not by position. Matroska
// timestamps are rounded to 1 ms, so at 23.976 fps (and other non-integer rates) two files with the same frames can carry
// slightly different timestamps, and some frames get paired with a neighbour. That shows up as isolated frames scoring far
// too low (down to 0.00) in a clean encode. Measured on the same two files (S01E08, 32,384 frames): the unchanged graph gave
// mean 92.822, min 0.000 and 838 frames below 50; with both inputs re-timestamped from the frame number (setpts=N/(fps*TB))
// it gave mean 96.137, min 73.383 and none below 50. So both inputs are re-timestamped from the frame number at the
// reference's frame rate before scoring. This assumes the two files hold the same frames in the same order (an encode of the
// reference, which is what this step is for) and a constant frame rate. The 1 ms rounding is the likely cause, not proven.
//
// Frame count: because frames are paired by number, a file with a different number of video frames than the original would be
// compared against the wrong frames from the point where they drift apart, and the score would mean nothing. Before taking the
// GPU lock this plugin counts the video packets of both files with ffprobe (one packet per frame in Matroska, no decoding) and
// fails the job when the counts differ, so a mismatch costs a read of both files instead of a full scoring run. If the count
// itself cannot be made (no ffprobe, a timeout), a warning goes to the job log and scoring goes ahead as before.

const details = () => ({
  name: 'Run VMAF Quality Check',
  description: 'Scores the working file against the original library file with ffmpeg-vmaf-cuda (one run at a time under a '
    + 'lock file), shows progress in the Tdarr worker, logs "VMAF score: mean= min= harmonic_mean= p1= n=" followed by the number of '
    + 'frames below each score in Count frames below, sets the Flow '
    + 'Variables user.vmafMean, user.vmafMin, user.vmafP1 and user.vmafBelow, and checks the mean, the lowest frame (min) and the 1st '
    + 'percentile (p1) against their minimums: output 1 when all pass, output 2 when any fails. It still fails the job when '
    + 'ffmpeg fails or no score can be produced. '
    + 'Before scoring it counts the video frames of both files and fails the job when they differ. '
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
      tooltip: 'The quality check fails (output 2) when the mean VMAF score is below this.',
    },
    {
      name: 'minFrameScore',
      type: 'number',
      defaultValue: '50',
      inputUI: { type: 'text' },
      tooltip: 'The quality check fails (output 2) when the lowest single-frame VMAF score (min) is below this. 0 = not checked. '
        + 'Uncalibrated starting value.',
    },
    {
      name: 'minP1',
      type: 'number',
      defaultValue: '70',
      inputUI: { type: 'text' },
      tooltip: 'The quality check fails (output 2) when the 1st percentile of the per-frame VMAF scores (p1) is below this. '
        + '0 = not checked. Uncalibrated starting value.',
    },
    {
      name: 'countBelow',
      label: 'Count frames below',
      type: 'string',
      defaultValue: '60,70,75',
      inputUI: { type: 'text' },
      tooltip: 'VMAF scores to count frames below: numbers above 0 up to 100, separated by commas, at most 8 (default 60,70,75). '
        + 'The job log gets belowN=<frames scoring under N> after n=, in ascending order, and Tag Output Metadata adds the same '
        + 'figures to TDARR_VMAF_SCORE. The counts are only reported; they do not change which output the file leaves through. '
        + 'Empty = not counted.',
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
    { number: 1, tooltip: 'All checks passed: mean, min and p1 are at or above their minimums' },
    { number: 2, tooltip: 'At least one check failed: the mean, min or p1 is below its minimum (the job log says which)' },
  ],
});

const num = (s) => Number(String(s).trim());

// "60,70,75" -> [60, 70, 75]: numbers above 0 up to 100, ascending, no duplicates, at most 8. Empty gives []. Anything else
// gives { error } (the plugin fails the job on a bad input value, as it does for the minimums).
const parseCountBelow = (text) => {
  const raw = String(text === undefined || text === null ? '' : text).trim();
  if (raw === '') return [];
  const parts = raw.split(',').map((p) => p.trim());
  const values = [];
  for (let i = 0; i < parts.length; i += 1) {
    const v = /^\d+(\.\d+)?$/.test(parts[i]) ? Number(parts[i]) : NaN;
    if (!(v > 0 && v <= 100)) return { error: `"${parts[i]}" is not a number above 0 up to 100` };
    values.push(v);
  }
  const list = values.filter((v, i) => values.indexOf(v) === i).sort((a, b) => a - b);
  if (list.length > 8) return { error: `${list.length} scores listed, at most 8 are counted` };
  return list;
};

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

// ffprobe names to try, most likely first: the sibling of Tdarr's own ffmpeg ("tdarr-ffmpeg" gives "tdarr-ffprobe"), then the
// usual names on the PATH. One that is not there is skipped.
const ffprobeCandidates = (tdarrFfmpegPath) => {
  const path = require('path');
  const list = [];
  if (tdarrFfmpegPath) {
    const base = path.basename(String(tdarrFfmpegPath));
    if (/ffmpeg/i.test(base)) {
      const dir = path.dirname(String(tdarrFfmpegPath));
      const sibling = base.replace(/ffmpeg/i, 'ffprobe');
      list.push(dir === '.' ? sibling : path.join(dir, sibling));
    }
  }
  list.push('tdarr-ffprobe', 'ffprobe');
  return list.filter((c, i) => list.indexOf(c) === i);
};

// Number of packets in the first video stream of a file ({ frames, tool } or { error }). Reads the whole file once without
// decoding it. Matroska stores one frame per block, so packets are frames; a container with a different layout would need
// another way to count.
const countVideoFrames = async ({ tdarrFfmpegPath, file, timeoutMs }) => {
  const { spawn } = require('child_process');
  const candidates = ffprobeCandidates(tdarrFfmpegPath);
  const errors = [];
  for (let c = 0; c < candidates.length; c += 1) {
    const tool = candidates[c];
    // eslint-disable-next-line no-await-in-loop
    const outcome = await new Promise((resolve) => {
      let child;
      let out = '';
      let err = '';
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
        finish({ error: `timed out after ${Math.round(timeoutMs / 1000)} s` });
      }, timeoutMs);
      try {
        child = spawn(tool, ['-v', 'error', '-count_packets', '-select_streams', 'v:0',
          '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]);
      } catch (e) {
        finish({ error: `could not start: ${e.message}`, missing: true });
        return;
      }
      child.on('error', (e) => finish({ error: e.code === 'ENOENT' ? 'not found' : e.message, missing: e.code === 'ENOENT' }));
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { if (err.length < 400) err += d.toString(); });
      child.on('close', (code) => {
        const frames = Number(out.trim().split('\n')[0]);
        if (code !== 0) finish({ error: `exit code ${code}${err ? ` (${err.trim().slice(0, 200)})` : ''}` });
        else if (!Number.isInteger(frames) || frames <= 0) finish({ error: `unreadable output "${out.trim().slice(0, 80)}"` });
        else finish({ frames });
      });
    });
    if (outcome.frames !== undefined) return { frames: outcome.frames, tool };
    errors.push(`${tool}: ${outcome.error}`);
    if (!outcome.missing) break; // the tool ran and failed: another ffprobe will not fare better
  }
  return { error: errors.join('; ') };
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
  const minFrameScore = num(args.inputs.minFrameScore);
  const minP1 = num(args.inputs.minP1);
  const ffmpegPath = String(args.inputs.ffmpegPath).trim();
  const flockPath = String(args.inputs.flockPath).trim();
  const lockFile = String(args.inputs.lockFile).trim();
  const tempDir = String(args.inputs.tempDir).trim().replace(/\/+$/, '') || '/';

  if (!['yuv420p', 'yuv420p10le'].includes(pixelFormat)) fail(`unknown pixel format "${pixelFormat}"`);
  if (!['default', 'vmaf_4k_v0.6.1'].includes(model)) fail(`unknown model "${model}"`);
  if (!Number.isFinite(minMean)) fail(`minimum mean "${args.inputs.minMean}" is not a number`);
  if (!Number.isFinite(minFrameScore)) fail(`minimum frame score "${args.inputs.minFrameScore}" is not a number`);
  if (!Number.isFinite(minP1)) fail(`minimum p1 "${args.inputs.minP1}" is not a number`);
  const countBelow = parseCountBelow(args.inputs.countBelow);
  if (!Array.isArray(countBelow)) fail(`Count frames below "${args.inputs.countBelow}": ${countBelow.error}`);
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

  // Frame rate of the first video stream as an exact fraction ("24000/1001"), from the probe data Tdarr already holds.
  const frameRateOf = (fileObj) => {
    const video = ((fileObj && fileObj.ffProbeData && fileObj.ffProbeData.streams) || []).find((s) => s.codec_type === 'video');
    if (!video) return null;
    for (const text of [video.avg_frame_rate, video.r_frame_rate]) {
      const m = String(text || '').trim().match(/^(\d+)(?:\/(\d+))?$/);
      if (m) {
        const rateNum = Number(m[1]);
        const rateDen = m[2] === undefined ? 1 : Number(m[2]);
        if (rateNum > 0 && rateDen > 0) return { num: rateNum, den: rateDen, text: `${rateNum}/${rateDen}`, fps: rateNum / rateDen };
      }
    }
    return null;
  };
  const refRate = frameRateOf(args.originalLibraryFile);
  const distRate = frameRateOf(args.inputFileObj);
  const rate = refRate || distRate;
  if (!rate) fail('could not read the frame rate of the original or the working file from their probe data');
  if (!refRate) log(`the original file has no usable frame rate in its probe data; using the working file's ${rate.text}`);
  if (refRate && distRate && Math.abs(refRate.fps - distRate.fps) / refRate.fps > 0.001) {
    log(`warning: the original runs at ${refRate.text} fps and the working file at ${distRate.text}; frames are paired by position, so a frame rate change will lower the score`);
  }

  // Same number of video frames in both files, or there is nothing meaningful to score (see the header). Done before the lock
  // so that waiting for another run's GPU time is not spent on a file that cannot be scored.
  {
    const countStarted = Date.now();
    const [refCount, distCount] = await Promise.all([reference, distorted].map((file) => countVideoFrames({
      tdarrFfmpegPath: args.ffmpegPath, file, timeoutMs: 30 * 60 * 1000,
    })));
    if (refCount.error || distCount.error) {
      log(`warning: could not compare frame counts (original: ${refCount.error || refCount.frames}; working file: ${distCount.error || distCount.frames}); scoring anyway`);
    } else if (refCount.frames !== distCount.frames) {
      const diff = distCount.frames - refCount.frames;
      log(`frame counts differ: original ${refCount.frames}, working file ${distCount.frames} (${diff > 0 ? '+' : ''}${diff})`);
      fail(`the original has ${refCount.frames} video frames and the working file has ${distCount.frames}; frames are paired by number, so `
        + 'a score would not mean anything. Not running VMAF.');
    } else {
      log(`both files have ${refCount.frames} video frames (counted in ${Math.round((Date.now() - countStarted) / 100) / 10} s)`);
    }
  }

  const vmafLog = `${tempDir}/vmaf-${process.pid}-${Date.now()}.json`;
  const modelPart = model === 'default' ? '' : `model=version=${model}:`;
  // setpts gives both inputs timestamps computed from the frame number, so libvmaf pairs frame N with frame N (see the header)
  const retime = `setpts=N*${rate.den}/(${rate.num}*TB)`;
  const filter = `[0:v]${retime},scale_cuda=format=${pixelFormat}[ref];[1:v]${retime},scale_cuda=format=${pixelFormat}[dist];`
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

  log(`${model === 'default' ? 'default model' : model}, ${pixelFormat}, frames paired by number at ${rate.text} fps, minimum mean ${minMean}, min ${minFrameScore > 0 ? minFrameScore : 'not checked'}, p1 ${minP1 > 0 ? minP1 : 'not checked'}; `
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
    // frames scoring under each listed number (strictly below), counted from the per-frame scores
    const belowParts = countBelow.map((t) => `below${t}=${frames.reduce((c, v) => (v < t ? c + 1 : c), 0)}`);
    log(`VMAF score: mean=${f(mean)} min=${f(min)} harmonic_mean=${f(hmean)} p1=${f(p1)} n=${n}`
      + `${belowParts.length > 0 ? ` ${belowParts.join(' ')}` : ''}`);

    const round2 = (v) => Math.round(v * 100) / 100;
    // Tag Output Metadata reads these from args.variables.user, the same place the step trail lives. They used to be set
    // directly on args.variables, where Tag Output Metadata never looked, so TDARR_VMAF_SCORE could not be written.
    args.variables = args.variables || {};
    if (!args.variables.user) args.variables.user = {};
    args.variables.user.vmafMean = round2(mean);
    args.variables.user.vmafMin = round2(min);
    args.variables.user.vmafP1 = round2(p1);
    if (belowParts.length > 0) args.variables.user.vmafBelow = belowParts.join(';');
    else delete args.variables.user.vmafBelow;

    // Quality checks: every check that fails is listed, then the file leaves through output 2 (see the header).
    const failedChecks = [];
    if (!(mean >= minMean)) failedChecks.push(`mean ${f(mean)} is below the minimum ${minMean}`);
    if (minFrameScore > 0 && !(min >= minFrameScore)) failedChecks.push(`min ${f(min)} is below the minimum ${minFrameScore}`);
    if (minP1 > 0 && !(p1 >= minP1)) failedChecks.push(`p1 ${f(p1)} is below the minimum ${minP1}`);

    if (typeof args.updateWorker === 'function') {
      try { args.updateWorker({ percentage: 100 }); } catch (e) { /* cosmetic */ }
    }
    if (failedChecks.length > 0) {
      log(`quality check FAILED (${failedChecks.length} of 3): ${failedChecks.join('; ')}; leaving through output 2`);
      return { outputFileObj: args.inputFileObj, outputNumber: 2, variables: args.variables };
    }
    log('quality check passed: mean'
      + `${minFrameScore > 0 ? ', min' : ''}${minP1 > 0 ? ', p1' : ''} at or above their minimums; leaving through output 1`);
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
