import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {THIEF_RELEASE_READY,THIEF_PATHS} from '../src/game/thief-data.js';
import {THIEF_SKILLS,THIEF_SKILL_MAP,nextThiefStrikeCount,thiefPrimaryMechanics,applyThiefPrimary,addThiefPoison} from '../src/game/thief-skills.js';
import {SKILL_MAP,eligible,validateCast,castSpecial,combatActor,performThiefNativeStrikes,periodic,damageEnemy,receiveDamage,valueOf,specialState} from '../src/game/special.js';
import {guardianDamageMultiplier} from '../src/game/guardian-effects.js';
import {computeStats,standardSet,idleStats} from '../src/game/stats.js';
import {performAttack} from '../src/game/boss.js';
import {simulateDuel} from '../src/game/pk.js';
import {settleIdle} from '../src/game/idle.js';
import {idleCombatState} from '../src/game/idle-combat.js';
import {idleThiefNative} from '../src/game/special-idle.js';
import {freshDb} from './d1-shim.js';
import * as Player from '../src/services/player.js';
import * as Party from '../src/services/party.js';
import {mkChar,T0} from './helpers.js';

const character=(path='A2',over={})=>mkChar({base_class:'thief',class_path:path,level:70,map_id:7,auto_blue:0,auto_red_pct:0,...over});
const stats=c=>computeStats(c,standardSet(c.base_class,c.level));
const actor=(path='A2',over={})=>{const c=character(path,over),s=stats(c);return combatActor(c,s,{hp:s.maxHp,mp:s.maxMp});};
const enemy=(over={})=>({hp:1000000,maxHp:1000000,def:0,buffs:[],dots:[],...over});
const books=ids=>({learned:ids,loadout:ids,cooldowns:{},auto:{}});

test('fixed-point 1.8x cadence delivers nine genuine native strikes per five actions with independent criticals and one status application',()=>{
 const a=actor('A2'),foe=enemy(),counts=[],costs=[];a.crit=.2;a.atk=100;a.affixPct={};
 for(let i=0;i<5;i++){
  let index=0;const draws=[.99,0,.99];
  const result=performThiefNativeStrikes(a,foe,T0+i,{cast:true,baseRaw:100,rng:()=>draws[index++%draws.length],actionId:'cadence:'+i});
  counts.push(result.strikes.length);costs.push(result.damage);assert.equal(result.damage,result.strikes.reduce((n,s)=>n+s.damage,0));
  assert.equal(result.attackSpeedMultiplier,1.8);assert.ok((result.statuses||[]).length<=1);
  if(result.strikes.length===2)assert.notEqual(result.strikes[0].crit,result.strikes[1].crit);
 }
 assert.deepEqual(counts,[1,2,2,2,2]);assert.equal(foe.dots[0].stacks,3);assert.equal(costs.reduce((a,b)=>a+b),1100);
 const idle={base:'thief',attackSpeedMultiplier:1.8};assert.deepEqual(Array.from({length:5},()=>nextThiefStrikeCount(idle,3)),[5,5,6,5,6]);assert.equal(idle.thiefAttackCarry,0);
 const clipped=actor('A1'),small=enemy({hp:7});clipped.thiefAttackCarry=800;const last=performThiefNativeStrikes(clipped,small,T0,{cast:true,baseRaw:10000,rng:()=>.99});assert.equal(last.strikes.length,1);assert.equal(last.damage,7);assert.equal(last.strikes[0].afterHp,0);
 const reflected=actor('A1'),shielded=enemy({combatant:true,taken:1,buffs:[{type:'shield',value:10000,until:T0+60000},{type:'reflect',value:100000,until:T0+60000,uses:1}]});reflected.hp=1;reflected.thiefAttackCarry=800;
 const stopped=performThiefNativeStrikes(reflected,shielded,T0,{baseRaw:100,rng:()=>.99});assert.equal(reflected.hp,0);assert.equal(stopped.strikes.length,1,'a lethal reflection stops the remaining cadence strikes');
});

