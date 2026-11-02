import { MAPS } from './constants.js';

/** Prototype values, not production-approved balance. Never retune a saved run. */
export const ATLAS_RULESET_VERSION = 'atlas-v1';
export const ATLAS_MAX_DURATION_SECONDS = 8 * 60 * 60;
export const ATLAS_MAX_MAP_COUNT = 96;
export const ATLAS_MAX_ADVANCE_STEPS = 2000;

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export const ATLAS_PROTOTYPE_PROFILE = freeze({
  id: 'prototype-20261101', status: 'prototype',
  enemyHpMultiplier: 1, enemyDamageMultiplier: 1, enemyDefenseMultiplier: 1,
  rewardMultiplier: 1, travelMultiplier: 1,
});

export const ATLAS_THEMES = freeze(Object.values(MAPS).map(map => ({
  id: map.id, name: map.name, emoji: map.emoji, bossName: map.boss.name,
  legacyMinLevel: map.min, legacyMaxLevel: map.max,
  // Original maps remain intact; only the first three have new Atlas encounters.
  available: map.id <= 3,
})));

export const ATLAS_SUPPORTS = freeze([
  { id: 'wide', name: '擴散', description: '額外命中兩個目標；每目標傷害降低，耗魔提高。', damageMultiplier: .76, costMultiplier: 1.3, extraTargets: 2 },
  { id: 'focused', name: '凝聚', description: '主技能集中單體，提高傷害；耗魔略增。', damageMultiplier: 1.38, costMultiplier: 1.1, targets: 1 },
  { id: 'lasting', name: '延續', description: '毒與流血維持更久；直接傷害降低。', damageMultiplier: .82, costMultiplier: 1.05, durationMultiplier: 1.75, requires: ['dot'] },
  { id: 'economy', name: '節流', description: '降低耗魔，也降低主技能及其衍生傷害。', damageMultiplier: .8, costMultiplier: .6 },
  { id: 'rapid', name: '迅發', description: '主技能冷卻縮短；傷害降低，耗魔提高。', damageMultiplier: .9, costMultiplier: 1.3, cooldownMultiplier: .62 },
  { id: 'guarded', name: '護持', description: '施放後獲得少量護盾；主技能傷害降低、耗魔提高。', damageMultiplier: .82, costMultiplier: 1.15, shieldFraction: .065 },
]);

