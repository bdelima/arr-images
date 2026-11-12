/**
 * Set Source-Relative Bitrate — Local Flow Plugin
 *
 * Adds a bitrate target and ceiling, computed per file from the source's own video bitrate, to every video
 * stream "Set Video Encoder" queued for a Quick Sync (QSV) encode. Place it directly after Set Video Encoder.
 *
 * Why the three flags together: on hevc_qsv, -global_quality alone selects Intel ICQ (constant quality, no
 * ceiling). Adding -maxrate by itself drops out of ICQ into CQP and caps nothing. Setting -b:v and a
 * different -maxrate on top of -global_quality selects QVBR (quality target plus a bitrate ceiling). This was
 * checked on both encode hosts (ojochal and drakebay) with the encoder's own verbose log. If -maxrate equals
 * -b:v the encoder picks CBR instead, so this plugin never lets them be equal.
 *
 *   -b:v      = source video AVERAGE bitrate x "Target percent"
 *   -maxrate  = "Ceiling percent" of either the source's measured PEAK bitrate (default) or its average
 *   -bufsize  = -maxrate x "Buffer multiplier"
 *
 * Why a measured peak: -maxrate bounds the bitrate over any window as long as the buffer, while the source's
 * average is a mean over the whole file. Basing the ceiling on the average made it tighter than anything the
 * source itself did in its busy scenes (F1 race, 2026-11-10: ceiling 6142 kbps = the source's average, VMAF mean
 * 95.8 but p1 76). With "Ceiling based on" = peak the plugin reads the source video's packet sizes with ffprobe
 * (no decoding), sums them in sliding windows of "Peak window seconds" (default 2 s, the length of the buffer
 * the encoder is given: -bufsize / -maxrate with the default multiplier of 2) and takes the "Peak percentile"
 * (default 100 = the busiest window) of the window bitrates. If the scan cannot be done (no ffprobe, timeout,
 * unreadable output, file shorter than three windows) the ceiling falls back to the same percentage of the
 * average, which is what this plugin did before, and the job log says so.
 *
 * Which files get the cap: only sources below "Cap only below this source bits per pixel" (default 0.07). The
 * source's bits per pixel is the Flow Variable tdarrSourceBpp that Check Source Efficiency sets (video bitrate /
 * (width x height x fps)), so that node has to run before this one and be enabled. A source starved of bits (the
 * 1080p50 F1 download, 0.059) grows to 233%-301% of its size at plain ICQ 18, which the cap prevents; a source at or
 * above the threshold (The Boroughs S01E03, 0.095) shrinks at plain ICQ and the cap only holds back quality it needs
 * (the 70% target left a mean VMAF of 74 over its 90-second title sequence, plain ICQ 18 gave 98). At or above the
 * threshold nothing is added and the encode stays plain ICQ, but the source's peak bitrate is still measured and
 * recorded (Flow Variable tdarrSourcePeakKbps, TDARR_SOURCE_PEAK_KBPS), because the scan runs for every QSV encode
 * before this decision. When the figure is missing (Check Source Efficiency off or unable to measure) the cap is
 * applied, as it was before this input existed. 0 = always apply the cap.
 *
 * Non-QSV encoders (anything whose -c value does not end in _qsv) are left alone: the mode behaviour above is
 * specific to QSV. If the source bitrate cannot be determined, nothing is added and the encode stays ICQ.
 * Any -b:v / -maxrate / -bufsize already on the stream (for example from Set Max Bitrate) is replaced when the cap
 * is applied, and left as it is when the bits-per-pixel check keeps the encode as plain ICQ.
 *
 * The source average comes from the stream object Set Video Encoder is working on (stream bit_rate, or the
 * BPS / NUMBER_OF_BYTES + DURATION tags), with the container bitrate minus audio as a last resort.
 */

