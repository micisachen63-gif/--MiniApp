// Independent integrity audit. Real migrations and SQLite transactions; no live players.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import * as MarketService from '../src/services/market-exchange.js';
import * as Player from '../src/services/player.js';
import * as Trade from '../src/services/trade.js';
import * as Enhance from '../src/services/auto-enhance.js';
import * as Reroll from '../src/services/auto-reroll.js';
import * as Guardian from '../src/services/guardian-sigil.js';
import * as Sharing from '../src/services/share.js';
import * as Special from '../src/services/special.js';
import { QUALITY_ORDER, activeSettings } from '../src/game/guardian-sigil-config.js';
import { guardianDamageMultiplier, guardianLootMultiplier } from '../src/game/guardian-effects.js';
import { handle } from '../src/index.js';
import { selectAccountCharacter } from '../src/accounts.js';
import { insertEquipStmt, invDeltaStmt, loadPlayer, persistStatements, clonePlayer } from '../src/db.js';
import { makeGear } from '../src/game/gear.js';
import { ITEMS, TRADE } from '../src/game/constants.js';
import { SKILL_MAP, baseOf } from '../src/game/special.js';

const uuid = () => crypto.randomUUID();
const Market = { ...MarketService, ...Object.fromEntries(['create','buy','cancel'].map(action => [action, (env,tg,b,now) => MarketService[action](env,tg,{ characterId:String(tg),...b },now)])) };
async function fixture() {
  const env = { DB: freshDb(), ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true', ALLOW_DEBUG_TIME: 'true' };
  for (const id of ['111', '222', '333']) {
    await Player.createCharacter(env, { tgId: id, name: '市場審查' + id, gender: 'f', baseClass: 'sword' }, T0);
    await env.DB.prepare('UPDATE rpg_characters SET gold=100000,level=120 WHERE tg_id=?').bind(id).run();
    await invDeltaStmt(env.DB, id, 'scroll_w', 100).run();
    await invDeltaStmt(env.DB, id, 'scroll_r', 100).run();
  }
  const gear = async (id = 'audit-gear', options = {}) => {
    const e = makeGear({ id, tgId: '111', cls: 'sword', slot: 'weapon', kind: 'sword', tier: 1, forceRarity: 'common', rng: () => .5, now: T0, source: 'relic_boss', ...options });
    await insertEquipStmt(env.DB, e).run(); return e;
  };
  const api = async (account, action, body = {}) => {
    const res = await handle(new Request('https://local/app/api/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dev-Tg-Id': account, 'X-Debug-Now': String(T0) }, body: JSON.stringify({characterId:body.selectedCharacterId||account,...body}) }), env);
    return { status: res.status, ...await res.json() };
  };
  const guardian = async (type='melee',quality=4,tg='111') => {
    await Guardian.ensureWelcome(env,tg,T0);
    const r=await Guardian.summon(env,tg,{pool:'normal',count:1,requestId:'audit_sigil_'+uuid().replaceAll('-','')},T0);
    const id=r.operation.results[0].id;
    await env.DB.prepare('UPDATE rpg_guardian_sigils SET type=?,quality=? WHERE id=?').bind(type,quality,id).run();
    return env.DB.sqlite.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=?').get(id);
  };
  return { env, gear, api,guardian };
}
const listing = (env, body = {}, seller = '111') => Market.create(env, seller, { item: 'scroll_w', qty: 3, price: 101, requestId: uuid(), ...body }, T0);
const counts = db => {
  const table = name => db.sqlite.prepare('SELECT COUNT(*) AS n FROM ' + name).get().n;
  return { listings: table('rpg_exchange_listings'), operations: table('rpg_exchange_operations'), ledgers: db.sqlite.prepare("SELECT COUNT(*) AS n FROM rpg_ledger WHERE event_id LIKE 'exchange:%'").get().n };
};
const gold = (db, tg) => db.sqlite.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(tg).gold;
const inv = (db, tg, item) => db.sqlite.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?').get(tg, item)?.quantity || 0;

test('review: two buyers race for one escrow; one payout, fee and item transfer', async () => {
  const { env, gear } = await fixture(); const e = await gear();
  const create = await listing(env, { item: undefined, equipId: e.id, qty: 1, price: 1001 });
  const id = create.result.listingId;
  const bought = await Promise.allSettled(['222', '333'].map(tg => Market.buy(env, tg, { listingId: id, requestId: uuid() }, T0)));
  assert.equal(bought.filter(r => r.status === 'fulfilled').length, 1);
  const winner = bought[0].status === 'fulfilled' ? '222' : '333', loser = winner === '222' ? '333' : '222';
  assert.equal(gold(env.DB, winner), 98999); assert.equal(gold(env.DB, loser), 100000); assert.equal(gold(env.DB, '111'), 100950);
  const row = env.DB.sqlite.prepare('SELECT * FROM rpg_equipment WHERE id=?').get(e.id);
  assert.equal(row.tg_id, winner); assert.equal(row.trade_id, null);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE event_id=?").get('exchange:' + id + ':fee').n, 1);
  assert.deepEqual(counts(env.DB), { listings: 1, operations: 2, ledgers: 4 });
});

