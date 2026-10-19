import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import * as P from '../src/services/player.js';
import * as R from '../src/services/star-ring.js';
import * as E from '../src/game/star-ring.js';
import {loadPlayer} from '../src/db.js';
import {computeStats} from '../src/game/stats.js';
import {settleIdle} from '../src/game/idle.js';
import {taipeiDay} from '../src/game/time.js';
import {selectAccountCharacter} from '../src/accounts.js';
import * as ShortParty from '../src/services/party.js';
import {makeEliteGear} from '../src/game/gear.js';
import {rngFor} from '../src/game/rng.js';
const T=Date.parse('2026-10-18T08:00:00Z');
const specs=['sword:B2','mage:A1','thief:A1','archer:B1','sword:A1'];
async function fixture(t,{classes=specs,tier=90,difficulty='normal',start=true,at=T,engineVersion=1}={}){
 const env={DB:freshDb()},db=env.DB.sqlite;t.after(()=>db.close());const ids=classes.map((_,i)=>String(1000+i));
 for(let i=0;i<ids.length;i++){
  const[baseClass,path]=classes[i].split(':');await P.createCharacter(env,{tgId:ids[i],name:'遠征旅人'+i,baseClass,gender:'f'},at);
  db.prepare('UPDATE rpg_characters SET level=?,class_path=?,last_settle_at=? WHERE tg_id=?').run(tier,path,at,ids[i]);
  const st=computeStats((await loadPlayer(env.DB,ids[i])).char,[]);db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(st.maxHp,st.maxMp,ids[i]);
 }
 const created=await R.create(env,ids[0],{tier,difficulty},at),id=created.party.id;
 // Historical suites deliberately replay a pre-update lobby. New pool suites
 // below pass v2 and exercise the unmodified current creation version.
 if(engineVersion===1){const old=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);old.engineVersion=1;db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(old),id);}
 for(const tg of ids.slice(1))await R.action(env,tg,{partyId:id,action:'join'},at);
 for(const tg of ids)await R.action(env,tg,{partyId:id,action:'ready'},at);
 if(start)await R.action(env,ids[0],{partyId:id,action:'start'},at);
 return {env,db,id,ids,at};
}

test('new expeditions use v2 pools; a defeated species projects the exact next authored species while settlement remains server-only',async t=>{
 const{env,db,id,ids}=await fixture(t,{engineVersion:2});
 const s=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);assert.equal(s.engineVersion,2);
 s.actors=s.actors.map(a=>({...a,atk:1e7,departureAtk:1e7}));db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(s),id);
 const first=await R.view(env,id,ids[0],T+E.BEAT_MS),raw=E.simulateStage(s,0,1),next=E.nextWaveEnemy(s,raw);
 assert.equal(raw.enemy.hp,0);assert.notEqual(next.id,raw.enemy.id);assert.equal(first.battle.enemy.id,next.id);assert.equal(first.battle.enemy.hp,next.maxHp);assert.equal(first.battle.spawn.previousId,raw.enemy.id);assert.equal(first.battle.enemy.rank,'normal');assert.equal(first.battle.sightings[0].id,raw.enemy.id);
 const previous=JSON.stringify(first.battle);assert.equal(JSON.stringify((await R.view(env,id,ids[0],T+E.BEAT_MS)).battle),previous);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_rewards').get().n,0);
 const secondRaw=E.simulateStage(s,0,2);assert.equal(secondRaw.enemy.id,next.id);
 const completed=await R.view(env,id,ids[0],T+E.DURATION);assert.equal(completed.completedStages,6);assert.equal(completed.battle.spawn,null);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_rewards').get().n,30);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_starts').get().n,5);assert.equal(db.prepare("SELECT count(*) n FROM rpg_outbox WHERE kind='star_ring_complete'").get().n,5);
 const all=completed.stages.flatMap(x=>x.result.encounters).flatMap(x=>x.enemies);assert.equal(new Set(all.filter(x=>x.rank==='boss').map(x=>x.id)).size,12);
 await R.sweep(env,T+E.DURATION+60000);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_rewards').get().n,30);
});

