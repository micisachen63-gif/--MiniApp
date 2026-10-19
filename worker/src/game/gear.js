import {rollAffixes} from './affixes.js';
import {gearRarity} from './gear-quality.js';
// Shop / boss / relic gear (pure). Returns rows in the D1 rpg_equipment shape (v0.4: + grade, affix_json, bound, trade_id).
import { WEAPON_KINDS, ARMOR_FAMILIES, WEAPON_ATK, ARMOR_DEF, WEAPON_PRICE, BRANCH_WEAPON_PRICE_MULT, ARMOR_PRICE, TIER_PREFIX, TIER_LEVEL_REQ,
  RARITIES, RARITY_KEYS, ELEMENT_KEYS, SLOTS, SLOT_NAMES, MAX_OPEN_MAP, COUNTERPART_WEAPON, SLOT_SPEC, SLOT_CAPACITY, CLASS_ARMOR_SLOTS, SHARED_SLOTS,
  SHARED_NAMES, RELIC, CLASS_KEYS, CLASSES } from './constants.js';
import { mapForLevel } from './formulas.js';
import { randInt, pick } from './rng.js';

export function rollRarity(rng, floor = null) {
  let r = rng() * 100; let key = 'supreme';
  for (const k of RARITY_KEYS) { if (r < RARITIES[k].weight) { key = k; break; } r -= RARITIES[k].weight; }
  if (floor && RARITY_KEYS.indexOf(key) < RARITY_KEYS.indexOf(floor)) key = floor;
  return key;
}
export const isShared = (slot) => SHARED_SLOTS.includes(slot);
export const capacity = (slot) => SLOT_CAPACITY[slot] || 1;
export const weaponPrice = (kind, tier) => Math.round(WEAPON_PRICE[tier] * (WEAPON_KINDS[kind].branch ? BRANCH_WEAPON_PRICE_MULT : 1));
export const armorPrice = (slot, tier) => (slot === 'armor' ? ARMOR_PRICE.armor[tier] : ARMOR_PRICE[slot]?.[tier] ?? ARMOR_PRICE.piece[tier]);
export const gearName = (cls, slot, tier) => (isShared(slot) ? SHARED_NAMES[slot][tier] : `${TIER_PREFIX[tier]}${ARMOR_FAMILIES[cls].pieces[slot]}`);
const typeName = (cls, slot) => (isShared(slot) ? SLOT_NAMES[slot] : `${ARMOR_FAMILIES[cls].name}${SLOT_NAMES[slot]}`);
const descOf = (cls, slot) => {
  const sp = SLOT_SPEC[slot]; const parts = [];
  if (sp.main === 'mp') parts.push('MaxMP'); if (sp.main === 'atk') parts.push('ATK');
  if (sp.main === 'def') parts.push('DEF'); for (const k of Object.keys(sp.flat)) parts.push(k.toUpperCase());
  if (sp.pct.takenPct) parts.push('受傷 −1%'); if (sp.pct.critPct) parts.push('爆擊 +1%'); if (sp.pct.maxMpPct) parts.push('MaxMP +1%');
  return (isShared(slot) ? '全職業通用・' : `${ARMOR_FAMILIES[cls].desc}・`) + parts.join('／');
};

/** offers for this character: own-class weapons (+ own branch), own-class armor, shared slots; tier ≤ current map tier and ≤ open maps */
export function gearOffers(char) {
  const maxTier = Math.min(mapForLevel(char.level), MAX_OPEN_MAP); const branch = String(char.class_path || '')[0] || null; const out = [];
  for (let tier = 1; tier <= maxTier; tier++) {
    for (const [kind, w] of Object.entries(WEAPON_KINDS)) {
      if (w.cls !== char.base_class || !w.names[tier]) continue;
      if (w.branch && w.branch !== branch) continue;
      out.push({ code: `w.${kind}.${tier}`, slot: 'weapon', group: 'weapon', kind, tier, name: w.names[tier], type: w.type, branch: w.branch, price: weaponPrice(kind, tier), levelReq: TIER_LEVEL_REQ[tier], desc: w.desc || '職業通用' });
    }
    const fam = ARMOR_FAMILIES[char.base_class];
    for (const slot of SLOTS.filter((s) => s !== 'weapon')) {
      const shared = isShared(slot);
      out.push({ code: `a.${slot}.${tier}`, slot, group: ['earring', 'ring'].includes(slot) ? 'accessory' : 'armor', kind: shared ? slot : fam.key, tier, name: gearName(char.base_class, slot, tier),
        type: typeName(char.base_class, slot), branch: null, price: armorPrice(slot, tier), levelReq: TIER_LEVEL_REQ[tier], desc: descOf(char.base_class, slot) });
    }
  }
  return out;
}
export function findOffer(char, code) { return gearOffers(char).find((o) => o.code === code) || null; }

