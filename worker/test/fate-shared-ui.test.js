import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createSharedUI,sharedEventState} from '../public/fate/shared-ui.js';
import {addActive} from '../public/fate/life.js';
class Node{
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.className='';this.attributes={};this.disabled=false;this._text='';}
 set textContent(v){this._text=v;this.children=[];}get textContent(){return this._text+this.children.map(e=>e.textContent).join('');}
 append(...e){this.children.push(...e);}prepend(...e){this.children.unshift(...e);}setAttribute(k,v){this.attributes[k]=v;}
 matches(s){return s.startsWith('[')?s.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()) in this.dataset:s.startsWith('.')?this.className.split(' ').includes(s.slice(1)):this.tagName===s;}
 querySelectorAll(s){return this.children.flatMap(e=>[...(e.matches(s)?[e]:[]),...e.querySelectorAll(s)]);}querySelector(s){return this.querySelectorAll(s)[0]||null;}
}
const time=Date.parse('2026-10-16T10:40:00+08:00'),prefs={enabled:false,allowMentions:false,quietToday:false};
const event={id:'opaque',side:'guest',characterMatches:true,ownerName:'白色毛衣',guestName:'<img onerror=alert(1)>',title:'遠行的船票',text:'這一次，你會如何回應？',choices:['留下守園','出發寄種子'],status:'pending',opensAt:time,deadline:time+600000,canReply:true,canWithdraw:false,answer:null};
function fixture(events=[event],fail=false){let current=time,count=0,changes=0;const calls=[],client={request:async(action,body,id)=>{calls.push({action,body,id});if(action==='fate/social/inbox')return {ok:true,events,preferences:prefs,now:current};if(fail&&count++===0)throw Error('timeout');return {ok:true};}};const ui=createSharedUI({client,now:()=>current,document:{createElement:t=>new Node(t)},uuid:()=>`request-${count}`,onChange:()=>changes++});const draw=()=>{const panel=new Node('section');ui.render(panel);return panel;};return {ui,calls,draw,setTime:t=>current=t,get changes(){return changes;}};}
test('cooperative reply remains exclusive to the designated character, closes at deadline and pauses overnight',()=>{
 assert.equal(sharedEventState(event,time).canReply,true);
 assert.equal(sharedEventState({...event,side:'owner'},time).canReply,false);
 assert.equal(sharedEventState({...event,characterMatches:false},time).canReply,false);
 assert.equal(sharedEventState(event,event.deadline).canReply,false);
 const late=Date.parse('2026-10-16T23:55:00+08:00'),overnight={...event,deadline:addActive(late,600000)};
 assert.equal(sharedEventState(overnight,Date.parse('2026-10-17T01:00:00+08:00')).canReply,false);
 assert.equal(sharedEventState(overnight,Date.parse('2026-10-17T06:01:00+08:00')).canReply,true);
});
test('guest sees two safe-text choices, owner sees waiting state and another character receives switch instruction',async()=>{
 for(const e of [event,{...event,side:'owner',canWithdraw:true},{...event,characterMatches:false}]){const t=fixture([e]);await t.ui.sync();const panel=t.draw();assert.equal(panel.querySelectorAll('[data-shared-answer]').length,e.side==='guest'&&e.characterMatches?2:0);assert.ok(panel.textContent.includes(e.guestName));if(!e.characterMatches)assert.match(panel.textContent,/切換至該角色/);if(e.side==='owner')assert.match(panel.textContent,/決定自己的回應/);assert.equal(panel.querySelectorAll('img').length,0);}
});
test('failed reply retries the identical mutation UUID, successful action refreshes inbox and terminal card cannot answer',async()=>{
 const t=fixture([event],true);await t.ui.sync();await t.draw().querySelector('[data-shared-answer]').onclick();await t.draw().querySelector('[data-shared-answer]').onclick();
 const mutations=t.calls.filter(c=>c.action==='fate/social/reply');assert.equal(mutations.length,2);assert.deepEqual(mutations[0],mutations[1]);assert.equal(mutations[0].body.answer,0);assert.equal(t.calls.filter(c=>c.action==='fate/social/inbox').length,2);
 const done=fixture([{...event,status:'auto',canReply:false}]);await done.ui.sync();const panel=done.draw();assert.equal(panel.querySelectorAll('[data-shared-answer]').length,0);assert.match(panel.textContent,/命運已替這段相逢續寫/);
});
test('participation starts disabled, requires an explicit per-life checkbox, and reset does not silently authorize next life',async()=>{
 const t=fixture([]);assert.equal(t.ui.invite,false);const box=new Node('section');t.ui.renderInvite(box);const input=box.querySelector('input');assert.equal(input.checked,false);input.checked=true;input.onchange();assert.equal(t.ui.invite,true);t.ui.resetInvite();assert.equal(t.ui.invite,false);
 await t.ui.sync();const settings=t.draw().querySelector('.fate-shared-settings'),enable=settings.querySelector('input');assert.equal(enable.checked,false);enable.checked=true;await enable.onchange();const save=t.calls.find(c=>c.action==='fate/social/preferences/save');assert.equal(save.body.consent,true);assert.equal(save.body.allowMentions,true);
});
test('quiet today is available without global guest consent and does not accidentally enable invitations',async()=>{
 const t=fixture([]);await t.ui.sync();const quiet=t.draw().querySelectorAll('button').find(b=>b.textContent==='今天先讓星燈休息');assert.ok(quiet);await quiet.onclick();const save=t.calls.find(c=>c.action==='fate/social/preferences/save');assert.equal(save.body.quietToday,true);assert.equal(save.body.enabled,false);assert.equal(save.body.allowMentions,false);
});
test('Telegram startapp, private start, query and hash Fate links open the notification view',()=>{
 const source=readFileSync(new URL('../public/fate-entry.js',import.meta.url),'utf8'),line=source.split('\n').find(l=>l.includes('const entryParams='));
 for(const entry of [{start:'fate'},{start:'rpgfate'},{search:'?screen=fate'},{search:'?tgWebAppStartParam=fate'},{hash:'#fate'},{search:'?fateEvent=1'}]){const result=vm.runInNewContext(line+';({autoOpen,startParam})',{window:{Telegram:{WebApp:{initDataUnsafe:{start_param:entry.start}}}},location:{search:entry.search||'',hash:entry.hash||''},URLSearchParams,Map,Set});assert.equal(result.autoOpen,true,JSON.stringify(entry));}
 assert.match(source,/params\.set\('notification','1'\)/);
});
test('notification bootstrap waits for hero selection and opens Fate exactly once despite home rerenders',()=>{
 const source=readFileSync(new URL('../public/fate-entry.js',import.meta.url),'utf8'),start=source.indexOf(' window.RpgInterface.compose='),end=source.indexOf('\n };',start)+4,queued=[],opened=[];let role=null;
 const window={RpgInterface:{},RpgFateHost:{characterId:()=>role}},context={window,document:{createElement:t=>new Node(t)},original(){},state:()=>new Promise(()=>{}),wrongCharacter:()=>false,valid:()=>false,incoming:null,autoOpen:true,seen:new Set(),queueMicrotask:fn=>queued.push(fn),open:code=>opened.push(code)};
 vm.runInNewContext(source.slice(start,end),context);const view=new Node('section');window.RpgInterface.compose(view,{tab:'select'});window.RpgInterface.compose(view,{tab:'home'});assert.equal(queued.length,0);
 role='hero-1';window.RpgInterface.compose(view,{tab:'home'});window.RpgInterface.compose(view,{tab:'home'});assert.equal(queued.length,1);queued[0]();assert.equal(opened.length,1);
});
test('notification prioritizes an actionable guest reply over personal choices, then falls back to question or history',()=>{
 const source=readFileSync(new URL('../public/fate/app.js',import.meta.url),'utf8'),line=source.split('\n').find(l=>l.includes("if(initial&&qs.get('notification')==='1')requestAnimationFrame"));
 const order=['[data-shared-answer]:not(:disabled)','.fate-live-question','.fate-shared-event','.fate-last-choice','.fate-panel'];
 for(let first=0;first<order.length;first++){const focused=[],lookups=[],present=new Map(order.slice(first).map(selector=>{const target={scrollIntoView:options=>focused.push({selector,options})};return [selector,{...target,closest:()=>target}];}));
  vm.runInNewContext(line,{initial:true,qs:new URLSearchParams('?notification=1'),requestAnimationFrame:fn=>fn(),document:{querySelector:selector=>{lookups.push(selector);return present.get(selector)||null;}}});
  assert.equal(focused.length,1);assert.equal(focused[0].selector,order[first]);assert.deepEqual(lookups,order.slice(0,first+1));assert.equal(focused[0].options.block,'start');
 }
});

