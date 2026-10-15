import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const actions={summon:true,fuse:true,activate:true,unbind:true,trade:true};
const config={schemaVersion:1,configVersion:'fixture-approved',status:'approved',enabled:true,qualityOrder:['white','green','blue','purple','red','gold','pink','cyan'],pools:{normal:{allowedCounts:[1,5,10],singleGoldPrice:7,tenGoldPrice:70},featured:{allowedCounts:[1,5,10],drawsPerVoucher:5}},actions};
const state={schemaVersion:1,charId:'hero-a',revision:1,level:15,unlocked:true,balances:{gold:100,freeNormalDraws:200,voucherCount:2,remainder:4,availableDraws:14},inventory:{items:[]},actions};
const receipt=id=>({operationId:'committed-1',requestId:id,charId:'hero-a',action:'summon',status:'committed',configVersion:config.configVersion,results:[{id:'item-1',type:'magic',quality:'purple',bound:false}]});
const pendingAuto={characterId:'hero-a',requestId:'auto_request_1',payload:{pool:'normal',count:1,targetType:'magic',targetRank:0,maxGold:null}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const attrKey=name=>name.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase());
function rootNode(query=()=>null){
  const events=new Map();let html='',renders=0;
  return {get innerHTML(){return html;},set innerHTML(value){html=value;renders++;},get renders(){return renders;},querySelector:query,querySelectorAll:()=>[],contains:()=>true,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),click(dataset){const button={dataset,disabled:false,closest:()=>({dataset:{guardianId:dataset.guardianId}}),hasAttribute:name=>Object.hasOwn(dataset,attrKey(name))};events.get('click')?.({target:{closest:()=>button}});},change(key,value,checked=false){events.get('change')?.({target:{value,checked,hasAttribute:name=>attrKey(name)===key}});}};
}
function setup(host,{root=rootNode(),autoLoad=false,extraWindow={},initialView='summon',extraState={}}={}){
  let gesture;const scene={},originalQuery=root.querySelector;
  root.querySelector=selector=>originalQuery(selector)||(selector==='.guardian-worldtree-scene'?scene:null);
  const window={RpgGuardianWorldTree:{markup:()=>'',mount:()=>({cleanup(){}})},RpgGuardianSummonGesture:{mount:(_scene,options)=>{let held=false;gesture={pull(){if(held||!options.canStart())return;held=true;void options.commit().then(result=>{held=false;options.onFinish(result,{complete:!!result});});},isInteracting:()=>held,getState:()=>({pointer:null,requesting:held}),cleanup(){}};return gesture;}},...extraWindow},context=vm.createContext({window,AbortController,console,setTimeout,clearTimeout});
  for(const name of ['guardian-sigil-contract.js','guardian-auto-ui.js','guardian-ritual.js','guardian-sigil.js'])vm.runInContext(read(name),context);
  const handle=window.RpgGuardianSigil.mount(root,{config,state:{...state,...extraState},host,interactive:true,autoLoad,initialView});
  return {root,handle,window,pull:()=>gesture.pull()};
}
function selectAuto(h){h.root.change('guardianAutoEnabled','',true);h.root.change('guardianAutoType','magic');}

