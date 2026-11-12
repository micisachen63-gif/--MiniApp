import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/scene-skills-ui.js',import.meta.url),'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve,reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
const settle = async () => { await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve)); };
const attribute = (tag,name) => {
  const value = tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'))?.[1];
  return value?.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
};
class Root {
  constructor(){this.innerHTML='';this.scrollTop=0;this.events=new Map();this.ownerDocument={activeElement:null};}
  set innerHTML(value){this.html=value;this.controls=null;}
  get innerHTML(){return this.html;}
  contains(target){return target?.root===this;}
  addEventListener(kind,fn){if(!this.events.has(kind))this.events.set(kind,new Set());this.events.get(kind).add(fn);}
  removeEventListener(kind,fn){this.events.get(kind)?.delete(fn);}
  querySelectorAll(selector){
    const name=selector.match(/^\[name="([^"]+)"\]$/)?.[1];
    if(!name)return [];
    if(!this.controls)this.controls=[...this.innerHTML.matchAll(/<(?:input|select)\b[^>]*>/g)].map(m=>m[0]).map(tag=>{
      const skillId=attribute(tag,'data-skill-id');
      return this.target({name:attribute(tag,'name')||'',value:attribute(tag,'value')||'',dataset:skillId===undefined?{}:{skillId},checked:/\schecked(?:\s|>)/.test(tag),disabled:/\sdisabled(?:\s|>)/.test(tag)});
    });
    return this.controls.filter(control=>control.name===name);
  }
  querySelector(selector){
    if(selector==='[data-sc-confirm]'&&this.innerHTML.includes('data-sc-confirm'))return {scrollIntoView:()=>{this.confirmScrolled=true;}};
    const action=selector.match(/^\[data-sc-action="([^"]+)"\]$/)?.[1];if(action)return this.button(action);
    return this.querySelectorAll(selector)[0]||null;
  }
  target(props={}){
    const root=this;
    return {root,dataset:{},name:'',value:'',disabled:false,selectionStart:0,selectionEnd:0,...props,
      closest(selector){return selector==='[data-sc-action]'&&this.dataset.scAction?this:null;},
      focus(){root.ownerDocument.activeElement=this;},
      setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}
    };
  }
  button(action,id,attrs={}){
    const tag=[...this.innerHTML.matchAll(/<button\b[^>]*>/g)].map(m=>m[0]).find(t=>attribute(t,'data-sc-action')===action&&(id===undefined||attribute(t,'data-skill-id')===id)&&Object.entries(attrs).every(([key,value])=>attribute(t,'data-'+key)===String(value)));
    assert.ok(tag,'Expected visible action '+action+(id?' for '+id:''));
    const dataset={};
    for(const [,key,value]of tag.matchAll(/\sdata-([a-z-]+)="([^"]*)"/g))dataset[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value.replaceAll('&amp;','&');
    return this.target({dataset,disabled:/\sdisabled(?:\s|>)/.test(tag)});
  }
  async fire(kind,target,extra={}){for(const fn of [...this.events.get(kind)||[]])await fn({target,...extra});}
  click(action,id,attrs){return this.fire('click',this.button(action,id,attrs));}
  change(name,value,{id,checked}={}){return this.fire('change',this.target({name,value,checked,dataset:id?{skillId:id}:{}}));}
  async type(value,{composing=false}={}){const input=this.querySelector('[name="skillSearch"]')||this.target({name:'skillSearch'});Object.assign(input,{value,selectionStart:value.length,selectionEnd:value.length});this.ownerDocument.activeElement=input;await this.fire('input',input,{isComposing:composing});return input;}
}
const writes = h => h.calls.filter(c => c.action !== 'skill-career');
const actionError = (message,props={}) => Object.assign(new Error(message),props);
function memoryStorage() { const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}; }
function skill(id,name,level=0,extra={}) {
  return {id,name,rarity:'普通',bookType:'技術書',eligibleBase:'sword',level:1,mp:12,cooldownSeconds:30,damage:'3.0A，單體',researchCost:80,effect:'斬擊並回復生命',
    mastery:{level,max:10,nextCost:1,recycleValue:20,outputPct:0,utilityPct:0},...extra};
}
function player(extra={}) {
  const special={learned:[],loadout:[],auto:{},cooldowns:{},mode:'safe',budget:0,...extra.special};
  const choices=[{branch:'A',path:'AA',tier:2,name:'聖騎士',skill:{name:'聖光斬',cost:10,mult:1.2,targets:1},passive:'防禦提高',weapon:'聖劍'},
    {branch:'B',path:'AB',tier:2,name:'烈焰劍士',skill:{name:'烈焰斬',cost:14,mult:1.5,targets:2},passive:'火焰加成',weapon:null}];
  return {ok:true,now:Date.now(),realmId:'permanent',characterId:'c1',readOnly:false,readOnlyReason:null,
    character:{tgId:'c1',revision:1,name:'靖澄',baseClass:'sword',classPath:'A',classTier:1,level:60,mp:100,partyId:null},
    skillAccess:{canManageBackpack:true,reason:null},
    stats:{skill:{name:'重擊',cost:8,mult:1.1,targets:1}},
    inventory:{book_skill_01_1:10,book_skill_01_2:3,book_skill_01_3:3,book_skill_02_1:1,research_fragment:100,mat_2:1,reselect_1:1},
    skills:[skill('skill_01_1','斬擊'),skill('skill_01_2','疾風斬'),skill('skill_01_3','回復劍'),skill('skill_02_1','烈焰劍'),skill('skill_07_1','聖光守護',0,{eligibleJob:'AA'}),skill('skill_17_2','團隊祝福'),skill('archer','落雷箭',0,{eligibleBase:'archer'})],
    eligible:['skill_01_1','skill_01_2','skill_01_3','skill_17_2'],special,
    career:{maxTier:4,current:{baseClass:'sword',baseClassName:'劍士',path:'A',tier:1,name:'騎士',skill:{name:'重擊',cost:8,mult:1.1,targets:1},passive:'勇氣',weapon:'長劍'},
      next:{tier:2,requiredLevel:60,material:{id:'mat_2',name:'王者之證',required:1,have:1},canAdvance:true,reason:null,choices},
      reselect:{cooldownUntil:null,cooldownRemainingMs:0,tiers:[{tier:1,currentBranch:'A',book:{id:'reselect_1',name:'一轉重選書',required:1,have:1},choices:[
        {branch:'A',branchName:'騎士',path:'A',tier:1,name:'騎士',selected:true,canReselect:false,reason:{code:'same',message:'目前分支'},unequipped:[]},
        {branch:'B',branchName:'戰士',path:'B',tier:1,name:'戰士',selected:false,canReselect:true,reason:null,unequipped:[{id:'gear1',name:'騎士佩劍',slot:'weapon',branchReq:'A'}]}
      ]}]},activity:{partyId:null,atlasRunId:'run1'}},...extra,special};
}
function harness({tab='skills',me=player(),draft={},override,api,storage=memoryStorage(),context={accountId:'a1',realmId:'permanent',characterId:'c1',epoch:1}}={}) {
  const root=new Root(),calls=[],changed=[],navigations=[];
  let value=clone(me),ctx={...context},current=true,serial=0;
  function apply(action,body) {
    if(action==='expedition/action') {
      const s=value.skills.find(s=>s.id===body.skillId),x=value.special;
      if(body.op==='learn') {value.inventory['book_'+s.id]-=s.mastery.nextCost;if(!x.learned.includes(s.id))x.learned.push(s.id);s.mastery.level++;s.mastery.nextCost=1;}
      if(body.op==='loadout') {x.loadout=[...body.loadout];x.auto=Object.fromEntries(Object.entries(x.auto).filter(([id])=>x.loadout.includes(id)));}
      if(body.op==='auto') {if(body.mode==='manual')delete x.auto[body.skillId];else x.auto[body.skillId]=body.mode;}
      if(body.op==='settings'){x.mode=body.mode;x.budget=body.budget;}
      if(body.op==='cast')x.pending=body.skillId;
      if(body.op==='cancel')delete x.pending;
      if(body.op==='recycle'){value.inventory['book_'+s.id]-=body.quantity;value.inventory.research_fragment+=s.mastery.recycleValue*body.quantity;}
      if(body.op==='redeem'){value.inventory['book_'+s.id]++;value.inventory.research_fragment-=80;}
    }
    if(action==='advance'){
      const choice=value.career.next.choices.find(c=>c.branch===body.branch);
      value.inventory[value.career.next.material.id]--;value.career.current={...value.career.current,...choice};
      value.character.classPath=choice.path;value.character.classTier=choice.tier;value.career.next=null;
    }
    if(action==='reselect'){
      const row=value.career.reselect.tiers.find(t=>t.tier===body.tier),choice=row.choices.find(c=>c.branch===body.branch);
      value.inventory[row.book.id]--;value.character.classPath=choice.path;value.career.current={...value.career.current,...choice};
      value.career.reselect.cooldownRemainingMs=1800000;
    }
    value.character.revision++;
    return {...clone(value),result:{op:body.op||action,...body}};
  }
  const host={draft,storage,current:()=>current,getContext:()=>({...ctx}),getActor:()=>value.character,
    navigate:(route,params)=>navigations.push({route,params:clone(params)}),onChanged:r=>changed.push(clone(r)),
    request:async(action,body={},opts={})=>{
      calls.push({action,body:clone(body),signal:opts.signal});
      const custom=override&&await override(action,body,{get me(){return value;},set me(v){value=clone(v);},calls,apply});
      if(custom!==undefined)return custom;
      if(action==='skill-career')return clone(value);
      return apply(action,body);
    }};
  if(!api){const sandbox={AbortController,console,Intl,Date,Math,URL,sessionStorage:storage,crypto:{randomUUID:()=>String(++serial).padStart(32,'0')}};
    vm.runInNewContext(source,sandbox,{filename:'scene-skills-ui.js'});api=sandbox.RpgSceneSkills;}
  const module=api.mount(root,host,{tab});
  return {root,host,module,api,storage,calls,changed,navigations,draft,setContext:v=>{ctx={...ctx,...v};},setCurrent:v=>{current=v;},setMe:v=>{value=clone(v);},getMe:()=>clone(value)};
}
async function confirm(h) { assert.match(h.root.innerHTML,/data-sc-confirm/);await h.root.click('confirm');await settle(); }

