// Numerical specialization for the three existing classes only. Resource-meter
// and manual-release proposals in docs/class-combat remain a separate phase.
import {ELF_FUTURE} from './elf-future.js';
import {MAGE_FUTURE} from './mage-future.js';
import {MAGE_FOURTH,renamedPassive} from './mage-fourth.js';

// [identity, native multiplier, native cost multiplier, extra native targets, passive]
const THIRD={
 sword:{
  A11:['血契',1.06,1.06,0,{lifestealPct:.03}], A12:['怒潮',1.02,1,0,{maxHpPct:.08,lifestealPct:.02}],
  A21:['劍意',1.06,1.05,0,{critPct:.06}], A22:['裂空',.97,1.10,1,{atkPct:.03}],
  B11:['聖療',1.03,1.03,0,{healingPct:.12,healPerCastPct:.005}], B12:['庇護',1,1,0,{shieldPct:.12,maxHpPct:.06,takenPct:-.02}],
  B21:['壁壘',1,1,0,{takenPct:-.03,defPct:.06,shieldPct:.08}], B22:['反攻',1.05,1.06,0,{atkPct:.06,shieldPct:.10,takenPct:.02}]
 },
 archer:{
  A11:['鷹眼',1.04,1.04,0,{critPct:.05,rangedPct:.03}], A12:['星雨',.98,1.08,1,{mpEfficiencyPct:.02}],
  A21:['風步',1.02,1,0,{takenPct:-.04,skillHastePct:.04}], A22:['巡風',.96,1,1,{mpEfficiencyPct:.05,expPct:.02}],
  B11:['獸契',1.02,1.03,0,{summonPct:.10,healingPct:.06}], B12:['森護',1,1,0,{shieldPct:.10,healPerCastPct:.004}],
  B21:['蝕影',1.02,1.03,0,{dotPct:.12,skillHastePct:.04}], B22:['月巡',1,1,0,{mpEfficiencyPct:.06,maxMpPct:.08}]
 },
 mage:{
  A11:['星炎',1.05,1.08,0,{magicPct:.05,critPct:.03}], A12:['焚星',1.02,.97,0,{dotPct:.10,maxMpPct:.08}],
  A21:['霜壁',1,1,0,{takenPct:-.04,shieldPct:.10}], A22:['霜序',1.03,1.05,0,{skillHastePct:.05,magicPct:.03}],
  B11:['時流',1,1,0,{mpEfficiencyPct:.06,maxMpPct:.10}], B12:['虛詠',1.03,1.03,0,{freeCastPct:.05,magicPct:.03}],
  B21:['靈契',1,1.03,0,{summonPct:.10,shieldPct:.10}], B22:['冥契',1.02,1.03,0,{magicPct:.04,healPerCastPct:.004}]
 }
};
const LABELS={lifestealPct:'吸血',maxHpPct:'生命',maxMpPct:'魔力',critPct:'爆擊率',atkPct:'攻擊',defPct:'防禦',healingPct:'治療效果',healPerCastPct:'每次施法回血',shieldPct:'護盾效果',takenPct:'承受傷害',rangedPct:'遠程傷害',magicPct:'魔法傷害',mpEfficiencyPct:'魔力效率',skillHastePct:'特殊技能冷卻縮減',expPct:'經驗',summonPct:'召喚傷害',dotPct:'持續傷害',freeCastPct:'免費施法率'};
const round=n=>Math.round(n*10000)/10000;
export function specializationFor(base,path){
 const p=String(path||''),entry=THIRD[base]?.[p.slice(0,3)];
 if(!entry||!/^([AB])[12][12](?:[12])?$/.test(p))return null;
 const [role,mult,cost,targets,bonuses]=entry;
 const passive={...bonuses};let skillMult=mult,costScale=cost,focus=role;
 if(p.length===4){
  if(p[3]==='1'){
   // Deepen the selected third-tier identity, including healing/tank routes.
   for(const [key,value]of Object.entries(bonuses))passive[key]=round(value*1.5);
   skillMult*=1.03;costScale*=1.04;focus+=' · 精進';
  }else{
   passive.maxHpPct=round((passive.maxHpPct||0)+.06);
   passive.mpEfficiencyPct=round((passive.mpEfficiencyPct||0)+.03);
   passive.shieldPct=round((passive.shieldPct||0)+.06);
   skillMult*=.99;focus+=' · 守望';
  }
 }
 const lines=Object.entries(passive).map(([key,value])=>`${LABELS[key]} ${value>=0?'+':'−'}${Number(Math.abs(value*100).toFixed(2))}%`);
 const tradeoff=`原生技能倍率 ${skillMult>=1?'+':'−'}${Number(Math.abs((skillMult-1)*100).toFixed(2))}%、基礎耗魔 ×${round(costScale)}${targets?'、目標 +'+targets:''}`;
 return {role:focus,passive,skillMult:round(skillMult),costScale:round(costScale),extraTargets:targets,text:`${focus}：${lines.join('、')}；${tradeoff}`};
}
export function specializeNode(base,path,node){
 const spec=specializationFor(base,path);if(!spec)return node;
 const data=base==='archer'?ELF_FUTURE[path]:base==='mage'?MAGE_FUTURE[path]:null;
 const fourth=base==='mage'?MAGE_FOURTH[path]:null;
 const passive={...node.passive,text:`${fourth?renamedPassive(node.passive.text,fourth.passiveName):node.passive.text}；${spec.text}`};
 for(const [key,value]of Object.entries(spec.passive))passive[key]=round((passive[key]||0)+value);
 return {...node,name:fourth?.name||data?.name||`${node.name} · ${spec.role}`,specialization:spec,
  skill:{...node.skill,name:fourth?.skillName||data?.skill.name||`${node.skill.name} · ${spec.role}`,mult:round(node.skill.mult*spec.skillMult),cost:Math.max(1,Math.round(node.skill.cost*spec.costScale)),targets:Math.min(5,node.skill.targets+spec.extraTargets)},passive};
}
