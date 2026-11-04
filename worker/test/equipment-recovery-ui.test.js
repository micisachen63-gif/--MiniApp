import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/equipment-recovery-ui.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const token='a'.repeat(64);
function module(){const window={};let serial=0;vm.runInNewContext(source,{window,Intl,URL,crypto:{randomUUID:()=> 'test-recovery-'+(++serial)}});return window.RpgEquipmentRecovery;}
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const view=(realmId='permanent',characterId='hero-a')=>({ok:true,enabled:true,realmId,characterId,dust:100,gold:1000,items:[],entries:[],sources:[],archivedCount:0,batchLimit:50});
const preview=(mode='salvage',ids=['gear-a'],extra={})=>({...view(),mode,token,items:ids.map(id=>({id,name:'遠行裝備',enhance:0,sourceName:'旅途裝備',tier:1,rarityName:'一般'})),consumesEquipment:mode!=='reforge',dustGained:3,cost:{dust:mode==='reforge'?10:0,gold:mode==='reforge'?20:0},requiresHighValueConfirmation:false,warning:'確認消耗',...extra});
function harness(request,options={}){
 const api=options.api||module(),saved=options.storage||storage();let context={realmId:'permanent',characterId:'hero-a',epoch:1},changed=0;
 const client=api.createClient({realmId:context.realmId,characterId:context.characterId,getContext:()=>context,storage:saved,request,onChanged:()=>changed++,...options.host});
 return {api,client,saved,context:()=>context,setContext:value=>{context=value;},changed:()=>changed};
}
test('late views and previews cannot affect a different realm or a rapid A-B-A epoch',async()=>{
 const read=deferred(),h=harness(()=>read.promise);const running=h.client.refresh();
 h.setContext({realmId:'season-a',characterId:'hero-a',epoch:2});h.setContext({realmId:'permanent',characterId:'hero-a',epoch:3});
 read.resolve(view());await running;assert.equal(h.client.state.snapshot,null);
 const pending=deferred(),other=harness(()=>pending.promise);const checking=other.client.preview('salvage',['gear-a']);other.client.dispose();pending.resolve(preview());await checking;assert.equal(other.client.state.preview,null);
});
test('a preview never consumes and both acknowledgements are required for high value consumption',async()=>{
 const calls=[],h=harness(async(action,payload)=>{calls.push({action,payload});return action.endsWith('/preview')?preview('archive',['gear-a'],{requiresHighValueConfirmation:true,newEntries:1}):{...view(),result:{mode:'archive',count:1,newEntries:1}};});
 await h.client.preview('archive',['gear-a']);
 await h.client.confirm({acknowledge:false,confirmHighValue:true});await h.client.confirm({acknowledge:true,confirmHighValue:false});
 assert.equal(calls.length,1);assert.equal(h.client.state.pending,null);
 await h.client.confirm({acknowledge:true,confirmHighValue:true});
 assert.equal(calls.length,2);assert.equal(calls[1].action,'equipment-recovery/action');
 assert.equal(calls[1].payload.token,token);assert.equal(calls[1].payload.acknowledge,true);assert.equal(calls[1].payload.confirmHighValue,true);
 assert.equal(h.changed(),1);assert.equal(h.client.state.pending,null);
});
test('lost response survives remount and manual retry uses the exact same approved payload',async()=>{
 const api=module(),saved=storage(),writes=[];let failed=false;
 const request=async(action,payload)=>{if(action==='equipment-recovery')return view();if(action.endsWith('/preview'))return preview();writes.push(plain(payload));if(!failed){failed=true;throw Object.assign(Error('connection lost after commit'),{uncertain:true});}return {...view(),result:{mode:'salvage',count:1,dustGained:3},replayed:true};};
 const first=harness(request,{api,storage:saved});await first.client.preview('salvage',['gear-a']);await first.client.confirm({acknowledge:true});assert.ok(first.client.state.pending);first.client.dispose();
 const second=harness(request,{api,storage:saved});await second.client.refresh();assert.equal(writes.length,1);
 await second.client.preview('archive',['another-item']);assert.equal(second.client.state.preview,null);assert.equal(writes.length,1);
 await second.client.retry();assert.equal(writes.length,2);assert.deepEqual(writes[1],writes[0]);assert.equal(second.client.state.pending,null);assert.equal(saved.values.size,0);
});
test('a reply after disposal cannot clear the pending receipt or notify another actor',async()=>{
 const commit=deferred(),saved=storage(),api=module(),h=harness(async action=>action.endsWith('/preview')?preview():commit.promise,{storage:saved,api});
 await h.client.preview('salvage',['gear-a']);const acting=h.client.confirm({acknowledge:true});const before=plain(h.client.state.pending);
 h.client.dispose();commit.resolve({...view(),result:{mode:'salvage',count:1,dustGained:3}});await acting;
 assert.deepEqual(plain(h.client.state.pending),before);assert.equal(h.changed(),0);
 const resumed=harness(async()=>view(),{api,storage:h.saved});assert.equal(resumed.client.state.pending.payload.requestId,before.payload.requestId);
});
test('blocked browser storage retains a pending request in memory while other realms stay separate',async()=>{
 const api=module(),blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 const request=async action=>{if(action.endsWith('/preview'))return preview();throw Object.assign(Error('network'),{uncertain:true});};
 const first=harness(request,{api,storage:blocked});await first.client.preview('salvage',['gear-a']);await first.client.confirm({acknowledge:true});const id=first.client.state.pending.payload.requestId;first.client.dispose();
 const again=harness(request,{api,storage:blocked});assert.equal(again.client.state.pending.payload.requestId,id);
 const seasonal=api.createClient({characterId:'hero-a',realmId:'season-a',storage:blocked,request});assert.equal(seasonal.state.pending,null);
});
test('definitive rejection clears pending state and refreshes the real inventory before a new preview',async()=>{
 let reads=0;const h=harness(async action=>{if(action.endsWith('/preview'))return preview();if(action.endsWith('/action'))throw Object.assign(Error('equipment changed'),{status:409,code:'equipment_changed',uncertain:false});reads++;return view();});
 await h.client.preview('salvage',['gear-a']);await h.client.confirm({acknowledge:true});
 assert.equal(h.client.state.pending,null);assert.equal(reads,1);assert.match(h.client.state.error,/equipment changed/);
});
test('batch bounds, duplicate IDs and mismatched preview payloads cannot reach a mutation',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return preview('salvage',['wrong-item']);});
 await h.client.preview('salvage',Array.from({length:51},(_,i)=>'gear-'+i));await h.client.preview('reforge',['a','b']);await h.client.preview('archive',['a','a']);assert.equal(calls,0);
 await h.client.preview('salvage',['gear-a']);assert.equal(calls,1);assert.equal(h.client.state.preview,null);await h.client.confirm({acknowledge:true});assert.equal(calls,1);
});
test('wrong-scope mutation responses remain unresolved and never paint foreign inventory',async()=>{
 const h=harness(async action=>action.endsWith('/preview')?preview():{...view('season-a'),result:{mode:'salvage',count:1}});
 await h.client.preview('salvage',['gear-a']);await h.client.confirm({acknowledge:true});assert.ok(h.client.state.pending);assert.equal(h.client.state.result,null);assert.equal(h.changed(),0);
});
test('suggested selection protects legacy needs and high values and never selects duplicate archive identities',()=>{
 const api=module(),items=Array.from({length:65},(_,i)=>({id:'gear-'+i,entryId:'entry-'+i,suggestedSalvage:true,dust:1}));
 items[0].highValue=true;items[1].legacyNeeded=true;items[2].blockedReason='equipped';items[3].dust=0;items[4].suggestedSalvage=false;
 const ids=plain(api.suggestedItems(items,'salvage'));assert.equal(ids.length,50);for(let i=0;i<5;i++)assert.ok(!ids.includes('gear-'+i));
 const archives=plain(api.suggestedItems([{id:'first',entryId:'same'},{id:'duplicate',entryId:'same'},{id:'old',entryId:'old',archived:true},{id:'high',entryId:'high',highValue:true}],'archive'));assert.deepEqual(archives,['first']);
 assert.deepEqual(plain(api.suggestedItems(items,'reforge')),[]);
});
test('preview names are escaped and reforge text never promises stronger stats or consumes the item',()=>{
 const api=module(),html=api.previewHtml(preview('archive',['gear-a'],{requiresHighValueConfirmation:true,items:[{id:'gear-a',name:'<img src=x onerror=alert(1)>',enhance:15,sourceName:'<script>',tier:12,rarityName:'遺物'}]}));
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('data-recovery-high'));assert.ok(html.includes('+15'));
 const reroll=api.previewHtml(preview('reforge',['gear-a'],{consumesEquipment:false,warning:'可能變強或變弱'}));assert.ok(reroll.includes('可能變強或變弱'));assert.ok(reroll.includes('保留此件裝備'));assert.ok(!reroll.includes('確認永久消耗'));
});

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

