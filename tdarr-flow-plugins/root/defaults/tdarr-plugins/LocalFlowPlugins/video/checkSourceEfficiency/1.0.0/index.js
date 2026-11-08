/**
 * Check Source Efficiency — Local Flow Plugin
 *
 * Decides, per file, whether re-encoding to HEVC is worth attempting, from the source's bits per pixel:
 *
 *   bits per pixel = video bitrate / (width x height x frames per second)
 *
 * A source that is already starved (low bits per pixel) cannot shrink at a constant-quality setting: the
 * encoder spends the bits the picture needs, which can be more than the source used. A 1080p50 H.264 F1
 * download at about 0.059 bits per pixel grew to 233%-301% of the original at -global_quality 18.
 *
 * Output 1: encode - bits per pixel is at or above the threshold, or it could not be measured (fail open;
 *           the Validator's size gate is still the backstop).
 * Output 2: skip   - below the threshold: keep the original (wire this output to the Clean flow).
 *
 * The check is deliberately a rough, content-blind test: how many bits a given quality needs varies with
 * the picture (grain, fast motion), so it will not be right every time. It is meant to catch flagrant cases.
 *
 * Source video bitrate, first one that works:
 *   1. the video stream's bit_rate
 *   2. the stream tag BPS / BPS-<lang> (written by mkvmerge and ffmpeg)
 *   3. NUMBER_OF_BYTES[-lang] x 8 / DURATION[-lang] stream tags
 *   4. the container's overall bit_rate minus the audio streams (their bit_rate, else "Assumed audio kbps")
 *
 * Sets Flow Variables (readable by Tag Output Metadata): tdarrSourceBpp, tdarrSourceVideoKbps,
 * tdarrGateDecision (encode | encode-unmeasured | skip-low-bpp).
 */

const LEGACY_CODECS = ['vc1', 'mpeg2video', 'mpeg4', 'vp8', 'wmv2', 'wmv3'];

const details = () => ({
  name: 'Check Source Efficiency',
  description: 'Compares the source video\'s bits per pixel (bitrate / width x height x fps) with a '
    + 'threshold. Output 1 = worth encoding, output 2 = already starved, keep the original.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Enable Check',
      name: 'enabled',
      type: 'boolean',
      defaultValue: 'true',
      inputUI: { type: 'switch' },
      tooltip: 'Off = always output 1 (encode), without measuring.',
    },
    {
      label: 'Minimum Bits Per Pixel (H.264 and other)',
      name: 'minBpp',
      type: 'number',
      defaultValue: '0.08',
      inputUI: { type: 'text' },
      tooltip: 'Sources below this skip the encode. 0 = never skip. Uncalibrated starting value: the '
        + '1080p50 F1 source (about 0.059) grew when encoded, a 1080p24 drama (about 0.12) shrank.',
    },
    {
      label: 'Minimum Bits Per Pixel (legacy codecs)',
      name: 'legacyMinBpp',
      type: 'number',
      defaultValue: '0.04',
      inputUI: { type: 'text' },
      tooltip: 'Same test for vc1/mpeg2video/mpeg4/vp8/wmv2/wmv3, which are less efficient than H.264 '
        + 'and so shrink at lower bits per pixel. 0 = never skip.',
    },
    {
      label: 'Assumed Audio kbps',
      name: 'assumedAudioKbps',
      type: 'number',
      defaultValue: '256',
      inputUI: { type: 'text' },
      tooltip: 'Only used when the video bitrate has to be derived from the container bitrate: '
        + 'subtracted for each audio stream that reports no bitrate of its own.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Encode (bits per pixel at or above the threshold, or not measurable)' },
    { number: 2, tooltip: 'Skip (already starved: keep the original)' },
  ],
});

const parseRate = (raw) => {
  if (raw === undefined || raw === null || raw === '') return 0;
  const parts = String(raw).split('/');
  const num = Number(parts[0]);
  const den = parts.length > 1 ? Number(parts[1]) : 1;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
};

const parseDurationSeconds = (raw) => {
  // mkvmerge statistics tag, e.g. "02:40:13.440000000"
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

const pickVideoStream = (streams) => {
  if (!Array.isArray(streams)) return undefined;
  return streams.find((s) => s.codec_type === 'video'
    && !(s.disposition && Number(s.disposition.attached_pic) === 1)
    && !['mjpeg', 'png', 'bmp', 'gif'].includes(String(s.codec_name || '')));
};

/**
 * Returns { bps, source } or { bps: 0, source: 'unknown' }.
 * `videoStream` is a ffprobe stream object; `probe` the whole ffProbeData (for the container fallback).
 */
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

const getFps = (videoStream) => {
  const avg = parseRate(videoStream.avg_frame_rate);
  if (avg > 0 && avg <= 240) return avg;
  const r = parseRate(videoStream.r_frame_rate);
  if (r > 0 && r <= 240) return r;
  return 0;
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  if (!args.variables.user) args.variables.user = {};
  const setVar = (decision, bpp, kbps) => {
    args.variables.user.tdarrGateDecision = decision;
    if (bpp !== undefined) args.variables.user.tdarrSourceBpp = bpp.toFixed(4);
    if (kbps !== undefined) args.variables.user.tdarrSourceVideoKbps = String(Math.round(kbps));
  };
  const done = (outputNumber) => ({ outputFileObj: args.inputFileObj, outputNumber, variables: args.variables });

  if (args.inputs.enabled !== true) {
    args.jobLog('Check Source Efficiency: disabled, encoding without measuring');
    return done(1);
  }

  const probe = args.inputFileObj && args.inputFileObj.ffProbeData;
  const video = pickVideoStream(probe && probe.streams);
  if (!video) {
    setVar('encode-unmeasured');
    args.jobLog('Check Source Efficiency: no video stream found in the probe data, encoding without measuring');
    return done(1);
  }

  const width = Number(video.width);
  const height = Number(video.height);
  const fps = getFps(video);
  const { bps, source } = getVideoBitrate(video, probe, args.inputs.assumedAudioKbps);

  if (!(width > 0 && height > 0 && fps > 0 && bps > 0)) {
    setVar('encode-unmeasured');
    args.jobLog(`Check Source Efficiency: could not measure (width=${video.width}, height=${video.height}, `
      + `fps=${fps || 'unknown'}, bitrate source=${source}); encoding without measuring`);
    return done(1);
  }

  const bpp = bps / (width * height * fps);
  const codec = String(video.codec_name || '');
  const isLegacy = LEGACY_CODECS.includes(codec);
  const threshold = isLegacy ? args.inputs.legacyMinBpp : args.inputs.minBpp;
  const skip = threshold > 0 && bpp < threshold;

  setVar(skip ? 'skip-low-bpp' : 'encode', bpp, bps / 1000);
  args.jobLog(`Check Source Efficiency: ${codec} ${width}x${height} @ ${fps.toFixed(3)} fps, video `
    + `${Math.round(bps / 1000)} kbps (${source}) = ${bpp.toFixed(4)} bits/pixel; threshold `
    + `${threshold} (${isLegacy ? 'legacy' : 'h264/other'}) -> ${skip ? 'SKIP, keep the original' : 'encode'}`);

  return done(skip ? 2 : 1);
};

module.exports = { details, plugin };
