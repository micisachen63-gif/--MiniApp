/* /classic-next P5: classic-style entries that open the existing panels, the 冒險 banner loops
 * and the career skill icons.
 * - Chat and equipment recovery open the existing Atlas panels (atlas-ui), unchanged.
 * - 出生與旅箋 (F2) and 戰報紀錄 (ledger history) mount the existing scene modules
 *   (scene-fate-ui.js section 'private', scene-ledger-ui.js) in one classic floating panel.
 *   Their own refresh timers exist only while the panel is open and are disposed on close.
 * - Banners: poster first (lazy <img>); the <video> is created only when the entry is on screen,
 *   paused off-screen / while hidden, stills only for reduced motion. No timers. */
(() => {
  'use strict';
  const BANNER_ROOT = '/art/adventure-banners-20261112/';
  const BANNERS = Object.freeze({
    atlas: 'explore-5-atlas', expedition: 'explore-1-dispatch', status: 'explore-2-status', build: 'explore-3-growth', supply: 'explore-4-supply',
    dungeon: 'party-1-dungeon', tower: 'party-2-tower', boss: 'party-3-worldboss', ring: 'party-4-ring',
    quests: 'quest-1-quests', fate: 'quest-2-fate', daily: 'quest-3-daily', journal: 'quest-4-log',
  });
  // Where each loop sits in the classic screens (selector → banner id).
  const PLACES = Object.freeze([
    ['[data-next-atlas]', 'atlas'], ['[data-next-atlas-open="expedition"]', 'expedition'], ['[data-next-atlas-open="build"]', 'build'],
    ['[data-next-atlas-open="quests"]', 'quests'], ['[data-next-entry="ledger"]', 'status'], ['.card:has(#refill)', 'supply'],
    ['.godwar-entry .expedition-choice', 'dungeon', '組隊打寶'], ['.godwar-entry .expedition-choice', 'tower', '組隊爬塔'],
    ['.godwar-entry .expedition-choice', 'ring', '星環遠征'], ['.my-boss-arena', 'boss'], ['.fate-home-card', 'fate'],
    ['.card:has(#daily)', 'daily'], ['.journal-shortcut', 'journal'],
  ]);
  const ENTRIES = Object.freeze([
    { id: 'chat', icon: '💬', title: '聊天', note: '世界與隊伍頻道' },
    { id: 'fate', icon: '✉️', title: '出生與旅箋', note: '出生檔案 · 每日旅箋' },
    { id: 'recovery', icon: '🏛️', title: '典藏與精煉', note: '首次典藏 · 回收 · 重洗' },
    { id: 'ledger', icon: '📜', title: '戰報紀錄', note: '金幣、道具與經驗入帳' },
  ]);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- 冒險 banners ---------- */
  const rows = new Set();
  let observer = null, listening = false;
  const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function start(row) {
    if (row.video || reduced() || typeof document.createElement('video').play !== 'function') return;
    const video = document.createElement('video');
    for (const [k, v] of [['muted', ''], ['loop', ''], ['playsinline', ''], ['preload', 'none'], ['poster', row.stem + '.webp'], ['disableremoteplayback', ''], ['aria-hidden', 'true']]) video.setAttribute(k, v);
    video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'none'; video.disablePictureInPicture = true;
    for (const [ext, type] of [['webm', 'video/webm'], ['mp4', 'video/mp4']]) { const s = document.createElement('source'); s.src = row.stem + '.' + ext; s.type = type; video.append(s); }
    row.media.append(video); row.video = video;
  }
  const play = (row) => { if (row.video && row.visible && !document.hidden && row.el.isConnected) row.video.play()?.catch?.(() => {}); };
  const pause = (row) => { if (row.video && !row.video.paused) row.video.pause(); };
  function drop(row) { pause(row); observer?.unobserve(row.el); if (row.video) { row.video.querySelectorAll('source').forEach((s) => s.remove()); row.video.load?.(); } rows.delete(row); }
  function visibility() { for (const row of rows) document.hidden ? pause(row) : play(row); }
  function banner(el, id) {
    const stem = BANNER_ROOT + BANNERS[id];
    if (!el || !BANNERS[id] || el.querySelector(':scope > .cn-banner')) return;
    el.classList.add('cn-banner-host'); el.dataset.cnBanner = id;
    const media = document.createElement('span'); media.className = 'cn-banner'; media.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img'); img.src = stem + '.webp'; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
    media.append(img); el.prepend(media);
    const row = { el, media, stem, video: null, visible: false }; rows.add(row);
    if (typeof IntersectionObserver === 'function') {
      observer ||= new IntersectionObserver((items) => { for (const item of items) for (const r of rows) if (r.el === item.target) { r.visible = item.isIntersecting; if (r.visible) { start(r); play(r); } else pause(r); } }, { rootMargin: '120px 0px' });
      observer.observe(el);
    }
    if (!listening) { listening = true; document.addEventListener('visibilitychange', visibility); }
  }
  // Called after every classic compose and when a sheet opens; old (replaced) nodes are released.
  function decorate(root = document) {
    for (const row of [...rows]) if (!row.el.isConnected) drop(row);
    for (const [selector, id, label] of PLACES) {
      let found = []; try { found = root.querySelectorAll(selector); } catch (_) {}
      found.forEach((el) => { if (!label || el.querySelector('b')?.textContent.trim() === label) banner(el, id); });
    }
    // The journal shortcut is painted after its own read: follow that slot only.
    root.querySelectorAll?.('[data-journal-slot]').forEach((slot) => {
      if (slot.__cnBanner || typeof MutationObserver !== 'function') return;
      slot.__cnBanner = new MutationObserver(() => banner(slot.querySelector('.journal-shortcut'), 'journal'));
      slot.__cnBanner.observe(slot, { childList: true });
    });
  }

  /* ---------- career skill icons ---------- */
  function skillIcon(baseClass, path, cls = 'cn-skill-icon') {
    if (!/^(sword|archer|mage|thief)$/.test(String(baseClass || ''))) return '';
    const p = String(path || '');
    if (p && !/^[AB][12]{0,3}$/.test(p)) return '';
    return `<img class="${esc(cls)}" src="/art/career-skill-icons-20261110/${baseClass}${p ? '_' + p : ''}.webp" alt="" loading="lazy" decoding="async" draggable="false">`;
  }

  /* ---------- quick entries + floating panel ---------- */
  function entriesHtml(options = {}) {
    return `<section class="cn-entries" aria-label="旅途工具">${ENTRIES.filter((e) => options[e.id] !== false).map((e) =>
      `<button type="button" class="cn-entry" data-next-entry="${e.id}"><span class="cn-entry-icon" aria-hidden="true">${e.icon}</span><span class="cn-entry-text"><b>${esc(e.title)}</b><small>${esc(e.note)}</small></span></button>`).join('')}</section>`;
  }
  const MODULES = Object.freeze({
    ledger: { src: '/scene-ledger-ui.js?v=ledger-20261106', name: 'RpgSceneLedger', title: '戰報紀錄', mount: (m, body, host) => m.mount(body, host) },
    fate: { src: '/scene-fate-ui.js?v=fate-f2-20261105', name: 'RpgSceneFate', title: '出生與旅箋', mount: (m, body, host) => m.mount(body, host, { section: 'private' }) },
  });
  const flights = new Map();
  function load(kind) {
    const spec = MODULES[kind];
    if (window[spec.name]) return Promise.resolve(window[spec.name]);
    if (flights.has(kind)) return flights.get(kind);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = spec.src;
      s.onload = () => window[spec.name] ? resolve(window[spec.name]) : fail(); s.onerror = fail;
      function fail() { flights.delete(kind); s.remove(); reject(Error('功能介面載入失敗，請重試')); }
      document.head.append(s);
    });
    flights.set(kind, p); return p;
  }
  let panel = null;
  function close() {
    if (!panel) return;
    const p = panel; panel = null;
    try { p.view?.dispose?.(); } catch (_) {}
    p.root.remove(); document.removeEventListener('keydown', p.key); window.removeEventListener('rpg-context-changed', close);
    const app = document.getElementById('app'); if (app) app.inert = p.wasInert; document.body.style.overflow = p.overflow;
    p.host?.covered?.(false);
    if (p.focus?.isConnected) p.focus.focus({ preventScroll: true });
  }
  // host: {context(), request(action, body, options), actor(), covered(on), refresh()} from app.js.
  async function open(kind, host) {
    if (!MODULES[kind] || !host?.context()?.characterId) return false;
    close();
    const root = document.createElement('section'); root.className = 'cn-panel'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', MODULES[kind].title);
    root.innerHTML = `<div class="cn-panel-card"><header class="cn-panel-head"><h2>${esc(MODULES[kind].title)}</h2><button type="button" class="cn-panel-close" data-cn-panel-close>✕ 關閉</button></header><div class="cn-panel-body" data-cn-panel-body><p class="muted">正在開啟…</p></div></div>`;
    const app = document.getElementById('app');
    const p = panel = { kind, root, host, view: null, focus: document.activeElement, wasInert: app?.inert, overflow: document.body.style.overflow, key: (e) => { if (e.key === 'Escape' && !(p.view?.handleBack?.())) close(); } };
    document.body.append(root); if (app) app.inert = true; document.body.style.overflow = 'hidden';
    root.querySelector('[data-cn-panel-close]').onclick = close; root.addEventListener('click', (e) => { if (e.target === root) close(); });
    document.addEventListener('keydown', p.key); window.addEventListener('rpg-context-changed', close);
    host.covered?.(true); root.querySelector('[data-cn-panel-close]').focus({ preventScroll: true });
    const body = root.querySelector('[data-cn-panel-body]'), context = host.context(), draft = {};
    const current = () => panel === p && JSON.stringify(host.context()) === JSON.stringify(context);
    try {
      const module = await load(kind);
      if (!current()) return false;
      body.replaceChildren();
      p.view = MODULES[kind].mount(module, body, {
        getContext: () => host.context(), current, request: host.request, draft, now: Date.now,
        getActor: () => host.actor(), actor: host.actor(), realmId: context.realmId, characterId: context.characterId,
        onChanged: () => { if (current()) void host.refresh?.(); },
      });
      return true;
    } catch (error) { if (current()) body.innerHTML = `<p class="muted">${esc(error.message || '功能介面載入失敗，請重試')}</p>`; return false; }
  }
  window.RpgClassicNextEntries = Object.freeze({ BANNERS, PLACES, ENTRIES, decorate, banner, skillIcon, entriesHtml, open, close, isOpen: () => !!panel, rows: () => rows.size });
})();