function recoveryMount({draft={},context={accountId:'account-a',realmId:'permanent',characterId:'hero-a',epoch:1},initialItemId='',saved=storage(),items,override}={}){
 const env=uiEnvironment(source,saved),calls=[],changes=[];let ctx={...context};
 let snapshot={...view(ctx.realmId,ctx.characterId),sources:[{id:'normal',name:'一般',count:0},{id:'elite',name:'菁英',count:0}],description:'典藏保存，精煉回收',items:items||Array.from({length:24},(_,i)=>({id:'gear-'+i,name:'測試裝備 '+i,entryId:'entry-'+i,sourceGroup:'normal',sourceName:'一般',tier:1,rarityName:'一般',enhance:0,dust:2,reforgeCost:{dust:5,gold:10},suggestedSalvage:true}))};
 const host={draft,storage:saved,characterId:ctx.characterId,realmId:ctx.realmId,getContext:()=>ctx,current:()=>true,initialItemId,artUrl:x=>x,onChanged:data=>changes.push(data),
  request:async(action,payload)=>{calls.push({action,payload:payload?plain(payload):null});const custom=override?await override(action,payload):undefined;if(custom!==undefined)return custom;if(action==='equipment-recovery')return plain(snapshot);if(action==='equipment-recovery/preview')return preview(payload.mode,payload.itemIds);if(action==='equipment-recovery/action'){snapshot={...snapshot,items:snapshot.items.filter(item=>!payload.itemIds.includes(item.id))};return {...plain(snapshot),result:{mode:payload.mode,count:payload.itemIds.length,dustGained:2,newEntries:payload.itemIds.length}};}throw Error('Unexpected '+action);}};
 const module=env.window.RpgEquipmentRecovery.mount(env.root,host);
 return {...env,module,calls,changes,host,draft,saved,setContext:value=>{ctx={...ctx,...value};},setSnapshot:value=>{snapshot=value;},snapshot:()=>plain(snapshot)};
}
test('recovery draft restores mode, source, search, page, selected gear and scroll on close or workshop return',async()=>{
 const draft={},h=recoveryMount({draft});await flushUi();
 await h.root.event('[data-recovery-mode="salvage"]','click');
 await h.root.event('[name="recoverySource"]','change',{value:'normal'});
 await h.root.event('[name="recoverySearch"]','input',{value:'測試裝備'});
 await h.root.event('[data-recovery-item="gear-0"]','change',{checked:true});
 await h.root.event('[data-recovery-page="1"]','click');
 await h.root.event('[data-recovery-item="gear-20"]','change',{checked:true});
 await h.root.scroll(91);h.module.dispose();
 assert.deepEqual(plain(draft.recovery.selected),['gear-0','gear-20']);assert.equal(draft.recovery.page,1);
 const reopened=recoveryMount({draft});await flushUi();
 assert.equal(reopened.root.querySelector('[name="recoverySearch"]').value,'測試裝備');
 assert.equal(reopened.root.querySelector('[name="recoverySource"]').value,'normal');
 assert.equal(reopened.root.querySelector('[data-recovery-item="gear-20"]').checked,true);
 assert.equal(reopened.root.scrollTop,91);assert.match(reopened.root.innerHTML,/aria-pressed="true"[^>]*>2 · 重複精煉/);
 assert.equal(reopened.timers.length,1);reopened.module.dispose();assert.equal(reopened.timers[0].cleared,true);
});
test('recovery context scope rejects another account or epoch draft even when route object is reused',async()=>{
 const draft={},h=recoveryMount({draft});await flushUi();await h.root.event('[data-recovery-mode="salvage"]','click');await h.root.event('[name="recoverySearch"]','input',{value:'測試裝備 4'});h.module.dispose();
 const other=recoveryMount({draft,context:{accountId:'account-b',realmId:'permanent',characterId:'hero-a',epoch:2}});await flushUi();
 assert.equal(other.root.querySelector('[name="recoverySearch"]').value,'');assert.equal(draft.recovery.mode,'archive');assert.deepEqual(plain(draft.recovery.selected),[]);
 const before=JSON.stringify(draft);other.setContext({epoch:3});other.module.dispose();assert.equal(JSON.stringify(draft),before);
});
test('recovery initialItemId selects only that legal item and back cancels preview without consumption',async()=>{
 const h=recoveryMount({initialItemId:'gear-20'});await flushUi();
 assert.equal(h.root.querySelector('[name="recoverySearch"]').value,'測試裝備 20');assert.deepEqual(plain(h.draft.recovery.selected),['gear-20']);
 assert.equal(h.calls.filter(x=>x.action.endsWith('/action')).length,0);
 await h.root.event('[data-recovery-preview]','click');assert.match(h.root.innerHTML,/class="recovery-confirm"/);
 assert.equal(h.module.handleBack(),true);assert.doesNotMatch(h.root.innerHTML,/class="recovery-confirm"/);assert.equal(h.module.handleBack(),false);
 assert.deepEqual(plain(h.draft.recovery.selected),['gear-20']);assert.equal(h.calls.filter(x=>x.action.endsWith('/action')).length,0);
 h.module.dispose();
});
test('recovery initial blocked or missing target never silently selects a replacement',async()=>{
 for(const [id,items]of [['locked',[{id:'locked',name:'鎖定裝備',entryId:'locked',blockedReason:'穿戴中',dust:2},{id:'other',name:'可用裝備',entryId:'other',dust:2}]],['missing',[{id:'other',name:'可用裝備',entryId:'other',dust:2}]]]){
  const h=recoveryMount({initialItemId:id,items});await flushUi();assert.deepEqual(plain(h.draft.recovery.selected),[]);assert.equal(h.calls.length,1);assert.match(h.root.innerHTML,id==='locked'?/穿戴中/:/未改選其他裝備/);h.module.dispose();
 }
});
test('recovery refresh and successful action remove obsolete selected items from saved draft',async()=>{
 const h=recoveryMount();await flushUi();await h.root.event('[data-recovery-item="gear-0"]','change',{checked:true});
 const next=h.snapshot();next.items=next.items.filter(item=>item.id!=='gear-0');h.setSnapshot(next);await h.module.refresh();
 assert.deepEqual(plain(h.draft.recovery.selected),[]);
 await h.root.event('[data-recovery-item="gear-1"]','change',{checked:true});await h.root.event('[data-recovery-preview]','click');
 await h.root.event('[data-recovery-ack]','change',{checked:true});await h.root.event('[data-recovery-confirm]','click');
 assert.deepEqual(plain(h.draft.recovery.selected),[]);assert.equal(h.changes.length,1);h.module.dispose();
});
test('recovery back and remount preserve pending exact receipt and do not replay until explicit retry',async()=>{
 const draft={},saved=storage(),writes=[];
 const request=async(action,payload)=>{if(action==='equipment-recovery/action'){writes.push(plain(payload));throw Object.assign(Error('lost response'),{uncertain:true});}};
 const h=recoveryMount({draft,saved,initialItemId:'gear-0',override:request});await flushUi();
 await h.root.event('[data-recovery-preview]','click');await h.root.event('[data-recovery-ack]','change',{checked:true});await h.root.event('[data-recovery-confirm]','click');
 assert.equal(writes.length,1);const receipt=[...saved.values.values()][0];assert.equal(h.module.handleBack(),false);h.module.dispose();
 const again=recoveryMount({draft,saved,initialItemId:'gear-0',override:request});await flushUi();assert.equal(writes.length,1);assert.equal([...saved.values.values()][0],receipt);
 await again.root.event('[data-recovery-retry]','click');assert.equal(writes.length,2);assert.deepEqual(writes[1],writes[0]);again.module.dispose();
});

