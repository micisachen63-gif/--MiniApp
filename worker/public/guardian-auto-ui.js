(() => {
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const types={any:'能力不限',attack:'任一攻擊（含其他職業）',melee:'近攻（劍士專用）',ranged:'遠攻（妖精專用）',magic:'魔攻（法師專用）',loot:'掉寶（全職業通用）'};
 const qualities=['品質不限','白以上','綠以上','藍以上','紫以上','紅以上','金'];
 const reasons={target:'祈願成真 · 已召喚到目標',budget:'達到金幣預算，已停止',resources:'資源不足，已停止',stopped:'已停止',missing:'角色資料改變，已停止',rules:'規則更新，已停止'};
 const counts=j=>(j?.counts||[]).slice(0,6).map((n,i)=>`${n}${['白','綠','藍','紫','紅','金'][i]}`).join(' · ');
 const description=j=>`${types[j.targetType]||'能力不限'} · ${qualities[j.targetRank]||'品質不限'}`;
 function markup({options={},job,pending,loading=false}){
  if(pending)return `<section class="guardian-auto-job guardian-auto-pending" role="status"><b>祈願結果待確認</b><small>${esc(description(pending.payload))} · 每批 ${pending.payload.count} 抽</small><p>保留了這次祈願。以原操作確認，已完成的祈願不會再抽一次。</p><button type="button" data-guardian-auto-retry ${loading?'disabled':''}>確認原祈願</button></section>`;
  if(job?.status==='running')return `<section class="guardian-auto-job"><b>大天使正在回應你的祈願</b><small>${esc(description(job))} · 已抽 ${job.totalDraws} 次</small><p>${counts(job)}</p><button type="button" data-guardian-auto-stop ${loading?'disabled':''}>收回祈願 · 停止召喚</button></section>`;
  return `<section class="guardian-auto-options"><label class="guardian-auto-check"><input type="checkbox" data-guardian-auto-enabled ${options.enabled?'checked':''} ${loading?'disabled':''}> 把命運交給大天使 · 自動召喚</label>${options.enabled?`<small class="guardian-auto-flavor">「說出你的願望，餘下就交給我。」</small><div class="guardian-auto-targets"><label>目標能力<select data-guardian-auto-type>${Object.entries(types).map(([id,name])=>`<option value="${id}" ${options.type===id?'selected':''}>${name}</option>`).join('')}</select></label><label>目標品質<select data-guardian-auto-rank>${qualities.map((name,i)=>`<option value="${i}" ${Number(options.rank)===i?'selected':''}>${name}</option>`).join('')}</select></label></div><label class="guardian-auto-budget">金幣預算<input data-guardian-auto-budget type="number" min="0" step="100" placeholder="不限；填0不花金幣" value="${esc(options.budget)}"></label><button type="button" data-guardian-auto-start ${loading?'disabled':''}>託付祈願 · 召喚至目標</button><small>能力、品質可只選一項；兩項都有選時須同時符合。達成祈願即停止，離開畫面也會繼續。金幣預算0仍可使用免費抽次或精選憑證；資源或預算不足停止。</small>`:''}</section>`;
 }
 window.RpgGuardianAutoUI={markup,counts,description,reasons,types,qualities};
})();

