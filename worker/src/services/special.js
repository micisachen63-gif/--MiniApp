import {requireBackpackAccess} from './party-presence.js';
import {BOSS_EXCHANGES} from '../game/boss-economy.js';
import * as P from './player.js';
import * as T from './trade.js';
import { playerView } from '../views.js';
import { computeStats } from '../game/stats.js';
import { SKILL_MAP,SPECIAL_SKILLS,eligible,specialState,saveSpecial,validateCast } from '../game/special.js';
import { GameError } from '../game/classes.js';
import { outboxStmt, classifyDbError,guardStmt } from '../db.js';
import { taipeiDay } from '../game/time.js';
import {activeSettings} from '../game/guardian-sigil-config.js';
import {guardianEffect} from '../game/guardian-effects.js';
import {specialCost} from '../game/combat-passives.js';
async function fullState(env,p,now){const rows=(await env.DB.prepare('SELECT * FROM rpg_guardian_sigils WHERE char_id=? AND trade_id IS NULL AND exchange_id IS NULL ORDER BY quality DESC,created_at DESC LIMIT 200').bind(String(p.char.tg_id)).all()).results||[];return {...stateView(p,now),guardian:p.char.guardian||null,guardianAssist:activeSettings(env).assist,guardianChoices:rows.map(row=>guardianEffect(row,env))};}
export async function view(env,tg,now){const r=await P.withPlayer(env,tg,now);return fullState(env,r.player,now);}
export function stateView(p,now){const c=p.char,x=specialState(c),v=playerView(p,{now}),pct=computeStats(c,p.equipment).pct;return {ok:true,now,bossExchanges:BOSS_EXCHANGES,character:v.character,stats:{...v.stats,pct},inventory:p.inv,special:x,skills:SPECIAL_SKILLS.map(s=>specialCost(s,pct)),eligible:SPECIAL_SKILLS.filter(s=>eligible(c,s)).map(s=>s.id)};}
export async function action(env,tg,b,now){
 const r=await P.withPlayer(env,tg,now,async(w,ctx)=>{
  const {db}=ctx;if(['redeem','learn'].includes(b.op))requireBackpackAccess(w.char,ctx);else if(w.char.party_id)throw new GameError('party','組隊戰鬥中請先完成冒險，再調整技能配置');
  const x=specialState(w.char),id=String(b.skillId||''),s=SKILL_MAP[id],extra=[];
  if(b.op==='learn'){
   if(!eligible(w.char,s))throw new GameError('skill','此角色的職業、轉職或等級不符合學習資格');
   if(x.learned.includes(id))throw new GameError('learned','這個角色已學會此技能');
   const key=`book_${id}`;if(!(w.inv[key]>0))throw new GameError('book','背包沒有此技能的學習道具');
   w.inv[key]--;x.learned.push(id);
  }else if(b.op==='loadout'){
   const ids=b.loadout;if(!Array.isArray(ids)||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>!x.learned.includes(id)||!eligible(w.char,SKILL_MAP[id])))throw new GameError('loadout','最多裝備三招已學會且符合當前職業的技能');
   x.loadout=ids;x.auto=Object.fromEntries(Object.entries(x.auto).filter(([id])=>ids.includes(id)));
  }else if(b.op==='auto'){
   if(!x.loadout.includes(id)||!eligible(w.char,s))throw new GameError('skill','請先裝備此技能');
   if(!['manual','ready','elite','lowHp'].includes(b.mode))throw new GameError('mode','自動施放條件無效');
   if(b.mode!=='manual'&&['skill_17_2','skill_24_2'].includes(id))throw new GameError('manual_only','此技能只能手動使用');
   if(b.mode==='manual')delete x.auto[id];else x.auto[id]=b.mode;
  }else if(b.op==='settings'){
   if(!['safe','strong'].includes(b.mode)||!Number.isInteger(b.budget)||b.budget<0||b.budget>50000)throw new GameError('budget','補水預算無效');
   x.mode=b.mode;x.budget=b.budget;
   if(Object.hasOwn(b,'guardianId')){
    const guardianId=String(b.guardianId||'');x.guardianSummonEnabled=!!guardianId;
    if(guardianId){
     if(w.char.level<15)throw new GameError('guardian_level','守護天使於15級開放');
     const row=await db.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=? AND char_id=? AND trade_id IS NULL AND exchange_id IS NULL').bind(guardianId,String(tg)).first();if(!row)throw new GameError('guardian','找不到可召喚的天使');
     if(x.guardianAssist?.itemId!==guardianId)x.guardianAssist={itemId:guardianId,remainingBattles:0,battlesPerStone:activeSettings(env).assist.battlesPerStone,autoRenew:true,pendingFirstStone:true};
     extra.push(db.prepare('UPDATE rpg_guardian_sigils SET active=0,rev=rev+1,updated_at=? WHERE char_id=? AND active=1').bind(now,String(tg)),db.prepare('UPDATE rpg_guardian_sigils SET active=1,bound=1,rev=rev+1,updated_at=? WHERE id=? AND char_id=? AND trade_id IS NULL AND exchange_id IS NULL').bind(now,guardianId,String(tg)),guardStmt(db));w.char.guardian=guardianEffect(row,env);
    }
   }
  }else if(b.op==='cancel'){delete x.pending;
  }else if(b.op==='cast'){
   if(w.char.party_id)throw new GameError('party','組隊戰鬥中請從隊伍戰術頁施放');
   validateCast({...w.char,affixPct:computeStats(w.char,w.equipment).pct},x,id,now);if(['skill_17_2','skill_24_2'].includes(id))throw new GameError('party_only','此技能需要在組隊戰鬥中選擇隊友');
   if(x.pending)throw new GameError('pending','已有技能等待下一場掛機戰鬥');x.pending=id;
  }else if(b.op==='redeem'){
   if(!eligible(w.char,s))throw new GameError('skill','目前無法兌換此技能');
   const cost={普通:80,高級:160,稀有:320,史詩:640,傳說:960}[s.rarity]||320;
   if((w.inv.research_fragment||0)<cost)throw new GameError('fragment',`需要研究碎片 ${cost} 個`);
   w.inv.research_fragment-=cost;w.inv[`book_${id}`]=(w.inv[`book_${id}`]||0)+1;
  }else throw new GameError('op','技能操作無效');
  saveSpecial(w.char,x);return {extra,ledger:[{event_id:`special:${tg}:${b.requestId}`,tg_id:tg,type:`技能${b.op}`,item:b.op==='learn'?`book_${id}`:null,item_delta:b.op==='learn'?-1:0,note:s?.name||b.op}],result:{op:b.op,skillId:id}};
 });return {...await fullState(env,r.player,now),result:r.result};
}
export async function share(env,tg,b,now){
 const r=await P.withPlayer(env,tg,now,(w,ctx)=>{
  const {db}=ctx;requireBackpackAccess(w.char,ctx);
  const s=SKILL_MAP[b.skillId];if(!s||!(w.inv[`book_${s.id}`]>0))throw new GameError('book','沒有可分享的學習道具');
  const x=specialState(w.char);if(x.shareAt&&now-x.shareAt<60000)throw new GameError('cooldown','技能寶物分享每分鐘一次');x.shareAt=now;saveSpecial(w.char,x);
  return {extra:[outboxStmt(db,{dedupe:`book:${tg}:${b.requestId}`,target:'group',kind:'skill_book',payload:{ownerId:tg,name:w.char.name,skill:s}},now)]};
 });return stateView(r.player,now);
}
export async function tradeBook(env,tg,b,now){
 const requestId=String(b.requestId||'');if(!requestId)throw new GameError('request','缺少操作編號');
 const old=await env.DB.prepare('SELECT trade_id FROM rpg_book_trade_operations WHERE char_id=? AND request_id=?').bind(tg,requestId).first();if(old)return {ok:true,tradeId:old.trade_id,trade:await T.tradeView(env,old.trade_id,tg,now)};
 const ownerId=b.ownerId?String(b.ownerId):tg;const target=b.ownerId?{tgId:tg}:b.target;
 const other=await T.findTarget(env,target);if(!other)throw new GameError('target','找不到交易對象');
 const [a,z]=await Promise.all([env.DB.prepare('SELECT account_tg_id FROM rpg_characters WHERE tg_id=?').bind(ownerId).first(),env.DB.prepare('SELECT account_tg_id FROM rpg_characters WHERE tg_id=?').bind(other.tg_id).first()]);
 if(!a||!z||a.account_tg_id===z.account_tg_id)throw new GameError('self','同一帳號的角色不能彼此交易');
 const item=`book_${b.skillId}`;if(!SKILL_MAP[b.skillId])throw new GameError('book','技能道具無效');
 const qty=await env.DB.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?').bind(ownerId,item).first();if(!(qty?.quantity>0))throw new GameError('book','對方已沒有此寶物');
 // A share recipient may open an EMPTY offer, never escrow the owner's items without their consent.
 const {id,stmts}=await T.openTradeStmts(env,{aTg:ownerId,bTg:other.tg_id,origin:'skill',preItem:b.ownerId?null:{item,qty:1}},now);
 try{await env.DB.batch([...stmts,env.DB.prepare('INSERT INTO rpg_book_trade_operations(char_id,request_id,trade_id) VALUES(?,?,?)').bind(tg,requestId,id),...[[ownerId],[other.tg_id]].map(([who])=>outboxStmt(env.DB,{dedupe:`book-trade:${id}:${who}`,target:'dm',tgId:who,kind:'trade_open',payload:{tradeId:id}},now))]);}
 catch(e){const prior=await env.DB.prepare('SELECT trade_id FROM rpg_book_trade_operations WHERE char_id=? AND request_id=?').bind(tg,requestId).first();if(prior)return {ok:true,tradeId:prior.trade_id,trade:await T.tradeView(env,prior.trade_id,tg,now)};throw classifyDbError(e)||e;}
 return {ok:true,tradeId:id,trade:await T.tradeView(env,id,tg,now)};
}
