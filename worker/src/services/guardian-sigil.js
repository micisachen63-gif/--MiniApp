import {publicConfig,activeSettings,QUALITY_ORDER,TYPE_NAMES,QUALITY_NAMES,TYPES,creditQuote} from '../game/guardian-sigil-config.js';
import {GameError} from '../game/classes.js';
import {withPlayer,shortId} from './player.js';
import {loadPlayer,guardStmt,ledgerStmt,outboxStmt} from '../db.js';
import {taipeiDay,taipeiAt} from '../game/time.js';
import {mulberry32} from '../game/rng.js';
import {SHARE} from '../game/constants.js';
import {checkShareRate} from '../game/share.js';
import {guardianEffect} from '../game/guardian-effects.js';
import {specialState,saveSpecial} from '../game/special.js';
import {ASSIST_ITEM} from '../game/guardian-assist.js';

// Public information and mutations share the same approved, adjustable settings.
export function config(env={}){return {ok:true,config:publicConfig(env)};}
export function requireApprovedConfig(config){
 if(config?.enabled!==true||config?.status!=='approved')throw new GameError('guardian_pending_approval','守護神規則尚在確認，暫未開放操作',409);
 return config;
}
const queryAll=async(db,sql,...bind)=>(await db.prepare(sql).bind(...bind).all()).results||[];
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(v)))))).map(n=>n.toString(16).padStart(2,'0')).join('');
const bad=(code,message,status=400)=>{throw new GameError(code,message,status);};
const seed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
export function sigilView(row){return {id:row.id,type:row.type,typeName:TYPE_NAMES[row.type],quality:QUALITY_ORDER[row.quality-1],rank:row.quality,qualityName:QUALITY_NAMES[row.quality-1],bound:!!row.bound,active:!!row.active,locked:!!row.locked,inTrade:!!(row.trade_id||row.exchange_id),tradeId:row.trade_id||null,inExchange:!!row.exchange_id,exchangeId:row.exchange_id||null,revision:Number(row.rev||0),createdAt:row.created_at};}
export function insertSigil(db,row){return db.prepare('INSERT INTO rpg_guardian_sigils(id,char_id,type,quality,bound,source_operation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(row.id,row.char_id,row.type,row.quality,row.bound||0,row.source_operation_id,row.created_at,row.created_at);}
export function announcement(db,op,item,char,source,now,env={},rows=[item]){
 const shareId='s'+shortId(),effect=guardianEffect(item,env),snapshot={...sigilView(item),...effect,kind:'sigil',name:effect.qualityName+'・'+effect.typeName,photo:effect.artUrl.replace('.webp','-share.jpg')};
 const tradeable=!(item.bound||item.active||item.locked||item.trade_id||item.exchange_id),context={source:'guardian',announcement:true,showcase:!tradeable};
 const qualityCounts=Object.fromEntries(QUALITY_ORDER.map((key,i)=>[key,rows.filter(row=>row.quality===i+1).length]));
 // Automatic achievements use the existing non-manual post kind. They do not
 // consume share cooldowns/daily tasks or enqueue a second share notification.
 return [db.prepare("INSERT INTO rpg_shares(id,tg_id,equip_id,kind,object_kind,snapshot_json,context_json,tradeable,created_at) VALUES(?,?,?,'relic','sigil',?,?,?,?)").bind(shareId,String(char.tg_id),item.id,JSON.stringify(snapshot),JSON.stringify(context),tradeable?1:0,now),
  outboxStmt(db,{dedupe:`guardian:${op}:${item.id}`,target:'group',kind:'guardian_sigil_obtained',payload:{operationId:op,shareId,itemId:item.id,tgId:char.tg_id,name:char.name,source,...effect,bound:!!item.bound,photo:snapshot.photo,count:rows.length,qualityCounts}},now)];
}
const receipt=async(db,char,key)=>db.prepare('SELECT * FROM rpg_guardian_operations WHERE char_id=? AND request_id=?').bind(String(char),key).first();
function resolveReceipt(old,expected){if(old.payload_hash!==expected)bad('request_reused','同一操作編號不能用於不同內容',409);return JSON.parse(old.result_json);}
function requestKey(input){const key=String(input?.requestId||'');if(!/^(?:app:)?[A-Za-z0-9_-]{6,64}$/.test(key))bad('request','需要有效的操作編號');return key;}

async function execute(env,charId,input,action,payload,now,fn){
 if(!env?.DB)bad('guardian_pending_approval','守護神尚未開放',409);
 const cfg=activeSettings(env),char=String(charId),request=requestKey(input);
 const fingerprint=await hash({action,payload}),old=await receipt(env.DB,char,request);
 if(old)return {ok:true,operation:resolveReceipt(old,fingerprint),state:await state(env,char,now)};
 requireApprovedConfig(cfg);
 if(input.configVersion&&input.configVersion!==cfg.configVersion)bad('config_changed','召喚規則已更新，請重新確認',409);
 const operationId='g'+shortId(),operationSeed=seed();let result;
 try{
  await withPlayer(env,char,now,async(work)=>{
   if(work.char.level<cfg.limits.unlockLevel)bad('guardian_level','守護神系統於15級開放',403);
   const previous=await receipt(env.DB,char,request);if(previous){result=resolveReceipt(previous,fingerprint);return {};}
   const rng=mulberry32(operationSeed),out=await fn(work,cfg,rng,operationId),account=String(work.char.account_tg_id||char);
   result={operationId,requestId:request,charId:char,action,status:'committed',configVersion:cfg.configVersion,consumed:out.consumed||{gold:0,vouchers:0,credits:0},results:out.results||[],createdAt:now,...out.details};
   // The legacy SQL enum groups support under activation; the immutable JSON
   // receipt and fingerprint retain its distinct assist action and exact mode.
   const op=env.DB.prepare('INSERT INTO rpg_guardian_operations(operation_id,account_id,char_id,request_id,action,payload_hash,config_version,cost_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(operationId,account,char,request,action==='assist'?'activate':action,fingerprint,cfg.configVersion,JSON.stringify(result.consumed),JSON.stringify(result),now);
   return {extra:[op,...out.statements||[]],ledger:[{event_id:`guardian:${operationId}`,tg_id:char,type:`守護神${action}`,gold_delta:-(out.consumed?.gold||0),note:JSON.stringify(result)}],result};
  });
 }catch(error){const committed=await receipt(env.DB,char,request);if(committed)result=resolveReceipt(committed,fingerprint);else throw error;}
 return {ok:true,operation:result,state:await state(env,char,now)};
}

export async function state(env,charId,now=Date.now(),{cursor=null,limit=40,quality:filterQuality=undefined}={}){
 if(filterQuality!==undefined&&!QUALITY_ORDER.includes(filterQuality))bad('quality','請選擇有效的天使品質');
 if(filterQuality!==undefined&&cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>128||/[\u0000-\u001f]/.test(cursor)))bad('cursor','天使分頁已失效，請重新選擇品質');
 const char=String(charId),player=await loadPlayer(env.DB,char);if(!player)bad('no_character','先建立角色',404);
 const account=String(player.char.account_tg_id||char),day=taipeiDay(now),safeLimit=Math.max(1,Math.min(100,Number(limit)||40));
 // Reuse the previous daily-counter read for all-quality material counts. One
 // owner-indexed aggregation, never another round of reads for each quality tab.
 const eligible="g.active=0 AND g.locked=0 AND g.trade_id IS NULL AND g.exchange_id IS NULL";
 const totals=await env.DB.prepare(`SELECT COALESCE((SELECT n FROM rpg_daily_counters WHERE tg_id=? AND day=? AND key='guardian_voucher'),0) n,COUNT(*) total_count,${QUALITY_ORDER.map((key,i)=>`COALESCE(SUM(CASE WHEN g.quality=${i+1} AND ${eligible} THEN 1 ELSE 0 END),0) ${key}_count`).join(',')} FROM rpg_guardian_sigils g WHERE g.char_id=?`).bind(account,day,char).first();
 const count=totals?.n||0,qualityCounts=Object.fromEntries(QUALITY_ORDER.map(key=>[key,totals?.[key+'_count']||0]));
 const where=['char_id=?'],params=[char];
 if(filterQuality!==undefined){where.push('quality=?');params.push(QUALITY_ORDER.indexOf(filterQuality)+1);}
 if(cursor){where.push('id>?');params.push(String(cursor));}
 const rows=await queryAll(env.DB,`SELECT * FROM rpg_guardian_sigils WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`,...params,safeLimit+1);
 const active=await env.DB.prepare('SELECT * FROM rpg_guardian_sigils WHERE char_id=? AND active=1').bind(char).first();
 const voucherCount=player.inv.guardian_voucher||0,remainder=player.char.guardian_draw_remainder||0;
 const unlocked=player.char.level>=15,welcome=await env.DB.prepare('SELECT * FROM rpg_guardian_welcome WHERE account_id=?').bind(account).first();
 // Read the existing assist state from this same player snapshot. Permanent
 // activation remains separate: stopping support preserves its active guardian.
 const special=specialState(player.char),support=special.guardianAssist||{},supportItem=typeof support.itemId==='string'?support.itemId:null,supportSettings=activeSettings(env).assist;
 const assist={itemId:supportItem,remainingBattles:Number.isSafeInteger(support.remainingBattles)&&support.remainingBattles>=0?support.remainingBattles:0,
  enabled:special.guardianSummonEnabled===true,autoRenew:!!supportItem&&(support.autoRenew===true||support.autoRenew===undefined),autoBuy:special.guardianStoneSupply===true,
  stoneCount:player.inv[ASSIST_ITEM]||0,battlesPerStone:supportSettings.battlesPerStone,stoneGold:supportSettings.stoneGold};
 return {schemaVersion:1,charId:char,level:player.char.level,unlocked,revision:player.char.rev,serverNow:now,resetAt:taipeiAt(day,0)+86400000,balances:{gold:player.char.gold,voucherCount,remainder,availableDraws:voucherCount*5+remainder,freeNormalDraws:player.inv.guardian_free_normal||0},welcome:{claimed:!!welcome,granted:welcome?200:0,freeDraws:player.inv.guardian_free_normal||0,recipientCharId:welcome?.recipient_char_id||null},daily:{day,granted:count,remaining:Math.max(0,4-count)},activeGuardian:active?sigilView(active):null,assist,inventory:{items:rows.slice(0,safeLimit).map(sigilView),nextCursor:rows.length>safeLimit?rows[safeLimit-1].id:null,quality:filterQuality??null,qualityCounts,eligibleCounts:qualityCounts,totalCount:totals?.total_count||0},actions:Object.fromEntries(Object.entries(publicConfig(env).actions).map(([key,value])=>[key,value&&unlocked]))};
}
export async function ensureWelcome(env,charId,now){
 await env.DB.prepare('INSERT OR IGNORE INTO rpg_guardian_welcome(account_id,recipient_char_id,created_at) SELECT account_tg_id,tg_id,? FROM rpg_characters WHERE tg_id=? AND level>=15').bind(now,String(charId)).run();
}
export async function inventory(env,charId,input,now){if(publicConfig(env).enabled)await ensureWelcome(env,charId,now);return {ok:true,state:await state(env,charId,now,input)};}
export async function operation(env,charId,input){
 const row=input.operationId?await env.DB.prepare('SELECT * FROM rpg_guardian_operations WHERE char_id=? AND operation_id=?').bind(String(charId),String(input.operationId)).first():await receipt(env.DB,String(charId),requestKey(input));
 if(!row)bad('operation_not_found','尚未找到已結算結果，可用同一操作編號再次確認',404);
 return {ok:true,operation:JSON.parse(row.result_json)};
}
export async function history(env,charId,input={}){return {ok:true,operations:(await queryAll(env.DB,'SELECT result_json FROM rpg_guardian_operations WHERE char_id=? ORDER BY created_at DESC,operation_id DESC LIMIT ?',String(charId),Math.max(1,Math.min(100,Number(input.limit)||20)))).map(r=>JSON.parse(r.result_json))};}
function quality(weights,rng){let roll=rng()*weights.reduce((n,w)=>n+w,0);for(let i=0;i<weights.length;i++){roll-=weights[i];if(roll<0)return i+1;}throw new Error('invalid guardian weights');}

export async function summon(env,charId,input={},now=Date.now()){return performSummon(env,charId,input,now);}
export async function autoSummonStep(env,job,now){return performSummon(env,job.char_id,{pool:job.pool,count:job.single_draw?1:job.draw_count,requestId:'auto_'+job.id.replaceAll('-','')+'_'+job.rev},now,job);}
async function performSummon(env,charId,input={},now=Date.now(),autoJob=null){
 const pool=String(input.pool||''),count=Number(input.count);
 if(!['normal','featured'].includes(pool)||!Number.isSafeInteger(count)||![1,5,10].includes(count))bad('summon_count','僅支援單抽、五連或十連召喚');
 return execute(env,charId,input,'summon',{pool,count},now,async(work,cfg,rng,op)=>{
  let consumed={gold:0,vouchers:0,credits:0,freeNormalDraws:0};
  if(pool==='normal'){consumed.freeNormalDraws=Math.min(count,work.inv.guardian_free_normal||0);const paid=count-consumed.freeNormalDraws;consumed.gold=Math.floor(paid/10)*cfg.normalTenGold+(paid%10)*cfg.normalSingleGold;if(work.char.gold<consumed.gold)bad('gold','金幣不足');work.char.gold-=consumed.gold;if(consumed.freeNormalDraws)work.inv.guardian_free_normal-=consumed.freeNormalDraws;}
  else{let quote;try{quote=creditQuote(work.inv.guardian_voucher||0,work.char.guardian_draw_remainder||0,count);}catch{bad('insufficient','招喚憑證或剩餘抽次不足');}consumed.vouchers=quote.consumedVouchers;consumed.credits=count;work.inv.guardian_voucher=quote.voucherCount;work.char.guardian_draw_remainder=quote.remainder;}
  if(autoJob&&autoJob.max_gold!==null&&autoJob.spent_gold+consumed.gold>autoJob.max_gold)bad('auto_budget','本批費用超過自動召喚金幣預算');
  const rows=Array.from({length:count},(_,i)=>({id:`${op}-${i.toString(36)}`,char_id:String(charId),type:TYPES[Math.floor(rng()*TYPES.length)],quality:quality(pool==='normal'?cfg.normalWeights:cfg.featuredWeights,rng),bound:0,source_operation_id:op,created_at:now}));
  const statements=rows.map(r=>insertSigil(env.DB,r));
  for(const row of rows){statements.push(ledgerStmt(env.DB,{event_id:`guardian:${op}:item:${row.id}`,tg_id:String(charId),type:'守護羽毛取得',item:`sigil:${row.id}`,item_delta:1,note:JSON.stringify({operationId:op,source:pool,type:row.type,quality:QUALITY_ORDER[row.quality-1]})},now));}
  const highest=rows.reduce((best,row)=>row.quality>best.quality?row:best,rows[0]);
  if(highest.quality>=cfg.limits.announcementMinimumRank)statements.push(...announcement(env.DB,op,highest,work.char,pool,now,env,rows));
  if(autoJob){const totals=JSON.parse(autoJob.counts_json);for(const row of rows)totals[row.quality-1]++;const match=rows.find(row=>(autoJob.target_type==='any'||autoJob.target_type==='attack'&&row.type!=='loot'||row.type===autoJob.target_type)&&row.quality>=autoJob.target_rank);statements.push(env.DB.prepare("UPDATE rpg_guardian_auto SET status=?,reason=?,match_id=?,batches=batches+1,total_draws=total_draws+?,spent_gold=spent_gold+?,spent_vouchers=spent_vouchers+?,used_free=used_free+?,counts_json=?,rev=rev+1,next_at=?,updated_at=? WHERE id=? AND rev=? AND status='running'").bind(match?'ended':'running',match?'target':null,match?.id||null,count,consumed.gold,consumed.vouchers,(consumed.freeNormalDraws||0),JSON.stringify(totals),now+3000,now,autoJob.id,autoJob.rev),guardStmt(env.DB));}
  return {consumed,results:rows.map(sigilView),statements,details:{pool,count}};
 });
}
export async function fuse(env,charId,input={},now=Date.now()){
 const ids=input.itemIds;if(!Array.isArray(ids)||![4,6].includes(ids.length)||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)bad('materials','需選取四或六張不重複羽毛');
 const primaryId=String(input.primaryId||ids[0]);if(!ids.includes(primaryId))bad('primary','主羽毛不在素材中');
 return execute(env,charId,input,'fuse',{itemIds:[...ids].sort(),primaryId},now,async(work,cfg,rng,op)=>{
  if(work.char.party_id)bad('party','組隊戰鬥中不可合成');
  const rows=await queryAll(env.DB,`SELECT * FROM rpg_guardian_sigils WHERE char_id=? AND id IN (${ids.map(()=>'?').join(',')})`,String(charId),...ids);
  if(rows.length!==ids.length)bad('materials','找不到全部素材');const primary=rows.find(r=>r.id===primaryId),rank=primary.quality;
  if(rank>=8||rows.some(r=>r.quality!==rank)||ids.length!==cfg.upgradeMaterials[rank-1])bad('materials','素材品質或張數不正確');
  if(rows.some(r=>r.active||r.locked||r.trade_id||r.exchange_id))bad('protected','啟用、鎖定或交易中的羽毛不可合成');
  if(rank<cfg.mixedFromQuality&&rows.some(r=>r.type!==primary.type))bad('mixed_type','這個階段需要同類型羽毛');
  const fee=cfg.upgradeGoldFees[rank-1];if(work.char.gold<fee)bad('gold','合成金幣不足');work.char.gold-=fee;
  const success=rng()<cfg.upgradeSuccess[rank-1],bound=rows.some(r=>r.bound)?1:0,removed=success?rows:rows.filter(r=>r.id!==primaryId);
  const statements=[env.DB.prepare(`DELETE FROM rpg_guardian_sigils WHERE char_id=? AND active=0 AND locked=0 AND trade_id IS NULL AND exchange_id IS NULL AND id IN (${removed.map(()=>'?').join(',')})`).bind(String(charId),...removed.map(r=>r.id)),env.DB.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE changes()<>?').bind(removed.length)];
  let resultRow;if(success){resultRow={id:op+'-f',char_id:String(charId),type:primary.type,quality:rank+1,bound,source_operation_id:op,created_at:now};statements.push(insertSigil(env.DB,resultRow));if(resultRow.quality>=cfg.limits.announcementMinimumRank)statements.push(...announcement(env.DB,op,resultRow,work.char,'fuse',now,env));}
  else{resultRow={...primary,bound};statements.push(env.DB.prepare('UPDATE rpg_guardian_sigils SET bound=?,rev=rev+1,updated_at=? WHERE id=? AND char_id=? AND active=0 AND trade_id IS NULL AND exchange_id IS NULL AND locked=0').bind(bound,now,primaryId,String(charId)),guardStmt(env.DB));}
  for(const row of removed)statements.push(ledgerStmt(env.DB,{event_id:`guardian:${op}:consume:${row.id}`,tg_id:String(charId),type:'守護羽毛合成素材',item:`sigil:${row.id}`,item_delta:-1},now));
  return {consumed:{gold:fee,vouchers:0,credits:0},results:[sigilView(resultRow)],statements,details:{success,primaryId,refundedId:success?null:primaryId,consumedIds:removed.map(r=>r.id),inputRank:rank}};
 });
}
export async function activate(env,charId,input={},now=Date.now()){
 const itemId=input.itemId==null?null:String(input.itemId);
 return execute(env,charId,input,'activate',{itemId},now,async(work)=>{
  if(work.char.party_id)bad('party','請先結束組隊戰鬥');
  const x=specialState(work.char);if(x.guardianAssist&&x.guardianAssist.itemId!==itemId){delete x.guardianAssist;saveSpecial(work.char,x);}
  const statements=[env.DB.prepare('UPDATE rpg_guardian_sigils SET active=0,rev=rev+1,updated_at=? WHERE char_id=? AND active=1').bind(now,String(charId))];let row=null;
  if(itemId){row=await env.DB.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=? AND char_id=?').bind(itemId,String(charId)).first();if(!row||row.trade_id||row.exchange_id)bad('not_found','羽毛不存在或在交易中');statements.push(env.DB.prepare('UPDATE rpg_guardian_sigils SET active=1,bound=1,rev=rev+1,updated_at=? WHERE id=? AND char_id=? AND trade_id IS NULL AND exchange_id IS NULL').bind(now,itemId,String(charId)),guardStmt(env.DB));}
  return {results:row?[sigilView({...row,active:1,bound:1})]:[],statements};
 });
}
export async function assist(env,charId,input={},now=Date.now()){
 const mode=String(input.mode||''),itemId=String(input.itemId||''),quantity=Number(input.quantity||1),autoRenew=input.autoRenew===true,autoBuy=input.autoBuy===true;
 if(!['start','select','stop','renew','continuation','supply','buy'].includes(mode)||!Number.isSafeInteger(quantity)||quantity<1||quantity>10)bad('assist','召喚設定無效');
 if(mode==='continuation'&&typeof input.autoRenew!=='boolean')bad('assist','請選擇是否續召');
 return execute(env,charId,input,'assist',{mode,itemId,quantity,autoRenew,autoBuy},now,async(work,cfg)=>{
  if(work.char.party_id)bad('party','請先結束組隊戰鬥，再調整掛機輔助');
  const x=specialState(work.char),statements=[];let consumed={gold:0,vouchers:0,credits:0},row=null,resumed=false,replacedRemainingBattles=0;
  if(mode==='buy'){
   consumed.gold=cfg.assist.stoneGold*quantity;if(work.char.gold<consumed.gold)bad('gold','金幣不足');
   work.char.gold-=consumed.gold;work.inv[ASSIST_ITEM]=(work.inv[ASSIST_ITEM]||0)+quantity;
  }else if(mode==='start'||mode==='select'){
   const previous=x.guardianAssist;
   if(mode==='start'&&x.guardianSummonEnabled===true&&previous?.itemId&&(previous.itemId!==itemId||previous.remainingBattles>0))bad('assist_active','已有天使參戰，請先取消召喚再換一位天使');
   row=await env.DB.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=? AND char_id=?').bind(itemId,String(charId)).first();
   if(!row||row.trade_id||row.exchange_id)bad('not_found','找不到可召喚的天使，或羽毛正在交易中');
   resumed=mode==='start'&&x.guardianSummonEnabled!==true&&previous?.itemId===itemId&&previous.remainingBattles>0;
   if(mode==='start'&&!resumed&&!(work.inv[ASSIST_ITEM]>0))bad('insufficient','需要一顆天使召喚石');
   if(mode==='start'&&!resumed){work.inv[ASSIST_ITEM]--;consumed.stones=1;if(previous?.itemId!==itemId)replacedRemainingBattles=previous?.remainingBattles||0;}
   const remainingBattles=resumed?previous.remainingBattles:mode==='start'?cfg.assist.battlesPerStone:previous?.itemId===itemId?previous.remainingBattles:0;
   x.guardianAssist={itemId,remainingBattles,battlesPerStone:cfg.assist.battlesPerStone,autoRenew,pendingFirstStone:mode==='select'&&remainingBattles===0};
   x.guardianSummonEnabled=true;
   statements.push(env.DB.prepare('UPDATE rpg_guardian_sigils SET active=0,rev=rev+1,updated_at=? WHERE char_id=? AND active=1').bind(now,String(charId)),env.DB.prepare('UPDATE rpg_guardian_sigils SET active=1,bound=1,rev=rev+1,updated_at=? WHERE id=? AND char_id=? AND trade_id IS NULL AND exchange_id IS NULL').bind(now,itemId,String(charId)),guardStmt(env.DB));
  }else if(mode==='supply')x.guardianStoneSupply=autoBuy;
  else if(mode==='continuation'){if(!x.guardianAssist)bad('assist','請先選擇要召喚的天使');x.guardianAssist.autoRenew=autoRenew;}
  else if(mode==='stop')x.guardianSummonEnabled=false;
  else{if(!x.guardianAssist){if(!work.char.guardian)bad('assist','請先在掛機輔助選擇參戰天使');x.guardianAssist={itemId:work.char.guardian.id,remainingBattles:0,battlesPerStone:cfg.assist.battlesPerStone,autoRenew:true,pendingFirstStone:true};}else if(x.guardianAssist.autoRenew===undefined)x.guardianAssist.autoRenew=true;x.guardianSummonEnabled=autoRenew;}
  saveSpecial(work.char,x);
  statements.push(ledgerStmt(env.DB,{event_id:`guardian-assist:${charId}:${input.requestId}`,tg_id:String(charId),type:mode==='buy'?'天使召喚石補給':mode==='start'?'天使參戰':'天使參戰設定',item:mode==='buy'||mode==='start'?ASSIST_ITEM:null,item_delta:mode==='buy'?quantity:mode==='start'?-(consumed.stones||0):0},now));
  return {consumed,statements,results:row?[sigilView({...row,active:1,bound:1})]:[],details:{mode,guardianAssist:x.guardianAssist||null,resumed,replacedRemainingBattles}};
 });
}
export async function lock(env,charId,input={},now=Date.now()){
 const itemId=String(input.itemId||''),locked=input.locked===true;
 return execute(env,charId,input,'lock',{itemId,locked},now,async(work)=>{if(work.char.party_id)bad('party','組隊戰鬥中不可變更');const statement=env.DB.prepare('UPDATE rpg_guardian_sigils SET locked=?,rev=rev+1,updated_at=? WHERE id=? AND char_id=? AND trade_id IS NULL AND exchange_id IS NULL').bind(locked?1:0,now,itemId,String(charId));return {statements:[statement,guardStmt(env.DB)]};});
}
export async function unbind(env,charId,input={},now=Date.now()){
 const itemId=String(input.itemId||'');return execute(env,charId,input,'unbind',{itemId},now,async(work,cfg)=>{
  if(work.char.party_id)bad('party','請先結束組隊戰鬥');const row=await env.DB.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=? AND char_id=?').bind(itemId,String(charId)).first();
  if(!row||!row.bound||row.active||row.locked||row.trade_id||row.exchange_id)bad('protected','請先解除啟用、鎖定及交易狀態');
  const cost=cfg.unbindScrolls[row.quality-1];if((work.inv.unbind||0)<cost)bad('insufficient',`需要 ${cost} 張赫密士解契卷`);work.inv.unbind-=cost;
  return {statements:[env.DB.prepare('UPDATE rpg_guardian_sigils SET bound=0,rev=rev+1,updated_at=? WHERE id=? AND char_id=? AND bound=1 AND active=0 AND locked=0 AND trade_id IS NULL AND exchange_id IS NULL').bind(now,itemId,String(charId)),guardStmt(env.DB)],results:[sigilView({...row,bound:0})],details:{usedUnbindScrolls:cost}};
 });
}

export async function share(env,charId,input={},now=Date.now()){
 const itemId=String(input.itemId||'');return execute(env,charId,input,'share',{itemId},now,async(work)=>{
  const db=env.DB,row=await db.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=? AND char_id=?').bind(itemId,String(charId)).first();
  if(!row||row.trade_id||row.exchange_id)bad('protected','找不到羽毛或正在交易中');
  const day=taipeiDay(now),[last,today,same]=await Promise.all([
   db.prepare("SELECT MAX(created_at)t FROM rpg_shares WHERE tg_id=? AND kind='share'").bind(String(charId)).first(),
   db.prepare("SELECT n FROM rpg_daily_counters WHERE tg_id=? AND day=? AND key='share'").bind(String(charId),day).first(),
   db.prepare("SELECT MAX(created_at)t FROM rpg_shares WHERE equip_id=? AND object_kind='sigil' AND kind='share'").bind(itemId).first()]);
  checkShareRate({last:last?.t,today:today?.n||0,sameItemAt:same?.t},now);
  const id='s'+shortId(),effect=guardianEffect(row,env),snap={...sigilView(row),...effect,kind:'sigil',name:effect.qualityName+'・'+effect.typeName,photo:effect.artUrl.replace('.webp','-share.jpg')},tradeable=!(row.bound||row.active||row.locked),context=tradeable?null:{showcase:true};
  const gate=db.prepare(`INSERT INTO rpg_guard(ok) SELECT NULL WHERE
    EXISTS(SELECT 1 FROM rpg_shares WHERE tg_id=? AND kind='share' AND created_at>?)
    OR EXISTS(SELECT 1 FROM rpg_shares WHERE equip_id=? AND object_kind='sigil' AND kind='share' AND created_at>?)
    OR COALESCE((SELECT n FROM rpg_daily_counters WHERE tg_id=? AND day=? AND key='share'),0)>=?`)
    .bind(String(charId),now-SHARE.cooldownMs,itemId,now-SHARE.sameItemMs,String(charId),day,SHARE.dailyCap);
  return {details:{shareId:id},statements:[gate,db.prepare("INSERT INTO rpg_shares(id,tg_id,equip_id,kind,object_kind,snapshot_json,context_json,tradeable,created_at) VALUES(?,?,?,'share','sigil',?,?,?,?)").bind(id,String(charId),itemId,JSON.stringify(snap),context?JSON.stringify(context):null,tradeable?1:0,now),db.prepare("INSERT INTO rpg_daily_counters(tg_id,day,key,n) VALUES(?,?,'share',1) ON CONFLICT(tg_id,day,key) DO UPDATE SET n=n+1").bind(String(charId),day),outboxStmt(db,{dedupe:'share:'+id,target:'group',kind:'share',payload:{shareId:id}},now)]};
 });
}

/** Insert after the authoritative boss attack row in the SAME batch. */
export function voucherGrantStmt(db,char,bossId,now){
 const account=String(char.account_tg_id||char.tg_id),day=taipeiDay(now);
 return db.prepare("INSERT INTO rpg_guardian_voucher_grants(account_id,boss_id,day,recipient_char_id,created_at) SELECT ?,?,?,?,? WHERE COALESCE((SELECT n FROM rpg_daily_counters WHERE tg_id=? AND day=? AND key='guardian_voucher'),0)<4 AND NOT EXISTS(SELECT 1 FROM rpg_guardian_voucher_grants WHERE account_id=? AND boss_id=?)").bind(account,String(bossId),day,String(char.tg_id),now,account,day,account,String(bossId));
}

export const API_CONTRACT=Object.freeze({
 schemaVersion:1,
 reads:['guardian/config','guardian/inventory','guardian/operation','guardian/history'],
 mutations:['guardian/summon','guardian/fuse','guardian/activate','guardian/lock','guardian/unbind','guardian/share'],
 stateFields:['charId','revision','serverNow','resetAt','balances','daily','activeGuardian','inventory','actions'],
 operationFields:['operationId','requestId','charId','action','status','configVersion','consumed','results','createdAt'],
});
