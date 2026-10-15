import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {MONSTER_DATA} from '../src/game/monster-data.js';

test('review covers every current map/monster and resolves both real raster assets',async()=>{
  const data=JSON.parse(await fs.readFile(new URL('../public/monster-expansion-review-data.json',import.meta.url),'utf8'));
  assert.equal(data.items.length,180);
  assert.equal(new Set(data.items.map(m=>m.key)).size,180);
  for(let map=1;map<=12;map++){
    const monsters=data.items.filter(m=>m.map===map);
    assert.deepEqual(['normal','elite','boss'].map(role=>monsters.filter(m=>m.role===role).length),[10,3,2]);
  }
  for(const monster of MONSTER_DATA){
    const entry=data.items.find(m=>m.key===monster.spriteKey);
    assert.equal(entry.name,monster.name);
    assert.equal(entry.spell,monster.spell);
    for(const field of ['src','sheet']){
      assert.match(entry[field],/^art\//);
      assert.ok(!entry[field].includes('..'));
      await fs.access(new URL('../public/'+entry[field].split('?')[0],import.meta.url));
    }
  }
});
