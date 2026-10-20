import {imprintMultiplier} from './tower-progression.js';
import {idleBalanceVersion,idleEncounter} from './pve-balance.js';
import {collectionBlessing} from './collection-blessings.js';
import {gearRarity} from './gear-quality.js';
import {GEAR_GROWTH,tierBaseBonus} from './gear-growth.js';
import {resistanceRate} from './elements.js';
import { THIEF_NODES } from './thief-data.js';
import {affixTotals} from './affixes.js';
import {specializeNode} from './advanced-specializations.js';
// Derived character stats (pure). Equipment rows use the D1 rpg_equipment shape.
import { CLASSES, BRANCHES2, ARMOR_FAMILIES, RARITIES, RELIC, STAR_RING_GEAR, WEAPON_ATK, ARMOR_DEF, GENERAL_WEAPON, IDLE, MAPS, SLOT_SPEC, SHARED_SLOTS, SLOTS } from './constants.js';
import { monsterPressure, mapForLevel } from './formulas.js';

const parseBonus = (b) => (typeof b === 'string' ? (b ? JSON.parse(b) : {}) : (b || {}));
export const classTier = (path) => String(path || '').length;
export function nodeFor(baseClass, path) {
  const cls = CLASSES[baseClass]; if (!cls) throw new Error(`unknown class ${baseClass}`);
  const p = String(path || '');
  if (baseClass === 'thief' && !Object.hasOwn(THIEF_NODES, p)) throw new Error(`unknown branch ${p}`);
  if (!p) return { tier: 0, path: '', name: cls.node.name, skill: cls.node.skill, passive: {}, passiveText: cls.node.passive.text };
  const b = cls.branches[p[0]]; if (!b) throw new Error(`unknown branch ${p}`);
  if (p.length === 1) return { tier: 1, path: p[0], name: b.name, skill: b.skill, passive: b.passive, passiveText: b.passive.text, weapon: b.weapon };
  const raw = BRANCHES2[baseClass]?.[p[0]]?.[p[1]]; if (!raw) throw new Error(`unknown branch ${p}`);
  const n=baseClass==='thief'?THIEF_NODES[p]:specializeNode(baseClass,p,raw);
  const passive = { ...b.passive }; for (const [k, v] of Object.entries(n.passive)) if (k !== 'text') passive[k] = (passive[k] || 0) + v;   // tier-2 stacks on tier-1
  if (baseClass === 'thief') {
    const thief = THIEF_NODES[p];
    return { tier: p.length, path: p, name: thief.name, skill: thief.skill, passive, passiveText: `${thief.passive.text}；${b.passive.text}`, specialization:thief.specialization||null, weapon: b.weapon, parent: b.name };
  }
  return { tier: p.length, path: p, name:n.name, skill:n.skill, passive, passiveText:`${n.passive.text}；${b.passive.text}`, specialization:n.specialization||null, weapon:b.weapon,parent:b.name };
}

/** enhancement bonus: pet-system steps × tier scale (P2 feature; enhance_level is 0 in P1) */
export function enhanceBonus(slot, level, tier = 1) {
  if (!level || level <= 0) return 0;
  const weapon = slot === 'weapon'; const safe = weapon ? 6 : 4; const step = weapon ? 2 : 1;
  let b = Math.min(level, safe) * step;
  const extraW = [5, 8, 12, 18], extraA = [3, 5, 8, 12];
  for (let i = 1; i <= level - safe; i++) b += weapon ? (extraW[i - 1] ?? 25) : (extraA[i - 1] ?? 18);
  // The original tier curve was authored for T1–T4. Keep its values and cap
  // later tiers at T4 so high-tier upgrades remain useful without scaling into
  // runaway flat stats (especially on the rare +10…+15 range).
  const tierScale = [1, 3, 6, 10][Math.max(0, Math.min(3, Math.floor(Number(tier) || 1) - 1))];
  return b * tierScale;
}
/** Main (+enhance) x rarity; relics protect main rarity and enhance returns.
 * Shared DEF pieces also use the wearer's armor-family defMult. */
