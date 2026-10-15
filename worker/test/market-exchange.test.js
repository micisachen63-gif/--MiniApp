import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import * as P from '../src/services/player.js';
import * as X from '../src/services/market-exchange.js';
import * as A from '../src/services/auto-enhance.js';
import * as R from '../src/services/auto-reroll.js';
import * as SP from '../src/services/special.js';
import { selectAccountCharacter } from '../src/accounts.js';
import { handle } from '../src/index.js';
import { ITEMS, TRADE } from '../src/game/constants.js';
import { SPECIAL_SKILLS, baseOf } from '../src/game/special.js';
import { checkItemLine } from '../src/game/trade.js';
import { makeGear } from '../src/game/gear.js';
import { insertEquipStmt, loadPlayer, clonePlayer, persistStatements } from '../src/db.js';

const op=(characterId,body={})=>({characterId,requestId:crypto.randomUUID(),...body});
const scalar=(db,sql,...args)=>db.sqlite.prepare(sql).get(...args);
const gold=(db,id)=>scalar(db,'SELECT gold FROM rpg_characters WHERE tg_id=?',id).gold;
const qty=(db,id,item)=>scalar(db,'SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?',id,item)?.quantity||0;
async function stock(db,id,item,n) {await db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').bind(id,item,n).run();}
async function setup() {
  const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};
  for(const id of ['111','222','333']) {
    await P.createCharacter(env,{tgId:id,name:'旅者'+id,gender:'m',baseClass:'sword'},T0);
    await env.DB.prepare('UPDATE rpg_characters SET gold=2000000 WHERE tg_id=?').bind(id).run();
    await stock(env.DB,id,'scroll_w',100);
  }
  const gear=await addGear(env.DB,'111','market-gear');
  return {env,db:env.DB,gear};
}
async function addGear(db,id,key,over={}) {
  const e={...makeGear({id:key,tgId:id,cls:'sword',slot:'helmet',tier:1,rng:()=>.5,now:T0}),...over};
  await insertEquipStmt(db,e).run();return e;
}
const create=(env,id,body)=>X.create(env,id,op(id,body),T0);
const buy=(env,id,listingId)=>X.buy(env,id,op(id,{listingId}),T0);
const cancel=(env,id,listingId)=>X.cancel(env,id,op(id,{listingId}),T0);
async function api(env,tg,action,body={}) {
  const r=await handle(new Request('http://local/app/api/exchange/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':tg,'X-Debug-Now':String(T0)},body:JSON.stringify(body)}),env);
  return {status:r.status,body:await r.json()};
}
const audit=db=>({listings:scalar(db,'SELECT COUNT(*) n FROM rpg_exchange_listings').n,receipts:scalar(db,'SELECT COUNT(*) n FROM rpg_exchange_operations').n,ledger:scalar(db,"SELECT COUNT(*) n FROM rpg_ledger WHERE event_id LIKE 'exchange:%'").n});

test('real Mini App lists gear, atomically escrows it and settles 5% once with the original UUID',async()=>{
  const {env,db,gear}=await setup(),body=op('111',{equipId:gear.id,price:101,qty:1});
  const opened=await api(env,'111','create',body);assert.equal(opened.status,200,JSON.stringify(opened.body));
  const id=opened.body.result.listingId;
  assert.equal(scalar(db,'SELECT trade_id FROM rpg_equipment WHERE id=?',gear.id).trade_id,'exchange:'+id);
  assert.equal(gold(db,'111'),2000000);
  const duplicate=await api(env,'111','create',body);assert.equal(duplicate.body.result.listingId,id);
  const listed=await api(env,'222','list',{});assert.equal(listed.body.items[0].id,id);assert.equal(listed.body.items[0].fee,6);
  const pay=op('222',{listingId:id});const done=await api(env,'222','buy',pay);assert.equal(done.status,200);
  assert.equal(done.body.result.netGold,95);assert.equal(gold(db,'111'),2000095);assert.equal(gold(db,'222'),1999899);
  assert.equal(scalar(db,'SELECT tg_id,trade_id FROM rpg_equipment WHERE id=?',gear.id).tg_id,'222');
  assert.equal((await api(env,'222','buy',pay)).status,200);
  assert.equal(gold(db,'222'),1999899);assert.equal((await X.list(env,'222')).items.length,0);
  assert.deepEqual(audit(db),{listings:1,receipts:2,ledger:4});
  assert.equal(scalar(db,"SELECT request_id FROM rpg_exchange_operations WHERE action='buy'").request_id,pay.requestId);
});

