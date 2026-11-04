import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/scene-party-ui.js',import.meta.url),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture({char='a',account='u',realm='permanent',revision=1,partyRev=1,status='lobby',partyId='party-a'}={}){
 const p={id:partyId,kind:'dungeon',revision:partyRev,rev:partyRev,status,round:3,deadline:Date.now()+60000,name:'三人試煉',members:[{id:char,name:'目前角色',hp:90,maxHp:100,mp:40,maxMp:50,ready:true},{id:'ally',name:'隊友',hp:70,maxHp:100,mp:40,maxMp:50,ready:true},{id:'down',name:'倒地隊友',hp:0,maxHp:100,mp:0,maxMp:50,ready:true}],me:{leader:true,ready:true,left:false,actor:{id:char,name:'目前角色',hp:90,maxHp:100,mp:40,maxMp:50,special:{loadout:[],cooldowns:{}}}},enemy:{name:'試煉敵人',hp:500,maxHp:1000}};
 return {ok:true,accountId:account,realmId:realm,characterId:char,character:{tgId:char,name:'角色'+char,level:120,classPath:'B11',revision},now:Date.now(),readOnly:false,dungeons:[{id:'d30',name:'試煉',level:30,skillLevels:[30]}],skills:[],canCreate:true,stamina:{points:100,max:100,cost:10},active:p,party:p,history:[],drops:[],directory:{tab:'active',page:1,pages:1,total:1,parties:[p]}};
}
function harness(extra={}){
 const sandbox={AbortController,console,...extra};vm.runInNewContext(source,sandbox,{filename:'scene-party-ui.js'});
 const values=new Map(),calls=[],events=[];let context={accountId:'u',realmId:'permanent',characterId:'a',epoch:0};
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const host={getContext:()=>({...context}),current:()=>true,storage,onState:s=>events.push({revision:s.revision,busy:s.busy,stale:s.stale}),request:(action,body,options)=>{const d=deferred();calls.push({action,body:plain(body),options,...d});return d.promise;}};
 const create=()=>sandbox.RpgSceneParty.createClient(host);
 return {api:sandbox.RpgSceneParty,host,calls,events,values,create,setContext:c=>{context={...context,...c};}};
}
async function read(h,c,data=fixture(),query){const p=c.refresh(query);const call=h.calls.at(-1);assert.equal(call.action,'party/scene');call.resolve(data);assert.equal(await p,true);}
test('party window discovery and page changes only call the pure party projection',async()=>{
 const h=harness(),c=h.create();await read(h,c,fixture(),{tab:'ended',page:2,partyId:'party-a'});
 assert.deepEqual(h.calls.map(x=>[x.action,x.body]),[['party/scene',{tab:'ended',page:2,partyId:'party-a'}]]);
 assert.equal(c.state.revision,1);assert.equal(c.state.stale,false);assert.equal(c.pending(),null);c.dispose();
});
test('frozen realm remains readable and blocks every party mutation locally',async()=>{
 const h=harness(),c=h.create();const data=fixture();data.readOnly=true;data.readOnlyReason='賽季正在結算';
 await read(h,c,data);assert.equal(await c.execute('party/create',{kind:'dungeon',dungeonId:'d30'},'建立隊伍'),false);
 assert.equal(h.calls.length,1);assert.equal(c.pending(),null);assert.match(c.state.error,/賽季正在結算/);c.dispose();
});
test('unknown creation survives closing and reopening; refresh and recovery never replay it',async()=>{
 const h=harness(),c=h.create();await read(h,c);
 const write=c.execute('party/create',{kind:'dungeon',dungeonId:'d30'},'建立隊伍');h.calls.at(-1).reject(Error('connection lost'));
 assert.equal(await write,false);const original=c.pending();assert.equal(original.action,'party/create');assert.equal(c.acknowledge(),false);
 c.dispose();const reopened=h.create();assert.equal(reopened.pending().id,original.id);
 await read(h,reopened,fixture({revision:2,partyRev:2}));
 assert.equal(await reopened.execute('party/create',{kind:'dungeon',dungeonId:'d30'},'建立隊伍'),false);
 assert.equal(h.calls.filter(x=>x.action==='party/create').length,1);assert.equal(reopened.acknowledge(),true);
 assert.equal(reopened.pending(),null);assert.equal(h.calls.length,3);reopened.dispose();
});
test('a definite failed join clears pending, reads state once, and never retries the write',async()=>{
 const h=harness(),c=h.create();await read(h,c);
 const write=c.execute('party/action',{partyId:'party-a',op:'join'},'加入隊伍');
 h.calls.at(-1).reject(Object.assign(Error('隊伍已滿'),{status:409,code:'full',uncertain:false}));
 await new Promise(r=>setImmediate(r));assert.equal(h.calls.at(-1).action,'party/scene');h.calls.at(-1).resolve(fixture({partyRev:2}));
 assert.equal(await write,false);assert.equal(c.pending(),null);assert.match(c.state.error,/隊伍已滿/);
 assert.deepEqual(h.calls.map(x=>x.action),['party/scene','party/action','party/scene']);c.dispose();
});
test('late A-to-B-to-A reads cannot overwrite the new A panel even if abort is ignored',async()=>{
 const h=harness(),old=h.create(),late=old.refresh();const oldCall=h.calls.at(-1);
 h.setContext({characterId:'b',epoch:1});h.setContext({characterId:'a',epoch:2});
 const fresh=h.create();await read(h,fresh,fixture({revision:5,partyRev:5}));
 oldCall.resolve(fixture({revision:1,partyRev:1}));assert.equal(await late,false);
 assert.equal(old.state.data,null);assert.equal(fresh.state.revision,5);old.dispose();fresh.dispose();
});
test('late successful writes after A-to-B-to-A retain the pending operation for explicit readback',async()=>{
 const h=harness(),old=h.create();await read(h,old);
 const result=old.execute('party/action',{partyId:'party-a',op:'ready',ready:false},'取消準備'),write=h.calls.at(-1);
 const id=old.pending().id;h.setContext({characterId:'b',epoch:1});h.setContext({characterId:'a',epoch:2});
 const fresh=h.create();await read(h,fresh,fixture({revision:3,partyRev:3}));
 write.resolve({ok:true,party:fixture({revision:3,partyRev:3}).party});
 assert.equal(await result,false);assert.equal(fresh.pending().id,id);assert.equal(h.calls.filter(x=>x.action==='party/action').length,1);
 assert.equal(fresh.acknowledge(),true);old.dispose();fresh.dispose();
});
test('late definite errors from a previous epoch cannot clear the current A pending warning',async()=>{
 const h=harness(),old=h.create();await read(h,old);
 const result=old.execute('party/action',{partyId:'party-a',op:'start'},'開始挑戰'),write=h.calls.at(-1),id=old.pending().id;
 h.setContext({characterId:'b',epoch:1});h.setContext({characterId:'a',epoch:2});const fresh=h.create();
 write.reject(Object.assign(Error('全員尚未準備'),{status:409,code:'ready',uncertain:false}));assert.equal(await result,false);
 assert.equal(fresh.pending().id,id);assert.equal(fresh.acknowledge(),false);assert.equal(h.calls.length,2);old.dispose();fresh.dispose();
});
test('older character revisions and older party revisions keep the latest accepted snapshot',async()=>{
 const h=harness(),c=h.create();await read(h,c,fixture({revision:5,partyRev:7}));
 for(const data of [fixture({revision:4,partyRev:7}),fixture({revision:5,partyRev:6})]){
   const r=c.refresh();h.calls.at(-1).resolve(data);assert.equal(await r,false);assert.equal(c.state.revision,5);
   assert.equal(c.state.data.party.rev,7);assert.equal(c.state.stale,true);assert.match(c.state.error,/較早/);
 }
 await read(h,c,fixture({revision:6,partyRev:8}));assert.equal(c.state.stale,false);c.dispose();
});
test('account realm and character mismatches are rejected before data enters the panel',async()=>{
 const h=harness(),c=h.create();
 for(const data of [fixture({account:'other'}),fixture({realm:'season-x'}),fixture({char:'other'})]){
   const r=c.refresh();h.calls.at(-1).resolve(data);assert.equal(await r,false);assert.equal(c.state.data,null);assert.equal(c.state.stale,true);
 }
 c.dispose();
});
test('a refreshed party state invalidates a consequential confirmation before it can submit',async()=>{
 const h=harness(),c=h.create();await read(h,c);
 assert.equal(c.prepare('party/action',{partyId:'party-a',op:'start'},'開始挑戰','耗體力'),true);
 await read(h,c,fixture({partyRev:2}));assert.equal(c.state.confirm,null);assert.equal(await c.submit(),false);
 assert.equal(h.calls.filter(x=>x.action!=='party/scene').length,0);c.dispose();
});
test('tactical writes preserve the selected party round skill and ally; stale round is never silently retried',async()=>{
 const h=harness(),c=h.create();await read(h,c,fixture({status:'combat'}));
 const body={partyId:'party-a',op:'submit',round:3,skillId:'skill_06_2',targetId:'ally'};
 const r=c.execute('party/action',body,'提交第 3 回合');assert.deepEqual(h.calls.at(-1).body,{...body,requestId:c.pending().id});assert.deepEqual(plain(c.pending().body),h.calls.at(-1).body);
 h.calls.at(-1).reject(Object.assign(Error('回合已更新'),{code:'round',status:409}));
 await new Promise(r=>setImmediate(r));const next=fixture({status:'combat',partyRev:2});next.party.round=4;h.calls.at(-1).resolve(next);
 assert.equal(await r,false);assert.equal(c.pending(),null);assert.match(c.state.error,/重新選擇技能與目標/);
 assert.equal(h.calls.filter(x=>x.action==='party/action').length,1);c.dispose();
});
test('an acknowledged write remains acknowledged when its subsequent read goes offline',async()=>{
 const h=harness(),c=h.create();await read(h,c);
 const r=c.execute('party/action',{partyId:'party-a',op:'ready',ready:false},'取消準備');
 h.calls.at(-1).resolve({ok:true,party:fixture({partyRev:2}).party});
 await new Promise(r=>setImmediate(r));assert.equal(h.calls.at(-1).action,'party/scene');h.calls.at(-1).reject(Error('read offline'));
 assert.equal(await r,true);assert.equal(c.pending(),null);assert.equal(c.state.stale,true);assert.match(c.state.notice,/已完成/);assert.equal(h.calls.length,3);c.dispose();
});
test('malformed successful receipts remain uncertain and cannot unlock another party write',async()=>{
 const h=harness(),c=h.create();await read(h,c);
 const r=c.execute('party/create',{kind:'dungeon',dungeonId:'d30'},'建立隊伍');h.calls.at(-1).resolve({ok:true});
 assert.equal(await r,false);assert.ok(c.pending());assert.equal(h.calls.length,2);assert.equal(c.acknowledge(),false);c.dispose();
});
test('ally targeting excludes departed unknown and downed members, while resurrection only targets known downed allies',()=>{
 const h=harness(),p=fixture({status:'combat'}).party;
 p.members.push({id:'unknown',name:'未知',hp:null,maxHp:100},{id:'left',name:'離隊',hp:100,maxHp:100,left:true},{id:'departedDown',name:'離隊倒地',hp:0,maxHp:100,left:true});
 assert.deepEqual(plain(h.api.targetChoices(p,{target:'ally'},'a')).map(x=>x.targetId),['a','ally']);
 assert.deepEqual(plain(h.api.targetChoices(p,{target:'downed_ally'},'a')).map(x=>x.targetId),['down']);
});
test('enemy and group-wide targets are explicit in the UI but retain the existing server actor-id contract',()=>{
 const h=harness(),p=fixture({status:'combat'}).party;
 for(const mode of ['enemy','self','all_allies','auto_ally','role']){
   const targets=plain(h.api.targetChoices(p,{target:mode},'a'));assert.equal(targets.length,1);assert.equal(targets[0].targetId,'a');
 }
 assert.equal(h.api.targetChoices(p,{target:'enemy'},'a')[0].label,'試煉敵人');
 p.enemy.hp=0;assert.equal(h.api.targetChoices(p,{target:'enemy'},'a').length,0);
});
test('unsupported continuation writes are outside this integration batch',async()=>{
 const h=harness(),c=h.create();await read(h,c);
 assert.throws(()=>c.prepare('party/action',{partyId:'party-a',op:'repeat'},'再戰',''),/不支援/);
 assert.equal(h.calls.length,1);c.dispose();
});

