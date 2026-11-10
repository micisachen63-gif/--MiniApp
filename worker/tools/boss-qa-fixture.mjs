// Opt-in, loopback-only Boss QA fixtures. Both SQLite databases are :memory:.
// Boss spawns, attacks, expiry and kill settlement always use the existing services.
import {createHash} from 'node:crypto';
import {seedPartyQa} from './party-qa-fixture.mjs';
import * as Player from '../src/services/player.js';
import * as Boss from '../src/services/boss.js';
import {BOSS} from '../src/game/constants.js';
import {attackWindow} from '../src/game/boss.js';
import {taipeiDay,taipeiAt} from '../src/game/time.js';
import {resolveRealm,scopeEnvForRealm,transitionRealmPhase} from '../src/realm/index.js';

function isolated(env){
 if(env.ENVIRONMENT!=='development'||env.ALLOW_DEV_AUTH!=='true')throw Error('Boss QA requires the explicit isolated development preview');
 for(const db of [env.DB,env.DB_SEASON]){
  if(!db?.sqlite||db.sqlite.prepare('PRAGMA database_list').all().some(x=>x.file))throw Error('Boss QA refuses a persistent database');
 }
}
export function bossDatabaseSnapshot(db){
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name),rows={},counts={},tableHashes={};
 for(const name of tables){rows[name]=db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(x=>JSON.stringify(x)).sort();counts[name]=rows[name].length;tableHashes[name]=createHash('sha256').update(JSON.stringify(rows[name])).digest('hex');}
 return {sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),tableHashes,counts,totalChanges:db.prepare('SELECT total_changes() AS n').get().n,outboxHash:tableHashes.rpg_outbox};
}
export async function seedBossQa(env,permanent,now){
 isolated(env);
 const fixtures=await seedPartyQa(env,permanent,now),db=env.DB.sqlite;
 for(const fixture of fixtures){
  fixture.realmId='permanent';fixture.role=fixture.accountId==='90103'?'fragile':'contributor';
  const id=fixture.characterId;
  for(const [key,n]of [['boss_essence',200],['relic_fragment',60],['mat_3',2],['mat_4',3]])db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(id,key,n);
  // Use one learned offensive spell so the attack case observes a real counter hit.
  if(fixture.baseClass==='mage'&&fixture.role==='contributor'){
   const row=db.prepare('SELECT special_json FROM rpg_characters WHERE tg_id=?').get(id),special=JSON.parse(row.special_json);
   if(!special.learned.includes('skill_06_1'))throw Error('Boss QA offensive spell is not learned');
   special.loadout=['skill_06_1'];db.prepare('UPDATE rpg_characters SET special_json=? WHERE tg_id=?').run(JSON.stringify(special),id);fixture.loadout=special.loadout;
  }
  if(fixture.role==='fragile'){
   db.prepare("UPDATE rpg_characters SET level=15,class_path='',hp=1,mp=1,auto_red_pct=20,auto_blue=0,special_json='{}' WHERE tg_id=?").run(id);
   db.prepare('UPDATE rpg_equipment SET is_equipped=0 WHERE tg_id=?').run(id);
   db.prepare("UPDATE rpg_inventory SET quantity=0 WHERE tg_id=? AND item LIKE 'red_%'").run(id);
   fixture.level=15;fixture.classPath='';fixture.loadout=[];
  }
 }
 const season=scopeEnvForRealm(env,await resolveRealm(env,'season_2026_01'));
 const player=await Player.createCharacter(season,{tgId:'90101',charSlot:1,name:'凍結世界首領驗收',baseClass:'mage',gender:'f'},now);
 const seasonFixtures=[{accountId:'90101',characterId:player.char.tg_id,name:player.char.name,realmId:'season_2026_01',role:'frozen-read'}];
 const frozenSpawn=await Boss.spawnDue(season,now,{force:{tier:3}});
 await transitionRealmPhase(env,'season_2026_01',{expectedPhase:'ACTIVE',expectedFenceEpoch:0,nextPhase:'FREEZE',cutoffAt:now,now});
 return {fixtures,seasonFixtures,frozenBossId:frozenSpawn.id};
}

