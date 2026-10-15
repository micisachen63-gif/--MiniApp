import fs from 'node:fs/promises';
import vm from 'node:vm';
import {MONSTER_DATA} from '../src/game/monster-data.js';

// Reuse the actual client router; never substitute historical hero/monster paths.
const app=await fs.readFile('public/app.js','utf8');
const context=vm.createContext({window:{},HEROES:{nodes:new Set(),meta:{}},HERO_DISPLAY:{}});
for(const file of ['monster-catalog.js','monster-expansion-catalog.js','monster-expansion.js'])
  vm.runInContext(await fs.readFile('public/'+file,'utf8'),context);
const tables=app.slice(app.indexOf('  const MON ='),app.indexOf('  // Attack sheets'));
const animations=app.slice(app.indexOf('  const HERO_ANIM ='),app.indexOf('  const WPN ='));
const route=app.slice(app.indexOf('  function artFile('),app.indexOf('  const IMG ='));
vm.runInContext('const V2=true,MODE="v2",SINGLE_ELF4=/^adv4_archer_(A11[12]|A12[12]|A21[12])_[fm]$/;'+tables+animations+route+';this.route=artFile;',context);
const items=[];
for(const monster of MONSTER_DATA){
  const meta=context.window.RpgMonsterExpansion.spec(monster.spriteKey);
  const kind=monster.role==='boss'?'boss':monster.role==='elite'?'elite':'monster';
  const lookup=kind==='boss'&&!meta?monster.mapId:monster.name;
  const src=context.route(kind,lookup),sheet=context.route(kind+'Anim',lookup);
  if(!src||!sheet)throw Error('Missing client route: '+monster.name);
  await fs.access('public/'+src.split('?')[0]);
  await fs.access('public/'+sheet.split('?')[0]);
  items.push({...meta,map:monster.mapId,name:monster.name,role:monster.role,key:monster.spriteKey,spell:monster.spell,ready:true,src,sheet});
}
await fs.writeFile('public/monster-expansion-review-data.json',JSON.stringify({target:180,items})+'\n');
console.log('Current client routes verified for '+items.length+' monsters across 12 maps.');