export function itemStat(item, wearerClass = null, growthVersion=GEAR_GROWTH.version) {
  const mult = RARITIES[gearRarity(item)]?.mult ?? 1;
  const relic=item.grade==='relic',expedition=item.source==='star_ring'&&!relic?(growthVersion<2?GEAR_GROWTH.legacyExpeditionMult:STAR_RING_GEAR.statMult):1;
  const base=item.base_stat+tierBaseBonus(item,growthVersion,wearerClass)*(relic?RELIC.statMult:1);
  const enh = enhanceBonus(item.slot, item.enhance_level, item.tier)*(relic?RELIC.enhanceMult:1);
  const fam = SHARED_SLOTS.includes(item.slot) && SLOT_SPEC[item.slot]?.main === 'def' ? (ARMOR_FAMILIES[wearerClass]?.defMult ?? 0.75) : 1;
  return { main: Math.round(Math.round((base + enh) * mult * fam * expedition) * imprintMultiplier(item)), elem: Math.round((item.element_stat || 0) * mult * expedition) };
}
/** what base_stat means for this slot: ATK (weapon, ring) / DEF (armor slots) / MP (earring) */
export const mainStatOf = (slot) => (slot === 'weapon' ? 'atk' : SLOT_SPEC[slot]?.main || 'def');
const FLAT_KEYS = ['atk', 'def', 'hp', 'mp'];
/** flat secondaries (bonus_json) + relic affix (flat values rarity-scaled) */
export function itemExtras(item,growthVersion=GEAR_GROWTH.version) {
  const mult = RARITIES[gearRarity(item)]?.mult ?? 1; const out = { flat: { atk: 0, def: 0, hp: 0, mp: 0 }, pct: {} };
  // relic affix values are absolute (not scaled by rarity) so the number shown is the number applied
  for (const [src, m] of [[parseBonus(item.bonus_json), mult*(item.source==='star_ring'&&item.grade!=='relic'?(growthVersion<2?GEAR_GROWTH.legacyExpeditionMult:STAR_RING_GEAR.statMult):1)], [parseBonus(item.affix_json), 1]]) for (const [k, v] of Object.entries(src)) {
    if(k==='starRingGearVersion'||k==='starRingYieldVersion'||k==='towerImprint')continue;
    if (FLAT_KEYS.includes(k)) out.flat[k] += Math.round(v * m); else out.pct[k] = (out.pct[k] || 0) + v;
  }
  return out;
}
export function computeStats(char, equipped = [], level = char.level, growthVersion=GEAR_GROWTH.version) {
  const cls = CLASSES[char.base_class]; const node = nodeFor(char.base_class, char.class_path); const L = level;
  const blessing=collectionBlessing(char);
  const pct = {defPct:0,meleePct:0,rangedPct:0,magicPct:0,mitigationPct:0,mpEfficiencyPct:0,skillHastePct:0,healingPct:0,shieldPct:0,dotPct:0,summonPct:0, atkPct: 0, takenPct: 0, maxHpPct: 0, maxMpPct: 0, mpCostPct: 0, expPct: 0, critPct: 0, freeCastPct: 0, elemPct: 0, extraTargets: 0, lifestealPct: 0, healPerCastPct: 0 };
  for (const [k, v] of Object.entries(node.passive || {})) if (k in pct) pct[k] += v;
  for(const [k,v] of Object.entries(blessing?.bonuses||{}))if(k in pct)pct[k]+=v;
  const elementResist={earth:0,water:0,fire:0,wind:0,light:0,dark:0};
  let weaponAtk = 0, weaponElem = 0, element = null, armorDef = 0, defFromWeapon = 0; const flat = { atk: 0, def: 0, hp: 0, mp: 0 };
  for (const item of equipped) {
    if (!item || !item.is_equipped) continue;
    const { main, elem } = itemStat(item, char.base_class,growthVersion); const bonus = parseBonus(item.bonus_json); const x = itemExtras(item,growthVersion);
    const ms = mainStatOf(item.slot);
    if (item.slot === 'weapon') { weaponAtk = main; weaponElem = elem; element = item.element || null; defFromWeapon = bonus.defFromWeaponPct || 0; }
    else {if(item.element in elementResist)elementResist[item.element]+=elem;if (ms === 'def') armorDef += main; else flat[ms] += main;}
    for (const k of Object.keys(flat)) flat[k] += x.flat[k];
    for(const [k,v] of Object.entries(affixTotals(item))) if(k in pct)pct[k]+=v;
    for (const [k, v] of Object.entries(x.pct)) if (k in pct) pct[k] += v;
  }
  for(const k of ['meleePct','rangedPct','magicPct','healingPct','shieldPct','dotPct','summonPct'])pct[k]=Math.min(.45,pct[k]);
  pct.mitigationPct=Math.min(.25,pct.mitigationPct);pct.mpEfficiencyPct=Math.min(.3,pct.mpEfficiencyPct);pct.skillHastePct=Math.min(.25,pct.skillHastePct);pct.lifestealPct=Math.min(.2,pct.lifestealPct);pct.critPct=Math.min(.75,pct.critPct);
  pct.maxHpPct=Math.min(1,pct.maxHpPct);pct.maxMpPct=Math.min(1,pct.maxMpPct);pct.expPct=Math.min(.5,pct.expPct);pct.healPerCastPct*=1+pct.healingPct;
  const attackPctKey = {sword:'meleePct',thief:'meleePct',archer:'rangedPct',mage:'magicPct'}[char.base_class];
  pct.atkPct+=pct[attackPctKey]||0;
  const attackSpeedMultiplier = cls.attackSpeedMultiplier ?? 1;
  const hitAttackMultiplier = cls.hitAttackMultiplier ?? 1;
  // Scale the whole per-strike attack, including upgraded gear, rather than only the starting class ATK.
  const atk = Math.round((cls.atk[0] + cls.atk[1] * L + weaponAtk + flat.atk) * (1 + pct.atkPct) * hitAttackMultiplier);
  weaponElem = Math.round(weaponElem * hitAttackMultiplier);
  const def = Math.round((cls.def[0] + cls.def[1] * L + armorDef + flat.def + weaponAtk * defFromWeapon)*(1+pct.defPct));
  const maxHp = Math.round((cls.hp[0] + cls.hp[1] * L + flat.hp) * (1 + pct.maxHpPct));
  const maxMp = Math.round((cls.mp[0] + cls.mp[1] * L + flat.mp) * (1 + pct.maxMpPct));
  const taken = Math.max(0.2, cls.taken * (1 + pct.takenPct)*(1-pct.mitigationPct));
  const skill = { ...node.skill, cost: Math.max(1, Math.round(node.skill.cost * (1 + pct.mpCostPct)*(1-pct.mpEfficiencyPct))), targets: node.skill.targets + (node.skill.targets > 1 ? pct.extraTargets : 0) };
  const path=String(char.class_path||'').slice(0,2);if(char.base_class==='archer'&&path==='B1'||char.base_class==='mage'&&path==='B2')skill.mult*=1+pct.summonPct;if(char.base_class==='archer'&&path==='B2')skill.mult*=1+pct.dotPct;
  const power = Math.round(atk * skill.mult * attackSpeedMultiplier + def * 1.5 + maxHp / 10 + maxMp / 20);
  return { level: L, atk, def, maxHp, maxMp, taken, attackSpeedMultiplier, hitAttackMultiplier, skill, power, element, weaponElem, elementResist, elementResistance:Object.fromEntries(Object.keys(elementResist).map(k=>[k,resistanceRate({level:L,elementResist},k)])), node, pct, collectionBlessing:blessing };
}

