const details = () => ({
  name: 'Tag Output Metadata',
  description: 'Writes every accumulated output tag (encode params, quality tier, '
    + 'classifySource verdict, pipeline version, source bits per pixel, source video and peak bitrate, size ratio, VMAF score, step trail) in one mkvpropedit --tags '
    + 'global call. Must be the ONLY node that writes global tags (mkvpropedit --tags '
    + 'replaces rather than merges) and must run after Stream Cleanup has already '
    + 'removed the existing global tags (mkvmerge --no-global-tags). The TDARR_ tags the original file already carries are '
    + 'read first: when this run did not encode (the trail has no converter-encode-done), the tags that describe the earlier '
    + 'encode are kept, and TDARR_ENCODE_VERSION and TDARR_ENCODE_TRAIL keep that run\'s pipeline version and step trail. '
    + 'TDARR_PIPELINE_VERSION and TDARR_TRAIL always describe this run.',
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
      name: 'pipelineVersion',
      type: 'string',
      defaultValue: '2026.11',
      inputUI: { type: 'text' },
      tooltip: 'Pipeline/flow version stamp burned into every file this node runs on.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Continue to next plugin' },
  ],
});

// Adds this node's own entry to the step trail (Flow Variable tdarrTrail, see Mark Step) in the same format, so the
// trail written to the file ends with the point where the output was tagged, directly before Replace Original File.
// Copied from Mark Step rather than required from it, so this plugin does not depend on another plugin file.
const appendTrailEntry = (args, label) => {
  if (!args.variables.user) args.variables.user = {};
  const clean = (s) => String(s === undefined || s === null ? '' : s).trim().replace(/[^A-Za-z0-9._-]/g, '-');
  const existing = String(args.variables.user.tdarrTrail || '')
    .split(';').map((e) => e.trim()).filter((e) => e !== '');
  const last = existing.reduce((m, e) => {
    const n = Number(e.split('|')[0]);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  let node = '';
  try {
    node = (args.configVars && args.configVars.config && args.configVars.config.nodeName)
      || (args.config && args.config.nodeName) || '';
  } catch (e) {
    node = '';
  }
  const entry = [last + 1, label, clean(node) || 'unknown-node', clean(args.workerType) || 'unknown-worker',
    new Date().toISOString()].join('|');
  args.variables.user.tdarrTrail = existing.length > 0 ? `${existing.join(';')};${entry}` : entry;
  return entry;
};

// Tags that describe an encode. A run that does not encode keeps the ones the original already has; a run that encodes
// replaces all of them. TDARR_ENCODE_VERSION and TDARR_ENCODE_TRAIL are copies of TDARR_PIPELINE_VERSION and TDARR_TRAIL
// taken at the encoding run, so a later pass (which overwrites those two) leaves the encode run on record.
const ENCODE_TAGS = [
  'TDARR_ENCODE_PARAMS', 'TDARR_QUALITY_TIER', 'TDARR_SOURCE_CLASS', 'TDARR_SOURCE_BPP', 'TDARR_SOURCE_VIDEO_KBPS',
  'TDARR_SOURCE_PEAK_KBPS', 'TDARR_SIZE_RATIO', 'TDARR_VMAF_SCORE', 'TDARR_ENCODE_VERSION', 'TDARR_ENCODE_TRAIL',
];
// Tags that always describe the run that is writing them.
const RUN_TAGS = ['TDARR_PIPELINE_VERSION', 'TDARR_TRAIL'];

// true when the step trail holds an entry with this label (entries are "n|label|node|worker|time", separated by ";")
const trailHasLabel = (trail, label) => String(trail || '')
  .split(';').some((entry) => entry.trim().split('|')[1] === label);

// ffmpeg's ffmetadata text: "KEY=value" lines before the first [SECTION], with \ = ; # and newline escaped by a backslash.
const parseFfmetadata = (text) => {
  const unescape = (str) => str.replace(/\\(.)/g, '$1');
  const found = {};
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('[')) break;
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue;
    let eq = -1;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === '\\') {
        i += 1;
      } else if (line[i] === '=') {
        eq = i;
        break;
      }
    }
    if (eq > 0) found[unescape(line.slice(0, eq)).toUpperCase()] = unescape(line.slice(eq + 1));
  }
  return found;
};

