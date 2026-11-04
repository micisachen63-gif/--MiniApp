import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/scene-live-session.js', import.meta.url), 'utf8');
const SCOPE = { accountId: 'account-1', realmId: 'permanent', characterId: 'hero-1', dispatchId: 'run-1' };
function scene(revision = 1, roomIndex = 0) {
  return { schemaVersion: 1, accountId: SCOPE.accountId, realmId: SCOPE.realmId, characterId: SCOPE.characterId,
    live: { revision, activeRunId: 'run-1' }, character: { id: SCOPE.characterId },
    run: { id: 'run-1', characterId: SCOPE.characterId, realmId: SCOPE.realmId, revision, active: true, mapIndex: 0, roomIndex } };
}
function trace(revision = 1, overrides = {}) {
  return { schemaVersion: 1, source: 'committed-combat', context: { ...SCOPE }, revision,
    committedAtMs: 10000, resolutionMs: 1000, events: [], limit: 128, dropped: 0, total: 0, ...overrides };
}
function fixture(reply, options = {}) {
  const sandbox = { AbortController, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask };
  vm.runInNewContext(source, sandbox, { filename: 'scene-live-session.js' });
  const calls = [], log = [], errors = [];
  const session = sandbox.RpgSceneSession.create({
    accountId: SCOPE.accountId, realmId: SCOPE.realmId, characterId: SCOPE.characterId, endpoint: 'http://local/app/api/',
    async fetch(url) {
      const action = url.split('/app/api/')[1]; calls.push(action); log.push('request:' + action);
      const value = typeof reply === 'function' ? reply(action, calls.length) : reply[action];
      return { ok: true, status: 200, json: async () => value };
    },
    onSnapshot: value => log.push('scene:' + (value?.run?.revision ?? 'null')),
    onCombatTrace: value => log.push('trace:' + value.revision),
    onListenerError: error => errors.push(error.message), ...options,
  });
  return { session, calls, log, errors };
}

test('successful write trace follows its accepted scene and precedes the forced refresh', async () => {
  const receipt = { ok: true, scene: scene(2), combatTrace: trace(2) };
  const f = fixture({ 'atlas/settle': receipt, 'atlas/status': { ok: true, scene: scene(3, 1) } });
  const seen = [];
  f.session.subscribeCombatTrace((value, acceptedScene) => {
    seen.push({ revision: value.revision, snapshot: f.session.getSnapshot(), acceptedScene });
    f.log.push('listener:' + value.revision);
  });
  const result = await f.session.request('atlas/settle');
  assert.equal(result, receipt);
  assert.deepEqual(f.log, ['request:atlas/settle', 'scene:2', 'listener:2', 'trace:2', 'request:atlas/status', 'scene:3']);
  assert.equal(seen[0].snapshot, receipt.scene); assert.equal(seen[0].acceptedScene, receipt.scene);
  f.session.dispose();
});

test('a newer attached scene never rewrites the original committed trace revision', async () => {
  const originalTrace = trace(2), received = [];
  const f = fixture({ 'atlas/settle': { ok: true, scene: scene(3), combatTrace: originalTrace }, 'atlas/status': { ok: true, scene: scene(3) } });
  f.session.subscribeCombatTrace((value, snapshot) => received.push([value, snapshot.run.revision]));
  await f.session.request('atlas/settle');
  assert.equal(received.length, 1); assert.equal(received[0][0], originalTrace);
  assert.equal(received[0][0].revision, 2); assert.equal(received[0][1], 3);
  f.session.dispose();
});

test('status is read-only presentation and never publishes a trace attached to a read', async () => {
  const f = fixture({ 'atlas/status': { ok: true, scene: scene(), combatTrace: trace() } });
  let count = 0; f.session.subscribeCombatTrace(() => count++);
  await f.session.refresh(); assert.equal(count, 0);
  f.session.subscribeCombatTrace(() => count++); assert.equal(count, 0, 'subscribe must not replay old receipts');
  f.session.dispose();
});

test('a superseded write projection remains successful but its trace is not published', async () => {
  const f = fixture({
    'atlas/status': { ok: true, scene: scene(4) },
    'atlas/settle': { ok: true, scene: scene(3), combatTrace: trace(3) },
  });
  await f.session.refresh(); let count = 0; f.session.subscribeCombatTrace(() => count++);
  const result = await f.session.request('atlas/settle');
  assert.equal(result.ok, true); assert.equal(count, 0); assert.equal(f.session.getSnapshot().run.revision, 4);
  f.session.dispose();
});

test('mismatched dispatch and impossible future trace revisions are not published', async () => {
  for (const value of [trace(1, { context: { ...SCOPE, dispatchId: 'run-2' } }), trace(2)]) {
    const f = fixture({ 'atlas/settle': { ok: true, scene: scene(1), combatTrace: value }, 'atlas/status': { ok: true, scene: scene(1) } });
    let count = 0; f.session.subscribeCombatTrace(() => count++);
    await f.session.request('atlas/settle'); assert.equal(count, 0);
    f.session.dispose();
  }
});

test('stop may publish a committed trace and subscriber errors cannot undo the write receipt', async () => {
  const f = fixture({ 'atlas/stop': { ok: true, scene: scene(), combatTrace: trace() }, 'atlas/status': { ok: true, scene: scene() } });
  f.session.subscribeCombatTrace(() => { throw Error('listener fixture'); });
  const result = await f.session.request('atlas/stop');
  assert.equal(result.ok, true); assert.deepEqual(f.errors, ['listener fixture']);
  assert(f.log.includes('trace:1')); f.session.dispose();
});

test('a context switch inside snapshot listeners prevents trace delivery from that request', async () => {
  const f = fixture({ 'atlas/settle': { ok: true, scene: scene(2), combatTrace: trace(2) }, 'atlas/status': { ok: true, scene: scene(2) } });
  let count = 0, switched = false;
  f.session.subscribe(value => {
    if (value && !switched) { switched = true; f.session.setContext({ characterId: 'hero-2' }); }
  });
  f.session.subscribeCombatTrace(() => count++);
  await assert.rejects(f.session.request('atlas/settle'), error => error.code === 'context_changed');
  assert.equal(count, 0); f.session.dispose();
});
