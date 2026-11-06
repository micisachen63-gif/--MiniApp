import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/scene-direct-trade-ui.js',import.meta.url),'utf8');
function exported(){
  const scope={AbortController,console,URL};
  vm.runInNewContext(source,scope);
  return scope.RpgSceneDirectTrade;
}
const context={accountId:'90101',realmId:'permanent',characterId:'90101',epoch:4};
const data=(ctx=context)=>({ok:true,schemaVersion:1,pureRead:true,accountId:ctx.accountId,realmId:ctx.realmId,
  characterId:ctx.characterId,contextEpoch:ctx.epoch,revision:1,
  trades:{open:[{id:'t111',status:'open',a:{name:'甲方'},b:{name:'乙方'}}],history:[]},
  requests:{incoming:[],outgoing:[]},selected:null});
function fixture(reply,params){
  const calls=[],notices=[],live={...context},host={
    getContext:()=>({...live}),current:()=>true,params:params||{},
    request:async(action,body,options)=>{calls.push({action,body,options});return typeof reply==='function'?reply(action,body,options):reply;},
    onState:state=>notices.push({loading:state.loading,error:state.error,selectedId:state.selectedId})
  };
  return {host,calls,notices,live};
}
test('read-only direct-trade client pins actor realm epoch and issues only the pure scene route',async()=>{
  const f=fixture(data()),client=exported().createClient(f.host);
  assert.equal(await client.refresh(),true);assert.equal(client.state.data.trades.open.length,1);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'trade/scene-scoped');
  assert.equal(f.calls[0].body.accountId,'90101');assert.equal(f.calls[0].body.realmId,'permanent');
  assert.equal(f.calls[0].body.selectedCharacterId,'90101');assert.equal(f.calls[0].body.contextEpoch,4);
  assert.equal('recovery' in f.calls[0].body,false);assert.equal('requestId' in f.calls[0].body,false);
  client.dispose();
});
test('invalid foreign scope and not-read-only server envelopes never replace visible trade data',async()=>{
  for(const fault of [d=>({...d,accountId:'foreign'}),d=>({...d,pureRead:false}),d=>({...d,characterId:'222'})]){
    const f=fixture(fault(data())),client=exported().createClient(f.host);
    assert.equal(await client.refresh(),false);assert.equal(client.state.data,null);
    assert.match(client.state.error,/資料|角色/);client.dispose();
  }
});
test('selected trade stays inside one scene and back returns to list without posting a mutation',async()=>{
  const f=fixture((action,body)=>({...data(),selected:body.tradeId?
    {id:body.tradeId,status:'open',a:{name:'甲方'},b:{name:'乙方'}}:null})),client=exported().createClient(f.host);
  await client.refresh();assert.equal(client.selectTrade('foreign'),false);
  assert.equal(client.selectTrade('t111'),true);assert.equal(await client.refresh(),true);
  assert.equal(f.calls[1].body.tradeId,'t111');assert.equal(client.state.selectedId,'t111');
  assert.equal(client.back(),true);assert.equal(client.state.selectedId,null);
  assert(f.calls.every(row=>row.action==='trade/scene-scoped'));client.dispose();
});
test('actor A-B-A-like epoch change ignores old asynchronous responses and never replays a trade',async()=>{
  let resolve;
  const f=fixture(()=>new Promise(done=>{resolve=done;})),client=exported().createClient(f.host);
  const pending=client.refresh();f.live.epoch+=1;resolve(data());
  assert.equal(await pending,false);assert.equal(client.state.data,null);
  assert.equal(f.calls.length,1);client.dispose();
});
test('dispose invalidates a pending pure read and releases its abort controller',async()=>{
  let resolve;
  const f=fixture(()=>new Promise(done=>{resolve=done;})),client=exported().createClient(f.host);
  const pending=client.refresh();assert.equal(f.calls[0].options.signal.aborted,false);
  client.dispose();assert.equal(f.calls[0].options.signal.aborted,true);
  resolve(data());assert.equal(await pending,false);
});
test('season read-only client uses season-scoped credentials and does not ask the exchange action endpoint',async()=>{
  const season={...context,realmId:'season_2026_01'},f=fixture({...data(season),trades:{open:[],history:[]}}),calls=f.calls;
  f.live.realmId=season.realmId;
  const client=exported().createClient(f.host);
  assert.equal(await client.refresh(),true);assert.equal(calls[0].body.realmId,season.realmId);
  assert.equal(calls[0].action,'trade/scene-scoped');client.dispose();
});
test('single-window route loads the gated intent client and reserves all writes for explicit confirmation',()=>{
  const social=readFileSync(new URL('../public/scene-social-preview.js',import.meta.url),'utf8');
  const server=readFileSync(new URL('../tools/scene-live-preview.mjs',import.meta.url),'utf8');
  const api=readFileSync(new URL('../tools/atlas-local-preview.mjs',import.meta.url),'utf8');
  const session=readFileSync(new URL('../public/scene-live-session.js',import.meta.url),'utf8');
  assert(social.includes("'direct-trade':{title:"));
  assert(social.includes("loadSceneModule('scene-direct-trade-ui','RpgSceneDirectTrade')"));
  assert(server.includes("'scene-direct-trade-ui.js','scene-direct-trade-ui.css','scene-direct-trade-client.js'"));
  assert(social.includes("loadSceneModule('scene-direct-trade-client','RpgSceneDirectTradeActions')"));
  assert(api.includes('"trade/scene-scoped","trade/receipt","trade/action-scoped"'));
  assert(session.includes("'trade/scene-scoped','trade/receipt'"));
  assert(!source.includes("host.request('trade/action-scoped'"));
  assert(!source.includes("host.request('trade/receipt'"));
});
