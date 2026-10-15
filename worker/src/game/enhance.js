import {affixCost,rollAffixes,affixView} from './affixes.js';
// Enhancement (pet-system rules + tier scaling in stats.js) and 洗屬性 reroll (pure; mutate the item + inventory).
import { ENHANCE, ITEMS, RARITY_KEYS, RARITIES, ELEMENT_KEYS, WEAPON_KINDS } from './constants.js';
import { rollRarity } from './gear.js';
import { randInt, pick } from './rng.js';
import { GameError } from './classes.js';

export const scrollFor = (item) => (item.slot === 'weapon' ? 'scroll_w' : 'scroll_a');
export const blessedScrollFor = (item) => (item.slot === 'weapon' ? 'blessed_scroll_w' : 'blessed_scroll_a');
export const scrollCost = (item) => Math.max(1, Number(item.tier) || 1);
export const safeLimit = (item) => (item.slot === 'weapon' ? ENHANCE.safe.weapon : ENHANCE.safe.armor);
/** odds for the NEXT attempt */
export function enhanceOdds(item, blessed = false) {
  const lvl = item.enhance_level || 0;
  if (lvl >= ENHANCE.max) return null;
  const safe = lvl < safeLimit(item);
  const success = (safe ? ENHANCE.safeSuccess : ENHANCE.overSuccess) + (blessed ? 0.10 : 0);
  const breaking = safe ? 0 : ENHANCE.overBreak;
  return { success, nothing: Math.max(0, 1 - success - breaking), break: breaking, safe, ...(blessed ? { blessed: true } : {}) };
}
function pay(inv, key, n) {
  if ((inv[key] || 0) < n) throw new GameError('no_scroll', `需要「${ITEMS[key].name}」×${n}（你有 ${inv[key] || 0}）`);
  inv[key] -= n; return { [key]: n };
}

/** one attempt. result: success | nothing | break (item must then be deleted by the caller) */
export function enhance(item, inv, rng, blessed = false) {
  const odds = enhanceOdds(item, blessed); if (!odds) throw new GameError('max', `已經 +${ENHANCE.max}（上限）`);
  const key = blessed ? blessedScrollFor(item) : scrollFor(item);
  const used = pay(inv, key, blessed ? 1 : scrollCost(item)); const from = item.enhance_level || 0; const r = rng();
  let result;
  if (r < odds.success) { result = 'success'; item.enhance_level = from + 1; }
  else if (r < odds.success + odds.break) result = 'break';
  else result = 'nothing';
  return { result, from, to: result === 'success' ? from + 1 : from, safe: odds.safe, used,
    announce: (result === 'success' ? from + 1 : from) >= (item.slot === 'weapon' ? 8 : 6) && (result === 'success' || result === 'break') };
}

/** Reroll only independent affixes; rarity and elemental stats remain stable. */
export function reroll(item,inv,rng,locks=[],typeLocks=[]){
 const cost=affixCost(item,locks,typeLocks);const before=affixView(item);const lines=rollAffixes(item,rng,cost.locks,cost.typeLocks);const used=pay(inv,'scroll_r',cost.scrolls);item.affixes_json=JSON.stringify(lines);const after=affixView(item);return {before,after,used,locks:cost.locks,typeLocks:cost.typeLocks,fee:cost.fee,upgraded:after.score>before.score,rarityName:after.quality};
}
