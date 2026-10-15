import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { handle } from '../src/index.js';
import { taipeiAt } from '../src/game/time.js';

const SECRET = 'test-secret-blessed';
const T = taipeiAt('2026-10-08', 8);
function setup() {
  const env = { DB: freshDb(), SERVICE_SECRET: SECRET, ENVIRONMENT: 'development', ALLOW_DEBUG_TIME: 'true', GROUP_CHAT_ID: '-100123' };
  const call = async (endpoint, body = {}, now = T) => {
    const res = await handle(new Request(`http://rpg${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Service-Secret': SECRET, 'X-Debug-Now': String(now) }, body: JSON.stringify(body) }), env);
    return { status: res.status, ...(await res.json()) };
  };
  const sql = (q, ...p) => env.DB.sqlite.prepare(q).run(...p);
  const one = (q, ...p) => env.DB.sqlite.prepare(q).get(...p);
  return { call, sql, one, env };
}

test('API blessed weapon: cannot auto-buy, consumes exactly one, returns odds and transaction ledger', async () => {
  const { call, sql, one } = setup();
  const tgId = '95101';
  const made = await call('/rpg/create', { tgId, name: '祝福劍士', gender: 'f', baseClass: 'sword', tgName: '祝福劍士' });
  assert.equal(made.ok, true, JSON.stringify(made));
  const weapon = made.equipment.find(x => x.slot === 'weapon');
  assert.ok(weapon);
  const fail = await call('/rpg/enhance', { tgId, itemId: weapon.id, blessed: true, requestId: 'blessed-missing' });
  assert.equal(fail.error, 'no_scroll');
  sql('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES (?,?,?)', tgId, 'blessed_scroll_w', 2);
  const r = await call('/rpg/enhance', { tgId, itemId: weapon.id, blessed: true, requestId: 'blessed-weapon' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.goldCost, 0);
  assert.equal(r.result.used.blessed_scroll_w, 1);
  assert.equal(r.inventory.blessed_scroll_w, 1);
  assert.ok(one("SELECT 1 AS present FROM rpg_ledger WHERE tg_id=? AND type='祝福強化' AND item='blessed_scroll_w'", tgId));
  const dup = await call('/rpg/enhance', { tgId, itemId: weapon.id, blessed: true, requestId: 'blessed-weapon' });
  assert.equal(dup.error, 'duplicate');
  assert.equal(one("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='blessed_scroll_w'", tgId).quantity, 1);
});

test('API blessed armor uses armor scroll rather than weapon scroll; tradeable catalog', async () => {
  const { call, sql } = setup();
  const tgId = '95102';
  const made = await call('/rpg/create', { tgId, name: '祝福盾士', gender: 'm', baseClass: 'sword', tgName: '祝福盾士' });
  assert.equal(made.ok, true);
  const armor = made.equipment.find(x => x.slot !== 'weapon');
  assert.ok(armor);
  sql('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES (?,?,?)', tgId, 'blessed_scroll_a', 1);
  const r = await call('/rpg/enhance', { tgId, itemId: armor.id, blessed: true, requestId: 'blessed-armor' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.used.blessed_scroll_a, 1);
  assert.equal(r.inventory.blessed_scroll_a, 0);
  assert.ok(!r.result.used.blessed_scroll_w);
});
