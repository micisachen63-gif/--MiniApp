import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { mulberry32 } from '../src/game/rng.js';
import { taipeiDay, taipeiAt, isoWeek } from '../src/game/time.js';
import { selectAccountCharacter } from '../src/accounts.js';
import { ATLAS_QUESTS, QUEST_DAY_MS, dailyQuestTheme, questInstance } from '../src/game/atlas-quests.js';
import { getAtlasMap } from '../src/game/atlas-catalog.js';
import * as P from '../src/services/player.js';
import * as Atlas from '../src/services/atlas.js';
import * as Q from '../src/services/atlas-quests.js';

const T = Date.parse('2026-11-01T15:55:00Z'); // Sunday 23:55 in Taipei.
const MIDNIGHT = Date.parse('2026-11-01T16:00:00Z'); // Monday 00:00 in Taipei.
async function fixture(t, { at = T, flags = {} } = {}) {
  const env = { DB: freshDb(), ATLAS_ENABLED: 'true', REALM_CONTEXT: { id: 'permanent', type: 'permanent' }, ...flags };
  t.after(() => env.DB.sqlite.close());
  const player = await P.createCharacter(env, { tgId: '82301', name: '委託測試甲', gender: 'm', baseClass: 'sword' }, at, mulberry32(7));
  return { env, db: env.DB.sqlite, id: player.char.tg_id, account: player.char.account_tg_id, player, at };
}
const event = (sourceId, kind, occurredAt = T, extra = {}) => ({ sourceId, kind, occurredAt,
  ...(kind === 'craft' ? {} : { buildId: 'sword_whirlwind' }),
  ...(['start', 'completion'].includes(kind) ? { mapId: 'laurel_intro' } : {}), ...extra });
async function record(f, events, now = T) {
  await f.env.DB.batch(Q.questEventStatements(f.env.DB, { accountId: f.account, charId: f.id, events }, now));
}
const find = (projection, id, periodKey = 'lifetime') => projection.quests.find(row => row.id === id && row.periodKey === periodKey);
const claimBody = (questId, periodKey = 'lifetime', requestId = `claim-${questId}`) => ({ questId, periodKey, requestId });
const wallet = (db, id) => Object.fromEntries(db.prepare('SELECT material,quantity FROM rpg_atlas_materials WHERE char_id=?').all(id).map(row => [row.material, row.quantity]));
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
function assets(db, id) {
  const result = {};
  for (const [key, sql] of Object.entries({
    character: 'SELECT * FROM rpg_characters WHERE tg_id=?',
    equipment: 'SELECT * FROM rpg_equipment WHERE tg_id=? ORDER BY id',
    inventory: 'SELECT * FROM rpg_inventory WHERE tg_id=? ORDER BY item',
  })) result[key] = JSON.parse(JSON.stringify(db.prepare(sql).all(id)));
  return result;
}

test('permanent goals use only available maps and small material bonuses with explicit calendar periods', () => {
  assert.ok(ATLAS_QUESTS.length > 10);
  assert.ok(ATLAS_QUESTS.every(quest => quest.rewards.gold === 0 && quest.rewards.exp === 0));
  for (const quest of ATLAS_QUESTS) if (quest.mapId) assert.equal(getAtlasMap(quest.mapId).available, true);
  assert.equal(isoWeek(MIDNIGHT - 1000), '2026-W44');
  assert.equal(isoWeek(MIDNIGHT), '2026-W45');
  assert.equal(questInstance('weekly_three_builds', '2026-W53').startAt, taipeiAt('2026-12-28', 0));
  assert.equal(questInstance('weekly_three_builds', '2026-W53').endAt, taipeiAt('2027-01-04', 0));
  const day = questInstance('daily_theme', '2026-11-01');
  assert.equal(day.expiresAt, taipeiAt('2026-11-04', 0));
  assert.equal(new Set([0, 1, 2].map(offset => dailyQuestTheme(taipeiDay(T + offset * QUEST_DAY_MS)).themeId)).size, 3);
  assert.throws(() => questInstance('daily_theme', '2026-02-31'), error => error.code === 'atlas_quest_period');
  assert.throws(() => questInstance('weekly_three_builds', '2026-W99'), error => error.code === 'atlas_quest_period');
});

