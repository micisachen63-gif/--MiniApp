import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ELF_FUTURE, elfFutureChoices } from '../src/game/elf-future.js';
import { CLASSES, MAX_OPEN_CLASS_TIER } from '../src/game/constants.js';
import { nodeFor } from '../src/game/stats.js';
import { advance } from '../src/game/classes.js';
const root='public/art/elf/';
const tree=JSON.parse(fs.readFileSync('public/art/v2/elf-progression.json','utf8'));
const stages=tree.stages;
test('妖精職業保留既有角色 ID，並保留已開放的一二轉路線',()=>{
 assert.equal(CLASSES.archer.key,'archer');assert.equal(CLASSES.archer.name,'妖精');
 for(const path of ['','A','B','A1','A2','B1','B2'])assert.ok(nodeFor('archer',path).name);
});
test('三轉與四轉有完整的 8／16 種獨立職業和兩路選擇',()=>{
 assert.equal(stages[3].variants.length,8);assert.equal(stages[4].variants.length,16);
 for(const p of ['A1','A2','B1','B2',...stages[3].variants.map(v=>v.path)]){
  const children=elfFutureChoices(p);assert.equal(children.length,2,p);assert.notEqual(children[0].name,children[1].name);
  for(const n of children){assert.equal(n.parent,p);assert.ok(n.skill.cost>0);assert.ok(n.skill.mult>0);assert.ok(n.passive.text);assert.equal(n.opened,false)}
 }
 assert.equal(Object.keys(ELF_FUTURE).length,24);
});
test('全部 62 組男女職業擁有完整 SVG 肖像和 5×2 PNG 攻擊影格',()=>{
 const paths=stages.flatMap(s=>s.variants.map(v=>({path:v.path,tier:s.tier})));
 assert.equal(paths.length,31);
 for(const {path,tier} of paths)for(const g of ['f','m']){
  const key=(tier?`adv${tier}_archer_${path}_${g}`:`archer_${g}`);
  for(const prefix of ['hero','portrait'])assert.ok(fs.statSync(root+prefix+'_'+key+'.svg').size>1000,key);
  const png=fs.readFileSync(root+'hero_'+key+'_attack.png');
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a',key);
  assert.equal(png.readUInt32BE(16),2000,key);assert.equal(png.readUInt32BE(20),920,key);
 }
});
test('三四轉已開放但舊首領材料不能代替真人試煉證明',()=>{
 assert.equal(MAX_OPEN_CLASS_TIER,4);
 const char={base_class:'archer',class_path:'A1',level:120};const inv={mat_3:1,mat_4:1};
 assert.throws(()=>advance(char,inv,'1'),e=>e.code==='material');
 assert.equal(char.class_path,'A1');assert.equal(inv.mat_3,1);
});