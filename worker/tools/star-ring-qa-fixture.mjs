// Explicit opt-in, loopback-only Star Ring QA. Both D1 shims are :memory:.
// Synthetic actors are initial input only. Runs/checkpoints/rewards use original services.
import {createHash} from 'node:crypto';
import {seedPartyQa} from './party-qa-fixture.mjs';
import * as Player from '../src/services/player.js';
import * as StarRing from '../src/services/star-ring.js';
import {DURATION,STAGE_MS,HOUR_MS,CORE} from '../src/game/star-ring.js';
import {insertEquipStmt,loadPlayer} from '../src/db.js';
import {makeGear} from '../src/game/gear.js';
import {computeStats} from '../src/game/stats.js';
import {GENERAL_WEAPON,SLOTS,POTIONS} from '../src/game/constants.js';
import {eligible,SPECIAL_SKILLS} from '../src/game/special.js';
import {taipeiDay,taipeiAt} from '../src/game/time.js';
import {resolveRealm,scopeEnvForRealm,transitionRealmPhase} from '../src/realm/index.js';

function isolated(env){
 if(env.ENVIRONMENT!=='development'||env.ALLOW_DEV_AUTH!=='true')throw Error('Star Ring QA requires the explicit isolated development preview');
 for(const db of [env.DB,env.DB_SEASON]){
  if(!db?.sqlite||db.sqlite.prepare('PRAGMA database_list').all().some(x=>x.file))throw Error('Star Ring QA refuses a persistent database');
 }
}
export function starRingDatabaseSnapshot(db){
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name),rows={},counts={},tableHashes={};
 for(const name of tables){rows[name]=db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(x=>JSON.stringify(x)).sort();counts[name]=rows[name].length;tableHashes[name]=createHash('sha256').update(JSON.stringify(rows[name])).digest('hex');}
 return {sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),tableHashes,counts,totalChanges:db.prepare('SELECT total_changes() AS n').get().n,outboxHash:tableHashes.rpg_outbox};
}
async function prepareActor(scope,db,c,now){
 const id=c.tg_id,base=c.base_class,classPath=base==='mage'||base==='archer'?'B11':'A11';
 const learned=SPECIAL_SKILLS.filter(skill=>eligible({base_class:base,class_path:classPath,level:120},skill)).map(skill=>skill.id);
 const chosen=base==='mage'?['skill_06_2','skill_06_1','skill_17_2']:learned.slice(0,3);
 const special={learned,loadout:chosen.filter(id=>learned.includes(id)),auto:{},cooldowns:{},mode:'safe',budget:0,autoBluePct:0};
 db.prepare("UPDATE rpg_characters SET level=120,class_path=?,gold=50000,hp=1,mp=1,party_id=NULL,idle_state='gate',last_settle_at=?,special_json=? WHERE tg_id=?").run(classPath,now,JSON.stringify(special),id);
 db.prepare('DELETE FROM rpg_equipment WHERE tg_id=?').run(id);
 for(const slot of SLOTS)for(let position=1;position<=(['ring','earring'].includes(slot)?2:1);position++){
  const item=makeGear({id:'star-ring-qa:'+id+':'+slot+':'+position,tgId:id,cls:base,slot,kind:GENERAL_WEAPON[base],tier:12,forceRarity:'legendary',source:'shop',rng:()=>.5,now});
  item.enhance_level=7;item.is_equipped=position;await insertEquipStmt(scope.DB,item).run();
 }
 for(const key of Object.keys(POTIONS))db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,200) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(id,key);
 const player=await loadPlayer(scope.DB,id),stats=computeStats(player.char,player.equipment.filter(e=>e.is_equipped));
 db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp,stats.maxMp,id);
 return {accountId:String(c.account_tg_id),characterId:id,name:c.name,baseClass:base,classPath,level:120,loadout:special.loadout,realmId:scope.REALM_CONTEXT?.id||'permanent'};
}
export async function seedStarRingQa(env,permanent,now){
 isolated(env);
 const fixtures=(await seedPartyQa(env,permanent,now)).map(x=>({...x,realmId:'permanent'})),db=env.DB.sqlite;
 for(const [accountId,baseClass,name]of [['90104','archer','星環驗收妖精'],['90105','mage','星環驗收法師']]){
  const player=await Player.createCharacter(permanent,{tgId:accountId,charSlot:1,name,baseClass,gender:'f'},now);
  fixtures.push(await prepareActor(permanent,env.DB.sqlite,{...player.char,account_tg_id:accountId},now));
 }
 for(const f of fixtures){
  f.role=f.accountId==='90102'?'journey-leader':f.accountId==='90101'&&f.baseClass==='mage'?'primary-invitee':f.accountId==='90101'?'owned-report-alt':f.accountId==='90105'?'stage-one-departure':'journey-member';
  for(const [item,quantity]of [['star_ring_token',2000],[CORE,240]])db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(f.characterId,item,quantity);
 }
 const primary=fixtures.find(x=>x.role==='primary-invitee');
 db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(primary.characterId,primary.accountId);
 const journeyActors=[fixtures.find(x=>x.role==='journey-leader'),primary,...['90103','90104','90105'].map(a=>fixtures.find(x=>x.accountId===a))];
 if(journeyActors.some(x=>!x)||new Set(journeyActors.map(x=>x.accountId)).size!==5)throw Error('Star Ring fixture requires five distinct accounts');
 const season=scopeEnvForRealm(env,await resolveRealm(env,'season_2026_01'));
 const player=await Player.createCharacter(season,{tgId:'90101',charSlot:1,name:'凍結世界星環驗收',baseClass:'mage',gender:'f'},now);
 const actor=await prepareActor(season,env.DB_SEASON.sqlite,{...player.char,account_tg_id:'90101'},now);
 for(const [item,quantity]of [['star_ring_token',2000],[CORE,240]])env.DB_SEASON.sqlite.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(actor.characterId,item,quantity);
 const frozen=await StarRing.create(season,actor.characterId,{tier:40,difficulty:'normal',tactic:'steady',requestId:'qa_frozen_ring_01'},now);
 await transitionRealmPhase(env,'season_2026_01',{expectedPhase:'ACTIVE',expectedFenceEpoch:0,nextPhase:'FREEZE',cutoffAt:now,now});
 return {fixtures,journeyActors,seasonFixtures:[{...actor,role:'frozen-read'}],frozenRunId:frozen.party.id,seededAt:now};
}

