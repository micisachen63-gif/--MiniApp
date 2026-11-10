import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { freshDb } from './d1-shim.js';
import { createCharacter } from '../src/services/player.js';
import { view as bossScene } from '../src/services/boss-scene.js';
import { view as bossReceipt } from '../src/services/boss-receipt.js';
import { exchangeScoped } from '../src/services/boss-exchange.js';
import { spawnDue, attackScoped } from '../src/services/boss.js';

const source=fs.readFileSync(new URL('../public/scene-boss-ui.js',import.meta.url),'utf8');
const NOW=Date.parse('2026-11-05T04:00:00Z'),plain=value=>JSON.parse(JSON.stringify(value));
const drain=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const signature=body=>JSON.stringify(body.offer==='legacy'?{offer:body.offer,expectedMaterials:body.expectedMaterials}:{offer:body.offer});
function fixture({char='a',account='u',realm='permanent',revision=1,now=NOW,win=2,bossId='boss-one'}={}){
 const startedAt=now-win*180000-60000;
 return {ok:true,accountId:account,realmId:realm,characterId:char,revision,now,readOnly:false,
  character:{id:char,name:'星海旅人',level:120,hp:120,mp:60,stats:{maxHp:200,maxMp:100}},
  boss:{id:bossId,name:'星辰巨龍',mapName:'星穹',elementName:'星光',hp:9000,maxHp:10000,status:'active',startedAt,endsAt:now+3600000,attackWindowMinutes:3,
   expired:false,settlementPending:false,me:{hits:1,damage:600,window:win,attackedThisWindow:false,nextAttackAt:now,downUntil:null,canAttack:true,reason:null,attacks:[{win:0,damage:600,createdAt:startedAt+1000}]}},
  history:[],essence:{quantity:1000,fragments:30,daily:{accountId:account,used:1,limit:4,remaining:3,resetsAt:Date.parse('2026-11-05T16:00:00Z')}},
  rules:{castsPerAttack:5,downMs:600000,legacyRates:{mat_3:12,mat_4:16}},
  exchange:{canOperate:true,blockedReason:null,offers:[
   {id:'reroll',name:'洗屬性捲 ×5',currency:'boss_essence',currencyName:'首領精華',cost:5,item:'scroll_r',qty:5,canExchange:true,reason:null},
   {id:'relic',name:'本職業隨機部位遺物 ×1',currency:'relic_fragment',currencyName:'遺物碎片',cost:30,item:null,qty:1,canExchange:true,reason:null}],
   legacy:{expectedMaterials:{mat_3:2,mat_4:1},essence:40,canExchange:true,reason:null,materials:[{key:'mat_3',name:'三轉魂晶',quantity:2,essenceEach:12},{key:'mat_4',name:'四轉魂晶',quantity:1,essenceEach:16}]}}};
}
function harness(extra={},options={}){
 let time=NOW,context={accountId:'u',realmId:'permanent',characterId:'a',epoch:0,...options.context};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
 const sandbox={AbortController,console,Date:Clock,...extra};vm.runInNewContext(source,sandbox,{filename:'scene-boss-ui.js'});
 const values=options.values||new Map(),calls=[],changed=[],events=[];
 const host={getContext:()=>({...context}),current:()=>true,storage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},
  onState:s=>events.push({revision:s.revision,busy:s.busy,stale:s.stale}),onChanged:v=>changed.push(plain(v)),
  request:(action,body,options)=>{const d=deferred();calls.push({action,body:plain(body),options,...d});return d.promise;}};
 return {api:sandbox.RpgSceneBoss,host,calls,changed,events,values,create:()=>sandbox.RpgSceneBoss.createClient(host),setContext:c=>{context={...context,...c};},setNow:n=>{time=n;}};
}
async function read(h,c,value=fixture()){
 const pending=c.refresh();assert.equal(h.calls.at(-1).action,'boss/scene');h.calls.at(-1).resolve(value);assert.equal(await pending,true);
}
async function unknown(h,c,kind='attack',offer='reroll'){
 assert.equal(kind==='attack'?c.prepareAttack():c.prepareExchange(offer),true);
 const pending=c.submit();assert.equal(h.calls.at(-1).action,kind==='attack'?'boss/attack-scoped':'boss/exchange-scoped');
 h.calls.at(-1).reject(Error('lost response'));assert.equal(await pending,false);return plain(c.pending());
}
function matchingResult(record){
 if(record.kind==='attack')return {bossId:record.body.bossId,win:record.body.expectedWin,damage:789,createdAt:NOW};
 if(record.body.offer==='relic')return {items:{},equipment:{id:'x0123456789a',name:'星辰遺物',tg_id:'a',grade:'relic',source:'boss_exchange',slot:'helm',tier:8}};
 return {items:{[record.body.offer==='legacy'?'boss_essence':record.expected.item]:record.body.offer==='legacy'?record.expected.total:record.expected.quantity}};
}
function receipt(record,{found=true,result=matchingResult(record),revision=1,...overrides}={}){
 const common={ok:true,now:NOW,accountId:'u',realmId:'permanent',characterId:'a',revision,kind:record.kind,found,recoveryAllowed:false,
  result:found?result:null,receipt:found?{kind:record.kind,createdAt:NOW}:null};
 return record.kind==='attack'?{...common,bossId:record.body.bossId,win:record.body.expectedWin,...overrides}:
  {...common,requestId:record.id,offer:record.body.offer,signature:signature(record.body),...overrides};
}
async function check(h,c,record,value,snapshot=fixture()){
 const pending=c.checkPending(record.id);assert.equal(h.calls.at(-1).action,'boss/scene');h.calls.at(-1).resolve(snapshot);await drain();
 assert.equal(h.calls.at(-1).action,'boss/receipt');h.calls.at(-1).resolve(value);return pending;
}

