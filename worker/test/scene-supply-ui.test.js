import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/scene-supply-ui.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function module(environment={}){
  const window={};let serial=0;
  vm.runInNewContext(source,{...environment,window,Intl,URL,crypto:{randomUUID:()=> 'fixture-'+(++serial)},
    setInterval(){throw Error('supply windows must never start a poll');}});
  return window.RpgSceneSupply;
}
function storage(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(){
  const me={ok:true,realmId:'permanent',character:{tgId:'hero-a',name:'補給旅人',revision:1,gold:1000,autoRedPct:50,autoBlue:true,autoBluePct:50,autoRedPotion:'auto',autoBluePotion:'auto'},
    inventory:{red_1:10,blue_1:5,red_2:1,scroll_w:0,ward:4},equipment:[],
    supply:{redKey:'red_1',blueKey:'blue_1',redHours:2,blueHours:3,
      redOptions:[{key:'red_1',name:'小紅水',heal:50,count:10,unlocked:true},{key:'red_2',name:'中紅水',heal:150,count:1,unlocked:false},{key:'red_3',name:'大紅水',heal:300,count:0,unlocked:false}],
      blueOptions:[{key:'blue_1',name:'小藍水',heal:40,count:5,unlocked:true}]},
    refill:{red_1:20,blue_1:10,cost:160}};
  const shop={items:[{item:'red_1',name:'小紅水',price:6,desc:'生命 +50'},{item:'blue_1',name:'小藍水',price:4,desc:'魔力 +40'},
    {item:'scroll_w',name:'武器卷軸',price:30,desc:'用於武器強化'},{item:'ward',name:'守護符',price:100,desc:'最多持有 5、每日限購 3'}],
    gear:[{code:'sword_t1',name:'月桂短劍',slot:'weapon',group:'weapon',tier:1,levelReq:1,price:120,desc:'目前職業可購買'}],
    gacha:[{type:'weapon',name:'武器轉蛋',price:10000,description:'封存轉蛋'}],gachaRates:[{rarity:'legendary',pct:85},{rarity:'supreme',pct:15}]};
  const meta={ok:true,meta:{items:{red_1:{name:'小紅水',kind:'red',heal:50,price:6},blue_1:{name:'小藍水',kind:'blue',heal:40,price:4},
    red_2:{name:'中紅水',kind:'red',heal:150,price:12},scroll_w:{name:'武器卷軸',kind:'scroll',price:30},
    ward:{name:'守護符',kind:'ward',maxHold:5,dailyBuy:3},blessed_scroll_w:{name:'不販售的祝福卷',kind:'scroll',price:1}}}};
  return {me,shop,meta,atlas:{ok:true,realmId:'permanent',characterId:'hero-a',run:{id:'run-a',status:'running',supplies:{hp:3,mp:4}}},ledger:[]};
}
function harness(options={}){
  const api=options.api||module(),data=options.data||fixture(),saved=options.storage||storage(),calls=[],writes=[],draft=options.draft||{};
  let context={accountId:'90101',realmId:'permanent',characterId:'hero-a',epoch:1,...options.context},notifications=0;
  const request=async(action,body)=>{
    calls.push({action,body:plain(body)});
    if(['buy','buy-gear','gacha','refill','settings'].includes(action)){
      writes.push({action,body:plain(body)});
      if(options.mutate)return options.mutate(action,body,data,writes);
      if(action==='settings')Object.assign(data.me.character,body);
      else if(action==='buy'){const offer=data.shop.items.find(x=>x.item===body.item);data.me.character.gold-=offer.price*body.qty;data.me.inventory[body.item]=(data.me.inventory[body.item]||0)+body.qty;}
      return plain({...data.me,result:{item:action==='buy-gear'?{id:'purchased-gear'}:body.item,qty:body.qty,total:body.qty*6}});
    }
    if(options.read){const answer=await options.read(action,body,data);if(answer!==undefined)return answer;}
    if(action==='me')return plain(data.me);
    if(action==='shop')return plain({...data.me,shop:data.shop});
    if(action==='meta')return plain(data.meta);
    if(action==='atlas/status')return plain(data.atlas);
    if(action==='ledger')return {ok:true,realmId:context.realmId,ledger:plain(data.ledger)};
    throw Error('unexpected action '+action);
  };
  const host={request,getContext:()=>context,current:()=>true,draft,storage:saved,onChanged:()=>notifications++};
  const client=api.createClient(host,{tab:options.tab||'shop'});
  return {api,client,data,calls,writes,draft,saved,host,setContext:next=>{context=next;},notifications:()=>notifications};
}
async function until(check){for(let i=0;i<20&&!check();i++)await Promise.resolve();assert.ok(check(),'expected async operation started');}

test('opening uses explicit legacy reads once; scene updates never poll or erase form drafts',async()=>{
  const h=harness({tab:'supplies'});await h.client.refresh();
  assert.deepEqual(h.calls.map(x=>x.action),['me','meta','atlas/status']);
  h.client.setSetting('autoRedPct','65');h.draft.quantities['item:red_1']='17';h.draft.search='紅';h.draft.category='potion';h.draft.scrollTop=98;
  const before=h.calls.length;
  assert.equal(h.client.update({...h.data.atlas,run:{status:'running',supplies:{hp:2,mp:4}}}),true);
  assert.equal(h.calls.length,before);assert.equal(h.draft.settings.autoRedPct,'65');
  h.data.me.character.autoRedPct=40;h.data.me.character.autoBluePct=60;
  await h.client.refresh();
  assert.equal(h.draft.settings.autoRedPct,'65');assert.equal(h.draft.settings.autoBluePct,'60');
  assert.equal(h.draft.quantities['item:red_1'],'17');assert.equal(h.draft.search,'紅');assert.equal(h.draft.scrollTop,98);
});

test('only server offers are purchasable; quantities, gold and hold limits are validated before a write',async()=>{
  const h=harness();await h.client.refresh();
  const entries=plain(h.client.entries());
  assert.equal(entries.some(x=>x.item==='blessed_scroll_w'),false);
  assert.equal(entries.find(x=>x.key==='gear:sword_t1').action,'buy-gear');
  for(const qty of ['',0,-1,1.5,10000,'Infinity']){
    h.draft.quantities['item:red_1']=String(qty);await h.client.preparePurchase('item:red_1');assert.equal(h.client.state.confirmation,null);
  }
  h.draft.quantities['item:red_1']='200';await h.client.preparePurchase('item:red_1');assert.match(h.client.state.error,/金幣不足/);
  h.draft.quantities['item:ward']='2';await h.client.preparePurchase('item:ward');assert.match(h.client.state.error,/持有上限/);
  await h.client.preparePurchase('item:blessed_scroll_w');assert.match(h.client.state.error,/不能購買/);
  assert.equal(h.writes.length,0);
});

test('purchase preview and cancel retain quantities; the exact confirmed body is sent once',async()=>{
  const gate=deferred(),h=harness({mutate:async()=>gate.promise});
  await h.client.refresh();h.draft.quantities['item:red_1']='12';
  await h.client.preparePurchase('item:red_1');assert.equal(h.client.state.confirmation.total,72);assert.equal(h.writes.length,0);
  assert.equal(h.client.cancel(),true);assert.equal(h.draft.quantities['item:red_1'],'12');
  await h.client.preparePurchase('item:red_1');
  const submitting=h.client.confirm();await until(()=>h.writes.length===1);
  assert.equal(await h.client.confirm(),false);
  assert.equal(h.writes[0].action,'buy');assert.equal(h.writes[0].body.item,'red_1');assert.equal(h.writes[0].body.qty,12);
  assert.match(h.writes[0].body.requestId,/^supply-/);
  gate.resolve({...h.data.me,result:{item:'red_1',qty:12,total:72}});await submitting;
  assert.equal(h.notifications(),1);assert.equal(h.client.state.pending,null);assert.equal(h.writes.length,1);
});

test('changed price is re-presented for approval instead of spending the old preview',async()=>{
  const h=harness();await h.client.refresh();h.draft.quantities['item:red_1']='2';
  await h.client.preparePurchase('item:red_1');assert.equal(h.client.state.confirmation.total,12);
  h.data.shop.items[0].price=9;
  await h.client.confirm();assert.equal(h.writes.length,0);assert.equal(h.client.state.confirmation.total,18);
  assert.match(h.client.state.notice,/再次確認/);
  await h.client.confirm();assert.equal(h.writes.length,1);assert.equal(h.data.me.character.gold,982);
});

test('settings expose only supported rules, allow owned locked potions, and preserve unsaved choices',async()=>{
  const h=harness({tab:'supplies'});await h.client.refresh();
  h.client.setSetting('autoRed',false);h.client.setSetting('autoRedPct','63');h.client.setSetting('autoBlue',false);h.client.setSetting('autoRedPotion','red_2');
  await h.client.prepareSettings();const body=plain(h.client.state.confirmation.body);
  assert.deepEqual(body,{autoRedPct:63,autoBlue:false,autoRedPotion:'red_2'});assert.equal(Object.hasOwn(body,'autoRed'),false);
  await h.client.confirm();assert.equal(h.writes.length,1);assert.equal(h.writes[0].action,'settings');assert.equal(h.client.state.pending,null);
  h.client.setSetting('autoRedPotion','red_3');await h.client.prepareSettings();assert.match(h.client.state.error,/尚未解鎖/);
  assert.equal(h.writes.length,1);
  h.client.setSetting('autoRedPotion','red_1');h.client.setSetting('autoBluePct','81');await h.client.prepareSettings();assert.match(h.client.state.error,/20–80/);
});

test('refill uses real selected shop prices, preserves partial funding, and rejects unavailable potion purchases',()=>{
  const api=module(),f=fixture();f.me.character.gold=80;
  const plan=plain(api.refillPreview(f.me,f.shop));
  assert.equal(plan.total,80);assert.equal(plan.partial,true);
  assert.deepEqual(plan.rows.map(x=>[x.item,x.quantity]),[['red_1',10],['blue_1',5]]);
  assert.match(plan.description,/不增加進行中星圖/);
  f.me.supply.redKey='red_2';f.me.refill={red_2:10,blue_1:10,cost:160};
  assert.throws(()=>api.refillPreview(f.me,f.shop),/尚未解鎖/);
});

test('uncertain refill cannot be resent; read-back and explicit acknowledgement do not create another mutation',async()=>{
  const h=harness({tab:'supplies',mutate:async()=>{throw Object.assign(Error('connection lost'),{uncertain:true});}});
  await h.client.refresh();await h.client.prepareRefill();await h.client.confirm();
  const pending=plain(h.client.state.pending);assert.equal(pending.action,'refill');
  assert.equal(await h.client.retry(),false);assert.equal(h.writes.length,1);
  await h.client.prepareRefill();assert.equal(h.client.state.confirmation,null);
  await h.client.checkResult();assert.equal(h.client.state.checked,true);assert.equal(h.writes.length,1);
  assert.equal(h.client.acknowledge(),true);assert.equal(h.client.state.pending,null);assert.equal(h.writes.length,1);
});

test('lost settings response is resolved by reading the desired values, never by replaying settings',async()=>{
  const h=harness({tab:'supplies',mutate:async(action,body,data)=>{Object.assign(data.me.character,body);throw Object.assign(Error('lost response'),{uncertain:true});}});
  await h.client.refresh();h.client.setSetting('autoBlue',false);
  await h.client.prepareSettings();await h.client.confirm();assert.equal(h.client.state.pending.action,'settings');
  assert.equal(await h.client.retry(),false);
  await h.client.checkResult();assert.equal(h.client.state.pending,null);assert.equal(h.writes.length,1);assert.match(h.client.state.result.message,/讀回核對/);
});

test('unknown purchase survives remount and retries its original ID and quantity despite edited drafts',async()=>{
  const api=module(),saved=storage(),data=fixture(),seen=new Set(),writes=[];
  const mutate=async(action,body,f)=>{
    writes.push(plain(body));
    if(seen.has(body.requestId))throw Object.assign(Error('already committed'),{code:'duplicate',status:409,uncertain:false});
    seen.add(body.requestId);f.me.character.gold-=body.qty*6;f.me.inventory.red_1+=body.qty;
    throw Object.assign(Error('lost after commit'),{uncertain:true});
  };
  const first=harness({api,storage:saved,data,mutate});await first.client.refresh();first.draft.quantities['item:red_1']='5';
  await first.client.preparePurchase('item:red_1');await first.client.confirm();first.client.dispose();
  const again=harness({api,storage:saved,data,mutate});await again.client.refresh();again.draft.quantities['item:red_1']='99';
  await again.client.preparePurchase('item:scroll_w');assert.equal(again.client.state.confirmation,null);
  await again.client.retry();
  assert.deepEqual(writes[1],writes[0]);assert.equal(again.data.me.inventory.red_1,15);assert.equal(again.data.me.character.gold,970);
  assert.equal(again.client.state.pending,null);assert.equal(again.notifications(),1);
});

test('a rejection during recovery does not falsely clear an earlier uncertain purchase',async()=>{
  let count=0;const h=harness({mutate:async()=>{
    if(!count++)throw Object.assign(Error('unknown after submit'),{uncertain:true});
    throw Object.assign(Error('current gold is insufficient'),{code:'gold',status:400,uncertain:false});
  }});
  await h.client.refresh();await h.client.preparePurchase('item:red_1');await h.client.confirm();const id=h.client.state.pending.body.requestId;
  await h.client.retry();assert.equal(h.client.state.pending.body.requestId,id);assert.equal(h.client.state.pending.uncertain,true);
});

test('definite first rejection clears only its pending operation without changing drafts',async()=>{
  const h=harness({mutate:async()=>{throw Object.assign(Error('daily limit reached'),{code:'daily_limit',status:400,uncertain:false});}});
  await h.client.refresh();h.draft.quantities['item:red_1']='8';await h.client.preparePurchase('item:red_1');await h.client.confirm();
  assert.equal(h.client.state.pending,null);assert.match(h.client.state.error,/daily limit/);assert.equal(h.draft.quantities['item:red_1'],'8');assert.equal(h.notifications(),0);
});

test('late reads cannot paint a different context, including rapid A-B-A',async()=>{
  const gate=deferred(),h=harness({read:async action=>action==='shop'?gate.promise:undefined});
  const reading=h.client.refresh();
  h.setContext({accountId:'90101',realmId:'season-a',characterId:'hero-b',epoch:2});
  h.setContext({accountId:'90101',realmId:'permanent',characterId:'hero-a',epoch:3});
  gate.resolve({...h.data.me,shop:h.data.shop});await reading;
  assert.equal(h.client.state.me,null);assert.equal(h.notifications(),0);
});

test('a write reply after disposal retains pending recovery and never notifies another window',async()=>{
  const gate=deferred(),api=module(),saved=storage(),h=harness({api,storage:saved,mutate:async()=>gate.promise});
  await h.client.refresh();await h.client.preparePurchase('item:red_1');const acting=h.client.confirm();await until(()=>h.writes.length===1);
  const original=plain(h.client.state.pending);h.client.dispose();gate.resolve({...h.data.me,result:{item:'red_1',qty:1,total:6}});await acting;
  assert.equal(h.notifications(),0);
  const resumed=harness({api,storage:saved});assert.deepEqual(plain(resumed.client.state.pending),original);
  const foreign=harness({api,storage:saved,context:{realmId:'season-a'}});assert.equal(foreign.client.state.pending,null);
  const account=harness({api,storage:saved,context:{accountId:'90102'}});assert.equal(account.client.state.pending,null);
});

test('foreign mutation responses stay unresolved and cannot replace the visible player',async()=>{
  const h=harness({mutate:async(action,body,data)=>({...data.me,realmId:'season-a',character:{...data.me.character,tgId:'hero-b'}})});
  await h.client.refresh();await h.client.preparePurchase('item:red_1');await h.client.confirm();
  assert.equal(h.client.state.me.character.tgId,'hero-a');assert.ok(h.client.state.pending);assert.equal(h.notifications(),0);
});

test('rendering escapes server names and separates inventory, reserved Atlas supplies and confirmation totals',async()=>{
  const h=harness({tab:'supplies'});await h.client.refresh();
  const html=h.api.render(h.client.state,h.draft,{});
  assert.match(html,/背包共 11 瓶/);assert.match(html,/本趟星圖已預留/);assert.match(html,/不改變當趟快照/);
  assert.equal(html.includes('name="autoRed"'),false);assert.ok(html.includes('name="autoBlue"'));
  h.data.me.character.name='<script>alert(1)</script>';h.data.shop.items[0].name='<img src=x onerror=alert(1)>';
  const shop=harness({data:h.data});await shop.client.refresh();
  const rendered=shop.api.render(shop.client.state,shop.draft,{});
  assert.ok(rendered.includes('&lt;script&gt;'));assert.ok(rendered.includes('&lt;img'));assert.equal(rendered.includes('<img src=x'),false);
  const plan=shop.api.purchasePlan(shop.client.entries()[0],'3',shop.client.state.me);
  const confirmation=shop.api.confirmationHtml(plan,shop.client.state.meta);
  assert.match(confirmation,/總計 18 金幣/);assert.ok(confirmation.includes('data-supply-cancel'));
});

test('mounted shop keeps the same search input throughout IME composition and filters only after compositionend',async()=>{
  const listeners=new Map(),document={activeElement:null,querySelector:()=>({})};
  let html='',search=null,paints=0;
  const reserved={innerHTML:''};
  const root={
    scrollTop:0,contains:node=>node===search,
    querySelectorAll:selector=>selector==='[name]'&&search?[search]:[],
    querySelector:selector=>selector==='[name="supplySearch"]'?search:selector==='[data-supply-reserved]'?reserved:null,
    addEventListener:(name,listener)=>listeners.set(name,listener),
    removeEventListener:(name,listener)=>{if(listeners.get(name)===listener)listeners.delete(name);},
    get innerHTML(){return html;},
    set innerHTML(value){
      html=value;paints++;
      const match=html.match(/name="supplySearch" value="([^"]*)"/);
      search=match?{name:'supplySearch',type:'search',dataset:{},value:match[1],selectionStart:0,selectionEnd:0,
        focus(){document.activeElement=this;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}}:null;
    }
  };
  const api=module({document}),h=harness({api,draft:{quantities:{'item:red_1':'17'}}});
  const mounted=api.mount(root,h.host,{tab:'shop'});await new Promise(resolve=>setImmediate(resolve));
  const initial=root.querySelector('[name="supplySearch"]'),beforePaints=paints,beforeCalls=h.calls.length;
  assert.ok(initial);initial.focus();
  assert.ok(html.includes('data-supply-offer="item:blue_1"'));
  listeners.get('compositionstart')({target:initial});
  initial.value='紅';initial.selectionStart=1;initial.selectionEnd=1;
  listeners.get('input')({target:initial,isComposing:true});
  assert.equal(root.querySelector('[name="supplySearch"]'),initial);
  assert.equal(document.activeElement,initial);
  assert.equal(paints,beforePaints);assert.equal(h.draft.search,'紅');
  mounted.update({...h.data.atlas,run:{...h.data.atlas.run,supplies:{hp:2,mp:3}}});
  assert.equal(root.querySelector('[name="supplySearch"]'),initial);
  assert.equal(paints,beforePaints,'live reserved-supply updates leave the composing input intact');
  initial.value='紅水';initial.selectionStart=2;initial.selectionEnd=2;
  listeners.get('input')({target:initial,isComposing:false});
  assert.equal(paints,beforePaints,'the final input event may precede compositionend');
  assert.ok(html.includes('data-supply-offer="item:blue_1"'));
  listeners.get('compositionend')({target:initial});
  const committed=root.querySelector('[name="supplySearch"]');
  assert.notEqual(committed,initial);assert.equal(committed.value,'紅水');
  assert.equal(document.activeElement,committed);assert.equal(committed.selectionStart,2);
  assert.equal(h.draft.search,'紅水');assert.equal(h.draft.quantities['item:red_1'],'17');
  assert.ok(html.includes('data-supply-offer="item:red_1"'));
  assert.equal(html.includes('data-supply-offer="item:blue_1"'),false);
  assert.equal(h.calls.length,beforeCalls);assert.equal(h.writes.length,0);
  mounted.dispose();h.client.dispose();assert.equal(listeners.size,0);
});