test('whole stacks escrow, cancellation and disconnect retry conserve inventory with no cancellation fee',async()=>{
  const {env,db}=await setup();const req=op('111',{item:'scroll_w',qty:100,price:500});
  const created=await X.create(env,'111',req,T0);assert.equal(qty(db,'111','scroll_w'),0);
  assert.equal((await X.create(env,'111',req,T0)).result.listingId,created.result.listingId);
  const undo=op('111',{listingId:created.result.listingId});await X.cancel(env,'111',undo,T0);
  await X.cancel(env,'111',undo,T0);assert.equal(qty(db,'111','scroll_w'),100);
  assert.equal(gold(db,'111'),2000000);assert.deepEqual(audit(db),{listings:1,receipts:2,ledger:2});
});

test('60 raw collection materials are exchange-only, while finished badges and all other bound resources stay bound',async()=>{
  const {env,db}=await setup();const raw=Object.keys(ITEMS).filter(k=>/^hunt_/.test(k));assert.equal(raw.length,60);
  for(const key of raw)await stock(db,'111',key,2);
  const seen=[];let cursor=null;do{const page=await X.sellable(env,'111',{filters:{category:'collection'},cursor});seen.push(...page.items);cursor=page.nextCursor;}while(cursor);
  assert.equal(seen.length,60);assert.ok(seen.every(i=>i.category==='collection'&&i.tier===null&&i.mapId>=1));
  assert.ok(!TRADE.tradeableItems.includes('hunt_1_1'));assert.throws(()=>checkItemLine('hunt_1_1',1),e=>e.code==='untradeable');
  const id=(await create(env,'111',{item:'hunt_1_1',qty:2,price:20})).result.listingId;await buy(env,'222',id);
  assert.equal(qty(db,'111','hunt_1_1'),0);assert.equal(qty(db,'222','hunt_1_1'),2);
  for(const item of ['collection_1','research_fragment','tower_fragment','boss_essence','relic_fragment','guardian_voucher','guardian_summon_stone','guardian_free_normal','trial_3','trial_4','hunt_99_1']) {
    await stock(db,'111',item,1);await assert.rejects(create(env,'111',{item,price:20}),e=>['untradeable','item'].includes(e.code));
  }
  assert.equal(audit(db).listings,1);
});

test('all 54 skill books use their real profession, rarity, learning level and advancement fields',async()=>{
  const {env,db}=await setup();const skills=SPECIAL_SKILLS;assert.equal(skills.length,54);
  for(const skill of skills)await stock(db,'111','book_'+skill.id,1);
  const books=[];let cursor=null;do{const page=await X.sellable(env,'111',{filters:{category:'skillbook'},cursor});books.push(...page.items);cursor=page.nextCursor;}while(cursor);
  assert.equal(books.length,54);assert.equal(new Set(books.map(i=>i.item)).size,54);
  for(const skill of skills) {const b=books.find(i=>i.item==='book_'+skill.id);assert.equal(b.classReq,baseOf(skill));assert.equal(b.quality,skill.rarity);assert.equal(b.tier,null);assert.equal(b.advancementTier,skill.advancementTier);assert.equal(b.requiredLevel,skill.level);}
  for(const cls of ['sword','archer','mage']) {const page=await X.sellable(env,'111',{filters:{category:'skillbook',classReq:cls}});assert.ok(page.items.length);assert.ok(page.items.every(i=>i.classReq===cls));}
});