test('v2 offline and hourly online projections preserve exact combat histories and six checkpoint grants',async t=>{
 const{env,db,id,ids}=await fixture(t,{engineVersion:2,tier:40,classes:['sword:A','mage:A','thief:A','archer:B','sword:B']});
 const offline=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);
 for(let stage=0;stage<6;stage++){
  for(const beat of [0,37,119,120,177,239]){const p=await R.view(env,id,ids[0],T+stage*E.STAGE_MS+beat*E.BEAT_MS),b=E.simulateStage(offline,stage,beat);assert.deepEqual(p.battle.sightings,b.sightings);assert.deepEqual(p.battle.events,b.events);assert.equal(p.battle.enemy.id,b.enemy.hp===0?E.nextWaveEnemy(offline,b).id:b.enemy.id);}
  offline.results.push(E.simulateStage(offline,stage));offline.stageTactics[stage+1]=offline.tactic;
 }
 await R.view(env,id,ids[0],T+E.DURATION);const committed=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);assert.deepEqual(committed.results,JSON.parse(JSON.stringify(offline.results)));assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_rewards').get().n,30);
});
test('five accounts depart once per character Taipei date; lobby does not consume quota',async t=>{
 const{env,db,id,ids}=await fixture(t,{start:false});assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_starts').get().n,0);
 assert.equal((await R.me(env,ids[0],T)).daily.used,false);
 await R.action(env,ids[0],{partyId:id,action:'start'},T);
 assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_starts').get().n,5);
 assert.equal((await R.me(env,ids[0],T)).daily.used,true);
 assert.equal((await R.view(env,id,ids[0],T)).endsAt,T+E.DURATION);
 assert.equal(db.prepare('SELECT party_id FROM rpg_characters WHERE tg_id=?').get(ids[0]).party_id,id);
 await assert.rejects(R.action(env,ids[1],{partyId:id,action:'start'},T),e=>e.code==='leader');
});
test('membership and leader authority checked; forbidden payload cannot provide power/rewards/clock',async t=>{
 const{env,id,ids}=await fixture(t);
 await assert.rejects(R.action(env,'outsider',{partyId:id,action:'leave'},T),e=>e.code==='member');
 await assert.rejects(R.action(env,ids[1],{partyId:id,action:'tactic',tactic:'deep'},T),e=>e.code==='leader');
 const p=await R.view(env,id,ids[0],T+60000);assert.equal(p.completedStages,0);assert.equal(p.me.rewards.exp,0);
 await assert.rejects(R.action(env,ids[0],{partyId:id,action:'claim',exp:1e30,now:T+E.DURATION},T),e=>e.code==='action');
});
test('server projection deterministic; same beats become checkpoint state and rewards only at boundary',async t=>{
 const{env,db,id,ids}=await fixture(t),state=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);
 const a=await R.view(env,id,ids[0],T+60000),b=await R.view(env,id,ids[0],T+60000);assert.deepEqual(a.battle,b.battle);assert.equal(a.battle.sequence,2);assert.equal(a.me.rewards.exp,0);
 const full=E.simulateStage(state,0),v=await R.view(env,id,ids[0],T+E.STAGE_MS);
 assert.equal(v.completedStages,1);assert.equal(v.me.rewards.exp,Math.round(state.actors[0].baselineExpPerMinute*60*full.expHours));
 const committed=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json).results[0];assert.deepEqual(committed,JSON.parse(JSON.stringify(full)));
});

