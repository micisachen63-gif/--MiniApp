/* /classic-next (P7) 設定／選單: every classic feature that is not on the scene HUD, as one
 * floating menu over the scene. Icons are existing repo art only (classic nav/command icons and the
 * scene function-icon sheet); nothing here fetches data or runs timers. */
(() => {
  'use strict';
  const SHEET = '/ui-generated-20261030/function-icons-sheet-dark-v1.png';
  // Function-icon sheet cells (3×2): 背包, 裝備, 補給 / 技能, 地圖, 設定 — same order as the scene bar.
  const cell = i => `<i class="cn-menu-sheet" style="background-image:url('${SHEET}');background-position:${[0, 50, 100][i % 3]}% ${i < 3 ? 0 : 100}%"></i>`;
  const art = src => `<img src="${src}" alt="" aria-hidden="true" draggable="false" loading="lazy">`;
  const GROUPS = [
    ['角色', [
      ['hero', '角色・戰報與能力', '英雄資料、能力與戰報', art('art/ui/nav-home-20261012.webp')],
      ['sk', '職業・技能', '當前傳承、技能與五輪成長', cell(3)],
      ['lineage', '完整成長樹', '職業分支與天賦樹', art('art/ui/nav-class-20261012.webp')],
      ['talents', '天賦', '星圖天賦配置', art('art/ui/nav-class-20261012.webp')],
      ['select', '選擇角色', '切換或建立角色', art('art/ui/hud-race-sword-v2.webp')],
    ]],
    ['冒險', [
      ['atlas', '星圖派遣・構築・任務', '出征星圖、調整構築、星圖任務', cell(4)],
      ['home', '冒險入口', '遠征戰場、命運旅章與各冒險入口', art('art/ui/titan-gate-v1.webp')],
      ['boss', '神戰', '首領、星環與神戰入口', art('art/ui/nav-boss-20261012.webp')],
      ['guardian', '守護天使', '召喚、融合與守護', art('art/ui/item-guardian_voucher-20261015.webp')],
    ]],
    ['營地', [
      ['inv', '背包', '道具庫與消耗品', cell(0)],
      ['eq', '裝備', '英雄武裝：強化、洗鍊與穿戴', cell(1)],
      ['vault', '神器庫', '收藏的裝備', art('art/ui/gacha-weapon-20261015.webp')],
      ['collection', '圖鑑收集', '收藏祝福與核心兌換', art('art/ui/command-collect-20261012.webp')],
      ['sup', '補給與策略', '藥水、自動補給與策略', cell(2)],
      ['shop', '市集', '商店、販售與交易所', art('art/ui/command-shop-20261012.webp')],
      ['recovery', '典藏與精煉', '裝備典藏、回收與精煉', art('art/ui/forge-flow-20261011.webp')],
    ]],
    ['社交', [
      ['chat', '聊天', '與旅人聊天', art('art/ui/hermes-market-v1.webp')],
      ['trade', '集會', '英雄殿堂、交易與社交', art('art/ui/command-trade-20261012.webp')],
      ['fate', '出生與旅箋', '命運旅章：出生、旅箋與回執', art('art/ui/fate-oracle-v1.webp')],
      ['ledger', '戰報紀錄', '已結算的戰報與收益', art('art/ui/journal-cover-20261013.webp')],
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
