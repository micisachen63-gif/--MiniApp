import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { gameplaySnapshot } from './realm-test-helpers.js';
import * as P from '../src/services/player.js';
import * as G from '../src/services/party.js';
import { view } from '../src/services/party-scene.js';
import { loadPlayer } from '../src/db.js';
import { computeStats } from '../src/game/stats.js';
import { masteredSkill } from '../src/game/skill-mastery.js';
import { specialCost } from '../src/game/combat-passives.js';
import { SKILL_MAP } from '../src/game/special.js';

const T = Date.parse('2026-11-04T00:00:00Z'), DAY = 86400000;
const IDS = ['18801', '18802', '18803'];
const changes = env => env.DB.sqlite.prepare('SELECT total_changes() AS n').get().n;
const stable = env => ({ changes: changes(env), data: gameplaySnapshot(env.DB) });

async function fixture(t) {
  const env = { DB: freshDb() };
  t.after(() => env.DB.sqlite.close());
  for (const [index, tgId] of IDS.entries()) {
    await P.createCharacter(env, { tgId, name: '隊員' + index, gender: 'f', baseClass: ['sword', 'mage', 'thief'][index] }, T);
    const special = index === 1
      ? { learned: ['skill_06_2', 'skill_17_2'], loadout: ['skill_06_2', 'skill_17_2'], mastery: { skill_06_2: 5 }, cooldowns: {} }
      : { learned: [], loadout: [], cooldowns: {} };
    env.DB.sqlite.prepare('UPDATE rpg_characters SET level=120,class_path=?,last_settle_at=?,special_json=? WHERE tg_id=?')
      .run(index === 1 ? 'B11' : 'A11', T, JSON.stringify(special), tgId);
    const player = await loadPlayer(env.DB, tgId), stats = computeStats(player.char, player.equipment.filter(item => item.is_equipped));
    env.DB.sqlite.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp, stats.maxMp, tgId);
  }
  return env;
}

async function combat(env, dungeonId = 'pillar') {
  const id = (await G.create(env, IDS[0], { kind: 'dungeon', dungeonId }, T)).party.id;
  for (const tg of IDS.slice(1)) await G.action(env, tg, { partyId: id, op: 'join' }, T);
  for (const tg of IDS) await G.action(env, tg, { partyId: id, op: 'ready' }, T);
  await G.action(env, IDS[0], { partyId: id, op: 'start' }, T);
  return id;
}

function saved(env, id) {
  const row = env.DB.sqlite.prepare('SELECT * FROM rpg_parties WHERE id=?').get(id);
  return { ...row, state: JSON.parse(row.state_json) };
}

function setState(env, id, change, status = null) {
  const party = saved(env, id);
  change(party.state);
  env.DB.sqlite.prepare('UPDATE rpg_parties SET state_json=?,status=? WHERE id=?').run(JSON.stringify(party.state), status || party.status, id);
}

