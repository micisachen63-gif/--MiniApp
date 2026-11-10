import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {getAtlasTalentCatalog,validateAtlasTalents,applyAtlasTalentSnapshot,talentPointsForLevel} from '../src/game/atlas-talents.js';
import {createAtlasRun,advanceAtlasRun,normalizeAtlasSnapshot} from '../src/game/atlas-engine.js';
import * as Talents from '../src/services/atlas-talents.js';
import * as Atlas from '../src/services/atlas.js';
import * as Player from '../src/services/player.js';
import {D1Shim,freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {initialized,NOW} from './realm-test-helpers.js';
import {scopeEnvForRealm,resolveRealm,transitionRealmPhase} from '../src/realm/index.js';
import {handle} from '../src/index.js';
import {CurrentClientRequest} from './client-request.js';

const path=(branch,n)=>Array.from({length:n},(_,i)=>`${branch}_${i+1}`);
const snap=baseClass=>normalizeAtlasSnapshot({characterId:'synthetic-talents',baseClass,level:120,atk:200,def:80,maxHp:1000,maxMp:200,hp:500,mp:100});
test('four class trees have connected previewable nodes, tradeoff keystones and bounded level-derived points',()=>{
  for(const base of ['sword','archer','mage','thief']){
    const c=getAtlasTalentCatalog(base);assert.equal(c.nodes.length,31);assert.equal(c.edges.length,34);assert.equal(c.nodes.filter(n=>n.kind==='keystone').length,3);
    assert.equal(new Set(c.nodes.map(n=>n.id)).size,31);
    for(const branch of c.branches){const t=validateAtlasTalents(base,120,path(branch.id,10));assert.equal(t.spent,10);assert.ok(Object.entries(c.nodes.find(n=>n.id===branch.id+'_10').effects).some(([key,n])=>['takenPct','mpCostPct'].includes(key)?n>0:n<0));}
    c.nodes[1].effects.atkPct=99;assert.notEqual(getAtlasTalentCatalog(base).nodes[1].effects.atkPct,99);
  }
  assert.equal(talentPointsForLevel(1),1);assert.equal(talentPointsForLevel(6),2);assert.equal(talentPointsForLevel(120),24);assert.equal(talentPointsForLevel(1000),24);
});
test('disconnected, foreign-class, duplicate, origin, level-locked and over-budget selections fail',()=>{
  for(const ids of [['sword_whirlwind_2'],['mage_chain_1'],['origin'],['sword_whirlwind_1','sword_whirlwind_1']])assert.throws(()=>validateAtlasTalents('sword',120,ids),{code:'atlas_talent'});
  assert.throws(()=>validateAtlasTalents('sword',1,path('sword_whirlwind',2)),/點數不足/);
  assert.throws(()=>validateAtlasTalents('sword',15,path('sword_whirlwind',5)),/需要 20 級/);
  const ids=['sword_whirlwind','sword_bleed','sword_counter'].flatMap(b=>path(b,9));assert.throws(()=>validateAtlasTalents('sword',120,ids),/點數不足/);
  assert.equal(validateAtlasTalents('sword',120,[...path('sword_whirlwind',4),'sword_bleed_4']).spent,5,'cross-link is a real connection');
});
test('talent snapshots change real combat stats once, preserve health ratio and never mutate source gear stats',()=>{
  const before=snap('sword'),copy=JSON.stringify(before),ids=path('sword_whirlwind',10);
  assert.deepEqual(applyAtlasTalentSnapshot(before,[]).snapshot,before);
  const {snapshot,talents}=applyAtlasTalentSnapshot(before,ids);
  assert.ok(Math.abs(snapshot.hp/snapshot.maxHp-.5)<=1/snapshot.maxHp);assert.ok(Math.abs(snapshot.mp/snapshot.maxMp-.5)<=1/snapshot.maxMp);
  assert.ok(snapshot.pct.skillDamagePct>0);assert.ok(talents.effects.maxHpPct<0);
  assert.equal(JSON.stringify(before),copy);
  const plain=createAtlasRun({runId:'talent-test',realmId:'permanent',seed:'fixed',startAt:0,mapId:'laurel_intro',buildId:'sword_whirlwind',snapshot:before});
  const enhanced=createAtlasRun({runId:'talent-test',realmId:'permanent',seed:'fixed',startAt:0,mapId:'laurel_intro',buildId:'sword_whirlwind',snapshot:before,talentIds:ids});
  assert.ok(enhanced.skill.damageMultiplier>plain.skill.damageMultiplier);assert.deepEqual(enhanced.talentSnapshot.allocatedIds,[...ids].sort());
  assert.ok(advanceAtlasRun(enhanced,90).state.metrics.damage>0);
});
async function fixture(t){
  const env={DB:freshDb(),ATLAS_ENABLED:'true',REALM_CONTEXT:{id:'permanent'}};t.after(()=>env.DB.sqlite.close());
  const p=await Player.createCharacter(env,{tgId:'98101',name:'天賦測試',baseClass:'sword',gender:'f'},T0);
  env.DB.sqlite.prepare('UPDATE rpg_characters SET level=120,gold=12345 WHERE tg_id=?').run(p.char.tg_id);
  env.DB.sqlite.prepare('UPDATE rpg_equipment SET enhance_level=12 WHERE tg_id=?').run(p.char.tg_id);
  return {env,db:env.DB.sqlite,id:p.char.tg_id};
}
const action=(kind,nodeId,requestId)=>({kind,nodeId,requestId:requestId||`${kind}-${nodeId||'empty'}-001`});
test('allocation, lost-response replay and free reset preserve gold, equipment IDs and every +N',async t=>{
  const {env,db,id}=await fixture(t),gear=db.prepare('SELECT * FROM rpg_equipment ORDER BY id').all();
  const body=action('allocate','sword_whirlwind_1');let r=await Talents.action(env,id,body,T0);assert.equal(r.talents.spent,1);assert.equal(r.talents.availablePoints,23);
  await Talents.action(env,id,body,T0);assert.equal(db.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='星圖天賦'").get().n,1);
  await assert.rejects(Talents.action(env,id,{...body,nodeId:'sword_bleed_1'},T0),{code:'request_reused'});
  r=await Talents.action(env,id,action('reset'),T0);assert.equal(r.talents.spent,0);assert.equal(r.talents.availablePoints,24);
  assert.equal(db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(id).gold,12345);assert.deepEqual(db.prepare('SELECT * FROM rpg_equipment ORDER BY id').all(),gear);
});
test('tutorial completion requires a real saved allocation and never grants gold or extra points',async t=>{
  const {env,db,id}=await fixture(t);
  await assert.rejects(Talents.action(env,id,action('tutorial_complete'),T0),{code:'atlas_talent'});
  let r=await Talents.action(env,id,action('tutorial_start'),T0);assert.equal(r.talents.tutorialStep,1);
  await assert.rejects(Talents.action(env,id,action('tutorial_complete'),T0),{code:'atlas_talent'});
  await Talents.action(env,id,action('allocate','sword_whirlwind_1'),T0);
  r=await Talents.action(env,id,action('tutorial_complete'),T0);assert.equal(r.talents.tutorialStep,2);assert.equal(r.talents.totalPoints,24);assert.equal(r.talents.spent,1);
  assert.equal(db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(id).gold,12345);
  assert.equal((await Talents.view(env,id,T0)).talents.tutorialStep,2);
});
test('a competing allocation of the last point cannot overspend and ledger failure rolls the profile back',async t=>{
  const {env,db,id}=await fixture(t);db.prepare('UPDATE rpg_characters SET level=1 WHERE tg_id=?').run(id);
  const outcomes=await Promise.allSettled([Talents.action(env,id,action('allocate','sword_whirlwind_1'),T0),Talents.action(env,id,action('allocate','sword_bleed_1'),T0)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal((await Talents.view(env,id,T0)).talents.spent,1);
  await Talents.action(env,id,action('reset'),T0);
  db.exec("CREATE TRIGGER talent_ledger_failure BEFORE INSERT ON rpg_ledger WHEN NEW.type='星圖天賦' BEGIN SELECT RAISE(ABORT,'talent-ledger-failure'); END");
  await assert.rejects(Talents.action(env,id,action('allocate','sword_counter_1'),T0),/talent-ledger-failure/);
  assert.equal((await Talents.view(env,id,T0)).talents.spent,0);
});
test('a run locks its server-side talent snapshot, ignores forged client nodes and blocks reset until it ends',async t=>{
  const {env,db,id}=await fixture(t);await Talents.action(env,id,action('allocate','sword_whirlwind_1'),T0);
  await Atlas.start(env,id,{requestId:'talent-run-001',mapId:'laurel_intro',durationMinutes:1,queueMode:'duration',talentIds:path('sword_whirlwind',10),supplies:{hp:0,mp:0}},T0);
  const row=db.prepare('SELECT * FROM rpg_atlas_runs').get(),state=JSON.parse(row.state_json);
  assert.deepEqual(state.talentSnapshot.allocatedIds,['sword_whirlwind_1']);
  await assert.rejects(Talents.action(env,id,action('reset'),T0),{code:'atlas_active'});
  await Atlas.settle(env,id,{},T0+60000);await Talents.action(env,id,action('reset'),T0+60000);
  const ended=JSON.parse(db.prepare('SELECT state_json FROM rpg_atlas_runs').get().state_json);assert.deepEqual(ended.talentSnapshot,state.talentSnapshot);
});
test('disabled feature rejects new allocation but returns the already-committed request receipt',async t=>{
  const {env,id}=await fixture(t),body=action('allocate','sword_whirlwind_1');await Talents.action(env,id,body,T0);env.ATLAS_ENABLED='false';
  assert.equal((await Talents.action(env,id,body,T0)).talents.spent,1);
  await assert.rejects(Talents.action(env,id,action('reset'),T0),{code:'atlas_unavailable'});
});
test('HTTP talent changes isolate identical character IDs in two realms and reject missing realm or foreign actor',async t=>{
  const env=await initialized(t);Object.assign(env,{ATLAS_ENABLED:'true',ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'});
  for(const realm of ['permanent','season_2026_01'])await Player.createCharacter(scopeEnvForRealm(env,await resolveRealm(env,realm)),{tgId:'98201',name:'雙環境天賦',baseClass:'sword',gender:'m'},NOW);
  async function call(realm,body,owner='98201'){
    const response=await handle(new CurrentClientRequest('http://local/app/api/atlas/talents/action',{method:'POST',headers:{'X-Dev-Tg-Id':owner,'X-Debug-Now':String(NOW),...(realm?{'X-Realm-Id':realm}:{}),'content-type':'application/json'},body:JSON.stringify(body)}),env);
    return {status:response.status,...await response.json()};
  }
  const body={...action('allocate','sword_whirlwind_1'),selectedCharacterId:'98201'};
  assert.notEqual((await call(undefined,body)).status,200);
  const r=await call('season_2026_01',body);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.realmId,'season_2026_01');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_atlas_talents').get().n,0);assert.equal(env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_atlas_talents').get().n,1);
  assert.notEqual((await call('permanent',body,'98202')).status,200);
  assert.notEqual((await call('permanent',{...body,selectedCharacterId:'foreign-character'})).status,200);
});
test('new talent migration preserves every existing row, schema and enhancement receipt',async t=>{
  const db=new D1Shim();t.after(()=>db.sqlite.close());const folder=new URL('../migrations/',import.meta.url);
  for(const file of readdirSync(folder).filter(n=>n.endsWith('.sql')&&n<'0038').sort())db.sqlite.exec(readFileSync(new URL(file,folder),'utf8'));
  await Player.createCharacter({DB:db},{tgId:'98301',name:'保留天賦資產',baseClass:'mage',gender:'f'},T0);
  db.sqlite.prepare('UPDATE rpg_equipment SET enhance_level=15').run();
  const tables=db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rpg_%' ORDER BY name").all();
  const rows=()=>tables.map(({name})=>[name,db.sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
  const before=rows();db.sqlite.exec(readFileSync(new URL('0038_atlas_talents.sql',folder),'utf8'));assert.deepEqual(rows(),before);assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('v2 continuous in-flight snapshot resumes to its frozen pre-talent result without retuning rewards',()=>{
  const golden=JSON.parse(readFileSync(new URL('./fixtures/atlas-v2-resume.json',import.meta.url),'utf8'));
  assert.equal(golden.partial.ruleset_version,'atlas-v2');let state=golden.partial,rewards=[...golden.alreadyEarned],part;
  do{part=advanceAtlasRun(state,state.startedAt+600,{maxSteps:17});state=JSON.parse(JSON.stringify(part.state));rewards.push(...part.rewards);}while(part.stillCatchingUp);
  assert.deepEqual(state,golden.expectedFinal);assert.deepEqual(rewards,golden.expectedRewards);
});

test('a stale active-realm context cannot allocate after the season fence advances',async t=>{
  const env=await initialized(t);env.ATLAS_ENABLED='true';
  const scoped=scopeEnvForRealm(env,await resolveRealm(env,'season_2026_01'));
  await Player.createCharacter(scoped,{tgId:'98401',name:'封存保護',baseClass:'sword',gender:'f'},NOW);
  await transitionRealmPhase(env,'season_2026_01',{expectedPhase:'ACTIVE',expectedFenceEpoch:0,nextPhase:'FREEZE',cutoffAt:NOW,now:NOW});
  await assert.rejects(Talents.action(scoped,'98401',action('allocate','sword_whirlwind_1'),NOW),{code:'realm_fence_changed'});
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_atlas_talents').get().n,0);
});

test('unknown persisted talent versions fail closed without dropping allocations',async t=>{
  const {env,db,id}=await fixture(t);await Talents.action(env,id,action('allocate','sword_whirlwind_1'),T0);
  db.prepare("UPDATE rpg_atlas_talents SET rules_version='future-version' WHERE char_id=?").run(id);
  const row=db.prepare('SELECT * FROM rpg_atlas_talents').get();await assert.rejects(Talents.action(env,id,action('reset'),T0),{code:'atlas_talent_version'});assert.deepEqual(db.prepare('SELECT * FROM rpg_atlas_talents').get(),row);
});
