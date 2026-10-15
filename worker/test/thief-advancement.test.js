import test from 'node:test';
import assert from 'node:assert/strict';
import {THIEF_PATHS} from '../src/game/thief-data.js';
import {nodeFor,computeStats,standardSet,idleStats} from '../src/game/stats.js';
import {thiefSpecialization} from '../src/game/thief-advancement.js';
import {combatActor,performThiefNativeStrikes,periodic,specialState} from '../src/game/special.js';
import {applyThiefPrimary,addThiefPoison} from '../src/game/thief-skills.js';
import {idleThiefNative} from '../src/game/special-idle.js';
import {settleIdle} from '../src/game/idle.js';
import {idleCombatState} from '../src/game/idle-combat.js';
import {mkChar,T0} from './helpers.js';
import {freshDb} from './d1-shim.js';
import {loadPlayer} from '../src/db.js';
import * as P from '../src/services/player.js';
import * as Party from '../src/services/party.js';
import {metaView} from '../src/app.js';
const paths=THIEF_PATHS.filter(p=>p.length>=3);
const character=path=>mkChar({base_class:'thief',class_path:path,level:120,auto_blue:0,auto_red_pct:0});
const actor=path=>{const c=character(path),s=computeStats(c,standardSet('thief',120));return {...combatActor(c,s),atk:100,crit:0,thiefAttackCarry:800};};
const foe=()=>({hp:1000000,maxHp:1000000,def:200,buffs:[],dots:[]});

test('24 advanced thief nodes expose the actual specialized skill and cumulative passive in every preview',()=>{
 const meta=metaView();assert.equal(paths.length,24);
 for(const path of paths){
  const n=nodeFor('thief',path),parent=nodeFor('thief',path.slice(0,2)),spec=thiefSpecialization(path);
  assert.ok(spec&&n.specialization);assert.notDeepEqual(n.skill,parent.skill);
  assert.deepEqual(meta.classes.thief.lineageNodes.find(x=>x.path===path).skill,n.skill);
  assert.deepEqual(meta.advancedSpecializations.thief[path].skill,n.skill);
  assert.ok(n.passiveText.includes(spec.role));
  for(const [key,value]of Object.entries(spec.passive))assert.ok(Math.abs(n.passive[key]-(parent.passive[key]||0)-value)<1e-8,path+'/'+key);
 }
});

test('marked pursuit, poison distillation, three-layer burst, armor penetration and weakening produce real distinct native outcomes',()=>{
 const hit=(path,prepare=()=>{})=>{const a=actor(path),enemy=foe();prepare(a,enemy);return {a,enemy,result:performThiefNativeStrikes(a,enemy,T0,{baseRaw:300,rng:()=>.99})};};
 const marked=(a,e)=>e.buffs.push({type:'mark',value:.04,until:T0+60000});
 assert.ok(hit('A121',marked).result.damage>hit('A111',marked).result.damage);
 const poisoned=hit('A211');assert.ok(Math.abs(poisoned.enemy.dots[0].damage-100*.12*1.4*(1+poisoned.a.affixPct.dotPct))<1e-8);
 const layer=(a,e)=>{for(let i=0;i<3;i++)addThiefPoison(a,e,T0);};
 assert.ok(hit('A221',layer).result.damage>hit('A221').result.damage);
 const own=hit('A221',(a,e)=>layer({...a,id:'other'},e));assert.equal(own.result.damage,hit('A221').result.damage,'another player poison cannot trigger personal burst');
 assert.ok(hit('B111').result.damage>hit('B121').result.damage);
 const guarded=hit('B211');assert.equal(guarded.result.statuses[0].value,.18);
 assert.equal(hit('B221').result.statuses[0].value,.1);
 assert.ok(hit('B221').result.damage>guarded.result.damage);
 for(const path of paths){const r=hit(path).result;assert.equal(r.strikes.length,2);assert.equal(r.damage,r.strikes.reduce((sum,x)=>sum+x.damage,0));}
});

test('advanced poison retains per-owner three layers, three finite pulses and refresh clock without repeated rewards',()=>{
 const a=actor('A211'),enemy=foe();enemy.def=0;a.affixPct={};
 for(let i=0;i<8;i++)addThiefPoison(a,enemy,T0+i*100);
 assert.equal(enemy.dots[0].stacks,3);assert.equal(enemy.dots[0].left,3);assert.equal(enemy.dots[0].next,T0+30000);
 const expected=enemy.dots[0].damage*3,before=enemy.hp;periodic([a],enemy,T0+100000,{sustain:false});
 assert.ok(Math.abs(before-enemy.hp-Math.round(expected))<=2);assert.equal(enemy.dots.length,0);
});

