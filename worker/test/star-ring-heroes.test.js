import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../public/star-ring-heroes.js',import.meta.url),'utf8');
function setup({reduced=false}={}){const timers=new Map(),listeners=new Map(),doc={hidden:false,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};let n=0;const context=vm.createContext({document:doc,matchMedia:()=>({matches:reduced,addEventListener(){},removeEventListener(){}}),setTimeout:f=>{const id=++n;timers.set(id,f);return id;},clearTimeout:id=>timers.delete(id)});vm.runInContext(code,context);const members=Array.from({length:5},(_,i)=>({id:String(i),name:'旅人'+i,base:i===3?'thief':'sword',hp:80,maxHp:100})),holders=members.map(m=>({dataset:{memberId:m.id},querySelector:()=>({id:m.id,isConnected:true})})),enemy={id:'enemy'},scene={isConnected:true,dataset:{},querySelectorAll:()=>holders,querySelector:()=>enemy};const party={id:'ring:test',members,battle:{stageIndex:0,sequence:1,members,enemy:{hp:20},events:[...members.map(m=>({actorId:m.id,skillId:'attack',damage:10})),{actorId:'boss',label:'反擊',damage:5}]}};return {ui:context.RpgStarRingHeroes,timers,listeners,doc,scene,party,enemy};}
const flush=()=>new Promise(r=>setImmediate(r));
test('real actions warm and animate one member at a time, with a 700 ms interval and correct enemy target',async()=>{const s=setup(),warm=[],starts=[],stops=[];const api={preparePartyArt:async(m,e)=>warm.push([m.length,m[0].id,e.length]),startRegistryAction:(scene,a,t,m,e,opts)=>{starts.push({id:m.id,target:t,duration:opts.duration,containedActor:opts.containedActor,effectScale:opts.effectScale,effectOpacity:opts.effectOpacity});return {stop:()=>stops.push(m.id)};}};const end=s.ui.mount(s.scene,s.party,{playback:api});await flush();assert.equal(warm.length,1);assert.deepEqual(warm[0],[1,'0',1]);assert.equal(starts.length,1);assert.equal(starts[0].target,s.enemy);assert.equal(starts[0].duration,650);assert.equal(starts[0].containedActor,true);assert.equal(starts[0].effectScale,.45);assert.equal(starts[0].effectOpacity,.8);assert.equal(s.scene.dataset.registryCombat,'ready');const timer=s.timers.values().next().value;timer();await flush();assert.equal(starts.length,2);assert.equal(starts[1].id,'1');end();assert.equal(s.listeners.size,0);assert.ok(stops.includes('1'));});
test('a repeated refresh replays only presentation and cannot duplicate a confirmed damage event',async()=>{const s=setup(),started=[],api={preparePartyArt:async()=>[],startRegistryAction:(_s,_a,_t,m,e)=>{started.push({id:m.id,event:e});return {stop(){}};}};const saved=JSON.stringify(s.party),first=s.ui.mount(s.scene,s.party,{playback:api});await flush();first();const second=s.ui.mount(s.scene,s.party,{playback:api});await flush();assert.equal(started.map(x=>x.id).join(','),'0,0');assert.equal(started[0].event.damage,10);assert.equal(started[1].event.damage,0);assert.equal(started[1].event.presentationOnly,true);assert.equal(JSON.stringify(s.party),saved);second();});
test('hidden, reduced motion, downed and departed characters never run registry attacks',async()=>{const s=setup();s.party.members[0].hp=0;s.party.members[1].left=true;const valid=s.ui.eligibleEvents(s.party);assert.equal(valid.map(x=>x.member.id).join(','),'2,3,4');let starts=0;const api={preparePartyArt:async()=>[],startRegistryAction:()=>{starts++;return {stop(){}};}};s.doc.hidden=true;const end=s.ui.mount(s.scene,s.party,{playback:api});await flush();assert.equal(starts,0);end();const r=setup({reduced:true}),stop=r.ui.mount(r.scene,r.party,{playback:api});await flush();assert.equal(starts,0);stop();});
test('unmount during preparation blocks stale animations; missing art keeps real stills without errors',async()=>{const s=setup();let resolve,starts=0;const end=s.ui.mount(s.scene,s.party,{playback:{preparePartyArt:()=>new Promise(r=>resolve=r),startRegistryAction:()=>{starts++;return {stop(){}};}}});await flush();end();resolve([]);await flush();assert.equal(starts,0);assert.equal(s.scene.dataset.registryCombat,undefined);const broken=setup(),stop=broken.ui.mount(broken.scene,broken.party,{playback:{preparePartyArt:async()=>{throw Error('missing atlas');},startRegistryAction:()=>{starts++;}}});await flush();assert.equal(starts,0);assert.equal(broken.scene.dataset.registryCombat,undefined);stop();});
test('healing and guarding actual events target the acting hero; boss-only events add no player animation',async()=>{const s=setup(),targets=[];s.party.battle.events=[{actorId:'0',skillId:'role_aid',healed:20},{actorId:'boss',damage:12}];const stop=s.ui.mount(s.scene,s.party,{playback:{preparePartyArt:async()=>[],startRegistryAction:(_s,a,t)=>{targets.push([a.id,t.id]);return {stop(){}};}}});await flush();assert.deepEqual(targets,[['0','0']]);stop();});

