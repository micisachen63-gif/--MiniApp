if(window.__RpgScenePreviewConfig?.live!==true){
/* Controls are local art-preview controls, never gameplay actions. */
(function () {
  const controls = document.getElementById('controls'), frame = document.getElementById('demo');
  document.getElementById('show').textContent = '人物／預覽設定';
  const oldNote = [...controls.querySelectorAll('p')].find(p => p.textContent.includes('人物素材另於'));
  if (oldNote) oldNote.textContent = '本機動作預覽；手動檢視動作時暫隱怪物，切回自動戰鬥即恢復。尚未連接正式玩家資料。';
  const group = document.createElement('div'); group.className = 'character-controls';
  group.innerHTML = '<label>人物 <select id="character-choice"><option value="archer">女妖精</option><option value="sword">女劍士</option><option value="mage">女法師</option><option value="thief">女盜賊</option></select></label><label>方向 <select id="character-direction"><option value="auto">自動朝向</option><option value="up">向上</option><option value="down">向下</option><option value="left">向左（鏡像）</option><option value="right">向右</option></select></label><label>動作 <select id="character-action"><option value="auto">場景自動戰鬥</option><option value="walk">行走循環</option><option value="attack">攻擊循環</option><option value="idle">待機</option><option value="death">倒地並停留</option></select></label><p id="character-load-status" role="status">人物讀取中…</p>';
  controls.prepend(group);
  const ids = ['character-choice', 'character-direction', 'character-action'];
  const choice=document.getElementById(ids[0]),direction=document.getElementById(ids[1]),action=document.getElementById(ids[2]),status=document.getElementById('character-load-status');
  const reviewLink=controls.querySelector('a[href*="9621/field.html"]');
  if(reviewLink){reviewLink.textContent='目前人物預覽連結';reviewLink.removeAttribute('target');}
  const actionNames={auto:'場景自動戰鬥',walk:'行走循環（原地檢視）',attack:'攻擊循環',idle:'待機',death:'倒地並停留'};
  const directionNames={auto:'自動朝向',up:'向上',down:'向下',left:'向左',right:'向右'};
  let actors=[];
  const isSourceReview=actor=>actor?.sourceReviewOnly===true||actor?.readiness==='original-source-review-only';
  const hasClip=(actor,a,d)=>Array.isArray(actor.clips[a]?.[d]?.frames)&&actor.clips[a][d].frames.length>0;
  const query=new URLSearchParams(location.search);
  action.value=query.get('action')||action.value;
  direction.value=query.get('direction')||direction.value;
  function options(select,values,names,preferred){select.replaceChildren(...values.map(value=>{const option=document.createElement('option');option.value=value;option.textContent=names[value]||value;return option;}));select.value=values.includes(preferred)?preferred:values[0];}
  function syncAvailability(){
    const actor=actors.find(a=>a.id===choice.value);if(!actor)return;
    const sourceReview=isSourceReview(actor);
    const mixedArcherReview=!sourceReview&&actor.family==='archer'&&actor.coreCandidateEligible===false;
    const full=!sourceReview&&actor.coreCandidateEligible!==false&&['idle','walk','attack','death'].every(a=>['up','down','left','right'].every(d=>hasClip(actor,a,d)));
    const modes=Object.keys(actionNames).filter(a=>a==='auto'?full:Object.keys(actor.clips[a]||{}).some(d=>hasClip(actor,a,d)));
    const actionLabels=sourceReview?{...actionNames,idle:'原立繪（靜態）',attack:'原攻擊序列'}:{...actionNames};
    if(mixedArcherReview&&Object.values(actor.clips.walk||{}).some(c=>c.gaitAccepted!==true))actionLabels.walk+='（步態待驗）';
    const preferredAction=modes.includes(action.value)?action.value:sourceReview&&modes.includes('idle')?'idle':action.value;
    options(action,modes,actionLabels,preferredAction);
    const directions=action.value==='auto'?['auto']:Object.keys(actor.clips[action.value]||{}).filter(d=>hasClip(actor,action.value,d));
    const allDirections=!sourceReview&&['up','down','left','right'].every(d=>directions.includes(d));
    const directionLabels=sourceReview?{...directionNames,left:'來源鏡像（朝向未驗）',right:'原來源（朝向未驗）'}:{...directionNames};
    if(mixedArcherReview)for(const d of directions)if(actor.clips[action.value]?.[d]?.directionVerified===false)directionLabels[d]+='（朝向未驗）';
    const preferredDirection=directions.includes(direction.value)?direction.value:sourceReview&&directions.includes('right')?'right':direction.value;
    options(direction,allDirections&&['walk','attack'].includes(action.value)?['auto',...directions]:directions,directionLabels,preferredDirection);
    const shortActions={idle:'待機',walk:'行走',attack:'攻擊',death:'死亡'},shortDirections={up:'上',down:'下',left:'左',right:'右'};
    const missing=Object.keys(shortActions).flatMap(a=>Object.keys(shortDirections).filter(d=>!hasClip(actor,a,d)).map(d=>shortActions[a]+shortDirections[d]));
    status.dataset.coverage=sourceReview?'・原素材審閱，朝向未驗；原來源／鏡像僅供檢視，不計完整角色。'+(missing.length?'尚缺：'+missing.join('、'):'既有槽位仍待方向與美術驗收。'):missing.length?'・部分素材，尚缺：'+missing.join('、'):'・四方向動作候選';
    if(mixedArcherReview&&actor.pendingCoreClips?.length)status.dataset.coverage+='；核心槽位尚缺或待驗：'+actor.pendingCoreClips.length+'，原方向與步態驗收仍獨立保留。';
    status.textContent=actor.label+status.dataset.coverage;
  }
  function send() {
    const url=new URL(location.href);url.searchParams.set('character',choice.value);url.searchParams.set('action',action.value);url.searchParams.set('direction',direction.value);history.replaceState(null,'',url);
    if(reviewLink)reviewLink.href=url.pathname+url.search;
    frame.contentWindow.postMessage({type:'character-preview', actor:document.getElementById(ids[0]).value, direction:document.getElementById(ids[1]).value, action:document.getElementById(ids[2]).value}, location.origin);
  }
  choice.addEventListener('change',()=>{syncAvailability();send();});
  action.addEventListener('change',()=>{syncAvailability();send();});
  direction.addEventListener('change',send);
  fetch('/ui-generated-20261030/characters-v1/character-preview-index.json').then(r=>{if(!r.ok)throw Error('人物目錄讀取失敗');return r.json();}).then(data=>{actors=data.actors;const labels=Object.fromEntries(actors.map(a=>[a.id,a.label+(a.missingClips?.length?'（部分）':'')]));options(choice,actors.map(a=>a.id),labels,query.get('character')||choice.value);syncAvailability();send();}).catch(e=>status.textContent=e.message);
  frame.addEventListener('load',()=>{if(actors.length)send();});
  window.addEventListener('message', e => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
    if (e.data?.type === 'character-ready'&&e.data.id===choice.value){status.textContent=e.data.label+(status.dataset.coverage||'・2D 動作預覽');send();}
    if (e.data?.type === 'character-error') document.getElementById('character-load-status').textContent = e.data.message;
  });
})();

}