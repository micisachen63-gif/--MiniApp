import {ART,ZODIAC,ORBITS,validBirth,zodiacFor,encodeResult,decodeResult,newSeed,randomOrbit,publicUrl,telegramUrl,shareText} from './model.js';
import {scenesFor,readSoul,rememberSoul,soulMilestone,SOUL_ACHIEVEMENTS,seedForNextLife} from './cycles.js';
import {createLife,validLife,advanceLife,chooseLife,lifeAge,startStatus,taipeiDay} from './life.js';
import {renderLifeUI,paintLifeUI} from './life-ui.js';
import {narrativeEvents} from './event-catalog-v1.js';
const root=document.getElementById('fate'),qs=new URLSearchParams(location.search);
const storage={get:k=>{try{return localStorage.getItem(k)}catch{return null}},set:(k,v)=>{try{localStorage.setItem(k,v);return true}catch{return false}}};
const pathResult=/^\/fate\/r\/([^/]+)$/.exec(location.pathname)?.[1],queryResult=qs.get('result');
let shared=!!pathResult,result=decodeResult(pathResult||queryResult),mode='birthday',orbit=0,zodiac=null,showSign=true,answers=[],seed='',stage='intro',busy=false,media,previewUrl=null,cardFile=null;
const embedded=window.parent!==window;
const isPreview=['127.0.0.1','localhost','[::1]'].includes(location.hostname)&&qs.get('preview')==='1';
let previewCompleted=0,birthDetail=null;
let soul=embedded?{entries:[]}:readSoul(storage.get('star-fate-guest-soul')),heroName='',archivePage=1;
let currentLife=null,previewRunning=true;
const readStarts=()=>{try{const a=JSON.parse(storage.get('star-fate-preview-starts'));return Array.isArray(a)?a.filter(Number.isSafeInteger).slice(-32):[]}catch{return []}};
let startHistory=readStarts();
const lifeNow=()=>isPreview&&currentLife?currentLife.clockAt:Date.now();
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function button(text,fn,cls='fate-quiet'){const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;}
function note(text){return el('p','fate-note',text)}
function dispose(){media?.pause();media?.removeAttribute('src');media?.load();media=null;if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}cardFile=null;}
function setupMedia(bg){
 if(media){bg.append(media);if(!document.hidden)media.play().catch(()=>{});return;}
 if(matchMedia('(prefers-reduced-motion: reduce)').matches||navigator.connection?.saveData)return;
 media=el('video');media.muted=true;media.loop=true;media.playsInline=true;media.autoplay=true;media.preload='none';media.poster=ART+'journey.webp';bg.append(media);
 media.src=ART+'journey-loop.mp4';media.play().catch(()=>{});
}
function render(){
 const detailsOpen=[...root.querySelectorAll('details[open]>summary')].map(e=>e.textContent);if(media)media.remove();if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}cardFile=null;root.replaceChildren();const shell=el('div','fate-shell'+(stage==='scene'?' fate-story':'')+(result?' fate-result':''));
 if(result)shell.style.setProperty('--ending',result.ending.color);if(stage==='archive')shell.classList.add('fate-archive');if(stage==='life'||stage==='daily')shell.classList.add('fate-live');
 const bg=el('div','fate-media');bg.setAttribute('aria-hidden','true');shell.append(bg);setupMedia(bg);
 const top=el('header','fate-top');top.append(el('span','fate-brand','星穹旅誌 ✧'));
 top.append(button('靈魂旅誌',()=>{stage='archive';archivePage=1;render();window.scrollTo(0,0)}));
 top.append(button(embedded?'返回冒險':'關於旅章',()=>{if(embedded){window.parent.postMessage({type:'star-fate-close'},location.origin)}else{document.getElementById('fate-about')?.scrollIntoView({behavior:'smooth',block:'center'});}}));shell.append(top);
 if(isPreview){const strip=el('aside','fate-preview-strip');strip.append(el('b','','互動預覽 · 尚未發布'),el('span','','故事與圖卡可操作；命盤與任務判定尚未接入。'));shell.append(strip);}
 const mast=el('header','fate-masthead');mast.append(el('span','fate-eyebrow',stage==='archive'?'A SOUL THROUGH MANY LIVES':result?'A LIFE WRITTEN IN STARLIGHT':'THE LAST STAR LANTERN'),el('h1','',stage==='archive'?'靈魂旅誌':stage==='daily'?'今日旅箋':stage==='result'&&result?'命運，因你而不同':'命運旅章'),el('p','',stage==='archive'?'一位英雄，承載了許多沒有被遺忘的人生。':result?'這一生已落款，靈魂還記得。':stage==='life'?'時間會向前，而你決定如何被記得。':'每一次啟程，都讓靈魂多一段記憶。'));shell.append(mast);
 const sky=el('div','fate-sky');if(stage==='intro'){const ring=el('div','fate-orbit-ring');ring.setAttribute('aria-hidden','true');sky.append(ring)}shell.append(sky);
 const panel=el('section','fate-panel');panel.setAttribute('aria-label',stage==='archive'?'靈魂旅誌':result?'旅章結果':stage==='life'?'此世紀事':stage==='daily'?'今日旅箋':'啟程設定');shell.append(panel);
 if(stage==='archive')renderArchive(panel);else if(stage==='life')renderLife(panel);else if(stage==='daily'){renderDaily(panel);panel.append(button(currentLife?'回到正在展開的這一世':'回到旅章',()=>{stage=currentLife?'life':result?'result':'intro';render();window.scrollTo(0,0)}));}else if(result)renderResult(panel);else if(stage==='scene')renderScene(panel);else renderIntro(panel);
 const footer=el('footer','fate-footer');footer.id='fate-about';footer.append(el('div','','原創奇幻短篇 · 僅供遊戲趣味與生活靈感'),el('div','','不預測現實命運，不影響遊戲戰力與掉落'),el('div','','Game Producer · ミカサ'));shell.append(footer);for(const d of shell.querySelectorAll('details'))if(detailsOpen.includes(d.querySelector('summary')?.textContent))d.open=true;root.append(shell);
}
function renderIntro(p){
 p.append(el('span','fate-eyebrow','第一期 · 最後一盞星燈'),el('h2','','如果人生能重新啟程，\n你會把光留給誰？'));
 const modes=el('div','fate-mode');for(const [key,label] of [['birthday','以生日啟程'],['random','交給命運']]){const b=button(label,()=>{mode=key;render()},'fate-option');b.setAttribute('aria-pressed',String(mode===key));modes.append(b)}p.append(modes);
 let dateInput,signInput,timeInput,placeInput;
 if(mode==='birthday'){
  const label=el('label','fate-field','出生年月日');label.htmlFor='fate-birth';dateInput=el('input','fate-date');dateInput.id='fate-birth';dateInput.type='date';dateInput.min='1900-01-01';const t=new Date();dateInput.max=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;dateInput.required=true;
  p.append(label,dateInput,note('生日只用於這次起點與星座標示，在你的裝置處理，不上傳、不儲存完整生日。可使用虛構生日。'));
  const detail=el('details','fate-birth-detail'),summary=el('summary','','補上出生時間與地點（選填）');detail.append(summary);
  const timeLabel=el('label','fate-field','出生時間（當地鐘錶時間）');timeInput=el('input','fate-date');timeInput.type='time';timeInput.id='fate-birth-time';timeLabel.htmlFor=timeInput.id;
  const placeLabel=el('label','fate-field','出生城市／國家');placeInput=el('input','fate-date');placeInput.type='text';placeInput.maxLength=60;placeInput.placeholder='例如：台灣・台北';placeInput.autocomplete='off';placeInput.id='fate-birth-place';placeLabel.htmlFor=placeInput.id;
  detail.append(timeLabel,timeInput,placeLabel,placeInput,note('不清楚可以留白，不會猜測出生時間。本預覽僅呈現資料填寫方式；完整命盤、歷史時區與每日計算尚未接入。這些欄位不會出現在分享圖。'));p.append(detail);
  const check=el('label','fate-check');signInput=el('input');signInput.type='checkbox';signInput.checked=showSign;signInput.onchange=()=>{showSign=signInput.checked};check.append(signInput,el('span','','分享時顯示星座（可以隨時關閉）'));p.append(check);
 }
 const error=el('div','fate-error');error.setAttribute('role','alert');p.append(error);
 p.append(button('展開我的旅章',()=>{
  const birth=mode==='birthday'?validBirth(dateInput.value):null;
  if(mode==='birthday'&&!birth){error.textContent='請選擇有效的出生日期，生日不能晚於今天。';dateInput.focus();return;}
  birthDetail=birth?{date:dateInput.value,time:timeInput.value,place:placeInput.value.trim()}:null;
  zodiac=birth?zodiacFor(birth.month,birth.day):null;startCycle();
 },'fate-primary'));
 const saved=decodeResult(storage.get('star-fate-last'));
 if(saved)p.append(button('翻閱上次旅章',()=>{result=saved;shared=false;render()},'fate-subtle'));
 if(soul.draft)p.append(button('繼續正在展開的這一世',()=>resumeLife(),'fate-quiet'));
 p.append(note('一世 2 小時 · 每天最多 4 世 · 06:00–24:00 成長，凌晨暫停。未回應會由命運代選；落款後需親自開啟下一世。預覽使用加速時鐘。'));
}
function renderResult(p){
 p.append(el('span','fate-eyebrow',shared?'一位旅人的故事':'你的命運旅章'),el('h2','fate-result-title',result.ending.title));
 const badges=el('div','fate-identity');badges.append(el('span','',result.identity[0]));if(result.zodiac!==null)badges.append(el('span','',ZODIAC[result.zodiac]+'座'));p.append(badges,el('p','fate-quote',`「${result.ending.quote}」`),el('p','',result.ending.body));
 const journal=el('details','fate-journal'),summary=el('summary','','翻閱這一生的選擇'),list=el('ol'),lifeScenes=scenesFor(result);const savedLife=soul.entries.find(e=>e.code===result.code);for(const m of savedLife?.memories||[])list.append(el('li','',`${m.age} 歲 · ${m.text}`));list.append(el('li','',result.identity[2]));appendMemories(list,result,savedLife?.memories);journal.append(summary,list);p.append(journal);
 p.append(el('p','fate-quote',result.ending.question));
 const extras=el('div','fate-row');extras.append(button('今日旅箋',()=>{stage='daily';render();window.scrollTo(0,0)}),button('靈魂旅誌',()=>{stage='archive';render();window.scrollTo(0,0)}));p.append(extras);
 const check=el('label','fate-check'),cb=el('input');cb.type='checkbox';cb.checked=result.zodiac!==null;cb.disabled=result.zodiac===null;cb.onchange=()=>{showSign=cb.checked;clearPreview();};check.append(cb,el('span','','分享圖片與連結顯示星座'));p.append(check);showSign=cb.checked;
 const selectLabel=el('label','fate-field','分享圖尺寸');selectLabel.htmlFor='fate-format';const format=el('select','fate-format');format.id='fate-format';for(const [v,t] of [['post','IG／Threads · 1080 × 1350'],['story','限時動態 · 1080 × 1920']]){const o=el('option','',t);o.value=v;format.append(o)}format.onchange=clearPreview;p.append(selectLabel,format);
 const preview=el('div');preview.id='fate-preview';p.append(preview);const status=el('p','fate-status');status.id='fate-status';status.setAttribute('role','status');p.append(status);
 p.append(button('製作我的旅人名帖',()=>makeCard(format.value,cb.checked),'fate-primary'));
 const actions=el('div','fate-row');actions.append(button('分享圖卡',shareCard),button('儲存圖片',saveCard),button('複製分享連結',async()=>{
  const r=shareResult(cb.checked),text=shareText(r,cb.checked)+'\n'+publicUrl(r.code,location.origin);
  try{await navigator.clipboard.writeText(text);status.textContent='旅章與連結已複製，貼到 Threads 或傳給朋友吧。'}catch{const box=el('textarea','fate-date');box.readOnly=true;box.value=text;preview.replaceChildren(box);box.select();status.textContent='請長按文字複製。'}
 }));p.append(actions);
 if(shared){p.append(button('走出自己的旅章',()=>reset(),'fate-primary'));}
 else if(embedded){p.append(button('將旅章收進目前角色',()=>{window.parent.postMessage({type:'star-fate-keep',code:result.code},location.origin)},'fate-primary'));p.append(note('旅章記錄在目前裝置、目前角色的旅誌；分享連結可永久保留這個版本的故事。'));}
 else{const link=el('a','fate-primary',isPreview?'預覽創角銜接':'前往 TG，讓冒險繼續');link.href=isPreview?'/?fixture=444&preview=1&fate='+encodeURIComponent(result.code):telegramUrl(result.code);link.rel='noopener';p.append(link,note(isPreview?'正式版將前往專屬 TG BOT；此預覽以隔離帳號示範創角，不會修改正式玩家。':'加入遊戲專屬群組，再從 BOT 開啟遊戲創角。旅章只記錄故事，不提供戰力獎勵。'));}
 renderSoul(p);
 p.append(el('div','fate-life-divider','此生已落款 · 靈魂仍在旅途'),button('開啟下一趟輪迴',()=>startCycle(),'fate-primary'),el('p','fate-cycle-copy','換一個出身，遇見不同的人。\n每一世的選擇，都會成為這位英雄的靈魂記憶。'),button('重新設定起點',()=>reset(),'fate-subtle'));
 function clearPreview(){if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;cardFile=null;preview.replaceChildren();status.textContent='';}
}
function reset(){result=null;shared=false;answers=[];birthDetail=null;stage='intro';history.replaceState(null,'','/fate/'+(isPreview?'?preview=1':''));render();window.scrollTo(0,0)}
function startCycle(){
 if(soul.draft){resumeLife();return;}
 let now=Date.now();if(isPreview&&!startStatus([],now).allowed)now=Date.parse(taipeiDay(now)+'T10:00:00+08:00');
 const status=startStatus(startHistory,now);if(!status.allowed){const target=document.querySelector('.fate-error')||document.querySelector('.fate-panel');const m=note(status.night?'星穹已入夜，06:00 再開啟下一世。':'今日四段人生已寫滿，明天再開啟新的旅程。');m.setAttribute('role','status');target.append(m);return;}
 const previous=result||decodeResult(soul.entries.at(-1)?.code);let next=randomOrbit(zodiac);
 if(previous&&next===previous.orbit)next=(next+1+parseInt(newSeed().slice(0,2),16)%11)%12;
 orbit=next;seed=seedForNextLife(newSeed(),soul.entries);
 currentLife=createLife({orbit,zodiac:showSign?zodiac:null,seed,startedAt:now});currentLife.recentEventIds=soul.entries.slice(-3).flatMap(e=>(e.memories||[]).map(m=>m.id));startHistory.push(now);storage.set('star-fate-preview-starts',JSON.stringify(startHistory.slice(-32)));previewRunning=true;soul.draft=currentLife;persistLife();result=null;shared=false;answers=[];stage='life';render();window.scrollTo(0,0);
}
function persistLife(){if(currentLife)soul.draft=currentLife;if(embedded)window.parent.postMessage({type:'star-fate-draft',draft:currentLife},location.origin);else storage.set('star-fate-guest-soul',JSON.stringify(soul));}
function resumeLife(){currentLife=validLife(soul.draft);if(!currentLife)return;result=null;shared=false;stage='life';tickLife(isPreview?currentLife.clockAt:Date.now());window.scrollTo(0,0);}
function tickLife(at,repaint=true){
 if(!currentLife)return;const before=advanceLife(currentLife,currentLife.clockAt),v=advanceLife(currentLife,Math.max(currentLife.clockAt,Math.trunc(at)));const structural=before.available!==v.available||before.index!==v.index||before.night!==v.night||v.completed;currentLife=v.draft;soul.draft=currentLife;
 if(v.completed){previewRunning=false;result=decodeResult(v.code);const memories=narrativeEvents(currentLife,currentLife.clockAt);soul=rememberSoul(soul,v.code,Date.now(),memories);delete soul.draft;currentLife=null;shared=false;stage='result';storage.set('star-fate-last',v.code);if(embedded)window.parent.postMessage({type:'star-fate-cycle-complete',code:v.code,memories},location.origin);else storage.set('star-fate-guest-soul',JSON.stringify(soul));}
 else persistLife();if(repaint||structural){render();if(v.available&&!before.available&&stage==='life')requestAnimationFrame(()=>document.querySelector('.fate-live-question')?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));}else if(stage==='life')paintLifeUI(document.querySelector('[data-life-ui]'),currentLife);
}
const clockLabel=at=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
function renderLife(p){
 if(!currentLife)return;const status=startStatus(startHistory,currentLife.startedAt);
 renderLifeUI(p,{draft:currentLife,soulCount:soul.entries.length,startedToday:status.used,preview:isPreview,running:previewRunning,heroName,
 onToggle:()=>{previewRunning=!previewRunning;render()},onClock:at=>tickLife(at),
 onChoice:(answer,index)=>{try{currentLife=chooseLife(currentLife,answer,lifeNow(),index).draft;persistLife();render()}catch{tickLife(lifeNow())}},
 onDaily:()=>{stage='daily';render();window.scrollTo(0,0)},onArchive:()=>{stage='archive';render();window.scrollTo(0,0)},onClose:()=>{if(embedded)window.parent.postMessage({type:'star-fate-close'},location.origin)}});
}
function appendMemories(list,r,memories=[]){
 const rows=[...memories.filter(m=>m.age!==0)],scenes=scenesFor(r);
 r.answers.forEach((a,i)=>rows.push({age:scenes[i].age||18+i*24,text:`${r.auto?.[i]?'命運代選 · ':'親自選擇 · '}${scenes[i].choices[a][2]}`}));
 rows.sort((a,b)=>a.age-b.age);for(const m of rows)list.append(el('li','',`${m.age} 歲 · ${m.text}`));
}
function renderSoul(p){
 const m=soulMilestone(soul),box=el('section','fate-soul');box.append(el('span','fate-eyebrow',embedded?'THIS HERO REMEMBERS':'MEMORIES OF A TRAVELER'),el('div','fate-soul-title',embedded&&heroName?`${heroName} · 靈魂承載`:'靈魂承載'));const count=el('div','fate-soul-count',String(m.count));count.append(el('small','','世記憶'));box.append(count,el('div','fate-soul-title',m.current?.title||'等待第一世的落款'));
 const bar=el('div','fate-soul-progress'),fill=el('span');fill.style.width=m.next?`${Math.min(100,m.count/m.next.at*100)}%`:'100%';bar.append(fill);box.append(bar,note(m.next?`再完成 ${m.next.at-m.count} 世，解鎖「${m.next.title}」。`:'百世相逢，已解鎖全部紀念稱號。'));if(stage!=='archive')box.append(button('翻閱靈魂旅誌',()=>{stage='archive';archivePage=1;render();window.scrollTo(0,0)}));box.append(note(embedded?'本預覽按目前角色保存在裝置，尚未同步正式角色成就。':'目前是此裝置的旅人紀錄；角色綁定與雲端成就仍待正式接入。'));p.append(box);
}
function renderArchive(p){
 const m=soulMilestone(soul);p.append(el('span','fate-eyebrow','MEMORIES NEVER FADE'),el('h2','',heroName?`${heroName}的靈魂旅誌`:'靈魂走過的路'),el('p','',`已承載 ${m.count} 世記憶。每一段出身、選擇與告別，都是這位英雄的一部分。`));renderSoul(p);
 const badges=el('details','fate-journal');badges.append(el('summary','','輪迴紀念成就'));const list=el('ul');for(const a of SOUL_ACHIEVEMENTS)list.append(el('li','',`${m.count>=a.at?'✧':'○'} ${a.title} · 完成 ${a.at} 世`));badges.append(list);p.append(badges);
 const entries=soul.entries.map((e,i)=>({...e,number:i+1})).reverse().slice(0,archivePage*10);
 if(soul.draft){const live=soul.draft,scenes=scenesFor(live),card=el('article','fate-memory-card');card.append(el('small','',`第 ${soul.entries.length+1} 世 · 正在展開`),el('h3','',`${lifeAge(live,live.clockAt)} 歲 · ${ORBITS[live.orbit][0]}`));const steps=el('ol');live.answers.forEach((a,i)=>steps.append(el('li','',`${scenes[i].age} 歲 · ${live.sources[i]==='auto'?'命運代選':'親自選擇'} · ${scenes[i].choices[a][2]}`)));card.append(steps,button('回到正在展開的這一世',()=>resumeLife()));p.append(card);}
 if(!entries.length)p.append(el('p','fate-archive-empty','旅誌還是空白的。\n完整走過一生，第一段記憶就會留在這裡。'));
 for(const e of entries){
  const r=decodeResult(e.code),card=el('article','fate-memory-card');card.append(el('small','',`第 ${e.number} 世 · ${r.identity[0]}`),el('h3','',r.ending.title),el('p','',r.identity[2]));
  const timeline=el('details','fate-journal');timeline.append(el('summary','','展開此生的過程與記憶'));const steps=el('ol');appendMemories(steps,r,e.memories);steps.append(el('li','',`此生落款 · ${r.ending.body}`));timeline.append(steps);card.append(timeline,el('p','',`「${r.ending.quote}」`),button('翻閱這一世',()=>{result=r;shared=false;stage='result';render();window.scrollTo(0,0)}));p.append(card);
 }
 if(entries.length<soul.entries.length)p.append(button('再往前翻十世',()=>{archivePage++;render()},'fate-quiet'));
 p.append(button(result?'回到此生落款':'開始下一趟輪迴',()=>{if(result){stage='result';render();window.scrollTo(0,0)}else startCycle()},'fate-primary'));
}
function renderDaily(p){
 const daily={day:taipeiDay(Date.now())},box=el('section','fate-daily');box.append(el('span','fate-eyebrow','LET THE STARS WRITE BACK'),el('h3','',`今日旅箋 · ${daily.day}`));
 box.append(el('p','fate-daily-intro','每完成一項同行任務，星穹便為你揭開一則今日提醒。'));
 if(isPreview){
  const controls=el('div','fate-demo-controls');controls.setAttribute('aria-label','預覽任務完成狀態');controls.append(el('small','','切換示意狀態'));const row=el('div','fate-demo-options');
  for(let n=0;n<=3;n++){const b=button(n?`完成 ${n} 項`:'尚未完成',()=>{previewCompleted=n;const y=window.scrollY;render();window.scrollTo(0,y);},'fate-quiet');b.setAttribute('aria-pressed',String(previewCompleted===n));row.append(b)}controls.append(row);box.append(controls,note('以下為版面與語氣示意，不是根據你的命盤算出的結果。正式版將由伺服器驗證任務，不提供玩家自行切換的控制。'));
 }
 const topics=[
  {key:'health',name:'健康',tag:'CARE FOR YOURSELF',lead:'先安放自己，再照亮別人。',title:'把腦中的待辦，放到紙上',scene:'如果你躺下後還在回放同一段對話，今晚先別逼自己把它想通。',action:'睡前寫下明天最先處理的一件事，再把手機放到伸手拿不到的位置。只留這一件，其餘明天再安排。',reason:'把未完成的事暫時交給紙筆，能幫你替今天畫出界線。這是一個自我照顧的練習，不是健康判斷。'},
  {key:'work',name:'工作',tag:'CHOOSE YOUR NEXT STEP',lead:'把力氣，留給真正需要的一步。',title:'別再替模糊的要求，重做第三次',scene:'如果同一份東西已經改了幾次，對方卻只說「再看看」，今天先把期待問清楚。',action:'把方案縮成 A、B 兩個版本，直接問：「這次最優先的是速度，還是完整度？」得到答案後再動手。',reason:'先確認取捨，比再多做一版更容易減少來回，也讓你的投入有清楚的方向。'},
  {key:'love',name:'感情',tag:'MAKE ROOM FOR CLOSENESS',lead:'不必讓在乎，藏在猜測裡。',title:'想說「沒事」之前，留一句真話',scene:'如果你準備回「沒事」，心裡卻一直等對方再問一次，可以試著少留一點讓人猜的空白。',action:'挑一件具體的小事，說：「剛才那句話讓我有點失落，我想知道你原本的意思。」先談那件事，不一次翻出所有舊帳。',reason:'說清楚發生了什麼與自己的感受，通常比試探能給彼此更多回應的空間。'},
 ];
 const trail=el('div','fate-unlock-trail');trail.setAttribute('aria-label','提醒固定解鎖順序：健康、工作、感情');for(let i=0;i<3;i++){trail.append(el('span',previewCompleted>i&&isPreview?'lit':'',`${i+1} ${topics[i].name}`));}box.append(trail);
 for(let i=0;i<topics.length;i++){
  const t=topics[i],unlocked=isPreview&&previewCompleted>i,card=el('article',`fate-note-card fate-note-${t.key}${unlocked?' revealed':' locked'}`);card.setAttribute('aria-label',`${t.name}提醒${unlocked?'已解鎖':'尚未解鎖'}`);
  const head=el('header','fate-note-head'),seal=el('span','fate-note-seal',unlocked?'✧':String(i+1)),copy=el('div');copy.append(el('small','',t.tag),el('h4','',t.name));head.append(seal,copy,el('span','fate-note-state',unlocked?'已解鎖':'待啟封'));card.append(head);
  if(unlocked){card.append(el('h5','',t.title),el('p','fate-note-scene',t.scene));const action=el('div','fate-note-action');action.append(el('b','','今天試著做'),el('p','',t.action));card.append(action);const reason=el('details','fate-note-reason');reason.append(el('summary','','為什麼是這個提醒？'),el('p','',t.reason));card.append(reason,el('span','fate-note-watermark','示意文案 · 尚未接入命盤計算'));}
  else card.append(el('p','',t.lead),el('div','fate-note-lock',`完成第 ${i+1} 項有效任務後自動啟封`));
  box.append(card);
 }
 const rules=el('details','fate-journal'),summary=el('summary','','哪些任務可以解鎖？'),list=el('ul');for(const line of ['組隊打寶：三人成功通關，並有有效參戰。','群組 BOSS：造成有效傷害，且首領成功被擊殺。','組隊爬塔：當天成功推進五層，並有有效參戰。'])list.append(el('li','',line));rules.append(summary,list,note('規劃規則：同一類任務當天只計一次，每個 TG 帳號最多解鎖三則；台北時間 00:00 換日。實際任務判定與次數保存尚未接入本預覽。'));box.append(rules);
 if(!isPreview)box.append(note('本功能仍在製作中，尚未接入任務判定與命盤計算；這裡不會假裝已有個人化結果。'));
 p.append(box);
}
function shareResult(show){if(show||result.zodiac===null)return result;return decodeResult(encodeResult({...result,zodiac:null}));}
async function makeCard(format,show){
 const status=document.getElementById('fate-status');if(busy)return;busy=true;status.textContent='正在為你描金、裝訂這頁旅章…';
 try{
  const r=shareResult(show),canvas=document.createElement('canvas'),w=1080,h=format==='story'?1920:1350;canvas.width=w;canvas.height=h;const c=canvas.getContext('2d');
  const image=new Image();image.src=ART+'journey.webp';await image.decode();await document.fonts.ready;
  c.fillStyle='#0a1425';c.fillRect(0,0,w,h);const ih=h*.65,scale=Math.max(w/image.width,ih/image.height);c.drawImage(image,(w-image.width*scale)/2,0,image.width*scale,image.height*scale);
  const gradient=c.createLinearGradient(0,ih*.32,0,h*.8);gradient.addColorStop(0,'#0a142500');gradient.addColorStop(.5,'#0a1425dc');gradient.addColorStop(1,'#0a1425');c.fillStyle=gradient;c.fillRect(0,0,w,h);
  const shade=c.createLinearGradient(0,0,0,245);shade.addColorStop(0,'#07111ed9');shade.addColorStop(1,'#07111e00');c.fillStyle=shade;c.fillRect(0,0,w,245);
  c.strokeStyle='#c0a167';c.lineWidth=2;c.strokeRect(32,32,w-64,h-64);c.strokeStyle='#b69b5a66';c.strokeRect(44,44,w-88,h-88);
  c.textAlign='center';c.fillStyle='#e4c58a';c.font='26px Georgia,"Microsoft JhengHei",serif';c.fillText('星 穹 旅 誌   ·   命 運 旅 章',w/2,111);
  c.font='20px Georgia,serif';c.fillStyle='#d7dce2';c.fillText('THE LAST STAR LANTERN',w/2,152);
  const y=format==='story'?1000:640;c.fillStyle='#cbd1d7';c.font='26px "Microsoft JhengHei",serif';c.fillText(`${show&&r.zodiac!==null?ZODIAC[r.zodiac]+'座 · ':''}${r.identity[0]}`,w/2,y);
  c.fillStyle=r.ending.color;c.font='64px Georgia,"Microsoft JhengHei",serif';c.fillText(r.ending.title,w/2,y+110);
  c.strokeStyle=r.ending.color;c.beginPath();c.moveTo(440,y+150);c.lineTo(640,y+150);c.stroke();
  c.fillStyle='#f3e5ca';c.font='35px Georgia,"Microsoft JhengHei",serif';wrap(c,r.ending.quote,540,y+220,800,57);
  c.fillStyle='#aebccf';c.font='26px "Microsoft JhengHei",sans-serif';wrap(c,r.ending.question,540,y+370,820,44);
  c.fillStyle='#dfc994';c.font='25px "Microsoft JhengHei",sans-serif';c.fillText('你的故事，尚未寫定。',540,h-192);
  c.fillStyle='#aab6c9';c.font='20px "Microsoft JhengHei",sans-serif';c.fillText('不用登入 · 一世流轉 · 遇見不同的自己',540,h-145);
  c.font='16px "Microsoft JhengHei",sans-serif';c.fillText(publicUrl(r.code).replace('https://',''),540,h-103);c.font='14px Georgia,serif';c.fillText('Game Producer · ミカサ   |   原創遊戲故事，非現實命運預測',540,h-66);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('輸出失敗')),'image/png'));cardFile=new File([blob],`星穹旅誌-${r.ending.title}-${format}.png`,{type:'image/png'});
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);const img=el('img','fate-preview');img.src=previewUrl;img.alt=`${r.ending.title}分享名帖預覽`;document.getElementById('fate-preview').replaceChildren(img);status.textContent='名帖已完成。先看預覽，再分享或儲存。';
 }catch{status.textContent='圖卡暫時沒有完成，可重試或先複製旅章連結。'}finally{busy=false}
}
function wrap(c,text,x,y,max,line){let row='';for(const char of text){if(c.measureText(row+char).width>max){c.fillText(row,x,y);row=char;y+=line}else row+=char;}if(row)c.fillText(row,x,y)}
async function shareCard(){const s=document.getElementById('fate-status');if(!cardFile){s.textContent='請先製作旅人名帖，確認預覽後再分享。';return}try{const data={files:[cardFile],title:'星穹旅誌 · 命運旅章'};if(navigator.canShare?.(data)){await navigator.share(data);s.textContent='已交給裝置的分享選單。'}else{s.textContent='此裝置未提供圖片分享選單，請先儲存圖片，再到 IG 或 Threads 上傳。'}}catch(e){if(e.name!=='AbortError')s.textContent='分享未完成，圖片仍在，請嘗試儲存。'}}
function saveCard(){const s=document.getElementById('fate-status');if(!cardFile||!previewUrl){s.textContent='請先製作旅人名帖。';return}const a=el('a');a.href=previewUrl;a.download=cardFile.name;document.body.append(a);a.click();a.remove();s.textContent='已請裝置儲存圖片；若 TG 未提供下載，可長按上方名帖另存。'}
document.addEventListener('visibilitychange',()=>{if(!media)return;if(document.hidden)media.pause();else media.play().catch(()=>{})});
window.addEventListener('pagehide',dispose);
window.addEventListener('message',e=>{if(!embedded||e.origin!==location.origin||e.source!==window.parent||e.data?.type!=='star-fate-soul')return;const y=window.scrollY;soul=readSoul(e.data.soul);heroName=typeof e.data.heroName==='string'?e.data.heroName.slice(0,24):'';if(qs.get('resume')==='1'&&stage==='intro'&&soul.draft){resumeLife();return}if(stage==='result'||stage==='archive'){render();window.scrollTo(0,y)}});
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===window.parent&&e.data?.type==='star-fate-storage-unavailable'){const s=document.getElementById('fate-status');if(s)s.textContent='裝置目前無法儲存旅誌。請先複製連結或下載名帖，故事不會因此改變。';}});
if(result){stage='result';showSign=result.zodiac!==null;}
if(qs.get('resume')==='1'){stage='intro';result=null;}if(qs.get('journal')==='1')stage='archive';
if(!embedded&&qs.get('resume')==='1'&&soul.draft)resumeLife();else render();
if(embedded)window.parent.postMessage({type:'star-fate-context'},location.origin);
const lifeTimer=setInterval(()=>{
 if(!currentLife||document.hidden)return;
 if(isPreview&&!previewRunning)return;
 const v=advanceLife(currentLife,currentLife.clockAt),at=isPreview?currentLife.clockAt+(v.available?6000:60000):Math.max(Date.now(),currentLife.clockAt);
 tickLife(at,false);
},1000);
window.addEventListener('pagehide',()=>clearInterval(lifeTimer));
