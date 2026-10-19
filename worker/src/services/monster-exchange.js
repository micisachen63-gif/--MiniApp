import {requireBackpackAccess} from './party-presence.js';
import {MONSTER_RECIPES,materialPair,coreExchangePrice} from '../game/monsters.js';
import {MONSTER_ITEMS} from '../game/monster-data.js';
import {mapForLevel} from '../game/formulas.js';
import {GameError} from '../game/classes.js';
export function monsterExchange(work,ctx,b) {
  const request=String(b.requestId||'');if(!/^(?:app:)?[\w-]{8,80}$/.test(request))throw new GameError('request','缺少有效操作編號');
  requireBackpackAccess(work.char,ctx);
  if(b.action==='refine'||b.refineTarget!=null){
    const source=String(b.sourceItem||''),target=String(b.refineTarget||'');
    const count=Number(b.count??b.refineCount??1);
    if(!Number.isInteger(count)||count<1||count>100)throw new GameError('quantity','每次精煉份數限1至100');
    if(!materialPair(source,target))throw new GameError('refine','只能將高地圖同種類材料以3比1精煉至較低地圖');
    if((work.inv[source]||0)<3*count)throw new GameError('insufficient',`精煉需要${3*count}個來源材料`);
    const tg=String(work.char.tg_id),note=`${source} ×${3*count} → ${target} ×${count}`;
    const ledger=[{event_id:`monster-exchange:${tg}:${request}`,tg_id:tg,type:'地圖材料精煉操作',note},
      {event_id:`monster-exchange:${tg}:${request}:${source}`,tg_id:tg,type:'地圖材料精煉',item:source,item_delta:-3*count,note},
      {event_id:`monster-exchange:${tg}:${request}:${target}`,tg_id:tg,type:'地圖材料精煉',item:target,item_delta:count,note}];
    work.inv[source]-=3*count;work.inv[target]=(work.inv[target]||0)+count;
    return {ledger,result:{refined:true,sourceItem:source,sourceQty:3*count,item:target,targetQty:count}};
  }
  if(b.action==='core'){
    const n=Number(b.map);if(!Number.isInteger(n)||n<1||n>12)throw new GameError('map','地圖不正確');
    const recipe=MONSTER_RECIPES.find(r=>r.mapId===n),item=`hunt_${n}_core`,need=recipe?.ingredients.find(x=>x.item===item);
    if(!need||!MONSTER_ITEMS[item])throw new GameError('recipe','這張地圖沒有首領核心');
    if(mapForLevel(work.char.level)<n)throw new GameError('level','尚未抵達這張地圖');
    if((work.inv[recipe.item]||0)>0)throw new GameError('owned','已解鎖這張地圖收藏');
    if((work.inv[item]||0)>=need.qty)throw new GameError('enough','首領核心已足夠製作');
    const price=coreExchangePrice(n),pay=b.pay==='fragment'?'fragment':'gold',tg=String(work.char.tg_id),note=`兌換 ${MONSTER_ITEMS[item].name}`;
    const ledger=[{event_id:`monster-exchange:${tg}:${request}`,tg_id:tg,type:'地圖收藏兌換核心',note},{event_id:`monster-exchange:${tg}:${request}:${item}`,tg_id:tg,type:'地圖收藏兌換',item,item_delta:1,note}];
    if(pay==='gold'){if(work.char.gold<price.gold)throw new GameError('gold',`需要 ${price.gold} 金幣`);work.char.gold-=price.gold;ledger[1].gold_delta=-price.gold;}
    else{if((work.inv.research_fragment||0)<price.fragments)throw new GameError('insufficient',`需要 ${price.fragments} 個技能研究碎片`);work.inv.research_fragment-=price.fragments;ledger.push({event_id:`monster-exchange:${tg}:${request}:research_fragment`,tg_id:tg,type:'地圖收藏兌換',item:'research_fragment',item_delta:-price.fragments,note});}
    work.inv[item]=(work.inv[item]||0)+1;
    return {ledger,result:{core:true,item,mapId:n,pay,gold:pay==='gold'?price.gold:0,fragments:pay==='fragment'?price.fragments:0}};
  }
  const recipe=MONSTER_RECIPES.find(r=>r.id===b.recipe);if(!recipe)throw new GameError('recipe','無效製作配方');
  if(mapForLevel(work.char.level)<recipe.mapId)throw new GameError('level','尚未到達這張地圖');
  if((work.inv[recipe.item]||0)>0)throw new GameError('owned','已解鎖這項地圖收藏');
  if(work.char.gold<recipe.gold)throw new GameError('gold',`需要 ${recipe.gold} 金幣`);
  for(const x of recipe.ingredients)if((work.inv[x.item]||0)<x.qty)throw new GameError('insufficient','地圖材料不足');
  const tg=String(work.char.tg_id),ledger=[{event_id:`monster-exchange:${work.char.tg_id}:${request}`,tg_id:String(work.char.tg_id),type:'地圖收藏製作操作',note:recipe.id}];
  const row=(item,delta)=>({event_id:`monster-exchange:${tg}:${request}:${item}`,tg_id:tg,type:'地圖收藏製作',item,item_delta:delta,note:recipe.name});
  for(const x of recipe.ingredients){work.inv[x.item]-=x.qty;ledger.push(row(x.item,-x.qty));}
  work.char.gold-=recipe.gold;work.inv[recipe.item]=1;
  ledger.push({...row(recipe.item,1),gold_delta:-recipe.gold});
  return {ledger,result:{item:recipe.item,name:recipe.name,mapId:recipe.mapId,spell:recipe.spell}};
}
