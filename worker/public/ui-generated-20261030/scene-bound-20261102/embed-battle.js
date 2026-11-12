/* scene.html?embed=battle — the scene for /classic-next: the battlefield only (classic home battle frame),
 * or with hud=full the whole scene HUD as the classic-next home (taps are forwarded to the parent).
 * No window manager, chat, guide or scene windows (scene.html skips those scripts), no timers.
 * The parent (same origin only) asks for pause/resume and a refresh after its own manual refresh. */
(function () {
  'use strict';
  if (window.__RpgSceneEmbed !== 'battle') return;
  var origin = location.origin, game = null, sleeping = false, ready = false;
  function post(type, detail) { try { if (parent !== window) parent.postMessage({ source: 'rpg-scene-battle', type: type, detail: detail || null }, origin); } catch (e) {} }
  // hud=1 (the /classic-next main home battle): keep the battle HUD pieces that classic does not
  // already show — zone + minimap, target, hp/mp orbs, exp line and skill bar (display only).
  // Portrait/gold, quest tracker, chat, function buttons and windows stay hidden (classic owns them).
  var hud = false, full = false; try { var q = new URLSearchParams(location.search).get('hud'); hud = q === '1'; full = q === 'full'; } catch (e) {}
  if (hud) document.documentElement.classList.add('scene-embed-hud');
  // hud=full (P7, the /classic-next home): the whole scene HUD as on the current home page —
  // portrait/gold, zone/minimap, quest line, chat line, orbs + angel statues, potions/skills and the
  // 背包/裝備/補給/技能/地圖/設定 bar. Taps do not open scene windows: they are posted to the classic
  // parent, which opens the classic feature as a floating window over the scene.
  if (full) { document.documentElement.classList.add('scene-embed-full'); window.RPG_LIVE_SOCIAL = true; }
  var style = document.createElement('style');
  style.id = 'scene-embed-battle-style';
  style.textContent = 'html.scene-embed-battle,html.scene-embed-battle body{background:#050505;overflow:hidden}' +
    'html.scene-embed-battle:not(.scene-embed-hud):not(.scene-embed-full) #ui>*:not(#target){display:none!important}' +
    'html.scene-embed-hud #ui>*:not(#target):not(#topR):not(#bottom){display:none!important}' +
    'html.scene-embed-battle .scene-login-status,html.scene-embed-battle #vig{display:none!important}' +
    'html.scene-embed-battle #ui,html.scene-embed-battle #stage{pointer-events:none}' +
    // Framing: every scene size is relative to the stage height and the camera centres on the hero's
    // feet with the crowd above them, which left the lower third of the classic frame empty. A taller
    // stage (cropped by the frame) enlarges the fight and moves it down so it fills the frame.
    'html.scene-embed-battle #stage{height:132%!important;max-width:none}' +
    'html.scene-embed-hud #topR>#quest,html.scene-embed-hud #bottom #buffs,html.scene-embed-hud #topR button{display:none!important}' +
    '@media (max-width:340px){html.scene-embed-hud #bottom{transform:scale(.84);transform-origin:50% 100%}html.scene-embed-hud #topR{transform:scale(.88);transform-origin:100% 0}}' +
    // A tall main battle frame shows the whole stage: no crop is needed there.
    'html.scene-embed-hud #stage{height:100%!important}' +
    'html.scene-embed-full #stage{height:100%!important}html.scene-embed-full #ui{pointer-events:none}' +
    'html.scene-embed-full #panelHost,html.scene-embed-full #tip,html.scene-embed-full #topR button,html.scene-embed-full #scene-live-status,html.scene-embed-full .scene-live-status-toggle{display:none!important}' +
    'html.scene-embed-full #topL,html.scene-embed-full #topR #zone,html.scene-embed-full #topR #mini,html.scene-embed-full #quest,html.scene-embed-full #chat,html.scene-embed-full #bottom,html.scene-embed-full #fn{pointer-events:auto;cursor:pointer}' +
    'html.scene-embed-full #quest .qd{display:none}html.scene-embed-full.scene-embed-full.scene-embed-full.scene-embed-full.scene-embed-full #ui.scene-unified-root #fn{display:grid!important}html.scene-embed-full #ui.scene-unified-root #bottom{bottom:calc(var(--sab,0px) + 54px)!important}' +
    '@media (max-width:340px){html.scene-embed-full #topR{transform:scale(.88);transform-origin:100% 0}html.scene-embed-full #topL{transform:scale(.9);transform-origin:0 0}}';
  document.head.appendChild(style);
  // Keep a handle on the one Phaser game so a hidden frame can stop drawing entirely.
  if (window.Phaser && typeof window.Phaser.Game === 'function') {
    var Original = window.Phaser.Game;
    var Embedded = function (config) { game = new Original(config); if (sleeping) sleep(); return game; };
    Embedded.prototype = Original.prototype;
    window.Phaser.Game = Embedded;
  }
  function visibility() { try { var session = window.RpgSceneSession; if (session && typeof session.visibilityChanged === 'function') session.visibilityChanged(); } catch (e) {} }
  function sleep() { try { if (game && game.loop && game.loop.running) game.loop.sleep(); } catch (e) {} }
  function wake() { try { if (game && game.loop && !game.loop.running) game.loop.wake(); } catch (e) {} }
  window.addEventListener('rpg:scene-state', function (event) { if (event.detail && !ready) { ready = true; post('ready', { characterId: String(event.detail.characterId || ''), realmId: String(event.detail.realmId || 'permanent') }); } });
  window.addEventListener('rpg:scene-error', function (event) { if (!ready) post('error', { code: event.detail && event.detail.code || 'error', fatal: true }); });
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== parent || event.origin !== origin || !data || data.source !== 'rpg-classic-next') return;
    // The session's Atlas-active timer (isHidden) stops while paused and resumes on return.
    if (data.type === 'pause') { sleeping = true; sleep(); visibility(); }
    else if (data.type === 'resume') { sleeping = false; wake(); visibility(); }
    else if (data.type === 'refresh') {
      var session = window.RpgSceneSession, detail = data.detail || {};
      if (!session || typeof session.sync !== 'function') return;
      var context = session.getContext ? session.getContext() : {};
      var characterId = /^[0-9A-Za-z_:-]{1,64}$/.test(String(detail.characterId || '')) ? String(detail.characterId) : null;
      var realmId = /^[a-z0-9_-]{1,40}$/.test(String(detail.realmId || '')) ? String(detail.realmId) : context.realmId;
      if (characterId && (String(context.characterId || '') !== characterId || context.realmId !== realmId)) session.setContext({ characterId: characterId, realmId: realmId });
      session.sync().catch(function () {});
    }
  });
  if (full) {
    // Scene routes (HUD potions → supplies, skills → skills, 選擇角色 → characters) go to the parent.
    window.RpgSceneNavigation = { navigate: function (route, params) { post('open', { route: String(route || ''), params: params || null }); }, back: function () {}, close: function () {}, current: function () { return null; } };
    var ROUTES = [['#fn .fb', function (el) { return el.dataset.p || 'set'; }], ['#topL', 'hero'], ['#topR #zone', 'map'], ['#topR #mini', 'map'], ['#quest', 'quest'], ['#chat', 'chat']];
    // Capture phase: runs before ui.js' own pointerdown handlers (mock panels / quest collapse).
    var route = function (event) {
      var target = event.target && event.target.closest ? event.target : null; if (!target) return;
      for (var i = 0; i < ROUTES.length; i++) {
        var el = target.closest(ROUTES[i][0]); if (!el) continue;
        event.stopPropagation(); event.preventDefault();
        if (event.type === 'click') post('open', { route: typeof ROUTES[i][1] === 'function' ? ROUTES[i][1](el) : ROUTES[i][1] });
        return;
      }
    };
    document.addEventListener('pointerdown', route, true); document.addEventListener('click', route, true);
    // Esc while the scene has focus closes the classic window / menu in the parent.
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') post('open', { route: 'close' }); });
    var label = function () {
      // Same HUD dressing as the current home page (scene-social-preview.css, already linked by scene.html):
      // laurel portrait bezel, zone/minimap, chat/quest lines. The 背包…設定 bar stays instead of the scene's own nav
      // (scene-live-view.css hides #fn under the unified root with a 4-class selector, hence the repeated class).
      var ui = document.getElementById('ui'); if (ui) ui.classList.add('scene-unified-root');
      var line = document.getElementById('chatLine'), ch = document.querySelector('#chat .ch'); if (line) line.textContent = '點此與旅人聊天'; if (ch) ch.textContent = '聊天';
      var qn = document.querySelector('#quest .qn'), qc = document.querySelector('#quest .qc'); if (qn) qn.textContent = '◆ 星圖任務・派遣'; if (qc) qc.textContent = '';
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', label); else label();
  }
  window.RpgSceneEmbed = { mode: full ? 'home' : 'battle', game: function () { return game; }, sleeping: function () { return sleeping; } };
})();