test('review: simultaneous buy/cancel conserves stack, gold and terminal listing', async () => {
  const { env } = await fixture(); const created = await listing(env); const id = created.result.listingId;
  const out = await Promise.allSettled([Market.buy(env, '222', { listingId: id, requestId: uuid() }, T0), Market.cancel(env, '111', { listingId: id, requestId: uuid() }, T0)]);
  assert.equal(out.filter(x => x.status === 'fulfilled').length, 1);
  const row = env.DB.sqlite.prepare('SELECT * FROM rpg_exchange_listings WHERE id=?').get(id);
  assert.equal(inv(env.DB, '111', 'scroll_w') + inv(env.DB, '222', 'scroll_w'), 200);
  if (row.status === 'sold') { assert.equal(gold(env.DB, '111'), 100095); assert.equal(gold(env.DB, '222'), 99899); }
  else { assert.equal(row.status, 'cancelled'); assert.equal(gold(env.DB, '111'), 100000); assert.equal(gold(env.DB, '222'), 100000); }
});

test('review: committed-response loss and parallel same UUID recover receipt once', async () => {
  const { env } = await fixture(), requestId = uuid(), body = { item: 'scroll_w', qty: 5, price: 20, requestId };
  const replay = await Promise.all([Market.create(env, '111', body, T0), Market.create(env, '111', body, T0)]);
  assert.equal(replay[0].result.listingId, replay[1].result.listingId); assert.equal(inv(env.DB, '111', 'scroll_w'), 95);
  const buyBody = { listingId: replay[0].result.listingId, requestId: uuid() };
  const results = await Promise.all([Market.buy(env, '222', buyBody, T0), Market.buy(env, '222', buyBody, T0)]);
  assert.deepEqual(results[0].result, results[1].result);
  await Market.buy(env, '222', buyBody, T0);
  assert.equal(gold(env.DB, '222'), 99980); assert.equal(gold(env.DB, '111'), 100019); assert.equal(inv(env.DB, '222', 'scroll_w'), 105);
  await assert.rejects(Market.create(env, '111', { ...body, qty: 4 }, T0), e => e.code === 'request_reused');
  assert.deepEqual(counts(env.DB), { listings: 1, operations: 2, ledgers: 4 });
});

test('review: final transfer/ledger failure rolls back listing, payout, debit and receipt', async () => {
  const { env, gear } = await fixture(); const e = await gear(); const id = (await listing(env, { equipId: e.id, item: undefined, qty: 1 })).result.listingId;
  const before = counts(env.DB);
  env.DB.sqlite.exec(`CREATE TRIGGER audit_fail_last BEFORE INSERT ON rpg_ledger WHEN NEW.event_id='exchange:${id}:fee' BEGIN SELECT RAISE(ABORT,'audit_last_statement_failed'); END;`);
  await assert.rejects(Market.buy(env, '222', { listingId: id, requestId: uuid() }, T0));
  assert.deepEqual(counts(env.DB), before); assert.equal(gold(env.DB, '111'), 100000); assert.equal(gold(env.DB, '222'), 100000);
  assert.equal(env.DB.sqlite.prepare('SELECT status FROM rpg_exchange_listings WHERE id=?').get(id).status, 'active');
  assert.equal(env.DB.sqlite.prepare('SELECT trade_id FROM rpg_equipment WHERE id=?').get(e.id).trade_id, 'exchange:' + id);
  env.DB.sqlite.exec('DROP TRIGGER audit_fail_last');
  const batch = env.DB.batch.bind(env.DB); let injected = false;
  env.DB.batch = async stmts => { if (!injected && stmts.some(s => s.sql.includes("SET status='sold'"))) { injected = true; stmts.splice(stmts.findIndex(s => s.sql.includes('UPDATE rpg_equipment SET tg_id=')), 1, env.DB.prepare('UPDATE rpg_equipment SET tg_id=? WHERE id=?').bind('222', 'missing-gear')); } return batch(stmts); };
  await assert.rejects(Market.buy(env, '222', { listingId: id, requestId: uuid() }, T0));
  assert.deepEqual(counts(env.DB), before); assert.equal(gold(env.DB, '111'), 100000); assert.equal(gold(env.DB, '222'), 100000);
});

