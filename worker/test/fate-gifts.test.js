import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {createCharacter} from '../src/services/player.js';
import * as F from '../src/services/fate.js';
import * as G from '../src/services/fate-gifts.js';
import {LIFE_MS} from '../public/fate/life.js';
import {createHmac} from 'node:crypto';
import {CurrentClientRequest} from './client-request.js';
import {handle} from '../src/index.js';
const T=Date.parse('2026-10-16T06:00:00+08:00'),rid=()=>crypto.randomUUID();
async function fixture(t){const env={DB:freshDb()},db=env.DB.sqlite;t.after(()=>db.close());const a=(await createCharacter(env,{tgId:'101',name:'四世旅人',baseClass:'sword',gender:'m'},T)).char.tg_id,b=(await createCharacter(env,{tgId:'101',name:'另一旅人',baseClass:'mage',gender:'f'},T)).char.tg_id;const one=(sql,...p)=>db.prepare(sql).get(...p),exec=(sql,...p)=>db.prepare(sql).run(...p);const add=(n,char=a,status='complete')=>{for(let i=0;i<n;i++){const id=rid();exec('INSERT INTO rpg_fate_lives(id,char_id,account_id,state_json,status,started_at,completed_at,next_at) VALUES(?,?,?,?,?,?,?,?)',id,char,'101','{}',status,T+i,T+i,T+i);}};return {env,db,a,b,one,exec,add};}
const qty=(f,item,char=f.a)=>f.one('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?',char,item)?.quantity||0;
test('only authoritative completed lives count per character; imported memorials, active lives and client numbers cannot mint gifts',async t=>{const f=await fixture(t);f.add(3);f.add(1,f.a,'active');f.add(4,f.b);f.exec('INSERT INTO rpg_fate_memorials(char_id,code,created_at) VALUES(?,?,?)',f.a,'untrusted-code',T);assert.equal((await G.summary(f.env,f.a)).completed,3);assert.equal((await G.summary(f.env,f.a)).claimable,0);assert.equal((await G.summary(f.env,f.b)).claimable,1);const r=await G.claim(f.env,f.a,{requestId:rid(),completed:9999,reward:'guaranteed_scroll_w'},T);assert.equal(r.result.claimed,0);assert.equal(qty(f,G.GIFT_ITEM),0);});
test('four actual completed two-hour lives produce exactly one cumulative gift; polling and reclaims never duplicate it',async t=>{const f=await fixture(t);for(let i=0;i<4;i++){const now=T+i*LIFE_MS;await F.start(f.env,f.a,{requestId:rid(),mode:'random'},now);await F.state(f.env,f.a,now+LIFE_MS);}const s=await G.summary(f.env,f.a);assert.equal(s.completed,4);assert.equal(s.claimable,1);const r=await G.claim(f.env,f.a,{requestId:rid()},T+4*LIFE_MS);assert.equal(r.result.claimed,1);assert.equal(qty(f,G.GIFT_ITEM),1);assert.equal((await G.claim(f.env,f.a,{requestId:rid()},T+4*LIFE_MS)).result.claimed,0);assert.equal((await G.summary(f.env,f.a)).unopened,1);assert.equal(f.one("SELECT COUNT(*) n FROM rpg_ledger WHERE type='輪迴贈禮'").n,1);});
test('multiple old milestones can be accumulated, exactly one gift for each fourth completed life',async t=>{const f=await fixture(t);f.add(13);const r=await G.claim(f.env,f.a,{requestId:rid()},T);assert.equal(r.result.claimed,3);assert.equal(qty(f,G.GIFT_ITEM),3);assert.deepEqual(f.db.prepare('SELECT milestone FROM rpg_fate_gifts ORDER BY milestone').all().map(r=>r.milestone),[4,8,12]);const s=await G.summary(f.env,f.a);assert.equal(s.nextIn,3);assert.equal(s.claimable,0);});
test('claim is account-idempotent and binds both character and exact payload',async t=>{const f=await fixture(t);f.add(8);const b={requestId:rid()},r=await G.claim(f.env,f.a,b,T);assert.deepEqual((await G.claim(f.env,f.a,b,T+100)).result,r.result);assert.equal(qty(f,G.GIFT_ITEM),2);await assert.rejects(G.claim(f.env,f.b,b,T+100),e=>e.code==='request_changed');await assert.rejects(G.claim(f.env,f.a,{...b,extra:1},T),e=>e.code==='request_changed');});
test('two concurrent claim requests cannot duplicate milestone grants',async t=>{const f=await fixture(t);f.add(12);const r=await Promise.all([G.claim(f.env,f.a,{requestId:rid()},T),G.claim(f.env,f.a,{requestId:rid()},T)]);assert.equal(r.reduce((n,x)=>n+x.result.claimed,0),3);assert.equal(qty(f,G.GIFT_ITEM),3);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_gifts').n,3);});
test('published gift pool boundaries are exactly 5% weapon, 5% armor and 90% two plus two ordinary scrolls',()=>{assert.equal(G.GIFT_POOL.reduce((n,x)=>n+x.weight,0),100);for(const [r,id]of [[0,'weapon'],[.049999,'weapon'],[.05,'armor'],[.099999,'armor'],[.1,'scrolls'],[.999999,'scrolls']])assert.equal(G.drawGift(()=>r).id,id);assert.deepEqual(G.drawGift(()=>.5).items,{scroll_w:2,scroll_a:2});for(const r of [-1,1,NaN,Infinity])assert.throws(()=>G.drawGift(()=>r));});
for(const [roll,item]of [[0,'guaranteed_scroll_w'],[.05,'guaranteed_scroll_a'],[.5,'scroll_w']])test(`opening atomically consumes one gift and grants ${item} exactly once, with ledger and replay`,async t=>{const f=await fixture(t);f.add(4);const id=(await G.claim(f.env,f.a,{requestId:rid()},T)).result.giftIds[0],b={requestId:rid(),giftId:id},before=qty(f,item),r=await G.open(f.env,f.a,b,T+1,()=>roll);assert.equal(qty(f,G.GIFT_ITEM),0);assert.equal(qty(f,item)-before,item==='scroll_w'?2:1);assert.equal((await G.summary(f.env,f.a)).opened,1);const replay=await G.open(f.env,f.a,b,T+2,()=>{throw new Error('must not redraw')});assert.deepEqual(replay.result,r.result);assert.equal(replay.replayed,true);assert.equal(qty(f,item)-before,item==='scroll_w'?2:1);await assert.rejects(G.open(f.env,f.a,{requestId:rid(),giftId:id},T+3),e=>e.code==='fate_no_gift');assert.equal(f.one("SELECT COUNT(*) n FROM rpg_ledger WHERE type='開啟輪迴禮'").n,1);assert.equal(f.one("SELECT COUNT(*) n FROM rpg_ledger WHERE type='星輝匣獎勵'").n,item==='scroll_w'?2:1);});
test('a foreign character cannot open another character gift and the client cannot select a reward',async t=>{const f=await fixture(t);f.add(4);const id=(await G.claim(f.env,f.a,{requestId:rid()},T)).result.giftIds[0];await assert.rejects(G.open(f.env,f.b,{requestId:rid(),giftId:id},T),e=>e.code==='fate_no_gift');const r=await G.open(f.env,f.a,{requestId:rid(),giftId:id,reward:'guaranteed_scroll_w',chance:1},T,()=>.5);assert.deepEqual(r.result.items,{scroll_w:2,scroll_a:2});});
test('concurrent opening of one gift never creates two rewards or consumes another gift',async t=>{const f=await fixture(t);f.add(8);const id=(await G.claim(f.env,f.a,{requestId:rid()},T)).result.giftIds[0],r=await Promise.allSettled([G.open(f.env,f.a,{requestId:rid(),giftId:id},T,()=>0),G.open(f.env,f.a,{requestId:rid(),giftId:id},T,()=>0)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(qty(f,G.GIFT_ITEM),1);assert.equal(qty(f,'guaranteed_scroll_w'),1);assert.equal((await G.summary(f.env,f.a)).opened,1);});
test('simultaneous retries replay either committed winner without drawing a second accumulated gift',async t=>{
 for(const winner of ['weapon','scrolls']){
  const f=await fixture(t);f.add(8);await G.claim(f.env,f.a,{requestId:rid()},T);
  // SHA-256 requests may finish in either order on different runtimes. Force
  // both transactions to reach commit, then exercise each legitimate winner.
  const batch=f.env.DB.batch.bind(f.env.DB);let arrivals=0,releaseBoth,releaseLoser;
  const both=new Promise(resolve=>releaseBoth=resolve),committed=new Promise(resolve=>releaseLoser=resolve);
  f.env.DB.batch=async stmts=>{
   const update=stmts.find(s=>s.sql.startsWith("UPDATE rpg_fate_gifts SET status='opened'"));
   if(!update)return batch(stmts);
   const award=Object.hasOwn(JSON.parse(update.params[0]),'guaranteed_scroll_w')?'weapon':'scrolls';
   if(++arrivals===2)releaseBoth();await both;
   if(award!==winner)await committed;
   try{return await batch(stmts);}finally{if(award===winner)releaseLoser();}
  };
  const b={requestId:rid()},r=await Promise.all([G.open(f.env,f.a,b,T,()=>0),G.open(f.env,f.a,b,T,()=>.5)]);
  assert.equal(arrivals,2);assert.deepEqual(r[0].result,r[1].result);assert.equal(r[0].result.reward,winner);
  assert.equal(r.filter(x=>x.replayed).length,1);assert.equal(qty(f,G.GIFT_ITEM),1);
  assert.equal(qty(f,'guaranteed_scroll_w'),winner==='weapon'?1:0);
  assert.equal(qty(f,'scroll_w'),winner==='scrolls'?2:0);assert.equal(qty(f,'scroll_a'),winner==='scrolls'?2:0);
  assert.equal(f.one("SELECT COUNT(*) n FROM rpg_fate_gifts WHERE status='opened'").n,1);
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_gift_operations WHERE request_id=?',b.requestId).n,1);
 }
});
test('failed inventory consumption rolls back gift status, reward, ledger and receipt together',async t=>{const f=await fixture(t);f.add(4);const id=(await G.claim(f.env,f.a,{requestId:rid()},T)).result.giftIds[0];f.exec('UPDATE rpg_inventory SET quantity=0 WHERE tg_id=? AND item=?',f.a,G.GIFT_ITEM);const b={requestId:rid(),giftId:id},ledgers=f.one('SELECT COUNT(*) n FROM rpg_ledger').n;await assert.rejects(G.open(f.env,f.a,b,T,()=>0));assert.equal(f.one('SELECT status FROM rpg_fate_gifts WHERE id=?',id).status,'claimed');assert.equal(qty(f,'guaranteed_scroll_w'),0);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_ledger').n,ledgers);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_gift_operations WHERE request_id=?',b.requestId).n,0);});

// Pause AFTER the initial receipt read, BEFORE open() reads any gift. This is
// earlier than the batch/commit race above and must work even for the last box.
function pauseFirstReceipt(db){
 const prepare=db.prepare.bind(db);let paused=false,resume,arrive;
 const reached=new Promise(r=>arrive=r),gate=new Promise(r=>resume=r);
 db.prepare=sql=>{
  const stmt=prepare(sql);if(!sql.startsWith('SELECT payload_hash,result_json FROM rpg_fate_gift_operations'))return stmt;
  const bind=stmt.bind.bind(stmt);stmt.bind=(...params)=>{
   const bound=bind(...params),first=bound.first.bind(bound);
   bound.first=async()=>{const row=await first();if(!paused){paused=true;arrive();await gate;}return row;};return bound;
  };return stmt;
 };
 return {reached,resume:()=>resume()};
}
for(const explicit of [false,true])for(const boxes of [1,3])test(`receipt-read overlap replays the same open: explicit=${explicit}, boxes=${boxes}`,async t=>{
 const f=await fixture(t);f.add(boxes*4);const ids=(await G.claim(f.env,f.a,{requestId:rid()},T)).result.giftIds;
 const body={requestId:rid(),...(explicit?{giftId:ids[0]}:{})},pause=pauseFirstReceipt(f.env.DB);
 let losingDraws=0;const pending=G.open(f.env,f.a,body,T+1,()=>{losingDraws++;return 0;});
 await pause.reached;
 let winner;try{winner=await G.open(f.env,f.a,body,T+2,()=>.5);}finally{pause.resume();}
 const replay=await pending;assert.equal(replay.replayed,true);assert.deepEqual(replay.result,winner.result);
 if(boxes===1)assert.equal(losingDraws,0,'empty gift lookup must recover without drawing');
 assert.equal(qty(f,G.GIFT_ITEM),boxes-1);assert.equal(qty(f,'guaranteed_scroll_w'),0);assert.equal(qty(f,'scroll_w'),2);assert.equal(qty(f,'scroll_a'),2);
 assert.equal(f.one("SELECT COUNT(*) n FROM rpg_fate_gifts WHERE status='opened'").n,1);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_gift_operations WHERE request_id=?',body.requestId).n,1);
 assert.equal(f.one("SELECT COUNT(*) n FROM rpg_ledger WHERE type='開啟輪迴禮'").n,1);
 assert.equal(f.one("SELECT COUNT(*) n FROM rpg_ledger WHERE type='星輝匣獎勵'").n,2);
 const disconnectedRetry=await G.open(f.env,f.a,body,T+3,()=>{throw Error('must not draw on retry');});assert.deepEqual(disconnectedRetry.result,winner.result);
});
for(const variant of ['payload','character','request'])test(`receipt recovery preserves ${variant} isolation during the read gap`,async t=>{
 const f=await fixture(t);f.add(4);f.add(4,f.b);await G.claim(f.env,f.a,{requestId:rid()},T);await G.claim(f.env,f.b,{requestId:rid()},T);
 const body={requestId:rid()},pause=pauseFirstReceipt(f.env.DB);
 const pending=G.open(f.env,variant==='character'?f.b:f.a,body,T,()=>0);
 // Attach rejection handling before releasing the barrier.
 const observed=pending.then(value=>({value}),error=>({error}));await pause.reached;
 try{await G.open(f.env,f.a,{...body,...(variant==='payload'?{extra:1}:variant==='request'?{requestId:rid()}:{})},T,()=>.5);}finally{pause.resume();}
 const {error}=await observed;assert.equal(error?.code,variant==='request'?'fate_no_gift':'request_changed');
 assert.equal(qty(f,G.GIFT_ITEM),0);assert.equal(qty(f,G.GIFT_ITEM,f.b),1);assert.equal(qty(f,'guaranteed_scroll_w',f.b),0);
});
test('a committed batch with a lost acknowledgement returns its receipt; a real read error without one stays an error',async t=>{
 const f=await fixture(t);f.add(4);await G.claim(f.env,f.a,{requestId:rid()},T);
 const batch=f.env.DB.batch.bind(f.env.DB);f.env.DB.batch=async stmts=>{await batch(stmts);throw Error('acknowledgement lost');};
 const b={requestId:rid()},opened=await G.open(f.env,f.a,b,T,()=>.5);assert.equal(opened.replayed,true);assert.equal(qty(f,G.GIFT_ITEM),0);assert.equal(qty(f,'scroll_w'),2);
 f.env.DB.batch=batch;await assert.rejects(G.open(f.env,f.a,{requestId:rid()},T),e=>e.code==='fate_no_gift');
});
test('claim batches stay bounded and retain all remaining earned gifts',async t=>{const f=await fixture(t);f.add(108);const a=await G.claim(f.env,f.a,{requestId:rid()},T);assert.equal(a.result.claimed,25);assert.equal(a.result.remaining,2);const b=await G.claim(f.env,f.a,{requestId:rid()},T);assert.equal(b.result.claimed,2);assert.equal(qty(f,G.GIFT_ITEM),27);});
const TOKEN='123456789:FAKE_FATE_GIFT_TEST_TOKEN';
function initData(id){const fields={auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:Number(id),first_name:'星輝測試'})},key=createHmac('sha256','WebAppData').update(TOKEN).digest();return new URLSearchParams({...fields,hash:createHmac('sha256',key).update(Object.keys(fields).sort().map(k=>`${k}=${fields[k]}`).join('\n')).digest('hex')}).toString();}
function client(f){Object.assign(f.env,{BOT_TOKEN:TOKEN,SERVICE_SECRET:'gift-fake-service-secret',ENVIRONMENT:'development',ALLOW_DEBUG_TIME:'true'});return async(action,body={},signature=initData('101'))=>{const response=await handle(new CurrentClientRequest('https://game.test/app/api/'+action,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Init-Data':signature,'X-Debug-Now':String(T)},body:JSON.stringify(body)}),f.env);return {status:response.status,...await response.json()};};}
test('MiniApp gift routes require HMAC, mandatory stable UUID and selected-character ownership; forged counts and tgId cannot mint another role gift',async t=>{const f=await fixture(t),api=client(f);f.add(4);f.add(8,f.b);assert.equal((await api('fate/gifts/summary',{},'invalid')).status,401);assert.equal((await api('fate/gifts/summary',{},initData('999'))).error,'no_character');assert.equal((await api('select',{charId:f.a})).ok,true);assert.equal((await api('fate/gifts/claim',{selectedCharacterId:f.a})).error,'request');let s=await api('fate/gifts/summary',{tgId:f.b,completed:100,selectedCharacterId:f.a});assert.equal(s.completed,4);assert.equal(s.claimable,1);const body={requestId:rid(),selectedCharacterId:f.a,tgId:f.b,completed:999};const grant=await api('fate/gifts/claim',body);assert.equal(grant.ok,true,JSON.stringify(grant));assert.equal(grant.result.claimed,1);assert.equal(qty(f,G.GIFT_ITEM,f.a),1);assert.equal(qty(f,G.GIFT_ITEM,f.b),0);assert.deepEqual((await api('fate/gifts/claim',body)).result,grant.result);assert.equal((await api('select',{charId:f.b})).ok,true);assert.equal((await api('fate/gifts/open',{requestId:rid(),selectedCharacterId:f.a,giftId:grant.result.giftIds[0]})).error,'character_changed');assert.equal((await api('fate/gifts/open',{requestId:rid(),selectedCharacterId:f.b,giftId:grant.result.giftIds[0]})).error,'fate_no_gift');assert.equal(qty(f,G.GIFT_ITEM,f.a),1);assert.equal((await api('select',{charId:f.a})).ok,true);const openBody={requestId:rid(),selectedCharacterId:f.a,giftId:grant.result.giftIds[0]},opened=await api('fate/gifts/open',openBody);assert.equal(opened.ok,true,JSON.stringify(opened));assert.equal(qty(f,G.GIFT_ITEM),0);assert.deepEqual((await api('fate/gifts/open',openBody)).result,opened.result);for(const [item,n]of Object.entries(opened.result.items))assert.equal(qty(f,item),n);s=await api('fate/gifts/summary',{selectedCharacterId:f.a});assert.equal(s.opened,1);assert.equal(s.claimable,0);});
test('authenticated enhancement route retains the guaranteed flag, uses exactly one rare scroll, never buys ordinary scrolls and leaves no missing-flag regression',async t=>{const f=await fixture(t),api=client(f);await api('select',{charId:f.a});const eq=f.one("SELECT id FROM rpg_equipment WHERE tg_id=? AND slot='weapon'",f.a);f.exec('UPDATE rpg_equipment SET enhance_level=8 WHERE id=?',eq.id);f.exec('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,1)',f.a,'guaranteed_scroll_w');const gold=f.one('SELECT gold FROM rpg_characters WHERE tg_id=?',f.a).gold,normal=qty(f,'scroll_w'),r=await api('enhance',{requestId:rid(),itemId:eq.id,guaranteed:true,selectedCharacterId:f.a});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.result.result,'success');assert.equal(r.result.to,9);assert.deepEqual(r.result.used,{guaranteed_scroll_w:1});assert.equal(r.result.goldCost,0);assert.equal(qty(f,'guaranteed_scroll_w'),0);assert.equal(qty(f,'scroll_w'),normal);assert.equal(f.one('SELECT gold FROM rpg_characters WHERE tg_id=?',f.a).gold,gold);const fail=await api('enhance',{requestId:rid(),itemId:eq.id,guaranteed:true,selectedCharacterId:f.a});assert.equal(fail.error,'no_scroll');assert.equal(f.one('SELECT enhance_level FROM rpg_equipment WHERE id=?',eq.id).enhance_level,9);});