test('pure read, Chinese search and exact confirmed learning/progression consume once',async()=>{
  const h=harness();await settle();
  assert.deepEqual(h.calls.map(c=>c.action),['skill-career']);
  assert.match(h.root.innerHTML,/星圖戰鬥使用獨立構築/);assert.match(h.root.innerHTML,/3.0A，單體/);
  const input=await h.root.type('疾風');assert.match(h.root.innerHTML,/疾風斬/);assert.doesNotMatch(h.root.innerHTML,/>查看 斬擊/);
  assert.equal(h.root.ownerDocument.activeElement.selectionStart,input.value.length);
  await h.root.click('detail','skill_01_2');await h.root.click('learn','skill_01_2');
  assert.equal(writes(h).length,0);assert.match(h.root.innerHTML,/消耗 1 本技能書/);
  await confirm(h);assert.equal(writes(h).length,1);
  assert.deepEqual(writes(h)[0].body,{op:'learn',skillId:'skill_01_2',fromLevel:0,requestId:writes(h)[0].body.requestId});
  assert.equal(h.getMe().inventory.book_skill_01_2,2);
  await h.root.click('learn','skill_01_2');await confirm(h);
  assert.equal(writes(h)[1].body.fromLevel,1);
  assert.equal(h.getMe().skills.find(s=>s.id==='skill_01_2').mastery.level,2);
  assert.ok(h.calls.every(c=>c.action!=='me'&&c.action!=='expedition/me'&&c.action!=='meta'));
});

