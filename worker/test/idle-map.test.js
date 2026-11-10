import test from 'node:test';
import assert from 'node:assert/strict';
import { settleIdle } from '../src/game/idle.js';
import {
  hasReachedIdleMap, idleExpFactor, idleMapMode, idleMapRewardLevel, goldPerKillOnMap,
  resolveIdleMap, resolveIdleMapForChar, readIdleMapPref, writeIdleMapPref, idleMapCatalog, idleMapView,
} from '../src/game/idle-map.js';
import { modeForLevel } from '../src/game/endgame.js';
import { mapForLevel } from '../src/game/formulas.js';
import { DROPS, RELIC } from '../src/game/constants.js';
import { mkChar, starterGear, T0 } from './helpers.js';
import { freshDb } from './d1-shim.js';
import * as Player from '../src/services/player.js';
import { setIdleMap } from '../src/services/idle-map.js';
import { loadPlayer } from '../src/db.js';

const H = 3_600_000;
const potions = { red_1: 99999, blue_1: 99999 };

test('exp gap is 0 full, 1 half, >=2 zero, and only within the current round', () => {
  assert.equal(idleExpFactor(80, 8), 1);
  assert.equal(idleExpFactor(80, 7), 0.5);
  assert.equal(idleExpFactor(80, 6), 0);
  assert.equal(idleExpFactor(80, 1), 0);
  assert.equal(idleExpFactor(125, 1), 1);
  assert.equal(idleExpFactor(125, 2), 0);
  assert.equal(idleExpFactor(125, 8), 0, 'previous-round maps have no exp even if they were the current map last round');
  assert.equal(idleExpFactor(200, 8), 1);
  assert.equal(idleExpFactor(200, 7), 0.5);
  assert.equal(idleExpFactor(200, 6), 0);
  assert.equal(idleExpFactor(200, 9), 0, 'unreached this round has no exp');
});

test('mode and gold use the most recent round in which a map was reached', () => {
  assert.equal(idleMapMode(80, 8).id, 'normal');
  assert.equal(idleMapMode(125, 1).id, 'elite');
  assert.equal(idleMapMode(125, 8).id, 'normal');
  assert.equal(idleMapMode(125, 8).name, '普通');
  assert.equal(idleMapMode(200, 8).id, 'elite');
  assert.equal(idleMapMode(200, 9).id, 'normal');
  assert.equal(hasReachedIdleMap(125, 12), true);
  assert.equal(hasReachedIdleMap(50, 8), false);
  assert.equal(hasReachedIdleMap(80, 8), true);
  assert.equal(idleMapRewardLevel(modeForLevel(125), 1), 130);
  assert.equal(idleMapRewardLevel(idleMapMode(125, 8), 8), 80);
  const follow = resolveIdleMap(125, { follow: true });
  assert.equal(follow.mapId, 1); assert.equal(follow.mode, 'elite'); assert.equal(follow.rewardLevel, 130); assert.equal(follow.expFactor, 1);
  const old = resolveIdleMap(125, { follow: false, mapId: 8 });
  assert.equal(old.mode, 'normal'); assert.equal(old.rewardLevel, 80); assert.equal(old.expFactor, 0);
  assert.equal(old.goldPerKill, goldPerKillOnMap(80, 8));
  assert.equal(follow.goldPerKill, goldPerKillOnMap(130, 1));
  assert.equal(follow.cycleId, 'cycle_elite_01');
  assert.equal(old.cycleId, 'cycle_normal_08');
  assert.equal(old.place, resolveIdleMap(80, { follow: false, mapId: 8 }).place);
});

test('catalog lists every ever-reached map and greys out locked ones', () => {
  const low = idleMapCatalog(25);
  assert.equal(low.filter(r => r.reached).map(r => r.mapId).join(','), '1,2,3');
  assert.equal(low[7].locked, true);
  const mid = idleMapCatalog(125);
  assert.equal(mid.length, 12);
  assert.ok(mid.every(r => r.reached && !r.locked));
  assert.equal(mid[0].mode, 'elite');
  assert.equal(mid[7].mode, 'normal');
  const high = idleMapCatalog(200);
  assert.equal(high[7].mode, 'elite');
  assert.equal(high[8].mode, 'normal');
  assert.equal(high[8].expFactor, 0);
});

test('pinned map survives a level-up into a later map and a new round', () => {
  const char = mkChar({ level: 80, special_json: JSON.stringify({ idleMap: { v: 1, follow: false, mapId: 7 } }) });
  const at80 = resolveIdleMapForChar(char);
  assert.equal(at80.follow, false); assert.equal(at80.mapId, 7); assert.equal(at80.expFactor, 0.5); assert.equal(at80.mode, 'normal');
  char.level = 95;
  const at95 = resolveIdleMapForChar(char);
  assert.equal(at95.follow, false); assert.equal(at95.mapId, 7); assert.equal(at95.expFactor, 0); assert.equal(readIdleMapPref(char).mapId, 7);
  char.level = 125;
  const at125 = resolveIdleMapForChar(char);
  assert.equal(at125.follow, false); assert.equal(at125.mapId, 7); assert.equal(at125.mode, 'normal'); assert.equal(at125.expFactor, 0);
  assert.equal(JSON.parse(char.special_json).idleMap.mapId, 7);
});

test('an invalid pin falls back to follow-level and rewrites the preference', () => {
  const char = mkChar({ level: 50, special_json: JSON.stringify({ idleMap: { v: 1, follow: false, mapId: 8 } }) });
  const resolved = resolveIdleMapForChar(char);
  assert.equal(resolved.follow, true); assert.equal(resolved.mapId, mapForLevel(50)); assert.equal(resolved.reset, true);
  assert.deepEqual(readIdleMapPref(char), { follow: true, mapId: null });
  const bad = mkChar({ level: 30, special_json: JSON.stringify({ idleMap: { v: 1, follow: false, mapId: 99 } }) });
  assert.equal(resolveIdleMapForChar(bad).follow, true);
});

