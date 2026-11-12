/* /classic-next: Lv.600 rounds (P3) and talents (P4) in the classic look.
 * Pure rendering; the classic app owns data (me, atlas/talents) and opens the existing Atlas
 * talent panel for every change, so allocation keeps its confirm, preview and uncertain-result flow. */
(() => {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n || 0).toLocaleString('zh-TW');
  const maps = () => window.RpgMaps;
  function progression(c) { return maps()?.progression?.(c?.level) || null; }
  // Home: 第N輪・模式 badge beside Lv., and the map label of the current round.
  function badge(c) {
    const p = progression(c); if (!p) return '';
    return `<span class="next-round-badge mode-${esc(p.mode.id)}" title="第 ${p.round} 輪 · ${esc(p.mode.name)}模式 · 本輪 Lv.${p.localLevel} / ${p.cycleLevels}">第${p.round}輪・${esc(p.mode.name)} <b>Lv.${p.localLevel}</b>/${p.cycleLevels}</span>`;
  }
  function mapLabel(c) {
    const p = progression(c); if (!p) return '';
    const server = c?.idleMap?.name;
    return `${p.scene.emoji} ${server || (p.mode.index ? p.scene.name + '-' + p.mode.name : p.scene.name)}`;
  }
  // 職業: five rounds of 120 levels and the class awakenings.
  function roundCard(c) {
    const p = progression(c); if (!p) return '';
    const rows = maps().modes.map((m) => {
      const state = p.mode.id === m.id ? 'now' : m.maxLevel < p.level ? 'done' : 'locked';
      const text = state === 'now' ? (p.level >= p.maxLevel ? '已達最高等級' : `進行中 · 本輪 Lv.${p.localLevel} / ${p.cycleLevels}`) : state === 'done' ? '已完成' : '尚未開放';
      return `<li class="next-round-row ${state}"><span class="next-round-no">第${m.round}輪</span><b class="mode-${esc(m.id)}">${esc(m.name)}</b><span class="muted">Lv.${m.minLevel}–${m.maxLevel}</span><span class="next-round-state">${text}</span></li>`;
    }).join('');
    const awakening = maps().awakenings(c.baseClass, p.level).map((a) => `<li class="${a.unlocked ? 'on' : 'off'}"><span>${a.unlocked ? '✦' : '🔒'}</span><b>${esc(a.name)}</b><small>${esc(maps().modes.find((m) => m.id === a.mode).name)} · Lv.${a.unlockLevel}</small></li>`).join('');
    return `<div class="card next-round-card"><h3>🌌 五輪成長 <small>Lv.${p.level} / ${p.maxLevel}</small></h3>
      <ol class="next-round-list">${rows}</ol>
      <p class="muted mt">每輪 120 級，依序 普通 → 菁英 → 專家 → 惡夢 → 地獄，最高 Lv.${p.maxLevel}。每一輪重走同樣的 12 張地圖（地圖依本輪等級切換），怪物更強；新掉落的裝備會標上模式（例如「-菁英」），既有裝備與強化 +N 完整保留。${p.next ? `本輪滿 120 級後進入「${esc(p.next.name)}」。` : '已是最後一輪。'}</p>
      <h3 class="mt">⚡ 覺醒技 <small>每進入新一輪解鎖一招</small></h3><ul class="next-awakening-list">${awakening}</ul>
      <p class="muted">覺醒技在星圖派遣的輪迴地圖中自動施放。</p></div>`;
  }
  function talentCard(state, level) {
    const head = '<h3>✧ 天賦 <small>星圖天賦星盤</small></h3>';
    if (!state || state.status === 'loading' || state.status === 'idle') return `<div class="card next-talent-card">${head}<div class="muted">正在讀取天賦…</div></div>`;
    if (state.status === 'error') return `<div class="card next-talent-card">${head}<div class="muted">${esc(state.error || '天賦暫時無法讀取')}</div><div class="row mt"><button class="btn ghost" data-next-talent-reload>重新讀取</button></div></div>`;
    const t = state.data, catalog = t?.catalog;
    if (!catalog) return `<div class="card next-talent-card">${head}<div class="muted">這個角色目前沒有天賦資料。</div></div>`;
    const owned = new Set(t.allocatedIds || []);
    const branches = (catalog.branches || []).map((b) => {
      const nodes = catalog.nodes.filter((n) => n.branch === b.id), have = nodes.filter((n) => owned.has(n.id)).length;
      return `<div class="next-talent-branch"><div class="next-talent-branch-head"><b>${esc(b.name)}</b><span>${have} / ${nodes.length}</span></div>${'<div class="bar exp"><i style="width:' + (nodes.length ? Math.round(have / nodes.length * 100) : 0) + '%"></i><b>' + esc(b.mainSkill || '') + ' · 擅長' + esc((b.strengths || []).join('、')) + '</b></div>'}<small class="muted">取捨：${esc((b.weaknesses || []).join('、'))}</small></div>`;
    }).join('');
    const keyNodes = catalog.nodes.filter((n) => owned.has(n.id) && n.kind && n.kind !== 'minor' && n.kind !== 'origin').map((n) => `<li><b>${esc(n.name)}</b><span class="muted">${esc(n.description)}</span></li>`).join('');
    return `<div class="card next-talent-card">${head}
      <div class="next-talent-points"><div><b>${num(t.availablePoints)}</b><span>可用點數</span></div><div><b>${num(t.spent)}</b><span>已配置</span></div><div><b>${num(t.totalPoints)}</b><span>總點數 · Lv.${num(level)}</span></div></div>
      <div class="mt" style="font-size:13px">目前效果：${esc(t.effectText || '尚未配置天賦')}</div>
      ${keyNodes ? `<ul class="next-talent-keys mt">${keyNodes}</ul>` : ''}
      <div class="next-talent-branches mt">${branches}</div>
      <div class="muted mt">天賦在星圖派遣中生效；配點、整條路線預覽與洗點都在天賦星盤完成，每一步都會先確認。</div>
      <div class="row mt"><button class="btn gold" data-next-talent-open>${t.availablePoints ? `配置天賦 · ${num(t.availablePoints)} 點` : '開啟天賦星盤'}</button><button class="btn ghost" data-next-talent-reload>重新讀取</button></div></div>`;
  }
  // The classic home composer (mythic-ui) flattens the profession line to text; put the pill back.
  function pill(view, c) {
    const html = badge(c), line = view?.querySelector?.('.my-hero-profession');
    if (!html || !line || line.querySelector('.next-round-badge')) return false;
    const t = document.createElement('template'); t.innerHTML = html; const node = t.content.firstElementChild;
    const text = node.textContent; line.textContent = line.textContent.replace(text, '').replace(/\s+$/, '');
    line.append(node); line.classList.add('next-has-round'); return true;
  }
  window.RpgClassicNextGrowth = Object.freeze({ badge, mapLabel, roundCard, talentCard, progression, pill });
})();
