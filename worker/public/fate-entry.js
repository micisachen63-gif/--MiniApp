(() => {
 'use strict';
 const original=window.RpgInterface.compose;
 const valid=c=>typeof c==='string'&&/^f[1-5][a-f0-9x]{10,30}$/.test(c);
 let overlay=null,frame=null,pinned=null,exit=null,opening=false;
 const entryParams=new URLSearchParams(location.search),incoming=entryParams.get('fate'),startParam=String(window.Telegram?.WebApp?.initDataUnsafe?.start_param||entryParams.get('screen')||entryParams.get('tgWebAppStartParam')||location.hash.replace(/^#/,'').split('&')[0]||'').replace(/^rpg_?/,''),autoOpen=startParam==='fate'||entryParams.has('fateEvent'),cache=new Map(),seen=new Set();
 const targetCharacter=entryParams.get('fateCharacter'),targetName=entryParams.get('fateCharacterName')?.slice(0,24)||'另一角色';
 const wrongCharacter=id=>targetCharacter&&String(id)!==targetCharacter;
 function characterNotice(){if(overlay)return;const app=document.getElementById('app'),wasInert=app.inert,oldOverflow=document.body.style.overflow,focused=document.activeElement;overlay=document.createElement('section');overlay.className='fate-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','旅章角色提醒');const close=document.createElement('button');close.className='fate-overlay-close';close.textContent='‹ 返回冒險';const notice=document.createElement('div');notice.className='fate-character-notice';const title=document.createElement('h2');title.textContent='星燈寄給另一位旅人';const copy=document.createElement('p');copy.textContent=`這是${targetName==='另一角色'?'另一角色':'「'+targetName+'」'}的旅章，請先從選角切換至該角色。`;notice.append(title,copy);overlay.append(close,notice);app.inert=true;document.body.style.overflow='hidden';document.body.append(overlay);const key=e=>{if(e.key==='Escape')exit()};exit=()=>{overlay?.remove();overlay=null;document.removeEventListener('keydown',key);app.inert=wasInert;document.body.style.overflow=oldOverflow;if(focused?.isConnected)focused.focus()};document.addEventListener('keydown',key);close.onclick=exit;close.focus();}

 async function state(id){const old=cache.get(String(id));if(old&&Date.now()-old.at<45000)return old.value;const value=await window.RpgFateHost.request('fate/me',{});if(String(window.RpgFateHost.characterId())===String(id))cache.set(String(id),{at:Date.now(),value});return value;}
 async function open(code,archive=false){
  if(overlay||opening)return;if(wrongCharacter(window.RpgFateHost?.characterId())){characterNotice();return;}opening=true;let protocol,nativeModel,nativeHost;
  try{protocol=await import('/fate/bridge-protocol.js');nativeModel=await import('/fate/share-model.js');const nativeModule=await import('/fate/native-share-host.js');nativeHost=nativeModule.createNativeShareHost({tg:window.Telegram?.WebApp});}catch{opening=false;return}opening=false;if(overlay)return;
  const app=document.getElementById('app'),focused=document.activeElement,oldOverflow=document.body.style.overflow,wasInert=app.inert;
  pinned=String(window.RpgFateHost?.characterId()||'');if(!pinned)return;
  overlay=document.createElement('section');overlay.className='fate-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','命運旅章');
  const close=document.createElement('button');close.className='fate-overlay-close';close.textContent='‹ 返回冒險';
  frame=document.createElement('iframe');frame.title='命運旅章與今日旅箋';frame.allow='web-share; clipboard-write';const params=new URLSearchParams();if(valid(code))params.set('result',code);if(archive)params.set('journal','1');if(autoOpen&&!archive&&!valid(code))params.set('notification','1');frame.src='/fate/'+(params.size?'?'+params:'');overlay.append(close);if(autoOpen){const hint=document.createElement('p');hint.className='fate-context-hint';hint.textContent=`目前是「${window.RpgFateHost?.characterName?.()||'這位英雄'}」的旅章。若通知提到另一角色，請先返回並從選角切換。`;overlay.append(hint);}overlay.append(frame);app.inert=true;document.body.style.overflow='hidden';document.body.append(overlay);
  exit=()=>{overlay?.remove();overlay=null;frame=null;cache.delete(pinned);app.inert=wasInert;document.body.style.overflow=oldOverflow;window.removeEventListener('message',message);document.removeEventListener('keydown',key);if(focused?.isConnected)focused.focus();window.RpgFateHost?.refresh();};
  const key=e=>{if(e.key==='Escape')exit();};
  const message=async e=>{
   if(e.origin!==location.origin||e.source!==frame?.contentWindow)return;
   const target=frame.contentWindow,character=pinned,reply=data=>{if(target===frame?.contentWindow)target.postMessage(data,location.origin)};
   if(e.data?.type==='star-fate-close'){exit();return;}
   if(String(window.RpgFateHost?.characterId())!==character){if(e.data?.type==='star-fate-rpc'&&protocol.validRpcId(e.data.id))reply({type:'star-fate-rpc-result',id:e.data.id,charId:character,error:'目前角色已改變，請返回冒險後重新開啟旅章。'});return;}
   if(e.data?.type==='star-fate-context'){reply({type:'star-fate-context-ready',charId:character,heroName:window.RpgFateHost?.characterName?.()||'',native:nativeHost.capabilities});return;}
   if(nativeModel.validNative(e.data,character)){
    const {id,action,body}=e.data;try{const value=await nativeHost.act(action,body);if(String(window.RpgFateHost?.characterId())!==character)throw Error('目前角色已改變');reply({type:'star-fate-rpc-result',id,charId:character,value});}catch(error){reply({type:'star-fate-rpc-result',id,charId:character,error:String(error.message||'分享暫時無法完成').slice(0,180)});}return;
   }
   if(!protocol.validRpc(e.data,character))return;
   const {id,action,body}=e.data;
   try{const value=await window.RpgFateHost.request(action,body);if(String(window.RpgFateHost?.characterId())!==character)throw Error('目前角色已改變');if(value?.ok===false)throw Error(value.error||value.message||'暫時無法取得旅章');reply({type:'star-fate-rpc-result',id,charId:character,value});}
   catch(error){reply({type:'star-fate-rpc-result',id,charId:character,error:protocol.friendlyError(error)});}
  };
  window.addEventListener('message',message);document.addEventListener('keydown',key);close.onclick=exit;close.focus();
 }
 window.RpgInterface.compose=(view,context)=>{
  original(view,context);if(context.tab!=='home')return;
  const id=window.RpgFateHost?.characterId();if(!id)return;
  const cycles=view.querySelector('[data-fate-cycles]'),cycleRow=cycles?.parentElement;
  const gift=document.createElement('button');gift.type='button';gift.className='my-fate-gift-button';gift.textContent='星輝匣';gift.setAttribute('aria-label','領取與開啟四世星輝匣');
  const giftNote=document.createElement('small');giftNote.className='my-fate-gift-note';giftNote.textContent='每四世 · 留一份星輝';
  const showGift=async()=>{if(String(window.RpgFateHost?.characterId())!==String(id))return;try{const module=await import('/fate/fate-gift-ui.js');if(String(window.RpgFateHost?.characterId())===String(id))module.openFateGift(window.RpgFateHost);}catch{giftNote.textContent='星輝匣暫未連上，請稍後重試';}};
  gift.onclick=showGift;if(cycleRow)cycleRow.append(giftNote,gift);
  window.RpgFateHost.openGift=()=>{if(String(window.RpgFateHost?.characterId())===String(id))return showGift();};
  const card=document.createElement('section');card.className='fate-home-card';
  const tag=document.createElement('small');tag.textContent='THE LAST STAR LANTERN';const title=document.createElement('h3');title.textContent='命運旅章';const desc=document.createElement('p');desc.textContent='如果人生能重新啟程，你會把光留給誰？';
  const actions=document.createElement('div');actions.className='fate-home-actions';const b=document.createElement('button');b.type='button';b.textContent='展開旅章  ›';b.onclick=()=>open(valid(incoming)?incoming:null);const journal=document.createElement('button');journal.type='button';journal.textContent='靈魂旅誌';journal.onclick=()=>open(null,true);actions.append(b,journal);card.append(tag,title,desc,actions);view.prepend(card);
  const current=()=>card.isConnected&&String(window.RpgFateHost.characterId())===String(id);
  state(id).then(data=>{if(!current())return;if(cycles)cycles.textContent=`輪迴 ${Number.isSafeInteger(data.completed)&&data.completed>=0?data.completed:'—'} 世`;if(!wrongCharacter(id)){if(data.active){desc.textContent='這一世仍在生長。回來看看，命運又寫下了什麼。';b.textContent='繼續此世  ›';}else if(data.completed){desc.textContent=`已承載 ${data.completed} 世記憶 · 每段人生都值得被記得`;b.textContent='翻閱旅章  ›';}}return window.RpgFateHost.request('fate/gifts/summary',{});}).then(data=>{if(!data||!current())return;giftNote.textContent=data.claimable?`可領 ${data.claimable} 匣 · 持有 ${data.unopened} 匣`:data.unopened?`持有 ${data.unopened} 匣`:`再 ${data.nextIn} 世 · 星輝成匣`;gift.classList.toggle('has-gift',data.claimable>0||data.unopened>0);}).catch(()=>{if(!current())return;if(cycles?.textContent.includes('載入'))cycles.textContent='輪迴 · 待同步';giftNote.textContent='星輝匣 · 點開同步';desc.textContent='星燈正在等你。開啟旅章後可重新連線。';});
  if(wrongCharacter(id)){desc.textContent=`這是${targetName==='另一角色'?'另一角色':'「'+targetName+'」'}的旅章，請先從選角切換至該角色。`;b.textContent='查看旅章角色提醒';journal.hidden=true;}
  if((valid(incoming)||autoOpen)&&!seen.has(String(id)+(incoming||'event'))){seen.add(String(id)+(incoming||'event'));queueMicrotask(()=>open(incoming));}
 };
})();
