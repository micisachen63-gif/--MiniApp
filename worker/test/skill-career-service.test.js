import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import { loadPlayer } from '../src/db.js';
import { mulberry32 } from '../src/game/rng.js';
import { computeStats, nodeFor } from '../src/game/stats.js';
import { researchCost } from '../src/game/skill-mastery.js';
import { MAX_OPEN_CLASS_TIER, RESELECT_COOLDOWN_MS } from '../src/game/constants.js';
import { advanceAtlasRun } from '../src/game/atlas-engine.js';
import * as Player from '../src/services/player.js';
import * as Special from '../src/services/special.js';
import * as Atlas from '../src/services/atlas.js';
import { view } from '../src/services/skill-career.js';

async function fixture(t, { baseClass = 'sword', level = 60, path = 'A' } = {}) {
  const env = {
    DB: freshDb(), ATLAS_ENABLED: 'false', EQUIPMENT_COLLECTION_ENABLED: 'false',
    REALM_CONTEXT: { id: 'permanent', phase: 'ACTIVE' },
  };
  const db = env.DB.sqlite;
  t.after(() => db.close());
  const initial = await Player.createCharacter(env, {
    tgId: '992901', name: '技能職業測試', gender: 'f', baseClass,
  }, T0, mulberry32(7));
  const id = initial.char.tg_id;
  db.prepare('UPDATE rpg_characters SET level=?,class_path=?,exp=0,last_settle_at=? WHERE tg_id=?').run(level, path, T0, id);
  const player = await loadPlayer(env.DB, id, env);
  const stats = computeStats(player.char, player.equipment.filter(item => item.is_equipped));
  db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp, stats.maxMp, id);
  const put = (item, quantity) => db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(id, item, quantity);
  return { env, db, id, put };
}

function readGuard(DB) {
  const queries = [];
  return {
    queries,
    DB: {
      prepare(sql) {
        assert.match(sql, /^\s*SELECT\b/i, 'opening the view must not prepare a write');
        assert.doesNotMatch(sql, /\brpg_(?:atlas|equipment_collection)\w*\b/i, 'legacy view must not require optional integration tables');
        queries.push(sql);
        return DB.prepare(sql);
      },
      batch(statements) { return DB.batch(statements); },
    },
  };
}

const changes = db => db.prepare('SELECT total_changes() AS value').get().value;
const savedRun = (db, id) => db.prepare('SELECT * FROM rpg_atlas_runs WHERE char_id=? ORDER BY rowid DESC LIMIT 1').get(id);
const inventoryRows = (db, id) => db.prepare('SELECT item,quantity FROM rpg_inventory WHERE tg_id=? ORDER BY item').all(id);
const classAction = (env, id, now, fn) => Player.withPlayer(env, id, now, fn);

test('skill-career preserves learned mastery, loadout, auto conditions and research prices without settling or writing', async t => {
  const { env, db, id, put } = await fixture(t);
  put('book_skill_01_1', 5);
  put('mat_2', 1);
  await Special.action(env, id, { op: 'learn', skillId: 'skill_01_1', fromLevel: 0, requestId: 'career-learn-01' }, T0);
  await Special.action(env, id, { op: 'learn', skillId: 'skill_01_1', fromLevel: 1, requestId: 'career-learn-02' }, T0);
  await Special.action(env, id, { op: 'loadout', loadout: ['skill_01_1'], requestId: 'career-loadout-01' }, T0);
  await Special.action(env, id, { op: 'auto', skillId: 'skill_01_1', mode: 'elite', requestId: 'career-auto-01' }, T0);
  const now = T0 + 6 * 60 * 60 * 1000;
  const before = await loadPlayer(env.DB, id, env);
  const canonical = Special.stateView(before, now);
  const guard = readGuard(env.DB), total = changes(db);
  const result = await view({ ...env, DB: guard.DB }, id, now);
  for (const [key, value] of Object.entries(canonical)) {
    assert.deepEqual(result[key], key === 'skills' ? value.map(skill => ({ ...skill, researchCost: researchCost(skill) })) : value, key);
  }
  assert.equal(result.characterId, id);
  assert.equal(result.realmId, 'permanent');
  assert.equal(result.now, now);
  assert.equal(result.readOnly, false);
  assert.equal(result.readOnlyReason, null);
  assert.deepEqual(result.special.loadout, ['skill_01_1']);
  assert.equal(result.special.auto.skill_01_1, 'elite');
  assert.equal(result.skills.find(skill => skill.id === 'skill_01_1').mastery.level, 2);
  assert.equal(result.inventory.book_skill_01_1, 3);
  assert.ok(result.eligible.includes('skill_01_1'));
  assert.equal(result.career.next.canAdvance, true);
  assert.equal(changes(db), total);
  assert.deepEqual(await loadPlayer(env.DB, id, env), before, 'elapsed idle minutes remain untouched');
  assert.ok(guard.queries.length > 0);
});

