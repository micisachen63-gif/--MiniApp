// Resumable archive transport. Each invocation advances a persisted cursor;
// history is never re-scanned merely to resume an import.
import {GameError} from '../game/classes.js';
import {realmMaintenanceContext,transitionRealmPhase} from './identity.js';
import {realmCommitGuard} from './guarded-db.js';
import {guardStmt} from '../db.js';
import {transferHash,seasonBlockers,hydrateCharacter,ACTIVE_TABLES} from './season-transfer.js';

const VERSION='season-transfer-v2',EMPTY='0'.repeat(64),PAGE_ROWS=32,MAX_UNITS=4,CHUNK_CHARS=24000;
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const encode=x=>JSON.stringify(canonical(x));
const fail=(code,message)=>{throw new GameError(code,message,409);};
const exported=n=>/^rpg_[a-z0-9_]+$/.test(n)&&!n.startsWith('rpg_realm_')&&!n.startsWith('rpg_season_transfer_')&&n!=='rpg_season_retained_characters'&&!['rpg_admin_sessions','rpg_admin_login_approvals','rpg_app_access'].includes(n);
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
const limitOf=n=>Math.max(1,Math.min(MAX_UNITS,Math.floor(n)||MAX_UNITS));
async function maintenance(root,id,phases){const m=await realmMaintenanceContext(root,id);if(m.context.type!=='season'||!phases.includes(m.context.phase))fail('season_phase','賽季階段不允許此操作');return m;}
const phase=(root,m,next,extra)=>transitionRealmPhase(root,m.context.id,{expectedPhase:m.context.phase,expectedFenceEpoch:m.context.fenceEpoch,nextPhase:next,...extra});
async function schemaState(db){
 const all=await rows(db,"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name");
 const definitions=all.filter(x=>exported(x.tbl_name)||x.name.startsWith('season_immutable_'));
 return {hash:await transferHash(definitions),names:definitions.filter(x=>x.type==='table').map(x=>x.name).sort()};
}
async function job(db,id,kind){return db.prepare('SELECT * FROM rpg_season_transfer_jobs WHERE realm_id=? AND kind=?').bind(id,kind).first();}
function updateJob(db,old,stage,state,now){return [db.prepare('UPDATE rpg_season_transfer_jobs SET stage=?,cursor_json=?,rev=rev+1,updated_at=? WHERE realm_id=? AND kind=? AND rev=?').bind(stage,encode(state),now,old.realm_id,old.kind,old.rev),guardStmt(db)];}
async function assertSchema(m,state){if((await schemaState(m.rawDB)).hash!==state.schemaHash)fail('season_source_changed','來源結構或封存鎖已改變，禁止接續');}
async function manifestFor(m){
 const row=await m.rawDB.prepare('SELECT * FROM rpg_season_transfer_manifests WHERE realm_id=?').bind(m.context.id).first();
 if(!row)fail('season_manifest_missing','缺少封存清單');
 const manifest=JSON.parse(row.manifest_json),locked=await job(m.rawDB,m.context.id,'seal');
 if(manifest.version!==VERSION||manifest.realmId!==m.context.id||manifest.sourceNonce!==m.identity.instance_nonce||row.manifest_hash!==m.context.manifestHash||await transferHash(manifest)!==row.manifest_hash||locked?.stage!=='sealed')fail('season_manifest_invalid','封存清單與來源世界不符');
 await assertSchema(m,{schemaHash:manifest.schemaHash});return {manifest,manifestHash:row.manifest_hash};
}

/** First call locks gameplay tables in the SAME database transaction as the
 * initial checkpoint. Static migration triggers protect even stale/raw writers.
 * 32-row keyset pages and at most four work units bound every request. */