test('quest views are read-only and never turn visits into gameplay progress', async t => {
  const f = await fixture(t), before = assets(f.db, f.id);
  const first = await Q.view(f.env, f.id, T), second = await Q.view(f.env, f.id, T);
  assert.deepEqual(second, first);
  assert.equal(first.realmId, 'permanent');
  assert.equal(first.characterId, f.id);
  assert.equal(first.accountId, f.account);
  assert.ok(first.quests.every(quest => quest.progress === 0 && !quest.completed && !quest.claimed && !quest.claimable));
  assert.deepEqual(assets(f.db, f.id), before);
  assert.equal(count(f.db, 'rpg_atlas_quest_events'), 0);
  assert.equal(count(f.db, 'rpg_atlas_quest_claims'), 0);
});

test('source events are appended atomically, deduplicated, and cannot be replayed with changed content', async t => {
  const f = await fixture(t), original = event('operation-config-1', 'configure');
  await record(f, [original]);
  await record(f, [original], T + 1000);
  assert.equal(count(f.db, 'rpg_atlas_quest_events'), 1);
  assert.equal(find(await Q.view(f.env, f.id, T + 1000), 'intro_build').progress, 1);
  const beforeGold = f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(f.id).gold;
  await assert.rejects(f.env.DB.batch([
    f.env.DB.prepare('UPDATE rpg_characters SET gold=gold+99 WHERE tg_id=?').bind(f.id),
    ...Q.questEventStatements(f.env.DB, { accountId: f.account, charId: f.id, events: [{ ...original, buildId: 'sword_bleed' }] }, T + 1000),
  ]), /rpg_atlas_quest_guard/);
  assert.equal(f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(f.id).gold, beforeGold);
  assert.equal(count(f.db, 'rpg_atlas_quest_events'), 1);
  await assert.rejects(f.env.DB.batch([
    ...Q.questEventStatements(f.env.DB, { accountId: f.account, charId: f.id, events: [event('rollback-craft', 'craft')] }, T),
    f.env.DB.prepare('INSERT INTO rpg_guard(ok) VALUES(NULL)'),
  ]));
  assert.equal(count(f.db, 'rpg_atlas_quest_events'), 1);
});

test('future, fabricated map/theme and mismatched-account events are rejected without progress', async t => {
  const f = await fixture(t);
  assert.throws(() => Q.questEventStatements(f.env.DB, { accountId: f.account, charId: f.id, events: [event('future', 'craft', T + 1)] }, T), /尚未發生/);
  assert.throws(() => Q.questEventStatements(f.env.DB, { accountId: f.account, charId: f.id, events: [event('fake-map', 'completion', T, { mapId: 'not-open' })] }, T), error => error.code === 'atlas_quest_event');
  assert.throws(() => Q.questEventStatements(f.env.DB, { accountId: f.account, charId: f.id, events: [event('fake-theme', 'completion', T, { themeId: 12 })] }, T), error => error.code === 'atlas_quest_event');
  await assert.rejects(f.env.DB.batch(Q.questEventStatements(f.env.DB, { accountId: 'other-account', charId: f.id, events: [event('wrong-owner', 'configure')] }, T)), /atlas_quest_account_mismatch/);
  assert.equal(count(f.db, 'rpg_atlas_quest_events'), 0);
});

