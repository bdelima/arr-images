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
 *   -b:v      = source video bitrate x "Target percent"
 *   -maxrate  = source video bitrate x "Ceiling percent"
 *   -bufsize  = -maxrate x "Buffer multiplier"
 *
 * Non-QSV encoders (anything whose -c value does not end in _qsv) are left alone: the mode behaviour above is
 * specific to QSV. If the source bitrate cannot be determined, nothing is added and the encode stays ICQ.
 * Any -b:v / -maxrate / -bufsize already on the stream (for example from Set Max Bitrate) is replaced.
 *
 * The source bitrate comes from the stream object Set Video Encoder is working on (stream bit_rate, or the
 * BPS / NUMBER_OF_BYTES + DURATION tags), with the container bitrate minus audio as a last resort.
 */

const details = () => ({
  name: 'Set Source-Relative Bitrate',
  description: 'Adds -b:v / -maxrate / -bufsize as percentages of the source video bitrate to QSV '
    + 'encodes, switching hevc_qsv from ICQ to QVBR (quality target plus ceiling). Place directly '
    + 'after Set Video Encoder.',
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
      label: 'Target percent of source bitrate',
      name: 'targetPercent',
      type: 'number',
      defaultValue: '70',
      inputUI: { type: 'text' },
      tooltip: '-b:v as a percentage of the source video bitrate. Uncalibrated starting value.',
    },
    {
      label: 'Ceiling percent of source bitrate',
      name: 'ceilingPercent',
      type: 'number',
      defaultValue: '100',
      inputUI: { type: 'text' },
      tooltip: '-maxrate as a percentage of the source video bitrate. 100 = never above the source. '
        + 'Uncalibrated starting value.',
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
  const { targetPercent, ceilingPercent, bufsizeMultiplier, minTargetKbps, assumedAudioKbps } = args.inputs;

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
    const targetK = Math.max(Math.round(minTargetKbps), Math.round((sourceKbps * targetPercent) / 100));
    let ceilingK = Math.round((sourceKbps * ceilingPercent) / 100);
    if (ceilingK <= targetK) {
      // equal values would make the encoder pick CBR, and a ceiling below the target makes no sense
      ceilingK = targetK + 1;
    }
    const bufK = Math.round(ceilingK * bufsizeMultiplier);

    stripPairs(stream.outputArgs, ['-b:v', '-maxrate', '-bufsize']);
    stream.outputArgs.push('-b:v', `${targetK}k`, '-maxrate', `${ceilingK}k`);
    if (bufK > 0) stream.outputArgs.push('-bufsize', `${bufK}k`);

    args.jobLog(`Set Source-Relative Bitrate: source video ${Math.round(sourceKbps)} kbps (${source}) -> `
      + `-b:v ${targetK}k, -maxrate ${ceilingK}k${bufK > 0 ? `, -bufsize ${bufK}k` : ''} (QVBR with the existing quality)`);
  }

  return done();
};

module.exports = { details, plugin };
