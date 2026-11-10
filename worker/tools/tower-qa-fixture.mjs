// Disposable tower fixtures and a transparent, opt-in logical clock.
// Only atlas-local-preview's loopback, in-memory SQLite environment can load this module.
import {createHash} from 'node:crypto';
import {seedPartyQa} from './party-qa-fixture.mjs';
import * as Party from '../src/services/party.js';
import {towerEntry} from '../src/services/tower-daily.js';
import {insertEquipStmt,loadPlayer} from '../src/db.js';
import {makeGear} from '../src/game/gear.js';
import {computeStats} from '../src/game/stats.js';

export async function seedTowerQa(env,permanent,now){
 const db=env.DB.sqlite,fixtures=await seedPartyQa(env,permanent,now);
 for(const fixture of fixtures){
  const id=fixture.characterId,gateExample=fixture.accountId==='90101'&&['sword','archer'].includes(fixture.baseClass);
  fixture.level=gateExample?(fixture.baseClass==='sword'?30:60):120;
  fixture.towerBest=gateExample?0:20;
  const row=db.prepare('SELECT special_json FROM rpg_characters WHERE tg_id=?').get(id),special=JSON.parse(row.special_json);
  special.towerBest=fixture.towerBest;special.towerTitle=null;
  db.prepare('UPDATE rpg_characters SET level=?,special_json=?,last_settle_at=? WHERE tg_id=?').run(fixture.level,JSON.stringify(special),now,id);
  db.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'tower_fragment',1000) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity").run(id);
  const owned=makeGear({id:'tower-qa:'+id+':imprint',tgId:id,cls:fixture.baseClass,slot:'helmet',tier:7,forceRarity:'legendary',source:'star_ring',rng:()=>.5,now});
  owned.enhance_level=9;owned.bonus_json=JSON.stringify({...JSON.parse(owned.bonus_json||'{}'),starRingGearVersion:1,starRingYieldVersion:2,freeCastPct:.05,elemPct:.1});
  await insertEquipStmt(env.DB,owned).run();
  const trade={...owned,id:'tower-qa:'+id+':trade',name:'交易保護驗收頭盔'};
  await insertEquipStmt(env.DB,trade).run();db.prepare('UPDATE rpg_equipment SET trade_id=? WHERE id=?').run('qa-tower-trade-'+id,trade.id);
  const busy={...owned,id:'tower-qa:'+id+':processing',name:'背景保護驗收頭盔'};
  await insertEquipStmt(env.DB,busy).run();
  db.prepare("INSERT INTO rpg_auto_enhance(id,owner,tg_id,item_id,item_name,target,blessed,status,level,next_at,created_at,updated_at) VALUES(?,?,?,?,?,10,0,'processing',9,?,?,?)").run('qa-tower-job-'+id,id,id,busy.id,busy.name,now+86400000,now,now);
  const p=await loadPlayer(env.DB,id),stats=computeStats(p.char,p.equipment.filter(e=>e.is_equipped));
  db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp,stats.maxMp,id);
  fixture.equipment={imprint:owned.id,trade:trade.id,processing:busy.id,worn:p.equipment.find(e=>e.is_equipped)?.id};
 }
 return fixtures;
}

function databaseSnapshot(db){
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name),rows={},counts={};
 for(const table of tables){const name=table.replaceAll('"','""');rows[table]=db.prepare('SELECT * FROM "'+name+'"').all().map(row=>JSON.stringify(row)).sort();counts[table]=rows[table].length;}
 return {sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),counts};
}

