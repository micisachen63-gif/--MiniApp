import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import { mulberry32 } from '../src/game/rng.js';
import { loadPlayer } from '../src/db.js';
import * as Player from '../src/services/player.js';
import * as Atlas from '../src/services/atlas.js';
import { atlasAppearanceKey, projectAtlasScene } from '../src/game/atlas-scene.js';
import { expToNext } from '../src/game/formulas.js';
import { MAX_LEVEL } from '../src/game/constants.js';
import { playerView } from '../src/views.js';

async function fixture(t, extra = {}) {
  const env = { DB: freshDb(), ATLAS_ENABLED: 'true', REALM_CONTEXT: { id: 'permanent' }, ...extra };
  t.after(() => env.DB.sqlite.close());
  const player = await Player.createCharacter(env, {
    tgId: '82301', name: '場景投影旅人', baseClass: 'sword', gender: 'm',
  }, T0, mulberry32(7));
  return { env, db: env.DB.sqlite, id: player.char.tg_id };
}
const startBody = () => ({
  requestId: 'scene-start-001', mapId: 'laurel_intro', queueMode: 'duration',
  durationMinutes: 60, supplies: { hp: 20, mp: 20 },
});
const storedRun = (db, id) => db.prepare('SELECT * FROM rpg_atlas_runs WHERE char_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(id);
const totalChanges = db => db.prepare('SELECT total_changes() AS n').get().n;

test('scene actor IDs match existing catalog identities and never substitute an unknown actor', () => {
  assert.equal(atlasAppearanceKey({ baseClass: 'sword', gender: 'f', classPath: '' }), 'sword');
  assert.equal(atlasAppearanceKey({ baseClass: 'archer', gender: 'm', classPath: '' }), 'archer_m');
  assert.equal(atlasAppearanceKey({ baseClass: 'mage', gender: 'm', classPath: 'B22' }), 'adv3_mage_B22_m');
  assert.equal(atlasAppearanceKey({ baseClass: 'thief', gender: 'f', classPath: 'A121' }), 'adv4_thief_A121_f');
  assert.equal(atlasAppearanceKey({ baseClass: 'sword', gender: 'unknown', classPath: '' }), null);
  assert.equal(atlasAppearanceKey({ baseClass: 'unknown', gender: 'f', classPath: '' }), null);
  assert.equal(atlasAppearanceKey({ baseClass: 'mage', gender: 'm', classPath: 'B223' }), null);
});

test('scene status reads do not settle idle time, change assets, or enable a disabled Atlas', async t => {
  const { env, db, id } = await fixture(t, { ATLAS_ENABLED: 'false' });
  const before = db.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get(id);
  const changes = totalChanges(db);
  for (const now of [T0, T0 + 8 * 3600000]) {
    const view = await Atlas.status(env, id, now);
    assert.equal(view.enabled, false);
    assert.equal(view.canStart, false);
    assert.equal(view.scene.schemaVersion, 1);
    assert.equal(view.scene.accountId, '82301');
    assert.equal(view.scene.characterId, id);
    assert.equal(view.scene.character.appearanceKey, 'sword_m');
    assert.equal(view.scene.run, null);
    assert.equal(view.scene.live.activeRunId, null);
    assert.equal(view.scene.live.hp, before.hp);
    assert.equal(view.scene.serverNow, now);
  }
  assert.deepEqual(db.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get(id), before);
  assert.equal(totalChanges(db), changes, 'polling must issue no database writes');
});

test('an active scene uses committed battle HP, enemies and time instead of the live character row or wall clock', async t => {
  const { env, db, id } = await fixture(t);
  await Atlas.start(env, id, startBody(), T0);
  await Atlas.settle(env, id, {}, T0 + 15000);
  const row = storedRun(db, id), state = JSON.parse(row.state_json);
  assert.equal(row.status, 'running');
  assert.ok(state.enemies.length > 0);
  db.prepare('UPDATE rpg_characters SET hp=1,mp=0 WHERE tg_id=?').run(id);
  const changes = totalChanges(db);
  const early = await Atlas.status(env, id, T0 + 15000);
  const later = await Atlas.status(env, id, T0 + 3600000);
  assert.deepEqual(later.scene.run, early.scene.run, 'wall-clock polling cannot simulate uncommitted combat');
  assert.equal(later.scene.run.active, true);
  assert.equal(later.scene.live.activeRunId, row.id);
  assert.equal(later.scene.live.hp, 1);
  assert.equal(later.scene.live.mp, 0);
  assert.equal(later.scene.run.hero.hp, state.hero.hp);
  assert.equal(later.scene.run.hero.mp, state.hero.mp);
  assert.equal(later.scene.run.hero.maxHp, state.snapshot.maxHp);
  assert.equal(later.scene.run.hero.maxMp, state.snapshot.maxMp);
  assert.equal(later.scene.run.processedSeconds, 15);
  assert.equal(later.scene.run.processedAt, state.processedAt * 1000);
  assert.equal(later.scene.run.revision, row.rev);
  assert.equal(later.scene.run.committedAt, row.updated_at);
  assert.deepEqual(later.scene.run.enemies.map(enemy => [enemy.id, enemy.hp, enemy.maxHp]),
    state.enemies.map(enemy => [enemy.id, enemy.hp, enemy.maxHp]));
  assert.equal(later.run.progress.catchingUp, true);
  assert.equal(totalChanges(db), changes);
  assert.equal(storedRun(db, id).state_json, row.state_json);
  const payload = JSON.stringify(later.scene);
  for (const hidden of ['encounterRng', 'combatRng', 'lootRng', 'balanceProfile', 'nextAttackAt']) assert.equal(payload.includes(hidden), false);
});

test('a defeated expedition remains a zero-HP report after the live character returns with at least one HP', async t => {
  const { env, db, id } = await fixture(t, {
    ATLAS_PROFILE_JSON: JSON.stringify({ id: 'scene-fatal-fixture', enemyHpMultiplier: 100, enemyDamageMultiplier: 100 }),
  });
  await Atlas.start(env, id, startBody(), T0);
  const result = await Atlas.settle(env, id, {}, T0 + 60000);
  assert.equal(result.scene.run.status, 'failed');
  assert.equal(result.scene.run.active, false);
  assert.equal(result.scene.live.activeRunId, null);
  assert.equal(result.scene.run.hero.hp, 0);
  assert.ok(result.scene.live.hp >= 1);
  assert.equal(result.scene.run.report.deaths, 1);
  assert.equal(result.scene.run.report.reason, 'hp_depleted');
  assert.ok(result.scene.run.events.some(event => event.type === 'dead'));
  assert.equal(result.scene.run.revision, storedRun(db, id).rev);
});

test('event IDs survive sliding windows and revisions, and cannot masquerade as per-hit damage', async t => {
  const { env, db, id } = await fixture(t);
  await Atlas.start(env, id, startBody(), T0);
  await Atlas.settle(env, id, {}, T0 + 60000);
  const row = storedRun(db, id), player = await loadPlayer(env.DB, id, env);
  const state = JSON.parse(row.state_json);
  state.events = [
    { at: 13, type: 'room_entered', mapIndex: 0, roomIndex: 0, rank: 'normal', enemies: 3 },
    { at: 20, type: 'enemy_defeated', enemyId: '0:0:0', source: 'skill', damage: 999999, arbitrary: 'must-not-pass' },
    { at: 21, type: 'enemy_defeated', enemyId: '0:0:1', source: 'dot' },
  ];
  const first = projectAtlasScene({ player, run: { ...row, state_json: state }, realmId: 'permanent', now: T0 });
  const shifted = { ...state, events: [...state.events.slice(1), { at: 22, type: 'enemy_defeated', enemyId: '0:0:2', source: 'pet' }] };
  const next = projectAtlasScene({ player, run: { ...row, rev: row.rev + 1, state_json: shifted }, realmId: 'permanent', now: T0 + 1000 });
  assert.deepEqual(first.run.events.slice(1).map(event => event.id), next.run.events.slice(0, 2).map(event => event.id));
  assert.equal(new Set(next.run.events.map(event => event.id)).size, 3);
  assert.equal(next.run.events[0].damage, undefined);
  assert.equal(next.run.events[0].arbitrary, undefined);
  assert.equal(next.run.events[0].atMs, (state.startedAt + 20) * 1000);
  assert.deepEqual(next.run.eventHistory, { limit: 24, complete: false });
  assert.equal(state.events[1].damage, 999999, 'projection must not mutate a stored input');
  for (const bad of [{ realm_id: 'season_2026_01' }, { char_id: 'another-character' }]) {
    assert.equal(projectAtlasScene({ player, run: { ...row, ...bad }, realmId: 'permanent', now: T0 }).run, null);
  }
});

test('rolled-back combat never appears in the scene projection', async t => {
  const { env, db, id } = await fixture(t);
  await Atlas.start(env, id, startBody(), T0);
  const before = (await Atlas.status(env, id, T0)).scene.run;
  db.exec("CREATE TRIGGER scene_fail_reward BEFORE INSERT ON rpg_ledger WHEN NEW.type='星圖掉落' BEGIN SELECT RAISE(ABORT,'scene_reward_failure'); END");
  await assert.rejects(Atlas.settle(env, id, {}, T0 + 3600000), /scene_reward_failure/);
  assert.deepEqual((await Atlas.status(env, id, T0 + 3600000)).scene.run, before);
});

test('scene experience uses the same required EXP as me and preserves overflow at an advancement gate', async t => {
  const { env, db, id } = await fixture(t);
  const player = await loadPlayer(env.DB, id, env);
  player.char.level = 30;
  const required = expToNext(player.char.level);
  player.char.exp = Math.floor(required * .375);
  const changes = totalChanges(db);
  const view = projectAtlasScene({ player, realmId: 'permanent', now: T0 });
  const me = playerView(player, { now: T0 }).character;
  assert.equal(view.live.experience.current, player.char.exp);
  assert.equal(view.live.experience.required, me.expNeed);
  assert.equal(view.live.experience.ratio, player.char.exp / required);
  assert.equal(Math.floor(view.live.experience.ratio * 1000) / 10, me.expPct);
  assert.equal(view.live.experience.maxLevel, false);
  player.char.exp = required + 17;
  assert.deepEqual(projectAtlasScene({ player, realmId: 'permanent', now: T0 }).live.experience,
    { current: required + 17, required, ratio: 1, maxLevel: false });
  assert.equal(totalChanges(db), changes);
});

test('scene experience preserves the existing max-level presentation without serializing Infinity', async t => {
  const { env, db, id } = await fixture(t);
  const player = await loadPlayer(env.DB, id, env);
  player.char.level = MAX_LEVEL;
  player.char.exp = 12345;
  const changes = totalChanges(db);
  const scene = projectAtlasScene({ player, realmId: 'permanent', now: T0 });
  const me = playerView(player, { now: T0 }).character;
  assert.deepEqual(scene.live.experience, { current: 12345, required: null, ratio: 1, maxLevel: true });
  assert.equal(me.expNeed, null);
  assert.equal(me.expPct, scene.live.experience.ratio * 100);
  assert.deepEqual(JSON.parse(JSON.stringify(scene)).live.experience, scene.live.experience);
  assert.equal(totalChanges(db), changes);
});

test('equipped guardian projection preserves its original art without leaking combat settings', async t => {
  const {env,id}=await fixture(t),player=await loadPlayer(env.DB,id,env);
  for(const type of ['melee','ranged','magic','loot']){
    player.char.guardian={id:'guardian-'+type,type,typeName:'天使',rank:6,visual:true,damageBonus:.16,privateOwner:'hidden'};
    const scene=projectAtlasScene({player,realmId:'permanent',now:T0});
    assert.deepEqual(scene.character.guardian,{id:'guardian-'+type,type,name:'天使',rank:6,artUrl:'/art/guardian-sigil-20261013/'+type+'.webp'});
    assert.equal('damageBonus' in scene.character.guardian,false);
  }
  for(const guardian of [null,{type:'magic',visual:false},{type:'invalid',visual:true}]){
    player.char.guardian=guardian;
    assert.equal(projectAtlasScene({player,realmId:'permanent',now:T0}).character.guardian,undefined);
  }
});
