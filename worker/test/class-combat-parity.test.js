import test from 'node:test';
import assert from 'node:assert/strict';
import {computeStats,standardSet,idleStats} from '../src/game/stats.js';
import {combatActor,receiveDamage,damageEnemy,castSpecial,validateCast,SKILL_MAP,eligible,baseOf,specialState} from '../src/game/special.js';
import {specialCost,restoreOnAction} from '../src/game/combat-passives.js';
import {simulateDuel} from '../src/game/pk.js';
import {performAttack} from '../src/game/boss.js';
import {settleIdle} from '../src/game/idle.js';
import {freshDb} from './d1-shim.js';
import {loadPlayer} from '../src/db.js';
import * as Player from '../src/services/player.js';
import * as Party from '../src/services/party.js';
import * as PK from '../src/services/pk.js';
import * as Special from '../src/services/special.js';
import {mkChar,T0} from './helpers.js';

const char=(cls='sword',path='B2',over={})=>mkChar({base_class:cls,class_path:path,level:70,hp:500,mp:500,...over});
const stats=c=>computeStats(c,standardSet(c.base_class,c.level));
const actor=c=>combatActor(c,stats(c));
const enemy=()=>({hp:100000,maxHp:100000,def:0,buffs:[],windup:true,interruptible:true});
const skillState=ids=>JSON.stringify({learned:ids,loadout:ids,auto:Object.fromEntries(ids.map(id=>[id,'ready']))});

test('every route uses its derived class mitigation exactly once, including actors from an older party snapshot',()=>{
 for(const base of ['sword','archer','mage'])for(const path of ['A','B','A1','A2','B1','B2']){
  const c=char(base,path),s=stats(c),a=actor({...c,hp:s.maxHp}),raw=1000;
  const expected=Math.min(a.hp,Math.round(raw*s.taken*100/(100+s.def)));
  assert.equal(receiveDamage(a,raw,[a],enemy(),T0),expected,`${base}/${path}`);
  const legacy=actor({...c,hp:s.maxHp});delete legacy.taken;
  assert.equal(receiveDamage(legacy,raw,[legacy],enemy(),T0),expected);
 }
});

test('guard transfer conserves already-mitigated damage instead of applying another defense and class multiplier',()=>{
 const target={id:'a',hp:1000,maxHp:1000,def:100,taken:.8,buffs:[]};
 const guard={id:'b',hp:1000,maxHp:1000,def:999,taken:.2,buffs:[],guard:{target:'a',pct:.5,until:T0+1000}};
 receiveDamage(target,1000,[target,guard],enemy(),T0);
 assert.equal(1000-target.hp,200);assert.equal(1000-guard.hp,200);
});

test('specials honor branch mana discounts, affix efficiency and haste in validation and UI',async()=>{
 const c=char('archer','B2'),s=stats(c),x=specialState({...c,special_json:skillState(['skill_14_1'])});
 const pct={...s.pct,mpEfficiencyPct:.2,skillHastePct:.25};
 const skill=validateCast({...c,affixPct:pct},x,'skill_14_1',T0);
 assert.equal(skill.mp,Math.round(SKILL_MAP.skill_14_1.mp*.85*.8));
 assert.equal(skill.cooldownSeconds,Math.round(SKILL_MAP.skill_14_1.cooldownSeconds*.75));
 const {mastery,...base}=skill;assert.equal(mastery.level,1);assert.equal(mastery.outputPct,0);assert.deepEqual(base,specialCost(SKILL_MAP.skill_14_1,pct));
});

test('special free casts keep mana, start cooldowns and trigger actual native cast healing',()=>{
 const a=actor(char('sword','B1',{special_json:skillState(['skill_02_1'])}));
 a.affixPct.freeCastPct=1;a.affixPct.healPerCastPct=.01;
 const before=a.hp,mp=a.mp,foe=enemy(),s=validateCast({base_class:a.base,class_path:a.path,level:a.level,mp:a.mp,affixPct:a.affixPct},a.special,'skill_02_1',T0);
 const result=castSpecial(a,[a],foe,s,a.id,T0,()=>0);
 assert.equal(a.mp,mp);assert.equal(result.spentMp,0);assert.equal(a.hp-before,Math.round(a.maxHp*.01));
 assert.equal(a.special.cooldowns[s.id],T0+s.cooldownSeconds*1000);
 assert.throws(()=>validateCast({base_class:a.base,class_path:a.path,level:a.level,mp:a.mp},a.special,s.id,T0));
});

