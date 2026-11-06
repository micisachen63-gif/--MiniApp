import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/scene-ledger-ui.js',import.meta.url),'utf8');
const NOW = Date.parse('2026-11-06T02:00:00.000Z');
const BASE = Object.freeze({accountId:'ledger-account',realmId:'permanent',characterId:'ledger-actor',epoch:7});
const plain = value => JSON.parse(JSON.stringify(value));
const drain = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve,reject;
  const promise = new Promise((yes,no) => {resolve=yes;reject=no;});
  return {promise,resolve,reject};
};

function entry(id,extra={}) {
  return {id,createdAt:NOW-1000,type:'quest',goldDelta:17,item:null,itemName:null,itemDelta:0,expDelta:0,summary:'委託獎勵',...extra};
}
function categoryEntry(category,id) {
  return entry(id,category === 'items' ? {goldDelta:0,item:'red_1',itemName:'初級紅藥水',itemDelta:2} : category === 'experience' ? {goldDelta:0,expDelta:120} : {});
}
function page({context=BASE,category='all',revision=4,serverNow=NOW,entries,nextCursor=null,...extra}={}) {
  return {ok:true,schemaVersion:1,accountId:context.accountId,realmId:context.realmId,characterId:context.characterId,
    contextEpoch:context.epoch,revision,serverNow,pageSize:30,category,
    entries:entries ?? [categoryEntry(category,'entry-1')],nextCursor,...extra};
}
function harness({context=BASE,document}={}) {
  let ctx={...context},active=true;
  const calls=[],events=[];
  const sandbox={AbortController,console,Intl,Date,URL,URLSearchParams,setTimeout,clearTimeout};
  if(document)sandbox.document=document;
  for(const key of ['localStorage','sessionStorage'])Object.defineProperty(sandbox,key,{get(){throw new Error('Ledger must not persist a page in '+key);}});
  sandbox.setInterval=()=>{throw new Error('Ledger must not poll or settle on a timer');};
  vm.runInNewContext(source,sandbox,{filename:'scene-ledger-ui.js'});
  const host={
    getContext:()=>({...ctx}),current:()=>active,
    onState:state=>events.push({category:state.category,page:state.page,loading:state.loading,error:state.error,ids:state.data?.entries?.map(row=>row.id) || []}),
    request:(action,body,options={})=>{
      assert.equal(action,'ledger/history','ledger UI must only call the pure history authority');
      assert.deepEqual(Object.keys(body).sort(),['category','contextEpoch','cursor']);
      assert.ok(['all','gold','items','experience'].includes(body.category));
      assert.equal(typeof options.signal?.addEventListener,'function','each read needs an abort signal');
      const pending=deferred();
      calls.push({action,body:plain(body),signal:options.signal,...pending});
      return pending.promise;
    }
  };
  assert.equal(typeof sandbox.RpgSceneLedger?.createClient,'function');
  return {api:sandbox.RpgSceneLedger,host,calls,events,create:()=>sandbox.RpgSceneLedger.createClient(host),
    setContext:patch=>{ctx={...ctx,...patch};},setCurrent:value=>{active=value;}};
}
async function start(h,invoke) {
  const count=h.calls.length,pending=invoke();
  await drain();
  assert.equal(h.calls.length,count+1,'an explicit page read issues exactly one request');
  return {pending,call:h.calls[count]};
}
async function accept(h,c,value=page(),invoke=()=>c.refresh()) {
  const request=await start(h,invoke);
  request.call.resolve(value);
  assert.equal(await request.pending,true);
  return request.call;
}
function accepted(c) {
  return {data:plain(c.state.data),page:c.state.page,canPrevious:c.state.canPrevious,nextCursor:c.state.nextCursor,revision:c.state.revision,serverNow:c.state.serverNow};
}
function assertAccepted(c,before) {
  assert.deepEqual(accepted(c),before,'rejected or incomplete reads must not replace the accepted page or navigation');
}

