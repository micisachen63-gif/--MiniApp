import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import * as P from '../src/services/player.js';
import * as Ring from '../src/services/star-ring.js';
import {handle} from '../src/index.js';

async function setup(t){
 const env={DB:freshDb(),SERVICE_SECRET:'recruit-test-secret',ALLOW_DEBUG_TIME:'true',ENVIRONMENT:'development'};t.after(()=>env.DB.sqlite.close());
 for(const [tgId,name] of [['77001','招募隊長'],['77002','同行法師']]){
  await P.createCharacter(env,{tgId,name,gender:'f',baseClass:'mage'},T0);
  await env.DB.prepare("UPDATE rpg_characters SET level=40,class_path='A' WHERE tg_id=?").bind(tgId).run();
 }
 return env;
}
test('creating a room queues exactly one atomic group recruitment and retries cannot repost',async t=>{
 const env=await setup(t),body={tier:40,requestId:'recruit-create-once'};
 const a=await Ring.create(env,'77001',body,T0),b=await Ring.create(env,'77001',body,T0);
 assert.equal(a.party.id,b.party.id);
 const rows=env.DB.sqlite.prepare("SELECT * FROM rpg_outbox WHERE kind='star_ring_recruit'").all();
 assert.equal(rows.length,1);assert.equal(rows[0].target,'group');assert.equal(JSON.parse(rows[0].payload_json).partyId,a.party.id);
 await assert.rejects(Ring.create(env,'77001',{tier:40,requestId:'another-recruit'},T0));
 assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_star_ring_runs').get().n,1);
 assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_outbox WHERE kind='star_ring_recruit'").get().n,1);
});
test('claim collapses recruitment revisions and delivers the current five-person room state',async t=>{
 const env=await setup(t),{party}=await Ring.create(env,'77001',{tier:40},T0);
 await Ring.action(env,'77002',{partyId:party.id,action:'join',requestId:'join-recruit'},T0);
 await Ring.action(env,'77002',{partyId:party.id,action:'ready',requestId:'ready-recruit'},T0);
 const res=await handle(new Request('http://rpg/rpg/outbox/claim',{method:'POST',headers:{'content-type':'application/json','X-Service-Secret':env.SERVICE_SECRET,'X-Debug-Now':String(T0)},body:JSON.stringify({limit:20})}),env);
 assert.equal(res.status,200);const items=(await res.json()).items.filter(x=>x.kind==='star_ring_recruit');
 assert.equal(items.length,1);assert.equal(items[0].payload.party.id,party.id);assert.equal(items[0].payload.party.members.length,2);
 assert.equal(items[0].payload.party.members.find(m=>m.id==='77002').ready,true);
 assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_outbox WHERE kind='star_ring_recruit' AND last_error='superseded'").get().n,2);
});
test('lobby cancellation queues a closed state without consuming a daily expedition entry',async t=>{
 const env=await setup(t),{party}=await Ring.create(env,'77001',{tier:40},T0);
 await Ring.action(env,'77001',{partyId:party.id,action:'leave',requestId:'cancel-recruit'},T0);
 assert.equal((await Ring.view(env,party.id,null,T0)).status,'ended');
 assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_outbox WHERE kind='star_ring_recruit'").get().n,2);
 assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_star_ring_starts').get().n,0);
});