function seed(env, id, { status = 'lobby', kind = 'dungeon', at = T, endAt = null, expires = T + 600000, member = IDS[0] } = {}) {
  const state = {
    name: '<隊伍>' + id, dungeonId: 'pillar', level: 30, map: 2, trial: null,
    floor: 1, startFloor: 1, round: 1, deadline: T + 5000,
    actors: [], actions: {}, log: [], rewarded: [], ...(endAt == null ? {} : { endedAt: endAt }),
  };
  env.DB.sqlite.prepare('INSERT INTO rpg_parties(id,leader_id,kind,status,state_json,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, member, kind, status, JSON.stringify(state), at, at, expires);
  env.DB.sqlite.prepare('INSERT INTO rpg_party_members(party_id,char_id,account_id,joined_at) VALUES(?,?,?,?)').run(id, member, member, at);
}

test('party snapshot shares the legacy projection, while due scene reads never advance; the existing sweep advances independently', async t => {
  const env = await fixture(t), id = await combat(env);
  const projected = await G.snapshot(env, id, IDS[1], T + 1), original = await G.view(env, id, IDS[1], T + 1);
  const { expired, pendingSettlement, nextSettlementAt, ...same } = projected;
  delete same.me.submission;
  assert.deepEqual(same, original);
  assert.equal(expired, false); assert.equal(pendingSettlement, false); assert.equal(nextSettlementAt, T + 5000);
  const before = stable(env), initial = saved(env, id), late = T + 5001;
  for (let i = 0; i < 3; i++) {
    const result = await view(env, IDS[1], { partyId: id }, late);
    assert.equal(result.party.pendingSettlement, true);
    assert.equal(result.party.round, 1); assert.equal(result.party.rev, initial.rev);
    assert.equal(result.characterId, IDS[1]); assert.equal(result.accountId, IDS[1]);
  }
  assert.deepEqual(stable(env), before);
  await G.sweep(env, late);
  const after = await view(env, IDS[1], { partyId: id }, late);
  assert.ok(after.party.round > initial.state.round || after.party.status !== 'combat');
  assert.ok(after.party.rev > initial.rev);
  assert.equal(after.party.pendingSettlement, false);
});

test('an expired current lobby stays visible without cleanup and disappears only after the existing scheduler writes', async t => {
  const env = await fixture(t), id = (await G.create(env, IDS[0], { kind: 'dungeon', dungeonId: 'pillar' }, T)).party.id;
  const late = T + 600001, before = stable(env);
  const result = await view(env, IDS[0], {}, late);
  assert.equal(result.active.id, id); assert.equal(result.party.status, 'lobby');
  assert.equal(result.party.expired, true); assert.equal(result.party.pendingSettlement, true);
  assert.equal(result.directory.total, 0); assert.equal(result.canCreate, false);
  assert.deepEqual(stable(env), before);
  await G.sweep(env, late);
  const after = await view(env, IDS[0], {}, late);
  assert.equal(after.active, null); assert.equal(after.history[0].status, 'ended');
  assert.equal(after.canCreate, true);
});

test('won results do not grant or invent rewards; an explicit claim retains the authoritative idempotent receipt', async t => {
  const env = await fixture(t), id = await combat(env);
  setState(env, id, state => { state.endedAt = T + 1; state.actors.forEach(actor => { actor.actions = 1; }); }, 'won');
  const before = stable(env), result = await view(env, IDS[1], { partyId: id }, T + 2);
  assert.equal(result.party.canReward, true); assert.equal(result.party.me.reward, null);
  assert.ok(result.drops.every(drop => drop.received === false && Object.keys(drop.items).length === 0));
  assert.deepEqual(stable(env), before);
  const claimed = await G.reward(env, IDS[1], { partyId: id, requestId: 'scene-claim-once' }, T + 2);
  const claimState = stable(env);
  const projected = await view(env, IDS[1], { partyId: id }, T + 3);
  assert.equal(projected.party.canReward, false);
  assert.deepEqual(projected.party.me.reward, claimed.reward);
  assert.equal(projected.drops.find(drop => drop.characterId === IDS[1]).received, true);
  assert.deepEqual(stable(env), claimState);
  const again = await G.reward(env, IDS[1], { partyId: id, requestId: 'scene-claim-once' }, T + 3);
  assert.deepEqual(again.reward, claimed.reward); assert.deepEqual(stable(env), claimState);
});

test('directory paging reaches every dungeon, excludes other modes and expired lobbies, and exposes only public member fields', async t => {
  const env = await fixture(t);
  for (let i = 0; i < 45; i++) seed(env, 'page-' + i, { at: T - i, status: i % 2 ? 'combat' : 'lobby' });
  seed(env, 'tower-excluded', { kind: 'tower' }); seed(env, 'expired-excluded', { expires: T });
  const before = stable(env), seen = new Set();
  for (let page = 1; page <= 3; page++) {
    const result = await view(env, IDS[2], { page }, T);
    assert.equal(result.directory.total, 45); assert.equal(result.directory.pages, 3);
    assert.equal(result.directory.page, page);
    for (const party of result.directory.parties) {
      assert.equal(party.kind, 'dungeon'); assert.equal(party.mine, false); seen.add(party.id);
      assert.ok(!('account_id' in party.members[0])); assert.ok(!('special_json' in party.members[0]));
    }
  }
  assert.equal(seen.size, 45); assert.deepEqual(stable(env), before);
  const last = await view(env, IDS[2], { page: 999999 }, T);
  assert.equal(last.directory.page, 3);
  await assert.rejects(view(env, IDS[2], { partyId: 'tower-excluded' }, T), error => error.code === 'party_scope');
  assert.deepEqual(stable(env), before);
});

test('the seven-day boundary follows actual endedAt, while an owner may still read their older history', async t => {
  const env = await fixture(t);
  seed(env, 'edge', { status: 'won', at: T - 7 * DAY, endAt: T - 7 * DAY });
  seed(env, 'old', { status: 'ended', at: T, endAt: T - 7 * DAY - 1 });
  seed(env, 'new', { status: 'lost', at: T, endAt: T - DAY });
  const before = stable(env), result = await view(env, IDS[2], { tab: 'ended' }, T);
  assert.deepEqual(result.directory.parties.map(party => party.id), ['new', 'edge']);
  const edge = await view(env, IDS[2], { partyId: 'edge' }, T);
  assert.equal(edge.party.me, null); assert.equal(edge.party.canReward, false);
  assert.ok(!('chatId' in edge.party) && !('messageId' in edge.party));
  await assert.rejects(view(env, IDS[2], { partyId: 'old' }, T), error => error.code === 'hall_expired');
  assert.equal((await view(env, IDS[0], { partyId: 'old' }, T)).party.id, 'old');
  assert.deepEqual(stable(env), before);
});

test('party skill costs and cooldowns use the departure actor, and pure reads reveal the exact queued teammate selection', async t => {
  const env = await fixture(t), id = await combat(env);
  setState(env, id, state => {
    const actor = state.actors.find(actor => actor.id === IDS[1]);
    actor.affixPct = { mpCostPct: .5, skillHastePct: .2 };
    actor.special.mastery.skill_06_2 = 8;
    actor.special.cooldowns.skill_17_2 = T + 60000;
  });
  env.DB.sqlite.prepare('UPDATE rpg_characters SET special_json=? WHERE tg_id=?')
    .run(JSON.stringify({ learned: [], loadout: [], mastery: {}, cooldowns: {} }), IDS[1]);
  const submitted = await G.action(env, IDS[1], { partyId: id, op: 'submit', round: 1, skillId: 'skill_06_2', targetId: IDS[0], requestId: 'scene-target-shield' }, T + 1);
  const before = stable(env), result = await view(env, IDS[1], { partyId: id }, T + 2);
  assert.deepEqual(result.party.me.submission, { skillId: 'skill_06_2', targetId: IDS[0], manual: true, round: 1 });
  assert.equal(result.party.rev, submitted.party.rev);
  const actor = result.party.me.actor, expected = specialCost(masteredSkill(SKILL_MAP.skill_06_2, actor.special), actor.affixPct);
  const skill = result.skills.find(skill => skill.id === 'skill_06_2');
  assert.equal(skill.mp, expected.mp); assert.equal(skill.cooldownSeconds, expected.cooldownSeconds);
  assert.equal(skill.mastery.level, expected.mastery.level); assert.equal(skill.target, 'ally');
  assert.equal(result.skills.find(skill => skill.id === 'skill_24_2').target, 'downed_ally');
  assert.equal(result.skills.find(skill => skill.id === 'skill_09_1').target, 'auto_ally');
  assert.equal(result.skills.find(skill => skill.id === 'skill_09_2').target, 'all_allies');
  assert.equal(result.skills.find(skill => skill.id === 'skill_02_2').target, 'ally');
  assert.deepEqual(stable(env), before);
});

test('trial catalog and real cooperation roles are preserved without adding tower or expedition entry points', async t => {
  const env = await fixture(t), id = await combat(env, 'trial4'), before = stable(env);
  const result = await view(env, IDS[1], { partyId: id }, T + 1);
  assert.equal(result.dungeons.length, 9);
  assert.deepEqual(result.dungeons.filter(dungeon => dungeon.trial).map(dungeon => dungeon.id), ['trial3', 'trial4']);
  assert.equal(result.party.trial, 4); assert.ok(result.party.briefing.ready);
  assert.ok(result.party.me.roleSkills.some(skill => skill.role === 'aid'));
  assert.ok(result.party.me.roleSkills.some(skill => skill.role === 'control'));
  assert.equal(result.party.roundSeconds, 15);
  assert.deepEqual(stable(env), before);
});

test('read-only worlds and occupied accounts expose accurate create blockers while remaining SELECT-only', async t => {
  const env = await fixture(t);
  seed(env, 'own-tower', { kind: 'tower' });
  env.DB.sqlite.prepare('INSERT INTO rpg_party_presence(account_id,party_id,char_id) VALUES(?,?,?)').run(IDS[0], 'own-tower', IDS[0]);
  const before = stable(env), result = await view(env, IDS[0], {}, T);
  assert.equal(result.active, null); assert.equal(result.canCreate, false);
  assert.equal(result.blockedReason.code, 'party'); assert.match(result.blockedReason.message, /爬塔/);
  const frozen = await view({ ...env, REALM_CONTEXT: { id: 'season_fixture', phase: 'FREEZE' } }, IDS[0], {}, T);
  assert.equal(frozen.readOnly, true); assert.equal(frozen.realmId, 'season_fixture');
  assert.equal(frozen.blockedReason.code, 'realm_read_only');
  assert.ok(frozen.dungeons.every(dungeon => !dungeon.canCreate));
  assert.deepEqual(stable(env), before);
});

test('Atlas ownership and level/trial requirements are projected without settling the character', async t => {
  const env = await fixture(t);
  env.DB.sqlite.prepare('UPDATE rpg_characters SET level=25,class_path=? WHERE tg_id=?').run('', IDS[0]);
  let before = stable(env), result = await view(env, IDS[0], {}, T + DAY);
  assert.equal(result.canCreate, true); assert.ok(result.dungeons.every(dungeon => !dungeon.canCreate));
  assert.ok(result.dungeons.every(dungeon => dungeon.reason.code === 'level'));
  assert.deepEqual(stable(env), before);
  env.DB.sqlite.prepare('UPDATE rpg_characters SET level=120,class_path=?,atlas_run_id=? WHERE tg_id=?').run('A', 'atlas-fixture', IDS[0]);
  before = stable(env); result = await view(env, IDS[0], {}, T + DAY);
  assert.equal(result.canCreate, false); assert.equal(result.blockedReason.code, 'atlas_active');
  assert.deepEqual(stable(env), before);
  env.DB.sqlite.prepare('UPDATE rpg_characters SET atlas_run_id=NULL WHERE tg_id=?').run(IDS[0]);
  before = stable(env); result = await view(env, IDS[0], {}, T + DAY);
  assert.equal(result.dungeons.find(dungeon => dungeon.id === 'trial3').reason.code, 'trial');
  assert.equal(result.dungeons.find(dungeon => dungeon.id === 'pillar').canCreate, true);
  assert.deepEqual(stable(env), before);
});

test('party scene issues only SELECT statements, including detailed rewards, and invalid inputs do not initialize state', async t => {
  const env = await fixture(t);
  seed(env, 'read-proof', { status: 'won' });
  env.DB.sqlite.prepare('INSERT INTO rpg_party_rewards(party_id,char_id,reward_json,created_at) VALUES(?,?,?,?)')
    .run('read-proof', IDS[0], JSON.stringify({ items: { research_fragment: 8, invalid: -2, wrong: '5' } }), T);
  const queries = [], raw = env.DB, readonly = {
    prepare(sql) { assert.match(sql, /^SELECT\b/i); queries.push(sql); return raw.prepare(sql); },
    batch(statements) { return raw.batch(statements); },
  };
  const before = stable(env), result = await view({ ...env, DB: readonly }, IDS[2], { partyId: 'read-proof' }, T + DAY);
  assert.ok(queries.length > 5);
  assert.deepEqual(result.drops[0].items, { research_fragment: 8 });
  await assert.rejects(view(env, 'missing', {}, T), error => error.code === 'no_character');
  for (const body of [{ partyId: '' }, { partyId: 3 }, { partyId: 'p'.repeat(129) }, { sinceTurnId: 3 }])
    await assert.rejects(view(env, IDS[0], body, T), error => error.code === 'party');
  assert.deepEqual(stable(env), before);
});

test('one account cannot take two lobby seats, and departure requires three valid account seats', async t => {
  const env = await fixture(t);
  await P.createCharacter(env, { tgId: IDS[0], charSlot: 2, name: '同帳號候補', gender: 'm', baseClass: 'mage' }, T);
  const sibling = env.DB.sqlite.prepare('SELECT tg_id FROM rpg_live_characters WHERE account_tg_id=? AND char_slot=2').get(IDS[0]).tg_id;
  env.DB.sqlite.prepare('UPDATE rpg_characters SET level=120,class_path=? WHERE tg_id=?').run('B11', sibling);
  const id = (await G.create(env, IDS[0], { kind: 'dungeon', dungeonId: 'pillar' }, T)).party.id;
  await assert.rejects(G.action(env, sibling, { partyId: id, op: 'join', requestId: 'same-account-seat' }, T));
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM rpg_party_members WHERE party_id=?').get(id).n, 1);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM rpg_party_presence WHERE account_id=?').get(IDS[0]).n, 1);
  await G.action(env, IDS[2], { partyId: id, op: 'join' }, T);
  // The database independently prevents a second seat for an existing account.
  assert.throws(() => env.DB.sqlite.prepare('INSERT INTO rpg_party_members(party_id,char_id,account_id,joined_at) VALUES(?,?,?,?)').run(id, sibling, IDS[0], T), /UNIQUE constraint/);
  env.DB.sqlite.prepare('UPDATE rpg_party_members SET ready=1 WHERE party_id=?').run(id);
  const before = stable(env);
  await assert.rejects(G.action(env, IDS[0], { partyId: id, op: 'start', requestId: 'same-account-start' }, T), error => error.code === 'ready');
  assert.equal(saved(env, id).status, 'lobby'); assert.deepEqual(stable(env), before);
});

