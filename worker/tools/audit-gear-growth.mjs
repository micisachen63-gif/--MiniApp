// Synthetic economy audit; never connects to production or uses player records.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {makeGear} from '../src/game/gear.js';
import {itemStat,idleStats,computeStats,standardSet,standardStats,gearSpeed} from '../src/game/stats.js';
import {CLASS_KEYS,SLOTS,RARITIES,GENERAL_WEAPON,POTIONS,IDLE,RELIC,BLESSED_DROPS,STAR_RING_GEAR} from '../src/game/constants.js';
import {GEAR_GROWTH} from '../src/game/gear-growth.js';import {settleIdle} from '../src/game/idle.js';
import {mkChar,T0} from '../test/helpers.js';
const gear=(cls,slot,tier,rarity,roll=.5)=>makeGear({id:'synthetic',tgId:'111',cls,slot,kind:slot==='weapon'?GENERAL_WEAPON[cls]:null,tier,forceRarity:rarity,rng:()=>roll,now:T0});
const report={policy:GEAR_GROWTH,expeditionPremium:STAR_RING_GEAR.statMult,comparisons:0,decreases:0,lostEnhancementIncrements:0,efficiencyCases:0,maxDirectEfficiencyRatio:1,unmodifiedRates:{eliteChance:IDLE.eliteChance,relicEliteChance:RELIC.eliteChance,relicBossChance:RELIC.bossChance,blessedDrops:BLESSED_DROPS},helmets:[],economy6h:[]};
for(const cls of CLASS_KEYS)for(const slot of SLOTS)for(let tier=1;tier<=12;tier++)for(const rarity of Object.keys(RARITIES))for(const roll of [0,.5,.99999])for(const source of ['shop','star_ring','relic_boss']){
 const e={...gear(cls,slot,tier,rarity,roll),source,grade:source==='relic_boss'?'relic':'normal'};let prev=0,oldPrev=0;
 for(let level=0;level<=15;level++){
  const row={...e,enhance_level:level},current=itemStat(row,cls).main,old=itemStat(row,cls,1).main;report.comparisons++;
  if(current<old)report.decreases++;if(level&&current-prev<old-oldPrev-1)report.lostEnhancementIncrements++;prev=current;oldPrev=old;
 }
}
for(let tier=1;tier<=12;tier++){
 const raw=gear('archer','helmet',tier,'legendary'),normal={...raw,enhance_level:7},star={...normal,source:'star_ring'};
 report.helmets.push({tier,ordinaryPlus7:itemStat(normal,'archer').main,expeditionPlus0:itemStat({...star,enhance_level:0},'archer').main,expeditionPlus7:itemStat(star,'archer').main,expeditionPlus9:itemStat({...star,enhance_level:9},'archer').main});
}
for(const cls of CLASS_KEYS)for(let tier=1;tier<=12;tier++)for(const rarity of ['common','legendary','supreme'])for(const enhance of [0,4,7,9,15])for(const source of ['shop','star_ring']){
 const c=mkChar({base_class:cls,level:tier*10,class_path:'A1'}),eq=standardSet(cls,c.level).map(e=>({...e,element_tier:rarity,enhance_level:enhance,source}));
 const baseline=gearSpeed(computeStats(c,eq,c.level,1).power/standardStats(cls,c.class_path,c.level).power),current=idleStats(c,eq).g;
 assert.ok(current>=baseline-1e-12);assert.ok(current<=2);report.maxDirectEfficiencyRatio=Math.max(report.maxDirectEfficiencyRatio,current/baseline);report.efficiencyCases++;
}
const old=[[50,'sword',21215,926],[50,'archer',19041,817],[50,'mage',21215,933],[70,'sword',25773,987],[70,'archer',23132,841],[70,'mage',25773,950],[100,'sword',33424,1119],[100,'archer',29998,891],[100,'mage',33424,984]];
for(const [level,cls,oldGross,oldUpkeep] of old){
 const c=mkChar({level,base_class:cls,class_path:'A'}),r=settleIdle(c,{red_2:1e6,blue_2:1e6,red_3:1e6,blue_3:1e6,red_4:1e6,blue_4:1e6},standardSet(cls,level),T0+6*3600e3);
 const upkeep=Object.entries(r.report.used).reduce((sum,[key,n])=>sum+(POTIONS[key]?.price||0)*n,0),gross=r.report.gold_gained;
 report.economy6h.push({level,cls,oldGross,gross,oldUpkeep,upkeep,grossRatio:gross/oldGross,netRatio:(gross-upkeep)/(oldGross-oldUpkeep)});
 assert.ok(gross/oldGross<=1.1);assert.ok((gross-upkeep)/(oldGross-oldUpkeep)<=1.15);
}
assert.equal(report.decreases,0);assert.equal(report.lostEnhancementIncrements,0);assert.ok(report.maxDirectEfficiencyRatio<=1.1000000001);
const out=process.argv[2];if(out){await fs.mkdir(path.dirname(path.resolve(out)),{recursive:true});await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({comparisons:report.comparisons,decreases:report.decreases,lostEnhancementIncrements:report.lostEnhancementIncrements,efficiencyCases:report.efficiencyCases,maxDirectEfficiencyRatio:report.maxDirectEfficiencyRatio,maxObserved6hGrossRatio:Math.max(...report.economy6h.map(x=>x.grossRatio)),maxObserved6hNetRatio:Math.max(...report.economy6h.map(x=>x.netRatio)),output:out||null}));
