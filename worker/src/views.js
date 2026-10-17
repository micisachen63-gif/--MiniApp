import {autoBluePct} from './game/auto-blue.js';
import {monsterPool,monsterIdentity,collectionView} from './game/monsters.js';
import {affixView,affixCost} from './game/affixes.js';
// JSON views returned to 小精靈 (and later the Mini App).
import { CLASSES, MAPS, ITEMS, SLOT_NAMES, RARITIES, ELEMENTS, WEAPON_KINDS, ARMOR_FAMILIES, BOSS, SHARED_SLOTS } from './game/constants.js';
import { expToNext, mapForLevel } from './game/formulas.js';
import { idleStats, itemStat, itemExtras, mainStatOf, classTier, nodeFor } from './game/stats.js';
import {idleCombatState} from './game/idle-combat.js';
import { supplyHours, refillPlan, atGate, gateLevel, canAdvanceNow } from './game/idle.js';
import { dailyGoldFor } from './game/daily.js';
import { canEquip, gearOffers, tradeBlock, gearSellPrice, gearSellBlock } from './game/gear.js';
import { unbindCost, unbindBlock, gearArt, shareBlock } from './game/share.js';
import { itemOffers, gachaOffers, GACHA_RATES } from './game/shop.js';
import { branchChoices } from './game/classes.js';
import { nextSlot } from './game/boss.js';
import {assistSupply} from './game/guardian-assist.js';
import {guardianStatsView} from './game/guardian-effects.js';
import {activeSettings} from './game/guardian-sigil-config.js';
import { enhanceOdds, scrollFor, blessedScrollFor, scrollCost } from './game/enhance.js';

export function equipmentView(char, e) {
  const st = itemStat(e, char.base_class); const x = itemExtras({ ...e, affix_json: null }); const ms = mainStatOf(e.slot);   // extras shown without the relic affix (listed separately)
  return { id: e.id, slot: e.slot, slotName: SLOT_NAMES[e.slot], position: e.is_equipped || 0, name: e.name, tier: e.tier, rarity: e.element_tier, rarityName: RARITIES[e.element_tier]?.name,
    affixes:affixView(e,char.class_path,char.base_class),rerollCost:affixCost(e),rerollPrices:Array.from({length:affixView(e).slots},(_,n)=>({locks:n,scrolls:Math.max(1,e.tier)*[1,2,4,7,11][n],fee:Math.max(1,e.tier)*30*(n+1)**2})),grade: e.grade || 'normal', gradeName: e.grade === 'relic' ? '遺物' : null, affix: e.affix_json ? JSON.parse(e.affix_json) : null,
    element: e.element, elementName: ELEMENTS[e.element]?.name, stat: st.main, elemStat: st.elem, statName: { atk: 'ATK', def: 'DEF', mp: 'MP', hp: 'HP' }[ms],
    extras: x.flat, pct: x.pct, kind: e.kind, classReq: e.class_req, className: CLASSES[e.class_req]?.name || '全職業',
    enhance: e.enhance_level, equipped: !!e.is_equipped, branchReq: e.branch_req, levelReq: e.level_req, source: e.source,
    type: e.slot === 'weapon' ? WEAPON_KINDS[e.kind]?.type : SHARED_SLOTS.includes(e.slot) ? SLOT_NAMES[e.slot] : ARMOR_FAMILIES[e.class_req]?.name,
    enhanceNext: enhanceOdds(e), blessedEnhanceNext: enhanceOdds(e, true), blessedScroll: blessedScrollFor(e), scroll: scrollFor(e), scrollCost: scrollCost(e), bound: !!e.bound, inTrade: e.trade_id || null, tradeBlock: tradeBlock(e), shareBlock: shareBlock(e,char.tg_id), sellPrice: gearSellPrice(e), sellBlock: gearSellBlock(e), unbindBlock: unbindBlock(e), unbindCost: unbindCost(e), art: gearArt(e),
    convertible: !!(e.branch_req && e.convert_token && e.branch_req !== String(char.class_path || '')[0] && classTier(char.class_path) >= 1),
    cannotEquip: canEquip(char, e) };
}

