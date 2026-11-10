import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/scene-atlas-guide.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const drain=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const decode=value=>String(value||'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function attrs(text){const out={};for(const m of text.matchAll(/([\w-]+)(?:="([^"]*)"|'([^']*)')?/g))out[m[1]]=decode(m[2]??m[3]??'');return out;}
function fakeBody(document){
  class Node{
    constructor(attributes={},form=null){this.attributes=attributes;this.name=attributes.name||'';this.type=attributes.type||'';this.value=attributes.value||'';this.checked=Object.hasOwn(attributes,'checked');this.disabled=Object.hasOwn(attributes,'disabled');this.form=form;this.dataset={};this.listeners=new Map();this.textContent='';this.selectionStart=null;this.selectionEnd=null;this.selectionDirection='none';
      for(const[key,value]of Object.entries(attributes))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
    }
    addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
    removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(f=>f!==fn));}
    fire(type){const event={type,target:this,preventDefault(){},stopImmediatePropagation(){}};if(type==='click')this.onclick?.(event);for(const fn of this.listeners.get(type)||[])fn(event);if(this.form)for(const fn of this.form.listeners.get(type)||[])fn(event);}
    focus(){document.activeElement=this;}
    setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;}
    scrollIntoView(){}
    dispatchEvent(){throw Error('guide must not dispatch synthetic form events');}
  }
  class Form extends Node{
    constructor(attributes){super(attributes);this.fields=[];this.elements={};}
    querySelectorAll(selector){return find(this.fields,selector);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  }
  function matches(node,selector){
    if(selector==='[name]')return !!node.name;
    const m=selector.match(/^\[([\w-]+)(?:="([^"]*)")?\](:checked)?$/);
    return !!m&&Object.hasOwn(node.attributes,m[1])&&(m[2]===undefined||node.attributes[m[1]]===m[2])&&(!m[3]||node.checked);
  }
  const find=(nodes,selector)=>nodes.filter(node=>matches(node,selector));
  function fields(html,form=null){
    const out=[];
    for(const match of html.matchAll(/<input\b([^>]*)>/g))out.push(new Node(attrs(match[1]),form));
    for(const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)){
      const node=new Node({...attrs(match[1]),type:'select-one'},form);
      const options=[...match[2].matchAll(/<option\b([^>]*)>/g)].map(m=>attrs(m[1]));
      node.value=(options.find(o=>Object.hasOwn(o,'selected'))||options.find(o=>!Object.hasOwn(o,'disabled'))||{}).value||'';
      out.push(node);
    }
    return out;
  }
  const body=new Node();body.scrollTop=0;body.writes=0;body.forms=[];body.nodes=[];body.canvas=null;body.svg={style:{}};
  body.closest=()=>null;
  body.contains=node=>body.nodes.includes(node)||body.forms.some(form=>form.fields.includes(node))||node===body.canvas;
  body.querySelectorAll=selector=>{
    if(selector==='.atlas-talent-canvas')return body.canvas?[body.canvas]:[];
    if(selector==='.atlas-talent-canvas svg')return body.canvas?[body.svg]:[];
    return find([...body.forms,...body.nodes],selector);
  };
  body.querySelector=selector=>body.querySelectorAll(selector)[0]||null;
  Object.defineProperty(body,'innerHTML',{get(){return this.html||'';},set(html){
    this.html=html;this.writes++;this.forms=[];this.nodes=[];
    let remaining=html;
    for(const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)){
      const form=new Form(attrs(match[1]));form.fields=fields(match[2],form);
      for(const name of new Set(form.fields.map(field=>field.name))){const group=form.fields.filter(field=>field.name===name);form.elements[name]=group.length===1?group[0]:{get value(){return group.find(field=>field.checked)?.value||'';}};}
      this.forms.push(form);this.nodes.push(...form.fields);remaining=remaining.replace(match[0],'');
    }
    this.nodes.push(...fields(remaining));
    for(const match of html.matchAll(/<button\b([^>]*)>/g))this.nodes.push(new Node(attrs(match[1])));
    for(const match of html.matchAll(/<(?:p|span|small)\b([^>]*data-guide-[^>]*)>([^<]*)/g)){const node=new Node(attrs(match[1]));node.textContent=decode(match[2]);this.nodes.push(node);}
    this.canvas=html.includes('class="atlas-talent-canvas"')?Object.assign(new Node(),{scrollLeft:0,scrollTop:0,scrollWidth:900,clientWidth:400}):null;
  }});
  return body;
}
class FakeFormData{
  constructor(form){this.pairs=form.fields.filter(field=>!field.disabled&&(!['checkbox','radio'].includes(field.type)||field.checked)).map(field=>[field.name,field.value]);}
  get(name){return this.pairs.find(([key])=>key===name)?.[1]??null;}
  getAll(name){return this.pairs.filter(([key])=>key===name).map(([,value])=>value);}
}
const catalog={
  builds:[{id:'build-a',baseClass:'sword',name:'迴旋',mainSkill:'攻擊',tags:['attack']},{id:'build-b',baseClass:'sword',name:'法印',mainSkill:'符刃',tags:['spell']}],
  supports:[{id:'support-any',name:'加速',description:'通用',requires:[]},{id:'support-spell',name:'擴張',description:'法術',requires:['spell']}],
  automation:[{id:'balanced',name:'均衡',description:'保留魔力'},{id:'burst',name:'爆發',description:'優先施放'}],
  maps:[{id:'map-a',name:'月桂',available:true,minLevel:1},{id:'map-b',name:'石柱',available:true,minLevel:2}],
  materials:[{id:'dust',name:'碎片'}],maxCraftsPerItem:3,
  recipes:[{id:'recipe-a',name:'攻擊銘刻',description:'附加攻擊',cost:{dust:2}},{id:'recipe-b',name:'防禦銘刻',description:'附加防禦',cost:{dust:3}}]
};
function status(run=null){return {profile:{buildId:'build-a',supportIds:[],automation:'balanced'},run,canStart:true,supplies:{hp:30,mp:20},availableMapIds:['map-a','map-b'],equipment:[{id:'gear-a',name:'長劍',enhanceLevel:3,crafts:0},{id:'gear-b',name:'盔甲',enhanceLevel:5,crafts:1}],materials:{dust:20},talents:{revision:1,catalog:{nodes:[{id:'node-a',name:'力量',description:'攻擊增加'}]}}};}
function run(overrides={}){return {id:'run-a',status:'running',mapId:'map-a',completedMaps:1,startedAt:0,endsAt:600000,processedAt:30000,progress:{processedSeconds:30,elapsedSeconds:30},report:{kills:5,metrics:{mapsCompleted:1}},supplies:{hp:8,mp:9},...overrides};}
function scene(overrides={}){return {schemaVersion:1,realmId:'permanent',accountId:'account-a',characterId:'hero-a',serverNow:60000,live:{revision:2,supplies:{hp:28,mp:18}},run:{id:'run-a',status:'running',active:true,realmId:'permanent',characterId:'hero-a',revision:2,processedAt:60000,processedSeconds:60,report:{kills:12,metrics:{mapsCompleted:2}},supplies:{hp:6,mp:7}},...overrides};}
function harness(initial='expedition',options={}){
  const calls=[],store=new Map(),rendered=[],document={activeElement:null},body=fakeBody(document),draft=options.draft||{};
  let currentStatus=options.state||status(),context={accountId:'account-a',realmId:'permanent',characterId:'hero-a',epoch:1},actor={tgId:'hero-a',name:'調查員',level:15,baseClass:'sword',partyId:null};
  let handler=options.handler;
  const sandbox={document,FormData:FakeFormData,crypto:{randomUUID:()=> 'original-atlas-request'},sessionStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},window:{
    RpgAtlasTalents:{render(talents,view){rendered.push(plain(view));return '<input type="range" name="talentZoom" value="'+view.zoom+'"><div class="atlas-talent-canvas"><svg></svg></div><button data-talent-node="node-a">力量</button><div class="atlas-talent-detail"></div>';}},
    RpgAtlasProgression:{render(){return '<button data-growth-open="workshop">銘刻</button><button data-growth-open="build">構築</button><button data-growth-open="talents">天賦</button><button data-growth-open="progression">路線</button><button data-growth-open="expedition">派遣</button><button data-growth-map="map-b">石柱</button>';}}
  }};
  vm.runInNewContext(source,sandbox,{filename:'scene-atlas-guide.js'});
  const host={actor:{...actor},realmId:'permanent',mapId:'map-a',draft,getActor:()=>actor,getContext:()=>context,current:()=>true,
    request:async(action,payload)=>{calls.push({action,payload:payload&&plain(payload)});const value=await handler?.(action,payload);if(value!==undefined)return value;
      if(action==='atlas/catalog')return {catalog};if(action==='atlas/status')return plain(currentStatus);
      if(action==='atlas/talents/preview')return {nodeId:payload.nodeId,baseRevision:1,plan:{canApply:false}};
      if(action==='atlas/configure'){currentStatus.profile={buildId:payload.buildId,supportIds:plain(payload.supportIds),automation:payload.automation};return {ok:true};}
      if(action==='atlas/craft')return {ok:true};throw Error('Unexpected mutation '+action);
    },...(options.navigate?{navigate:options.navigate}:{})};
  let view=sandbox.window.RpgSceneAtlasGuide.mount(body,host,initial);
  return {calls,store,rendered,document,body,draft,host,get view(){return view;},setState:value=>currentStatus=value,setHandler:value=>handler=value,setContext:value=>{context={...context,...value};actor={...actor,tgId:context.characterId};},
    remount(route=initial){view.dispose();body.innerHTML='';body.scrollTop=0;view=sandbox.window.RpgSceneAtlasGuide.mount(body,host,route);return view;}};
}
const field=(h,name)=>h.body.querySelectorAll('[name]').find(node=>node.name===name);
const form=(h,name)=>h.body.querySelector('[data-guide-'+name+']');