test('all 54 existing skills execute with finite actual results, legal costs and bounded HP',()=>{
 for(const skill of Object.values(SKILL_MAP)){
  const base=baseOf(skill),path=['A111','A211','B111','B211'].find(class_path=>eligible({base_class:base,class_path,level:120},skill));
  const a=actor(char(base,path,{level:120,special_json:skillState([skill.id])})),b=actor(char(base,path,{level:120,tg_id:'ally'})),foe=enemy();
  if(skill.id==='skill_24_2')b.hp=0;
  if(skill.id==='skill_17_2')b.special.cooldowns.skill_02_1=T0+90000;
  const s=validateCast({base_class:base,class_path:path,level:120,mp:a.mp,affixPct:a.affixPct},a.special,skill.id,T0);
  const result=castSpecial(a,[a,b],foe,s,b.id,T0,()=>.5,{});
  assert.ok(Number.isFinite(result.damage)&&result.damage>=0,skill.id);
  for(const m of [a,b])assert.ok(Number.isFinite(m.hp)&&m.hp>=0&&m.hp<=m.maxHp,skill.id);
  assert.ok(a.mp>=0&&a.mp<=a.maxMp);assert.ok(a.special.cooldowns[skill.id]>T0);
 }
});

test('lifesteal uses clipped real damage and never heals above maximum health',()=>{
 const a=actor(char('sword','A1')),foe={...enemy(),hp:7};
 a.affixPct.lifestealPct=.2;const dealt=damageEnemy(foe,100000,{},T0,a),before=a.hp;
 restoreOnAction(a,dealt);assert.equal(dealt,7);assert.equal(a.hp-before,1);
 a.hp=a.maxHp-1;restoreOnAction(a,100000);assert.equal(a.hp,a.maxHp);
 a.hp=0;restoreOnAction(a,100000,{cast:true});assert.equal(a.hp,0,'reflection cannot be undone by passive self-resurrection');
});

test('PK applies guaranteed free native casts while preserving immutable authoritative replay snapshots',()=>{
 const c=char('mage','B1'),a=stats(c),b=stats(char('sword','B2'));
 const original=JSON.stringify(a),s={...a,pct:{...a.pct,freeCastPct:1}};
 const sim=simulateDuel(s,b,()=>.5);assert.equal(sim.log[0].by,'b');
 const own=sim.log.filter(x=>x.by==='a');assert.ok(own.length);assert.ok(own.every(x=>x.after.mp.a===s.maxMp));
 assert.equal(JSON.stringify(a),original);
 for(let i=1;i<sim.log.length;i++)assert.deepEqual(sim.log[i].before,sim.log[i-1].after);
});

test('PK executes learned equipped skills, shields and DOTs, and ignores unavailable/unlearned skills',()=>{
 const a=char('mage','A1',{special_json:skillState(['skill_15_1'])}),b=char('sword','B1',{special_json:skillState(['skill_02_3'])});
 const sim=simulateDuel(stats(a),stats(b),()=>.6,{a,b});
 assert.ok(sim.log.some(x=>x.skillId==='skill_15_1'));assert.ok(sim.log.some(x=>x.skillId==='skill_02_3'));
 assert.ok(sim.log.filter(x=>x.skillId==='skill_15_1').every(x=>x.spentMp===SKILL_MAP.skill_15_1.mp));
 const bad={...a,class_path:'B1'};assert.ok(simulateDuel(stats(bad),stats(b),()=>.6,{a:bad,b}).log.every(x=>x.skillId!=='skill_15_1'));
 const without={...a,special_json:JSON.stringify({loadout:['skill_15_1']})};assert.ok(simulateDuel(stats(without),stats(b),()=>.6,{a:without,b}).log.every(x=>x.skillId!=='skill_15_1'));
});

test('PK shields absorb attacks, penetration changes defense, and shield-breaking is effective',()=>{
 const c=char(),a=actor(c);a.hp=a.maxHp;a.combatant=true;a.taken=1;a.def=0;
 const hit=(bonus=0)=>{a.hp=a.maxHp;a.buffs=[{type:'shield',value:60,until:T0+60000}];return damageEnemy(a,100,{shieldBonus:bonus},T0);};
 assert.equal(hit(),40);assert.equal(hit(1),70);
 a.buffs=[];a.def=100;const plain=damageEnemy(a,100,{},T0);a.hp=a.maxHp;
 assert.ok(damageEnemy(a,100,{penetrate:.3},T0)>plain);
});

test('group boss uses equipped interrupt, persists cooldown and reports damage within cap',()=>{
 const c=char('sword','B1',{special_json:skillState(['skill_02_1'])}),s=stats(c),boss={id:'test-boss',map_id:7,element:'earth',hp:1000000,max_hp:1000000};
 const out=performAttack({c,inv:{},stats:s,boss,rng:()=>.5,now:T0});
 assert.ok(out.actions.some(a=>a.skillId==='skill_02_1'));assert.equal(out.counter,0);assert.equal(out.interrupted,true);
 assert.ok(out.damage<=boss.max_hp*.25);assert.ok(JSON.parse(c.special_json).cooldowns.skill_02_1>T0);
 const next=performAttack({c,inv:{},stats:s,boss,rng:()=>.5,now:T0+1000});assert.ok(next.actions.every(a=>a.skillId!=='skill_02_1'));
});

