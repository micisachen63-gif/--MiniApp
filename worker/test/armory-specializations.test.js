import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {lineageNodes} from '../src/game/lineage.js';
const read=f=>fs.readFileSync(new URL('../public/'+f,import.meta.url),'utf8');
const window={};vm.runInNewContext(read('armory-specializations.js'),{window});
vm.runInNewContext(read('hero-fx.js'),{window,document:{addEventListener(){}}});
const catalogue=window.RpgArmorySpecializations,rows=Object.values(catalogue.entries);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');

test('all 96 third and fourth jobs resolve by exact identity, with authoritative names and no prefix inheritance',()=>{
 assert.equal(rows.length,96);
 for(const cls of ['sword','archer','mage','thief']) {
  const nodes=lineageNodes(cls).filter(n=>n.tier>=3);assert.equal(nodes.length,24);
  for(const node of nodes)for(const gender of ['m','f']) {
   const p=window.RpgHeroEffects.profile({baseClass:cls,classPath:node.path,classTier:node.tier,gender});
   assert.equal(p.id,cls+'-'+node.path);assert.equal(p.name,node.name);assert.equal(p.skill,node.skill.name);
   assert.equal(p.advanced,true);assert.equal(p.mirror,gender==='m');assert.equal(p.tier,node.tier);
   assert.ok(p.art.includes('/'+p.id+'.svg'));assert.ok(p.particleArt.includes('/'+p.id+'-particle.svg'));
   assert.ok(p.brief&&p.primary!==p.secondary&&p.motion&&p.layout);
   if(node.tier===4) {
    const parent=catalogue.resolve(cls,node.path.slice(0,-1));
    assert.notEqual(p.art,parent.art);assert.notEqual(p.geometryKey,parent.geometryKey);assert.notEqual(p.cadence,parent.cadence);
    const sibling=catalogue.resolve(cls,node.path.slice(0,-1)+(node.path.endsWith('1')?'2':'1'));
    assert.notEqual(p.geometryKey,sibling.geometryKey);
   }
  }
 }
 for(const bad of ['','A','A1','A1111','a111','__proto__','B999','A111?x'])assert.equal(catalogue.resolve('sword',bad),null);
 assert.equal(catalogue.resolve('unknown','A111'),null);
});

test('every job has distinct geometry after colors and text are removed; all 192 transparent vectors match the catalogue hashes',()=>{
 const structural=new Set(),motions=new Set();
 for(const row of rows) {
  const art=read(row.art),particle=read(row.particleArt);
  assert.equal(sha(art),row.artSHA256);assert.equal(sha(particle),row.particleSHA256);
  assert.match(art,/viewBox="0 0 400 600" fill="none"/);
  for(const svg of [art,particle])assert.doesNotMatch(svg,/<image|<script|<foreignObject|href="(?:https?:|data:)/);
  const geometry=art.replace(/<title>.*?<\/title>/g,'').replace(/#[0-9a-f]{6}/gi,'#COLOR');
  assert.ok(!structural.has(geometry),'Merely recolored '+row.id);structural.add(geometry);
  motions.add([row.motion,row.cadence,row.phase].join(':'));
 }
 assert.equal(structural.size,96);assert.equal(motions.size,96);
});

test('every prescribed motion has real keyframes and safe pause/reduced-motion CSS, and catalogue loads before mounting',()=>{
 const css=read('hero-fx.css'),html=read('index.html');
 for(const row of rows)assert.ok(css.includes('@keyframes armory-'+row.motion),row.motion);
 assert.match(css,/\[data-advanced-armory-fx\]\[data-fx-running="false"\]/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\).*\[data-advanced-armory-fx\]/);
 assert.ok(html.indexOf('src="armory-specializations.js')<html.indexOf('src="hero-fx.js'));
 assert.ok(Object.isFrozen(catalogue.entries)&&rows.every(Object.isFrozen));
});