export function createBossQaController(env,permanent,seed,initialNow){
 isolated(env);
 let now=initialNow,holdSettlement=null,armedInventoryRace=null;
 const commands=[],receipts=new Map(),faults=[],bossIds=new Set();
 const fixtureIds=new Set(seed.fixtures.map(x=>String(x.characterId)));
 const originalBatch=env.DB.batch.bind(env.DB);
 env.DB.batch=async function(stmts){
  const sql=stmts.map(x=>String(x.sql||''));
  if(holdSettlement&&sql.some(s=>/UPDATE rpg_boss_instances SET status\s*=\s*'killed'/.test(s))){
   const bossId=holdSettlement;holdSettlement=null;faults.push({kind:'settlement-batch-held',bossId,now,at:new Date().toISOString(),databaseTouchedByFault:false});
   throw Error('QA_SETTLEMENT_PAUSED_BEFORE_ATOMIC_REWARD_BATCH');
  }
  if(armedInventoryRace&&stmts.some(s=>/INSERT(?: OR IGNORE)? INTO rpg_ledger/.test(s.sql||'')&&(s.params||[]).some(p=>String(p).startsWith('boss-exchange:'+armedInventoryRace.characterId+':')))&&sql.some(s=>/UPDATE rpg_characters/.test(s))){
   const race=armedInventoryRace;armedInventoryRace=null;
   env.DB.sqlite.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=quantity+excluded.quantity').run(race.characterId,race.item,race.delta);
   faults.push({kind:'synthetic-concurrent-inventory-change',...race,now,at:new Date().toISOString()});
  }
  return originalBatch(stmts);
 };
 const info=()=>({mode:'manual-development-clock',now,wallTime:Date.now(),debugOnly:true,deadlinesUnmodified:true,automaticBossSweep:false,attackWindowMs:BOSS.attackWindowMs,durationMs:BOSS.durationMs});
 const knownBoss=id=>{
  if(!bossIds.has(String(id||'')))throw Error('Boss QA requires a boss spawned by this controller');
  const boss=env.DB.sqlite.prepare('SELECT * FROM rpg_boss_instances WHERE id=?').get(String(id));
  if(!boss)throw Error('Synthetic Boss missing');return boss;
 };
 const knownActor=id=>{if(!fixtureIds.has(String(id||'')))throw Error('Boss QA requires a synthetic fixture character');return String(id);};
 return {
  now:()=>now,info,
  snapshot(){
   isolated(env);
   const db=env.DB.sqlite;
   return {ok:true,isolated:true,ephemeral:true,productionAccess:false,readOnly:true,qaClock:info(),commands,faults,...seed,
    databases:{permanent:bossDatabaseSnapshot(db),season:bossDatabaseSnapshot(env.DB_SEASON.sqlite)},
    bosses:db.prepare('SELECT * FROM rpg_boss_instances ORDER BY started_at,id').all().map(x=>({...x,result:x.result_json?JSON.parse(x.result_json):null})),
    attacks:db.prepare('SELECT * FROM rpg_boss_attacks ORDER BY boss_id,tg_id,win').all(),
    characters:db.prepare('SELECT tg_id,account_tg_id,name,level,hp,mp,rev,boss_down_until,party_id FROM rpg_characters ORDER BY tg_id').all(),
    inventory:db.prepare('SELECT tg_id,item,quantity FROM rpg_inventory ORDER BY tg_id,item').all(),
    equipment:db.prepare('SELECT * FROM rpg_equipment ORDER BY tg_id,id').all(),
    counters:db.prepare('SELECT * FROM rpg_daily_counters ORDER BY tg_id,day,key').all(),
    ledger:db.prepare("SELECT * FROM rpg_ledger WHERE event_id LIKE 'boss%' ORDER BY event_id").all(),
    outbox:db.prepare('SELECT * FROM rpg_outbox ORDER BY id').all(),
    realmIdentities:{permanent:db.prepare('SELECT * FROM rpg_realm_identity').all(),season:env.DB_SEASON.sqlite.prepare('SELECT * FROM rpg_realm_identity').all()}};
  },
  async advance(body){
   isolated(env);
   const requestId=String(body.requestId||'');if(!/^[\w:-]{1,120}$/.test(requestId))throw Error('Boss QA command requires requestId');
   const signature=JSON.stringify(Object.fromEntries(Object.entries(body).filter(([k])=>k!=='requestId').sort(([a],[b])=>a.localeCompare(b)))),prior=receipts.get(requestId);
   if(prior){if(prior.signature!==signature)throw Error('Boss QA requestId changed content');return prior.result;}
   const from=now,before={permanent:bossDatabaseSnapshot(env.DB.sqlite),season:bossDatabaseSnapshot(env.DB_SEASON.sqlite)};
   let boss=body.bossId?knownBoss(body.bossId):null,result=null,clockOnly=false;
   if(body.op==='spawn'){
    const tier=Number(body.tier??3);if(!Number.isInteger(tier)||tier<1||tier>12)throw Error('Invalid synthetic Boss tier');
    if(env.DB.sqlite.prepare("SELECT id FROM rpg_boss_instances WHERE status IN ('active','settling')").get())throw Error('Finish the current synthetic Boss before spawning another');
    if(env.DB.sqlite.prepare('SELECT id FROM rpg_boss_instances WHERE id=?').get('t'+now))now++;
    result=await Boss.spawnDue(permanent,now,{force:{tier}});bossIds.add(result.id);boss=knownBoss(result.id);
   }else if(body.op==='next-window'){
    if(!boss||boss.status!=='active')throw Error('A running synthetic Boss is required');
    const target=boss.started_at+(attackWindow(boss,now)+1)*BOSS.attackWindowMs;if(target>=boss.ends_at)throw Error('Next original attack window is outside this Boss lifetime');
    now=Math.max(now,target);clockOnly=true;
   }else if(body.op==='expiry'){
    if(!boss)throw Error('Boss required');now=Math.max(now,boss.ends_at);clockOnly=true;
   }else if(body.op==='down-expiry'){
    const id=knownActor(body.characterId),row=env.DB.sqlite.prepare('SELECT boss_down_until FROM rpg_characters WHERE tg_id=?').get(id);
    if(!row.boss_down_until)throw Error('Fixture is not downed');now=Math.max(now,row.boss_down_until);clockOnly=true;
   }else if(body.op==='midnight'){
    now=taipeiAt(taipeiDay(now+86400000),0);clockOnly=true;
   }else if(body.op==='settle'){
    if(!boss)throw Error('Boss required');result=await Boss.settleKill(permanent,boss.id,now);
   }else if(body.op==='expire'){
    result=await Boss.expireDue(permanent,now);
   }else if(body.op==='hold-settlement'){
    if(!boss||boss.status!=='active')throw Error('Active Boss required');holdSettlement=boss.id;clockOnly=true;
   }else if(body.op==='inventory-race'){
    const characterId=knownActor(body.characterId),item=String(body.item||''),delta=Number(body.delta);
    if(!['mat_3','mat_4'].includes(item)||!Number.isInteger(delta)||delta!==1||armedInventoryRace)throw Error('Only one explicit extra legacy material may race');
    armedInventoryRace={characterId,item,delta};clockOnly=true;
   }else throw Error('Unknown Boss QA command');
   const after={permanent:bossDatabaseSnapshot(env.DB.sqlite),season:bossDatabaseSnapshot(env.DB_SEASON.sqlite)};
   if(clockOnly&&JSON.stringify(before)!==JSON.stringify(after))throw Error('QA clock/control unexpectedly changed gameplay data');
   const receipt={ok:true,isolated:true,debugOnly:true,productionAccess:false,requestId,op:body.op,bossId:boss?.id||null,from,to:now,originalStartedAt:boss?.started_at||null,originalEndsAt:boss?.ends_at||null,deadlinesUnmodified:true,before,after,result,qaClock:info()};
   commands.push({...receipt,recordedAt:new Date().toISOString()});receipts.set(requestId,{signature,result:receipt});return receipt;
  }
 };
}
