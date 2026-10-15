import {MONSTER_ART_REVISION} from '../src/game/monster-art-compatibility.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../public/market-exchange.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const plain=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function attrs(text){return Object.fromEntries([...text.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(m=>[m[1],m[2]??'']));}
function dom(){
  const doc={activeElement:null};let html='',writes=0,nodes=[];
  function node(tag,attributes={},content=''){
    const events=new Map(),dataset=Object.fromEntries(Object.entries(attributes).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),value]));
    return {tagName:tag.toUpperCase(),attributes,dataset,disabled:Object.hasOwn(attributes,'disabled'),value:attributes.value||'',open:Object.hasOwn(attributes,'open'),textContent:content,innerHTML:content,isConnected:true,classList:{toggle(){},contains(){return false;}},hasAttribute:key=>Object.hasOwn(attributes,key),setAttribute(key,value){attributes[key]=value;},getAttribute:key=>attributes[key],addEventListener:(name,fn)=>events.set(name,fn),focus(){doc.activeElement=this;},dispatch(name){return events.get(name)?.({preventDefault(){},currentTarget:this,target:this});},closest(){return this;}};
  }
  const root={ownerDocument:doc,isConnected:true,scrollTop:17,classList:{toggle(){}},setAttribute(){},get innerHTML(){return html;},set innerHTML(value){html=value;writes++;nodes=[];for(const m of html.matchAll(/<(button|input|select|span|b)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)){const el=node(m[1],attrs(m[2]),m[3]||'');if(m[1]==='select'){const choices=[...el.innerHTML.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(o=>attrs(o[1]));el.value=(choices.find(o=>Object.hasOwn(o,'selected'))||choices[0])?.value||'';}nodes.push(el);}for(const m of html.matchAll(/<details\b([^>]*)>/g))nodes.push(node('details',attrs(m[1])));for(const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)){const el=node('form',attrs(m[1]),m[2]);el.elements={};for(const field of nodes.filter(n=>['INPUT','SELECT'].includes(n.tagName)&&m[2].includes(n.attributes.name?'name="'+n.attributes.name+'"':'__none__')))el.elements[field.attributes.name]=field;nodes.push(el);}},querySelector(selector){return this.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){if(selector==='button,input,select')return nodes.filter(n=>['BUTTON','INPUT','SELECT'].includes(n.tagName));const match=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);return match?nodes.filter(n=>n.hasAttribute(match[1])&&(match[2]===undefined||n.attributes[match[1]]===match[2])):[];},click(key,value=''){const button=nodes.find(n=>n.tagName==='BUTTON'&&n.attributes[key]===value);assert.ok(button,'missing '+key+'='+value);this.onclick?.({target:button});},get writes(){return writes;}};
  const halls=['shop','exchange'].map(key=>({dataset:{marketHall:key},open:false,ontoggle:null}));
  const view={querySelector:selector=>selector==='[data-market-exchange-body]'?root:null,querySelectorAll:selector=>selector==='[data-market-hall]'?halls:[]};
  return {root,view,doc,halls};
}
function setup({actor='hero-a',api,pendingStore=new Map(),confirm=async()=>true}={}){
  const window={},ctx=vm.createContext({window,AbortController});vm.runInContext(code,ctx);const d=dom(),calls=[],toasts=[],balances=[];let current=actor,requests=0;
  const host={esc,fmt:n=>Number(n).toLocaleString('en-US'),gearIcon:e=>'<img src="/art/'+esc(e.id)+'.webp" alt="">',itemIcon:k=>'<img src="/art/'+esc(k)+'.webp" alt="">',characterId:()=>current,requestId:()=>`00000000-0000-4000-8000-${String(++requests).padStart(12,'0')}`,toast:(...args)=>toasts.push(args),confirm,showDetail(){},onBalance:value=>balances.push(value),loadPending:key=>pendingStore.get(key),savePending:(key,value)=>value?pendingStore.set(key,plain(value)):pendingStore.delete(key),api:async(action,body,options)=>{calls.push({action,body:plain(body),options});return api?api(action,plain(body),options):{ok:true,items:[]};}};
  let handle=window.RpgMarketExchange.mount(d.view,host);
  return {...d,window,host,calls,toasts,balances,pendingStore,get handle(){return handle;},setActor:value=>current=value,remount(){handle.cleanup();handle=window.RpgMarketExchange.mount(d.view,host);},open(key='exchange'){const hall=d.halls.find(h=>h.dataset.marketHall===key);hall.open=true;hall.ontoggle();}};
}
const gear=id=>({kind:'equip',equipId:id,name:'月桂劍 '+id,equipment:{id,stat:10,statName:'ATK',slotName:'武器',elemStat:2,elementName:'風'},qty:1,category:'equipment',classReq:'sword',tier:4,quality:'epic',qualityName:'極品',enhance:5});
const book={kind:'item',item:'book_test',name:'秘術魔法書',qty:3,category:'skillbook',quality:'神話',qualityName:'神話',classReq:'mage',tier:null,enhance:null,advancementTier:4,requiredLevel:120,eligibleJob:'星辰法師'};
const angel={kind:'guardian',guardianId:'angel-1',item:null,name:'紫・天使・秘曜',qty:1,category:'guardian',classReq:'mage',tier:null,enhance:null,quality:'purple',qualityName:'紫色',art:'/art/guardian-sigil-20261013/magic.webp',guardian:{type:'magic',typeName:'天使・秘曜',quality:'purple',qualityName:'紫色',ability:'魔法傷害',damageBonus:.12,lootBonus:0}};

