/* Selected-character exchange browsing in the existing scene window. */
(() => {
  'use strict';
  const TABS = [['browse','瀏覽寶物'],['mine','我的刊登'],['history','成交紀錄']];
  const CATEGORIES = [['all','全部物品'],['equipment','裝備'],['guardian','守護天使'],['scroll','卷軸'],['collection','收集物'],['skillbook','技能書'],['other','通用道具']];
  const CLASSES = [['all','全部職業'],['sword','劍士'],['archer','妖精'],['mage','法師'],['thief','盜賊'],['any','全職業通用']];
  const GEAR_QUALITIES = [['common','一般'],['advanced','高級'],['epic','極品'],['legendary','傳說'],['supreme','霸主']];
  const BOOK_QUALITIES = ['普通','高級','稀有','神話'].map(value => [value,value]);
  const GUARDIAN_QUALITIES = [['white','白色'],['green','綠色'],['blue','藍色'],['purple','紫色'],['red','紅色'],['gold','金色'],['pink','粉色'],['cyan','青色']];
  const ROLES = [['all','全部成交'],['buy','買入'],['sell','賣出']];
  const FILTER_KEYS = ['category','classReq','tier','quality','enhanceMin','enhanceMax'];
  const CONTEXT_FIELDS = ['accountId','realmId','characterId'];
  const STAT_NAMES = {atk:'攻擊力',def:'防禦力',hp:'生命值',mp:'魔力',atkPct:'攻擊',defPct:'防禦',hpPct:'生命',mpPct:'魔力',critPct:'暴擊',critDamagePct:'暴擊傷害',damagePct:'傷害',damageReducePct:'減傷',attackSpeedPct:'攻速',healPct:'治療'};
  const SOURCE_NAMES = {starter:'新手裝備',shop:'商店',npc:'商店',gacha:'轉蛋',normal:'一般掉落',idle:'掛機掉落',elite:'菁英掉落',boss:'首領掉落',star_ring:'星環遠征',atlas:'星圖探索',tower:'星穹塔'};
  const STATUS_NAMES = {active:'販售中',sold:'已售出',cancelled:'已取回',expired:'已結束'};
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const positive = value => integer(value) && value > 0;
  const keyOf = context => JSON.stringify([...CONTEXT_FIELDS,'epoch'].map(key => context?.[key]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const cursorValid = value => value === null || typeof value === 'string' && value.length > 0;
  const defaults = () => ({category:'all',classReq:'all',tier:null,quality:'all',enhanceMin:null,enhanceMax:null});
  const sameFilters = (a,b) => plain(a) && plain(b) && Object.keys(a).length === FILTER_KEYS.length && FILTER_KEYS.every(key => a[key] === b[key]);
  function qualityOptions(category) {
    const rows = category === 'equipment' ? GEAR_QUALITIES : category === 'guardian' ? GUARDIAN_QUALITIES : category === 'skillbook' ? BOOK_QUALITIES :
      category === 'all' ? [...GEAR_QUALITIES.map(([key,name]) => [key,'裝備 · ' + name]),...BOOK_QUALITIES.map(([key,name]) => [key,'技能 · ' + name]),...GUARDIAN_QUALITIES.map(([key,name]) => [key,'天使 · ' + name])] : [];
    return [['all','全部品質'],...rows];
  }
  function normalizeFilters(value = {}) {
    if (!plain(value) || Object.keys(value).some(key => !FILTER_KEYS.includes(key))) throw Error('篩選條件尚未完整，請重新選擇。');
    const filters = {...defaults(),...value};
    if (!CATEGORIES.some(([key]) => key === filters.category) || !CLASSES.some(([key]) => key === filters.classReq) ||
      !qualityOptions(filters.category).some(([key]) => key === filters.quality)) throw Error('請選擇有效的物品分類、職業與品質。');
    for (const key of ['tier','enhanceMin','enhanceMax']) {
      const value = filters[key], minimum = key === 'tier' ? 1 : 0, maximum = key === 'tier' ? 12 : 15;
      if (value !== null && (!integer(value) || value < minimum || value > maximum)) throw Error('裝備階級或強化範圍不正確。');
    }
    if (filters.enhanceMin !== null && filters.enhanceMax !== null && filters.enhanceMin > filters.enhanceMax) throw Error('強化下限不能高於上限。');
    if (!['all','equipment'].includes(filters.category)) { filters.tier = null; filters.enhanceMin = null; filters.enhanceMax = null; }
    return filters;
  }
  function itemProjection(item) {
    if (!plain(item) || !['equip','item','guardian'].includes(item.kind) || typeof item.name !== 'string' ||
      !(item.equipment == null || plain(item.equipment)) || !(item.guardian == null || plain(item.guardian))) throw Error('物品快照尚未完整，請重新整理。');
    const keys = ['kind','equipId','item','guardianId','name','emoji','desc','art','equipment','guardian','category','classReq','tier','quality','qualityName','enhance','qty',
      'itemTier','mapId','advancementTier','requiredLevel','eligibleJob','usableClasses','snapshotAvailable'];
    const result = {};
    for (const key of keys) if (item[key] !== undefined) result[key] = clone(item[key]);
    return result;
  }
  function rowProjection(row,tab) {
    if (!plain(row) || typeof row.id !== 'string' || !row.id || !positive(row.qty) || !positive(row.price)) throw Error('交易紀錄尚未完整，請重新整理。');
    if (tab === 'history') {
      if (!['buy','sell'].includes(row.role) || !integer(row.settledAt) || !Number.isSafeInteger(row.goldDelta) ||
        !(row.role === 'sell' ? integer(row.fee) && integer(row.netGold) : integer(row.paidGold))) throw Error('成交明細尚未完整，請重新整理。');
      const result = {id:row.id,listingId:row.listingId,role:row.role,settledAt:row.settledAt,qty:row.qty,price:row.price,goldDelta:row.goldDelta,item:itemProjection(row.item)};
      for (const key of ['fee','netGold','paidGold','feePaidBy','counterparty','snapshotSource']) if (row[key] !== undefined) result[key] = clone(row[key]);
      return result;
    }
    if (typeof row.status !== 'string' || !integer(row.createdAt) || !integer(row.updatedAt) || !plain(row.seller) || !integer(row.fee) || !integer(row.netGold)) throw Error('刊登明細尚未完整，請重新整理。');
    return {...itemProjection(row),id:row.id,price:row.price,qty:row.qty,fee:row.fee,netGold:row.netGold,status:row.status,seller:clone(row.seller),
      createdAt:row.createdAt,updatedAt:row.updatedAt,ownedByMe:row.ownedByMe === true,canBuy:row.canBuy === true};
  }
  function createClient(host) {
    const context = {...host.getContext?.()}, scope = keyOf(context);
    const changed = () => Error('角色或世界已切換，請重新開啟旅人交易所。');
    if (!CONTEXT_FIELDS.every(key => typeof context[key] === 'string' && context[key]) || !integer(context.epoch)) throw changed();
    const state = {tab:'browse',filters:defaults(),role:'all',data:null,loading:false,error:'',canRetry:false,page:1,canPrevious:false,nextCursor:null,revision:-1,serverNow:-1,stale:false};
    let disposed = false, generation = 0, controller = null, cursor = null, history = [], retryQuery = null, revisionFloor = -1;
    const current = () => !disposed && host.current?.() !== false && keyOf(host.getContext?.()) === scope;
    const notify = () => { if (current()) host.onState?.(state); };
    const selection = () => ({tab:state.tab,filters:state.tab === 'browse' ? {...state.filters} : null,role:state.tab === 'history' ? state.role : null});
    function verify(value,query) {
      if (!plain(value) || CONTEXT_FIELDS.some(key => value[key] !== context[key]) || value.contextEpoch !== context.epoch) throw changed();
      if (value.ok !== true || value.schemaVersion !== 1 || !integer(value.revision) || value.revision < Math.max(state.revision,revisionFloor) ||
        !integer(value.serverNow) || value.serverNow < state.serverNow) throw Error('收到較早的交易所狀態，請重新整理。');
      if (value.tab !== query.tab || value.role !== query.role || (query.filters === null ? value.filters !== null : !sameFilters(value.filters,query.filters)) ||
        value.pageSize !== 30 || !Array.isArray(value.items) || value.items.length > 30 || !cursorValid(value.nextCursor) ||
        (query.tab === 'history' ? value.meta !== null : !plain(value.meta) || value.meta.pageSize !== 30)) throw Error('交易所分頁格式尚未完整，請重新整理。');
      if (value.nextCursor !== null && (value.nextCursor === query.cursor || query.history.includes(value.nextCursor))) throw Error('交易所分頁已失效，請重新整理。');
      const ids = new Set(), items = value.items.map(row => {
        const item = rowProjection(row,query.tab);
        if (ids.has(item.id)) throw Error('交易所分頁出現重複紀錄，請重新整理。');
        ids.add(item.id);
        if (query.tab === 'history' && query.role !== 'all' && item.role !== query.role) throw Error('成交類型與所選條件不同，請重新整理。');
        return item;
      });
      return {ok:true,schemaVersion:1,accountId:value.accountId,realmId:value.realmId,characterId:value.characterId,contextEpoch:value.contextEpoch,
        revision:value.revision,serverNow:value.serverNow,pageSize:30,tab:query.tab,filters:query.filters && {...query.filters},role:query.role,
        items,meta:value.meta === null ? null : clone(value.meta),nextCursor:value.nextCursor};
    }
    async function load(query) {
      if (!current()) return false;
      const ticket = ++generation; controller?.abort(); controller = new AbortController();
      retryQuery = {...query,filters:query.filters && {...query.filters},history:[...query.history]};
      state.loading = true; state.error = ''; state.canRetry = false; notify();
      try {
        const body = {tab:query.tab,cursor:query.cursor,contextEpoch:context.epoch};
        if (query.filters) body.filters = {...query.filters};
        if (query.role) body.role = query.role;
        const value = await host.request('exchange/scene',body,{signal:controller.signal});
        if (!current() || ticket !== generation) return false;
        const accepted = verify(value,query);
        cursor = query.cursor; history = [...query.history]; retryQuery = null;
        state.data = accepted; state.page = history.length + 1; state.canPrevious = history.length > 0; state.nextCursor = accepted.nextCursor;
        state.revision = accepted.revision; state.serverNow = accepted.serverNow; state.stale = false;
        return true;
      } catch (error) {
        if (current() && ticket === generation) { state.error = error?.message || '交易所暫時無法讀取，請重試。'; state.canRetry = true; }
        return false;
      } finally {
        if (current() && ticket === generation) { state.loading = false; controller = null; notify(); }
      }
    }
    function reset() {
      state.data = null; state.page = 1; state.canPrevious = false; state.nextCursor = null; cursor = null; history = [];
      return load({...selection(),cursor:null,history:[]});
    }
    const refresh = () => load({...selection(),cursor:null,history:[]});
    function setTab(tab) {
      if (!current() || !TABS.some(([key]) => key === tab) || tab === state.tab) return Promise.resolve(false);
      state.tab = tab; return reset();
    }
    function setFilters(value) {
      if (!current() || state.tab !== 'browse') return Promise.resolve(false);
      try {
        const filters = normalizeFilters(value);
        if (sameFilters(filters,state.filters)) return Promise.resolve(false);
        state.filters = filters; return reset();
      } catch (error) { state.error = error.message; state.canRetry = false; notify(); return Promise.resolve(false); }
    }
    function setRole(role) {
      if (!current() || state.tab !== 'history' || !ROLES.some(([key]) => key === role) || role === state.role) return Promise.resolve(false);
      state.role = role; return reset();
    }
    function next() {
      if (!current() || state.loading || !state.data || state.nextCursor === null) return Promise.resolve(false);
      return load({...selection(),cursor:state.nextCursor,history:[...history,cursor]});
    }
    function previous() {
      if (!current() || state.loading || !history.length) return Promise.resolve(false);
      return load({...selection(),cursor:history.at(-1),history:history.slice(0,-1)});
    }
    function retry() {
      if (!current() || state.loading || !retryQuery) return Promise.resolve(false);
      return load({...retryQuery,filters:retryQuery.filters && {...retryQuery.filters},history:[...retryQuery.history]});
    }
    function update(snapshot) {
      if (!current() || !plain(snapshot) || CONTEXT_FIELDS.some(key => snapshot[key] !== context[key]) || !integer(snapshot.live?.revision)) return false;
      revisionFloor = Math.max(revisionFloor,snapshot.live.revision);
      const stale = !!state.data && revisionFloor > state.revision;
      if (stale !== state.stale) { state.stale = stale; notify(); }
      return true;
    }
    function dispose() {
      if (disposed) return;
      disposed = true; generation++; controller?.abort(); controller = null; retryQuery = null; history = []; cursor = null;
      state.data = null; state.loading = false; state.error = ''; state.canRetry = false; state.nextCursor = null; state.canPrevious = false;
    }
    return {state,current,refresh,setTab,setFilters,setRole,next,previous,retry,update,dispose};
  }
  const fmt = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-TW',{maximumFractionDigits:2}) : '—';
  const when = value => { try { return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)); } catch { return '時間未提供'; } };
  const titleOf = item => (item.kind === 'equip' && integer(item.enhance) ? '+' + item.enhance + ' ' : '') + (item.name || '未命名物品');
  const qualityName = item => item.qualityName || [...GEAR_QUALITIES,...BOOK_QUALITIES,...GUARDIAN_QUALITIES].find(([key]) => key === item.quality)?.[1] || '';
  const className = item => (Array.isArray(item.usableClasses) ? item.usableClasses : [item.classReq]).map(key => CLASSES.find(([value]) => value === key)?.[1]).filter(Boolean).join('／');
  const summaryOf = item => [item.kind === 'equip' && item.tier != null && 'T' + item.tier,qualityName(item),className(item),
    item.kind === 'guardian' && item.guardian?.typeName,item.category === 'skillbook' && item.advancementTier && item.advancementTier + '轉',
    item.requiredLevel && 'Lv.' + item.requiredLevel].filter(Boolean).join(' · ');
  function mount(root,host) {
    const doc = root.ownerDocument || document;
    if (!doc.querySelector('link[data-scene-exchange-style]')) {
      const sheet = doc.createElement('link'), script = doc.querySelector('script[src*="scene-exchange-ui.js"]');
      sheet.rel = 'stylesheet'; sheet.dataset.sceneExchangeStyle = 'true'; sheet.href = new URL('scene-exchange-ui.css?v=exchange-read-20261106',script?.src || doc.baseURI).href; doc.head.append(sheet);
    }
    root.innerHTML = '<section class="scene-exchange" aria-label="旅人交易所">' +
      '<div data-exchange-list-pane><p class="se-intro">尋找旅人留下的珍藏，翻閱自己的刊登與成交明細。</p>' +
      '<div class="se-tabs" role="group" aria-label="交易所功能"><button type="button" data-exchange-tab="browse" aria-pressed="true">瀏覽寶物</button><button type="button" data-exchange-tab="mine" aria-pressed="false">我的刊登</button><button type="button" data-exchange-tab="history" aria-pressed="false">成交紀錄</button></div>' +
      '<details class="se-filters" data-exchange-filter-box><summary>篩選條件 <span data-exchange-filter-summary></span></summary><form data-exchange-filter-form aria-label="交易所篩選"><div class="se-filter-grid">' +
      '<label>物品分類<select name="category" data-exchange-filter="category"></select></label><label>適用職業<select name="classReq" data-exchange-filter="classReq"></select></label>' +
      '<label>品質<select name="quality" data-exchange-filter="quality"></select></label><label>裝備 T 階<select name="tier" data-exchange-filter="tier"></select></label>' +
      '<label>強化下限<select name="enhanceMin" data-exchange-filter="enhanceMin"></select></label><label>強化上限<select name="enhanceMax" data-exchange-filter="enhanceMax"></select></label></div>' +
      '<div class="se-filter-actions"><button type="button" data-exchange-clear>清除篩選</button><button type="submit">套用篩選</button></div></form></details>' +
      '<label class="se-role" data-exchange-role-box hidden>成交類型<select data-exchange-role name="exchangeRole"></select></label>' +
      '<div class="se-toolbar"><h3 data-exchange-page tabindex="-1">第 1 頁</h3><button type="button" data-exchange-refresh>重新整理</button></div>' +
      '<p class="se-updated" data-exchange-updated></p><p class="se-status" data-exchange-status role="status" aria-live="polite"></p>' +
      '<div class="se-error" data-exchange-error-box hidden><p data-exchange-error role="alert"></p><button type="button" data-exchange-retry>重試讀取</button></div>' +
      '<div class="se-list" data-exchange-list aria-label="交易所紀錄"></div><p class="se-empty" data-exchange-empty hidden></p>' +
      '<nav class="se-pages" aria-label="交易所分頁"><button type="button" data-exchange-previous disabled>上一頁</button><button type="button" data-exchange-next disabled>下一頁</button></nav></div>' +
      '<section class="se-detail" data-exchange-detail-pane hidden aria-label="物品快照詳情"></section></section>';
    const find = key => root.querySelector('[data-exchange-' + key + ']'), section = root.querySelector('.scene-exchange');
    const listPane = find('list-pane'), detailPane = find('detail-pane'), list = find('list'), page = find('page'), status = find('status'), updated = find('updated'),
      errorBox = find('error-box'), error = find('error'), empty = find('empty'), previous = find('previous'), next = find('next'), role = find('role');
    const fields = Object.fromEntries(FILTER_KEYS.map(key => [key,root.querySelector('[data-exchange-filter="' + key + '"]')]));
    let disposed = false, client, paintedData = null, paintedSelection = '', pageFocus = null, detail = null;
    function node(tag,text,className) { const value = doc.createElement(tag); if (text !== undefined) value.textContent = String(text); if (className) value.className = className; return value; }
    function setOptions(select,rows,value) {
      select.replaceChildren(...rows.map(([key,label]) => { const option = node('option',label); option.value = String(key); return option; })); select.value = value === null ? '' : String(value);
    }
    setOptions(fields.category,CATEGORIES,'all'); setOptions(fields.classReq,CLASSES,'all'); setOptions(role,ROLES,'all');
    setOptions(fields.tier,[['','全部階級'],...Array.from({length:12},(_,i) => [i+1,'T' + (i+1)])],'');
    for (const key of ['enhanceMin','enhanceMax']) setOptions(fields[key],[['','不限'],...Array.from({length:16},(_,i) => [i,'+' + i])],'');
    function syncCategory() {
      const category = fields.category.value, quality = fields.quality.value, options = qualityOptions(category);
      setOptions(fields.quality,options,options.some(([key]) => key === quality) ? quality : 'all');
      const gear = ['all','equipment'].includes(category);
      for (const key of ['tier','enhanceMin','enhanceMax']) { fields[key].disabled = !gear; if (!gear) fields[key].value = ''; }
    }
    function artNode(item) {
      const wrap = node('span',undefined,'se-art');
      const equipment = item.equipment, value = equipment?.art, itemArt = typeof item.art === 'string' && /^\/?(?:art|expedition)\//.test(item.art) ? item.art : null;
      let raw = itemArt || (typeof value === 'string' ? value : value?.icon || value?.src || value?.path);
      // Preserve the scene inventory's known icon mapping; special collections keep their symbol fallback.
      const artId = typeof value === 'string' ? value : typeof item.art === 'string' ? item.art : null;
      if (equipment && !itemArt && typeof artId === 'string' && /^[a-z0-9_]+$/i.test(artId) && !artId.startsWith('star_ring_') && equipment.source !== 'star_ring' && equipment.classReq !== 'thief') raw = '/art/v2/' + artId + '.webp';
      if (!equipment && !itemArt && typeof item.item === 'string' && /^book_[a-z0-9_]+$/i.test(item.item)) raw = '/expedition/assets/skills-painted-20261011/' + item.item.slice(5) + '.webp';
      const symbol = item.emoji || (equipment?.slot === 'weapon' ? '⚔' : item.kind === 'equip' ? '◇' : '✦');
      if (typeof raw === 'string' && /^\/?(?:art|expedition)\/[A-Za-z0-9_./@-]+\.(?:webp|png|jpg|jpeg|avif)$/.test(raw) && !raw.split('/').includes('..')) {
        const image = node('img'); image.alt = ''; image.loading = 'lazy'; image.draggable = false; image.src = host.artUrl ? host.artUrl(raw) : new URL(raw,doc.baseURI).href;
        image.addEventListener('error',() => { if (!disposed) wrap.replaceChildren(node('span',symbol)); },{once:true}); wrap.append(image);
      } else wrap.append(node('span',symbol));
      return wrap;
    }
    function metadata(item) { return node('p',summaryOf(item),'se-item-meta'); }
    function card(row,tab) {
      const item = tab === 'history' ? row.item : row, card = node('article',undefined,'se-card'), button = node('button',undefined,'se-card-detail');
      card.dataset.kind = item.kind; card.dataset.quality = item.quality || ''; button.type = 'button'; button.dataset.exchangeDetail = row.id;
      button.setAttribute('aria-label','查看' + item.name + '的物品詳情');
      const text = node('span',undefined,'se-card-copy'), title = node('strong',titleOf(item),'se-name');
      text.append(title,metadata(item)); button.append(artNode(item),text); card.append(button);
      if (tab === 'history') {
        const head = node('div',undefined,'se-card-line'), kind = node('span',row.role === 'sell' ? '賣出' : '買入','se-badge'), time = node('time',when(row.settledAt));
        head.append(kind,time); card.append(head);
        card.append(node('p',(row.role === 'sell' ? '實收 +' + fmt(row.netGold) : '付款 −' + fmt(row.paidGold)) + ' 金幣','se-price'));
        card.append(node('p','整批 ' + fmt(row.qty) + (item.kind === 'guardian' ? ' 位' : item.kind === 'equip' ? ' 件' : ' 個'),'se-item-meta'));
      } else {
        card.append(node('p',fmt(row.price) + ' 金幣','se-price'));
        card.append(node('p','整批 ' + fmt(row.qty) + (item.kind === 'guardian' ? ' 位' : item.kind === 'equip' ? ' 件' : ' 個') + ' · ' + (STATUS_NAMES[row.status] || '已結束'),'se-item-meta'));
        card.append(node('p','刊登者：' + (row.seller?.name || '旅者') + (row.ownedByMe ? ' · 自己的刊登' : ''),'se-seller'));
      }
      return card;
    }
    function addRows(parent,rows) {
      const dl = node('dl',undefined,'se-facts');
      for (const [label,value] of rows) if (value !== undefined && value !== null && value !== '') {
        const group = node('div'); group.append(node('dt',label),node('dd',value)); dl.append(group);
      }
      if (dl.childNodes.length) parent.append(dl);
    }
    function addStats(parent,values,percent=false) {
      if (!plain(values)) return;
      addRows(parent,Object.entries(values).filter(([,value]) => typeof value === 'number' && Number.isFinite(value) && value !== 0)
        .map(([key,value]) => [STAT_NAMES[key] || key,(value > 0 ? '+' : '') + fmt(percent ? value * 100 : value) + (percent ? '%' : '')]));
    }
    function itemDetails(parent,item,history) {
      const e = item.equipment, g = item.guardian;
      if (e) {
        parent.append(node('h4','裝備資料'));
        addRows(parent,[['部位',e.slotName],['裝備類型',e.type || e.className],['需求等級',e.levelReq == null ? null : 'Lv.' + e.levelReq],
          ['路線需求',e.branchReq],['階級',e.tier == null ? null : 'T' + e.tier],['品質',e.rarityName || qualityName(item)],['裝備等第',e.gradeName],
          [e.statName || '主能力',e.stat == null ? null : fmt(e.stat)],['元素',e.elementName ? e.elementName + (e.elemStat == null ? '' : ' +' + fmt(e.elemStat)) : null]]);
        addStats(parent,e.extras); addStats(parent,e.pct,true);
        if (Array.isArray(e.affixes?.lines) && e.affixes.lines.length) {
          parent.append(node('h4','能力詞條' + (e.affixes.quality ? ' · ' + e.affixes.quality : '')));
          const lines = node('ul',undefined,'se-affixes');
          for (const line of e.affixes.lines) lines.append(node('li',(line.name || '詞條') + ' ' + (Number(line.value) > 0 ? '+' : '') + fmt(Number(line.value) * 100) + '%' + (line.quality ? ' · ' + line.quality : '')));
          parent.append(lines);
        }
        if (e.affix) { parent.append(node('h4','遺物詞條')); addStats(parent,e.affix,true); }
        if (e.growth) addRows(parent,[['基礎能力',e.growth.base == null ? null : fmt(e.growth.base)],['強化加成',e.growth.enhancement == null ? null : fmt(e.growth.enhancement)]]);
        if (e.towerImprint) addRows(parent,[['塔印等級',fmt(e.towerImprint.level) + '／' + fmt(e.towerImprint.max)],['塔印主能力加成',e.towerImprint.bonusPct == null ? null : fmt(e.towerImprint.bonusPct) + '%']]);
        addRows(parent,[['來源',e.source ? SOURCE_NAMES[e.source] || e.source : null],['綁定狀態',typeof e.bound === 'boolean' ? e.bound ? '已綁定' : '未綁定' : null],
          ['商店售價',e.sellPrice == null ? null : fmt(e.sellPrice) + ' 金幣']]);
        for (const text of [e.extrasText,e.relicProtection,e.expeditionProtection,e.sellNote,e.unbindBlock]) if (typeof text === 'string' && text) parent.append(node('p',text,'se-note'));
      } else if (g) {
        parent.append(node('h4','守護天使資料'));
        addRows(parent,[['品質',g.qualityName || item.qualityName],['類型',g.typeName],['守護能力',g.ability],['適用職業',className(item)],
          ['傷害加成',g.damageBonus == null ? null : fmt(Number(g.damageBonus) * 100) + '%'],['掉寶加成',g.lootBonus == null ? null : fmt(Number(g.lootBonus) * 100) + '%']]);
      }
      if (typeof item.desc === 'string' && item.desc) parent.append(node('p',item.desc,'se-description'));
      addRows(parent,[['適用職業',item.eligibleJob],['需求等級',item.requiredLevel ? 'Lv.' + item.requiredLevel : null],['轉職階段',item.advancementTier ? item.advancementTier + '轉' : null]]);
      if (history) parent.append(node('p',item.snapshotAvailable === false ? '物品快照暫無法顯示，成交金額與時間仍可核對。' : '以上保留成交時的物品資料，供你回顧與核對。','se-snapshot-note'));
    }
    function showDetail(row,control) {
      if (!client.current() || client.state.loading) return;
      const history = client.state.tab === 'history', item = history ? row.item : row;
      detail = {control,scroll:root.scrollTop}; detailPane.replaceChildren();
      const back = node('button','返回列表','se-detail-back'); back.type = 'button'; back.dataset.exchangeDetailBack = 'true';
      const hero = node('div',undefined,'se-detail-hero'), copy = node('div'), title = node('h3',titleOf(item)); title.tabIndex = -1; title.dataset.exchangeDetailTitle = 'true';
      copy.append(node('p',history ? '成交時的物品快照' : '刊登物品快照','se-eyebrow'),title,metadata(item)); hero.append(artNode(item),copy);
      detailPane.append(back,hero);
      addRows(detailPane,[['數量',fmt(row.qty)],['整批總價',fmt(row.price) + ' 金幣']]);
      if (history) {
        addRows(detailPane,[['成交類型',row.role === 'sell' ? '賣出' : '買入'],['成交時間',when(row.settledAt) + '（台灣時間）'],
          [row.role === 'sell' ? '買家' : '賣家',row.counterparty?.name || '旅者'],
          ['手續費',row.role === 'sell' ? fmt(row.fee) + ' 金幣' : '由賣方負擔'],[row.role === 'sell' ? '實收金幣' : '付款金幣',fmt(row.role === 'sell' ? row.netGold : row.paidGold)]]);
      } else {
        addRows(detailPane,[['刊登者',row.seller?.name || '旅者'],['刊登狀態',STATUS_NAMES[row.status] || '已結束'],['刊登時間',when(row.createdAt) + '（台灣時間）']]);
      }
      itemDetails(detailPane,item,history);
      listPane.hidden = true; detailPane.hidden = false; root.scrollTop = 0; title.focus({preventScroll:true});
    }
    function closeDetail() {
      if (!detail || disposed || !client.current()) return false;
      const saved = detail; detail = null; detailPane.hidden = true; listPane.hidden = false; detailPane.replaceChildren(); root.scrollTop = saved.scroll;
      if (saved.control?.isConnected) saved.control.focus({preventScroll:true}); else page.focus({preventScroll:true});
      return true;
    }
    function paint() {
      if (disposed || !client?.current()) return;
      const state = client.state, data = state.data;
      section.setAttribute('aria-busy',String(state.loading));
      root.querySelector('.se-intro').textContent = state.tab === 'mine' ? '查看此帳號各角色的刊登與狀態，刊登者顯示於每筆紀錄。' : state.tab === 'history' ? '翻閱目前角色的買入與賣出明細，核對成交時的物品資料。' : '尋找旅人留下的珍藏，查看刊登物品與原有屬性。';
      for (const button of root.querySelectorAll('[data-exchange-tab]')) button.setAttribute('aria-pressed',String(button.dataset.exchangeTab === state.tab));
      find('filter-box').hidden = state.tab !== 'browse'; find('role-box').hidden = state.tab !== 'history'; role.value = state.role;
      const selectionKey = JSON.stringify([state.tab,state.filters,state.role]);
      if (selectionKey !== paintedSelection) {
        for (const key of FILTER_KEYS) if (key !== 'quality') fields[key].value = state.filters[key] === null ? '' : String(state.filters[key]);
        syncCategory(); fields.quality.value = state.filters.quality; paintedSelection = selectionKey;
      }
      find('filter-summary').textContent = ' · ' + (CATEGORIES.find(([key]) => key === state.filters.category)?.[1] || '全部物品');
      page.textContent = '第 ' + state.page + ' 頁'; updated.textContent = data ? '讀取時間 ' + when(data.serverNow) + ' · 台北時間' : '';
      status.textContent = state.loading ? '正在讀取交易所…' : state.error ? '讀取未完成，可重試或重新整理。' :
        data ? '第 ' + state.page + ' 頁，共 ' + data.items.length + ' 筆。' + (state.stale ? '角色狀態已更新，可重新整理。' : '') : '';
      errorBox.hidden = !state.error; error.textContent = state.error;
      previous.disabled = !state.canPrevious; previous.setAttribute('aria-disabled',String(state.loading || !state.canPrevious));
      next.disabled = !data || state.nextCursor === null; next.setAttribute('aria-disabled',String(state.loading || !data || state.nextCursor === null));
      find('retry').disabled = state.loading; find('retry').hidden = !state.canRetry;
      if (paintedData !== data) { list.replaceChildren(...(data?.items || []).map(row => card(row,state.tab))); paintedData = data; }
      for (const button of list.querySelectorAll('[data-exchange-detail]')) button.setAttribute('aria-disabled',String(state.loading));
      empty.hidden = state.loading || !!state.error || !data || data.items.length > 0;
      empty.textContent = state.tab === 'mine' ? '此帳號還沒有刊登紀錄。' : state.tab === 'history' ? '這個類型還沒有成交紀錄。' : '目前沒有符合條件的寶物，可以調整篩選或稍後重新整理。';
      if (pageFocus && !state.loading) {
        if (!state.error && data !== pageFocus.before && (doc.activeElement === pageFocus.control || doc.activeElement === doc.body)) { root.scrollTop = 0; page.focus({preventScroll:true}); }
        pageFocus = null;
      }
    }
    client = createClient({...host,onState:paint});
    function click(event) {
      if (disposed || !client.current()) return;
      const button = event.target.closest?.('button');
      if (!button || !root.contains(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      if (button.hasAttribute('data-exchange-detail-back')) { closeDetail(); return; }
      if (button.hasAttribute('data-exchange-tab')) { pageFocus = null; void client.setTab(button.dataset.exchangeTab); }
      else if (button.hasAttribute('data-exchange-refresh')) { pageFocus = null; void client.refresh(); }
      else if (button.hasAttribute('data-exchange-retry')) { pageFocus = null; if (doc.activeElement === button) page.focus({preventScroll:true}); void client.retry(); }
      else if (button.hasAttribute('data-exchange-next') || button.hasAttribute('data-exchange-previous')) {
        pageFocus = {control:button,before:client.state.data}; void (button.hasAttribute('data-exchange-next') ? client.next() : client.previous());
      } else if (button.hasAttribute('data-exchange-clear')) {
        pageFocus = null;
        if (sameFilters(client.state.filters,defaults())) { paintedSelection = ''; paint(); }
        else void client.setFilters(defaults());
      } else if (button.hasAttribute('data-exchange-detail')) {
        const row = client.state.data?.items.find(row => row.id === button.dataset.exchangeDetail); if (row) showDetail(row,button);
      }
    }
    function change(event) {
      if (disposed || !client.current()) return;
      if (event.target === fields.category) syncCategory();
      if (event.target === role) { pageFocus = null; void client.setRole(role.value); }
    }
    function submit(event) {
      if (!event.target.hasAttribute('data-exchange-filter-form')) return;
      event.preventDefault(); if (disposed || !client.current()) return;
      const filters = {};
      for (const key of FILTER_KEYS) filters[key] = ['tier','enhanceMin','enhanceMax'].includes(key) ? fields[key].value === '' ? null : Number(fields[key].value) : fields[key].value;
      pageFocus = null; void client.setFilters(filters);
    }
    root.addEventListener('click',click); root.addEventListener('change',change); root.addEventListener('submit',submit);
    paint(); void client.refresh();
    return {client,handleBack:closeDetail,update:snapshot => client.update(snapshot),dispose() {
      if (disposed) return; disposed = true; detail = null; pageFocus = null; paintedData = null;
      client.dispose(); root.removeEventListener('click',click); root.removeEventListener('change',change); root.removeEventListener('submit',submit);
    }};
  }
  globalThis.RpgSceneExchange = Object.freeze({createClient,mount,normalizeFilters,qualityOptions});
})();
