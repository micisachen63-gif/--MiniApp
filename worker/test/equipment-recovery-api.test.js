import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../src/index.js';
import {CurrentClientRequest} from './client-request.js';
import {initialized,NOW,gameplaySnapshot} from './realm-test-helpers.js';
import {resolveRealm,scopeEnvForRealm,transitionRealmPhase} from '../src/realm/index.js';
import * as Player from '../src/services/player.js';
import * as Recovery from '../src/services/equipment-recovery.js';
import {makeGear} from '../src/game/gear.js';
import {recoveryYield} from '../src/game/equipment-recovery.js';
import {insertEquipStmt} from '../src/db.js';

const OWNER='98851',FOREIGN='98852',SEASON='season_2026_01';
const SECRET='recovery-http-test-service-secret';
const PATHS=['equipment-recovery','equipment-recovery/preview','equipment-recovery/action'];

async function fixture(t){
  t.mock.method(Date,'now',()=>NOW);
  const env=await initialized(t);
  Object.assign(env,{ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true',
    SERVICE_SECRET:SECRET,EQUIPMENT_RECOVERY_ENABLED:'true',EQUIPMENT_COLLECTION_ENABLED:'true'});
  const scoped=new Map(),raw=new Map([['permanent',env.DB],[SEASON,env.DB_SEASON]]);
  async function create(account,realm){
    const target=scoped.get(realm);
    const p=await Player.createCharacter(target,{tgId:account,name:'回收'+account,baseClass:'sword',gender:'f'},NOW);
    raw.get(realm).sqlite.prepare('UPDATE rpg_characters SET level=120,gold=12345,last_settle_at=? WHERE tg_id=?').run(NOW,p.char.tg_id);
    return p.char.tg_id;
  }
  for(const realm of ['permanent',SEASON]){
    scoped.set(realm,scopeEnvForRealm(env,await resolveRealm(env,realm)));
    await create(OWNER,realm);
  }
  async function app(path,body={},options={}){
    const realm=options.realm===undefined?SEASON:options.realm,account=options.account||OWNER;
    const response=await handle(new CurrentClientRequest('https://local/app/api/'+path,{
      method:'POST',headers:{'content-type':'application/json','X-Dev-Tg-Id':account,
        'X-Debug-Now':String(NOW),...(realm?{'X-Realm-Id':realm}:{})},body:JSON.stringify(body),
    }),env);
    return {status:response.status,...await response.json()};
  }
  async function service(path,body={},realm=null){
    const response=await handle(new Request('https://local/rpg/'+path,{
      method:'POST',headers:{'content-type':'application/json','X-Service-Secret':SECRET,
        'X-Debug-Now':String(NOW),...(realm?{'X-Realm-Id':realm}:{})},body:JSON.stringify(body),
    }),env);
    return {status:response.status,...await response.json()};
  }
  async function add(realm,id,options={}){
    const e=makeGear({id,tgId:OWNER,cls:'sword',slot:'weapon',kind:'sword',tier:2,
      rng:()=>.2,now:NOW,forceRarity:'common',source:'atlas',...options});
    await insertEquipStmt(scoped.get(realm).DB,e).run();
    return e;
  }
  async function prepared(realm,mode,itemIds,requestId){
    const preview=await app('equipment-recovery/preview',{mode,itemIds,selectedCharacterId:OWNER},{realm});
    assert.equal(preview.status,200,JSON.stringify(preview));
    return {mode,itemIds,selectedCharacterId:OWNER,requestId,token:preview.token,
      acknowledge:true,confirmHighValue:preview.requiresHighValueConfirmation};
  }
  const snapshot=()=>[gameplaySnapshot(env.DB),gameplaySnapshot(env.DB_SEASON)];
  return {env,scoped,raw,create,app,service,add,prepared,snapshot};
}

test('all recovery Mini App and service HTTP routes require an explicit realm before touching either economy',async t=>{
  const f=await fixture(t),item=await f.add(SEASON,'missing-realm-gear');
  const body=await f.prepared(SEASON,'salvage',[item.id],'missing-realm-operation');
  const before=f.snapshot();
  for(const path of PATHS){
    const app=await f.app(path,body,{realm:null});
    assert.equal(app.status,400,path+': '+JSON.stringify(app));
    assert.equal(app.error,'realm_required');
    const service=await f.service(path,{...body,tgId:OWNER});
    assert.equal(service.status,400,path+': '+JSON.stringify(service));
    assert.equal(service.error,'realm_required');
  }
  const mismatch=await f.app('equipment-recovery/action',{...body,realmId:'permanent'});
  assert.equal(mismatch.status,409);assert.equal(mismatch.error,'realm_mismatch');
  assert.deepEqual(f.snapshot(),before);
});

