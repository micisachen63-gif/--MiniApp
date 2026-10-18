export const GIFT_ART='/art/ui/command-collect-20261012.webp';
const pending=new Map(),names={guaranteed_scroll_w:'星輝武器必成卷',guaranteed_scroll_a:'星輝防具必成卷',scroll_w:'武器強化卷',scroll_a:'防具強化卷'};
const safeStorage=()=>{try{return globalThis.localStorage;}catch{return null;}};
const changed=()=>Object.assign(Error('目前角色已改變，請關閉後重新開啟星輝匣。'),{code:'character_changed'});
export function createFateGiftController(host,{storage=safeStorage(),uuid=()=>crypto.randomUUID()}={}){
 const character=String(host?.characterId()||'');if(!character)throw changed();let busy=false;
 const check=()=>{if(String(host.characterId())!==character)throw changed();};
 const key=kind=>`star-fate-gift:${character}:${kind}`;
 function get(kind){const k=key(kind);let id=pending.get(k);if(!id){try{id=storage?.getItem(k)||null;}catch{}if(id)pending.set(k,id);}return id;}
 function clear(kind){pending.delete(key(kind));try{storage?.removeItem(key(kind));}catch{}}
 const summary=async()=>{check();const value=await host.request('fate/gifts/summary',{});check();if(!value?.ok)throw Error(value?.message||'星輝匣暫時無法同步');return value;};
 async function run(kind){
  check();if(!['claim','open'].includes(kind)||busy)throw Error('上一個星輝操作仍在同步，請稍候');busy=true;
  let requestId=get(kind);if(!requestId){requestId=uuid();pending.set(key(kind),requestId);try{storage?.setItem(key(kind),requestId);}catch{}}
  try{const value=await host.request('fate/gifts/'+kind,{requestId});if(value?.ok===false)throw Object.assign(Error(value.message||'星輝匣暫時無法同步'),{code:value.error,status:value.status});if(!value?.ok||!value.result)throw Object.assign(Error('尚未收到完整結果，請重試原操作；不會重複領取或開匣。'),{uncertain:true});clear(kind);check();return value.result;}
  catch(e){if(e.status>=400&&e.status<500&&!['conflict','character_changed'].includes(e.code)&&!e.uncertain)clear(kind);throw e;}
  finally{busy=false;}
 }
 return {character,check,summary,run,pending:kind=>!!get(kind),get busy(){return busy;}};
}
let opened=null;
export function openFateGift(host=window.RpgFateHost,{doc=document,storage=safeStorage()}={}){
 if(opened)return opened;const controller=createFateGiftController(host,{storage}),focused=doc.activeElement,app=doc.getElementById('app'),wasInert=app?.inert,overflow=doc.body.style.overflow;
 const node=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
 const overlay=node('section','fate-gift-overlay'),panel=node('div','fate-gift-panel'),close=node('button','fate-gift-close','返回冒險'),hero=node('div','fate-gift-hero'),art=node('img','fate-gift-art');
 overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','四世星輝匣');close.type='button';art.src=GIFT_ART;art.alt='藍金月桂紋飾的星輝寶匣';
 hero.append(node('small','','MEMORIES INTO STARDUST'),art,node('h2','','四世星輝匣'),node('p','','四度走過人生，星穹替你收藏了一份光。'));
 const counts=node('div','fate-gift-counts','正在清點你的星輝…'),status=node('p','fate-gift-status'),result=node('div','fate-gift-result'),actions=node('div','fate-gift-actions'),claim=node('button','','領取星輝'),open=node('button','','開啟一匣'),retry=node('button','fate-gift-reload','重新同步');claim.type=open.type=retry.type='button';claim.disabled=open.disabled=true;status.setAttribute('role','status');status.setAttribute('aria-live','polite');result.setAttribute('aria-live','polite');actions.append(claim,open);
 const odds=node('div','fate-gift-odds'),hint=node('p','fate-gift-hint','每完成 4 世正式旅程，可領 1 匣並累積保留。訪客體驗與分享匯入不計入；必成卷請至鍛造介面手動選用。');
 panel.append(close,hero,counts,actions,status,result,odds,hint,retry);overlay.append(panel);if(app)app.inert=true;doc.body.style.overflow='hidden';doc.body.append(overlay);let alive=true,data=null,changing=false;
 function roleCheck(){try{controller.check();return true;}catch{changing=true;claim.disabled=open.disabled=retry.disabled=true;status.textContent='目前角色已改變，請關閉後重新開啟星輝匣。';return false;}}
 function paint(){if(!alive||!roleCheck())return;claim.disabled=controller.busy||(!controller.pending('claim')&&!(data?.claimable>0));open.disabled=controller.busy||(!controller.pending('open')&&!(data?.unopened>0));retry.disabled=controller.busy;claim.textContent=controller.pending('claim')?'重試領取':'領取星輝';open.textContent=controller.pending('open')?'重試開匣':'開啟一匣';}
 async function sync(){if(!alive||!roleCheck())return;try{data=await controller.summary();if(!alive||!roleCheck())return;counts.textContent=`正式輪迴 ${data.completed} 世 · 可領 ${data.claimable} 匣 · 持有 ${data.unopened} 匣`;odds.replaceChildren(node('h3','','每匣獲得機率'));for(const row of data.pool||[]){const copy=Object.entries(row.items).map(([k,n])=>`${names[k]||'強化卷'} ×${n}`).join(' ＋ ');odds.append(node('p','',`${row.chance}%　${copy}`));}}catch(e){if(alive&&roleCheck())status.textContent=e.message||'暫時無法同步，請點重新同步。';}finally{paint();}}
 async function perform(kind){if(!alive||!roleCheck()||controller.busy)return;const operation=controller.run(kind);paint();status.textContent=kind==='claim'?'正將四世記憶凝成星輝…':'星輝匣正在為你展開…';try{const value=await operation;if(!alive||!roleCheck())return;status.textContent=kind==='claim'?value.claimed?`已領取 ${value.claimed} 匣${value.remaining?`，尚有 ${value.remaining} 匣可接續領取`:''}`:'目前沒有尚未領取的星輝匣':'星輝已送進這位英雄的道具庫。';result.replaceChildren();if(kind==='open'){for(const [item,n]of Object.entries(value.items||{})){const row=node('div','fate-gift-award'),image=node('img','');image.src=item.startsWith('guaranteed_')?'/art/items-scrolls-pink-20261018/'+item+'.webp':'/art/items-scrolls-cutout-20261011/'+item+'.webp';image.alt=names[item]||'強化卷';row.append(image,node('strong','',`${names[item]||'強化卷'} ×${n}`));if(item.startsWith('guaranteed_'))row.append(node('small','','100% 成功 · 手動選用'));result.append(row);}}await sync();try{await host.refresh?.();}catch{} }
  catch(e){if(alive&&roleCheck())status.textContent=(e.message||'連線暫時中斷')+(controller.pending(kind)?' 點「重試」將核對同一筆操作，不會重複扣匣或領取。':'');}finally{paint();}}
 claim.onclick=()=>perform('claim');open.onclick=()=>perform('open');retry.onclick=sync;
 function key(e){if(e.key==='Escape'){e.preventDefault();dispose();return;}if(e.key==='Tab'){const buttons=[close,claim,open,retry].filter(n=>!n.disabled),first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&doc.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&doc.activeElement===last){e.preventDefault();first.focus();}}}
 const timer=setInterval(()=>{if(alive&&!changing)roleCheck();},400);
 function dispose(){if(!alive)return;alive=false;clearInterval(timer);doc.removeEventListener('keydown',key);overlay.remove();if(app)app.inert=wasInert;doc.body.style.overflow=overflow;if(focused?.isConnected)focused.focus();opened=null;}
 close.onclick=dispose;doc.addEventListener('keydown',key);close.focus();opened={close:dispose};void sync();return opened;
}
