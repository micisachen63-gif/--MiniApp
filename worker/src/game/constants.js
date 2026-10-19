import {expandMapData,MONSTER_ITEMS} from './monster-data.js';
import { BOOK_ITEMS } from './special-data.js';
import { THIEF_CLASS, THIEF_BRANCHES2, THIEF_WEAPONS, THIEF_ARMOR } from './thief-data.js';
// 小精靈 RPG — static game data (DESIGN.md v0.5). Pure data, no I/O.

export const TICK_MS = 60_000;
export const MAX_SETTLE_TICKS = 1440;          // offline cap: 24h
export const MAX_LEVEL = 120;
export const MAX_OPEN_MAP = 12;                 // 12 Greek-mythology maps (Lv1–120), changing every 10 levels
export const MAX_OPEN_CLASS_TIER = 4;           // Lv90/Lv120 require bound three-account party trial certificates.
export const NEWBIE_EXP_LEVEL = 10;             // Lv1–10: EXP ×3 and no death penalty
export const NEWBIE_EXP_MULT = 3;

export const IDLE = Object.freeze({
  townHpPct: 0.25,          // no red potion and HP ≤ 25% → return to town
  basicEff: 0.35,           // no MP for the skill → basic attacks only
  hpRegenPct: 0.003,        // natural HP regen per tick while fighting
  mpRegenPct: 0.01,         // + 1 flat
  townRegenPct: 0.02,       // HP/MP regen per tick in town (gate / no-red / reviving)
  eliteChance: 0.03,        // elite ambush per tick
  eliteBurstPct: 0.22,      // burst = 22% MaxHP × (1/r)^1.5
  reviveTicks: 10,
  reviveHpPct: 0.5,
  goldPerDayPct: 0,         // v0.5.1: replaced by per-kill gold (MONSTER_GOLD)
});
// v0.5.1 掛機打怪掉金幣: gold per normal kill = (base + perLevel × L) × mapMul,
// ±variance per tick; kills already scale with gear. 12 map tiers from 1.0 to 1.5.
export const MONSTER_GOLD = Object.freeze({
  base: 12, perLevel: 0.1, variance: 0.2, elite: 15,
  mapMul: Object.freeze([1, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5]),
});

export const DEATH = Object.freeze({ expPct: 0.05, dailyPenaltyCap: 3 });

export const ELEMENTS = Object.freeze({
  earth: { name: '地', emoji: '🌍' }, water: { name: '水', emoji: '🌊' }, fire: { name: '火', emoji: '🔥' },
  wind: { name: '風', emoji: '🌪️' }, light: { name: '光', emoji: '☀️' }, dark: { name: '暗', emoji: '🌑' },
});
export const ELEMENT_KEYS = Object.freeze(Object.keys(ELEMENTS));
export const RARITIES = Object.freeze({   // MMORPG color tiers: 白(一般) / 綠(高級) / 藍(極品) / 紫(傳說) / 紅(霸主)
  common: { name: '一般', color: 'white', colorName: '白裝', weight: 50, mult: 1.0 },
  advanced: { name: '高級', color: 'green', colorName: '綠裝', weight: 30, mult: 1.2 },
  epic: { name: '極品', color: 'blue', colorName: '藍裝', weight: 13, mult: 1.5 },
  legendary: { name: '傳說', color: 'purple', colorName: '紫裝', weight: 5, mult: 2.0 },
  supreme: { name: '霸主', color: 'red', colorName: '紅裝', weight: 2, mult: 3.0 },
});
export const RARITY_KEYS = Object.freeze(Object.keys(RARITIES));

// ---- classes (tier 0 + tier 1; deeper tiers are P2/P3) ----------------------------------------
// skill: cost MP, mult × ATK, targets; passive keys: takenPct, atkPct, expPct, freeCastPct, critPct, killPct, elemPct
export const CLASSES = Object.freeze({
  thief: THIEF_CLASS,
  sword: {
    key: 'sword', name: '劍士', emoji: '⚔️', blurb: '血厚耐打，主要耗紅水、最省藍水',
    atk: [12, 2.6], hp: [120, 24], mp: [30, 3], def: [6, 1.6], taken: 0.85,
    node: { name: '劍士', skill: { name: '強力斬', cost: 3, mult: 1.6, targets: 1 }, passive: { text: '堅韌：受傷 −15%' } },
    branches: {
      A: { name: '狂戰士', line: '狂戰士系', weapon: 'greatsword', skill: { name: '旋風斬', cost: 9, mult: 2.1, targets: 3 },
        passive: { text: '狂暴：ATK +15%、受傷 +10%', atkPct: 0.15, takenPct: 0.10 }, blurb: '範圍輸出高，比較吃紅水' },
      B: { name: '騎士', line: '騎士系', weapon: 'sword_shield', skill: { name: '盾擊', cost: 6, mult: 1.8, targets: 1 },
        passive: { text: '盾牆：受傷 −20%', takenPct: -0.20 }, blurb: '最耐打、最省水，輸出普通' },
    },
  },
  archer: {
    key: 'archer', name: '妖精', emoji: '🧝', blurb: '森林精靈族，擅長自然之力與遠程弓術',
    atk: [13, 3.0], hp: [95, 18], mp: [40, 4], def: [4, 1.2], taken: 0.80,
    node: { name: '森林妖精', skill: { name: '二連射', cost: 4, mult: 1.7, targets: 1 }, passive: { text: '靈巧：受傷 −20%' } },
    branches: {
      A: { name: '風語妖精', line: '風語精靈系', weapon: 'compound_bow', skill: { name: '箭雨', cost: 11, mult: 2.1, targets: 2 },
        passive: { text: '遠距：受傷 −10%', takenPct: -0.10 }, blurb: '範圍清怪快，耗藍較多' },
      B: { name: '靈獸妖精', line: '靈獸精靈系', weapon: 'crossbow', skill: { name: '獵鷹助攻', cost: 8, mult: 1.9, targets: 1 },
        passive: { text: '獵鷹：擊殺 +10%（EXP +10%）', expPct: 0.10 }, blurb: '單體穩定、省藍' },
    },
  },
  mage: {
    key: 'mage', name: '法師', emoji: '🔥', blurb: '輸出最高，主要耗藍水',
    atk: [14, 3.4], hp: [80, 14], mp: [60, 6], def: [3, 0.9], taken: 0.70,
    node: { name: '法師', skill: { name: '火球術', cost: 5, mult: 1.8, targets: 1 }, passive: { text: '魔法屏障：受傷 −30%' } },
    branches: {
      A: { name: '元素術士', line: '元素術士系', weapon: 'elem_staff', skill: { name: '連鎖閃電', cost: 14, mult: 2.3, targets: 3 },
        passive: { text: '元素親和：相剋效果 +10%', elemPct: 0.10 }, blurb: '範圍爆發最高，最吃藍水' },
      B: { name: '秘法師', line: '秘法師系', weapon: 'wand', skill: { name: '奧術飛彈', cost: 10, mult: 2.1, targets: 1 },
        passive: { text: '法力回流：15% 機率不耗魔', freeCastPct: 0.15 }, blurb: '單體穩定、最省藍的法師' },
    },
  },
});
// Candidate classes remain available to pure rule tests, but cannot enter public creation or random relic drops.
export const ALL_CLASS_KEYS = Object.freeze(Object.keys(CLASSES));
export const CLASS_KEYS = Object.freeze(ALL_CLASS_KEYS.filter(key => CLASSES[key].releaseReady !== false));
export const BRANCH_KEYS = Object.freeze(['A', 'B']);
export const BRANCH2_KEYS = Object.freeze(['1', '2']);
/** v0.5 二轉 (Lv60 + 樹王之心) — DESIGN §6.2–6.4. The tier-2 passive stacks on top of the tier-1 passive.
 *  lifestealPct / healPerCastPct are real in 決鬥 and modelled as a damage-taken cut in the idle math (§6.6). */
