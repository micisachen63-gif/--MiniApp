import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/guardian-shop.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pending=()=>({characterId:'1',requestId,itemIds:['guardian-original'],expectedGold:100});
const receipt=()=>({result:{count:1,gold:100,items:[{id:'guardian-original'}]}});
function setup({storage=new Map(),realmId,contextEpoch,api,onSold=()=>{}}){
 const root={isConnected:true,innerHTML:'',contains:()=>true};
 const localStorage={get length(){return storage.size;},key:index=>[...storage.keys()][index],getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 const context=vm.createContext({window:{},localStorage,crypto:globalThis.crypto});vm.runInContext(source,context);
 const controller=context.window.RpgGuardianShop.open({actor:()=> '1',realmId,contextEpoch,api,onSold,sheet:()=>({querySelector:()=>root}),close:()=>{root.isConnected=false;}});
 const click=action=>root.onclick({target:{closest:()=>({dataset:{},disabled:false,hasAttribute:name=>name==='data-gshop-'+action})}});
 return {root,controller,storage,click};
}

test('guardian shop keeps permanent pending sales untouched and reads only the seasonal key for the same actor',async()=>{
 const storage=new Map(),legacy='rpg-guardian-shop:1:'+requestId,season='rpg-guardian-shop:season_one:1:'+requestId,calls=[];
 storage.set(legacy,JSON.stringify(pending()));
 let h=setup({storage,realmId:()=> 'season_one',api:async(path)=>{calls.push(path);return {characterId:'1',items:[],nextCursor:null};}});await flush();
 assert.deepEqual(calls,['guardian/shop/list']);assert.doesNotMatch(h.root.innerHTML,/data-gshop-retry/);assert.ok(storage.has(legacy));h.root.isConnected=false;
 storage.set(season,JSON.stringify(pending()));h=setup({storage,realmId:()=> 'season_one',api:async(path,body)=>{calls.push([path,body.requestId]);return receipt();}});
 assert.match(h.root.innerHTML,/data-gshop-retry/);h.click('retry');await flush();assert.deepEqual(calls.at(-1),['guardian/shop/sell',requestId]);assert.equal(storage.has(season),false);assert.ok(storage.has(legacy));
});

test('legacy guardian shop receipt remains retryable under the original permanent key',async()=>{
 const storage=new Map(),key='rpg-guardian-shop:1:'+requestId;storage.set(key,JSON.stringify(pending()));let calls=0;
 const h=setup({storage,api:async(path,body)=>{assert.equal(path,'guardian/shop/sell');assert.deepEqual(JSON.parse(JSON.stringify(body)),pending());calls++;return receipt();}});
 h.click('retry');await flush();assert.equal(calls,1);assert.equal(storage.has(key),false);assert.match(h.root.innerHTML,/神羽已交給商人/);
});

test('same-ID realm and epoch switches prevent pending guardian sales from being sent',async()=>{
 for(const mode of ['realm','epoch']){
  const storage=new Map(),key='rpg-guardian-shop:1:'+requestId;storage.set(key,JSON.stringify(pending()));let realm='permanent',epoch=0,calls=0;
  const h=setup({storage,realmId:()=>realm,contextEpoch:()=>epoch,api:async()=>{calls++;return receipt();}});
  if(mode==='realm')realm='season_one';else epoch++;h.click('retry');await flush();assert.equal(calls,0);assert.ok(storage.has(key));
 }
});

test('late sale success or rejection preserves the original receipt and cannot update a new context',async()=>{
 for(const outcome of ['success','rejection']){
  const storage=new Map(),key='rpg-guardian-shop:season_one:1:'+requestId;storage.set(key,JSON.stringify(pending()));let epoch=0,release,sold=0;
  const h=setup({storage,realmId:()=> 'season_one',contextEpoch:()=>epoch,onSold:()=>sold++,api:()=>new Promise((resolve,reject)=>release=()=>outcome==='success'?resolve(receipt()):reject(Object.assign(Error('舊角色'),{code:'character_changed'})))});
  h.click('retry');const html=h.root.innerHTML;epoch++;release();await flush();assert.ok(storage.has(key));assert.equal(sold,0);assert.equal(h.root.innerHTML,html);h.root.isConnected=false;
  const retry=setup({storage,realmId:()=> 'season_one',contextEpoch:()=>epoch,api:async(path,body)=>{assert.equal(body.requestId,requestId);return receipt();}});retry.click('retry');await flush();assert.equal(storage.has(key),false);
 }
});
