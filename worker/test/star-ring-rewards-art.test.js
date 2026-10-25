import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {COSMETICS} from '../src/game/star-ring-cosmetics.js';
test('all exclusive aura textures, icons and four class gear images match inspected transparent production assets',()=>{
 const root=new URL('../public/art/star-ring-rewards-20261018/',import.meta.url);
 const qa=JSON.parse(readFileSync(new URL('../../docs/art/STAR_RING_REWARDS_ART_20261018.json',import.meta.url),'utf8'));
 const required=COSMETICS.flatMap(c=>['aura-'+c.tone+'.webp',c.icon.split('/').at(-1)]).concat(['gear-weapon.webp','gear-weapon-mage.webp','gear-weapon-archer.webp','gear-weapon-thief.webp','gear-armor.webp','gear-accessory.webp']);
 assert.equal(qa.assets.length,12);
 for(const file of required){const record=qa.assets.find(a=>a.file===file);assert.ok(record,file);const bytes=readFileSync(new URL(file,root));assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);assert.ok(record.transparentPixels>record.width*record.height*.25);assert.ok(record.edgeAlpha<=1);assert.deepEqual([record.width,record.height],file.startsWith('aura-')?[768,384]:file.startsWith('icon-')?[256,256]:[512,512]);}
});
