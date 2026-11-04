import test from 'node:test';
import assert from 'node:assert/strict';
import {view} from '../src/services/forge-receipt.js';
import * as Player from '../src/services/player.js';
import {scopeEnvForRealm,resolveRealm,transitionRealmPhase} from '../src/realm/index.js';
import {initialized,NOW,gameplaySnapshot} from './realm-test-helpers.js';
import {ledgerStmt} from '../src/db.js';
import {handle} from '../src/index.js';
import {CurrentClientRequest} from './client-request.js';

const OWNER='98871',OTHER='98872',SEASON='season_2026_01';

async function fixture(t){
  const root=await initialized(t),realms=new Map();
  for(const realmId of ['permanent',SEASON]){
    const env=scopeEnvForRealm(root,await resolveRealm(root,realmId)),raw=realmId==='permanent'?root.DB:root.DB_SEASON;
    const p=await Player.createCharacter(env,{tgId:OWNER,name:'工坊收據',baseClass:'sword',gender:'f'},NOW);
    raw.sqlite.prepare('UPDATE rpg_characters SET gold=100000,last_settle_at=? WHERE tg_id=?').run(NOW,OWNER);
    raw.sqlite.prepare("DELETE FROM rpg_inventory WHERE tg_id=? AND item IN ('scroll_w','scroll_r')").run(OWNER);
    realms.set(realmId,{env,raw,db:raw.sqlite,itemId:p.equipment.find(e=>e.slot==='weapon').id});
  }
  return {root,realms,...realms.get('permanent')};
}
async function forge(f,kind,requestId){
  return Player.withPlayer(f.env,OWNER,NOW,(work,ctx)=>kind==='enhance'?
    Player.doEnhance(work,ctx,{itemId:f.itemId,requestId},()=>0):
    Player.doReroll(work,ctx,{itemId:f.itemId,requestId},()=>.2));
}
const project=row=>({type:row.type,goldDelta:row.gold_delta,item:row.item,itemDelta:row.item_delta,note:row.note,createdAt:row.created_at});

test('real enhancement and reroll receipts include original scroll purchases and consumed resources using SELECT only',async t=>{
  const f=await fixture(t);
  for(const kind of ['enhance','reroll']){
    const requestId='real-'+kind+'-receipt',beforeGold=f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(OWNER).gold;
    await forge(f,kind,requestId);
    const before=gameplaySnapshot(f.raw),queries=[];
    const env={...f.env,DB:{prepare(sql){queries.push(sql);assert.match(sql.trim(),/^SELECT\b/i);return f.env.DB.prepare(sql);}}};
    const result=await view(env,{tgId:OWNER,kind,requestId},NOW+30*86400000);
    const ledger=f.db.prepare('SELECT * FROM rpg_ledger WHERE tg_id=? AND event_id IN (?,?) ORDER BY id').all(
      OWNER,kind+':'+OWNER+':'+requestId,'buy-'+kind+'-scroll:'+OWNER+':'+requestId);
    assert.deepEqual(result,{ok:true,found:true,kind,requestId,entries:ledger.map(project)});
    assert.equal(result.entries.length,2);assert.equal(result.entries[0].type,'商店購買');
    assert.ok(result.entries[0].goldDelta<0);assert.ok(result.entries[0].itemDelta>0);
    assert.ok(result.entries[1].itemDelta<0);
    assert.equal(result.entries.reduce((sum,row)=>sum+row.goldDelta,0),f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(OWNER).gold-beforeGold);
    assert.equal(queries.length,2);assert.deepEqual(gameplaySnapshot(f.raw),before);
  }
});

test('an exact receipt remains available beyond the last fifteen entries and after the equipment is gone',async t=>{
  const f=await fixture(t),requestId='old-forge-receipt';
  await forge(f,'enhance',requestId);
  const original=await view(f.env,{tgId:OWNER,kind:'enhance',requestId},NOW);
  for(let i=0;i<24;i++)await ledgerStmt(f.env.DB,{event_id:'later-event-'+i,tg_id:OWNER,type:'後續操作',gold_delta:0,note:'與查詢無關'},NOW+i+1).run();
  f.db.prepare('DELETE FROM rpg_equipment WHERE id=?').run(f.itemId);
  const before=gameplaySnapshot(f.raw),result=await view(f.env,{tgId:OWNER,kind:'enhance',requestId},NOW+86400000);
  assert.deepEqual(result,original);assert.match(result.entries.at(-1).note,/\+0→\+1/);
  assert.equal(f.db.prepare('SELECT 1 FROM rpg_equipment WHERE id=?').get(f.itemId),undefined);
  assert.deepEqual(gameplaySnapshot(f.raw),before);
});