test('HTTP rejects stale selection and foreign-account equipment despite forged ownership fields',async t=>{
  const f=await fixture(t);
  await f.create(FOREIGN,SEASON);
  const item=await f.add(SEASON,'owner-only-gear');
  const body=await f.prepared(SEASON,'salvage',[item.id],'actor-isolation-operation');
  const before=f.snapshot();
  for(const path of PATHS){
    const wrongSelection=await f.app(path,{...body,selectedCharacterId:FOREIGN});
    assert.equal(wrongSelection.status,409,path+': '+JSON.stringify(wrongSelection));
    assert.equal(wrongSelection.error,'character_changed');
    const foreign=await f.app(path,{...body,tgId:OWNER,accountId:OWNER,charId:OWNER},{account:FOREIGN});
    assert.equal(foreign.status,409,path+': '+JSON.stringify(foreign));
    assert.equal(foreign.error,'character_changed');
  }
  for(const path of PATHS.slice(1)){
    const forgedOwner=await f.app(path,{...body,selectedCharacterId:FOREIGN,tgId:OWNER,
      accountId:OWNER,charId:OWNER},{account:FOREIGN});
    assert.equal(forgedOwner.status,409,path+': '+JSON.stringify(forgedOwner));
    assert.equal(forgedOwner.error,'equipment_changed');
  }
  assert.deepEqual(f.snapshot(),before);
  const foreignView=await f.app('equipment-recovery',{selectedCharacterId:FOREIGN,tgId:OWNER},{account:FOREIGN});
  assert.equal(foreignView.status,200,JSON.stringify(foreignView));
  assert.equal(foreignView.characterId,FOREIGN);
  assert.equal(foreignView.items.some(e=>e.id===item.id),false);
});

