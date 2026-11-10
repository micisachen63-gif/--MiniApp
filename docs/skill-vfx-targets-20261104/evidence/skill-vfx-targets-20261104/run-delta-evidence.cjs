'use strict';
// Run only after the renderer owner has announced the candidate is frozen.
// This wrapper never touches the shared 9667/9666 preview or production.
// Examples: node .release-sync/skill-vfx-targets-20261104/run-delta-evidence.cjs
//           node .../run-delta-evidence.cjs --step=identity --step=gameplay
// Each invocation creates a new execution directory and preserves old receipts.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const WORKTREE = 'D:/StarJournal/worktree-snapshots/star-journal-skill-vfx-20261104';
const BATCH = '.release-sync/skill-vfx-targets-20261104';
const GIT = 'C:/Users/User/Documents/ChatGPT/tools/git/cmd/git.exe';
const MODULES = 'D:/StarJournal/worktree-snapshots/star-journal-button-polish-20261104/.release-sync/browser-tools/node_modules';
const CANONICAL = [
  '.release-sync/skill-vfx-20261104/legacy-coverage-events.json',
  '.release-sync/skill-vfx-20261104/legacy-committed-service-events.json',
  '.release-sync/skill-vfx-20261104/legacy-coverage-presentation.json',
  '.release-sync/skill-vfx-20261104/legacy-coverage-browser.json',
  '.release-sync/skill-vfx-20261104/gameplay-coverage-browser.json',
];
const BACKEND_RECEIPTS = CANONICAL.slice(0, 2);
const EXPLICIT_SOURCES = [
  'worker/public/skill-vfx-engine.mjs',
  'worker/public/skill-vfx-catalog.json',
  'worker/public/skill-vfx-recipes.json',
  'worker/public/skill-vfx-coverage.json',
  'worker/public/skill-vfx-legacy.mjs',
  'worker/test/skill-vfx-legacy-harness.js',
  'worker/tools/build-skill-vfx-catalog.mjs',
  'worker/tools/build-skill-vfx-recipes.mjs',
  'worker/tools/skill-vfx-legacy-presentation-check.mjs',
  'worker/tools/skill-vfx-identity-browser.mjs',
  'worker/tools/skill-vfx-gameplay-browser.mjs',
  BATCH + '/run-delta-evidence.cjs',
];
const ORDER = ['catalog-check', 'recipes-build', 'recipes-check', 'presentation', 'identity', 'gameplay'];
const args = process.argv.slice(2);
assert(args.every(arg => /^--step=[a-z-]+$/.test(arg)), 'Only repeated --step=name flags are supported.');
const requested = args.map(arg => arg.slice('--step='.length));
assert(requested.every(name => ORDER.includes(name)), 'Unknown step. Use: ' + ORDER.join(', '));
const selected = requested.length ? ORDER.filter(name => requested.includes(name)) : ORDER;

