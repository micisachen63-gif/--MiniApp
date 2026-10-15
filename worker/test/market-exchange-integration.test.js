// Exercise the real public host/request adapter against the Mini App router and
// transactional SQLite. A mocked UUID would miss host/service contract drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import { handle } from '../src/index.js';
import * as P from '../src/services/player.js';
import { makeGear } from '../src/game/gear.js';
import { insertEquipStmt } from '../src/db.js';

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const exchange=fs.readFileSync(new URL('../public/market-exchange.js',import.meta.url),'utf8');
const requestClient=fs.readFileSync(new URL('../public/request-client.js',import.meta.url),'utf8');
const merchant=fs.readFileSync(new URL('../public/market-sell.js',import.meta.url),'utf8');
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const fmt=value=>Number(value).toLocaleString('en-US');
const plain=value=>JSON.parse(JSON.stringify(value));
const scalar=(env,sql,...params)=>env.DB.sqlite.prepare(sql).get(...params);
const wallet=(env,id)=>scalar(env,'SELECT gold,rev FROM rpg_characters WHERE tg_id=?',id);
const segment=(start,end)=>{const from=app.indexOf(start),to=app.indexOf(end,from);assert.ok(from>=0&&to>from,'actual host source exists');return app.slice(from,to);};

async function setup() {
  const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};
  env.DB.sqlite.exec('PRAGMA foreign_keys=ON');
  for(const id of ['790','791']) {
    await P.createCharacter(env,{tgId:id,name:'隔離旅者'+id,gender:'f',baseClass:id==='790'?'sword':'mage'},T0);
    await env.DB.prepare('UPDATE rpg_characters SET gold=300000,level=50 WHERE tg_id=?').bind(id).run();
  }
  const gear=makeGear({id:'integration-gear',tgId:'790',cls:'sword',slot:'helmet',tier:4,rng:()=>.5,now:T0});
  await insertEquipStmt(env.DB,gear).run();
  await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').bind('790','scroll_w',9).run();
  return {env,gear};
}

function actualHost(env,id,{dropAfterCommit}={}) {
  const storage=new Map(),sent=[],toasts=[],refreshes=[];let host,drop=dropAfterCommit;
  const state={apiEpoch:0,me:{character:{tgId:id,revision:wallet(env,id).rev,gold:wallet(env,id).gold},inventory:{},equipment:[]},shop:null,shopTab:'sell'};
  const window={addEventListener(){}};
  const context=vm.createContext({window,crypto:globalThis.crypto,Uint8Array,AbortController,setTimeout,clearTimeout,S:state,
    initData:'',devTg:id,tg:null,expansion:null,esc,fmt,gearIcon:()=>'',confirmSheet:async()=>true,toast:(...args)=>toasts.push(args),
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    renderHud(){},openCharacterSelect(){},refreshMe:async options=>{refreshes.push(options);},sheet(){throw Error('detail view is not part of this API fixture');},closeSheet(){},
    fetch:async (url,options)=>{
      const body=JSON.parse(options.body);sent.push({url,body,headers:{...options.headers}});
      const response=await handle(new Request('http://isolated'+url,{...options,headers:{...options.headers,'X-Debug-Now':String(T0)}}),env);
      if(drop===url&&response.ok){drop=null;throw Error('simulated transport lost AFTER commit');}
      return response;
    }});
  vm.runInContext(requestClient,context);vm.runInContext(exchange,context);
  window.RpgMarketExchange.mount=(_view,captured)=>{host=captured;return {update(){},cleanup(){}};};
  vm.runInContext(segment('  const readActions=','  function mutationKey(')+segment('  let marketController=','  function bindShop(')+';this.capture=()=>mountMarket({});',context);
  context.capture();
  return {host,state,sent,toasts,refreshes,storage,context};
}

