(() => {
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const art='/art/expedition-away-20261020/';
 function activity(me){return me?.activity||(me?.character?.partyId?{kind:me.character.partyId.startsWith('ring:')?'star-ring':'party',id:me.character.partyId}:null);}
 function markup(me){const a=activity(me);if(!a)return '';const ring=a.kind==='star-ring';return `<section class="expedition-away" data-away-key="${esc(me.character.tgId+':'+a.id)}" aria-label="${ring?'星環遠征中':'組隊冒險中'}"><video muted playsinline loop preload="metadata" poster="${art}poster.webp" aria-hidden="true"><source src="${art}loop.mp4" type="video/mp4"></video><div class="away-shade"></div><div class="away-heading"><span>THE JOURNEY CONTINUES</span><h2>${ring?'星環遠征中':'組隊冒險中'}</h2><p>${ring?'五人同行，旅途仍在星光下前進。':'你的角色正在與夥伴並肩作戰。'}</p></div><div class="away-bottom"><p>一般掛機暫停 · 戰果由隊伍獨立結算</p>${ring&&a.endsAt?`<p data-away-ends="${Number(a.endsAt)}">遠征持續進行中</p>`:''}<button class="btn gold" data-away-open="${ring?'star-ring':'lobby'}">${ring?'查看遠征戰況':'查看組隊戰況'} <span aria-hidden="true">↗</span></button>${ring?'<small>仍可參加打寶、爬塔；遠征結束後自動恢復掛機畫面。</small>':''}</div></section>`;}
 function mount(root,now=()=>Date.now()){
  const section=root.querySelector('.expedition-away');if(!section)return ()=>{};
  const video=section.querySelector('video'),reduced=matchMedia('(prefers-reduced-motion: reduce)');let disposed=false;
  const sync=()=>{if(disposed)return;if(document.hidden||reduced.matches||!section.isConnected)video.pause();else video.play().catch(()=>{});const e=section.querySelector('[data-away-ends]');if(e){const ms=Math.max(0,Number(e.dataset.awayEnds)-now()),mins=Math.ceil(ms/60000);e.textContent=ms?`預計還有 ${Math.floor(mins/60)} 小時 ${mins%60} 分鐘`:'行程已到終點，等待結算確認';}};
  section.querySelector('[data-away-open]').onclick=e=>window.RpgExpeditionOpen?.(e.currentTarget.dataset.awayOpen);
  document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);video.addEventListener('error',()=>video.classList.add('away-failed'),{once:true});sync();const timer=setInterval(sync,30000);
  return ()=>{disposed=true;clearInterval(timer);video.pause();document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);};
 }
 window.RpgExpeditionAway={activity,markup,mount};
})();
