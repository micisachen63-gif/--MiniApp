// The scene is a SELECT-only projection of the existing guardian authorities.
import * as Guardian from './guardian-sigil.js';
import * as Auto from './guardian-auto.js';
import { SELL_PRICES, sellBlock } from './guardian-shop.js';
import { actorContext } from './guardian-receipt.js';
import { activeSettings, publicConfig, QUALITY_ORDER, creditQuote } from '../game/guardian-sigil-config.js';
import { guardianEffect } from '../game/guardian-effects.js';
import { runningRingId, canManageBackpackInParty } from './party-presence.js';
import { loadPlayer } from '../db.js';
import { GameError } from '../game/classes.js';

const invalid=message=>{throw new GameError('guardian_scene_input',message,400);};
function parameters(body) {
 const quality=body.quality??'all',cursor=body.cursor??null,limit=body.limit??40,historyLimit=body.historyLimit??20;
 if(quality!=='all'&&!QUALITY_ORDER.includes(quality))invalid('請選擇有效天使品質');
 if(cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>128||/[\u0000-\u001f]/.test(cursor)))invalid('天使分頁已失效，請重新選擇品質');
 if(!Number.isInteger(limit)||limit<1||limit>40||!Number.isInteger(historyLimit)||historyLimit<1||historyLimit>50)invalid('天使分頁大小無效');
 return {quality,cursor,limit,historyLimit};
}
function quotes(config,cfg,state,player) {
 const b=state.balances;
 const normal=[1,5,10].map(count=>{
  const freeNormalDraws=Math.min(count,b.freeNormalDraws),paid=count-freeNormalDraws,gold=Math.floor(paid/10)*cfg.normalTenGold+(paid%10)*cfg.normalSingleGold;
  return {pool:'normal',count,expectedCosts:{gold,vouchers:0,credits:0,freeNormalDraws},affordable:b.gold>=gold,after:{freeNormalDraws:b.freeNormalDraws-freeNormalDraws}};
 });
 const featured=[1,5,10].map(count=>{
  const vouchers=Math.ceil(Math.max(0,count-b.remainder)/cfg.limits.drawsPerVoucher);
  let after=null;
  try { const q=creditQuote(b.voucherCount,b.remainder,count);after={voucherCount:q.voucherCount,remainder:q.remainder,availableDraws:q.availableDraws}; } catch {}
  return {pool:'featured',count,expectedCosts:{gold:0,vouchers,credits:count,freeNormalDraws:0},affordable:after!==null,after};
 });
 return {summon:{normal,featured},fuse:config.rules.upgradeStages,
  assist:{stoneGold:cfg.assist.stoneGold,battlesPerStone:cfg.assist.battlesPerStone,stoneCount:state.assist.stoneCount,
   start:{expectedCosts:{gold:0,stones:1}},resume:{expectedCosts:{gold:0,stones:0}},
   buy:Array.from({length:10},(_,i)=>({quantity:i+1,expectedCosts:{gold:cfg.assist.stoneGold*(i+1),stones:0},affordable:b.gold>=cfg.assist.stoneGold*(i+1)}))},
  unbind:cfg.unbindScrolls,sale:SELL_PRICES};
}
async function project(env,tg,body,now,attempt) {
 const p=parameters(body),{actor,context}=await actorContext(env,tg,now,body),cfg=activeSettings(env),config=publicConfig(env);
 const state=await Guardian.state(env,tg,now,{cursor:p.cursor,limit:p.limit,...(p.quality==='all'?{}:{quality:p.quality})});
 const player=await loadPlayer(env.DB,tg,env),ringId=player.char.party_id?await runningRingId(env.DB,tg):null;
 const partyLocked=!canManageBackpackInParty(player.char,ringId),phase=env.REALM_CONTEXT?.phase||'ACTIVE';
 const writable=phase==='ACTIVE'&&config.enabled===true&&config.status==='approved'&&state.unlocked;
 const rows=state.inventory.items.length?(await env.DB.prepare('SELECT * FROM rpg_guardian_sigils WHERE char_id=? AND id IN (SELECT value FROM json_each(?))').bind(String(tg),JSON.stringify(state.inventory.items.map(i=>i.id))).all()).results||[]:[];
 const rowById=new Map(rows.map(r=>[r.id,r]));
 const items=state.inventory.items.map(i=>{
  const r=rowById.get(i.id);if(!r)return i;
  const escrow=i.inTrade||i.inExchange?'正在交易保管中':null,locked=i.locked?'已鎖定，請先解除鎖定':null,active=i.active?'正在守護，請先取消守護':null,party=partyLocked?'請先結束目前的組隊戰鬥':null,closed=!writable?'目前僅供查看':null;
  const sale=closed||party||sellBlock(r,player.char);
  return {...i,...guardianEffect(r,env),sellPrice:SELL_PRICES[r.quality-1],sellBlock:sale,
   protection:{fuse:closed||party||active||locked||escrow||(i.rank===8?'已達最高品質':null),
    activate:closed||party||escrow,unbind:closed||party||active||locked||escrow||(!i.bound?'尚未綁定':null),
    lock:closed||party||escrow,sale}};
 });
 state.inventory={...state.inventory,quality:p.quality,items};
 state.balances={...state.balances,unbindScrolls:player.inv.unbind||0};
 const welcome=await env.DB.prepare('SELECT * FROM rpg_guardian_welcome WHERE account_id=?').bind(context.accountId).first();
 state.welcome={...state.welcome,accountId:context.accountId,eligible:writable&&!welcome,createdAt:welcome?.created_at??null};
 const job=await Auto.view(env,tg);
 const source=job?await env.DB.prepare('SELECT tg_id,name,base_class,class_path,level FROM rpg_live_characters WHERE tg_id=? AND account_tg_id=?').bind(job.characterId,context.accountId).first():null;
 const operations=(await Guardian.history(env,tg,{limit:p.historyLimit})).operations;
 const receiptRows=(await env.DB.prepare('SELECT event_id,note,created_at FROM rpg_ledger WHERE tg_id=? AND type=? ORDER BY created_at DESC,event_id DESC LIMIT ?').bind(String(tg),'天使場景操作收據',p.historyLimit).all()).results||[];
 const receipts=receiptRows.map(r=>{try{const saved=JSON.parse(r.note);return {version:saved.version,kind:saved.kind,signature:saved.signature,scope:saved.scope,createdAt:r.created_at,requestKey:r.event_id.slice(('guardian-scene-receipt:'+tg+':').length),costs:saved.costs};}catch{return {createdAt:r.created_at,corrupt:true};}});
 const {context:current}=await actorContext(env,tg,now,body);
 if(current.revision!==context.revision||state.revision!==context.revision||player.char.rev!==context.revision) {
  if(attempt<1)return project(env,tg,body,now,attempt+1);
  throw new GameError('guardian_snapshot_changed','天使資料正在更新，請重新整理目前角色',409);
 }
 return {...current,guardian:{config,state,shop:{characterId:String(tg),revision:state.revision,gold:state.balances.gold,quality:p.quality,items,nextCursor:state.inventory.nextCursor},
  auto:{job,sourceCharacter:source?{id:source.tg_id,name:source.name,baseClass:source.base_class,classPath:source.class_path,level:source.level}:null,ownerAccountId:context.accountId,intervalMs:Auto.INTERVAL_MS},
  history:{operations,receipts},control:{realmPhase:phase,writable,characterId:String(tg),accountId:context.accountId,unlocked:state.unlocked,welcomeRequired:!state.welcome.claimed,partyLocked},quotes:quotes(config,cfg,state,player)}};
}
export async function view(env,tg,body={},now=Date.now()) {return project(env,tg,body,now,0);}
