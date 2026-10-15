(function () {
  'use strict';
  const C=window.RpgGuardianContract;
  if(!C)throw Error('guardian-sigil-contract.js must load before guardian-fusion-ui.js');
  const mounts=new WeakMap(),TYPES=Object.keys(C.TYPE_NAMES);
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>value===null||value===undefined?'—':Number(value).toLocaleString('zh-TW');
  const order=config=>config?.qualityOrder?.filter(q=>C.QUALITY_ORDER.includes(q))||[...C.QUALITY_ORDER];
  const stageFor=(config,quality)=>config?.rules?.upgradeStages?.find(stage=>stage.from===quality)||null;
  const protectedItem=item=>!!(item.active||item.locked||item.inTrade||item.inExchange||item.exchangeId||item.exchange_id||item.trade_id);
  const inventory=state=>{const seen=new Set();return (state?.inventory?.items||[]).filter(item=>item&&typeof item.id==='string'&&item.id&&TYPES.includes(item.type)&&C.QUALITY_ORDER.includes(item.quality)&&!seen.has(item.id)&&seen.add(item.id));};
  const validStage=stage=>stage&&[4,6].includes(stage.materials)&&typeof stage.mixedTypes==='boolean'&&Number.isSafeInteger(stage.goldFee)&&stage.goldFee>=0&&typeof stage.successRate==='number'&&stage.successRate>=0&&stage.successRate<=1;
  const typeName=(config,type)=>config.types?.find(row=>row.id===type)?.name||C.TYPE_NAMES[type];
  const qualityName=(config,quality)=>config.qualities?.find(row=>row.id===quality)?.name||C.QUALITY_NAMES[quality];
  const actor=state=>String(state?.charId||'');
  const eligibleCount=(state,quality)=>Number.isSafeInteger(state?.inventory?.eligibleCounts?.[quality])?state.inventory.eligibleCounts[quality]:inventory(state).filter(row=>row.quality===quality&&!protectedItem(row)).length;
  const copy=selection=>({...selection,itemIds:[...selection.itemIds],...(selection.groups?{groups:selection.groups.map(group=>({...group,itemIds:[...group.itemIds]}))}:{})});
  const fresh=(config,state,quality)=>({charId:actor(state),quality:order(config).includes(quality)?quality:order(config)[0]||'white',itemIds:[],primaryId:null,notice:''});

  function createSelection(config,state,quality) {return fresh(config,state,quality);}
  function normalize(config,state,input={}) {
    input=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
    const next=fresh(config,state,input.quality);
    if(input.charId!==actor(state))return next;
    const rows=inventory(state),stage=stageFor(config,next.quality),byId=new Map(rows.map(row=>[row.id,row]));
    if(input.batch&&validStage(stage)&&Array.isArray(input.groups)){
      const seen=new Set(),groups=[];
      for(const group of input.groups){const items=group?.itemIds?.map(id=>byId.get(id))||[],primary=byId.get(group?.primaryId);
        if(items.length!==stage.materials||!primary||!items.includes(primary)||items.some(row=>!row||row.quality!==next.quality||protectedItem(row)||seen.has(row.id))||new Set(items.map(row=>row.id)).size!==items.length||!stage.mixedTypes&&items.some(row=>row.type!==primary.type))return {...next,notice:'登錄素材的狀態已改變，請重新一鍵登錄。'};
        items.forEach(row=>seen.add(row.id));groups.push({itemIds:items.map(row=>row.id),primaryId:primary.id});
      }
      return {...next,batch:true,groups,itemIds:groups.flatMap(group=>group.itemIds),primaryId:groups[0]?.primaryId||null,notice:input.notice||''};
    }
    const selected=Array.isArray(input.itemIds)?[...new Set(input.itemIds.filter(id=>typeof id==='string'))]:[];
    if(input.primaryId) {
      const primary=byId.get(input.primaryId);
      if(!primary||primary.quality!==next.quality||protectedItem(primary)||!selected.includes(primary.id))return {...next,notice:'主天使的狀態已更新，請重新選擇素材。'};
      next.primaryId=primary.id;
    } else next.primaryId=selected.find(id=>{const row=byId.get(id);return row&&row.quality===next.quality&&!protectedItem(row);})||null;
    const primary=byId.get(next.primaryId);
    if(!primary||!stage)return next;
    const compatible=row=>row&&row.quality===next.quality&&!protectedItem(row)&&(row.id===primary.id||stage.mixedTypes===true||stage.mixedTypes===false&&row.type===primary.type);
    next.itemIds=[primary.id,...selected.filter(id=>id!==primary.id&&compatible(byId.get(id)))].slice(0,stage.materials);
    next.notice=typeof input.notice==='string'?input.notice:'';
    return next;
  }
  function setQuality(config,state,selection,quality) {
    if(!order(config).includes(quality))return normalize(config,state,selection);
    return fresh(config,state,quality);
  }
  function toggle(config,state,selection,id) {
    const next=normalize(config,state,selection),item=inventory(state).find(row=>row.id===id),stage=stageFor(config,next.quality);
    if(!item||item.quality!==next.quality||protectedItem(item)||!stage)return next;
    if(next.batch){const groups=next.groups.filter(group=>!group.itemIds.includes(id));return normalize(config,state,{...next,groups,notice:groups.length!==next.groups.length?'已取消這一組；其他已登錄素材保留。':next.notice});}
    next.notice='';
    if(next.itemIds.includes(id)) {
      next.itemIds=next.itemIds.filter(value=>value!==id);if(next.primaryId===id)next.primaryId=next.itemIds[0]||null;
      return normalize(config,state,next);
    }
    if(!next.primaryId) {next.primaryId=id;next.itemIds=[id];return next;}
    const primary=inventory(state).find(row=>row.id===next.primaryId);
    if(!validStage(stage)||next.itemIds.length>=stage.materials||stage.mixedTypes===false&&item.type!==primary.type)return next;
    next.itemIds.push(id);return next;
  }
  function fill(config,state,selection) {
    const next=normalize(config,state,selection),stage=stageFor(config,next.quality);
    if(!validStage(stage))return next;
    const byLeastBinding=(a,b)=>Number(a.bound)-Number(b.bound)||Number(a.createdAt||0)-Number(b.createdAt||0)||a.id.localeCompare(b.id);
    const rows=inventory(state).filter(item=>item.quality===next.quality&&!protectedItem(item));
    const pools=stage.mixedTypes?[rows]:TYPES.map(type=>rows.filter(row=>row.type===type));
    const groups=[];
    for(const pool of pools){pool.sort(byLeastBinding);const count=Math.floor(pool.length/stage.materials)*stage.materials;
      if(count&&pool.some(row=>row.id===next.primaryId)){const at=pool.findIndex(row=>row.id===next.primaryId);pool.unshift(...pool.splice(at,1));}
      for(let i=0;i<count;i+=stage.materials){const ids=pool.slice(i,i+stage.materials).map(row=>row.id);groups.push({itemIds:ids,primaryId:ids[0]});}
    }
    groups.sort((a,b)=>Number(b.primaryId===next.primaryId)-Number(a.primaryId===next.primaryId));
    return normalize(config,state,{...next,batch:true,groups,notice:groups.length?'已登錄全部完整組；不足一組的天使已保留。':'目前沒有可湊齊的完整組，所有天使皆保留。'});
  }
  function quote(config,state,selection) {
    const next=normalize(config,state,selection),stage=stageFor(config,next.quality),byId=new Map(inventory(state).map(row=>[row.id,row]));
    const items=next.itemIds.map(id=>byId.get(id)),primary=byId.get(next.primaryId)||null,groupCount=next.batch?next.groups.length:items.length===stage?.materials?1:0,fee=validStage(stage)?stage.goldFee*Math.max(1,groupCount):stage?.goldFee??null;
    let reason='';
    if(!state||!actor(state))reason='請先載入守護背包。';
    else if(!C.canAction(config,state,'fuse'))reason=state.unlocked===false?'天使合成於 15 級開放。':'合成規則尚未開放，請更新狀態。';
    else if(!stage)reason='已抵達最高品質，這份羽光無需再升階。';
    else if(!validStage(stage))reason='合成規則尚未完整，請更新狀態。';
    else if(!primary)reason=next.notice||'點選第一位天使，作為本輪主天使。';
    else if(!groupCount)reason=`還需要 ${fmt(stage.materials-items.length)} 位同品質${stage.mixedTypes?'':'、同類型'}天使。`;
    else if(!Number.isSafeInteger(state.balances?.gold))reason='金幣資料尚未載入，請更新狀態。';
    else if(state.balances.gold<fee)reason=`金幣不足，${fmt(groupCount)} 組合成共需 ${fmt(fee)} 金幣。`;
    const ok=!reason;
    return {ok,canPrepare:ok,reason,selection:next,stage,primary,items,selectedCount:items.length,requiredCount:stage?.materials??null,missingCount:stage?Math.max(0,stage.materials-items.length):null,
      fee,groupCount,successRate:stage?.successRate??null,binding:items.some(row=>row.bound),resultQuality:stage?.to??null,quality:next.quality,primaryType:primary?.type??null,
      eligibleCount:eligibleCount(state,next.quality)};
  }
  function freeze(config,state,selection) {
    const q=quote(config,state,selection);if(!q.ok)throw Error(q.reason);
    if(typeof config.configVersion!=='string'||!config.configVersion)throw Error('合成規則版本尚未載入，請更新狀態。');
    return Object.freeze({itemIds:Object.freeze([...q.selection.itemIds]),primaryId:q.primary.id,configVersion:config.configVersion,...(q.selection.batch?{groups:Object.freeze(q.selection.groups.map(group=>Object.freeze({itemIds:Object.freeze([...group.itemIds]),primaryId:group.primaryId})))}:{})});
  }
  function markup(config,state,selection,options={}) {
    const q=quote(config,state,selection),next=q.selection,rows=inventory(state),stage=q.stage,disabled=options.disabled===true;
    const primary=q.primary;
    const empty=options.loading===true?'<div class="guardian-fusion-empty" role="status">正在尋找這個品質的天使…</div>':q.eligibleCount>0?'<div class="guardian-fusion-empty">請載入這個品質的天使。<small>背包還有可合成素材。</small></div>':'<div class="guardian-fusion-empty">這個品質還沒有天使。<small>試試其他品質，或載入更多背包內容。</small></div>';
    const cards=rows.filter(item=>item.quality===next.quality).map(item=>{
      const selected=next.itemIds.includes(item.id),isPrimary=next.batch?next.groups.some(group=>group.primaryId===item.id):item.id===next.primaryId,protectedCard=protectedItem(item),compatible=!primary||stage?.mixedTypes===true||item.type===primary.type;
      const blocked=disabled||protectedCard||!stage||!selected&&(next.batch||!compatible||stage.mixedTypes===null||next.itemIds.length>=stage.materials);
      const kind=config.types?.find(row=>row.id===item.type),art=C.safeArtUrl(kind?.artUrl)||`/art/guardian-sigil-20261013/${item.type}.webp`;
      const status=item.active?'參戰／守護中':item.locked?'已鎖定':item.inTrade||item.inExchange||item.exchangeId?'交易保管中':item.bound?'已綁定':'未綁定';
      return `<button type="button" class="guardian-fusion-card guardian-quality-${item.quality}${selected?' is-selected':''}${isPrimary?' is-primary':''}" data-guardian-fusion-item="${esc(item.id)}" aria-pressed="${selected}" aria-label="${esc(typeName(config,item.type))}，${esc(qualityName(config,item.quality))}色，${esc(status)}${isPrimary?'，主天使':selected?'，已選素材':''}" ${blocked?'disabled':''}><span class="guardian-fusion-check" aria-hidden="true">${selected?'✓':''}</span><span class="guardian-fusion-art"><img src="${esc(art)}" alt="" loading="lazy" decoding="async" draggable="false"></span><strong>${esc(typeName(config,item.type).replace(/^天使・/,''))}</strong><small>${isPrimary?'主天使 · 失敗保留':esc(status)}</small>${protectedCard?'<span class="guardian-fusion-protected">不可合成</span>':''}</button>`;
    }).join('');
    return `<section class="guardian-fusion-ui" data-guardian-fusion-ui aria-label="天使合成"><header class="guardian-fusion-heading"><small>同色羽光 · 共赴新生</small><h3>天使合成</h3><p>自行選素材，或一鍵登錄這個品質的全部完整組。</p></header><nav class="guardian-fusion-quality-tabs" role="tablist" aria-label="選擇合成品質">${order(config).map(quality=>`<button type="button" role="tab" class="guardian-quality-${quality}${quality===next.quality?' is-selected':''}" data-guardian-fusion-quality="${quality}" aria-selected="${quality===next.quality}" ${disabled?'disabled':''}><span>${esc(qualityName(config,quality))}色</span><small>${eligibleCount(state,quality)}</small></button>`).join('')}</nav><div class="guardian-fusion-toolbar"><span>已選 <strong>${next.batch?`${fmt(q.selectedCount)} 張 · ${fmt(q.groupCount)} 組`:`${fmt(q.selectedCount)}／${fmt(q.requiredCount)}`}</strong></span><button type="button" data-guardian-fusion-fill ${disabled||!validStage(stage)||!q.eligibleCount?'disabled':''}>一鍵登錄</button></div><div class="guardian-fusion-grid" aria-label="${esc(qualityName(config,next.quality))}色天使素材">${cards||empty}</div><footer class="guardian-fusion-footer"><div class="guardian-fusion-primary"><span>主天使</span><strong${primary?' class="guardian-name guardian-quality-'+primary.quality+'"':''}>${primary?esc(typeName(config,primary.type)):'尚未選擇'}</strong><small>${next.batch?"每組各有主天使；失敗只保留該組主天使。":"成功繼承類型；失敗保留這一位。"}</small></div>${stage?`<div class="guardian-fusion-cost"><span>${esc(qualityName(config,stage.from))}色 <b>→</b> ${esc(qualityName(config,stage.to))}色</span><strong>${fmt(q.fee)} <small>金幣${next.batch?` · ${fmt(q.groupCount)} 組合計`:""}</small></strong><small>成功率 ${stage.successRate===null?'—':fmt(stage.successRate*100)}% · ${fmt(stage.materials)} 位素材 · ${stage.mixedTypes===true?'可混合類型':stage.mixedTypes===false?'須同類型':'規則待確認'}</small></div>`:''}<p class="guardian-fusion-binding">${q.items.length?q.binding?'含綁定素材：各組獨立繼承綁定；新天使與失敗保留的主天使都會綁定。':'所選素材皆未綁定，結果也保持未綁定。':'綁定素材可以合成，結果會繼承綁定。'}</p><p class="guardian-fusion-hint" role="status">${esc(q.reason||next.notice||'素材已就緒，進入舞台向下拉神羽，才會開始合成。')}</p>${state?.inventory?.nextCursor?'<p class="guardian-fusion-more-note">一鍵登錄會讀取這個品質的全部背包，只保留完整組。</p>':''}<button type="button" class="guardian-fusion-prepare" data-guardian-fusion-prepare ${disabled||!q.ok?'disabled':''}>${next.batch?`合成 ${fmt(q.groupCount)} 組`:"合成"}</button>${next.batch?`<small>點任一已勾選天使可取消整組；不足一組的素材不投入。</small>`:""}</footer></section>`;
  }
  function mount(root,options={}) {
    if(!root||typeof root.addEventListener!=='function')throw TypeError('A fusion container is required');
    mounts.get(root)?.cleanup();let disposed=false,config=options.config,state=options.state,selection=normalize(config,state,options.selection||createSelection(config,state)),disabled=options.disabled===true,loading=options.loading===true;
    function paint() {if(!disposed)root.innerHTML=markup(config,state,selection,{disabled,loading});}
    function changed(next) {selection=next;paint();options.onChange?.(copy(selection));}
    function click(event) {
      const button=event.target.closest?.('button');if(disposed||disabled||!button||button.disabled||!root.contains(button))return;
      if(button.hasAttribute('data-guardian-fusion-quality'))changed(setQuality(config,state,selection,button.dataset.guardianFusionQuality));
      else if(button.hasAttribute('data-guardian-fusion-item'))changed(toggle(config,state,selection,button.dataset.guardianFusionItem));
      else if(button.hasAttribute('data-guardian-fusion-fill')){if(options.onFill)options.onFill(copy(selection));else changed(fill(config,state,selection));}
      else if(button.hasAttribute('data-guardian-fusion-prepare'))try{options.onPrepare?.(freeze(config,state,selection),quote(config,state,selection));}catch(error){options.onError?.(error.message);}
    }
    root.addEventListener('click',click);paint();
    const handle={update(nextConfig,nextState,nextSelection=selection,nextOptions={}){if(disposed)return;config=nextConfig;state=nextState;selection=normalize(config,state,nextSelection);if(Object.hasOwn(nextOptions,'disabled'))disabled=nextOptions.disabled===true;if(Object.hasOwn(nextOptions,'loading'))loading=nextOptions.loading===true;paint();return copy(selection);},selection:()=>copy(selection),quote:()=>quote(config,state,selection),prepare:()=>freeze(config,state,selection),cleanup(){if(disposed)return;disposed=true;root.removeEventListener('click',click);if(mounts.get(root)===handle)mounts.delete(root);}};
    mounts.set(root,handle);return handle;
  }
  window.RpgGuardianFusionUI=Object.freeze({createSelection,normalize,setQuality,toggle,fill,quote,freeze,markup,mount});
})();
