import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../public/market-exchange-history.js',import.meta.url),'utf8');
const market=fs.readFileSync(new URL('../public/market-exchange.js',import.meta.url),'utf8');
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const attributes=text=>Object.fromEntries([...text.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(m=>[m[1],m[2]??'']));
function dom() {
  const doc={activeElement:null};let html='',writes=0,nodes=[],child=null;
  function node(tag,attrs={},content='') {
    const events=new Map(),dataset=Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),value]));
    return {tagName:tag.toUpperCase(),attributes:attrs,dataset,disabled:Object.hasOwn(attrs,'disabled'),value:attrs.value||'',innerHTML:content,textContent:content,isConnected:true,classList:{toggle(){}},hasAttribute:key=>Object.hasOwn(attrs,key),setAttribute(key,value){attrs[key]=value;},addEventListener:(key,fn)=>events.set(key,fn),focus(){doc.activeElement=this;},closest(){return this;},dispatch(key){return events.get(key)?.({preventDefault(){},currentTarget:this,target:this});}};
  }
  const root={ownerDocument:doc,isConnected:true,scrollTop:0,classList:{toggle(){}},setAttribute(){},get innerHTML(){return html;},set innerHTML(value){html=value;writes++;nodes=[];if(child)child.isConnected=false;child=html.includes('data-exchange-history-root')?dom():null;for(const m of html.matchAll(/<(button|input|select|span|b)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)){const el=node(m[1],attributes(m[2]),m[3]||'');if(m[1]==='select'){const options=[...el.innerHTML.matchAll(/<option\b([^>]*)>/g)].map(o=>attributes(o[1]));el.value=(options.find(o=>Object.hasOwn(o,'selected'))||options[0])?.value||'';}nodes.push(el);}for(const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)){const el=node('form',attributes(m[1]),m[2]);el.elements={};for(const field of nodes.filter(n=>['INPUT','SELECT'].includes(n.tagName)&&m[2].includes('name="'+n.attributes.name+'"')))el.elements[field.attributes.name]=field;nodes.push(el);}},querySelector(selector){if(selector==='[data-exchange-history-root]')return child;return this.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){if(selector==='button,input,select')return nodes.filter(n=>['BUTTON','INPUT','SELECT'].includes(n.tagName));const match=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);return match?nodes.filter(n=>n.hasAttribute(match[1])&&(match[2]===undefined||n.attributes[match[1]]===match[2])):[];},click(key,value=''){const button=nodes.find(n=>n.tagName==='BUTTON'&&n.attributes[key]===value);assert.ok(button,'missing '+key+'='+value);this.onclick?.({target:button});},get writes(){return writes;},get child(){return child;}};
  return root;
}
function setup({api,actor='history-a',parent=false}={}) {
  const window={},context=vm.createContext({window,AbortController,Intl,Date,setInterval(){assert.fail('history must not poll');},setTimeout(){assert.fail('history must not create timers');}});vm.runInContext(code,context);if(parent)vm.runInContext(market,context);
  const root=dom(),calls=[],details=[];let current=actor;
  const host={characterId:()=>current,esc,fmt:n=>Number(n).toLocaleString('en-US'),gearIcon:e=>'<img src="/art/'+esc(e.id)+'.webp" alt="">',itemIcon:key=>key?'<img src="/art/'+esc(key)+'.webp" alt="">':'',showDetail:html=>details.push(html),confirm(){assert.fail('history cannot prompt a purchase');},onBalance(){assert.fail('history cannot overwrite the wallet');},toast(){},api:(action,body,options)=>{calls.push({action,body:plain(body),options});return api?api(action,plain(body),options):Promise.resolve({characterId:current,items:[]});}};
  const halls=['shop','exchange'].map(key=>({dataset:{marketHall:key},open:false}));
  const view={querySelector:selector=>selector==='[data-market-exchange-body]'?root:null,querySelectorAll:()=>halls};
  const mount=()=>parent?window.RpgMarketExchange.mount(view,host):window.RpgMarketExchangeHistory.mount(root,host);let handle=mount();
  return {root,calls,details,host,window,halls,get handle(){return handle;},setActor(value){current=value;},remount(){handle.cleanup();handle=mount();},open(){halls[1].open=true;halls[1].ontoggle();}};
}
const entry=(id,role='buy',over={})=>({id,listingId:'listing-'+id,role,settledAt:Date.parse('2026-10-14T01:23:00Z'),qty:2,price:101,...(role==='sell'?{fee:6,netGold:95,goldDelta:95}:{paidGold:101,goldDelta:-101,feePaidBy:'seller'}),counterparty:{name:'另一旅者'},item:{kind:'item',item:'scroll_w',name:'武器強化捲',quality:null,category:'scroll',snapshotAvailable:true},...over});

test('history mounts without network or timers; an explicit read is deduplicated and carries the captured actor',async()=>{
  let resolve;const h=setup({api:()=>new Promise(r=>resolve=r)});assert.equal(h.calls.length,0);const one=h.handle.refresh(),two=h.handle.refresh();await tick();assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].body,{characterId:'history-a',role:'all'});assert.equal(h.calls[0].action,'exchange/history');
  resolve({characterId:'history-a',items:[entry('read')]});await Promise.all([one,two]);assert.match(h.root.innerHTML,/武器強化捲/);await h.handle.refresh();assert.equal(h.calls.length,1);
});