// Each mechanic changes the combat simulation, rather than merely its label.
export const ATLAS_BUILDS = freeze([
  { id: 'sword_whirlwind', baseClass: 'sword', name: '旋風掃蕩', mainSkill: '旋風斬', description: '一擊掃過多名敵人，清群快；單體與藍水效率較弱。', strengths: ['清群'], weaknesses: ['單體', '耗魔'], tags: ['area'], mechanic: 'strike', coefficient: 1.35, targets: 3, cost: 6, cooldown: 3, recommendedSupports: ['wide', 'economy'], recommendedAutomation: 'balanced' },
  { id: 'sword_bleed', baseClass: 'sword', name: '裂傷追獵', mainSkill: '裂傷斬', description: '堆疊流血後持續輸出；短命敵人來不及承受完整傷害。', strengths: ['持續傷害', '單體'], weaknesses: ['暖機', '清群'], tags: ['dot'], mechanic: 'bleed', coefficient: .9, targets: 1, cost: 4, cooldown: 3, dotCoefficient: .25, dotDuration: 6, maxStacks: 3, recommendedSupports: ['lasting', 'wide'], recommendedAutomation: 'balanced' },
  { id: 'sword_counter', baseClass: 'sword', name: '壁壘反擊', mainSkill: '盾鋒', description: '格擋減傷並反擊周圍敵人；敵人出手越少，反擊收益越低。', strengths: ['格擋', '耐久'], weaknesses: ['低頻首領'], tags: ['block'], mechanic: 'counter', coefficient: 1.05, targets: 1, cost: 3, cooldown: 3, blockChance: .4, blockReduction: .7, counterCoefficient: .95, recommendedSupports: ['guarded', 'economy'], recommendedAutomation: 'balanced' },
  { id: 'archer_pierce', baseClass: 'archer', name: '穿透獵風', mainSkill: '貫穿箭', description: '穿透多個目標並提高暴擊；後排命中略弱。', strengths: ['穿透', '暴擊'], weaknesses: ['補給消耗'], tags: ['area', 'critical'], mechanic: 'strike', coefficient: 1.45, targets: 3, secondaryMultiplier: .8, cost: 7, cooldown: 3, critChance: .15, recommendedSupports: ['wide', 'economy'], recommendedAutomation: 'balanced' },
  { id: 'archer_beast', baseClass: 'archer', name: '靈獸協擊', mainSkill: '召喚獵鷹', description: '召喚最多兩隻獵鷹持續攻擊；需先建立召喚隊伍。', strengths: ['持續單體', '離線穩定'], weaknesses: ['清群', '暖機'], tags: ['summon'], mechanic: 'beast', coefficient: .55, targets: 1, cost: 8, cooldown: 4, petCoefficient: .65, petDuration: 12, recommendedSupports: ['focused', 'economy'], recommendedAutomation: 'balanced' },
  { id: 'archer_trap', baseClass: 'archer', name: '棘網爆發', mainSkill: '棘網陷阱', description: '延遲引爆一群敵人；引爆前仍會承受攻擊。', strengths: ['群體爆發'], weaknesses: ['延遲', '耗魔'], tags: ['area', 'trap'], mechanic: 'trap', coefficient: 2.8, targets: 3, cost: 10, cooldown: 5, trapDelay: 2, recommendedSupports: ['wide', 'guarded'], recommendedAutomation: 'balanced' },
  { id: 'mage_chain', baseClass: 'mage', name: '雷鏈清場', mainSkill: '連鎖閃電', description: '閃電跳躍清群；密集施放會消耗更多藍水。', strengths: ['清群'], weaknesses: ['耗魔', '單體'], tags: ['area'], mechanic: 'strike', coefficient: 1.65, targets: 4, secondaryMultiplier: .85, cost: 13, cooldown: 3, recommendedSupports: ['rapid', 'economy'], recommendedAutomation: 'balanced' },
  { id: 'mage_frost', baseClass: 'mage', name: '冰盾消磨', mainSkill: '霜壁脈衝', description: '造成傷害、建立護盾並減慢敵人攻擊；爆發較低。', strengths: ['護盾', '緩速'], weaknesses: ['輸出速度'], tags: ['shield', 'area'], mechanic: 'frost', coefficient: 1.15, targets: 2, cost: 8, cooldown: 4, shieldFraction: .18, chillDuration: 5, recommendedSupports: ['wide', 'economy'], recommendedAutomation: 'balanced' },
  { id: 'mage_arcane', baseClass: 'mage', name: '秘法燃魔', mainSkill: '秘法聚束', description: '額外燃燒最大法力的一部分換取單體爆發；補給不足時回到普攻。', strengths: ['單體爆發'], weaknesses: ['耗魔'], tags: ['mana'], mechanic: 'arcane', coefficient: 3, targets: 1, cost: 12, cooldown: 3, manaFraction: .06, recommendedSupports: ['focused', 'economy'], recommendedAutomation: 'burst' },
  { id: 'thief_poison', baseClass: 'thief', name: '層毒蔓延', mainSkill: '淬毒刃', description: '堆疊毒素，擊殺後部分毒素蔓延；長血條目標較有利。', strengths: ['持續傷害', '單體'], weaknesses: ['暖機', '承傷'], tags: ['dot'], mechanic: 'poison', coefficient: .6, targets: 1, cost: 4, cooldown: 3, dotCoefficient: .24, dotDuration: 8, maxStacks: 5, recommendedSupports: ['lasting', 'wide'], recommendedAutomation: 'balanced' },
  { id: 'thief_execute', baseClass: 'thief', name: '印記處決', mainSkill: '終結刃', description: '對低於三成半生命的敵人造成雙倍主技能傷害。', strengths: ['處決', '單體'], weaknesses: ['清群'], tags: ['execute'], mechanic: 'execute', coefficient: 1.9, targets: 1, cost: 5, cooldown: 3, executeThreshold: .35, executeMultiplier: 2, recommendedSupports: ['focused', 'economy'], recommendedAutomation: 'balanced' },
  { id: 'thief_combo', baseClass: 'thief', name: '鏡刃連擊', mainSkill: '鏡刃', description: '每第三次施放追加兩次追擊，可轉向下一個存活目標。', strengths: ['連擊', '轉火'], weaknesses: ['耗魔', '承傷'], tags: ['combo'], mechanic: 'combo', coefficient: 1.1, targets: 1, cost: 4, cooldown: 2.5, recommendedSupports: ['rapid', 'economy'], recommendedAutomation: 'balanced' },
]);

const tutorial = (id, themeId, minLevel, previous, enemy, elite, rewards, hints) => ({
  id, name: `${MAPS[themeId].name}・教學星圖`, themeId, themeName: MAPS[themeId].name,
  emoji: MAPS[themeId].emoji, kind: 'tutorial', minLevel,
  prerequisites: previous ? [previous] : [], available: true,
  enemyName: MAPS[themeId].monsters[0], eliteName: MAPS[themeId].elite,
  roomCount: 5, packRooms: 4, travelSeconds: 6, entrySeconds: 12,
  enemy, elite, rewards, hints,
});