test('completed and ended reports never replay their last active hero attacks',()=>{for(const status of ['complete','ended']){const s=setup();s.party.status=status;assert.equal(s.ui.eligibleEvents(s.party).length,0);}});

test('the five-person action cycle continues between server beats without changing snapshots or damage totals',async()=>{const s=setup(),events=[],saved=JSON.stringify(s.party),stop=s.ui.mount(s.scene,s.party,{playback:{preparePartyArt:async()=>[],startRegistryAction:(_s,_a,_t,m,e)=>{events.push({id:m.id,event:e});return {stop(){}};}}});await flush();for(let i=0;i<6;i++){const [id,callback]=s.timers.entries().next().value;s.timers.delete(id);callback();await flush();}assert.equal(events.map(e=>e.id).join(','),'0,1,2,3,4,0');assert.equal(events[5].event.presentationOnly,true);assert.equal(events[5].event.damage,0);assert.equal(JSON.stringify(s.party),saved);stop();assert.equal(s.timers.size,0);});

test('first pending beat displays poses only, and a hidden battle resumes when visible',async()=>{const s=setup();s.party.status='running';s.party.battle.events=[];const events=s.ui.eligibleEvents(s.party);assert.equal(events.length,5);assert.ok(events.every(x=>x.event.presentationOnly&&x.event.damage==null));let starts=0;const stop=s.ui.mount(s.scene,s.party,{playback:{preparePartyArt:async()=>[],startRegistryAction:()=>{starts++;return {stop(){}};}}});await flush();s.doc.hidden=true;s.listeners.get('visibilitychange')();await flush();const before=starts;s.doc.hidden=false;s.listeners.get('visibilitychange')();await flush();assert.equal(starts,before+1);stop();});

test('hourly system-only arrival keeps living party poses moving without damage and respects death and terminal status',()=>{const s=setup();s.party.status='running';s.party.battle.events=[{actorId:'system',label:'隊伍抵達銀針幽庭'}];s.party.members[0].hp=0;s.party.members[1].left=true;const saved=JSON.stringify(s.party),q=s.ui.eligibleEvents(s.party);assert.equal(q.map(x=>x.member.id).join(','),'2,3,4');assert.ok(q.every(x=>x.event.presentationOnly&&x.event.damage==null));assert.equal(JSON.stringify(s.party),saved);s.party.status='complete';assert.equal(s.ui.eligibleEvents(s.party).length,0);s.party.status='running';s.party.battle.enemy.hp=0;assert.equal(s.ui.eligibleEvents(s.party).length,0);});

