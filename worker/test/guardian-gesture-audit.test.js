import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const qualities=['white','green','blue','purple','red','gold','pink','cyan'];
const config={schemaVersion:1,configVersion:'fixture-approved',enabled:true,status:'approved',qualityOrder:qualities,actions:{summon:true},types:[{id:'magic',name:'天使・秘曜',artUrl:'art/guardian/magic.webp'}],scene:{featherArtUrl:'art/guardian/feather.webp'}};
const receipt=(quality='purple',total=1)=>({operationId:'committed-1',requestId:'original-request',charId:'hero-a',action:'summon',status:'committed',results:Array.from({length:total},(_,index)=>({id:'item-'+index,type:'magic',quality:index===total-1?quality:'white',bound:false})),consumed:{gold:7}});
const pointer=(pointerId,clientY,extra={})=>({pointerId,clientY,clientX:10,isTrusted:true,isPrimary:true,button:0,preventDefault(){},...extra});
const keyEvent=(key,extra={})=>({key,isTrusted:true,preventDefault(){},...extra});

function target(){const listeners=new Map();return {listeners,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);if(listeners.get(name)?.size===0)listeners.delete(name);},emit(name,event={}){for(const fn of [...listeners.get(name)||[]])fn(event);}};}
function node(tag='div'){
 const base=target(),classes=new Set(),properties=new Map(),captures=new Set();let html='';
 const api={...base,tagName:tag.toUpperCase(),dataset:{},children:[],parent:null,properties,captures,propertyWrites:0,
  classList:{add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)},
  style:{setProperty(key,value){properties.set(key,value);api.propertyWrites++;}},
  append(child){child.parent=api;api.children.push(child);},replaceChildren(){api.children.forEach(x=>x.parent=null);api.children=[];html='';},remove(){if(api.parent)api.parent.children=api.parent.children.filter(x=>x!==api);api.parent=null;},
  setAttribute(key,value){if(key==='class')api.className=value;else api[key]=String(value);},
  setPointerCapture(id){captures.add(id);},releasePointerCapture(id){captures.delete(id);},getBoundingClientRect:()=>({left:0,right:100,top:0,bottom:100}),
  contains(child){for(let current=child;current;current=current.parent)if(current===api)return true;return false;},
  matches(selector){if(selector==='button')return api.tagName==='BUTTON';if(selector.startsWith('.'))return classes.has(selector.slice(1));const match=selector.match(/^\[data-([^\]]+)\]$/);return !!match&&Object.hasOwn(api.dataset,match[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase()));},
  closest(selector){for(let current=api;current;current=current.parent)if(current.matches(selector))return current;return null;},
  querySelector(selector){for(const child of api.children){if(child.matches(selector))return child;const nested=child.querySelector(selector);if(nested)return nested;}return null;}
 };
 Object.defineProperty(api,'className',{get:()=>[...classes].join(' '),set:value=>{classes.clear();String(value).split(/\s+/).filter(Boolean).forEach(x=>classes.add(x));}});
 Object.defineProperty(api,'innerHTML',{get:()=>html,set:value=>{api.replaceChildren();html=String(value);for(const match of html.matchAll(/<button\b([^>]*)>/g)){const button=node('button');for(const attr of match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)){const key=attr[1],value=attr[2]||'';if(key==='class')button.className=value;else if(key.startsWith('data-'))button.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}api.append(button);}}});
 return api;
}
function setup({frames=false,reduced=false,clock=false,media=null,presentationOptions={},commit=()=>Promise.resolve(receipt()),previous,operation=receipt()}={}){
 const videos=[],window=target(),document={...target(),hidden:false,createElement:tag=>{const element=node(tag);if(media&&tag==='video'){Object.assign(element,{videoWidth:500,videoHeight:842,playCalls:0,pauseCalls:0,loadCalls:0,seeking:false,seekWrites:[],canPlayType:()=>media.vp9===false?'':'probably',play(){element.playCalls++;return media.play?media.play(element):Promise.resolve();},pause(){element.pauseCalls++;},load(){element.loadCalls++;},removeAttribute(name){if(name==='src')element.src='';}});let playbackTime=0;Object.defineProperty(element,'currentTime',{get:()=>playbackTime,set:value=>{if(media.seekError)throw Error('seek unavailable');element.seekWrites.push(value);playbackTime=value;element.seeking=media.seekPending===true;}});videos.push(element);}if(media&&tag==='canvas')element.getContext=()=>({drawImage(){},getImageData:()=>({data:[0,0,0,media.alpha??0]})});return element;}},frameCallbacks=new Map(),timeouts=new Map(),storage=new Map(),pulses=[],vibrations=[];let serial=0,milliseconds=0;
 window.matchMedia=()=>({matches:reduced});window.sessionStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};window.navigator={vibrate:pattern=>{vibrations.push(pattern);if(pattern)pulses.push(pattern);return true;}};
 if(frames){window.requestAnimationFrame=fn=>{const id=++serial;frameCallbacks.set(id,fn);return id;};window.cancelAnimationFrame=id=>frameCallbacks.delete(id);}
 const scene=node(),anchor=node();anchor.className='guardian-feather-anchor';scene.append(anchor);const tree={progresses:[],resultModes:[],mountOptions:[],returns:0,suppressions:0,cleaned:false,progress(p){this.progresses.push(p);},resultMode(value){this.resultModes.push(value);},releasedEarly(){this.returns++;},suppressClickAfterDrag(){this.suppressions++;},cleanup(){this.cleaned=true;}};window.RpgGuardianWorldTree={mount:(scene,options)=>{tree.mountOptions.push(options);return tree;}};
 if(clock)window.performance={now:()=>milliseconds};
 const context=vm.createContext({window,document,AbortController,setTimeout:clock?(fn,ms)=>{const id=++serial;timeouts.set(id,{fn,ms,due:milliseconds+ms});return id;}:setTimeout,clearTimeout:clock?id=>timeouts.delete(id):clearTimeout});for(const name of ['guardian-sigil-contract.js','guardian-haptics.js','guardian-summon-gesture.js','guardian-pull.js','guardian-presentation.js'])vm.runInContext(read(name),context);
 const done=[],holding=[],interactions=[],updates=[];let commitCount=0;
 const mount=()=>window.RpgGuardianSummonGesture.mount(scene,{config:window.RpgGuardianContract.config(config),tree,canStart:()=>true,commit:()=>{commitCount++;return commit();},onFinish:(result,detail)=>done.push({result,detail}),onHolding:()=>holding.push(handle?.getState().pointer??null)});
 let handle=mount();
 const step=()=>{const tasks=[...frameCallbacks.values()];frameCallbacks.clear();tasks.forEach(fn=>fn());};
 const presentation=()=>{handle.cleanup();return window.RpgGuardianPresentation.mount(scene,{config,operation,previous,onInteractionChange:value=>interactions.push(value),onUpdate:value=>updates.push(value),...presentationOptions});};
 const runTimers=()=>{const tasks=[...timeouts.values()];timeouts.clear();tasks.forEach(task=>task.fn());};
 const advance=ms=>{const end=milliseconds+ms;for(;;){const next=[...timeouts].filter(([,task])=>task.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;milliseconds=next[1].due;timeouts.delete(next[0]);next[1].fn();}milliseconds=end;};
 return {window,document,scene,anchor,tree,handle,done,holding,pulses,vibrations,frameCallbacks,timeouts,videos,runTimers,advance,step,mount,presentation,interactions,updates,button:()=>anchor.querySelector('button'),commitCount:()=>commitCount};
}

