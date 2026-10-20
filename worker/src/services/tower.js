import * as P from './player.js';
import {requireBackpackAccess} from './party-presence.js';
import {towerEntry} from './tower-daily.js';
import {TOWER_RULES,TOWER_TITLES,TOWER_OFFERS,imprintLevel,withImprint,towerTitle} from '../game/tower-progression.js';
import {GameError} from '../game/classes.js';
import {mapForLevel} from '../game/formulas.js';
import {MAX_OPEN_MAP} from '../game/constants.js';
import {specialState,saveSpecial} from '../game/special.js';
import {equipmentView} from '../views.js';

export async function view(env,tg,now){const {player:p}=await P.withPlayer(env,tg,now);return {ok:true,tower:await state(env,p,now)};}
async function state(env,p,now){const s=specialState(p.char),tier=Math.min(MAX_OPEN_MAP,mapForLevel(p.char.level));return {rules:TOWER_RULES,daily:await towerEntry(env.DB,p.char.tg_id,now),badges:p.inv.tower_fragment||0,best:s.towerBest||0,title:towerTitle(p.char),titles:TOWER_TITLES.map(t=>({...t,unlocked:(s.towerBest||0)>=t.floor})),offers:TOWER_OFFERS.map(o=>({...o,quantity:o.qty||tier*o.perTier})),equipment:p.equipment.filter(e=>!e.trade_id).map(e=>equipmentView(p.char,e))};}
export async function action(env,tg,b,now){
 const request=String(b.requestId||'');if(!/^[\w:-]{1,160}$/.test(request))throw new GameError('request','缺少有效操作編號');
 const signature=JSON.stringify({op:b.op,offerId:b.offerId??null,itemId:b.itemId??null,from:b.from??null,titleId:b.titleId??null}),event=`tower-action:${tg}:${request}`;
 const recover=async()=>{const old=await env.DB.prepare('SELECT note FROM rpg_ledger WHERE event_id=? AND tg_id=?').bind(event,String(tg)).first();if(!old)return null;const r=JSON.parse(old.note);if(r.signature!==signature)throw new GameError('request_reused','同一操作編號不能用於不同內容',409);return r.result;};
 let result=await recover();if(!result){try{const done=await P.withPlayer(env,tg,now,async(p,ctx)=>{
  const old=await recover();if(old)return {result:old};requireBackpackAccess(p.char,ctx);if(p.char.level<30)throw new GameError('level','爬塔與徽記工坊需要等級30');
  let cost=0,result,extra=[];
  if(b.op==='redeem'){
   const offer=TOWER_OFFERS.find(o=>o.id===b.offerId);if(!offer)throw new GameError('tower_offer','兌換項目無效');cost=offer.cost;const qty=offer.qty||Math.min(MAX_OPEN_MAP,mapForLevel(p.char.level))*offer.perTier;p.inv[offer.item]=(p.inv[offer.item]||0)+qty;result={op:b.op,item:offer.item,quantity:qty,cost};
  }else if(b.op==='imprint'){
   const item=p.equipment.find(e=>e.id===b.itemId);if(!item)throw new GameError('item','找不到你的裝備');if(item.is_equipped)throw new GameError('equipped','請先卸下裝備，再進行塔印淬鍊');if(item.trade_id)throw new GameError('in_trade','請先取回交易中的裝備');if(ctx.lockedEquipment.includes(item.id))throw new GameError('auto_active','請先停止這件裝備的背景作業');
   const busy=await ctx.db.prepare("SELECT 1 FROM rpg_auto_enhance WHERE item_id=? AND status IN ('running','processing') UNION ALL SELECT 1 FROM rpg_auto_reroll WHERE item_id=? AND status IN ('running','processing') LIMIT 1").bind(item.id,item.id).first();if(busy)throw new GameError('auto_active','請先停止這件裝備的背景作業');
   extra.push(ctx.db.prepare("INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT EXISTS(SELECT 1 FROM rpg_equipment WHERE id=? AND tg_id=? AND is_equipped=0 AND trade_id IS NULL) OR EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=? AND status IN ('running','processing')) OR EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=? AND status IN ('running','processing'))").bind(item.id,String(tg),item.id,item.id));
   const level=imprintLevel(item);if(!Number.isInteger(b.from)||b.from!==level)throw new GameError('imprint_changed','塔印已更新，請重新確認能力與費用',409);if(level>=TOWER_RULES.imprintMax)throw new GameError('imprint_max','塔印已達最高五階');cost=TOWER_RULES.imprintCosts[level];item.bonus_json=withImprint(item,level+1).bonus_json;result={op:b.op,itemId:item.id,from:level,to:level+1,cost};
  }else if(b.op==='title'){
   const s=specialState(p.char),title=TOWER_TITLES.find(t=>t.id===b.titleId);if(b.titleId&&(!title||(s.towerBest||0)<title.floor))throw new GameError('tower_title','尚未達到這個稱號的通關層數');s.towerTitle=title?.id||null;saveSpecial(p.char,s);result={op:b.op,title:title||null,cost:0};
  }else throw new GameError('op','塔印工坊操作無效');
  if((p.inv.tower_fragment||0)<cost)throw new GameError('tower_badges',`需要星穹徽記 ${cost} 個`);p.inv.tower_fragment=(p.inv.tower_fragment||0)-cost;
  return {result,extra,ledger:[{event_id:event,tg_id:String(tg),type:'星穹徽記工坊',item:'tower_fragment',item_delta:-cost,note:JSON.stringify({signature,result})}]};
 });result=done.result;}catch(error){const committed=await recover();if(!committed)throw error;result=committed;}}
 return {...await view(env,tg,now),result};
}