test('loadout, order, auto, cast/cancel reuse original operations; qualified cap and manual-only are enforced',async()=>{
  const p=player({special:{learned:['skill_01_1','skill_01_2','skill_01_3','skill_17_2'],loadout:['skill_01_1','skill_01_2']}});
  for(const s of p.skills)if(p.special.learned.includes(s.id))s.mastery.level=1;
  const h=harness({me:p});await settle();
  await h.root.click('detail','skill_01_3');await h.root.click('equip','skill_01_3');await confirm(h);
  assert.deepEqual(h.getMe().special.loadout,['skill_01_1','skill_01_2','skill_01_3']);
  await h.root.click('list');await h.root.click('detail','skill_17_2');assert.equal(h.root.button('equip','skill_17_2').disabled,true);
  await h.root.click('move-left','skill_01_3');await confirm(h);
  assert.deepEqual(h.getMe().special.loadout,['skill_01_1','skill_01_3','skill_01_2']);
  await h.root.change('skillAuto','elite',{id:'skill_01_1'});await h.root.click('auto','skill_01_1');await confirm(h);
  assert.deepEqual(writes(h).at(-1).body,{op:'auto',skillId:'skill_01_1',mode:'elite',requestId:writes(h).at(-1).body.requestId});
  await h.root.click('cast','skill_01_1');assert.match(h.root.innerHTML,/下一次有效掛機戰鬥/);await confirm(h);
  assert.equal(h.getMe().special.pending,'skill_01_1');await h.root.click('cancel-cast');await confirm(h);
  assert.equal(h.getMe().special.pending,undefined);
  await h.root.click('remove','skill_01_1');await confirm(h);
  assert.equal(h.getMe().special.auto.skill_01_1,undefined);assert.equal(h.draft['auto:skill_01_1'],undefined);
  await h.root.click('list');await h.root.click('detail','skill_01_1');await h.root.click('equip','skill_01_1');await confirm(h);
  assert.equal(h.getMe().special.auto.skill_01_1,undefined);
  const manual=harness({me:player({special:{learned:['skill_17_2'],loadout:['skill_17_2']}})});await settle();
  assert.equal(manual.root.button('cast','skill_17_2').disabled,true);
  await manual.root.change('skillAuto','ready',{id:'skill_17_2'});await manual.root.click('auto','skill_17_2');
  assert.equal(writes(manual).length,0);assert.doesNotMatch(manual.root.innerHTML,/data-sc-confirm/);
});