test('the same request ID cannot read another character or realm; frozen realms still permit receipt reads',async t=>{
  const f=await fixture(t),requestId='isolated-forge-receipt';
  await forge(f,'enhance',requestId);
  await Player.createCharacter(f.env,{tgId:OTHER,name:'另一收據角色',baseClass:'mage',gender:'m'},NOW);
  const foreign=await view(f.env,{tgId:OTHER,kind:'enhance',requestId},NOW);
  assert.equal(foreign.found,false);assert.deepEqual(foreign.entries,[]);
  const season=f.realms.get(SEASON);
  assert.equal((await view(season.env,{tgId:OWNER,kind:'enhance',requestId},NOW)).found,false);
  await forge(season,'reroll',requestId);
  assert.equal((await view(f.env,{tgId:OWNER,kind:'reroll',requestId},NOW)).found,false);
  await transitionRealmPhase(f.root,SEASON,{expectedPhase:'ACTIVE',expectedFenceEpoch:0,nextPhase:'FREEZE',cutoffAt:NOW,now:NOW});
  const frozen=scopeEnvForRealm(f.root,await resolveRealm(f.root,SEASON)),before=gameplaySnapshot(season.raw);
  const result=await view(frozen,{tgId:OWNER,kind:'reroll',requestId},NOW+60000);
  assert.equal(result.found,true);assert.deepEqual(gameplaySnapshot(season.raw),before);
});

test('app raw IDs get exactly one app prefix and remain distinct from service receipts',async t=>{
  const f=await fixture(t),requestId='same-raw-request';
  await forge(f,'enhance','app:'+requestId);
  const app=await view(f.env,{tgId:OWNER,kind:'enhance',requestId,namespace:'app'},NOW);
  const missing=await view(f.env,{tgId:OWNER,kind:'enhance',requestId,namespace:'service'},NOW);
  assert.equal(app.found,true);assert.equal(app.requestId,requestId);assert.equal(missing.found,false);
  await forge(f,'enhance',requestId);
  const service=await view(f.env,{tgId:OWNER,kind:'enhance',requestId},NOW);
  assert.equal(service.found,true);assert.match(app.entries.at(-1).note,/\+0→\+1/);assert.match(service.entries.at(-1).note,/\+1→\+2/);
  assert.deepEqual(await view(f.env,{tgId:OWNER,kind:'enhance',requestId,namespace:'app'},NOW),app);
});

test('invalid inputs fail before querying, and inactive or deleted characters cannot read their old receipts',async t=>{
  const base={tgId:OWNER,kind:'enhance',requestId:'valid-receipt'};
  const invalidDB={prepare(){throw Error('invalid input must not query');}};
  for(const patch of [{kind:'sell'},{kind:null},{namespace:'client'},{tgId:123},{tgId:'someone-else'},
    {requestId:undefined},{requestId:null},{requestId:[]},{requestId:42},{requestId:''},{requestId:'a'.repeat(97)},
    {requestId:' bad id '},{requestId:"x' OR 1=1"},{requestId:'x\nreceipt'},
    {namespace:'app',requestId:'short'},{namespace:'app',requestId:'app:valid-receipt'},{namespace:'app',requestId:'a'.repeat(65)}]){
    await assert.rejects(view({DB:invalidDB},{...base,...patch},NOW),{code:'forge_receipt_input',status:400});
  }
  const f=await fixture(t);await forge(f,'enhance',base.requestId);
  const alt=await Player.createCharacter(f.env,{tgId:OWNER,name:'另一工坊分身',baseClass:'mage',gender:'m',requestId:'receipt-alt-character'},NOW);
  f.db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(alt.char.tg_id,OWNER);
  await assert.rejects(view(f.env,base,NOW),{code:'character_changed',status:409});
  f.db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(OWNER,OWNER);
  f.db.prepare('UPDATE rpg_characters SET deleted_at=? WHERE tg_id=?').run(NOW,OWNER);
  await assert.rejects(view(f.env,base,NOW),{code:'no_character',status:404});
});

