import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import * as Player from '../src/services/player.js';
import * as Trade from '../src/services/trade.js';
import * as Scene from '../src/services/direct-trade-scene.js';
import {handle} from '../src/index.js';
import {MONSTER_ART_REVISION} from '../src/game/monster-art-compatibility.js';

const body=(realmId='permanent',extras={})=>({accountId:'111',realmId,selectedCharacterId:'111',contextEpoch:5,...extras});
function databaseState(DB) {
  const tables=DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
  const h=createHash('sha256');
  for(const name of tables){
    const escaped='"'+name.replaceAll('"','""')+'"';
    const rows=DB.sqlite.prepare('SELECT * FROM '+escaped+' ORDER BY rowid').all();
    h.update(JSON.stringify([name,rows]));
  }
  return {sha256:h.digest('hex'),totalChanges:DB.sqlite.prepare('SELECT total_changes() AS n').get().n};
}
async function fixture(t,realm='permanent'){
  const DB=freshDb(),db=DB.sqlite;
  t.after(()=>db.close());
  const env={DB,REALM_CONTEXT:{id:realm,phase:'ACTIVE'},ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};
  for(const [id,name] of [['111','ReadTrade111'],['222','ReadTrade222'],['333','ReadTrade333']]){
    await Player.createCharacter(env,{tgId:id,name,gender:'m',baseClass:'sword'},T0);
  }
  const opened=await Trade.openTradeStmts(env,{aTg:'111',bTg:'222'},T0);
  await DB.batch(opened.stmts);
  await DB.prepare('UPDATE rpg_trades SET expires_at=? WHERE id=?').bind(T0-1,opened.id).run();
  await DB.prepare("INSERT INTO rpg_trade_requests(id,share_id,equip_id,object_kind,owner_tg,requester_tg,status,created_at,expires_at) VALUES(?,'missing-share','missing-equip','equip','111','222','pending',?,?)").bind('test-request',T0-2000,T0-1).run();
  return {DB,db,env,id:opened.id};
}

test('expired trade and request appear as pending maintenance without any escrow, ledger, or total_changes write',async t=>{
  const f=await fixture(t);
  const before=databaseState(f.DB),raw=f.db.prepare('SELECT status FROM rpg_trades WHERE id=?').get(f.id);
  const value=await Scene.view(f.env,'111',body('permanent',{tradeId:f.id}),T0);
  assert.equal(value.ok,true);assert.equal(value.pureRead,true);assert.equal(value.schemaVersion,1);
  assert.equal(value.accountId,'111');assert.equal(value.characterId,'111');
  assert.equal(value.trades.open.length,1);assert.equal(value.trades.open[0].id,f.id);
  assert.equal(value.trades.open[0].expiryPendingMaintenance,true);
  assert.equal(value.selected?.id,f.id);assert.equal(value.selected.expiryPendingMaintenance,true);
  assert.equal(value.requests.incoming.length,1);assert.equal(value.requests.incoming[0].id,'test-request');
  assert.equal(value.requests.incoming[0].expiryPendingMaintenance,true);
  assert.deepEqual(databaseState(f.DB),before);
  assert.equal(f.db.prepare('SELECT status FROM rpg_trades WHERE id=?').get(f.id).status,raw.status);
  assert.equal(f.db.prepare("SELECT status FROM rpg_trade_requests WHERE id='test-request'").get().status,'pending');
});

test('trade scene is account, realm, selected-character and actor-bound; no foreign tradeId leaks',async t=>{
  const f=await fixture(t);
  const before=databaseState(f.DB);
  for(const [invalid,error] of [
    [body('season-a'),'realm_mismatch'],
    [body('permanent',{accountId:'222'}),'account_changed'],
    [body('permanent',{selectedCharacterId:'222'}),'character_changed'],
    [body('permanent',{contextEpoch:-1}),'trade_context'],
    [body('permanent',{other:'inject'}),'trade_scene_input'],
    [body('permanent',{tradeId:'?'}),'trade_scene_input']
  ]) await assert.rejects(Scene.view(f.env,'111',invalid,T0),{code:error});
  const foreign=await Trade.openTradeStmts(f.env,{aTg:'222',bTg:'333'},T0);
  await f.DB.batch(foreign.stmts);
  const afterExplicitSetup=databaseState(f.DB);
  await assert.rejects(Scene.view(f.env,'111',body('permanent',{tradeId:foreign.id}),T0),{code:'not_found'});
  const result=await Scene.view(f.env,'111',body(),T0);
  assert.equal(result.trades.open.length,1);
  assert.equal(result.trades.open[0].id,f.id);
  assert.deepEqual(databaseState(f.DB),afterExplicitSetup,'scoped read never writes a foreign trade');
  assert.notEqual(databaseState(f.DB).sha256,before.sha256,'fixture mutated only when explicitly opening a different trade');
});

test('Mini App route is an authenticated scoped pure read and does not mutate a due trade',async t=>{
  const f=await fixture(t), before=databaseState(f.DB);
  const request=new Request('http://local/app/api/trade/scene-scoped',{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'111','X-Realm-Id':'permanent','X-Monster-Art-Revision':MONSTER_ART_REVISION,'X-Debug-Now':String(T0)},body:JSON.stringify(body('permanent',{tradeId:f.id}))});
  const response=await handle(request,f.env),payload=await response.json();
  assert.equal(response.status,200,JSON.stringify(payload));assert.equal(payload.ok,true);
  assert.equal(payload.selected.id,f.id);assert.equal(payload.selected.expiryPendingMaintenance,true);
  assert.deepEqual(databaseState(f.DB),before,'HTTP must not run expiry, idle settlement, analytics, or other write');
});

test('permanent and season use separate databases with no cross-realm trade or request rows',async t=>{
  const permanent=await fixture(t,'permanent'), season=await fixture(t,'season-a');
  const pBefore=databaseState(permanent.DB),sBefore=databaseState(season.DB);
  const a=await Scene.view(permanent.env,'111',body('permanent'),T0);
  const b=await Scene.view(season.env,'111',body('season-a'),T0);
  assert.equal(a.trades.open.length,1);assert.equal(b.trades.open.length,1);
  assert.equal(a.requests.incoming.length,1);assert.equal(b.requests.incoming.length,1);
  assert.notEqual(a.trades.open[0].id,b.trades.open[0].id);
  assert.deepEqual(databaseState(permanent.DB),pBefore);assert.deepEqual(databaseState(season.DB),sBefore);
});