test('all skill target groups follow the existing mechanical target rules, with explicit self and enemy choices', async t => {
  const env = await fixture(t), result = await view(env, IDS[1], {}, T);
  const expected = {
    ally: ['skill_02_2','skill_03_3','skill_04_2','skill_06_2','skill_10_1','skill_16_2','skill_17_2','skill_18_2'],
    downed_ally: ['skill_24_2'],
    all_allies: ['skill_09_2','skill_12_2','skill_13_2','skill_19_2','skill_20_2','skill_21_2','skill_22_2','skill_23_2'],
    auto_ally: ['skill_09_1','skill_13_1'],
  };
  for (const [target, ids] of Object.entries(expected)) {
    assert.deepEqual(result.skills.filter(skill => skill.target === target).map(skill => skill.id).sort(), ids.sort(), target);
  }
  for (const id of ['skill_01_2', 'skill_02_3', 'skill_07_2', 'skill_11_2'])
    assert.equal(result.skills.find(skill => skill.id === id).target, 'self', id);
  for (const id of ['skill_01_1', 'skill_03_1', 'skill_05_1', 'skill_18_1', 'skill_24_1'])
    assert.equal(result.skills.find(skill => skill.id === id).target, 'enemy', id);
  assert.ok(result.skills.every(skill => ['ally','downed_ally','all_allies','auto_ally','self','enemy'].includes(skill.target)));
});

