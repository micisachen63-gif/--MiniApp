import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {CurrentClientRequest} from './client-request.js';
import * as P from '../src/services/player.js';
import * as R from '../src/services/star-ring.js';
import * as A from '../src/services/auto-enhance.js';
import * as G from '../src/services/party.js';
import * as E from '../src/game/star-ring.js';
import {handle} from '../src/index.js';
import {loadPlayer,insertEquipStmt} from '../src/db.js';
import {makeGear} from '../src/game/gear.js';
import {computeStats} from '../src/game/stats.js';
const T=Date.parse('2026-10-19T00:00:00Z');
async function fixture(t,{version=3,start=true}={}){
 const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'},db=env.DB.sqlite,ids=['8811','8812','8813','8814','8815'];t.after(()=>db.close());
 for(const[i,tgId]of ids.entries()){
  await P.createCharacter(env,{tgId,name:'淬鍊旅人'+i,baseClass:['sword','mage','archer','thief','sword'][i],gender:'m'},T);
  db.prepare("UPDATE rpg_characters SET level=80,class_path='A1',gold=100000000,last_settle_at=? WHERE tg_id=?").run(T,tgId);
  const p=await loadPlayer(env.DB,tgId),s=computeStats(p.char,p.equipment.filter(e=>e.is_equipped));db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(s.maxHp,s.maxMp,tgId);
 }
 const id=(await R.create(env,ids[0],{tier:80},T)).party.id;
 const s=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);s.engineVersion=version;db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(s),id);
 for(const tg of ids.slice(1))await R.action(env,tg,{partyId:id,action:'join'},T);
 for(const tg of ids)await R.action(env,tg,{partyId:id,action:'ready'},T);
 if(start)await R.action(env,ids[0],{partyId:id,action:'start'},T);
 for(const slot of ['weapon','helmet'])await insertEquipStmt(env.DB,{...makeGear({id:'bag-'+slot,tgId:ids[0],cls:'sword',slot,tier:3,kind:slot==='weapon'?'sword':undefined,rng:()=>.5,now:T,source:'shop'}),bound:0,is_equipped:0}).run();
 for(const key of ['scroll_w','scroll_a','blessed_scroll_w','blessed_scroll_a','guaranteed_scroll_w','guaranteed_scroll_a'])db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,50) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=50').run(ids[0],key);
 return {env,db,ids,id};
}
const stored=f=>JSON.parse(f.db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(f.id).state_json);
const char=f=>f.db.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get(f.ids[0]);
const gear=(f,id='bag-weapon')=>f.db.prepare('SELECT * FROM rpg_equipment WHERE id=?').get(id);
const manual=(f,body={},at=T+1,rng=()=>0)=>P.withPlayer(f.env,f.ids[0],at,(w,c)=>P.doEnhance(w,c,{itemId:'bag-weapon',requestId:'manual-'+at,...body},rng));
const api=async(f,action,body,at=T+1)=>{const r=await handle(new CurrentClientRequest('https://local/app/api/'+action,{method:'POST',headers:{'content-type':'application/json','X-Dev-Tg-Id':f.ids[0],'X-Debug-Now':String(at)},body:JSON.stringify(body)}),f.env);return {status:r.status,j:await r.json()};};
function preserve(f,before){assert.deepEqual(stored(f),before);assert.equal(char(f).party_id,f.id);}

for(const version of [1,2,3])test(`running v${version} expedition permits manual backpack enhancement and preserves binding, live HP/MP and the entire departure state`,async t=>{
 const f=await fixture(t,{version}),before=stored(f);f.db.prepare('UPDATE rpg_characters SET hp=123,mp=45 WHERE tg_id=?').run(f.ids[0]);
 const r=await manual(f);assert.equal(r.result.result,'success');assert.equal(gear(f).enhance_level,1);assert.equal(gear(f).bound,0);
 assert.equal(char(f).hp,123);assert.equal(char(f).mp,45);preserve(f,before);
});

for(const slot of ['weapon','helmet'])for(const mode of ['ordinary','blessed','guaranteed'])test(`${mode} ${slot} uses the correct scroll while the expedition snapshot remains immutable`,async t=>{
 const f=await fixture(t),before=stored(f),key=(mode==='ordinary'?'scroll_':mode+'_scroll_')+(slot==='weapon'?'w':'a'),need=mode==='ordinary'?3:1,level=mode==='guaranteed'?8:0;
 f.db.prepare('UPDATE rpg_equipment SET enhance_level=? WHERE id=?').run(level,'bag-'+slot);
 const p=await loadPlayer(f.env.DB,f.ids[0]);const result=await manual(f,{itemId:'bag-'+slot,blessed:mode==='blessed',guaranteed:mode==='guaranteed'});
 assert.equal(result.result.to,level+1);assert.deepEqual(result.result.used,{[key]:need});
 const after=await loadPlayer(f.env.DB,f.ids[0]);assert.equal(after.inv[key],p.inv[key]-need);assert.equal(after.char.gold,p.char.gold);assert.equal(gear(f,'bag-'+slot).bound,0);preserve(f,before);
});

