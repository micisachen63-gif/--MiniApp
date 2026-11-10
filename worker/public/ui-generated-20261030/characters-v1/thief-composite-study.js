'use strict';
(async () => {
  const response = await fetch('thief-composite-study.json');
  if (!response.ok) throw new Error(`研究資料載入失敗 (${response.status})`);
  const study = await response.json();
  const images = new Map();
  await Promise.all([...new Set([study.upper.url, ...study.frames.map(f => f.url)])].map(async url => {
    const image = new Image(); image.src = url; await image.decode(); images.set(url, image);
  }));
  const container = document.getElementById('frames');
  const original = document.getElementById('original');
  const masks = document.getElementById('masks');
  const preview = document.getElementById('preview');
  const canvases = study.frames.map(frame => {
    const figure = document.createElement('figure'), caption = document.createElement('figcaption'), canvas = document.createElement('canvas');
    canvas.width = study.stage.width; canvas.height = study.stage.height;
    caption.textContent = `${frame.label} · 腳點偏移 ${frame.lowestFootDeltaFromA > 0 ? '+' : ''}${frame.lowestFootDeltaFromA}px`;
    figure.append(caption, canvas); container.append(figure); return canvas;
  });
  function polygons(c, paths) {
    c.beginPath();
    for (const path of paths) { path.forEach(([x,y], i) => c[i ? 'lineTo' : 'moveTo'](x,y)); c.closePath(); }
  }
  function source(c, layer, paths) {
    c.save();
    if (paths) { polygons(c, paths); c.clip(); }
    const [x,y,w,h] = layer.rect;
    c.drawImage(images.get(layer.url), x,y,w,h,x,y,w,h);
    c.restore();
  }
  function sourcePlacement(c, frame) {
    c.translate(...study.upper.registration);
    c.scale(frame.scale, frame.scale);
    c.translate(-frame.sourceRegistration[0], -frame.sourceRegistration[1]);
  }
  function draw(canvas, frame) {
    const c = canvas.getContext('2d'), s = study.stage;
    c.clearRect(0,0,canvas.width,canvas.height); c.fillStyle = s.background; c.fillRect(0,0,canvas.width,canvas.height);
    c.save(); c.translate(s.origin[0],s.origin[1]); c.scale(s.sourceScale,s.sourceScale); c.translate(-s.sourceAnchor[0],-s.sourceAnchor[1]);
    c.save(); sourcePlacement(c,frame); source(c,frame,original.checked ? null : frame.legPolygons); c.restore();
    if (!original.checked) source(c,study.upper,study.upper.polygons);
    if (masks.checked) {
      c.strokeStyle = '#65e6ec'; c.lineWidth = 1; polygons(c,study.upper.polygons); c.stroke();
      c.save(); sourcePlacement(c,frame); c.strokeStyle = '#ffb75d'; c.lineWidth = 1/frame.scale; polygons(c,frame.legPolygons); c.stroke(); c.restore();
      const [x,y] = study.upper.registration;
      c.strokeStyle = '#fff'; c.beginPath(); c.moveTo(x-8,y); c.lineTo(x+8,y); c.moveTo(x,y-8); c.lineTo(x,y+8); c.stroke();
      c.setLineDash([4,4]); c.beginPath(); c.moveTo(80,442); c.lineTo(390,442); c.stroke();
    }
    c.restore(); canvas.dataset.pose = `adv1_thief_A_m:up:${frame.label}`;
  }
  let index = 0, paused = false, last = performance.now();
  const refresh = () => { study.frames.forEach((frame,i) => draw(canvases[i],frame)); draw(preview,study.frames[index]); };
  original.addEventListener('change',refresh); masks.addEventListener('change',refresh);
  document.getElementById('pause').addEventListener('click',event => { paused = !paused; last = performance.now(); event.currentTarget.textContent = paused ? '播放循環' : '暫停循環'; });
  document.getElementById('measurements').textContent = '固定來源尺度：A/B 1；C/D ' + study.frames[2].scale.toFixed(4) + '。沒有按個別彎腿高度再次放大。';
  refresh();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  container.dataset.ready = 'true'; preview.dataset.ready = 'true';
  function tick(now) {
    if (!paused && now-last >= study.frames[index].durationMs) {
      index = (index+1) % study.frames.length; last = now; draw(preview,study.frames[index]);
      document.getElementById('current').textContent = `循環預覽 · ${study.frames[index].label} · 180ms／幀`;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})().catch(error => { document.getElementById('error').textContent = error.message; });