test('simultaneous initial inbox requests await the same delayed result before notification positioning',async()=>{
 let release,calls=0,changes=0;const response=new Promise(r=>release=r),ui=createSharedUI({client:{request:()=>{calls++;return response;}},document:{createElement:t=>new Node(t)},now:()=>time,onChange:()=>changes++});
 const first=ui.sync(),second=ui.sync();assert.equal(first,second);assert.equal(calls,1);assert.equal(changes,0);
 release({ok:true,events:[event],preferences:prefs,now:time});await second;const panel=new Node('section');ui.render(panel);assert.equal(panel.querySelectorAll('[data-shared-answer]').length,2);assert.equal(changes,1);
 const source=readFileSync(new URL('../public/fate/app.js',import.meta.url),'utf8');assert.ok(source.indexOf('if(initial)await sharedUI?.sync()')<source.indexOf("if(initial&&qs.get('notification')==='1')requestAnimationFrame"));
});

test('both participant views render the saved shared ending and stop promising a future continuation',async()=>{
 for(const side of ['owner','guest']){const t=fixture([{...event,side,status:'answered',answer:1,canReply:false,outcome:'你們一起種下遠方帶回來的花。'}]);await t.ui.sync();const p=t.draw();assert.match(p.textContent,/你們一起種下遠方帶回來的花/);assert.match(p.textContent,/已收進你們各自的相逢紀錄/);assert.doesNotMatch(p.textContent,/故事會在約定時刻接續/);assert.equal(p.querySelectorAll('[data-shared-answer]').length,0);}
});