const roll = (rng, [a, b], m = 1) => Math.max(1, Math.round(randInt(rng, a, b) * m));
/** flat secondary stats for slot/tier (relics ×1.25) */
export function flatFor(slot, tier, mult = 1) {
  const f = SLOT_SPEC[slot]?.flat || {}; return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Math.round(v[tier - 1] * mult)]));
}
export function rollAffix(rng, tier) {
  const [key, , vals] = pick(rng, RELIC.affixes); return { [key]: vals[tier - 1] };
}

/** generate an equipment row. source: shop | boss | starter | relic_boss | relic_elite */
export function makeGear({ id, tgId, cls, slot, kind, tier, rng, now, source = 'shop', rarityFloor = null, bonusPct = 0, prefix = '', forceRarity = null, relic = false }) {
  if (!SLOTS.includes(slot)) throw new Error(`unknown slot ${slot}`);
  const element = pick(rng, ELEMENT_KEYS); const rarity = gearRarity({grade:relic?'relic':'normal',element_tier:forceRarity || rollRarity(rng, relic ? RELIC.rarityFloor : rarityFloor)});
  const mult = (1 + bonusPct) * (relic ? RELIC.statMult : 1);
  let name, base, bonus = {}, classReq = cls, branchReq = null;
  if (slot === 'weapon') {
    const w = WEAPON_KINDS[kind]; if (!w || w.cls !== cls || !w.names[tier]) throw new Error('weapon not for this class');
    name = w.names[tier]; base = roll(rng, WEAPON_ATK[tier], mult); bonus = { ...w.bonus }; branchReq = w.branch;
  } else {
    const sp = SLOT_SPEC[slot]; const shared = isShared(slot);
    if (shared) { classReq = 'any'; kind = slot; } else { kind = ARMOR_FAMILIES[cls].key; bonus = { ...ARMOR_FAMILIES[cls].perPiece }; }
    name = gearName(cls, slot, tier);
    if (sp.main === 'def') base = roll(rng, ARMOR_DEF[tier], sp.defShare * (shared ? 1 : ARMOR_FAMILIES[cls].defMult) * mult);   // shared DEF × wearer family at use time
    else base = roll(rng, sp.range[tier], mult);
    for (const [k, v] of Object.entries({ ...sp.pct })) bonus[k] = Math.round(((bonus[k] || 0) + v) * 1e4) / 1e4;
    Object.assign(bonus, flatFor(slot, tier, mult));
  }
  let elemStat = randInt(rng, Math.max(1, Math.round(base * 0.2)), Math.max(1, Math.round(base * 0.4)));
  if (bonus.elemStatMult) elemStat = Math.round(elemStat * bonus.elemStatMult);
  return { id, tg_id: tgId, slot, kind, class_req: classReq, branch_req: branchReq, tier, level_req: TIER_LEVEL_REQ[tier], name: (relic ? RELIC.prefix : '') + prefix + name, source,
    base_stat: base, bonus_json: JSON.stringify(bonus), element, element_stat: elemStat, element_tier: rarity, enhance_level: 0, is_equipped: 0,
    convert_token: branchReq ? 1 : 0, created_at: now, grade: relic ? 'relic' : 'normal', affix_json: relic ? JSON.stringify(rollAffix(rng, tier)) : null,
    affixes_json: JSON.stringify(rollAffixes({tier,class_req:classReq},rng)),
    bound: source === 'starter' ? 1 : 0, trade_id: null };
}

/**
 * 遺物 drop: random slot type; class-specific pieces (weapon + 4 class armor) get a RANDOM class (any of the 3, not the
 * winner's); weapons of a random kind available at that tier (general or either branch).
 */
