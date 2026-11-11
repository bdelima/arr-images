const details = () => ({
  name: 'Repair Language Tags',
  description: 'Puts a language tag back on audio and subtitle tracks that lost it. A Matroska file is changed in one of two cases, '
    + 'both done in place with mkvpropedit (no remux, the streams are not touched), and tracks that already have a language are never changed. '
    + '(1) Damage signature: the container was last written by ffmpeg/libavformat (muxing application starts with "Lavf", as left by '
    + 'a remux with -map_metadata -1) AND it has at least one audio track with no language. Every audio and subtitle track with no language '
    + 'is then set to the configured language. '
    + '(2) Video language: the file has exactly one audio track, that track has no language, and the first video track has a language equal '
    + 'to the configured language, written either as the three-letter code (eng) or only as a BCP 47 tag (en, en-US). '
    + 'The audio track is then given the configured three-letter language (only the audio track is changed). '
    + 'A video track with no language, or with a different language, never causes a change, because output 1 is treated as "now has the configured language". '
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
      tooltip: 'ISO 639-2 three-letter code. Case 1 writes it to every untagged audio and subtitle track. '
        + 'Case 2 applies only when the video track already has exactly this language.',
    },
    {
      name: 'encoderPrefix',
      type: 'string',
      defaultValue: 'Lavf',
      inputUI: { type: 'text' },
      tooltip: 'Case 1 only: the file is repaired only if its muxing or writing application starts with this text (case-insensitive). '
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
    { number: 2, tooltip: 'Nothing to repair (not Matroska, no damage signature and no single untagged audio track under a tagged video track); the file was not changed' },
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

  // A track can carry its language as the legacy three-letter code ("eng") or only as a BCP 47 tag ("en", "en-US").
  // mkvmerge then reports language "und" with language_ietf "en", and ffprobe shows no tag at all. Both spellings count as the
  // configured language for the video track. The two-letter form is known only for the languages in this table.
  const TWO_LETTER = {
    eng: 'en', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', ita: 'it', por: 'pt', dut: 'nl', nld: 'nl', swe: 'sv',
    nor: 'no', dan: 'da', fin: 'fi', pol: 'pl', rus: 'ru', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', ara: 'ar', heb: 'he',
    hin: 'hi', tur: 'tr', ukr: 'uk', gre: 'el', ell: 'el', cze: 'cs', ces: 'cs', hun: 'hu', rum: 'ro', ron: 'ro',
  };
  const hasLanguage = (t, wanted) => {
    const p = t.properties || {};
    if (String(p.language || '').toLowerCase() === wanted) return true;
    const primary = String(p.language_ietf || '').toLowerCase().split('-')[0];
    return primary !== '' && (primary === wanted || primary === TWO_LETTER[wanted]);
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
  const audioTracks = tracks.filter((t) => t.type === 'audio');
  const untaggedAudio = audioTracks.filter(isUntagged);
  const untaggedSubs = tracks.filter((t) => t.type === 'subtitles' && isUntagged(t));
  const video = tracks.find((t) => t.type === 'video');

  const hasSignature = prefix === '' || apps.some((a) => String(a).toLowerCase().startsWith(prefix));

  let targets;
  let why;
  if (hasSignature && untaggedAudio.length > 0) {
    // Case 1: the damage signature. Every untagged audio and subtitle track gets the configured language.
    targets = [...untaggedAudio, ...untaggedSubs];
    const describe = targets.map((t) => `${t.type} #${t.id}${(t.properties || {}).track_name ? ` "${t.properties.track_name}"` : ''}`).join(', ');
    why = `damage signature found (written by "${apps.join('" / "')}"); ${untaggedAudio.length} untagged audio and ${untaggedSubs.length} untagged subtitle track(s): ${describe}`;
  } else {
    // Case 2: exactly one audio track, with no language, in a file whose first video track is tagged with the configured language.
    const reasons = [];
    if (hasSignature) {
      // The signature matched but no audio track is untagged, so the video-language rule has nothing to do either.
      return notRequired('every audio track already has a language');
    }
    reasons.push(`no damage signature: written by "${apps.join('" / "') || 'unknown'}", not "${args.inputs.encoderPrefix}"`);
    if (audioTracks.length !== 1) {
      reasons.push(`the video-language rule needs exactly one audio track, the file has ${audioTracks.length}`);
    } else if (!isUntagged(audioTracks[0])) {
      reasons.push('the only audio track already has a language');
    } else if (!video) {
      reasons.push('the video-language rule found no video track');
    } else if (isUntagged(video)) {
      reasons.push('the video-language rule found a video track with no language');
    } else if (!hasLanguage(video, language)) {
      const vp = video.properties || {};
      reasons.push(`the video track's language is "${vp.language}"${vp.language_ietf ? ` (${vp.language_ietf})` : ''}, not "${language}", so the audio track was not given it`);
    } else {
      targets = [audioTracks[0]];
      why = `the file has exactly one audio track (#${audioTracks[0].id}), it has no language, and the video track (#${video.id}) is tagged "${language}": giving the audio track the video track's language`;
    }
    if (!targets) {
      return notRequired(reasons.join('; '));
    }
  }

  const spawnArgs = [file];
  targets.forEach((t) => {
    const p = t.properties || {};
    let selector;
    if (Number.isInteger(p.number)) selector = `track:@${p.number}`;
    else if (p.uid !== undefined && p.uid !== null) selector = `track:=${p.uid}`;
    else throw new Error(`Repair Language Tags: track ${t.id} has neither a track number nor a UID, cannot select it`);
    spawnArgs.push('--edit', selector, '--set', `language=${language}`);
  });

  log(why);

  if (dryRun) {
    return notRequired(`dry run: would set language=${language} on ${targets.length} track(s)`);
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
