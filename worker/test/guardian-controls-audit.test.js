// Independent controls regression: execute actual browser modules, no live API/player.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {createCharacter} from '../src/services/player.js';
import {loadPlayer,invDeltaStmt} from '../src/db.js';
import * as Guardian from '../src/services/guardian-sigil.js';
import {specialState} from '../src/game/special.js';
import {beginAssistBattle} from '../src/game/guardian-assist.js';

const read=name=>fs.readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const qualities=['white','green','blue','purple','red','gold','pink','cyan'];
const actions={summon:true,fuse:true,activate:true,unbind:true,trade:true};
const config={schemaVersion:1,configVersion:'audit-controls',status:'approved',enabled:true,qualityOrder:qualities,actions,pools:{normal:{allowedCounts:[1,5,10],singleGoldPrice:850,tenGoldPrice:8500},featured:{allowedCounts:[1,5,10],drawsPerVoucher:5}},scene:{featherArtUrl:'/art/guardian-sigil-20261013/summon-feather.webp'}};
const receipt={operationId:'audit-op',requestId:'audit_request',charId:'hero-a',action:'summon',status:'committed',configVersion:config.configVersion,results:[{id:'audit-card',type:'magic',quality:'purple',bound:false}]};
const state={schemaVersion:1,charId:'hero-a',revision:1,level:15,unlocked:true,balances:{gold:1000,freeNormalDraws:200,voucherCount:0,remainder:0,availableDraws:0},inventory:{items:[]},actions};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function target(){const listeners=new Map();return {addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},emit(name,event={}){event.type??=name;event.target??=this;event.currentTarget??=this;if(name==='pointerup')event.buttons=0;for(const fn of [...listeners.get(name)||[]])fn(event);},listeners};}
function node(tag='div') {
 const api={...target(),tagName:tag.toUpperCase(),dataset:{},children:[],parent:null,properties:new Map(),captures:new Set(),textContent:'',isConnected:true};
 const classes=new Set();api.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)};
 Object.defineProperty(api,'className',{get:()=>[...classes].join(' '),set:value=>{classes.clear();String(value).split(/\s+/).filter(Boolean).forEach(x=>classes.add(x));}});
 api.style={setProperty:(key,value)=>api.properties.set(key,value)};api.setAttribute=(key,value)=>api[key]=String(value);
 api.append=child=>{child.parent=api;api.children.push(child);};api.remove=()=>{if(api.parent)api.parent.children=api.parent.children.filter(x=>x!==api);api.parent=null;api.isConnected=false;};
 api.replaceChildren=()=>{api.children.forEach(x=>x.parent=null);api.children=[];};
 api.matches=selector=>selector==='button'?tag==='button':selector.startsWith('.')?classes.has(selector.slice(1)):selector==='[data-guardian-start-pull]'?Object.hasOwn(api.dataset,'guardianStartPull'):false;
 api.closest=selector=>{for(let at=api;at;at=at.parent)if(at.matches(selector))return at;return null;};
 api.querySelector=selector=>{for(const child of api.children){if(child.matches(selector))return child;const nested=child.querySelector(selector);if(nested)return nested;}return null;};
 api.setPointerCapture=id=>api.captures.add(id);api.releasePointerCapture=id=>api.captures.delete(id);api.hasPointerCapture=id=>api.captures.has(id);
 api.getBoundingClientRect=()=>({left:0,top:0,right:150,bottom:200,width:150,height:200});
 let html='';Object.defineProperty(api,'innerHTML',{get:()=>html,set:value=>{html=String(value);api.replaceChildren();for(const match of html.matchAll(/<button\b([^>]*)>/g)){const child=node('button');for(const attr of match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)){if(attr[1]==='class')child.className=attr[2]||'';if(attr[1].startsWith('data-'))child.dataset[attr[1].slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=attr[2]||'';}api.append(child);}}});
 return api;
}
const pointer=(id,y,extra={})=>({pointerId:id,clientY:y,clientX:45,isPrimary:true,button:0,buttons:1,isTrusted:true,preventDefault(){},...extra});
function gesture({commit=()=>receipt,canStart=()=>true}={}) {
 const window=target(),document={...target(),hidden:false,createElement:node},frames=new Map(),timers=new Map();let serial=0,charges=0;
 window.matchMedia=()=>({matches:false});window.requestAnimationFrame=fn=>{const id=++serial;frames.set(id,fn);return id;};window.cancelAnimationFrame=id=>frames.delete(id);
 const context=vm.createContext({window,document,AbortController,setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 for(const file of ['guardian-sigil-contract.js','guardian-summon-gesture.js','guardian-pull.js'])vm.runInContext(read(file),context);
 const scene=node(),anchor=node();anchor.className='guardian-feather-anchor';scene.append(anchor);const done=[],progresses=[];
 const tree={progress:value=>progresses.push(value),releasedEarly(){},suppressClickAfterDrag(){}};
 const handle=window.RpgGuardianSummonGesture.mount(scene,{config:window.RpgGuardianContract.config(config),tree,canStart,commit:()=>{charges++;return commit();},onFinish:(result,detail)=>done.push({result,detail}),distance:110});
 const step=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());};
 return {window,document,scene,anchor,button:anchor.querySelector('button'),handle,done,progresses,frames,timers,step,charges:()=>charges,C:window.RpgGuardianContract};
}