test('idle applies the same advanced mark, penetration, poison and weakening from actual stats',()=>{
 const next=path=>{const c=character(path),s=idleStats(c,standardSet('thief',120));idleThiefNative(c,s,T0);return idleThiefNative(c,s,T0+1);};
 assert.ok(next('A121').multiplier>next('A111').multiplier);
 assert.ok(next('B111').multiplier>next('B121').multiplier);
 assert.ok(Math.abs(next('B211').lossMultiplier-.82)<1e-10);assert.equal(next('B221').lossMultiplier,.9);
 for(const path of ['A211','A221']){
  let c=character(path);c.hp=c.mp=1000000;
  const combat=idleCombatState(c);combat.enemies.forEach(e=>{e.hp=e.maxHp=1e9;});c.idle_combat_json=JSON.stringify(combat);
  const gear=standardSet('thief',120),first=settleIdle(c,{},gear,T0+60000),dot=specialState(first.char).idleEnemy.dots[0];
  const s=idleStats(c,gear),power=s.skill.thiefMechanics.poisonPower||1;
  assert.ok(Math.abs(dot.damage-s.atk*.12*power*(1+s.pct.dotPct))<1e-8);
  assert.equal(first.report.combat.sustain.damage,first.report.combat.strikes.reduce((n,x)=>n+x.damage,0));
  const replay=settleIdle(first.char,first.inv,gear,T0+60000);assert.equal(replay.report.ticks,0);assert.deepEqual(replay.char,first.char);
 }
});

test('existing encounter skill snapshots retain legacy mechanics until a new encounter snapshots the advancement',()=>{
 const a=actor('A121'),enemy=foe();delete a.skill.thiefMechanics;
 enemy.buffs.push({type:'mark',value:.04,until:T0+60000});
 const r=performThiefNativeStrikes(a,enemy,T0,{baseRaw:300,rng:()=>.99});
 const parent=actor('A1'),old=foe();old.buffs=[...enemy.buffs];
 assert.equal(r.damage,performThiefNativeStrikes(parent,old,T0,{baseRaw:300,rng:()=>.99}).damage);
});

test('all 24 advancements enter real party snapshots and native actions, with one payment and idempotent repeated view',async()=>{
 for(let offset=0;offset<paths.length;offset+=3){
  const env={DB:freshDb()};try{
   for(let i=0;i<3;i++){const id=String(111+i);await P.createCharacter(env,{tgId:id,name:'夜刃'+id,baseClass:'thief',gender:'f'},T0);await env.DB.prepare('UPDATE rpg_characters SET level=120,class_path=?,hp=2000,mp=1000 WHERE tg_id=?').bind(paths[offset+i],id).run();}
   const id=(await Party.create(env,'111',{kind:'dungeon',dungeonId:'pillar'},T0)).party.id;
   for(const tg of ['112','113'])await Party.action(env,tg,{partyId:id,op:'join',requestId:'join'+tg},T0);
   for(const tg of ['111','112','113'])await Party.action(env,tg,{partyId:id,op:'ready',requestId:'ready'+tg},T0);
   await Party.action(env,'111',{partyId:id,op:'start',requestId:'start'},T0);
   let state=JSON.parse((await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first()).state_json);
   for(const a of state.actors){const p=await loadPlayer(env.DB,a.id),s=computeStats(p.char,p.equipment);assert.deepEqual(a.skill,s.skill);assert.deepEqual(a.affixPct,s.pct);}
   state.enemy.hp=state.enemy.maxHp=1e6;state.enemy.def=200;
   await env.DB.prepare('UPDATE rpg_parties SET state_json=? WHERE id=?').bind(JSON.stringify(state),id).run();
   await Party.view(env,id,'111',T0+5000);
   const saved=(await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first()).state_json;state=JSON.parse(saved);
   for(const a of state.actors){const event=state.lastTurn.events.find(e=>e.actorId===a.id);assert.ok(event.damage>0);assert.equal(event.spentMp,a.skill.cost);assert.equal(event.damage,event.strikes.reduce((n,s)=>n+s.damage,0));}
   await Party.view(env,id,'111',T0+5000);assert.equal((await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first()).state_json,saved);
  }finally{env.DB.sqlite.close();}
 }
});
