/* /classic-next 設定: the classic features the bottom bar (營地/英雄/市集/神戰/旅團) and the scene HUD
 * do not already open, as one floating menu over the scene. Icons are existing repo art only (classic nav/command icons and the
 * scene function-icon sheet); nothing here fetches data or runs timers. */
(() => {
  'use strict';
  const SHEET = '/ui-generated-20261030/function-icons-sheet-dark-v1.png';
  // Function-icon sheet cells (3×2): 背包, 裝備, 補給 / 技能, 地圖, 設定 — same order as the scene bar.
  const cell = i => `<i class="cn-menu-sheet" style="background-image:url('${SHEET}');background-position:${[0, 50, 100][i % 3]}% ${i < 3 ? 0 : 100}%"></i>`;
  const art = src => `<img src="${src}" alt="" aria-hidden="true" draggable="false" loading="lazy">`;
  // P8 (owner t711u): the classic bar covers 營地/英雄/市集/神戰/旅團; 設定 keeps only the rest.
  const GROUPS = [
    ['傳承', [
      ['sk', '職業・技能', '當前傳承、技能與五輪成長', art('art/ui/nav-class-20261012.webp')],
      ['lineage', '完整成長樹', '職業分支與天賦樹', cell(3)],
      ['talents', '天賦', '星圖天賦配置', art('art/ui/forge-scroll-20261011.webp')],
    ]],
    ['帳號', [
      ['select', '選擇角色・切換世界', '切換、建立角色或世界', art('art/ui/hud-race-sword-v2.webp')],
    ]],
  ];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function html(options = {}) {
    const hidden = new Set(options.hide || []);
    return `<div class="cn-menu-groups">${GROUPS.map(([title, items]) => `<section class="cn-menu-group"><h3>${esc(title)}</h3><div class="cn-menu-grid">${items.filter(([id]) => !hidden.has(id)).map(([id, label, sub, icon]) => `<button type="button" class="cn-menu-item" data-next-open="${id}"><span class="cn-menu-icon">${icon}</span><span class="cn-menu-text"><b>${esc(label)}</b><small>${esc(sub)}</small></span></button>`).join('')}</div></section>`).join('')}</div><button type="button" class="btn ghost cn-menu-logout" data-next-logout>登出並返回選角畫面</button>`;
  }
  const ids = () => GROUPS.flatMap(([, items]) => items.map(([id]) => id));
  window.RpgClassicNextMenu = { GROUPS, html, ids };
})();