test('ledger controller is cold, uses only a captured pure query, and accepts a bounded first page',async()=>{
  const h=harness(),c=h.create();
  await drain();
  assert.equal(h.calls.length,0);
  assert.equal(c.current(),true);
  const rows=Array.from({length:30},(_,i)=>entry('first-'+i));
  const request=await start(h,()=>c.refresh());
  assert.deepEqual(request.call.body,{category:'all',cursor:null,contextEpoch:BASE.epoch});
  assert.equal(c.state.loading,true);
  request.call.resolve(page({entries:rows,nextCursor:'opaque-next:AA/+/='}));
  assert.equal(await request.pending,true);
  assert.equal(c.state.loading,false);
  assert.equal(Boolean(c.state.error),false);
  assert.equal(c.state.page,1);
  assert.equal(c.state.canPrevious,false);
  assert.equal(c.state.nextCursor,'opaque-next:AA/+/=');
  assert.deepEqual(plain(c.state.data.entries),rows);
  assert.equal(c.state.revision,4);
  assert.equal(c.state.serverNow,NOW);
  c.dispose();
});

test('cursor navigation replaces rows and previous follows the accepted cursor stack',async()=>{
  const h=harness(),c=h.create(),second='opaque-page-two:AA+/=',third='opaque-page-three:BB+/=';
  const first=page({entries:Array.from({length:30},(_,i)=>entry('first-'+i)),nextCursor:second});
  const two=page({entries:[entry('second-only')],nextCursor:third});
  const three=page({entries:[entry('third-only')],nextCursor:null});
  await accept(h,c,first);
  let call=await accept(h,c,two,()=>c.next());
  assert.equal(call.body.cursor,second);
  assert.equal(c.state.page,2);
  assert.equal(c.state.canPrevious,true);
  assert.deepEqual(plain(c.state.data.entries).map(row=>row.id),['second-only']);
  call=await accept(h,c,three,()=>c.next());
  assert.equal(call.body.cursor,third);
  assert.equal(c.state.page,3);
  const atEnd=h.calls.length;
  assert.equal(await c.next(),false);
  assert.equal(h.calls.length,atEnd);
  call=await accept(h,c,two,()=>c.previous());
  assert.equal(call.body.cursor,second);
  assert.equal(c.state.page,2);
  call=await accept(h,c,first,()=>c.previous());
  assert.equal(call.body.cursor,null);
  assert.equal(c.state.page,1);
  assert.equal(c.state.canPrevious,false);
  const atStart=h.calls.length;
  assert.equal(await c.previous(),false);
  assert.equal(h.calls.length,atStart);
  c.dispose();
});

test('failed next and previous retain the visible page and retry the failed target exactly',async()=>{
  const h=harness(),c=h.create(),cursor='retry-original-cursor';
  const first=page({entries:[entry('first')],nextCursor:cursor});
  const two=page({entries:[entry('second')],nextCursor:null});
  await accept(h,c,first);
  let before=accepted(c),request=await start(h,()=>c.next());
  assertAccepted(c,before);
  request.call.reject(new Error('offline before page two'));
  assert.equal(await request.pending,false);
  assertAccepted(c,before);
  assert.equal(c.state.loading,false);
  assert.ok(c.state.error);
  let retried=await accept(h,c,two,()=>c.retry());
  assert.deepEqual(retried.body,request.call.body);
  assert.equal(c.state.page,2);
  before=accepted(c);
  request=await start(h,()=>c.previous());
  request.call.reject(new Error('offline returning to page one'));
  assert.equal(await request.pending,false);
  assertAccepted(c,before);
  retried=await accept(h,c,first,()=>c.retry());
  assert.deepEqual(retried.body,request.call.body);
  assert.equal(retried.body.cursor,null);
  assert.equal(c.state.page,1);
  assert.equal(c.state.canPrevious,false);
  c.dispose();
});

