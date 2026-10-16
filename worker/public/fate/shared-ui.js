import {activeBetween,isOpenTime} from './life.js';
const terminal=new Set(['answered','declined','withdrawn','auto']);
export function sharedEventState(event,now){
 const left=Math.max(0,activeBetween(now,event.deadline));
 const open=event.status==='pending'&&!terminal.has(event.status)&&left>0&&isOpenTime(now);
 return {left,night:!isOpenTime(now),canReply:open&&event.side==='guest'&&event.canReply===true&&event.characterMatches===true};
}
export function createSharedUI({client,onChange,notification=false,now=()=>Date.now(),document:doc=document,uuid=()=>crypto.randomUUID()}){
 let data=null,error='',notice='',inFlight=null,offset=0,busy=false,invite=false;const retries=new Map();
 const el=(tag,cls,text)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const btn=(text,fn,cls='fate-quiet')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;b.disabled=busy;return b;};
 const signature=d=>JSON.stringify(d&&{preferences:d.preferences,events:d.events.map(({remainingMs,...event})=>event)});
 function sync(){if(inFlight)return inFlight;inFlight=(async()=>{try{const fresh=await client.request('fate/social/inbox');offset=fresh.now-now();const completed=d=>JSON.stringify((d?.events||[]).filter(e=>e.outcome).map(e=>[e.id,e.outcome])),refreshLife=completed(data)!==completed(fresh),changed=signature(data)!==signature(fresh)||error;data=fresh;error='';if(changed)onChange({refreshLife});}catch(e){const changed=error!==e.message;error=e.message;if(changed)onChange();}})().finally(()=>{inFlight=null;});return inFlight;}
 async function act(action,body){if(busy)return;const key=action+JSON.stringify(body);const requestId=retries.get(key)||uuid();retries.set(key,requestId);busy=true;error='';notice='';onChange();try{await client.request(action,{...body,requestId},requestId);retries.delete(key);notice=action.endsWith('/reply')?'回音已送達。你的選擇已保存。':action.endsWith('/decline')?'已交給故事續寫，這一世仍會繼續。':action.endsWith('/withdraw')?'已收回這次邀請。':'相逢設定已保存。';if(inFlight)await inFlight;await sync();}catch(e){error=e.message;}finally{busy=false;onChange();}}
 function render(p){
  const box=el('section','fate-shared');box.dataset.sharedUi='';box.setAttribute('aria-label','交織命運');
  const head=el('div','fate-shared-heading');head.append(el('span','fate-eyebrow','WHEN OUR STORIES MEET'),el('h3','','交織命運'));box.append(head);
  if(notice){const message=el('p','fate-status',notice);message.setAttribute('role','status');box.append(message);}
  if(!data)box.append(el('p','fate-note',error?'星燈暫未送達，請重新查看來信。':'正在查看旅人的來信…'));
  const events=data?.events||[],active=events.filter(e=>!terminal.has(e.status)),history=events.filter(e=>terminal.has(e.status)).slice(0,3);
  if(data&&!active.length)box.append(el('p','fate-note','此刻沒有等待回應的相逢。開啟邀請後，你也能走進另一位旅人的故事。'));
  for(const e of active)renderEvent(box,e);
  if(history.length){const past=el('details','fate-shared-past');past.open=notification&&!active.length||!!notice;past.append(el('summary','','已落筆的相逢'));for(const e of history)renderEvent(past,e);box.append(past);}
  const settings=el('details','fate-shared-settings');settings.append(el('summary','','相逢設定'));
  const check=el('label','fate-check'),input=el('input');input.type='checkbox';input.checked=!!(data?.preferences.enabled&&data?.preferences.allowMentions);input.disabled=busy||!data;
  check.append(input,el('span','','接受其他旅人的支線邀請，並允許群組來信標記我'));settings.append(check,el('p','fate-note','每件邀請都能略過。只有你能替自己的角色答覆，不會改變你的輪迴進度或獎勵。'));
  input.onchange=()=>act('fate/social/preferences/save',{enabled:input.checked,allowMentions:input.checked,consent:input.checked,quietToday:!!data?.preferences.quietToday});
  if(data){settings.append(btn(data.preferences.quietToday?'恢復今天的邀請':'今天先讓星燈休息',()=>act('fate/social/preferences/save',{enabled:!!data.preferences.enabled,allowMentions:!!data.preferences.allowMentions,consent:true,quietToday:!data.preferences.quietToday})));}
  box.append(settings);if(error){const message=el('p','fate-error',error+'；再次點選會重試同一操作。');message.setAttribute('role','alert');box.append(message);}box.append(btn('重新查看來信',sync));p.append(box);paint(box);
 }
 function renderEvent(parent,event){
  const card=el('article','fate-shared-event');card.dataset.sharedEvent=event.id;
  card.append(el('small','fate-eyebrow',terminal.has(event.status)?'這段相逢，已留下回音':event.side==='guest'?'一位旅人，正等你的回音':'你們的故事，尚待落筆'),el('h4','',event.title),el('p','fate-shared-people',`${event.ownerName} · ${event.guestName}`),el('p','',event.text));
  if(event.outcome){const ending=el('section','fate-shared-outcome');ending.append(el('small','fate-eyebrow','你們共同寫下的後續'),el('p','',event.outcome));card.append(ending);}
  const state=sharedEventState(event,now()+offset);
  if(event.side==='guest'&&!event.characterMatches&&!terminal.has(event.status))card.append(el('p','fate-note',`這封來信寄給「${event.guestName}」。請返回冒險並切換至該角色，再開啟旅章回應。`));
  if(event.side==='guest'&&!terminal.has(event.status)&&event.characterMatches){for(const [answer,label] of event.choices.entries()){const b=btn(label,()=>act('fate/social/reply',{eventId:event.id,answer}),'fate-option');b.dataset.sharedAnswer='';b.disabled=busy||!state.canReply;card.append(b);}card.append(btn('這次交給故事續寫',()=>act('fate/social/decline',{eventId:event.id})));}
  if(event.side==='owner'&&!terminal.has(event.status)){card.append(el('p','fate-note',`這一次，讓「${event.guestName}」決定自己的回應。你自己的人生抉擇仍由你選擇。`));if(event.canWithdraw)card.append(btn('收回這次邀請',()=>act('fate/social/withdraw',{eventId:event.id})));}
  const status=el('p','fate-shared-countdown');status.dataset.sharedCountdown='';status.setAttribute('role','status');card.append(status);parent.append(card);
 }
 function paint(root){for(const e of data?.events||[]){const card=[...root.querySelectorAll('[data-shared-event]')].find(c=>c.dataset.sharedEvent===e.id);if(!card)continue;const state=sharedEventState(e,now()+offset),status=card.querySelector('[data-shared-countdown]');
   if(status)status.textContent=e.outcome?'這段後續，已收進你們各自的相逢紀錄。':e.status==='answered'?`已回應 · ${e.choices[e.answer]||'這一頁已落筆'}。故事會在約定時刻接續。`:e.status==='declined'?'已交給故事自然續寫。':e.status==='withdrawn'?'來信已收回，這一世仍會繼續。':e.status==='auto'?'回應時間已過，命運已替這段相逢續寫。':e.status==='scheduled'?'星燈尚在路上，這段相逢會隨人生展開。':state.left<=0?'回應已截止，正在確認故事的下一頁…':state.night?'☾ 夜間暫停回應，06:00 接續。':`還有 ${Math.floor(Math.ceil(state.left/1000)/60)} 分 ${Math.ceil(state.left/1000)%60} 秒，留下你的回音。`;
   for(const b of card.querySelectorAll('[data-shared-answer]'))b.disabled=busy||!state.canReply;
  }}
 function renderInvite(p){const label=el('label','fate-check'),input=el('input');input.type='checkbox';input.checked=invite;input.onchange=()=>{invite=input.checked;};label.append(input,el('span','','這一世，邀請另一位旅人決定一段相逢'));p.append(label,el('p','fate-note','每世最多一條支線，來信會在群組標記你與對方。對方可略過；未回覆時故事自然續寫，不影響你自己的人生抉擇。'));}
 return {render,sync,paint,renderInvite,get invite(){return invite;},resetInvite(){invite=false;}};
}