test('review: escrow blocks all existing player mutations and raw old batch paths', async () => {
  const { env, gear } = await fixture(); const e = await gear(); await listing(env, { equipId: e.id, item: undefined, qty: 1 });
  const before = await loadPlayer(env.DB, '111'), unchanged = counts(env.DB);
  const attempts = [
    (w,c) => Player.equip(w,c,{itemId:e.id}), (w,c) => Player.sellGear(w,c,{itemId:e.id,requestId:'audit-sell'}),
    (w,c) => Player.sellGearBatch(w,c,{itemIds:[e.id],requestId:'audit-batch'}),
    (w,c) => Player.doEnhance(w,c,{itemId:e.id,requestId:'audit-enhance'}),
    (w,c) => Player.doReroll(w,c,{itemId:e.id,requestId:'audit-reroll'}),
    (w,c) => Player.doConvert(w,c,{itemId:e.id}), (w,c) => Player.doUnbind(w,c,{itemId:e.id,requestId:'audit-unbind'})
  ];
  for (const fn of attempts) { await assert.rejects(Player.withPlayer(env,'111',T0,fn), error => ['cannot_equip','cannot_sell','in_trade','cannot_unbind'].includes(error.code)); assert.deepEqual(await loadPlayer(env.DB,'111'),before); }
  await assert.rejects(Enhance.start(env,'111',{itemId:e.id,target:2},T0),error=>error.code==='busy');
  await assert.rejects(Reroll.start(env,'111',{itemId:e.id,functions:['attack'],requestId:'audit-reroll-start'},T0),error=>error.code==='busy');
  const open = await Trade.openTradeStmts(env,{aTg:'111',bTg:'222'},T0); await env.DB.batch(open.stmts);
  await assert.rejects(Trade.addLine(env,{tgId:'111',tradeId:open.id,equipId:e.id},T0));
  for (const stmt of [env.DB.prepare('DELETE FROM rpg_equipment WHERE id=?').bind(e.id), env.DB.prepare('UPDATE rpg_equipment SET name=? WHERE id=?').bind('偷改',e.id)]) {
    await assert.rejects(env.DB.batch([env.DB.prepare("UPDATE rpg_characters SET gold=gold+999 WHERE tg_id='111'"),stmt]), /exchange_equipment_locked/);
    assert.equal(gold(env.DB,'111'),before.char.gold);
  }
  assert.deepEqual(counts(env.DB),unchanged);
});

test('review: seller switches character; cancellation and payout stay with original owner', async () => {
  const { env, gear } = await fixture(); const second = await Player.createCharacter(env,{tgId:'111',name:'另一位旅者',gender:'m',baseClass:'mage'},T0);
  const secondId = second.char.tg_id, e = await gear(), id = (await listing(env,{equipId:e.id,item:undefined,qty:1})).result.listingId;
  await selectAccountCharacter(env,'111',secondId,T0);
  assert.equal((await Market.mine(env,secondId)).items[0].ownedByMe,true);
  await assert.rejects(Market.buy(env,secondId,{listingId:id,requestId:uuid()},T0),e=>e.code==='self_trade');
  await assert.rejects(Market.cancel(env,'333',{listingId:id,requestId:uuid()},T0),e=>e.code==='not_owned');
  await Market.cancel(env,secondId,{listingId:id,requestId:uuid()},T0);
  assert.equal(env.DB.sqlite.prepare('SELECT tg_id,trade_id FROM rpg_equipment WHERE id=?').get(e.id).tg_id,'111');
  const res = await Market.create(env,secondId,{item:'red_1',qty:3,price:101,requestId:uuid()},T0);
  await selectAccountCharacter(env,'111','111',T0);
  const firstGold=gold(env.DB,'111'),secondGold=gold(env.DB,secondId);
  await Market.buy(env,'222',{listingId:res.result.listingId,requestId:uuid()},T0);
  assert.equal(gold(env.DB,'111'),firstGold); assert.equal(gold(env.DB,secondId),secondGold+95);
});

test('review: stale withPlayer snapshot cannot overwrite seller payout', async () => {
  const { env } = await fixture(), id = (await listing(env)).result.listingId;
  const before = await loadPlayer(env.DB,'111'), work = clonePlayer(before); work.char.gold -= 100;
  await Market.buy(env,'222',{listingId:id,requestId:uuid()},T0);
  await assert.rejects(env.DB.batch(persistStatements(env.DB,before,work,{},T0)), /rpg_guard/);
  assert.equal(gold(env.DB,'111'),100095);
});

