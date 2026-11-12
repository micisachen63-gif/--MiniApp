/* /classic-next: the current battle scene (scene.html?embed=battle) shown in the classic home
 * battle frame (#bslot). Display only: no window manager, HUD, chat or guide inside the frame,
 * no timers here, and no network calls of its own besides the scene's single snapshot read
 * on load and the refreshes the classic app asks for after its own manual refreshMe().
 * The frame lives outside #view (classic render() replaces #view; re-inserting an iframe reloads
 * it), positioned over the slot. If the scene cannot load, the classic RpgBattle takes the slot. */
(() => {
  'use strict';
  const SRC = '/ui-generated-20261030/scene-bound-20261102/scene.html?embed=battle&hud=1';
  const SOURCE = 'rpg-scene-battle', READY_TIMEOUT_MS = 20000;
  let frame = null, slot = null, fallback = null, state = 'idle', readyTimer = 0, scheduled = false;
  let wantedCharacter = '', wantedRealm = 'permanent', sentCharacter = '', sentRealm = '', paused = null, observer = null;
  // Reasons the frame is covered (an Atlas panel, a classic floating panel): it pauses underneath.
  const covers = new Set();
  const post = (type, detail) => { try { frame?.contentWindow?.postMessage({ source: 'rpg-classic-next', type, detail: detail || null }, location.origin); } catch (_) {} };
  function create() {
    frame = document.createElement('iframe');
    frame.className = 'cn-battle-frame'; frame.title = '狩獵戰場'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
    frame.setAttribute('allow', 'autoplay'); frame.hidden = true; frame.src = SRC;
    // An error page (or a scene without the embed adapter) loads without RpgSceneEmbed: fall back at once.
    frame.addEventListener('load', () => { let embedded = false; try { embedded = !!frame?.contentWindow?.RpgSceneEmbed; } catch (_) {} if (state === 'loading' && !embedded) fail('load'); });
    document.body.appendChild(frame);
    state = 'loading';
    // A scene that never reports a committed snapshot is treated as a load failure.
    readyTimer = setTimeout(() => { if (state === 'loading') fail('timeout'); }, READY_TIMEOUT_MS);
    if (typeof ResizeObserver === 'function') observer = new ResizeObserver(schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', schedule);
  }
  function fail(reason) {
    if (state === 'failed') return;
    state = 'failed'; clearTimeout(readyTimer);
    try { frame?.remove(); } catch (_) {}
    frame = null; observer?.disconnect(); observer = null;
    document.documentElement.dataset.cnBattle = 'fallback:' + reason;
    if (slot?.isConnected && fallback) fallback(slot);
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin || data?.source !== SOURCE) return;
    if (data.type === 'ready' && state === 'loading') { state = 'ready'; clearTimeout(readyTimer); sentCharacter = String(data.detail?.characterId || ''); sentRealm = String(data.detail?.realmId || 'permanent'); document.documentElement.dataset.cnBattle = 'scene'; schedule(); }
    else if (data.type === 'error' && state === 'loading' && data.detail?.fatal) fail(String(data.detail.code || 'error'));
  });
  function place() {
    if (!frame || !slot) return;
    const target = slot.getBoundingClientRect();
    frame.style.width = target.width + 'px'; frame.style.height = target.height + 'px';
    const now = frame.getBoundingClientRect();
    const left = (parseFloat(frame.style.left) || 0) + target.left - now.left, top = (parseFloat(frame.style.top) || 0) + target.top - now.top;
    frame.style.left = left + 'px'; frame.style.top = top + 'px';
  }
  function apply() {
    scheduled = false;
    if (!frame) return;
    const visible = !!slot?.isConnected && !document.hidden && slot.getClientRects().length > 0;
    frame.hidden = !visible;
    if (visible) { place(); slot.classList.toggle('cn-battle-loading', state !== 'ready'); }
    const shouldPause = !visible || covers.size > 0;
    if (paused !== shouldPause) { paused = shouldPause; post(shouldPause ? 'pause' : 'resume'); }
    if (state === 'ready' && wantedCharacter && (wantedCharacter !== sentCharacter || wantedRealm !== sentRealm)) {
      sentCharacter = wantedCharacter; sentRealm = wantedRealm; post('refresh', { characterId: wantedCharacter, realmId: wantedRealm });
    }
  }
  function schedule() { if (scheduled) return; scheduled = true; queueMicrotask(apply); }
  // Called from bindHome(): returns false when the classic battle should be used instead.
  function attach(target, options = {}) {
    if (!target || state === 'failed') return false;
    slot = target; fallback = typeof options.fallback === 'function' ? options.fallback : null;
    wantedCharacter = String(options.characterId || ''); wantedRealm = String(options.realmId || 'permanent');
    slot.classList.add('cn-battle-slot');
    if (!frame) create();
    observer?.disconnect(); observer?.observe(slot); const view = document.getElementById('view'); if (view) observer?.observe(view);
    schedule();
    return true;
  }
  // Called at the start of every classic render(): the slot is about to be replaced.
  function release() { slot = null; schedule(); }
  // Called after the classic app's own refreshMe() succeeds (manual actions only).
  function refresh() { if (state === 'ready' && wantedCharacter) post('refresh', { characterId: wantedCharacter, realmId: wantedRealm }); }
  // P6: the battle is the main home view — the battle shell moves to the top of the home screen and
  // fills the viewport between the classic top bar and bottom nav (the rest of home follows below).
  function chrome() {
    const hud = document.getElementById('hud'), nav = document.getElementById('nav');
    const h = (el) => (el && el.getClientRects().length ? el.getBoundingClientRect().height : 0);
    document.documentElement.style.setProperty('--cn-chrome', Math.round(h(hud) + h(nav)) + 'px');
  }
  function promote(view) {
    const shell = view?.querySelector?.('.lc-battle-shell');
    if (state === 'failed' || !shell || !shell.querySelector('#bslot.cn-battle-slot')) return false;
    shell.classList.add('cn-main-battle'); view.prepend(shell); chrome();
    if (!promote.bound) { promote.bound = true; window.addEventListener('resize', chrome); }
    schedule(); return true;
  }
  function cover(reason, on) { const had = covers.has(reason); if (on) covers.add(reason); else covers.delete(reason); if (had !== !!on) schedule(); }
  // True while the scene in the frame is running (its own Atlas-active sync is live).
  function syncing() { return state === 'ready' && paused === false && !!frame && !frame.hidden && !document.hidden; }
  window.RpgClassicNextBattle = { attach, release, refresh, cover, syncing, promote, state: () => state, frame: () => frame };
})();
