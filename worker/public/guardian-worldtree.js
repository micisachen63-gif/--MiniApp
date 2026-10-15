(function () {
  'use strict';
  const C = window.RpgGuardianContract;
  if (!C) throw new Error('guardian-sigil-contract.js must load before guardian-worldtree.js');
  const mounts = new WeakMap(), esc = value => String(value || '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const weekdays = ['週日，先補滿勇氣，明天再一起冒險。','週一？你上班，我守著星光就好啦。','週二了，伸個懶腰，再陪你前進。','週三，旅程過半，羽毛可別拔太急。','週四，再忍一點，週末已在雲邊。','週五？你的腳步比我的翅膀還輕呢。','週六，把今天的勇氣留給遠方吧。'];
  const playful = ['這根羽毛有點怕癢，輕一點嘛。','我的翅膀很大，膽子可沒有比較大喔。','你負責冒險，我負責優雅地看著。','別擔心，星光知道回家的路。','羽毛可不負責寫你的待辦清單喔。'];
  const impatient = ['慢點，我的羽毛也需要休假。','再戳，我的翅膀要打結啦。','好啦好啦，讓星光喘口氣。','你是在叫天使，還是在敲門呀？'];
  function taipeiDate(serverNow) {const value=typeof serverNow==='number'&&Number.isFinite(serverNow)?serverNow:Date.now(),date=new Date(value+8*3600000);return {day:date.toISOString().slice(0,10),weekday:date.getUTCDay()};}
  function wristOffset(progress){const p=Math.max(0,Math.min(1,progress)),fore=p*24*Math.PI/180,upper=p*-4*Math.PI/180,x=347+67*Math.cos(fore)-51*Math.sin(fore)-346,y=468+67*Math.sin(fore)+51*Math.cos(fore)-390;return {x:346+x*Math.cos(upper)-y*Math.sin(upper)-414,y:390+x*Math.sin(upper)+y*Math.cos(upper)-519};}
  function portraitWristOffset(progress){const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0,fore=p*14*Math.PI/180,upper=p*-3*Math.PI/180,x=265+8*Math.cos(fore)-106*Math.sin(fore)-304,y=625+8*Math.sin(fore)+106*Math.cos(fore)-507;return {x:304+x*Math.cos(upper)-y*Math.sin(upper)-273,y:507+x*Math.sin(upper)+y*Math.cos(upper)-731};}
  // Float across the authored chest, with the upper barbs clear of the face.
  // The former y=740 placed the invitation below the waist.
  const chestPoint=portrait=>portrait?{x:410,y:780}:{x:500,y:590};
  let figureSerial=0;
  function angelFigure(url,portrait=false){const id='guardian-arm-'+(++figureSerial),width=portrait?820:1000,height=portrait?1380:1500,upper=portrait?'266,497 331,512 301,645 243,651':'260,350 370,345 380,485 310,500',fore=portrait?'237,616 299,620 300,710 276,756 239,751 219,697':'295,450 415,450 470,530 445,580 325,565 285,495';return `<svg class="guardian-angel-art" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="守護大天使原畫"><defs><mask id="${id}-body"><rect width="${width}" height="${height}" fill="white"/><polygon points="${upper}" fill="black"/><polygon points="${fore}" fill="black"/></mask><clipPath id="${id}-upper"><polygon points="${upper}"/></clipPath><clipPath id="${id}-fore"><polygon points="${fore}"/></clipPath></defs><image class="guardian-angel-body" href="${esc(url)}" width="${width}" height="${height}" mask="url(#${id}-body)"/><g class="guardian-angel-upperarm"><image href="${esc(url)}" width="${width}" height="${height}" clip-path="url(#${id}-upper)"/><g class="guardian-angel-forearm"><image href="${esc(url)}" width="${width}" height="${height}" clip-path="url(#${id}-fore)"/></g></g></svg>`;}
  function markup(options = {}) {
    const tree = C.safeArtUrl(options.treeArtUrl), deity = C.safeArtUrl(options.deityArtUrl);
    const feather=C.safeArtUrl(options.featherArtUrl);
    const treeVideo=C.safeArtUrl(options.treeVideoUrl),deityVideo=C.safeArtUrl(options.deityVideoUrl);
    const transitionVideo=C.safeArtUrl(options.transitionVideoUrl);
    return `<section class="guardian-worldtree-scene" data-guardian-tree-video="${esc(treeVideo||'')}" data-guardian-deity-video="${esc(deityVideo||'')}" data-guardian-transition-video="${esc(transitionVideo||'')}" data-guardian-feather-anchor="chest" data-guardian-angel-pose="${options.angelPose==='portrait'?'portrait':'classic'}" aria-label="世界樹與守護大天使"><button type="button" class="guardian-worldtree-background" data-guardian-tree-talk aria-label="與世界樹說話">${tree ? `<img class="guardian-tree-art" src="${esc(tree)}" alt="世界樹背景原畫" decoding="async">` : '<span class="guardian-tree-placeholder"><b>世界樹</b><small>背景原畫待製作</small></span>'}</button><button type="button" class="guardian-angel-foreground" data-guardian-tree-talk aria-label="與守護天使說話">${deity ? angelFigure(deity,options.angelPose==='portrait') : '<span class="guardian-angel-placeholder">大天使原畫<br>待製作</span>'}</button><div class="guardian-tree-speech" role="status" aria-live="polite" hidden></div><div class="guardian-feather-anchor">${feather?`<span class="guardian-rest-feather"><img src="${esc(feather)}" alt="漂浮在天使胸前的銀白神羽"></span>`:''}</div></section>`;
  }
  function mount(scene, options = {}) {
    mounts.get(scene)?.cleanup();
    const speech = scene.querySelector('.guardian-tree-speech');
    const haptics = options.haptics || window.RpgGuardianHaptics?.create();
    const media = window.RpgGuardianSceneMedia?.mount(scene,options);
    let disposed = false, timer = null, shakeTimer = null,returnTimer=null,taps = [], count = 0, day = null, suppressedUntil = 0,currentProgress=0,layoutFrame=0,chestTravel=90;
    const choose = lines => {const rng=(options.random||Math.random)();return lines[Math.min(lines.length-1,Math.max(0,Math.floor((Number.isFinite(rng)?rng:0)*lines.length)))];};
    function click(event) {
      if (disposed || Date.now() < suppressedUntil || event.target.closest?.('.guardian-pull-reveal,.guardian-feather-anchor')) return;
      const target = event.target.closest?.('[data-guardian-tree-talk]'); if (!target || !scene.contains(target)) return;
      const date=taipeiDate(typeof options.serverNow==='function'?options.serverNow():options.serverNow);if(day!==date.day){day=date.day;count=0;taps=[];}
      const now = Date.now(); taps = taps.filter(time => now-time <= 800); taps.push(now); const rapid = taps.length >= 3;
      speech.hidden = false; speech.textContent = count++===0 ? weekdays[date.weekday] : rapid ? choose(impatient) : choose(playful);
      scene.classList.remove('is-tree-speaking'); void scene.offsetWidth; scene.classList.add('is-tree-speaking');
      clearTimeout(timer); clearTimeout(shakeTimer); timer = setTimeout(() => {if (!disposed) speech.hidden = true;},2400); shakeTimer = setTimeout(() => scene.classList.remove('is-tree-speaking'),420); haptics?.npcTap(rapid);
    }
    function suppressClickAfterDrag() { suppressedUntil = Date.now()+500; }
    function releasedEarly(){if(disposed)return;suppressClickAfterDrag();speech.hidden=false;speech.textContent='看來～你很緊張呢……手別抖。';scene.classList.add('is-feather-returning');clearTimeout(timer);clearTimeout(returnTimer);timer=setTimeout(()=>{if(!disposed)speech.hidden=true;},2400);returnTimer=setTimeout(()=>scene.classList.remove('is-feather-returning'),280);progress(0);}
    function progress(value) {
      if (disposed) return;
      const p = Number.isFinite(value)?Math.max(0,Math.min(1,value)):0,chest=scene.dataset?.guardianFeatherAnchor==='chest';currentProgress=p;scene.style.setProperty('--guardian-limb-progress',String(chest?0:p));
      media?.setInteracting(p>0);
      if(chest){scene.style.setProperty('--guardian-chest-progress',String(p));scene.style.setProperty('--guardian-wrist-x','0px');scene.style.setProperty('--guardian-wrist-y','0px');scene.style.setProperty('--guardian-feather-detach','0');if(p>0)suppressClickAfterDrag();return;}
      const svg=scene.querySelector('.guardian-angel-art'),matrix=svg?.getScreenCTM?.(),wrist=scene.dataset?.guardianAngelPose==='portrait'?portraitWristOffset(p):wristOffset(p);
      scene.style.setProperty('--guardian-wrist-x',`${matrix?matrix.a*wrist.x+matrix.c*wrist.y:0}px`);scene.style.setProperty('--guardian-wrist-y',`${matrix?matrix.b*wrist.x+matrix.d*wrist.y:0}px`);scene.style.setProperty('--guardian-feather-detach',String(Math.max(0,(p-.5)*2)));
      // The whole angel and wings stay anchored. Authored forearm/hand masks attach to an independent limb layer.
      if (p > 0) suppressClickAfterDrag();
    }
    function layout(){if(disposed)return;const svg=scene.querySelector('.guardian-angel-art'),matrix=svg?.getScreenCTM?.(),anchor=scene.querySelector('.guardian-feather-anchor');if(matrix&&anchor){const box=scene.getBoundingClientRect(),portrait=scene.dataset?.guardianAngelPose==='portrait',chest=scene.dataset?.guardianFeatherAnchor==='chest',point=chest?chestPoint(portrait):{x:portrait?273:414,y:portrait?731:519},x=matrix.a*point.x+matrix.c*point.y+matrix.e-box.left,y=matrix.b*point.x+matrix.d*point.y+matrix.f-box.top;anchor.style.left=x+'px';anchor.style.top=y+'px';if(chest&&Number.isFinite(box.height)&&box.height>0){chestTravel=Math.max(64,box.height*.61-y);scene.style.setProperty('--guardian-chest-pull-y',chestTravel+'px');scene.style.setProperty('--guardian-feather-fit-height',Math.min(264,Math.hypot(matrix.a,matrix.b)*620)+'px');}progress(currentProgress);}}
    const layoutObserver=typeof ResizeObserver==='function'?new ResizeObserver(layout):null;layoutObserver?.observe(scene);if(typeof requestAnimationFrame==='function')layoutFrame=requestAnimationFrame(layout);else layout();
    function imageError(event){const image=event.target;if(image.classList?.contains('guardian-tree-art'))image.outerHTML='<span class="guardian-tree-placeholder"><b>世界樹</b><small>背景原畫待製作</small></span>';else if(image.classList?.contains('guardian-angel-body'))image.outerHTML='<span class="guardian-angel-placeholder">大天使原畫<br>待製作</span>';}
    function cleanup() {if(disposed)return;disposed=true;media?.cleanup();layoutObserver?.disconnect();if(layoutFrame&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(layoutFrame);clearTimeout(timer);clearTimeout(shakeTimer);clearTimeout(returnTimer);scene.removeEventListener('click',click);scene.removeEventListener('error',imageError,true);haptics?.cleanup();if(mounts.get(scene)===api)mounts.delete(scene);}
    const api = {progress,pullDistance:()=>chestTravel,resultMode:value=>{if(!disposed)media?.setAngelVisible?.(!value);},suppressClickAfterDrag,releasedEarly,cleanup};mounts.set(scene,api);scene.addEventListener('click',click);scene.addEventListener('error',imageError,true);return api;
  }
  window.RpgGuardianWorldTree = Object.freeze({markup,mount,taipeiDate,wristOffset,portraitWristOffset,chestPoint});
})();
