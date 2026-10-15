// 交易 rules (pure). Persistence + escrow live in src/services/trade.js.
import { TRADE, ITEMS } from './constants.js';
import { GameError } from './classes.js';
import { tradeBlock } from './gear.js';

/** 5% of the gold part, rounded UP (a sink that never rounds to zero), taken from what the receiver gets */
export const tradeTax = (gold) => (gold > 0 ? Math.ceil(gold * TRADE.taxPct) : 0);
export const netGold = (gold) => Math.max(0, gold - tradeTax(gold));
export const isTradeableItem = (key) => TRADE.tradeableItems.includes(key);

export function checkGold(gold) {
  if (!Number.isInteger(gold) || gold < 0) throw new GameError('gold_amount', '金幣數量無效');
  if (gold > TRADE.maxGold) throw new GameError('gold_cap', `每筆交易每人最多 ${TRADE.maxGold.toLocaleString()} 金幣`);
}
export function checkItemLine(key, qty) {
  if (!ITEMS[key]) throw new GameError('item', '沒有這個道具');
  if (!isTradeableItem(key)) throw new GameError('untradeable', `「${ITEMS[key].name}」不能交易`);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99999) throw new GameError('qty', '數量無效');
}
/** equipment line: must be yours, not equipped, never bound, not already in a trade */
export function checkEquipLine(item, tg) {
  if (!item || String(item.tg_id) !== String(tg)) throw new GameError('not_found', '找不到這件裝備');
  const why = tradeBlock(item); if (why) throw new GameError('untradeable', why);
}
export const sideOf = (trade, tg) => (String(trade.a_tg) === String(tg) ? 'a' : String(trade.b_tg) === String(tg) ? 'b' : null);
export const otherSide = (s) => (s === 'a' ? 'b' : 'a');
