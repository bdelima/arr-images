/**
 * Set Re-Encode Offset — Local Flow Plugin
 *
 * A sibling of Set Quality With Node Offset. Where that plugin adds the encode node's own offset to the baseline
 * quality once, this one lowers the quality number a further step every time the flow reaches it, so a re-encode
 * (for example after the Validator's VMAF score came in under its threshold) is run at a better quality than the pass
 * before it. A lower number means better quality and a bigger file, so the offset only ever goes down.
 *
 * Each run:
 *
 *   1. Adds "Quality steps per re-encode" (default 1) to a running offset kept in the Flow Variable reEncodeOffset
 *      (a whole number, 0 or below; missing counts as 0). The new value is written back, so it carries to the next pass
 *      and across Go To Flow like tdarrQuality does.
 *   2. Applies it to the first video stream Set Video Encoder is transcoding (a stream still set to copy is skipped):
 *
 *        final quality = base quality + reEncodeOffset, kept between 1 and 51
 *
 *      The base quality is the number on the stream the first time this plugin sees it (-global_quality, -crf or -qp,
 *      which is baseline + node offset once Set Quality With Node Offset has run). It is remembered in the Flow Variable
 *      reEncodeBaseQuality and used on every later pass, so the offset is counted once however the flow comes back: if
 *      the flow re-runs the nodes that write the quality, the same base is rebuilt; if it comes back with the stream
 *      still carrying the last pass's number, nothing is counted twice. If the stream has no quality flag, the Flow
 *      Variable tdarrQuality is the base, and the flag that suits the encoder is added (-global_quality for QSV, -crf for
 *      the software lib* encoders, -qp for the rest). With neither, the quality is left alone.
 *
 *   If there is no ffmpeg command to change (the plugin is placed where none is built yet), only the offset is
 *   recorded and the job log says so.
 *
 * Output 1: the offset was recorded (and applied, where there was a stream to apply it to).
 * Output 2: the quality was already at 1 before this run, so there is nothing lower to try. The offset is still
 *           recorded. Wire it to Fail Flow, or leave it unwired to stop the loop where it is.
 *
 * Only the first transcoded video stream is changed: the Converter works on a video-only file, so there is one.
 * This plugin never fails the flow.
 */

const details = () => ({
  name: 'Set Re-Encode Offset',
  description: 'Lowers the quality number by a step each time the flow reaches it (Flow Variable reEncodeOffset) and '
    + 'applies it to the first transcoded video stream, for re-encoding at a better quality after a low VMAF score. '
    + 'Place it just above Tag Encode Settings.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Quality steps per re-encode',
      name: 'step',
      type: 'number',
      defaultValue: '1',
      inputUI: { type: 'text' },
      tooltip: 'How many quality steps to lower the number by each time the flow reaches this plugin. A whole number '
        + 'from 1 up; anything else counts as 1. A lower number means better quality and a bigger file.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Offset recorded and applied; continue' },
    { number: 2, tooltip: 'The quality was already at the lowest number (1): nothing lower to try' },
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

// The running offset: a whole number, 0 or below. Anything else (missing, "undefined", a positive number) is 0.
const parseOffset = (raw) => {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!/^-?\d+$/.test(text)) return 0;
  const n = Number(text);
  return n < 0 ? n : 0;
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

const clamp = (n) => Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, n));

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const log = (m) => args.jobLog(`Set Re-Encode Offset: ${m}`);
  const done = (outputNumber) => ({ outputFileObj: args.inputFileObj, outputNumber, variables: args.variables });

  if (!args.variables.user) args.variables.user = {};
  const user = args.variables.user;

  const stepInput = Number(args.inputs.step);
  const step = Number.isInteger(stepInput) && stepInput >= 1 ? stepInput : 1;
  const previous = parseOffset(user.reEncodeOffset);
  const offset = previous - step;
  user.reEncodeOffset = String(offset);

  const command = args.variables.ffmpegCommand;
  const streams = command && Array.isArray(command.streams) ? command.streams : [];
  const stream = streams.find((s) => s && s.codec_type === 'video' && Array.isArray(s.outputArgs)
    && s.outputArgs.indexOf('-c:{outputIndex}') !== -1
    && !['', 'copy'].includes(String(s.outputArgs[s.outputArgs.indexOf('-c:{outputIndex}') + 1] || '')));

  if (!stream) {
    log(`offset now ${offset} (was ${previous}, step ${step}); no transcoded video stream to apply it to here, only recorded`);
    return done(1);
  }

  const encoder = String(stream.outputArgs[stream.outputArgs.indexOf('-c:{outputIndex}') + 1]);
  const found = findQualityFlag(stream.outputArgs);

  let base = parseQuality(user.reEncodeBaseQuality);
  let baseNote = 'remembered from the first pass (reEncodeBaseQuality)';
  if (base === undefined && found) {
    base = parseQuality(stream.outputArgs[found.idx + 1]);
    baseNote = `${found.flag} on the stream`;
  }
  if (base === undefined) {
    base = parseQuality(user.tdarrQuality);
    baseNote = 'Flow Variable tdarrQuality (no quality flag on the stream)';
  }
  if (base === undefined) {
    log(`offset now ${offset} (was ${previous}, step ${step}); no base quality (no remembered one, no quality flag, no `
      + 'tdarrQuality), leaving the quality as it is');
    return done(1);
  }
  user.reEncodeBaseQuality = String(base);

  const atFloor = clamp(base + previous) === MIN_QUALITY;
  const wanted = base + offset;
  const final = clamp(wanted);
  const flag = found ? found.flag : qualityFlagFor(encoder);
  if (found) {
    stream.outputArgs[found.idx + 1] = String(final);
  } else {
    stream.outputArgs.push(flag, String(final));
  }
  log(`offset ${previous} -> ${offset} (step ${step}); base ${base} (${baseNote}) -> ${flag} ${final}`
    + `${final !== wanted ? ` (${wanted} limited to ${MIN_QUALITY}-${MAX_QUALITY})` : ''}`);

  if (atFloor) {
    log(`the quality was already at ${MIN_QUALITY} before this run, nothing lower to try (output 2)`);
    return done(2);
  }
  return done(1);
};

module.exports = { details, plugin };