test('actual public host crosses request-client and Mini App with a canonical UUID, pinned actor and exact stack settlement',async()=>{
  const {env}=await setup(),seller=actualHost(env,'790'),buyer=actualHost(env,'791');
  const create={characterId:'790',requestId:seller.host.requestId(),item:'scroll_w',qty:3,price:101};
  assert.match(create.requestId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const posted=await seller.host.api('exchange/create',create);assert.equal(posted.ok,true);
  assert.equal(seller.sent[0].body.selectedCharacterId,'790');assert.equal(seller.sent[0].body.characterId,'790');
  assert.equal(seller.sent[0].body.requestId,create.requestId);assert.equal(seller.sent[0].headers['X-Dev-Tg-Id'],'790');
  assert.equal(scalar(env,'SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?','790','scroll_w').quantity,6);
  const pay={characterId:'791',requestId:buyer.host.requestId(),listingId:posted.result.listingId};
  const bought=await buyer.host.api('exchange/buy',pay);buyer.host.onBalance(bought.balance);
  assert.equal(wallet(env,'790').gold,300095);assert.equal(wallet(env,'791').gold,299899);assert.equal(buyer.state.me.character.gold,299899);
  assert.equal(scalar(env,'SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?','791','scroll_w').quantity,3);
  assert.equal(scalar(env,"SELECT request_id FROM rpg_exchange_operations WHERE action='buy'").request_id,pay.requestId);
  assert.equal(seller.state.apiEpoch,2);assert.equal(buyer.state.apiEpoch,2);
});

test('actual transport loss after committed purchase does not auto-repeat; the same host UUID retries with one charge',async()=>{
  const {env,gear}=await setup(),seller=actualHost(env,'790'),buyer=actualHost(env,'791',{dropAfterCommit:'/app/api/exchange/buy'});
  const posted=await seller.host.api('exchange/create',{characterId:'790',requestId:seller.host.requestId(),equipId:gear.id,qty:1,price:100});
  const body={characterId:'791',requestId:buyer.host.requestId(),listingId:posted.result.listingId};
  await assert.rejects(buyer.host.api('exchange/buy',body),error=>error.uncertain===true&&error.code==='request_uncertain');
  assert.equal(buyer.sent.length,1);assert.equal(wallet(env,'790').gold,300095);assert.equal(wallet(env,'791').gold,299900);
  assert.equal(buyer.refreshes.length,1,'the existing host requests a state refresh on an uncertain outcome');
  const verified=await buyer.host.api('exchange/buy',body);assert.equal(verified.ok,true);
  assert.deepEqual(buyer.sent.map(r=>r.body.requestId),[body.requestId,body.requestId]);
  assert.equal(wallet(env,'790').gold,300095);assert.equal(wallet(env,'791').gold,299900);
  assert.equal(scalar(env,"SELECT COUNT(*) n FROM rpg_exchange_operations WHERE action='buy'").n,1);
  assert.equal(scalar(env,'SELECT tg_id,trade_id FROM rpg_equipment WHERE id=?',gear.id).tg_id,'791');
});

test('real host maps all eight angel qualities and transfers unbound ownership through the same API',async()=>{
  const {env}=await setup(),seller=actualHost(env,'790'),buyer=actualHost(env,'791');
  await env.DB.prepare('INSERT INTO rpg_guardian_operations(operation_id,account_id,char_id,request_id,action,payload_hash,config_version,cost_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('fixture-summon','790','790','fixture-summon','summon','0'.repeat(64),'integration-fixture','{}','{}',T0).run();
  for(let quality=1;quality<=8;quality++)await env.DB.prepare('INSERT INTO rpg_guardian_sigils(id,char_id,type,quality,bound,active,locked,source_operation_id,created_at,updated_at) VALUES(?,?,?,?,0,0,0,?,?,?)').bind('angel-'+quality,'790','magic',quality,'fixture-summon',T0,T0).run();
  await env.DB.prepare('INSERT INTO rpg_guardian_sigils(id,char_id,type,quality,bound,active,locked,source_operation_id,created_at,updated_at) VALUES(?,?,?,?,1,0,0,?,?,?)').bind('angel-bound','790','magic',8,'fixture-summon',T0,T0).run();
  const candidates=await seller.host.api('exchange/sellable',{filters:{category:'guardian'}});
  assert.deepEqual(candidates.items.map(i=>i.quality),['white','green','blue','purple','red','gold','pink','cyan']);
  assert.ok(candidates.items.every(i=>i.classReq==='mage'&&i.tier===null&&i.enhance===null&&i.art.startsWith('/art/')));
  assert.ok(candidates.items.every(i=>i.guardian.ability&&i.guardian.damageBonus>0));
  const posted=await seller.host.api('exchange/create',{characterId:'790',requestId:seller.host.requestId(),guardianId:'angel-6',qty:1,price:100});
  const listed=await buyer.host.api('exchange/list',{filters:{category:'guardian',quality:'gold',classReq:'mage'}});
  assert.equal(listed.items.length,1);assert.equal(listed.items[0].guardianId,'angel-6');assert.equal(listed.items[0].quality,'gold');
  await buyer.host.api('exchange/buy',{characterId:'791',requestId:buyer.host.requestId(),listingId:posted.result.listingId});
  assert.deepEqual(plain(scalar(env,'SELECT char_id,bound,active,exchange_id,trade_id FROM rpg_guardian_sigils WHERE id=?','angel-6')),{char_id:'791',bound:0,active:0,exchange_id:null,trade_id:null});
  assert.equal(wallet(env,'790').gold,300095);assert.equal(wallet(env,'791').gold,299900);
  assert.deepEqual(env.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('actual host rejects a stale character payload, returns a certain Chinese error, and never trusts body tgId',async()=>{
  const {env,gear}=await setup(),seller=actualHost(env,'790');
  await assert.rejects(seller.host.api('exchange/create',{characterId:'791',tgId:'791',requestId:seller.host.requestId(),equipId:gear.id,qty:1,price:50}),error=>error.status===409&&error.code==='character_changed'&&!error.uncertain&&/角色/.test(error.message));
  assert.equal(scalar(env,'SELECT COUNT(*) n FROM rpg_exchange_listings').n,0);assert.equal(wallet(env,'790').gold,300000);
  assert.equal(scalar(env,'SELECT trade_id FROM rpg_equipment WHERE id=?',gear.id).trade_id,null);
});

test('merchant hall refreshes real eligible cards after exchange changes, while unchanged balance keeps both halls and inputs',()=>{
  const window={addEventListener(){}};let writes=0,binding=0,decorated=0;
  const body={isConnected:true,innerHTML:'',querySelectorAll:()=>[]};Object.defineProperty(body,'innerHTML',{get(){return this.value||'';},set(value){this.value=value;writes++;}});
  const exchangeInput={value:'1234',focused:true},view={exchangeInput};
  const gear=(id,extra={})=>({id,name:'隔離頭盔 '+id,tier:4,slot:'helmet',slotName:'頭盔',rarity:'common',rarityName:'一般',grade:'normal',enhance:0,sellPrice:120,equipped:false,inTrade:null,sellBlock:null,...extra});
  const S={shop:{gear:[],items:[]},shopTab:'sell',me:{character:{tgId:'790',gold:100},inventory:{},equipment:[gear('a'),gear('b')]},autoEnhance:null};
  const context=vm.createContext({window,S,esc,fmt,gearIcon:()=>'',devTg:'790',tg:null,document:{querySelector:selector=>selector==='[data-market-shop-body]'?body:exchangeInput,getElementById:()=>view},
    bindShop(){binding++;},shopBody:()=>window.RpgMarketSell.render({me:S.me,autoEnhance:S.autoEnhance},{esc,fmt,gearIcon:()=>''})});
  vm.runInContext(merchant,context);window.RpgMarketExchange={decorate(){decorated++;}};
  vm.runInContext(segment('  let marketController=','  function mountMarket(')+';this.update=updateShopSurface;',context);
  context.update();assert.equal(writes,1);assert.match(body.innerHTML,/data-sell-toggle="a"/);assert.match(body.innerHTML,/data-sell-toggle="b"/);
  S.me.character.gold=999;S.me.equipment=plain(S.me.equipment);context.update();assert.equal(writes,1,'equivalent full snapshots and gold-only updates do not redraw');
  S.me.equipment[0].inTrade='exchange:listed';context.update();assert.equal(writes,2);assert.doesNotMatch(body.innerHTML,/data-sell-toggle="a"/);
  S.me.equipment[0].inTrade=null;S.me.equipment.push(gear('purchased'));context.update();assert.equal(writes,3);assert.match(body.innerHTML,/data-sell-toggle="a"/);assert.match(body.innerHTML,/data-sell-toggle="purchased"/);
  S.autoEnhance={itemId:'b',status:'running'};context.update();assert.equal(writes,4);assert.doesNotMatch(body.innerHTML,/data-sell-toggle="b"/);
  assert.equal(binding,4);assert.equal(decorated,4);assert.equal(view.exchangeInput,exchangeInput);assert.equal(exchangeInput.value,'1234');assert.equal(exchangeInput.focused,true);
});
