/**
 * Set Quality With Node Offset — Local Flow Plugin
 *
 * Replaces Set Source-Relative Bitrate in the Converter. Place it directly after Set Video Encoder. It does two things
 * to every video stream Set Video Encoder is transcoding (a stream still set to copy is skipped), and adds no bitrate
 * cap (-b:v, -maxrate, -bufsize are left exactly as they are).
 *
 * 1. Quality with a per-node offset. The same ICQ number does not give the same file on every encode node: on the
 *    1080p50 Brazil race, plain ICQ 28 on drakebay (Panther Lake) wrote 4478 kbps and ICQ 31 on ojochal (Meteor Lake)
 *    wrote 4389 kbps, at about the same VMAF (mean 96.06 vs 96.34), while ojochal at ICQ 28 wrote 6821 kbps. So the
 *    quality number is a baseline, and each node adds its own offset to it:
 *
 *      final quality = baseline + this node's offset, kept between 1 and 51
 *
 *    The baseline is the Flow Variable tdarrQuality, set earlier in the Controller by Set Encode Quality (the tier's
 *    number, or the high frame rate number). If that is missing, the baseline is the number Set Video Encoder already put
 *    in the arguments (-global_quality, -crf or -qp), so a flow without Set Encode Quality still works. If neither exists
 *    the quality is left as it is. The final value replaces the existing one in place, or is added with the flag that suits
 *    the encoder (-global_quality for QSV, -crf for the software lib* encoders, -qp for the rest, as Set Video Encoder
 *    does) when Set Video Encoder wrote none.
 *
 *    The node is the node the job is running on now (its name, the one Tdarr shows, for example ojochal-gpu). The input
 *    "Quality offset per node" lists node=offset pairs, separated by new lines, commas or semicolons, for example
 *    drakebay-gpu=-3. Names are matched without regard to case. A node that is not listed, or whose name cannot be read,
 *    gets 0. A lower number means better quality and a bigger file, so a node that writes fewer bits for the same number
 *    gets a negative offset. The offset is a whole number, with an optional + or -.
 *
 * 2. Source bitrate record. For the first video stream it transcodes, the plugin records the source's average video
 *    bitrate (Flow Variable tdarrSourceVideoKbps) and, from an ffprobe packet scan that reads sizes without decoding, its
 *    peak (tdarrSourcePeakKbps): the busiest window of "Peak window seconds" (default 2), at "Peak percentile" (default
 *    100 = the busiest). Tag Output Metadata writes them as TDARR_SOURCE_VIDEO_KBPS and TDARR_SOURCE_PEAK_KBPS. Neither
 *    value changes the encode any more. If the scan cannot be done (no ffprobe, timeout, unreadable output, file shorter
 *    than three windows) the peak is not recorded and the job log says so. This runs for every encoder, not only QSV.
 *
 * The source average comes from the stream object Set Video Encoder is working on (stream bit_rate, or the BPS /
 * NUMBER_OF_BYTES + DURATION tags), with the container bitrate minus audio as a last resort.
 *
 * Output 1: always. This plugin never fails the flow.
 */

