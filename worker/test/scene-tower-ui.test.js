import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/scene-tower-ui.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const drain=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture({char='a',account='u',realm='permanent',revision=1}={}){
 return {ok:true,accountId:account,realmId:realm,characterId:char,character:{tgId:char,name:'登塔旅人',level:120,revision},now:1793822400000,readOnly:false,active:null,party:null,
  tower:{canOperate:true,blockedReason:null,badges:1000,best:20,title:null,daily:{used:false,day:'2026-11-05',resetAt:1793894400000},areas:[],
   equipment:[{id:'helm-a',name:'星穹頭盔',enhance:9,statName:'防禦',stat:121,equipped:false,canImprint:true,imprintReason:null,towerImprint:{level:0,max:5,bonusPct:0,nextStat:123,cost:10}},
    {id:'helm-worn',name:'穿戴頭盔',enhance:4,statName:'防禦',stat:88,equipped:true,canImprint:false,imprintReason:{code:'equipped',message:'請先卸下裝備'},towerImprint:{level:0,max:5,bonusPct:0,nextStat:89,cost:10}}],
   offers:[{id:'scroll-r',name:'紅色卷軸',item:'scroll_red',quantity:2,cost:20,canRedeem:true,reason:null}],
   titles:[{id:'tower-10',name:'逐星者',floor:10,unlocked:true,canEquip:true,reason:null},{id:'tower-30',name:'登頂者',floor:30,unlocked:false,canEquip:false,reason:{code:'locked',message:'尚未通關第 30 層'}}]}};
}
function harness(extra={}){
 const sandbox={AbortController,console,...extra};vm.runInNewContext(source,sandbox,{filename:'scene-tower-ui.js'});
 const values=new Map(),calls=[],events=[],changed=[];let context={accountId:'u',realmId:'permanent',characterId:'a',epoch:0};
 const host={getContext:()=>({...context}),current:()=>true,storage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},
  onState:s=>events.push({revision:s.revision,busy:s.busy,stale:s.stale}),onChanged:value=>changed.push(plain(value)),
  request:(action,body,options)=>{const d=deferred();calls.push({action,body:plain(body),options,...d});return d.promise;}};
 return {api:sandbox.RpgSceneTower,host,calls,events,changed,values,create:()=>sandbox.RpgSceneTower.createClient(host),setContext:c=>{context={...context,...c};}};
}
async function read(h,c,data=fixture()){
 const result=c.refresh();assert.equal(h.calls.at(-1).action,'tower/scene');h.calls.at(-1).resolve(data);assert.equal(await result,true);
}
function matchingResult(record){
 const b=record.body;
 if(b.op==='imprint')return {op:b.op,itemId:b.itemId,from:b.from,to:b.from+1,cost:10};
 if(b.op==='redeem')return {op:b.op,item:'scroll_red',quantity:2,cost:20};
 return {op:b.op,title:b.titleId?{id:b.titleId,name:'逐星者'}:null,cost:0};
}
function receipt(record,{found=true,result=matchingResult(record),...overrides}={}){
 return {ok:true,accountId:'u',realmId:'permanent',characterId:'a',now:1793822400000,requestId:record.id,found,
  result:found?result:null,receipt:found?{createdAt:1793822400000,type:'tower_'+record.body.op,item:'tower_fragment',itemDelta:-result.cost}:null,...overrides};
}
async function unknown(h,c,body={op:'imprint',itemId:'helm-a',from:0},label='刻下第 1 階塔印',details='+9 星穹頭盔，防禦 121 → 123。消耗 10 枚徽記。'){
 const result=c.execute(body,label,details);assert.equal(h.calls.at(-1).action,'tower/action');h.calls.at(-1).reject(Error('lost response'));
 assert.equal(await result,false);return plain(c.pending());
}
async function check(h,c,value,snapshot=fixture()){
 const result=c.checkPending();assert.equal(h.calls.at(-1).action,'tower/scene');h.calls.at(-1).resolve(snapshot);await drain();
 assert.equal(h.calls.at(-1).action,'tower/receipt');h.calls.at(-1).resolve(value);return result;
}