export async function sealSeason(root,id,{now=Date.now(),limit=4}={}){
 const m=await maintenance(root,id,['DRAIN','SEALED','IMPORTING','COMPLETE']);
 if(m.context.phase!=='DRAIN')return {ok:true,status:'sealed',...await manifestFor(m)};
 let saved=await job(m.rawDB,id,'seal');
 if(!saved){
  const blockers=await seasonBlockers(m.env.DB,m.context.cutoffAt);if(blockers.length)fail('season_not_drained',encode(blockers));
  const schema=await schemaState(m.rawDB),state={schemaHash:schema.hash,names:schema.names,tableIndex:0,rowid:null,nextPage:0,nextChunk:0,root:EMPTY,tableRoot:EMPTY,tableRows:0,tablePages:0,schema:null};
  await m.rawDB.batch([realmCommitGuard(m.rawDB,m.identity,{maintenance:true}),m.rawDB.prepare("INSERT INTO rpg_season_transfer_jobs VALUES(?,'seal','sealing',?,0,?)").bind(id,encode(state),now)]);
  saved=await job(m.rawDB,id,'seal');
 }
 let state=JSON.parse(saved.cursor_json);await assertSchema(m,state);
 if(saved.stage==='sealed'){
  const row=await m.rawDB.prepare('SELECT manifest_hash FROM rpg_season_transfer_manifests WHERE realm_id=?').bind(id).first();
  await phase(root,m,'SEALED',{manifestHash:row.manifest_hash,now});return {ok:true,status:'sealed',...await manifestFor(await maintenance(root,id,['SEALED']))};
 }
 let processed=0;
 while(processed<limitOf(limit)&&state.tableIndex<state.names.length){
  const table=state.names[state.tableIndex];
  if(!state.schema)state.schema=(await rows(m.rawDB,`PRAGMA table_info("${table}")`)).map(({name,type,notnull,pk})=>({name,type,notnull,pk}));
  if(state.schema.some(c=>!/^[a-z0-9_]+$/.test(c.name)))fail('season_schema','來源欄位名稱不支援安全封存');
  // Read byte estimates before fetching payloads. Thirty-two near-2MB rows
  // must never be materialized together in a 128MB Worker merely to shrink them.
  const size=state.schema.map(c=>`COALESCE(length(CAST("${c.name}" AS BLOB)),0)`).join('+'),where=state.rowid==null?'':'WHERE rowid>?',args=state.rowid==null?[]:[state.rowid];
  const candidates=await rows(m.rawDB,`SELECT rowid,(${size})*6+${state.schema.length*80} AS bytes FROM "${table}" ${where} ORDER BY rowid LIMIT ${PAGE_ROWS}`,...args);
  let count=0,bytes=0;for(const candidate of candidates){if(count&&bytes+candidate.bytes>192000)break;count++;bytes+=candidate.bytes;}
  const data=count?await rows(m.rawDB,`SELECT rowid AS __season_rowid__,* FROM "${table}" ${where} ORDER BY rowid LIMIT ${count}`,...args):[];
  const text=encode(data.map(({__season_rowid__,...row})=>row));
  const statements=[];
  if(!data.length){
   const definition={table,schema:state.schema,rows:state.tableRows,pages:state.tablePages,root:state.tableRoot};
   statements.push(m.rawDB.prepare('INSERT INTO rpg_season_transfer_tables VALUES(?,?,?)').bind(id,state.tableIndex,encode(definition)));
   state={...state,tableIndex:state.tableIndex+1,rowid:null,tableRoot:EMPTY,tableRows:0,tablePages:0,schema:null};
  }else{
   const parts=[],first=state.nextChunk;
   // Slice UTF-16 safely rather than constructing an array of every codepoint:
   // escaped large JSON rows otherwise need many times their size in JS heap.
   if(new TextEncoder().encode(text).length>1500000)fail('season_row_oversize','單筆歷史超出安全封存大小；保留原資料與檢查點，不截斷內容');
   for(let at=0;at<text.length;){let end=Math.min(text.length,at+CHUNK_CHARS);if(end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--;const payload=text.slice(at,end),hash=await transferHash(payload),number=state.nextChunk++;parts.push({number,hash});statements.push(m.rawDB.prepare('INSERT INTO rpg_season_transfer_chunks VALUES(?,?,?,?)').bind(id,number,hash,payload));at=end;}
   const page={number:state.nextPage,table,rows:data.length,hash:await transferHash(text),firstChunk:first,parts,previous:state.root};
   const header=encode(page),rootHash=await transferHash(header);statements.push(m.rawDB.prepare('INSERT INTO rpg_season_transfer_pages VALUES(?,?,?,?,?)').bind(id,state.nextPage,rootHash,header,table));
   state={...state,rowid:data.at(-1).__season_rowid__,nextPage:state.nextPage+1,root:rootHash,tableRows:state.tableRows+data.length,tablePages:state.tablePages+1,tableRoot:await transferHash(state.tableRoot+rootHash)};
  }
  await m.rawDB.batch([realmCommitGuard(m.rawDB,m.identity,{maintenance:true}),...updateJob(m.rawDB,saved,'sealing',state,now),...statements]);saved={...saved,rev:saved.rev+1};processed++;
 }
 if(state.tableIndex<state.names.length)return {ok:true,status:'sealing',processed,tablesDone:state.tableIndex,tablesTotal:state.names.length,pages:state.nextPage,chunks:state.nextChunk};
 const tables=(await rows(m.rawDB,'SELECT definition_json FROM rpg_season_transfer_tables WHERE realm_id=? ORDER BY table_no',id)).map(r=>JSON.parse(r.definition_json));
 const manifest={version:VERSION,realmId:id,sourceNonce:m.identity.instance_nonce,rulesVersion:m.context.rulesVersion,cutoffAt:m.context.cutoffAt,schemaHash:state.schemaHash,tables,pageCount:state.nextPage,chunkCount:state.nextChunk,root:state.root},hash=await transferHash(manifest);
 await assertSchema(m,state);
 await m.rawDB.batch([realmCommitGuard(m.rawDB,m.identity,{maintenance:true}),...updateJob(m.rawDB,saved,'sealed',state,now),m.rawDB.prepare('INSERT INTO rpg_season_transfer_manifests VALUES(?,?,?,?,?,?)').bind(id,m.identity.instance_nonce,m.context.cutoffAt,hash,encode(manifest),now)]);
 await phase(root,m,'SEALED',{manifestHash:hash,now});return {ok:true,status:'sealed',manifest,manifestHash:hash};
}

async function verifiedPage(db,id,number,previous){
 const saved=await db.prepare('SELECT * FROM rpg_season_transfer_pages WHERE realm_id=? AND page_no=?').bind(id,number).first();
 if(!saved||await transferHash(saved.header_json)!==saved.page_hash)fail('season_chunk_invalid','來源資料頁標頭不符');
 const page=JSON.parse(saved.header_json);
 if(page.number!==number||page.previous!==previous||!exported(page.table)||!Array.isArray(page.parts)||!page.parts.length)fail('season_chunk_invalid','封存頁次雜湊鏈不符');
 const chunks=await rows(db,'SELECT * FROM rpg_season_transfer_chunks WHERE realm_id=? AND chunk_no>=? AND chunk_no<=? ORDER BY chunk_no',id,page.parts[0].number,page.parts.at(-1).number);
 if(chunks.length!==page.parts.length)fail('season_chunk_invalid','來源封存資料不完整');let text='';
 for(let i=0;i<chunks.length;i++){const c=chunks[i],expected=page.parts[i];if(c.chunk_no!==expected.number||c.chunk_hash!==expected.hash||await transferHash(c.payload_json)!==expected.hash)fail('season_chunk_invalid','移轉資料塊雜湊不符');text+=c.payload_json;}
 if(await transferHash(text)!==page.hash)fail('season_chunk_invalid','來源資料頁內容不符');const data=JSON.parse(text);if(!Array.isArray(data)||data.length!==page.rows)fail('season_chunk_invalid','來源資料頁筆數不符');
 return {saved,page,chunks};
}

async function characterTables(m,c){
 const result={};
 // Only this character's LIVE assets are read, using existing owner indexes.
 // Old guardian operation history stays in the archive; referenced operations
 // needed by retained sigils are copied without scanning all summon history.
 for(const table of ACTIVE_TABLES){
  if(table==='rpg_guardian_operations')result[table]=await rows(m.rawDB,'SELECT o.* FROM rpg_guardian_operations o WHERE o.operation_id IN (SELECT source_operation_id FROM rpg_guardian_sigils WHERE char_id=?)',c.tg_id);
  else if(table==='rpg_atlas_forges')result[table]=await rows(m.rawDB,'SELECT f.* FROM rpg_atlas_forges f JOIN rpg_equipment e ON e.id=f.item_id WHERE e.tg_id=?',c.tg_id);
  else result[table]=await rows(m.rawDB,`SELECT * FROM "${table}" WHERE ${['rpg_inventory','rpg_equipment'].includes(table)?'tg_id':'char_id'}=?`,c.tg_id);
 }
 const count=Object.values(result).reduce((sum,r)=>sum+r.length,0),bytes=new TextEncoder().encode(encode(result)).length;
 // Avoid a non-atomic partial character on an exceptional oversized account.
 if(count>5000||bytes>6000000)fail('season_character_oversize','角色資產超過單次原子移轉上限；保留來源與檢查點，請維護處理');
 return result;
}

export async function importSeasonStep(root,id,{now=Date.now(),limit=4}={}){
 let m=await maintenance(root,id,['SEALED','IMPORTING','COMPLETE']);const target=await realmMaintenanceContext(root,'permanent'),{manifest,manifestHash}=await manifestFor(m),db=target.env.DB;
 let saved=await job(target.rawDB,id,'import');
 if(saved&&JSON.parse(saved.cursor_json).manifestHash!==manifestHash)fail('season_import_conflict','目標端已接收不同封存清單');
 if(m.context.phase==='COMPLETE'){
  const prior=await db.prepare('SELECT * FROM rpg_season_transfer_imports WHERE realm_id=?').bind(id).first();if(prior?.status!=='complete'||prior.completion_hash!==m.identity.completion_hash)fail('season_completion_invalid','缺少目標完成收據');
  return {ok:true,status:'complete',manifestHash,completionHash:prior.completion_hash};
 }
 if(!saved){
  const state={manifestHash,targetSchemaHash:(await schemaState(target.rawDB)).hash,schemaIndex:0,page:0,chunk:0,root:EMPTY,characterCursor:null,total:0,completionRoot:EMPTY};
  await db.batch([db.prepare("INSERT OR IGNORE INTO rpg_season_transfer_imports VALUES(?,?,'copying',NULL,?)").bind(id,manifestHash,now),db.prepare('INSERT OR IGNORE INTO rpg_season_transfer_manifests VALUES(?,?,?,?,?,?)').bind(id,manifest.sourceNonce,manifest.cutoffAt,manifestHash,encode(manifest),now),db.prepare("INSERT OR IGNORE INTO rpg_season_transfer_jobs VALUES(?,'import','schema',?,0,?)").bind(id,encode(state),now)]);
  saved=await job(target.rawDB,id,'import');if(JSON.parse(saved.cursor_json).manifestHash!==manifestHash)fail('season_import_conflict','目標端已有不同封存清單');
 }
 if(m.context.phase==='SEALED'){await phase(root,m,'IMPORTING',{now});m=await maintenance(root,id,['IMPORTING']);}
 let state=JSON.parse(saved.cursor_json),processed=0;
 if((await schemaState(target.rawDB)).hash!==state.targetSchemaHash)fail('season_schema','目標結構或封存保護已改變，請核對後接續');
 while(processed<limitOf(limit)){
  if(saved.stage==='schema'){
   const expected=manifest.tables[state.schemaIndex];
   if(expected&&['rpg_characters',...ACTIVE_TABLES].includes(expected.table)){
    const actual=(await rows(target.rawDB,`PRAGMA table_info("${expected.table}")`)).map(({name,type,notnull,pk})=>({name,type,notnull,pk}));if(encode(actual)!==encode(expected.schema))fail('season_schema','目標角色結構不相容');
   }
   if(state.schemaIndex===0&&['rpg_characters',...ACTIVE_TABLES].some(t=>!manifest.tables.some(x=>x.table===t)))fail('season_schema','來源缺少必要角色結構');
   state.schemaIndex++;const stage=state.schemaIndex>=manifest.tables.length?'copying':'schema';
   await db.batch(updateJob(db,saved,stage,state,now));saved={...saved,stage,rev:saved.rev+1};processed++;continue;
  }
  if(saved.stage==='copying'){
   if(state.page>=manifest.pageCount){
    if(state.root!==manifest.root||state.chunk!==manifest.chunkCount)fail('season_chunk_invalid','完整封存雜湊鏈不符');
    await db.batch([...updateJob(db,saved,'hydrating',state,now),db.prepare("UPDATE rpg_season_transfer_imports SET status='hydrating',updated_at=? WHERE realm_id=?").bind(now,id)]);saved={...saved,stage:'hydrating',rev:saved.rev+1};processed++;continue;
   }
   const {saved:pageRecord,page,chunks}=await verifiedPage(m.rawDB,id,state.page,state.root);
   if(page.parts[0].number!==state.chunk)fail('season_chunk_invalid','封存塊編號不連續');
   state={...state,page:state.page+1,chunk:state.chunk+chunks.length,root:pageRecord.page_hash};
   await db.batch([...updateJob(db,saved,'copying',state,now),...chunks.map(c=>db.prepare('INSERT INTO rpg_season_transfer_chunks VALUES(?,?,?,?)').bind(id,c.chunk_no,c.chunk_hash,c.payload_json)),db.prepare('INSERT INTO rpg_season_transfer_pages VALUES(?,?,?,?,?)').bind(id,pageRecord.page_no,pageRecord.page_hash,pageRecord.header_json,page.table)]);
   saved={...saved,rev:saved.rev+1};processed++;continue;
  }
  if(saved.stage==='hydrating'){
   const c=await m.rawDB.prepare(`SELECT * FROM rpg_characters WHERE deleted_at IS NULL ${state.characterCursor==null?'':'AND tg_id>?'} ORDER BY tg_id LIMIT 1`).bind(...(state.characterCursor==null?[]:[state.characterCursor])).first();
   if(!c){
    const completionHash=await transferHash({version:VERSION,manifestHash,characters:state.total,root:state.completionRoot});
    await db.batch([...updateJob(db,saved,'complete',state,now),db.prepare("UPDATE rpg_season_transfer_imports SET status='complete',completion_hash=?,updated_at=? WHERE realm_id=? AND manifest_hash=?").bind(completionHash,now,id,manifestHash)]);saved={...saved,stage:'complete',rev:saved.rev+1};
    await phase(root,m,'COMPLETE',{completionHash,now});return {ok:true,status:'complete',manifestHash,completionHash,characters:state.total};
   }
   // At most one character/request: its independent owner queries and atomic
   // asset batch fit inside the paid-plan D1 query budget regardless of history.
   const result=await hydrateCharacter(target,manifest,await characterTables(m,c),c,now);
   state={...state,characterCursor:c.tg_id,total:state.total+1,completionRoot:await transferHash(state.completionRoot+encode(result))};
   await db.batch(updateJob(db,saved,'hydrating',state,now));return {ok:true,status:'hydrating',processed:1,characters:state.total,manifestHash};
  }
  if(saved.stage==='complete'){
   const prior=await db.prepare('SELECT completion_hash FROM rpg_season_transfer_imports WHERE realm_id=?').bind(id).first();await phase(root,m,'COMPLETE',{completionHash:prior.completion_hash,now});return {ok:true,status:'complete',manifestHash,completionHash:prior.completion_hash,characters:state.total};
  }
 }
 return {ok:true,status:saved.stage==='schema'?'copying':saved.stage,processed,pagesCopied:state.page,pagesTotal:manifest.pageCount,characters:state.total,manifestHash};
}
