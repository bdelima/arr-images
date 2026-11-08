/**
 * Set Max Bitrate — Local Flow Plugin
 *
 * Adds -maxrate / -bufsize (and optionally -minrate) to every video stream that
 * "Set Video Encoder" decided to transcode. Place this node directly after
 * "Set Video Encoder" in the flow — it only caps streams that node already queued
 * for encoding; stream-copied video is left untouched.
 *
 * All three value fields are plain text inputs, so they support Tdarr's normal
 * plugin variable templating (same mechanism "FFmpeg Quality" on Set Video Encoder
 * uses), e.g.:
 *   {{{args.userVariables.library.maxrate}}}
 *   {{{args.userVariables.library.bufsize}}}
 * Set those as per-library "user variables" in the Tdarr UI (one value per quality
 * tier/library) and point every library's flow at the same shared node — no need
 * for separate flows per tier.
 *
 * Detection of "is this stream being encoded": Set Video Encoder pushes the literal
 * placeholder string '-c:{outputIndex}' onto a stream's outputArgs before the real
 * stream index is substituted later in the ffmpegCommand pipeline. Checking for that
 * literal string is how this plugin tells a stream Set Video Encoder is transcoding
 * apart from one it left as a stream copy.
 *
 * Values are sanitized against a plain bitrate pattern (digits + optional k/K/m/M)
 * before use, so an unset library variable is treated as "skip this flag" whether
 * Tdarr resolves a missing {{{args.userVariables.library.X}}} reference to an empty
 * string or leaves the literal unresolved template text in place — either way, the
 * result fails the pattern and gets dropped instead of reaching ffmpeg's command line.
 */

const details = () => ({
  name: 'Set Max Bitrate',
  description: 'Add -maxrate/-bufsize (and optionally -minrate) to each video stream '
    + 'Set Video Encoder is transcoding. Place this node directly after Set Video Encoder.',
  style: {
    borderColor: '#6efefc',
  },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Enable Max Bitrate Cap',
      name: 'enabled',
      type: 'boolean',
      defaultValue: 'true',
      inputUI: {
        type: 'switch',
      },
      tooltip: 'Turn the bitrate cap on or off without removing the node from the flow',
    },
    {
      label: 'Max Bitrate',
      name: 'maxrate',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Value passed to ffmpeg -maxrate, e.g. 6000k or 4M. Supports plugin variable '
        + 'templating, e.g. {{{args.userVariables.library.maxrate}}}. Leave blank to skip -maxrate.',
    },
    {
      label: 'Buffer Size',
      name: 'bufsize',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Value passed to ffmpeg -bufsize. Commonly set equal to Max Bitrate, or ~2x it for '
        + 'more tolerance before the cap kicks in. Supports templating, e.g. '
        + '{{{args.userVariables.library.bufsize}}}. Leave blank to skip -bufsize.',
    },
    {
      label: 'Min Bitrate',
      name: 'minrate',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Optional value passed to ffmpeg -minrate. Supports templating. Leave blank to skip -minrate.',
    },
  ],
  outputs: [
    {
      number: 1,
      tooltip: 'Continue to next plugin',
    },
  ],
});

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const BITRATE_PATTERN = /^\d+[kKmM]?$/;
  const sanitizeBitrate = (raw) => {
    const value = String(raw || '').trim();
    return BITRATE_PATTERN.test(value) ? value : '';
  };

  const enabled = args.inputs.enabled === true;
  const maxrate = sanitizeBitrate(args.inputs.maxrate);
  const bufsize = sanitizeBitrate(args.inputs.bufsize);
  const minrate = sanitizeBitrate(args.inputs.minrate);

  if (enabled && (maxrate || bufsize || minrate)) {
    for (let i = 0; i < args.variables.ffmpegCommand.streams.length; i += 1) {
      const stream = args.variables.ffmpegCommand.streams[i];

      // Only cap streams Set Video Encoder actually queued for transcoding, never a stream copy.
      const isBeingEncoded = stream.codec_type === 'video'
        && stream.outputArgs.includes('-c:{outputIndex}');

      if (isBeingEncoded) {
        if (maxrate) {
          stream.outputArgs.push('-maxrate', maxrate);
        }
        if (bufsize) {
          stream.outputArgs.push('-bufsize', bufsize);
        }
        if (minrate) {
          stream.outputArgs.push('-minrate', minrate);
        }
      }
    }
  }

  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};

module.exports = {
  details,
  plugin,
};
