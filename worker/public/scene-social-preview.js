/* Loopback-only adapter for the concurrently developed 9593 visual scene.
 * Chat and quests use isolated game APIs; demonstration combat grants nothing. */
(() => {
 'use strict';
 if(location.origin!=='http://127.0.0.1:9593'||!window.RpgSceneChatUI||!window.UI)return;
 const endpoint='http://127.0.0.1:9642/app/api/',realm='permanent';
 const ui=window.UI,byId=id=>document.getElementById(id);
 let actor=null,epoch=0,quests=null,questError='',catalog=null,dialog=null,kind=null,chatView=null,bootFlight=null,questFlight=null,claimBusy=false,tracked=null,disposed=false,previousFocus=null;
 const savedInert=new Map(),claimRequests=new Map();
 const pretty=n=>new Intl.NumberFormat('zh-TW').format(Number(n)||0);
 async function request(action,body={},options={}){
  const characterId=actor?.tgId,generation=epoch;
  let r;
  try{r=await fetch(endpoint+action,{method:'POST',mode:'cors',credentials:'omit',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'90101','X-Realm-Id':realm},body:JSON.stringify({...body,...(characterId&&action!=='me'?{selectedCharacterId:characterId}:{})}),signal:options.signal});}
  catch(cause){const e=new Error('本機遊戲服務未連線，請重新同步');e.uncertain=!['me','chat/state','atlas/quests','atlas/catalog'].includes(action);e.cause=cause;throw e;}
  const data=await r.json();
  if(!r.ok||data.ok===false){const e=new Error(data.message||'資料暫時無法同步');e.status=r.status;e.code=data.error;e.uncertain=r.status>=500&&!['me','chat/state','atlas/quests','atlas/catalog'].includes(action);if(data.error==='character_changed')void bootstrap();throw e;}
  if(generation!==epoch&&action!=='me'){const e=new Error('角色已切換，已忽略先前回應');e.code='context_changed';throw e;}
  return data;
 }
 const chat=window.RpgSceneChatUI.createClient({request,storage:sessionStorage},()=>{paintStrip();if(kind==='chat')chatView?.update();});
 async function bootstrap(){
  if(bootFlight)return bootFlight;
  bootFlight=(async()=>{try{const data=await request('me'),next=data.character;if(!next)throw Error('請先在本機9642遊戲選擇測試角色');if(String(next.tgId)!==String(actor?.tgId)){actor=next;epoch++;quests=null;questFlight=null;tracked=null;try{tracked=JSON.parse(sessionStorage.getItem(`scene:tracked-quest:${realm}:${actor.tgId}`)||'null');}catch{}chat.setContext({realmId:realm,characterId:actor.tgId,epoch});}else actor=next;
    questError='';await Promise.all([chat.refresh(),refreshQuests()]);
   }catch(e){questError=e.message;paintTracker();paintStrip();}finally{bootFlight=null;}})();return bootFlight;
 }
 async function refreshQuests(){if(!actor)return;if(questFlight)return questFlight;const id=actor.tgId,g=epoch;questFlight=(async()=>{try{const [q,c]=await Promise.all([request('atlas/quests'),catalog?Promise.resolve(null):request('atlas/catalog')]);if(g!==epoch||id!==actor?.tgId)return;quests=q;if(c)catalog=c.catalog;questError='';paintTracker();if(kind==='quests')paintQuests();}catch(e){if(g===epoch){questError=e.message;paintTracker();if(kind==='quests')paintQuests();}}finally{if(g===epoch)questFlight=null;}})();return questFlight;}
 function nextQuest(){const rows=quests?.quests||[];return rows.find(q=>q.id===tracked?.id&&q.periodKey===tracked?.periodKey&&!q.claimed)||rows.find(q=>q.claimable)||rows.find(q=>q.category==='tutorial'&&!q.claimed)||rows.find(q=>!q.claimed&&(!q.expiresAt||q.expiresAt>quests.now));}
 function paintStrip(){const m=chat.state.messages.at(-1),line=byId('chatLine'),ch=document.querySelector('#chat .ch');if(ch)ch.textContent=m?(m.channel==='party'?'隊伍':'世界'):'聊天';if(line)line.textContent=chat.state.error?'聊天離線 · 點此重試':m?`${m.name}：${m.text}`:actor?'點此與旅人聊天':'正在連接本機遊戲…';}
 function paintTracker(){const q=nextQuest(),title=document.querySelector('#quest .qn'),count=document.querySelector('#quest .qc'),desc=document.querySelector('#quest .qd');if(title)title.textContent=q?`◆ ${q.title}`:questError?'◆ 任務尚未連線':'◆ 永久世界委託';if(count)count.textContent=q?`${pretty(q.progress)}/${pretty(q.target)}`:'';if(desc)desc.textContent=questError||(q?`${q.description}${q.claimable?' · 可領取獎勵':''}`:'查看教學與長期目標');}
 const originalToggle=ui.toggle;
 function close(){if(!dialog)return;dialog.remove();dialog=null;kind=null;chatView=null;for(const [el,value] of savedInert)el.inert=value;savedInert.clear();if(ui.open==='chat'||ui.open==='scene-quests')ui.open=null;if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
 function open(type){
  if(dialog&&kind===type){close();return;}
  close();if(ui.open)originalToggle(ui.open);
  previousFocus=document.activeElement;kind=type;
  dialog=document.createElement('section');dialog.className='scene-social-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','scene-social-title');
  dialog.innerHTML='<div class="scene-social-backdrop"></div><div class="scene-social-card" tabindex="-1"><header><h2 id="scene-social-title"></h2><button type="button" aria-label="關閉視窗">×</button></header><small class="scene-social-demo">本機測試角色 · 聊天與委託由9642遊戲服務提供；展示戰鬥不計任務或掉落。</small><div class="scene-social-body"></div></div>';
  dialog.querySelector('h2').textContent=type==='chat'?'聊天':'任務與委託';dialog.querySelector('header button').onclick=close;dialog.querySelector('.scene-social-backdrop').onclick=close;
  for(const child of byId('ui').children){savedInert.set(child,child.inert);child.inert=true;}byId('ui').append(dialog);
  ui.open=type==='chat'?'chat':'scene-quests';const body=dialog.querySelector('.scene-social-body');
  if(type==='chat'){chatView=window.RpgSceneChatUI.mountPanel(body,chat);void bootstrap();void chat.refresh();}else{paintQuests();void bootstrap();void refreshQuests();}
  dialog.querySelector('.scene-social-card').focus({preventScroll:true});
 }
 ui.toggle=function(id){if(id==='chat'){open('chat');return;}if(dialog)close();return originalToggle(id);};
 // Keep demonstration boss pacing, but remove its fake 40-kill quest counter.
 ui.addKill=function(){ui.kills=(ui.kills||0)+1;};
 const quest=byId('quest');quest.setAttribute('role','button');quest.tabIndex=0;quest.setAttribute('aria-label','開啟真實任務與委託');quest.addEventListener('pointerdown',e=>{e.preventDefault();e.stopImmediatePropagation();open('quests');},true);quest.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open('quests');}});
 function rewardText(q){return Object.entries(q.rewards?.materials||{}).map(([id,n])=>`${catalog?.materials?.find?.(m=>m.id===id)?.name||({atlas_shard:'星圖碎片',atlas_iron:'星鐵',atlas_ember:'餘燼',atlas_venom:'幽毒',atlas_core:'守望核心'})[id]||id} ×${pretty(n)}`).join(' · ');}
 function paintQuests(){
  if(kind!=='quests'||!dialog)return;const body=dialog.querySelector('.scene-social-body'),scroll=body.scrollTop;body.replaceChildren();
  const top=document.createElement('div');top.className='scene-live-quest-top';const note=document.createElement('p');note.textContent=questError||(!quests?'正在讀取任務…':`目前角色：${actor?.name||'—'} · 已完成可領取 ${quests.quests.filter(q=>q.claimable).length} 項`);const sync=document.createElement('button');sync.type='button';sync.textContent='重新同步';sync.onclick=()=>{void bootstrap();};top.append(note,sync);body.append(top);
  const rows=(quests?.quests||[]).filter(q=>q.claimable||!q.expiresAt||q.expiresAt>quests.now);
  for(const category of ['tutorial','daily','weekly','longterm']){const list=rows.filter(q=>q.category===category);if(!list.length)continue;const h=document.createElement('h3');h.textContent=({tutorial:'冒險引導',daily:'每日委託',weekly:'每週目標',longterm:'長期踏查'})[category];body.append(h);for(const q of list){const card=document.createElement('article');card.className='scene-live-quest'+(q.claimed?' is-claimed':'');const title=document.createElement('h4');title.textContent=q.title;const desc=document.createElement('p');desc.textContent=q.description;const progress=document.createElement('progress');progress.max=q.target;progress.value=Math.min(q.target,q.progress);progress.setAttribute('aria-label',q.title+'進度');const count=document.createElement('span');count.textContent=`${pretty(q.progress)} / ${pretty(q.target)} ${q.unit||''}${q.periodKey==='lifetime'?'':` · ${q.periodKey}`}`;const reward=document.createElement('small');reward.textContent='獎勵：'+rewardText(q);const actions=document.createElement('div');const track=document.createElement('button');track.type='button';track.textContent=tracked?.id===q.id&&tracked?.periodKey===q.periodKey?'追蹤中':'追蹤任務';track.disabled=q.claimed;track.onclick=()=>{tracked={id:q.id,periodKey:q.periodKey};sessionStorage.setItem(`scene:tracked-quest:${realm}:${actor.tgId}`,JSON.stringify(tracked));paintTracker();paintQuests();};const claim=document.createElement('button');claim.type='button';claim.textContent=q.claimed?'已領取':q.claimable?'領取獎勵':'尚未完成';claim.disabled=claimBusy||!q.claimable;claim.onclick=()=>claimQuest(q);actions.append(track,claim);card.append(title,desc,progress,count,reward,actions);body.append(card);}}
  body.scrollTop=scroll;
 }
 async function claimQuest(q){if(claimBusy)return;const claimKey=`${realm}:${actor?.tgId}:${q.id}:${q.periodKey}`;if(!claimRequests.has(claimKey))claimRequests.set(claimKey,crypto.randomUUID());claimBusy=true;paintQuests();try{const data=await request('atlas/quests/claim',{questId:q.id,periodKey:q.periodKey,requestId:claimRequests.get(claimKey)});quests=data;claimRequests.delete(claimKey);questError='';paintTracker();}catch(e){questError=e.message;if(!e.uncertain&&e.status>=400&&e.status<500)claimRequests.delete(claimKey);}finally{claimBusy=false;paintQuests();}}
 document.addEventListener('keydown',e=>{if(!dialog)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return;}if(e.key==='Tab'){const items=[...dialog.querySelectorAll('button:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length),first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||!items.includes(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}},true);
 const poll=setInterval(()=>{if(document.hidden||disposed)return;if(kind==='chat')void chat.refresh();else if(Date.now()-(chat.state.syncedAt||0)>=30000)void chat.refresh();},5000);
 const questPoll=setInterval(()=>{if(!document.hidden&&!disposed)void bootstrap();},30000);
 window.addEventListener('pagehide',()=>{disposed=true;clearInterval(poll);clearInterval(questPoll);chat.dispose();},{once:true});
 paintStrip();paintTracker();void bootstrap();
})();
