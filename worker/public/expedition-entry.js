(() => {
  const original = window.RpgInterface.compose;
  const consumedInvites=new Set();
  function open(tab) {
    if (document.getElementById('expedition-overlay')) return;
    const focused = document.activeElement;
    const scroll = window.scrollY;
    const overlay = document.createElement('section');
    overlay.id = 'expedition-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '技能與組隊冒險');
    const bar = document.createElement('header');
    const close = document.createElement('button');
    close.textContent = '‹ 返回冒險';
    const label = document.createElement('span');
    label.textContent = '技能與組隊冒險';
    bar.append(close, label);
    const frame = document.createElement('iframe');
    frame.title = '特殊技能、組隊副本與爬塔';
    const frameUrl=new URL('/expedition/index.html',location.origin);frameUrl.searchParams.set('v','20261020-mastery1');
    if(tab==='star-ring'){const query=new URLSearchParams(location.search);for(const k of ['ringParty','ringChar']){const value=query.get(k);if(value&&/^[A-Za-z0-9:_-]{1,100}$/.test(value))frameUrl.searchParams.set(k,value);}}
    if(tab==='star-ring'&&!frameUrl.searchParams.get('ringParty')){const start=window.Telegram?.WebApp?.initDataUnsafe?.start_param||new URLSearchParams(location.search).get('screen')||new URLSearchParams(location.search).get('tgWebAppStartParam')||'',match=/^ring_([0-9a-f]{32})$/.exec(start);if(match){frameUrl.searchParams.set('ringParty','ring:'+match[1]);const key=String(window.RpgExpeditionHost?.characterId?.()||'')+':'+match[1];if(!consumedInvites.has(key)){frameUrl.searchParams.set('ringJoin','1');consumedInvites.add(key);}}}
    frameUrl.hash=tab;frame.src=frameUrl.href;
    overlay.append(bar, frame);
    document.getElementById('app').inert = true;
    document.body.style.overflow = 'hidden';
    document.body.append(overlay);
    function exit() {
      overlay.remove();window.RpgExpeditionHost?.refresh();window.dispatchEvent(new Event('elf-skills-refresh'));
      window.removeEventListener('message',trade);
      document.getElementById('app').inert = false;
      document.body.style.overflow = '';
      document.removeEventListener('keydown', key);
      window.scrollTo(0, scroll);
      if (focused?.isConnected) focused.focus();
    }
    function key(e) { if (e.key === 'Escape') exit(); }
    close.onclick = exit;
    const trade = ev => { if(ev.origin!==location.origin||ev.source!==frame.contentWindow||ev.data?.type!=='elf-expedition-trade')return;const id=String(ev.data.tradeId||'');if(!/^t[\da-f]{11}$/.test(id))return;window.removeEventListener('message',trade);exit();window.RpgExpeditionHost?.openTrade(id); };
    window.addEventListener('message',trade);
    document.addEventListener('keydown', key);
    close.focus();
  }
  window.RpgExpeditionOpen = open;
  function entry(title, description, choices) {
    const card = document.createElement('section');
    card.className = 'expedition-entry';
    const tag = document.createElement('small'); tag.textContent = '神戰 · 合作冒險';
    const heading = document.createElement('h3'); heading.textContent = title;
    const text = document.createElement('p'); text.textContent = description;
    const buttons = document.createElement('div'); buttons.className = 'expedition-entry-actions';
    for (const [tab, label, subtitle] of choices) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'expedition-choice'; const title = document.createElement('b'); title.textContent = label; button.append(title); if(subtitle){const sub = document.createElement('small');sub.textContent=subtitle;button.append(sub);} button.onclick = () => open(tab);
      buttons.append(button);
    }
    const note = document.createElement('p'); note.className = 'expedition-entry-note';
    note.textContent = '三人討伐／五人星環遠征 · 不同帳號合作';
    card.append(tag, heading, text, buttons, note); return card;
  }
  window.RpgInterface.compose = (view, context) => {
    window.RpgExpeditionOpen = open;
    original(view, context);
    if (context.tab === 'home') {
      const start=window.Telegram?.WebApp?.initDataUnsafe?.start_param||new URLSearchParams(location.search).get('screen')||new URLSearchParams(location.search).get('tgWebAppStartParam')||'';
      if((start==='star-ring'||/^ring_[0-9a-f]{32}$/.test(start))&&!window.__starRingOpened){window.__starRingOpened=true;setTimeout(()=>open('star-ring'),0);}
      if(/^party_p[\da-f]{15}$/.test(start)&&!window.__partyOpened){window.__partyOpened=true;setTimeout(()=>open(start),0);}
      window.RpgSkillWidgets.mount(view,'battle',open);
    } else if(context.tab==='boss'){
      const group=entry('神戰 · 組隊討伐','集結夥伴，迎戰神話首領。',[['star-ring','星環遠征','五人 · 12 小時'],['dungeons','組隊打寶','30級起'],['trials','轉職試煉','三、四轉'],['tower','組隊爬塔','共同闖關'],['rewards','首領精華','兌換']]);group.classList.add('godwar-entry');const chapter=view.querySelector('.my-chapter');if(chapter)chapter.after(group);else view.prepend(group);
      const starRingStart=window.Telegram?.WebApp?.initDataUnsafe?.start_param||new URLSearchParams(location.search).get('screen')||new URLSearchParams(location.search).get('tgWebAppStartParam')||'';if((starRingStart==='star-ring'||/^ring_[0-9a-f]{32}$/.test(starRingStart))&&!window.__starRingOpened){window.__starRingOpened=true;setTimeout(()=>open('star-ring'),0);}
      window.RpgExpeditionHost.partyList().then(r=>{const active=r.active||r.groupActive;if(!group.isConnected||!active)return;const b=document.createElement('button');b.textContent=r.active?'我的隊伍':'查看本場';b.onclick=()=>open('party_'+active.id);group.querySelector('.expedition-entry-actions').append(b);}).catch(()=>{});
    } else if (context.tab === 'bag') {
      window.RpgSkillWidgets.mount(view,'hero',open);
      window.RpgCollectionUI?.place(view);
      view.querySelectorAll('[data-skill-book]').forEach(el=>{el.onclick=()=>open(el.dataset.skillBook);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(el.dataset.skillBook);}};});view.querySelectorAll('[data-boss-resource]').forEach(el=>{el.onclick=()=>open('rewards');el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open('rewards');}};});
    }
  };
})();




