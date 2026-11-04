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