test('recycle validates quantity, exact rewards and cancellation; redeem is explicitly confirmed',async()=>{
  const h=harness();await settle();await h.root.click('detail','skill_01_1');
  for(const invalid of ['0','1.5','1e1','9999','-1']){
    await h.root.change('recycleQuantity',invalid);await h.root.click('recycle','skill_01_1');
    assert.doesNotMatch(h.root.innerHTML,/data-sc-confirm/);
  }
  await h.root.change('recycleQuantity','2');await h.root.click('recycle','skill_01_1');
  assert.match(h.root.innerHTML,/40 研究碎片/);assert.equal(h.module.handleBack(),true);assert.equal(writes(h).length,0);
  await h.root.click('recycle','skill_01_1');await confirm(h);
  assert.equal(writes(h).at(-1).body.quantity,2);assert.equal(h.getMe().inventory.research_fragment,140);
  await h.root.click('redeem','skill_01_1');assert.match(h.root.innerHTML,/消耗 80 研究碎片/);await h.root.click('cancel');assert.equal(writes(h).length,1);
  await h.root.click('redeem','skill_01_1');await confirm(h);
  assert.equal(h.getMe().inventory.research_fragment,60);
  assert.ok(writes(h).every(c=>c.action==='expedition/action'&&c.body.op!=='settings'));
});

test('career renders server reasons and projections; confirms exact advance/reselect and unequips',async()=>{
  const missing=player();missing.career.next.canAdvance=false;missing.career.next.material.have=0;missing.career.next.reason={code:'material',message:'缺少王者之證'};
  const blocked=harness({tab:'career',me:missing});await settle();
  assert.match(blocked.root.innerHTML,/缺少王者之證/);assert.equal(blocked.root.button('advance',undefined,{branch:'A'}).disabled,true);
  const h=harness({tab:'career'});await settle();
  await h.root.click('advance',undefined,{branch:'A',tier:2});assert.match(h.root.innerHTML,/消耗 1 個「王者之證」/);
  await confirm(h);assert.equal(writes(h)[0].action,'advance');assert.equal(writes(h)[0].body.branch,'A');assert.equal(h.getMe().character.classPath,'AA');
  const r=harness({tab:'career'});await settle();
  assert.equal(r.root.button('reselect',undefined,{branch:'A',tier:1}).disabled,true);
  await r.root.click('reselect',undefined,{branch:'B',tier:1});assert.match(r.root.innerHTML,/騎士佩劍/);assert.match(r.root.innerHTML,/保留後續分支/);
  await confirm(r);assert.deepEqual(writes(r)[0].body,{tier:1,branch:'B',requestId:writes(r)[0].body.requestId});
  const cool=player();cool.career.reselect.cooldownRemainingMs=1000;const choice=cool.career.reselect.tiers[0].choices[1];choice.canReselect=false;choice.reason={code:'cooldown',message:'請等待重選冷卻'};
  const c=harness({tab:'career',me:cool});await settle();assert.match(c.root.innerHTML,/請等待重選冷卻/);
  assert.equal(c.root.button('reselect',undefined,{branch:'B',tier:1}).disabled,true);
  const end=player();end.career.next=null;end.career.reselect.tiers.push({tier:4,currentBranch:'A',book:{id:null,name:'此階尚未開放重選',required:0,have:0},choices:[{branch:'B',name:'終階職業',selected:false,canReselect:false,reason:{code:'reselect_not_available',message:'第 4 階尚未開放重選'},unequipped:[]}]});
  const closed=harness({tab:'career',me:end});await settle();
  assert.match(closed.root.innerHTML,/第 4 階尚未開放重選/);assert.doesNotMatch(closed.root.innerHTML,/data-tier="4"/);assert.doesNotMatch(closed.root.innerHTML,/此階尚未開放重選 0／0/);
});

