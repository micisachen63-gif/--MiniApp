import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import * as Player from '../src/services/player.js';
import * as Collection from '../src/services/equipment-collection.js';
import * as Shop from '../src/services/gearbook-shop.js';
import { equipmentCollectionCatalog } from '../src/game/equipment-collection.js';
import { gearbookShopCost, gearbookShopGold, gearbookShopDust, gearbookShopOffer } from '../src/game/gearbook-shop.js';
import { canEquip, tradeBlock } from '../src/game/gear.js';
import { makeGear } from '../src/game/gear.js';
import { insertEquipStmt, loadPlayer } from '../src/db.js';
import { modeForLevel } from '../src/game/endgame.js';

const GOLD = {
  weapon: { 1:1800, 2:3000, 3:4200, 4:9600, 5:12500, 6:16000, 7:44000, 8:53500, 9:64500, 10:206000, 11:241000, 12:280000 },
  armor: { 1:1200, 2:1900, 3:2800, 4:6200, 5:8200, 6:10500, 7:28500, 8:35000, 9:42000, 10:132000, 11:155000, 12:180000 },
  piece: { 1:700, 2:1200, 3:1700, 4:3800, 5:5000, 6:6400, 7:17500, 8:21500, 9:26000, 10:83000, 11:97000, 12:112000 },
  belt: { 1:550, 2:900, 3:1300, 4:3000, 5:4000, 6:5000, 7:13500, 8:16500, 9:20000, 10:62500, 11:73500, 12:85000 },
  undershirt: { 1:500, 2:800, 3:1200, 4:2700, 5:3500, 6:4400, 7:12000, 8:14500, 9:17500, 10:55500, 11:65000, 12:75500 },
  earring: { 1:600, 2:1000, 3:1400, 4:3300, 5:4300, 6:5400, 7:14500, 8:18000, 9:21500, 10:68500, 11:80500, 12:93500 },
  ring: { 1:700, 2:1100, 3:1600, 4:3700, 5:4800, 6:6100, 7:16500, 8:20000, 9:24000, 10:77000, 11:90000, 12:104000 },
};

async function fixture(t, { level = 120, gold = 1_000_000, dust = 10_000, baseClass = 'sword' } = {}) {
  const env = { DB: freshDb(), EQUIPMENT_COLLECTION_ENABLED: 'true', REALM_CONTEXT: { id: 'permanent' } };
  t.after(() => env.DB.sqlite.close());
  const p = await Player.createCharacter(env, { tgId: '98631', name: '收藏兌換', baseClass, gender: 'f' }, T0);
  const id = p.char.tg_id;
  env.DB.sqlite.prepare('UPDATE rpg_characters SET level=?,gold=?,last_settle_at=? WHERE tg_id=?').run(level, gold, T0, id);
  env.DB.sqlite.prepare('INSERT INTO rpg_equipment_recovery_balances(char_id,dust,updated_at) VALUES(?,?,?)').run(id, dust, T0);
  return { env, id, db: env.DB.sqlite, now: T0, catalog: equipmentCollectionCatalog(baseClass) };
}

function firstOpen(f) {
  return { collection: f.catalog[0], requirement: f.catalog[0].requirements[0] };
}

test('exchange prices match the approved gold table and dust = 8 × tier', () => {
  for (const [slot, table] of Object.entries(GOLD)) {
    for (const [tier, gold] of Object.entries(table)) {
      assert.equal(gearbookShopGold(slot, Number(tier)), gold, slot + ' T' + tier);
    }
  }
  for (let tier = 1; tier <= 12; tier++) assert.equal(gearbookShopDust(tier), 8 * tier);
  const c = equipmentCollectionCatalog('sword')[0], r = c.requirements[0], cost = gearbookShopCost(r);
  assert.equal(cost.gold, gearbookShopGold(r.slot, r.tier));
  assert.equal(cost.dust, 8 * r.tier);
});

test('unregistered slots can be bought; a filled slot cannot, and there is no purchase cap', async t => {
  const f = await fixture(t), { collection, requirement } = firstOpen(f);
  const first = await Shop.buy(f.env, f.id, { collectionId: collection.id, requirementId: requirement.id, requestId: 'shop-first' }, T0);
  assert.equal(first.result.bound, true);
  assert.equal(first.result.enhance, 0);
  const item = f.db.prepare('SELECT * FROM rpg_equipment WHERE id=?').get(first.result.itemId);
  assert.equal(item.bound, 1);
  assert.equal(item.enhance_level, 0);
  assert.equal(item.source, 'gearbook_shop');
  assert.equal(item.element_tier, requirement.minRarity);
  assert.equal(item.tier, requirement.tier);
  const loaded = await loadPlayer(f.env.DB, f.id);
  assert.equal(canEquip(loaded.char, item), null);
  assert.match(tradeBlock(item), /綁定，不能交易/);
  assert.equal(item.mode || modeForLevel(loaded.char.level).id, modeForLevel(loaded.char.level).id);
  // same unregistered slot, same day: no daily/weekly cap, a second copy is allowed
  const again = await Shop.buy(f.env, f.id, { collectionId: collection.id, requirementId: requirement.id, requestId: 'shop-again' }, T0);
  assert.notEqual(again.result.itemId, first.result.itemId);
  const other = collection.requirements[1];
  const second = await Shop.buy(f.env, f.id, { collectionId: collection.id, requirementId: other.id, requestId: 'shop-second-slot' }, T0);
  assert.ok(second.result.itemId);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM rpg_equipment WHERE source='gearbook_shop'").get().n, 3);
});