test('dungeon book previews use the authoritative pool, preserving legacy jobs and legal thief branches with high-level fallback', async t => {
  const env = await fixture(t);
  let before = stable(env);
  const legacy = await view(env, IDS[0], {}, T);
  assert.deepEqual(legacy.dungeons.find(dungeon => dungeon.id === 'pillar').dropSkillIds, ['skill_01_1','skill_02_1','skill_03_1','skill_04_1','skill_05_1','skill_06_1']);
  assert.ok(legacy.dungeons.every(dungeon => dungeon.dropSkillIds.every(id => !id.startsWith('skill_thief_'))));
  assert.ok(legacy.dungeons.filter(dungeon => dungeon.trial).every(dungeon => dungeon.dropSkillIds.length === 0));
  assert.deepEqual(stable(env), before);
  for (const [path, branchBook] of [['A11','skill_thief_03'],['A21','skill_thief_04'],['B11','skill_thief_05'],['B21','skill_thief_06']]) {
    env.DB.sqlite.prepare('UPDATE rpg_characters SET class_path=? WHERE tg_id=?').run(path, IDS[2]);
    before = stable(env);
    const result = await view(env, IDS[2], {}, T);
    const pool = id => result.dungeons.find(dungeon => dungeon.id === id).dropSkillIds;
    assert.deepEqual(pool('pillar'), ['skill_thief_01']);
    assert.deepEqual(pool('aegean'), ['skill_thief_02']);
    assert.deepEqual(pool('forge'), [branchBook]);
    assert.deepEqual(pool('river'), ['skill_thief_01','skill_thief_02',branchBook]);
    assert.deepEqual(pool('stars'), ['skill_thief_01','skill_thief_02',branchBook]);
    assert.deepEqual(pool('trial3'), []); assert.deepEqual(pool('trial4'), []);
    assert.deepEqual(stable(env), before);
  }
});