test('career change leaves ineligible slot visible and removable, never falsely enables cast or auto',async()=>{
  const p=player({special:{learned:['skill_07_1'],loadout:['skill_07_1']}});
  const h=harness({me:p});await settle();
  assert.match(h.root.innerHTML,/data-sc-ineligible/);assert.match(h.root.innerHTML,/目前職業無法施放/);
  assert.equal(h.root.button('auto','skill_07_1').disabled,true);assert.equal(h.root.button('cast','skill_07_1').disabled,true);
  assert.equal(h.root.button('remove','skill_07_1').disabled,false);
  await h.root.click('remove','skill_07_1');await confirm(h);
  assert.deepEqual(writes(h)[0].body.loadout,[]);
});

test('unknown result survives close, navigation and epoch changes with one original write; recovery only reads',async()=>{
  let lost=true;
  const h=harness({override:(action,body,state)=>{
    if(action==='expedition/action'&&lost){lost=false;state.apply(action,body);throw actionError('network',{uncertain:true});}
  }});await settle();await h.root.click('detail','skill_01_1');await h.root.click('learn','skill_01_1');await h.root.click('confirm');
  assert.equal(writes(h).length,1);assert.match(h.root.innerHTML,/data-sc-pending/);assert.equal(h.root.button('acknowledge').disabled,true);
  const after=h.getMe();h.module.dispose();
  const again=harness({me:after,api:h.api,storage:h.storage,context:{accountId:'a1',realmId:'permanent',characterId:'c1',epoch:7}});
  await settle();assert.match(again.root.innerHTML,/data-sc-pending/);assert.equal(writes(again).length,0);
  await again.root.click('refresh');assert.equal(writes(again).length,0);
  assert.equal(again.getMe().skills[0].mastery.level,1);
  await again.root.click('acknowledge');assert.doesNotMatch(again.root.innerHTML,/data-sc-pending/);assert.equal(writes(again).length,0);
  again.module.dispose();
  const third=harness({me:after,api:h.api,storage:h.storage,draft:h.draft});await settle();assert.doesNotMatch(third.root.innerHTML,/data-sc-pending/);
  assert.equal(writes(h).length+writes(again).length+writes(third).length,1);
});

test('late reads and late success/409 writes after A→B→A or navigation cannot alter new scope',async()=>{
  for(const outcome of ['read','success','409']){
    const delayed=deferred();let hold=true;
    const h=harness({override:(action,body,state)=>{
      if(outcome==='read'&&action==='skill-career'&&hold){hold=false;return delayed.promise;}
      if(outcome!=='read'&&action==='expedition/action'&&hold){hold=false;return delayed.promise;}
    }});
    await settle();
    let flight;
    if(outcome!=='read'){await h.root.click('detail','skill_01_1');await h.root.click('learn','skill_01_1');flight=h.root.click('confirm');await settle();}
    const before=h.root.innerHTML;
    h.setContext({characterId:'c2',epoch:2});h.setContext({characterId:'c1',epoch:3});h.setCurrent(false);
    if(outcome==='409')delayed.reject(actionError('角色已切換',{status:409,code:'character_changed'}));
    else delayed.resolve({...player(),result:outcome==='success'?{op:'learn'}:undefined});
    await flight;await settle();assert.equal(h.root.innerHTML,before);assert.equal(h.changed.length,0);
    if(outcome!=='read'){
      const another=harness({api:h.api,storage:h.storage,context:{accountId:'a1',realmId:'permanent',characterId:'c2',epoch:4},me:player({characterId:'c2',character:{tgId:'c2',revision:1,name:'別人',baseClass:'sword'}})});
      await settle();assert.doesNotMatch(another.root.innerHTML,/data-sc-pending/);
      const returned=harness({api:h.api,storage:h.storage,context:{accountId:'a1',realmId:'permanent',characterId:'c1',epoch:5}});
      await settle();assert.match(returned.root.innerHTML,/data-sc-pending/);
    }
  }
});

test('acknowledged write stays acknowledged if refresh fails; old revision is refused and confirmations invalidate',async()=>{
  let offline=false;
  const h=harness({override:(action,body,state)=>{
    if(action==='skill-career'&&offline)throw actionError('offline');
    if(action==='expedition/action'){const receipt=state.apply(action,body);offline=true;return receipt;}
  }});await settle();await h.root.click('detail','skill_01_1');await h.root.click('learn','skill_01_1');await confirm(h);
  assert.equal(writes(h).length,1);assert.match(h.root.innerHTML,/技能學習已完成/);assert.doesNotMatch(h.root.innerHTML,/data-sc-pending/);assert.match(h.root.innerHTML,/offline/);
  const r=harness();await settle();await r.root.click('detail','skill_01_1');await r.root.click('learn','skill_01_1');
  const next=r.getMe();next.character.revision=3;next.inventory.book_skill_01_1=0;r.setMe(next);await r.module.refresh();
  assert.doesNotMatch(r.root.innerHTML,/data-sc-confirm/);assert.equal(r.root.button('learn','skill_01_1').disabled,true);
  const old=player();old.character.revision=2;r.setMe(old);await r.module.refresh();
  assert.match(r.root.innerHTML,/收到較早/);assert.equal(writes(r).length,0);
});

