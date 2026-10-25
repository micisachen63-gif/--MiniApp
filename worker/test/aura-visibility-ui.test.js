import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/star-ring-cosmetics.js',import.meta.url),'utf8');
function fixture(document){
 const frames=new Map(),resizes=[],changes=[];let serial=0;
 const observer=list=>class{constructor(fn){this.fn=fn;this.targets=[];this.closed=false;list.push(this);}observe(n){this.targets.push(n);}disconnect(){this.closed=true;}};
 const ctx=vm.createContext({document,requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:observer(resizes),MutationObserver:observer(changes),getComputedStyle:img=>({objectFit:img.fit||'contain',objectPosition:img.objectPosition||'50% 100%'})});
 vm.runInContext(source,ctx);let rect={left:40,top:20,width:100,height:200};const listeners=new Map(),image={isConnected:true,src:'',naturalWidth:100,naturalHeight:200,getBoundingClientRect:()=>rect,addEventListener:(e,fn)=>listeners.set(e,fn),removeEventListener:e=>listeners.delete(e)},holder={isConnected:true,getBoundingClientRect:()=>({left:0,top:0,width:400,height:400})},node={isConnected:true,style:{}};
 return {ui:ctx.RpgStarRingCosmetics,ctx,image,holder,node,listeners,resizes,changes,frames,setRect:r=>rect=r,tick:()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}};
}
test('visible-body surround uses asymmetric body center, normalized fill and a fixed portrait aspect',()=>{
 const f=fixture(),bounds={left:.2,right:.8,top:.1,bottom:.9,footX:.6};let p=f.ui.placement(f.image,f.holder,{bounds,contain:false});assert.equal(p.left,96.5);assert.equal(p.top,120);assert.ok(Math.abs(p.height-166.4)<1e-8);assert.ok(Math.abs(p.width/p.height-2/3)<1e-9);
 f.image.fit='fill';f.setRect({left:50,top:10,width:200,height:300});p=f.ui.placement(f.image,f.holder,{bounds,contain:false});assert.equal(p.left,163);assert.equal(p.top,160);assert.ok(Math.abs(p.height-249.6)<1e-8);
 f.image.fit='contain';f.setRect({left:0,top:0,width:300,height:200});f.image.objectPosition='left bottom';p=f.ui.placement(f.image,f.holder,{bounds,contain:false});assert.ok(Math.abs(p.left-56.5)<1e-9);assert.equal(p.top,100);
});
const center=node=>({x:parseFloat(node.style.left)+parseFloat(node.style.width)/2,y:parseFloat(node.style.top)+parseFloat(node.style.height)/2});
test('surround tracking follows late loads, portrait normalization and resize with coalesced frames',async()=>{
 const f=fixture(),stop=f.ui.follow(f.node,f.image,f.holder);await Promise.resolve();await Promise.resolve();f.tick();assert.equal(center(f.node).x,90);
 f.setRect({left:80,top:40,width:200,height:300});f.image.fit='fill';f.changes[0].fn();f.resizes[0].fn();stop.refresh();assert.equal(f.frames.size,1);f.tick();assert.equal(center(f.node).x,180);
 f.setRect({left:20,top:30,width:100,height:200});f.listeners.get('load')();await Promise.resolve();await Promise.resolve();f.tick();assert.equal(parseFloat(f.node.style.left),4,'left-edge containment remains after reload');assert.equal(center(f.node).y,130);stop();
});
test('closed or detached portrait tracking cannot repaint or retain observers',async()=>{
 const f=fixture(),stop=f.ui.follow(f.node,f.image,f.holder);f.tick();const old={...f.node.style};f.setRect({left:300,top:300,width:100,height:200});f.image.isConnected=false;f.resizes[0].fn();f.tick();assert.deepEqual(f.node.style,old);
 f.image.isConnected=true;stop.refresh();assert.equal(f.frames.size,1);stop();assert.equal(f.frames.size,0);assert.equal(f.listeners.has('load'),false);assert.ok(f.resizes.every(x=>x.closed));assert.ok(f.changes.every(x=>x.closed));await Promise.resolve();await Promise.resolve();stop.refresh();assert.equal(f.frames.size,0);assert.deepEqual(f.node.style,old);
});
test('surround pauses on hidden pages, resumes on return and releases its visibility listener on cleanup',()=>{
 const events=new Map(),document={hidden:false,addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key)},f=fixture(document),flags=new Map();f.node.toggleAttribute=(key,on)=>flags.set(key,on);const stop=f.ui.follow(f.node,f.image,f.holder);assert.equal(flags.get('data-fx-paused'),false);document.hidden=true;events.get('visibilitychange')();assert.equal(flags.get('data-fx-paused'),true);document.hidden=false;events.get('visibilitychange')();assert.equal(flags.get('data-fx-paused'),false);stop();assert.equal(events.size,0);
});
test('hall actor mounting reuses rendered aura and cleans up exactly once without duplicate graphics',()=>{
 const f=fixture();let inserts=0,removed=0;f.node.remove=()=>removed++;const actor={...f.holder,dataset:{memberId:'hero1'},matches:()=>false,querySelector:s=>s==='img'?f.image:f.node,insertAdjacentHTML:()=>inserts++},scene={...f.holder,querySelectorAll:()=>[actor]};
 const stop=f.ui.mountActors(scene,[{id:'hero1',aura:{id:'star_ring_aura_dawn'}}],'.hall-portrait');f.tick();assert.equal(inserts,0);assert.equal(center(f.node).x,90);stop();stop();assert.equal(removed,1);assert.ok(f.resizes.every(x=>x.closed));assert.ok(f.changes.every(x=>x.closed));
});
test('hero hall renders the actual aura inside the existing normalized portrait slot',()=>{
 const f=fixture();f.ctx.window={RpgStarRingCosmetics:f.ui};vm.runInContext(readFileSync(new URL('../public/hero-hall-ui.js',import.meta.url),'utf8'),f.ctx);const heroes=[{id:'1',name:'旅人',level:80,power:100,baseClass:'sword',aura:{id:'star_ring_aura_moon',name:'月潮星紋'}},{id:'2',name:'旅人二',level:70,power:90,baseClass:'mage',aura:null}];
 const html=f.ctx.window.RpgHeroHallUI.render({heroes},{filter:'all',page:1},{esc:String,fmt:String,portrait:()=>'/art/test.webp'});assert.equal((html.match(/class="hall-portrait"/g)||[]).length,2);assert.equal((html.match(/data-cosmetic-aura=/g)||[]).length,1);assert.match(html,/surround-moon.webp/);assert.match(html,/月潮星紋/);assert.match(html,/共 2 位英雄/);
});