test('refresh returns to the first page and discards the previous navigation chain',async()=>{
  const h=harness(),c=h.create();
  await accept(h,c,page({nextCursor:'second'}));
  await accept(h,c,page({entries:[entry('old-page-two')],nextCursor:'third'}),()=>c.next());
  const call=await accept(h,c,page({entries:[entry('fresh-first')],revision:5,serverNow:NOW+1,nextCursor:null}));
  assert.deepEqual(call.body,{category:'all',cursor:null,contextEpoch:BASE.epoch});
  assert.equal(c.state.page,1);
  assert.equal(c.state.canPrevious,false);
  assert.equal(c.state.nextCursor,null);
  assert.deepEqual(plain(c.state.data.entries).map(row=>row.id),['fresh-first']);
  const count=h.calls.length;
  assert.equal(await c.previous(),false);
  assert.equal(h.calls.length,count);
  c.dispose();
});

test('changing category immediately clears the old page and a failed category read retries page one',async()=>{
  const h=harness(),c=h.create();
  await accept(h,c,page({nextCursor:'all-second'}));
  await accept(h,c,page({entries:[entry('all-page-two')],nextCursor:'all-third'}),()=>c.next());
  const pending=c.setCategory('items');
  assert.equal(c.state.category,'items');
  assert.equal(c.state.data,null);
  assert.equal(c.state.page,1);
  assert.equal(c.state.canPrevious,false);
  assert.equal(c.state.nextCursor,null);
  await drain();
  const call=h.calls.at(-1);
  assert.deepEqual(call.body,{category:'items',cursor:null,contextEpoch:BASE.epoch});
  call.reject(new Error('items read offline'));
  assert.equal(await pending,false);
  assert.equal(c.state.data,null);
  assert.equal(c.state.category,'items');
  const retried=await accept(h,c,page({category:'items',entries:[categoryEntry('items','potion')],revision:5,serverNow:NOW+1}),()=>c.retry());
  assert.deepEqual(retried.body,call.body);
  assert.equal(c.state.page,1);
  assert.equal(c.state.canPrevious,false);
  assert.equal(c.state.data.category,'items');
  c.dispose();
});

test('all four categories use the same authority and empty pages remain valid',async()=>{
  const h=harness(),c=h.create();
  await accept(h,c,page({entries:[]}));
  for(const category of ['gold','items','experience','all']){
    const call=await accept(h,c,page({category,entries:[]}),()=>c.setCategory(category));
    assert.deepEqual(call.body,{category,cursor:null,contextEpoch:BASE.epoch});
    assert.deepEqual(plain(c.state.data.entries),[]);
    assert.equal(c.state.page,1);
    assert.equal(c.state.nextCursor,null);
  }
  const count=h.calls.length,before=accepted(c);
  assert.equal(await c.setCategory('unknown-category'),false);
  assert.equal(h.calls.length,count);
  assertAccepted(c,before);
  c.dispose();
});

test('a newer refresh wins even when an aborted transport still resolves with a higher revision',async()=>{
  const h=harness(),c=h.create();
  const old=await start(h,()=>c.refresh());
  const latest=await start(h,()=>c.refresh());
  assert.equal(old.call.signal.aborted,true);
  latest.call.resolve(page({entries:[entry('latest')],revision:6,serverNow:NOW+10}));
  assert.equal(await latest.pending,true);
  const before=accepted(c),events=h.events.length;
  old.call.resolve(page({entries:[entry('aborted-old')],revision:99,serverNow:NOW+999}));
  assert.equal(await old.pending,false);
  assertAccepted(c,before);
  assert.equal(h.events.length,events,'abandoned reads must not repaint or change error/loading state');
  await accept(h,c,page({entries:[entry('next-valid')],revision:7,serverNow:NOW+11}));
  assert.equal(c.state.data.entries[0].id,'next-valid','an abandoned high revision must not poison the freshness floor');
  c.dispose();
});