test('group boss summon pulses persist across requests and never migrate to another boss',()=>{
 const c=char('mage','B2',{special_json:skillState(['skill_18_1'])}),s=stats(c),boss={id:'a',map_id:7,hp:1000000,max_hp:1000000};
 performAttack({c,inv:{},stats:s,boss,rng:()=>.5,now:T0});
 assert.equal(JSON.parse(c.special_json).bossCombat.summon.left,3);
 const x=JSON.parse(c.special_json);x.loadout=[];c.special_json=JSON.stringify(x);
 performAttack({c,inv:{},stats:s,boss,rng:()=>.5,now:T0+60000});
 assert.equal(JSON.parse(c.special_json).bossCombat.summon.left,1);
 performAttack({c,inv:{},stats:s,boss:{...boss,id:'b'},rng:()=>.5,now:T0+90000});
 assert.equal(JSON.parse(c.special_json).bossCombat.summon,undefined);
});

test('idle native and special sustain is based on committed integer damage without a duplicate reduction approximation',()=>{
 for(const [base,path] of [['sword','A1'],['sword','B1']]){
  const c=char(base,path,{hp:100,auto_red_pct:0}),eq=standardSet(base,70);
  const r=settleIdle(c,{},eq,T0+60000),combat=r.report.combat;
  const actual=combat.events.filter(e=>e.type==='hit'&&e.strike!==3).reduce((n,e)=>n+e.damage,0);
  assert.equal(combat.sustain.damage,actual);
  const s=idleStats(c,eq),wanted=Math.round(actual*s.pct.lifestealPct+(combat.sustain.cast?s.maxHp*s.pct.healPerCastPct:0));
  assert.equal(combat.sustain.healed,Math.min(s.maxHp-100,wanted));
 }
});

test('idle auto specials use free cast and keep the same learned/equipped and budget requirements',()=>{
 const c=char('mage','B1',{hp:5000,mp:500,special_json:skillState(['skill_06_1'])}),eq=standardSet('mage',70);
 // Fixture uses a valid mana-free affix, rather than changing production probabilities.
 eq[0].bonus_json=JSON.stringify({freeCastPct:1});
 const r=settleIdle(c,{},eq,T0+60000),x=JSON.parse(r.char.special_json);
 assert.ok(x.cooldowns.skill_06_1>T0);assert.equal(r.char.mp,Math.round(Math.min(stats(c).maxMp,500+idleStats(c,eq).mpRegen)));
 assert.equal(r.report.used.blue_1||0,0);
});

async function fixture(){const env={DB:freshDb()};for(const id of ['111','222','333']){await Player.createCharacter(env,{tgId:id,name:'測試'+id,gender:'m',baseClass:'sword'},T0);await env.DB.prepare("UPDATE rpg_characters SET level=70,class_path='B1',hp=1000,mp=1000 WHERE tg_id=?").bind(id).run();}return env;}
let sequence=0;const request=()=>`class-parity-${++sequence}`;
test('real party snapshot and turn persist native skills, class mitigation, special mana and cooldowns atomically',async()=>{
 const env=await fixture();await env.DB.prepare('UPDATE rpg_characters SET special_json=? WHERE tg_id=?').bind(skillState(['skill_02_1']),'111').run();
 const {party}=await Party.create(env,'111',{kind:'dungeon',dungeonId:'pillar'},T0),id=party.id;
 for(const tg of ['222','333'])await Party.action(env,tg,{partyId:id,op:'join',requestId:request()},T0);
 for(const tg of ['111','222','333'])await Party.action(env,tg,{partyId:id,op:'ready',requestId:request()},T0);
 await Party.action(env,'111',{partyId:id,op:'start',requestId:request()},T0);
 const row=await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first(),before=JSON.parse(row.state_json);
 assert.ok(before.actors.every(a=>Number.isFinite(a.taken)&&a.skill?.mult>1));
 await Party.view(env,id,'111',T0+5000);
 const after=JSON.parse((await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first()).state_json);
 assert.ok(after.actors[0].special.cooldowns.skill_02_1>T0);
 assert.ok(after.actors[1].mp<before.actors[1].mp,'native attack now casts its own class skill and pays mana');
});

test('PK service snapshots actual character skill loadouts, not only derived stats',async()=>{
 const env=await fixture();await env.DB.prepare('UPDATE rpg_characters SET special_json=? WHERE tg_id=?').bind(skillState(['skill_02_1']),'111').run();
 const p=await PK.challenge(env,{tgId:'111',target:{tgId:'222'}},T0),done=await PK.accept(env,{tgId:'222',pkId:p.id},T0,1);
 assert.ok(done.log.steps.some(s=>s.skillId==='skill_02_1'));
 const player=await loadPlayer(env.DB,'111');assert.equal(JSON.parse(player.char.special_json).cooldowns?.skill_02_1,undefined,'PK cooldowns remain encounter-local');
});
