import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { committedIdleRound } from '../src/game/idle-scene.js';
import { idleCombatState, resolveIdleCombat } from '../src/game/idle-combat.js';
import { createIdleCastController } from '../public/scene-idle-cast.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../public/skill-vfx-catalog.json', import.meta.url)));
const raw = () => ({ schemaVersion: 1, source: 'committed-combat', eventId: 'idle-round:A:60000:cast',
  skillId: 'native:archer:base', kind: 'cast', actorId: 'A', atMs: 60000,
  targetKind: 'enemy', targetIds: ['idle:A:1:0:0'], presentationMode: 'full' });
const round = () => ({ id: 'idle-round:A:60000', at: 60000, mapId: 1,
  before: [{ id: 'idle:A:1:0:0', name: '甲' }, { id: 'idle:A:1:0:1', name: '乙' }], vfxEvents: [raw()] });
const char = () => ({ tg_id: 'A', last_settle_at: 60000,
  idle_combat_json: JSON.stringify({ v: 1, mapId: 1, round: round() }) });
const drain = () => new Promise(resolve => setImmediate(resolve));

test('idle scene exposes only persisted own committed descriptors and never mutates storage', () => {
  const c = char(), before = JSON.stringify(c);
  const projected = committedIdleRound(c);
  assert.equal(committedIdleRound(c, 2), null, 'a map switch cannot replay the previous map');
  assert.deepEqual(projected, round()); assert.equal(JSON.stringify(c), before);
  projected.vfxEvents[0].targetIds[0] = 'changed';
  assert.equal(committedIdleRound(c).vfxEvents[0].targetIds[0], raw().targetIds[0]);
  for (const edit of [c => c.party_id = 'away', c => c.atlas_run_id = 'run', c => c.tg_id = 'B',
    c => c.last_settle_at = 59999, c => c.idle_combat_json = '{bad']) {
    const value = char(); edit(value); assert.equal(committedIdleRound(value), null);
  }
  for (const edit of [s => s.round.vfxEvents = undefined, s => s.round.before.pop(),
    s => s.round.vfxEvents[0].source = 'deterministic-projection',
    s => s.round.vfxEvents[0].actorId = 'B', s => s.round.vfxEvents[0].targetIds = ['foreign']]) {
    const c = char(), state = JSON.parse(c.idle_combat_json); edit(state); c.idle_combat_json = JSON.stringify(state);
    assert.equal(committedIdleRound(c), null);
  }
});
test('high-kill minute summaries retain one explicit cast without changing any combat outcome', () => {
  const c = { ...char(), level: 29, base_class: 'archer', idle_state: 'fighting' };
  const first = idleCombatState(c), second = structuredClone(first);
  const cast = raw(); cast.targetIds = [first.enemies[0].id];
  const options = { at: 60000, killsBudget: 100, cast: true, record: true };
  const withCast = resolveIdleCombat(first, c, { ...options, vfx: cast });
  const withoutCast = resolveIdleCombat(second, c, options);
  assert.equal(withCast.summarized, true); assert.deepEqual(withCast.events, []);
  assert.deepEqual(first.enemies, second.enemies); assert.equal(first.serial, second.serial);
  assert.equal(first.remainder, second.remainder); assert.equal(first.target, second.target);
  assert.equal(withCast.kills, withoutCast.kills); assert.deepEqual(withCast.defeated, withoutCast.defeated);
  c.idle_combat_json = JSON.stringify(first);
  assert.deepEqual(committedIdleRound(c)?.vfxEvents, [cast]);
});

