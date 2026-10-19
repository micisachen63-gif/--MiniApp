(function () {
  'use strict';
  const C = window.RpgGuardianContract;
  if (!C) throw new Error('guardian-sigil-contract.js must load before guardian-sigil.js');
  const mounts = new WeakMap();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  const fmt = value => value === null || value === undefined ? '—' : value.toLocaleString('zh-TW');
  const tabs = [['summon', '世界樹召喚'], ['inventory', '羽毛背包'], ['fuse', '羽毛升階'], ['guide', '圖鑑／能力']];
  const qualityName = (config, quality) => config.qualities.find(entry => entry.id === quality)?.name || C.QUALITY_NAMES[quality];
  const typeName = (config, type) => config.types.find(entry => entry.id === type)?.name || C.TYPE_NAMES[type];
  const isApproved = config => config.enabled && config.status === 'approved';
  const stageCost = (config,stage) => stage && isApproved(config) && stage.successRate !== null && stage.goldFee !== null ? `成功率 ${(stage.successRate*100).toLocaleString('zh-TW',{maximumFractionDigits:2})}% · 費用 ${fmt(stage.goldFee)} 金幣` : '成功率與費用待公布';

  function balance(label, value, extra = '') {
    return `<div class="guardian-balance"><span>${label}</span><strong>${fmt(value)}</strong>${extra ? `<small>${extra}</small>` : ''}</div>`;
  }
  function resourcePanel(config, state) {
    const balances = state?.balances || {}, daily = state?.daily || {};
    return `<section class="guardian-resources" aria-label="召喚資源">${balance('持有金幣', balances.gold)}<div class="guardian-free-resource">${balance('免費普通抽次',balances.freeNormalDraws,state?.welcome.claimed?(state.welcome.recipientCharId&&state.welcome.recipientCharId!==state.charId?'贈禮在其他角色':`贈禮 ${fmt(state.welcome.granted)} 抽`):'僅供普通召喚')}</div>${balance('<img src="/art/ui/item-guardian_voucher-20261015.webp" alt="" style="width:18px;height:18px;object-fit:contain;vertical-align:-4px;margin-right:3px">招喚憑證', balances.voucherCount)}${balance('剩餘零散抽次', balances.remainder)}${balance('精選可用抽次', balances.availableDraws)}</section>
      <p class="guardian-daily">今日取得憑證 ${fmt(daily.granted)}${config.limits.dailyVouchers === null ? '' : `／${fmt(config.limits.dailyVouchers)}`} · 今日尚可取得 ${fmt(daily.remaining)}${daily.day ? ` <span>${esc(daily.day)}</span>` : ''}</p>`;
  }
  function summonPanel(config, state, selected, resultMarkup = '') {
    const pool = config.pools[selected], approved = isApproved(config);
    const voucherCopy = pool.drawsPerVoucher === null ? '每張憑證可用抽次待公布' : `每張憑證可進行 ${fmt(pool.drawsPerVoucher)} 抽`;
    const cost = selected === 'normal' ? approved && pool.singleGoldPrice !== null ? `5 抽 ${fmt(pool.singleGoldPrice*5)}／10 抽 ${fmt(pool.tenGoldPrice ?? pool.singleGoldPrice*10)} 金幣，優先使用免費普通抽次` : '金幣消耗待公布' : voucherCopy;
    return `<section class="guardian-pool-panel" aria-label="${esc(pool.name)}"><div class="guardian-pool-tabs" role="group" aria-label="選擇召喚池">${Object.values(config.pools).map(entry => `<button type="button" data-guardian-pool="${entry.id}" aria-pressed="${entry.id === selected}" class="${entry.id === selected ? 'is-selected' : ''}"><span>${esc(entry.name)}</span><small>${entry.id === 'normal' ? '金幣召喚' : '憑證召喚'}</small></button>`).join('')}</div>
      <div class="guardian-pool-copy"><small>${selected === 'normal' ? '星穹祭壇' : '同行之證'}</small><h3>${esc(pool.name)}</h3><p>${selected === 'normal' ? '白至金六種品質皆有機會相逢。' : '綠至金品質，迎接同行的守護。'}</p><p class="guardian-muted">粉與青印記僅透過升階取得。</p><strong>${cost}</strong></div>
      <div class="guardian-cards-scroll" role="region" tabindex="0" aria-label="召喚與揭曉羽毛區域">${resultMarkup || (window.RpgGuardianWorldTree?.markup(config) || '<div class="guardian-tree-placeholder"><b>世界樹</b><small>背景與大天使原畫待製作</small></div>')}<details class="guardian-rules"><summary>查看召喚說明</summary><p>${selected === 'normal' ? approved?'優先使用免費普通抽次，不足部分使用金幣。':'使用金幣召喚。各品質機率與費用將於規則確認後公布。' : `${voucherCopy}。憑證與剩餘抽次分開記錄，今日取得上限不代表累積資源的使用上限。`}</p>${pool.rates.map(rate=>`<p>${esc(qualityName(config,rate.quality))}色 ${fmt(rate.percent)}%</p>`).join('')}<p>結果已入背包後才展開羽毛，返回不會重抽或取消發獎。</p></details></div>
      <footer class="guardian-controls"><div class="guardian-draw-options" role="group" aria-label="召喚抽數">${pool.allowedCounts.map(count => `<button type="button" class="guardian-action" data-guardian-action="summon" data-guardian-count="${count}" data-guardian-available="${C.canAction(config, state, 'summon')}" disabled>${fmt(count)} 抽</button>`).join('') || '<span class="guardian-muted">抽取方式待公布</span>'}</div><div class="guardian-control-buttons"><button type="button" data-guardian-action="summon" disabled>確認召喚</button><button type="button" data-guardian-open-all disabled>全部揭曉</button><button type="button" data-guardian-back>返回</button></div><p class="guardian-planning">召喚規則規劃中，開放後可於此選擇抽數。</p></footer></section>`;
  }
  function itemCard(config, item,assist={}) {
    const status = [item.active ? '永久守護' : '', item.bound ? '已綁定' : '未綁定', item.inTrade ? '交易保管中' : '', item.locked ? '已鎖定' : ''].filter(Boolean);
    const type=config.types.find(entry=>entry.id===item.type),quality=config.qualities.find(entry=>entry.id===item.quality);
    const participating=assist.enabled&&assist.itemId===item.id,resumable=!assist.enabled&&assist.itemId===item.id&&assist.remainingBattles>0;
    return `<article class="guardian-item guardian-quality-${item.quality}" data-guardian-id="${esc(item.id)}"><div class="guardian-item-feather">${type?.artUrl?`<img data-guardian-art src="${esc(type.artUrl)}" alt="${esc(type.alt)}" loading="lazy" decoding="async">`:'<span aria-hidden="true">◇</span>'}</div><div class="guardian-item-copy"><small>${esc(qualityName(config, item.quality))}色羽毛</small><h3 class="guardian-name">${esc(typeName(config, item.type))}</h3><p class="guardian-item-bonus">${esc(effectCopy({type:item.type,damageBonus:quality.damageBonus,lootBonus:quality.lootBonus}))}</p><p>${status.map(esc).join(' · ')}</p>${assist.itemId===item.id?`<small class="guardian-assist-status">${participating?'參戰中':resumable?'已暫停':'待補給'} · 剩餘 ${fmt(assist.remainingBattles)} 戰${resumable?' · 再召喚不耗石':''}</small>`:''}</div><button type="button" class="guardian-assist-toggle ${participating?'is-active':''}" data-guardian-action="assist" disabled>${participating?'取消':'召喚'}</button><details class="guardian-item-management"><summary>管理 <span aria-hidden="true">⌄</span></summary><div class="guardian-item-actions"><button type="button" data-guardian-action="activate" disabled>${item.active?'取消守護':'設為守護'}</button><button type="button" data-guardian-action="lock" disabled>鎖定</button><button type="button" data-guardian-action="share" disabled>分享至群組</button><button type="button" data-guardian-action="unbind" disabled>解綁</button><button type="button" data-guardian-action="trade" disabled>交易</button><button type="button" data-guardian-shop="${esc(item.id)}" data-shop-quality="${item.quality}" ${item.active||item.locked||item.inTrade?'disabled':''}>出售商店</button></div></details>${Object.values(item.reasons || {}).length ? `<p class="guardian-item-reasons">${Object.values(item.reasons).map(esc).join(' · ')}</p>` : ''}</article>`;
  }
  function inventoryPanel(config, state, model={}) {
    const active=state?.activeGuardian,loaded=state?.inventory.items||[],showActive=active&&(!model.inventoryQuality||model.inventoryQuality==='all'||active.quality===model.inventoryQuality);
    const items=showActive?[active,...loaded.filter(item=>item.id!==active.id)]:loaded;
    return `<section class="guardian-inventory" aria-label="守護羽毛背包"><p class="guardian-muted">星環遠征沿用出發時的天使；途中切換用於之後新開的戰鬥。</p><div class="guardian-inventory-tools"><button type="button" data-guardian-shop="" ${model.pending||model.loading?'disabled':''}>天使商店</button><details class="guardian-supply-management"><summary>補給管理 <span aria-hidden="true">⌄</span></summary><div class="guardian-supply-panel"><label><input type="checkbox" data-guardian-assist-supply ${state?.assist.autoBuy?'checked':''} disabled> 金幣補給</label><p>召喚石不足時，以 ${fmt(state?.assist.stoneGold)} 金幣補充 1 顆。只有開啟此選項才購買。</p></div></details><button type="button" data-guardian-refresh aria-label="更新背包" ${model.loading||!model.canRefresh?'disabled':''}>↻</button></div>${`<nav class="guardian-inventory-quality-tabs" role="tablist" aria-label="背包品質">${['all',...C.QUALITY_ORDER].map(quality=>`<button type="button" role="tab" class="${quality==='all'?'':'guardian-quality-'+quality}" data-guardian-inventory-quality="${quality}" aria-selected="${(model.inventoryQuality||'all')===quality}" ${model.pending||model.loading&&!model.inventoryLoading?'disabled':''}>${quality==='all'?'全部':esc(qualityName(config,quality))+'色'}</button>`).join('')}</nav>`}${model.inventoryLoading?'<p class="guardian-inventory-loading" role="status">正在尋找這個品質的天使…</p>':items.length ? `<div class="guardian-item-grid">${items.map(item => itemCard(config, item,state.assist)).join('')}${state?.inventory.nextCursor?'<button type="button" class="guardian-inventory-more" data-guardian-more>載入更多</button>':''}</div>` : `<div class="guardian-empty"><span aria-hidden="true">◇</span><strong>${state ? (model.inventoryQuality&&model.inventoryQuality!=='all'?'尚未持有這個品質的天使':'尚未持有守護羽毛') : '守護羽毛背包等待載入'}</strong><p>取得的印記將列於此處，保留各自的綁定與使用狀態。</p></div>`}</section>`;
  }
  function fusePanel(config,state,selection,disabled,loading=false,stale=false) {
    if(window.RpgGuardianFusionUI)return `<section class="guardian-fuse" aria-label="守護天使合成">${stale?'<p class="guardian-notice" role="status">背包狀態已更新，請點「更新狀態」確認素材。</p>':''}<div data-guardian-fusion-root>${window.RpgGuardianFusionUI.markup(config,state,selection||window.RpgGuardianFusionUI.createSelection(config,state),{disabled,loading})}</div>${state?.inventory.nextCursor?`<button type="button" data-guardian-more ${loading?'disabled':''}>載入更多</button>`:''}</section>`;
    const stages = config.rules.upgradeStages;
    return `<section class="guardian-fuse" aria-label="守護天使合成"><h3>羽毛升階</h3><p>各階素材數依升階規則</p><ol class="guardian-quality-ladder" aria-label="品質階序">${config.qualityOrder.map(id => `<li class="guardian-quality-${id}"><span aria-hidden="true">◇</span>${esc(qualityName(config, id))}</li>`).join('')}</ol>
      ${stages.length ? `<div class="guardian-upgrade-stages" aria-label="各階升階規則">${stages.map(stage => `<article class="guardian-upgrade-stage" data-guardian-upgrade="${stage.from}"><h4><span class="guardian-quality-${stage.from}">${esc(qualityName(config, stage.from))}</span><span aria-hidden="true">→</span><span class="guardian-quality-${stage.to}">${esc(qualityName(config, stage.to))}</span></h4><p>同品質素材 ${fmt(stage.materials)} 張</p><small>失敗退回 ${fmt(stage.refundOnFailure)} 張 · 淨消耗 ${fmt(stage.materials - stage.refundOnFailure)} 張</small><span class="guardian-muted">${stageCost(config,stage)}</span><small>${stage.mixedTypes===true?'可混合類型 · 主羽毛決定結果類型':stage.mixedTypes===false?'素材須同類型':'類型规则待確認'}</small></article>`).join('')}</div>` : '<p class="guardian-muted">各階素材需求等待公布。</p>'}
      <div class="guardian-material-placeholder"><span aria-hidden="true">◇</span><small>素材選擇待開放</small></div><button type="button" class="guardian-action" data-guardian-action="fuse" disabled>合成規則規劃中</button><p class="guardian-muted">成功率、費用、類型與綁定繼承、失敗退回的印記選取方式將於規則確認後公布。</p></section>`;
  }
  function artFallback(message = '守護天使原畫待製作') {
    return `<div class="guardian-guide-art-fallback" role="img" aria-label="${esc(message)}"><span aria-hidden="true">◇</span><p>${esc(message)}</p></div>`;
  }
  function guidePanel(config, selectedType, selectedQuality) {
    const type = config.types.find(entry => entry.id === selectedType) || config.types[0];
    const quality = config.qualities.find(entry => entry.id === selectedQuality) || config.qualities[0];
    const bonus = type.id === 'loot' ? quality.lootBonus : quality.damageBonus;
    const bonusLabel = {melee: '近戰傷害', ranged: '遠程傷害', magic: '魔法傷害', loot: '隨機掉寶率'}[type.id];
    const bonusText = bonus === null ? '待確認' : `${isApproved(config) ? '實際加成' : '建議值'} +${(bonus * 100).toLocaleString('zh-TW', {maximumFractionDigits: 2})}%`;
    const stage = config.rules.upgradeStages.find(entry => entry.from === quality.id);
    const description = type.description || {melee: '提升劍士與盜賊全部路線的近戰傷害；盜賊飛刃與幻刃也適用。', ranged: '守護遠方的箭光，提升對應遠距離攻擊。', magic: '守護符文的流轉，提升對應魔法攻擊。', loot: '守護旅途的收穫，提升符合資格的隨機掉寶機率。'}[type.id];
    return `<section class="guardian-guide" aria-label="守護天使圖鑑與能力"><div class="guardian-type-tabs" role="group" aria-label="選擇守護天使類型">${config.types.map(entry => `<button type="button" data-guardian-type="${entry.id}" class="${entry.id === type.id ? 'is-selected' : ''}" aria-pressed="${entry.id === type.id}">${esc(entry.name.replace(/守護天使$/, ''))}</button>`).join('')}</div>
      <div class="guardian-guide-quality-tabs" role="group" aria-label="選擇守護天使品質">${config.qualities.map(entry => `<button type="button" class="guardian-quality-${entry.id} ${entry.id === quality.id ? 'is-selected' : ''}" data-guardian-quality="${entry.id}" aria-pressed="${entry.id === quality.id}">${esc(entry.name)}</button>`).join('')}</div>
      <div class="guardian-guide-scroll" role="region" tabindex="0" aria-label="選定守護天使圖文"><article class="guardian-guide-card guardian-quality-${quality.id}" data-guardian-guide-type="${type.id}" data-guardian-guide-quality="${quality.id}"><div class="guardian-guide-art">${type.artUrl ? `<img data-guardian-art src="${esc(type.artUrl)}" alt="${esc(type.alt)}" loading="lazy" decoding="async">` : artFallback()}</div><header><small>${esc(quality.name)}色羽毛 · 第 ${fmt(quality.rank)} 階</small><h3 class="guardian-name">${esc(type.name)}</h3><p>${esc(description)}</p></header>
      <dl class="guardian-guide-facts"><div><dt>${bonusLabel}</dt><dd>${bonusText}</dd></div><div><dt>適用戰鬥</dt><dd>掛機 · 群組 Boss · 組隊副本</dd></div><div><dt>啟用方式</dt><dd>同時僅一位守護天使生效</dd></div></dl>
      <p class="guardian-guide-explanation">${type.id === 'loot' ? '掉寶加成採相對倍率，依原本掉寶機率乘上加成；不增加固定獎勵、保底獎勵或每日招喚憑證上限。' : '傷害加成依守護天使對應的攻擊類型套用，不額外提升其他傷害類型。'}</p>
      <section class="guardian-guide-upgrade" aria-label="此階升階材料"><h4>升階材料</h4>${stage ? `<p>${esc(qualityName(config, stage.from))} → ${esc(qualityName(config, stage.to))} · 同品質素材 ${fmt(stage.materials)} 張</p><small>失敗退回 ${fmt(stage.refundOnFailure)} 張 · 淨消耗 ${fmt(stage.materials - stage.refundOnFailure)} 張</small><small>${stageCost(config,stage)}</small><small>${stage.mixedTypes===true?'可混合類型，主羽毛決定結果類型。':stage.mixedTypes===false?'素材須同類型。':'素材類型規則待確認。'}</small>${stage.refundCard==='primary_card'?'<small>失敗退還主羽毛；任一素材綁定，結果與退還羽毛也會綁定。</small>':''}` : `<p>${quality.id === config.qualityOrder.at(-1) ? '目前規劃的最高階印記。' : '對應升階材料待確認。'}</p>`}</section>
      ${quality.rank > config.qualityOrder.indexOf('gold') + 1 ? '<p class="guardian-guide-explanation">此品質僅透過升階取得，不在目前召喚池中。</p>' : ''}${!isApproved(config) ? '<p class="guardian-planning">能力建議值與升階費用尚待確認，養成時間目標不代表保底。</p>' : ''}</article></div><footer class="guardian-controls"><button type="button" data-guardian-back>返回</button></footer></section>`;
  }
  function operationPanel(config, operation, pending, host) {
    if (operation) return `<section class="guardian-operation" aria-label="最近操作結果"><h3>已確認的操作紀錄</h3><p>${operation.status === 'committed' ? '結算已完成；結果以背包紀錄為準。' : '操作狀態尚待確認。'}</p>${operation.status === 'committed' ? `<div class="guardian-item-grid">${operation.results.map(item => itemCard(config, item)).join('')}</div>` : ''}</section>`;
    if (!pending) return '';
    return `<section class="guardian-operation" aria-label="待確認的操作"><h3>有一筆操作待確認</h3><p>先確認原操作紀錄，再繼續旅程。</p><button type="button" data-guardian-recover ${typeof host?.recover === 'function' ? '' : 'disabled'}>核對結果</button></section>`;
  }
  /** Pure markup builder; no network, economy computation, or mutation occurs here. */
  function render(model = {}) {
    const config = C.config(model.config), state = model.state ? C.state(model.state, model.state.charId) : null;
    const selected = model.pool === 'featured' ? 'featured' : 'normal', view = ['overview','fusion-stage'].includes(model.view)?model.view:tabs.some(([id]) => id === model.view) ? model.view : 'summon';
    if(view==='overview'&&window.RpgGuardianRitual)return window.RpgGuardianRitual.overview({config,state,notice:model.notice,loading:model.loading,pending:model.pending,autoPending:model.autoPending});
    if(view==='summon'&&window.RpgGuardianRitual)return window.RpgGuardianRitual.summon({config,state,pool:selected,drawCount:model.drawCount,revealAll:model.revealAll,notice:model.notice,pending:model.pending,autoPending:model.autoPending,loading:model.loading,ratesOpen:model.ratesOpen,settingsOpen:model.settingsOpen,autoOptions:model.autoOptions,autoJob:model.autoJob});
    if(view==='fusion-stage'&&window.RpgGuardianRitual)return window.RpgGuardianRitual.fusion({config,state,frozen:model.fusionFrozen,quote:model.fusionQuote,operation:model.operation,notice:model.notice,pending:model.pending,loading:model.loading,batch:model.fusionBatch});
    if(view==='inventory')return `<section class="guardian-sigil guardian-ritual guardian-inventory-picker" aria-label="天使背包" aria-busy="${model.loading===true}"><header class="guardian-ritual-header"><button type="button" data-guardian-back>返回</button><small>世界樹 · 同行之約</small><h2>天使背包</h2><p class="guardian-inventory-resource">持有 ${fmt(state?.inventory.totalCount)} 位 · 召喚石 ${fmt(state?.assist.stoneCount)} 顆</p></header>${model.notice?`<p class="guardian-notice" role="status">${esc(model.notice)}</p>`:''}${model.pending?operationPanel(config,null,model.pending,model.host):''}<div class="guardian-inventory-picker-content">${inventoryPanel(config,state,model)}</div><footer class="guardian-assist-continuation"><label><input type="checkbox" data-guardian-assist-continuation ${(state?.assist.itemId?state.assist.autoRenew:model.assistRenewDraft)?'checked':''} ${model.loading||model.pending||!state?'disabled':''}> 自動續召</label><small>剩餘戰數用完，以 1 顆召喚石繼續；石不足就停止。${state?.assist.autoBuy?`金幣補給已開，每顆 ${fmt(state.assist.stoneGold)} 金幣。`:''}</small></footer></section>`;
    if(view==='fuse'&&window.RpgGuardianFusionUI)return `<section class="guardian-sigil guardian-ritual guardian-fusion-picker" aria-label="天使合成" aria-busy="${model.loading===true}"><header class="guardian-ritual-header"><button type="button" data-guardian-back>返回</button><small>世界樹 · 神羽傳承</small><h2>天使合成</h2><p class="guardian-fusion-resource">金幣 ${fmt(state?.balances.gold)} <button type="button" class="guardian-fusion-refresh" data-guardian-refresh aria-label="更新狀態" ${model.loading||!model.canRefresh?'disabled':''}>↻</button></p></header>${model.notice?`<p class="guardian-notice" role="status">${esc(model.notice)}</p>`:''}${model.pending?operationPanel(config,null,model.pending,model.host):''}<div class="guardian-fusion-picker-content">${model.fusionBatch&&model.fusionBatch.receipts.length<model.fusionBatch.groups.length?`<button type="button" data-guardian-batch-resume ${model.loading||model.pending?'disabled':''}>繼續合成 · 尚餘 ${fmt(model.fusionBatch.groups.length-model.fusionBatch.receipts.length)} 組</button>`:''}${fusePanel(config,state,model.fusionSelection,model.loading||!!model.pending||model.fusionStale,model.fusionLoading,model.fusionStale&&!model.fusionLoading)}</div></section>`;
    const active = state?.activeGuardian, operation = model.operation ? C.operation(model.operation, state?.charId || model.operation.charId) : null;
    return `<section class="guardian-sigil" aria-label="守護羽毛" aria-busy="${model.loading === true}"><header class="guardian-heading"><div><small>與星同行</small><h2>守護天使</h2><p>將旅途中的力量，化為長久相伴的守護。</p></div><button type="button" data-guardian-refresh ${model.loading || !model.canRefresh ? 'disabled' : ''}>${model.loading ? '載入中' : '更新狀態'}</button></header>
      <p class="guardian-stage-notice" role="status">${state&&!state.unlocked?'守護羽毛於 15 級開放。':isApproved(config)?'規則已確認，操作介面準備中。':'召喚與合成規則規劃中。'}</p>${model.notice ? `<p class="guardian-notice" role="status">${esc(model.notice)}</p>` : ''}${resourcePanel(config, state)}
      ${model.pending ? operationPanel(config, null, model.pending, model.host) : ''}<nav class="guardian-tabs" aria-label="守護天使頁面">${tabs.map(([id, label]) => `<button type="button" data-guardian-view="${id}" aria-pressed="${view === id}" class="${view === id ? 'is-selected' : ''}">${label}</button>`).join('')}</nav>
      <div class="guardian-view-region" data-guardian-current-view="${view}">${view === 'inventory' ? inventoryPanel(config, state,model) : view === 'fuse' ? fusePanel(config,state,model.fusionSelection,model.loading||!!model.pending||model.fusionStale,model.fusionLoading,model.fusionStale&&!model.fusionLoading) : view === 'guide' ? guidePanel(config, model.type, model.quality) : summonPanel(config, state, selected, operation?.action==='summon'&&window.RpgGuardianPresentation ? window.RpgGuardianWorldTree.markup(config) : operation ? operationPanel(config, operation, null, model.host) : '')}</div>
      ${view === 'inventory' ? `<section class="guardian-assist-continuation"><label><input type="checkbox" data-guardian-assist-continuation ${(state?.assist.itemId?state.assist.autoRenew:model.assistRenewDraft)?'checked':''} ${model.loading||model.pending||!state?'disabled':''}> 自動續召</label><small>剩餘戰數用完，以 1 顆召喚石繼續；召喚石不足就停止。${state?.assist.autoBuy?'目前已開啟金幣補給，缺石時將依補給管理的費用購買。':''}</small></section>` : ''}</section>`;
  }

  /** Mount in an isolated container. Host owns authentication, API routing and request IDs. */
  function mount(root, options = {}) {
    if (!root || typeof root.addEventListener !== 'function') throw new TypeError('A guardian container is required');
    mounts.get(root)?.cleanup();
    const host = options.host || window.RpgGuardianHost || {};
    const currentActor = () => String(host.characterId?.() ?? options.state?.charId ?? '');
    let charId = currentActor(), epoch = 0, disposed = false, flight = null, operation = null,tree=null,initialPull=null,presentation=null,visual=null,drawCount=1,revealAll=false,primaryId=null,histories=[],deferredPaint=false,autoPending=null,freshTransitionOperationId=null,freshTransitionOrigin=null,fusionSelection=null,fusionFrozen=null,fusionQuote=null,fusionController=null,assistRenewDraft=false,fusionQuality='white',fusionLoading=false,fusionDataRevision=null,qualityReadSeq=0,qualityReadController=null,allInventory=null,inventoryQuality='all',inventoryLoading=false,inventoryDataRevision=null,inventoryReadSeq=0,inventoryReadController=null;const inventoryPages=new Map();const fusionPages=new Map();const materials=new Set();let stateReadAt=Date.now();
    let config = C.config(options.config), state = options.state ? C.state(options.state, charId) : null;
    if(state?.inventory.quality===null){allInventory=state;inventoryPages.set('all',state);inventoryDataRevision=state.revision;}
    let view = options.initialView==='overview'?'overview':tabs.some(([id])=>id===options.initialView)?options.initialView:'summon', selected = 'normal', guideType = config.types[0].id, guideQuality = config.qualities[0].id, notice = '',ratesOpen=false,settingsOpen=false,autoJob=host.autoCurrent?.()||null,autoOptions={enabled:false,type:'any',rank:0,budget:''}, pending = options.pending ? C.recoveryQuery(options.pending) : null;
    let fusionBatch=null,batchRunning=false;
    const Batch=window.RpgGuardianFusionBatch;
    const controllers = new Set(); const interactive=options.interactive===true&&typeof host.mutate==='function'; try{pending=pending||host.loadPending?.();autoPending=readAutoPending(host.loadAutoPending?.());const saved=host.loadReceipt?.();if(saved?.operation){operation=C.operation(saved.operation,charId);visual=saved.presentation;}fusionBatch=Batch?.restore(host.loadFusionBatch?.(),charId)||null;if(pending?.action==='fuse'&&pending.payload){fusionFrozen=pending.payload;view='fusion-stage';}}catch{}
    function readAutoPending(value){
      const body=value?.payload;
      if(!value||String(value.characterId)!==charId||!/^[A-Za-z0-9_-]{6,64}$/.test(value.requestId||'')||!body||!['normal','featured'].includes(body.pool)||![1,5,10].includes(body.count)||!['any','attack','melee','ranged','magic','loot'].includes(body.targetType)||!Number.isInteger(body.targetRank)||body.targetRank<0||body.targetRank>6||body.maxGold!==null&&(!Number.isSafeInteger(body.maxGold)||body.maxGold<0))return null;
      return {characterId:charId,requestId:value.requestId,payload:{pool:body.pool,count:body.count,targetType:body.targetType,targetRank:body.targetRank,maxGold:body.maxGold}};
    }
    function sceneInteracting(){return (initialPull?.isInteracting?.()??(initialPull?.getState().pointer!=null))||presentation?.isInteracting?.()===true;}
    function transitionOrigin(scene){
      const feather=scene.querySelector?.('.guardian-held-feather-art')||scene.querySelector?.('[data-guardian-start-pull]'),box=scene.getBoundingClientRect?.(),held=feather?.getBoundingClientRect?.();
      if(!box||!held||!(box.width>0)||!(box.height>0)||![box.left,box.top,held.left,held.top,held.width,held.height].every(Number.isFinite))return null;
      return {x:Math.max(0,Math.min(100,(held.left+held.width/2-box.left)/box.width*100)),y:Math.max(0,Math.min(100,(held.top+held.height/2-box.top)/box.height*100))};
    }
    function interactionChanged(){
      enhance();
      Promise.resolve().then(()=>{if(!disposed&&deferredPaint&&!flight&&!sceneInteracting()&&!initialPull?.getState().requesting)paint();});
    }
    function fusionFresh(){return typeof host.state!=='function'||state?.inventory.quality===fusionQuality&&fusionDataRevision!==null&&fusionDataRevision===state.revision;}
    function renderModel(){return {config,state,pool:selected,view,drawCount,revealAll,ratesOpen,settingsOpen,autoOptions,autoJob,type:guideType,quality:guideQuality,notice,pending,autoPending,operation,fusionSelection,fusionFrozen,fusionQuote,fusionBatch,batchRunning,fusionLoading,inventoryQuality,inventoryLoading:inventoryLoading||view==='inventory'&&state?.inventory.quality!==(inventoryQuality==='all'?null:inventoryQuality),fusionStale:view==='fuse'&&!fusionFresh(),assistRenewDraft,host,loading:!!flight||batchRunning,canRefresh:typeof host.state==='function'};}
    // Resource/job polling changes the controls, never the live media or pull surface.
    function redrawSummonControls(){
      const footer=root.querySelector('.guardian-ritual-footer'),doc=root.ownerDocument;
      if(view!=='summon'||!footer||!doc?.createElement||typeof footer.replaceWith!=='function')return false;
      settingsOpen=root.querySelector('.guardian-summon-settings')?.open??settingsOpen;
      ratesOpen=root.querySelector('.guardian-ritual-rates')?.open??ratesOpen;
      const panel=footer.querySelector('.guardian-settings-panel'),scroll=panel?.scrollTop||0;
      const focused=doc.activeElement&&footer.contains(doc.activeElement)?doc.activeElement:null;
      const attribute=focused?.getAttributeNames?.().find(name=>name.startsWith('data-guardian-'));
      const summarySelector=focused?.tagName==='SUMMARY'?(focused.parentElement?.classList.contains('guardian-summon-settings')?'.guardian-summon-settings>summary':focused.parentElement?.classList.contains('guardian-ritual-rates')?'.guardian-ritual-rates>summary':null):null;
      const focusValue=focused?.value,selectionStart=focused?.selectionStart,selectionEnd=focused?.selectionEnd;
      const template=doc.createElement('template');template.innerHTML=render(renderModel());
      const next=template.content?.querySelector('.guardian-ritual-footer');
      if(!next)return false;
      footer.replaceWith(next);deferredPaint=false;
      const nextPanel=next.querySelector('.guardian-settings-panel');if(nextPanel)nextPanel.scrollTop=scroll;
      if(attribute||summarySelector){
        const nodes=attribute?[...next.querySelectorAll(`[${attribute}]`)]:[];
        const restored=attribute?nodes.find(node=>node.getAttribute(attribute)===focused.getAttribute(attribute)&&(focused.type!=='radio'&&focused.type!=='checkbox'||node.value===focusValue)):next.querySelector(summarySelector);
        if(restored){
          if('value' in restored&&focused.type!=='radio'&&focused.type!=='checkbox')restored.value=focusValue;
          restored.focus?.({preventScroll:true});
          if(Number.isInteger(selectionStart)&&Number.isInteger(selectionEnd))try{restored.setSelectionRange?.(selectionStart,selectionEnd);}catch{}
        }
      }
      if(interactive)enhance();return true;
    }
    function redrawLightweight(){
      if(redrawSummonControls())return;
      if(!flight&&!sceneInteracting())paint();else{deferredPaint||=sceneInteracting();enhance();}
    }
    function syncActor() {
      const next = currentActor();
      if (next !== charId) { charId = next; epoch++;fusionBatch=Batch?.restore(host.loadFusionBatch?.(),charId)||null;batchRunning=false; state = null; operation = null; pending = host.loadPending?.()||null;autoPending=readAutoPending(host.loadAutoPending?.());autoJob=host.autoCurrent?.()||null;freshTransitionOperationId=null;freshTransitionOrigin=null;visual=null;histories=[];materials.clear();primaryId=null;fusionSelection=null;fusionFrozen=null;fusionQuote=null;fusionQuality='white';fusionPages.clear();inventoryPages.clear();inventoryQuality='all';inventoryLoading=false;inventoryDataRevision=null;inventoryReadSeq++;inventoryReadController?.abort();inventoryReadController=null;allInventory=null;fusionLoading=false;fusionDataRevision=null;qualityReadSeq++;qualityReadController?.abort();qualityReadController=null;if(view==='fusion-stage')view='fuse';notice = ''; flight = null; controllers.forEach(controller => controller.abort()); controllers.clear(); }
    }
    function paint() {
      if(disposed)return;
      deferredPaint=false;initialPull?.cleanup();initialPull=null;presentation?.cleanup();presentation=null;tree?.cleanup();tree=null;fusionController?.cleanup();fusionController=null;
      const fusion=window.RpgGuardianFusionUI;
      if(view==='fuse'&&fusion&&state&&!fusionLoading)fusionSelection=fusion.normalize(config,state,fusionSelection||fusion.createSelection(config,state));
      root.innerHTML=render(renderModel());if(interactive)enhance();
      if(view==='fuse'&&fusion&&state){const slot=root.querySelector('[data-guardian-fusion-root]');if(slot)fusionController=fusion.mount(slot,{config,state,selection:fusionSelection,disabled:!capable('fuse')||!fusionFresh(),loading:fusionLoading,onChange:next=>{const changed=next.quality!==fusionQuality;fusionSelection=next;fusionQuality=next.quality;if(changed)void loadFusionQuality(fusionQuality);},onFill:fillAllFusion,onPrepare:prepareFusion,onError:message=>{notice=message;paint();}});}
      const scene=root.querySelector?.('.guardian-worldtree-scene');
      if(scene){
        const resultStage=operation?.status==='committed'&&(view==='summon'&&operation.action==='summon'||view==='fusion-stage'&&operation.action==='fuse');
        if(resultStage&&window.RpgGuardianPresentation){
          const playTransition=operation.operationId===freshTransitionOperationId,origin=playTransition?freshTransitionOrigin:null;freshTransitionOperationId=null;freshTransitionOrigin=null;
          presentation=window.RpgGuardianPresentation.mount(scene,{config,operation,previous:visual,playTransition,transitionOrigin:origin,revealAllOnReady:revealAll,onInteractionChange:interactionChanged,serverNow:sceneNow,onUpdate:value=>{visual=value;host.saveReceipt?.(operation,value);updateRevealControls();}});
        }else{
          tree=window.RpgGuardianWorldTree?.mount(scene,{serverNow:sceneNow});
          if(interactive&&['summon','fusion-stage'].includes(view)&&window.RpgGuardianSummonGesture){
            const action=view==='fusion-stage'?'fuse':'summon';
            initialPull=window.RpgGuardianSummonGesture.mount(scene,{config,tree,action,distance:()=>tree?.pullDistance?.()||(scene.dataset?.guardianAngelPose==='portrait'?90:110),onHolding:interactionChanged,
              canStart:()=>capable(action)&& (action==='fuse'?fusionReady().ok:quote()?.ok),
              commit:()=>{if(action==='fuse'){const q=fusionReady();if(!q.ok){notice=q.reason;enhance();return Promise.resolve(null);}return fusionBatch?runFusionBatch():write('fuse',{...fusionFrozen,itemIds:[...fusionFrozen.itemIds]},null,false,true);}return write('summon',{pool:selected,count:drawCount,configVersion:config.configVersion},null,false,true);},
              onFinish:(result,detail)=>{if(result&&detail.complete){freshTransitionOperationId=result.operationId;freshTransitionOrigin=transitionOrigin(scene);visual={operationId:result.operationId,ready:true,selected:null,revealed:[]};host.saveReceipt?.(result,visual);}paint();}});
          }
        }
      }
      if(!disposed&&interactive)updateSummonButton();
    }
    function sceneNow(){return state?.serverNow===null||state?.serverNow===undefined?Date.now():state.serverNow+Math.max(0,Date.now()-stateReadAt);}
    function prepareFusion(frozen,q){
      if(!capable('fuse')||!frozen||!q?.ok||!fusionFresh())return;
      fusionFrozen=Object.freeze({...frozen,itemIds:Object.freeze([...frozen.itemIds])});fusionQuote=q;
      fusionBatch=frozen.groups?Batch?.create(frozen,charId,q.quality)||null:null;
      if(frozen.groups&&!fusionBatch){notice='批次合成模組未載入，請重新開啟遊戲。';paint();return;}
      if(host.saveFusionBatch?.(fusionBatch)===false){notice='無法保存合成進度，請先釋放瀏覽器儲存空間。';paint();return;}
      operation=null;visual=null;notice='';view='fusion-stage';paint();
    }
    function fusionReady(){
      const fusion=window.RpgGuardianFusionUI;
      if(fusionBatch&&fusionBatch.receipts.length<fusionBatch.groups.length){
        const stage=config.rules.upgradeStages.find(row=>row.from===fusionBatch.quality),remaining=fusionBatch.groups.length-fusionBatch.receipts.length;
        if(fusionBatch.charId!==charId||fusionBatch.configVersion!==config.configVersion||!stage)return {ok:false,reason:'升階規則已更新，請返回重新登錄。'};
        const remainingIds=new Set(fusionBatch.groups.slice(fusionBatch.receipts.length).flatMap(group=>group.itemIds));
        if(state?.inventory.items.some(item=>remainingIds.has(item.id)&&(item.active||item.locked||item.inTrade||item.inExchange||item.exchangeId||item.quality!==fusionBatch.quality)))return {ok:false,reason:'登錄素材的狀態已改變，請返回重新登錄。'};
        return state?.balances.gold>=remaining*stage.goldFee?{ok:true,stage,fee:remaining*stage.goldFee}:{ok:false,reason:'剩餘合成的金幣不足，請返回取消部分組別。'};
      }
      if(!state||!fusion||!fusionFrozen||!fusionFresh()||fusionFrozen.configVersion!==config.configVersion)return {ok:false,reason:'素材或升階規則已更新，請返回重新選擇。'};
      const primary=state.inventory.items.find(item=>item.id===fusionFrozen.primaryId),selection=fusion.normalize(config,state,{charId,quality:primary?.quality,itemIds:[...fusionFrozen.itemIds],primaryId:fusionFrozen.primaryId}),q=fusion.quote(config,state,selection);
      if(!q.ok||q.selectedCount!==fusionFrozen.itemIds.length||!fusionFrozen.itemIds.every(id=>q.items.some(item=>item.id===id)))return {ok:false,reason:q.reason||'選定素材已更新，請返回重新選擇。'};
      return q;
    }
    function saveFusionBatch(plan){if(host.saveFusionBatch?.(plan)===false)throw Error('合成進度未能保存，請先核對原結果。');}
    function ackFusionBatch(receipt){if(!fusionBatch||fusionBatch.receipts.length>=fusionBatch.groups.length)return;Batch.record(fusionBatch,receipt);saveFusionBatch(fusionBatch);}
    async function runFusionBatch(){
      if(!fusionBatch||batchRunning||!capable('fuse',true)||!fusionReady().ok)return null;
      const plan=fusionBatch,captured=charId,revision=epoch;batchRunning=true;enhance();
      try{const result=await Batch.run(plan,{current:()=>current(captured,revision)&&fusionBatch===plan,persist:saveFusionBatch,onProgress:()=>enhance(),send:payload=>write('fuse',payload,null,false,true,true)});return plan.receipts.length===plan.groups.length?result:null;}
      catch(error){if(current(captured,revision))notice=error.message;return null;}
      finally{batchRunning=false;if(current(captured,revision))enhance();}
    }
    async function fillAllFusion(selection){
      if(!capable('fuse')||view!=='fuse')return;
      if(typeof host.state!=='function'){fusionSelection=window.RpgGuardianFusionUI.fill(config,state,selection);notice=fusionSelection.notice;paint();return fusionSelection;}
      const quality=fusionQuality,captured=charId,revision=epoch,controller=new AbortController();cancelQualityRead();const seq=qualityReadSeq;
      qualityReadController=controller;controllers.add(controller);fusionLoading=true;const task={kind:'fusion-quality',quality,promise:null};flight=task;notice='正在登錄這個品質的全部完整組…';paint();
      task.promise=(async()=>{try{
        let next=null;
        // Explicit one-click registration is the only action that reads every
        // page. Restart once on a revision change; never combine snapshots.
        for(let attempt=0;attempt<2;attempt++){
          let cursor=null,items=[],snapshot=null,changed=false;const cursors=new Set();
          do{
            const page=C.state(await host.state({quality,...(cursor?{cursor}:{}),signal:controller.signal}),captured);
            if(!current(captured,revision)||seq!==qualityReadSeq||view!=='fuse'||quality!==fusionQuality)return null;
            if(page.inventory.quality!==quality)throw Error('品質清單不一致，請重新登錄。');
            if(snapshot!==null&&page.revision!==snapshot){changed=true;break;}snapshot=page.revision;items.push(...page.inventory.items);next=page;
            cursor=page.inventory.nextCursor;if(cursor&&cursors.has(cursor))throw Error('背包分頁未前進，請重新登錄。');if(cursor)cursors.add(cursor);
          }while(cursor);
          if(changed){if(attempt===1)throw Error('背包持續更新，這次未登錄素材；請稍後再試。');continue;}
          next.inventory.items=[...new Map(items.map(item=>[item.id,item])).values()];next.inventory.nextCursor=null;break;
        }
        if(!next||!accept(next))throw Error('背包已更新，請重新登錄。');
        fusionDataRevision=state.revision;fusionPages.set(quality,state);fusionSelection=window.RpgGuardianFusionUI.fill(config,state,{...selection,charId,quality});notice=fusionSelection.notice;
        return fusionSelection;
      }catch(error){if(current(captured,revision)&&seq===qualityReadSeq&&!controller.signal.aborted)notice=error.message;return null;}
      finally{controllers.delete(controller);if(seq===qualityReadSeq){qualityReadController=null;fusionLoading=false;if(flight===task)flight=null;}if(!disposed&&seq===qualityReadSeq)paint();}})();return task.promise;
    }
    function ownedItem(id){return state?.inventory.items.find(item=>item.id===id)||(state?.activeGuardian?.id===id?state.activeGuardian:null);}
    function current(captured, revision) { return !disposed && currentActor() === captured && charId === captured && epoch === revision; }
    function accept(next) {
      if (state && state.revision !== null && (next.revision === null || next.revision < state.revision)) return false;
      if(state?.revision!==next.revision){fusionPages.clear();fusionDataRevision=null;inventoryPages.clear();inventoryDataRevision=null;allInventory=null;}
      state = next;if(state.inventory.quality===null){allInventory=state;inventoryPages.set('all',state);if(inventoryQuality==='all')inventoryDataRevision=state.revision;}if(state.assist.itemId)assistRenewDraft=state.assist.autoRenew;stateReadAt=Date.now(); return true;
    }
    function cancelInventoryRead(){inventoryReadSeq++;inventoryReadController?.abort();inventoryReadController=null;if(flight?.kind==='inventory-quality')flight=null;inventoryLoading=false;}
    function loadInventoryQuality(quality,{force=false,append=false}={}){
      syncActor();if(disposed||view!=='inventory'||quality!=='all'&&!C.QUALITY_ORDER.includes(quality))return Promise.resolve(null);
      if(flight&&flight.kind!=='inventory-quality'||pending)return Promise.resolve(null);
      inventoryQuality=quality;
      if(typeof host.state!=='function'){paint();return Promise.resolve(state);}
      if(flight?.quality===quality&&!force&&!append)return flight.promise;
      const cached=inventoryPages.get(quality),filter=quality==='all'?null:quality;
      if(!force&&!append&&cached&&cached.revision===state?.revision){cancelInventoryRead();accept(C.state({...state,inventory:cached.inventory},charId));inventoryDataRevision=state.revision;paint();return Promise.resolve(state);}
      if(append&&(state?.inventory.quality!==filter||inventoryDataRevision!==state?.revision))return loadInventoryQuality(quality,{force:true});
      const cursor=append?state?.inventory.nextCursor:null;if(append&&!cursor)return Promise.resolve(state);
      const captured=charId,revision=epoch,baseRevision=state?.revision,previous=append?state.inventory.items:[],controller=new AbortController();
      cancelInventoryRead();const seq=inventoryReadSeq;inventoryReadController=controller;controllers.add(controller);inventoryLoading=true;inventoryDataRevision=null;
      const task={kind:'inventory-quality',quality,promise:null};flight=task;notice='';paint();
      task.promise=(async()=>{try{
        let next=C.state(await host.state({...(filter?{quality:filter}:{}),...(cursor?{cursor}:{}),signal:controller.signal}),captured);
        if(!current(captured,revision)||seq!==inventoryReadSeq||view!=='inventory'||inventoryQuality!==quality)return null;
        if(next.inventory.quality!==filter)throw Error('品質清單尚未更新，請重新載入。');
        if(append&&next.revision!==baseRevision){next=C.state(await host.state({...(filter?{quality:filter}:{}),signal:controller.signal}),captured);if(!current(captured,revision)||seq!==inventoryReadSeq||view!=='inventory'||next.inventory.quality!==filter)return null;}
        else if(append)next.inventory.items=[...new Map([...previous,...next.inventory.items].map(item=>[item.id,item])).values()];
        if(!accept(next))throw Error('背包已更新，請重新查看這個品質。');
        inventoryDataRevision=state.revision;inventoryPages.set(quality,state);return state;
      }catch(error){if(current(captured,revision)&&seq===inventoryReadSeq&&!controller.signal.aborted)notice=error.message||'背包暫時無法載入，請更新重試。';return null;
      }finally{controllers.delete(controller);if(seq===inventoryReadSeq){inventoryReadController=null;inventoryLoading=false;if(flight===task)flight=null;}if(!disposed&&seq===inventoryReadSeq){syncActor();paint();}}})();return task.promise;
    }
    function cancelQualityRead(){qualityReadSeq++;qualityReadController?.abort();qualityReadController=null;if(flight?.kind==='fusion-quality')flight=null;fusionLoading=false;}
    function loadFusionQuality(quality,{force=false,append=false}={}){
      syncActor();if(disposed||view!=='fuse'||!C.QUALITY_ORDER.includes(quality))return Promise.resolve(null);
      if(typeof host.state!=='function'){paint();return Promise.resolve(state);}
      if(flight&&flight.kind!=='fusion-quality')return (flight.promise||Promise.resolve()).then(()=>!disposed&&view==='fuse'&&!pending?loadFusionQuality(quality,{force,append}):null);
      if(flight?.quality===quality&&!force&&!append)return flight.promise;
      const cached=fusionPages.get(quality);
      if(!force&&!append&&cached&&cached.revision===state?.revision){cancelQualityRead();accept(C.state({...state,inventory:cached.inventory},charId));fusionDataRevision=state.revision;paint();return Promise.resolve(state);}
      if(append&&!fusionFresh())return loadFusionQuality(quality,{force:true});
      const cursor=append?state?.inventory.nextCursor:null;if(append&&!cursor)return Promise.resolve(state);
      const captured=charId,revision=epoch,baseRevision=state?.revision,priorRevision=fusionDataRevision??cached?.revision,
        previousItems=state?.inventory.quality===quality?state.inventory.items:[],wantedIds=fusionSelection?.quality===quality?[...fusionSelection.itemIds]:[],controller=new AbortController();
      cancelQualityRead();const seq=qualityReadSeq;qualityReadController=controller;controllers.add(controller);fusionLoading=true;fusionDataRevision=null;
      if(state)state={...state,inventory:{...state.inventory,quality,items:append?previousItems:[],nextCursor:append?cursor:null}};
      const task={kind:'fusion-quality',quality,promise:null};flight=task;notice='';paint();
      task.promise=(async()=>{try{
        let next=C.state(await host.state({quality,...(cursor?{cursor}:{}),signal:controller.signal}),captured);
        if(!current(captured,revision)||seq!==qualityReadSeq||view!=='fuse'||fusionQuality!==quality)return null;
        if(next.inventory.quality!==quality)throw Error('品質清單尚未更新，請重新載入。');
        // A new character revision invalidates old page IDs. Rebase this user-
        // requested pagination once instead of combining different snapshots.
        if(append&&next.revision!==baseRevision){next=C.state(await host.state({quality,signal:controller.signal}),captured);if(!current(captured,revision)||seq!==qualityReadSeq||view!=='fuse'||next.inventory.quality!==quality)return null;}
        if(next.revision===priorRevision&&previousItems.length){
          next.inventory.items=[...new Map([...previousItems,...next.inventory.items].map(item=>[item.id,item])).values()];
          if(!append&&cached?.revision===next.revision)next.inventory.nextCursor=cached.inventory.nextCursor;
        }else if(wantedIds.length){
          // A selected card may belong to a later loaded page. Validate only
          // those old selection neighbourhoods, never infer deletion from page 1
          // and never scan or preload the complete inventory.
          const old=[...previousItems].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),checked=new Set(next.inventory.items.map(item=>item.id));
          for(const id of wantedIds){if(checked.has(id))continue;const at=old.findIndex(item=>item.id===id);if(at<=0)continue;
            const extra=C.state(await host.state({quality,cursor:old[at-1].id,signal:controller.signal}),captured);
            if(!current(captured,revision)||seq!==qualityReadSeq||view!=='fuse')return null;
            if(extra.inventory.quality!==quality||extra.revision!==next.revision)throw Error('素材狀態再次更新，請重新確認。');
            extra.inventory.items.forEach(item=>checked.add(item.id));next.inventory.items=[...new Map([...next.inventory.items,...extra.inventory.items].map(item=>[item.id,item])).values()];
          }
        }
        next.inventory.items.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
        if(!accept(next))throw Error('背包狀態已更新，請再次確認素材。');
        fusionDataRevision=state.revision;fusionPages.set(quality,state);return state;
      }catch(error){if(current(captured,revision)&&seq===qualityReadSeq&&!controller.signal.aborted)notice=error.message||'這個品質暫時無法載入，請更新狀態。';return null;
      }finally{controllers.delete(controller);if(seq===qualityReadSeq){qualityReadController=null;fusionLoading=false;if(flight===task)flight=null;}if(!disposed&&seq===qualityReadSeq){syncActor();paint();}}})();return task.promise;
    }
    function capable(action,allowHeld=false,allowBatch=false){return interactive&&!flight&&!pending&&(!batchRunning||allowBatch)&&(action!=='summon'||!autoPending&&autoJob?.status!=='running')&&(allowHeld||!sceneInteracting())&&C.canAction(config,state,['lock','share','assist'].includes(action)?'activate':action);}
    function quote(){
      const pool=config.pools[selected],b=state?.balances;if(!b||!pool.allowedCounts.includes(drawCount))return null;
      if(selected==='normal'){if(b.freeNormalDraws===null||b.gold===null||pool.singleGoldPrice===null||pool.tenGoldPrice===null)return null;const free=Math.min(drawCount,b.freeNormalDraws),paid=drawCount-free,gold=paid===10?pool.tenGoldPrice:paid*pool.singleGoldPrice;return {ok:b.gold>=gold,text:`免費普通抽次 ${fmt(free)}＋金幣 ${fmt(gold)}`};}
      if(b.remainder===null||b.voucherCount===null||!pool.drawsPerVoucher)return null;const vouchers=Math.ceil(Math.max(0,drawCount-b.remainder)/pool.drawsPerVoucher);return {ok:b.voucherCount>=vouchers,text:`憑證 ${fmt(vouchers)} 張＋可用零散抽次（本次共 ${fmt(drawCount)} 抽）`};
    }
    function updateSummonButton(){
      const button=root.querySelector('[data-guardian-action="summon"]:not([data-guardian-count])');if(!button)return;
      const committed=operation?.action==='summon',opening=committed&&!visual?.ready,scattering=visual?.phase==='scatter',sending=!!flight&&pending?.action==='summon',transitioning=opening&&initialPull?.isInteracting?.()===true;
      button.textContent=sending?'召喚回應中':transitioning?'神羽展開中':scattering?'神羽散開中':opening?'展開神羽':committed?'再次祈願':'拔取神羽';
      button.disabled=scattering|| (opening?!!flight||!!pending||sceneInteracting()||!presentation:!capable('summon')||!quote()?.ok||!committed&&!initialPull);
    }
    function updateRevealControls(){if(disposed)return;const button=root.querySelector?.('[data-guardian-open-all]');if(button)button.disabled=!visual?.ready||visual.revealed.length===(operation?.results.length||0);const label=root.querySelector?.('.guardian-controls .guardian-planning');const chosen=operation?.results.find(item=>item.id===visual?.selected);let detail=root.querySelector?.('.guardian-result-selection');if(label&&operation?.action==='summon'&&!detail){label.insertAdjacentHTML('afterend','<p class="guardian-result-selection"></p>');detail=root.querySelector('.guardian-result-selection');}if(detail){detail.className='guardian-result-selection'+(chosen&&visual.revealed.includes(chosen.id)?' guardian-name guardian-quality-'+chosen.quality:'');const quality=config.qualities.find(quality=>quality.id===chosen?.quality);detail.textContent=chosen&&visual.revealed.includes(chosen.id)?qualityName(config,chosen.quality)+'色 · '+typeName(config,chosen.type)+' · '+effectCopy({type:chosen.type,damageBonus:quality.damageBonus,lootBonus:quality.lootBonus}):visual?.selected?'再點選一次，揭曉守護天使。':'';}if(label){if(flight&&pending?.action==='summon')label.textContent='大天使正在回應，請稍候；無需重複召喚。';else if(pending?.action==='summon')label.textContent='前次結果待確認，請開啟召喚設定安全重試。';else if(operation?.action==='summon')label.textContent=visual?.phase==='scatter'?'神羽正隨光芒散開，稍後點選迎接守護。':visual?.ready?(visual.revealed.length===operation.results.length?'守護天使已現身 · 點選查看能力':operation.results.length===1?'點選神羽，迎接守護天使':`已揭曉 ${visual.revealed.length}／${operation.results.length} · 點選羽毛，再點一次揭曉。`):initialPull?.isInteracting?.()?'神羽正在展開，結果已存背包。':'已入背包，向下拉大羽毛展開本批結果。';else if(autoJob?.status==='running')label.textContent='背景祈願進行中；可開啟祈願進度查看或停止。';}updateSummonButton();}
    function enhance(){
      const message=root.querySelector('.guardian-stage-notice');if(message)message.textContent=state&&!state.unlocked?'守護羽毛於 15 級開放。':flight?(pending?.action==='summon'?'大天使正在回應，請稍候。':'正在確認，請稍候。'):pending?'先確認上一筆操作，再繼續旅程。':view==='summon'?'長按銀白羽毛，向下拔取。':'世界樹與你同行。';
      if(message&&view==='summon'&&operation?.action==='summon'&&operation.status==='committed'&&!flight&&!pending){message.textContent=`已取得 ${operation.results.length} 根守護羽毛，結果已存背包。`;if(notice.startsWith('已取得'))root.querySelector('.guardian-notice')?.remove();}
      for(const shop of root.querySelectorAll('[data-guardian-shop]')){shop.disabled||=!!flight||!!pending||typeof host.openShop!=='function';shop.onclick=()=>{if(!shop.disabled)host.openShop(shop.dataset.guardianShop||null,shop.dataset.shopQuality||'all');};}
      const buttons=root.querySelectorAll('[data-guardian-action]');for(const button of buttons){const action=button.dataset.guardianAction,item=ownedItem(button.closest('[data-guardian-id]')?.dataset.guardianId);button.disabled=!capable(action);if(item){if(action==='activate'){button.textContent=item.active?'取消守護':'設為守護';button.disabled||=item.locked||item.inTrade;}if(action==='assist'){const a=state.assist,participating=a.enabled&&a.itemId===item.id,resumable=!a.enabled&&a.itemId===item.id&&a.remainingBattles>0;button.textContent=participating?'取消':'召喚';button.classList?.toggle('is-active',participating);button.disabled||=!participating&&(item.inTrade||item.locked||a.enabled&&a.itemId!==item.id||!resumable&&!(a.stoneCount>0));}if(action==='lock'){button.textContent=item.locked?'解除鎖定':'鎖定';button.disabled||=item.active||item.inTrade;}if(action==='unbind')button.disabled||=!item.bound||item.active||item.locked||item.inTrade;if(action==='trade')button.disabled||=item.bound||item.active||item.locked||item.inTrade;if(action==='share'){button.textContent=item.bound||item.active||item.locked?'展示至群組':'分享至群組';button.disabled||=item.inTrade;}}}
      if(view==='summon'){const start=root.querySelector('[data-guardian-auto-start]');if(start)start.disabled=!!flight||!!pending||!!autoPending||sceneInteracting()||!state?.unlocked||autoJob?.status==='running'||autoOptions.type==='any'&&autoOptions.rank===0;for(const input of root.querySelectorAll('[data-guardian-auto-enabled],[data-guardian-auto-type],[data-guardian-auto-rank],[data-guardian-auto-budget]'))input.disabled=!!flight||!!pending||!!autoPending||sceneInteracting();const q=quote();for(const input of root.querySelectorAll('[data-guardian-pool-choice],[data-guardian-batch-size],[data-guardian-reveal-all]'))input.disabled=!!flight||!!pending||!!autoPending||sceneInteracting();for(const button of root.querySelectorAll('[data-guardian-count]')){const on=Number(button.dataset.guardianCount)===drawCount;button.classList.toggle('is-selected',on);button.setAttribute('aria-pressed',String(on));}updateSummonButton();const text=root.querySelector('.guardian-controls .guardian-planning');if(text)text.textContent=q?'向下拉到底，放開迎接守護 · '+q.text:'請載入資源後選擇抽數。';updateRevealControls();}
      if(view==='inventory'){const text=root.querySelector('.guardian-planning');if(text)text.textContent='召喚參戰會綁定天使；取消召喚保留剩餘戰數，管理內可調整永久守護。';root.querySelector('.guardian-inventory-tools')?.insertAdjacentHTML('afterbegin',`<button type="button" data-guardian-history ${flight?'disabled':''}>召喚紀錄</button>${histories.length?`<details class="guardian-history" open><summary>已結算結果</summary>${histories.map(item=>`<button type="button" data-guardian-history-op="${esc(item.operationId)}">${item.action==='fuse'?'升階':'召喚'} · ${item.drawCount||item.results.length} 根 · ${item.createdAt?new Date(item.createdAt+8*3600000).toISOString().slice(5,16).replace('T',' '):'已結算'} · 重看揭曉</button>`).join('')}</details>`:''}`);for(const input of root.querySelectorAll('[data-guardian-assist-continuation],[data-guardian-assist-supply]'))input.disabled=!capable('assist');}
      if(view==='fuse'&&!window.RpgGuardianFusionUI)renderMaterials();
      if(view==='fusion-stage'){const text=root.querySelector('.guardian-controls .guardian-planning');if(text)text.textContent=batchRunning?`正在升階 · 已完成 ${fusionBatch.receipts.length}／${fusionBatch.groups.length} 組；請稍候。`:operation?.action==='fuse'?operation.success?'升階成功，點選神羽迎接新守護。':'升階未成，點選神羽取回主羽毛；本次費用已結算。':fusionReady().ok?'選定素材尚未扣除，拉神羽到底並放開才開始升階。':pending?'原升階結果待確認，請核對同一筆操作。':fusionReady().reason;}
      if(pending?.action&&pending?.payload){const section=root.querySelector('.guardian-operation');if(!root.querySelector('[data-guardian-retry]'))section?.insertAdjacentHTML('beforeend','<button type="button" data-guardian-retry '+(flight?'disabled':'')+'>安全重試</button>');}
    }
    function renderMaterials(){
      const primary=state?.inventory.items.find(item=>item.id===primaryId),stage=config.rules.upgradeStages.find(stage=>stage.from===primary?.quality);
      const available=(state?.inventory.items||[]).filter(item=>!item.active&&!item.locked&&!item.inTrade&&item.quality!==config.qualityOrder.at(-1));
      const slot=root.querySelector('.guardian-material-placeholder');if(slot)slot.outerHTML=`<div class="guardian-live-materials"><h4>選擇主羽毛與素材</h4><p>主羽毛決定類型；失敗退還主羽毛。任一素材綁定，結果與退還羽毛也會綁定。</p>${primary?`<p class="guardian-quality-${primary.quality}">主羽毛：${esc(typeName(config,primary.type))} · ${esc(qualityName(config,primary.quality))}色</p><p>${stageCost(config,stage)} · 已選 ${materials.size}／${stage.materials} 根${stage.mixedTypes?' · 可混合類型':' · 素材須同類型'}</p>`:'<p>先選擇一根主羽毛。</p>'}<div class="guardian-material-grid">${available.map(item=>{const compatible=!primary||item.quality===primary.quality&&(stage.mixedTypes||item.type===primary.type),chosen=materials.has(item.id);return `<article class="guardian-material guardian-quality-${item.quality} ${chosen?'is-selected':''}"><strong>${esc(qualityName(config,item.quality))} · ${esc(typeName(config,item.type))}</strong><small>${item.bound?'已綁定':'未綁定'}</small><button type="button" data-guardian-primary="${esc(item.id)}" ${flight||pending?'disabled':''}>${item.id===primaryId?'主羽毛':'設為主羽毛'}</button><button type="button" data-guardian-material="${esc(item.id)}" ${!compatible||item.id===primaryId||flight||pending?'disabled':''}>${chosen?'移出素材':'選為素材'}</button></article>`;}).join('')||'<p>沒有可升階羽毛（啟用中、鎖定或交易中不能合成）。</p>'}</div></div>`;
      const button=root.querySelector('[data-guardian-action="fuse"]');if(button){button.textContent='確認升階';button.disabled=!capable('fuse')||!stage||materials.size!==stage.materials||stage.goldFee===null||state.balances.gold===null||state.balances.gold<stage.goldFee;}
      const text=root.querySelector('.guardian-fuse>.guardian-muted');if(text)text.textContent='升階費用與素材在確認後結算；成功與失敗皆以伺服器結果為準。';
    }
    async function write(action,payload,confirmation,retry=false,keepScene=false,allowBatch=false){
      syncActor();if(disposed||flight||!charId||!interactive||(!retry&&!capable(action,keepScene,allowBatch)))return null;const captured=charId,revision=epoch,task={promise:null};flight=task;notice='';if(keepScene)enhance();else paint();
      task.promise=(async()=>{try{if(!retry&&confirmation&&!(await host.confirm?.(confirmation.title,confirmation.text,'確認')))return null;if(!current(captured,revision))return null;
        const requestId=retry?pending.requestId:host.requestId?.();if(!/^[A-Za-z0-9_-]{6,64}$/.test(requestId||''))throw Error('操作編號無法建立，請重新開啟遊戲。');
        pending={requestId,action,payload};host.savePending?.(pending);if(keepScene)enhance();else paint();const raw=await host.mutate(action,{...payload,requestId});if(!current(captured,revision))return null;
        const next=C.operation(raw.operation,captured);if(next.requestId!==requestId||next.status!=='committed')throw Error('結算結果尚待確認。');if(raw.state)accept(C.state(raw.state,captured));operation=next;visual=null;if(action==='fuse')ackFusionBatch(next);pending=null;host.clearPending?.();host.saveReceipt?.(next,null);materials.clear();primaryId=null;
        if(action==='fuse'){view='fusion-stage';if(!fusionBatch){fusionFrozen=null;fusionQuote=null;}fusionSelection=null;}
        notice=action==='summon'?`已取得 ${next.results.length} 根守護羽毛，結果已存背包。`:action==='fuse'?next.success?'升階成功，新守護羽毛已入背包。':'升階未成功，已退還主羽毛。':action==='assist'?payload.mode==='stop'?'已取消召喚，剩餘戰數保留。':payload.mode==='start'?`天使已參戰，剩餘 ${fmt(state?.assist.remainingBattles)} 戰。`:payload.mode==='continuation'?'續召設定已更新；不會立即扣除召喚石。':'補給設定已更新。':action==='share'?'分享已送出。':'守護羽毛狀態已更新。';host.onChanged?.(state);if(keepScene)enhance();else paint();return next;
      }catch(error){if(current(captured,revision)){if(error.status>=400&&error.status<500&&!error.uncertain){pending=null;host.clearPending?.();}notice=error.message||'連線中斷，請確認原操作結果。';if(keepScene)enhance();else paint();}return null;
      }finally{if(flight===task)flight=null;if(!disposed){syncActor();if(view==='inventory'&&inventoryQuality!=='all'&&state?.inventory.quality!==inventoryQuality&&!pending)void loadInventoryQuality(inventoryQuality,{force:true});else if(keepScene)enhance();else paint();}}})();return task.promise;
    }
    async function more(){if(flight||pending||!state?.inventory.nextCursor||typeof host.state!=='function')return;if(view==='fuse')return loadFusionQuality(fusionQuality,{append:true});if(view==='inventory')return loadInventoryQuality(inventoryQuality,{append:true});const cursor=state.inventory.nextCursor,captured=charId,revision=epoch,controller=new AbortController(),task={kind:'state',promise:null};controllers.add(controller);flight=task;paint();task.promise=(async()=>{try{const next=C.state(await host.state({cursor,signal:controller.signal}),captured);if(!current(captured,revision)||next.revision<state.revision)return;next.inventory.items=[...new Map([...state.inventory.items,...next.inventory.items].map(item=>[item.id,item])).values()];accept(next);}catch(error){if(current(captured,revision)&&!controller.signal.aborted)notice=error.message;}finally{controllers.delete(controller);if(flight===task)flight=null;if(!disposed){syncActor();paint();}}})();return task.promise;}
    async function loadHistory(){if(flight||typeof host.history!=='function')return;const captured=charId,revision=epoch;try{const values=await host.history();if(!current(captured,revision))return;histories=values.map(value=>C.operation(value,captured)).filter(item=>['summon','fuse'].includes(item.action)&&item.status==='committed');notice=histories.length?'':'尚無召喚紀錄。';paint();}catch(error){if(current(captured,revision)){notice=error.message;paint();}}}
    function refresh() {
      if (disposed) return Promise.resolve(null);
      syncActor();
      if(view==='inventory'&&state&&config.configVersion&&typeof host.state==='function')return loadInventoryQuality(inventoryQuality,{force:true});
      if(view==='fuse'&&state&&config.configVersion&&typeof host.state==='function')return loadFusionQuality(fusionQuality,{force:true});
      if (flight) return flight.promise;
      if (!charId || typeof host.state !== 'function') { paint(); return Promise.resolve(null); }
      const captured = charId, revision = epoch, controller = new AbortController(); controllers.add(controller);
      const quality=view==='fuse'?fusionQuality:null,task = {kind:'state',quality,controller,promise: null};flight = task;notice = '';if(quality){fusionLoading=true;fusionDataRevision=null;}paint();
      task.promise = (async () => {
        try {
          const [rawConfig, rawState] = await Promise.all([typeof host.config === 'function' ? host.config({signal: controller.signal}) : config, host.state({...(quality?{quality}:{}),signal: controller.signal})]);
          if (!current(captured, revision)||controller.signal.aborted||quality&&(view!=='fuse'||fusionQuality!==quality)) return null;
          const nextConfig = C.config(rawConfig), nextState = C.state(rawState, captured);
          config = nextConfig; if (!accept(nextState)) return null;if(quality&&nextState.inventory.quality===quality){fusionDataRevision=state.revision;fusionPages.set(quality,state);}paint(); return state;
        } catch (error) {
          if (current(captured, revision) && !controller.signal.aborted) { notice = error.message || '守護天使資料暫時無法更新。'; paint(); }
          return null;
        } finally {
          controllers.delete(controller); if (flight === task){flight = null;fusionLoading=false;}
          if (!disposed) { syncActor(); paint(); }
        }
      })();
      return task.promise;
    }
    async function recover() {
      syncActor();
      if (disposed || flight || !charId || !pending || typeof host.recover !== 'function') return null;
      const query = C.recoveryQuery(pending), captured = charId, revision = epoch, controller = new AbortController(); controllers.add(controller);
      const task = {promise: null}; flight = task; notice = ''; paint();
      task.promise = (async () => {
        try {
          const raw = await host.recover({...query, signal: controller.signal});
          if (!current(captured, revision)) return null;
          const next = C.operation(raw, captured);
          if ((query.requestId && next.requestId !== query.requestId) || (query.operationId && next.operationId !== query.operationId)) throw Object.assign(new Error('操作紀錄不一致，請重新確認。'), {code: 'guardian_recovery_mismatch'});
          operation = next; if(next.action==='fuse'){view='fusion-stage';fusionFrozen=null;fusionQuote=null;}if (next.status === 'committed') {if(next.action==='fuse')ackFusionBatch(next);pending = null;host.clearPending?.();host.saveReceipt?.(next,visual);if(interactive&&typeof host.state==='function'){const updated=C.state(await host.state({signal:controller.signal}),captured);if(!current(captured,revision))return null;accept(updated);host.onChanged?.(state);}} paint(); return next;
        } catch (error) {
          if (current(captured, revision) && !controller.signal.aborted) { notice = error.message || '操作結果尚未確認。'; paint(); }
          return null;
        } finally { controllers.delete(controller); if (flight === task) flight = null; if (!disposed) { syncActor(); if(view==='inventory'&&inventoryQuality!=='all'&&state?.inventory.quality!==inventoryQuality&&!pending)void loadInventoryQuality(inventoryQuality,{force:true});else paint(); } }
      })();
      return task.promise;
    }
    function autoAction(stop=false,retry=false){
      syncActor();
      if(flight||pending||disposed||!interactive||!charId||sceneInteracting()||!stop&&autoPending&&!retry)return Promise.resolve(null);
      if(stop&&(autoJob?.status!=='running'||typeof host.autoStop!=='function')||!stop&&typeof host.autoStart!=='function')return Promise.resolve(null);
      const captured=charId,revision=epoch,jobId=autoJob?.id;
      if(!stop&&!retry){const budgetInput=root.querySelector('[data-guardian-auto-budget]');if(budgetInput)autoOptions.budget=budgetInput.value;}
      const body=retry&&autoPending?{...autoPending.payload,requestId:autoPending.requestId}:{pool:selected,count:drawCount,targetType:autoOptions.type,targetRank:autoOptions.rank,maxGold:autoOptions.budget===''?null:Number(autoOptions.budget),requestId:host.requestId?.()};
      if(!stop&&body.targetType==='any'&&body.targetRank===0)return Promise.resolve(null);
      const task={promise:null};flight=task;notice='';paint();
      task.promise=(async()=>{
        try{
          if(!stop&&!retry&&!await host.confirm?.('把命運交給大天使',window.RpgGuardianAutoUI.description(body)+'。以目前選擇的召喚池，每批 '+body.count+' 抽，直到符合目標。'+(body.maxGold===null?'未設定金幣上限；不足資源時停止。':'金幣支出上限 '+fmt(body.maxGold)+'；免費普通抽次優先使用。'),'託付祈願'))return null;
          if(!current(captured,revision))return null;
          if(!stop){
            const saved=readAutoPending({characterId:captured,requestId:body.requestId,payload:body});
            if(!saved)throw Object.assign(new Error('祈願設定無效，請確認能力、品質與金幣預算。'),{status:400});
            autoPending=saved;host.saveAutoPending?.(saved);paint();
          }
          const result=stop?await host.autoStop(jobId):await host.autoStart(body);
          if(!current(captured,revision))return null;
          if(!result?.job?.id||!['running','ended'].includes(result.job.status))throw Object.assign(new Error('祈願結果尚待確認，請以原祈願再次查詢。'),{uncertain:true});
          autoJob=result.job;
          if(!stop){autoPending=null;host.clearAutoPending?.();if(autoJob.status==='running')settingsOpen=false;}
          notice=stop?'祈願已收回，大天使停止召喚。':autoJob.status==='ended'?`原祈願已結算，共召喚 ${fmt(autoJob.totalDraws)} 次。`:'祈願已託付大天使，離開畫面仍會繼續。';
          return result.job;
        }catch(error){
          if(current(captured,revision)){
            if(!stop&&error.status>=400&&error.status<500&&!error.uncertain){autoPending=null;host.clearAutoPending?.();}
            notice=error.message||'連線暫時中斷，祈願結果尚待確認。';
          }
          return null;
        }finally{if(flight===task)flight=null;if(!disposed){syncActor();paint();}}
      })();
      return task.promise;
    }
    function click(event) {
      if (disposed) return;
      syncActor();
      const button = event.target.closest?.('button'); if (!button || !root.contains(button) || button.disabled||batchRunning) return;
      if(button.dataset.guardianInventoryQuality){const quality=button.dataset.guardianInventoryQuality;if(view==='inventory'&&(quality==='all'||C.QUALITY_ORDER.includes(quality))&&!pending&&(!flight||flight.kind==='inventory-quality'))void loadInventoryQuality(quality);return;}
      if(button.hasAttribute('data-guardian-settings-open')){settingsOpen=true;paint();return;}
      if(interactive&&button.hasAttribute('data-guardian-auto-start')){void autoAction();return;}
      if(interactive&&button.hasAttribute('data-guardian-auto-retry')){if(autoPending)void autoAction(false,true);return;}
      if(interactive&&button.hasAttribute('data-guardian-auto-stop')){void autoAction(true);return;}
      if(interactive&&button.dataset.guardianCount){const count=Number(button.dataset.guardianCount);if(config.pools[selected].allowedCounts.includes(count)){drawCount=count;paint();}return;}
      if(interactive&&button.dataset.guardianPrimary){const item=state.inventory.items.find(item=>item.id===button.dataset.guardianPrimary);if(item&&!item.active&&!item.locked&&!item.inTrade&&config.rules.upgradeStages.some(stage=>stage.from===item.quality)){primaryId=item.id;materials.clear();materials.add(item.id);paint();}return;}
      if(interactive&&button.dataset.guardianMaterial){const item=state.inventory.items.find(item=>item.id===button.dataset.guardianMaterial),primary=state.inventory.items.find(item=>item.id===primaryId),stage=config.rules.upgradeStages.find(stage=>stage.from===primary?.quality);if(item&&primary&&stage&&item.id!==primaryId&&item.quality===primary.quality&&(stage.mixedTypes||item.type===primary.type)&&!item.active&&!item.locked&&!item.inTrade){if(materials.has(item.id))materials.delete(item.id);else if(materials.size<stage.materials)materials.add(item.id);paint();}return;}
      if(interactive&&button.hasAttribute('data-guardian-more')){void more();return;}
      if(interactive&&button.hasAttribute('data-guardian-history')){void loadHistory();return;}
      if(interactive&&button.dataset.guardianHistoryOp){const next=histories.find(item=>item.operationId===button.dataset.guardianHistoryOp);if(next){operation=next;visual=null;view=next.action==='fuse'?'fusion-stage':'summon';paint();}return;}
      if(interactive&&button.hasAttribute('data-guardian-open-all')){presentation?.revealAll();return;}
      if(interactive&&button.hasAttribute('data-guardian-retry')){if(pending?.action&&pending?.payload)void write(pending.action,pending.payload,null,true);return;}
      if(batchRunning)return;
      if(interactive&&button.hasAttribute('data-guardian-batch-resume')){if(flight||pending||!fusionBatch)return;view='fusion-stage';operation=null;visual=null;fusionFrozen={itemIds:fusionBatch.groups.slice(fusionBatch.receipts.length).flatMap(group=>group.itemIds),primaryId:fusionBatch.groups[fusionBatch.receipts.length].primaryId,configVersion:fusionBatch.configVersion};fusionQuote=fusionReady();notice='再次拉神羽到底並放開，繼續尚未完成的組別。';paint();return;}
      if(interactive&&button.hasAttribute('data-guardian-fusion-return')){if(flight||pending||sceneInteracting())return;view='fuse';fusionFrozen=null;fusionQuote=null;operation=null;visual=null;void loadFusionQuality(fusionQuality);return;}
      if(interactive&&button.dataset.guardianAction){const action=button.dataset.guardianAction;if(action==='summon'){if(flight||pending||sceneInteracting())return;if(operation?.action==='summon'&&!visual?.ready){presentation?.openBatch();updateSummonButton();return;}const q=quote();if(!capable('summon')||!q?.ok){notice=autoJob?.status==='running'?'背景祈願正在進行，請先收回祈願再手動召喚。':autoPending?'請先確認原祈願結果。':'召喚資源不足，請調整抽數或補充資源。';redrawLightweight();return;}if(operation?.action==='summon'&&visual?.ready){operation=null;visual=null;notice='';host.saveReceipt?.(null,null);paint();}notice=initialPull?'長按胸前神羽，向下拉到底再放開。':'拉羽毛介面尚未載入，請更新或重新開啟遊戲。';enhance();return;}
        if(action==='fuse'){const fusion=window.RpgGuardianFusionUI;if(fusion&&fusionSelection){const q=fusion.quote(config,state,fusionSelection);if(q.ok)prepareFusion(fusion.freeze(config,state,fusionSelection),q);}return;}
        const item=ownedItem(button.closest('[data-guardian-id]')?.dataset.guardianId);if(!item)return;
        if(action==='assist'){const a=state.assist;if(a.enabled&&a.itemId===item.id){void write('assist',{mode:'stop',itemId:item.id});return;}if(item.inTrade||item.locked||a.enabled&&a.itemId!==item.id)return;const resume=a.itemId===item.id&&a.remainingBattles>0;if(!resume&&!(a.stoneCount>0)){notice='需要 1 顆天使召喚石，請先補給。';paint();return;}void write('assist',{mode:'start',itemId:item.id,autoRenew:a.itemId?a.autoRenew:assistRenewDraft},resume?null:{title:'召喚天使參戰',text:`消耗 1 顆天使召喚石，取得 ${fmt(a.battlesPerStone)} 戰支援；天使會綁定，同時僅一位參戰。${a.itemId&&a.itemId!==item.id&&a.remainingBattles>0?`目前天使尚餘 ${fmt(a.remainingBattles)} 戰，更換會放棄這些戰數。`:''}`});return;}
        if(action==='trade'){host.openTrade?.(item);return;}
        if(action==='activate')void write('activate',{itemId:item.active?null:item.id},item.active?state.assist.itemId===item.id&&state.assist.remainingBattles>0?{title:'取消永久守護',text:`這會一併清除剩餘 ${fmt(state.assist.remainingBattles)} 戰支援；若只想暫停參戰，請使用卡片上的「取消」。`}:null:{title:'啟用守護天使',text:'啟用後此羽毛會綁定；同時僅一位守護天使生效。'});
        if(action==='lock')void write('lock',{itemId:item.id,locked:!item.locked});
        if(action==='unbind'){const cost=config.rules.unbindScrollCost?.[C.QUALITY_ORDER.indexOf(item.quality)];if(Number.isInteger(cost))void write('unbind',{itemId:item.id},{title:'解除羽毛綁定',text:`消耗赫密士解契卷 ${cost} 張。解除後可交易與分享。`});}
        if(action==='share')void write('share',{itemId:item.id},{title:'分享至群組',text:item.bound||item.active||item.locked?'展示這位守護天使到遊戲群組；受保護羽毛不能發起交易。':'將這根守護羽毛分享到遊戲群組，供其他玩家提出交易請求。'});return;
      }
      if (button.dataset.guardianPool) { selected = button.dataset.guardianPool === 'featured' ? 'featured' : 'normal';if(!config.pools[selected].allowedCounts.includes(drawCount))drawCount=config.pools[selected].allowedCounts[0]||5; paint(); }
      else if (button.dataset.guardianView && tabs.some(([id]) => id === button.dataset.guardianView)) {
        const from=view,entered=from!==button.dataset.guardianView;
        if(button.dataset.guardianView==='summon'&&entered)settingsOpen=false;
        if(entered){cancelInventoryRead();cancelQualityRead();if(flight?.kind==='state'&&flight.quality&&button.dataset.guardianView!=='fuse'){flight.controller?.abort();flight=null;fusionLoading=false;}}
        view = button.dataset.guardianView;
        if(view==='fuse'&&entered){const fusion=window.RpgGuardianFusionUI;if(fusion)fusionSelection=fusion.createSelection(config,state,fusionQuality);void loadFusionQuality(fusionQuality);return;}
        if(view==='inventory'&&entered){void loadInventoryQuality(inventoryQuality,{force:!['fuse','fusion-stage'].includes(from)});return;}
        paint();if(entered&&view==='inventory')void refresh();
      }
      else if (button.dataset.guardianType && config.types.some(entry => entry.id === button.dataset.guardianType)) { guideType = button.dataset.guardianType; paint(); }
      else if (button.dataset.guardianQuality && config.qualities.some(entry => entry.id === button.dataset.guardianQuality)) { guideQuality = button.dataset.guardianQuality; paint(); }
      else if (button.hasAttribute('data-guardian-refresh')) void refresh();
      else if (button.hasAttribute('data-guardian-recover')) void recover();
      else if(button.hasAttribute('data-guardian-exit')){options.onBack?.();}
      else if (button.hasAttribute('data-guardian-back')) { view='overview';paint(); }
      // Phase 1 deliberately has no mutation dispatch, even if a disabled button is altered.
    }
    function change(event){settingsOpen=root.querySelector('.guardian-summon-settings')?.open??settingsOpen;ratesOpen=root.querySelector('.guardian-ritual-rates')?.open??ratesOpen;const node=event.target;if(!interactive||flight||pending||autoPending||sceneInteracting())return;if(node.hasAttribute('data-guardian-assist-continuation')){assistRenewDraft=node.checked;if(state?.assist.itemId)void write('assist',{mode:'continuation',autoRenew:node.checked});else paint();return;}if(node.hasAttribute('data-guardian-assist-supply')){void write('assist',{mode:'supply',autoBuy:node.checked},node.checked?{title:'開啟金幣補給',text:`續召缺少召喚石時，以 ${fmt(state?.assist.stoneGold)} 金幣自動購買 1 顆；金幣不足就停止。`}:null);return;}if(node.hasAttribute('data-guardian-auto-enabled')){autoOptions.enabled=node.checked;paint();return;}if(node.hasAttribute('data-guardian-auto-type')){autoOptions.type=node.value;enhance();return;}if(node.hasAttribute('data-guardian-auto-rank')){autoOptions.rank=Number(node.value);enhance();return;}if(node.hasAttribute('data-guardian-auto-budget')){autoOptions.budget=node.value;enhance();return;}if(node.hasAttribute('data-guardian-reveal-all')){revealAll=node.checked;if(revealAll&&visual?.ready)presentation?.revealAll();else if(operation)paint();return;}if(node.hasAttribute('data-guardian-batch-size')){const n=Number(node.value);if(![5,10].includes(n))return;drawCount=node.checked?n:1;}else if(node.hasAttribute('data-guardian-pool-choice')){if(!['normal','featured'].includes(node.value))return;selected=node.value;}else return;if(operation?.action==='summon'&&visual?.ready){operation=null;visual=null;notice='';host.saveReceipt?.(null,null);}paint();}
    function toggleRates(event){if(event.target.classList?.contains('guardian-ritual-rates'))ratesOpen=event.target.open;if(event.target.classList?.contains('guardian-summon-settings'))settingsOpen=event.target.open;}
    function imageError(event) {
      const image = event.target;
      if (!disposed && root.contains(image) && image.hasAttribute?.('data-guardian-art')) image.outerHTML = artFallback('原畫暫時無法載入');
    }
    function update(value = {}) {
      if (disposed) return false;
      syncActor();
      let lightweight=false,changed=false;
      if(Object.hasOwn(value,'autoJob')){lightweight=true;if(JSON.stringify(autoJob||null)!==JSON.stringify(value.autoJob||null)){autoJob=value.autoJob;changed=true;}}
      if(Object.hasOwn(value,'balances')){
        lightweight=true;
        if(state&&String(value.characterId)===charId&&Number.isSafeInteger(value.revision)&&(state.revision===null||value.revision>=state.revision)){
          const next=C.state({...state,revision:value.revision,balances:{...state.balances,...value.balances}},charId);
          changed||=state.revision!==next.revision||JSON.stringify(state.balances)!==JSON.stringify(next.balances);state={...state,revision:next.revision,balances:next.balances};
        }
      }
      if(lightweight){if(changed)redrawLightweight();if(!value.config&&!value.state)return changed;}
      const nextConfig = value.config ? C.config(value.config) : config;
      const nextState = value.state ? C.state(value.state, charId) : null;
      const nextPending = value.pending ? C.recoveryQuery(value.pending) : pending;
      if (nextState && !accept(nextState)) return false;
      epoch++; controllers.forEach(controller => controller.abort()); controllers.clear(); flight = null;
      config = nextConfig; pending = nextPending;
      paint(); return true;
    }
    function cleanup() {
      if (disposed) return;
      disposed = true; epoch++; controllers.forEach(controller => controller.abort()); controllers.clear(); flight = null;
      initialPull?.cleanup();initialPull=null;presentation?.cleanup();presentation=null;tree?.cleanup();tree=null;fusionController?.cleanup();fusionController=null;cancelQualityRead();cancelInventoryRead();fusionPages.clear();inventoryPages.clear();allInventory=null;
      root.removeEventListener('click', click);root.removeEventListener('change',change);root.removeEventListener('toggle',toggleRates,true); root.removeEventListener('error', imageError, true); root.innerHTML = ''; if (mounts.get(root) === api) mounts.delete(root);
    }
    const api = {refresh, recover, update, cleanup}; mounts.set(root, api);
    root.addEventListener('click', click);root.addEventListener('change',change);root.addEventListener('toggle',toggleRates,true); root.addEventListener('error', imageError, true); paint(); if (options.autoLoad !== false) void refresh(); return api;
  }
  function effectCopy(guardian){const label={melee:'近戰傷害',ranged:'遠程傷害',magic:'魔法傷害',loot:'隨機掉寶率'}[guardian?.type],bonus=guardian?.type==='loot'?guardian.lootBonus:guardian?.damageBonus;return label&&Number.isFinite(bonus)?`${label} +${(bonus*100).toLocaleString('zh-TW',{maximumFractionDigits:2})}%`:'能力待確認';}

  // Lazy-load summary card videos: no src until the card is on screen; skipped for data-saver / reduced-motion.
  (function(){
    if(typeof document==='undefined'||window.__guardianSummaryVideo)return;window.__guardianSummaryVideo=true;
    const skip=()=>!!(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||window.navigator?.connection?.saveData);
    const io=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const e of entries){const v=e.target;if(e.isIntersecting&&!document.hidden){if(!v.getAttribute('src')){if(skip())continue;v.src=v.dataset.guardianVideo;}v.muted=true;v.play?.().catch(()=>{});}else if(v.getAttribute('src'))try{v.pause();}catch{}}},{threshold:.1}):null;
    const prepare=v=>{if(v.__gsv)return;v.__gsv=true;v.muted=true;v.defaultMuted=true;v.addEventListener('playing',()=>v.parentElement?.classList.add('is-summary-video-ready'));v.addEventListener('error',()=>{v.removeAttribute('src');v.parentElement?.classList.remove('is-summary-video-ready');});if(io)io.observe(v);};
    const scan=root=>{if(root.nodeType!==1)return;if(root.matches?.('video[data-guardian-video]'))prepare(root);root.querySelectorAll?.('video[data-guardian-video]').forEach(prepare);};
    new MutationObserver(ms=>{for(const m of ms)m.addedNodes.forEach(scan);}).observe(document.documentElement,{childList:true,subtree:true});
    document.addEventListener('visibilitychange',()=>{document.querySelectorAll('video[data-guardian-video][src]').forEach(v=>{if(document.hidden)try{v.pause();}catch{}else if(v.parentElement?.isConnected)v.play?.().catch(()=>{});});});
    scan(document.documentElement);
  })();
  function summary(guardian,summoned=true){
    if(!summoned)guardian=null;
    const type=guardian&&Object.hasOwn(C.TYPE_NAMES,guardian.type)?guardian.type:'empty',art=`/art/guardian-cards-20261014/${type}.webp`,quality=C.QUALITY_ORDER.includes(guardian?.quality)?guardian.quality:'white';
    return `<section class="guardian-summary has-guardian-art guardian-quality-${quality}" data-guardian-summary-type="${type}"><img class="guardian-summary-background" src="${art}" alt="" aria-hidden="true" decoding="async"><video class="guardian-summary-background guardian-summary-video" data-guardian-video="${art.replace('.webp','.mp4')}" poster="${art}" muted playsinline loop preload="none" aria-hidden="true" tabindex="-1"></video><div class="guardian-summary-copy"><small class="guardian-summary-eyebrow">星光之約 · 同行的守護</small><h3>守護天使</h3>${guardian?`<strong class="guardian-name">${esc(guardian.qualityName)} · ${esc(guardian.typeName)}</strong><p>${esc(effectCopy(guardian))}</p><small>正在與你同行 · 掛機、群組 Boss 與組隊副本適用。</small>`:'<strong class="guardian-summary-empty">尚未有天使守護你</strong><p>將祈願交給世界樹，迎接旅途中的同行者。</p><small>15 級，開啟守護之約。</small>'}<button type="button" data-guardian-entry>召喚守護天使</button></div></section>`;
  }
  function head(guardian){const art=C.safeArtUrl(guardian?.artUrl);return guardian?.visual===true&&C.QUALITY_ORDER.indexOf(guardian.quality)>=3&&art?`<span class="guardian-head-display guardian-quality-${guardian.quality}"><img src="${esc(art)}" alt="${esc(guardian.typeName)}守護"><small class="guardian-name">${esc(guardian.typeName)}</small></span>`:'';}
  const effectImages=new Map();
  function draw(ctx,guardian,x,y,size=52){const art=C.safeArtUrl(guardian?.artUrl);if(!guardian?.visual||!art||C.QUALITY_ORDER.indexOf(guardian.quality)<3)return;let image=effectImages.get(art);if(!image){image=new Image();image.src=art;effectImages.set(art,image);}if(!image.complete||!image.naturalWidth)return;ctx.save();ctx.globalAlpha=.94;ctx.drawImage(image,x-size/2,y-size,size,size);ctx.restore();}
  window.RpgGuardianSigil = Object.freeze({render, mount,summary,head,draw,effectCopy});
})();
