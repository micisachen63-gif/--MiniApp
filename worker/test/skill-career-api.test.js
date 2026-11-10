import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../src/index.js';
import {CurrentClientRequest} from './client-request.js';
import {initialized,NOW,gameplaySnapshot} from './realm-test-helpers.js';
import {transitionRealmPhase} from '../src/realm/index.js';

const OWNER='18551',OTHER='18552',SEASON='season_2026_01',SECRET='local-skill-career-fixture';
const writes=env=>[env.DB,env.DB_SEASON].map(db=>db.sqlite.prepare('SELECT total_changes() AS n').get().n);
const snapshots=env=>[env.DB,env.DB_SEASON].map(gameplaySnapshot);

async function fixture(t){
 const env=await initialized(t);
 Object.assign(env,{ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true',SERVICE_SECRET:SECRET});
 async function call(surface,action,body={},options={}){
  const realm=options.realm===undefined?'permanent':options.realm;
  const headers={'content-type':'application/json','X-Debug-Now':String(options.now??NOW+86400000),
   ...(surface==='app'?{'X-Dev-Tg-Id':options.account||OWNER}:{'X-Service-Secret':options.secret??SECRET}),
   ...(realm?{'X-Realm-Id':realm}:{})};
  const C=surface==='app'?CurrentClientRequest:Request;
  const r=await handle(new C('https://local/'+(surface==='app'?'app/api/':'rpg/')+action,{method:'POST',headers,body:JSON.stringify(body)}),env);
  return {status:r.status,...await r.json()};
 }
 async function create(account,realm,name,baseClass,slot=1){
  const r=await call('app','create',{name,baseClass,gender:'f',charSlot:slot,requestId:'skill-create-'+account+'-'+slot},{account,realm,now:NOW});
  assert.equal(r.status,200,JSON.stringify(r));
  return r.characters.find(c=>c.name===name);
 }
 const first=await create(OWNER,'permanent','職業甲','sword');
 const season=await create(OWNER,SEASON,'賽季職業','mage');
 const foreign=await create(OTHER,'permanent','另一帳號','archer');
 for(const [db,char,quantity] of [[env.DB,first,7],[env.DB_SEASON,season,19]]){
  db.sqlite.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'research_fragment',?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity").run(char.charId,quantity);
 }
 return {env,call,create,first,season,foreign};
}

test('skill-career App reads use the authenticated selected character and realm with zero settlement or analytics writes',async t=>{
 const f=await fixture(t),before=writes(f.env),data=snapshots(f.env);
 for(const [realm,char,count] of [['permanent',f.first,7],[SEASON,f.season,19]]){
  const r=await f.call('app','skill-career',{selectedCharacterId:char.charId,tgId:OTHER,account_tg_id:OTHER,namespace:'service'},{realm});
  assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.realmId,realm);
  assert.equal(r.characterId,char.charId);assert.equal(r.character.tgId,char.charId);
  assert.equal(r.inventory.research_fragment,count);assert.equal(r.readOnly,false);
  assert.ok(Array.isArray(r.skills)&&Array.isArray(r.eligible));assert.ok(r.career.current);
 }
 assert.deepEqual(writes(f.env),before);
 assert.deepEqual(snapshots(f.env),data);
});

test('skill-career App rejects missing/mismatched/unknown realms and foreign or stale selection without writes',async t=>{
 const f=await fixture(t),before=writes(f.env);
 for(const [body,options,status,error] of [
  [{},{realm:null},400,'realm_required'],
  [{realmId:SEASON},{},409,'realm_mismatch'],
  [{},{realm:'missing_realm'},404,'realm_unknown'],
  [{selectedCharacterId:f.foreign.charId},{},409,'character_changed'],
  [{selectedCharacterId:f.first.charId},{account:OTHER},409,'character_changed'],
 ]){
  const r=await f.call('app','skill-career',body,options);
  assert.equal(r.status,status,JSON.stringify(r));assert.equal(r.error,error);
 }
 assert.deepEqual(writes(f.env),before);
});

test('actual character selection invalidates old skill views and ignores a forged body account',async t=>{
 const f=await fixture(t),second=await f.create(OWNER,'permanent','職業乙','thief',2);
 const selected=await f.call('app','select',{charId:second.charId},{now:NOW});
 assert.equal(selected.status,200,JSON.stringify(selected));
 const before=writes(f.env),stale=await f.call('app','skill-career',{selectedCharacterId:f.first.charId});
 assert.equal(stale.status,409);assert.equal(stale.error,'character_changed');
 const current=await f.call('app','skill-career',{selectedCharacterId:second.charId,tgId:f.first.charId});
 assert.equal(current.status,200);assert.equal(current.characterId,second.charId);assert.equal(current.character.baseClass,'thief');
 assert.notEqual(current.inventory.research_fragment,7);
 assert.deepEqual(writes(f.env),before);
});

test('frozen realm skill/career status stays readable and cannot mutate even through existing skill actions',async t=>{
 const f=await fixture(t);
 await transitionRealmPhase(f.env,SEASON,{expectedPhase:'ACTIVE',expectedFenceEpoch:0,nextPhase:'FREEZE',cutoffAt:NOW,now:NOW});
 const before=writes(f.env),data=snapshots(f.env);
 for(const surface of ['app','service']){
  const r=await f.call(surface,'skill-career',{tgId:OWNER,selectedCharacterId:f.season.charId},{realm:SEASON});
  assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.readOnly,true);
  assert.equal(typeof r.readOnlyReason,'string');assert.ok(r.readOnlyReason);
 }
 const changed=await f.call('app','expedition/action',{op:'settings',mode:'safe',budget:0,requestId:'frozen-skill-settings',selectedCharacterId:f.season.charId},{realm:SEASON});
 assert.equal(changed.status,409,JSON.stringify(changed));assert.equal(changed.error,'realm_read_only');
 assert.deepEqual(writes(f.env),before);assert.deepEqual(snapshots(f.env),data);
});

test('service skill/career HTTP requires authentication and realm, and resolves only the account-owned active character',async t=>{
 const f=await fixture(t),second=await f.create(OWNER,'permanent','服務職業乙','mage',2);
 await f.call('app','select',{charId:second.charId},{now:NOW});
 const before=writes(f.env);
 const body={tgId:OWNER,selectedCharacterId:second.charId};
 const ok=await f.call('service','skill-career',body);
 assert.equal(ok.status,200,JSON.stringify(ok));assert.equal(ok.characterId,second.charId);
 for(const [payload,options,status,error] of [
  [body,{realm:null},400,'realm_required'],
  [{...body,realmId:SEASON},{},409,'realm_mismatch'],
  [{...body,selectedCharacterId:f.first.charId},{},409,'character_changed'],
  [{...body,tgId:second.charId},{},404,'no_character'],
 ]){
  const r=await f.call('service','skill-career',payload,options);
  assert.equal(r.status,status,JSON.stringify(r));assert.equal(r.error,error);
 }
 const badSecret=await f.call('service','skill-career',body,{secret:'wrong-fixture-secret'});
 assert.equal(badSecret.status,401);
 assert.deepEqual(writes(f.env),before);
});