test('review: skill books and 60 raw collection materials use real class/quality maps; permanent badges remain bound', async () => {
  const { env } = await fixture(), materials = Object.keys(ITEMS).filter(k=>/^hunt_\d+_(?:[123]|sigil|core)$/.test(k));
  assert.equal(materials.length,60);
  for (const key of materials) { await invDeltaStmt(env.DB,'111',key,1).run(); }
  const collected=[]; let cursor=null;
  do { const r = await Market.sellable(env,'111',{filters:{category:'collection'},...(cursor?{cursor}: {})}); collected.push(...r.items); cursor=r.nextCursor; } while(cursor);
  assert.equal(collected.length,60); assert.deepEqual(new Set(collected.map(x=>x.item)),new Set(materials));
  const material = await Market.create(env,'111',{item:materials[0],qty:1,price:20,requestId:uuid()},T0);
  assert.equal(material.result.listing.category,'collection');
  assert.equal(TRADE.tradeableItems.includes(materials[0]),false,'original direct trade remains unchanged');
  await assert.rejects(Market.create(env,'111',{item:'collection_1',qty:1,price:20,requestId:uuid()},T0));
  for (const base of ['sword','archer','mage']) {
    const skill=Object.values(SKILL_MAP).find(s=>baseOf(s)===base&&s.rarity==='神話'); const key='book_'+skill.id;
    await invDeltaStmt(env.DB,'111',key,1).run();
    const res=await listing(env,{item:key,qty:1});
    assert.equal(res.result.listing.classReq,base); assert.equal(res.result.listing.quality,'神話');
    const found=await Market.list(env,'222',{filters:{category:'skillbook',classReq:base,quality:'神話'}});
    assert.ok(found.items.some(x=>x.item===key));
  }
});

test('review: MiniApp pins actor and stable UUID; no identity/body override or cross-character replay', async () => {
  const { env, api } = await fixture(), requestId = uuid();
  const r=await api('111','exchange/create',{item:'scroll_w',qty:1,price:20,requestId,selectedCharacterId:'111',tgId:'222',seller:'222'});
  assert.equal(r.ok,true,JSON.stringify(r));
  const listingId=r.result.listingId;
  assert.equal(env.DB.sqlite.prepare('SELECT seller_char FROM rpg_exchange_listings WHERE id=?').get(listingId).seller_char,'111');
  const replay=await api('111','exchange/create',{item:'scroll_w',qty:1,price:20,requestId,selectedCharacterId:'111'});
  assert.equal(replay.ok,true,JSON.stringify(replay)); assert.equal(replay.result.listingId,listingId);
  const second=await Player.createCharacter(env,{tgId:'111',name:'市場換角',gender:'f',baseClass:'mage'},T0);await selectAccountCharacter(env,'111',second.char.tg_id,T0);
  const stale=await api('111','exchange/create',{item:'scroll_w',qty:1,price:20,requestId,selectedCharacterId:'111'});
  assert.equal(stale.status,409); assert.equal(stale.error,'character_changed');
  const cross=await api('111','exchange/create',{item:'scroll_w',qty:1,price:20,requestId,selectedCharacterId:second.char.tg_id});
  assert.equal(cross.status,409); assert.equal(cross.error,'request_reused');
});

test('review: bounded D1 parameters and keyset pagination do not omit or repeat listings', async () => {
  const { env, gear } = await fixture(); let maxBinds=0, prepared=0;const prepare=env.DB.prepare.bind(env.DB);
  env.DB.prepare=sql=>{prepared++;const s=prepare(sql),bind=s.bind.bind(s);s.bind=(...params)=>{maxBinds=Math.max(maxBinds,params.length);assert.ok(params.length<=100,'D1 bound limit');return bind(...params);};return s;};
  for(let i=0;i<20;i++) { const e=await gear('page-'+i,{tier:i%12+1,forceRarity:i%2?'epic':'common'});await Market.create(env,'111',{equipId:e.id,qty:1,price:20,requestId:uuid()},T0); }
  for(let i=0;i<20;i++) await Market.create(env,'222',{item:'scroll_w',qty:1,price:i+1,requestId:uuid()},T0);
  let cursor=null;const ids=[]; do {prepared=0;const r=await Market.list(env,'333',{...(cursor?{cursor}: {})});assert.ok(r.items.length<=30);assert.ok(prepared<=3);ids.push(...r.items.map(x=>x.id));cursor=r.nextCursor;}while(cursor);
  assert.equal(ids.length,40);assert.equal(new Set(ids).size,40);assert.ok(maxBinds<=100);
  const before=counts(env.DB);await assert.rejects(Market.create(env,'111',{item:'scroll_w',qty:1,price:20,requestId:uuid()},T0));assert.deepEqual(counts(env.DB),before);
});

test('review: invalid price and quantity types produce zero inventory/gold/listing side effects', async () => {
  const { env }=await fixture(),before=counts(env.DB),initial=inv(env.DB,'111','scroll_w');
  for(const price of [0,-1,1.5,1000001,Infinity,'20',null,{},[]]) await assert.rejects(listing(env,{price}));
  for(const qty of [0,-1,1.5,100000,Infinity,'1',{},[]]) await assert.rejects(listing(env,{qty}));
  await assert.rejects(listing(env,{item:"scroll_w'); DROP TABLE rpg_inventory; --"}));
  assert.deepEqual(counts(env.DB),before);assert.equal(inv(env.DB,'111','scroll_w'),initial);assert.equal(gold(env.DB,'111'),100000);
});

