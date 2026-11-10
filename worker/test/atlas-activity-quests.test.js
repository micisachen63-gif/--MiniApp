import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { freshDb, D1Shim } from './d1-shim.js';
import { mulberry32 } from '../src/game/rng.js';
import { taipeiDay, taipeiAt, isoWeek } from '../src/game/time.js';
import { ATLAS_QUESTS, LEGACY_ATLAS_QUESTS, ATLAS_ACTIVITY_QUESTS, questInstance } from '../src/game/atlas-quests.js';
import * as P from '../src/services/player.js';
import * as Q from '../src/services/atlas-quests.js';

const T = Date.parse('2026-11-01T15:55:00Z'), MIDNIGHT = Date.parse('2026-11-01T16:00:00Z');
async function fixture(t, legacy = false) {
  let DB;
  if (legacy) {
    DB = new D1Shim();
    const directory = new URL('../migrations/', import.meta.url);
    for (const file of readdirSync(directory).filter(name => name.endsWith('.sql') && name < '0041').sort()) DB.sqlite.exec(readFileSync(new URL(file, directory), 'utf8').replace(/\r\n/g, '\n'));
  } else DB = freshDb();
  t.after(() => DB.sqlite.close());
  const env = { DB, ATLAS_ENABLED: 'true', REALM_CONTEXT: { id: 'permanent', type: 'permanent' } };
  const player = await P.createCharacter(env, { tgId: '82351', name: '活動調查員', gender: 'm', baseClass: 'sword' }, T, mulberry32(7));
  return { env, db: DB.sqlite, id: player.char.tg_id, account: player.char.account_tg_id };
}
const event = (sourceId, kind, quantity = 1, extra = {}) => ({ sourceId, kind, quantity, occurredAt: T, mapId: 'laurel_intro', buildId: 'sword_whirlwind', ...extra });
const options = (f, events) => ({ accountId: f.account, charId: f.id, events, realmId: 'permanent' });
const record = (f, events, now = T) => f.env.DB.batch(Q.activityEventStatements(f.env.DB, options(f, events), now));
const find = (view, questId, periodKey = 'lifetime') => view.quests.find(q => q.id === questId && q.periodKey === periodKey);
const body = (questId, periodKey = 'lifetime', requestId = 'claim-' + questId) => ({ questId, periodKey, requestId });
const count = (f, table) => f.db.prepare('SELECT COUNT(*) n FROM ' + table).get().n;

test('43 goals preserve all 18 v1 IDs and rewards while adding distinct daily, weekly and regional objectives', () => {
  const expected = {
    intro_build:{atlas_shard:2},intro_departure:{atlas_shard:2},intro_clear:{atlas_shard:2,atlas_iron:1},
    intro_craft:{atlas_shard:2},intro_boss:{atlas_shard:3},daily_workshop:{atlas_shard:1},daily_theme:{atlas_shard:2},
    weekly_three_themes:{atlas_shard:3,atlas_iron:1},weekly_three_builds:{atlas_shard:3,atlas_ember:1},
    explore_1_10:{atlas_shard:3,atlas_iron:1},explore_1_50:{atlas_shard:5,atlas_iron:2},
    explore_2_10:{atlas_shard:3,atlas_ember:1},explore_2_50:{atlas_shard:5,atlas_ember:2},
    explore_3_10:{atlas_shard:3,atlas_venom:1},explore_3_50:{atlas_shard:5,atlas_venom:2},
    warden_3:{atlas_shard:3,atlas_core:1},warden_15:{atlas_shard:5,atlas_core:1},atlas_100:{atlas_shard:6},
  };
  assert.equal(ATLAS_QUESTS.length,43); assert.equal(new Set(ATLAS_QUESTS.map(q=>q.id)).size,43);
  assert.deepEqual(Object.fromEntries(LEGACY_ATLAS_QUESTS.map(q=>[q.id,q.rewards.materials])),expected);
  assert.ok(LEGACY_ATLAS_QUESTS.every(q=>q.rulesVersion==='atlas-quests-v1'&&!q.criteria.activity));
  assert.equal(ATLAS_ACTIVITY_QUESTS.filter(q=>q.category==='daily').length,7);
  assert.equal(ATLAS_ACTIVITY_QUESTS.filter(q=>q.category==='weekly').length,6);
  assert.equal(ATLAS_ACTIVITY_QUESTS.filter(q=>q.category==='investigation').length,12);
  assert.ok(ATLAS_QUESTS.every(q=>q.rewards.gold===0&&q.rewards.exp===0));
});

