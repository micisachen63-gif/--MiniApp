// Deterministic isolated model, not live-player telemetry or a market forecast.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {starRingEquipmentReward,starRingGearDropPlan,STAR_RING_GEAR_YIELD as policy} from '../src/game/star-ring-gear.js';
import * as E from '../src/game/star-ring.js';import {gearSellPrice} from '../src/game/gear.js';import {mkChar,T0} from '../test/helpers.js';
const actor=E.snapshot({char:mkChar({tg_id:'1',base_class:'sword',class_path:'A1',level:120}),equipment:[]});
const rich=i=>({grade:'S',expHours:4,defeats:[i*2,i*2+1].flatMap(hourIndex=>[{rank:'elite',hourIndex,serial:1},{rank:'elite',hourIndex,serial:2},{rank:'boss',hourIndex,serial:3}])});
const report={policy,assumptions:'Every checkpoint defeats four credited elites and two bosses; S grade. Solo: 720 supplied active minutes, survive all elites; excludes rare relics. Not live results.',idle:[],samples:10000,models:[],recipes:[]};
for(const lootBonus of [0,.5,1]){
 const idle=720*.03*(1+Math.min(1,.4*(1+lootBonus)));assert.ok(policy.minimum>idle);report.idle.push({lootBonus,expectedEquipment:idle,guarantee:0});
 for(const difficulty of ['normal','advanced']){
  let total=0,oldTotal=0,min=Infinity,max=0;
  for(let n=0;n<report.samples;n++){
   const s={id:'ring:volume-audit',seed:'volume-audit-'+n,engineVersion:3,tier:120,difficulty,startedAt:T0,endsAt:T0+E.DURATION,results:Array.from({length:6},(_,i)=>rich(i))};
   const a={...actor,guardian:{lootBonus}};let count=0,old=0;
   for(let i=0;i<6;i++){const result=s.results[i],prior=E.stageReward(s,a,i,result).equipment,p=starRingGearDropPlan(s,a,i,result,prior);count+=p.ids.length;old+=1+p.huntExtra+p.gradeExtra;}
   assert.equal(count-old,42);assert.ok(count>=48&&count<=55);total+=count;oldTotal+=old;min=Math.min(min,count);max=Math.max(max,count);
  }
  report.models.push({lootBonus,difficulty,oldMean:oldTotal/report.samples,mean:total/report.samples,min,max,ratioToIdle:total/report.samples/idle});
 }
}
for(const level of [40,70,100,120]){
 let total=0,oldSale=0,sale=0,supreme=0,maxSale=0;
 for(let n=0;n<1000;n++){
  const s={id:'ring:recipe-audit',seed:'volume-recipes-'+n,engineVersion:3,tier:level,difficulty:'normal',startedAt:T0,endsAt:T0+E.DURATION,results:Array.from({length:6},(_,i)=>rich(i))};let oneSale=0;
  for(let i=0;i<6;i++){
   const prior=E.stageReward(s,actor,i,s.results[i]).equipment;
   for(const e of starRingEquipmentReward(s,actor,i,prior,level,s.results[i])){
    total++;supreme+=Number(e.element_tier==='supreme');oneSale+=gearSellPrice(e);
    if(!e.id.includes(':volume:')){const legacy={...e,bonus_json:JSON.stringify({...JSON.parse(e.bonus_json),starRingYieldVersion:undefined})};oldSale+=gearSellPrice(legacy);}
   }
  }
  maxSale=Math.max(maxSale,oneSale);sale+=oneSale;
 }
 assert.ok(sale/oldSale<1.1);assert.ok(supreme/total>.01&&supreme/total<.03);
 report.recipes.push({level,samples:1000,totalGear:total,supremeRate:supreme/total,oldMeanSaleGold:oldSale/1000,meanSaleGold:sale/1000,saleRatio:sale/oldSale,maxSampleSale:maxSale});
}
report.hardMaxNewRunSaleGold=55*Math.floor(10270*.18);report.oldHardMaxSaleGold=13*10270;assert.ok(report.hardMaxNewRunSaleGold<report.oldHardMaxSaleGold);
const out=process.argv[2];if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
