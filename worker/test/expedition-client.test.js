import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const requestSource=fs.readFileSync(new URL('../public/request-client.js',import.meta.url),'utf8');
const liveSource=fs.readFileSync(new URL('../public/expedition/live.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\nboot\(\);/,'\n');
const snapshot=gold=>({ok:true,character:{tgId:'111',gold},skills:[],inventory:{},special:{},eligible:[]});
const list=()=>({ok:true,parties:[],history:[],dungeons:[],active:null,groupActive:null});
const party=id=>({id,status:'combat',round:1,me:{},members:[]});
const response=j=>({status:200,json:async()=>j});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function setup(fetcher,{hash='#tower'}={}){
  const calls=[],storage=new Map(),timers=[],listeners=new Map(),windowListeners=new Map();
  let uuid=0,renders=0;
  const detail={open:false,addEventListener(){},close(){this.open=false;}};
  const document={hidden:false,querySelector:s=>s==='#detail'?detail:{addEventListener(){},textContent:'',hidden:false},querySelectorAll:()=>[],addEventListener:(event,fn)=>listeners.set(event,fn)};
  const window={addEventListener:(event,fn)=>windowListeners.set(event,fn),scrollTo(){}};
  const ctx=vm.createContext({window,document,parent:{Telegram:{WebApp:{initData:'fixture-auth'}}},location:{hash,origin:'https://fixture.invalid'},data:{skills:[]},heroArt(){},playCombat(){},combatView:p=>p,combatCursor:()=>null,dungeonTheme(){},AbortController,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},crypto:{randomUUID:()=>`uuid-${++uuid}`},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},setInterval:()=>1,clearInterval(){},fetch:async(url,options)=>{const body=JSON.parse(options.body),action=url.slice('/app/api/'.length),call={action,body,options};calls.push(call);return await fetcher(call);},Date,Promise,JSON});
  vm.runInContext(requestSource,ctx);
  vm.runInContext(liveSource+`\nrender=()=>{this.renderCount=(this.renderCount||0)+1;};toast=()=>{};this.h={api,refresh,poll,set:(s,p=null,id=null)=>{state=s;pinned=s?.character?.tgId||null;party=p;partyId=id;},select:(p,id)=>{party=p;partyId=id;},state:()=>state,party:()=>party,tab:()=>tab};`,ctx);
  return {h:ctx.h,ctx,calls,storage,timers,listeners,windowListeners,document,request:window.RpgRequest.request};
}

test('a stale round closes and refreshes tactics without resubmitting the old choice',async()=>{
 const s=setup(c=>c.action==='party/action'?{status:409,json:async()=>({ok:false,error:'round',message:'回合已改變'})}:response(c.action==='expedition/me'?snapshot(100):c.action==='party/list'?list():{ok:true,party:{...party('p1'),round:2}}));
 s.h.set(snapshot(100),party('p1'),'p1');s.document.querySelector('#detail').open=true;
 vm.runInContext('actionSheet=()=>{this.tacticsShown=(this.tacticsShown||0)+1;};',s.ctx);
 const button={dataset:{submit:'normal'},disabled:false,isConnected:true,hasAttribute:()=>false};await s.listeners.get('click')({target:{closest:()=>button}});
 assert.equal(s.calls.filter(c=>c.action==='party/action').length,1);assert.equal(s.calls[0].body.round,1);assert.equal(s.h.party().round,2);assert.equal(s.document.querySelector('#detail').open,false);assert.equal(s.ctx.tacticsShown,1);
});
test('expedition polling has one request in flight on a slow connection',async()=>{
  let resolve;
  const s=setup(()=>new Promise(r=>resolve=r));s.h.set(snapshot(100),party('p1'),'p1');
  const a=s.h.poll(),b=s.h.poll(),c=s.h.poll();
  assert.equal(a,b);assert.equal(a,c);assert.equal(s.calls.length,1);
  resolve(response({ok:true,party:{...party('p1'),round:2}}));await a;
  assert.equal(s.h.party().round,2);assert.equal(s.ctx.renderCount,1);
});

test('same-character response from before an operation cannot overwrite its result',async()=>{
  let resolveRead;
  const s=setup(c=>c.action==='expedition/me'?new Promise(r=>resolveRead=r):response({ok:true}));
  s.h.set(snapshot(100));const read=s.h.refresh(true);
  await s.h.api('expedition/action',{op:'redeem',skillId:'skill_01_1'});s.h.set(snapshot(90));
  resolveRead(response(snapshot(100)));await assert.rejects(read,e=>e.code==='stale_response');
  assert.equal(s.h.state().character.gold,90);assert.equal(s.calls.filter(c=>c.action==='party/list').length,0);
});

test('a party response cannot replace the newly selected party',async()=>{
  let resolve;
  const s=setup(()=>new Promise(r=>resolve=r));s.h.set(snapshot(100),party('p1'),'p1');
  const p=s.h.poll();s.h.select(party('p2'),'p2');resolve(response({ok:true,party:{...party('p1'),round:2}}));await p;
  assert.equal(s.h.party().id,'p2');assert.equal(s.ctx.renderCount||0,0);
});

