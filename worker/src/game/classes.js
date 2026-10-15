// Class advancement (needs the map boss material) and 命運轉職書 re-selection (pure).
import { CLASSES, BRANCH_KEYS, BRANCH2_KEYS, BRANCHES2, ITEMS, RESELECT_COOLDOWN_MS, MAX_OPEN_CLASS_TIER } from './constants.js';
import { classTier } from './stats.js';
import {MAGE_FOURTH,renamedPassive} from './mage-fourth.js';
import { THIEF_NODES } from './thief-data.js';

export class GameError extends Error { constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; } }

/** tier 1 → A/B; tier 2 → the two children ('1'/'2') of the tier-1 branch in `path` */
export function branchChoices(baseClass, tier = 1, path = '') {
  if (baseClass === 'thief') {
    if (!Object.hasOwn(THIEF_NODES, path) || tier !== path.length + 1 || tier > MAX_OPEN_CLASS_TIER) return [];
    return (tier === 1 ? BRANCH_KEYS : BRANCH2_KEYS).map(branch => ({ branch, ...THIEF_NODES[path + branch] }));
  }
  if (tier === 1) return BRANCH_KEYS.map((k) => ({ branch: k, path: k, tier: 1, ...CLASSES[baseClass].branches[k] }));
  if (tier === 2 && path && path[0]) { const p = CLASSES[baseClass].branches[path[0]];
    return BRANCH2_KEYS.map((k) => ({ branch: k, path: path[0] + k, tier: 2, line: `${p.name}系`, weapon: p.weapon, ...BRANCHES2[baseClass][path[0]][k] })); }
  if(tier===4&&baseClass==='mage')return BRANCH2_KEYS.map(k=>({branch:k,path:path+k,tier,...nodeAt(baseClass,path+k)}));
  if (tier >= 3 && tier <= 4) return BRANCH2_KEYS.map(k => ({branch:k,path:path+k,tier,...nodeAt(baseClass,path),name:`${nodeAt(baseClass,path).name} · ${tier===3?'英雄傳承':'神域覺醒'} ${k}`}));
  return [];
}
const keysFor = (tier) => (tier === 1 ? BRANCH_KEYS : BRANCH2_KEYS);
const nodeAt = (baseClass, path) => {
 if(baseClass==='thief') {
   const node=THIEF_NODES[path];
   if(!node)throw new GameError('branch','路線無效');
   return node;
 }
 if(path.length===1)return CLASSES[baseClass].branches[path];
 const base=BRANCHES2[baseClass][path[0]][path[1]],fourth=baseClass==='mage'?MAGE_FOURTH[path]:null;
 return {...base,name:fourth?.name||`${base.name}${path.length>=3?' · 英雄傳承':''}${path.length>=4?' · 神域覺醒':''}`,skill:fourth?{...base.skill,name:fourth.skillName}:base.skill,passive:fourth?{...base.passive,text:renamedPassive(base.passive.text,fourth.passiveName)}:base.passive};
};

/** first advancement at Lv30 (P1). mutates c / inv; returns summary */
export function advance(c, inv, branch) {
  if (c.base_class === 'thief' && !Object.hasOwn(THIEF_NODES, c.class_path || '')) throw new GameError('branch', '路線無效');
  const tier = classTier(c.class_path) + 1;
  if (tier > MAX_OPEN_CLASS_TIER) throw new GameError('not_open', `第 ${tier} 次轉職尚未開放`);
  if (c.level < tier * 30) throw new GameError('level', `需要 Lv${tier * 30} 才能轉職`);
  if (!keysFor(tier).includes(branch)) throw new GameError('branch', '路線無效');
  const mat = tier>=3?`trial_${tier}`:`mat_${tier}`;
  if ((inv[mat] || 0) < 1) throw new GameError('material', `需要「${ITEMS[mat].name}」×1（完成三人真人組隊試煉取得）`);
  inv[mat] -= 1;
  const from = c.class_path; c.class_path = (c.class_path || '') + branch;
  return { tier, from, to: c.class_path, node: nodeAt(c.base_class, c.class_path), used: { [mat]: 1 } };
}

/**
 * 命運轉職書: switch the branch chosen at `tier`. Deeper tiers (none in P1) become pending and are re-picked for free.
 * Branch-exclusive weapons that no longer match are unequipped (each keeps its one free conversion token).
 */
export function reselect(c, inv, equipment, tier, newBranch, now) {
  if (c.base_class === 'thief' && (!Object.hasOwn(THIEF_NODES, c.class_path || '') || !Number.isInteger(tier) || tier < 1)) throw new GameError('branch', '路線無效');
  const book = `reselect_${tier}`;
  if (tier > MAX_OPEN_CLASS_TIER) throw new GameError('not_open', '這本轉職書尚未開放');
  if (classTier(c.class_path) < tier) throw new GameError('not_advanced', '你還沒完成這一層轉職');
  if ((inv[book] || 0) < 1) throw new GameError('no_book', `需要「${ITEMS[book].name}」（商店購買）`);
  if (c.last_reselect_at && now - c.last_reselect_at < RESELECT_COOLDOWN_MS) {
    const leftMs = RESELECT_COOLDOWN_MS - (now - c.last_reselect_at);
    const leftMin = Math.ceil(leftMs / 60_000);
    const text = leftMin > 60 ? `約 ${Math.ceil(leftMin / 60)} 小時` : `${leftMin} 分鐘`;
    throw new GameError('cooldown', `命運轉職書冷卻中（剩餘 ${text}）`);
  }
  const cur = c.class_path[tier - 1];
  if (!keysFor(tier).includes(newBranch) || newBranch === cur) throw new GameError('branch', '請選擇另一條路線');
  inv[book] -= 1;
  const from = c.class_path;
  // v0.5: deeper tiers keep their slot (A1 → book I → B1), so nobody is left without a node; book II then picks 1↔2
  c.class_path = c.class_path.slice(0, tier - 1) + newBranch + c.class_path.slice(tier);
  c.pending_tier = null;
  c.last_reselect_at = now;
  const unequipped = [];
  for (const item of equipment) {
    if (item.is_equipped && item.branch_req && item.branch_req !== c.class_path[0]) { item.is_equipped = 0; unequipped.push(item.id); }
  }
  return { from, to: c.class_path, unequipped, used: { [book]: 1 } };
}
