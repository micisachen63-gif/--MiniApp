import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {freshDb} from './d1-shim.js';
import {loadPlayer} from '../src/db.js';
import {computeStats} from '../src/game/stats.js';
import {paths,buildNative,buildSpecial} from './legacy-skill-vfx-fixture.js';
import {SKILL_MAP} from '../src/game/special.js';
import * as Player from '../src/services/player.js';
import * as Party from '../src/services/party.js';
import * as PK from '../src/services/pk.js';
import {T0} from './helpers.js';
const cases=[],checks=[];
const sourcePaths=['worker/src/game/skill-vfx-events.js','worker/src/game/special.js','worker/src/game/special-idle.js','worker/src/game/idle.js','worker/src/game/idle-combat.js','worker/src/game/boss.js','worker/src/game/pk.js','worker/src/game/star-ring.js','worker/src/services/party.js','worker/src/services/pk.js','worker/src/services/star-ring.js'];
async function create(env,id,base='sword'){await Player.createCharacter(env,{tgId:id,name:'特效'+id,gender:'m',baseClass:base},T0);}
async function configure(env,id,base,path,level,at){
 await env.DB.prepare("UPDATE rpg_characters SET base_class=?,class_path=?,level=?,exp=0,hp=999999,mp=999999,idle_state='fighting',state_until=NULL,last_settle_at=?,idle_combat_json=NULL,special_json='{}',party_id=NULL,rev=rev+1 WHERE tg_id=?").bind(base,path,level,at,id).run();
 const player=await loadPlayer(env.DB,id),stats=computeStats(player.char,player.equipment.filter(e=>e.is_equipped));
 await env.DB.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').bind(stats.maxHp,stats.maxMp,id).run();
 await env.DB.prepare("UPDATE rpg_inventory SET quantity=100000 WHERE tg_id=? AND item IN('red_1','blue_1')").bind(id).run();
}
function record(id,mode,events,snapshot,extra={}){cases.push({id,mode,evidenceKind:'sqlite-committed-service-fixture',status:'passed',events,snapshot,...extra});}
test('all 124 native identities are published only with the successful SQLite idle settlement and remain stable on a repeated read',async t=>{
 const env={DB:freshDb()};t.after(()=>env.DB.sqlite.close());
 const classes=['sword','archer','mage','thief'];for(let i=0;i<classes.length;i++)await create(env,String(81001+i),classes[i]);
 let serial=0;
 for(const base of classes)for(const path of paths){
  const id=String(81001+classes.indexOf(base)),canonical='native:'+base+':'+(path||'base'),level=Math.min(120,Math.max(15,path.length*30+5));let accepted=null,attempts=0,at;
  while(!accepted&&attempts++<4){at=T0+(++serial)*120000;await configure(env,id,base,path,level,at);const out=await Player.withPlayer(env,id,at+60000);
   if(out.report.combat?.vfxEvents?.some(v=>v.skillId===canonical))accepted=out;
   else assert.equal(out.report.deaths,1,'the fixture may legitimately die before a successful combat round');
  }
  assert(accepted,canonical);const row=await loadPlayer(env.DB,id),stored=JSON.parse(row.char.idle_combat_json).round;
  assert.deepEqual(stored.vfxEvents,accepted.report.combat.vfxEvents);assert.equal(row.char.hp,accepted.player.char.hp);assert.equal(row.char.mp,accepted.player.char.mp);
  const before=JSON.stringify(row.char),again=await Player.withPlayer(env,id,at+60000);assert.equal(again.report.ticks,0);assert.equal(again.report.combat,undefined);assert.equal(JSON.stringify((await loadPlayer(env.DB,id)).char),before);
  record(canonical,'idle',stored.vfxEvents,stored,{attempts,committedRevision:row.char.rev,characterId:id});
 }
 assert.equal(cases.filter(c=>c.mode==='idle').length,124);
});
async function partyFixture(t){
 const env={DB:freshDb()};t.after(()=>env.DB.sqlite.close());
 for(const id of ['111','222','333']){await create(env,id);await configure(env,id,'sword','B111',120,T0);}
 const {party:{id}}=await Party.create(env,'111',{kind:'dungeon',dungeonId:'pillar'},T0);
 for(const who of ['222','333'])await Party.action(env,who,{partyId:id,op:'join'},T0);
 for(const who of ['111','222','333'])await Party.action(env,who,{partyId:id,op:'ready'},T0);
 await Party.action(env,'111',{partyId:id,op:'start'},T0);
 const row=await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first();return {env,id,base:JSON.parse(row.state_json)};
}
function castState(base,skill,index){
 const f=buildSpecial(skill),at=T0+(index+1)*5000,state=structuredClone(base);
 const first={...f.actor,id:'111',name:'施放者'},second={...f.ally,id:'222',name:'目標',special:{learned:[],loadout:[],auto:{},cooldowns:{}}},third={...structuredClone(f.ally),id:'333',name:'隊友',special:{learned:[],loadout:[],auto:{},cooldowns:{}}};
 if(skill.id==='skill_24_2')second.hp=0;
 if(skill.id==='skill_17_2')second.special.cooldowns.skill_02_1=at+90000;
 state.actors=[first,second,third];state.round=index+1;state.turnSequence=index;state.deadline=at;state.roundStarted=at-5000;state.challengeEndsAt=T0+10000000;state.actions={'111':{skillId:skill.id,targetId:'222',manual:true}};
 state.enemy={...f.enemy,id:'boss',name:'服務驗收目標',hp:100000000,maxHp:100000000,shield:0,attack:1};state.recentTurns=[];delete state.lastTurn;delete state.cooperation;delete state.roleRules;delete state.dungeonBalanceVersion;delete state.dungeonBalance;delete state.endedAt;
 return {state,at};
}
async function savePartyFixture(env,id,state){
 await env.DB.prepare("UPDATE rpg_parties SET status='combat',state_json=?,rev=rev+1 WHERE id=?").bind(JSON.stringify(state),id).run();
 for(const a of state.actors)await env.DB.prepare('UPDATE rpg_characters SET base_class=?,class_path=?,level=?,hp=?,mp=?,party_id=? WHERE tg_id=?').bind(a.base,a.path,a.level,Math.max(1,a.hp),a.mp,id,a.id).run();
}
test('all 60 special identities survive real party atomic commits with correct enemy, ally, heal, revive and summon targets',async t=>{
 const {env,id,base}=await partyFixture(t);let index=0;
 for(const skill of Object.values(SKILL_MAP)){
  const {state,at}=castState(base,skill,index++);await savePartyFixture(env,id,state);
  const out=await Party.view(env,id,'111',at),event=out.battleTurn.events.find(e=>e.actorId==='111'&&e.skillId===skill.id);
  assert(event?.vfx,skill.id);assert.equal(event.vfx.skillId,'special:'+skill.id);assert.equal(event.vfx.source,'committed-combat');
  const row=await env.DB.prepare('SELECT rev,state_json FROM rpg_parties WHERE id=?').bind(id).first(),stored=JSON.parse(row.state_json),same=stored.lastTurn.events.find(e=>e.actorId==='111'&&e.skillId===skill.id);
  assert.deepEqual(same.vfx,event.vfx);const player=await loadPlayer(env.DB,'111');assert.equal(player.char.mp,stored.actors[0].mp);
  const repeat=await Party.view(env,id,'111',at,out.battleTurn.id);assert.equal(repeat.battleTurns.length,0);assert.equal((await env.DB.prepare('SELECT rev FROM rpg_parties WHERE id=?').bind(id).first()).rev,row.rev);
  record('special:'+skill.id,'party',[event.vfx],out.battleTurn,{committedRevision:row.rev,partyId:id});
 }
 assert.equal(cases.filter(c=>c.mode==='party').length,60);
});
test('a late SQLite batch failure rolls back idle combat metadata, HP/MP and rewards; retry publishes only the committed round',async t=>{
 const env={DB:freshDb()};t.after(()=>env.DB.sqlite.close());await create(env,'82111','mage');await configure(env,'82111','mage','A111',120,T0);
 const before=await loadPlayer(env.DB,'82111'),batch=env.DB.batch.bind(env.DB);
 let injected=false;env.DB.batch=stmts=>{if(stmts.some(s=>s.sql.startsWith('UPDATE rpg_characters SET '))){injected=true;return batch([...stmts,env.DB.prepare('SELECT * FROM missing_vfx_atomic_guard')]);}return batch(stmts);};
 await assert.rejects(Player.withPlayer(env,'82111',T0+60000),/missing_vfx_atomic_guard/);assert(injected,'failure was injected into the write transaction');
 assert.deepEqual(await loadPlayer(env.DB,'82111'),before);
 env.DB.batch=batch;const result=await Player.withPlayer(env,'82111',T0+60000);assert.equal(result.report.combat.vfxEvents[0].skillId,'native:mage:A111');
 checks.push({name:'idle-late-batch-rollback-and-retry',status:'passed'});
});
test('party CAS retry and lost success response preserve one stable receipt, and a late SQL failure publishes no new turn',async t=>{
 const {env,id,base}=await partyFixture(t),{state,at}=castState(base,SKILL_MAP.skill_02_3,0);
 await savePartyFixture(env,id,state);const before=(await env.DB.prepare('SELECT * FROM rpg_parties WHERE id=?').bind(id).first()),batch=env.DB.batch.bind(env.DB);
 let failedWrite=false;env.DB.batch=stmts=>{if(stmts.some(s=>s.sql.startsWith('UPDATE rpg_parties SET status='))){failedWrite=true;return batch([...stmts,env.DB.prepare('SELECT * FROM missing_party_vfx_atomic_guard')]);}return batch(stmts);};
 await assert.rejects(Party.view(env,id,'111',at),/missing_party_vfx_atomic_guard/);assert(failedWrite);assert.deepEqual(await env.DB.prepare('SELECT * FROM rpg_parties WHERE id=?').bind(id).first(),before);
 let conflicted=false;env.DB.batch=async stmts=>{if(!conflicted&&stmts.some(s=>s.sql.startsWith('UPDATE rpg_parties SET status='))){conflicted=true;await env.DB.prepare('UPDATE rpg_parties SET rev=rev+1 WHERE id=?').bind(id).run();}return batch(stmts);};
 const result=await Party.view(env,id,'111',at);assert(conflicted);const v=result.battleTurn.events.find(e=>e.actorId==='111'&&e.vfx).vfx;
 env.DB.batch=batch;const repeated=await Party.view(env,id,'111',at);assert.deepEqual(repeated.battleTurn.events.find(e=>e.actorId==='111'&&e.vfx).vfx,v);
 const noNew=await Party.view(env,id,'111',at,result.battleTurn.id);assert.equal(noNew.battleTurns.length,0);
 const lost=castState(base,SKILL_MAP.skill_02_1,1);await savePartyFixture(env,id,lost.state);let committedThenLost=false;
 env.DB.batch=async stmts=>{const out=await batch(stmts);if(stmts.some(s=>s.sql.startsWith('UPDATE rpg_parties SET status='))){committedThenLost=true;throw new Error('simulated-response-lost');}return out;};
 await assert.rejects(Party.view(env,id,'111',lost.at),/simulated-response-lost/);assert(committedThenLost);env.DB.batch=batch;
 const saved=JSON.parse((await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first()).state_json),recovered=await Party.view(env,id,'111',lost.at);
 assert.deepEqual(recovered.battleTurn,saved.lastTurn);assert.equal((await Party.view(env,id,'111',lost.at,recovered.battleTurn.id)).battleTurns.length,0);
 checks.push({name:'party-late-rollback-cas-retry-lost-response',status:'passed'});
});
test('PK service commits canonical replay identities under the real duel id and preserves replay on repeated read',async t=>{
 const env={DB:freshDb()};t.after(()=>env.DB.sqlite.close());
 for(const id of ['83111','83222']){await create(env,id);await configure(env,id,'sword','B111',120,T0);}
 await env.DB.prepare('UPDATE rpg_characters SET special_json=? WHERE tg_id=?').bind(JSON.stringify({learned:['skill_02_1'],loadout:['skill_02_1'],auto:{skill_02_1:'ready'}}),'83111').run();
 const pending=await PK.challenge(env,{tgId:'83111',target:{tgId:'83222'}},T0),result=await PK.accept(env,{tgId:'83222',pkId:pending.id},T0,1);
 const v=result.log.steps.flatMap(s=>[s.vfx,...(s.vfxEvents||[])].filter(Boolean));assert(v.some(x=>x.skillId==='special:skill_02_1'));assert(v.every(x=>x.eventId.startsWith('pk:'+pending.id+':')));
 const row=await env.DB.prepare('SELECT log_json FROM rpg_pk WHERE id=?').bind(pending.id).first();assert.deepEqual(JSON.parse(row.log_json),result.log);
 checks.push({name:'pk-real-id-committed-replay',status:'passed'});
});
after(()=>{
 if(!process.env.LEGACY_VFX_QA_RECEIPT)return;
 const hash=path=>crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
 const receipt={schemaVersion:1,status:'recorded-pending-test-exit',generatedAt:new Date().toISOString(),sourceFiles:sourcePaths.map(path=>({path,sha256:hash(path)})),summary:{canonicalIdentities:new Set(cases.map(c=>c.id)).size,cases:cases.length,checks:checks.length},checks,cases};
 fs.writeFileSync(process.env.LEGACY_VFX_QA_RECEIPT,JSON.stringify(receipt,null,2)+'\n');
});
