import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {registerHooks} from 'node:module';

// Node doesn't load Cloudflare's CompiledWasm import syntax. Only that import is
// stubbed; this suite exercises the real entrypoint, coordinator and SQLite.
const hooks=registerHooks({load(url,context,next){return url.endsWith('/resvg.wasm')?{format:'module',source:'export default {};',shortCircuit:true}:next(url,context);}});
const {BotCoordinator}=await import('../src/coordinator.mjs');
const entry=(await import('../src/index.mjs')).default;
hooks.deregister();
function fixture(){
 const db=new DatabaseSync(':memory:');let alarm=null;
 const sql={exec(q,...args){const s=db.prepare(q),rows=s.columns().length?s.all(...args):(s.run(...args),[]);return {toArray:()=>rows};}};
 const storage={sql,getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;},deleteAlarm:async()=>{alarm=null;},transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const state={storage},env={SERVICE_SECRET:'offline-admin-test-secret',BOT_TOKEN:'offline-unused'};
 let c=new BotCoordinator(state,env);env.BOT_COORDINATOR={idFromName:()=>0,get:()=>({fetch:r=>c.fetch(typeof r==='string'?new Request(r):r)})};
 return {db,sql,storage,env,get c(){return c;},restart(){c=new BotCoordinator(state,env);return c;},alarm:()=>alarm};
}
const request=(path,body)=>new Request('https://internal/'+path,{method:'POST',body:JSON.stringify(body)});
test('real coordinator deduplicates webhook updates and keeps an earlier wake scheduled during draining',async()=>{
 const f=fixture();f.c.set('enabled',true);
 await f.c.fetch(request('receive',{update_id:1}));await f.c.fetch(request('receive',{update_id:1}));
 assert.equal(f.sql.exec('SELECT COUNT(*) n FROM inbox').toArray()[0].n,1);
 const seen=[];let ticks=0;f.c.init=async()=>({async handle(u){seen.push(u.update_id);if(u.update_id===1)await f.c.fetch(request('receive',{update_id:2}));},async tick(){ticks++;}});
 await f.c.alarm();assert.deepEqual(seen,[1,2]);assert.equal(ticks,1);assert.ok(f.alarm()<=Date.now()+200);
});
test('real coordinator schedules one-second backlog work and returns to ten-second idle cadence',async()=>{
 const f=fixture();f.c.set('enabled',true);
 for(let id=1;id<=18;id++)f.sql.exec("INSERT INTO inbox(id,body,status,created) VALUES(?,?,'queued',?)",id,JSON.stringify({update_id:id}),Date.now());
 let handled=0;f.c.init=async()=>({handle:async()=>handled++,tick:async()=>{}});
 let t=Date.now();await f.c.alarm();assert.equal(handled,16);assert.ok(f.alarm()>=t+1000&&f.alarm()<=Date.now()+1000);
 await f.storage.deleteAlarm();t=Date.now();await f.c.alarm();assert.equal(handled,18);assert.ok(f.alarm()>=t+10000&&f.alarm()<=Date.now()+10000);
});
test('restart retains unknown updates, authenticated inspection exposes no payloads, and manual closure is atomic',async()=>{
 const f=fixture();f.c.set('enabled',true);
 f.sql.exec("INSERT INTO inbox(id,body,status,created) VALUES(1,?,'running',?)",JSON.stringify({private:'hidden user message'}),Date.now());
 f.restart();assert.equal(f.sql.exec('SELECT status FROM inbox WHERE id=1').toArray()[0].status,'uncertain');
 const call=(body,secret=f.env.SERVICE_SECRET)=>entry.fetch(new Request('https://test/telegram/admin',{method:'POST',headers:{'X-Service-Secret':secret},body:JSON.stringify(body)}),f.env);
 assert.equal((await call({action:'inbox-inspect'},'wrong')).status,403);
 const report=await(await call({action:'inbox-inspect'})).json();assert.equal(report.items.length,1);assert.ok(!JSON.stringify(report).includes('hidden user message'));
 const b={action:'inbox-close',updateId:1,expectedError:report.items[0].last_error,resolution:'verified',note:'已離線核對原始操作收據及玩家資產'};
 const actual=f.c.sql;f.c.sql={exec(q,...args){if(q.startsWith("UPDATE inbox SET status='reviewed'"))throw Error('simulated storage failure');return actual.exec(q,...args);}};
 assert.equal((await call(b)).status,409);assert.equal(actual.exec('SELECT COUNT(*) n FROM inbox_reviews').toArray()[0].n,0);
 f.c.sql=actual;const r=await(await call(b)).json();assert.equal(r.ok,true);assert.equal(r.replayed,false);assert.equal((await call(b)).status,409);
 let sends=0;f.c.init=async()=>({handle:async()=>sends++,tick:async()=>{}});await f.c.alarm();assert.equal(sends,0);
});
