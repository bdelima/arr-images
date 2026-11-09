/**
 * Require English Audio — Local Flow Plugin
 *
 * Checks that the file has at least one audio stream whose language tag is one of the accepted languages
 * (default "eng", the same value the Stream Cleanup flow's "Remove non-english audio" step keeps). Without
 * this check that step removes every audio stream of a file that has none tagged "eng" (for example a single
 * track tagged "rum", or one with no language tag at all), and the flow carries on with a file that has no audio.
 *
 * Output 1: at least one audio stream matches - carry on.
 * Output 2: no audio stream matches (including a file with no audio at all) - wire this output to a Fail Flow
 *           node. The job log lists every audio stream with its language tag so the reason is visible.
 *
 * The match is exact on the stream's tags.language (after trimming), like the removal step's "not equals".
 * Put this node BEFORE the step that removes streams.
 */

const details = () => ({
  name: 'Require English Audio',
  description: 'Output 1 = the file has an audio stream tagged with an accepted language (default eng). '
    + 'Output 2 = it has none: wire it to Fail Flow.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Accepted Audio Languages',
      name: 'languages',
      type: 'string',
      defaultValue: 'eng',
      inputUI: { type: 'text' },
      tooltip: 'Comma separated tags.language values that count as English, e.g. eng or eng,en. Matched '
        + 'exactly. Keep it equal to the value the "Remove non-english audio" step keeps, or a file can pass '
        + 'this check and still lose all its audio there.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'At least one audio stream has an accepted language' },
    { number: 2, tooltip: 'No audio stream has an accepted language (or there is no audio): fail the flow' },
  ],
});

const describeStream = (s) => {
  const tags = s.tags || {};
  const parts = [`#${s.index}`, String(s.codec_name || '?')];
  if (s.channels) parts.push(`${s.channels}ch`);
  parts.push(`language=${tags.language === undefined ? '(none)' : tags.language}`);
  if (tags.title) parts.push(`title="${tags.title}"`);
  return parts.join(' ');
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const accepted = String(args.inputs.languages || '')
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const done = (outputNumber) => ({ outputFileObj: args.inputFileObj, outputNumber, variables: args.variables });

  const probe = args.inputFileObj && args.inputFileObj.ffProbeData;
  const streams = Array.isArray(probe && probe.streams) ? probe.streams : [];
  const audio = streams.filter((s) => s.codec_type === 'audio');

  if (accepted.length === 0) {
    args.jobLog('Require English Audio: no accepted languages configured, not checking');
    return done(1);
  }

  const matching = audio.filter((s) => accepted.includes(String((s.tags && s.tags.language) || '').trim()));
  if (matching.length > 0) {
    args.jobLog(`Require English Audio: ${matching.length} of ${audio.length} audio stream(s) match `
      + `[${accepted.join(', ')}]: ${matching.map(describeStream).join('; ')}`);
    return done(1);
  }

  if (audio.length === 0) {
    args.jobLog('Require English Audio: the file has no audio streams -> FAIL');
  } else {
    args.jobLog(`Require English Audio: none of ${audio.length} audio stream(s) is tagged `
      + `[${accepted.join(', ')}] -> FAIL. Audio streams: ${audio.map(describeStream).join('; ')}`);
  }
  return done(2);
};

module.exports = { details, plugin };
