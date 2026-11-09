/**
 * Mark Step - Local Flow Plugin
 *
 * Appends one entry to the job's step trail (Flow Variable tdarrTrail) and logs it. The trail records which steps ran
 * and in what ORDER, on a counter that goes up by one per entry, so the order can be read back even when the job
 * log's own timestamps are late (a node's log lines can arrive in batches, seconds after the step ran) or when two
 * nodes' log lines interleave. Each entry also carries the node name, the worker type and a UTC time taken on the
 * node that ran the step; the time is informational (it is only comparable between nodes whose clocks agree), the
 * sequence number is what establishes the order.
 *
 * Entry format:  <seq>|<label>|<node>|<worker>|<UTC time>      entries are joined with ";"
 *   e.g.  3|validator-hc-done|ojochal-gpu|transcodegpu|2026-11-09T18:41:07.512Z
 *
 * Put it directly after the step it records. A step that routes the job (Tags: Worker Type) is recorded by a Mark Step
 * AFTER it: that entry shows which node and worker the job actually landed on.
 *
 * Output 1: always. This plugin never fails the flow; a problem reading the node's identity is only logged.
 */

const details = () => ({
  name: 'Mark Step',
  description: 'Appends a numbered entry (label, node, worker type, UTC time) to the job\'s step trail, Flow Variable '
    + 'tdarrTrail, and logs it. Use with Require Trail to confirm steps ran in the right order.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Label',
      name: 'label',
      type: 'string',
      defaultValue: 'step',
      inputUI: { type: 'text' },
      tooltip: 'Short name for this point in the flow, e.g. validator-hc-done. Letters, digits, dash, underscore and '
        + 'dot only; anything else is replaced with a dash. Require Trail matches labels exactly.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Continue to next plugin' },
  ],
});

const SEPARATOR = ';';

const cleanLabel = (s) => String(s === undefined || s === null ? '' : s).trim().replace(/[^A-Za-z0-9._-]/g, '-');

// the trail as a list of entries; tolerates an empty or missing variable
const parseTrail = (text) => String(text || '')
  .split(SEPARATOR)
  .map((e) => e.trim())
  .filter((e) => e !== '')
  .map((e) => {
    const [seq, label, node, worker, time] = e.split('|');
    return {
      seq: Number(seq), label, node, worker, time,
    };
  });

// Appends an entry to args.variables.user.tdarrTrail and returns it as text. Require Trail (parser) and Tag Output
// Metadata (its closing entry) carry their own copies of the same format instead of requiring this file.
const appendEntry = (args, label) => {
  if (!args.variables.user) args.variables.user = {};
  const entries = parseTrail(args.variables.user.tdarrTrail);
  const last = entries.reduce((m, e) => (Number.isFinite(e.seq) && e.seq > m ? e.seq : m), 0);
  let node = '';
  try {
    node = (args.configVars && args.configVars.config && args.configVars.config.nodeName)
      || (args.config && args.config.nodeName) || '';
  } catch (e) {
    node = '';
  }
  const worker = String(args.workerType || '');
  const entry = [last + 1, cleanLabel(label) || 'step', cleanLabel(node) || 'unknown-node',
    cleanLabel(worker) || 'unknown-worker', new Date().toISOString()].join('|');
  args.variables.user.tdarrTrail = entries.length > 0
    ? `${args.variables.user.tdarrTrail}${SEPARATOR}${entry}` : entry;
  return entry;
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const entry = appendEntry(args, args.inputs.label);
  args.jobLog(`Mark Step: TRAIL ${entry}`);

  return { outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables };
};

module.exports = { details, plugin };
