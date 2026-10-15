import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const read=file=>fs.readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
function visual(){const requested=[],images=[];let fallback=0;
 const api={draw:()=>fallback++,profile:(name,cls)=>({name,cls}),profiles:{}};
 class Image{constructor(){this.complete=false;this.naturalWidth=0;images.push(this);}set src(value){this.url=value;requested.push(value);}}
 const ctx=vm.createContext({window:{RpgSkillFX:api},Image,Promise});vm.runInContext(read('cinematic-fx.js'),ctx);vm.runInContext(read('hero-lavish-fx.js'),ctx);
 return {api,requested,images,fallback:()=>fallback};
}
const g=new Proxy({canvas:{width:390,height:844},getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}),createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{}});
test('opening the game and previewing class profiles downloads no combat atlas',()=>{
 const s=visual();for(const cls of ['sword','archer','mage'])s.api.profile('profile-only',cls,'A1');assert.equal(s.requested.length,0);
});
test('first actual hero effect loads only its class and keeps the procedural fallback while loading',()=>{
 const s=visual(),p={cls:'sword',kind:'slash',color:'#ffffff'};s.api.draw(g,.4,{x:0,y:0},{x:10,y:0},p);s.api.draw(g,.5,{x:0,y:0},{x:10,y:0},p);
 assert.equal(s.requested.length,1);assert.match(s.requested[0],/sword\.png/);assert.equal(s.fallback(),2);
 const image=s.images.find(i=>i.fxClass==='sword');image.complete=true;image.naturalWidth=2048;image.onload();s.api.draw(g,.4,{x:0,y:0},{x:10,y:0},p);
 assert.equal(s.requested.length,1);assert.equal(s.fallback(),2);
});
test('switching to another hero loads one additional atlas without refetching the previous class',()=>{
 const s=visual();for(const cls of ['sword','mage','sword'])s.api.draw(g,.4,{x:0,y:0},{x:10,y:0},{cls,kind:'unknown',color:'#ffffff'});
 assert.equal(s.requested.length,2);assert.match(s.requested[0],/sword\.png/);assert.match(s.requested[1],/mage\.png/);
});
test('monster effects lazily load their original shared atlas only once',()=>{
 const s=visual(),p=s.api.monsterProfile('roots');s.api.drawMonster(g,.4,{x:10,y:0},{x:0,y:0},p);s.api.drawMonster(g,.5,{x:10,y:0},{x:0,y:0},p);
 assert.equal(s.requested.length,1);assert.match(s.requested[0],/atlas-clean\.png/);
});
test('a failed class atlas activates the original cinematic fallback',()=>{
 const s=visual(),p={cls:'archer',kind:'unknown',color:'#ffffff'};s.api.draw(g,.4,{x:0,y:0},{x:10,y:0},p);const image=s.images.find(i=>i.fxClass==='archer');image.onerror();s.api.draw(g,.5,{x:0,y:0},{x:10,y:0},p);
 assert.equal(s.requested.length,2);assert.match(s.requested[1],/atlas-clean\.png/);
});

function widgets(){let hidden=true,overlay=false,calls=0;const nodes=[],timers=[],events=new Map();
 const doc={hidden:false,getElementById:id=>id==='expedition-overlay'&&overlay?{}:null,querySelectorAll:s=>s==='.skill-widget'?nodes.filter(n=>n.isConnected):[],addEventListener:(type,fn)=>events.set(type,fn),createElement:()=>({dataset:{},isConnected:true,querySelectorAll:()=>[],querySelector:()=>null,closest:()=>hidden?{}:null,append(){},prepend(){}})};
 const view={querySelector:()=>null,append:n=>{if(!nodes.includes(n))nodes.push(n)}};
 const window={RpgExpeditionHost:{characterId:()=>111,skillState:async()=>{calls++;return {character:{baseClass:'sword'},skills:[],special:{learned:[]}};}},addEventListener:(type,fn)=>events.set(type,fn)};
 vm.runInContext(read('special-skill-widgets.js'),vm.createContext({window,document:doc,setInterval:(fn,ms)=>timers.push({fn,ms}),Date,Promise,crypto:{randomUUID:()=>''}}));
 return {mount:()=>window.RpgSkillWidgets.mount(view,'hero',()=>{}),events,timers,nodes,get calls(){return calls;},show:()=>hidden=false,overlay:value=>overlay=value};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('skill widgets defer hidden hero panels and load immediately when the player opens that panel',async()=>{
 const s=widgets();s.mount();await turn();assert.equal(s.calls,0);s.show();s.events.get('click')({target:{closest:()=>({})}});await turn();assert.equal(s.calls,1);assert.equal(s.nodes[0].dataset.ready,'1');
});
test('opening the expedition iframe pauses underlying skill polling and returning resumes it',async()=>{
 const s=widgets();s.show();s.mount();await turn();assert.equal(s.calls,1);s.overlay(true);s.timers.find(t=>t.ms===30000).fn();await turn();assert.equal(s.calls,1);s.overlay(false);s.events.get('elf-skills-refresh')();await turn();assert.equal(s.calls,2);
});
