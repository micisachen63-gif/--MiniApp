// Consumable shop rules (pure). Gear offers live in gear.js.
import { ITEMS, POTIONS, MAX_OPEN_MAP } from './constants.js';
import { mapForLevel } from './formulas.js';
import { classTier } from './stats.js';
import { GameError } from './classes.js';
import { gearOffers } from './gear.js';
import {activeSettings} from './guardian-sigil-config.js';

// 裝備轉蛋：目前可穿戴最高 T；遺物保留首領與菁英獨有。
export const GACHA_RATES = Object.freeze([['legendary',85],['supreme',15]]);
export function gachaOffers(char) {
  const tier=Math.min(mapForLevel(char.level),MAX_OPEN_MAP);
  return [
    {type:'weapon',name:'⚔️ 武器轉蛋',tier,price:10000,slots:['weapon'],description:'保證紫色以上，對應目前等級與職業／轉職路線的武器'},
    {type:'armor',name:'🛡️ 防具轉蛋',tier,price:5000,slots:['armor','helmet','gloves','boots','belt','undershirt'],description:'保證紫色以上，對應目前等級與職業的六部位隨機防具'}
  ];
}
export function drawGacha(char,type,rng){
  const g=gachaOffers(char).find(x=>x.type===type);if(!g)throw new GameError('gacha_type','轉蛋類型無效');
  const pool=gearOffers(char).filter(o=>o.tier===g.tier&&(type==='weapon'?o.group==='weapon':o.group==='armor'));
  if(!pool.length)throw new GameError('gacha_empty','目前沒有符合職業的裝備');
  const offer=pool[Math.min(pool.length-1,Math.floor(rng()*pool.length))];let r=rng()*100,rarity='supreme';
  for(const [key,weight] of GACHA_RATES){if(r<weight){rarity=key;break;}r-=weight}
  return {offer,rarity,price:g.price};
}


export const wardPrice = (level) => ITEMS.ward.priceBase * Math.min(4, Math.ceil(mapForLevel(level) / 3));

export function itemOffers(char) {
  const T = Math.min(mapForLevel(char.level), MAX_OPEN_MAP); const potionTier = Math.min(4, Math.ceil(T / 3)); const out = [];
  if(char.level>=15)out.push({item:'guardian_summon_stone',name:ITEMS.guardian_summon_stone.name,price:(char.guardianAssistSettings||activeSettings().assist).stoneGold,desc:ITEMS.guardian_summon_stone.desc});
  for (const [k, p] of Object.entries(POTIONS)) if (p.tier <= potionTier) out.push({ item: k, name: p.name, price: p.price, desc: `${p.kind === 'red' ? 'HP' : 'MP'} +${p.heal}` });
  for (const k of ['scroll_w', 'scroll_a', 'scroll_r', 'unbind']) out.push({ item: k, name: ITEMS[k].name, price: ITEMS[k].price, desc: ITEMS[k].desc });
  out.push({ item: 'ward', name: ITEMS.ward.name, price: wardPrice(char.level), desc: `${ITEMS.ward.desc}（最多持有 ${ITEMS.ward.maxHold}、每日限購 ${ITEMS.ward.dailyBuy}）` });
  if (classTier(char.class_path) >= 1) out.push({ item: 'reselect_1', name: ITEMS.reselect_1.name, price: ITEMS.reselect_1.price, desc: ITEMS.reselect_1.desc });
  if (classTier(char.class_path) >= 2) out.push({ item: 'reselect_2', name: ITEMS.reselect_2.name, price: ITEMS.reselect_2.price, desc: ITEMS.reselect_2.desc });
  return out;
}

/** validate a consumable purchase. dailyBought: how many of this item were bought today. returns { price, total } */
export function checkItemPurchase(char, inv, item, qty, dailyBought = 0) {
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) throw new GameError('qty', '數量無效');
  const offer = itemOffers(char).find((o) => o.item === item);
  if (!offer) throw new GameError('not_sold', '商店沒有賣這個（或等級／轉職不足）');
  const def = ITEMS[item];
  if (def.maxHold && (inv[item] || 0) + qty > def.maxHold) throw new GameError('max_hold', `${def.name}最多持有 ${def.maxHold} 個`);
  if (def.dailyBuy && dailyBought + qty > def.dailyBuy) throw new GameError('daily_limit', `${def.name}每日限購 ${def.dailyBuy} 個（今日已買 ${dailyBought}）`);
  const total = offer.price * qty;
  if ((char.gold || 0) < total) throw new GameError('gold', `金幣不足（需要 ${total.toLocaleString()}，你有 ${(char.gold || 0).toLocaleString()}）`);
  return { price: offer.price, total };
}
