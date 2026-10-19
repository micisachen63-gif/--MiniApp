import test from 'node:test';import assert from 'node:assert/strict';
import {makeGear,makeRelic} from '../src/game/gear.js';import {itemStat,itemExtras,enhanceBonus} from '../src/game/stats.js';
import {CLASS_KEYS,SLOTS,RARITIES,RELIC,GENERAL_WEAPON} from '../src/game/constants.js';
import {equipmentView} from '../src/views.js';import {mulberry32} from '../src/game/rng.js';
const gear=(cls,slot,tier,relic=false,rng=()=>.5,rarity='advanced')=>makeGear({id:'comparison',tgId:'1',cls,slot,kind:slot==='weapon'?GENERAL_WEAPON[cls]:null,tier,rng,forceRarity:rarity,relic,now:0});

test('reported +7 T4 legendary boots versus +7 T7 advanced relic: relic protection reverses the 410/256 gap without weakening the old boots',()=>{
 const old={...gear('mage','boots',4,false,()=>.5,'legendary'),base_stat:5,enhance_level:7},relic={...gear('mage','boots',7,true),base_stat:13,enhance_level:7};
 assert.equal(itemStat(old,'mage').main,410);assert.equal(itemStat(relic,'mage').main,526);assert.equal(relic.element_tier,'advanced');
 const view=equipmentView({tg_id:'1',base_class:'mage',class_path:'',level:80},relic);assert.equal(view.stat,526);assert.match(view.relicProtection,/傳說.*25%/);
});

for(const cls of CLASS_KEYS)test(`${cls}: weakest T7 relic exceeds strongest T4 legendary at equal enhancement in every slot, +0 to +15`,()=>{
 for(const slot of SLOTS)for(let level=0;level<=15;level++){
  const lower={...gear(cls,slot,4,false,()=>.999999,'legendary'),enhance_level:level},higher={...gear(cls,slot,7,true,()=>0),enhance_level:level};
  assert.ok(itemStat(higher,cls).main>itemStat(lower,cls).main,`${slot} +${level}: ${itemStat(higher,cls).main}/${itemStat(lower,cls).main}`);
 }
});

for(const cls of CLASS_KEYS)test(`${cls}: all T1–T12 relics improve monotonically without changing rarity, elements, side effects or enhancement caps`,()=>{
 for(const slot of SLOTS)for(let tier=1;tier<=12;tier++)for(const rarity of Object.keys(RARITIES)){
  const row=gear(cls,slot,tier,true,()=>.5,rarity),copy=structuredClone(row),extras=itemExtras(row);let previous=0;
  for(let level=0;level<=15;level++){
   const item={...row,enhance_level:level},normal={...item,grade:'normal'},now=itemStat(item,cls),old=itemStat(normal,cls);
   assert.ok(now.main>=old.main);assert.ok(now.main>=previous);previous=now.main;
   assert.equal(now.elem,old.elem);assert.deepEqual(itemExtras(item),extras);
   // At most the explicit rarity floor × 25% enhancement bonus, with rounding.
   const maximum=Math.max(1,RARITIES[RELIC.mainRarityFloor].mult/RARITIES[rarity].mult)*RELIC.enhanceMult;
   assert.ok(now.main<=Math.ceil(old.main*maximum)+2);
  }
  assert.deepEqual(row,copy,'calculation never rewrites inventory rows or rolled rarity');
 }
});

test('normal gear retains the published rarity/enhancement arithmetic; relics retain the existing creation RNG and affixes',()=>{
 for(const slot of ['weapon','armor','helmet','gloves','boots','ring','earring'])for(let tier=1;tier<=12;tier++)for(const rarity of Object.keys(RARITIES))for(const level of [0,4,7,10,15]){
  const row={...gear('sword',slot,tier,false,()=>.5,rarity),enhance_level:level},actual=itemStat(row,'sword');
  assert.equal(actual.main,Math.round((row.base_stat+enhanceBonus(slot,level,tier))*RARITIES[rarity].mult));
 }
 for(let seed=0;seed<100;seed++){
  const relic=makeRelic({id:'r',tgId:'1',tier:7,rng:mulberry32(seed),now:0,source:'relic_boss'}),copy=structuredClone(relic);itemStat(relic,relic.class_req==='any'?'sword':relic.class_req);
  assert.deepEqual(relic,copy);assert.ok(relic.affix_json);assert.ok(relic.affixes_json);
 }
 assert.equal(RELIC.rarityFloor,'advanced');assert.equal(RELIC.bossChance,.35);assert.equal(RELIC.eliteChance,.005);
});