test('controls: mount, paint frames, resize, visibility and orphan move/up never summon',async()=>{
 const h=gesture();for(let i=0;i<4;i++)h.step();
 h.window.emit('pointermove',pointer(1,400));h.window.emit('pointerup',pointer(1,400));h.window.emit('resize');h.document.emit('visibilitychange');
 h.button.emit('click',{isTrusted:false,detail:0});await tick();assert.equal(h.charges(),0);assert.equal(h.done.length,0);h.handle.cleanup();
});

test('controls: tiny tap and full pointerup without a real drag do not charge',()=>{
 for(const [distance,moved]of [[3,true],[110,false]]){const h=gesture();h.button.emit('pointerdown',pointer(1,0));if(moved)h.window.emit('pointermove',pointer(1,distance));h.window.emit('pointerup',pointer(1,distance));assert.equal(h.charges(),0);assert.equal(h.handle.isInteracting(),false);h.handle.cleanup();}
});

test('controls: half and almost-full pulls stop before billing; complete drag/release commits exactly once',async()=>{
 for(const distance of [56,109]){const h=gesture();h.button.emit('pointerdown',pointer(1,0));h.window.emit('pointermove',pointer(1,distance));h.window.emit('pointerup',pointer(1,distance));assert.equal(h.charges(),0);h.handle.cleanup();}
 let resolve;const h=gesture({commit:()=>new Promise(done=>resolve=done)});h.button.emit('pointerdown',pointer(1,0));h.window.emit('pointermove',pointer(1,110));
 assert.equal(h.charges(),0,'moving alone cannot bill');h.window.emit('pointerup',pointer(1,110));assert.equal(h.charges(),1);
 h.window.emit('pointerup',pointer(1,180));h.window.emit('pointermove',pointer(1,240));h.button.emit('pointerdown',pointer(2,0));h.window.emit('pointermove',pointer(2,130));h.window.emit('pointerup',pointer(2,130));assert.equal(h.charges(),1);
 resolve(receipt);await tick();h.step();h.step();assert.equal(h.done.length,1);assert.equal(h.done[0].result.requestId,receipt.requestId);h.handle.cleanup();
});

test('controls: cancel/resize/hidden/blur/pagehide before release cannot commit even after full movement',()=>{
 for(const signal of ['pointercancel','resize','hidden','blur','pagehide','lostpointercapture']){
  const h=gesture();h.button.emit('pointerdown',pointer(1,0));h.window.emit('pointermove',pointer(1,110));
  if(signal==='hidden'){h.document.hidden=true;h.document.emit('visibilitychange');}else if(signal==='lostpointercapture')h.button.emit(signal,pointer(1,110));else h.window.emit(signal,signal==='pointercancel'?pointer(1,110):{});
  h.window.emit('pointerup',pointer(1,110));assert.equal(h.charges(),0,signal);assert.equal(h.button.captures.size,0);h.handle.cleanup();assert.equal(h.frames.size,0);
 }
});

