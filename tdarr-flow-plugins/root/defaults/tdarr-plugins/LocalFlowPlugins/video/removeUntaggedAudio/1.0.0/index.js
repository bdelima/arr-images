/**
 * Remove Untagged Audio — Local Flow Plugin
 *
 * Marks for removal every audio stream that has no language tag (no tags.language, or an empty one), as long as
 * at least one audio stream with an accepted language (default "eng") is staying. Use it right after the
 * "Remove non-english audio" step in Stream Cleanup.
 *
 * Why it is needed: the stock "Remove Stream By Property" plugin silently skips a stream that does not have the
 * property it is asked to check (it returns before it removes or logs anything). So "tags.language not_equals eng"
 * removes a stream tagged "rum" but keeps one with no language tag at all. This plugin closes that gap.
 *
 * Safety: if no audio stream with an accepted language would remain, nothing is removed and the reason is logged,
 * so this plugin can never take away the last audio stream. (Require English Audio, earlier in the flow, is what
 * fails a file that has no English audio.)
 *
 * Place it after Begin Command (it works on the ffmpeg command's stream list, like the stock removal plugins).
 */

const details = () => ({
  name: 'Remove Untagged Audio',
  description: 'Removes audio streams that have no language tag, provided an audio stream with an accepted '
    + 'language (default eng) stays. Place after Remove non-english audio.',
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
      tooltip: 'Comma separated tags.language values that count as English. Untagged audio is only removed '
        + 'when at least one remaining audio stream has one of these. Keep it equal to Require English Audio.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Continue to next plugin' },
  ],
});

const describeStream = (s) => {
  const tags = s.tags || {};
  const parts = [`#${s.index}`, String(s.codec_name || '?')];
  if (s.channels) parts.push(`${s.channels}ch`);
  if (tags.title) parts.push(`title="${tags.title}"`);
  return parts.join(' ');
};

const languageOf = (s) => String((s.tags && s.tags.language) || '').trim();

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const done = () => ({ outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables });

  const cmd = args.variables && args.variables.ffmpegCommand;
  if (!cmd || !Array.isArray(cmd.streams)) {
    args.jobLog('Remove Untagged Audio: no ffmpeg command in progress (place this after Begin Command), doing nothing');
    return done();
  }

  const accepted = String(args.inputs.languages || '')
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l !== '');

  const audio = cmd.streams.filter((s) => s.codec_type === 'audio' && !s.removed);
  const untagged = audio.filter((s) => languageOf(s) === '');

  if (untagged.length === 0) {
    args.jobLog('Remove Untagged Audio: no untagged audio streams');
    return done();
  }

  const staying = audio.filter((s) => languageOf(s) !== '' && accepted.includes(languageOf(s)));
  if (staying.length === 0) {
    args.jobLog(`Remove Untagged Audio: ${untagged.length} untagged audio stream(s) found but no audio stream `
      + `tagged [${accepted.join(', ')}] stays, so nothing is removed: ${untagged.map(describeStream).join('; ')}`);
    return done();
  }

  untagged.forEach((s) => {
    // eslint-disable-next-line no-param-reassign
    s.removed = true;
    args.jobLog(`Removing stream index ${s.index} because it is audio with no language tag, and `
      + `${staying.length} audio stream(s) tagged [${accepted.join(', ')}] stay (${describeStream(s)})`);
  });
  return done();
};

module.exports = { details, plugin };
