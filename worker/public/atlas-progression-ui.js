(() => {
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function roadmap(catalog,snapshot,level){
  const maps=(catalog?.maps||[]).filter(m=>m.available),done=snapshot?.completedMaps||{},available=new Set(snapshot?.availableMapIds||[]);
  const entries=maps.map(m=>({...m,completed:(done[m.id]||0)>0,completions:done[m.id]||0,unlocked:available.has(m.id),reason:available.has(m.id)?'':level<m.minLevel?`需要 Lv.${m.minLevel}`:'先完成前置星圖'}));
  const next=entries.find(m=>!m.completed&&m.unlocked)||entries.find(m=>!m.completed)||entries.at(-1);
  return {entries,next,stages:[
   {id:'build',name:'確立技能與輔助',done:!!snapshot?.profileSaved,optional:false,action:'build',description:'保存主技能、輔助與自動策略，先選清群、單體或續航方向。'},
   {id:'talents',name:'建立天賦核心',done:(snapshot?.talents?.spent||0)>0,optional:true,action:'talents',description:'比較路線效果，沿連線配置。每個關鍵天賦都要同時考慮代價。'},
   {id:'maps',name:'完成三域巡禮',done:entries.some(m=>m.kind==='tutorial')&&entries.filter(m=>m.kind==='tutorial').every(m=>m.completed),optional:false,action:'expedition',description:'逐步通過月桂、神殿與聖林，觀察通關時間和紅藍水消耗。'},
   {id:'boss',name:'挑戰守望首領',done:entries.filter(m=>m.kind==='boss').some(m=>m.completed),optional:false,action:'expedition',description:'用真實通關紀錄解鎖試煉，以單體、續航與生存檢驗構築。'},
   {id:'craft',name:'定向培養現役裝備',done:(snapshot?.equipment||[]).some(e=>e.crafts>0),optional:true,action:'workshop',description:'依素材來源回刷，選擇精鐵、節魔或持續傷害銘刻；原本 +N 保留。'},
  ]};
 }
 function render(catalog,snapshot,{level=1,busy=false}={}){
  if(!catalog||!snapshot)return '<p class="atlas-note">正在讀取你的實際冒險進度…</p>';
  const plan=roadmap(catalog,snapshot,level),materials=new Map((catalog.materials||[]).map(m=>[m.id,m.name]));
  return `<section class="atlas-growth-guide"><h3>你的冒險成長路線</h3><p>這是依照實際配置與通關紀錄整理的目標。天賦及鍛造是建議成長方向，不額外限制出征。</p><ol class="atlas-growth-stages">${plan.stages.map(s=>`<li class="${s.done?'done':''}"><strong>${s.done?'✓ ':''}${esc(s.name)}${s.optional?' · 建議':''}</strong><p>${esc(s.description)}</p><button type="button" data-growth-open="${s.action}" ${busy?'disabled':''}>${s.done?'檢視與調整':'前往目標'}</button></li>`).join('')}</ol><h3>下一個探索目標</h3>${plan.next?`<p><strong>${esc(plan.next.name)}</strong> · ${plan.next.unlocked?'可出征':esc(plan.next.reason)}</p>`:''}<div class="atlas-growth-maps">${plan.entries.map(m=>`<article><h4>${m.completed?'✓ ':''}${esc(m.name)}</h4><p>Lv.${m.minLevel} · ${m.completions} 次通關${m.unlocked?'':' · '+esc(m.reason)}</p><small>定向材料：${esc(materials.get(m.rewards?.material)||m.rewards?.material||'守望者核心')}</small><button type="button" data-growth-map="${esc(m.id)}" ${busy||!m.unlocked?'disabled':''}>${m.completed?'回刷材料':'安排出征'}</button></article>`).join('')}</div><h3>材料與鍛造目標</h3>${(catalog.recipes||[]).map(r=>`<p><b>${esc(r.name)}</b> · ${esc(r.description)}<br>${Object.entries(r.cost).map(([id,n])=>`${esc(materials.get(id)||id)} ${snapshot.materials?.[id]||0}/${n}`).join(' · ')}</p>`).join('')}<p class="atlas-note">菁英、專家、惡夢、地獄：場景與怪群已備妥，後續玩法尚在準備中。</p></section>`;
 }
 window.RpgAtlasProgression={roadmap,render};
})();