export function createStarRingQaController(env,permanent,seed,initialNow){
 isolated(env);
 let now=initialNow;
 const commands=[],receipts=new Map(),fixtureIds=new Set(seed.fixtures.map(x=>String(x.characterId)));
 const info=()=>({mode:'manual-development-clock',now,wallTime:Date.now(),debugOnly:true,deadlinesUnmodified:true,automaticStarRingSweep:false,durationMs:DURATION,stageMs:STAGE_MS,hourMs:HOUR_MS,lobbyMs:1800000});
 const ownedRun=id=>{
  if(!/^ring:[0-9a-f]{32}$/.test(String(id||'')))throw Error('Star Ring QA requires an exact original run ID');
  const p=env.DB.sqlite.prepare('SELECT * FROM rpg_star_ring_runs WHERE id=?').get(String(id));
  if(!p)throw Error('Unknown original synthetic run');
  const members=env.DB.sqlite.prepare('SELECT * FROM rpg_star_ring_members WHERE run_id=?').all(p.id);
  if(!members.length||members.some(x=>!fixtureIds.has(String(x.char_id))))throw Error('Star Ring QA can only inspect its synthetic fixture runs');
  return {...p,state:JSON.parse(p.state_json),members};
 };
 const runRows=db=>db.prepare('SELECT * FROM rpg_star_ring_runs ORDER BY created_at,id').all().map(p=>({...p,state:JSON.parse(p.state_json),state_json:undefined}));
 return {
  now:()=>now,info,
  snapshot(){
   isolated(env);const db=env.DB.sqlite;
   return {ok:true,isolated:true,ephemeral:true,productionAccess:false,readOnly:true,qaClock:info(),commands,...seed,
    databases:{permanent:starRingDatabaseSnapshot(db),season:starRingDatabaseSnapshot(env.DB_SEASON.sqlite)},
    runs:runRows(db),seasonRuns:runRows(env.DB_SEASON.sqlite),
    members:db.prepare('SELECT * FROM rpg_star_ring_members ORDER BY run_id,char_id').all(),
    starts:db.prepare('SELECT * FROM rpg_star_ring_starts ORDER BY char_id,day').all(),
    operations:db.prepare('SELECT * FROM rpg_star_ring_operations ORDER BY run_id,char_id,request_id').all(),
    creations:db.prepare('SELECT * FROM rpg_star_ring_creations ORDER BY char_id,request_id').all(),
    rewards:db.prepare('SELECT * FROM rpg_star_ring_rewards ORDER BY run_id,char_id,stage').all().map(r=>({...r,reward:JSON.parse(r.reward_json),reward_json:undefined})),
    purchases:db.prepare('SELECT * FROM rpg_star_ring_purchases ORDER BY char_id,request_id').all().map(r=>({...r,reward:JSON.parse(r.reward_json),reward_json:undefined})),
    cosmetics:db.prepare('SELECT * FROM rpg_star_ring_cosmetics ORDER BY char_id,cosmetic_id').all(),
    cosmeticOperations:db.prepare('SELECT * FROM rpg_star_ring_cosmetic_operations ORDER BY char_id,request_id').all(),
    presence:db.prepare('SELECT * FROM rpg_party_presence ORDER BY account_id,char_id').all(),
    characters:db.prepare('SELECT tg_id,account_tg_id,name,level,exp,hp,mp,rev,party_id,last_settle_at,special_json FROM rpg_characters ORDER BY tg_id').all(),
    accounts:db.prepare('SELECT account_tg_id,active_char_id FROM rpg_accounts ORDER BY account_tg_id').all(),
    inventory:db.prepare('SELECT tg_id,item,quantity FROM rpg_inventory ORDER BY tg_id,item').all(),
    equipment:db.prepare('SELECT * FROM rpg_equipment ORDER BY tg_id,id').all(),
    foregroundParties:db.prepare('SELECT * FROM rpg_parties ORDER BY id').all().map(p=>({...p,state:JSON.parse(p.state_json),state_json:undefined})),
    foregroundMembers:db.prepare('SELECT * FROM rpg_party_members ORDER BY party_id,char_id').all(),
    foregroundRewards:db.prepare('SELECT * FROM rpg_party_rewards ORDER BY party_id,char_id').all(),
    ledger:db.prepare("SELECT * FROM rpg_ledger WHERE event_id LIKE 'star-ring%' ORDER BY event_id").all(),
    outbox:db.prepare('SELECT * FROM rpg_outbox ORDER BY id').all(),
    realmIdentities:{permanent:db.prepare('SELECT * FROM rpg_realm_identity').all(),season:env.DB_SEASON.sqlite.prepare('SELECT * FROM rpg_realm_identity').all()}};
  },
  async advance(body){
   isolated(env);
   const requestId=String(body.requestId||'');if(!/^[\w:-]{1,120}$/.test(requestId))throw Error('Star Ring QA command requires requestId');
   const signature=JSON.stringify(Object.fromEntries(Object.entries(body).filter(([k])=>k!=='requestId').sort(([a],[b])=>a.localeCompare(b)))),prior=receipts.get(requestId);
   if(prior){if(prior.signature!==signature)throw Error('Star Ring QA command ID changed content');return prior.result;}
   const from=now,before={permanent:starRingDatabaseSnapshot(env.DB.sqlite),season:starRingDatabaseSnapshot(env.DB_SEASON.sqlite)};
   const party=body.partyId?ownedRun(body.partyId):null;let result=null,clockOnly=false;
   if(body.op==='before-stage'||body.op==='stage'){
    const stage=Number(body.stage);
    if(!party||party.status!=='running'||!Number.isInteger(stage)||stage<1||stage>6||party.state.results.length!==stage-1)throw Error('Stage must continue an exact uncommitted original checkpoint');
    const target=party.state.startedAt+stage*STAGE_MS-(body.op==='before-stage'?60000:0);
    if(target<now)throw Error('QA clock refuses to rewind');now=target;clockOnly=true;
   }else if(body.op==='lobby-expiry'){
    if(!party||party.status!=='lobby')throw Error('Original lobby required');now=Math.max(now,party.expires_at);clockOnly=true;
   }else if(body.op==='midnight'){
    now=taipeiAt(taipeiDay(now+86400000),0);clockOnly=true;
   }else if(body.op==='sweep'){
    if(!party)throw Error('Target run required to document the original sweep');
    result=await StarRing.sweep(permanent,now,30);
   }else throw Error('Unknown Star Ring QA command');
   const after={permanent:starRingDatabaseSnapshot(env.DB.sqlite),season:starRingDatabaseSnapshot(env.DB_SEASON.sqlite)};
   if(clockOnly&&JSON.stringify(before)!==JSON.stringify(after))throw Error('QA clock unexpectedly changed gameplay data');
   const receipt={ok:true,isolated:true,debugOnly:true,productionAccess:false,requestId,op:body.op,stage:body.stage??null,partyId:party?.id||null,from,to:now,originalStartedAt:party?.state.startedAt||null,originalEndsAt:party?.state.endsAt||null,originalLobbyExpiry:party?.expires_at||null,deadlinesUnmodified:true,before,after,result,qaClock:info()};
   commands.push({...receipt,recordedAt:new Date().toISOString()});receipts.set(requestId,{signature,result:receipt});return receipt;
  }
 };
}