const details = () => ({
  name: 'Set Quality With Node Offset',
  description: 'Adds the encode node\'s own offset (from the "Quality offset per node" list) to the baseline quality '
    + '(Flow Variable tdarrQuality, else the quality Set Video Encoder wrote) and records the source video\'s average '
    + 'and peak bitrate for the output tags. Adds no bitrate cap. Place directly after Set Video Encoder.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Quality offset per node',
      name: 'nodeOffsets',
      type: 'string',
      defaultValue: '',
      inputUI: { type: 'textarea' },
      tooltip: 'One node=offset pair per line (commas and semicolons also separate pairs), for example '
        + 'drakebay-gpu=-3. The node name is the name Tdarr shows for the node the job is running on, matched without '
        + 'regard to case. The offset is added to the baseline quality: a node that writes fewer bits for the same '
        + 'number gets a negative offset. A node that is not listed gets 0. The final quality is kept between 1 and 51. '
        + 'Measured on one 1080p50 source: drakebay ICQ 28 was about equal to ojochal ICQ 31 (4478 vs 4389 kbps).',
    },
    {
      label: 'Peak window seconds',
      name: 'peakWindowSeconds',
      type: 'number',
      defaultValue: '2',
      inputUI: { type: 'text' },
      tooltip: 'Length of the sliding window the source bitrate peak is measured over.',
    },
    {
      label: 'Peak percentile',
      name: 'peakPercentile',
      type: 'number',
      defaultValue: '100',
      inputUI: { type: 'text' },
      tooltip: 'Which window counts as the peak: 100 = the busiest window, 99.9 = ignore the busiest 0.1% of windows.',
    },
    {
      label: 'Peak scan timeout seconds',
      name: 'peakScanTimeoutSeconds',
      type: 'number',
      defaultValue: '300',
      inputUI: { type: 'text' },
      tooltip: 'Give up on the packet scan after this long; the peak is then not recorded.',
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

// The usual range of the quality flags (ICQ, CRF, QP); not checked against each encoder.
const MIN_QUALITY = 1;
const MAX_QUALITY = 51;
const QUALITY_FLAGS = ['-global_quality', '-crf', '-qp'];

// A quality is a whole number from MIN_QUALITY to MAX_QUALITY; anything else is undefined.
const parseQuality = (raw) => {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!/^\d{1,2}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= MIN_QUALITY && n <= MAX_QUALITY ? n : undefined;
};

// "node=offset" pairs separated by new lines, commas or semicolons. Names are lower-cased; a later pair for the same
// name wins. Entries that are not a name, "=" and a whole number come back in `problems`.
const parseNodeOffsets = (text) => {
  const offsets = new Map();
  const problems = [];
  String(text === undefined || text === null ? '' : text).split(/[\n,;]+/).forEach((raw) => {
    const entry = raw.trim();
    if (entry === '') return;
    const m = /^([^=]+)=\s*([+-]?\d+)$/.exec(entry);
    if (!m || m[1].trim() === '') {
      problems.push(entry);
      return;
    }
    offsets.set(m[1].trim().toLowerCase(), Number(m[2]));
  });
  return { offsets, problems };
};

// The name of the node the job is running on, read the same way Mark Step reads it.
const nodeNameOf = (args) => {
  try {
    return String((args.configVars && args.configVars.config && args.configVars.config.nodeName)
      || (args.config && args.config.nodeName) || '').trim();
  } catch (e) {
    return '';
  }
};

// The quality flag already on the stream (the first of QUALITY_FLAGS that has a value after it), with its position.
const findQualityFlag = (outputArgs) => {
  for (let i = 0; i < QUALITY_FLAGS.length; i += 1) {
    const idx = outputArgs.indexOf(QUALITY_FLAGS[i]);
    if (idx !== -1 && idx < outputArgs.length - 1) return { flag: QUALITY_FLAGS[i], idx };
  }
  return undefined;
};

// The flag Set Video Encoder uses for each kind of encoder.
const qualityFlagFor = (encoder) => {
  if (/_qsv$/.test(encoder)) return '-global_quality';
  if (/^lib/.test(encoder)) return '-crf';
  return '-qp';
};

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

  if (!args.variables.user) args.variables.user = {};
  const streams = args.variables.ffmpegCommand.streams;
  const probe = args.inputFileObj && args.inputFileObj.ffProbeData;
  const {
    assumedAudioKbps, peakWindowSeconds, peakPercentile, peakScanTimeoutSeconds,
  } = args.inputs;
  const { spawn } = require('child_process');
  // A UTF-8 locale so ffprobe opens file names with accented or non-Latin characters (as in the other plugins).
  const env = { ...process.env, LC_ALL: 'C.UTF-8' };

  // The node and its offset, worked out once for the job.
  const nodeName = nodeNameOf(args);
  const { offsets, problems } = parseNodeOffsets(args.inputs.nodeOffsets);
  problems.forEach((p) => args.jobLog(`Set Quality With Node Offset: ignoring the offset entry "${p}" (expected node=whole number)`));
  const hasOffset = nodeName !== '' && offsets.has(nodeName.toLowerCase());
  const offset = hasOffset ? offsets.get(nodeName.toLowerCase()) : 0;
  const nodeNote = nodeName === ''
    ? 'node name unknown, offset 0'
    : `node ${nodeName}, ${hasOffset ? `offset ${offset > 0 ? '+' : ''}${offset}` : 'not in the offset list, offset 0'}`;

  let recorded = false;
  for (let i = 0; i < streams.length; i += 1) {
    const stream = streams[i];
    const codecArgIndex = stream.codec_type === 'video' ? stream.outputArgs.indexOf('-c:{outputIndex}') : -1;
    if (codecArgIndex === -1) continue; // not a video stream Set Video Encoder is transcoding

    const encoder = String(stream.outputArgs[codecArgIndex + 1] || '');
    if (encoder === '' || encoder === 'copy') continue; // Begin Command's default: the stream is not being re-encoded

    // 1. Source bitrate record, once, for the first transcoded video stream.
    if (!recorded) {
      recorded = true;
      const { bps, source } = getVideoBitrate(stream, probe, assumedAudioKbps);
      if (bps > 0) {
        const sourceKbps = bps / 1000;
        args.variables.user.tdarrSourceVideoKbps = String(Math.round(sourceKbps));
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
          args.jobLog(`Set Quality With Node Offset: source video ${Math.round(sourceKbps)} kbps (${source}); could not `
            + `measure the source peak (${scan.error}), so no peak is recorded`);
        } else {
          args.variables.user.tdarrSourcePeakKbps = String(Math.round(scan.peakKbps));
          args.jobLog(`Set Quality With Node Offset: source video ${Math.round(sourceKbps)} kbps (${source}); scanned `
            + `${scan.packets} packets with ${scan.tool} in ${scan.seconds.toFixed(1)} s: average `
            + `${Math.round(scan.averageKbps)} kbps, peak ${Math.round(scan.peakKbps)} kbps (percentile `
            + `${peakPercentile} of ${scan.windows} windows of ${window} s)`);
        }
      } else {
        args.jobLog(`Set Quality With Node Offset: no usable source bitrate (${source}), nothing recorded`);
      }
    }

    // 2. Quality: baseline plus this node's offset.
    const found = findQualityFlag(stream.outputArgs);
    let baseline = parseQuality(args.variables.user.tdarrQuality);
    let baselineNote = 'Flow Variable tdarrQuality, set in the Controller';
    if (baseline === undefined && found) {
      baseline = parseQuality(stream.outputArgs[found.idx + 1]);
      baselineNote = `${found.flag} Set Video Encoder wrote (tdarrQuality is not set)`;
    }
    if (baseline === undefined) {
      args.jobLog('Set Quality With Node Offset: no baseline quality (no tdarrQuality and no usable quality on the '
        + `stream), leaving the quality as Set Video Encoder configured it; ${nodeNote}`);
      continue;
    }

    const wanted = baseline + offset;
    const final = Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, wanted));
    if (found) {
      stream.outputArgs[found.idx + 1] = String(final);
    } else {
      stream.outputArgs.push(qualityFlagFor(encoder), String(final));
    }
    const flag = found ? found.flag : qualityFlagFor(encoder);
    args.jobLog(`Set Quality With Node Offset: ${nodeNote}; baseline ${baseline} (${baselineNote}) -> ${flag} ${final}`
      + `${final !== wanted ? ` (${wanted} limited to ${MIN_QUALITY}-${MAX_QUALITY})` : ''}`);
  }

  return done();
};

module.exports = { details, plugin };
