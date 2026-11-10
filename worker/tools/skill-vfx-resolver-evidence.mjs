/**
 * Capture current legacy resolver events with pre-VFX golden equivalence.
 * Does not call any service, preview, live API, or deployment operation.
 *
 * node worker/tools/skill-vfx-resolver-evidence.mjs [--out=relative/path.json]
 * Existing output is never overwritten. Select a fresh path to preserve history.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gatherLegacyCases, canonical } from '../test/legacy-skill-vfx-fixture.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length <= 1 && args.every(arg => /^--out=.+$/.test(arg)), 'Use [--out=relative/path.json]');
const output = path.resolve(root, args[0]?.slice(6) || '.release-sync/skill-vfx-20261104/legacy-coverage-events.json');
const relative = path.relative(root, output);
assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Output must stay inside this worktree.');
assert.ok(!fs.existsSync(output), 'Output already exists; preserve it and select a fresh --out path.');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = name => fs.readFileSync(path.resolve(root, name));
const git = argv => execFileSync('git', argv, { cwd: root, encoding: 'utf8' }).trim();
const sourceCommit = git(['rev-parse', 'HEAD']);
const sourceStatus = git(['status', '--short']);
const goldenPath = 'worker/test/fixtures/legacy-skill-vfx-baseline-20261104.json';
const sourcePaths = [...new Set([
  ...execFileSync('git', ['ls-files', '-z', '--', 'worker/src'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean),
  'worker/test/helpers.js',
  'worker/test/legacy-skill-vfx-fixture.js',
  'worker/tools/skill-vfx-resolver-evidence.mjs',
  goldenPath,
])].sort();
const fingerprint = () => sourcePaths.map(name => ({ path: name, sha256: hash(read(name)) }));
const sourceFiles = fingerprint();
const startedAt = new Date().toISOString();
const rows = gatherLegacyCases({ observed: true });
const baseline = JSON.parse(read(goldenPath).toString('utf8'));
const failures = [];
for (const row of rows) {
  const wanted = baseline.cases.find(item => item.id === row.id && item.mode === row.mode);
  if (hash(JSON.stringify(canonical(row.value))) !== wanted?.sha256) failures.push({ id: row.id, mode: row.mode });
}
const events = row => row.mode === 'idle' ? row.value.report.combat?.vfxEvents || []
  : row.mode === 'boss' ? row.value.result.actions.flatMap(item => [item.vfx, ...(item.vfxEvents || [])].filter(Boolean))
  : row.mode === 'pk' ? row.value.log.flatMap(item => [item.vfx, ...(item.vfxEvents || [])].filter(Boolean))
  : [row.value.result.vfx].filter(Boolean);
const cases = rows.map(row => ({
  id: row.id, mode: row.mode, evidenceKind: 'engine-resolver-fixture',
  status: failures.some(failure => failure.id === row.id && failure.mode === row.mode) ? 'failed' : 'passed',
  events: events(row),
  snapshot: row.mode === 'idle' ? row.value.report.combat
    : row.mode === 'boss' ? row.value.result
    : row.mode === 'pk' ? row.value
    : {
      result: row.value.result,
      actor: { id: row.value.actor.id, hp: row.value.actor.hp, mp: row.value.actor.mp, base: row.value.actor.base, path: row.value.actor.path },
      ally: { id: row.value.ally.id, hp: row.value.ally.hp, mp: row.value.ally.mp },
      enemy: { id: row.value.enemy.id, hp: row.value.enemy.hp },
    },
}));
const observed = [...new Set(cases.flatMap(row => row.events.map(event => event.skillId)))];
const sourceFilesAfter = fingerprint();
const sourceChanges = sourceFiles.filter((file, index) => file.sha256 !== sourceFilesAfter[index].sha256).map(file => file.path);
const passed = failures.length === 0 && rows.length === 432 && baseline.cases.length === 432 && observed.length === 184 && sourceChanges.length === 0;
const receipt = {
  schemaVersion: 1, status: passed ? 'passed' : 'failed', startedAt,
  generatedAt: new Date().toISOString(), sourceCommit, sourceStatus, sourceFiles, sourceFilesAfter, sourceChanges,
  summary: {
    baselineCases: rows.length, equalCases: rows.length - failures.length, canonicalIdentities: observed.length,
    byMode: Object.fromEntries(['idle', 'boss', 'pk', 'resolver'].map(mode => [mode, {
      cases: cases.filter(row => row.mode === mode).length,
      withExpectedIdentity: cases.filter(row => row.mode === mode && row.events.some(event => event.skillId === row.id)).length,
    }])),
  },
  failures, cases,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: receipt.status, output: relative.replaceAll('\\', '/'), sourceCommit,
  sourceFiles: sourceFiles.length, sourceChanges, summary: receipt.summary, failures,
  missing: cases.filter(row => !row.events.some(event => event.skillId === row.id)).map(row => ({ id: row.id, mode: row.mode })) }));
assert.equal(rows.length, 432, 'The authoritative resolver matrix must retain all 432 golden cases.');
assert.equal(baseline.cases.length, 432, 'Original pre-VFX golden inputs must remain complete.');
assert.equal(failures.length, 0, 'Gameplay drift from pre-VFX goldens');
assert.equal(observed.length, 184, 'All legacy identities have a real resolver event');
assert.deepEqual(sourceChanges, [], 'Source changed during resolver capture');