test('release-gated books require explicit catalogue; all branch descendants inherit only their legal books',()=>{
 assert.equal(THIEF_SKILLS.length,6);
 for(const book of THIEF_SKILLS){
  assert.equal(SKILL_MAP[book.id]?.id,THIEF_RELEASE_READY?book.id:undefined);
  for(const path of THIEF_PATHS){const c=character(path,{level:120});assert.equal(eligible(c,book),path.length>=book.advancementTier&&book.eligiblePaths.some(p=>path.startsWith(p)),`${path}/${book.id}`);}
  const c=character(book.eligiblePaths[0],{level:120}),x=books([book.id]);
  if(THIEF_RELEASE_READY)assert.equal(validateCast(c,x,book.id,T0).id,book.id);
  else assert.throws(()=>validateCast(c,x,book.id,T0));
  assert.equal(validateCast(c,x,book.id,T0,{catalog:THIEF_SKILL_MAP}).id,book.id);
  assert.equal(eligible({...c,base_class:'sword'},book),false);
 }
});

test('all six books execute real bounded mechanics with actual mana and cooldowns',()=>{
 for(const book of THIEF_SKILLS){
  const a=actor(book.eligiblePaths[0]),foe=enemy();a.special=books([book.id]);
  const skill=validateCast({base_class:'thief',class_path:a.path,level:120,mp:a.mp},a.special,book.id,T0,{catalog:THIEF_SKILL_MAP});
  const mp=a.mp,r=castSpecial(a,[a],foe,skill,a.id,T0,()=>.99);
  assert.ok(Number.isFinite(r.damage)&&r.damage>=0);assert.equal(a.mp,mp-book.mp);assert.equal(a.special.cooldowns[book.id],T0+book.cooldownSeconds*1000);
  if(book.id==='skill_thief_01')assert.equal(valueOf(foe,'mark',T0),.08);
  if(book.id==='skill_thief_02')assert.equal(valueOf(a,'nextReduce',T0),.25);
  if(book.id==='skill_thief_04')assert.equal(foe.dots[0].stacks,1);
  if(book.id==='skill_thief_06')assert.equal(valueOf(a,'thiefCounter',T0),.2);
 }
});

test('poison is attack-derived, three layers per owner, bounded lifetime, refresh-safe and replay-safe',()=>{
 const a=actor(),b=actor('A2',{tg_id:'second'}),foe=enemy();a.atk=b.atk=100;a.affixPct={};b.affixPct={};
 for(let i=0;i<10;i++)applyThiefPrimary(a,foe,T0+i*100,{damage:50,actionId:'cast:'+i});
 assert.equal(foe.dots.length,1);assert.equal(foe.dots[0].stacks,3);assert.equal(foe.dots[0].damage,36);assert.equal(foe.dots[0].next,T0+30000);
 const state=JSON.stringify(foe.dots);assert.deepEqual(applyThiefPrimary(a,foe,T0+900,{damage:50,actionId:'cast:9'}),[]);assert.equal(JSON.stringify(foe.dots),state);
 addThiefPoison(b,foe,T0+1000);assert.equal(foe.dots.length,2);assert.equal(foe.dots[1].stacks,1);
 const before=foe.hp;periodic([a,b],foe,T0+30000,{sustain:false});assert.equal(before-foe.hp,36); // second owner starts at 31 seconds
 periodic([a,b],foe,T0+100000,{sustain:false});assert.equal(before-foe.hp,3*36+3*12);assert.equal(foe.dots.length,0);
 const huge=enemy({maxHp:1e15,hp:1e15});addThiefPoison(a,huge,T0);assert.equal(huge.dots[0].damage,12);
 const fresh=enemy();assert.equal(fresh.dots.length,0);const dead=enemy({hp:0});assert.equal(addThiefPoison(a,dead,T0),null);
});

