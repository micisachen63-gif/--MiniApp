import {ART,ZODIAC,ORBITS,validBirth,zodiacFor,encodeResult,decodeResult,newSeed,randomOrbit,publicUrl,telegramUrl,shareText,generatedZodiac} from './model.js';
import {scenesFor,readSoul,rememberSoul,soulMilestone,SOUL_ACHIEVEMENTS,seedForNextLife} from './cycles.js';
import {createLife,validLife,advanceLife,chooseLife,lifeAge,startStatus,taipeiDay} from './life.js';
import {renderLifeUI,paintLifeUI} from './life-ui.js';
import {narrativeEvents} from './event-catalog-v1.js';
import {formalEvents,plannedContent} from './formal-events.js';
import {endingForLife} from './ending-story.js';
import {createCloudClient} from './cloud-client.js';
import {renderProfile,renderStartBirthFields} from './profile-ui.js';
import {mountSharePanel} from './share-ui.js';
import {mountZodiacSky} from './zodiac-ui.js';
import {zodiacHeroSource} from './zodiac-sign.js';
const root=document.getElementById('fate'),qs=new URLSearchParams(location.search);
const storage={get:k=>{try{return localStorage.getItem(k)}catch{return null}},set:(k,v)=>{try{localStorage.setItem(k,v);return true}catch{return false}}};
const pathResult=/^\/fate\/r\/([^/]+)$/.exec(location.pathname)?.[1],queryResult=qs.get('result');
let shared=!!pathResult,result=decodeResult(pathResult||queryResult),mode='birthday',orbit=0,zodiac=null,showSign=true,answers=[],seed='',stage='intro',media;
let sharePanel=null,startBirthState={},birthSaveRetry=null;const sharePrivacy=new Map();
const embedded=window.parent!==window;
const isPreview=!embedded&&['127.0.0.1','localhost','[::1]'].includes(location.hostname)&&qs.get('preview')==='1';
let previewCompleted=0,birthDetail=null;
let soul=embedded?{entries:[]}:readSoul(storage.get('star-fate-guest-soul')),heroName='',archivePage=1;
let currentLife=null,previewRunning=true;
const client=embedded?createCloudClient():null;
let cloud=null,dailyData=null,profileData=null,cloudOffset=0,lastSync=0,syncing=false,pendingFull=false,mutating=false,cloudError='',cloudRetry=null,profileNotice='';
const cloudNow=()=>Date.now()+cloudOffset;
const lifeEvents=(life,now)=>life.version>=4?formalEvents(life,now):narrativeEvents(life,now);
const ageLabel=age=>age>0&&age<1?`${Math.max(1,Math.round(age*12))} 個月`:`${Math.floor(age)} 歲`;
const soulCount=()=>embedded?(cloud?.completed||0):soul.entries.length;
const readStarts=()=>{try{const a=JSON.parse(storage.get('star-fate-preview-starts'));return Array.isArray(a)?a.filter(Number.isSafeInteger).slice(-32):[]}catch{return []}};
let startHistory=embedded?[]:readStarts();
const lifeNow=()=>isPreview&&currentLife?currentLife.clockAt:Date.now();
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function button(text,fn,cls='fate-quiet'){const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;}
function note(text){return el('p','fate-note',text)}
function dispose(){media?.pause();media?.removeAttribute('src');media?.load();media=null;sharePanel?.dispose();sharePanel=null;}
function setupMedia(bg){
 if(media){bg.append(media);if(!document.hidden)media.play().catch(()=>{});return;}
 if(matchMedia('(prefers-reduced-motion: reduce)').matches||navigator.connection?.saveData)return;
 media=el('video');media.muted=true;media.loop=true;media.playsInline=true;media.autoplay=true;media.preload='none';media.poster=ART+'journey.webp';bg.append(media);
 media.src=ART+'journey-loop.mp4';media.play().catch(()=>{});
}
function render(){
 const detailsOpen=[...root.querySelectorAll('details[open]>summary')].map(e=>e.textContent);if(media)media.remove();sharePanel?.dispose();sharePanel=null;root.replaceChildren();const shell=el('div','fate-shell'+(stage==='scene'?' fate-story':'')+(result?' fate-result':''));
 if(result)shell.style.setProperty('--ending',result.ending.color);if(stage==='archive')shell.classList.add('fate-archive');if(stage==='life'||stage==='daily')shell.classList.add('fate-live');
 const bg=el('div','fate-media');bg.setAttribute('aria-hidden','true');shell.append(bg);setupMedia(bg);
 const top=el('header','fate-top');top.append(el('span','fate-brand','星穹旅誌 ✧'));
 top.append(button('今日旅箋',openDaily));
 top.append(button('靈魂旅誌',()=>{stage='archive';archivePage=1;render();window.scrollTo(0,0)}));
 top.append(button(embedded?'返回冒險':'關於旅章',()=>{if(embedded){window.parent.postMessage({type:'star-fate-close'},location.origin)}else{document.getElementById('fate-about')?.scrollIntoView({behavior:'smooth',block:'center'});}}));shell.append(top);
 if(isPreview){const strip=el('aside','fate-preview-strip');strip.append(el('b','','互動預覽 · 尚未發布'),el('span','','故事與圖卡可操作；命盤與任務判定尚未接入。'));shell.append(strip);}
 const mast=el('header','fate-masthead');mast.append(el('span','fate-eyebrow',stage==='archive'?'A SOUL THROUGH MANY LIVES':result?'A LIFE WRITTEN IN STARLIGHT':'THE LAST STAR LANTERN'),el('h1','',stage==='archive'?'靈魂旅誌':stage==='daily'?'今日旅箋':stage==='result'&&result?'命運，因你而不同':'命運旅章'),el('p','',stage==='archive'?'一位英雄，承載了許多沒有被遺忘的人生。':result?'這一生已落款，靈魂還記得。':stage==='life'?'時間會向前，而你決定如何被記得。':'每一次啟程，都讓靈魂多一段記憶。'));shell.append(mast);
 const sky=el('div','fate-sky');mountZodiacSky(sky,zodiacHeroSource({stage,currentLife,cloud,result,entries:soul.entries}));shell.append(sky);
 const panel=el('section','fate-panel');panel.setAttribute('aria-label',stage==='archive'?'靈魂旅誌':result?'旅章結果':stage==='life'?'此世紀事':stage==='daily'?'今日旅箋':'啟程設定');shell.append(panel);
 if(embedded&&!cloud){panel.append(note('正在連接這位英雄的靈魂旅誌…'));if(cloudError)showCloudError(panel);root.append(shell);return;}
 if(embedded&&cloudError)showCloudError(panel);
 if(stage==='archive')renderArchive(panel);else if(stage==='life')renderLife(panel);else if(stage==='daily'){renderDaily(panel);panel.append(button(currentLife?'回到正在展開的這一世':'回到旅章',()=>{stage=currentLife?'life':result?'result':'intro';render();window.scrollTo(0,0)}));}else if(result)renderResult(panel);else if(stage==='scene')renderScene(panel);else renderIntro(panel);
 const footer=el('footer','fate-footer');footer.id='fate-about';footer.append(el('div','','原創奇幻短篇 · 僅供遊戲趣味與生活靈感'),el('div','','不預測現實命運，不影響遊戲戰力與掉落'),el('div','','Game Producer · ミカサ'));shell.append(footer);for(const d of shell.querySelectorAll('details'))if(detailsOpen.includes(d.querySelector('summary')?.textContent))d.open=true;root.append(shell);
}
function renderIntro(p){
 p.append(el('span','fate-eyebrow','第一期 · 最後一盞星燈'),el('h2','','如果人生能重新啟程，\n你會把光留給誰？'));
 const modes=el('div','fate-mode');for(const [key,label] of [['birthday','以生日啟程'],['random','交給命運']]){const b=button(label,()=>{mode=key;render()},'fate-option');b.setAttribute('aria-pressed',String(mode===key));modes.append(b)}p.append(modes);
 let dateInput,signInput,startFields;
 if(mode==='birthday'){
  const label=el('label','fate-field','出生年月日');label.htmlFor='fate-birth';dateInput=el('input','fate-date');dateInput.id='fate-birth';dateInput.type='date';dateInput.min='1900-01-01';const t=new Date();dateInput.max=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;dateInput.required=true;
  dateInput.value=birthDetail?.date||profileData?.birth?.date||'';
  p.append(label,dateInput,note('生日只供起點與星座；出生時間、地點可留白。不會將完整出生資料放進分享碼或圖卡。'));
  dateInput.oninput=()=>{birthDetail={...birthDetail,date:dateInput.value};birthSaveRetry=null;};
  startFields=renderStartBirthFields(p,{value:startBirthState,onChange:value=>{startBirthState=value;birthSaveRetry=null;}});
  if(!embedded)p.append(note('訪客的時間與地點只留在此頁記憶中，未登入不會保存至帳號。'));
 }
 {const check=el('label','fate-check');signInput=el('input');signInput.type='checkbox';signInput.checked=showSign;signInput.onchange=()=>{showSign=signInput.checked};check.append(signInput,el('span','','分享時顯示星座（可以隨時關閉）'));p.append(check);
 }
 const error=el('div','fate-error');error.setAttribute('role','alert');p.append(error);
 p.append(button('展開我的旅章',async()=>{
  const birth=mode==='birthday'?validBirth(dateInput.value):null;
  if(mode==='birthday'&&!birth){error.textContent='請選擇有效的出生日期，生日不能晚於今天。';dateInput.focus();return;}
  birthDetail=birth?{date:dateInput.value,...startFields.read()}:null;
  if(embedded&&birth&&startFields.consented()){
   const payload=JSON.stringify(birthDetail);if(!birthSaveRetry||birthSaveRetry.payload!==payload)birthSaveRetry={payload,id:crypto.randomUUID()};
   const startButton=error.nextElementSibling;try{if(startButton)startButton.disabled=true;await client.request('fate/profile/save',{requestId:birthSaveRetry.id,consent:true,birth:birthDetail});birthSaveRetry=null;}catch(e){error.textContent=e.message+'；資料尚未保存，請重試。';return;}finally{if(startButton)startButton.disabled=false;}
  }
  zodiac=birth?zodiacFor(birth.month,birth.day):null;startCycle();
 },'fate-primary'));
 const saved=embedded?decodeResult(cloud?.last?.code):decodeResult(storage.get('star-fate-last'));
 if(saved)p.append(button('翻閱上次旅章',()=>{result=saved;shared=false;render()},'fate-subtle'));
 if(soul.draft)p.append(button('繼續正在展開的這一世',()=>resumeLife(),'fate-quiet'));
 p.append(note('一世 2 小時 · 每天最多 4 世 · 06:00–24:00 成長，凌晨暫停。未回應會由命運代選；落款後需親自開啟下一世。只有本機預覽使用加速時鐘。'));
}
function renderResult(p){
 const record=soul.entries.find(e=>e.code===result.code)||(cloud?.last?.code===result.code?cloud.last:null);const storyLife=record?.draft||result;
 if(storyLife?.version>=4){const story=endingForLife(storyLife),book=el('article','fate-ending-story'),image=el('img','fate-ending-illustration');image.src=story.illustration;image.alt=story.title;image.loading='eager';book.append(image,el('span','fate-eyebrow',`星燈紀元 ${story.worldYear} · 此生終章`),el('h2','',story.title));for(const text of story.paragraphs)book.append(el('p','',text));book.append(el('p','fate-ending-summary',story.summary));p.append(book);}
 p.append(el('span','fate-eyebrow',shared?'一位旅人的故事':'你的命運旅章'),el('h2','fate-result-title',result.ending.title));
 const badges=el('div','fate-identity');badges.append(el('span','',result.identity[0]));if(result.zodiac!==null)badges.append(el('span','',ZODIAC[result.zodiac]+'座'));p.append(badges,el('p','fate-quote',`「${result.ending.quote}」`),el('p','',result.ending.body));
 const journal=el('details','fate-journal'),summary=el('summary','','翻閱這一生的選擇與紀事'),list=el('ol');const memories=record?.draft?lifeEvents(record.draft,record.draft.clockAt):result.version>=4?plannedContent(result):record?.memories||[];list.append(el('li','',memories.find(m=>m.age===0)?.text||result.identity[2]));appendMemories(list,result,memories);journal.append(summary,list);p.append(journal);
 p.append(el('p','fate-quote',result.ending.question));
 const extras=el('div','fate-row');extras.append(button('今日旅箋',openDaily),button('靈魂旅誌',()=>{stage='archive';render();window.scrollTo(0,0)}));p.append(extras);
 sharePanel=mountSharePanel(p,{result,initialShow:sharePrivacy.has(result.code)?sharePrivacy.get(result.code):result.zodiac!==null,onPrivacyChange:value=>{sharePrivacy.set(result.code,value);if(sharePrivacy.size>64)sharePrivacy.delete(sharePrivacy.keys().next().value)},client});
 if(shared){p.append(button('走出自己的旅章',()=>reset(),'fate-primary'));}
 else if(embedded){p.append(button('將旅章收進目前角色',()=>{cloudMutation('fate/keep',{code:result.code})},'fate-primary'));p.append(note('正式完成的此世已由雲端保存。匯入或收藏分享故事只作紀念，不增加輪迴世數與成就。'));}
 else{const link=el('a','fate-primary',isPreview?'預覽創角銜接':'前往 TG，讓冒險繼續');link.href=isPreview?'/?fixture=444&preview=1&fate='+encodeURIComponent(result.code):telegramUrl(result.code);link.rel='noopener';p.append(link,note(isPreview?'正式版將前往專屬 TG BOT；此預覽以隔離帳號示範創角，不會修改正式玩家。':'加入遊戲專屬群組，再從 BOT 開啟遊戲創角。旅章只記錄故事，不提供戰力獎勵。'));}
 renderSoul(p);
 p.append(el('div','fate-life-divider','此生已落款 · 靈魂仍在旅途'),button('開啟下一趟輪迴',()=>startCycle(),'fate-primary'),el('p','fate-cycle-copy','換一個出身，遇見不同的人。\n每一世的選擇，都會成為這位英雄的靈魂記憶。'),button('重新設定起點',()=>reset(),'fate-subtle'));
}
function reset(){result=null;shared=false;answers=[];birthDetail=null;stage='intro';history.replaceState(null,'','/fate/'+(isPreview?'?preview=1':''));render();window.scrollTo(0,0)}
function startCycle(){
 if(embedded){if(cloud?.active){resumeLife();return;}cloudMutation('fate/start',{mode:mode==='birthday'&&(birthDetail?.date||profileData?.birth?.date||cloud?.profile?.saved)?'birthday':'random',birthDate:mode==='birthday'?birthDetail?.date:undefined,showSign});return;}
 if(soul.draft){resumeLife();return;}
 let now=Date.now();if(isPreview&&!startStatus([],now).allowed)now=Date.parse(taipeiDay(now)+'T10:00:00+08:00');
 const status=startStatus(startHistory,now);if(!status.allowed){const target=document.querySelector('.fate-error')||document.querySelector('.fate-panel');const m=note(status.night?'星穹已入夜，06:00 再開啟下一世。':'今日四段人生已寫滿，明天再開啟新的旅程。');m.setAttribute('role','status');target.append(m);return;}
 const previous=result||decodeResult(soul.entries.at(-1)?.code);let next=randomOrbit(zodiac);
 if(previous&&next===previous.orbit)next=(next+1+parseInt(newSeed().slice(0,2),16)%11)%12;
 orbit=next;seed=seedForNextLife(newSeed(),soul.entries,4);
 const identityZodiac=mode==='birthday'&&zodiac!==null?zodiac:generatedZodiac(seed);
 currentLife=createLife({version:4,orbit,zodiac:showSign?identityZodiac:null,seed,startedAt:now});currentLife.identityZodiac=identityZodiac;currentLife.recentEventIds=soul.entries.slice(-3).flatMap(e=>(e.memories||[]).map(m=>m.id));startHistory.push(now);storage.set('star-fate-preview-starts',JSON.stringify(startHistory.slice(-32)));previewRunning=true;soul.draft=currentLife;persistLife();result=null;shared=false;answers=[];stage='life';render();window.scrollTo(0,0);
}
function persistLife(){if(embedded)return;if(currentLife)soul.draft=currentLife;storage.set('star-fate-guest-soul',JSON.stringify(soul));}
function resumeLife(){if(embedded){currentLife=validLife(cloud?.active?.draft);if(currentLife){result=null;shared=false;stage='life';render();window.scrollTo(0,0)}return;}currentLife=validLife(soul.draft);if(!currentLife)return;result=null;shared=false;stage='life';tickLife(isPreview?currentLife.clockAt:Date.now());window.scrollTo(0,0);}
function tickLife(at,repaint=true){
 if(embedded){paintCloudLife();return;}
 if(!currentLife)return;const before=advanceLife(currentLife,currentLife.clockAt),v=advanceLife(currentLife,Math.max(currentLife.clockAt,Math.trunc(at)));const structural=before.available!==v.available||before.index!==v.index||before.night!==v.night||v.completed;currentLife=v.draft;soul.draft=currentLife;
 if(v.completed){previewRunning=false;result=decodeResult(v.code);const memories=lifeEvents(currentLife,currentLife.clockAt);soul=rememberSoul(soul,v.code,Date.now(),memories);delete soul.draft;currentLife=null;shared=false;stage='result';storage.set('star-fate-last',v.code);storage.set('star-fate-guest-soul',JSON.stringify(soul));}
 else persistLife();if(repaint||structural){render();if(v.available&&!before.available&&stage==='life')requestAnimationFrame(()=>document.querySelector('.fate-live-question')?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));}else if(stage==='life')paintLifeUI(document.querySelector('[data-life-ui]'),currentLife);
}
const clockLabel=at=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
function renderLife(p){
 if(!currentLife)return;if(embedded)currentLife=cloudDisplayLife();const status=startStatus(startHistory,currentLife.startedAt);
 renderLifeUI(p,{draft:currentLife,soulCount:soulCount(),startedToday:embedded?cloud.startedToday:status.used,preview:isPreview,authoritative:embedded,running:previewRunning,heroName,
 onToggle:()=>{previewRunning=!previewRunning;render()},onClock:at=>tickLife(at),
 onChoice:(answer,index)=>{if(embedded){cloudMutation('fate/choice',{lifeId:cloud.active.id,index,answer});return;}try{currentLife=chooseLife(currentLife,answer,lifeNow(),index).draft;persistLife();render()}catch{tickLife(lifeNow())}},
 onDaily:openDaily,onArchive:()=>{stage='archive';render();window.scrollTo(0,0)},onClose:()=>{if(embedded)window.parent.postMessage({type:'star-fate-close'},location.origin)}});
}
function appendMemories(list,r,memories=[]){
 const rows=[...memories.filter(m=>m.age!==0&&m.kind!=='choice')],scenes=scenesFor(r);
 r.answers.forEach((a,i)=>rows.push({age:scenes[i].age||18+i*24,text:`${r.auto?.[i]?'命運代選 · ':'親自選擇 · '}${scenes[i].choices[a][2]}`}));
 rows.sort((a,b)=>a.age-b.age);for(const m of rows)list.append(el('li','',`${ageLabel(m.age)} · ${m.text}`));
}
function renderSoul(p){
 const total=soulCount(),m=embedded?{count:total,current:cloud?.milestone,next:SOUL_ACHIEVEMENTS.find(a=>a.at>total)}:soulMilestone(soul),box=el('section','fate-soul');box.append(el('span','fate-eyebrow',embedded?'THIS HERO REMEMBERS':'MEMORIES OF A TRAVELER'),el('div','fate-soul-title',embedded&&heroName?`${heroName} · 靈魂承載`:'靈魂承載'));const count=el('div','fate-soul-count',String(m.count));count.append(el('small','','世記憶'));box.append(count,el('div','fate-soul-title',m.current?.title||'等待第一世的落款'));
 const bar=el('div','fate-soul-progress'),fill=el('span');fill.style.width=m.next?`${Math.min(100,m.count/m.next.at*100)}%`:'100%';bar.append(fill);box.append(bar,note(m.next?`再完成 ${m.next.at-m.count} 世，解鎖「${m.next.title}」。`:'百世相逢，已解鎖全部紀念稱號。'));if(stage!=='archive')box.append(button('翻閱靈魂旅誌',()=>{stage='archive';archivePage=1;render();window.scrollTo(0,0)}));box.append(note(embedded?'這位英雄完整走過的輪迴由雲端保存；公開故事收藏不計入世數。':'目前是此裝置的訪客紀錄。進入遊戲後，可為選定的角色展開雲端輪迴；訪客故事可作紀念收藏。'));p.append(box);
}
function renderArchive(p){
 if(embedded){renderCloudArchive(p);return;}
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
 if(embedded){renderCloudDaily(p);return;}
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
 if(!isPreview)box.append(note('訪客可先體驗故事。從遊戲內開啟今日旅箋，即可查看帳號真正完成的同行任務與依序解鎖的提醒。'));
 p.append(box);
}
document.addEventListener('visibilitychange',()=>{if(!media)return;if(document.hidden)media.pause();else media.play().catch(()=>{})});
window.addEventListener('pagehide',dispose);
if(result){stage='result';showSign=result.zodiac!==null;}
if(qs.get('resume')==='1'){stage='intro';result=null;}if(qs.get('journal')==='1')stage='archive';
if(!embedded&&qs.get('resume')==='1'&&soul.draft)resumeLife();else render();
if(embedded)syncCloud(true,true);
const lifeTimer=setInterval(()=>{
 if(document.hidden)return;
 if(embedded){if(cloud?.active){paintCloudLife();if(Date.now()-lastSync>=45000||(cloud.active.nextAt&&cloudNow()>=cloud.active.nextAt&&Date.now()-lastSync>=10000))syncCloud();}return;}
 if(!currentLife)return;
 if(isPreview&&!previewRunning)return;
 const v=advanceLife(currentLife,currentLife.clockAt),at=isPreview?currentLife.clockAt+(v.available?6000:60000):Math.max(Date.now(),currentLife.clockAt);
 tickLife(at,false);
},1000);
window.addEventListener('pagehide',()=>clearInterval(lifeTimer));

