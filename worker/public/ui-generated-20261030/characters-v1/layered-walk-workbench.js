'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const stage = $('#stage');
  const gameStage = $('#game-stage');
  const renderer = window.LayeredWalkRenderer;
  const phaseCards = [...document.querySelectorAll('[data-phase]')];
  const viewButtons = [...document.querySelectorAll('[data-view]')];
  const controls = [...document.querySelectorAll('button, input')];
  const state = { view: 'front', mode: 'static', playing: false, phase: 0, stride: 24, ground: 570, guides: false, bodyMotion: true };
  const cycleMs = 960;
  const configurations = renderer.configurations;
  const viewSettings = {
    front: { name: '正面', source: 'frontBack', ground: 570, reference: 940, fitWidth: 680, fitHeight: 1010, topOffset: 365 },
    back: { name: '背面', source: 'frontBack', ground: 570, reference: 940, fitWidth: 680, fitHeight: 1010, topOffset: 365 },
    right: { name: '右向', source: 'right', ground: 600, reference: 930, fitWidth: 800, fitHeight: 1060, topOffset: 390 }
  };
  const adjustments = { frontBack: { stride: 24, ground: 570 }, right: { stride: 40, ground: 600 } };
  let assets, ready = false, lastTime = 0, frameId = 0, disposed = false;

  function fitCanvas(canvas, gameSize = false) {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // A single fixed whole-assembly scale per view; never scale limbs separately.
    const settings = viewSettings[state.view];
    const scale = gameSize ? 144 / settings.reference : Math.min((width - 24) / settings.fitWidth, (height - 24) / settings.fitHeight);
    // Small preview is fixed CSS-pixel scale, independent of card/window size.
    const originY = gameSize ? height - 27 - settings.ground * scale : (height - settings.fitHeight * scale) / 2 + settings.topOffset * scale;
    ctx.translate(width / 2, originY);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return { ctx, scale };
  }

  function render(canvas, phase, staticPose = false, gameSize = false) {
    if (!ready) return;
    const { ctx } = fitCanvas(canvas, gameSize);
    const source = assets[viewSettings[state.view].source];
    renderer.drawPose(ctx, {
      image: source.image, parts: source.parts, view: state.view, phase, stride: state.stride,
      ground: state.ground, staticPose, bodyMotion: state.bodyMotion,
      guides: state.guides && !gameSize, groundGuide: gameSize
    });
  }

  function updateUi() {
    const settings = viewSettings[state.view];
    const viewName = settings.name;
    const modeName = state.mode === 'static' ? '靜態組裝' : state.playing ? '步行播放' : '步行暫停';
    $('#stage-title').textContent = viewName + ' · ' + modeName;
    $('#status').textContent = ready ? (state.view === 'right' ? '右向三部件' : '正背六部件') + ' · 未驗收候選' : '載入分層素材…';
    $('#play').textContent = state.playing ? '暫停' : '播放步行';
    $('#play').setAttribute('aria-pressed', String(state.playing));
    $('#static').setAttribute('aria-pressed', String(state.mode === 'static'));
    $('#phase').value = String(Math.round(state.phase * 1000));
    $('#phase-value').textContent = Math.round(state.phase * 100) + '%';
    $('#stride').value = String(state.stride);
    $('#ground').min = String(settings.ground - 30);
    $('#ground').max = String(settings.ground + 30);
    $('#ground').value = String(state.ground);
    $('#stride-value').textContent = String(state.stride);
    $('#ground-value').textContent = String(state.ground);
    for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
    for (const card of phaseCards) {
      const match = state.mode !== 'static' && !state.playing && Math.abs(state.phase - Number(card.dataset.phase)) < 0.001;
      card.setAttribute('aria-pressed', String(match));
    }
  }

  function redraw(includeComparisons = true) {
    if (!ready) return;
    render(stage, state.phase, state.mode === 'static');
    render(gameStage, state.phase, state.mode === 'static', true);
    if (includeComparisons) for (const card of phaseCards) render(card.querySelector('canvas'), Number(card.dataset.phase));
    updateUi();
  }

  function stop() {
    state.playing = false;
    lastTime = 0;
    cancelAnimationFrame(frameId);
    frameId = 0;
  }

  function tick(time) {
    if (!state.playing || disposed) return;
    if (lastTime) state.phase = (state.phase + Math.min(time - lastTime, 80) / cycleMs) % 1;
    lastTime = time;
    redraw(false);
    frameId = requestAnimationFrame(tick);
  }

  for (const button of viewButtons) button.addEventListener('click', () => {
    Object.assign(adjustments[viewSettings[state.view].source], { stride: state.stride, ground: state.ground });
    state.view = button.dataset.view;
    Object.assign(state, adjustments[viewSettings[state.view].source]);
    redraw();
  });
  $('#static').addEventListener('click', () => {
    stop();
    state.mode = 'static';
    redraw();
  });
  $('#play').addEventListener('click', () => {
    if (state.playing) stop();
    else {
      state.mode = 'walk';
      state.playing = true;
      lastTime = 0;
      frameId = requestAnimationFrame(tick);
    }
    redraw();
  });
  function selectPhase(phase) {
    stop();
    state.mode = 'walk';
    state.phase = phase % 1;
    redraw();
  }
  $('#phase').addEventListener('input', event => selectPhase(Number(event.target.value) / 1000));
  for (const card of phaseCards) card.addEventListener('click', () => selectPhase(Number(card.dataset.phase)));
  $('#stride').addEventListener('input', event => {
    state.stride = Number(event.target.value);
    redraw();
  });
  $('#ground').addEventListener('input', event => {
    state.ground = Number(event.target.value);
    redraw();
  });
  $('#guides').addEventListener('change', event => {
    state.guides = event.target.checked;
    redraw();
  });
  $('#body-motion').addEventListener('change', event => {
    state.bodyMotion = event.target.checked;
    redraw();
  });
  const observer = new ResizeObserver(() => redraw());
  observer.observe(stage);
  observer.observe(gameStage);
  for (const card of phaseCards) observer.observe(card.querySelector('canvas'));
  document.addEventListener('visibilitychange', () => { lastTime = 0; });
  window.addEventListener('pagehide', () => { disposed = true; stop(); observer.disconnect(); });

  async function loadAtlas(stem, views) {
    const image = new Image();
    image.src = 'layered-mage-source/' + stem + '.png';
    const [metadata] = await Promise.all([
      fetch('layered-mage-source/' + stem + '.json').then(response => {
        if (!response.ok) throw new Error('素材資料讀取失敗：HTTP ' + response.status);
        return response.json();
      }),
      image.decode()
    ]);
    const map = new Map(metadata.parts.map(part => [part.id, part]));
    for (const view of views) {
      const config = configurations[view];
      const ids = view === 'right' ? [config.body, config.near, config.far] : [config.body, config.left, config.right];
      for (const id of ids) {
        const part = map.get(id);
        if (!part || part.sourceRect.length !== 4 || part.pivot.length !== 2) throw new Error('缺少完整部件：' + id);
      }
    }
    return { image, parts: map };
  }
  async function load() {
    const [frontBack, right] = await Promise.all([
      loadAtlas('parts-front-back-v1', ['front', 'back']),
      loadAtlas('parts-right-v1', ['right'])
    ]);
    if (disposed) return;
    assets = { frontBack, right };
    ready = true;
    for (const control of controls) control.disabled = false;
    redraw();
  }
  load().catch(error => {
    if (disposed) return;
    $('#status').textContent = '素材尚未載入';
    $('#error').textContent = '無法載入分層素材。請透過專案 HTTP 頁面開啟。\n' + error.message;
  });
})();