test('offline completions belong to their actual Taipei day and week rather than their later settlement time', async t => {
  const f = await fixture(t), previousDay = taipeiDay(MIDNIGHT - 1000), currentDay = taipeiDay(MIDNIGHT + 1000);
  const now = MIDNIGHT + QUEST_DAY_MS;
  await record(f, [
    event('offline-sunday', 'completion', MIDNIGHT - 1000, { mapId: dailyQuestTheme(previousDay).mapId }),
    event('offline-monday', 'completion', MIDNIGHT + 1000, { mapId: dailyQuestTheme(currentDay).mapId }),
  ], now);
  const projection = await Q.view(f.env, f.id, now);
  assert.equal(find(projection, 'daily_theme', previousDay).progress, 1);
  assert.equal(find(projection, 'daily_theme', currentDay).progress, 1);
  assert.equal(find(projection, 'daily_theme', taipeiDay(now)).progress, 0);
  assert.equal(find(projection, 'weekly_three_themes', '2026-W44').progress, 1);
  assert.equal(find(projection, 'weekly_three_themes', '2026-W45').progress, 1);
  const stored = f.db.prepare('SELECT day_key,week_key,recorded_at FROM rpg_atlas_quest_events WHERE source_id=?').get('offline-sunday');
  assert.equal(stored.day_key, '2026-11-01');
  assert.equal(stored.week_key, '2026-W44');
  assert.equal(stored.recorded_at, now);
});

test('concurrent claim requests award one account receipt and leave old character assets and +N intact', async t => {
  const f = await fixture(t);
  f.db.prepare('UPDATE rpg_equipment SET enhance_level=15 WHERE tg_id=?').run(f.id);
  await record(f, [event('claim-config', 'configure')]);
  const before = assets(f.db, f.id);
  const [first, second] = await Promise.all([
    Q.claim(f.env, f.id, claimBody('intro_build', 'lifetime', 'concurrent-claim-a'), T),
    Q.claim(f.env, f.id, claimBody('intro_build', 'lifetime', 'concurrent-claim-b'), T),
  ]);
  assert.equal(first.receiptId, second.receiptId);
  assert.deepEqual([first.alreadyClaimed, second.alreadyClaimed].sort(), [false, true]);
  assert.equal(first.rewardCharacterId, f.id);
  assert.equal(count(f.db, 'rpg_atlas_quest_claims'), 1);
  assert.equal(count(f.db, 'rpg_atlas_quest_requests'), 2);
  assert.deepEqual(wallet(f.db, f.id), { atlas_shard: 2 });
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM rpg_ledger WHERE type='永久委託獎勵'").get().n, 1);
  assert.deepEqual(assets(f.db, f.id), before);
});

test('switching characters shares progress but never grants the same quest again', async t => {
  const f = await fixture(t);
  await record(f, [event('account-config', 'configure')]);
  const request = claimBody('intro_build', 'lifetime', 'account-wide-claim');
  const first = await Q.claim(f.env, f.id, request, T);
  const second = await P.createCharacter(f.env, { tgId: f.account, name: '委託測試乙', gender: 'f', baseClass: 'mage' }, T, mulberry32(8));
  await selectAccountCharacter(f.env, f.account, second.char.tg_id, T);
  const projection = await Q.view(f.env, second.char.tg_id, T);
  assert.equal(find(projection, 'intro_build').claimed, true);
  const retry = await Q.claim(f.env, second.char.tg_id, request, T + 1000);
  const anotherRequest = await Q.claim(f.env, second.char.tg_id, { ...request, requestId: 'account-wide-other' }, T + 1000);
  assert.equal(retry.receiptId, first.receiptId);
  assert.equal(retry.characterId, second.char.tg_id);
  assert.equal(retry.rewardCharacterId, f.id);
  assert.equal(anotherRequest.alreadyClaimed, true);
  assert.deepEqual(wallet(f.db, f.id), { atlas_shard: 2 });
  assert.deepEqual(wallet(f.db, second.char.tg_id), {});
});