test('read refreshes reuse one flight and an explicit full refresh still loads the list',async()=>{
  const resolvers=[];
  const s=setup(c=>c.action==='expedition/me'?new Promise(r=>resolvers.push(r)):response(list()));s.h.set(snapshot(100));
  const a=s.h.refresh(false),b=s.h.refresh(false),full=s.h.refresh(true);
  assert.equal(a,b);assert.equal(s.calls.length,1);
  resolvers.shift()(response(snapshot(100)));await a;await turn();
  assert.equal(s.calls.filter(c=>c.action==='expedition/me').length,2);
  resolvers.shift()(response(snapshot(100)));await full;
  assert.equal(s.calls.filter(c=>c.action==='party/list').length,1);
});

test('uncertain mutation keeps its request id for manual retry and clears it on success',async()=>{
  let mutations=0;
  const s=setup(c=>{
    if(c.action==='expedition/action'){if(++mutations===1)throw Error('network');return response(snapshot(90));}
    return response(c.action==='party/list'?list():snapshot(100));
  });s.h.set(snapshot(100));
  const body={op:'redeem',skillId:'skill_01_1'};
  await assert.rejects(s.h.api('expedition/action',body),e=>e.uncertain&&e.code==='request_uncertain');await turn();
  assert.equal(s.storage.size,1);assert.equal(mutations,1);
  await s.h.api('expedition/action',body);
  const ids=s.calls.filter(c=>c.action==='expedition/action').map(c=>c.body.requestId);
  assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(s.storage.size,0);
});

test('mutation timeout releases the operation and never retries a financial request',async()=>{
  const s=setup(c=>c.action==='boss-exchange'?new Promise((resolve,reject)=>c.options.signal.addEventListener('abort',()=>reject(Error('aborted')))):response(c.action==='party/list'?list():snapshot(100)));
  s.h.set(snapshot(100));const p=s.h.api('boss-exchange',{offer:'fragment'});
  assert.equal(s.timers[0].ms,20000);s.timers[0].fn();
  await assert.rejects(p,e=>e.uncertain&&e.code==='request_uncertain');await turn();
  assert.equal(s.calls.filter(c=>c.action==='boss-exchange').length,1);assert.equal(s.storage.size,1);
});

test('page hide aborts pending reads and prevents further polling',async()=>{
  const s=setup(c=>new Promise((resolve,reject)=>c.options.signal.addEventListener('abort',()=>reject(Error('aborted')))));
  s.h.set(snapshot(100),party('p1'),'p1');const pending=s.h.poll();s.windowListeners.get('pagehide')();await pending;await s.h.poll();
  assert.equal(s.calls.length,1);assert.equal(s.ctx.renderCount||0,0);
});

test('completed parties stop the five-second request loop',async()=>{
  const s=setup(()=>{throw Error('unexpected request');});s.h.set(snapshot(100),{...party('p1'),status:'won'},'p1');
  await s.h.poll();await s.h.poll();assert.equal(s.calls.length,0);
});

test('returning from the back-forward cache resumes a fresh state read',async()=>{
  const s=setup(c=>response(c.action==='party/list'?list():snapshot(90)));s.h.set(snapshot(100));
  s.windowListeners.get('pagehide')();s.windowListeners.get('pageshow')();await turn();
  assert.equal(s.h.state().character.gold,90);assert.equal(s.calls.filter(c=>c.action==='expedition/me').length,1);
});

test('shared request cancellation is treated as a cancelled read without retry',async()=>{
  const s=setup(c=>new Promise((resolve,reject)=>c.options.signal.addEventListener('abort',()=>reject(Error('aborted')))));
  const controller=new AbortController(),p=s.request('party/get',{partyId:'p1'},{},{signal:controller.signal});controller.abort();
  await assert.rejects(p,e=>e.code==='request_cancelled'&&!e.uncertain);assert.equal(s.calls.length,1);
});

test('additional read routes recover safely from a dropped connection',async()=>{
  for(const action of ['expedition/me','party/list','party/get','auto-enhance/status','trade/requests','trade/log']){
    let count=0;const s=setup(()=>{if(++count===1)throw Error('network');return response({ok:true});});
    assert.equal((await s.request(action,{},{})).j.ok,true);assert.equal(count,2);
  }
});
test('a direct party link opens its matching battle tab once and later refreshes respect navigation',async()=>{
 for(const kind of ['tower','dungeon']){
  const s=setup(c=>response(c.action==='expedition/me'?snapshot(100):c.action==='party/list'?list():{ok:true,party:{...party('p1'),kind}}),{hash:'#party_p1'});
  await s.h.refresh(true);assert.equal(s.h.party().id,'p1');assert.equal(s.h.tab(),kind==='tower'?'tower':'dungeons');
  const button={dataset:{tab:'skills'},hasAttribute:()=>false};await s.listeners.get('click')({target:{closest:()=>button}});
  await s.h.refresh(true);assert.equal(s.h.tab(),'skills');
 }
});