const details = () => ({
  name: 'Set Source-Relative Bitrate',
  description: 'Adds -b:v / -maxrate / -bufsize as percentages of the source video bitrate to QSV '
    + 'encodes, switching hevc_qsv from ICQ to QVBR (quality target plus ceiling), for sources below a '
    + 'bits-per-pixel threshold (from Check Source Efficiency); sources at or above it stay plain ICQ. '
    + 'Place directly after Set Video Encoder.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Enable',
      name: 'enabled',
      type: 'boolean',
      defaultValue: 'true',
      inputUI: { type: 'switch' },
      tooltip: 'Off = leave the encode as plain ICQ (no cap).',
    },
    {
      label: 'Cap only below this source bits per pixel',
      name: 'capBelowBpp',
      type: 'number',
      defaultValue: '0.07',
      inputUI: { type: 'text' },
      tooltip: 'Source bits per pixel = video bitrate / (width x height x fps), set by Check Source Efficiency '
        + '(Flow Variable tdarrSourceBpp). A source below this gets the cap; a source at or above it is encoded as '
        + 'plain ICQ with no -b:v / -maxrate / -bufsize. If Check Source Efficiency has not measured it, the cap is '
        + 'applied. 0 = always apply the cap. Uncalibrated starting value: the 1080p50 F1 source (0.059) grew to '
        + '233-301% at plain ICQ 18, a 1080p24 source at 0.095 came out at 59% of the source video.',
    },
    {
      label: 'Target percent of source bitrate',
      name: 'targetPercent',
      type: 'number',
      defaultValue: '70',
      inputUI: { type: 'text' },
      tooltip: '-b:v as a percentage of the source video bitrate. Uncalibrated starting value.',
    },
    {
      label: 'Ceiling based on',
      name: 'ceilingBasis',
      type: 'string',
      defaultValue: 'peak',
      inputUI: { type: 'dropdown', options: ['peak', 'average'] },
      tooltip: 'peak = the source\'s measured peak bitrate (a packet scan with ffprobe, no decoding), '
        + 'average = the source\'s average bitrate. If the peak cannot be measured the ceiling uses the average.',
    },
    {
      label: 'Ceiling percent of that bitrate',
      name: 'ceilingPercent',
      type: 'number',
      defaultValue: '100',
      inputUI: { type: 'text' },
      tooltip: '-maxrate as a percentage of the source peak (or average, see "Ceiling based on"). '
        + '100 = never above the source. Uncalibrated starting value.',
    },
    {
      label: 'Peak window seconds',
      name: 'peakWindowSeconds',
      type: 'number',
      defaultValue: '2',
      inputUI: { type: 'text' },
      tooltip: 'Length of the sliding window the source bitrate is measured over. 2 matches the buffer the '
        + 'encoder gets (-bufsize / -maxrate with a buffer multiplier of 2). Used for the recorded peak and for a ceiling based on peak.',
    },
    {
      label: 'Peak percentile',
      name: 'peakPercentile',
      type: 'number',
      defaultValue: '100',
      inputUI: { type: 'text' },
      tooltip: 'Which window counts as the peak: 100 = the busiest window, 99.9 = ignore the busiest 0.1% of '
        + 'windows. Used for the recorded peak and for a ceiling based on peak.',
    },
    {
      label: 'Peak scan timeout seconds',
      name: 'peakScanTimeoutSeconds',
      type: 'number',
      defaultValue: '300',
      inputUI: { type: 'text' },
      tooltip: 'Give up on the packet scan after this long: no peak is recorded, and a ceiling based on peak uses the average instead.',
    },
    {
      label: 'Buffer multiplier',
      name: 'bufsizeMultiplier',
      type: 'number',
      defaultValue: '2',
      inputUI: { type: 'text' },
      tooltip: '-bufsize = -maxrate x this.',
    },
    {
      label: 'Minimum target kbps',
      name: 'minTargetKbps',
      type: 'number',
      defaultValue: '300',
      inputUI: { type: 'text' },
      tooltip: 'Floor for -b:v, so a very low-bitrate source is not squeezed to nothing.',
    },
    {
      label: 'Assumed audio kbps',
      name: 'assumedAudioKbps',
      type: 'number',
      defaultValue: '256',
      inputUI: { type: 'text' },
      tooltip: 'Only used when the video bitrate has to be derived from the container bitrate.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Continue to next plugin' },
  ],
});

