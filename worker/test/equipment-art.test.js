import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { gearOffers } from '../src/game/gear.js';
import { gearArt, cardPhoto, CARD_FRAMES } from '../src/game/share.js';
import names from '../public/gear-names.json' with { type:'json' };
const root=new URL('../public/',import.meta.url);
test('all 294 usable equipment designs share one browser/server mapping and complete cards',()=>{
 const ctx={window:{}};vm.runInNewContext(fs.readFileSync(new URL('gear-names.js',root),'utf8'),ctx);
 assert.equal(JSON.stringify(ctx.window.RpgGearNames),JSON.stringify(names));
 const offers=new Map();for(const cls of ['sword','archer','mage'])for(const branch of ['A','B'])for(const g of gearOffers({base_class:cls,level:120,class_path:branch}))offers.set(g.name,{...g,classReq:cls});
 assert.equal(offers.size,294);assert.equal(Object.keys(names).length,294);
 for(const [name,g]of offers){
  assert.equal(gearArt(g),names[name],name);assert.equal(gearArt({...g,name:'遺物・菁英'+name}),names[name]);
  assert.ok(fs.existsSync(new URL(`art/v2/${names[name]}.webp`,root)),name);
  for(const frame of CARD_FRAMES){const url=cardPhoto({...g,rarity:frame,grade:frame==='relic'?'relic':'normal'});assert.ok(fs.existsSync(new URL(url.slice(1),root)),url);}
 }
 assert.notEqual(cardPhoto({name:'月桂短劍',slot:'weapon',kind:'sword'}),cardPhoto({name:'星穹創世劍',slot:'weapon',kind:'sword'}));
 assert.equal(cardPhoto({slot:'weapon',kind:'crossbow',rarity:'epic'}),'/art/cards/wpn_crossbow_epic.jpg');
});
