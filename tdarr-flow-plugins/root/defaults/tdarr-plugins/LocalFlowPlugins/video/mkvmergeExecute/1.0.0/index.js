/**
 * mkvmerge Execute — Local Flow Plugin
 *
 * Does the remuxing with mkvmerge instead of ffmpeg. The input can be any container mkvmerge reads (Matroska, MP4/MOV,
 * AVI, MPEG-TS and others); the output is always Matroska (.mkv).
 *
 * Why: ffmpeg's Matroska muxer writes bigger files than mkvmerge (it does not lace audio frames), and the ffmpeg
 * `-map_metadata -1` Stream Cleanup used to strip the title also removed every stream's language/title tags.
 * mkvmerge keeps the per-stream language, title and default/forced flags, and takes the title and the global tags
 * off with explicit options.
 *
 * It reads which streams to keep from the ffmpeg command that Begin Command and the Remove Stream plugins build
 * (args.variables.ffmpegCommand.streams, `removed` flag) and translates that into mkvmerge track selections, so the
 * existing removal nodes keep working. Only stream removal is translated. Other ffmpeg arguments in that command
 * (output arguments, overall arguments) cannot be given to mkvmerge and are logged as ignored.
 *
 * Modes:
 *   all       Every stream that is not removed, in one file.
 *   audioSubs Every audio and subtitle stream that is not removed. No video.
 *   video     Only the first video track. No audio, subtitles or attachments.
 *   combine   The working file (video, usually the encoder output) plus the audio+subs file made earlier by the
 *             audioSubs mode and copied to the cache directory. The video comes from the working file, audio and
 *             subtitles from the other file.
 *
 * Every output has the title and the global tags removed (mkvmerge --title "" --no-global-tags).
 * Attachments (fonts, cover images) are removed unless the command keeps all of them.
 *
 * Track mapping: mkvmerge track ids are matched to the command's streams by position within each type (the 2nd audio
 * stream in the command is the 2nd audio track mkvmerge reports). The counts per type must be equal and the language
 * tags must agree where both are set (the bibliographic and terminologic forms of a code, baq and eus, count as the
 * same). If they do not, the plugin throws, so a wrong track can never be removed.
 *
 * Failures (unreadable file, mapping mismatch, mkvmerge error) throw, which fails the file. mkvmerge exit code 1
 * (warnings) is accepted.
 */

const details = () => ({
  name: 'mkvmerge Execute',
  description: 'Remuxes with mkvmerge (any container in, Matroska out) using the streams kept by the ffmpeg '
    + 'command that Begin Command and the Remove Stream plugins built. Keeps stream language/title tags, removes the '
    + 'title and global tags. Modes: all, audioSubs, video, combine.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Mode',
      name: 'mode',
      type: 'string',
      defaultValue: 'all',
      inputUI: { type: 'dropdown', options: ['all', 'audioSubs', 'video', 'combine'] },
      tooltip: 'all: every kept stream. audioSubs: kept audio and subtitles, no video. video: first video track '
        + 'only. combine: video from the working file plus the audio+subs file in the cache directory.',
    },
    {
      label: 'Source File',
      name: 'source',
      type: 'string',
      defaultValue: 'working',
      inputUI: { type: 'dropdown', options: ['working', 'original'] },
      tooltip: 'Which file to read in modes all, audioSubs and video. working: the file the flow is on now. '
        + 'original: the original library file. The stream list in the ffmpeg command has to describe that file.',
    },
    {
      label: 'Audio+Subs Cache Directory (combine mode)',
      name: 'audioSubsDir',
      type: 'string',
      defaultValue: '/temp/.tdarr-remux-cache',
      inputUI: { type: 'text' },
      tooltip: 'Combine mode reads <this directory>/<original file name without extension>-audiosubs.mkv.',
    },
    {
      label: 'mkvmerge Path',
      name: 'mkvmergePath',
      type: 'string',
      defaultValue: '',
      inputUI: { type: 'text' },
      tooltip: 'Leave empty to use the mkvmerge next to Tdarr\'s mkvpropedit, then /usr/bin/mkvmerge, then mkvmerge '
        + 'from the PATH.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Continue to next plugin' },
  ],
});

