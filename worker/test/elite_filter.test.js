import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { handle } from '../src/index.js';
import { RARITIES } from '../src/game/constants.js';
import { makeGear } from '../src/game/gear.js';
import { mulberry32 } from '../src/game/rng.js';
import { relicStatements } from '../src/services/player.js';

const SECRET = 'test-secret-0123456789';
const T0 = Date.parse('2026-10-08T01:00:00Z');

function mk() {
  const env = { DB: freshDb(), SERVICE_SECRET: SECRET, ENVIRONMENT: 'development', ALLOW_DEBUG_TIME: 'true', GROUP_CHAT_ID: '-100123' };
  const call = async (path, body = {}, now = T0) => {
    const res = await handle(new Request(`http://rpg${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Service-Secret': SECRET, 'X-Debug-Now': String(now) }, body: JSON.stringify(body) }), env);
    return { status: res.status, ...(await res.json()) };
  };
  return { env, call, sql: (q, ...p) => env.DB.sqlite.prepare(q).run(...p), one: (q, ...p) => env.DB.sqlite.prepare(q).get(...p), all: (q, ...p) => env.DB.sqlite.prepare(q).all(...p) };
}

test('MMORPG 5-tier rarity colors defined in RARITIES', () => {
  assert.equal(RARITIES.common.color, 'white');
  assert.equal(RARITIES.advanced.color, 'green');
  assert.equal(RARITIES.epic.color, 'blue');
  assert.equal(RARITIES.legendary.color, 'purple');
  assert.equal(RARITIES.supreme.color, 'red');
});

test('elite drop announcement filter: green/blue/purple silent, red/relic announces to group', async () => {
  const k = mk();
  await k.call('/rpg/create', { tgId: '777', name: '過濾測試', gender: 'm', baseClass: 'sword' }, T0);

  const char = k.one("SELECT * FROM rpg_characters WHERE tg_id = '777'");
  assert.ok(char);

  const rng = mulberry32(123);
  const greenItem = makeGear({ id: 'eg_green', tgId: '777', cls: 'sword', slot: 'armor', kind: 'plate', tier: 1, rng, now: T0, forceRarity: 'advanced' });
  const blueItem = makeGear({ id: 'eg_blue', tgId: '777', cls: 'sword', slot: 'armor', kind: 'plate', tier: 1, rng, now: T0, forceRarity: 'epic' });
  const purpleItem = makeGear({ id: 'eg_purple', tgId: '777', cls: 'sword', slot: 'armor', kind: 'plate', tier: 1, rng, now: T0, forceRarity: 'legendary' });
  const redItem = makeGear({ id: 'eg_red', tgId: '777', cls: 'sword', slot: 'armor', kind: 'plate', tier: 1, rng, now: T0, forceRarity: 'supreme' });

  for (const item of [greenItem, blueItem, purpleItem, redItem]) {
    k.sql("INSERT INTO rpg_equipment (id, tg_id, slot, kind, class_req, branch_req, tier, level_req, name, source, base_stat, bonus_json, element, element_stat, element_tier, enhance_level, is_equipped, convert_token, created_at, grade, affix_json, bound, trade_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      item.id, item.tg_id, item.slot, item.kind, item.class_req, item.branch_req, item.tier, item.level_req, item.name, item.source, item.base_stat, item.bonus_json, item.element, item.element_stat, item.element_tier, item.enhance_level, item.is_equipped, item.convert_token, item.created_at, item.grade, item.affix_json, item.bound, item.trade_id);
  }

  // Claim outbox before
  await k.call('/rpg/outbox/claim', {}, T0);

  // Test relicStatements directly:
  const stmtsGreen = relicStatements(k.env.DB, char, [{ type: 'elite_gear', at: T0, item: { id: greenItem.id } }], T0, [greenItem]);
  const stmtsBlue = relicStatements(k.env.DB, char, [{ type: 'elite_gear', at: T0, item: { id: blueItem.id } }], T0, [blueItem]);
  const stmtsPurple = relicStatements(k.env.DB, char, [{ type: 'elite_gear', at: T0, item: { id: purpleItem.id } }], T0, [purpleItem]);
  const stmtsRed = relicStatements(k.env.DB, char, [{ type: 'elite_gear', at: T0, item: { id: redItem.id } }], T0, [redItem]);

  // Green, Blue, Purple should only have 1 ledger stmt, NO outbox share stmts
  assert.equal(stmtsGreen.length, 1);
  assert.equal(stmtsBlue.length, 1);
  assert.equal(stmtsPurple.length, 1);

  // Red (Supreme) should generate share statements (rpg_shares insert + outbox share push + ledger)
  assert.ok(stmtsRed.length >= 2, `red statements length: ${stmtsRed.length}`);
});