test('party actions and reward requests persist the exact server requestId, while creation makes no idempotency claim',async()=>{
 for(const [action,body] of [['party/action',{partyId:'party-a',op:'ready',ready:false}],['party/reward',{partyId:'party-a'}],['party/create',{kind:'dungeon',dungeonId:'d30'}]]){
  const h=harness(),c=h.create();await read(h,c);
  const r=c.execute(action,body,'測試操作'),sent=h.calls.at(-1),record=c.pending();
  if(action==='party/create'){assert.equal(sent.body.requestId,undefined);assert.equal(record.body.requestId,undefined);}
  else{assert.equal(sent.body.requestId,record.id);assert.equal(record.body.requestId,record.id);}
  assert.deepEqual(plain(record.body),sent.body);sent.reject(Error('offline'));assert.equal(await r,false);
  assert.equal(c.pending().id,record.id);assert.equal(h.calls.filter(x=>x.action===action).length,1);c.dispose();
 }
});

test('an unknown tactical write can only be acknowledged against its original party, including after viewing another party',async()=>{
 const h=harness(),c=h.create();await read(h,c,fixture({status:'combat'}));
 const write=c.execute('party/action',{partyId:'party-a',op:'submit',round:3,skillId:'skill_06_2',targetId:'ally'},'提交原隊伍戰術');
 h.calls.at(-1).reject(Error('offline'));await write;const pending=c.pending();
 await read(h,c,fixture({status:'combat',partyRev:2}),{tab:'active',page:1,partyId:'party-a'});
 assert.equal(c.state.checkedPending,pending.id);
 await read(h,c,fixture({partyId:'other-party',status:'ended',partyRev:2}),{tab:'ended',page:1,partyId:'other-party'});
 assert.equal(c.state.checkedPending,null);assert.equal(c.acknowledge(),false);assert.equal(c.pending().id,pending.id);
 await read(h,c,fixture({status:'combat',partyRev:3}),{tab:'active',page:1,partyId:'party-a'});
 assert.equal(c.acknowledge(),true);assert.equal(c.pending(),null);assert.equal(h.calls.filter(x=>x.action==='party/action').length,1);c.dispose();
});
test('an unknown reward survives closing and A-to-B-to-A, and reading another party never clears its warning',async()=>{
 const h=harness(),old=h.create();await read(h,old,fixture({status:'won'}));
 const write=old.execute('party/reward',{partyId:'party-a'},'領取戰利品');h.calls.at(-1).reject(Error('offline'));await write;
 const pending=old.pending();old.dispose();h.setContext({characterId:'b',epoch:1});const other=h.create();
 await read(h,other,fixture({char:'b',partyId:'party-b'}));assert.equal(other.pending(),null);other.dispose();
 h.setContext({characterId:'a',epoch:2});const reopened=h.create();assert.equal(reopened.pending().id,pending.id);
 await read(h,reopened,fixture({partyId:'different-party',status:'ended'}),{tab:'ended',page:1,partyId:'different-party'});
 assert.equal(reopened.acknowledge(),false);assert.equal(reopened.pending().body.requestId,pending.id);
 await read(h,reopened,fixture({partyRev:2,status:'won'}),{tab:'ended',page:1,partyId:'party-a'});
 assert.equal(reopened.acknowledge(),true);assert.equal(h.calls.filter(x=>x.action==='party/reward').length,1);reopened.dispose();
});
test('an unknown creation is checked against current-party discovery rather than an unrelated selected party',async()=>{
 const h=harness(),c=h.create();await read(h,c);
 const write=c.execute('party/create',{kind:'dungeon',dungeonId:'d30'},'建立隊伍');h.calls.at(-1).reject(Error('offline'));await write;
 const data=fixture({partyId:'different-party'});data.active=fixture({partyId:'created-party'}).party;
 await read(h,c,data,{tab:'active',page:1,partyId:'different-party'});assert.equal(c.acknowledge(),false);
 await read(h,c,fixture({partyId:'created-party'}),{tab:'active',page:1});assert.equal(c.acknowledge(),true);
 assert.equal(h.calls.filter(x=>x.action==='party/create').length,1);c.dispose();
});
test('dungeon skill display uses only authoritative IDs and never includes same-level books outside that pool',()=>{
 const h=harness(),skills=[{id:'sword',level:90},{id:'thief-other',level:90},{id:'thief-low',level:60}];
 assert.deepEqual(plain(h.api.dropSkills({skillLevels:[90],dropSkillIds:['sword']},skills)),[{id:'sword',level:90}]);
});
test('dungeon skill display retains a real lower-level thief fallback supplied by the server',()=>{
 const h=harness(),skills=[{id:'thief-other',level:90},{id:'thief-low',level:60}];
 assert.deepEqual(plain(h.api.dropSkills({skillLevels:[90],dropSkillIds:['thief-low']},skills)),[{id:'thief-low',level:60}]);
});
test('an empty authoritative trial pool is distinguished from missing or incomplete drop data',()=>{
 const h=harness(),skills=[{id:'sword',level:90}];
 assert.deepEqual(plain(h.api.dropSkills({trial:3,dropSkillIds:[]},skills)),[]);
 assert.equal(h.api.dropSkills({skillLevels:[90]},skills),null);
 assert.equal(h.api.dropSkills({dropSkillIds:['missing-skill']},skills),null);
});
test('an ineligible retained loadout remains intact but cannot be submitted as a tactical skill',()=>{
 const h=harness(),p=fixture({status:'combat'}).party,s={id:'skill_06_2',target:'ally',mp:10,eligible:false};
 p.me.actor.special.learned=[s.id];p.me.actor.special.loadout=[s.id];const before=plain(p);
 assert.match(h.api.tacticReason(p,s,Date.now(),'a'),/職業或等級不符合/);assert.deepEqual(plain(p),before);
});
test('tactical special skills require the battle snapshot learned set and explicit eligibility',()=>{
 const h=harness(),p=fixture({status:'combat'}).party,s={id:'skill_06_2',target:'ally',mp:10,eligible:true};
 p.me.actor.special.learned=[];assert.match(h.api.tacticReason(p,s,Date.now(),'a'),/尚未學會/);
 p.me.actor.special.learned=[s.id];assert.equal(h.api.tacticReason(p,s,Date.now(),'a'),'');
 delete s.eligible;assert.match(h.api.tacticReason(p,s,Date.now(),'a'),/資格尚未取得/);
});
test('native attacks and role skills keep their own rules without inheriting special-skill qualification checks',()=>{
 const h=harness(),p=fixture({status:'combat'}).party;p.me.actor.mp=0;p.me.actor.special.learned=[];
 assert.equal(h.api.tacticReason(p,{id:'attack',target:'enemy',native:true,mp:null},Date.now(),'a'),'');
 assert.equal(h.api.tacticReason(p,{id:'defend',target:'self',mp:0},Date.now(),'a'),'');
 const role={id:'role_guard',roleSkill:true,target:'role',mp:10};assert.equal(h.api.tacticReason(p,role,Date.now(),'a'),'魔力不足');
 p.me.actor.mp=40;p.me.actor.roleCooldowns={role_guard:p.round+1};assert.match(h.api.tacticReason(p,role,Date.now(),'a'),/冷卻 1 回合/);
 p.me.actor.roleCooldowns={};assert.equal(h.api.tacticReason(p,role,Date.now(),'a'),'');
});

