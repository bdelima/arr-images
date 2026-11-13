/**
 * Set Encode Quality — Local Flow Plugin
 *
 * Sets the baseline quality of the re-encode as the Flow Variable tdarrQuality. Put it in the Controller at the point
 * where the file is known to be going to the Converter (in the shipped Controller, between Check Source Efficiency and
 * Go To Converter Flow). Flow Variables survive the Go To Flow hop and the Tags: Worker Type requeue, so the Converter
 * reads the number there; Set Quality With Node Offset adds the encode node's offset to it and writes the final value
 * into the encoder arguments.
 *
 *   Quality                 the baseline for normal frame rates. Plain text, so a library variable works here, for
 *                           example {{{args.userVariables.library.crf}}}, and each library can carry its own tier.
 *   High frame rate above   a source whose frame rate is above this many frames per second gets the high frame rate
 *                           quality instead (default 30, so 50 and 59.94 fps count, 25 and 29.97 do not). 0 = off.
 *   High frame rate quality the baseline for those sources (default 31), the same in every tier.
 *
 * Why a separate baseline for high frame rates: a 1080p50 F1 download (0.059 bits per pixel) grew to 233%-301% of its size
 * at plain ICQ 18, while 1080p24 episodes shrank at the same number. Measured on one 1080p50 source (the Brazil race,
 * 6142 kbps video), ICQ 31 on ojochal gave 4389 kbps (71% of the source video bitrate) at VMAF mean 96.34, min 68.80.
 * One source, so the number is a starting point, not a calibrated value.
 *
 * The frame rate is the video stream's avg_frame_rate, else r_frame_rate, from the file's probe data. If it cannot be read the
 * normal quality is used. A quality that is not a whole number from 1 to 51 is not used: when that leaves nothing, the
 * Flow Variable is removed (so an old value from an earlier pass cannot linger) and the job log says so; the Converter then keeps
 * the quality Set Video Encoder wrote.
 *
 * Output 1: always. This plugin never fails the flow.
 */

const details = () => ({
  name: 'Set Encode Quality',
  description: 'Sets the baseline quality for the re-encode as the Flow Variable tdarrQuality: the Quality input, '
    + 'or the high frame rate quality for sources above the frame rate cutoff. Place it in the Controller before '
    + 'Go To Converter Flow.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Quality',
      name: 'quality',
      type: 'string',
      defaultValue: '18',
      inputUI: { type: 'text' },
      tooltip: 'Baseline quality number for normal frame rates (a whole number from 1 to 51; the value sent as '
        + '-global_quality, -crf or -qp before the encode node\'s offset is added). Lower = better quality, bigger file. '
        + 'Library variables work, e.g. {{{args.userVariables.library.crf}}}. A value that is not a whole number '
        + 'from 1 to 51 is ignored.',
    },
    {
      label: 'High frame rate above fps',
      name: 'highFpsAbove',
      type: 'number',
      defaultValue: '30',
      inputUI: { type: 'text' },
      tooltip: 'A source whose frame rate is above this gets the high frame rate quality. 30 means 50 and 59.94 fps '
        + 'count and 25, 29.97 and 30 do not. 0 = never use the high frame rate quality.',
    },
    {
      label: 'High frame rate quality',
      name: 'highFpsQuality',
      type: 'string',
      defaultValue: '31',
      inputUI: { type: 'text' },
      tooltip: 'Baseline quality number for sources above the frame rate cutoff (a whole number from 1 to 51), the '
        + 'same in every tier. Measured on one 1080p50 source with ICQ on ojochal: 31 gave 4389 kbps, mean VMAF 96.34.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Continue to next plugin' },
  ],
});

// A quality is a whole number from 1 to 51 (the usual range of ICQ, CRF and QP); anything else is undefined.
const parseQuality = (raw) => {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!/^\d{1,2}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= 1 && n <= 51 ? n : undefined;
};

const parseRate = (raw) => {
  if (raw === undefined || raw === null || raw === '') return 0;
  const parts = String(raw).split('/');
  const num = Number(parts[0]);
  const den = parts.length > 1 ? Number(parts[1]) : 1;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
};

const getFps = (videoStream) => {
  const avg = parseRate(videoStream.avg_frame_rate);
  if (avg > 0 && avg <= 240) return avg;
  const r = parseRate(videoStream.r_frame_rate);
  if (r > 0 && r <= 240) return r;
  return 0;
};

const pickVideoStream = (streams) => {
  if (!Array.isArray(streams)) return undefined;
  return streams.find((s) => s.codec_type === 'video'
    && !(s.disposition && Number(s.disposition.attached_pic) === 1)
    && !['mjpeg', 'png', 'bmp', 'gif'].includes(String(s.codec_name || '')));
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  if (!args.variables.user) args.variables.user = {};
  const done = () => ({ outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables });

  const normal = parseQuality(args.inputs.quality);
  const high = parseQuality(args.inputs.highFpsQuality);
  const cutoff = Number(args.inputs.highFpsAbove);

  const probe = args.inputFileObj && args.inputFileObj.ffProbeData;
  const video = pickVideoStream(probe && probe.streams);
  const fps = video ? getFps(video) : 0;
  if (!(fps > 0)) {
    args.jobLog('Set Encode Quality: the source frame rate could not be read, using the normal quality');
  }

  let chosen = normal;
  let why = 'normal quality';
  if (cutoff > 0 && fps > cutoff) {
    if (high !== undefined) {
      chosen = high;
      why = `high frame rate quality, the source is ${fps.toFixed(3)} fps, above ${cutoff}`;
    } else {
      args.jobLog(`Set Encode Quality: the source is ${fps.toFixed(3)} fps, above ${cutoff}, but the high frame rate `
        + `quality "${args.inputs.highFpsQuality}" is not a whole number from 1 to 51, using the normal quality`);
    }
  }

  if (chosen === undefined) {
    delete args.variables.user.tdarrQuality;
    args.jobLog(`Set Encode Quality: no usable quality ("${args.inputs.quality}" is not a whole number from 1 to 51); `
      + 'tdarrQuality is not set, so the Converter keeps the quality Set Video Encoder wrote');
    return done();
  }

  args.variables.user.tdarrQuality = String(chosen);
  args.jobLog(`Set Encode Quality: baseline quality ${chosen} (${why})`);
  return done();
};

module.exports = { details, plugin };