test('controls: only intentional trusted nonrepeat keyboard activation may bypass physical drag',async()=>{
 for(const event of [{key:'Enter',isTrusted:false},{key:' ',isTrusted:false},{key:'Enter',isTrusted:true,repeat:true},{key:'Escape',isTrusted:true}]){
  const h=gesture();h.button.emit('keydown',{preventDefault(){},...event});await tick();assert.equal(h.charges(),0);h.handle.cleanup();
 }
 const h=gesture();h.handle.activate?.();await tick();assert.equal(h.charges(),0,'programmatic activate without a user event');
 h.button.emit('keydown',{key:'Enter',isTrusted:true,repeat:false,preventDefault(){}});await tick();h.step();h.step();assert.equal(h.charges(),1);h.handle.cleanup();
});

test('controls: secondary, untrusted, NaN and capture-failed gestures cannot bill',()=>{
 for(const event of [pointer(2,0,{isPrimary:false}),pointer(2,0,{button:2}),pointer(2,0,{isTrusted:false}),pointer(2,NaN),pointer(null,0)]){
  const h=gesture();h.button.emit('pointerdown',event);h.window.emit('pointermove',pointer(2,150));h.window.emit('pointerup',pointer(2,150));assert.equal(h.charges(),0);h.handle.cleanup();
 }
 const h=gesture();h.button.setPointerCapture=()=>{throw Error('capture unavailable');};h.button.emit('pointerdown',pointer(1,0));h.window.emit('pointermove',pointer(1,150));h.window.emit('pointerup',pointer(1,150));assert.equal(h.charges(),0);h.handle.cleanup();
});

test('controls: cleanup ignores a late committed response; disabled state cannot start by touch or key',async()=>{
 let resolve;const h=gesture({commit:()=>new Promise(done=>resolve=done)});h.button.emit('pointerdown',pointer(1,0));h.window.emit('pointermove',pointer(1,110));h.window.emit('pointerup',pointer(1,110));assert.equal(h.charges(),1);h.handle.cleanup();resolve(receipt);await tick();h.step();assert.equal(h.done.length,0);assert.equal(h.frames.size,0);
 const blocked=gesture({canStart:()=>false});blocked.button.emit('pointerdown',pointer(1,0));blocked.window.emit('pointermove',pointer(1,110));blocked.window.emit('pointerup',pointer(1,110));blocked.button.emit('keydown',{key:'Enter',isTrusted:true,repeat:false,preventDefault(){}});assert.equal(blocked.charges(),0);blocked.handle.cleanup();
});

test('controls: committed-result pull is presentation only, with no orphan reveal or duplicate callbacks',()=>{
 const h=gesture();h.handle.cleanup();const card=node('button');let revealed=0,unexpectedCharge=0;
 const pull=h.window.RpgGuardianPull.create(card,{operation:receipt,distance:110,onReveal:()=>revealed++,commit:()=>unexpectedCharge++});
 h.window.emit('pointermove',pointer(1,110));h.window.emit('pointerup',pointer(1,110));assert.equal(revealed,0);
 card.emit('pointerdown',pointer(1,0));h.window.emit('pointermove',pointer(1,110));h.window.emit('pointerup',pointer(1,110));h.window.emit('pointerup',pointer(1,110));
 assert.equal(revealed,1);assert.equal(unexpectedCharge,0);pull.cleanup();
});

