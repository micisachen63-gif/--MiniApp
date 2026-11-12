/* /classic-next home (P7): the current scene with its full HUD (scene.html?embed=battle&hud=full)
 * fills the screen — the same frame the current home page uses (iframe#demo, dressed by the
 * existing preview.js / hud-v2 / hud-angels installers: orbs, angel statues, potions and skills).
 * Every HUD tap is forwarded here and opens the CLASSIC feature as a floating window over the
 * scene (app.js owns the windows). No timers here besides the one-shot ready timeout, and no network
 * calls of its own; the scene keeps its own Atlas-active sync and pauses while covered or hidden.
 * If the scene cannot load, the classic layout (tab bar + RpgBattle in #bslot) comes back. */
(() => {
  'use strict';
  const SRC = '/ui-generated-20261030/scene-bound-20261102/scene.html?embed=battle&hud=full';
  const SOURCE = 'rpg-scene-battle', READY_TIMEOUT_MS = 20000;
  let frame = null, slot = null, fallback = null, state = 'idle', readyTimer = 0, scheduled = false, home = false;
  let wantedCharacter = '', wantedRealm = 'permanent', sentCharacter = '', sentRealm = '', paused = null;
  let openHandler = null, failHandler = null;
  // Reasons the scene is covered (a classic window, an Atlas panel, a floating panel): it pauses underneath.
  const covers = new Set();
  const root = document.documentElement;
  const post = (type, detail) => { try { frame?.contentWindow?.postMessage({ source: 'rpg-classic-next', type, detail: detail || null }, location.origin); } catch (_) {} };
  function create() {
    frame = document.getElementById('demo');
    if (!frame) { frame = document.createElement('iframe'); frame.id = 'demo'; document.body.prepend(frame); }
    frame.classList.add('cn-scene'); frame.title = '星穹旅誌冒險'; frame.setAttribute('allow', 'autoplay');
    // An error page (or a scene without the embed adapter) loads without RpgSceneEmbed: fall back at once.
    frame.addEventListener('load', () => { if (frame?.getAttribute('src') == null) return; let embedded = false; try { embedded = !!frame?.contentWindow?.RpgSceneEmbed; } catch (_) {} if (state === 'loading' && !embedded) fail('load'); });
    state = 'loading'; frame.src = SRC;
    // A scene that never reports a committed snapshot is treated as a load failure.
    readyTimer = setTimeout(() => { if (state === 'loading') fail('timeout'); }, READY_TIMEOUT_MS);
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('resize', schedule);
  }
  function fail(reason) {
    if (state === 'failed') return;
    state = 'failed'; clearTimeout(readyTimer);
    try { frame?.remove(); } catch (_) {}
    frame = null; root.classList.remove('cn-scene-home');
    root.dataset.cnBattle = 'fallback:' + reason;
    if (slot?.isConnected && fallback) fallback(slot);
    failHandler?.(reason);
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin || data?.source !== SOURCE) return;
    if (data.type === 'ready' && state === 'loading') { state = 'ready'; clearTimeout(readyTimer); sentCharacter = String(data.detail?.characterId || ''); sentRealm = String(data.detail?.realmId || 'permanent'); root.dataset.cnBattle = 'scene'; schedule(); }
    else if (data.type === 'error' && state === 'loading' && data.detail?.fatal) fail(String(data.detail.code || 'error'));
    else if (data.type === 'open' && state !== 'failed') openHandler?.(String(data.detail?.route || ''), data.detail?.params || null);
  });
  function apply() {
    scheduled = false;
    if (!frame) return;
    root.classList.toggle('cn-scene-home', home);
    root.classList.toggle('cn-scene-loading', home && state !== 'ready');
    if (home && state === 'ready') measureBar();
    const visible = home && !document.hidden;
    const shouldPause = !visible || covers.size > 0;
    if (paused !== shouldPause) { paused = shouldPause; post(shouldPause ? 'pause' : 'resume'); }
    if (state === 'ready' && wantedCharacter && (wantedCharacter !== sentCharacter || wantedRealm !== sentRealm)) {
      sentCharacter = wantedCharacter; sentRealm = wantedRealm; post('refresh', { characterId: wantedCharacter, realmId: wantedRealm });
    }
  }
  // Classic windows stop above the scene's 背包…設定 bar so it stays tappable (switches windows).
  function measureBar() {
    try { const doc = frame?.contentDocument, fn = doc?.getElementById('fn'); if (!fn || !fn.getClientRects().length) return; const h = Math.round(doc.defaultView.innerHeight - fn.getBoundingClientRect().top); if (h > 20 && h < 200) root.style.setProperty('--cn-bar', (h + 4) + 'px'); } catch (_) {}
  }
  function schedule() { if (scheduled) return; scheduled = true; queueMicrotask(apply); }
  // Called from bindHome(): returns false when the classic battle should be used instead.
  function attach(target, options = {}) {
    if (!target || state === 'failed') return false;
    slot = target; fallback = typeof options.fallback === 'function' ? options.fallback : null;
    wantedCharacter = String(options.characterId || ''); wantedRealm = String(options.realmId || 'permanent');
    slot.classList.add('cn-battle-slot');
    if (!frame) create();
    schedule();
    return true;
  }
  // The scene is the home while a character is in play (not on character select / create).
  function setHome(on, options = {}) {
    if (options.characterId) { wantedCharacter = String(options.characterId); wantedRealm = String(options.realmId || 'permanent'); }
    if (on && state === 'failed') on = false;
    if (on && !frame) create();
    home = !!on; schedule(); return home;
  }
  // Called at the start of every classic render(): the slot is about to be replaced.
  function release() { slot = null; schedule(); }
  // Called after the classic app's own refreshMe() succeeds (manual actions only).
  function refresh() { if (state === 'ready' && wantedCharacter) post('refresh', { characterId: wantedCharacter, realmId: wantedRealm }); }
  function cover(reason, on) { const had = covers.has(reason); if (on) covers.add(reason); else covers.delete(reason); if (had !== !!on) schedule(); }
  // True while the scene is running (its own Atlas-active sync is live).
  function syncing() { return state === 'ready' && paused === false && !!frame && home && !document.hidden; }
  window.RpgClassicNextBattle = {
    attach, release, refresh, cover, syncing, home: setHome,
    onOpen: fn => { openHandler = typeof fn === 'function' ? fn : null; },
    onFail: fn => { failHandler = typeof fn === 'function' ? fn : null; },
    active: () => home && state !== 'failed', state: () => state, frame: () => frame,
  };
})();
