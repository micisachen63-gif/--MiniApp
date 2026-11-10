import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {ITEMS} from '../src/game/constants.js';
import {ATLAS_MATERIALS} from '../src/game/atlas-catalog.js';
import {itemIconSrc} from '../src/game/item-art.js';
import {shopView} from '../src/views.js';
const file=src=>new URL('../public'+src,import.meta.url);
const hash=src=>createHash('sha256').update(fs.readFileSync(file(src))).digest('hex');
test('all real inventory definitions and Atlas materials resolve to existing painted assets',()=>{
  for(const id of [...Object.keys(ITEMS),...ATLAS_MATERIALS.map(m=>m.id),'recovery_dust']){
    const src=itemIconSrc(id);assert.ok(src,id);assert.ok(fs.existsSync(file(src)),id);assert.ok(fs.statSync(file(src)).size>500,id);
  }
  for(const id of ['../red_1','book_../../secret','hunt_13_1','unknown',null])assert.equal(itemIconSrc(id),null);
});
test('original potion tiers, blessed scrolls and two gacha types retain their specific published art',()=>{
  const potions=['red','blue'].flatMap(k=>[1,2,3,4].map(t=>itemIconSrc(k+'_'+t)));
  assert.equal(new Set(potions.map(hash)).size,8);
  assert.equal(itemIconSrc('gacha_armor'),'/art/ui/gacha-armor-blue-20261015.webp');
  assert.notEqual(hash(itemIconSrc('gacha_weapon')),hash(itemIconSrc('gacha_armor')));
  for(const k of ['w','a']){assert.equal(itemIconSrc('scroll_'+k),'/art/items-scrolls-cutout-20261011/scroll_'+k+'.webp');assert.notEqual(hash(itemIconSrc('scroll_'+k)),hash(itemIconSrc('blessed_scroll_'+k)));}
});
test('new materials and proof icons are nine distinct high-resolution alpha PNG assets',()=>{
  const ids=[...ATLAS_MATERIALS.map(m=>m.id),'recovery_dust','relic_fragment','trial_3','trial_4'];
  assert.equal(new Set(ids.map(id=>hash(itemIconSrc(id)))).size,9);
  for(const id of ids){const data=fs.readFileSync(file(itemIconSrc(id)));assert.equal(data.readUInt32BE(0),0x89504e47);assert.ok(data.readUInt32BE(16)>=512);assert.ok(data.readUInt32BE(20)>=512);assert.equal(data[25],6,id+' must preserve RGBA');}
});
test('every class shop uses its actual named gear art without changing offers or prices',()=>{
  for(const base_class of ['sword','mage','archer','thief'])for(const class_path of ['A1','B1'])for(const level of [1,120,481]){
    const shop=shopView({base_class,class_path,level});
    for(const offer of shop.gear){assert.ok(offer.iconSrc,offer.name);assert.ok(fs.existsSync(file(offer.iconSrc)),offer.name);assert.ok(offer.price>0);}
  }
});
