// Install/update the current user's least-privilege 30-minute Windows checkpoint.
// node worker/tools/install-progress-checkpoint.mjs --root=D:/StarJournal [--git=C:/.../git.exe]
// Uses InteractiveToken; never requests a password, SYSTEM or elevation.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const runFile = promisify(execFile);
if (process.platform !== 'win32') throw Error('Windows Task Scheduler is required');
const options = new Map();
for (const value of process.argv.slice(2)) {
  const match = /^--(root|worktree|git)=(.+)$/.exec(value);
  if (!match || options.has(match[1])) throw Error('Use --root=... [--worktree=...] [--git=...]');
  options.set(match[1], match[2]);
}
if (!options.has('root')) throw Error('An explicit project root is required');
const root = await fs.realpath(path.resolve(options.get('root')));
const here = path.dirname(fileURLToPath(import.meta.url));
const worktree = await fs.realpath(path.resolve(options.get('worktree') || path.join(here, '../..')));
const inside = (base, target) => { const rel = path.relative(base, target); return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
if (!inside(root, worktree)) throw Error('Worktree must be inside project root');
const output = path.join(root, 'handoff', 'non-character');
const tooling = path.join(output, '.tooling');
await fs.mkdir(tooling, { recursive: true });
if (!inside(root, await fs.realpath(tooling))) throw Error('Tooling directory is outside project root');
const token = crypto.randomUUID();
async function atomic(file, content) {
  const temp = file + '.tmp-' + token;
  await fs.writeFile(temp, content, { flag: 'wx' });
  try { await fs.rename(temp, file); } finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
const git = await fs.realpath(options.get('git') || (await runFile('where.exe', ['git'], { encoding: 'utf8', windowsHide: true })).stdout.trim().split(/\r?\n/)[0]);
const executable = process.execPath;
const stableScript = path.join(tooling, 'checkpoint-progress.mjs');
await atomic(stableScript, await fs.readFile(path.join(here, 'checkpoint-progress.mjs')));
const taskName = 'StarJournal-NonCharacter-Checkpoint-30m';
const description = 'StarJournal non-character progress checkpoint v1; local read-only observation; 30 minutes; current user only.';
const quotePs = value => "'" + String(value).replace(/'/g, "''") + "'";
const quoteArg = value => {
  if (/["\r\n]/.test(value)) throw Error('Unsupported task argument');
  return '"' + value.replace(/(\\+)$/g, '$1$1') + '"';
};
const actionArgs = [stableScript, '--root=' + root, '--worktree=' + worktree, '--git=' + git].map(quoteArg).join(' ');
const psPrelude = [
  '$ErrorActionPreference = "Stop"',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '$service = New-Object -ComObject Schedule.Service',
  '$service.Connect()',
  '$folder = $service.GetFolder("\\")',
  '$taskName = ' + quotePs(taskName),
].join('\n');
const infoCode = [
  '$task = $folder.GetTask($taskName)',
  '$definition = $task.Definition',
  '$intervals = @(); for($i=1;$i -le $definition.Triggers.Count;$i++){ $t=$definition.Triggers.Item($i); if($t.Type -eq 1){ $intervals += $t.Repetition.Interval }}',
  '[pscustomobject]@{taskName=$taskName;userId=$definition.Principal.UserId;logonType=[int]$definition.Principal.LogonType;runLevel=[int]$definition.Principal.RunLevel;enabled=$task.Enabled;state=[int]$task.State;lastTaskResult=[int]$task.LastTaskResult;lastRunAt=$task.LastRunTime.ToUniversalTime().ToString("o");nextRunAt=$task.NextRunTime.ToUniversalTime().ToString("o");intervals=$intervals;action=$definition.Actions.Item(1).Path;arguments=$definition.Actions.Item(1).Arguments;startWhenAvailable=$definition.Settings.StartWhenAvailable;multipleInstances=[int]$definition.Settings.MultipleInstances} | ConvertTo-Json -Compress -Depth 5',
].join('\n');
const install = [
  psPrelude,
  '$identity = [Security.Principal.WindowsIdentity]::GetCurrent()',
  'if($identity.User.Value -in @("S-1-5-18","S-1-5-19","S-1-5-20")){throw "A real current user account is required"}',
  '$existing=$null;try{$existing=$folder.GetTask($taskName)}catch{if($_.Exception.HResult -ne -2147024894){throw}}',
  'if($existing -and ($existing.Definition.RegistrationInfo.Description -ne ' + quotePs(description) + ' -or $existing.Definition.Actions.Item(1).Arguments -notlike ' + quotePs('*' + stableScript + '*') + ')){throw "Task name belongs to another definition; refusing to replace it"}',
  '$definition = $service.NewTask(0)',
  '$definition.RegistrationInfo.Description = ' + quotePs(description),
  '$definition.RegistrationInfo.Author = $identity.Name',
  '$definition.Principal.UserId = $identity.Name',
  '$definition.Principal.LogonType = 3',
  '$definition.Principal.RunLevel = 0',
  '$definition.Settings.Enabled = $true',
  '$definition.Settings.StartWhenAvailable = $true',
  '$definition.Settings.DisallowStartIfOnBatteries = $false',
  '$definition.Settings.StopIfGoingOnBatteries = $false',
  '$definition.Settings.WakeToRun = $false',
  '$definition.Settings.ExecutionTimeLimit = "PT2M"',
  '$definition.Settings.MultipleInstances = 2',
  '$trigger = $definition.Triggers.Create(1)',
  '$trigger.StartBoundary = (Get-Date).AddMinutes(30).ToString("yyyy-MM-ddTHH:mm:ss")',
  '$trigger.Enabled = $true',
  '$trigger.Repetition.Interval = "PT30M"',
  '$trigger.Repetition.StopAtDurationEnd = $false',
  '$logon = $definition.Triggers.Create(9)',
  '$logon.UserId = $identity.Name',
  '$logon.Enabled = $true',
  '$action = $definition.Actions.Create(0)',
  '$action.Path = ' + quotePs(executable),
  '$action.Arguments = ' + quotePs(actionArgs),
  '$action.WorkingDirectory = ' + quotePs(output),
  '$registered = $folder.RegisterTaskDefinition($taskName,$definition,6,$identity.Name,$null,3)',
  '$null = $registered.Run($null)',
  infoCode,
].join('\n');
const commandOptions = { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024, timeout: 20000 };
const startedAt = Date.now();
let registration;
try {
  const result = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', install], commandOptions);
  registration = JSON.parse(result.stdout.trim().replace(/^\uFEFF/, ''));
} catch (error) {
  const failure = { schemaVersion: 1, installed: false, attemptedAt: new Date().toISOString(), taskName, error: String(error.stderr || error.message).trim(), noElevationAttempted: true };
  await atomic(path.join(output, 'SCHEDULE.json'), JSON.stringify(failure, null, 2) + '\n');
  console.error(JSON.stringify(failure)); process.exit(1);
}
let checkpoint = null;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const state = JSON.parse(await fs.readFile(path.join(output, 'CHECKPOINT_STATE.json'), 'utf8'));
    if (Date.parse(state.generatedAt) >= startedAt) { checkpoint = state; break; }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 250));
}
await new Promise(resolve => setTimeout(resolve, 300));
const result = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psPrelude + '\n' + infoCode], commandOptions);
const verified = JSON.parse(result.stdout.trim().replace(/^\uFEFF/, ''));
const data = { schemaVersion: 1, installed: true, installedAt: new Date().toISOString(), ...verified, script: stableScript, git, checkpointObserved: !!checkpoint, checkpointAt: checkpoint?.generatedAt || null, semantics: 'InteractiveToken: runs only while this user is logged on and Windows can execute the task; no AI inference; STATUS.json remains human-maintained.' };
await atomic(path.join(output, 'SCHEDULE.json'), JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify(data));
if (!checkpoint || verified.lastTaskResult !== 0 || verified.runLevel !== 0 || verified.logonType !== 3 || !verified.intervals.includes('PT30M')) process.exitCode = 1;
