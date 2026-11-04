import {GameError} from '../game/classes.js';
import {loadPlayer,guardStmt,classifyDbError,ledgerBatchStmts} from '../db.js';
import {withPlayer} from './player.js';
import {equipmentCollectionToken} from './equipment-collection.js';
import {equipmentCollectionCatalog,matchesCollectionRequirement} from '../game/equipment-collection.js';
import {EQUIPMENT_RECOVERY_VERSION,RECOVERY_BATCH_LIMIT,RECOVERY_SOURCES,archiveIdentity,recoveryYield,highValueEquipment,recoveryReforgeCost} from '../game/equipment-recovery.js';
import {gearIconSrc} from '../game/share.js';
import {rollAffixes,affixView} from '../game/affixes.js';
import {applyEquipmentAbilityPatch} from '../realm/asset-preservation.js';
import {mulberry32} from '../game/rng.js';
import {activityEventStatements} from './atlas-quests.js';

const enabled=env=>String(env.EQUIPMENT_RECOVERY_ENABLED)==='true';
const realm=env=>env.REALM_CONTEXT?.id||'permanent';
const fail=(message,code='equipment_recovery',status=409)=>{throw new GameError(code,message,status);};
const actor=p=>String(p.char.account_tg_id||p.char.tg_id);
const canAct=(env,now)=>(!env.REALM_CONTEXT?.phase||env.REALM_CONTEXT.phase==='ACTIVE')&&(env.REALM_CONTEXT?.cutoffAt==null||now<env.REALM_CONTEXT.cutoffAt);
async function player(env,charId){const p=await loadPlayer(env.DB,charId,env);if(!p)fail('請先選擇角色','no_character',404);return p;}
function modeOf(b){if(!['archive','salvage','reforge'].includes(b.mode))fail('請選擇典藏、精煉或重洗','recovery_mode',400);return b.mode;}
function idsOf(b,mode){if(!Array.isArray(b.itemIds)||!b.itemIds.length||b.itemIds.length>(mode==='reforge'?1:RECOVERY_BATCH_LIMIT)||b.itemIds.some(id=>typeof id!=='string'||!id||id.length>240)||new Set(b.itemIds).size!==b.itemIds.length)fail('裝備清單無效；每次最多 50 件，重洗一次 1 件','recovery_items',400);return [...b.itemIds].sort();}
function activityReason(char){return char.atlas_run_id?'請先結束星圖出征再整理裝備':char.party_id?'請先結束隊伍或遠征再整理裝備':null;}
function itemReason(e,locks){return e.is_equipped?'穿戴中，請先卸下':e.trade_id?'交易或交易所保管中':locks.has(e.id)?'背景強化或洗屬性進行中':null;}
async function stateFor(db,charId){
 const [entries,legacy,locks,balance,presence]=await Promise.all([
  db.prepare('SELECT * FROM rpg_equipment_archive WHERE char_id=? ORDER BY created_at,entry_id').bind(charId).all(),
  db.prepare('SELECT * FROM rpg_equipment_collection_entries WHERE char_id=? ORDER BY created_at,collection_id,requirement_id').bind(charId).all(),
  db.prepare("SELECT item_id FROM rpg_auto_enhance WHERE tg_id=? AND status IN ('running','processing') UNION SELECT item_id FROM rpg_auto_reroll WHERE tg_id=? AND status IN ('running','processing')").bind(charId,charId).all(),
  db.prepare('SELECT dust,rev FROM rpg_equipment_recovery_balances WHERE char_id=?').bind(charId).first(),
  db.prepare('SELECT 1 FROM rpg_party_presence WHERE char_id=? LIMIT 1').bind(charId).first(),
 ]);
 const seen=new Map();
 for(const [rows,origin] of [[legacy.results,'legacy_collection'],[entries.results,'archive']])for(const row of rows){
  let item;try{item=JSON.parse(row.snapshot_json);}catch{continue;}const identity=archiveIdentity(item);if(!identity)continue;
  if(!seen.has(identity.entryId))seen.set(identity.entryId,{...identity,itemId:item.id,name:item.name,enhance:item.enhance_level,icon:gearIconSrc(item),origin,registeredAt:row.created_at});
 }
 return {seen,legacy:legacy.results,locks:new Set(locks.results.map(r=>r.item_id)),dust:balance?.dust||0,presence:!!presence};
}
function legacyNeeded(p,s,item){
 const filled=new Set(s.legacy.map(e=>e.collection_id+':'+e.requirement_id));
 return equipmentCollectionCatalog(p.char.base_class).some(c=>c.requirements.some(r=>!filled.has(c.id+':'+r.id)&&matchesCollectionRequirement(item,r)));
}
const display=e=>({id:e.id,name:e.name,enhance:e.enhance_level,tier:e.tier,slot:e.slot,kind:e.kind,source:e.source,grade:e.grade,bound:!!e.bound,icon:gearIconSrc(e)});
export async function view(env,charId,now){
 if(!enabled(env))return {ok:true,enabled:false,realmId:realm(env),characterId:charId,now};
 const p=await player(env,charId),s=await stateFor(env.DB,charId),groups=new Map();
 for(const e of p.equipment){const identity=archiveIdentity(e);if(identity){const list=groups.get(identity.entryId)||[];list.push(e);groups.set(identity.entryId,list);}}
 const safeDuplicates=new Set();
 for(const [id,group]of groups){
  const spare=group.filter(e=>!itemReason(e,s.locks)&&!highValueEquipment(e)&&recoveryYield(e)>0&&!legacyNeeded(p,s,e)).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  // Keep one for a first archive unless an existing/protected copy already represents it.
  const reserve=s.seen.has(id)||group.some(e=>!spare.includes(e))?0:1;
  for(const e of spare.slice(reserve))safeDuplicates.add(e.id);
 }
 const items=p.equipment.map(e=>{const identity=archiveIdentity(e),blockedReason=itemReason(e,s.locks)||(!identity?'尚無對應的裝備模板':null);
  return {...display(e),...identity,archived:!!identity&&s.seen.has(identity.entryId),blockedReason,legacyNeeded:legacyNeeded(p,s,e),
   highValue:highValueEquipment(e),dust:recoveryYield(e),reforgeCost:recoveryReforgeCost(e),suggestedSalvage:!blockedReason&&safeDuplicates.has(e.id),affixes:affixView(e)};});
 const entries=[...s.seen.values()];
 return {ok:true,enabled:true,rulesVersion:EQUIPMENT_RECOVERY_VERSION,balanceStatus:'prototype',realmId:realm(env),characterId:charId,
  lockedReason:activityReason(p.char)||(s.presence?'請先離開招募中的隊伍':null)||(!canAct(env,now)?'此環境已停止新的裝備操作':null),
  dust:s.dust,gold:p.char.gold,batchLimit:RECOVERY_BATCH_LIMIT,scope:'character',entries,archivedCount:entries.length,
  sources:RECOVERY_SOURCES.map(g=>({...g,count:entries.filter(e=>e.sourceGroup===g.id).length})),items,
  description:'首次典藏永久保存一件裝備的完整紀錄；重複裝備精煉成角色專用材料，用於重洗其他裝備詞條。舊收藏加成原樣保留。',now};
}
async function plan(env,p,s,b,now){
 const mode=modeOf(b),ids=idsOf(b,mode);
 if(!canAct(env,now))fail('此環境已停止新的裝備操作','realm_closed');
 const busy=activityReason(p.char)||(s.presence?'請先離開招募中的隊伍':null);if(busy)fail(busy);
 if(p.char.active_char_id&&String(p.char.active_char_id)!==String(p.char.tg_id))fail('角色已切換','character_changed');
 const selected=[],newEntries=new Set();let dust=0;
 for(const id of ids){
  const e=p.equipment.find(x=>x.id===id);if(!e)fail('裝備已移動或不屬於目前角色','equipment_changed');
  const blocked=itemReason(e,s.locks);if(blocked)fail(blocked);
  const identity=archiveIdentity(e);if(!identity)fail('裝備模板尚不支援，請保留此裝備');
  if(mode==='archive'){
   if(s.seen.has(identity.entryId)||newEntries.has(identity.entryId))fail('這個裝備款式與品質已典藏；重複裝備可改用精煉','archive_exists');
   newEntries.add(identity.entryId);
  }else if(mode==='salvage'){
   const amount=recoveryYield(e);if(!amount)fail('新手裝備無精煉產出，可留用或首次典藏');dust+=amount;
  }
  selected.push({item:e,identity,token:await equipmentCollectionToken(e)});
 }
 const cost=mode==='reforge'?recoveryReforgeCost(selected[0].item):{dust:0,gold:0};
 if(mode==='reforge'&&(s.dust<cost.dust||p.char.gold<cost.gold))fail('精煉材料或金幣不足','insufficient');
 const payload={version:EQUIPMENT_RECOVERY_VERSION,realmId:realm(env),characterId:p.char.tg_id,mode,items:selected.map(e=>({id:e.item.id,token:e.token})),dust,cost};
 return {mode,selected,dust,cost,token:await equipmentCollectionToken(payload),requiresHighValueConfirmation:mode!=='reforge'&&selected.some(e=>highValueEquipment(e.item))};
}
function planView(p){
 return {mode:p.mode,token:p.token,items:p.selected.map(e=>({...display(e.item),...e.identity,dust:recoveryYield(e.item),highValue:highValueEquipment(e.item)})),
  consumesEquipment:p.mode!=='reforge',dustGained:p.dust,cost:p.cost,newEntries:p.mode==='archive'?p.selected.length:0,requiresHighValueConfirmation:p.requiresHighValueConfirmation,
  warning:p.mode==='reforge'?'重洗會重新隨機所有獨立詞條，可能變強或變弱；原強化值、品質、元素與身分保留。':'確認後會永久消耗所列裝備，無法取回；請確認名稱、來源與強化值。'};
}
export async function preview(env,charId,b,now){
 if(!enabled(env))fail('裝備典藏與精煉尚未開放','equipment_recovery_unavailable',503);
 const p=await player(env,charId),s=await stateFor(env.DB,charId),q=await plan(env,p,s,b,now);
 return {ok:true,realmId:realm(env),characterId:charId,...planView(q),now};
}
function actorGuard(db,charId){
 return db.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT EXISTS(SELECT 1 FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=? AND COALESCE(a.active_char_id,c.tg_id)=c.tg_id AND c.party_id IS NULL AND c.atlas_run_id IS NULL AND NOT EXISTS(SELECT 1 FROM rpg_party_presence WHERE char_id=c.tg_id))').bind(charId);
}
function exactItem(db,charId,item,mode,affixes){
 const fields=Object.keys(item),condition=fields.map(k=>'"'+k+'" IS ?').join(' AND ');
 const where='id=? AND tg_id=? AND is_equipped=0 AND trade_id IS NULL AND '+condition+" AND NOT EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=? AND status IN ('running','processing')) AND NOT EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=? AND status IN ('running','processing'))";
 return db.prepare((mode==='reforge'?'UPDATE rpg_equipment SET affixes_json=? WHERE ':'DELETE FROM rpg_equipment WHERE ')+where)
  .bind(...(mode==='reforge'?[affixes]:[]),item.id,charId,...fields.map(k=>item[k]),item.id,item.id);
}
export async function action(env,charId,b,now){
 const mode=modeOf(b),ids=idsOf(b,mode);
 if(!/^[A-Za-z0-9_:-]{6,96}$/.test(b.requestId||''))fail('需要有效操作編號','request',400);
 const p=await player(env,charId),db=env.DB,account=actor(p);
 const signature=JSON.stringify({realmId:realm(env),charId,mode,itemIds:ids,token:b.token,acknowledge:b.acknowledge===true,confirmHighValue:b.confirmHighValue===true});
 async function replay(){
  const row=await db.prepare('SELECT signature,result_json FROM rpg_equipment_recovery_operations WHERE account_id=? AND request_id=?').bind(account,b.requestId).first();
  if(!row)return null;if(row.signature!==signature)fail('操作編號已用於不同的裝備操作','request_reused');return JSON.parse(row.result_json);
 }
 if(!enabled(env)){
  const ready=await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rpg_equipment_recovery_operations'").first();
  const saved=ready?await replay():null;if(saved)return {ok:true,enabled:false,realmId:realm(env),characterId:charId,result:saved,replayed:true,now};
  fail('裝備典藏與精煉尚未開放','equipment_recovery_unavailable',503);
 }
 const prior=await replay();if(prior)return {...await view(env,charId,now),result:prior,replayed:true};
 if(b.acknowledge!==true)fail('請先確認預覽所列的裝備與消耗','recovery_confirmation');
 if(!/^[a-f0-9]{64}$/.test(b.token||''))fail('請重新預覽裝備清單','equipment_changed');
 const seed=crypto.getRandomValues(new Uint32Array(1))[0];let result;
 try{
  await withPlayer(env,charId,now,async(work,ctx)=>{
   const s=await stateFor(db,charId),q=await plan(env,work,s,b,now);
   if(q.token!==b.token)fail('裝備或方案已變更，請重新確認預覽','equipment_changed');
   if(q.requiresHighValueConfirmation&&b.confirmHighValue!==true)fail('含強化、高品質或遺物裝備，請另外確認','recovery_high_value');
   const extra=[actorGuard(db,charId)],ledger=[];
   let afterAffixes=null;
   for(const {item,identity} of q.selected){
    if(mode==='archive')extra.push(db.prepare('INSERT INTO rpg_equipment_archive(char_id,entry_id,rules_version,source_group,tier,item_id,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(charId,identity.entryId,EQUIPMENT_RECOVERY_VERSION,identity.sourceGroup,item.tier,item.id,JSON.stringify(item),now));
    let next=null;
    if(mode==='reforge'){
     next=applyEquipmentAbilityPatch(item,{affixes_json:JSON.stringify(rollAffixes(item,mulberry32(seed)))});
     afterAffixes={before:affixView(item),after:affixView(next)};
    }
    extra.push(exactItem(db,charId,item,mode,next?.affixes_json),guardStmt(db));
    ledger.push({event_id:'recovery:'+account+':'+b.requestId+':'+item.id,tg_id:charId,type:mode==='archive'?'裝備首次典藏':mode==='salvage'?'裝備精煉':'精煉材料重洗',item:'equip:'+item.id,item_delta:mode==='reforge'?0:-1,note:JSON.stringify({mode,entryId:identity.entryId,name:item.name,enhance:item.enhance_level,rulesVersion:EQUIPMENT_RECOVERY_VERSION})});
   }
   if(mode==='salvage')extra.push(db.prepare('INSERT INTO rpg_equipment_recovery_balances(char_id,dust,updated_at) VALUES(?,?,?) ON CONFLICT(char_id) DO UPDATE SET dust=dust+excluded.dust,rev=rev+1,updated_at=excluded.updated_at').bind(charId,q.dust,now));
   if(mode==='reforge'){
    work.char.gold-=q.cost.gold;
    extra.push(db.prepare('UPDATE rpg_equipment_recovery_balances SET dust=dust-?,rev=rev+1,updated_at=? WHERE char_id=? AND dust>=?').bind(q.cost.dust,now,charId,q.cost.dust),guardStmt(db));
   }
   result={mode,itemIds:ids,count:ids.length,dustGained:q.dust,cost:q.cost,newEntries:mode==='archive'?ids.length:0,affixes:afterAffixes,rulesVersion:EQUIPMENT_RECOVERY_VERSION};
   if(mode!=='reforge')extra.push(...activityEventStatements(db,{accountId:account,charId,realmId:realm(env),events:[{sourceId:'recovery:'+charId+':'+b.requestId,kind:mode==='archive'?'collection':'reclaim',quantity:ids.length,mapId:null,buildId:null,occurredAt:now}]},now));
   ledger.push({event_id:'recovery:'+account+':'+b.requestId+':materials',tg_id:charId,type:'精煉材料收支',gold_delta:-q.cost.gold,item:'recovery_dust',item_delta:q.dust-q.cost.dust,note:JSON.stringify(result)});
   extra.push(...ledgerBatchStmts(db,ledger,now),db.prepare('INSERT INTO rpg_equipment_recovery_operations(account_id,request_id,char_id,realm_id,kind,signature,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(account,b.requestId,charId,realm(env),mode,signature,JSON.stringify(result),now));
   return {extra};
  });
 }catch(error){
  const saved=await replay();if(saved)return {...await view(env,charId,now),result:saved,replayed:true};
  throw classifyDbError(error)||error;
 }
 return {...await view(env,charId,now),result};
}
