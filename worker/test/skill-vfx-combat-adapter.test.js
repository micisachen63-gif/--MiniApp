import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatVfxAdapter } from '../public/skill-vfx-combat-adapter.mjs';

const BASE = Object.freeze({ accountId: 'account-1', realmId: 'permanent', characterId: 'hero-1', dispatchId: 'run-1' });
const defer = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function fixture(extra = {}, behavior) {
  let now = 10000, clears = 0;
  const calls = [], known = new Set(['fireball', 'shield', 'slash']);
  const player = {
    hasSkill: id => known.has(id),
    clear() { clears++; },
    async play(request) {
      calls.push(request);
      if (behavior) await behavior(request);
      if (request.canStart && !request.canStart()) return { accepted: false, reason: 'superseded' };
      return { accepted: true, instanceId: 'instance-' + calls.length };
    },
  };
  const adapter = createCombatVfxAdapter(player, { context: BASE, now: () => now, ...extra });
  const event = (overrides = {}) => ({
    schemaVersion: 1, source: 'committed-combat', type: 'skill_cast', eventId: 'event-1',
    skillId: 'fireball', revision: 1, atMs: now, context: { ...BASE },
    from: { x: 20, y: 60 }, to: { x: 200, y: 60 }, targets: [{ x: 200, y: 60 }],
    direction: 'right', bodyHeight: 120, ...overrides,
  });
  return { adapter, event, calls, player, setNow(value) { now = value; }, get clears() { return clears; } };
}

test('accepts a committed cast and forwards presentation only', async () => {
  const f = fixture();
  const result = await f.adapter.ingest(f.event({ damage: 9999, gold: 300 }));
  assert.equal(result.accepted, true);
  assert.equal(result.eventId, 'event-1');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].skillId, 'fireball');
  assert.equal(f.calls[0].bodyHeight, 120);
  assert.equal(f.calls[0].ageMs, 0);
  assert.equal(typeof f.calls[0].canStart, 'function');
  assert.equal('damage' in f.calls[0], false);
  assert.equal('gold' in f.calls[0], false);
});

test('rejects summaries, synthetic sources, and unsupported versions', async () => {
  const f = fixture();
  for (const change of [{ type: 'enemy_defeated' }, { source: 'scene-summary' }, { schemaVersion: 2 }, { source: undefined }]) {
    assert.equal((await f.adapter.ingest(f.event(change))).reason, 'unsupported-event');
  }
  assert.equal(f.calls.length, 0);
});

test('requires an exact account, realm, character, and dispatch context', async () => {
  const f = fixture();
  for (const key of Object.keys(BASE)) {
    assert.equal((await f.adapter.ingest(f.event({ context: { ...BASE, [key]: 'other' } }))).reason, 'context-mismatch');
  }
  assert.equal((await f.adapter.ingest(f.event({ context: { ...BASE, characterId: 1 } }))).reason, 'context-mismatch');
  assert.equal(f.calls.length, 0);
});

test('rejects missing metadata, invalid revisions, and invalid timestamps', async () => {
  const f = fixture();
  for (const change of [{ eventId: '' }, { skillId: '' }, { revision: -1 }, { revision: 1.5 }, { atMs: NaN }, { atMs: -1 }]) {
    assert.equal((await f.adapter.ingest(f.event(change))).reason, 'invalid-event');
  }
});

test('rejects invalid coordinates, directions, body sizes, targets, and seed', async () => {
  const f = fixture({ maxTargets: 2 });
  for (const change of [
    { from: { x: NaN, y: 2 } }, { to: { x: Infinity, y: 0 } }, { to: { x: 1000001, y: 0 } },
    { targets: [{ x: 1, y: '2' }] }, { targets: [{ x: 1, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 2 }] },
    { direction: 'north-west' }, { bodyHeight: 0 }, { bodyHeight: Infinity }, { seed: 0.5 },
  ]) assert.equal((await f.adapter.ingest(f.event(change))).reason, 'invalid-geometry');
  assert.equal(f.calls.length, 0);
});