test('missing or purchase-only records remain unconfirmed, and events require matching character plus exact IDs',async t=>{
  const f=await fixture(t),requestId='incomplete-forge';
  const missing=await view(f.env,{tgId:OWNER,kind:'enhance',requestId},NOW);
  assert.deepEqual(missing,{ok:true,found:false,kind:'enhance',requestId,entries:[]});
  await ledgerStmt(f.env.DB,{event_id:'buy-enhance-scroll:'+OWNER+':'+requestId,tg_id:OWNER,type:'商店購買',gold_delta:-30,item:'scroll_w',item_delta:1,note:'只有補購紀錄'},NOW).run();
  await ledgerStmt(f.env.DB,{event_id:'enhance:'+OWNER+':'+requestId+'-other',tg_id:OWNER,type:'強化',item:'scroll_w',item_delta:-1,note:'不同操作'},NOW).run();
  const pending=await view(f.env,{tgId:OWNER,kind:'enhance',requestId},NOW);
  assert.equal(pending.found,false);assert.equal(pending.entries.length,1);assert.equal(pending.entries[0].note,'只有補購紀錄');
  await Player.createCharacter(f.env,{tgId:OTHER,name:'錯置事件角色',baseClass:'mage',gender:'m'},NOW);
  await ledgerStmt(f.env.DB,{event_id:'enhance:'+OWNER+':'+requestId,tg_id:OTHER,type:'強化',item:'scroll_w',item_delta:-1,note:'錯置擁有者'},NOW).run();
  assert.deepEqual(await view(f.env,{tgId:OWNER,kind:'enhance',requestId},NOW),pending);
});