test('IME and search drafts survive repaint/back; disposal aborts reads and removes delegated handlers',async()=>{
  const h=harness();await settle();
  const before=h.root.innerHTML,input=h.root.querySelector('[name="skillSearch"]');
  await h.root.fire('compositionstart',input);input.value='回';await h.root.fire('input',input,{isComposing:true});
  assert.equal(h.root.innerHTML,before);
  input.value='回復';await h.root.fire('compositionend',input);assert.equal(h.draft.search,'回復');assert.match(h.root.innerHTML,/回復劍/);
  await h.root.click('detail','skill_01_3');assert.equal(h.module.handleBack(),true);assert.equal(h.module.handleBack(),false);
  assert.equal(h.root.querySelector('[name="skillSearch"]').value,'回復');
  h.module.dispose();assert.ok([...h.root.events.values()].every(v=>v.size===0));
  const delayed=deferred(),pending=harness({override:action=>action==='skill-career'?delayed.promise:undefined});await settle();
  const signal=pending.calls[0].signal;pending.module.dispose();assert.equal(signal.aborted,true);delayed.resolve(player());await settle();
});

test('party/read-only restrictions disable consuming actions; duplicate confirmation cannot double-submit',async()=>{
  for(const p of [player({readOnly:true,readOnlyReason:'世界已封存'}),player({skillAccess:{canManageBackpack:false,reason:{code:'party',message:'目前冒險不允許調整技能'}},character:{tgId:'c1',revision:1,name:'靖澄',baseClass:'sword',mp:100,partyId:'party1'}})]){
    const h=harness({me:p});await settle();await h.root.click('detail','skill_01_1');assert.equal(h.root.button('learn','skill_01_1').disabled,true);assert.equal(writes(h).length,0);
  }
  const delayed=deferred(),h=harness({override:action=>action==='expedition/action'?delayed.promise:undefined});await settle();
  await h.root.click('detail','skill_01_1');await h.root.click('learn','skill_01_1');
  const target=h.root.button('confirm'),first=h.root.fire('click',target);await settle();await h.root.fire('click',target);
  assert.equal(writes(h).length,1);delayed.resolve({...player(),result:{op:'learn'}});await first;await settle();assert.equal(writes(h).length,1);
});

test('original mode/budget settings are independent of supplies and use server backpack permission',async()=>{
  const p=player({character:{tgId:'c1',revision:1,name:'靖澄',baseClass:'sword',mp:100,partyId:'arbitrary-running-ring-id'}});
  const h=harness({me:p});await settle();
  assert.equal(h.root.button('settings').disabled,false);
  await h.root.change('skillMode','strong');
  for(const invalid of ['-1','1.5','1e3','50001']){await h.root.change('skillBudget',invalid);await h.root.click('settings');assert.doesNotMatch(h.root.innerHTML,/data-sc-confirm/);}
  await h.root.change('skillBudget','1200');await h.root.click('settings');assert.equal(writes(h).length,0);
  assert.match(h.root.innerHTML,/每日最多耗用 1,200 金幣等值的背包藍水/);await confirm(h);
  assert.deepEqual(writes(h)[0].body,{op:'settings',mode:'strong',budget:1200,requestId:writes(h)[0].body.requestId});
  assert.equal(h.getMe().special.budget,1200);assert.equal(h.draft.skillBudget,undefined);
  const state=h.getMe();state.skillAccess.canManageBackpack=false;state.character.revision++;h.setMe(state);await h.module.refresh();assert.equal(h.root.button('settings').disabled,true);
});

test('multiple ineligible slots have a complete clear path and confirmation becomes visibly focused',async()=>{
  const p=player({eligible:[],special:{learned:['skill_01_1','skill_01_2','skill_01_3'],loadout:['skill_01_1','skill_01_2','skill_01_3']}});
  const h=harness({me:p});await settle();h.root.scrollTop=1500;
  await h.root.click('clear-loadout');
  assert.equal(h.root.scrollTop,0);assert.equal(h.root.confirmScrolled,true);
  assert.equal(h.root.ownerDocument.activeElement.dataset.scAction,'cancel');
  assert.match(h.root.innerHTML,/清空三格技能配置/);await confirm(h);
  assert.deepEqual(writes(h)[0].body.loadout,[]);assert.deepEqual(h.getMe().special.loadout,[]);
});