export const BRANCHES2 = Object.freeze({
  thief: THIEF_BRANCHES2,
  sword: {
    A: { 1: { name: '血怒戰神', skill: { name: '血之狂怒', cost: 16, mult: 2.9, targets: 3 }, passive: { text: '嗜血：吸血 8%', lifestealPct: 0.08 }, blurb: '越打越有血的範圍狂戰' },
         2: { name: '劍聖', skill: { name: '一閃', cost: 18, mult: 3.4, targets: 1 }, passive: { text: '劍心：爆擊 +20%', critPct: 0.20 }, blurb: '單體爆發最高' } },
    B: { 1: { name: '聖騎士', skill: { name: '神聖制裁', cost: 15, mult: 2.5, targets: 3 }, passive: { text: '聖光：每次施法回 1% HP', healPerCastPct: 0.01 }, blurb: '範圍＋自我治療' },
         2: { name: '鐵壁守衛', skill: { name: '不動如山', cost: 12, mult: 2.0, targets: 1 }, passive: { text: '鐵壁：受傷 −35%', takenPct: -0.35 }, blurb: '最省水的坦克' } },
  },
  archer: {
    A: { 1: { name: '逐風神射', skill: { name: '穿透狙擊', cost: 22, mult: 3.3, targets: 3 }, passive: { text: '鷹眼：爆擊 +20%', critPct: 0.20 }, blurb: '穿透多目標的狙擊' },
         2: { name: '蒼穹風舞', skill: { name: '疾風連射', cost: 18, mult: 2.8, targets: 4 }, passive: { text: '疾風：迴避再 +15%（受傷 −15%）', takenPct: -0.15 }, blurb: '快速清怪、閃避高' } },
    B: { 1: { name: '森靈馭獸', skill: { name: '野獸之王', cost: 20, mult: 2.6, targets: 3 }, passive: { text: '狼群守護：受傷 −25%', takenPct: -0.25 }, blurb: '狼與鷹一起作戰' },
         2: { name: '月影獵使', skill: { name: '爆裂陷阱', cost: 14, mult: 2.5, targets: 5 }, passive: { text: '機關：範圍技耗魔 −15%', mpCostPct: -0.15 }, blurb: '最便宜的大範圍' } },
  },
  mage: {
    A: { 1: { name: '大魔導士', skill: { name: '隕石術', cost: 30, mult: 3.4, targets: 4 }, passive: { text: '魔導：ATK +10%', atkPct: 0.10 }, blurb: '最高範圍爆發，很吃藍' },
         2: { name: '冰霜術士', skill: { name: '暴風雪', cost: 24, mult: 2.8, targets: 4 }, passive: { text: '冰甲：受傷 −20%', takenPct: -0.20 }, blurb: '範圍控場、耐打' } },
    B: { 1: { name: '時空術士', skill: { name: '時間扭曲', cost: 22, mult: 2.6, targets: 1 }, passive: { text: '時之沙：EXP +10%', expPct: 0.10 }, blurb: '練功最快的單體法師' },
         2: { name: '召喚師', skill: { name: '召喚火精靈', cost: 26, mult: 2.4, targets: 3 }, passive: { text: '使魔護盾：受傷 −25%', takenPct: -0.25 }, blurb: '召喚獸分擔傷害' } },
  },
});

