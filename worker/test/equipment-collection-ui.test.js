import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/equipment-collection-ui.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

const flushUi=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
const attrUi=(tag,name)=>tag.match(new RegExp('(?:^|\\s)'+name+'="([^"]*)"'))?.[1]?.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
class UiRoot{
 constructor(document){this.document=document;this.nodes=[];this.scrollTop=0;this.listeners=new Map();this.html='';}
 set innerHTML(html){this.html=html;this.nodes=[...html.matchAll(/<(button|input|select|section)\b[^>]*>/g)].map(match=>{
  const tag=match[0],kind=match[1],root=this,dataset={};
  for(const [,key,value]of tag.matchAll(/\sdata-([a-z-]+)="([^"]*)"/g))dataset[key.replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=value;
  let value=attrUi(tag,'value')||'';
  if(kind==='select'){const end=html.indexOf('</select>',match.index),inside=html.slice(match.index+tag.length,end),options=[...inside.matchAll(/<option\b[^>]*>/g)].map(x=>x[0]);value=attrUi(options.find(x=>/\sselected(?:\s|>)/.test(x))||options[0]||'','value')||'';}
  return {root,kind,tag,dataset,value,name:attrUi(tag,'name')||'',disabled:/\sdisabled(?:\s|>)/.test(tag),checked:/\schecked(?:\s|>)/.test(tag),selectionStart:0,handlers:new Map(),
   addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,[]);this.handlers.get(type).push(fn);},
   focus(){root.document.activeElement=this;},setSelectionRange(a){this.selectionStart=a;},scrollIntoView(){}
  };
 });}
 get innerHTML(){return this.html;}
 contains(node){return this.nodes.includes(node);}
 querySelectorAll(selector){
  const selectors=selector.split(',').map(s=>s.trim());
  return this.nodes.filter(node=>selectors.some(s=>{
   if(s.startsWith('.'))return String(attrUi(node.tag,'class')||'').split(' ').includes(s.slice(1));
   if(s.startsWith('[')){const match=s.match(/^\[([a-zA-Z-]+)(?:="([^"]*)")?\]$/);if(!match)return false;return match[2]===undefined?new RegExp('(?:\\s|<)'+match[1]+'(?:\\s|=|>)').test(node.tag):attrUi(node.tag,match[1])===match[2];}
   return node.kind===s;
  }));
 }
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
 removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn));}
 async event(selector,type,props={}){
  const node=this.querySelector(selector);assert.ok(node,'Missing '+selector);
  if(node.disabled&&type==='click')return;Object.assign(node,props);
  const event={target:node,...props.event};
  if(node['on'+type])await node['on'+type](event);
  for(const fn of node.handlers.get(type)||[])await fn(event);
  await flushUi();
 }
 async scroll(value){this.scrollTop=value;for(const fn of this.listeners.get('scroll')||[])fn();await flushUi();}
}
function uiEnvironment(source,storage){
 const document={activeElement:null,hidden:false,baseURI:'https://preview.invalid/',querySelector:()=>({})};
 const root=new UiRoot(document),window={},timers=[];let serial=0;
 vm.runInNewContext(source,{window,document,URL,Intl,sessionStorage:storage,crypto:{randomUUID:()=> 'draft-operation-'+(++serial)},setInterval:fn=>{timers.push({fn,cleared:false});return timers.length-1;},clearInterval:id=>{if(timers[id])timers[id].cleared=true;}});
 return {root,window,timers,document};
}