test('redeem costs come from the projection and cannot silently fall back to a rarity guess',async()=>{
  const p=player();p.skills[0].researchCost=91;
  const h=harness({me:p});await settle();await h.root.click('detail','skill_01_1');await h.root.click('redeem','skill_01_1');
  assert.match(h.root.innerHTML,/消耗 91 研究碎片/);
  await h.root.click('cancel');delete p.skills[0].researchCost;p.character.revision=2;h.setMe(p);await h.module.refresh();
  assert.equal(h.root.button('redeem','skill_01_1').disabled,true);assert.equal(writes(h).length,0);
});

test('a newer same-character scene fences an already-running read until a fresh snapshot arrives',async()=>{
  const delayed=deferred();let hold=false;
  const h=harness({override:action=>action==='skill-career'&&hold?delayed.promise:undefined});await settle();
  hold=true;const flight=h.module.refresh();await settle();
  h.module.update({accountId:'a1',realmId:'permanent',characterId:'c1',actor:{revision:3}});
  delayed.resolve(player());await flight;
  assert.match(h.root.innerHTML,/收到較早/);
  assert.equal(h.root.button('settings').disabled,true);
  hold=false;const latest=player();latest.character.revision=3;h.setMe(latest);await h.module.refresh();
  assert.equal(h.root.button('settings').disabled,false);assert.equal(writes(h).length,0);
});

