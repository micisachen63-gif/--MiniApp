import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync}from'node:fs';
const source=readFileSync(new URL('../public/hero-size.js',import.meta.url),'utf8');
function setup({lazy=false}={}){
 const classes=new Set(),watched=new Set(),removed=[],state={images:[],resize:null},frame={clientWidth:140,clientHeight:180,isConnected:true,classList:{contains:n=>n==='sr-hero-node'},closest:()=>null,querySelector:()=>img};
 const style={removeProperty:k=>delete style[k]},img={src:'local-hero',currentSrc:'',naturalWidth:320,naturalHeight:320,isConnected:true,complete:true,parentElement:frame,style,classList:{contains:n=>classes.has(n),add:n=>classes.add(n)},decode:async()=>{},getBoundingClientRect:()=>({x:10+parseFloat(style.left),y:20+parseFloat(style.top),width:parseFloat(style.width),height:parseFloat(style.height)})};state.images=[img];
 const document={body:{},querySelectorAll:()=>state.images,createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>{const data=new Uint8ClampedArray(320*320*4);for(let y=80;y<280;y++)for(let x=80;x<160;x++)data[(y*320+x)*4+3]=255;return{data};}})})};
 if(lazy){img.loading='lazy';img.complete=false;}
 const context=vm.createContext({document,window:{},...(lazy?{IntersectionObserver:class{constructor(){}observe(n){watched.add(n);}unobserve(n){watched.delete(n);removed.push(n);}}}:{}),ResizeObserver:class{constructor(cb){state.resize=cb;}observe(n){watched.add(n);}unobserve(n){watched.delete(n);removed.push(n);}},MutationObserver:class{observe(){}},requestAnimationFrame:cb=>cb(),console});vm.runInContext(source,context);return{api:context.window.RpgHeroSize,img,frame,state,watched,removed};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('visible portrait fits by alpha, exposes exact synchronous animation bounds and preserves CSS down transform',async()=>{
 const h=setup();await flush();assert.equal(h.img.classList.contains('hero-size-normalized'),true);assert.equal(h.img.style.transform,undefined);const r=h.api.visibleRect(h.img);assert.ok(Math.abs(r.height-170)<.001);assert.ok(Math.abs(r.bottom-195)<.001);assert.ok(r.width<=130);assert.equal(h.api.stats().observedFrames,1);
 h.frame.clientWidth=50;h.state.resize([{target:h.frame}]);const resized=h.api.visibleRect(h.img);assert.ok(resized.width<=46);assert.ok(resized.height<r.height);assert.ok(Math.abs(resized.bottom-197.75)<.001);
});
test('frequently rebuilt expedition cards unobserve disconnected slots rather than accumulating observers',async()=>{
 const h=setup();await flush();h.frame.isConnected=false;h.img.isConnected=false;h.state.images=[];h.api.scan();assert.equal(h.watched.size,0);assert.equal(h.removed.length,1);assert.equal(h.api.stats().observedFrames,0);
});
test('contained animation uses normalized visible rectangle, with legacy contain geometry unchanged',()=>{
 const all=readFileSync(new URL('../public/expedition/hero-art-playback.js',import.meta.url),'utf8'),body=all.slice(all.indexOf('export function containedImageRect'),all.indexOf('function actorFlipped')).replace('export function','function');const visible={x:7,y:8,width:90,height:170,bottom:178};let provided=visible;const c=vm.createContext({getComputedStyle:()=>({objectFit:'contain',objectPosition:'50% 100%'}),RpgHeroSize:{visibleRect:()=>provided}});vm.runInContext(body,c);const actor={naturalWidth:320,naturalHeight:320},rect={x:0,y:0,width:120,height:180};assert.equal(c.containedImageRect(actor,rect),visible);provided=null;const legacy=c.containedImageRect(actor,rect);assert.equal(legacy.width,120);assert.equal(legacy.height,120);assert.equal(legacy.y,60);
});
test('compact battle drawing can extend a narrow name slot while visible alpha stays inside the arena',async()=>{
 const h=setup();await flush();const arena={clientWidth:360,getBoundingClientRect:()=>({left:0,top:0})};h.frame.clientWidth=20;h.frame.getBoundingClientRect=()=>({left:10,top:20});h.frame.closest=selector=>selector==='.sr-arena'?arena:null;h.state.resize([{target:h.frame}]);const r=h.api.visibleRect(h.img);assert.ok(r.width>h.frame.clientWidth);assert.ok(r.left>=4.99&&r.right<=355.01);assert.ok(Math.abs(r.bottom-199.1)<.001);assert.ok(r.height>170);
});

test('replaced lazy portraits unobserve disconnected images before they ever decode',()=>{
 const h=setup({lazy:true});assert.equal(h.api.stats().deferredImages,1);assert.equal(h.watched.size,1);h.img.isConnected=false;h.state.images=[];h.api.scan();assert.equal(h.watched.size,0);assert.equal(h.api.stats().deferredImages,0);assert.equal(h.removed[0],h.img);
});
