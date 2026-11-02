import { ATLAS_BUILDS } from './atlas-catalog.js';
import { GameError } from './classes.js';

export const ATLAS_TALENT_VERSION = 'atlas-talents-v1';
export const TALENT_EFFECT_LABELS = Object.freeze({
  atkPct:'攻擊',defPct:'防禦',maxHpPct:'最大生命',maxMpPct:'最大魔力',critPct:'暴擊機率',
  dotPct:'持續傷害',summonPct:'召喚傷害',shieldPct:'護盾效果',mpEfficiencyPct:'法力效率',
  mpCostPct:'技能耗魔',skillHastePct:'技能冷卻縮減',attackSpeedPct:'攻擊速度',takenPct:'承受傷害',skillDamagePct:'主技能傷害',
});
const fail=message=>{throw new GameError('atlas_talent',message,409);};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const features={
  sword_whirlwind:{stat:'skillDamagePct',name:'風暴之心',effects:{skillDamagePct:.22,maxHpPct:-.12}},
  sword_bleed:{stat:'dotPct',name:'猩紅誓約',effects:{dotPct:.35,atkPct:-.12}},
  sword_counter:{stat:'defPct',name:'不動壁壘',effects:{defPct:.25,attackSpeedPct:-.15}},
  archer_pierce:{stat:'critPct',name:'孤注鷹眼',effects:{critPct:.12,maxHpPct:-.10}},
  archer_beast:{stat:'summonPct',name:'群靈盟約',effects:{summonPct:.35,atkPct:-.12}},
  archer_trap:{stat:'skillDamagePct',name:'蓄勢棘獄',effects:{skillDamagePct:.25,skillHastePct:-.10}},
  mage_chain:{stat:'skillDamagePct',name:'無盡雷潮',effects:{skillDamagePct:.25,mpCostPct:.20}},
  mage_frost:{stat:'shieldPct',name:'冰鏡誓言',effects:{shieldPct:.35,atkPct:-.10}},
  mage_arcane:{stat:'maxMpPct',name:'燃魂秘典',effects:{maxMpPct:.30,takenPct:.10}},
  thief_poison:{stat:'dotPct',name:'萬毒共生',effects:{dotPct:.35,atkPct:-.12}},
  thief_execute:{stat:'atkPct',name:'孤影裁決',effects:{atkPct:.18,maxHpPct:-.15}},
  thief_combo:{stat:'attackSpeedPct',name:'無回之刃',effects:{attackSpeedPct:.18,takenPct:.12}},
};
export const talentPointsForLevel=level=>Math.min(24,1+Math.floor((Math.max(1,Math.min(120,Number(level)||1))-1)/5));
export function talentEffectText(effects){return Object.entries(effects).filter(([,n])=>n).map(([key,value])=>`${TALENT_EFFECT_LABELS[key]} ${value>0?'+':'−'}${Number((Math.abs(value)*100).toFixed(2))}%`).join('、')||'尚未配置天賦';}
const catalogs=new Map();
export function getAtlasTalentCatalog(baseClass){
  if(catalogs.has(baseClass))return structuredClone(catalogs.get(baseClass));
  const builds=ATLAS_BUILDS.filter(build=>build.baseClass===baseClass);
  if(builds.length!==3)fail('不支援的職業天賦');
  const nodes=[{id:'origin',name:'命運起點',kind:'origin',cost:0,minLevel:1,x:450,y:60,effects:{},description:'從起點沿連線配置天賦；每個節點消耗一點。'}],edges=[];
  const gates=[1,1,10,10,20,30,40,50,60,80];
  builds.forEach((build,branch)=>{
    const feature=features[build.id];
    for(let index=1;index<=10;index++){
      const kind=index===10?'keystone':index===5?'notable':'minor';
      const stat=index%3===0?'maxHpPct':index%3===2?'maxMpPct':feature.stat;
      const effects=kind==='keystone'?feature.effects:{[kind==='notable'?feature.stat:stat]:kind==='notable'?.06:stat==='critPct'?.01:.025};
      const id=`${build.id}_${index}`;
      nodes.push({id,branch:build.id,kind,cost:1,minLevel:gates[index-1],x:150+branch*300+(index%2?0:35),y:160+(index-1)*92,
        name:kind==='keystone'?feature.name:kind==='notable'?`${build.name}精通`:`${TALENT_EFFECT_LABELS[stat]}修習 ${index}`,
        effects:{...effects},description:talentEffectText(effects)});
      edges.push([index===1?'origin':`${build.id}_${index-1}`,id]);
    }
  });
  for(const index of [4,8])for(let branch=0;branch<2;branch++)edges.push([`${builds[branch].id}_${index}`,`${builds[branch+1].id}_${index}`]);
  const catalog=freeze({version:ATLAS_TALENT_VERSION,baseClass,nodes,edges,branches:builds.map(b=>({id:b.id,name:b.name,mainSkill:b.mainSkill,strengths:b.strengths,weaknesses:b.weaknesses})),effectLabels:TALENT_EFFECT_LABELS,maxPoints:24,resetGold:0,balanceStatus:'prototype'});
  catalogs.set(baseClass,catalog);return structuredClone(catalog);
}
export function validateAtlasTalents(baseClass,level,ids){
  if(!Array.isArray(ids)||ids.length>30||new Set(ids).size!==ids.length)fail('天賦配置包含重複或無效節點');
  const catalog=getAtlasTalentCatalog(baseClass),byId=new Map(catalog.nodes.map(node=>[node.id,node]));
  for(const id of ids){const node=byId.get(id);if(!node||node.cost!==1)fail('天賦不屬於目前職業');if(level<node.minLevel)fail(`此節點需要 ${node.minLevel} 級`);}
  if(ids.length>talentPointsForLevel(level))fail('可用天賦點數不足');
  const selected=new Set(['origin',...ids]),reachable=new Set(['origin']);
  for(let pass=0;pass<=ids.length;pass++)for(const [a,b]of catalog.edges){if(selected.has(a)&&selected.has(b)){if(reachable.has(a))reachable.add(b);if(reachable.has(b))reachable.add(a);}}
  if(ids.some(id=>!reachable.has(id)))fail('請先配置與起點相連的節點');
  const effects={};for(const id of ids)for(const [key,value]of Object.entries(byId.get(id).effects))effects[key]=Math.round(((effects[key]||0)+value)*10000)/10000;
  return {version:ATLAS_TALENT_VERSION,allocatedIds:[...ids].sort(),spent:ids.length,totalPoints:talentPointsForLevel(level),availablePoints:talentPointsForLevel(level)-ids.length,effects,effectText:talentEffectText(effects)};
}
export function applyAtlasTalentSnapshot(snapshot,ids=[]){
  const talents=validateAtlasTalents(snapshot.baseClass,snapshot.level,ids),e=talents.effects;
  if(!ids.length)return {snapshot,talents};
  const next={...snapshot,pct:{...snapshot.pct}};
  for(const key of ['atk','def','maxHp','maxMp'])next[key]=Math.max(key==='maxHp'?1:0,Math.min(100000000,Math.round(snapshot[key]*(1+(e[key+'Pct']||0)))));
  next.hp=Math.max(1,Math.min(next.maxHp,Math.round(snapshot.hp/snapshot.maxHp*next.maxHp)));
  next.mp=snapshot.maxMp?Math.min(next.maxMp,Math.round(snapshot.mp/snapshot.maxMp*next.maxMp)):0;
  next.mpRegenPerSecond=Math.min(next.maxMp,snapshot.mpRegenPerSecond*(next.maxMp/Math.max(1,snapshot.maxMp)));
  next.taken=Math.min(10,snapshot.taken*(1+(e.takenPct||0)));
  next.attackSpeedMultiplier=Math.min(4,snapshot.attackSpeedMultiplier*(1+(e.attackSpeedPct||0)));
  for(const key of ['critPct','dotPct','summonPct','shieldPct','mpEfficiencyPct','mpCostPct','skillHastePct','skillDamagePct'])next.pct[key]=Math.max(-.9,Math.min(3,(next.pct[key]||0)+(e[key]||0)));
  return {snapshot:next,talents};
}

