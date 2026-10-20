import test from 'node:test';
import assert from 'node:assert/strict';
import { THIEF_RELEASE_READY, THIEF_NODES, THIEF_IDENTITIES } from '../src/game/thief-data.js';
import { CLASSES, CLASS_KEYS, ALL_CLASS_KEYS, SLOTS, CLASS_ARMOR_SLOTS, SHARED_SLOTS, GENERAL_WEAPON, TIER_LEVEL_REQ } from '../src/game/constants.js';
import { advance, reselect } from '../src/game/classes.js';
import { branchChoices } from '../src/game/classes.js';
import { nodeFor, computeStats, standardSet, idleStats } from '../src/game/stats.js';
import { gearOffers, makeGear, makeRelic, canEquip, convertWeapon } from '../src/game/gear.js';
import { createCharacter } from '../src/services/player.js';
import { mulberry32 } from '../src/game/rng.js';
import { AFFIXES, BRANCH_AFFIXES, rollAffixes } from '../src/game/affixes.js';
import { freshDb } from './d1-shim.js';
import { auditThiefSchema } from '../scripts/audit-thief-schema.mjs';
import { repositorySchemaDatabase } from '../scripts/prepare-thief-schema-candidate.mjs';
import { compareThiefBalance } from '../scripts/compare-thief-balance.mjs';

const expected = {
  '': '盜賊', A: '刺客', B: '夜行者', A1: '影襲刺客', A2: '毒刃刺客', B1: '飛刃遊俠', B2: '幻刃使',
  A11: '夜幕處刑者', A12: '幽影追獵者', A21: '蝕毒煉師', A22: '血棘獵手',
  B11: '疾風刃使', B12: '星刃獵手', B21: '鏡影舞者', B22: '暮光詭術師',
  A111: '冥夜裁決者', A112: '終焉斷刃', A121: '虛影行者', A122: '無聲獵魂者',
  A211: '九首毒刃', A212: '冥蛇使徒', A221: '血棘君主', A222: '蝕魂收割者',
  B111: '風暴千刃', B112: '疾影穿梭者', B121: '星隕刃使', B122: '星軌追獵者',
  B211: '千面幻刃', B212: '鏡界行者', B221: '暮光織影者', B222: '黑月詭術師',
};
const character = (path = '', extra = {}) => ({ tg_id: 'thief-fixture', base_class: 'thief', class_path: path, gender: 'm', level: Math.max(1, path.length * 30), ...extra });

test('thief candidates contain all 31 agreed named nodes and both exact gender identities', () => {
  assert.equal(Object.keys(expected).length, 31);
  assert.deepEqual(Object.fromEntries(Object.entries(THIEF_NODES).map(([key, node]) => [key, node.name])), expected);
  assert.equal(THIEF_IDENTITIES.length, 62);
  assert.equal(new Set(THIEF_IDENTITIES.map(x => x.key)).size, 62);
  for (const [path, name] of Object.entries(expected)) {
    assert.deepEqual(THIEF_IDENTITIES.filter(x => x.classPath === path).map(x => x.gender), ['m', 'f']);
    assert.ok(THIEF_IDENTITIES.filter(x => x.classPath === path).every(x => x.name === name && x.baseClass === 'thief'));
  }
  assert.equal(Object.isFrozen(THIEF_NODES.A111.skill), true);
});

for (const [path, name] of Object.entries(expected)) test(`thief ${path || 'base'}: real node, legal advancement, branch gear and finite derived stats`, () => {
  const c = character(path), n = nodeFor('thief', path), tier = path.length;
  assert.equal(n.name, name); assert.equal(n.tier, tier); assert.equal(n.path, path);
  if (tier >= 2) assert.equal(n.skill.thiefRoute, path.slice(0, 2));
  if (path) {
    const parent = character(path.slice(0, -1), { level: tier * 30 });
    const mat = tier >= 3 ? `trial_${tier}` : `mat_${tier}`, inv = { [mat]: 1 };
    const choice = branchChoices('thief', tier, parent.class_path).find(x => x.branch === path.at(-1));
    assert.equal(choice.name, name); assert.equal(choice.path, path);
    assert.equal(advance(parent, inv, path.at(-1)).node.name, name);
    assert.equal(parent.class_path, path); assert.equal(inv[mat], 0);
    assert.throws(() => advance(character(path.slice(0, -1), { level: tier * 30 - 1 }), { [mat]: 1 }, path.at(-1)), error => error.code === 'level');
  }
  const stats = computeStats(c, standardSet('thief', c.level));
  for (const key of ['atk', 'def', 'maxHp', 'maxMp', 'taken', 'power']) assert.ok(Number.isFinite(stats[key]) && stats[key] > 0, `${name} ${key}`);
  assert.equal(stats.skill.name, n.skill.name);
  const offers = gearOffers({ ...c, level: 120 });
  assert.equal(new Set(offers.map(x => x.tier)).size, 12);
  assert.equal(offers.filter(x => x.slot === 'weapon' && x.branch === null).length, 12);
  assert.ok(offers.filter(x => x.slot === 'weapon').every(x => x.branch == null || x.branch === path[0]));
  assert.equal(offers.filter(x => CLASS_ARMOR_SLOTS.includes(x.slot)).length, 48);
  assert.equal(offers.filter(x => SHARED_SLOTS.includes(x.slot)).length, 48);
  assert.deepEqual(new Set(offers.map(x => x.slot)), new Set(SLOTS));
});

