/* Read the selected character's committed ledger inside the shared scene window. */
(() => {
  'use strict';
  const CATEGORIES = [['all','全部紀錄'],['gold','金幣'],['items','道具'],['experience','經驗']];
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const cursorValid = value => value === null || typeof value === 'string' && value.length > 0;
  const scopeKey = value => JSON.stringify(['accountId','realmId','characterId','epoch'].map(field => value?.[field]));
  const contextFields = ['accountId','realmId','characterId'];
  const categoryValid = value => CATEGORIES.some(([key]) => key === value);
  const changed = () => Error('角色或世界已切換，請重新開啟帳務紀錄。');
  function createClient(host) {
    const context = {...host.getContext?.()}, scope = scopeKey(context);
    if (!contextFields.every(field => typeof context[field] === 'string' && context[field]) || !integer(context.epoch)) throw changed();
    const state = {data:null,category:'all',loading:false,error:'',page:1,canPrevious:false,nextCursor:null,revision:-1,serverNow:-1,stale:false};
    let disposed = false, generation = 0, controller = null, cursor = null, history = [], retryQuery = null, revisionFloor = -1;
    const current = () => !disposed && host.current?.() !== false && scopeKey(host.getContext?.()) === scope;
    const notify = () => { if (current()) host.onState?.(state); };
    function verify(value, query) {
      if (!plain(value) || contextFields.some(field => value[field] !== context[field]) || value.contextEpoch !== context.epoch) throw changed();
      if (value.ok !== true || value.schemaVersion !== 1 || !integer(value.revision) || value.revision < Math.max(state.revision,revisionFloor) || !integer(value.serverNow) || value.serverNow < state.serverNow) throw Error('收到較早的帳務狀態，請重新整理。');
      if (value.category !== query.category || value.pageSize !== 30 || !Array.isArray(value.entries) || value.entries.length > 30 || !cursorValid(value.nextCursor)) throw Error('帳務紀錄格式尚未完整，請重新整理。');
      if (value.nextCursor !== null && (value.nextCursor === query.cursor || query.history.includes(value.nextCursor))) throw Error('帳務分頁已失效，請重新整理。');
      const ids = new Set(), entries = value.entries.map(row => {
        if (!plain(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id) || !integer(row.createdAt) || typeof row.type !== 'string' ||
          !['goldDelta','itemDelta','expDelta'].every(field => Number.isSafeInteger(row[field])) ||
          !(row.item === null || typeof row.item === 'string') || !(row.itemName === null || typeof row.itemName === 'string') || typeof row.summary !== 'string') throw Error('帳務紀錄內容尚未完整，請重新整理。');
        ids.add(row.id);
        // Only the public projection is retained. Receipt notes are never parsed or displayed here.
        return {id:row.id,createdAt:row.createdAt,type:row.type,goldDelta:row.goldDelta,item:row.item,itemName:row.itemName,itemDelta:row.itemDelta,expDelta:row.expDelta,summary:row.summary};
      });
      return {ok:true,schemaVersion:1,accountId:value.accountId,realmId:value.realmId,characterId:value.characterId,contextEpoch:value.contextEpoch,
        revision:value.revision,serverNow:value.serverNow,pageSize:30,category:value.category,entries,nextCursor:value.nextCursor};
    }
    async function load(query) {
      if (!current()) return false;
      const ticket = ++generation; controller?.abort(); controller = new AbortController();
      retryQuery = {category:query.category,cursor:query.cursor,history:[...query.history]};
      state.loading = true; state.error = ''; notify();
      try {
        const value = await host.request('ledger/history',{category:query.category,cursor:query.cursor,contextEpoch:context.epoch},{signal:controller.signal});
        if (!current() || ticket !== generation) return false;
        const accepted = verify(value,query);
        cursor = query.cursor; history = [...query.history]; retryQuery = null;
        state.data = accepted; state.category = query.category; state.page = history.length + 1; state.canPrevious = history.length > 0;
        state.nextCursor = accepted.nextCursor; state.revision = accepted.revision; state.serverNow = accepted.serverNow; state.stale = false;
        return true;
      } catch (error) {
        if (current() && ticket === generation) state.error = error?.message || '帳務紀錄暫時無法讀取，請重試。';
        return false;
      } finally {
        if (current() && ticket === generation) { state.loading = false; controller = null; notify(); }
      }
    }
    async function refresh() {
      return load({category:state.category,cursor:null,history:[]});
    }
    async function setCategory(category) {
      if (!current() || !categoryValid(category) || category === state.category) return false;
      state.category = category; state.data = null; state.page = 1; state.canPrevious = false; state.nextCursor = null;
      cursor = null; history = [];
      return load({category,cursor:null,history:[]});
    }
    async function next() {
      if (!current() || state.loading || !state.data || state.nextCursor === null) return false;
      return load({category:state.category,cursor:state.nextCursor,history:[...history,cursor]});
    }
    async function previous() {
      if (!current() || state.loading || !history.length) return false;
      return load({category:state.category,cursor:history.at(-1),history:history.slice(0,-1)});
    }
    async function retry() {
      if (!current() || state.loading || !retryQuery) return false;
      return load({...retryQuery,history:[...retryQuery.history]});
    }
    function update(snapshot) {
      if (!current() || !plain(snapshot) || contextFields.some(field => snapshot[field] !== context[field]) || !integer(snapshot.live?.revision)) return false;
      revisionFloor = Math.max(revisionFloor,snapshot.live.revision);
      const stale = !!state.data && revisionFloor > state.revision;
      if (stale !== state.stale) { state.stale = stale; notify(); }
      return true;
    }
    function dispose() {
      if (disposed) return;
      disposed = true; generation++; controller?.abort(); controller = null; retryQuery = null; history = []; cursor = null;
      state.data = null; state.loading = false; state.canPrevious = false; state.nextCursor = null; state.error = '';
    }
    return {state,current,refresh,setCategory,next,previous,retry,update,dispose};
  }
  const signed = value => (value > 0 ? '+' : '') + value.toLocaleString('zh-TW');
  const when = value => new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  function mount(root,host) {
    const doc = root.ownerDocument || document;
    if (!doc.querySelector('link[data-scene-ledger-style]')) {
      const sheet = doc.createElement('link'), script = doc.querySelector('script[src*="scene-ledger-ui.js"]');
      sheet.rel = 'stylesheet'; sheet.dataset.sceneLedgerStyle = 'true'; sheet.href = new URL('scene-ledger-ui.css?v=ledger-20261106',script?.src || doc.baseURI).href; doc.head.append(sheet);
    }
    root.innerHTML = '<section class="scene-ledger" aria-label="已入帳紀錄"><p class="ledger-intro">查看已保存的金幣、道具與經驗變動。每筆內容以當時的入帳紀錄為準。</p>' +
      '<div class="ledger-toolbar"><label>紀錄分類<select data-ledger-category name="ledgerCategory"><option value="all">全部紀錄</option><option value="gold">金幣</option><option value="items">道具</option><option value="experience">經驗</option></select></label><button type="button" data-ledger-refresh>重新整理</button></div>' +
      '<div class="ledger-page-heading"><h3 data-ledger-page tabindex="-1">第 1 頁</h3><p data-ledger-updated></p></div><p class="ledger-status" data-ledger-status role="status" aria-live="polite"></p>' +
      '<div class="ledger-error" data-ledger-error-box hidden><p data-ledger-error role="alert"></p><button type="button" data-ledger-retry>重試讀取</button></div>' +
      '<ol class="ledger-list" data-ledger-list aria-label="帳務紀錄"></ol><p class="ledger-empty" data-ledger-empty hidden></p>' +
      '<nav class="ledger-pages" aria-label="帳務紀錄分頁"><button type="button" data-ledger-previous disabled>上一頁</button><button type="button" data-ledger-next disabled>載入更早紀錄</button></nav></section>';
    const find = name => root.querySelector('[data-ledger-' + name + ']');
    const section = root.querySelector('.scene-ledger'), category = find('category'), page = find('page'), updated = find('updated'),
      status = find('status'), errorBox = find('error-box'), error = find('error'), list = find('list'), empty = find('empty'),
      previous = find('previous'), next = find('next');
    let disposed = false, client, paintedData = null, pageFocus = null;
    function rowNode(row) {
      const node = doc.createElement('li'); node.className = 'ledger-entry'; node.dataset.ledgerEntry = row.id;
      const head = doc.createElement('header'), title = doc.createElement('h4'), time = doc.createElement('time');
      title.textContent = row.type || '入帳紀錄'; time.textContent = when(row.createdAt);
      const date = new Date(row.createdAt); if (!Number.isNaN(date.getTime())) time.dateTime = date.toISOString();
      head.append(title,time); node.append(head);
      const deltas = doc.createElement('div'); deltas.className = 'ledger-deltas';
      for (const [label,value] of [['金幣',row.goldDelta],[row.itemName || row.item || '道具',row.itemDelta],['經驗',row.expDelta]]) {
        if (!value) continue;
        const delta = doc.createElement('span'); delta.className = 'ledger-delta ' + (value > 0 ? 'ledger-positive' : 'ledger-negative'); delta.textContent = label + ' ' + signed(value); deltas.append(delta);
      }
      if (!deltas.childNodes.length) { const neutral = doc.createElement('span'); neutral.className = 'ledger-neutral'; neutral.textContent = '操作紀錄'; deltas.append(neutral); }
      node.append(deltas);
      if (row.summary) { const summary = doc.createElement('p'); summary.className = 'ledger-summary'; summary.textContent = row.summary; node.append(summary); }
      return node;
    }
    function paint() {
      if (disposed || !client?.current()) return;
      const state = client.state, data = state.data;
      section.setAttribute('aria-busy',String(state.loading)); category.value = state.category; page.textContent = '第 ' + state.page + ' 頁';
      updated.textContent = data ? '讀取時間 ' + when(data.serverNow) + ' · 台北時間' : '';
      status.textContent = state.loading ? '正在讀取帳務紀錄…' : state.error ? '讀取未完成，可重試或重新整理。' :
        data ? '第 ' + state.page + ' 頁，共 ' + data.entries.length + ' 筆。' + (state.stale ? '角色狀態已更新，可重新整理紀錄。' : '') : '';
      errorBox.hidden = !state.error; error.textContent = state.error;
      previous.disabled = !state.canPrevious; previous.setAttribute('aria-disabled',String(state.loading || !state.canPrevious));
      next.disabled = !data || state.nextCursor === null; next.setAttribute('aria-disabled',String(state.loading || !data || state.nextCursor === null));
      find('retry').disabled = state.loading;
      if (paintedData !== data) { list.replaceChildren(...(data?.entries || []).map(rowNode)); paintedData = data; }
      empty.hidden = state.loading || !!state.error || !data || data.entries.length > 0;
      empty.textContent = state.page > 1 ? '這個分類沒有更早的紀錄。' : '這個分類還沒有已入帳紀錄。';
      if (pageFocus && !state.loading) {
        if (!state.error && data !== pageFocus.before && (doc.activeElement === pageFocus.control || doc.activeElement === doc.body)) { root.scrollTop = 0; page.focus({preventScroll:true}); }
        pageFocus = null;
      }
    }
    client = createClient({...host,onState:() => paint()});
    function click(event) {
      if (disposed || !client.current()) return;
      const node = event.target.closest?.('button');
      if (!node || !root.contains(node) || node.disabled || node.getAttribute('aria-disabled') === 'true') return;
      if (node.hasAttribute('data-ledger-refresh')) { pageFocus = null; void client.refresh(); }
      else if (node.hasAttribute('data-ledger-retry')) { pageFocus = null; if (doc.activeElement === node) page.focus({preventScroll:true}); void client.retry(); }
      else if (node.hasAttribute('data-ledger-next') || node.hasAttribute('data-ledger-previous')) {
        pageFocus = {control:node,before:client.state.data};
        void (node.hasAttribute('data-ledger-next') ? client.next() : client.previous());
      }
    }
    function change(event) {
      if (disposed || !client.current() || event.target !== category) return;
      pageFocus = null; void client.setCategory(category.value);
    }
    root.addEventListener('click',click); root.addEventListener('change',change);
    paint(); void client.refresh();
    return {client,update:snapshot => client.update(snapshot),dispose() {
      if (disposed) return; disposed = true; pageFocus = null; paintedData = null;
      client.dispose(); root.removeEventListener('click',click); root.removeEventListener('change',change);
    }};
  }
  globalThis.RpgSceneLedger = {createClient,mount};
})();