// The TDARR_ tags of the original file, as { TDARR_NAME: value }, and where they came from. First choice is the probe data
// Tdarr already holds (ffprobe lists a Matroska file's global tags under format.tags). When that has none, the file is asked
// directly with ffmpeg, in case the probe data was taken without the format section. { source: 'none' } when there are none.
const readExistingTags = async (args) => {
  const pick = (all) => {
    const out = {};
    Object.keys(all || {}).forEach((k) => {
      if (/^TDARR_/i.test(k) && all[k] !== undefined && all[k] !== null && String(all[k]) !== '') out[k.toUpperCase()] = String(all[k]);
    });
    return out;
  };
  const probe = args.originalLibraryFile && args.originalLibraryFile.ffProbeData;
  const fromProbe = pick(probe && probe.format && probe.format.tags);
  if (Object.keys(fromProbe).length > 0) return { tags: fromProbe, source: 'probe data' };

  const original = args.originalLibraryFile && args.originalLibraryFile._id;
  if (!original || !args.ffmpegPath) return { tags: {}, source: 'none' };
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    let out = '';
    let child;
    const finish = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
      finish({ tags: {}, source: 'none', note: 'ffmpeg timed out' });
    }, 60000);
    try {
      child = spawn(args.ffmpegPath, ['-nostdin', '-v', 'error', '-i', original, '-f', 'ffmetadata', '-']);
    } catch (e) {
      finish({ tags: {}, source: 'none', note: `could not start ffmpeg: ${e.message}` });
      return;
    }
    child.on('error', (e) => finish({ tags: {}, source: 'none', note: `ffmpeg: ${e.message}` }));
    child.stdout.on('data', (d) => { if (out.length < 1000000) out += d.toString(); });
    child.on('close', (code) => {
      if (code !== 0) {
        finish({ tags: {}, source: 'none', note: `ffmpeg exit ${code}` });
        return;
      }
      const tags = pick(parseFfmetadata(out));
      finish({ tags, source: Object.keys(tags).length > 0 ? 'ffmpeg' : 'none' });
    });
  });
};

