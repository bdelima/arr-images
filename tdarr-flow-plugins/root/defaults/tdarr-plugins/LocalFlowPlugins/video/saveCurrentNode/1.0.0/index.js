/**
 * Save Current Node — Local Flow Plugin
 *
 * Writes the name of the node the job is running on now (the name Tdarr shows, for example samara-encoder) into a Flow
 * Variable, so a later step can refer to it, for example to send the job back to the same node. Place it on the node
 * you want to remember, at the point you want it remembered.
 *
 * The variable is a Flow Variable under "user", named by the input "Variable name" (default savedNode). Later nodes
 * read it as {{{args.variables.user.savedNode}}} in any input that accepts a variable, and it carries across Go To Flow
 * the way tdarrQuality does. Each run overwrites the value, so the variable always holds the last node this plugin ran on.
 *
 * The node name is read the same way Mark Step and Set Quality With Node Offset read it. If it cannot be read, the
 * variable is left exactly as it was and the job log says so.
 *
 * Output 1: always. This plugin never fails the flow, and changes nothing but that one variable.
 */

const details = () => ({
  name: 'Save Current Node',
  description: 'Saves the name of the node the job is running on into a Flow Variable (default savedNode), so a later '
    + 'step can refer to it, for example to land the job back on the same node.',
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
      defaultValue: 'savedNode',
      inputUI: { type: 'text' },
      tooltip: 'The Flow Variable (under user) the node name is written to. Letters, digits and underscores, starting '
        + 'with a letter or underscore; anything else counts as savedNode. Later nodes read it as '
        + '{{{args.variables.user.savedNode}}} (with the name you chose).',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Continue to next plugin' },
  ],
});

const DEFAULT_NAME = 'savedNode';

// The name of the node the job is running on, read the same way Mark Step reads it.
const nodeNameOf = (args) => {
  try {
    return String((args.configVars && args.configVars.config && args.configVars.config.nodeName)
      || (args.config && args.config.nodeName) || '').trim();
  } catch (e) {
    return '';
  }
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const done = () => ({ outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables });
  const log = (m) => args.jobLog(`Save Current Node: ${m}`);

  const wanted = String(args.inputs.variableName === undefined || args.inputs.variableName === null
    ? '' : args.inputs.variableName).trim();
  const valid = /^[A-Za-z_][A-Za-z0-9_]*$/.test(wanted);
  const name = valid ? wanted : DEFAULT_NAME;
  if (!valid && wanted !== '') log(`"${wanted}" is not a usable variable name, using ${DEFAULT_NAME}`);

  if (!args.variables.user) args.variables.user = {};

  const node = nodeNameOf(args);
  if (node === '') {
    log(`could not read the node name, leaving ${name} as it was (${args.variables.user[name] === undefined
      ? 'not set' : `"${args.variables.user[name]}"`})`);
    return done();
  }

  const before = args.variables.user[name];
  args.variables.user[name] = node;
  log(`${name} = "${node}"${before !== undefined && before !== node ? ` (was "${before}")` : ''}`);
  return done();
};

module.exports = { details, plugin };
