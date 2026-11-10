import {GameError} from '../game/classes.js';
import {equipmentCollectionCatalog,equipmentCollectionBonuses,equipmentCollectionText,matchesCollectionRequirement,EQUIPMENT_COLLECTION_VERSION} from '../game/equipment-collection.js';
import {loadPlayer,guardStmt,classifyDbError} from '../db.js';
import {withPlayer} from './player.js';
import {computeStats} from '../game/stats.js';
import {gearIconSrc} from '../game/share.js';
import {activityEventStatements} from './atlas-quests.js';
import {attachShopOffers,offersFor} from './gearbook-shop.js';

const enabled=env=>String(env.EQUIPMENT_COLLECTION_ENABLED)==='true';
const fail=(message,code='equipment_collection',status=409)=>{throw new GameError(code,message,status);};
const owner=p=>p.char.account_tg_id||p.char.tg_id;
const projection=s=>({atk:s.atk,def:s.def,maxHp:s.maxHp,maxMp:s.maxMp,critBonus:s.pct.critPct});
export async function equipmentCollectionToken(item){const bytes=new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]]))));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function rows(db,id){return (await db.prepare('SELECT * FROM rpg_equipment_collection_entries WHERE char_id=? ORDER BY created_at,collection_id,requirement_id').bind(id).all()).results;}
function activityReason(char){return char.atlas_run_id?'星圖派遣結束後才能收錄':char.party_id?'組隊或遠征結束後才能收錄':null;}
function itemReason(e,locked){return e.is_equipped?'穿戴中，請先卸下':e.trade_id?'交易或交易所保管中':locked.has(e.id)?'自動強化或洗屬性進行中':null;}
export async function view(env,charId,now){
 if(!enabled(env))return {ok:true,enabled:false,realmId:env.REALM_CONTEXT?.id||'permanent',characterId:charId,now};
 const p=await loadPlayer(env.DB,charId,env);if(!p)fail('請先選擇角色','no_character',404);
 if(!Object.hasOwn(p.char,'equipment_collection_json'))fail('裝備收藏資料尚未準備完成','equipment_collection_unavailable',503);
 const [entries,locks]=await Promise.all([rows(env.DB,charId),env.DB.prepare("SELECT item_id FROM rpg_auto_enhance WHERE tg_id=? AND status IN ('running','processing') UNION SELECT item_id FROM rpg_auto_reroll WHERE tg_id=? AND status IN ('running','processing')").bind(charId,charId).all()]);
 const locked=new Set(locks.results.map(r=>r.item_id)),filled=new Map(entries.map(r=>[r.collection_id+':'+r.requirement_id,r])),completed=JSON.parse(p.char.equipment_collection_json),catalog=equipmentCollectionCatalog(p.char.base_class);
 const collections=catalog.map(c=>({...c,levelLocked:p.char.level<c.minLevel,completed:completed.includes(c.id),filled:c.requirements.filter(r=>filled.has(c.id+':'+r.id)).length,requirements:c.requirements.map(r=>{
  const entry=filled.get(c.id+':'+r.id),snapshot=entry?JSON.parse(entry.snapshot_json):null;
  const mock={slot:r.slot,tier:r.tier,class_req:r.baseClass,kind:r.kind,name:r.name};
  return {...r,icon:gearIconSrc(mock),registered:snapshot?{name:snapshot.name,enhance:snapshot.enhance_level,icon:gearIconSrc(snapshot),registeredAt:entry.created_at}:null,candidates:entry?[]:p.equipment.filter(e=>matchesCollectionRequirement(e,r)).map(e=>({id:e.id,name:e.name,enhance:e.enhance_level,rarity:e.element_tier,icon:gearIconSrc(e),blockedReason:itemReason(e,locked)}))};})}));
 const bonuses=equipmentCollectionBonuses(p.char),current=computeStats(p.char,p.equipment);
 const shopWallet=await offersFor(env,p,now);
 const shopCollections=attachShopOffers({collections},p.char,shopWallet);
 return {ok:true,enabled:true,rulesVersion:EQUIPMENT_COLLECTION_VERSION,balanceStatus:'prototype',realmId:env.REALM_CONTEXT?.id||'permanent',characterId:charId,characterName:p.char.name,baseClass:p.char.base_class,level:p.char.level,scope:'character',consumesEquipment:true,lockedReason:activityReason(p.char),collections:shopCollections,completedCount:completed.length,totalCount:catalog.length,bonuses,bonusText:equipmentCollectionText(bonuses),stats:projection(current),shop:{gold:shopWallet.gold,dust:shopWallet.dust,lockedReason:shopWallet.lockedReason},now};
}
export async function preview(env,charId,b,now){
 if(!enabled(env))fail('裝備收藏尚未開放','equipment_collection_unavailable',503);
 const p=await loadPlayer(env.DB,charId,env);if(!p)fail('請先選擇角色','no_character',404);
 if(!Object.hasOwn(p.char,'equipment_collection_json'))fail('裝備收藏資料尚未準備完成','equipment_collection_unavailable',503);
 const c=equipmentCollectionCatalog(p.char.base_class).find(c=>c.id===b.collectionId),r=c?.requirements.find(r=>r.id===b.requirementId),item=p.equipment.find(e=>e.id===b.itemId);
 if(!r||!matchesCollectionRequirement(item,r))fail('這件裝備不符合收藏名稱、品質或強化門檻');
 const entries=await rows(env.DB,charId);if(entries.some(e=>e.collection_id===c.id&&e.requirement_id===r.id))fail('此收藏欄位已填入');
 const completes=entries.filter(e=>e.collection_id===c.id).length===c.requirements.length-1;
 const ids=JSON.parse(p.char.equipment_collection_json),before=computeStats(p.char,p.equipment),after=computeStats({...p.char,equipment_collection_json:JSON.stringify(completes?[...new Set([...ids,c.id])]:ids)},p.equipment);
 return {ok:true,realmId:env.REALM_CONTEXT?.id||'permanent',characterId:charId,collectionId:c.id,requirementId:r.id,itemId:item.id,token:await equipmentCollectionToken(item),item:{name:item.name,enhance:item.enhance_level,icon:gearIconSrc(item)},collectionName:c.name,completesCollection:completes,rewardText:c.rewardText,comparison:{before:projection(before),after:projection(after)},warning:'收錄會永久消耗這件裝備，無法取回。只有填滿整列後才獲得永久能力。',now};
}
export async function submit(env,charId,b,now){
 if(!/^[A-Za-z0-9_:-]{6,96}$/.test(b.requestId||''))fail('需要有效操作編號','request',400);
 const p=await loadPlayer(env.DB,charId,env);if(!p)fail('請先選擇角色','no_character',404);
 if(enabled(env)&&!Object.hasOwn(p.char,'equipment_collection_json'))fail('裝備收藏資料尚未準備完成','equipment_collection_unavailable',503);
 const db=env.DB,account=owner(p),signature=JSON.stringify({charId,collectionId:b.collectionId,requirementId:b.requirementId,itemId:b.itemId,token:b.token});
 async function replay(){const row=await db.prepare('SELECT * FROM rpg_equipment_collection_operations WHERE account_id=? AND request_id=?').bind(account,b.requestId).first();if(!row)return null;if(row.signature!==signature)fail('操作編號已用於其他收藏','request_reused');return JSON.parse(row.result_json);}
 // Feature disabled on an old schema must not query tables that are not there.
 if(!enabled(env)){
  if(!Object.hasOwn(p.char,'equipment_collection_json'))fail('裝備收藏尚未開放','equipment_collection_unavailable',503);
  const old=await replay();if(old)return {ok:true,enabled:false,result:old,characterId:charId,realmId:env.REALM_CONTEXT?.id||'permanent',now};
  fail('裝備收藏尚未開放','equipment_collection_unavailable',503);
 }
 const previous=await replay();if(previous)return {...await view(env,charId,now),result:previous,replayed:true};
 if(env.REALM_CONTEXT?.phase&&env.REALM_CONTEXT.phase!=='ACTIVE'||env.REALM_CONTEXT?.cutoffAt!=null&&now>=env.REALM_CONTEXT.cutoffAt)fail('此環境已停止新的收藏操作','realm_closed');
 let result;
 try{await withPlayer(env,charId,now,async(work,ctx)=>{
  if(work.char.active_char_id&&String(work.char.active_char_id)!==String(charId))fail('角色已切換','character_changed');
  const reason=activityReason(work.char);if(reason)fail(reason);
  const c=equipmentCollectionCatalog(work.char.base_class).find(c=>c.id===b.collectionId),r=c?.requirements.find(r=>r.id===b.requirementId),item=work.equipment.find(e=>e.id===b.itemId);
  if(!r||!matchesCollectionRequirement(item,r))fail('裝備不符合收藏需求');
  if(work.char.level<c.minLevel)fail(`需要 Lv.${c.minLevel} 才能收錄`);
  const blocked=itemReason(item,new Set(ctx.lockedEquipment));if(blocked)fail(blocked);
  if(!/^[a-f0-9]{64}$/.test(b.token||'')||await equipmentCollectionToken(item)!==b.token)fail('裝備狀態已更新，請重新確認名稱與強化值','equipment_changed');
  const entries=await rows(ctx.db,charId);if(entries.some(e=>e.collection_id===c.id&&e.requirement_id===r.id))fail('此收藏欄位已填入');
  const completes=entries.filter(e=>e.collection_id===c.id).length===c.requirements.length-1,completedIds=JSON.parse(work.char.equipment_collection_json);
  result={collectionId:c.id,requirementId:r.id,itemId:item.id,name:item.name,enhance:item.enhance_level,completed:completes,rewardText:completes?c.rewardText:null};
  // A fresh SQL check covers changes made after the JS read, including trade
  // escrow and background jobs. The entire batch rolls back on any failure.
  const fields=Object.keys(item);
  const deletion=ctx.db.prepare(`DELETE FROM rpg_equipment WHERE id=? AND tg_id=? AND is_equipped=0 AND trade_id IS NULL AND ${fields.map(k=>`"${k}" IS ?`).join(' AND ')} AND NOT EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=? AND status IN ('running','processing')) AND NOT EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=? AND status IN ('running','processing'))`).bind(item.id,charId,...fields.map(k=>item[k]),item.id,item.id);
  const extra=[ctx.db.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT EXISTS(SELECT 1 FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=? AND COALESCE(a.active_char_id,c.tg_id)=c.tg_id AND c.party_id IS NULL AND c.atlas_run_id IS NULL AND c.level>=? AND NOT EXISTS(SELECT 1 FROM rpg_party_presence WHERE char_id=c.tg_id))').bind(charId,c.minLevel),ctx.db.prepare('INSERT INTO rpg_equipment_collection_entries(char_id,collection_id,requirement_id,item_id,snapshot_json,created_at) VALUES(?,?,?,?,?,?)').bind(charId,c.id,r.id,item.id,JSON.stringify(item),now),deletion,guardStmt(ctx.db)];
  if(completes){extra.push(ctx.db.prepare('INSERT INTO rpg_equipment_collection_completions(char_id,collection_id,rules_version,bonuses_json,completed_at) VALUES(?,?,?,?,?)').bind(charId,c.id,EQUIPMENT_COLLECTION_VERSION,JSON.stringify(c.bonuses),now),ctx.db.prepare('UPDATE rpg_characters SET equipment_collection_json=? WHERE tg_id=?').bind(JSON.stringify([...new Set([...completedIds,c.id])].sort()),charId),guardStmt(ctx.db));}
  if(String(env.ATLAS_ENABLED)==='true')extra.push(...activityEventStatements(ctx.db,{accountId:account,charId,realmId:env.REALM_CONTEXT?.id||'permanent',events:[{sourceId:'gearbook:'+charId+':'+b.requestId,kind:'collection',quantity:1,mapId:null,buildId:null,occurredAt:now}]},now));
  extra.push(ctx.db.prepare('INSERT INTO rpg_equipment_collection_operations(account_id,request_id,signature,result_json,created_at) VALUES(?,?,?,?,?)').bind(account,b.requestId,signature,JSON.stringify(result),now));
  return {extra,ledger:[{event_id:`gearbook:${account}:${b.requestId}`,tg_id:charId,type:'裝備收藏收錄',item:item.id,item_delta:-1,note:JSON.stringify(result)},...(completes?[{event_id:`gearbook:complete:${charId}:${c.id}`,tg_id:charId,type:'裝備收藏完成',note:JSON.stringify({collectionId:c.id,bonuses:c.bonuses})}]:[])]};
 });}catch(error){const committed=await replay();if(committed)return {...await view(env,charId,now),result:committed,replayed:true};throw classifyDbError(error)||error;}
 return {...await view(env,charId,now),result};
}
