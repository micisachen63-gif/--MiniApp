import test from 'node:test';
import assert from 'node:assert/strict';
import { gachaOffers, drawGacha, GACHA_RATES } from '../src/game/shop.js';
import { buyGacha, openGacha } from '../src/services/player.js';
import { canEquip } from '../src/game/gear.js';
import { mapForLevel } from '../src/game/formulas.js';
import { MAX_OPEN_MAP } from '../src/game/constants.js';
const char=(cls,path,level,gold=1000000)=>({tg_id:'123456789',base_class:cls,class_path:path,level,gold});
function randomSequence(...seq){let i=0;return ()=>seq[(i++)%seq.length]}
const makeWork=c=>({char:{...c},inv:{},equipment:[]});
test('轉蛋品質機率合計 100%，最高可得霸主但不含遺物',()=>{assert.equal(GACHA_RATES.reduce((s,x)=>s+x[1],0),100);assert.deepEqual(GACHA_RATES.map(x=>x[0]),['legendary','supreme']);});
for(const cls of ['sword','archer','mage'])for(const [path,level] of [['',1],['A',30],['B',60],['A1',120]])for(const type of ['weapon','armor'])test(`${cls} ${path||'未轉職'} Lv${level} ${type} 可用且正確扣款`,()=>{
 const c=char(cls,path,level),w=makeWork(c),offers=gachaOffers(c),o=offers.find(x=>x.type===type);
 assert.equal(o.price,type==='weapon'?10000:5000);assert.equal(o.tier,Math.min(mapForLevel(level),MAX_OPEN_MAP));
 const before=w.char.gold;buyGacha(w,{now:Date.now()},{type,requestId:'buy'});assert.equal(w.equipment.length,0);assert.equal(w.inv['gacha_'+type],1);const result=openGacha(w,{now:Date.now()},{type,requestId:'gacha_test_'+cls+path+level+type},randomSequence(.99,.98,.5,.6,.7,.8));
 assert.equal(w.equipment.length,1);assert.equal(w.char.gold,before-o.price);assert.equal(w.inv['gacha_'+type],0);
 assert.equal(result.ledger.length,1);assert.equal(result.ledger[0].item_delta,-1);assert.equal(result.ledger[0].gold_delta,undefined);
 assert.equal(result.result.item.tier,o.tier);assert.equal(result.result.item.element_tier,'supreme');
 assert.equal(canEquip(w.char,result.result.item),null);assert.notEqual(result.result.item.grade,'relic');
 if(type==='weapon')assert.equal(result.result.item.slot,'weapon');else assert.ok(['armor','helmet','gloves','boots','belt','undershirt'].includes(result.result.item.slot));
});
test('紫色保底與紅色機率邊界',()=>{for(const [v,r] of [[0,'legendary'],[.84999,'legendary'],[.85,'supreme'],[.99999,'supreme']])assert.equal(drawGacha(char('mage','A',30),'weapon',randomSequence(0,v)).rarity,r);});
test('金幣不足不可扣款或發裝',()=>{const w=makeWork(char('sword','',1,0));assert.throws(()=>buyGacha(w,{now:Date.now()},{type:'weapon',requestId:'no_gold'},randomSequence(0)),/金幣不足/);assert.equal(w.char.gold,0);assert.equal(w.equipment.length,0);});
test('非法類型不可扣款或發裝',()=>{const w=makeWork(char('mage','',1));assert.throws(()=>buyGacha(w,{now:Date.now()},{type:'relic',requestId:'invalid'},randomSequence(0)),/轉蛋類型無效/);assert.equal(w.equipment.length,0);});
test('開啟時以目前等級階段及所有職業路線檢查可穿戴，包含換階邊界',()=>{
 for(const cls of ['sword','archer','mage'])for(const path of ['','A','B','A1','A2','B1','B2'])for(const level of [1,10,11,20,21,30,31,60,61,90,91,110,111,120]){
  if(level<path.length*30)continue;
  for(const type of ['weapon','armor'])for(const roll of [0,.999]){
   const w=makeWork(char(cls,path,level));w.inv['gacha_'+type]=1;const before=w.char.gold;
   const {result}=openGacha(w,{now:Date.now()},{type,requestId:'boundary'},randomSequence(roll,.9,.5,.6,.7,.8));
   assert.equal(result.item.tier,Math.min(mapForLevel(level),MAX_OPEN_MAP),`${cls} ${path} Lv${level}`);
   assert.equal(canEquip(w.char,result.item),null);assert.equal(w.char.gold,before);assert.equal(w.inv['gacha_'+type],0);
  }
 }
});