test('native change emitted while removing the focused search input cannot reenter DOM rendering',async()=>{
  const listeners=new Map(),document={activeElement:null,querySelector:()=>({})};
  let html='',search=null,depth=0,paints=0,nativeChanges=0;
  const root={
    scrollTop:0,contains:node=>node===search,
    querySelectorAll:selector=>selector==='[name]'&&search?[search]:[],
    querySelector:selector=>selector==='[name="supplySearch"]'?search:null,
    addEventListener:(name,listener)=>listeners.set(name,listener),
    removeEventListener:(name,listener)=>{if(listeners.get(name)===listener)listeners.delete(name);},
    get innerHTML(){return html;},
    set innerHTML(value){
      assert.equal(depth,0,'the DOM must not be rebuilt recursively from its own native change event');
      depth++;
      try{
        if(search&&document.activeElement===search&&search.value!==search.committedValue){
          nativeChanges++;search.committedValue=search.value;
          listeners.get('change')?.({type:'change',target:search});
        }
        html=value;paints++;
        const match=html.match(/name="supplySearch" value="([^"]*)"/);
        search=match?{name:'supplySearch',type:'search',dataset:{},value:match[1],committedValue:match[1],selectionStart:0,selectionEnd:0,
          focus(){document.activeElement=this;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}}:null;
      }finally{depth--;}
    }
  };
  const api=module({document}),h=harness({api});
  const mounted=api.mount(root,h.host,{tab:'shop'});await new Promise(resolve=>setImmediate(resolve));
  const beforeCalls=h.calls.length;
  for(const value of ['紅','藍','']){
    const active=search,previousPaints=paints,previousChanges=nativeChanges;
    active.focus();active.value=value;active.selectionStart=value.length;active.selectionEnd=value.length;
    assert.doesNotThrow(()=>listeners.get('input')({type:'input',target:active,isComposing:false}));
    assert.equal(nativeChanges,previousChanges+1);
    assert.equal(paints,previousPaints+1,'one input change produces one completed DOM update');
    assert.equal(h.draft.search,value);assert.equal(search.value,value);assert.equal(document.activeElement,search);
    assert.equal(search.selectionStart,value.length);
    if(value==='紅')assert.equal(html.includes('data-supply-offer="item:blue_1"'),false);
    if(value==='藍')assert.equal(html.includes('data-supply-offer="item:red_1"'),false);
    if(value==='')assert.ok(html.includes('data-supply-offer="item:blue_1"')&&html.includes('data-supply-offer="item:red_1"'));
    const afterInput=paints;
    listeners.get('change')({type:'change',target:search});
    assert.equal(paints,afterInput,'a subsequent committed change must not rebuild the search again');
  }
  assert.equal(h.calls.length,beforeCalls);assert.equal(h.writes.length,0);
  mounted.dispose();h.client.dispose();assert.equal(listeners.size,0);
});
