import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),ritual=fs.readFileSync(new URL('../public/forge-ritual.js',import.meta.url),'utf8');
class Node{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.className='';this.attributes={};this.dataset={};this.style={cssText:'',setProperty(k,v){this[k]=v;}};this.events=new Map();this._text='';this.disabled=false;this.hidden=false;this.checked=false;this.isConnected=true;this.classList={contains:k=>this.className.split(' ').includes(k),add:(...ks)=>{this.className=[...new Set([...this.className.split(' '),...ks])].join(' ');},remove:(...ks)=>{this.className=this.className.split(' ').filter(k=>!ks.includes(k)).join(' ');},toggle:(k,on)=>{on??=!this.classList.contains(k);on?this.classList.add(k):this.classList.remove(k);}};}
 append(...nodes){for(const n of nodes){n.parentElement?.removeChild(n);n.parentElement=this;this.children.push(n);}}
 appendChild(n){this.append(n);return n;}
 removeChild(n){this.children=this.children.filter(x=>x!==n);n.parentElement=null;}
 remove(){this.parentElement?.removeChild(this);this.isConnected=false;}
 after(n){this.parentElement?.append(n);}
 setAttribute(k,v){this.attributes[k]=String(v);if(k==='hidden')this.hidden=true;}
 addEventListener(k,fn){this.events.set(k,fn);}
 removeEventListener(k){this.events.delete(k);}
 focus(){this.focused=true;}
 showModal(){this.open=true;}
 close(){this.open=false;}
 setPointerCapture(){}
 getBoundingClientRect(){const x=this.classList.contains('fr-target')||this.classList.contains('fg-ic')?200:0;return {left:x,right:x+100,top:0,bottom:100,width:100,height:100};}
 get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
 set textContent(v){this._text=String(v);this.children=[];}
 set innerHTML(html){this._html=html;this.children=[];this._text='';const stack=[this];for(const token of html.match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}if(!token.startsWith('<')){stack.at(-1)._text+=token;continue;}const tag=token.match(/^<(\w+)/)?.[1];if(!tag)continue;const n=new Node(tag);for(const a of token.matchAll(/([\w-]+)(?:="([^"]*)")?/g)){const k=a[1],v=a[2]??'';if(k===tag)continue;n.attributes[k]=v;if(k==='class')n.className=v;else if(k==='checked')n.checked=true;else if(k==='disabled')n.disabled=true;else if(k.startsWith('data-'))n.dataset[k.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=v;else n[k]=v;}stack.at(-1).append(n);if(!['img','input','br','hr'].includes(tag))stack.push(n);}}
 get innerHTML(){return this._html||'';}
 matches(selector){const checked=selector.endsWith(':checked');selector=selector.replace(':checked','');if(checked&&!this.checked)return false;if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));if(selector.startsWith('#'))return this.id===selector.slice(1);if(selector.startsWith('['))return Object.hasOwn(this.attributes,selector.slice(1,-1));return this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){if(selector.includes(','))return [...new Set(selector.split(',').flatMap(s=>this.querySelectorAll(s)))];const parts=selector.split(' ');if(parts.length>1)return this.querySelectorAll(parts[0]).flatMap(n=>n.querySelectorAll(parts.slice(1).join(' ')));return this.children.flatMap(n=>[...(n.matches(selector)?[n]:[]),...n.querySelectorAll(selector)]);}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
}
const gear={id:'gear-1',slot:'weapon',scroll:'scroll_w',blessedScroll:'blessed_scroll_w',scrollCost:4,enhance:5,name:'月桂長劍',rarity:'gold',enhanceNext:{success:.3,nothing:.2,break:.5},blessedEnhanceNext:{success:.4,nothing:.1,break:.5}};
function setup(){const events=new Map(),body=new Node('body'),document={body,documentElement:new Node('html'),createElement:t=>new Node(t),addEventListener(){},removeEventListener(){}},window={scrollY:0,addEventListener:(k,fn)=>events.set(k,fn),removeEventListener:k=>events.delete(k),scrollTo(){}};const ctx=vm.createContext({window,document,navigator:{},MutationObserver:class{observe(){}disconnect(){}},setInterval:()=>1,clearInterval(){},performance:{now:()=>0},matchMedia:()=>({matches:true}),requestAnimationFrame:fn=>fn(2000)});vm.runInContext(ritual,ctx);const ov=new Node();body.append(ov);return {window,document,ov,events,ctx,async drag(){const scroll=ov.querySelector('.fr-scroll');scroll.onpointerdown({button:0,pointerId:1,clientX:0,preventDefault(){}});events.get('pointermove')({pointerId:1,clientX:200,clientY:50,preventDefault(){}});return events.get('pointerup')({pointerId:1,preventDefault(){}});}};}
function options(have=2){return {choose:true,ordinaryAffordable:true,ordinaryHave:8,blessedHave:3,ordinarySummary:'普通4張',blessedSummary:'祝福1張',guaranteedHave:have,guaranteedKey:'guaranteed_scroll_w',guaranteedName:'星輝武器必成卷',guaranteedArt:'/art/items-scrolls-pink-20261018/guaranteed_scroll_w.webp',guaranteedSummary:'必成100% · 每次1張 · 單次',summary:'普通4張'};}
function choose(t,mode){const inputs=t.ov.querySelectorAll('.fr-choices input');inputs.forEach(i=>i.checked=i.value===mode);inputs.find(i=>i.value===mode).onchange();}
test('guaranteed scroll is opt-in, absent without matching stock, and mutually exclusive with ordinary and blessed',()=>{
 const t=setup();void t.window.RpgForgeRitual.prepare(t.ov,gear,'',false,options());assert.equal(t.ov.querySelector('input:checked').value,'ordinary');choose(t,'guaranteed');assert.equal(t.ov.classList.contains('guaranteed'),true);assert.match(t.ov.querySelector('.fr-odds').textContent,/成功 100% · 無變化 0% · 爆裝 0%/);assert.match(t.ov.querySelector('.fr-scroll img').src,/guaranteed_scroll_w.webp$/);assert.match(t.ov.querySelector('.fr-scroll span').textContent,/必成100%/);assert.equal(t.ov.querySelector('.fr-warning').hidden,true);assert.equal(t.ov.querySelector('.fr-auto').hidden,true);assert.ok(t.ov.querySelectorAll('.fr-auto input,.fr-auto select,.fr-auto button').every(n=>n.disabled));
 choose(t,'blessed');assert.equal(t.ov.classList.contains('guaranteed'),false);assert.match(t.ov.querySelector('.fr-odds').textContent,/成功 40%/);assert.equal(t.ov.querySelector('.fr-warning').hidden,false);assert.equal(t.ov.querySelector('.fr-auto').hidden,false);assert.equal(t.ov.querySelector('.fr-auto-check').checked,false);choose(t,'ordinary');assert.match(t.ov.querySelector('.fr-odds').textContent,/成功 30%/);t.window.RpgForgeRitual.dispose();
 const no=setup();void no.window.RpgForgeRitual.prepare(no.ov,gear,'',false,options(0));assert.ok(!no.ov.querySelectorAll('.fr-choices input').some(n=>n.value==='guaranteed'));no.window.RpgForgeRitual.dispose();
});
test('guaranteed drag asks single-use confirmation; cancel consumes nothing, and confirmed result cannot enable auto',async()=>{
 const t=setup(),pending=t.window.RpgForgeRitual.prepare(t.ov,gear,'',false,options());choose(t,'guaranteed');let resolved=false;pending.then(()=>resolved=true);const cancel=t.drag();await Promise.resolve();let dialog=t.document.body.querySelector('dialog');assert.match(dialog.textContent,/消耗 星輝武器必成卷 ×1/);assert.match(dialog.textContent,/成功 100%/);assert.equal(resolved,false);dialog.querySelector('[data-guaranteed-no]').onclick();await cancel;assert.equal(resolved,false);assert.equal(t.ov.querySelector('.fr-scroll').disabled,false);
 const confirm=t.drag();await Promise.resolve();dialog=t.document.body.querySelector('dialog');dialog.querySelector('[data-guaranteed-yes]').onclick();await confirm;const ready=await pending;assert.equal(ready.guaranteed,true);assert.equal(ready.blessed,false);assert.equal(ready.autoTarget,null);
});
test('rare radio cannot start background enhancement even if auto check is manipulated',async()=>{
 const t=setup();void t.window.RpgForgeRitual.prepare(t.ov,gear,'',false,options());choose(t,'guaranteed');const check=t.ov.querySelector('.fr-auto-check'),start=t.ov.querySelector('.fr-auto-start');check.checked=true;check.onchange();assert.equal(start.disabled,true);await start.onclick();assert.equal(t.document.body.querySelector('dialog'),null);t.window.RpgForgeRitual.dispose();
});
test('both guaranteed inventory icons resolve to their dedicated pink weapon and armor scroll assets',()=>{
 const start=app.indexOf('  function artFile('),close=/\r?\n  \}/.exec(app.slice(start)),end=start+close.index+close[0].length,ctx=vm.createContext({});vm.runInContext(app.slice(start,end),ctx);assert.equal(ctx.artFile('item','guaranteed_scroll_w'),'/art/items-scrolls-pink-20261018/guaranteed_scroll_w.webp');assert.equal(ctx.artFile('item','guaranteed_scroll_a'),'/art/items-scrolls-pink-20261018/guaranteed_scroll_a.webp');for(const key of ['guaranteed_scroll_w','guaranteed_scroll_a'])assert.ok(fs.existsSync(new URL('../public/'+ctx.artFile('item',key),import.meta.url)));
 const iconStart=app.indexOf('  const iconHtml ='),iconEnd=app.indexOf('\n',iconStart),iconContext=vm.createContext({window:{},itemName:()=> '星輝武器必成卷',esc:s=>s,artSrc:()=>'/painted-scroll.webp'});vm.runInContext(app.slice(iconStart,iconEnd)+';globalThis.renderIcon=iconHtml;',iconContext);assert.match(iconContext.renderIcon('guaranteed_scroll_w','fallback'),/painted-scroll.webp/);assert.match(iconContext.renderIcon('guaranteed_scroll_w','fallback'),/必成100%/);assert.doesNotMatch(iconContext.renderIcon('guaranteed_scroll_w','fallback'),/fallback/);
});
test('armor guaranteed mode uses its matching painted scroll, and cancelling a drag leaves its single-use mode intact',async()=>{
 const t=setup(),armor={...gear,slot:'helmet',scroll:'scroll_a',blessedScroll:'blessed_scroll_a'},o={...options(),guaranteedKey:'guaranteed_scroll_a',guaranteedName:'星輝防具必成卷',guaranteedArt:'/art/items-scrolls-pink-20261018/guaranteed_scroll_a.webp'};void t.window.RpgForgeRitual.prepare(t.ov,armor,'',false,o);choose(t,'guaranteed');assert.match(t.ov.querySelector('.fr-scroll img').src,/guaranteed_scroll_a.webp$/);assert.match(t.ov.querySelector('.fr-scroll span').textContent,/星輝防具/);const scroll=t.ov.querySelector('.fr-scroll');scroll.onpointerdown({button:0,pointerId:1,clientX:0,preventDefault(){}});t.events.get('pointercancel')();assert.equal(t.ov.querySelector('input:checked').value,'guaranteed');assert.equal(t.ov.querySelector('.fr-auto').hidden,true);t.window.RpgForgeRitual.dispose();
});
test('forge sends exactly the selected mode and never auto-starts a guaranteed attempt',async()=>{
 for(const mode of ['ordinary','blessed','guaranteed']){
  const t=setup(),calls=[],data={me:{inventory:{scroll_w:8,blessed_scroll_w:3,guaranteed_scroll_w:2},equipment:[{...gear,enhance:6}],character:{gold:1000}}};const nodes={};t.ov.querySelector=selector=>selector==='.fr-auto'?null:nodes[selector]??=new Node();t.ov.querySelectorAll=selector=>selector==='[data-f]'?[done]:[];const done=new Node('button');done.dataset.f='done';
  const ctx=vm.createContext({window:{RpgForgeRitual:{prepare:async()=>({ready:true,blessed:mode==='blessed',guaranteed:mode==='guaranteed',autoTarget:mode==='guaranteed'?15:null}),reveal(){}}},document:t.document,$:()=>t.ov,S:data,forgeSession:0,attemptCost:()=>({ok:true,miss:0}),itemName:k=>k,eqIcon:()=>'',esc:s=>s,artSrc:()=>'/painted.webp',act:async(action,body)=>{calls.push({action,body});return {result:{result:'success',to:6}};},startAuto:()=>assert.fail('guaranteed mode started auto'),setTimeout:fn=>fn(),clearInterval(){},reducedMotion:()=>true,fmt:String,haptic(){},itemSheet(){},ELEM:{}});
  const start=app.indexOf('  const guaranteedScrollKey='),end=app.indexOf('  async function forgeAffixes(',start);vm.runInContext(app.slice(start,end),ctx);const result=ctx.forgeRun(gear,'enhance',null);await new Promise(r=>setImmediate(r));done.onclick();await result;assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{action:'enhance',body:{itemId:gear.id,...(mode==='guaranteed'?{guaranteed:true}:mode==='blessed'?{blessed:true}:{})}}]);
 }
});
test('equipment enhancement entry accepts matching guaranteed stock without gold or ordinary scrolls but rejects no stock and capped gear',()=>{
 const expression=app.match(/data-a="enhance" \$\{([^}]+)\}/)?.[1];assert.ok(expression,'equipment enhance button state expression must exist');
 const keyFunction=app.match(/const guaranteedScrollKey=[^\r\n]+/)?.[0];assert.ok(keyFunction);
 for(const e of [gear,{...gear,slot:'helmet',scroll:'scroll_a',blessedScroll:'blessed_scroll_a'}]){
  const key=e.slot==='weapon'?'guaranteed_scroll_w':'guaranteed_scroll_a',other=e.slot==='weapon'?'guaranteed_scroll_a':'guaranteed_scroll_w';
  for(const [label,inv,nx,affordable,expected] of [
   ['only matching rare scroll',{[key]:1},e.enhanceNext,false,''],
   ['no consumables or gold',{},e.enhanceNext,false,'disabled'],
   ['wrong equipment scroll',{[other]:1},e.enhanceNext,false,'disabled'],
   ['zero matching scroll',{[key]:0},e.enhanceNext,false,'disabled'],
   ['maximum enhancement',{[key]:2},null,false,'disabled'],
   ['ordinary remains affordable',{},e.enhanceNext,true,''],
   ['blessed remains available',{[e.blessedScroll]:1},e.enhanceNext,false,''],
  ]){const context=vm.createContext({e,inv,nx,ac:{ok:affordable}});vm.runInContext(keyFunction+';globalThis.buttonState=()=>('+expression+');',context);assert.equal(context.buttonState(),expected,e.slot+': '+label);}
 }
});