const TYPES = [
  { plan: 'video', mkv: 'video', label: 'video' },
  { plan: 'audio', mkv: 'audio', label: 'audio' },
  { plan: 'subtitle', mkv: 'subtitles', label: 'subtitle' },
];

// Language tags are compared only as a second check on the position match above, and the two tools do not spell a
// language the same way: ffmpeg gives the terminologic ISO 639-2 code (eus, fra, ces) where mkvmerge gives the
// bibliographic one (baq, fre, cze), and a raw two-letter tag ("en") shows as is in ffprobe but as "eng" in mkvmerge.
// So both sides are first brought to one canonical form: the primary subtag of a BCP 47 tag, a two-letter ISO 639-1
// code or a bibliographic code turned into the terminologic ISO 639-2 code. A value that is not a language code
// ("xx", which mkvmerge reports as "und"), "und" and an empty tag canonicalize to '' and are not compared. That
// leaves a throw only for two different, known languages. Tables generated from the iso-codes package (ISO 639-2:
// 486 codes, ISO 639-1: 184 codes) and checked against ffprobe and mkvmerge for every code, see the PR.
const BIB_TO_TERM = {
  alb: 'sqi', arm: 'hye', baq: 'eus', bur: 'mya', chi: 'zho', cze: 'ces', dut: 'nld', fre: 'fra', geo: 'kat',
  ger: 'deu', gre: 'ell', ice: 'isl', mac: 'mkd', mao: 'mri', may: 'msa', per: 'fas', rum: 'ron', slo: 'slk',
  tib: 'bod', wel: 'cym',
};

const ISO_639_2 = new Set([
  'aar abk ace ach ada ady afa afh afr ain aka akk ale alg alt amh ang anp apa ara arc arg arn arp art arw asm',
  'ast ath aus ava ave awa aym aze bad bai bak bal bam ban bas bat bej bel bem ben ber bho bih bik bin bis bla',
  'bnt bod bos bra bre btk bua bug bul byn cad cai car cat cau ceb cel ces cha chb che chg chk chm chn cho chp',
  'chr chu chv chy cmc cnr cop cor cos cpe cpf cpp cre crh crp csb cus cym dak dan dar day del den deu dgr din',
  'div doi dra dsb dua dum dyu dzo efi egy eka ell elx eng enm epo est eus ewe ewo fan fao fas fat fij fil fin',
  'fiu fon fra frm fro frr frs fry ful fur gaa gay gba gem gez gil gla gle glg glv gmh goh gon gor got grb grc',
  'grn gsw guj gwi hai hat hau haw heb her hil him hin hit hmn hmo hrv hsb hun hup hye iba ibo ido iii ijo iku',
  'ile ilo ina inc ind ine inh ipk ira iro isl ita jav jbo jpn jpr jrb kaa kab kac kal kam kan kar kas kat kau',
  'kaw kaz kbd kha khi khm kho kik kin kir kmb kok kom kon kor kos kpe krc krl kro kru kua kum kur kut lad lah',
  'lam lao lat lav lez lim lin lit lol loz ltz lua lub lug lui lun luo lus mad mag mah mai mak mal man map mar',
  'mas mdf mdr men mga mic min mis mkd mkh mlg mlt mnc mni mno moh mon mos mri msa mul mun mus mwl mwr mya myn',
  'myv nah nai nap nau nav nbl nde ndo nds nep new nia nic niu nld nno nob nog non nor nqo nso nub nwc nya nym',
  'nyn nyo nzi oci oji ori orm osa oss ota oto paa pag pal pam pan pap pau peo phi phn pli pol pon por pra pro',
  'pus que raj rap rar roa roh rom ron run rup rus sad sag sah sai sal sam san sas sat scn sco sel sem sga sgn',
  'shn sid sin sio sit sla slk slv sma sme smi smj smn smo sms sna snd snk sog som son sot spa sqi srd srn srp',
  'srr ssa ssw suk sun sus sux swa swe syc syr tah tai tam tat tel tem ter tet tgk tgl tha tig tir tiv tkl tlh',
  'tli tmh tog ton tpi tsi tsn tso tuk tum tup tur tut tvl twi tyv udm uga uig ukr umb und urd uzb vai ven vie',
  'vol vot wak wal war was wen wln wol xal xho yao yap yid yor ypk zap zbl zen zgh zha zho znd zul zun zxx zza',
].join(' ').split(' '));