// ---- maps, bosses, materials --------------------------------------------------------------------
export const MAPS = Object.freeze(expandMapData({
  1: { id: 1, name: '阿耳忒彌斯月桂林', emoji: '🌿', min: 1, max: 10, monsters: ['月光野兔', '月桂樹精', '林地花仙', '林精斥候'], elite: '阿耳忒彌斯巡林長',
    boss: { name: '月桂巨樹精', mat: null, baseHp: 3000, perPlayer: 2000 } },
  2: { id: 2, name: '雅典娜百柱神殿', emoji: '🏛️', min: 11, max: 20, monsters: ['百柱石像', '智慧夜梟', '青銅衛兵', '神殿侍從鬼魂'], elite: '神殿禁衛百夫長',
    boss: { name: '百柱守護巨像', mat: null, baseHp: 5000, perPlayer: 3500 } },
  3: { id: 3, name: '阿卡迪亞聖林', emoji: '🌲', min: 21, max: 30, monsters: ['潘神幼獸', '山林仙女', '聖角羚羊', '古木守衛'], elite: '狂暴潘神衛士',
    boss: { name: '哥布林酋長', mat: 'mat_1', baseHp: 7000, perPlayer: 5000 } },
  4: { id: 4, name: '波賽頓愛琴海崖', emoji: '🌊', min: 31, max: 40, monsters: ['海崖塞壬', '潮汐甲蟲', '波濤飛魚', '海潮巨蟹'], elite: '深海狂暴巨蟹',
    boss: { name: '海崖利維坦', mat: null, baseHp: 11000, perPlayer: 7500 } },
  5: { id: 5, name: '克里特迷宮門庭', emoji: '🌀', min: 41, max: 50, monsters: ['迷宮巡邏兵', '青銅公牛', '蛇髮女妖幻影', '石化蝙蝠'], elite: '迷宮巡查將軍',
    boss: { name: '米諾斯魔牛', mat: null, baseHp: 15000, perPlayer: 10500 } },
  6: { id: 6, name: '赫淮斯托斯熔爐', emoji: '🌋', min: 51, max: 60, monsters: ['熔岩火蜥蜴', '鍛造巨傀儡', '火晶石魔', '鍛火魔蝠'], elite: '熔火鍛造長',
    boss: { name: '腐朽樹王', mat: 'mat_2', baseHp: 20000, perPlayer: 14000 } },
  7: { id: 7, name: '冥河斯堤克斯渡口', emoji: '🌫️', min: 61, max: 70, monsters: ['迷途遊魂', '斯堤克斯骨兵', '冥府渡鴉', '三頭犬幼崽'], elite: '冥河擺渡鬼將',
    boss: { name: '冥河擺渡者', mat: null, baseHp: 26000, perPlayer: 18000 } },
  8: { id: 8, name: '德爾菲阿波羅神諭谷', emoji: '🔮', min: 71, max: 80, monsters: ['神諭幻蟒', '阿波羅日鷹', '預言祭司幽靈', '日光石妖'], elite: '神諭大祭司',
    boss: { name: '皮同巨蟒', mat: null, baseHp: 34000, perPlayer: 24000 } },
  9: { id: 9, name: '泰坦諸神山隘', emoji: '⛰️', min: 81, max: 90, monsters: ['泰坦巨足獸', '裂地石魔', '山隘狂風鳥', '雷霆蜥蜴'], elite: '泰坦先鋒戰將',
    boss: { name: '熔岩巨像', mat: 'mat_3', baseHp: 43000, perPlayer: 30000 } },
  10: { id: 10, name: '奧林帕斯雲門', emoji: '☁️', min: 91, max: 100, monsters: ['雲海天馬', '天界巡翼鳥', '雲嵐仙女', '聖光石像'], elite: '雲門神廷禁軍長',
    boss: { name: '雲門守門巨神', mat: null, baseHp: 56000, perPlayer: 39000 } },
  11: { id: 11, name: '至福樂土', emoji: '✨', min: 101, max: 110, monsters: ['英雄英靈', '長生鳥', '純金石獅', '至福精靈'], elite: '阿基里斯英靈',
    boss: { name: '至福守護王者', mat: null, baseHp: 72000, perPlayer: 50000 } },
  12: { id: 12, name: '奧林帕斯星穹聖殿', emoji: '🌌', min: 111, max: 120, monsters: ['星穹神侍', '星座巨獸', '日冕精魄', '虛空吞噬者'], elite: '星穹神官長',
    boss: { name: '霜龍女皇', mat: 'mat_4', baseHp: 90000, perPlayer: 63000 } },
}));