test('another account cannot claim progress or rewards supplied by the client', async t => {
  const f = await fixture(t);
  await record(f, [event('private-config', 'configure')]);
  const other = await P.createCharacter(f.env, { tgId: '82302', name: '委託別帳號', gender: 'm', baseClass: 'sword' }, T, mulberry32(9));
  const request = { ...claimBody('intro_build'), accountId: f.account, progress: 999, completed: true, rewards: { materials: { atlas_core: 999 } } };
  await assert.rejects(Q.claim(f.env, other.char.tg_id, request, T), error => error.code === 'atlas_quest_incomplete');
  const real = await Q.claim(f.env, f.id, request, T);
  assert.deepEqual(real.rewards, { materials: { atlas_shard: 2 }, gold: 0, exp: 0 });
  assert.equal(wallet(f.db, f.id).atlas_core, undefined);
  assert.deepEqual(wallet(f.db, other.char.tg_id), {});
});

test('three-day daily catch-up uses earned progress and an old request still replays after the date window closes', async t => {
  const f = await fixture(t), period = '2026-11-01';
  const later = taipeiAt('2026-11-03', 23), expired = taipeiAt('2026-11-04', 0);
  await record(f, [event('late-workshop', 'craft'), event('late-theme', 'completion', T, { mapId: dailyQuestTheme(period).mapId })], later);
  const request = claimBody('daily_workshop', period, 'daily-original-request');
  const original = await Q.claim(f.env, f.id, request, later);
  assert.deepEqual(wallet(f.db, f.id), { atlas_shard: 1 });
  await assert.rejects(Q.claim(f.env, f.id, claimBody('daily_theme', period, 'daily-expired-request'), expired), error => error.code === 'atlas_quest_expired');
  const replay = await Q.claim(f.env, f.id, request, expired + 2 * QUEST_DAY_MS);
  assert.equal(replay.receiptId, original.receiptId);
  assert.equal(replay.claimedAt, original.claimedAt);
  assert.equal(replay.alreadyClaimed, true);
  assert.deepEqual(wallet(f.db, f.id), { atlas_shard: 1 });
  assert.equal(count(f.db, 'rpg_atlas_quest_claims'), 1);
});

test('weekly themes and builds count distinct successful configurations rather than repeated runs or saves', async t => {
  const f = await fixture(t);
  await record(f, [
    event('region-1', 'completion'), event('region-2', 'completion', T, { mapId: 'pillar_intro' }),
    event('region-3', 'completion', T, { mapId: 'grove_intro' }), event('repeat-region', 'completion'),
    event('saved-build-only', 'configure', T, { buildId: 'sword_bleed' }),
  ]);
  let projection = await Q.view(f.env, f.id, T);
  assert.equal(find(projection, 'weekly_three_themes', isoWeek(T)).progress, 3);
  assert.equal(find(projection, 'weekly_three_builds', isoWeek(T)).progress, 1);
  await record(f, [event('build-two-clear', 'completion', T, { buildId: 'sword_bleed' }), event('build-three-clear', 'completion', T, { buildId: 'sword_counter' })]);
  projection = await Q.view(f.env, f.id, T);
  assert.equal(find(projection, 'weekly_three_builds', isoWeek(T)).progress, 3);
  // The week has ended, but its reward is still claimable during the following week.
  await Q.claim(f.env, f.id, claimBody('weekly_three_themes', '2026-W44'), MIDNIGHT + QUEST_DAY_MS);
  await Q.claim(f.env, f.id, claimBody('weekly_three_builds', '2026-W44'), MIDNIGHT + QUEST_DAY_MS);
  assert.deepEqual(wallet(f.db, f.id), { atlas_shard: 6, atlas_iron: 1, atlas_ember: 1 });
});