test('rejects expired and implausibly future events', async () => {
  const f = fixture({ maxAgeMs: 1000, maxFutureMs: 50 });
  assert.equal((await f.adapter.ingest(f.event({ atMs: 8999 }))).reason, 'expired');
  assert.equal((await f.adapter.ingest(f.event({ atMs: 10051 }))).reason, 'future-event');
  assert.equal((await f.adapter.ingest(f.event({ atMs: 9000 }))).accepted, true);
  assert.equal(f.calls[0].ageMs, 1000);
});

test('rejects unknown skill IDs before onCast or player.play', async () => {
  let hooks = 0;
  const f = fixture({ onCast() { hooks++; } });
  assert.equal((await f.adapter.ingest(f.event({ skillId: 'not-a-real-skill' }))).reason, 'unknown-skill');
  assert.equal(hooks, 0);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.adapter.ingest(f.event())).accepted, true);
});

test('explicit skill allowlist can narrow the player catalog', async () => {
  const f = fixture({ skillIds: ['shield'] });
  assert.equal((await f.adapter.ingest(f.event())).reason, 'unknown-skill');
  assert.equal((await f.adapter.ingest(f.event({ skillId: 'shield' }))).accepted, true);
});

test('prevents duplicate events while asset loading and after acceptance', async () => {
  const wait = defer(), f = fixture({}, () => wait.promise);
  const first = f.adapter.ingest(f.event());
  assert.equal((await f.adapter.ingest(f.event())).reason, 'duplicate');
  assert.equal(f.calls.length, 1);
  wait.resolve();
  assert.equal((await first).accepted, true);
  assert.equal((await f.adapter.ingest(f.event())).reason, 'duplicate');
});

test('permits distinct events in one revision and rejects lower revisions', async () => {
  const f = fixture();
  assert.equal((await f.adapter.ingest(f.event({ revision: 4 }))).accepted, true);
  assert.equal((await f.adapter.ingest(f.event({ eventId: 'event-2', revision: 4 }))).accepted, true);
  assert.equal((await f.adapter.ingest(f.event({ eventId: 'event-3', revision: 3 }))).reason, 'stale-revision');
  assert.equal(f.calls.length, 2);
});

test('simultaneously admitted immediate casts retain their accepted outcomes', async () => {
  const f = fixture();
  const results = await Promise.all([
    f.adapter.ingest(f.event({ eventId: 'one', revision: 1 })),
    f.adapter.ingest(f.event({ eventId: 'two', revision: 2 })),
  ]);
  // The player's last-moment canStart check may supersede revision one.
  assert.equal(results[1].accepted, true);
  assert.ok(results[0].accepted || results[0].reason === 'stale-revision');
  assert.equal(f.adapter.stats().revision, 2);
});

test('context change aborts an authored release hook without starting the old cast', async () => {
  const wait = defer(); let signal;
  const f = fixture({ async onCast(event, meta) { signal = meta.signal; await wait.promise; } });
  const old = f.adapter.ingest(f.event());
  assert.equal(f.adapter.setContext({ ...BASE, characterId: 'hero-2' }), true);
  assert.equal(signal.aborted, true);
  assert.equal(f.clears, 1);
  wait.resolve();
  assert.equal((await old).reason, 'context-changed');
  assert.equal(f.calls.length, 0);
});

test('late asset completion cannot render after switching characters', async () => {
  const wait = defer(), f = fixture({}, () => wait.promise);
  const old = f.adapter.ingest(f.event());
  f.adapter.setContext({ ...BASE, characterId: 'hero-2' });
  assert.equal(f.calls[0].canStart(), false);
  wait.resolve();
  assert.equal((await old).reason, 'context-changed');
  assert.equal(f.adapter.stats().accepted, 0);
});

test('reapplying the same context preserves replay protection and animations', async () => {
  const f = fixture();
  await f.adapter.ingest(f.event());
  assert.equal(f.adapter.setContext({ ...BASE }), false);
  assert.equal(f.clears, 0);
  assert.equal((await f.adapter.ingest(f.event())).reason, 'duplicate');
});