test('dispatch draft preserves real minutes and supplies through cancel, refresh, focus restoration and remount',async()=>{
  const h=harness();await drain();
  for(const[name,value]of [['mapId','map-b'],['minutes','37'],['hp','0'],['mp','7']]){const input=field(h,name);input.value=value;input.fire('input');}
  const minutes=field(h,'minutes');minutes.selectionStart=1;minutes.selectionEnd=2;minutes.selectionDirection='forward';minutes.focus();h.body.scrollTop=187;
  form(h,'start').fire('submit');assert.match(h.body.innerHTML,/scene-guide-confirm/);assert.equal(h.view.handleBack(),true);assert.equal(h.view.handleBack(),false);
  assert.equal(h.calls.some(call=>call.action==='atlas/start'),false);assert.equal(field(h,'minutes').value,'37');assert.equal(field(h,'hp').value,'0');
  await h.view.refresh();assert.equal(h.document.activeElement,field(h,'minutes'));assert.equal(field(h,'minutes').selectionStart,1);assert.equal(field(h,'minutes').selectionEnd,2);
  field(h,'minutes').value='';field(h,'minutes').fire('input');await h.view.refresh();assert.equal(field(h,'minutes').value,'','an in-progress empty number must not reset to ten');
  field(h,'minutes').value='37';field(h,'minutes').fire('input');h.remount();await drain();
  assert.deepEqual(plain(h.draft.forms.start),{mapId:'map-b',minutes:'37',hp:'0',mp:'7'});assert.equal(field(h,'minutes').value,'37');assert.equal(h.body.scrollTop,187);h.view.dispose();
});

