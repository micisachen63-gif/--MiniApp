(() => {
 'use strict';
 const original=window.RpgInterface.compose;
 const valid=c=>typeof c==='string'&&/^(?:f[12][0-9ab][01]{3}[0-9abx][a-f0-9]{8}|f3[0-9ab][01]{6}[0-9abx][a-f0-9]{8})$/.test(c);
 const read=k=>{try{return localStorage.getItem(k)}catch{return null}},write=(k,v)=>{try{localStorage.setItem(k,v);return true}catch{return false}};
 let overlay=null,frame=null,pinned=null,exit=null,opening=false;
 const incoming=new URLSearchParams(location.search).get('fate');
 async function open(code,archive=false){
  if(overlay||opening)return;opening=true;let life;
  try{life=await import('/fate/cycles.js')}catch{opening=false;return}opening=false;if(overlay)return;
  const app=document.getElementById('app'),focused=document.activeElement,oldOverflow=document.body.style.overflow,wasInert=app.inert;
  pinned=window.RpgFateHost?.characterId();if(!pinned)return;
  overlay=document.createElement('section');overlay.className='fate-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','命運旅章');
  const close=document.createElement('button');close.className='fate-overlay-close';close.textContent='‹ 返回冒險';
  frame=document.createElement('iframe');frame.title='命運旅章與今日旅箋';const params=new URLSearchParams();if(valid(code))params.set('result',code);if(archive)params.set('journal','1');else if(!valid(code)&&life.readSoul(read('star-fate-soul:'+pinned)).draft)params.set('resume','1');if(['127.0.0.1','localhost','[::1]'].includes(location.hostname)&&new URLSearchParams(location.search).get('preview')==='1')params.set('preview','1');frame.src='/fate/'+(params.size?'?'+params:'');overlay.append(close,frame);app.inert=true;document.body.style.overflow='hidden';document.body.append(overlay);
  exit=()=>{overlay?.remove();overlay=null;frame=null;app.inert=wasInert;document.body.style.overflow=oldOverflow;window.removeEventListener('message',message);document.removeEventListener('keydown',key);if(focused?.isConnected)focused.focus();window.RpgFateHost?.refresh();};
  const key=e=>{if(e.key==='Escape')exit();};
  const sendSoul=()=>frame?.contentWindow.postMessage({type:'star-fate-soul',soul:life.readSoul(read('star-fate-soul:'+pinned)),heroName:window.RpgFateHost?.characterName?.()||''},location.origin);
  const remember=(code,memories=[])=>{const record=life.rememberSoul(life.readSoul(read('star-fate-soul:'+pinned)),code,Date.now(),memories);delete record.draft;if(!write('star-fate-soul:'+pinned,JSON.stringify(record)))return false;write('star-fate-character:'+pinned,code);return true;};
  const message=e=>{if(e.origin!==location.origin||e.source!==frame?.contentWindow||window.RpgFateHost?.characterId()!==pinned)return;if(e.data?.type==='star-fate-context'){sendSoul();}else if(e.data?.type==='star-fate-cycle-complete'&&valid(e.data.code)){if(remember(e.data.code,e.data.memories))sendSoul();else frame.contentWindow.postMessage({type:'star-fate-storage-unavailable'},location.origin);}else if(e.data?.type==='star-fate-draft'){const record=life.readSoul(read('star-fate-soul:'+pinned));record.draft=e.data.draft;write('star-fate-soul:'+pinned,JSON.stringify(life.readSoul(record)));}else if(e.data?.type==='star-fate-close')exit();else if(e.data?.type==='star-fate-keep'&&valid(e.data.code)){
   if(window.RpgFateHost?.characterId()!==pinned)return;
   if(remember(e.data.code)){write('star-fate-last',e.data.code);exit();}else{frame.contentWindow.postMessage({type:'star-fate-storage-unavailable'},location.origin);}
  }};
  window.addEventListener('message',message);document.addEventListener('keydown',key);close.onclick=exit;close.focus();
 }
 window.RpgInterface.compose=(view,context)=>{
  original(view,context);
  if(context.tab!=='home')return;
  const id=window.RpgFateHost?.characterId();if(!id)return;
  let draft=null;try{draft=JSON.parse(read('star-fate-soul:'+id))?.draft}catch{}
  const saved=read('star-fate-character:'+id),card=document.createElement('section');card.className='fate-home-card';
  const tag=document.createElement('small');tag.textContent='THE LAST STAR LANTERN';const title=document.createElement('h3');title.textContent='命運旅章';const desc=document.createElement('p');desc.textContent=draft?'這一世仍在生長。回來看看，命運又寫下了什麼。':valid(saved)?'翻閱你的選擇，收一封今日旅箋。':'如果人生能重新啟程，你會把光留給誰？';
  const actions=document.createElement('div');actions.className='fate-home-actions';const b=document.createElement('button');b.type='button';b.textContent=draft?'繼續此世  ›':valid(saved)?'翻閱旅章  ›':'展開旅章  ›';b.onclick=()=>open(draft?null:valid(saved)?saved:valid(incoming)?incoming:null);const journal=document.createElement('button');journal.type='button';journal.textContent='靈魂旅誌';journal.onclick=()=>open(valid(saved)?saved:null,true);actions.append(b,journal);card.append(tag,title,desc,actions);view.prepend(card);
  Promise.all([import('/fate/life.js'),import('/fate/cycles.js')]).then(([clock,book])=>{if(!card.isConnected||window.RpgFateHost?.characterId()!==id)return;const record=book.readSoul(read('star-fate-soul:'+id));if(record.draft){const d=record.draft,now=new URLSearchParams(location.search).get('preview')==='1'?d.clockAt:Date.now();desc.textContent=`第 ${record.entries.length+1} 世 · ${clock.lifeAge(d,now)} 歲 · ${clock.lifeGrowth(d).label}`;}else if(record.entries.length)desc.textContent=`已承載 ${record.entries.length} 世記憶 · ${book.soulMilestone(record).current?.title||'靈魂初醒'}`;}).catch(()=>{});
  if(valid(incoming)&&!read('star-fate-import:'+id+':'+incoming)){write('star-fate-import:'+id+':'+incoming,'seen');queueMicrotask(()=>open(incoming));}
 };
})();
