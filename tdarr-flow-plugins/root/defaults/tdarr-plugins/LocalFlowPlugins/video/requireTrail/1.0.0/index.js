/**
 * Require Trail - Local Flow Plugin
 *
 * Checks the job's step trail (written by Mark Step into Flow Variable tdarrTrail) before a step that must not run
 * too early, such as Replace Original File. It passes only if every required label is in the trail AND they appear in
 * the order given (other entries may sit between them). The order is read from the entries' sequence numbers, not from
 * any clock.
 *
 * Output 1: the required labels are all present, in order - carry on.
 * Output 2: one is missing or out of order - wire this output to a Fail Flow node. The job log prints the whole trail
 *           and says which label was the problem.
 *
 * If the same label was recorded more than once (a retried step) the LAST entry of it counts, and the order is judged
 * from those last entries.
 */

const details = () => ({
  name: 'Require Trail',
  description: 'Output 1 = every required label is in the step trail, in the given order. Output 2 = one is missing '
    + 'or out of order: wire it to Fail Flow.',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Required Labels (in order)',
      name: 'requiredLabels',
      type: 'string',
      defaultValue: '',
      inputUI: { type: 'text' },
      tooltip: 'Comma separated Mark Step labels, in the order they must have been recorded, e.g. '
        + 'validator-hc-queue,validator-hc-done,validator-back-local. Empty = nothing is checked.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Every required label is in the trail, in order' },
    { number: 2, tooltip: 'A required label is missing or out of order: fail the flow' },
  ],
});

// Same entry format and parser as Mark Step (<seq>|<label>|<node>|<worker>|<UTC time>, joined with ";"). Copied
// instead of required from the Mark Step file, so this plugin does not depend on another plugin file being at a
// particular path on every node.
const parseTrail = (text) => String(text || '')
  .split(';')
  .map((e) => e.trim())
  .filter((e) => e !== '')
  .map((e) => {
    const [seq, label, node, worker, time] = e.split('|');
    return {
      seq: Number(seq), label, node, worker, time,
    };
  });

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const required = String(args.inputs.requiredLabels || '')
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const done = (outputNumber) => ({ outputFileObj: args.inputFileObj, outputNumber, variables: args.variables });

  const text = (args.variables.user && args.variables.user.tdarrTrail) || '';
  const entries = parseTrail(text);

  if (required.length === 0) {
    args.jobLog('Require Trail: no labels configured, not checking');
    return done(1);
  }

  const lastSeq = {};
  entries.forEach((e) => {
    if (Number.isFinite(e.seq)) lastSeq[e.label] = e.seq;
  });

  let previous = 0;
  let previousLabel = '(start)';
  for (let i = 0; i < required.length; i += 1) {
    const label = required[i];
    if (lastSeq[label] === undefined) {
      args.jobLog(`Require Trail: "${label}" is NOT in the trail -> FAIL. Trail: ${text || '(empty)'}`);
      return done(2);
    }
    if (lastSeq[label] <= previous) {
      args.jobLog(`Require Trail: "${label}" (#${lastSeq[label]}) was recorded before "${previousLabel}" `
        + `(#${previous}) -> FAIL. Trail: ${text}`);
      return done(2);
    }
    previous = lastSeq[label];
    previousLabel = label;
  }

  args.jobLog(`Require Trail: ${required.map((l) => `${l}#${lastSeq[l]}`).join(' < ')} -> OK`);
  return done(1);
};

module.exports = { details, plugin };
