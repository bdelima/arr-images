/**
 * Keep Awake - Local Flow Plugin
 *
 * Keeps the node from sleeping while a job runs on it. It is used inline in the transcode flow, as two steps with the same
 * plugin: Keep Awake (action "start") early in the flow, and Keep Awake (action "stop") after the work that must not be
 * interrupted. Neither step waits for anything, so it cannot deadlock with other jobs on the node.
 *
 * What "start" does depends on the node's operating system, and each one has its own setting:
 *
 *   Windows  "system+display" (default): keeps the system AND the display on (ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED).
 *            "system": keeps the system awake but lets the display turn off. "none": does nothing.
 *   Linux    "none" (default): does nothing. "systemd-inhibit": holds an idle and sleep inhibitor lock.
 *   macOS    "none" (default): does nothing. "caffeinate": runs caffeinate -i.
 *
 * With "none" the step returns at once and starts nothing, so the same flow can run on every node and only the Windows one
 * does any work.
 *
 * How it works. "start" creates a lease file in the job's work folder and starts a small helper process, detached so it
 * outlives the step. The helper holds the request while the lease file exists and, as a safety limit, for at most "Maximum
 * hold" minutes. "stop" deletes the job's lease file; the helper notices within about 5 seconds and ends, which ends the
 * request. Every job has its own lease and its own helper, so two jobs on one node never release each other's hold, and the
 * operating system keeps the node awake while any of them is active.
 *
 * The lease's path and the node's name are kept in the job's Flow Variables keepAwakeLease and keepAwakeNode. "stop" only
 * deletes a lease that belongs to the node it is running on, so a job that hopped to another node leaves it alone.
 *
 * If a job fails or is cancelled before "stop", the lease is not released by this plugin: it ends when the job's work
 * folder is cleaned up, or at the latest when "Maximum hold" runs out.
 *
 * Windows: the helper is a hidden PowerShell that calls SetThreadExecutionState every 5 seconds. The state belongs to the
 * thread that sets it, so it must be a process that stays alive; when the process ends, so does the request.
 *
 * If the helper cannot start, the plugin logs it and carries on without holding anything.
 *
 * Output 1: always. This plugin never fails the flow.
 */