// ---- items ----------------------------------------------------------------------------------------
export const POTIONS = Object.freeze({
  red_1: { kind: 'red', tier: 1, name: '紅色藥水', heal: 50, price: 6 },
  red_2: { kind: 'red', tier: 2, name: '橙色藥水', heal: 150, price: 15 },
  red_3: { kind: 'red', tier: 3, name: '白色藥水', heal: 320, price: 28 },
  red_4: { kind: 'red', tier: 4, name: '濃縮體力藥水', heal: 600, price: 45 },
  blue_1: { kind: 'blue', tier: 1, name: '藍色藥水', heal: 40, price: 6 },
  blue_2: { kind: 'blue', tier: 2, name: '精神藥水', heal: 100, price: 14 },
  blue_3: { kind: 'blue', tier: 3, name: '高級精神藥水', heal: 200, price: 25 },
  blue_4: { kind: 'blue', tier: 4, name: '賢者藥水', heal: 400, price: 42 },
});
export const ITEMS = Object.freeze({
  star_ring_token:{kind:'bound',tradeable:false,name:'星征徽記',emoji:'✦',desc:'五人星環遠征通關獎勵，在神戰 → 組隊 → 星環遠征兌換成長補給與裝備。綁定角色，不可交易或販售。'},
  star_ring_core:{kind:'bound',tradeable:false,name:'星冕核心',emoji:'✧',desc:'星環遠征首領專屬戰利品，每張地圖首次擊退首領必得 1 枚。60 枚可在遠征補給所自選武器或防具100%強化必成卷。綁定角色，不可交易或販售。'},
  guardian_summon_stone:{kind:'bound',name:'天使召喚石',emoji:'✦',desc:'在掛機輔助選擇已有天使參戰；一顆支援24小時有效掛機戰鬥，不可交易。'},
  guardian_voucher:{kind:'boss_resource',name:'守護天使招喚憑證',emoji:'🪶',desc:'每帳號每日前四次有效首領參戰可得；每張精選召喚五次，不可交易。'},
  guardian_free_normal:{kind:'bound',name:'初見免費召喚次數',emoji:'✧',desc:'15級首次進入守護神系統贈送200次普通召喚，優先使用，不可交易。'},
  ...MONSTER_ITEMS,
  ...BOOK_ITEMS,
  boss_essence:{kind:'boss_resource',name:'首領精華',emoji:'◆',desc:'群組首領討伐獎勵；每帳號每日前四次。兌換洗屬性、強化捲與遺物碎片，不可交易。'},
  relic_fragment:{kind:'boss_resource',name:'遺物碎片',emoji:'🏺',desc:'30 個兌換一件目前等級的本職業遺物，不可交易。'},
  research_fragment: {kind:'research',name:'技能研究碎片',emoji:'✧',desc:'職業秘藏獎勵，兌換指定技能寶物'},
  tower_fragment: {kind:'tower',name:'星穹徽記',emoji:'♜',desc:'爬塔長期成就材料'},
  trial_3: {kind:'bound',tier:3,name:'三人試煉之證',emoji:'🏅',desc:'三轉組隊試煉綁定獎勵，不能交易'},
  trial_4: {kind:'bound',tier:4,name:'星穹覺醒之證',emoji:'🏅',desc:'120 級組隊試煉綁定獎勵，不能交易'},
  ...Object.fromEntries(Object.entries(POTIONS).map(([k, p]) => [k, { ...p, emoji: p.kind === 'red' ? '🧪' : '💙' }])),
  gacha_weapon: {kind:'gacha',name:'武器轉蛋',emoji:'⚔️',desc:'在背包開啟，依開啟角色當下等級與職業獲得一件武器。紫色傳說 85%、紅色霸主 15%。'},
  gacha_armor: {kind:'gacha',name:'防具轉蛋',emoji:'🛡️',desc:'在背包開啟，依開啟角色當下等級與職業獲得一件六部位隨機防具。紫色傳說 85%、紅色霸主 15%。'},
  scroll_w: { kind: 'scroll', name: '武器強化捲', emoji: '📜', price: 75, desc: '武器強化 1 次（每次消耗張數＝裝備階 T）' },
  scroll_a: { kind: 'scroll', name: '防具強化捲', emoji: '📜', price: 50, desc: '防具（盔甲／頭盔／手套／長靴／腰帶／內衣）與耳環、戒指強化 1 次（每次消耗張數＝T）' },
  blessed_scroll_w: { kind: 'scroll', name: '受祝福的武器強化卷軸', emoji: '✨', desc: '武器強化成功率增加 10 個百分點；每次消耗 1 張，不改變爆裝率。菁英怪／群組首領掉落，可交易，不在商店出售。' },
  blessed_scroll_a: { kind: 'scroll', name: '受祝福的防具強化卷軸', emoji: '✨', desc: '防具與飾品強化成功率增加 10 個百分點；每次消耗 1 張，不改變爆裝率。菁英怪／群組首領掉落，可交易，不在商店出售。' },
  guaranteed_scroll_w: {kind:'scroll',tradeable:false,name:'星輝武器必成卷',emoji:'✦',desc:'手動選用後消耗 1 張，武器本次強化必定成功且不會爆裝；仍受強化等級上限限制。四世星輝匣或星環遠征首領獎勵，不可交易或販售。'},
  guaranteed_scroll_a: {kind:'scroll',tradeable:false,name:'星輝防具必成卷',emoji:'✦',desc:'手動選用後消耗 1 張，防具或飾品本次強化必定成功且不會爆裝；仍受強化等級上限限制。四世星輝匣或星環遠征首領獎勵，不可交易或販售。'},
  fate_cycle_gift: {kind:'fate_gift',tradeable:false,name:'四世星輝匣',emoji:'✧',desc:'每完成 4 次正式輪迴可領取。開啟：5% 星輝武器必成卷、5% 星輝防具必成卷、90% 普通武器與防具強化卷各 2 張。不可交易或販售。'},
  scroll_r: { kind: 'scroll', name: '洗屬性捲', emoji: '🎲', price: 60, desc: '重洗能力詞條；保留裝備品階與元素，可鎖定詞條，費用隨鎖定條數增加' },
  unbind: { kind: 'scroll', name: '赫密士解契卷', emoji: '🔓', price: 500, desc: '解除裝備綁定（未穿戴的綁定裝備；張數依裝備階、品階、遺物、強化而定）→ 可再交易、分享' },
  ward: { kind: 'ward', name: '守護符', emoji: '🧿', priceBase: 400, maxHold: 5, dailyBuy: 3, desc: '死亡時自動消耗 1 張，抵銷這次 EXP 損失；決鬥落敗掉裝時也會消耗 1 張擋下' },
  reselect_1: { kind: 'reselect', tier: 1, name: '命運轉職書 I', emoji: '📖', price: 6000, maxHold: 1, desc: '重選一轉路線（A↔B）' },
  reselect_2: { kind: 'reselect', tier: 2, name: '命運轉職書 II', emoji: '📖', price: 12000, maxHold: 1, desc: '重選二轉路線（1↔2）' },
  reselect_3: { kind: 'reselect', tier: 3, name: '命運轉職書 III', emoji: '📖', price: 24000, maxHold: 1, desc: '重選三轉（P3 開放）' },
  mat_1: { kind: 'mat', tier: 1, name: '酋長之證', emoji: '🏅', desc: '一轉材料（哥布林酋長）' },
  mat_2: { kind: 'mat', tier: 2, name: '樹王之心', emoji: '🏅', desc: '二轉材料（腐朽樹王）' },
  mat_3: { kind: 'mat', tier: 3, name: '巨像之核', emoji: '🏅', desc: '舊材料，可兌換12首領精華；三轉改需真人三人試煉證明' },
  mat_4: { kind: 'mat', tier: 4, name: '女皇之鱗', emoji: '🏅', desc: '舊材料，可兌換16首領精華；四轉改需真人三人試煉證明' },
});
export const RESELECT_COOLDOWN_MS = 30 * 60_000;

