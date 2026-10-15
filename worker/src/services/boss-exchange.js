import {BOSS_EXCHANGES} from '../game/boss-economy.js';
import {GameError} from '../game/classes.js';
import {makeGear} from '../game/gear.js';
import {SLOTS,CLASSES,GENERAL_WEAPON,MAX_OPEN_MAP} from '../game/constants.js';
import {mapForLevel} from '../game/formulas.js';
import {mulberry32} from '../game/rng.js';
export function bossExchange(work,ctx,b){
 if(work.char.party_id)throw new GameError('party','請先完成組隊冒險再兌換');
 const request=String(b.requestId||'');if(!/^(?:app:)?[\w-]{8,80}$/.test(request))throw new GameError('request','缺少有效操作編號');
 const tg=String(work.char.tg_id),ledger=[],result={items:{}};
 const record=(item,delta,note)=>ledger.push({event_id:`boss-exchange:${tg}:${request}:${item}`,tg_id:tg,type:'首領精華兌換',item,item_delta:delta,note});
 if(b.offer==='legacy'){
  let total=0;for(const [key,value]of [['mat_3',12],['mat_4',16]]){const n=work.inv[key]||0;if(n){work.inv[key]=0;total+=n*value;record(key,-n,'舊轉職材料換回精華');}}
  if(!total)throw new GameError('material','沒有可回收的三、四轉舊材料');
  work.inv.boss_essence=(work.inv.boss_essence||0)+total;record('boss_essence',total,'舊轉職材料回收');result.items.boss_essence=total;
 }else{
  const offer=BOSS_EXCHANGES[b.offer];if(!offer)throw new GameError('offer','無效兌換品項');
  const currency=offer.currency||'boss_essence';if((work.inv[currency]||0)<offer.cost)throw new GameError('insufficient',`需要 ${offer.cost} ${currency==='boss_essence'?'首領精華':'遺物碎片'}`);
  work.inv[currency]-=offer.cost;record(currency,-offer.cost,offer.name);
  if(b.offer==='relic'){
   const bytes=crypto.getRandomValues(new Uint32Array(1)),rng=mulberry32(bytes[0]),tier=Math.min(MAX_OPEN_MAP,mapForLevel(work.char.level)),slot=SLOTS[Math.floor(rng()*SLOTS.length)],branch=work.char.class_path?.[0];
   const kind=slot==='weapon'?(tier>=2&&branch?CLASSES[work.char.base_class].branches[branch].weapon:GENERAL_WEAPON[work.char.base_class]):null;
   const item=makeGear({id:'x'+crypto.randomUUID().replaceAll('-','').slice(0,11),tgId:tg,cls:work.char.base_class,slot,kind,tier,rng,now:ctx.now,source:'boss_exchange',relic:true});work.equipment.push(item);record('equip:'+item.id,1,item.name);result.equipment=item;
  }else{work.inv[offer.item]=(work.inv[offer.item]||0)+offer.qty;record(offer.item,offer.qty,offer.name);result.items[offer.item]=offer.qty;}
 }
 return {ledger,result};
}

