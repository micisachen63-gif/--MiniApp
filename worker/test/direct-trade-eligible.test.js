import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {mulberry32} from '../src/game/rng.js';
import {makeGear} from '../src/game/gear.js';
import {insertEquipStmt} from '../src/db.js';
import {insertSigil} from '../src/services/guardian-sigil.js';
import * as Player from '../src/services/player.js';
import * as Trade from '../src/services/trade.js';
import * as Eligible from '../src/services/direct-trade-eligible.js';
import {handle} from '../src/index.js';
import {MONSTER_ART_REVISION} from '../src/game/monster-art-compatibility.js';

function state(db){
  const h=createHash('sha256');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name);
  for(const name of tables){
    const safe='"'+name.replaceAll('"','""')+'"';
    h.update(JSON.stringify([name,db.prepare('SELECT * FROM '+safe+' ORDER BY rowid').all()]));
  }
  return {hash:h.digest('hex'),changes:db.prepare('SELECT total_changes() AS n').get().n};
}
async function fixture(t,realm='permanent'){
  const DB=freshDb(),db=DB.sqlite;
  t.after(()=>db.close());
  const env={DB,REALM_CONTEXT:{id:realm,phase:'ACTIVE'},ENVIRONMENT:'development',
    ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};
  for(const [id,name] of [['111','EligTestA'],['222','EligTestB'],['333','EligTestC']]){
    await Player.createCharacter(env,{tgId:id,name,baseClass:'sword',gender:'m'},T0);
    db.prepare('UPDATE rpg_characters SET level=50,gold=10000 WHERE tg_id=?').run(id);
    db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').run(id,'scroll_w',20);
  }
  const opened=await Trade.openTradeStmts(env,{aTg:'111',bTg:'222'},T0);
  await DB.batch(opened.stmts);
  const gear=async (id,attrs={})=>{
    const item=makeGear({id,tgId:'111',cls:'sword',slot:'boots',kind:'boots',tier:1,rng:mulberry32(10),now:T0,source:'shop',forceRarity:'common'});
    Object.assign(item,{bound:0,is_equipped:0,trade_id:null,...attrs});
    await insertEquipStmt(DB,item).run();
    return item;
  };
  return {DB,db,env,id:opened.id,gear,realm};
}
const request=(f,opts={})=>({accountId:'111',realmId:f.realm,selectedCharacterId:'111',
  contextEpoch:7,tradeId:f.id,kind:'all',...opts});