test('four primary routes have real mark burst, poison, penetration and one-hit weakening; basics add none',()=>{
 for(const path of ['A1','A2','B1','B2']){
  const a=actor(path),foe=enemy({def:100});const plain=thiefPrimaryMechanics(a,foe,T0);
  if(path==='B1')assert.equal(plain.penetrate,.1);
  assert.deepEqual(applyThiefPrimary(a,foe,T0,{cast:false,damage:10}),[]);
  const statuses=applyThiefPrimary(a,foe,T0,{cast:true,damage:10});
  if(path==='A1'){assert.equal(valueOf(foe,'mark',T0),.04);assert.equal(thiefPrimaryMechanics(a,foe,T0).damageMultiplier,1.1);}
  if(path==='A2')assert.equal(foe.dots.length,1);
  if(path==='B2'){assert.equal(valueOf(foe,'enemyNextReduce',T0),.1);assert.equal(statuses[0].type,'enemyNextReduce');}
 }
 const a=actor();a.base='sword';assert.deepEqual(applyThiefPrimary(a,enemy(),T0,{damage:100}),[]);
});

test('mirror counter waits for actual incoming damage and grants one enhanced attack without dealing extra damage',()=>{
 const a=actor('B2'),foe=enemy(),book=THIEF_SKILL_MAP.skill_thief_06;a.special=books([book.id]);a.hp=a.maxHp;
 const before=foe.hp;castSpecial(a,[a],foe,book,a.id,T0,()=>.99);
 assert.equal(before,foe.hp);assert.equal(valueOf(a,'nextDamage',T0),0);
 a.buffs.push({type:'shield',value:100000,until:T0+60000});assert.equal(receiveDamage(a,100,[a],foe,T0),0);assert.equal(valueOf(a,'nextDamage',T0),0);
 a.buffs=a.buffs.filter(b=>b.type!=='shield');assert.ok(receiveDamage(a,100,[a],foe,T0)>0);assert.equal(valueOf(a,'nextDamage',T0),.2);assert.equal(valueOf(a,'thiefCounter',T0),0);
});

test('every thief route and periodic source uses melee guardian once; ranged/magic cannot override it',()=>{
 for(const path of THIEF_PATHS){
  const a=actor(path);a.guardian={type:'melee',damageBonus:.25};a.damageType='ranged';assert.equal(guardianDamageMultiplier(a),1.25);
  const plain=enemy(),enhanced=enemy();a.atk=100;a.affixPct={};
  const damage=damageEnemy(plain,100,{},T0,{...a,guardian:null});assert.equal(damageEnemy(enhanced,100,{},T0,a),Math.round(damage*1.25));
  a.guardian.type='ranged';assert.equal(guardianDamageMultiplier(a),1);a.guardian.type='magic';assert.equal(guardianDamageMultiplier(a),1);
 }
 const a=actor();a.atk=100;a.affixPct={};a.guardian={type:'melee',damageBonus:.25};const foe=enemy();addThiefPoison(a,foe,T0);periodic([a],foe,T0+30000,{sustain:false});assert.equal(1000000-foe.hp,15);
});

test('group boss native poison persists only within its encounter and respects actual damage caps',()=>{
 const c=character(),s=stats(c),boss={id:'poison-test',map_id:7,hp:1000000,max_hp:1000000};
 const first=performAttack({c,inv:{},stats:s,boss,rng:()=>.99,now:T0});assert.ok(first.actions.some(a=>a.statuses?.some(s=>s.type==='poison')));assert.ok(first.damage<=boss.max_hp*.25);
 const native=first.actions.filter(a=>Array.isArray(a.strikes));assert.deepEqual(native.map(a=>a.strikes.length),[1,2,2,2,2]);assert.equal(native.reduce((sum,a)=>sum+a.spentMp,0),s.skill.cost*5);
 for(const action of native)assert.equal(action.damage,action.strikes.reduce((sum,s)=>sum+s.damage,0));
 const dot=specialState(c).bossCombat.enemy.dots[0];assert.equal(dot.stacks,3);assert.equal(dot.owner,c.tg_id);
 const next=performAttack({c,inv:{},stats:s,boss,rng:()=>.99,now:T0+30000});assert.ok(next.actions.some(a=>a.skillId==='periodic'&&a.damage>0));
 const fresh=performAttack({c,inv:{},stats:s,boss:{...boss,id:'other'},rng:()=>.99,now:T0+60000});assert.ok(fresh.actions.every(a=>a.skillId!=='periodic'));
});

