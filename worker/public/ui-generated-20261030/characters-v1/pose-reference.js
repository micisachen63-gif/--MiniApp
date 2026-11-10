'use strict';
(async () => {
  const q = new URLSearchParams(location.search);
  const canvas = document.getElementById('pose'), c = canvas.getContext('2d');
  const catalogName = q.get('catalog') || 'base';
  await import('./character-catalog-loader.js');
  const catalogFiles = { base: 'catalog-index.json', advancement: 'advancement-index.json' };
  if (!Object.hasOwn(catalogFiles, catalogName)) throw new Error('catalog 可用值：base、advancement');
  const response = await fetch(catalogFiles[catalogName]);
  if (!response.ok) throw new Error(`${catalogFiles[catalogName]} 載入失敗 (${response.status})`);
  const catalog = await response.json();
  const directionsFor = clips => Object.entries(clips || {})
    .filter(([, clip]) => Array.isArray(clip?.frames) && clip.frames.length)
    .map(([direction]) => direction);
  const actionsFor = actor => Object.keys(actor.clips || {})
    .filter(action => directionsFor(actor.clips[action]).length);
  const actors = (catalog.actors || []).filter(actor => actionsFor(actor).length);
  canvas.dataset.catalog = catalogName;
  canvas.dataset.availableActors = JSON.stringify(actors.map(actor => actor.id));
  if (!actors.length) throw new Error(`${catalogFiles[catalogName]} 沒有可用姿勢`);
  const actorId = q.get('actor') || (catalogName === 'base' ? 'sword_m' : actors[0].id);
  const reference = actors.find(actor => actor.id === actorId || actor.key === actorId);
  if (!reference) throw new Error(`actor「${actorId}」不存在；可用：${actors.map(actor => actor.id).join(', ')}`);
  const actor = await window.CharacterCatalogLoader.loadActor(reference);
  const actions = actionsFor(actor);
  canvas.dataset.availableActions = JSON.stringify(actions);
  const action = q.get('action') || (actions.includes('walk') ? 'walk' : actions[0]);
  if (!actions.includes(action)) throw new Error(`${actor.id} 的 action 可用值：${actions.join(', ')}`);
  const directions = directionsFor(actor.clips[action]);
  canvas.dataset.availableDirections = JSON.stringify(directions);
  const direction = q.get('direction') || (directions.includes('down') ? 'down' : directions[0]);
  if (!directions.includes(direction)) throw new Error(`${actor.id}/${action} 的 direction 可用值：${directions.join(', ')}`);
  const clip = actor.clips[action][direction];
  const frameIndex = q.has('frame') ? Number(q.get('frame')) : Math.min(2, clip.frames.length - 1);
  canvas.dataset.frameCount = String(clip.frames.length);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= clip.frames.length) {
    throw new Error(`${actor.id}/${action}/${direction} 的 frame 可用範圍：0–${clip.frames.length - 1}`);
  }
  const frame = clip.frames[frameIndex];
  // Use the fixed reference for this source, never the current pose's bounding height.
  const bodyHeight = Number(frame.bodyHeight ?? clip.bodyHeight);
  if (!(bodyHeight > 0) || !Number.isFinite(bodyHeight)) throw new Error('姿勢缺少有效的固定 bodyHeight');
  const image = new Image(); image.src = frame.url; await image.decode();
  const [x,y,w,h] = frame.rect, [ax,ay] = frame.anchor;
  const extents = frame.sourceLayers?.length
    ? frame.sourceLayers.reduce((bounds,layer)=>{
      const [, , lw, lh]=layer.rect, [lx,ly]=layer.anchor;
      return [Math.max(bounds[0],lx),Math.max(bounds[1],ly),Math.max(bounds[2],lw-lx),Math.max(bounds[3],lh-ly)];
    },[0,0,0,0]) : [ax,ay,w-ax,h-ay];
  // Reference-only framing for wide fallen silhouettes; no animation/runtime scale changes.
  const s = q.get('fit') === 'frame'
    ? Math.min(1260 / bodyHeight, 550 / Math.max(1,extents[0],extents[2]), 1400 / Math.max(1,extents[1]), 100 / Math.max(1,extents[3]))
    : 1260 / bodyHeight;
  const background = q.get('bg') || q.get('background') || 'gray';
  if (background === 'transparent') document.body.style.background = 'transparent';
  else { c.fillStyle = '#ddd'; c.fillRect(0,0,1200,1600); }
  c.translate(600,1460); if (!!clip.mirrorX !== !!frame.mirrorX) c.scale(-1,1);
  if(frame.render==='layered-walk-v1'||clip.render==='layered-walk-v1') {
    const layered=frame.layered||clip.layered;
    c.scale(s,s);c.translate(0,-layered.ground);
    LayeredWalkRenderer.drawPose(c,{image,...layered,phase:frame.phase??0});
  } else if (frame.sourceLayers?.length) {
    LayeredWalkRenderer.drawPaintedFrame(c,{image,frame,scale:s});
  } else {
  if (frame.sourceClipPolygon) {
    c.beginPath(); frame.sourceClipPolygon.forEach(([px,py],i) => c[i?'lineTo':'moveTo']((px-ax)*s,(py-ay)*s)); c.closePath(); c.clip();
  }
  c.drawImage(image,x,y,w,h,-ax*s,-ay*s,w*s,h*s);
  }
  // Mark this exact reference only after the browser has painted the canvas.
  // Navigation can otherwise return before a background tab commits its bitmap.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  canvas.dataset.action = action;
  canvas.dataset.pose = [actor.id,direction,frameIndex].join(':');
  canvas.dataset.ready = 'true';
})().catch(e => {
  const canvas = document.getElementById('pose');
  canvas.dataset.ready = 'false';
  canvas.dataset.error = e.message;
  canvas.hidden = true;
  canvas.style.display = 'none';
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  error.textContent = e.message;
  document.body.append(error);
});