test('workshop opens and refreshes through the pure projection; frozen realms stay readable without sending a mutation',async()=>{
 const h=harness(),c=h.create(),data=fixture();data.readOnly=true;data.readOnlyReason='賽季結算中';await read(h,c,data);
 assert.equal(await c.execute({op:'imprint',itemId:'helm-a',from:0},'塔印'),false);
 assert.match(c.state.error,/賽季結算/);assert.deepEqual(h.calls.map(x=>x.action),['tower/scene']);assert.equal(c.pending(),null);c.dispose();
});
test('unknown imprint redemption and title operations retain their exact raw request body across reopen and ordinary refresh',async t=>{
 for(const body of [{op:'imprint',itemId:'helm-a',from:0},{op:'redeem',offerId:'scroll-r'},{op:'title',titleId:'tower-10'}])await t.test(body.op,async()=>{
  const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c,body);
  assert.deepEqual(record.body,{...body,requestId:record.id});assert.ok(!record.id.startsWith('app:'));assert.equal(c.acknowledge(),false);
  c.dispose();const reopened=h.create();assert.equal(reopened.pending().id,record.id);await read(h,reopened,fixture({revision:2}));
  assert.equal(reopened.acknowledge(),false);assert.equal(await reopened.execute(body,'第二筆操作'),false);
  assert.equal(h.calls.filter(x=>x.action==='tower/action').length,1);assert.equal(h.calls.filter(x=>x.action==='tower/receipt').length,0);reopened.dispose();
 });
});
test('a matching pure receipt reveals the committed result but requires explicit acknowledgement to clear pending',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c);
 assert.equal(await check(h,c,receipt(record)),true);assert.deepEqual(h.calls.at(-1).body,record.body);
 assert.equal(c.pending().id,record.id);assert.equal(c.state.checkedPending,record.id);
 await read(h,c,fixture({revision:2}));assert.equal(c.pending().id,record.id);
 assert.equal(c.acknowledge(),true);assert.equal(c.pending(),null);
 assert.equal(h.calls.filter(x=>x.action==='tower/action').length,1);assert.equal(h.calls.filter(x=>x.action==='tower/receipt').length,1);c.dispose();
});
test('not found never clears or replays the original operation; cancelling recovery keeps the original warning and cost',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c);
 assert.equal(c.prepareRecovery(),false);assert.equal(await check(h,c,receipt(record,{found:false})),true);
 assert.equal(c.pending().id,record.id);assert.equal(c.acknowledge(),false);assert.equal(c.prepareRecovery(),true);
 assert.match(c.state.confirm.details,/\+9 星穹頭盔/);assert.match(c.state.confirm.details,/10 枚徽記/);assert.match(c.state.confirm.details,/完全相同/);
 c.cancel();assert.equal(c.state.confirm,null);assert.equal(c.pending().id,record.id);assert.equal(h.calls.filter(x=>x.action==='tower/action').length,1);
 await read(h,c,fixture({revision:2}));assert.equal(c.pending().id,record.id);assert.equal(h.calls.filter(x=>x.action==='tower/action').length,1);c.dispose();
});
test('explicit recovery sends the exact original ID and signature once; another lost response retains the same pending',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c,{op:'redeem',offerId:'scroll-r'},'兌換紅色卷軸','20 枚徽記，2 張紅色卷軸。');
 await check(h,c,receipt(record,{found:false}));assert.equal(c.prepareRecovery(),true);
 const retry=c.submit();assert.equal(h.calls.at(-1).action,'tower/action');assert.deepEqual(h.calls.at(-1).body,record.body);
 h.calls.at(-1).reject(Error('retry response lost'));assert.equal(await retry,false);
 assert.deepEqual(plain(c.pending()),record);assert.equal(c.prepareRecovery(),false);assert.equal(h.calls.filter(x=>x.action==='tower/action').length,2);
 await check(h,c,receipt(record));assert.equal(c.acknowledge(),true);assert.equal(h.calls.filter(x=>x.action==='tower/action').length,2);c.dispose();
});
test('a successful same-ID manual recovery stays acknowledged even if its follow-up projection fails',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c);
 await check(h,c,receipt(record,{found:false}));c.prepareRecovery();const retry=c.submit();
 h.calls.at(-1).resolve({ok:true,tower:{},result:matchingResult(record)});await drain();
 assert.equal(h.calls.at(-1).action,'tower/scene');h.calls.at(-1).reject(Error('read offline'));
 assert.equal(await retry,true);assert.equal(c.pending(),null);assert.equal(c.state.stale,true);assert.match(c.state.notice,/已完成/);
 assert.equal(h.changed.length,1);assert.equal(h.calls.filter(x=>x.action==='tower/action').length,2);c.dispose();
});
test('a definite failure of manual recovery cannot erase an older request that may still commit',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c);
 await check(h,c,receipt(record,{found:false}));c.prepareRecovery();const retry=c.submit();
 h.calls.at(-1).reject(Object.assign(Error('裝備已鎖定'),{status:409,code:'locked',uncertain:false}));
 assert.equal(await retry,false);assert.equal(c.pending().id,record.id);assert.equal(h.calls.at(-1).action,'tower/action');
 await check(h,c,receipt(record));assert.equal(c.acknowledge(),true);c.dispose();
});
test('an initial definite validation failure is cleared and read once, with no automatic retry',async()=>{
 const h=harness(),c=h.create();await read(h,c);const result=c.execute({op:'imprint',itemId:'helm-a',from:0},'塔印');
 h.calls.at(-1).reject(Object.assign(Error('徽記不足'),{status:400,code:'badges',uncertain:false}));await drain();
 assert.equal(h.calls.at(-1).action,'tower/scene');h.calls.at(-1).resolve(fixture());assert.equal(await result,false);assert.equal(c.pending(),null);
 assert.match(c.state.error,/徽記不足/);assert.deepEqual(h.calls.map(x=>x.action),['tower/scene','tower/action','tower/scene']);c.dispose();
});
test('wrong receipt identities targets and ledger debits never clear pending or authorize recovery',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c),good=receipt(record);
 const variants=[{requestId:'unrelated-request'},{accountId:'other'},{realmId:'other'},{characterId:'other'},
  {result:{...good.result,itemId:'other-item'}},{result:{...good.result,from:1,to:2}},{result:{...good.result,op:'redeem'}},
  {receipt:{...good.receipt,item:'gold'}},{receipt:{...good.receipt,itemDelta:-999}},{found:false,result:good.result,receipt:null}];
 for(const variant of variants){assert.equal(await check(h,c,{...good,...variant}),false);assert.equal(c.pending().id,record.id);assert.equal(c.acknowledge(),false);assert.equal(c.prepareRecovery(),false);}
 assert.equal(h.calls.filter(x=>x.action==='tower/action').length,1);c.dispose();
});
test('a receipt signature error preserves the original body and does not grant a manual replay',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c);
 const result=c.checkPending();h.calls.at(-1).resolve(fixture());await drain();h.calls.at(-1).reject(Object.assign(Error('request_reused'),{status:409,code:'request_reused'}));
 assert.equal(await result,false);assert.deepEqual(plain(c.pending()),record);assert.equal(c.prepareRecovery(),false);assert.equal(c.acknowledge(),false);c.dispose();
});
test('malformed action successes and wrong redemption items remain uncertain',async t=>{
 for(const [body,result] of [
  [{op:'imprint',itemId:'helm-a',from:0},{op:'imprint',itemId:'wrong',from:0,to:1,cost:10}],
  [{op:'redeem',offerId:'scroll-r'},{op:'redeem',item:'wrong-scroll',quantity:2,cost:20}],
  [{op:'title',titleId:'tower-10'},{op:'title',title:{id:'tower-30'},cost:0}]
 ])await t.test(body.op,async()=>{const h=harness(),c=h.create();await read(h,c);const request=c.execute(body,'操作');
  h.calls.at(-1).resolve({ok:true,tower:{},result});assert.equal(await request,false);assert.ok(c.pending());assert.equal(c.acknowledge(),false);assert.equal(h.calls.length,2);c.dispose();});
});
test('late A-to-B-to-A projections cannot replace the new panel even when abort is ignored',async()=>{
 const h=harness(),old=h.create(),pending=old.refresh(),call=h.calls.at(-1);
 h.setContext({characterId:'b',epoch:1});h.setContext({characterId:'a',epoch:2});const fresh=h.create();await read(h,fresh,fixture({revision:7}));
 call.resolve(fixture({revision:1}));assert.equal(await pending,false);assert.equal(old.state.data,null);assert.equal(fresh.state.revision,7);old.dispose();fresh.dispose();
});
test('late successful and definite-failed writes from a prior epoch leave the pending warning owned by the new A panel',async t=>{
 for(const outcome of ['success','failure'])await t.test(outcome,async()=>{
  const h=harness(),old=h.create();await read(h,old);const pending=old.execute({op:'imprint',itemId:'helm-a',from:0},'塔印'),call=h.calls.at(-1),record=plain(old.pending());
  h.setContext({characterId:'b',epoch:1});h.setContext({characterId:'a',epoch:2});const fresh=h.create();await read(h,fresh,fixture({revision:3}));
  if(outcome==='success')call.resolve({ok:true,tower:{},result:matchingResult(record)});else call.reject(Object.assign(Error('locked'),{status:409,code:'locked',uncertain:false}));
  assert.equal(await pending,false);assert.equal(fresh.pending().id,record.id);assert.equal(fresh.acknowledge(),false);assert.equal(h.calls.filter(x=>x.action==='tower/action').length,1);old.dispose();fresh.dispose();
 });
});
test('a late receipt from a previous epoch cannot unlock a newly opened A workshop',async()=>{
 const h=harness(),old=h.create();await read(h,old);const record=await unknown(h,old);
 const pending=old.checkPending();h.calls.at(-1).resolve(fixture());await drain();const call=h.calls.at(-1);
 h.setContext({characterId:'b',epoch:1});h.setContext({characterId:'a',epoch:2});const fresh=h.create();await read(h,fresh,fixture({revision:5}));
 call.resolve(receipt(record));assert.equal(await pending,false);assert.equal(fresh.pending().id,record.id);assert.equal(fresh.acknowledge(),false);old.dispose();fresh.dispose();
});
test('older revisions mismatched identities and superseded reads keep the latest valid projection',async()=>{
 const h=harness(),c=h.create();await read(h,c,fixture({revision:5}));
 for(const data of [fixture({revision:4}),fixture({revision:6,account:'other'}),fixture({revision:6,realm:'other'}),fixture({revision:6,char:'other'})]){
  const result=c.refresh();h.calls.at(-1).resolve(data);assert.equal(await result,false);assert.equal(c.state.revision,5);assert.equal(c.state.stale,true);
 }
 const old=c.refresh(),oldCall=h.calls.at(-1);const recent=c.refresh();h.calls.at(-1).resolve(fixture({revision:7}));assert.equal(await recent,true);
 oldCall.resolve(fixture({revision:6}));assert.equal(await old,false);assert.equal(c.state.revision,7);c.dispose();
});
test('a changed quote invalidates confirmation and a higher live revision blocks receipt acknowledgement until refreshed',async()=>{
 const h=harness(),c=h.create();await read(h,c);assert.equal(c.prepare({op:'imprint',itemId:'helm-a',from:0},'塔印','10 徽記'),true);
 const changed=fixture({revision:2});changed.tower.badges=900;await read(h,c,changed);assert.equal(c.state.confirm,null);assert.equal(await c.submit(),false);
 const record=await unknown(h,c);const pending=c.checkPending();h.calls.at(-1).resolve(changed);await drain();
 c.update({accountId:'u',realmId:'permanent',characterId:'a',live:{revision:3}});h.calls.at(-1).resolve(receipt(record));assert.equal(await pending,true);
 assert.equal(c.acknowledge(),false);await read(h,c,fixture({revision:3}));assert.equal(c.acknowledge(),true);c.dispose();
});
test('read-only or stale data blocks same-ID recovery even after a not-found receipt',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c);await check(h,c,receipt(record,{found:false}));
 const frozen=fixture({revision:2});frozen.readOnly=true;frozen.readOnlyReason='世界封存';await read(h,c,frozen);assert.equal(c.prepareRecovery(),false);
 const readback=c.refresh();h.calls.at(-1).reject(Error('offline'));assert.equal(await readback,false);assert.equal(c.prepareRecovery(),false);
 assert.equal(c.pending().id,record.id);assert.equal(h.calls.filter(x=>x.action==='tower/action').length,1);c.dispose();
});
test('stored requests with foreign identity or altered allowed fields are not replayable',async()=>{
 for(const alter of [r=>({...r,scope:'other'}),r=>({...r,body:{...r.body,namespace:'cli'}}),r=>({...r,body:{...r.body,requestId:'other-id'}}),r=>({...r,id:'x'.repeat(65),body:{...r.body,requestId:'x'.repeat(65)}})]){
  const first=harness(),c=first.create();await read(first,c);const record=await unknown(first,c);const [key]=first.values.keys();c.dispose();
  const next=harness();next.values.set(key,JSON.stringify(alter(record)));const fresh=next.create();assert.equal(fresh.pending(),null);assert.equal(fresh.prepareRecovery(),false);assert.equal(next.calls.length,0);fresh.dispose();
 }
});

