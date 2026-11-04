/* Shared battle-window navigation. A single context owns every draft and view. */
(() => {
 'use strict';
 const scopeKey=c=>JSON.stringify([String(c?.accountId||''),String(c?.realmId||''),String(c?.characterId||''),Number(c?.epoch)||0]);
 const paramsKey=p=>JSON.stringify(Object.keys(p||{}).sort().map(k=>[k,p[k]]));
 function createState({routes,getContext}) {
  const allowed=new Set(routes),drafts=new Map();let scope=scopeKey(getContext()),history=[],version=0;
  const key=e=>e.route+':'+paramsKey(e.params);
  function syncContext(){const next=scopeKey(getContext());if(next===scope)return false;scope=next;history=[];drafts.clear();version++;return true;}
  function current(){return history.at(-1)||null;}
  function navigate(route,params={},options={}){
   if(!allowed.has(route))throw Error('未知功能入口');
   syncContext();
   const safe={};for(const [k,v]of Object.entries(params||{}))if(['string','number','boolean'].includes(typeof v)||v===null)safe[k]=v;
   const entry=Object.freeze({route,params:Object.freeze(safe)});
   if(options.reset)history=[];
   if(current()&&key(current())===key(entry))return current();
   history.push(entry);version++;return entry;
  }
  function back(){syncContext();if(!history.length)return null;history.pop();version++;return current();}
  function close(){if(history.length){history=[];version++;}}
  function draft(entry=current()){if(!entry)return {};const id=key(entry);if(!drafts.has(id))drafts.set(id,{});return drafts.get(id);}
  function ticket(){const capturedScope=scope,capturedVersion=version;return ()=>capturedScope===scopeKey(getContext())&&capturedScope===scope&&capturedVersion===version&&!!current();}
  return {navigate,back,close,current,draft,ticket,syncContext,depth:()=>history.length,version:()=>version};
 }
 function create(options){
  const doc=options.root.ownerDocument,root=options.root,nav=options.navigation;
  const state=createState({routes:Object.keys(options.routes),getContext:options.getContext});
  let dialog=null,body=null,mounted=null,previousFocus=null,activeDraft=null,disposed=false,restoreObserver=null;
  const savedInert=new Map(),navHome=nav.parentNode,navNext=nav.nextSibling;
  let readable=false;try{readable=localStorage.getItem('rpg:scene-readable')==='true';}catch{}
  function stopObserver(){restoreObserver?.disconnect();restoreObserver=null;}
  function saveView(){if(activeDraft&&body)activeDraft.__windowScroll=body.scrollTop;stopObserver();}
  function releaseView(){saveView();try{mounted?.dispose?.();}finally{mounted=null;}}
  function focusables(){return [...dialog.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(e=>e.tabIndex>=0&&!e.disabled&&!e.closest('[inert]')&&e.getClientRects().length);}
  function ensureDialog(){
   if(dialog)return;
   previousFocus=doc.activeElement;
   dialog=doc.createElement('section');dialog.className='scene-social-dialog scene-unified-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','scene-social-title');
   dialog.innerHTML='<div class="scene-social-backdrop"></div><div class="scene-social-card" tabindex="-1"><header><button type="button" class="scene-window-back" aria-label="返回">‹</button><h2 id="scene-social-title"></h2><button type="button" class="scene-window-readability" aria-pressed="false" title="提高文字與面板對比">易讀模式</button><button type="button" class="scene-window-close" aria-label="關閉視窗">×</button></header><p class="scene-window-context"></p><div class="scene-social-body"></div></div>';
   body=dialog.querySelector('.scene-social-body');
   for(const child of [...root.children])if(child!==nav){savedInert.set(child,child.inert);child.inert=true;}
   dialog.append(nav);root.append(dialog);nav.inert=false;
   dialog.querySelector('.scene-window-back').onclick=back;
   dialog.querySelector('.scene-window-close').onclick=close;
   dialog.querySelector('.scene-social-backdrop').onclick=close;
   const readability=dialog.querySelector('.scene-window-readability');
   const paintReadable=()=>{dialog.classList.toggle('scene-unified-readable',readable);readability.setAttribute('aria-pressed',String(readable));};
   readability.onclick=()=>{readable=!readable;try{localStorage.setItem('rpg:scene-readable',String(readable));}catch{}paintReadable();};
   paintReadable();
   try{window.Telegram?.WebApp?.BackButton?.show();}catch{}
  }
  function restoreScroll(entry,draft){
   stopObserver();const valid=state.ticket(),value=Number(draft.__windowScroll)||0;
   const restore=()=>{if(!valid()||!body)return true;body.scrollTop=value;const done=body.scrollHeight-body.clientHeight>=value||value===0;if(done)stopObserver();return done;};
   if(!restore()&&typeof MutationObserver!=='undefined'){restoreObserver=new MutationObserver(restore);restoreObserver.observe(body,{childList:true,subtree:true});}
  }
  function render(entry){
   releaseView();ensureDialog();body.replaceChildren();activeDraft=state.draft(entry);
   const definition=options.routes[entry.route],valid=state.ticket();
   dialog.querySelector('h2').textContent=definition.title;
   dialog.querySelector('.scene-window-context').textContent=options.contextLabel?.()||'';
   dialog.dataset.route=entry.route;
   nav.querySelectorAll('[data-scene-primary]').forEach(button=>{if(button.dataset.scenePrimary===definition.group)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
   options.onNavigate?.(entry,dialog,body);
   const host={current:()=>!disposed&&valid()&&!!body?.isConnected,navigate,back,draft:activeDraft,params:entry.params};
   const container=body;
   try{
    const result=options.mount(entry,container,host);
    Promise.resolve(result).then(view=>{if(!host.current()){view?.dispose?.();return;}mounted=view||null;restoreScroll(entry,activeDraft);}).catch(error=>{if(!host.current())return;container.replaceChildren();const alert=doc.createElement('p'),retry=doc.createElement('button');alert.setAttribute('role','alert');alert.textContent=error.message||'內容暫時無法載入';retry.textContent='重新載入';retry.type='button';retry.onclick=()=>render(entry);container.append(alert,retry);});
   }catch(error){container.textContent=error.message||'內容暫時無法載入';}
   dialog.querySelector('.scene-social-card').focus({preventScroll:true});
  }
  function navigate(route,params={},navigationOptions={}){
   if(disposed)return;
   const previous=state.current();saveView();const entry=state.navigate(route,params,navigationOptions);
   if(entry!==previous||!dialog)render(entry);return entry;
  }
  function back(){
   if(!dialog)return;
   if(mounted?.handleBack?.())return;
   saveView();const entry=state.back();if(entry)render(entry);else close();
  }
  function close({restoreFocus=true}={}){
   releaseView();state.close();
   if(dialog){if(navNext?.parentNode===navHome)navHome.insertBefore(nav,navNext);else navHome.append(nav);dialog.remove();dialog=null;body=null;}
   activeDraft=null;for(const [element,value]of savedInert)element.inert=value;savedInert.clear();
   nav.querySelectorAll('[data-scene-primary]').forEach(button=>button.removeAttribute('aria-current'));
   options.onClose?.();try{window.Telegram?.WebApp?.BackButton?.hide();}catch{}
   if(restoreFocus&&previousFocus?.isConnected&&!previousFocus.closest('[inert]'))previousFocus.focus({preventScroll:true});
  }
  function syncContext(){if(state.syncContext()){close({restoreFocus:false});return true;}return false;}
  function keydown(event){
   if(!dialog)return;
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();back();return;}
   if(event.key!=='Tab')return;
   const items=focusables(),first=items[0],last=items.at(-1);
   if(!first){event.preventDefault();dialog.querySelector('.scene-social-card').focus();return;}
   if(event.shiftKey&&(doc.activeElement===first||!items.includes(doc.activeElement))){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(doc.activeElement===last||!items.includes(doc.activeElement))){event.preventDefault();first.focus();}
  }
  doc.addEventListener('keydown',keydown,true);
  const telegramBack=()=>back();try{window.Telegram?.WebApp?.BackButton?.onClick(telegramBack);}catch{}
  return {navigate,back,close,syncContext,current:state.current,getDialog:()=>dialog,getDraft:state.draft,
   update(value){mounted?.update?.(value);if(dialog)dialog.querySelector('.scene-window-context').textContent=options.contextLabel?.()||'';},
   dispose(){if(disposed)return;close({restoreFocus:false});disposed=true;doc.removeEventListener('keydown',keydown,true);try{window.Telegram?.WebApp?.BackButton?.offClick(telegramBack);}catch{}}
  };
 }
 globalThis.RpgSceneWindows={createState,create,contextKey:scopeKey};
})();
