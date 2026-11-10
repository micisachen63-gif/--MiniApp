/* Production identity stays in memory. Every game request is verified by the
 * existing Telegram API; no dev identity, bot secret or credential persistence. */
(() => {
  'use strict';
  const config = window.__RpgScenePreviewConfig;
  if (config?.telegram !== true || !window.RpgSceneSession?.create) return;
  const api = window.RpgSceneSession, origin = location.origin;
  const allowedOrigin = /^https:\/\//.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
  const denied = () => Promise.reject(Object.assign(new Error('請從 Telegram 開啟星穹旅誌'), {code:'auth_required',uncertain:false}));
  Object.assign(api, {request:denied,refresh:denied,sync:denied,start(){},dispose(){},
    getSnapshot:()=>null,getContext:()=>({accountId:'',realmId:'permanent',characterId:null,epoch:0}),
    subscribe(listener){listener(null);return()=>{};}});
  let app = window.Telegram?.WebApp;
  try { if (!app && parent !== window && parent.location.origin === origin) app = parent.Telegram?.WebApp; } catch {}
  if (app) window.Telegram = {WebApp:app};
  let panel, message, retry, choose, probed = false, disposed = false, onboardingOpen = false, pendingEntry = null;
  // A deep link opens its window once, after the first committed snapshot enables the scene windows.
  function openEntry() {
    const entry = pendingEntry; pendingEntry = null;
    setTimeout(() => whenNavigation(nav => nav.navigate(entry.route, entry.params)), 0);
  }
  function cover(text) {
    if (!document.body) { document.addEventListener('DOMContentLoaded',()=>cover(text),{once:true}); return; }
    if (!panel) {
      panel = document.createElement('section'); panel.className = 'scene-login-status'; panel.setAttribute('aria-label','旅誌登入');
      const title = document.createElement('h2'); title.textContent = '星穹旅誌';
      message = document.createElement('p'); message.setAttribute('role','status');
      retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重新連接'; retry.onclick = () => { probed=false; void api.refresh().catch(onError); };
      choose = document.createElement('button'); choose.type = 'button'; choose.textContent = '建立／選擇角色'; choose.hidden = true;
      choose.onclick = () => { window.RpgSceneNavigation?.navigate('characters',{}); onboardingOpen=true; panel.hidden = true; };
      const bot = document.createElement('a'); bot.href = 'https://t.me/StarJournalRpgBot'; bot.textContent = '開啟 Telegram 旅誌'; bot.target = '_blank'; bot.rel = 'noopener';
      panel.append(title,message,retry,choose,bot); (document.getElementById('ui') || document.body).append(panel);
    }
    message.textContent = text; panel.hidden = false;
  }
  const initData = typeof app?.initData === 'string' ? app.initData : '';
  let user;
  try { user = JSON.parse(new URLSearchParams(initData).get('user') || 'null'); } catch {}
  const accountId = String(user?.id || '');
  if (!allowedOrigin || config.endpoint !== origin + '/app/api/' || !initData || !/^[1-9]\d{0,19}$/.test(accountId)) {
    cover('請從 Telegram 的「星穹旅誌」開啟遊戲。'); return;
  }
  async function onError(error) {
    if (!disposed && error?.status===401) {
      cover('登入已失效，請關閉視窗後從 Telegram 重新開啟旅誌。');
      retry.hidden=true; choose.hidden=true; disposed=true; api.dispose(); return;
    }
    if (disposed || api.getSnapshot() || onboardingOpen) return;
    cover(error?.message || '連線暫時中斷，請重新連接。');
    if (probed) return; probed = true;
    try {
      const roster = await api.request('characters');
      if (!disposed && !api.getSnapshot() && Array.isArray(roster.characters) && !roster.characters.some(c=>c.active)) {
        cover(roster.characters.length ? '請選擇要繼續冒險的角色。' : '歡迎來到旅誌，先建立你的第一位英雄。');
        choose.hidden = false;
      }
    } catch {}
  }
  const session = api.create({endpoint:config.endpoint,accountId,realmId:'permanent',telegramInitData:initData,
    isHidden:()=>document.hidden,
    onSnapshot:value=>{ if (value && panel) panel.hidden=true; window.dispatchEvent(new CustomEvent('rpg:scene-state',{detail:value})); if (value && pendingEntry) openEntry(); },
    onCombatTrace:(trace,scene)=>window.dispatchEvent(new CustomEvent('rpg:combat-trace',{detail:{trace,scene}})),
    onError:error=>{ window.dispatchEvent(new CustomEvent('rpg:scene-error',{detail:{message:error.message,code:error.code}})); void onError(error); },
  });
  Object.assign(api,session);
  try { app.ready(); app.expand(); } catch {}
  // No refresh on every return to the tab (owner decision 2026-11-10); the scene's 同步 control reads state.
  window.addEventListener('pagehide',()=>{disposed=true;session.dispose();},{once:true});
  // entry-gate.js (the restored 選擇角色 screen) hands off with ?entry=<route>: 'characters' for
  // create/delete, or a bot deep link (bag, boss, star-ring, trade_…) to open once the scene is ready.
  const ENTRY_ROUTES = new Set(['inventory','shop','boss','guardian','fate','star-ring','career','direct-trade','duel','party']);
  let entryRoute = '', entryParams = {};
  try {
    const query = new URLSearchParams(location.search);
    entryRoute = query.get('entry') || '';
    const tradeId = query.get('tradeId'), tab = query.get('tab');
    if (tradeId && /^t[0-9a-f]{11}$/.test(tradeId)) entryParams.tradeId = tradeId;
    if (tab && /^[a-z-]{1,20}$/.test(tab)) entryParams.tab = tab;
  } catch {}
  function whenNavigation(open, fallback) {
    let tries = 0;
    const attempt = () => {
      if (disposed) return;
      const nav = window.RpgSceneNavigation;
      if (typeof nav?.navigate === 'function') { open(nav); return; }
      if (++tries < 50) { setTimeout(attempt,200); return; }
      fallback?.();
    };
    attempt();
  }
  if (entryRoute === 'characters') {
    onboardingOpen = true; session.start();
    whenNavigation(nav => { nav.navigate('characters',{}); if (panel) panel.hidden = true; },
      () => { cover('請選擇要繼續冒險的角色。'); choose.hidden = false; });
  } else {
    cover('正在連接你的旅誌…'); session.start();
    if (ENTRY_ROUTES.has(entryRoute)) pendingEntry = { route: entryRoute, params: entryParams };
  }
})();