test('a category switch suppresses the earlier response and does not leak its rows into the new category',async()=>{
  const h=harness(),c=h.create();
  const old=await start(h,()=>c.refresh());
  const next=await start(h,()=>c.setCategory('gold'));
  assert.equal(old.call.signal.aborted,true);
  next.call.resolve(page({category:'gold',entries:[entry('gold-only')]}));
  assert.equal(await next.pending,true);
  const before=accepted(c);
  old.call.resolve(page({entries:[entry('unfiltered-late')],revision:100,serverNow:NOW+100}));
  assert.equal(await old.pending,false);
  assert.equal(c.state.category,'gold');
  assertAccepted(c,before);
  c.dispose();
});

test('an abandoned rejection cannot overwrite a newer successful read with an error',async()=>{
  const h=harness(),c=h.create();
  const old=await start(h,()=>c.refresh());
  const next=await start(h,()=>c.refresh());
  next.call.resolve(page({entries:[entry('current')]}));
  assert.equal(await next.pending,true);
  const before=accepted(c),events=h.events.length;
  old.call.reject(Object.assign(new Error('aborted old request'),{name:'AbortError'}));
  assert.equal(await old.pending,false);
  assertAccepted(c,before);
  assert.equal(Boolean(c.state.error),false);
  assert.equal(c.state.loading,false);
  assert.equal(h.events.length,events);
  c.dispose();
});

test('account, realm, character and epoch changes independently invalidate an in-flight client',async t=>{
  for(const [label,patch] of [['account',{accountId:'other-account'}],['realm',{realmId:'season-two'}],['character',{characterId:'other-actor'}],['epoch',{epoch:BASE.epoch+1}]]){
    await t.test(label,async()=>{
      const h=harness(),c=h.create();
      await accept(h,c);
      const request=await start(h,()=>c.refresh());
      h.setContext(patch);
      assert.equal(c.current(),false);
      const events=h.events.length;
      request.call.resolve(page({entries:[entry('stale-'+label)],revision:99,serverNow:NOW+99}));
      assert.equal(await request.pending,false);
      assert.notEqual(c.state.data?.entries?.[0]?.id,'stale-'+label);
      assert.equal(h.events.length,events);
      const count=h.calls.length;
      assert.equal(await c.refresh(),false);
      assert.equal(await c.setCategory('gold'),false);
      assert.equal(h.calls.length,count,'an invalidated client cannot start reads in its old scope');
      c.dispose();
    });
  }
});

test('dispose aborts a pending read and prevents late state notifications or further reads',async()=>{
  const h=harness(),c=h.create();
  await accept(h,c);
  const request=await start(h,()=>c.refresh());
  c.dispose();
  assert.equal(request.call.signal.aborted,true);
  assert.equal(c.current(),false);
  const events=h.events.length,data=plain(c.state.data),count=h.calls.length;
  request.call.resolve(page({entries:[entry('disposed-late')],revision:10,serverNow:NOW+100}));
  assert.equal(await request.pending,false);
  assert.deepEqual(plain(c.state.data),data);
  assert.equal(h.events.length,events);
  for(const invoke of [()=>c.refresh(),()=>c.setCategory('gold'),()=>c.next(),()=>c.previous(),()=>c.retry()])assert.equal(await invoke(),false);
  assert.equal(h.calls.length,count);
});

test('host current guard prevents repaint after the containing route has closed',async()=>{
  const h=harness(),c=h.create();
  const request=await start(h,()=>c.refresh());
  h.setCurrent(false);
  const events=h.events.length;
  assert.equal(c.current(),false);
  request.call.resolve(page());
  assert.equal(await request.pending,false);
  assert.equal(h.events.length,events);
  assert.equal(c.state.data,null);
  const count=h.calls.length;
  assert.equal(await c.refresh(),false);
  assert.equal(h.calls.length,count);
  c.dispose();
});