test('identical equipment and request IDs remain separate in permanent and season realms',async t=>{
  const f=await fixture(t);
  const permanentItem=await f.add('permanent','same-realm-item');
  const seasonItem=await f.add(SEASON,'same-realm-item');
  assert.deepEqual(permanentItem,seasonItem);
  const permanent=await f.prepared('permanent','salvage',[permanentItem.id],'shared-recovery-request');
  const season=await f.prepared(SEASON,'salvage',[seasonItem.id],'shared-recovery-request');
  assert.notEqual(permanent.token,season.token);
  const before=f.snapshot();
  const transplanted=await f.app('equipment-recovery/action',{...season},{realm:'permanent'});
  assert.equal(transplanted.status,409);assert.equal(transplanted.error,'equipment_changed');
  assert.deepEqual(f.snapshot(),before);
  const untouched=gameplaySnapshot(f.env.DB);
  const result=await f.app('equipment-recovery/action',season);
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.realmId,SEASON);assert.equal(result.characterId,OWNER);
  assert.equal(result.dust,recoveryYield(seasonItem));
  assert.deepEqual(gameplaySnapshot(f.env.DB),untouched);
  assert.equal(f.env.DB_SEASON.sqlite.prepare('SELECT 1 FROM rpg_equipment WHERE id=?').get(seasonItem.id),undefined);
  assert.ok(f.env.DB.sqlite.prepare('SELECT 1 FROM rpg_equipment WHERE id=?').get(permanentItem.id));

  const archive=await f.prepared('permanent','archive',[permanentItem.id],'shared-recovery-request');
  const saved=await f.app('equipment-recovery/action',archive,{realm:'permanent'});
  assert.equal(saved.status,200,JSON.stringify(saved));
  assert.equal(saved.realmId,'permanent');assert.equal(saved.result.mode,'archive');
  assert.equal(saved.archivedCount,1);assert.equal(saved.dust,0);
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_equipment_recovery_operations').get().n,1);
  assert.equal(f.env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_equipment_recovery_operations').get().n,1);
  assert.equal(f.env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_equipment_archive').get().n,0);
  assert.equal(f.env.DB_SEASON.sqlite.prepare('SELECT dust FROM rpg_equipment_recovery_balances WHERE char_id=?').get(OWNER).dust,recoveryYield(seasonItem));
});

test('HTTP salvage ignores client-supplied dust, costs and reward payloads, including changed retry extras',async t=>{
  const f=await fixture(t),item=await f.add('permanent','forged-reward-gear',{tier:3});
  const body=await f.prepared('permanent','salvage',[item.id],'ignore-forged-reward');
  const db=f.env.DB.sqlite;
  const beforeGold=db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(OWNER).gold;
  const beforeInventory=db.prepare('SELECT * FROM rpg_inventory WHERE tg_id=? ORDER BY item').all(OWNER);
  const forged={...body,tgId:FOREIGN,characterId:FOREIGN,dust:999999,dustGained:999999,
    cost:{dust:-999999,gold:-999999},gold:999999,
    reward:{dust:999999,gold:999999,items:{scroll_w:999999,scroll_r:999999}},
    rewards:[{gold:999999,equipment:[{id:'forged-new-item',tier:12}]}],
    inventory:{scroll_r:999999},bonuses:{atkPct:999999}};
  const result=await f.app('equipment-recovery/action',forged,{realm:'permanent'});
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.characterId,OWNER);
  assert.equal(result.dust,recoveryYield(item));assert.equal(result.result.dustGained,recoveryYield(item));
  assert.deepEqual(result.result.cost,{dust:0,gold:0});assert.equal(result.result.count,1);
  assert.equal(result.gold,beforeGold);
  assert.deepEqual(db.prepare('SELECT * FROM rpg_inventory WHERE tg_id=? ORDER BY item').all(OWNER),beforeInventory);
  assert.equal(db.prepare('SELECT 1 FROM rpg_equipment WHERE id=?').get('forged-new-item'),undefined);
  assert.equal(db.prepare('SELECT 1 FROM rpg_equipment WHERE id=?').get(item.id),undefined);
  const retry=await f.app('equipment-recovery/action',{...forged,dust:1,reward:{gold:1}},{realm:'permanent'});
  assert.equal(retry.status,200,JSON.stringify(retry));assert.equal(retry.replayed,true);
  assert.deepEqual(retry.result,result.result);assert.equal(retry.dust,result.dust);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rpg_equipment_recovery_operations').get().n,1);
  assert.equal(db.prepare("SELECT SUM(quantity) n FROM rpg_atlas_activity_events WHERE kind='reclaim'").get().n,1);
  const ledger=db.prepare("SELECT SUM(item_delta) dust,SUM(gold_delta) gold FROM rpg_ledger WHERE item='recovery_dust'").get();
  assert.equal(ledger.dust,recoveryYield(item));assert.equal(ledger.gold,0);
});

test('season freeze at the HTTP commit fence rolls back gear, dust, receipts and activity; closed and stale retries stay blocked',async t=>{
  const f=await fixture(t),item=await f.add(SEASON,'freeze-protected-item');
  const body=await f.prepared(SEASON,'salvage',[item.id],'freeze-recovery-operation');
  const before=f.snapshot(),original=f.env.DB_SEASON.batch.bind(f.env.DB_SEASON);
  let injected=false;
  t.mock.method(f.env.DB_SEASON,'batch',async statements=>{
    if(!injected&&statements.some(s=>s.sql.includes('INSERT INTO rpg_equipment_recovery_operations'))){
      injected=true;
      await transitionRealmPhase(f.env,SEASON,{expectedPhase:'ACTIVE',expectedFenceEpoch:0,
        nextPhase:'FREEZE',cutoffAt:NOW,now:NOW});
    }
    return original(statements);
  });
  const raced=await f.app('equipment-recovery/action',body);
  assert.equal(injected,true,'the season must freeze immediately before the actual recovery batch');
  assert.equal(raced.status,409,JSON.stringify(raced));assert.equal(raced.error,'realm_fence_changed');
  assert.deepEqual(f.snapshot(),before);
  const closed=await f.app('equipment-recovery/action',body);
  assert.equal(closed.status,409,JSON.stringify(closed));assert.equal(closed.error,'realm_closed');
  await assert.rejects(Recovery.action(f.scoped.get(SEASON),OWNER,body,NOW),{code:'realm_fence_changed'});
  assert.deepEqual(f.snapshot(),before);
  assert.ok(f.env.DB_SEASON.sqlite.prepare('SELECT 1 FROM rpg_equipment WHERE id=?').get(item.id));
});
