import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const social=fs.readFileSync(new URL('../public/scene-social-preview.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/scene-social-preview.css',import.meta.url),'utf8');
const hub=social.slice(social.indexOf('function paintHub('),social.indexOf('async function mountUnified('));
const stems=['explore-1-dispatch','explore-2-status','explore-3-growth','explore-4-supply','explore-5-atlas','party-1-dungeon','party-2-tower','party-3-worldboss','party-4-ring','quest-1-quests','quest-2-fate','quest-3-daily','quest-4-log'];

function harness({reduce=false,io=true}={}){
 const listeners={},observers=[],doc={hidden:false,addEventListener:(k,f)=>{listeners[k]=f;},removeEventListener:(k,f)=>{if(listeners[k]===f)delete listeners[k];}};
 const node=tag=>{const n={tag,children:[],dataset:{},attributes:{},paused:true,append(...i){this.children.push(...i);},replaceChildren(...i){this.children=i;},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},focus(){},click(){this.onclick?.();},querySelector(){return null;}};
  if(tag==='video'){n.play=function(){this.paused=false;return Promise.resolve();};n.pause=function(){this.paused=true;};}return n;};
 const view={document:doc,matchMedia:q=>({matches:reduce&&/reduced-motion/.test(q)})};
 if(io)view.IntersectionObserver=class{constructor(cb,opts){this.cb=cb;this.opts=opts;this.targets=[];observers.push(this);}observe(t){this.targets.push(t);}disconnect(){this.off=true;}};
 doc.defaultView=view;doc.createElement=node;
 const box={actor:{name:'旅人',level:1},liveSession:{getSnapshot:()=>({run:{active:false}})},document:doc,imageFor:()=>'x.webp'};
 vm.runInNewContext(hub+'\nglobalThis.paintHub=paintHub;',box);
 return {box,doc,listeners,observers,node};
}
const walk=(n,f,out=[])=>{if(f(n))out.push(n);for(const c of n.children||[])walk(c,f,out);return out;};

test('every 冒險 feature maps to a shipped banner with webm, mp4 and webp poster',()=>{
 for(const stem of stems){assert.ok(hub.includes("'"+stem+"'"),stem);for(const ext of ['mp4','webm','webp'])assert.ok(fs.statSync(new URL('../public/art/adventure-banners-20261112/'+stem+'.'+ext,import.meta.url)).size>1000,stem+'.'+ext);}
 assert.match(css,/\.scene-hub-grid\[data-banners\]/);
});

test('banner rows request no media until near the viewport, then play and pause with visibility',()=>{
 const {box,doc,listeners,observers,node}=harness();const body=node('div');
 const handle=box.paintHub(body,'adventure',{draft:{hubTab:'explore'},navigate(){}});
 const grid=body.children.find(n=>n.className==='scene-hub-grid');
 assert.equal(grid.dataset.banners,'adventure');
 const rows=grid.children;assert.equal(rows.length,5);
 for(const row of rows){assert.match(row.className,/scene-hub-banner/);assert.equal(row.children[0].tag,'strong');assert.equal(row.children[1].tag,'small');assert.ok(row.dataset.sceneRoute);}
 assert.equal(walk(body,n=>n.tag==='video'||n.tag==='source'||n.tag==='img').length,0,'no media before intersection');
 const [io]=observers;assert.equal(io.opts.root,body);assert.equal(io.targets.length,5);
 io.cb([{target:rows[0],isIntersecting:true}]);
 const video=walk(rows[0],n=>n.tag==='video')[0];
 assert.ok(video);assert.equal(video.attributes.preload,'none');assert.match(video.attributes.poster,/explore-1-dispatch\.webp$/);
 for(const k of ['muted','loop','playsinline','autoplay'])assert.ok(k in video.attributes,k);
 assert.deepEqual(video.children.map(s=>s.type),['video/webm','video/mp4']);
 assert.equal(video.paused,false);
 assert.equal(walk(rows[4],n=>n.tag==='video').length,0,'far rows stay empty');
 io.cb([{target:rows[0],isIntersecting:false}]);assert.equal(video.paused,true);
 io.cb([{target:rows[0],isIntersecting:true}]);assert.equal(video.paused,false);
 doc.hidden=true;listeners.visibilitychange();assert.equal(video.paused,true);
 doc.hidden=false;listeners.visibilitychange();assert.equal(video.paused,false);
 handle.dispose();assert.ok(io.off);assert.equal(listeners.visibilitychange,undefined);assert.equal(video.paused,true);
});

test('reduced motion shows only the poster still',()=>{
 const {box,observers,node}=harness({reduce:true});const body=node('div');
 box.paintHub(body,'adventure',{draft:{hubTab:'party'},navigate(){}});
 const rows=body.children.find(n=>n.className==='scene-hub-grid').children;
 observers[0].cb(rows.map(target=>({target,isIntersecting:true})));
 assert.equal(walk(body,n=>n.tag==='video').length,0);
 assert.deepEqual(rows.map(r=>walk(r,n=>n.tag==='img')[0].src.split('/').pop()),['party-1-dungeon.webp','party-2-tower.webp','party-3-worldboss.webp','party-4-ring.webp']);
});

test('other hubs keep their icon tiles and banners stay out of the entry load',()=>{
 const {box,node}=harness();const body=node('div');
 box.paintHub(body,'camp',{draft:{},navigate(){}});
 const grid=body.children.find(n=>n.className==='scene-hub-grid');
 assert.equal(grid.dataset.banners,undefined);
 assert.equal(walk(body,n=>n.tag==='video').length,0);
 for(const f of ['index.html','scene.html'].map(f=>new URL('../public/'+f,import.meta.url)).filter(u=>fs.existsSync(u)))assert.doesNotMatch(fs.readFileSync(f,'utf8'),/adventure-banners/);
});
