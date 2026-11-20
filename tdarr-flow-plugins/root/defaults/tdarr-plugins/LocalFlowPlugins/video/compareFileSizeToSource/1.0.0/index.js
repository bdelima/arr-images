/**
 * Compare File Size To Source — Local Flow Plugin
 *
 * Compares the size of the working file with the size of a reference file, by default the video-only source the Encoder
 * flow keeps in the Flow Variable videoOnlySource. It exists for the VMAF re-encode loop: each pass lowers the quality
 * number, which makes the encode bigger, so the loop should stop once the encode is no longer smaller than the video it
 * came from. The standard Compare File Size plugins cannot do this, because they compare with the original library file,
 * which still carries the audio and subtitles that the video-only encode does not.
 *
 * Both sizes are read from the files themselves, in bytes, on the node the plugin runs on. The reference file has to be
 * reachable from that node under the path given, the same way Run VMAF Quality Check needs its reference file.
 *
 * A node that leaves the Reference file input empty or at its default needs nothing set: the plugin reads the Flow
 * Variable videoOnlySource itself. Any other value (a path, or a template Tdarr resolves) is used as given.
 *
 * The size limit is a percentage of the reference file, set by the Maximum size input (default 100, the reference file's own
 * size). With 100 the plugin behaves as it always has: the working file has to be smaller than the reference file. With a
 * lower number, for example 85, the working file has to be smaller than 85% of the reference file, so an encode that saves
 * less than 15% counts as not worth keeping. A number above 100 is allowed (it accepts a working file somewhat larger than
 * the reference).
 *
 * Output 1: the working file is smaller than the limit (Maximum size percent of the reference file). Continue (another
 * pass can still help).
 * Output 2: the working file is at the limit or larger (with the default 100: the same size as the reference file, or
 * larger). Stop re-encoding.
 *
 * The plugin fails the flow (with the reason in the job log) if the reference path is empty, either file cannot be read, or
 * the Maximum size is not a number above 0, so a wrong setting shows up at once instead of the loop carrying on without
 * its limit. It changes nothing but the output it leaves through.
 */

const fs = require('fs');

// The default of the Reference file input. Tdarr fills a default in inside the plugin, after it has resolved the
// templates in the inputs a flow node sets, so a node that leaves the input alone can hand the plugin this text as it
// is. The plugin reads the Flow Variable itself in that case (see below).
const DEFAULT_REFERENCE = '{{{args.variables.user.videoOnlySource}}}';

const details = () => ({
  name: 'Compare File Size To Source',
  description: 'Compares the working file size with a reference file (default: the video-only source in the Flow '
    + 'Variable videoOnlySource). Output 1: smaller than Maximum size percent of the reference (default 100). '
    + 'Output 2: that size or larger.',
  style: { borderColor: 'orange' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Reference file',
      name: 'referenceFile',
      type: 'string',
      defaultValue: DEFAULT_REFERENCE,
      inputUI: { type: 'text' },
      tooltip: 'Path of the file the working file is compared with. It must be readable from the node this plugin '
        + 'runs on. Supports templating. Leave it as it is (or empty) to use the video-only source, the Flow Variable '
        + 'videoOnlySource.',
    },
    {
      label: 'Maximum size (% of reference)',
      name: 'maxPercent',
      type: 'number',
      defaultValue: '100',
      inputUI: { type: 'text' },
      tooltip: 'The working file has to be smaller than this percentage of the reference file to leave through output 1. '
        + '100 = smaller than the reference file itself. 85 = it has to save more than 15%. Any number above 0; a number '
        + 'above 100 accepts a working file larger than the reference.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'The working file is smaller than Maximum size percent of the reference file' },
    { number: 2, tooltip: 'The working file is that size (Maximum size percent of the reference file) or larger' },
  ],
});

// The size in bytes of a file, or an Error that names the file and says what went wrong.
const sizeOf = (label, filePath) => {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    throw new Error(`${label} "${filePath}" cannot be read (${e.code || e.message})`);
  }
  if (!stat.isFile()) throw new Error(`${label} "${filePath}" is not a file`);
  return stat.size;
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const log = (m) => args.jobLog(`Compare File Size To Source: ${m}`);
  const fail = (m) => {
    log(m);
    throw new Error(`Compare File Size To Source: ${m}`);
  };

  let reference = String(args.inputs.referenceFile === undefined || args.inputs.referenceFile === null
    ? '' : args.inputs.referenceFile).trim();
  // An empty input, or the default left alone, means the video-only source. Read the Flow Variable here rather than
  // relying on the template having been resolved.
  if (reference === '' || reference === DEFAULT_REFERENCE) {
    const variable = args.variables && args.variables.user ? args.variables.user.videoOnlySource : undefined;
    reference = String(variable === undefined || variable === null ? '' : variable).trim();
  }
  if (reference === '' || reference === 'undefined') {
    fail('no reference file (the Reference file input is empty and the Flow Variable videoOnlySource is not set, '
      + 'or the template in the input resolved to nothing)');
  }

  const working = String(args.inputFileObj && args.inputFileObj._id ? args.inputFileObj._id : '').trim();
  if (working === '') fail('the working file has no path');

  let workingSize;
  let referenceSize;
  try {
    workingSize = sizeOf('working file', working);
    referenceSize = sizeOf('reference file', reference);
  } catch (e) {
    fail(e.message);
  }
  if (referenceSize === 0) fail(`reference file "${reference}" is empty`);

  // Maximum size: a percentage of the reference file. Tdarr hands number inputs over as text ("85"), so parse it.
  const rawMax = args.inputs.maxPercent === undefined || args.inputs.maxPercent === null
    ? '' : String(args.inputs.maxPercent).trim();
  const maxPercent = rawMax === '' ? 100 : Number(rawMax.replace(/%$/, ''));
  if (!Number.isFinite(maxPercent) || maxPercent <= 0) {
    fail(`the Maximum size input "${rawMax}" is not a number above 0 (it is a percentage of the reference file, `
      + '100 = the reference file\'s own size)');
  }

  const percent = ((workingSize / referenceSize) * 100).toFixed(2);
  // workingSize / referenceSize < maxPercent / 100, written without a division so 100 compares the two sizes exactly
  const smaller = workingSize * 100 < referenceSize * maxPercent;
  const outputNumber = smaller ? 1 : 2;
  const limit = maxPercent === 100 ? 'the reference file' : `${maxPercent}% of the reference file`;
  const verdict = smaller
    ? `smaller than ${limit} (output 1)`
    : `${maxPercent === 100 ? 'same size or larger' : `${limit} or larger`} (output 2)`;
  log(`working file ${workingSize} bytes is ${percent}% of the reference file (${referenceSize} bytes), `
    + `limit ${maxPercent}%: ${verdict}`);

  return { outputFileObj: args.inputFileObj, outputNumber, variables: args.variables };
};

module.exports = { details, plugin };