const ISO_639_1 = Object.fromEntries([
  'aa=aar ab=abk ae=ave af=afr ak=aka am=amh an=arg ar=ara as=asm av=ava ay=aym az=aze ba=bak be=bel bg=bul',
  'bh=bih bi=bis bm=bam bn=ben bo=bod br=bre bs=bos ca=cat ce=che ch=cha co=cos cr=cre cs=ces cu=chu cv=chv',
  'cy=cym da=dan de=deu dv=div dz=dzo ee=ewe el=ell en=eng eo=epo es=spa et=est eu=eus fa=fas ff=ful fi=fin',
  'fj=fij fo=fao fr=fra fy=fry ga=gle gd=gla gl=glg gn=grn gu=guj gv=glv ha=hau he=heb hi=hin ho=hmo hr=hrv',
  'ht=hat hu=hun hy=hye hz=her ia=ina id=ind ie=ile ig=ibo ii=iii ik=ipk io=ido is=isl it=ita iu=iku ja=jpn',
  'jv=jav ka=kat kg=kon ki=kik kj=kua kk=kaz kl=kal km=khm kn=kan ko=kor kr=kau ks=kas ku=kur kv=kom kw=cor',
  'ky=kir la=lat lb=ltz lg=lug li=lim ln=lin lo=lao lt=lit lu=lub lv=lav mg=mlg mh=mah mi=mri mk=mkd ml=mal',
  'mn=mon mr=mar ms=msa mt=mlt my=mya na=nau nb=nob nd=nde ne=nep ng=ndo nl=nld nn=nno no=nor nr=nbl nv=nav',
  'ny=nya oc=oci oj=oji om=orm or=ori os=oss pa=pan pi=pli pl=pol ps=pus pt=por qu=que rm=roh rn=run ro=ron',
  'ru=rus rw=kin sa=san sc=srd sd=snd se=sme sg=sag si=sin sk=slk sl=slv sm=smo sn=sna so=som sq=sqi sr=srp',
  'ss=ssw st=sot su=sun sv=swe sw=swa ta=tam te=tel tg=tgk th=tha ti=tir tk=tuk tl=tgl tn=tsn to=ton tr=tur',
  'ts=tso tt=tat tw=twi ty=tah ug=uig uk=ukr ur=urd uz=uzb ve=ven vi=vie vo=vol wa=wln wo=wol xh=xho yi=yid',
  'yo=yor za=zha zh=zho zu=zul',
].join(' ').split(' ').map((p) => p.split('=')));

const normLang = (l) => {
  const v = String(l || '').trim().toLowerCase().split(/[-_]/)[0];
  if (v === '' || v === 'und') return '';
  const code = BIB_TO_TERM[v] || ISO_639_1[v] || v;
  return ISO_639_2.has(code) ? code : '';
};

const describe = (s) => {
  const t = s.tags || {};
  return `#${s.index} ${s.codec_name || '?'}${t.language ? ` ${t.language}` : ''}${t.title ? ` "${t.title}"` : ''}`;
};