test('real idle and group-boss budgets apply melee guardians once to all four thief routes; summoned idle uses existing double bonus',()=>{
 for(const path of ['A1','A2','B1','B2']){
  const guardian=type=>({id:'fixture-guardian',type,damageBonus:.25,lootBonus:0});
  const idle=(type,summoned=false)=>{
   const c=character(path,{hp:10000,mp:10000,...(type?{guardian:guardian(type)}:{})});
   if(summoned)c.special_json=JSON.stringify({guardianSummonEnabled:true,guardianAssist:{itemId:'fixture-guardian',remainingBattles:2,autoRenew:false}});
   return settleIdle(c,{},standardSet('thief',70),T0+60000);
  };
  const plain=idle(null).report.combat.sustain.damage,melee=idle('melee').report.combat.sustain.damage;
  assert.equal(idle('ranged').report.combat.sustain.damage,plain,path+' ranged idle');assert.equal(idle('magic').report.combat.sustain.damage,plain,path+' magic idle');
  assert.ok(Math.abs(melee-plain*1.25)<=1,path+' melee idle');
  const summoned=idle('melee',true);assert.ok(Math.abs(summoned.report.combat.sustain.damage-plain*1.5)<=1,path+' summoned idle');assert.equal(specialState(summoned.char).guardianAssist.remainingBattles,1);
  const boss=type=>{const c=character(path,{...(type?{guardian:guardian(type)}:{})});return performAttack({c,inv:{},stats:stats(c),boss:{id:'guardian-fixture',map_id:7,hp:1e9,max_hp:1e9},rng:()=>.99,now:T0}).damage;};
  const base=boss(null);assert.equal(boss('ranged'),base,path+' ranged boss');assert.equal(boss('magic'),base,path+' magic boss');assert.ok(Math.abs(boss('melee')-base*1.25)<=10,path+' melee boss');
 }
});

test('idle uses the committed integer damage budget, finite poison, map cleanup and idempotent settlement',()=>{
 let c=character('A2',{hp:10000,mp:10000});const gear=standardSet('thief',70);
 const durableTarget=idleCombatState(c);durableTarget.enemies.forEach(e=>{e.hp=e.maxHp=1000000000;});c.idle_combat_json=JSON.stringify(durableTarget);
 const first=settleIdle(c,{},gear,T0+60000);c=first.char;assert.equal(first.report.ticks,1);assert.ok(first.report.combat.statuses.some(s=>s.type==='poison'));
 const actual=first.report.combat.events.filter(e=>e.type==='hit'&&e.skillName!=='菁英反擊').reduce((n,e)=>n+e.damage,0);assert.equal(actual,first.report.combat.sustain.damage);
 const poison=specialState(c).idleEnemy.dots[0];assert.equal(poison.stacks,1);assert.equal(poison.source.guardian,null,'idle applies the actual PvE multiplier once to its whole committed budget');
 const before=JSON.stringify(c),replay=settleIdle(c,first.inv,gear,T0+60000);assert.equal(replay.report.ticks,0);assert.equal(JSON.stringify(c),before);
 const second=settleIdle(c,first.inv,gear,T0+120000);c=second.char;assert.ok(second.report.combat.sustain.damage>0);assert.ok(specialState(c).idleEnemy.dots[0].stacks<=3);
 c.level=80;c.mp=10000;c=settleIdle(c,first.inv,standardSet('thief',80),T0+180000).char;assert.equal(specialState(c).idleEnemy.dots.length,0,'map transition and killed targets clear native statuses');
 const phantom=character('B2'),s=idleStats(phantom,standardSet('thief',70));assert.equal(idleThiefNative(phantom,s,T0,{cast:true}).lossMultiplier,.9);
});

