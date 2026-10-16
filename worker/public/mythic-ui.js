/* Recompose the existing functional DOM. Move nodes rather than clone them:
   their event handlers, data attributes and art references travel with them. */
(() => {
  'use strict';
  document.body.classList.add('olympus-suite');
  const domains = { home: 'OLYMPUS · EXPEDITION', bag: 'ATHENA · HERO HALL', shop: 'HERMES · EMPORIUM', boss: 'TARTARUS · TRIAL', trade: 'AGORA · FELLOWSHIP', class: 'ASTRA · DESTINY', select: 'OLYMPUS · HEROES', create: 'OLYMPUS · AWAKENING' };
  const chapters = {
    home: ['I', '英雄遠征', '穿越諸神的領域，書寫你的史詩。'],
    bag: ['II', '英雄殿堂', '武裝英雄 · 收藏神器 · 整備行囊'],
    shop: ['III', '赫密士市集', '為下一段遠征，備妥武器與補給。'],
    boss: ['IV', '諸神試煉', '集結冒險者，迎戰世界首領。'],
    trade: ['V', '英雄集會', '交換戰利品，或在競技場一決高下。'],
    class: ['VI', '命運星圖', '選擇你的傳承，踏上下一階英雄之路。'],
    select: ['✦', '英雄之門', '選擇一位英雄，展開你的希臘史詩。'],
    create: ['✦', '誕生的誓約', '名字、天賦與容貌，成就你的英雄。'],
  };
  const node = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };
  function chapter(view, key) {
    const [roman, title, description] = chapters[key];
    const h = node('header', 'my-chapter');
    const sigil = node('span', 'my-sigil', roman); sigil.setAttribute('aria-hidden', 'true');
    const icon = document.querySelector('#nav [data-tab="' + (key === 'select' || key === 'create' ? 'home' : key) + '"] svg');
    if (icon) { sigil.textContent = ''; sigil.append(icon.cloneNode(true)); }
    const copy = node('div', 'my-chapter-copy'); copy.append(node('div', 'my-domain', '星穹旅誌 · ' + domains[key].split(' · ')[1]), node('h1', '', title), node('p', '', description));
    h.append(sigil, copy); view.prepend(h);
  }
  function panels(parent, entries, state, key, selected) {
    const tabs = node('div', 'my-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '頁面內容');
    const host = node('div', 'my-panel-host');
    const panes = entries.map(([id, label, children]) => {
      const panel = node('section', 'my-panel'); panel.id = 'my-panel-' + key + '-' + id;
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'my-tab-' + key + '-' + id);
      children.filter(Boolean).forEach(child => panel.append(child)); host.append(panel);
      const button = node('button', '', label); button.type = 'button'; button.dataset.panel = id;
      button.id = 'my-tab-' + key + '-' + id; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', panel.id);
      tabs.append(button); return { id, button, panel };
    });
    function choose(id, focus = false) {
      state[key] = id;
      panes.forEach(p => { const on = p.id === id; p.panel.hidden = !on; p.button.classList.toggle('on', on); p.button.setAttribute('aria-selected', String(on)); p.button.tabIndex = on ? 0 : -1; if (on && focus) p.button.focus(); });
    }
    panes.forEach((p, i) => {
      p.button.onclick = () => choose(p.id);
      p.button.onkeydown = e => { let next;
        if (e.key === 'ArrowRight') next = (i + 1) % panes.length;
        if (e.key === 'ArrowLeft') next = (i + panes.length - 1) % panes.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = panes.length - 1;
        if (next !== undefined) { e.preventDefault(); choose(panes[next].id, true); }
      };
    });
    parent.append(tabs, host); choose(panes.some(p => p.id === state[key]) ? state[key] : selected || panes[0].id);
  }
  function labelCard(card, eyebrow) { if (card) card.prepend(node('div', 'my-eyebrow', eyebrow)); }
  function heroStats(profile, me) {
    if (!profile || !me.stats) return;
    const s = me.stats, fmt = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
    const stats = node('dl', 'my-hero-stats'); stats.setAttribute('aria-label', '角色戰鬥能力');
    for (const [name, value] of [['攻擊', fmt(s.atk)], ['防禦', fmt(s.def)], ['爆擊', fmt(s.crit) + '%'], ['戰力', fmt(s.power)]]) {
      const pair = node('div', ''); pair.append(node('dt', '', name), node('dd', '', value)); stats.append(pair);
    }
    const labels = [['earth', '地'], ['water', '水'], ['fire', '火'], ['wind', '風'], ['light', '光'], ['dark', '暗']];
    const totals = Object.fromEntries(labels.map(([key]) => [key, 0]));
    for(const key of Object.keys(totals))totals[key]=Number(s.elementResist?.[key]||0);
    const elements = node('dl', 'my-hero-elements'); elements.setAttribute('aria-label', '防具與飾品元素抗性');
    for (const [key, name] of labels) {
      const pair = node('div', 'my-element'); pair.dataset.element = key;
      pair.append(node('dt', '', name), node('dd', '', fmt(totals[key])+' · '+Math.round((s.elementResistance?.[key]||0)*100)+'%')); elements.append(pair);
    }
    const detail = node('div', 'my-hero-traits');
    const weapon = labels.find(([key]) => key === s.element)?.[1] || '無';
    detail.append(node('span', '', '武器屬攻：'+weapon+' +'+fmt(s.weaponElem||0)+' · 屬抗減傷上限 40%'), node('span', '', '受傷倍率 ×' + fmt(s.taken)));
    profile.append(stats, elements, detail);
    const cycles=node('div','my-fate-cycles'),cycleText=node('span','','輪迴 · 載入中');cycleText.setAttribute('data-fate-cycles','');cycles.append(cycleText);profile.append(cycles);
    const identity = profile.querySelector('.cls');
    if (identity) {
      const level = identity.querySelector('.lv');
      const profession = [...identity.childNodes].filter(n => n !== level).map(n => n.textContent).join('').trim();
      identity.replaceChildren(node('strong', 'my-hero-name', me.character.name), ...(level ? [level] : []));
      identity.after(node('div', 'my-hero-profession', profession));
    }
  }
  function equipmentHall(wardrobe, me) {
    if (!wardrobe) return;
    const title = wardrobe.querySelector('h3');
    if (title) {
      const copy = node('div', 'my-hall-copy'); copy.append(node('small', '', '英雄武裝'), node('strong', '', me.character.name));
      const power = node('div', 'my-hall-power'); power.append(node('small', '', '戰力'), node('strong', '', Number(me.stats.power || 0).toLocaleString('en-US')));
      const head = node('header', 'my-hall-heading'); head.append(copy, power); title.replaceWith(head);
    }
    const figure = wardrobe.querySelector('.fig');
    const figures = figure?.querySelector('.figstats');
    if (figures) { figures.classList.add('my-hall-stats'); wardrobe.append(figures); }
    window.RpgHeroEffects?.mount(wardrobe, me.character);
    const hint = node('p', 'my-hall-hint', '11 個裝備欄位 · 點選神器查看與穿脫'); wardrobe.append(hint);
    wardrobe.querySelectorAll('.slot').forEach(slot => {
      slot.setAttribute('role', 'button'); slot.tabIndex = 0;
      slot.setAttribute('aria-label', slot.querySelector('small')?.textContent || '裝備欄位');
      slot.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); slot.click(); } };
    });
  }
  function compose(view, context) {
    window.RpgHeroEffects?.reset();
    const { tab, state, me } = context; view.dataset.screen = tab;
    chapter(view, tab);
    if (tab === 'select') { view.querySelector('.char-select-title')?.remove(); return; }
    if (tab === 'create') return;
    if (tab === 'home') {
      const adventure = view.querySelector('.lc-adventure');
      const todo = view.querySelector('.todo');
      const supply = [...view.querySelectorAll('.card')].find(e => e.querySelector('#refill'));
      const daily = [...view.querySelectorAll('.card')].find(e => e.querySelector('#daily'));
      const report = [...view.querySelectorAll('.card')].find(e => e.querySelector('#ledger'));
      const stats = [...view.querySelectorAll('.card')].find(e => e.querySelector('.stats'));
      const alerts = [...view.querySelectorAll(':scope > .banner')];
      const oldLine = adventure?.querySelector('.lc-topline'); if (oldLine) oldLine.remove();
      const all = node('div', 'my-home'); view.append(all);
      labelCard(supply, 'AMBROSIA · 遠征補給'); labelCard(daily, 'BLESSING · 每日祝福');
      labelCard(report, 'CHRONICLE · 戰鬥紀事'); labelCard(stats, 'HERO · 英雄能力');
      panels(all, [['journey', '遠征戰場', [adventure, ...alerts, todo, daily]], ['supply', '補給與策略', [supply]], ['chronicle', '戰報與能力', [stats, report]]], state, 'home');
      const guardianEntry=node('button','','守護天使');guardianEntry.type='button';guardianEntry.dataset.guardianEntry='';guardianEntry.setAttribute('aria-label','開啟守護天使召喚、背包、升階與圖鑑');guardianEntry.onclick=()=>context.openGuardian?.();all.querySelector('.my-tabs').append(guardianEntry);
      // Tabs precede the stage, but its frame and original geometry are retained.
      view.querySelector('.lc-profile')?.classList.add('my-vitals');
      heroStats(view.querySelector('.lc-profile'), me);
    }
    if (tab === 'bag') {
      const root = view.querySelector('.lc-character');
      root.querySelector('.lc-window-title')?.remove();
      const wardrobe = root.querySelector('.lc-equip'); const equipment = root.querySelector('.bag-equipment');
      const inventory = [...root.querySelectorAll('.card')].find(e => e.querySelector('.inv'));
      labelCard(wardrobe, 'HERO · 英雄武裝'); labelCard(equipment, 'ARTIFACTS · 神器收藏'); labelCard(inventory, 'SATCHEL · 遠征行囊');
      equipmentHall(wardrobe, me);
      panels(root, [['wardrobe', '英雄武裝', [wardrobe]], ['vault', '神器庫', [equipment]], ['items', '道具庫', [inventory]], ['collection', '圖鑑收集', [root.querySelector('.collection-inventory')]]], state, 'bag');
      equipment?.querySelector('.bag-equip-list')?.classList.add('my-equipment-grid');
      // An acquired item remains immediately findable, even after a shop purchase.
      const reveal = context.revealInventory;
      if (reveal) root.querySelector('[data-panel="vault"]')?.click();
    }
    if (tab === 'shop') {
      const categories = view.querySelector('.tabs'); categories?.classList.add('my-market-categories');
      const market = node('div', 'my-market-grid');
      [...view.querySelectorAll(':scope > .item')].forEach(e => market.append(e));
      if (market.children.length) { if (categories) categories.after(market); else view.append(market); }
      market.querySelectorAll('.item').forEach(item => {
        const purchase = item.querySelector('[data-gear]');
        if (purchase) { const footer = purchase.parentElement; footer.classList.add('my-product-footer'); footer.removeAttribute('style'); }
      });
      const balance = node('aside', 'my-market-balance');
      balance.append(node('span', '', '可用金幣'), node('strong', '', Number(me.character.gold).toLocaleString('en-US')));
      view.querySelector('.my-chapter').after(balance);
    }
    if (tab === 'boss') {
      const arena = view.querySelector('.bossbox'); arena?.classList.add('my-boss-arena');
      view.querySelectorAll('.card').forEach((c, i) => labelCard(c, i === 0 ? 'ORACLE · 試煉情報' : 'GLORY · 英雄榮耀'));
    }
    if (tab === 'trade') {
      view.querySelector('.tabs')?.classList.add('my-social-tabs');
      const guide = [...view.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent.includes('怎麼開始'));
      if (guide) {
        const title = guide.querySelector('h3'); const summary = node('summary', '', '交易指南 · 如何分享與交換');
        const details = node('details', 'my-guide');
        const steps = node('div', 'my-trade-steps');
        ['① 背包分享', '② 群組提出請求', '③ 雙方鎖定', '④ 雙方確認'].forEach(t => steps.append(node('span', '', t)));
        if (title) title.remove(); details.append(summary, ...guide.childNodes); guide.replaceWith(steps, details);
      }
    }
    if (tab === 'class') {
      view.querySelector('.lc-class-title')?.remove();
      const root = view.querySelector('.lc-class-screen');
      if (root) {
        const hero = root.querySelector('.card'); const ancestry = root.querySelector('.elf-ancestry');
        ancestry?.querySelectorAll('.elf-tier').forEach(tier => {
          if (!tier.querySelector('h4')?.textContent.includes('未解鎖') || !/Lv\.(90|120)/.test(tier.querySelector('h4').textContent)) return;
          const details = node('details', 'my-future-tier');
          const summary = node('summary', ''); const heading = tier.querySelector('h4');
          summary.append(heading); details.append(summary, ...tier.children); tier.append(details);
        });
        const progression = node('div', 'my-progression');
        [...root.children].filter(e => e !== hero && e !== ancestry).forEach(e => progression.append(e));
        panels(root, [['destiny', '當前傳承', [hero, progression]], ['lineage', '完整成長樹', [ancestry || node('p', 'muted', '此職業的可選轉職路線已列在「當前傳承」。')]]], state, 'class');
      }
    }
  }
  function composeSheet(card) {
    const showcase = card.querySelector('.showcase');
    if (!showcase || card.querySelector('[data-affix-roll]')) return;
    card.classList.add('my-artifact-sheet');
    const grid = card.querySelector('.grid2'); if (!grid) return;
    const buttons = [...grid.children];
    const equip = node('div', 'my-equip-actions');
    const forge = node('section', 'my-forge'); forge.append(node('h3', '', '赫淮斯托斯工坊'));
    const forgeButtons = node('div', 'grid2'); forge.append(forgeButtons);
    const commerce = node('details', 'my-item-commerce'); commerce.append(node('summary', '', '交易、分享與出售'));
    const commerceButtons = node('div', 'grid2 mt'); commerce.append(commerceButtons);
    const footer = node('div', 'my-item-footer');
    for (const button of buttons) {
      const action = button.dataset.a;
      if (action === 'equip' || action === 'unequip') equip.append(button);
      else if (['enhance', 'reroll'].includes(action)) forgeButtons.append(button);
      else if (action === 'close') footer.append(button);
      else commerceButtons.append(button);
    }
    grid.replaceWith(equip, forge, commerce, footer);
    card.querySelector('.kv')?.classList.add('my-artifact-stats');
  }
  window.RpgInterface = { compose, composeSheet };
})();