test('buy and sell detail sheets show the correct actual amounts and never offer another purchase',async()=>{
  const h=setup({api:()=>Promise.resolve({characterId:'history-a',items:[entry('buy'),entry('sell','sell')]})});await h.handle.refresh();
  h.root.click('data-history-detail','buy');assert.match(h.details[0],/付款金幣.*−101/);assert.match(h.details[0],/手續費由賣方負擔/);assert.doesNotMatch(h.details[0],/手續費 <small>5%|data-exchange-buy|data-history-buy|確認購買/);
  h.root.click('data-history-detail','sell');assert.match(h.details[1],/成交總價.*101/);assert.match(h.details[1],/手續費 <small>5%<\/small>.*−6/);assert.match(h.details[1],/實收金幣.*\+95/);assert.match(h.details[1],/成交時的物品快照/);assert.equal(h.calls.length,1);
});

test('role filters, forward/back keyset pages and manual refresh preserve per-role state',async()=>{
  const h=setup({api:(_action,body)=>Promise.resolve({characterId:'history-a',items:[entry(body.role+(body.cursor||'first'))],nextCursor:body.cursor?null:'123:45'})});await h.handle.refresh();h.root.click('data-history-next');await tick();assert.equal(h.calls.at(-1).body.cursor,'123:45');assert.equal(h.handle.state.views.all.page,1);
  h.root.click('data-history-prev');await tick();assert.equal(h.calls.at(-1).body.cursor,undefined);assert.equal(h.handle.state.views.all.page,0);
  h.root.click('data-history-role','sell');await tick();assert.equal(h.calls.at(-1).body.role,'sell');h.root.click('data-history-next');await tick();assert.equal(h.handle.state.views.sell.page,1);
  h.root.click('data-history-role','all');await tick();assert.equal(h.calls.length,5,'a previously loaded role reuses its own page');assert.equal(h.handle.state.views.all.page,0);
  h.root.click('data-history-role','sell');await tick();assert.equal(h.handle.state.views.sell.page,1);await h.handle.refresh(true);assert.equal(h.calls.at(-1).body.cursor,undefined);assert.equal(h.handle.state.views.sell.page,0);
});

test('switching actor or unmounting rejects a late reply and aborts its signal without polluting new history',async()=>{
  const replies=[],h=setup({api:()=>new Promise(resolve=>replies.push(resolve))});const old=h.handle.refresh();await tick();const oldState=h.handle.state;h.setActor('history-b');h.remount();assert.equal(h.calls[0].options.signal.aborted,true);
  const now=h.handle.refresh();await tick();replies[1]({characterId:'history-b',items:[entry('new')]});await now;replies[0]({characterId:'history-a',items:[entry('old')]});await old;
  assert.deepEqual(plain(oldState.views.all.items),[]);assert.equal(h.handle.state.views.all.items[0].id,'new');assert.doesNotMatch(h.root.innerHTML,/data-history-detail="old"/);
  const pending=h.handle.refresh(true);await tick();const writes=h.root.writes;h.handle.cleanup();assert.equal(h.calls.at(-1).options.signal.aborted,true);replies[2]({characterId:'history-b',items:[entry('ignored')]});await pending;assert.equal(h.root.writes,writes);assert.equal(h.root.onclick,null);
});

test('a mismatched server actor cannot populate the current role even if the returned items look valid',async()=>{
  const h=setup({api:()=>Promise.resolve({characterId:'someone-else',items:[entry('foreign')]})});await h.handle.refresh();assert.equal(h.handle.state.views.all.items.length,0);assert.match(h.root.innerHTML,/角色已切換/);assert.doesNotMatch(h.root.innerHTML,/data-history-detail="foreign"/);
});

test('network failures including synchronous host failure clear loading and permit a manual read retry',async()=>{
  let attempts=0;const h=setup({api:()=>{if(++attempts===1)throw new Error('Failed to fetch stack secret');return Promise.resolve({characterId:'history-a',items:[entry('retry')]});}});await h.handle.refresh();assert.match(h.root.innerHTML,/暫時無法讀取成交紀錄/);assert.doesNotMatch(h.root.innerHTML,/Failed to fetch|stack secret|aria-busy="true"/);h.root.click('data-history-refresh');await tick();assert.equal(attempts,2);assert.match(h.root.innerHTML,/data-history-detail="retry"/);
});

