/* Render committed Atlas snapshots in the independent local scene.
 * Artwork stays in its source catalogs; this renderer never simulates combat,
 * settles an expedition, invents rewards, or substitutes another character. */
(function (global) {
  'use strict';
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
  let lastSnapshot = null, lastSyncError = '', nextViewId = 0, hudMounted = false, syncBusy = false;
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
  function mapAsset(map) {
    const source = MAPS[map?.id];
    return source && map.themeId === source.themeId && map.kind === source.kind ? source : null;
  }
  function enemyAsset(map, enemy) {
    const source = mapAsset(map);
    if (!source) return null;
    const row = ENEMIES.find(row => row[0] === map.id && row[1] === enemy?.rank && row[2] === enemy?.name);
    return row ? { ...source, spriteId: row[3] } : null;
  }
  function normalize(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== 1 || !snapshot.characterId || !snapshot.realmId || !snapshot.accountId || !snapshot.character || !snapshot.live) return null;
    if (String(snapshot.character.id) !== String(snapshot.characterId)) return null;
    const run = snapshot.run;
    if (run && (String(run.characterId) !== String(snapshot.characterId) || run.realmId !== snapshot.realmId)) return null;
    const active = !!run?.active && String(snapshot.live.activeRunId) === String(run.id);
    return {
      context: [snapshot.realmId, snapshot.accountId, snapshot.characterId].join(':'),
      snapshot, character: snapshot.character, live: snapshot.live, run,
      active, map: active ? run.map : null,
      hero: active ? run.hero : snapshot.live,
      supplies: active ? run.supplies : snapshot.live.supplies,
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
    if (!source || source.file !== key + '.webp' || !['idle', 'death'].includes(action)
      || !Number.isInteger(source.cellW) || source.cellW < 1 || source.cellW > 4096
      || !Number.isInteger(source.cellH) || source.cellH < 1 || source.cellH > 4096
      || !Number.isInteger(source.frames) || source.frames < 1 || source.frames > 64
      || !Number.isFinite(source.ox) || !Number.isFinite(source.oy) || !heights.length) throw Error('怪物動作資料待核對');
    return { ...source, body: heights.reduce((sum, value) => sum + value, 0) / heights.length };
  }
  function publish(snapshot) {
    if (!liveMode()) return;
    lastSnapshot = snapshot || null; lastSyncError = '';
    viewers.forEach(view => view.apply(lastSnapshot));
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
    viewers.forEach(view => view.showSyncError(lastSyncError));
  });
  function mount(scene, hooks) {
    if (!liveMode()) return null;
    const { hero, animator, ui, ground, hpGraphics } = hooks;
    const viewId = ++nextViewId, entities = new Map(), resources = new Map(), textureKeys = new Set(), animationKeys = new Set();
    let disposed = false, model = null, context = '', appearance = null, actorGeneration = 0, mapGeneration = 0, currentMap = '', currentRoom = '', currentRun = '', lastRevision = null;
    let groundReady = false, mapLoading = false, groundImage = null, width = 0, height = 0, actorIssue = '', mapIssue = '', syncError = lastSyncError, assetIssues = new Map(), seenEvents = new Set();
    const doc = global.document;
    let vfxPlayer = null, vfxBridge = null, vfxCanvas = null, vfxInit = null, vfxIssue = '', vfxLayout = '', vfxLayoutChanges = 0, vfxSize = '', vfxLastTrace = null, vfxTraceSequence = 0;
    const vfxController = new AbortController();
    doc.documentElement.classList.add('rpg-live-scene');
    const panel = doc.createElement('section'); panel.className = 'scene-live-panel'; panel.id = 'scene-live-status'; panel.setAttribute('aria-label', '出征狀態');
    panel.innerHTML = '<div class="scene-live-heading"><strong data-live-title></strong><span data-live-sync></span><button type="button" data-live-collapse aria-label="收合戰況" aria-expanded="true">▴</button></div><p data-live-progress></p><p data-live-supplies></p><p class="scene-live-warning" data-live-connection role="status" hidden></p><p class="scene-live-warning" data-live-warning role="status"></p><div class="scene-live-buttons"><button type="button" data-live-expedition>星圖派遣</button><button type="button" data-live-characters>選擇角色</button><button type="button" data-live-refresh>同步</button></div><details><summary>已結算紀錄與敵人</summary><p data-live-report></p><ul class="scene-live-enemies" data-live-enemies></ul><ol class="scene-live-events" data-live-events></ol></details>';
    (byId('ui') || doc.body).appendChild(panel);
    const nodes = Object.fromEntries(['title', 'sync', 'progress', 'supplies', 'connection', 'warning', 'report', 'enemies', 'events', 'expedition', 'characters', 'refresh', 'collapse'].map(key => [key, panel.querySelector('[data-live-' + key + ']')]));
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
    const pc = byId('pc')?.getContext('2d'); pc?.clearRect(0, 0, 112, 112);
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
        if (vfxSize) vfxBridge?.clear('viewport-changed');
        vfxSize = size; vfxPlayer.resize(box.width, box.height);
      }
    }
    function ensureVfx() {
      if (vfxInit) return vfxInit;
      vfxInit = (async () => {
        const [{ createVfxPlayer }, { createActorVfxBridge }, response] = await Promise.all([
          import('/skill-vfx-engine.mjs'), import('/skill-vfx-actor-bridge.mjs'),
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
        vfxPlayer = createVfxPlayer(vfxCanvas, { catalog, assetBase: '/art/skill-vfx-20261104/', maxActive: 8, quality: 'high' });
        syncVfxCanvas();
        vfxBridge = createActorVfxBridge({
          player: vfxPlayer, animator, hero, getContext: vfxContext, getRoom: vfxRoom,
          getActorId: () => appearance || animator.actor?.id,
          getBodyHeight: () => Math.abs(hero.scaleY) * 300,
          resolveGeometry: resolveVfxGeometry, projectPoint: projectVfxPoint,
          profilesUrl: '/skill-vfx-actor-profiles.json', document: doc,
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
    function pauseVfx() { vfxBridge?.clear('scene-paused'); }

    function refreshHud() {
      if (!current()) return;
      const value = model, health = value?.hero;
      hero.hp = number(health?.hp) ?? 0; hero.mhp = number(health?.maxHp) ?? 0;
      for (const kind of ['hp', 'mp']) {
        const amount = number(health?.[kind]), max = number(health?.[kind === 'hp' ? 'maxHp' : 'maxMp']);
        const known = amount !== null && max !== null && max >= 0, ratio = known && max > 0 ? clamp(amount / max) : 0;
        ui[kind === 'hp' ? 'setHP' : 'setMP'](known ? amount : 0, known && max > 0 ? max : 1);
        text(byId(kind + 'Txt'), known ? pretty(amount) : '—');
        const orb = doc.querySelector('.candidate-' + kind);
        if (orb) {
          const fill = orb.querySelector('.candidate-fill'); if (fill) { fill.style.height = ratio * 100 + '%'; fill.style.visibility = ratio > 0 ? 'visible' : 'hidden'; }
          orb.classList.toggle('candidate-low', kind === 'hp' && known && amount > 0 && ratio <= .2);
          orb.dataset.authority = known ? 'committed' : 'unknown';
          text(orb.querySelector('.candidate-number'), known ? pretty(amount) : '—');
          orb.setAttribute('aria-label', (kind === 'hp' ? '生命' : '魔力') + (known ? ' ' + pretty(amount) + ' / ' + pretty(max) : '尚未同步'));
        }
      }
      text(doc.querySelector('#topL .who b'), value?.character.name || '角色同步中');
      text(doc.querySelector('#topL .portrait i'), value ? pretty(value.character.level) : '—');
      text(byId('gold'), value ? '◈ ' + pretty(value.live.gold) : '◈ —');
      const xp = byId('xp'), experience = experienceProgress(value?.live.experience), xpText = experience ? experience.maxLevel ? '已達滿級' : pretty(experience.current) + ' / ' + pretty(experience.required) : '等級進度尚未同步';
      if (xp) { xp.setAttribute('role', 'progressbar'); xp.setAttribute('aria-label', '角色經驗'); xp.setAttribute('aria-valuetext', xpText); xp.setAttribute('aria-valuemin', '0'); xp.setAttribute('aria-valuemax', '100'); xp.title = xpText; if (experience) xp.setAttribute('aria-valuenow', String(Math.round(experience.ratio * 100))); else xp.removeAttribute('aria-valuenow'); }
      ui.setXP(experience ? experience.ratio : 0);
      if (byId('xpfill')) { byId('xpfill').style.visibility = experience ? 'visible' : 'hidden'; byId('xpfill').dataset.authority = experience ? 'committed' : 'unknown'; }
      text(doc.querySelector('#zone b'), value?.active ? value.map?.name || '星圖探索' : value ? '營地' : '同步中');
      text(doc.querySelector('#zone span'), value?.active ? '已結算 ' + pretty(value.run.processedSeconds) + ' 秒' : value ? (value.snapshot.realmId === 'permanent' ? '永久世界' : '賽季世界') + ' · Lv.' + pretty(value.character.level) : '等待遊戲狀態');
      syncHudActions(value);
      nodes.refresh.disabled = syncBusy;
    }
    function status() {
      if (!current()) return;
      const value = model, run = value?.run;
      text(nodes.title, value ? value.active ? '星圖探索中' : '營地' : '正在同步角色');
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
    function releaseAssets() {
      for (const entity of entities.values()) entity.sprite?.destroy(); entities.clear(); hooks.setMonsters([]);
      for (const key of animationKeys) scene.anims.remove(key); animationKeys.clear();
      // Keep Phaser images on a persistent frame before releasing owned textures.
      if (ground?.active !== false) { ground?.setVisible(false); if (scene.textures.exists('ground')) ground?.setTexture('ground'); }
      for (const key of textureKeys) if (scene.textures.exists(key)) scene.textures.remove(key); textureKeys.clear(); resources.clear();
      groundReady = false; mapLoading = false; groundImage = null; ground?.setVisible(false); hpGraphics?.clear(); ui.target(null);
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
      width = scene.scale.width; height = scene.scale.height;
      const camera = scene.cameras.main;
      camera.setViewport(0, 0, width, height);
      if (groundReady && groundImage) {
        const scale = Math.max(height * 2.6 / groundImage.height, width * 1.8 / groundImage.width), world = { w: groundImage.width * scale, h: groundImage.height * scale };
        ground.setOrigin(0).setScale(scale); hooks.setWorld(world); camera.setBounds(0, 0, world.w, world.h);
      }
      const world = hooks.getWorld(); hero.setPosition(world.w / 2, world.h * .6);
      // Reserve positions for the whole committed encounter, including art
      // still loading. Materializing one sprite must not move the others or
      // invalidate a real cast waiting for its target's geometry.
      const roster = [...entities.values()];
      const slots = roster.map((entity, index) => {
        const angle = -Math.PI + (index + 1) / (roster.length + 1) * Math.PI;
        const radius = height * (entity.enemy.rank === 'boss' ? .34 : .29);
        return { entity, x: hero.x + Math.cos(angle) * Math.min(radius, width * .3),
          y: hero.y + Math.sin(angle) * radius * .7 };
      });
      for (const { entity, x, y } of slots) {
        if (!entity.sprite?.active) continue;
        entity.sprite.setPosition(x, y);
        entity.sprite.setScale(height * entity.sprite.pct / entity.idleBody).setFlipX(x > hero.x).setDepth(y);
      }
      // A committed snapshot repositions the whole encounter at once. The art
      // demo's lerped follow otherwise leaves actors off-screen after map/size
      // changes even though their world coordinates and visibility are valid.
      camera.stopFollow().centerOn(hero.x, hero.y);
      hero.setDepth(hero.y); drawBars();
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
      vfxBridge?.clear('map-changed'); vfxLayout = '';
      ++mapGeneration; currentMap = map ? [map.id, map.themeId, map.kind].join(':') : ''; currentRoom = ''; assetIssues.clear(); releaseAssets(); mapIssue = '';
      if (!map) { layout(); return; }
      const asset = mapAsset(map), generation = mapGeneration;
      if (!asset) { mapIssue = '此星圖背景待對應'; layout(); return; }
      const key = 'live-' + viewId + '-' + generation + '-ground'; mapLoading = true;
      void resource('image', key, '/map' + asset.sourceMap + '/map' + asset.sourceMap + '_ground.webp').then(texture => {
        if (!texture || !current() || generation !== mapGeneration) return;
        ground.setTexture(texture).setVisible(true); groundImage = scene.textures.get(texture).getSourceImage(); groundReady = true; layout();
      }).catch(() => { if (current() && generation === mapGeneration) { mapIssue = '地圖背景尚未載入'; status(); } })
        .finally(() => { if (current() && generation === mapGeneration) mapLoading = false; });
      layout();
    }
    async function loadEnemy(entity) {
      const generation = mapGeneration, asset = entity.asset; entity.loading = true;
      try {
        const data = await readMetadata(asset.sourceMap), idle = spriteMetadata(data, asset, 'idle');
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
          scene.time.delayedCall(death.frames * 100 + 300, () => { if (entities.get(entity.key) === entity) { sprite.destroy(); entities.delete(entity.key); syncMonsters(); drawBars(); } });
        } catch (_) { if (entities.get(entity.key) === entity) { sprite.destroy(); entities.delete(entity.key); syncMonsters(); assetIssues.set(entity.key, entity.enemy.name + '倒地素材待載入'); status(); } }
      })();
    }
    function reconcileEnemies() {
      const room = model?.active ? [model.run.id, model.run.mapIndex, model.run.roomIndex].join(':') : '';
      if (room !== currentRoom) { vfxBridge?.clear('room-changed'); for (const entity of entities.values()) entity.sprite?.destroy(); entities.clear(); assetIssues.clear(); currentRoom = room; }
      const wanted = new Set();
      for (const enemy of model?.enemies || []) {
        const key = room + ':' + enemy.id, asset = enemyAsset(model.map, enemy); wanted.add(key);
        let entity = entities.get(key);
        if (entity) {
          entity.enemy = enemy;
          if (entity.sprite) { entity.sprite.hp = enemy.hp; entity.sprite.mhp = enemy.maxHp; if (enemy.hp <= 0) beginDeath(entity); }
          else if (asset && enemy.hp > 0 && !entity.loading) void loadEnemy(entity);
        } else if (asset && enemy.hp > 0) { entity = { key, enemy, asset, sprite: null, dying: false, loading: false }; entities.set(key, entity); void loadEnemy(entity); }
      }
      for (const [key, entity] of entities) if (!wanted.has(key) && !entity.dying) { entity.sprite?.destroy(); entities.delete(key); assetIssues.delete(key); }
      syncMonsters(); layout();
    }
    function drawBars() {
      hpGraphics?.clear();
      const alive = [...entities.values()].filter(entity => entity.sprite?.active && entity.enemy.hp > 0);
      for (const entity of alive) {
        const sprite = entity.sprite, ratio = clamp(entity.enemy.hp / Math.max(1, entity.enemy.maxHp)), w = scene.scale.height * (entity.enemy.rank === 'boss' ? .16 : entity.enemy.rank === 'elite' ? .09 : .06), h = Math.max(3, scene.scale.height * .006), x = sprite.x - w / 2, y = sprite.y - scene.scale.height * sprite.pct * 1.08;
        hpGraphics?.fillStyle(0x000000, .75).fillRect(x - 1, y - 1, w + 2, h + 2); hpGraphics?.fillStyle(0xb84135, 1).fillRect(x, y, w * ratio, h);
      }
      const target = model?.enemies.find(enemy => enemy.hp > 0 && enemy.rank === 'boss') || model?.enemies.find(enemy => enemy.hp > 0 && enemy.rank === 'elite') || model?.enemies.find(enemy => enemy.hp > 0);
      if (target) ui.target(target.name, target.rank === 'normal' ? 'minion' : target.rank, clamp(target.hp / Math.max(1, target.maxHp))); else ui.target(null);
    }
    function clearActor() {
      vfxBridge?.clear('actor-changed');
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
    function apply(snapshot) {
      if (!current()) return;
      const next = normalize(snapshot);
      if (!next) {
        model = null; context = ''; currentRun = ''; currentRoom = ''; lastRevision = null; seenEvents.clear(); clearActor(); setMap(null); vfxBridge?.syncContext(); actorIssue = ''; status(); return;
      }
      const changedContext = context !== next.context;
      if (changedContext) { clearActor(); context = next.context; currentRun = ''; lastRevision = null; seenEvents.clear(); }
      const nextRun = next.run?.id || '';
      if (!changedContext && nextRun === currentRun && number(next.run?.revision) !== null && number(lastRevision) !== null && next.run.revision < lastRevision) return;
      const previousRun = currentRun; currentRun = nextRun; lastRevision = next.run?.revision ?? null;
      model = next; syncError = '';
      if (changedContext || currentMap !== (next.map ? [next.map.id, next.map.themeId, next.map.kind].join(':') : '') || (next.map && !groundReady && !mapLoading && mapAsset(next.map))) setMap(next.map);
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
      if (groundReady && groundImage) ctx.drawImage(groundImage, 0, 0, groundImage.width, groundImage.height, 0, 0, canvas.width, canvas.height);
      else { ctx.fillStyle = '#0b121c'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
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
      function spriteBounds(sprite) {
        if (!sprite?.active || !sprite.visible || !sprite.frame?.data?.sourceSize) return null;
        const bounds = sprite.getBounds(), points = [project(bounds.x, bounds.y), project(bounds.right, bounds.y), project(bounds.right, bounds.bottom), project(bounds.x, bounds.bottom)];
        const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y)), right = Math.max(...points.map(point => point.x)), bottom = Math.max(...points.map(point => point.y));
        return { x: sprite.x, y: sprite.y, scaleX: sprite.scaleX, scaleY: sprite.scaleY, worldBounds: box(bounds), screenBounds: { x: left, y: top, width: right - left, height: bottom - top, right, bottom }, screenAnchor: project(sprite.x, sprite.y) };
      }
      return { canvas, world: { width: world.w, height: world.h }, camera: { viewport: { x: camera.x, y: camera.y, width: camera.width, height: camera.height }, worldView: box(camera.worldView), scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom }, hero: spriteBounds(hero), enemies: [...entities.values()].filter(entity => entity.sprite?.active).map(entity => ({ id: entity.enemy.id, ...spriteBounds(entity.sprite) })), hud: box(byId('bottom')?.getBoundingClientRect?.()) };
    }
    const view = {
      apply, refreshHUD: refreshHud, ingestCombatTrace,
      showSyncError(message) { syncError = message; status(); },
      update(ms) { if (!current()) return; if (width !== scene.scale.width || height !== scene.scale.height) layout(); if (animator.ready && model) { animator.update(Math.min(100, Math.max(0, ms))); hero.setDepth(hero.y); } syncVfxCanvas(); vfxBridge?.update(); hooks.clearDecorations?.(); minimap(); },
      inspect() { return { live: true, context, characterId: model?.character.id || null, appearance, characterVisible: !!(hero.visible && animator.ready && hero.frame?.data?.sourceSize), actorIssue, syncError: syncError || null, mapId: model?.map?.id || null, mapReady: groundReady, mapIssue, assetIssues: [...assetIssues.values()], activeRunId: model?.active ? model.run.id : null, revision: lastRevision, hp: model?.hero?.hp ?? null, mp: model?.hero?.mp ?? null, experience: experienceProgress(model?.live.experience), enemies: model?.enemies.map(enemy => ({ id: enemy.id, hp: enemy.hp, maxHp: enemy.maxHp, mapped: !!enemyAsset(model.map, enemy) })) || [], spriteCount: [...entities.values()].filter(entity => entity.sprite?.active).length, geometry: geometry(), actorAnimation: { actorId: animator.actor?.id || null, action: animator.action, direction: animator.activeDirection, desiredDirection: animator.direction, elapsed: animator.elapsed, ready: animator.ready, generation: animator.generation }, vfx: { ready: !!vfxBridge, issue: vfxIssue || null, layoutChanges: vfxLayoutChanges, ...vfxBridge?.stats(), player: vfxPlayer?.stats() || null, lastTrace: vfxLastTrace } }; },
      dispose() { if (disposed) return; disposed = true; ++mapGeneration; vfxController.abort(); vfxBridge?.destroy(); vfxPlayer?.destroy(); vfxCanvas?.remove(); scene.events?.off('pause', pauseVfx); scene.events?.off('sleep', pauseVfx); global.removeEventListener('pagehide', pagehideVfx); clearActor(); releaseAssets(); panel.remove(); viewers.delete(view); },
    };
    const pagehideVfx = () => view.dispose();
    viewers.add(view); scene.events?.once('shutdown', () => view.dispose());
    scene.events?.on('pause', pauseVfx); scene.events?.on('sleep', pauseVfx); global.addEventListener('pagehide', pagehideVfx, { once: true });
    view.apply(global.RpgSceneSession?.getSnapshot?.() || lastSnapshot);
    void ensureVfx();
    return view;
  }
  async function refresh() {
    if (syncBusy || !liveMode()) return;
    syncBusy = true; viewers.forEach(view => view.refreshHUD());
    try { await global.RpgSceneSession?.refresh(); } catch (_) { /* Session owns connection errors and clears stale contexts. */ }
    finally { syncBusy = false; viewers.forEach(view => view.refreshHUD()); }
  }
  function syncHudActions(model) {
    const row = byId('hud-v2-actions'); if (!row?.dataset.live) return;
    for (const [kind, label] of [['hp', '生命'], ['mp', '魔力']]) {
      const button = row.querySelector('[data-live-potion="' + kind + '"]'); if (!button) continue;
      text(button.querySelector('.hud-v2-count'), pretty(model?.supplies?.[kind]));
      button.title = label + '藥水由出征自動使用'; button.setAttribute('aria-label', label + '藥水 ' + pretty(model?.supplies?.[kind]) + '，出征自動使用');
    }
    const sync = row.querySelector('[data-live-action="refresh"]'); if (sync) sync.disabled = syncBusy;
  }
  function mountHUD() {
    if (!liveMode() || hudMounted) return;
    const mid = byId('mid'), ui = global.UI; if (!mid || !ui) return;
    hudMounted = true;
    if (!byId('hud-v2-style')) { const sheet = global.document.createElement('link'); sheet.id = 'hud-v2-style'; sheet.rel = 'stylesheet'; sheet.href = '/ui-generated-20261030/hud-v2.css'; global.document.head.appendChild(sheet); }
    global.document.documentElement.classList.add('hud-v2-active');
    global.document.querySelectorAll('.candidate-frame').forEach(frame => frame.src = '/ui-generated-20261030/hud-v2/orb-bezel.webp');
    const row = global.document.createElement('div'); row.id = 'hud-v2-actions'; row.className = 'hud-v2-actions'; row.dataset.live = 'true'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', '實際出征補給與操作');
    const actions = [
      { name: '生命', potion: 'hp', col: 0, row: 0 }, { name: '魔力', potion: 'mp', col: 1, row: 0 },
      { name: '構築', action: 'talents', col: 2, row: 0 }, { name: '派遣', action: 'expedition', col: 0, row: 1 }, { name: '同步', action: 'refresh', col: 1, row: 1 },
    ];
    for (const action of actions) {
      const button = global.document.createElement('button'); button.type = 'button'; button.className = 'hud-v2-slot';
      button.innerHTML = '<i class="hud-v2-icon" aria-hidden="true"></i><span class="hud-v2-name" aria-hidden="true"></span><span class="hud-v2-count" aria-hidden="true"></span>';
      button.querySelector('.hud-v2-icon').style.backgroundPosition = [0, 50, 100][action.col] + '% ' + (action.row ? 100 : 0) + '%'; text(button.querySelector('.hud-v2-name'), action.name);
      if (action.potion) { button.dataset.livePotion = action.potion; button.disabled = true; text(button.querySelector('.hud-v2-count'), '—'); }
      else { button.dataset.liveAction = action.action; button.setAttribute('aria-label', action.name); button.onclick = () => action.action === 'refresh' ? void refresh() : ui.toggle(action.action); }
      row.appendChild(button);
    }
    mid.appendChild(row); viewers.forEach(view => view.refreshHUD());
  }
  global.RpgSceneLiveView = { mount, mountHUD, ingestCombatTrace: publishCombatTrace, refreshHUD: () => viewers.forEach(view => view.refreshHUD()), inspect: () => [...viewers].map(view => view.inspect()), normalize, mapAsset, enemyAsset, spriteMetadata, experienceProgress };
})(window);
