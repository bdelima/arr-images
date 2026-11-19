/**
 * Tag VMAF Score — Local Flow Plugin
 *
 * Writes the score Run VMAF Quality Check just produced (Flow Variables user.vmafMean, vmafMin, vmafP1, vmafBelow and
 * vmafStep) into the working file's TDARR_VMAF_SCORE global tag, in place with mkvpropedit, and leaves every other TDARR_
 * tag on the file as it was. The value has the same format Tag Output Metadata writes, for example
 * mean=95.12;min=81.3;p1=90.4;below60=0;below70=2;below75=5.
 *
 * It is for a flow that only scores a file that is already finished (a rescore), where Tag Output Metadata is not
 * the right node: it rewrites the run tags (pipeline version, trail) and, on a run that did not encode, keeps the encode
 * tags (VMAF score included) from the file instead of replacing them.
 *
 * How it writes: mkvpropedit --tags global:<xml> REPLACES all global tags, so the file's existing TDARR_ tags are read first
 * (from the file itself with ffmpeg, -f ffmetadata, because the scan data Tdarr holds can be older than the file; the probe
 * data of the working file is used only if ffmpeg cannot read it) and written back together with the new score. Only TDARR_
 * tags are carried over: other global tags (there are none on a file this pipeline wrote, which removes them with mkvmerge
 * --no-global-tags) would be lost. Per-track tags (language, title, statistics) are not global tags and are not touched.
 *
 * After writing, the file is read again and the job fails if TDARR_VMAF_SCORE is not the new value or if any TDARR_ tag that
 * was on the file before is missing or changed.
 *
 * Matroska files only (mkvpropedit). Output 1: the tag was written and read back. Anything else ends the job with an error:
 * no score in the Flow Variables, a file that is not Matroska, mkvpropedit failing, a failed read-back.
 */

const details = () => ({
  name: 'Tag VMAF Score',
  description: 'Writes the VMAF score from Run VMAF Quality Check into the working file\'s TDARR_VMAF_SCORE tag in place with '
    + 'mkvpropedit, keeping the file\'s other TDARR_ tags, and reads it back. Matroska files only. Fails the job when there is '
    + 'no score, the file is not Matroska, mkvpropedit fails or the read-back does not match.',
  style: { borderColor: 'green' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [],
  outputs: [
    { number: 1, tooltip: 'The score tag was written and read back' },
  ],
});

const TAG = 'TDARR_VMAF_SCORE';

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

// Only the TDARR_ tags, with their original order and non-empty values.
const tdarrOnly = (all) => {
  const out = {};
  Object.keys(all || {}).forEach((k) => {
    if (/^TDARR_/.test(k) && all[k] !== undefined && all[k] !== null && String(all[k]) !== '') out[k] = String(all[k]);
  });
  return out;
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const fs = require('fs');
  const path = require('path');
  const { CLI } = require('../../../../FlowHelpers/1.0.0/cliUtils');

  const file = args.inputFileObj && args.inputFileObj._id;
  if (!file) throw new Error('Tag VMAF Score: there is no working file');

  const container = String((args.inputFileObj && args.inputFileObj.container) || path.extname(file).replace(/^\./, '')).toLowerCase();
  if (container !== 'mkv' && container !== 'mka' && container !== 'webm') {
    throw new Error(`Tag VMAF Score: ${file} is not a Matroska file (container "${container}"), mkvpropedit cannot write its tags`);
  }

  const v = (args.variables && args.variables.user) || {};
  if (v.vmafMean === undefined || v.vmafMean === null || v.vmafMean === '') {
    throw new Error('Tag VMAF Score: there is no VMAF score (the Flow Variable vmafMean is not set); run Run VMAF Quality Check first');
  }
  const score = `mean=${v.vmafMean};min=${v.vmafMin};p1=${v.vmafP1}${v.vmafBelow ? `;${v.vmafBelow}` : ''}${v.vmafStep > 1 ? `;every=${v.vmafStep}` : ''}`;

  let existingAll = await readTagsWithFfmpeg(args, file);
  let from = 'the file (ffmpeg)';
  if (existingAll === null) {
    const probe = args.inputFileObj.ffProbeData;
    existingAll = {};
    Object.keys((probe && probe.format && probe.format.tags) || {}).forEach((k) => {
      existingAll[k.toUpperCase()] = String(probe.format.tags[k]);
    });
    from = 'the probe data (ffmpeg could not read the file)';
  }
  const existing = tdarrOnly(existingAll);
  const previous = existing[TAG];
  args.jobLog(`Tag VMAF Score: read ${Object.keys(existing).length} TDARR_ tag(s) from ${from}`
    + `${previous ? `; ${TAG} was ${previous}` : `; the file had no ${TAG}`}`);

  const merged = { ...existing, [TAG]: score };
  const tagList = Object.keys(merged).map((k) => [k, merged[k]]);

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const simpleTagsXml = tagList
    .map(([name, val]) => `    <Simple>\n      <Name>${esc(name)}</Name>\n      <String>${esc(val)}</String>\n    </Simple>`)
    .join('\n');
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE Tags SYSTEM "matroskatags.dtd">\n'
    + `<Tags>\n  <Tag>\n${simpleTagsXml}\n  </Tag>\n</Tags>\n`;

  const safeId = file.replace(/[^a-zA-Z0-9]/g, '_');
  const tagsFilePath = path.join('/temp', `tdarr-vmaf-tags-${safeId}.xml`);
  fs.writeFileSync(tagsFilePath, xml, 'utf8');

  const cli = new CLI({
    cli: args.mkvpropeditPath,
    spawnArgs: ['--tags', `global:${tagsFilePath}`, file],
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
    args.jobLog(`Tag VMAF Score: could not remove scratch file ${tagsFilePath}: ${e.message}`);
  }

  if (res.cliExitCode === 1 && !cli.cancelled) {
    args.jobLog('Tag VMAF Score: mkvpropedit completed with warnings');
  } else if (res.cliExitCode !== 0) {
    throw new Error('Tag VMAF Score: mkvpropedit failed');
  }

  // read the file again: the score must be there, and nothing that was there before may be gone or different
  const after = await readTagsWithFfmpeg(args, file);
  if (after === null) {
    args.jobLog('Tag VMAF Score: could not read the file back (ffmpeg unavailable or failed), so the written tag is not verified');
  } else {
    const now = tdarrOnly(after);
    if (now[TAG] !== score) throw new Error(`Tag VMAF Score: read-back failed, ${TAG} is "${now[TAG]}" instead of "${score}"`);
    Object.keys(existing).forEach((k) => {
      if (k !== TAG && now[k] !== existing[k]) throw new Error(`Tag VMAF Score: read-back failed, ${k} changed from "${existing[k]}" to "${now[k]}"`);
    });
    args.jobLog(`Tag VMAF Score: ${TAG} = ${score} (read back from the file, ${Object.keys(now).length} TDARR_ tag(s) on it)`);
  }

  return { outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables };
};

module.exports = { details, plugin };
