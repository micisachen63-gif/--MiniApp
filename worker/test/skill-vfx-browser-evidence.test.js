import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGameplayReport, normalizeAtlasReport, combineBrowserEvidence } from '../tools/build-skill-vfx-browser-evidence.mjs';

const sha = 'a'.repeat(64), fingerprint = path => ({ path, sha256: sha });
const shared = [
  'worker/public/skill-vfx-legacy.mjs', 'worker/public/skill-vfx-engine.mjs',
  'worker/public/skill-vfx-catalog.json', 'worker/public/skill-vfx-recipes.json',
  'worker/src/game/skill-vfx-events.js', 'worker/src/game/special.js',
];
const party = ['worker/public/expedition/combat-playback.js', 'worker/public/expedition/hero-art-playback.js', 'worker/src/services/party.js'];
const files = [...shared, ...party, 'worker/public/star-ring-heroes.js'].map(fingerprint);
const event = (eventId, source = 'committed-combat') => ({ eventId, skillId: 'native:sword:base', source, targetIds: ['enemy'], kind: 'cast' });
function gameplay(source = 'committed-combat') {
  const actual = event('drawn', source);
  return {
    source: 'real-isolated-api', isolated: true, ephemeral: true, productionAccess: false,
    status: 'failed', sourceFiles: files, sourceFilesAfter: files,
    cases: [{
      mode: 'party', width: 390, status: 'passed', errors: [], badResponses: [],
      receipts: [{ status: 200, vfx: [actual, event('received-only', source)] }],
      first: { active: [{ mode: 'party', accepted: 1, drawCalls: 12, drawFrames: 2, lastRender: { manual: false }, lastEvent: actual }] },
      result: { active: [] },
    }, { mode: 'ring', width: 390, status: 'failed' }],
  };
}
test('passing independent mode retains matching producer hashes; received-only events never claim browser playback', () => {
  const report = gameplay(), part = normalizeGameplayReport('capture.json', report, path => path === 'worker/public/star-ring-heroes.js' ? 'b'.repeat(64) : sha);
  assert.equal(part.excluded.length, 1);
  assert.equal(part.source.status, 'failed');
  assert.equal(part.cases.find(row => row.evidenceKind === 'committed-api').events.length, 2);
  assert.deepEqual(part.cases.find(row => row.evidenceKind === 'browser-gameplay-api').events.map(e => e.eventId), ['drawn']);
  assert.ok(!part.sourceFiles.some(file => file.path === 'worker/public/star-ring-heroes.js'));
  assert.equal(combineBrowserEvidence([part]).summary.browserIdentities, 1);
});
test('stale mode sources and mismatched target observations fail closed', () => {
  const stale = normalizeGameplayReport('capture.json', gameplay(), path => path === party[0] ? 'b'.repeat(64) : sha);
  assert.equal(stale.cases.length, 0); assert.match(stale.excluded[0].reason, /stale/);
  assert.throws(() => combineBrowserEvidence([stale]), /No completed/);
  const wrong = gameplay(); wrong.cases[0].first.active[0].lastEvent = { ...event('drawn'), targetIds: ['unobserved'] };
  const mismatch = normalizeGameplayReport('capture.json', wrong, () => sha);
  assert.equal(mismatch.cases.length, 0); assert.match(mismatch.excluded[0].reason, /target IDs differ/);
});
test('a real deterministic projection may prove drawing but cannot prove a committed write', () => {
  const part = normalizeGameplayReport('capture.json', gameplay('deterministic-projection'), () => sha);
  assert.ok(part.cases.some(row => row.evidenceKind === 'browser-gameplay-api'));
  assert.ok(!part.cases.some(row => row.evidenceKind === 'committed-api'));
  assert.ok(part.cases.every(row => row.events.every(event => event.source === 'deterministic-projection')));
});

const atlasFiles = [
  'worker/src/game/atlas-engine.js', 'worker/src/game/atlas-combat-observer.js', 'worker/src/services/atlas.js',
  'worker/public/scene-live-session.js', 'worker/public/scene-live-view.js',
  'worker/public/skill-vfx-engine.mjs', 'worker/public/skill-vfx-actor-bridge.mjs',
  'worker/public/skill-vfx-combat-adapter.mjs', 'worker/public/skill-vfx-catalog.json', 'worker/public/skill-vfx-recipes.json',
].map(fingerprint);
function atlas() {
  const cast = { eventId: 'run:cast:1', skillId: 'atlas:mage_chain', type: 'skill_cast', targetIds: ['enemy'] };
  const health = { isolated: true, ephemeral: true, productionAccess: false };
  return {
    health, apiHealth: health, sourceFiles: atlasFiles, sourceFilesAfter: atlasFiles, errors: [], badResponses: [],
    cases: [{ passed: true, build: 'mage_chain', runId: 'run', width: 390,
      release: { eventId: cast.eventId, player: { active: 1, drawCalls: 6, manual: false } }, clear: { player: { active: 0 } } }],
    receipts: [{ build: 'mage_chain', width: 390, sceneRevision: 3,
      trace: { schemaVersion: 1, source: 'committed-combat', revision: 3, context: { dispatchId: 'run' }, events: [cast] } }],
  };
}
test('Atlas evidence binds committed revision, run identity and real release draw before adding all four layers', () => {
  const report = atlas(), part = normalizeAtlasReport('atlas.json', report, () => sha);
  assert.equal(part.cases.length, 4); assert.equal(part.excluded.length, 0);
  assert.ok(part.cases.every(row => row.mode === 'atlas' && row.events[0].source === 'committed-combat'));
  const wrongRevision = atlas(); wrongRevision.receipts[0].sceneRevision = 2;
  const wrong = normalizeAtlasReport('atlas.json', wrongRevision, () => sha);
  assert.equal(wrong.cases.length, 0); assert.match(wrong.excluded[0].reason, /revision/);
  const manual = atlas(); manual.cases[0].release.player.manual = true;
  assert.equal(normalizeAtlasReport('atlas.json', manual, () => sha).cases.length, 0);
});
