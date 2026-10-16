import test from 'node:test';
import assert from 'node:assert/strict';
import {autoBluePct,needsBlue,blueTarget} from '../src/game/auto-blue.js';
import {settings} from '../src/services/player.js';
import {settleIdle} from '../src/game/idle.js';
import {idleStats} from '../src/game/stats.js';
import {mkChar,starterGear,T0} from './helpers.js';
test('blue threshold defaults and validates legacy preferences',()=>{
 for(const special_json of [null,'bad','{}','{"autoBluePct":900}'])assert.equal(autoBluePct({special_json}),50);
 const c={auto_blue:1,special_json:'{"autoBluePct":70}'};
 assert.equal(needsBlue(c,70,100,10),true);assert.equal(needsBlue(c,71,100,10),false);
 assert.equal(needsBlue(c,75,100,80),true);assert.equal(blueTarget(c,100,80),80);
 assert.equal(needsBlue({...c,auto_blue:0},0,100,80),false);
 assert.equal(needsBlue(c,100,100,200),false);
});
test('settings persist per character without losing skills or guardian preferences',()=>{
 const char=mkChar({special_json:JSON.stringify({learned:['skill_1'],guardianStoneSupply:true})});
 const work={char,inv:{},equipment:starterGear(char)};
 assert.equal(settings(work,{}, {autoBluePct:70}).result.autoBluePct,70);
 assert.deepEqual(JSON.parse(char.special_json),{learned:['skill_1'],guardianStoneSupply:true,autoBluePct:70});
 assert.throws(()=>settings(work,{}, {autoBluePct:81}));
 assert.equal(autoBluePct(char),70);
});
test('idle drinks before native skill at threshold even with enough MP to cast',()=>{
 const c=mkChar({level:15,mp:1,special_json:'{"autoBluePct":70}'}),eq=starterGear(c),s=idleStats(c,eq);
 c.mp=Math.floor(s.maxMp*.6);assert.ok(c.mp>=s.skill.cost);
 const r=settleIdle(c,{blue_1:100,red_1:100},eq,T0+60000);
 assert.ok(r.report.used.blue_1>0);
 const off=settleIdle({...c,auto_blue:0},{blue_1:100,red_1:100},eq,T0+60000);
 assert.equal(off.report.used.blue_1,undefined);
});