// Works out the tag list to write. fresh: this run's values; existing: the original's TDARR_ tags; encodedThisRun: whether
// this run re-encoded the video. Returns { list: [[name, value], ...], kept: [names kept from the original] }.
const mergeTags = ({ fresh, existing, encodedThisRun }) => {
  const result = {};
  const kept = [];
  const known = new Set([...ENCODE_TAGS, ...RUN_TAGS]);

  // tags this plugin does not know about (written by something else, or by a later version) are carried over unchanged
  Object.keys(existing).forEach((name) => {
    if (!known.has(name)) {
      result[name] = existing[name];
      kept.push(name);
    }
  });

  const wasEncoded = Boolean(existing.TDARR_ENCODE_PARAMS || existing.TDARR_ENCODE_TRAIL);
  if (!encodedThisRun && wasEncoded) {
    // a later pass over a file this pipeline already encoded: the encode tags stay as the encode run wrote them
    ENCODE_TAGS.forEach((name) => {
      if (existing[name] !== undefined) {
        result[name] = existing[name];
        kept.push(name);
      }
    });
  } else {
    ENCODE_TAGS.forEach((name) => {
      if (fresh[name] !== undefined) result[name] = fresh[name];
    });
    if (encodedThisRun) {
      if (fresh.TDARR_PIPELINE_VERSION !== undefined) result.TDARR_ENCODE_VERSION = fresh.TDARR_PIPELINE_VERSION;
      if (fresh.TDARR_TRAIL !== undefined) result.TDARR_ENCODE_TRAIL = fresh.TDARR_TRAIL;
    }
  }
  RUN_TAGS.forEach((name) => {
    if (fresh[name] !== undefined) result[name] = fresh[name];
  });

  const order = [...ENCODE_TAGS, ...RUN_TAGS];
  const list = [
    ...order.filter((name) => result[name] !== undefined).map((name) => [name, result[name]]),
    ...Object.keys(result).filter((name) => !known.has(name)).sort().map((name) => [name, result[name]]),
  ];
  return { list, kept };
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const fs = require('fs');
  const path = require('path');
  const { CLI } = require('../../../../FlowHelpers/1.0.0/cliUtils');

  // the trail gets its closing entry first, so the tag below includes it
  args.jobLog(`Tag Output Metadata: TRAIL ${appendTrailEntry(args, 'tag-output-metadata')}`);

  const v = args.variables.user || {};

  // Output size as a percentage of the original, from the files themselves (both exist at this point).
  let sizeRatio;
  try {
    const newBytes = fs.statSync(args.inputFileObj._id).size;
    const oldBytes = fs.statSync(args.originalLibraryFile._id).size;
    if (newBytes > 0 && oldBytes > 0) sizeRatio = `${((newBytes / oldBytes) * 100).toFixed(1)}%`;
  } catch (e) {
    args.jobLog(`Tag Output Metadata: could not work out the size ratio: ${e.message}`);
  }

  const freshTags = {
    TDARR_ENCODE_PARAMS: v.tdarrEncodeParams,
    TDARR_QUALITY_TIER: v.tdarrQualityTier,
    TDARR_SOURCE_CLASS: v.tdarrSourceClass,
    TDARR_PIPELINE_VERSION: args.inputs.pipelineVersion,
    TDARR_SOURCE_BPP: v.tdarrSourceBpp,
    TDARR_SOURCE_VIDEO_KBPS: v.tdarrSourceVideoKbps,
    TDARR_SOURCE_PEAK_KBPS: v.tdarrSourcePeakKbps,
    TDARR_SIZE_RATIO: sizeRatio,
    TDARR_VMAF_SCORE: (v.vmafMean !== undefined)
      ? `mean=${v.vmafMean};min=${v.vmafMin};p1=${v.vmafP1}`
      : undefined,
    TDARR_TRAIL: v.tdarrTrail,
  };
  Object.keys(freshTags).forEach((k) => {
    if (freshTags[k] === undefined || freshTags[k] === null || freshTags[k] === '') delete freshTags[k];
  });

  const existing = await readExistingTags(args);
  const encodedThisRun = trailHasLabel(v.tdarrTrail, 'converter-encode-done');
  const merged = mergeTags({ fresh: freshTags, existing: existing.tags, encodedThisRun });
  const tagList = merged.list;
  args.jobLog(`Tag Output Metadata: ${encodedThisRun ? 'this run re-encoded the video, so the encode tags are rewritten' : 'this run did not re-encode the video'}; `
    + `the original file's TDARR_ tags: ${Object.keys(existing.tags).length} found (${existing.source}${existing.note ? `, ${existing.note}` : ''})`
    + `${merged.kept.length > 0 ? `; kept from the original: ${merged.kept.join(', ')}` : ''}`);

  if (tagList.length === 0) {
    args.jobLog('Tag Output Metadata: nothing populated to write, skipping mkvpropedit call');
    return { outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables };
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const simpleTagsXml = tagList
    .map(([name, val]) => `    <Simple>\n      <Name>${esc(name)}</Name>\n      <String>${esc(val)}</String>\n    </Simple>`)
    .join('\n');

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE Tags SYSTEM "matroskatags.dtd">\n'
    + `<Tags>\n  <Tag>\n${simpleTagsXml}\n  </Tag>\n</Tags>\n`;

  const safeId = args.inputFileObj._id.replace(/[^a-zA-Z0-9]/g, '_');
  const tagsFilePath = path.join('/temp', `tdarr-tags-${safeId}.xml`);
  fs.writeFileSync(tagsFilePath, xml, 'utf8');

  const cli = new CLI({
    cli: args.mkvpropeditPath,
    spawnArgs: ['--tags', `global:${tagsFilePath}`, args.inputFileObj._id],
    spawnOpts: {},
    jobLog: args.jobLog,
    outputFilePath: '',
    inputFileObj: args.inputFileObj,
    logFullCliOutput: args.logFullCliOutput,
    updateWorker: args.updateWorker,
    args,
  });

  const res = await cli.runCli();

  try {
    fs.unlinkSync(tagsFilePath);
  } catch (e) {
    args.jobLog(`Tag Output Metadata: could not remove scratch file ${tagsFilePath}: ${e.message}`);
  }

  if (res.cliExitCode === 1 && !cli.cancelled) {
    args.jobLog('Tag Output Metadata: mkvpropedit completed with warnings');
  } else if (res.cliExitCode !== 0) {
    args.jobLog('Tag Output Metadata: mkvpropedit failed');
    throw new Error('Tag Output Metadata: mkvpropedit failed');
  }

  return { outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables };
};

module.exports = { details, plugin };
