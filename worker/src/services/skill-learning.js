import * as P from './player.js';
import {loadPlayer} from '../db.js';
import {requireBackpackAccess} from './party-presence.js';
import {GameError} from '../game/classes.js';
import {SKILL_MAP,eligible,specialState,saveSpecial} from '../game/special.js';
import {masteryView,masteryLevel} from '../game/skill-mastery.js';

export async function learningAction(env,tg,b,now){
 if(!['learn','recycle'].includes(b.op))throw new GameError('op','技能操作無效');
 const id=String(b.skillId||''),skill=SKILL_MAP[id],request=String(b.requestId||'');
 if(!request)throw new GameError('request','缺少操作編號');
 if(!skill)throw new GameError('skill','技能不存在');
 const quantity=b.op==='recycle'?Number(b.quantity??1):1;
 if(!Number.isInteger(quantity)||quantity<1||quantity>999)throw new GameError('quantity','回收數量須為 1～999');
 const signature=JSON.stringify({op:b.op,id,fromLevel:b.fromLevel??null,quantity}),event=`special:${tg}:${request}`;
 const recover=async()=>{const row=await env.DB.prepare('SELECT note FROM rpg_ledger WHERE event_id=? AND tg_id=?').bind(event,tg).first();if(!row)return null;let note;try{note=JSON.parse(row.note);}catch{}if(note?.signature!==signature)throw new GameError('request_reused','此操作編號已用於其他內容',409);return {player:await loadPlayer(env.DB,tg,env),result:note.result};};
 const old=await recover();if(old)return old;
 try{return await P.withPlayer(env,tg,now,(w,ctx)=>{
  requireBackpackAccess(w.char,ctx);
  const x=specialState(w.char),view=masteryView(skill,x),key=`book_${id}`;let spent,result;
  if(b.op==='learn'){
   if(!eligible(w.char,skill))throw new GameError('skill','此角色的職業、轉職或等級不符合學習資格');
   const level=masteryLevel(x,id);
   if(level>=view.max)throw new GameError('skill_max','技能已達進修上限，可將多餘書回收為研究碎片');
   if(b.fromLevel==null&&level>0)throw new GameError('learned','已學會此技能，進修請先確認目前技能等級');
   if(b.fromLevel!=null&&b.fromLevel!==level)throw new GameError('skill_changed','技能等級已變更，請重新查看後確認',409);
   spent=view.nextCost;if((w.inv[key]||0)<spent)throw new GameError('book',`需要 ${spent} 份相同技能書`);
   w.inv[key]-=spent;if(!level)x.learned.push(id);x.mastery={...x.mastery,[id]:level+1};saveSpecial(w.char,x);
   result={op:'learn',skillId:id,level:level+1,books:spent};
  }else{
   spent=quantity;if((w.inv[key]||0)<spent)throw new GameError('book','技能書數量不足');
   w.inv[key]-=spent;const fragments=view.recycleValue*spent;w.inv.research_fragment=(w.inv.research_fragment||0)+fragments;
   result={op:'recycle',skillId:id,books:spent,fragments};
  }
  const ledger=[{event_id:event,tg_id:tg,type:b.op==='learn'?'技能學習與進修':'技能書回收',item:key,item_delta:-spent,note:JSON.stringify({signature,result})}];
  if(result.fragments)ledger.push({event_id:event+':research',tg_id:tg,type:'技能書回收研究',item:'research_fragment',item_delta:result.fragments});
  return {ledger,result};
 });}catch(e){const done=await recover();if(done)return done;throw e;}
}
