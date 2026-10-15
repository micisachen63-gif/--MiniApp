import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {drainInbox,inboxSummary,inspectUncertain,closeUncertain} from '../src/inbox.mjs';
function fixture(n=0){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE inbox(id INTEGER PRIMARY KEY,body TEXT,status TEXT,created INTEGER,finished INTEGER,last_error TEXT); CREATE TABLE operations(key TEXT PRIMARY KEY,value TEXT,at INTEGER); CREATE TABLE inbox_reviews(update_id INTEGER PRIMARY KEY,resolution TEXT,note TEXT,reviewed_at INTEGER);');
 const sql={exec(q,...args){const s=db.prepare(q);return {toArray:()=>s.all(...args)};}};
 // DO SQL executes eagerly; the returned cursor is only a view of its result.
 sql.exec=(q,...args)=>{const s=db.prepare(q);const rows=s.columns().length?s.all(...args):(s.run(...args),[]);return {toArray:()=>rows};};
 for(let id=1;id<=n;id++)sql.exec("INSERT INTO inbox(id,body,status,created) VALUES(?,?,'queued',?)",id,JSON.stringify({update_id:id}),1000);
 return {sql,db};
}
test('burst drains sequentially in ID order within the count bound, then becomes idle',async()=>{
 const {sql}=fixture(100),ids=[];let active=0;
 const bot={async handle(u){assert.equal(++active,1);ids.push(u.update_id);await Promise.resolve();active--;}};
 const first=await drainInbox(sql,bot,{now:()=>2000});assert.deepEqual(first,{processed:16,backlog:84});
 for(let i=0;i<6;i++)await drainInbox(sql,bot,{now:()=>2000});
 assert.deepEqual(ids,Array.from({length:100},(_,i)=>i+1));assert.equal(inboxSummary(sql,3000).queued,0);
 assert.deepEqual(await drainInbox(sql,bot),{processed:0,backlog:0});
});
test('time budget yields after slow work without dropping queued updates',async()=>{
 const {sql}=fixture(8);let time=0;
 const r=await drainInbox(sql,{handle:async()=>{time+=2600;}},{now:()=>time});assert.equal(r.processed,2);assert.equal(r.backlog,6);
 assert.equal(inboxSummary(sql,9000).oldestQueuedMs,8000);
});
test('ambiguous update is never automatically replayed; later queued updates still progress',async()=>{
 const {sql}=fixture(3),seen=[];const bot={handle:async u=>{seen.push(u.update_id);if(u.update_id===1)throw Object.assign(Error('lost'),{code:'network'});}};
 await drainInbox(sql,bot);await drainInbox(sql,bot);assert.deepEqual(seen,[1,2,3]);assert.equal(inboxSummary(sql).uncertain,1);
 const rows=inspectUncertain(sql);assert.equal(rows[0].receiptState,'manual_verification_required');assert.equal(rows[0].messageState,'delivery_unconfirmed');assert.ok(!('body' in rows[0]));
});
test('inspection reconciles known game receipts without exposing bodies or retrying Telegram sends',async()=>{
 const {sql}=fixture(1);await drainInbox(sql,{handle:async()=>{throw Error('lost');}});
 sql.exec('INSERT INTO operations VALUES(?,?,?)','update:1:/rpg/buy:1',JSON.stringify({path:'/rpg/buy',body:{secret:'private'},status:'done',requestId:'original-id',value:{private:'result'}}),2000);
 const row=inspectUncertain(sql)[0];assert.equal(row.receiptState,'game_results_known');assert.deepEqual(row.operations,[{key:'update:1:/rpg/buy:1',path:'/rpg/buy',requestId:'original-id',status:'done',errorCode:null}]);
 assert.throws(()=>closeUncertain(sql,{updateId:1,resolution:'verified',note:'short',expectedError:'Error'}));
 assert.throws(()=>closeUncertain(sql,{updateId:1,resolution:'verified',note:'已人工核對玩家資產與操作紀錄',expectedError:'changed'}));
 assert.equal(closeUncertain(sql,{updateId:1,resolution:'verified',note:'已人工核對玩家資產與操作紀錄',expectedError:'Error'},3000).replayed,false);
 assert.equal(inspectUncertain(sql).length,0);assert.equal(sql.exec('SELECT note FROM inbox_reviews').toArray().length,1);
 assert.throws(()=>closeUncertain(sql,{updateId:1,resolution:'verified',note:'已人工核對玩家資產與操作紀錄',expectedError:'Error'}));
 assert.throws(()=>inspectUncertain(sql,{limit:100}));
});
