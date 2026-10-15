import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {handle,runCron} from '../src/index.js';
const SECRET='test-outbox-secret-123456';
function setup(){
 const env={DB:freshDb(),SERVICE_SECRET:SECRET,ENVIRONMENT:'development',ALLOW_DEBUG_TIME:'true'};
 const call=async(action,body={},now=T0)=>{
  const response=await handle(new Request('http://local/rpg/outbox/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Service-Secret':SECRET,'X-Debug-Now':String(now)},body:JSON.stringify(body)}),env);
  return {status:response.status,...await response.json()};
 };
 const add=async(dedupe,over={})=>env.DB.prepare('INSERT INTO rpg_outbox(dedupe_key,target,tg_id,kind,payload_json,created_at) VALUES(?,?,?,?,?,?)').bind(dedupe,over.target||'dm',over.tgId||'111',over.kind||'low_supply',over.payload??'{}',T0).run();
 return {env,call,add};
}
test('forty permanently failing DMs cannot starve a newer valid notification',async()=>{
 const {call,add,env}=setup();for(let n=0;n<40;n++)await add('failed-'+n);await add('valid',{target:'group'});
 for(let batch=0;batch<2;batch++){
  const claimed=await call('claim',{limit:20});assert.equal(claimed.items.length,20);
  const failure=await call('fail',{ids:claimed.items.map(x=>x.id),claimToken:claimed.items[0].claimToken,errorCode:403,error:'Forbidden: user never started this bot'});
  assert.equal(failure.failed,20);assert.equal(failure.retrying,0);
 }
 const next=await call('claim',{limit:20});assert.deepEqual(next.items.map(x=>x.id),[41]);
 assert.equal((await call('ack',{ids:[41],claimToken:next.items[0].claimToken})).delivered,1);
 const status=(await call('status')).outbox;assert.equal(status.failed,40);assert.equal(status.delivered,1);assert.equal(status.pending,0);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_outbox WHERE failed_at IS NOT NULL AND delivered_at IS NOT NULL').first()).n,0);
});
test('transient failures back off exponentially and dead-letter after eight attempts',async()=>{
 const {call,add,env}=setup();await add('retry');let now=T0;
 for(let attempt=1;attempt<=8;attempt++){
  const claimed=await call('claim',{limit:20},now);assert.equal(claimed.items.length,1);
  const failure=await call('fail',{ids:[1],claimToken:claimed.items[0].claimToken,errorCode:0,error:'socket timeout'},now);
  const row=await env.DB.prepare('SELECT * FROM rpg_outbox WHERE id=1').first();assert.equal(row.claim_attempts,attempt);assert.equal(row.claim_token,null);assert.equal(row.claimed_at,null);
  if(attempt===8){assert.equal(failure.failed,1);assert.equal(row.failed_at,now);break;}
  const wait=Math.min(3600000,30000*2**(attempt-1));assert.equal(row.next_attempt_at,now+wait);assert.equal(failure.retrying,1);
  assert.equal((await call('claim',{limit:20},now+wait-1)).items.length,0);now+=wait;
 }
 assert.equal((await call('claim',{limit:20},now+7200000)).items.length,0);
});
test('lease tokens prevent a stale sender from acknowledging or failing a new claim',async()=>{
 const {call,add,env}=setup();await add('token');
 const old=(await call('claim')).items[0];assert.equal((await call('claim',{},T0+59999)).items.length,0);
 const fresh=(await call('claim',{},T0+60000)).items[0];assert.notEqual(old.claimToken,fresh.claimToken);
 assert.equal((await call('ack',{ids:[1],claimToken:old.claimToken},T0+60001)).delivered,0);
 const failure=await call('fail',{ids:[1],claimToken:old.claimToken,errorCode:403},T0+60001);assert.equal(failure.failed,0);assert.equal(failure.retrying,0);
 assert.equal((await env.DB.prepare('SELECT failed_at FROM rpg_outbox WHERE id=1').first()).failed_at,null);
 assert.equal((await call('ack',{ids:[1],claimToken:fresh.claimToken},T0+60001)).delivered,1);
 assert.equal((await call('fail',{ids:[1],claimToken:fresh.claimToken,errorCode:403},T0+60002)).failed,0);
});
test('a malformed payload is isolated without losing other claimed notifications',async()=>{
 const {call,add,env}=setup();await add('invalid',{payload:'{broken'});await add('valid');
 const claimed=await call('claim');assert.equal(claimed.ok,true);assert.deepEqual(claimed.items.map(x=>x.id),[2]);
 const broken=await env.DB.prepare('SELECT claim_token,next_attempt_at,last_error FROM rpg_outbox WHERE id=1').first();assert.equal(broken.claim_token,null);assert.equal(broken.next_attempt_at,T0+30000);assert.match(broken.last_error,/通知資料讀取失敗/);
 assert.equal((await call('ack',{ids:[2],claimToken:claimed.items[0].claimToken})).delivered,1);
});
test('failure reports validate ids and retry-after is bounded; stored errors redact credentials',async()=>{
 const {call,add,env}=setup();await add('rate');const claimed=(await call('claim')).items[0];
 assert.equal((await call('fail',{ids:[-1],claimToken:claimed.claimToken,errorCode:403})).status,400);
 const fake='123456789:TEST_ONLY_abcdefghijklmnopqrstuvwxyz12345';
 await call('fail',{ids:[1],claimToken:claimed.claimToken,errorCode:429,retryAfterSeconds:7200,error:'error '+fake});
 const row=await env.DB.prepare('SELECT next_attempt_at,last_error FROM rpg_outbox WHERE id=1').first();assert.equal(row.next_attempt_at,T0+3600000);assert.doesNotMatch(row.last_error,/123456789/);assert.match(row.last_error,/redacted/);
});
test('negative claim limits are bounded and cron retains recent failed notifications for diagnosis',async()=>{
 const {call,add,env}=setup();for(let i=0;i<60;i++)await add('limit-'+i);
 assert.equal((await call('claim',{limit:-1})).items.length,1);
 const day=86400000;await env.DB.prepare('UPDATE rpg_outbox SET failed_at=? WHERE id=2').bind(T0-31*day).run();await env.DB.prepare('UPDATE rpg_outbox SET failed_at=? WHERE id=3').bind(T0-29*day).run();
 await runCron(env,T0);assert.equal(await env.DB.prepare('SELECT id FROM rpg_outbox WHERE id=2').first(),null);assert.ok(await env.DB.prepare('SELECT id FROM rpg_outbox WHERE id=3').first());
});