const parseDurationSeconds = (raw) => {
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(String(raw || '').trim());
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

const tagValue = (tags, baseName) => {
  if (!tags) return undefined;
  const wanted = baseName.toUpperCase();
  const keys = Object.keys(tags);
  for (let i = 0; i < keys.length; i += 1) {
    const upper = keys[i].toUpperCase();
    if (upper === wanted || upper.startsWith(`${wanted}-`)) return tags[keys[i]];
  }
  return undefined;
};

const getVideoBitrate = (videoStream, probe, assumedAudioKbps) => {
  const direct = Number(videoStream.bit_rate);
  if (direct > 0) return { bps: direct, source: 'stream bit_rate' };

  const bpsTag = Number(tagValue(videoStream.tags, 'BPS'));
  if (bpsTag > 0) return { bps: bpsTag, source: 'stream tag BPS' };

  const bytes = Number(tagValue(videoStream.tags, 'NUMBER_OF_BYTES'));
  const secs = parseDurationSeconds(tagValue(videoStream.tags, 'DURATION'));
  if (bytes > 0 && secs > 0) return { bps: (bytes * 8) / secs, source: 'stream tags NUMBER_OF_BYTES / DURATION' };

  const containerBps = Number(probe && probe.format && probe.format.bit_rate);
  if (containerBps > 0) {
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    let audioBps = 0;
    for (let i = 0; i < streams.length; i += 1) {
      if (streams[i].codec_type === 'audio') {
        const own = Number(streams[i].bit_rate);
        audioBps += own > 0 ? own : assumedAudioKbps * 1000;
      }
    }
    const derived = containerBps - audioBps;
    if (derived > 0) return { bps: derived, source: 'container bit_rate minus audio' };
  }
  return { bps: 0, source: 'unknown' };
};

// Remove every "<flag> <value>" pair for the given flags from an outputArgs array (in place).
const stripPairs = (outputArgs, flags) => {
  for (let i = outputArgs.length - 2; i >= 0; i -= 1) {
    if (flags.includes(outputArgs[i])) outputArgs.splice(i, 2);
  }
};

/**
 * Turn the packets of one video stream into window bitrates. `feed(timeSeconds, sizeBytes)` is called once per
 * packet; `result(percentile)` then returns the average and the peak, or null if the stream is
 * shorter than three windows. Packet bytes are added to half-window bins, and a window is two neighbouring bins,
 * so the windows slide by half a window. The last bin is dropped because it is usually only partly filled.
 */
const makeWindowCollector = (windowSeconds) => {
  const binSeconds = windowSeconds / 2;
  const bins = new Map();
  let maxBin = -1;
  let totalBytes = 0;
  let packets = 0;
  let lastTime = 0;
  return {
    feed(time, size) {
      const bin = Math.max(0, Math.floor(time / binSeconds));
      bins.set(bin, (bins.get(bin) || 0) + size);
      if (bin > maxBin) maxBin = bin;
      if (time > lastTime) lastTime = time;
      totalBytes += size;
      packets += 1;
    },
    result(percentile) {
      if (maxBin < 2 || !(lastTime > 0)) return null;
      const rates = [];
      for (let i = 0; i < maxBin - 1; i += 1) {
        rates.push(((bins.get(i) || 0) + (bins.get(i + 1) || 0)) * 8 / windowSeconds);
      }
      rates.sort((a, b) => a - b);
      const pos = (Math.min(100, Math.max(0, percentile)) / 100) * (rates.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      const peakBps = rates[lo] + (rates[hi] - rates[lo]) * (pos - lo);
      return {
        packets,
        windows: rates.length,
        averageKbps: (totalBytes * 8) / lastTime / 1000,
        peakKbps: peakBps / 1000,
      };
    },
  };
};

// Possible ffprobe names, most likely first. The node's ffmpeg is "tdarr-ffmpeg" or a path to an "ffmpeg", so
// its sibling "ffprobe" is tried first. Each is tried in turn; one that is not there is skipped.
const ffprobeCandidates = (ffmpegPath) => {
  const path = require('path');
  const list = [];
  if (ffmpegPath) {
    const base = path.basename(String(ffmpegPath));
    if (/ffmpeg/i.test(base)) {
      const dir = path.dirname(String(ffmpegPath));
      const sibling = base.replace(/ffmpeg/i, 'ffprobe');
      list.push(dir === '.' ? sibling : path.join(dir, sibling));
    }
  }
  list.push('tdarr-ffprobe', 'ffprobe');
  return list.filter((c, i) => list.indexOf(c) === i);
};

/**
 * Read the packet sizes of one video stream with ffprobe and return the window statistics
 * ({ packets, windows, averageKbps, peakKbps, tool, seconds }) or { error }. Streams ffprobe's output instead of
 * buffering it, so a two-hour file does not need hundreds of megabytes of memory.
 */
const scanSourcePeak = async ({ ffmpegPath, file, streamIndex, windowSeconds, percentile, timeoutMs, env, spawn }) => {
  const candidates = ffprobeCandidates(ffmpegPath);
  const errors = [];
  for (let c = 0; c < candidates.length; c += 1) {
    const tool = candidates[c];
    const started = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const outcome = await new Promise((resolve) => {
      const collector = makeWindowCollector(windowSeconds);
      let child;
      let buffer = '';
      let lines = 0;
      let bad = 0;
      let settled = false;
      let stderr = '';
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const handleLine = (line) => {
        if (!line) return;
        lines += 1;
        // order ffprobe prints the entries in: pts_time, dts_time, size (checked in the test harness)
        const parts = line.split(',');
        const size = Number(parts[2]);
        let time = Number(parts[0]);
        if (!Number.isFinite(time)) time = Number(parts[1]);
        if (!Number.isFinite(time) || !(size >= 0) || parts.length !== 3) {
          bad += 1;
          return;
        }
        collector.feed(time, size);
      };
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
        finish({ error: `timed out after ${Math.round(timeoutMs / 1000)} s` });
      }, timeoutMs);
      try {
        child = spawn(tool, ['-v', 'error', '-select_streams', String(streamIndex), '-show_entries',
          'packet=pts_time,dts_time,size', '-of', 'csv=p=0', file], { env });
      } catch (e) {
        finish({ error: `could not start: ${e.message}`, missing: true });
        return;
      }
      child.on('error', (e) => finish({ error: e.code === 'ENOENT' ? 'not found' : e.message, missing: e.code === 'ENOENT' }));
      child.stderr.on('data', (d) => { if (stderr.length < 400) stderr += d.toString(); });
      child.stdout.on('data', (d) => {
        buffer += d.toString();
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
          handleLine(buffer.slice(0, nl).trim());
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf('\n');
        }
      });
      child.on('close', (code) => {
        handleLine(buffer.trim());
        if (code !== 0) {
          finish({ error: `exit code ${code}${stderr ? ` (${stderr.trim().slice(0, 200)})` : ''}` });
        } else if (lines === 0 || bad > lines * 0.01) {
          finish({ error: `unreadable output (${bad} of ${lines} lines could not be parsed)` });
        } else {
          const stats = collector.result(percentile);
          finish(stats ? { stats } : { error: 'the stream is shorter than three windows' });
        }
      });
    });
    if (outcome.stats) return { ...outcome.stats, tool, seconds: (Date.now() - started) / 1000 };
    errors.push(`${tool}: ${outcome.error}`);
    if (!outcome.missing) break; // the tool ran and failed: another ffprobe will not fare better
  }
  return { error: errors.join('; ') };
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const done = () => ({ outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables });

  if (args.inputs.enabled !== true) {
    args.jobLog('Set Source-Relative Bitrate: disabled, leaving the encode as ICQ');
    return done();
  }

  const streams = args.variables.ffmpegCommand.streams;
  const probe = args.inputFileObj && args.inputFileObj.ffProbeData;
  const {
    targetPercent, ceilingPercent, bufsizeMultiplier, minTargetKbps, assumedAudioKbps,
    peakWindowSeconds, peakPercentile, peakScanTimeoutSeconds,
  } = args.inputs;
  const wantPeak = String(args.inputs.ceilingBasis) !== 'average';
  // Bits-per-pixel gate (see the header). An input that is missing or not a number takes the default.
  const rawCap = args.inputs.capBelowBpp;
  const capBelowBpp = (rawCap === undefined || rawCap === null || rawCap === '' || !Number.isFinite(Number(rawCap)))
    ? 0.07 : Number(rawCap);
  const bppRaw = args.variables.user && args.variables.user.tdarrSourceBpp;
  const sourceBpp = (bppRaw === undefined || bppRaw === null || bppRaw === '') ? NaN : Number(bppRaw);
  const bppMeasured = Number.isFinite(sourceBpp) && sourceBpp > 0;
  const { spawn } = require('child_process');
  // A UTF-8 locale so ffprobe opens file names with accented or non-Latin characters (as in the other plugins).
  const env = { ...process.env, LC_ALL: 'C.UTF-8' };

  for (let i = 0; i < streams.length; i += 1) {
    const stream = streams[i];
    const codecArgIndex = stream.codec_type === 'video' ? stream.outputArgs.indexOf('-c:{outputIndex}') : -1;
    if (codecArgIndex === -1) continue; // not a video stream Set Video Encoder is transcoding

    const encoder = String(stream.outputArgs[codecArgIndex + 1] || '');
    if (!/_qsv$/.test(encoder)) {
      args.jobLog(`Set Source-Relative Bitrate: encoder ${encoder || 'unknown'} is not QSV, leaving it alone`);
      continue;
    }

    const { bps, source } = getVideoBitrate(stream, probe, assumedAudioKbps);
    if (!(bps > 0) || !(targetPercent > 0) || !(ceilingPercent > 0)) {
      args.jobLog(`Set Source-Relative Bitrate: no usable source bitrate (${source}) or percentages, `
        + 'leaving the encode as ICQ');
      continue;
    }

    const sourceKbps = bps / 1000;
    // Flow Variables for Tag Output Metadata (TDARR_SOURCE_VIDEO_KBPS, and TDARR_SOURCE_PEAK_KBPS when the peak scan below works).
    if (!args.variables.user) args.variables.user = {};
    args.variables.user.tdarrSourceVideoKbps = String(Math.round(sourceKbps));

    // The peak scan runs for every QSV encode, before the bits-per-pixel decision below, so the peak is recorded
    // whether or not the cap is added: the figure is a data point for every file (it also feeds the ceiling when
    // "Ceiling based on" is peak). A failed scan is logged and leaves the peak variable unset.
    const window = peakWindowSeconds > 0 ? peakWindowSeconds : 2;
    // eslint-disable-next-line no-await-in-loop
    const scan = await scanSourcePeak({
      ffmpegPath: args.ffmpegPath,
      file: args.inputFileObj._id,
      streamIndex: stream.index,
      windowSeconds: window,
      percentile: peakPercentile >= 0 ? peakPercentile : 100,
      timeoutMs: (peakScanTimeoutSeconds > 0 ? peakScanTimeoutSeconds : 300) * 1000,
      env,
      spawn,
    });
    if (scan.error) {
      args.jobLog(`Set Source-Relative Bitrate: could not measure the source peak (${scan.error}); no peak is recorded`);
    } else {
      args.jobLog(`Set Source-Relative Bitrate: scanned ${scan.packets} packets with ${scan.tool} in `
        + `${scan.seconds.toFixed(1)} s: average ${Math.round(scan.averageKbps)} kbps, peak `
        + `${Math.round(scan.peakKbps)} kbps (percentile ${peakPercentile} of ${scan.windows} windows of `
        + `${window} s)`);
      args.variables.user.tdarrSourcePeakKbps = String(Math.round(scan.peakKbps));
    }

    if (capBelowBpp > 0 && bppMeasured && sourceBpp >= capBelowBpp) {
      args.jobLog(`Set Source-Relative Bitrate: source ${sourceBpp.toFixed(4)} bits/pixel is at or above `
        + `${capBelowBpp}, so no cap is added: plain ICQ with the existing quality`);
      continue;
    }
    let gateNote = '';
    if (capBelowBpp > 0) {
      gateNote = bppMeasured
        ? `; source ${sourceBpp.toFixed(4)} bits/pixel is below ${capBelowBpp}`
        : `; source bits/pixel not measured (Check Source Efficiency off or unable to measure), so the cap applies (threshold ${capBelowBpp})`;
    }
    const targetK = Math.max(Math.round(minTargetKbps), Math.round((sourceKbps * targetPercent) / 100));

    let ceilingBaseKbps = sourceKbps;
    let ceilingBaseNote = `source average ${Math.round(sourceKbps)} kbps`;
    if (wantPeak) {
      if (scan.error) {
        args.jobLog('Set Source-Relative Bitrate: the ceiling uses the source average instead of the peak');
        ceilingBaseNote = `source average ${Math.round(sourceKbps)} kbps (peak scan failed)`;
      } else {
        ceilingBaseKbps = scan.peakKbps;
        ceilingBaseNote = `source peak ${Math.round(scan.peakKbps)} kbps`;
      }
    }

    let ceilingK = Math.round((ceilingBaseKbps * ceilingPercent) / 100);
    if (ceilingK <= targetK) {
      // equal values would make the encoder pick CBR, and a ceiling below the target makes no sense
      ceilingK = targetK + 1;
    }
    const bufK = Math.round(ceilingK * bufsizeMultiplier);

    stripPairs(stream.outputArgs, ['-b:v', '-maxrate', '-bufsize']);
    stream.outputArgs.push('-b:v', `${targetK}k`, '-maxrate', `${ceilingK}k`);
    if (bufK > 0) stream.outputArgs.push('-bufsize', `${bufK}k`);

    args.jobLog(`Set Source-Relative Bitrate: source video ${Math.round(sourceKbps)} kbps (${source}) -> `
      + `-b:v ${targetK}k, -maxrate ${ceilingK}k from ${ceilingPercent}% of ${ceilingBaseNote}`
      + `${bufK > 0 ? `, -bufsize ${bufK}k` : ''} (QVBR with the existing quality)${gateNote}`);
  }

  return done();
};

module.exports = { details, plugin };