class WorkshopRoot {
 constructor(){this.isConnected=true;this.scrollTop=0;this.reveals=0;this.focuses=[];this.events=new Map();this.controls=[];this.html='';this.pendingPanel=null;
  this.ownerDocument={body:{kind:'body'},documentElement:{kind:'html'},hidden:false,addEventListener(){},removeEventListener(){}};this.ownerDocument.activeElement=this.ownerDocument.body;}
 contains(node){return node?.root===this&&this.controls.includes(node);}
 addEventListener(kind,fn){this.events.set(kind,fn);}
 removeEventListener(kind){this.events.delete(kind);}
 get innerHTML(){return this.html;}
 set innerHTML(html){
  if(this.contains(this.ownerDocument.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;
  this.html=html;this.controls=[];const start=html.indexOf('data-st-pending'),end=start<0?-1:html.indexOf('</section>',start);
  this.pendingPanel=start<0?null:{scrollIntoView:options=>{this.reveals++;this.scrollTop=0;this.lastScrollOptions=options;}};
  for(const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
   const attributes=match[1],dataset={};for(const a of attributes.matchAll(/\bdata-([a-z0-9-]+)="([^"]*)"/g))dataset[a[1].replace(/-([a-z])/g,(_,v)=>v.toUpperCase())]=a[2];
   const root=this,inPending=match.index>start&&match.index<end;
   this.controls.push({root,name:'',dataset,disabled:/(?:^|\s)disabled(?:\s|$)/.test(attributes),
    closest(selector){return selector==='[data-st-action]'?this:selector==='[data-st-pending]'&&inPending?root.pendingPanel:null;},
    focus(){if(this.disabled)return;root.ownerDocument.activeElement=this;root.focuses.push({...dataset});}});
  }
 }
 querySelector(selector){if(selector==='[data-st-pending]')return this.pendingPanel;const action=selector.match(/^\[data-st-action="([^"]+)"\]$/)?.[1];return action?this.button(action):null;}
 querySelectorAll(selector){return selector==='button,select'?this.controls:[];}
 button(action,fields={}){return this.controls.find(b=>b.dataset.stAction===action&&Object.entries(fields).every(([k,v])=>b.dataset[k]===String(v)));}
 async click(action,fields={}){const target=this.button(action,fields);assert.ok(target,'missing control '+action);return this.events.get('click')?.({target});}
}
async function mountHarness(data=fixture()){
 const frames=new Map(),intervals=new Map();let next=0;
 const h=harness({requestAnimationFrame(fn){const id=++next;frames.set(id,{fn,cancelled:false});return id;},cancelAnimationFrame(id){if(frames.has(id))frames.get(id).cancelled=true;},
  setInterval(fn){const id=++next;intervals.set(id,fn);return id;},clearInterval(id){intervals.delete(id);}});
 const root=new WorkshopRoot(),view=h.api.mount(root,h.host);h.calls.at(-1).resolve(data);await drain();
 return {h,root,view,frames,intervals,flush(ignoreCancel=false){const batch=[...frames.values()];frames.clear();for(const f of batch)if(ignoreCancel||!f.cancelled)f.fn();}};
}
async function lostImprint(m){
 await m.root.click('imprint',{itemId:'helm-a'});assert.equal(m.root.ownerDocument.activeElement.dataset.stAction,'cancel');
 const pending=m.root.click('confirm');m.h.calls.at(-1).reject(Error('lost write response'));await pending;await drain();
 return JSON.parse([...m.h.values.values()][0]);
}
test('unknown workshop recovery is revealed only once per pending operation and polling preserves user focus and scroll',async()=>{
 const m=await mountHarness();await lostImprint(m);m.flush();assert.equal(m.root.reveals,1);assert.equal(m.root.ownerDocument.activeElement.dataset.stAction,'check-pending');
 assert.deepEqual(plain(m.root.lastScrollOptions),{block:'nearest',behavior:'auto'});
 m.root.scrollTop=480;m.root.button('tab',{tab:'titles'}).focus();[...m.intervals.values()][0]();assert.equal(m.h.calls.at(-1).action,'tower/scene');
 m.h.calls.at(-1).resolve(fixture());await drain();m.flush();assert.equal(m.root.reveals,1);assert.equal(m.root.scrollTop,480);assert.equal(m.root.ownerDocument.activeElement.dataset.tab,'titles');
 assert.equal(m.h.calls.filter(x=>x.action==='tower/action').length,1);m.view.dispose();
});
test('queued workshop recovery cannot steal focus after dispose context change or detachment even if RAF cancellation is ignored',async t=>{
 for(const kind of ['dispose','context','detached'])await t.test(kind,async()=>{
  const m=await mountHarness();await lostImprint(m);assert.ok(m.frames.size);const outside={kind:'new-window'};m.root.ownerDocument.activeElement=outside;
  if(kind==='dispose')m.view.dispose();if(kind==='context')m.h.setContext({characterId:'b',epoch:1});if(kind==='detached')m.root.isConnected=false;
  m.flush(true);assert.equal(m.root.reveals,0);assert.equal(m.root.ownerDocument.activeElement,outside);m.view.dispose();
 });
});
test('normal confirmation defaults to cancel and cancellation sends nothing; locked items and titles stay disabled',async()=>{
 const data=fixture();data.tower.equipment[0].canImprint=false;data.tower.equipment[0].imprintReason={code:'trade',message:'交易中的裝備不可淬鍊'};
 const m=await mountHarness(data);assert.equal(m.root.button('imprint',{itemId:'helm-a'}).disabled,true);assert.match(m.root.html,/交易中的裝備/);
 await m.root.click('tab',{tab:'titles'});assert.equal(m.root.button('title',{titleId:'tower-30'}).disabled,true);
 await m.root.click('tab',{tab:'offers'});await m.root.click('redeem',{offerId:'scroll-r'});assert.equal(m.root.ownerDocument.activeElement.dataset.stAction,'cancel');
 assert.match(m.root.html,/20 枚星穹徽記/);await m.root.click('cancel');assert.equal(m.root.ownerDocument.activeElement.dataset.stAction,'redeem');assert.equal(m.root.ownerDocument.activeElement.dataset.offerId,'scroll-r');assert.equal(m.h.calls.filter(x=>x.action==='tower/action').length,0);m.view.dispose();
});

test('coerced or unsafe costs and ledger amounts never count as a matching successful operation',async()=>{
 for(const cost of [null,'',false,'10',1.5,Number.MAX_SAFE_INTEGER+1,-1]){
  const h=harness(),c=h.create();await read(h,c);const pending=c.execute({op:'imprint',itemId:'helm-a',from:0},'塔印');
  h.calls.at(-1).resolve({ok:true,tower:{},result:{op:'imprint',itemId:'helm-a',from:0,to:1,cost}});
  assert.equal(await pending,false);assert.ok(c.pending());assert.equal(h.calls.length,2);c.dispose();
 }
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c),good=receipt(record);
 assert.equal(await check(h,c,{...good,receipt:{...good.receipt,itemDelta:'-10'}}),false);assert.equal(c.pending().id,record.id);c.dispose();
});

test('cancelling original-ID recovery and using Back return focus to the original retry button without another POST',async()=>{
 const m=await mountHarness(),record=await lostImprint(m);m.flush();
 const lookup=m.root.click('check-pending');m.h.calls.at(-1).resolve(fixture());await drain();m.h.calls.at(-1).resolve(receipt(record,{found:false}));await lookup;
 await m.root.click('retry');assert.equal(m.root.ownerDocument.activeElement.dataset.stAction,'cancel');
 await m.root.click('cancel');assert.equal(m.root.ownerDocument.activeElement.dataset.stAction,'retry');
 await m.root.click('retry');assert.equal(m.view.handleBack(),true);assert.equal(m.root.ownerDocument.activeElement.dataset.stAction,'retry');
 assert.equal(m.h.calls.filter(x=>x.action==='tower/action').length,1);assert.equal(JSON.parse([...m.h.values.values()][0]).id,record.id);m.view.dispose();
});
