/* SELECT-only eligible backpack candidates for original person-to-person trades.
 * Original Trade.addLine remains the sole escrow/write authority. Cursor is
 * scoped to account, realm, character, context epoch, trade row+offer revision
 * and filter; candidates are never a permission or a reservation. */
import { GameError } from '../game/classes.js';
import { TRADE, ITEMS } from '../game/constants.js';
import { tradeBlock } from '../game/gear.js';
import { isTradeableItem } from '../game/trade.js';
import { sigilView } from './guardian-sigil.js';
import { runningRingId, canManageBackpackInParty } from './party-presence.js';

const PAGE_SIZE=30;
const KINDS=new Set(['all','equip','item','guardian']);
const fail=(code,message,status=400)=>{throw new GameError(code,message,status);};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const checked=value=>typeof value==='string'&&value.length>=1&&value.length<=128&&!/[\u0000-\u001f]/.test(value);
const actorKey=value=>JSON.stringify([String(value.tg_id),String(value.account_tg_id||value.tg_id),value.active_char_id==null?null:String(value.active_char_id),value.rev]);
const tradeKey=value=>JSON.stringify([value.id,value.a_tg,value.b_tg,value.status,value.rev,value.offer_rev,value.a_lock,value.b_lock,value.expires_at]);
const key=(context,trade,kind)=>[
  context.accountId,context.realmId,context.characterId,context.contextEpoch,
  trade.id,trade.rev,trade.offer_rev,kind
];
function encode(parts){
  const bytes=new TextEncoder().encode(JSON.stringify(parts));
  return 'dt1.'+btoa(String.fromCharCode(...bytes))
    .replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function decode(cursor,expected){
  if(cursor===undefined||cursor===null||cursor==='')return null;
  if(typeof cursor!=='string'||cursor.length>1600||!/^dt1\.[A-Za-z0-9_-]+$/.test(cursor))
    fail('trade_eligible_cursor','物品清單已變更，請從第一頁重新選擇',409);
  let parts;
  try{
    const binary=atob(cursor.slice(4).replaceAll('-','+').replaceAll('_','/'));
    parts=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0))));
  }catch{fail('trade_eligible_cursor','物品游標無法驗證，請重新選擇',409);}
  if(!Array.isArray(parts)||parts.length!==expected.length+2||
      expected.some((entry,i)=>parts[i]!==entry)||
      !['equip','guardian','item'].includes(parts[expected.length])||
      !checked(parts[expected.length+1]))
    fail('trade_eligible_cursor','物品清單與現在角色、交易版本或篩選不符',409);
  return {kind:parts[expected.length],ref:parts[expected.length+1]};
}
async function actor(db,id){
  return db.prepare('SELECT c.tg_id,c.account_tg_id,c.rev,a.active_char_id FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(id).first();
}
async function tradeOf(db,id){
  return db.prepare('SELECT id,a_tg,b_tg,status,rev,offer_rev,a_lock,b_lock,expires_at FROM rpg_trades WHERE id=?').bind(id).first();
}
async function allowSigils(db,trade,id){
  const rows=(await db.prepare('SELECT tg_id,level,party_id FROM rpg_live_characters WHERE tg_id IN (?,?)').bind(trade.a_tg,trade.b_tg).all()).results||[];
  if(rows.length!==2||rows.some(x=>!Number.isSafeInteger(x.level)||x.level<15))return false;
  for(const char of rows){
    if(!canManageBackpackInParty(char,char.party_id?await runningRingId(db,char.tg_id):null))return false;
  }
  return true;
}
async function listRaw(db,id,kind,cursor,guardianAllowed){
  // Keep all sorts and SQL identifiers fixed: the user supplies no SQL.
  const sql=[
    "SELECT kind,ref,qty FROM (",
    " SELECT 'equip' AS kind,e.id AS ref,1 AS qty FROM rpg_equipment e WHERE e.tg_id=? AND e.is_equipped=0 AND e.bound=0 AND e.trade_id IS NULL AND e.source<>'starter'",
    " AND NOT EXISTS(SELECT 1 FROM rpg_auto_enhance a WHERE a.item_id=e.id AND a.status IN ('running','processing'))",
    " AND NOT EXISTS(SELECT 1 FROM rpg_auto_reroll r WHERE r.item_id=e.id AND r.status IN ('running','processing'))",
    " UNION ALL SELECT 'guardian' AS kind,g.id AS ref,1 AS qty FROM rpg_guardian_sigils g",
    " WHERE g.char_id=? AND g.bound=0 AND g.active=0 AND g.locked=0 AND g.trade_id IS NULL AND g.exchange_id IS NULL",
    " UNION ALL SELECT 'item' AS kind,i.item AS ref,i.quantity AS qty FROM rpg_inventory i WHERE i.tg_id=? AND i.quantity>0",
    ")",
    "WHERE (?='all' OR kind=?) AND ( ? IS NULL OR kind>? OR (kind=? AND ref>?) )",
    "ORDER BY kind,ref LIMIT 31"
  ].join(' ');
  const rows=(await db.prepare(sql).bind(
    id,guardianAllowed?id:'__guardian_disabled__',id,kind,kind,
    cursor?.kind??null,cursor?.kind??'',cursor?.kind??'',cursor?.ref??''
  ).all()).results||[];
  return rows;
}
export async function eligible(env,tg,input={},now=Date.now()){
  const allowed=['accountId','realmId','selectedCharacterId','contextEpoch','tradeId','kind','cursor','tgId'];
  if(!plain(input)||Object.keys(input).some(k=>!allowed.includes(k)))
    fail('trade_eligible_input','可交易物品查詢參數無效');
  if(!integer(input.contextEpoch)||!integer(now))fail('trade_context','交易畫面已變更，請重新開啟');
  const id=String(tg),realmId=env.REALM_CONTEXT?.id||'permanent',db=env.DB;
  if(!checked(input.accountId)||!checked(input.realmId)||!checked(input.selectedCharacterId)||!checked(input.tradeId))
    fail('trade_eligible_input','請先選定帳號、世界、角色與交易視窗');
  if(input.realmId!==realmId)fail('realm_mismatch','世界已變更，請重新開啟',409);
  if(input.selectedCharacterId!==id)fail('character_changed','已切換角色，請重新開啟',409);
  const kind=input.kind??'all';
  if(!KINDS.has(kind))fail('trade_eligible_kind','物品分類無效');
  const before=await actor(db,id);
  if(!before)fail('no_character','找不到角色',404);
  const accountId=String(before.account_tg_id||id);
  if(input.accountId!==accountId)fail('account_changed','帳號已變更，請重新開啟',409);
  if(before.active_char_id!=null&&String(before.active_char_id)!==id)
    fail('character_changed','已在其他視窗切換角色',409);
  if(!integer(before.rev))fail('trade_eligible_data','角色版本無效',500);
  const trade=await tradeOf(db,input.tradeId);
  if(!trade)fail('not_found','找不到交易',404);
  if(trade.a_tg!==id&&trade.b_tg!==id)fail('not_party','無權查詢這筆交易的背包',403);
  const side=trade.a_tg===id?'a':'b',isExpired=trade.status==='open'&&trade.expires_at<=now;
  const canAdd=trade.status==='open'&&!isExpired&&!trade[side+'_lock'];
  const context={accountId,realmId,characterId:id,contextEpoch:input.contextEpoch};
  const prefix=key(context,trade,kind),cursor=decode(input.cursor,prefix);
  const rows=canAdd?await listRaw(db,id,kind,cursor,await allowSigils(db,trade,id)):[];
  const page=rows.slice(0,PAGE_SIZE);
  const items=[];
  for(const item of page){
    if(item.kind==='item'){
      if(!isTradeableItem(item.ref)||!ITEMS[item.ref]||!integer(item.qty)||item.qty===0)continue;
      items.push({kind:'item',ref:item.ref,qty:item.qty,name:ITEMS[item.ref].name||item.ref});
    }else if(item.kind==='equip'){
      const e=await db.prepare('SELECT * FROM rpg_equipment WHERE id=? AND tg_id=?').bind(item.ref,id).first();
      if(!e||e.source==='starter'||tradeBlock(e))continue;
      items.push({kind:'equip',ref:e.id,qty:1,name:e.name||e.id,slot:e.slot||null,tier:e.tier||null,
        enhance:Number(e.enhance_level)||0});
    }else if(item.kind==='guardian'){
      const g=await db.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=? AND char_id=?').bind(item.ref,id).first();
      if(!g||g.bound||g.active||g.locked||g.trade_id||g.exchange_id)continue;
      const v=sigilView(g);
      items.push({kind:'guardian',ref:g.id,qty:1,name:(v.qualityName||'')+' '+(v.typeName||'守護羽毛'),
        quality:v.quality,rank:v.rank});
    }
  }
  const after=await actor(db,id),afterTrade=await tradeOf(db,input.tradeId);
  if(!after||!afterTrade||actorKey(after)!==actorKey(before)||tradeKey(afterTrade)!==tradeKey(trade))
    fail('trade_changed','背包或交易已變更，請重新讀取',409);
  const nextCursor=rows.length>PAGE_SIZE?encode([...prefix,page.at(-1).kind,page.at(-1).ref]):null;
  return {ok:true,schemaVersion:1,accountId,realmId,characterId:id,contextEpoch:input.contextEpoch,
    tradeId:trade.id,offerRev:trade.offer_rev,revision:before.rev,tradeRevision:trade.rev,
    serverNow:now,pureRead:true,kind,pageSize:PAGE_SIZE,side,canAdd,isExpired,items,nextCursor};
}
