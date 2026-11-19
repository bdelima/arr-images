/**
 * Read Source File Tag — Local Flow Plugin
 *
 * Reads the TDARR_SOURCE_FILE global tag (written by Tag Output Metadata: the full path of the original library file the
 * job was queued for) from the file the flow is working on, checks that the file at that path exists on this node and is a
 * different file from the working file, and writes the path into a Flow Variable so a later node can use it, for example
 * Run VMAF Quality Check's "Reference file" input as {{{args.variables.user.sourceFile}}}.
 *
 * The tag is read from the file itself with ffmpeg (-f ffmetadata), because the scan data Tdarr holds can be older than
 * the file; if ffmpeg cannot be run or fails, the probe data of the working file (format.tags) is used instead.
 *
 * Output 1: the path was read, the file exists and it is not the working file. The Flow Variable is set.
 * There is no second output: every other case ends the job with an error whose message says what was wrong:
 *   - the file has no TDARR_SOURCE_FILE tag (it was not written by a pipeline that stamps it),
 *   - the file at the tagged path does not exist on this node (the pipeline's Replace Original File overwrites the
 *     original, so the tagged path normally holds the encoded file or nothing; put the node that runs this step where the
 *     path is mapped),
 *   - the file at the tagged path is the working file itself (same device and inode): scoring a file against itself would
 *     give a perfect score, so this is refused.
 */

const details = () => ({
  name: 'Read Source File Tag',
  description: 'Reads the TDARR_SOURCE_FILE tag from the working file and puts the path into a Flow Variable (default sourceFile). '
    + 'Fails the job when the tag is missing, when no file exists at that path on this node, or when that file is the working '
    + 'file itself.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Variable name',
      name: 'variableName',
      type: 'string',
      defaultValue: 'sourceFile',
      inputUI: { type: 'text' },
      tooltip: 'The Flow Variable (under user) the path is written to. Letters, digits and underscores, starting with a '
        + 'letter or underscore; anything else counts as sourceFile. Later nodes read it as '
        + '{{{args.variables.user.sourceFile}}} (with the name you chose).',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'The source file path was read; the file exists and is not the working file' },
  ],
});

const DEFAULT_NAME = 'sourceFile';
const TAG = 'TDARR_SOURCE_FILE';

// ffmpeg's ffmetadata text: "KEY=value" lines before the first [SECTION], with \ = ; # and newline escaped by a backslash.
// Copied from Tag Output Metadata rather than required from it, so this plugin does not depend on another plugin file.
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

// The global tags of a file as { UPPERCASE_NAME: value }, read with ffmpeg; null when ffmpeg cannot be run or fails.
const readTagsWithFfmpeg = (args, file) => new Promise((resolve) => {
  if (!args.ffmpegPath) {
    resolve(null);
    return;
  }
  const { spawn } = require('child_process');
  let out = '';
  let child;
  let timer;
  const finish = (value) => {
    clearTimeout(timer);
    resolve(value);
  };
  timer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
    finish(null);
  }, 60000);
  try {
    child = spawn(args.ffmpegPath, ['-nostdin', '-v', 'error', '-i', file, '-f', 'ffmetadata', '-']);
  } catch (e) {
    finish(null);
    return;
  }
  child.on('error', () => finish(null));
  child.stdout.on('data', (d) => { if (out.length < 1000000) out += d.toString(); });
  child.on('close', (code) => finish(code === 0 ? parseFfmetadata(out) : null));
});

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const fs = require('fs');

  const wanted = String(args.inputs.variableName === undefined || args.inputs.variableName === null ? '' : args.inputs.variableName).trim();
  const name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(wanted) ? wanted : DEFAULT_NAME;
  if (wanted !== '' && name !== wanted) {
    args.jobLog(`Read Source File Tag: "${wanted}" is not a usable variable name, using ${DEFAULT_NAME}`);
  }

  const working = args.inputFileObj && args.inputFileObj._id;
  if (!working) throw new Error('Read Source File Tag: there is no working file');

  let tags = await readTagsWithFfmpeg(args, working);
  let from = 'the file (ffmpeg)';
  if (tags === null) {
    const probe = args.inputFileObj.ffProbeData;
    tags = {};
    Object.keys((probe && probe.format && probe.format.tags) || {}).forEach((k) => {
      tags[k.toUpperCase()] = String(probe.format.tags[k]);
    });
    from = 'the probe data (ffmpeg could not read the file)';
  }

  const source = String(tags[TAG] === undefined ? '' : tags[TAG]).trim();
  if (source === '') {
    throw new Error(`Read Source File Tag: ${working} has no ${TAG} tag (read from ${from})`);
  }
  args.jobLog(`Read Source File Tag: ${TAG} = ${source} (read from ${from})`);

  let sourceStat;
  try {
    sourceStat = fs.statSync(source);
  } catch (e) {
    throw new Error(`Read Source File Tag: no file exists at ${source} on this node (${e.code || e.message})`);
  }
  if (!sourceStat.isFile()) throw new Error(`Read Source File Tag: ${source} is not a file`);

  const workingStat = fs.statSync(working);
  if (sourceStat.dev === workingStat.dev && sourceStat.ino === workingStat.ino) {
    throw new Error(`Read Source File Tag: ${source} is the working file itself, so it cannot be the reference (a file scored against itself always gets a perfect score)`);
  }

  if (!args.variables.user) args.variables.user = {};
  args.variables.user[name] = source;
  args.jobLog(`Read Source File Tag: ${source} exists (${sourceStat.size} bytes) and is a different file from the working file; saved in the Flow Variable ${name}`);

  return { outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables };
};

module.exports = { details, plugin };