test('activity quantities sum, identical replays do not add and changed payload rolls back its source transaction', async t => {
  const f=await fixture(t),first=event('confirmed-room','kill',25);
  await record(f,[first,event('confirmed-room-two','kill',15)]);
  await record(f,[first]);
  assert.equal(count(f,'rpg_atlas_activity_events'),2);
  assert.equal(find(await Q.view(f.env,f.id,T),'daily_hunt',taipeiDay(T)).progress,40);
  const gold=f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(f.id).gold;
  await assert.rejects(f.env.DB.batch([
    f.env.DB.prepare('UPDATE rpg_characters SET gold=gold+123 WHERE tg_id=?').bind(f.id),
    ...Q.activityEventStatements(f.env.DB,options(f,[{...first,quantity:26}]),T),
  ]),/rpg_atlas_quest_guard/);
  assert.equal(f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(f.id).gold,gold);
  assert.equal(find(await Q.view(f.env,f.id,T),'daily_hunt',taipeiDay(T)).progress,40);
  assert.throws(()=>f.db.prepare('UPDATE rpg_atlas_activity_events SET quantity=99').run(),/immutable/);
});

test('event batches reject invalid counts, future times, forged maps, build IDs and wrong account ownership', async t => {
  const f=await fixture(t);
  for(const patch of [{quantity:0},{quantity:-1},{quantity:1.5},{quantity:1000001},{occurredAt:T+1},{mapId:'unreleased_map'},{buildId:'unplayed_build'},{kind:'login'},{mapId:null}]) {
    assert.throws(()=>Q.activityEventStatements(f.env.DB,options(f,[event('bad-fact','kill',1,patch)]),T));
  }
  assert.throws(()=>Q.activityEventStatements(f.env.DB,options(f,Array(4097).fill(event('overflow','kill'))),T),/批次/);
  assert.equal(Q.activityEventStatements(f.env.DB,options(f,[event('small-batch','kill')]),T).length,2);
  await assert.rejects(f.env.DB.batch(Q.activityEventStatements(f.env.DB,{...options(f,[event('wrong-owner','kill')]),accountId:'another-account'},T)),/account_mismatch/);
  assert.equal(count(f,'rpg_atlas_activity_events'),0);
});


function unicodeEvents(length = 4096) {
  return Array.from({length},(_,i)=>event('界'.repeat(234)+'🌌'+String(i).padStart(4,'0'),'kill',i%3+1,{tag:'跡'.repeat(78)+'🌀'}));
}
function activityChunks(statements) {
  assert.ok(statements.length>2);
  assert.equal(statements.length%2,0);
  const chunks=[];
  for(let i=0;i<statements.length;i+=2){
    const insert=statements[i],guard=statements[i+1];
    assert.match(insert.sql,/INSERT INTO rpg_atlas_activity_events/);
    assert.match(guard.sql,/INSERT INTO rpg_atlas_quest_guard/);
    assert.equal(insert.params.length,1);assert.equal(guard.params.length,1);
    assert.equal(insert.params[0],guard.params[0]);
    assert.ok(Buffer.byteLength(insert.params[0],'utf8')<=Q.MAX_ATLAS_ACTIVITY_JSON_BYTES);
    chunks.push(JSON.parse(insert.params[0]));
  }
  return chunks;
}

