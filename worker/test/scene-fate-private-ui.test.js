import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createClient, mount } from '../public/scene-fate-private-ui.js';

const SCOPE = {accountId:'editing-account',realmId:'permanent',characterId:'editing-character',epoch:1};
const NOW = Date.parse('2026-11-05T10:00:00Z');
const clone = value => JSON.parse(JSON.stringify(value));
const settle = async () => { await new Promise(resolve=>setImmediate(resolve)); await new Promise(resolve=>setImmediate(resolve)); };
const memoryStorage = () => { const rows=new Map(); return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)}; };
const decode = value => value.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');

// Like the existing Fate UI harness, assigning innerHTML disconnects the old
// controls and loses their focus. Element identity is the behavior under test.
class Root {
  constructor(doc) {
    this.ownerDocument=doc||documentForTest();this.events=new Map();this.controls=[];this.childNodes=[];
    this.scrollTop=0;this.isConnected=true;this.html='';this.assignments=0;this.parentNode=null;this.details=[];
  }
  contains(node) { return node===this || this.controls.includes(node) || this.details.includes(node) || this.childNodes.some(child=>child.contains?.(node)); }
  append(node) { node.parentNode?.removeChild(node);node.parentNode=this;this.childNodes.push(node); }
  removeChild(node) { this.childNodes=this.childNodes.filter(child=>child!==node);node.parentNode=null; }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(kind,fn) { this.events.set(kind,fn); }
  removeEventListener(kind) { this.events.delete(kind); }
  get innerHTML() { return this.html; }
  set innerHTML(html) {
    if(this.contains(this.ownerDocument.activeElement)) {
      this.ownerDocument.disconnects++;this.ownerDocument.activeElement=this.ownerDocument.body;
    }
    for(const child of this.childNodes)child.parentNode=null;
    this.html=html;this.assignments++;this.controls=[];this.childNodes=[];this.slot=null;this.details=[];
    for(const [,attrs]of html.matchAll(/<details\b([^>]*)>/g)) {
      const value=attrs.match(/data-sfp-details="([^"]*)"/)?.[1];
      if(value)this.details.push({tagName:'DETAILS',dataset:{sfpDetails:decode(value)},open:/(?:^|\s)open(?:\s|$)/.test(attrs)});
    }
    for(const match of html.matchAll(/<(button|input|select|textarea)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)) {
      const attrs=match[2],dataset={};
      for(const [,key,value]of attrs.matchAll(/\bdata-([a-z0-9-]+)="([^"]*)"/g))dataset[key.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=decode(value);
      const root=this,control={dataset,root,tagName:match[1].toUpperCase(),value:decode(attrs.match(/value="([^"]*)"/)?.[1]||''),disabled:/(?:^|\s)disabled(?:\s|$)/.test(attrs),checked:/(?:^|\s)checked(?:\s|$)/.test(attrs),selectionStart:0,selectionEnd:0,
        focus(){if(!this.disabled)root.ownerDocument.activeElement=this;},
        setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
        closest(selector){if(selector==='[data-sfp-action]'&&dataset.sfpAction||selector==='[data-sf-action]'&&dataset.sfAction)return this;return null;}
      };
      this.controls.push(control);
    }
    if(html.includes('data-sf-private-slot')){this.slot=new Root(this.ownerDocument);this.append(this.slot);}
  }
  querySelectorAll(selector) {
    const controls=[...this.controls,...this.childNodes.flatMap(child=>child.querySelectorAll?.('button,input,select,textarea')||[])];
    if(selector==='button,input,select,textarea')return controls;
    const match=selector.match(/^\[data-([a-z-]+)="([^"]*)"\]$/);
    if(!match)return [];
    const key=match[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
    return [...controls,...this.details].filter(control=>control.dataset[key]===match[2]);
  }
  querySelector(selector) {
    if(selector==='[data-sf-private-slot]')return this.slot;
    if(selector==='[data-sfp-confirm]'||selector==='[data-sf-confirm]')return null;
    return this.querySelectorAll(selector)[0]||null;
  }
  field(key) { return this.querySelector('[data-sfp-field="'+key+'"]'); }
  async fire(kind,target,extra={}) { return this.events.get(kind)?.({target,...extra}); }
  setAttribute() {}
}
function documentForTest() {
  const doc={body:{kind:'body'},activeElement:null,hidden:false,baseURI:'http://127.0.0.1:9803/',disconnects:0,events:new Map(),head:{append(){}},
    createElement(tag){return tag==='div'?new Root(doc):{};},
    addEventListener(kind,fn){if(!doc.events.has(kind))doc.events.set(kind,new Set());doc.events.get(kind).add(fn);},
    removeEventListener(kind,fn){doc.events.get(kind)?.delete(fn);}
  };
  doc.activeElement=doc.body;return doc;
}
function scene({revision=1,generation=0}={}) {
  const profile={saved:false,rev:0,updatedAt:null},daily={day:'2026-11-05',materialized:false,rev:0,createdAt:null};
  return {ok:true,now:NOW,accountId:SCOPE.accountId,realmId:SCOPE.realmId,characterId:SCOPE.characterId,revision,
    privateFate:{day:daily.day,profile:{...profile,coverage:'inspiration'},daily:{...daily,profileRevision:0,unlocked:0,unlocks:[],notes:[]},
      evidence:{available:[],pending:[]},domain:{version:1,generation,profile,daily,token:'domain-'+generation},control:{realmPhase:'ACTIVE',writable:true},history:{receipts:[]}}};
}
async function harness(t) {
  const intervals=new Map();let timer=0;
  t.mock.method(globalThis,'setInterval',(fn,ms)=>{const id=++timer;intervals.set(id,{fn,ms});return id;});
  t.mock.method(globalThis,'clearInterval',id=>intervals.delete(id));
  let context={...SCOPE},reply=scene(),held=null;
  const root=new Root(),calls=[];
  const host={storage:memoryStorage(),getContext:()=>context,current:()=>true,
    request:async(action,body)=>{
      calls.push(action);assert.equal(action,'fate/private/scene','editing must only issue the pure read');
      if(held){const wait=held;held=null;await wait;}
      return {...clone(reply),readSequence:body.readSequence};
    }};
  const view=mount(root,host);t.after(()=>view.dispose());await settle();
  assert.equal(view.client.state.stale,false);
  return {root,view,calls,intervals,context:value=>{context=value;},reply:value=>{reply=value;},hold:()=>{let release;held=new Promise(resolve=>{release=resolve;});return release;},
    async type(key,value,{composing=false}={}) {
      const field=root.field(key);assert.ok(field,'expected field');field.focus();field.value=value;field.selectionStart=value.length;field.selectionEnd=value.length;
      if(composing)await root.fire('compositionstart',field);
      await root.fire('input',field,{isComposing:composing});return field;
    }};
}

