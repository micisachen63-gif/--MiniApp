import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';const script=readFileSync(new URL('../public/operation-notices.js',import.meta.url),'utf8');function gate(storage,api,owner='111',scope={}){const context={window:{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},Date,Map,Set,Promise,Error};vm.runInNewContext(script,context);return context.window.RpgOperationNotices.create({api,owner:()=>owner,...scope});}
for(const kind of ['auto_enhance_end','guardian_auto','auto_reroll_end'])test(kind+' is closed once, stays closed offline/reload and routes to correct durable receipt',async()=>{const storage=new Map(),n={kind,refId:'job-notice-0001'},a=gate(storage,async()=>{throw Error('offline');});assert.equal(await a.dismiss(n),false);assert(a.hidden(n));let calls=0;const reloaded=gate(storage,async(action,b)=>{assert.equal(action,kind==='auto_enhance_end'?'notice/dismiss':'background/dismiss');assert.equal(b.kind,kind);calls++;return {ok:true};});assert(reloaded.hidden(n));await Promise.all([reloaded.flush(),reloaded.flush()]);assert.equal(calls,1);await reloaded.flush();assert.equal(calls,1);assert(!reloaded.hidden({...n,refId:'job-notice-0002'}));assert(!gate(storage,async()=>{},'222').hidden(n));});
test('more than500 pending offline closes are retained rather than silently resurrected',async()=>{const storage=new Map(),g=gate(storage,()=>{throw Error('offline');});for(let i=0;i<510;i++)await g.dismiss({kind:'auto_reroll_end',refId:'job-notice-'+String(i).padStart(8,'0')});assert.equal(Object.keys(JSON.parse(storage.get('rpgOperationNoticeDismissals'))).length,510);assert(gate(storage,async()=>{}).hidden({kind:'auto_reroll_end',refId:'job-notice-00000000'}));});

test('legacy permanent dismissals never hide or flush into a season with the same account and receipt ID',async()=>{
 const storage=new Map(),n={kind:'auto_reroll_end',refId:'job-notice-shared'},key='111:'+n.kind+':'+n.refId;
 storage.set('rpgOperationNoticeDismissals',JSON.stringify({[key]:{account:'111',kind:n.kind,refId:n.refId,at:1,pending:true}}));
 let realm='season_one',epoch=0;const calls=[],g=gate(storage,async()=>{calls.push(realm);},'111',{realmId:()=>realm,contextEpoch:()=>epoch});
 assert.equal(g.hidden(n),false);await g.flush();assert.deepEqual(calls,[]);
 await g.dismiss(n);assert.deepEqual(calls,['season_one']);assert.equal(g.hidden(n),true);
 let rows=JSON.parse(storage.get('rpgOperationNoticeDismissals'));assert.equal(rows[key].pending,true);assert.equal(rows['season_one:'+key].pending,false);
 realm='permanent';epoch++;await g.flush();assert.deepEqual(calls,['season_one','permanent']);rows=JSON.parse(storage.get('rpgOperationNoticeDismissals'));assert.equal(rows[key].pending,false);
});

test('a queued dismissal cannot run after a realm or epoch switch, and its original receipt remains retryable',async()=>{
 for(const mode of ['realm','epoch']){
  const storage=new Map(),n={kind:'guardian_auto',refId:'job-queued-notice'},calls=[];let realm='permanent',epoch=0;
  const g=gate(storage,async()=>{calls.push(realm);},'111',{realmId:()=>realm,contextEpoch:()=>epoch});
  const first=g.dismiss(n);if(mode==='realm')realm='season_one';else epoch++;
  assert.equal(await first,false);assert.deepEqual(calls,[]);
  realm='permanent';epoch++;await g.flush();assert.deepEqual(calls,['permanent']);
  assert.equal(JSON.parse(storage.get('rpgOperationNoticeDismissals'))['111:guardian_auto:job-queued-notice'].pending,false);
 }
});

test('late success and notice visibility from an old epoch cannot finish a new context',async()=>{
 const storage=new Map(),n={kind:'guardian_auto',refId:'job-inflight-notice'};let epoch=0,release,calls=0;
 const g=gate(storage,async()=>{calls++;return new Promise(done=>release=done);},'111',{contextEpoch:()=>epoch});
 const first=g.dismiss(n);await Promise.resolve();epoch++;release({ok:true});assert.equal(await first,false);
 assert.equal(JSON.parse(storage.get('rpgOperationNoticeDismissals'))['111:guardian_auto:job-inflight-notice'].pending,true);
 const retry=g.flush();await Promise.resolve();release({ok:true});await retry;assert.equal(calls,2);
 const visible=g.visible({...n,refId:'job-visible-notice'});epoch++;release({notice:{dismissed:false}});assert.equal(await visible,false);
});