test('build selections survive a server refresh and submit only the chosen compatible configuration',async()=>{
  const h=harness('build');await drain();
  field(h,'buildId').value='build-b';field(h,'buildId').fire('change');
  for(const input of h.body.querySelectorAll('[name="supportIds"]')){input.checked=true;input.fire('change');}
  field(h,'automation').value='burst';field(h,'automation').fire('change');
  await h.view.refresh();
  assert.equal(field(h,'buildId').value,'build-b');assert.equal(field(h,'automation').value,'burst');
  assert.equal(h.body.querySelectorAll('[name="supportIds"]:checked').length,2);
  form(h,'build').fire('submit');await drain();
  const writes=h.calls.filter(call=>call.action==='atlas/configure');assert.equal(writes.length,1);
  assert.deepEqual(writes[0].payload,{buildId:'build-b',supportIds:['support-any','support-spell'],automation:'burst',requestId:'original-atlas-request'});
  assert.equal(field(h,'buildId').value,'build-b');assert.equal(h.store.size,0);h.view.dispose();
});

test('craft draft retains item and recipe through both cancellation paths and same-context reopening',async()=>{
  const h=harness('workshop');await drain();
  field(h,'itemId').value='gear-b';field(h,'itemId').fire('change');
  const recipe=h.body.querySelectorAll('[name="recipeId"]').find(input=>input.value==='recipe-b');recipe.checked=true;recipe.fire('change');
  form(h,'craft').fire('submit');h.body.querySelector('[data-guide-cancel]').fire('click');
  await h.view.refresh();form(h,'craft').fire('submit');assert.equal(h.view.handleBack(),true);
  h.remount();await drain();assert.equal(field(h,'itemId').value,'gear-b');
  assert.equal(h.body.querySelectorAll('[name="recipeId"]:checked')[0].value,'recipe-b');
  assert.equal(h.calls.some(call=>call.action==='atlas/craft'),false);h.view.dispose();
});