test('background private reads retain the focused form control while freshness still blocks writes',async t=>{
  const h=await harness(t),field=await h.type('date','2000-02-29'),before=h.root.ownerDocument.disconnects;
  const release=h.hold(),reading=h.view.client.refresh();
  assert.ok(h.root.field('date')===field,'pending pure read must keep the same input node');
  assert.ok(h.root.ownerDocument.activeElement===field,'pending pure read must keep keyboard focus');
  assert.equal(h.root.ownerDocument.disconnects,before,'pending read must not disconnect focused controls');
  assert.equal(h.view.client.prepareSave({date:'2000-02-29'},true),false,'a deferred paint must not relax the freshness guard');
  release();assert.equal(await reading,true);await settle();
  assert.ok(h.root.field('date')===field,'completed pure read must keep the same input node');
  assert.ok(field.value==='2000-02-29','editing value must remain in memory');
  assert.ok(h.calls.every(action=>action==='fate/private/scene'));
});

test('IME keeps its node through background revision updates and clear/scope invalidation overrides editing',async t=>{
  const h=await harness(t),place=h.root.field('placeId');place.focus();place.value='custom';await h.root.fire('change',place);
  const field=await h.type('placeLabel','合成',{composing:true}),before=h.root.ownerDocument.disconnects;
  h.reply(scene({revision:2}));h.view.update({...SCOPE,revision:2});await settle();
  assert.ok(h.root.field('placeLabel')===field,'background update must retain the composing input node');
  assert.ok(h.root.ownerDocument.activeElement===field,'composition retains focus');
  assert.equal(h.root.ownerDocument.disconnects,before,'composition is never detached during background paint');
  field.value='合成地點';await h.root.fire('input',field,{isComposing:true});await h.root.fire('compositionend',field);await settle();
  assert.ok(h.root.field('placeLabel')===field,'composition end does not interrupt continued editing');
  assert.ok(field.value==='合成地點','final composed value is retained');
  h.view.client.clearPrivate();
  assert.ok(!h.root.contains(field),'explicit clear must remove the old private DOM immediately');
  await h.view.client.refresh();await settle();
  const next=await h.type('date','2001-07-14',{composing:true});
  h.context({...SCOPE,characterId:'other-character',epoch:2});h.view.update({...SCOPE,characterId:'other-character',revision:3});
  assert.ok(!h.root.contains(next),'scope invalidation must remove focused private DOM immediately');
  assert.equal(h.root.innerHTML,'','old scope must not keep private content visible');
});