test('star ring sends an explicit projection once at release, while repeated cosmetic cycles contain no VFX',async()=>{
 const s=setup(),plays=[],starts=[];let destroyed=0,clears=0;
 s.party.battle.enemy.id='actual-enemy';s.party.battle.events=[{actorId:'0',skillId:'attack',damage:10,vfx:{schemaVersion:1,source:'deterministic-projection',eventId:'ring:beat:0',skillId:'native:sword:base',kind:'cast',actorId:'0',atMs:1000,targetKind:'enemy',targetIds:['actual-enemy'],presentationMode:'full'}}];
 const layer={prepare:async()=>{},timing:()=>({remainingMs:560,impactDelayMs:180}),play:async(raw,geometry)=>{plays.push({raw,geometry});return {accepted:true};},clear:()=>clears++,destroy:()=>destroyed++};
 const legacyModule={createLegacyVfxLayer:async(_scene,opts)=>{assert.equal(opts.allowProjection,true);assert.equal(opts.mode,'star-ring');return layer;},legacyDescriptors:event=>event.cosmetic||event.presentationOnly?[]:[event.vfx,...(event.vfxEvents||[])].filter(Boolean),legacyDomGeometry:(_scene,actor,targets,options)=>({actorId:options.actorId,targets:targets.map(t=>t.id),from:options.from})};
 const api={preparePartyArt:async()=>[],startRegistryAction:(_scene,_actor,_target,_member,event,opts)=>{starts.push({event,opts});return {draw(){},geometry:()=>({from:{x:31,y:42},foot:{x:31,y:80},bodyHeight:70}),stop(){}};}};
 const stop=s.ui.mount(s.scene,s.party,{playback:api,legacyModule});await flush();
 assert.equal(plays.length,0,'wait for the real native release');assert.equal(starts[0].opts.effectScale,0);
 const tick=async()=>{const [id,fn]=s.timers.entries().next().value;s.timers.delete(id);fn();await flush();};
 await tick();assert.equal(plays.length,1);assert.equal(plays[0].raw.source,'deterministic-projection');
 assert.ok(plays[0].geometry.targets.includes('actual-enemy'));assert.equal(plays[0].geometry.from.x,31);
 assert.equal(s.scene.dataset.visualMode,'projection');
 await tick();await tick();assert.equal(starts.length,2);assert.equal(starts[1].event.presentationOnly,true);
 assert.equal(starts[1].event.vfx,undefined);assert.equal(starts[1].event.vfxEvents.length,0);assert.equal(plays.length,1);
 stop();assert.equal(destroyed,1);assert.ok(clears>0);assert.equal(s.timers.size,0);
});

test('periodic system receipts and boss reflection use the exact effect owner once without native cast animation',async()=>{
 const s=setup(),plays=[],prepared=[];let starts=0;
 const pulse={schemaVersion:1,source:'deterministic-projection',eventId:'ring:periodic:0',skillId:'special:skill_18_1',kind:'effect',actorId:'0',atMs:1000,targetKind:'enemy',targetIds:['actual-enemy'],presentationMode:'impact'};
 const reflected={...pulse,eventId:'ring:reflection:1',actorId:'1',skillId:'special:skill_02_3'};
 s.party.battle.enemy.id='actual-enemy';s.party.battle.events=[{actorId:null,label:'召喚／持續傷害',damage:10,vfxEvents:[pulse]},{actorId:'boss',label:'首領攻擊',vfxEvents:[reflected]}];
 s.party.members[0].hp=0; // A true residual hit still belongs to its now-downed owner.
 const layer={prepare:async rows=>prepared.push(...rows),play:async(raw,geometry)=>{plays.push({raw,geometry});return {accepted:true,remainingMs:650};},clear(){},destroy(){}};
 const legacyModule={createLegacyVfxLayer:async()=>layer,legacyDescriptors:event=>[event.vfx,...(event.vfxEvents||[])].filter(Boolean),legacyDomGeometry:(_scene,actor,targets,options)=>({actorId:options.actorId,targets:targets.map(t=>t.id)})};
 const playback={preparePartyArt:async()=>[],startRegistryAction:()=>{starts++;return {stop(){}};}};
 const queue=s.ui.eligibleEvents(s.party);assert.equal(queue.length,2);assert.ok(queue.every(row=>row.effectOnly));
 const saved=JSON.stringify(s.party),stop=s.ui.mount(s.scene,s.party,{playback,legacyModule});await flush();
 assert.equal(plays.length,1);assert.equal(plays[0].geometry.actorId,'0');assert.equal(starts,0);
 const tick=async()=>{const pair=s.timers.entries().next().value;if(!pair)return;const [id,fn]=pair;s.timers.delete(id);fn();await flush();};
 await tick();assert.equal(plays.length,2);assert.equal(plays[1].geometry.actorId,'1');
 await tick();await tick();assert.equal(plays.length,2);assert.equal(starts,0);assert.equal(s.timers.size,0);
 assert.equal(prepared.length,2);assert.equal(s.scene.dataset.effectReceipts,'2');assert.equal(JSON.stringify(s.party),saved);
 stop();
});
test('system damage labels without explicit effect descriptors never create a periodic identity',()=>{
 const s=setup();s.party.battle.events=[{actorId:null,label:'召喚／持續傷害',damage:100},{actorId:'boss',damage:20}];
 assert.equal(s.ui.eligibleEvents(s.party).length,0);
});

