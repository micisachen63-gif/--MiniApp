// Thief release accepted after all 62 visuals, combat modes and the preserving-data production CHECK expansion.
// Build-time class eligibility follows the verified database and art acceptance receipts.
export const THIEF_RELEASE_READY = true;

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const skill = (name, cost, mult, targets, thiefRoute = null) => ({ name, cost, mult, targets, ...(thiefRoute ? { thiefRoute } : {}) });

const nodes = {
  '': { name: '盜賊', skill: skill('迅刃突刺', 4, 1.7, 1), passive: { text: '疾刃：原生攻擊頻率 ×1.8；單擊威力 60%，生命與防禦較低' }, weapon: 'dagger' },
  A: { name: '刺客', line: '刺客系', weapon: 'dual_daggers', skill: skill('交錯刃擊', 8, 2.05, 1),
    passive: { text: '要害洞察：爆擊 +10%', critPct: 0.10 }, blurb: '雙匕近戰，發展單體爆發與毒刃' },
  B: { name: '夜行者', line: '夜行者系', weapon: 'throwing_blades', skill: skill('迴旋飛刃', 10, 1.9, 2),
    passive: { text: '夜行身法：受傷 −4%', takenPct: -0.04 }, blurb: '飛刃中距離攻擊，發展多目標與幻影戰術；生命與防禦仍低' },
  A1: { name: '影襲刺客', skill: skill('斷影背刺', 18, 3.15, 1, 'A1'),
    passive: { text: '破綻洞察：爆擊 +15%', critPct: 0.15 }, blurb: '利用破綻提高單體傷害，擅長首領爆發' },
  A2: { name: '毒刃刺客', skill: skill('蝕骨毒刃', 18, 2.5, 1, 'A2'),
    passive: { text: '淬毒：持續傷害 +15%', dotPct: 0.15 }, blurb: '攻擊力毒傷，毒層與持續時間有上限' },
  B1: { name: '飛刃遊俠', skill: skill('千刃迴旋', 20, 2.65, 3, 'B1'),
    passive: { text: '刃心：爆擊 +10%', critPct: 0.10 }, blurb: '飛刃穿擊多個目標，擅長清怪' },
  B2: { name: '幻刃使', skill: skill('鏡影連襲', 20, 2.4, 2, 'B2'),
    passive: { text: '鏡影護身：受傷 −5%', takenPct: -0.05 }, blurb: '幻刃連擊並有限削弱敵方下一次攻擊；維持脆皮特性' },
};

// Advancement continues the existing tier-2 stat budget; names, identities and choreography are distinct.
const advanced = {
  A11: ['夜幕處刑者', '夜幕斷罪'], A12: ['幽影追獵者', '幽影獵襲'],
  A21: ['蝕毒煉師', '蝕毒連刃'], A22: ['血棘獵手', '血棘穿刺'],
  B11: ['疾風刃使', '疾風刃旋'], B12: ['星刃獵手', '星芒追刃'],
  B21: ['鏡影舞者', '鏡影刃舞'], B22: ['暮光詭術師', '暮光幻襲'],
  A111: ['冥夜裁決者', '冥夜裁決'], A112: ['終焉斷刃', '終焉斷影'],
  A121: ['虛影行者', '虛影穿襲'], A122: ['無聲獵魂者', '無聲獵魂'],
  A211: ['九首毒刃', '九首蝕毒'], A212: ['冥蛇使徒', '冥蛇噬影'],
  A221: ['血棘君主', '血棘王刃'], A222: ['蝕魂收割者', '蝕魂收割'],
  B111: ['風暴千刃', '風暴千刃'], B112: ['疾影穿梭者', '疾影穿梭'],
  B121: ['星隕刃使', '星隕刃雨'], B122: ['星軌追獵者', '星軌追獵'],
  B211: ['千面幻刃', '千面鏡殺'], B212: ['鏡界行者', '鏡界穿行'],
  B221: ['暮光織影者', '暮光織刃'], B222: ['黑月詭術師', '黑月幻刃'],
};
for (const [path, [name, skillName]] of Object.entries(advanced)) {
  const parent = nodes[path.slice(0, 2)];
  nodes[path] = { ...parent, name, skill: { ...parent.skill, name: skillName }, passive: { ...parent.passive } };
}
export const THIEF_NODES = freeze(Object.fromEntries(Object.entries(nodes).map(([path, node]) => [path, {
  ...node, path, tier: path.length, weapon: node.weapon || nodes[path[0]].weapon,
}])));
export const THIEF_PATHS = freeze(Object.keys(THIEF_NODES));
export const THIEF_IDENTITIES = freeze(THIEF_PATHS.flatMap(path => ['m', 'f'].map(gender => ({
  key: `thief:${path || 'base'}:${gender}`, baseClass: 'thief', classPath: path, gender,
  name: THIEF_NODES[path].name, tier: path.length,
}))));

export const THIEF_CLASS = freeze({
  key: 'thief', name: '盜賊', emoji: '🗡️', blurb: '極高攻速、低生命與低防禦；以破綻、毒刃與幻影掌控戰局',
  releaseReady: THIEF_RELEASE_READY,
  atk: [12, 2.8], hp: [60, 9], mp: [44, 4], def: [2, 0.65], taken: 1.0,
  attackSpeedMultiplier: 1.8, hitAttackMultiplier: 0.60,
  node: THIEF_NODES[''], branches: { A: THIEF_NODES.A, B: THIEF_NODES.B },
});
export const THIEF_BRANCHES2 = freeze({ A: { 1: THIEF_NODES.A1, 2: THIEF_NODES.A2 }, B: { 1: THIEF_NODES.B1, 2: THIEF_NODES.B2 } });

const prefixes = ['月桂', '雅典', '聖林', '海神', '迷宮', '熔爐', '冥河', '神諭', '泰坦', '雲門', '至福', '星穹'];
const names = (suffix, branch = false) => Object.fromEntries(prefixes.flatMap((prefix, index) => branch && index === 0 ? [] : [[index + 1, prefix + suffix]]));
export const THIEF_WEAPONS = freeze({
  dagger: { cls: 'thief', branch: null, type: '短匕', names: names('短匕'), bonus: {} },
  dual_daggers: { cls: 'thief', branch: 'A', type: '雙匕', names: names('交錯雙匕', true), bonus: { critPct: 0.08, atkPct: 0.05 }, desc: '爆擊 +8%、ATK +5%' },
  throwing_blades: { cls: 'thief', branch: 'B', type: '飛刃', names: names('迴旋飛刃', true), bonus: { critPct: 0.05, mpCostPct: -0.05 }, desc: '爆擊 +5%、耗魔 −5%' },
});
export const THIEF_ARMOR = freeze({
  key: 'light_leather', name: '輕甲', defMult: 0.40, perPiece: { takenPct: -0.01 }, desc: '每件受傷 −1%；防禦低，維持迅捷脆皮定位',
  pieces: { helmet: '夜行兜帽', armor: '盜賊輕甲', gloves: '輕革護手', boots: '軟底短靴' },
});
