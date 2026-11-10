import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { gameplaySnapshot } from './realm-test-helpers.js';
import * as P from '../src/services/player.js';
import * as G from '../src/services/party.js';
import * as TOWER from '../src/services/tower.js';
import { view } from '../src/services/tower-scene.js';
import { view as dungeonView } from '../src/services/party-scene.js';
import { view as receipt } from '../src/services/tower-receipt.js';
import { loadPlayer, insertEquipStmt } from '../src/db.js';
import { computeStats, itemStat } from '../src/game/stats.js';
import { makeGear } from '../src/game/gear.js';
import { withImprint } from '../src/game/tower-progression.js';

const T = Date.parse('2026-11-04T15:59:40Z'), DAY = 86400000;
const IDS = ['19001', '19002', '19003'];
const stable = env => ({
  changes: env.DB.sqlite.prepare('SELECT total_changes() AS n').get().n,
  data: gameplaySnapshot(env.DB),
});
async function fixture(t) {
  const env = { DB: freshDb() };
  t.after(() => env.DB.sqlite.close());
  for (const [i, tgId] of IDS.entries()) {
    await P.createCharacter(env, { tgId, name: '登塔隊員' + i, gender: 'f', baseClass: ['sword', 'archer', 'mage'][i] }, T);
    const special = { towerBest: 20, learned: i === 2 ? ['skill_06_2'] : [], loadout: i === 2 ? ['skill_06_2'] : [], mastery: {}, cooldowns: {} };
    env.DB.sqlite.prepare('UPDATE rpg_characters SET level=120,class_path=?,last_settle_at=?,special_json=? WHERE tg_id=?')
      .run(['B21', 'A11', 'B11'][i], T, JSON.stringify(special), tgId);
    const p = await loadPlayer(env.DB, tgId), stats = computeStats(p.char, p.equipment.filter(item => item.is_equipped));
    env.DB.sqlite.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp, stats.maxMp, tgId);
  }
  return env;
}
async function combat(env, startFloor = 1, now = T) {
  const id = (await G.create(env, IDS[0], { kind: 'tower', startFloor }, now)).party.id;
  for (const tg of IDS.slice(1)) await G.action(env, tg, { partyId: id, op: 'join' }, now);
  for (const tg of IDS) await G.action(env, tg, { partyId: id, op: 'ready' }, now);
  await G.action(env, IDS[0], { partyId: id, op: 'start' }, now);
  return id;
}
function saved(env, id) {
  const row = env.DB.sqlite.prepare('SELECT * FROM rpg_parties WHERE id=?').get(id);
  return { ...row, state: JSON.parse(row.state_json) };
}
function setState(env, id, change, status = null) {
  const p = saved(env, id);
  change(p.state);
  env.DB.sqlite.prepare('UPDATE rpg_parties SET state_json=?,status=? WHERE id=?')
    .run(JSON.stringify(p.state), status || p.status, id);
}
function badges(env, quantity, tg = IDS[0]) {
  env.DB.sqlite.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'tower_fragment',?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity").run(tg, quantity);
}
async function gear(env, id, extra = {}) {
  const item = { ...makeGear({ id, tgId: IDS[0], cls: 'sword', slot: 'helmet', tier: 7, forceRarity: 'legendary', rng: () => .5, now: T }), ...extra };
  await insertEquipStmt(env.DB, item).run();
  return item;
}
function seed(env, id, { kind = 'tower', status = 'lobby', at = T, endAt = null, expires = T + 600000, member = IDS[0], startFloor = 1 } = {}) {
  const state = { name: '塔隊' + id, dungeonId: 'pillar', level: 30 + (startFloor - 1) * 3, map: 2,
    towerVersion: 2, clearedFloor: startFloor - 1, floor: startFloor, startFloor, round: 1,
    actors: [], actions: {}, log: [], rewarded: [], ...(endAt == null ? {} : { endedAt: endAt }) };
  env.DB.sqlite.prepare('INSERT INTO rpg_parties(id,leader_id,kind,status,state_json,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, member, kind, status, JSON.stringify(state), at, at, expires);
  env.DB.sqlite.prepare('INSERT INTO rpg_party_members(party_id,char_id,account_id,joined_at) VALUES(?,?,?,?)').run(id, member, member, at);
}
function readOnly(env) {
  return { ...env, DB: new Proxy(env.DB, { get(target, key) {
    if (key === 'prepare') return sql => { assert.match(sql, /^\s*SELECT\b/i, sql); return target.prepare(sql); };
    if (key === 'batch') return statements => {
      for (const statement of statements) assert.match(statement.sql, /^\s*SELECT\b/i, statement.sql);
      return target.batch(statements);
    };
    if (key === 'exec') return () => { throw Error('Unexpected write path'); };
    return Reflect.get(target, key);
  } }) };
}

test('tower scene uses SELECT-only committed player, daily and workshop data without idle settlement', async t => {
  const env = await fixture(t); badges(env, 100);
  const before = stable(env), result = await view(readOnly(env), IDS[0], {}, T + 8 * 3600000);
  assert.equal(result.ok, true); assert.equal(result.characterId, IDS[0]); assert.equal(result.accountId, IDS[0]);
  assert.equal(result.character.rev, (await loadPlayer(env.DB, IDS[0])).char.rev);
  assert.equal(result.tower.badges, 100); assert.equal(result.tower.daily.used, false);
  assert.deepEqual(result.tower.areas.map(a => [a.startFloor, a.endFloor, a.level, a.requiredBest, a.fullClearBadges]), [[1, 10, 30, 0, 10], [11, 20, 60, 10, 15], [21, 30, 90, 20, 20]]);
  assert.equal(result.tower.rules.durationMs, 900000); assert.equal(result.tower.canOperate, true);
  assert.ok(!('scene' in result)); assert.ok(!('dungeons' in result)); assert.ok(result.skills.length > 0);
  assert.deepEqual(stable(env), before);
});

test('tower scene directory stays tower-only and every page remains reachable; own old history can still be read', async t => {
  const env = await fixture(t);
  for (let i = 0; i < 25; i++) seed(env, 'tower-' + String(i).padStart(2, '0'));
  seed(env, 'dungeon-hidden', { kind: 'dungeon' });
  seed(env, 'old-own', { status: 'ended', at: T - 9 * DAY, endAt: T - 8 * DAY });
  const before = stable(env);
  const first = await view(env, IDS[0], { kind: 'dungeon' }, T), second = await view(env, IDS[0], { page: 2 }, T);
  assert.equal(first.directory.total, 25); assert.equal(first.directory.pages, 2);
  assert.equal(first.directory.parties.length, 20); assert.equal(second.directory.parties.length, 5);
  assert.equal(new Set([...first.directory.parties, ...second.directory.parties].map(p => p.id)).size, 25);
  assert.ok(first.directory.parties.every(p => p.kind === 'tower'));
  assert.equal((await view(env, IDS[0], { partyId: 'old-own' }, T)).party.id, 'old-own');
  assert.equal((await view(env, IDS[0], { tab: 'ended' }, T)).directory.total, 0);
  await assert.rejects(view(env, IDS[1], { partyId: 'old-own' }, T), e => e.code === 'hall_expired');
  await assert.rejects(view(env, IDS[0], { partyId: 'dungeon-hidden' }, T), e => e.code === 'party_scope');
  await assert.rejects(dungeonView(env, IDS[0], { kind: 'tower', partyId: 'tower-00' }, T), e => e.code === 'party_scope');
  assert.deepEqual(stable(env), before);
});

test('due combat and actor strategy are read without advancing; the original sweep owns progression', async t => {
  const env = await fixture(t), id = await combat(env);
  await G.action(env, IDS[2], { partyId: id, op: 'submit', round: 1, skillId: 'defend', requestId: 'one-turn' }, T + 1);
  const initial = saved(env, id), before = stable(env);
  for (let i = 0; i < 3; i++) {
    const r = await view(readOnly(env), IDS[2], { partyId: id }, T + 5001);
    assert.equal(r.party.pendingSettlement, true); assert.equal(r.party.round, 1); assert.equal(r.party.rev, initial.rev);
    assert.equal(r.party.me.submission.skillId, 'defend'); assert.equal(r.party.canReward, false);
    assert.equal(r.skills.find(s => s.id === 'skill_06_2').target, 'ally');
  }
  assert.deepEqual(stable(env), before);
  await G.sweep(env, T + 5001);
  const after = await view(env, IDS[2], { partyId: id }, T + 5001);
  assert.ok(after.party.round > 1 || after.party.floor > 1 || after.party.status !== 'combat');
  assert.ok(after.party.rev > initial.rev);
});

test('expired recruiting tower remains visible without cleanup or daily charge until the original sweep', async t => {
  const env = await fixture(t), id = (await G.create(env, IDS[0], { kind: 'tower' }, T)).party.id;
  const before = stable(env), r = await view(env, IDS[0], { partyId: id }, T + 600001);
  assert.equal(r.party.status, 'lobby'); assert.equal(r.party.expired, true); assert.equal(r.party.pendingSettlement, true);
  assert.equal(r.tower.daily.used, false); assert.equal(r.directory.total, 0); assert.deepEqual(stable(env), before);
  await G.sweep(env, T + 600001);
  const after = await view(env, IDS[0], { partyId: id }, T + 600001);
  assert.equal(after.party.status, 'ended'); assert.equal(after.party.canReward, false); assert.equal(after.tower.daily.used, false);
});

for (const status of ['lost', 'ended']) test('v2 ' + status + ' exposes actual partial reward without granting and original reward cannot pay twice', async t => {
  const env = await fixture(t), id = await combat(env, 11);
  setState(env, id, s => { s.floor = 16; s.clearedFloor = 15; s.endedAt = T + 4000; s.actors.forEach((a, i) => { a.actions = i === 1 ? 0 : 1; }); }, status);
  const before = stable(env), r = await view(readOnly(env), IDS[0], { partyId: id }, T + 4001);
  assert.equal(r.party.status, status); assert.equal(r.party.towerProgress.cleared, 5);
  assert.equal(r.party.towerProgress.badges, 7); assert.equal(r.party.towerProgress.rewardable, true);
  assert.equal(r.party.canReward, true); assert.ok(r.drops.every(d => !d.received));
  const observer = await view(env, IDS[1], { partyId: id }, T + 4001);
  assert.equal(observer.party.canReward, false); assert.equal(observer.party.rewardReason.code, 'participation');
  assert.deepEqual(stable(env), before);
  await G.reward(env, IDS[0], { partyId: id, requestId: 'partial-once' }, T + 4001);
  const paid = (await loadPlayer(env.DB, IDS[0])).inv.tower_fragment;
  assert.equal(paid, 7);
  await G.reward(env, IDS[0], { partyId: id, requestId: 'partial-again' }, T + 4001);
  assert.equal((await loadPlayer(env.DB, IDS[0])).inv.tower_fragment, paid);
  const final = await view(env, IDS[0], { partyId: id }, T + 4001);
  assert.equal(final.party.me.rewarded, true); assert.equal(final.party.canReward, false);
  assert.equal(final.drops.find(d => d.characterId === IDS[0]).items.tower_fragment, 7);
});

test('legacy tower rewards remain won-only and keep their original ten badges even in a higher area', async t => {
  const env = await fixture(t), id = await combat(env, 11);
  setState(env, id, s => { delete s.towerVersion; delete s.challengeEndsAt; s.clearedFloor = 15; s.actors.forEach(a => { a.actions = 1; }); }, 'lost');
  const before = stable(env), lost = await view(env, IDS[0], { partyId: id }, T + 1);
  assert.equal(lost.party.towerProgress.version, 1); assert.equal(lost.party.canReward, false);
  assert.equal(lost.party.towerProgress.badges, 0); assert.deepEqual(stable(env), before);
  setState(env, id, s => { s.floor = 20; }, 'won');
  const beforeWon = stable(env), won = await view(env, IDS[0], { partyId: id }, T + 1);
  assert.equal(won.party.canReward, true); assert.equal(won.party.towerProgress.badges, 10); assert.deepEqual(stable(env), beforeWon);
  await G.reward(env, IDS[0], { partyId: id }, T + 1);
  assert.equal((await loadPlayer(env.DB, IDS[0])).inv.tower_fragment, 10);
});

test('three-area level and previous-clear gates match original admissions and selected-team join eligibility', async t => {
  const env = await fixture(t); seed(env, 'high-lobby', { member: IDS[1], startFloor: 21 });
  const change = (level, best) => env.DB.sqlite.prepare('UPDATE rpg_characters SET level=?,special_json=? WHERE tg_id=?').run(level, JSON.stringify({ towerBest: best }), IDS[0]);
  for (const [level, best, available, codes] of [[29, 20, [false, false, false], ['level', 'level', 'level']], [30, 0, [true, false, false], [null, 'level', 'level']], [60, 0, [true, false, false], [null, 'tower', 'level']], [60, 10, [true, true, false], [null, null, 'level']], [90, 19, [true, true, false], [null, null, 'tower']], [90, 20, [true, true, true], [null, null, null]]]) {
    change(level, best);
    const before = stable(env), r = await view(env, IDS[0], { partyId: 'high-lobby' }, T);
    assert.deepEqual(r.tower.areas.map(a => a.canCreate), available); assert.deepEqual(r.tower.areas.map(a => a.reason?.code || null), codes);
    assert.equal(r.party.canJoin, available[2]); assert.equal(r.directory.parties.find(p => p.id === 'high-lobby').canJoin, available[2]);
    assert.deepEqual(stable(env), before);
  }
  change(60, 0);
  await assert.rejects(G.create(env, IDS[0], { kind: 'tower', startFloor: 11 }, T), e => e.code === 'tower');
});

test('daily usage changes on real departure, is per character, and resets exactly at Taipei midnight', async t => {
  const env = await fixture(t), lobby = (await G.create(env, IDS[0], { kind: 'tower' }, T)).party.id;
  assert.equal((await view(env, IDS[0], {}, T)).tower.daily.used, false);
  await G.action(env, IDS[0], { partyId: lobby, op: 'leave' }, T);
  const id = await combat(env, 1, T + 1);
  const used = await view(env, IDS[0], {}, T + 2), reset = Date.parse('2026-11-04T16:00:00Z');
  assert.equal(used.tower.daily.used, true); assert.equal(used.tower.daily.resetAt, reset); assert.equal(used.tower.daily.day, '2026-11-04');
  await G.action(env, IDS[0], { partyId: id, op: 'end' }, T + 3);
  const before = stable(env), beforeReset = await view(env, IDS[0], {}, reset - 1), afterReset = await view(env, IDS[0], {}, reset);
  assert.equal(beforeReset.canCreate, false); assert.equal(beforeReset.blockedReason.code, 'tower_daily');
  assert.equal(afterReset.tower.daily.used, false); assert.equal(afterReset.canCreate, true);
  assert.equal(afterReset.tower.daily.resetAt, reset + DAY); assert.deepEqual(stable(env), before);
});

test('fifteen-minute cutoff is only observed by scene; original sweep grants real completed floors without future turns', async t => {
  const env = await fixture(t), id = await combat(env);
  setState(env, id, s => { s.floor = 7; s.clearedFloor = 6; s.deadline = T + 905000; s.actors.forEach(a => { a.actions = 1; }); });
  const before = stable(env), sequence = saved(env, id).state.turnSequence;
  const pending = await view(env, IDS[0], { partyId: id }, T + 900000);
  assert.equal(pending.party.status, 'combat'); assert.equal(pending.party.pendingSettlement, true);
  assert.equal(pending.party.canReward, false); assert.equal(pending.party.towerProgress.badges, 6);
  assert.deepEqual(stable(env), before);
  await G.sweep(env, T + 900000);
  const completed = await view(env, IDS[0], { partyId: id }, T + 900000);
  assert.equal(completed.party.status, 'ended'); assert.equal(completed.party.me.reward.items.tower_fragment, 6);
  assert.equal(saved(env, id).state.turnSequence, sequence); assert.equal(saved(env, id).state.endedAt, T + 900000);
});

test('cross-kind occupancy is visible and does not broaden either scene endpoint', async t => {
  const env = await fixture(t), dungeon = (await G.create(env, IDS[0], { kind: 'dungeon', dungeonId: 'pillar' }, T)).party.id;
  let before = stable(env), tower = await view(env, IDS[0], {}, T);
  assert.equal(tower.active, null); assert.equal(tower.party, null); assert.equal(tower.canCreate, false);
  assert.deepEqual(tower.activeOtherKind, { id: dungeon, kind: 'dungeon', status: 'lobby', characterId: IDS[0], ownCharacter: true });
  assert.equal(tower.blockedReason.code, 'party'); assert.equal((await dungeonView(env, IDS[0], {}, T)).active.id, dungeon);
  assert.deepEqual(stable(env), before);
  await G.action(env, IDS[0], { partyId: dungeon, op: 'leave' }, T);
  const towerId = (await G.create(env, IDS[0], { kind: 'tower' }, T)).party.id;
  before = stable(env);
  const other = await dungeonView(env, IDS[0], { kind: 'tower' }, T);
  assert.equal(other.active, null); assert.equal(other.canCreate, false); assert.equal(other.activeOtherKind.id, towerId);
  assert.equal(other.activeOtherKind.kind, 'tower'); assert.ok(other.directory.parties.every(p => p.kind === 'dungeon'));
  assert.deepEqual(stable(env), before);
});

test('workshop exposes actual investment stats and protected equipment without hiding trade or processing items', async t => {
  const env = await fixture(t); badges(env, 1000);
  const invested = await gear(env, 'invested', { enhance_level: 9, bonus_json: JSON.stringify({ towerImprint: 2, expPct: 3, preserved: 'marker' }) });
  await gear(env, 'traded', { trade_id: 'trade-fixture' });
  const busy = await gear(env, 'processing-item');
  await gear(env, 'maxed', { bonus_json: JSON.stringify({ towerImprint: 5 }) });
  env.DB.sqlite.prepare("INSERT INTO rpg_auto_enhance(id,owner,tg_id,item_id,item_name,target,blessed,status,level,next_at,created_at,updated_at) VALUES('tower-processing',?,?,?, ?,10,0,'processing',0,?,?,?)")
    .run(IDS[0], IDS[0], busy.id, busy.name, T, T, T);
  const before = stable(env), r = await view(readOnly(env), IDS[0], {}, T);
  const selected = r.tower.equipment.find(item => item.id === invested.id);
  assert.equal(selected.enhance, 9); assert.equal(selected.stat, itemStat(invested, 'sword').main);
  assert.equal(selected.towerImprint.nextStat, itemStat(withImprint(invested, 3), 'sword').main);
  assert.equal(selected.towerImprint.cost, 45); assert.equal(selected.canImprint, true);
  assert.equal(r.tower.equipment.find(item => item.id === 'traded').imprintReason.code, 'in_trade');
  assert.equal(r.tower.equipment.find(item => item.id === busy.id).imprintReason.code, 'auto_active');
  assert.equal(r.tower.equipment.find(item => item.id === 'maxed').imprintReason.code, 'imprint_max');
  assert.equal(r.tower.equipment.find(item => item.equipped).imprintReason.code, 'equipped');
  assert.deepEqual(stable(env), before);
});

test('workshop follows original lobby access and combat protection; insufficient badges disable only priced actions', async t => {
  const env = await fixture(t); await gear(env, 'available-gear'); badges(env, 19);
  let r = await view(env, IDS[0], {}, T);
  assert.equal(r.tower.canOperate, true); assert.equal(r.tower.offers.find(o => o.id === 'scroll_w').canRedeem, true);
  assert.equal(r.tower.offers.find(o => o.id === 'blessed_scroll_w').reason.code, 'tower_badges');
  assert.equal(r.tower.equipment.find(e => e.id === 'available-gear').imprintReason.code, 'tower_badges');
  const lobby = (await G.create(env, IDS[0], { kind: 'tower' }, T)).party.id;
  assert.equal((await view(env, IDS[0], {}, T)).tower.canOperate, true);
  await G.action(env, IDS[0], { partyId: lobby, op: 'leave' }, T);
  const combatId = await combat(env), before = stable(env);
  r = await view(env, IDS[0], { partyId: combatId }, T + 1);
  assert.equal(r.tower.canOperate, false); assert.equal(r.tower.blockedReason.code, 'party');
  assert.ok(r.tower.equipment.every(e => !e.canImprint)); assert.ok(r.tower.titles.every(e => !e.canEquip));
  assert.deepEqual(stable(env), before);
});

test('frozen realm can read due combat, earned rewards and workshop but advertises no writes', async t => {
  const env = await fixture(t), id = await combat(env);
  setState(env, id, s => { s.clearedFloor = 2; s.actors.forEach(a => { a.actions = 1; }); }, 'ended');
  env.REALM_CONTEXT = { id: 'season_test', phase: 'FREEZE' }; badges(env, 1000);
  const before = stable(env), r = await view(readOnly(env), IDS[0], { partyId: id }, T + 1);
  assert.equal(r.readOnly, true); assert.equal(r.realmId, 'season_test'); assert.equal(r.party.canReward, false);
  assert.equal(r.party.rewardReason.code, 'realm_read_only'); assert.equal(r.tower.canOperate, false);
  assert.ok(r.tower.areas.every(a => !a.canCreate)); assert.ok(r.tower.offers.every(o => !o.canRedeem));
  assert.deepEqual(stable(env), before);
});

test('exact receipt read is pure and not-found permits only explicit retry with the same id and body', async t => {
  const env = await fixture(t); badges(env, 100);
  const body = { requestId: 'manual-recovery', op: 'redeem', offerId: 'scroll_w' };
  let before = stable(env), unknown = await receipt(readOnly(env), IDS[0], body, T + 1);
  assert.equal(unknown.found, false); assert.equal(unknown.result, null); assert.deepEqual(stable(env), before);
  const first = await TOWER.action(env, IDS[0], body, T);
  const after = await loadPlayer(env.DB, IDS[0]), copies = await Promise.all([TOWER.action(env, IDS[0], body, T), TOWER.action(env, IDS[0], body, T)]);
  assert.deepEqual(copies.map(x => x.result), [first.result, first.result]);
  assert.equal((await loadPlayer(env.DB, IDS[0])).inv.tower_fragment, 90);
  assert.equal((await loadPlayer(env.DB, IDS[0])).inv.scroll_w, after.inv.scroll_w);
  before = stable(env);
  const found = await receipt(readOnly(env), IDS[0], body, T + 8 * 3600000);
  assert.equal(found.found, true); assert.deepEqual(found.result, first.result); assert.equal(found.receipt.createdAt, T);
  assert.equal(found.receipt.itemDelta, -10); assert.equal(found.requestId, body.requestId);
  await assert.rejects(receipt(env, IDS[0], { ...body, offerId: 'scroll_a' }, T), e => e.code === 'request_reused');
  assert.deepEqual(stable(env), before);
  await assert.rejects(TOWER.action(env, IDS[0], { ...body, offerId: 'scroll_a' }, T), e => e.code === 'request_reused');
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE event_id=?").get('tower-action:' + IDS[0] + ':' + body.requestId).n, 1);
});

test('receipt honors route-selected app namespace, original raw signature and historical quantities', async t => {
  const env = await fixture(t); badges(env, 100);
  env.DB.sqlite.prepare('UPDATE rpg_characters SET level=30 WHERE tg_id=?').run(IDS[0]);
  const body = { requestId: 'history-receipt', op: 'redeem', offerId: 'scroll_a' };
  const committed = await TOWER.action(env, IDS[0], { ...body, requestId: 'app:' + body.requestId }, T);
  env.DB.sqlite.prepare('UPDATE rpg_characters SET level=120 WHERE tg_id=?').run(IDS[0]);
  const before = stable(env), app = await receipt(env, IDS[0], body, T + DAY, 'app');
  assert.equal(app.found, true); assert.equal(app.result.quantity, committed.result.quantity);
  assert.equal((await receipt(env, IDS[0], body, T, 'service')).found, false);
  await assert.rejects(receipt(env, IDS[0], { ...body, requestId: 'app:' + body.requestId }, T, 'app'), e => e.code === 'tower_receipt_input');
  assert.deepEqual(stable(env), before);
});

test('title removal keeps empty-string signature distinct from null and imprint receipt preserves exact target and step', async t => {
  const env = await fixture(t); badges(env, 100);
  const title = { requestId: 'title-clear', op: 'title', titleId: '' };
  await TOWER.action(env, IDS[0], title, T);
  assert.equal((await receipt(env, IDS[0], title, T)).result.title, null);
  await assert.rejects(receipt(env, IDS[0], { ...title, titleId: null }, T), e => e.code === 'request_reused');
  const item = await gear(env, 'target-imprint', { enhance_level: 9, bonus_json: JSON.stringify({ expPct: 4, preserved: 'yes' }) });
  const body = { requestId: 'imprint-exact', op: 'imprint', itemId: item.id, from: 0 };
  await TOWER.action(env, IDS[0], body, T);
  const before = stable(env), proof = await receipt(env, IDS[0], body, T + DAY);
  assert.equal(proof.result.itemId, item.id); assert.equal(proof.result.from, 0); assert.equal(proof.result.to, 1);
  await assert.rejects(receipt(env, IDS[0], { ...body, from: '0' }, T), e => e.code === 'request_reused');
  assert.deepEqual(stable(env), before);
  const after = (await loadPlayer(env.DB, IDS[0])).equipment.find(e => e.id === item.id);
  assert.equal(after.enhance_level, 9); assert.equal(JSON.parse(after.bonus_json).preserved, 'yes');
  assert.equal(JSON.parse(after.bonus_json).expPct, 4);
});

test('corrupt receipt JSON, empty results and mismatched operation targets stay explicitly unconfirmed', async t => {
  const env = await fixture(t); badges(env, 100);
  const item = await gear(env, 'corrupt-target'), body = { requestId: 'corrupt-proof', op: 'imprint', itemId: item.id, from: 0 };
  await TOWER.action(env, IDS[0], body, T);
  const event = 'tower-action:' + IDS[0] + ':' + body.requestId;
  const note = JSON.parse(env.DB.sqlite.prepare('SELECT note FROM rpg_ledger WHERE event_id=?').get(event).note);
  for (const bad of ['{bad-json', JSON.stringify({ ...note, result: {} }), JSON.stringify({ ...note, result: { ...note.result, itemId: 'different-item' } }), JSON.stringify({ ...note, result: { ...note.result, cost: -1 } }), JSON.stringify({ ...note, result: { ...note.result, to: 4 } })]) {
    env.DB.sqlite.prepare('UPDATE rpg_ledger SET note=? WHERE event_id=?').run(bad, event);
    const before = stable(env);
    await assert.rejects(receipt(readOnly(env), IDS[0], body, T), e => e.code === 'tower_receipt_corrupt');
    assert.deepEqual(stable(env), before);
  }
});

test('receipt rejects stale selected characters and malformed lookup parameters without writes', async t => {
  const env = await fixture(t), body = { requestId: 'valid-read', op: 'redeem', offerId: 'scroll_w' };
  const before = stable(env);
  await assert.rejects(view(env, '99999', {}, T), e => e.code === 'no_character');
  await assert.rejects(view(env, IDS[0], { partyId: {} }, T), e => e.code === 'party');
  await assert.rejects(view(env, IDS[0], { sinceTurnId: {} }, T), e => e.code === 'party');
  await assert.rejects(receipt(env, IDS[0], { ...body, requestId: '../escape' }, T), e => e.code === 'tower_receipt_input');
  await assert.rejects(receipt(env, IDS[0], { ...body, op: 'delete' }, T), e => e.code === 'tower_receipt_input');
  assert.deepEqual(stable(env), before);
  env.DB.sqlite.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(IDS[1], IDS[0]);
  const switched = stable(env);
  await assert.rejects(receipt(env, IDS[0], body, T), e => e.code === 'character_changed');
  assert.deepEqual(stable(env), switched);
});
