import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import * as P from '../src/services/player.js';
import * as SourceX from '../src/services/market-exchange.js';
import * as G from '../src/services/guardian-sigil.js';
import { history as sourceHistory } from '../src/services/market-exchange-history.js';
import { handle } from '../src/index.js';
import { selectAccountCharacter } from '../src/accounts.js';
import { makeGear } from '../src/game/gear.js';
import { insertEquipStmt, invDeltaStmt } from '../src/db.js';
import { SPECIAL_SKILLS } from '../src/game/special.js';

// Release review may pin a local, already-compiled Worker module. The default
// remains the source service and the real MiniApp route, never a fake handler.
const compiledUrl=process.env.MARKET_HISTORY_COMPILED_URL||process.env.GUARDIAN_HISTORY_COMPILED_URL;
const runtime=compiledUrl?(await import(compiledUrl)).default.fetch:handle;
async function action(env,account,path,body={},now=T0) {
  const response=await runtime(new Request('http://local/app/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(account?{'X-Dev-Tg-Id':account}:{}),'X-Debug-Now':String(now)},body:JSON.stringify(body)}),env,{waitUntil(p){void Promise.resolve(p).catch(()=>{});}});
  return {status:response.status,...await response.json()};
}
async function compiledAction(env,tg,path,body={},now=T0) {
  const account=env.DB.sqlite.prepare('SELECT account_tg_id FROM rpg_characters WHERE tg_id=?').get(String(tg))?.account_tg_id||String(tg);
  const response=await action(env,account,path,{characterId:String(tg),selectedCharacterId:String(tg),...body},now);
  if(response.status>=400)throw Object.assign(new Error(response.message),{code:response.error,status:response.status});
  const {status,...data}=response;return data;
}
const history=compiledUrl?(env,tg,body={})=>compiledAction(env,tg,'exchange/history',body):sourceHistory;
const X=compiledUrl?Object.fromEntries(['create','buy','cancel'].map(key=>[key,(env,tg,body,now)=>compiledAction(env,tg,'exchange/'+key,body,now)])):SourceX;
const op=(characterId,body={})=>({characterId,requestId:crypto.randomUUID(),...body});
async function fixture() {
  const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};
  for(const tgId of ['111','222','333']) {
    await P.createCharacter(env,{tgId,name:'旅人'+tgId,gender:'f',baseClass:'sword'},T0);
    await env.DB.prepare('UPDATE rpg_characters SET gold=2000000,level=120 WHERE tg_id=?').bind(tgId).run();
    await invDeltaStmt(env.DB,tgId,'scroll_w',500).run();
  }
  return env;
}
async function sell(env,body={},seller='111',buyer='222',now=T0+1000) {
  const created=await X.create(env,seller,op(seller,{item:'scroll_w',qty:2,price:101,...body}),T0);
  const id=created.result.listingId;
  if(buyer)await X.buy(env,buyer,op(buyer,{listingId:id}),now);
  return id;
}
async function api(env,tg,body={}) {
  return action(env,tg,'exchange/history',body);
}
function dump(db) {
  return JSON.stringify(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.sqlite.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));
}

test('real MiniApp history reports actual buyer debit and ceil-5% seller fee without charging another fee',async()=>{
  const env=await fixture(),id=await sell(env),before=dump(env.DB);
  const buyer=await api(env,'222',{tgId:'111',seller:'111',buyer:'333',characterId:'222'}),seller=await api(env,'111',{characterId:'111'});
  assert.equal(buyer.status,200,JSON.stringify(buyer));assert.equal(seller.status,200);
  assert.equal(buyer.items.length,1);assert.equal(seller.items.length,1);
  const b=buyer.items[0],s=seller.items[0];
  assert.equal(b.listingId,id);assert.equal(b.role,'buy');assert.equal(b.paidGold,101);assert.equal(b.goldDelta,-101);assert.equal(b.feePaidBy,'seller');assert.equal(Object.hasOwn(b,'fee'),false);assert.equal(Object.hasOwn(b,'netGold'),false);
  assert.equal(s.role,'sell');assert.equal(s.price,101);assert.equal(s.fee,6);assert.equal(s.netGold,95);assert.equal(s.goldDelta,95);assert.equal(s.qty,2);assert.equal(s.settledAt,T0+1000);
  assert.equal(s.item.name,'武器強化捲');assert.equal(s.item.snapshotAvailable,true);assert.equal(b.counterparty.name,'旅人111');assert.equal(s.counterparty.name,'旅人222');
  assert.equal(dump(env.DB),before,'all wallets, gear, inventory, ledger, operations, outbox and account rows must stay byte-for-byte unchanged');
});