test('context changes reset dispatch revision and seen IDs', async () => {
  const f = fixture();
  await f.adapter.ingest(f.event({ revision: 900 }));
  const next = { ...BASE, dispatchId: 'run-2' };
  f.adapter.setContext(next);
  assert.equal((await f.adapter.ingest(f.event({ context: next, revision: 1 }))).accepted, true);
});

test('event expiry during a release hook prevents playback', async () => {
  const wait = defer(), f = fixture({ maxAgeMs: 100, onCast: () => wait.promise });
  const result = f.adapter.ingest(f.event());
  f.setNow(10101); wait.resolve();
  assert.equal((await result).reason, 'expired');
  assert.equal(f.calls.length, 0);
});

test('canStart rejects an event that ages out while textures load', async () => {
  const wait = defer(), f = fixture({ maxAgeMs: 100 }, () => wait.promise);
  const result = f.adapter.ingest(f.event());
  f.setNow(10101);
  assert.equal(f.calls[0].canStart(), false);
  wait.resolve();
  assert.equal((await result).reason, 'expired');
});

test('a newer pending revision prevents stale cast admission', async () => {
  const wait = defer(), f = fixture({}, () => wait.promise);
  const current = f.adapter.ingest(f.event({ revision: 5 }));
  assert.equal((await f.adapter.ingest(f.event({ eventId: 'old', revision: 4 }))).reason, 'stale-revision');
  wait.resolve();
  assert.equal((await current).accepted, true);
});

test('onCast may supply authored geometry but cannot change the skill ID', async () => {
  const f = fixture({ onCast(event) {
    event.from.x = 999;
    return { from: { x: 42, y: 50 }, direction: 'up', skillId: 'shield' };
  } });
  assert.equal((await f.adapter.ingest(f.event())).accepted, true);
  assert.deepEqual(f.calls[0].from, { x: 42, y: 50 });
  assert.equal(f.calls[0].direction, 'up');
  assert.equal(f.calls[0].skillId, 'fireball');
});

test('invalid hook geometry and hook failures do not reach the player', async () => {
  const bad = fixture({ onCast: () => ({ from: { x: Infinity, y: 0 } }) });
  assert.equal((await bad.adapter.ingest(bad.event())).reason, 'invalid-cast-geometry');
  assert.equal(bad.calls.length, 0);
  const failed = fixture({ onCast() { throw Error('character missing'); } });
  assert.equal((await failed.adapter.ingest(failed.event())).reason, 'render-failed');
  assert.equal(failed.calls.length, 0);
});

test('a rejected player result does not advance the accepted revision or consume an ID', async () => {
  const f = fixture();
  const original = f.player.play;
  f.player.play = async () => ({ accepted: false, reason: 'asset-unavailable' });
  assert.equal((await f.adapter.ingest(f.event({ revision: 50 }))).reason, 'asset-unavailable');
  assert.equal(f.adapter.stats().revision, -1);
  f.player.play = original;
  assert.equal((await f.adapter.ingest(f.event({ revision: 1 }))).accepted, true);
});

test('bounded replay memory rejects overload instead of evicting recent IDs', async () => {
  const f = fixture({ maxEvents: 2, maxAgeMs: 100 });
  await f.adapter.ingest(f.event({ eventId: 'one' }));
  await f.adapter.ingest(f.event({ eventId: 'two' }));
  assert.equal((await f.adapter.ingest(f.event({ eventId: 'three' }))).reason, 'replay-window-full');
  assert.equal((await f.adapter.ingest(f.event({ eventId: 'one' }))).reason, 'duplicate');
  f.setNow(10101);
  assert.equal((await f.adapter.ingest(f.event({ eventId: 'three' }))).accepted, true);
  assert.equal(f.adapter.stats().remembered, 1);
});

