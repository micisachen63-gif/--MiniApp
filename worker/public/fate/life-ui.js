import {ORBITS} from './model.js';
import {scenesFor} from './cycles.js';
import {advanceLife,lifeAge,lifeGrowth,activeBetween,LIFE_MS,addActive,CHOICE_MS} from './life.js';
import {narrativeEvents} from './event-catalog-v1.js';
import {formalEvents} from './formal-events.js';
import {almanac,worldYear} from './world.js';
import {decisionProfile} from './decision-engine-v7.js';
const players=new Map();
const ageLabel=age=>age>0&&age<1?`${Math.max(1,Math.round(age*12))} 月`:`${Math.floor(age)} 歲`;
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function btn(text,fn,cls='fate-quiet'){const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;}
const clock=at=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
export function renderLifeUI(p,o){
 const d=o.draft,v=advanceLife(d,d.clockAt),scenes=scenesFor(d),g=lifeGrowth(d);p.dataset.lifeUi='';
 p.append(el('span','fate-eyebrow',`第 ${o.soulCount+1} 世 · ${d.version===7?(decisionProfile(d.seed,d.orbit).gender==='f'?'女性 · ':'男性 · '):''}${ORBITS[d.orbit][0]}`));
 const age=el('div','fate-live-age');age.append(el('span','fate-live-years',String(lifeAge(d,d.clockAt))),el('small','','歲'));p.append(age,el('p','fate-life-mind',g.label));
 const progress=el('div','fate-life-progress');progress.append(el('span'));p.append(progress,el('p','fate-life-clock',''),el('p','fate-life-rule',`一世 2 小時 · 06:00–24:00 成長 · 今日 ${o.startedToday}／4 世`));
 if(o.preview){const controls=el('details','fate-demo-controls');controls.append(el('summary','','預覽時間控制 · 不影響正式機'));const row=el('div','fate-row');row.append(btn(o.running?'暫停預覽':'繼續預覽',o.onToggle),btn(v.available?'略過此抉擇':'跳至重要抉擇',()=>o.onClock(v.available?addActive(v.slots[v.index],CHOICE_MS):v.nextAt)),btn('預覽此生落款',()=>o.onClock(v.endAt)));controls.append(row,el('p','fate-note','示意時鐘加速 ×60；重要抉擇時 ×6，約有 15 秒可選。正式一世仍是 2 小時。'));p.append(controls);}
 if(v.available){const scene=scenes[v.index],question=el('section','fate-live-question');question.dataset.choiceIndex=String(v.index);question.append(el('small','fate-eyebrow',`${scene.age} 歲 · 一個選擇正等著你`),el('h2','',scene.title),el('p','',scene.text));
  for(let a=0;a<2;a++){const b=btn('',()=>o.onChoice(a,v.index),'fate-option');const copy=el('span');copy.append(el('strong','',scene.choices[a][0]),el('small','',scene.choices[a][1]));b.append(el('span','fate-num',a?'Ⅱ':'Ⅰ'),copy);question.append(b)}question.append(el('p','fate-choice-left',''));question.append(el('p','fate-note','沒有回應也會繼續，由系統代選並留下「命運代選」記憶。'));p.append(question);
 }
 if(!v.available&&d.answers.length){const i=d.answers.length-1,record=el('section','fate-last-choice');record.append(el('small','fate-eyebrow',`${scenes[i].age} 歲 · 最近的抉擇`),el('p','',d.sources[i]==='auto'?'這封來信的 90 秒回應時間已過，命運已替你續寫；這一世仍在繼續。':'你已親自回應這一段人生。'),el('p','fate-recent-outcome',scenes[i].choices[d.answers[i]][2]));p.append(record);}
 const toolbar=el('div','fate-life-toolbar');toolbar.append(el('span','fate-feed-label','此世紀事'),btn('今日旅箋',o.onDaily),btn('靈魂旅誌',o.onArchive));p.append(toolbar);
 const world=el('details','fate-world fate-journal');world.append(el('summary','','星穹世界年鑑'),el('div','fate-world-data'));p.append(world);const stats=el('div','fate-life-stats');stats.setAttribute('aria-label','這位虛構角色的生活狀態');p.append(stats);
 const feed=el('div','fate-story-feed');feed.setAttribute('role','log');feed.setAttribute('aria-label','自動播放的此世紀事');feed.setAttribute('aria-live','polite');p.append(feed);
 const night=el('p','fate-night-note','☾ 星穹已入夜。時間暫停，06:00 再接續此世。');night.hidden=!v.night;p.append(night);

 if(o.preview){const tg=el('details','fate-journal');tg.append(el('summary','','TG 事件通知示意（未發送）'));const card=el('div','fate-tg-preview');card.append(el('small','','星穹旅誌 · 事件來信'),el('b','',`@帳號主人 · ${o.heroName||'你的角色'}`),el('p','',scenes[Math.min(v.index,scenes.length-1)]?.title||'此世的下一段來信'));const actions=el('div','fate-row');actions.append(btn('回應事件',()=>{if(o.preview&&!v.available)o.onClock(v.nextAt);else p.querySelector('.fate-live-question')?.scrollIntoView({block:'center',behavior:'smooth'})}),btn('進入遊戲',o.onClose));card.append(actions);tg.append(card,el('p','fate-note','此處為純本機通知示意，不會向群組發送訊息。正式通知由雲端排程。'));p.append(tg);}
 paintLifeUI(p,d,true);
}
export function paintLifeUI(p,d,force=false,authorityNow=d.clockAt){
 if(!p?.isConnected&&!force)return;
 const key=d.version+':'+d.seed+':'+d.startedAt,v=advanceLife(d,d.clockAt),scenes=scenesFor(d),events=d.version>=4?formalEvents(d,d.clockAt):narrativeEvents(d,d.clockAt),all=d.version===7?[...events]:events.filter(e=>e.kind!=='choice');
 if(d.version!==7)d.answers.forEach((a,i)=>all.push({id:'choice-'+i,age:scenes[i].age,text:(d.sources[i]==='auto'?'命運代選 · ':'親自選擇 · ')+scenes[i].choices[a][2]}));all.sort((a,b)=>a.age-b.age||a.id.localeCompare(b.id));
 const recent=p.querySelector('.fate-recent-outcome'),actual=events.find(e=>e.kind==='choice'&&e.choiceIndex===d.answers.length-1);if(d.version===7&&recent&&actual)recent.textContent=actual.text;
 let player=players.get(key);if(!player){player={cursor:d.version>=4?Math.max(0,all.length-6):0,lastAt:0};players.set(key,player);if(players.size>20)players.delete(players.keys().next().value);}
 if(Date.now()-player.lastAt>=2800&&player.cursor<all.length-1){player.cursor++;player.lastAt=Date.now();}
 const feed=p.querySelector('.fate-story-feed'),visible=all.slice(0,player.cursor+1),shown=new Set([...feed.children].map(e=>e.dataset.eventId));
 const nearBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<65;
 for(const e of visible){if(shown.has(e.id))continue;const row=el('article','fate-feed-line');row.dataset.eventId=e.id;const copy=el('div','fate-feed-copy');if(e.worldYear)copy.append(el('small','fate-feed-year',`星燈紀元 ${e.worldYear}`));copy.append(el('p','',e.text));row.append(el('b','',ageLabel(e.age)),copy);if(e.kind==='world')row.classList.add('fate-feed-world');feed.append(row);}
 if(nearBottom||force)feed.scrollTop=feed.scrollHeight;
 const annual=almanac(worldYear(d.seed,lifeAge(d,d.clockAt))),data=p.querySelector('.fate-world-data');if(data&&data.dataset.year!==String(annual.year)){data.dataset.year=annual.year;data.replaceChildren(el('h3','',`星燈紀元 ${annual.year} · ${annual.region}`),el('p','',annual.news.title+'。'+annual.news.detail),el('p','fate-note',`天氣：${annual.climate} ｜ 收成 ${annual.harvest} ｜ 物價指數 ${annual.prices} ｜ 海運 ${annual.shipping}`),el('p','fate-note','架空遊戲世界資料；僅影響這一世的故事。'));}const stats=p.querySelector('.fate-life-stats'),state=[...all].reverse().find(e=>e.state)?.state;if(stats&&state){const signature=JSON.stringify(state);if(stats.dataset.state!==signature){stats.dataset.state=signature;stats.replaceChildren(...[['energy','精力'],['knowledge','見識'],['wealth','家計'],['bonds','情誼'],['reputation','聲望']].map(([key,label])=>el('span','',`${label} ${state[key]}`)));}}
 p.querySelector('.fate-live-years').textContent=String(lifeAge(d,d.clockAt));p.querySelector('.fate-life-mind').textContent=lifeGrowth(d).label;
 p.querySelector('.fate-life-progress span').style.width=Math.min(100,activeBetween(d.startedAt,d.clockAt)/LIFE_MS*100)+'%';
 const left=Math.max(0,LIFE_MS-activeBetween(d.startedAt,d.clockAt)),mins=Math.ceil(left/60000);p.querySelector('.fate-life-clock').textContent=v.night?'夜間休息中 · 06:00 接續':`此世剩餘 ${mins} 分鐘 · 時鐘 ${clock(d.clockAt)}`;
 // The display clock can be held before an unconfirmed server choice. The real authority
 // clock still closes buttons immediately; its inferred answers never enter the story/save.
 const gate=advanceLife(d,authorityNow),question=p.querySelector('.fate-live-question'),countdown=p.querySelector('.fate-choice-left');
 if(question){const index=Number(question.dataset.choiceIndex),available=gate.available&&gate.index===index;
  for(const button of question.querySelectorAll('button')){button.disabled=!available;button.setAttribute('aria-disabled',String(!available));}
  if(countdown)countdown.textContent=gate.night?'夜間暫停回應 · 06:00 接續':available?`抉擇剩餘 ${Math.ceil(activeBetween(authorityNow,addActive(gate.slots[index],CHOICE_MS))/1000)} 秒`:'此頁回應已截止，正在確認雲端進度…';
 }
 const night=p.querySelector('.fate-night-note');if(night)night.hidden=!gate.night;
 if(gate.night)p.querySelector('.fate-life-clock').textContent='夜間休息中 · 06:00 接續';
 p.querySelector('.fate-feed-label').textContent=player.cursor<all.length-1?'回顧正在追上此世…':'此刻 · 靈魂正在生長';
}
