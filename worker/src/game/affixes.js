// Equipment affixes are independent of item rarity and legacy relic bonuses.
import { GameError } from './classes.js';
export const AFFIXES = Object.freeze({
 meleePct:{name:'近戰傷害',classes:['sword','thief'],range:[.008,.035]},
 rangedPct:{name:'遠程傷害',classes:['archer'],range:[.008,.035]},
 magicPct:{name:'魔法傷害',classes:['mage'],range:[.008,.035]},
 critPct:{name:'爆擊機率',range:[.004,.018]},
 maxHpPct:{name:'生命增幅',range:[.01,.045]},
 maxMpPct:{name:'魔力增幅',range:[.01,.045]},
 mitigationPct:{name:'傷害減免',range:[.005,.022]},
 mpEfficiencyPct:{name:'施法節魔',range:[.005,.025]},
 skillHastePct:{name:'特殊技能冷卻縮減',range:[.004,.018]},
 healingPct:{name:'治療強度',range:[.008,.035]},
 shieldPct:{name:'護盾強度',range:[.008,.035]},
 dotPct:{name:'持續／陷阱傷害',classes:['archer','mage','thief'],range:[.008,.035]},
 summonPct:{name:'召喚傷害',classes:['archer','mage'],range:[.008,.035]},
 lifestealPct:{name:'攻擊吸血',classes:['sword','archer','thief'],range:[.002,.01]},
 elemPct:{name:'元素威力',classes:['mage'],range:[.005,.022]},
 expPct:{name:'討伐經驗',range:[.005,.022]},
});
export const BRANCH_AFFIXES=Object.freeze({
 thief:{A1:['meleePct','critPct','skillHastePct'],A2:['meleePct','dotPct','mpEfficiencyPct'],B1:['meleePct','critPct','mpEfficiencyPct'],B2:['meleePct','mitigationPct','skillHastePct']},
 sword:{A1:['meleePct','lifestealPct','maxHpPct'],A2:['meleePct','critPct','skillHastePct'],B1:['healingPct','shieldPct','maxMpPct'],B2:['mitigationPct','maxHpPct','shieldPct']},
 archer:{A1:['rangedPct','critPct','skillHastePct'],A2:['rangedPct','mpEfficiencyPct','mitigationPct'],B1:['summonPct','rangedPct','maxMpPct'],B2:['dotPct','rangedPct','mpEfficiencyPct']},
 mage:{A1:['magicPct','elemPct','maxMpPct'],A2:['magicPct','mitigationPct','skillHastePct'],B1:['skillHastePct','mpEfficiencyPct','magicPct'],B2:['summonPct','shieldPct','maxMpPct']},
});
export function affixSlots(item){const t=Math.max(1,Math.min(12,Number(item.tier)||1));return t>=12?5:t>=9?4:t>=6?3:t>=3?2:1;}
export function affixLines(item){try{const x=JSON.parse(item.affixes_json||'[]');return Array.isArray(x)?x:[];}catch{return [];}}
export function quality(score){return score>=95?'SS':score>=85?'S':score>=65?'A':score>=40?'B':'C';}
export function rangeFor(item,key){const x=AFFIXES[key];if(!x)return [0,0];const scale=1+.04*(Math.max(1,Math.min(12,Number(item.tier)||1))-1);return x.range.map(v=>Math.round(v*scale*10000)/10000);}
export function affixView(item,path='',wearerClass=null){const lines=affixLines(item).map((x,i)=>({...x,index:i,name:AFFIXES[x.key]?.name||x.key,range:rangeFor(item,x.key),quality:quality(x.score),recommended:(BRANCH_AFFIXES[wearerClass||item.class_req]?.[String(path).slice(0,2)]||[]).includes(x.key)}));const score=lines.length?Math.round(lines.reduce((n,x)=>n+x.score,0)/lines.length):0;return {slots:affixSlots(item),lines,score,quality:lines.length?quality(score):'未鑑定'};}
export function normalizeLocks(item,locks=[]){if(!Array.isArray(locks)||locks.some(x=>!Number.isInteger(x)))throw new GameError('locks','鎖定詞條格式錯誤');const ids=[...new Set(locks)].sort((a,b)=>a-b),lines=affixLines(item);if(ids.some(i=>i<0||i>=lines.length))throw new GameError('locks','只能鎖定已存在的詞條');if(ids.length>=affixSlots(item))throw new GameError('locks','至少保留一條可重洗詞條');return ids;}

export function normalizeRerollLocks(item,locks=[],typeLocks=[]){
 if(!Array.isArray(typeLocks))throw new GameError('locks','鎖定格式錯誤');
 if(!typeLocks.length)return {locks:normalizeLocks(item,locks),typeLocks:[]};
 const old=affixLines(item);for(const ids of [locks,typeLocks])if(!Array.isArray(ids)||ids.some(i=>!Number.isInteger(i)))throw new GameError('locks','鎖定格式錯誤');
 const full=[...new Set(locks)].sort((a,b)=>a-b),types=[...new Set(typeLocks)].sort((a,b)=>a-b),all=[...full,...types];
 if(new Set(all).size!==all.length||all.some(i=>i<0||i>=old.length||!AFFIXES[old[i].key])||full.length>=affixSlots(item))throw new GameError('locks','請保留至少一條可洗數值的詞條');
 return {locks:full,typeLocks:types};
}
export function affixCost(item,locks=[],typeLocks=[]){const ids=normalizeRerollLocks(item,locks,typeLocks),tier=Math.max(1,Number(item.tier)||1),n=ids.locks.length+ids.typeLocks.length;return {scrolls:tier*[1,2,4,7,11,16][n],fee:tier*30*(n+1)**2,...ids};}
export function rollAffixes(item,rng,locks=[],typeLocks=[]){
 const ids=normalizeRerollLocks(item,locks,typeLocks),old=affixLines(item),out=Array(affixSlots(item)),used=new Set();
 for(const i of ids.locks){out[i]={...old[i]};used.add(out[i].key);}for(const i of ids.typeLocks)used.add(old[i].key);
 const pool=Object.keys(AFFIXES).filter(k=>!AFFIXES[k].classes||item.class_req==='any'||AFFIXES[k].classes.includes(item.class_req));
 for(let i=0;i<out.length;i++){if(out[i])continue;let key;if(ids.typeLocks.includes(i))key=old[i].key;else{const options=pool.filter(k=>!used.has(k));key=options[Math.min(options.length-1,Math.floor(rng()*options.length))];used.add(key);}
 const r=rng(),interval=r<.2?[0,39]:r<.55?[40,64]:r<.85?[65,84]:r<.97?[85,94]:[95,100];const score=interval[0]+Math.min(interval[1]-interval[0],Math.floor(rng()*(interval[1]-interval[0]+1)));const [lo,hi]=rangeFor(item,key);out[i]={key,score,value:Math.round((lo+(hi-lo)*score/100)*10000)/10000};}
 return out;
}
export function affixTotals(item){const out={};for(const x of affixLines(item))if(AFFIXES[x.key]&&Number.isFinite(x.value))out[x.key]=(out[x.key]||0)+x.value;return out;}
