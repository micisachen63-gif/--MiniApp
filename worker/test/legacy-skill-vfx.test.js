import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gatherLegacyCases,canonical,paths,buildNative,buildSpecial} from './legacy-skill-vfx-fixture.js';
import {nativeSkillIdentity,validSkillVfxIdentity} from '../src/game/skill-vfx-events.js';
import {SKILL_MAP,castSpecial,periodic,receiveDamage} from '../src/game/special.js';
import {performAttack} from '../src/game/boss.js';
import {simulateDuel} from '../src/game/pk.js';
import {settleIdle} from '../src/game/idle.js';
import * as Ring from '../src/game/star-ring.js';
import {T0} from './helpers.js';
const all=gatherLegacyCases({observed:true}),hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const cast=(f,id='cast')=>castSpecial(f.actor,[f.actor,f.ally],f.enemy,f.skill,f.ally.id,T0,()=>.5,{}, {eventId:id,source:'committed-combat',enemyId:f.enemy.id,atMs:T0});
test('432 pre-change complete legacy outcomes stay equal after excluding presentation-only fields',()=>{
 const baseline=JSON.parse(readFileSync(new URL('./fixtures/legacy-skill-vfx-baseline-20261104.json',import.meta.url),'utf8'));
 assert.equal(all.length,432);for(const row of all)assert.equal(hash(row.value),baseline.cases.find(x=>x.id===row.id&&x.mode===row.mode)?.sha256,row.mode+' '+row.id);
});
test('all 124 native identities resolve in idle and boss, and every one emits in a balanced duel',()=>{
 let count=0;
 for(const base of ['sword','archer','mage','thief'])for(const path of paths){
  const id='native:'+base+':'+(path||'base'),f=buildNative(base,path);
  assert.equal(nativeSkillIdentity(f.char),id);assert.equal(validSkillVfxIdentity(id),true);
  for(const mode of ['idle','boss']){const r=all.find(r=>r.id===id&&r.mode===mode),events=mode==='idle'?r.value.report.combat.vfxEvents:r.value.result.actions.map(a=>a.vfx);assert(events.some(v=>v?.skillId===id),mode+' '+id);}
  const duel=simulateDuel(f.stats,f.stats,()=>.01,{a:f.char,b:{...f.char,tg_id:'opponent'}},{id:'balanced-'+id,at:T0});
  const event=duel.log.find(e=>e.by==='a'&&e.vfx)?.vfx;assert.equal(event?.skillId,id);assert.equal(event.atMs,T0);assert.equal(event.targetKind,'enemy');assert.deepEqual(event.targetIds,['b']);count++;
 }
 assert.equal(count,124);assert.equal(nativeSkillIdentity({base:'sword',path:'C123'}),null);assert.equal(validSkillVfxIdentity('special:missing'),false);
});
test('all 60 special identities describe real resolved target roles, including 24 zero-direct-damage actions',()=>{
 const rows=all.filter(r=>r.mode==='resolver');assert.equal(rows.length,60);let direct=0,support=0;
 for(const {id,value}of rows){const {result,actor,ally}=value,v=result.vfx;assert.equal(v.skillId,id);assert.equal(v.kind,'cast');assert.equal(v.atMs,T0);assert(v.targetIds.length,id);assert(v.targetIds.every(x=>[actor.id,ally.id,'enemy'].includes(x)));
  if(result.damage>0){direct++;assert.equal(v.presentationMode,'full');assert.deepEqual(v.targetIds,['enemy']);assert.equal(v.targetKind,'enemy');}
  else{support++;assert.notEqual(v.targetKind,'enemy');assert.deepEqual(v.enemyTargetIds,[]);assert(v.targetIds.every(x=>x!=='enemy'));assert(['support','summon'].includes(v.presentationMode));}
 }
 assert.equal(direct,36);assert.equal(support,24);
 const heal=rows.find(r=>r.id==='special:skill_04_2').value;assert.deepEqual(heal.result.vfx.targetIds,[heal.ally.id]);
 const revive=rows.find(r=>r.id==='special:skill_24_2').value;assert.deepEqual(revive.result.vfx.targetIds,[revive.ally.id]);assert.equal(revive.result.revived,true);
 const acceleration=rows.find(r=>r.id==='special:skill_17_2').value;assert.deepEqual(acceleration.result.vfx.targetIds,[acceleration.ally.id]);
});
test('hybrid attacks retain the enemy as primary and only list their true healing recipients separately',()=>{
 const f=buildSpecial(SKILL_MAP.skill_09_1);f.actor.hp=f.actor.maxHp;f.ally.hp=1;
 const result=cast(f);assert(result.damage>0);assert.deepEqual(result.vfx.targetIds,['enemy']);assert.deepEqual(result.vfx.allyTargetIds,[f.ally.id]);assert.deepEqual(result.vfx.recipientEffects,[{kind:'heal',targetIds:[f.ally.id]}]);
});
test('summon placement does no immediate hit; scheduled pulses preserve exact source identity and deduplicate naturally',()=>{
 const f=buildSpecial(SKILL_MAP.skill_18_1),before=f.enemy.hp,result=cast(f,'summon-cast');
 assert.equal(result.damage,0);assert.equal(f.enemy.hp,before);assert.equal(result.vfx.presentationMode,'summon');assert.deepEqual(result.vfx.targetIds,[f.actor.id]);
 const visual=periodic([f.actor],f.enemy,T0+60000,{vfx:{eventId:'pulse',source:'committed-combat',enemyId:'enemy'}});
 assert.equal(visual.length,2);assert(visual.every(v=>v.kind==='effect'&&v.effectKind==='pet'&&v.skillId==='special:skill_18_1'&&v.presentationMode==='impact'));
 assert.equal(new Set(visual.map(v=>v.eventId)).size,2);assert(f.enemy.hp<before);
 assert.deepEqual(periodic([f.actor],f.enemy,T0+60000,{vfx:{eventId:'pulse',enemyId:'enemy'}}),[]);
 const legacy=buildSpecial(SKILL_MAP.skill_18_1);castSpecial(legacy.actor,[legacy.actor],legacy.enemy,legacy.skill,legacy.actor.id,T0);
 assert.deepEqual(periodic([legacy.actor],legacy.enemy,T0+30000,{vfx:{eventId:'legacy',enemyId:'enemy'}}),[],'old effects without an observed source are never guessed from names or class');
});
test('DOT refresh and native poison origin remain separate from the summon and from new casts',()=>{
 const f=buildSpecial(SKILL_MAP.skill_05_1);cast(f,'dot-cast');const before=f.enemy.hp;
 const events=periodic([f.actor],f.enemy,T0+30000,{vfx:{eventId:'dot-pulse',enemyId:'enemy'}});
 assert.equal(events.length,1);assert.equal(events[0].skillId,'special:skill_05_1');assert.equal(events[0].effectKind,'dot');assert(f.enemy.hp<before);
 const thief=buildSpecial(SKILL_MAP.skill_thief_04);cast(thief,'poison-special');assert.equal(thief.enemy.dots.find(d=>d.kind==='thiefPoison').vfxOrigin.skillId,'special:skill_thief_04');
});
test('shield reflection is emitted only for actual damage, while thief counter remains a next-action buff',()=>{
 const f=buildSpecial(SKILL_MAP.skill_02_3);cast(f,'reflect-cast');
 const observation={eventId:'enemy-turn',source:'committed-combat',enemyId:'enemy',effects:[]},before=f.enemy.hp;
 receiveDamage(f.actor,100,[f.actor],f.enemy,T0+1,{vfx:observation,defApplied:true});
 assert.equal(observation.effects.length,1);assert.equal(observation.effects[0].skillId,'special:skill_02_3');assert.equal(observation.effects[0].effectKind,'reflect');assert(f.enemy.hp<before);
 receiveDamage(f.actor,100,[f.actor],f.enemy,T0+2,{vfx:observation,defApplied:true});assert.equal(observation.effects.length,1);
 const thief=buildSpecial(SKILL_MAP.skill_thief_06),result=cast(thief),health=thief.enemy.hp,effects={eventId:'thief-counter',enemyId:'enemy',effects:[]};
 assert.equal(result.vfx.presentationMode,'support');receiveDamage(thief.actor,100,[thief.actor],thief.enemy,T0+1,{vfx:effects,defApplied:true});
 assert.equal(thief.enemy.hp,health);assert.deepEqual(effects.effects,[]);assert(thief.actor.buffs.some(b=>b.type==='nextDamage'));
});
test('idle exposes one aggregate-minute cast, links it once, and never labels ordinary or elite hits as another skill cast',()=>{
 for(const row of all.filter(r=>r.mode==='idle')){const round=row.value.report.combat,v=round.vfxEvents[0];assert.equal(round.vfxEvents.length,1);assert.equal(v.damageModel,'aggregate-minute');assert.equal(round.events.filter(e=>e.vfxEventId===v.eventId).length,1,row.id);assert(round.before.some(e=>e.id===v.targetIds[0]));assert(round.events.filter(e=>e.vfxEventId).every(e=>e.type==='hit'&&e.strike!=='elite'&&e.strike!==3));}
 const f=buildNative('mage','B2');f.char.mp=0;f.char.auto_blue=0;
 const noMana=performAttack({c:f.char,inv:{},stats:f.stats,boss:{id:'no-mana',started_at:T0,map_id:7,max_hp:10000000,hp:10000000},rng:()=>.5,now:T0});
 assert(noMana.actions.every(a=>!a.vfx),'a basic attack is not relabeled native because the class has an authored skill');
 const support=buildSpecial(SKILL_MAP.skill_02_3);support.char.hp=support.stats.maxHp;
 const idle=settleIdle(support.char,{red_1:10000,blue_1:10000},support.equipment,T0+60000),round=idle.report.combat;
 assert.equal(round.vfxEvents[0].presentationMode,'support');assert.equal(round.events.some(e=>e.vfxEventId),false,'aggregate damage is not presented as damage from a shield cast');
});
test('star-ring projection and committed checkpoint remain distinct sources with identical combat and stable events',()=>{
 const players=[buildNative('sword','A1'),buildNative('mage','B2'),buildNative('archer','A1'),buildNative('thief','A2')];
 const actors=players.map((p,i)=>Ring.snapshot({char:{...p.char,tg_id:String(i+1)},equipment:p.equipment}));
 const state={id:'ring-vfx-source',engineVersion:3,seed:'vfx-source',tier:70,difficulty:'normal',tactic:'balanced',startedAt:T0,actors,results:[],departed:{},optionalGuard:true};
 const projected=Ring.simulateStage(state,0,4,{vfxSource:'deterministic-projection'}),committed=Ring.simulateStage(state,0,4,{vfxSource:'committed-combat'});
 assert.deepEqual(canonical(projected),canonical(committed));const a=projected.events.flatMap(e=>[e.vfx,...(e.vfxEvents||[])].filter(Boolean)),b=committed.events.flatMap(e=>[e.vfx,...(e.vfxEvents||[])].filter(Boolean));
 assert(a.length);assert(a.every(v=>v.source==='deterministic-projection'));assert(b.every(v=>v.source==='committed-combat'));assert.deepEqual(a.map(v=>v.eventId),b.map(v=>v.eventId));assert.deepEqual(Ring.simulateStage(state,0,4,{vfxSource:'deterministic-projection'}),projected);
});
