import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import * as P from '../src/services/player.js';
import * as G from '../src/services/party.js';
import * as PK from '../src/services/pk.js';
import * as S from '../src/services/special.js';
import * as A from '../src/accounts.js';
import * as E from '../src/services/auto-enhance.js';
import * as T from '../src/services/trade.js';
import * as SH from '../src/services/share.js';
import { loadPlayer } from '../src/db.js';
import { computeStats } from '../src/game/stats.js';

let seq=0;const request=()=>`interaction-${++seq}`;
async function setup(){
  const env={DB:freshDb()};
  for(const tg of ['111','222','333','444','555']){
    await P.createCharacter(env,{tgId:tg,name:'角色'+tg,gender:'m',baseClass:'sword'},T0);
    await env.DB.prepare("UPDATE rpg_characters SET level=60,class_path='B1' WHERE tg_id=?").bind(tg).run();
    const p=await loadPlayer(env.DB,tg),st=computeStats(p.char,p.equipment);
    await env.DB.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').bind(st.maxHp,st.maxMp,tg).run();
  }
  return env;
}
async function lobby(env){
  const id=(await G.create(env,'111',{kind:'dungeon',dungeonId:'pillar'},T0)).party.id;
  for(const tg of ['222','333'])await G.action(env,tg,{partyId:id,op:'join',requestId:request()},T0);
  for(const tg of ['111','222','333'])await G.action(env,tg,{partyId:id,op:'ready',requestId:request()},T0);
  return id;
}
async function alternate(env){await P.createCharacter(env,{tgId:'111',name:'備用角色',gender:'f',baseClass:'sword'},T0);return (await env.DB.prepare("SELECT tg_id FROM rpg_characters WHERE account_tg_id='111' AND char_slot=2").first()).tg_id;}
function beforeBatch(db,match,fn){
  const batch=db.batch.bind(db);let fired=false;
  db.batch=async stmts=>{if(!fired&&stmts.some(match)){fired=true;await fn();}return batch(stmts);};
  return ()=>{db.batch=batch;};
}

test('concurrent outgoing PK invitations cannot exceed one pending challenge',async()=>{
  const env=await setup(),results=await Promise.allSettled(['222','333'].map(tg=>PK.challenge(env,{tgId:'111',target:{tgId:tg}},T0)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM rpg_pk WHERE a_tg='111' AND status='pending'").first()).n,1);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM rpg_outbox WHERE kind='pk_challenge'").first()).n,1);
});