test('a learned duplicate book stays a real tradeable item; buying and learning consume exactly that copy',async()=>{
  const {env,db}=await setup(),s=SPECIAL_SKILLS.find(s=>baseOf(s)==='sword'&&s.advancementTier===1);
  await db.prepare("UPDATE rpg_characters SET level=35,class_path='A',special_json=? WHERE tg_id='111'").bind(JSON.stringify({learned:[s.id],loadout:[],auto:{}})).run();
  await stock(db,'111','book_'+s.id,1);
  const id=(await create(env,'111',{item:'book_'+s.id,price:100})).result.listingId;await buy(env,'222',id);
  await db.prepare("UPDATE rpg_characters SET level=35,class_path='A' WHERE tg_id='222'").run();
  await SP.action(env,'222',{op:'learn',skillId:s.id},T0);
  assert.equal(qty(db,'222','book_'+s.id),0);assert.ok(JSON.parse(scalar(db,"SELECT special_json FROM rpg_characters WHERE tg_id='222'").special_json).learned.includes(s.id));
  assert.ok(JSON.parse(scalar(db,"SELECT special_json FROM rpg_characters WHERE tg_id='111'").special_json).learned.includes(s.id));
});

test('two buyers race: exactly one receives the gear, pays, and credits the seller',async()=>{
  const {env,db,gear}=await setup(),id=(await create(env,'111',{equipId:gear.id,price:1000})).result.listingId;
  const outcomes=await Promise.allSettled([buy(env,'222',id),buy(env,'333',id)]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  const winner=scalar(db,'SELECT tg_id FROM rpg_equipment WHERE id=?',gear.id).tg_id;
  assert.ok(['222','333'].includes(winner));assert.equal(gold(db,winner),1999000);assert.equal(gold(db,winner==='222'?'333':'222'),2000000);
  assert.equal(gold(db,'111'),2000950);assert.deepEqual(audit(db),{listings:1,receipts:2,ledger:4});
});

test('buy versus cancel race can only transfer to the buyer or return to the seller',async()=>{
  const {env,db}=await setup(),id=(await create(env,'111',{item:'scroll_w',qty:7,price:1000})).result.listingId;
  const outcomes=await Promise.allSettled([buy(env,'222',id),cancel(env,'111',id)]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  const row=scalar(db,'SELECT status FROM rpg_exchange_listings WHERE id=?',id);
  if(row.status==='sold'){assert.equal(qty(db,'111','scroll_w'),93);assert.equal(qty(db,'222','scroll_w'),107);assert.equal(gold(db,'111'),2000950);assert.equal(gold(db,'222'),1999000);}
  else{assert.equal(row.status,'cancelled');assert.equal(qty(db,'111','scroll_w'),100);assert.equal(qty(db,'222','scroll_w'),100);assert.equal(gold(db,'111'),2000000);assert.equal(gold(db,'222'),2000000);}
});

test('concurrent upserts of the same equipment or the last stack never create phantom escrow',async()=>{
  for(const itemKind of ['equip','item']) {
    const {env,db,gear}=await setup(),body=itemKind==='equip'?{equipId:gear.id,price:25}:{item:'scroll_w',qty:100,price:25};
    const outcomes=await Promise.allSettled([create(env,'111',body),create(env,'111',body)]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.deepEqual(audit(db),{listings:1,receipts:1,ledger:1});
    if(itemKind==='item')assert.equal(qty(db,'111','scroll_w'),0);
  }
});

test('same UUID in parallel returns a single committed receipt; different payload and different actor cannot reuse it',async()=>{
  const {env,db}=await setup(),req=op('111',{item:'scroll_w',qty:1,price:20});
  const r=await Promise.all([X.create(env,'111',req,T0),X.create(env,'111',req,T0)]);assert.equal(r[0].result.listingId,r[1].result.listingId);
  for(const change of [{price:21},{qty:2},{item:'scroll_a'},{characterId:'222'}])await assert.rejects(X.create(env,'111',{...req,...change},T0),e=>e.code==='request_reused');
  assert.equal(qty(db,'111','scroll_w'),99);assert.deepEqual(audit(db),{listings:1,receipts:1,ledger:1});
});

test('inactive sellers receive their own payout and cancellation returns to the original character; same-account buying is rejected',async()=>{
  const {env,db}=await setup(),gear=await addGear(db,'111','original-gear');
  const gearId=(await create(env,'111',{equipId:gear.id,price:1000})).result.listingId;
  const itemId=(await create(env,'111',{item:'scroll_w',qty:3,price:20})).result.listingId;
  const other=(await P.createCharacter(env,{tgId:'111',name:'另一旅者',gender:'f',baseClass:'mage'},T0)).char.tg_id;
  await selectAccountCharacter(env,'111',other,T0);
  await assert.rejects(buy(env,other,gearId),e=>e.code==='self_trade');
  assert.equal((await X.mine(env,other)).items.length,2);
  await buy(env,'222',gearId);assert.equal(gold(db,'111'),2000950);assert.equal(gold(db,other),1000);
  const r=await cancel(env,other,itemId);assert.equal(r.result.returnedCharacterId,'111');assert.equal(qty(db,'111','scroll_w'),100);assert.equal(qty(db,other,'scroll_w'),0);
  await assert.rejects(cancel(env,'333',gearId),e=>e.code==='not_owned');
});

test('actor captured by the UI cannot buy from a newly selected character, including a switch immediately before atomic commit',async()=>{
  const {env,db}=await setup(),id=(await create(env,'111',{item:'scroll_w',price:100})).result.listingId;
  const other=(await P.createCharacter(env,{tgId:'222',name:'切角旅者',gender:'f',baseClass:'mage'},T0)).char.tg_id;
  await selectAccountCharacter(env,'222',other,T0);
  const old=await api(env,'222','buy',op('222',{listingId:id}));assert.equal(old.status,409);assert.equal(old.body.error,'character_changed');
  assert.equal(gold(db,other),1000);assert.equal(gold(db,'222'),2000000);
  await selectAccountCharacter(env,'222','222',T0);
  const original=db.batch.bind(db);let fired=false;
  db.batch=async stmts=>{if(!fired&&stmts.some(s=>s.sql.startsWith('UPDATE rpg_exchange_listings'))){fired=true;db.sqlite.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(other,'222');}return original(stmts);};
  await assert.rejects(buy(env,'222',id),e=>e.code==='conflict');
  assert.equal(gold(db,'222'),2000000);assert.equal(scalar(db,'SELECT status FROM rpg_exchange_listings WHERE id=?',id).status,'active');
  assert.equal(qty(db,'222','scroll_w'),100);
});

test('injected final ledger failure rolls back listing, both wallets, ownership and receipt',async()=>{
  const {env,db,gear}=await setup(),id=(await create(env,'111',{equipId:gear.id,price:500})).result.listingId;
  db.sqlite.exec("CREATE TRIGGER break_exchange_fee BEFORE INSERT ON rpg_ledger WHEN NEW.type='交易所手續費' BEGIN SELECT RAISE(ABORT,'injected_last_statement'); END;");
  await assert.rejects(buy(env,'222',id),/injected_last_statement/);
  assert.equal(scalar(db,'SELECT status FROM rpg_exchange_listings WHERE id=?',id).status,'active');assert.equal(gold(db,'111'),2000000);assert.equal(gold(db,'222'),2000000);
  assert.equal(scalar(db,'SELECT tg_id,trade_id FROM rpg_equipment WHERE id=?',gear.id).trade_id,'exchange:'+id);assert.deepEqual(audit(db),{listings:1,receipts:1,ledger:1});
});

test('lost transfer row and concurrent background wallet debit roll back the complete purchase',async()=>{
  for(const failure of ['gear','wallet']) {
    const {env,db,gear}=await setup(),id=(await create(env,'111',{equipId:gear.id,price:500})).result.listingId;
    const original=db.batch.bind(db);let fired=false;
    db.batch=async stmts=>{if(!fired&&stmts.some(s=>s.sql.startsWith('UPDATE rpg_exchange_listings'))){fired=true;if(failure==='gear')db.sqlite.exec("CREATE TRIGGER ignore_transfer BEFORE UPDATE ON rpg_equipment WHEN NEW.tg_id='222' BEGIN SELECT RAISE(IGNORE); END;");else db.sqlite.prepare("UPDATE rpg_characters SET gold=10,rev=rev+1 WHERE tg_id='222'").run();}return original(stmts);};
    await assert.rejects(buy(env,'222',id),e=>e.code==='conflict');
    assert.equal(gold(db,'111'),2000000);assert.equal(gold(db,'222'),failure==='wallet'?10:2000000);assert.equal(scalar(db,'SELECT status FROM rpg_exchange_listings WHERE id=?',id).status,'active');assert.deepEqual(audit(db),{listings:1,receipts:1,ledger:1});
  }
});

test('exchange revision invalidates an old withPlayer snapshot so an idle write cannot overwrite payout',async()=>{
  const {env,db}=await setup(),id=(await create(env,'111',{item:'scroll_w',price:1000})).result.listingId;
  const before=await loadPlayer(db,'111'),after=clonePlayer(before);after.char.gold+=3;
  await buy(env,'222',id);
  await assert.rejects(db.batch(persistStatements(db,before,after,{},T0)),/rpg_guard.ok/);assert.equal(gold(db,'111'),2000950);
});

test('twentieth account-wide listing succeeds; the twenty-first fully rolls back and cancellation frees a slot',async()=>{
  const {env,db}=await setup();for(let i=0;i<20;i++)await create(env,'111',{item:'scroll_w',price:20});
  const before=audit(db),oldQty=qty(db,'111','scroll_w'),rev=scalar(db,"SELECT rev FROM rpg_characters WHERE tg_id='111'").rev;
  await assert.rejects(create(env,'111',{item:'scroll_w',price:20}),e=>e.code==='conflict');assert.deepEqual(audit(db),before);assert.equal(qty(db,'111','scroll_w'),oldQty);assert.equal(scalar(db,"SELECT rev FROM rpg_characters WHERE tg_id='111'").rev,rev);
  await cancel(env,'111',(await X.mine(env,'111')).items[0].id);await create(env,'111',{item:'scroll_w',price:20});
  assert.equal(scalar(db,"SELECT COUNT(*) n FROM rpg_exchange_listings WHERE status='active'").n,20);
});

test('gear filters use real class/T/rarity/enhancement, include any, and stable keyset pages never duplicate listings',async()=>{
  const {env,db}=await setup();
  const fixtures=[['sword-12',{class_req:'sword',tier:12,enhance_level:15,element_tier:'supreme'}],['mage-12',{class_req:'mage',tier:12,enhance_level:15,element_tier:'supreme'}],['any-12',{slot:'ring',kind:'ring',class_req:'any',tier:12,enhance_level:15,element_tier:'supreme'}]];
  for(const [key,over] of fixtures){await addGear(db,'111',key,over);await create(env,'111',{equipId:key,price:40});}
  const filtered=(await X.list(env,'222',{filters:{category:'equipment',classReq:'sword',tier:12,quality:'supreme',enhanceMin:15,enhanceMax:15}})).items;
  assert.deepEqual(filtered.map(i=>i.equipId).sort(),['any-12','sword-12']);assert.equal((await X.list(env,'222',{filters:{classReq:'any'}})).items.length,1);
  for(let i=0;i<17;i++)await create(env,'111',{item:'scroll_w',price:20});for(let i=0;i<20;i++)await create(env,'333',{item:'scroll_w',price:20});
  const first=await X.list(env,'222');assert.equal(first.items.length,30);assert.ok(first.nextCursor);const second=await X.list(env,'222',{cursor:first.nextCursor});assert.equal(second.items.length,10);assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,40);
});

test('prices 1/19/20/21/1m and qty 99999 settle exact rounded fees and do not invent fractional coin values',async()=>{
  const {env,db}=await setup();for(const price of [1,19,20,21,1000000]) {
    const before=gold(db,'111'),id=(await create(env,'111',{item:'scroll_w',price})).result.listingId;
    const r=await buy(env,'222',id);assert.equal(r.result.fee,Math.ceil(price/20));assert.equal(gold(db,'111')-before,price-Math.ceil(price/20));
  }
  await stock(db,'111','hunt_12_core',99999);const id=(await create(env,'111',{item:'hunt_12_core',qty:99999,price:20})).result.listingId;await buy(env,'333',id);assert.equal(qty(db,'333','hunt_12_core'),99999);
});

test('invalid types, numbers, UUIDs, injection filters and unknown items fail before any side effect',async()=>{
  const {env,db,gear}=await setup();const before=audit(db);
  for(const price of [0,-1,1.5,1000001,Infinity,NaN,'20','1e3',null,{},[]])await assert.rejects(create(env,'111',{item:'scroll_w',price}),e=>e.code==='price');
  for(const n of [0,-1,1.5,100000,Infinity,'2',null,{},[]])await assert.rejects(create(env,'111',{item:'scroll_w',qty:n,price:20}),e=>e.code==='qty');
  for(const body of [op('111',{equipId:gear.id,item:'scroll_w',price:20}),op('111',{price:20}),op('111',{item:"scroll_w' OR 1=1--",price:20}),op('111',{item:'scroll_w',price:20,requestId:'not-a-uuid'}),null,[]])await assert.rejects(X.create(env,'111',body,T0));
  for(const filters of [{category:"equipment' OR 1=1--"},{classReq:'constructor'},{tier:'1'},{quality:'rare'},{enhanceMin:16},{enhanceMin:5,enhanceMax:3},[]])await assert.rejects(X.list(env,'111',{filters}),e=>e.code==='filters');
  for(const cursor of ['0','1 OR 1=1',{},'-1',1])await assert.rejects(X.list(env,'111',{cursor}),e=>e.code==='cursor');
  assert.deepEqual(audit(db),before);assert.equal(qty(db,'111','scroll_w'),100);assert.equal(gold(db,'111'),2000000);
});

test('equipped, bound, starter, direct-trade and running background equipment never enter sellable or exchange',async()=>{
  const {env,db}=await setup();for(const [id,over] of [['worn',{is_equipped:1,bound:1}],['bound',{bound:1}],['starter-unbound',{source:'starter',bound:0}],['private-trade',{trade_id:'direct'}]]){await addGear(db,'111',id,over);await assert.rejects(create(env,'111',{equipId:id,price:20}),e=>e.code==='untradeable');}
  await addGear(db,'111','enhancing');await A.start(env,'111',{itemId:'enhancing',target:5},T0);await assert.rejects(create(env,'111',{equipId:'enhancing',price:20}),e=>e.code==='auto_active');
  await addGear(db,'111','rerolling');await R.start(env,'111',{itemId:'rerolling',functions:['attack'],requestId:'test-auto-reroll'},T0);await assert.rejects(create(env,'111',{equipId:'rerolling',price:20}),e=>e.code==='auto_active');
  const available=(await X.sellable(env,'111',{filters:{category:'equipment'}})).items;assert.deepEqual(available.map(i=>i.equipId),['market-gear']);
});

test('escrow triggers protect every old equipment UPDATE/DELETE and cannot revive background jobs',async()=>{
  const {env,db,gear}=await setup();await create(env,'111',{equipId:gear.id,price:20});
  for(const sql of ["UPDATE rpg_equipment SET is_equipped=1 WHERE id=?","UPDATE rpg_equipment SET enhance_level=1 WHERE id=?","UPDATE rpg_equipment SET bound=0 WHERE id=?","UPDATE rpg_equipment SET trade_id=NULL WHERE id=?","DELETE FROM rpg_equipment WHERE id=?"])await assert.rejects(db.prepare(sql).bind(gear.id).run(),/exchange_equipment_locked/);
  await assert.rejects(A.start(env,'111',{itemId:gear.id,target:5},T0),e=>e.code==='busy');
  for(const action of ['sell-gear','enhance','reroll','equip','unbind']) {
    const response=await handle(new Request('http://local/app/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'111','X-Debug-Now':String(T0)},body:JSON.stringify({itemId:gear.id,requestId:'old-'+action})}),env);assert.equal((await response.json()).ok,false,action);
  }
  assert.equal(gold(db,'111'),2000000);assert.equal(scalar(db,'SELECT COUNT(*) n FROM rpg_equipment WHERE id=?',gear.id).n,1);
});

test('Mini App authenticates the account and ignores spoofed seller, buyer or tgId fields',async()=>{
  const {env,db}=await setup();let r=await api(env,'111','create',op('111',{item:'scroll_w',price:20,tgId:'222',seller:'222'}));assert.equal(r.status,200);assert.equal(r.body.result.listing.seller.characterId,'111');
  const id=r.body.result.listingId;r=await api(env,'222','buy',op('222',{listingId:id,buyer:'333',tgId:'333'}));assert.equal(r.status,200);assert.equal(qty(db,'222','scroll_w'),101);assert.equal(qty(db,'333','scroll_w'),100);
  r=await api(env,'111','create',{item:'scroll_w',price:20,characterId:'111'});assert.equal(r.status,400);assert.equal(r.body.error,'request');
  const unauth=await handle(new Request('http://local/app/api/exchange/list',{method:'POST',body:'{}'}),env);assert.equal(unauth.status,401);
});