test('release gate controls public creation and relic drops without bypassing database constraints', async () => {
  assert.equal(CLASSES.thief.releaseReady, THIEF_RELEASE_READY);
  assert.deepEqual(CLASS_KEYS, [...(THIEF_RELEASE_READY ? ['thief'] : []), 'sword', 'archer', 'mage']); assert.ok(ALL_CLASS_KEYS.includes('thief'));
  if (!THIEF_RELEASE_READY) {
    let dbCalls = 0;
    const env = { DB: { prepare() { dbCalls++; throw new Error('unexpected DB access'); } } };
    for (const gender of ['m', 'f']) await assert.rejects(createCharacter(env, { tgId: '999001', name: '盜賊測試', gender, baseClass: 'thief' }, 1, mulberry32(1)), error => error.code === 'class');
    assert.equal(dbCalls, 0);
  } else {
    const env = { DB: freshDb() };
    try {
      for (const [index, gender] of ['m', 'f'].entries()) {
        const tgId = String(999001 + index);
        await createCharacter(env, { tgId, name: `盜賊測試${index}`, gender, baseClass: 'thief' }, 1, mulberry32(index));
        assert.equal(env.DB.sqlite.prepare('SELECT base_class FROM rpg_characters WHERE tg_id=?').get(tgId).base_class, 'thief');
      }
    } finally { env.DB.sqlite.close(); }
  }
  const drops = new Set();
  for (let seed = 0; seed < 250; seed++) {
    const drop = makeRelic({ id: `fixture-${seed}`, tgId: 'fixture', tier: seed % 12 + 1, rng: mulberry32(seed), now: 1 });
    drops.add(drop.class_req);
    assert.ok(drop.class_req === 'any' || CLASS_KEYS.includes(drop.class_req));
  }
  assert.equal(drops.has('thief'), THIEF_RELEASE_READY);
});

test('dagger, branch weapons and all 12 armor tiers keep ownership, class, level and shared-slot rules', () => {
  assert.equal(GENERAL_WEAPON.thief, 'dagger');
  for (let tier = 1; tier <= 12; tier++) for (const slot of SLOTS) {
    const c = character('', { level: 120 });
    const item = makeGear({ id: `fixture-${tier}-${slot}`, tgId: c.tg_id, cls: 'thief', slot, kind: slot === 'weapon' ? 'dagger' : null, tier, rng: mulberry32(tier), now: 1 });
    assert.equal(item.class_req, SHARED_SLOTS.includes(slot) ? 'any' : 'thief');
    assert.equal(item.level_req, TIER_LEVEL_REQ[tier]); assert.equal(canEquip(c, item), null);
    assert.match(canEquip({ ...c, tg_id: 'another' }, item), /你的裝備/);
    if (tier > 1) assert.match(canEquip({ ...c, level: TIER_LEVEL_REQ[tier] - 1 }, item), /需要 Lv/);
    assert.equal(canEquip({ ...c, base_class: 'sword' }, item) === null, SHARED_SLOTS.includes(slot));
  }
});

test('deep thief reselect preserves every deeper choice and converts branch weapons once without losing rolls', () => {
  const c = character('A212', { level: 120 }), inv = { reselect_1: 1, reselect_2: 1 };
  const item = makeGear({ id: 'paired-fixture', tgId: c.tg_id, cls: 'thief', slot: 'weapon', kind: 'dual_daggers', tier: 12, rng: mulberry32(31), now: 1, relic: true });
  item.is_equipped = 1; item.enhance_level = 7; item.bound = 1;
  const result = reselect(c, inv, [item], 1, 'B', 10_000_000);
  assert.equal(c.class_path, 'B212'); assert.equal(nodeFor('thief', c.class_path).name, '鏡界行者');
  assert.deepEqual(result.unequipped, ['paired-fixture']); assert.equal(item.is_equipped, 0);
  assert.equal(item.convert_token, 1);
  const converted = convertWeapon(item);
  assert.equal(converted.kind, 'throwing_blades'); assert.equal(converted.branch_req, 'B');
  for (const key of ['id', 'tg_id', 'base_stat', 'tier', 'element', 'element_stat', 'element_tier', 'enhance_level', 'affix_json', 'affixes_json', 'bound', 'grade', 'created_at']) assert.equal(converted[key], item[key], key);
  assert.equal(convertWeapon(converted), null); assert.equal(canEquip(c, converted), null);
  reselect(c, inv, [converted], 2, '1', 12_000_000);
  assert.equal(c.class_path, 'B112'); assert.equal(nodeFor('thief', c.class_path).name, '疾影穿梭者');
});

