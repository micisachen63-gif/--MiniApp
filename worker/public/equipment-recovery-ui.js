(() => {
 'use strict';
 const memory=new Map(),modes={archive:'首次典藏',salvage:'重複精煉',reforge:'材料重洗'};
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const number=value=>Number(value||0).toLocaleString('zh-TW');
 const sameIds=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
 function createClient(host,onChange=()=>{}){
  const characterId=String(host.characterId),realmId=String(host.realmId),key='equipment-recovery:pending:'+realmId+':'+characterId,initialEpoch=host.getContext?.()?.epoch;
  const state={snapshot:null,preview:null,pending:null,result:null,error:'',loading:false,busy:false};
  let disposed=false,generation=0,storage;try{storage=host.storage||(typeof sessionStorage!=='undefined'?sessionStorage:null);}catch{}
  const current=()=>{if(disposed||host.current&&!host.current())return false;const context=host.getContext?.();return !context||((context.realmId==null||String(context.realmId)===realmId)&&(context.characterId==null||String(context.characterId)===characterId)&&(initialEpoch==null||context.epoch===initialEpoch));};
  const notify=()=>{if(current())onChange(state);};
  const validPending=p=>p?.action==='equipment-recovery/action'&&p.scope===key&&['archive','salvage','reforge'].includes(p.payload?.mode)&&Array.isArray(p.payload.itemIds)&&p.payload.itemIds.length>0&&p.payload.itemIds.length<=50&&p.payload.itemIds.every(id=>typeof id==='string')&&/^[a-f0-9]{64}$/.test(p.payload.token||'')&&/^[A-Za-z0-9_:-]{6,96}$/.test(p.payload.requestId||'')&&p.payload.acknowledge===true;
  try{const saved=JSON.parse(storage?.getItem(key)||'null');if(validPending(saved))state.pending=saved;}catch{}
  if(!state.pending&&validPending(memory.get(key)))state.pending=memory.get(key);
  function persist(operation){state.pending=operation;memory.set(key,operation);try{storage?.setItem(key,JSON.stringify(operation));}catch{}}
  function clear(operation){if(state.pending?.payload.requestId===operation.payload.requestId)state.pending=null;if(memory.get(key)?.payload.requestId===operation.payload.requestId)memory.delete(key);try{const saved=JSON.parse(storage?.getItem(key)||'null');if(saved?.payload?.requestId===operation.payload.requestId)storage.removeItem(key);}catch{}}
  function check(data){if(String(data?.realmId)!==realmId||String(data?.characterId)!==characterId){const error=Error('角色或世界已切換，請重新開啟此視窗');error.code='context_changed';error.uncertain=true;throw error;}}
  async function refresh(keepError=false){
   if(!current()||state.busy)return null;const version=++generation;state.loading=true;if(!keepError)state.error='';notify();
   try{const data=await host.request('equipment-recovery');if(!current()||version!==generation)return null;check(data);state.snapshot=data;return data;}
   catch(error){if(current()&&version===generation)state.error=error.message;return null;}
   finally{if(current()&&version===generation){state.loading=false;notify();}}
  }
  async function preview(mode,itemIds){
   if(!current()||state.busy||state.pending)return null;
   if(!modes[mode]||!Array.isArray(itemIds)||!itemIds.length||itemIds.length>(mode==='reforge'?1:50)||new Set(itemIds).size!==itemIds.length){state.error='請選取不同裝備；每次最多 50 件，重洗一次 1 件';notify();return null;}
   const ids=[...itemIds].sort(),version=++generation;state.busy=true;state.loading=false;state.error='';state.result=null;state.preview=null;notify();
   try{const data=await host.request('equipment-recovery/preview',{mode,itemIds:ids});if(!current()||version!==generation)return null;check(data);
    if(data.mode!==mode||!Array.isArray(data.items)||!sameIds(data.items.map(item=>item.id),ids)||!/^[a-f0-9]{64}$/.test(data.token||''))throw Error('預覽與選取清單不一致，請重新同步');
    state.preview=data;return data;
   }catch(error){if(current()&&version===generation)state.error=error.message;return null;}
   finally{if(current()&&version===generation){state.busy=false;notify();}}
  }
  async function perform(operation){
   if(!current()||state.busy)return null;const version=++generation;persist(operation);state.preview=null;state.busy=true;state.loading=false;state.error='';notify();let refreshAfter=false,result=null;
   try{const data=await host.request(operation.action,operation.payload);if(!current()||version!==generation)return null;check(data);clear(operation);state.snapshot=data;state.result=data.result||null;result=data;}
   catch(error){if(current()&&version===generation){state.error=error.message;if(!error.uncertain&&error.status>=400&&error.status<500&&!['context_changed','request_cancelled'].includes(error.code)){clear(operation);refreshAfter=true;}}}
   finally{if(current()&&version===generation){state.busy=false;notify();}}
   if(result&&current())host.onChanged?.(result.result);
   if(refreshAfter&&current())await refresh(true);
   return result;
  }
  async function confirm({acknowledge=false,confirmHighValue=false}={}){
   if(!current()||state.busy||state.pending||!state.preview)return null;const approved=state.preview;
   if(!acknowledge||approved.requiresHighValueConfirmation&&!confirmHighValue){state.error=approved.requiresHighValueConfirmation?'請完成裝備消耗與高價裝備兩項確認':'請先確認預覽所列的裝備與消耗';notify();return null;}
   const payload={mode:approved.mode,itemIds:approved.items.map(item=>item.id).sort(),token:approved.token,requestId:host.requestId?host.requestId():crypto.randomUUID(),acknowledge:true,confirmHighValue:confirmHighValue===true};
   return perform({scope:key,action:'equipment-recovery/action',payload,approved});
  }
  function retry(){return state.pending?perform(state.pending):Promise.resolve(null);}
  function cancelPreview(){if(!state.busy&&!state.pending){generation++;state.preview=null;state.error='';notify();}}
  return {state,refresh,preview,confirm,retry,cancelPreview,current,dispose(){disposed=true;generation++;}};
 }
 function suggestedItems(items,mode,limit=50){
  const found=[],identities=new Set();
  for(const item of items){
   if(item.blockedReason||item.highValue||item.legacyNeeded)continue;
   if(mode==='salvage'&&(!item.suggestedSalvage||!(item.dust>0)))continue;
   if(mode==='archive'&&(item.archived||!item.entryId||identities.has(item.entryId)))continue;
   if(!['archive','salvage'].includes(mode))continue;
   found.push(item.id);identities.add(item.entryId);if(found.length>=Math.min(50,limit))break;
  }
  return found;
 }
 function previewHtml(preview,art=()=> ''){
  const consume=preview.consumesEquipment;
  return '<section class="recovery-confirm" aria-label="確認裝備方案"><h3>確認'+esc(modes[preview.mode]||preview.mode)+'</h3><p class="recovery-warning">'+esc(preview.warning)+'</p><ul class="recovery-confirm-list">'+preview.items.map(item=>'<li>'+art(item.icon)+'<div><strong>'+esc(item.name)+' <b>+'+number(item.enhance)+'</b></strong><small>'+esc(item.sourceName)+' · T'+number(item.tier)+' · '+esc(item.rarityName)+(item.highValue?' · 高價裝備':'')+'</small></div></li>').join('')+'</ul><p>'+(
   preview.mode==='archive'?'永久典藏 '+number(preview.newEntries)+' 款，消耗上列 '+number(preview.items.length)+' 件裝備，不新增永久戰力。':
   preview.mode==='salvage'?'消耗 '+number(preview.items.length)+' 件裝備，取得 '+number(preview.dustGained)+' 精煉材料。':
   '消耗 '+number(preview.cost?.dust)+' 精煉材料與 '+number(preview.cost?.gold)+' 金幣。保留此件裝備及原強化值，重洗所有獨立詞條。'
  )+'</p><label class="recovery-ack"><input type="checkbox" data-recovery-ack> '+(consume?'我已核對清單，了解裝備會永久消耗且無法取回':'我了解全部詞條會重新隨機，結果可能變強或變弱')+'</label>'+
  (preview.requiresHighValueConfirmation?'<label class="recovery-ack recovery-warning"><input type="checkbox" data-recovery-high> 我另外確認消耗清單中的強化、高品質或遺物裝備</label>':'')+
  '<div class="recovery-actions"><button type="button" data-recovery-cancel>返回選擇</button><button type="button" data-recovery-confirm disabled>'+ (consume?'確認永久消耗 '+number(preview.items.length)+' 件':'確認重洗詞條')+'</button></div></section>';
 }
 function mount(root,host){
  let mode='archive',source='all',search='',page=0,records=false,disposed=false,lastResult=null;const selected=new Set(),pageSize=18;
  if(typeof document!=='undefined'&&!document.querySelector('link[data-equipment-recovery-style]')){const link=document.createElement('link');link.rel='stylesheet';link.dataset.equipmentRecoveryStyle='true';const script=document.querySelector('script[src*="equipment-recovery-ui.js"]');link.href=new URL('equipment-recovery-ui.css?v=idle-content-20261104',script?.src||document.baseURI).href;document.head.append(link);}
  const art=src=>src?'<img src="'+esc(host.artUrl?host.artUrl(src):src)+'" alt="" loading="lazy" decoding="async">':'';
  const client=createClient(host,paint);
  function resetSelection(){selected.clear();page=0;client.cancelPreview();}
  function eligible(item,snapshot){
   if(snapshot.lockedReason||item.blockedReason)return item.blockedReason||snapshot.lockedReason;
   if(mode==='archive'&&item.archived)return '這個款式已典藏';
   if(mode==='archive'&&[...selected].some(id=>id!==item.id&&snapshot.items.find(row=>row.id===id)?.entryId===item.entryId))return '此款式已選取另一件';
   if(mode==='salvage'&&!(item.dust>0))return '沒有精煉產出，可留用或首次典藏';
   if(mode==='reforge'&&(snapshot.dust<item.reforgeCost?.dust||snapshot.gold<item.reforgeCost?.gold))return '精煉材料或金幣不足';
   return null;
  }
  function paint(){
   if(disposed||!client.current())return;const state=client.state,snapshot=state.snapshot,scroll=root.scrollTop,focused=document.activeElement,focusSearch=root.contains(focused)&&focused.name==='recoverySearch',caret=focusSearch?focused.selectionStart:null;
   if(state.result&&state.result!==lastResult){selected.clear();lastResult=state.result;}
   if(snapshot?.items)for(const id of selected)if(!snapshot.items.some(item=>item.id===id))selected.delete(id);
   const pending=state.pending,preview=state.preview,frozen=state.busy||!!pending||!!preview;
   const notice=state.error?'<p class="recovery-warning" role="alert">'+esc(state.error)+'</p>':'';
   const retry=pending?'<section class="recovery-pending" aria-label="待確認的裝備操作"><h3>上一筆操作尚待確認</h3><p>'+esc(modes[pending.payload.mode])+' · '+number(pending.payload.itemIds.length)+' 件。'+(state.busy?'正在核對原收據…':'請按下方按鈕核對原收據；重試會使用完全相同的清單、方案與操作編號。')+'</p><button type="button" data-recovery-retry '+(state.busy?'disabled':'')+'>核對上一筆結果</button></section>':'';
   const result=state.result?'<p class="recovery-success" role="status">'+esc(modes[state.result.mode])+'已完成 · '+number(state.result.count)+' 件'+(state.result.mode==='salvage'?' · 取得 '+number(state.result.dustGained)+' 精煉材料':state.result.mode==='archive'?' · 新增 '+number(state.result.newEntries)+' 款紀錄':' · 消耗 '+number(state.result.cost?.dust)+' 材料／'+number(state.result.cost?.gold)+' 金幣；詞條品質 '+esc(state.result.affixes?.before?.quality||'—')+' → '+esc(state.result.affixes?.after?.quality||'—'))+'</p>':'';
   if(!snapshot||snapshot.enabled===false){
    root.innerHTML='<section class="gear-recovery"><h3>典藏與精煉</h3>'+notice+retry+result+'<p role="status">'+(!snapshot?(state.loading?'正在同步目前角色的背包…':'尚未讀取背包，請重新同步'):'典藏與精煉尚未開放，舊收藏仍可使用。')+'</p><button type="button" data-recovery-refresh '+(state.busy?'disabled':'')+'>重新同步</button><button type="button" data-recovery-legacy>開啟舊收藏</button></section>';bind();return;
   }
   const filtered=(records?snapshot.entries:snapshot.items).filter(item=>(source==='all'||item.sourceGroup===source)&&(!search||String(item.name).toLocaleLowerCase().includes(search.toLocaleLowerCase()))),pages=Math.max(1,Math.ceil(filtered.length/pageSize));page=Math.min(page,pages-1);
   const list=filtered.slice(page*pageSize,page*pageSize+pageSize).map(item=>{
    if(records)return '<article class="recovery-item">'+art(item.icon)+'<div><strong>'+esc(item.name)+' <b>+'+number(item.enhance)+'</b></strong><small>'+esc(item.sourceName)+' · T'+number(item.tier)+' · '+esc(item.rarityName)+'</small><span class="recovery-tag">'+(item.origin==='legacy_collection'?'舊收藏保留':'已永久典藏')+'</span></div></article>';
    const blocked=eligible(item,snapshot),checked=selected.has(item.id);
    return '<label class="recovery-item '+(checked?'is-selected':'')+'"><input type="'+(mode==='reforge'?'radio':'checkbox')+'" name="recoveryItem" data-recovery-item="'+esc(item.id)+'" '+(checked?'checked ':'')+((frozen||blocked)?'disabled':'')+'>'+art(item.icon)+'<div><strong>'+esc(item.name)+' <b>+'+number(item.enhance)+'</b></strong><small>'+esc(item.sourceName)+' · T'+number(item.tier)+' · '+esc(item.rarityName)+'</small><p>'+(mode==='reforge'?'重洗：'+number(item.reforgeCost?.dust)+' 材料＋'+number(item.reforgeCost?.gold)+' 金幣':mode==='salvage'?'精煉：'+number(item.dust)+' 材料':item.archived?'已典藏':'尚未典藏')+'</p>'+(item.highValue?'<span class="recovery-tag high">高價裝備</span>':'')+(item.legacyNeeded?'<span class="recovery-tag">舊收藏仍需要</span>':'')+(blocked?'<small class="recovery-warning">'+esc(blocked)+'</small>':'')+'</div></label>';
   }).join('');
   root.innerHTML='<section class="gear-recovery"><header class="recovery-summary"><div><small>營地工坊</small><h3>典藏與精煉</h3><p>已典藏 '+number(snapshot.archivedCount)+' 款 · 精煉材料 '+number(snapshot.dust)+' · 金幣 '+number(snapshot.gold)+'</p></div><button type="button" data-recovery-legacy '+(frozen?'disabled':'')+'>舊收藏與永久能力</button></header><p class="recovery-note">'+esc(snapshot.description)+'</p><nav class="recovery-steps" aria-label="裝備整理步驟">'+Object.entries(modes).map(([id,label],i)=>'<button type="button" data-recovery-mode="'+id+'" aria-pressed="'+(mode===id)+'" '+(frozen?'disabled':'')+'>'+(i+1)+' · '+label+'</button>').join('')+'</nav>'+notice+retry+result+(snapshot.lockedReason?'<p class="recovery-warning">'+esc(snapshot.lockedReason)+'</p>':'')+(preview?previewHtml(preview,art):'')+'<div class="recovery-workspace" '+(preview?'inert':'')+'><div class="recovery-filters"><label>來源<select name="recoverySource" '+(frozen?'disabled':'')+'><option value="all">所有來源</option>'+snapshot.sources.map(group=>'<option value="'+esc(group.id)+'" '+(source===group.id?'selected':'')+'>'+esc(group.name)+' · 已典藏 '+number(group.count)+'</option>').join('')+'</select></label><label>裝備名稱<input type="search" name="recoverySearch" value="'+esc(search)+'" placeholder="搜尋目前裝備" '+(frozen?'disabled':'')+'></label><button type="button" data-recovery-refresh '+(state.busy?'disabled':'')+'>更新背包</button></div>'+(mode==='archive'?'<div class="recovery-actions"><button type="button" data-recovery-records '+(frozen?'disabled':'')+'>'+(records?'返回背包選擇':'查看全部典藏紀錄')+'</button></div>':'')+'<p class="recovery-note">'+(records?'既有收藏紀錄直接保留，不需要重新交裝。':mode==='archive'?'同來源、職業、部位、階級與品質只需典藏一次；不同轉職武器也分別記錄。':mode==='salvage'?'建議選取會避開高價裝備、舊收藏仍需的裝備，並保留一件尚未典藏的款式。': '重洗會替換所有獨立詞條，可能變強或變弱；原強化值、品質、元素與裝備身分保留。')+'</p>'+(records||mode==='reforge'?'':'<button type="button" data-recovery-suggest '+(frozen||snapshot.lockedReason?'disabled':'')+'>'+(mode==='salvage'?'選取建議重複品':'選取一般未典藏款式')+'（最多 '+number(Math.min(50,snapshot.batchLimit||50))+' 件）</button>')+'<div class="recovery-list">'+(list||'<p class="recovery-note">目前篩選沒有符合的裝備。</p>')+'</div><nav class="recovery-pages" aria-label="裝備分頁"><button type="button" data-recovery-page="-1" '+(page===0||frozen?'disabled':'')+'>上一頁</button><span>'+number(page+1)+'／'+number(pages)+'</span><button type="button" data-recovery-page="1" '+(page>=pages-1||frozen?'disabled':'')+'>下一頁</button></nav>'+(records?'':'<footer class="recovery-selection"><span>已選 '+number(selected.size)+'／'+(mode==='reforge'?'1':number(Math.min(50,snapshot.batchLimit||50)))+' 件</span><button type="button" data-recovery-clear '+(!selected.size||frozen?'disabled':'')+'>清除選擇</button><button type="button" data-recovery-preview '+(!selected.size||frozen||snapshot.lockedReason?'disabled':'')+'>預覽'+esc(modes[mode])+'</button></footer>')+'</div></section>';
   root.scrollTop=scroll;bind(filtered);
   if(focusSearch){const input=root.querySelector('[name="recoverySearch"]');input?.focus({preventScroll:true});if(caret!==null)try{input.setSelectionRange(caret,caret);}catch{}}
  }
  function bind(filtered=[]){
   root.querySelectorAll('[data-recovery-refresh]').forEach(button=>button.onclick=()=>void client.refresh());
   root.querySelector('[data-recovery-retry]')?.addEventListener('click',()=>void client.retry());
   root.querySelector('[data-recovery-legacy]')?.addEventListener('click',()=>host.onLegacy?.());
   root.querySelectorAll('[data-recovery-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.recoveryMode;records=false;resetSelection();paint();});
   root.querySelector('[data-recovery-records]')?.addEventListener('click',()=>{records=!records;resetSelection();paint();});
   root.querySelector('[name="recoverySource"]')?.addEventListener('change',event=>{source=event.target.value;resetSelection();paint();});
   root.querySelector('[name="recoverySearch"]')?.addEventListener('input',event=>{search=event.target.value;selected.clear();page=0;paint();});
   root.querySelectorAll('[data-recovery-item]').forEach(input=>input.onchange=()=>{const id=input.dataset.recoveryItem;if(mode==='reforge')selected.clear();if(input.checked){if(selected.size>=Math.min(50,client.state.snapshot.batchLimit||50)){client.state.error='每次最多選取 50 件';input.checked=false;}else selected.add(id);}else selected.delete(id);paint();});
   root.querySelector('[data-recovery-suggest]')?.addEventListener('click',()=>{selected.clear();for(const id of suggestedItems(filtered,mode,client.state.snapshot.batchLimit))selected.add(id);paint();});
   root.querySelector('[data-recovery-clear]')?.addEventListener('click',()=>{selected.clear();paint();});
   root.querySelectorAll('[data-recovery-page]').forEach(button=>button.onclick=()=>{page+=Number(button.dataset.recoveryPage);paint();});
   root.querySelector('[data-recovery-preview]')?.addEventListener('click',async()=>{await client.preview(mode,[...selected]);if(!disposed&&client.current())root.querySelector('.recovery-confirm')?.scrollIntoView({block:'start'});});
   root.querySelector('[data-recovery-cancel]')?.addEventListener('click',()=>client.cancelPreview());
   const updateConfirm=()=>{const button=root.querySelector('[data-recovery-confirm]');if(button)button.disabled=client.state.busy||!!client.state.pending||!root.querySelector('[data-recovery-ack]')?.checked||!!client.state.preview?.requiresHighValueConfirmation&&!root.querySelector('[data-recovery-high]')?.checked;};
   root.querySelectorAll('[data-recovery-ack],[data-recovery-high]').forEach(input=>input.onchange=updateConfirm);
   root.querySelector('[data-recovery-confirm]')?.addEventListener('click',()=>void client.confirm({acknowledge:root.querySelector('[data-recovery-ack]')?.checked===true,confirmHighValue:root.querySelector('[data-recovery-high]')?.checked===true}));
  }
  paint();void client.refresh();const poll=setInterval(()=>{if(!document.hidden&&!client.state.busy&&!client.state.preview&&!client.state.pending)void client.refresh();},30000);return {refresh:client.refresh,dispose(){disposed=true;clearInterval(poll);client.dispose();}};
 }
 window.RpgEquipmentRecovery={createClient,mount,suggestedItems,previewHtml};
})();
