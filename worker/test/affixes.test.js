import test from 'node:test';
import assert from 'node:assert/strict';
import {affixSlots,rollAffixes,affixCost,affixView,AFFIXES,BRANCH_AFFIXES} from '../src/game/affixes.js';
import {CLASSES,BRANCHES2} from '../src/game/constants.js';
test('higher gear tiers have one to five independently rated affixes',()=>{
 assert.deepEqual([1,3,6,9,12].map(t=>affixSlots({tier:t})),[1,2,3,4,5]);
 for(const cls of ['sword','archer','mage','any'])for(let t=1;t<=12;t++){
  const item={tier:t,class_req:cls};const lines=rollAffixes(item,Math.random);assert.equal(lines.length,affixSlots(item));assert.equal(new Set(lines.map(x=>x.key)).size,lines.length);
  for(const x of lines){assert.ok(!AFFIXES[x.key].classes||cls==='any'||AFFIXES[x.key].classes.includes(cls));assert.ok(x.score>=0&&x.score<=100);}
 }
});
test('locked lines retain exact values and higher lock counts charge more',()=>{
 const item={tier:12,class_req:'mage'};item.affixes_json=JSON.stringify(rollAffixes(item,()=>.9));const before=JSON.parse(item.affixes_json);
 const after=rollAffixes(item,()=>.1,[1,3]);assert.deepEqual(after[1],before[1]);assert.deepEqual(after[3],before[3]);
 let last=0;for(let n=0;n<5;n++){const cost=affixCost(item,Array.from({length:n},(_,i)=>i));assert.ok(cost.scrolls+cost.fee>last);last=cost.scrolls+cost.fee;}
 assert.throws(()=>rollAffixes(item,Math.random,[0,1,2,3,4]),/至少/);assert.throws(()=>affixCost(item,[-1]),/已存在/);
});
test('all twelve real branches have relevant recommendations; quality reflects roll position',()=>{
 for(const cls of Object.keys(CLASSES))for(const a of ['A','B'])for(const b of ['1','2']){assert.ok(BRANCHES2[cls][a][b]);assert.equal(BRANCH_AFFIXES[cls][a+b].length,3);}
 const item={tier:12,class_req:'sword',affixes_json:JSON.stringify([{key:'meleePct',value:.03,score:100}])};const v=affixView(item,'A211');assert.equal(v.quality,'SS');assert.equal(v.lines[0].recommended,true);assert.equal(v.slots,5);
});
import * as P from '../src/services/player.js';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {loadPlayer} from '../src/db.js';
import {computeStats} from '../src/game/stats.js';
import {validateCast,SKILL_MAP,performSkill,receiveDamage} from '../src/game/special.js';
test('reroll persists locked values and charges fee plus missing scrolls exactly once',async()=>{
 const env={DB:freshDb()};await P.createCharacter(env,{tgId:'919',name:'重鑄者',gender:'m',baseClass:'mage'},T0);await env.DB.prepare('UPDATE rpg_characters SET gold=100000 WHERE tg_id=?').bind('919').run();let p=await loadPlayer(env.DB,'919');const item=p.equipment.find(x=>x.slot==='weapon');await env.DB.prepare('UPDATE rpg_equipment SET tier=12,affixes_json=? WHERE id=?').bind(JSON.stringify(rollAffixes({...item,tier:12},()=>.9)),item.id).run();p=await loadPlayer(env.DB,'919');const before=p.equipment.find(x=>x.id===item.id);const locks=[0,2];const cost=affixCost(before,locks),gold=cost.fee+cost.scrolls*60;const run=()=>P.withPlayer(env,'919',T0,(w,c)=>P.doReroll(w,c,{itemId:item.id,locks,requestId:'once-reroll'},()=>.1));await run();const after=await loadPlayer(env.DB,'919');assert.equal(after.char.gold,100000-gold);assert.deepEqual(JSON.parse(after.equipment.find(x=>x.id===item.id).affixes_json)[0],JSON.parse(before.affixes_json)[0]);assert.equal(after.inv.scroll_r||0,0);await assert.rejects(run);assert.equal((await loadPlayer(env.DB,'919')).char.gold,100000-gold);
});
test('damage type applies to its class; affix caps prevent unlimited stat stacking',()=>{
 const c={base_class:'mage',class_path:'B1',level:60};const base=computeStats(c,[]);const gear={slot:'ring',tier:12,base_stat:0,is_equipped:1,element_tier:'common',affixes_json:JSON.stringify([{key:'magicPct',value:.03,score:90}])};const plain=computeStats(c,[{...gear,affixes_json:'[]'}]);assert.ok(plain.atk>base.atk,'T12 ring has its own tier-based ATK');assert.ok(computeStats(c,[gear]).atk>plain.atk);const wrong={...gear,affixes_json:JSON.stringify([{key:'rangedPct',value:.03,score:90}])};assert.equal(computeStats(c,[wrong]).atk,plain.atk);assert.equal(computeStats(c,Array(30).fill(gear)).pct.magicPct,.45);
});
test('special affixes reduce real MP and cooldown and improve shields and DOT',()=>{
 const skill=SKILL_MAP.skill_01_1;const x={learned:[skill.id],loadout:[skill.id],cooldowns:{}};const cast=validateCast({base_class:'sword',class_path:'A',level:30,mp:999,affixPct:{mpEfficiencyPct:.3,skillHastePct:.25}},x,skill.id,T0);assert.ok(cast.mp<skill.mp);assert.ok(cast.cooldownSeconds<skill.cooldownSeconds);
 const a={id:'a',atk:100,def:0,maxHp:1000,hp:1000,maxMp:100,mp:100,special:x,buffs:[],affixPct:{shieldPct:.3,mitigationPct:.2}};const enemy={hp:10000,maxHp:10000,def:0,buffs:[],dots:[]};performSkill(a,[a],enemy,SKILL_MAP.skill_02_3,'a',T0,()=>1,{});assert.ok(a.buffs.find(x=>x.type==='shield').value>160);a.buffs=[];assert.equal(receiveDamage(a,100,[a],enemy,T0),80);
});
test('summon and trap affixes strengthen the actual matching branch attack',()=>{for(const [cls,path,key] of [['archer','B1','summonPct'],['mage','B2','summonPct'],['archer','B2','dotPct']]){const c={base_class:cls,class_path:path,level:60};const base=computeStats(c,[]);const gear={slot:'ring',tier:12,base_stat:0,is_equipped:1,element_tier:'common',affixes_json:JSON.stringify([{key,value:.1,score:100}])};assert.ok(computeStats(c,[gear]).skill.mult>base.skill.mult);}});
