import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {MAPS} from '../src/game/constants.js';
const root=new URL('../public/',import.meta.url),art=JSON.parse(fs.readFileSync(new URL('scene-library-art.json',root),'utf8'));
test('original map guide resolves every exact monster, elite and boss to an existing image',()=>{
 let count=0;for(const map of Object.values(MAPS)){
  assert.ok(fs.existsSync(new URL('art/v2/bg_myth'+String(map.id).padStart(2,'0')+'.webp',root)));
  for(const monster of [...map.normalPool,...map.elitePool,...map.bossPool]){
   const key=map.id+':'+monster.name,entry=art[key];assert.ok(entry,key+' missing original art');assert.match(entry.src,/^\/art\/[a-zA-Z0-9_./-]+$/);assert.ok(!entry.src.includes('..'));assert.ok(fs.existsSync(new URL(entry.src.slice(1),root)),entry.src);assert.ok([1,4].includes(entry.cols));assert.ok([1,4].includes(entry.rows));count++;
  }
 }assert.equal(count,180);
});