test('summon commits strictly once after a full move and release, stays silver until receipt, and colors the real highest item',async()=>{
 let resolve;const h=setup({commit:()=>new Promise(done=>resolve=done)}),button=h.button();button.emit('pointerdown',pointer(1,10));h.window.emit('pointermove',pointer(1,65));assert.equal(h.commitCount(),0);
 h.window.emit('pointermove',pointer(1,66));h.window.emit('pointermove',pointer(1,90));h.window.emit('pointermove',pointer(1,66));assert.equal(h.commitCount(),0);assert.equal(button.classList.contains('is-edge-visible'),false);assert.equal(h.done.length,0);
 h.window.emit('pointermove',pointer(1,120));assert.equal(h.commitCount(),0);h.window.emit('pointerup',pointer(1,120));assert.equal(h.commitCount(),1);
 resolve(receipt('cyan',10));await tick();assert.equal(button.classList.contains('guardian-quality-cyan'),true);assert.equal(button.classList.contains('guardian-quality-white'),false);assert.deepEqual(h.pulses,[]);
 h.window.emit('pointermove',pointer(1,70));h.window.emit('pointermove',pointer(1,90));h.window.emit('pointerup',pointer(1,120));await tick();assert.equal(h.commitCount(),1);assert.equal(h.done.length,1);assert.equal(h.done[0].detail.complete,true);assert.equal(h.done[0].result.requestId,'original-request');h.handle.cleanup();
});
test('a slow full pull displays real quality for a painted frame before handing off and no next gesture can send another charge',async()=>{
 let resolve;const h=setup({frames:true,commit:()=>new Promise(done=>resolve=done)}),button=h.button();button.emit('pointerdown',pointer(1,0));h.window.emit('pointermove',pointer(1,110));h.window.emit('pointerup',pointer(1,110));button.emit('pointerdown',pointer(2,0));h.window.emit('pointerup',pointer(2,110));assert.equal(h.handle.activate(),false);assert.equal(h.commitCount(),1);
 assert.equal(h.handle.isInteracting(),true);resolve(receipt('gold'));await tick();assert.equal(h.done.length,0);assert.equal(button.classList.contains('guardian-quality-gold'),true);assert.equal(h.handle.isInteracting(),true);h.step();assert.equal(h.done.length,0);h.step();assert.equal(h.done.length,1);assert.equal(h.handle.isInteracting(),false);assert.equal(h.done[0].detail.complete,true);h.handle.cleanup();assert.equal(h.frameCallbacks.size,0);
});
test('move bursts paint at most once per animation frame and defer the request until the full release',async()=>{
 const h=setup({frames:true}),button=h.button();button.emit('pointerdown',pointer(1,0));for(let y=1;y<=80;y++)h.window.emit('pointermove',pointer(1,y));assert.equal(h.commitCount(),0);assert.equal(button.propertyWrites,0);assert.equal(h.frameCallbacks.size,1);h.step();assert.equal(button.propertyWrites,2);assert.equal(h.tree.progresses.at(-1),80/110);h.window.emit('pointermove',pointer(1,110));assert.equal(h.commitCount(),0);h.window.emit('pointerup',pointer(1,110));assert.equal(h.commitCount(),1);await tick();h.handle.cleanup();
});
test('early release below threshold returns safely, cancels restore controls, and a new pull is allowed without charge',()=>{
 const h=setup(),button=h.button();button.emit('pointerdown',pointer(1,0));h.window.emit('pointerup',pointer(1,50));assert.equal(h.commitCount(),0);assert.equal(h.handle.getState().pointer,null);assert.equal(h.tree.returns,1);assert.equal(h.holding.length,2);
 button.emit('pointerdown',pointer(2,0));h.window.emit('pointercancel',pointer(2,0));assert.equal(h.commitCount(),0);assert.equal(h.holding.length,4);assert.equal(button.captures.size,0);button.emit('pointerdown',pointer(3,0));assert.equal(h.handle.getState().pointer,3);h.handle.cleanup();
});
test('reversing after a full move but releasing below halfway costs nothing; the next complete drag charges once',async()=>{
 let resolve;const h=setup({commit:()=>new Promise(done=>resolve=done)}),button=h.button();button.emit('pointerdown',pointer(1,0));h.window.emit('pointermove',pointer(1,110));h.window.emit('pointerup',pointer(1,40));assert.equal(h.commitCount(),0);assert.equal(h.handle.getState().progress,0);assert.equal(h.done.length,0);button.emit('pointerdown',pointer(2,0));assert.equal(h.handle.getState().pointer,2);
 h.window.emit('pointermove',pointer(2,110));h.window.emit('pointerup',pointer(2,110));assert.equal(h.commitCount(),1);resolve(receipt());await tick();assert.equal(h.done.length,1);assert.equal(h.done[0].detail.complete,true);assert.equal(h.done[0].result.operationId,'committed-1');h.handle.cleanup();
});
test('secondary pointers, invalid coordinates and IDs cannot change the primary gesture or issue a charge',()=>{
 const h=setup(),button=h.button();for(const event of [pointer(1,NaN),pointer(undefined,0),pointer(1.5,0),pointer(2,0,{isPrimary:false}),pointer(2,0,{button:2})])button.emit('pointerdown',event);assert.equal(h.handle.getState().pointer,null);
 button.emit('pointerdown',pointer(1,0));h.window.emit('pointermove',pointer(1,NaN));h.window.emit('pointermove',pointer(2,120));h.window.emit('pointerup',pointer(2,120));h.window.emit('pointercancel',pointer(2,120));assert.equal(h.handle.getState().pointer,1);assert.equal(h.handle.getState().progress,0);assert.equal(h.commitCount(),0);h.window.emit('pointerup',pointer(1,Infinity));assert.equal(h.handle.getState().pointer,null);assert.equal(h.commitCount(),0);assert.equal(h.tree.progresses.every(Number.isFinite),true);h.handle.cleanup();
});
test('captured pointer may leave the feather and still release; pagehide, hidden, blur and resize cancel cleanly',async()=>{
 const h=setup(),button=h.button();button.emit('pointerdown',pointer(1,0));button.emit('pointerleave',pointer(1,120));h.window.emit('pointermove',pointer(1,120));h.window.emit('pointerup',pointer(1,120));await tick();assert.equal(h.done.length,1);h.handle.cleanup();
 for(const event of ['blur','pagehide','resize','visibilitychange']){const h=setup(),button=h.button();button.emit('pointerdown',pointer(1,0));if(event==='visibilitychange'){h.document.hidden=true;h.document.emit(event);}else h.window.emit(event);assert.equal(h.handle.getState().pointer,null);assert.equal(button.captures.size,0);assert.equal(h.holding.length,2);assert.equal(h.commitCount(),0);h.handle.cleanup();}
});
test('sync host throws, rejected promises and untrusted/pending results do not strand the stage or invent quality',async()=>{
 for(const commit of [()=>{throw Error('host');},()=>Promise.reject(Error('offline')),()=>({...receipt(),status:'pending'}),()=>receipt('unknown'),()=>null]){const h=setup({commit}),button=h.button();button.emit('pointerdown',pointer(1,0));h.window.emit('pointermove',pointer(1,110));h.window.emit('pointerup',pointer(1,110));await tick();assert.equal(h.done.length,1);assert.equal(h.done[0].result,null);assert.equal(h.done[0].detail.complete,false);assert.equal(button.classList.contains('is-edge-visible'),false);assert.equal(h.handle.getState().requesting,false);h.handle.cleanup();}
});
test('cleanup and remount remove all event listeners, frames and instructions, and stale response cannot repaint or finish',async()=>{
 let resolve;const h=setup({frames:true,commit:()=>new Promise(done=>resolve=done)}),old=h.button();old.emit('pointerdown',pointer(1,0));h.window.emit('pointermove',pointer(1,110));h.window.emit('pointerup',pointer(1,110));h.handle.cleanup();assert.equal(old.captures.size,0);assert.equal(old.listeners.size,0);assert.equal(h.window.listeners.size,0);assert.equal(h.document.listeners.size,0);assert.equal(h.frameCallbacks.size,0);assert.equal(h.scene.querySelector('.guardian-summon-instruction'),null);
 const next=h.mount();assert.equal(h.scene.children.filter(x=>x.className==='guardian-summon-instruction').length,1);resolve(receipt('cyan'));await tick();h.step();assert.equal(h.done.length,0);assert.equal(h.button().classList.contains('guardian-quality-cyan'),false);next.cleanup();
});
test('reduced motion and keyboard activate retain same receipt, quality and one-charge semantics without waiting on frames',async()=>{
 const h=setup({frames:true,reduced:true}),button=h.button();button.emit('keydown',keyEvent('Enter'));button.emit('keydown',keyEvent(' '));await tick();assert.equal(h.commitCount(),1);assert.equal(h.done.length,1);assert.equal(h.frameCallbacks.size,0);assert.equal(h.done[0].detail.complete,true);h.handle.cleanup();
});
test('presentation reports live committed drag interactions and returns an isolated state snapshot',()=>{
 const h=setup(),presentation=h.presentation(),button=h.button();assert.equal(presentation.isInteracting(),false);button.emit('pointerdown',pointer(1,0));assert.equal(presentation.isInteracting(),true);assert.equal(presentation.getState().pull.primaryPointerId,1);
 h.window.emit('pointermove',pointer(1,75));h.window.emit('pointercancel',pointer(2,75));assert.equal(presentation.isInteracting(),true);h.window.emit('pointercancel',pointer(1,75));assert.equal(presentation.isInteracting(),false);assert.deepEqual(h.interactions,[true,false]);const snapshot=presentation.getState();snapshot.revealed.push('invented');assert.equal(presentation.snapshot().revealed.length,0);presentation.cleanup();assert.equal(h.window.listeners.size,0);assert.equal(h.document.listeners.size,0);assert.equal(h.scene.listeners.size,0);
});
test('presentation chooses and then reveals a tapped item while releasing capture before replacing its DOM',()=>{
 const h=setup({operation:receipt('cyan',5),previous:{operationId:'committed-1',ready:true}}),presentation=h.presentation();let card=h.scene.querySelector('[data-guardian-result]');h.scene.emit('pointerdown',{...pointer(1,10),target:card});assert.equal(presentation.isInteracting(),true);assert.equal(card.captures.size,1);h.scene.emit('pointerup',{...pointer(1,10),target:card});assert.equal(card.captures.size,0);assert.equal(presentation.isInteracting(),false);assert.equal(presentation.snapshot().selected,'item-0');assert.equal(presentation.snapshot().revealed.length,0);
 card=h.scene.querySelector('[data-guardian-result]');h.scene.emit('pointerdown',{...pointer(1,10),target:card});h.scene.emit('pointerup',{...pointer(1,10),target:card});assert.equal(card.captures.size,0);assert.equal(presentation.snapshot().revealed[0],'item-0');assert.deepEqual(h.interactions,[true,false,true,false]);presentation.cleanup();
});
test('presentation cancel, outside release, secondary pointers, resize and cleanup cannot reveal or leave captured taps',()=>{
 for(const end of ['outside','secondary','blur','pagehide','resize','visibilitychange','cleanup']){const h=setup({operation:receipt('cyan',5),previous:{operationId:'committed-1',ready:true}}),presentation=h.presentation(),card=h.scene.querySelector('[data-guardian-result]');h.scene.emit('pointerdown',{...pointer(1,10),target:card});if(end==='outside')h.scene.emit('pointerup',{...pointer(1,300),target:card});else if(end==='secondary'){h.scene.emit('pointerup',{...pointer(2,10),target:card});assert.equal(presentation.isInteracting(),true);h.scene.emit('pointercancel',pointer(1,10));}else if(end==='visibilitychange'){h.document.hidden=true;h.document.emit('visibilitychange');}else if(end==='cleanup')presentation.cleanup();else h.window.emit(end);assert.equal(card.captures.size,0);assert.equal(presentation.isInteracting(),false);assert.equal(presentation.snapshot().revealed.length,0);presentation.cleanup();assert.equal(h.window.listeners.size,0);assert.equal(h.document.listeners.size,0);}
});
test('pure result drag coalesces pointermove painting and lifecycle suspension removes pending frames',()=>{
 const h=setup({frames:true}),presentation=h.presentation(),button=h.button();button.emit('pointerdown',pointer(1,0));for(let y=1;y<90;y++)h.window.emit('pointermove',pointer(1,y));assert.equal(button.propertyWrites,2);assert.equal(h.frameCallbacks.size,1);h.step();assert.equal(button.propertyWrites,4);h.window.emit('resize');assert.equal(presentation.isInteracting(),false);assert.equal(h.frameCallbacks.size,0);presentation.cleanup();
});
test('finishing a committed pull retains one quality vibration and starts one independent triple scatter pulse',()=>{
 const h=setup({clock:true,operation:receipt('cyan')}),presentation=h.presentation(),button=h.button();button.emit('pointerdown',pointer(1,0));h.window.emit('pointerup',pointer(1,110));assert.equal(presentation.snapshot().ready,true);assert.equal(presentation.snapshot().phase,'scatter');assert.equal(h.vibrations[0],60);assert.deepEqual([...h.vibrations[1]],[25,85,25,85,25]);assert.deepEqual(h.interactions,[true]);h.runTimers();assert.deepEqual(h.interactions,[true,false]);assert.equal(presentation.snapshot().phase,'selection');assert.equal(h.commitCount(),0);presentation.cleanup();
});
test('remount on the same scene cannot leave previous batch cards or a single-result layout behind',()=>{
 const h=setup({previous:{operationId:'committed-1',ready:true}}),old=h.presentation();assert.equal(h.scene.classList.contains('is-batch-ready'),true);assert.equal(h.scene.classList.contains('is-single-result'),true);assert.ok(h.scene.querySelector('.guardian-preview-results'));
 const next=h.window.RpgGuardianPresentation.mount(h.scene,{config,operation:{...receipt('gold',10),operationId:'next-committed',requestId:'next-request'}});assert.equal(old.getState().disposed,true);assert.equal(next.snapshot().ready,false);assert.equal(h.scene.classList.contains('is-batch-ready'),false);assert.equal(h.scene.classList.contains('is-single-result'),false);assert.equal(h.scene.querySelector('.guardian-preview-results'),null);next.cleanup();
});