const SECRET='forge-receipt-http-test-secret';
async function httpFixture(t){
  const f=await fixture(t);
  Object.assign(f.root,{ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true',SERVICE_SECRET:SECRET});
  f.call=async(surface,action,body={},options={})=>{
    const realm=options.realm===undefined?'permanent':options.realm;
    const headers={'content-type':'application/json','X-Debug-Now':String(NOW+30*86400000),
      ...(surface==='app'?{'X-Dev-Tg-Id':options.account||OWNER}:{'X-Service-Secret':SECRET}),
      ...(realm?{'X-Realm-Id':realm}:{})};
    const RequestClass=surface==='app'?CurrentClientRequest:Request;
    const response=await handle(new RequestClass('https://local/'+(surface==='app'?'app/api/':'rpg/')+action,
      {method:'POST',headers,body:JSON.stringify(body)}),f.root);
    return {status:response.status,...await response.json()};
  };
  return f;
}

test('Mini App HTTP fixes the app namespace and authenticated active character; realm errors and frozen reads remain non-mutating',async t=>{
  const f=await httpFixture(t),requestId='http-forge-app-001';
  // Exercise the real writer too: app.js adds its namespace exactly once.
  const attempt=await f.call('app','enhance',{itemId:f.itemId,requestId,selectedCharacterId:OWNER});
  assert.equal(attempt.status,200,JSON.stringify(attempt));
  await Player.createCharacter(f.env,{tgId:OTHER,name:'HTTP收據他人',baseClass:'mage',gender:'m'},NOW);
  const before=[gameplaySnapshot(f.root.DB),gameplaySnapshot(f.root.DB_SEASON)];
  const body={kind:'enhance',requestId,selectedCharacterId:OWNER,tgId:OTHER,namespace:'service'};
  const receipt=await f.call('app','forge/receipt',body);
  assert.equal(receipt.status,200,JSON.stringify(receipt));assert.equal(receipt.found,true);assert.equal(receipt.realmId,'permanent');
  assert.equal(receipt.requestId,requestId);assert.ok(receipt.entries.some(row=>row.itemDelta<0));
  const missing=await f.call('app','forge/receipt',body,{realm:null});
  assert.equal(missing.status,400);assert.equal(missing.error,'realm_required');
  const unknown=await f.call('app','forge/receipt',body,{realm:'season_missing'});
  assert.equal(unknown.status,404);assert.equal(unknown.error,'realm_unknown');
  const mismatch=await f.call('app','forge/receipt',{...body,realmId:SEASON});
  assert.equal(mismatch.status,409);assert.equal(mismatch.error,'realm_mismatch');
  const stale=await f.call('app','forge/receipt',{...body,selectedCharacterId:OTHER});
  assert.equal(stale.status,409);assert.equal(stale.error,'character_changed');
  const foreignSelection=await f.call('app','forge/receipt',body,{account:OTHER});
  assert.equal(foreignSelection.status,409);assert.equal(foreignSelection.error,'character_changed');
  const foreign=await f.call('app','forge/receipt',{...body,tgId:OWNER,selectedCharacterId:OTHER},{account:OTHER});
  assert.equal(foreign.status,200);assert.equal(foreign.found,false);assert.deepEqual(foreign.entries,[]);
  const otherWorld=await f.call('app','forge/receipt',body,{realm:SEASON});
  assert.equal(otherWorld.status,200);assert.equal(otherWorld.found,false);
  const invalid=await f.call('app','forge/receipt',{...body,requestId:[]});
  assert.equal(invalid.status,400);assert.equal(invalid.error,'forge_receipt_input');
  assert.deepEqual([gameplaySnapshot(f.root.DB),gameplaySnapshot(f.root.DB_SEASON)],before);

  const season=f.realms.get(SEASON);
  await forge(season,'enhance','app:'+requestId);
  await transitionRealmPhase(f.root,SEASON,{expectedPhase:'ACTIVE',expectedFenceEpoch:0,nextPhase:'FREEZE',cutoffAt:NOW,now:NOW});
  const frozenBefore=gameplaySnapshot(f.root.DB_SEASON);
  const frozen=await f.call('app','forge/receipt',body,{realm:SEASON});
  assert.equal(frozen.status,200,JSON.stringify(frozen));assert.equal(frozen.found,true);
  assert.deepEqual(gameplaySnapshot(f.root.DB_SEASON),frozenBefore);
});

test('service HTTP fixes its namespace, requires realm and resolves only the supplied account active character',async t=>{
  const f=await httpFixture(t),requestId='http-forge-service-001';
  await forge(f,'reroll',requestId);
  const body={tgId:OWNER,kind:'reroll',requestId,selectedCharacterId:OWNER,namespace:'app'};
  const before=[gameplaySnapshot(f.root.DB),gameplaySnapshot(f.root.DB_SEASON)];
  const receipt=await f.call('service','forge/receipt',body);
  assert.equal(receipt.status,200,JSON.stringify(receipt));assert.equal(receipt.found,true);
  const app=await f.call('app','forge/receipt',{...body,namespace:'service'});
  assert.equal(app.status,200);assert.equal(app.found,false);
  const missing=await f.call('service','forge/receipt',body,{realm:null});
  assert.equal(missing.status,400);assert.equal(missing.error,'realm_required');
  const mismatch=await f.call('service','forge/receipt',{...body,realmId:SEASON});
  assert.equal(mismatch.status,409);assert.equal(mismatch.error,'realm_mismatch');
  const unknown=await f.call('service','forge/receipt',body,{realm:'season_missing'});
  assert.equal(unknown.status,404);assert.equal(unknown.error,'realm_unknown');
  const otherWorld=await f.call('service','forge/receipt',body,{realm:SEASON});
  assert.equal(otherWorld.status,200);assert.equal(otherWorld.found,false);
  assert.deepEqual([gameplaySnapshot(f.root.DB),gameplaySnapshot(f.root.DB_SEASON)],before);

  const alt=await Player.createCharacter(f.env,{tgId:OWNER,name:'HTTP工坊分身',baseClass:'mage',gender:'m',requestId:'http-forge-alt-character'},NOW);
  f.db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(alt.char.tg_id,OWNER);
  const switchedBefore=gameplaySnapshot(f.root.DB);
  const stale=await f.call('service','forge/receipt',body);
  assert.equal(stale.status,409);assert.equal(stale.error,'character_changed');
  const selected=await f.call('service','forge/receipt',{...body,selectedCharacterId:alt.char.tg_id});
  assert.equal(selected.status,200);assert.equal(selected.found,false);
  const directAlt=await f.call('service','forge/receipt',{...body,tgId:alt.char.tg_id,selectedCharacterId:alt.char.tg_id});
  assert.equal(directAlt.status,404);assert.equal(directAlt.error,'no_character');
  assert.deepEqual(gameplaySnapshot(f.root.DB),switchedBefore);
});