test('eligible query uses only SELECT and filters trade-locked, equipped, bound, starter and nontradeable items',async t=>{
  const f=await fixture(t);
  const normal=await f.gear('eligible-normal');
  await f.gear('eligible-equipped',{is_equipped:1});
  await f.gear('eligible-bound',{bound:1});
  await f.gear('eligible-starter',{source:'starter'});
  f.db.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('111','research_fragment',5)").run();
  const before=state(f.db);
  const r=await Eligible.eligible(f.env,'111',request(f),T0);
  assert.equal(r.ok,true);assert.equal(r.pureRead,true);
  assert.equal(r.canAdd,true);assert.equal(r.offerRev,0);assert.equal(r.side,'a');
  assert(r.items.some(x=>x.kind==='equip'&&x.ref===normal.id));
  for(const id of ['eligible-equipped','eligible-bound','eligible-starter'])
    assert(!r.items.some(x=>x.ref===id));
  assert(r.items.some(x=>x.kind==='item'&&x.ref==='scroll_w'&&x.qty===20));
  assert(!r.items.some(x=>x.ref==='research_fragment'));
  assert.deepEqual(state(f.db),before,'eligibility must not mutate the database');
});
test('keyset pagination returns all eligible equipment without repeats, and cursor pins actor, realm, trade offer',async t=>{
  const f=await fixture(t);
  for(let i=0;i<67;i++)await f.gear('eligible-many-'+String(i).padStart(3,'0'));
  const before=state(f.db),seen=[],pages=[];
  let cursor=null;
  do{
    const value=await Eligible.eligible(f.env,'111',request(f,{kind:'equip',cursor}),T0);
    pages.push(value);seen.push(...value.items.map(x=>x.ref));cursor=value.nextCursor;
  }while(cursor);
  assert.equal(pages.length,3);
  assert.equal(new Set(seen).size,67);assert.equal(seen.length,67);
  assert.deepEqual(state(f.db),before);
  const next=pages[0].nextCursor;
  assert(next);
  for(const invalid of [
    {...request(f,{kind:'equip',cursor:next}),accountId:'222'},
    {...request(f,{kind:'all',cursor:next})},
    {...request(f,{kind:'equip',cursor:next}),contextEpoch:8}
  ]){
    await assert.rejects(Eligible.eligible(f.env,'111',invalid,T0),x=>['account_changed','trade_eligible_cursor'].includes(x.code));
  }
  await Trade.setGold(f.env,{tgId:'111',tradeId:f.id,gold:100,requestId:'eligibility-version-change'},T0);
  await assert.rejects(Eligible.eligible(f.env,'111',request(f,{kind:'equip',cursor:next}),T0),{code:'trade_eligible_cursor'});
});
test('only parties of a trade can view candidate inventory; realm and character changes fail closed',async t=>{
  const f=await fixture(t),before=state(f.db);
  await assert.rejects(Eligible.eligible(f.env,'333',{...request(f),accountId:'333',selectedCharacterId:'333'},T0),{code:'not_party'});
  await assert.rejects(Eligible.eligible(f.env,'111',{...request(f),selectedCharacterId:'222'},T0),{code:'character_changed'});
  await assert.rejects(Eligible.eligible(f.env,'111',{...request(f),realmId:'season-a'},T0),{code:'realm_mismatch'});
  await assert.rejects(Eligible.eligible(f.env,'111',{...request(f),kind:'evil'},T0),{code:'trade_eligible_kind'});
  await assert.rejects(Eligible.eligible(f.env,'111',{...request(f),cursor:'dt1.invalid'},T0),{code:'trade_eligible_cursor'});
  assert.deepEqual(state(f.db),before);
});
test('locked and overdue trade shows no selectable candidates and never settles funds',async t=>{
  const f=await fixture(t);
  await Trade.lock(f.env,{tgId:'111',tradeId:f.id,requestId:'eligible-lock'},T0);
  const before=state(f.db),locked=await Eligible.eligible(f.env,'111',request(f),T0);
  assert.equal(locked.canAdd,false);assert.deepEqual(locked.items,[]);
  assert.deepEqual(state(f.db),before);
  f.db.prepare('UPDATE rpg_trades SET expires_at=? WHERE id=?').run(T0-1,f.id);
  const due=state(f.db),expired=await Eligible.eligible(f.env,'111',request(f),T0);
  assert.equal(expired.isExpired,true);assert.equal(expired.canAdd,false);
  assert.deepEqual(state(f.db),due);
  assert.equal(f.db.prepare('SELECT status FROM rpg_trades WHERE id=?').get(f.id).status,'open');
});
test('eligible guardian candidates require original both-player level and backpack access conditions',async t=>{
  const f=await fixture(t);
  // Guardian provenance is mandatory: seed a matching original operation,
  // never bypass the foreign key or create an orphan guardian candidate.
  f.db.prepare("INSERT INTO rpg_guardian_operations(operation_id,account_id,char_id,request_id,action,payload_hash,config_version,cost_json,result_json,created_at) VALUES(?,?,?,?,'summon',?,'fixture-v1','{}','{}',?)")
    .run('eligibility-seed-1','111','111','guardian-seed-01','a'.repeat(64),T0);
  const sigil={id:'sigil-eligible-1',char_id:'111',type:'melee',quality:1,bound:0,source_operation_id:'eligibility-seed-1',created_at:T0,updated_at:T0};
  await insertSigil(f.DB,sigil).run();
  const before=state(f.db),one=await Eligible.eligible(f.env,'111',request(f,{kind:'guardian'}),T0);
  assert.equal(one.items.length,1);assert.equal(one.items[0].kind,'guardian');
  assert.equal(one.items[0].ref,'sigil-eligible-1');assert.deepEqual(state(f.db),before);
  f.db.prepare('UPDATE rpg_characters SET level=14 WHERE tg_id=?').run('222');
  const blocked=state(f.db),r=await Eligible.eligible(f.env,'111',request(f,{kind:'guardian'}),T0);
  assert.deepEqual(r.items,[]);assert.equal(r.nextCursor,null);assert.deepEqual(state(f.db),blocked);
});
test('actual Mini App eligible-scoped route is account+realm+actor bound, pure and phase-independent',async t=>{
  const f=await fixture(t,'permanent');await f.gear('mini-eligible');
  const before=state(f.db);
  const req=new Request('http://local/app/api/trade/eligible-scoped',{method:'POST',
    headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'111','X-Realm-Id':'permanent',
      'X-Monster-Art-Revision':MONSTER_ART_REVISION,'X-Debug-Now':String(T0)},
    body:JSON.stringify(request(f,{kind:'equip'}))});
  const response=await handle(req,f.env),result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.equal(result.pureRead,true);assert(result.items.some(x=>x.ref==='mini-eligible'));
  assert.deepEqual(state(f.db),before);
});