test('talent selection zoom and canvas/body scroll survive refresh and route remount without change dispatch',async()=>{
  const h=harness('talents');await drain();
  h.body.querySelector('[data-talent-node]').fire('click');await drain();
  field(h,'talentZoom').value='117';field(h,'talentZoom').fire('input');
  h.body.canvas.scrollLeft=402;h.body.canvas.scrollTop=321;h.body.canvas.fire('scroll');h.body.scrollTop=211;h.body.fire('scroll');
  await h.view.refresh();assert.equal(h.body.canvas.scrollLeft,402);assert.equal(h.body.canvas.scrollTop,321);
  h.remount();await drain();assert.equal(field(h,'talentZoom').value,'117');assert.equal(h.rendered.at(-1).selectedId,'node-a');
  assert.equal(h.body.canvas.scrollLeft,402);assert.equal(h.body.canvas.scrollTop,321);assert.equal(h.body.scrollTop,211);
  h.view.dispose();
  const other=harness('talents',{draft:{}});await drain();assert.equal(other.rendered.at(-1).selectedId,null);assert.equal(field(other,'talentZoom').value,'75');other.view.dispose();
});

test('host navigation maps the inscription route and carries maps while old hosts retain local navigation',async()=>{
  const navigations=[],h=harness('progression',{navigate:(route,params)=>navigations.push([route,plain(params)])});await drain();
  for(const input of h.body.querySelectorAll('[data-growth-open]'))input.fire('click');
  assert.deepEqual(navigations.map(([route])=>route),['inscription','build','talents','progression','expedition']);
  assert.ok(navigations.every(([,params])=>params.mapId==='map-a'));
  h.body.querySelector('[data-growth-map]').fire('click');assert.deepEqual(navigations.at(-1),['expedition',{mapId:'map-b'}]);h.view.dispose();
  const legacy=harness('progression');await drain();
  legacy.body.querySelectorAll('[data-growth-open]').find(button=>button.dataset.growthOpen==='workshop').fire('click');
  assert.ok(form(legacy,'craft'));assert.match(legacy.body.innerHTML,/定向銘刻工坊/);legacy.view.dispose();
});

test('committed running updates preserve form nodes and only run transitions trigger one bounded status refresh',async()=>{
  const h=harness('expedition',{state:status(run())});await drain();
  const minutes=field(h,'minutes');minutes.value='93';minutes.fire('input');minutes.focus();
  const writes=h.body.writes,requests=h.calls.length;
  assert.equal(h.view.update(scene()),true);assert.equal(h.body.writes,writes);assert.equal(h.calls.length,requests);assert.equal(field(h,'minutes'),minutes);assert.equal(h.document.activeElement,minutes);
  assert.match(h.body.querySelector('[data-guide-run-summary]').textContent,/通關 2 張 · 擊倒 12 隻/);
  assert.match(h.body.querySelector('[data-guide-run-supplies]').textContent,/紅 6 \/ 藍 7/);assert.match(h.body.querySelector('[data-guide-available-hp]').textContent,/28/);
  assert.equal(h.view.update(scene({realmId:'other'})),false);assert.equal(h.body.writes,writes);
  const held=deferred();let reads=0;h.setHandler(action=>action==='atlas/status'?(reads++,held.promise):undefined);
  const ended=scene();ended.live.revision=3;ended.run={...ended.run,status:'completed',active:false,revision:3};
  for(let i=0;i<8;i++)h.view.update(ended);
  assert.equal(reads,1);held.resolve(status(run({status:'completed'})));await drain();
  for(let i=0;i<8;i++)h.view.update(ended);assert.equal(reads,1);assert.equal(field(h,'minutes').value,'93');assert.equal(h.calls.some(call=>call.action==='me'),false);
  h.setContext({epoch:3});assert.equal(h.view.update(scene()),false);h.view.dispose();
});

