import test from 'node:test';import assert from 'node:assert/strict';
import {makeGear,gearSellPrice} from '../src/game/gear.js';
import {itemStat,itemExtras,enhanceBonus,computeStats,standardSet,standardStats,idleStats,gearSpeed} from '../src/game/stats.js';
import {GEAR_GROWTH,tierBaseBonus} from '../src/game/gear-growth.js';
import {CLASS_KEYS,SLOTS,RARITIES,ARMOR_FAMILIES,SHARED_SLOTS,SLOT_SPEC,GENERAL_WEAPON,RELIC,STAR_RING_GEAR,ENHANCE} from '../src/game/constants.js';
import {gearRarity} from '../src/game/gear-quality.js';import {equipmentView} from '../src/views.js';
import {scrollCost,enhanceOdds} from '../src/game/enhance.js';import {mkChar,T0} from './helpers.js';
import {skillExpedition,shortParty,NOW} from './star-ring-skill-fixture.js';
import * as Ring from '../src/services/star-ring.js';import * as Engine from '../src/game/star-ring.js';
import * as Party from '../src/services/party.js';

const gear=(cls,slot,tier,rarity='legendary',roll=.5)=>makeGear({id:'g',tgId:'1',cls,slot,kind:slot==='weapon'?GENERAL_WEAPON[cls]:null,tier,forceRarity:rarity,rng:()=>roll,now:T0});
test('the complete previously paid +0–15 enhancement curve is frozen independently of tier-base growth',()=>{
 for(const slot of SLOTS)for(let tier=1;tier<=12;tier++)for(let level=0;level<=15;level++){
  const weapon=slot==='weapon',safe=weapon?6:4,extras=weapon?[5,8,12,18]:[3,5,8,12];let bonus=Math.min(level,safe)*(weapon?2:1);
  for(let n=0;n<level-safe;n++)bonus+=extras[n]??(weapon?25:18);
  assert.equal(enhanceBonus(slot,level,tier),bonus*[1,3,6,10][Math.min(3,tier-1)]);
 }
});
function oldMain(e,cls){
 const family=SHARED_SLOTS.includes(e.slot)&&SLOT_SPEC[e.slot]?.main==='def'?ARMOR_FAMILIES[cls].defMult:1;
 return Math.round((e.base_stat+enhanceBonus(e.slot,e.enhance_level,e.tier)*(e.grade==='relic'?1.25:1))*RARITIES[gearRarity(e)].mult*family*(e.source==='star_ring'&&e.grade!=='relic'?1.15:1));
}
test('reported T3 supreme +9 remains918; T7 legendary expedition +7 becomes1083 and a new +0 does not erase the old investment',()=>{
 const old={...gear('archer','helmet',3,'supreme'),base_stat:6,enhance_level:9},high={...gear('archer','helmet',7),base_stat:13,enhance_level:7,source:'star_ring'};
 assert.equal(itemStat(old,'archer').main,918);assert.equal(oldMain(high,'archer'),490);assert.equal(itemStat(high,'archer').main,1083);
 assert.equal(itemStat({...high,enhance_level:0},'archer').main,583);assert.ok(itemStat({...high,enhance_level:0},'archer').main<918);
 const view=equipmentView({tg_id:'1',base_class:'archer',class_path:'',level:71},high);
 assert.deepEqual({base:view.growth.base,enhancement:view.growth.enhancement},{base:583,enhancement:500});assert.equal(view.stat,view.growth.base+view.growth.enhancement);assert.match(view.expeditionProtection,/25%/);
});

for(const cls of CLASS_KEYS)test(`${cls}: no equipment loses stats, every paid enhancement increment survives, and T1–3 remain exact`,()=>{
 for(const slot of SLOTS)for(let tier=1;tier<=12;tier++)for(const rarity of Object.keys(RARITIES))for(const source of ['shop','star_ring','relic_boss']){
  const e={...gear(cls,slot,tier,rarity),source,grade:source==='relic_boss'?'relic':'normal'},copy=structuredClone(e);let previous=-1,oldPrevious=-1;
  for(let level=0;level<=15;level++){
   const row={...e,enhance_level:level},actual=itemStat(row,cls).main,old=oldMain(row,cls);
   assert.ok(actual>=old,`${slot}/T${tier}/${rarity}/${source}/+${level} lost value`);
   if(level)assert.ok(actual-previous>=old-oldPrevious-1,'rounding aside, an existing enhancement contribution must not shrink');
   if(tier<=3&&source!=='star_ring')assert.equal(actual,old);
   assert.ok(actual>=previous);previous=actual;oldPrevious=old;
  }assert.deepEqual(e,copy,'derived balance never rewrites inventory, roll, enhancement, affixes or binding');
 }
});

for(const cls of CLASS_KEYS)test(`${cls}: weakest T7 expedition +8 beats strongest T3 supreme +9 in every slot while equal-quality unenhanced progression stays monotone`,()=>{
 for(const slot of SLOTS){
  const lower={...gear(cls,slot,3,'supreme',.99999),enhance_level:9},higher={...gear(cls,slot,7,'legendary',0),source:'star_ring',enhance_level:8};
  assert.ok(itemStat(higher,cls).main>itemStat(lower,cls).main,slot);
  let before=0;for(let tier=1;tier<=12;tier++){const e=gear(cls,slot,tier);assert.ok(itemStat(e,cls).main>=before);before=itemStat(e,cls).main;}
 }
});

