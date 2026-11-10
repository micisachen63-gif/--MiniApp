import {withPlayer} from './player.js';
import {actorContext,scopedBossEnv,requireActiveRealm,exchangeRequest,exchangeSignature,exchangeRecord} from './boss-receipt.js';
import {requireBackpackAccess} from './party-presence.js';
import {BOSS_EXCHANGES} from '../game/boss-economy.js';
import {GameError} from '../game/classes.js';
import {makeGear} from '../game/gear.js';
import {SLOTS,CLASSES,GENERAL_WEAPON,MAX_OPEN_MAP} from '../game/constants.js';
import {mapForLevel} from '../game/formulas.js';
import {mulberry32} from '../game/rng.js';
export function bossExchange(work,ctx,b,{scoped=false}={}){
 requireBackpackAccess(work.char,ctx);
 const request=String(b.requestId||'');if(!/^(?:app:)?[\w-]{8,80}$/.test(request))throw new GameError('request','缺少有效操作編號');
 const tg=String(work.char.tg_id),ledger=[],result={items:{}},costs={};
 const record=(item,delta,note)=>ledger.push({event_id:`boss-exchange:${tg}:${request}:${item}`,tg_id:tg,type:'首領精華兌換',item,item_delta:delta,note});
 if(b.offer==='legacy'){
  if(scoped&&((work.inv.mat_3||0)!==b.expectedMaterials.mat_3||(work.inv.mat_4||0)!==b.expectedMaterials.mat_4))throw new GameError('material_changed','舊材料數量已改變，請重新核對全部回收內容',409);
  costs.mat_3=work.inv.mat_3||0;costs.mat_4=work.inv.mat_4||0;
  let total=0;for(const [key,value]of [['mat_3',12],['mat_4',16]]){const n=work.inv[key]||0;if(n){work.inv[key]=0;total+=n*value;record(key,-n,'舊轉職材料換回精華');}}
  if(!total)throw new GameError('material','沒有可回收的三、四轉舊材料');
  work.inv.boss_essence=(work.inv.boss_essence||0)+total;record('boss_essence',total,'舊轉職材料回收');result.items.boss_essence=total;
 }else{
  const offer=BOSS_EXCHANGES[b.offer];if(!offer)throw new GameError('offer','無效兌換品項');
  const currency=offer.currency||'boss_essence';if((work.inv[currency]||0)<offer.cost)throw new GameError('insufficient',`需要 ${offer.cost} ${currency==='boss_essence'?'首領精華':'遺物碎片'}`);
  costs[currency]=offer.cost;
  work.inv[currency]-=offer.cost;record(currency,-offer.cost,offer.name);
  if(b.offer==='relic'){
   const bytes=crypto.getRandomValues(new Uint32Array(1)),rng=mulberry32(bytes[0]),tier=Math.min(MAX_OPEN_MAP,mapForLevel(work.char.level)),slot=SLOTS[Math.floor(rng()*SLOTS.length)],branch=work.char.class_path?.[0];
   const kind=slot==='weapon'?(tier>=2&&branch?CLASSES[work.char.base_class].branches[branch].weapon:GENERAL_WEAPON[work.char.base_class]):null;
   const item=makeGear({id:'x'+crypto.randomUUID().replaceAll('-','').slice(0,11),tgId:tg,cls:work.char.base_class,slot,kind,tier,rng,now:ctx.now,source:'boss_exchange',relic:true});work.equipment.push(item);record('equip:'+item.id,1,item.name);result.equipment=item;
  }else{work.inv[offer.item]=(work.inv[offer.item]||0)+offer.qty;record(offer.item,offer.qty,offer.name);result.items[offer.item]=offer.qty;}
 }
 // Receipt, deductions and the original random gear share persistStatements' batch.
 // Zero deltas keep economic totals and the legacy response unchanged.
 if(scoped)ledger.push({event_id:'boss-exchange-receipt:'+tg+':'+request,tg_id:tg,type:'首領精華操作收據',note:JSON.stringify({version:1,signature:exchangeSignature(b,{scoped}),costs,result})});
 // persistStatements applies inventory deltas before extra. A concurrent grant
 // that does not bump char.rev must not be silently included or left behind.
 const extra=scoped&&b.offer==='legacy'?[ctx.db.prepare("INSERT INTO rpg_guard(ok) SELECT NULL WHERE COALESCE((SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='mat_3'),0)<>0 OR COALESCE((SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='mat_4'),0)<>0").bind(tg,tg)]:[];
 return {ledger,result,extra};
}



// The caller supplies a trusted namespace; request text cannot select one.
export async function exchangeScoped(env,tg,body,now,namespace='service'){
 requireActiveRealm(env);
 const {actor,context}=await actorContext(env,tg,now);
 const request=exchangeRequest(body.requestId,namespace);
 const signature=exchangeSignature(body,{scoped:true});
 const finish=(record,replayed)=>({...context,requestId:body.requestId,offer:body.offer,signature,result:record.result,replayed,recoveryAllowed:false,...(record.receipt?{receipt:record.receipt}:{})});
 const checked=record=>{if(record.unverified)throw new GameError('boss_receipt_legacy','舊操作缺少完整收據，請保留待核對狀態，不可重送',409);return record;};
 const previous=checked(await exchangeRecord(env,tg,body,namespace));
 if(previous.found)return finish(previous,true);
 const scopedEnv=scopedBossEnv(env,actor);
 try{
  const committed=await withPlayer(scopedEnv,tg,now,(work,ctx)=>bossExchange(work,ctx,{...body,requestId:request},{scoped:true}));
  return finish(committed,false);
 }catch(error){
  // A switch/deletion can happen without char.rev changing in this interval.
  // The scoped DB guard has already rolled back the entire attempted batch.
  await actorContext(env,tg,now);
  const recovered=checked(await exchangeRecord(env,tg,body,namespace));
  if(recovered.found)return finish(recovered,true);
  throw error;
 }
}
