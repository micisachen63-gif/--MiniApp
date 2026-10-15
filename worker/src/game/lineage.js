// Read-only descriptions derived from the same nodes as combat. No balance overrides.
import {CLASSES, BRANCHES2, GENERAL_WEAPON, WEAPON_KINDS, ITEMS, MAX_OPEN_CLASS_TIER} from './constants.js';
import {nodeFor} from './stats.js';
import {THIEF_NODES} from './thief-data.js';

const PATHS = ['', 'A', 'B', ...['A1','A2','B1','B2'].flatMap(p => [p, p+'1', p+'2', p+'11', p+'12', p+'21', p+'22'])];
const THIEF_EFFECTS = {
  A1: '原生技能命中存活目標後，若無有效標記則施加承傷 +4% 標記，持續 90 秒；攻擊已有標記的目標時，本次原生技能傷害 +10%。標記不疊加。',
  A2: '原生技能命中存活目標後增加 1 層毒刃，每人最多 3 層；每 30 秒每層造成 0.12×攻擊力的毒傷，最多 3 次，受持續傷害加成影響。刷新不提前跳傷。',
  B1: '原生技能計傷時忽略目標 10% 防禦，最多攻擊 3 個目標。',
  B2: '原生技能命中存活目標後，使其 60 秒內下一次攻擊傷害 −10%；不疊加，與同類效果取較強值。',
};

export function lineageNodes(baseClass) {
  const cls = CLASSES[baseClass];
  return PATHS.map(path => {
    const node = nodeFor(baseClass, path), tier = path.length;
    const authored = baseClass === 'thief' ? THIEF_NODES[path] : !tier ? cls.node : tier === 1 ? cls.branches[path] : BRANCHES2[baseClass][path[0]][path[1]];
    const material = tier ? `${tier >= 3 ? 'trial' : 'mat'}_${tier}` : null;
    const parentPath = tier ? path.slice(0, -1) : null;
    return {
      path, tier, name: node.name, skill: {...node.skill}, passive: {text: node.passiveText},
      basePassive: cls.node.passive.text,
      blurb: authored.blurb || cls.blurb,
      role: node.specialization?.role || null,
      weapon: WEAPON_KINDS[node.weapon || GENERAL_WEAPON[baseClass]]?.type,
      parentPath, parentName: tier ? nodeFor(baseClass, parentPath).name : null,
      level: tier ? tier * 30 : 1, available: tier <= MAX_OPEN_CLASS_TIER,
      material, materialName: material ? ITEMS[material].name : null,
      materialSource: tier >= 3 ? '通關對應三人真人組隊試煉，領取綁定證明' : tier ? `討伐${tier === 1 ? '哥布林酋長' : '腐朽樹王'}` : null,
      effect: baseClass === 'thief' ? node.specialization?.text || THIEF_EFFECTS[path.slice(0,2)] || '極高攻速，生命與防禦較低；全路線適用近戰守護。' : null,
      inheritance: tier >= 3 ? '包含二轉與一轉被動及本階專精；三、四轉專精不逐階重複疊加。' : tier === 2 ? '包含二轉與一轉被動。' : null,
    };
  }).sort((a,b) => a.tier-b.tier || a.path.localeCompare(b.path));
}
