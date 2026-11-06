import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/scene-exchange-ui.js',import.meta.url),'utf8');
const NOW = Date.parse('2026-11-06T04:00:00.000Z');
const BASE = Object.freeze({accountId:'exchange-account',realmId:'permanent',characterId:'exchange-actor',epoch:7});
const clean = value => JSON.parse(JSON.stringify(value));
const defaults = () => ({category:'all',classReq:'all',tier:null,quality:'all',enhanceMin:null,enhanceMax:null});
const drain = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve,reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject}; };
function listing(id='listing-1',extra={}) {
  return {id,kind:'item',item:'red_1',name:'初級紅藥水',emoji:'✦',desc:'原有藥水說明',art:null,equipment:null,
    category:'other',classReq:'any',tier:null,quality:null,qualityName:'',enhance:null,qty:3,price:51,fee:3,netGold:48,
    status:'active',seller:{characterId:'seller-1',name:'旅者'},createdAt:NOW-2000,updatedAt:NOW-1000,ownedByMe:false,canBuy:true,...extra};
}
function trade(id='trade-1',role='buy',extra={}) {
  return {id,listingId:'listing-1',role,settledAt:NOW-500,qty:3,price:51,goldDelta:role === 'buy' ? -51 : 48,
    ...(role === 'buy' ? {paidGold:51,feePaidBy:'seller'} : {fee:3,netGold:48}),counterparty:{name:'同行旅者'},snapshotSource:'listing',
    item:{kind:'item',item:'red_1',name:'初級紅藥水',desc:'成交時保留的說明',equipment:null,guardian:null,snapshotAvailable:true},...extra};
}
function page({context=BASE,tab='browse',filters=defaults(),role='all',revision=4,serverNow=NOW,items,nextCursor=null,...extra}={}) {
  return {ok:true,schemaVersion:1,accountId:context.accountId,realmId:context.realmId,characterId:context.characterId,
    contextEpoch:context.epoch,revision,serverNow,pageSize:30,tab,filters:tab === 'browse' ? filters : null,
    role:tab === 'history' ? role : null,items:items ?? [tab === 'history' ? trade('trade-1',role === 'sell' ? 'sell' : 'buy') : listing()],
    meta:tab === 'history' ? null : {pageSize:30,maxActive:20,taxPct:.05,categories:['equipment','guardian','other']},nextCursor,...extra};
}
function harness({context=BASE,document}={}) {
  let currentContext={...context},active=true;
  const calls=[],events=[],sandbox={AbortController,console,Intl,Date,URL,setTimeout,clearTimeout};
  if (document) sandbox.document=document;
  for (const key of ['localStorage','sessionStorage']) Object.defineProperty(sandbox,key,{get(){throw Error('Exchange pages must stay in their captured window: '+key);}});
  sandbox.setInterval=()=>{throw Error('The exchange surface must not poll or settle');};
  vm.runInNewContext(source,sandbox,{filename:'scene-exchange-ui.js'});
  const host={
    getContext:()=>({...currentContext}),current:()=>active,
    onState:state=>events.push({tab:state.tab,page:state.page,error:state.error,loading:state.loading,ids:state.data?.items.map(row=>row.id) || []}),
    request:(action,body,options={})=>{
      assert.equal(action,'exchange/scene','the scene must use its single pure authority');
      assert.deepEqual(Object.keys(body).sort(),['contextEpoch','cursor','tab',...(body.tab==='browse'?['filters']:body.tab==='history'?['role']:[])].sort());
      assert.equal(typeof options.signal?.addEventListener,'function');
      const pending=deferred(); calls.push({action,body:clean(body),signal:options.signal,...pending}); return pending.promise;
    },
    artUrl:value=>'http://127.0.0.1:9862/'+String(value).replace(/^\//,'')
  };
  return {api:sandbox.RpgSceneExchange,host,calls,events,create:()=>sandbox.RpgSceneExchange.createClient(host),
    setContext:patch=>{currentContext={...currentContext,...patch};},setCurrent:value=>{active=value;}};
}
async function start(h,invoke) {
  const count=h.calls.length,pending=invoke(); await drain();
  assert.equal(h.calls.length,count+1); return {pending,call:h.calls[count]};
}
async function accept(h,c,value=page(),invoke=()=>c.refresh()) {
  const request=await start(h,invoke); request.call.resolve(value); assert.equal(await request.pending,true); return request.call;
}
function accepted(c) {
  return {data:clean(c.state.data),page:c.state.page,canPrevious:c.state.canPrevious,nextCursor:c.state.nextCursor,revision:c.state.revision,serverNow:c.state.serverNow};
}

test('exchange controller stays cold and accepts only a captured bounded pure page',async()=>{
  const h=harness(),c=h.create(); await drain(); assert.equal(h.calls.length,0);
  const rows=Array.from({length:30},(_,i)=>listing('listing-'+i));
  const call=await accept(h,c,page({items:rows,nextCursor:'opaque:+/=2'}));
  assert.deepEqual(call.body,{tab:'browse',cursor:null,contextEpoch:BASE.epoch,filters:defaults()});
  assert.equal(c.state.page,1); assert.equal(c.state.data.items.length,30); assert.equal(c.state.nextCursor,'opaque:+/=2');
  assert.equal(c.state.loading,false); assert.equal(c.state.error,''); c.dispose();
});

test('cursor navigation changes pages only after success and retry keeps the exact failed query',async()=>{
  const h=harness(),c=h.create(),first=page({nextCursor:'second:+/='}),second=page({items:[listing('second')],nextCursor:'third:+/='});
  await accept(h,c,first);
  const before=accepted(c),failed=await start(h,()=>c.next()); assert.deepEqual(accepted(c),before);
  failed.call.reject(Error('offline reading second')); assert.equal(await failed.pending,false); assert.deepEqual(accepted(c),before);
  const retry=await accept(h,c,second,()=>c.retry()); assert.deepEqual(retry.body,failed.call.body); assert.equal(c.state.page,2);
  await accept(h,c,page({items:[listing('third')]}),()=>c.next()); assert.equal(c.state.page,3);
  let call=await accept(h,c,second,()=>c.previous()); assert.equal(call.body.cursor,'second:+/=');
  call=await accept(h,c,first,()=>c.previous()); assert.equal(call.body.cursor,null); assert.equal(c.state.page,1);
  assert.equal(await c.previous(),false); assert.equal(c.state.canPrevious,false);
  await accept(h,c,second,()=>c.next());
  await accept(h,c,page({items:[],revision:5,serverNow:NOW+1}));
  assert.equal(c.state.page,1); assert.equal(c.state.canPrevious,false); assert.equal(c.state.nextCursor,null); c.dispose();
});

test('tab changes cancel earlier queries and never mix browse, mine and history selectors',async()=>{
  const h=harness(),c=h.create(),old=await start(h,()=>c.refresh());
  const mine=await start(h,()=>c.setTab('mine')); assert.equal(old.call.signal.aborted,true);
  assert.deepEqual(mine.call.body,{tab:'mine',cursor:null,contextEpoch:BASE.epoch});
  mine.call.resolve(page({tab:'mine',items:[listing('my-listing',{ownedByMe:true})]})); assert.equal(await mine.pending,true);
  old.call.resolve(page({items:[listing('late-browse')],revision:99})); assert.equal(await old.pending,false);
  assert.equal(c.state.data.items[0].id,'my-listing');
  const history=await start(h,()=>c.setTab('history')); assert.equal(c.state.data,null);
  assert.deepEqual(history.call.body,{tab:'history',cursor:null,contextEpoch:BASE.epoch,role:'all'});
  history.call.resolve(page({tab:'history'})); assert.equal(await history.pending,true);
  await accept(h,c,page({tab:'history',role:'sell'}),()=>c.setRole('sell'));
  assert.equal(c.state.data.items[0].role,'sell'); assert.equal(c.state.page,1);
  const count=h.calls.length; assert.equal(await c.setFilters(defaults()),false); assert.equal(h.calls.length,count); c.dispose();
});

test('filters reset the cursor and normalize inapplicable equipment limits without sending invalid ranges',async()=>{
  const h=harness(),c=h.create(); await accept(h,c,page({nextCursor:'browse-two'}));
  await accept(h,c,page({items:[listing('second')]}),()=>c.next());
  const filters={...defaults(),category:'guardian',quality:'cyan',classReq:'mage',tier:5,enhanceMin:3,enhanceMax:8};
  const normalized={...filters,tier:null,enhanceMin:null,enhanceMax:null};
  const call=await accept(h,c,page({filters:normalized,items:[]}),()=>c.setFilters(filters));
  assert.deepEqual(call.body.filters,normalized); assert.equal(call.body.cursor,null); assert.equal(c.state.page,1);
  const count=h.calls.length;
  assert.equal(await c.setFilters({...defaults(),enhanceMin:5,enhanceMax:2}),false);
  assert.equal(h.calls.length,count); assert.match(c.state.error,/下限/);
  assert.equal(await c.setFilters({...defaults(),category:'unknown'}),false); assert.equal(h.calls.length,count);
  c.dispose();
});

test('each identity dimension and a closed route discard late responses without further reads',async t=>{
  for (const [name,patch] of [['account',{accountId:'other'}],['realm',{realmId:'season-two'}],['character',{characterId:'other'}],['epoch',{epoch:8}],['closed',null]]) {
    await t.test(name,async()=>{
      const h=harness(),c=h.create(); await accept(h,c);
      const request=await start(h,()=>c.refresh()); if(patch)h.setContext(patch);else h.setCurrent(false);
      const events=h.events.length; request.call.resolve(page({items:[listing('foreign-late')],revision:99}));
      assert.equal(await request.pending,false); assert.equal(c.current(),false); assert.equal(h.events.length,events);
      assert.notEqual(c.state.data?.items[0]?.id,'foreign-late');
      const count=h.calls.length; assert.equal(await c.refresh(),false); assert.equal(await c.setTab('mine'),false); assert.equal(h.calls.length,count); c.dispose();
    });
  }
});

test('malformed envelopes, duplicates and circular cursors cannot replace the accepted page or raise its freshness floor',async t=>{
  const cases=[
    ['account',p=>p.accountId='foreign'],['realm',p=>p.realmId='foreign'],['character',p=>p.characterId='foreign'],['epoch',p=>p.contextEpoch++],
    ['tab',p=>p.tab='mine'],['filter',p=>p.filters.category='equipment'],['role',p=>p.role='buy'],['schema',p=>p.schemaVersion=2],
    ['page size',p=>p.pageSize=31],['oversized',p=>p.items=Array.from({length:31},(_,i)=>listing('too-many-'+i))],
    ['duplicate',p=>p.items=[listing('same'),listing('same')]],['cursor loop',p=>p.nextCursor='page-two'],
    ['bad amount',p=>p.items[0].price=NaN],['missing meta',p=>p.meta=null],['bad time',p=>p.serverNow=NaN]
  ];
  for(const [name,mutate]of cases) await t.test(name,async()=>{
    const h=harness(),c=h.create(); await accept(h,c,page({nextCursor:'page-two'})); const before=accepted(c);
    const request=await start(h,()=>c.next()),invalid=page({items:[listing('unaccepted')],revision:999,serverNow:NOW+999}); mutate(invalid);
    request.call.resolve(invalid); assert.equal(await request.pending,false); assert.deepEqual(accepted(c),before); assert.ok(c.state.error);
    await accept(h,c,page({items:[listing('recovered')],revision:5,serverNow:NOW+1}),()=>c.retry());
    assert.equal(c.state.page,2); assert.equal(c.state.data.items[0].id,'recovered'); c.dispose();
  });
});

test('scene revisions and server time floors survive tab changes without triggering polling',async()=>{
  const h=harness(),c=h.create(); await accept(h,c,page({revision:9}));
  const count=h.calls.length;
  assert.equal(c.update({...BASE,live:{revision:12}}),true); assert.equal(c.state.stale,true); assert.equal(h.calls.length,count);
  assert.equal(c.update({...BASE,accountId:'foreign',live:{revision:100}}),false);
  let request=await start(h,()=>c.setTab('mine')); request.call.resolve(page({tab:'mine',revision:11,serverNow:NOW+1}));
  assert.equal(await request.pending,false); assert.equal(c.state.data,null);
  await accept(h,c,page({tab:'mine',revision:12,serverNow:NOW+2}),()=>c.retry()); assert.equal(c.state.stale,false);
  const before=accepted(c); request=await start(h,()=>c.refresh()); request.call.resolve(page({tab:'mine',revision:13,serverNow:NOW+1}));
  assert.equal(await request.pending,false); assert.deepEqual(accepted(c),before); c.dispose();
});

test('complete original item snapshots survive detached copying while non-public row notes stay absent',async()=>{
  const h=harness(),c=h.create(),value=page({items:[listing('gear',{kind:'equip',name:'原武器',enhance:7,
    equipment:{name:'原武器',stat:180,elemStat:12,extras:{hp:40},pct:{critPct:.1},affixes:{lines:[{name:'神話詞條',value:.06}]},growth:{base:120,enhancement:60},towerImprint:{level:3,max:10,bonusPct:2}},
    internalNote:'NOT-A-PUBLIC-ROW'})]});
  await accept(h,c,value); assert.deepEqual(clean(c.state.data.items[0].equipment),value.items[0].equipment);
  value.items[0].equipment.stat=999; assert.equal(c.state.data.items[0].equipment.stat,180);
  assert.equal(Object.hasOwn(c.state.data.items[0],'internalNote'),false); c.dispose();
});

test('history role filtering rejects mismatched rows and uses the stored amount without recalculation',async()=>{
  const h=harness(),c=h.create(); await accept(h,c,page({tab:'history'}),()=>c.setTab('history'));
  const request=await start(h,()=>c.setRole('sell')); request.call.resolve(page({tab:'history',role:'sell',items:[trade('wrong','buy')]}));
  assert.equal(await request.pending,false); assert.equal(c.state.data,null);
  await accept(h,c,page({tab:'history',role:'sell',items:[trade('sold','sell',{price:101,fee:6,netGold:95,goldDelta:95})]}),()=>c.retry());
  assert.equal(c.state.data.items[0].fee,6); assert.equal(c.state.data.items[0].netGold,95); c.dispose();
});

test('dispose aborts a pending request and silences every subsequent route or page operation',async()=>{
  const h=harness(),c=h.create(),request=await start(h,()=>c.refresh()); c.dispose();
  assert.equal(request.call.signal.aborted,true); const count=h.calls.length,events=h.events.length;
  request.call.resolve(page()); assert.equal(await request.pending,false); assert.equal(c.state.data,null); assert.equal(h.events.length,events);
  for(const invoke of [()=>c.refresh(),()=>c.setTab('mine'),()=>c.setFilters(defaults()),()=>c.setRole('sell'),()=>c.next(),()=>c.previous(),()=>c.retry()]) assert.equal(await invoke(),false);
  assert.equal(h.calls.length,count);
});

test('the real scene session pins exchange realm and character and never follows reads with settlement or uncertain mutations',async t=>{
  const sessionSource=fs.readFileSync(new URL('../public/scene-live-session.js',import.meta.url),'utf8'),calls=[];
  const fetch=(url,options)=>{const pending=deferred();calls.push({url,options,body:JSON.parse(options.body),...pending});return pending.promise;};
  const sandbox={AbortController,queueMicrotask,console,setTimeout,clearTimeout,fetch,setInterval(){throw Error('Do not start polling');},clearInterval(){}};
  vm.runInNewContext(sessionSource,sandbox,{filename:'scene-live-session.js'});
  const session=sandbox.RpgSceneSession.create({endpoint:'http://127.0.0.1:9862/app/api/',fetch,accountId:BASE.accountId,realmId:'season-test',characterId:BASE.characterId});
  t.after(()=>session.dispose()); const context=session.getContext();
  const body={tab:'browse',filters:defaults(),cursor:null,contextEpoch:context.epoch},pending=session.request('exchange/scene',body);
  assert.equal(calls.length,1); assert.deepEqual(calls[0].body,{...body,realmId:'season-test',selectedCharacterId:BASE.characterId});
  calls[0].resolve({ok:true,status:200,json:async()=>page({context})}); await pending; await drain(); assert.equal(calls.length,1);
  const failed=session.request('exchange/scene',body).catch(error=>error); calls[1].reject(Error('offline'));
  const error=await failed; assert.equal(error.code,'connection_failed'); assert.equal(error.uncertain,false);
  assert.equal(calls.length,2); assert.ok(calls.every(call=>call.url.endsWith('/exchange/scene')));
});

const decode = text => text.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
class Element {
  constructor(document,tag) {
    this.ownerDocument=document;this.tagName=tag.toUpperCase();this.nodeType=tag==='#text'?3:1;
    this.parentNode=null;this.nodes=[];this.attributes=new Map();this.events=new Map();this.text='';
    this.disabled=false;this.hidden=false;this.value='';this.scrollTop=0;
    this.dataset=new Proxy({},{
      get:(_,key)=>this.getAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase())) ?? undefined,
      set:(_,key,value)=>{this.setAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value);return true;}
    });
  }
  get childNodes(){return this.nodes;}
  get children(){return this.nodes.filter(node=>node.nodeType===1);}
  get isConnected(){return this===this.ownerDocument.body || this===this.ownerDocument.head || !!this.parentNode?.isConnected;}
  get className(){return this.getAttribute('class') || '';}
  set className(value){this.setAttribute('class',value);}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='disabled')this.disabled=true;if(name==='hidden')this.hidden=true;if(name==='value')this.value=String(value);if(name==='name')this.name=String(value);}
  getAttribute(name){return this.attributes.get(name) ?? null;}
  hasAttribute(name){return this.attributes.has(name);}
  removeAttribute(name){this.attributes.delete(name);if(name==='disabled')this.disabled=false;if(name==='hidden')this.hidden=false;}
  append(...items){
    for(let item of items){
      if(typeof item!=='object'){const node=this.ownerDocument.createTextNode(String(item));item=node;}
      if(item.parentNode)item.parentNode.nodes=item.parentNode.nodes.filter(node=>node!==item);
      item.parentNode=this;this.nodes.push(item);
    }
  }
  appendChild(node){this.append(node);return node;}
  replaceChildren(...nodes){
    if(this.nodes.some(node=>node.contains(this.ownerDocument.activeElement)))this.ownerDocument.activeElement=this.ownerDocument.body;
    for(const node of this.nodes)node.parentNode=null;
    this.nodes=[];this.text='';this.append(...nodes);
  }
  contains(node){return node===this || this.nodes.some(child=>child.contains(node));}
  get textContent(){return this.text+this.nodes.map(node=>node.textContent).join('');}
  set textContent(value){this.replaceChildren();this.text=String(value);}
  get innerHTML(){return this.html || '';}
  set innerHTML(value){
    this.html=String(value);this.ownerDocument.htmlWrites.push(this.html);this.replaceChildren();
    const stack=[this];
    for(const token of this.html.match(/<[^>]*>|[^<]+/g) || []){
      if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}
      if(token.startsWith('<')){
        const match=token.match(/^<([a-z0-9-]+)([\s\S]*?)\/?>$/i);
        if(!match)continue;
        const node=this.ownerDocument.createElement(match[1]);
        for(const attr of match[2].matchAll(/([^\s=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g))node.setAttribute(attr[1],decode(attr[2]??attr[3]??attr[4]??''));
        stack.at(-1).append(node);
        if(!['INPUT','LINK','IMG','BR','HR','META'].includes(node.tagName) && !token.endsWith('/>'))stack.push(node);
      }else stack.at(-1).append(this.ownerDocument.createTextNode(decode(token)));
    }
  }
  matches(selector){
    if(this.nodeType!==1)return false;
    const attr=selector.match(/^(?:([a-z0-9-]+))?\[([a-z0-9-]+)(?:([*]?=)"([^"]*)")?\]$/i);
    if(attr){
      if(attr[1]&&this.tagName!==attr[1].toUpperCase())return false;
      const value=this.getAttribute(attr[2]);
      return value!==null && (!attr[3] || (attr[3]==='*='?value.includes(attr[4]):value===attr[4]));
    }
    if(selector.startsWith('.'))return this.className.split(/\s+/).includes(selector.slice(1));
    return this.tagName===selector.toUpperCase();
  }
  querySelectorAll(selector){
    const found=[];
    for(const child of this.nodes){if(child.matches(selector))found.push(child);found.push(...child.querySelectorAll(selector));}
    return found;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
  closest(selector){return this.matches(selector)?this:this.parentNode?.closest(selector) || null;}
  addEventListener(type,listener){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(listener);}
  removeEventListener(type,listener){this.events.get(type)?.delete(listener);}
  dispatch(type){
    const event={type,target:this,preventDefault(){},stopPropagation(){this.stopped=true;}};
    for(let node=this;node;node=node.parentNode){for(const listener of [...node.events.get(type)||[]])listener(event);if(event.stopped)break;}
  }
  click(){if(!this.disabled)this.dispatch('click');}
  change(value){this.value=value;this.dispatch('change');}
  focus(){if(this.isConnected&&!this.disabled)this.ownerDocument.activeElement=this;}
}
function documentFixture(){
  const document={baseURI:'http://127.0.0.1:9853/scene-live-preview.html',htmlWrites:[]};
  document.createElement=tag=>new Element(document,tag);
  document.createTextNode=text=>{const node=new Element(document,'#text');node.text=String(text);return node;};
  document.head=document.createElement('head');document.body=document.createElement('body');document.activeElement=document.body;
  document.querySelector=selector=>document.head.querySelector(selector)||document.body.querySelector(selector);
  const root=document.createElement('main');document.body.append(root);
  return {document,root};
}

async function mounted(value=page()) {
  const {document,root}=documentFixture(),h=harness({document}),view=h.api.mount(root,h.host);
  assert.equal(h.calls.length,1); h.calls[0].resolve(value); await drain();
  return {document,root,h,view,find:key=>root.querySelector('[data-exchange-'+key+']')};
}
test('the mounted UI renders snapshot strings as text and detail back restores the same list, scroll and focus',async t=>{
  const unsafe='<img src=x onerror="steal()">',value=page({items:[listing('detail-id',{name:unsafe,desc:'<svg onload="steal()"> original'})]});
  const {document,root,h,view,find}=await mounted(value);t.after(()=>view.dispose());
  assert.ok(root.textContent.includes(unsafe)); assert.equal(root.querySelector('img'),null); assert.equal(root.querySelector('svg'),null);
  const control=root.querySelector('[data-exchange-detail]');root.scrollTop=233;control.focus();control.click();
  assert.equal(find('list-pane').hidden,true);assert.equal(find('detail-pane').hidden,false);
  assert.equal(root.querySelectorAll('[role="dialog"]').length,0,'the module cannot create a second modal');
  assert.ok(find('detail-pane').textContent.includes('<svg onload="steal()"> original'));
  assert.equal(document.activeElement,find('detail-title'));
  const calls=h.calls.length;assert.equal(view.handleBack(),true);assert.equal(h.calls.length,calls,'snapshot detail is entirely local');
  assert.equal(find('list-pane').hidden,false);assert.equal(find('detail-pane').hidden,true);assert.equal(root.scrollTop,233);
  assert.equal(root.querySelector('[data-exchange-detail]'),control);assert.equal(document.activeElement,control);assert.equal(view.handleBack(),false);
  assert.equal(document.htmlWrites.length,1,'only the fixed shell uses HTML');
});

test('mounted tabs and category controls survive repaint, and changing filters does not leave old rows behind',async t=>{
  const {document,root,h,view,find}=await mounted();t.after(()=>view.dispose());
  const category=root.querySelector('[data-exchange-filter="category"]'),quality=root.querySelector('[data-exchange-filter="quality"]');
  category.focus();category.change('guardian');quality.value='cyan';find('filter-form').dispatch('submit');await drain();
  assert.equal(root.querySelector('[data-exchange-filter="category"]'),category);assert.equal(document.activeElement,category);
  assert.equal(root.querySelectorAll('[data-exchange-detail]').length,0);
  const filters={...defaults(),category:'guardian',quality:'cyan'};
  assert.deepEqual(h.calls.at(-1).body.filters,filters);h.calls.at(-1).resolve(page({filters,items:[]}));await drain();
  assert.equal(document.activeElement,category);assert.equal(find('empty').hidden,false);
  const mine=[...root.querySelectorAll('[data-exchange-tab]')].find(node=>node.dataset.exchangeTab==='mine');
  mine.focus();mine.click();await drain();assert.equal(find('filter-box').hidden,true);assert.equal(find('role-box').hidden,true);
  h.calls.at(-1).resolve(page({tab:'mine',items:[]}));await drain();assert.equal(document.activeElement,mine);
  assert.equal(mine.getAttribute('aria-pressed'),'true');assert.match(find('empty').textContent,/刊登紀錄/);
});

test('mounted pagination focuses successful pages and retries without skipping or stealing moved focus',async t=>{
  const first=page({nextCursor:'second'}),second=page({items:[listing('second')]});
  const {document,root,h,view,find}=await mounted(first);t.after(()=>view.dispose());
  const next=find('next'),previous=find('previous'),heading=find('page'),refresh=find('refresh');
  root.scrollTop=500;next.focus();next.click();await drain();assert.equal(next.getAttribute('aria-disabled'),'true');
  h.calls.at(-1).resolve(second);await drain();assert.equal(view.client.state.page,2);assert.equal(document.activeElement,heading);assert.equal(root.scrollTop,0);
  previous.focus();previous.click();await drain();refresh.focus();h.calls.at(-1).resolve(first);await drain();
  assert.equal(document.activeElement,refresh);assert.equal(view.client.state.page,1);
  next.focus();next.click();await drain();h.calls.at(-1).reject(Error('page offline'));await drain();assert.equal(view.client.state.page,1);
  const retry=find('retry');retry.focus();retry.click();await drain();assert.equal(h.calls.at(-1).body.cursor,'second');
  h.calls.at(-1).resolve(second);await drain();assert.equal(view.client.state.page,2);assert.equal(document.activeElement,heading);
  assert.equal(find('error-box').hidden,true);
});

test('history detail retains original amounts and snapshot data without exposing trade or equipment mutation controls',async t=>{
  const value=page({tab:'history',items:[trade('sale','sell',{item:{kind:'equip',name:'記錄武器',tier:5,quality:'legendary',qualityName:'傳說',enhance:7,snapshotAvailable:true,
    equipment:{name:'記錄武器',slotName:'武器',levelReq:100,stat:120,elemStat:4,elementName:'火',affixes:{lines:[{name:'記錄詞條',value:.03,quality:'高級'}]}}}})]});
  const {root,h,view,find}=await mounted();t.after(()=>view.dispose());
  const history=[...root.querySelectorAll('[data-exchange-tab]')].find(node=>node.dataset.exchangeTab==='history');history.click();await drain();
  h.calls.at(-1).resolve(value);await drain();root.querySelector('[data-exchange-detail]').click();
  const text=find('detail-pane').textContent;assert.match(text,/\+7 記錄武器/);assert.match(text,/傳說/);assert.match(text,/手續費3 金幣/);assert.match(text,/實收金幣48/);
  assert.match(text,/記錄詞條/);assert.match(text,/成交時的物品快照/);
  const buttons=[...find('detail-pane').querySelectorAll('button')].map(node=>node.textContent);assert.deepEqual(buttons,['返回列表']);
});

test('disposing a mounted exchange window removes handlers and blocks late writes to the DOM',async()=>{
  const {document,root}=documentFixture(),h=harness({document}),view=h.api.mount(root,h.host),pending=h.calls[0],before=root.textContent;
  view.dispose();assert.equal(pending.signal.aborted,true);
  for(const event of ['click','change','submit'])assert.equal(root.events.get(event).size,0);
  pending.resolve(page({items:[listing('late',{name:'MUST-NOT-PAINT'})]}));await drain();assert.equal(root.textContent,before);
  root.querySelector('[data-exchange-refresh]').click();await drain();assert.equal(h.calls.length,1);
});

test('snapshot icons use existing scene paths and reject external or unresolved art IDs',async t=>{
  const values=[
    ['equipment',listing('icon-gear',{kind:'equip',equipment:{slot:'weapon',art:'wpn_sword',source:'shop',classReq:'sword'}}),'http://127.0.0.1:9862/art/v2/wpn_sword.webp'],
    ['guardian',listing('icon-guardian',{kind:'guardian',guardian:{typeName:'守護者'},art:'/art/guardian-sigil-20261013/loot.webp'}),'http://127.0.0.1:9862/art/guardian-sigil-20261013/loot.webp'],
    ['external URL',listing('icon-external',{art:'https://untrusted.invalid/icon.webp'}),null],
    ['special equipment',listing('icon-ring',{kind:'equip',equipment:{art:'star_ring_example',classReq:'sword'}}),null],
    ['traversal',listing('icon-traversal',{art:'/art/../private.webp'}),null]
  ];
  for(const [name,item,url]of values)await t.test(name,async()=>{
    const {root,view}=await mounted(page({items:[item]}));t.after(()=>view.dispose());
    const image=root.querySelector('img');if(url)assert.equal(image?.src,url);else assert.equal(image,null);
  });
});
