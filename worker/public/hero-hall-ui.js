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
   '<em class="hall-rank">第 ' + rank + ' 名</em>' +
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
  return '<section class="hero-hall card"><p class="hall-lead muted">等級由高到低 · 同級依戰力排序<br>每 5 分鐘更新 · 點頭像查看英雄武裝</p>' + tabs + body + pager + '</section>';
 }

 function bind(root, { onFilter, onPage, onInspect }) {
  root.querySelectorAll('[data-hall-class]').forEach(b => b.onclick = () => onFilter(b.dataset.hallClass));
  root.querySelectorAll('[data-hall-page]').forEach(b => b.onclick = () => { if (!b.disabled) onPage(Number(b.dataset.hallPage)); });
  root.querySelectorAll('[data-hall-hero]').forEach(b => b.onclick = () => onInspect(b.dataset.hallHero));
 }
 window.RpgHeroHallUI = { render, bind };
})();
