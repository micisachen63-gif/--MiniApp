/* Segmented Chrome F1 acceptance. Every original submission is saved before UI
 * assertions. Claimed mutation cases cannot be replayed; receipt-only reads an
 * exact retained run. No seeded completed lives, gift results or RNG overrides. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),base=path.join(repo,'.release-sync/fate-f1-20261105'),sha=v=>crypto.createHash('sha256').update(v).digest('hex'),q=v=>JSON.stringify(String(v));
const args=new Map();
for(const input of process.argv.slice(2)){
  const m=/^--(case|run-id|previous-run|bridge-run|resume-run|recovery-plan|campaign|campaign-plan)=([A-Za-z0-9][A-Za-z0-9_.-]{0,110})$/.exec(input);
  assert(m&&!args.has(m[1]),'Use --case=... --run-id=... [--previous-run=...] [--bridge-run=...]');args.set(m[1],m[2]);
}
assert(!args.has('resume-run'),'Whole mutation-case replay is forbidden; inspect original evidence and use an explicit receipt-only bridge');
const selected=args.get('case')||'layout';
const campaign=args.get('campaign')||null;assert(Boolean(campaign)===args.has('campaign-plan'),'A fresh campaign requires its explicit root authority plan');
const campaignRoot=campaign?path.join(base,'campaigns',campaign):base;
const cases=['layout','pure','life1','life1-tail','life2','life3','life4-night','archive-keep-unsent','gift-claim','gift-open-lost','scope','receipt-only','gallery'];
assert(cases.includes(selected),'Unknown F1 case');
const readOnly=['layout','pure','scope','receipt-only','gallery'].includes(selected);
assert(!args.has('bridge-run')||['receipt-only','life1-tail'].includes(selected),'A bridge is an exact original evidence inspection');
assert(!args.has('recovery-plan')||selected==='life1-tail','Only an explicit life1 tail accepts a recovery plan');
assert(selected!=='life1-tail'||args.has('bridge-run')&&args.has('recovery-plan'),'life1-tail requires exact original bridge and approved recovery plan');
assert(selected!=='receipt-only'||args.has('bridge-run'),'receipt-only requires original --bridge-run');
const local=value=>{const u=new URL(value);assert(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password&&Number(u.port)>=1024,'Loopback only');return u.origin;};
const origin=local(process.env.FATE_SCENE_ORIGIN||'http://127.0.0.1:9793'),api=local(process.env.FATE_API_ORIGIN||'http://127.0.0.1:9792');assert.notEqual(origin,api);
const runId=args.get('run-id')||new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid,dir=path.join(campaignRoot,'browser',runId),route='fate/action-scoped';
const FRONT=['scene-fate-ui.js','scene-fate-ui.css','scene-fate-story.js','scene-live-session.js','scene-social-preview.js','scene-social-preview.css','scene-window-manager.js'];
const TOOLS=['fate-browser.cjs','fate-qa-fixture.mjs','atlas-local-preview.mjs','scene-live-preview.mjs','scene-preview-bindings.mjs'];
const FIELDS={start:['mode','country','showSign','socialInvite'],choice:['lifeId','index','answer'],keep:['code'],'gift-claim':['expectedMilestones'],'gift-open':['giftId']};
const REQUIRED_PREVIOUS={life2:'life1',life3:'life2','life4-night':'life3','archive-keep-unsent':'life4-night','gift-claim':'archive-keep-unsent','gift-open-lost':'gift-claim'};
function sources(){
  const listed=execFileSync('C:/Users/User/Documents/ChatGPT/tools/git/cmd/git.exe',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:repo,encoding:'utf8',maxBuffer:8*1024*1024}).split('\0').filter(Boolean);
  const files=[...new Set([...listed.filter(p=>/^worker\/(?:src|migrations|public\/fate)\//.test(p)&&/\.(?:[cm]?js|json|sql)$/.test(p)),...FRONT.map(p=>'worker/public/'+p),...TOOLS.map(p=>'worker/tools/'+p),...['d1-shim.js','client-request.js','realm-test-helpers.js'].map(p=>'worker/test/'+p)])].sort();
  return Object.fromEntries(files.map(p=>[p,sha(fs.readFileSync(path.join(repo,p)))]));
}
function playwright(){
  for(const p of [process.env.RPG_PLAYWRIGHT_MODULE,path.join(repo,'.release-sync/browser-tools/node_modules/playwright'),path.join(repo,'../star-journal-party-integration-20261104/.release-sync/browser-tools/node_modules/playwright'),path.join(repo,'../star-journal-skill-career-integration-20261104/.release-sync/browser-tools/node_modules/playwright'),'playwright',path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)){try{return require(require.resolve(p));}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}}
  throw Error('Existing Playwright installation is required');
}
function original(id){const file=path.join(campaignRoot,'browser',id,'results.json'),bytes=fs.readFileSync(file),value=JSON.parse(bytes);assert.equal(value.runId,id);return{file,sha256:sha(bytes),value};}
const prior=args.has('previous-run')?original(args.get('previous-run')):null,bridge=args.has('bridge-run')?original(args.get('bridge-run')):null;
if(REQUIRED_PREVIOUS[selected]){assert(prior,'Pass exact accepted --previous-run');assert.equal(prior.value.case,REQUIRED_PREVIOUS[selected]);assert.equal(prior.value.ok,true,'A failed run cannot authorize replay of its mutations');}
assert(!fs.existsSync(dir),'Never overwrite original QA evidence');fs.mkdirSync(dir,{recursive:true});
const evidence={schemaVersion:1,runId,case:selected==='life1-tail'?'life1':selected,segment:selected,campaign,origin,api,pid:process.pid,status:'starting',startedAt:new Date().toISOString(),realChrome:true,realLocalApi:true,productionAccess:false,randomness:'Original service RNG only; no seed/reroll override',clockMethod:'Explicit development clock and original Fate.sweep; original two active hours/90 seconds/night pause',checks:[],submissions:[],operations:[],clockCommands:[],directRequests:[],requests:[],screenshots:[],faults:[],pureReads:[],pageErrors:[],httpErrors:[],routeErrors:[],externalRequests:[],assetCaptureGaps:[],loadedSources:{},servedAssets:{}};
function save(file,value){fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');fs.renameSync(file+'.tmp',file);}
function persist(step){if(step)evidence.step=step;save(path.join(dir,'results.json'),evidence);save(path.join(dir,'progress.json'),{runId,status:evidence.status,step:evidence.step,updatedAt:new Date().toISOString(),operations:evidence.operations.length});save(path.join(campaignRoot,'browser/latest.json'),{runId,dir,status:evidence.status,step:evidence.step,updatedAt:new Date().toISOString()});}
const note=(name,detail={})=>{evidence.checks.push({name,passed:true,...detail});persist(name);console.log(JSON.stringify({check:name,passed:true}));};
function claim(){
  assert(!readOnly,'Read-only F1 case cannot mutate');
  if(evidence.claimed)return;
  const root=path.join(campaignRoot,'case-claims');fs.mkdirSync(root,{recursive:true});
  fs.writeFileSync(path.join(root,selected+'.json'),JSON.stringify({case:selected,runId,campaign,apiPid:evidence.health.api.pid,fixtureInitialInputSha256:evidence.fixture.initialInputSha256,campaignAuthoritySha256:evidence.campaignAuthority?.sha256||null,startedAt:new Date().toISOString(),policy:'Never replay after partial success. Inspect exact originals first.'},null,2)+'\n',{flag:'wx'});
  evidence.claimed=true;persist('mutation case claimed once');
}
function canonical(body,actor){
  assert(body&&typeof body==='object'&&!Array.isArray(body)&&FIELDS[body.kind],'Exact canonical body required');
  assert.deepEqual(Object.keys(body).sort(),['kind','requestId','realmId','selectedCharacterId',...FIELDS[body.kind]].sort(),'Every original field must be preserved');
  assert(/^[A-Za-z0-9_-]{8,64}$/.test(body.requestId));assert.equal(body.realmId,actor.realmId);assert.equal(body.selectedCharacterId,actor.characterId);
  if(body.kind==='start'){assert.equal(body.mode,'random');assert.equal(body.socialInvite,false);assert.equal(typeof body.showSign,'boolean');}
  if(body.kind==='choice'){assert([0,1].includes(body.answer));assert(Number.isSafeInteger(body.index)&&body.index>=0);}
}
function retiredCharacterGap(record,error,source){
  if(source||record.status<200||record.status>=300||!String(record.type||'').toLowerCase().startsWith('image/'))return false;
  let url;try{url=new URL(record.url);}catch{return false;}
  const msg=String(error?.message||'');
  return url.origin===origin&&url.pathname.startsWith('/ui-generated-20261030/characters-v1/assets/')&&/\.(png|webp)$/i.test(url.pathname)&&msg.includes('Network.getResponseBody')&&msg.includes('No data found for resource with given identifier')&&msg.includes('Response body is not available for a response that was navigated away from');
}
async function deadline(promise,label,ms=30000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms);})]);}finally{clearTimeout(timer);}}
persist('before browser start');
(async()=>{
  let browser,page,frame,fixture,actor,main,alt,foreign,season,prepared=null,mainNavigations=0,expectedNavigations=0;
  const pendingAssets=[],expectedErrors=new Set(),writes=()=>evidence.requests.filter(r=>r.action===route);
  const state=async()=>{const r=await fetch(api+'/__preview/fate-qa/state',{signal:AbortSignal.timeout(20000)});assert.equal(r.status,200);return r.json();};
  const raw=(s,a)=>s[a.realmId==='season_2026_01'?'season':'permanent'];
  const amount=(s,a,item)=>raw(s,a).inventory.find(r=>String(r.tg_id)===a.characterId&&r.item===item)?.quantity||0;
  const ownLives=(s,a=main)=>raw(s,a).lives.filter(r=>String(r.char_id)===a.characterId);
  const action=name=>'[data-sf-action='+q(name)+']';
  const button=(name,attribute,value)=>frame.locator(action(name)+(attribute?'['+attribute+'='+q(value)+']':''));
  const raf=()=>frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  async function ready(){
    await frame.waitForFunction(()=>{const root=document.querySelector('.sf-window'),b=root?.querySelector('[data-sf-action="refresh"]');return root&&b&&!b.disabled&&b.textContent.trim()==='重新整理';});
    await raf();
  }
  async function single(){assert.equal(await frame.locator('.scene-unified-dialog').count(),1);assert.equal(page.context().pages().length,1);assert.equal(mainNavigations,expectedNavigations);}
  async function shot(name){const file=name+'.png';await page.screenshot({path:path.join(dir,file),fullPage:true});evidence.screenshots.push({name,file,sha256:sha(fs.readFileSync(path.join(dir,file)))});persist();}
  async function setTab(tab){const entry=frame.locator('.sf-tabs '+action('tab')+'[data-sf-tab='+q(tab)+']');if(await entry.getAttribute('aria-selected')!=='true')await entry.click();await frame.waitForFunction(t=>document.querySelector('.sf-tabs [data-sf-tab="'+t+'"]')?.getAttribute('aria-selected')==='true',tab);await ready();}
  async function open(tab='overview'){await frame.evaluate(t=>window.RpgSceneNavigation.navigate('fate',{tab:t}),tab);await frame.waitForFunction(()=>document.querySelector('.scene-unified-dialog')?.dataset.route==='fate');await ready();await setTab(tab);await single();}
  async function refresh(){await button('refresh').click();await ready();}
  async function choose(next){
    let ctx=await frame.evaluate(()=>window.RpgSceneSession.getContext());
    if(String(ctx.accountId)!==next.accountId||ctx.realmId!==next.realmId){await frame.evaluate(async a=>{window.RpgSceneSession.setContext({accountId:a.accountId,realmId:a.realmId,characterId:null});await window.RpgSceneSession.refresh({force:true});},next);ctx=await frame.evaluate(()=>window.RpgSceneSession.getContext());}
    if(String(ctx.characterId)!==next.characterId){
      await frame.locator('[data-scene-primary="character"]').click();
      await frame.locator('[data-scene-route="characters"]').click();
      const entry=frame.locator('.scene-social-body button.scene-atlas-entry').filter({hasText:next.name});await entry.waitFor();assert.equal(await entry.count(),1);await entry.click();
    }
    await frame.waitForFunction(id=>String(window.RpgSceneSession.getSnapshot()?.characterId)===id,next.characterId);actor=next;await raf();
  }
  async function rpc(who,endpoint,body={},expectedStatus=200){
    assert(endpoint!==route,'Original accepted F1 mutations must use visible UI controls');
    const payload={...body,realmId:who.realmId,selectedCharacterId:who.characterId},entry={endpoint,actor:{...who},body:payload,state:'sending'};evidence.directRequests.push(entry);persist('before pure '+endpoint);
    const r=await fetch(api+'/app/api/'+endpoint,{method:'POST',headers:{'content-type':'application/json','x-dev-tg-id':who.accountId,'x-realm-id':who.realmId},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)}),result=await r.json();
    Object.assign(entry,{status:r.status,result,state:'completed'});persist();assert.equal(r.status,expectedStatus,JSON.stringify(result));if(expectedStatus===200)assert.equal(result.ok,true);return result;
  }
  async function pure(label,who=actor,query={},bodies=[]){
    const before=await state(),n=writes().length;assert.equal(before.commandInFlight,null);let projection;
    for(let i=0;i<2;i++){projection=await rpc(who,'fate/scene',query);for(const body of bodies)await rpc(who,'fate/receipt',body);}
    const after=await state();assert.deepEqual(after.databases,before.databases,label+' preserves all tables, total_changes and outbox in both realms');assert.equal(writes().length,n);
    evidence.pureReads.push({label,actor:{...who},before:before.databases,after:after.databases,tableCounts:Object.fromEntries(Object.entries(before.databases).map(([k,v])=>[k,v.tableNames.length]))});persist();return projection;
  }
  async function geometry(label){
    const g=await frame.evaluate(()=>{
      const card=document.querySelector('.scene-social-card'),body=document.querySelector('.scene-social-body'),root=document.querySelector('.sf-window');
      return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,card:card.getBoundingClientRect().toJSON(),bodyWidth:body.clientWidth,bodyScrollWidth:body.scrollWidth,controls:[...root.querySelectorAll('button,select,input,summary')].map(el=>{const target=el.type==='checkbox'?(el.closest('label')||el):el;return {name:el.getAttribute('data-sf-action')||el.getAttribute('data-sf-field')||el.tagName,rect:target.getBoundingClientRect().toJSON()};}).filter(r=>r.rect.width&&r.rect.height)};
    });
    assert(g.card.left>=-1&&g.card.right<=g.viewport+1,label+' fits viewport');assert(g.scrollWidth<=g.viewport+1&&g.bodyScrollWidth<=g.bodyWidth+1,label+' no horizontal overflow');
    for(const c of g.controls){assert(c.rect.width>=43.5,label+' target width '+JSON.stringify(c));assert(c.rect.height>=43.5,label+' target height '+JSON.stringify(c));}
    await single();return g;
  }
  async function confirmation(){
    await frame.locator('[data-sf-confirm]').waitFor();await raf();
    const r=await frame.evaluate(()=>{const p=document.querySelector('[data-sf-confirm]'),body=document.querySelector('.scene-social-body'),r=p.getBoundingClientRect(),v=body.getBoundingClientRect();return {text:p.textContent,visible:r.top>=Math.max(0,v.top)-1&&r.bottom<=Math.min(innerHeight,v.bottom)+1,cancelFocused:document.activeElement===p.querySelector('[data-sf-action="cancel"]')};});
    assert(r.visible,'Confirmation visible');assert(r.cancelFocused,'Cancel has initial focus');return r;
  }
  async function stage(entry){
    await entry.click();await confirmation();const n=writes().length;await button('cancel').click();await raf();assert.equal(writes().length,n);assert(await entry.evaluate(e=>e===document.activeElement),'Cancel restores exact source action focus');
    await entry.press('Enter');const c=await confirmation();evidence.confirmations??=[];evidence.confirmations.push(c);await shot('confirm-'+evidence.confirmations.length);
  }
  function prepare(before,label){const s={label,actor:{...actor},before,body:null,state:'prepared-before-send',preparedAt:new Date().toISOString()};evidence.submissions.push(s);prepared=s;persist('before original UI send '+label);return s;}
  function verifyOriginal(op){
    const a=op.actor,b=op.body,value=op.result.result,before=raw(op.before,a),after=raw(op.after,a),key='scene:app:'+b.requestId;
    canonical(b,a);
    assert.equal(op.result.requestId,b.requestId);assert.equal(op.result.kind,b.kind);assert.equal(String(op.result.characterId),a.characterId);assert.equal(op.result.realmId,a.realmId);
    const table=b.kind.startsWith('gift-')?after.giftOperations:after.operations;
    const original=table.find(r=>String(r.account_id)===a.accountId&&r.request_id===key);assert(original,'Exact original operation exists');assert.deepEqual(JSON.parse(original.result_json),value,'Immutable original result matches');
    const ledger=after.ledger.find(r=>r.event_id==='fate-scene-receipt:'+a.characterId+':'+key);
    assert(ledger,'Exact typed ledger is atomic with original operation');assert.equal(ledger.type,'命運場景操作收據');
    const typed=JSON.parse(ledger.note);assert.equal(typed.kind,b.kind);assert.equal(typed.signature,op.result.signature);assert.deepEqual(typed.result,value);assert.equal(typed.scope.accountId,a.accountId);assert.equal(typed.scope.characterId,a.characterId);assert.equal(typed.scope.realmId,a.realmId);
    const expectedReceipt={version:1,kind:b.kind,requestId:b.requestId,requestKey:key,signature:typed.signature,scope:typed.scope,createdAt:typed.createdAt,result:value,costs:typed.costs,authority:{family:b.kind.startsWith('gift-')?'gift-operations':'life-operations',requestKey:key},...(typed.proof?{proof:typed.proof}:{})};
    assert.deepEqual(op.result.receipt,expectedReceipt,'Exported receipt retains exact typed result and derived authority metadata');op.authority={requestKey:key,originalOperation:original,typedLedger:ledger};
    if(b.kind==='start'){
      const row=after.lives.find(r=>r.id===value.lifeId);assert(row&&String(row.char_id)===a.characterId&&String(row.account_id)===a.accountId);
      const d=JSON.parse(row.state_json);assert.equal(d.country,b.country);assert.equal(d.version,b.country==='TW'?8:9);assert(/^[a-f0-9]{8}$/.test(d.seed));if(!b.showSign)assert.equal(d.zodiac,null);
      if(!value.already){assert.equal(after.lives.length,before.lives.length+1);const day=new Date(row.started_at+8*3600000).toISOString().slice(0,10);assert.equal(after.starts.find(x=>String(x.account_id)===a.accountId&&x.day===day).count,(before.starts.find(x=>String(x.account_id)===a.accountId&&x.day===day)?.count||0)+1);}
    }else if(b.kind==='choice'){
      const row=after.lives.find(r=>r.id===b.lifeId),d=JSON.parse(row.state_json);assert.equal(value.lifeId,b.lifeId);assert.equal(value.index,b.index);assert.equal(value.answer,b.answer);assert.equal(d.answers[b.index],b.answer);assert.equal(d.sources[b.index],'manual');
    }else if(b.kind==='keep'){
      assert.equal(value.saved,true);assert.equal(value.countsAsLife,false);assert(after.memorials.some(r=>String(r.char_id)===a.characterId&&r.code===b.code));assert.equal(after.lives.length,before.lives.length);assert.deepEqual(after.starts,before.starts);assert.deepEqual(after.inventory,before.inventory);
    }else if(b.kind==='gift-claim'){
      assert.equal(value.claimed,b.expectedMilestones.length);assert.equal(value.giftIds.length,value.claimed);
      for(const [i,id]of value.giftIds.entries()){const gift=after.gifts.find(r=>r.id===id);assert(gift&&String(gift.char_id)===a.characterId);assert.equal(gift.milestone,b.expectedMilestones[i]);assert.equal(gift.status,'claimed');const l=after.ledger.filter(r=>r.event_id==='fate-gift:claim:'+id);assert.equal(l.length,1);assert.equal(l[0].item,'fate_cycle_gift');assert.equal(l[0].item_delta,1);}
      assert.equal(amount(op.after,a,'fate_cycle_gift')-amount(op.before,a,'fate_cycle_gift'),value.claimed);
    }else if(b.kind==='gift-open'){
      assert.equal(value.giftId,b.giftId);const gift=after.gifts.find(r=>r.id===b.giftId);assert.equal(gift.status,'opened');assert.deepEqual(JSON.parse(gift.rewards_json),value.items);
      const consume=after.ledger.filter(r=>r.event_id==='fate-gift:consume:'+b.giftId);assert.equal(consume.length,1);assert.equal(consume[0].item_delta,-1);assert.equal(amount(op.after,a,'fate_cycle_gift')-amount(op.before,a,'fate_cycle_gift'),-1);
      for(const [item,qty]of Object.entries(value.items)){const reward=after.ledger.filter(r=>r.event_id==='fate-gift:open:'+b.giftId+':'+item);assert.equal(reward.length,1);assert.equal(reward[0].item_delta,qty);assert.equal(amount(op.after,a,item)-amount(op.before,a,item),qty);}
      assert.deepEqual(value.items,value.reward==='weapon'?{guaranteed_scroll_w:1}:value.reward==='armor'?{guaranteed_scroll_a:1}:{scroll_w:2,scroll_a:2});assert(['weapon','armor','scrolls'].includes(value.reward));
    }
  }
  async function capture(body,result,before,label,status=200,capturedActor=prepared.actor){
    const op={label,body,result,status,actor:{...capturedActor},before,after:null,recordedAt:new Date().toISOString()};evidence.operations.push(op);
    if(prepared?.body?.requestId===body.requestId){prepared.state='original-response-saved';prepared.operationIndex=evidence.operations.length-1;}persist('original response saved '+label);
    op.after=await state();persist('original DB snapshot saved '+label);assert.equal(status,200,JSON.stringify(result));assert.equal(result.ok,true);verifyOriginal(op);persist('original authority verified '+label);return op;
  }
  async function submit(entry,label,{stageFirst=true}={}){
    if(stageFirst)await stage(entry);claim();const before=await state(),who={...actor},waiting=page.waitForResponse(r=>r.url()===api+'/app/api/'+route&&r.request().method()==='POST');
    prepare(before,label);await button('confirm').click();const response=await waiting,body=response.request().postDataJSON(),rawResponse=await response.text();Object.assign(prepared,{rawResponse,httpStatus:response.status()});persist('exact original raw response saved');const result=JSON.parse(rawResponse),op=await capture(body,result,before,label,response.status(),who);await ready();return op;
  }
  async function verifyReceipt(op){
    const before=await state(),r=await rpc(op.actor,'fate/receipt',op.body),after=await state();assert.deepEqual(after.databases,before.databases,'Receipt is SELECT-only');assert.equal(r.found,true);assert.deepEqual(r.result,op.result.result);assert.deepEqual(r.receipt,op.result.receipt);assert.equal(r.signature,op.result.signature);op.queriedReceipt=r;persist('original receipt verified');return r;
  }
  async function command(op,lifeId,index){
    claim();const before=await state(),input={requestId:'qa-'+crypto.randomUUID(),op,expectedNow:before.qaClock.now,...(lifeId?{lifeId}:{}),...(index===undefined?{}:{index})};
    const r={input,before,state:'sending'};evidence.clockCommands.push(r);persist('before original clock/sweep '+op);
    const response=await fetch(api+'/__preview/fate-qa/advance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(30000)}),text=await response.text();r.httpStatus=response.status;r.rawResponse=text;persist('clock/sweep original response saved');
    r.result=JSON.parse(text);r.after=await state();r.state='completed';persist();assert.equal(response.status,200,text);assert.equal(r.result.originalLifeMs,7200000);assert.equal(r.result.originalChoiceMs,90000);assert.equal(r.result.deadlinesUnmodified,true);return r;
  }
  async function startLife(country,showSign){
    await open('overview');await frame.locator('[data-sf-field="country"]').selectOption(country);await frame.locator('[data-sf-field="showSign"]').setChecked(showSign);
    const op=await submit(button('start'),'Original '+country+' random life');await verifyReceipt(op);assert.equal(op.body.country,country);assert.equal(op.body.showSign,showSign);assert(!op.result.result.already,'This is the sole first start, not a replay');return op.result.result.lifeId;
  }
  async function manual(lifeId,answer){
    const move=await command('choice-open',lifeId);await open('current');await refresh();
    const view=await pure('At original choice opening');assert.equal(view.fate.state.active.id,lifeId);assert.equal(view.fate.state.active.timing.available,true);
    const index=view.fate.state.active.timing.index;
    const op=await submit(frame.locator(action('choice')+'[data-sf-index='+q(index)+'][data-sf-answer='+q(answer)+']'),'Original manual answer '+answer);
    await verifyReceipt(op);await shot('390-manual-'+answer);return move;
  }
  async function complete(lifeId,expectedCompleted){
    await command('end',lifeId);
    const before=await state(),view=await pure('Overdue life is projected without settlement');
    assert.equal(view.fate.state.active.id,lifeId);assert.equal(view.fate.state.active.timing.completionDue,true);assert.equal(view.fate.state.completed,expectedCompleted-1);
    assert.equal(ownLives(before).filter(r=>r.status==='complete').length,expectedCompleted-1);
    await command('sweep',lifeId);
    const after=await state();assert.equal(ownLives(after).filter(r=>r.status==='complete').length,expectedCompleted);assert.equal(ownLives(after).filter(r=>r.status==='active').length,0);
    const done=ownLives(after).find(r=>r.id===lifeId);assert(done.code);assert.equal(done.status,'complete');assert.equal(done.completed_at,after.lifeTiming.find(r=>r.lifeId===lifeId).endAt);
    const current=await pure('Original sweep persisted completed life');assert.equal(current.fate.state.completed,expectedCompleted);assert.equal(current.fate.state.active,null);
    await open('archive');await button('view-life','data-sf-life-id',lifeId).click();await frame.locator('[data-sf-story-result]').waitFor();await geometry('Original completed story '+expectedCompleted);await shot('390-completed-'+expectedCompleted);note('Original life '+expectedCompleted+' completed through untouched Fate.sweep and rendered by the original story helpers',{lifeId,code:done.code,completedAt:done.completed_at});
  }
  async function rejectStart(who,expectedError){
    await choose(who);await open();const projection=await pure('Blocked start projection',who);assert.equal(projection.fate.control.startAllowed,false);
    if(await button('start').count())assert(await button('start').isDisabled(),'UI start is disabled for authoritative block');
    const body={kind:'start',requestId:'qa_reject_'+crypto.randomUUID().replaceAll('-',''),realmId:who.realmId,selectedCharacterId:who.characterId,mode:'random',country:'TW',showSign:true,socialInvite:false};
    const before=await state(),record={actor:{...who},body,expectedError,state:'sending'};evidence.rejectedSubmissions??=[];evidence.rejectedSubmissions.push(record);persist('before exact rejected start probe');
    const response=await fetch(api+'/app/api/'+route,{method:'POST',headers:{'content-type':'application/json','x-dev-tg-id':who.accountId,'x-realm-id':who.realmId},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)}),result=await response.json();
    Object.assign(record,{status:response.status,result,state:'completed'});persist();assert.equal(result.ok,false);assert.equal(result.error,expectedError);assert.deepEqual((await state()).databases,before.databases,'Rejected fresh-alt start makes no writes');
    await choose(main);await open('current');
  }
  async function lifeCase(){
    const n=selected==='life1'?1:selected==='life2'?2:selected==='life3'?3:4;
    const before=await state();assert.equal(ownLives(before).length,n-1);assert.equal(ownLives(before).filter(r=>r.status==='active').length,0);assert.equal(before.commandInFlight,null);
    if(n===4)await command('evening');
    const lifeId=await startLife(n===2?'JP':'TW',n!==2);evidence.lifeId=lifeId;persist('exact original life retained');
    if(n===1||n===2)await manual(lifeId,n===1?0:1);
    else if(n===3){
      await command('choice-open',lifeId);let p=await pure('Original timeout event opening'),index=p.fate.state.active.timing.index;const persisted=p.fate.state.active.draft.answers.length;
      await command('choice-before-deadline',lifeId,index);p=await pure('One millisecond before original 90 second deadline');assert.equal(p.fate.state.active.timing.available,true);
      await command('choice-deadline',lifeId,index);p=await pure('At original deadline no auto-answer has been persisted');assert.equal(p.fate.state.active.draft.answers.length,persisted);assert.equal(p.fate.state.active.timing.settlementPending,true);
      await command('sweep',lifeId);const row=ownLives(await state()).find(r=>r.id===lifeId),draft=JSON.parse(row.state_json);assert.equal(draft.sources[index],'auto');await open('current');await shot('390-original-timeout');note('Original 90-second timeout committed once',{lifeId,index,answer:draft.answers[index]});
    }else{
      await rejectStart(alt,'fate_limit');
      await command('midnight');let p=await pure('Midnight life remains uncommitted and paused');assert.equal(p.fate.state.night,true);
      const midnight=(await state()).lifeTiming.find(r=>r.lifeId===lifeId);
      await rejectStart(alt,'fate_night');
      await command('before-dawn');const beforeDawn=(await state()).lifeTiming.find(r=>r.lifeId===lifeId);assert.equal(beforeDawn.activeElapsedMs,midnight.activeElapsedMs);await pure('Night pure reads preserve both worlds');
      await open('current');await shot('390-night-pause');
      await command('dawn');const dawn=(await state()).lifeTiming.find(r=>r.lifeId===lifeId);assert.equal(dawn.activeElapsedMs,midnight.activeElapsedMs);assert.equal(dawn.endAt,Date.parse('2026-11-06T07:35:00+08:00'));note('Original night pause and account-wide 4-start limit',{lifeId,midnight,dawn});
    }
    await complete(lifeId,n);
  }
  async function pendingReady(id){await frame.locator('[data-sf-pending]').filter({has:frame.locator(action('check-pending')+'[data-sf-pending-id='+q(id)+']')}).waitFor();await frame.waitForFunction(id=>{const b=document.querySelector('[data-sf-action="check-pending"][data-sf-pending-id="'+id+'"]');return b&&!b.disabled&&b.textContent.trim()!=='核對中…';},id);await raf();}
  async function lost(entry,label,unsent=false){
    await stage(entry);claim();const before=await state(),who={...actor};let used=false,body,op,resolve,reject;
    const completion=new Promise((a,b)=>{resolve=a;reject=b;});completion.catch(()=>{});
    const fault={label,type:unsent?'not-sent':'committed-response-lost',before,actor:who,state:'armed'};evidence.faults.push(fault);persist();
    const handler=async request=>{
      if(used)return request.continue();used=true;body=request.request().postDataJSON();fault.body=body;fault.state='intercepted';persist('exact unknown body retained');
      try{
        if(!unsent){const response=await request.fetch({maxRetries:0,timeout:20000}),rawResponse=await response.text();Object.assign(fault,{rawResponse,httpStatus:response.status()});persist('lost original raw response saved');const result=JSON.parse(rawResponse);op=await capture(body,result,before,label,response.status(),who);fault.operationIndex=evidence.operations.length-1;fault.state='original-commit-saved';persist();}
        await request.abort('failed');fault.state='unknown-delivered';persist();resolve();
      }catch(error){fault.error=error.message;persist();reject(error);try{await request.abort('failed');}catch{}}
    };
    await page.route(api+'/app/api/'+route,handler);
    try{prepare(before,label);await button('confirm').click();await deadline(completion,'Original lost-response capture');await pendingReady(body.requestId);}finally{await page.unroute(api+'/app/api/'+route,handler);}
    assert.equal(writes().filter(r=>r.body.requestId===body.requestId).length,1);fault.after=await state();if(unsent)assert.deepEqual(fault.after.databases,before.databases);persist();return{body,op,fault};
  }
  async function checkPending(body,found){
    const before=await state(),n=writes().length,waiting=page.waitForResponse(r=>r.url()===api+'/app/api/fate/receipt'&&r.request().method()==='POST');
    await button('check-pending','data-sf-pending-id',body.requestId).click();const response=await waiting,result=await response.json();assert.equal(response.status(),200);assert.equal(result.found,found);assert.equal(writes().length,n);assert.deepEqual((await state()).databases,before.databases);persist('Unknown original checked without mutation');return result;
  }
  async function unknownRemount(body){
    await choose(alt);await open();assert.equal(await button('check-pending','data-sf-pending-id',body.requestId).count(),0,'Other character never inherits pending');
    await choose(main);await open('history');await pendingReady(body.requestId);
    const n=writes().length;await frame.evaluate(()=>window.RpgSceneNavigation.navigate('inventory'));await open('history');await pendingReady(body.requestId);assert.equal(writes().length,n,'Remount never resends unknown');
    await shot('390-unknown-remounted');
  }
  async function archiveKeep(){
    await open('archive');const before=await state(),life=ownLives(before).find(r=>r.status==='complete');assert(life?.code);
    const result=await lost(button('keep','data-sf-code',life.code),'Original memorial keep never sent',true);
    await unknownRemount(result.body);const receipt=await checkPending(result.body,false);assert.equal(receipt.recoveryAllowed,true);
    const originalBody=JSON.stringify(result.body);await button('retry','data-sf-pending-id',result.body.requestId).click();await confirmation();
    const op=await submit(null,'Explicit same-ID original memorial recovery',{stageFirst:false});assert.equal(JSON.stringify(op.body),originalBody);await verifyReceipt(op);
    assert.equal(ownLives(await state()).filter(r=>r.status==='complete').length,4);await shot('390-memorial-recovered');note('Memorial keep is cosmetic and unsent intent recovers once with the original full body');
  }
  async function giftClaim(){
    await open('gifts');const projection=await pure('Four actual completed lives make one exact gift');assert.equal(projection.fate.gifts.completed,4);assert.deepEqual(projection.fate.gifts.claimMilestones,[4]);assert.equal(projection.fate.gifts.claimable,1);
    const op=await submit(button('claim'),'Original four-life milestone claim');assert.deepEqual(op.body.expectedMilestones,[4]);assert.equal(op.result.result.claimed,1);await verifyReceipt(op);evidence.giftId=op.result.result.giftIds[0];await shot('390-original-gift-claim');note('Exactly four original lives grant one original gift',{giftId:evidence.giftId});
  }
  async function giftOpen(){
    const before=await state(),gifts=raw(before,main).gifts.filter(r=>String(r.char_id)===main.characterId&&r.status==='claimed');assert.equal(gifts.length,1);await open('gifts');
    const result=await lost(button('open','data-sf-gift-id',gifts[0].id),'Original gift open committed with response lost',false);
    await unknownRemount(result.body);const receipt=await checkPending(result.body,true);assert.deepEqual(receipt.result,result.op.result.result);assert.deepEqual(receipt.receipt,result.op.result.receipt);
    const receiptBeforeClock=await state();await command('evening');assert.deepEqual((await state()).databases,receiptBeforeClock.databases,'Only the labelled development clock advances after finding an immutable receipt');
    await pure('Later pure projection keeps the original gift receipt valid',main,{},[result.body]);await refresh();await pendingReady(result.body.requestId);
    const n=writes().length;await button('acknowledge','data-sf-pending-id',result.body.requestId).click();await button('check-pending','data-sf-pending-id',result.body.requestId).waitFor({state:'detached'});assert.equal(writes().length,n);
    await verifyReceipt(result.op);const after=await state();assert.equal(raw(after,main).gifts.filter(r=>r.status==='opened').length,1);assert.equal(amount(after,main,'fate_cycle_gift'),0);
    assert.equal(writes().filter(r=>r.body.requestId===result.body.requestId).length,1,'No second gift opening POST');await open('gifts');await shot('390-original-gift-recovered');note('Lost gift result recovered without reroll or second consumption',{giftId:gifts[0].id,result:result.op.result.result});
  }
  async function layouts(){
    for(const [width,height]of [[320,740],[390,844],[1280,900]]){
      await page.setViewportSize({width,height});await raf();
      for(const tab of ['overview','current','archive','gifts','history']){await open(tab);await geometry(width+' '+tab);}
      await setTab(width===320?'overview':width===390?'gifts':'archive');await shot(width+'-layout');note(width+' shared-window layouts and controls fit');
    }
    await page.setViewportSize({width:390,height:844});await open('overview');
    const n=writes().length;await stage(button('start'));await button('cancel').click();assert.equal(writes().length,n);note('Keyboard opens confirmation; cancel starts focused and returns to its exact control');
  }
  async function pureCases(){
    await open();const p=await pure('Current account initial projection');assert.equal(p.fate.state.completed,0);assert.equal(p.fate.state.active,null);assert.equal(p.fate.gifts.claimable,0);
    await pure('Frozen empty realm remains read-only',season);await pure('Different account remains independent',foreign);note('F1 pure projections preserve both complete databases');
  }
  async function scopeCase(){
    await open('archive');const current=await pure('Completed original actor');
    await choose(alt);await open('archive');const other=await pure('Same account different character');assert.equal(other.fate.state.completed,0);assert.equal(other.fate.gifts.completed,0);assert.equal(other.fate.gifts.claimable,0);
    await choose(main);await open('archive');const again=await pure('A to B to A exact archive restored');assert.equal(again.fate.state.completed,current.fate.state.completed);
    await choose(season);await open('overview');const frozen=await pure('Frozen realm never advances original Fate');assert.equal(frozen.fate.control.writable,false);assert(await button('start').isDisabled());await shot('390-frozen-realm');
    await choose(foreign);await open('archive');const stranger=await pure('Other account cannot inherit original histories');assert.equal(stranger.fate.state.completed,0);assert.equal(stranger.fate.gifts.completed,0);
    await choose(main);await open('archive');
    const before=await state(),n=writes().length;await rpc({...foreign,characterId:main.characterId},'fate/scene',{},409);assert.deepEqual((await state()).databases,before.databases);assert.equal(writes().length,n);note('Realm/account/current-character scope and A-B-A isolation verified');
  }
  async function verifyCampaign(){
    if(!campaign)return;
    const planPath=path.join(base,'campaign-authority',args.get('campaign-plan')+'.json'),planBytes=fs.readFileSync(planPath),plan=JSON.parse(planBytes);
    assert.equal(plan.schemaVersion,1);assert.equal(plan.status,'approved-fresh-fate-campaign');assert.equal(plan.campaignId,campaign);assert.equal(plan.restoredDatabase,false);assert.equal(plan.oldStartsCountTowardFourLives,false);
    assert.equal(plan.apiPid,evidence.health.api.pid);assert.equal(plan.fixtureInitialInputSha256,fixture.initialInputSha256);assert.equal(evidence.health.ui.apiOwned,false);assert.equal(evidence.health.ui.attachedApi,true,'New campaign API must be independently owned');
    const owned=file=>{assert(typeof file==='string'&&!file.includes('\\\\'));const target=path.resolve(base,file),relative=path.relative(base,target);assert(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));return target;};
    const initialPath=owned(plan.initialStateFile),initialBytes=fs.readFileSync(initialPath),initial=JSON.parse(initialBytes);assert.equal(sha(initialBytes),plan.initialStateSha256);
    assert.equal(initial.campaignId,campaign);assert.equal(initial.apiPid,plan.apiPid);assert.equal(initial.state.initialInputSha256,fixture.initialInputSha256);assert.equal(initial.state.qaClock.now,plan.initialClockNow);assert.equal(initial.state.commandInFlight,null);
    for(const realm of ['permanent','season']){
      for(const key of ['lives','starts','memorials','operations','gifts','giftOperations','social'])assert.deepEqual(initial.state[realm][key],[],'New campaign begins with zero '+realm+' '+key);
      assert.equal(initial.state[realm].ledger.filter(row=>row.type==='命運場景操作收據').length,0);
    }
    assert.match(plan.candidateFreezeFile,/^candidate-source-freeze-[0-9]+\.json$/);const freezeBytes=fs.readFileSync(owned(plan.candidateFreezeFile)),frozen=JSON.parse(freezeBytes);assert.equal(sha(freezeBytes),plan.candidateFreezeSha256);
    const frozenSources=Object.fromEntries(frozen.sources.map(row=>[row.path,row.sha256]));for(const [file,hash]of Object.entries(evidence.sourceSHA256Before))assert.equal(hash,frozenSources[file],'Exact fresh candidate '+file);
    const bouncePath=owned(plan.emptyBounceFile),bounceBytes=fs.readFileSync(bouncePath),bounce=JSON.parse(bounceBytes);assert.equal(sha(bounceBytes),plan.emptyBounceSha256);assert.equal(bounce.status,'passed-empty-independent-api-bounce');assert.equal(bounce.campaignId,campaign);assert.equal(bounce.apiPid,plan.apiPid);assert.equal(bounce.fixtureInitialInputSha256,fixture.initialInputSha256);assert.equal(bounce.dbClockPreserved,true);assert.equal(bounce.zeroFateOutcomes,true);
    const excluded=plan.excludedOriginal;assert(excluded&&excluded.runId&&excluded.resultsFile&&excluded.resultsSha256);const oldBytes=fs.readFileSync(owned(excluded.resultsFile)),old=JSON.parse(oldBytes);assert.equal(sha(oldBytes),excluded.resultsSha256);assert.equal(old.runId,excluded.runId);assert.equal(old.ok,false);assert.notEqual(old.health.api.pid,plan.apiPid);assert.notEqual(old.fixture.initialInputSha256,fixture.initialInputSha256);
    assert.equal(plan.inputSnapshotId,evidence.inputSnapshot.id);
    if(prior){assert.equal(prior.value.campaign,campaign);assert.equal(prior.value.campaignAuthority.sha256,sha(planBytes));assert.equal(prior.value.ok,true,'Failed campaign segments cannot authorize replay');}
    else{assert.deepEqual(fixture.databases,initial.state.databases,'A campaign without a predecessor must still be at its exact empty baseline');assert.equal(fixture.qaClock.now,initial.state.qaClock.now);}
    evidence.campaignAuthority={path:planPath,sha256:sha(planBytes),candidateFreezeFile:plan.candidateFreezeFile,candidateFreezeSha256:plan.candidateFreezeSha256,initialStateFile:initialPath,initialStateSha256:sha(initialBytes),emptyBounceFile:bouncePath,emptyBounceSha256:sha(bounceBytes),excludedOriginal:excluded,restoredDatabase:false,oldStartsCountTowardFourLives:false};
    persist('Explicit fresh campaign authority, empty baseline and independent API ownership verified');
  }
  async function life1Tail(){
    const planPath=path.join(base,'recovery-authority',args.get('recovery-plan')+'.json'),planBytes=fs.readFileSync(planPath),plan=JSON.parse(planBytes);
    assert.equal(plan.schemaVersion,1);assert.equal(plan.status,'approved-life1-tail');
    assert.equal(bridge.value.runId,plan.originalRun);assert.equal(bridge.sha256,plan.originalResultsSha256);assert.equal(bridge.value.case,'life1');assert.equal(bridge.value.ok,false,'Original failed evidence must stay failed');
    assert.equal(bridge.value.health.api.pid,plan.apiPid);assert.equal(evidence.health.api.pid,plan.apiPid);assert.equal(fixture.initialInputSha256,plan.fixtureInitialInputSha256);assert.equal(bridge.value.fixture.initialInputSha256,plan.fixtureInitialInputSha256);
    assert.deepEqual(fixture.databases,bridge.value.finalState.databases,'No operation changed either original database after the failed attempt');assert.equal(fixture.qaClock.now,plan.clockNow);assert.equal(fixture.qaClock.now,bridge.value.finalState.qaClock.now);assert.equal(fixture.commandInFlight,null);
    assert.equal(evidence.inputSnapshot.id,bridge.value.inputSnapshot.id,'The exact original nine composed text inputs remain pinned');
    assert.match(plan.candidateFreezeFile,/^candidate-source-freeze-[0-9]+\.json$/);
    const freezePath=path.join(base,plan.candidateFreezeFile),freezeBytes=fs.readFileSync(freezePath),freeze=JSON.parse(freezeBytes);assert.equal(sha(freezeBytes),plan.candidateFreezeSha256);
    const frozen=Object.fromEntries(freeze.sources.map(row=>[row.path,row.sha256]));
    for(const [file,hash]of Object.entries(evidence.sourceSHA256Before))assert.equal(hash,frozen[file],'Recovery source is the exact approved candidate '+file);
    const old=bridge.value.sourceSHA256After,changed=Object.keys({...old,...evidence.sourceSHA256Before}).filter(file=>old[file]!==evidence.sourceSHA256Before[file]).sort(),transitions=plan.sourceTransitions;
    assert(Array.isArray(transitions));assert.deepEqual(transitions.map(row=>row.path).sort(),changed,'Every and only approved source transition is present');
    for(const row of transitions){assert(['worker/public/scene-fate-ui.js','worker/public/scene-fate-story.js','worker/tools/scene-live-preview.mjs','worker/tools/fate-browser.cjs'].includes(row.path),'Life1 tail cannot change original backend or engine');assert.equal(row.beforeSha256,old[row.path]);assert.equal(row.afterSha256,evidence.sourceSHA256Before[row.path]);}
    assert.equal(bridge.value.operations.length,1);assert.equal(bridge.value.submissions.length,1);
    const start=bridge.value.operations[0];assert.equal(start.body.kind,'start');assert.equal(start.body.requestId,plan.originalStartRequestId);assert.equal(start.result.result.lifeId,plan.originalLifeId);canonical(start.body,main);
    assert.equal(bridge.value.requests.filter(row=>row.action===route).length,1);assert.equal(bridge.value.clockCommands.length,1);assert.equal(bridge.value.clockCommands[0].input.op,'choice-open');assert.equal(bridge.value.clockCommands[0].state,'completed');
    const owned=ownLives(fixture);assert.equal(owned.length,1);assert.equal(owned[0].id,plan.originalLifeId);assert.equal(owned[0].status,'active');assert.deepEqual(JSON.parse(owned[0].state_json).answers,[]);
    evidence.lifeId=plan.originalLifeId;evidence.lineage={type:'exact-unsubmitted-life1-tail',originalRun:bridge.value.runId,originalStatus:bridge.value.status,originalResultsPath:bridge.file,originalResultsSha256:bridge.sha256,originalStartRequestId:plan.originalStartRequestId,originalLifeId:plan.originalLifeId,recoveryPlanPath:planPath,recoveryPlanSha256:sha(planBytes),candidateFreezePath:freezePath,candidateFreezeSha256:sha(freezeBytes),sourceTransitions:transitions,inheritedStart:{body:start.body,result:start.result,authority:start.authority}};
    persist('Original failed life1 authority and approved tail boundaries verified');
    await open('current');await verifyReceipt(start);
    const projection=await pure('Exact original life1 retained with unsubmitted first choice',main,{},[start.body]);assert.equal(projection.fate.state.active.id,plan.originalLifeId);assert.equal(projection.fate.state.active.timing.index,0);assert.equal(projection.fate.state.active.timing.available,true);assert.deepEqual(projection.fate.state.active.draft.answers,[]);
    const op=await submit(frame.locator(action('choice')+'[data-sf-index="0"][data-sf-answer="0"]'),'Original life1 previously unsent manual answer 0');assert.equal(op.body.lifeId,plan.originalLifeId);assert.equal(op.body.answer,0);await verifyReceipt(op);await shot('390-manual-0-original-tail');
    await complete(plan.originalLifeId,1);assert.equal(evidence.operations.length,1);assert.equal(evidence.operations[0].body.kind,'choice');assert.equal(writes().filter(row=>row.body.kind==='start').length,0);note('Original failed life1 resumed only at its never-sent choice; no repeated start or replacement life');
  }
  async function receiptOnly(){
    assert.equal(bridge.value.health.api.pid,evidence.health.api.pid,'Read original in-memory authority, never a new fixture');
    assert.equal(bridge.value.fixture.initialInputSha256,fixture.initialInputSha256,'Original isolated initial actors unchanged');
    const productChanges=Object.keys({...bridge.value.sourceSHA256Before,...evidence.sourceSHA256Before}).filter(p=>p!=='worker/tools/fate-browser.cjs'&&bridge.value.sourceSHA256Before[p]!==evidence.sourceSHA256Before[p]);
    assert.deepEqual(productChanges,[],'Receipt bridge must use the original product and fixture sources');
    evidence.bridgeHarness={original:bridge.value.sourceSHA256Before['worker/tools/fate-browser.cjs'],current:evidence.sourceSHA256Before['worker/tools/fate-browser.cjs'],readOnly:true};
    await open('history');
    const targets=new Map();
    for(const row of [...(bridge.value.operations||[]),...(bridge.value.submissions||[])]){
      if(!row.body)continue;canonical(row.body,row.actor);const key=row.actor.realmId+'|'+row.actor.accountId+'|'+row.body.requestId,previous=targets.get(key);
      if(previous){assert.deepEqual(previous.body,row.body);if(row.result)previous.result=row.result;}else targets.set(key,{body:row.body,actor:row.actor,result:row.result||null});
    }
    assert(targets.size,'No exact original canonical request to inspect');
    const before=await state();
    for(const target of targets.values()){const r=await rpc(target.actor,'fate/receipt',target.body);if(target.result){assert.equal(r.found,true);assert.deepEqual(r.result,target.result.result);assert.deepEqual(r.receipt,target.result.receipt);}}
    assert.deepEqual((await state()).databases,before.databases);assert.equal(writes().length,0);assert.equal(evidence.clockCommands.length,0);evidence.bridgeSource={file:bridge.file,sha256:bridge.sha256};note('Exact original receipt-only bridge; no re-ID, replay, clock or gameplay mutation');
  }
  try{
    evidence.sourceSHA256Before=sources();
    const [ui,service]=await Promise.all([fetch(origin+'/__preview/health',{signal:AbortSignal.timeout(10000)}).then(r=>r.json()),fetch(api+'/__preview/health',{signal:AbortSignal.timeout(10000)}).then(r=>r.json())]);evidence.health={ui,api:service};
    assert(ui.apiReady&&ui.isolated&&service.isolated&&service.ephemeral&&service.fateQa&&service.productionAccess===false);assert.equal(ui.apiPid,service.pid);assert.equal(service.qaClock.lifeMs,7200000);assert.equal(service.qaClock.choiceMs,90000);assert.equal(service.qaClock.automaticFateSweep,false);assert.equal(ui.generatedInputSnapshot.mode,'pinned-qa-text');assert.equal(ui.generatedInputSnapshot.sourceCount,9);
    const manifestPath=path.resolve(ui.generatedInputSnapshot.manifestPath),relative=path.relative(base,manifestPath);assert(relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'Private input snapshot belongs to this batch');
    const bytes=fs.readFileSync(manifestPath),manifest=JSON.parse(bytes);assert.equal(manifest.status,'passed');assert.equal(manifest.id,ui.generatedInputSnapshot.id);assert.equal(manifest.binderSha256,evidence.sourceSHA256Before['worker/tools/scene-preview-bindings.mjs']);evidence.inputSnapshot={manifestPath,manifestSha256:sha(bytes),id:manifest.id,sourceCount:manifest.sourceCount,scope:manifest.scope};
    evidence.boundHttpInputs=[];
    for(const [index,input]of manifest.sources.entries()){
      const r=await fetch(origin+input.requestPath,{signal:AbortSignal.timeout(10000)}),data=Buffer.from(await r.arrayBuffer());assert.equal(r.status,200);assert.equal(r.headers.get('x-scene-input-snapshot'),manifest.id);
      const saved=fs.readFileSync(path.join(path.dirname(manifestPath),'bound',input.requestPath.slice(1)));assert.equal(sha(saved),input.boundSha256);if(!input.type.startsWith('text/html'))assert.equal(sha(data),input.boundSha256);
      const file='bound-http-'+String(index).padStart(2,'0')+(input.type.startsWith('text/html')?'.html':'.js');fs.writeFileSync(path.join(dir,file),data,{flag:'wx'});evidence.boundHttpInputs.push({requestPath:input.requestPath,sha256:sha(data),bytes:data.length,file,status:r.status,headers:Object.fromEntries(r.headers),boundSha256:input.boundSha256});
    }
    fixture=await state();evidence.fixture={initialInputSha256:fixture.initialInputSha256,fixtures:fixture.fixtures,seasonFixtures:fixture.seasonFixtures,seededAt:fixture.seededAt,initialOutcomeCounts:fixture.initialOutcomeCounts,noSeededLifeGiftOrReceipt:fixture.noSeededLifeGiftOrReceipt};assert.equal(fixture.noSeededLifeGiftOrReceipt,true);
    evidence.initialDatabases=fixture.databases;evidence.initialClock=fixture.qaClock;assert.equal(fixture.commandInFlight,null);
    main=fixture.primary;alt=fixture.alternate;foreign=fixture.fixtures.find(r=>r.role==='foreign-account');season=fixture.seasonFixtures[0];actor=main;
    if(prior){
      assert.equal(prior.value.health.api.pid,service.pid);assert.equal(prior.value.fixture.initialInputSha256,fixture.initialInputSha256);assert.deepEqual(prior.value.finalState.databases,fixture.databases,'No unreviewed gameplay since exact previous run');
      assert.equal(prior.value.finalState.qaClock.now,fixture.qaClock.now);assert.deepEqual(prior.value.sourceSHA256After,evidence.sourceSHA256Before,'Source freeze remains exact between original cases');evidence.previousRun={file:prior.file,sha256:prior.sha256};
    }
    await verifyCampaign();
    browser=await playwright().chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});evidence.browserVersion=browser.version();const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
    page=await context.newPage();page.setDefaultTimeout(20000);page.on('framenavigated',f=>{if(f===page.mainFrame())mainNavigations++;});page.on('pageerror',e=>evidence.pageErrors.push({message:e.message,stack:e.stack}));
    page.on('request',r=>{
      if(r.url().startsWith(api+'/app/api/')&&r.method()==='POST'){
        const endpoint=r.url().slice((api+'/app/api/').length),entry={action:endpoint,body:r.postDataJSON(),accountId:r.headers()['x-dev-tg-id'],at:new Date().toISOString()};evidence.requests.push(entry);
        if(endpoint===route&&prepared){entry.actor={...prepared.actor};if(!prepared.body){prepared.body=entry.body;prepared.state='sent';}else if(JSON.stringify(prepared.body)!==JSON.stringify(entry.body)){prepared.conflictingRequest=entry;prepared.state='conflicting-request-stop';}}
        persist('browser exact request recorded');
      }
    });
    page.on('response',r=>{
      if(r.status()>=400)evidence.httpErrors.push({url:r.url(),status:r.status(),expected:expectedErrors.has(r.request())});
      const url=new URL(r.url()),name=url.pathname.split('/').at(-1),source=FRONT.includes(name)?'worker/public/'+name:url.pathname.startsWith('/fate/')&&url.pathname.endsWith('.js')?'worker/public'+url.pathname:null;
      if(source||/\.(js|mjs|css|html|webp|png|jpg|svg|mp4)$/.test(url.pathname)){
        const record={url:r.url(),status:r.status(),type:r.headers()['content-type'],headers:r.headers(),sha256:null,bytes:null,actualBodyRead:false};evidence.servedAssets[r.url()]=record;
        pendingAssets.push(r.body().then(data=>{Object.assign(record,{sha256:sha(data),bytes:data.length,actualBodyRead:true});if(source)evidence.loadedSources[source]=record;}).catch(error=>{if(retiredCharacterGap(record,error,source))evidence.assetCaptureGaps.push({...record,error:error.message,limitation:'Retired original character image body unavailable through CDP; no bytes or global art freeze claimed',refetched:false});else evidence.routeErrors.push({...record,error:error.message});}));
      }
    });
    await page.route('**/*',request=>{
      const url=request.request().url();if(readOnly&&url===api+'/app/api/'+route){evidence.routeErrors.push({url,message:'Read-only case blocked a Fate mutation'});return request.abort('blockedbyclient');}
      if(url===origin+'/fate/app.js'||url.startsWith(origin+'/fate/app.js?')){evidence.routeErrors.push({url,message:'Legacy Fate iframe application must not load'});return request.abort('blockedbyclient');}
      if(url.startsWith(origin+'/')||url.startsWith(api+'/'))return request.continue();evidence.externalRequests.push(url);return request.abort('blockedbyclient');
    });
    evidence.status='running';persist('launch exact pinned scene');expectedNavigations++;await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
    frame=page.frames().find(f=>f.url().includes('/scene-bound-20261102/scene.html'))||await page.waitForEvent('framenavigated',{predicate:f=>f.url().includes('/scene-bound-20261102/scene.html'),timeout:30000});
    await frame.waitForFunction(()=>window.RpgSceneSession?.getSnapshot()?.characterId,null,{timeout:30000});await frame.waitForFunction(()=>window.RpgSceneLiveView?.inspect?.()[0]?.characterVisible,null,{timeout:45000});
    if(selected==='layout')await layouts();else if(selected==='pure')await pureCases();else if(selected==='life1-tail')await life1Tail();else if(selected.startsWith('life'))await lifeCase();else if(selected==='archive-keep-unsent')await archiveKeep();else if(selected==='gift-claim')await giftClaim();else if(selected==='gift-open-lost')await giftOpen();else if(selected==='scope')await scopeCase();else if(selected==='receipt-only')await receiptOnly();else{await open('archive');await geometry('final gallery');await shot('390-final-gallery');note('Current accepted original state displayed without mutation');}
    await Promise.all(pendingAssets);
    for(const [source,record]of Object.entries(evidence.loadedSources))assert.equal(record.sha256,evidence.sourceSHA256Before[source],'Actual served source '+source);
    assert(evidence.loadedSources['worker/public/scene-fate-ui.js']&&evidence.loadedSources['worker/public/scene-fate-ui.css'],'Actual F1 product loaded');
    assert.equal(evidence.requests.filter(r=>r.action.startsWith('fate/')&&!['fate/scene','fate/receipt',route].includes(r.action)).length,0,'No implicit legacy Fate progression route');
    assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.httpErrors.filter(r=>!r.expected),[]);assert.deepEqual(evidence.routeErrors,[]);assert.deepEqual(evidence.externalRequests,[]);
    evidence.sourceSHA256After=sources();assert.deepEqual(evidence.sourceSHA256After,evidence.sourceSHA256Before,'Product and QA source frozen within original case');
    evidence.finalState=await state();assert.equal(evidence.finalState.commandInFlight,null);
    evidence.outbox={permanent:evidence.finalState.permanent.outbox,season:evidence.finalState.season.outbox,externalRequests:evidence.externalRequests.length,dispatcherStarted:false};
    evidence.ok=true;evidence.status='passed';
  }catch(error){
    evidence.ok=false;evidence.status='failed';evidence.error={message:error.message,stack:error.stack};process.exitCode=1;
    try{if(page)await shot('failure');if(frame)evidence.visibleText=await frame.locator('.scene-unified-dialog').innerText({timeout:2000});}catch{}
    try{evidence.finalState=await state();}catch{}
  }finally{
    await Promise.allSettled(pendingAssets);
    try{if(frame)evidence.pendingStorage=await frame.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).filter(k=>/fate|rpg-sf|scene.*pending/.test(k)).map(k=>[k,sessionStorage.getItem(k)])));evidence.sourceSHA256After=sources();evidence.sourcesStable=JSON.stringify(evidence.sourceSHA256Before)===JSON.stringify(evidence.sourceSHA256After);}catch{}
    evidence.finishedAt=new Date().toISOString();evidence.requestCounts=Object.fromEntries([...new Set(evidence.requests.map(r=>r.action))].map(name=>[name,evidence.requests.filter(r=>r.action===name).length]));persist();
    console.log(JSON.stringify({ok:evidence.ok,status:evidence.status,case:selected,operations:evidence.operations.length,checks:evidence.checks.length,dir,error:evidence.error}));
    if(browser)await browser.close();
  }
})().catch(error=>{evidence.ok=false;evidence.status='failed';evidence.error={message:error.message,stack:error.stack};evidence.finishedAt=new Date().toISOString();persist();console.error(error.stack);process.exitCode=1;});
