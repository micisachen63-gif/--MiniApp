/* Render committed Atlas snapshots in the independent local scene.
 * Artwork stays in its source catalogs; this renderer never simulates combat,
 * settles an expedition, invents rewards, or substitutes another character. */
(function (global) {
  'use strict';
  // Use the real opaque hero bounds; the cloud and full angel stay above the face.
  function guardianPlacement(bounds,root){
    if(!bounds||!root)return null;
    const ceiling=64,gap=10,cloudHeight=Math.min(68,Math.max(54,root.width*.17)),available=bounds.y-root.top-ceiling-gap-cloudHeight;
    if(available<64)return null;
    const size=Math.min(220,Math.max(164,bounds.height*.95,root.width*.46),available),cloudWidth=Math.min(root.width-16,size*1.08);
    const center=Math.max(cloudWidth/2+8,Math.min(root.width-cloudWidth/2-8,bounds.x+bounds.width/2-root.left));
    return {size,left:center-size/2,top:bounds.y-root.top-gap-cloudHeight-size,cloudLeft:center-cloudWidth/2,cloudTop:bounds.y-root.top-gap-cloudHeight,cloudWidth,cloudHeight};
  }
  const guardianCameraOffset=height=>height>=600?Math.min(92,height*.1):0;
  const liveMode = () => global.__RpgScenePreviewConfig?.live === true;
  const MAPS = Object.freeze({
    laurel_intro: { themeId: 1, kind: 'tutorial', sourceMap: 1 },
    pillar_intro: { themeId: 2, kind: 'tutorial', sourceMap: 2 },
    grove_intro: { themeId: 3, kind: 'tutorial', sourceMap: 3 },
    laurel_warden: { themeId: 1, kind: 'boss', sourceMap: 1 },
    laurel_survey: { themeId: 1, kind: 'survey', sourceMap: 1 },
    pillar_survey: { themeId: 2, kind: 'survey', sourceMap: 2 },
    grove_survey: { themeId: 3, kind: 'survey', sourceMap: 3 },
  });
  const ENEMIES = Object.freeze([
    ['laurel_intro', 'normal', '月光野兔', 'moon_hare'],
    ['laurel_intro', 'elite', '阿耳忒彌斯巡林長', 'artemis_ranger'],
    ['pillar_intro', 'normal', '百柱石像', 'temple_statue'],
    ['pillar_intro', 'elite', '神殿禁衛百夫長', 'temple_centurion'],
    ['grove_intro', 'normal', '潘神幼獸', 'pan_cub'],
    ['grove_intro', 'elite', '狂暴潘神衛士', 'pan_warden'],
    ['laurel_warden', 'boss', '月桂巨樹精', 'ancient_laurel'],
    ['laurel_survey', 'normal', '月光野兔', 'moon_hare'],
    ['laurel_survey', 'elite', '阿耳忒彌斯巡林長', 'artemis_ranger'],
    ['pillar_survey', 'normal', '百柱石像', 'temple_statue'],
    ['pillar_survey', 'elite', '神殿禁衛百夫長', 'temple_centurion'],
    ['grove_survey', 'normal', '潘神幼獸', 'pan_cub'],
    ['grove_survey', 'elite', '狂暴潘神衛士', 'pan_warden'],
  ]);
  const EVENT_NAMES = { room_entered: '進入新區域', enemy_defeated: '擊敗敵人', map_completed: '完成星圖', completed: '完成派遣', stopped: '返營', dead: '倒地返營', exhausted: '補給耗盡', timed_out: '派遣結束' };
  const ENCOUNTER_NAMES = { elite_hunt: '精英追獵', treasure: '寶藏', spring: '補給泉水', ambush: '伏擊' };
  const ITEM_NAMES = { scroll_w: '武器強化卷', scroll_a: '防具強化卷' };
  const viewers = new Set(), metadata = new Map();
  let endgameArt=null;
  function loadEndgameArt(){if(!liveMode()||!global.fetch)return;void global.fetch('/endgame-map-art.json',{credentials:'same-origin'}).then(r=>{if(!r.ok)throw Error('map-art');return r.json();}).then(data=>{endgameArt=data;viewers.forEach(view=>view.apply(lastSnapshot));}).catch(()=>{});}
  let lastSnapshot = null, lastSyncError = '', nextViewId = 0, hudMounted = false, syncBusy = false;
  const hudSkills = { scope: '', generation: 0, controller: null, status: 'unknown', requestedRevision: -1, revision: -1, slots: [], shown: null };
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const pretty = value => number(value) === null ? '—' : new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(value);
  const text = (node, value) => { if (node && node.textContent !== String(value)) node.textContent = String(value); };
  const clamp = value => Math.max(0, Math.min(1, value));
  const byId = id => global.document?.getElementById(id);
  function reportText(run) {
    if (!run) return '尚無派遣紀錄';
    const report = run.report || {}, parts = ['金幣 ' + pretty(report.gold), '經驗 ' + pretty(report.exp)];
    if (number(report.equipment) !== null) parts.push('裝備 ' + pretty(report.equipment) + ' 件');
    if (report.items && typeof report.items === 'object' && !Array.isArray(report.items)) {
      const entries = Object.entries(report.items).filter(([, amount]) => number(amount) !== null && amount >= 0);
      const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
      const detail = entries.filter(([, amount]) => amount > 0).map(([item, amount]) => (ITEM_NAMES[item] || '其他道具') + ' × ' + pretty(amount));
      parts.push('道具 ' + pretty(total) + ' 件' + (detail.length ? '（' + detail.join('、') + '）' : ''));
    }
    if (number(report.metrics?.encountersCompleted) !== null) parts.push('完成遭遇 ' + pretty(report.metrics.encountersCompleted) + ' 次');
    return '本趟累計：' + parts.join(' · ');
  }
  function eventText(event) {
    if (event.type === 'encounter') {
      const name = event.name || ENCOUNTER_NAMES[event.encounterId] || '特殊遭遇';
      const recovery = number(event.hpRestored) !== null && number(event.mpRestored) !== null
        ? ' · 回復生命 ' + pretty(event.hpRestored) + ' / 魔力 ' + pretty(event.mpRestored) : '';
      return '遇到' + name + recovery;
    }
    if (event.type === 'encounter_completed') return '完成遭遇：' + (ENCOUNTER_NAMES[event.encounterId] || '特殊遭遇');
    if (event.type === 'loot_equipment') return '取得裝備 1 件';
    if (event.type === 'loot_scroll') return '取得' + (ITEM_NAMES[event.item] || '強化卷') + (number(event.quantity) !== null ? ' × ' + pretty(event.quantity) : '');
    return EVENT_NAMES[event.type] || '派遣狀態已更新';
  }
  function experienceProgress(value) {
    if (!value || number(value.current) === null || value.current < 0 || number(value.ratio) === null || value.ratio < 0 || value.ratio > 1) return null;
    if (value.maxLevel === true && value.required === null) return value;
    return value.maxLevel === false && number(value.required) !== null && value.required > 0 ? value : null;
  }
  function experienceLabel(value) {
    const progress = experienceProgress(value);
    if (!progress) return 'EXP 待同步';
    if (progress.maxLevel) return 'EXP 已達滿級';
    return 'EXP ' + (progress.ratio * 100).toFixed(1) + '% · ' + pretty(progress.current) + ' / ' + pretty(progress.required);
  }
  function syncHudExperience(model, ui = global.UI, syncError = '') {
    const value = model?.live?.experience, progress = experienceProgress(value), xp = byId('xp');
    const authority = progress ? (syncError ? 'stale' : 'committed') : 'unknown';
    const label = (authority === 'stale' ? '上次同步 · ' : '') + experienceLabel(value);
    if (xp) {
      xp.setAttribute('role', 'progressbar'); xp.setAttribute('aria-label', '角色經驗');
      xp.setAttribute('aria-valuetext', label); xp.setAttribute('aria-valuemin', '0'); xp.setAttribute('aria-valuemax', '100'); xp.title = label;
      if (progress) xp.setAttribute('aria-valuenow', String(Math.round(progress.ratio * 100)));
      else xp.removeAttribute('aria-valuenow');
    }
    ui?.setXP?.(progress ? progress.ratio : 0);
    const fill = byId('xpfill');
    if (fill) { fill.style.visibility = progress ? 'visible' : 'hidden'; fill.dataset.authority = authority; }
    const caption = byId('scene-xp-caption');
    if (caption) {
      text(caption, label); caption.dataset.authority = authority;
    }
  }
  function mapAsset(map) {
    if(/^cycle_(normal|elite|expert|nightmare|hell)_\d{2}$/.test(map?.id||'')){
      const art=endgameArt?.[map.id];if(!art||map.progression?.mode!==art.mode||map.progression?.chapter!==art.chapter)return null;
      return {...art,sourceMap:art.roster[0].sourceMap};
    }
    const source = MAPS[map?.id];
    return source && map.themeId === source.themeId && map.kind === source.kind ? source : null;
  }
  function enemyAsset(map, enemy) {
    const source = mapAsset(map);
    if (!source) return null;
    if(map.progression){const row=source.roster.find(x=>x.id===enemy?.art?.spriteId&&x.sourceMap===enemy.art.sourceMap);return row?{...source,sourceMap:row.sourceMap,spriteId:row.id}:null;}
    const row = ENEMIES.find(row => row[0] === map.id && row[1] === enemy?.rank && row[2] === enemy?.name);
    return row ? { ...source, spriteId: row[3] } : null;
  }
  // Idle (no Atlas run, not away): show the character's current idle map, the same
  // level band the server idles on (formulas.mapForLevel + endgame cycle), instead of
  // an empty 營地. Purely cosmetic and local: no request, no timer, no extrapolation.
  const IDLE_THEME_NAMES = ['阿耳忒彌斯月桂林', '雅典娜百柱神殿', '阿卡迪亞聖林', '波賽頓愛琴海崖', '克里特迷宮門庭', '赫淮斯托斯熔爐', '冥河斯堤克斯渡口', '德爾菲阿波羅神諭谷', '泰坦諸神山隘', '奧林帕斯雲門', '至福樂土', '奧林帕斯星穹聖殿'];
  const IDLE_MODES = [['normal', '普通'], ['elite', '菁英'], ['expert', '專家'], ['nightmare', '惡夢'], ['hell', '地獄']];
  function idleCrowdCount(w) { return w < 360 ? 6 : w < 700 ? 8 : 12; }
  function idleCrowdSlot(w, h, actor, slot) {
    const angle = -Math.PI / 2 + .65 + slot / Math.max(1, idleCrowdCount(w) - 1) * (Math.PI * 2 - 1.3);
    return { x: actor.x + Math.cos(angle) * Math.min(w * .36, h * .23),
      y: actor.y + Math.sin(angle) * h * .13 + h * .02 };
  }
  function idleMapFor(character, art = endgameArt) {
    const level = Math.max(1, Math.min(600, Math.floor(number(character?.level) || 0)));
    if (!number(character?.level) || character.level < 1) return null;
    const server = character.idleMap, serverMode = typeof server?.mode === 'string' ? server.mode : null;
    const serverChapter = Number.isInteger(server?.chapter) ? server.chapter : (Number.isInteger(server?.mapId) ? server.mapId : null);
    const modeIndexFromServer = serverMode ? IDLE_MODES.findIndex(row => row[0] === serverMode) : -1;
    const useServer = modeIndexFromServer >= 0 && serverChapter >= 1 && serverChapter <= 12;
    const modeIndex = useServer ? modeIndexFromServer : Math.min(4, Math.floor((level - 1) / 120));
    const chapter = useServer ? serverChapter : Math.min(12, Math.ceil(((level - 1) % 120 + 1) / 10));
    const [mode, modeName] = IDLE_MODES[modeIndex], id = (useServer && typeof server.cycleId === 'string' && server.cycleId) || ('cycle_' + mode + '_' + String(chapter).padStart(2, '0')), entry = art?.[id];
    if (!entry || entry.mode !== mode || entry.chapter !== chapter || !Array.isArray(entry.roster)) return null;
    const themeId = (chapter - 1 + modeIndex * 5) % 12 + 1;
    const place = (useServer && server.place) || entry.name || IDLE_THEME_NAMES[themeId - 1];
    return { id, name: (useServer && server.name) || (place + '-' + modeName), place, themeId: null, kind: 'idle', idle: true, progression: { mode, chapter }, follow: useServer ? server.follow !== false : true, maps: useServer && Array.isArray(server.maps) ? server.maps : null };
  }
  // Normal-cycle rosters use prefixed ids (mon_/elite_/boss_[x13_mNN_]) while the map
  // sprite metadata keys are the plain names; resolve to whichever key really exists.
  function resolveSprite(data, asset) {
    if (!asset?.spriteId || data?.[asset.spriteId + '_idle']) return asset;
    const plain = String(asset.spriteId).replace(/^(?:mon|elite|boss)_(?:x13_m\d{2}_)?/, '');
    return plain !== asset.spriteId && data?.[plain + '_idle'] ? { ...asset, spriteId: plain } : asset;
  }
  function normalize(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== 1 || !snapshot.characterId || !snapshot.realmId || !snapshot.accountId || !snapshot.character || !snapshot.live) return null;
    if (String(snapshot.character.id) !== String(snapshot.characterId)) return null;
    const run = snapshot.run;
    if (run && (String(run.characterId) !== String(snapshot.characterId) || run.realmId !== snapshot.realmId)) return null;
    const active = !!run?.active && String(snapshot.live.activeRunId) === String(run.id);
    const supplies = active ? run.supplies : snapshot.live.supplies, totals = active ? null : supplies?.totals;
    return {
      context: [snapshot.realmId, snapshot.accountId, snapshot.characterId].join(':'),
      snapshot, character: snapshot.character, live: snapshot.live, run,
      active, map: active ? run.map : null,
      hero: active ? run.hero : snapshot.live,
      supplies: totals ? { ...supplies,
        hp: number(totals.hp) !== null && totals.hp >= 0 ? totals.hp : supplies.hp,
        mp: number(totals.mp) !== null && totals.mp >= 0 ? totals.mp : supplies.mp } : supplies,
      enemies: active && Array.isArray(run.enemies) ? run.enemies : [],
    };
  }
  async function readMetadata(sourceMap) {
    if (!metadata.has(sourceMap)) {
      const promise = global.fetch('/map' + sourceMap + '/meta.json', { credentials: 'same-origin' }).then(response => {
        if (!response.ok) throw Error('怪物素材資料尚未載入');
        return response.json();
      }).catch(error => { metadata.delete(sourceMap); throw error; });
      metadata.set(sourceMap, promise);
    }
    return metadata.get(sourceMap);
  }
  function spriteMetadata(data, asset, action) {
    const key = asset.spriteId + '_' + action, source = data?.[key];
    const heights = source?.frameInfo?.map(frame => frame.h).filter(value => Number.isFinite(value) && value > 0) || [];
    if (!source || source.file !== key + '.webp' || !['idle', 'walk', 'attack', 'death'].includes(action)
      || !Number.isInteger(source.cellW) || source.cellW < 1 || source.cellW > 4096
      || !Number.isInteger(source.cellH) || source.cellH < 1 || source.cellH > 4096
      || !Number.isInteger(source.frames) || source.frames < 1 || source.frames > 64
      || !Number.isFinite(source.ox) || !Number.isFinite(source.oy) || !heights.length) throw Error('怪物動作資料待核對');
    return { ...source, body: heights.reduce((sum, value) => sum + value, 0) / heights.length };
  }
  // Classic 星環遠征中 / 組隊冒險中 away view. The server snapshot carries the
  // character's party_id (ring:* for 星環); while it is set, normal idle is paused,
  // so show the classic full-screen expedition video instead of an idle 營地.
  const AWAY_BASE = '/ui-generated-20261030/hud-angels-20261102/expedition-away';
  function awayActivity(value) {
    if (!value || value.active) return null;
    const id = value.live?.partyId;
    if (typeof id !== 'string' || !id) return null;
    return { kind: id.startsWith('ring:') ? 'star-ring' : 'party', id };
  }
  const awayTitle = activity => activity.kind === 'star-ring' ? '星環遠征中' : '組隊冒險中';
  let awayState = { key: '', layer: null, unmount: null }, awayLoad = null;
  function loadAway(doc) {
    if (global.RpgExpeditionAway?.markup) return Promise.resolve(global.RpgExpeditionAway);
    if (!awayLoad) awayLoad = new Promise((resolve, reject) => {
      if (!doc.querySelector('link[data-scene-away-css]')) {
        const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = AWAY_BASE + '.css'; link.setAttribute('data-scene-away-css', ''); doc.head.appendChild(link);
      }
      const script = doc.createElement('script'); script.src = AWAY_BASE + '.js';
      script.onload = () => global.RpgExpeditionAway?.markup ? resolve(global.RpgExpeditionAway) : reject(Error('expedition-away'));
      script.onerror = () => reject(Error('expedition-away'));
      doc.head.appendChild(script);
    }).catch(error => { awayLoad = null; throw error; });
    return awayLoad;
  }
  function clearAway(doc) {
    if (!awayState.key && !awayState.layer && !awayState.unmount) return;
    try { awayState.unmount?.(); } catch {}
    awayState.layer?.remove();
    awayState = { key: '', layer: null, unmount: null };
    try { doc?.documentElement?.classList?.remove?.('rpg-scene-away'); } catch {}
  }
  function syncAway(value) {
    const doc = global.document;
    if (!doc || !liveMode()) return Promise.resolve(null);
    const activity = awayActivity(value);
    if (!activity) { clearAway(doc); return Promise.resolve(null); }
    const key = value.context + ':' + activity.id;
    if (awayState.key === key) return Promise.resolve(awayState.layer);
    awayState.key = key;
    return loadAway(doc).then(away => {
      if (awayState.key !== key) return null;
      const html = away.markup({ activity, character: { tgId: value.character.id, partyId: activity.id } });
      try { awayState.unmount?.(); } catch {}
      awayState.layer?.remove(); awayState.layer = null; awayState.unmount = null;
      if (!html) { clearAway(doc); return null; }
      const stage = doc.getElementById('stage') || doc.body, hud = doc.getElementById('ui');
      // No timed polling: the player taps 重新整理狀態 to see whether the expedition has ended.
      const refreshButton = '<button type="button" class="btn ghost" data-away-refresh>重新整理狀態</button>';
      const tail = html.lastIndexOf('</div></section>');
      const layer = doc.createElement('div'); layer.className = 'scene-away-layer';
      layer.innerHTML = tail >= 0 ? html.slice(0, tail) + refreshButton + html.slice(tail) : html;
      layer.addEventListener?.('click', event => {
        const button = event.target?.closest?.('[data-away-refresh]'); if (!button || syncBusy) return;
        button.disabled = true; button.textContent = '讀取中…';
        void refresh().finally(() => { if (button.isConnected !== false) { button.disabled = false; button.textContent = '重新整理狀態'; } });
      });
      if (hud && hud.parentNode === stage) stage.insertBefore(layer, hud); else stage.appendChild(layer);
      awayState.layer = layer; awayState.unmount = away.mount(layer);
      doc.documentElement.classList.add('rpg-scene-away');
      return layer;
    }).catch(() => { if (awayState.key === key) awayState.key = ''; return null; });
  }
  global.RpgExpeditionOpen ||= kind => global.RpgSceneNavigation?.navigate(kind === 'star-ring' ? 'star-ring' : 'party', kind === 'star-ring' ? {} : { tab: 'current' });
  function publish(snapshot) {
    if (!liveMode()) return;
    lastSnapshot = snapshot || null; lastSyncError = '';
    if (!normalize(lastSnapshot)) clearHudResources();
    if (hudMounted) readHudSkills(lastSnapshot);
    viewers.forEach(view => view.apply(lastSnapshot));
    syncHudActions(normalize(lastSnapshot));
    void syncAway(normalize(lastSnapshot));
  }
  function publishCombatTrace(trace, receiptScene = null) {
    if (!liveMode()) return Promise.resolve([]);
    return Promise.all([...viewers].map(view => view.ingestCombatTrace(trace, receiptScene)));
  }
  global.addEventListener('rpg:scene-state', event => publish(event.detail));
  global.addEventListener('rpg:combat-trace', event => {
    const detail = event.detail;
    if (detail?.trace) void publishCombatTrace(detail.trace, detail.scene).catch(() => {});
  });
  global.addEventListener('rpg:scene-error', event => {
    if (!liveMode()) return;
    lastSyncError = String(event.detail?.message || '遊戲狀態同步失敗');
    clearHudSkills('offline', true);
    viewers.forEach(view => view.showSyncError(lastSyncError));
    syncHudActions(normalize(lastSnapshot));
  });
  function mount(scene, hooks) {
    if (!liveMode()) return null;
    const { hero, animator, ui, ground, hpGraphics } = hooks;
    const viewId = ++nextViewId, entities = new Map(), resources = new Map(), textureKeys = new Set(), animationKeys = new Set();
    let disposed = false, model = null, context = '', appearance = null, actorGeneration = 0, mapGeneration = 0, currentMap = '', currentRoom = '', currentRun = '', lastRevision = null;
    let campReady = false, idle = null, idleCast = null;
    let groundReady = false, mapLoading = false, groundImage = null, width = 0, height = 0, actorIssue = '', mapIssue = '', syncError = lastSyncError, assetIssues = new Map(), seenEvents = new Set();
    const doc = global.document;
    let vfxPlayer = null, vfxBridge = null, vfxCanvas = null, vfxInit = null, vfxIssue = '', vfxLayout = '', vfxLayoutChanges = 0, vfxSize = '', vfxLastTrace = null, vfxTraceSequence = 0;
    const vfxController = new AbortController();
    doc.documentElement.classList.add('rpg-live-scene');
    const panel = doc.createElement('section'); panel.className = 'scene-live-panel'; panel.id = 'scene-live-status'; panel.setAttribute('aria-label', '出征狀態');
    panel.innerHTML = '<div class="scene-live-heading"><strong data-live-title></strong><span data-live-sync></span><button type="button" data-live-collapse aria-label="收合戰況" aria-expanded="true">▴</button></div><p data-live-progress></p><p data-live-supplies></p><p class="scene-live-warning" data-live-connection role="status" hidden></p><p class="scene-live-warning" data-live-warning role="status"></p><div class="scene-live-buttons"><button type="button" data-live-expedition>星圖派遣</button><button type="button" data-live-characters>選擇角色</button><button type="button" data-live-refresh>同步</button></div><details><summary>已結算紀錄與敵人</summary><p data-live-report></p><ul class="scene-live-enemies" data-live-enemies></ul><ol class="scene-live-events" data-live-events></ol></details>';
    (byId('ui') || doc.body).appendChild(panel);
    const nodes = Object.fromEntries(['title', 'sync', 'progress', 'supplies', 'connection', 'warning', 'report', 'enemies', 'events', 'expedition', 'characters', 'refresh', 'collapse'].map(key => [key, panel.querySelector('[data-live-' + key + ']')]));
    const statusToggle = doc.createElement('button');
    statusToggle.type = 'button'; statusToggle.className = 'scene-live-status-toggle';
    statusToggle.setAttribute('data-live-open-status', ''); statusToggle.setAttribute('aria-haspopup', 'dialog');
    statusToggle.textContent = '查看出征狀態'; statusToggle.hidden = true;
    statusToggle.onclick = () => { openedFromStatusToggle = statusFocusScope(); ui.toggle('live-status'); };
    (byId('ui') || doc.body).appendChild(statusToggle);
    let statusLayoutFrame = 0, statusLayoutSignature = '', statusInDialog = false, keepStatusToggle = false, openedFromStatusToggle = null, returnStatusFocus = null;
    // Measure the rendered HUD rather than reusing the old fixed 212px dock.
    // The existing renderer owns actor scale/camera and the existing window
    // manager owns the only dialog. This projection never reads or writes API data.
    function statusFocusScope() {
      const scope = global.RpgSceneSession?.getContext?.();
      if (!scope || scope.accountId == null || !scope.realmId || !scope.characterId || !Number.isInteger(scope.epoch)) return null;
      return JSON.stringify([String(scope.accountId), scope.realmId, String(scope.characterId), scope.epoch]);
    }
    function arrangeStatus() {
      if (disposed || !panel.getBoundingClientRect || !panel.style?.setProperty) return;
      const root = byId('ui'), chat = byId('chat');
      if (!root?.getBoundingClientRect || !chat?.getBoundingClientRect) return;
      const bounds = root.getBoundingClientRect(), chatBounds = chat.getBoundingClientRect();
      if (!(bounds.width > 0 && bounds.height > 0 && chatBounds.height > 0)) return;
      if (returnStatusFocus && returnStatusFocus !== statusFocusScope()) returnStatusFocus = null;
      const actorBounds = geometry().hero?.screenBounds, gap = 8;
      const toggleStyle = global.getComputedStyle?.(statusToggle);
      const sideLeft = bounds.left + (Number.parseFloat(toggleStyle?.left) || 8);
      const sideWidth = Number.parseFloat(toggleStyle?.width) || Math.min(270, bounds.width - 24);
      const crossesActor = actorBounds && sideLeft < actorBounds.right + gap && sideLeft + sideWidth > actorBounds.x - gap;
      const docked = (bounds.width <= 600 && bounds.height > 550) || !!crossesActor;
      if (docked && !actorBounds) return;
      const top = docked ? actorBounds.bottom + gap : bounds.top + (bounds.height <= 500 ? 80 : bounds.width <= 600 ? 91 : 108);
      const available = Math.max(0, chatBounds.top - gap - top);
      // When even a 44px control will not fit, Adventure keeps the permanent
      // status entry. Never force a floating target back over the actor.
      const navigationOnly = available < 44;
      const compact = navigationOnly || available < 168 || (statusInDialog && keepStatusToggle);
      const bottom = Math.max(0, bounds.bottom - chatBounds.top + gap);
      const cssTop = docked ? 'auto' : Math.round(top - bounds.top) + 'px';
      const cssBottom = docked ? Math.ceil(bottom) + 'px' : 'auto';
      const maxHeight = Math.floor(available) + 'px';
      const signature = [docked, compact, navigationOnly, cssTop, cssBottom, maxHeight, statusInDialog].join('|');
      if (signature === statusLayoutSignature && !returnStatusFocus) return;
      statusLayoutSignature = signature;
      const focusedInPanel = !statusInDialog && panel.contains?.(doc.activeElement);
      const focusedToggle = doc.activeElement === statusToggle;
      panel.style.top = cssTop; panel.style.bottom = cssBottom; panel.style.maxHeight = maxHeight;
      statusToggle.style.top = cssTop; statusToggle.style.bottom = cssBottom;
      panel.classList.toggle('is-compact', compact);
      statusToggle.hidden = !compact || navigationOnly;
      const returnTarget = navigationOnly ? root.querySelector('[data-scene-primary="adventure"]') : compact ? statusToggle : panel;
      const restoreAfterDialog = returnStatusFocus && !root.querySelector('[role="dialog"]');
      if (!statusInDialog && ((focusedInPanel && compact) || (focusedToggle && statusToggle.hidden) || restoreAfterDialog)) {
        if (returnTarget === panel) panel.tabIndex = -1;
        returnTarget?.focus?.({ preventScroll: true });
      }
      if (restoreAfterDialog) returnStatusFocus = null;
    }
    function scheduleStatusLayout() {
      if (disposed || statusLayoutFrame || typeof global.requestAnimationFrame !== 'function') return;
      statusLayoutFrame = global.requestAnimationFrame(() => {
        if (disposed) return;
        // Let Phaser publish its current camera matrix before projecting bounds.
        statusLayoutFrame = global.requestAnimationFrame(() => {
          statusLayoutFrame = 0; if (!disposed) arrangeStatus();
        });
      });
    }
    const statusObserver = typeof global.ResizeObserver === 'function' ? new global.ResizeObserver(scheduleStatusLayout) : null;
    for (const target of [byId('ui'), byId('chat'), byId('bottom'), scene.game?.canvas]) {
      if (target?.getBoundingClientRect) statusObserver?.observe(target);
    }
    // Only direct root changes matter: the existing manager moves navigation
    // back and removes its dialog on close, including after an intermediate page.
    const statusNavigationObserver = typeof global.MutationObserver === 'function' ? new global.MutationObserver(scheduleStatusLayout) : null;
    if (byId('ui')) statusNavigationObserver?.observe(byId('ui'), { childList: true });
    function mountStatus(body) {
      if (disposed || statusInDialog || !body?.appendChild) return null;
      const parent = panel.parentNode, next = panel.nextSibling, inert = panel.inert, returnToToggle = openedFromStatusToggle;
      openedFromStatusToggle = null; keepStatusToggle = !statusToggle.hidden; statusInDialog = true;
      panel.classList.add('scene-live-status-in-dialog'); panel.inert = false;
      body.appendChild(panel); scheduleStatusLayout();
      let closed = false;
      return { dispose() {
        if (closed) return; closed = true;
        statusInDialog = false; keepStatusToggle = false;
        if (disposed) return;
        panel.classList.remove('scene-live-status-in-dialog');
        if (next?.parentNode === parent) parent.insertBefore(panel, next); else parent?.appendChild(panel);
        panel.inert = inert; returnStatusFocus = returnToToggle || returnStatusFocus; statusLayoutSignature = ''; scheduleStatusLayout();
      } };
    }
    nodes.expedition.onclick = () => ui.toggle('expedition');
    nodes.characters.onclick = () => ui.toggle('scene-characters');
    nodes.refresh.onclick = () => void refresh();

    // Keep the narrow battlefield visible; details remain one tap away.
    let panelCollapsed = !!global.matchMedia?.('(max-width: 600px)').matches;
    function collapsePanel(value) {
      panelCollapsed = !!value;
      panel.setAttribute('data-collapsed', String(panelCollapsed));
      nodes.collapse?.setAttribute('aria-expanded', String(!panelCollapsed));
      nodes.collapse?.setAttribute('aria-label', panelCollapsed ? '展開戰況' : '收合戰況');
      if (nodes.collapse) nodes.collapse.textContent = panelCollapsed ? '▾' : '▴';
    }
    if (nodes.collapse) nodes.collapse.onclick = () => collapsePanel(!panelCollapsed);
    collapsePanel(panelCollapsed);

    ui.skills?.forEach(skill => { skill.left = 0; skill.el.inert = true; skill.el.setAttribute('aria-disabled', 'true'); });
    byId('buffs')?.replaceChildren();
    const portraitCanvas=byId('pc');if(portraitCanvas){portraitCanvas.width=224;portraitCanvas.height=224;}
    const pc = portraitCanvas?.getContext('2d');pc?.setTransform?.(2,0,0,2,0,0);pc?.clearRect(0, 0, 112, 112);
    const originalPortraitDraw=pc?.drawImage;
    const portraitDraw=originalPortraitDraw&&function(image,...args){
      if(args.length===8&&args[6]===112&&args[7]===112&&image?.naturalWidth){
        const size=Math.min(image.naturalWidth,image.naturalHeight)*.70;
        // Headroom and a wider crop keep off-centre faces inside the round bezel.
        return originalPortraitDraw.call(this,image,image.naturalWidth*.53-size/2,-image.naturalHeight*.08,size,size,0,0,112,112);
      }
      return originalPortraitDraw.call(this,image,...args);
    };
    if(pc&&portraitDraw)pc.drawImage=portraitDraw;
    const guardianNode=doc.createElement('img');guardianNode.className='scene-live-guardian';guardianNode.hidden=true;guardianNode.alt='';guardianNode.setAttribute('aria-hidden','true');
    const guardianCloud=doc.createElement('span');guardianCloud.className='scene-live-guardian-cloud';guardianCloud.hidden=true;guardianCloud.setAttribute('aria-hidden','true');guardianCloud.innerHTML='<i></i><b></b>';
    (byId('ui')||doc.body).appendChild(guardianNode);(byId('ui')||doc.body).appendChild(guardianCloud);
    let guardianReady=false,guardianSource='';const visibleBoundsCache=new Map();
    guardianNode.onload=()=>{guardianReady=true;};guardianNode.onerror=()=>{guardianReady=false;guardianNode.hidden=true;};
    function placeGuardian(){
      const guardian=model?.character?.guardian;
      const heroGeometry=guardian&&animator.ready&&hero.visible?geometry().hero:null,bounds=heroGeometry?.visibleBounds||heroGeometry?.screenBounds,root=guardian?byId('ui')?.getBoundingClientRect():null;
      if(!guardian||!['melee','ranged','magic','loot'].includes(guardian.type)||!bounds||!root){guardianCloud.hidden=true;guardianNode.hidden=true;guardianSource='';guardianReady=false;return;}
      const src='/art/guardian-sigil-20261013/'+guardian.type+'.webp';
      const p=guardianPlacement(bounds,root);if(!p){guardianNode.hidden=true;guardianCloud.hidden=true;return;}
      // The cloud is visible while the exact original angel image loads.
      guardianCloud.style.left=p.cloudLeft+'px';guardianCloud.style.top=p.cloudTop+'px';guardianCloud.style.width=p.cloudWidth+'px';guardianCloud.style.height=p.cloudHeight+'px';guardianCloud.hidden=false;
      if(guardianSource!==src){guardianSource=src;guardianReady=false;guardianNode.hidden=true;guardianNode.src=src;}
      if(!guardianReady){guardianNode.hidden=true;return;}
      guardianNode.style.width=p.size+'px';guardianNode.style.height=p.size+'px';guardianNode.style.left=p.left+'px';guardianNode.style.top=p.top+'px';guardianNode.hidden=false;
    }

    hero.setVisible(false); ground?.setVisible(false); hooks.clearDecorations?.(); hpGraphics?.clear(); ui.target(null);
    const current = () => !disposed && liveMode();

    function vfxContext() {
      return model?.active && model.run?.id ? {
        accountId: String(model.snapshot.accountId), realmId: model.snapshot.realmId,
        characterId: String(model.snapshot.characterId), dispatchId: String(model.run.id),
      } : null;
    }
    function vfxRoom() {
      return model?.active ? { mapIndex: model.run.mapIndex, roomIndex: model.run.roomIndex } : null;
    }
    function projectVfxPoint(value) {
      const camera = scene.cameras.main, gameCanvas = scene.game.canvas;
      if (!vfxCanvas || !gameCanvas || !value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
      const source = gameCanvas.getBoundingClientRect(), overlay = vfxCanvas.getBoundingClientRect();
      if (source.width <= 0 || source.height <= 0 || scene.scale.width <= 0 || scene.scale.height <= 0) return null;
      const px = value.x - camera.scrollX, py = value.y - camera.scrollY;
      const point = camera.matrix?.transformPoint(px, py) || { x: camera.x + px * camera.zoom, y: camera.y + py * camera.zoom };
      return { x: source.left - overlay.left + point.x * source.width / scene.scale.width,
        y: source.top - overlay.top + point.y * source.height / scene.scale.height };
    }
    function resolveVfxGeometry(event, { placement } = {}) {
      if (!model?.active || event.mapIndex !== model.run.mapIndex || event.roomIndex !== model.run.roomIndex) return null;
      // Wait only for real snapshot entities with a known art mapping. There is
      // no synthetic point for a removed target or an unsupported source.
      const expected = event.targetIds.map(targetId => model.enemies.find(enemy => enemy.id === targetId));
      if (expected.some(enemy => !enemy || !enemyAsset(model.map, enemy))) return null;
      if (!mapAsset(model.map)) return null;
      if (!groundReady || !animator.ready || !hero.visible) {
        return appearance && (mapLoading || groundReady) ? { pending: true } : null;
      }
      const from = projectVfxPoint({ x: hero.x, y: hero.y });
      if (!from) return null;
      if (placement) return event.targetIds.length === 0 ? { from, to: { ...from }, targets: [], direction: animator.direction } : null;
      const targets = [], sprites = [];
      for (const targetId of event.targetIds) {
        const entity = entities.get(currentRoom + ':' + targetId), sprite = entity?.sprite;
        // A current, still-rendered death pose has a real location. Removed or
        // previous-room enemies have none and must never receive invented hits.
        if (!sprite?.active || !sprite.visible || !sprite.frame?.data?.sourceSize) return entity?.loading && entity.enemy.hp > 0 ? { pending: true } : null;
        const bounds = sprite.getBounds();
        if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return null;
        const target = projectVfxPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
        if (!target) return null;
        targets.push(target); sprites.push(sprite);
      }
      if (!targets.length) return null;
      return { from, to: targets[0], targets, facing: { dx: sprites[0].x - hero.x, dy: sprites[0].y - hero.y } };
    }
    function syncVfxCanvas() {
      if (!vfxCanvas || !vfxPlayer) return;
      const canvas = scene.game.canvas, box = canvas.getBoundingClientRect(), parent = canvas.parentElement.getBoundingClientRect();
      vfxCanvas.style.left = (box.left - parent.left) + 'px'; vfxCanvas.style.top = (box.top - parent.top) + 'px';
      vfxCanvas.style.width = box.width + 'px'; vfxCanvas.style.height = box.height + 'px';
      const size = [box.width, box.height, global.devicePixelRatio || 1].join(':');
      if (size !== vfxSize) {
        if (vfxSize) { vfxBridge?.clear('viewport-changed'); idleCast?.clear('viewport-changed'); }
        vfxSize = size; vfxPlayer.resize(box.width, box.height);
      }
    }
    function ensureVfx() {
      if (vfxInit) return vfxInit;
      vfxInit = (async () => {
        const [{ createLiveVfxPlayer }, { createActorVfxBridge }, { createIdleCastController }, response] = await Promise.all([
          import('/awakening-vfx-live.mjs'), import('/skill-vfx-actor-bridge.mjs'),
          import('/scene-idle-cast.mjs'),
          global.fetch('/skill-vfx-catalog.json', { signal: vfxController.signal, credentials: 'same-origin' }),
        ]);
        if (!response.ok) throw Error('技能目錄尚未載入');
        const catalog = await response.json();
        if (!current() || vfxController.signal.aborted) return null;
        const host = scene.game.canvas?.parentElement;
        if (!host) throw Error('技能畫布尚未就緒');
        vfxCanvas = doc.createElement('canvas'); vfxCanvas.className = 'scene-live-skill-vfx'; vfxCanvas.dataset.sceneSkillVfx = 'true';
        vfxCanvas.setAttribute('aria-hidden', 'true');
        Object.assign(vfxCanvas.style, { position: 'absolute', pointerEvents: 'none', zIndex: '2' });
        host.appendChild(vfxCanvas);
        vfxPlayer = createLiveVfxPlayer(vfxCanvas, { catalog, assetBase: '/art/skill-vfx-20261104/', maxActive: 8, quality: 'high' });
        syncVfxCanvas();
        vfxBridge = createActorVfxBridge({
          player: vfxPlayer, animator, hero, getContext: vfxContext, getRoom: vfxRoom,
          getActorId: () => appearance || animator.actor?.id,
          getBodyHeight: () => Math.abs(hero.scaleY) * 300,
          resolveGeometry: resolveVfxGeometry, projectPoint: projectVfxPoint,
          profilesUrl: '/skill-vfx-actor-profiles.json', nativePresentationsUrl: '/scene-native-cast-profiles.json', document: doc,
        });
        idleCast = createIdleCastController({ animator, hero, document: doc,
          hidden: () => doc.hidden, getScope: idleCastScope,
          load: async () => ({ player: vfxPlayer, catalog }), geometry: idleCastGeometry,
          project: projectVfxPoint, bodyHeight: () => Math.abs(hero.scaleY) * 300,
          profilesUrl: '/skill-vfx-actor-profiles.json', nativePresentationsUrl: '/scene-native-cast-profiles.json',
        });
        vfxBridge.syncContext(); vfxIssue = '';
        return vfxBridge;
      })().catch(error => {
        if (current()) vfxIssue = error.message || '技能呈現尚未就緒';
        vfxBridge?.destroy(); vfxPlayer?.destroy(); vfxCanvas?.remove();
        vfxBridge = null; vfxPlayer = null; vfxCanvas = null;
        return null;
      });
      return vfxInit;
    }
    async function ingestCombatTrace(trace, receiptScene = null) {
      const sequence = ++vfxTraceSequence;
      if (!current() || (receiptScene && model?.snapshot !== receiptScene)) return { accepted: false, reason: 'scene-changed', results: [] };
      const bridge = await ensureVfx();
      if (!current() || !bridge || (receiptScene && model?.snapshot !== receiptScene)) return { accepted: false, reason: bridge ? 'scene-changed' : 'vfx-not-ready', results: [] };
      const result = await bridge.ingestTrace(trace);
      if (sequence === vfxTraceSequence) vfxLastTrace = {
        revision: trace?.revision, dispatchId: trace?.context?.dispatchId, eventCount: trace?.events?.length || 0,
        accepted: result.accepted, reason: result.reason || null, results: result.results,
      };
      return result;
    }
    function pauseVfx() { vfxBridge?.clear('scene-paused'); idleCast?.clear('scene-paused'); vfxPlayer?.clear(); }

    function idleCastScope() { return model && idle && !model.active && !awayActivity(model) ? context + ':' + idle.map.id : ''; }
    function idleCastGeometry(round, raw) {
      if (!idleCastScope() || !groundReady || !animator.ready || !hero.visible) return null;
      // Two persisted resolver targets are replayed in stable visible slots;
      // the additional crowd is presentation only and never invents cast IDs.
      const crowd = [...entities.values()].filter(e => e.key.startsWith('idle:') && e.sprite?.active && !e.dying)
        .sort((a, b) => a.enemy.slot - b.enemy.slot);
      if (idle.bindingRound !== round.id) {
        if (crowd.length < round.before.length) return null;
        idle.bindingRound = round.id;
        idle.castBindings = round.before.map((enemy, i) => ({ id: enemy.id, key: crowd[i].key }));
      }
      const from = projectVfxPoint({ x: hero.x, y: hero.y - Math.abs(hero.scaleY) * 150 });
      const foot = projectVfxPoint(hero), targets = [], world = new Map();
      if (!from || !foot) return null;
      for (const binding of idle.castBindings) {
        const entity = entities.get(binding.key), sprite = entity?.sprite;
        if (!sprite?.active || entity.dying) continue;
        const bounds = sprite.getBounds();
        const point = projectVfxPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
        if (!point) return null;
        targets.push({ id: binding.id, point, bodyHeight: height * sprite.pct });
        world.set(binding.id, sprite);
      }
      targets.push({ id: String(model.character.id), point: from, bodyHeight: Math.abs(hero.scaleY) * 300 });
      return { actorId: String(model.character.id), from, foot, targets,
        bodyHeight: Math.abs(hero.scaleY) * 300, direction: animator.activeDirection,
        targetWorld: world.get(raw.targetIds[0]) || hero };
    }

    let idleMapOpen = false, idleMapBusy = false, idleMapError = '', idleMapSignature = '';
    function expLabel(factor) {
      if (factor === 1) return '經驗全額';
      if (factor === 0.5) return '經驗 50%';
      return '無經驗';
    }
    function ensureIdleMapPicker() {
      const zone = doc.querySelector('#zone');
      if (!zone) return null;
      let box = doc.getElementById('idle-map-picker');
      if (box) return box;
      box = doc.createElement('div');
      box.id = 'idle-map-picker';
      box.className = 'idle-map-picker';
      box.hidden = true;
      zone.insertAdjacentElement('afterend', box);
      box.addEventListener('click', event => {
        const toggle = event.target.closest('[data-idle-map-toggle]');
        if (toggle) { event.preventDefault(); idleMapOpen = !idleMapOpen; idleMapSignature = ''; syncIdleMapPicker(model, awayActivity(model)); return; }
        const follow = event.target.closest('[data-idle-map-follow]');
        if (follow) return;
        const mapBtn = event.target.closest('[data-idle-map]');
        if (mapBtn && !mapBtn.disabled) void commitIdleMap({ follow: false, mapId: Number(mapBtn.dataset.idleMap) });
      });
      box.addEventListener('change', event => {
        const follow = event.target.closest('[data-idle-map-follow]');
        if (follow) void commitIdleMap(follow.checked ? { follow: true } : { follow: false, mapId: Number(model?.character?.idleMap?.mapId) || idle?.map?.progression?.chapter });
      });
      return box;
    }
    async function commitIdleMap(body) {
      if (idleMapBusy || !global.RpgSceneSession?.request) return;
      idleMapBusy = true; idleMapError = ''; idleMapSignature = ''; syncIdleMapPicker(model, awayActivity(model));
      try {
        await global.RpgSceneSession.request('idle-map', body);
      } catch (error) {
        idleMapError = error.message || '地圖切換失敗';
      } finally {
        idleMapBusy = false; idleMapSignature = ''; syncIdleMapPicker(model, awayActivity(model));
      }
    }
    function syncIdleMapPicker(value, away) {
      const box = ensureIdleMapPicker();
      if (!box) return;
      const show = !!(value && !value.active && !away && idle?.map);
      box.hidden = !show;
      if (!show) { idleMapOpen = false; box.classList.remove('is-open'); return; }
      const view = value.character?.idleMap || {};
      const maps = Array.isArray(view.maps) ? view.maps : (Array.isArray(idle.map.maps) ? idle.map.maps : []);
      const follow = view.follow !== false;
      const selected = view.mapId || idle.map.progression?.chapter;
      const signature = [show, idleMapOpen, follow, selected, idleMapBusy, idleMapError, maps.map(m => [m.mapId, m.reached, m.mode, m.expFactor, m.locked].join(':')).join('|')].join('#');
      if (signature === idleMapSignature) return;
      idleMapSignature = signature;
      box.classList.toggle('is-open', idleMapOpen);
      const list = maps.length ? maps.map(row => {
        const locked = !row.reached || row.locked;
        const label = locked ? (row.place || ('地圖 ' + row.mapId)) + ' · 未到達' : (row.place || ('地圖 ' + row.mapId)) + ' · ' + (row.modeName || '') + ' · ' + expLabel(row.expFactor);
        const selectedClass = !locked && row.mapId === selected ? ' is-selected' : '';
        const lockedClass = locked ? ' is-locked' : '';
        return '<li><button type="button" class="idle-map-item' + selectedClass + lockedClass + '" data-idle-map="' + row.mapId + '"' + (locked || idleMapBusy ? ' disabled' : '') + (follow && row.current ? ' data-current="true"' : '') + '>' + (row.emoji ? row.emoji + ' ' : '') + label + '</button></li>';
      }).join('') : '<li class="idle-map-empty">地圖清單同步中</li>';
      box.innerHTML = '<button type="button" class="idle-map-toggle" data-idle-map-toggle aria-expanded="' + String(idleMapOpen) + '">' + (idleMapOpen ? '收合地圖' : '選擇地圖') + '</button>'
        + '<div class="idle-map-panel"' + (idleMapOpen ? '' : ' hidden') + '>'
        + '<label class="idle-map-follow"><input type="checkbox" data-idle-map-follow' + (follow ? ' checked' : '') + (idleMapBusy ? ' disabled' : '') + '>跟隨等級</label>'
        + '<p class="idle-map-hint">可選擇曾到達的地圖掛機。低於目前地圖兩張以上沒有經驗；本輪尚未到達的地圖使用上一輪模式。</p>'
        + (idleMapError ? '<p class="idle-map-error" role="alert">' + idleMapError + '</p>' : '')
        + '<ul class="idle-map-list">' + list + '</ul></div>';
    }

    function refreshHud() {
      if (!current()) return;
      const value = model, health = value?.hero;
      hero.hp = number(health?.hp) ?? 0; hero.mhp = number(health?.maxHp) ?? 0;
      syncHudResources(value, ui, syncError);
      text(doc.querySelector('#topL .who b'), value?.character.name ? value.character.name+' · '+(value.character.progression?.modeName||'普通') : '角色同步中');
      text(doc.querySelector('#topL .portrait i'), value ? pretty(value.character.level) : '—');
      text(byId('gold'), value ? '◈ ' + pretty(value.live.gold) : '◈ —');
      const away = awayActivity(value);
      text(doc.querySelector('#zone b'), value?.active ? value.map?.name || '星圖探索' : away ? awayTitle(away) : idle ? '掛機中 · ' + idle.map.place : value ? '營地' : '同步中');
      text(doc.querySelector('#zone span'), value?.active ? '已結算 ' + pretty(value.run.processedSeconds) + ' 秒' : away ? '一般掛機暫停' : value ? (value.snapshot.realmId === 'permanent' ? '永久世界' : '賽季世界') + ' · Lv.' + pretty(value.character.level) : '等待遊戲狀態');
      syncIdleMapPicker(value, away);
      syncHudActions(value);
      nodes.refresh.disabled = syncBusy;
      scheduleStatusLayout();
    }
    function status() {
      if (!current()) return;
      const value = model, run = value?.run;
      const away = awayActivity(value);
      text(nodes.title, value ? value.active ? '星圖探索中' : away ? awayTitle(away) : idle ? '掛機中 · ' + idle.map.place : '營地' : '正在同步角色');
      text(nodes.sync, value?.snapshot.serverNow ? new Date(value.snapshot.serverNow).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '');
      text(nodes.progress, value ? value.active ? '已結算 ' + pretty(run.processedSeconds) + ' 秒 · 擊敗 ' + pretty(run.report?.kills) + ' 隻' : run ? '最近派遣：' + ({ completed: '已完成', stopped: '已返營', dead: '倒地返營' }[run.status] || '已結束') : '選擇星圖並派遣後，這裡會顯示實際進度。' : '等待遊戲服務回覆。');
      text(nodes.supplies, value ? (value.active ? '隨身補給' : '可攜帶補給') + ' · 生命 ' + pretty(value.supplies?.hp) + ' / 魔力 ' + pretty(value.supplies?.mp) : '補給 —');
      const unmapped = value?.enemies.filter(enemy => enemy.hp > 0 && !enemyAsset(value.map, enemy)).length || 0;
      const issues = [actorIssue, mapIssue, unmapped ? unmapped + ' 名敵人的素材尚未對應' : '', ...assetIssues.values()].filter(Boolean);
      text(nodes.warning, [...new Set(issues)].join('；')); nodes.warning.hidden = !issues.length;
      text(nodes.connection, syncError ? (value ? '同步失敗，顯示上次資料。' : '同步失敗，尚未取得資料。') : '');
      nodes.connection.title = syncError || '';
      nodes.connection.hidden = !syncError;
      nodes.expedition.disabled = !value; nodes.refresh.disabled = syncBusy;
      text(nodes.report, reportText(run));
      const enemies = value?.enemies || [];
      nodes.enemies.replaceChildren(...enemies.map(enemy => {
        const item = doc.createElement('li'); item.textContent = enemy.name + ' · ' + pretty(enemy.hp) + ' / ' + pretty(enemy.maxHp) + (enemyAsset(value.map, enemy) ? '' : ' · 素材待對應'); return item;
      }));
      const events = (run?.events || []).slice(-8);
      nodes.events.replaceChildren(...events.map(event => {
        const item = doc.createElement('li'), time = number(event.atMs);
        const stamp = time !== null ? new Date(time).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) + ' · ' : '';
        item.textContent = stamp + eventText(event); return item;
      }));
      refreshHud();
    }
    function destroyEntity(entity){if(entity.aura){scene.tweens.killTweensOf(entity.aura);entity.aura.destroy();}entity.sprite?.destroy();}
    function releaseAssets() {
      for (const entity of entities.values()) destroyEntity(entity); entities.clear(); hooks.setMonsters([]);
      for (const key of animationKeys) scene.anims.remove(key); animationKeys.clear();
      // Keep Phaser images on a persistent frame before releasing owned textures.
      if (ground?.active !== false) { ground?.setVisible(false); if (scene.textures.exists('ground')) ground?.setTexture('ground'); }
      for (const key of textureKeys) if (scene.textures.exists(key)) scene.textures.remove(key); textureKeys.clear(); resources.clear();
      groundReady = false; campReady = false; mapLoading = false; groundImage = null; ground?.setVisible(false); hpGraphics?.clear(); ui.target(null);
    }
    function resource(kind, key, url, frame) {
      if (resources.has(key)) return resources.get(key);
      const generation = mapGeneration;
      const promise = new Promise((resolve, reject) => {
        const event = 'filecomplete-' + kind + '-' + key;
        const cleanup = () => { scene.load.off(event, done); scene.load.off('loaderror', failed); };
        const done = () => {
          cleanup();
          if (!current() || generation !== mapGeneration) { if (scene.textures.exists(key)) scene.textures.remove(key); resolve(null); return; }
          textureKeys.add(key); resolve(key);
        };
        const failed = file => { if (file?.key === key) { cleanup(); reject(Error('場景素材載入失敗')); } };
        scene.load.once(event, done); scene.load.on('loaderror', failed);
        if (kind === 'image') scene.load.image(key, url); else scene.load.spritesheet(key, url, frame);
        scene.load.start();
      }).catch(error => {
        // A transient loader failure must not poison the same asset key forever.
        if (resources.get(key) === promise) resources.delete(key);
        throw error;
      });
      resources.set(key, promise); return promise;
    }
    function syncMonsters() { hooks.setMonsters([...entities.values()].map(entity => entity.sprite).filter(sprite => sprite?.active)); }
    function layout() {
      const resized = width !== scene.scale.width || height !== scene.scale.height;
      const previousHero = { x: hero.x, y: hero.y };
      width = scene.scale.width; height = scene.scale.height;
      const camera = scene.cameras.main;
      camera.setViewport(0, 0, width, height);
      if ((groundReady || campReady) && groundImage) {
        const scale = Math.max(height * 2.6 / groundImage.height, width * 1.8 / groundImage.width), world = { w: groundImage.width * scale, h: groundImage.height * scale };
        ground.setOrigin(0).setScale(scale); hooks.setWorld(world); camera.setBounds(0, 0, world.w, world.h);
      }
      const world = hooks.getWorld(); hero.setPosition(world.w / 2, world.h * .6);
      // Reserve positions for the whole committed encounter, including art
      // still loading. Materializing one sprite must not move the others or
      // invalidate a real cast waiting for its target's geometry.
      const roster = [...entities.values()];
      const slots = roster.map((entity, index) => {
        if (entity.key.startsWith('idle:') && Number.isInteger(entity.enemy.slot)) return { entity, ...idleSlot(entity, entity.enemy.slot) };
        const angle = -Math.PI + (index + 1) / (roster.length + 1) * Math.PI;
        const radius = height * (entity.enemy.rank === 'boss' ? .34 : .29);
        return { entity, x: hero.x + Math.cos(angle) * Math.min(radius, width * .3),
          y: hero.y + Math.sin(angle) * radius * .7 };
      });
      for (const { entity, x, y } of slots) {
        if (!entity.sprite?.active) continue;
        if (entity.key.startsWith('idle:')) {
          entity.goal = { x, y };
          if (!entity.placed) {
            entity.sprite.setPosition(hero.x + (x - hero.x) * 1.7, hero.y + (y - hero.y) * 1.7);
            entity.placed = true;
          } else if (resized || hero.x !== previousHero.x || hero.y !== previousHero.y) entity.sprite.setPosition(x, y);
        } else entity.sprite.setPosition(x, y);
        if(entity.aura)entity.aura.setPosition(x,y).setDisplaySize(height*.36,height*.36).setDepth(y-.5);
        const pose = entity.motionMetadata?.[entity.motion];
        entity.sprite.setScale(height * entity.sprite.pct / (pose?.body || entity.idleBody)).setFlipX(x > hero.x).setDepth(y);
      }
      // A committed snapshot repositions the whole encounter at once. The art
      // demo's lerped follow otherwise leaves actors off-screen after map/size
      // changes even though their world coordinates and visibility are valid.
      // Reserve overhead space for the full angel/cloud stack; only the camera moves.
      camera.stopFollow().centerOn(hero.x, hero.y-(model?.character?.guardian?guardianCameraOffset(height):0));
      hero.setDepth(hero.y); drawBars(); scheduleStatusLayout();
      const layoutKey = JSON.stringify([width, height, world.w, world.h, hero.x, hero.y, slots.map(slot => [slot.entity.enemy.id, slot.x, slot.y])]);
      // setMap already invalidates the old scene. The first ready background
      // establishes this map's real geometry; pending casts may then resolve it.
      if (groundReady) {
        if (vfxLayout && vfxLayout !== layoutKey) { vfxLayoutChanges++; vfxBridge?.clear('layout-changed'); }
        vfxLayout = layoutKey;
      }
      syncVfxCanvas();
    }
    function setMap(map) {
      vfxBridge?.clear('map-changed'); idleCast?.clear('map-changed'); vfxPlayer?.clear(); vfxLayout = '';
      ++mapGeneration; currentMap = map ? [map.id, map.themeId, map.kind].join(':') : ''; currentRoom = ''; assetIssues.clear(); releaseAssets(); mapIssue = '';
      if (map?.idle && !mapAsset(map)) map = null;
      if (!map) {
        if(model){const generation=mapGeneration;
          void resource('image','live-'+viewId+'-'+generation+'-camp','/ui-proto/assets/ground.webp').then(texture=>{
            if(!texture||!current()||generation!==mapGeneration)return;
            ground.setTexture(texture).setVisible(true);groundImage=scene.textures.get(texture).getSourceImage();campReady=true;layout();
          }).catch(()=>{});
        }
        layout();return;
      }
      const asset = mapAsset(map), generation = mapGeneration;
      if (!asset) { mapIssue = '此星圖背景待對應'; layout(); return; }
      const key = 'live-' + viewId + '-' + generation + '-ground'; mapLoading = true;
      void resource('image', key, asset.background||'/map' + asset.sourceMap + '/map' + asset.sourceMap + '_ground.webp').then(texture => {
        if (!texture || !current() || generation !== mapGeneration) return;
        ground.setTexture(texture).setVisible(true); groundImage = scene.textures.get(texture).getSourceImage(); groundReady = true; layout();
      }).catch(() => { if (current() && generation === mapGeneration) { if (map.idle) { idle = null; currentMap = ''; setMap(null); return; } mapIssue = '地圖背景尚未載入'; status(); } })
        .finally(() => { if (current() && generation === mapGeneration) mapLoading = false; });
      layout();
    }
    async function loadEnemy(entity) {
      const generation = mapGeneration; entity.loading = true;
      try {
        const data = await readMetadata(entity.asset.sourceMap), asset = entity.asset = resolveSprite(data, entity.asset), idle = spriteMetadata(data, asset, 'idle');
        if (!current() || generation !== mapGeneration || entities.get(entity.key) !== entity) return;
        const key = 'live-' + viewId + '-' + generation + '-' + asset.spriteId + '-idle';
        const texture = await resource('spritesheet', key, '/map' + asset.sourceMap + '/' + idle.file, { frameWidth: idle.cellW, frameHeight: idle.cellH, endFrame: idle.frames - 1 });
        if (!texture || !current() || generation !== mapGeneration || entities.get(entity.key) !== entity) return;
        const animation = key + '-animation';
        if (!scene.anims.exists(animation)) { scene.anims.create({ key: animation, frames: scene.anims.generateFrameNumbers(texture, { start: 0, end: idle.frames - 1 }), frameRate: 6, repeat: -1 }); animationKeys.add(animation); }
        const sprite = entity.sprite = scene.add.sprite(hero.x, hero.y, texture).setOrigin(idle.ox, idle.oy);
        entity.idleBody = idle.body; entity.metadata = data; assetIssues.delete(entity.key);
        sprite.nm = asset.spriteId; sprite.role = entity.enemy.rank === 'normal' ? 'minion' : entity.enemy.rank; sprite.pct = sprite.role === 'boss' ? .38 : sprite.role === 'elite' ? .26 : .18;
        sprite.hp = entity.enemy.hp; sprite.mhp = entity.enemy.maxHp; sprite.play(animation);
        entity.animations = { idle: animation }; entity.motionMetadata = { idle }; entity.motion = 'idle';
        if (entity.key.startsWith('idle:')) for (const action of ['walk', 'attack']) {
          // Optional authored clips. Missing movement art keeps the original idle
          // pose; it never substitutes a different monster or creates new pixels.
          void (async () => {
            try {
              const clip = spriteMetadata(data, asset, action), clipKey = key + '-' + action;
              const loaded = await resource('spritesheet', clipKey, '/map' + asset.sourceMap + '/' + clip.file,
                { frameWidth: clip.cellW, frameHeight: clip.cellH, endFrame: clip.frames - 1 });
              if (!loaded || generation !== mapGeneration || entities.get(entity.key) !== entity) return;
              const anim = clipKey + '-animation';
              if (!scene.anims.exists(anim)) { scene.anims.create({ key: anim,
                frames: scene.anims.generateFrameNumbers(loaded, { start: 0, end: clip.frames - 1 }),
                frameRate: 8, repeat: action === 'walk' ? -1 : 0 }); animationKeys.add(anim); }
              entity.animations[action] = anim;
              entity.motionMetadata[action] = clip;
              if (action === 'attack') entity.attackMs = clip.frames * 125;
            } catch (_) { /* This exact monster has no usable optional clip. */ }
          })();
        }
        if(asset.aura){const auraKey=await resource('image','live-'+viewId+'-'+generation+'-mode-aura',asset.aura);if(auraKey&&current()&&generation===mapGeneration&&entities.get(entity.key)===entity){entity.aura=scene.add.image(sprite.x,sprite.y,auraKey).setOrigin(.5,.65).setAlpha(.4).setBlendMode('ADD');scene.tweens.add({targets:entity.aura,alpha:.65,duration:1800,yoyo:true,repeat:-1});}}
        syncMonsters(); layout();
        if (entity.enemy.hp <= 0) beginDeath(entity);
        status();
      } catch (_) { if (current() && generation === mapGeneration && entities.get(entity.key) === entity) { assetIssues.set(entity.key, entity.enemy.name + '素材待載入'); status(); } }
      finally { if (entities.get(entity.key) === entity) entity.loading = false; }
    }
    function beginDeath(entity) {
      if (entity.dying || !entity.sprite) return;
      entity.dying = true; entity.enemy = { ...entity.enemy, hp: 0 }; entity.sprite.hp = 0;
      const generation = mapGeneration, sprite = entity.sprite, asset = entity.asset;
      void (async () => {
        try {
          const death = spriteMetadata(entity.metadata, asset, 'death'), key = 'live-' + viewId + '-' + generation + '-' + asset.spriteId + '-death';
          const texture = await resource('spritesheet', key, '/map' + asset.sourceMap + '/' + death.file, { frameWidth: death.cellW, frameHeight: death.cellH, endFrame: death.frames - 1 });
          if (!texture || !current() || generation !== mapGeneration || entities.get(entity.key) !== entity || !sprite.active) return;
          const animation = key + '-animation';
          if (!scene.anims.exists(animation)) { scene.anims.create({ key: animation, frames: scene.anims.generateFrameNumbers(texture, { start: 0, end: death.frames - 1 }), frameRate: 10, repeat: 0 }); animationKeys.add(animation); }
          // Keep the standing anatomical scale. A collapsed bounding box must
          // never be stretched back to the standing display height.
          sprite.setOrigin(death.ox, death.oy).setScale(scene.scale.height * sprite.pct / entity.idleBody);
          sprite.play(animation);
          scene.time.delayedCall(death.frames * 100 + 300, () => { if (entities.get(entity.key) === entity) { destroyEntity(entity); entities.delete(entity.key); syncMonsters(); drawBars(); } });
        } catch (_) { if (entities.get(entity.key) === entity) { destroyEntity(entity); entities.delete(entity.key); syncMonsters(); assetIssues.set(entity.key, entity.enemy.name + '倒地素材待載入'); status(); } }
      })();
    }
    function reconcileEnemies() {
      const room = model?.active ? [model.run.id, model.run.mapIndex, model.run.roomIndex].join(':') : idle ? 'idle:' + idle.map.id : '';
      const encounterMap = model?.active ? model.map : idle?.map || null, encounter = model?.active ? model.enemies : idle?.enemies || [];
      if (room !== currentRoom) { vfxBridge?.clear('room-changed'); for (const entity of entities.values()) destroyEntity(entity); entities.clear(); assetIssues.clear(); currentRoom = room; }
      const wanted = new Set();
      for (const enemy of encounter) {
        const key = room + ':' + enemy.id, asset = enemyAsset(encounterMap, enemy); wanted.add(key);
        let entity = entities.get(key);
        if (entity) {
          entity.enemy = enemy;
          if (entity.sprite) { entity.sprite.hp = enemy.hp; entity.sprite.mhp = enemy.maxHp; if (enemy.hp <= 0) beginDeath(entity); }
          else if (asset && enemy.hp > 0 && !entity.loading) void loadEnemy(entity);
        } else if (asset && enemy.hp > 0) { entity = { key, enemy, asset, sprite: null, dying: false, loading: false }; entities.set(key, entity); void loadEnemy(entity); }
      }
      for (const [key, entity] of entities) if (!wanted.has(key) && !entity.dying) { destroyEntity(entity); entities.delete(key); assetIssues.delete(key); }
      syncMonsters(); layout();
    }
    function drawBars() {
      hpGraphics?.clear();
      const alive = [...entities.values()].filter(entity => entity.sprite?.active && entity.enemy.hp > 0);
      for (const entity of alive) {
        const sprite = entity.sprite, ratio = clamp(entity.enemy.hp / Math.max(1, entity.enemy.maxHp)), w = scene.scale.height * (entity.enemy.rank === 'boss' ? .16 : entity.enemy.rank === 'elite' ? .09 : .06), h = Math.max(3, scene.scale.height * .006), x = sprite.x - w / 2, y = sprite.y - scene.scale.height * sprite.pct * 1.08;
        hpGraphics?.fillStyle(0x000000, .75).fillRect(x - 1, y - 1, w + 2, h + 2); hpGraphics?.fillStyle(0xb84135, 1).fillRect(x, y, w * ratio, h);
      }
      const list = model?.active ? model.enemies : idle?.enemies || [];
      const target = list.find(enemy => enemy.hp > 0 && enemy.rank === 'boss') || list.find(enemy => enemy.hp > 0 && enemy.rank === 'elite') || list.find(enemy => enemy.hp > 0);
      if (target) ui.target(target.name, target.rank === 'normal' ? 'minion' : target.rank, clamp(target.hp / Math.max(1, target.maxHp))); else ui.target(null);
    }
    function clearActor() {
      vfxBridge?.clear('actor-changed');
      idleCast?.clear('actor-changed'); vfxPlayer?.clear();
      ++actorGeneration; appearance = null; hooks.resetReadability?.();
      if (hero.active !== false) { hero.anims?.stop(); hero.setVisible(false); if (scene.textures.exists('hero_idle')) hero.setTexture('hero_idle'); }
      animator.destroy(); pc?.clearRect(0, 0, 112, 112);
    }
    function ensureActor() {
      const wanted = model?.character.appearanceKey;
      if (!wanted) { if (appearance !== null) clearActor(); actorIssue = model ? '此角色外觀尚未對應' : ''; return; }
      if (appearance === wanted) return;
      clearActor();
      const generation = ++actorGeneration; appearance = wanted; actorIssue = '角色素材載入中'; hero.setVisible(false);
      void animator.load(wanted).then(loaded => {
        if (!current() || generation !== actorGeneration || !model) return;
        if (!loaded) { appearance = null; hero.setVisible(false); actorIssue = '此角色素材尚未交付或載入失敗'; status(); return; }
        const directions = Object.keys(animator.clips.idle || {}), direction = directions.includes('down') ? 'down' : directions.includes('right') ? 'right' : directions[0];
        if (!direction || !animator.play('idle', direction, true)) { appearance = null; animator.ready = false; hero.setVisible(false); actorIssue = '此角色待機素材尚未交付'; }
        else { actorIssue = ''; hero.setVisible(true); animator.update(0); vfxBridge?.syncContext(); }
        status();
      }).catch(() => { if (current() && generation === actorGeneration) { appearance = null; hero.setVisible(false); actorIssue = '此角色素材尚未交付或載入失敗'; status(); } });
    }
    // Cosmetic idle combat on the idle map: the hero swings at a nearby monster, it
    // takes hits, dies with its own death clip and a new one respawns. Driven only by
    // the Phaser frame clock in update(); committed numbers come from the server.
    const IDLE_SWING_MS = 1150, IDLE_RESPAWN_MS = 1600;
    // An open arc surrounds the hero. Keep the north gap clear for the guardian.
    // Population is visual: server kill budgets, rewards and potion use are unchanged.
    function idleCount() { return idleCrowdCount(width); }
    function idleSlot(entity, slot) {
      return idleCrowdSlot(width, height, hero, slot);
    }
    function startIdle(map) {
      const state = { map, enemies: [], rows: [], next: 0, nextTarget: 0, seq: 0, clock: 0, swingAt: 600, respawnAt: 0, hitAt: 0, target: null, attacking: 0 };
      const roster = (endgameArt?.[map.id]?.roster || []).filter(row => row.role === 'normal');
      void Promise.all(roster.map(row => readMetadata(row.sourceMap).then(data => {
        const asset = resolveSprite(data, { spriteId: row.id });
        try { spriteMetadata(data, asset, 'idle'); spriteMetadata(data, asset, 'death'); return row; } catch { return null; }
      }).catch(() => null))).then(rows => {
        if (idle !== state || !current()) return;
        state.rows = rows.filter(Boolean);
        while (state.rows.length && state.enemies.length < idleCount()) spawnIdle(state);
        reconcileEnemies(); drawBars();
      });
      return state;
    }
    function spawnIdle(state) {
      const row = state.rows[state.next++ % state.rows.length], used = new Set(state.enemies.map(enemy => enemy.slot));
      let slot = 0; while (used.has(slot)) slot++;
      state.enemies.push({ id: 'idle-' + (++state.seq), slot, name: row.name + '-' + (IDLE_MODES.find(([id]) => id === state.map.progression.mode)?.[1] || ''), rank: 'normal', hp: 100, maxHp: 100, art: { spriteId: row.id, sourceMap: row.sourceMap } });
    }
    function idleTick(ms) {
      const state = idle; if (!state || !model || model.active || !state.rows.length) return;
      state.clock += ms;
      const count = idleCount();
      if (state.enemies.some(e => e.slot >= count) || state.enemies.length < count) {
        state.enemies = state.enemies.filter(e => e.slot < count);
        while (state.enemies.length < count) spawnIdle(state);
        reconcileEnemies();
      }
      const alive = () => [...entities.values()].filter(entity => entity.sprite?.active && !entity.dying && entity.enemy.hp > 0 && entity.key.startsWith('idle:'));
      let moving = false;
      for (const entity of alive()) {
        const goal = entity.goal; if (!goal) continue;
        const sprite = entity.sprite, dx = goal.x - sprite.x, dy = goal.y - sprite.y, distance = Math.hypot(dx, dy);
        const step = Math.min(distance, height * .12 * ms / 1000);
        if (distance > .1) { sprite.setPosition(sprite.x + dx / distance * step, sprite.y + dy / distance * step); moving = true; }
        sprite.setFlipX(sprite.x > hero.x).setDepth(sprite.y);
        entity.aura?.setPosition(sprite.x, sprite.y).setDepth(sprite.y - .5);
        let motion = distance > 2 ? 'walk' : state.clock < (entity.attackUntil || 0) ? 'attack' : 'idle';
        if (distance <= 2 && state.clock >= (entity.nextAttack || 0) && entity.animations?.attack) {
          entity.attackUntil = state.clock + entity.attackMs;
          entity.nextAttack = state.clock + Math.max(entity.attackMs + 200, 1700) + entity.enemy.slot * 40;
          motion = 'attack';
        }
        if (!entity.animations?.[motion]) motion = 'idle';
        if (entity.motion !== motion) {
          entity.motion = motion;
          const pose = entity.motionMetadata[motion];
          sprite.setOrigin(pose.ox, pose.oy).setScale(height * sprite.pct / pose.body).play(entity.animations[motion]);
        }
      }
      if (moving) drawBars();
      const receipt = model.live.idleCombat;
      if (idleCast && receipt && state.offeredRound !== receipt.id && idleCastGeometry(receipt, receipt.vfxEvents[0])) {
        state.offeredRound = receipt.id;
        idleCast.enqueue(receipt, idleCastScope(), model.snapshot.serverNow);
        state.hitAt = 0; state.attacking = 0;
      }
      if (idleCast?.update()) { state.swingAt = state.clock + IDLE_SWING_MS; return; }
      if (state.hitAt && state.clock >= state.hitAt) {
        state.hitAt = 0; const entity = state.target; state.target = null;
        if (entity && entities.get(entity.key) === entity && !entity.dying) {
          const enemy = state.enemies.find(item => entity.key.endsWith(':' + item.id));
          const damage = 28 + Math.floor(Math.random() * 18);
          if (enemy) { enemy.hp = Math.max(0, enemy.hp - damage); entity.enemy = { ...entity.enemy, hp: enemy.hp }; entity.sprite.hp = enemy.hp; }
          entity.sprite.setTintFill?.(0xffffff); scene.time?.delayedCall?.(90, () => { if (entity.sprite?.active) entity.sprite.clearTint?.(); });
          if (enemy && enemy.hp <= 0) { beginDeath(entity); if (!state.respawnAt) state.respawnAt = state.clock + IDLE_RESPAWN_MS; }
          drawBars();
        }
      }
      if (state.attacking && state.clock >= state.attacking) { state.attacking = 0; if (animator.action === 'attack') animator.play('idle', animator.activeDirection || 'down', true); }
      if (state.respawnAt && state.clock >= state.respawnAt) {
        state.respawnAt = 0; state.enemies = state.enemies.filter(enemy => enemy.hp > 0);
        while (state.enemies.length < idleCount()) spawnIdle(state);
        reconcileEnemies();
      }
      if (state.clock < state.swingAt || state.hitAt) return;
      state.swingAt = state.clock + IDLE_SWING_MS;
      const targets = alive(), target = targets[state.nextTarget++ % targets.length]; if (!target) return;
      const direction = animator.face?.(target.sprite.x - hero.x, target.sprite.y - hero.y) || 'down';
      const swung = animator.ready && animator.play('attack', direction, true);
      const release = swung ? Math.max(120, Math.min(700, animator.releaseDelay?.() || 300)) : 250;
      state.target = target; state.hitAt = state.clock + release;
      if (swung) state.attacking = state.clock + Math.max(release + 80, animator.duration?.('attack', direction) || 600);
    }
    function apply(snapshot) {
      if (!current()) return;
      const next = normalize(snapshot);
      if (!next) {
        model = null; idle = null; context = ''; currentRun = ''; currentRoom = ''; lastRevision = null; seenEvents.clear(); clearActor(); setMap(null); vfxBridge?.syncContext(); actorIssue = ''; status(); return;
      }
      const changedContext = context !== next.context;
      if (changedContext) { clearActor(); context = next.context; currentRun = ''; lastRevision = null; seenEvents.clear(); }
      const nextRun = next.run?.id || '';
      if (!changedContext && nextRun === currentRun && number(next.run?.revision) !== null && number(lastRevision) !== null && next.run.revision < lastRevision) return;
      const previousRun = currentRun; currentRun = nextRun; lastRevision = next.run?.revision ?? null;
      model = next; syncError = '';
      const idleMap = !next.active && !awayActivity(next) ? idleMapFor(next.character) : null, viewMap = next.map || idleMap;
      if (!idleMap || idle?.map.id !== idleMap.id) idle = idleMap ? startIdle(idleMap) : null;
      if (changedContext || currentMap !== (viewMap ? [viewMap.id, viewMap.themeId, viewMap.kind].join(':') : '') || (viewMap && !groundReady && !mapLoading && mapAsset(viewMap))) setMap(viewMap);
      ensureActor();
      const events = next.run?.events || [];
      if (previousRun !== currentRun) seenEvents.clear();
      for (const event of events) {
        if (previousRun === currentRun && !seenEvents.has(event.id) && event.type === 'enemy_defeated') {
          for (const entity of entities.values()) if (entity.enemy.id === event.enemyId) beginDeath(entity);
        }
        seenEvents.add(event.id);
      }
      if (seenEvents.size > 96) seenEvents = new Set(events.map(event => event.id));
      reconcileEnemies(); vfxBridge?.syncContext(); status();
    }
    function minimap() {
      const canvas = byId('minic'), ctx = canvas?.getContext('2d'); if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if ((groundReady || campReady) && groundImage) {ctx.globalAlpha=.3;ctx.drawImage(groundImage, 0, 0, groundImage.width, groundImage.height, 0, 0, canvas.width, canvas.height);ctx.globalAlpha=1;}
      ctx.strokeStyle='#c8c0a82b';ctx.lineWidth=.5;ctx.beginPath();for(let step=1;step<4;step++){const x=canvas.width*step/4,y=canvas.height*step/4;ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);}ctx.stroke();
      const world = hooks.getWorld(); ctx.fillStyle = '#f5e8c8'; ctx.fillRect(hero.x / world.w * canvas.width - 2, hero.y / world.h * canvas.height - 2, 4, 4);
      for (const entity of entities.values()) if (entity.sprite?.active && entity.enemy.hp > 0) { ctx.fillStyle = entity.enemy.rank === 'boss' ? '#efb04c' : '#be514b'; ctx.fillRect(entity.sprite.x / world.w * canvas.width - 2, entity.sprite.y / world.h * canvas.height - 2, 4, 4); }
    }
    function geometry() {
      const camera = scene.cameras.main, world = hooks.getWorld();
      const box = value => value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.x + value.width, bottom: value.y + value.height } : null;
      const canvas = box(scene.game.canvas?.getBoundingClientRect?.()) || { x: 0, y: 0, width: scene.scale.width, height: scene.scale.height };
      function project(x, y) {
        const px = x - camera.scrollX, py = y - camera.scrollY;
        const point = camera.matrix?.transformPoint(px, py) || { x: camera.x + px * camera.zoom, y: camera.y + py * camera.zoom };
        return { x: canvas.x + point.x * canvas.width / scene.scale.width, y: canvas.y + point.y * canvas.height / scene.scale.height };
      }
      function visibleBounds(sprite,bounds){
        const frame=sprite.frame,source=frame?.source?.image||sprite.texture?.getSourceImage?.(),ctx=source?.getContext?.('2d');
        if(!ctx||!frame.cutWidth||!frame.cutHeight)return null;
        const key=sprite.texture.key+':'+frame.name,stamp=Date.now(),cached=visibleBoundsCache.get(key);
        const dynamic=animator.magePoseActive||animator.thiefPoseActive;
        let alpha=cached?.bounds;
        if(!cached||dynamic&&stamp-cached.stamp>200){
          try{
            const w=frame.cutWidth,h=frame.cutHeight,pixels=ctx.getImageData(frame.cutX,frame.cutY,w,h).data;
            let left=w,top=h,right=-1,bottom=-1;
            for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(pixels[(y*w+x)*4+3]>16){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
            alpha=right<0?null:{x:left/w,y:top/h,right:(right+1)/w,bottom:(bottom+1)/h};
            if(visibleBoundsCache.size>=64)visibleBoundsCache.delete(visibleBoundsCache.keys().next().value);
            visibleBoundsCache.set(key,{bounds:alpha,stamp});
          }catch(_){return null;}
        }
        if(!alpha)return null;
        const x=bounds.x+alpha.x*bounds.width,y=bounds.y+alpha.y*bounds.height,right=bounds.x+alpha.right*bounds.width,bottom=bounds.y+alpha.bottom*bounds.height;
        return {x,y,right,bottom,width:right-x,height:bottom-y};
      }
      function spriteBounds(sprite) {
        if (!sprite?.active || !sprite.visible || !sprite.frame?.data?.sourceSize) return null;
        const bounds = sprite.getBounds(), points = [project(bounds.x, bounds.y), project(bounds.right, bounds.y), project(bounds.right, bounds.bottom), project(bounds.x, bounds.bottom)];
        const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y)), right = Math.max(...points.map(point => point.x)), bottom = Math.max(...points.map(point => point.y));
        return { x: sprite.x, y: sprite.y, scaleX: sprite.scaleX, scaleY: sprite.scaleY, worldBounds: box(bounds), screenBounds: { x: left, y: top, width: right - left, height: bottom - top, right, bottom }, screenAnchor: project(sprite.x, sprite.y), ...(sprite===hero?{visibleBounds:visibleBounds(sprite,{x:left,y:top,width:right-left,height:bottom-top})}:{}) };
      }
      return { canvas, world: { width: world.w, height: world.h }, camera: { viewport: { x: camera.x, y: camera.y, width: camera.width, height: camera.height }, worldView: box(camera.worldView), scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom }, hero: spriteBounds(hero), enemies: [...entities.values()].filter(entity => entity.sprite?.active).map(entity => ({ id: entity.enemy.id, slot: entity.enemy.slot, goal: entity.goal, dying: entity.dying, motion: entity.motion, ...spriteBounds(entity.sprite) })), hud: box(byId('bottom')?.getBoundingClientRect?.()) };
    }
    const view = {
      apply, mountStatus, refreshHUD: refreshHud, ingestCombatTrace,
      showSyncError(message) { syncError = message; status(); },
      update(ms) { if (!current()) return; if (width !== scene.scale.width || height !== scene.scale.height) layout(); if (animator.ready && model) { idleTick(Math.min(100, Math.max(0, ms))); animator.update(Math.min(100, Math.max(0, ms))); hero.setDepth(hero.y); } syncVfxCanvas(); if (model?.active) vfxBridge?.update(); hooks.clearDecorations?.(); minimap(); placeGuardian(); },
      inspect() { return { live: true, context, characterId: model?.character.id || null, appearance, characterVisible: !!(hero.visible && animator.ready && hero.frame?.data?.sourceSize), actorIssue, syncError: syncError || null, mapId: model?.map?.id || null, idleMapId: idle?.map.id || null, idleEnemies: idle ? idle.enemies.filter(enemy => enemy.hp > 0).length : 0, mapReady: groundReady, campReady, guardianVisible: !guardianNode.hidden, mapIssue, assetIssues: [...assetIssues.values()], activeRunId: model?.active ? model.run.id : null, revision: lastRevision, hp: model?.hero?.hp ?? null, mp: model?.hero?.mp ?? null, experience: experienceProgress(model?.live.experience), enemies: model?.enemies.map(enemy => ({ id: enemy.id, hp: enemy.hp, maxHp: enemy.maxHp, mapped: !!enemyAsset(model.map, enemy) })) || [], spriteCount: [...entities.values()].filter(entity => entity.sprite?.active).length, geometry: geometry(), actorAnimation: { actorId: animator.actor?.id || null, action: animator.action, direction: animator.activeDirection, desiredDirection: animator.direction, elapsed: animator.elapsed, ready: animator.ready, generation: animator.generation }, vfx: { idle: idleCast?.stats() || null, ready: !!vfxBridge, issue: vfxIssue || null, layoutChanges: vfxLayoutChanges, ...vfxBridge?.stats(), player: vfxPlayer?.stats() || null, lastTrace: vfxLastTrace } }; },
      dispose() { if (disposed) return; disposed = true; ++mapGeneration; statusObserver?.disconnect(); statusNavigationObserver?.disconnect(); if (statusLayoutFrame) global.cancelAnimationFrame?.(statusLayoutFrame); vfxController.abort(); idleCast?.destroy(); vfxBridge?.destroy(); vfxPlayer?.destroy(); vfxCanvas?.remove(); scene.events?.off('pause', pauseVfx); scene.events?.off('sleep', pauseVfx); global.removeEventListener('pagehide', pagehideVfx); if(pc&&pc.drawImage===portraitDraw)pc.drawImage=originalPortraitDraw;guardianNode.remove();guardianCloud.remove();clearActor(); releaseAssets(); panel.remove(); statusToggle.remove(); viewers.delete(view); },
    };
    const pagehideVfx = () => view.dispose();
    viewers.add(view); scene.events?.once('shutdown', () => view.dispose());
    scene.events?.on('pause', pauseVfx); scene.events?.on('sleep', pauseVfx); global.addEventListener('pagehide', pagehideVfx, { once: true });
    view.apply(global.RpgSceneSession?.getSnapshot?.() || lastSnapshot);
    void ensureVfx();
    return view;
  }
  function mountStatus(body) {
    for (const view of [...viewers].reverse()) {
      const mounted = view.mountStatus(body); if (mounted) return mounted;
    }
    if (body) body.textContent = '角色狀態載入中，請稍後再開啟。';
    return { dispose() {} };
  }
  async function refresh() {
    if (syncBusy || !liveMode()) return;
    syncBusy = true; viewers.forEach(view => view.refreshHUD());
    // Manual 同步: the only timed-free way to read new status (owner decision 2026-11-10).
    // sync() also asks the server to settle a running Atlas chunk, like the former timer did.
    const session = global.RpgSceneSession;
    try { await (typeof session?.sync === 'function' ? session.sync() : session?.refresh()); } catch (_) { /* Session owns connection errors and clears stale contexts. */ }
    finally { syncBusy = false; viewers.forEach(view => view.refreshHUD()); }
    try { global.dispatchEvent?.(new global.CustomEvent('rpg:scene-manual-refresh')); } catch (_) {}
  }
  // This row is a scoped read projection and navigation surface. The existing
  // supply/skill windows retain every confirmation, pending write and game rule.
  function hudScope(snapshot) {
    const model = normalize(snapshot), context = global.RpgSceneSession?.getContext?.();
    if (!model || !context || String(context.accountId) !== String(snapshot.accountId)
      || context.realmId !== snapshot.realmId || String(context.characterId) !== String(snapshot.characterId)
      || !Number.isInteger(context.epoch)) return null;
    const revision = number(snapshot.live.revision);
    if (revision === null || revision < 0) return null;
    return { model, context, revision, key: JSON.stringify([String(context.accountId), context.realmId, String(context.characterId), context.epoch]) };
  }
  function clearHudSkills(status = 'unknown', preserveScope = false) {
    hudSkills.controller?.abort(); hudSkills.controller = null; hudSkills.generation++;
    hudSkills.status = status; hudSkills.slots = []; hudSkills.shown = null;
    if (!preserveScope) { hudSkills.scope = ''; hudSkills.requestedRevision = -1; hudSkills.revision = -1; }
  }
  function syncHudResources(model, ui = global.UI, syncError = '') {
    syncHudExperience(model, ui, syncError);
    const health = model?.hero;
    for (const kind of ['hp', 'mp']) {
      const amount = number(health?.[kind]), max = number(health?.[kind === 'hp' ? 'maxHp' : 'maxMp']);
      const known = amount !== null && max !== null && max >= 0, ratio = known && max > 0 ? clamp(amount / max) : 0;
      ui?.[kind === 'hp' ? 'setHP' : 'setMP']?.(known ? amount : 0, known && max > 0 ? max : 1);
      text(byId(kind + 'Txt'), known ? pretty(amount) : '—');
      const orb = global.document?.querySelector('.candidate-' + kind);
      if (orb) {
        const fill = orb.querySelector('.candidate-fill'); if (fill) { fill.style.height = ratio * 100 + '%'; fill.style.visibility = ratio > 0 ? 'visible' : 'hidden'; }
        orb.classList.toggle('candidate-low', kind === 'hp' && known && amount > 0 && ratio <= .2);
        orb.dataset.authority = known ? (syncError || lastSyncError ? 'stale' : 'committed') : 'unknown';
        text(orb.querySelector('.candidate-number'), known ? pretty(amount) : '—');
        const resourceLabel = (kind === 'hp' ? '生命' : '魔力') + (known ? ' ' + pretty(amount) + ' / ' + pretty(max) : '尚未同步') + (known && (syncError || lastSyncError) ? '，上次同步資料' : '');
        orb.setAttribute('aria-label', resourceLabel); orb.title = resourceLabel;
      }
      }
  }
  function clearHudResources() { syncHudResources(null); }
  function projectHudSkills(data, captured, floor) {
    if (!data || data.ok === false || !data.character || !Array.isArray(data.skills)
      || !Array.isArray(data.special?.loadout) || data.special.loadout.length > 3
      || String(data.character.tgId) !== String(captured.characterId)
      || String(data.characterId) !== String(captured.characterId) || data.realmId !== captured.realmId
      || (data.accountId != null && String(data.accountId) !== String(captured.accountId))) throw Error('技能資料尚未同步');
    const revision = number(data.character.revision);
    if (revision === null || revision < floor) throw Error('技能資料版本較早');
    const catalog = new Map();
    for (const skill of data.skills) {
      if (!skill || typeof skill.id !== 'string' || !skill.id || typeof skill.name !== 'string' || !skill.name.trim() || catalog.has(skill.id)) throw Error('技能目錄尚未完整');
      catalog.set(skill.id, skill);
    }
    const seen = new Set();
    const slots = Array.from({ length: 3 }, (_, index) => {
      const id = data.special.loadout[index];
      if (id == null || id === '') return null;
      if (typeof id !== 'string' || !catalog.has(id) || seen.has(id)) throw Error('技能配置尚未完整');
      seen.add(id); const skill = catalog.get(id);
      return { id, name: skill.name };
    });
    return { revision, slots };
  }
  function readHudSkills(snapshot) {
    const scope = hudScope(snapshot);
    if (!scope) { clearHudSkills(); syncHudActions(null); return; }
    if (hudSkills.scope !== scope.key) clearHudSkills();
    if (lastSyncError) {
      clearHudSkills('offline', true); syncHudActions(scope.model); return;
    }
    if (hudSkills.scope === scope.key && ['loading', 'ready'].includes(hudSkills.status)
      && scope.revision <= Math.max(hudSkills.requestedRevision, hudSkills.revision)) return;
    const priorRevision = hudSkills.scope === scope.key ? hudSkills.revision : -1;
    hudSkills.controller?.abort();
    const controller = new global.AbortController(), generation = ++hudSkills.generation;
    hudSkills.controller = controller; hudSkills.scope = scope.key; hudSkills.status = 'loading';
    hudSkills.requestedRevision = scope.revision; hudSkills.slots = [];
    syncHudActions(scope.model);
    const current = () => generation === hudSkills.generation && hudScope(lastSnapshot)?.key === scope.key;
    void Promise.resolve().then(() => {
      if (!current() || controller.signal.aborted) return null;
      return global.RpgSceneSession.request('skill-career', {}, { signal: controller.signal });
    }).then(data => {
      if (!current()) return;
      const floor = Math.max(scope.revision, priorRevision, hudScope(lastSnapshot)?.revision ?? -1);
      const projection = projectHudSkills(data, scope.context, floor);
      hudSkills.revision = projection.revision; hudSkills.slots = projection.slots; hudSkills.status = 'ready';
      hudSkills.shown = { scope: scope.key, slots: projection.slots };
      syncHudActions(normalize(lastSnapshot));
    }).catch(() => {
      if (!current()) return;
      hudSkills.status = 'error'; hudSkills.slots = []; hudSkills.shown = null; syncHudActions(normalize(lastSnapshot));
    }).finally(() => { if (generation === hudSkills.generation) hudSkills.controller = null; });
  }
  function syncHudActions(model) {
    const row = byId('hud-v2-actions'); if (!row?.dataset.live) return;
    const scope = hudScope(model?.snapshot), navigable = !!scope && typeof global.RpgSceneNavigation?.navigate === 'function';
    syncHudExperience(scope?.model || null, global.UI, lastSyncError);
    row.dataset.authority = scope ? (lastSyncError ? 'stale' : 'committed') : 'unknown';
    for (const [kind, label] of [['hp', '生命'], ['mp', '魔力']]) {
      const button = row.querySelector('[data-live-potion="' + kind + '"]'); if (!button) continue;
      const amount = scope ? number(model.supplies?.[kind]) : null, origin = scope ? (model.active ? '當趟剩餘' : '庫存合計') : '尚未同步';
      text(button.querySelector('.hud-v2-count'), pretty(amount));
      text(button.querySelector('.hud-v2-name'), label + (scope ? (model.active ? '·當趟' : '·庫存') : ''));
      button.disabled = !navigable;
      button.dataset.authority = amount === null ? 'unknown' : lastSyncError ? 'stale' : 'committed';
      const description = label + '藥水，' + (lastSyncError && amount !== null ? '上次同步的' : '') + origin + ' ' + pretty(amount) + '，開啟補給設定；出征依原規則自動使用';
      button.title = description; button.setAttribute('aria-label', description);
    }
    const ready = !!scope && !lastSyncError && hudSkills.scope === scope.key && hudSkills.status === 'ready' && hudSkills.revision >= scope.revision;
    // Every idle minute / Atlas chunk bumps the character revision and re-reads the
    // loadout. Keep the last accepted slots on the same buttons while that read is in
    // flight, so the bar never flashes 同步中 / an empty icon under the player's tap.
    const retained = !ready && !!scope && !lastSyncError && hudSkills.status === 'loading' && hudSkills.shown?.scope === scope.key;
    for (let index = 0; index < 3; index++) {
      const button = row.querySelector('[data-live-skill="' + index + '"]'); if (!button) continue;
      const known = ready || retained, skill = ready ? hudSkills.slots[index] : retained ? hudSkills.shown.slots[index] : null;
      const pending = hudSkills.status === 'loading', label = known ? (skill?.name || '未配置') : pending ? '同步中' : '待同步';
      text(button.querySelector('.hud-v2-name'), label);
      setSkillIcon(button.querySelector('.hud-v2-icon'), known && skill ? skillIconUrl(skill.id) : null);
      button.dataset.skillId = skill?.id || ''; button.dataset.authority = ready ? 'committed' : retained ? 'refreshing' : 'unknown'; button.disabled = !navigable;
      const description = '第 ' + (index + 1) + ' 格：' + label + '，開啟技能配置；施放與冷卻請在技能視窗確認';
      button.title = description; button.setAttribute('aria-label', description);
    }
  }
  // Painted skill art, the same files classic used (special-skill-widgets.js / skill books).
  // Empty or failed slots use a framed well, never a letter or "+" glyph.
  const SKILL_ICON_ROOT = '/expedition/assets/skills-painted-20261011/';
  const EMPTY_SKILL_ICON = '/art/career-skill-icons-20261110/empty-slot.webp';
  function skillIconUrl(id) {
    return /^skill_(?:\d{2}_\d|thief_\d{2})$/.test(String(id || '')) ? SKILL_ICON_ROOT + id + '.webp' : null;
  }
  function setSkillIcon(node, url) {
    if (!node) return;
    const failed = !!url && node.dataset.iconUrl === 'failed:' + url;
    const src = url && !failed ? url : EMPTY_SKILL_ICON;
    if (node.dataset.iconUrl === src && node.querySelector?.('img')) return;
    node.dataset.iconUrl = src; node.textContent = '';
    const img = global.document.createElement('img'); img.className = 'hud-v2-skill-art'; img.alt = ''; img.decoding = 'async'; img.draggable = false;
    if (url && !failed) {
      img.onerror = () => { node.dataset.iconUrl = 'failed:' + url; setSkillIcon(node, null); };
    }
    img.src = src; node.appendChild(img); node.classList?.add('has-art');
  }
  function navigateHud(route) {
    if (!liveMode() || !hudScope(lastSnapshot) || typeof global.RpgSceneNavigation?.navigate !== 'function') return;
    global.RpgSceneNavigation.navigate(route);
  }
  function mountHUD() {
    if (!liveMode() || hudMounted) return;
    const mid = byId('mid'), ui = global.UI; if (!mid || !ui) return;
    hudMounted = true;
    let sheet = byId('hud-v2-style');
    if (!sheet) { sheet = global.document.createElement('link'); sheet.id = 'hud-v2-style'; sheet.rel = 'stylesheet'; global.document.head.appendChild(sheet); }
    sheet.href = '/ui/hud-v2/hud-v2.css';
    global.document.documentElement.classList.add('hud-v2-active');
    global.document.querySelectorAll('.candidate-frame').forEach(frame => frame.src = '/ui/hud-v2/orb-bezel.webp');
    const row = global.document.createElement('div'); row.id = 'hud-v2-actions'; row.className = 'hud-v2-actions'; row.dataset.live = 'true'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', '實際補給與三格技能配置');
    const actions = [
      { name: '生命', potion: 'hp', col: 0 }, { name: '魔力', potion: 'mp', col: 1 },
      { name: '待同步', skill: 0 }, { name: '待同步', skill: 1 }, { name: '待同步', skill: 2 },
    ];
    for (const action of actions) {
      const button = global.document.createElement('button'); button.type = 'button'; button.className = 'hud-v2-slot'; button.disabled = true;
      button.innerHTML = '<i class="hud-v2-icon" aria-hidden="true"></i><span class="hud-v2-name" aria-hidden="true"></span><span class="hud-v2-count" aria-hidden="true"></span>';
      text(button.querySelector('.hud-v2-name'), action.name);
      if (action.potion) {
        button.dataset.livePotion = action.potion;
        button.querySelector('.hud-v2-icon').style.backgroundPosition = [0, 50][action.col] + '% 0%';
        text(button.querySelector('.hud-v2-count'), '—'); button.onclick = () => navigateHud('supplies');
      } else {
        button.dataset.liveSkill = String(action.skill); button.dataset.skillId = '';
        setSkillIcon(button.querySelector('.hud-v2-icon'), null); button.onclick = () => navigateHud('skills');
      }
      row.appendChild(button);
    }
    mid.appendChild(row);
    const caption = global.document.createElement('span'); caption.id = 'scene-xp-caption'; caption.className = 'scene-xp-caption';
    caption.textContent = 'EXP 待同步'; mid.appendChild(caption);
    lastSnapshot = global.RpgSceneSession?.getSnapshot?.() || lastSnapshot;
    syncHudResources(hudScope(lastSnapshot)?.model || null);
    readHudSkills(lastSnapshot); syncHudActions(normalize(lastSnapshot)); viewers.forEach(view => view.refreshHUD());
  }
  // No skill re-read on tab return (owner decision 2026-11-10); new snapshots and 同步 re-read when needed.
  global.RpgSceneLiveView = { mount, mountHUD, mountStatus, ingestCombatTrace: publishCombatTrace, refreshHUD: () => viewers.forEach(view => view.refreshHUD()), inspect: () => [...viewers].map(view => view.inspect()), inspectHUD: () => ({ mounted: hudMounted, status: hudSkills.status, scope: hudSkills.scope, revision: hudSkills.revision, slots: hudSkills.slots.map(skill => skill ? { ...skill } : null) }), guardianPlacement, guardianCameraOffset, experienceLabel, normalize, awayActivity, syncAway, manualRefresh: refresh, skillIconUrl, mapAsset, enemyAsset, spriteMetadata, experienceProgress, idleMapFor, resolveSprite, idleCrowdCount, idleCrowdSlot };
  loadEndgameArt();
})(window);
