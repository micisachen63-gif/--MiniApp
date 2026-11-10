/* One context for the local scene and its real Atlas windows. Reads never settle. */
(() => {
  'use strict';
  const READS = new Set(['trade/scene-scoped','trade/eligible-scoped','trade/receipt','trade/invitation-receipt','exchange/scene','exchange/sellable-scene','exchange/receipt','meta','realms','characters','skill-career','party/scene','tower/scene','tower/receipt','boss/scene','boss/receipt','star-ring/scene','star-ring/receipt','guardian/scene','guardian/receipt','fate/scene','fate/receipt','fate/private/scene','fate/private/profile','fate/private/receipt','atlas/status','atlas/catalog','atlas/talents','atlas/talents/preview','atlas/quests','equipment-collection','equipment-collection/preview','equipment-recovery','equipment-recovery/preview','forge/receipt','background/status','auto-enhance/status','auto-reroll/status','auto-reroll/options','ledger','ledger/history','fate/gifts/summary','chat/state']);
  const SCOPED_REALM_ACTIONS = new Set(['trade/scene-scoped','trade/eligible-scoped','trade/receipt','trade/invitation-receipt','trade/action-scoped','trade/invitation-scoped','exchange/scene','exchange/sellable-scene','exchange/receipt','exchange/action-scoped','ledger/history','boss/scene','boss/receipt','boss/attack-scoped','boss/exchange-scoped','star-ring/scene','star-ring/receipt','star-ring/create-scoped','star-ring/action-scoped','star-ring/shop-scoped','star-ring/cosmetics/equip-scoped','guardian/scene','guardian/receipt','guardian/action-scoped','fate/scene','fate/receipt','fate/action-scoped','fate/private/scene','fate/private/profile','fate/private/receipt','fate/private/action-scoped','fate/private/cancel']);
  function create(options = {}) {
    const send = options.fetch || globalThis.fetch.bind(globalThis);
    const endpoint = options.endpoint;
    const listeners = new Set(), traceListeners = new Set(), controllers = new Set(), writes = new Set();
    const pollMs = Math.max(1000, Number(options.pollMs) || 15000), now = options.now || Date.now;
    let context = { accountId: String(options.accountId || '90101'), realmId: options.realmId || 'permanent', characterId: options.characterId == null ? null : String(options.characterId) };
    let epoch = 0, sequence = 0, applied = 0, floor = 0, snapshot = null, flight = null, advanceFlight = null, nextAdvanceAt = 0, nextPollAt=0, disposed = false, timer = null, selecting = false, lastError = '';
    const contextError = () => Object.assign(new Error('角色或世界已切換，已忽略先前回應'), { code: 'context_changed', uncertain: false });
    const staleError = () => Object.assign(new Error('已收到較新的戰況'), { code: 'stale_response', uncertain: false });
    function emit(value) {
      if(!!value?.run?.map?.progression!==!!snapshot?.run?.map?.progression){nextPollAt=0;nextAdvanceAt=0;}
      snapshot = value;
      for (const listener of listeners) { try { listener(value); } catch (error) { options.onListenerError?.(error); } }
      options.onSnapshot?.(value);
    }
    function emitCombatTrace(trace, scene) {
      const scope = trace?.context, run = scene?.run;
      if (!trace || trace.schemaVersion !== 1 || trace.source !== 'committed-combat' || !run
        || !scope || scope.accountId !== String(scene.accountId) || scope.realmId !== scene.realmId
        || scope.characterId !== String(scene.characterId) || scope.dispatchId !== String(run.id)
        || !Number.isSafeInteger(trace.revision) || trace.revision < 0 || !Number.isSafeInteger(Number(run.revision)) || trace.revision > Number(run.revision)
        || !Number.isSafeInteger(trace.committedAtMs) || trace.committedAtMs < 0 || trace.resolutionMs !== 1000
        || !Array.isArray(trace.events) || trace.events.length > 128
        || !Number.isSafeInteger(trace.limit) || trace.limit < 1 || trace.limit > 128 || trace.events.length > trace.limit) return false;
      for (const listener of traceListeners) {
        try { listener(trace, scene); } catch (error) { options.onListenerError?.(error); }
      }
      try { options.onCombatTrace?.(trace, scene); } catch (error) { options.onListenerError?.(error); }
      return true;
    }
    function setContext(next = {}) {
      epoch++;
      for (const controller of controllers) controller.abort();
      controllers.clear(); writes.clear(); flight = null; advanceFlight = null; nextAdvanceAt = 0; applied = 0; floor = 0; lastError = '';
      context = { ...context, ...next };
      context.accountId = String(context.accountId);
      context.characterId = context.characterId == null ? null : String(context.characterId);
      emit(null);
      return getContext();
    }
    function getContext() { return { ...context, epoch }; }
    function accept(scene, ticket) {
      if (!scene || scene.schemaVersion !== 1) throw Object.assign(new Error('戰況格式尚未就緒，請重新同步'), { code: 'invalid_scene', uncertain: false });
      if (String(scene.accountId) !== context.accountId || scene.realmId !== context.realmId || (context.characterId && String(scene.characterId) !== context.characterId)) throw contextError();
      if (scene.run && (String(scene.run.characterId) !== String(scene.characterId) || scene.run.realmId !== scene.realmId)) throw contextError();
      if (ticket < applied || ticket < floor) throw staleError();
      const previous = snapshot;
      if (previous && previous.characterId === scene.characterId && previous.realmId === scene.realmId) {
        if (Number(scene.live?.revision) < Number(previous.live?.revision)) throw staleError();
        if (scene.run?.id && scene.run.id === previous.run?.id && Number(scene.run.revision) < Number(previous.run.revision)) throw staleError();
      }
      context.characterId = String(scene.characterId);
      applied = ticket; lastError = ''; emit(scene);
      return scene;
    }
    async function request(action, body = {}, requestOptions = {}) {
      if (disposed) throw contextError();
      if (!/^[a-z][a-z0-9/-]*$/.test(action)) throw new Error('Invalid local action');
      const generation = epoch, captured = { ...context }, ticket = ++sequence, read = READS.has(action);
      if (!read) { floor = ticket; writes.add(ticket); }
      const controller = new AbortController(); controllers.add(controller);
      const deadline = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
      const external = requestOptions.signal, abort = () => controller.abort();
      if (external?.aborted) controller.abort(); else external?.addEventListener('abort', abort, { once: true });
      let response, data, acceptedScene = false;
      try {
        try {
          const headers = { 'Content-Type': 'application/json', 'X-Realm-Id': captured.realmId };
          if (options.telegramInitData) headers['X-Telegram-Init-Data'] = options.telegramInitData;
          else headers['X-Dev-Tg-Id'] = captured.accountId;
          const artRevision = globalThis.RpgMonsterExpansion?.revision || globalThis.RpgMonsterExpansionArtRevision;
          if (typeof artRevision === 'string' && /^[\x21-\x7e]{1,200}$/.test(artRevision)) headers['X-Monster-Art-Revision'] = artRevision;
          response = await send(endpoint + action, {
            method: 'POST', mode: 'cors', credentials: 'omit',
            headers,
            body: JSON.stringify({ ...body, ...(SCOPED_REALM_ACTIONS.has(action) ? { realmId: captured.realmId } : {}), ...(captured.characterId && !['characters','select'].includes(action) ? { selectedCharacterId: captured.characterId } : {}) }), signal: controller.signal,
          });
          data = await response.json();
        } catch (cause) {
          if (generation !== epoch || disposed) throw contextError();
          throw Object.assign(new Error(options.telegramInitData?'遊戲服務暫時無法連線，請重新同步':'本機遊戲服務尚未連線，請重新同步'), { cause, uncertain: !read, code: controller.signal.aborted ? 'request_aborted' : 'connection_failed' });
        }
        if (generation !== epoch || disposed) throw contextError();
        if (!response.ok || data.ok === false) {
          const error = Object.assign(new Error(data.message || '資料暫時無法同步'), { code: data.error, status: response.status, uncertain: !read && response.status >= 500 });
          if (action === 'exchange/action-scoped' && data.definitiveRejection === true) error.exchangeRejection = data;
          if (data.error === 'character_changed') {
            setContext({ characterId: null });
            queueMicrotask(() => { if (!disposed && !selecting) void refresh().catch(() => {}); });
          }
          throw error;
        }
        if (data.scene) {
          if (read) accept(data.scene, ticket);
          else {
            // The receipt confirms the write even when its attached projection
            // was superseded. Ignore that projection and read the newest one.
            try {
              const scene = accept(data.scene, ticket);
              acceptedScene = true;
              // The accepted write projection is applied before publishing its
              // own committed trace. A preferred scene avoids a redundant read.
              if (generation === epoch && snapshot === scene && data.combatTrace) emitCombatTrace(data.combatTrace, scene);
            } catch (error) { lastError = error.message; }
          }
        }
        // A successful write remains successful even when the subsequent read is offline.
        if (!read && action !== 'select' && !(requestOptions.preferScene && acceptedScene)) {
          await refresh({ force: true }).catch(error => { if (generation === epoch) lastError = error.message; });
        }
        if (generation !== epoch || disposed) throw contextError();
        return data;
      } finally {
        clearTimeout(deadline);
        controllers.delete(controller); writes.delete(ticket); external?.removeEventListener('abort', abort);
      }
    }
    function refresh({ force = false } = {}) {
      if (disposed) return Promise.reject(contextError());
      if (selecting) return Promise.resolve(snapshot);
      if (flight && !force) return flight.promise;
      if (flight && force) flight.controller.abort();
      if (force) floor = sequence + 1;
      const controller = new AbortController(), generation = epoch, entry = { controller, promise: null };
      entry.promise = request('atlas/status', {}, { signal: controller.signal }).then(data => {
        if (generation !== epoch) throw contextError();
        if (!data.scene) throw Object.assign(new Error('出征服務缺少場景資料'), { code: 'invalid_scene', uncertain: false });
        return snapshot;
      }).catch(error => {
        if (generation === epoch && error.code !== 'stale_response' && error.code !== 'context_changed' && error.code !== 'request_aborted') {
          lastError = error.message;
          options.onError?.(error);
        }
        throw error;
      }).finally(() => { if (flight === entry) flight = null; });
      flight = entry;
      return entry.promise;
    }
    // Only the page controller advances. Window refreshes remain read-only.
    // Every attempt discovers the current run first; an unknown response is
    // never retried inside this pass, nor does this replay any manual action.
    function sync() {
      if (disposed) return Promise.reject(contextError());
      if (selecting || options.isHidden?.()) return Promise.resolve(snapshot);
      if (advanceFlight) return advanceFlight.promise;
      const generation = epoch, entry = { promise: null };
      entry.promise = refresh().then(async () => {
        if (generation !== epoch || disposed) throw contextError();
        if (selecting || options.isHidden?.() || writes.size || now() < nextAdvanceAt) return snapshot;
        const run = snapshot?.run;
        if (!run?.active || run.status !== 'running' || snapshot.live?.activeRunId !== run.id) return snapshot;
        if (!Number.isFinite(snapshot.serverNow) || !Number.isFinite(run.processedAt) || snapshot.serverNow - run.processedAt < 1000) return snapshot;
        nextAdvanceAt = now() + (snapshot?.run?.map?.progression?1000:pollMs);
        try {
          // One bounded server chunk (at most 2,000 engine steps) per cadence.
          await request('atlas/settle', { runId: run.id }, { preferScene: true });
        } catch (error) {
          if (generation === epoch && !['context_changed', 'stale_response'].includes(error.code)) {
            lastError = error.message;
            options.onError?.(error);
          }
          throw error;
        }
        return snapshot;
      }).finally(() => { if (advanceFlight === entry) advanceFlight = null; });
      advanceFlight = entry;
      return entry.promise;
    }
    async function selectCharacter(characterId) {
      if (selecting) throw Object.assign(new Error('正在切換角色'), { code: 'selection_busy', uncertain: false });
      const target = String(characterId);
      if (!target) throw new Error('請選擇角色');
      selecting = true; setContext({ characterId: null });
      const generation = epoch;
      try {
        const data = await request('select', { charId: target });
        if (generation !== epoch) throw contextError();
        if (String(data.selected) !== target || data.realmId !== context.realmId) throw contextError();
        setContext({ characterId: target });
        return data;
      } finally {
        selecting = false;
        // Discovery is read-only, including after a lost selection response.
        if (!disposed) await refresh({ force: true }).catch(() => {});
      }
    }
    // Owner decision (2026-11-10): no timed status polling. start() reads the
    // state once; later reads follow a player action or the manual 同步 control.
    // Atlas runs keep advancing on the server's one-minute background sweep.
    // options.autoSync === true restores the former cadence (tests/tools only).
    let started = false;
    function start() {
      if (started || disposed) return;
      started = true;
      if (options.autoSync !== true) { void sync().catch(() => {}); return; }
      const run = () => { if (!selecting && !options.isHidden?.()&&now()>=nextPollAt){nextPollAt=now()+(snapshot?.run?.map?.progression?1000:pollMs);void sync().catch(() => {});} };
      run(); timer = (options.setInterval || globalThis.setInterval)(run, Math.min(1000,pollMs));
    }
    function dispose() {
      if (disposed) return; disposed = true;
      if (timer) (options.clearInterval || globalThis.clearInterval)(timer);
      timer = null; epoch++;
      for (const controller of controllers) controller.abort();
      controllers.clear(); writes.clear(); flight = null; advanceFlight = null; emit(null); listeners.clear(); traceListeners.clear();
    }
    return { request, refresh, sync, setContext, getContext, selectCharacter, start, dispose,
      getSnapshot: () => snapshot, getError: () => lastError,
      subscribe(listener) { listeners.add(listener); listener(snapshot); return () => listeners.delete(listener); },
      // No replay on subscribe: a settled receipt is a one-time visual event.
      subscribeCombatTrace(listener) { traceListeners.add(listener); return () => traceListeners.delete(listener); },
    };
  }
  const api = { create };
  globalThis.RpgSceneSession = api;
  const config = globalThis.__RpgScenePreviewConfig;
  // The production host installs a signed Telegram session, including on local
  // staging. Never fall through to the preview's synthetic identity.
  if (config?.telegram === true) return;
  if (!config?.live || !globalThis.document || !/^http:\/\/127\.0\.0\.1:\d+$/.test(globalThis.location?.origin || '')) return;
  if (!/^http:\/\/127\.0\.0\.1:\d+\/app\/api\/$/.test(config.endpoint || '')) throw new Error('Local scene endpoint must use loopback');
  const session = create({ endpoint: config.endpoint, accountId: config.accountId || '90101', realmId: config.realmId || 'permanent',
    isHidden: () => document.hidden,
    onSnapshot: value => window.dispatchEvent(new CustomEvent('rpg:scene-state', { detail: value })),
    onCombatTrace: (trace, scene) => window.dispatchEvent(new CustomEvent('rpg:combat-trace', { detail: { trace, scene } })),
    onError: error => window.dispatchEvent(new CustomEvent('rpg:scene-error', { detail: { message: error.message, code: error.code } })),
  });
  Object.assign(api, session);
  // No refresh on tab return (owner decision 2026-11-10); use the scene's 同步 control.
  window.addEventListener('pagehide', () => session.dispose(), { once: true });
  session.start();
})();