test('Boss projection is the sole opening/refresh read and frozen realms remain readable with disabled writes',async()=>{
 const h=harness(),c=h.create(),value=fixture();value.readOnly=true;value.readOnlyReason='賽季結算中';await read(h,c,value);
 assert.equal(c.prepareAttack(),false);assert.equal(c.prepareExchange('reroll'),false);assert.match(c.state.error,/賽季結算/);
 assert.deepEqual(h.calls.map(x=>x.action),['boss/scene']);assert.equal(c.pending(),null);c.dispose();
});
test('attack confirms the exact boss/window and actual risk without an invented request ID',async()=>{
 const h=harness(),c=h.create();await read(h,c);assert.equal(c.prepareAttack(),true);
 assert.deepEqual(plain(c.state.confirm.body),{bossId:'boss-one',expectedWin:2});
 assert.match(c.state.confirm.details,/星辰巨龍.*星穹.*5.*魔力.*背包藥水.*反擊.*10/);
 c.cancel();assert.equal(c.state.confirm,null);assert.equal(h.calls.length,1);
 c.prepareAttack();h.setNow(NOW+120001);assert.equal(await c.submit(),false);assert.match(c.state.error,/回合已更新/);assert.equal(h.calls.length,1);c.dispose();
});
test('unknown attacks survive refresh, reopen, full client reload and A/B/A with the original tuple intact',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c);
 assert.deepEqual(record.body,{bossId:'boss-one',expectedWin:2});assert.equal(record.body.requestId,undefined);
 await read(h,c,fixture({revision:2}));assert.equal(c.prepareAttack(),false);c.dispose();
 h.setContext({characterId:'b',epoch:1});const other=h.create();assert.equal(other.pending(),null);other.dispose();
 h.setContext({characterId:'a',epoch:2});const reopened=h.create();assert.deepEqual(plain(reopened.pending().body),record.body);reopened.dispose();
 const reload=harness({}, {values:h.values}),restored=reload.create();assert.deepEqual(plain(restored.pending().body),record.body);
 assert.equal(h.calls.filter(x=>x.action==='boss/attack-scoped').length,1);assert.equal(reload.calls.length,0);restored.dispose();
});
test('a missing original attack stays pending; only an explicitly confirmed newer-window attack is a new operation',async()=>{
 const h=harness(),c=h.create();await read(h,c);const original=await unknown(h,c);
 assert.equal(await check(h,c,original,receipt(original,{found:false,recoveryAllowed:true})),true);
 assert.equal(c.prepareRecovery(original.id),false);assert.equal(c.prepareAttack(),false);assert.ok(c.pending(original.id));
 await read(h,c,fixture({now:NOW+180000,win:3,revision:2}));
 assert.equal(c.prepareAttack(),true);assert.match(c.state.confirm.details,/目前回合的新攻擊/);
 const newAttack=c.submit();assert.deepEqual(h.calls.at(-1).body,{bossId:'boss-one',expectedWin:3});h.calls.at(-1).reject(Error('lost again'));assert.equal(await newAttack,false);
 assert.equal(c.pendingList().length,2);assert.ok(c.pending(original.id));assert.equal(h.calls.filter(x=>x.action==='boss/attack-scoped').length,2);
 assert.equal(await check(h,c,original,receipt(original,{found:false,revision:2}),fixture({now:NOW+180000,win:3,revision:2})),true);
 assert.deepEqual(h.calls.at(-1).body,{kind:'attack',bossId:'boss-one',win:2});c.dispose();
});
test('receipt echo mismatch, missing fields or stale revision cannot resolve an unknown attack',async()=>{
 for(const patch of [{bossId:'other'},{win:3},{characterId:'b'},{accountId:'v'},{realmId:'season'}, {revision:0},{result:{damage:789,createdAt:NOW}},{result:{bossId:'boss-one',win:2,damage:'789',createdAt:NOW}}]){
  const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c);
  assert.equal(await check(h,c,record,receipt(record,patch)),false);assert.ok(c.pending(record.id));assert.equal(c.acknowledge(record.id),false);c.dispose();
 }
});
test('committed attack row requires acknowledgement and remains explicitly partial evidence',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c);
 assert.equal(await check(h,c,record,receipt(record)),true);assert.ok(c.pending(record.id));assert.equal(c.acknowledge(record.id),true);
 assert.equal(c.state.lastResult.complete,false);assert.deepEqual(plain(c.state.lastResult.result),{bossId:'boss-one',win:2,damage:789,createdAt:NOW});assert.equal(c.pending(),null);
 assert.equal(h.calls.filter(x=>x.action==='boss/attack-scoped').length,1);c.dispose();
});
test('an attack response that replays the committed row is accepted without invented full combat details',async()=>{
 const h=harness(),c=h.create();await read(h,c);c.prepareAttack();const pending=c.submit(),record=plain(c.pending());
 h.calls.at(-1).resolve({ok:true,accountId:'u',realmId:'permanent',characterId:'a',revision:2,bossId:'boss-one',win:2,resultEvidence:'attack-row',result:matchingResult(record)});
 await drain();assert.equal(h.calls.at(-1).action,'boss/scene');h.calls.at(-1).reject(Error('refresh failed'));assert.equal(await pending,true);
 assert.equal(c.pending(),null);assert.equal(c.state.lastResult.complete,false);assert.equal(c.state.lastResult.result.counter,undefined);assert.equal(h.changed.length,1);c.dispose();
});
test('full scoped attack success remains acknowledged when its later scene refresh fails',async()=>{
 const h=harness(),c=h.create();await read(h,c);c.prepareAttack();const pending=c.submit();
 h.calls.at(-1).resolve({ok:true,accountId:'u',realmId:'permanent',characterId:'a',revision:2,bossId:'boss-one',win:2,resultEvidence:'response',result:{damage:900,counter:20,crits:1,downed:false}});
 await drain();h.calls.at(-1).reject(Error('offline refresh'));assert.equal(await pending,true);assert.equal(c.pending(),null);assert.equal(c.state.lastResult.complete,true);assert.equal(h.changed.length,1);c.dispose();
});
test('account, realm, character and epoch isolate delayed reads and unknown write replies, including A/B/A',async()=>{
 for(const change of [{accountId:'v',epoch:1},{realmId:'season',epoch:1},{characterId:'b',epoch:1},{epoch:2}]){
  const h=harness(),c=h.create(),loading=c.refresh();h.setContext(change);h.calls[0].resolve(fixture());assert.equal(await loading,false);assert.equal(c.state.data,null);c.dispose();
 }
 const h=harness(),c=h.create();await read(h,c);c.prepareAttack();const writing=c.submit(),record=plain(c.pending());
 h.setContext({characterId:'b',epoch:1});h.setContext({characterId:'a',epoch:2});
 h.calls.at(-1).resolve({ok:true,accountId:'u',realmId:'permanent',characterId:'a',revision:2,bossId:'boss-one',win:2,resultEvidence:'response',result:{damage:1,counter:0,crits:0,downed:false}});
 assert.equal(await writing,false);assert.equal(h.changed.length,0);assert.ok(c.pending(record.id));const fresh=h.create();assert.ok(fresh.pending(record.id));fresh.dispose();c.dispose();
});
test('stale or malformed successful write revisions retain original pending operations',async()=>{
 for(const kind of ['attack','exchange'])for(const revision of [0,undefined,null,'3',3]){
  const h=harness(),c=h.create();await read(h,c,fixture({revision:3}));
  assert.equal(kind==='attack'?c.prepareAttack():c.prepareExchange('reroll'),true);
  const writing=c.submit(),record=plain(c.pending());c.update({accountId:'u',realmId:'permanent',characterId:'a',revision:5});
  const value=kind==='attack'?{ok:true,accountId:'u',realmId:'permanent',characterId:'a',revision,bossId:record.body.bossId,win:record.body.expectedWin,resultEvidence:'response',result:{damage:1,counter:0,crits:0,downed:false}}:{...receipt(record,{revision}),revision};
  h.calls.at(-1).resolve(value);await drain();if(h.calls.at(-1).action==='boss/scene')h.calls.at(-1).resolve(fixture({revision:6}));
  assert.equal(await writing,false);assert.ok(c.pending(record.id));assert.equal(c.state.lastResult,null);assert.equal(h.changed.length,0);c.dispose();
 }
});
test('legacy or corrupt ledger errors preserve the original exchange for pure receipt lookup',async()=>{
 for(const code of ['boss_receipt_legacy','boss_receipt_corrupt']){
  const h=harness(),c=h.create();await read(h,c);assert.equal(c.prepareExchange('reroll'),true);
  const writing=c.submit(),record=plain(c.pending());h.calls.at(-1).reject(Object.assign(Error('需要原收據核對'),{status:409,code}));
  await drain();if(h.calls.at(-1).action==='boss/scene')h.calls.at(-1).resolve(fixture());
  assert.equal(await writing,false);assert.ok(c.pending(record.id));assert.equal(c.prepareExchange('reroll'),false);
  assert.equal(c.prepareRecovery(record.id),false);assert.equal(h.calls.filter(x=>x.action==='boss/exchange-scoped').length,1);c.dispose();
 }
});
test('older refreshes and lower revisions cannot replace current data or keep a stale confirmation live',async()=>{
 const h=harness(),c=h.create();await read(h,c,fixture({revision:3}));c.prepareAttack();
 const old=c.refresh(),newer=c.refresh();h.calls.at(-1).resolve(fixture({revision:4}));assert.equal(await newer,true);h.calls.at(-2).resolve(fixture({revision:3}));
 assert.equal(await old,false);assert.equal(c.state.revision,4);assert.equal(c.state.confirm,null);
 const stale=c.refresh();h.calls.at(-1).resolve(fixture({revision:2}));assert.equal(await stale,false);assert.equal(c.state.revision,4);assert.equal(c.state.stale,true);assert.equal(c.prepareAttack(),false);c.dispose();
});
test('newer scene revisions invalidate in-flight historical receipt recovery until fresh evidence is read',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c);
 const lookup=c.checkPending(record.id);h.calls.at(-1).resolve(fixture());await drain();c.update({accountId:'u',realmId:'permanent',characterId:'a',revision:5});
 h.calls.at(-1).resolve(receipt(record));assert.equal(await lookup,false);assert.equal(c.acknowledge(record.id),false);assert.ok(c.pending(record.id));c.dispose();
});
test('legacy confirmation uses exact canonical source counts and all materials; missing or coerced counts never default to zero',async()=>{
 const h=harness(),c=h.create();await read(h,c);assert.equal(c.prepareExchange('legacy'),true);
 assert.deepEqual(plain(c.state.confirm.body),{offer:'legacy',expectedMaterials:{mat_3:2,mat_4:1}});
 assert.match(c.state.confirm.details,/三轉魂晶 × 2.*12.*24.*四轉魂晶 × 1.*16.*40/);
 c.cancel();
 for(const expectedMaterials of [{mat_3:2},{mat_3:'2',mat_4:1},{mat_3:2,mat_4:null},{mat_3:-1,mat_4:1}]){
  const data=fixture();data.exchange.legacy.expectedMaterials=expectedMaterials;await read(h,c,data);assert.equal(c.prepareExchange('legacy'),false);
 }
 assert.equal(h.calls.filter(x=>x.action.includes('exchange-scoped')).length,0);c.dispose();
});
test('a changed canonical material count cancels an open all-materials confirmation',async()=>{
 const h=harness(),c=h.create();await read(h,c);c.prepareExchange('legacy');const changed=fixture({revision:2});
 changed.exchange.legacy.expectedMaterials.mat_3=3;changed.exchange.legacy.essence=52;await read(h,c,changed);
 assert.equal(c.state.confirm,null);assert.equal(await c.submit(),false);assert.equal(h.calls.length,2);c.dispose();
});
test('exchange missing receipt never sends automatically; explicit recovery retains the original raw ID/body and result contract',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c,'exchange','legacy');
 assert.match(record.id,/^[A-Za-z0-9_-]{8,64}$/);assert.equal(record.id.startsWith('app:'),false);
 assert.equal(await check(h,c,record,receipt(record,{found:false,recoveryAllowed:true})),true);assert.ok(c.pending(record.id));
 assert.equal(h.calls.filter(x=>x.action==='boss/exchange-scoped').length,1);assert.equal(c.prepareRecovery(record.id),true);c.cancel();assert.ok(c.pending(record.id));
 assert.equal(c.prepareRecovery(record.id),true);const retry=c.submit();assert.deepEqual(h.calls.at(-1).body,record.body);
 h.calls.at(-1).resolve({...receipt(record),result:matchingResult(record)});await drain();h.calls.at(-1).resolve(fixture({revision:2}));assert.equal(await retry,true);assert.equal(c.pending(),null);c.dispose();
});
test('partial legacy ledgers, altered signatures and invalid exchange outputs never permit recovery or acknowledgement',async()=>{
 for(const patch of [{found:false,recoveryAllowed:false,unverified:true},{signature:'different'},{result:{items:{boss_essence:41}}},{result:{items:{boss_essence:'40'}}}]){
  const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c,'exchange','legacy');
  await check(h,c,record,receipt(record,patch));assert.equal(c.prepareRecovery(record.id),false);assert.equal(c.acknowledge(record.id),false);assert.ok(c.pending(record.id));c.dispose();
 }
});
test('relic receipts preserve the original random gear; missing equipment never counts as a completed exchange',async()=>{
 const h=harness(),c=h.create();await read(h,c);const record=await unknown(h,c,'exchange','relic');
 assert.equal(await check(h,c,record,receipt(record,{result:{items:{}}})),false);assert.ok(c.pending(record.id));
 assert.equal(await check(h,c,record,receipt(record)),true);assert.equal(c.acknowledge(record.id),true);assert.equal(c.state.lastResult.result.equipment.id,'x0123456789a');
 assert.equal(h.calls.filter(x=>x.action==='boss/exchange-scoped').length,1);c.dispose();
});

