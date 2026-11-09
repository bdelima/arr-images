const details = () => ({
  name: 'Repair Language Tags',
  description: 'Puts a language tag back on audio and subtitle tracks that lost it. Files remuxed with ffmpeg '
    + '-map_metadata -1 came out with every track language "und". The file is changed ONLY if it carries the damage signature '
    + '(the container was last written by ffmpeg/libavformat, whose muxing application starts with "Lavf") AND it has at least one '
    + 'audio track with no language. Then every audio and subtitle track with no language is set to the configured language '
    + 'in place with mkvpropedit (no remux, the streams are not touched). Tracks that already have a language are never changed. '
    + 'Output 1 = tags repaired, output 2 = nothing to do (the reason is in the job log).',
  style: {
    borderColor: 'green',
  },
  tags: '',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      name: 'language',
      type: 'string',
      defaultValue: 'eng',
      inputUI: { type: 'text' },
      tooltip: 'ISO 639-2 three-letter code written to every untagged audio and subtitle track.',
    },
    {
      name: 'encoderPrefix',
      type: 'string',
      defaultValue: 'Lavf',
      inputUI: { type: 'text' },
      tooltip: 'The file is repaired only if its muxing or writing application starts with this text (case-insensitive). '
        + 'Lavf is libavformat, which ffmpeg writes. Leave empty to skip the check and repair any Matroska file with an untagged audio track.',
    },
    {
      name: 'dryRun',
      type: 'boolean',
      defaultValue: 'false',
      inputUI: { type: 'switch' },
      tooltip: 'Log what would be changed, change nothing, and leave through output 2.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Language tags were repaired' },
    { number: 2, tooltip: 'Nothing to repair (not damaged, not Matroska, or no untagged audio); the file was not changed' },
  ],
});

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const fs = require('fs');
  const path = require('path');
  const { execFile } = require('child_process');
  const { CLI } = require('../../../../FlowHelpers/1.0.0/cliUtils');

  const log = (m) => args.jobLog(`Repair Language Tags: ${m}`);
  const file = args.inputFileObj._id;
  const language = String(args.inputs.language || '').trim().toLowerCase();
  const prefix = String(args.inputs.encoderPrefix || '').trim().toLowerCase();
  const dryRun = args.inputs.dryRun === true || String(args.inputs.dryRun).toLowerCase() === 'true';

  if (!/^[a-z]{3}$/.test(language)) {
    throw new Error(`Repair Language Tags: language must be a three-letter ISO 639-2 code, got "${args.inputs.language}"`);
  }

  // mkvmerge is only used to read the file; mkvpropedit does the writing. mkvmerge sits next to mkvpropedit.
  const propedit = args.mkvpropeditPath || 'mkvpropedit';
  const candidates = [];
  if (path.isAbsolute(propedit)) candidates.push(path.join(path.dirname(propedit), 'mkvmerge'));
  candidates.push('/usr/bin/mkvmerge', 'mkvmerge');
  const mkvmerge = candidates.find((c) => !path.isAbsolute(c) || fs.existsSync(c));

  // A UTF-8 locale, so that non-ASCII file names are read correctly by the MKVToolNix tools.
  const env = { ...process.env, LC_ALL: 'C.UTF-8' };

  const identify = () => new Promise((resolve, reject) => {
    execFile(mkvmerge, ['--identification-format', 'json', '--identify', file], { env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      // exit code 1 is "warnings"; the JSON is still complete
      if (err && err.code !== 1) {
        reject(new Error(`Repair Language Tags: mkvmerge could not read the file (${err.code || err.message})`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Repair Language Tags: could not parse mkvmerge's output: ${e.message}`));
      }
    });
  });

  const isUntagged = (t) => {
    const p = t.properties || {};
    const lang = String(p.language || 'und').toLowerCase();
    const ietf = String(p.language_ietf || '').toLowerCase();
    return lang === 'und' && (ietf === '' || ietf === 'und');
  };

  const notRequired = (reason) => {
    log(`${reason}. The file was not changed.`);
    return { outputFileObj: args.inputFileObj, outputNumber: 2, variables: args.variables };
  };

  const info = await identify();
  const container = info.container || {};
  if (!/matroska|webm/i.test(String(container.type || ''))) {
    return notRequired(`not a Matroska file (container: ${container.type || 'unknown'})`);
  }

  const cp = container.properties || {};
  const apps = [cp.muxing_application, cp.writing_application].filter(Boolean);
  const tracks = info.tracks || [];
  const untaggedAudio = tracks.filter((t) => t.type === 'audio' && isUntagged(t));
  const untaggedSubs = tracks.filter((t) => t.type === 'subtitles' && isUntagged(t));

  if (prefix !== '' && !apps.some((a) => String(a).toLowerCase().startsWith(prefix))) {
    return notRequired(`no damage signature: written by "${apps.join('" / "') || 'unknown'}", not "${args.inputs.encoderPrefix}"`);
  }
  if (untaggedAudio.length === 0) {
    return notRequired('every audio track already has a language');
  }

  const targets = [...untaggedAudio, ...untaggedSubs];
  const spawnArgs = [file];
  targets.forEach((t) => {
    const p = t.properties || {};
    let selector;
    if (Number.isInteger(p.number)) selector = `track:@${p.number}`;
    else if (p.uid !== undefined && p.uid !== null) selector = `track:=${p.uid}`;
    else throw new Error(`Repair Language Tags: track ${t.id} has neither a track number nor a UID, cannot select it`);
    spawnArgs.push('--edit', selector, '--set', `language=${language}`);
  });

  const describe = targets.map((t) => `${t.type} #${t.id}${(t.properties || {}).track_name ? ` "${t.properties.track_name}"` : ''}`).join(', ');
  log(`damage signature found (written by "${apps.join('" / "')}"); ${untaggedAudio.length} untagged audio and ${untaggedSubs.length} untagged subtitle track(s): ${describe}`);

  if (dryRun) {
    return notRequired(`dry run: would set language=${language} on those tracks`);
  }

  const cli = new CLI({
    cli: propedit,
    spawnArgs,
    spawnOpts: { env },
    jobLog: args.jobLog,
    outputFilePath: '',
    inputFileObj: args.inputFileObj,
    logFullCliOutput: args.logFullCliOutput,
    updateWorker: args.updateWorker,
    args,
  });
  const res = await cli.runCli();

  if (res.cliExitCode === 1 && !cli.cancelled) {
    log('mkvpropedit completed with warnings');
  } else if (res.cliExitCode !== 0) {
    log('mkvpropedit failed');
    throw new Error('Repair Language Tags: mkvpropedit failed');
  }

  // Read the file back: every track we meant to change must now carry the language.
  const after = await identify();
  const byId = new Map((after.tracks || []).map((t) => [t.id, t]));
  const wrong = targets.filter((t) => {
    const n = byId.get(t.id);
    return !n || String((n.properties || {}).language || '').toLowerCase() !== language;
  });
  if (wrong.length > 0) {
    throw new Error(`Repair Language Tags: after mkvpropedit, track(s) ${wrong.map((t) => t.id).join(', ')} still do not have language ${language}`);
  }
  log(`set language=${language} on ${targets.length} track(s) and read it back`);

  return { outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables };
};

module.exports = { details, plugin };
