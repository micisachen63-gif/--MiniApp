(() => {
 'use strict';
 const baseClasses = [['all', '全部'], ['sword', '劍士'], ['archer', '妖精'], ['mage', '法師']];
 const pageSize = 20;
 const podiumArt = '/art/hall-podium-20261110/';
 const podiumSpec = [
  { heroIndex: 1, frame: 'silver', place: 'second' },
  { heroIndex: 0, frame: 'gold', place: 'first' },
  { heroIndex: 2, frame: 'bronze', place: 'third' }
 ];

 function heroLabel(h, rank) {
  return '第 ' + rank + ' 名 ' + h.name + '，等級 ' + h.level + '，查看英雄武裝';
 }

 function render(listing, state, { esc, fmt, portrait, includeThief = false }) {
  const classes = includeThief ? [...baseClasses, ['thief', '盜賊']] : baseClasses;
  const filter = classes.some(([key]) => key === state.filter) ? state.filter : 'all';
  const heroes = listing?.heroes || [];
  const filtered = heroes.filter(h => filter === 'all' || h.baseClass === filter);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.max(1, Math.min(pages, Number(state.page) || 1));
  const start = (page - 1) * pageSize;
  const pageHeroes = filtered.slice(start, start + pageSize);
  const tabs = '<div class="hall-tabs" role="tablist" aria-label="等級排名職業">' + classes.map(([key, name]) =>
   '<button class="btn ' + (key === filter ? 'gold' : 'ghost') + '" type="button" role="tab" aria-selected="' + (key === filter) + '" data-hall-class="' + key + '">' + name + '<small>' + heroes.filter(h => key === 'all' || h.baseClass === key).length + '</small></button>'
  ).join('') + '</div>';

  const portraitBox = h => '<div class="hall-portrait" data-member-id="' + esc(h.id) + '">' + (window.RpgStarRingCosmetics?.markup(h.aura) || '') + '<img loading="lazy" decoding="async" src="' + esc(portrait(h)) + '" alt="' + esc(h.name) + '外觀"></div>';
  const details = h => '<b>' + esc(h.name) + '</b>' + (h.title ? '<small class="tower-title-chip">' + esc(h.title.name) + '</small>' : '') + '<span class="hall-class-line">' + esc(h.className) + ' · Lv.' + h.level + '</span>' + (h.aura ? '<small class="hall-aura-label">✧ ' + esc(h.aura.name) + '</small>' : '');

  const podiumCard = (h, rank, slot) => '<button type="button" class="hall-hero hall-podium-hero ' + slot.place + '" data-hall-hero="' + esc(h.id) + '" aria-label="' + esc(heroLabel(h, rank)) + '">' +
   '<i class="hall-podium-glow" aria-hidden="true"></i>' +
   '<span class="hall-podium-stage">' +
    '<img class="hall-medal" src="' + podiumArt + 'medal-' + rank + '.svg" alt="" width="48" height="48" decoding="async" draggable="false" aria-hidden="true">' +
    '<span class="hall-frame">' +
     portraitBox(h) +
     '<img class="hall-frame-ornament" src="' + podiumArt + 'frame-' + slot.frame + '.svg" alt="" decoding="async" draggable="false" aria-hidden="true">' +
    '</span>' +
   '</span>' +
   '<span class="hall-stand" aria-hidden="true"></span>' +
   '<span class="hall-meta">' + details(h) + '<strong class="hall-power">戰力 ' + fmt(h.power) + '</strong></span>' +
  '</button>';

  const listRow = (h, rank) => '<button type="button" class="hall-hero hall-list-row" data-hall-hero="' + esc(h.id) + '" aria-label="' + esc(heroLabel(h, rank)) + '">' +
   '<em class="hall-rank" aria-hidden="true"><b>' + rank + '</b><small>名</small></em>' +
   portraitBox(h) +
   '<span class="hall-who">' + details(h) + '</span>' +
   '<strong class="hall-power-inline">戰力 ' + fmt(h.power) + '</strong>' +
  '</button>';

  let body;
  if (!listing) body = '<p class="muted" role="status">載入英雄中…</p>';
  else if (!filtered.length) body = '<p class="muted hall-empty">此職業尚無英雄</p>';
  else {
   const rows = [];
   pageHeroes.forEach((h, i) => { if (!(start === 0 && i < 3)) rows.push(listRow(h, start + i + 1)); });
   const podiumHtml = start === 0 ? podiumSpec.map(slot => {
    const h = pageHeroes[slot.heroIndex];
    return h ? podiumCard(h, start + slot.heroIndex + 1, slot) : '';
   }).join('') : '';
   body = (podiumHtml ? '<div class="hall-podium" aria-label="前三名頒獎台">' + podiumHtml + '</div>' : '') +
    (rows.length ? '<div class="hall-list" aria-label="第 4 名起列表">' + rows.join('') + '</div>' : '');
  }

  const pager = listing && filtered.length ? '<div class="hall-pagination" aria-label="排行榜分頁"><button class="btn ghost" type="button" data-hall-page="' + (page - 1) + '" ' + (page === 1 ? 'disabled' : '') + '>上一頁</button><span aria-live="polite">' + page + ' / ' + pages + ' 頁<small>共 ' + filtered.length + ' 位英雄</small></span><button class="btn ghost" type="button" data-hall-page="' + (page + 1) + '" ' + (page === pages ? 'disabled' : '') + '>下一頁</button></div>' : '';
  return '<section class="hero-hall card"><p class="hall-lead muted">等級由高到低 · 同級依戰力排序<br>開啟時讀取最新排行 · 點英雄查看武裝</p>' + tabs + body + pager + '</section>';
 }

 // Character sheets carry uneven transparent padding (some heroes stand small and low,
 // others fill the tile). Measure the opaque silhouette once and place the image so the
 // podium shows the whole hero standing on the frame floor and list avatars show the head.
 const bounds = new WeakMap();
 function silhouette(img) {
  if (bounds.has(img)) return bounds.get(img);
  let box = null;
  try {
   const w = 96, h = Math.max(1, Math.round(96 * img.naturalHeight / img.naturalWidth));
   const c = document.createElement('canvas'); c.width = w; c.height = h;
   const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
   const d = g.getImageData(0, 0, w, h).data;
   let x0 = w, y0 = h, x1 = -1, y1 = -1;
   for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
   if (x1 >= x0 && y1 >= y0) {
    const band = y0 + Math.max(1, Math.round((y1 - y0) * 0.12));
    let hx0 = w, hx1 = -1;
    for (let y = y0; y <= band; y++) for (let x = x0; x <= x1; x++) if (d[(y * w + x) * 4 + 3] > 40) { if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; }
    box = { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h, head: hx1 >= hx0 ? (hx0 + hx1 + 1) / 2 / w : (x0 + x1 + 1) / 2 / w };
   }
  } catch { box = null; }
  bounds.set(img, box); return box;
 }
 function place(img) {
  const holder = img.parentElement, box = img.isConnected && img.naturalWidth && silhouette(img);
  if (!holder || !box) return;
  const W = holder.clientWidth, H = holder.clientHeight; if (!W || !H) return;
  const nw = img.naturalWidth, nh = img.naturalHeight, bw = box.w * nw, bh = box.h * nh;
  let scale, left, top;
  if (holder.closest('.hall-podium')) {
   scale = Math.min(W * 0.94 / bw, H * 0.95 / bh);
   left = W / 2 - (box.x * nw + bw / 2) * scale; top = H - H * 0.025 - (box.y * nh + bh) * scale;
  } else {
   const side = bh * 0.4; scale = Math.max(W, H) / side;
   left = W / 2 - box.head * nw * scale; top = -(box.y * nh - bh * 0.03) * scale;
  }
  img.classList.add('hall-fit');
  Object.assign(img.style, { width: (nw * scale).toFixed(1) + 'px', height: (nh * scale).toFixed(1) + 'px', left: left.toFixed(1) + 'px', top: top.toFixed(1) + 'px' });
 }
 function fitPortraits(root) {
  const imgs = [...root.querySelectorAll('.hero-hall .hall-portrait img')];
  for (const img of imgs) { if (img.complete && img.naturalWidth) place(img); else img.addEventListener('load', () => place(img), { once: true }); }
  if (typeof ResizeObserver === 'function' && imgs.length) {
   const ro = new ResizeObserver(() => { const live = imgs.filter(i => i.isConnected); if (!live.length) return ro.disconnect(); live.forEach(place); });
   const hall = root.querySelector('.hero-hall'); if (hall) ro.observe(hall);
  }
 }

 function bind(root, { onFilter, onPage, onInspect }) {
  fitPortraits(root);
  root.querySelectorAll('[data-hall-class]').forEach(b => b.onclick = () => onFilter(b.dataset.hallClass));
  root.querySelectorAll('[data-hall-page]').forEach(b => b.onclick = () => { if (!b.disabled) onPage(Number(b.dataset.hallPage)); });
  root.querySelectorAll('[data-hall-hero]').forEach(b => b.onclick = () => onInspect(b.dataset.hallHero));
 }
 window.RpgHeroHallUI = { render, bind };
})();
