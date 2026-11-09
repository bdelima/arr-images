const details = () => ({
  name: 'Tag Output Metadata',
  description: 'Writes every accumulated output tag (encode params, quality tier, '
    + 'classifySource verdict, pipeline version, source bits per pixel, size ratio, VMAF score, step trail) in one mkvpropedit --tags '
    + 'global call. Must be the ONLY node that writes global tags (mkvpropedit --tags '
    + 'replaces rather than merges) and must run after Stream Cleanup has already '
    + 'removed the existing global tags (mkvmerge --no-global-tags).',
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

  const tagList = [
    ['TDARR_ENCODE_PARAMS', v.tdarrEncodeParams],
    ['TDARR_QUALITY_TIER', v.tdarrQualityTier],
    ['TDARR_SOURCE_CLASS', v.tdarrSourceClass],
    ['TDARR_PIPELINE_VERSION', args.inputs.pipelineVersion],
    ['TDARR_SOURCE_BPP', v.tdarrSourceBpp],
    ['TDARR_SIZE_RATIO', sizeRatio],
    ['TDARR_VMAF_SCORE', (v.vmafMean !== undefined)
      ? `mean=${v.vmafMean};min=${v.vmafMin};p1=${v.vmafP1}`
      : undefined],
    ['TDARR_TRAIL', v.tdarrTrail],
  ].filter(([, val]) => val !== undefined && val !== null && val !== '');

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
