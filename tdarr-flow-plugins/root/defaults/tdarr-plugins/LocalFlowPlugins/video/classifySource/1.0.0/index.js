/**
 * Classify Source — Local Flow Plugin
 *
 * Pure classification, no routing decisions baked in: enumerates every (codec bucket x
 * HDR/DoVi) permutation as its own output, so the flow wiring (which output goes to
 * Converter/Clean/wherever) is entirely his to decide in the Tdarr UI.
 *
 * Codec bucket is one of: h264, hevc, av1, legacy (vc1/mpeg2video/mpeg4/vp8/wmv2/wmv3),
 * or other/unrecognized. HDR/DoVi detection matches the real stock "checkHdr" plugin
 * exactly: smpte2084+bt2020+tv color tags (HDR10), or codec_tag_string containing
 * dvhe/dvav/dav1/dvh11 (Dolby Vision on HEVC, AVC, AV1, and the hvc1-style HEVC variant).
 *
 * Both codec and HDR/DoVi detection loop ffProbeData.streams for codec_type === 'video'
 * rather than assuming stream index 0 — some files have an embedded cover-art/attachment
 * image stream ahead of the real video stream, so index-0 templating would misclassify those.
 *
 *   Output 1:  h264, not HDR/DoVi
 *   Output 2:  h264, HDR/DoVi
 *   Output 3:  hevc, not HDR/DoVi
 *   Output 4:  hevc, HDR/DoVi
 *   Output 5:  av1, not HDR/DoVi
 *   Output 6:  av1, HDR/DoVi
 *   Output 7:  legacy (vc1/mpeg2video/mpeg4/vp8/wmv2/wmv3), not HDR/DoVi
 *   Output 8:  legacy, HDR/DoVi
 *   Output 9:  other/unrecognized, not HDR/DoVi
 *   Output 10: other/unrecognized, HDR/DoVi
 */

const LEGACY_CODECS = ['vc1', 'mpeg2video', 'mpeg4', 'vp8', 'wmv2', 'wmv3'];

const details = () => ({
  name: 'Classify Source',
  description: 'Enumerates every (codec bucket x HDR/DoVi) permutation as its own output - no routing decisions.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [],
  outputs: [
    { number: 1, tooltip: 'h264, not HDR/DoVi' },
    { number: 2, tooltip: 'h264, HDR/DoVi' },
    { number: 3, tooltip: 'hevc, not HDR/DoVi' },
    { number: 4, tooltip: 'hevc, HDR/DoVi' },
    { number: 5, tooltip: 'av1, not HDR/DoVi' },
    { number: 6, tooltip: 'av1, HDR/DoVi' },
    { number: 7, tooltip: 'legacy (vc1/mpeg2video/mpeg4/vp8/wmv2/wmv3), not HDR/DoVi' },
    { number: 8, tooltip: 'legacy, HDR/DoVi' },
    { number: 9, tooltip: 'other/unrecognized, not HDR/DoVi' },
    { number: 10, tooltip: 'other/unrecognized, HDR/DoVi' },
  ],
});

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const streams = args?.inputFileObj?.ffProbeData?.streams;

  let isHdr = false;
  let codecName = '';
  let foundVideoStream = false;

  if (Array.isArray(streams)) {
    for (let i = 0; i < streams.length; i += 1) {
      const stream = streams[i];
      if (stream.codec_type !== 'video') continue;

      if (!foundVideoStream) {
        codecName = String(stream.codec_name || '');
        foundVideoStream = true;
      }

      if (
        (stream.color_transfer === 'smpte2084'
          && stream.color_primaries === 'bt2020'
          && stream.color_range === 'tv')
        || stream.codec_tag_string?.includes('dvhe')
        || stream.codec_tag_string?.includes('dvav')
        || stream.codec_tag_string?.includes('dav1')
        || stream.codec_tag_string?.includes('dvh11')
      ) {
        isHdr = true;
      }
    }
  }

  let bucketBase;
  if (codecName === 'h264') {
    bucketBase = 1;
  } else if (codecName === 'hevc') {
    bucketBase = 3;
  } else if (codecName === 'av1') {
    bucketBase = 5;
  } else if (LEGACY_CODECS.includes(codecName)) {
    bucketBase = 7;
  } else {
    bucketBase = 9;
  }

  const outputNumber = isHdr ? bucketBase + 1 : bucketBase;

  return {
    outputFileObj: args.inputFileObj,
    outputNumber,
    variables: args.variables,
  };
};

module.exports = { details, plugin };
