/* Loopback-only adapter for the concurrently developed 9593 visual scene.
 * Chat and quests use isolated game APIs; demonstration combat grants nothing. */
(() => {
 'use strict';
 const previewConfig=window.__RpgScenePreviewConfig,liveSession=previewConfig?.live&&window.RpgSceneSession?.getSnapshot?window.RpgSceneSession:null;
 const sceneOrigin=previewConfig?.sceneOrigin||'http://127.0.0.1:9593';
 if(location.origin!==sceneOrigin||!window.RpgSceneChatUI||!window.UI)return;
 const endpoint=liveSession?previewConfig.endpoint:'http://127.0.0.1:9642/app/api/';let realm=liveSession?liveSession.getContext().realmId:'permanent',actorContext='';
 const ui=window.UI,byId=id=>document.getElementById(id);
 let actor=null,epoch=0,quests=null,questError='',catalog=null,dialog=null,kind=null,chatView=null,atlasView=null,bootFlight=null,questFlight=null,claimBusy=false,tracked=null,disposed=false,previousFocus=null;
 const savedInert=new Map(),claimRequests=new Map();let windowManager=null,navigation=null,starDestinationHandled=false,starDestinationFlight=null;
 const pretty=n=>new Intl.NumberFormat('zh-TW').format(Number(n)||0);
 async function request(action,body={},options={}){
  if(liveSession)return liveSession.request(action,body,options);
  const characterId=actor?.tgId,generation=epoch;
  let r;
  try{r=await fetch(endpoint+action,{method:'POST',mode:'cors',credentials:'omit',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'90101','X-Realm-Id':realm},body:JSON.stringify({...body,...(characterId&&action!=='me'?{selectedCharacterId:characterId}:{})}),signal:options.signal});}
  catch(cause){const e=new Error('本機遊戲服務未連線，請重新同步');e.uncertain=!['equipment-collection','equipment-collection/preview','equipment-recovery','equipment-recovery/preview','me','chat/state','atlas/quests','atlas/catalog','atlas/status','atlas/talents','atlas/talents/preview'].includes(action);e.cause=cause;throw e;}
  const data=await r.json();
  if(!r.ok||data.ok===false){const e=new Error(data.message||'資料暫時無法同步');e.status=r.status;e.code=data.error;e.uncertain=r.status>=500&&!['equipment-collection','equipment-collection/preview','equipment-recovery','equipment-recovery/preview','me','chat/state','atlas/quests','atlas/catalog','atlas/status','atlas/talents','atlas/talents/preview'].includes(action);if(data.error==='character_changed')void bootstrap();throw e;}
  if(generation!==epoch&&action!=='me'){const e=new Error('角色已切換，已忽略先前回應');e.code='context_changed';throw e;}
  return data;
 }
 const chat=window.RpgSceneChatUI.createClient({request,storage:sessionStorage},()=>{paintStrip();if(kind==='chat')chatView?.update();});
 function applyLiveSnapshot(snapshot){
  if(!liveSession)return;
  if(!snapshot){windowManager?.syncContext();navigation?.querySelectorAll('button').forEach(b=>b.disabled=true);if(kind!=='characters')close();actor=null;actorContext='';epoch++;claimBusy=false;quests=null;questFlight=null;tracked=null;catalog=null;chat.setContext(null);paintTracker();paintStrip();return;}
  const context=liveSession.getContext(),next={tgId:String(snapshot.characterId),...snapshot.character,partyId:snapshot.live.partyId};
  const signature=`${snapshot.realmId}:${snapshot.characterId}:${context.epoch}`;
  if(signature!==actorContext){if(actor&&kind!=='characters')close();actorContext=signature;epoch++;claimBusy=false;quests=null;questFlight=null;tracked=null;catalog=null;realm=snapshot.realmId;actor=next;try{tracked=JSON.parse(sessionStorage.getItem(`scene:tracked-quest:${realm}:${actor.tgId}`)||'null');}catch{}chat.setContext({realmId:realm,characterId:actor.tgId,epoch});}else actor=next;
  questError='';paintTracker();paintStrip();windowManager?.syncContext();navigation?.querySelectorAll('button').forEach(b=>b.disabled=false);windowManager?.update(snapshot);void openStarRingDestination();
 }
 async function bootstrap(){
  if(bootFlight)return bootFlight;
  const generation=epoch;
  bootFlight=(async()=>{try{
    if(liveSession){const snapshot=liveSession.getSnapshot()||await liveSession.refresh();if(!snapshot)throw Error('正在同步目前角色');applyLiveSnapshot(snapshot);}
    else{const data=await request('me'),next=data.character;if(!next)throw Error('請先在本機遊戲選擇測試角色');if(String(next.tgId)!==String(actor?.tgId)){actor=next;epoch++;quests=null;questFlight=null;tracked=null;try{tracked=JSON.parse(sessionStorage.getItem(`scene:tracked-quest:${realm}:${actor.tgId}`)||'null');}catch{}chat.setContext({realmId:realm,characterId:actor.tgId,epoch});}else actor=next;}
    questError='';await Promise.all([chat.refresh(),refreshQuests()]);
   }catch(e){if(!liveSession||generation===epoch){questError=e.message;paintTracker();paintStrip();}}finally{bootFlight=null;}})();return bootFlight;
 }
 async function refreshQuests(){if(!actor)return;if(questFlight)return questFlight;const id=actor.tgId,g=epoch;questFlight=(async()=>{try{const [q,c]=await Promise.all([request('atlas/quests'),catalog?Promise.resolve(null):request('atlas/catalog')]);if(g!==epoch||id!==actor?.tgId)return;quests=q;if(c)catalog=c.catalog;questError='';paintTracker();if(kind==='quests')paintQuests();}catch(e){if(g===epoch){questError=e.message;paintTracker();if(kind==='quests')paintQuests();}}finally{if(g===epoch)questFlight=null;}})();return questFlight;}
 function nextQuest(){const rows=quests?.quests||[];return rows.find(q=>q.id===tracked?.id&&q.periodKey===tracked?.periodKey&&!q.claimed)||rows.find(q=>q.claimable)||rows.find(q=>q.category==='tutorial'&&!q.claimed)||rows.find(q=>!q.claimed&&!q.locked&&(!q.expiresAt||q.expiresAt>quests.now));}
 function paintStrip(){const m=chat.state.messages.at(-1),line=byId('chatLine'),ch=document.querySelector('#chat .ch');if(ch)ch.textContent=m?(m.channel==='party'?'隊伍':'世界'):'聊天';if(line)line.textContent=chat.state.error?'聊天離線 · 點此重試':m?`${m.name}：${m.text}`:actor?'點此與旅人聊天':'正在連接本機遊戲…';}
 function paintTracker(){const q=nextQuest(),title=document.querySelector('#quest .qn'),count=document.querySelector('#quest .qc'),desc=document.querySelector('#quest .qd');if(title)title.textContent=q?`◆ ${q.title}`:questError?'◆ 任務尚未連線':'◆ 永久世界委託';if(count)count.textContent=q?`${pretty(q.progress)}/${pretty(q.target)}`:'';if(desc)desc.textContent=questError||(q?`${q.description}${q.claimable?' · 可領取獎勵':''}`:'查看教學與長期目標');}
 const originalToggle=ui.toggle;
 function loadRecoveryUI(){
  if(window.RpgEquipmentRecovery)return Promise.resolve(window.RpgEquipmentRecovery);
  if(window.__RpgEquipmentRecoveryLoading)return window.__RpgEquipmentRecoveryLoading;
  window.__RpgEquipmentRecoveryLoading=new Promise((resolve,reject)=>{
   const script=document.createElement('script'),base=document.querySelector('script[src*="scene-social-preview.js"]')?.src||document.baseURI;
   script.src=new URL('equipment-recovery-ui.js?v=idle-content-20261104',base).href;
   const failed=()=>{window.__RpgEquipmentRecoveryLoading=null;script.remove();reject(Error('典藏介面載入失敗，請重試'));};
   script.onload=()=>window.RpgEquipmentRecovery?resolve(window.RpgEquipmentRecovery):failed();script.onerror=failed;document.head.append(script);
  });return window.__RpgEquipmentRecoveryLoading;
 }
 function paintLegacyGearbook(body,extraHost={}){
  const selected=String(actor.tgId),version=epoch;body.replaceChildren();
  const next=document.createElement('button');next.type='button';next.className='scene-atlas-entry';next.textContent='典藏與精煉 · 首次典藏、重複回收與材料重洗';next.onclick=()=>open('recovery');
  const content=document.createElement('div');body.append(next,content);
  atlasView=window.RpgEquipmentCollection.mount(content,{...extraHost,request,characterId:selected,realmId:realm,current:()=>version===epoch&&String(actor?.tgId)===selected&&kind==='gearbook'&&body.isConnected&&(!extraHost.current||extraHost.current()),artUrl:src=>new URL(endpoint).origin+src,onChanged:()=>void bootstrap()});
 }
 async function paintRecovery(body,extraHost={}){
  const selected=String(actor.tgId),selectedRealm=realm,version=epoch;body.textContent='正在載入典藏與精煉…';
  const current=()=>version===epoch&&String(actor?.tgId)===selected&&realm===selectedRealm&&kind==='recovery'&&body.isConnected&&(!extraHost.current||extraHost.current());
  try{await loadRecoveryUI();if(!current())return;
   atlasView=window.RpgEquipmentRecovery.mount(body,{...extraHost,request,characterId:selected,realmId:selectedRealm,current,getContext:()=>liveSession?liveSession.getContext():{realmId:realm,characterId:actor?.tgId,epoch},artUrl:src=>new URL(endpoint).origin+src,onChanged:()=>void bootstrap(),onLegacy:()=>open('gearbook')});return atlasView;
  }catch(error){if(!current())return;body.textContent=error.message;const retry=document.createElement('button');retry.type='button';retry.textContent='重新載入';retry.onclick=()=>void paintRecovery(body,extraHost);body.append(retry);}
 }
 function close(){if(windowManager){windowManager.close();return;}if(!dialog)return;atlasView?.dispose();atlasView=null;dialog.remove();dialog=null;kind=null;chatView=null;for(const [el,value] of savedInert)el.inert=value;savedInert.clear();if(['chat','scene-quests','scene-talents','scene-progression','scene-gearbook','scene-recovery','scene-expedition','scene-characters','scene-equipment','scene-inventory','scene-supplies','scene-build'].includes(ui.open))ui.open=null;if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
 function open(type,params={}){
  if(windowManager)return windowManager.navigate(type,params);
  if(dialog&&kind===type){close();return;}
  close();if(ui.open)originalToggle(ui.open);
  previousFocus=document.activeElement;kind=type;
  dialog=document.createElement('section');dialog.className='scene-social-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','scene-social-title');
  dialog.innerHTML='<div class="scene-social-backdrop"></div><div class="scene-social-card" tabindex="-1"><header><h2 id="scene-social-title"></h2><button type="button" aria-label="關閉視窗">×</button></header><small class="scene-social-demo">本機測試角色 · 聊天與委託由9642遊戲服務提供；展示戰鬥不計任務或掉落。</small><div class="scene-social-body"></div></div>';
  dialog.querySelector('h2').textContent=({chat:'聊天',quests:'任務與委託',talents:'天賦星盤',progression:'冒險成長路線',gearbook:'裝備收藏冊',recovery:'典藏與精煉',expedition:'星圖派遣',characters:'選擇角色',build:'技能與輔助配置',equipment:'目前裝備',inventory:'背包',supplies:'補給'})[type];dialog.querySelector('header button').onclick=close;dialog.querySelector('.scene-social-backdrop').onclick=close;
  for(const child of byId('ui').children){savedInert.set(child,child.inert);child.inert=true;}byId('ui').append(dialog);
  ui.open=type==='chat'?'chat':'scene-'+type;const body=dialog.querySelector('.scene-social-body');
  if(liveSession)dialog.querySelector('.scene-social-demo').textContent='本機隔離測試 · 場景與功能使用同一角色；戰況顯示已結算資料。';
  if(type==='characters'&&liveSession){void paintCharacters(body);}
  else if(liveSession&&['equipment','inventory','supplies'].includes(type)){void paintRealInventory(body,type);}
  else if(type==='chat'){chatView=window.RpgSceneChatUI.mountPanel(body,chat);void bootstrap();void chat.refresh();}
  else if(type==='quests'){paintQuests();void bootstrap();void refreshQuests();}
  else{body.textContent='正在讀取本機角色…';void bootstrap().then(()=>{
   if(!actor||kind!==type||!dialog||!body.isConnected)return;
   if(type==='gearbook')paintLegacyGearbook(body);
   else if(type==='recovery')void paintRecovery(body);
   else atlasView=window.RpgSceneAtlasGuide.mount(body,{request,actor:{...actor},getActor:()=>actor,realmId:realm,getContext:()=>liveSession?liveSession.getContext():{realmId:realm,epoch}},type);
  });}
  dialog.querySelector('.scene-social-card').focus({preventScroll:true});
 }
 ui.toggle=function(id){if(windowManager){const aliases={eq:'equipment',inv:'inventory',sup:'supplies',sk:'build',map:'expedition','scene-characters':'characters',social:'chat',supply:'supplies'};const route=aliases[id]||(unifiedRoutes[id]?id:null);if(route){if(windowManager.current()?.route===route)close();else open(route);return;}}if(liveSession&&['eq','inv','sup','sk','map'].includes(id)){open(({eq:'equipment',inv:'inventory',sup:'supplies',sk:'build',map:'expedition'})[id]);return;}if(liveSession&&id==='scene-characters'){open('characters');return;}if(['talents','progression','gearbook','recovery','expedition'].includes(id)){open(id);return;}if(id==='chat'){open('chat');return;}if(dialog)close();const result=originalToggle(id);if(['sk','map','eq','inv'].includes(id)){const panel=byId('p-'+id),target=panel?.querySelector('.pb')||panel;if(target&&!target.querySelector('[data-live-atlas-entry]')){const entry=document.createElement('button');entry.type='button';entry.dataset.liveAtlasEntry=id==='sk'?'talents':id==='map'?'progression':'gearbook';entry.className='scene-atlas-entry';entry.textContent=id==='sk'?'✧ 天賦星盤 · 路線預覽與引導':id==='map'?'✦ 冒險成長路線 · 通關與鍛造':'✦ 裝備收藏冊 · 集滿獲得永久能力';entry.onclick=()=>open(entry.dataset.liveAtlasEntry);target.prepend(entry);}}return result;};
 // Keep demonstration boss pacing, but remove its fake 40-kill quest counter.
 ui.addKill=function(){if(!liveSession)ui.kills=(ui.kills||0)+1;};
 const quest=byId('quest');quest.setAttribute('role','button');quest.tabIndex=0;quest.setAttribute('aria-label','開啟真實任務與委託');quest.addEventListener('pointerdown',e=>{e.preventDefault();e.stopImmediatePropagation();open('quests');},true);quest.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open('quests');}});
 async function paintRealInventory(body,type){if(windowManager)windowManager.navigate(type);else body.textContent='請重新整理以載入共用背包介面。';}
 async function paintCharacters(body,extraHost={}){
  body.textContent='正在讀取角色…';
  const scope=liveSession.getContext();
  try{
   const data=await request('characters');
   if(kind!=='characters'||!body.isConnected||(extraHost.current&&!extraHost.current())||scope.realmId!==liveSession.getContext().realmId||scope.accountId!==liveSession.getContext().accountId)return;
   body.replaceChildren();
   for(const character of data.characters||[]){const button=document.createElement('button');button.type='button';button.className='scene-atlas-entry';button.textContent=`${character.active?'目前角色 · ':''}${character.name} · Lv.${character.level} · ${({sword:'劍士',archer:'妖精',mage:'法師',thief:'盜賊'})[character.baseClass]||character.baseClass}`;button.disabled=!!character.active;button.onclick=async()=>{for(const b of body.querySelectorAll('button'))b.disabled=true;try{await liveSession.selectCharacter(character.charId);await bootstrap();if(kind==='characters'&&(!extraHost.current||extraHost.current()))close();}catch(error){if(kind==='characters'&&body.isConnected&&(!extraHost.current||extraHost.current())){const note=document.createElement('p');note.setAttribute('role','alert');note.textContent=error.message;body.append(note);const retry=document.createElement('button');retry.type='button';retry.textContent='重新讀取角色';retry.onclick=()=>void paintCharacters(body,extraHost);body.append(retry);}}};body.append(button);}
   if(!data.characters?.length)body.textContent='目前世界尚未建立角色。';
  }catch(error){if(kind==='characters'&&body.isConnected&&(!extraHost.current||extraHost.current()))body.textContent=error.message;}
 }
 function rewardText(q){return Object.entries(q.rewards?.materials||{}).map(([id,n])=>`${catalog?.materials?.find?.(m=>m.id===id)?.name||({atlas_shard:'星圖碎片',atlas_iron:'星鐵',atlas_ember:'餘燼',atlas_venom:'幽毒',atlas_core:'守望核心'})[id]||id} ×${pretty(n)}`).join(' · ');}
 const questGroupsOpen = new Map();
 function paintQuests(){
  if(kind!=='quests'||!dialog)return;const body=dialog.querySelector('.scene-social-body'),scroll=body.scrollTop;body.replaceChildren();
  const top=document.createElement('div');top.className='scene-live-quest-top';const note=document.createElement('p');
  note.textContent=questError||(!quests?'正在讀取任務…':quests.enabled===false?'永久世界委託尚未開放':`目前角色：${actor?.name||'—'} · 可領取 ${quests.quests.filter(q=>q.claimable).length} 項 · 活動依實際台北時間累積`);
  const sync=document.createElement('button');sync.type='button';sync.textContent='重新同步';sync.onclick=()=>{void bootstrap();};top.append(note,sync);body.append(top);
  const all=quests?.quests||[],current=q=>!['daily','weekly'].includes(q.category)||q.periodKey===all.filter(row=>row.id===q.id).map(row=>row.periodKey).sort().at(-1);
  const rows=all.filter(q=>(q.claimable||!q.expiresAt||q.expiresAt>quests.now)&&(current(q)||q.progress>0||q.claimed));
  const amount=(q,n)=>q.unit==='秒'?(n<60?pretty(n)+'秒':pretty(Math.floor(n/60))+'分'+(n%60?' '+pretty(n%60)+'秒':'')):pretty(n);
  for(const [category,label]of [['tutorial','冒險引導'],['investigation','地區調查鏈'],['daily','每日活動'],['weekly','每週目標'],['longterm','長期踏查']]){
   const list=rows.filter(q=>q.category===category);if(!list.length)continue;
   const section=document.createElement('details'),heading=document.createElement('summary'),ready=list.filter(q=>q.claimable).length;
   section.open=questGroupsOpen.has(category)?questGroupsOpen.get(category):['daily','investigation'].includes(category)||ready>0||category==='tutorial'&&list.some(q=>!q.claimed);
   section.addEventListener('toggle',()=>{if(section.isConnected)questGroupsOpen.set(category,section.open);});
   heading.textContent=label+' · '+list.length+' 項'+(ready?' · '+ready+' 項可領取':'');section.append(heading);body.append(section);
   for(const q of list){
    const card=document.createElement('article');card.className='scene-live-quest'+(q.claimed?' is-claimed':'');
    const title=document.createElement('h4');title.textContent=q.title;
    const desc=document.createElement('p');desc.textContent=q.description;
    const progress=document.createElement('progress');progress.max=q.target;progress.value=Math.min(q.target,q.progress);progress.setAttribute('aria-label',q.title+'進度');
    const count=document.createElement('span');count.textContent=amount(q,q.progress)+' / '+amount(q,q.target)+(q.unit==='秒'?'':' '+(q.unit||''))+(q.periodKey==='lifetime'?'':' · '+q.periodKey);
    const reward=document.createElement('small');reward.textContent='獎勵：'+rewardText(q);
    const actions=document.createElement('div'),track=document.createElement('button');track.type='button';track.textContent=tracked?.id===q.id&&tracked?.periodKey===q.periodKey?'追蹤中':'追蹤任務';track.disabled=q.claimed||q.locked;
    track.onclick=()=>{tracked={id:q.id,periodKey:q.periodKey};sessionStorage.setItem(`scene:tracked-quest:${realm}:${actor.tgId}`,JSON.stringify(tracked));paintTracker();paintQuests();};
    const claim=document.createElement('button');claim.type='button';claim.textContent=q.claimed?'已領取':q.locked?'等待前一步':q.claimable?'領取獎勵':'尚未完成';claim.disabled=claimBusy||!q.claimable;claim.onclick=()=>claimQuest(q);if(q.action==='recovery'&&!q.claimed&&!q.locked){const go=document.createElement('button');go.type='button';go.textContent='前往典藏與精煉';go.onclick=()=>open('recovery');actions.append(go);}actions.append(track,claim);
    card.append(title,desc);if(q.lockedReason){const lock=document.createElement('p');lock.textContent=q.lockedReason;card.append(lock);}card.append(progress,count,reward,actions);section.append(card);
   }
  }
  body.scrollTop=scroll;
 }
 async function claimQuest(q){
  if(claimBusy||!actor)return;
  const generation=epoch,claimRealm=realm,characterId=String(actor.tgId),current=()=>generation===epoch&&realm===claimRealm&&String(actor?.tgId)===characterId;
  const claimKey=`${claimRealm}:${characterId}:${q.id}:${q.periodKey}`;
  if(!claimRequests.has(claimKey))claimRequests.set(claimKey,crypto.randomUUID());
  claimBusy=true;paintQuests();
  try{const data=await request('atlas/quests/claim',{questId:q.id,periodKey:q.periodKey,requestId:claimRequests.get(claimKey)});if(!current())return;quests=data;claimRequests.delete(claimKey);questError='';paintTracker();}
  catch(error){if(current()){questError=error.message;if(!error.uncertain&&error.status>=400&&error.status<500)claimRequests.delete(claimKey);}}
  finally{if(current()){claimBusy=false;paintQuests();}}
 }

 document.addEventListener('keydown',e=>{if(windowManager||!dialog)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return;}if(e.key==='Tab'){const items=[...dialog.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(el=>el.tabIndex>=0&&!el.disabled&&el.getClientRects().length),first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||!items.includes(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}},true);
 const poll=setInterval(()=>{if(document.hidden||disposed)return;if(kind==='chat')void chat.refresh();else if(Date.now()-(chat.state.syncedAt||0)>=30000)void chat.refresh();},5000);
 const questPoll=setInterval(()=>{if(!document.hidden&&!disposed)void bootstrap();},30000);
 window.addEventListener('pagehide',()=>{disposed=true;clearInterval(poll);clearInterval(questPoll);windowManager?.dispose();chat.dispose();},{once:true});

 const unifiedRoutes={
  character:{title:'角色',group:'character'},ledger:{title:'帳務紀錄',group:'character'},'direct-trade':{title:'雙方交易',group:'camp'},exchange:{title:'旅人交易所',group:'camp'},equipment:{title:'目前裝備',group:'character'},item:{title:'裝備詳情',group:'inventory'},
  inventory:{title:'背包',group:'inventory'},adventure:{title:'冒險',group:'adventure'},camp:{title:'營地',group:'camp'},
  chat:{title:'聊天與社交',group:'social'},quests:{title:'任務與委託',group:'adventure'},characters:{title:'選擇角色',group:'character'},
  talents:{title:'天賦星盤',group:'character'},progression:{title:'冒險成長路線',group:'adventure'},build:{title:'技能與輔助配置',group:'character'},
  skills:{title:'職業技能',group:'character'},career:{title:'轉職與進修',group:'character'},party:{title:'組隊副本',group:'adventure'},tower:{title:'三人爬塔',group:'adventure'},'tower-imprint':{title:'塔印工坊',group:'camp'},boss:{title:'世界首領',group:'adventure'},'boss-essence':{title:'首領精華',group:'camp'},'star-ring':{title:'星環遠征',group:'adventure'},'star-ring-shop':{title:'星征補給與星紋',group:'camp'},guardian:{title:'守護天使',group:'character'},'guardian-summon':{title:'天使召喚與補給',group:'camp'},fate:{title:'命運旅章',group:'adventure'},'fate-gifts':{title:'四世星輝匣',group:'camp'},
  'live-status':{title:'出征狀態',group:'adventure'},expedition:{title:'星圖派遣',group:'adventure'},workshop:{title:'強化與洗鍊工坊',group:'camp'},inscription:{title:'定向銘刻工坊',group:'camp'},
  supplies:{title:'補給設定',group:'camp'},shop:{title:'商店',group:'camp'},gearbook:{title:'裝備收藏冊',group:'camp'},recovery:{title:'典藏與精煉',group:'camp'}
 };
 const moduleFlights=new Map();
 async function loadSceneModule(file,name){
  if(window[name])return window[name];if(moduleFlights.has(file))return moduleFlights.get(file);
  const promise=new Promise((resolve,reject)=>{
   const script=document.createElement('script'),base=document.querySelector('script[src*="scene-social-preview.js"]')?.src||document.baseURI;
   script.src=new URL(file+'.js?v='+(file.startsWith('scene-direct-trade-')?'direct-trade-20261106':file.startsWith('scene-exchange-')?'exchange-actions-20261106':'angel-20261105'),base).href;
   script.onload=()=>window[name]?resolve(window[name]):failed();script.onerror=failed;
   function failed(){moduleFlights.delete(file);script.remove();reject(Error('功能介面載入失敗，請重試'));}
   document.head.append(script);
  });moduleFlights.set(file,promise);return promise;
 }
 // URL invitations are read intent only. Actor selection and the explicit confirmation
 // in the Star Ring window are the only paths to a scoped membership write.
 function starDestinationInputs(){
  const inputs=[{search:location.search,start:window.Telegram?.WebApp?.initDataUnsafe?.start_param||''}];
  try{if(window.parent!==window&&window.parent.location.origin===location.origin)inputs.push({search:window.parent.location.search,start:window.parent.Telegram?.WebApp?.initDataUnsafe?.start_param||''});}catch{}
  return inputs;
 }
 function openStarRingDestination(){
  if(!actor||!liveSession||!windowManager||disposed||starDestinationHandled||starDestinationFlight)return;
  const inputs=starDestinationInputs();if(!inputs.some(x=>/ringParty=|(?:screen|tgWebAppStartParam)=ring_/.test(x.search)||/^ring_/.test(x.start))){starDestinationHandled=true;return;}
  const captured=liveSession.getContext(),navigationBefore=JSON.stringify(windowManager.current()),same=()=>{const n=liveSession.getContext();return ['accountId','realmId','characterId','epoch'].every(k=>String(n[k])===String(captured[k]));};
  starDestinationFlight=loadSceneModule('scene-star-ring-ui','RpgSceneStarRing').then(module=>{
   if(disposed||!actor||!same())return;
   const destination=inputs.map(x=>module.parseDestination(x.search,x.start)).find(Boolean);starDestinationHandled=true;
   if(destination&&JSON.stringify(windowManager.current())===navigationBefore)windowManager.navigate('star-ring',destination);
  }).catch(()=>{}).finally(()=>{starDestinationFlight=null;if(!disposed&&!starDestinationHandled&&!same())void openStarRingDestination();});
 }
 function unifiedHost(api,entry){
  const context=liveSession.getContext(),sameScope=()=>{const next=liveSession.getContext();return context.accountId===next.accountId&&context.realmId===next.realmId&&context.characterId===next.characterId&&context.epoch===next.epoch;};
  return {...api,request,getContext:()=>liveSession.getContext(),getActor:()=>actor,actor:{...actor},realmId:realm,characterId:String(actor.tgId),params:entry.params,
   artUrl:src=>new URL(src,new URL(endpoint).origin).href,onChanged:()=>{if(sameScope())void refreshQuests();},
   mapId:entry.params.mapId,initialItemId:entry.params.itemId
  };
 }
 function paintHub(body,route,host){
  body.replaceChildren();const context=document.createElement('article');context.className='scene-hub-summary';
  const name=document.createElement('h3'),detail=document.createElement('p');name.textContent=actor.name+' · Lv.'+actor.level;
  const run=liveSession.getSnapshot()?.run;detail.textContent=route==='adventure'?(run?.active?'目前正在探索；切換功能仍會繼續推進。':'選擇星圖，準備補給後開始探索。'):route==='camp'?'整理戰利品、調整裝備與補足下趟物資。':'查看穿戴與能力，配置下趟探索的技能和天賦。';
  context.append(name,detail);body.append(context);
  const entries=route==='character'?[
   ['equipment','穿戴與能力','查看裝備、比較與穿脫'],['inventory','持有裝備','開啟共用詳情與整理'],['star-ring-shop','星紋衣櫥','查看專屬外觀、購買與穿戴',{tab:'cosmetics'}],['ledger','帳務紀錄','查看已入帳的金幣、道具與經驗變動'],['skills','職業技能','學習、裝備與自動施法'],['career','轉職與進修','職業分支、條件與進修'],['guardian','守護天使','永久守護、參戰、融合與背景召喚'],['build','星圖技能','主技能、輔助與自動策略'],['talents','天賦星盤','預覽路線與配置節點'],['progression','成長路線','查看可達成的下一個目標'],['characters','切換角色','沿用目前世界']
  ]:route==='adventure'?[
   ['expedition',run?.active?'目前探索':'星圖派遣',run?.active?'戰況、補給與返營':'選圖、時間與攜帶補給'],['live-status','出征狀態','已結算進度、敵人與事件紀錄'],['quests','任務與委託','教學、每日、每週與調查鏈'],['party','組隊副本','三人副本、試煉與戰術'],['tower','三人爬塔','三區挑戰、隊友戰術與徽記'],['boss','世界首領','目前戰況、攻擊資格與已提交戰果'],['star-ring','星環遠征','五人招募、十二小時背景遠征與歷史戰報'],['fate','命運旅章','一世的選擇、原故事與靈魂旅誌'],['progression','成長路線','地區解鎖與長期進度'],['supplies','準備補給','背包與本趟預留分開查看']
  ]:[
   ['direct-trade','雙方交易','查看雙方報價、原始收據與安全確認操作'],
   ['exchange','旅人交易所','上架珍藏、購買寶物與核對原交易紀錄'],['workshop','強化與洗鍊','單次操作、自動作業與結果'],['tower-imprint','塔印工坊','裝備淬鍊、徽記兌換與稱號'],['boss-essence','首領精華','卷軸、遺物與舊材料回收'],['star-ring-shop','星征補給與星紋','徽記兌換、星冕核心與專屬外觀'],['guardian-summon','天使召喚與補給','普通與精選召喚、天使石與原操作紀錄'],['fate-gifts','四世星輝匣','四世贈禮、指定開匣與原結果'],['recovery','典藏與精煉','首件典藏、重複精煉、材料重洗'],['gearbook','裝備收藏冊','完成原有套組與永久能力'],['inscription','星圖銘刻','使用探索材料定向加工'],['shop','商店','藥水、卷軸、裝備與寶箱'],['supplies','補給設定','原版藥水設定與補滿']
  ];
  const grid=document.createElement('div');grid.className='scene-hub-grid';
  for(const [target,title,description,params]of entries){const button=document.createElement('button');button.type='button';button.dataset.sceneRoute=target;const strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=title;small.textContent=description;button.append(strong,small);button.onclick=()=>host.navigate(target,params);grid.append(button);}
  body.append(grid);return {dispose(){}};
 }
 async function mountUnified(entry,body,api){
  if(!actor)await bootstrap();if(!api.current()||!actor)return;
  const host=unifiedHost(api,entry);
  if(entry.route==='live-status')return window.RpgSceneLiveView.mountStatus(body,host);
   if(entry.route==='ledger'){const module=await loadSceneModule('scene-ledger-ui','RpgSceneLedger');if(api.current())return module.mount(body,host);return;}
  if(entry.route==='direct-trade'){await loadSceneModule('scene-direct-trade-client','RpgSceneDirectTradeActions');if(!api.current())return;await loadSceneModule('scene-direct-trade-invitation-client','RpgSceneDirectTradeInvitations');if(!api.current())return;const module=await loadSceneModule('scene-direct-trade-ui','RpgSceneDirectTrade');if(api.current())return module.mount(body,host);return;}
   if(entry.route==='exchange'){await loadSceneModule('scene-exchange-client','RpgSceneExchangeActions');if(!api.current())return;const module=await loadSceneModule('scene-exchange-ui','RpgSceneExchange');if(api.current())return module.mount(body,host);return;}
  if(['character','adventure','camp'].includes(entry.route))return paintHub(body,entry.route,host);
  if(['equipment','inventory','item'].includes(entry.route)){const module=await loadSceneModule('scene-inventory-ui','RpgSceneInventory');if(api.current())return module.mount(body,host,{mode:entry.route,itemId:entry.params.itemId});return;}
  if(['skills','career'].includes(entry.route)){const module=await loadSceneModule('scene-skills-ui','RpgSceneSkills');if(api.current())return module.mount(body,host,{tab:entry.route});return;}
  if(entry.route==='party'||entry.route==='tower'){const module=await loadSceneModule('scene-party-ui','RpgSceneParty');if(api.current())return module.mount(body,host,{...entry.params,kind:entry.route==='tower'?'tower':'dungeon',...(entry.route==='tower'?{tab:entry.params.tab||'areas'}:{})});return;}
  if(entry.route==='tower-imprint'){const module=await loadSceneModule('scene-tower-ui','RpgSceneTower');if(api.current())return module.mount(body,host,entry.params);return;}
  if(['boss','boss-essence'].includes(entry.route)){const module=await loadSceneModule('scene-boss-ui','RpgSceneBoss');if(api.current())return module.mount(body,host,{...entry.params,tab:entry.params.tab||(entry.route==='boss-essence'?'exchange':'battle')});return;}
  if(['star-ring','star-ring-shop'].includes(entry.route)){const module=await loadSceneModule('scene-star-ring-ui','RpgSceneStarRing');if(api.current())return module.mount(body,host,{...entry.params,tab:entry.params.tab||(entry.route==='star-ring-shop'?'shop':'current')});return;}
  if(['guardian','guardian-summon'].includes(entry.route)){const module=await loadSceneModule('scene-guardian-ui','RpgSceneGuardian');if(api.current())return module.mount(body,host,{...entry.params,tab:entry.params.tab||(entry.route==='guardian-summon'?'summon':'overview')});return;}
  if(['fate','fate-gifts'].includes(entry.route)){const module=await loadSceneModule('scene-fate-ui','RpgSceneFate');if(api.current())return module.mount(body,host,{...entry.params,tab:entry.params.tab||(entry.route==='fate-gifts'?'gifts':'overview')});return;}
  if(entry.route==='workshop'){const module=await loadSceneModule('scene-workshop-ui','RpgSceneWorkshop');if(api.current())return module.mount(body,host,entry.params);return;}
  if(['supplies','shop'].includes(entry.route)){const module=await loadSceneModule('scene-supply-ui','RpgSceneSupply');if(api.current())return module.mount(body,host,{tab:entry.route});return;}
  if(entry.route==='chat'){const shortcuts=document.createElement('div');shortcuts.className='scene-social-shortcuts';const partyButton=document.createElement('button');partyButton.type='button';partyButton.dataset.sceneRoute='party';partyButton.textContent='我的隊伍';partyButton.style.minHeight='44px';partyButton.onclick=()=>host.navigate('party',{tab:'current'});shortcuts.append(partyButton);const chatBody=document.createElement('div');body.replaceChildren(shortcuts,chatBody);chatView=window.RpgSceneChatUI.mountPanel(chatBody,chat);void chat.refresh();return chatView;}
  if(entry.route==='quests'){paintQuests();void refreshQuests();return {dispose(){}};}
  if(entry.route==='characters'){await paintCharacters(body,host);return {dispose(){}};}
  if(entry.route==='gearbook'){paintLegacyGearbook(body,host);return atlasView;}
  if(entry.route==='recovery')return await paintRecovery(body,host);
  const initial=entry.route==='inscription'?'workshop':entry.route;
  atlasView=window.RpgSceneAtlasGuide.mount(body,host,initial);return atlasView;
 }
 function installUnifiedShell(){
  navigation=document.createElement('nav');navigation.className='scene-primary-nav';navigation.setAttribute('aria-label','主要功能');
  const roots={character:'character',inventory:'inventory',adventure:'adventure',camp:'camp',social:'chat'};
  for(const [group,label]of [['character','角色'],['inventory','背包'],['adventure','冒險'],['camp','營地'],['social','社交']]){
   const button=document.createElement('button');button.type='button';button.dataset.scenePrimary=group;button.textContent=label;button.disabled=!actor;button.onclick=()=>windowManager.navigate(roots[group],{},{reset:true});navigation.append(button);
  }
  byId('ui').classList.add('scene-unified-root');byId('ui').append(navigation);
  windowManager=window.RpgSceneWindows.create({root:byId('ui'),navigation,routes:unifiedRoutes,getContext:()=>liveSession.getContext(),
   contextLabel:()=>actor?actor.name+' · '+(realm==='permanent'?'永久世界':'賽季世界')+' · Lv.'+actor.level:'正在同步角色…',
   mount:mountUnified,
   onNavigate(entry,node){dialog=node;kind=entry.route;ui.open='scene-'+entry.route;chatView=null;atlasView=null;},
   onClose(){dialog=null;kind=null;chatView=null;atlasView=null;ui.open=null;}
  });
  queueMicrotask(()=>window.dispatchEvent(new Event('resize')));
  window.RpgSceneNavigation={navigate:(route,params)=>windowManager.navigate(route,params),back:()=>windowManager.back(),close:()=>windowManager.close(),current:()=>windowManager.current()};
 }

 if(liveSession&&window.RpgSceneWindows)installUnifiedShell();
 if(liveSession)liveSession.subscribe(applyLiveSnapshot);
 paintStrip();paintTracker();void bootstrap();
})();
