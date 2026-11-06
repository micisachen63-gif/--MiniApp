import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { legacyDescriptors, legacyDomGeometry } from '../public/skill-vfx-legacy.mjs';

const source=fs.readFileSync(new URL('../public/expedition/combat-playback.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const members=(hp=[80,60,0],mp=[40,40,40])=>['111','222','333'].map((id,i)=>({id,name:id,hp:hp[i],maxHp:100,mp:mp[i],maxMp:50}));
const snap=(enemyHp,hp,mp,floor=1,max=100)=>({floor,enemyHp,enemyMaxHp:max,enemyName:'敵'+floor,members:members(hp,mp)});
function fixture(sequence=1){
 const before=snap(100,[80,60,0],[40,40,40]),heal=snap(70,[90,75,25],[26,40,40]),counter=snap(65,[70,55,10],[26,40,40]),after=snap(65,[70,55,10],[28,42,42]);
 const turn={id:'p1:1:'+sequence,sequence,round:sequence,floor:1,before,events:[{actorId:'111',skillId:'healing',damage:999,healed:999,targetId:'222',after:heal},{actorId:'boss',hits:[{id:'111',damage:999}],after:counter}],after,final:after};
 const p={id:'p1',rev:sequence,kind:'tower',floor:1,round:sequence+1,roundLimit:40,status:'combat',enemy:{name:'敵1',hp:65,maxHp:100},members:after.members,battleTurn:turn,battleTurns:[turn],battleSync:{latestTurnId:turn.id,hasGap:false}};
 return {p,turn};
}
function setup({legacyFactory=async()=>null,reducedMotion=true,startAction=()=>false}={}){
 const log=[];
 const element=key=>{
  const flags=new Set(),el={key,dataset:{},querySelector:()=>null,style:{setProperty(name,value){this[name]=value;}},classList:{add(...names){names.forEach(n=>flags.add(n));},remove(...names){names.forEach(n=>flags.delete(n));},toggle(name,on){if(on)flags.add(name);else flags.delete(name);}},flags,getBoundingClientRect:()=>({x:0,y:0,width:20,height:30}),remove(){}};
  for(const property of ['textContent','src'])Object.defineProperty(el,property,{get(){return this['_'+property]||'';},set(value){this['_'+property]=value;log.push({key,property,value});}});
  return el;
 };
 const heroes=['111','222','333'].map(id=>{const el=element('hero'+id);el.dataset.memberId=id;return el;});
 const rows=['111','222','333'].map(id=>{const el=element('row'+id);el.dataset.memberId=id;el.hp=element('hp'+id);el.mp=element('mp'+id);el.querySelector=s=>s==='[data-member-hp]'?el.hp:el.mp;return el;});
 const nodes={'.scene-boss':element('boss'),'.scene-bg':element('bg'),'.scene-floor':element('floor'),'.boss-meter .meter i':element('bar'),'.boss-meter small':element('bossHp')};
 const scene=element('scene');scene.isConnected=true;scene.querySelector=s=>nodes[s];scene.querySelectorAll=s=>s==='.scene-hero'?heroes:[];scene.closest=()=>({querySelectorAll:s=>s==='.members [data-member-id]'?rows:s==='[data-member-id]'?[...heroes,...rows]:[]});scene.append=el=>{if(el.className?.startsWith('combat-number'))log.push({key:'number',value:el.textContent});};
 const document={hidden:false,createElement:tag=>element(tag)},ctx=vm.createContext({document,preparePartyArt:()=>{},startRegistryAction:startAction,createLegacyVfxLayer:legacyFactory,legacyDescriptors,legacyDomGeometry,matchMedia:()=>({matches:reducedMotion}),setTimeout:fn=>{queueMicrotask(fn);return 1;},dungeonTheme:p=>({name:'敵'+p.floor,rank:p.floor%5===0?'boss':'normal',background:'floor'+p.floor+'.webp',boss:'boss'+p.floor+'.webp',accent:'#ffeedd'})});
 vm.runInContext(source+'\nthis.h={playCombat,combatView,combatCursor};',ctx);
 return {...ctx.h,scene,nodes,rows,heroes,log,document};
}
test('party playback starts before resolution and damage, healing, 生命值 and 魔力 use authoritative snapshots',async()=>{
 const s=setup(),{p}=fixture(),frame=s.combatView(p);assert.equal(frame.enemy.hp,100);assert.equal(frame.members[0].hp,80);assert.equal(frame.members[0].mp,40);
 await s.playCombat(s.scene,p);
 const numbers=s.log.filter(x=>x.key==='number').map(x=>x.value);assert.deepEqual(numbers,['−30','+10','+15','+25','−5','−20','−20','−15']);assert(!numbers.includes('−999'));assert(!numbers.includes('+999'));
 assert.equal(s.rows[0].hp.textContent,'生命值 70／100');assert.equal(s.rows[0].mp.textContent,'魔力 28／50');assert.equal(s.rows[2].hp.textContent,'生命值 10／100');assert.equal(s.nodes['.boss-meter small'].textContent,'敵1 · 生命值 65／100（65%）');assert.equal(s.nodes['.boss-meter .meter i'].style.width,'65%');assert.equal(s.combatCursor('p1'),p.battleTurn.id);
});
test('polling the same turn never replays its hits; bounded catch-up plays each unseen turn once',async()=>{
 const s=setup(),{p,turn}=fixture();s.combatView(p);await s.playCombat(s.scene,p);const count=s.log.filter(x=>x.key==='number').length;
 await s.playCombat(s.scene,p);assert.equal(s.log.filter(x=>x.key==='number').length,count);
 const next=fixture(2);next.p.battleTurns=[turn,next.turn];s.combatView(next.p);await s.playCombat(s.scene,next.p);assert.equal(s.log.filter(x=>x.key==='number').length,count*2);assert.equal(s.combatCursor('p1'),next.turn.id);
 await s.playCombat(s.scene,next.p);assert.equal(s.log.filter(x=>x.key==='number').length,count*2);
});
test('a defeated floor uses its own image and zero 生命值 before the next enemy appears',async()=>{
 const s=setup(),{p,turn}=fixture();turn.floor=4;turn.round=3;turn.before=snap(100,[80,60,0],[40,40,40],4);turn.events=[{actorId:'111',damage:100,after:snap(0,[80,60,0],[40,40,40],4)}];turn.after=snap(0,[100,80,0],[50,50,40],4);turn.final=snap(1000,[100,80,0],[50,50,40],5,1000);p.floor=5;p.round=1;p.enemy={name:'敵5',hp:1000,maxHp:1000};p.members=turn.final.members;
 const frame=s.combatView(p);assert.equal(frame.floor,4);assert.equal(frame.enemy.name,'敵4');assert.equal(frame.enemy.hp,100);assert.equal(frame.enemy.maxHp,100);
 await s.playCombat(s.scene,p);assert.deepEqual(s.log.filter(x=>x.key==='boss'&&x.property==='src').map(x=>x.value),['/boss4.webp','/boss5.webp']);
 assert(s.log.some(x=>x.key==='bossHp'&&x.value==='敵4 · 生命值 0／100（0%）'));assert.equal(s.nodes['.boss-meter small'].textContent,'敵5 · 生命值 1000／1000（100%）');assert.equal(s.nodes['.scene-floor'].textContent,'第 5 層 · 首領 · 第 1／40 回合');
});
test('a reconnect beyond retained history synchronizes to the latest snapshot without inventing hits',async()=>{
 const s=setup(),{p}=fixture();p.battleSync.hasGap=true;const frame=s.combatView(p);assert.equal(frame.enemy.hp,65);await s.playCombat(s.scene,p);assert.equal(s.log.filter(x=>x.key==='number').length,0);assert.equal(s.scene.dataset.combatSync,'已同步最新戰況');assert.equal(s.combatCursor('p1'),p.battleTurn.id);
});
test('hidden pages settle at the latest snapshot and do not repeat already resolved animations',async()=>{
 const s=setup(),{p}=fixture();s.combatView(p);s.document.hidden=true;await s.playCombat(s.scene,p);assert.equal(s.rows[0].hp.textContent,'生命值 70／100');assert.equal(s.combatCursor('p1'),p.battleTurn.id);s.document.hidden=false;await s.playCombat(s.scene,p);assert.equal(s.log.filter(x=>x.key==='number').length,0);
});
test('a lower revision cannot rewind the displayed battle after a newer turn',async()=>{
 const s=setup(),latest=fixture(2),old=fixture(1);s.combatView(latest.p);await s.playCombat(s.scene,latest.p);old.p.enemy.hp=99;const frame=s.combatView(old.p);assert.equal(frame.enemy.hp,65);const count=s.log.filter(x=>x.key==='number').length;await s.playCombat(s.scene,old.p);assert.equal(s.log.filter(x=>x.key==='number').length,count);assert.equal(s.nodes['.boss-meter small'].textContent,'敵1 · 生命值 65／100（65%）');
});
test('legacy rounds missing mana or enemy identity show the current snapshot safely',async()=>{
 const s=setup(),{p}=fixture();delete p.battleTurn.before.enemyMaxHp;for(const m of p.battleTurn.before.members){delete m.mp;delete m.maxMp;}
 const frame=s.combatView(p);assert.equal(frame.enemy.hp,65);await s.playCombat(s.scene,p);assert.equal(s.log.filter(x=>x.key==='number').length,0);assert.equal(s.combatCursor('p1'),p.battleTurn.id);assert.equal(s.scene.dataset.combatSync,'已同步最新戰況');
});

test('party explicit cast and periodic receipts reach exact actor/recipient DOM geometry once per turn',async()=>{
 const calls=[],prepared=[];let destroyed=0;
 const layer={prepare:async rows=>prepared.push(...rows),timing:()=>({remainingMs:150,impactDelayMs:60}),
  play:async(raw,geometry)=>{calls.push({raw,geometry});return {accepted:true,remainingMs:150,impactDelayMs:60};},destroy:()=>destroyed++};
 const s=setup({legacyFactory:async()=>layer}),{p,turn}=fixture();
 s.heroes.forEach((hero,i)=>hero.getBoundingClientRect=()=>({x:20+i*100,y:150,width:40,height:90}));
 s.nodes['.scene-boss'].getBoundingClientRect=()=>({x:400,y:60,width:80,height:120});
 const cast={schemaVersion:1,source:'committed-combat',eventId:'party:cast',skillId:'special:skill_04_2',kind:'cast',actorId:'111',atMs:1000,targetKind:'ally',targetIds:['222'],presentationMode:'support'};
 const pulse={...cast,eventId:'party:pulse',skillId:'special:skill_18_1',kind:'effect',actorId:'222',targetKind:'enemy',targetIds:['boss'],presentationMode:'impact'};
 turn.events[0].vfx=cast;turn.events[0].vfxEvents=[pulse];
 const before=JSON.stringify(p);await s.playCombat(s.scene,p);await s.playCombat(s.scene,p);
 assert.equal(prepared.length,2);assert.equal(calls.length,2);assert.equal(destroyed,1);
 assert.equal(calls[0].raw,cast);assert.equal(calls[0].geometry.actorId,'111');
 assert.equal(calls[0].geometry.targets.find(t=>t.id==='222').point.x,140);
 assert.equal(calls[1].raw,pulse);assert.equal(calls[1].geometry.actorId,'222');
 assert.equal(calls[1].geometry.targets.find(t=>t.id==='boss').point.x,440);
 assert.equal(JSON.stringify(p),before,'receipts and committed snapshots stay immutable');
});
test('party hidden during VFX preparation admits no stale receipt and destroys the prepared layer',async()=>{
 let played=0,destroyed=0,s;
 const layer={prepare:async()=>{s.document.hidden=true;},play:async()=>{played++;},destroy:()=>destroyed++};
 s=setup({legacyFactory:async()=>layer});const {p,turn}=fixture();turn.events[0].vfx={eventId:'hidden:cast'};
 await s.playCombat(s.scene,p);assert.equal(played,0);assert.equal(destroyed,1);assert.equal(s.combatCursor(p.id),turn.id);
});