test('scope and query echoes are checked before replacing accepted data',async t=>{
  const cases=[
    ['account',{accountId:'foreign-account'}],['realm',{realmId:'foreign-realm'}],['character',{characterId:'foreign-actor'}],
    ['epoch',{contextEpoch:BASE.epoch+1}],['category',{category:'items'}]
  ];
  for(const [label,patch] of cases)await t.test(label,async()=>{
    const h=harness(),c=h.create();
    await accept(h,c,page({nextCursor:'next-page'}));
    const before=accepted(c),request=await start(h,()=>c.next());
    request.call.resolve(page({entries:[entry('must-not-accept')],revision:5,serverNow:NOW+1,...patch}));
    assert.equal(await request.pending,false);
    assertAccepted(c,before);
    assert.ok(c.state.error);
    assert.equal(c.state.loading,false);
    c.dispose();
  });
});

test('older revision or server time is rejected independently while equal freshness is valid',async()=>{
  const h=harness(),c=h.create();
  await accept(h,c,page({revision:9,serverNow:NOW}));
  for(const patch of [{revision:8,serverNow:NOW+10},{revision:10,serverNow:NOW-1}]){
    const before=accepted(c),request=await start(h,()=>c.refresh());
    request.call.resolve(page({entries:[entry('older')],...patch}));
    assert.equal(await request.pending,false);
    assertAccepted(c,before);
    assert.ok(c.state.error);
  }
  await accept(h,c,page({entries:[entry('equal-version')],revision:9,serverNow:NOW}));
  assert.equal(c.state.data.entries[0].id,'equal-version');
  await accept(h,c,page({entries:[entry('new-version')],revision:10,serverNow:NOW+1}));
  assert.equal(c.state.revision,10);
  assert.equal(c.state.serverNow,NOW+1);
  c.dispose();
});

test('category reset does not erase the accepted revision or server time freshness floor',async()=>{
  const h=harness(),c=h.create();
  await accept(h,c,page({revision:20,serverNow:NOW+20}));
  const request=await start(h,()=>c.setCategory('experience'));
  request.call.resolve(page({category:'experience',revision:19,serverNow:NOW+21}));
  assert.equal(await request.pending,false);
  assert.equal(c.state.category,'experience');
  assert.equal(c.state.data,null);
  assert.ok(c.state.error);
  await accept(h,c,page({category:'experience',revision:20,serverNow:NOW+21}),()=>c.retry());
  assert.equal(c.state.data.category,'experience');
  c.dispose();
});

test('malformed or oversized ledger pages never poison the accepted page or freshness floor',async t=>{
  const bad=[
    ['not ok',value=>{value.ok=false;}],
    ['schema version',value=>{value.schemaVersion=2;}],
    ['missing character scope',value=>{delete value.characterId;}],
    ['negative context epoch',value=>{value.contextEpoch=-1;}],
    ['unsafe revision',value=>{value.revision=Number.MAX_SAFE_INTEGER+1;}],
    ['negative revision',value=>{value.revision=-1;}],
    ['invalid server clock',value=>{value.serverNow=NaN;}],
    ['wrong fixed page size',value=>{value.pageSize=31;}],
    ['non-array entries',value=>{value.entries={};}],
    ['more than 30 entries',value=>{value.entries=Array.from({length:31},(_,i)=>entry('overflow-'+i));}],
    ['duplicate entry ID',value=>{value.entries=[entry('duplicate'),entry('duplicate')];}],
    ['missing entry ID',value=>{delete value.entries[0].id;}],
    ['numeric entry ID',value=>{value.entries[0].id=1;}],
    ['non-numeric timestamp',value=>{value.entries[0].createdAt='yesterday';}],
    ['non-finite timestamp',value=>{value.entries[0].createdAt=Infinity;}],
    ['invalid entry type',value=>{value.entries[0].type={name:'quest'};}],
    ['non-finite gold',value=>{value.entries[0].goldDelta=Infinity;}],
    ['invalid item ID',value=>{value.entries[0].item={id:'red_1'};}],
    ['invalid item name',value=>{value.entries[0].itemName=['red_1'];}],
    ['missing item delta',value=>{delete value.entries[0].itemDelta;}],
    ['non-numeric experience',value=>{value.entries[0].expDelta='120';}],
    ['invalid summary',value=>{value.entries[0].summary={text:'private'};}],
    ['invalid next cursor',value=>{value.nextCursor=123;}]
  ];
  for(const [label,mutate] of bad)await t.test(label,async()=>{
    const h=harness(),c=h.create();
    await accept(h,c,page({nextCursor:'second-page'}));
    const before=accepted(c),request=await start(h,()=>c.next());
    const invalid=page({entries:[entry('untrusted')],revision:99,serverNow:NOW+99});
    mutate(invalid);
    request.call.resolve(invalid);
    assert.equal(await request.pending,false,label);
    assertAccepted(c,before);
    assert.equal(c.state.loading,false);
    assert.ok(c.state.error);
    await accept(h,c,page({entries:[entry('recovered')],revision:5,serverNow:NOW+1}),()=>c.retry());
    assert.equal(c.state.data.entries[0].id,'recovered','a rejected payload cannot raise the accepted freshness floor');
    c.dispose();
  });
});


