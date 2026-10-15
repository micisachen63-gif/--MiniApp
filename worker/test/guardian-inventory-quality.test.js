import {CurrentClientRequest} from './client-request.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import * as P from '../src/services/player.js';
import * as G from '../src/services/guardian-sigil.js';
import * as X from '../src/services/market-exchange.js';
import {QUALITY_ORDER} from '../src/game/guardian-sigil-config.js';
import {handle} from '../src/index.js';

async function fixture() {
  const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};env.DB.sqlite.exec('PRAGMA foreign_keys=ON');
  for(const id of ['790','791']) {
    await P.createCharacter(env,{tgId:id,name:'品質背包'+id,baseClass:'sword',gender:'m'},T0);await env.DB.prepare('UPDATE rpg_characters SET level=35 WHERE tg_id=?').bind(id).run();
    await env.DB.prepare('INSERT INTO rpg_guardian_operations(operation_id,account_id,char_id,request_id,action,payload_hash,config_version,cost_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('seed-'+id,id,id,'quality_seed_'+id,'summon','0'.repeat(64),'fixture','{}','{}',T0).run();
  }
  const add=async(id,quality,n,extra={})=>{for(let i=0;i<n;i++) {
    const key=`${quality}-${id}-${String(i).padStart(3,'0')}${extra.suffix||''}`;await G.insertSigil(env.DB,{id:key,char_id:id,type:'melee',quality:QUALITY_ORDER.indexOf(quality)+1,bound:extra.bound?1:0,source_operation_id:'seed-'+id,created_at:T0}).run();
  }};
  await add('790','white',87);await add('790','blue',5);await add('790','gold',2);await add('791','white',3);await add('791','cyan',4);
  // One bound card is still an eligible fusion material. Other protections are not.
  await add('790','white',1,{suffix:'-bound',bound:true});
  await G.activate(env,'790',{itemId:'gold-790-000',requestId:'quality_activate'},T0);
  await G.lock(env,'790',{itemId:'blue-790-000',locked:true,requestId:'quality_lock'},T0);
  await X.create(env,'790',{guardianId:'blue-790-001',qty:1,price:100,characterId:'790',requestId:crypto.randomUUID()},T0);
  return {env,add};
}
const image=db=>JSON.stringify(db.sqlite.prepare('SELECT * FROM rpg_characters ORDER BY tg_id').all())+JSON.stringify(db.sqlite.prepare('SELECT * FROM rpg_guardian_sigils ORDER BY id').all())+JSON.stringify(db.sqlite.prepare('SELECT * FROM rpg_inventory ORDER BY tg_id,item').all())+JSON.stringify(db.sqlite.prepare('SELECT * FROM rpg_ledger ORDER BY rowid').all());

test('filtered white inventory reaches the real first page immediately, retains id cursor and never leaks another quality or owner',async()=>{
  const {env}=await fixture(),before=image(env.DB),ids=[];let cursor=null;
  do{const state=await G.state(env,'790',T0,{quality:'white',cursor,limit:40});assert.equal(state.inventory.quality,'white');assert.ok(state.inventory.items.length<=40);assert.ok(state.inventory.items.every(item=>item.quality==='white'&&item.id.includes('-790-')));ids.push(...state.inventory.items.map(item=>item.id));cursor=state.inventory.nextCursor;}while(cursor);
  assert.equal(ids.length,88);assert.equal(new Set(ids).size,88);assert.deepEqual(ids,[...ids].sort());assert.equal(image(env.DB),before);
  const empty=await G.state(env,'790',T0,{quality:'cyan'});assert.deepEqual(empty.inventory.items,[]);assert.equal(empty.inventory.nextCursor,null);assert.equal(empty.inventory.quality,'cyan');assert.equal(empty.inventory.totalCount,95);assert.equal(empty.inventory.qualityCounts.white,88);
});
test('all-quality eligible counts come from the whole owner inventory and retain bound materials while excluding active/locked/escrow',async()=>{
  const {env}=await fixture(),state=await G.state(env,'790',T0,{quality:'gold',limit:1});
  assert.equal(state.inventory.totalCount,95);assert.deepEqual(state.inventory.eligibleCounts,{white:88,green:0,blue:3,purple:0,red:0,gold:1,pink:0,cyan:0});assert.deepEqual(state.inventory.qualityCounts,state.inventory.eligibleCounts);
  assert.equal(state.inventory.items.length,1);assert.equal(state.daily.granted,0);assert.equal(state.daily.remaining,4);
  const foreign=await G.state(env,'791',T0,{quality:'white'});assert.equal(foreign.inventory.eligibleCounts.white,3);assert.equal(foreign.inventory.eligibleCounts.cyan,4);assert.equal(foreign.inventory.totalCount,7);
});
test('unfiltered legacy pagination is unchanged and quality aggregate reuses the existing eight-statement snapshot',async()=>{
  const {env}=await fixture();let prepared=0;const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=sql=>{prepared++;return prepare(sql);};
  const all=await G.state(env,'790',T0,{limit:10});assert.equal(prepared,8);assert.equal(all.inventory.quality,null);assert.equal(all.inventory.items.length,10);
  const next=await G.state(env,'790',T0,{limit:10,cursor:all.inventory.nextCursor});assert.ok(next.inventory.items[0].id>all.inventory.items.at(-1).id);assert.equal(new Set([...all.inventory.items,...next.inventory.items].map(item=>item.id)).size,20);
  prepared=0;await G.state(env,'790',T0,{quality:'white',limit:10});assert.equal(prepared,8);
});
test('malformed quality/cursor fail clearly before a read, and authenticated MiniApp cannot request a different owner',async()=>{
  const {env}=await fixture();let prepared=0;const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=sql=>{prepared++;return prepare(sql);};
  for(const quality of [null,'','White','rare',1,[],{},"white' OR 1=1--"])await assert.rejects(G.state(env,'790',T0,{quality}),{code:'quality'});
  for(const cursor of [1,{},[],false,'','\u0000bad'])await assert.rejects(G.state(env,'790',T0,{quality:'white',cursor}),{code:'cursor'});assert.equal(prepared,0);
  const response=await handle(new CurrentClientRequest('http://local/app/api/guardian/inventory',{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'790','X-Debug-Now':String(T0)},body:JSON.stringify({quality:'cyan',tgId:'791',charId:'791'})}),env),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.state.charId,'790');assert.equal(body.state.inventory.quality,'cyan');assert.deepEqual(body.state.inventory.items,[]);assert.equal(body.state.inventory.totalCount,95);
});