test('two stacked halls can remain open together; closed exchange and passive updates issue no reads',async()=>{
  const h=setup(),shell=h.window.RpgMarketExchange.shell('hero-a','<p>原商店</p>',esc);
  assert.ok(shell.indexOf('data-market-hall="shop"')<shell.indexOf('data-market-hall="exchange"'));assert.doesNotMatch(shell,/<details[^>]+name=/);
  assert.equal(h.calls.length,0);h.open('shop');h.open('exchange');await tick();assert.equal(h.halls.every(x=>x.open),true);assert.equal(h.calls.length,1);const writes=h.root.writes;h.handle.update();h.handle.update();assert.equal(h.root.writes,writes);assert.equal(h.calls.length,1);
});
test('thief is selectable in browse and candidate filters and melee guardians identify both compatible classes',async()=>{
  const melee={...angel,guardianId:'melee-angel',classReq:'sword',usableClasses:['sword','thief'],guardian:{...angel.guardian,type:'melee',ability:'近戰傷害'}};
  const h=setup({api:async()=>({items:[melee]})});h.open();await tick();
  const choose=()=>{const form=h.root.querySelector('[data-exchange-filter-form]');assert.match(form.innerHTML,/<option value="thief"/);form.elements.classReq.value='thief';form.dispatch('submit');};
  choose();await tick();assert.equal(h.calls.at(-1).body.filters.classReq,'thief');assert.match(h.root.innerHTML,/劍士／盜賊/);
  h.root.click('data-exchange-tab','create');await tick();choose();await tick();
  assert.equal(h.calls.at(-1).action,'exchange/sellable');assert.equal(h.calls.at(-1).body.filters.classReq,'thief');assert.match(h.root.innerHTML,/劍士／盜賊/);
});

