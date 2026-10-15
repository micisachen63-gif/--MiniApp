// v0.5 item posts (分享至群組 / 遺物 / 決鬥戰利品) + 赫密士解契卷 cost (pure).
import { UNBIND, SHARE } from './constants.js';
import { GameError } from './classes.js';
import gearNames from '../../public/gear-names.json' with { type: 'json' };

const WPN = { sword: 'wpn_sword', greatsword: 'wpn_greatsword', sword_shield: 'wpn_sword_shield', staff: 'wpn_staff', elem_staff: 'wpn_elemental_staff', wand: 'wpn_grimoire', longbow: 'wpn_longbow', compound_bow: 'wpn_composite_bow', crossbow: 'wpn_crossbow' };
const FAM = { sword: 'plate', archer: 'leather', mage: 'cloth' };
const ARMOR_ART = { armor: { plate: 'arm_plate', leather: 'arm_leather', cloth: 'arm_robe' }, helmet: { plate: 'helm_plate', leather: 'helm_leather', cloth: 'helm_cloth' },
  gloves: { plate: 'gloves_plate', leather: 'gloves_leather', cloth: 'gloves_cloth' }, boots: { plate: 'boots_plate', leather: 'boots_leather', cloth: 'boots_cloth' } };
export const CARD_FRAMES = ['common', 'advanced', 'epic', 'legendary', 'supreme', 'relic'];
export const CARD_ART = [...Object.values(WPN), ...Object.values(ARMOR_ART).flatMap((x) => Object.values(x)), 'belt', 'undershirt', 'earring', 'ring'];

/** same mapping as the Mini App's GEAR_ART (worker/public/app.js) */
export function gearArt(e) {
  const name = String(e.name || '').replace(/^(?:(?:遺物・|菁英))*/, '').trim();
  if (gearNames[name]) return gearNames[name];
  const classReq = e.class_req ?? e.classReq;
  if (e.slot === 'weapon') return WPN[e.kind] || 'wpn_sword';
  if (ARMOR_ART[e.slot]) return ARMOR_ART[e.slot][FAM[classReq]] || ARMOR_ART[e.slot].plate;
  return ['belt', 'undershirt', 'earring', 'ring'].includes(e.slot) ? e.slot : 'wpn_sword';
}
/** composed item-card JPG (art/cards, built by art-gen/cards.py): painted art + rarity frame + rarity label */
export const cardPhoto = (e) => {
  const art = gearArt(e);
  const frame = e.grade === 'relic' ? 'relic' : (e.element_tier ?? e.rarity ?? 'common');
  return `/art/cards/${art.startsWith('gear_') ? 'equipment-20261011-r2/' : ''}${art}_${CARD_FRAMES.includes(frame) ? frame : 'common'}.jpg`;
};

/** the item fields a group caption needs, frozen at post time (from views.equipmentView output) */
export function snapshotOf(v) {
  const keep = ['name', 'slot', 'slotName', 'type', 'tier', 'levelReq', 'rarity', 'rarityName', 'grade', 'gradeName', 'element', 'elementName', 'stat', 'statName', 'elemStat',
    'extras', 'pct', 'affix', 'affixes', 'enhance', 'classReq', 'className', 'branchReq', 'bound', 'equipped', 'inTrade', 'kind', 'source'];
  return Object.fromEntries(keep.map((k) => [k, v[k] ?? null]));
}

/** Sharing is a showcase; worn/bound/starter gear stays owned and equipped. Escrow is excluded. */
export function shareBlock(item, tg) {
  if (!item || String(item.tg_id) !== String(tg)) return '找不到這件裝備';
  return item.trade_id ? '裝備正在交易保管中，完成或取消交易後再分享' : null;
}
export function checkShareRate({ last = null, today = 0, sameItemAt = null }, now) {
  if (last && now - last < SHARE.cooldownMs) throw new GameError('cooldown', `分享太快了，${Math.ceil((SHARE.cooldownMs - (now - last)) / 1000)} 秒後再試`);
  if (today >= SHARE.dailyCap) throw new GameError('daily_limit', `今天已經分享 ${SHARE.dailyCap} 次了，明天再來`);
  if (sameItemAt && now - sameItemAt < SHARE.sameItemMs) throw new GameError('cooldown', '這件裝備剛剛分享過了，10 分鐘後再分享');
}

/** 赫密士解契卷 needed: ceil(T × rarity × (relic ? 3 : 1)) + floor(enhance / 3) */
export function unbindCost(item) {
  const r = UNBIND.rarity[item.element_tier] ?? 1; const g = item.grade === 'relic' ? UNBIND.relicMult : 1;
  return Math.ceil((item.tier || 1) * r * g) + Math.floor((item.enhance_level || 0) / UNBIND.enhanceStep);
}
/** why this item can't be unbound (null = ok) */
export function unbindBlock(item) {
  if (!item.bound) return '這件裝備沒有綁定';
  if (item.is_equipped) return '穿戴中的裝備要先卸下';
  if (item.trade_id) return '交易中的裝備不能解契';
  if (item.source === 'starter') return '新手裝備不能解契';
  return null;
}