// ---- equipment ------------------------------------------------------------------------------------
// v0.4: 11 equipped positions = weapon + 6 armor slots + 2 earrings + 2 rings. A row's `slot` is the item type; for
// earring/ring `is_equipped` is the position (1 or 2), for everything else it is 0/1.
export const SLOTS = Object.freeze(['weapon', 'helmet', 'armor', 'gloves', 'boots', 'belt', 'undershirt', 'earring', 'ring']);
export const SLOT_NAMES = Object.freeze({ weapon: '武器', helmet: '頭盔', armor: '盔甲', gloves: '手套', boots: '長靴', belt: '腰帶', undershirt: '內衣', earring: '耳環', ring: '戒指' });
export const SLOT_CAPACITY = Object.freeze({ earring: 2, ring: 2 });            // others: 1
export const CLASS_ARMOR_SLOTS = Object.freeze(['helmet', 'armor', 'gloves', 'boots']);   // plate / leather / cloth by class
export const SHARED_SLOTS = Object.freeze(['belt', 'undershirt', 'earring', 'ring']);     // class_req 'any'
export const ARMOR_SCROLL_SLOTS = Object.freeze(SLOTS.filter((s) => s !== 'weapon'));    // 防具強化捲 also covers accessories
/**
 * Per-slot stats (DESIGN v0.4 §7.3). main = what base_stat means; defShare = share of ARMOR_DEF[T] (× the WEARER's family
 * defMult, so the full 6-piece set gives the same 2.2× body-armor DEF as v0.3's 4 pieces); flat = fixed secondary stats per
 * tier (× rarity); pct = fixed % bonuses. Earring main = MaxMP, ring main = ATK (tables below, rolled ±20%).
 */
export const SLOT_SPEC = Object.freeze({
  armor: { main: 'def', defShare: 1.0, flat: {}, pct: {} },
  helmet: { main: 'def', defShare: 0.35, flat: { hp: [12, 22, 35, 50, 68, 88, 110, 135, 165, 200, 240, 285] }, pct: {} },
  gloves: { main: 'def', defShare: 0.2, flat: { atk: [1, 2, 3, 4, 6, 8, 10, 12, 15, 18, 22, 26] }, pct: {} },
  boots: { main: 'def', defShare: 0.3, flat: { hp: [6, 12, 18, 26, 36, 48, 62, 78, 96, 118, 142, 170] }, pct: { takenPct: -0.01 } },
  belt: { main: 'def', defShare: 0.15, flat: { hp: [15, 28, 45, 65, 88, 115, 145, 180, 220, 265, 315, 370], mp: [6, 10, 15, 22, 30, 40, 52, 66, 82, 100, 120, 145] }, pct: {} },
  undershirt: { main: 'def', defShare: 0.2, flat: { hp: [10, 18, 30, 44, 60, 78, 100, 125, 155, 190, 230, 275] }, pct: {} },
  earring: { main: 'mp', range: { 1: [5, 9], 2: [9, 15], 3: [14, 22], 4: [20, 30], 5: [27, 39], 6: [35, 50], 7: [44, 62], 8: [54, 76], 9: [66, 92], 10: [80, 110], 11: [96, 130], 12: [115, 155] }, flat: {}, pct: { maxMpPct: 0.01 } },
  ring: { main: 'atk', range: { 1: [1, 3], 2: [2, 4], 3: [3, 6], 4: [5, 8], 5: [7, 11], 6: [9, 14], 7: [11, 18], 8: [14, 22], 9: [17, 26], 10: [20, 31], 11: [24, 37], 12: [29, 44] }, flat: {}, pct: { critPct: 0.01 } },
});
export const SHARED_NAMES = Object.freeze({
  belt: {
    1: '月桂編織腰帶', 2: '雅典神殿皮帶', 3: '聖林精靈腰帶', 4: '海神波濤腰帶',
    5: '迷宮牛皮腰帶', 6: '熔爐鍛鐵腰帶', 7: '冥河幽魂腰帶', 8: '神諭秘銀腰帶',
    9: '泰坦巨力腰帶', 10: '雲門天境腰帶', 11: '至福純金腰帶', 12: '星穹神輝腰帶',
  },
  undershirt: {
    1: '月桂亞麻內衣', 2: '雅典絲織內衣', 3: '聖林木棉內衣', 4: '海神鱗紋內衣',
    5: '迷宮密織內衣', 6: '熔爐抗火內衣', 7: '冥河陰影內衣', 8: '神諭祈福內衣',
    9: '泰坦韌絲內衣', 10: '雲門霞光內衣', 11: '至福祥瑞內衣', 12: '星穹辰光內衣',
  },
  earring: {
    1: '月桂葉耳飾', 2: '雅典石玉耳墜', 3: '聖林泉水耳墜', 4: '海神珍珠耳墜',
    5: '迷宮秘石耳環', 6: '熔爐火晶耳墜', 7: '冥河黑曜耳墜', 8: '神諭日輝耳飾',
    9: '泰坦琥珀耳環', 10: '雲門天羽耳墜', 11: '至福極樂耳墜', 12: '星穹神星耳環',
  },
  ring: {
    1: '月桂枝戒', 2: '雅典銀印戒', 3: '聖林翡翠戒', 4: '海神珊瑚戒',
    5: '迷宮紋章戒', 6: '熔爐赤銅戒', 7: '冥河渡魂戒', 8: '神諭光芒戒',
    9: '泰坦玄岩戒', 10: '雲門白雲戒', 11: '至福英靈戒', 12: '星穹永恆戒',
  },
});
export const TIER_PREFIX = Object.freeze({
  1: '月桂', 2: '雅典', 3: '聖林', 4: '海神', 5: '迷宮', 6: '熔爐',
  7: '冥河', 8: '神諭', 9: '泰坦', 10: '雲門', 11: '至福', 12: '星穹',
});
export const TIER_LEVEL_REQ = Object.freeze({
  1: 1, 2: 11, 3: 21, 4: 31, 5: 41, 6: 51,
  7: 61, 8: 71, 9: 81, 10: 91, 11: 101, 12: 111,
});
export const WEAPON_ATK = Object.freeze({
  1: [10, 18], 2: [18, 28], 3: [26, 38], 4: [35, 50],
  5: [46, 64], 6: [58, 80], 7: [70, 96], 8: [84, 114],
  9: [100, 134], 10: [118, 156], 11: [138, 180], 12: [160, 210],
});
export const ARMOR_DEF = Object.freeze({
  1: [6, 12], 2: [10, 18], 3: [14, 24], 4: [18, 30],
  5: [24, 38], 6: [31, 48], 7: [40, 60], 8: [49, 72],
  9: [59, 85], 10: [70, 100], 11: [82, 116], 12: [96, 134],
});   // body armor; other pieces ×0.4
export const WEAPON_PRICE = Object.freeze({
  1: 1500, 2: 2500, 3: 3500, 4: 4800, 5: 6300, 6: 8000,
  7: 10000, 8: 12200, 9: 14700, 10: 17400, 11: 20400, 12: 23700,
});
export const BRANCH_WEAPON_PRICE_MULT = 1.3;
export const ARMOR_PRICE = Object.freeze({
  armor: { 1: 1000, 2: 1600, 3: 2300, 4: 3100, 5: 4100, 6: 5200, 7: 6500, 8: 7900, 9: 9500, 10: 11200, 11: 13100, 12: 15200 },
  piece: { 1: 600, 2: 1000, 3: 1400, 4: 1900, 5: 2500, 6: 3200, 7: 4000, 8: 4900, 9: 5900, 10: 7000, 11: 8200, 12: 9500 },
  belt: { 1: 450, 2: 750, 3: 1100, 4: 1500, 5: 2000, 6: 2500, 7: 3100, 8: 3800, 9: 4500, 10: 5300, 11: 6200, 12: 7200 },
  undershirt: { 1: 400, 2: 680, 3: 1000, 4: 1350, 5: 1750, 6: 2200, 7: 2700, 8: 3300, 9: 4000, 10: 4700, 11: 5500, 12: 6400 },
  earring: { 1: 500, 2: 820, 3: 1200, 4: 1650, 5: 2150, 6: 2700, 7: 3350, 8: 4100, 9: 4900, 10: 5800, 11: 6800, 12: 7900 },
  ring: { 1: 600, 2: 950, 3: 1350, 4: 1850, 5: 2400, 6: 3050, 7: 3800, 8: 4600, 9: 5500, 10: 6500, 11: 7600, 12: 8800 },
});

