import {ORBITS} from './model.js';
import {scenesFor} from './cycles.js';
import {advanceLife,lifeAge,lifeGrowth,activeBetween,LIFE_MS,addActive,CHOICE_MS} from './life.js';
import {narrativeEvents} from './event-catalog-v1.js';
const players=new Map();
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function btn(text,fn,cls='fate-quiet'){const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;}
const clock=at=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
export function renderLifeUI(p,o){
 const d=o.draft,v=advanceLife(d,d.clockAt),scenes=scenesFor(d),g=lifeGrowth(d);p.dataset.lifeUi='';
 p.append(el('span','fate-eyebrow',`第 ${o.soulCount+1} 世 · ${ORBITS[d.orbit][0]}`));
 const age=el('div','fate-live-age');age.append(el('span','fate-live-years',String(lifeAge(d,d.clockAt))),el('small','','歲'));p.append(age,el('p','fate-life-mind',g.label));
 const progress=el('div','fate-life-progress');progress.append(el('span'));p.append(progress,el('p','fate-life-clock',''),el('p','fate-life-rule',`一世 2 小時 · 06:00–24:00 成長 · 今日 ${o.startedToday}／4 世`));
 if(o.preview){const controls=el('details','fate-demo-controls');controls.append(el('summary','','預覽時間控制 · 不影響正式機'));const row=el('div','fate-row');row.append(btn(o.running?'暫停預覽':'繼續預覽',o.onToggle),btn(v.available?'略過此抉擇':'跳至重要抉擇',()=>o.onClock(v.available?addActive(v.slots[v.index],CHOICE_MS):v.nextAt)),btn('預覽此生落款',()=>o.onClock(v.endAt)));controls.append(row,el('p','fate-note','示意時鐘加速 ×60；重要抉擇時 ×6，約有 15 秒可選。正式一世仍是 2 小時。'));p.append(controls);}
 const toolbar=el('div','fate-life-toolbar');toolbar.append(el('span','fate-feed-label','此世紀事'),btn('今日旅箋',o.onDaily),btn('靈魂旅誌',o.onArchive));p.append(toolbar);
 const feed=el('div','fate-story-feed');feed.setAttribute('role','log');feed.setAttribute('aria-label','自動播放的此世紀事');feed.setAttribute('aria-live','polite');p.append(feed);
 if(v.night)p.append(el('p','fate-night-note','☾ 星穹已入夜。時間暫停，06:00 再接續此世。'));
 if(v.available){const scene=scenes[v.index],question=el('section','fate-live-question');question.append(el('small','fate-eyebrow',`${scene.age} 歲 · 一個選擇正等著你`),el('h2','',scene.title),el('p','',scene.text));
  for(let a=0;a<2;a++){const b=btn('',()=>o.onChoice(a,v.index),'fate-option');const copy=el('span');copy.append(el('strong','',scene.choices[a][0]),el('small','',scene.choices[a][1]));b.append(el('span','fate-num',a?'Ⅱ':'Ⅰ'),copy);question.append(b)}question.append(el('p','fate-choice-left',''));question.append(el('p','fate-note','沒有回應也會繼續，由系統代選並留下「命運代選」記憶。'));p.append(question);
 }
 const tg=el('details','fate-journal');tg.append(el('summary','','TG 事件通知示意（未發送）'));const card=el('div','fate-tg-preview');card.append(el('small','','星穹旅誌 · 事件來信'),el('b','',`@帳號主人 · ${o.heroName||'你的角色'}`),el('p','',scenes[Math.min(v.index,2)].title));const actions=el('div','fate-row');actions.append(btn('回應事件',()=>{if(o.preview&&!v.available)o.onClock(v.nextAt);else p.querySelector('.fate-live-question')?.scrollIntoView({block:'center',behavior:'smooth'})}),btn('進入遊戲',o.onClose));card.append(actions);tg.append(card,el('p','fate-note','正式 BOT 排程尚未接入；此處只預覽提問、標記角色主人與進遊戲按鈕。'));p.append(tg);
 p.append(el('p','fate-note','事件、年齡與靈魂特質屬於這位虛構角色，不是對玩家現實人生的預測。預覽紀錄保存在本機，尚未同步正式角色。'));
 paintLifeUI(p,d,true);
}
export function paintLifeUI(p,d,force=false){
 if(!p?.isConnected&&!force)return;
 const key=d.seed+':'+d.startedAt,v=advanceLife(d,d.clockAt),scenes=scenesFor(d),all=narrativeEvents(d,d.clockAt);
 d.answers.forEach((a,i)=>all.push({id:'choice-'+i,age:scenes[i].age,text:(d.sources[i]==='auto'?'命運代選 · ':'親自選擇 · ')+scenes[i].choices[a][2]}));all.sort((a,b)=>a.age-b.age||a.id.localeCompare(b.id));
 let player=players.get(key);if(!player){player={cursor:0,lastAt:0};players.set(key,player);if(players.size>20)players.delete(players.keys().next().value);}
 if(Date.now()-player.lastAt>=2800&&player.cursor<all.length-1){player.cursor++;player.lastAt=Date.now();}
 const feed=p.querySelector('.fate-story-feed'),visible=all.slice(0,player.cursor+1),shown=new Set([...feed.children].map(e=>e.dataset.eventId));
 const nearBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<65;
 for(const e of visible){if(shown.has(e.id))continue;const row=el('article','fate-feed-line');row.dataset.eventId=e.id;row.append(el('b','',`${e.age} 歲`),el('p','',e.text));feed.append(row);}
 if(nearBottom||force)feed.scrollTop=feed.scrollHeight;
 p.querySelector('.fate-live-years').textContent=String(lifeAge(d,d.clockAt));p.querySelector('.fate-life-mind').textContent=lifeGrowth(d).label;
 p.querySelector('.fate-life-progress span').style.width=Math.min(100,activeBetween(d.startedAt,d.clockAt)/LIFE_MS*100)+'%';
 const left=Math.max(0,LIFE_MS-activeBetween(d.startedAt,d.clockAt)),mins=Math.ceil(left/60000);p.querySelector('.fate-life-clock').textContent=v.night?'夜間休息中 · 06:00 接續':`此世剩餘 ${mins} 分鐘 · 時鐘 ${clock(d.clockAt)}`;
 const countdown=p.querySelector('.fate-choice-left');if(countdown&&v.available)countdown.textContent=`抉擇剩餘 ${Math.ceil(activeBetween(d.clockAt,addActive(v.slots[v.index],CHOICE_MS))/1000)} 秒`;
 p.querySelector('.fate-feed-label').textContent=player.cursor<all.length-1?'回顧正在追上此世…':'此刻 · 靈魂正在生長';
}
