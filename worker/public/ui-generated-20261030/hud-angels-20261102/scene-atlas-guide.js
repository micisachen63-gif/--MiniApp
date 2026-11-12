/* Main scene Atlas tools. The host supplies the authenticated transport and
 * actor/context checks. Drafts preserve interface choices, never game progress. */
(() => {
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const supplyKeys=['red_1','red_2','red_3','red_4','blue_1','blue_2','blue_3','blue_4'];
 const hasSupplyItems=supplies=>!!supplies?.items&&typeof supplies.items==='object'&&!Array.isArray(supplies.items);
 const supplyCount=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):0;
 function mount(body,host,initial='talents'){
  const draft=host.draft||(host.draft={});draft.forms||={};draft.talents||={};draft.scroll||={};
  let disposed=false,route=initial==='inscription'?'workshop':initial,catalog=null,state=null,preview=null,selected=draft.talents.selected??null,zoom=Number(draft.talents.zoom)||75,reviewed=!!draft.talents.reviewed,busy=false,loading=true,error='',seq=0,confirming=null,pending=null,signature='';
  let painted=false,refreshing=null,latestScene=null,transitionToken=null,composing=null;const clearedForms=new Set();
  const scope=String(host.actor.tgId),realmId=host.realmId||'permanent',contextEpoch=host.getContext?.().epoch,key=`scene:atlas-pending:${realmId}:${scope}`;
  try{pending=JSON.parse(sessionStorage.getItem(key)||'null');if(pending&&!['atlas/talents/action','atlas/configure','atlas/start','atlas/stop','atlas/settle','atlas/craft'].includes(pending.action))pending=null;}catch{}
  const locked=()=>!!state?.run&&state.run.status==='running'||!!host.actor.partyId||!state?.canStart;
  const isCurrent=()=>!disposed&&host.current?.()!==false&&String(host.getActor()?.tgId)===scope&&(!host.getContext||(host.getContext().realmId===realmId&&host.getContext().epoch===contextEpoch));
  const inputValue=(form,name)=>String(form.elements?.[name]?.value??form.querySelector?.('[name="'+name+'"]')?.value??'');
  function saveDrafts(){
   if(!painted)return;
   const build=body.querySelector('[data-guide-build]'),start=body.querySelector('[data-guide-start]'),craft=body.querySelector('[data-guide-craft]');
   if(build&&!clearedForms.has('build'))draft.forms.build={buildId:inputValue(build,'buildId'),supportIds:[...build.querySelectorAll('[name="supportIds"]')].filter(input=>input.checked).map(input=>input.value),automation:inputValue(build,'automation')};
   if(start&&!clearedForms.has('start')){
    const fields=[...start.querySelectorAll('[data-guide-supply-item]')];
    draft.forms.start={...Object.fromEntries((fields.length?['mapId','minutes']:['mapId','minutes','hp','mp']).map(name=>[name,inputValue(start,name)])),
     ...(fields.length?{items:Object.fromEntries(fields.map(field=>[field.dataset.guideSupplyItem,String(field.value)]))}:{})};
   }
   if(craft&&!clearedForms.has('craft'))draft.forms.craft={itemId:inputValue(craft,'itemId'),recipeId:inputValue(craft,'recipeId')};
   const canvas=body.querySelector('.atlas-talent-canvas');
   Object.assign(draft.talents,{selected,zoom,reviewed,...(canvas?{left:canvas.scrollLeft,top:canvas.scrollTop}:{})});
   draft.scroll[route]=body.scrollTop;
  }
  function focusedField(){
   const field=typeof document==='undefined'?null:document.activeElement;
   if(!field?.name||!body.contains?.(field))return null;
   return {name:field.name,type:field.type,value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection};
  }
  function restoreFocus(saved){
   if(!saved)return;
   const field=[...body.querySelectorAll('[name]')].find(input=>input.name===saved.name&&(!['radio','checkbox'].includes(saved.type)||input.value===saved.value));
   if(!field||field.disabled)return;
   field.focus?.({preventScroll:true});
   if(Number.isInteger(saved.start)&&Number.isInteger(saved.end))try{field.setSelectionRange?.(saved.start,saved.end,saved.direction||'none');}catch{}
  }
  function clearSubmittedDraft(action){
   const name=({'atlas/configure':'build','atlas/start':'start','atlas/craft':'craft'})[action];
   if(name){saveDrafts();draft.submittedForms||={};draft.submittedForms[name]=JSON.stringify(draft.forms[name]??null);}
  }
  function adoptSubmittedDrafts(){
   saveDrafts();
   for(const[name,submitted]of Object.entries(draft.submittedForms||{})){
    // A confirmed status replaces the submitted baseline, but never newer edits.
    if(JSON.stringify(draft.forms[name]??null)===submitted){delete draft.forms[name];clearedForms.add(name);}
   }
   draft.submittedForms={};
  }
  function refresh(){
   if(!isCurrent())return Promise.resolve();
   if(refreshing)return refreshing;
   refreshing=(async()=>{
    try{const [c,s]=await Promise.all([catalog?Promise.resolve(null):host.request('atlas/catalog'),host.request('atlas/status')]);if(!isCurrent())return;host.actor={...host.getActor()};if(c)catalog=c.catalog;if(preview&&preview.baseRevision!==s.talents.revision)preview=null;state=s;adoptSubmittedDrafts();if(s.scene)latestScene=s.scene;error='';}
    catch(e){if(isCurrent())error=e.message;}
    finally{refreshing=null;if(isCurrent()){loading=false;paint();}}
   })();
   return refreshing;
  }
  function cancelConfirmation(){
   if(!confirming||busy)return false;
   const focus=confirming.focus;confirming=null;paint();restoreFocus(focus);return true;
  }
  function confirm(title,message,payload){saveDrafts();confirming={title,message,payload,focus:focusedField()};paint();body.querySelector('[data-guide-cancel]')?.focus({preventScroll:true});}
  async function operate(action,payload,recover=false){
   if(busy||!isCurrent())return;
   if(pending&&!recover){error='先確認上一筆操作結果，再進行下一筆。';paint();return;}
   const operation=recover?pending:{action,payload:{...payload,requestId:crypto.randomUUID()}};if(!operation)return;
   pending=operation;sessionStorage.setItem(key,JSON.stringify(pending));busy=true;confirming=null;error='';paint();
   try{await host.request(operation.action,operation.payload);if(!isCurrent())return;pending=null;sessionStorage.removeItem(key);clearSubmittedDraft(operation.action);preview=null;await refresh();}
   catch(e){if(isCurrent()){error=e.message;if(!e.uncertain&&e.status>=400&&e.status<500){pending=null;sessionStorage.removeItem(key);}}}
   finally{busy=false;if(isCurrent())paint();}
  }
  async function inspect(nodeId,routePreview=false){
   const generation=++seq;selected=nodeId;preview=null;loading=true;paint();
   try{const data=await host.request('atlas/talents/preview',{nodeId});if(!isCurrent()||generation!==seq)return;preview=data;error='';}
   catch(e){if(isCurrent()&&generation===seq)error=e.message;}
   finally{if(isCurrent()&&generation===seq){loading=false;paint();body.querySelector(routePreview?'.atlas-talent-preview':'.atlas-talent-detail')?.scrollIntoView({block:routePreview?'start':'nearest'});}}
  }
  function buildIcon(id){return /^[a-z]+_[a-z]+$/.test(String(id||''))?'/art/atlas-build-icons-20261110/'+id+'.webp':'';}
  function buildStats(x){return [x.coefficient!=null?'倍率 '+x.coefficient+'×':'',x.targets!=null?x.targets+' 個目標':'',x.cost!=null?'耗魔 '+x.cost:'',x.cooldown!=null?'冷卻 '+x.cooldown+' 秒':''].filter(Boolean).join(' · ');}
  function buildHtml(){
    const profile=draft.forms.build||state.profile,b=(catalog.builds||[]).filter(b=>b.baseClass===host.actor.baseClass);
    const current=b.find(x=>x.id===profile.buildId)||b[0];
    const icon=current?buildIcon(current.id):'';
    return `<h3>技能與輔助配置</h3><p>先選主技能，再搭配最多兩個輔助。保存後，下一趟星圖使用此配置。</p><form data-guide-build><label>主技能<select name="buildId">${b.map(x=>`<option value="${esc(x.id)}" ${x.id===profile.buildId?'selected':''}>${esc(x.name+' · '+x.mainSkill)}</option>`).join('')}</select></label>`+
      (current?`<article class="scene-guide-build-card">${icon?'<img class="scene-guide-build-art" src="'+esc(icon)+'" alt="" width="72" height="72" loading="lazy" decoding="async" draggable="false">':''}<div><strong>${esc(current.name)}</strong><small>${esc(current.mainSkill||'')}${current.strengths?.length?' · 擅長'+esc(current.strengths.join('、')):''}${current.weaknesses?.length?' · 代價：'+esc(current.weaknesses.join('、')):''}</small><p>${esc(current.description||'')}</p><p class="scene-guide-build-stats">${esc(buildStats(current))}</p></div></article>`:'')+
      (current?.recommendedSupports?.length?`<button type="button" data-guide-recommend ${locked()?'disabled':''}>套用此流派的入門輔助</button>`:'')+
      `<div class="scene-guide-supports">${catalog.supports.map(x=>{const compatible=!x.requires?.length||x.requires.some(tag=>(current?.tags||[]).includes(tag));return `<label class="${(profile.supportIds||[]).includes(x.id)?'is-selected':''}"><input type="checkbox" name="supportIds" value="${esc(x.id)}" ${(profile.supportIds||[]).includes(x.id)?'checked':''} ${compatible?'':'disabled'}>${esc(x.name)}<small>${esc(x.description||'')}${compatible?'':' · 需要相符的流派'}</small></label>`;}).join('')}</div><label>自動施放策略<select name="automation">${catalog.automation.map(x=>`<option value="${esc(x.id)}" ${x.id===profile.automation?'selected':''}>${esc(x.name+' · '+x.description)}</option>`).join('')}</select></label><button ${locked()?'disabled':''}>保存構築</button></form>`;
  }
  function potionInfo(key){
   const actual=catalog?.supplyRules?.potions?.find(p=>p.id===key);
   return {name:actual?.name||((key.startsWith('red_')?'紅水':'藍水')+' '+key.slice(-1)+' 階'),heal:Number(actual?.heal)||0};
  }
  function policyText(policy){
   if(!policy)return '出發時套用已保存的喝水設定，途中修改於下一趟生效。';
   const choice=key=>key==='auto'?'最低階優先':potionInfo(key).name;
   return '紅水低於'+policy.hpThresholdPct+'% · '+choice(policy.hpPreference)+'；藍水 '+
    (policy.autoBlue?policy.mpThresholdPct+'% 以下或技能魔力不足時 · '+choice(policy.mpPreference):'自動使用關閉')+'。';
  }
  function itemSummary(items,empty='未攜帶'){
   return supplyKeys.filter(key=>supplyCount(items?.[key])>0).map(key=>potionInfo(key).name+' × '+supplyCount(items[key])).join('、')||empty;
  }
  function runSupplyDetails(supplies){
   if(!hasSupplyItems(supplies))return '';
   return '剩餘：'+itemSummary(supplies.items,'皆已用完')+'；已用：'+itemSummary(supplies.usedItems,'尚未使用')+'。';
  }
  function initialSupplyItems(){
   const items=Object.fromEntries(supplyKeys.map(key=>[key,'0']));
   for(const kind of ['red','blue']){
    const preference=state.supplies.policy?.[kind==='red'?'hpPreference':'mpPreference']||'auto';
    let remaining=kind==='blue'&&state.supplies.policy?.autoBlue===false?0:10;
    for(const key of supplyKeys.filter(key=>key.startsWith(kind+'_')&&(preference==='auto'||preference===key))){
     const count=Math.min(remaining,supplyCount(state.supplies.items[key]));items[key]=String(count);remaining-=count;if(!remaining)break;
    }
   }
   return items;
  }
  function supplyFields(form){
   if(!hasSupplyItems(state.supplies))return '<div class="scene-guide-supplies"><label><span data-guide-available-hp>攜帶紅水（有 '+state.supplies.hp+'）</span><input type="number" name="hp" min="0" max="'+Math.min(500,state.supplies.hp)+'" value="'+esc(form.hp??0)+'" required></label><label><span data-guide-available-mp>攜帶藍水（有 '+state.supplies.mp+'）</span><input type="number" name="mp" min="0" max="'+Math.min(500,state.supplies.mp)+'" value="'+esc(form.mp??0)+'" required></label></div>';
   const values=form.items||{...initialSupplyItems(),...(form.hp!=null?{red_1:String(form.hp)}:{}),...(form.mp!=null?{blue_1:String(form.mp)}:{})};
   return '<aside class="atlas-note"><p data-guide-next-policy>'+esc(policyText(state.supplies.policy))+'</p><p>本趟預留以下藥水，紅、藍水各最多 500 瓶。指定種類只使用該藥水，未用部分返營時退回。</p>'+
    '</aside><div class="scene-guide-supplies scene-guide-potion-groups">'+
    ['red','blue'].map(kind=>'<section class="scene-guide-potion-group"><h4>'+(kind==='red'?'生命藥水':'魔力藥水')+'</h4><p data-guide-supply-total="'+kind+'">攜帶 0 / 500 瓶</p>'+
     supplyKeys.filter(key=>key.startsWith(kind+'_')).map(key=>{
      const info=potionInfo(key),available=supplyCount(state.supplies.items[key]);
      return '<label><span>'+esc(info.name)+(info.heal?' · +'+info.heal+(kind==='red'?' 生命':' 魔力'):'')+'</span><small data-guide-available-item="'+key+'">背包 '+available+' 瓶</small><input type="number" name="item_'+key+'" data-guide-supply-item="'+key+'" aria-label="攜帶'+esc(info.name)+'" min="0" max="'+Math.min(500,available)+'" step="1" inputmode="numeric" value="'+esc(values[key]??'0')+'" required></label>';
     }).join('')+'</section>').join('')+'</div><p class="atlas-note">關閉自動藍水時不會使用藍水；開啟後依門檻及技能魔力需求補水。此趟設定以開始派遣時已保存內容為準。</p>';
  }
  function expeditionHtml(){
   const active=state.run?.status==='running',form=draft.forms.start||{mapId:host.mapId,minutes:'10',...(hasSupplyItems(state.supplies)?{items:initialSupplyItems()}:{hp:String(Math.min(10,state.supplies.hp)),mp:String(Math.min(10,state.supplies.mp))})};
   const run=state.run,details=runSupplyDetails(run?.supplies);
   return '<h3>星圖派遣</h3>'+(run?'<article class="scene-live-quest"><h4>'+esc(catalog.maps.find(m=>m.id===run.mapId)?.name||run.mapId)+'</h4><p data-guide-run-summary>'+(active?'探索中':'已結束')+' · 通關 '+run.completedMaps+' 張 · 擊倒 '+run.report.kills+' 隻</p><p><span data-guide-run-progress>結算進度 '+run.progress.processedSeconds+' 秒／經過 '+run.progress.elapsedSeconds+' 秒</span> · <span data-guide-run-supplies>補給剩餘：紅 '+run.supplies.hp+' / 藍 '+run.supplies.mp+'</span></p>'+
    (details?'<p class="atlas-note" data-guide-run-items>'+esc(details)+'</p><p class="atlas-note" data-guide-run-policy>本趟設定：'+esc(policyText(run.supplies.policy))+'</p>':'')+
    (active?'<button data-guide-settle>更新並結算進度</button><button data-guide-stop>停止並返營</button>':'')+'</article>':'')+
    (hasSupplyItems(state.supplies)&&host.navigate?'<p><button type="button" data-guide-supply-settings>調整喝水設定</button></p>':'')+
    '<form data-guide-start><label>出征星圖<select name="mapId">'+catalog.maps.filter(m=>m.available).map(m=>'<option value="'+esc(m.id)+'" '+(m.id===form.mapId?'selected':'')+' '+(state.availableMapIds.includes(m.id)?'':'disabled')+'>'+esc(m.name)+' · Lv.'+m.minLevel+(state.availableMapIds.includes(m.id)?'':'（尚未解鎖）')+'</option>').join('')+'</select></label>'+
    '<p>出征後會自動探索，關閉視窗仍可累積進度。途中可能遇到菁英狩獵、守護寶藏、補給泉與伏擊；此趟使用出發時保存的技能和天賦。</p><p>裝備掉落額度按每 10 分鐘 1 件累積，普通強化卷按每 5 分鐘 1 張累積；成功清房後才有機會獲得。回營後可將戰利品典藏或精煉。</p>'+
    '<label>派遣分鐘<input type="number" name="minutes" min="1" max="480" value="'+esc(form.minutes)+'" required></label>'+supplyFields(form)+
    '<button data-guide-dispatch '+(locked()?'disabled':'')+'>確認派遣</button></form>';
  }
  function updateSupplyFields(){
   const form=body.querySelector('[data-guide-start]');
   if(!form)return;
   for(const key of supplyKeys){
    const available=supplyCount(state?.supplies?.items?.[key]),label=body.querySelector('[data-guide-available-item="'+key+'"]'),input=form.querySelector('[data-guide-supply-item="'+key+'"]');
    if(label)label.textContent='背包 '+available+' 瓶';if(input)input.max=String(Math.min(500,available));
   }
   for(const kind of ['red','blue']){
    const label=body.querySelector('[data-guide-supply-total="'+kind+'"]');if(!label)continue;
    const raw=supplyKeys.filter(key=>key.startsWith(kind+'_')).map(key=>inputValue(form,'item_'+key));
    const valid=raw.every(value=>/^\d+$/.test(value)),total=valid?raw.reduce((sum,value)=>sum+Number(value),0):null;
    label.textContent=valid?'攜帶 '+total+' / 500 瓶'+(total>500?'（超過上限）':''):'請填寫各階攜帶數量';
   }
  }
  function dispatchPlan(form){
   const integer=(name,label,max,min=0)=>{
    const raw=inputValue(form,name).trim(),value=Number(raw);
    if(!/^\d+$/.test(raw)||!Number.isSafeInteger(value)||value<min||value>max)throw Error(label+'需為 '+min+'–'+max+' 的整數。');
    return value;
   };
   const durationMinutes=integer('minutes','派遣分鐘',480,1);
   if(hasSupplyItems(state.supplies)){
    const items=Object.fromEntries(supplyKeys.map(key=>[key,integer('item_'+key,potionInfo(key).name+'攜帶數量',Math.min(500,supplyCount(state.supplies.items[key])))]));
    for(const kind of ['red','blue'])if(supplyKeys.filter(key=>key.startsWith(kind+'_')).reduce((sum,key)=>sum+items[key],0)>500)throw Error((kind==='red'?'紅水':'藍水')+'攜帶總量不能超過 500 瓶。');
    return {body:{mapId:inputValue(form,'mapId'),queueMode:'duration',durationMinutes,supplies:{items}},message:'本趟攜帶：'+itemSummary(items,'不攜帶藥水')+'。'+policyText(state.supplies.policy)+'開始派遣時套用伺服器已保存設定；未用藥水返營退回。'};
   }
   const supplies={hp:integer('hp','紅水數量',Math.min(500,state.supplies.hp)),mp:integer('mp','藍水數量',Math.min(500,state.supplies.mp))};
   return {body:{mapId:inputValue(form,'mapId'),queueMode:'duration',durationMinutes,supplies},message:'將保留本趟攜帶補給，並以目前已保存的技能與天賦開始實際模擬；離線仍持續。'};
  }
  function materialCostHtml(id,n){const m=catalog.materials.find(m=>m.id===id),src=m?.iconSrc;return '<span class="scene-material-cost">'+(src?'<img src="'+esc(host.artUrl?host.artUrl(src):src)+'" alt="" loading="lazy" width="30" height="30">':'')+esc(m?.name||id)+' '+(state.materials[id]||0)+'/'+n+'</span>';}
  function workshopHtml(){const form=draft.forms.craft||{};return `<h3>定向銘刻工坊</h3><p>每件最多 ${catalog.maxCraftsPerItem} 次；原裝備、外觀與強化 +N 保留。材料由星圖的實際戰鬥與委託取得。</p><form data-guide-craft><label>裝備<select name="itemId" required><option value="">選擇裝備</option>${state.equipment.map(e=>`<option value="${esc(e.id)}" ${e.id===form.itemId?'selected':''} ${e.tradeLocked||e.crafts>=catalog.maxCraftsPerItem?'disabled':''}>${esc(e.name)} +${e.enhanceLevel} · 銘刻 ${e.crafts}/${catalog.maxCraftsPerItem}</option>`).join('')}</select></label>${catalog.recipes.map(r=>`<label class="scene-guide-recipe"><input type="radio" name="recipeId" value="${esc(r.id)}" ${r.id===form.recipeId?'checked':''} required><b>${esc(r.name)}</b><small>${esc(r.description)}<br>${Object.entries(r.cost).map(([id,n])=>materialCostHtml(id,n)).join(' · ')}</small></label>`).join('')}<button ${locked()?'disabled':''}>確認銘刻</button></form>`;}
  function paint(){
   if(!isCurrent()||(composing&&body.contains?.(composing)))return;
   const focus=focusedField();saveDrafts();
   const title=body.closest('.scene-social-card')?.querySelector('h2');if(title)title.textContent=({talents:'天賦星盤',progression:'冒險成長路線',build:'技能與輔助配置',expedition:'星圖派遣',workshop:'定向銘刻工坊'})[route];
   const next=JSON.stringify([route,catalog,state,preview,selected,zoom,reviewed,busy,loading,error,pending,confirming,draft.forms]);if(next===signature)return;signature=next;
   const scroll=painted?body.scrollTop:(draft.scroll[route]??0),left=draft.talents.left,top=draft.talents.top;
   body.innerHTML=`<nav class="scene-guide-nav" aria-label="冒險玩法"><button data-guide-route="talents" ${route==='talents'?'aria-current="page"':''}>天賦星盤</button><button data-guide-route="progression" ${route==='progression'?'aria-current="page"':''}>成長路線</button><button data-guide-refresh>同步</button></nav><p class="scene-guide-actor">${esc(host.actor.name)} · Lv.${host.actor.level} · ${esc(({sword:'劍士',archer:'妖精',mage:'法師',thief:'刺客'})[host.actor.baseClass]||host.actor.baseClass)}</p>${error?`<p class="atlas-error" role="alert">${esc(error)}</p>`:''}${pending?`<p class="atlas-note" role="status">${busy?'正在確認操作結果…':'上一筆操作尚未確認，重試會沿用原收據，避免重複扣除。'}</p><button data-guide-recover ${busy?'disabled':''}>確認上一筆結果</button>`:''}${confirming?`<section class="scene-guide-confirm" role="alertdialog" aria-label="${esc(confirming.title)}"><h3>${esc(confirming.title)}</h3><p>${esc(confirming.message)}</p><button data-guide-cancel>取消</button><button data-guide-confirm>確認</button></section>`:''}<div class="scene-guide-content" ${busy||confirming?'inert':''}>${!state||!catalog?'<p>正在讀取角色與星圖資料…</p>':route==='talents'?window.RpgAtlasTalents.render(state.talents,{level:host.actor.level,busy:busy||!!pending,locked:locked(),selectedId:selected,zoom,effectsReviewed:reviewed,preview,previewLoading:loading}):route==='progression'?window.RpgAtlasProgression.render(catalog,state,{level:host.actor.level,busy:busy||!!pending}):route==='build'?buildHtml():route==='expedition'?expeditionHtml():workshopHtml()}</div>`;
   body.scrollTop=scroll;const canvas=body.querySelector('.atlas-talent-canvas');if(canvas){canvas.scrollLeft=left??Math.max(0,(canvas.scrollWidth-canvas.clientWidth)/2);canvas.scrollTop=top||0;let drag=null,moved=false;canvas.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'||e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:canvas.scrollLeft,top:canvas.scrollTop};moved=false;});canvas.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;if(!moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<6)return;moved=true;e.preventDefault();canvas.setPointerCapture(e.pointerId);canvas.scrollLeft=drag.left-(e.clientX-drag.x);canvas.scrollTop=drag.top-(e.clientY-drag.y);});const end=e=>{if(drag?.id!==e.pointerId)return;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);drag=null;};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('click',e=>{if(moved){moved=false;e.preventDefault();e.stopImmediatePropagation();}},true);}
   body.querySelectorAll('[data-guide-route]').forEach(b=>b.onclick=()=>navigate(b.dataset.guideRoute));
   body.querySelector('[data-guide-refresh]')?.addEventListener('click',()=>void refresh());
   body.querySelector('[data-guide-recover]')?.addEventListener('click',()=>void operate(null,null,true));
   body.querySelector('[data-guide-cancel]')?.addEventListener('click',()=>cancelConfirmation());
   body.querySelector('[data-guide-confirm]')?.addEventListener('click',()=>{const p=confirming?.payload;if(p)void operate(p.action,p.body);});
   body.querySelectorAll('[data-talent-node]').forEach(n=>{const choose=()=>{if(n.dataset.talentNode==='origin'){selected='origin';preview=null;seq++;loading=false;paint();}else void inspect(n.dataset.talentNode);};n.onclick=choose;n.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();choose();}};});
   body.querySelectorAll('[data-talent-plan]').forEach(b=>b.onclick=()=>void inspect(b.dataset.talentPlan,true));
   body.querySelector('[name="talentZoom"]')?.addEventListener('input',e=>{zoom=Number(e.target.value);const svg=body.querySelector('.atlas-talent-canvas svg');if(svg)svg.style.width=900*zoom/100+'px';saveDrafts();});
   body.querySelector('[data-talent-review]')?.addEventListener('click',()=>{reviewed=true;paint();body.querySelector('[data-talent-effects]')?.scrollIntoView({block:'nearest'});});
   body.querySelectorAll('[data-talent-guide]').forEach(b=>b.onclick=()=>void operate('atlas/talents/action',{kind:b.dataset.talentGuide}));
   body.querySelector('[data-talent-allocate]')?.addEventListener('click',()=>{const n=state.talents.catalog.nodes.find(n=>n.id===selected);if(n)confirm('配置天賦',`${n.name}：${n.description}。消耗 1 點，下次星圖生效。`,{action:'atlas/talents/action',body:{kind:'allocate',nodeId:n.id}});});
   body.querySelector('[data-talent-apply-path]')?.addEventListener('click',()=>{if(preview?.plan.canApply)confirm('配置整條路線',`消耗 ${preview.plan.requiredPoints} 點，保留目前節點。${preview.plan.after.effectText}。`,{action:'atlas/talents/action',body:{kind:'allocate_path',nodeId:preview.nodeId,expectedRevision:preview.baseRevision}});});
   body.querySelector('[data-talent-reset]')?.addEventListener('click',()=>confirm('重新配置天賦','免費清空節點並返還天賦點。裝備、等級與強化值保留。',{action:'atlas/talents/action',body:{kind:'reset'}}));
   body.querySelectorAll('[data-growth-open]').forEach(b=>b.onclick=()=>navigate(b.dataset.growthOpen));
   body.querySelectorAll('[data-growth-map]').forEach(b=>b.onclick=()=>{host.mapId=b.dataset.growthMap;navigate('expedition');});
   const buildForm=body.querySelector('[data-guide-build]');if(buildForm){const syncSupports=()=>{const build=catalog.builds.find(b=>b.id===buildForm.elements.buildId.value);buildForm.querySelectorAll('[name="supportIds"]').forEach(input=>{const support=catalog.supports.find(s=>s.id===input.value);input.disabled=!!support.requires?.length&&!support.requires.some(tag=>(build?.tags||[]).includes(tag));if(input.disabled)input.checked=false;});};buildForm.elements.buildId.addEventListener('change',()=>{saveDrafts();syncSupports();signature='';paint();});syncSupports();buildForm.querySelectorAll('[name="supportIds"]').forEach(input=>input.addEventListener('change',()=>{if(buildForm.querySelectorAll('[name="supportIds"]:checked').length>2)input.checked=false;}));buildForm.querySelector('[data-guide-recommend]')?.addEventListener('click',()=>{const build=catalog.builds.find(b=>b.id===buildForm.elements.buildId.value);if(!build)return;const rec=new Set(build.recommendedSupports||[]);buildForm.querySelectorAll('[name="supportIds"]').forEach(input=>{input.checked=rec.has(input.value)&&!input.disabled;});if(build.recommendedAutomation&&buildForm.elements.automation)buildForm.elements.automation.value=build.recommendedAutomation;saveDrafts();});}
   body.querySelector('[data-guide-build]')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target),supports=f.getAll('supportIds');if(supports.length>2){error='最多選擇兩個輔助。';paint();return;}void operate('atlas/configure',{buildId:f.get('buildId'),supportIds:supports,automation:f.get('automation')});});
   body.querySelector('[data-guide-start]')?.addEventListener('submit',e=>{e.preventDefault();try{const plan=dispatchPlan(e.target);error='';confirm('確認星圖派遣',plan.message,{action:'atlas/start',body:plan.body});}catch(e){error=e.message;paint();}});
   body.querySelector('[data-guide-supply-settings]')?.addEventListener('click',()=>{saveDrafts();host.navigate?.('supplies');});
   body.querySelector('[data-guide-settle]')?.addEventListener('click',()=>void operate('atlas/settle',{runId:state.run.id}));
   body.querySelector('[data-guide-stop]')?.addEventListener('click',()=>confirm('返營','停止目前探索，依已完成部分結算。',{action:'atlas/stop',body:{runId:state.run.id}}));
   body.querySelector('[data-guide-craft]')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target),r=catalog.recipes.find(x=>x.id===f.get('recipeId')),item=state.equipment.find(x=>x.id===f.get('itemId'));if(r&&item)confirm('確認銘刻',`${item.name} +${item.enhanceLevel}：${r.description}。消耗 ${Object.entries(r.cost).map(([id,n])=>`${catalog.materials.find(m=>m.id===id)?.name||id} ×${n}`).join('、')}。`,{action:'atlas/craft',body:{itemId:item.id,recipeId:r.id}});});
   for(const selector of ['[data-guide-build]','[data-guide-start]','[data-guide-craft]']){const form=body.querySelector(selector);form?.addEventListener('input',()=>{saveDrafts();updateSupplyFields();});form?.addEventListener('change',()=>{saveDrafts();updateSupplyFields();});}
   updateSupplyFields();
   body.querySelector('.atlas-talent-canvas')?.addEventListener('scroll',saveDrafts,{passive:true});
   painted=true;clearedForms.clear();restoreFocus(focus);
  }
  function navigate(next){
   if(busy||pending)return;saveDrafts();seq++;loading=false;confirming=null;error='';
   if(typeof host.navigate==='function'){host.navigate(next==='workshop'?'inscription':next,host.mapId?{mapId:host.mapId}:{});return;}
   route=next;signature='';painted=false;paint();
  }
  const runToken=run=>run?String(run.id)+':'+String(run.status)+':'+String(run.active??(run.status==='running')):'none';
  function update(snapshot){
   if(!isCurrent()||!snapshot||String(snapshot.characterId)!==scope||snapshot.realmId!==realmId||!snapshot.live)return false;
   const accountId=host.getContext?.().accountId;
   if(accountId!=null&&String(snapshot.accountId)!==String(accountId))return false;
   if(snapshot.run&&(String(snapshot.run.characterId)!==scope||snapshot.run.realmId!==realmId))return false;
   if(latestScene&&(Number(snapshot.live.revision)<Number(latestScene.live?.revision)||
      snapshot.run?.id===latestScene.run?.id&&Number(snapshot.run?.revision)<Number(latestScene.run?.revision)))return false;
   latestScene=snapshot;
   const token=runToken(snapshot.run),before=runToken(state?.run);
   if(!state||token!==before){
    if(transitionToken===token)return false;transitionToken=token;
    void(async()=>{
     try{if(refreshing)await refreshing;if(isCurrent()&&transitionToken===token&&runToken(state?.run)!==token)await refresh();}
     finally{
      // A failed or lagging status read has not acknowledged this transition.
      // Release only our token so the next healthy scene can retry once.
      if(isCurrent()&&transitionToken===token&&runToken(state?.run)!==token)transitionToken=null;
     }
    })();
    return true;
   }
   if(snapshot.run?.status!=='running')return false;
   const run=snapshot.run,number=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
   const runSupplies=hasSupplyItems(state.run.supplies)&&!hasSupplyItems(run.supplies)?state.run.supplies:run.supplies;
   state.run={...state.run,completedMaps:number(run.report?.metrics?.mapsCompleted,state.run.completedMaps),processedAt:run.processedAt,
    report:{...state.run.report,...run.report},supplies:{...state.run.supplies,...runSupplies,hp:number(runSupplies?.hp,state.run.supplies.hp),mp:number(runSupplies?.mp,state.run.supplies.mp)},
    progress:{...state.run.progress,processedSeconds:number(run.processedSeconds,state.run.progress.processedSeconds)}};
   if(Number.isFinite(snapshot.serverNow)&&Number.isFinite(state.run.startedAt)&&Number.isFinite(state.run.endsAt))state.run.progress.elapsedSeconds=Math.max(0,Math.floor(Math.min(snapshot.serverNow,state.run.endsAt)/1000)-Math.floor(state.run.startedAt/1000));
   if(snapshot.live.supplies&&(!hasSupplyItems(state.supplies)||hasSupplyItems(snapshot.live.supplies)))state.supplies={...state.supplies,...snapshot.live.supplies,hp:number(snapshot.live.supplies.hp,state.supplies.hp),mp:number(snapshot.live.supplies.mp,state.supplies.mp)};
   const text=(selector,value)=>{const node=body.querySelector(selector);if(node)node.textContent=value;};
   text('[data-guide-run-summary]','探索中 · 通關 '+state.run.completedMaps+' 張 · 擊倒 '+state.run.report.kills+' 隻');
   text('[data-guide-run-progress]','結算進度 '+state.run.progress.processedSeconds+' 秒／經過 '+state.run.progress.elapsedSeconds+' 秒');
   text('[data-guide-run-supplies]','補給剩餘：紅 '+state.run.supplies.hp+' / 藍 '+state.run.supplies.mp);
   text('[data-guide-run-items]',runSupplyDetails(state.run.supplies));
   if(hasSupplyItems(state.run.supplies))text('[data-guide-run-policy]','本趟設定：'+policyText(state.run.supplies.policy));
   text('[data-guide-available-hp]','攜帶紅水（有 '+state.supplies.hp+'）');
   text('[data-guide-available-mp]','攜帶藍水（有 '+state.supplies.mp+'）');
   if(hasSupplyItems(state.supplies))text('[data-guide-next-policy]',policyText(state.supplies.policy));
   updateSupplyFields();
   return true;
  }
  const compositionStart=event=>{if(isCurrent()&&event.target?.name)composing=event.target;};
  const compositionEnd=event=>{if(event.target!==composing)return;composing=null;saveDrafts();paint();};
  body.addEventListener?.('compositionstart',compositionStart);body.addEventListener?.('compositionend',compositionEnd);
  body.addEventListener?.('scroll',saveDrafts,{passive:true});
  paint();void refresh();
  return {dispose(){saveDrafts();disposed=true;composing=null;seq++;body.removeEventListener?.('scroll',saveDrafts);body.removeEventListener?.('compositionstart',compositionStart);body.removeEventListener?.('compositionend',compositionEnd);},refresh,update,handleBack:cancelConfirmation};
 }
 window.RpgSceneAtlasGuide={mount};
})();