test('controls: real controller mounting, balance refresh and summon shortcut do not spend before a gesture',async()=>{
 const window={},context=vm.createContext({window,AbortController,console,setTimeout,clearTimeout}),events=new Map();let writes=0;
 for(const file of ['guardian-sigil-contract.js','guardian-sigil.js'])vm.runInContext(read(file),context);
 const root={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],contains:()=>true,addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key)};
 const host={characterId:()=>state.charId,requestId:()=>receipt.requestId,mutate:async()=>{writes++;return {operation:receipt,state};}};
 const controller=window.RpgGuardianSigil.mount(root,{config,state,host,interactive:true,autoLoad:false});await tick();assert.equal(writes,0);
 controller.update({characterId:state.charId,revision:2,balances:{...state.balances,freeNormalDraws:199}});await tick();assert.equal(writes,0);
 const button={dataset:{guardianAction:'summon'},disabled:false,closest:()=>null,hasAttribute:()=>false};
 events.get('click')({isTrusted:false,detail:0,target:{closest:()=>button}});await tick();assert.equal(writes,0,'shortcut only prepares and guides the drag');controller.cleanup();
});

test('controls: reloading a pending background wish never resends or starts it without explicit confirmation',async()=>{
 const window={},context=vm.createContext({window,AbortController,console,setTimeout,clearTimeout});let writes=0,starts=0;
 for(const file of ['guardian-sigil-contract.js','guardian-sigil.js'])vm.runInContext(read(file),context);
 const root={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],contains:()=>true,addEventListener(){},removeEventListener(){}};
 const pending={characterId:state.charId,requestId:'original_auto_request',payload:{pool:'normal',count:1,targetType:'magic',targetRank:4,maxGold:0}};
 const host={characterId:()=>state.charId,requestId:()=>receipt.requestId,mutate:()=>writes++,config:async()=>config,state:async()=>state,loadAutoPending:()=>pending,autoStart:async()=>{starts++;return {job:{id:'original_auto_job',status:'running'}};}};
 const controller=window.RpgGuardianSigil.mount(root,{config,state,host,interactive:true});await tick();await tick();assert.equal(writes,0);assert.equal(starts,0);controller.cleanup();
});

test('controls: assist stop preserves permanent active bonus and remainder; explicit renew resumes without another stone',async()=>{
 const env={DB:freshDb()};await createCharacter(env,{tgId:'791',name:'控制審查',gender:'m',baseClass:'sword'},T0);await env.DB.prepare("UPDATE rpg_characters SET level=20,gold=10000 WHERE tg_id='791'").run();
 await env.DB.prepare("INSERT INTO rpg_guardian_operations VALUES('audit_seed','791','791','audit_seed_request','summon',?,'test','{}','{}',?)").bind('a'.repeat(64),T0).run();
 await Guardian.insertSigil(env.DB,{id:'audit_melee',char_id:'791',type:'melee',quality:4,source_operation_id:'audit_seed',created_at:T0}).run();await invDeltaStmt(env.DB,'791','guardian_summon_stone',2).run();
 await Guardian.assist(env,'791',{mode:'start',itemId:'audit_melee',requestId:'audit_support_start'},T0);
 let p=await loadPlayer(env.DB,'791'),remaining=specialState(p.char).guardianAssist.remainingBattles;assert.equal(p.inv.guardian_summon_stone,1);assert.equal(p.char.guardian.id,'audit_melee');
 await Guardian.assist(env,'791',{mode:'stop',requestId:'audit_support_stop'},T0);p=await loadPlayer(env.DB,'791');assert.equal(p.char.guardian.id,'audit_melee');assert.equal(specialState(p.char).guardianAssist.remainingBattles,remaining);assert.equal(specialState(p.char).guardianSummonEnabled,false);
 await Guardian.assist(env,'791',{mode:'renew',autoRenew:true,requestId:'audit_support_resume'},T0);p=await loadPlayer(env.DB,'791');assert.equal(p.inv.guardian_summon_stone,1);assert.equal(p.char.gold,10000);assert.equal(specialState(p.char).guardianAssist.remainingBattles,remaining);assert.equal(specialState(p.char).guardianSummonEnabled,true);
 await Guardian.activate(env,'791',{itemId:null,requestId:'audit_remove_guardian'},T0);p=await loadPlayer(env.DB,'791');assert.equal(p.char.guardian,null);assert.equal(specialState(p.char).guardianAssist,undefined);
});

