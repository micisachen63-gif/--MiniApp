import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { CurrentClientRequest } from './client-request.js';
import { initialized,NOW,gameplaySnapshot } from './realm-test-helpers.js';
import { transitionRealmPhase } from '../src/realm/index.js';

const OWNER='19811',OTHER='19812',SEASON='season_2026_01',SECRET='local-guardian-scene-fixture';
const ACTIONS=['guardian/scene','guardian/receipt','guardian/action-scoped'];
const writes=env=>[env.DB,env.DB_SEASON].map(db=>db.sqlite.prepare('SELECT total_changes() n').get().n);
const snapshots=env=>[env.DB,env.DB_SEASON].map(gameplaySnapshot);
async function fixture(t) {
 const env=await initialized(t);Object.assign(env,{ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true',SERVICE_SECRET:SECRET});
 async function call(surface,action,body={},options={}) {
  const realm=options.realm===undefined?'permanent':options.realm;
  const headers={'content-type':'application/json','X-Debug-Now':String(options.now??NOW),
   ...(surface==='app'?options.auth===false?{}:{'X-Dev-Tg-Id':options.account||OWNER}:{'X-Service-Secret':options.secret??SECRET}),
   ...(realm?{'X-Realm-Id':realm}:{})};
  const C=surface==='app'?CurrentClientRequest:Request,response=await handle(new C('https://local/'+(surface==='app'?'app/api/':'rpg/')+action,{method:'POST',headers,body:JSON.stringify(body)}),env);
  return {status:response.status,...await response.json()};
 }
 async function create(account,realm,name) {
  const r=await call('app','create',{name,gender:'f',baseClass:'mage',requestId:'guardian-create-'+account},{account,realm});
  assert.equal(r.status,200,JSON.stringify(r));return r.characters.find(c=>c.name===name);
 }
 const first=await create(OWNER,'permanent','天使API甲'),season=await create(OWNER,SEASON,'天使API季'),foreign=await create(OTHER,'permanent','天使API乙');
 for(const [db,c,gold]of[[env.DB,first,10000],[env.DB_SEASON,season,22222]])db.sqlite.prepare('UPDATE rpg_characters SET level=30,gold=?,last_settle_at=? WHERE tg_id=?').run(gold,NOW,c.charId);
 const scope=(realm='permanent')=>({realmId:realm,selectedCharacterId:realm===SEASON?season.charId:first.charId,tgId:OWNER});
 const scene=await call('app','guardian/scene',scope());assert.equal(scene.status,200,JSON.stringify(scene));
 const fields={kind:'welcome',configVersion:scene.guardian.config.configVersion,requestId:'guardian-api-welcome-001'};
 return {env,call,first,season,foreign,scope,fields};
}

test('App and Service guardian reads preserve both realm databases, welcome and gameplay at due idle deadlines',async t=>{
 const f=await fixture(t),before=snapshots(f.env),n=writes(f.env);
 for(const [realm,gold]of[['permanent',10000],[SEASON,22222]])for(const surface of ['app','service']){
  const forged=surface==='app'?{tgId:OTHER,accountId:OTHER}:{accountId:OTHER};
  const body={...f.scope(realm),...forged},scene=await f.call(surface,'guardian/scene',body,{realm,now:NOW+86400000});
  assert.equal(scene.status,200,JSON.stringify(scene));assert.equal(scene.accountId,OWNER);assert.equal(scene.characterId,body.selectedCharacterId);assert.equal(scene.realmId,realm);
  assert.equal(scene.guardian.state.balances.gold,gold);assert.equal(scene.guardian.state.welcome.claimed,false);assert.equal('scene' in scene,false);
  const r=await f.call(surface,'guardian/receipt',{...body,...f.fields},{realm});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.found,false);
 }
 assert.deepEqual(writes(f.env),n);assert.deepEqual(snapshots(f.env),before);
});

test('all three scoped guardian routes require auth and exact captured realm/current character before any writes',async t=>{
 const f=await fixture(t),before=snapshots(f.env),n=writes(f.env);
 for(const action of ACTIONS)for(const surface of ['app','service']){
  const body={...f.scope(),...f.fields};
  for(const [change,options,status,error]of[
   [{},{realm:null},400,'realm_required'],[{realmId:undefined},{},400,'realm_required'],
   [{realmId:SEASON},{},409,'realm_mismatch'],[{realmId:'unknown-realm'},{realm:'unknown-realm'},404,'realm_unknown'],
   [{selectedCharacterId:undefined},{},400,'selected_character_required'],[{selectedCharacterId:f.foreign.charId},{},409,'character_changed']
  ]){
   const r=await f.call(surface,action,{...body,...change},options);assert.equal(r.status,status,JSON.stringify(r));assert.equal(r.error,error);
  }
  const unauthorized=await f.call(surface,action,body,surface==='app'?{auth:false}:{secret:'wrong'});assert.equal(unauthorized.status,401);
 }
 assert.deepEqual(writes(f.env),n);assert.deepEqual(snapshots(f.env),before);
});

test('frozen guardian scene and receipts remain SELECT-only while all eleven write kinds are fenced',async t=>{
 const f=await fixture(t);
 await transitionRealmPhase(f.env,SEASON,{expectedPhase:'ACTIVE',expectedFenceEpoch:0,nextPhase:'FREEZE',cutoffAt:NOW,now:NOW});
 const before=snapshots(f.env),n=writes(f.env),base={...f.scope(SEASON),...f.fields};
 const bodies=[
  base,{...base,kind:'summon',pool:'normal',count:1,expectedCosts:{gold:850,vouchers:0,credits:0,freeNormalDraws:0}},
  {...base,kind:'fuse',itemIds:['a','b','c','d'],primaryId:'a',expectedCosts:{gold:0}},
  {...base,kind:'activate',itemId:null},{...base,kind:'lock',itemId:'a',locked:false},{...base,kind:'unbind',itemId:'a',expectedCosts:{unbind:1}},
  {...base,kind:'assist',mode:'supply',itemId:'',quantity:1,autoRenew:false,autoBuy:false,expectedCosts:{gold:0,stones:0}},
  {...base,kind:'sale',characterId:base.selectedCharacterId,itemIds:['a'],expectedGold:10},
  {...base,kind:'auto-start',pool:'normal',count:1,targetType:'magic',targetRank:0,maxGold:0},
  {...base,kind:'auto-stop',jobId:'exact-job'},{...base,kind:'auto-seen',jobId:'exact-job'}
 ];
 for(const surface of ['app','service']){
  const s=await f.call(surface,'guardian/scene',base,{realm:SEASON,now:NOW+86400000});assert.equal(s.status,200,JSON.stringify(s));assert.equal(s.guardian.control.writable,false);
  const r=await f.call(surface,'guardian/receipt',base,{realm:SEASON});assert.equal(r.status,200);assert.equal(r.recoveryAllowed,false);
  for(const body of bodies){const a=await f.call(surface,'guardian/action-scoped',body,{realm:SEASON});assert.equal(a.status,409,JSON.stringify(a));assert.equal(a.error,'realm_read_only');}
 }
 assert.deepEqual(writes(f.env),n);assert.deepEqual(snapshots(f.env),before);
});

test('transport cannot forge namespace/account and exact receipt recovery does not grant, charge or settle again',async t=>{
 const f=await fixture(t),body={...f.scope(),...f.fields,tgId:OTHER,accountId:OTHER,namespace:'service'};
 const a=await f.call('app','guardian/action-scoped',body);assert.equal(a.status,200,JSON.stringify(a));assert.equal(a.receipt.requestKey,'scene:app:'+body.requestId);assert.equal(a.accountId,OWNER);
 const before=snapshots(f.env),n=writes(f.env);
 const r=await f.call('app','guardian/receipt',body,{now:NOW+86400000});assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(r.result,a.result);
 const other=await f.call('service','guardian/receipt',{...body,tgId:OWNER,namespace:'app'});assert.equal(other.status,200);assert.equal(other.found,false);
 const again=await f.call('app','guardian/action-scoped',body,{now:NOW+86400000});assert.equal(again.status,200);assert.equal(again.replayed,true);assert.deepEqual(again.result,a.result);
 assert.deepEqual(writes(f.env),n);assert.deepEqual(snapshots(f.env),before);
});
