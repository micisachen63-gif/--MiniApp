(function () {
  'use strict';
  const remembered=new Map(),roles=[['all','全部'],['buy','買入'],['sell','賣出']],qualities=['white','green','blue','purple','red','gold','pink','cyan'];
  const pageState=()=>({items:[],pages:[null],page:0,nextCursor:null,loaded:false});
  function stateFor(actor) {if(!remembered.has(actor)){remembered.set(actor,{role:'all',views:{all:pageState(),buy:pageState(),sell:pageState()}});if(remembered.size>12)remembered.delete(remembered.keys().next().value);}return remembered.get(actor);}
  function mount(root,host) {
    if(!root)return null;
    const actor=String(host.characterId()),state=stateFor(actor),esc=host.esc,fmt=host.fmt;
    let disposed=false,flight=null,controller=null,sequence=0,error='';
    const current=()=>!disposed&&root.isConnected&&String(host.characterId())===actor;
    const view=()=>state.views[state.role];
    const nameClass=item=>item?.kind==='guardian'&&qualities.includes(item.quality)?`guardian-name guardian-quality-${item.quality}`:'';
    const art=item=>item.equipment?host.gearIcon(item.equipment,'✦'):typeof item.art==='string'&&/^\/art\/[A-Za-z0-9/_-]+\.webp$/.test(item.art)?`<img src="${esc(item.art)}" alt="" loading="lazy" draggable="false">`:host.itemIcon(item.item)||'<span aria-hidden="true">✦</span>';
    const date=at=>{try{return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));}catch{return '成交時間暫無';}};
    const iso=at=>{try{return new Date(at).toISOString();}catch{return '';}};
    const meta=item=>[item.kind==='equip'&&`T${item.tier}`,item.qualityName,item.kind==='equip'&&Number(item.enhance)>0&&`+${item.enhance}`,item.guardian?.typeName,item.category==='skillbook'&&item.requiredLevel&&`Lv.${item.requiredLevel}`].filter(Boolean).join(' · ');
    const count=record=>`${fmt(record.qty)} ${record.item.kind==='guardian'?'位':record.item.kind==='equip'?'件':'個'}`;
    function money(record) {return record.role==='sell'?`<dl class="exchange-history-money"><div><dt>成交總價</dt><dd>${fmt(record.price)}</dd></div><div><dt>手續費 <small>5%</small></dt><dd>−${fmt(record.fee)}</dd></div><div class="is-total"><dt>實收金幣</dt><dd>+${fmt(record.netGold)}</dd></div></dl>`:`<dl class="exchange-history-money"><div><dt>成交總價</dt><dd>${fmt(record.price)}</dd></div><div class="is-total"><dt>付款金幣</dt><dd>−${fmt(record.paidGold)}</dd></div></dl><p class="exchange-history-note">手續費由賣方負擔，買入不另收費。</p>`;}
    function details(record) {
      const item=record.item,e=item.equipment,g=item.guardian;
      return `<div class="exchange-history-detail"><div class="exchange-history-detail-heading"><span class="exchange-history-art">${art(item)}</span><div><small>${record.role==='sell'?'賣出紀錄':'買入紀錄'}</small><h3 class="${nameClass(item)}">${esc(item.name)}</h3><p>${esc(meta(item))} · ${esc(count(record))}</p></div></div><p class="exchange-history-note">${esc(date(record.settledAt))}（台灣時間）<br>${record.role==='sell'?'買家':'賣家'}：${esc(record.counterparty?.name||'旅者')}</p>${money(record)}${e?`<div class="exchange-detail-stats"><b>${esc(e.statName||'能力')} ${fmt(e.stat||0)}</b>${e.elementName?`<span>${esc(e.elementName)} +${fmt(e.elemStat||0)}</span>`:''}</div>${e.affixes?.lines?.length?`<div class="exchange-detail-affixes">${e.affixes.lines.map(line=>`<p>${esc(line.name)} +${(Number(line.value)*100).toFixed(2)}% <small>${esc(line.quality||'')}</small></p>`).join('')}</div>`:''}`:g?`<p class="exchange-history-note">成交時的守護天使：${esc(g.qualityName)} · ${esc(g.typeName)}<br>能力類型：${esc(g.ability)}</p>`:item.desc?`<p class="exchange-history-note">${esc(item.desc)}</p>`:''}<p class="exchange-history-snapshot">${item.snapshotAvailable?'此處保留成交時的物品快照，供你回顧與核對。':'物品快照暫無法顯示，成交金額與時間仍可核對。'}</p></div>`;
    }
    function paint() {
      if(!current())return;const p=view();
      root.innerHTML=`<section class="exchange-history" aria-label="自己的成交紀錄" aria-busy="${!!flight}"><div class="exchange-history-head"><div><h3>旅途中的交換</h3><p>記下珍藏與下一位旅者相遇的時刻。</p></div></div><div class="exchange-history-filters" role="group" aria-label="成交類型">${roles.map(([role,name])=>`<button type="button" data-history-role="${role}" aria-pressed="${state.role===role}" class="${state.role===role?'on':''}" ${flight?'disabled':''}>${name}</button>`).join('')}</div>${error?`<p class="exchange-error" role="alert">${esc(error)}</p><button type="button" class="btn ghost sm" data-history-refresh ${flight?'disabled':''}>重新讀取</button>`:''}${flight&&!p.loaded?'<div class="exchange-loading" role="status">正在翻開你的成交紀錄…</div>':p.items.length?`<div class="exchange-history-list">${p.items.map(record=>`<button type="button" class="exchange-history-record" data-history-detail="${esc(record.id)}" ${flight?'disabled':''}><span class="exchange-history-art" data-quality="${esc(record.item.quality||'common')}">${art(record.item)}</span><span class="exchange-history-info"><span class="exchange-history-record-head"><small class="exchange-history-role ${record.role==='sell'?'is-sell':'is-buy'}">${record.role==='sell'?'賣出':'買入'}</small><time datetime="${iso(record.settledAt)}">${esc(date(record.settledAt))}</time></span><strong class="${nameClass(record.item)}">${esc(record.item.name)}</strong><small>${esc(meta(record.item))}${meta(record.item)?' · ':''}${esc(count(record))}</small><span class="exchange-history-total">${record.role==='sell'?'實收':'付款'} <b>${record.role==='sell'?'+':'−'}${fmt(record.role==='sell'?record.netGold:record.paidGold)}</b><small>金幣</small><span class="exchange-history-chevron" aria-hidden="true">›</span></span></span></button>`).join('')}</div>`:'<div class="exchange-empty"><span aria-hidden="true">✦</span><strong>尚無成交紀錄</strong><p>完成交易後，買入與賣出明細會留在這裡。</p></div>'}<div class="exchange-pager"><button type="button" class="btn ghost sm" data-history-prev ${flight||p.page===0?'disabled':''}>上一頁</button><span>第 ${p.page+1} 頁</span><button type="button" class="btn ghost sm" data-history-next ${flight||!p.nextCursor?'disabled':''}>下一頁</button></div><p class="exchange-history-note">只顯示目前角色已完成的交易。每頁最多 30 筆；賣出手續費按整批總價 5% 無條件進位。</p></section>`;
    }
    function cancelRead() {sequence++;controller?.abort();controller=null;flight=null;}
    async function load(force=false) {
      if(!current())return;if(flight)return flight;const role=state.role,p=view();if(!force&&p.loaded)return;
      const seq=++sequence,read=new AbortController();controller=read;error='';
      const params={characterId:actor,role,...(p.pages[p.page]?{cursor:p.pages[p.page]}:{})};
      flight=(async()=>{try {
        const response=await Promise.resolve().then(()=>current()&&seq===sequence?host.api('exchange/history',params,{signal:read.signal}):null);
        if(!current()||seq!==sequence||state.role!==role)return;
        if(String(response.characterId)!==actor)throw Object.assign(new Error('角色已切換，請重新讀取成交紀錄。'),{status:409});
        p.items=Array.isArray(response.items)?response.items:[];p.nextCursor=response.nextCursor||null;p.loaded=true;
      }catch(caught){if(current()&&seq===sequence&&caught.code!=='request_cancelled'&&caught.name!=='AbortError')error=caught.status>=400&&caught.status<500?caught.message:'暫時無法讀取成交紀錄，請稍後重新更新。';}
      finally{if(seq===sequence){flight=null;controller=null;paint();}}})();paint();return flight;
    }
    function refresh(force=false) {if(force){if(flight)return flight;const p=view();p.pages=[null];p.page=0;p.nextCursor=null;p.loaded=false;}return load(force);}
    root.onclick=event=>{const button=event.target.closest('button');if(!button||button.disabled||!current()||flight)return;
      if(button.hasAttribute('data-history-role')){const role=button.dataset.historyRole;if(!roles.some(([key])=>key===role))return;cancelRead();state.role=role;error='';paint();void load();}
      else if(button.hasAttribute('data-history-next')||button.hasAttribute('data-history-prev')){const p=view(),next=button.hasAttribute('data-history-next');if(next&&!p.nextCursor||!next&&p.page===0)return;if(next)p.pages[p.page+1]=p.nextCursor;p.page+=next?1:-1;void load(true);}
      else if(button.hasAttribute('data-history-refresh'))void refresh(true);
      else if(button.hasAttribute('data-history-detail')){const record=view().items.find(item=>item.id===button.dataset.historyDetail);if(record)host.showDetail(details(record));}
    };
    paint();
    return {refresh,cleanup(){disposed=true;cancelRead();root.onclick=null;},state};
  }
  window.RpgMarketExchangeHistory={mount};
})();