// Translates the ffmpeg command's streams into the mkvmerge track ids to keep, per type.
// Throws when the two views of the file do not line up.
const mapTracks = (cmdStreams, identified) => {
  const out = {};
  TYPES.forEach((t) => {
    const planned = cmdStreams.filter((s) => s.codec_type === t.plan);
    const tracks = (identified.tracks || []).filter((tr) => tr.type === t.mkv);
    if (planned.length !== tracks.length) {
      throw new Error(`mkvmerge Execute: the ffmpeg command lists ${planned.length} ${t.label} stream(s) but mkvmerge `
        + `finds ${tracks.length} ${t.label} track(s) in the file, so the tracks cannot be matched safely. `
        + `ffmpeg: [${planned.map(describe).join('; ')}] mkvmerge: [${tracks.map((tr) => `#${tr.id} ${tr.codec} `
          + `${(tr.properties || {}).language || ''}`).join('; ')}]`);
    }
    planned.forEach((s, i) => {
      const rawA = String((s.tags && s.tags.language) || '').trim().toLowerCase();
      const rawB = String((tracks[i].properties || {}).language || '').trim().toLowerCase();
      const a = normLang(rawA);
      const b = normLang(rawB);
      if (a !== '' && b !== '' && a !== b) {
        throw new Error(`mkvmerge Execute: ${t.label} stream ${i + 1} is tagged "${rawA}" for ffmpeg (${describe(s)}) but `
          + `"${rawB}" for mkvmerge (track ${tracks[i].id}), so the tracks cannot be matched safely`);
      }
    });
    out[t.plan] = planned.map((s, i) => ({ stream: s, track: tracks[i] }));
  });
  return out;
};

const trackArgs = (flag, noFlag, ids) => (ids.length > 0 ? [flag, ids.join(',')] : [noFlag]);

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const fs = require('fs');
  const path = require('path');
  const { execFile } = require('child_process');
  const { CLI } = require('../../../../FlowHelpers/1.0.0/cliUtils');
  const { getPluginWorkDir, getFileName } = require('../../../../FlowHelpers/1.0.0/fileUtils');

  const mode = String(args.inputs.mode || 'all');
  const source = String(args.inputs.source || 'working');
  if (!['all', 'audioSubs', 'video', 'combine'].includes(mode)) {
    throw new Error(`mkvmerge Execute: unknown mode "${mode}"`);
  }

  const bin = (() => {
    if (args.inputs.mkvmergePath) return String(args.inputs.mkvmergePath);
    const candidates = [];
    if (args.mkvpropeditPath) candidates.push(path.join(path.dirname(args.mkvpropeditPath), 'mkvmerge'));
    candidates.push('/usr/bin/mkvmerge');
    return candidates.find((c) => fs.existsSync(c)) || 'mkvmerge';
  })();

  // mkvmerge opens file names in the locale's encoding. With no locale set (the C locale, which a container can
  // have) it cannot open a name with accented or non-Latin characters ("The file '' could not be opened"), so run it
  // with a UTF-8 locale. Reproduced with mkvmerge 82.0 in a sandbox; not checked in the Tdarr containers.
  const env = { ...process.env, LC_ALL: 'C.UTF-8' };

  const identify = (file) => new Promise((resolve, reject) => {
    execFile(bin, ['--identification-format', 'json', '--identify', file], { maxBuffer: 64 * 1024 * 1024, env },
      (err, stdout, stderr) => {
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch (e) {
          reject(new Error(`mkvmerge Execute: could not identify ${file} with ${bin}: `
            + `${(err && err.message) || ''} ${String(stderr || stdout).slice(0, 500)}`));
          return;
        }
        if (!parsed.container || parsed.container.recognized === false || parsed.container.supported === false) {
          reject(new Error(`mkvmerge Execute: mkvmerge does not support the container of ${file} `
            + `(${(parsed.container && parsed.container.type) || 'unknown'})`));
          return;
        }
        resolve(parsed);
      });
  });

  const cmd = args.variables && args.variables.ffmpegCommand;
  const workingFile = args.inputFileObj._id;
  const originalFile = (args.originalLibraryFile && args.originalLibraryFile._id) || workingFile;
  const nameBase = (args.originalLibraryFile && args.originalLibraryFile.fileNameWithoutExtension)
    || getFileName(originalFile);

  const outDir = getPluginWorkDir(args);
  const outputFilePath = `${outDir}/${getFileName(workingFile)}.mkv`;

  const spawnArgs = ['-o', outputFilePath, '--no-global-tags', '--title', ''];

  if (mode === 'combine') {
    const audioSubsFile = path.join(String(args.inputs.audioSubsDir), `${nameBase}-audiosubs.mkv`);
    if (!fs.existsSync(audioSubsFile)) {
      throw new Error(`mkvmerge Execute: the audio+subs file ${audioSubsFile} does not exist`);
    }
    spawnArgs.push('--no-audio', '--no-subtitles', '--no-attachments', workingFile, '--no-video', audioSubsFile);
    args.jobLog(`mkvmerge Execute (combine): video from ${workingFile}, audio and subtitles from ${audioSubsFile}`);
  } else {
    if (!cmd || !Array.isArray(cmd.streams)) {
      throw new Error('mkvmerge Execute: no ffmpeg command in progress, place this after Begin Command');
    }
    const inputFile = source === 'original' ? originalFile : workingFile;
    const identified = await identify(inputFile);
    const map = mapTracks(cmd.streams, identified);

    const keptIds = (type) => map[type].filter((m) => !m.stream.removed).map((m) => m.track.id);
    if (mode === 'video') {
      if (map.video.length === 0) throw new Error(`mkvmerge Execute: ${inputFile} has no video track`);
      spawnArgs.push('--video-tracks', String(map.video[0].track.id), '--no-audio', '--no-subtitles',
        '--no-attachments');
    } else {
      const video = mode === 'audioSubs' ? [] : keptIds('video');
      const audio = keptIds('audio');
      const subs = keptIds('subtitle');
      spawnArgs.push(...trackArgs('--video-tracks', '--no-video', video));
      spawnArgs.push(...trackArgs('--audio-tracks', '--no-audio', audio));
      spawnArgs.push(...trackArgs('--subtitle-tracks', '--no-subtitles', subs));
      const attachments = cmd.streams.filter((s) => s.codec_type === 'attachment');
      const keepAttachments = attachments.length > 0 && attachments.every((s) => !s.removed);
      if (!keepAttachments) {
        spawnArgs.push('--no-attachments');
        if (attachments.some((s) => !s.removed)) {
          args.jobLog('mkvmerge Execute: only some attachments are kept in the command, but mkvmerge Execute keeps all '
            + 'or none. None are kept.');
        }
      }
    }
    spawnArgs.push(inputFile);

    const ignored = [];
    cmd.streams.forEach((s) => {
      if (!s.removed && (s.outputArgs || []).some((a) => String(a).trim() !== '')) ignored.push(`stream #${s.index}`);
    });
    if ((cmd.overallOuputArguments || []).length > 0) ignored.push('overall output arguments');
    if ((cmd.overallInputArguments || []).length > 0) ignored.push('overall input arguments');
    if (ignored.length > 0) {
      args.jobLog(`mkvmerge Execute: ffmpeg-only arguments cannot be given to mkvmerge and are ignored: `
        + `${ignored.join(', ')}`);
    }

    const summary = TYPES.map((t) => `${t.label}: ${map[t.plan].map((m) => `${m.track.id}${m.stream.removed ? 'x' : ''}`)
      .join(',') || '-'}`).join('; ');
    args.jobLog(`mkvmerge Execute (${mode}, ${source}): ${inputFile} track ids (x = removed) ${summary}`);
  }

  args.jobLog(`mkvmerge Execute: ${bin} ${spawnArgs.map((a) => (a === '' ? '""' : a)).join(' ')}`);

  // The arguments go to mkvmerge through a JSON options file (`mkvmerge @file`), not on the command line. Tdarr's CLI
  // helper drops an empty-string argument, so `--title ""` arrived as a bare `--title` and mkvmerge took the next
  // option as the title (job log 2026-11-09: "The file '0' could not be opened"). A file keeps every argument exactly,
  // the empty title and paths with spaces included.
  const optionsFile = `${outDir}/mkvmerge-options.json`;
  fs.writeFileSync(optionsFile, JSON.stringify(spawnArgs), 'utf8');

  // The helper's updateETA stats outputFilePath on every progress tick and sends the worker that file's size and an estimated
  // final size (size / percentage), which the worker shows as the C: and T: figures. A remux is not a compression step and the
  // size of mkvmerge's output at a given percentage does not follow the percentage, so the figures were junk (C:622% T:76% on
  // a video remux, C:12% T:12% on audio and subtitles). Naming a path that never exists makes the helper send 0 for both,
  // as Run VMAF does; the percentage and the ETA do not depend on it.
  const noStatsFile = `${outputFilePath}.no-size-stats`;
  const cli = new CLI({
    cli: bin,
    spawnArgs: [`@${optionsFile}`],
    spawnOpts: { env },
    jobLog: args.jobLog,
    outputFilePath: noStatsFile,
    inputFileObj: args.inputFileObj,
    logFullCliOutput: args.logFullCliOutput,
    updateWorker: args.updateWorker,
    args,
  });

  // Tdarr's CLI helper only reads progress from ffmpeg, HandBrake and a few other encoders (it goes by the program
  // name), so mkvmerge showed no percentage and the step looked hung. mkvmerge prints "Progress: N%" while it works;
  // pass that on to the worker. This relies on the helper calling its parseOutput member for each chunk of output and
  // having an updateETA member for the ETA (read on Tdarr master, not checked against the installed version). If the
  // helper has no such members the percentage is still sent without an ETA, or nothing happens; the remux itself is
  // never affected.
  const originalParse = cli.parseOutput;
  let lastPercent = -1;
  cli.parseOutput = (data) => {
    try {
      if (typeof originalParse === 'function') originalParse.call(cli, data);
      const found = [...String(data).matchAll(/Progress:\s*(\d{1,3})%/g)];
      if (found.length === 0) return;
      const percentage = Math.min(100, Number(found[found.length - 1][1]));
      if (percentage <= lastPercent) return;
      lastPercent = percentage;
      if (percentage > 0 && typeof args.updateWorker === 'function') {
        args.updateWorker({ percentage });
        if (typeof cli.updateETA === 'function') Promise.resolve(cli.updateETA(percentage)).catch(() => {});
      }
    } catch (e) {
      // progress is cosmetic: never let it break the remux
    }
  };

  const res = await cli.runCli();

  try {
    fs.unlinkSync(optionsFile);
  } catch (e) {
    args.jobLog(`mkvmerge Execute: could not remove ${optionsFile}: ${e.message}`);
  }

  if (res.cliExitCode === 1 && !cli.cancelled) {
    args.jobLog('mkvmerge Execute: mkvmerge finished with warnings');
  } else if (res.cliExitCode !== 0) {
    args.jobLog('mkvmerge Execute: mkvmerge failed');
    throw new Error('mkvmerge Execute: mkvmerge failed');
  }
  if (!fs.existsSync(outputFilePath) || fs.statSync(outputFilePath).size === 0) {
    throw new Error(`mkvmerge Execute: mkvmerge reported success but ${outputFilePath} is missing or empty`);
  }

  if (cmd) cmd.init = false;

  return { outputFileObj: { _id: outputFilePath }, outputNumber: 1, variables: args.variables };
};

module.exports = { details, plugin };