export function makeRelic({ id, tgId, tier, rng, now, source }) {
  const slot = pick(rng, SLOTS); const cls = pick(rng, CLASS_KEYS);
  let kind = null;
  if (slot === 'weapon') kind = pick(rng, Object.entries(WEAPON_KINDS).filter(([, w]) => w.cls === cls && w.names[tier]).map(([k]) => k));
  return makeGear({ id, tgId, cls, slot, kind, tier, rng, now, source, relic: true });
}

/** Class-usable, tradeable equipment dropped by a surviving elite. */
export function makeEliteGear({ id, tgId, cls, classPath = '', tier, rng, now, rarityFloor='advanced' }) {
  const slot = pick(rng, SLOTS);
  const kind = slot === 'weapon'
    ? pick(rng, Object.entries(WEAPON_KINDS).filter(([, w]) => w.cls === cls && w.names[tier] && (!w.branch || w.branch === String(classPath || '')[0])).map(([k]) => k))
    : isShared(slot) ? slot : ARMOR_FAMILIES[cls].key;
  return makeGear({ id, tgId, cls, slot, kind, tier, rng, now, source: 'elite', rarityFloor, prefix: '菁英' });
}

export function canEquip(char, item) {
  if (String(item.tg_id) !== String(char.tg_id)) return '這不是你的裝備';
  if (item.trade_id) return '交易中的裝備不能穿';
  if (item.class_req !== 'any' && item.class_req !== char.base_class) return `職業不符（${CLASSES[item.class_req]?.name || item.class_req}專用）`;
  if (item.branch_req && String(char.class_path || '')[0] !== item.branch_req) return '轉職路線不符';
  if (item.level_req > char.level) return `需要 Lv${item.level_req}`;
  return null;
}
/** which position (1/2 for earring/ring, 1 otherwise) an equip goes to: requested, else first free, else 1 */
export function equipPosition(equipment, item, requested = null) {
  const cap = capacity(item.slot);
  if (cap === 1) return 1;
  if (requested != null) { const p = Number(requested); if (!Number.isInteger(p) || p < 1 || p > cap) throw new Error('bad position'); return p; }
  const used = new Set(equipment.filter((e) => e.slot === item.slot && e.is_equipped && e.id !== item.id).map((e) => e.is_equipped));
  for (let p = 1; p <= cap; p++) if (!used.has(p)) return p;
  return 1;
}
/** Shop buyback: all eligible gear sells for one third of its base shop price. */
export function gearSellPrice(item) {
  const price = item.slot === 'weapon' ? weaponPrice(item.kind, item.tier) : armorPrice(item.slot, item.tier);
  return Math.max(1, Math.floor(price / 3));
}
export function gearSellBlock(item) {
  if (item.is_equipped) return '請先卸下裝備再出售';
  if (item.trade_id) return '交易中的裝備不能出售';
  return null;
}

/** v0.4: trade lock — starter gear, anything ever equipped (bound) and gear in a trade can't be offered */
export function tradeBlock(item) {
  if (item.is_equipped) return '穿戴中的裝備要先卸下';
  if (item.bound) return item.grade === 'relic' ? '遺物穿過後已綁定，不能交易' : item.source === 'starter' ? '新手裝備不能交易' : '穿過的裝備已綁定，不能交易';
  if (item.trade_id) return '這件裝備已經在另一筆交易中';
  return null;
}
/** one-time free conversion of a branch weapon to the counterpart branch (keeps tier/rarity/element/enhance) */
export function convertWeapon(item) {
  const to = COUNTERPART_WEAPON[item.kind]; if (!to || !item.convert_token) return null;
  const w = WEAPON_KINDS[to];
  const previous=JSON.parse(item.bonus_json||'{}');
  return { ...item, kind: to, branch_req: w.branch, name: item.name.replace(WEAPON_KINDS[item.kind].names[item.tier], w.names[item.tier]), bonus_json: JSON.stringify({...w.bonus,...(previous.starRingGearVersion?{starRingGearVersion:previous.starRingGearVersion}:{})}), convert_token: 0, is_equipped: 0 };
}
export { CLASS_ARMOR_SLOTS };