const details = () => ({
  name: 'Keep Awake',
  description: 'Keeps this node from sleeping while a job runs. Put it in the flow twice: action "start" early, action '
    + '"stop" after the work. Each operating system has its own setting; "none" does nothing. Defaults: Windows keeps '
    + 'the system and display on, Linux and macOS do nothing.',
  style: { borderColor: '#FF9800' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: 'faMoon',
  inputs: [
    {
      label: 'Action',
      name: 'action',
      type: 'string',
      defaultValue: 'start',
      inputUI: { type: 'dropdown', options: ['start', 'stop'] },
      tooltip: 'start = begin keeping the node awake for this job. stop = let go (the settings below are ignored).',
    },
    {
      label: 'Windows',
      name: 'windowsMode',
      type: 'string',
      defaultValue: 'system+display',
      inputUI: { type: 'dropdown', options: ['system+display', 'system', 'none'] },
      tooltip: 'system+display = keep the system and the display on. system = keep the system awake, let the display '
        + 'turn off. none = do nothing.',
    },
    {
      label: 'Linux',
      name: 'linuxMode',
      type: 'string',
      defaultValue: 'none',
      inputUI: { type: 'dropdown', options: ['none', 'systemd-inhibit'] },
      tooltip: 'none = do nothing. systemd-inhibit = hold an idle and sleep inhibitor lock (needs systemd-inhibit on '
        + 'the node).',
    },
    {
      label: 'macOS',
      name: 'macMode',
      type: 'string',
      defaultValue: 'none',
      inputUI: { type: 'dropdown', options: ['none', 'caffeinate'] },
      tooltip: 'none = do nothing. caffeinate = run caffeinate -i to prevent idle sleep.',
    },
    {
      label: 'Maximum hold (minutes)',
      name: 'maxHoldMinutes',
      type: 'number',
      defaultValue: '480',
      inputUI: { type: 'text' },
      tooltip: 'Safety limit: the helper lets go after this long even if "stop" never ran (a failed or cancelled job). '
        + 'Make it longer than your longest job.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Continue' },
  ],
});

const STARTUP_CHECK_MS = 2000;
// How often the helper looks at the lease file (and, on Windows, repeats its request).
const HELPER_POLL_SECONDS = 5;
const DEFAULT_MAX_HOLD_MINUTES = 480;
// ES_CONTINUOUS | ES_SYSTEM_REQUIRED, and the same with ES_DISPLAY_REQUIRED. Written in decimal on purpose: PowerShell
// reads 0x80000001 as a negative Int32, which does not convert to the uint the API takes.
const WINDOWS_FLAGS = { system: 2147483649, 'system+display': 2147483651 };

// Per platform: the setting's label, its input name and the modes it accepts.
const PLATFORMS = {
  win32: { label: 'Windows', input: 'windowsMode', modes: ['none', 'system', 'system+display'] },
  linux: { label: 'Linux', input: 'linuxMode', modes: ['none', 'systemd-inhibit'] },
  darwin: { label: 'macOS', input: 'macMode', modes: ['none', 'caffeinate'] },
};

// The mode to use on this platform, with a reason when it falls back to "none".
const modeFor = (platform, inputs) => {
  const p = PLATFORMS[platform];
  if (!p) return { label: String(platform || 'unknown platform'), mode: 'none', note: 'no setting for this platform' };
  const wanted = String(inputs[p.input] === undefined ? '' : inputs[p.input]).trim();
  if (p.modes.includes(wanted)) return { label: p.label, mode: wanted };
  return { label: p.label, mode: 'none', note: `"${wanted}" is not one of ${p.modes.join(', ')}` };
};

// The PowerShell script the Windows helper runs: hold while the lease file exists and the deadline has not passed.
const windowsScript = (flags, leasePath, maxSeconds) => 'Add-Type -MemberDefinition '
  + '\'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);\' '
  + '-Name KeepAwake -Namespace Win32; '
  + `$lease = '${String(leasePath).replace(/'/g, "''")}'; `
  + `$end = (Get-Date).AddSeconds(${Number(maxSeconds)}); `
  + 'while ((Test-Path -LiteralPath $lease) -and ((Get-Date) -lt $end)) { '
  + `[Win32.KeepAwake]::SetThreadExecutionState(${flags}) | Out-Null; Start-Sleep -Seconds ${HELPER_POLL_SECONDS} }`;

// The same loop for Linux and macOS: runs under systemd-inhibit or caffeinate, which hold their request while it runs.
const SH_LOOP = 'end=$(( $(date +%s) + $2 )); while [ -e "$1" ] && [ "$(date +%s)" -lt "$end" ]; do '
  + `sleep ${HELPER_POLL_SECONDS}; done`;

// The command that holds the request for a platform and mode until the lease is gone or the deadline passes.
const helperCommand = (platform, mode, leasePath, maxSeconds) => {
  if (platform === 'win32') {
    // -EncodedCommand (UTF-16LE, base64) avoids every quoting problem with the quotes inside the script.
    const encoded = Buffer.from(windowsScript(WINDOWS_FLAGS[mode], leasePath, maxSeconds), 'utf16le').toString('base64');
    return {
      command: 'powershell',
      args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      what: `Windows SetThreadExecutionState (${mode})`,
    };
  }
  const wait = ['sh', '-c', SH_LOOP, 'sh', leasePath, String(maxSeconds)];
  if (platform === 'darwin') return { command: 'caffeinate', args: ['-i', ...wait], what: 'caffeinate -i' };
  return {
    command: 'systemd-inhibit',
    args: ['--what=idle:sleep', '--who=Tdarr', '--why=Encoding in progress', ...wait],
    what: 'systemd-inhibit idle:sleep',
  };
};

// Starts the helper detached, so it outlives this step. Resolves { ok, why } after a short check that it is running.
const startHelper = async (spawn, cmd) => {
  let child;
  let problem = '';
  try {
    child = spawn(cmd.command, cmd.args, { stdio: 'ignore', detached: true, windowsHide: true });
  } catch (e) {
    return { ok: false, why: `could not start ${cmd.command}: ${e.message}` };
  }
  const onError = (e) => { problem = e.code === 'ENOENT' ? `${cmd.command} was not found` : e.message; };
  const onExit = (code, signal) => {
    problem = `${cmd.command} ended at once (exit code ${code}${signal ? `, signal ${signal}` : ''})`;
  };
  child.on('error', onError);
  child.on('exit', onExit);
  await new Promise((resolve) => setTimeout(resolve, STARTUP_CHECK_MS));
  child.removeListener('error', onError);
  child.removeListener('exit', onExit);
  if (problem) return { ok: false, why: problem };
  // let this process finish without waiting for the helper
  if (typeof child.unref === 'function') child.unref();
  return { ok: true };
};

const removeFile = (fs, file) => {
  try {
    fs.unlinkSync(file);
    return true;
  } catch (e) {
    return false;
  }
};

const nodeNameOf = (args) => {
  try {
    return String((args.configVars && args.configVars.config && args.configVars.config.nodeName)
      || (args.config && args.config.nodeName) || '').trim();
  } catch (e) {
    return '';
  }
};

const start = async (args, log, done) => {
  const fs = require('fs');
  const path = require('path');
  const setting = modeFor(args.platform, args.inputs);
  if (setting.mode === 'none') {
    log(`${setting.label}: mode is none${setting.note ? ` (${setting.note})` : ''}, nothing to do`);
    return done();
  }
  if (!args.workDir) {
    log('this job has no work folder to put the lease in; not holding anything');
    return done();
  }
  if (!args.variables.user) args.variables.user = {};
  const nodeName = nodeNameOf(args);

  // a lease this job already holds on this node is replaced, not left behind
  const old = args.variables.user.keepAwakeLease;
  if (old && args.variables.user.keepAwakeNode === nodeName && removeFile(fs, old)) {
    log(`replaced this job's earlier lease ${old}`);
  }

  const minutes = Number(args.inputs.maxHoldMinutes);
  const maxSeconds = Math.round((minutes > 0 ? minutes : DEFAULT_MAX_HOLD_MINUTES) * 60);
  const lease = path.join(args.workDir, `keepawake-${Date.now()}.lease`);
  try {
    fs.writeFileSync(lease, `Keep Awake lease for ${nodeName || 'this node'}, ${new Date().toISOString()}\n`);
  } catch (e) {
    log(`could not write the lease ${lease} (${e.message}); not holding anything`);
    return done();
  }

  const cmd = helperCommand(args.platform, setting.mode, lease, maxSeconds);
  const result = await startHelper(require('child_process').spawn, cmd);
  if (!result.ok) {
    removeFile(fs, lease);
    log(`the helper did not start (${result.why}); not holding anything, carrying on`);
    return done();
  }
  args.variables.user.keepAwakeLease = lease;
  args.variables.user.keepAwakeNode = nodeName;
  log(`${setting.label}: mode ${setting.mode}, holding with ${cmd.what} until the lease ${lease} is released `
    + `(at most ${Math.round(maxSeconds / 60)} min)`);
  return done();
};

const stop = (args, log, done) => {
  const fs = require('fs');
  const user = args.variables.user || {};
  const lease = user.keepAwakeLease;
  if (!lease) {
    log('no lease recorded for this job, nothing to release');
    return done();
  }
  const nodeName = nodeNameOf(args);
  if (user.keepAwakeNode && nodeName && user.keepAwakeNode !== nodeName) {
    log(`the lease belongs to node ${user.keepAwakeNode}, this is ${nodeName}; leaving it alone`);
    return done();
  }
  const removed = removeFile(fs, lease);
  user.keepAwakeLease = '';
  user.keepAwakeNode = '';
  log(removed ? `released ${lease}; the helper ends within about ${HELPER_POLL_SECONDS} s`
    : `${lease} was already gone (the helper has ended or is about to)`);
  return done();
};

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const done = () => ({ outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables });
  const log = (text) => args.jobLog(`Keep Awake: ${text}`);

  const action = String(args.inputs.action).trim();
  if (action === 'stop') return stop(args, log, done);
  if (action !== 'start') log(`unknown action "${action}", treating it as start`);
  return start(args, log, done);
};

module.exports = { details, plugin };