test('a failed transition read retries on the next identical healthy scene and deduplicates after recovery',async()=>{
  const h=harness('expedition',{state:status(run())});await drain();
  field(h,'minutes').value='73';field(h,'minutes').fire('input');
  field(h,'hp').value='0';field(h,'hp').fire('input');field(h,'minutes').focus();
  const first=deferred(),retry=deferred();let reads=0;
  h.setHandler(action=>action==='atlas/status'?(++reads===1?first.promise:retry.promise):undefined);
  const ended=scene();ended.live.revision=3;ended.run={...ended.run,status:'completed',active:false,revision:3};
  for(let i=0;i<8;i++)h.view.update(ended);
  assert.equal(reads,1);
  const manual=h.view.refresh();assert.equal(manual,h.view.refresh(),'manual refresh joins the in-flight transition read');
  first.reject(Error('temporary status outage'));await manual;await drain();
  assert.equal(reads,1);assert.match(h.body.innerHTML,/temporary status outage/);
  assert.equal(field(h,'minutes').value,'73');assert.equal(field(h,'hp').value,'0');
  assert.equal(h.view.update(ended),true,'the same committed scene can retry after a failed read');
  for(let i=0;i<8;i++)h.view.update(ended);assert.equal(reads,2);
  retry.resolve(status(run({status:'completed'})));await drain();
  assert.match(h.body.querySelector('[data-guide-run-summary]').textContent,/已結束/);
  assert.doesNotMatch(h.body.innerHTML,/temporary status outage/);
  assert.equal(field(h,'minutes').value,'73');assert.equal(field(h,'hp').value,'0');
  assert.equal(h.document.activeElement,field(h,'minutes'));
  for(let i=0;i<8;i++)assert.equal(h.view.update(ended),false);
  assert.equal(reads,2);assert.equal(h.calls.some(call=>call.action==='me'),false);h.view.dispose();
});

test('a committed build keeps its draft through a failed status read and adopts the recovered saved profile',async()=>{
  const h=harness('build');await drain();
  field(h,'buildId').value='build-b';field(h,'buildId').fire('change');
  field(h,'automation').value='burst';field(h,'automation').fire('change');
  let reads=0;h.setHandler(action=>action==='atlas/status'&&++reads===1?Promise.reject(Error('status unavailable after commit')):undefined);
  form(h,'build').fire('submit');await drain();
  assert.equal(h.calls.filter(call=>call.action==='atlas/configure').length,1);
  assert.equal(h.store.size,0,'the acknowledged operation must not become an uncertain write');
  assert.match(h.body.innerHTML,/status unavailable after commit/);
  assert.equal(field(h,'buildId').value,'build-b');assert.equal(field(h,'automation').value,'burst');
  assert.ok(h.draft.submittedForms.build,'clear is deferred until a fresh status exists');
  await h.view.refresh();
  assert.equal(field(h,'buildId').value,'build-b');assert.equal(field(h,'automation').value,'burst');
  assert.deepEqual(plain(h.draft.submittedForms),{});assert.doesNotMatch(h.body.innerHTML,/status unavailable after commit/);

  // A later edit made while another acknowledged save is awaiting status is still a draft.
  field(h,'buildId').value='build-a';field(h,'buildId').fire('change');
  reads=0;form(h,'build').fire('submit');await drain();
  field(h,'buildId').value='build-b';field(h,'buildId').fire('change');
  await h.view.refresh();assert.equal(field(h,'buildId').value,'build-b');
  assert.equal(h.calls.filter(call=>call.action==='atlas/configure').length,2);h.view.dispose();
});