test('4096 maximum-length Unicode events stay within every D1 binding byte limit and persist completely', async t => {
  const f=await fixture(t),events=unicodeEvents();
  assert.equal(Q.MAX_ATLAS_ACTIVITY_JSON_BYTES,500000);
  assert.ok(events.every(e=>e.sourceId.length===240&&e.tag.length===80));
  const statements=Q.activityEventStatements(f.env.DB,options(f,events),T),chunks=activityChunks(statements),rows=chunks.flat();
  assert.equal(rows.length,4096);
  assert.deepEqual(rows.map(row=>[row.sourceId,row.tag,row.quantity]),events.map(e=>[e.sourceId,e.tag,e.quantity]));
  const oldSingleBindingBytes=Buffer.byteLength(JSON.stringify(rows),'utf8');
  assert.ok(oldSingleBindingBytes>2000000,'fixture reproduces the former D1 single-string limit failure');
  await f.env.DB.batch(statements);
  const persisted=()=>f.db.prepare('SELECT COUNT(*) n,SUM(quantity) quantity FROM rpg_atlas_activity_events').get();
  assert.deepEqual({...persisted()},{n:4096,quantity:events.reduce((sum,e)=>sum+e.quantity,0)});
  await f.env.DB.batch(statements);
  assert.deepEqual({...persisted()},{n:4096,quantity:events.reduce((sum,e)=>sum+e.quantity,0)});
  const saved=f.db.prepare('SELECT source_id,tag FROM rpg_atlas_activity_events WHERE source_id=?').get(events[4095].sourceId);
  assert.equal(saved.source_id,events[4095].sourceId);assert.equal(saved.tag,events[4095].tag);
  t.diagnostic(JSON.stringify({events:4096,chunks:chunks.length,oldSingleBindingBytes,maxBindingBytes:Math.max(...statements.map(s=>Buffer.byteLength(s.params[0],'utf8')))}));
});

test('identical activity sources in separate JSON chunks are counted only once', async t => {
  const f=await fixture(t),unique=unicodeEvents(4095),events=[...unique,{...unique[0]}];
  const statements=Q.activityEventStatements(f.env.DB,options(f,events),T),chunks=activityChunks(statements);
  assert.equal(chunks[0][0].sourceId,chunks.at(-1).at(-1).sourceId);
  await f.env.DB.batch(statements);
  const persisted=f.db.prepare('SELECT COUNT(*) n,SUM(quantity) quantity FROM rpg_atlas_activity_events').get();
  assert.deepEqual({...persisted},{n:4095,quantity:unique.reduce((sum,e)=>sum+e.quantity,0)});
});

test('a signature conflict in the final JSON chunk rolls back earlier chunks and the source operation', async t => {
  const f=await fixture(t);await record(f,[event('already-recorded','kill',7)]);
  const before=f.db.prepare('SELECT * FROM rpg_atlas_activity_events ORDER BY source_id').all();
  const gold=f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(f.id).gold;
  const unique=unicodeEvents(4095),events=[...unique,{...unique[0],quantity:unique[0].quantity+1}];
  const statements=Q.activityEventStatements(f.env.DB,options(f,events),T),chunks=activityChunks(statements);
  assert.equal(chunks[0][0].sourceId,chunks.at(-1).at(-1).sourceId);
  assert.notEqual(chunks[0][0].signature,chunks.at(-1).at(-1).signature);
  await assert.rejects(f.env.DB.batch([
    f.env.DB.prepare('UPDATE rpg_characters SET gold=gold+123 WHERE tg_id=?').bind(f.id),
    ...statements,
  ]),/rpg_atlas_quest_guard/);
  assert.equal(f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(f.id).gold,gold);
  assert.deepEqual(f.db.prepare('SELECT * FROM rpg_atlas_activity_events ORDER BY source_id').all(),before);
});

test('collection and reclaim accept no map but only real quantities affect their own weekly goals', async t => {
  const f=await fixture(t);
  await record(f,[event('collection-deposit','collection',3,{mapId:null,buildId:null}),event('reclaim-batch','reclaim',12,{mapId:null,buildId:null})]);
  const view=await Q.view(f.env,f.id,T);
  assert.equal(find(view,'weekly_collection',isoWeek(T)).progress,3);
  assert.equal(find(view,'weekly_reclaim',isoWeek(T)).progress,12);
  assert.equal(find(view,'daily_hunt',taipeiDay(T)).progress,0);
  assert.equal(find(view,'intro_clear').progress,0);
  assert.equal(find(view,'weekly_three_builds',isoWeek(T)).progress,0);
});