export function createTowerQaController(env,permanent,fixtures,initialNow){
 let now=initialNow;const commands=[],receipts=new Map(),ids=new Set(fixtures.map(x=>String(x.characterId)));
 const info=()=>({mode:'manual-development-clock',now,wallTime:Date.now(),debugOnly:true,deadlinesUnmodified:true,automaticTowerSweep:false});
 function ownedParty(id){
  const row=env.DB.sqlite.prepare('SELECT id,kind,status,state_json FROM rpg_parties WHERE id=?').get(String(id||''));
  if(!row||row.kind!=='tower')throw Error('QA clock requires an existing synthetic tower party');
  const members=env.DB.sqlite.prepare('SELECT char_id FROM rpg_party_members WHERE party_id=?').all(row.id);
  if(!members.length||members.some(m=>!ids.has(String(m.char_id))))throw Error('QA clock refuses non-fixture members');
  return {...row,state:JSON.parse(row.state_json)};
 }
 return {
  now:()=>now,info,
  snapshot(){
   const db=env.DB.sqlite;
   return {ok:true,isolated:true,ephemeral:true,productionAccess:false,readOnly:true,qaClock:info(),commands,fixtures,
    databases:{permanent:databaseSnapshot(db),season:databaseSnapshot(env.DB_SEASON.sqlite)},
    parties:db.prepare('SELECT id,kind,status,rev,state_json FROM rpg_parties ORDER BY id').all().map(p=>({...p,state:JSON.parse(p.state_json),state_json:undefined})),
    characters:db.prepare('SELECT tg_id,account_tg_id,name,level,hp,mp,rev,party_id,special_json FROM rpg_characters ORDER BY tg_id').all(),
    inventory:db.prepare('SELECT tg_id,item,quantity FROM rpg_inventory ORDER BY tg_id,item').all(),
    equipment:db.prepare('SELECT * FROM rpg_equipment ORDER BY tg_id,id').all(),
    rewards:db.prepare('SELECT party_id,char_id,reward_json,created_at FROM rpg_party_rewards ORDER BY party_id,char_id').all(),
    ledger:db.prepare("SELECT event_id,tg_id,type,item,item_delta,note,created_at FROM rpg_ledger WHERE event_id LIKE 'tower-%' ORDER BY event_id").all()};
  },
  async advance(body){
   const requestId=String(body.requestId||'');if(!/^[\w:-]{1,120}$/.test(requestId))throw Error('QA clock requires requestId');
   const signature=JSON.stringify({op:body.op,partyId:body.partyId||null,characterId:body.characterId||null}),old=receipts.get(requestId);
   if(old){if(old.signature!==signature)throw Error('QA clock requestId content changed');return old.result;}
   const from=now,before=databaseSnapshot(env.DB.sqlite),party=body.partyId?ownedParty(body.partyId):null;
   let target=now;
   if(body.op==='due'){
    if(!party||party.status!=='combat')throw Error('Only a running tower can advance to its next original deadline');
    target=Math.min(party.state.deadline,party.state.challengeEndsAt||Infinity);if(!Number.isFinite(target)||target<=0)throw Error('Invalid original deadline');
    now=Math.max(now,target);
   }else if(body.op==='settle'){
    if(!party)throw Error('QA settlement requires a known synthetic tower party');
    await Party.sweep(permanent,now);
   }else if(['midnight-before','midnight'].includes(body.op)){
    const characterId=String(body.characterId||'');if(!ids.has(characterId))throw Error('QA clock requires a fixture character');
    const daily=await towerEntry(env.DB,characterId,now);target=daily.resetAt-(body.op==='midnight-before'?1:0);if(!Number.isFinite(target)||target<now)throw Error('QA clock only moves forward');
    now=target;
   }else throw Error('Unknown QA clock operation');
   const after=databaseSnapshot(env.DB.sqlite);
   if(body.op!=='settle'&&before.sha256!==after.sha256)throw Error('Moving the QA clock unexpectedly changed gameplay data');
   const result={ok:true,isolated:true,debugOnly:true,productionAccess:false,requestId,op:body.op,partyId:party?.id||null,from,to:now,originalDeadline:party?.state.deadline||null,originalChallengeEndsAt:party?.state.challengeEndsAt||null,deadlinesUnmodified:true,before:before.sha256,after:after.sha256,qaClock:info()};
   commands.push({...result,recordedAt:new Date().toISOString()});receipts.set(requestId,{signature,result});return result;
  }
 };
}