test('PK native poison/status replay is authoritative and melee guardians remain PvE-only',()=>{
 const c=character('A2'),other=character('B2'),sa=stats(c),sb=stats(other);
 const a=simulateDuel(sa,sb,()=>.99,{a:c,b:other});assert.ok(a.log.some(e=>e.statuses?.some(s=>s.type==='poison')));
 assert.ok(a.log.some(e=>e.periodicDamage>0));for(const event of a.log)assert.equal(event.dmg,event.periodicDamage+event.directDamage);
 for(let i=1;i<a.log.length;i++)assert.deepEqual(a.log[i].before,a.log[i-1].after);
 const guarded=simulateDuel(sa,sb,()=>.99,{a:{...c,guardian:{type:'melee',damageBonus:10}},b:other});assert.deepEqual(guarded,a);
 const durable=simulateDuel({...sa,maxHp:1e9},{...sb,maxHp:1e9},()=>.99,{a:c,b:other});
 for(const id of ['a','b'])assert.deepEqual(durable.log.filter(e=>e.by===id).slice(0,5).map(e=>e.strikes.length),[1,2,2,2,2]);
 for(const event of durable.log)assert.equal(event.directDamage,event.strikes.reduce((sum,s)=>sum+s.damage,0));
});

test('real party advance applies native poison once per authoritative turn and repeated view does not mutate it',async()=>{
 const env={DB:freshDb()};for(const tgId of ['111','222','333']){await Player.createCharacter(env,{tgId,name:tgId,gender:'m',baseClass:'sword'},T0);await env.DB.prepare("UPDATE rpg_characters SET level=70,class_path='B1',hp=1000,mp=1000 WHERE tg_id=?").bind(tgId).run();}
 const {party}=await Party.create(env,'111',{kind:'dungeon',dungeonId:'pillar'},T0),id=party.id;
 for(const tg of ['222','333'])await Party.action(env,tg,{partyId:id,op:'join',requestId:'join'+tg},T0);
 for(const tg of ['111','222','333'])await Party.action(env,tg,{partyId:id,op:'ready',requestId:'ready'+tg},T0);
 await Party.action(env,'111',{partyId:id,op:'start',requestId:'start'},T0);
 // Explicit fixture bypasses only actor snapshot, not production character/schema release gates.
 let row=await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first(),state=JSON.parse(row.state_json);
 state.actors=state.actors.map((old,i)=>({...actor('A2',{tg_id:old.id}),id:old.id,atk:100,mp:1000,maxMp:1000,guardian:{type:i===0?'melee':'ranged',damageBonus:.25}}));state.enemy.hp=state.enemy.maxHp=1000000;
 await env.DB.prepare('UPDATE rpg_parties SET state_json=? WHERE id=?').bind(JSON.stringify(state),id).run();
 const random=crypto.getRandomValues;try{crypto.getRandomValues=array=>{array.fill(0xffffffff);return array;};await Party.view(env,id,'111',T0+5000);}finally{crypto.getRandomValues=random;}
 row=await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first();state=JSON.parse(row.state_json);
 assert.equal(state.enemy.dots.length,3);assert.ok(state.enemy.dots.every(d=>d.stacks===1));assert.equal(state.lastTurn.events.filter(e=>e.statuses?.[0]?.type==='poison').length,3);
 const own=state.lastTurn.events.filter(e=>e.actorId&&e.actorId!=='boss');assert.equal(own[1].damage,own[2].damage);assert.ok(Math.abs(own[0].damage-own[1].damage*1.25)<=1,'actual party melee bonus applies once, ranged guardian does not apply');
 const before=row.state_json;await Party.view(env,id,'111',T0+5000);assert.equal((await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first()).state_json,before);
 try{crypto.getRandomValues=array=>{array.fill(0xffffffff);return array;};await Party.view(env,id,'111',T0+10000);}finally{crypto.getRandomValues=random;}
 state=JSON.parse((await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first()).state_json);
 const second=state.lastTurn.events.filter(e=>e.actorId&&e.actorId!=='boss');assert.ok(second.every(e=>e.strikes.length===2&&e.spentMp===18));assert.ok(state.enemy.dots.every(d=>d.stacks===2),'two strikes apply native poison only once per action');
 for(const event of second)assert.equal(event.damage,event.strikes.reduce((sum,s)=>sum+s.damage,0));
});