test('skill-career returns the existing no-character error without initializing state', async t => {
  const DB = freshDb();
  t.after(() => DB.sqlite.close());
  const guard = readGuard(DB), total = changes(DB.sqlite);
  await assert.rejects(view({ DB: guard.DB }, '999991', T0), { code: 'no_character', status: 404 });
  assert.equal(changes(DB.sqlite), total);
});

for (const baseClass of ['sword', 'archer', 'mage', 'thief']) {
  test('skill-career projects all four real advancement gates for ' + baseClass, async t => {
    const { env, db, id, put } = await fixture(t, { baseClass, level: 1, path: '' });
    let result = await view(env, id, T0);
    assert.equal(result.career.current.tier, 0);
    assert.equal(result.career.next.reason.code, 'level');
    assert.deepEqual(result.career.reselect.tiers, []);
    let path = '';
    for (let tier = 1; tier <= MAX_OPEN_CLASS_TIER; tier++) {
      db.prepare('UPDATE rpg_characters SET level=? WHERE tg_id=?').run(tier * 30, id);
      result = await view(env, id, T0);
      const material = (tier >= 3 ? 'trial_' : 'mat_') + tier;
      assert.equal(result.career.next.tier, tier);
      assert.equal(result.career.next.requiredLevel, tier * 30);
      assert.equal(result.career.next.material.id, material);
      assert.equal(result.career.next.material.have, 0);
      assert.equal(result.career.next.material.required, 1);
      assert.equal(result.career.next.canAdvance, false);
      assert.equal(result.career.next.reason.code, 'material');
      assert.deepEqual(result.career.next.choices.map(choice => choice.branch), tier === 1 ? ['A', 'B'] : ['1', '2']);
      put(material, 1);
      result = await view(env, id, T0);
      assert.equal(result.career.next.canAdvance, true);
      assert.equal(result.career.next.reason, null);
      const choice = result.career.next.choices[tier % 2];
      path += choice.branch;
      const changed = await classAction(env, id, T0, (work, ctx) => Player.doAdvance(work, ctx, {
        branch: choice.branch, requestId: 'career-' + baseClass + '-advance-' + tier,
      }));
      assert.equal(changed.player.char.class_path, path);
      assert.equal(changed.player.inv[material], 0);
      result = await view(env, id, T0);
      const expected = nodeFor(baseClass, path);
      assert.equal(result.career.current.path, path);
      assert.equal(result.career.current.name, expected.name);
      assert.equal(result.career.current.passive, expected.passiveText);
      const { description, iconSrc, ...skillFields } = result.career.current.skill;
      assert.deepEqual(skillFields, expected.skill);
      assert.ok(description && !/^[＋+…·]$/.test(description), 'career skill keeps a real description');
      assert.equal(iconSrc, '/art/career-skill-icons-20261110/' + (path ? baseClass + '_' + path : baseClass) + '.webp');
      assert.equal(result.career.current.weapon, choice.weapon);
    }
    assert.equal(result.career.maxTier, MAX_OPEN_CLASS_TIER);
    assert.equal(result.career.next, null);
    assert.equal(result.career.reselect.tiers.length, MAX_OPEN_CLASS_TIER);
    const unavailable = result.career.reselect.tiers[3];
    assert.deepEqual(unavailable.book, { id: null, name: '此階尚未開放重選', required: 0, have: 0 });
    assert.ok(unavailable.choices.every(choice => !choice.canReselect && choice.reason.code === 'reselect_not_available'));
    assert.ok(unavailable.choices.every(choice => choice.unequipped.length === 0));
  });
}

