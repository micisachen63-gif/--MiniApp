import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_MODES,modeForLevel,localCycleLevel,stampMode,itemMode} from '../src/game/endgame.js';
import {MAX_LEVEL} from '../src/game/constants.js';
import {mapForLevel,expToNext} from '../src/game/formulas.js';
import {applyExp,gateLevel} from '../src/game/idle.js';
import {getAtlasCatalog,getAtlasMap} from '../src/game/atlas-catalog.js';
import {createAtlasRun,advanceAtlasRun} from '../src/game/atlas-engine.js';
import {AWAKENINGS} from '../src/game/awakening.js';
import {enhanceOdds} from '../src/game/enhance.js';
import {applyEquipmentAbilityPatch} from '../src/realm/asset-preservation.js';
import {withPlayer,createCharacter} from '../src/services/player.js';
import {openGacha} from '../src/services/player.js';
import {canEquip} from '../src/game/gear.js';
import {loadPlayer} from '../src/db.js';
import {freshDb} from './d1-shim.js';

test('five cumulative cycles have exact 120-level boundaries, ten-level maps and no extra advancement gates',()=>{
 assert.equal(MAX_LEVEL,600);
 for(const level of [1,120,121,240,241,360,361,480,481,600]){
  assert.equal(modeForLevel(level).index,Math.floor((level-1)/120));assert.equal(mapForLevel(level),Math.ceil(localCycleLevel(level)/10));
  assert.equal(gateLevel({level,class_path:'A111'}),600);
 }
 assert.equal(gateLevel({level:120,class_path:'A11'}),120);
 assert.equal(expToNext(600),Infinity);assert.ok(Number.isFinite(expToNext(120)));
 const c={level:120,progression_level:null,class_path:'A111',exp:expToNext(120)+1};applyExp(c,()=>({maxHp:100,maxMp:80}));assert.equal(c.level,121);assert.equal(c.exp,1);
});
test('60 cycle maps cover all levels, carry approved art/monster identities, and preserve original maps',()=>{
 const catalog=getAtlasCatalog(),maps=catalog.maps.filter(m=>m.progression);assert.equal(maps.length,60);assert.equal(catalog.maps.length,67);
 for(const mode of WORLD_MODES){const set=maps.filter(m=>m.progression.mode===mode.id);assert.equal(set.length,12);for(let n=0;n<12;n++){assert.equal(set[n].minLevel,mode.minLevel+n*10);assert.equal(set[n].dropTier,n+1);assert.ok(set[n].art.background);assert.ok(set[n].enemyRoster.every(e=>e.id&&e.sourceMap));}}
 assert.equal(getAtlasMap('laurel_intro').enemy.hp,65);
});
test('new mode gear fixes source mode and halves only base odds while legacy +N and scroll effects survive',()=>{
 const old={id:'old',slot:'weapon',tier:12,name:'原武器',level_req:111,base_stat:100,element_stat:20,bonus_json:'{}',enhance_level:8};
 for(const mode of WORLD_MODES){const item=stampMode({...old},mode.id);assert.equal(itemMode(item).id,mode.id);assert.equal(item.enhance_level,8);assert.equal(enhanceOdds(item).success,enhanceOdds(old).success*2**-mode.index);assert.equal(enhanceOdds(item,true).success,enhanceOdds(old).success*2**-mode.index+.1);assert.equal(enhanceOdds(item,false,true).success,1);if(mode.index)assert.throws(()=>applyEquipmentAbilityPatch(item,{bonus_json:'{}'}),{code:'asset_preservation'});}
 assert.equal(old.name,'原武器');assert.equal(old.bonus_json,'{}');
});
function runFor(skill){return createAtlasRun({runId:'awakening-'+skill.id,realmId:'permanent',startedAt:0,seed:'coverage',mapId:`cycle_${skill.mode}_01`,buildId:({sword:'sword_whirlwind',archer:'archer_pierce',mage:'mage_chain',thief:'thief_poison'})[skill.baseClass],supports:[],automation:'burst',durationSeconds:240,mapCount:20,snapshot:{characterId:'test',baseClass:skill.baseClass,level:skill.unlockLevel,atk:700,def:400,maxHp:100000,maxMp:4000},supplies:{hp:50,mp:50}});}
for(const skill of AWAKENINGS)test(`${skill.id}: real casts spend mana, obey cooldown and yield the same offline partition state`,()=>{
 let run=runFor(skill);run.map.enemy.hp=500000;run.map.elite.hp=1000000;
 const full=advanceAtlasRun(run,240,{combatTrace:{limit:256}});const casts=full.combatTrace.events.filter(e=>e.skillId===skill.id&&e.type==='skill_cast');assert.ok(casts.length>0);assert.ok(casts.every(e=>e.mpSpent>0&&e.mpAfter<=e.mpBefore-e.mpSpent));for(let i=1;i<casts.length;i++)assert.ok(casts[i].atMs-casts[i-1].atMs>=skill.cooldown*1000-1000);
 assert.ok(full.state.awakening.damage>0);let split=run;for(const now of [13,37,79,121,167,240])split=advanceAtlasRun(JSON.parse(JSON.stringify(split)),now,{maxSteps:2000}).state;assert.deepEqual(split,full.state);
});
test('insufficient mana falls back to basic attacks instead of blocking future actions',()=>{let r=runFor(AWAKENINGS[0]);r.snapshot.maxMp=1;r.hero.mp=0;r.snapshot.mpRegenPerSecond=0;const done=advanceAtlasRun(r,100);assert.equal(done.state.awakening.casts,0);assert.ok(done.state.metrics.basicAttacks>0);});
test('600-level persistence is additive and leaves legacy physical level CHECK and +N assets intact',async t=>{
 const DB=freshDb();t.after(()=>DB.sqlite.close());const env={DB};await createCharacter(env,{tgId:'98101',name:'成長測試',gender:'m',baseClass:'sword'},1);
 DB.sqlite.prepare("UPDATE rpg_characters SET class_path='A111',level=120 WHERE tg_id=?").run('98101');DB.sqlite.prepare('UPDATE rpg_equipment SET enhance_level=11 WHERE tg_id=?').run('98101');
 await withPlayer(env,'98101',1,async work=>{work.char.exp=expToNext(120);applyExp(work.char,()=>({maxHp:100,maxMp:100}));});
 const loaded=await loadPlayer(DB,'98101');assert.equal(loaded.char.level,121);assert.equal(DB.sqlite.prepare('SELECT level FROM rpg_characters WHERE tg_id=?').get('98101').level,120);assert.ok(loaded.equipment.every(e=>e.enhance_level===11));
});
for(const base of ['sword','archer','mage','thief'])test(`${base}: capsules opened in all five cycles use the opening level, usable class and immutable mode`,()=>{
 for(const mode of WORLD_MODES)for(const type of ['armor','weapon']){
  const char={tg_id:'gacha-test',base_class:base,class_path:'A111',level:mode.minLevel+30},work={char,inv:{['gacha_'+type]:1},equipment:[]};
  const result=openGacha(work,{now:1,db:null},{type,requestId:crypto.randomUUID()},()=>.5);const item=result.result.item;assert.equal(canEquip(char,item),null);assert.equal(itemMode(item).id,mode.id);assert.ok(item.level_req<=char.level);assert.equal(work.inv['gacha_'+type],0);if(mode.index)assert.ok(item.name.endsWith('-'+mode.name));
 }
});
