import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {expectedSceneBindings,normalizedSql,publishedAssetFile,sceneSchemaRequirements,assertSceneSchema} from '../../scripts/scene-release-readiness.mjs';
import {freshDb} from './d1-shim.js';

test('scene activation only declares three new flags and retains protected bindings and unrelated values',()=>{
 const before=[{name:'DB',type:'d1',id:'original'},{name:'BOT_TOKEN',type:'secret_text'},{name:'UNRELATED',type:'plain_text',valueSHA256:'keep'}];
 const old=structuredClone(before),after=expectedSceneBindings(before,true);assert.deepEqual(before,old);
 for(const binding of old)assert.ok(after.some(b=>JSON.stringify(b)===JSON.stringify(binding)));
 assert.deepEqual(after.filter(b=>!old.some(o=>o.name===b.name)).map(b=>b.name).sort(),['ATLAS_ENABLED','EQUIPMENT_COLLECTION_ENABLED','EQUIPMENT_RECOVERY_ENABLED']);
 assert.equal(expectedSceneBindings(before,false),before);
 assert.throws(()=>expectedSceneBindings([...before,{name:'ATLAS_ENABLED',type:'secret_text'}],true),/cannot replace/);
});
test('schema comparison tolerates SQL formatting but preserves literal case and spaces',()=>{
 assert.equal(normalizedSql('CREATE TABLE IF NOT EXISTS "demo" (x TEXT); -- note'),normalizedSql('create table demo(x text);'));
 assert.notEqual(normalizedSql("CHECK(x='ACTIVE')"),normalizedSql("CHECK(x='active')"));
 assert.notEqual(normalizedSql("DEFAULT 'two  spaces'"),normalizedSql("DEFAULT 'two spaces'"));
 assert.notEqual(normalizedSql("DEFAULT 'if not exists'"),normalizedSql("DEFAULT ''"));
});
test('scene artifacts cannot name cross-origin URLs or escape the public directory',()=>{
 const root=path.resolve('public');assert.equal(publishedAssetFile(root,'/art/hero.webp'),path.join(root,'art/hero.webp'));
 for(const url of ['/../secret','https://other.example/hero.png','//../secret','/art/%2e%2e/secret'])assert.throws(()=>publishedAssetFile(root,url));
});
test('the new canonical schema rejects absent locks, weaker level constraints and the obsolete slot index',async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),required=await sceneSchemaRequirements(root),db=freshDb();
 try{
  const actual=db.sqlite.prepare('SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL').all();assert.doesNotThrow(()=>assertSceneSchema(required,actual));
  assert.ok(required.schema.some(row=>row.name==='season_lock_rpg_accounts_update'));
  assert.throws(()=>assertSceneSchema(required,actual.filter(row=>row.name!=='season_lock_rpg_accounts_update')),/schema not ready/);
  const weaker=actual.map(row=>row.name==='rpg_characters'?{...row,sql:row.sql.replace('BETWEEN 121 AND 600','BETWEEN 121 AND 999')}:row);
  assert.throws(()=>assertSceneSchema(required,weaker),/schema not ready/);
  assert.throws(()=>assertSceneSchema(required,[...actual,{type:'index',name:'idx_rpg_characters_account_slot',sql:'CREATE UNIQUE INDEX idx_rpg_characters_account_slot ON rpg_characters(account_tg_id,char_slot)'}]),/schema not ready/);
 }finally{db.sqlite.close();}
});

// Use real runtime validation rather than guessing a release at half-duration.
test('combat release readiness rejects populated clips without markers or anchors',async()=>{
 const {auditCombatActors}=await import('../../scripts/scene-combat-readiness.mjs');
 const source={releaseFrame:0,releaseAnchorPx:[20,30],frames:[{anchor:[10,100],bodyHeight:100,durationMs:100}]};
 const actor={id:'test-actor',family:'sword',clips:{attack:Object.fromEntries(['up','down','right','left'].map(d=>[d,structuredClone(source)]))}};
 const options={origin:'http://local.invalid',profiles:{schemaVersion:1,profiles:[]}};
 assert.equal((await auditCombatActors([actor],options)).ready,4);
 delete actor.clips.attack.right.releaseFrame;
 let result=await auditCombatActors([actor],options);assert.equal(result.ready,3);assert.equal(result.failures[0].reason,'missing-release-marker');
 actor.clips.attack.right.releaseFrame=0;delete actor.clips.attack.right.releaseAnchorPx;
 result=await auditCombatActors([actor],options);assert.equal(result.ready,3);assert.equal(result.failures[0].reason,'missing-release-origin');
});