test('blocked deep links retry once on same-item reentry while successful selection preserves later user choices',async()=>{
 const draft={},items=[
  {id:'gear-4',name:'強化長劍',entryId:'entry-4',sourceGroup:'normal',sourceName:'一般',tier:1,rarityName:'一般',enhance:4,dust:2},
  {id:'gear-5',name:'另一件裝備',entryId:'entry-5',sourceGroup:'normal',sourceName:'一般',tier:1,rarityName:'一般',enhance:0,dust:2}
 ];
 let locked=true;
 const override=action=>action==='equipment-recovery'?{...view(),sources:[{id:'normal',name:'一般',count:0}],description:'典藏保存',items,lockedReason:locked?'星圖出征中，請先返營':null}:undefined;
 const blocked=recoveryMount({draft,initialItemId:'gear-4',override});await flushUi();
 assert.deepEqual(plain(draft.recovery.selected),[]);assert.equal(draft.recovery.initialItemApplied,false);assert.match(blocked.root.innerHTML,/星圖出征中/);
 await blocked.root.event('[name="recoverySearch"]','input',{value:'保留這次搜尋'});
 blocked.timers[0].fn();await flushUi();assert.equal(blocked.root.querySelector('[name="recoverySearch"]').value,'保留這次搜尋');
 locked=false;await blocked.module.refresh();
 assert.equal(blocked.root.querySelector('[name="recoverySearch"]').value,'保留這次搜尋');
 assert.deepEqual(plain(draft.recovery.selected),[],'unlocking during the same mount must not replace the draft');
 assert.doesNotMatch(blocked.root.innerHTML,/星圖出征中/);blocked.module.dispose();

 const entered=recoveryMount({draft,initialItemId:'gear-4',override});await flushUi();
 assert.deepEqual(plain(draft.recovery.selected),['gear-4']);assert.equal(draft.recovery.initialItemApplied,true);
 assert.equal(entered.root.querySelector('[data-recovery-item="gear-4"]').checked,true);
 assert.equal(entered.root.querySelector('[name="recoverySearch"]').value,'強化長劍');
 await entered.root.event('[data-recovery-item="gear-4"]','change',{checked:false});entered.module.dispose();
 const cancelled=recoveryMount({draft,initialItemId:'gear-4',override});await flushUi();
 assert.deepEqual(plain(draft.recovery.selected),[],'a successful preselection that the player cancelled stays cancelled');
 await cancelled.root.event('[name="recoverySearch"]','input',{value:''});
 await cancelled.root.event('[data-recovery-item="gear-5"]','change',{checked:true});cancelled.module.dispose();
 const changed=recoveryMount({draft,initialItemId:'gear-4',override});await flushUi();
 assert.deepEqual(plain(draft.recovery.selected),['gear-5']);assert.equal(changed.root.querySelector('[data-recovery-item="gear-5"]').checked,true);
 for(const mounted of [blocked,entered,cancelled,changed])assert.ok(mounted.calls.every(call=>call.action==='equipment-recovery'),'bringing in equipment never previews or consumes it');
 changed.module.dispose();
});

