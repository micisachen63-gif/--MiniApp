/* Shared equipment / inventory surface. All mutations use the existing game services. */
(() => {
  'use strict';
  const SLOTS = {weapon:'武器',helmet:'頭盔',armor:'盔甲',gloves:'手套',boots:'長靴',belt:'腰帶',undershirt:'內衣',earring:'耳環',ring:'戒指'};
  const MULTI = new Set(['earring','ring']);
  const LABELS = {atk:'攻擊力',def:'防禦力',hp:'生命值',mp:'魔力',atkPct:'攻擊',defPct:'防禦',hpPct:'生命',mpPct:'魔力',critPct:'暴擊',critDamagePct:'暴擊傷害',damagePct:'傷害',damageReducePct:'減傷',attackSpeedPct:'攻速',healPct:'治療'};
  const SOURCE_NAMES = {starter:'新手裝備',shop:'商店',npc:'商店',gacha:'轉蛋',normal:'一般掉落',idle:'掛機掉落',elite:'菁英掉落',boss:'首領掉落',star_ring:'星環遠征',atlas:'星圖探索',tower:'星穹塔'};
  const MAX_SELL = 100;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-TW', {maximumFractionDigits:2}) : '—';
  const entries = value => Array.isArray(value) ? value : Object.entries(value || {}).map(([id,v]) => typeof v === 'object' && v ? {id,...v} : {id,name:v});
  const keyOf = context => ['accountId','realmId','characterId','epoch'].map(k => String(context?.[k] ?? '')).join('|');
  const title = item => (Number(item.enhance) ? '+' + Number(item.enhance) + ' ' : '') + (item.name || item.id);
  const token = item => JSON.stringify(item);
  const precious = item => item.grade === 'relic' || Number(item.enhance) > 0 || ['legendary','overlord','supreme','mythic'].includes(item.rarity) || Number(item.towerImprint?.level) > 0 || item.source === 'star_ring';
  function requestId() {
    return 'inv_' + (globalThis.crypto?.randomUUID?.().replaceAll('-','') || Date.now().toString(36) + Math.random().toString(36).slice(2,14));
  }
  // Pending operations belong to an identity, not a window route or selection epoch.
  // A null memory entry is a tombstone: stale route drafts cannot restore cleared work.
  const pendingMemory = new Map();
  const pendingActions = new Set(['equip','unequip','sell-gear','sell-gear-batch','gacha/open','fate/gifts/open']);
  const operationScope = context => JSON.stringify(['accountId','realmId','characterId'].map(key => String(context?.[key] ?? '')));
  function validPending(record, scope) {
    if (!record || record.version !== 1 || record.scope !== scope || typeof record.id !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(record.id) || !pendingActions.has(record.action)) return false;
    const body = record.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || record.receipt !== (record.action === 'fate/gifts/open')) return false;
    const fields = {equip:['itemId','position'],unequip:['itemId'],'sell-gear':['itemId','requestId'],'sell-gear-batch':['itemIds','requestId'],'gacha/open':['type','requestId'],'fate/gifts/open':['requestId']}[record.action];
    if (Object.keys(body).some(key => !fields.includes(key))) return false;
    if (fields.includes('requestId') && (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(body.requestId))) return false;
    const itemId = id => typeof id === 'string' && id.length > 0 && id.length <= 160;
    if (fields.includes('itemId') && !itemId(body.itemId)) return false;
    if (record.action === 'equip' && body.position != null && ![1,2].includes(body.position)) return false;
    if (record.action === 'sell-gear-batch' && (!Array.isArray(body.itemIds) || !body.itemIds.length || body.itemIds.length > MAX_SELL || !body.itemIds.every(itemId) || new Set(body.itemIds).size !== body.itemIds.length)) return false;
    return record.action !== 'gacha/open' || ['weapon','armor'].includes(body.type);
  }
  function ensureStyles(root) {
    const doc = root.ownerDocument || globalThis.document;
    if (!doc?.head || !doc.createElement || !doc.querySelector || doc.querySelector('link[data-scene-inventory-style]')) return;
    const link = doc.createElement('link'), script = doc.querySelector('script[src*="scene-inventory-ui.js"]');
    link.rel = 'stylesheet';
    link.dataset.sceneInventoryStyle = 'true';
    link.href = new URL('scene-inventory-ui.css?v=unified-ui-20261104',script?.src || doc.baseURI).href;
    // A failed stylesheet may be retried on a later mount; successful mounts share it.
    link.addEventListener?.('error',() => link.remove(),{once:true});
    doc.head.append(link);
  }
  function mount(root, host, options = {}) {
    if (!root || !host?.request || !host?.getContext) throw new Error('Inventory host is required');
    ensureStyles(root);
    const captured = keyOf(host.getContext()), draft = host.draft || (host.draft = {});
    const pendingScope = operationScope(host.getContext()), pendingKey = 'scene:inventory-pending:' + pendingScope;
    let pendingStorage;
    try { pendingStorage = host.storage || globalThis.sessionStorage; } catch {}
    function currentPending() {
      if (!pendingMemory.has(pendingScope)) {
        let saved = null;
        try { saved = JSON.parse(pendingStorage?.getItem(pendingKey) || 'null'); } catch {}
        pendingMemory.set(pendingScope, validPending(saved,pendingScope) ? saved : null);
      }
      const record = pendingMemory.get(pendingScope);
      // Retain a display mirror for the route; never read it as operation authority.
      if (record) draft.pending = record; else delete draft.pending;
      return record;
    }
    function rememberPending(operation) {
      const record = JSON.parse(JSON.stringify({version:1,id:operation.id || requestId(),scope:pendingScope,action:operation.action,body:operation.body,receipt:operation.action === 'fate/gifts/open',label:operation.title || operation.label || '物品操作'}));
      if (!validPending(record,pendingScope)) throw new Error('操作資料不完整，請重新預覽');
      pendingMemory.set(pendingScope,record);
      try { pendingStorage?.setItem(pendingKey,JSON.stringify(record)); } catch {}
      draft.pending = record;
      return record;
    }
    function clearPending(operation) {
      if (!operation || currentPending()?.id !== operation.id) return false;
      pendingMemory.set(pendingScope,null);
      try { pendingStorage?.removeItem(pendingKey); } catch {}
      delete draft.pending;
      return true;
    }
    const mode = ['equipment','inventory','item'].includes(options.mode) ? options.mode : 'inventory';
    for (const [key,value] of Object.entries({query:'',category:mode === 'equipment' ? 'equipment' : 'all',slot:'all',rarity:'all',availability:'all',selected:[],position:1})) if (draft[key] === undefined) draft[key] = value;
    if (!Array.isArray(draft.selected)) draft.selected = [];
    draft.selected = [...new Set(draft.selected.map(String))].slice(0,MAX_SELL);
    const state = {me:null,meta:null,atlas:null,catalog:null,recovery:null,gift:null,loading:true,busy:false,stale:false,error:'',notice:'',warnings:[],confirm:null};
    let disposed = false, generation = 0, readController = null, composing = false;
    const live = () => !disposed && keyOf(host.getContext()) === captured && (typeof host.current !== 'function' || host.current());
    const validResponse = data => {
      if (!data || data.ok === false) throw Object.assign(new Error(data?.message || '資料未完整載入'), {uncertain:false});
      const context = host.getContext();
      if ((data.characterId != null && String(data.characterId) !== String(context.characterId)) || (data.realmId != null && String(data.realmId) !== String(context.realmId)) || (data.character?.tgId != null && context.characterId && String(data.character.tgId) !== String(context.characterId))) throw Object.assign(new Error('角色或世界已切換'), {code:'context_changed',uncertain:false});
      return data;
    };
    const actionButton = (action, label, {disabled=false,kind='',id='',position='',route='',tab=''} = {}) => '<button type="button" class="si-button ' + esc(kind) + '" data-inv-action="' + esc(action) + '"' + (id ? ' data-item-id="' + esc(id) + '"' : '') + (position ? ' data-position="' + esc(position) + '"' : '') + (route ? ' data-route="' + esc(route) + '"' : '') + (tab ? ' data-tab="' + esc(tab) + '"' : '') + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
    const locked = () => state.loading || state.busy || state.stale || !!currentPending();
    const gear = () => Array.isArray(state.me?.equipment) ? state.me.equipment : [];
    const itemById = id => gear().find(e => String(e.id) === String(id));
    const craftCount = item => Number(state.atlas?.equipment?.find(e => String(e.id) === String(item.id))?.crafts) || 0;
    const isPrecious = item => precious(item) || craftCount(item) > 0 || state.recovery?.items?.some(e => String(e.id) === String(item.id) && e.highValue === true);
    const jobBlock = item => {
      const job = [state.me?.autoEnhance,state.me?.autoReroll].find(j => j && j.status === 'running' && String(j.itemId) === String(item.id));
      return job ? '背景' + (job === state.me.autoEnhance ? '強化' : '洗鍊') + '進行中，請先到工坊停止作業' : null;
    };
    const partyBlock = () => {
      const c = state.me?.character, activity = state.me?.activity;
      return c?.partyId && !(activity?.kind === 'star-ring' && String(activity.id) === String(c.partyId)) ? '請先結束目前的組隊戰鬥；星環遠征期間可管理背包物品' : null;
    };
    const sellBlock = item => item.sellBlock || (item.equipped ? '請先卸下裝備再出售' : null) || (item.inTrade ? '交易中的裝備不能出售' : null) || jobBlock(item);
    const equipBlock = item => jobBlock(item) || partyBlock() || (item.inTrade ? '交易中的裝備不能穿戴或卸下' : null) || (!item.equipped ? item.cannotEquip : null);
    const safeToSelect = item => !sellBlock(item) && Number.isFinite(Number(item.sellPrice));
    const navigate = (route, params = {}) => { if (live() && !state.busy) host.navigate?.(route, params); };
    const itemMeta = id => state.meta?.items?.[id] || {name:id,emoji:'◇',kind:'unknown'};
    function materials() {
      const names = new Map(entries(state.catalog?.materials).map(x => [String(x.id || x.key),x]));
      const list = Object.entries(state.me?.inventory || {}).filter(([,qty]) => Number(qty) > 0).map(([id,quantity]) => {
        const meta = itemMeta(id), consumable = ['red','blue','scroll','gacha','fate_gift','ward','reselect','book'].includes(meta.kind) || id.startsWith('book_') || id === 'guardian_summon_stone' || id === 'guardian_free_normal' || id === 'guardian_voucher';
        return {id,quantity:Number(quantity),...meta,group:consumable ? 'items' : 'materials',origin:'inventory'};
      });
      for (const [id,quantity] of Object.entries(state.atlas?.materials || {})) if (Number(quantity) > 0) list.push({...(names.get(id) || {name:id}),id:'atlas:' + id,materialId:id,quantity:Number(quantity),group:'materials',origin:'atlas',emoji:'✦'});
      if (state.recovery?.enabled && Number(state.recovery.dust) > 0) list.push({id:'recovery:dust',name:'裝備精煉材料',quantity:Number(state.recovery.dust),group:'materials',origin:'recovery',emoji:'✧',desc:'角色專用精煉材料，用於回收與重洗；不進入交易。'});
      return list;
    }
    function allRows() { return [...gear().map(e => ({...e,group:'equipment',origin:'equipment'})),...materials()]; }
    function filteredRows() {
      const query = String(draft.query || '').trim().toLocaleLowerCase();
      return allRows().filter(row => {
        if (mode === 'equipment' && row.group !== 'equipment') return false;
        if (draft.category !== 'all' && row.group !== draft.category) return false;
        if (row.group === 'equipment') {
          if (draft.slot !== 'all' && row.slot !== draft.slot) return false;
          if (draft.rarity !== 'all' && row.rarity !== draft.rarity) return false;
          if (draft.availability === 'wearable' && (row.cannotEquip || equipBlock(row))) return false;
          if (draft.availability === 'sale' && !safeToSelect(row)) return false;
          if (draft.availability === 'equipped' && !row.equipped) return false;
        } else if (draft.slot !== 'all' || draft.rarity !== 'all' || draft.availability !== 'all') return false;
        return !query || [row.name,row.id,row.slotName,row.rarityName,row.elementName,row.desc,row.className,SOURCE_NAMES[row.source] || row.source].filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
      });
    }
    function icon(item) {
      let path = typeof item.art === 'object' ? item.art?.src || item.art?.path : null;
      if (!path && typeof item.iconSrc === 'string') path = item.iconSrc;
      if (!path && typeof item.art === 'string' && item.source !== 'star_ring' && item.classReq !== 'thief' && /^[a-z0-9_]+$/i.test(item.art)) path = '/art/v2/' + item.art + '.webp';
      if (!path && item.origin === 'inventory' && /^book_[a-z0-9_]+$/i.test(item.id)) path = '/expedition/assets/skills-painted-20261011/' + item.id.slice(5) + '.webp';
      const url = path && host.artUrl?.(path);
      return url ? '<img class="si-item-art" src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="si-item-symbol" aria-hidden="true">' + esc(item.emoji || (item.slot === 'weapon' ? '⚔' : item.origin === 'equipment' || item.slot ? '◇' : '✧')) + '</span>';
    }
    function notices() {
      let html = state.notice ? '<p class="si-feedback" role="status">' + esc(state.notice) + '</p>' : '';
      if (state.error) html += '<p class="si-feedback si-error" role="alert">' + esc(state.error) + '</p>';
      if (state.warnings.length) html += '<p class="si-muted" data-inv-partial>' + esc(state.warnings.join('；')) + '。可重新整理再確認。</p>';
      const pending = currentPending();
      if (pending) {
        html += '<section class="si-pending" role="status" data-inv-pending><strong>上次操作結果待確認</strong><p>' + esc(pending.label) + '。已保留操作資料；畫面只讀回背包，不會自動再執行。</p><p class="si-muted">請核對最新持有量與裝備。' + (pending.receipt ? '這項服務有原收據，可用同一編號查回結果。' : '未收到成功收據，持有量變化本身不能證明這筆操作的結果。') + '</p><div class="si-actions">' + actionButton('refresh','讀取最新背包',{disabled:state.busy || state.loading}) + (pending.receipt ? actionButton('recover','以原編號查回結果',{disabled:state.busy || state.loading,kind:'si-primary'}) : actionButton('acknowledge','我已核對，結束待確認狀態',{disabled:state.busy || state.loading || state.stale})) + '</div></section>';
      }
      return html;
    }
    function header() {
      const c = state.me?.character;
      return '<header class="si-heading"><div><p class="si-eyebrow">' + esc(c ? c.name + ' · Lv.' + c.level : '角色物品') + '</p><h2>' + (mode === 'equipment' ? '裝備' : mode === 'item' ? '物品詳情' : '背包') + '</h2></div>' + actionButton('refresh',state.loading ? '讀取中…' : '重新整理',{disabled:state.loading || state.busy}) + '</header>' +
        (c ? '<div class="si-summary"><span>金幣 <b>' + fmt(c.gold) + '</b></span><span>裝備 <b>' + gear().length + '</b> 件</span><span>道具／材料 <b>' + materials().length + '</b> 種</span></div>' : '') +
        '<p class="si-muted si-snapshot">物品資料於開啟、重新整理與操作後更新。出征中的裝備與能力沿用出發快照，換裝影響之後的新戰鬥。</p>';
    }
    function equippedSlots() {
      return '<section class="si-equipped" aria-label="目前穿戴">' + Object.entries(SLOTS).flatMap(([slot,name]) => Array.from({length:MULTI.has(slot) ? 2 : 1},(_,i) => {
        const position = i + 1, item = gear().find(e => e.equipped && e.slot === slot && Number(e.position || 1) === position);
        return '<button type="button" class="si-slot ' + (item ? '' : 'si-empty-slot') + '" data-inv-action="' + (item ? 'detail' : 'slot-filter') + '" data-item-id="' + esc(item?.id || '') + '" data-slot="' + esc(slot) + '"><small>' + esc(name + (MULTI.has(slot) ? ' ' + position : '')) + '</small>' + (item ? icon(item) + '<span>' + esc(title(item)) + '</span>' : '<span>未穿戴</span>') + '</button>';
      })).join('') + '</section>';
    }
    function filterControls() {
      const rarityOptions = [...new Map(gear().map(e => [e.rarity,e.rarityName || e.rarity])).entries()];
      return '<section class="si-filters" aria-label="背包篩選"><label class="si-search"><span>搜尋物品</span><input name="inventorySearch" type="search" autocomplete="off" maxlength="100" placeholder="名稱、部位或屬性" value="' + esc(draft.query) + '"></label>' +
        (mode !== 'equipment' ? '<label><span>分類</span><select name="inventoryCategory">' + [['all','所有物品'],['equipment','裝備'],['items','道具'],['materials','材料']].map(([v,n]) => '<option value="' + v + '"' + (draft.category === v ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' : '') +
        '<label><span>部位</span><select name="inventorySlot"><option value="all">所有部位</option>' + Object.entries(SLOTS).map(([v,n]) => '<option value="' + v + '"' + (draft.slot === v ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
        '<label><span>品質</span><select name="inventoryRarity"><option value="all">所有品質</option>' + rarityOptions.map(([v,n]) => '<option value="' + esc(v) + '"' + (draft.rarity === v ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></label>' +
        '<label><span>狀態</span><select name="inventoryAvailability">' + [['all','全部狀態'],['wearable','目前可穿戴'],['equipped','已穿戴'],['sale','可出售']].map(([v,n]) => '<option value="' + v + '"' + (draft.availability === v ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label></section>';
    }
    function rowHtml(row) {
      const isGear = row.group === 'equipment', block = isGear ? sellBlock(row) : null;
      const badges = isGear ? [row.rarityName,'T' + row.tier,row.slotName,row.equipped ? '穿戴中' : '',row.bound ? '已綁定' : '',row.inTrade ? '交易託管中' : '',jobBlock(row) ? '背景作業中' : '',row.grade === 'relic' ? '遺物' : ''].filter(Boolean).join(' · ') : row.origin === 'atlas' ? '星圖材料 · 角色持有' : row.origin === 'recovery' ? '精煉材料 · 角色專用' : row.group === 'materials' ? '材料' : '道具';
      return '<article class="si-row" data-rarity="'+esc(row.rarity||'')+'" data-selected="'+draft.selected.includes(String(row.id))+'" data-inv-row="' + esc(row.id) + '">' + (isGear ? '<label class="si-select" title="' + esc(block || '選入出售清單') + '"><input type="checkbox" name="inventorySelected" data-item-id="' + esc(row.id) + '"' + (draft.selected.includes(String(row.id)) ? ' checked' : '') + (!safeToSelect(row) || locked() ? ' disabled' : '') + ' aria-label="選取 ' + esc(title(row)) + '"></label>' : '<span class="si-row-spacer"></span>') +
        '<button type="button" class="si-row-open" data-inv-action="detail" data-item-id="' + esc(row.id) + '" aria-label="'+esc((isGear?title(row):row.name)+' · '+badges)+'" title="'+esc((isGear?title(row):row.name)+' · '+badges)+'"><span class="si-card-art">' + icon(row) + '<span class="si-card-count">'+(isGear?'+'+fmt(row.enhance||0):'×'+fmt(row.quantity))+'</span></span><span class="si-row-copy"><strong>' + esc(row.name) + '</strong><small>' + esc(badges) + '</small>' + (isGear ? '<small class="si-card-stat">' + esc(row.statName) + ' ' + fmt(row.stat) + (row.elementName ? ' · ' + esc(row.elementName) + ' +' + fmt(row.elemStat) : '') + '</small>' : '') + '</span><span class="si-row-value">' + (isGear ? (block ? '<small>' + esc(block) + '</small>' : fmt(row.sellPrice) + '<small>金幣售價</small>') : '×' + fmt(row.quantity)) + '</span></button></article>';
    }
    function listView() {
      const rows = filteredRows(), selected = draft.selected.map(itemById).filter(Boolean);
      return (mode === 'equipment' ? equippedSlots() : '') + '<nav class="si-quick" aria-label="物品功能">' + actionButton('navigate',mode === 'equipment' ? '查看背包' : '目前穿戴',{route:mode === 'equipment' ? 'inventory' : 'equipment'}) + actionButton('navigate','裝備收藏冊',{route:'gearbook'}) + actionButton('navigate','典藏與精煉',{route:'recovery',disabled:state.recovery?.enabled !== true}) + actionButton('navigate','工坊',{route:'workshop'}) + '</nav>' +
        '<details class="si-filter-drawer" data-inv-filters '+(draft.filtersOpen?'open':'')+'><summary>搜尋與篩選<span>名稱 · 分類 · 部位 · 品質 · 狀態</span></summary>'+filterControls()+'</details>' + '<div class="si-list-tools"><span>找到 ' + rows.length + ' 項' + (draft.selected.length ? ' · 已選 ' + draft.selected.length + ' 件裝備（包含其他篩選）' : '') + '</span><div class="si-actions">' + actionButton('select-visible','選取此頁一般裝備',{disabled:locked() || !rows.some(r => r.group === 'equipment' && safeToSelect(r) && !isPrecious(r))}) + actionButton('clear-selection','清除選取',{disabled:locked() || !draft.selected.length}) + '</div></div>' +
        '<div class="si-list" data-inv-list>' + (rows.length ? rows.map(rowHtml).join('') : '<p class="si-empty">沒有符合條件的持有物品。可更改搜尋或篩選。</p>') + '</div>' +
        (draft.selected.length ? '<footer class="si-bulk"><span><b>' + draft.selected.length + '</b> 件已選 · 目前售價合計 <b>' + fmt(selected.reduce((sum,e) => sum + Number(e.sellPrice || 0),0)) + '</b> 金幣<small>每批最多 ' + MAX_SELL + ' 件；確認前會重新讀取物品。</small></span>' + actionButton('preview-batch','預覽出售',{disabled:locked() || !selected.length,kind:'si-danger'}) + '</footer>' : '');
    }
    function statsRows(object, percent = false) {
      return Object.entries(object || {}).filter(([,v]) => Number(v) !== 0).map(([k,v]) => '<div><dt>' + esc(LABELS[k] || k) + '</dt><dd>' + (Number(v) > 0 ? '+' : '') + fmt(percent ? Number(v) * 100 : v) + (percent ? '%' : '') + '</dd></div>').join('');
    }
    function comparison(item) {
      const position = MULTI.has(item.slot) ? Number(draft.position) === 2 ? 2 : 1 : 1;
      const other = gear().find(e => e.equipped && e.slot === item.slot && Number(e.position || 1) === position);
      const same = other?.id === item.id, delta = Number(item.stat) - Number(other?.stat || 0);
      return '<section class="si-compare"><h3>同部位比較</h3>' + (MULTI.has(item.slot) ? '<label>比較位置 <select name="inventoryPosition"><option value="1"' + (position === 1 ? ' selected' : '') + '>' + esc(SLOTS[item.slot]) + ' 1</option><option value="2"' + (position === 2 ? ' selected' : '') + '>' + esc(SLOTS[item.slot]) + ' 2</option></select></label>' : '') + '<div class="si-compare-grid"><div><small>目前穿戴</small><strong>' + esc(other ? title(other) : '空位') + '</strong><span>' + esc(item.statName) + ' ' + fmt(other?.stat || 0) + '</span></div><div><small>選取裝備</small><strong>' + esc(title(item)) + '</strong><span>' + esc(item.statName) + ' ' + fmt(item.stat) + '</span></div></div><p class="si-muted">' + (same ? '這件就是目前位置的裝備。' : '單件主屬性差 ' + (delta > 0 ? '+' : '') + fmt(delta) + '。') + ' 僅比較此部位的主屬性；元素、詞條、整套能力與天賦請一併查看，不代表總戰力差。</p></section>';
    }
    function equipmentDetail(item) {
      const block = equipBlock(item), sale = sellBlock(item), current = item.equipped;
      return '<section class="si-detail" data-inv-detail="' + esc(item.id) + '"><div class="si-detail-hero">' + icon(item) + '<div><p class="si-eyebrow">' + esc([item.rarityName,item.gradeName,item.slotName,'T' + item.tier].filter(Boolean).join(' · ')) + '</p><h3>' + esc(title(item)) + '</h3><p>' + esc(item.type || item.className) + ' · 需求 Lv.' + esc(item.levelReq) + (item.branchReq ? ' · ' + esc(item.branchReq) + ' 路線' : '') + '</p></div></div>' +
        '<dl class="si-stats"><div><dt>' + esc(item.statName) + '</dt><dd>' + fmt(item.stat) + '</dd></div><div><dt>元素</dt><dd>' + esc(item.elementName || '無') + ' +' + fmt(item.elemStat) + '</dd></div>' + statsRows(item.extras) + statsRows(item.pct,true) + '<div><dt>來源</dt><dd>' + esc(SOURCE_NAMES[item.source] || item.source || '未標示') + '</dd></div><div><dt>綁定</dt><dd>' + (item.bound ? '已綁定' : '未綁定，穿戴後會綁定') + '</dd></div><div><dt>交易</dt><dd>' + esc(item.inTrade ? '交易託管中' : item.tradeBlock || '可交易') + '</dd></div><div><dt>分享</dt><dd>' + esc(item.shareBlock || '可分享') + '</dd></div><div><dt>商店售價</dt><dd>' + fmt(item.sellPrice) + ' 金幣</dd></div></dl>' +
        (item.affixes?.lines?.length ? '<section><h4>能力詞條 · ' + esc(item.affixes.quality || '') + '</h4><ul class="si-affixes">' + item.affixes.lines.map(line => '<li>' + esc(line.name) + ' <b>+' + fmt(Number(line.value) * 100) + '%</b> <small>' + esc(line.quality || '') + (line.recommended ? ' · 適合目前職業' : '') + '</small></li>').join('') + '</ul></section>' : '') +
        (item.affix ? '<section><h4>遺物詞條</h4><dl class="si-stats">' + statsRows(item.affix,true) + '</dl></section>' : '') +
        (item.growth ? '<p class="si-muted">' + esc(item.statName) + '組成：基礎 ' + fmt(item.growth.base) + ' ＋ 強化 ' + fmt(item.growth.enhancement) + '（已計入裝備加成）。</p>' : '') +
        (craftCount(item) ? '<p class="si-muted">星圖銘刻 ' + fmt(craftCount(item)) + ' 次；已計入目前裝備主能力。</p>' : '') +
        (Number(item.towerImprint?.level) ? '<p class="si-muted">塔印 ' + fmt(item.towerImprint.level) + '／' + fmt(item.towerImprint.max) + ' · 主能力 +' + fmt(item.towerImprint.bonusPct) + '%，已計入上方能力。</p>' : '') +
        [item.relicProtection,item.expeditionProtection,item.sellNote].filter(Boolean).map(t => '<p class="si-muted">' + esc(t) + '</p>').join('') + comparison(item) +
        (block ? '<p class="si-lock" data-inv-equip-lock>' + esc(block) + '</p>' : '') + (sale ? '<p class="si-lock" data-inv-sell-lock>' + esc(sale) + '</p>' : '') +
        '<div class="si-actions si-detail-actions">' + actionButton(current ? 'preview-unequip' : 'preview-equip',current ? '卸下裝備' : '穿戴到' + SLOTS[item.slot] + (MULTI.has(item.slot) ? ' ' + draft.position : ''),{id:item.id,disabled:locked() || !!block,kind:'si-primary'}) + actionButton('navigate','強化',{route:'workshop',id:item.id,tab:'enhance'}) + actionButton('navigate','洗鍊',{route:'workshop',id:item.id,tab:'reroll'}) + actionButton('navigate','典藏／精煉／重洗',{route:'recovery',id:item.id,disabled:state.recovery?.enabled !== true}) + actionButton('navigate','裝備收藏冊',{route:'gearbook',id:item.id}) + actionButton('navigate','分享／解契／路線轉換',{route:'equipment-tools',id:item.id}) + actionButton('preview-sell','出售這件裝備',{id:item.id,disabled:locked() || !!sale,kind:'si-danger'}) + '</div>' +
        (item.unbindBlock && item.bound ? '<p class="si-muted">解除綁定限制：' + esc(item.unbindBlock) + '</p>' : '') +
        (state.recovery && !state.recovery.enabled ? '<p class="si-muted">此世界尚未開啟裝備典藏與精煉。</p>' : '') + '</section>';
    }
    function inventoryDetail(item) {
      const canTrade = item.origin === 'inventory' && Array.isArray(state.meta?.trade?.tradeableItems) ? state.meta.trade.tradeableItems.includes(item.id) : null;
      const potion = ['red','blue'].includes(item.kind) || /^(?:red|blue)_\d+$/.test(item.id);
      const chest = item.id === 'gacha_weapon' || item.id === 'gacha_armor', gift = item.id === 'fate_cycle_gift';
      let actions = '', help = '';
      if (chest || gift) actions += actionButton('preview-use','開啟 1 個',{id:item.id,disabled:locked() || item.quantity < 1,kind:'si-primary'});
      else if (potion) { help = '藥水由戰鬥依補給設定使用；此處不提供手動消耗。'; actions += actionButton('navigate','補給設定',{route:'supplies'}); }
      else if (item.kind === 'scroll' && item.id !== 'unbind') actions += actionButton('navigate',item.id === 'scroll_r' ? '到工坊洗鍊' : '到工坊強化',{route:'workshop',tab:item.id === 'scroll_r' ? 'reroll' : 'enhance'});
      else if (item.origin === 'recovery') actions += actionButton('navigate','典藏與精煉',{route:'recovery'});
      else if (item.origin === 'atlas') { help = '星圖材料用於星圖銘刻與成長，數量來自已提交的探索結果。'; actions += actionButton('navigate','星圖銘刻',{route:'inscription'}); }
      else if (item.id.startsWith('book_') || item.kind === 'book') help = '技能書可在原有技能系統學習或研究；主場技能操作尚未移入，本頁保留持有量與用途。';
      else if (item.id === 'ward') help = '守護符在符合條件的死亡或決鬥事件自動消耗。';
      else if (item.id === 'unbind') help = '解契卷用於未穿戴綁定裝備的解契，需求張數依裝備條件計算；此頁不直接消耗。';
      else if (item.id.startsWith('reselect_')) help = '轉職書用於原有路線重選流程；本頁不直接消耗。';
      let giftInfo = '';
      if (gift && state.gift) giftInfo = '<section class="si-compare"><h4>四世星輝匣</h4><p>正式輪迴 ' + fmt(state.gift.completed) + ' 世 · 可領 ' + fmt(state.gift.claimable) + ' 匣 · 持有 ' + fmt(state.gift.unopened) + ' 匣</p><ul>' + (state.gift.pool || []).map(row => '<li>' + fmt(row.chance) + '%：' + Object.entries(row.items || {}).map(([id,qty]) => esc(itemMeta(id).name) + ' ×' + fmt(qty)).join('、') + '</li>').join('') + '</ul>' + (state.gift.claimable > 0 ? '<p class="si-muted">尚未領取的匣子請由原有命運贈禮流程領取。</p>' : '') + '</section>';
      return '<section class="si-detail" data-inv-detail="' + esc(item.id) + '"><div class="si-detail-hero">' + icon(item) + '<div><p class="si-eyebrow">' + (item.group === 'materials' ? '材料' : '道具') + '</p><h3>' + esc(item.name) + '</h3><p>目前持有 <b>' + fmt(item.quantity) + '</b></p></div></div><p>' + esc(item.desc || '此物品的詳細用途尚未提供。') + '</p>' + (help ? '<p class="si-muted">' + esc(help) + '</p>' : '') + '<p class="si-muted">' + (canTrade === true ? '可交易道具；交易須透過既有交易流程。' : canTrade === false || item.origin !== 'inventory' ? '此物品不可透過玩家交易轉移。' : '交易狀態尚未載入。') + '</p>' + giftInfo + '<div class="si-actions">' + actions + actionButton('navigate','回到背包',{route:'inventory'}) + '</div></section>';
    }
    function detailView() {
      const id = String(options.itemId || ''), equipment = itemById(id);
      if (equipment) return equipmentDetail(equipment);
      const item = materials().find(x => x.id === id);
      return item ? inventoryDetail(item) : '<section class="si-empty" data-inv-missing>這件物品已不在目前角色的背包，或尚未成功讀取。' + actionButton('navigate','查看背包',{route:'inventory'}) + '</section>';
    }
    function confirmView() {
      const c = state.confirm;
      if (!c) return '';
      return '<section class="si-confirm" role="region" aria-labelledby="si-confirm-title" data-inv-confirm><p class="si-eyebrow">操作前確認</p><h3 id="si-confirm-title">' + esc(c.title) + '</h3><p>' + esc(c.message) + '</p>' +
        (c.items?.length ? '<ul class="si-confirm-items">' + c.items.map(e => '<li><span>' + esc(title(e)) + (isPrecious(e) ? ' <b class="si-valuable">珍貴裝備</b>' : '') + '</span>' + (c.sale ? '<strong>' + fmt(e.sellPrice) + ' 金幣</strong>' : '') + '</li>').join('') + '</ul>' : '') +
        (c.sale ? '<p><b>共 ' + c.items.length + ' 件，取得 ' + fmt(c.items.reduce((sum,e) => sum + Number(e.sellPrice),0)) + ' 金幣。</b>出售後會移除裝備，無法復原。</p>' : '') +
        (c.highValue ? '<label class="si-risk"><input type="checkbox" name="inventoryPreciousAck"' + (c.ack ? ' checked' : '') + '>我已核對珍貴裝備與強化／塔印／銘刻，確認永久出售。</label>' : '') +
        '<div class="si-actions">' + actionButton('confirm',state.busy ? '處理中…' : c.label,{disabled:locked() || !!(c.highValue && !c.ack),kind:c.sale ? 'si-danger' : 'si-primary'}) + actionButton('cancel','取消',{disabled:state.busy}) + '</div></section>';
    }
    function render() {
      if (!live() || composing) return;
      const active = root.ownerDocument?.activeElement, focusName = root.contains?.(active) ? active?.name : null;
      const focusItemId = focusName ? active?.dataset?.itemId : undefined;
      const selection = focusName && typeof active.selectionStart === 'number' ? [active.selectionStart,active.selectionEnd] : null;
      const scroll = root.scrollTop || 0;
      root.innerHTML = '<div class="si-panel" data-inv-mode="' + mode + '" aria-busy="' + (state.loading || state.busy) + '">' + header() + notices() + (state.loading && !state.me ? '<p class="si-empty" role="status">正在讀取持有物品…</p>' : state.me ? (state.confirm ? confirmView() : mode === 'item' ? detailView() : listView()) : '<p class="si-empty">無法取得背包資料，請重新整理。</p>') + '</div>';
      root.scrollTop = scroll;
      const filters=root.querySelector('[data-inv-filters]');if(filters)filters.ontoggle=()=>{draft.filtersOpen=filters.open;};
      if (focusName && !state.busy) {
        const controls = root.querySelectorAll('[name="' + focusName + '"]');
        const next = focusItemId === undefined ? controls[0] : [...controls].find(control => control.dataset.itemId === focusItemId);
        next?.focus?.({preventScroll:true});
        if (selection) { try { next?.setSelectionRange?.(...selection); } catch {} }
      }
    }
    function acceptMe(data) {
      validResponse(data);
      if (!data.character || !Array.isArray(data.equipment) || !data.inventory) throw new Error('背包資料未完整載入，請重新整理');
      if (state.me && Number(data.character.revision) < Number(state.me.character.revision)) return false;
      state.me = data; state.stale = false;
      if (state.confirm?.items?.some(item => token(itemById(item.id)) !== token(item))) {
        state.confirm = null; state.notice = '裝備資料已更新，請重新預覽後確認操作。';
      }
      return true;
    }
    async function load({initial=false} = {}) {
      if (!live() || state.busy) return false;
      const ticket = ++generation;
      readController?.abort();
      readController = new AbortController();
      state.loading = true; state.error = '';
      render();
      const signal = readController.signal;
      // /me can settle legacy idle and its session request awaits a scene refresh.
      // Finish that operation before requesting material projections with newer tickets.
      let playerResult;
      try { playerResult = {status:'fulfilled',value:await host.request('me',{}, {signal})}; }
      catch (reason) { playerResult = {status:'rejected',reason}; }
      if (!live() || ticket !== generation) return false;
      const reads = ['me','meta','atlas/status','atlas/catalog','equipment-recovery'];
      if (mode === 'item' && options.itemId === 'fate_cycle_gift') reads.push('fate/gifts/summary');
      async function readAuxiliary(action) {
        try { return await host.request(action,{}, {signal}); }
        catch (error) {
          if (action === 'atlas/status' && error?.code === 'stale_response' && live() && ticket === generation && !signal.aborted) {
            return host.request(action,{}, {signal});
          }
          throw error;
        }
      }
      const results = [playerResult,...await Promise.allSettled(reads.slice(1).map(readAuxiliary))];
      if (!live() || ticket !== generation) return false;
      state.warnings = [];
      let ok = false;
      for (let i = 0; i < reads.length; i++) {
        const action = reads[i], result = results[i];
        try {
          if (result.status !== 'fulfilled') throw result.reason;
          const data = validResponse(result.value);
          if (action === 'me') { ok = acceptMe(data); }
          else if (action === 'meta') state.meta = data.meta || data;
          else if (action === 'atlas/status') state.atlas = data;
          else if (action === 'atlas/catalog') state.catalog = data.catalog || data;
          else if (action === 'equipment-recovery') state.recovery = data;
          else state.gift = data;
        } catch (error) {
          if (error?.code === 'context_changed') { state.stale = true; continue; }
          if (action === 'me') { state.stale = true; state.error = error?.message || '背包讀取失敗'; }
          else state.warnings.push(({meta:'物品說明', 'atlas/status':'星圖持有材料','atlas/catalog':'星圖材料名稱','equipment-recovery':'精煉持有材料','fate/gifts/summary':'星輝匣明細'})[action] + '暫時未同步');
        }
      }
      state.loading = false;
      if (initial && currentPending()) state.notice = '已保留上次尚未確認的操作，請先核對結果。';
      render();
      return ok;
    }
    async function prepare(kind, ids) {
      if (locked() || !live()) return;
      state.confirm = null; state.notice = '';
      const loaded = await load();
      if (!loaded || !live()) return;
      const list = ids.map(itemById);
      if (list.some(x => !x)) { state.error = '選取的裝備已變動，請重新選擇。'; render(); return; }
      const sale = kind === 'sell';
      const reason = list.map(e => sale ? sellBlock(e) : equipBlock(e)).find(Boolean);
      if (reason) { state.error = reason; render(); return; }
      if (sale && (!list.length || list.length > MAX_SELL)) { state.error = '每次可出售 1 至 100 件裝備。'; render(); return; }
      const item = list[0];
      state.confirm = {
        kind, sale, items:list.map(e => JSON.parse(token(e))), highValue:sale && list.some(isPrecious), ack:false,
        action:sale ? list.length === 1 ? 'sell-gear' : 'sell-gear-batch' : kind,
        body:sale ? list.length === 1 ? {itemId:item.id,requestId:requestId()} : {itemIds:list.map(e=>e.id),requestId:requestId()} : {itemId:item.id,...(kind === 'equip' ? {position:MULTI.has(item.slot) ? Number(draft.position) === 2 ? 2 : 1 : 1} : {})},
        title:sale ? '確認出售裝備' : kind === 'equip' ? '確認穿戴' : '確認卸下',
        label:sale ? '確認永久出售' : kind === 'equip' ? '確認穿戴' : '確認卸下',
        message:sale ? '以下價格與裝備狀態來自剛讀取的背包。珍貴裝備需要另外勾選確認。' : (kind === 'equip' && !item.bound ? '穿戴後這件裝備會綁定。' : '') + '正在進行的出征仍沿用出發快照，之後新戰鬥才使用這次配置。',
      };
      render();
    }
    async function prepareUse(id) {
      if (locked() || !live()) return;
      if (!(id === 'gacha_weapon' || id === 'gacha_armor' || id === 'fate_cycle_gift')) return;
      if (!await load() || !live()) return;
      if (!(Number(state.me.inventory[id]) > 0)) { state.error = '目前沒有可開啟的道具。'; render(); return; }
      const gift = id === 'fate_cycle_gift';
      state.confirm = {kind:'use',action:gift ? 'fate/gifts/open' : 'gacha/open',body:{...(gift ? {} : {type:id === 'gacha_weapon' ? 'weapon' : 'armor'}),requestId:requestId()},receipt:gift,title:'開啟 ' + itemMeta(id).name,label:'確認開啟 1 個',message:'消耗 1 個「' + itemMeta(id).name + '」。' + (gift && state.gift?.pool?.length ? '獎勵機率：' + state.gift.pool.map(row => fmt(row.chance) + '% ' + Object.entries(row.items || {}).map(([key,qty]) => itemMeta(key).name + ' ×' + fmt(qty)).join('、')).join('；') + '。' : itemMeta(id).desc || '依目前角色的等級與職業取得 1 件裝備。')};
      render();
    }
    function resultText(operation, data) {
      const result = data.result || {};
      if (operation.action.startsWith('sell-gear')) return '出售完成，取得 ' + fmt(result.gold) + ' 金幣。';
      if (operation.action === 'equip') return '已完成穿戴；當趟出征仍使用出發快照。';
      if (operation.action === 'unequip') return '已卸下裝備；當趟出征仍使用出發快照。';
      if (result.item) return '已開啟，獲得「' + title(result.item) + '」。';
      if (result.items) return '已開啟，獲得 ' + Object.entries(result.items).map(([id,n]) => itemMeta(id).name + ' ×' + fmt(n)).join('、') + '。';
      return '操作完成。';
    }
    async function execute(operation) {
      if (!live() || state.busy || state.loading) return;
      const existing = currentPending();
      if (existing && (existing.id !== operation.id || !existing.receipt)) return;
      const record = rememberPending(existing || operation);
      state.busy = true; state.error = '';
      state.confirm = null; render();
      try {
        const data = await host.request(record.action, record.body);
        if (!live()) return;
        validResponse(data);
        if (!Object.hasOwn(data,'result')) throw Object.assign(new Error('尚未收到完整操作收據'),{uncertain:true});
        clearPending(record);
        if (data.character && data.equipment) acceptMe(data);
        if (operation.action.startsWith('sell-gear')) {
          const sold = new Set(operation.body.itemIds || [operation.body.itemId]);
          draft.selected = draft.selected.filter(id => !sold.has(id));
        }
        state.notice = resultText(operation,data);
        try { Promise.resolve(host.onChanged?.(data)).catch(() => {}); } catch {}
        state.busy = false;
        const synchronized = await load();
        if (!live()) return;
        if (!synchronized) state.error = '操作已完成，最新背包暫時未同步。請重新整理，不必重做操作。';
      } catch (error) {
        if (!live()) return;
        if (error?.code === 'context_changed' || error?.code === 'stale_response') {
          state.error = '操作回應已過期，請重新讀取並確認持有物品。';
        } else if (error?.uncertain === false) {
          clearPending(record);
          state.error = error.message || '操作未完成，請重新整理。';
        } else {
          state.error = '未收到完整操作結果，已停止後續操作並讀回最新背包。';
        }
        const message = state.error;
        state.busy = false;
        await load();
        if (live()) state.error = message;
      } finally {
        if (live()) { state.busy = false; render(); }
      }
    }
    async function click(event) {
      const button = event.target?.closest?.('[data-inv-action]');
      if (!button || !root.contains(button) || button.disabled || !live()) return;
      const action = button.dataset.invAction, id = button.dataset.itemId;
      if (action === 'refresh') { if (!state.busy) await load(); return; }
      if (action === 'cancel') { if (!state.busy) {state.confirm=null;render();} return; }
      if (action === 'recover') { const pending = currentPending();if (pending?.receipt && !state.loading && !state.busy) await execute(pending);return; }
      if (action === 'acknowledge') { const pending=currentPending();if (pending&&!pending.receipt&&!lockedExceptPending()) {clearPending(pending);state.error='';state.notice='已結束待確認狀態；如需再次操作，請重新預覽。';render();}return; }
      if (state.busy) return;
      if (action === 'navigate') { navigate(button.dataset.route,{...(id ? {itemId:id} : {}),...(button.dataset.tab ? {tab:button.dataset.tab} : {})}); return; }
      if (action === 'detail') { navigate('item',{itemId:id}); return; }
      if (action === 'slot-filter') { draft.category='equipment';draft.slot=button.dataset.slot;render();return; }
      if (locked()) return;
      if (action === 'select-visible') {
        const ids = filteredRows().filter(r => r.group === 'equipment' && safeToSelect(r) && !isPrecious(r)).map(r=>String(r.id));
        draft.selected = [...new Set([...draft.selected,...ids])].slice(0,MAX_SELL);
        state.notice = '已選取一般裝備；珍貴裝備需自行勾選。每次最多 ' + MAX_SELL + ' 件。';render();
      } else if (action === 'clear-selection') { draft.selected=[];render(); }
      else if (action === 'preview-batch') await prepare('sell',[...draft.selected]);
      else if (action === 'preview-sell') await prepare('sell',[id]);
      else if (action === 'preview-equip') await prepare('equip',[id]);
      else if (action === 'preview-unequip') await prepare('unequip',[id]);
      else if (action === 'preview-use') await prepareUse(id);
      else if (action === 'confirm' && state.confirm && (!state.confirm.highValue || state.confirm.ack)) {
        const operation = state.confirm;
        if (operation.items?.some(item => token(itemById(item.id)) !== token(item))) {state.confirm=null;state.error='裝備已變更，請重新預覽。';render();return;}
        await execute(operation);
      }
    }
    const lockedExceptPending = () => state.loading || state.busy || state.stale;
    function input(event) {
      if (!live()) return;
      const target = event.target, name = target?.name;
      if (name === 'inventorySearch') { draft.query=String(target.value).slice(0,100);if (event.isComposing) composing=true;if (!composing) render(); }
    }
    function compositionStart(event) {
      if (live() && event.target?.name === 'inventorySearch') composing = true;
    }
    function compositionEnd(event) {
      if (!live() || event.target?.name !== 'inventorySearch') return;
      draft.query = String(event.target.value).slice(0,100);
      composing = false;
      render();
    }
    function change(event) {
      if (!live()) return;
      const target = event.target, name = target?.name;
      const fields = {inventoryCategory:'category',inventorySlot:'slot',inventoryRarity:'rarity',inventoryAvailability:'availability',inventoryPosition:'position'};
      if (fields[name]) {
        draft[fields[name]] = name === 'inventoryPosition' ? Number(target.value) === 2 ? 2 : 1 : target.value;
        if (name === 'inventoryCategory' && !['all','equipment'].includes(target.value)) {draft.slot='all';draft.rarity='all';draft.availability='all';}
        render();
      } else if (name === 'inventorySelected' && !locked()) {
        const id = String(target.dataset.itemId), item = itemById(id);
        if (!item || !safeToSelect(item)) return;
        if (target.checked && !draft.selected.includes(id)) {
          if (draft.selected.length >= MAX_SELL) state.error = '每次最多選取 ' + MAX_SELL + ' 件。';
          else draft.selected.push(id);
        } else if (!target.checked) draft.selected = draft.selected.filter(x=>x!==id);
        render();
      } else if (name === 'inventoryPreciousAck' && state.confirm && !state.busy) {state.confirm.ack=!!target.checked;render();}
    }
    const scroll = () => { if(live()) draft.scrollTop=root.scrollTop || 0; };
    root.addEventListener('click',click);
    root.addEventListener('input',input);
    root.addEventListener('compositionstart',compositionStart);
    root.addEventListener('compositionend',compositionEnd);
    root.addEventListener('change',change);
    root.addEventListener('scroll',scroll,{passive:true});
    render();
    root.scrollTop=Number(draft.scrollTop)||0;
    void load({initial:true});
    return {
      update(data) {
        if (!live() || state.busy) return;
        const value = data?.me || data;
        if (value?.character && Array.isArray(value.equipment) && value.inventory) {
          try { acceptMe(value); } catch { return; }
        }
        render();
      },
      handleBack() {
        if (!live()) return false;
        if (state.busy) return true;
        if (state.confirm) {state.confirm=null;render();return true;}
        return false;
      },
      dispose() {
        if (disposed) return;
        if (live()) draft.scrollTop=root.scrollTop || 0;
        disposed=true;composing=false;generation++;readController?.abort();
        root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('compositionstart',compositionStart);root.removeEventListener('compositionend',compositionEnd);root.removeEventListener('change',change);root.removeEventListener('scroll',scroll);
      }
    };
  }
  globalThis.RpgSceneInventory = Object.freeze({mount});
})();