function collectionView(context){
 return {ok:true,enabled:true,realmId:context.realmId,characterId:context.characterId,characterName:'收藏角色',level:30,completedCount:0,totalCount:12,bonusText:'攻擊 +0',collections:Array.from({length:12},(_,i)=>({
  id:'set-'+i,name:'收藏列 '+i,tier:2,minLevel:10,completed:false,filled:0,rewardText:'攻擊 +2',requirements:[{id:'req-'+i,name:'需求裝備 '+i,minEnhance:5,rarityName:'一般',registered:null,candidates:[{id:'gear-'+i,name:'收藏裝備 '+i,enhance:5}]}]
 }))};
}
function collectionMount({draft={},saved=storage(),context={accountId:'account-a',realmId:'permanent',characterId:'hero-a',epoch:1},override}={}){
 const env=uiEnvironment(source,saved),calls=[],changes=[];let ctx={...context},snapshot=collectionView(ctx);
 const host={draft,realmId:ctx.realmId,characterId:ctx.characterId,getContext:()=>ctx,current:()=>true,onChanged:data=>changes.push(data),artUrl:x=>x,
  request:async(action,payload)=>{calls.push({action,payload:payload?plain(payload):null});const custom=override?await override(action,payload):undefined;if(custom!==undefined)return custom;
   if(action==='equipment-collection')return plain(snapshot);
   if(action==='equipment-collection/preview'){const row=snapshot.collections.find(c=>c.id===payload.collectionId),r=row.requirements.find(x=>x.id===payload.requirementId),item=r.candidates.find(x=>x.id===payload.itemId),stats={atk:10,def:10,maxHp:100,maxMp:100,critBonus:0};return {ok:true,realmId:ctx.realmId,characterId:ctx.characterId,...plain(payload),token:'a'.repeat(64),collectionName:row.name,item:plain(item),warning:'此件裝備會消耗',comparison:{before:stats,after:stats},completesCollection:false,rewardText:row.rewardText};}
   if(action==='equipment-collection/submit'){const row=snapshot.collections.find(c=>c.id===payload.collectionId),r=row.requirements.find(x=>x.id===payload.requirementId);r.registered={enhance:5};r.candidates=[];row.filled++;return {...plain(snapshot),result:{itemId:payload.itemId}};}
   throw Error('Unexpected '+action);
  }};
 const module=env.window.RpgEquipmentCollection.mount(env.root,host);
 return {...env,module,calls,changes,draft,saved,setContext:value=>{ctx={...ctx,...value};},snapshot:()=>plain(snapshot),setSnapshot:value=>{snapshot=value;}};
}
test('legacy collection restores tier, status, page, chosen collection requirement and scroll after same-shell return',async()=>{
 const draft={},h=collectionMount({draft});await flushUi();
 await h.root.event('[name="gearbookTier"]','change',{value:'2'});await h.root.event('[name="gearbookFilter"]','change',{value:'all'});
 await h.root.event('[data-gearbook-page="1"]','click');await h.root.event('[data-gearbook-pick="set-7"]','click');
 await h.root.scroll(85);h.module.dispose();
 assert.equal(draft.collection.page,1);assert.deepEqual(plain(draft.collection.picker),{collectionId:'set-7',requirementId:'req-7'});
 const again=collectionMount({draft});await flushUi();
 assert.equal(again.root.querySelector('[name="gearbookTier"]').value,'2');assert.equal(again.root.querySelector('[name="gearbookFilter"]').value,'all');
 assert.match(again.root.innerHTML,/需求裝備 7/);assert.ok(again.root.querySelector('[data-gearbook-candidate="gear-7"]'));assert.equal(again.root.scrollTop,85);
 assert.equal(again.calls.length,1);assert.equal(again.timers.length,0);again.module.dispose();
});
test('legacy collection never restores confirmation token; back cancels confirmation then picker without submitting',async()=>{
 const draft={},h=collectionMount({draft});await flushUi();await h.root.event('[data-gearbook-pick="set-0"]','click');
 await h.root.event('[data-gearbook-candidate="gear-0"]','click');assert.match(h.root.innerHTML,/class="gearbook-confirm"/);
 assert.equal(h.module.handleBack(),true);assert.doesNotMatch(h.root.innerHTML,/class="gearbook-confirm"/);assert.ok(h.root.querySelector('[data-gearbook-candidate="gear-0"]'));
 await h.root.event('[data-gearbook-candidate="gear-0"]','click');h.module.dispose();
 const again=collectionMount({draft});await flushUi();assert.doesNotMatch(again.root.innerHTML,/class="gearbook-confirm"/);assert.ok(again.root.querySelector('[data-gearbook-candidate="gear-0"]'));
 assert.equal(again.module.handleBack(),true);assert.equal(again.module.handleBack(),false);assert.equal(again.calls.filter(c=>c.action.endsWith('/submit')).length,0);again.module.dispose();
});
test('legacy collection ignores draft across actor/realm/account/epoch and late views cannot overwrite another context',async()=>{
 const draft={},first=collectionMount({draft});await flushUi();await first.root.event('[name="gearbookFilter"]','change',{value:'all'});await first.root.event('[data-gearbook-pick="set-0"]','click');first.module.dispose();
 const second=collectionMount({draft,context:{accountId:'account-b',realmId:'season-a',characterId:'hero-b',epoch:2}});await flushUi();
 assert.equal(second.root.querySelector('[name="gearbookFilter"]').value,'incomplete');assert.equal(draft.collection.picker,null);second.module.dispose();
 const wait=deferred(),late=collectionMount({draft:{},override:action=>action==='equipment-collection'?wait.promise:undefined});const html=late.root.innerHTML;
 late.setContext({epoch:2});wait.resolve(collectionView({realmId:'permanent',characterId:'hero-a'}));await flushUi();assert.equal(late.root.innerHTML,html);assert.equal(late.changes.length,0);late.module.dispose();
});
test('legacy collection clears fulfilled or missing picker on refresh and after successful submit',async()=>{
 const h=collectionMount();await flushUi();await h.root.event('[data-gearbook-pick="set-0"]','click');
 const next=h.snapshot();next.collections[0].requirements[0].registered={enhance:5};h.setSnapshot(next);await h.module.refresh();
 assert.equal(h.draft.collection.picker,null);assert.doesNotMatch(h.root.innerHTML,/class="gearbook-picker"/);
 await h.root.event('[data-gearbook-pick="set-1"]','click');await h.root.event('[data-gearbook-candidate="gear-1"]','click');
 await h.root.event('[data-gearbook-ack]','change',{checked:true});await h.root.event('[data-gearbook-submit]','click');
 assert.equal(h.draft.collection.picker,null);assert.equal(h.changes.length,1);assert.equal(h.calls.filter(c=>c.action.endsWith('/submit')).length,1);h.module.dispose();
});
test('legacy collection close/back retain pending receipt and recovery sends exact original payload only on click',async()=>{
 const draft={},saved=storage(),writes=[];
 const override=async(action,payload)=>{if(action==='equipment-collection/submit'){writes.push(plain(payload));throw Object.assign(Error('response lost'),{uncertain:true});}};
 const h=collectionMount({draft,saved,override});await flushUi();await h.root.event('[data-gearbook-pick="set-0"]','click');await h.root.event('[data-gearbook-candidate="gear-0"]','click');await h.root.event('[data-gearbook-ack]','change',{checked:true});await h.root.event('[data-gearbook-submit]','click');
 const receipt=[...saved.values.values()][0];assert.equal(writes.length,1);assert.equal(h.module.handleBack(),true);assert.equal(h.module.handleBack(),false);h.module.dispose();
 const again=collectionMount({draft,saved,override});await flushUi();assert.equal(writes.length,1);assert.equal([...saved.values.values()][0],receipt);
 await again.root.event('[data-gearbook-recover]','click');assert.equal(writes.length,2);assert.deepEqual(writes[1],writes[0]);again.module.dispose();
});
test('legacy collection late successful submission after disposal retains receipt and cannot notify new actor',async()=>{
 const wait=deferred(),saved=storage(),h=collectionMount({saved,override:action=>action==='equipment-collection/submit'?wait.promise:undefined});await flushUi();
 await h.root.event('[data-gearbook-pick="set-0"]','click');await h.root.event('[data-gearbook-candidate="gear-0"]','click');await h.root.event('[data-gearbook-ack]','change',{checked:true});await h.root.event('[data-gearbook-submit]','click');
 const receipt=[...saved.values.values()][0];assert.ok(receipt);assert.equal(h.module.handleBack(),true);h.module.dispose();
 wait.resolve({...collectionView({realmId:'permanent',characterId:'hero-a'}),result:{itemId:'gear-0'}});await flushUi();
 assert.equal([...saved.values.values()][0],receipt);assert.equal(h.changes.length,0);
});