test('Chinese recovery search keeps its DOM through explicit and timed refresh until composition finishes',async()=>{
 const h=recoveryMount();await flushUi();
 const input=h.root.querySelector('[name="recoverySearch"]');input.focus();
 await h.root.event('[name="recoverySearch"]','compositionstart');
 await h.root.event('[name="recoverySearch"]','input',{value:'ㄊ',event:{isComposing:true}});
 const latest=h.snapshot();latest.items[0].name='同步後裝備';h.setSnapshot(latest);
 await h.module.refresh();assert.equal(h.root.querySelector('[name="recoverySearch"]'),input);assert.equal(h.document.activeElement,input);assert.equal(input.value,'ㄊ');
 h.timers[0].fn();await flushUi();assert.equal(h.root.querySelector('[name="recoverySearch"]'),input);assert.equal(input.value,'ㄊ');
 await h.root.event('[name="recoverySearch"]','compositionend',{value:'同步後'});
 const committed=h.root.querySelector('[name="recoverySearch"]');
 assert.notEqual(committed,input);assert.equal(committed.value,'同步後');assert.equal(h.document.activeElement,committed);
 assert.match(h.root.innerHTML,/同步後裝備/);assert.equal(h.draft.recovery.search,'同步後');
 assert.ok(h.calls.every(call=>call.action==='equipment-recovery'));h.module.dispose();
});
