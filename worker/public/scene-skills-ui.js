/* Skills/career content for the unified scene window.
 * Public selectors: data-sc-action=refresh|detail|learn|equip|remove|move-left|move-right|
 * auto|settings|cast|cancel-cast|recycle|redeem|advance|reselect|confirm|cancel|acknowledge|list|navigate.
 * Identity selectors: data-skill-id, data-branch, data-tier. Regions: data-sc-confirm,
 * data-sc-pending, data-sc-tab, data-sc-detail, data-sc-ready. Recovery refresh is read-only.
 * Forms: name=skillSearch|skillScope|skillFilter|recycleQuantity|skillMode|skillBudget|skillAuto (with data-skill-id).
 * Loadout add=equip/remove/clear-loadout/move-left/move-right; auto select then auto button.
 * settings submits only mode/budget; supplies navigation remains separate. Confirm/cancel stay in one dialog.
 */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-TW', {maximumFractionDigits:2}) : '—';
  const clone = value => JSON.parse(JSON.stringify(value));
  const scopeKey = c => JSON.stringify(['accountId','realmId','characterId','epoch'].map(k => String(c?.[k] ?? '')));
  const identityKey = c => JSON.stringify(['accountId','realmId','characterId'].map(k => String(c?.[k] ?? '')));
  const MODES = {manual:'只手動',ready:'冷卻完成',elite:'菁英巡獵',lowHp:'低血量'};
  const MANUAL_ONLY = new Set(['skill_17_2','skill_24_2']);
  const BOOK_BASE = {技術書:'sword',精靈水晶:'archer',魔法書:'mage'};
  const SKILL_ICON_ROOT = '/expedition/assets/skills-painted-20261011/';
  const researchCost = s => Number.isInteger(s?.researchCost) && s.researchCost >= 0 ? s.researchCost : null;
  const pendingMemory = new Map();
  const sheets = new WeakMap();
  const scriptUrl = globalThis.document?.currentScript?.src;
  const allowedOps = new Set(['learn','recycle','loadout','auto','settings','cast','cancel','redeem']);
  function id() { return 'sc_' + (globalThis.crypto?.randomUUID?.().replaceAll('-','') || Date.now().toString(36) + Math.random().toString(36).slice(2,14)); }
  function validPending(p, scope) {
    return !!p && p.version === 1 && p.scope === scope && typeof p.id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(p.id)
      && ['expedition/action','advance','reselect'].includes(p.action) && p.body?.requestId === p.id
      && (p.action !== 'expedition/action' || allowedOps.has(p.body.op)) && typeof p.label === 'string';
  }
  function ensureStyle(root) {
    const doc = root.ownerDocument;
    if (!doc?.createElement || !doc.head || sheets.has(doc)) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = scriptUrl ? new URL('scene-skills-ui.css?v=20261112',scriptUrl).href : 'scene-skills-ui.css?v=20261112';
    link.onerror = () => { sheets.delete(doc);link.remove?.(); };
    doc.head.appendChild(link);sheets.set(doc,link);
  }
  // Character portrait catalog (already loaded by the scene for sprites); read-only, fetched once.
  let portraitIndex = null, portraitLoad = null;
  function portraitCatalog(onReady) {
    if (portraitIndex) return portraitIndex;
    const sprites = globalThis.CharacterSprites;
    if (!portraitLoad && typeof sprites?.catalog === 'function') {
      portraitLoad = Promise.resolve(sprites.catalog()).then(d => { portraitIndex = new Map((d?.actors || []).map(a => [a.id,a.portrait])); }).catch(() => { portraitLoad = null; });
    }
    if (portraitLoad && onReady && !portraitLoad.waiting) { portraitLoad.waiting = true;portraitLoad.then(() => onReady()); }
    return null;
  }
  // Hero sheets keep uneven transparent padding; fit the opaque silhouette to the art box.
  const silhouettes = new WeakMap();
  function fitOne(img) {
    const box = img.parentElement;if (!box || !img.naturalWidth) return;
    let b = silhouettes.get(img);
    if (b === undefined) {
      b = null;
      try {
        const w = 80, h = Math.max(1, Math.round(80 * img.naturalHeight / img.naturalWidth)), c = img.ownerDocument.createElement('canvas');c.width = w;c.height = h;
        const g = c.getContext('2d', {willReadFrequently:true});g.drawImage(img,0,0,w,h);const d = g.getImageData(0,0,w,h).data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x;if (x > x1) x1 = x;if (y < y0) y0 = y;if (y > y1) y1 = y; }
        if (x1 >= x0) b = {x:x0 / w,y:y0 / h,w:(x1 - x0 + 1) / w,h:(y1 - y0 + 1) / h};
      } catch { b = null; }
      silhouettes.set(img,b);
    }
    const W = box.clientWidth, H = box.clientHeight;if (!b || !W || !H) return;
    const nw = img.naturalWidth, nh = img.naturalHeight, s = Math.min(W * .92 / (b.w * nw), H * .94 / (b.h * nh));
    img.classList.add('sc-fit');
    Object.assign(img.style,{width:(nw * s).toFixed(1) + 'px',height:(nh * s).toFixed(1) + 'px',left:(W / 2 - (b.x + b.w / 2) * nw * s).toFixed(1) + 'px',top:(H * .97 - (b.y + b.h) * nh * s).toFixed(1) + 'px'});
  }
  function fitJobArt(root) {
    root.querySelectorAll?.('img[data-sc-fit]').forEach(img => { if (img.complete && img.naturalWidth) fitOne(img);else img.addEventListener('load',() => fitOne(img),{once:true}); });
  }
  function mount(root, host, options = {}) {
    ensureStyle(root);
    const tab = options.tab === 'career' ? 'career' : 'skills';
    const context = {...host.getContext?.()}, scope = scopeKey(context), identity = identityKey(context);
    const storage = host.storage || globalThis.sessionStorage, storageKey = 'rpg-sc-pending:' + identity;
    const draft = host.draft || {};
    draft.search = String(draft.search || '');
    draft.filter = ['all','learned','available','books'].includes(draft.filter) ? draft.filter : 'all';
    draft.scope = draft.scope === 'all' ? 'all' : 'mine';
    draft.selected = String(draft.selected || '');
    draft.quantity = String(draft.quantity || '1');
    const state = {data:null,loading:false,busy:false,stale:true,error:'',notice:'',confirm:null,revision:-1,minRevision:-1,checkedPending:null,focusConfirm:false};
    let disposed = false, generation = 0, controller = null, composing = false, deferredPaint = false;
    const current = () => !disposed && scopeKey(host.getContext?.()) === scope && host.current?.() !== false;
    function pending() {
      if (pendingMemory.has(identity)) return pendingMemory.get(identity);
      let p = null;
      try { const saved = JSON.parse(storage?.getItem?.(storageKey) || 'null');if (validPending(saved,identity)) p = saved; } catch {}
      pendingMemory.set(identity,p);return p;
    }
    function savePending(p) {
      pendingMemory.set(identity,p);
      try { if (p) storage?.setItem?.(storageKey,JSON.stringify(p));else storage?.removeItem?.(storageKey); } catch {}
    }
    function clearPending(expected) { if (pending()?.id === expected) savePending(null); }
    function feedback(message, error = false) {
      if (!current()) return;
      state[error ? 'error' : 'notice'] = message;paint();
    }
    const data = () => state.data;
    const skill = key => data()?.skills?.find(s => s.id === key);
    const learned = key => data()?.special?.learned?.includes(key);
    const eligible = key => data()?.eligible?.includes(key);
    const slotted = key => data()?.special?.loadout?.includes(key);
    const books = key => Number(data()?.inventory?.['book_' + key]) || 0;
    const now = () => (Number(data()?.now) || Date.now()) + Math.max(0,Date.now() - (state.receivedAt || Date.now()));
    const party = () => data()?.character?.partyId || data()?.career?.activity?.partyId;
    // Real running-ring membership is server-owned; party IDs do not encode this permission.
    // Until a projection supplies it, allow confirmation and use the service's atomic access check.
    const backpackBlocked = () => data()?.skillAccess?.canManageBackpack === false;
    const lock = () => state.busy || state.loading || state.stale || !!pending() || !!data()?.readOnly;
    const fingerprint = () => JSON.stringify([data()?.character,data()?.inventory,data()?.special,data()?.eligible,data()?.career,data()?.readOnly]);
    const button = (action,label,{skillId,branch,tier,route,disabled = false,primary = false,extra = ''} = {}) =>
      '<button type="button" data-sc-action="' + action + '"' +
      (skillId ? ' data-skill-id="' + esc(skillId) + '"' : '') +
      (branch ? ' data-branch="' + esc(branch) + '"' : '') +
      (tier != null ? ' data-tier="' + esc(tier) + '"' : '') +
      (route ? ' data-route="' + esc(route) + '"' : '') +
      (disabled ? ' disabled' : '') + (primary ? ' class="sc-primary"' : '') + extra + '>' + esc(label) + '</button>';
    function responseValid(result) {
      if (!result || result.ok === false || !result.character || !Array.isArray(result.skills) || !result.special || !Array.isArray(result.special.loadout) || !Array.isArray(result.special.learned) || !Array.isArray(result.eligible)) throw new Error('技能資料尚未完整，請重新整理');
      if (String(result.character.tgId) !== String(context.characterId) ||
          (result.characterId != null && String(result.characterId) !== String(context.characterId)) ||
          (result.realmId != null && String(result.realmId) !== String(context.realmId)) ||
          (result.accountId != null && String(result.accountId) !== String(context.accountId))) throw new Error('角色資料已切換，請重新開啟視窗');
      const revision = Number(result.character.revision);
      if (!Number.isFinite(revision) || revision < Math.max(state.revision,state.minRevision)) throw new Error('收到較早的角色資料，請重新整理');
      return revision;
    }
    async function refresh() {
      if (!current() || state.busy || state.loading) return false;
      const ticket = ++generation;
      controller?.abort();controller = new AbortController();
      state.loading = true;state.error = '';paint();
      try {
        const result = await host.request('skill-career',{}, {signal:controller.signal});
        if (!current() || ticket !== generation) return false;
        const revision = responseValid(result), before = fingerprint();
        state.data = clone(result);state.revision = revision;state.receivedAt = Date.now();state.stale = false;
        state.checkedPending = pending()?.id || null;
        if (state.confirm && before !== fingerprint()) { state.confirm = null;state.notice = '角色或持有量已更新，請重新選擇操作。'; }
        return true;
      } catch (error) {
        if (!current() || ticket !== generation) return false;
        state.stale = true;state.checkedPending = null;
        state.error = error?.message || '暫時無法讀取技能與轉職資料';return false;
      } finally {
        if (current() && ticket === generation) { state.loading = false;paint(); }
      }
    }
    function readiness() {
      if (!data()) return '正在讀取角色資料';
      if (data().readOnly) return data().readOnlyReason || '這個世界目前只能查看資料';
      if (pending()) return '請先核對上次操作結果';
      if (state.stale) return '請先重新整理資料';
      if (state.loading || state.busy) return '正在處理上一個操作';
      return null;
    }
    function prepare(action, body, label, details) {
      const reason = readiness();if (reason) return feedback(reason,true);
      state.error = '';state.confirm = {action,body:clone(body),label,details,fingerprint:fingerprint(),...(action === 'advance' && state.jobPick ? {job:state.jobPick} : {})};state.jobPick = null;state.focusConfirm = true;paint();
    }
    function describeWrite(action, body) {
      const s = skill(body.skillId), m = s?.mastery;
      if (action === 'advance') return '轉職已完成';
      if (action === 'reselect') return '職業路線已重新選擇';
      return ({learn:m?.level ? '技能進修已完成' : '技能學習已完成',recycle:'技能書回收已完成',redeem:'技能書兌換已完成',loadout:'三格技能配置已更新',auto:'自動施放條件已更新',settings:'自動補水策略已更新',cast:'技能已排入下一次有效掛機戰鬥',cancel:'已取消等待施放'})[body.op] || '操作已完成';
    }
    async function submit() {
      if (!current() || !state.confirm || readiness()) return;
      const preview = state.confirm;
      if (preview.fingerprint !== fingerprint()) { state.confirm = null;return feedback('資料已更新，請重新確認這次操作。',true); }
      const requestId = id(), body = {...preview.body,requestId};
      const record = {version:1,scope:identity,id:requestId,action:preview.action,body,label:preview.label};
      savePending(record);
      state.confirm = null;state.busy = true;state.checkedPending = null;state.error = '';state.notice = '';generation++;controller?.abort();paint();
      let acknowledged = false;
      try {
        const result = await host.request(preview.action,body);
        if (!current()) return;
        if (!result || result.ok === false || result.result == null) throw Object.assign(new Error('未收到完整操作收據，請核對最新狀態'),{uncertain:true});
        if (result.character?.tgId != null && String(result.character.tgId) !== String(context.characterId)) throw Object.assign(new Error('角色資料已切換，操作結果待核對'),{uncertain:true});
        clearPending(requestId);acknowledged = true;
        if (body.op === 'loadout') for (const key of Object.keys(draft)) { if (key.startsWith('auto:') && !body.loadout.includes(key.slice(5))) delete draft[key]; }
        if (body.op === 'auto') delete draft['auto:' + body.skillId];
        if (body.op === 'settings') { delete draft.skillMode;delete draft.skillBudget; }
        if (preview.action === 'advance' && preview.job) draft.jobResult = preview.job;
        state.notice = describeWrite(preview.action,body);state.stale = true;
        if (Number.isFinite(Number(result.character?.revision))) state.minRevision = Math.max(state.minRevision,Number(result.character.revision));
        try { host.onChanged?.(result); } catch {}
      } catch (error) {
        if (!current()) return;
        const status = Number(error?.status), uncertain = error?.uncertain || !Number.isInteger(status) || status >= 500 || status < 400 || /duplicate|request_id|character_changed|stale|context/i.test(String(error?.code || ''));
        if (!uncertain) clearPending(requestId);
        state.stale = true;
        state.error = uncertain ? '操作結果待確認。請讀取最新狀態後核對；不會再次送出這筆操作。' : (error?.message || '操作未完成，請重新確認條件');
      } finally {
        if (current()) {
          state.busy = false;paint();
          if (acknowledged || !pending()) await refresh();
        }
      }
    }
    function skillRows() {
      const q = draft.search.trim().normalize('NFKC').toLocaleLowerCase('zh-TW');
      return (data()?.skills || []).filter(s => {
        if (draft.scope !== 'all' && (s.eligibleBase || BOOK_BASE[s.bookType]) !== data()?.character?.baseClass) return false;
        if (draft.filter === 'learned' && !learned(s.id)) return false;
        if (draft.filter === 'available' && !eligible(s.id)) return false;
        if (draft.filter === 'books' && !books(s.id)) return false;
        return !q || [s.name,s.id,s.bookType,s.rarity,s.effect,s.eligibleJob].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase('zh-TW').includes(q);
      });
    }
    function skillEffect(s) {
      const damage = Number(s.damage);
      return [typeof s.damage === 'string' ? s.damage : Number.isFinite(damage) && damage > 0 ? '技能倍率 ' + fmt(damage) + '×' : '',s.effect || ''].filter(Boolean).join(' · ');
    }
    // Painted skill art (same files as classic special-skill-widgets.js); hidden if an image fails.
    function skillArt(s, size = '') {
      const id = String(s?.id || '');
      if (!/^skill_(?:\d{2}_\d|thief_\d{2})$/.test(id)) return '';
      return '<img class="sc-skill-art' + (size ? ' sc-skill-art-' + size : '') + '" src="' + SKILL_ICON_ROOT + id + '.webp" alt="" loading="lazy" decoding="async" draggable="false">';
    }
    function cooldown(s) { return Math.max(0,Math.ceil(((Number(data()?.special?.cooldowns?.[s.id]) || 0) - now()) / 1000)); }
    function castReason(s) {
      if (party()) return '組隊中請由原冒險操作技能';
      if (MANUAL_ONLY.has(s.id)) return '此技能需在組隊冒險使用';
      if (!learned(s.id) || !eligible(s.id) || !slotted(s.id)) return '請先學會並配置此技能';
      if (data()?.special?.pending) return '已有技能等待施放';
      const cd = cooldown(s);if (cd) return '冷卻剩餘 ' + fmt(cd) + ' 秒';
      if ((Number(data()?.character?.mp) || 0) < Number(s.mp)) return '魔力不足';
      return '';
    }
    function slots() {
      const ids = data()?.special?.loadout || [], blocked = lock() || backpackBlocked(), invalidCount = ids.filter(key => !eligible(key)).length;
      return '<section class="sc-section"><h3>特殊技能配置</h3><p class="sc-muted">三格技能依序判斷施放。手動技能會等待下一次有效掛機戰鬥。</p><div class="sc-slots">' +
        [0,1,2].map(i => {
          const s = skill(ids[i]);
          if (!s) return '<article class="sc-slot sc-empty"><b>第 ' + (i + 1) + ' 格</b><span>從下方選擇已學會的技能</span></article>';
          const reason = castReason(s), qualified = eligible(s.id), mode = draft['auto:' + s.id] || data().special.auto?.[s.id] || 'manual';
          return '<article class="sc-slot" data-sc-slot="' + i + '"><div class="sc-skill-head">' + skillArt(s) + '<div><strong>' + esc(s.name) + '</strong><small>魔力 ' + fmt(s.mp) + ' · 冷卻 ' + fmt(s.cooldownSeconds) + ' 秒</small></div></div>' + (skillEffect(s) ? '<p class="sc-effect">' + esc(skillEffect(s)) + '</p>' : '') + (!qualified ? '<p class="sc-error" data-sc-ineligible>目前職業無法施放；可移除此技能。</p>' : '') + '<div class="sc-actions">' +
            button('detail','查看',{skillId:s.id}) + button('remove','移除',{skillId:s.id,disabled:blocked}) +
            button('move-left','前移',{skillId:s.id,disabled:blocked || !qualified || i === 0}) + button('move-right','後移',{skillId:s.id,disabled:blocked || !qualified || i === ids.length - 1}) + '</div>' +
            '<label>自動施放<select name="skillAuto" data-skill-id="' + esc(s.id) + '"' + (blocked || !qualified ? ' disabled' : '') + '>' +
            Object.entries(MODES).filter(([key]) => key === 'manual' || !MANUAL_ONLY.has(s.id)).map(([key,label]) => '<option value="' + key + '"' + (key === mode ? ' selected' : '') + '>' + label + '</option>').join('') +
            '</select></label>' + (mode !== (data().special.auto?.[s.id] || 'manual') ? '<small class="sc-muted">選擇尚未套用</small>' : '') + button('auto','套用條件',{skillId:s.id,disabled:blocked || !qualified}) +
            button('cast',data().special.pending === s.id ? '等待戰鬥' : '手動施放',{skillId:s.id,disabled:lock() || !!reason}) +
            (reason ? '<small class="sc-muted">' + esc(reason) + '</small>' : '') + '</article>';
        }).join('') + '</div>' +
        (ids.length ? button('clear-loadout','清空配置',{disabled:blocked}) : '') +
        (invalidCount > 1 ? '<p class="sc-muted">多個技能已失去資格，可先清空配置，再重新加入可用技能。</p>' : '') +
        (data()?.special?.pending ? '<p class="sc-muted">等待施放：' + esc(skill(data().special.pending)?.name || data().special.pending) + '</p>' + button('cancel-cast','取消等待施放',{disabled:lock() || !!party()}) : '') + '</section>';
    }
    function settingsView() {
      const mode = draft.skillMode || data()?.special?.mode || 'safe';
      const budget = draft.skillBudget ?? String(data()?.special?.budget ?? 0);
      const blocked = lock() || backpackBlocked();
      return '<section class="sc-section" data-sc-settings><h3>自動補水策略</h3><p class="sc-muted">安全模式僅使用現有魔力。強力模式會耗用背包藍水，按藥水售價計入每日預算。預算 0 停用此項額外補水；喝水門檻在補給設定中調整。</p><div class="sc-filters">' +
        '<label>補水策略<select name="skillMode"' + (blocked ? ' disabled' : '') + '><option value="safe"' + (mode === 'safe' ? ' selected' : '') + '>安全補水</option><option value="strong"' + (mode === 'strong' ? ' selected' : '') + '>強力補水</option></select></label>' +
        '<label>每日藍水預算<input name="skillBudget" type="number" min="0" max="50000" step="1" inputmode="numeric" value="' + esc(budget) + '"' + (blocked ? ' disabled' : '') + '></label></div>' +
        button('settings','儲存補水策略',{disabled:blocked}) + '<p class="sc-muted">目前設定：' + (data()?.special?.mode === 'strong' ? '強力補水' : '安全補水') + ' · 每日 ' + fmt(data()?.special?.budget || 0) + ' 金幣。</p></section>';
    }
    function detail() {
      const s = skill(draft.selected);if (!s) return '';
      const m = s.mastery || {}, level = Number(m.level) || 0, cost = Number(m.nextCost), own = books(s.id);
      const research = Number(data()?.inventory?.research_fragment) || 0;
      const redeemCost = researchCost(s);
      const busy = lock() || backpackBlocked();
      const eligibleText = eligible(s.id) ? '符合目前職業與等級' : '目前職業或等級未達需求';
      return '<section class="sc-detail" data-sc-detail="' + esc(s.id) + '" aria-labelledby="sc-skill-title">' +
        button('list','返回技能清單') + '<div class="sc-skill-head">' + skillArt(s,'large') + '<h3 id="sc-skill-title">' + esc(s.name) + '</h3></div><p>' + esc(s.eligibleJob || '') + (s.bookType ? ' · ' + esc(s.bookType) : '') + ' · ' + esc(s.rarity || '') + ' · 需求 Lv.' + fmt(s.level) + ' · ' + esc(eligibleText) + '</p>' +
        '<dl class="sc-facts"><div><dt>技能等級</dt><dd>' + level + '／' + fmt(m.max || 10) + '</dd></div><div><dt>技能書</dt><dd>' + own + ' 本</dd></div><div><dt>魔力</dt><dd>' + fmt(s.mp) + '</dd></div><div><dt>冷卻</dt><dd>' + fmt(s.cooldownSeconds) + ' 秒</dd></div></dl>' +
        '<p class="sc-effect">' + esc(skillEffect(s)) + '</p><p class="sc-muted">技能進修加成：輸出 ' + fmt(m.outputPct || 0) + '% · 輔助 ' + fmt(m.utilityPct || 0) + '%</p>' +
        '<div class="sc-actions">' + button('learn',level ? '進修技能' : '學習技能',{skillId:s.id,primary:true,disabled:busy || !eligible(s.id) || m.nextCost == null || own < cost}) +
        button('equip',slotted(s.id) ? '已配置' : '加入三格配置',{skillId:s.id,disabled:busy || !learned(s.id) || !eligible(s.id) || slotted(s.id) || data().special.loadout.length >= 3}) + '</div>' +
        '<p class="sc-muted">' + (m.nextCost == null ? '已達技能最高等級' : (level ? '下一級' : '學習') + '需要 ' + fmt(cost) + ' 本技能書') + '</p>' +
        '<div class="sc-exchange"><label>回收技能書數量<input name="recycleQuantity" type="number" min="1" max="' + Math.min(999,own) + '" step="1" inputmode="numeric" value="' + esc(draft.quantity) + '"' + (busy ? ' disabled' : '') + '></label>' +
        button('recycle','回收技能書',{skillId:s.id,disabled:busy || own < 1}) + button('navigate','分享／交易技能書',{route:'book-tools',disabled:busy || own < 1}) +
        '<p class="sc-muted">每本回收 ' + fmt(m.recycleValue || 0) + ' 研究碎片；已學會的技能會保留。</p>' +
        button('redeem','兌換一本技能書',{skillId:s.id,disabled:busy || !eligible(s.id) || redeemCost == null || research < redeemCost}) +
        '<p class="sc-muted">' + (redeemCost == null ? '兌換費用尚未取得；目前持有 ' : '需要 ' + fmt(redeemCost) + ' 研究碎片，目前持有 ') + fmt(research) + '。</p></div></section>';
    }
    function skillsView() {
      if (!data()) return '';
      if (draft.selected && !skill(draft.selected)) draft.selected = '';
      const rows = skillRows();
      return '<p class="sc-muted">原版特殊技能用於掛機與原冒險。星圖戰鬥使用獨立構築；進行中的星圖沿用出發時快照。</p>' +
        '<div class="sc-actions">' + button('navigate','星圖構築',{route:'build'}) + button('navigate','天賦',{route:'talents'}) + button('navigate','補給設定',{route:'supplies'}) + '</div>' + slots() + settingsView() +
        (draft.selected ? detail() : '<section class="sc-section"><h3>技能傳承</h3><div class="sc-filters"><label>搜尋技能<input name="skillSearch" type="search" value="' + esc(draft.search) + '" placeholder="名稱、效果或技能書" autocomplete="off"></label>' +
          '<label>職業範圍<select name="skillScope"><option value="mine"' + (draft.scope === 'mine' ? ' selected' : '') + '>目前職業</option><option value="all"' + (draft.scope === 'all' ? ' selected' : '') + '>全部職業</option></select></label>' +
          '<label>持有狀態<select name="skillFilter">' + [['all','全部技能'],['learned','已學會'],['available','符合需求'],['books','持有技能書']].map(([key,label]) => '<option value="' + key + '"' + (draft.filter === key ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label></div>' +
          '<p class="sc-muted" aria-live="polite">' + rows.length + ' 個技能</p><div class="sc-skill-grid">' + rows.map(s =>
            '<article class="sc-card' + (learned(s.id) ? '' : ' sc-unlearned') + '"><div class="sc-skill-head">' + skillArt(s) + '<div><h4>' + esc(s.name) + '</h4><small>Lv.' + fmt(s.level) + ' · ' + esc(s.rarity || '') + ' · 魔力 ' + fmt(s.mp) + ' · 冷卻 ' + fmt(s.cooldownSeconds) + ' 秒</small></div></div><p class="sc-effect">' + esc(skillEffect(s)) + '</p><span>' +
            (learned(s.id) ? '已學會 Lv.' + fmt(s.mastery?.level || 1) : '尚未學會') + ' · 技能書 ' + books(s.id) + '</span>' +
            button('detail','查看技能',{skillId:s.id,extra:' aria-label="查看 ' + esc(s.name) + '"'}) + '</article>').join('') +
          (!rows.length ? '<p class="sc-muted">沒有符合篩選的技能。可調整搜尋或職業範圍。</p>' : '') + '</div></section>');
    }
    function careerIconKey(path) {
      const base = data()?.character?.baseClass || '';
      if (!/^(sword|archer|mage|thief)$/.test(base)) return '';
      const raw = String(path || '');
      if (!raw) return base;
      const head = raw[0], rest = raw.slice(1).replace(/A/g, '1').replace(/B/g, '2');
      const key = /^[AB]$/.test(head) && /^[12]{0,3}$/.test(rest) ? base + '_' + head + rest : '';
      return /^(sword|archer|mage|thief)(?:_[AB][12]{0,3})?$/.test(key) ? key : base;
    }
    function careerArt(s, path) {
      const src = String(s?.iconSrc || '');
      const url = /^\/art\/career-skill-icons-20261110\/(sword|archer|mage|thief)(?:_[AB][12]{0,3})?\.webp$/.test(src)
        ? src
        : (careerIconKey(path) ? '/art/career-skill-icons-20261110/' + careerIconKey(path) + '.webp' : '');
      if (!url) return '';
      return '<img class="sc-skill-art" src="' + url + '" alt="" loading="lazy" decoding="async" draggable="false">';
    }
    function careerSkill(s, path, compact = false) {
      if (!s) return '';
      const text = s.description || ('倍率 ' + fmt(s.mult) + '× · ' + fmt(s.targets || 1) + ' 個目標 · 魔力 ' + fmt(s.cost));
      return '<div class="sc-skill-head">' + careerArt(s, path) + '<div><strong>' + esc(s.name || '') + '</strong><small>' + (compact === 'name' ? '新路線原生技能' : '魔力 ' + fmt(s.cost) + ' · 倍率 ' + fmt(s.mult) + '× · ' + fmt(s.targets || 1) + ' 個目標') + '</small></div></div>' + (compact ? '' : '<p class="sc-effect">' + esc(text) + '</p>');
    }
    // Classic 轉職 flow restored inside the scene: ① 條件 → ② 選路線 → ③ 確認 → ④ 完成.
    // Same server data (skill-career) and the same advance/reselect writes; no timers.
    function portraitKey(path) {
      const ch = data()?.character || {}, cls = String(ch.baseClass || ''), g = ch.gender === 'm' ? 'm' : 'f', p = String(path || '');
      return p ? 'adv' + p.length + '_' + cls + '_' + p + '_' + g : cls + (g === 'm' ? '_m' : '');
    }
    function jobArt(path, name, extra = '') {
      const index = portraitCatalog(() => { if (current()) paint(); });
      const src = index?.get(portraitKey(path));
      return '<span class="sc-jc-art' + extra + '">' + (src ? '<img src="' + esc(src) + '" alt="' + esc(name) + '外觀" loading="lazy" decoding="async" draggable="false" data-sc-fit>' : '') + '</span>';
    }
    function skillStats(s, compare) {
      if (!s) return '';
      const delta = (a, b, unit = '') => compare && Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) !== Number(b) ? '<i class="' + (Number(b) > Number(a) ? 'sc-up' : 'sc-down') + '">' + fmt(a) + unit + ' → </i>' : '';
      return '<dl class="sc-jc-stats"><div><dt>耗魔</dt><dd>' + delta(compare?.cost, s.cost) + fmt(s.cost) + '</dd></div>' +
        '<div><dt>倍率</dt><dd>' + delta(compare?.mult, s.mult, '×') + fmt(s.mult) + '×</dd></div>' +
        '<div><dt>目標</dt><dd>' + delta(compare?.targets || 1, s.targets || 1) + fmt(s.targets || 1) + ' 體</dd></div></dl>';
    }
    function stepper(active, done) {
      const names = ['確認條件','選擇路線','確認轉職','轉職完成'];
      return '<ol class="sc-jc-steps" aria-label="轉職步驟">' + names.map((n, i) => '<li class="' + (i + 1 < active || done ? 'sc-done' : i + 1 === active ? 'sc-now' : '') + '"' + (i + 1 === active ? ' aria-current="step"' : '') + '><b>' + (i + 1 < active || done ? '✓' : i + 1) + '</b><span>' + n + '</span></li>').join('') + '</ol>';
    }
    function requirementRow(ok, label, value, note = '') {
      return '<li class="' + (ok ? 'sc-ok' : 'sc-miss') + '"><b aria-hidden="true">' + (ok ? '✓' : '✗') + '</b><span>' + esc(label) + '<strong>' + value + '</strong>' + (note ? '<small>' + note + '</small>' : '') + '</span></li>';
    }
    function careerView() {
      const c = data()?.career;
      if (!c) return '<p class="sc-muted">轉職資料尚未提供，請重新整理。</p>';
      const info = c.current, next = c.next, tiers = c.reselect?.tiers || [], ch = data().character || {}, level = Number(ch.level) || 0;
      const done = draft.jobResult && draft.jobResult.path === info.path ? draft.jobResult : null;
      const confirming = state.confirm?.action === 'advance';
      const active = done ? 4 : confirming ? 3 : next?.canAdvance ? 2 : 1;
      let html = '<section class="sc-jc-hero">' + jobArt(info.path, info.name, ' sc-jc-art-hero') + '<div><small>' + esc(info.baseClassName || '') + '系 · 第 ' + fmt(info.tier) + ' 階' + (info.path ? ' · 路線 ' + esc(info.path) : '') + '</small><h3>' + esc(info.name) + '</h3><p>Lv.' + fmt(level) + (info.weapon ? ' · ' + esc(info.weapon) : '') + '</p>' +
        (info.blurb ? '<p class="sc-muted">' + esc(info.blurb) + '</p>' : '') + careerSkill(info.skill, info.path, true) + (info.passive ? '<p class="sc-effect">路線被動：' + esc(info.passive) + '</p>' : '') + '</div></section>' +
        (c.activity?.atlasRunId ? '<p class="sc-muted">星圖正在進行；這次改職會影響下次出發，本趟戰鬥快照維持出發時配置。</p>' : '');
      if (done) {
        html += stepper(4, true) + '<section class="sc-jc-result" role="status"><h3>🎉 轉職成功：' + esc(done.name) + '</h3><p>路線 ' + esc(done.from || '初始') + ' → ' + esc(done.path) + '，新技能與被動已生效。</p><p class="sc-muted">技能、配置與天賦請到「技能」頁確認；之後可用命運轉職書重選路線。</p><div class="sc-actions">' +
          button('navigate','前往技能',{route:'skills'}) + button('job-ack','繼續查看轉職',{primary:true}) + '</div></section>';
      } else if (!next) {
        html += '<section class="sc-section"><h3>轉職進度</h3><p>已完成所有可用轉職階段。</p></section>';
      } else {
        const lvOk = level >= next.requiredLevel, m = next.material || {}, matOk = (m.have || 0) >= (m.required || 1);
        const pct = Math.max(0, Math.min(100, Math.round(level / Math.max(1, next.requiredLevel) * 100)));
        const other = next.reason && !['level','material'].includes(next.reason.code) ? next.reason.message : '';
        html += stepper(active, false) +
          '<section class="sc-jc-step" data-sc-step="1"><h3><b>1</b>第 ' + fmt(next.tier) + ' 次轉職條件</h3><ul class="sc-jc-req">' +
          requirementRow(lvOk,'等級','Lv.' + fmt(level) + ' / ' + fmt(next.requiredLevel),'<i class="sc-jc-bar"><i style="width:' + pct + '%"></i></i>') +
          requirementRow(matOk,'材料','「' + esc(m.name) + '」' + fmt(m.have) + ' / ' + fmt(m.required), m.source ? '取得：' + esc(m.source) : '') +
          (other ? requirementRow(false,'狀態',esc(other)) : '') + '</ul>' +
          (next.canAdvance ? '<p class="sc-jc-ready">✨ 條件都達成了，從下面選一條路線轉職！</p>' : next.reason ? '<p class="sc-muted" data-sc-advance-reason>' + esc(next.reason.message) + '</p>' : '') + '</section>' +
          '<section class="sc-jc-step" data-sc-step="2"><h3><b>2</b>選擇路線</h3><p class="sc-muted">兩條路線擇一；轉職後仍可用命運轉職書重選。</p><div class="sc-career-grid sc-jc-choices">' +
          next.choices.map(choice => '<article class="sc-card sc-jc-choice">' + jobArt(choice.path, choice.name) + '<h4>' + esc(choice.name) + ' <small>路線 ' + esc(choice.path) + '</small></h4>' +
            (choice.blurb ? '<p class="sc-jc-blurb">定位：' + esc(choice.blurb) + (choice.role ? ' · ' + esc(choice.role) : '') + '</p>' : '') +
            careerSkill(choice.skill, choice.path, 'name') + skillStats(choice.skill, info.skill) + (choice.skill?.description ? '<p class="sc-effect">' + esc(choice.skill.description) + '</p>' : '') +
            (choice.passive ? '<p>路線被動：' + esc(choice.passive) + '</p>' : '') + (choice.weapon ? '<p class="sc-muted">職業武器：' + esc(choice.weapon) + '</p>' : '') +
            (choice.effect ? '<p class="sc-muted">效果：' + esc(choice.effect) + '</p>' : '') + (choice.inheritance ? '<p class="sc-muted">' + esc(choice.inheritance) + '</p>' : '') +
            button('advance', next.canAdvance ? '選擇「' + choice.name + '」' : !lvOk ? '需要 Lv.' + next.requiredLevel : !matOk ? '缺「' + m.name + '」' : '暫不能轉職',{branch:choice.branch,tier:choice.tier,primary:true,disabled:lock() || !next.canAdvance}) + '</article>').join('') + '</div></section>';
      }
      const books = tiers.reduce((n, t) => n + (Number(t.book?.have) || 0), 0);
      html += '<details class="sc-section sc-jc-reselect"' + (draft.reselectOpen ? ' open' : '') + '><summary><b>📖 命運轉職書 · 重選已完成的路線</b><small>' + (tiers.length ? '持有 ' + fmt(books) + ' 本' : '完成轉職後開放') + '</small></summary>' +
        '<h3 class="sc-visually-hidden">重選職業路線</h3><p class="sc-muted">重選會保留後續分支，並依新路線重新計算最終職業。不符合路線的專屬裝備會自動卸下。</p>' +
        ((c.reselect?.cooldownRemainingMs || 0) > 0 ? '<p class="sc-muted">共用冷卻剩餘約 ' + Math.ceil(c.reselect.cooldownRemainingMs / 60000) + ' 分鐘。到期後重新整理可用狀態。</p>' : '') +
        tiers.map(t => !t.book?.id ? '<div class="sc-reselect-tier" data-sc-reselect-tier="' + t.tier + '"><h4>第 ' + fmt(t.tier) + ' 階重選</h4><p class="sc-muted">' + esc(t.choices?.find(choice => choice.reason)?.reason?.message || t.book?.name || '此階尚未開放重選') + '</p></div>' : '<div class="sc-reselect-tier" data-sc-reselect-tier="' + t.tier + '"><h4>第 ' + fmt(t.tier) + ' 階重選</h4><p>' + esc(t.book.name) + ' ' + fmt(t.book.have) + '／' + fmt(t.book.required) + '</p><div class="sc-career-grid">' +
          t.choices.map(choice => '<article class="sc-card' + (choice.selected ? ' sc-selected' : '') + '"><h4>' + esc(choice.branchName || choice.name) + (choice.selected ? ' · 目前分支' : '') + '</h4><p>最終職業：' + esc(choice.name) + ' · ' + esc(choice.path) + '</p>' + careerSkill(choice.skill, choice.path) +
            '<p>' + esc(choice.passive || '') + '</p>' + (choice.unequipped?.length ? '<p class="sc-muted">會卸下：' + choice.unequipped.map(item => esc(item.name)).join('、') + '</p>' : '') +
            (choice.reason && !choice.selected ? '<p class="sc-muted">' + esc(choice.reason.message) + '</p>' : '') +
            button('reselect',choice.selected ? '目前路線' : '重選為 ' + (choice.branchName || choice.name),{branch:choice.branch,tier:t.tier,disabled:lock() || !choice.canReselect || choice.selected}) + '</article>').join('') +
          '</div></div>').join('') + (!tiers.length ? '<p class="sc-muted">完成轉職後，可在這裡查看重選路線。</p>' : '') + '</details>' +
        '<div class="sc-actions sc-jc-links">' + button('navigate','查看完整成長樹',{route:'lineage'}) + '</div>';
      return html;
    }
    function notices() {
      let html = '';
      if (state.notice) html += '<p class="sc-feedback" role="status">' + esc(state.notice) + '</p>';
      if (state.error) html += '<p class="sc-feedback sc-error" role="alert">' + esc(state.error) + '</p>';
      if (data()?.readOnly) html += '<p class="sc-feedback">' + esc(data().readOnlyReason || '這個世界目前只能查看資料') + '</p>';
      if (tab === 'skills' && backpackBlocked()) html += '<p class="sc-muted">' + esc(data()?.skillAccess?.reason?.message || '目前冒險不允許調整技能，請完成冒險後再操作。') + '</p>';
      const p = pending();
      if (p) html += '<section class="sc-pending" data-sc-pending role="status"><strong>上次操作結果待確認</strong><p>' + esc(p.label) + '</p><p>請核對最新技能、材料與職業。持有量變化本身不能證明這筆操作的結果；不會自動再次送出。</p><div class="sc-actions">' +
        button('refresh','讀取最新狀態',{disabled:state.busy || state.loading}) +
        button('acknowledge','我已核對，結束待確認狀態',{disabled:state.busy || state.loading || state.stale || state.checkedPending !== p.id}) + '</div></section>';
      return html;
    }
    function confirmation() {
      const p = state.confirm;if (!p) return '';
      const job = p.action === 'advance' && p.job && tab === 'career' ? '<div class="sc-jc-confirm-art" aria-hidden="true">' + jobArt(data()?.career?.current?.path, data()?.career?.current?.name || '') + '<b>→</b>' + jobArt(p.job.path, p.job.name) + '</div><p class="sc-jc-step-tag"><b>3</b>確認轉職</p>' : '';
      return '<section class="sc-confirm' + (job ? ' sc-jc-confirm' : '') + '" data-sc-confirm role="region" aria-labelledby="sc-confirm-title">' + job + '<h3 id="sc-confirm-title">確認' + esc(p.label) + '</h3><p>' + esc(p.details) + '</p>' + (job ? '<p class="sc-muted">之後可用命運轉職書重選。</p>' : '') + '<div class="sc-actions">' +
        button('confirm','確認執行',{primary:true,disabled:lock()}) + button('cancel','取消') + '</div></section>';
    }
    function paint() {
      if (!current()) return;
      if (composing) { deferredPaint = true;return; }
      deferredPaint = false;
      const doc = root.ownerDocument, focus = doc?.activeElement, inside = focus && root.contains?.(focus);
      const focusState = inside && focus.name ? {name:focus.name,skillId:focus.dataset?.skillId,start:focus.selectionStart,end:focus.selectionEnd} : null;
      const top = root.scrollTop;
      root.innerHTML = '<div class="sc-panel" data-sc-tab="' + tab + '" data-sc-ready="' + (!state.loading && !!data() && !state.stale ? '1' : '0') + '" aria-busy="' + (state.loading || state.busy) + '">' +
        '<header class="sc-header"><div><h2>' + (tab === 'skills' ? '技能傳承' : '職業與轉職') + '</h2><p>' + esc(data()?.character?.name || host.getActor?.()?.name || '') + '</p></div>' +
        button('refresh',state.loading ? '讀取中…' : '重新整理',{disabled:state.loading || state.busy}) + '</header>' +
        '<nav class="sc-tabs" aria-label="技能與職業">' + button('navigate','技能',{route:'skills',disabled:tab === 'skills'}) + button('navigate','職業／轉職',{route:'career',disabled:tab === 'career'}) + '</nav>' +
        notices() + confirmation() + (!data() ? '<p class="sc-muted">正在讀取技能與職業…</p>' : tab === 'skills' ? skillsView() : careerView()) + '</div>';
      root.scrollTop = top;
      fitJobArt(root);
      if (state.confirm && state.focusConfirm) {
        state.focusConfirm = false;root.scrollTop = 0;
        root.querySelector?.('[data-sc-confirm]')?.scrollIntoView?.({block:'nearest'});
        root.querySelector?.('[data-sc-action="cancel"]')?.focus?.({preventScroll:true});
      } else if (focusState) {
        const replacement = [...root.querySelectorAll?.('[name="' + focusState.name + '"]') || []].find(node => !focusState.skillId || node.dataset.skillId === focusState.skillId);
        replacement?.focus?.({preventScroll:true});
        if (Number.isInteger(focusState.start) && Number.isInteger(focusState.end)) { try { replacement?.setSelectionRange?.(focusState.start,focusState.end); } catch {} }
      }
    }
    function prepareSkill(action, key) {
      const s = skill(key);if (!s && action !== 'cancel-cast' && action !== 'settings' && action !== 'clear-loadout') return feedback('技能資料已更新，請重新整理。',true);
      if (backpackBlocked() && action !== 'cast' && action !== 'cancel-cast') return feedback('組隊冒險中無法調整技能。',true);
      const m = s?.mastery || {}, slots = [...data().special.loadout];
      if (action === 'settings') {
        const mode = draft.skillMode || data().special.mode || 'safe', raw = draft.skillBudget ?? String(data().special.budget ?? 0), budget = Number(raw);
        if (!['safe','strong'].includes(mode) || !/^\d+$/.test(raw) || !Number.isInteger(budget) || budget < 0 || budget > 50000) return feedback('請選擇有效補水策略，並填入 0 至 50000 的整數每日預算。',true);
        return prepare('expedition/action',{op:'settings',mode,budget},'更新自動補水策略',(mode === 'strong' ? '強力補水' : '安全補水') + '，每日最多耗用 ' + fmt(budget) + ' 金幣等值的背包藍水。');
      }
      if (action === 'learn') {
        if (!eligible(key) || m.nextCost == null || books(key) < Number(m.nextCost)) return feedback('目前不符合學習條件或技能書不足。',true);
        return prepare('expedition/action',{op:'learn',skillId:key,fromLevel:Number(m.level) || 0},(Number(m.level) ? '進修' : '學習') + s.name,'消耗 ' + m.nextCost + ' 本技能書，技能等級 ' + (Number(m.level) || 0) + ' → ' + ((Number(m.level) || 0) + 1) + '。');
      }
      if (['equip','remove','clear-loadout','move-left','move-right'].includes(action)) {
        if (action === 'clear-loadout') slots.splice(0);
        else if (action === 'equip') {
          if (!learned(key) || !eligible(key) || slots.includes(key) || slots.length >= 3) return feedback('最多配置三招已學會且符合目前職業的技能。',true);
          slots.push(key);
        } else {
          const index = slots.indexOf(key);if (index < 0) return;
          if (action === 'remove') slots.splice(index,1);
          else { const target = index + (action === 'move-left' ? -1 : 1);if (target < 0 || target >= slots.length) return;[slots[index],slots[target]] = [slots[target],slots[index]]; }
        }
        return prepare('expedition/action',{op:'loadout',loadout:slots},'更新三格技能配置',slots.length ? '施放順序：' + slots.map(v => skill(v)?.name || v).join(' → ') + '。移除技能時會一併移除它的自動條件。' : '清空三格技能配置。');
      }
      if (action === 'auto') {
        const select = [...root.querySelectorAll?.('[name="skillAuto"]') || []].find(node => node.dataset.skillId === key);
        const mode = draft['auto:' + key] || select?.value || data().special.auto?.[key] || 'manual';
        if (!slotted(key) || !eligible(key) || !Object.hasOwn(MODES,mode) || (mode !== 'manual' && MANUAL_ONLY.has(key))) return feedback('此技能目前不能使用這個自動條件。',true);
        return prepare('expedition/action',{op:'auto',skillId:key,mode},'更新自動施放條件',s.name + '：' + MODES[mode] + '。自動施放會增加魔力與藍水消耗。');
      }
      if (action === 'cast') {
        const reason = castReason(s);if (reason) return feedback(reason,true);
        return prepare('expedition/action',{op:'cast',skillId:key},'排入手動技能',s.name + '將在下一次有效掛機戰鬥施放，使用當時所需魔力。');
      }
      if (action === 'cancel-cast') {
        if (!data().special.pending || party()) return;
        return prepare('expedition/action',{op:'cancel'},'取消等待施放','取消已排入下一次有效掛機戰鬥的技能。');
      }
      if (action === 'recycle') {
        const quantity = Number(draft.quantity);
        if (!/^\d+$/.test(draft.quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > Math.min(999,books(key))) return feedback('請輸入 1 至 ' + Math.min(999,books(key)) + ' 本的整數回收數量。',true);
        return prepare('expedition/action',{op:'recycle',skillId:key,quantity},'回收技能書','消耗 ' + quantity + ' 本「' + s.name + '」技能書，取得 ' + fmt(quantity * Number(m.recycleValue || 0)) + ' 研究碎片；已學會的技能會保留。');
      }
      if (action === 'redeem') {
        const cost = researchCost(s);
        if (cost == null || !eligible(key) || (Number(data().inventory.research_fragment) || 0) < cost) return feedback('目前不符合兌換條件或研究碎片不足。',true);
        return prepare('expedition/action',{op:'redeem',skillId:key},'兌換技能書','消耗 ' + fmt(cost) + ' 研究碎片，取得一本「' + s.name + '」技能書。');
      }
    }
    function prepareCareer(action, branch, tier) {
      const c = data()?.career;if (!c) return;
      if (action === 'advance') {
        const choice = c.next?.choices?.find(v => v.branch === branch);
        if (!choice || Number(choice.tier) !== tier || !c.next.canAdvance) return feedback(c.next?.reason?.message || '目前尚不符合轉職條件。',true);
        state.jobPick = {name:choice.name,path:choice.path,from:c.current.path || '',skill:choice.skill};
        return prepare('advance',{branch},'轉職為 ' + choice.name,'消耗 ' + c.next.material.required + ' 個「' + c.next.material.name + '」，路線 ' + (c.current.path || '初始') + ' → ' + choice.path + '。');
      }
      const row = c.reselect?.tiers?.find(v => Number(v.tier) === tier), choice = row?.choices?.find(v => v.branch === branch);
      if (!choice || choice.selected || !choice.canReselect) return feedback(choice?.reason?.message || '目前尚不符合重選條件。',true);
      return prepare('reselect',{tier,branch},'重選職業路線','消耗 ' + row.book.required + ' 本「' + row.book.name + '」，保留後續分支，最終職業變為「' + choice.name + '」（' + choice.path + '）。重選後開始共用冷卻。' +
        (choice.unequipped?.length ? '會卸下：' + choice.unequipped.map(v => v.name).join('、') + '。' : '這次沒有需要卸下的專屬裝備。'));
    }
    async function click(event) {
      const target = event.target?.closest?.('[data-sc-action]');
      if (!target || target.disabled || !root.contains?.(target) || !current()) return;
      const action = target.dataset.scAction;
      if (action === 'refresh') return refresh();
      if (action === 'cancel') { state.confirm = null;return paint(); }
      if (action === 'confirm') return submit();
      if (action === 'acknowledge') {
        const p = pending();if (p && !state.busy && !state.loading && !state.stale && state.checkedPending === p.id) {clearPending(p.id);state.notice = '已結束這筆待確認狀態。';state.error = '';paint();}return;
      }
      if (action === 'navigate') { if (!state.busy && ['skills','career','build','talents','supplies','book-tools','lineage'].includes(target.dataset.route)) host.navigate?.(target.dataset.route,{});return; }
      if (action === 'job-ack') { delete draft.jobResult;state.notice = '';return paint(); }
      if (action === 'detail') { draft.selected = target.dataset.skillId || '';state.confirm = null;state.error = '';return paint(); }
      if (action === 'list') { draft.selected = '';state.confirm = null;return paint(); }
      if (readiness()) return feedback(readiness(),true);
      if (action === 'advance' || action === 'reselect') return prepareCareer(action,target.dataset.branch,Number(target.dataset.tier));
      return prepareSkill(action,target.dataset.skillId);
    }
    function input(event) {
      if (!current() || !root.contains?.(event.target)) return;
      const node = event.target;
      if (node.name === 'skillSearch') { draft.search = node.value;if (!composing && !event.isComposing) paint(); }
      if (node.name === 'recycleQuantity') draft.quantity = node.value;
      if (node.name === 'skillBudget') draft.skillBudget = node.value;
    }
    function change(event) {
      if (!current() || !root.contains?.(event.target)) return;
      const node = event.target;
      if (node.name === 'skillScope') { draft.scope = node.value === 'all' ? 'all' : 'mine';paint(); }
      if (node.name === 'skillFilter') { draft.filter = ['all','learned','available','books'].includes(node.value) ? node.value : 'all';paint(); }
      if (node.name === 'skillAuto' && node.dataset.skillId) draft['auto:' + node.dataset.skillId] = node.value;
      if (node.name === 'skillMode') draft.skillMode = node.value;
      if (node.name === 'skillBudget') draft.skillBudget = node.value;
      if (node.name === 'recycleQuantity') draft.quantity = node.value;
    }
    const compositionStart = event => { if (root.contains?.(event.target)) composing = true; };
    const compositionEnd = event => { if (!current()) return;composing = false;if (event.target?.name === 'skillSearch') draft.search = event.target.value;if (deferredPaint || event.target?.name === 'skillSearch') paint(); };
    const toggle = event => { if (event.target?.classList?.contains?.('sc-jc-reselect')) draft.reselectOpen = event.target.open; };
    root.addEventListener('toggle',toggle,true);
    root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('change',change);
    const artError = event => { if (event.target?.classList?.contains('sc-skill-art')) event.target.hidden = true; };
    root.addEventListener('error',artError,true);
    root.addEventListener('compositionstart',compositionStart);root.addEventListener('compositionend',compositionEnd);
    const handle = {
      refresh,
      update(scene) {
        if (!current() ||
            (scene?.characterId != null && String(scene.characterId) !== String(context.characterId)) ||
            (scene?.realmId != null && String(scene.realmId) !== String(context.realmId)) ||
            (scene?.accountId != null && String(scene.accountId) !== String(context.accountId))) return;
        const actor = scene?.actor || scene?.character, revision = Number(actor?.revision);
        if (!Number.isFinite(revision)) return;
        state.minRevision = Math.max(state.minRevision,revision);
        if (!state.busy && !state.loading && !composing && revision > state.revision) void refresh();
      },
      handleBack() {
        if (!current()) return false;
        if (state.confirm) { state.confirm = null;paint();return true; }
        if (tab === 'skills' && draft.selected) {draft.selected = '';paint();return true;}
        return false;
      },
      dispose() {
        if (disposed) return;
        disposed = true;generation++;controller?.abort();
        root.removeEventListener('click',click);root.removeEventListener('toggle',toggle,true);root.removeEventListener('error',artError,true);root.removeEventListener('input',input);root.removeEventListener('change',change);
        root.removeEventListener('compositionstart',compositionStart);root.removeEventListener('compositionend',compositionEnd);
      }
    };
    paint();void refresh();return handle;
  }
  globalThis.RpgSceneSkills = {mount};
})();