// A structured mini-DOM enforces node identity/connectivity, media starts and
// template-only footer replacement without depending on a browser package.
function mediaDomRoot(){
  const doc={activeElement:null},root=rootNode();let footer,scene,html='',starts=0,footerChanges=0;
  const simple=()=>({textContent:'',disabled:false,closest:()=>null});
  const stageNotice=simple();
  function controls(markup){
    const panel={scrollTop:0},settings={open:/guardian-summon-settings" open/.test(markup),classList:{contains:name=>name==='guardian-summon-settings'}},rates={open:false},planning=simple(),button={...simple(),dataset:{guardianAction:'summon'}};
    const summary={tagName:'SUMMARY',parentElement:settings,focus(){doc.activeElement=this;}};
    const budget=markup.includes('data-guardian-auto-budget')?{value:'',type:'number',selectionStart:null,selectionEnd:null,getAttributeNames:()=>['data-guardian-auto-budget'],getAttribute:()=>'',focus(){doc.activeElement=this;}}:null;
    const node={markup,panel,settings,summary,budget,planning,button,querySelector(selector){return selector==='.guardian-settings-panel'?panel:selector==='.guardian-summon-settings'?settings:selector==='.guardian-summon-settings>summary'?summary:selector==='.guardian-ritual-rates'?rates:selector.includes('guardian-auto-budget')?budget:selector.includes('guardian-planning')?planning:selector.includes('guardian-action')?button:null;},querySelectorAll(selector){return selector==='[data-guardian-auto-budget]'&&budget?[budget]:[];},contains(value){return value===node||value===budget||value===panel||value===settings||value===summary;},replaceWith(next){assert.equal(footer,node);footer=next;footerChanges++;}};
    return node;
  }
  doc.createElement=tag=>{assert.equal(tag,'template');let parsed;return {set innerHTML(value){parsed=controls(value);},content:{querySelector:selector=>selector==='.guardian-ritual-footer'?parsed:null}};};
  Object.defineProperty(root,'innerHTML',{get:()=>html,set:value=>{html=value;if(scene){scene.isConnected=false;scene.video.isConnected=false;}scene={isConnected:true,video:{isConnected:true,currentTime:3.5,start:++starts}};footer=controls(value);}});
  root.ownerDocument=doc;
  root.querySelector=selector=>selector==='.guardian-worldtree-scene'?scene:selector==='.guardian-ritual-footer'?footer:selector==='.guardian-stage-notice'?stageNotice:footer?.querySelector(selector)||null;
  root.querySelectorAll=selector=>selector==='[data-guardian-action]'?[footer.button]:[];
  return {root,doc,get scene(){return scene;},get footer(){return footer;},get starts(){return starts;},get footerChanges(){return footerChanges;}};
}

function receiptStage(host,{saved={operation:{...receipt('old_request'),operationId:'old-operation',results:[{id:'old-card',type:'magic',quality:'purple'}]},presentation:{operationId:'old-operation',ready:true,selected:'old-card',revealed:['old-card']}}}={}){
  const held={getBoundingClientRect:()=>({left:130,top:350,width:60,height:60})},scene={dataset:{guardianAngelPose:'portrait'},getBoundingClientRect:()=>({left:20,top:50,width:300,height:500}),querySelector:selector=>selector==='[data-guardian-start-pull]'?held:null},button={dataset:{guardianAction:'summon'},textContent:'',disabled:false,closest:()=>null},detail={textContent:''},planning={textContent:'',insertAdjacentHTML(){}},snapshots=[],mountOptions=[];let gesture,presentation;
  const root=rootNode(selector=>selector==='.guardian-worldtree-scene'?scene:selector.includes('guardian-action')?button:selector==='.guardian-controls .guardian-planning'?planning:selector==='.guardian-result-selection'?detail:null);
  root.querySelectorAll=selector=>selector==='[data-guardian-action]'?[button]:[];
  const h=setup({...host,loadReceipt:()=>saved,saveReceipt:(operation,presentation)=>{snapshots.push({operation:operation&&JSON.parse(JSON.stringify(operation)),presentation:presentation&&JSON.parse(JSON.stringify(presentation))});}},{root,extraWindow:{
    RpgGuardianSummonGesture:{mount:(node,options)=>{
      let interacting=false,disposed=false,result;gesture={pull(){if(disposed||interacting||!options.canStart())return;interacting=true;options.commit().then(value=>{result=value;if(!value&&!disposed){interacting=false;options.onFinish(null,{complete:false});}});},finish(){assert.ok(result);interacting=false;options.onFinish(result,{complete:true});},isInteracting:()=>interacting&&!disposed,getState:()=>({pointer:null,requesting:interacting&&!result}),cleanup(){disposed=true;}};return gesture;
    }},
    RpgGuardianPresentation:{mount:(node,options)=>{
      mountOptions.push({playTransition:options.playTransition,transitionOrigin:options.transitionOrigin});
      let value=options.previous?.operationId===options.operation.operationId?{...options.previous,revealed:[...(options.previous.revealed||[])]}:{operationId:options.operation.operationId,ready:false,selected:null,revealed:[]};
      value.phase=value.ready?(options.playTransition?'scatter':'selection'):'pull';
      const update=()=>options.onUpdate({...value,revealed:[...value.revealed]});
      update();presentation={isInteracting:()=>value.phase==='scatter',cleanup(){},openBatch(){value={...value,ready:true,phase:'scatter'};update();},finishTransition(){value={...value,phase:'selection'};update();options.onInteractionChange?.(false);},selectOne(){assert.equal(value.phase,'selection');const id=options.operation.results[0].id;value={...value,selected:id,revealed:[id]};update();}};return presentation;
    }}
  }});
  return {...h,button,planning,snapshots,mountOptions,get gesture(){return gesture;},get presentation(){return presentation;}};
}

test('unchanged background polling does not recreate the stage or restart its media',()=>{const h=setup({characterId:()=>state.charId,mutate:async()=>{}}),start=h.root.renders;assert.equal(h.handle.update({autoJob:null}),false);assert.equal(h.handle.update({characterId:'hero-a',revision:state.revision,balances:state.balances}),false);assert.equal(h.root.renders,start);const job={id:'job-a',status:'running',totalDraws:1};h.handle.update({autoJob:job});const changed=h.root.renders;assert.equal(h.handle.update({autoJob:{...job}}),false);assert.equal(h.root.renders,changed);h.handle.cleanup();});

test('real ritual has both original receipt lookup and same-request retry after a lost foreground request',async()=>{
  const requests=[];let pending;
  const h=setup({characterId:()=>state.charId,requestId:()=> 'manual_request_1',savePending:value=>pending=value,clearPending:()=>pending=null,recover:async()=>{throw Object.assign(Error('尚未找到已結算結果'),{status:404});},mutate:async(action,body)=>{requests.push(JSON.parse(JSON.stringify(body)));if(requests.length===1)throw Object.assign(Error('連線中斷'),{uncertain:true});return {operation:receipt(body.requestId),state};}});
  h.pull();await tick();
  assert.match(h.root.innerHTML,/data-guardian-recover/);assert.match(h.root.innerHTML,/data-guardian-retry/);
  h.root.click({guardianRecover:''});await tick();assert.ok(pending);assert.match(h.root.innerHTML,/data-guardian-retry/);
  h.root.click({guardianRetry:''});await tick();assert.deepEqual(requests[0],requests[1]);assert.equal(pending,null);h.handle.cleanup();
});

test('auto confirmation holds the flight gate before awaiting consent and cancellation stores no request',async()=>{
  let resolve,confirmations=0,starts=0,saves=0;
  const h=setup({characterId:()=>state.charId,requestId:()=> 'auto_request_2',mutate:()=>{},confirm:()=>{confirmations++;return new Promise(done=>resolve=done);},saveAutoPending:()=>saves++,autoStart:()=>starts++});
  selectAuto(h);h.root.click({guardianAutoStart:''});h.root.click({guardianAutoStart:''});
  assert.equal(confirmations,1);assert.equal(starts,0);resolve(false);await tick();assert.equal(saves,0);h.handle.cleanup();
});

test('auto start freezes the current unblurred budget: zero forbids gold and blank means no limit',async()=>{
  for(const value of ['0','']){
    const budget={value},root=rootNode(selector=>selector==='[data-guardian-auto-budget]'?budget:null),sent=[],prompts=[];
    const h=setup({characterId:()=>state.charId,requestId:()=> 'budget_request_1',mutate:()=>{},confirm:async(title,body)=>{prompts.push(body);return true;},autoStart:async body=>{sent.push({...body});return {job:{id:'budget-job',status:'running',totalDraws:0}};}},{root});
    selectAuto(h);root.change('guardianAutoBudget','500');budget.value=value;root.click({guardianAutoStart:''});await tick();
    assert.equal(sent[0].maxGold,value==='0'?0:null);
    assert.match(prompts[0],value==='0'?/金幣支出上限 0/:/未設定金幣上限/);h.handle.cleanup();
  }
});

test('uncertain auto start retries the original ID even when that job already ended and leaves foreground storage untouched',async()=>{
  let saved,foregroundWrites=0;const sent=[],order=[],job={id:'job-a',status:'ended',totalDraws:1};
  const h=setup({characterId:()=>state.charId,requestId:()=> 'auto_request_3',mutate:()=>{},confirm:async()=>true,savePending:()=>foregroundWrites++,clearPending:()=>foregroundWrites++,saveAutoPending:value=>{saved=JSON.parse(JSON.stringify(value));order.push('persist');},clearAutoPending:()=>{saved=null;},autoStart:async body=>{order.push('send');sent.push(JSON.parse(JSON.stringify(body)));if(sent.length===1)throw Object.assign(Error('連線中斷'),{uncertain:true});return {job};}});
  selectAuto(h);h.root.click({guardianAutoStart:''});await tick();assert.deepEqual(order,['persist','send']);assert.ok(saved);assert.match(h.root.innerHTML,/data-guardian-auto-retry/);
  h.root.click({guardianAutoRetry:''});await tick();assert.deepEqual(sent[0],sent[1]);assert.equal(saved,null);assert.equal(foregroundWrites,0);assert.match(h.root.innerHTML,/原祈願已結算/);h.handle.cleanup();
});

test('remount restores matching auto request without starting; explicit retry replays the original job',async()=>{
  let saved=JSON.parse(JSON.stringify(pendingAuto)),requests=0;const bodies=[];
  const host={characterId:()=>state.charId,mutate:()=>{},state:async()=>state,loadAutoPending:()=>saved,saveAutoPending:value=>saved=value,clearAutoPending:()=>saved=null,autoStart:async body=>{requests++;bodies.push({...body});return {job:{id:'old-job',status:'ended',totalDraws:5}};}};
  const h=setup(host,{autoLoad:true});await tick();await tick();assert.equal(requests,0);assert.ok(saved);h.root.click({guardianAutoRetry:''});await tick();assert.equal(requests,1);assert.equal(bodies[0].requestId,pendingAuto.requestId);assert.equal(saved,null);h.handle.cleanup();
  const other=setup({...host,characterId:()=> 'hero-b',state:async()=>({...state,charId:'hero-b'}),loadAutoPending:()=>pendingAuto},{autoLoad:true,extraState:{charId:'hero-b'}});await tick();await tick();assert.equal(requests,1);other.handle.cleanup();
});

test('leaving the page or switching characters during auto confirmation cannot send a request',async()=>{
  let resolve,actor='hero-a',calls=0;
  const h=setup({characterId:()=>actor,requestId:()=> 'auto_request_4',mutate:()=>{},confirm:()=>new Promise(done=>resolve=done),autoStart:()=>calls++});selectAuto(h);h.root.click({guardianAutoStart:''});actor='hero-b';resolve(true);await tick();assert.equal(calls,0);h.handle.cleanup();
  const gone=setup({characterId:()=>state.charId,requestId:()=> 'auto_request_5',mutate:()=>{},confirm:()=>new Promise(done=>resolve=done),autoStart:()=>calls++});selectAuto(gone);gone.root.click({guardianAutoStart:''});gone.handle.cleanup();resolve(true);await tick();assert.equal(calls,0);
});

test('background job paint waits for committed-result pull or selection and flushes when released',async()=>{
  const scene={},root=rootNode(selector=>selector==='.guardian-worldtree-scene'?scene:null);let held=true,mounts=0,cleanups=0,change;
  const h=setup({characterId:()=>state.charId,mutate:()=>{},loadReceipt:()=>({operation:receipt('manual_request_2'),presentation:{operationId:'committed-1',ready:false,revealed:[]}})},{root,extraWindow:{RpgGuardianPresentation:{mount:(node,options)=>{mounts++;change=options.onInteractionChange;return {isInteracting:()=>held,cleanup:()=>cleanups++};}}}});
  const before=root.renders;h.handle.update({autoJob:{id:'job-b',status:'running',targetType:'magic',targetRank:3,totalDraws:2}});
  assert.equal(root.renders,before);assert.equal(cleanups,0);assert.equal(mounts,1);
  held=false;change(false);await tick();assert.equal(root.renders,before+1);assert.equal(mounts,2);assert.equal(cleanups,1);h.handle.cleanup();
});

test('summon settings default closed, remain open after selecting a pool, and leave an accessible running progress entry',()=>{
  const details={open:true},root=rootNode(selector=>selector==='.guardian-summon-settings'?details:null),h=setup({characterId:()=>state.charId,mutate:()=>{}},{root});
  assert.doesNotMatch(root.innerHTML,/guardian-summon-settings" open/);
  root.change('guardianPoolChoice','featured');assert.match(root.innerHTML,/guardian-summon-settings" open/);
  h.handle.update({autoJob:{id:'job-c',status:'running',targetType:'magic',targetRank:4,totalDraws:12}});assert.match(root.innerHTML,/data-guardian-settings-open/);assert.match(root.innerHTML,/已召喚 12 次/);h.handle.cleanup();
});

test('overview network failure is visible and offers reload while unresolved resources can still open recovery',async()=>{
  const h=setup({characterId:()=>state.charId,mutate:()=>{},state:async()=>{throw Error('連線暫時不穩');}},{autoLoad:true,initialView:'overview'});await tick();
  assert.match(h.root.innerHTML,/連線暫時不穩/);assert.match(h.root.innerHTML,/data-guardian-refresh/);h.handle.cleanup();
});

test('actual Host keeps foreground and auto start pending in separate persistent character keys',()=>{
  const app=read('app.js'),start=app.indexOf('  function guardianStorage('),end=app.indexOf('\n  function render()',start),window={},values=new Map(),session=new Map(),S={me:{character:{tgId:'hero-a'}}};
  const store=map=>({getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)});
  const context=vm.createContext({window,S,localStorage:store(values),sessionStorage:store(session),guardianAutoBanner:()=>{},guardianController:null,confirmSheet:()=>{},crypto:{randomUUID:()=> '11111111-1111-1111-1111-111111111111'}});vm.runInContext(app.slice(start,end),context);
  const host=window.RpgGuardianHost;host.savePending({requestId:'manual_a'});host.saveAutoPending(pendingAuto);assert.equal(host.loadPending().requestId,'manual_a');assert.equal(host.loadAutoPending().requestId,'auto_request_1');assert.equal(values.size,2);assert.equal(session.size,0);
  S.me.character.tgId='hero-b';assert.equal(host.loadAutoPending(),null);host.saveAutoPending({...pendingAuto,characterId:'hero-b',requestId:'auto_b'});S.me.character.tgId='hero-a';host.clearAutoPending();assert.equal(host.loadPending().requestId,'manual_a');S.me.character.tgId='hero-b';assert.equal(host.loadAutoPending().requestId,'auto_b');
});

test('same-snapshot guardian balances update current resources but reject old revisions and other characters',()=>{
  const h=setup({characterId:()=>state.charId,mutate:()=>{}});
  assert.equal(h.handle.update({characterId:'hero-a',revision:3,balances:{gold:75,freeNormalDraws:190,voucherCount:1,remainder:2,availableDraws:7}}),true);
  assert.match(h.root.innerHTML,/免費 190 次/);assert.match(h.root.innerHTML,/金幣 75/);
  const before=h.root.renders;
  assert.equal(h.handle.update({characterId:'hero-a',revision:2,balances:{gold:100,freeNormalDraws:200}}),false);
  assert.equal(h.handle.update({characterId:'hero-b',revision:99,balances:{gold:999,freeNormalDraws:999}}),false);
  assert.equal(h.root.renders,before);assert.match(h.root.innerHTML,/免費 190 次/);h.handle.cleanup();
});

test('balance-only polling preserves an in-flight original summon and its pending request',async()=>{
  let resolve;const sent=[];
  const h=setup({characterId:()=>state.charId,requestId:()=> 'manual_request_3',mutate:(action,body)=>{sent.push({...body});return new Promise(done=>resolve=done);}});
  h.pull();
  h.handle.update({characterId:'hero-a',revision:2,balances:{gold:80,freeNormalDraws:199}});
  h.root.click({guardianAction:'summon'});assert.equal(sent.length,1);
  resolve({operation:receipt(sent[0].requestId),state:{...state,revision:3,balances:{...state.balances,gold:80,freeNormalDraws:199}}});await tick();
  assert.match(h.root.innerHTML,/已取得 1 根/);assert.match(h.root.innerHTML,/免費 199 次/);h.handle.cleanup();
});

test('live media and captured scene stay attached when changing job totals and resource balances',()=>{
  const dom=mediaDomRoot(),h=setup({characterId:()=>state.charId,mutate:()=>{}},{root:dom.root});
  const stage=dom.scene,video=stage.video,starts=dom.starts;stage.pointerCapture=17;
  h.handle.update({autoJob:{id:'job-live',status:'running',totalDraws:5,targetType:'magic',targetRank:3}});
  h.handle.update({characterId:'hero-a',revision:2,balances:{gold:77,freeNormalDraws:195}});
  assert.equal(dom.scene,stage);assert.equal(dom.scene.video,video);assert.equal(video.currentTime,3.5);assert.equal(video.isConnected,true);assert.equal(stage.pointerCapture,17);assert.equal(dom.starts,starts);assert.equal(dom.footerChanges,2);h.handle.cleanup();
});

test('footer replacement preserves expanded settings, scroll and a currently edited budget input',()=>{
  const dom=mediaDomRoot(),h=setup({characterId:()=>state.charId,mutate:()=>{}},{root:dom.root});selectAuto(h);
  dom.footer.settings.open=true;dom.footer.panel.scrollTop=83;const previous=dom.footer.budget;assert.ok(previous);previous.value='2700';previous.focus();
  const stage=dom.scene;h.handle.update({characterId:'hero-a',revision:2,balances:{gold:87,freeNormalDraws:192}});
  assert.equal(dom.scene,stage);assert.equal(dom.footer.settings.open,true);assert.equal(dom.footer.panel.scrollTop,83);assert.notEqual(dom.doc.activeElement,previous);assert.equal(dom.doc.activeElement,dom.footer.budget);assert.equal(dom.footer.budget.value,'2700');h.handle.cleanup();
});

test('keyboard focus on the summon settings summary survives a job progress update',()=>{
  const dom=mediaDomRoot(),h=setup({characterId:()=>state.charId,mutate:()=>{}},{root:dom.root});const previous=dom.footer.summary;previous.focus();
  h.handle.update({autoJob:{id:'job-focus',status:'running',totalDraws:1,targetType:'magic',targetRank:3}});
  assert.notEqual(dom.doc.activeElement,previous);assert.equal(dom.doc.activeElement,dom.footer.summary);h.handle.cleanup();
});

test('entering the feather inventory performs one fresh state read and repeated inventory click does not poll',async()=>{
  let reads=0;const fresh={...state,revision:5,inventory:{items:[{id:'new-auto-card',type:'magic',quality:'purple'}]}},h=setup({characterId:()=>state.charId,mutate:()=>{},state:async()=>{reads++;return fresh;}});
  h.root.click({guardianView:'inventory'});await tick();assert.equal(reads,1);assert.match(h.root.innerHTML,/new-auto-card/);
  h.root.click({guardianView:'inventory'});await tick();assert.equal(reads,1);
  h.root.click({guardianBack:''});h.root.click({guardianView:'inventory'});await tick();assert.equal(reads,2);h.handle.cleanup();
});

test('repeat single summon uses a fresh UUID once and waits for the real new result transition',async()=>{
  const requests=[],resolvers=[];let id=0;
  const h=receiptStage({characterId:()=>state.charId,requestId:()=>`fresh_request_${++id}`,mutate:(action,body)=>{requests.push({...body});return new Promise(resolve=>resolvers.push(resolve));}});
  for(let draw=1;draw<=2;draw++){
    h.root.click({guardianAction:'summon'});assert.equal(requests.length,draw-1);h.gesture.pull();h.root.click({guardianAction:'summon'});assert.equal(requests.length,draw);assert.equal(h.button.disabled,true);assert.equal(h.button.textContent,'召喚回應中');
    const operation={...receipt(requests[draw-1].requestId),operationId:`fresh-operation-${draw}`,results:[{id:`fresh-card-${draw}`,type:'magic',quality:'gold'}]};
    resolvers[draw-1]({operation,state:{...state,revision:draw+1,balances:{...state.balances,freeNormalDraws:200-draw}}});await tick();
    assert.equal(h.button.disabled,true);assert.equal(h.button.textContent,'神羽展開中');assert.match(h.planning.textContent,/正在展開/);
    const receiptBeforeTransition=h.snapshots.at(-1);assert.equal(receiptBeforeTransition.operation.operationId,operation.operationId);assert.equal(receiptBeforeTransition.presentation,null);
    h.root.click({guardianAction:'summon'});assert.equal(requests.length,draw);
    h.gesture.finish();await tick();const current=h.snapshots.at(-1);
    assert.equal(current.operation.operationId,operation.operationId);assert.equal(current.presentation.ready,true);assert.equal(current.presentation.selected,null);assert.deepEqual(current.presentation.revealed,[]);assert.equal(current.presentation.phase,'scatter');assert.equal(h.button.textContent,'神羽散開中');assert.equal(h.button.disabled,true);
    h.presentation.finishTransition();await tick();assert.match(h.planning.textContent,/點選神羽，迎接守護天使/);assert.equal(h.button.disabled,false);h.presentation.selectOne();assert.match(h.planning.textContent,/守護天使已現身/);
  }
  assert.notEqual(requests[0].requestId,requests[1].requestId);h.handle.cleanup();
});

test('a lost repeat-summon response blocks another draw and retries only the original already committed UUID',async()=>{
  const requests=[],committed=new Map();let ids=0;
  const h=receiptStage({characterId:()=>state.charId,requestId:()=>`retry_request_${++ids}`,mutate:async(action,body)=>{
    requests.push({...body});if(!committed.has(body.requestId)){committed.set(body.requestId,{...receipt(body.requestId),operationId:'same-committed',results:[{id:'same-card',type:'magic',quality:'purple'}]});throw Object.assign(Error('連線中斷'),{uncertain:true});}
    return {operation:committed.get(body.requestId),state:{...state,revision:2,balances:{...state.balances,freeNormalDraws:199}}};
  }});
  h.root.click({guardianAction:'summon'});h.gesture.pull();await tick();assert.match(h.root.innerHTML,/data-guardian-retry/);assert.match(h.planning.textContent,/前次結果待確認/);
  h.root.click({guardianAction:'summon'});assert.equal(requests.length,1);
  h.root.click({guardianRetry:''});await tick();assert.equal(requests.length,2);assert.equal(ids,1);assert.equal(committed.size,1);assert.deepEqual(requests[0],requests[1]);assert.equal(h.button.textContent,'展開神羽');assert.equal(h.button.disabled,false);
  h.root.click({guardianAction:'summon'});assert.equal(requests.length,2);assert.equal(h.button.textContent,'神羽散開中');h.presentation.finishTransition();await tick();assert.match(h.planning.textContent,/點選神羽/);h.presentation.selectOne();assert.match(h.planning.textContent,/守護天使已現身/);h.handle.cleanup();
});

test('a running background prayer cannot erase the previous ready receipt or start another manual draw',()=>{
  let sent=0;const h=receiptStage({characterId:()=>state.charId,requestId:()=> 'blocked_request',mutate:()=>sent++,autoCurrent:()=>({id:'running-prayer',status:'running',totalDraws:3,targetType:'magic',targetRank:6})});
  h.root.click({guardianAction:'summon'});assert.equal(sent,0);assert.equal(h.snapshots.at(-1).operation.operationId,'old-operation');assert.equal(h.snapshots.some(value=>value.operation===null),false);assert.equal(h.button.disabled,true);assert.match(h.root.innerHTML,/背景祈願正在進行/);h.handle.cleanup();
});

test('the fresh full-pull burst receives its actual scene origin once and a restored scatter receipt skips replay',async()=>{
  let result;
  const host={characterId:()=>state.charId,requestId:()=> 'origin_request',mutate:async(action,body)=>({operation:{...receipt(body.requestId),operationId:'origin-operation'},state:{...state,revision:2}})};
  const h=receiptStage(host);h.root.click({guardianAction:'summon'});h.gesture.pull();await tick();h.gesture.finish();await tick();
  const played=h.mountOptions.at(-1);assert.equal(played.playTransition,true);assert.ok(Math.abs(played.transitionOrigin.x-46.666666666666664)<.001);assert.equal(played.transitionOrigin.y,66);
  result=h.snapshots.at(-1);assert.equal(result.presentation.phase,'scatter');assert.equal(Object.hasOwn(result.presentation,'transitionOrigin'),false);assert.equal(Object.hasOwn(result.presentation,'playTransition'),false);h.handle.cleanup();
  const restored=receiptStage({characterId:()=>state.charId,mutate:()=>{throw Error('restore must not summon');}},{saved:result});assert.equal(restored.mountOptions[0].playTransition,false);assert.equal(restored.mountOptions[0].transitionOrigin,null);assert.equal(restored.snapshots.at(-1).presentation.phase,'selection');assert.equal(restored.button.disabled,false);assert.match(restored.planning.textContent,/點選神羽/);restored.handle.cleanup();
});