/** Shortest legal additive route; existing choices and their tradeoffs remain. */
export function planAtlasTalentPath(baseClass,level,ids,nodeId){
  const current=validateAtlasTalents(baseClass,level,ids),catalog=getAtlasTalentCatalog(baseClass),nodes=new Map(catalog.nodes.map(n=>[n.id,n]));
  const target=nodes.get(nodeId);if(!target||target.id==='origin')fail('請選擇這個職業的天賦節點');
  const owned=new Set(['origin',...ids]),queue=[...owned],paths=new Map(queue.map(id=>[id,[]]));
  for(let i=0;i<queue.length&&!paths.has(nodeId);i++){
    const at=queue[i];for(const edge of catalog.edges){const next=edge[0]===at?edge[1]:edge[1]===at?edge[0]:null;if(!next||paths.has(next)||nodes.get(next).minLevel>level)continue;paths.set(next,[...paths.get(at),next]);queue.push(next);}
  }
  const route=paths.get(nodeId)||[],addedIds=route.filter(id=>!owned.has(id)),required=addedIds.length;
  const reason=owned.has(nodeId)?'此節點已配置':target.minLevel>level?`此節點需要 Lv.${target.minLevel}`:!paths.has(nodeId)?'目前等級還無法連通這條路線':required>current.availablePoints?`需要 ${required} 點，目前可用 ${current.availablePoints} 點`:null;
  return {nodeId,targetName:target.name,addedIds,requiredPoints:required,availablePoints:current.availablePoints,canApply:!reason,reason,
    route:route.map(id=>({id,name:nodes.get(id).name,description:nodes.get(id).description,kind:nodes.get(id).kind})),
    before:current,after:reason?null:validateAtlasTalents(baseClass,level,[...ids,...addedIds])};
}