test('review: two stack listings exceeding held inventory leave no ghost escrow', async () => {
  const { env }=await fixture();
  const out=await Promise.allSettled([listing(env,{qty:70}),listing(env,{qty:70})]);
  assert.equal(out.filter(r=>r.status==='fulfilled').length,1);assert.equal(inv(env.DB,'111','scroll_w'),30);
  assert.deepEqual(counts(env.DB),{listings:1,operations:1,ledgers:1});
});

test('review: late character switch rejects stale buy before any payment or transfer', async () => {
  const { env }=await fixture(), id=(await listing(env)).result.listingId;
  const second=await Player.createCharacter(env,{tgId:'222',name:'買家換角',gender:'m',baseClass:'mage'},T0);
  const batch=env.DB.batch.bind(env.DB);let injected=false;
  env.DB.batch=async stmts=>{if(!injected&&stmts.some(s=>s.sql.includes("SET status='sold'"))){injected=true;await selectAccountCharacter(env,'222',second.char.tg_id,T0);}return batch(stmts);};
  await assert.rejects(Market.buy(env,'222',{listingId:id,requestId:uuid()},T0));
  assert.equal(gold(env.DB,'222'),100000);assert.equal(gold(env.DB,'111'),100000);
  assert.equal(inv(env.DB,'222','scroll_w'),100);assert.equal(env.DB.sqlite.prepare('SELECT status FROM rpg_exchange_listings WHERE id=?').get(id).status,'active');
  assert.deepEqual(counts(env.DB),{listings:1,operations:1,ledgers:1});
});

test('review: sellable read tolerates gear disappearing between indexed candidate and detail reads', async () => {
  const { env, gear }=await fixture(), e=await gear(),prepare=env.DB.prepare.bind(env.DB);let injected=false;
  env.DB.prepare=sql=>{const s=prepare(sql);if(sql.startsWith('SELECT * FROM rpg_equipment WHERE tg_id=? AND id IN')){const bind=s.bind.bind(s);s.bind=(...p)=>{const bound=bind(...p),all=bound.all.bind(bound);bound.all=async()=>{if(!injected){injected=true;await Player.withPlayer(env,'111',T0,(w,c)=>Player.sellGear(w,c,{itemId:e.id,requestId:'audit-reader-race'}));}return all();};return bound;};}return s;};
  const r=await Market.sellable(env,'111',{filters:{category:'equipment'}});
  assert.equal(r.ok,true);assert.ok(!r.items.some(x=>x.equipId===e.id));assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_equipment WHERE id=?').get(e.id).n,0);
});

test('review: ended auto jobs cannot be revived onto escrow by old UPDATE paths', async () => {
  const { env,gear }=await fixture(), e=await gear();
  const enhanced=await Enhance.start(env,'111',{itemId:e.id,target:5},T0);
  await Enhance.stop(env,'111',{jobId:enhanced.job.id},T0);
  const rerolled=await Reroll.start(env,'111',{itemId:e.id,functions:['attack'],requestId:'audit-stopped-reroll'},T0);
  await Reroll.stop(env,'111',{jobId:rerolled.job.id},T0);
  const id=(await listing(env,{equipId:e.id,item:undefined,qty:1})).result.listingId;
  for(const [table,job]of [['rpg_auto_enhance',enhanced.job.id],['rpg_auto_reroll',rerolled.job.id]])for(const status of ['running','processing']) {
    await assert.rejects(env.DB.prepare(`UPDATE ${table} SET status=? WHERE id=?`).bind(status,job).run(), /exchange_equipment_locked/);
    assert.equal(env.DB.sqlite.prepare(`SELECT status FROM ${table} WHERE id=?`).get(job).status,'ended');
  }
  assert.equal(env.DB.sqlite.prepare('SELECT trade_id FROM rpg_equipment WHERE id=?').get(e.id).trade_id,'exchange:'+id);
});

