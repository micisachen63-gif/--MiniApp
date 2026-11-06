import test from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_BUILDS } from '../src/game/atlas-catalog.js';
import { createAtlasRun, advanceAtlasRun } from '../src/game/atlas-engine.js';
import { ATLAS_EFFECTS_RULES_VERSION } from '../src/game/atlas-effects.js';
import { fixture, NOW, changes, snapshot } from './star-ring-scene-fixture.js';
import * as Ring from '../src/services/star-ring.js';
import * as Scene from '../src/services/star-ring-scene.js';
import * as Engine from '../src/game/star-ring.js';

const START = 1800000000;
const withoutTrace = ({ combatTrace, ...result }) => result;

test('merged Atlas observation reports actual paid or free mana without changing native effects, RNG or rewards', () => {
  let paid = 0, free = 0;
  for (const freeCastPct of [0, .35, 1]) for (const build of ATLAS_BUILDS) {
    const run = createAtlasRun({
      runId: 'integrated-vfx-' + build.id, realmId: 'permanent', seed: 'integrated-vfx-' + freeCastPct,
      startAt: START, durationSeconds: 120, queueMode: 'duration', buildId: build.id,
      mapId: 'grove_intro', supports: build.recommendedSupports, automation: 'burst',
      supplies: { hp: 20, mp: 20 }, effectsRulesVersion: ATLAS_EFFECTS_RULES_VERSION,
      snapshot: {
        characterId: 'actor-' + build.baseClass, baseClass: build.baseClass, level: 30,
        atk: 50, def: 30, maxHp: 10000, hp: 10000, maxMp: 3000, mp: 3000,
        attackSpeedMultiplier: 1.6, mpRegenPerSecond: 0, element: 'fire', weaponElem: 20,
        pct: { critPct: .25, elemPct: .2, freeCastPct },
      },
    });
    const original = structuredClone(run), until = START + 60;
    const plain = advanceAtlasRun(run, until);
    const observed = advanceAtlasRun(run, until, { combatTrace: { limit: 256 } });
    assert.deepEqual(withoutTrace(observed), plain, build.id + ' full state/rewards/activities/RNG');
    assert.deepEqual(run, original, 'caller snapshot is immutable');
    assert.equal(observed.combatTrace.dropped, 0);
    const casts = observed.combatTrace.events.filter(event => event.type === 'skill_cast');
    assert.ok(casts.length > 0, build.id);
    assert.equal(casts.length, observed.state.metrics.casts);
    assert.ok(Math.abs(casts.reduce((sum, cast) => sum + cast.mpSpent, 0) - observed.state.metrics.manaSpent) < 1e-6);
    assert.equal(casts.filter(cast => cast.mpSpent === 0).length, observed.state.metrics.freeCasts);
    for (const cast of casts) {
      assert.ok(cast.mpSpent === 0 || cast.mpSpent === run.skill.cost);
      assert.ok(Math.abs(cast.mpBefore - cast.mpAfter - cast.mpSpent) < 1e-6);
      if (freeCastPct === 1) assert.equal(cast.mpSpent, 0);
      if (freeCastPct === 0) assert.equal(cast.mpSpent, run.skill.cost);
      if (cast.mpSpent) paid++; else free++;
    }
    for (const event of observed.combatTrace.events) for (const hit of event.hits) {
      assert.equal(hit.hpBefore - hit.hpAfter, hit.damage);
    }
  }
  assert.ok(paid > 0 && free > 0, 'exercise actual paid and zero-cost resolutions');
});

function visuals(value, found = []) {
  if (Array.isArray(value)) { for (const row of value) visuals(row, found); return found; }
  if (!value || typeof value !== 'object') return found;
  if (value.skillId && value.source && value.eventId) found.push(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') visuals(child, found);
  return found;
}

for (const version of [1, 2, 3]) test('Star Ring v' + version + ' uncached pure scene never labels forecast VFX as a committed event', async t => {
  const f = await fixture(t, { version, start: true });
  const at = NOW + Engine.BEAT_MS * 4;
  const before = snapshot(f.db), changed = changes(f.db);
  const direct = await Ring.readView(f.env, f.id, f.ids[0], at);
  const scene = await Scene.view(f.env, f.ids[0], {}, at);
  const directEvents = visuals(direct.battle), sceneEvents = visuals(scene.active.battle);
  assert.ok(directEvents.length > 0, 'actual projected battle includes skill VFX');
  assert.ok(sceneEvents.length > 0, 'pure main-window projection retains the same evidence');
  for (const event of [...directEvents, ...sceneEvents]) assert.equal(event.source, 'deterministic-projection');
  assert.equal(changes(f.db), changed);
  assert.deepEqual(snapshot(f.db), before);
  await Ring.sweep(f.env, NOW + Engine.STAGE_MS);
  const stored = JSON.parse(f.sql.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(f.id).state_json);
  const committed = visuals(stored.results[0]);
  assert.ok(committed.length > 0, 'settled result has genuine events');
  assert.ok(committed.every(event => event.source === 'committed-combat'));
});
