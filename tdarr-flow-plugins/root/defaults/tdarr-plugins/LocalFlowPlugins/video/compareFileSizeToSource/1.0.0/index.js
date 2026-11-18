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
 * Output 1: the working file is smaller than the reference file. Continue (another pass can still help).
 * Output 2: the working file is the same size as the reference file, or larger. Stop re-encoding.
 *
 * The plugin fails the flow (with the reason in the job log) if the reference path is empty or either file cannot be read,
 * so a wrong path shows up at once instead of the loop carrying on without its limit. It changes nothing but the output
 * it leaves through.
 */

const fs = require('fs');

const details = () => ({
  name: 'Compare File Size To Source',
  description: 'Compares the working file size with a reference file (default: the video-only source in the Flow '
    + 'Variable videoOnlySource). Output 1: smaller. Output 2: same size or larger.',
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
      defaultValue: '{{{args.variables.user.videoOnlySource}}}',
      inputUI: { type: 'text' },
      tooltip: 'Path of the file the working file is compared with. It must be readable from the node this plugin '
        + 'runs on. Supports templating. Default: the video-only source, {{{args.variables.user.videoOnlySource}}}.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'The working file is smaller than the reference file' },
    { number: 2, tooltip: 'The working file is the same size as the reference file, or larger' },
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

  const reference = String(args.inputs.referenceFile === undefined || args.inputs.referenceFile === null
    ? '' : args.inputs.referenceFile).trim();
  if (reference === '' || reference === 'undefined') {
    fail('no reference file (the Reference file input is empty, or the Flow Variable it names is not set)');
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

  const percent = ((workingSize / referenceSize) * 100).toFixed(2);
  const outputNumber = workingSize < referenceSize ? 1 : 2;
  log(`working file ${workingSize} bytes is ${percent}% of the reference file (${referenceSize} bytes): `
    + `${outputNumber === 1 ? 'smaller (output 1)' : 'same size or larger (output 2)'}`);

  return { outputFileObj: args.inputFileObj, outputNumber, variables: args.variables };
};

module.exports = { details, plugin };