// ---- 遺物級 relic gear (v0.4): never sold; ×1.25 of the same-tier shop item (main + flat stats) + 1 random affix ----------
export const RELIC = Object.freeze({
  statMult: 1.25, prefix: '遺物・', rarityFloor: 'advanced',
  eliteChance: 0.005,          // per elite kill (= survived elite ambush) in idle
  eliteDailyCap: 1,            // per Taipei day
  bossChance: 0.35,            // per group-boss kill: 35% chance of exactly 1 relic (ミカサ 2026-10-08: keep relics rare)
  bossFloorShare: 0.10,        // weight = damage share + 0.10/N → every attacker has a non-zero chance
  cappedMult: 0.2,            // boss relic weight for attackers already past BOSS.fullLootPerDay today (still non-zero)
  // affix pool: [key, label, per-tier values] (flat values × tier table, % values flat)
  affixes: [
    ['atk', 'ATK', [4, 7, 11, 16, 22, 29, 37, 46, 56, 67, 80, 95]],
    ['def', 'DEF', [4, 7, 11, 16, 22, 30, 39, 49, 60, 72, 86, 102]],
    ['hp', 'HP', [40, 75, 120, 175, 245, 330, 430, 545, 680, 835, 1010, 1210]],
    ['mp', 'MP', [20, 35, 55, 80, 110, 145, 190, 240, 300, 370, 450, 540]],
    ['critPct', '爆擊', [0.02, 0.02, 0.03, 0.03, 0.03, 0.04, 0.04, 0.04, 0.05, 0.05, 0.05, 0.06]],
    ['takenPct', '受傷', [-0.02, -0.02, -0.03, -0.03, -0.03, -0.04, -0.04, -0.04, -0.05, -0.05, -0.05, -0.06]],
    ['maxHpPct', 'MaxHP', [0.03, 0.03, 0.04, 0.04, 0.04, 0.05, 0.05, 0.05, 0.06, 0.06, 0.06, 0.07]],
    ['maxMpPct', 'MaxMP', [0.03, 0.03, 0.04, 0.04, 0.04, 0.05, 0.05, 0.05, 0.06, 0.06, 0.06, 0.07]],
    ['expPct', 'EXP', [0.02, 0.02, 0.03, 0.03, 0.03, 0.04, 0.04, 0.04, 0.05, 0.05, 0.05, 0.06]],
  ],
});

// ---- 交易 group trading (v0.4) -------------------------------------------------------------------------
export const TRADE = Object.freeze({
  ttlMs: 24 * 3600e3,          // open trades expire after 24h → escrow returned
  maxOpenPerPlayer: 3,
  taxPct: 0.05,                // 5% of the gold part, taken from the gold the receiver gets (gold sink)
  maxGold: 1_000_000,          // per side per trade
  maxLines: 12,                // item lines per side
  // Inventory items have no per-item bound flag: allow every item stack to trade.
  tradeableItems: Object.keys(ITEMS).filter(k => ITEMS[k].tradeable!==false&&!['bound','research','tower','boss_resource'].includes(ITEMS[k].kind)),
  // v0.5: trades start from a shared item → 我要交易 → owner 確認 (or never). Window: place → 鎖定 (irreversible) → both OK.
  idleMs: 30 * 60e3,           // an open window expires after 30 min without any action (escrow returned)
  requestTtlMs: 24 * 3600e3,   // an unanswered 我要交易 request expires after 24h
  maxPendingOut: 5,            // pending requests a player may have sent
  maxPendingIn: 20,            // pending requests a player may have received
});