test('review: start enhancement versus list same gear leaves exactly one exclusive owner', async () => {
  const { env,gear }=await fixture(), e=await gear();
  const result=await Promise.allSettled([listing(env,{equipId:e.id,item:undefined,qty:1}),Enhance.start(env,'111',{itemId:e.id,target:5},T0)]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  const inMarket=env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_exchange_listings WHERE ref=? AND status='active'").get(e.id).n;
  const running=env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_auto_enhance WHERE item_id=? AND status IN ('running','processing')").get(e.id).n;
  assert.equal(inMarket+running,1);assert.equal(gold(env.DB,'111'),100000);
});

test('review: guardian escrow retains real FK and original row; UUID retry cannot add it to two bags',async()=>{
  const { env,guardian }=await fixture(),g=await guardian(),requestId=uuid(),body={guardianId:g.id,qty:1,price:101,requestId};
  assert.equal(env.DB.sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys,1,'verify FK constraints are enabled');
  const res=await Promise.all([Market.create(env,'111',body,T0),Market.create(env,'111',body,T0)]);
  const id=res[0].result.listingId;assert.equal(res[1].result.listingId,id);
  const row=env.DB.sqlite.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=?').get(g.id);
  assert.equal(row.exchange_id,id);assert.equal(row.trade_id,null);assert.equal(row.char_id,'111');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_trades').get().n,0,'no fake private trade');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_guardian_sigils WHERE id=?').get(g.id).n,1);
  assert.deepEqual(env.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  const state=await Guardian.state(env,'111',T0);const view=state.inventory.items.find(x=>x.id===g.id);
  assert.equal(view.inExchange,true);assert.equal(view.inTrade,true);assert.equal(state.activeGuardian,null);
  assert.ok(!(await Special.view(env,'111',T0)).guardianChoices.some(x=>x.id===g.id));
});

test('review: guardian buy race preserves the actual type, rank and PvE ability upon buyer activation',async()=>{
  const { env,guardian }=await fixture(),g=await guardian('melee',7),id=(await Market.create(env,'111',{guardianId:g.id,price:1001,requestId:uuid()},T0)).result.listingId;
  const results=await Promise.allSettled(['222','333'].map(tg=>Market.buy(env,tg,{listingId:id,requestId:uuid()},T0)));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);const who=results[0].status==='fulfilled'?'222':'333',loser=who==='222'?'333':'222';
  assert.equal(gold(env.DB,'111'),100950);assert.equal(gold(env.DB,who),98999);assert.equal(gold(env.DB,loser),100000);
  const row=env.DB.sqlite.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=?').get(g.id);
  assert.equal(row.char_id,who);assert.equal(row.type,'melee');assert.equal(row.quality,7);assert.equal(row.exchange_id,null);assert.equal(row.trade_id,null);assert.equal(row.bound,0);
  assert.ok(!(await Guardian.state(env,'111',T0)).inventory.items.some(x=>x.id===g.id));
  await Guardian.activate(env,who,{itemId:g.id,requestId:'audit_activate_'+uuid().replaceAll('-','')},T0);
  const p=await loadPlayer(env.DB,who,env);assert.equal(p.char.guardian.id,g.id);assert.equal(p.char.guardian.rank,7);
  assert.equal(guardianDamageMultiplier(p.char),1+activeSettings(env).damageBonuses[6]);assert.equal(guardianLootMultiplier(p.char),1);
  await assert.rejects(Market.create(env,who,{guardianId:g.id,price:20,requestId:uuid()},T0));
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_ledger WHERE event_id=?').get('exchange:'+id+':fee').n,1);
});

