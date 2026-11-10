import test from 'node:test';import assert from 'node:assert/strict';
import {makeGear} from '../src/game/gear.js';import {stampMode} from '../src/game/endgame.js';
import {equipmentView} from '../src/views.js';import {T0} from './helpers.js';
import fs from 'node:fs';

const char={tg_id:'1',base_class:'sword',class_path:'',level:481};
const base=()=>makeGear({id:'g',tgId:'1',cls:'sword',slot:'weapon',kind:'sword',tier:1,forceRarity:'epic',rng:()=>.5,now:T0});
test('equipment view carries the creation world mode for the classic-style item stats (display only)',()=>{
  const normal=equipmentView(char,base());
  assert.equal(normal.mode,'normal');assert.equal(normal.modeName,'普通');
  const hell=equipmentView(char,stampMode(base(),'hell'));
  assert.equal(hell.mode,'hell');assert.equal(hell.modeName,'地獄');assert.match(hell.name,/-地獄$/);
  for(const key of ['statName','stat','elementName','elemStat','extras','pct','affixes','enhanceNext','enhanceGrowth','towerImprint','levelReq','tradeBlock','bound'])assert.ok(key in normal,key);
});
test('direct-trade eligible candidates carry a display-only stat summary',()=>{
  const src=fs.readFileSync(new URL('../src/services/direct-trade-eligible.js',import.meta.url),'utf8');
  assert.match(src,/enhance:Number\(e\.enhance_level\)\|\|0,\.\.\.gearSummary\(e\)\}\);/);
  assert.match(src,/function gearSummary\(e\)\{\s*try\{/);
});