class RevealRoot {
 constructor(){
  this.isConnected=true;this.scrollTop=0;this.reveals=0;this.focuses=[];this.events=new Map();this.controls=[];
  this.ownerDocument={body:{kind:'body'},documentElement:{kind:'html'},hidden:false,addEventListener(){},removeEventListener(){}};
  this.ownerDocument.activeElement=this.ownerDocument.body;this.html='';this.pendingPanel=null;
 }
 contains(node){return node?.root===this&&this.controls.includes(node);}
 addEventListener(kind,fn){this.events.set(kind,fn);}
 removeEventListener(kind){this.events.delete(kind);}
 get innerHTML(){return this.html;}
 set innerHTML(html){
  if(this.contains(this.ownerDocument.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;
  this.html=html;this.controls=[];
  const pendingStart=html.indexOf('data-sp-pending'),pendingEnd=pendingStart<0?-1:html.indexOf('</section>',pendingStart);
  this.pendingPanel=pendingStart<0?null:{scrollIntoView:options=>{this.reveals++;this.scrollTop=0;this.lastScrollOptions=options;}};
  for(const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
   const attributes=match[1],dataset={};
   for(const attr of attributes.matchAll(/\bdata-([a-z0-9-]+)="([^"]*)"/g))dataset[attr[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=attr[2];
   const root=this,inPending=match.index>pendingStart&&match.index<pendingEnd;
   const button={root,name:'',dataset,disabled:/(?:^|\s)disabled(?:\s|$)/.test(attributes),
    closest(selector){return selector==='[data-sp-action]'?this:selector==='[data-sp-pending]'&&inPending?root.pendingPanel:null;},
    focus(){if(this.disabled)return;root.ownerDocument.activeElement=this;root.focuses.push({...this.dataset});}};
   this.controls.push(button);
  }
 }
 querySelector(selector){
  if(selector==='[data-sp-pending]')return this.pendingPanel;
  const action=selector.match(/^\[data-sp-action="([^"]+)"\]$/)?.[1];
  return action?this.button(action):null;
 }
 querySelectorAll(selector){return selector==='button,select'?this.controls:[];}
 button(action,fields={}){return this.controls.find(b=>b.dataset.spAction===action&&Object.entries(fields).every(([k,v])=>b.dataset[k]===String(v)));}
 async click(action,fields={}){
  const target=this.button(action,fields);assert.ok(target,'missing rendered control '+action);
  return this.events.get('click')?.({target});
 }
}
const drainMount=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));};
function emptyPartyFixture(){
 const data=fixture();data.active=null;data.party=null;data.directory.parties=[];data.directory.total=0;return data;
}
async function revealHarness(){
 const frames=new Map(),intervals=new Map();let frameId=0,timerId=0;
 const h=harness({
  requestAnimationFrame(fn){const id=++frameId;frames.set(id,{fn,cancelled:false});return id;},
  cancelAnimationFrame(id){const f=frames.get(id);if(f)f.cancelled=true;},
  setInterval(fn){const id=++timerId;intervals.set(id,fn);return id;},
  clearInterval(id){intervals.delete(id);}
 });
 const root=new RevealRoot(),view=h.api.mount(root,h.host,{tab:'dungeons'});
 h.calls.at(-1).resolve(emptyPartyFixture());await drainMount();
 const flush=(ignoreCancellation=false)=>{const batch=[...frames.values()];frames.clear();for(const frame of batch)if(ignoreCancellation||!frame.cancelled)frame.fn();};
 return {h,root,view,frames,intervals,flush};
}
async function lostCreate(m){
 m.root.scrollTop=800;
 const result=m.root.click('create',{dungeonId:'d30'});assert.equal(m.h.calls.at(-1).action,'party/create');
 m.h.calls.at(-1).reject(Error('lost write response'));await result;await drainMount();
 return JSON.parse([...m.h.values.values()][0]);
}
test('a newly unknown write reveals its recovery controls once and later polling preserves user scroll and focus',async()=>{
 const m=await revealHarness();await lostCreate(m);assert.equal(m.root.reveals,0);
 m.flush();assert.equal(m.root.reveals,1);assert.equal(m.root.ownerDocument.activeElement.dataset.spAction,'pending-view');
 assert.deepEqual(plain(m.root.lastScrollOptions),{block:'nearest',behavior:'auto'});
 m.root.scrollTop=650;m.root.button('tab',{tab:'trials'}).focus();
 [...m.intervals.values()][0]();assert.equal(m.h.calls.at(-1).action,'party/scene');
 m.h.calls.at(-1).resolve(emptyPartyFixture());await drainMount();m.flush();
 assert.equal(m.root.reveals,1);assert.equal(m.root.scrollTop,650);assert.equal(m.root.ownerDocument.activeElement.dataset.tab,'trials');
 assert.equal(m.h.calls.filter(c=>c.action==='party/create').length,1);m.view.dispose();
});
test('a known successful write never jumps to the transient pending controls',async()=>{
 const m=await revealHarness();m.root.scrollTop=700;
 const result=m.root.click('create',{dungeonId:'d30'});m.h.calls.at(-1).resolve({ok:true,party:fixture({partyRev:2}).party});
 await drainMount();assert.equal(m.h.calls.at(-1).action,'party/scene');m.h.calls.at(-1).resolve(fixture({partyRev:2}));
 await result;await drainMount();m.flush();assert.equal(m.root.reveals,0);
 assert.notEqual(m.root.ownerDocument.activeElement?.dataset?.spAction,'pending-view');m.view.dispose();
});
test('queued recovery focus respects disposal context and root connection even if cancellation is ignored',async t=>{
 for(const kind of ['dispose','context','detached'])await t.test(kind,async()=>{
  const m=await revealHarness();await lostCreate(m);assert.ok(m.frames.size);
  const external={kind:'new-view-focus'};m.root.ownerDocument.activeElement=external;
  if(kind==='dispose')m.view.dispose();
  if(kind==='context')m.h.setContext({characterId:'b',epoch:1});
  if(kind==='detached')m.root.isConnected=false;
  m.flush(true);assert.equal(m.root.reveals,0);assert.equal(m.root.ownerDocument.activeElement,external);m.view.dispose();
 });
});
test('an old pending frame cannot steal or cancel the one-time reveal for a newer operation',async()=>{
 const m=await revealHarness(),first=await lostCreate(m);
 const read=m.view.refresh();m.h.calls.at(-1).resolve(emptyPartyFixture());await read;await drainMount();
 await m.root.click('acknowledge');assert.equal(m.h.values.size,0);
 const second=await lostCreate(m);assert.notEqual(second.id,first.id);
 m.flush(true);assert.equal(m.root.reveals,1);assert.equal(m.root.ownerDocument.activeElement.dataset.spAction,'pending-view');
 assert.equal(m.h.calls.filter(c=>c.action==='party/create').length,2);m.view.dispose();
});