const potionKeys=['red_1','red_2','red_3','red_4','blue_1','blue_2','blue_3','blue_4'];
const supplyPolicy={hpPreference:'auto',mpPreference:'blue_2',hpThresholdPct:63,mpThresholdPct:47,autoBlue:true};
catalog.supplyRules={version:'atlas-supplies-v1',maxPerKind:500,potions:potionKeys.map((id,index)=>({id,name:(index<4?'紅水':'藍水')+'實名'+(index%4+1),kind:index<4?'red':'blue',heal:(index%4+1)*50}))};
function itemSupplies(overrides={}){
  const items={red_1:20,red_2:15,red_3:9,red_4:2,blue_1:12,blue_2:11,blue_3:7,blue_4:1,...overrides.items};
  return {hp:potionKeys.filter(key=>key.startsWith('red')).reduce((sum,key)=>sum+items[key],0),mp:potionKeys.filter(key=>key.startsWith('blue')).reduce((sum,key)=>sum+items[key],0),policy:plain(supplyPolicy),...overrides,items};
}
function tieredStatus(runState=null,overrides={}){return {...status(runState),supplies:itemSupplies(overrides)};}
function setItems(h,items={}){
  for(const key of potionKeys){const input=field(h,'item_'+key);input.value=String(items[key]??0);input.fire('input');}
}
function tieredRun(overrides={}){
  return run({supplies:itemSupplies({items:{red_1:3,red_2:2,red_3:0,red_4:0,blue_1:0,blue_2:4,blue_3:0,blue_4:0},usedItems:{red_1:1,blue_2:2},initialItems:{red_1:4,red_2:2,blue_2:6},supplyRulesVersion:'atlas-supplies-v1'}),...overrides});
}

test('tiered dispatch uses server potion labels, preserves each draft, and submits items without a client policy',async()=>{
  const h=harness('expedition',{state:tieredStatus(),handler:action=>action==='atlas/start'?{ok:true}:undefined});await drain();
  assert.equal(h.body.querySelectorAll('[data-guide-supply-item]').length,8);
  assert.match(h.body.innerHTML,/紅水實名4/);assert.match(h.body.innerHTML,/藍水實名2/);
  assert.match(h.body.innerHTML,/紅水低於63%/);assert.equal(field(h,'item_blue_2').value,'10');
  setItems(h,{red_1:3,red_3:2,blue_2:4});
  field(h,'minutes').value='37';field(h,'minutes').fire('input');field(h,'item_red_3').focus();
  form(h,'start').fire('submit');assert.match(h.body.innerHTML,/紅水實名3 × 2/);
  h.body.querySelector('[data-guide-cancel]').fire('click');
  assert.equal(h.document.activeElement,field(h,'item_red_3'));assert.equal(h.calls.some(call=>call.action==='atlas/start'),false);
  h.remount();await drain();assert.equal(field(h,'item_red_3').value,'2');
  form(h,'start').fire('submit');h.body.querySelector('[data-guide-confirm]').fire('click');await drain();
  const payload=h.calls.find(call=>call.action==='atlas/start').payload;
  assert.deepEqual(payload,{mapId:'map-a',queueMode:'duration',durationMinutes:37,supplies:{items:Object.fromEntries(potionKeys.map(key=>[key,({red_1:3,red_3:2,blue_2:4})[key]||0]))},requestId:'original-atlas-request'});
  assert.equal(Object.hasOwn(payload.supplies,'hp'),false);assert.equal(Object.hasOwn(payload.supplies,'policy'),false);h.view.dispose();
});

test('tiered dispatch rejects blank, fractional, unavailable, or excessive total bottles before any start',async()=>{
  const h=harness('expedition',{state:tieredStatus(null,{items:{red_1:500,red_2:500}})});await drain();
  for(const [value,message] of [['',/需為/],['1.5',/需為/],['501',/需為/],['-1',/需為/]]){
    setItems(h);field(h,'item_red_1').value=value;field(h,'item_red_1').fire('input');
    form(h,'start').fire('submit');assert.match(h.body.innerHTML,message);assert.equal(h.body.querySelector('[data-guide-confirm]'),null);
    assert.equal(field(h,'item_red_1').value,value,'invalid draft remains editable');
  }
  setItems(h,{red_1:300,red_2:201});form(h,'start').fire('submit');assert.match(h.body.innerHTML,/紅水攜帶總量不能超過 500/);
  setItems(h,{blue_4:2});form(h,'start').fire('submit');assert.match(h.body.innerHTML,/藍水實名4攜帶數量需為 0–1/);
  assert.equal(h.calls.some(call=>call.action==='atlas/start'),false);h.view.dispose();
});

