'use strict';
(() => {
  const $ = query => document.querySelector(query);
  const canvas = $('#stage');
  const ctx = canvas.getContext('2d');
  const familyLabels = { sword: '劍士', archer: '妖精', mage: '法師', thief: '盜賊' };
  const actionLabels = { idle: '待機', walk: '走路', attack: '攻擊', cast: '施法', death: '死亡' };
  const directionLabels = { up: '上／背向', down: '下／正面', right: '右向', left: '左向' };
  const state = { actor: null, clip: null, loading: true, playing: false, elapsed: 0, total: 0, starts: [], selectionNotice: '' };
  let catalog, bitmaps = new Map(), generation = 0, controller, requestId = 0, lastTime = 0, disposed = false;
  const catalogController = new AbortController();

  function usableClip(clip) {
    return clip?.selectedForRuntime !== false && clip?.frames?.length > 0 &&
      ![clip.status, clip.sourceStatus, clip.readiness].some(value => /^rejected(?:$|[-_])/i.test(value || '')) &&
      clip.frames.every(frame => frame.selectedForRuntime !== false);
  }

  function originalClip(clip) {
    return String(clip.source || '').replaceAll('\\', '/').includes('/manifests/') &&
      !clip.derivedFrom?.startsWith('walk.') && !clip.derivedFrom?.startsWith('death.');
  }

  const layeredFrame = (frame, clip) => (frame.render ?? clip.render) === 'layered-walk-v1';
  const frameReference = (frame, clip) => frame.bodyHeight ?? clip.bodyHeight ?? clip.frames[0]?.bodyHeight;
  const staticClip = clip => !clip || clip.static || clip.frames.length === 1;
  const selectedActor = () => catalog?.actors.find(actor => actor.id === $('#actor').value);

  function directionsFor(actor, action) {
    const entries = Object.entries(actor?.clips?.[action] || {}).filter(([, clip]) => usableClip(clip));
    const order = ['right', 'left', 'up', 'down'];
    return entries.sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  }

  function fillSelect(element, entries, preferred) {
    element.replaceChildren(...entries.map(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
    }));
    if (entries.some(([value]) => value === preferred)) element.value = preferred;
    element.disabled = !entries.length;
  }

  function syncSelectors(preferredAction = $('#action').value, preferredDirection = $('#direction').value) {
    const actor = selectedActor();
    const actions = [...new Set([...Object.keys(actionLabels), ...Object.keys(actor?.clips || {})])]
      .filter(action => directionsFor(actor, action).length);
    fillSelect($('#action'), actions.map(action => {
      const clips = directionsFor(actor, action).map(([, clip]) => clip);
      const originals = clips.filter(originalClip).length;
      const label = originals === clips.length ? '原素材' : originals ? '原素材／新候選' : '新動作候選';
      return [action, (actionLabels[action] || action) + ' · ' + label];
    }), preferredAction);
    fillSelect($('#direction'), directionsFor(actor, $('#action').value).map(([direction, clip]) =>
      [direction, (directionLabels[direction] || direction) + (clip.mirrorX ? '（鏡像）' : '')]), preferredDirection);
  }

  function updateLocation() {
    const url = new URL(location.href);
    for (const id of ['actor', 'action', 'direction']) {
      const value = $('#' + id).value;
      if (value) url.searchParams.set(id, value); else url.searchParams.delete(id);
    }
    history.replaceState(null, '', url);
  }

  function closeImages(images) {
    for (const bitmap of images.values()) bitmap.close();
    images.clear();
  }

  function frameIndex() {
    const frames = state.clip?.frames || [];
    if (!frames.length) return 0;
    const time = state.elapsed >= state.total ? state.total : Math.max(0, state.elapsed);
    for (let i = frames.length - 1; i >= 0; i--) if (time >= state.starts[i]) return i;
    return 0;
  }

  function render() {
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const ground = height - 55;
    ctx.strokeStyle = '#b1c4d344';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(width / 2 - 100, ground); ctx.lineTo(width / 2 + 100, ground); ctx.stroke();
    if (state.loading || !state.clip) return;
    const index = frameIndex(), frame = state.clip.frames[index], image = bitmaps.get(frame.url);
    if (!image) return;
    // Authored source reference, not the current pose's visible bounding height.
    // A replacement from a differently sized atlas carries its own fixed reference.
    const reference = frameReference(frame, state.clip);
    const scale = 250 / reference;
    ctx.save();
    ctx.translate(width / 2, ground);
    ctx.scale(!!state.clip.mirrorX !== !!frame.mirrorX ? -scale : scale, scale);
    try {
      if (layeredFrame(frame, state.clip)) {
        const layered = frame.layered ?? state.clip.layered;
        ctx.translate(0, -layered.ground);
        LayeredWalkRenderer.drawPose(ctx, { image, ...layered, phase: frame.phase ?? layered.phase ?? 0 });
      } else if (frame.sourceLayers?.length) {
        LayeredWalkRenderer.drawPaintedFrame(ctx, {image, frame});
      } else {
        const [sx, sy, sw, sh] = frame.rect;
        if (frame.sourceClipPolygon) {
          ctx.beginPath();
          frame.sourceClipPolygon.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x - frame.anchor[0], y - frame.anchor[1]));
          ctx.closePath(); ctx.clip();
        }
        ctx.drawImage(image, sx, sy, sw, sh, -frame.anchor[0], -frame.anchor[1], sw, sh);
      }
    } finally {
      ctx.restore();
    }
    $('#frame').value = String(index);
    const native = frame.nativeFrameIndex ?? frame.sourceFrameIndex ?? state.clip.sourceFrameSequence?.[index] ??
      (originalClip(state.clip) ? state.actor.sourceFrameSequence?.[index] : undefined);
    const frameLabel = layeredFrame(frame, state.clip) ? '分層相位 ' + Math.round((frame.phase ?? 0) * 100) + '%' :
      native !== undefined ? '原格 ' + native : frame.label || '姿勢 ' + (index + 1);
    $('#frame-value').textContent = (index + 1) + '/' + state.clip.frames.length + ' · ' + frameLabel;
    $('#source-link').href = frame.url;
    $('#source-link').textContent = frame.url.split('/').pop();
    $('#status').textContent = state.actor.label + ' · ' +
      (staticClip(state.clip) ? (originalClip(state.clip) ? '原畫靜態' : '候選靜態姿勢') : state.playing ? '播放中' : state.elapsed >= state.total ? '播放結束，保留末幀' : '已暫停') +
      ' · ' + Math.round(state.elapsed) + '/' + Math.round(state.total) + 'ms';
  }

  function updateButtons() {
    for (const id of ['play', 'replay', 'frame', 'repeat']) $('#' + id).disabled = state.loading || staticClip(state.clip);
    $('#play').textContent = state.playing ? '暫停' : '播放';
  }

  function stop() {
    state.playing = false; lastTime = 0;
    cancelAnimationFrame(requestId); requestId = 0;
  }

  function start() {
    if (state.loading || staticClip(state.clip) || state.playing) return;
    if (state.elapsed >= state.total) state.elapsed = 0;
    state.playing = true; lastTime = 0; updateButtons();
    requestId = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!state.playing || disposed) return;
    if (lastTime) state.elapsed += Math.min(now - lastTime, 100);
    lastTime = now;
    if (state.elapsed >= state.total) {
      if ($('#repeat').checked || state.clip.loop) state.elapsed %= state.total;
      else { state.elapsed = state.total; stop(); updateButtons(); }
    }
    render();
    if (state.playing) requestId = requestAnimationFrame(tick);
  }

  function describeSelection(actor, clip) {
    const original = originalClip(clip);
    const layered = clip.frames.some(frame => layeredFrame(frame, clip));
    const action = $('#action').value, direction = $('#direction').value;
    $('#name').textContent = actor.label;
    $('#identity').textContent = familyLabels[actor.family] + ' · ' + actor.advancement + '轉 ' + actor.classPath + ' · ' + actor.key;
    const mixed = layered && clip.frames.some(frame => !layeredFrame(frame, clip));
    $('#material-label').textContent = original ? '原素材沿用' : mixed ? ($('#action').value==='death'?'分層站姿＋新繪死亡姿勢（候選）':'分層準備姿勢＋新繪攻擊接觸幀（候選）') : layered ? '新繪分層行走候選（未驗收）' : '新動作候選（未完整驗收）';
    $('#action-label').textContent = (actionLabels[action] || action) + (staticClip(clip) ? '／靜態' : '') +
      ' · ' + (directionLabels[direction] || direction) + (clip.mirrorX ? '（鏡像）' : '');
    const authored = String(clip.timingSource || '').startsWith('registry');
    $('#timing').textContent = staticClip(clip) ? '靜態顯示，沒有新增待機動畫' :
      (original ? authored ? '原素材逐幀時長' : '原素材未提供時長；使用預覽設定' :
        layered ? '分層姿勢交付時長' : '新動作交付時長') + ' · ' + Math.round(state.total) + 'ms' +
      (clip.timingSource ? ' · ' + clip.timingSource : '');
    const sourceLink = $('#source-link');
    sourceLink.href = clip.frames[0].url; sourceLink.hidden = false;
    sourceLink.textContent = clip.frames[0].url.split('/').pop();
    const notes = [
      '一轉素材依選版提供動作；方向覆蓋與整體美術驗收分開記錄。',
      ...(state.selectionNotice ? [state.selectionNotice] : []),
      original ? '原畫／攻擊素材保留；固定比例與腳點依原始 registry。' :
        layered ? '使用新繪身體與完整腿部組合；相位由分件平移旋轉形成，並非新增完整人物逐幀圖。' :
        '使用選定的新動作來源與交付腳點；身高依各來源固定參考，不隨姿勢外框重新縮放。',
      '此動作目前可用：' + directionsFor(actor, action).map(([d]) => directionLabels[d] || d).join('、') + (directionsFor(actor, action).length===4?'（四方向齊備）。':'。其餘方向未選用。'),
      ...(clip.mirrorX ? ['左向鏡像會反轉持武器手與服裝不對稱細節。'] : []),
      ...(action === 'walk' && !clip.gaitAccepted ? ['目前步態尚未驗收。'] : []),
      ...(clip.caveats || [])
    ];
    $('#notes').replaceChildren(...[...new Set(notes)].map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    $('#metadata').textContent = JSON.stringify({
      key: actor.key, action, direction, source: clip.source, sourceManifest: actor.sourceManifest,
      render: clip.render, frameRenderers: [...new Set(clip.frames.map(frame => frame.render).filter(Boolean))],
      readiness: clip.readiness, sourceStatus: clip.sourceStatus, approved: clip.approved, gaitAccepted: clip.gaitAccepted,
      sourceFrameSequence: clip.sourceFrameSequence ?? (original ? actor.sourceFrameSequence : undefined),
      frameBodyHeightReferences: clip.frames.map(frame => frameReference(frame, clip)),
      timingSource: clip.timingSource, durationsMs: clip.frames.map(frame => frame.durationMs),
      releaseFrame: clip.releaseFrame, hitFrame: clip.hitFrame,
      sourcePlaybackMetadata: original ? actor.sourcePlaybackMetadata : undefined
    }, null, 2);
  }

  async function selectClip() {
    stop();
    const token = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    state.actor = selectedActor();
    state.clip = state.actor?.clips?.[$('#action').value]?.[$('#direction').value];
    state.elapsed = 0; state.loading = true;
    state.starts = []; state.total = 0;
    $('#error').textContent = '';
    $('#status').textContent = '載入目前人物的素材…';
    $('#source-link').hidden = true;
    $('#frame-value').textContent = '—';
    updateLocation();
    updateButtons(); render();
    const pending = new Map();
    try {
      const actor = await window.CharacterCatalogLoader.loadActor(state.actor, {signal});
      if (disposed || signal.aborted || token !== generation) return;
      state.actor = actor;
      state.clip = actor?.clips?.[$('#action').value]?.[$('#direction').value];
      const clip = state.clip;
      if (!usableClip(clip)) throw new Error('此人物沒有所選的可用動作／方向；缺少或拒用素材未提供選項。');
      for (const frame of clip.frames) {
        if (!(Number.isFinite(frame.durationMs) && frame.durationMs > 0)) throw new Error('來源播放時長不完整。');
        const reference = frameReference(frame, clip);
        if (!(Number.isFinite(reference) && reference > 0)) throw new Error('來源固定身高參考缺失。');
        if (!frame.url) throw new Error('來源圖片網址缺失。');
        if (layeredFrame(frame, clip)) {
          const layered = frame.layered ?? clip.layered;
          if (!globalThis.LayeredWalkRenderer || !layered || !Number.isFinite(layered.ground)) throw new Error('分層 renderer 或組合資料缺失。');
          const pose = LayeredWalkRenderer.computePose({ ...layered, phase: frame.phase ?? layered.phase ?? 0 });
          const partIds = [...pose.legs.flatMap(leg => pose.articulated ? [leg.upper.partId,leg.lower.partId] : [leg.partId]), pose.body.partId];
          if (!partIds.every(id => layered.parts?.[id])) throw new Error('分層組合缺少完整身體或腿部。');
        }
        state.starts.push(state.total); state.total += frame.durationMs;
      }
      const urls = [...new Set(clip.frames.map(frame => frame.url))];
      const sameImages = urls.length === bitmaps.size && urls.every(url => bitmaps.has(url));
      if (!sameImages) {
        closeImages(bitmaps);
        await Promise.all(urls.map(async url => {
          const response = await fetch(url, { signal });
          if (!response.ok) throw new Error('素材 HTTP ' + response.status);
          const bitmap = await createImageBitmap(await response.blob());
          if (disposed || signal.aborted || token !== generation) { bitmap.close(); return; }
          pending.set(url, bitmap);
        }));
        if (disposed || signal.aborted || token !== generation) { closeImages(pending); return; }
        bitmaps = pending;
      }
      if (disposed || token !== generation) return;
      state.loading = false;
      $('#frame').max = String(clip.frames.length - 1);
      describeSelection(state.actor, clip);
      updateButtons(); render();
      if (!staticClip(clip)) start();
    } catch (error) {
      // Abort late decodes too; each continuation closes its own stale bitmap.
      controller?.signal === signal && controller.abort();
      closeImages(pending);
      if (disposed || token !== generation || error.name === 'AbortError') return;
      closeImages(bitmaps);
      state.loading = false; state.clip = null;
      $('#error').textContent = error.message;
      $('#status').textContent = '素材尚未載入';
      updateButtons(); render();
    }
  }

  for (const id of ['actor', 'action']) $('#' + id).addEventListener('change', () => {
    state.selectionNotice = ''; syncSelectors(); selectClip();
  });
  $('#direction').addEventListener('change', () => { state.selectionNotice = ''; selectClip(); });
  $('#play').addEventListener('click', () => { if (state.playing) { stop(); updateButtons(); render(); } else start(); });
  $('#replay').addEventListener('click', () => { stop(); state.elapsed = 0; start(); render(); });
  $('#frame').addEventListener('input', event => {
    stop(); state.elapsed = state.starts[Number(event.target.value)] || 0; updateButtons(); render();
  });
  const observer = new ResizeObserver(render); observer.observe(canvas);
  document.addEventListener('visibilitychange', () => { lastTime = 0; });
  window.addEventListener('pagehide', () => {
    disposed = true; generation++; stop(); controller?.abort(); catalogController.abort();
    closeImages(bitmaps); observer.disconnect();
  });

  async function init() {
    await import('./character-catalog-loader.js');
    const response = await fetch('advancement-index.json', { signal: catalogController.signal });
    if (!response.ok) throw new Error('角色目錄尚未建置（HTTP ' + response.status + '）。');
    catalog = await response.json();
    if (disposed) return;
    if (!Array.isArray(catalog.actors) || new Set(catalog.actors.map(a=>a.id)).size !== catalog.actors.length) throw new Error('角色目錄無效或包含重複外觀。');
    for (const family of ['sword', 'archer', 'mage', 'thief']) {
      const group = document.createElement('optgroup'); group.label = familyLabels[family];
      for (const actor of catalog.actors.filter(actor => actor.family === family)) {
        const option = document.createElement('option');
        option.value = actor.id; option.textContent = actor.label + ' · ' + actor.advancement + '轉 ' + actor.classPath; group.append(option);
      }
      $('#actor').append(group);
    }
    const params = new URLSearchParams(location.search);
    const requestedActor = params.get('actor');
    const match = catalog.actors.find(actor => actor.id === requestedActor || actor.key === requestedActor);
    if (match) $('#actor').value = match.id;
    $('#actor').disabled = false;
    syncSelectors(params.get('action') || 'idle', params.get('direction') || 'right');
    const missingRequest = (requestedActor && !match) ||
      (params.has('action') && params.get('action') !== $('#action').value) ||
      (params.has('direction') && params.get('direction') !== $('#direction').value);
    if (missingRequest) state.selectionNotice = '深連結要求的人物／動作／方向未選用；目前顯示選單所列的可用素材，沒有以其他方向冒充。';
    await selectClip();
  }
  init().catch(error => {
    if (!disposed && error.name !== 'AbortError') { $('#error').textContent = error.message; $('#status').textContent = '等待首批 catalog'; }
  });
})();