const branchView = (b) => ({ branch: b.branch, path: b.path, tier: b.tier, name: b.name, line: b.line, skill: b.skill, passive: b.passive.text, blurb: b.blurb, weapon: WEAPON_KINDS[b.weapon]?.type });
export function playerView({ char, inv, equipment }, { now, report = null, compact = false } = {}) {
  const equipped = equipment.filter((e) => e.is_equipped);
  const s = idleStats(char, equipped); const node = nodeFor(char.base_class, char.class_path); const map = MAPS[mapForLevel(char.level)];
  const need = expToNext(char.level); const tier = classTier(char.class_path);
  const gateMat=tier+1>=3?`trial_${tier+1}`:`mat_${tier+1}`;
  const gate = { atGate: atGate(char), gateLevel: gateLevel(char), canAdvance: canAdvanceNow(char), material: gateMat, materialName: ITEMS[gateMat]?.name, have: inv[gateMat] || 0 };
  const sup = supplyHours(char, inv, equipped);
  return {
    character: { tgId: char.tg_id, revision: Number(char.rev)||0, partyId:char.party_id||null, name: char.name, gender: char.gender, baseClass: char.base_class, baseClassName: CLASSES[char.base_class].name, emoji: CLASSES[char.base_class].emoji,
      className: node.name, classPath: char.class_path, classTier: tier, level: char.level, exp: char.exp, expNeed: Number.isFinite(need) ? need : null,
      expPct: Number.isFinite(need) ? Math.min(100, Math.floor((char.exp / need) * 1000) / 10) : 100, hp: char.hp, mp: char.mp, maxHp: s.maxHp, maxMp: s.maxMp,
      mapId: map.id, mapName: `${map.emoji} ${map.name}`, state: char.idle_state, stateUntil: char.state_until, gold: char.gold, autoRedPct: char.auto_red_pct, autoBlue: !!char.auto_blue, autoBluePct:autoBluePct(char),
      penaltiesToday: char.penalty_day && char.penalty_day === new Date(now + 8 * 3600e3).toISOString().slice(0, 10) ? char.penalties_today : 0,
      deathsTotal: char.deaths_total, bossDownUntil: char.boss_down_until && char.boss_down_until > now ? char.boss_down_until : null, lastReselectAt: char.last_reselect_at },
    stats: { ...guardianStatsView(s,char), attackSpeedMultiplier:s.attackSpeedMultiplier,hitAttackMultiplier:s.hitAttackMultiplier, weaponElem:s.weaponElem,elementResist:s.elementResist,elementResistance:s.elementResistance,def: s.def, maxHp: s.maxHp, maxMp: s.maxMp, crit: Math.round((0.05 + (s.pct.critPct || 0)) * 1000) / 10, standard: s.std, r: Math.round(s.r * 100) / 100, skill: s.skill, passive: node.passiveText, taken: Math.round(s.taken * 100) / 100, element: s.element },
    guardian: char.guardian||null,
    guardianSupply:assistSupply(char,inv,char.guardianAssistSettings||activeSettings().assist),
    guardianStoneSupply:(()=>{try{return JSON.parse(char.special_json||'{}').guardianStoneSupply===true;}catch{return false;}})(),
    guardianSummonEnabled:(()=>{try{return JSON.parse(char.special_json||'{}').guardianSummonEnabled===true;}catch{return false;}})(),
    guardianAssist: (()=>{try{return JSON.parse(char.special_json||'{}').guardianAssist||null;}catch{return null;}})(),
    inventory: inv,
    collection:collectionView(inv,char),
    ...(compact?{compact:true}:{equipment: equipment.map((e) => equipmentView(char, e))}),
    supply: { redHours: Math.round(sup.red * 10) / 10, blueHours: Math.round(sup.blue * 10) / 10, tier: sup.tier, redKey: `red_${sup.tier}`, blueKey: `blue_${sup.tier}`, redTierCount: inv[`red_${sup.tier}`] || 0, blueTierCount: inv[`blue_${sup.tier}`] || 0 },
    refill: refillPlan(char, inv, equipped, 24, sup),
    daily: dailyGoldFor(char, now),
    gate,
    branches: (gate.canAdvance ? branchChoices(char.base_class, tier + 1, char.class_path) : tier >= 1 ? branchChoices(char.base_class, 1) : []).map(branchView),
    branches2: !gate.canAdvance && tier >= 2 ? branchChoices(char.base_class, 2, char.class_path).map(branchView) : [],
    report: report ? { ...report, relics: (report.relics || []).map((r) => ({ id: r.id, name: r.name, slot: r.slot, kind: r.kind, classReq: r.class_req, tier: r.tier })), eliteGear: (report.eliteGear || []).map((r) => ({ id: r.id, name: r.name, slot: r.slot, kind: r.kind, classReq: r.class_req, tier: r.tier })) } : null,
    // v0.4 battle animation feed: the idle tick's real numbers so the Mini App can replay `report` consistently
    battle: { attackSpeedMultiplier:s.attackSpeedMultiplier,hitAttackMultiplier:s.hitAttackMultiplier,idleCombat:idleCombatState(char), atk: s.atk, crit: Math.round((0.05 + (s.pct.critPct || 0)) * 1000) / 1000, skill: s.skill, taken: s.taken, hpLossPerTick: Math.round(s.hpLoss * 10) / 10, eliteBurst: Math.round(s.burst),
      killsPerTick: Math.round(s.killsPerTick * s.g * 100) / 100, mapId: map.id, monsters: monsterPool(map.id).map(m=>m.name),monsterPool:monsterPool(map.id),elitePool:monsterPool(map.id,'elite'),elite: map.elite, autoRedPct: char.auto_red_pct },
    nextBoss: nextSlot(now),
  };
}

export function shopView(char) { return { items: itemOffers(char), gear: gearOffers(char), gacha: gachaOffers(char), gachaRates: GACHA_RATES.map(([rarity,pct])=>({rarity,pct})) }; }

export function bossView(boss, attackers = [], now = Date.now()) {
  if (!boss) return null;
  return { id: boss.id, mapId: boss.map_id, mapName: `${MAPS[boss.map_id].emoji} ${MAPS[boss.map_id].name}`, name: boss.name, ...monsterIdentity(boss.map_id,boss.name,'boss'), element: boss.element, elementName: ELEMENTS[boss.element]?.name, elementEmoji: ELEMENTS[boss.element]?.emoji,
    hp: boss.hp, maxHp: boss.max_hp, participants: boss.participants, status: boss.status, startedAt: boss.started_at, endsAt: boss.ends_at,
    secondsLeft: Math.max(0, Math.round((boss.ends_at - now) / 1000)), material: ITEMS[MAPS[boss.map_id].boss.mat]?.name, collectionMaterial:monsterIdentity(boss.map_id,boss.name,'boss').material, attackWindowMinutes: BOSS.attackWindowMs / 60000,
    messageChatId: boss.message_chat_id, messageId: boss.message_id, result: boss.result_json ? JSON.parse(boss.result_json) : null,
    top: attackers.slice(0, 30).map((a) => ({ tgId: a.tg_id, name: a.name, damage: a.damage })) };
}