test('clear cancels playback while retaining accepted event replay protection', async () => {
  const f = fixture();
  await f.adapter.ingest(f.event());
  f.adapter.clear();
  assert.equal(f.clears, 1);
  assert.equal((await f.adapter.ingest(f.event())).reason, 'duplicate');
});

test('destroy is idempotent and rejects all further events', async () => {
  const f = fixture();
  f.adapter.destroy(); f.adapter.destroy();
  assert.equal(f.clears, 1);
  assert.equal((await f.adapter.ingest(f.event())).reason, 'destroyed');
  assert.equal(f.adapter.setContext(BASE), false);
});

test('without an active dispatch context, no event can play', async () => {
  const f = fixture({ context: null });
  assert.equal((await f.adapter.ingest(f.event())).reason, 'no-context');
  assert.equal(f.adapter.setContext(BASE), true);
  assert.equal((await f.adapter.ingest(f.event())).accepted, true);
});

test('preview server is read-only and rejects traversal and out-of-root links', async () => {
  const { createSkillVfxPreviewServer } = await import('../tools/skill-vfx-preview-server.mjs');
  const fs = await import('node:fs/promises'), path = await import('node:path');
  const { fileURLToPath } = await import('node:url'), { request } = await import('node:http');
  const base = fileURLToPath(new URL('../../.release-sync/', import.meta.url));
  await fs.mkdir(base, { recursive: true });
  const fixtureRoot = await fs.mkdtemp(path.join(base, 'vfx-server-test-'));
  const publicRoot = path.join(fixtureRoot, 'public'), outside = path.join(fixtureRoot, 'outside');
  let server;
  try {
    await fs.mkdir(publicRoot); await fs.mkdir(outside);
    await fs.writeFile(path.join(publicRoot, 'preview-skill-vfx.html'), '<!doctype html><title>VFX fixture</title>');
    await fs.writeFile(path.join(outside, 'fixture.js'), 'outside public root');
    await fs.symlink(outside, path.join(publicRoot, 'escaped'), 'junction');
    server = await createSkillVfxPreviewServer({ publicRoot });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const call = (target, method = 'GET') => new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: target, method }, res => {
        let body = '';
        res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject); req.end();
    });
    const page = await call('/');
    assert.equal(page.status, 200);
    assert.match(page.body, /VFX fixture/);
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.equal((await call('/preview-skill-vfx.html', 'HEAD')).body, '');
    assert.equal((await call('/preview-skill-vfx.html', 'POST')).status, 405);
    assert.equal((await call('/%2e%2e/outside/fixture.js')).status, 400);
    assert.equal((await call('/..%5coutside/fixture.js')).status, 400);
    assert.equal((await call('/escaped/fixture.js')).status, 403);
    assert.equal((await call('/api/state')).status, 404);
    const health = JSON.parse((await call('/__vfx/health')).body);
    assert.equal(health.productionAccess, false);
    assert.equal(health.readOnly, true);
    assert.equal(health.api, false);
  } finally {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    // This directory was created exclusively by this test; links are removed,
    // never followed to a user's project or production asset.
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});


test('an authored release presentation starts at its phase without counting the actor windup twice', async () => {
  let f;
  f = fixture({ onCast(event) {
    assert.equal(event.atMs, 10000);
    f.setNow(10750);
    return { presentation: { startProgress: .22, elapsedMs: 12, mode: 'full' } };
  } });
  assert.equal((await f.adapter.ingest(f.event())).accepted, true);
  assert.equal(f.calls[0].ageMs, 12);
  assert.equal(f.calls[0].startProgress, .22);
  assert.equal(f.calls[0].presentationMode, 'full');
});

test('presentation timing cannot revive an expired real event', async () => {
  let f;
  f = fixture({ maxAgeMs: 100, onCast() {
    f.setNow(10101);
    return { presentation: { startProgress: .22, elapsedMs: 0, mode: 'placement' } };
  } });
  assert.equal((await f.adapter.ingest(f.event())).reason, 'expired');
  assert.equal(f.calls.length, 0);
});

