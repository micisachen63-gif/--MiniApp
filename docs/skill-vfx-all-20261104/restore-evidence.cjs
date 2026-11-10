'use strict';
// Restore only the ten canonical coverage receipts from the tracked archive.
// Existing files are verified and never overwritten. All conflicts are checked
// before any missing receipt is created.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const repoRoot = path.resolve(__dirname, '../..');
const realRepoRoot = fs.realpathSync(repoRoot);
const archivePrefix = 'docs/skill-vfx-all-20261104/evidence/';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}
function workspacePath(value, prefix) {
  assert.equal(typeof value, 'string', 'Archive paths must be strings.');
  assert.ok(value.startsWith(prefix), 'Unexpected archive scope: ' + value);
  assert.ok(!value.includes('\\') && !value.includes(':') && !path.isAbsolute(value), 'Use repository-relative forward-slash paths.');
  assert.ok(value.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe path: ' + value);
  const absolute = path.resolve(repoRoot, value);
  assert.ok(inside(repoRoot, absolute), 'Path leaves the repository: ' + value);
  return absolute;
}
function checkExistingAncestor(fullPath) {
  let existing = fullPath;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    assert.notEqual(parent, existing, 'No existing repository ancestor.');
    existing = parent;
  }
  assert.ok(inside(realRepoRoot, fs.realpathSync(existing)), 'A symlink leaves the repository: ' + fullPath);
}
try {
  assert.equal(process.argv.length, 2, 'Run without arguments; destinations come only from archive-index.json.');
  const index = JSON.parse(fs.readFileSync(path.join(__dirname, 'archive-index.json'), 'utf8'));
  assert.equal(index.schemaVersion, 1, 'Unsupported archive index.');
  assert.ok(Array.isArray(index.canonicalEvidence), 'Missing canonical evidence list.');
  assert.equal(index.canonicalEvidence.length, 10, 'Only the ten approved canonical receipts may be restored.');
  const destinations = new Set(), archives = new Set();
  const plans = index.canonicalEvidence.map(entry => {
    assert.match(entry.sha256 || '', /^[a-f0-9]{64}$/, 'Invalid SHA-256.');
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0, 'Invalid byte count.');
    const destination = workspacePath(entry.originalPath, '.release-sync/');
    const archive = workspacePath(entry.archivePath, archivePrefix);
    assert.equal(entry.archivePath, archivePrefix + entry.originalPath.slice('.release-sync/'.length), 'Archive path mapping differs from its recorded origin.');
    assert.ok(!destinations.has(destination) && !archives.has(archive), 'Duplicate evidence path.');
    destinations.add(destination); archives.add(archive);
    checkExistingAncestor(archive); checkExistingAncestor(destination);
    assert.ok(fs.statSync(archive).isFile(), 'Archived evidence is not a file: ' + entry.archivePath);
    const bytes = fs.readFileSync(archive);
    assert.equal(bytes.length, entry.bytes, 'Archive byte count mismatch: ' + entry.archivePath);
    assert.equal(digest(bytes), entry.sha256, 'Archive SHA mismatch: ' + entry.archivePath);
    const exists = fs.existsSync(destination);
    if (exists) {
      assert.ok(fs.statSync(destination).isFile(), 'Existing destination is not a file: ' + entry.originalPath);
      const original = fs.readFileSync(destination);
      assert.equal(original.length, entry.bytes, 'Existing evidence differs; refusing to overwrite: ' + entry.originalPath);
      assert.equal(digest(original), entry.sha256, 'Existing evidence differs; refusing to overwrite: ' + entry.originalPath);
    }
    return { entry, destination, bytes, exists };
  });
  let restored = 0;
  for (const plan of plans) {
    if (plan.exists) continue;
    fs.mkdirSync(path.dirname(plan.destination), { recursive: true });
    checkExistingAncestor(path.dirname(plan.destination));
    fs.writeFileSync(plan.destination, plan.bytes, { flag: 'wx' });
    assert.equal(digest(fs.readFileSync(plan.destination)), plan.entry.sha256, 'Restored evidence SHA mismatch.');
    restored++;
  }
  console.log(JSON.stringify({ status: 'passed', repoRoot, canonicalFiles: plans.length,
    verifiedArchiveFiles: plans.length, restored, unchanged: plans.length - restored, supplementaryRestored: 0 }));
} catch (error) {
  console.error('Evidence restore failed: ' + error.message);
  process.exitCode = 1;
}