class BossRoot{
 constructor(){this.isConnected=true;this.scrollTop=0;this.reveals=0;this.focuses=[];this.controls=[];this.panels=[];this.events=new Map();this.html='';
  this.ownerDocument={body:{kind:'body'},documentElement:{kind:'html'},hidden:false,addEventListener(){},removeEventListener(){}};this.ownerDocument.activeElement=this.ownerDocument.body;}
 contains(node){return node?.root===this&&this.controls.includes(node);}
 addEventListener(kind,fn){this.events.set(kind,fn);}
 removeEventListener(kind){this.events.delete(kind);}
 get innerHTML(){return this.html;}
 set innerHTML(html){
  if(this.contains(this.ownerDocument.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;
  this.html=html;this.controls=[];this.panels=[];
  for(const m of html.matchAll(/<section[^>]*data-sb-pending="([^"]+)"[^>]*>/g)){this.panels.push({id:m[1],start:m.index,end:html.indexOf('</section>',m.index),scrollIntoView:options=>{this.reveals++;this.lastScrollOptions=options;this.scrollTop=0;}});}
  for(const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
   const dataset={};for(const a of m[1].matchAll(/\bdata-([a-z0-9-]+)="([^"]*)"/g))dataset[a[1].replace(/-([a-z])/g,(_,v)=>v.toUpperCase())]=a[2];
   const root=this,panel=this.panels.find(p=>m.index>p.start&&m.index<p.end);
   this.controls.push({root,dataset,disabled:/(?:^|\s)disabled(?:\s|$)/.test(m[1]),setAttribute(){},
    closest(selector){return selector==='[data-sb-action]'?this:selector==='[data-sb-pending]'?panel:null;},
    focus(){if(!this.disabled){root.ownerDocument.activeElement=this;root.focuses.push({...dataset});}}});
  }
 }
 querySelectorAll(selector){if(selector==='button')return this.controls;const action=selector.match(/^\[data-sb-action="([^"]+)"\]$/)?.[1];return action?this.controls.filter(b=>b.dataset.sbAction===action):[];}
 querySelector(selector){if(selector==='[data-sb-confirm]')return this.html.includes('data-sb-confirm')?{scrollIntoView(){}}:null;return this.querySelectorAll(selector)[0]||null;}
 button(action,fields={}){return this.controls.find(b=>b.dataset.sbAction===action&&Object.entries(fields).every(([k,v])=>b.dataset[k]===String(v)));}
 async click(action,fields={}){const target=this.button(action,fields);assert.ok(target,'missing control '+action);if(!target.disabled)target.focus();return this.events.get('click')?.({target});}
}
async function mountHarness(data=fixture(),options={}){
 const frames=new Map(),intervals=new Map();let next=0;
 const h=harness({requestAnimationFrame(fn){const id=++next;frames.set(id,{fn,cancelled:false});return id;},cancelAnimationFrame(id){if(frames.has(id))frames.get(id).cancelled=true;},
  setInterval(fn){const id=++next;intervals.set(id,fn);return id;},clearInterval(id){intervals.delete(id);}},options);
 const root=new BossRoot(),view=h.api.mount(root,h.host);h.calls.at(-1).resolve(data);await drain();
 return {h,root,view,frames,intervals,flush(ignoreCancel=false){const batch=[...frames.values()];frames.clear();for(const f of batch)if(ignoreCancel||!f.cancelled)f.fn();}};
}
async function lostAttack(m){
 await m.root.click('attack');assert.equal(m.root.ownerDocument.activeElement.dataset.sbAction,'cancel');
 const submit=m.root.click('confirm');m.h.calls.at(-1).reject(Error('lost write'));await submit;await drain();return JSON.parse([...m.h.values.values()][0])[0];
}
test('confirmation cancel and Back restore the exact attack/exchange source button without sending a write',async()=>{
 const m=await mountHarness();await m.root.click('attack');assert.equal(m.root.ownerDocument.activeElement.dataset.sbAction,'cancel');
 assert.equal(m.view.handleBack(),true);assert.equal(m.root.ownerDocument.activeElement.dataset.sbAction,'attack');
 await m.root.click('tab',{tab:'exchange'});await m.root.click('exchange',{offer:'reroll'});assert.match(m.root.html,/消耗 5 首領精華/);
 await m.root.click('cancel');assert.equal(m.root.ownerDocument.activeElement.dataset.offer,'reroll');
 assert.equal(m.h.calls.filter(x=>x.action.endsWith('-scoped')).length,0);m.view.dispose();
});
test('unknown focus goes once to the pure lookup; polling and reopen preserve later focus and scroll',async()=>{
 const m=await mountHarness();const record=await lostAttack(m);m.flush();assert.equal(m.root.reveals,1);assert.equal(m.root.ownerDocument.activeElement.dataset.sbAction,'check-pending');
 m.root.scrollTop=480;m.root.button('tab',{tab:'exchange'}).focus();[...m.intervals.values()][0]();m.h.calls.at(-1).resolve(fixture());await drain();m.flush();
 assert.equal(m.root.reveals,1);assert.equal(m.root.scrollTop,480);assert.equal(m.root.ownerDocument.activeElement.dataset.tab,'exchange');
 assert.equal(JSON.parse([...m.h.values.values()][0])[0].revealed,true);m.view.dispose();
 const reopened=await mountHarness(fixture(),{values:m.h.values});reopened.flush();assert.equal(reopened.root.reveals,0);assert.match(reopened.root.html,new RegExp(record.body.bossId));reopened.view.dispose();
});
test('a queued reveal cannot take focus after later user focus, disposal, scope change or detach',async t=>{
 for(const kind of ['focus','dispose','context','detached'])await t.test(kind,async()=>{
  const m=await mountHarness();await lostAttack(m);const outside={kind:'new-user-target'};m.root.ownerDocument.activeElement=outside;
  if(kind==='dispose')m.view.dispose();if(kind==='context')m.h.setContext({characterId:'b',epoch:1});if(kind==='detached')m.root.isConnected=false;
  m.flush(true);assert.equal(m.root.reveals,0);assert.equal(m.root.ownerDocument.activeElement,outside);m.view.dispose();
 });
});
test('all settled statuses, account-wide daily limit and actual committed core quantity render without blocking attacks at the cap',async()=>{
 const value=fixture();value.essence.daily={...value.essence.daily,used:4,remaining:0};
 value.history=['killed','fled','vanished'].map((status,i)=>({id:'old-'+i,name:'舊首領'+i,status,endsAt:NOW-1000,result:{monsterMaterials:[{tgId:'a',item:'core_star',itemName:'星核',qty:3},{tgId:'b',item:'core_other',qty:9}]}}));
 const m=await mountHarness(value);assert.match(m.root.html,/此帳號今日已領精華的擊殺次數/);assert.match(m.root.html,/4 \/ 4/);assert.match(m.root.html,/每日 00:00/);
 assert.equal(m.root.button('attack').disabled,false);assert.match(m.root.html,/仍可攻擊/);assert.match(m.root.html,/首領已逃離/);assert.match(m.root.html,/首領已消散/);
 assert.match(m.root.html,/星核 × 3/);assert.doesNotMatch(m.root.html,/core_other/);m.view.dispose();
});
test('historical attack-row UI never manufactures counter, crit or HP values',async()=>{
 const m=await mountHarness(),record=await lostAttack(m);m.flush();
 const lookup=m.root.click('check-pending',{pendingId:record.id});m.h.calls.at(-1).resolve(fixture());await drain();m.h.calls.at(-1).resolve(receipt(record));await lookup;
 assert.match(m.root.html,/已提交傷害 789/);assert.match(m.root.html,/沒有保存反擊、爆擊或當時血魔明細/);assert.doesNotMatch(m.root.html,/首領反擊 0|爆擊 0 次/);m.view.dispose();
});
test('canonical backend projection and scoped exchange/receipt output drive the UI without aliases or mock-only fields',async()=>{
 const env={DB:freshDb(),REALM_CONTEXT:{id:'permanent',phase:'ACTIVE'}};
 await createCharacter(env,{tgId:'111',name:'首領前端契約',gender:'m',baseClass:'mage'},NOW);
 await env.DB.prepare("UPDATE rpg_characters SET level=90,class_path='B1' WHERE tg_id='111'").run();
 for(const [item,n]of [['boss_essence',1000],['relic_fragment',60],['mat_3',2],['mat_4',1]])await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').bind('111',item,n).run();
 await spawnDue(env,NOW,{force:{tier:1}});
 const h=harness({}, {context:{accountId:'111',characterId:'111'}}),calls=[];let loseExchange=false;
 h.host.request=async(action,body)=>{
  calls.push({action,body:plain(body)});
  if(action==='boss/scene')return bossScene(env,'111',body,NOW);
  if(action==='boss/receipt')return bossReceipt(env,'111',body,NOW,'app');
  if(action==='boss/exchange-scoped'){const value={...await exchangeScoped(env,'111',body,NOW,'app'),...await bossScene(env,'111',{},NOW)};if(loseExchange){loseExchange=false;throw Error('response lost after atomic commit');}return value;}
  if(action==='boss/attack-scoped')return {...await attackScoped(env,'111',body,NOW),...await bossScene(env,'111',{bossId:body.bossId},NOW)};
  throw Error('unexpected action '+action);
 };
 const c=h.create();assert.equal(await c.refresh(),true);assert.equal(c.state.data.essence.quantity,1000);
 assert.equal(c.state.data.exchange.offers.length,7);
 for(const offer of c.state.data.exchange.offers.map(x=>x.id)){assert.equal(c.prepareExchange(offer),true,offer);assert.equal(await c.submit(),true,offer);assert.equal(c.pending(),null);}
 assert.equal(c.prepareExchange('legacy'),true);assert.deepEqual(plain(c.state.confirm.body.expectedMaterials),{mat_3:2,mat_4:1});assert.equal(await c.submit(),true);
 loseExchange=true;assert.equal(c.prepareExchange('reroll'),true);assert.equal(await c.submit(),false);const exchange=plain(c.pending());assert.equal(await c.checkPending(exchange.id),true);
 assert.equal(c.state.receipts[exchange.id].signature,signature(exchange.body));assert.equal(c.acknowledge(exchange.id),true);
 assert.equal(c.prepareAttack(),true);assert.equal(await c.submit(),true);assert.equal(c.state.lastResult.kind,'attack');assert.equal(c.state.lastResult.complete,true);
 assert.ok(!calls.some(x=>x.action==='boss/current'));assert.equal(calls.filter(x=>x.action==='boss/exchange-scoped').length,9);c.dispose();env.DB.sqlite.close();
});
