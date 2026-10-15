const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const roleNames={guard:'守護',breach:'破陣',aid:'支援',control:'壓制'};
export function rolePills(roles,progress={}){return roles.map(r=>`<span class="role-chip role-${r} ${progress[r]?'is-done':''}">${progress[r]?'✓ ':''}${roleNames[r]||esc(r)}</span>`).join('');}
export function cooperationPanel(p){
 if(!p.briefing)return '';
 const c=p.cooperation,names=new Map(p.members.map(m=>[m.id,m.name]));
 return `<section class="cooperation-panel" aria-label="職責與首領機制"><div class="cooperation-heading"><span class="kicker">PARTY TACTICS · 職責共鳴</span><b>${c?`${c.cleared}／${c.total} 已破解`:'三人分工'}</b></div>${c?`<h3>${esc(c.name)}</h3><div class="role-chips">${rolePills(c.roles,c.progress)}</div><p>${c.failed?'機制失守，請調整職責後重新挑戰。':c.complete?'首領護甲已解除，全力進攻！':c.next?`把握輸出窗口，第 ${c.next.round} 回合：${esc(c.next.name)}（${c.next.roles.map(r=>roleNames[r]).join('／')}）`:`三回合內由不同隊員處理；本階段尚餘 ${c.roundsLeft} 回合。`}</p>`:''}<details ${p.status==='lobby'?'open':''}><summary>配隊與機制指南${p.status==='lobby'&&p.members.length===3?` · ${p.briefing.ready?'分工齊備':'分工不足'}`:''}</summary><p>${esc(p.briefing.guide)}</p>${p.briefing.phases.map((v,i)=>`<div class="phase-row"><b>${i+1}. ${esc(v.name)}</b><div class="role-chips">${rolePills(v.roles)}</div><small>${v.assignment?v.roles.map(r=>`${roleNames[r]}：${esc(names.get(v.assignment[r])||'隊友')}`).join(' · '):'需由不同隊員分擔以上職責'}</small></div>`).join('')}<p>組隊戰技：Lv.90 且完成二轉後自動開放；每招消耗最大 MP 的 10%，冷卻三回合。職業分支決定可用戰技。</p></details></section>`;
}
export function dungeonRoles(d){return d.cooperation?`<div class="dungeon-role-note"><b>職責挑戰</b>${d.cooperation.phases.map(p=>`<small>${esc(p.name)} · ${p.roles.map(r=>roleNames[r]).join('／')}</small>`).join('')}</div>`:'';}
export function roleActions(p){
 const a=p.me?.actor;if(!a||!p.me.roleSkills?.length)return '';
 return `<h3>職責戰技</h3><p class="muted">未選招時自動分工；手動覆蓋會影響本回合機制。每道機制每人只能完成一項職責。</p><div class="role-actions">${p.me.roleSkills.map(s=>{const cd=Math.max(0,(a.roleCooldowns?.[s.id]||0)-p.round);return `<div class="role-action"><div><h3>${esc(s.name)} ${rolePills([s.role])}</h3><p>${esc(s.description)}</p><small>MP ${s.mp} · 冷卻 ${s.cooldownRounds} 回合</small></div><button class="primary" data-submit="${s.id}" ${a.mp<s.mp||cd?'disabled':''}>${cd?`冷卻 ${cd} 回合`:'選擇施放'}</button></div>`}).join('')}</div><h3>已裝備技能</h3>`;
}