test('a true cast before same-beat death replays once but never animates its downed actor cosmetically',async()=>{
 const s=setup(),plays=[];let starts=0;
 s.party.members[0].hp=0;s.party.battle.enemy.id='actual-enemy';
 const raw={schemaVersion:1,source:'deterministic-projection',eventId:'ring:cast-before-death',skillId:'native:sword:base',kind:'cast',actorId:'0',atMs:1000,targetKind:'enemy',targetIds:['actual-enemy'],presentationMode:'full'};
 s.party.battle.events=[{actorId:'0',skillId:'attack',damage:10,vfx:raw}];
 const layer={prepare:async()=>{},timing:()=>({remainingMs:100,impactDelayMs:40}),play:async descriptor=>{plays.push(descriptor);return {accepted:true,remainingMs:100};},clear(){},destroy(){}};
 const legacyModule={createLegacyVfxLayer:async()=>layer,legacyDescriptors:event=>event.presentationOnly?[]:[event.vfx].filter(Boolean),legacyDomGeometry:(_s,_a,_t,opts)=>({actorId:opts.actorId})};
 const playback={preparePartyArt:async()=>[],startRegistryAction:()=>{starts++;return {stop(){},draw(){}};}};
 assert.equal(s.ui.eligibleEvents(s.party).length,1);
 const stop=s.ui.mount(s.scene,s.party,{playback,legacyModule});await flush();assert.equal(starts,1);assert.equal(plays.length,0);
 const tick=async()=>{const pair=s.timers.entries().next().value;if(!pair)return;const [id,fn]=pair;s.timers.delete(id);fn();await flush();};
 await tick();assert.equal(plays.length,1);assert.equal(plays[0],raw);
 await tick();await tick();assert.equal(starts,1);assert.equal(plays.length,1);assert.equal(s.timers.size,0);
 assert.equal(s.party.members[0].hp,0);stop();
});
test('an invalid descriptor cannot revive a downed actor presentation',async()=>{
 const s=setup();s.party.members[0].hp=0;s.party.battle.events=[{actorId:'0',skillId:'attack',vfx:{actorId:'0',kind:'cast'}}];
 let starts=0,plays=0;
 const layer={prepare:async()=>{},timing:()=>null,play:async()=>{plays++;},clear(){},destroy(){}};
 const legacyModule={createLegacyVfxLayer:async()=>layer,legacyDescriptors:event=>[event.vfx],legacyDomGeometry:()=>null};
 const stop=s.ui.mount(s.scene,s.party,{playback:{preparePartyArt:async()=>[],startRegistryAction:()=>{starts++;}},legacyModule});
 await flush();assert.equal(starts,0);assert.equal(plays,0);assert.equal(s.timers.size,0);stop();
});