test('long-term map and boss milestones retain progress across days without needing unopened regions', async t => {
  const f = await fixture(t);
  const events = Array.from({ length: 50 }, (_, index) => event(`long-laurel-${index}`, 'completion', T - (index % 10) * QUEST_DAY_MS));
  events.push(...Array.from({ length: 15 }, (_, index) => event(`long-boss-${index}`, 'completion', T - (index % 10) * QUEST_DAY_MS, { mapId: 'laurel_warden' })));
  events.push(...Array.from({ length: 35 }, (_, index) => event(`long-pillar-${index}`, 'completion', T - (index % 10) * QUEST_DAY_MS, { mapId: 'pillar_intro' })));
  await record(f, events);
  const projection = await Q.view(f.env, f.id, T);
  for (const [questId, progress] of [['explore_1_10', 50], ['explore_1_50', 50], ['warden_3', 15], ['warden_15', 15], ['atlas_100', 100]]) {
    assert.equal(find(projection, questId).progress, progress);
    assert.equal(find(projection, questId).claimable, true);
  }
  const first = await Q.claim(f.env, f.id, claimBody('atlas_100'), T);
  const muchLater = await Q.claim(f.env, f.id, claimBody('atlas_100'), T + 100 * QUEST_DAY_MS);
  assert.equal(muchLater.receiptId, first.receiptId);
  assert.deepEqual(wallet(f.db, f.id), { atlas_shard: 6 });
});

test('claim receipt, request, materials and ledger all roll back when the ledger insert fails', async t => {
  const f = await fixture(t);
  await record(f, [event('atomic-config', 'configure')]);
  f.db.exec("CREATE TRIGGER quest_test_fail BEFORE INSERT ON rpg_ledger WHEN NEW.type='永久委託獎勵' BEGIN SELECT RAISE(ABORT,'quest_test_ledger_failure'); END");
  await assert.rejects(Q.claim(f.env, f.id, claimBody('intro_build'), T), /quest_test_ledger_failure/);
  assert.equal(count(f.db, 'rpg_atlas_quest_claims'), 0);
  assert.equal(count(f.db, 'rpg_atlas_quest_requests'), 0);
  assert.deepEqual(wallet(f.db, f.id), {});
  f.db.exec('DROP TRIGGER quest_test_fail');
  await Q.claim(f.env, f.id, claimBody('intro_build'), T);
  assert.deepEqual(wallet(f.db, f.id), { atlas_shard: 2 });
});

test('a lost response after a successful commit recovers the same receipt and never grants twice', async t => {
  const f = await fixture(t);
  await record(f, [event('lost-config', 'configure')]);
  const originalBatch = f.env.DB.batch.bind(f.env.DB);
  let lost = false;
  f.env.DB.batch = async statements => {
    const result = await originalBatch(statements);
    if (!lost && statements.some(statement => statement.sql.startsWith('INSERT INTO rpg_atlas_quest_claims'))) { lost = true; throw new Error('response lost after quest commit'); }
    return result;
  };
  const first = await Q.claim(f.env, f.id, claimBody('intro_build'), T);
  const retry = await Q.claim(f.env, f.id, claimBody('intro_build'), MIDNIGHT + 1000);
  assert.equal(lost, true);
  assert.equal(retry.receiptId, first.receiptId);
  assert.deepEqual(wallet(f.db, f.id), { atlas_shard: 2 });
  assert.equal(count(f.db, 'rpg_atlas_quest_claims'), 1);
});