/** a "standard" character of the same class/path: map-tier general weapon + the full v0.4 set (6 armor slots, 2 earrings,
 *  2 rings), common, +0, mid rolls. Power ratio r = your power / this. */
export function standardSet(baseClass, level) {
  const T = mapForLevel(level); const fam = ARMOR_FAMILIES[baseClass];
  const mid = ([a, b]) => (a + b) / 2; const common = { element_tier: 'common', enhance_level: 0, tier: T };
  const eq = [{ ...common, slot: 'weapon', base_stat: mid(WEAPON_ATK[T]), is_equipped: 1, bonus_json: '{}', kind: GENERAL_WEAPON[baseClass] }];
  for (const slot of SLOTS.filter((x) => x !== 'weapon')) {
    const sp = SLOT_SPEC[slot]; const shared = SHARED_SLOTS.includes(slot);
    const base = sp.main === 'def' ? Math.max(1, Math.round(mid(ARMOR_DEF[T]) * sp.defShare * (shared ? 1 : fam.defMult))) : Math.round(mid(sp.range[T]));
    const bonus = { ...(shared ? {} : fam.perPiece), ...Object.fromEntries(Object.entries(sp.flat).map(([k, v]) => [k, v[T - 1]])) };
    for (const [k, v] of Object.entries(sp.pct)) bonus[k] = (bonus[k] || 0) + v;
    for (let pos = 1; pos <= (['earring', 'ring'].includes(slot) ? 2 : 1); pos++) eq.push({ ...common, slot, base_stat: base, is_equipped: pos, bonus_json: JSON.stringify(bonus) });
  }
  return eq;
}
export function standardStats(baseClass, path, level) {
  // Freeze the published progression denominator. Raising it with equipment would
  // secretly slow existing players and scale away their upgrade investment.
  return computeStats({ base_class: baseClass, class_path: path }, standardSet(baseClass, level), level,1);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
/** everything the idle tick needs, for a given level */
/** gear → idle kill speed (×kills, ×EXP, ×gold). r^0.8 up to 1.5 at r≈1.66 (≈ standard set +5), then v0.5.1 soft tail
 *  (「裝備越強 掛機升等越快」): +0.3·ln(r/1.66), capped 2.0 (≈ +10 史詩/傳說) — so +6…+10 and better rarity still speed up idling. */
export const GEAR_SPEED = Object.freeze({ min: 0.3, knee: 1.5, tail: 0.3, max: 2.0 });
export function gearSpeed(r) {
  const kneeR = GEAR_SPEED.knee ** (1 / 0.8);
  if (r <= kneeR) return clamp(r ** 0.8, GEAR_SPEED.min, GEAR_SPEED.knee);
  return Math.min(GEAR_SPEED.max, GEAR_SPEED.knee + GEAR_SPEED.tail * Math.log(r / kneeR));
}
export function idleStats(char, equipped, level = char.level, {balanceVersion=idleBalanceVersion(char)}={}) {
  const s = computeStats(char, equipped, level); const std = standardStats(char.base_class, char.class_path, level);
  const r = s.power / std.power;
  // Better gear improves actual combat, but this balance pass must not multiply
  // gold/EXP production by the much larger late-tier defensive foundation.
  const previous=computeStats(char,equipped,level,1),legacyGearEfficiency=gearSpeed(previous.power/std.power);
  const g = Math.min(gearSpeed(r),legacyGearEfficiency*GEAR_GROWTH.farmingEfficiencyCap,GEAR_SPEED.max);
  const legacyDr = s.def / (s.def + 6 * level + 40);
  // Sustain is restored by the committed damage/cast in idle.js, not a second damage-reduction approximation.
  const legacyLoss = monsterPressure(level) * (1 - legacyDr) * s.taken - IDLE.hpRegenPct * s.maxHp;
  const mpRegen = IDLE.mpRegenPct * s.maxMp + 1;
  const legacyBurst = IDLE.eliteBurstPct * s.maxHp * (1 / clamp(r, 0.3, 2)) ** 1.5;
  const {hpLoss,dr,burst,version}=idleEncounter(s,level,{hpLoss:legacyLoss,dr:legacyDr,burst:legacyBurst},balanceVersion);
  // Diminishing returns keep multi-target classes attractive without letting
  // target count double both their gold and experience versus single-target paths.
  const targets = clamp(s.skill.targets, 1, 5);
  const expFactor = (1 + 0.03 * (targets - 1)) * (1 + s.pct.expPct);
  // Idle uses a normalized damage budget, not absolute ATK. Count the extra actual strikes while
  // preserving their reduced per-strike potency; multiplying only speed would inflate drops by 80%.
  const idleNativeDamageMultiplier = s.attackSpeedMultiplier * s.hitAttackMultiplier;
  const killsPerTick = 2 * (1 + 0.15 * (targets - 1)) * idleNativeDamageMultiplier;
  const map = MAPS[mapForLevel(level)];
  return { ...s, balanceVersion:version,std: std.power, r, g, dr, hpLoss, mpRegen, burst, expFactor, killsPerTick, idleNativeDamageMultiplier, map };
}