test('controls: completed support renews owned stones only with explicit continuation; gold purchase remains separately opted in',()=>{
 const make=autoRenew=>({guardian:{id:'guardian-a'},guardianAssistSettings:{battlesPerStone:1440,stoneGold:3000},gold:6000,special_json:JSON.stringify({guardianSummonEnabled:true,guardianStoneSupply:false,guardianAssist:{itemId:'guardian-a',remainingBattles:0,autoRenew}})});
 let actor=make(false),inventory={guardian_summon_stone:2},used=0,bought=0;
 beginAssistBattle(actor,inventory,()=>{used++;inventory.guardian_summon_stone--;},()=>bought++);assert.equal(used,0);assert.equal(bought,0);assert.equal(actor.guardianAssistActive,false);assert.equal(actor.gold,6000);
 actor=make(true);beginAssistBattle(actor,inventory,()=>{used++;inventory.guardian_summon_stone--;},()=>bought++);assert.equal(used,1);assert.equal(bought,0);assert.equal(actor.guardianAssistActive,true);assert.equal(specialState(actor).guardianAssist.remainingBattles,1439);
 actor=make(true);inventory={guardian_summon_stone:0};beginAssistBattle(actor,inventory,()=>used++,()=>bought++);assert.equal(bought,0);assert.equal(actor.gold,6000);assert.equal(actor.guardianAssistActive,false);
 actor=make(true);const x=specialState(actor);x.guardianStoneSupply=true;actor.special_json=JSON.stringify(x);beginAssistBattle(actor,inventory,()=>{used++;inventory.guardian_summon_stone--;},gold=>{bought++;assert.equal(gold,3000);});assert.equal(bought,1);assert.equal(actor.gold,3000);assert.equal(actor.guardianAssistActive,true);
});

test('controls: continuation cannot start paused support; same-card start resumes without cost and paused switch consumes one stone',async()=>{
 const env={DB:freshDb()};await createCharacter(env,{tgId:'791',name:'續戰審查',gender:'m',baseClass:'sword'},T0);await env.DB.prepare("UPDATE rpg_characters SET level=20,gold=10000 WHERE tg_id='791'").run();
 await env.DB.prepare("INSERT INTO rpg_guardian_operations VALUES('audit_resume_seed','791','791','audit_resume_seed_req','summon',?,'test','{}','{}',?)").bind('b'.repeat(64),T0).run();
 for(const id of ['audit_a','audit_b'])await Guardian.insertSigil(env.DB,{id,char_id:'791',type:'melee',quality:4,source_operation_id:'audit_resume_seed',created_at:T0}).run();await invDeltaStmt(env.DB,'791','guardian_summon_stone',3).run();
 const call=(mode,body={})=>Guardian.assist(env,'791',{mode,...body,requestId:'audit_controls_'+crypto.randomUUID().replaceAll('-','')},T0);
 await call('start',{itemId:'audit_a'});await call('stop');let p=await loadPlayer(env.DB,'791'),left=specialState(p.char).guardianAssist.remainingBattles;
 await call('continuation',{autoRenew:true});p=await loadPlayer(env.DB,'791');assert.equal(specialState(p.char).guardianSummonEnabled,false);assert.equal(specialState(p.char).guardianAssist.autoRenew,true);assert.equal(p.inv.guardian_summon_stone,2);assert.equal(p.char.gold,10000);
 const resumed=await call('start',{itemId:'audit_a',autoRenew:true});p=await loadPlayer(env.DB,'791');assert.equal(p.inv.guardian_summon_stone,2);assert.equal(p.char.gold,10000);assert.equal(specialState(p.char).guardianAssist.remainingBattles,left);assert.equal(specialState(p.char).guardianSummonEnabled,true);assert.equal(resumed.operation.consumed.stones||0,0);
 await assert.rejects(call('start',{itemId:'audit_b'}),e=>e.code==='assist_active');await call('stop');const switched=await call('start',{itemId:'audit_b'});p=await loadPlayer(env.DB,'791');assert.equal(switched.operation.consumed.stones,1);assert.equal(p.inv.guardian_summon_stone,1);assert.equal(p.char.gold,10000);assert.equal(p.char.guardian.id,'audit_b');assert.equal(specialState(p.char).guardianAssist.remainingBattles,1440);
});
