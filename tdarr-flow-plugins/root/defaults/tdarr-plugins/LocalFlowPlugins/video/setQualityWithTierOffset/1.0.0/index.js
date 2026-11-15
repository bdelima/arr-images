/**
 * Set Quality With Tier Offset — Local Flow Plugin
 *
 * Adds an offset for the library's quality tier to the quality number already on the encode command. Place it after
 * Set Video Encoder and after Set Quality With Node Offset, before Tag Encode Settings.
 *
 *   final quality = quality already in the arguments + the offset of the tier, kept between 1 and 51
 *
 * The tier is the library variable qualityTier (args.userVariables.library.qualityTier). The input "Quality offset per
 * tier" lists tier=offset pairs, separated by new lines, commas or semicolons, for example:
 *
 *   best=0
 *   better=+1
 *   balanced=+2
 *   smallest=+4
 *
 * Tier names are matched without regard to case. A tier that is not listed, or a missing qualityTier, gets 0. A higher
 * number means a smaller file and lower quality. The offset is a whole number, with an optional + or -.
 *
 * The number it changes is the -global_quality, -crf or -qp already on each video stream Set Video Encoder is
 * transcoding (streams set to copy are skipped), so it stacks on whatever came before it, such as the node offset. It
 * does not read tdarrQuality, and a stream with no quality flag is left alone.
 *
 * Output 1: always. This plugin never fails the flow.
 */

const details = () => ({
  name: 'Set Quality With Tier Offset',
  description: 'Adds the offset for the library variable qualityTier (from the "Quality offset per tier" list) to the '
    + 'quality already on the encode command. Place after Set Video Encoder and Set Quality With Node Offset.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Quality offset per tier',
      name: 'tierOffsets',
      type: 'string',
      defaultValue: 'best=0\nbetter=+1\nbalanced=+2\nsmallest=+4',
      inputUI: { type: 'textarea' },
      tooltip: 'One tier=offset pair per line (commas and semicolons also separate pairs), for example better=+1. '
        + 'The tier is the value of the library variable qualityTier, matched without regard to case. The offset is '
        + 'added to the quality already on the command: a higher number is a smaller file. A tier that is not listed '
        + 'gets 0. The final quality is kept between 1 and 51.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Continue to next plugin' },
  ],
});

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

// "tier=offset" pairs separated by new lines, commas or semicolons. Names are lower-cased; a later pair for the same
// name wins. Entries that are not a name, "=" and a whole number come back in `problems`.
const parseTierOffsets = (text) => {
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

// The quality flag already on the stream (the first of QUALITY_FLAGS that has a value after it), with its position.
const findQualityFlag = (outputArgs) => {
  for (let i = 0; i < QUALITY_FLAGS.length; i += 1) {
    const idx = outputArgs.indexOf(QUALITY_FLAGS[i]);
    if (idx !== -1 && idx < outputArgs.length - 1) return { flag: QUALITY_FLAGS[i], idx };
  }
  return undefined;
};

// The library variable qualityTier, trimmed; '' when it is not set.
const tierOf = (args) => {
  try {
    const value = args.userVariables && args.userVariables.library && args.userVariables.library.qualityTier;
    return String(value === undefined || value === null ? '' : value).trim();
  } catch (e) {
    return '';
  }
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const prefix = 'Set Quality With Tier Offset:';
  const { offsets, problems } = parseTierOffsets(args.inputs.tierOffsets);
  problems.forEach((p) => args.jobLog(`${prefix} ignoring the offset entry "${p}" (expected tier=whole number)`));

  const tier = tierOf(args);
  const hasOffset = tier !== '' && offsets.has(tier.toLowerCase());
  const offset = hasOffset ? offsets.get(tier.toLowerCase()) : 0;
  const tierNote = tier === ''
    ? 'qualityTier is not set, offset 0'
    : `tier ${tier}, ${hasOffset ? `offset ${offset > 0 ? '+' : ''}${offset}` : 'not in the tier list, offset 0'}`;

  const streams = args.variables.ffmpegCommand.streams;
  for (let i = 0; i < streams.length; i += 1) {
    const stream = streams[i];
    const codecArgIndex = stream.codec_type === 'video' ? stream.outputArgs.indexOf('-c:{outputIndex}') : -1;
    if (codecArgIndex === -1) continue; // not a video stream Set Video Encoder is transcoding

    const encoder = String(stream.outputArgs[codecArgIndex + 1] || '');
    if (encoder === '' || encoder === 'copy') continue; // the stream is not being re-encoded

    const found = findQualityFlag(stream.outputArgs);
    const current = found ? parseQuality(stream.outputArgs[found.idx + 1]) : undefined;
    if (current === undefined) {
      args.jobLog(`${prefix} no usable quality on the stream, leaving it as it is; ${tierNote}`);
      continue;
    }

    const wanted = current + offset;
    const final = Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, wanted));
    stream.outputArgs[found.idx + 1] = String(final);
    args.jobLog(`${prefix} ${tierNote}; ${found.flag} ${current} -> ${final}`
      + `${final !== wanted ? ` (${wanted} limited to ${MIN_QUALITY}-${MAX_QUALITY})` : ''}`);
  }

  return { outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables };
};

module.exports = { details, plugin };
