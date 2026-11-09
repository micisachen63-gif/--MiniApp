import {GameError} from '../game/classes.js';
import {realmMaintenanceContext,transitionRealmPhase} from './identity.js';
import {realmCommitGuard} from './guarded-db.js';
import * as Atlas from '../services/atlas.js';
import * as Player from '../services/player.js';
import * as AutoEnhance from '../services/auto-enhance.js';
import * as AutoReroll from '../services/auto-reroll.js';
import * as GuardianAuto from '../services/guardian-auto.js';
import * as Trade from '../services/trade.js';
import * as Party from '../services/party.js';
import * as Ring from '../services/star-ring.js';
import * as Boss from '../services/boss.js';
import {invDeltaStmt,guardStmt,ledgerStmt} from '../db.js';

const VERSION='season-transfer-v1',CHUNK_CHARS=24000;
const safeName=n=>typeof n==='string'&&/^rpg_[a-z0-9_]+$/.test(n);
const fail=(code,message)=>{throw new GameError(code,message,409);};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const encode=x=>JSON.stringify(canonical(x));
export async function transferHash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:encode(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
const transferTable=n=>n.startsWith('rpg_season_transfer_')||n==='rpg_season_retained_characters';
const noExport=n=>n.startsWith('rpg_realm_')||transferTable(n)||['rpg_admin_sessions','rpg_admin_login_approvals','rpg_app_access'].includes(n);
async function source(env,id,phases){const m=await realmMaintenanceContext(env,id);if(m.context.type!=='season'||!phases.includes(m.context.phase))fail('season_phase','賽季階段不允許此操作');return m;}
const phaseStep=(env,c,next,extra={})=>transitionRealmPhase(env,c.id,{expectedPhase:c.phase,expectedFenceEpoch:c.fenceEpoch,nextPhase:next,...extra});

/** Bounded maintenance step. Gameplay routes retain their read-only freeze fence.
 * No future ticks, purchases, skill casts or recruitment are synthesized. */
export async function drainSeasonStep(root,id,{now=Date.now(),limit=20}={}){
  let m=await source(root,id,['FREEZE','DRAIN']);
  if(m.context.phase==='FREEZE'){await phaseStep(root,m.context,'DRAIN',{now});m=await source(root,id,['DRAIN']);}
  const env=m.env,db=env.DB,at=m.context.cutoffAt,budget=Math.max(1,Math.min(50,Math.floor(limit)||20));let processed=0;
  const take=async(sql)=>rows(db,sql+' LIMIT '+Math.max(0,budget-processed));
  for(const j of await take("SELECT id,tg_id FROM rpg_auto_enhance WHERE status='running'")){await AutoEnhance.stop(env,j.tg_id,{jobId:j.id},at);processed++;}
  for(const j of await take("SELECT id,tg_id FROM rpg_auto_reroll WHERE status='running'")){await AutoReroll.stop(env,j.tg_id,{jobId:j.id},at);processed++;}
  for(const j of await take("SELECT id,char_id FROM rpg_guardian_auto WHERE status='running'")){await GuardianAuto.stop(env,j.char_id,{jobId:j.id},at);processed++;}
  for(const r of await take("SELECT id,char_id FROM rpg_atlas_runs WHERE status='running'")){await Atlas.settle(env,r.char_id,{runId:r.id},at);processed++;}
  for(const p of await take("SELECT id,leader_id FROM rpg_parties WHERE status IN('lobby','combat')")){await Party.action(env,p.leader_id,{partyId:p.id,op:'end',requestId:'season-end-'+p.id},at);processed++;}
  if(processed<budget){const swept=await Ring.sweep(env,at,Math.min(6,budget-processed));processed+=swept.processed;}
  for(const p of await take("SELECT r.id,m.char_id FROM rpg_star_ring_runs r JOIN rpg_star_ring_members m ON m.run_id=r.id WHERE r.status IN('lobby','running') AND (r.status='lobby' OR r.next_at>"+at+") AND m.left_at IS NULL")){await Ring.action(env,p.char_id,{partyId:p.id,op:'leave',requestId:'season-end-'+p.id+'-'+p.char_id},at);processed++;}
  for(const p of await take("SELECT p.id,m.char_id FROM rpg_parties p JOIN rpg_party_members m ON m.party_id=p.id LEFT JOIN rpg_party_rewards r ON r.party_id=p.id AND r.char_id=m.char_id WHERE r.char_id IS NULL AND EXISTS(SELECT 1 FROM json_each(p.state_json,'$.actors') a WHERE json_extract(a.value,'$.id')=m.char_id AND json_extract(a.value,'$.actions')>0) AND (p.status='won' OR (p.kind='tower' AND p.status IN('lost','ended') AND COALESCE(json_extract(p.state_json,'$.clearedFloor'),0)>=COALESCE(json_extract(p.state_json,'$.startFloor'),1)))")){await Party.reward(env,p.char_id,{partyId:p.id,requestId:'season-reward-'+p.id+'-'+p.char_id},at);processed++;}
  for(const t of await take("SELECT id,a_tg FROM rpg_trades WHERE status='open'")){await Trade.cancel(env,{tgId:t.a_tg,tradeId:t.id,requestId:'season-close-'+t.id},at);processed++;}
  // Cancel escrow directly with the same CAS, refund and ledger authority, without
  // requiring the seller to select an inactive character during maintenance.
  for(const l of await take("SELECT * FROM rpg_exchange_listings WHERE status='active'")){
    const extra=[db.prepare("UPDATE rpg_exchange_listings SET status='cancelled',rev=rev+1,closed_at=?,updated_at=? WHERE id=? AND rev=? AND status='active'").bind(at,at,l.id,l.rev),guardStmt(db)];
    if(l.kind==='equip')extra.push(db.prepare('UPDATE rpg_equipment SET trade_id=NULL WHERE id=? AND tg_id=? AND trade_id=?').bind(l.ref,l.seller_char,'exchange:'+l.id),guardStmt(db));
    else if(l.kind==='guardian')extra.push(db.prepare('UPDATE rpg_guardian_sigils SET exchange_id=NULL,rev=rev+1,updated_at=? WHERE id=? AND char_id=? AND exchange_id=?').bind(at,l.ref,l.seller_char,l.id),guardStmt(db));
    else extra.push(invDeltaStmt(db,l.seller_char,l.ref,l.qty));
    extra.push(ledgerStmt(db,{event_id:`exchange:${l.id}:return`,tg_id:l.seller_char,type:'季末交易所取回',item:l.kind==='equip'?'equip:'+l.ref:l.kind==='guardian'?'sigil:'+l.ref:l.ref,item_delta:l.qty},at));
    await db.batch(extra);processed++;
  }
  if(processed<budget){await db.prepare("UPDATE rpg_boss_instances SET ends_at=MIN(ends_at,?) WHERE status='active'").bind(at).run();await Boss.expireDue(env,at);await Party.sweep(env,at,6);}
  for(const c of await take('SELECT tg_id FROM rpg_live_characters WHERE last_settle_at<'+at+" AND atlas_run_id IS NULL AND party_id IS NULL")){await Player.withPlayer(env,c.tg_id,at);processed++;}
  const blockers=await seasonBlockers(db,at);
  return {ok:true,realmId:id,phase:'DRAIN',cutoffAt:at,processed,ready:blockers.length===0,blockers};
}

export async function seasonBlockers(db,cutoff){
  const checks=[
    ['atlas',"SELECT COUNT(*) n FROM rpg_atlas_runs WHERE status='running'"],
    ['party',"SELECT COUNT(*) n FROM rpg_parties WHERE status IN('lobby','combat')"],
    ['ring',"SELECT COUNT(*) n FROM rpg_star_ring_runs WHERE status IN('lobby','running')"],
    ['trade',"SELECT COUNT(*) n FROM rpg_trades WHERE status='open'"],
    ['exchange',"SELECT COUNT(*) n FROM rpg_exchange_listings WHERE status='active'"],
    ['enhance',"SELECT COUNT(*) n FROM rpg_auto_enhance WHERE status IN('running','processing')"],
    ['reroll',"SELECT COUNT(*) n FROM rpg_auto_reroll WHERE status IN('running','processing')"],
    ['summon',"SELECT COUNT(*) n FROM rpg_guardian_auto WHERE status='running'"],
    ['boss',"SELECT COUNT(*) n FROM rpg_boss_instances WHERE status IN('active','settling') OR (settled_at IS NULL AND hp<=0)"],
    ['equipped_escrow','SELECT COUNT(*) n FROM rpg_equipment WHERE trade_id IS NOT NULL'],
    ['guardian_escrow','SELECT COUNT(*) n FROM rpg_guardian_sigils WHERE trade_id IS NOT NULL OR exchange_id IS NOT NULL'],
    ['presence','SELECT COUNT(*) n FROM rpg_party_presence'],
    ['party_rewards',"SELECT COUNT(*) n FROM rpg_parties p JOIN rpg_party_members m ON m.party_id=p.id LEFT JOIN rpg_party_rewards r ON r.party_id=p.id AND r.char_id=m.char_id WHERE r.char_id IS NULL AND EXISTS(SELECT 1 FROM json_each(p.state_json,'$.actors') a WHERE json_extract(a.value,'$.id')=m.char_id AND json_extract(a.value,'$.actions')>0) AND (p.status='won' OR (p.kind='tower' AND p.status IN('lost','ended') AND COALESCE(json_extract(p.state_json,'$.clearedFloor'),0)>=COALESCE(json_extract(p.state_json,'$.startFloor'),1)))"],
    ['clock','SELECT COUNT(*) n FROM rpg_live_characters WHERE last_settle_at<'+cutoff],
  ];
  const out=[];for(const [kind,sql]of checks){const count=Number(await db.prepare(sql).first('n'));if(count)out.push({kind,count});}return out;
}

async function snapshot(db,{store=null}={}){
  const names=(await rows(db,"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rpg_%' ORDER BY name")).map(x=>x.name).filter(n=>!noExport(n));
  const tables=[],chunks=[];
  for(const table of names){
    if(!safeName(table))fail('season_schema','資料表名稱不合法');
    const schema=(await rows(db,`PRAGMA table_info("${table}")`)).map(({name,type,notnull,pk})=>({name,type,notnull,pk})),pages=[];let cursor=null,total=0;
    for(;;){
      const data=await rows(db,`SELECT rowid AS __season_rowid__,* FROM "${table}" ${cursor==null?'':'WHERE rowid>?'} ORDER BY rowid LIMIT 32`,...(cursor==null?[]:[cursor]));
      if(!data.length)break;cursor=data.at(-1).__season_rowid__;for(const row of data)delete row.__season_rowid__;
      const text=encode(data),codepoints=Array.from(text),parts=[];
      for(let at=0;at<codepoints.length;at+=CHUNK_CHARS){
        const payload=codepoints.slice(at,at+CHUNK_CHARS).join(''),number=chunks.length,hash=await transferHash(payload);chunks.push({number,hash});parts.push(number);
        if(store){const old=await db.prepare('SELECT chunk_hash FROM rpg_season_transfer_chunks WHERE realm_id=? AND chunk_no=?').bind(store.context.id,number).first();if(old&&old.chunk_hash!==hash)fail('season_chunk_changed','封存資料塊不一致');if(!old)await db.batch([realmCommitGuard(db,store.identity,{maintenance:true}),db.prepare('INSERT INTO rpg_season_transfer_chunks VALUES(?,?,?,?)').bind(store.context.id,number,hash,payload)]);}
      }
      pages.push({rows:data.length,hash:await transferHash(text),chunks:parts});total+=data.length;
    }
    tables.push({table,schema,rows:total,hash:await transferHash(pages),pages,chunks:pages.flatMap(p=>p.chunks)});
  }
  return {tables,chunks};
}

/** Seals only after the original economic resolvers have drained through cutoff. */
export async function sealSeason(root,id,{now=Date.now()}={}){
  const m=await source(root,id,['DRAIN','SEALED','IMPORTING','COMPLETE']);
  if(m.context.phase!=='DRAIN')return storedManifest(m);
  const blockers=await seasonBlockers(m.env.DB,m.context.cutoffAt);if(blockers.length)fail('season_not_drained',encode(blockers));
  const snap=await snapshot(m.rawDB,{store:m}),manifest={version:VERSION,realmId:id,sourceNonce:m.identity.instance_nonce,rulesVersion:m.context.rulesVersion,cutoffAt:m.context.cutoffAt,tables:snap.tables,chunks:snap.chunks.map(({number,hash})=>({number,hash}))},hash=await transferHash(manifest);
  const old=await m.rawDB.prepare('SELECT manifest_hash FROM rpg_season_transfer_manifests WHERE realm_id=?').bind(id).first();if(old&&old.manifest_hash!==hash)fail('season_manifest_changed','封存來源已變動，請核對維護狀態');
  const last=await snapshot(m.rawDB);if(await transferHash(last.tables)!==await transferHash(snap.tables))fail('season_source_changed','封存期間來源資料改變，未切換封存階段');
  if(!old)await m.rawDB.batch([realmCommitGuard(m.rawDB,m.identity,{maintenance:true}),m.rawDB.prepare('INSERT INTO rpg_season_transfer_manifests VALUES(?,?,?,?,?,?)').bind(id,m.identity.instance_nonce,m.context.cutoffAt,hash,encode(manifest),now)]);
  await phaseStep(root,m.context,'SEALED',{manifestHash:hash,now});return storedManifest(await source(root,id,['SEALED']));
}
async function storedManifest(m){
  const row=await m.rawDB.prepare('SELECT * FROM rpg_season_transfer_manifests WHERE realm_id=?').bind(m.context.id).first();
  if(!row)fail('season_manifest_missing','缺少封存清單');
  const manifest=JSON.parse(row.manifest_json);
  if(manifest.version!==VERSION||manifest.realmId!==m.context.id||manifest.sourceNonce!==m.identity.instance_nonce||row.manifest_hash!==m.context.manifestHash||await transferHash(manifest)!==row.manifest_hash)fail('season_manifest_invalid','封存清單與來源世界不符');
  const current=await snapshot(m.rawDB);if(encode(current.tables)!==encode(manifest.tables))fail('season_source_changed','封存後的來源資料與清單不符；禁止匯入');
  return {manifest,manifestHash:row.manifest_hash};
}
async function readTables(db,id,manifest){
  const result={};
  for(const t of manifest.tables){
    if(await transferHash(t.pages)!==t.hash)fail('season_table_invalid','移轉資料表頁次不符');
    const keep=t.table==='rpg_characters'||ACTIVE_TABLES.includes(t.table);let count=0;if(keep)result[t.table]=[];
    for(const page of t.pages){
      let text='';for(const no of page.chunks){const chunk=await db.prepare('SELECT * FROM rpg_season_transfer_chunks WHERE realm_id=? AND chunk_no=?').bind(id,no).first(),expected=manifest.chunks[no];if(!chunk||!expected||chunk.chunk_hash!==expected.hash||await transferHash(chunk.payload_json)!==expected.hash)fail('season_chunk_invalid','移轉資料塊雜湊不符');text+=chunk.payload_json;}
      if(await transferHash(text)!==page.hash)fail('season_table_invalid','移轉資料頁雜湊不符');const data=JSON.parse(text);if(!Array.isArray(data)||data.length!==page.rows)fail('season_table_invalid','移轉筆數不符');count+=data.length;if(keep)result[t.table].push(...data);
    }
    if(count!==t.rows)fail('season_table_invalid','移轉資料表筆數不符');
  }return result;
}

const ACTIVE_TABLES=['rpg_inventory','rpg_equipment','rpg_guardian_operations','rpg_guardian_sigils','rpg_atlas_profiles','rpg_atlas_materials','rpg_atlas_progress','rpg_atlas_talents','rpg_atlas_forges','rpg_equipment_collection_entries','rpg_equipment_collection_completions','rpg_equipment_archive','rpg_equipment_recovery_balances','rpg_star_ring_cosmetics','rpg_fate_gifts','rpg_fate_memorials','rpg_fate_lives'];
const originKey=(realm,type,id)=>`retained:${realm}:${type}:${id}`;
function rewrite(value,mapping){
  if(typeof value==='string')return mapping.get(value)||value;
  if(Array.isArray(value))return value.map(x=>rewrite(x,mapping));
  return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[mapping.get(k)||k,rewrite(v,mapping)])):value;
}
async function insert(db,table,row){
  const keys=Object.keys(row);if(!safeName(table)||keys.some(k=>!/^[a-z0-9_]+$/.test(k))||keys.length>100)fail('season_schema','匯入欄位超出規則');
  return db.prepare(`INSERT INTO "${table}"(${keys.map(k=>'"'+k+'"').join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...keys.map(k=>row[k]));
}

/** One character and every live owned asset are committed in ONE target batch.
 * Archives retain all history/private/account state without overwriting native
 * account settings or replaying original operation/reward identifiers. */
async function hydrateCharacter(target,manifest,tables,c,now){
  const db=target.env.DB,id=manifest.realmId,key=originKey(id,'character',c.tg_id),account=String(c.account_tg_id||c.tg_id);
  const prior=await db.prepare('SELECT * FROM rpg_season_retained_characters WHERE realm_id=? AND source_char_id=?').bind(id,c.tg_id).first();
  if(prior){if(prior.target_char_id!==key||prior.status!=='complete')fail('season_character_conflict','保留角色狀態不一致');return JSON.parse(prior.result_json);}
  const mapping=new Map([[String(c.tg_id),key]]),ownedItems=tables.rpg_equipment.filter(x=>x.tg_id===c.tg_id),ownedGuardians=tables.rpg_guardian_sigils.filter(x=>x.char_id===c.tg_id);
  for(const e of ownedItems)mapping.set(e.id,originKey(id,'item',e.id));for(const e of ownedGuardians)mapping.set(e.id,originKey(id,'guardian',e.id));
  for(const op of tables.rpg_guardian_operations.filter(x=>x.char_id===c.tg_id))mapping.set(op.operation_id,originKey(id,'operation',op.operation_id));
  const collision=await db.prepare('SELECT 1 FROM rpg_characters WHERE name=? COLLATE NOCASE').bind(c.name).first();
  const name=collision?`${c.name}_${(await transferHash(id+':'+c.tg_id)).slice(0,8)}`:c.name;
  const next={...c,tg_id:key,name,account_tg_id:account,retention_group:id,origin_realm_id:id,origin_character_id:c.tg_id,party_id:null,atlas_run_id:null,idle_combat_json:null,last_settle_at:now,updated_at:now};
  if(next.special_json)next.special_json=encode(rewrite(JSON.parse(next.special_json),mapping));
  const statements=[db.prepare('INSERT OR IGNORE INTO rpg_accounts(account_tg_id,active_char_id,updated_at) VALUES(?,?,?)').bind(account,key,now),await insert(db,'rpg_characters',next)];let assets=0;
  for(const table of ACTIVE_TABLES){
    for(const original of tables[table]||[]){
      const owned=original.tg_id===c.tg_id||original.char_id===c.tg_id||(table==='rpg_atlas_forges'&&ownedItems.some(e=>e.id===original.item_id));if(!owned)continue;
      const row={...original};
      for(const field of ['tg_id','char_id'])if(row[field]===c.tg_id)row[field]=key;
      if(table==='rpg_equipment')row.id=mapping.get(original.id);
      if(table==='rpg_guardian_operations'){row.operation_id=mapping.get(original.operation_id);row.request_id='season:'+await transferHash(id+':'+original.request_id);}
      if(table==='rpg_guardian_sigils'){row.id=mapping.get(original.id);row.source_operation_id=mapping.get(original.source_operation_id)||original.source_operation_id;}
      if(table==='rpg_fate_gifts')row.id=originKey(id,'gift',row.id);
      if(table==='rpg_fate_lives'){row.id=originKey(id,'life',row.id);if(row.status==='active'){row.status='completed';row.completed_at=manifest.cutoffAt;}}
      if(row.item_id)row.item_id=originKey(id,'item',original.item_id);
      for(const field of Object.keys(row).filter(k=>k.endsWith('_json'))){try{row[field]=encode(rewrite(JSON.parse(row[field]),mapping));}catch{/* Null/scalar legacy values stay exact. */}}
      statements.push(await insert(db,table,row));assets++;
    }
  }
  const result={sourceRealmId:id,sourceCharacterId:c.tg_id,characterId:key,sourceName:c.name,name,level:c.progression_level||c.level,slot:c.char_slot,retentionGroup:id,assets};
  statements.push(ledgerStmt(db,{event_id:`season-transfer:${id}:${c.tg_id}`,tg_id:key,type:'季末角色保留',gold_delta:c.gold,note:encode({sourceRealmId:id,sourceCharacterId:c.tg_id,assets,manifestVersion:VERSION})},now),db.prepare("INSERT INTO rpg_season_retained_characters VALUES(?,?,?,?,?,'complete',?,?)").bind(id,c.tg_id,account,key,c.name,encode(result),now));
  try{await db.batch(statements);}catch(error){const saved=await db.prepare('SELECT result_json FROM rpg_season_retained_characters WHERE realm_id=? AND source_char_id=?').bind(id,c.tg_id).first();if(saved)return JSON.parse(saved.result_json);throw error;}
  return result;
}

/** Bounded and restartable; data comes ONLY from the verified sealed source DB. */
export async function importSeasonStep(root,id,{now=Date.now(),limit=10}={}){
  let m=await source(root,id,['SEALED','IMPORTING','COMPLETE']);const target=await realmMaintenanceContext(root,'permanent'),sealed=await storedManifest(m),{manifest,manifestHash}=sealed,db=target.env.DB;
  const old=await db.prepare('SELECT * FROM rpg_season_transfer_imports WHERE realm_id=?').bind(id).first();
  if(old&&old.manifest_hash!==manifestHash)fail('season_import_conflict','目標端已接收不同的封存清單');
  if(m.context.phase==='COMPLETE'){if(old?.status!=='complete'||old.completion_hash!==m.identity.completion_hash)fail('season_completion_invalid','缺少目標完成收據');return {ok:true,status:'complete',manifestHash,completionHash:old.completion_hash};}
  if(!old)await db.prepare("INSERT INTO rpg_season_transfer_imports VALUES(?,?,'copying',NULL,?)").bind(id,manifestHash,now).run();
  const targetManifest=await db.prepare('SELECT manifest_hash FROM rpg_season_transfer_manifests WHERE realm_id=?').bind(id).first();
  if(targetManifest&&targetManifest.manifest_hash!==manifestHash)fail('season_import_conflict','目標封存清單不同');
  if(!targetManifest)await db.prepare('INSERT INTO rpg_season_transfer_manifests VALUES(?,?,?,?,?,?)').bind(id,manifest.sourceNonce,manifest.cutoffAt,manifestHash,encode(manifest),now).run();
  if(m.context.phase==='SEALED'){await phaseStep(root,m.context,'IMPORTING',{now});m=await source(root,id,['IMPORTING']);}
  let processed=0;const budget=Math.max(1,Math.min(50,Math.floor(limit)||10));
  for(const expected of manifest.chunks){
    const previous=await db.prepare('SELECT chunk_hash,payload_json FROM rpg_season_transfer_chunks WHERE realm_id=? AND chunk_no=?').bind(id,expected.number).first();
    if(previous){if(previous.chunk_hash!==expected.hash||await transferHash(previous.payload_json)!==expected.hash)fail('season_chunk_invalid','目標資料塊遭變更');continue;}
    const chunk=await m.rawDB.prepare('SELECT * FROM rpg_season_transfer_chunks WHERE realm_id=? AND chunk_no=?').bind(id,expected.number).first();
    if(!chunk||chunk.chunk_hash!==expected.hash||await transferHash(chunk.payload_json)!==expected.hash)fail('season_chunk_invalid','來源資料塊不符');
    try{await db.prepare('INSERT INTO rpg_season_transfer_chunks VALUES(?,?,?,?)').bind(id,expected.number,expected.hash,chunk.payload_json).run();}catch(error){const won=await db.prepare('SELECT chunk_hash FROM rpg_season_transfer_chunks WHERE realm_id=? AND chunk_no=?').bind(id,expected.number).first();if(won?.chunk_hash!==expected.hash)throw error;}
    if(++processed>=budget)return {ok:true,status:'copying',processed,manifestHash};
  }
  // Verify the full destination before allowing any playable character to appear.
  const tables=await readTables(db,id,manifest);
  for(const table of ['rpg_characters',...ACTIVE_TABLES]){
    const expected=manifest.tables.find(t=>t.table===table);if(!expected)fail('season_schema','來源缺少必要角色結構');
    const actual=(await rows(target.rawDB,`PRAGMA table_info("${table}")`)).map(({name,type,notnull,pk})=>({name,type,notnull,pk}));if(encode(actual)!==encode(expected.schema))fail('season_schema','目標角色結構不相容');
  }
  await db.prepare("UPDATE rpg_season_transfer_imports SET status='hydrating',updated_at=? WHERE realm_id=? AND status='copying'").bind(now,id).run();
  const characters=tables.rpg_characters.filter(c=>c.deleted_at==null),results=[];processed=0;
  for(const c of characters){const previous=await db.prepare('SELECT result_json FROM rpg_season_retained_characters WHERE realm_id=? AND source_char_id=?').bind(id,c.tg_id).first();if(previous){results.push(JSON.parse(previous.result_json));continue;}results.push(await hydrateCharacter(target,manifest,tables,c,now));if(++processed>=budget)return {ok:true,status:'hydrating',processed,manifestHash};}
  const completionHash=await transferHash({version:VERSION,manifestHash,characters:results});
  await db.prepare("UPDATE rpg_season_transfer_imports SET status='complete',completion_hash=?,updated_at=? WHERE realm_id=? AND manifest_hash=?").bind(completionHash,now,id,manifestHash).run();
  await phaseStep(root,m.context,'COMPLETE',{completionHash,now});return {ok:true,status:'complete',manifestHash,completionHash,characters:results.length};
}

/** Safe public projection, not an endpoint for private archive contents. */
export async function retainedCharacters(env,account){return {ok:true,characters:(await rows(env.DB,"SELECT realm_id,source_name,target_char_id,result_json FROM rpg_season_retained_characters WHERE account_id=? AND status='complete' ORDER BY realm_id,source_char_id",String(account))).map(r=>JSON.parse(r.result_json))};}