test('candidate pagination appends beyond thirty, preserves selection and retains a later skill book',async()=>{
  const first=Array.from({length:30},(_,i)=>gear('g'+i)),second=[gear('g29'),gear('g30'),book];
  const h=setup({api:async(action,body)=>action==='exchange/sellable'?{items:body.cursor?second:first,nextCursor:body.cursor?null:'equip:g29'}:{items:[]}});
  h.open();await tick();h.root.click('data-exchange-tab','create');await tick();assert.equal(h.handle.state.sellable.length,30);h.root.click('data-exchange-pick','equip:g0');h.root.querySelector('[data-exchange-draft="price"]').value='1234';h.root.querySelector('[data-exchange-draft="price"]').dispatch('input');h.root.click('data-exchange-more');await tick();
  assert.equal(h.handle.state.sellable.length,32);assert.equal(h.handle.state.draft.selected,'equip:g0');assert.equal(h.handle.state.draft.price,'1234');assert.match(h.root.innerHTML,/item:book_test/);assert.equal(h.calls.at(-1).body.cursor,'equip:g29');assert.equal(h.handle.state.sellableNext,null);
});
test('gear, books and angels have independent genuine quality filters and irrelevant fields clear',async()=>{
  const h=setup();h.open();await tick();h.handle.state.filters={category:'equipment',quality:'supreme',classReq:'mage',tier:12,enhanceMin:8,enhanceMax:15};h.root.click('data-exchange-category','skillbook');await tick();
  assert.deepEqual(h.calls.at(-1).body.filters,{category:'skillbook',quality:'all',classReq:'mage',tier:null,enhanceMin:null,enhanceMax:null});assert.deepEqual(plain(h.window.RpgMarketExchange.qualityOptions('skillbook')).slice(1).map(x=>x[0]),['普通','高級','稀有','神話']);
  assert.deepEqual(plain(h.window.RpgMarketExchange.qualityOptions('guardian')).slice(1).map(x=>x[0]),['white','green','blue','purple','red','gold','pink','cyan']);assert.equal(h.root.querySelector('[data-exchange-filter-form]').elements.tier,undefined);
  h.root.click('data-exchange-category','guardian');await tick();assert.match(h.root.innerHTML,/value="cyan"/);assert.doesNotMatch(h.root.innerHTML,/<option value="神話"/);const form=h.root.querySelector('[data-exchange-filter-form]');form.elements.classReq.value='mage';form.elements.quality.value='purple';form.dispatch('submit');await tick();assert.deepEqual(h.calls.at(-1).body.filters,{category:'guardian',quality:'purple',classReq:'mage',tier:null,enhanceMin:null,enhanceMax:null});assert.equal(form.elements.enhanceMin,undefined);assert.equal(form.elements.enhanceMax,undefined);h.root.click('data-exchange-category','collection');await tick();assert.match(h.root.innerHTML,/地圖收集材料可交易/);assert.equal(h.root.querySelector('[data-exchange-filter-form]').elements.quality,undefined);
});
test('single angel listing submits guardianId with quantity one and full fee review',async()=>{
  const reviews=[],h=setup({confirm:async(...args)=>{reviews.push(args);return true;},api:async action=>action==='exchange/sellable'?{items:[angel]}:action==='exchange/create'?{ok:true,result:{listingId:'new'}}:{items:[]}});
  h.open();await tick();h.root.click('data-exchange-tab','create');await tick();h.root.click('data-exchange-pick','guardian:angel-1');const form=h.root.querySelector('[data-exchange-create-form]');assert.equal(form.elements.qty.hasAttribute('readonly'),true);form.elements.price.value='21';form.elements.price.dispatch('input');form.dispatch('submit');await tick();
  const mutation=h.calls.find(x=>x.action==='exchange/create');assert.equal(mutation.body.guardianId,'angel-1');assert.equal(mutation.body.qty,1);assert.equal(mutation.body.characterId,'hero-a');assert.ok(!('item' in mutation.body));assert.match(reviews[0][1],/魔法傷害 \+12%/);assert.match(reviews[0][1],/預計實收<b>19 金幣/);assert.equal(h.handle.state.tab,'mine');assert.equal(h.handle.state.pending,null);
});
test('uncertain mutation is not repeated automatically; remount retries identical UUID, payload and actor',async()=>{
  let writes=0,confirmations=0;const h=setup({confirm:async()=>{confirmations++;return true;},api:async action=>action==='exchange/sellable'?{items:[book]}:action==='exchange/create'?++writes===1?Promise.reject(Object.assign(Error('斷線'),{uncertain:true})):({ok:true,result:{listingId:'new'}}):{items:[]}});
  h.open();await tick();h.root.click('data-exchange-tab','create');await tick();h.root.click('data-exchange-pick','item:book_test');const form=h.root.querySelector('[data-exchange-create-form]');form.elements.qty.value='2';form.elements.price.value='101';form.dispatch('submit');await tick();assert.equal(writes,1);assert.ok(h.pendingStore.get('hero-a'));assert.match(h.root.innerHTML,/核對上筆/);const sent=h.calls.find(x=>x.action==='exchange/create').body;
  h.remount();h.root.click('data-exchange-retry');await tick();assert.equal(writes,2);assert.equal(confirmations,1);assert.deepEqual(h.calls.filter(x=>x.action==='exchange/create').map(x=>x.body),[sent,sent]);assert.equal(h.pendingStore.has('hero-a'),false);
});
test('switching actor while confirmation or a read is pending cannot send or apply old data',async()=>{
  let confirm,reply;const h=setup({confirm:()=>new Promise(r=>confirm=r),api:async action=>action==='exchange/sellable'?{items:[book]}:action==='exchange/list'?{items:[]}:action==='exchange/create'?{ok:true}:{items:[]}});
  h.open();await tick();h.root.click('data-exchange-tab','create');await tick();h.root.click('data-exchange-pick','item:book_test');const form=h.root.querySelector('[data-exchange-create-form]');form.elements.price.value='50';form.dispatch('submit');h.setActor('hero-b');confirm(true);await tick();assert.equal(h.calls.some(x=>x.action==='exchange/create'),false);assert.equal(h.pendingStore.size,0);
  const slow=setup({api:()=>new Promise(r=>reply=r)});slow.open();slow.setActor('hero-b');reply({items:[gear('old')],balance:{characterId:'hero-a',gold:9999,revision:99}});await tick();assert.equal(slow.handle.state.items.length,0);assert.equal(slow.balances.length,0);
});
test('changing tab cancels slow read; its late reply cannot contaminate the new editing view',async()=>{
  const replies=[];const h=setup({api:(action,body,options)=>new Promise(resolve=>replies.push({action,options,resolve}))});h.open();assert.match(h.root.innerHTML,/正在尋找/);h.root.click('data-exchange-tab','create');assert.equal(replies[0].options.signal.aborted,true);replies[1].resolve({items:[book]});await tick();replies[0].resolve({items:[{...gear('old'),id:'old'}]});await tick();assert.equal(h.handle.state.tab,'create');assert.equal(h.handle.state.sellable[0].item,'book_test');assert.equal(h.handle.state.items.length,0);assert.match(h.root.innerHTML,/item:book_test/);
});
test('invalid price and quantity never reach mutation; one gold correctly discloses zero proceeds',async()=>{
  const h=setup({api:async action=>action==='exchange/sellable'?{items:[book]}:{items:[]}});h.open();await tick();h.root.click('data-exchange-tab','create');await tick();h.root.click('data-exchange-pick','item:book_test');const form=h.root.querySelector('[data-exchange-create-form]');for(const [price,qty]of [['1e3','1'],['1.5','1'],['0','1'],['1000001','1'],['25','4']]){form.elements.price.value=price;form.elements.qty.value=qty;form.dispatch('submit');await tick();}assert.equal(h.calls.some(x=>x.action==='exchange/create'),false);assert.equal(h.toasts.length,5);assert.deepEqual(plain(h.window.RpgMarketExchange.money(1)),{price:1,fee:1,netGold:0});
});
test('same-character background render preserves market controller and focused form node',()=>{
  const h=setup(),form={focus:'price'};let rendered=0,updated=0,cleaned=0;const S={tab:'shop',choosing:false,creating:false,me:{character:{tgId:'hero-a'}}};
  const ctx=vm.createContext({S,document:{body:{classList:{toggle(){}}},querySelector:()=>form},guardianController:null,guardianActor:null,marketController:{update(){updated++;},cleanup(){cleaned++;}},marketActor:'hero-a',renderHud(){rendered++;},updateShopSurface(){},window:{}});
  const start=app.indexOf('  function render() {'),end=app.indexOf('  let refreshFlight=null;',start);vm.runInContext(app.slice(start,end)+';this.run=render;',ctx);ctx.run();ctx.run();assert.equal(rendered,2);assert.equal(updated,2);assert.equal(cleaned,0);assert.equal(ctx.document.querySelector('.market-hub'),form);h.handle.cleanup();
});
test('free draws disappear only from the bag and display credits retain the Japanese producer',()=>{
  const bag=app.slice(app.indexOf('  function bagView()'),app.indexOf('  function bindBag('));assert.match(bag,/item !== 'guardian_free_normal'/);assert.doesNotMatch(bag,/delete .*guardian_free_normal|guardian_free_normal.*=\s*0/);
  for(const file of ['index.html','expedition/index.html']){const html=fs.readFileSync(new URL('../public/'+file,import.meta.url),'utf8');assert.match(html,/Game Producer<\/span><span[^>]+>·<\/span><strong>ミカサ<\/strong>/);assert.doesNotMatch(html,/陳靖澄|遊戲製作人/);}
});

