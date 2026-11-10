/* Classic entry restored in front of the scene (2026-11-10 owner decision).
 * Every launch shows the original journey splash, then the original 選擇角色
 * screen. Only the existing `characters` and `select` APIs are used; the scene
 * iframe is loaded after the choice, so it starts with the selected character.
 * Identity stays in memory: initData is only sent as the existing header. */
(function (global) {
  'use strict';
  const SCENE_SRC = '/ui-generated-20261030/scene-bound-20261102/scene.html';
  const PORTRAIT_INDEX = '/ui-generated-20261030/characters-v1/character-preview-index.json';
  // The same stylesheets, order and cache keys as classic.html, so the restored
  // screens keep the original look. They are removed again at the handoff.
  const CLASSIC_CSS = ['/game-brand.css?v=20261109-huninn1', '/styles.css?v=20261020-scroll-badge1', '/lineage-ui.css?v=14',
    '/ui-refined.css?v=20261011-1', '/mythic-ui.css?v=20261011-2', '/olympus-luxury.css?v=20261011-1',
    '/olympus-suite.css?v=20261011-home-panels-1', '/olympus-unified.css?v=20261016-create-surfaces1',
    '/character-delete.css?v=20261028-character-delete1', '/entry-gate.css?v=20261110-entry1'];
  const BODY_CLASSES = ['mythic', 'olympus-suite', 'greek', 'v2', 'entry-gate-open'];
  const CLASS_NAMES = { sword: '劍士', archer: '妖精', mage: '法師', thief: '盜賊' };
  const MAX_CHARACTERS = 4, MIN_SPLASH_MS = 700;
  const CREDIT = '<footer class="game-credit"><span class="credit-label">Game Producer</span><span class="credit-divider" aria-hidden="true">·</span><strong>ミカサ</strong></footer>';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function splashMarkup(status = '正在展開旅程…') {
    return '<div class="boot journey-loading" role="status" aria-live="polite"><div class="journey-star" aria-hidden="true">✦</div>'
      + '<small class="journey-eyebrow">A JOURNAL BEYOND THE STARS</small><h1>星穹旅誌</h1><p>與星同行，將遠方寫成故事</p>'
      + '<div class="journey-progress" aria-hidden="true"><span></span></div><span class="journey-status">' + esc(status) + '</span>' + CREDIT + '</div>';
  }
  /** Same identity rule as the server's atlasAppearanceKey (worker/src/game/atlas-scene.js). */
  function appearanceKey({ baseClass, gender, classPath = '' } = {}) {
    if (!CLASS_NAMES[baseClass] || !['m', 'f'].includes(gender)) return null;
    const path = String(classPath || '');
    if (!path) return baseClass + (gender === 'm' ? '_m' : '');
    if (!/^[AB][12]{0,3}$/.test(path)) return null;
    return 'adv' + path.length + '_' + baseClass + '_' + path + '_' + gender;
  }
  function portraitFor(character, portraits) {
    const key = appearanceKey(character), exact = key && portraits?.[key];
    if (exact) return exact;
    const base = appearanceKey({ baseClass: character?.baseClass, gender: character?.gender });
    return (base && portraits?.[base]) || null;
  }
  /** The 10/29 production select screen (worker/public/app.js characterSelectView at 3c6729a). */
  function selectMarkup(characters = [], portraits = {}, notice = '') {
    const list = Array.isArray(characters) ? characters : [];
    const bySlot = new Map(list.map(c => [Number(c.slot), c]));
    const extra = list.filter(c => !(Number(c.slot) >= 1 && Number(c.slot) <= MAX_CHARACTERS));
    const slots = Array.from({ length: MAX_CHARACTERS }, (_, i) => i + 1).map(slot => bySlot.get(slot) || slot).concat(extra).map(c => {
      if (typeof c === 'number') return '<button class="char-card char-empty" data-new="' + c + '" aria-label="建立第 ' + c + ' 隻角色"><span class="char-question">?</span><b>尚未創角</b><small>第 ' + c + ' 格 · 建立新冒險者</small><em>＋ 建立角色</em></button>';
      const pic = portraitFor(c, portraits), name = CLASS_NAMES[c.baseClass] || c.baseClass;
      return '<div class="char-choice"><button class="char-card ' + (c.active ? 'char-active' : '') + '" data-select="' + esc(c.charId) + '"><span class="char-slot">角色 ' + esc(c.slot) + (c.active ? ' · 上次掛機' : '') + '</span>'
        + '<span class="char-portrait">' + (pic ? '<img src="' + esc(pic) + '" alt="">' : '<i>✦</i>') + '</span><strong>' + esc(c.name) + '</strong><small>' + esc(name) + ' · Lv.' + esc(c.level) + '</small>'
        + '<em>' + (c.active ? '繼續冒險' : '選擇角色') + '</em></button><button type="button" class="char-delete-link" data-delete-character="' + esc(c.charId) + '" aria-label="刪除角色 ' + esc(c.name) + '">刪除角色</button></div>';
    }).join('');
    return '<section class="char-select"><div class="char-select-title"><span>✥ ADVENTURER SELECT ✥</span><h1>選擇角色</h1><p>選定的角色會繼續離線掛機，並代表你挑戰世界王</p></div><div class="char-grid">' + slots + '</div>'
      + '<div class="char-select-foot">' + list.length + '/' + MAX_CHARACTERS + ' 名冒險者 · 只有目前選定的角色獲得掛機收益<br><small>每帳號每天最多刪除 1 隻角色 · 台灣時間 00:00 重置</small>'
      + (notice ? '<p class="entry-gate-notice" role="alert">' + esc(notice) + '</p>' : '') + '</div>' + CREDIT + '</section>';
  }
  function messageMarkup(title, text, { retry = false, enter = false } = {}) {
    return '<section class="char-select"><div class="char-select-title"><span>✥ ADVENTURER SELECT ✥</span><h1>' + esc(title) + '</h1><p>' + text + '</p>'
      + (retry ? '<button class="btn" type="button" data-entry-retry>重新讀取角色</button>' : '')
      + (enter ? '<button class="btn ghost mt" type="button" data-entry-enter>直接進入旅誌</button>' : '') + '</div>' + CREDIT + '</section>';
  }
  // Bot links (cloud-bot rpg-flow deepLink/appBtn: ?startapp=<x> or web_app ?screen=<x>) mapped to the
  // scene window that replaced each classic tab (classic app.js boot() at 3c6729a).
  const SCREEN_ROUTES = Object.freeze({ bag: 'inventory', shop: 'shop', gacha: 'shop', boss: 'boss', guardian: 'guardian', fate: 'fate',
    'star-ring': 'star-ring', class: 'career', trade: 'direct-trade', pk: 'duel' });
  function deepLink(value) {
    const raw = String(value || '').trim(), spx = raw.replace(/^rpg_?/, '');
    if (!spx || spx === 'home') return null;
    if (spx === 'admin') return { admin: '/admin/' };
    const approve = /^admin_([0-9a-f]{64})$/.exec(spx); if (approve) return { admin: '/admin/?approve=' + approve[1] };
    if (/^ring_[0-9a-f]{32}$/.test(spx)) return { ring: true }; // the scene's 星環 window reads the invite itself
    const trade = /^trade_?(t[0-9a-f]{11})$/.exec(spx); if (trade) return { route: 'direct-trade', params: { tradeId: trade[1] } };
    if (/^req_?q[0-9a-f]{11}$/.test(spx)) return { route: 'direct-trade', params: {} };
    if (/^pk_?p[0-9a-f]{11}$/.test(spx)) return { route: 'duel', params: {} };
    if (/^party_[A-Za-z0-9:_-]{1,80}$/.test(spx)) return { route: 'party', params: { tab: 'current' } };
    return SCREEN_ROUTES[spx] ? { route: SCREEN_ROUTES[spx], params: {} } : null;
  }
  /** Scene iframe URL for a hand-off: ?entry=<route> plus whitelisted window params. */
  function sceneUrl(sceneSrc, { route, params } = {}) {
    if (!route) return sceneSrc;
    const query = new URLSearchParams({ entry: route });
    for (const [key, value] of Object.entries(params || {})) if (['tradeId', 'tab'].includes(key) && value) query.set(key, String(value));
    return sceneSrc + '?' + query.toString();
  }

  /** DOM-free controller: render(screen, html), request(action, body), handoff({route}). */
  function createGate(deps) {
    const wait = deps.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    let characters = [], portraits = {}, busy = false, done = false, generation = 0;
    const destination = deepLink(deps.startParam);
    function handoff(options = {}) { if (done) return false; done = true; deps.handoff(options); return true; }
    const go = () => handoff(destination?.route ? { route: destination.route, params: destination.params } : {});
    function showSelect(notice = '') { if (!done) deps.render('select', selectMarkup(characters, portraits, notice)); }
    async function start() {
      if (done) return;
      const run = ++generation, started = Date.now();
      if (destination?.admin && deps.redirect) { done = true; deps.redirect(destination.admin); return; }
      deps.render('splash', splashMarkup());
      if (!deps.signed) return go();
      try {
        const [list, art] = await Promise.all([deps.request('characters'), Promise.resolve().then(() => deps.portraits?.()).catch(() => null)]);
        if (run !== generation || done) return;
        characters = Array.isArray(list?.characters) ? list.characters : []; portraits = art || {};
        const active = characters.find(c => c.active);
        if (active && destination?.ring) return handoff({});
        const left = MIN_SPLASH_MS - (Date.now() - started); if (left > 0) await wait(left);
        if (run !== generation || done) return;
        showSelect();
      } catch (error) {
        if (run !== generation || done) return;
        if (error?.status === 401) deps.render('error', messageMarkup('登入驗證失敗', '請關閉後從 @StarJournalRpgBot 重新打開'));
        else deps.render('error', messageMarkup('角色尚未載入', esc(error?.message || '連線暫時中斷'), { retry: true, enter: true }));
      }
    }
    async function choose(charId) {
      if (busy || done || !characters.some(c => String(c.charId) === String(charId))) return false;
      busy = true;
      try { await deps.request('select', { charId: String(charId) }); deps.haptic?.('ok'); return go(); }
      catch (error) { showSelect(error?.status === 401 ? '登入驗證失敗，請關閉後從 @StarJournalRpgBot 重新打開' : (error?.message || '選擇角色失敗，請再試一次')); return false; }
      finally { busy = false; }
    }
    // Creation and deletion keep their current owner: the scene's character window.
    const manage = () => handoff({ route: 'characters' });
    return { start, choose, manage, enter: go, destination, state: () => ({ characters, busy, done }) };
  }

  function boot(doc) {
    const frame = doc.getElementById('demo');
    if (!frame) return;
    const sceneSrc = frame.dataset.sceneSrc || SCENE_SRC;
    const tg = global.Telegram?.WebApp, initData = typeof tg?.initData === 'string' ? tg.initData : '';
    try { tg?.ready?.(); tg?.expand?.(); } catch {}
    // Keep downward swipes on the map from minimising the Mini App (Bot API 7.7+).
    try { if (typeof tg?.disableVerticalSwipes === 'function' && (!tg.isVersionAtLeast || tg.isVersionAtLeast('7.7'))) tg.disableVerticalSwipes(); } catch {}
    const links = CLASSIC_CSS.map(href => { const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.dataset.entryGate = ''; doc.head.appendChild(link); return link; });
    doc.body.classList.add(...BODY_CLASSES);
    const root = doc.createElement('div'); root.id = 'app'; root.className = 'entry-gate';
    const view = doc.createElement('main'); view.id = 'view'; root.appendChild(view); doc.body.appendChild(root);
    let startParam = '';
    try { startParam = tg?.initDataUnsafe?.start_param || new URLSearchParams(global.location.search).get('screen') || new URLSearchParams(global.location.search).get('tgWebAppStartParam') || ''; } catch {}
    async function request(action, body = {}) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      try {
        let response, data = null;
        const headers = { 'Content-Type': 'application/json', 'X-Realm-Id': 'permanent', 'X-Telegram-Init-Data': initData };
        // Same art-revision handshake as the classic client and the scene session (select is gated by it).
        const artRevision = global.RpgMonsterExpansion?.revision || global.RpgMonsterExpansionArtRevision;
        if (typeof artRevision === 'string' && /^[\x21-\x7e]{1,200}$/.test(artRevision)) headers['X-Monster-Art-Revision'] = artRevision;
        try { response = await global.fetch('/app/api/' + action, { method: 'POST', credentials: 'same-origin', signal: controller.signal,
          headers, body: JSON.stringify(body) }); }
        catch { throw new Error('遊戲服務暫時無法連線，請重新讀取'); }
        try { data = await response.json(); } catch {}
        if (!response.ok || !data || data.ok === false) throw Object.assign(new Error(data?.message || '連線失敗（' + response.status + '）'), { status: response.status, code: data?.error });
        return data;
      } finally { clearTimeout(timer); }
    }
    const gate = createGate({
      signed: !!initData, startParam, request,
      portraits: () => global.fetch(PORTRAIT_INDEX, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null)
        .then(index => Object.fromEntries((index?.actors || []).filter(a => typeof a?.portrait === 'string' && a.portrait.startsWith('/')).map(a => [a.id, a.portrait]))),
      haptic: kind => { try { tg?.HapticFeedback?.notificationOccurred?.(kind === 'ok' ? 'success' : 'error'); } catch {} },
      render(screen, html) { view.dataset.screen = screen; view.innerHTML = html; root.scrollTop = 0; },
      redirect: url => { root.remove(); links.forEach(link => link.remove()); doc.body.classList.remove(...BODY_CLASSES); global.location.replace(url + (global.location.hash || '')); },
      handoff({ route, params } = {}) {
        root.remove(); links.forEach(link => link.remove()); doc.body.classList.remove(...BODY_CLASSES);
        frame.src = sceneUrl(sceneSrc, { route, params });
        global.dispatchEvent?.(new global.CustomEvent('rpg:entry-handoff', { detail: { route: route || null } }));
      },
    });
    view.addEventListener('click', event => {
      const target = event.target.closest?.('[data-select],[data-new],[data-delete-character],[data-entry-retry],[data-entry-enter]');
      if (!target || target.disabled) return;
      if (target.dataset.select !== undefined) {
        const cards = [...view.querySelectorAll('[data-select]')]; cards.forEach(card => { card.disabled = true; });
        target.querySelector('em') && (target.querySelector('em').textContent = '進入中…');
        void gate.choose(target.dataset.select).then(ok => { if (!ok) cards.forEach(card => { card.disabled = false; }); });
      } else if (target.dataset.entryRetry !== undefined) void gate.start();
      else if (target.dataset.entryEnter !== undefined) gate.enter();
      else gate.manage();
    });
    global.RpgEntryGate.instance = gate;
    void gate.start();
  }

  global.RpgEntryGate = { SCENE_SRC, CLASSIC_CSS, deepLink, sceneUrl, splashMarkup, selectMarkup, messageMarkup, appearanceKey, portraitFor, createGate, boot };
  const doc = global.document;
  if (doc?.getElementById?.('demo')) {
    try { boot(doc); }
    catch (error) { const frame = doc.getElementById('demo'); doc.getElementById('app')?.remove(); if (frame && !frame.getAttribute('src')) frame.src = frame.dataset.sceneSrc || SCENE_SRC; }
  }
})(window);