function showCloudError(p){const box=el('div','fate-cloud-error');box.setAttribute('role','alert');box.append(el('p','',cloudError),button('重試連線',()=>cloudRetry?cloudRetry():syncCloud(true,true)));p.prepend(box);}
async function cloudMutation(action,body){
 if(mutating)return;const requestId=body.requestId||crypto.randomUUID(),payload={...body,requestId};
 const run=async()=>{if(mutating)return;mutating=true;cloudError='';document.querySelectorAll('.fate-live-question button,.fate-primary').forEach(b=>b.disabled=true);
 try{await client.request(action,payload,requestId);cloudRetry=null;if(action==='fate/start'){result=null;stage='life';}await syncCloud(true);if(action==='fate/keep'){const s=document.getElementById('fate-status');if(s)s.textContent='已收藏這封旅人來信；正式輪迴成就不變。';}}
 catch(error){cloudError=error.message;cloudRetry=run;render();}finally{mutating=false;document.querySelectorAll('.fate-live-question button,.fate-primary').forEach(b=>b.disabled=false);}};await run();
}
async function syncCloud(full=false,initial=false){
 if(!embedded)return;if(syncing){pendingFull=pendingFull||full;return;}syncing=true;lastSync=Date.now();
 try{const data=await client.request(full?'fate/me':'fate/state');cloudOffset=data.now-Date.now();const old=cloud,oldId=old?.active?.id,oldAnswers=old?.active?.draft?.answers?.join(''),before=old?.active?advanceLife(cloudDisplayLife(),cloudNow()).available:false;
 cloud={...cloud,...data};heroName=data.heroName||heroName;cloudError='';
 if(data.entries)soul.entries=[...data.entries].reverse();else if(data.last&&!soul.entries.some(e=>e.id===data.last.id))soul.entries.push(data.last);
 if(data.active){soul.draft=data.active.draft;currentLife=validLife(data.active.draft);if(initial&&!result&&stage==='intro')stage='life';}
 else{delete soul.draft;currentLife=null;if(oldId&&data.last){result=decodeResult(data.last.code);shared=false;if(stage==='life')stage='result';}}
 const after=data.active?advanceLife(cloudDisplayLife(),cloudNow()).available:false;
 if(initial||full||oldId!==data.active?.id||oldAnswers!==data.active?.draft?.answers?.join('')||before!==after){const y=window.scrollY;render();window.scrollTo(0,y);}else if(stage==='life')paintCloudLife();
 }catch(error){cloudError=error.message;if(initial||!cloud)render();else if(!document.querySelector('.fate-cloud-error'))showCloudError(document.querySelector('.fate-panel'));}finally{syncing=false;if(pendingFull){pendingFull=false;syncCloud(true);}}
}
function cloudDisplayLife(){if(!cloud?.active)return currentLife;const d=cloud.active.draft;return {...d,clockAt:Math.max(d.clockAt,Math.min(cloudNow(),cloud.active.nextAt?cloud.active.nextAt-1:cloudNow()))};}
function paintCloudLife(){
 if(stage!=='life'||!cloud?.active)return;const panel=document.querySelector('[data-life-ui]');if(!panel)return;
 const now=cloudNow(),draft=cloud.active.draft,gate=advanceLife(draft,now);currentLife=cloudDisplayLife();paintLifeUI(panel,currentLife,false,now);if(mutating)for(const button of panel.querySelectorAll('.fate-live-question button'))button.disabled=true;
 const phase=`${gate.night}:${gate.index}:${gate.available}:${gate.completed}`;
 if(panel.dataset.authorityPhase!==phase){panel.dataset.authorityPhase=phase;
  if(gate.night!==advanceLife(draft,draft.clockAt).night||gate.index!==draft.answers.length||gate.available&&!panel.querySelector('.fate-live-question'))syncCloud();
 }
}
async function openDaily(){stage='daily';dailyData=null;profileData=null;render();window.scrollTo(0,0);if(!embedded)return;try{const [daily,profile]=await Promise.all([client.request('fate/daily'),client.request('fate/profile')]);dailyData=daily;profileData=profile.profile;if(stage==='daily')render();}catch(error){cloudError=error.message;cloudRetry=openDaily;if(stage==='daily')render();}}
function renderCloudDaily(p){
 if(!dailyData){p.append(note('正在開啟今日旅箋…'),button('重新開啟今日旅箋',openDaily));return;}
 const box=el('section','fate-daily');box.append(el('span','fate-eyebrow','LET THE STARS WRITE BACK'),el('h3','',`今日旅箋 · ${dailyData.day}`),note(dailyData.profile?.coverage==='three-traditions'?'參考傳統命理排盤的生活提醒，僅供娛樂與自我觀察，不作現實預測。':'生活靈感 · 出生資料不足，未作完整排盤。'));
 const names=['健康','工作','感情'],trail=el('div','fate-unlock-trail');for(let i=0;i<3;i++)trail.append(el('span',dailyData.unlocked>i?'lit':'',`${i+1} ${names[i]}`));box.append(trail);
 for(let i=0;i<3;i++){
  const n=dailyData.notes[i]||{locked:true},key=['health','work','love'][i],card=el('article',`fate-note-card fate-note-${key}${n.locked?' locked':' revealed'}`),head=el('header','fate-note-head'),copy=el('div');copy.append(el('small','',['CARE FOR YOURSELF','CHOOSE YOUR NEXT STEP','MAKE ROOM FOR CLOSENESS'][i]),el('h4','',names[i]));head.append(el('span','fate-note-seal',n.locked?String(i+1):'✧'),copy,el('span','fate-note-state',n.locked?'待啟封':'已解鎖'));card.append(head);
  if(n.locked)card.append(el('p','',['先安放自己，再照亮別人。','把力氣留給真正需要的一步。','不必讓在乎藏在猜測裡。'][i]),el('div','fate-note-lock',`完成第 ${i+1} 項有效同行任務後，依序啟封。`));
  else{card.append(el('h5','',n.title||names[i]+'旅箋'),el('p','fate-note-scene',n.scene));const action=el('div','fate-note-action');action.append(el('b','','今天試著做'),el('p','',n.action));card.append(action);const reason=el('details','fate-note-reason');reason.append(el('summary','','為什麼是這則提醒？'),el('p','',n.reason));if(typeof n.basis==='string')reason.append(note(n.basis));card.append(reason,el('span','fate-note-watermark',n.kind||'生活靈感'));}box.append(card);
 }
 const rules=el('details','fate-journal');rules.append(el('summary','','哪些同行任務可以解鎖？'),note('健康 → 工作 → 感情，固定順序。三人打寶通關、群組 BOSS 擊殺、組隊塔推進五層，均需有效參戰。同類每天一次，每個 TG 帳號每天最多三則；台北時間 00:00 換日。'));box.append(rules,button('重新查看任務進度',openDaily),note('更新出生檔案不會重抽今日已生成的提醒；新的資料自下一天套用。'));
 if(profileNotice){const status=el('p','fate-status',profileNotice);status.setAttribute('role','status');box.append(status);}if(profileData)renderProfile(box,{profile:profileData,onSave:async body=>{await client.request('fate/profile/save',body,body.requestId);profileNotice='出生檔案已保存；新的資料自下一天套用。';profileData=(await client.request('fate/profile')).profile;cloud.profile=profileData;dailyData=await client.request('fate/daily');render();},onDelete:async body=>{await client.request('fate/profile/delete',body,body.requestId);profileNotice='出生資料與過去的個人提醒已刪除。';profileData=(await client.request('fate/profile')).profile;cloud.profile=profileData;dailyData=await client.request('fate/daily');render();}});p.append(box);
}
function renderCloudArchive(p){
 renderSoul(p);p.append(el('h2','',heroName?`${heroName}的靈魂旅誌`:'靈魂旅誌'));
 if(cloud.active)p.append(button('繼續正在展開的這一世',resumeLife,'fate-primary'));
 for(const [index,e] of [...soul.entries].reverse().entries()){
  const r=decodeResult(e.code);if(!r)continue;const story=e.draft?.version>=4?endingForLife(e.draft):null,card=el('article','fate-memory-card');card.append(el('small','',`第 ${Math.max(1,cloud.completed-index)} 世 · 雲端旅誌`),el('h3','',story?.title||r.ending.title));if(story){const img=el('img','fate-ending-illustration');img.src=story.illustration;img.alt=story.title;img.loading='lazy';card.append(img,el('p','',story.summary));}card.append(button('重讀此世終章與分享',()=>{result=r;shared=false;stage='result';render();window.scrollTo(0,0)}));p.append(card);
 }
 if(!soul.entries.length)p.append(note('完整走過一世後，第一段正式記憶便會留在這裡。'));
 if(cloud.next)p.append(button('再往前翻十世',async()=>{try{const data=await client.request('fate/history',{before:cloud.next});const ids=new Set(soul.entries.map(e=>e.id));soul.entries.unshift(...data.entries.filter(e=>!ids.has(e.id)).reverse());cloud.next=data.next;render();}catch(error){cloudError=error.message;render();}}));
 if(cloud.memorials?.length){const memories=el('details','fate-journal');memories.append(el('summary','','收藏的旅人來信 · 不計輪迴成就'));for(const e of cloud.memorials){const r=decodeResult(e.code);if(r)memories.append(button(r.ending.title,()=>{result=r;shared=true;stage='result';render();window.scrollTo(0,0)}));}p.append(memories);}
 p.append(button('開啟下一趟輪迴',startCycle,'fate-primary'));
}
document.addEventListener('visibilitychange',()=>{if(embedded&&!document.hidden){syncCloud();if(stage==='daily')openDaily();}});
window.addEventListener('pagehide',()=>client?.dispose());