function harness(extra = {}) {
  const calls = [], listeners = new Map(); let scope = 'own-map', hidden = false;
  const animator = { ready: true, actor: { id: 'archer' }, generation: 1, elapsed: 0, action: 'idle', activeDirection: 'down',
    face(dx, dy) { return Math.abs(dx) >= Math.abs(dy) ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'up' : 'down'; },
    play(action, direction) { this.action = action; this.activeDirection = direction; this.elapsed = 0; return true; } };
  const player = { prepare: async () => {}, getRecipe: () => ({ phases: [{ id: 'release', from: .24 }] }),
    play(command) { calls.push(command); return Promise.resolve(true); } };
  const geometry = () => ({ actorId: 'A', from: { x: 100, y: 150 }, foot: { x: 100, y: 200 }, bodyHeight: 100,
    targetWorld: { x: 100, y: 250 }, targets: [{ id: raw().targetIds[0], point: { x: 100, y: 250 } },
      { id: 'A', point: { x: 100, y: 150 }, bodyHeight: 100 }] });
  const controller = createIdleCastController({ animator, hero: { x: 100, y: 200 }, hidden: () => hidden,
    document: { addEventListener: (n, f) => listeners.set(n, f), removeEventListener: n => listeners.delete(n) },
    getScope: () => scope, load: async () => ({ player, catalog }), geometry,
    releaseResolver: { resolve: async () => ({ delayMs: 100, duration: 400, origin: { x: .2, y: -.6 } }), clear() {} },
    project: p => p, bodyHeight: () => 100, ...extra });
  return { controller, animator, calls, listeners, setScope: s => scope = s,
    hide() { hidden = true; listeners.get('visibilitychange')(); } };
}
test('committed cast uses correct facing, waits for source release and is played once', async t => {
  const h = harness(); t.after(() => h.controller.destroy());
  const receipt = round(), original = JSON.stringify(receipt);
  h.controller.enqueue(receipt, 'own-map', 61000); h.controller.update(); await drain();
  assert.equal(h.animator.activeDirection, 'down'); assert.equal(h.animator.action, 'attack');
  h.animator.elapsed = 99; h.controller.update(); assert.equal(h.calls.length, 0);
  h.animator.elapsed = 100; h.controller.update(); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].from, { x: 120, y: 140 }); assert.equal(h.calls[0].presentationMode, 'full');
  assert.equal(h.calls[0].canStart(), true);
  h.animator.elapsed = 401; h.controller.update(); assert.equal(h.animator.action, 'idle');
  h.controller.enqueue(receipt, 'own-map', 62000); h.controller.update(); await drain();
  assert.equal(h.calls.length, 1); assert.equal(JSON.stringify(receipt), original);
});
test('missing weapon origin reuses verified native target choreography without a fake projectile', async t => {
  const h = harness({ releaseResolver: { resolve: async () => { throw Object.assign(Error(), { code: 'missing-release-origin' }); }, clear() {} },
    nativeResolver: { resolve: async () => ({ delayMs: 100, duration: 400, presentation: 'native-target' }), destroy() {} } });
  t.after(() => h.controller.destroy()); h.controller.enqueue(round(), 'own-map', 61000);
  h.controller.update(); await drain(); h.animator.elapsed = 100; h.controller.update();
  assert.equal(h.calls.length, 1); assert.deepEqual(h.calls[0].from, { x: 100, y: 250 });
  assert.equal(h.calls[0].presentationMode, 'impact');
});
test('all three configured archer specials use their exact catalog IDs and recipes', async t => {
  const h = harness(); t.after(() => h.controller.destroy());
  for (const [index, skill] of ['skill_03_1', 'skill_12_1', 'skill_20_1'].entries()) {
    const receipt = round(); receipt.vfxEvents[0].skillId = 'special:' + skill;
    receipt.vfxEvents[0].eventId += ':' + index;
    h.controller.enqueue(receipt, 'own-map', 61000); h.controller.update();
    // Re-reading the same snapshot while asset verification is in flight cannot queue it twice.
    h.controller.enqueue(receipt, 'own-map', 61000); await drain();
    h.animator.elapsed = 100; h.controller.update();
    assert.equal(h.calls.at(-1)?.skillId, 'special:' + skill);
    h.animator.elapsed = 401; h.controller.update();
  }
  assert.equal(h.calls.length, 3); assert.equal(h.controller.stats().accepted, 3);
});
test('an offensive cast preserves a separate support effect on the actual recipient', async t => {
  const h = harness(); t.after(() => h.controller.destroy());
  const receipt = round(); receipt.vfxEvents[0].recipientEffects = [{ kind: 'heal', targetIds: ['A'] }];
  h.controller.enqueue(receipt, 'own-map', 61000); h.controller.update(); await drain();
  h.animator.elapsed = 100; h.controller.update();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].presentationMode, 'full'); assert.deepEqual(h.calls[0].from, { x: 120, y: 140 });
  assert.equal(h.calls[1].presentationMode, 'support'); assert.equal(h.calls[1].recipientId, 'A');
  assert.deepEqual(h.calls[1].from, { x: 100, y: 150 }); assert.deepEqual(h.calls[1].to, { x: 100, y: 150 });
});
test('hidden/context changes cancel a released command and a cast still preparing', async t => {
  const h = harness(); t.after(() => h.controller.destroy());
  h.controller.enqueue(round(), 'own-map', 61000); h.controller.update(); await drain();
  h.animator.elapsed = 100; h.controller.update(); h.hide();
  assert.equal(h.calls[0].canStart(), false); assert.equal(h.controller.stats().active, false);
  let resolve;
  const pending = new Promise(done => resolve = done), slow = harness({ load: () => pending });
  t.after(() => slow.controller.destroy()); slow.controller.enqueue(round(), 'own-map', 61000); slow.controller.update();
  slow.setScope('another-character'); resolve({ player: {}, catalog }); await drain();
  assert.equal(slow.animator.action, 'idle'); assert.equal(slow.calls.length, 0);
});
test('stale, unknown, foreign and missing target casts cannot generate an animation or VFX', async t => {
  for (const edit of [r => r.at = -100000, r => r.vfxEvents[0].skillId = 'invented',
    r => r.vfxEvents[0].actorId = 'B', r => r.vfxEvents[0].targetIds = ['missing'],
    r => r.vfxEvents[0].source = 'deterministic-projection']) {
    const h = harness(); t.after(() => h.controller.destroy()); const receipt = round(); edit(receipt);
    h.controller.enqueue(receipt, 'own-map', 61000); h.controller.update(); await drain();
    h.animator.elapsed = 500; h.controller.update(); assert.equal(h.calls.length, 0);
  }
});
