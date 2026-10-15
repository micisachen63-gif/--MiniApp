import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, TRADE, BLESSED_DROPS } from '../src/game/constants.js';
import { enhance, enhanceOdds, blessedScrollFor } from '../src/game/enhance.js';
import { itemOffers, checkItemPurchase } from '../src/game/shop.js';
import { mkChar } from './helpers.js';

for (const [slot, key] of [['weapon', 'blessed_scroll_w'], ['armor', 'blessed_scroll_a'], ['ring', 'blessed_scroll_a']]) {
  test(`blessed ${slot}: +10 percentage points, one scroll, no ordinary scroll consumed`, () => {
    const item = { slot, tier: 4, enhance_level: slot === 'weapon' ? 6 : 4 };
    assert.equal(blessedScrollFor(item), key);
    const normal = enhanceOdds(item), blessed = enhanceOdds(item, true);
    assert.equal(Math.round((blessed.success - normal.success) * 100), 10);
    assert.equal(blessed.break, normal.break);
    assert.ok(blessed.nothing < normal.nothing);
    const inv = { [key]: 2, scroll_w: 50, scroll_a: 50 };
    const out = enhance(item, inv, () => 0.38, true);
    assert.equal(out.result, 'success');
    assert.deepEqual(out.used, { [key]: 1 });
    assert.equal(inv[key], 1);
    assert.equal(inv.scroll_w, 50);
    assert.equal(inv.scroll_a, 50);
    assert.equal(item.enhance_level, (slot === 'weapon' ? 6 : 4) + 1);
  });
}
test('blessed scrolls: safe success increases to 60%, without break', () => {
  const o = enhanceOdds({ slot: 'weapon', enhance_level: 0 }, true);
  assert.equal(o.success, 0.6); assert.equal(o.break, 0);
});
test('blessed scrolls: tradeable but not sold by shop', () => {
  const char = mkChar({ level: 80, gold: 100000 });
  for (const key of BLESSED_DROPS.keys) {
    assert.ok(ITEMS[key]); assert.ok(TRADE.tradeableItems.includes(key));
    assert.ok(!itemOffers(char).some((o) => o.item === key));
    assert.throws(() => checkItemPurchase(char, {}, key, 1), /商店沒有賣/);
    assert.ok(!('price' in ITEMS[key]));
  }
});
test('blessed scrolls: wrong-type scroll cannot enhance', () => {
  const item = { slot: 'weapon', tier: 1, enhance_level: 0 };
  assert.throws(() => enhance(item, { blessed_scroll_a: 10 }, () => 0, true), /受祝福的武器強化卷軸/);
});