test('same-scope scene updates raise a read floor without fetching or discarding the visible page',async()=>{
  const h=harness(),c=h.create();
  await accept(h,c,page({revision:4}));
  const visible=plain(c.state.data),count=h.calls.length;
  assert.equal(c.update({accountId:BASE.accountId,realmId:BASE.realmId,characterId:BASE.characterId,live:{revision:8}}),true);
  assert.equal(h.calls.length,count);
  assert.equal(c.state.stale,true);
  assert.deepEqual(plain(c.state.data),visible);
  const request=await start(h,()=>c.refresh());
  request.call.resolve(page({entries:[entry('below-scene-floor')],revision:7,serverNow:NOW+1}));
  assert.equal(await request.pending,false);
  assert.deepEqual(plain(c.state.data),visible);
  assert.equal(c.state.stale,true);
  await accept(h,c,page({entries:[entry('matches-scene-floor')],revision:8,serverNow:NOW+2}),()=>c.retry());
  assert.equal(c.state.stale,false);
  assert.equal(c.state.data.entries[0].id,'matches-scene-floor');
  c.dispose();
});

test('foreign or malformed scene updates cannot poison the captured ledger read floor',async()=>{
  const h=harness(),c=h.create();
  await accept(h,c);
  const count=h.calls.length,scope={accountId:BASE.accountId,realmId:BASE.realmId,characterId:BASE.characterId};
  for(const patch of [{accountId:'other'},{realmId:'other'},{characterId:'other'},{live:{revision:NaN}},{live:{revision:-1}}]){
    assert.equal(c.update({...scope,live:{revision:100},...patch}),false);
  }
  assert.equal(h.calls.length,count);
  assert.equal(c.state.stale,false);
  await accept(h,c,page({revision:5,serverNow:NOW+1}));
  assert.equal(c.state.revision,5);
  c.dispose();
});

test('accepted projection retains public ledger fields and drops raw receipt notes without parsing them',async()=>{
  const h=harness(),c=h.create(),value=page();
  value.note='TOP-LEVEL-PRIVATE-NOTE';
  value.entries[0].note='{"PRIVATE-RECEIPT-NOTE": "not valid JSON"';
  value.entries[0].metadata={secret:'PRIVATE-EXTRA-METADATA'};
  await accept(h,c,value);
  const row=c.state.data.entries[0];
  assert.deepEqual(Object.keys(row).sort(),['createdAt','expDelta','goldDelta','id','item','itemDelta','itemName','summary','type']);
  assert.equal(Object.hasOwn(c.state.data,'note'),false);
  assert.doesNotMatch(JSON.stringify(c.state.data),/PRIVATE-RECEIPT-NOTE|PRIVATE-EXTRA-METADATA|TOP-LEVEL-PRIVATE-NOTE/);
  c.dispose();
});