test('review: guardian buy/cancel races and final ledger rollback never duplicate ownership or charges',async()=>{
  const { env,guardian }=await fixture(),g=await guardian('loot',8),id=(await Market.create(env,'111',{guardianId:g.id,price:101,requestId:uuid()},T0)).result.listingId;
  env.DB.sqlite.exec(`CREATE TRIGGER audit_guardian_last BEFORE INSERT ON rpg_ledger WHEN NEW.event_id='exchange:${id}:fee' BEGIN SELECT RAISE(ABORT,'audit_last_statement_failed'); END;`);
  const before=counts(env.DB);await assert.rejects(Market.buy(env,'222',{listingId:id,requestId:uuid()},T0));
  assert.deepEqual(counts(env.DB),before);assert.equal(gold(env.DB,'111'),100000);assert.equal(gold(env.DB,'222'),100000);
  assert.equal(env.DB.sqlite.prepare('SELECT exchange_id,char_id FROM rpg_guardian_sigils WHERE id=?').get(g.id).exchange_id,id);
  env.DB.sqlite.exec('DROP TRIGGER audit_guardian_last');
  const res=await Promise.allSettled([Market.buy(env,'222',{listingId:id,requestId:uuid()},T0),Market.cancel(env,'111',{listingId:id,requestId:uuid()},T0)]);
  assert.equal(res.filter(x=>x.status==='fulfilled').length,1);
  const row=env.DB.sqlite.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=?').get(g.id),status=env.DB.sqlite.prepare('SELECT status FROM rpg_exchange_listings WHERE id=?').get(id).status;
  assert.equal(row.exchange_id,null);assert.equal(row.trade_id,null);assert.equal(row.quality,8);assert.equal(row.type,'loot');
  assert.equal(row.char_id,status==='sold'?'222':'111');assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_guardian_sigils WHERE id=?').get(g.id).n,1);
  assert.equal(gold(env.DB,'111'),status==='sold'?100095:100000);assert.equal(gold(env.DB,'222'),status==='sold'?99899:100000);
  assert.deepEqual(env.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('review: guardian escrow blocks activation, assistance, fuse, lock, share, private trade and raw mutation',async()=>{
  const { env,guardian }=await fixture(),rows=[];for(let i=0;i<4;i++)rows.push(await guardian('melee',1));
  const g=rows[0],id=(await Market.create(env,'111',{guardianId:g.id,price:20,requestId:uuid()},T0)).result.listingId;
  await invDeltaStmt(env.DB,'111','guardian_summon_stone',1).run();
  const trade=await Trade.openTradeStmts(env,{aTg:'111',bTg:'222'},T0);await env.DB.batch(trade.stmts);
  const before=await loadPlayer(env.DB,'111',env),ops=env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_guardian_operations').get().n;
  const call=(method,b)=>Guardian[method](env,'111',{...b,requestId:'audit_block_'+uuid().replaceAll('-','')},T0);
  for(const fn of [()=>call('activate',{itemId:g.id}),()=>call('lock',{itemId:g.id,locked:true}),()=>call('unbind',{itemId:g.id}),()=>call('share',{itemId:g.id}),()=>call('fuse',{itemIds:rows.map(x=>x.id),primaryId:g.id}),()=>call('assist',{mode:'select',itemId:g.id}),()=>call('assist',{mode:'start',itemId:g.id}),()=>Special.action(env,'111',{op:'settings',mode:'safe',budget:0,guardianId:g.id},T0),()=>Trade.addLine(env,{tgId:'111',tradeId:trade.id,sigilId:g.id},T0)]) {
    await assert.rejects(fn,error=>typeof error.code==='string');assert.deepEqual(await loadPlayer(env.DB,'111',env),before);
  }
  for(const sql of ['UPDATE rpg_guardian_sigils SET active=1,bound=1 WHERE id=?','UPDATE rpg_guardian_sigils SET locked=1 WHERE id=?','UPDATE rpg_guardian_sigils SET exchange_id=NULL WHERE id=?','DELETE FROM rpg_guardian_sigils WHERE id=?']) await assert.rejects(env.DB.prepare(sql).bind(g.id).run(), /exchange_guardian_locked/);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_guardian_operations').get().n,ops);assert.equal(env.DB.sqlite.prepare('SELECT exchange_id FROM rpg_guardian_sigils WHERE id=?').get(g.id).exchange_id,id);
});

test('review: all eight guardian qualities and real type classes filter independently of gear T/quality',async()=>{
  const { env,guardian }=await fixture(),created=[];
  for(let i=0;i<QUALITY_ORDER.length;i++){const type=['melee','ranged','magic','loot'][i%4],g=await guardian(type,i+1),r=await Market.create(env,'111',{guardianId:g.id,price:20,requestId:uuid()},T0);created.push({g,r});assert.equal(r.result.listing.kind,'guardian');assert.equal(r.result.listing.category,'guardian');assert.equal(r.result.listing.quality,QUALITY_ORDER[i]);assert.equal(r.result.listing.tier,null);assert.equal(r.result.listing.enhance,null);assert.equal(r.result.listing.qty,1);assert.equal(r.result.listing.guardian.rank,i+1);}
  for(const quality of QUALITY_ORDER){const r=await Market.list(env,'222',{filters:{category:'guardian',quality}});assert.equal(r.items.length,1);assert.equal(r.items[0].guardian.quality,quality);}
  const byClass=await Market.list(env,'222',{filters:{category:'guardian',classReq:'mage'}});assert.equal(byClass.items.length,4);assert.ok(byClass.items.every(x=>['magic','loot'].includes(x.guardian.type)));
  assert.equal((await Market.list(env,'222',{filters:{category:'guardian',tier:1}})).items.length,0);
  assert.equal((await Market.list(env,'222',{filters:{category:'guardian',enhanceMin:0}})).items.length,0);
  assert.equal((await Market.sellable(env,'111',{filters:{category:'guardian'}})).items.length,0);
});

test('review: old guardian share request becomes unavailable when listing begins; direct trade works again after cancel',async()=>{
  const { env,guardian }=await fixture(),g=await guardian('magic',4);
  const share=await Guardian.share(env,'111',{itemId:g.id,requestId:'audit_pre_share_'+uuid().replaceAll('-','')},T0);
  const shareId=share.operation.shareId,asked=await Sharing.requestTrade(env,{tgId:'222',shareId},T0);
  const created=await Market.create(env,'111',{guardianId:g.id,price:20,requestId:uuid()},T0);
  assert.equal((await Sharing.shareView(env,shareId)).tradeable,false);
  await assert.rejects(Sharing.acceptRequest(env,{tgId:'111',requestId:asked.id},T0),e=>typeof e.code==='string');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_trades').get().n,0);
  await Market.cancel(env,'111',{listingId:created.result.listingId,requestId:uuid()},T0);
  const opened=await Trade.openTradeStmts(env,{aTg:'111',bTg:'222',preSigil:env.DB.sqlite.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=?').get(g.id)},T0);await env.DB.batch(opened.stmts);
  const row=env.DB.sqlite.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=?').get(g.id);assert.equal(row.exchange_id,null);assert.equal(row.trade_id,opened.id);assert.deepEqual(env.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('review: guardian cannot trade active/bound/locked rows or under-level buyers; seller party keeps escrow safe',async()=>{
  const { env,guardian }=await fixture();
  for(const change of ['bound=1','locked=1','active=1,bound=1']){const g=await guardian();await env.DB.prepare('UPDATE rpg_guardian_sigils SET '+change+' WHERE id=?').bind(g.id).run();await assert.rejects(Market.create(env,'111',{guardianId:g.id,price:20,requestId:uuid()},T0));}
  const g=await guardian(),id=(await Market.create(env,'111',{guardianId:g.id,price:101,requestId:uuid()},T0)).result.listingId,before=counts(env.DB);
  await env.DB.prepare("UPDATE rpg_characters SET level=14 WHERE tg_id='222'").run();await assert.rejects(Market.buy(env,'222',{listingId:id,requestId:uuid()},T0),e=>e.code==='guardian_level');
  await env.DB.prepare("UPDATE rpg_characters SET level=120 WHERE tg_id='222'").run();await env.DB.prepare("UPDATE rpg_characters SET party_id='audit-party' WHERE tg_id='111'").run();
  await assert.rejects(Market.buy(env,'222',{listingId:id,requestId:uuid()},T0),e=>e.code==='party');await assert.rejects(Market.cancel(env,'111',{listingId:id,requestId:uuid()},T0),e=>e.code==='party');
  assert.deepEqual(counts(env.DB),before);assert.equal(gold(env.DB,'222'),100000);assert.equal(gold(env.DB,'111'),100000);assert.equal(env.DB.sqlite.prepare('SELECT exchange_id FROM rpg_guardian_sigils WHERE id=?').get(g.id).exchange_id,id);
});

test('review: same-account guardian cancel returns original character and inactive original receives sale proceeds',async()=>{
  const { env,guardian }=await fixture(),g=await guardian('ranged',6),created=await Market.create(env,'111',{guardianId:g.id,price:101,requestId:uuid()},T0);
  const second=await Player.createCharacter(env,{tgId:'111',name:'天使换角',gender:'f',baseClass:'mage'},T0);await env.DB.prepare('UPDATE rpg_characters SET level=120 WHERE tg_id=?').bind(second.char.tg_id).run();
  await selectAccountCharacter(env,'111',second.char.tg_id,T0);
  await assert.rejects(Market.buy(env,second.char.tg_id,{listingId:created.result.listingId,requestId:uuid()},T0),e=>e.code==='self_trade');
  const requestId=uuid();await Market.cancel(env,second.char.tg_id,{listingId:created.result.listingId,requestId},T0);await Market.cancel(env,second.char.tg_id,{listingId:created.result.listingId,requestId},T0);
  let row=env.DB.sqlite.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=?').get(g.id);assert.equal(row.char_id,'111');assert.equal(row.exchange_id,null);
  await selectAccountCharacter(env,'111','111',T0);const id=(await Market.create(env,'111',{guardianId:g.id,price:101,requestId:uuid()},T0)).result.listingId;
  await selectAccountCharacter(env,'111',second.char.tg_id,T0);const otherGold=gold(env.DB,second.char.tg_id);
  await Market.buy(env,'222',{listingId:id,requestId:uuid()},T0);assert.equal(gold(env.DB,'111'),100095);assert.equal(gold(env.DB,second.char.tg_id),otherGold);
  row=env.DB.sqlite.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=?').get(g.id);assert.equal(row.char_id,'222');assert.equal(row.exchange_id,null);assert.deepEqual(env.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('review: guardian becoming active between sellable candidate/detail reads disappears cleanly',async()=>{
  const { env,guardian }=await fixture(),g=await guardian(),prepare=env.DB.prepare.bind(env.DB);let injected=false;
  env.DB.prepare=sql=>{const s=prepare(sql);if(sql.startsWith('SELECT * FROM rpg_guardian_sigils WHERE char_id=? AND id IN')){const bind=s.bind.bind(s);s.bind=(...p)=>{const bound=bind(...p),all=bound.all.bind(bound);bound.all=async()=>{if(!injected){injected=true;await Guardian.activate(env,'111',{itemId:g.id,requestId:'audit_read_activate_'+uuid().replaceAll('-','')},T0);}return all();};return bound;};}return s;};
  const r=await Market.sellable(env,'111',{filters:{category:'guardian'}});assert.equal(r.ok,true);assert.ok(!r.items.some(x=>x.guardianId===g.id));assert.equal(env.DB.sqlite.prepare('SELECT active FROM rpg_guardian_sigils WHERE id=?').get(g.id).active,1);
});