// ---- v0.5 分享至群組 (item photo posts) ----------------------------------------------------------------
export const SHARE = Object.freeze({
  cooldownMs: 60e3,            // per player between shares
  dailyCap: 10,                // shares per player per Taipei day
  sameItemMs: 10 * 60e3,       // the same item can't be re-shared within 10 min
});

// ---- v0.5 赫密士解契卷: scrolls needed = ceil(T × rarity × grade) + floor(enhance / 3); 500 gold each ---------
export const UNBIND = Object.freeze({
  rarity: { common: 1, advanced: 1, epic: 2, legendary: 3, supreme: 4 },
  relicMult: 3,
  enhanceStep: 3,              // +1 scroll per 3 enhance levels
});

// ---- v0.5 群組決鬥 1v1 PK (P2 feature pulled into v0.5) ---------------------------------------------------
export const PK = Object.freeze({
  minLevel: 10,                // both sides (newbie protection ends at Lv10)
  maxLevelGap: 10,             // |levelA − levelB| ≤ 10
  dailyCap: 5,                 // fought duels per player per Taipei day
  pairCooldownMs: 12 * 3600e3, // same two players: one duel per 12h (either direction)
  challengeTtlMs: 10 * 60e3,   // unanswered challenge expires
  maxPendingOut: 1, maxPendingIn: 3,
  dropChance: 0.20,            // loser drops ONE random equipped item (weapons included) → winner's bag, unbound
  maxRounds: 30,               // then higher HP% wins
  dmgScale: 0.6,               // PvP damage scale so a duel lasts several rounds
  critMult: 1.5,
});

// weapon kinds: class + optional first-advancement branch
export const WEAPON_KINDS = Object.freeze({
  ...THIEF_WEAPONS,
  sword: {
    cls: 'sword', branch: null, type: '單手劍',
    names: {
      1: '月桂短劍', 2: '雅典佩劍', 3: '聖林銳劍', 4: '海神之劍',
      5: '迷宮秘劍', 6: '熔爐鍛劍', 7: '冥河渡魂劍', 8: '神諭光芒劍',
      9: '泰坦重斬劍', 10: '雲門天界劍', 11: '至福勇者劍', 12: '星穹創世劍',
    },
    bonus: {},
  },
  greatsword: {
    cls: 'sword', branch: 'A', type: '雙手巨劍',
    names: {
      2: '雅典厚刃巨劍', 3: '聖林裂地巨劍', 4: '海神破浪巨劍', 5: '迷宮屠牛巨劍',
      6: '熔爐熾炎巨劍', 7: '冥河斷魂巨劍', 8: '神諭滅絕巨劍', 9: '泰坦裂山巨劍',
      10: '雲門裁決巨劍', 11: '至福斬神巨劍', 12: '星穹霸權巨劍',
    },
    bonus: { atkPct: 0.15, critPct: 0.05 }, desc: 'ATK +15%、爆擊 +5%',
  },
  sword_shield: {
    cls: 'sword', branch: 'B', type: '劍盾組',
    names: {
      2: '雅典衛士劍盾', 3: '聖林守護劍盾', 4: '海神浪壁劍盾', 5: '迷宮迷蹤劍盾',
      6: '熔爐烈鋼劍盾', 7: '冥河幽界劍盾', 8: '神諭庇護劍盾', 9: '泰坦壁壘劍盾',
      10: '雲門天闕劍盾', 11: '至福不朽劍盾', 12: '星穹守護聖盾',
    },
    bonus: { atkPct: -0.05, defFromWeaponPct: 0.30, takenPct: -0.05 }, desc: 'ATK −5%、附加 DEF、受傷 −5%',
  },
  staff: {
    cls: 'mage', branch: null, type: '法杖',
    names: {
      1: '月桂法杖', 2: '雅典智慧杖', 3: '聖林藤木杖', 4: '海神潮汐杖',
      5: '迷宮引路杖', 6: '熔爐熾晶杖', 7: '冥河引魂杖', 8: '神諭預言杖',
      9: '泰坦天雷杖', 10: '雲門光耀杖', 11: '至福恩典杖', 12: '星穹穹宇杖',
    },
    bonus: {},
  },
  elem_staff: {
    cls: 'mage', branch: 'A', type: '元素法杖',
    names: {
      2: '雅典元素使杖', 3: '聖林風雷之杖', 4: '海神怒濤元素杖', 5: '迷宮秘術元素杖',
      6: '熔爐純火元素杖', 7: '冥河暗影元素杖', 8: '神諭聖輝元素杖', 9: '泰坦混沌元素杖',
      10: '雲門極光元素杖', 11: '至福造化元素杖', 12: '星穹創生聖杖',
    },
    bonus: { elemStatMult: 1.5, elemPct: 0.10 }, desc: '元素屬性 ×1.5、相剋 +10%',
  },
  wand: {
    cls: 'mage', branch: 'B', type: '魔杖／魔導書',
    names: {
      2: '雅典智慧短杖', 3: '聖林秘語典籍', 4: '海神深藍魔杖', 5: '迷宮符文寶典',
      6: '熔爐火印魔杖', 7: '冥河渡魂魔典', 8: '神諭阿波羅魔杖', 9: '泰坦古老秘典',
      10: '雲門天神魔杖', 11: '至福永恆法典', 12: '星穹奧術至尊書',
    },
    bonus: { maxMpPct: 0.15, mpCostPct: -0.10 }, desc: 'MaxMP +15%、耗魔 −10%',
  },
  longbow: {
    cls: 'archer', branch: null, type: '長弓',
    names: {
      1: '月桂狩獵弓', 2: '雅典守衛弓', 3: '聖林青藤弓', 4: '海神風暴弓',
      5: '迷宮穿楊弓', 6: '熔爐火翎弓', 7: '冥河幽冥弓', 8: '神諭光明弓',
      9: '泰坦裂風弓', 10: '雲門天翼弓', 11: '至福神射弓', 12: '星穹幻光弓',
    },
    bonus: {},
  },
  compound_bow: {
    cls: 'archer', branch: 'A', type: '複合弓',
    names: {
      2: '雅典風切複合弓', 3: '聖林疾風複合弓', 4: '海神破浪複合弓', 5: '迷宮死線複合弓',
      6: '熔爐焰爆複合弓', 7: '冥河噬魂複合弓', 8: '神諭日輪複合弓', 9: '泰坦撼地複合弓',
      10: '雲門穿雲複合弓', 11: '至福滅影複合弓', 12: '星穹萬象複合弓',
    },
    bonus: { extraTargets: 1, critPct: 0.05 }, desc: '範圍技能目標 +1、爆擊 +5%',
  },
  crossbow: {
    cls: 'archer', branch: 'B', type: '十字弩',
    names: {
      2: '雅典鋼弦重弩', 3: '聖林百步弩', 4: '海神重潮弩', 5: '迷宮陷陣弩',
      6: '熔爐熾炎鋼弩', 7: '冥河幽魂連弩', 8: '神諭裁決神弩', 9: '泰坦破城巨弩',
      10: '雲門逐日弩', 11: '至福滅魔神弩', 12: '星穹天罰神弩',
    },
    bonus: { atkPct: 0.10, expPct: 0.02 }, desc: 'ATK +10%、獵鷹/召喚類 +20%',
  },
});
export const GENERAL_WEAPON = Object.freeze({ sword: 'sword', mage: 'staff', archer: 'longbow', thief: 'dagger' });
export const COUNTERPART_WEAPON = Object.freeze({ greatsword: 'sword_shield', sword_shield: 'greatsword', elem_staff: 'wand', wand: 'elem_staff', compound_bow: 'crossbow', crossbow: 'compound_bow', dual_daggers: 'throwing_blades', throwing_blades: 'dual_daggers' });