// A small DOM fixture records node identity, text nodes, focus and event bubbling.
// Removing the toolbar resets focus just as removing a real focused node would.
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
async function mounted(value=page()){
  const {document,root}=documentFixture(),h=harness({document}),module=h.api.mount(root,h.host);
  assert.equal(h.calls.length,1,'mount performs one initial pure read');
  h.calls[0].resolve(value);await drain();
  return {document,root,h,module,find:name=>root.querySelector('[data-ledger-'+name+']')};
}

test('mount renders untrusted strings as text and keeps category and refresh controls focused across repaint',async t=>{
  const summary='<img src=x onerror="steal()"> & summary',type='<svg onload="steal()">',itemName='<b>藥水 & 原名</b>';
  const value=page({entries:[entry('row"><img src=x>',{type,summary,item:'red_1',itemName,itemDelta:2,note:'NEVER-DISPLAY-RAW-NOTE'})]});
  const {document,root,h,module,find}=await mounted(value);t.after(()=>module.dispose());
  assert.equal(root.querySelectorAll('li').length,1);
  assert.ok(root.textContent.includes(summary));
  assert.ok(root.textContent.includes(type));
  assert.ok(root.textContent.includes(itemName));
  assert.equal(root.querySelector('img'),null);
  assert.equal(root.querySelector('svg'),null);
  assert.equal(root.querySelector('b'),null);
  assert.doesNotMatch(root.textContent,/NEVER-DISPLAY-RAW-NOTE/);
  assert.equal(document.htmlWrites.length,1,'only the fixed shell uses HTML');
  const category=find('category'),refresh=find('refresh');
  category.focus();category.change('items');await drain();
  assert.equal(find('category'),category);
  assert.equal(document.activeElement,category);
  assert.equal(root.querySelectorAll('li').length,0,'old rows clear before the new classification is labelled');
  h.calls.at(-1).resolve(page({category:'items',entries:[categoryEntry('items','new-item')]}));await drain();
  assert.equal(document.activeElement,category);
  assert.equal(find('category'),category);
  refresh.focus();refresh.click();await drain();
  assert.deepEqual(h.calls.at(-1).body,{category:'items',cursor:null,contextEpoch:BASE.epoch});
  h.calls.at(-1).resolve(page({category:'items',entries:[],revision:5,serverNow:NOW+1}));await drain();
  assert.equal(document.activeElement,refresh);
  assert.equal(find('refresh'),refresh);
  assert.equal(find('empty').hidden,false);
  assert.equal(document.htmlWrites.length,1);
});

test('page controls focus the new page heading, respect moved focus, and retry a failed target without skipping',async t=>{
  const first=page({entries:[entry('first')],nextCursor:'second-cursor'}),second=page({entries:[entry('second')],nextCursor:null});
  const {document,root,h,module,find}=await mounted(first);t.after(()=>module.dispose());
  const next=find('next'),previous=find('previous'),category=find('category'),heading=find('page');
  root.scrollTop=400;next.focus();next.click();await drain();
  assert.equal(next.getAttribute('aria-disabled'),'true');
  const pendingCount=h.calls.length;next.click();assert.equal(h.calls.length,pendingCount);
  h.calls.at(-1).resolve(second);await drain();
  assert.equal(module.client.state.page,2);
  assert.equal(document.activeElement,heading);
  assert.equal(root.scrollTop,0);
  assert.equal(find('next'),next);
  assert.equal(find('previous'),previous);
  previous.focus();previous.click();await drain();
  category.focus();
  h.calls.at(-1).resolve(first);await drain();
  assert.equal(module.client.state.page,1);
  assert.equal(document.activeElement,category,'the completed read must not steal focus after the user moves it');
  next.focus();next.click();await drain();
  const failed=h.calls.at(-1);
  failed.reject(new Error('page temporarily offline'));await drain();
  assert.equal(module.client.state.page,1);
  assert.equal(find('error-box').hidden,false);
  assert.match(find('error').textContent,/offline/);
  const retry=find('retry');retry.focus();retry.click();await drain();
  assert.deepEqual(h.calls.at(-1).body,failed.body);
  h.calls.at(-1).resolve(second);await drain();
  assert.equal(module.client.state.page,2);
  assert.equal(document.activeElement,heading,'retry must not leave focus inside the hidden error box');
  assert.equal(find('error-box').hidden,true);
});