test('settle applies exp and gold of the selected map', () => {
  function run(level, pref, hours = 2) {
    const char = mkChar({ level, gold: 0, auto_red_pct: 80 });
    writeIdleMapPref(char, pref);
    return settleIdle(char, { ...potions }, starterGear(char, 8), T0 + hours * H);
  }
  const current = run(80, { follow: true });
  const same = run(80, { follow: false, mapId: 8 });
  const one = run(80, { follow: false, mapId: 7 });
  const two = run(80, { follow: false, mapId: 6 });
  assert.ok(current.report.exp_gained > 0);
  assert.equal(current.char.map_id, 8);
  assert.equal(same.char.map_id, 8);
  assert.equal(one.char.map_id, 7);
  assert.equal(two.report.exp_gained, 0);
  const ratio = one.report.exp_gained / current.report.exp_gained;
  assert.ok(ratio > 0.35 && ratio < 0.7, `gap-1 ratio ${ratio}`);
  assert.equal(same.report.exp_gained, current.report.exp_gained);
  assert.ok(two.report.gold_gained > 0, 'previous maps still drop gold');
  const elite = run(125, { follow: true }, 1);
  const old = run(125, { follow: false, mapId: 8 }, 1);
  assert.equal(elite.char.map_id, 1);
  assert.equal(old.char.map_id, 8);
  assert.equal(old.report.exp_gained, 0);
  assert.ok(elite.report.exp_gained > 0);
  assert.ok(elite.report.gold_gained > 0);
  assert.ok(old.report.gold_gained > 0);
});

test('atlas and party pause idle settle without clearing a pinned map', () => {
  const pin = { v: 1, follow: false, mapId: 3 };
  const party = mkChar({ level: 40, party_id: 'party-1', special_json: JSON.stringify({ idleMap: pin }), last_settle_at: T0 });
  const paused = settleIdle(party, potions, starterGear(party), T0 + 3 * H);
  assert.equal(paused.report.ticks, 0);
  assert.equal(paused.report.exp_gained, 0);
  assert.equal(paused.report.gold_gained, 0);
  assert.deepEqual(JSON.parse(paused.char.special_json).idleMap, pin);
  assert.equal(paused.char.last_settle_at, T0 + 3 * H);
});

test('switching maps does not reset relic or scroll daily caps', () => {
  const drops = { relic: RELIC.eliteDailyCap, scroll_w: 99, scroll_a: 99, scroll_r: 99 };
  for (const key of Object.keys(DROPS)) drops[key] = 99;
  const char = mkChar({
    level: 80, drop_day: '2026-10-08', drops_today: JSON.stringify(drops),
    special_json: JSON.stringify({ idleMap: { v: 1, follow: false, mapId: 8 } }),
  });
  writeIdleMapPref(char, { follow: false, mapId: 3 });
  const settled = settleIdle(char, potions, starterGear(char, 8), T0 + H);
  assert.equal(settled.char.drop_day, '2026-10-08');
  const today = JSON.parse(settled.char.drops_today);
  assert.equal(today.relic, RELIC.eliteDailyCap);
  assert.equal(today.scroll_w, 99);
  assert.equal(today.scroll_a, 99);
  assert.equal(today.scroll_r, 99);
  assert.equal(JSON.parse(settled.char.special_json).idleMap.mapId, 3);
});

test('setIdleMap persists a pin and follow-level through withPlayer', async t => {
  const env = { DB: freshDb() }; t.after(() => env.DB.sqlite.close());
  const created = await Player.createCharacter(env, { tgId: '98621', name: '掛機地圖', baseClass: 'sword', gender: 'f' }, T0);
  const id = created.char.tg_id;
  env.DB.sqlite.prepare('UPDATE rpg_characters SET level=120,progression_level=125,gold=1000,last_settle_at=? WHERE tg_id=?').run(T0, id);
  const pinned = await Player.withPlayer(env, id, T0, (work, ctx) => setIdleMap(work, ctx, { follow: false, mapId: 8 }));
  assert.equal(pinned.result.mapId, 8);
  assert.equal(pinned.result.mode, 'normal');
  assert.equal(pinned.result.follow, false);
  assert.equal(pinned.player.char.map_id, 8);
  const loaded = await loadPlayer(env.DB, id);
  assert.deepEqual(JSON.parse(loaded.char.special_json).idleMap, { v: 1, follow: false, mapId: 8 });
  const followed = await Player.withPlayer(env, id, T0, (work, ctx) => setIdleMap(work, ctx, { follow: true }));
  assert.equal(followed.result.follow, true);
  assert.equal(followed.result.mapId, 1);
  assert.equal(followed.result.mode, 'elite');
  await assert.rejects(Player.withPlayer(env, id, T0, (work, ctx) => setIdleMap(work, ctx, { follow: false, mapId: 99 })), /尚未到達/);
  const lowId = (await Player.createCharacter(env, { tgId: '98622', name: '新手地圖', baseClass: 'mage', gender: 'm' }, T0)).char.tg_id;
  env.DB.sqlite.prepare('UPDATE rpg_characters SET level=40,last_settle_at=? WHERE tg_id=?').run(T0, lowId);
  await assert.rejects(Player.withPlayer(env, lowId, T0, (work, ctx) => setIdleMap(work, ctx, { follow: false, mapId: 8 })), /尚未到達/);
});