test('placement presentation is separate from caller-supplied event timing', async () => {
  const f = fixture({ onCast() { return { presentation: { startProgress: .22, elapsedMs: 0, mode: 'placement' } }; } });
  assert.equal((await f.adapter.ingest(f.event({ atMs: 9000, presentation: { startProgress: .95 } }))).accepted, true);
  assert.equal(f.calls[0].ageMs, 0);
  assert.equal(f.calls[0].startProgress, .22);
  assert.equal(f.calls[0].presentationMode, 'placement');
});

test('raw presentation fields are ignored without a trusted presentation hook', async () => {
  const f = fixture();
  assert.equal((await f.adapter.ingest(f.event({ atMs: 9900, presentation: { startProgress: .9, elapsedMs: 0 } }))).accepted, true);
  assert.equal(f.calls[0].ageMs, 100);
  assert.equal(f.calls[0].startProgress, undefined);
});

test('rejects invalid presentation hook clocks and modes', async () => {
  for (const presentation of [
    { startProgress: -1 }, { startProgress: 1.1 }, { startProgress: NaN },
    { elapsedMs: -1 }, { elapsedMs: Infinity }, { elapsedMs: 60001 }, { mode: 'damage' }, null,
  ]) {
    const f = fixture({ onCast() { return { presentation }; } });
    assert.equal((await f.adapter.ingest(f.event())).reason, 'invalid-presentation');
    assert.equal(f.calls.length, 0);
  }
});

test('committed effects use their own hook and do not replay the actor attack', async () => {
  let casts = 0, effects = 0;
  const f = fixture({
    onCast() { casts++; },
    onEffect(event) {
      effects++; assert.equal(event.type, 'skill_effect'); assert.equal(event.effectKind, 'pet');
      return { presentation: { startProgress: 0, elapsedMs: 7, mode: 'impact' } };
    },
  });
  assert.equal((await f.adapter.ingest(f.event({ type: 'skill_effect', effectKind: 'pet', atMs: 9000 }))).accepted, true);
  assert.equal(casts, 0); assert.equal(effects, 1);
  assert.equal(f.calls[0].ageMs, 7);
  assert.equal(f.calls[0].presentationMode, 'impact');
});

test('one-second committed effects default to a fresh impact clock and retain replay checks', async () => {
  const f = fixture();
  for (const effectKind of ['dot', 'pet', 'trap', 'counter']) {
    const event = f.event({ eventId: effectKind, type: 'skill_effect', effectKind, atMs: 9000 });
    assert.equal((await f.adapter.ingest(event)).accepted, true);
    assert.equal(f.calls.at(-1).ageMs, 0);
    assert.equal(f.calls.at(-1).presentationMode, 'impact');
    assert.equal((await f.adapter.ingest(event)).reason, 'duplicate');
  }
  assert.equal((await f.adapter.ingest(f.event({ type: 'skill_effect', effectKind: 'basic' }))).reason, 'invalid-event');
});

test('context switching cancels an awaited effect hook as well as cast hooks', async () => {
  const held = defer();
  let signal;
  const f = fixture({ onEffect(_event, state) { signal = state.signal; return held.promise; } });
  const pending = f.adapter.ingest(f.event({ type: 'skill_effect', effectKind: 'dot' }));
  await Promise.resolve();
  f.adapter.setContext({ ...BASE, dispatchId: 'run-2' });
  assert.equal(signal.aborted, true);
  held.resolve({ presentation: { startProgress: 0, elapsedMs: 0, mode: 'impact' } });
  assert.equal((await pending).reason, 'context-changed');
  assert.equal(f.calls.length, 0);
});

test('an effect hook cannot request a new full cast presentation', async () => {
  const f = fixture({ onEffect() { return { presentation: { mode: 'full' } }; } });
  assert.equal((await f.adapter.ingest(f.event({ type: 'skill_effect', effectKind: 'trap' }))).reason, 'invalid-presentation');
});