test('skill-career previews retained deeper paths, exact book costs and branch gear removal through the real reselect rules', async t => {
  const { env, db, id, put } = await fixture(t, { level: 90, path: 'A11' });
  for (const tier of [1, 2, 3]) put('reselect_' + tier, 1);
  const weapon = db.prepare("SELECT * FROM rpg_equipment WHERE tg_id=? AND slot='weapon' AND is_equipped=1").get(id);
  db.prepare("UPDATE rpg_equipment SET branch_req='A' WHERE id=?").run(weapon.id);
  const before = await loadPlayer(env.DB, id, env), total = changes(db);
  let result = await view(env, id, T0);
  const first = result.career.reselect.tiers[0];
  assert.equal(first.currentBranch, 'A');
  assert.equal(first.book.id, 'reselect_1');
  assert.equal(first.book.have, 1);
  assert.equal(first.book.required, 1);
  const selected = first.choices.find(choice => choice.selected);
  assert.equal(selected.canReselect, false);
  assert.equal(selected.reason.code, 'branch');
  const next = first.choices.find(choice => choice.branch === 'B');
  assert.equal(next.path, 'B11', 'reselection keeps every deeper branch');
  assert.equal(next.name, nodeFor('sword', 'B11').name);
  assert.equal(next.branchName, nodeFor('sword', 'B').name);
  assert.equal(next.canReselect, true);
  assert.deepEqual(next.unequipped, [{ id: weapon.id, name: weapon.name, slot: 'weapon', branchReq: 'A' }]);
  const second = result.career.reselect.tiers[1].choices.find(choice => choice.branch === '2');
  assert.equal(second.path, 'A21');
  assert.deepEqual(second.unequipped, []);
  assert.equal(changes(db), total);
  assert.deepEqual(await loadPlayer(env.DB, id, env), before);

  const changed = await classAction(env, id, T0, (work, ctx) => Player.doReselect(work, ctx, {
    tier: 1, branch: next.branch, requestId: 'career-reselect-01',
  }));
  assert.equal(changed.player.char.class_path, next.path);
  assert.deepEqual(changed.result.unequipped, next.unequipped.map(item => item.id));
  assert.equal(changed.player.inv.reselect_1, 0);
  result = await view(env, id, T0 + 1000);
  assert.equal(result.career.reselect.cooldownUntil, T0 + RESELECT_COOLDOWN_MS);
  assert.equal(result.career.reselect.cooldownRemainingMs, RESELECT_COOLDOWN_MS - 1000);
  assert.equal(result.career.reselect.tiers[0].choices.find(choice => !choice.selected).reason.code, 'no_book');
  assert.equal(result.career.reselect.tiers[1].choices.find(choice => !choice.selected).reason.code, 'cooldown');
  result = await view(env, id, T0 + RESELECT_COOLDOWN_MS);
  assert.equal(result.career.reselect.cooldownRemainingMs, 0);
  assert.equal(result.career.reselect.tiers[1].choices.find(choice => !choice.selected).canReselect, true);
});

test('skill-career shows gear removal even when a missing book or cooldown currently prevents reselection', async t => {
  const { env, db, id, put } = await fixture(t);
  const weapon = db.prepare("SELECT * FROM rpg_equipment WHERE tg_id=? AND slot='weapon' AND is_equipped=1").get(id);
  db.prepare("UPDATE rpg_equipment SET branch_req='A' WHERE id=?").run(weapon.id);
  let result = await view(env, id, T0);
  let alternative = result.career.reselect.tiers[0].choices.find(choice => !choice.selected);
  assert.equal(alternative.canReselect, false);
  assert.equal(alternative.reason.code, 'no_book');
  assert.deepEqual(alternative.unequipped.map(item => item.id), [weapon.id]);
  put('reselect_1', 1);
  db.prepare('UPDATE rpg_characters SET last_reselect_at=? WHERE tg_id=?').run(T0, id);
  const total = changes(db);
  result = await view(env, id, T0 + 1000);
  alternative = result.career.reselect.tiers[0].choices.find(choice => !choice.selected);
  assert.equal(alternative.reason.code, 'cooldown');
  assert.deepEqual(alternative.unequipped.map(item => item.id), [weapon.id]);
  assert.equal(changes(db), total);
});

