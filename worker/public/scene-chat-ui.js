/* Real chat client shared by the Atlas scene and local visual-scene adapter. */
(() => {
 'use strict';
 const key=c=>`${c?.realmId||''}:${c?.characterId||''}:${c?.epoch||0}`;
 function createClient(host,changed=()=>{}){
  const state={context:null,filter:'all',sendRoom:'world',channels:[],messages:[],draft:'',pending:null,busy:false,loading:false,error:'',hasOlder:false,syncedAt:null};
  let generation=0,readVersion=0,controller=null,flight=null;
  const notify=()=>changed(state),storageKey=c=>`rpg:scene-chat-pending:${c?.realmId}:${c?.characterId}`;
  const save=()=>{try{if(state.pending)host.storage?.setItem(storageKey(state.context),JSON.stringify(state.pending));else host.storage?.removeItem(storageKey(state.context));}catch{}};
  function setContext(c){if(key(c)===key(state.context))return false;generation++;readVersion++;controller?.abort();controller=null;flight=null;let pending=null;try{const saved=JSON.parse(host.storage?.getItem(storageKey(c))||'null');if(saved&&typeof saved.requestId==='string'&&typeof saved.text==='string'&&['world','party'].includes(saved.channel)&&typeof saved.roomId==='string')pending=saved;}catch{}Object.assign(state,{context:c,filter:'all',sendRoom:pending?.roomId||'world',channels:[],messages:[],draft:pending?.text||'',pending,busy:false,loading:false,error:'',hasOlder:false,syncedAt:null});notify();return true;}
  function accept(data){if(String(data.realmId)!==String(state.context.realmId)||String(data.characterId)!==String(state.context.characterId))throw Error('聊天角色或環境不符，請重新同步');}
  async function refresh({older=false}={}){
   if(!state.context?.characterId)return null;if(flight)return flight;
   const g=generation,r=++readVersion,abort=new AbortController();controller=abort;state.loading=true;notify();
   const request=(async()=>{try{const data=await host.request('chat/state',{channel:state.filter,...(older&&state.messages.length?{beforeSeq:state.messages[0].seq}:{})},{signal:abort.signal});if(g!==generation||r!==readVersion)return null;accept(data);
     const rooms=new Set(data.channels.filter(c=>c.enabled).map(c=>c.id));
     const messages=new Map(state.messages.filter(m=>rooms.has(m.roomId)&&m.createdAt>=data.now-7*86400000).map(m=>[m.seq,m]));
     for(const m of data.messages)messages.set(m.seq,m);
     Object.assign(state,{channels:data.channels,messages:[...messages.values()].sort((a,b)=>a.seq-b.seq).slice(-200),syncedAt:data.now,error:''});
     if(older||state.messages.length<=50)state.hasOlder=data.hasMore&&state.messages.length<200;
     return data;
    }catch(e){if(g===generation&&r===readVersion&&!abort.signal.aborted)state.error=e.message||'聊天暫時無法同步';return null;}
    finally{if(g===generation&&r===readVersion){state.loading=false;flight=null;controller=null;notify();}}})();flight=request;return request;
  }
  function filter(value){if(!['all','world','party'].includes(value)||value===state.filter)return;readVersion++;controller?.abort();flight=null;controller=null;Object.assign(state,{filter:value,messages:[],loading:false,hasOlder:false,error:''});if(!state.pending){if(value==='world')state.sendRoom='world';else if(value==='party')state.sendRoom=state.channels.find(c=>c.channel==='party'&&c.enabled)?.id||'party';}notify();void refresh();}
  async function send(){
   if(state.busy||!state.context?.characterId)return null;
   const room=state.channels.find(c=>c.id===state.sendRoom&&c.enabled);
   if(!state.pending&&!room){state.error='目前頻道無法傳送，請重新選擇頻道';notify();return null;}
   const content=state.draft.trim();if(!state.pending&&(!content||[...content].length>200)){state.error='請輸入1至200字的訊息';notify();return null;}
   const g=generation;state.pending??={channel:room.channel,roomId:room.id,text:content,requestId:host.newId?host.newId():crypto.randomUUID()};save();state.busy=true;state.error='';notify();
   try{const data=await host.request('chat/send',{...state.pending});if(g!==generation)return null;accept(data);state.pending=null;state.draft='';save();if(state.filter==='all'||state.filter===data.message.channel){const messages=new Map(state.messages.map(m=>[m.seq,m]));messages.set(data.message.seq,data.message);state.messages=[...messages.values()].sort((a,b)=>a.seq-b.seq).slice(-200);}return data;}
   catch(e){if(g===generation){state.error=e.message||'訊息尚未確認，請重試同一筆訊息';if(!e.uncertain&&e.status>=400&&e.status<500){state.pending=null;save();}}return null;}
   finally{if(g===generation){state.busy=false;notify();void refresh();}}
  }
  return {state,setContext,refresh,filter,send,dispose(){generation++;readVersion++;controller?.abort();flight=null;}};
 }
 function mountPanel(root,client){
  root.innerHTML='<div class="scene-chat-panel" data-scene-chat-panel><div class="scene-chat-tabs" role="tablist" aria-label="聊天頻道"></div><p class="scene-chat-status" role="status"></p><button type="button" class="scene-chat-older">載入較早訊息</button><div class="scene-chat-log" role="log" aria-label="聊天訊息" aria-live="polite" tabindex="0"></div><form class="scene-chat-compose"><label>傳送頻道<select aria-label="傳送頻道"></select></label><label class="scene-chat-input">訊息<textarea name="sceneChatMessage" aria-label="聊天訊息" placeholder="輸入訊息…" rows="2" maxlength="400"></textarea></label><button type="submit">傳送</button></form><p class="scene-chat-help">訊息限200字；每3秒可傳送一次。Enter傳送，Shift＋Enter換行。</p></div>';
  const get=s=>root.querySelector(s),tabs=get('.scene-chat-tabs'),status=get('.scene-chat-status'),log=get('.scene-chat-log'),form=get('form'),select=get('select'),input=get('textarea'),submit=get('[type=submit]'),older=get('.scene-chat-older');
  for(const [id,label] of [['all','全部'],['world','世界'],['party','隊伍']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.channel=id;b.setAttribute('role','tab');b.onclick=()=>client.filter(id);tabs.append(b);}
  let composing=false,rowsKey='',optionsKey='';
  input.oncompositionstart=()=>{composing=true;};input.oncompositionend=()=>{composing=false;client.state.draft=input.value;};input.oninput=()=>{client.state.draft=input.value;};
  input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!composing&&e.keyCode!==229){e.preventDefault();form.requestSubmit();}};
  select.onchange=()=>{client.state.sendRoom=select.value;update();};
  form.onsubmit=async e=>{e.preventDefault();if(composing)return;client.state.draft=input.value;await client.send();};
  older.onclick=async()=>{const oldHeight=log.scrollHeight,oldTop=log.scrollTop;await client.refresh({older:true});log.scrollTop=oldTop+log.scrollHeight-oldHeight;};
  function update(){
   const s=client.state,pinned=log.scrollHeight-log.scrollTop-log.clientHeight<40;
   for(const b of tabs.children)b.setAttribute('aria-selected',String(b.dataset.channel===s.filter));
   const allowed=s.channels.filter(c=>c.enabled),room=allowed.find(c=>c.id===s.sendRoom),unavailable=s.channels.find(c=>c.channel===s.filter&&!c.enabled);
   status.textContent=s.error||(s.pending?'上次訊息尚待確認；再次傳送會核對同一筆，不重複發送。':unavailable?.reason||(s.loading&&!s.syncedAt?'正在同步聊天…':''));status.classList.toggle('is-error',!!s.error);
   const options=JSON.stringify([allowed.map(c=>[c.id,c.name]),s.sendRoom]);if(options!==optionsKey){optionsKey=options;select.replaceChildren();if(!room){const o=document.createElement('option');o.value=s.sendRoom;o.textContent='原頻道已變更，請重新選擇';select.append(o);}for(const c of allowed){const o=document.createElement('option');o.value=c.id;o.textContent=c.name;select.append(o);}select.value=s.sendRoom;}
   if(!composing&&input.value!==s.draft)input.value=s.draft;
   input.disabled=s.busy||!!s.pending;select.disabled=s.busy||!!s.pending;submit.disabled=s.busy||(!room&&!s.pending);submit.textContent=s.busy?'傳送中…':s.pending?'確認上次訊息':'傳送';older.hidden=!s.hasOlder;older.disabled=s.loading;
   const messages=JSON.stringify(s.messages);if(messages!==rowsKey){rowsKey=messages;log.replaceChildren();if(!s.messages.length){const p=document.createElement('p');p.className='scene-chat-empty';p.textContent=unavailable?.reason||'目前沒有訊息，成為第一位打招呼的旅人。';log.append(p);}for(const m of s.messages){const row=document.createElement('div');row.className='scene-chat-message'+(m.own?' is-own':'');row.dataset.seq=m.seq;const ch=document.createElement('span');ch.className='scene-chat-channel';ch.textContent=m.channel==='party'?'隊伍':'世界';const name=document.createElement('b');name.textContent=`${m.name} · Lv.${m.level}`;const at=document.createElement('time');at.textContent=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'}).format(new Date(m.createdAt));const text=document.createElement('p');text.textContent=m.text;row.append(ch,name,at,text);log.append(row);}if(pinned)log.scrollTop=log.scrollHeight;}
  }
  update();return {update};
 }
 window.RpgSceneChatUI={createClient,mountPanel,contextKey:key};
})();