test('one request ID racing for two different quests cannot commit both payouts', async t => {
  const f = await fixture(t);
  await record(f, [event('race-config', 'configure'), event('race-start', 'start')]);
  const results = await Promise.allSettled([
    Q.claim(f.env, f.id, claimBody('intro_build', 'lifetime', 'request-collision'), T),
    Q.claim(f.env, f.id, claimBody('intro_departure', 'lifetime', 'request-collision'), T),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'request_reused');
  assert.equal(count(f.db, 'rpg_atlas_quest_claims'), 1);
  assert.deepEqual(wallet(f.db, f.id), { atlas_shard: 2 });
});

test('a feature rollback hides new quests but still allows reading a previously committed claim receipt', async t => {
  const f = await fixture(t);
  await record(f, [event('flag-config', 'configure'), event('flag-start', 'start')]);
  const original = await Q.claim(f.env, f.id, claimBody('intro_build'), T);
  f.env.ATLAS_ENABLED = 'false';
  assert.equal((await Q.view(f.env, f.id, T)).enabled, false);
  const retry = await Q.claim(f.env, f.id, claimBody('intro_build'), T);
  assert.equal(retry.receiptId, original.receiptId);
  await assert.rejects(Q.claim(f.env, f.id, claimBody('intro_departure'), T), error => error.code === 'atlas_quests_unavailable');
  assert.deepEqual(wallet(f.db, f.id), { atlas_shard: 2 });
});

test('season contexts and a season database disguised as permanent cannot collect permanent objectives', async t => {
  const f = await fixture(t);
  const season = { ...f.env, REALM_CONTEXT: { id: 'season-test', type: 'season' } };
  assert.equal((await Q.view(season, f.id, T)).enabled, false);
  await assert.rejects(Q.claim(season, f.id, claimBody('intro_build'), T), error => error.code === 'atlas_quest_permanent_only');
  assert.throws(() => Q.questEventStatements(f.env.DB, { accountId: f.account, charId: f.id, realmId: 'season-test', events: [event('season-event', 'configure')] }, T), error => error.code === 'atlas_quest_permanent_only');
  // A real identity row supplies a second, database-side barrier even if a caller
  // accidentally passes a misleading environment context.
  f.db.prepare("INSERT INTO rpg_realm_identity(singleton,realm_id,realm_type,database_token,instance_nonce,rules_version,phase,fence_epoch,created_at,updated_at) VALUES(1,'season-test','season','test-database-token','test-instance-nonce','test-v1','ACTIVE',0,?,?)").run(T, T);
  assert.equal((await Q.view(f.env, f.id, T)).enabled, false);
  await assert.rejects(Q.claim(f.env, f.id, claimBody('intro_build'), T), error => error.code === 'atlas_quest_permanent_only');
  await assert.rejects(record(f, [event('season-sql-event', 'configure')]), /atlas_quest_permanent_only/);
  assert.equal(count(f.db, 'rpg_atlas_quest_events'), 0);
  assert.equal(count(f.db, 'rpg_atlas_quest_claims'), 0);
});

test('inactive characters cannot redirect a new account reward and malformed periods cannot grant materials', async t => {
  const f = await fixture(t);
  await record(f, [event('selected-config', 'configure')]);
  const second = await P.createCharacter(f.env, { tgId: f.account, name: '委託未選角', gender: 'f', baseClass: 'mage' }, T, mulberry32(8));
  await assert.rejects(Q.claim(f.env, second.char.tg_id, claimBody('intro_build'), T), error => error.code === 'character_changed');
  await assert.rejects(Q.claim(f.env, f.id, claimBody('intro_build', '2026-11-01'), T), error => error.code === 'atlas_quest_period');
  await assert.rejects(Q.claim(f.env, f.id, claimBody('daily_theme', '2099-01-01'), T), error => error.code === 'atlas_quest_expired');
  assert.deepEqual(wallet(f.db, f.id), {});
});

test('a character switch between eligibility read and commit rolls back the pending reward', async t => {
  const f = await fixture(t);
  await record(f, [event('switch-race-config', 'configure')]);
  const second = await P.createCharacter(f.env, { tgId: f.account, name: '委託切角競爭', gender: 'f', baseClass: 'mage' }, T, mulberry32(8));
  const originalBatch = f.env.DB.batch.bind(f.env.DB);
  let switched = false;
  f.env.DB.batch = async statements => {
    if (!switched && statements.some(statement => statement.sql.startsWith('INSERT INTO rpg_atlas_quest_claims'))) {
      switched = true;
      await selectAccountCharacter(f.env, f.account, second.char.tg_id, T);
    }
    return originalBatch(statements);
  };
  await assert.rejects(Q.claim(f.env, f.id, claimBody('intro_build'), T), error => error.code === 'character_changed');
  assert.equal(switched, true);
  assert.equal(count(f.db, 'rpg_atlas_quest_claims'), 0);
  assert.equal(count(f.db, 'rpg_atlas_quest_requests'), 0);
  assert.deepEqual(wallet(f.db, f.id), {});
});

test('real configure/start/completion/craft operations feed objectives once using actual completion time', async t => {
  const startedAt = MIDNIGHT - 1000;
  const f = await fixture(t, { at: startedAt });
  const configure = { requestId: 'quest-real-config', buildId: 'sword_bleed', supportIds: ['lasting', 'wide'], automation: 'balanced' };
  const start = { requestId: 'quest-real-start', mapId: 'laurel_intro', mapCount: 1, durationMinutes: 60, supplies: { hp: 20, mp: 20 } };
  await Atlas.configure(f.env, f.id, configure, startedAt);
  await Atlas.start(f.env, f.id, start, startedAt);
  const now = startedAt + 10 * 60000;
  const settled = await Atlas.settle(f.env, f.id, {}, now);
  assert.equal(settled.run.status, 'completed');
  const state = JSON.parse(f.db.prepare('SELECT state_json FROM rpg_atlas_runs WHERE id=?').get(settled.run.id).state_json);
  for (const material of ['atlas_shard', 'atlas_iron']) f.db.prepare('INSERT INTO rpg_atlas_materials(char_id,material,quantity) VALUES(?,?,100) ON CONFLICT(char_id,material) DO UPDATE SET quantity=quantity+100').run(f.id, material);
  const craft = { requestId: 'quest-real-craft', itemId: f.player.equipment[0].id, recipeId: 'temper' };
  await Atlas.craft(f.env, f.id, craft, now);
  const projection = await Q.view(f.env, f.id, now);
  for (const questId of ['intro_build', 'intro_departure', 'intro_clear', 'intro_craft']) assert.equal(find(projection, questId).progress, 1, questId);
  const completion = f.db.prepare("SELECT * FROM rpg_atlas_quest_events WHERE kind='completion'").get();
  assert.equal(completion.occurred_at, (state.startedAt + state.elapsedSeconds) * 1000);
  assert.equal(completion.day_key, '2026-11-02');
  assert.equal(completion.week_key, '2026-W45');
  assert.notEqual(completion.occurred_at, now);
  await Atlas.configure(f.env, f.id, configure, now);
  await Atlas.start(f.env, f.id, start, now);
  await Atlas.settle(f.env, f.id, {}, now);
  await Atlas.craft(f.env, f.id, craft, now);
  assert.equal(count(f.db, 'rpg_atlas_quest_events'), 4);
});

test('changing a future loadout during an expedition cannot credit an unplayed build to weekly progress', async t => {
  const f = await fixture(t);
  await Atlas.configure(f.env, f.id, { requestId: 'quest-snapshot-config', buildId: 'sword_bleed', supportIds: ['lasting', 'wide'], automation: 'balanced' }, T);
  await Atlas.start(f.env, f.id, { requestId: 'quest-snapshot-start', mapId: 'laurel_intro', mapCount: 1, durationMinutes: 60, supplies: { hp: 20, mp: 20 } }, T);
  await Atlas.configure(f.env, f.id, { requestId: 'quest-snapshot-next', buildId: 'sword_counter', supportIds: ['guarded', 'economy'], automation: 'balanced' }, T + 1000);
  await Atlas.settle(f.env, f.id, { buildId: 'mage_arcane' }, T + 4 * 60000);
  const completion = f.db.prepare("SELECT build_id FROM rpg_atlas_quest_events WHERE kind='completion'").get();
  assert.equal(completion?.build_id, 'sword_bleed');
  const projection = await Q.view(f.env, f.id, T + 4 * 60000);
  assert.equal(find(projection, 'weekly_three_builds', isoWeek(T)).progress, 1);
});