test('skill-career keeps committed skill data and career previews readable in every frozen realm phase', async t => {
  const { env, db, id, put } = await fixture(t);
  put('mat_2', 1);
  put('reselect_1', 1);
  const before = await loadPlayer(env.DB, id, env), total = changes(db);
  const guard = readGuard(env.DB);
  for (const phase of ['FREEZE', 'DRAIN', 'SEALED', 'IMPORTING', 'COMPLETE']) {
    const result = await view({
      ...env, DB: guard.DB, REALM_CONTEXT: { id: 'season-career-fixture', phase },
    }, id, T0 + 600000);
    assert.equal(result.realmId, 'season-career-fixture');
    assert.equal(result.characterId, id);
    assert.equal(result.readOnly, true);
    assert.match(result.readOnlyReason, /僅供查看/);
    assert.equal(result.career.next.canAdvance, false);
    assert.equal(result.career.next.reason.code, 'realm_read_only');
    assert.equal(result.career.next.choices.length, 2);
    assert.ok(result.skills.length > 0);
    assert.ok(result.eligible.includes('skill_01_1'));
    assert.ok(result.career.reselect.tiers.every(stage => stage.choices.every(choice => !choice.canReselect && choice.reason.code === 'realm_read_only')));
  }
  assert.equal(changes(db), total);
  assert.deepEqual(await loadPlayer(env.DB, id, env), before);
});

test('skill-career mirrors the existing party restriction for both career operations', async t => {
  const { env, db, id, put } = await fixture(t);
  put('mat_2', 1);
  put('reselect_1', 1);
  db.prepare("UPDATE rpg_characters SET party_id='career-party-fixture' WHERE tg_id=?").run(id);
  const total = changes(db);
  const result = await view(env, id, T0);
  assert.equal(result.career.activity.partyId, 'career-party-fixture');
  assert.equal(result.career.next.canAdvance, false);
  assert.equal(result.career.next.reason.code, 'party');
  assert.ok(result.career.reselect.tiers.every(stage => stage.choices.every(choice => !choice.canReselect && choice.reason.code === 'party')));
  assert.equal(changes(db), total);
});

test('skill-career retains learned mastery while deriving eligibility from the newly selected branch', async t => {
  const { env, id, put } = await fixture(t);
  put('book_skill_01_1', 1);
  put('reselect_1', 1);
  await Special.action(env, id, { op: 'learn', skillId: 'skill_01_1', fromLevel: 0, requestId: 'career-before-branch' }, T0);
  await Special.action(env, id, { op: 'loadout', loadout: ['skill_01_1'], requestId: 'career-branch-loadout' }, T0);
  assert.ok((await view(env, id, T0)).eligible.includes('skill_01_1'));
  await classAction(env, id, T0, (work, ctx) => Player.doReselect(work, ctx, {
    tier: 1, branch: 'B', requestId: 'career-change-branch',
  }));
  const result = await view(env, id, T0);
  assert.equal(result.career.current.path, 'B');
  assert.ok(result.special.learned.includes('skill_01_1'), 'a read must not erase knowledge from the former branch');
  assert.ok(result.special.loadout.includes('skill_01_1'), 'projection preserves the saved configuration');
  assert.equal(result.skills.find(skill => skill.id === 'skill_01_1').mastery.level, 1);
  assert.equal(result.eligible.includes('skill_01_1'), false, 'the action API still rejects the old branch skill');
});

