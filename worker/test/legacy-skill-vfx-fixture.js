import {computeStats,standardSet} from '../src/game/stats.js';
import {settleIdle} from '../src/game/idle.js';
import {performAttack} from '../src/game/boss.js';
import {simulateDuel} from '../src/game/pk.js';
import {combatActor,castSpecial,validateCast,SKILL_MAP,eligible,baseOf} from '../src/game/special.js';
import {rngFor} from '../src/game/rng.js';
import {mkChar,T0} from './helpers.js';
export const paths=[''];for(let depth=1;depth<=4;depth++)for(const parent of paths.filter(p=>p.length===depth-1))for(const leaf of depth===1?['A','B']:['1','2'])paths.push(parent+leaf);
export function canonical(value){
 if(typeof value==='string'&&/^[{[]/.test(value)){try{return canonical(JSON.parse(value));}catch{}}
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>!['vfx','vfxEvents','vfxEventId','vfxOrigin'].includes(k)).map(k=>[k,canonical(value[k])]));
 return value;
}
export function buildNative(base,path){
 const level=Math.min(120,Math.max(15,path.length*30+5)),char=mkChar({tg_id:'vfx-'+base+'-'+(path||'base'),name:'VFX fixture',base_class:base,class_path:path,level,hp:1,mp:1,auto_red_pct:50,auto_blue:1}),equipment=standardSet(base,level);
 const stats=computeStats(char,equipment);char.hp=stats.maxHp;char.mp=stats.maxMp;return {char,equipment,stats};
}
export function buildSpecial(skill){
 const base=baseOf(skill),path=paths.find(class_path=>eligible({base_class:base,class_path,level:120},skill));
 if(path==null)throw Error('No legal route '+skill.id);
 const built=buildNative(base,path);built.char.level=120;built.equipment=standardSet(base,120);
 built.char.special_json=JSON.stringify({learned:[skill.id],loadout:[skill.id],auto:{[skill.id]:'ready'},cooldowns:{}});
 built.stats=computeStats(built.char,built.equipment);built.char.hp=Math.ceil(built.stats.maxHp*.5);built.char.mp=built.stats.maxMp;
 const actor=combatActor(built.char,built.stats),ally=combatActor({...built.char,tg_id:'ally'},built.stats),enemy={id:'enemy',hp:10000000,maxHp:10000000,def:80,level:120,buffs:[],dots:[],shield:500,windup:true,interruptible:true};
 if(skill.id==='skill_24_2')ally.hp=0;if(skill.id==='skill_17_2')ally.special.cooldowns.skill_02_1=T0+90000;
 const resolved=validateCast({base_class:base,class_path:path,level:120,mp:actor.mp,affixPct:actor.affixPct},actor.special,skill.id,T0);
 return {...built,actor,ally,enemy,skill:resolved};
}
export function gatherLegacyCases({observed=false}={}){
 const cases=[];
 for(const base of ['sword','archer','mage','thief'])for(const path of paths){
  const id='native:'+base+':'+(path||'base'),fixture=buildNative(base,path),{char,equipment,stats}=fixture,opponent=buildNative('sword','B2');
  const idle=settleIdle({...char},{red_1:100000,blue_1:100000},equipment,T0+60000);
  const bossChar=structuredClone(char),bossInv={red_1:100000,blue_1:100000},boss={id:'vfx-boss',started_at:T0,map_id:Math.min(12,Math.max(1,Math.ceil(char.level/10))),hp:10000000,max_hp:10000000,element:'earth'};
  const attack=performAttack({c:bossChar,inv:bossInv,stats,boss,rng:rngFor(id+':boss'),now:T0+60000});
  const duel=simulateDuel(stats,opponent.stats,rngFor(id+':duel'),{a:char,b:opponent.char},{id:'vfx-duel-'+id,at:T0});
  cases.push({id,mode:'idle',value:idle},{id,mode:'boss',value:{result:attack,char:bossChar,inv:bossInv}},{id,mode:'pk',value:duel});
 }
 for(const skill of Object.values(SKILL_MAP)){
  const f=buildSpecial(skill),context={},observation=observed?{eventId:'coverage:'+skill.id,source:'committed-combat',enemyId:'enemy'}:null;
  const result=castSpecial(f.actor,[f.actor,f.ally],f.enemy,f.skill,f.ally.id,T0,rngFor(skill.id),context,observation);
  cases.push({id:'special:'+skill.id,mode:'resolver',value:{result,actor:f.actor,ally:f.ally,enemy:f.enemy,context}});
 }
 return cases;
}