test('ineligible saved loadouts remain visible and are classified from the departure actor, never from a newer live character branch', async t => {
  const env = await fixture(t);
  const initial = await view(env, IDS[1], {}, T);
  assert.equal(initial.skills.find(skill => skill.id === 'skill_06_2').eligible, true);
  assert.equal(initial.skills.find(skill => skill.id === 'skill_05_1').eligible, false);
  const id = await combat(env);
  setState(env, id, state => {
    const actor = state.actors.find(actor => actor.id === IDS[1]);
    actor.special.learned.push('skill_05_1');
    actor.special.loadout = ['skill_06_2','skill_05_1'];
  });
  env.DB.sqlite.prepare('UPDATE rpg_characters SET class_path=? WHERE tg_id=?').run('A11', IDS[1]);
  const before = stable(env), result = await view(env, IDS[1], { partyId: id }, T + 1);
  assert.equal(result.character.classPath, 'A11'); assert.equal(result.party.me.actor.path, 'B11');
  assert.deepEqual(result.party.me.actor.special.loadout, ['skill_06_2','skill_05_1']);
  assert.ok(result.party.me.actor.special.learned.includes('skill_05_1'));
  assert.equal(result.skills.find(skill => skill.id === 'skill_06_2').eligible, true);
  assert.equal(result.skills.find(skill => skill.id === 'skill_17_2').eligible, true);
  assert.equal(result.skills.find(skill => skill.id === 'skill_05_1').eligible, false);
  assert.equal(result.skills.find(skill => skill.id === 'skill_24_2').eligible, false);
  assert.deepEqual(stable(env), before);
});
