import {AFFIXES,BRANCH_AFFIXES,affixLines,affixSlots} from './affixes.js';
import {GameError} from './classes.js';
export const QUALITY_SCORES=Object.freeze({C:0,B:40,A:65,S:85,SS:95});
export function usefulTargets(char){
 const cls=char.base_class,branch=String(char.class_path||'').slice(0,2),recommended=BRANCH_AFFIXES[cls]?.[branch]||[],attack={sword:'meleePct',thief:'meleePct',archer:'rangedPct',mage:'magicPct'}[cls];
 const entries=[['attack','攻擊',attack],['experience','經驗','expPct'],['critical','爆擊','critPct'],['life','生命','maxHpPct'],['mana','魔力','maxMpPct'],['guard','減傷','mitigationPct'],['economy','節魔','mpEfficiencyPct'],['haste','技能冷卻','skillHastePct']];
 for(const key of ['healingPct','shieldPct','dotPct','summonPct','lifestealPct','elemPct'])if(recommended.includes(key))entries.push([key,AFFIXES[key].name,key]);
 return entries.filter(x=>x[2]).map(([id,name,key])=>({id,name,key,affixName:AFFIXES[key].name,recommended:recommended.includes(key)}));
}
export function targetConfig(char,item,b){
 const list=usefulTargets(char);if(!Array.isArray(b.functions)||b.functions.some(x=>typeof x!=='string')||new Set(b.functions).size!==b.functions.length)throw new GameError('target','請選擇有效能力目標');
 const selected=b.functions.map(id=>list.find(x=>x.id===id));if(selected.some(x=>!x))throw new GameError('target','這項能力不適合目前職業分支');
 const quality=b.quality||null;if(quality&&!Object.hasOwn(QUALITY_SCORES,quality))throw new GameError('quality','請選擇有效品質');if(!selected.length&&!quality)throw new GameError('target','至少選擇能力或品質');
 if(item.class_req!=='any'&&item.class_req!==char.base_class)throw new GameError('class','請選擇目前角色可用的裝備');
 const locks=b.locks||[],typeLocks=b.typeLocks||[];for(const ids of [locks,typeLocks])if(!Array.isArray(ids)||ids.some(i=>!Number.isInteger(i))||new Set(ids).size!==ids.length)throw new GameError('locks','鎖定格式錯誤');
 const lines=affixLines(item),slots=affixSlots(item),all=[...locks,...typeLocks];if(new Set(all).size!==all.length||all.some(i=>i<0||i>=lines.length))throw new GameError('locks','請檢查鎖定詞條');if(locks.length>=slots)throw new GameError('locks','至少保留一條可重洗詞條');
 for(const i of typeLocks)if(!list.some(x=>x.key===lines[i].key))throw new GameError('locks','只能鎖定對目前角色有用的能力');
 const keys=selected.map(x=>x.key),fixed=all.map(i=>lines[i].key);if(keys.filter(k=>!fixed.includes(k)).length>slots-all.length)throw new GameError('target','詞條格數不足，請減少能力目標或解除鎖定');
 if(keys.length&&!quality&&keys.every(k=>locks.some(i=>lines[i].key===k)))throw new GameError('target','所選能力已完整鎖定；請設定其餘詞條的目標品質，或選擇其他未鎖定能力');
 const maxGold=b.maxGold==null||b.maxGold===''?null:Number(b.maxGold);if(maxGold!==null&&(!Number.isSafeInteger(maxGold)||maxGold<0))throw new GameError('budget','金幣上限無效');
 return {functions:selected.map(x=>x.id),keys,quality,locks:[...locks].sort((a,b)=>a-b),typeLocks:[...typeLocks].sort((a,b)=>a-b),maxGold};
}
export function targetState(lines,slots,cfg){
 const locks=cfg.locks||[],fixed=new Set(lines.filter((_,i)=>locks.includes(i)).map(x=>x.key)),keys=(cfg.keys||[]).filter(k=>!fixed.has(k)),mutable=lines.filter((_,i)=>!locks.includes(i)),score=cfg.quality?QUALITY_SCORES[cfg.quality]:0;
 return {keys,mutableCount:slots-locks.length,needsQuality:!!cfg.keys?.length&&!keys.length&&!cfg.quality,reached:lines.length===slots&&mutable.length>0&&(keys.length?keys.every(key=>mutable.some(x=>x.key===key&&x.score>=score)):!!cfg.quality&&mutable.every(x=>x.score>=score))};
}
export function targetReached(item,cfg){return targetState(affixLines(item),affixSlots(item),cfg).reached;}
