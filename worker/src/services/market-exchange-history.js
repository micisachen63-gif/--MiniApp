// Read only: one character's committed exchange ledger, using the existing owner index.
import { GameError } from '../game/classes.js';
import { ITEMS, RARITIES } from '../game/constants.js';
import { SKILL_MAP, baseOf } from '../game/special.js';
import { QUALITY_ORDER, QUALITY_NAMES, TYPE_NAMES, TYPE_ABILITIES } from '../game/guardian-sigil-config.js';
import { equipmentView } from '../views.js';

const PAGE_SIZE=30;
const fail=(code,message,status=400)=>{throw new GameError(code,message,status);};
const text=(value,fallback='')=>typeof value==='string'?value.slice(0,180):fallback;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function cursorOf(value) {
  if(value==null||value==='')return null;
  if(typeof value!=='string'||!/^\d{1,16}:\d{1,16}$/.test(value))fail('history_cursor','成交紀錄頁碼已失效，請重新更新');
  const [time,id]=value.split(':').map(Number);
  if(!Number.isSafeInteger(time)||time<0||!Number.isSafeInteger(id)||id<1)fail('history_cursor','成交紀錄頁碼已失效，請重新更新');
  return {time,id};
}
function snapshotItem(row,char) {
  const fallback={kind:row.kind,category:row.category,name:'珍藏道具',quality:row.quality,qualityName:RARITIES[row.quality]?.name||null,tier:row.tier,enhance:row.enhance,classReq:row.class_req,item:row.kind==='item'?row.ref:null,art:null,equipment:null,guardian:null,snapshotAvailable:false};
  try {
    const raw=JSON.parse(row.snapshot_json);
    if(!object(raw))return fallback;
    if(row.kind==='equip') {
      if(raw.id!==row.ref||typeof raw.name!=='string')return fallback;
      const view=equipmentView(char,raw),equipment={};
      // Keep presentation fields only; an old receipt never carries live mutation affordances.
      for(const key of ['id','slot','slotName','name','tier','rarity','rarityName','grade','gradeName','element','elementName','kind','classReq','className','type','enhance','branchReq','levelReq','art'])equipment[key]=view[key]??null;
      // Shared DEF depends on the wearer; record the stored base values instead of
      // silently recalculating a historical sale for the character's current class.
      equipment.stat=Number(raw.base_stat)||0;equipment.statName='基礎 '+view.statName;
      equipment.elemStat=Number(raw.element_stat)||0;equipment.elementName=view.elementName?'基礎 '+view.elementName:null;
      equipment.affixes={lines:(view.affixes?.lines||[]).map(line=>({name:text(line.name),value:Number(line.value)||0,quality:text(line.quality)}))};
      return {...fallback,name:text(raw.name,'珍藏裝備'),quality:view.rarity,qualityName:view.rarityName||null,tier:raw.tier,enhance:raw.enhance_level,equipment,art:view.art,snapshotAvailable:true};
    }
    if(row.kind==='guardian') {
      if(raw.id!==row.ref||!Object.hasOwn(TYPE_NAMES,raw.type)||!Number.isInteger(raw.quality)||raw.quality<1||raw.quality>8)return fallback;
      const guardian={type:raw.type,typeName:TYPE_NAMES[raw.type],ability:TYPE_ABILITIES[raw.type],rank:raw.quality,quality:QUALITY_ORDER[raw.quality-1],qualityName:QUALITY_NAMES[raw.quality-1]};
      // The immutable listing records type/rank, not the future configurable bonus table.
      return {...fallback,name:guardian.qualityName+'・'+guardian.typeName,quality:guardian.quality,qualityName:guardian.qualityName,tier:null,enhance:null,art:`/art/guardian-sigil-20261013/${raw.type}.webp`,guardian,snapshotAvailable:true};
    }
    if(raw.item!==row.ref||!Object.hasOwn(ITEMS,row.ref))return fallback;
    const data=ITEMS[row.ref],skill=data.skillId?SKILL_MAP[data.skillId]:null;
    return {...fallback,name:data.name,emoji:data.emoji,desc:data.desc||null,quality:skill?.rarity||null,qualityName:skill?.rarity||null,tier:null,enhance:null,classReq:skill?baseOf(skill):'any',advancementTier:skill?.advancementTier||null,requiredLevel:skill?.level||null,eligibleJob:skill?.eligibleJob||null,snapshotAvailable:true};
  } catch {return fallback;}
}

export async function history(env,tg,input={}) {
  if(!object(input))fail('history_filters','成交紀錄篩選格式無效');
  const role=input.role??'all';
  if(!['all','buy','sell'].includes(role))fail('history_filters','請選擇買入或賣出紀錄');
  const cursor=cursorOf(input.cursor),id=String(tg),db=env.DB;
  const char=await db.prepare('SELECT c.*,a.active_char_id FROM rpg_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(id).first();
  if(!char)fail('no_character','請先建立角色',404);
  if(input.characterId!=null&&String(input.characterId)!==id||char.active_char_id&&String(char.active_char_id)!==id)fail('character_changed','角色已在另一個視窗切換，請重新選角',409);
  const types=role==='buy'?['交易所購買']:role==='sell'?['交易所售出入帳']:['交易所購買','交易所售出入帳'];
  const args=[id,...types,id,id,String(char.account_tg_id||id)];
  // rowid is the owner index's implicit last key: timestamp/id handles same-ms sales
  // without OFFSET, and the UNIQUE listing lookup never scans other players' listings.
  const sql=`SELECT g.id AS ledger_id,g.event_id,g.type AS ledger_type,g.gold_delta,g.created_at AS settled_at,l.*,other.name AS other_name
    FROM rpg_ledger g INDEXED BY idx_rpg_ledger_owner
    JOIN rpg_exchange_listings l ON l.id=substr(g.event_id,10,36)
    LEFT JOIN rpg_characters other ON other.tg_id=CASE WHEN g.type='交易所購買' THEN l.seller_char ELSE l.buyer_char END
    WHERE g.tg_id=? AND g.type IN (${types.map(()=>'?').join(',')}) AND l.status='sold'
      AND ((g.type='交易所購買' AND l.buyer_char=? AND g.event_id='exchange:'||l.id||':buy')
        OR (g.type='交易所售出入帳' AND l.seller_char=? AND l.seller_account=? AND g.event_id='exchange:'||l.id||':payout'))
      ${cursor?'AND g.created_at<=? AND (g.created_at<? OR g.id<?)':''}
    ORDER BY g.created_at DESC,g.id DESC LIMIT ${PAGE_SIZE+1}`;
  if(cursor)args.push(cursor.time,cursor.time,cursor.id);
  const rows=(await db.prepare(sql).bind(...args).all()).results||[],page=rows.slice(0,PAGE_SIZE);
  const items=page.map(row=>{
    const selling=row.ledger_type==='交易所售出入帳';
    return {id:row.event_id,listingId:row.id,role:selling?'sell':'buy',settledAt:row.settled_at,qty:row.qty,price:row.price,
      goldDelta:row.gold_delta,...(selling?{fee:row.fee,netGold:row.gold_delta}:{paidGold:-row.gold_delta,feePaidBy:'seller'}),
      counterparty:{name:text(row.other_name,'旅者')},snapshotSource:'listing',item:snapshotItem(row,char)};
  });
  const last=page.at(-1);
  return {ok:true,characterId:id,items,pageSize:PAGE_SIZE,role,nextCursor:rows.length>PAGE_SIZE&&last?`${last.settled_at}:${last.ledger_id}`:null};
}