test('unrelated players, unfinished listings, cancelled listings and zero-gold fee ledger entries never become history',async()=>{
  const env=await fixture();await sell(env);
  await sell(env,{price:33},'333','222');const active=await sell(env,{price:44},'111',null);
  const undo=await sell(env,{price:55},'111',null);await X.cancel(env,'111',op('111',{listingId:undo}),T0+500);
  assert.equal((await history(env,'111')).items.length,1);assert.equal((await history(env,'222')).items.length,2);
  assert.equal((await history(env,'333',{role:'sell'})).items.length,1);assert.equal((await history(env,'333',{role:'buy'})).items.length,0);
  assert.equal((await history(env,'111')).items.some(i=>i.listingId===active||i.listingId===undo),false);
});

test('roles and all-role timeline retain actual transaction order even when an old listing sells last',async()=>{
  const env=await fixture(),old=await sell(env,{},'111',null);
  const incoming=await sell(env,{price:21},'333','111',T0+2000);
  const recent=await sell(env,{price:50},'111','222',T0+3000);
  await X.buy(env,'222',op('222',{listingId:old}),T0+4000);
  assert.deepEqual((await history(env,'111')).items.map(i=>i.listingId),[old,recent,incoming]);
  assert.deepEqual((await history(env,'111',{role:'buy'})).items.map(i=>i.listingId),[incoming]);
  assert.deepEqual((await history(env,'111',{role:'sell'})).items.map(i=>i.listingId),[old,recent]);
});

test('thirty-row keyset pages handle 65 same-millisecond sales, role cursors and new arrivals without duplicates',async()=>{
  const env=await fixture(),ids=[];
  for(let i=0;i<65;i++)ids.push(await sell(env,{price:i+1},'111','222',T0+7000));
  const first=await history(env,'111',{role:'sell'});assert.equal(first.items.length,30);assert.equal(first.pageSize,30);assert.ok(first.nextCursor);
  await sell(env,{price:999},'111','222',T0+8000);
  const second=await history(env,'111',{role:'sell',cursor:first.nextCursor}),third=await history(env,'111',{role:'sell',cursor:second.nextCursor});
  assert.equal(second.items.length,30);assert.equal(third.items.length,5);assert.equal(third.nextCursor,null);
  const seen=[...first.items,...second.items,...third.items].map(i=>i.listingId);
  assert.deepEqual(seen,ids.reverse());assert.equal(new Set(seen).size,65);
  const bought=await history(env,'222',{role:'buy'});assert.equal(bought.items.length,30);assert.equal(bought.items[0].paidGold,999);
});

test('history isolates characters within one Telegram account and rejects stale or foreign character pins',async()=>{
  const env=await fixture(),id=await sell(env);
  const other=(await P.createCharacter(env,{tgId:'111',name:'另一角色',gender:'m',baseClass:'mage'},T0)).char.tg_id;
  await selectAccountCharacter(env,'111',other,T0);
  const current=await api(env,'111',{characterId:other,selectedCharacterId:other,tgId:'222'});assert.equal(current.status,200);assert.equal(current.characterId,other);assert.equal(current.items.length,0);
  for(const body of [{characterId:'111'},{selectedCharacterId:'111'},{characterId:'222'}]) {const bad=await api(env,'111',body);assert.equal(bad.status,409);assert.equal(bad.error,'character_changed');assert.match(bad.message,/角色|選角/);}
  await assert.rejects(history(env,'111'),e=>e.code==='character_changed');
  await selectAccountCharacter(env,'111','111',T0);assert.equal((await api(env,'111',{characterId:'111'})).items[0].listingId,id);
  assert.equal((await api(env,null)).status,401);assert.equal((await api(env,'444')).status,404);
});

