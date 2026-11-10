import test from 'node:test';
import assert from 'node:assert/strict';
import {initialized,NOW} from './realm-test-helpers.js';
import {resolveRealm,scopeEnvForRealm,transitionRealmPhase} from '../src/realm/index.js';
import {createCharacter} from '../src/services/player.js';
import {loadPlayer} from '../src/db.js';
import {listAccountCharacters,selectAccountCharacter} from '../src/accounts.js';
import {drainSeasonStep,sealSeason as sealStep,importSeasonStep,retainedCharacters} from '../src/realm/season-transfer.js';
import * as Exchange from '../src/services/market-exchange.js';
import * as Atlas from '../src/services/atlas.js';
import * as Fate from '../src/services/fate.js';
import * as FateGifts from '../src/services/fate-gifts.js';

const ID='season_2026_01',account='92101';
async function setup(t,count=1){const env=await initialized(t),season=scopeEnvForRealm(env,await resolveRealm(env,ID)),permanent=scopeEnvForRealm(env,await resolveRealm(env,'permanent'));for(let i=0;i<count;i++){await createCharacter(permanent,{tgId:account,name:'永久角色'+i,gender:'m',baseClass:'sword'},NOW);await createCharacter(season,{tgId:account,name:'季服角色'+i,gender:'f',baseClass:'mage'},NOW);}env.DB_SEASON.sqlite.prepare('UPDATE rpg_equipment SET enhance_level=12').run();return {env,season,permanent};}
async function freeze(env,cutoff=NOW){await transitionRealmPhase(env,ID,{expectedPhase:'ACTIVE',expectedFenceEpoch:0,nextPhase:'FREEZE',cutoffAt:cutoff,now:cutoff});}
async function sealSeason(env,id,options){for(let n=0;n<300;n++){const result=await sealStep(env,id,options);if(result.status==='sealed')return result;}throw Error('seal never finished');}
async function finish(env){let r;for(let i=0;i<100;i++){r=await importSeasonStep(env,ID,{now:NOW+1000,limit:50});if(r.status==='complete')return r;}throw Error('never finished');}
test('cross-D1 import preserves permanent four plus seasonal four, class/level/+12/stock and ownership without overwriting active native',async t=>{
 const {env}=await setup(t,4),native=await listAccountCharacters(env.DB,account),season=await listAccountCharacters(env.DB_SEASON,account);
 await freeze(env);assert.equal((await drainSeasonStep(env,ID,{now:NOW+1})).ready,true);const sealed=await sealSeason(env,ID,{now:NOW+2});assert.equal(sealed.manifest.version,'season-transfer-v2');
 const sourceBefore=env.DB_SEASON.sqlite.prepare('SELECT * FROM rpg_characters ORDER BY tg_id').all();
 const receipt=await finish(env);assert.equal(receipt.characters,4);assert.equal((await resolveRealm(env,ID)).phase,'COMPLETE');
 const all=await listAccountCharacters(env.DB,account);assert.equal(all.length,8);assert.deepEqual(all.filter(c=>c.retentionGroup==='native'),native);assert.equal(all.filter(c=>c.originRealmId===ID).length,4);
 for(const original of season){const imported=all.find(c=>c.originCharacterId===original.charId);assert.equal(imported.baseClass,original.baseClass);assert.equal(imported.level,original.level);assert.equal(imported.slot,original.slot);const p=await loadPlayer(env.DB,imported.charId);assert.ok(p.equipment.every(e=>e.enhance_level===12));assert.equal(p.inv.red_1,150);assert.equal(p.char.account_tg_id,account);}
 assert.deepEqual(env.DB_SEASON.sqlite.prepare('SELECT * FROM rpg_characters ORDER BY tg_id').all(),sourceBefore);
 assert.equal((await retainedCharacters({DB:env.DB},'different')).characters.length,0);
 const scoped=scopeEnvForRealm(env,await resolveRealm(env,'permanent'));await selectAccountCharacter(scoped,account,all.find(c=>c.originRealmId===ID).charId,NOW+2000);assert.equal((await listAccountCharacters(env.DB,account)).filter(c=>c.active).length,1);
});
test('bounded copy resumes after lost responses and repeated completion never duplicates assets',async t=>{
 const {env}=await setup(t);await freeze(env);await drainSeasonStep(env,ID,{now:NOW+1});await sealSeason(env,ID,{now:NOW+2});
 const first=await importSeasonStep(env,ID,{now:NOW+3,limit:1});assert.equal(first.status,'copying');assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_characters').get().n,1);
 await importSeasonStep(env,ID,{now:NOW+4,limit:1});const final=await finish(env);const before=env.DB.sqlite.prepare('SELECT * FROM rpg_equipment ORDER BY id').all();const again=await importSeasonStep(env,ID,{now:NOW+9000});assert.equal(final.completionHash,again.completionHash);assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM rpg_equipment ORDER BY id').all(),before);
});
test('freeze is immutable to gameplay, sealing before drain is rejected and changed source never imports',async t=>{
 const {env,season}=await setup(t);await freeze(env);await assert.rejects(season.DB.prepare('UPDATE rpg_characters SET gold=0').run(),{code:'realm_fence_changed'});await assert.rejects(sealSeason(env,ID),{code:'season_phase'});
 await drainSeasonStep(env,ID,{now:NOW+1});await sealSeason(env,ID,{now:NOW+2});assert.throws(()=>env.DB_SEASON.sqlite.prepare('UPDATE rpg_characters SET gold=gold+1').run(),/season_source_locked/);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_characters').get().n,1);
});
test('destination chunk corruption and schema mismatch block hydration before any seasonal character appears',async t=>{
 const {env}=await setup(t);await freeze(env);await drainSeasonStep(env,ID,{now:NOW+1});await sealSeason(env,ID,{now:NOW+2});for(let n=0;n<120&&!env.DB.sqlite.prepare('SELECT 1 FROM rpg_season_transfer_chunks LIMIT 1').get();n++)await importSeasonStep(env,ID,{now:NOW+3,limit:1});
 assert.throws(()=>env.DB.sqlite.prepare("UPDATE rpg_season_transfer_chunks SET payload_json='broken'").run(),/season_archive_immutable/);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_characters').get().n,1);
});
test('a remaining escrow lock blocks sealing instead of losing equipment',async t=>{
 const {env}=await setup(t);env.DB_SEASON.sqlite.prepare("UPDATE rpg_equipment SET is_equipped=0,trade_id='unknown-escrow'").run();await freeze(env);const d=await drainSeasonStep(env,ID,{now:NOW+1});assert.ok(d.blockers.some(b=>b.kind==='equipped_escrow'));await assert.rejects(sealSeason(env,ID,{now:NOW+2}),{code:'season_not_drained'});
});
test('guardian, collection permanent bonuses, talent allocations and conflicting names survive cross-D1 import',async t=>{
 const {env}=await setup(t);const db=env.DB_SEASON.sqlite;
 db.prepare('UPDATE rpg_characters SET name=?,equipment_collection_json=?').run('永久角色0','[{"id":"test","bonuses":{"atkPct":0.03}}]');
 db.prepare("INSERT INTO rpg_atlas_talents VALUES(?,?,'[]',2,0,?)").run(account,'atlas-talents-v1',NOW);
 db.prepare("INSERT INTO rpg_guardian_operations VALUES(?,?,?,?,?,?,?,?,?,?)").run('source-op',account,account,'source-request','summon','a'.repeat(64),1,'{}','{}',NOW);
 db.prepare("INSERT INTO rpg_guardian_sigils(id,char_id,type,quality,bound,active,locked,rev,source_operation_id,created_at,updated_at) VALUES(?,?,'magic',8,1,1,0,0,?,?,?)").run('angel',account,'source-op',NOW,NOW);
 await freeze(env);await drainSeasonStep(env,ID,{now:NOW+1});await sealSeason(env,ID,{now:NOW+2});await finish(env);
 const c=(await listAccountCharacters(env.DB,account)).find(c=>c.originRealmId===ID),p=await loadPlayer(env.DB,c.charId);assert.notEqual(c.name,'永久角色0');assert.equal(p.char.equipment_collection_json,'[{"id":"test","bonuses":{"atkPct":0.03}}]');const angel=env.DB.sqlite.prepare('SELECT * FROM rpg_guardian_sigils WHERE char_id=?').get(c.charId);assert.equal(angel.quality,8);assert.equal(angel.active,1);assert.ok(angel.source_operation_id.startsWith('retained:'));assert.equal(env.DB.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('an account without a permanent character can retain its season character and later create four native slots',async t=>{
 const env=await initialized(t),season=scopeEnvForRealm(env,await resolveRealm(env,ID));await createCharacter(season,{tgId:account,name:'僅季服旅人',gender:'m',baseClass:'thief'},NOW);
 await freeze(env);await drainSeasonStep(env,ID,{now:NOW+1});await sealSeason(env,ID,{now:NOW+2});await finish(env);
 const permanent=scopeEnvForRealm(env,await resolveRealm(env,'permanent'));for(let i=0;i<4;i++)await createCharacter(permanent,{tgId:account,name:'保留後創角'+i,gender:'f',baseClass:'archer'},NOW+3000);
 assert.equal((await listAccountCharacters(env.DB,account)).length,5);await assert.rejects(createCharacter(permanent,{tgId:account,name:'第五原生角',gender:'f',baseClass:'archer'},NOW+3000),{code:'character_limit'});
});
test('real active Atlas reserves and market escrow are settled/refunded through cutoff exactly once',async t=>{
 const {env,season}=await setup(t);season.ATLAS_ENABLED='true';
 await Exchange.create(season,account,{characterId:account,requestId:crypto.randomUUID(),item:'red_1',qty:5,price:50},NOW);
 await Atlas.start(season,account,{requestId:'new-season-atlas-start',mapId:'laurel_intro',mapCount:1,durationMinutes:1,supplies:{hp:10,mp:10}},NOW);
 assert.equal(env.DB_SEASON.sqlite.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='red_1'").get(account).quantity,135);
 await freeze(env);const drained=await drainSeasonStep(env,ID,{now:NOW+1});assert.equal(drained.ready,true);assert.equal(env.DB_SEASON.sqlite.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='red_1'").get(account).quantity,150);
 await drainSeasonStep(env,ID,{now:NOW+2});assert.equal(env.DB_SEASON.sqlite.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='red_1'").get(account).quantity,150);
 await sealSeason(env,ID,{now:NOW+3});await finish(env);const imported=(await listAccountCharacters(env.DB,account)).find(c=>c.originRealmId===ID);assert.equal((await loadPlayer(env.DB,imported.charId)).inv.red_1,150);
});
test('schema mismatch is rejected before target characters hydrate and a lost committed character response never duplicates stock',async t=>{
 const a=await setup(t);await freeze(a.env);await drainSeasonStep(a.env,ID,{now:NOW+1});await sealSeason(a.env,ID,{now:NOW+2});a.env.DB.sqlite.exec('ALTER TABLE rpg_inventory ADD COLUMN unknown_future INTEGER');
 await assert.rejects(finish(a.env),{code:'season_schema'});assert.equal(a.env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_characters').get().n,1);
 const b=await setup(t);await freeze(b.env);await drainSeasonStep(b.env,ID,{now:NOW+1});await sealSeason(b.env,ID,{now:NOW+2});const original=b.env.DB.batch.bind(b.env.DB);let lost=false;
 b.env.DB.batch=async statements=>{const result=await original(statements);if(!lost&&statements.some(s=>/INSERT INTO "rpg_equipment"/.test(s.sql))){lost=true;throw Error('committed response lost');}return result;};
 await finish(b.env);assert.equal(lost,true);assert.equal(b.env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_equipment').get().n,4);assert.equal((await listAccountCharacters(b.env.DB,account)).length,2);
});
test('concurrent import attempts are fenced or replayed without duplicating a retained character or its items',async t=>{
 const {env}=await setup(t);await freeze(env);await drainSeasonStep(env,ID,{now:NOW+1});await sealSeason(env,ID,{now:NOW+2});await Promise.allSettled([importSeasonStep(env,ID,{now:NOW+3,limit:50}),importSeasonStep(env,ID,{now:NOW+3,limit:50})]);await finish(env);assert.equal((await listAccountCharacters(env.DB,account)).length,2);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_equipment').get().n,4);
});

test('unfinished season lives remain fully archived without granting a false completed life or a gift in permanent',async t=>{
 const {env,season}=await setup(t);const started=await Fate.start(season,account,{mode:'random',requestId:'cutoff-real-life'},NOW);
 const original=env.DB_SEASON.sqlite.prepare('SELECT * FROM rpg_fate_lives WHERE id=?').get(started.result.lifeId);
 await freeze(env);await drainSeasonStep(env,ID,{now:NOW+1});await sealSeason(env,ID,{now:NOW+2});await finish(env);
 const imported=(await listAccountCharacters(env.DB,account)).find(c=>c.originRealmId===ID),gifts=await FateGifts.summary({DB:env.DB},imported.charId);
 assert.equal(gifts.completed,0);assert.equal(gifts.claimable,0);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_fate_lives WHERE char_id=?').get(imported.charId).n,0);
 const retained=(await retainedCharacters({DB:env.DB},account)).characters[0];assert.deepEqual(retained.cutoffLives,[{sourceLifeId:original.id,cutoffAt:NOW}]);
 assert.deepEqual(env.DB_SEASON.sqlite.prepare('SELECT * FROM rpg_fate_lives WHERE id=?').get(original.id),original);
 assert.ok(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_season_transfer_pages WHERE table_name=?').get('rpg_fate_lives').n>0);
});

test('a committed seal page survives a lost response, and dropped source locks block further import',async t=>{
 const {env}=await setup(t);await freeze(env);await drainSeasonStep(env,ID,{now:NOW+1});const batch=env.DB_SEASON.batch.bind(env.DB_SEASON);let lost=false;
 env.DB_SEASON.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(s=>s.sql.includes('INSERT INTO rpg_season_transfer_chunks'))){lost=true;throw Error('seal committed reply lost');}return result;};
 for(let n=0;n<100&&!lost;n++){try{await sealStep(env,ID,{now:NOW+2,limit:1});}catch(e){assert.match(e.message,/seal committed reply lost/);}}
 assert.equal(lost,true);await sealSeason(env,ID,{now:NOW+3});
 env.DB_SEASON.sqlite.exec('DROP TRIGGER season_lock_rpg_characters_update');env.DB_SEASON.sqlite.prepare('UPDATE rpg_characters SET gold=gold+1').run();
 await assert.rejects(importSeasonStep(env,ID),{code:'season_source_changed'});assert.equal((await listAccountCharacters(env.DB,account)).length,1);
});

test('a large Unicode history row is chunked intact and destination lock tampering is rejected',async t=>{
 const {env}=await setup(t);const payload='古老星圖🌌'.repeat(15000);env.DB_SEASON.sqlite.prepare('INSERT INTO rpg_idle_reports(tg_id,used_json,created_at) VALUES(?,?,?)').run(account,payload,NOW);
 await freeze(env);await drainSeasonStep(env,ID,{now:NOW+1});await sealSeason(env,ID,{now:NOW+2});
 const page=JSON.parse(env.DB_SEASON.sqlite.prepare('SELECT header_json FROM rpg_season_transfer_pages WHERE table_name=?').get('rpg_idle_reports').header_json);assert.ok(page.parts.length>=3);
 const rebuilt=page.parts.map(p=>env.DB_SEASON.sqlite.prepare('SELECT payload_json FROM rpg_season_transfer_chunks WHERE realm_id=? AND chunk_no=?').get(ID,p.number).payload_json).join('');assert.equal(JSON.parse(rebuilt)[0].used_json,payload);
 await importSeasonStep(env,ID,{now:NOW+3});env.DB.sqlite.exec('DROP TRIGGER season_immutable_rpg_season_transfer_chunks_update');await assert.rejects(importSeasonStep(env,ID),{code:'season_schema'});
 assert.equal((await listAccountCharacters(env.DB,account)).length,1);
});