test('concurrent incoming challenges cannot exceed three invitations or duplicate a pair',async()=>{
  const env=await setup(),results=await Promise.allSettled(['111','333','444','555'].map(tg=>PK.challenge(env,{tgId:tg,target:{tgId:'222'}},T0)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM rpg_pk WHERE b_tg='222' AND status='pending'").first()).n,3);
  const other=await setup(),pair=await Promise.allSettled([PK.challenge(other,{tgId:'111',target:{tgId:'222'}},T0),PK.challenge(other,{tgId:'222',target:{tgId:'111'}},T0)]);
  assert.equal(pair.filter(r=>r.status==='fulfilled').length,1);
});

test('party wins the race: switching cannot activate an alternate after combat starts',async()=>{
  const env=await setup(),alt=await alternate(env),id=await lobby(env);
  const restore=beforeBatch(env.DB,s=>s.sql.startsWith('UPDATE rpg_accounts SET active_char_id='),()=>G.action(env,'111',{partyId:id,op:'start',requestId:request()},T0));
  await assert.rejects(A.selectAccountCharacter(env,'111',alt,T0),e=>e.code==='party');restore();
  assert.equal(await A.activeCharacterId(env.DB,'111'),'111');
  assert.equal((await loadPlayer(env.DB,'111')).char.party_id,id);
  assert.equal((await G.view(env,id,'111',T0)).status,'combat');
});

test('switch wins the race: stale party start cannot retain a switched character',async()=>{
  const env=await setup(),alt=await alternate(env),id=await lobby(env);
  const restore=beforeBatch(env.DB,s=>s.sql.startsWith('UPDATE rpg_parties SET status=')&&s.params[0]==='combat',()=>A.selectAccountCharacter(env,'111',alt,T0));
  await assert.rejects(G.action(env,'111',{partyId:id,op:'start',requestId:request()},T0),e=>e.code==='changed');restore();
  assert.equal(await A.activeCharacterId(env.DB,'111'),alt);
  assert.equal((await loadPlayer(env.DB,'111')).char.party_id,null);
  assert.equal((await G.view(env,id,'111',T0)).status,'lobby');
  await G.sweep(env,T0+600001);
  assert.equal((await G.view(env,id,'111',T0+600001)).status,'ended');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_party_presence').first()).n,0);
});

test('party combat protects equipment and PK counters from challenge and existing invitation acceptance',async()=>{
  const env=await setup(),invitation=await PK.challenge(env,{tgId:'111',target:{tgId:'444'}},T0),id=await lobby(env);
  await G.action(env,'111',{partyId:id,op:'start',requestId:request()},T0);
  const before=await loadPlayer(env.DB,'111');
  await assert.rejects(PK.challenge(env,{tgId:'555',target:{tgId:'222'}},T0),e=>e.code==='party');
  await assert.rejects(PK.accept(env,{tgId:'444',pkId:invitation.id},T0,1),e=>e.code==='party');
  assert.deepEqual((await loadPlayer(env.DB,'111')).equipment,before.equipment);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM rpg_daily_counters WHERE key='pk'").first()).n,0);
  assert.equal((await PK.pkView(env,invitation.id)).status,'pending');
});

test('party start commits while PK is being accepted: the duel cannot drop equipment',async()=>{
  const env=await setup(),invitation=await PK.challenge(env,{tgId:'111',target:{tgId:'444'}},T0),id=await lobby(env);
  const restore=beforeBatch(env.DB,s=>s.sql.startsWith("UPDATE rpg_pk SET status = 'done'"),()=>G.action(env,'111',{partyId:id,op:'start',requestId:request()},T0));
  await assert.rejects(PK.accept(env,{tgId:'444',pkId:invitation.id},T0,1),e=>e.code==='party');restore();
  assert.equal((await PK.pkView(env,invitation.id)).status,'pending');
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM rpg_daily_counters WHERE key='pk'").first()).n,0);
  assert.equal((await G.view(env,id,'111',T0)).status,'combat');
});

test('one skill book cannot create a successful escrow plus an orphan empty trade',async()=>{
  const env=await setup();await env.DB.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('111','book_skill_02_1',1)").run();
  const results=await Promise.allSettled(['222','333'].map((tg,i)=>S.tradeBook(env,'111',{target:{tgId:tg},skillId:'skill_02_1',requestId:`book-race-${i}`},T0)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_trades').first()).n,1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_book_trade_operations').first()).n,1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_trade_items').first()).n,1);
  assert.equal((await loadPlayer(env.DB,'111')).inv.book_skill_02_1,0);
});

test('retrying or simultaneously resending a skill book opens and escrows exactly once',async()=>{
  const env=await setup();await env.DB.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('111','book_skill_02_1',2)").run();
  const body={target:{tgId:'222'},skillId:'skill_02_1',requestId:'book-retry-one'};
  const results=await Promise.all([S.tradeBook(env,'111',body,T0),S.tradeBook(env,'111',body,T0)]);
  assert.equal(results[0].tradeId,results[1].tradeId);
  const retry=await S.tradeBook(env,'111',body,T0);assert.equal(retry.trade.a.lines.length,1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_trades').first()).n,1);
  assert.equal((await loadPlayer(env.DB,'111')).inv.book_skill_02_1,1);
});

test('recipient requesting a shared book leaves the owners inventory untouched',async()=>{
  const env=await setup();await env.DB.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('111','book_skill_02_1',1)").run();
  const result=await S.tradeBook(env,'222',{ownerId:'111',skillId:'skill_02_1',requestId:'recipient-book-request'},T0);
  assert.equal(result.trade.a.lines.length,0);
  assert.equal((await loadPlayer(env.DB,'111')).inv.book_skill_02_1,1);
});

test('PK blocks locked equipped gear explicitly but permits unequipped background enhancement',async()=>{
  const env=await setup(),invitation=await PK.challenge(env,{tgId:'111',target:{tgId:'444'}},T0);
  const gear=(await loadPlayer(env.DB,'111')).equipment.find(e=>e.slot==='weapon');
  await E.start(env,'111',{itemId:gear.id,target:2},T0);
  await assert.rejects(PK.accept(env,{tgId:'444',pkId:invitation.id},T0,1),e=>e.code==='auto_active');
  await assert.rejects(PK.challenge(env,{tgId:'555',target:{tgId:'111'}},T0),e=>e.code==='auto_active');
  assert.equal((await PK.pkView(env,invitation.id)).status,'pending');
  await E.stop(env,'111',{jobId:(await E.view(env,'111')).id},T0);
  await env.DB.prepare('UPDATE rpg_equipment SET is_equipped=0 WHERE id=?').bind(gear.id).run();
  await E.start(env,'111',{itemId:gear.id,target:2},T0);
  assert.equal((await PK.accept(env,{tgId:'444',pkId:invitation.id},T0,1)).status,'done');
});

test('starting background enhancement during a PK accept prevents the duel from committing',async()=>{
  const env=await setup(),invitation=await PK.challenge(env,{tgId:'111',target:{tgId:'444'}},T0);
  const gear=(await loadPlayer(env.DB,'111')).equipment.find(e=>e.slot==='weapon');
  const restore=beforeBatch(env.DB,s=>s.sql.startsWith("UPDATE rpg_pk SET status = 'done'"),()=>E.start(env,'111',{itemId:gear.id,target:2},T0));
  await assert.rejects(PK.accept(env,{tgId:'444',pkId:invitation.id},T0,1),e=>e.code==='auto_active');restore();
  assert.equal((await PK.pkView(env,invitation.id)).status,'pending');
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM rpg_daily_counters WHERE key='pk'").first()).n,0);
});

test('low level internal trade opening cannot bypass same-account protection',async()=>{
  const env=await setup(),alt=await alternate(env);
  await assert.rejects(T.openTradeStmts(env,{aTg:'111',bTg:alt},T0),e=>e.code==='self');
  await assert.rejects(PK.challenge(env,{tgId:'111',target:{tgId:alt}},T0),e=>e.code==='self');
  await env.DB.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('111','book_skill_02_1',1)").run();
  await assert.rejects(S.tradeBook(env,'111',{target:{tgId:alt},skillId:'skill_02_1',requestId:'self-book-request'},T0),e=>e.code==='self');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_trades').first()).n,0);
});

test('concurrent item shares consume one cooldown and publish only one card',async()=>{
  const env=await setup(),gear=(await loadPlayer(env.DB,'111')).equipment.find(e=>e.slot==='weapon');
  await env.DB.prepare('UPDATE rpg_equipment SET is_equipped=0,bound=0 WHERE id=?').bind(gear.id).run();
  const results=await Promise.allSettled([SH.shareItem(env,{tgId:'111',equipId:gear.id},T0),SH.shareItem(env,{tgId:'111',equipId:gear.id},T0)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_shares').first()).n,1);
  assert.equal((await env.DB.prepare("SELECT n FROM rpg_daily_counters WHERE tg_id='111' AND key='share'").first()).n,1);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM rpg_outbox WHERE kind='share'").first()).n,1);
});

test('concurrent requests to different share cards respect the five-request cap',async()=>{
  const env=await setup(),p=await loadPlayer(env.DB,'111'),gear=p.equipment.find(e=>e.slot==='weapon');
  for(let i=0;i<6;i++)await env.DB.batch(SH.shareStmts(env.DB,{id:`share-cap-${i}`,owner:'111',ownerChar:p.char,equip:gear,kind:'share',now:T0,announce:false}).stmts);
  const results=await Promise.allSettled(Array.from({length:6},(_,i)=>SH.requestTrade(env,{tgId:'222',shareId:`share-cap-${i}`},T0)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,5);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM rpg_trade_requests WHERE requester_tg='222' AND status='pending'").first()).n,5);
});

test('failed overdue trade cleanup propagates errors with a finite retry count',async()=>{
  const env=await setup(),opened=await T.openTradeStmts(env,{aTg:'111',bTg:'222'},T0);
  await env.DB.batch(opened.stmts);await env.DB.prepare('UPDATE rpg_trades SET expires_at=? WHERE id=?').bind(T0-1,opened.id).run();
  const batch=env.DB.batch.bind(env.DB);let calls=0;
  env.DB.batch=async()=>{calls++;throw new Error('temporary database unavailable');};
  await assert.rejects(T.lock(env,{tgId:'111',tradeId:opened.id},T0),/temporary database unavailable/);assert.equal(calls,1);
  calls=0;env.DB.batch=async()=>{calls++;throw new Error('D1_ERROR: NOT NULL constraint failed: rpg_guard.ok');};
  await assert.rejects(T.lock(env,{tgId:'111',tradeId:opened.id},T0),e=>e.code==='conflict');assert.equal(calls,4);
  env.DB.batch=batch;assert.equal((await T.tradeView(env,opened.id,'111',T0)).status,'open');
});