test('equipment history keeps the sold enhancement/affixes after the live item is renamed, rerolled and deleted',async()=>{
  const env=await fixture(),gear={...makeGear({id:'history-gear',tgId:'111',cls:'sword',slot:'weapon',kind:'sword',tier:4,forceRarity:'epic',rng:()=>.5,now:T0}),enhance_level:5};
  await insertEquipStmt(env.DB,gear).run();await sell(env,{item:undefined,equipId:gear.id,qty:1});
  const original=(await history(env,'222')).items[0].item;assert.equal(original.snapshotAvailable,true);assert.equal(original.enhance,5);assert.ok(original.equipment.stat>0);
  await env.DB.prepare("UPDATE rpg_equipment SET name='被改名',enhance_level=10,affix_json=NULL WHERE id=?").bind(gear.id).run();
  assert.deepEqual((await history(env,'222')).items[0].item,original);
  await env.DB.prepare('DELETE FROM rpg_equipment WHERE id=?').bind(gear.id).run();
  assert.deepEqual((await history(env,'222')).items[0].item,original);
  assert.equal(Object.hasOwn(original.equipment,'cannotEquip'),false);assert.equal(Object.hasOwn(original.equipment,'sellPrice'),false);assert.equal(Object.hasOwn(original,'canBuy'),false);
});

test('guardian history keeps sold type and all eight immutable qualities rather than reading changed live angels or future bonus settings',async()=>{
  const env=await fixture();await G.ensureWelcome(env,'111',T0);
  for(let rank=1;rank<=8;rank++) {
    const draw=await G.summon(env,'111',{pool:'normal',count:1,requestId:'history_guardian_'+rank},T0),id=draw.operation.results[0].id;
    await env.DB.prepare("UPDATE rpg_guardian_sigils SET type='magic',quality=? WHERE id=?").bind(rank,id).run();
    await sell(env,{item:undefined,guardianId:id,qty:1},'111','222',T0+rank);
    await env.DB.prepare("UPDATE rpg_guardian_sigils SET type='loot',quality=8,bound=1 WHERE id=?").bind(id).run();
  }
  const items=(await history(env,'222')).items;
  assert.deepEqual(items.map(i=>i.item.guardian.rank),[8,7,6,5,4,3,2,1]);assert.ok(items.every(i=>i.item.guardian.type==='magic'&&i.item.snapshotAvailable));
  assert.deepEqual(items.map(i=>i.item.quality),['cyan','pink','gold','red','purple','blue','green','white']);
  assert.ok(items.every(i=>!Object.hasOwn(i.item.guardian,'active')&&!Object.hasOwn(i.item.guardian,'damageBonus')));
});

test('shared armor history displays immutable stored base values rather than a later wearer-class multiplier',async()=>{
  const env=await fixture(),gear=makeGear({id:'history-belt',tgId:'111',cls:'sword',slot:'belt',tier:4,forceRarity:'epic',rng:()=>.5,now:T0});
  await insertEquipStmt(env.DB,gear).run();await sell(env,{item:undefined,equipId:gear.id,qty:1});
  const before=(await history(env,'222')).items[0].item;assert.equal(before.equipment.stat,gear.base_stat);assert.equal(before.equipment.statName,'基礎 DEF');assert.equal(before.equipment.elemStat,gear.element_stat);
  await env.DB.prepare("UPDATE rpg_characters SET base_class='mage' WHERE tg_id='222'").run();assert.deepEqual((await history(env,'222')).items[0].item,before);
});

