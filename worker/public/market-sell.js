(function () {
  'use strict';
  const LIMIT = 50, selected = new Set();
  let actor = null, filter = 'all', search = '', pending = false, currentRoot = null, currentCtx = null;
  const groups = [['all', '全部'], ['weapon', '武器'], ['armor', '防具'], ['accessory', '飾品'], ['guardian', '天使']];
  const protectedValue = e => e.grade === 'relic' || e.enhance > 0 || ['legendary', 'supreme'].includes(e.rarity);
  function eligible(state) {
    const locked = state.autoEnhance?.status === 'running' ? state.autoEnhance.itemId : null;
    return (state.me?.equipment || []).filter(e => !e.equipped && !e.inTrade && !e.sellBlock && e.id !== locked);
  }
  function sync(state) {
    if (actor !== state.me?.character.tgId) { actor = state.me?.character.tgId; selected.clear(); filter = 'all'; search = ''; }
    const ids = new Set(eligible(state).map(e => e.id));
    for (const id of selected) if (!ids.has(id)) selected.delete(id);
  }
  const groupOf = e => e.slot === 'weapon' ? 'weapon' : ['ring', 'earring'].includes(e.slot) ? 'accessory' : 'armor';
  const visible = state => eligible(state).filter(e => (filter === 'all' || groupOf(e) === filter) && (!search || e.name.toLowerCase().includes(search.toLowerCase()))).slice().reverse();
  function cards(state, helpers) {
    const { esc, fmt, gearIcon } = helpers, list = visible(state);
    if (!list.length) return '<div class="sell-empty"><span>✦</span><strong>' + (eligible(state).length ? '沒有符合的裝備' : '行囊已整理妥當') + '</strong><p>' + (eligible(state).length ? '換個分類或關鍵字找找。' : '可販售的裝備會出現在這裡。<br>穿戴、交易與背景強化中的裝備會保留。') + '</p></div>';
    return list.map(e => `<article class="sell-card ${selected.has(e.id) ? 'is-selected' : ''}" data-rarity="${esc(e.rarity)}" data-grade="${esc(e.grade)}">
      <button type="button" class="sell-select" data-sell-toggle="${esc(e.id)}" aria-pressed="${selected.has(e.id)}" aria-label="勾選 ${esc(e.name)}${e.enhance ? ' 強化加'+e.enhance : ''}，售價 ${fmt(e.sellPrice)} 金幣">
        <span class="sell-check" aria-hidden="true">${selected.has(e.id) ? '✓' : ''}</span>
        ${protectedValue(e) ? `<span class="sell-value-tag">${e.grade === 'relic' ? '遺物' : e.enhance ? '+'+e.enhance : e.rarityName}</span>` : ''}
        <span class="sell-art">${gearIcon(e, '✦')}</span><span class="sell-name">${esc(e.name)}</span><span class="sell-meta">T${e.tier} · ${esc(e.slotName)}</span><span class="sell-price">${fmt(e.sellPrice)} <small>金幣</small></span>
      </button><button type="button" class="sell-detail" data-sell-detail="${esc(e.id)}" aria-label="查看 ${esc(e.name)} 詳情">詳情</button>
    </article>`).join('');
  }
  function render(state, helpers) {
    sync(state);
    return `<section class="market-sell" aria-label="批量販售裝備">
      <div class="sell-heading"><div><h3>整理行囊</h3><p>點選裝備，再一次交給商人。</p></div><span class="sell-inventory-count">${eligible(state).length} 件可售</span></div>
      <label class="sell-search"><span aria-hidden="true">⌕</span><input type="search" data-sell-search value="${helpers.esc(search)}" placeholder="搜尋裝備名稱" aria-label="搜尋可販售裝備"></label>
      <div class="sell-toolbar"><div class="sell-filters">${groups.map(([key, label]) => `<button type="button" data-sell-filter="${key}" aria-pressed="${filter===key}" class="${filter===key?'on':''}">${label}</button>`).join('')}</div><div class="sell-quick"><button type="button" data-sell-common>選白綠裝</button><button type="button" data-sell-clear>清除</button></div></div>
      <p class="sell-hint">快捷勾選保留強化、遺物與藍裝以上 · 每次最多 ${LIMIT} 件</p>
      <div class="sell-grid">${cards(state, helpers)}</div>
      <div class="sell-dock"><div class="sell-summary" aria-live="polite"><span data-sell-count>已選 0 件</span><strong data-sell-total>0 <small>金幣</small></strong></div><button type="button" class="btn gold" data-sell-submit disabled>販售</button></div>
    </section>`;
  }
  function update(redraw = false) {
    if (!currentRoot?.isConnected || !currentCtx) return;
    const state = currentCtx.getState(); sync(state);
    if (redraw) currentRoot.querySelector('.sell-grid').innerHTML = cards(state, currentCtx);
    currentRoot.querySelectorAll('[data-sell-toggle]').forEach(button => { const checked = selected.has(button.dataset.sellToggle); button.setAttribute('aria-pressed', String(checked)); button.closest('.sell-card').classList.toggle('is-selected', checked); button.querySelector('.sell-check').textContent = checked ? '✓' : ''; button.disabled = pending; });
    currentRoot.querySelectorAll('[data-sell-filter]').forEach(button => { const on = filter === button.dataset.sellFilter; button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); });
    const items = eligible(state).filter(e => selected.has(e.id));
    currentRoot.querySelector('[data-sell-count]').textContent = `已選 ${items.length} 件`;
    currentRoot.querySelector('[data-sell-total]').innerHTML = `${currentCtx.fmt(items.reduce((sum,e)=>sum+e.sellPrice,0))} <small>金幣</small>`;
    const submit = currentRoot.querySelector('[data-sell-submit]'); submit.disabled = !items.length || pending; submit.textContent = pending ? '處理中' : '販售';
    currentRoot.querySelectorAll('[data-sell-common],[data-sell-clear]').forEach(button=>button.disabled=pending);
  }
  async function submit(ctx) {
    if (pending) return; sync(ctx.getState());
    const seller = actor, items = eligible(ctx.getState()).filter(e => selected.has(e.id));
    if (!items.length) return; pending = true; update();
    try {
      const valuable = items.filter(protectedValue).length, gold = items.reduce((sum,e)=>sum+e.sellPrice,0);
      const html = `<p>將 ${items.length} 件裝備交給商人，獲得 <strong class="sell-review-total">${ctx.fmt(gold)} 金幣</strong>。</p>${valuable ? `<p class="sell-review-warning">含 ${valuable} 件強化或珍稀裝備，請再確認一次。</p>` : ''}<div class="sell-review-list">${items.map(e=>`<div><span>${ctx.esc(e.name)}${e.enhance?' +'+e.enhance:''}<small>${ctx.esc(e.gradeName||e.rarityName)} · T${e.tier}</small></span><b>${ctx.fmt(e.sellPrice)}</b></div>`).join('')}</div><p class="sell-review-note">售價為商店原價的三分之一，出售後無法取回。</p>`;
      if (!await ctx.confirmSheet('販售裝備', html, '確認販售')) return;
      const latest = ctx.getState();
      if (latest.me?.character.tgId !== seller) { ctx.toast('角色已切換，請重新勾選', true); return; }
      const available = new Set(eligible(latest).map(e => e.id));
      if (items.some(e => !available.has(e.id))) { ctx.toast('裝備狀態已更新，請重新確認', true); return; }
      const result = await ctx.sell(items.map(e=>e.id).sort());
      if (result) selected.clear();
    } finally { pending = false; update(true); }
  }
  function bind(root, ctx) {
    currentRoot = root.querySelector('.market-sell'); currentCtx = ctx;
    if (!currentRoot) return; update(); placeDock();
    currentRoot.onclick = event => {
      const toggle = event.target.closest('[data-sell-toggle]');
      if (toggle && !pending) { const id=toggle.dataset.sellToggle; if (selected.has(id)) selected.delete(id); else if (selected.size < LIMIT) selected.add(id); else ctx.toast(`每次最多販售 ${LIMIT} 件`,true); update(); return; }
      const detail = event.target.closest('[data-sell-detail]'); if (detail) { ctx.detail(detail.dataset.sellDetail); return; }
      const category = event.target.closest('[data-sell-filter]'); if (category) { if(category.dataset.sellFilter==='guardian'){ctx.openGuardians?.();return;}filter = category.dataset.sellFilter; update(true); return; }
      if (event.target.closest('[data-sell-clear]') && !pending) { selected.clear(); update(); return; }
      if (event.target.closest('[data-sell-common]') && !pending) { for (const e of visible(ctx.getState())) if (!protectedValue(e) && ['common','advanced'].includes(e.rarity) && selected.size<LIMIT) selected.add(e.id); update(); return; }
      if (event.target.closest('[data-sell-submit]')) void submit(ctx).catch(error=>ctx.toast(error.message,true));
    };
    currentRoot.querySelector('[data-sell-search]').oninput = event => { search=event.target.value.trim(); update(true); };
  }
  function placeDock() {
    if (!currentRoot?.isConnected) return;
    const nav = document.getElementById('nav');
    if (nav) currentRoot.querySelector('.sell-dock').style.bottom = Math.max(7, window.innerHeight - nav.getBoundingClientRect().top + 7) + 'px';
  }
  window.addEventListener('resize', placeDock);
  function reset() { selected.clear(); actor=null; filter='all'; search=''; currentRoot=null; currentCtx=null; }
  window.RpgMarketSell = { render, bind, reset };
})();