test('a defeated active wave presents the next enemy without changing the v1 simulation, RNG or rewards',async t=>{
 const{env,db,id,ids}=await fixture(t),saved=db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json,state=JSON.parse(saved);
 let beat=1,result;for(;beat<40;beat++){result=E.simulateStage(state,0,beat);if(result.enemy.hp===0)break;}
 assert.ok(beat<40,'fixture defeats a wave');const p=await R.view(env,id,ids[0],T+beat*E.BEAT_MS);
 assert.equal(p.battle.spawn.wave,result.waves+1);assert.equal(p.battle.spawn.previousHp,0);
 assert.equal(p.battle.enemy.hp,result.enemy.maxHp);assert.equal(p.battle.waves,result.waves);
 assert.deepEqual(p.battle.events,result.events);assert.equal(p.me.rewards.exp,0);
 const again=await R.view(env,id,ids[0],T+beat*E.BEAT_MS+100);assert.deepEqual(again.battle.spawn,p.battle.spawn);
 assert.equal(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json,saved);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM rpg_star_ring_rewards').get().n,0);
});
test('offline twelve-hour catchup grants six stages once and canonical private completion once',async t=>{
 const{env,db,id,ids}=await fixture(t);const p=await R.view(env,id,ids[0],T+E.DURATION+1);assert.equal(p.status,'complete');assert.equal(p.completedStages,6);
 assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_rewards').get().n,30);
 assert.equal(db.prepare("SELECT count(*) n FROM rpg_outbox WHERE kind='star_ring_complete' AND target='dm'").get().n,5);
 assert.equal(db.prepare('SELECT count(*) n FROM rpg_party_presence').get().n,0);
 for(const tg of ids){const c=db.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get(tg);assert.equal(c.party_id,null);assert.equal(c.last_settle_at,T+E.DURATION);}
 assert.ok(p.me.rewards.items.star_ring_token>=10&&p.me.rewards.items.star_ring_token<=12);assert.ok(p.me.rewards.equipment.length>=1);
 const before=db.prepare('SELECT sum(quantity) n FROM rpg_inventory').get().n;
 await R.view(env,id,ids[0],T+E.DURATION+1);await R.sweep(env,T+E.DURATION+2);
 assert.equal(db.prepare('SELECT sum(quantity) n FROM rpg_inventory').get().n,before);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_rewards').get().n,30);
 assert.equal(p.me.rewards.equipment[0].class_req==='any'||p.me.rewards.equipment[0].class_req==='sword',true);
 const notification=JSON.parse(db.prepare("SELECT payload_json FROM rpg_outbox WHERE kind='star_ring_complete' AND tg_id=?").get(ids[0]).payload_json);assert.equal(notification.recipientCharId,ids[0]);assert.equal(notification.rewards.exp,p.me.rewards.exp);
});
test('parallel catchup cannot duplicate ledger, equipment, inventory or completion DM',async t=>{
 const{env,db,id,ids}=await fixture(t);const results=await Promise.allSettled([R.view(env,id,ids[0],T+E.DURATION),R.view(env,id,ids[1],T+E.DURATION)]);assert.ok(results.some(x=>x.status==='fulfilled'));
 assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_rewards').get().n,30);assert.equal(db.prepare("SELECT count(*) n FROM rpg_ledger WHERE event_id LIKE 'star-ring:%'").get().n,30);
 assert.equal(db.prepare("SELECT count(*) n FROM rpg_outbox WHERE kind='star_ring_complete'").get().n,5);
});
test('leave keeps completed stages only, no refund, survivors continue and leader transfers',async t=>{
 const{env,db,id,ids}=await fixture(t);await R.action(env,ids[0],{partyId:id,action:'leave',requestId:'leave-once'},T+E.STAGE_MS+10);
 const left=await R.view(env,id,ids[0],T+E.STAGE_MS+10);assert.equal(left.me.left,true);assert.equal(left.completedStages,1);assert.equal(left.leaderId,ids[1]);assert.ok(left.me.rewards.exp>0);
 assert.equal(db.prepare('SELECT party_id FROM rpg_characters WHERE tg_id=?').get(ids[0]).party_id,null);
 const completed=await R.view(env,id,ids[0],T+E.DURATION);assert.equal(completed.status,'complete');assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_rewards WHERE char_id=?').get(ids[0]).n,1);
 assert.equal((await R.me(env,ids[0],T+E.STAGE_MS+10)).daily.used,true);
 await R.action(env,ids[0],{partyId:id,action:'leave',requestId:'leave-once'},T+E.DURATION); // replay succeeds even after terminal state
});
test('idle disabled while running; completion resumes only from true end time; EXP preserves advancement gate',async t=>{
 const{env,db,id,ids}=await fixture(t),p=await loadPlayer(env.DB,ids[0]);
 const settled=settleIdle(p.char,p.inv,p.equipment,T+3600000);assert.equal(settled.report.exp_gained,0);
 await R.view(env,id,ids[0],T+E.DURATION+3600000);const c=db.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get(ids[0]);assert.equal(c.level,90);assert.equal(c.class_path,'B2');assert.equal(c.last_settle_at,T+E.DURATION);
});
test('advanced eligibility enforces four distinct simultaneous duties and all existing classes',async t=>{
 const{env,id,ids}=await fixture(t,{difficulty:'advanced',start:false,classes:Array(5).fill('thief:A1')});
 await assert.rejects(R.action(env,ids[0],{partyId:id,action:'start'},T),e=>e.code==='party_roles');
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM rpg_star_ring_starts').get().n,0);
 assert.equal(E.coverage([{id:'x',base:'mage',path:'A2',level:90}]).assignment.guard==='x'&&Object.keys(E.coverage([{id:'x',base:'mage',path:'A2',level:90}]).assignment).length===1,true);
 const good=await fixture(t,{difficulty:'advanced'});assert.equal((await R.view(good.env,good.id,good.ids[0],T)).roleCoverage.missing.length,0);
});
test('lobby expiry releases presence; cancellation never charges daily quota',async t=>{
 const{env,db,id,ids}=await fixture(t,{start:false});await R.sweep(env,T+1800000);assert.equal((await R.view(env,id,ids[0],T+1800000)).status,'ended');assert.equal(db.prepare('SELECT count(*) n FROM rpg_party_presence').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_starts').get().n,0);
});
test('Taipei quota uses start date; cross-midnight run still blocks second run and next day becomes eligible only when free',async t=>{
 const at=Date.parse('2026-10-18T15:30:00Z'),{env,db,id,ids}=await fixture(t,{at});assert.equal(taipeiDay(at),'2026-10-18');assert.equal((await R.me(env,ids[0],at+3600000)).daily.used,false);
 await assert.rejects(R.create(env,ids[0],{},at+3600000),e=>e.code==='party');
 await R.view(env,id,ids[0],at+E.DURATION);assert.equal((await R.me(env,ids[0],at+E.DURATION)).daily.used,false);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_starts').get().n,5);
});
test('immutable snapshot survives changed live equipment/skills; own EXP baseline independent of teammate',async t=>{
 const{env,db,id,ids}=await fixture(t);const before=await R.view(env,id,ids[0],T+60000);
 db.prepare("UPDATE rpg_characters SET class_path='A111',special_json='{}' WHERE tg_id=?").run(ids[0]);
 const after=await R.view(env,id,ids[0],T+60000);assert.deepEqual(after.battle,before.battle);
 const s=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);const baseline=s.actors[0].baselineExpPerMinute;s.actors[1].atk*=100;
 assert.equal(E.stageReward(s,s.actors[0],0,{grade:'S',expHours:4}).exp,baseline*240);
});
test('shop is bound currency debit and request-id replay safe including concurrent purchases',async t=>{
 const{env,db,ids}=await fixture(t);db.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'star_ring_token',20)").run(ids[0]);
 const body={offerId:'weapon',requestId:'buy-one'};await Promise.allSettled([R.shop(env,ids[0],body,T),R.shop(env,ids[0],body,T)]);
 assert.equal(db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='star_ring_token'").get(ids[0]).quantity,15);
 const before=db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='scroll_w'").get(ids[0]).quantity;await R.shop(env,ids[0],body,T);assert.equal(db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='scroll_w'").get(ids[0]).quantity,before);
 await assert.rejects(R.shop(env,ids[0],{offerId:'armor',requestId:'buy-one'},T),e=>e.code==='request');
 await assert.rejects(R.shop(env,ids[0],{offerId:'blessedWeapon',requestId:'too-expensive'},T),e=>e.code==='currency');
});
test('low level/unpromoted characters cannot enter',async t=>{
 const env={DB:freshDb()};t.after(()=>env.DB.sqlite.close());await P.createCharacter(env,{tgId:'9',name:'新人旅人',baseClass:'thief',gender:'m'},T);
 await assert.rejects(R.create(env,'9',{},T),e=>e.code==='level');env.DB.sqlite.prepare("UPDATE rpg_characters SET level=120,class_path='A' WHERE tg_id='9'").run();await assert.rejects(R.create(env,'9',{},T),e=>e.code==='level');
});
test('all nine ten-level tiers require actual character level at create and join',async t=>{
 assert.deepEqual(E.TIERS.map(x=>x.level),[40,50,60,70,80,90,100,110,120]);
 for(const tier of E.TIERS){
  const f=await fixture(t,{tier:tier.level,start:false});assert.equal((await R.view(f.env,f.id,f.ids[0],T)).level,tier.level);
  f.db.prepare('UPDATE rpg_characters SET level=? WHERE tg_id=?').run(tier.level-1,f.ids[0]);
  await assert.rejects(R.action(f.env,f.ids[0],{partyId:f.id,action:'start'},T),e=>e.code==='level');
  await P.createCharacter(f.env,{tgId:'9999',name:'下一階旅人',baseClass:'mage',gender:'f'},T);
  f.db.prepare("UPDATE rpg_characters SET level=?,class_path='A1' WHERE tg_id='9999'").run(tier.level-1);
  // New room avoids full-room check masking strict admission.
  await R.action(f.env,f.ids[4],{partyId:f.id,action:'leave'},T);
  await assert.rejects(R.action(f.env,'9999',{partyId:f.id,action:'join'},T),e=>e.code==='level');
  await assert.rejects(R.create(f.env,'9999',{tier:tier.level},T),e=>e.code==='level');
 }
});
test('Lv50 foundation roles work at their true level without unlocking high-level skills',async t=>{
 const{env,db,id,ids}=await fixture(t,{tier:50,classes:['sword:A','mage:A','thief:A','archer:A','sword:B'],difficulty:'advanced'});
 const s=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json),b=E.simulateStage(s,0,1);
 assert.ok(b.events.some(x=>x.skillId==='role_guard'));assert.ok(b.actors.every(a=>a.level===50));assert.ok(b.actors.every(a=>a.path.length===1));
 const out=await R.view(env,id,ids[0],T+E.DURATION);assert.equal(out.status,'complete');assert.ok(out.me.rewards.equipment.every(e=>e.tier===5));
 const mage={...s.actors[1],hp:10,mp:s.actors[1].maxMp},enemy={hp:10000,maxHp:10000,def:1,buffs:[],dots:[],windup:true,interruptible:true};
 const team={actors:[mage],enemy,round:1,cooperation:{}};const heal=E.castExpeditionRole(mage,team,'aid',T);assert.ok(heal.healed>0);assert.equal(mage.level,50);
 await assert.rejects(async()=>E.castExpeditionRole(mage,team,'breach',T),e=>e.code==='role');
});
test('continuous waves still have real events after hour one and all six enemies are new',async t=>{
 const{env,db,id,ids}=await fixture(t),s=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);
 const a=E.simulateStage(s,0,180),b=E.simulateStage(s,0,181);assert.ok(a.waves>0);assert.ok(b.events.length>0);assert.notEqual(a.sequence,b.sequence);
 assert.ok(E.STAGES.every(x=>x.enemyId.startsWith('star_ring_')));assert.equal(new Set(E.STAGES.map(x=>x.enemyId)).size,6);
 const view=await R.view(env,id,ids[0],T+90*60000);assert.equal(view.battle.waves,a.waves);assert.deepEqual(view.battle.events,a.events);
});
test('queued tactic is not retroactive and persists per-stage when catching up offline',async t=>{
 const{env,db,id,ids}=await fixture(t);const before=await R.view(env,id,ids[0],T+3600000);
 await R.action(env,ids[0],{partyId:id,action:'tactic',tactic:'deep'},T+3600000);
 const after=await R.view(env,id,ids[0],T+3600000);assert.deepEqual(after.battle,before.battle);assert.equal(after.nextTactic,'deep');
 await R.view(env,id,ids[0],T+E.STAGE_MS*3);
 const s=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);assert.deepEqual(s.stageTactics.slice(0,3),['balanced','deep','deep']);
 assert.deepEqual(s.results[0],JSON.parse(JSON.stringify(E.simulateStage(s,0))));assert.deepEqual(s.results[1],JSON.parse(JSON.stringify(E.simulateStage(s,1))));
});
test('create request replay returns the same room, rejects changed config and survives response races',async t=>{
 const env={DB:freshDb()};t.after(()=>env.DB.sqlite.close());await P.createCharacter(env,{tgId:'888',name:'重試旅人',baseClass:'sword',gender:'m'},T);env.DB.sqlite.prepare("UPDATE rpg_characters SET level=50,class_path='A' WHERE tg_id='888'").run();
 const body={tier:50,tactic:'balanced',requestId:'create-only-once'},results=await Promise.allSettled([R.create(env,'888',body,T),R.create(env,'888',body,T)]);
 assert.ok(results.every(x=>x.status==='fulfilled'));assert.equal(results[0].value.party.id,results[1].value.party.id);
 const replay=await R.create(env,'888',body,T+1);assert.equal(replay.party.id,results[0].value.party.id);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM rpg_star_ring_runs').get().n,1);
 await assert.rejects(R.create(env,'888',{...body,tactic:'deep'},T),e=>e.code==='request');
});
test('mid-stage departure preserves exact earlier projected history',async t=>{
 const{env,db,id,ids}=await fixture(t),s=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);
 const before=E.simulateStage(s,0,100);s.departed[ids[0]]=T+100*E.BEAT_MS;
 const historic=E.simulateStage(s,0,100);assert.deepEqual(historic,before);const later=E.simulateStage(s,0,101);assert.equal(later.actors.some(a=>a.id===ids[0]),false);
});
test('Lv40 entry works and Lv39 is rejected without spending quota',async t=>{
 const{env,db,id,ids}=await fixture(t,{tier:40,classes:['sword:A','mage:A','thief:A','archer:A','sword:B'],start:false});
 db.prepare('UPDATE rpg_characters SET level=39 WHERE tg_id=?').run(ids[4]);await assert.rejects(R.action(env,ids[0],{partyId:id,action:'start'},T),e=>e.code==='level');assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_starts').get().n,0);
 db.prepare('UPDATE rpg_characters SET level=40 WHERE tg_id=?').run(ids[4]);const p=await R.action(env,ids[0],{partyId:id,action:'start'},T);assert.equal(p.party.status,'running');assert.equal(p.party.tier,40);assert.ok(p.party.members.every(m=>m.level===40));
});
test('advanced rewards improve tokens and independent gear chances without 100-percent scrolls',async t=>{
 const{env,db,id}=await fixture(t),s=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json),actor=s.actors[0];let normalExtra=0,advancedExtra=0,advancedAExtra=0;
 for(let n=0;n<500;n++){
  const common={...s,seed:'reward-balance-'+n,results:Array.from({length:6},()=>({grade:'S'}))};
  const normal=E.stageReward({...common,difficulty:'normal'},actor,5,{grade:'S',expHours:4}),advanced=E.stageReward({...common,difficulty:'advanced'},actor,5,{grade:'S',expHours:4}),advancedA=E.stageReward({...common,difficulty:'advanced',results:Array.from({length:6},()=>({grade:'A'}))},actor,5,{grade:'A',expHours:22/6});
  assert.equal(normal.items.star_ring_token,11);assert.equal(advanced.items.star_ring_token,12);assert.equal(advancedA.items.star_ring_token,11);
  assert.equal(normal.exp,advanced.exp);assert.ok(!Object.keys(advanced.items).some(k=>k.startsWith('guaranteed_')));
  normalExtra+=normal.equipment.length-1;advancedExtra+=advanced.equipment.length-1;advancedAExtra+=advancedA.equipment.length-1;
 }
 assert.ok(advancedExtra>normalExtra);assert.ok(advancedAExtra>70&&advancedAExtra<180);
 const preview=(await R.view(env,id,'1000',T)).rewardsPreview;assert.deepEqual(preview.tokens,[10,11]);assert.equal(preview.extraEquipmentChance.S,.35);
});
test('long presence reserves characters while same-owner characters can use other teams',async t=>{
 const{env,db,id,ids}=await fixture(t);
 const alt=(await P.createCharacter(env,{tgId:ids[0],name:'另一遠征角色',baseClass:'mage',gender:'f',charSlot:2},T)).char.tg_id;
 db.prepare("UPDATE rpg_characters SET level=90,class_path='A1' WHERE tg_id=?").run(alt);
 await selectAccountCharacter(env,ids[0],alt,T);
 const room=(await R.create(env,alt,{tier:90},T)).party;
 assert.notEqual(room.id,id);assert.equal(db.prepare('SELECT count(*) n FROM rpg_party_presence WHERE char_id IN (?,?)').get(ids[0],alt).n,2);
 assert.equal(db.prepare('SELECT account_id FROM rpg_party_presence WHERE char_id=?').get(alt).account_id,'ring:'+alt);
 assert.equal(db.prepare('SELECT account_id FROM rpg_star_ring_members WHERE run_id=? AND char_id=?').get(room.id,alt).account_id,ids[0]);
 await R.action(env,alt,{partyId:room.id,action:'leave'},T);
 const short=await ShortParty.create(env,alt,{dungeonId:'pillar'},T);assert.equal(short.party.status,'lobby');
 await assert.rejects(R.create(env,alt,{tier:90},T),e=>e.code==='party');
 assert.equal(db.prepare('SELECT status FROM rpg_star_ring_runs WHERE id=?').get(id).status,'running');
});
test('same owner cannot occupy two seats in one expedition, while each character quota stays separate',async t=>{
 const{env,db,id,ids}=await fixture(t,{start:false});
 await R.action(env,ids[4],{partyId:id,action:'leave'},T);
 const alt=(await P.createCharacter(env,{tgId:ids[0],name:'同帳號另一席',baseClass:'mage',gender:'f',charSlot:2},T)).char.tg_id;
 db.prepare("UPDATE rpg_characters SET level=90,class_path='A1' WHERE tg_id=?").run(alt);await selectAccountCharacter(env,ids[0],alt,T);
 await assert.rejects(R.action(env,alt,{partyId:id,action:'join'},T),e=>e.code==='account');
 assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_starts WHERE char_id=?').get(alt).n,0);
 await selectAccountCharacter(env,ids[0],ids[0],T);
});
test('species attacks have true venom, shield-break, mana drain, interrupts, cleave and cleansable curse',async t=>{
 const{db,id}=await fixture(t),s=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);
 s.actors=s.actors.map(a=>({...a,atk:1,departureAtk:1}));
 const poisoned=E.simulateStage(s,0,7);assert.ok(poisoned.events.some(e=>e.label==='晶毒附著'));
 const ticking=E.simulateStage(s,0,8);assert.ok(ticking.events.some(e=>e.label==='晶毒侵蝕'&&e.damage>=0));assert.ok(ticking.events.some(e=>e.cleansed>0));
 const shield=E.simulateStage(s,1,0);assert.ok(shield.enemy.shield>0);const breaker=shield.actors.find(a=>E.rolesOf(a).includes('breach'));const broken=E.castExpeditionRole(breaker,{...shield,cooperation:{},round:1},'breach',T);assert.ok(broken.shieldBroken>0);
 const spider=E.simulateStage(s,2,6);assert.ok(spider.events.some(e=>e.label==='銀針汲能'&&e.drainedMp>0));const support=spider.actors.find(a=>E.rolesOf(a).includes('aid'));support.mp=support.maxMp;spider.actors[0].mp=0;const replenish=E.castExpeditionRole(support,{...spider,cooperation:{},round:100},'aid',T);assert.ok(replenish.restoredMp>0);
 const song=E.simulateStage(s,3,3);assert.ok(song.events.some(e=>e.label==='縛月安魂曲已被打斷'));
 const noControl={...s,actors:[...s.actors.filter(a=>!E.rolesOf(a).includes('control')),{...s.actors[0],id:'extra-guard',path:'B1'}]},heavy=E.simulateStage(noControl,3,3);assert.ok(heavy.events.some(e=>e.label==='縛月安魂曲'&&e.damage>=0));
 const cleave=E.simulateStage(s,4,4);assert.ok(cleave.events.some(e=>e.label==='九曜橫掃'));
 const curse=E.simulateStage(noControl,5,4);assert.ok(curse.actors.some(a=>a.debuffs.some(d=>d.type==='party-curse')));
 const clean=E.simulateStage(noControl,5,5);assert.ok(clean.events.some(e=>e.cleansed>0));assert.ok(clean.actors.every(a=>a.debuffs.every(d=>d.type!=='party-curse')));
 assert.equal(E.windupAt(0,6),true);assert.equal(E.windupAt(3,2),true);assert.equal(E.windupAt(5,3),true);
});
test('run engine version is fixed and result snapshots keep equipment only once at departure',async t=>{
 const{env,db,id,ids}=await fixture(t);let s=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);assert.equal(s.engineVersion,1);
 assert.ok(s.actors.every(a=>a.equipment.length>0));const result=E.simulateStage(s,0);assert.ok(result.actors.every(a=>!Object.hasOwn(a,'equipment')));assert.ok(s.actors.every(a=>a.equipment.length>0));
 await R.view(env,id,ids[0],T+E.DURATION);s=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);assert.ok(s.results.every(r=>r.actors.every(a=>!Object.hasOwn(a,'equipment'))));
 assert.throws(()=>E.simulateStage({...s,engineVersion:999},0),e=>e.code==='engine_version');
 assert.ok((await R.view(env,id,ids[0],T+E.DURATION)).battle.enemy.behavior);assert.ok((await R.view(env,id,ids[0],T+E.DURATION)).battle.enemy.spell);
});
test('hourly catalog has twelve original monsters and twelve distinct maps with verified-only optional videos',()=>{
 assert.equal(E.HOURLY_ENCOUNTERS.length,12);assert.equal(new Set(E.HOURLY_ENCOUNTERS.map(e=>e.enemyId)).size,12);
 assert.deepEqual(E.HOURLY_ENCOUNTERS.map(e=>e.artIndex),[1,7,2,8,3,9,4,10,5,11,12,6]);
 assert.equal(new Set(E.SCENES.map(s=>s.mapId)).size,12);assert.equal(new Set(E.SCENES.map(s=>s.name)).size,12);
 for(let i=0;i<12;i++){assert.ok(E.HOURLY_ENCOUNTERS[i].behavior&&E.HOURLY_ENCOUNTERS[i].spell);assert.equal(E.SCENES[i].image,`/art/star-ring-20261018/map-${String(i+1).padStart(2,'0')}.webp`);if(E.SCENES[i].video)assert.ok(E.AVAILABLE_SCENE_VIDEOS.includes(E.SCENES[i].video.split('/').at(-1)));}
});
test('all twelve exact hourly boundaries switch scene, species and art while rewards stay at six two-hour checkpoints',async t=>{
 const{env,db,id,ids}=await fixture(t);const initial=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json),snapshots=[];
 for(let hour=0;hour<12;hour++){
  if(hour>0){const previous=await R.view(env,id,ids[0],T+hour*E.HOUR_MS-1);assert.equal(previous.hourIndex,hour-1);}
  const p=await R.view(env,id,ids[0],T+hour*E.HOUR_MS);
  assert.equal(p.hourIndex,hour);assert.equal(p.hourEndsAt,T+(hour+1)*E.HOUR_MS);assert.equal(p.scene.name,E.SCENES[hour].name);assert.equal(p.battle.scene.mapId,E.SCENES[hour].mapId);
  assert.equal(p.battle.enemy.id,E.HOURLY_ENCOUNTERS[hour].enemyId);assert.equal(p.battle.enemy.artIndex,E.HOURLY_ENCOUNTERS[hour].artIndex);assert.equal(p.battle.enemy.hp,p.battle.enemy.maxHp);
  assert.equal(p.completedStages,Math.floor(hour/2));assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_rewards').get().n,Math.floor(hour/2)*5);
  if(hour%2===1){assert.equal(p.battle.encounters.length,1);assert.ok(p.battle.waves>=p.battle.encounters[0].waves);assert.ok(p.battle.events.some(e=>e.actorId==='system'&&e.label.includes(p.scene.name)));}
  snapshots.push(await R.view(env,id,ids[0],T+hour*E.HOUR_MS+17*E.BEAT_MS));
 }
 const complete=await R.view(env,id,ids[0],T+E.DURATION);assert.equal(complete.status,'complete');assert.equal(complete.hourIndex,11);assert.equal(complete.completedStages,6);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_rewards').get().n,30);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_starts').get().n,5);
 const offline=structuredClone(initial);
 for(let stage=0;stage<6;stage++){
  for(let half=0;half<2;half++){
   const hour=stage*2+half,projection=E.simulateStage(offline,stage,half*E.HOUR_BEATS+17),actual=snapshots[hour].battle;
   assert.equal(actual.hourIndex,hour);assert.deepEqual(actual.events,projection.events);assert.equal(actual.waves,projection.waves);
   if(projection.enemy.hp===0){assert.equal(actual.spawn.previousHp,0);assert.equal(actual.spawn.wave,projection.waves+1);assert.equal(actual.enemy.hp,projection.enemy.maxHp);}else{assert.equal(actual.spawn,null);assert.equal(actual.enemy.hp,projection.enemy.hp);}
   assert.deepEqual(actual.members.map(m=>m.hp),projection.actors.map(a=>a.hp));
  }
  const result=E.simulateStage(offline,stage);assert.equal(result.encounters.length,2);assert.equal(result.encounters.reduce((n,a)=>n+a.waves,0),result.waves);assert.deepEqual(result.encounters.map(e=>e.hourIndex),[stage*2,stage*2+1]);offline.results.push(result);offline.stageTactics[stage+1]=offline.tactic;
 }
 const committed=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);assert.deepEqual(committed.results,JSON.parse(JSON.stringify(offline.results)));
});
test('late offline twelve-hour settlement replays all twelve areas with no extra grants, quota or notifications',async t=>{
 const{env,db,id,ids}=await fixture(t),p=await R.view(env,id,ids[0],T+E.DURATION+30000);
 assert.equal(p.stages.flatMap(s=>s.result.encounters).length,12);assert.equal(new Set(p.stages.flatMap(s=>s.result.encounters).map(e=>e.enemyId)).size,12);
 assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_rewards').get().n,30);assert.equal(db.prepare("SELECT count(*) n FROM rpg_outbox WHERE kind='star_ring_complete'").get().n,5);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_starts').get().n,5);
 const before=JSON.stringify(p.me.rewards);await R.sweep(env,T+E.DURATION+60000);const replay=await R.view(env,id,ids[0],T+E.DURATION+60000);assert.equal(JSON.stringify(replay.me.rewards),before);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_rewards').get().n,30);
});
test('gear-shop lottery uses private server entropy instead of a player-selected request ID, then replays its receipt',async t=>{
 const{env,db,ids}=await fixture(t);db.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'star_ring_token',80)").run(ids[0]);
 const serverValues=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'],body={offerId:'gear',requestId:'player-picked-quality-seed'};let calls=0;
 const random=t.mock.method(globalThis.crypto,'randomUUID',()=>serverValues[calls++]);
 const expected=makeEliteGear({id:'ringshop:'+serverValues[0],tgId:ids[0],cls:'sword',classPath:'B2',tier:9,rng:rngFor(serverValues[1]),now:T});expected.source='star_ring';expected.name=expected.name.replace(/^菁英/,'星征');
 const bought=await R.shop(env,ids[0],body,T);assert.deepEqual(bought.equipment[0],expected);assert.equal(calls,2);
 const replay=await R.shop(env,ids[0],body,T);assert.deepEqual(replay,bought);assert.equal(calls,2);assert.equal(db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='star_ring_token'").get(ids[0]).quantity,40);
 random.mock.restore();
});
test('withdrawn lobby member may rejoin with another owned character without holding two seats',async t=>{
 const{env,db,id,ids}=await fixture(t,{start:false});await R.action(env,ids[4],{partyId:id,action:'leave'},T);
 const alt=(await P.createCharacter(env,{tgId:ids[4],name:'換角再回隊伍',baseClass:'mage',gender:'f',charSlot:2},T)).char.tg_id;
 db.prepare("UPDATE rpg_characters SET level=90,class_path='A1' WHERE tg_id=?").run(alt);await selectAccountCharacter(env,ids[4],alt,T);
 const joined=await R.action(env,alt,{partyId:id,action:'join'},T);assert.equal(joined.party.members.filter(m=>!m.left).length,5);assert.equal(joined.party.members.filter(m=>m.id===ids[4]).length,0);assert.equal(joined.party.me.id,alt);
 assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_members WHERE run_id=? AND account_id=?').get(id,ids[4]).n,1);
 await R.action(env,alt,{partyId:id,action:'ready'},T);assert.equal((await R.action(env,ids[0],{partyId:id,action:'start'},T)).party.status,'running');
});
test('a fully withdrawn expedition freezes progress at retreat instead of drifting to completion later',async t=>{
 const{env,id,ids}=await fixture(t);for(const tg of ids)await R.action(env,tg,{partyId:id,action:'leave'},T+E.HOUR_MS);
 const ended=await R.view(env,id,ids[0],T+E.HOUR_MS);assert.equal(ended.status,'ended');assert.equal(ended.completedStages,0);assert.equal(ended.progress,1/12);
 const later=await R.view(env,id,ids[0],T+E.DURATION*2);assert.equal(later.status,'ended');assert.equal(later.progress,ended.progress);assert.equal(later.me.rewards.exp,0);
});
