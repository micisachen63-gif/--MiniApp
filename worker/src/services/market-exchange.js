// No timer or external service: indexed reads, escrow and settlement in one D1 batch.
import { ITEMS, CLASSES, RARITIES, TRADE } from '../game/constants.js';
import { SKILL_MAP, baseOf } from '../game/special.js';
import { GameError } from '../game/classes.js';
import { checkEquipLine } from '../game/trade.js';
import { equipmentView } from '../views.js';
import { classifyDbError, guardStmt, invDeltaStmt, ledgerStmt } from '../db.js';
import { sigilView } from './guardian-sigil.js';
import { guardianEffect } from '../game/guardian-effects.js';
import { QUALITY_ORDER, QUALITY_NAMES, TYPE_NAMES } from '../game/guardian-sigil-config.js';

// This exception is local to the exchange: completed collection badges and the
// original person-to-person trade rules remain bound and unchanged.
const COLLECTION_ITEMS = Object.freeze(Object.keys(ITEMS).filter(key => /^hunt_(?:[1-9]|1[0-2])_(?:1|2|3|sigil|core)$/.test(key)));
const EXCHANGE_ITEMS = Object.freeze([...new Set([...TRADE.tradeableItems,...COLLECTION_ITEMS])]);
export const EXCHANGE = Object.freeze({ taxPct:.05,maxPrice:TRADE.maxGold,maxActive:20,pageSize:30,maxQty:99999,collectionTradeable:true });
const CATEGORY = ['all','equipment','scroll','collection','skillbook','other','guardian'];
const BOOK_QUALITIES = ['普通','高級','稀有','神話'];
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const escrow = id => 'exchange:' + id;
const feeFor = price => Math.ceil(price / 20);
const fail = (code,message,status=400) => { throw new GameError(code,message,status); };
function integer(value,min,max,code,message) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(code,message);
  return value;
}
function identifier(value) {
  if(typeof value!=='string'||!value.length||value.length>128||/[\u0000-\u001f]/.test(value))fail('selection','請選擇有效的道具');
  return value;
}
function requestId(value) {
  if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))fail('request','需要有效的操作編號');
  return value.toLowerCase();
}
async function actor(db,tg) {
  const row=await db.prepare('SELECT c.*,a.active_char_id FROM rpg_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(String(tg)).first();
  if(!row)fail('no_character','請先建立角色',404);
  return row;
}
function bodyObject(value) {
  if(!value || typeof value!=='object' || Array.isArray(value))fail('selection','操作格式無效');
  return value;
}
function expectedActor(c,b) {
  const id=identifier(b.characterId);
  if(id!==String(c.tg_id))fail('character_changed','角色已在另一個視窗切換，請重新選角',409);
  return id;
}
function exchangeItem(key) {
  if(!ITEMS[key])fail('item','沒有這個道具');
  if(!EXCHANGE_ITEMS.includes(key))fail('untradeable',`「${ITEMS[key].name}」不能上架交易所`);
}
const ownerOf = c => String(c.account_tg_id||c.tg_id);
const balance = c => ({characterId:String(c.tg_id),gold:c.gold,revision:c.rev});
async function response(db,c,result) { return {ok:true,result,balance:balance(await actor(db,c.tg_id))}; }
const GUARDIAN_CLASSES=Object.freeze({melee:'sword',ranged:'archer',magic:'mage',loot:'any'});
const meta = () => ({...EXCHANGE,categories:CATEGORY,qualities:Object.fromEntries([...Object.entries(RARITIES).map(([k,v])=>[k,v.name]),...BOOK_QUALITIES.map(x=>[x,x]),...QUALITY_ORDER.map((q,i)=>[q,QUALITY_NAMES[i]])]),guardianQualities:Object.fromEntries(QUALITY_ORDER.map((q,i)=>[q,QUALITY_NAMES[i]])),guardianTypes:TYPE_NAMES});
function itemInfo(item) {
  const data=ITEMS[item]; if(!data)return null;
  const skill=data.skillId?SKILL_MAP[data.skillId]:null;
  const collection=COLLECTION_ITEMS.includes(item);
  return {kind:'item',equipId:null,item,name:data.name,emoji:data.emoji||'✦',desc:collection?'用於地圖收藏製作；可在交易所買賣，完成的魔法徽記仍永久綁定角色。':data.desc||null,art:null,equipment:null,
    category:data.kind==='scroll'?'scroll':data.kind==='skill_book'?'skillbook':/^(?:hunt_|collection_)/.test(item)?'collection':'other',
    classReq:skill?baseOf(skill):'any',tier:null,itemTier:skill?null:(data.tier??null),mapId:collection?data.tier:null,quality:skill?.rarity??null,qualityName:skill?.rarity??null,enhance:null,
    advancementTier:skill?.advancementTier??null,requiredLevel:skill?.level??null,eligibleJob:skill?.eligibleJob??null};
}
function equipmentInfo(c,e) {
  return {kind:'equip',equipId:e.id,item:null,name:e.name,emoji:'⚔️',desc:null,art:equipmentView(c,e).art,equipment:equipmentView(c,e),
    category:'equipment',classReq:e.class_req,tier:e.tier,quality:e.element_tier,qualityName:RARITIES[e.element_tier]?.name||e.element_tier,enhance:e.enhance_level};
}
function guardianInfo(env,row) {
  const guardian={...sigilView(row),...guardianEffect(row,env)};
  return {kind:'guardian',guardianId:row.id,equipId:null,item:null,equipment:null,guardian,
    name:guardian.qualityName+'・'+guardian.typeName,emoji:'✦',desc:`${guardian.ability} +${Math.round((guardian.damageBonus||guardian.lootBonus)*100)}%`,art:guardian.artUrl,
    category:'guardian',classReq:GUARDIAN_CLASSES[row.type],tier:null,quality:guardian.quality,qualityName:guardian.qualityName,enhance:null};
}
function checkGuardian(row,c) {
  if(!row||row.char_id!==String(c.tg_id))fail('not_found','找不到你的守護天使',404);
  if(c.level<15)fail('guardian_level','守護天使交易須達15級',403);
  if(row.bound||row.active||row.locked||row.trade_id||row.exchange_id)fail('protected','請先解除天使的啟用、綁定、鎖定或交易保管',409);
}
function listingView(row,c,env={}) {
  const snapshot=JSON.parse(row.snapshot_json);
  const info=row.kind==='equip'?equipmentInfo(c,{...snapshot,tg_id:row.seller_char,trade_id:row.status==='active'?escrow(row.id):null}):row.kind==='guardian'?guardianInfo(env,{...snapshot,exchange_id:row.status==='active'?row.id:null}):itemInfo(row.ref);
  return {...info,id:row.id,qty:row.qty,price:row.price,fee:row.fee,netGold:row.price-row.fee,status:row.status,
    seller:{characterId:row.seller_char,name:row.seller_name||'旅人'},createdAt:row.created_at,updatedAt:row.updated_at,
    ownedByMe:row.seller_account===ownerOf(c),canBuy:row.status==='active'&&row.seller_account!==ownerOf(c)};
}
function normalizeFilters(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('filters','篩選格式無效');
  const f={category:input.category??'all',classReq:input.classReq??'all',tier:input.tier??null,quality:input.quality??'all',enhanceMin:input.enhanceMin??null,enhanceMax:input.enhanceMax??null};
  if(!CATEGORY.includes(f.category)||!['all','any',...Object.keys(CLASSES)].includes(f.classReq)||!['all',...Object.keys(RARITIES),...BOOK_QUALITIES,...QUALITY_ORDER].includes(f.quality))fail('filters','請選擇有效的篩選條件');
  if(f.tier!==null)integer(f.tier,1,12,'filters','T 數篩選無效');
  for(const key of ['enhanceMin','enhanceMax'])if(f[key]!==null)integer(f[key],0,15,'filters','強化值篩選無效');
  if(f.enhanceMin!==null&&f.enhanceMax!==null&&f.enhanceMin>f.enhanceMax)fail('filters','強化篩選的最低值不能高於最高值');
  return f;
}
const matchInfo=(info,f)=> (f.category==='all'||info.category===f.category)&&
  (f.classReq==='all'||info.classReq===f.classReq||(f.classReq!=='any'&&info.classReq==='any'))&&
  (f.tier===null||info.tier===f.tier)&&(f.quality==='all'||info.quality===f.quality)&&
  (f.enhanceMin===null||(info.enhance!==null&&info.enhance>=f.enhanceMin))&&
  (f.enhanceMax===null||(info.enhance!==null&&info.enhance<=f.enhanceMax));
function listingCursor(cursor) {
  if(cursor===undefined||cursor===null||cursor==='')return null;
  if(typeof cursor!=='string'||!/^\d{1,16}$/.test(cursor)||!Number.isSafeInteger(Number(cursor))||Number(cursor)<1)fail('cursor','分頁已失效，請重新整理');
  return Number(cursor);
}
function filterSQL(f,alias='l') {
  const parts=[],params=[];
  if(f.category!=='all'){parts.push(`${alias}.category=?`);params.push(f.category);}
  if(f.classReq!=='all'){parts.push(f.classReq==='any'?`${alias}.class_req=?`:`${alias}.class_req IN (?,'any')`);params.push(f.classReq);}
  if(f.tier!==null){parts.push(`${alias}.tier=?`);params.push(f.tier);}
  if(f.quality!=='all'){parts.push(`${alias}.quality=?`);params.push(f.quality);}
  if(f.enhanceMin!==null){parts.push(`${alias}.enhance>=?`);params.push(f.enhanceMin);}
  if(f.enhanceMax!==null){parts.push(`${alias}.enhance<=?`);params.push(f.enhanceMax);}
  return {parts,params};
}
export async function list(env,tg,b={}) {
  bodyObject(b);
  const c=await actor(env.DB,tg),filters=normalizeFilters(b.filters),cursor=listingCursor(b.cursor),q=filterSQL(filters);
  const where=["l.status='active'",...q.parts],params=[...q.params];
  if(cursor!==null){where.push('l.seq<?');params.push(cursor);}
  const rows=(await env.DB.prepare(`SELECT l.*,c.name seller_name FROM rpg_exchange_listings l LEFT JOIN rpg_characters c ON c.tg_id=l.seller_char WHERE ${where.join(' AND ')} ORDER BY l.seq DESC LIMIT 31`).bind(...params).all()).results||[];
  return {ok:true,items:rows.slice(0,30).map(r=>listingView(r,c,env)),nextCursor:rows.length>30?String(rows[29].seq):null,filters,meta:meta(),balance:balance(c)};
}
export async function mine(env,tg,b={}) {
  bodyObject(b);
  const c=await actor(env.DB,tg),cursor=listingCursor(b.cursor),params=[ownerOf(c)];
  if(cursor!==null)params.push(cursor);
  const rows=(await env.DB.prepare(`SELECT l.*,c.name seller_name FROM rpg_exchange_listings l LEFT JOIN rpg_characters c ON c.tg_id=l.seller_char WHERE l.seller_account=? ${cursor!==null?'AND l.seq<?':''} ORDER BY l.seq DESC LIMIT 31`).bind(...params).all()).results||[];
  return {ok:true,items:rows.slice(0,30).map(r=>listingView(r,c,env)),nextCursor:rows.length>30?String(rows[29].seq):null,meta:meta(),balance:balance(c)};
}
function candidateCursor(value) {
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string'||value.length>200)fail('cursor','分頁已失效，請重新整理');
  const at=value.indexOf(':');const kind=value.slice(0,at),ref=value.slice(at+1);
  if(!['equip','item','guardian'].includes(kind)||at<0)fail('cursor','分頁已失效，請重新整理');
  identifier(ref);return {kind,ref};
}
export async function sellable(env,tg,b={}) {
  bodyObject(b);
  const db=env.DB,c=await actor(db,tg),f=normalizeFilters(b.filters),cursor=candidateCursor(b.cursor);
  const itemKeys=EXCHANGE_ITEMS.filter(key=>matchInfo(itemInfo(key),f));
  // Equipment has no category column; that condition is handled before the union.
  const gearWhere=['e.tg_id=?','e.is_equipped=0','e.bound=0',"e.source<>'starter'",'e.trade_id IS NULL',"NOT EXISTS(SELECT 1 FROM rpg_auto_enhance a WHERE a.item_id=e.id AND a.status IN ('running','processing'))","NOT EXISTS(SELECT 1 FROM rpg_auto_reroll a WHERE a.item_id=e.id AND a.status IN ('running','processing'))"];
  const gearParams=[String(tg)];
  if(f.category!=='all'&&f.category!=='equipment')gearWhere.push('0');
  if(f.classReq!=='all'){gearWhere.push(f.classReq==='any'?'e.class_req=?':"e.class_req IN (?,'any')");gearParams.push(f.classReq);}
  if(f.tier!==null){gearWhere.push('e.tier=?');gearParams.push(f.tier);}
  if(f.quality!=='all'){gearWhere.push('e.element_tier=?');gearParams.push(f.quality);}
  if(f.enhanceMin!==null){gearWhere.push('e.enhance_level>=?');gearParams.push(f.enhanceMin);}
  if(f.enhanceMax!==null){gearWhere.push('e.enhance_level<=?');gearParams.push(f.enhanceMax);}
  const guardianWhere=['g.char_id=?','g.bound=0','g.active=0','g.locked=0','g.trade_id IS NULL','g.exchange_id IS NULL'],guardianParams=[String(tg)];
  if(c.level<15||c.party_id||(f.category!=='all'&&f.category!=='guardian')||f.tier!==null||f.enhanceMin!==null||f.enhanceMax!==null)guardianWhere.push('0');
  const guardianClass="CASE g.type WHEN 'melee' THEN 'sword' WHEN 'ranged' THEN 'archer' WHEN 'magic' THEN 'mage' ELSE 'any' END";
  if(f.classReq!=='all'){guardianWhere.push(f.classReq==='any'?`${guardianClass}=?`:`${guardianClass} IN (?,'any')`);guardianParams.push(f.classReq);}
  if(f.quality!=='all'){guardianWhere.push('g.quality=?');guardianParams.push(QUALITY_ORDER.indexOf(f.quality)+1);}
  const outer=cursor?'WHERE (kind>? OR (kind=? AND ref>?))':'';
  const rows=(await db.prepare(`SELECT * FROM (SELECT 'equip' kind,e.id ref,1 qty FROM rpg_equipment e WHERE ${gearWhere.join(' AND ')} UNION ALL SELECT 'guardian' kind,g.id ref,1 qty FROM rpg_guardian_sigils g WHERE ${guardianWhere.join(' AND ')} UNION ALL SELECT 'item' kind,item ref,quantity qty FROM rpg_inventory WHERE tg_id=? AND quantity>0 AND item IN (${itemKeys.length?itemKeys.map(literal).join(','):"''"})) ${outer} ORDER BY kind,ref LIMIT 31`).bind(...gearParams,...guardianParams,String(tg),...(cursor?[cursor.kind,cursor.kind,cursor.ref]:[])).all()).results||[];
  const page=rows.slice(0,30),ids=page.filter(r=>r.kind==='equip').map(r=>r.ref),guardianIds=page.filter(r=>r.kind==='guardian').map(r=>r.ref);
  const gear=ids.length?(await db.prepare(`SELECT * FROM rpg_equipment WHERE tg_id=? AND id IN (${ids.map(()=>'?').join(',')})`).bind(String(tg),...ids).all()).results||[]:[];
  const guardians=guardianIds.length?(await db.prepare(`SELECT * FROM rpg_guardian_sigils WHERE char_id=? AND id IN (${guardianIds.map(()=>'?').join(',')})`).bind(String(tg),...guardianIds).all()).results||[]:[];
  const byId=new Map(gear.map(e=>[e.id,e])),guardianById=new Map(guardians.map(g=>[g.id,g]));
  // The indexed candidate and detail reads can straddle another device's sale,
  // equip or trade. Omit vanished/newly locked gear instead of rendering undefined.
  const available=page.filter(r=>r.kind==='equip'?(()=>{const e=byId.get(r.ref);return e&&!e.is_equipped&&!e.bound&&!e.trade_id&&e.source!=='starter'&&matchInfo({category:'equipment',classReq:e.class_req,tier:e.tier,quality:e.element_tier,enhance:e.enhance_level},f);})():r.kind==='guardian'?(()=>{const g=guardianById.get(r.ref);return g&&!g.bound&&!g.active&&!g.locked&&!g.trade_id&&!g.exchange_id&&matchInfo(guardianInfo(env,g),f);})():true);
  return {ok:true,items:available.map(r=>({...r.kind==='equip'?equipmentInfo(c,byId.get(r.ref)):r.kind==='guardian'?guardianInfo(env,guardianById.get(r.ref)):itemInfo(r.ref),qty:r.qty})),nextCursor:rows.length>30?`${page[29].kind}:${page[29].ref}`:null,filters:f,meta:meta(),balance:balance(c)};
}
async function replay(db,c,id,action,payload) {
  const old=await db.prepare('SELECT * FROM rpg_exchange_operations WHERE account_tg_id=? AND request_id=?').bind(ownerOf(c),id).first();
  if(!old)return null;
  if(old.char_id!==String(c.tg_id)||old.action!==action||old.payload_json!==JSON.stringify(payload))fail('request_reused','這個操作編號已用於其他內容，請重新整理',409);
  return JSON.parse(old.result_json);
}
const receipt=(db,c,id,action,payload,result,now)=>db.prepare('INSERT INTO rpg_exchange_operations(account_tg_id,request_id,char_id,action,payload_json,result_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(ownerOf(c),id,String(c.tg_id),action,JSON.stringify(payload),JSON.stringify(result),now);
function revisionStmt(db,c,now,delta=0,{active=false,party=false}={}) {
  return db.prepare(`UPDATE rpg_characters SET gold=gold+?,rev=rev+1,updated_at=? WHERE tg_id=? AND rev=? AND gold+? BETWEEN 0 AND 9007199254740991 ${party?'AND party_id IS NULL':''} ${active?'AND EXISTS(SELECT 1 FROM rpg_accounts a WHERE a.account_tg_id=rpg_characters.account_tg_id AND a.active_char_id=rpg_characters.tg_id)':''}`).bind(delta,now,String(c.tg_id),c.rev,delta);
}
async function write(db,c,id,action,payload,stmts,result,now) {
  try { await db.batch([...stmts,receipt(db,c,id,action,payload,result,now)]); }
  catch(e) {
    const prior=await replay(db,c,id,action,payload);if(prior)return response(db,c,prior);
    if(/exchange_equipment_locked/.test(String(e.message)))fail('in_exchange','這件裝備已在交易所保管中',409);
    if(/UNIQUE constraint failed: rpg_exchange/.test(String(e.message)))fail('conflict','這筆上架資料已更新，請重新整理',409);
    throw classifyDbError(e)||e;
  }
  return response(db,c,result);
}
async function rowById(db,id) {
  return db.prepare('SELECT l.*,c.name seller_name FROM rpg_exchange_listings l LEFT JOIN rpg_characters c ON c.tg_id=l.seller_char WHERE l.id=?').bind(id).first();
}
export async function create(env,tg,b,now=Date.now()) {
  bodyObject(b);
  const db=env.DB,c=await actor(db,tg),id=requestId(b.requestId),price=integer(b.price,1,EXCHANGE.maxPrice,'price','售價須為 1 至 1,000,000 的整數金幣');
  if([b.equipId,b.item,b.guardianId].filter(Boolean).length!==1)fail('selection','一次只能上架一種道具、一件裝備或一位天使');
  const kind=b.equipId?'equip':b.guardianId?'guardian':'item',ref=identifier(b.equipId||b.guardianId||b.item),qty=integer(b.qty===undefined?1:b.qty,1,kind==='item'?EXCHANGE.maxQty:1,'qty','數量無效');
  const payload={kind,ref,qty,price,characterId:identifier(b.characterId)},old=await replay(db,c,id,'create',payload);if(old)return response(db,c,old);
  expectedActor(c,b);
  if(c.active_char_id&&c.active_char_id!==String(tg))fail('character_changed','角色已切換，請重新選角',409);
  if(c.party_id)fail('party','請先完成組隊冒險，再上架道具',409);
  let snapshot,info;
  if(kind==='equip') {
    snapshot=await db.prepare('SELECT * FROM rpg_equipment WHERE id=? AND tg_id=?').bind(ref,String(tg)).first();
    checkEquipLine(snapshot,tg);
    if(snapshot.source==='starter')fail('untradeable','新手裝備不能交易');
    const auto=await db.prepare("SELECT 1 FROM rpg_auto_enhance WHERE item_id=? AND status IN ('running','processing') UNION ALL SELECT 1 FROM rpg_auto_reroll WHERE item_id=? AND status IN ('running','processing') LIMIT 1").bind(ref,ref).first();
    if(auto)fail('auto_active','這件裝備正在背景作業，請先停止該任務',409);
    info=equipmentInfo(c,snapshot);
  } else if(kind==='guardian') {
    snapshot=await db.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=? AND char_id=?').bind(ref,String(tg)).first();
    checkGuardian(snapshot,c);info=guardianInfo(env,snapshot);
  } else {
    exchangeItem(ref);snapshot={item:ref};info=itemInfo(ref);
    const held=await db.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?').bind(String(tg),ref).first();
    if(!held||held.quantity<qty)fail('insufficient','背包的可上架道具不足，請重新整理',409);
  }
  const listingId=crypto.randomUUID(),fee=feeFor(price),row={id:listingId,seller_account:ownerOf(c),seller_char:String(tg),kind,ref,qty,price,fee,status:'active',snapshot_json:JSON.stringify(snapshot),seller_name:c.name,created_at:now,updated_at:now};
  const result={action:'create',listingId,listing:listingView(row,c,env),price,fee,netGold:price-fee,qty};
  const stmts=[revisionStmt(db,c,now,0,{active:true,party:true}),guardStmt(db),
    db.prepare("INSERT INTO rpg_exchange_listings(id,seller_account,seller_char,kind,ref,qty,price,fee,category,class_req,tier,quality,enhance,snapshot_json,status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,? WHERE (SELECT COUNT(*) FROM rpg_exchange_listings WHERE seller_account=? AND status='active')<?").bind(listingId,ownerOf(c),String(tg),kind,ref,qty,price,fee,info.category,info.classReq,info.tier,info.quality,info.enhance,JSON.stringify(snapshot),now,now,ownerOf(c),EXCHANGE.maxActive),guardStmt(db)];
  if(kind==='equip')stmts.push(db.prepare('UPDATE rpg_equipment SET trade_id=? WHERE id=? AND tg_id=? AND is_equipped=0 AND bound=0 AND trade_id IS NULL').bind(escrow(listingId),ref,String(tg)),guardStmt(db));
  else if(kind==='guardian')stmts.push(db.prepare('UPDATE rpg_guardian_sigils SET exchange_id=?,rev=rev+1,updated_at=? WHERE id=? AND char_id=? AND bound=0 AND active=0 AND locked=0 AND trade_id IS NULL AND exchange_id IS NULL AND rev=?').bind(listingId,now,ref,String(tg),snapshot.rev),guardStmt(db));
  else stmts.push(db.prepare('UPDATE rpg_inventory SET quantity=quantity-? WHERE tg_id=? AND item=? AND quantity>=?').bind(qty,String(tg),ref,qty),guardStmt(db));
  stmts.push(ledgerStmt(db,{event_id:`exchange:${listingId}:escrow`,tg_id:tg,type:'交易所上架保管',item:kind==='equip'?'equip:'+ref:kind==='guardian'?'sigil:'+ref:ref,item_delta:-qty,note:JSON.stringify({listingId,price,qty})},now));
  return write(db,c,id,'create',payload,stmts,result,now);
}
export async function cancel(env,tg,b,now=Date.now()) {
  bodyObject(b);
  const db=env.DB,c=await actor(db,tg),id=requestId(b.requestId),listingId=identifier(b.listingId),payload={listingId,characterId:identifier(b.characterId)};
  const old=await replay(db,c,id,'cancel',payload);if(old)return response(db,c,old);
  expectedActor(c,b);
  if(c.active_char_id&&c.active_char_id!==String(tg))fail('character_changed','角色已切換，請重新選角',409);
  const row=await rowById(db,listingId);if(!row)fail('not_found','找不到這筆上架',404);
  if(row.seller_account!==ownerOf(c))fail('not_owned','只能撤下自己帳號的上架',403);
  if(row.status!=='active')fail('closed','這筆上架已成交或撤下',409);
  const seller=await actor(db,row.seller_char),closed={...row,status:'cancelled',updated_at:now};
  if(row.kind==='guardian'&&(seller.party_id||c.party_id))fail('party','請先完成組隊冒險，再取回守護天使',409);
  const result={action:'cancel',listingId,listing:listingView(closed,c,env),price:row.price,fee:0,netGold:0,qty:row.qty,returnedCharacterId:row.seller_char};
  const stmts=[db.prepare("UPDATE rpg_exchange_listings SET status='cancelled',rev=rev+1,closed_at=?,updated_at=? WHERE id=? AND rev=? AND status='active'").bind(now,now,listingId,row.rev),guardStmt(db),revisionStmt(db,seller,now,0,{active:String(seller.tg_id)===String(c.tg_id),party:row.kind==='guardian'}),guardStmt(db)];
  if(String(seller.tg_id)!==String(c.tg_id))stmts.push(revisionStmt(db,c,now,0,{active:true,party:row.kind==='guardian'}),guardStmt(db));
  if(row.kind==='equip')stmts.push(db.prepare('UPDATE rpg_equipment SET trade_id=NULL WHERE id=? AND tg_id=? AND trade_id=?').bind(row.ref,row.seller_char,escrow(listingId)),guardStmt(db));
  else if(row.kind==='guardian')stmts.push(db.prepare('UPDATE rpg_guardian_sigils SET exchange_id=NULL,rev=rev+1,updated_at=? WHERE id=? AND char_id=? AND exchange_id=? AND bound=0 AND active=0 AND locked=0 AND trade_id IS NULL').bind(now,row.ref,row.seller_char,listingId),guardStmt(db));
  else stmts.push(invDeltaStmt(db,row.seller_char,row.ref,row.qty));
  stmts.push(ledgerStmt(db,{event_id:`exchange:${listingId}:return`,tg_id:row.seller_char,type:'交易所撤回道具',item:row.kind==='equip'?'equip:'+row.ref:row.kind==='guardian'?'sigil:'+row.ref:row.ref,item_delta:row.qty,note:listingId},now));
  return write(db,c,id,'cancel',payload,stmts,result,now);
}
export async function buy(env,tg,b,now=Date.now()) {
  bodyObject(b);
  const db=env.DB,c=await actor(db,tg),id=requestId(b.requestId),listingId=identifier(b.listingId),payload={listingId,characterId:identifier(b.characterId)};
  const old=await replay(db,c,id,'buy',payload);if(old)return response(db,c,old);
  expectedActor(c,b);
  const row=await rowById(db,listingId);if(!row)fail('not_found','找不到這筆上架',404);
  if(row.seller_account===ownerOf(c))fail('self_trade','不能購買自己帳號上架的道具',409);
  if(row.status!=='active')fail('closed','這筆道具已被購買或撤下，請重新整理',409);
  if(c.active_char_id&&c.active_char_id!==String(tg))fail('character_changed','角色已切換，請重新選角',409);
  if(c.party_id)fail('party','請先完成組隊冒險，再購買道具',409);
  if(c.gold<row.price)fail('gold','金幣不足');
  const seller=await actor(db,row.seller_char),net=row.price-row.fee;
  if(row.kind==='guardian'&&(c.level<15||seller.level<15))fail('guardian_level','守護天使交易雙方須達15級',403);
  if(row.kind==='guardian'&&seller.party_id)fail('party','刊登天使的旅者正在組隊冒險，請等冒險結束再購買',409);
  const result={action:'buy',listingId,listing:listingView({...row,status:'sold',updated_at:now},c,env),price:row.price,fee:row.fee,netGold:net,qty:row.qty};
  const stmts=[db.prepare("UPDATE rpg_exchange_listings SET status='sold',buyer_char=?,rev=rev+1,closed_at=?,updated_at=? WHERE id=? AND rev=? AND status='active'").bind(String(tg),now,now,listingId,row.rev),guardStmt(db),
    revisionStmt(db,c,now,-row.price,{active:true,party:true}),guardStmt(db),revisionStmt(db,seller,now,net,{party:row.kind==='guardian'}),guardStmt(db)];
  if(row.kind==='equip')stmts.push(db.prepare('UPDATE rpg_equipment SET tg_id=?,trade_id=NULL,is_equipped=0 WHERE id=? AND tg_id=? AND trade_id=? AND bound=0 AND is_equipped=0').bind(String(tg),row.ref,row.seller_char,escrow(listingId)),guardStmt(db));
  else if(row.kind==='guardian')stmts.push(db.prepare('UPDATE rpg_guardian_sigils SET char_id=?,exchange_id=NULL,rev=rev+1,updated_at=? WHERE id=? AND char_id=? AND exchange_id=? AND bound=0 AND active=0 AND locked=0 AND trade_id IS NULL AND EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=? AND level>=15 AND party_id IS NULL)').bind(String(tg),now,row.ref,row.seller_char,listingId,String(tg)),guardStmt(db));
  else stmts.push(invDeltaStmt(db,String(tg),row.ref,row.qty));
  const item=row.kind==='equip'?'equip:'+row.ref:row.kind==='guardian'?'sigil:'+row.ref:row.ref;
  stmts.push(ledgerStmt(db,{event_id:`exchange:${listingId}:buy`,tg_id:tg,type:'交易所購買',gold_delta:-row.price,item,item_delta:row.qty,note:listingId},now),
    ledgerStmt(db,{event_id:`exchange:${listingId}:payout`,tg_id:row.seller_char,type:'交易所售出入帳',gold_delta:net,note:JSON.stringify({listingId,price:row.price,fee:row.fee})},now),
    ledgerStmt(db,{event_id:`exchange:${listingId}:fee`,tg_id:row.seller_char,type:'交易所手續費',gold_delta:0,note:JSON.stringify({listingId,fee:row.fee,taxPct:EXCHANGE.taxPct})},now));
  return write(db,c,id,'buy',payload,stmts,result,now);
}