test('特殊技能配置 slot cards, the skill list and the detail show the painted skill art and the description (classic parity)',async()=>{
  const me=player({special:{learned:['skill_01_1','skill_01_2'],loadout:['skill_01_1','skill_01_2']}});
  const h=harness({me});await settle();
  const slots=h.root.innerHTML.slice(h.root.innerHTML.indexOf('特殊技能配置'),h.root.innerHTML.indexOf('自動補水策略'));
  assert.match(slots,/<img class="sc-skill-art" src="\/expedition\/assets\/skills-painted-20261011\/skill_01_1\.webp"/);
  assert.match(slots,/<img class="sc-skill-art" src="\/expedition\/assets\/skills-painted-20261011\/skill_01_2\.webp"/);
  assert.match(slots,/<p class="sc-effect">技能倍率|<p class="sc-effect">3\.0A，單體 · 斬擊並回復生命<\/p>/);
  const list=h.root.innerHTML.slice(h.root.innerHTML.indexOf('技能傳承</h3>'));
  assert.match(list,/skills-painted-20261011\/skill_02_1\.webp/);assert.match(list,/sc-unlearned/);
  assert.doesNotMatch(h.root.innerHTML,/skills-painted-20261011\/archer\.webp/,'ids without painted art keep the text-only card');
  await h.root.click('detail','skill_01_2');
  assert.match(h.root.innerHTML,/sc-skill-art sc-skill-art-large" src="\/expedition\/assets\/skills-painted-20261011\/skill_01_2\.webp"/);
  assert.match(h.root.innerHTML,/<p class="sc-effect">3\.0A，單體 · 斬擊並回復生命<\/p>/);
  const errorHandlers=[...h.root.events.get('error')||[]];assert.equal(errorHandlers.length,1,'one capture handler hides a failed image');
  const img={classList:{contains:c=>c==='sc-skill-art'},hidden:false};errorHandlers[0]({target:img});assert.equal(img.hidden,true);
});

test('career tab shows compact skill art and a description, never a text glyph as the icon',async()=>{
  const h=harness({tab:'career'});await settle();
  assert.match(h.root.innerHTML,/sc-skill-art" src="\/art\/career-skill-icons-20261110\/sword_A\.webp"/);
  assert.match(h.root.innerHTML,/sc-skill-art" src="\/art\/career-skill-icons-20261110\/sword_A1\.webp"/);
  assert.match(h.root.innerHTML,/<p class="sc-effect">/);
  assert.doesNotMatch(h.root.innerHTML, /class="sc-skill-art">[＋+…\w]/);
  const html=h.root.innerHTML;
  const career=html.slice(html.indexOf('騎士'), html.indexOf('重選')>-1?html.indexOf('重選'):html.length);
  assert.doesNotMatch(career, /<span class="sc-skill-art">/);
});

test('every server special skill has a painted icon file',async()=>{
  const {LEGACY_SPECIAL_SKILLS}=await import('../src/game/special-data.js'),{THIEF_SKILLS}=await import('../src/game/thief-skills.js');
  const ids=[...LEGACY_SPECIAL_SKILLS,...THIEF_SKILLS].map(s=>s.id);assert.ok(ids.length>=60);
  const missing=ids.filter(id=>!fs.existsSync(new URL('../public/expedition/assets/skills-painted-20261011/'+id+'.webp',import.meta.url)));
  assert.deepEqual(missing,[]);
  assert.ok(ids.every(id=>/^skill_(?:\d{2}_\d|thief_\d{2})$/.test(id)),'scene icon rule covers every id');
});

test('轉職 follows the classic steps: conditions with source, path cards with skill comparison, confirm, result', async () => {
  const locked = player(); Object.assign(locked.career.next, { canAdvance: false, reason: { code: 'level', message: '需要 Lv60 才能轉職' } });
  locked.character.level = 52; locked.career.next.material = { id: 'mat_2', name: '王者之證', required: 1, have: 0, source: '討伐腐朽樹王' };
  const l = harness({ tab: 'career', me: locked }); await settle();
  assert.match(l.root.innerHTML, /sc-jc-steps/); assert.match(l.root.innerHTML, /aria-current="step"><b>1<\/b><span>確認條件/);
  assert.match(l.root.innerHTML, /Lv\.52 \/ 60/); assert.match(l.root.innerHTML, /取得：討伐腐朽樹王/);
  assert.equal(l.root.button('advance', undefined, { branch: 'A' }).disabled, true);
  assert.match(l.root.innerHTML, /需要 Lv\.60/);
  const h = harness({ tab: 'career' }); await settle();
  assert.match(h.root.innerHTML, /aria-current="step"><b>2<\/b><span>選擇路線/);
  assert.match(h.root.innerHTML, /條件都達成了/); assert.match(h.root.innerHTML, /選擇「聖光斬」|選擇「聖騎士」/);
  assert.match(h.root.innerHTML, /sc-jc-stats/); assert.match(h.root.innerHTML, /8 → <\/i>10/, 'path cards compare the new skill to the current one');
  assert.match(h.root.innerHTML, /<details class="sc-section sc-jc-reselect"/, 'reselect is tucked below the main flow');
  await h.root.click('advance', undefined, { branch: 'A', tier: 2 });
  assert.match(h.root.innerHTML, /sc-jc-confirm/); assert.match(h.root.innerHTML, /aria-current="step"><b>3<\/b>/);
  await confirm(h); await settle();
  assert.match(h.root.innerHTML, /轉職成功：聖騎士/); assert.match(h.root.innerHTML, /aria-current="step"><b>✓<\/b><span>轉職完成|sc-jc-result/);
  await h.root.click('job-ack'); assert.doesNotMatch(h.root.innerHTML, /轉職成功/);
});

// 2026-11-12: a revision-only scene snapshot (idle minute / Atlas chunk) re-reads quietly:
// no 讀取中 / disabled-button paint, and an unchanged answer keeps the live nodes.
test('revision-only snapshots re-read without flashing or rebuilding unchanged skill and 轉職 buttons',async()=>{
  for(const tab of ['skills','career']){
    const h=harness({tab});await settle();
    const writes=[];let node=0;
    Object.defineProperty(h.root,'innerHTML',{configurable:true,get(){return this.html;},set(value){writes.push(value);this.html=value;this.controls=null;this.firstChild={node:++node};}});
    await h.root.click('refresh');await settle();
    assert.ok(writes.some(w=>/讀取中/.test(w)),'the manual 重新整理 button keeps its visible loading state');
    const first=h.root.firstChild;assert.ok(first);
    const me=h.getMe();
    for(let i=1;i<=3;i++){
      const before=writes.length,read=h.calls.filter(c=>c.action==='skill-career').length;
      h.setMe({...me,character:{...me.character,revision:me.character.revision+i}});
      h.module.update({accountId:'a1',realmId:'permanent',characterId:'c1',character:{revision:me.character.revision+i}});
      assert.equal(writes.length,before,'no 讀取中 paint while the quiet re-read is in flight');
      await settle();
      assert.equal(h.calls.filter(c=>c.action==='skill-career').length,read+1,'each newer revision still re-reads once');
      assert.equal(writes.length,before,'identical answer keeps every button node');
      assert.equal(h.root.firstChild,first);
      assert.doesNotMatch(h.root.innerHTML,/讀取中/);
    }
    h.setMe({...me,character:{...me.character,revision:me.character.revision+10,name:'新名字'}});
    h.module.update({accountId:'a1',realmId:'permanent',characterId:'c1',character:{revision:me.character.revision+10}});await settle();
    assert.match(h.root.innerHTML,/新名字/,'a real change still repaints');
    h.module.dispose?.();
  }
});