test('the actual app market host generates a canonical UUID accepted and replayed by the real MiniApp API',async()=>{
  const {freshDb}=await import('./d1-shim.js'),Player=await import('../src/services/player.js'),{handle}=await import('../src/index.js'),{T0}=await import('./helpers.js');
  const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};
  await Player.createCharacter(env,{tgId:'790',name:'主機編號測試',gender:'m',baseClass:'sword'},T0);
  await env.DB.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('790','scroll_w',3)").run();
  const window={},S={me:{character:{tgId:'790',gold:1000,revision:0}},shop:{},shopTab:'weapons'};let captured;
  const api=async(action,body)=>{const response=await handle(new Request('http://local/app/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'790','X-Debug-Now':String(T0),'X-Monster-Art-Revision':MONSTER_ART_REVISION},body:JSON.stringify(body)}),env);return {status:response.status,...await response.json()};};
  const ctx=vm.createContext({window,S,crypto:globalThis.crypto,Uint8Array,api,esc,fmt:String,gearIcon(){},devTg:'790',tg:null,confirmSheet(){},toast(){},sheet(){},closeSheet(){},renderHud(){},refreshMe(){},localStorage:{getItem(){return null;},setItem(){},removeItem(){}}});
  vm.runInContext(code,ctx);window.RpgMarketExchange.mount=(_view,host)=>{captured=host;return {};};
  const idStart=app.indexOf('  const rid ='),idEnd=app.indexOf('  const haptic =',idStart),start=app.indexOf('  function mountMarket(view)'),end=app.indexOf('  function bindShop(view)',start);
  assert.ok(idStart>0&&idEnd>idStart&&start>0&&end>start);
  vm.runInContext(app.slice(idStart,idEnd)+'let marketController,marketActor,marketShopRef,marketShopTab;'+app.slice(start,end)+';this.mountActual=mountMarket;',ctx);ctx.mountActual({});
  const requestId=captured.requestId();assert.match(requestId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);assert.notEqual(captured.requestId(),requestId);
  const body={item:'scroll_w',qty:1,price:20,characterId:captured.characterId(),requestId};
  const first=await captured.api('exchange/create',body),retry=await captured.api('exchange/create',body);
  assert.equal(first.status,200,JSON.stringify(first));assert.equal(retry.status,200);assert.equal(retry.result.listingId,first.result.listingId);
  assert.equal((await env.DB.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id='790' AND item='scroll_w'").first()).quantity,2);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_exchange_operations').first()).n,1);
});

test('market UUID fallback uses secure random bytes with UUID version/variant and leaves legacy IDs unchanged',()=>{
  let fills=0;const window={},ctx=vm.createContext({window,Uint8Array,crypto:{getRandomValues(bytes){fills++;bytes.fill(255);return bytes;}}});vm.runInContext(code,ctx);
  assert.equal(window.RpgMarketExchange.requestId(),'ffffffff-ffff-4fff-bfff-ffffffffffff');assert.equal(fills,1);
  assert.match(app,/const rid = \(\) => \(crypto\.randomUUID \? crypto\.randomUUID\(\)\.replace\(\/-\/g, ''\)/);
  assert.match(app,/requestId:\(\)=>`guardian_\$\{crypto\.randomUUID\(\)\.replace\(\/-\/g,''\)\}`/);
});

test('equipment enhancement is prominent on listings, mine, candidate and confirmation; non-equipment has no badge',async()=>{
 const reviews=[],enhanced={...gear('badge'),id:'listing-badge',enhance:12,price:5000,status:'active',canBuy:true,seller:{name:'旅者'}};
 const h=setup({api:async action=>({items:action==='exchange/sellable'?[enhanced,book,angel]:[enhanced,{...gear('zero'),id:'zero',enhance:0},book,angel]}),confirm:async(...args)=>{reviews.push(args);return false;}});
 h.open();await tick();assert.match(h.root.innerHTML,/exchange-enhance-badge" aria-label="強化 \+12">\+12/);assert.match(h.root.innerHTML,/exchange-enhance-title">\+12<\/span> 月桂劍/);assert.match(h.root.innerHTML,/aria-label="強化 \+0"/);assert.equal((h.root.innerHTML.match(/exchange-enhance-badge/g)||[]).length,2);
 h.root.click('data-exchange-buy','listing-badge');await tick();assert.match(reviews[0][1],/aria-label="強化 \+12"/);
 h.root.click('data-exchange-tab','mine');await tick();assert.match(h.root.innerHTML,/aria-label="強化 \+12"/);
 h.root.click('data-exchange-tab','create');await tick();assert.match(h.root.innerHTML,/aria-label="強化 \+12"/);
 h.root.click('data-exchange-pick','equip:badge');assert.equal((h.root.innerHTML.match(/aria-label="強化 \+12"/g)||[]).length,2);
});
