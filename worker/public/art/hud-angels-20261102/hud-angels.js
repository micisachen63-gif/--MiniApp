/* Non-invasive preview installer. Uses existing controls and their liquid animation. */
(() => {
 'use strict';
 const source=new URL('.',document.currentScript.src);
 function install(doc){
  if(!doc?.querySelector('#hud-v2-actions')||!doc.querySelector('.candidate-orb'))return false;
  if(doc.documentElement.classList.contains('angel-hud-active'))return true;
  const css=doc.createElement('link');css.rel='stylesheet';css.href=new URL('hud-angels.css',source).href;doc.head.append(css);
  for(const [selector,file] of [['.orb.red','angel-good-left-v1.png'],['.orb.blue','angel-fallen-right-v1.png']]){
   const orb=doc.querySelector(selector);if(!orb)continue;
   const image=doc.createElement('img');image.className='angel-hud-statue';image.alt='';image.setAttribute('aria-hidden','true');image.draggable=false;image.src=new URL(file,source).href;orb.append(image);
  }
  doc.documentElement.classList.add('angel-hud-active');
  const bar=doc.querySelector('#bar'),left=doc.querySelector('.orb.red'),right=doc.querySelector('.orb.blue');
  const align=()=>{const b=bar.getBoundingClientRect(),l=left.getBoundingClientRect(),r=right.getBoundingClientRect();bar.style.setProperty('--angel-base-left',`${l.left-b.left}px`);bar.style.setProperty('--angel-base-width',`${r.right-l.left}px`);};
  const observer=new doc.defaultView.ResizeObserver(align);observer.observe(bar);observer.observe(left);observer.observe(right);align();
  return true;
 }
 const frame=document.getElementById('demo');
 if(frame){
  let timer=null;
  const start=()=>{clearInterval(timer);let attempts=0;timer=setInterval(()=>{if(install(frame.contentDocument)||++attempts>120)clearInterval(timer);},100);};
  frame.addEventListener('load',start);start();
 }else install(document);
})();