for(const blessed of [false,true])test(`background ${blessed?'blessed':'ordinary'} enhancement completes, charges once and keeps expedition state intact`,async t=>{
 const f=await fixture(t),before=stored(f),key=blessed?'blessed_scroll_a':'scroll_a';f.db.prepare('UPDATE rpg_inventory SET quantity=0 WHERE tg_id=? AND item=?').run(f.ids[0],'scroll_a');
 const start=await loadPlayer(f.env.DB,f.ids[0]),job=(await A.start(f.env,f.ids[0],{itemId:'bag-helmet',target:3,blessed},T+1)).job;
 assert.equal((await A.start(f.env,f.ids[0],{itemId:'bag-helmet',target:3,blessed},T+1)).job.id,job.id);
 await Promise.all([A.step(f.env,job.id,T+1,()=>0),A.step(f.env,job.id,T+1,()=>0)]);
 await A.step(f.env,job.id,T+3001,()=>0);await A.step(f.env,job.id,T+6001,()=>0);
 const done=await A.view(f.env,f.ids[0]),after=await loadPlayer(f.env.DB,f.ids[0]);assert.equal(done.reason,'target');assert.equal(done.attempts,3);assert.equal(gear(f,'bag-helmet').enhance_level,3);assert.equal(gear(f,'bag-helmet').bound,0);
 assert.equal(done.spentScrolls,blessed?3:9);assert.equal(after.char.gold,start.char.gold-done.spentGold);assert.equal(after.inv[key]||0,blessed?47:0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM rpg_ledger WHERE event_id LIKE ?').get('enhance:'+f.ids[0]+':auto:'+job.id+':%').n,3);
 assert.equal(f.db.prepare("SELECT count(*) n FROM rpg_outbox WHERE dedupe_key=?").get('auto-end:'+job.id).n,1);preserve(f,before);
});

test('manual API derives expedition permission on the server and retains request replay protection',async t=>{
 const f=await fixture(t),before=stored(f),body={itemId:'bag-weapon',guaranteed:true,requestId:'real-ring-api'};
 const a=await api(f,'enhance',body),b=await api(f,'enhance',body);assert.equal(a.status,200);assert.equal(b.status,409);assert.equal(b.j.error,'duplicate');assert.equal(gear(f).enhance_level,1);
 assert.equal((await loadPlayer(f.env.DB,f.ids[0])).inv.guaranteed_scroll_w,49);preserve(f,before);
});

test('equipped, traded and unknown equipment fail before any gold or scroll charge in both modes',async t=>{
 const f=await fixture(t),equipped=(await loadPlayer(f.env.DB,f.ids[0])).equipment.find(e=>e.is_equipped).id,before=stored(f);
 f.db.prepare("UPDATE rpg_equipment SET trade_id='exchange:test' WHERE id='bag-weapon'").run();
 for(const itemId of [equipped,'bag-weapon','does-not-exist']){
  const p=await loadPlayer(f.env.DB,f.ids[0]);await assert.rejects(manual(f,{itemId}),e=>['party','in_trade','not_found'].includes(e.code));
  await assert.rejects(A.start(f.env,f.ids[0],{itemId,target:3},T+1),e=>['busy','not_found'].includes(e.code));
  const after=await loadPlayer(f.env.DB,f.ids[0]);assert.equal(after.char.gold,p.char.gold);assert.deepEqual(after.inv,p.inv);assert.deepEqual(after.equipment,p.equipment);
 }
 preserve(f,before);
});

for(const mode of ['fake-marker','left-member','ended-run'])test(`${mode} cannot relax enhancement locks by supplying a ring-looking ID or forged request field`,async t=>{
 const f=await fixture(t);if(mode==='fake-marker')f.db.prepare("UPDATE rpg_characters SET party_id='ring:fake' WHERE tg_id=?").run(f.ids[0]);
 else if(mode==='left-member')f.db.prepare('UPDATE rpg_star_ring_members SET left_at=? WHERE run_id=? AND char_id=?').run(T,f.id,f.ids[0]);
 else f.db.prepare("UPDATE rpg_star_ring_runs SET status='complete' WHERE id=?").run(f.id);
 const p=await loadPlayer(f.env.DB,f.ids[0]);const r=await api(f,'enhance',{itemId:'bag-weapon',guaranteed:true,requestId:'forged',runningExpeditionId:char(f).party_id});assert.equal(r.j.error,'party');
 await assert.rejects(A.start(f.env,f.ids[0],{itemId:'bag-weapon',target:2,runningExpeditionId:char(f).party_id},T+1),e=>e.code==='busy');
 const after=await loadPlayer(f.env.DB,f.ids[0]);assert.deepEqual(after.inv,p.inv);assert.equal(after.char.gold,p.char.gold);assert.equal(gear(f).enhance_level,0);
});

test('an existing backpack job continues after departure; an equipped job stops before spending',async t=>{
 for(const equipped of [false,true]){
  const f=await fixture(t,{start:false}),itemId=equipped?(await loadPlayer(f.env.DB,f.ids[0])).equipment.find(e=>e.is_equipped).id:'bag-weapon';
  const job=(await A.start(f.env,f.ids[0],{itemId,target:2},T)).job;await R.action(f.env,f.ids[0],{partyId:f.id,action:'start'},T+1);const before=stored(f);
  await A.step(f.env,job.id,T+2,()=>0);const after=await A.view(f.env,f.ids[0]);assert.equal(after.attempts,equipped?0:1);assert.equal(after.reason,equipped?'party':null);preserve(f,before);
 }
});

test('an actual foreground dungeon still locks enhancement even when its character has a background expedition',async t=>{
 const f=await fixture(t),id=(await G.create(f.env,f.ids[0],{kind:'dungeon',dungeonId:'pillar'},T+1)).party.id;
 for(const tg of f.ids.slice(1,3))await G.action(f.env,tg,{partyId:id,op:'join'},T+1);
 for(const tg of f.ids.slice(0,3))await G.action(f.env,tg,{partyId:id,op:'ready'},T+1);
 await G.action(f.env,f.ids[0],{partyId:id,op:'start'},T+1);const before=stored(f),short=f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json;
 await assert.rejects(manual(f),e=>e.code==='party');await assert.rejects(A.start(f.env,f.ids[0],{itemId:'bag-weapon',target:2},T+2),e=>e.code==='busy');
 assert.equal(char(f).party_id,id);assert.deepEqual(stored(f),before);assert.equal(f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json,short);
});

test('backpack break deletes only that item, keeps departure equipment and leaves the expedition running',async t=>{
 const f=await fixture(t),before=stored(f);f.db.prepare("UPDATE rpg_equipment SET enhance_level=5 WHERE id='bag-helmet'").run();
 const j=(await A.start(f.env,f.ids[0],{itemId:'bag-helmet',target:6},T+1)).job;await A.step(f.env,j.id,T+1,()=>.5);
 assert.equal((await A.view(f.env,f.ids[0])).reason,'break');assert.equal(gear(f,'bag-helmet'),undefined);preserve(f,before);
});

test('backpack upgrades and a simultaneous checkpoint preserve the complete twelve-hour combat and all thirty rewards',async t=>{
 const f=await fixture(t),control=await fixture(t),s=stored(f);s.seed='unchanged-expedition-after-backpack-upgrades';
 for(const run of [f,control])run.db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(s),run.id);
 const job=(await A.start(f.env,f.ids[0],{itemId:'bag-helmet',target:3},T+1)).job;
 await manual(f,{guaranteed:true});await A.step(f.env,job.id,T+1,()=>0);
 await Promise.allSettled([A.step(f.env,job.id,T+E.STAGE_MS,()=>0),R.sweep(f.env,T+E.STAGE_MS)]);
 await A.step(f.env,job.id,T+E.STAGE_MS+1,()=>0);await R.sweep(f.env,T+E.STAGE_MS+1);
 await A.step(f.env,job.id,T+E.STAGE_MS+4000,()=>0);assert.equal((await A.view(f.env,f.ids[0])).reason,'target');
 await R.sweep(f.env,T+E.DURATION);await R.sweep(control.env,T+E.DURATION);
 assert.deepEqual(stored(f).actors,s.actors);assert.deepEqual(stored(f).results,stored(control).results);
 const payouts=run=>run.db.prepare('SELECT char_id,stage,reward_json FROM rpg_star_ring_rewards WHERE run_id=? ORDER BY char_id,stage').all(run.id);
 assert.equal(payouts(f).length,30);assert.deepEqual(payouts(f),payouts(control));assert.equal(gear(f).enhance_level,1);assert.equal(gear(f,'bag-helmet').enhance_level,3);
 assert.equal((await A.view(f.env,f.ids[0])).attempts,3);
});