test('relics remain a separate 25% base/enhancement premium with unique affixes; expedition never stacks twice',()=>{
 for(const cls of CLASS_KEYS)for(const slot of SLOTS)for(const tier of [4,7,12])for(const level of [0,7,15]){
  const normal={...gear(cls,slot,tier),enhance_level:level},relic={...makeGear({id:'r',tgId:'1',cls,slot,kind:slot==='weapon'?GENERAL_WEAPON[cls]:null,tier,forceRarity:'legendary',rng:()=>.5,now:T0,relic:true}),enhance_level:level};
  const n=itemStat(normal,cls),r=itemStat(relic,cls),s=itemStat({...normal,source:'star_ring'},cls);assert.ok(r.main>=n.main*1.25-3,'two existing base/family rounding steps allow at most3points');assert.ok(Math.abs(s.main-n.main*1.25)<2);
  assert.deepEqual(itemStat({...relic,source:'star_ring'},cls),r);assert.ok(relic.affix_json);assert.equal(itemExtras(relic).pct.critPct,itemExtras({...relic,source:'star_ring'}).pct.critPct);
 }
});

test('tier base and source premiums never raise scroll cost, odds, break risk, reroll/affix keys, buyback or maximum enhancement',()=>{
 assert.equal(ENHANCE.max,15);assert.equal(STAR_RING_GEAR.version,1,'do not rerun the one-time tier repair');
 for(const cls of CLASS_KEYS)for(const slot of SLOTS)for(const tier of [1,3,7,12]){
  const e={...gear(cls,slot,tier),enhance_level:7},copy=structuredClone(e),odds=enhanceOdds(e),cost=scrollCost(e),price=gearSellPrice(e);
  itemStat(e,cls);equipmentView({tg_id:'1',base_class:cls,class_path:'',level:120},e);
  assert.deepEqual(e,copy);assert.deepEqual(enhanceOdds(e),odds);assert.equal(scrollCost(e),cost);assert.equal(gearSellPrice(e),price);
 }
});

for(const cls of CLASS_KEYS)test(`${cls}: all twelve tiers retain the published economy denominator, keep old efficiency and cap new growth to10% and total2x`,()=>{
 for(let tier=1;tier<=12;tier++)for(const rarity of ['common','legendary','supreme'])for(const level of [0,4,7,9,15])for(const source of ['shop','star_ring']){
  const c=mkChar({level:tier*10,base_class:cls,class_path:'A1'}),eq=standardSet(cls,c.level).map(e=>({...e,element_tier:rarity,enhance_level:level,source})),old=computeStats(c,eq,c.level,1),std=standardStats(cls,c.class_path,c.level),g0=gearSpeed(old.power/std.power),actual=idleStats(c,eq);
  assert.equal(std.power,computeStats(c,standardSet(cls,c.level),c.level,1).power);assert.ok(actual.g>=g0-1e-12);assert.ok(actual.g<=Math.min(2,g0*1.1)+1e-12);assert.ok(actual.power>=old.power);assert.ok(actual.def>=old.def);
 }
});

test('existing expedition actor snapshots and immutable stage results keep their old combat and exactly-once reward amounts',async t=>{
 const f=await skillExpedition();t.after(f.close);const original=f.state();
 // Deliberately give this in-flight save departure values from before growth v2.
 original.actors=original.actors.map(a=>({...a,atk:Math.min(a.atk,120),def:Math.min(a.def,100)}));
 f.db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(original),f.id);
 const expected=structuredClone(original);for(let i=0;i<6;i++)expected.results.push(Engine.simulateStage(expected,i));
 const end=NOW+Engine.DURATION;await Ring.view(f.env,f.id,f.ids[0],end);assert.deepEqual(f.state().actors,original.actors);assert.deepEqual(f.state().results,expected.results);
 const rows=f.db.prepare('SELECT * FROM rpg_star_ring_rewards WHERE run_id=? ORDER BY char_id,stage').all(f.id);assert.equal(rows.length,30);
 await Ring.view(f.env,f.id,f.ids[0],end+1);await Ring.sweep(f.env,end+60000);assert.deepEqual(f.db.prepare('SELECT * FROM rpg_star_ring_rewards WHERE run_id=? ORDER BY char_id,stage').all(f.id),rows);
 for(const row of rows){const reward=JSON.parse(row.reward_json),actor=expected.actors.find(a=>a.id===row.char_id),base=Engine.stageReward(expected,actor,row.stage,expected.results[row.stage]);assert.equal(reward.exp,base.exp);assert.deepEqual(reward.items,base.items);}
});

for(const kind of ['dungeon','tower'])test(`${kind}: running battle keeps departure stats; new party uses upgraded equipment`,async t=>{
 const f=await skillExpedition({prepare:({db})=>db.prepare('UPDATE rpg_equipment SET tier=7,level_req=61,enhance_level=7').run()});t.after(f.close);
 const id=await shortParty(f,kind),saved=JSON.parse(f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json),before=saved.actors.map(a=>({id:a.id,atk:a.atk,def:a.def,maxHp:a.maxHp,maxMp:a.maxMp}));
 for(const a of saved.actors){const c=f.db.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get(a.id),eq=f.db.prepare('SELECT * FROM rpg_equipment WHERE tg_id=? AND is_equipped>0').all(a.id),st=computeStats(c,eq);assert.equal(a.atk,st.atk);assert.equal(a.def,st.def);assert.ok(st.power>computeStats(c,eq,c.level,1).power);}
 // Backpacks may change mid-expedition; the already running short battle cannot re-snapshot them.
 f.db.prepare('UPDATE rpg_equipment SET tier=7,enhance_level=9 WHERE tg_id=?').run(f.ids[0]);
 await Party.view(f.env,id,f.ids[0],NOW+20000);
 const after=JSON.parse(f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json);
 assert.deepEqual(after.actors.map(a=>({id:a.id,atk:a.atk,def:a.def,maxHp:a.maxHp,maxMp:a.maxMp})),before);
});
