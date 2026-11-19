/**
 * Classify Source — Local Flow Plugin
 *
 * Pure classification, no routing decisions baked in: every class is its own output, so the flow wiring (which output
 * goes to the Encoder, the Muxer or anywhere else) is entirely his to decide in the Tdarr UI.
 *
 * Codec bucket is one of: h264, hevc, av1, legacy (vc1/mpeg2video/mpeg4/vp8/wmv2/wmv3), or other/unrecognized.
 * HDR/DoVi detection matches the real stock "checkHdr" plugin exactly: smpte2084+bt2020+tv color tags (HDR10), or
 * codec_tag_string containing dvhe/dvav/dav1/dvh11 (Dolby Vision on HEVC, AVC, AV1, and the hvc1-style HEVC variant).
 *
 * Dolby Vision Profile 4 and 5 are told apart from the other HDR/DoVi files for HEVC and AV1: the profile is read from
 * the DOVI configuration record that ffprobe reports in the video stream's side data (dv_profile). A stream whose
 * record says Profile 4 or 5 goes to its own output whether or not the color tags or codec tag above flagged it, because
 * a Profile 5 stream carries no HDR10 color tags and a Matroska file carries no dv* codec tag. When the record is not
 * in the probe data the profile is unknown and the file is classified from the tags alone, as before.
 *
 * Both codec and HDR/DoVi detection loop ffProbeData.streams for codec_type === 'video'
 * rather than assuming stream index 0 — some files have an embedded cover-art/attachment
 * image stream ahead of the real video stream, so index-0 templating would misclassify those.
 *
 *   Output 1:  h264 (HDR/DoVi or not)
 *   Output 2:  hevc, not HDR/DoVi
 *   Output 3:  hevc, HDR/DoVi (any Dolby Vision profile except 4 and 5)
 *   Output 4:  hevc, Dolby Vision Profile 4 or 5
 *   Output 5:  av1, not HDR/DoVi
 *   Output 6:  av1, HDR/DoVi (any Dolby Vision profile except 4 and 5)
 *   Output 7:  av1, Dolby Vision Profile 4 or 5
 *   Output 8:  legacy (vc1/mpeg2video/mpeg4/vp8/wmv2/wmv3), HDR/DoVi or not
 *   Output 9:  other/unrecognized, not HDR/DoVi
 *   Output 10: other/unrecognized, HDR/DoVi
 *
 * It also sets the Flow Variable user.tdarrSourceClass to the codec bucket (h264, hevc, av1, legacy, other), with
 * "-hdr" added for HDR/DoVi (Profile 4 and 5 included), which Tag Output Metadata writes into the TDARR_SOURCE_CLASS tag.
 */

const LEGACY_CODECS = ['vc1', 'mpeg2video', 'mpeg4', 'vp8', 'wmv2', 'wmv3'];

// The Dolby Vision profiles that get their own output (for HEVC and AV1).
const SEPARATE_DOVI_PROFILES = [4, 5];

const details = () => ({
  name: 'Classify Source',
  description: 'Sorts the source into one output per class: h264, hevc, hevc HDR/DoVi, hevc DoVi Profile 4/5, av1, av1 HDR/DoVi, av1 DoVi Profile 4/5, legacy, other, other HDR/DoVi - no routing decisions.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [],
  outputs: [
    { number: 1, tooltip: 'h264 (HDR/DoVi or not)' },
    { number: 2, tooltip: 'hevc, not HDR/DoVi' },
    { number: 3, tooltip: 'hevc, HDR/DoVi (any Dolby Vision profile except 4 and 5)' },
    { number: 4, tooltip: 'hevc, Dolby Vision Profile 4 or 5' },
    { number: 5, tooltip: 'av1, not HDR/DoVi' },
    { number: 6, tooltip: 'av1, HDR/DoVi (any Dolby Vision profile except 4 and 5)' },
    { number: 7, tooltip: 'av1, Dolby Vision Profile 4 or 5' },
    { number: 8, tooltip: 'legacy (vc1/mpeg2video/mpeg4/vp8/wmv2/wmv3), HDR/DoVi or not' },
    { number: 9, tooltip: 'other/unrecognized, not HDR/DoVi' },
    { number: 10, tooltip: 'other/unrecognized, HDR/DoVi' },
  ],
});

// The Dolby Vision profile number from the DOVI configuration record in a video stream's side data, or 0 when the
// probe data has no such record (or no usable profile in it).
const doviProfileOf = (stream) => {
  const list = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  const record = list.find((s) => s
    && /dovi configuration record/i.test(String(s.side_data_type || ''))
    && Number.isFinite(Number(s.dv_profile)));
  return record ? Number(record.dv_profile) : 0;
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const streams = args?.inputFileObj?.ffProbeData?.streams;

  let isHdr = false;
  let doviProfile = 0;
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

      // The first stream that has a Dolby Vision record decides the profile.
      if (doviProfile === 0) doviProfile = doviProfileOf(stream);
    }
  }

  // Only HEVC and AV1 have the separate Profile 4/5 outputs.
  const separateProfile = SEPARATE_DOVI_PROFILES.includes(doviProfile) && (codecName === 'hevc' || codecName === 'av1');

  let outputNumber;
  let bucketName;
  if (codecName === 'h264') {
    bucketName = 'h264';
    outputNumber = 1;
  } else if (codecName === 'hevc') {
    bucketName = 'hevc';
    if (separateProfile) outputNumber = 4;
    else outputNumber = isHdr ? 3 : 2;
  } else if (codecName === 'av1') {
    bucketName = 'av1';
    if (separateProfile) outputNumber = 7;
    else outputNumber = isHdr ? 6 : 5;
  } else if (LEGACY_CODECS.includes(codecName)) {
    bucketName = 'legacy';
    outputNumber = 8;
  } else {
    bucketName = 'other';
    outputNumber = isHdr ? 10 : 9;
  }

  // The source class Tag Output Metadata writes into TDARR_SOURCE_CLASS: the codec bucket, with -hdr added for HDR or
  // Dolby Vision (h264, hevc-hdr, av1, legacy, other-hdr, ...). It is a Flow Variable, so it follows the file through
  // goToFlow like the step trail does. An HEVC or AV1 stream with a Dolby Vision Profile 4 or 5 record counts as HDR/DoVi
  // here even when the color tags did not flag it.
  const hdrClass = isHdr || separateProfile;
  if (!args.variables) args.variables = {};
  if (!args.variables.user) args.variables.user = {};
  args.variables.user.tdarrSourceClass = hdrClass ? `${bucketName}-hdr` : bucketName;
  const profileNote = doviProfile > 0 ? `, Dolby Vision Profile ${doviProfile}` : '';
  args.jobLog(`Classify Source: source class ${args.variables.user.tdarrSourceClass}${profileNote} (output ${outputNumber})`);

  return {
    outputFileObj: args.inputFileObj,
    outputNumber,
    variables: args.variables,
  };
};

module.exports = { details, plugin };
