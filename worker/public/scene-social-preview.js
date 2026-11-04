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
 const savedInert=new Map(),claimRequests=new Map();let itemMetadata=null;
 const pretty=n=>new Intl.NumberFormat('zh-TW').format(Number(n)||0);
 async function request(action,body={},options={}){
  if(liveSession)return liveSession.request(action,body,options);
  const characterId=actor?.tgId,generation=epoch;
  let r;
  try{r=await fetch(endpoint+action,{method:'POST',mode:'cors',credentials:'omit',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'90101','X-Realm-Id':realm},body:JSON.stringify({...body,...(characterId&&action!=='me'?{selectedCharacterId:characterId}:{})}),signal:options.signal});}
  catch(cause){const e=new Error('本機遊戲服務未連線，請重新同步');e.uncertain=!['equipment-collection','equipment-collection/preview','me','chat/state','atlas/quests','atlas/catalog','atlas/status','atlas/talents','atlas/talents/preview'].includes(action);e.cause=cause;throw e;}
  const data=await r.json();
  if(!r.ok||data.ok===false){const e=new Error(data.message||'資料暫時無法同步');e.status=r.status;e.code=data.error;e.uncertain=r.status>=500&&!['equipment-collection','equipment-collection/preview','me','chat/state','atlas/quests','atlas/catalog','atlas/status','atlas/talents','atlas/talents/preview'].includes(action);if(data.error==='character_changed')void bootstrap();throw e;}
  if(generation!==epoch&&action!=='me'){const e=new Error('角色已切換，已忽略先前回應');e.code='context_changed';throw e;}
  return data;
 }
 const chat=window.RpgSceneChatUI.createClient({request,storage:sessionStorage},()=>{paintStrip();if(kind==='chat')chatView?.update();});
 function applyLiveSnapshot(snapshot){
  if(!liveSession)return;
  if(!snapshot){if(kind!=='characters')close();actor=null;actorContext='';epoch++;claimBusy=false;quests=null;questFlight=null;tracked=null;catalog=null;chat.setContext(null);paintTracker();paintStrip();return;}
  const context=liveSession.getContext(),next={tgId:String(snapshot.characterId),...snapshot.character,partyId:snapshot.live.partyId};
  const signature=`${snapshot.realmId}:${snapshot.characterId}:${context.epoch}`;
  if(signature!==actorContext){if(actor&&kind!=='characters')close();actorContext=signature;epoch++;claimBusy=false;quests=null;questFlight=null;tracked=null;catalog=null;realm=snapshot.realmId;actor=next;try{tracked=JSON.parse(sessionStorage.getItem(`scene:tracked-quest:${realm}:${actor.tgId}`)||'null');}catch{}chat.setContext({realmId:realm,characterId:actor.tgId,epoch});}else actor=next;
  questError='';paintTracker();paintStrip();
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
 function nextQuest(){const rows=quests?.quests||[];return rows.find(q=>q.id===tracked?.id&&q.periodKey===tracked?.periodKey&&!q.claimed)||rows.find(q=>q.claimable)||rows.find(q=>q.category==='tutorial'&&!q.claimed)||rows.find(q=>!q.claimed&&(!q.expiresAt||q.expiresAt>quests.now));}
 function paintStrip(){const m=chat.state.messages.at(-1),line=byId('chatLine'),ch=document.querySelector('#chat .ch');if(ch)ch.textContent=m?(m.channel==='party'?'隊伍':'世界'):'聊天';if(line)line.textContent=chat.state.error?'聊天離線 · 點此重試':m?`${m.name}：${m.text}`:actor?'點此與旅人聊天':'正在連接本機遊戲…';}
 function paintTracker(){const q=nextQuest(),title=document.querySelector('#quest .qn'),count=document.querySelector('#quest .qc'),desc=document.querySelector('#quest .qd');if(title)title.textContent=q?`◆ ${q.title}`:questError?'◆ 任務尚未連線':'◆ 永久世界委託';if(count)count.textContent=q?`${pretty(q.progress)}/${pretty(q.target)}`:'';if(desc)desc.textContent=questError||(q?`${q.description}${q.claimable?' · 可領取獎勵':''}`:'查看教學與長期目標');}
 const originalToggle=ui.toggle;
 function close(){if(!dialog)return;atlasView?.dispose();atlasView=null;dialog.remove();dialog=null;kind=null;chatView=null;for(const [el,value] of savedInert)el.inert=value;savedInert.clear();if(['chat','scene-quests','scene-talents','scene-progression','scene-gearbook','scene-expedition','scene-characters','scene-equipment','scene-inventory','scene-supplies','scene-build'].includes(ui.open))ui.open=null;if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
 function open(type){
  if(dialog&&kind===type){close();return;}
  close();if(ui.open)originalToggle(ui.open);
  previousFocus=document.activeElement;kind=type;
  dialog=document.createElement('section');dialog.className='scene-social-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','scene-social-title');
  dialog.innerHTML='<div class="scene-social-backdrop"></div><div class="scene-social-card" tabindex="-1"><header><h2 id="scene-social-title"></h2><button type="button" aria-label="關閉視窗">×</button></header><small class="scene-social-demo">本機測試角色 · 聊天與委託由9642遊戲服務提供；展示戰鬥不計任務或掉落。</small><div class="scene-social-body"></div></div>';
  dialog.querySelector('h2').textContent=({chat:'聊天',quests:'任務與委託',talents:'天賦星盤',progression:'冒險成長路線',gearbook:'裝備收藏冊',expedition:'星圖派遣',characters:'選擇角色',build:'技能與輔助配置',equipment:'目前裝備',inventory:'背包',supplies:'補給'})[type];dialog.querySelector('header button').onclick=close;dialog.querySelector('.scene-social-backdrop').onclick=close;
  for(const child of byId('ui').children){savedInert.set(child,child.inert);child.inert=true;}byId('ui').append(dialog);
  ui.open=type==='chat'?'chat':'scene-'+type;const body=dialog.querySelector('.scene-social-body');
  if(liveSession)dialog.querySelector('.scene-social-demo').textContent='本機隔離測試 · 場景與功能使用同一角色；戰況顯示已結算資料。';
  if(type==='characters'&&liveSession){void paintCharacters(body);}else if(liveSession&&['equipment','inventory','supplies'].includes(type)){void paintRealInventory(body,type);}else if(type==='chat'){chatView=window.RpgSceneChatUI.mountPanel(body,chat);void bootstrap();void chat.refresh();}else if(type==='quests'){paintQuests();void bootstrap();void refreshQuests();}else{body.textContent='正在讀取本機角色…';void bootstrap().then(()=>{if(!actor||kind!==type||!dialog)return;if(type==='gearbook'){const selected=String(actor.tgId);atlasView=window.RpgEquipmentCollection.mount(body,{request,characterId:selected,realmId:realm,current:()=>String(actor?.tgId)===selected&&kind==='gearbook',artUrl:src=>new URL(endpoint).origin+src,onChanged:()=>void bootstrap()});}else atlasView=window.RpgSceneAtlasGuide.mount(body,{request,actor:{...actor},getActor:()=>actor,realmId:realm,getContext:()=>liveSession?liveSession.getContext():{realmId:realm,epoch}},type);});}
  dialog.querySelector('.scene-social-card').focus({preventScroll:true});
 }
 ui.toggle=function(id){if(liveSession&&['eq','inv','sup','sk','map'].includes(id)){open(({eq:'equipment',inv:'inventory',sup:'supplies',sk:'build',map:'expedition'})[id]);return;}if(liveSession&&id==='scene-characters'){open('characters');return;}if(['talents','progression','gearbook','expedition'].includes(id)){open(id);return;}if(id==='chat'){open('chat');return;}if(dialog)close();const result=originalToggle(id);if(['sk','map','eq','inv'].includes(id)){const panel=byId('p-'+id),target=panel?.querySelector('.pb')||panel;if(target&&!target.querySelector('[data-live-atlas-entry]')){const entry=document.createElement('button');entry.type='button';entry.dataset.liveAtlasEntry=id==='sk'?'talents':id==='map'?'progression':'gearbook';entry.className='scene-atlas-entry';entry.textContent=id==='sk'?'✧ 天賦星盤 · 路線預覽與引導':id==='map'?'✦ 冒險成長路線 · 通關與鍛造':'✦ 裝備收藏冊 · 集滿獲得永久能力';entry.onclick=()=>open(entry.dataset.liveAtlasEntry);target.prepend(entry);}}return result;};
 // Keep demonstration boss pacing, but remove its fake 40-kill quest counter.
 ui.addKill=function(){if(!liveSession)ui.kills=(ui.kills||0)+1;};
 const quest=byId('quest');quest.setAttribute('role','button');quest.tabIndex=0;quest.setAttribute('aria-label','開啟真實任務與委託');quest.addEventListener('pointerdown',e=>{e.preventDefault();e.stopImmediatePropagation();open('quests');},true);quest.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open('quests');}});
 async function paintRealInventory(body,type){
  body.textContent='正在讀取目前角色…';
  await bootstrap();if(!actor||kind!==type||!body.isConnected)return;
  const context=liveSession.getContext(),current=()=>kind===type&&body.isConnected&&liveSession.getContext().epoch===context.epoch&&liveSession.getContext().realmId===context.realmId&&liveSession.getContext().characterId===context.characterId;
  try{
   const [me,metadata]=await Promise.all([request('me',{summary:false}),itemMetadata?Promise.resolve(itemMetadata):request('meta')]);
   if(!current())return;
   if(String(me.character?.tgId)!==String(context.characterId))throw Error('角色資料已變動，請重新同步');
   itemMetadata=metadata;
   const atlas=type==='inventory'?await request('atlas/status'):null;if(!current())return;
   body.replaceChildren();
   const heading=document.createElement('p');heading.className='scene-guide-actor';heading.textContent=`${me.character.name} · 金幣 ${pretty(me.character.gold)}`;body.append(heading);
   const add=(title,detail)=>{const card=document.createElement('article');card.className='scene-live-quest';const h=document.createElement('h4'),p=document.createElement('p');h.textContent=title;p.textContent=detail;card.append(h,p);body.append(card);};
   const refresh=document.createElement('button');refresh.type='button';refresh.textContent='重新讀取';refresh.onclick=()=>void paintRealInventory(body,type);body.append(refresh);
   if(type==='equipment'||type==='inventory'){
    const equipment=(me.equipment||[]).filter(item=>type==='equipment'?item.equipped:!item.equipped);
    const h=document.createElement('h3');h.textContent=type==='equipment'?'已穿戴裝備':'背包裝備';body.append(h);
    if(!equipment.length)add('目前沒有裝備','');
    for(const item of equipment)add(`${item.name} +${pretty(item.enhance)}`,[item.slotName||item.slot,item.position?`欄位 ${item.position}`:'未穿戴',`T${item.tier}`,item.rarityName,item.inTrade?'交易中':null].filter(Boolean).join(' · '));
   }
   if(type==='inventory'||type==='supplies'){
    const definitions=metadata.meta?.items||metadata.items||{},items=Object.entries(me.inventory||{}).filter(([id,quantity])=>quantity>0&&(type==='inventory'||definitions[id]?.kind==='potion'||/^(red|blue)_/.test(id)));
    const h=document.createElement('h3');h.textContent=type==='supplies'?'背包補給':'道具與材料';body.append(h);
    if(!items.length)add('目前沒有持有道具','');
    for(const [id,quantity]of items)add(definitions[id]?.name||id,`持有 ${pretty(quantity)}${definitions[id]?.desc?' · '+definitions[id].desc:''}`);
    if(type==='inventory'&&atlas){const h=document.createElement('h3');h.textContent='星圖材料';body.append(h);const names=Object.fromEntries((catalog?.materials||[]).map(item=>[item.id,item.name]));for(const [id,quantity]of Object.entries(atlas.materials||{}))if(quantity>0)add(names[id]||id,`持有 ${pretty(quantity)}`);}
    const run=liveSession.getSnapshot()?.run;if(run?.active)add('本趟攜帶補給',`剩餘紅水 ${pretty(run.supplies.hp)}／藍水 ${pretty(run.supplies.mp)}。這些已從背包保留，返營時退回未用部分。`);
   }
   const actions=document.createElement('div');const collection=document.createElement('button');collection.type='button';collection.textContent='裝備收藏冊';collection.onclick=()=>open('gearbook');actions.append(collection);
   if(type==='supplies'){const dispatch=document.createElement('button');dispatch.type='button';dispatch.textContent='配置出征補給';dispatch.onclick=()=>open('expedition');actions.append(dispatch);}
   const manage=document.createElement('a');manage.href=new URL('/?devTg='+encodeURIComponent(context.accountId),endpoint).href;manage.target='_blank';manage.rel='noopener';manage.className='scene-atlas-entry';manage.textContent='完整管理（另選世界與角色）';actions.append(manage);body.append(actions);
  }catch(error){if(current()){body.textContent=error.message;const retry=document.createElement('button');retry.type='button';retry.textContent='重新讀取';retry.onclick=()=>void paintRealInventory(body,type);body.append(retry);}}
 }
 async function paintCharacters(body){
  body.textContent='正在讀取角色…';
  const scope=liveSession.getContext();
  try{
   const data=await request('characters');
   if(kind!=='characters'||!body.isConnected||scope.realmId!==liveSession.getContext().realmId||scope.accountId!==liveSession.getContext().accountId)return;
   body.replaceChildren();
   for(const character of data.characters||[]){const button=document.createElement('button');button.type='button';button.className='scene-atlas-entry';button.textContent=`${character.active?'目前角色 · ':''}${character.name} · Lv.${character.level} · ${({sword:'劍士',archer:'妖精',mage:'法師',thief:'盜賊'})[character.baseClass]||character.baseClass}`;button.disabled=!!character.active;button.onclick=async()=>{for(const b of body.querySelectorAll('button'))b.disabled=true;try{await liveSession.selectCharacter(character.charId);await bootstrap();if(kind==='characters')close();}catch(error){if(kind==='characters'&&body.isConnected){const note=document.createElement('p');note.setAttribute('role','alert');note.textContent=error.message;body.append(note);const retry=document.createElement('button');retry.type='button';retry.textContent='重新讀取角色';retry.onclick=()=>void paintCharacters(body);body.append(retry);}}};body.append(button);}
   if(!data.characters?.length)body.textContent='目前世界尚未建立角色。';
  }catch(error){if(kind==='characters'&&body.isConnected)body.textContent=error.message;}
 }
 function rewardText(q){return Object.entries(q.rewards?.materials||{}).map(([id,n])=>`${catalog?.materials?.find?.(m=>m.id===id)?.name||({atlas_shard:'星圖碎片',atlas_iron:'星鐵',atlas_ember:'餘燼',atlas_venom:'幽毒',atlas_core:'守望核心'})[id]||id} ×${pretty(n)}`).join(' · ');}
 function paintQuests(){
  if(kind!=='quests'||!dialog)return;const body=dialog.querySelector('.scene-social-body'),scroll=body.scrollTop;body.replaceChildren();
  const top=document.createElement('div');top.className='scene-live-quest-top';const note=document.createElement('p');note.textContent=questError||(!quests?'正在讀取任務…':`目前角色：${actor?.name||'—'} · 已完成可領取 ${quests.quests.filter(q=>q.claimable).length} 項`);const sync=document.createElement('button');sync.type='button';sync.textContent='重新同步';sync.onclick=()=>{void bootstrap();};top.append(note,sync);body.append(top);
  const rows=(quests?.quests||[]).filter(q=>q.claimable||!q.expiresAt||q.expiresAt>quests.now);
  for(const category of ['tutorial','daily','weekly','longterm']){const list=rows.filter(q=>q.category===category);if(!list.length)continue;const h=document.createElement('h3');h.textContent=({tutorial:'冒險引導',daily:'每日委託',weekly:'每週目標',longterm:'長期踏查'})[category];body.append(h);for(const q of list){const card=document.createElement('article');card.className='scene-live-quest'+(q.claimed?' is-claimed':'');const title=document.createElement('h4');title.textContent=q.title;const desc=document.createElement('p');desc.textContent=q.description;const progress=document.createElement('progress');progress.max=q.target;progress.value=Math.min(q.target,q.progress);progress.setAttribute('aria-label',q.title+'進度');const count=document.createElement('span');count.textContent=`${pretty(q.progress)} / ${pretty(q.target)} ${q.unit||''}${q.periodKey==='lifetime'?'':` · ${q.periodKey}`}`;const reward=document.createElement('small');reward.textContent='獎勵：'+rewardText(q);const actions=document.createElement('div');const track=document.createElement('button');track.type='button';track.textContent=tracked?.id===q.id&&tracked?.periodKey===q.periodKey?'追蹤中':'追蹤任務';track.disabled=q.claimed;track.onclick=()=>{tracked={id:q.id,periodKey:q.periodKey};sessionStorage.setItem(`scene:tracked-quest:${realm}:${actor.tgId}`,JSON.stringify(tracked));paintTracker();paintQuests();};const claim=document.createElement('button');claim.type='button';claim.textContent=q.claimed?'已領取':q.claimable?'領取獎勵':'尚未完成';claim.disabled=claimBusy||!q.claimable;claim.onclick=()=>claimQuest(q);actions.append(track,claim);card.append(title,desc,progress,count,reward,actions);body.append(card);}}
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

 document.addEventListener('keydown',e=>{if(!dialog)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return;}if(e.key==='Tab'){const items=[...dialog.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(el=>el.tabIndex>=0&&!el.disabled&&el.getClientRects().length),first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||!items.includes(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}},true);
 const poll=setInterval(()=>{if(document.hidden||disposed)return;if(kind==='chat')void chat.refresh();else if(Date.now()-(chat.state.syncedAt||0)>=30000)void chat.refresh();},5000);
 const questPoll=setInterval(()=>{if(!document.hidden&&!disposed)void bootstrap();},30000);
 window.addEventListener('pagehide',()=>{disposed=true;clearInterval(poll);clearInterval(questPoll);chat.dispose();},{once:true});
 if(liveSession)liveSession.subscribe(applyLiveSnapshot);
 paintStrip();paintTracker();void bootstrap();
})();