test('same-run tiered ticks update exact inventory and used bottles without replacing edited inputs or making reads',async()=>{
  const h=harness('expedition',{state:tieredStatus(tieredRun())});await drain();
  setItems(h,{red_2:7});const input=field(h,'item_red_2');input.focus();const writes=h.body.writes,requests=h.calls.length;
  const next=scene();next.live.supplies=itemSupplies({items:{red_2:4}});next.run.supplies=itemSupplies({items:{red_1:2,red_2:1,red_3:0,red_4:0,blue_1:0,blue_2:3,blue_3:0,blue_4:0},usedItems:{red_1:2,red_2:1,blue_2:3},policy:{...supplyPolicy,hpThresholdPct:51}});
  assert.equal(h.view.update(next),true);
  assert.equal(field(h,'item_red_2'),input);assert.equal(input.value,'7');assert.equal(input.max,'4');
  assert.equal(h.document.activeElement,input);assert.equal(h.body.writes,writes);assert.equal(h.calls.length,requests);
  assert.match(h.body.querySelector('[data-guide-available-item="red_2"]').textContent,/背包 4 瓶/);
  assert.match(h.body.querySelector('[data-guide-run-items]').textContent,/已用：紅水實名1 × 2、紅水實名2 × 1、藍水實名2 × 3/);
  assert.match(h.body.querySelector('[data-guide-run-policy]').textContent,/紅水低於51%/);
  assert.equal(h.view.update({...next,realmId:'other'}),false);h.view.dispose();
});

test('legacy projections cannot overwrite the detailed supplies of a current tiered status',async()=>{
  const h=harness('expedition',{state:tieredStatus(tieredRun())});await drain();
  const before=h.body.querySelector('[data-guide-run-supplies]').textContent,requests=h.calls.length;
  assert.equal(h.view.update(scene()),true);
  assert.equal(h.body.querySelector('[data-guide-run-supplies]').textContent,before);
  assert.match(h.body.querySelector('[data-guide-available-item="red_2"]').textContent,/背包 15 瓶/);
  assert.equal(h.calls.length,requests);h.view.dispose();
});

test('tiered refresh defers repaint while a field is composing and preserves blank and zero drafts',async()=>{
  const h=harness('expedition',{state:tieredStatus()});await drain();
  setItems(h,{red_2:0});const input=field(h,'item_red_2');input.value='';input.fire('input');input.focus();
  for(const fn of h.body.listeners.get('compositionstart'))fn({target:input});
  h.setState(tieredStatus(null,{items:{red_2:4}}));await h.view.refresh();
  assert.equal(field(h,'item_red_2'),input);assert.equal(input.value,'');
  for(const fn of h.body.listeners.get('compositionend'))fn({target:input});
  assert.equal(field(h,'item_red_2').value,'');assert.equal(h.document.activeElement,field(h,'item_red_2'));
  h.remount();await drain();assert.equal(field(h,'item_red_2').value,'');assert.equal(field(h,'item_red_1').value,'0');h.view.dispose();
});

test('uncertain tiered start recovers the original item request after the editable draft changes',async()=>{
  let writes=0;
  const h=harness('expedition',{state:tieredStatus(),handler:action=>{if(action==='atlas/start'){if(++writes===1)throw Object.assign(Error('response lost'),{uncertain:true});return {ok:true};}}});await drain();
  setItems(h,{red_4:1,blue_2:3});form(h,'start').fire('submit');h.body.querySelector('[data-guide-confirm]').fire('click');await drain();
  assert.equal(h.store.size,1);const first=h.calls.find(call=>call.action==='atlas/start').payload;
  field(h,'item_red_4').value='2';field(h,'item_red_4').fire('input');h.remount();await drain();
  h.body.querySelector('[data-guide-recover]').fire('click');await drain();
  assert.deepEqual(h.calls.filter(call=>call.action==='atlas/start').map(call=>call.payload),[first,first]);
  assert.equal(h.store.size,0);h.view.dispose();
});

test('old dispatch replies keep legacy fields and do not claim saved settings affect that existing run',async()=>{
  const h=harness('expedition',{state:status(run())});await drain();
  assert.equal(h.body.querySelectorAll('[data-guide-supply-item]').length,0);assert.ok(field(h,'hp'));assert.ok(field(h,'mp'));
  assert.equal(h.body.querySelector('[data-guide-run-policy]'),null);
  h.view.dispose();
  const current=harness('expedition',{state:tieredStatus(null,{policy:{...supplyPolicy,autoBlue:false}})});await drain();
  assert.match(current.body.innerHTML,/藍水自動使用關閉|藍水 自動使用關閉/);
  for(const key of potionKeys.filter(key=>key.startsWith('blue')))assert.equal(field(current,'item_'+key).value,'0');
  current.view.dispose();
});
