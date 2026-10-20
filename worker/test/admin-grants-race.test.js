import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {createCharacter} from '../src/services/player.js';
import * as G from '../src/admin/grants.js';

const NOW=Date.parse('2026-10-20T10:00:00+08:00'),ADMIN={id:'900'};
async function fixture(t){
 const env={DB:freshDb(),BOT_TOKEN:'test-admin-grant-race-token'};
 t.after(()=>env.DB.sqlite.close());
 const primary=(await createCharacter(env,{tgId:'101',name:'主要旅人',baseClass:'sword',gender:'m'},NOW)).char.tg_id;
 const alt=(await createCharacter(env,{tgId:'101',name:'另一位旅人',baseClass:'mage',gender:'f'},NOW)).char.tg_id;
 const foreign=(await createCharacter(env,{tgId:'102',name:'其他帳號旅人',baseClass:'archer',gender:'f'},NOW)).char.tg_id;
 return {env,db:env.DB.sqlite,primary,alt,foreign};
}
const qty=(f,id,item)=>f.db.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?').get(id,item)?.quantity||0;
const gold=(f,id)=>f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(id).gold;
async function prepared(f,over={}){
 const p=await G.preview(f.env,ADMIN,{charIds:[f.primary],gold:100,item:'scroll_w',qty:2,reason:'補發活動獎勵',...over},NOW);
 return {requestId:crypto.randomUUID(),ticket:p.ticket,payload:p.payload};
}
function pauseReceipt(db){
 const prepare=db.prepare.bind(db);let paused=false,release,arrive;
 const reached=new Promise(resolve=>arrive=resolve),gate=new Promise(resolve=>release=resolve);
 db.prepare=sql=>{
  const stmt=prepare(sql);if(!sql.startsWith('SELECT fingerprint,result_json FROM rpg_admin_grants'))return stmt;
  const bind=stmt.bind.bind(stmt);stmt.bind=(...args)=>{
   const bound=bind(...args),first=bound.first.bind(bound);
   bound.first=async()=>{const row=await first();if(!paused){paused=true;arrive();await gate;}return row;};return bound;
  };return stmt;
 };
 return {reached,resume:()=>release()};
}
test('same grant retries recover a committed receipt when the first receipt read precedes ticket expiry and validation follows it',async t=>{
 const f=await fixture(t),b=await prepared(f),before=gold(f,f.primary),pause=pauseReceipt(f.env.DB);
 // Captured request times intentionally straddle expiry: the valid request commits
 // during the old-receipt read of its delayed retry. The committed result wins.
 const pending=G.commit(f.env,ADMIN,b,NOW+300001);await pause.reached;
 let committed;try{committed=await G.commit(f.env,ADMIN,b,NOW+1);}finally{pause.resume();}
 assert.deepEqual(await pending,committed);assert.equal(gold(f,f.primary),before+100);assert.equal(qty(f,f.primary,'scroll_w'),2);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_admin_grants').get().n,1);
});
test('same grant retry replays after another copy fills the last held-item slot before its recipient-capacity check',async t=>{
 const f=await fixture(t);f.db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,4)').run(f.primary,'ward');
 const b=await prepared(f,{gold:0,item:'ward',qty:1}),pause=pauseReceipt(f.env.DB),pending=G.commit(f.env,ADMIN,b,NOW+1);
 await pause.reached;let committed;try{committed=await G.commit(f.env,ADMIN,b,NOW+2);}finally{pause.resume();}
 assert.deepEqual(await pending,committed);assert.equal(qty(f,f.primary,'ward'),5);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='管理者發獎'").get().n,1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM rpg_admin_audit WHERE action='後台發獎'").get().n,1);
});
test('read-gap receipt recovery does not mistake a different request or changed fingerprint for the pending reward',async t=>{
 for(const variant of ['request','payload']){
  const f=await fixture(t);f.db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,4)').run(f.primary,'ward');
  const b=await prepared(f,{gold:0,item:'ward',qty:1}),pause=pauseReceipt(f.env.DB);
  const observed=G.commit(f.env,ADMIN,b,NOW+1).then(value=>({value}),error=>({error}));await pause.reached;
  const winner=variant==='request'?{...b,requestId:crypto.randomUUID()}:await prepared(f,{gold:1,item:'ward',qty:1});
  if(variant==='payload')winner.requestId=b.requestId;
  try{await G.commit(f.env,ADMIN,winner,NOW+2);}finally{pause.resume();}
  const {error}=await observed;assert.equal(error?.code,variant==='request'?'grant_capacity':'grant_reused');
  assert.equal(qty(f,f.primary,'ward'),5);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_admin_grants').get().n,1);
 }
});
test('lost acknowledgement of a committed reward recovers its receipt and never credits inventory or gold twice',async t=>{
 const f=await fixture(t),b=await prepared(f),batch=f.env.DB.batch.bind(f.env.DB),before=gold(f,f.primary);
 f.env.DB.batch=async stmts=>{const result=await batch(stmts);if(stmts[0].sql.startsWith('INSERT INTO rpg_admin_grants'))throw Error('acknowledgement lost after commit');return result;};
 const first=await G.commit(f.env,ADMIN,b,NOW+1),again=await G.commit(f.env,ADMIN,b,NOW+2);
 assert.deepEqual(again,first);assert.equal(gold(f,f.primary),before+100);assert.equal(qty(f,f.primary,'scroll_w'),2);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_admin_grants').get().n,1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM rpg_admin_audit WHERE action='後台發獎'").get().n,1);
});
test('genuine recipient read failure without a matching committed receipt remains an error and changes no player',async t=>{
 const f=await fixture(t),b=await prepared(f),prepare=f.env.DB.prepare.bind(f.env.DB),before=gold(f,f.primary);
 f.env.DB.prepare=sql=>{if(sql.startsWith('SELECT tg_id id,COALESCE(account_tg_id,tg_id) accountId'))throw Error('isolated recipient read unavailable');return prepare(sql);};
 await assert.rejects(G.commit(f.env,ADMIN,b,NOW+1),/isolated recipient read unavailable/);
 assert.equal(gold(f,f.primary),before);assert.equal(qty(f,f.primary,'scroll_w'),0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_admin_grants').get().n,0);
});
test('reward targets are exact immutable character ids, unaffected by the account active character before preview or commit',async t=>{
 for(const choice of ['primary','alt']){
  const f=await fixture(t),target=f[choice],active=choice==='primary'?f.alt:f.primary,before=new Map([f.primary,f.alt,f.foreign].map(id=>[id,gold(f,id)]));
  f.db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(target,'101');
  const b=await prepared(f,{charIds:[target]});
  // The player switches to the other character after the administrator preview.
  f.db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(active,'101');
  const result=await G.commit(f.env,ADMIN,b,NOW+1);assert.deepEqual(result.targets.map(x=>x.id),[target]);
  for(const id of [f.primary,f.alt,f.foreign]){assert.equal(gold(f,id),before.get(id)+(id===target?100:0));assert.equal(qty(f,id,'scroll_w'),id===target?2:0);}
  assert.equal(f.db.prepare('SELECT active_char_id FROM rpg_accounts WHERE account_tg_id=?').get('101').active_char_id,active);
 }
});
test('reordering the same exact recipient set preserves ticket fingerprint, while changing recipient ids cannot reuse approval',async t=>{
 const f=await fixture(t),b=await prepared(f,{charIds:[f.primary,f.alt]});
 const result=await G.commit(f.env,ADMIN,{...b,payload:{...b.payload,charIds:[...b.payload.charIds].reverse()}},NOW+1);
 assert.deepEqual(new Set(result.targets.map(x=>x.id)),new Set([f.primary,f.alt]));
 await assert.rejects(G.commit(f.env,ADMIN,{...b,payload:{...b.payload,charIds:[f.primary,f.foreign]}},NOW+2),e=>e.code==='grant_reused');
 assert.equal(qty(f,f.foreign,'scroll_w'),0);
});