export const ARMOR_FAMILIES = Object.freeze({
  thief: THIEF_ARMOR,
  sword: { key: 'plate', name: '板甲', defMult: 1.0, perPiece: { maxHpPct: 0.03 }, desc: '每件 MaxHP +3%',
    pieces: { helmet: '頭盔', armor: '板甲', gloves: '鐵護手', boots: '鐵靴' } },
  archer: { key: 'leather', name: '皮甲', defMult: 0.75, perPiece: { takenPct: -0.02 }, desc: '每件受傷 −2%',
    pieces: { helmet: '皮帽', armor: '皮甲', gloves: '皮手套', boots: '皮靴' } },
  mage: { key: 'cloth', name: '布袍', defMult: 0.5, perPiece: { maxMpPct: 0.04 }, desc: '每件 MaxMP +4%',
    pieces: { helmet: '法師帽', armor: '法袍', gloves: '法師手套', boots: '法師鞋' } },
});

// ---- group boss -----------------------------------------------------------------------------------
export const BOSS = Object.freeze({
  slotsTaipei: [0, ...Array.from({ length: 16 }, (_, i) => i + 8)],   // hourly except 01:00–07:59, Asia/Taipei
  durationMs: 30 * 60_000,                // disappears 30 min after spawn (attacked or not)
  attackWindowMs: 3 * 60_000,             // one attack per player per 3-minute window → up to 10 attacks
  castsPerAttack: 5,
  maxDamagePctPerAttack: 0.25,             // a single attack cannot remove more than 25% of a boss's max HP
  counterHpPct: 0.25,
  downMs: 10 * 60_000,
  helperDamageMult: 0.5,                  // above the map's level range
  goldPerTierPerPlayer: 1500,
  helperGoldWeight: 1.5,
  fullLootPerDay: 4,                      // full loot for the first 4 kills per day (material always)
  cappedGoldPct: 0.2,
  gearBonusPct: 0.15,
});

// ---- idle drops (掛機掉落) -------------------------------------------------------------------------
// Per fighting tick (= one idle battle, 1 min). Chance = base × map tier T × efficiency (basic-attack ticks ×0.35).
// ×T because one enhancement/reroll on a tier-T item costs T scrolls → attempts per day stay ~constant across maps.
// No drops while in town / reviving / waiting at the gate. Daily cap per Taipei day = capPerTier × T.
export const DROPS = Object.freeze({
  scroll_w: { base: 0.0007, capPerTier: 2 },   // ≈1.0/day × T at full uptime
  scroll_a: { base: 0.0010, capPerTier: 3 },   // ≈1.44/day × T
  scroll_r: { base: 0.0005, capPerTier: 2 },   // ≈0.72/day × T
});
export const DROP_KEYS = Object.freeze(Object.keys(DROPS));
// Blessed scrolls are exclusive elite/group-boss loot, never ordinary idle-tick/shop drops.
export const BLESSED_DROPS = Object.freeze({ eliteChance: 0.015, bossChance: 0.20, keys: Object.freeze(['blessed_scroll_w', 'blessed_scroll_a']) });

// ---- enhancement (same rules as the pet system) + reroll ----------------------------------------
export const ENHANCE = Object.freeze({
  safe: { weapon: 6, armor: 4 },     // armor = every non-weapon slot (6 armor slots + earrings + rings)
  safeSuccess: 0.5,                  // inside safe: 50% +1 / 50% nothing
  overSuccess: 0.33, overBreak: 0.33, // beyond safe: 33% +1 / 34% nothing / 33% the item breaks (destroyed)
  max: 15,
});