test('insufficient gold or dust is rejected without consuming the other currency', async t => {
  const f = await fixture(t, { gold: 10, dust: 10_000 });
  const { collection, requirement } = firstOpen(f);
  const cost = gearbookShopCost(requirement);
  const goldBefore = f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(f.id).gold;
  const dustBefore = f.db.prepare('SELECT dust FROM rpg_equipment_recovery_balances WHERE char_id=?').get(f.id).dust;
  await assert.rejects(Shop.buy(f.env, f.id, { collectionId: collection.id, requirementId: requirement.id, requestId: 'need-gold' }, T0), /金幣不足/);
  assert.equal(f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(f.id).gold, goldBefore);
  assert.equal(f.db.prepare('SELECT dust FROM rpg_equipment_recovery_balances WHERE char_id=?').get(f.id).dust, dustBefore);
  f.db.prepare('UPDATE rpg_characters SET gold=? WHERE tg_id=?').run(cost.gold + 50, f.id);
  f.db.prepare('UPDATE rpg_equipment_recovery_balances SET dust=0 WHERE char_id=?').run(f.id);
  await assert.rejects(Shop.buy(f.env, f.id, { collectionId: collection.id, requirementId: requirement.id, requestId: 'need-dust' }, T0), /精煉塵不足/);
  assert.equal(f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(f.id).gold, cost.gold + 50);
  assert.equal(f.db.prepare('SELECT dust FROM rpg_equipment_recovery_balances WHERE char_id=?').get(f.id).dust, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM rpg_equipment WHERE source='gearbook_shop'").get().n, 0);
});

test('a lost buy response can be resent with the same requestId and does not double-charge', async t => {
  const f = await fixture(t);
  const { collection, requirement } = firstOpen(f);
  const body = { collectionId: collection.id, requirementId: requirement.id, requestId: 'shop-idempotent' };
  const first = await Shop.buy(f.env, f.id, body, T0);
  const gold = f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(f.id).gold;
  const dust = f.db.prepare('SELECT dust FROM rpg_equipment_recovery_balances WHERE char_id=?').get(f.id).dust;
  const replay = await Shop.buy(f.env, f.id, body, T0);
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.itemId, first.result.itemId);
  assert.equal(f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(f.id).gold, gold);
  assert.equal(f.db.prepare('SELECT dust FROM rpg_equipment_recovery_balances WHERE char_id=?').get(f.id).dust, dust);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM rpg_equipment WHERE source='gearbook_shop'").get().n, 1);
  await assert.rejects(Shop.buy(f.env, f.id, { ...body, requirementId: collection.requirements[1].id }, T0), { code: 'request_reused' });
});

test('view attaches prices only on unregistered slots and preview matches the buy receipt', async t => {
  const f = await fixture(t);
  const { collection, requirement } = firstOpen(f);
  const view = await Collection.view(f.env, f.id, T0);
  const offer = view.collections[0].requirements[0].shop;
  const cost = gearbookShopCost(requirement);
  assert.equal(offer.gold, cost.gold);
  assert.equal(offer.dust, cost.dust);
  assert.equal(offer.bound, true);
  assert.equal(offer.wearable, true);
  assert.equal(offer.tradeable, false);
  assert.equal(offer.registered, false);
  assert.equal(offer.affordable, true);
  const preview = await Shop.preview(f.env, f.id, { collectionId: collection.id, requirementId: requirement.id }, T0);
  assert.equal(preview.gold, cost.gold);
  const bought = await Shop.buy(f.env, f.id, { collectionId: collection.id, requirementId: requirement.id, requestId: 'shop-from-view' }, T0);
  const after = await Collection.view(f.env, f.id, T0);
  const filled = after.collections[0].requirements[0];
  // the purchased item is in the bag, the slot itself stays unregistered until donated
  assert.equal(filled.registered, null);
  assert.equal(filled.shop.registered, false);
  const item = f.db.prepare('SELECT * FROM rpg_equipment WHERE id=?').get(bought.result.itemId);
  assert.equal(item.bound, 1);
  assert.ok(after.shop.gold < view.shop.gold);
  assert.ok(after.shop.dust < view.shop.dust);
});

test('registering a slot blocks further exchange of that slot', async t => {
  const f = await fixture(t);
  const collection = f.catalog[0], requirement = collection.requirements[0];
  const bought = await Shop.buy(f.env, f.id, { collectionId: collection.id, requirementId: requirement.id, requestId: 'shop-to-register' }, T0);
  const item = f.db.prepare('SELECT * FROM rpg_equipment WHERE id=?').get(bought.result.itemId);
  item.enhance_level = requirement.minEnhance;
  f.db.prepare('UPDATE rpg_equipment SET enhance_level=? WHERE id=?').run(requirement.minEnhance, item.id);
  const preview = await Collection.preview(f.env, f.id, { collectionId: collection.id, requirementId: requirement.id, itemId: item.id }, T0);
  await Collection.submit(f.env, f.id, { collectionId: collection.id, requirementId: requirement.id, itemId: item.id, token: preview.token, requestId: 'donate-shop-gear' }, T0);
  await assert.rejects(Shop.preview(f.env, f.id, { collectionId: collection.id, requirementId: requirement.id }, T0), /已填入/);
  await assert.rejects(Shop.buy(f.env, f.id, { collectionId: collection.id, requirementId: requirement.id, requestId: 'after-register' }, T0), /已填入/);
  assert.equal(f.db.prepare('SELECT 1 FROM rpg_equipment WHERE id=?').get(item.id), undefined);
});
