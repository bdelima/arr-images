/**
 * Keep Awake - Local Flow Plugin
 *
 * A configurable replacement for the stock "Prevent Sleep While Encoding" plugin, for the same use: a flow made of
 * Input File -> Keep Awake, run as a Tdarr automation that a transcode flow starts with a Run Automation step right after
 * Input File. While the automation runs it stops the machine from sleeping, and it ends when no other worker on the node
 * is working any more.
 *
 * Do not put this plugin (or the stock one) inline in a transcode flow. It waits for every OTHER worker on the node to
 * finish, so two transcode jobs on one node that both reach it wait for each other forever. An automation job is skipped by
 * that check (its input is a dummy file in a .tdarr folder), so automations never wait on each other or on themselves.
 *
 * What it does depends on the node's operating system, and each one has its own setting:
 *
 *   Windows  "system+display" (default): keeps the system AND the display on (ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED).
 *            "system": keeps the system awake but lets the display turn off. "none": does nothing.
 *   Linux    "none" (default): does nothing. "systemd-inhibit": holds an idle and sleep inhibitor lock.
 *   macOS    "none" (default): does nothing. "caffeinate": runs caffeinate -i.
 *
 * With "none" the plugin returns at once without starting anything and without holding a worker slot, so the same flow can
 * run on every node and only the Windows one does any work.
 *
 * Otherwise it starts one small helper process that holds the request, then polls the Tdarr server's get-nodes API every
 * "Poll interval" seconds. When no other (non-automation) worker on this node has been seen for "Confirmations" checks in a
 * row it stops the helper and carries on. The helper is also stopped if the plugin fails, and on Windows it ends by itself
 * if the process that started it disappears (a crashed node does not leave the PC awake for good).
 *
 * Windows: the helper is a hidden PowerShell that calls SetThreadExecutionState again every 30 seconds. The state belongs
 * to the thread that sets it, so it must be a process that stays alive; stopping the process ends the request.
 *
 * "Maximum hold" is a safety limit in minutes (0 = none). If the helper cannot start or stops by itself, the plugin logs it
 * and carries on instead of holding the worker for nothing.
 *
 * Output 1: always. This plugin never fails the flow.
 */

const details = () => ({
  name: 'Keep Awake',
  description: 'Keeps this node from sleeping while other workers on it are busy. Use it in a flow of Input File -> Keep '
    + 'Awake, run as an automation from a Run Automation step; do not put it inline in a transcode flow. Each operating '
    + 'system has its own setting; "none" does nothing and returns at once. Defaults: Windows keeps the system and display '
    + 'on, Linux and macOS do nothing.',
  style: { borderColor: '#FF9800' },
  tags: 'video',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.64.01',
  sidebarPosition: -1,
  icon: 'faMoon',
  inputs: [
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
      label: 'Poll interval (seconds)',
      name: 'pollIntervalSeconds',
      type: 'number',
      defaultValue: '15',
      inputUI: { type: 'text' },
      tooltip: 'How often to ask the server whether other workers on this node are still working. At least 10.',
    },
    {
      label: 'Confirmations',
      name: 'confirmCount',
      type: 'number',
      defaultValue: '3',
      inputUI: { type: 'text' },
      tooltip: 'How many checks in a row must find no other worker before the machine is allowed to sleep again.',
    },
    {
      label: 'Maximum hold (minutes)',
      name: 'maxHoldMinutes',
      type: 'number',
      defaultValue: '0',
      inputUI: { type: 'text' },
      tooltip: 'Safety limit: let go after this long even if other workers are still running. 0 = no limit.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Continue (nothing to keep awake for, or no other workers are running)' },
  ],
});

const MIN_POLL_SECONDS = 10;
const STARTUP_CHECK_MS = 2000;
// How often the Windows helper repeats its request.
const WINDOWS_REFRESH_SECONDS = 30;
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

// The PowerShell script the Windows helper runs. It ends when the process that started it is gone.
const windowsScript = (flags, parentPid) => 'Add-Type -MemberDefinition '
  + '\'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);\' '
  + '-Name KeepAwake -Namespace Win32; '
  + `$parent = ${Number(parentPid)}; `
  + `while (Get-Process -Id $parent -ErrorAction SilentlyContinue) { [Win32.KeepAwake]::SetThreadExecutionState(${flags}) `
  + `| Out-Null; Start-Sleep -Seconds ${WINDOWS_REFRESH_SECONDS} }`;

// The command that holds the request for a platform and mode.
const helperCommand = (platform, mode, parentPid) => {
  if (platform === 'win32') {
    // -EncodedCommand (UTF-16LE, base64) avoids every quoting problem with the quotes inside the script.
    const encoded = Buffer.from(windowsScript(WINDOWS_FLAGS[mode], parentPid), 'utf16le').toString('base64');
    return {
      command: 'powershell',
      args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      options: { stdio: 'ignore', windowsHide: true, detached: false },
      what: `Windows SetThreadExecutionState (${mode}), refreshed every ${WINDOWS_REFRESH_SECONDS} s`,
    };
  }
  if (platform === 'darwin') {
    return {
      command: 'caffeinate', args: ['-i'], options: { stdio: 'ignore', detached: false }, what: 'caffeinate -i',
    };
  }
  return {
    command: 'systemd-inhibit',
    args: ['--what=idle:sleep', '--who=Tdarr', '--why=Encoding in progress', 'sleep', 'infinity'],
    options: { stdio: 'ignore', detached: false },
    what: 'systemd-inhibit idle:sleep',
  };
};

