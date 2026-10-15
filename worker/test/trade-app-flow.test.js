import test from 'node:test';import assert from 'node:assert/strict';import {freshDb} from './d1-shim.js';import {T0} from './helpers.js';import * as P from '../src/services/player.js';import * as T from '../src/services/trade.js';import {loadPlayer} from '../src/db.js';import {handle} from '../src/index.js';
import {MONSTER_ART_REVISION} from '../src/game/monster-art-compatibility.js';
async function setup(){const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};for(const id of ['111','222']){await P.createCharacter(env,{tgId:id,name:'交易'+id,gender:'m',baseClass:'sword'},T0);await env.DB.prepare('UPDATE rpg_characters SET gold=10000 WHERE tg_id=?').bind(id).run();await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').bind(id,'scroll_w',10).run();}await env.DB.prepare("UPDATE rpg_equipment SET bound=0,is_equipped=0 WHERE tg_id='111' AND slot='weapon'").run();const gear=(await loadPlayer(env.DB,'111')).equipment.find(e=>e.slot==='weapon');const opened=await T.openTradeStmts(env,{aTg:'111',bTg:'222',preEquip:gear},T0);await env.DB.batch(opened.stmts);let seq=0;const api=async(tg,action,body={},requestId='trade-ui-'+(++seq))=>{const r=await handle(new Request('http://local/app/api/trade/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':tg,'X-Monster-Art-Revision':MONSTER_ART_REVISION,'X-Debug-Now':String(T0)},body:JSON.stringify({tradeId:opened.id,...body,...(requestId===null?{}:{requestId})})}),env);const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));return j;};return {env,api,id:opened.id,gear};}
test('real Mini App trade completes gear and gold exchange; duplicate confirms cannot transfer twice',async()=>{const {env,api,id,gear}=await setup();await api('222','gold',{gold:1000});await api('111','add',{item:'scroll_w',qty:3});await api('111','lock');let r=await api('222','lock');await api('111','confirm',{offerRev:r.trade.offerRev});r=await api('222','confirm',{offerRev:r.trade.offerRev},'final-confirm');assert.equal(r.trade.status,'done');await api('222','confirm',{offerRev:r.trade.offerRev},'final-confirm');const a=await loadPlayer(env.DB,'111'),b=await loadPlayer(env.DB,'222');assert.equal(a.char.gold,10950);assert.equal(b.char.gold,9000);assert.equal(a.inv.scroll_w,7);assert.equal(b.inv.scroll_w,13);assert.ok(b.equipment.some(e=>e.id===gear.id));assert.ok(!a.equipment.some(e=>e.id===gear.id));});
test('Mini App remove, fallback operation ID and cancel refund escrow exactly once',async()=>{const {env,api,gear}=await setup();await api('222','gold',{gold:1000},null);await api('111','add',{item:'scroll_w',qty:3});await api('111','remove',{item:'scroll_w',qty:1},'remove-once');await api('111','remove',{item:'scroll_w',qty:1},'remove-once');await api('111','lock');await api('222','cancel',{},'cancel-once');await api('222','cancel',{},'cancel-once');const a=await loadPlayer(env.DB,'111'),b=await loadPlayer(env.DB,'222');assert.equal(a.char.gold,10000);assert.equal(b.char.gold,10000);assert.equal(a.inv.scroll_w,10);assert.equal(b.inv.scroll_w,10);assert.equal(a.equipment.find(e=>e.id===gear.id).trade_id,null);});
test('invalid operation IDs remain rejected without changing escrow',async()=>{const {env,id}=await setup();await assert.rejects(T.lock(env,{tgId:'111',tradeId:id,requestId:'app:bad:colon'},T0),e=>e.code==='request');assert.equal((await T.tradeView(env,id,'111',T0)).status,'open');});

for(const [offered,withdraw] of [[2,1],[10,5],[10,3],[10,10]])for(const owner of ['111','222']){
 test(`escrow conservation: ${owner} withdraws ${withdraw} of ${offered}; replay and cancel cannot lose or duplicate items`,async()=>{
  const {env,api,id}=await setup();
  await api(owner,'add',{item:'scroll_w',qty:offered});
  await api(owner,'remove',{item:'scroll_w',qty:withdraw},'withdraw-once');
  await api(owner,'remove',{item:'scroll_w',qty:withdraw},'withdraw-once');
  const inv=(await loadPlayer(env.DB,owner)).inv.scroll_w;
  const escrow=(await env.DB.prepare("SELECT qty FROM rpg_trade_items WHERE trade_id=? AND kind='item' AND ref='scroll_w'").bind(id).first())?.qty||0;
  assert.equal(inv,10-offered+withdraw);assert.equal(escrow,offered-withdraw);assert.equal(inv+escrow,10);
  await api(owner,'cancel',{},'cancel-conservation');await api(owner,'cancel',{},'cancel-conservation');
  assert.equal((await loadPlayer(env.DB,owner)).inv.scroll_w,10);
 });
}
test('half withdrawal then normal completion transfers the remaining stack exactly once',async()=>{
 const {env,api,id}=await setup();await api('111','add',{item:'scroll_w',qty:10});await api('111','remove',{item:'scroll_w',qty:5});
 await api('111','lock');const r=await api('222','lock');await api('111','confirm',{offerRev:r.trade.offerRev});
 await api('222','confirm',{offerRev:r.trade.offerRev},'finish-half');await api('222','confirm',{offerRev:r.trade.offerRev},'finish-half');
 assert.equal((await loadPlayer(env.DB,'111')).inv.scroll_w,5);assert.equal((await loadPlayer(env.DB,'222')).inv.scroll_w,15);
 assert.equal((await T.tradeView(env,id,'111',T0)).status,'done');
});
test('actual trade service conserves all 5,050 legal withdrawals from stacks of 1–100',async()=>{
 const {env,id}=await setup();let checked=0;
 for(let offered=1;offered<=100;offered++)for(let qty=1;qty<=offered;qty++){
  await env.DB.prepare("UPDATE rpg_inventory SET quantity=? WHERE tg_id='111' AND item='scroll_w'").bind(100-offered).run();
  await env.DB.prepare("INSERT INTO rpg_trade_items(trade_id,side,kind,ref,qty) VALUES(?,'a','item','scroll_w',?) ON CONFLICT(trade_id,side,kind,ref) DO UPDATE SET qty=excluded.qty").bind(id,offered).run();
  await T.removeLine(env,{tgId:'111',tradeId:id,item:'scroll_w',qty,requestId:`conserve-${offered}-${qty}`},T0);
  const inv=(await env.DB.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id='111' AND item='scroll_w'").first()).quantity;
  const escrow=(await env.DB.prepare("SELECT qty FROM rpg_trade_items WHERE trade_id=? AND side='a' AND kind='item' AND ref='scroll_w'").bind(id).first())?.qty||0;
  assert.equal(inv,100-offered+qty);assert.equal(escrow,offered-qty);assert.equal(inv+escrow,100);checked++;
 }
 assert.equal(checked,5050);
});

 test('accepted request follows actual trade status instead of remaining open',async()=>{const {env,id}=await setup();const {requestView}=await import('../src/services/share.js');const row={id:'request-status',status:'accepted',owner_tg:'111',requester_tg:'222',share_id:'missing-share',trade_id:id};for(const status of ['open','done','cancelled','expired']){await env.DB.prepare('UPDATE rpg_trades SET status=?,expires_at=? WHERE id=?').bind(status,T0+60000,id).run();assert.equal((await requestView(env,row,T0)).tradeStatus,status);}await env.DB.prepare("UPDATE rpg_trades SET status='open',expires_at=? WHERE id=?").bind(T0-1,id).run();assert.equal((await requestView(env,row,T0)).tradeStatus,'expired');assert.equal((await requestView(env,{...row,trade_id:'missing'},T0)).tradeStatus,'closed');});