export const ATLAS_MAPS = freeze([
  tutorial('laurel_intro', 1, 1, null,
    { count: 3, hp: 65, atk: 8, def: 4, attackInterval: 4 },
    { count: 1, hp: 300, atk: 16, def: 5, attackInterval: 4 },
    { roomGold: 8, roomExp: 12, completionGold: 20, completionExp: 30, material: 'atlas_iron' },
    ['群體技能可同時削減敵人數量。', '觀察紅水與藍水消耗，再決定派遣長度。']),
  tutorial('pillar_intro', 2, 5, 'laurel_intro',
    { count: 4, hp: 120, atk: 12, def: 6, attackInterval: 4 },
    { count: 1, hp: 650, atk: 28, def: 8, attackInterval: 4 },
    { roomGold: 18, roomExp: 30, completionGold: 40, completionExp: 60, material: 'atlas_ember' },
    ['成群衛兵讓清群、格擋反擊發揮作用。', '凝聚會犧牲清群，換取精英戰傷害。']),
  tutorial('grove_intro', 3, 10, 'pillar_intro',
    { count: 3, hp: 200, atk: 20, def: 9, attackInterval: 4 },
    { count: 1, hp: 1100, atk: 40, def: 11, attackInterval: 5 },
    { roomGold: 28, roomExp: 60, completionGold: 60, completionExp: 120, material: 'atlas_venom' },
    ['較長戰鬥讓毒、流血與召喚逐步發力。', '護盾與補給能提升完整派遣的存活率。']),
  { id: 'laurel_warden', name: `${MAPS[1].boss.name}・試煉`, themeId: 1, themeName: MAPS[1].name,
    emoji: MAPS[1].emoji, kind: 'boss', minLevel: 10, prerequisites: ['grove_intro'], available: true,
    enemyName: MAPS[1].boss.name, eliteName: MAPS[1].boss.name,
    roomCount: 1, packRooms: 0, travelSeconds: 6, entrySeconds: 15,
    enemy: { count: 1, hp: 2800, atk: 58, def: 12, attackInterval: 5 },
    elite: { count: 1, hp: 2800, atk: 58, def: 12, attackInterval: 5 },
    rewards: { roomGold: 50, roomExp: 120, completionGold: 90, completionExp: 180, material: 'atlas_core' },
    hints: ['固定戰力的單體首領；不會隨你的裝備變強而同步加血。', '持續傷害、處決與燃魔適合長血條，仍需預留紅藍補給。'] },
]);

export const ATLAS_MATERIALS = freeze([
  { id: 'atlas_shard', name: '星圖碎屑', description: '星圖通用工坊材料。' },
  { id: 'atlas_iron', name: '月桂精鐵', description: '月桂林的定向工坊材料。' },
  { id: 'atlas_ember', name: '神殿餘燼', description: '百柱神殿的定向工坊材料。' },
  { id: 'atlas_venom', name: '聖林毒晶', description: '聖林的定向工坊材料。' },
  { id: 'atlas_core', name: '守望者核心', description: '試煉首領保證掉落的定向工坊材料。' },
]);

export const ATLAS_AUTOMATION = freeze([
  { id: 'balanced', name: '均衡', description: '優先處理成群或強敵；藍水保留給精英與首領。' },
  { id: 'burst', name: '全力', description: '主技能就緒即用，必要時消耗已攜帶的藍水。' },
  { id: 'conserve', name: '節約', description: '一般戰鬥保留半條法力，強敵才使用藍水。' },
]);

export function getAtlasCatalog() {
  // Return copies: callers cannot accidentally mutate the rules for another run.
  return structuredClone({
    rulesVersion: ATLAS_RULESET_VERSION, balanceStatus: 'prototype',
    profile: ATLAS_PROTOTYPE_PROFILE,
    maxDurationSeconds: ATLAS_MAX_DURATION_SECONDS, maxMapCount: ATLAS_MAX_MAP_COUNT,
    themes: ATLAS_THEMES, maps: ATLAS_MAPS, builds: ATLAS_BUILDS,
    supports: ATLAS_SUPPORTS, automation: ATLAS_AUTOMATION, materials: ATLAS_MATERIALS,
  });
}

export const getAtlasBuild = id => ATLAS_BUILDS.find(build => build.id === id) || null;
export const getAtlasMap = id => ATLAS_MAPS.find(map => map.id === id) || null;