// Starts the helper. alive() is false once it has failed to start or has ended without being stopped; why() says how.
const startHelper = (spawn, cmd) => {
  let state = 'running';
  let detail = '';
  let child;
  try {
    child = spawn(cmd.command, cmd.args, cmd.options);
  } catch (e) {
    return { alive: () => false, why: () => `could not start ${cmd.command}: ${e.message}`, stop: () => {} };
  }
  child.on('error', (e) => {
    if (state === 'running') {
      state = 'failed';
      detail = e.code === 'ENOENT' ? `${cmd.command} was not found` : e.message;
    }
  });
  child.on('exit', (code, signal) => {
    if (state === 'running') {
      state = 'ended';
      detail = `${cmd.command} ended on its own (exit code ${code}${signal ? `, signal ${signal}` : ''})`;
    }
  });
  return {
    alive: () => state === 'running',
    why: () => detail,
    stop: () => {
      const wasRunning = state === 'running';
      state = 'stopped';
      if (!wasRunning) return;
      try { child.kill(); } catch (e) { /* already gone */ }
    },
  };
};

// The same test the stock automation helpers use for an automation job's dummy input file, accepting both separators.
const isAutomationFile = (filepath) => /[\\/]\.tdarr[\\/]automation-.+-.+\.txt$/.test(String(filepath || ''));

// true = other non-automation workers are running on this node, false = none, 'error' = could not ask the server.
const otherWorkersRunning = async (args, log) => {
  const config = (args.configVars && args.configVars.config) || {};
  const axios = args.deps && args.deps.axios;
  if (!config.nodeID || !axios) {
    log(`cannot ask the server about other workers (node id ${config.nodeID || 'unknown'}, `
      + `${axios ? 'axios present' : 'no axios'}); treating the node as idle`);
    return false;
  }
  try {
    const res = await axios.get(`${config.serverURL || ''}/api/v2/get-nodes`, {
      timeout: 30000,
      headers: { 'content-Type': 'application/json', 'x-api-key': config.apiKey || '' },
    });
    const node = res.data && res.data[config.nodeID];
    if (!node || !node.workers) {
      log(`node ${config.nodeID} is not in the server's answer; treating the node as idle`);
      return false;
    }
    const myJobId = (args.job && args.job.jobId) || '';
    return Object.keys(node.workers).some((id) => {
      const worker = node.workers[id];
      if (worker.job && worker.job.jobId === myJobId) return false;
      if (worker.file && isAutomationFile(worker.file)) return false;
      return true;
    });
  } catch (e) {
    log(`could not ask the server about other workers: ${e.message}`);
    return 'error';
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const plugin = async (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const done = () => ({ outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables });
  const log = (text) => args.jobLog(`Keep Awake: ${text}`);

  const setting = modeFor(args.platform, args.inputs);
  if (setting.mode === 'none') {
    log(`${setting.label}: mode is none${setting.note ? ` (${setting.note})` : ''}, nothing to do`);
    return done();
  }

  const pollMs = Math.max(MIN_POLL_SECONDS, Number(args.inputs.pollIntervalSeconds) || 15) * 1000;
  const confirmCount = Math.max(1, Math.floor(Number(args.inputs.confirmCount)) || 3);
  const maxHoldMs = Math.max(0, Number(args.inputs.maxHoldMinutes) || 0) * 60000;

  const cmd = helperCommand(args.platform, setting.mode, process.pid);
  const helper = startHelper(require('child_process').spawn, cmd);
  const started = Date.now();
  log(`${setting.label}: mode ${setting.mode}, holding with ${cmd.what}`);

  try {
    await sleep(STARTUP_CHECK_MS);
    if (!helper.alive()) {
      log(`the helper is not running (${helper.why()}); not holding the worker, carrying on`);
      return done();
    }

    let percentage = 0;
    let confirmed = 0;
    for (;;) {
      if (typeof args.updateWorker === 'function') args.updateWorker({ percentage });
      percentage = (percentage + 1) % 100;
      // eslint-disable-next-line no-await-in-loop
      await sleep(pollMs);

      if (!helper.alive()) {
        log(`the helper stopped (${helper.why()}); letting go`);
        break;
      }
      if (maxHoldMs > 0 && Date.now() - started >= maxHoldMs) {
        log(`reached the maximum hold of ${Math.round(maxHoldMs / 60000)} min; letting go`);
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      const others = await otherWorkersRunning(args, log);
      if (others === 'error' || others === true) {
        confirmed = 0;
      } else {
        confirmed += 1;
        if (confirmed >= confirmCount) {
          log(`no other workers running (confirmed ${confirmCount} times); letting go`);
          break;
        }
      }
    }
  } finally {
    helper.stop();
  }
  return done();
};

module.exports = { details, plugin };