test('invalid thief paths are rejected before material consumption and fourth-tier nodes have no children', () => {
  for (const path of ['C', 'A3', 'B10', 'A1111', '__proto__']) {
    assert.throws(() => nodeFor('thief', path), /unknown branch/);
    assert.deepEqual(branchChoices('thief', path.length + 1, path), []);
    const inv = { mat_2: 1, trial_3: 1, trial_4: 1 };
    assert.throws(() => advance(character(path, { level: 120 }), inv, '1'), error => error.code === 'branch');
    assert.deepEqual(inv, { mat_2: 1, trial_3: 1, trial_4: 1 });
  }
  assert.deepEqual(branchChoices('thief', 5, 'A111'), []);
});

test('all 31 thief routes use melee bonuses, including flying blades; original classes keep their categories', () => {
  const item = { slot: 'gloves', base_stat: 1, tier: 1, is_equipped: 1, bonus_json: JSON.stringify({ meleePct: .10, rangedPct: .20, magicPct: .30 }) };
  for (const path of Object.keys(expected)) assert.equal(computeStats(character(path), [item]).pct.atkPct, .10);
  for (const [base_class, bonus] of [['sword', .10], ['archer', .20], ['mage', .30]]) assert.equal(computeStats({ ...character(''), base_class }, [item]).pct.atkPct, bonus);
});

test('thief equipment rolls supported melee, poison and lifesteal affixes, without ranged or magic class affixes', () => {
  assert.deepEqual(AFFIXES.meleePct.classes, ['sword', 'thief']);
  assert.deepEqual(AFFIXES.rangedPct.classes, ['archer']); assert.deepEqual(AFFIXES.magicPct.classes, ['mage']);
  const rolled = new Set();
  for (let seed = 0; seed < 100; seed++) for (const line of rollAffixes({ class_req: 'thief', tier: 12 }, mulberry32(seed))) {
    rolled.add(line.key); assert.ok(!['rangedPct', 'magicPct', 'summonPct', 'elemPct'].includes(line.key));
  }
  for (const key of ['meleePct', 'dotPct', 'lifestealPct']) assert.ok(rolled.has(key), key);
  for (const path of ['A1', 'A2', 'B1', 'B2']) assert.ok(BRANCH_AFFIXES.thief[path].includes('meleePct'));
});

test('historical 0024 schema blocks thief before the separately tested fresh initializer', () => {
  const db = { sqlite: repositorySchemaDatabase() };
  try {
    const insertCharacter = db.sqlite.prepare("INSERT INTO rpg_characters(tg_id,name,gender,base_class,last_settle_at,created_day,created_at,updated_at,hp,mp) VALUES(?,?,?,?,1,'2026-10-15',1,1,100,40)");
    for (const cls of ['sword', 'archer', 'mage']) assert.doesNotThrow(() => insertCharacter.run(`fixture-${cls}`, `測試${cls}`, 'm', cls));
    assert.throws(() => insertCharacter.run('fixture-thief', '測試盜賊', 'm', 'thief'), /CHECK constraint failed/);
    const insertGear = db.sqlite.prepare("INSERT INTO rpg_equipment(id,tg_id,slot,kind,class_req,tier,level_req,name,base_stat,created_at) VALUES(?,?,'weapon',?,?,1,1,'測試裝備',12,1)");
    assert.doesNotThrow(() => insertGear.run('fixture-sword-item', 'fixture-sword', 'sword', 'sword'));
    assert.throws(() => insertGear.run('fixture-thief-item', 'fixture-thief', 'dagger', 'thief'), /CHECK constraint failed/);
  } finally { db.sqlite.close(); }
});