test('one committed draw reveals its full angel on the first selection, and restoring or selecting it never summons again',()=>{
 const h=setup({operation:receipt('purple'),previous:{operationId:'committed-1',ready:true}}),presentation=h.presentation();
 assert.equal(presentation.snapshot().revealed.length,0);assert.match(h.scene.querySelector('.guardian-preview-results').innerHTML,/guardian-result-feather/);
 const card=h.scene.querySelector('[data-guardian-result]');h.scene.emit('click',{detail:0,target:card});assert.equal(presentation.snapshot().selected,null);assert.equal(presentation.snapshot().revealed.length,0);h.scene.emit('keydown',keyEvent('Enter',{target:card}));assert.equal(presentation.snapshot().selected,'item-0');assert.equal(h.commitCount(),0);
 const html=h.scene.querySelector('.guardian-preview-results').innerHTML;
 assert.deepEqual([...presentation.snapshot().revealed],['item-0']);assert.match(html,/class="guardian-result-portrait"/);assert.match(html,/src="art\/guardian\/magic.webp"/);assert.match(html,/<b>秘曜<\/b><span>紫色<\/span>/);assert.doesNotMatch(html,/guardian-result-feather/);assert.equal(h.commitCount(),0);
 const selectedHtml=h.scene.querySelector('.guardian-preview-results').innerHTML,previous=presentation.snapshot();presentation.cleanup();const restored=h.window.RpgGuardianPresentation.mount(h.scene,{config,operation:receipt('purple'),previous});assert.equal(h.scene.querySelector('.guardian-preview-results').innerHTML,selectedHtml);assert.deepEqual([...restored.snapshot().revealed],['item-0']);assert.equal(h.commitCount(),0);restored.cleanup();
});
test('revealed five and ten draw batches replace each feather with its own real type, and only purple or higher gains strong light',()=>{
 for(const total of [5,10]){
  const h=setup({operation:receipt('cyan',total),previous:{operationId:'committed-1',ready:true}}),presentation=h.presentation();
  const unopened=h.scene.querySelector('.guardian-preview-results').innerHTML;assert.equal([...unopened.matchAll(/class="guardian-result-feather"/g)].length,total);assert.equal(presentation.snapshot().revealed.length,0);
  presentation.revealAll();const html=h.scene.querySelector('.guardian-preview-results').innerHTML;
  assert.equal([...html.matchAll(/class="guardian-result-portrait"/g)].length,total);assert.equal([...html.matchAll(/src="art\/guardian\/magic.webp"/g)].length,total);assert.equal([...html.matchAll(/guardian-result-radiant/g)].length,1);assert.doesNotMatch(html,/guardian-result-feather/);assert.equal(h.commitCount(),0);assert.equal(presentation.snapshot().revealed.length,total);presentation.cleanup();
 }
 for(const quality of qualities){const h=setup({operation:receipt(quality),previous:{operationId:'committed-1',ready:true}}),presentation=h.presentation(),html=h.scene.querySelector('.guardian-preview-results').innerHTML;assert.equal(html.includes('guardian-result-radiant'),qualities.indexOf(quality)>=3);presentation.cleanup();}
});
test('formations fit complete figure cells at phone and tablet widths, stay disjoint under floating motion, and restore deterministic places',()=>{
 const h=setup(),position=h.window.RpgGuardianPresentation.position;
 for(const total of [1,5,10])for(let receiptIndex=0;receiptIndex<80;receiptIndex++){
  const positions=Array.from({length:total},(_,index)=>position('receipt-'+receiptIndex,index,total));
  positions.forEach((p,index)=>assert.deepEqual(p,position('receipt-'+receiptIndex,index,total)));
  for(const viewport of [320,390,768]){
   const width=Math.min(520,viewport-20)-26,height=320;
   const boxes=positions.map(p=>({left:(p.x-p.width/2)*width/100,right:(p.x+p.width/2)*width/100,top:(p.y-p.height/2)*height/100-2.5,bottom:(p.y+p.height/2)*height/100}));
   boxes.forEach(box=>{assert.ok(box.left>0&&box.right<width&&box.top>0&&box.bottom<height);});
   boxes.forEach((a,index)=>boxes.slice(index+1).forEach(b=>assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,'floating figures may not overlap neighbouring cells')));
  }
  if(total===5){assert.equal(positions.filter(p=>p.y<50).length,3);assert.equal(positions.filter(p=>p.y>50).length,2);}
  if(total===10){assert.equal(positions.filter(p=>p.y<50).length,5);assert.equal(positions.filter(p=>p.y>50).length,5);}
 }
 h.handle.cleanup();
});
test('stored partial batch keeps opened figures and remaining feathers, then reveals one selected result without changing its receipt',()=>{
 const operation=receipt('gold',5),previous={operationId:'committed-1',ready:true,selected:'item-2',revealed:['item-0','item-4','foreign-item']},h=setup({operation,previous}),presentation=h.presentation();
 const html=h.scene.querySelector('.guardian-preview-results').innerHTML;assert.equal([...html.matchAll(/class="guardian-result-portrait"/g)].length,2);assert.equal([...html.matchAll(/class="guardian-result-feather"/g)].length,3);
 const card=h.scene.querySelector('.guardian-preview-results').children[2];h.scene.emit('click',{detail:0,target:card});assert.deepEqual([...presentation.snapshot().revealed],['item-0','item-4']);h.scene.emit('keydown',keyEvent(' ',{target:card}));assert.deepEqual([...presentation.snapshot().revealed],['item-0','item-4','item-2']);assert.equal(presentation.snapshot().operationId,operation.operationId);assert.equal(h.commitCount(),0);presentation.cleanup();
});
test('ready receipts enter result mode before resetting drag progress so the master angel cannot briefly resume',()=>{
 const h=setup({clock:true}),presentation=h.presentation();assert.equal(h.tree.mountOptions.at(-1).resultMode,false);presentation.openBatch();assert.equal(h.tree.resultModes.at(-1),true);assert.equal(h.tree.progresses.at(-1),1);assert.equal(presentation.snapshot().ready,true);assert.equal(presentation.snapshot().revealed.length,0);assert.equal(presentation.isInteracting(),true);h.runTimers();assert.equal(h.tree.progresses.at(-1),0);assert.equal(presentation.isInteracting(),false);
 const previous=presentation.snapshot();presentation.cleanup();const restored=h.window.RpgGuardianPresentation.mount(h.scene,{config,operation:receipt(),previous});assert.equal(h.tree.mountOptions.at(-1).resultMode,true);assert.equal(restored.isInteracting(),false);restored.cleanup();assert.equal(h.commitCount(),0);
});
test('fresh full pull preserves the final hand and feather, bursts from that scene point, then unlocks one-click single selection',()=>{
 const h=setup({clock:true,previous:{operationId:'committed-1',ready:true},presentationOptions:{playTransition:true,transitionOrigin:{x:38.25,y:61.5}}}),presentation=h.presentation(),overlay=h.scene.querySelector('.guardian-scatter');
 assert.equal(overlay.properties.get('--guardian-scatter-x'),'38.25%');assert.equal(overlay.properties.get('--guardian-scatter-y'),'61.5%');assert.equal(h.tree.progresses.at(-1),1);assert.match(h.anchor.innerHTML,/guardian-scatter-held/);assert.equal(h.scene.classList.contains('is-batch-ready'),false);assert.equal(presentation.snapshot().phase,'scatter');assert.equal(presentation.isInteracting(),true);assert.equal(h.timeouts.size,1);
 const card=h.scene.querySelector('[data-guardian-result]');h.scene.emit('pointerdown',{...pointer(1,10),target:card});h.scene.emit('click',{detail:0,target:card});presentation.revealAll();presentation.openBatch();assert.equal(presentation.snapshot().revealed.length,0);assert.equal(h.timeouts.size,1);assert.equal(h.commitCount(),0);
 h.runTimers();assert.equal(presentation.snapshot().phase,'selection');assert.equal(presentation.isInteracting(),false);assert.equal(h.scene.querySelector('.guardian-scatter'),null);assert.equal(h.scene.classList.contains('is-batch-ready'),true);assert.equal(h.anchor.children.length,0);assert.equal(h.tree.progresses.at(-1),0);
 h.scene.emit('click',{detail:0,target:h.scene.querySelector('[data-guardian-result]')});assert.equal(presentation.snapshot().revealed.length,0);h.scene.emit('keydown',keyEvent('Enter',{target:h.scene.querySelector('[data-guardian-result]')}));assert.equal(presentation.snapshot().revealed.length,1);assert.equal(h.commitCount(),0);presentation.openBatch();assert.equal(h.timeouts.size,0);presentation.cleanup();
});
test('hidden, blurred, resized and closed scenes finish scatter safely, and reloaded scatter receipts skip the transition',()=>{
 for(const event of ['blur','resize','pagehide','visibilitychange']){
  const h=setup({clock:true,previous:{operationId:'committed-1',ready:true},presentationOptions:{playTransition:true}}),presentation=h.presentation(),saved=presentation.snapshot();
  if(event==='visibilitychange'){h.document.hidden=true;h.document.emit(event);}else h.window.emit(event);
  assert.equal(h.timeouts.size,0);assert.equal(presentation.snapshot().phase,'selection');assert.equal(presentation.snapshot().revealed.length,0);assert.equal(presentation.isInteracting(),false);assert.equal(h.scene.querySelector('.guardian-scatter'),null);presentation.cleanup();
  const restored=h.window.RpgGuardianPresentation.mount(h.scene,{config,operation:receipt(),previous:saved});assert.equal(restored.snapshot().phase,'selection');assert.equal(h.timeouts.size,0);assert.equal(restored.isInteracting(),false);assert.equal(h.commitCount(),0);restored.cleanup();
 }
 const h=setup({clock:true,previous:{operationId:'committed-1',ready:true},presentationOptions:{playTransition:true}}),presentation=h.presentation();presentation.cleanup();h.runTimers();assert.equal(h.scene.querySelector('.guardian-scatter'),null);assert.equal(h.timeouts.size,0);assert.equal(h.scene.listeners.size,0);assert.equal(h.document.listeners.size,0);assert.equal(h.window.listeners.size,0);
});
test('reduced motion skips the burst and preserves independent reveal-all behavior without extra requests',()=>{
 for(const revealAll of [false,true]){
  const h=setup({clock:true,reduced:true,operation:receipt('gold',5),previous:{operationId:'committed-1',ready:true},presentationOptions:{playTransition:true,revealAllOnReady:revealAll}}),presentation=h.presentation();
  assert.equal(presentation.snapshot().phase,'selection');assert.equal(presentation.snapshot().revealed.length,revealAll?5:0);assert.equal(h.timeouts.size,0);assert.equal(h.vibrations.length,0);assert.equal(h.scene.querySelector('.guardian-scatter'),null);assert.equal(h.commitCount(),0);presentation.cleanup();
 }
});
test('transparent VFX waits for a decoded alpha frame and successful play; ended, fallback and late promise paths always release selection',async()=>{
 let resolve;const h=setup({clock:true,media:{play:()=>new Promise(done=>resolve=done)},previous:{operationId:'committed-1',ready:true},presentationOptions:{playTransition:true,transitionVideoUrl:'art/guardian/scatter.webm'}}),presentation=h.presentation(),video=h.videos[0],overlay=h.scene.querySelector('.guardian-scatter');
 assert.equal(video.playCalls,1);video.emit('loadeddata');assert.equal(overlay.classList.contains('is-video-ready'),false);resolve();await tick();assert.equal(overlay.classList.contains('is-video-ready'),true);video.emit('ended');assert.equal(presentation.snapshot().phase,'selection');assert.equal(h.timeouts.size,0);assert.equal(video.src,'');assert.equal(video.listeners.size,0);presentation.cleanup();
 for(const media of [{alpha:255},{vp9:false},{play:()=>Promise.reject(Error('NotAllowedError'))}]){
  const h=setup({clock:true,media,previous:{operationId:'committed-1',ready:true},presentationOptions:{playTransition:true,transitionVideoUrl:'art/guardian/scatter.webm'}}),presentation=h.presentation();h.videos[0]?.emit('loadeddata');await tick();assert.equal(h.scene.querySelector('.guardian-scatter').classList.contains('is-video-ready'),false);assert.equal(presentation.snapshot().phase,'scatter');h.runTimers();assert.equal(presentation.snapshot().phase,'selection');assert.equal(h.commitCount(),0);presentation.cleanup();
 }
 let finish;const late=setup({clock:true,media:{play:()=>new Promise(done=>finish=done)},previous:{operationId:'committed-1',ready:true},presentationOptions:{playTransition:true,transitionVideoUrl:'art/guardian/scatter.webm'}}),ended=late.presentation();ended.cleanup();finish();await tick();late.videos[0].emit('loadeddata');assert.equal(late.scene.querySelector('.guardian-scatter'),null);assert.equal(late.timeouts.size,0);assert.equal(late.videos[0].src,'');assert.equal(late.videos[0].listeners.size,0);
});
test('a promptly decoded transition seeks to the original scatter clock before adopting it without extending the selection deadline',async()=>{
 let resolve;const h=setup({clock:true,media:{seekPending:true,play:()=>new Promise(done=>resolve=done)},previous:{operationId:'committed-1',ready:true},presentationOptions:{playTransition:true,transitionVideoUrl:'art/guardian/scatter.webm',transitionDurationMs:1834}}),presentation=h.presentation(),video=h.videos[0],overlay=h.scene.querySelector('.guardian-scatter');
 assert.equal([...overlay.innerHTML.matchAll(/class="guardian-scatter-feather"/g)].length,24);
 h.advance(90);video.emit('loadeddata');resolve();await tick();assert.equal(video.currentTime,.09);assert.deepEqual(video.seekWrites,[.09]);assert.equal(overlay.classList.contains('is-video-ready'),false);
 h.advance(30);video.seeking=false;video.emit('seeked');assert.equal(overlay.classList.contains('is-video-ready'),true);assert.equal(h.timeouts.size,1);assert.equal([...h.timeouts.values()][0].due,1834);
 h.advance(1713);assert.equal(presentation.snapshot().phase,'scatter');h.advance(1);assert.equal(presentation.snapshot().phase,'selection');assert.equal(presentation.snapshot().revealed.length,0);assert.equal(video.src,'');assert.equal(video.listeners.size,0);assert.equal(h.timeouts.size,0);assert.equal(h.commitCount(),0);presentation.cleanup();
});
test('cold frame or play readiness stays with fallback for this draw, and stale callbacks never restart the burst',async()=>{
 for(const frameArrivesEarly of [false,true]){
  let resolve;const h=setup({clock:true,media:{play:()=>new Promise(done=>resolve=done)},previous:{operationId:'committed-1',ready:true},presentationOptions:{playTransition:true,transitionVideoUrl:'art/guardian/scatter.webm',transitionDurationMs:1834}}),presentation=h.presentation(),video=h.videos[0],overlay=h.scene.querySelector('.guardian-scatter');
  h.advance(50);if(frameArrivesEarly)video.emit('loadeddata');h.advance(131);assert.equal(video.src,'');assert.equal(video.listeners.size,0);assert.equal(presentation.snapshot().phase,'scatter');assert.equal(presentation.getState().transitionVideo,false);assert.equal(overlay.classList.contains('is-video-ready'),false);
  resolve();await tick();video.emit('loadeddata');video.emit('seeked');video.emit('ended');assert.equal(overlay.classList.contains('is-video-ready'),false);assert.deepEqual(video.seekWrites,[]);assert.equal(presentation.snapshot().phase,'scatter');
  h.advance(1653);assert.equal(presentation.snapshot().phase,'selection');assert.equal(h.updates.filter(update=>update.phase==='selection').length,1);assert.equal(h.timeouts.size,0);assert.equal(h.commitCount(),0);presentation.cleanup();
 }
});
test('slow, unavailable or opaque seek decoding fails closed and keeps the original fallback deadline',async()=>{
 for(const kind of ['slow','throw','opaque']){
  const media={seekPending:kind!=='throw',seekError:kind==='throw'},h=setup({clock:true,media,previous:{operationId:'committed-1',ready:true},presentationOptions:{playTransition:true,transitionVideoUrl:'art/guardian/scatter.webm',transitionDurationMs:1834}}),presentation=h.presentation(),video=h.videos[0],overlay=h.scene.querySelector('.guardian-scatter');
  h.advance(80);video.emit('loadeddata');await tick();assert.equal(overlay.classList.contains('is-video-ready'),false);
  if(kind==='slow'){h.advance(101);video.seeking=false;video.emit('seeked');}else if(kind==='opaque'){media.alpha=255;video.seeking=false;video.emit('seeked');}
  assert.equal(presentation.getState().transitionVideo,false);assert.equal(video.src,'');assert.equal(video.listeners.size,0);assert.equal(presentation.snapshot().phase,'scatter');assert.equal(h.timeouts.size,1);
  h.advance(1834);assert.equal(presentation.snapshot().phase,'selection');assert.equal(h.updates.filter(update=>update.phase==='selection').length,1);assert.equal(h.commitCount(),0);presentation.cleanup();
 }
});
test('an adopted video completes once on ended or lifecycle suspension; stale ended and the original timer cannot complete it again',async()=>{
 for(const end of ['ended','blur','resize','pagehide','visibilitychange']){
  const h=setup({clock:true,media:{},previous:{operationId:'committed-1',ready:true},presentationOptions:{playTransition:true,transitionVideoUrl:'art/guardian/scatter.webm'}}),presentation=h.presentation(),video=h.videos[0],overlay=h.scene.querySelector('.guardian-scatter');video.emit('loadeddata');await tick();assert.equal(overlay.classList.contains('is-video-ready'),true);
  if(end==='ended')video.emit('ended');else if(end==='visibilitychange'){h.document.hidden=true;h.document.emit(end);}else h.window.emit(end);
  assert.equal(presentation.snapshot().phase,'selection');assert.equal(h.updates.filter(update=>update.phase==='selection').length,1);assert.equal(video.src,'');assert.equal(video.listeners.size,0);assert.equal(h.timeouts.size,0);
  video.emit('ended');video.emit('loadeddata');h.advance(2000);assert.equal(h.updates.filter(update=>update.phase==='selection').length,1);assert.equal(presentation.snapshot().revealed.length,0);assert.equal(h.commitCount(),0);presentation.cleanup();
 }
});
test('ended before any transparent frame was adopted cannot skip the fallback animation or reveal results early',()=>{
 const h=setup({clock:true,media:{play:()=>new Promise(()=>{})},previous:{operationId:'committed-1',ready:true},presentationOptions:{playTransition:true,transitionVideoUrl:'art/guardian/scatter.webm'}}),presentation=h.presentation(),video=h.videos[0];video.emit('ended');assert.equal(presentation.snapshot().phase,'scatter');assert.equal(presentation.getState().transitionVideo,false);assert.equal(h.timeouts.size,1);h.advance(1600);assert.equal(presentation.snapshot().phase,'selection');assert.equal(h.updates.filter(update=>update.phase==='selection').length,1);assert.equal(h.commitCount(),0);presentation.cleanup();
});
