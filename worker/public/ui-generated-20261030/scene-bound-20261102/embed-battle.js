/* scene.html?embed=battle — the battlefield only, for the classic home battle frame (/classic-next).
 * No window manager, HUD, chat, guide or scene windows (scene.html skips those scripts), no timers.
 * The parent (same origin only) asks for pause/resume and a refresh after its own manual refresh. */
(function () {
  'use strict';
  if (window.__RpgSceneEmbed !== 'battle') return;
  var origin = location.origin, game = null, sleeping = false, ready = false;
  function post(type, detail) { try { if (parent !== window) parent.postMessage({ source: 'rpg-scene-battle', type: type, detail: detail || null }, origin); } catch (e) {} }
  var style = document.createElement('style');
  style.id = 'scene-embed-battle-style';
  style.textContent = 'html.scene-embed-battle,html.scene-embed-battle body{background:#050505;overflow:hidden}' +
    'html.scene-embed-battle #ui>*:not(#target){display:none!important}' +
    'html.scene-embed-battle .scene-login-status,html.scene-embed-battle #vig{display:none!important}' +
    'html.scene-embed-battle #ui,html.scene-embed-battle #stage{pointer-events:none}';
  document.head.appendChild(style);
  // Keep a handle on the one Phaser game so a hidden frame can stop drawing entirely.
  if (window.Phaser && typeof window.Phaser.Game === 'function') {
    var Original = window.Phaser.Game;
    var Embedded = function (config) { game = new Original(config); if (sleeping) sleep(); return game; };
    Embedded.prototype = Original.prototype;
    window.Phaser.Game = Embedded;
  }
  function sleep() { try { if (game && game.loop && game.loop.running) game.loop.sleep(); } catch (e) {} }
  function wake() { try { if (game && game.loop && !game.loop.running) game.loop.wake(); } catch (e) {} }
  window.addEventListener('rpg:scene-state', function (event) { if (event.detail && !ready) { ready = true; post('ready', { characterId: String(event.detail.characterId || ''), realmId: String(event.detail.realmId || 'permanent') }); } });
  window.addEventListener('rpg:scene-error', function (event) { if (!ready) post('error', { code: event.detail && event.detail.code || 'error', fatal: true }); });
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== parent || event.origin !== origin || !data || data.source !== 'rpg-classic-next') return;
    if (data.type === 'pause') { sleeping = true; sleep(); }
    else if (data.type === 'resume') { sleeping = false; wake(); }
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
  window.RpgSceneEmbed = { mode: 'battle', game: function () { return game; }, sleeping: function () { return sleeping; } };
})();
