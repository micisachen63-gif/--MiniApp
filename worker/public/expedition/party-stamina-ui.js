const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function staminaWait(at,now){
 if(!Number.isFinite(at))return '等待體力恢復';
 const minutes=Math.ceil(Math.max(0,at-now)/60000);
 if(!minutes)return '正在同步恢復狀態…';
 const hours=Math.floor(minutes/60),rest=minutes%60;
 return `約 ${hours?hours+' 小時'+(rest?' '+rest+' 分鐘':''):minutes+' 分鐘'}恢復至出發所需`;
}
const wait=(s,now)=>`<span data-party-stamina-at="${Number.isFinite(s.readyAt)?s.readyAt:''}">${staminaWait(s.readyAt,now)}</span>`;
export function memberStaminaMarkup(member){
 const s=member.stamina;if(!s||member.left)return '';
 return `<small class="party-member-stamina ${s.ready?'':'is-low'}">體力 ${esc(s.points)}／${esc(s.max)}${s.ready?'':` · 出發需 ${esc(s.cost)}`}</small>`;
}
export function partyStaminaMarkup(p,now){
 if(!p.stamina)return '';
 const members=(p.members||[]).filter(m=>!m.left),low=members.filter(m=>m.stamina?!m.stamina.ready:m.staminaReady===false),cost=p.stamina.cost;
 if(p.status==='combat')return `<div class="party-stamina-notice"><b>本場體力已扣除</b><span>下次出發每人需 ${esc(cost)} 點體力</span></div>`;
 const blocked=!p.stamina.ready;
 const title=blocked?(p.status==='lobby'?'暫時無法出發 · 隊員體力不足':'暫時無法再戰 · 隊員體力不足'):`全員體力足夠 · 出發每人 ${esc(cost)} 點`;
 const list=blocked?`<ul>${low.map(m=>{const s=m.stamina;return `<li><b>${esc(m.name)}</b>${s?`<span>體力 ${esc(s.points)}／${esc(s.max)} · 還差 ${Math.max(0,s.cost-s.points)} 點</span>${wait(s,now)}`:'<span>體力不足，請更新進度查看</span>'}</li>`;}).join('')}</ul>`:'';
 const late=p.status==='lobby'&&Number.isFinite(p.deadline)&&low.some(m=>Number.isFinite(m.stamina?.readyAt)&&m.stamina.readyAt>p.deadline);
 return `<div class="party-stamina-notice ${blocked?'is-blocked':''}" role="status"><b>${title}</b>${list}${blocked?`<p>已準備仍需每人有 ${esc(cost)} 點體力；每小時恢復 ${esc(members.find(m=>m.stamina)?.stamina.perHour??p.stamina.me?.perHour??10)} 點。</p>`:''}${late?'<p>體力會晚於本隊招募期限恢復，請恢復後再組隊。</p>':''}</div>`;
}
export function updateStaminaWait(root,now){
 root.querySelectorAll('[data-party-stamina-at]').forEach(el=>{const raw=el.dataset.partyStaminaAt;el.textContent=staminaWait(raw===''?null:Number(raw),now);});
}