test('disposing a mounted view removes event handlers and blocks late DOM writes',async()=>{
  const {document,root}=documentFixture(),h=harness({document}),module=h.api.mount(root,h.host);
  assert.equal(h.calls.length,1);
  const request=h.calls[0],before=root.textContent;
  module.dispose();
  assert.equal(request.signal.aborted,true);
  assert.equal(root.events.get('click').size,0);
  assert.equal(root.events.get('change').size,0);
  request.resolve(page({entries:[entry('late',{summary:'MUST-NOT-PAINT-AFTER-CLOSE'})]}));await drain();
  assert.equal(root.textContent,before);
  root.querySelector('[data-ledger-refresh]').click();
  root.querySelector('[data-ledger-category]').change('items');
  await drain();
  assert.equal(h.calls.length,1);
});

test('real scene session carries ledger scope and epoch on pure reads without follow-up settlement or uncertain errors',async t=>{
  const sessionSource=fs.readFileSync(new URL('../public/scene-live-session.js',import.meta.url),'utf8');
  const endpoint='http://127.0.0.1:9852/app/api/',calls=[],deadlines=new Map();
  let sequence=0;
  const fetch=(url,options)=>{
    const pending=deferred();calls.push({url,options,body:JSON.parse(options.body),...pending});return pending.promise;
  };
  const sandbox={AbortController,queueMicrotask,console,
    setTimeout:(fn,ms)=>{const id=++sequence;deadlines.set(id,{fn,ms});return id;},clearTimeout:id=>deadlines.delete(id),
    setInterval:()=>{throw new Error('The ledger test must not start scene polling');},clearInterval:()=>{},fetch};
  vm.runInNewContext(sessionSource,sandbox,{filename:'scene-live-session.js'});
  const session=sandbox.RpgSceneSession.create({endpoint,fetch,accountId:BASE.accountId,realmId:'season-ledger',characterId:BASE.characterId});
  t.after(()=>session.dispose());
  session.setContext({realmId:'season-ledger'});
  const context=session.getContext(),body={category:'items',cursor:null,contextEpoch:context.epoch};
  const pending=session.request('ledger/history',body);
  assert.equal(calls.length,1);
  const call=calls[0];
  assert.equal(call.url,endpoint+'ledger/history');
  assert.equal(call.options.method,'POST');
  assert.equal(call.options.headers['X-Realm-Id'],'season-ledger');
  assert.equal(call.options.headers['X-Dev-Tg-Id'],BASE.accountId);
  assert.deepEqual(call.body,{...body,realmId:'season-ledger',selectedCharacterId:BASE.characterId});
  const value=page({context,category:'items'});
  call.resolve({ok:true,status:200,json:async()=>value});
  assert.deepEqual(plain(await pending),value);
  await drain();
  assert.equal(calls.length,1,'a successful pure ledger read must not call Atlas status or settle');
  assert.equal(deadlines.size,0);
  const failed=session.request('ledger/history',body).then(value=>({ok:true,value}),error=>({ok:false,error}));
  assert.equal(calls.length,2);
  calls[1].reject(new Error('offline'));
  const result=await failed;
  assert.equal(result.ok,false);
  assert.equal(result.error.code,'connection_failed');
  assert.equal(result.error.uncertain,false,'read failures cannot create an uncertain mutation recovery');
  assert.deepEqual(calls.map(row=>row.url),[endpoint+'ledger/history',endpoint+'ledger/history']);
  assert.equal(deadlines.size,0);
});