test('offline activity uses its occurrence day and week and survival sums real seconds across midnight', async t => {
  const f=await fixture(t),now=MIDNIGHT+86400000;
  await record(f,[
    event('before-day','kill',40,{occurredAt:MIDNIGHT-1}),
    event('after-day','kill',7,{occurredAt:MIDNIGHT+1}),
    event('before-seconds','survival',1800,{occurredAt:MIDNIGHT-1}),
    event('after-seconds','survival',600,{occurredAt:MIDNIGHT+1}),
  ],now);
  const view=await Q.view(f.env,f.id,now);
  assert.equal(find(view,'daily_hunt','2026-11-01').progress,40);
  assert.equal(find(view,'daily_hunt','2026-11-02').progress,7);
  assert.equal(find(view,'daily_hunt',taipeiDay(now)).progress,0);
  assert.equal(find(view,'daily_exploration','2026-11-01').progress,1800);
  assert.equal(find(view,'daily_exploration','2026-11-02').progress,600);
  assert.equal(find(view,'weekly_region_survey','2026-W44').progress,1);
  assert.equal(find(view,'weekly_region_survey','2026-W45').progress,1);
  const claim=await Q.claim(f.env,f.id,body('daily_hunt','2026-11-01','offline-claim'),now);
  assert.equal(claim.rewards.materials.atlas_shard,1);
  const expired=taipeiAt('2026-11-04',0);
  await assert.rejects(Q.claim(f.env,f.id,body('daily_exploration','2026-11-01'),expired),{code:'atlas_quest_expired'});
  assert.equal((await Q.claim(f.env,f.id,body('daily_hunt','2026-11-01','offline-claim'),expired)).receiptId,claim.receiptId);
});

test('weekly region goals distinguish regions, cumulative time and actually played safe builds', async t => {
  const f=await fixture(t);
  await record(f,[
    event('survey-a','survival',300),event('survey-b','survival',300),
    event('survey-c','survival',599,{mapId:'pillar_intro'}),event('survey-d','survival',600,{mapId:'grove_intro'}),
    event('safe-one','safe_completion',1,{tag:'no_hp_damage'}),event('safe-repeat','safe_completion',1,{tag:'no_hp_damage'}),
    event('safe-two','safe_completion',1,{mapId:'pillar_intro',buildId:'sword_bleed',tag:'no_hp_damage'}),
    ...['laurel_intro','pillar_intro','grove_intro'].map((mapId,i)=>event('encounter-'+i,'encounter',1,{mapId,tag:'treasure'})),
    ...['laurel_intro','pillar_intro','grove_intro'].map((mapId,i)=>event('scroll-'+i,'loot_scroll',2,{mapId})),
  ]);
  let view=await Q.view(f.env,f.id,T);
  assert.equal(find(view,'weekly_region_survey',isoWeek(T)).progress,2);
  assert.equal(find(view,'weekly_stable_builds',isoWeek(T)).progress,2);
  assert.equal(find(view,'weekly_region_encounters',isoWeek(T)).progress,3);
  assert.equal(find(view,'weekly_supply_routes',isoWeek(T)).progress,3);
  await record(f,[event('last-survey-second','survival',1,{mapId:'pillar_intro'})]);
  view=await Q.view(f.env,f.id,T);
  assert.equal(find(view,'weekly_region_survey',isoWeek(T)).progress,3);
});

test('regional chain keeps earned progress but enforces previous receipt on the server before every next claim', async t => {
  const f=await fixture(t);
  await record(f,[event('chain-scout','survival',300),event('chain-elite','elite',2),event('chain-encounter','encounter',1,{tag:'ambush'}),event('chain-safe','safe_completion',1,{tag:'no_hp_damage'})]);
  let view=await Q.view(f.env,f.id,T);
  assert.equal(find(view,'investigate_1_4').progress,1);
  assert.equal(find(view,'investigate_1_4').locked,true);
  assert.equal(find(view,'investigate_1_4').claimable,false);
  await assert.rejects(Q.claim(f.env,f.id,{...body('investigate_1_4'),prerequisites:[],claimed:true,progress:999},T),{code:'atlas_quest_locked'});
  for(let step=1;step<=4;step++){
    view=await Q.view(f.env,f.id,T);assert.equal(find(view,'investigate_1_'+step).claimable,true);
    await Q.claim(f.env,f.id,body('investigate_1_'+step),T);
  }
  assert.equal(count(f,'rpg_atlas_quest_claims'),4);
  assert.equal((await Q.claim(f.env,f.id,body('investigate_1_4','lifetime','chain-replay'),T)).alreadyClaimed,true);
  assert.equal(find(await Q.view(f.env,f.id,T),'investigate_2_1').progress,0);
});

