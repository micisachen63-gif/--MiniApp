(() => {
'use strict';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => Number(value || 0).toLocaleString('zh-TW');
const pct = value => Number.isFinite(Number(value)) ? (Number(value) * 100).toFixed(1).replace(/\.0$/, '') + '%' : '—';
const copy = value => JSON.parse(JSON.stringify(value));
const reasons = {target:'目標達成',resources:'材料或金幣不足',budget:'已達金幣上限',stopped:'已停止',class:'職業已變更',party:'組隊狀態已變更',busy:'裝備狀態已變更',missing:'找不到裝備',break:'裝備已破碎'};
const kinds = {auto_enhance_end:'enhance',auto_reroll_end:'reroll'};
const pendingMemory = new Map();
const scopeOf = host => {
  const c = host.getContext?.() || {};
  return {accountId:String(c.accountId ?? ''),realmId:String(c.realmId ?? 'permanent'),characterId:String(c.characterId ?? ''),epoch:c.epoch ?? 0};
};
const identity = c => JSON.stringify([c.accountId,c.realmId,c.characterId]);
const scopeKey = c => identity(c) + ':' + String(c.epoch);
const requestId = () => 'sw_' + (globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + '_' + Math.random().toString(36).slice(2))).replace(/-/g,'');
const finite = value => Number.isFinite(Number(value));
const ownJob = (job,c) => !!job && String(job.characterId) === String(c.characterId);
const jobRows = jobs => (jobs || []).filter(row => kinds[row.kind] && row.job?.id);
const runningFor = (jobs,kind) => jobRows(jobs).find(row => kinds[row.kind] === kind && row.job.status === 'running');
function itemBlock(item,me,jobs) {
  if (!item) return '請先選擇一件裝備';
  if (item.inTrade) return '交易中的裝備無法加工';
  if (jobRows(jobs).some(row => row.job.status === 'running' && row.job.itemId === item.id)) return '這件裝備正在背景作業，請先停止或等待完成';
  if (me?.character?.partyId && item.equipped) return '組隊期間無法加工穿戴中的裝備';
  return '';
}
function gain(item,target) {
  const levels=item?.enhanceGrowth?.byLevel,from=Number(item?.enhance);
  if (!Array.isArray(levels) || !Number.isInteger(from) || !Number.isInteger(target) || target<=from || !finite(levels[from]) || !finite(levels[target])) return null;
  return {name:item.enhanceGrowth.statName || item.statName,before:Number(levels[from]),after:Number(levels[target]),delta:Number(levels[target])-Number(levels[from])};
}
function enhancePlan(item,me,meta,form={},jobs=[],context={}) {
  const mode=['normal','blessed','guaranteed'].includes(form.mode)?form.mode:'normal',background=!!form.background;
  const key=mode==='guaranteed'?(item?.slot==='weapon'?'guaranteed_scroll_w':'guaranteed_scroll_a'):mode==='blessed'?item?.blessedScroll:item?.scroll;
  const need=mode==='normal'?Number(item?.scrollCost):1,have=Number(me?.inventory?.[key]||0),missing=Math.max(0,need-have),unit=Number(meta?.items?.[key]?.price);
  const gold=mode==='normal'&&missing>0?missing*unit:0,from=Number(item?.enhance||0),target=background?Number(form.target):from+1;
  const odds=mode==='guaranteed'&&item?.enhanceNext?{success:1,nothing:0,break:0}:mode==='blessed'?item?.blessedEnhanceNext:item?.enhanceNext;
  let error=itemBlock(item,me,jobs);
  if (!error&&!odds) error='這件裝備已達強化上限';
  if (!error&&background&&mode==='guaranteed') error='必成卷只可手動使用一次';
  if (!error&&background&&runningFor(jobs,'enhance')) error='帳號已有背景強化，請先查看作業狀態';
  if (!error&&(!Number.isInteger(target)||target<=from||target>15)) error='目標必須高於目前強化值，上限 +15';
  if (!error&&(!key||!Number.isInteger(need)||need<1||(mode==='normal'&&missing>0&&!(unit>=0)))) error='尚未取得完整卷軸費用，請重新同步';
  if (!error&&mode!=='normal'&&have<1) error='需要 '+(meta?.items?.[key]?.name||'所選卷軸')+' ×1';
  if (!error&&mode==='normal'&&gold>Number(me?.character?.gold||0)) error='金幣不足以補購本次所缺卷軸';
  const payload={itemId:item?.id,...(mode==='blessed'?{blessed:true}:mode==='guaranteed'?{guaranteed:true}:{})};
  if (background) { payload.target=target;payload.blessed=mode==='blessed'; }
  return {kind:'enhance',action:background?'auto-enhance/start':'enhance',payload,error,itemId:item?.id,itemName:item?.name,from,target,mode,background,odds,
    gain:gain(item,target),cost:{key,name:meta?.items?.[key]?.name||key,scrolls:need,have,missing,fee:0,gold:finite(gold)?gold:0},party:!!me?.character?.partyId};
}
function targetState(lines,slots,cfg) {
  const locks=cfg.locks||[],fixed=new Set(lines.filter((_,i)=>locks.includes(i)).map(line=>line.key));
  const keys=(cfg.keys||[]).filter(key=>!fixed.has(key)),mutable=lines.filter((_,i)=>!locks.includes(i)),scores={C:0,B:40,A:65,S:85,SS:95},score=cfg.quality?scores[cfg.quality]:0;
  return {keys,mutableCount:slots-locks.length,needsQuality:!!cfg.keys?.length&&!keys.length&&!cfg.quality,
    reached:lines.length===slots&&mutable.length>0&&(keys.length?keys.every(key=>mutable.some(line=>line.key===key&&line.score>=score)):!!cfg.quality&&mutable.every(line=>line.score>=score))};
}
function targetRule(progress,cfg) {
  if (progress.needsQuality) return '所選能力已完整鎖定；請選擇其他能力，或設定其餘詞條的品質。';
  const prefix=cfg.locks?.length?'完整鎖定的詞條不計入停止條件；':'';
  return prefix+(progress.keys.length?'可洗詞條中的指定能力全部出現'+(cfg.quality?'，且各達 '+cfg.quality+' 以上':'')+'時停止。':'其餘 '+progress.mutableCount+' 條可洗詞條都達 '+(cfg.quality||'指定品質')+' 以上時停止。');
}
function rerollPlan(item,me,meta,form={},available=null,jobs=[],context={}) {
  const background=!!form.background,lines=item?.affixes?.lines||[],slots=Number(item?.affixes?.slots||1);
  const locks=Array.isArray(form.locks)?[...form.locks].sort((a,b)=>a-b):[],typeLocks=background&&Array.isArray(form.typeLocks)?[...form.typeLocks].sort((a,b)=>a-b):[];
  const all=[...locks,...typeLocks],n=all.length,tier=Math.max(1,Number(item?.tier)||1);
  // The public view prices cover full locks; all-slot type locks use the same existing auto-reroll cost rule.
  const price=item?.rerollPrices?.[n]||(n===slots&&typeLocks.length?{scrolls:tier*[1,2,4,7,11,16][n],fee:tier*30*(n+1)**2}:n===0?item?.rerollCost:null);
  const need=Number(price?.scrolls),fee=Number(price?.fee),have=Number(me?.inventory?.scroll_r||0),missing=Math.max(0,need-have),unit=Number(meta?.items?.scroll_r?.price),gold=fee+(missing>0?missing*unit:0);
  const functions=Array.isArray(form.functions)?[...form.functions]:[],quality=form.quality||null,maxGold=form.maxGold==null||form.maxGold===''?null:Number(form.maxGold);
  const selected=functions.map(id=>available?.functions?.find(fn=>fn.id===id)),keys=selected.map(fn=>fn?.key).filter(Boolean),cfg={keys,quality,locks,typeLocks};
  const progress=targetState(lines,slots,cfg);
  let error=itemBlock(item,me,jobs);
  if (!error&&(new Set(all).size!==all.length||all.some(i=>!Number.isInteger(i)||i<0||i>=lines.length)||locks.length>=slots)) error='至少保留一條可洗數值的詞條，並檢查鎖定位置';
  if (!error&&background&&!available) error='正在取得角色適用的能力目標';
  if (!error&&background&&runningFor(jobs,'reroll')) error='帳號已有背景洗鍊，請先查看作業狀態';
  if (!error&&background&&item?.classReq&&item.classReq!=='any'&&item.classReq!==me?.character?.baseClass) error='請選擇目前職業可用的裝備';
  if (!error&&background&&(selected.some(fn=>!fn)||new Set(functions).size!==functions.length||(!functions.length&&!quality))) error='請至少選擇一項有效能力或目標品質';
  if (!error&&quality&&!['C','B','A','S','SS'].includes(quality)) error='請選擇有效品質';
  if (!error&&background&&typeLocks.some(i=>!available.functions.some(fn=>fn.key===lines[i]?.key))) error='只能保留目前職業適用的能力種類';
  const fixed=all.map(i=>lines[i]?.key);
  if (!error&&background&&keys.filter(key=>!fixed.includes(key)).length>slots-all.length) error='剩餘詞條格數不足，請減少目標或解除鎖定';
  if (!error&&background&&progress.needsQuality) error=targetRule(progress,cfg);
  if (!error&&background&&maxGold!==null&&(!Number.isSafeInteger(maxGold)||maxGold<0)) error='金幣上限必須為非負整數';
  if (!error&&(!Number.isInteger(need)||need<1||!finite(fee)||(missing>0&&!(unit>=0)))) error='尚未取得完整重洗費用，請重新同步';
  const reached=background&&progress.reached;
  if (!error&&!reached&&gold>Number(me?.character?.gold||0)) error='金幣不足以支付本次工費與缺卷補購';
  if (!error&&background&&!reached&&maxGold!==null&&gold>maxGold) error='金幣上限不足以支付第一次重洗';
  const payload={itemId:item?.id,locks};
  if (background) Object.assign(payload,{functions,quality,typeLocks,maxGold});
  return {kind:'reroll',action:background?'auto-reroll/start':'reroll',payload,error,itemId:item?.id,itemName:item?.name,background,locks,typeLocks,quality,functions,maxGold,reached,
    cost:{key:'scroll_r',name:meta?.items?.scroll_r?.name||'洗屬性捲',scrolls:need,have,missing,fee:finite(fee)?fee:0,gold:finite(gold)?gold:0},rule:targetRule(progress,cfg),lines,slots,party:!!me?.character?.partyId};
}
function createClient(host,onUpdate=()=>{}) {
  const context=scopeOf(host),captured=scopeKey(context),pendingKey='rpg-scene-workshop-pending-v1:'+identity(context),draft=host.draft||(host.draft={});
  let disposed=false,meSeq=0,jobsSeq=0,optionsSeq=0;
  const current=()=>!disposed&&host.current?.()!==false&&scopeKey(scopeOf(host))===captured;
  let storage;try{storage=host.storage||globalThis.localStorage;}catch{}
  const validPending=value=>value&&value.scope===identity(context)&&['enhance','reroll','auto-enhance/start','auto-reroll/start','auto-enhance/stop','auto-reroll/stop'].includes(value.action)&&value.payload&&typeof value.payload==='object';
  let saved=pendingMemory.get(pendingKey)||draft.pending;try{saved=saved||JSON.parse(storage?.getItem(pendingKey)||'null');}catch{}
  const state={me:null,meta:null,jobs:[],jobsReady:false,balance:null,options:{},loading:false,busy:false,preview:null,pending:validPending(saved)?copy(saved):null,result:null,error:'',jobsError:''};
  const emit=()=>{if(current())onUpdate(state);};
  function keepPending(value) {
    state.pending=value;draft.pending=value?copy(value):null;
    if(value)pendingMemory.set(pendingKey,copy(value));else pendingMemory.delete(pendingKey);
    try{if(value)storage?.setItem(pendingKey,JSON.stringify(value));else storage?.removeItem(pendingKey);}catch{}
  }
  if(state.pending)keepPending(state.pending);
  function check(response) {
    if(!current())throw Object.assign(new Error('畫面已切換'),{stale:true});
    if(response?.realmId&&response.realmId!==context.realmId)throw Object.assign(new Error('回覆所屬世界不同，尚未確認這筆操作'),{uncertain:true});
    if(response?.ok===false)throw Object.assign(new Error(response.message||'操作未完成'),{code:response.error,status:response.status||400,uncertain:false});
    return response;
  }
  async function request(action,body={}) {
    if(!current())throw Object.assign(new Error('畫面已切換'),{stale:true});
    return check(await host.request(action,copy(body)));
  }
  function applyMe(response) {
    if(!response?.character||String(response.character.tgId)!==context.characterId||!Array.isArray(response.equipment))throw Object.assign(new Error('角色資料不完整或已切換，請重新同步'),{uncertain:true});
    if(!state.me||Number(response.character.revision||0)>=Number(state.me.character.revision||0))state.me=response;
  }
  async function loadMe() {
    const ticket=++meSeq,r=await request('me');
    if(current()&&ticket===meSeq){applyMe(r);emit();}return r;
  }
  async function loadMeta() {const r=await request('meta');if(current()){state.meta=r.meta;emit();}return r;}
  async function refreshJobs() {
    const ticket=++jobsSeq;
    try{
      const r=await request('background/status');if(!current()||ticket!==jobsSeq)return;
      if(!Array.isArray(r.jobs))throw new Error('背景作業回覆不完整');
      const previous=state.jobs;
      state.jobs=jobRows(r.jobs).filter(row=>!row.ownerAccountId||!context.accountId||String(row.ownerAccountId)===context.accountId);
      state.jobsReady=true;state.jobsError='';
      if(r.balance&&String(r.balance.characterId)===context.characterId)state.balance=r.balance;
      emit();
      const finished=previous.some(row=>row.job.status==='running'&&ownJob(row.job,context)&&state.jobs.some(next=>next.job.id===row.job.id&&next.job.status==='ended'));
      if(finished&&!state.busy)try{await loadMe();}catch(e){if(current())state.error='作業已結束；最新裝備尚未同步，請按更新資料。';}
      return r;
    }catch(e){if(current()&&!e.stale){state.jobsError=e.message;emit();}return null;}
  }
  async function loadOptions(itemId) {
    if(!itemId)return null;
    const ticket=++optionsSeq,r=await request('auto-reroll/options',{itemId});
    if(current()&&ticket===optionsSeq){state.options[itemId]=r;emit();}return r;
  }
  async function refresh() {
    if(!current()||state.busy)return;
    state.loading=true;state.error='';emit();
    const results=await Promise.allSettled([loadMe(),state.meta?Promise.resolve():loadMeta(),refreshJobs()]);
    if(!current())return;
    state.loading=false;
    for(const r of results)if(r.status==='rejected'&&!r.reason?.stale)state.error=r.reason.message;
    emit();
  }
  function plan(selection) {
    const me=state.balance&&Number(state.balance.revision)>=Number(state.me?.character?.revision||0)?{...state.me,character:{...state.me?.character,gold:state.balance.gold}}:state.me;
    const item=me?.equipment?.find(row=>row.id===selection.itemId);
    const output=selection.kind==='reroll'?rerollPlan(item,me,state.meta,selection,state.options[selection.itemId],state.jobs,context):enhancePlan(item,me,state.meta,selection,state.jobs,context);
    if(!state.jobsReady)output.error='背景作業狀態尚未同步，請更新資料';
    return output;
  }
  async function preview(selection) {
    if(!current()||state.busy||state.pending)return;
    state.busy=true;state.preview=null;state.error='';state.result=null;emit();
    try{
      await loadMe();await refreshJobs();
      if(selection.kind==='reroll'&&selection.background)await loadOptions(selection.itemId);
      if(!current())return;
      const p=plan(copy(selection));if(p.error)throw new Error(p.error);
      state.preview=copy(p);
    }catch(e){if(current()&&!e.stale)state.error=e.message;}
    finally{if(current()){state.busy=false;emit();}}
  }
  function previewStop(jobId) {
    if(!current()||state.busy||state.pending)return false;
    const row=state.jobs.find(row=>row.job.id===jobId&&row.job.status==='running'&&ownJob(row.job,context));
    if(!row)return false;
    state.error='';state.preview={kind:'stop',action:'auto-'+kinds[row.kind]+'/stop',payload:{jobId},itemId:row.job.itemId,itemName:row.job.itemName,job:copy(row.job)};emit();return true;
  }
  function addJob(kind,job) {
    const row={kind:kind==='enhance'?'auto_enhance_end':'auto_reroll_end',refId:job.id,ownerAccountId:job.ownerAccountId,job};
    state.jobs=[...state.jobs.filter(old=>old.job.id!==job.id),row];draft.tab='jobs';draft.jobId=job.id;
  }
  async function afterConfirmed(result,hasMe=false) {
    try{host.onChanged?.(result);}catch{}
    const results=await Promise.allSettled([hasMe?Promise.resolve():loadMe(),refreshJobs()]);
    if(current())for(const r of results)if(r.status==='rejected'&&!r.reason?.stale)state.error='操作已完成；最新資料同步失敗，請按更新資料。';
  }
  async function sendPending(pending) {
    const r=await request(pending.action,pending.payload);
    if(pending.action==='enhance'||pending.action==='reroll'){
      if(!r.result)throw Object.assign(new Error('操作回覆未含結果，請核對原帳務'),{uncertain:true});
      applyMe(r);state.result={action:pending.action,itemId:pending.itemId,result:r.result};
    }else{
      const j=r.job;
      if(!j?.id||!ownJob(j,context)||(pending.payload.jobId&&j.id!==pending.payload.jobId))throw Object.assign(new Error('原背景作業結果尚待核對'),{uncertain:true});
      addJob(pending.action.includes('enhance')?'enhance':'reroll',j);
      state.result={action:pending.action,itemId:pending.itemId,job:j};
    }
    keepPending(null);state.preview=null;state.error='';emit();
    await afterConfirmed(r,!!r.character);
  }
  async function confirm(acknowledge=false) {
    if(!current()||state.busy||!state.preview||!acknowledge)return false;
    const p=state.preview,payload=copy(p.payload);
    if(['enhance','reroll','auto-reroll/start'].includes(p.action))payload.requestId=requestId();
    const pending={scope:identity(context),action:p.action,payload,itemId:p.itemId,itemName:p.itemName,createdAt:Date.now(),beforeJobIds:state.jobs.map(row=>row.job.id)};
    keepPending(pending);state.busy=true;state.error='';emit();
    try{await sendPending(pending);}
    catch(e){
      if(current()&&!e.stale){
        const known=[400,401,403,404,409,422,429].includes(e.status)&&e.code!=='duplicate'&&e.uncertain!==true;
        if(known){keepPending(null);state.preview=null;state.error=e.message;try{await loadMe();await refreshJobs();}catch{}}
        else state.error='結果尚待確認：'+e.message;
      }
    }finally{if(current()){state.busy=false;emit();}}
    return !state.pending;
  }
  async function recover() {
    if(!current()||state.busy||!state.pending)return;
    const pending=copy(state.pending);state.busy=true;state.error='';state.preview=null;emit();
    try{
      if(pending.action==='enhance'||pending.action==='reroll'){
        const r=await request('forge/receipt',{kind:pending.action,requestId:pending.payload.requestId});
        if(r.kind!==pending.action||r.requestId!==pending.payload.requestId)throw Object.assign(new Error('帳務回覆與原操作不符'),{uncertain:true});
        if(!r.found){state.error='尚未查到這筆原帳務；請稍後再核對，目前不會再次消耗材料。';return;}
        if(!Array.isArray(r.entries)||!r.entries.length)throw new Error('原帳務內容尚未完整');
        state.result={action:pending.action,itemId:pending.itemId,recovered:true,entries:r.entries};
        keepPending(null);emit();await afterConfirmed(r);
      }else if(pending.action==='auto-reroll/start'){
        // This endpoint has an explicit owner/request_id + exact-config replay contract.
        await sendPending(pending);
      }else{
        const kind=pending.action.includes('enhance')?'enhance':'reroll';
        const r=await request('auto-'+kind+'/status');
        await refreshJobs();
        // refreshJobs may absorb a stale response after disposal; do not clear a newer window's receipt.
        if(!current())return;
        const candidates=[r.job,...state.jobs.map(row=>row.job)].filter(job=>ownJob(job,context));
        const j=pending.action.endsWith('/stop')?candidates.find(job=>job.id===pending.payload.jobId):
          candidates.find(job=>job.itemId===pending.payload.itemId&&job.target===pending.payload.target&&!!job.blessed===!!pending.payload.blessed&&!pending.beforeJobIds.includes(job.id));
        if(!j||(pending.action.endsWith('/stop')&&j.status==='running')){
          state.error=pending.action.endsWith('/stop')?'這項作業仍在進行，停止結果尚待確認；可稍後再核對。':'尚未核對到原背景強化；請稍後再查，目前不會重新開工。';return;
        }
        addJob(kind,j);state.result={action:pending.action,itemId:pending.itemId,job:j,recovered:true};keepPending(null);emit();await afterConfirmed(r);
      }
    }catch(e){if(current()&&!e.stale)state.error='核對尚未完成：'+e.message;}
    finally{if(current()){state.busy=false;emit();}}
  }
  return {state,context,current,plan,refresh,refreshJobs,loadOptions,preview,previewStop,confirm,recover,
    cancelPreview(){if(state.busy||!state.preview)return false;state.preview=null;emit();return true;},
    dispose(){disposed=true;meSeq++;jobsSeq++;optionsSeq++;}};
}

function costHtml(plan) {
  const c=plan.cost;
  return '<section class="sw-card sw-cost"><h4>'+(plan.background?'下一次用量':'本次用量')+'</h4><dl><div><dt>'+esc(c.name)+'</dt><dd>×'+fmt(c.scrolls)+' <small>持有 '+fmt(c.have)+'</small></dd></div>'+
    '<div><dt>缺卷補購</dt><dd>'+(plan.mode&&plan.mode!=='normal'?'不補購':fmt(c.missing)+' 張')+'</dd></div>'+
    (c.fee?'<div><dt>工費</dt><dd>'+fmt(c.fee)+' 金幣</dd></div>':'')+
    '<div class="sw-total"><dt>'+(plan.background?'下一次扣除':'本次扣除')+'</dt><dd>'+fmt(c.gold)+' 金幣</dd></div></dl>'+
    (plan.background?'<p>累計費用依實際次數與庫存計算。</p>':'')+'</section>';
}
function gainHtml(value,label) {
  if(!value)return '<p class="sw-muted">此裝備目前未提供強化能力預覽。</p>';
  return '<section class="sw-card sw-gain"><h4>'+esc(label)+'</h4><p>'+esc(value.name)+' <strong>'+fmt(value.before)+' → '+fmt(value.after)+'</strong><span>增加 '+fmt(value.delta)+'</span></p></section>';
}
function linesHtml(lines,locks=[],types=[]) {
  return '<div class="sw-affix-results">'+(lines||[]).map(line=>'<div><span>'+esc(line.name)+' <b>+'+pct(line.value)+'</b></span><small>'+esc(line.quality||'')+(locks.includes(line.index)?' · 完整保留':types.includes(line.index)?' · 保留能力':'')+'</small></div>').join('')+'</div>';
}
function previewHtml(plan,acknowledged=false,busy=false) {
  const stop=plan.kind==='stop';
  let details='';
  if(stop) details='<p>已完成 '+fmt(plan.job.attempts)+' 次；已用 '+fmt(plan.job.spentScrolls)+' 張卷軸、'+fmt(plan.job.spentGold)+' 金幣。停止後保留目前結果，已使用的材料不會退還。</p>';
  else if(plan.kind==='enhance') details='<p><strong>+'+fmt(plan.from)+' → +'+fmt(plan.target)+'</strong> · '+esc({normal:'普通卷',blessed:'祝福卷',guaranteed:'必成卷'}[plan.mode])+'</p>'+
    '<div class="sw-odds"><span>下一次成功 <b>'+pct(plan.odds?.success)+'</b></span><span>無變化 <b>'+pct(plan.odds?.nothing)+'</b></span><span class="'+(plan.odds?.break?'sw-danger':'')+'">爆裝 <b>'+pct(plan.odds?.break)+'</b></span></div>'+
    gainHtml(plan.gain,plan.background?'若達成目標':'本次成功後')+costHtml(plan)+
    (plan.mode==='guaranteed'?'<p>只消耗一張必成卷，完成這一次強化。</p>':(plan.odds?.break||plan.background)?'<p class="sw-risk">進入危險強化範圍後，裝備可能破碎並永久消失。祝福卷提高成功率，並不降低爆裝率。</p>':'')+
    (plan.background?'<p>約每 3 秒強化一次；離開畫面或關閉遊戲也會繼續。'+(plan.mode==='normal'?'普通卷不足時持續用金幣補購。':'祝福卷耗盡後停止，不補購。')+'達成目標、裝備破碎、資源不足或手動停止時結束。</p>':'');
  else details='<p>完整保留 '+plan.locks.length+' 條'+(plan.typeLocks.length?'；保留能力、重洗品質 '+plan.typeLocks.length+' 條':'')+'。</p>'+
    linesHtml(plan.lines,plan.locks,plan.typeLocks)+costHtml(plan)+
    '<p>未完整鎖定的數值可升可降；品階、元素、強化與遺物能力保留。</p>'+
    (plan.background?'<p>'+esc(plan.rule)+'</p><p>累計金幣上限：'+(plan.maxGold===null?'不設上限':fmt(plan.maxGold))+'。約每 3 秒重洗一次，離開遊戲仍會繼續。</p>':'')+
    (plan.reached?'<p class="sw-success">目前已符合目標。這次會記錄達標結果，不消耗材料。</p>':'');
  return '<section class="sw-confirm sw-card" data-sw-confirmation aria-label="確認工坊操作"><span class="sw-eyebrow">送出前確認</span><h3>'+esc(stop?'停止背景作業':plan.background?'開始背景'+(plan.kind==='enhance'?'強化':'洗鍊'):'本次'+(plan.kind==='enhance'?'強化':'洗鍊'))+'</h3><p class="sw-item-name">'+esc(plan.itemName)+'</p>'+details+
    '<label class="sw-ack"><input type="checkbox" name="workshopAcknowledge" data-sw-ack '+(acknowledged?'checked ':'')+(busy?'disabled':'')+'><span>我已確認本次設定、消耗與結果規則</span></label>'+
    '<footer class="sw-actions"><button type="button" class="sw-secondary" data-sw-cancel '+(busy?'disabled':'')+'>返回調整</button><button type="button" class="sw-primary" data-sw-confirm '+(!acknowledged||busy?'disabled':'')+'>'+(busy?'正在處理…':stop?'確認停止':plan.background?'確認開工':'確認執行一次')+'</button></footer></section>';
}
function resultHtml(result) {
  if(!result)return '';
  let body='';
  if(result.entries)body='<p>已找到原操作帳務。下方裝備顯示目前狀態。</p>'+result.entries.map(entry=>'<p class="sw-receipt-note">'+esc(entry.note||entry.type)+'</p>').join('');
  else if(result.job)body='<p>'+esc(reasons[result.job.reason]||(result.job.status==='running'?'背景作業已開始':'作業已結束'))+' · '+esc(result.job.itemName)+'</p>';
  else if(result.action==='enhance'){
    const r=result.result;
    body='<p>'+esc(r.itemName)+'：'+(r.result==='break'?'裝備破碎':r.result==='success'?'+'+fmt(r.from)+' → +'+fmt(r.to):'維持 +'+fmt(r.to))+'</p><p>使用 '+Object.entries(r.used||{}).map(([,n])=>fmt(n)+' 張卷軸').join('、')+' · 補購 '+fmt(r.goldCost)+' 金幣</p>';
  }else{
    const r=result.result;body='<p>'+esc(r.itemName)+' · 詞條 '+esc(r.before?.quality||'未鑑定')+' → '+esc(r.after?.quality||'')+'</p>'+linesHtml(r.after?.lines,r.locks,r.typeLocks)+'<p>本次扣除 '+fmt(r.goldCost)+' 金幣</p>';
  }
  return '<section class="sw-card sw-result" aria-live="polite"><div class="sw-heading"><h4>'+(result.recovered?'原操作已核對':'操作結果')+'</h4><button type="button" class="sw-link" data-sw-result-clear>收起</button></div>'+body+'</section>';
}
function mount(root,host,options={}) {
  const draft=host.draft||(host.draft={});draft.items||={};
  // An explicit equipment action is a new destination; plain reopening keeps its draft.
  if(typeof options.itemId==='string')draft.itemId=options.itemId;
  else if(draft.itemId===undefined)draft.itemId='';
  if(['enhance','reroll','jobs'].includes(options.tab))draft.tab=options.tab;
  else if(!['enhance','reroll','jobs'].includes(draft.tab))draft.tab='enhance';
  let disposed=false,timer=null,optionLoading='',lastPreview=null,acknowledged=false,firstPaint=true,restoreScroll=null;
  if(typeof document!=='undefined'&&!document.querySelector('link[data-scene-workshop-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.dataset.sceneWorkshopStyle='true';
    const script=document.querySelector('script[src*="scene-workshop-ui.js"]');
    link.href=new URL('scene-workshop-ui.css?v=unified-ui-20261104',script?.src||document.baseURI).href;document.head.append(link);
  }
  const client=createClient(host,paint);
  function itemForm(item) {
    const id=item?.id||draft.itemId||'';
    return draft.items[id]||(draft.items[id]={enhance:{mode:'normal',background:false,target:Number(item?.enhance||0)+1},reroll:{background:false,locks:[],typeLocks:[],functions:[],quality:'',maxGold:''}});
  }
  function selection() {
    const item=client.state.me?.equipment?.find(row=>row.id===draft.itemId),form=itemForm(item);
    return {itemId:draft.itemId,kind:draft.tab,...copy(draft.tab==='reroll'?form.reroll:form.enhance)};
  }
  function art(item) {
    let path=typeof item?.art==='object'?item.art?.src||item.art?.path:null;
    if(typeof path!=='string')path=null;
    // Match the shared inventory's existing equipment IDs; special art stays a symbol.
    if(!path&&typeof item?.art==='string'&&item.source!=='star_ring'&&item.classReq!=='thief'&&/^[a-z0-9_]+$/i.test(item.art))path='/art/v2/'+item.art+'.webp';
    const url=path&&host.artUrl?.(path);
    return url?'<img class="sw-item-art" src="'+esc(url)+'" alt="" decoding="async">':'<span class="sw-item-art sw-art-empty" aria-hidden="true">'+esc(item?.emoji||(item?.slot==='weapon'?'⚔':'◇'))+'</span>';
  }
  function schedule() {
    if(timer||disposed||!client.current()||!client.state.jobs.some(row=>row.job.status==='running'))return;
    timer=setTimeout(async()=>{timer=null;if(disposed||!client.current())return;if(typeof document==='undefined'||!document.hidden)await client.refreshJobs();schedule();},8000);
  }
  function loadCurrentOptions() {
    if(draft.tab!=='reroll'||!draft.itemId||!itemForm().reroll.background||client.state.options[draft.itemId]||optionLoading===draft.itemId)return;
    const id=draft.itemId;optionLoading=id;
    client.loadOptions(id).catch(error=>{if(client.current()){client.state.error=error.message;paint();}}).finally(()=>{if(optionLoading===id)optionLoading='';});
  }
  function itemSelector(me,frozen) {
    const chosen=me.equipment.find(item=>item.id===draft.itemId);
    const choices='<option value="">請選擇裝備</option>'+(!chosen&&draft.itemId?'<option value="'+esc(draft.itemId)+'" selected>原裝備目前不在背包</option>':'')+
      me.equipment.map(item=>'<option value="'+esc(item.id)+'" '+(item.id===draft.itemId?'selected':'')+'>+'+fmt(item.enhance)+' '+esc(item.name)+' · T'+fmt(item.tier)+(item.equipped?' · 穿戴中':'')+(item.inTrade?' · 交易中':'')+'</option>').join('');
    return '<section class="sw-card sw-picker"><label>選擇裝備<select name="workshopItem" data-sw-item '+(frozen?'disabled':'')+'>'+choices+'</select></label>'+
      (chosen?'<div class="sw-selected">'+art(chosen)+'<div><strong>'+esc(chosen.name)+' <span>+'+fmt(chosen.enhance)+'</span></strong><p>'+esc(chosen.slotName||'裝備')+' · T'+fmt(chosen.tier)+' · '+esc(chosen.rarityName||'')+'</p><small>'+esc(chosen.statName||'能力')+' '+fmt(chosen.stat)+' · '+esc(chosen.className||'全職業')+'</small></div></div>':'<p class="sw-muted">從目前角色的真實背包選擇，或由裝備明細進入。</p>')+'</section>';
  }
  function enhanceForm(item,form,plan,frozen) {
    const modes=[['normal','普通卷',item.scroll],['blessed','祝福卷',item.blessedScroll],['guaranteed','必成卷',item.slot==='weapon'?'guaranteed_scroll_w':'guaranteed_scroll_a']];
    return '<section class="sw-card"><h4>強化卷軸</h4><div class="sw-scroll-modes">'+modes.map(([id,label,key])=>'<label class="'+(form.mode===id?'is-selected':'')+'"><input type="radio" name="workshopScroll" data-sw-mode value="'+id+'" '+(form.mode===id?'checked ':'')+(frozen?'disabled':'')+'><span>'+label+'<small>持有 '+fmt(client.state.me.inventory[key]||0)+' 張</small></span></label>').join('')+'</div>'+
      '<label class="sw-toggle"><input type="checkbox" name="workshopAutoEnhance" data-sw-auto-enhance '+(form.background?'checked ':'')+(frozen||form.mode==='guaranteed'?'disabled':'')+'><span>背景強化到指定等級<small>離開畫面後仍繼續；必成卷只限單次</small></span></label>'+
      (form.background?'<label>目標等級<select name="workshopTarget" data-sw-target '+(frozen?'disabled':'')+'>'+Array.from({length:Math.max(0,15-Number(item.enhance))},(_,i)=>Number(item.enhance)+i+1).map(level=>'<option value="'+level+'" '+(Number(form.target)===level?'selected':'')+'>+'+level+'</option>').join('')+'</select></label>':'')+'</section>'+
      (plan.odds?'<section class="sw-card"><h4>'+(form.background?'下一次強化':'本次強化')+'</h4><div class="sw-odds"><span>成功 <b>'+pct(plan.odds.success)+'</b></span><span>無變化 <b>'+pct(plan.odds.nothing)+'</b></span><span class="'+(plan.odds.break?'sw-danger':'')+'">爆裝 <b>'+pct(plan.odds.break)+'</b></span></div></section>':'')+
      gainHtml(plan.gain,form.background?'若達成 +'+fmt(plan.target):'成功後能力')+costHtml(plan);
  }
  function rerollForm(item,form,plan,frozen) {
    const available=client.state.options[item.id],lines=item.affixes?.lines||[],slots=item.affixes?.slots||1;
    return '<section class="sw-card"><div class="sw-heading"><h4>能力詞條</h4><span>'+lines.length+'／'+slots+' · '+esc(item.affixes?.quality||'未鑑定')+'</span></div><p class="sw-muted">完整鎖定保留數值；至少留一條可洗。品階、元素、強化與遺物能力保留。</p>'+
      (lines.length?'<div class="sw-affixes">'+lines.map(line=>{
        const mode=form.locks.includes(line.index)?'full':form.typeLocks.includes(line.index)&&form.background?'type':'none';
        const useful=available?.functions?.some(fn=>fn.key===line.key);
        return '<div class="sw-affix"><div><b>'+esc(line.name)+' +'+pct(line.value)+'</b><small>'+esc(line.quality)+' · 潛力 '+fmt(line.score)+'/100'+(line.recommended?' · 分支推薦':'')+'</small>'+(line.range?'<small>範圍 '+pct(line.range[0])+'–'+pct(line.range[1])+'</small>':'')+'</div><label class="sw-lock-label">處理方式<select name="workshopLock'+line.index+'" data-sw-lock="'+line.index+'" '+(frozen?'disabled':'')+'><option value="none" '+(mode==='none'?'selected':'')+'>重新洗鍊</option><option value="full" '+(mode==='full'?'selected':'')+'>完整保留</option>'+(form.background&&useful?'<option value="type" '+(mode==='type'?'selected':'')+'>保留能力，洗品質</option>':'')+'</select></label></div>';
      }).join('')+'</div>':'<p>尚未鑑定。首次洗鍊會產生 '+slots+' 條能力。</p>')+
      '<label class="sw-toggle"><input type="checkbox" name="workshopAutoReroll" data-sw-auto-reroll '+(form.background?'checked ':'')+(frozen?'disabled':'')+'><span>背景洗鍊到指定條件<small>未完整鎖定的數值可升可降</small></span></label>'+
      (form.background?'<fieldset class="sw-targets" '+(frozen?'disabled':'')+'><legend>能力目標</legend>'+(available?available.functions.map(fn=>'<label><input type="checkbox" name="workshopFunction_'+esc(fn.id)+'" data-sw-function="'+esc(fn.id)+'" '+(form.functions.includes(fn.id)?'checked':'')+'><span>'+esc(fn.name)+(fn.recommended?' ✦':'')+'</span></label>').join(''):'<p>正在讀取目前職業適用能力…</p>')+'</fieldset><div class="sw-fields"><label>目標品質<select name="workshopQuality" data-sw-quality '+(frozen?'disabled':'')+'>'+['','C','B','A','S','SS'].map(q=>'<option value="'+q+'" '+(form.quality===q?'selected':'')+'>'+(q?q+' 以上':'不限品質')+'</option>').join('')+'</select></label><label>累計金幣上限<input name="workshopBudget" data-sw-budget type="number" min="0" step="1" inputmode="numeric" placeholder="不設上限" value="'+esc(form.maxGold)+'" '+(frozen?'disabled':'')+'></label></div><p class="sw-muted">'+esc(plan.rule)+'</p>':'')+'</section>'+costHtml(plan);
  }
  function jobsHtml(frozen) {
    const rows=[...client.state.jobs].sort((a,b)=>Number(b.job.status==='running')-Number(a.job.status==='running')||Number(b.seq||0)-Number(a.seq||0));
    let selected=rows.find(row=>row.job.id===draft.jobId)||rows.find(row=>ownJob(row.job,client.context))||rows[0];
    if(selected)draft.jobId=selected.job.id;
    return '<section class="sw-card"><div class="sw-heading"><h4>背景作業</h4><button type="button" class="sw-link" data-sw-jobs-refresh '+(frozen?'disabled':'')+'>更新狀態</button></div><p class="sw-muted">作業由遊戲持續執行。此處只讀取狀態，不用保持畫面開啟。</p>'+
      (rows.length?'<div class="sw-jobs">'+rows.map(row=>'<button type="button" data-sw-job="'+esc(row.job.id)+'" class="'+(row===selected?'is-selected':'')+'" '+(frozen?'disabled':'')+'><span>'+(kinds[row.kind]==='enhance'?'強化':'洗鍊')+' · '+esc(row.job.itemName)+'</span><small>'+esc(row.job.status==='running'?'進行中':reasons[row.job.reason]||'已結束')+(ownJob(row.job,client.context)?'':' · 其他角色')+'</small></button>').join('')+'</div>':'<p>目前沒有背景強化或洗鍊紀錄。</p>')+'</section>'+
      (selected?jobDetails(selected,frozen):'');
  }
  function jobDetails(row,frozen) {
    const job=row.job,own=ownJob(job,client.context),running=job.status==='running',kind=kinds[row.kind];
    const item=client.state.me.equipment.find(e=>e.id===job.itemId),liveItem=item?{...item,enhance:job.level}:null;
    const cfg=job.config||{},progress=targetState(job.result?.lines||[],job.result?.slots||0,cfg);
    return '<section class="sw-card sw-job-detail" data-sw-job-detail="'+esc(job.id)+'"><span class="sw-eyebrow">'+(own?'目前角色':'其他角色作業')+'</span><h3>'+esc(job.itemName)+'</h3><p class="'+(running?'sw-running':'')+'">'+esc(running?'背景'+(kind==='enhance'?'強化':'洗鍊')+'中':reasons[job.reason]||'作業已結束')+'</p>'+
      '<div class="sw-totals"><div><b>'+fmt(job.attempts)+'</b><span>已執行次數</span></div><div><b>'+fmt(job.spentScrolls)+'</b><span>卷軸使用</span></div><div><b>'+fmt(job.spentGold)+'</b><span>金幣花費</span></div></div>'+
      (kind==='enhance'?'<p>目前 +'+fmt(job.level)+' · 目標 +'+fmt(job.target)+' · '+(job.blessed?'祝福卷':'普通卷')+'</p>'+(running&&liveItem?gainHtml(gain(liveItem,job.target),'若達成目標'):''):
        '<p>'+esc(targetRule(progress,cfg))+'</p><p>金幣上限：'+(cfg.maxGold==null?'不設上限':fmt(cfg.maxGold))+'</p>'+linesHtml(job.result?.lines,cfg.locks,cfg.typeLocks))+
      '<p class="sw-muted">'+(running?'約每 3 秒執行一次，達標、資源不足或停止時結束。':'顯示這次作業保留的實際結果。')+'</p>'+
      (own?'<footer class="sw-actions"><button type="button" class="sw-secondary" data-sw-open-item="'+esc(job.itemId)+'" '+(!item||frozen?'disabled':'')+'>查看目前裝備</button>'+(running?'<button type="button" class="sw-primary sw-stop" data-sw-stop="'+esc(job.id)+'" '+(frozen?'disabled':'')+'>停止'+(kind==='enhance'?'強化':'洗鍊')+'</button>':'')+'</footer>':'<p class="sw-muted">這項作業屬於另一角色；切換到該角色後可操作。</p>')+'</section>';
  }
  function paint() {
    if(disposed||!client.current())return;
    const state=client.state,me=state.me,scroll=restoreScroll??(firstPaint?Number(draft.scrollTop||0):root.scrollTop);restoreScroll=null;
    const focused=typeof document!=='undefined'?document.activeElement:null,focusName=root.contains?.(focused)?focused?.name:null,caret=focusName&&focused?.type==='search'?focused.selectionStart:null;
    if(lastPreview!==state.preview){lastPreview=state.preview;acknowledged=false;}
    const frozen=state.busy||state.loading||!!state.pending||!!state.preview;
    const alert=state.error?'<p class="sw-warning" role="alert">'+esc(state.error)+'</p>':'';
    const jobsError=state.jobsError?'<p class="sw-warning" role="status">背景狀態尚未同步：'+esc(state.jobsError)+'</p>':'';
    let content='';
    if(!me||!state.meta)content='<section class="sw-card"><p role="status">'+(state.loading?'正在讀取裝備與工坊資料…':'工坊資料尚未完整，請更新資料。')+'</p><button type="button" class="sw-primary" data-sw-refresh '+(state.loading?'disabled':'')+'>更新資料</button></section>';
    else if(state.preview&&!state.pending)content=previewHtml(state.preview,acknowledged,state.busy);
    else{
      if(state.pending)content+='<section class="sw-card sw-pending" aria-label="待核對工坊操作"><h3>上一筆結果尚待確認</h3><p>'+esc(state.pending.itemName||'背景作業')+'</p><p>'+(state.pending.action==='auto-reroll/start'?'會以相同操作編號與原設定取回作業。':'只核對原操作與目前狀態，不會再次消耗材料或重新開工。')+'</p><button type="button" class="sw-primary" data-sw-recover '+(state.busy?'disabled':'')+'>'+(state.busy?'正在核對…':'核對上一筆結果')+'</button></section>';
      content+=resultHtml(state.result);
      if(draft.tab==='jobs')content+=jobsHtml(frozen);
      else{
        const item=me.equipment.find(row=>row.id===draft.itemId);
        content+='<div class="sw-layout"><div>'+itemSelector(me,frozen)+'</div><div class="sw-operation">';
        if(item){
          const form=itemForm(item),plan=client.plan(selection());
          content+=draft.tab==='reroll'?rerollForm(item,form.reroll,plan,frozen):enhanceForm(item,form.enhance,plan,frozen);
          if(plan.party)content+='<p class="sw-muted">組隊期間，僅星環遠征中的未穿戴背包裝備可加工。</p>';
          content+=(plan.error?'<p class="sw-warning" role="status">'+esc(plan.error)+'</p>':'')+
            '<footer class="sw-actions"><button type="button" class="sw-secondary" data-sw-open-item="'+esc(item.id)+'" '+(frozen?'disabled':'')+'>裝備明細</button><button type="button" class="sw-primary" data-sw-preview '+(frozen||plan.error?'disabled':'')+'>'+(state.busy?'正在同步預覽…':plan.background?'預覽背景作業':'預覽本次'+(draft.tab==='reroll'?'洗鍊':'強化'))+'</button></footer>';
        }
        content+='</div></div>';
      }
    }
    const gold=state.balance&&Number(state.balance.revision)>=Number(me?.character?.revision||0)?state.balance.gold:me?.character?.gold;
    root.innerHTML='<section class="scene-workshop"><header class="sw-heading"><div><span class="sw-eyebrow">營地 · 主場工坊</span><h3>強化與洗鍊</h3><p>'+esc(me?.character?.name||host.getActor?.()?.name||'目前角色')+' · 金幣 '+(me?fmt(gold):'—')+'</p></div><button type="button" class="sw-link" data-sw-refresh '+(state.busy||state.loading?'disabled':'')+'>更新資料</button></header>'+
      '<nav class="sw-tabs" aria-label="工坊項目">'+[['enhance','裝備強化'],['reroll','詞條洗鍊'],['jobs','背景作業']].map(([id,label])=>'<button type="button" data-sw-tab="'+id+'" aria-pressed="'+(draft.tab===id)+'" '+(state.busy||state.preview?'disabled':'')+'>'+label+'</button>').join('')+'</nav>'+alert+jobsError+content+
      '<nav class="sw-related" aria-label="其他裝備服務"><button type="button" class="sw-link" data-sw-nav="inventory" '+(state.busy?'disabled':'')+'>背包</button><button type="button" class="sw-link" data-sw-nav="recovery" '+(state.busy?'disabled':'')+'>典藏與精煉</button><button type="button" class="sw-link" data-sw-nav="gearbook" '+(state.busy?'disabled':'')+'>舊收藏</button></nav></section>';
    bind();root.scrollTop=scroll;firstPaint=false;
    if(focusName){const input=[...root.querySelectorAll('[name]')].find(node=>node.name===focusName);input?.focus?.({preventScroll:true});if(caret!=null)input?.setSelectionRange?.(caret,caret);}
    schedule();loadCurrentOptions();
  }
  const onScroll=()=>{draft.scrollTop=root.scrollTop;};
  const cancelPreview=()=>{if(client.state.preview&&!client.state.busy)restoreScroll=Number(draft.formScroll??draft.scrollTop??0);return client.cancelPreview();};
  root.addEventListener('scroll',onScroll,{passive:true});
  function bind() {
    const each=(selector,fn)=>root.querySelectorAll(selector).forEach(fn);
    each('[data-sw-refresh]',button=>button.onclick=()=>client.refresh());
    each('[data-sw-tab]',button=>button.onclick=()=>{draft.tab=button.dataset.swTab;client.state.error='';paint();});
    each('[data-sw-nav]',button=>button.onclick=()=>{onScroll();host.navigate?.(button.dataset.swNav,button.dataset.swNav==='recovery'&&draft.itemId?{itemId:draft.itemId}:{});});
    each('[data-sw-open-item]',button=>button.onclick=()=>{onScroll();host.navigate?.('item',{itemId:button.dataset.swOpenItem});});
    const item=root.querySelector('[data-sw-item]');
    if(item)item.onchange=()=>{draft.itemId=item.value;client.state.error='';client.state.result=null;paint();};
    each('[data-sw-mode]',input=>input.onchange=()=>{const form=itemForm().enhance;form.mode=input.value;if(form.mode==='guaranteed')form.background=false;paint();});
    const autoEnhance=root.querySelector('[data-sw-auto-enhance]');
    if(autoEnhance)autoEnhance.onchange=()=>{const form=itemForm().enhance;form.background=autoEnhance.checked;const item=client.state.me.equipment.find(row=>row.id===draft.itemId);if(Number(form.target)<=Number(item.enhance))form.target=Number(item.enhance)+1;paint();};
    const target=root.querySelector('[data-sw-target]');if(target)target.onchange=()=>{itemForm().enhance.target=Number(target.value);paint();};
    const autoReroll=root.querySelector('[data-sw-auto-reroll]');if(autoReroll)autoReroll.onchange=()=>{const form=itemForm().reroll;form.background=autoReroll.checked;if(!form.background)form.typeLocks=[];paint();};
    each('[data-sw-lock]',input=>input.onchange=()=>{const form=itemForm().reroll,index=Number(input.dataset.swLock);form.locks=form.locks.filter(i=>i!==index);form.typeLocks=form.typeLocks.filter(i=>i!==index);if(input.value==='full')form.locks.push(index);if(input.value==='type')form.typeLocks.push(index);paint();});
    each('[data-sw-function]',input=>input.onchange=()=>{const form=itemForm().reroll;form.functions=[...root.querySelectorAll('[data-sw-function]:checked')].map(node=>node.dataset.swFunction);paint();});
    const quality=root.querySelector('[data-sw-quality]');if(quality)quality.onchange=()=>{itemForm().reroll.quality=quality.value;paint();};
    const budget=root.querySelector('[data-sw-budget]');if(budget)budget.oninput=()=>{itemForm().reroll.maxGold=budget.value;paint();};
    const preview=root.querySelector('[data-sw-preview]');if(preview)preview.onclick=()=>{onScroll();draft.formScroll=root.scrollTop;client.preview(selection());};
    const cancel=root.querySelector('[data-sw-cancel]');if(cancel)cancel.onclick=()=>cancelPreview();
    const ack=root.querySelector('[data-sw-ack]');if(ack)ack.onchange=()=>{acknowledged=ack.checked;const button=root.querySelector('[data-sw-confirm]');if(button)button.disabled=!acknowledged||client.state.busy;};
    const confirm=root.querySelector('[data-sw-confirm]');if(confirm)confirm.onclick=()=>client.confirm(acknowledged);
    const recover=root.querySelector('[data-sw-recover]');if(recover)recover.onclick=()=>client.recover();
    const clear=root.querySelector('[data-sw-result-clear]');if(clear)clear.onclick=()=>{client.state.result=null;paint();};
    const refreshJobs=root.querySelector('[data-sw-jobs-refresh]');if(refreshJobs)refreshJobs.onclick=()=>client.refreshJobs();
    each('[data-sw-job]',button=>button.onclick=()=>{draft.jobId=button.dataset.swJob;paint();});
    const stop=root.querySelector('[data-sw-stop]');if(stop)stop.onclick=()=>{draft.formScroll=root.scrollTop;client.previewStop(stop.dataset.swStop);};
  }
  paint();void client.refresh();
  return {dispose(){onScroll();disposed=true;clearTimeout(timer);root.removeEventListener('scroll',onScroll);client.dispose();},
    update(){if(client.current())paint();},handleBack(){return cancelPreview();},client};
}
window.RpgSceneWorkshop={mount,createClient,enhancePlan,rerollPlan,targetState,targetRule,previewHtml,resultHtml};
})();