test('a newly arrived shared outcome requests one life refresh, unchanged inboxes do not loop',async()=>{
 let outcome=false;const changes=[],ui=createSharedUI({client:{request:async()=>({ok:true,events:[outcome?{...event,status:'answered',answer:0,outcome:'共同選擇已在期限後寫進人生。'}:event],preferences:prefs,now:time})},now:()=>time,document:{createElement:t=>new Node(t)},onChange:value=>changes.push(value)});
 await ui.sync();assert.equal(changes.at(-1).refreshLife,false);outcome=true;await ui.sync();assert.equal(changes.at(-1).refreshLife,true);assert.equal(changes.length,2);await ui.sync();assert.equal(changes.length,2);
 const source=readFileSync(new URL('../public/fate/app.js',import.meta.url),'utf8');assert.match(source,/if\(change\?\.refreshLife\)syncCloud\(true\)/);
});

test('a reply arriving during an older inbox request fetches a fresh receipt before enabling further actions',async()=>{
 let release,reads=0,answered=false;const stale=new Promise(r=>release=r),response=e=>({ok:true,events:[e],preferences:prefs,now:time});
 const ui=createSharedUI({client:{request:async action=>{if(action==='fate/social/inbox'){reads++;if(reads===2)return stale;return response(answered?{...event,status:'answered',answer:1,canReply:false}:event);}answered=true;return {ok:true};}},document:{createElement:t=>new Node(t)},now:()=>time,uuid:()=>crypto.randomUUID(),onChange(){}});
 await ui.sync();const before=new Node('section');ui.render(before);const inFlight=ui.sync(),mutation=before.querySelector('[data-shared-answer]').onclick();
 await Promise.resolve();release(response(event));await inFlight;await mutation;
 const after=new Node('section');ui.render(after);assert.equal(reads,3);assert.equal(after.querySelectorAll('[data-shared-answer]').length,0);assert.match(after.textContent,/已回應/);
});