test('activity reward claims are atomic and cannot be duplicated by competing requests', async t => {
  const f=await fixture(t);await record(f,[event('claimable-hunt','kill',40)]);
  f.db.exec("CREATE TRIGGER activity_ledger_fail BEFORE INSERT ON rpg_ledger WHEN NEW.type='永久委託獎勵' BEGIN SELECT RAISE(ABORT,'activity-ledger-fail'); END");
  await assert.rejects(Q.claim(f.env,f.id,body('daily_hunt',taipeiDay(T)),T),/activity-ledger-fail/);
  assert.equal(count(f,'rpg_atlas_quest_claims'),0);assert.equal(count(f,'rpg_atlas_quest_requests'),0);assert.equal(count(f,'rpg_atlas_materials'),0);
  f.db.exec('DROP TRIGGER activity_ledger_fail');
  const results=await Promise.all([Q.claim(f.env,f.id,body('daily_hunt',taipeiDay(T),'hunt-race-one'),T),Q.claim(f.env,f.id,body('daily_hunt',taipeiDay(T),'hunt-race-two'),T)]);
  assert.equal(new Set(results.map(r=>r.receiptId)).size,1);
  assert.equal(count(f,'rpg_atlas_quest_claims'),1);
  assert.equal(f.db.prepare("SELECT quantity FROM rpg_atlas_materials WHERE material='atlas_shard'").get().quantity,1);
});

test('season context produces no activity facts and a season DB cannot be disguised as permanent', async t => {
  const f=await fixture(t);
  assert.deepEqual(Q.activityEventStatements(f.env.DB,{...options(f,[event('season-fact','kill')]),realmId:'season_2026_01'},T),[]);
  f.db.prepare("INSERT INTO rpg_realm_identity(singleton,realm_id,realm_type,database_token,instance_nonce,rules_version,phase,fence_epoch,created_at,updated_at) VALUES(1,'season_2026_01','season','season-token-0123456789','season-instance-0123456789','test-v1','ACTIVE',0,?,?)").run(T,T);
  await assert.rejects(record(f,[event('disguised-season','kill')]),/permanent_only/);
  assert.equal(count(f,'rpg_atlas_activity_events'),0);
  assert.equal((await Q.view(f.env,f.id,T)).enabled,false);
});

test('0041 is additive: v1 receipts, partially accumulated progress, equipment and +N survive exactly', async t => {
  const f=await fixture(t,true);
  f.db.prepare('UPDATE rpg_equipment SET enhance_level=13 WHERE tg_id=?').run(f.id);
  await f.env.DB.batch(Q.questEventStatements(f.env.DB,{accountId:f.account,charId:f.id,events:[{sourceId:'v1-configure',kind:'configure',buildId:'sword_whirlwind',occurredAt:T}]},T));
  const earned=await Q.claim(f.env,f.id,body('intro_build'),T);
  const snapshot=()=>JSON.stringify(['rpg_characters','rpg_equipment','rpg_inventory','rpg_atlas_quest_events','rpg_atlas_quest_claims','rpg_atlas_quest_requests','rpg_ledger','rpg_atlas_materials'].map(table=>[table,f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
  const before=snapshot(),oldView=await Q.view(f.env,f.id,T);
  assert.ok(oldView.quests.every(q=>LEGACY_ATLAS_QUESTS.some(old=>old.id===q.id)));
  await assert.rejects(Q.claim(f.env,f.id,body('daily_hunt',taipeiDay(T)),T),{code:'atlas_activity_unavailable'});
  f.db.exec(readFileSync(new URL('../migrations/0041_atlas_activity_quests.sql',import.meta.url),'utf8'));
  assert.equal(snapshot(),before);
  const replay=await Q.claim(f.env,f.id,body('intro_build'),T);
  assert.equal(replay.receiptId,earned.receiptId);
  assert.equal(snapshot(),before);
  assert.equal(f.db.prepare('SELECT rules_version FROM rpg_atlas_quest_claims').get().rules_version,'atlas-quests-v1');
  assert.equal(find(replay,'daily_hunt',taipeiDay(T)).progress,0);
});