test('schema design inventory retains later columns, guardian foreign keys, indexes and all lock triggers', () => {
  const inventory = auditThiefSchema(), chars = inventory.tables.rpg_characters, gear = inventory.tables.rpg_equipment;
  assert.equal(inventory.status, 'design-only-not-applied'); assert.equal(inventory.remoteWrites, 0);
  assert.equal(inventory.productionMigrationCreated, false); assert.equal(inventory.migrations.length, 24);
  assert.deepEqual(chars.laterAddedColumns.map(x => x.column), ['tg_username', 'account_tg_id', 'char_slot', 'special_json', 'party_id', 'idle_combat_json', 'guardian_draw_remainder', 'collection_active_map']);
  assert.deepEqual(gear.laterAddedColumns.map(x => x.column), ['affixes_json']);
  assert.deepEqual(chars.incomingForeignKeys.map(x => `${x.ownerTable}.${x.from}`).sort(), ['rpg_guardian_operations.char_id', 'rpg_guardian_sigils.char_id', 'rpg_guardian_voucher_grants.recipient_char_id', 'rpg_guardian_welcome.recipient_char_id']);
  for (const name of ['idx_rpg_characters_username', 'idx_rpg_characters_account', 'idx_rpg_characters_account_slot']) assert.ok(chars.indexes.some(x => x.name === name), name);
  for (const name of ['rpg_auto_enhance_equipment_update', 'rpg_auto_enhance_equipment_delete', 'rpg_auto_reroll_equipment_update', 'rpg_auto_reroll_equipment_delete', 'rpg_exchange_equipment_update', 'rpg_exchange_equipment_delete']) assert.ok(gear.attachedTriggers.some(x => x.name === name), name);
  assert.ok(chars.attachedTriggers.some(x => x.name === 'collection_blessing_owner'));
  assert.ok(chars.referencingTriggers.some(x => x.name === 'guardian_welcome_resources'));
});

test('all 31 thief routes keep high frequency and fragile HP/DEF, including defensive phantom routes', () => {
  const comparison = compareThiefBalance();
  assert.equal(comparison.rows.length, 20); assert.equal(comparison.fragility.length, 93);
  assert.ok(comparison.maximumThiefEhpRatioAtLevel120 < .5);
  for (const path of Object.keys(expected)) {
    const thief = computeStats(character(path, { level: 120 }), standardSet('thief', 120));
    assert.equal(thief.attackSpeedMultiplier, 1.8); assert.equal(thief.hitAttackMultiplier, .60);
    assert.ok(thief.taken >= .86, path);
    for (const base_class of ['sword', 'archer', 'mage']) {
      const other = computeStats({ ...character(path, { level: 120 }), base_class }, standardSet(base_class, 120));
      assert.ok(thief.maxHp < other.maxHp, path); assert.ok(thief.def < other.def, path);
      assert.equal(other.attackSpeedMultiplier, 1); assert.equal(other.hitAttackMultiplier, 1);
    }
  }
  for (const level of [1, 30, 60, 90, 120]) {
    const thief = comparison.rows.find(row => row.level === level && row.baseClass === 'thief');
    const archer = comparison.rows.find(row => row.level === level && row.baseClass === 'archer');
    const sword = comparison.rows.find(row => row.level === level && row.baseClass === 'sword');
    assert.ok(thief.maxHp < archer.maxHp * .73); assert.ok(thief.maxHp < sword.maxHp * .55);
    assert.ok(thief.nativeDamagePerBaselineUnit / archer.nativeDamagePerBaselineUnit < 1.1, String(level));
    assert.ok(thief.atkPerStrike < archer.atkPerStrike * .65);
  }
});

test('high-tier weapon and element increases keep reduced per-strike potency rather than bypassing the speed budget', () => {
  const weapon = base_stat => ({ slot: 'weapon', base_stat, tier: 12, is_equipped: 1, element: 'dark', element_stat: 100, element_tier: 'common', bonus_json: '{}' });
  const high = computeStats(character('', { level: 120 }), [weapon(10000)]);
  const low = computeStats(character('', { level: 120 }), [weapon(0)]);
  assert.equal(high.atk - low.atk, 6000);
  assert.equal((high.atk - low.atk) * high.attackSpeedMultiplier, 10800);
  assert.equal(high.weaponElem, 60);
  const archer = computeStats({ ...character('', { level: 120 }), base_class: 'archer' }, [weapon(10000)]);
  assert.equal(archer.weaponElem, 100);
  assert.equal(high.power, Math.round(high.atk * high.skill.mult * high.attackSpeedMultiplier + high.def * 1.5 + high.maxHp / 10 + high.maxMp / 20));
});

test('idle speed has a single reduced-potency budget and never blindly grants 80 percent more kills', () => {
  for (const path of Object.keys(expected)) {
    const c = character(path, { level: 120 }), stats = idleStats(c, standardSet('thief', 120));
    assert.equal(stats.idleNativeDamageMultiplier, 1.08);
    assert.ok(stats.r>=1,'tier growth never weakens standard equipment');assert.ok(stats.g>=1&&stats.g<=1.1,'extra growth efficiency remains bounded independently of native attack speed');
    const baseKills = 2 * (1 + .15 * (Math.min(5, stats.skill.targets) - 1));
    assert.ok(Math.abs(stats.killsPerTick / baseKills - 1.08) < 1e-12);
  }
});