test('skill books and raw collection material history show genuine names/learning requirements and whole-stack quantities',async()=>{
  const env=await fixture(),skill=SPECIAL_SKILLS.find(i=>i.level===120)||SPECIAL_SKILLS.at(-1),book='book_'+skill.id;
  await invDeltaStmt(env.DB,'111',book,3).run();await invDeltaStmt(env.DB,'111','hunt_4_core',7).run();
  await sell(env,{item:book,qty:3,price:500});await sell(env,{item:'hunt_4_core',qty:7,price:600},'111','222',T0+3000);
  const items=(await history(env,'222')).items,material=items[0],b=items[1];
  assert.equal(material.qty,7);assert.equal(material.item.category,'collection');assert.equal(material.item.item,'hunt_4_core');assert.equal(material.item.snapshotAvailable,true);
  assert.equal(b.qty,3);assert.equal(b.item.category,'skillbook');assert.equal(b.item.quality,skill.rarity);assert.equal(b.item.requiredLevel,skill.level);assert.equal(b.item.advancementTier,skill.advancementTier);assert.equal(b.item.tier,null);
});

test('bad cursors, role injection and malformed snapshot metadata produce safe Chinese errors or a read-only fallback',async()=>{
  const env=await fixture(),id=await sell(env);
  for(const body of [{role:"sell') OR 1=1 --"},{role:[]},{cursor:'0:0'},{cursor:'9007199254740992:1'},{cursor:"1:1;DELETE FROM rpg_ledger"},{cursor:{}}]) {const result=await api(env,'111',body);assert.equal(result.status,400);assert.match(result.message,/成交|買入|賣出/);}
  const malformed='{"secret":"internal-stack"';await env.DB.prepare('UPDATE rpg_exchange_listings SET snapshot_json=? WHERE id=?').bind(malformed,id).run();
  const before=dump(env.DB),result=await api(env,'222');assert.equal(result.status,200);assert.equal(result.items[0].item.snapshotAvailable,false);assert.equal(result.items[0].paidGold,101);assert.doesNotMatch(JSON.stringify(result),/internal-stack|snapshot_json|SyntaxError/);assert.equal(dump(env.DB),before);
});

test('even forged ledger references cannot reveal another role or another character listing',async()=>{
  const env=await fixture(),id=await sell(env);
  await env.DB.prepare("UPDATE rpg_ledger SET tg_id='333' WHERE event_id=?").bind('exchange:'+id+':buy').run();
  assert.equal((await history(env,'333')).items.length,0);assert.equal((await history(env,'222')).items.length,0);
  assert.equal((await history(env,'111')).items.length,1);
});

test('the real SQL plan uses the character ledger index and listing UNIQUE lookup, never a full-player listing scan or offset',async()=>{
  const env=await fixture();for(let i=0;i<32;i++)await sell(env,{price:i+1});
  const prepare=env.DB.prepare.bind(env.DB),queries=[];
  env.DB.prepare=sql=>{const stmt=prepare(sql),bind=stmt.bind.bind(stmt);stmt.bind=(...params)=>{queries.push({sql,params});return bind(...params);};return stmt;};
  const first=await history(env,'111'),next=await history(env,'111',{cursor:first.nextCursor});assert.equal(next.items.length,2);
  const reads=queries.filter(q=>q.sql.includes('INDEXED BY idx_rpg_ledger_owner'));assert.equal(reads.length,2);
  for(const {sql,params} of reads) {
    const plan=env.DB.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...params).map(p=>p.detail).join('\n');
    assert.match(plan,/SEARCH g USING INDEX idx_rpg_ledger_owner \(tg_id=\?/);assert.match(plan,/SEARCH l USING INDEX sqlite_autoindex_rpg_exchange_listings_\d+ \(id=\?/);
    assert.doesNotMatch(plan,/SCAN (?:g|l)\b|TEMP B-TREE/);assert.doesNotMatch(sql,/OFFSET|rpg_exchange_operations|json_extract/);assert.ok(params.length<=9);
  }
  assert.equal(queries.filter(q=>q.sql.includes('SELECT c.*,a.active_char_id')||q.sql.includes('INDEXED BY idx_rpg_ledger_owner')).length,4,'service has only two actor reads and two history reads');
  if(!compiledUrl)assert.equal(queries.length,4); // MiniApp additionally resolves the authenticated active character.
});