test('automatic polling waits while an input is being edited and resumes after leaving the field',async t=>{
  const h=await harness(t);await h.type('date','2000-02-29');const count=h.calls.length;
  for(const {fn,ms}of h.intervals.values())if(ms===15000)fn();await settle();
  assert.equal(h.calls.length,count,'editing defers periodic private refresh');
  h.root.ownerDocument.activeElement=h.root.ownerDocument.body;
  for(const {fn,ms}of h.intervals.values())if(ms===15000)fn();await settle();
  assert.equal(h.calls.length,count+1,'polling resumes when the field is no longer active');
});

test('unrelated F1 paints keep the mounted private subtree connected',async t=>{
  const source=fs.readFileSync(new URL('../public/scene-fate-ui.js',import.meta.url),'utf8');
  const sandbox={console,URL,Date,AbortController,crypto:globalThis.crypto,setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  const root=new Root();let childRoot;
  const host={storage:memoryStorage(),getContext:()=>({...SCOPE}),current:()=>true,request:()=>new Promise(()=>{}),
    privateFate:{mount(child){childRoot=child;child.innerHTML='<input data-sfp-field="placeLabel" value="">';return {client:{state:{busy:false}},dispose(){child.innerHTML='';},update(){},refresh(){}};}}};
  const view=sandbox.RpgSceneFate.mount(root,host,{section:'private'});t.after(()=>view.dispose());await settle();
  const field=childRoot.field('placeLabel');field.focus();field.value='合成';const before=root.ownerDocument.disconnects,paints=root.assignments;
  view.client.feedback('Public state update');await settle();
  assert.equal(root.assignments,paints,'F1 notification must not rebuild the parent while the private child is mounted');
  assert.equal(root.ownerDocument.disconnects,before,'F1 notification must not detach the composing subtree');
  assert.ok(root.ownerDocument.activeElement===field,'private input keeps focus during F1 notifications');
});

test('F1 pending corruption blocks the first F2 preparation and restoring storage clears that block',async t=>{
  const source=fs.readFileSync(new URL('../public/scene-fate-ui.js',import.meta.url),'utf8');
  const sandbox={console,URL,Date,AbortController,crypto:globalThis.crypto,setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  const root=new Root(),storage=memoryStorage(),calls=[];
  const identity=JSON.stringify([SCOPE.accountId,SCOPE.realmId,SCOPE.characterId]),key='rpg-sf-pending:'+identity;
  let privateClient,externalBlock='';
  const host={storage,getContext:()=>({...SCOPE}),current:()=>true,mutationBlock:()=>externalBlock,
    request:(action,body)=>{
      calls.push(action);
      if(action==='fate/private/scene')return Promise.resolve({...scene(),readSequence:body.readSequence});
      assert.equal(action,'fate/scene','interlock checking must not issue a mutation');
      return new Promise(()=>{});
    },
    privateFate:{mount(child,privateHost){
      privateClient=createClient({...privateHost,onState(){}});
      return {client:privateClient,dispose:()=>privateClient.dispose(),update:privateClient.update,refresh:privateClient.refresh};
    }}
  };
  const view=sandbox.RpgSceneFate.mount(root,host,{section:'private'});t.after(()=>view.dispose());await settle();
  assert.equal(await privateClient.refresh(),true);
  const prepare=()=>privateClient.prepareSave({date:'2000-02-29'},true);
  assert.equal(prepare(),true,'an empty peer slot permits preparing a new intent');privateClient.cancel();
  externalBlock='Another operation requires review';
  assert.equal(prepare(),false,'the original external block remains authoritative');externalBlock='';
  const body={requestId:'f1-pending-fixture',mode:'random',country:'TW',showSign:false,socialInvite:false};
  const record={version:1,scope:identity,context:{accountId:SCOPE.accountId,realmId:SCOPE.realmId,characterId:SCOPE.characterId},
    id:body.requestId,kind:'start',body,wireBody:{kind:'start',...body,realmId:SCOPE.realmId,selectedCharacterId:SCOPE.characterId},
    signature:sandbox.RpgSceneFate.signature('start',body),label:'Original F1 intent',details:'',at:NOW,revealed:true};
  assert.equal(sandbox.RpgSceneFate.validRecord(record,identity),true);
  storage.setItem(key,JSON.stringify(record));
  assert.equal(prepare(),false,'an intact F1 pending intent still blocks F2');
  storage.removeItem(key);assert.equal(view.client.pending(),null);
  assert.equal(view.client.state.storageError,'','the next failure must be discovered by the first F2 check');
  const damaged='{';
  storage.setItem(key,damaged);
  assert.equal(prepare(),false,'the first F2 preparation must reject newly corrupted F1 storage');
  assert.ok(view.client.state.storageError,'the real F1 client must observe the new storage failure');
  assert.equal(privateClient.state.confirm,null,'corruption must not create a new confirmation');
  assert.equal(storage.getItem(key),damaged,'the damaged peer bytes remain untouched');
  assert.equal(storage.getItem('rpg-sfp-pending:'+identity),null,'no F2 pending intent was persisted');
  assert.ok(calls.every(action=>['fate/scene','fate/private/scene'].includes(action)),'interlock remains read-only');
  storage.removeItem(key);
  assert.equal(prepare(),true,'the first check after deliberate storage repair must re-read the peer slot');
  privateClient.cancel();
});

test('custom birthplace changes preserve native details expansion before toggle delivery',async t=>{
  const h=await harness(t),details=h.root.querySelector('[data-sfp-details="more"]');
  assert.equal(details.open,false,'optional birth fields begin collapsed');
  // Native details state changes before its queued toggle event is delivered.
  details.open=true;
  const place=h.root.field('placeId');place.focus();place.value='custom';
  await h.root.fire('input',place);await h.root.fire('change',place);
  const expanded=h.root.querySelector('[data-sfp-details="more"]');
  assert.equal(expanded.open,true,'changing place must preserve the currently expanded optional fields');
  assert.ok(h.root.field('placeLabel'),'custom birthplace fields remain present in the expanded section');
  assert.ok(h.root.ownerDocument.activeElement===h.root.field('placeId'),'structural change restores the place selector focus');
  await h.root.fire('toggle',expanded);
  h.view.client.clearPrivate();await h.view.client.refresh();await settle();
  assert.equal(h.root.querySelector('[data-sfp-details="more"]').open,false,'clearing private inputs resets expansion');
  assert.equal(h.root.field('placeLabel'),null,'clearing private inputs removes custom birthplace fields');
  assert.ok(h.calls.every(action=>action==='fate/private/scene'),'changing and clearing the form issue only pure reads');
});
