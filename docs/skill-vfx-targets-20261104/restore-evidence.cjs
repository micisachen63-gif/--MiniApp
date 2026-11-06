'use strict';
// Recreate only the ignored evidence paths recorded in this verified archive.
// Default: create missing files or verify identical bytes. Never replace unknown data.
// --upgrade-known: additionally replace only listed, known old canonical receipts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const ARCHIVE = 'docs/skill-vfx-targets-20261104';
const BATCH = '.release-sync/skill-vfx-targets-20261104/';
const CANONICAL = new Set([
  '.release-sync/skill-vfx-20261104/legacy-coverage-events.json',
  '.release-sync/skill-vfx-20261104/legacy-committed-service-events.json',
  '.release-sync/skill-vfx-20261104/legacy-coverage-presentation.json',
  '.release-sync/skill-vfx-20261104/legacy-coverage-browser.json',
  '.release-sync/skill-vfx-20261104/gameplay-coverage-browser.json',
]);
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 1 && args[0] === '--upgrade-known'),
  'Use: node docs/skill-vfx-targets-20261104/restore-evidence.cjs [--upgrade-known]');
const upgradeKnown = args.includes('--upgrade-known');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const indexBytes = fs.readFileSync(path.join(__dirname, 'archive-index.json'));
const index = JSON.parse(indexBytes);
assert.equal(index.schemaVersion, 1);
assert.equal(index.archiveRoot, ARCHIVE);
assert(Array.isArray(index.entries) && index.entries.length > 0);
function cleanRelative(value) {
  assert.equal(typeof value, 'string');
  assert(value.length > 0 && !value.includes('\\') && !value.includes('\0') && !value.includes(':'));
  assert(!path.posix.isAbsolute(value) && path.posix.normalize(value) === value);
  assert(value.split('/').every(part => part && part !== '.' && part !== '..'));
  return value;
}
function safePath(relative) {
  const segments = cleanRelative(relative).split('/');
  let current = ROOT;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'Symlink rejected: ' + relative);
  }
  assert(current.startsWith(ROOT + path.sep));
  return current;
}
function fingerprint(filename) {
  assert(fs.statSync(filename).isFile(), 'Expected regular file: ' + filename);
  const bytes = fs.readFileSync(filename);
  return { bytes: bytes.length, sha256: sha256(bytes) };
}
assert(Array.isArray(index.metadataFiles) && index.metadataFiles.length === 3);
const allowedMetadata = new Set(['.gitattributes', 'restore-evidence.cjs', 'validation-summary.json'].map(name => ARCHIVE + '/' + name));
for (const metadata of index.metadataFiles) {
  assert(allowedMetadata.delete(metadata.path), 'Unexpected or duplicate metadata path');
  assert.deepEqual(fingerprint(safePath(metadata.path)), { bytes: metadata.bytes, sha256: metadata.sha256 },
    'Metadata bytes/hash mismatch: ' + metadata.path);
}
assert.equal(allowedMetadata.size, 0);
const sourceSeen = new Set(), destinationSeen = new Set(), plan = [];
let identical = 0, archiveVerified = 0;
// Complete every validation before the first write, including all conflicting destinations.
for (const entry of index.entries) {
  const source = cleanRelative(entry.source), destination = cleanRelative(entry.destination);
  assert(CANONICAL.has(source) || source.startsWith(BATCH), 'Source not in evidence allow-list: ' + source);
  assert.equal(destination, ARCHIVE + '/evidence/' + source.slice('.release-sync/'.length));
  assert(!sourceSeen.has(source.toLowerCase()) && !destinationSeen.has(destination.toLowerCase()), 'Duplicate path');
  sourceSeen.add(source.toLowerCase()); destinationSeen.add(destination.toLowerCase());
  assert.equal(typeof entry.restore, 'boolean');
  assert(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0);
  assert(/^[0-9a-f]{64}$/.test(entry.sha256));
  assert(Array.isArray(entry.knownPreviousSha256));
  for (const oldHash of entry.knownPreviousSha256) {
    assert(CANONICAL.has(source), 'Upgrades are restricted to the five canonical receipts');
    assert(/^[0-9a-f]{64}$/.test(oldHash) && oldHash !== entry.sha256);
  }
  const archived = safePath(destination);
  assert.deepEqual(fingerprint(archived), { bytes: entry.bytes, sha256: entry.sha256 },
    'Archive bytes/hash mismatch: ' + destination);
  archiveVerified++;
  if (!entry.restore) continue;
  const target = safePath(source);
  if (!fs.existsSync(target)) {
    plan.push({ entry, archived, target, action: 'create' });
    continue;
  }
  const current = fingerprint(target);
  if (current.bytes === entry.bytes && current.sha256 === entry.sha256) { identical++; continue; }
  assert(upgradeKnown && CANONICAL.has(source) && entry.knownPreviousSha256.includes(current.sha256),
    'Refusing different existing bytes: ' + source + ' (' + current.sha256 + '). Only an explicit --upgrade-known and an indexed old canonical hash permit replacement.');
  plan.push({ entry, archived, target, action: 'upgrade-known', priorSha256: current.sha256 });
}
let created = 0, upgraded = 0;
for (const action of plan) {
  const { entry, archived, target } = action;
  safePath(entry.source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  safePath(entry.source);
  if (action.action === 'create') {
    fs.copyFileSync(archived, target, fs.constants.COPYFILE_EXCL);
    created++;
  } else {
    assert.equal(fingerprint(target).sha256, action.priorSha256, 'Destination changed during restore');
    const temporary = target + '.restore-' + process.pid + '.tmp';
    assert(!fs.existsSync(temporary), 'Temporary path already exists');
    try {
      fs.copyFileSync(archived, temporary, fs.constants.COPYFILE_EXCL);
      assert.deepEqual(fingerprint(temporary), { bytes: entry.bytes, sha256: entry.sha256 });
      assert.equal(fingerprint(target).sha256, action.priorSha256, 'Destination changed during restore');
      fs.renameSync(temporary, target);
      upgraded++;
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  assert.deepEqual(fingerprint(target), { bytes: entry.bytes, sha256: entry.sha256 },
    'Restored bytes/hash mismatch: ' + entry.source);
}
console.log(JSON.stringify({
  status: 'passed', mode: upgradeKnown ? 'upgrade-known' : 'missing-or-identical-only',
  indexSha256: sha256(indexBytes), metadataVerified: index.metadataFiles.length, archiveVerified, restoreEligible: index.entries.filter(row => row.restore).length,
  identical, created, upgraded, noOp: created === 0 && upgraded === 0,
}));
