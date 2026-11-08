const { checkFfmpegCommandInit } = require('../../../../FlowHelpers/1.0.0/interfaces/flowUtils');

const details = () => ({
  name: 'Tag Encode Settings',
  description: 'Reads the real encoder args Set Video Encoder just configured and burns them into a -metadata flag',
  style: { borderColor: '#6efefc' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [],
  outputs: [{ number: 1, tooltip: 'Continue to next plugin' }],
});

const plugin = async (args) => {
  checkFfmpegCommandInit(args);

  const stream = args.variables.ffmpegCommand.streams[0];
  const outputArgs = stream.outputArgs;
  const parts = [];

  for (let j = 0; j < outputArgs.length; j += 2) {
    const flag = outputArgs[j];
    const val = outputArgs[j + 1];
    if (/^-c:/.test(flag)) parts.push(`encoder=${val}`);
    if (flag === '-global_quality' || flag === '-qp' || flag === '-crf') parts.push(`quality=${val}`);
    if (flag === '-preset') parts.push(`preset=${val}`);
  }

  if (parts.length > 0) {
    stream.outputArgs.push('-metadata:s:v:0', `TDARR_ENCODE_PARAMS=${parts.join(',')}`);
  }

  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};

module.exports = { details, plugin };
