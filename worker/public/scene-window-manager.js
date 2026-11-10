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
   dialog.innerHTML='<div class="scene-social-backdrop"></div><div class="scene-social-card" tabindex="-1"><header><button type="button" class="scene-window-back" aria-label="返回" title="上一頁"><svg class="scene-chrome-icon" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true" focusable="false"><defs><linearGradient id="scene-back-metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff0c5"/><stop offset=".45" stop-color="#ad884d"/><stop offset=".7" stop-color="#e2c48b"/><stop offset="1" stop-color="#876535"/></linearGradient><radialGradient id="scene-back-face" cx=".35" cy=".2" r=".85"><stop stop-color="#344158" stop-opacity=".62"/><stop offset="1" stop-color="#0b1525" stop-opacity=".24"/></radialGradient></defs><circle cx="22" cy="22" r="17" fill="url(#scene-back-face)" stroke="url(#scene-back-metal)" stroke-width="1.1"/><circle cx="22" cy="22" r="14.5" fill="none" stroke="#e8d7ac" stroke-opacity=".12" stroke-width=".6"/><path d="M11.8 15.8a12 12 0 0 1 9-5.7" fill="none" stroke="#fff1ce" stroke-opacity=".45" stroke-width=".7" stroke-linecap="round"/><path d="M24 15.5 17.5 22 24 28.5M18 22h11" fill="none" stroke="url(#scene-back-metal)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><h2 id="scene-social-title"></h2><button type="button" class="scene-window-readability" aria-pressed="false" title="提高文字與面板對比">易讀模式</button><button type="button" class="scene-window-close" aria-label="關閉視窗" title="關閉視窗"><svg class="scene-chrome-icon" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true" focusable="false"><defs><linearGradient id="scene-close-metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff0c5"/><stop offset=".45" stop-color="#ad884d"/><stop offset=".7" stop-color="#e2c48b"/><stop offset="1" stop-color="#876535"/></linearGradient><radialGradient id="scene-close-face" cx=".35" cy=".2" r=".85"><stop stop-color="#344158" stop-opacity=".62"/><stop offset="1" stop-color="#0b1525" stop-opacity=".24"/></radialGradient></defs><circle cx="22" cy="22" r="17" fill="url(#scene-close-face)" stroke="url(#scene-close-metal)" stroke-width="1.1"/><circle cx="22" cy="22" r="14.5" fill="none" stroke="#e8d7ac" stroke-opacity=".12" stroke-width=".6"/><path d="M11.8 15.8a12 12 0 0 1 9-5.7" fill="none" stroke="#fff1ce" stroke-opacity=".45" stroke-width=".7" stroke-linecap="round"/><path d="M17 17l10 10M27 17 17 27" fill="none" stroke="url(#scene-close-metal)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></header><p class="scene-window-context"></p><div class="scene-social-body"></div></div>';
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
   root.classList?.remove('scene-keyboard-open');root.style?.removeProperty?.('--scene-keyboard-inset');root.style?.removeProperty?.('--scene-visible-height');root.style?.removeProperty?.('--scene-visible-top');
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
  // iOS Telegram can resize visualViewport without resizing the layout viewport.
  // Keep the focused native field reachable in the one inner scroller.
  const viewport=doc.defaultView?.visualViewport;
  let hostViewport=null;try{if(doc.defaultView?.parent!==doc.defaultView)hostViewport=doc.defaultView?.parent?.visualViewport;}catch{/* Cross-origin Telegram hosts keep the local viewport fallback. */}
  let focusTimer;
  function revealField(){clearTimeout(focusTimer);focusTimer=setTimeout(()=>{
   const active=doc.activeElement,editing=dialog&&body?.contains(active)&&active?.matches?.('input,textarea,select'),win=doc.defaultView;
   if(editing&&win){let bottom=viewport?.height??win.innerHeight,top=viewport?.offsetTop??0;try{const frame=win.frameElement?.getBoundingClientRect();if(hostViewport&&frame){bottom=Math.min(bottom,hostViewport.height+hostViewport.offsetTop-frame.top);top=Math.max(0,hostViewport.offsetTop-frame.top);}}catch{}
    const inset=Math.max(0,win.innerHeight-bottom),visible=Math.max(180,bottom-top);root.style?.setProperty?.('--scene-keyboard-inset',inset+'px');root.style?.setProperty?.('--scene-visible-height',visible+'px');root.style?.setProperty?.('--scene-visible-top',top+'px');root.classList?.toggle('scene-keyboard-open',inset>80);active.scrollIntoView?.({block:'nearest',inline:'nearest'});
   }else{root.classList?.remove('scene-keyboard-open');root.style?.removeProperty?.('--scene-keyboard-inset');root.style?.removeProperty?.('--scene-visible-height');root.style?.removeProperty?.('--scene-visible-top');}
  },80);}
  doc.addEventListener('focusin',revealField);doc.defaultView?.addEventListener('resize',revealField);viewport?.addEventListener('resize',revealField);hostViewport?.addEventListener('resize',revealField);
  const telegramBack=()=>back();try{window.Telegram?.WebApp?.BackButton?.onClick(telegramBack);}catch{}
  return {navigate,back,close,syncContext,current:state.current,getDialog:()=>dialog,getDraft:state.draft,
   update(value){mounted?.update?.(value);if(dialog)dialog.querySelector('.scene-window-context').textContent=options.contextLabel?.()||'';},
   dispose(){if(disposed)return;close({restoreFocus:false});disposed=true;clearTimeout(focusTimer);doc.removeEventListener('keydown',keydown,true);doc.removeEventListener('focusin',revealField);doc.defaultView?.removeEventListener('resize',revealField);viewport?.removeEventListener('resize',revealField);hostViewport?.removeEventListener('resize',revealField);try{window.Telegram?.WebApp?.BackButton?.offClick(telegramBack);}catch{}}
  };
 }
 globalThis.RpgSceneWindows={createState,create,contextKey:scopeKey};
})();