function towerFixture(options={}){
 const data=fixture(options);delete data.dungeons;data.active.kind='tower';data.active.name='星穹塔第一區';data.active.canJoin=false;data.active.joinReason=null;
 data.active.towerProgress={version:2,startFloor:1,endFloor:10,cleared:4,clearedFloor:4,badges:18,challengeEndsAt:data.now+900000,rewardable:false};
 data.tower={best:20,badges:100,daily:{used:false,day:'2026-11-05',resetAt:data.now+86400000},
  areas:[{id:'tower_1',startFloor:1,endFloor:10,level:30,requiredBest:0,name:'第一區',fullClearBadges:50,cooperation:'一般協作',canCreate:true,reason:null},
   {id:'tower_2',startFloor:11,endFloor:20,level:60,requiredBest:10,name:'第二區',fullClearBadges:100,cooperation:'分工協作',canCreate:true,reason:null},
   {id:'tower_3',startFloor:21,endFloor:30,level:90,requiredBest:20,name:'第三區',fullClearBadges:150,cooperation:'嚴密協作',canCreate:false,reason:{code:'best',message:'需先通關第 20 層'}}]};
 return data;
}
async function readTower(h,c,data=towerFixture(),query){const p=c.refresh(query);assert.equal(h.calls.at(-1).action,'tower/scene');h.calls.at(-1).resolve(data);assert.equal(await p,true);}
test('tower and dungeon clients keep independent pending storage and never cross-acknowledge the same character',async()=>{
 const h=harness(),dungeon=h.create();await read(h,dungeon);
 const dw=dungeon.execute('party/action',{partyId:'party-a',op:'ready',ready:false},'副本取消準備');h.calls.at(-1).reject(Error('offline'));await dw;const d=plain(dungeon.pending());
 const tower=h.api.createClient(h.host,{kind:'tower'});assert.equal(tower.pending(),null);await readTower(h,tower);
 const tw=tower.execute('party/action',{partyId:'tower-a',op:'ready',ready:false},'爬塔取消準備');h.calls.at(-1).reject(Error('offline'));await tw;const t=plain(tower.pending());
 assert.notEqual(d.id,t.id);assert.equal(d.kind,'dungeon');assert.equal(t.kind,'tower');assert.equal(h.values.size,2);
 const data=towerFixture({partyId:'tower-a',partyRev:2});await readTower(h,tower,data);assert.equal(tower.acknowledge(),true);
 assert.equal(dungeon.pending().id,d.id);assert.equal(dungeon.acknowledge(),false);assert.equal(h.calls.filter(x=>x.action==='party/action').length,2);
 tower.dispose();dungeon.dispose();const reopened=h.create();assert.equal(reopened.pending().id,d.id);reopened.dispose();
});
test('tower projections reject dungeon parties and mutations cannot be acknowledged with a different party kind',async()=>{
 const h=harness(),tower=h.api.createClient(h.host,{kind:'tower'});let data=towerFixture();data.active.kind='dungeon';
 const bad=tower.refresh();h.calls.at(-1).resolve(data);assert.equal(await bad,false);assert.equal(tower.state.data,null);
 await readTower(h,tower);const write=tower.execute('party/action',{partyId:'party-a',op:'start'},'開始爬塔');
 h.calls.at(-1).resolve({ok:true,party:fixture().party});assert.equal(await write,false);assert.ok(tower.pending());assert.equal(tower.acknowledge(),false);tower.dispose();
});
test('tower creation uses the original three start floors and cannot create a dungeon in tower mode',async()=>{
 const h=harness(),tower=h.api.createClient(h.host,{kind:'tower'});await readTower(h,tower);
 assert.throws(()=>tower.prepare('party/create',{kind:'dungeon',dungeonId:'d30'},'錯誤種類',''),/不支援/);
 assert.throws(()=>tower.prepare('party/create',{kind:'tower',startFloor:12},'錯誤樓層',''),/不支援/);
 const write=tower.execute('party/create',{kind:'tower',startFloor:11},'第二區');assert.deepEqual(h.calls.at(-1).body,{kind:'tower',startFloor:11});
 h.calls.at(-1).reject(Error('offline'));await write;const pending=plain(tower.pending());
 await readTower(h,tower);assert.equal(tower.pending().id,pending.id);assert.equal(h.calls.filter(x=>x.action==='party/create').length,1);tower.dispose();
});
test('tower tactical recovery stays tied to its original tower and cannot be acknowledged from a different selected team',async()=>{
 const h=harness(),tower=h.api.createClient(h.host,{kind:'tower'});await readTower(h,tower,towerFixture({partyId:'tower-a',status:'combat'}));
 const write=tower.execute('party/action',{partyId:'tower-a',op:'submit',round:3,skillId:'attack',targetId:'a'},'爬塔戰術');h.calls.at(-1).reject(Error('offline'));await write;const pending=plain(tower.pending());
 await readTower(h,tower,towerFixture({partyId:'tower-b',status:'ended'}),{partyId:'tower-b',tab:'ended'});assert.equal(tower.acknowledge(),false);
 const none=towerFixture();none.active=null;none.party=null;none.activeOtherKind={id:'dungeon-a',kind:'dungeon',status:'lobby',ownCharacter:true,characterId:'a'};
 await readTower(h,tower,none,{tab:'active'});assert.equal(tower.acknowledge(),false);assert.equal(tower.pending().id,pending.id);
 await readTower(h,tower,towerFixture({partyId:'tower-a',status:'combat',partyRev:2}),{partyId:'tower-a'});assert.equal(tower.acknowledge(),true);assert.equal(h.calls.filter(x=>x.action==='party/action').length,1);tower.dispose();
});
test('tower daily use changes invalidate a ready start confirmation while countdowns follow server time',async()=>{
 const h=harness(),tower=h.api.createClient(h.host,{kind:'tower'}),data=towerFixture();data.now=200000;await readTower(h,tower,data);
 assert.ok(Math.abs(tower.now()-200000)<1000);assert.equal(tower.prepare('party/action',{partyId:'party-a',op:'start'},'開始爬塔','使用今日機會'),true);
 const changed=plain(data);changed.tower.daily.used=true;await readTower(h,tower,changed);assert.equal(tower.state.confirm,null);assert.equal(await tower.submit(),false);assert.equal(h.calls.filter(x=>x.action==='party/action').length,0);tower.dispose();
});
test('tower lost and ended partial completions keep reward controls and original per-area server gates visible',async t=>{
 for(const status of ['lost','ended'])await t.test(status,async()=>{
  const h=harness(),root=new RevealRoot(),data=towerFixture({status}),view=h.api.mount(root,h.host,{kind:'tower',tab:'current'});
  data.party.canReward=true;data.party.towerProgress.rewardable=true;h.calls.at(-1).resolve(data);await drainMount();
  assert.equal(root.button('reward').disabled,false);assert.match(root.html,/對應 18 枚徽記/);assert.match(root.html,/已通關/);
  const tabRead=root.click('tab',{tab:'areas'});assert.equal(h.calls.at(-1).action,'tower/scene');h.calls.at(-1).resolve(data);await tabRead;assert.equal(root.button('create-tower',{startFloor:'21'}).disabled,true);assert.match(root.html,/需先通關第 20 層/);view.dispose();
 });
});
test('another-kind occupancy gives explicit own-character and character-switch navigation without exposing dungeon actions as tower actions',async()=>{
 for(const ownCharacter of [true,false]){
  const h=harness(),root=new RevealRoot(),nav=[];h.host.navigate=(route,params)=>nav.push([route,plain(params)]);
  const data=towerFixture();data.active=null;data.party=null;data.activeOtherKind={id:'dungeon-b',kind:'dungeon',status:'lobby',ownCharacter,characterId:ownCharacter?'a':'b'};
  const view=h.api.mount(root,h.host,{kind:'tower',tab:'current'});h.calls.at(-1).resolve(data);await drainMount();
  await root.click(ownCharacter?'other-kind':'other-character');assert.equal(nav[0][0],ownCharacter?'party':'characters');
  if(ownCharacter)assert.equal(nav[0][1].partyId,'dungeon-b');view.dispose();
 }
});
