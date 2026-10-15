import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { handle } from '../src/index.js';
import { settleKill } from '../src/services/boss.js';
import { rngFor } from '../src/game/rng.js';
import { BLESSED_DROPS, ITEMS } from '../src/game/constants.js';
import { taipeiAt } from '../src/game/time.js';

const T = taipeiAt('2026-10-08', 9);
const SECRET = 'test-blessed-delivery';
function setup() {
  const env = { DB: freshDb(), SERVICE_SECRET: SECRET, ENVIRONMENT: 'development', ALLOW_DEBUG_TIME: 'true', GROUP_CHAT_ID: '-100123' };
  const sql = (query, ...params) => env.DB.sqlite.prepare(query).run(...params);
  const all = (query, ...params) => env.DB.sqlite.prepare(query).all(...params);
  const one = (query, ...params) => env.DB.sqlite.prepare(query).get(...params);
  const call = async (path, body = {}, now = T) => {
    const response = await handle(new Request(`http://rpg${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Service-Secret': SECRET, 'X-Debug-Now': String(now) }, body: JSON.stringify(body) }), env);
    return { status: response.status, ...(await response.json()) };
  };
  return { env, sql, all, one, call };
}
function winningBossId() {
  for (let n = 0; n < 10000; n++) {
    const id = `test-blessed-${n}`;
    if (rngFor(`blessed:${id}`)() < BLESSED_DROPS.bossChance) return id;
  }
  throw new Error('Unable to find deterministic winning boss ID');
}

test('boss blessed delivery: inventory, ledger, group outbox, no duplicate settlement, claim/retry/ack', async () => {
  const { env, sql, all, one, call } = setup();
  const tgId = '95201';
  const made = await call('/rpg/create', { tgId, name: '祝福測試者', gender: 'f', baseClass: 'sword', tgName: '祝福測試者' }, T - 60000);
  assert.equal(made.ok, true, JSON.stringify(made));
  const id = winningBossId();
  sql('INSERT INTO rpg_boss_instances(id,chat_id,map_id,name,element,base_hp,max_hp,hp,participants,spawn_reason,started_at,ends_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', id, '-100123', 1, '祝福測試首領', 'fire', 7000, 7000, 0, 1, 'test', T, T + 1800000, 'active');
  sql('INSERT INTO rpg_boss_attacks(boss_id,tg_id,win,damage,created_at) VALUES (?,?,?,?,?)', id, tgId, 0, 7000, T);
  const first = await settleKill(env, id, T + 1000);
  assert.equal(first.status, 'killed');
  assert.equal(first.claimed, true);
  assert.equal(first.blessedScrolls.length, 1);
  const drop = first.blessedScrolls[0];
  assert.equal(drop.tgId, tgId);
  assert.ok(BLESSED_DROPS.keys.includes(drop.item));
  assert.equal(drop.itemName, ITEMS[drop.item].name);
  assert.equal(one('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?', tgId, drop.item).quantity, 1);
  const ledger = all("SELECT * FROM rpg_ledger WHERE event_id=? AND type='祝福卷軸掉落'", `boss:${id}:${tgId}:blessed`);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].item, drop.item);
  assert.equal(ledger[0].item_delta, 1);
  const messages = all("SELECT * FROM rpg_outbox WHERE dedupe_key=? AND kind='blessed_scroll'", `boss:${id}:blessed`);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].target, 'group');
  const payload = JSON.parse(messages[0].payload_json);
  assert.equal(payload.source, 'boss');
  assert.equal(payload.tgId, tgId);
  assert.equal(payload.item, drop.item);
  assert.equal(payload.itemName, ITEMS[drop.item].name);
  const again = await settleKill(env, id, T + 2000);
  assert.equal(again.claimed, false);
  assert.equal(all("SELECT * FROM rpg_ledger WHERE event_id=?", `boss:${id}:${tgId}:blessed`).length, 1);
  assert.equal(all("SELECT * FROM rpg_outbox WHERE dedupe_key=?", `boss:${id}:blessed`).length, 1);
  assert.equal(one('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?', tgId, drop.item).quantity, 1);
  const firstClaim = await call('/rpg/outbox/claim', { limit: 50 }, T + 3000);
  assert.equal(firstClaim.ok, true, JSON.stringify(firstClaim));
  const firstMessage = firstClaim.items.find(x => x.kind === 'blessed_scroll');
  assert.ok(firstMessage, 'blessed group announcement must be claimable');
  assert.equal(firstMessage.target, 'group');
  assert.equal(firstMessage.payload.source, 'boss');
  assert.equal((await call('/rpg/outbox/claim', { limit: 50 }, T + 4000)).items.filter(x => x.kind === 'blessed_scroll').length, 0);
  const retry = await call('/rpg/outbox/claim', { limit: 50 }, T + 130000);
  const retriedMessage = retry.items.find(x => x.id === firstMessage.id);
  assert.ok(retriedMessage, 'unacknowledged announcement must retry after lease');
  assert.notEqual(retriedMessage.claimToken, firstMessage.claimToken);
  const ack = await call('/rpg/outbox/ack', { ids: [retriedMessage.id], claimToken: retriedMessage.claimToken }, T + 131000);
  assert.equal(ack.ok, true, JSON.stringify(ack));
  const afterAck = await call('/rpg/outbox/claim', { limit: 50 }, T + 260000);
  assert.equal(afterAck.items.filter(x => x.id === firstMessage.id).length, 0);
});
test('elite blessed delivery: real idle drops credit inventory once and enqueue matching group announcements', async () => {
  const { sql, all, one, call } = setup();
  const tgId = '95202';
  const start = taipeiAt('2026-10-08', 8);
  const made = await call('/rpg/create', { tgId, name: '菁英祝福測試', gender: 'f', baseClass: 'sword', tgName: '菁英祝福測試' }, start);
  assert.equal(made.ok, true, JSON.stringify(made));
  sql("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES (?,?,?),(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity", tgId, 'red_1', 100000, tgId, 'blue_1', 100000);
  let totalDrops = 0;
  let now = start;
  for (let day = 0; day < 40 && totalDrops === 0; day++) {
    sql("UPDATE rpg_characters SET level=25,exp=0,map_id=1,idle_state='fighting',state_until=NULL,hp=9999,mp=9999,last_settle_at=? WHERE tg_id=?", now, tgId);
    now += 24 * 3600000;
    const result = await call('/rpg/me', { tgId }, now);
    assert.equal(result.ok, true, JSON.stringify(result));
    totalDrops = BLESSED_DROPS.keys.reduce((sum, key) => sum + (one('SELECT COALESCE(quantity,0) AS quantity FROM rpg_inventory WHERE tg_id=? AND item=?', tgId, key)?.quantity || 0), 0);
  }
  assert.ok(totalDrops > 0, '40 deterministic full-day elite settlements should produce a blessed drop');
  const ledger = all("SELECT * FROM rpg_ledger WHERE tg_id=? AND type='祝福卷軸掉落'", tgId);
  const notices = all("SELECT * FROM rpg_outbox WHERE kind='blessed_scroll' AND target='group'");
  assert.equal(ledger.length, totalDrops, 'each elite scroll must have exactly one ledger entry');
  assert.equal(notices.length, totalDrops, 'each elite scroll must generate exactly one group notification');
  assert.equal(new Set(ledger.map(row => row.event_id)).size, totalDrops);
  assert.equal(new Set(notices.map(row => row.dedupe_key)).size, totalDrops);
  for (const message of notices) {
    const payload = JSON.parse(message.payload_json);
    assert.equal(payload.source, 'elite');
    assert.equal(payload.tgId, tgId);
    assert.ok(BLESSED_DROPS.keys.includes(payload.item));
    assert.equal(payload.itemName, ITEMS[payload.item].name);
    assert.ok(payload.elite && payload.map);
    assert.ok(ledger.some(row => row.event_id === message.dedupe_key && row.item === payload.item && row.item_delta === 1));
  }
  const repeat = await call('/rpg/me', { tgId }, now);
  assert.equal(repeat.ok, true);
  assert.equal(all("SELECT * FROM rpg_ledger WHERE tg_id=? AND type='祝福卷軸掉落'", tgId).length, totalDrops, 'same-time repeat must not credit again');
  assert.equal(all("SELECT * FROM rpg_outbox WHERE kind='blessed_scroll' AND target='group'").length, totalDrops, 'same-time repeat must not enqueue twice');
  const claimed = await call('/rpg/outbox/claim', { limit: 50 }, now + 1000);
  assert.equal(claimed.ok, true, JSON.stringify(claimed));
  assert.ok(claimed.items.some(item => item.kind === 'blessed_scroll' && item.payload.source === 'elite'), 'elite announcement must be claimable');
});