test('history safely escapes snapshot names/counterparties, rejects hostile art and survives malformed time',async()=>{
  const name='<script>alert(1)</script>',h=setup({api:()=>Promise.resolve({characterId:'history-a',items:[entry('safe','sell',{settledAt:'bad-time',counterparty:{name:'<img src=x onerror=alert(2)>'},item:{kind:'guardian',name,art:'javascript:alert(3)',quality:'purple',guardian:{qualityName:'紫色',typeName:'天使・秘曜',ability:'魔法傷害'},snapshotAvailable:false}})]})});await h.handle.refresh();assert.match(h.root.innerHTML,/guardian-quality-purple/);assert.match(h.root.innerHTML,/&lt;script&gt;/);assert.match(h.root.innerHTML,/成交時間暫無/);assert.doesNotMatch(h.root.innerHTML,/<script>|javascript:/);h.root.click('data-history-detail','safe');assert.match(h.details[0],/&lt;img/);assert.match(h.details[0],/快照暫無法顯示/);assert.doesNotMatch(h.details[0],/<img src=x|javascript:/);
});

test('the actual market parent mounts the fourth short-label tab, uses read-only history and does not reload on background updates',async()=>{
  const h=setup({parent:true,api:(action,body)=>Promise.resolve({characterId:'history-a',items:action==='exchange/history'?[entry('parent')]:[]})});assert.equal(h.calls.length,0);assert.equal(h.root.querySelectorAll('[data-exchange-tab]').length,4);for(const node of h.root.querySelectorAll('[data-exchange-tab]'))assert.ok(node.textContent.length<=5);
  h.open();await tick();h.root.click('data-exchange-tab','history');await tick();assert.equal(h.handle.state.tab,'history');assert.match(h.root.child.innerHTML,/data-history-detail="parent"/);assert.equal(h.calls.at(-1).action,'exchange/history');assert.deepEqual(h.calls.at(-1).body,{characterId:'history-a',role:'all'});
  h.handle.update();h.handle.update();assert.equal(h.calls.length,2);h.root.click('data-exchange-refresh');await tick();assert.equal(h.calls.length,3);h.root.child.click('data-history-detail','parent');assert.equal(h.details.length,1);assert.ok(h.calls.every(c=>['exchange/list','exchange/history'].includes(c.action)));
});

test('leaving the history tab aborts its slow child read and keeps the existing listing draft untouched',async()=>{
  const replies=[],book={kind:'item',item:'book_demo',name:'技術書',qty:3,category:'skillbook'};
  const h=setup({parent:true,api:action=>action==='exchange/history'?new Promise(resolve=>replies.push(resolve)):Promise.resolve({items:action==='exchange/sellable'?[book]:[]})});h.open();await tick();h.root.click('data-exchange-tab','create');await tick();h.root.click('data-exchange-pick','item:book_demo');const input=h.root.querySelector('[data-exchange-draft="price"]');input.value='321';input.dispatch('input');
  h.root.click('data-exchange-tab','history');await tick();const historyCall=h.calls.at(-1),oldChild=h.root.child;h.root.click('data-exchange-tab','create');await tick();assert.equal(historyCall.options.signal.aborted,true);assert.equal(h.handle.state.draft.price,'321');assert.equal(h.handle.state.draft.selected,'item:book_demo');assert.equal(h.root.querySelector('[data-exchange-draft="price"]').value,'321');
  replies[0]({characterId:'history-a',items:[entry('late')]});await tick();assert.equal(h.handle.state.tab,'create');assert.equal(oldChild.isConnected,false);assert.equal(h.root.child,null);assert.doesNotMatch(h.root.innerHTML,/data-history-detail="late"/);
});

test('cached history retains actor-specific role/page through tab remount and can refresh new transactions explicitly',async()=>{
  const h=setup({api:(_action,body)=>Promise.resolve({characterId:'history-a',items:[entry(body.role)],nextCursor:'123:45'})});await h.handle.refresh();h.root.click('data-history-role','sell');await tick();h.root.click('data-history-next');await tick();h.remount();assert.equal(h.handle.state.role,'sell');assert.equal(h.handle.state.views.sell.page,1);await h.handle.refresh();assert.equal(h.calls.length,3);await h.handle.refresh(true);assert.equal(h.calls.length,4);assert.equal(h.calls.at(-1).body.role,'sell');assert.equal(h.calls.at(-1).body.cursor,undefined);
});

test('a purchase through the unchanged parent flow invalidates cached history and the next visit reads the new receipt',async()=>{
  let sold=false;const listed={id:'fresh-purchase',kind:'item',item:'scroll_w',name:'武器強化捲',category:'scroll',qty:2,price:101,canBuy:true,seller:{name:'賣家'}};
  const h=setup({parent:true,api:action=>Promise.resolve(action==='exchange/history'?{characterId:'history-a',items:sold?[entry('new-sale')]:[]}:action==='exchange/buy'?(sold=true,{result:{action:'buy',listingId:listed.id}}):{items:[listed]})});
  h.host.confirm=async()=>true;h.host.requestId=()=>crypto.randomUUID();h.open();await tick();h.root.click('data-exchange-tab','history');await tick();assert.match(h.root.child.innerHTML,/尚無成交紀錄/);
  h.root.click('data-exchange-tab','browse');await tick();h.root.click('data-exchange-buy',listed.id);await tick();h.root.click('data-exchange-tab','history');await tick();
  assert.equal(h.calls.filter(call=>call.action==='exchange/history').length,2);assert.equal(h.calls.filter(call=>call.action==='exchange/buy').length,1);assert.match(h.root.child.innerHTML,/data-history-detail="new-sale"/);
});