const normalize = value => String(value).replaceAll('\\', '/');
const full = relative => {
  const resolved = path.resolve(WORKTREE, relative), rel = path.relative(WORKTREE, resolved);
  assert(!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep), 'Path escapes worktree: ' + relative);
  return resolved;
};
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const json = relative => JSON.parse(fs.readFileSync(full(relative), 'utf8'));
const writeJson = (relative, value) => {
  const destination = full(relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = destination + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, destination);
};
const describe = relative => {
  const file = full(relative);
  if (!fs.existsSync(file)) return { path: relative, exists: false, bytes: null, sha256: null };
  const bytes = fs.readFileSync(file);
  return { path: relative, exists: true, bytes: bytes.length, sha256: sha(bytes) };
};
const snapshot = paths => paths.map(describe);
const changes = (before, after) => {
  const prior = new Map(before.map(row => [row.path, row]));
  return after.filter(row => row.sha256 !== prior.get(row.path)?.sha256 || row.exists !== prior.get(row.path)?.exists)
    .map(row => ({ path: row.path, before: prior.get(row.path)?.sha256 || null, after: row.sha256 }));
};
const git = argv => cp.execFileSync(GIT, argv, { cwd: WORKTREE, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runRelative = BATCH + '/execution-' + stamp + '-' + process.pid;
const runFile = runRelative + '/execution.json';
const run = {
  schemaVersion: 1,
  scope: 'orchestrator execution receipts; not itself skill coverage evidence',
  status: 'running',
  startedAt: new Date().toISOString(),
  cwd: WORKTREE,
  selectedSteps: selected,
  environment: { CODEX_PRIMARY_RUNTIME_NODE_MODULES: MODULES },
  steps: [],
};
let sourcePaths = [];
let expectedSources = [];
let expectedCanonical = [];

function persist() {
  writeJson(runFile, run);
  writeJson(BATCH + '/LAST_RUN.json', {
    schemaVersion: 1, updatedAt: new Date().toISOString(),
    status: run.status, execution: runFile, selectedSteps: selected,
    currentStep: run.steps.at(-1)?.id || null,
  });
}
function makeStep(id) {
  const common = { id, expectedSourceWrites: [], expectedCanonicalWrites: [], env: {}, reports: [], timeoutMs: 120000 };
  const definitions = {
    'catalog-check': { argv: ['worker/tools/build-skill-vfx-catalog.mjs', '--check'] },
    'recipes-build': {
      argv: ['worker/tools/build-skill-vfx-recipes.mjs'],
      expectedSourceWrites: ['worker/public/skill-vfx-recipes.json'],
      reports: ['worker/public/skill-vfx-recipes.json'],
    },
    'recipes-check': { argv: ['worker/tools/build-skill-vfx-recipes.mjs', '--check'] },
    presentation: {
      argv: ['worker/tools/skill-vfx-legacy-presentation-check.mjs'],
      expectedCanonicalWrites: [CANONICAL[2]], reports: [CANONICAL[2]],
    },
    identity: {
      argv: ['worker/tools/skill-vfx-identity-browser.mjs', '--out=' + runRelative + '/identity-browser'],
      expectedCanonicalWrites: [CANONICAL[3]],
      reports: [runRelative + '/identity-browser/results.json', CANONICAL[3]],
      timeoutMs: 360000,
    },
    gameplay: {
      argv: ['worker/tools/skill-vfx-gameplay-browser.mjs'],
      env: { SKILL_VFX_GAMEPLAY_QA_DIR: full(runRelative + '/legacy-gameplay') },
      reports: [runRelative + '/legacy-gameplay/results.json'],
      timeoutMs: 900000,
    },
  };
  return { ...common, ...definitions[id] };
}

try {
  assert.equal(normalize(fs.realpathSync(WORKTREE)).toLowerCase(), normalize(path.resolve(WORKTREE)).toLowerCase(), 'Unexpected worktree location');
  assert.equal(normalize(path.resolve(__dirname)).toLowerCase(), normalize(full(BATCH)).toLowerCase(), 'Run the wrapper saved in the designated worktree');
  assert(fs.existsSync(path.join(MODULES, 'playwright/package.json')), 'The expected existing Playwright installation is unavailable');
  assert.equal(git(['branch', '--show-current']), 'codex/skill-vfx-20261104', 'Wrong branch');
  run.head = git(['rev-parse', 'HEAD']);
  run.gitStatusBefore = git(['status', '--short']);
  fs.mkdirSync(full(runRelative), { recursive: false });
  persist();

  // Back up exact prior bytes before any tool can replace a canonical receipt.
  const receiptValues = [], backups = [];
  fs.mkdirSync(full(runRelative + '/baseline'), { recursive: true });
  for (const source of CANONICAL) {
    const before = describe(source);
    assert(before.exists, 'Missing baseline receipt: ' + source);
    const destination = runRelative + '/baseline/' + path.basename(source);
    fs.copyFileSync(full(source), full(destination), fs.constants.COPYFILE_EXCL);
    const copied = describe(destination);
    assert.equal(copied.sha256, before.sha256, 'Baseline backup differs: ' + source);
    assert.equal(copied.bytes, before.bytes, 'Baseline backup size differs: ' + source);
    backups.push({ source, destination, bytes: copied.bytes, sha256: copied.sha256 });
    receiptValues.push(json(source));
  }
  run.baselineBackups = backups;
  writeJson(runRelative + '/baseline/index.json', { schemaVersion: 1, copiedAt: new Date().toISOString(), entries: backups });

  // Use source path lists as the watch scope, not old hash values as new proof.
  // Generated canonical outputs are tracked separately from stable inputs.
  const coverage = json('worker/public/skill-vfx-coverage.json');
  const recordedPaths = [
    ...(coverage.sourceFiles || []),
    ...receiptValues.flatMap(value => value.sourceFiles || []),
  ].map(row => normalize(row.path));
  sourcePaths = [...new Set([...EXPLICIT_SOURCES, ...recordedPaths, ...BACKEND_RECEIPTS])]
    .filter(relative => !relative.startsWith('.release-sync/') || BACKEND_RECEIPTS.includes(relative) || relative === BATCH + '/run-delta-evidence.cjs')
    .sort();
  expectedSources = snapshot(sourcePaths);
  assert(expectedSources.every(row => row.exists), 'Missing tracked source input: ' + expectedSources.filter(row => !row.exists).map(row => row.path).join(', '));
  expectedCanonical = snapshot(CANONICAL);
  run.initialSourceFiles = expectedSources;
  run.sourceWatchPolicy = 'Exact source paths recorded by existing coverage/receipts plus these invoked tools, the legacy harness and two unchanged backend receipt inputs. New hashes are captured before execution; old hashes are never rewritten.';
  persist();

  for (const [index, id] of selected.entries()) {
    const spec = makeStep(id), prefix = runRelative + '/' + String(index + 1).padStart(2, '0') + '-' + id;
    const record = {
      id, status: 'running', startedAt: new Date().toISOString(),
      executable: process.execPath, args: spec.argv, cwd: WORKTREE,
      environment: { CODEX_PRIMARY_RUNTIME_NODE_MODULES: MODULES, ...spec.env },
      sourceFilesBefore: snapshot(sourcePaths), canonicalBefore: snapshot(CANONICAL),
      declaredSourceOutputs: spec.expectedSourceWrites,
      declaredCanonicalOutputs: spec.expectedCanonicalWrites,
      stdout: prefix + '.stdout.log', stderr: prefix + '.stderr.log',
      receipt: prefix + '.execution.json',
    };
    run.steps.push(record);
    writeJson(record.receipt, record); persist();
    assert.deepEqual(changes(expectedSources, record.sourceFilesBefore), [], 'Source changed between frozen steps');
    assert.deepEqual(changes(expectedCanonical, record.canonicalBefore), [], 'Canonical receipt changed outside this wrapper');
    console.log(JSON.stringify({ stage: 'start', id, execution: record.receipt }));

    const started = Date.now();
    const result = cp.spawnSync(process.execPath, spec.argv, {
      cwd: WORKTREE,
      env: { ...process.env, CODEX_PRIMARY_RUNTIME_NODE_MODULES: MODULES, ...spec.env },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      timeout: spec.timeoutMs, maxBuffer: 128 * 1024 * 1024,
    });
    fs.writeFileSync(full(record.stdout), result.stdout || '');
    fs.writeFileSync(full(record.stderr), result.stderr || '');
    Object.assign(record, {
      finishedAt: new Date().toISOString(), durationMs: Date.now() - started,
      pid: result.pid || null, exitCode: result.status, signal: result.signal || null,
      processError: result.error ? { code: result.error.code, message: result.error.message } : null,
      sourceFilesAfter: snapshot(sourcePaths), canonicalAfter: snapshot(CANONICAL),
      reports: spec.reports.map(describe),
    });
    record.sourceChanges = changes(record.sourceFilesBefore, record.sourceFilesAfter);
    record.unexpectedSourceChanges = record.sourceChanges.filter(row => !spec.expectedSourceWrites.includes(row.path));
    record.canonicalChanges = changes(record.canonicalBefore, record.canonicalAfter);
    record.unexpectedCanonicalChanges = record.canonicalChanges.filter(row => !spec.expectedCanonicalWrites.includes(row.path));
    record.checks = {
      processExitedSuccessfully: result.status === 0 && !result.error && !result.signal,
      stableInputs: record.unexpectedSourceChanges.length === 0,
      canonicalWritesRestricted: record.unexpectedCanonicalChanges.length === 0,
      declaredReportsPresent: record.reports.every(row => row.exists),
    };
    record.status = Object.values(record.checks).every(Boolean) ? 'passed' : 'failed';
    writeJson(record.receipt, record); persist();
    assert.equal(record.status, 'passed', 'Step failed; inspect durable stdout/stderr and execution receipt: ' + id);

    if (id === 'presentation') {
      const report = json(CANONICAL[2]);
      assert.equal(report.status, 'passed');
      assert.equal(report.summary.acceptedIdentities, 184);
      record.observation = { status: report.status, identities: report.summary.acceptedIdentities };
    } else if (id === 'identity') {
      const report = json(spec.reports[0]);
      assert.equal(report.status, 'passed');
      assert.equal(report.summary.identities, 184);
      assert.equal(report.summary.changedSources.length, 0);
      assert.equal(describe(spec.reports[0]).sha256, describe(CANONICAL[3]).sha256, 'Canonical browser receipt differs from raw new result');
      record.observation = report.summary;
    } else if (id === 'gameplay') {
      const report = json(spec.reports[0]);
      assert.equal(report.cases.length, 16);
      assert(report.cases.every(row => row.status === 'passed'), 'Some real gameplay cases failed');
      record.observation = { cases: report.cases.length, allPassed: true, source: report.source, isolated: report.isolated, productionAccess: report.productionAccess };
    }
    expectedSources = record.sourceFilesAfter;
    expectedCanonical = record.canonicalAfter;
    writeJson(record.receipt, record); persist();
    console.log(JSON.stringify({ stage: 'complete', id, status: record.status, durationMs: record.durationMs, reports: record.reports }));
  }
  run.finalSourceFiles = snapshot(sourcePaths);
  assert.deepEqual(changes(expectedSources, run.finalSourceFiles), [], 'Source changed after the last frozen step');
  run.sourceChanges = changes(run.initialSourceFiles, run.finalSourceFiles);
  run.gitStatusAfter = git(['status', '--short']);
  run.status = 'passed'; run.finishedAt = new Date().toISOString();
  persist();
  console.log(JSON.stringify({ status: run.status, execution: runFile, selectedSteps: selected,
    identityResult: run.steps.find(row => row.id === 'identity')?.reports?.[0]?.path || null,
    gameplayResult: run.steps.find(row => row.id === 'gameplay')?.reports?.[0]?.path || null,
    sourceChanges: run.sourceChanges }));
} catch (error) {
  run.status = 'failed'; run.finishedAt = new Date().toISOString();
  run.failure = { message: error.message, stack: error.stack };
  const active = run.steps.at(-1);
  if (active) {
    active.status = 'failed'; active.validationError = run.failure;
    active.finishedAt ||= run.finishedAt;
    writeJson(active.receipt, active);
  }
  try { persist(); } catch (saveError) { console.error('Unable to save execution failure: ' + saveError.message); }
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