test('real advancement and reselection during Atlas preserve the saved run and use current stats only for completion and the next departure', async t => {
  const { env, db, id, put } = await fixture(t);
  env.ATLAS_ENABLED = 'true';
  put('mat_2', 1);
  put('reselect_1', 1);
  db.prepare("UPDATE rpg_equipment SET branch_req='A' WHERE tg_id=? AND slot='weapon' AND is_equipped=1").run(id);
  const body = { requestId: 'career-atlas-start-01', queueMode: 'duration', mapId: 'laurel_intro', durationMinutes: 3, supplies: { hp: 10, mp: 10 } };
  const started = await Atlas.start(env, id, body, T0);
  const original = savedRun(db, id), oldState = JSON.parse(original.state_json);
  assert.equal(oldState.content.classPath, 'A');
  let result = await view(env, id, T0 + 60000);
  assert.equal(result.career.activity.atlasRunId, started.run.id);
  assert.equal(result.career.next.canAdvance, true, 'Atlas is not a new career restriction');
  await classAction(env, id, T0 + 60000, (work, ctx) => Player.doAdvance(work, ctx, {
    branch: '1', requestId: 'career-atlas-advance-01',
  }));
  assert.equal(savedRun(db, id).state_json, original.state_json, 'advancement cannot rewrite or advance the run');
  await classAction(env, id, T0 + 61000, (work, ctx) => Player.doReselect(work, ctx, {
    tier: 1, branch: 'B', requestId: 'career-atlas-reselect-01',
  }));
  result = await view(env, id, T0 + 120000);
  assert.equal(result.career.current.path, 'B1');
  assert.equal(savedRun(db, id).state_json, original.state_json, 'reselection and opening the view leave the persisted run byte-identical');
  const endAt = T0 + 180000;
  const expected = advanceAtlasRun(JSON.parse(original.state_json), Math.floor(endAt / 1000));
  await Atlas.settle(env, id, { runId: started.run.id }, endAt);
  const finished = JSON.parse(savedRun(db, id).state_json);
  for (const key of ['snapshot', 'skill', 'effects', 'talentSnapshot', 'buildId', 'supports', 'automation']) {
    if (key === 'effects') assert.deepEqual(finished.effects.actor, oldState.effects.actor);
    else assert.deepEqual(finished[key], oldState[key], key);
  }
  assert.equal(finished.content.classPath, 'A');
  assert.deepEqual(finished.metrics, expected.state.metrics);
  assert.deepEqual(finished.hero, expected.state.hero);
  assert.equal(finished.rng, expected.state.rng);
  assert.notEqual(finished.status, 'running');
  const current = await loadPlayer(env.DB, id, env);
  const currentStats = computeStats(current.char, current.equipment.filter(item => item.is_equipped));
  assert.equal(current.char.class_path, 'B1');
  assert.equal(current.char.atlas_run_id, null);
  assert.ok(current.char.hp >= 1 && current.char.hp <= currentStats.maxHp);
  assert.ok(current.char.mp >= 0 && current.char.mp <= currentStats.maxMp);
  const inv = inventoryRows(db, id), ledger = db.prepare('SELECT * FROM rpg_ledger ORDER BY event_id').all();
  await Atlas.settle(env, id, { runId: started.run.id }, endAt);
  assert.deepEqual(inventoryRows(db, id), inv, 'completion still refunds supplies only once');
  assert.deepEqual(db.prepare('SELECT * FROM rpg_ledger ORDER BY event_id').all(), ledger);
  await Atlas.start(env, id, { ...body, requestId: 'career-atlas-start-02' }, endAt);
  const nextState = JSON.parse(savedRun(db, id).state_json);
  assert.equal(nextState.content.classPath, 'B1');
  assert.equal(nextState.snapshot.atk, currentStats.atk);
  assert.equal(nextState.snapshot.maxHp, currentStats.maxHp);
});

test('every career path has a compact skill icon and a non-glyph description', async t => {
  const { env, db, id } = await fixture(t, { baseClass: 'sword', level: 120, path: 'A11' });
  const result = await view(env, id, T0);
  assert.match(result.career.current.skill.iconSrc, /\/art\/career-skill-icons-20261110\/sword_A11\.webp$/);
  assert.match(result.career.current.skill.description, /攻擊|目標|耗魔/);
  const { branchChoices } = await import('../src/game/classes.js');
  const { CLASSES } = await import('../src/game/constants.js');
  for (const baseClass of Object.keys(CLASSES)) {
    const paths = new Set(['']);
    const queue = [''];
    while (queue.length) {
      const path = queue.shift();
      if (path.length >= 4) continue;
      for (const choice of branchChoices(baseClass, path.length + 1, path)) {
        if (!paths.has(choice.path)) { paths.add(choice.path); queue.push(choice.path); }
      }
    }
    for (const path of paths) {
      const key = path ? baseClass + '_' + path : baseClass;
      const file = new URL('../public/art/career-skill-icons-20261110/' + key + '.webp', import.meta.url);
      assert.ok(fs.existsSync(file), key);
    }
  }
  assert.ok(fs.existsSync(new URL('../public/art/career-skill-icons-20261110/empty-slot.webp', import.meta.url)));
});

test('career projection carries the classic 轉職 copy: material source and path 定位 from lineage', async () => {
  const env = { DB: freshDb() };
  await Player.createCharacter(env, { tgId: '7701', name: '轉職說明', baseClass: 'sword', gender: 'f' }, T0, () => .5);
  await env.DB.prepare('UPDATE rpg_characters SET level=60, class_path=? WHERE tg_id=?').bind('A', '7701').run();
  const career = (await view(env, '7701', T0)).career;
  assert.equal(career.next.material.source, '討伐腐朽樹王');
  assert.ok(career.current.blurb);
  assert.ok(career.next.choices.every(c => typeof c.blurb === 'string' && c.blurb.length));
  assert.ok(career.next.choices.every(c => c.inheritance === '包含二轉與一轉被動。'));
});