test('idle records 27 real strikes over five minutes, one mana payment per native action, exact integer damage conservation and replay stability',()=>{
 let c=character('A2',{hp:1000000,mp:1000000}),inv={},counts=[];const gear=standardSet('thief',70),durableTarget=idleCombatState(c);
 durableTarget.enemies.forEach(e=>{e.hp=e.maxHp=1000000000;});c.idle_combat_json=JSON.stringify(durableTarget);
 for(let minute=1;minute<=5;minute++){
  const out=settleIdle(c,inv,gear,T0+minute*60000);c=out.char;inv=out.inv;const round=out.report.combat;
  counts.push(round.strikes.length);assert.equal(round.attackSpeedMultiplier,1.8);assert.equal(round.damage,round.strikes.reduce((sum,s)=>sum+s.damage,0));assert.equal(round.damage,round.sustain.damage);
  for(const strike of round.strikes)assert.equal(strike.damage,strike.hits.reduce((sum,h)=>sum+h.damage,0));
  assert.equal(round.events.filter(e=>e.type==='hit'&&e.skillName!=='菁英反擊').reduce((sum,e)=>sum+e.damage,0),round.damage);
  const before=JSON.stringify(c),replay=settleIdle(c,inv,gear,T0+minute*60000);assert.equal(replay.report.ticks,0);assert.equal(JSON.stringify(c),before);
 }
 assert.deepEqual(counts,[5,5,6,5,6]);assert.equal(JSON.parse(c.idle_combat_json).thiefAttackCarry,0);
});

test('Canvas weapon FX draw all routes and six book shapes, contain no combat mutation, and restore drawing state',()=>{
 const sandbox={window:{}};vm.runInNewContext(readFileSync(new URL('../public/thief-fx.js',import.meta.url),'utf8'),sandbox);
 const api=sandbox.window.RpgThiefFX;let saves=0,restores=0;
 const context=new Proxy({save(){saves++},restore(){restores++}},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
 for(const path of ['','A','B','A1','A2','B1','B2'])for(const basic of [true,false])for(const phase of [0,.2,.4,.5,.75,1])api.draw(context,phase,{x:60,y:80},{x:260,y:90},api.profile('',path,{basic}));
 for(const book of THIEF_SKILLS)for(const phase of [0,.3,.5,.8,1])api.draw(context,phase,{x:60,y:80},{x:260,y:90},api.profile(book.name,book.eligiblePaths[0]));
 assert.equal(saves,restores);assert.equal(api.profile('','A2',{basic:true}).kind,'dagger');assert.equal(api.profile('','A2').kind,'poison');assert.equal(api.profile('','B1').kind,'flying');
});

test('the production FX wrapper chain dispatches thief geometry without downloading mage or cinematic atlases',()=>{
 const requested=[];class Image{constructor(){this.complete=false;this.naturalWidth=0;}set src(src){requested.push(src);}}
 const sandbox={window:{addEventListener(){}},Image,URL,location:{href:'http://fixture.test/'},document:{currentScript:null,readyState:'complete',addEventListener(){}},Promise};
 vm.createContext(sandbox);
 for(const script of ['thief-fx.js','skill-fx.js','elf-adv2-skill-fx.js','cinematic-fx.js','hero-lavish-fx.js','branch-elf4-fx.js','sword-adv4-fx.js','hero-art-registry-fx.js','sword-branch-fx.js','elf-low-tier-weapon-fx.js'])vm.runInContext(readFileSync(new URL('../public/'+script,import.meta.url),'utf8'),sandbox,{filename:script});
 let draws=0;const draw=sandbox.window.RpgThiefFX.draw;sandbox.window.RpgThiefFX.draw=(...args)=>{draws++;return draw(...args);};
 const g=new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
 for(const path of THIEF_PATHS)for(const basic of [true,false]){
  const p={...sandbox.window.RpgSkillFX.profile(basic?'':'盜賊原生技能','thief',path),basic};
  assert.equal(p.thief,true);sandbox.window.RpgSkillFX.draw(g,.4,{x:30,y:50},{x:200,y:60},p);
 }
 assert.equal(draws,THIEF_PATHS.length*2);assert.deepEqual(requested,[]);
});
