// 小精靈 RPG — v0.5 battle animation layer (v0.4 + natural motion, per-path skill FX, monster spells) for the painted (art v2) Mini App stage.
// Combat is resolved server-side once per minute; this layer REPLAYS each settlement report (kills, elites, EXP, gold,
// potions, drops, relics, level-ups, deaths) as an animation queue. Gains shown always add up to the server totals;
// Between reports, combat motion is an illustration. No per-hit damage, crits, misses or enemy HP are invented.
// GPU-friendly: CSS transform/opacity keyframes on cut-out <img> fighters + a small capped canvas particle layer.
// Pauses when the tab is hidden or the stage is detached; prefers-reduced-motion → simple fades, no shakes/particles.
// v0.5 motion: anticipation → action → hit-stop → follow-through → recover, jittered timings (--d), breathing + a top-anchored
// cape/hair layer that sways (skew), per-path skill FX (red aura / shield bash / cycling elements / violet missiles / arrow rain /
// falcon + bolt) and monster spells on map 2+ / elites (telegraph circle → projectile or ground effect → hero hit reaction).
// Every displayed number comes from a committed report or the current authoritative character snapshot.
(() => {
  'use strict';
  const RMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ri = (a, b) => Math.floor(rand(a, b + 1));
  const MAX_PARTS = 90;
  const monsterLayouts = fetch('monster-layout.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const figureBounds = new Map();
  function visibleBounds(image, fallback = [0,0,1,1]) {
    if (!image || !image.naturalWidth) return fallback;
    if (figureBounds.has(image.currentSrc)) return figureBounds.get(image.currentSrc);
    try {
      const canvas=document.createElement('canvas'); canvas.width=256; canvas.height=Math.max(1,Math.round(256*image.naturalHeight/image.naturalWidth));
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let l=canvas.width,t=canvas.height,r=-1,b=-1;
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]>32){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
      const bounds=r<0?fallback:[l/canvas.width,t/canvas.height,(r+1)/canvas.width,(b+1)/canvas.height];
      figureBounds.set(image.currentSrc,bounds);return bounds;
    } catch { return fallback; }
  }

  function create(o) {
    const root = document.createElement('div'); root.className = 'bstage';
    root.innerHTML = `<div class="world"><div class="bg"></div><div class="environment" aria-hidden="true"></div><div class="ring"></div>
      <div class="fighter hero"><div class="bob"><div class="act"><img alt=""><img class="cape" alt=""><div class="bow-fx" aria-hidden="true"><svg viewBox="0 0 100 180" preserveAspectRatio="none"><path class="bowstring" d="M72 3 Q76 90 72 177"></path><path class="bowstring-pull" d="M72 3 Q56 90 72 177"></path><path class="bow-arrow" d="M42 90 L78 90 M78 90 L69 86 M78 90 L69 94"></path></svg></div><div class="staff-fx" aria-hidden="true"><svg viewBox="0 0 100 180" preserveAspectRatio="none"><circle class="staff-aura" cx="92" cy="7" r="5"></circle><circle class="staff-rune" cx="92" cy="7" r="11"></circle><path class="staff-rays" d="M92 0V-8 M92 14V22 M85 7H77 M99 7H107 M87 2L81 -4 M97 12L103 18 M97 2L103 -4 M87 12L81 18"></path></svg></div><div class="hero-sheet" aria-hidden="true"></div><div class="tint r"></div><div class="tint g"></div><div class="tint b"></div><div class="tint k"></div></div></div><div class="shadow"></div></div>
      <div class="fighter mon" style="opacity:0"><div class="mname"></div><div class="mhp" style="display:none" aria-hidden="true"><i></i><b></b></div><div class="bob"><div class="act"><img alt=""><div class="sheet" aria-hidden="true"></div><div class="tint w"></div></div></div><div class="shadow"></div></div></div>
      <canvas class="fx"></canvas><div class="floats"></div><div class="lvup">LEVEL UP</div>
      <div class="hbars"><div class="h"><i></i></div><div class="m"><i></i></div></div><div class="bagi">🎒</div><div class="status"></div><div class="mapname"></div><div class="hint"></div>
      <div class="combat-caption" style="position:absolute;left:12px;top:46px;z-index:6;color:#d5d9dd;font-size:10px;text-shadow:0 1px 3px #000;pointer-events:none">戰鬥演出・收穫依結算更新</div>
      <div class="settlement-summary" hidden aria-live="polite" style="position:absolute;left:10px;right:10px;bottom:56px;z-index:21;padding:7px 10px;border:1px solid #bd9c5b77;border-radius:8px;background:linear-gradient(120deg,#13202cef,#1d2630ec);color:#f4dfa5;font-size:11px;line-height:1.5;pointer-events:none"><div class="settlement-main"></div><div class="settlement-items" style="color:#becbd6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div></div>`;
    const q = (s) => root.querySelector(s);
    const guardianBadge=document.createElement('div');guardianBadge.className='guardian-battle-head';guardianBadge.style.cssText='position:absolute;z-index:7;pointer-events:none;width:0;height:0';root.append(guardianBadge);let guardianVisualKey='',guardianVisual=null;
    function positionGuardian(){if(document.hidden||!root.isConnected)return;if(guardianVisual?.current?.visual){guardianVisual.position(heroPt(.5,0),root.clientWidth,root.clientHeight);}else if(guardianBadge.childElementCount){const point=heroPt(.5,0);guardianBadge.style.left=point.x+'px';guardianBadge.style.top=Math.max(66,point.y-4)+'px';}}
    function syncGuardian(){
      if(!guardianVisual&&window.RpgGuardianIdleFX){guardianVisual=window.RpgGuardianIdleFX.create(root);guardianBadge.replaceChildren();guardianBadge.hidden=true;}
      if(guardianVisual){guardianVisual.update(S.me,{paused:document.hidden||!root.isConnected,reducedMotion:S.rm});positionGuardian();return;}
      const guardian=S.me?.guardian,key=guardian?`${S.me?.character?.tgId}:${guardian.id}:${guardian.quality}:${guardian.visual}:${guardian.artUrl}:${guardian.typeName}`:'';
      if(key!==guardianVisualKey){guardianVisualKey=key;guardianBadge.innerHTML=window.RpgGuardianSigil?.head(guardian)||'';}positionGuardian();
    }
    const E = { world: q('.world'), bg: q('.bg'), ring: q('.ring'), hero: q('.hero'), hAct: q('.hero .act'), hImg: q('.hero img'), cape: q('.hero img.cape'), mon: q('.mon'), mAct: q('.mon .act'), mImg: q('.mon img'),
      mName: q('.mname'), mHp: q('.mhp i'), mBar: q('.mhp'), mHpText: q('.mhp b'), mHud: null, mSheet: q('.mon .sheet'), hSheet: q('.hero-sheet'), fx: q('canvas.fx'), floats: q('.floats'), lvup: q('.lvup'), hpBar: q('.hbars .h i'), mpBar: q('.hbars .m i'), bag: q('.bagi'), status: q('.status'), mapname: q('.mapname'), hint: q('.hint'),
      settlement: q('.settlement-summary'), settlementMain: q('.settlement-main'), settlementItems: q('.settlement-items'),
      tint: (el, c) => el.querySelector(`.tint.${c}`) };

    const S = { me: null, queue: [], seen: new Set(), roundsSeen: new Set(), reportTo: new Map(), visualEpoch: 0, playEpoch: null, actionRun: 0, mon: null, running: false, rm: !!(RMQ && RMQ.matches), cls: 'sword', path: '', monIdx: 0, stalled: null, fig: null, elemI: 0, heroSheet: null, heroSheetKey: null, heroSheetRun: 0, group: [], selected: 0, pendingTarget: null, turnBusy: false };
    const cancelled = Object.assign(new Error('battle scene changed'), { cancelled: true });
    function checkScene(epoch = S.playEpoch) { if (epoch !== null && epoch !== S.visualEpoch) throw cancelled; }
    function cancelScene() {
      S.visualEpoch++; S.heroSheetRun++; S.actionRun++; S.queue.length = 0;
      window.RpgSwordBranchFX?.clearActor(E.hero);
      window.RpgMageHeroFX?.clearActor(E.hero);
      clearGroup(); targetBar.replaceChildren(); E.floats.replaceChildren();
      clearTransientFx();
      E.hero.classList.remove('hero-action-active', 'hero-sheet-active', 'down', 'slump');
      for (const node of E.hAct.querySelectorAll('.tint')) node.classList.remove('flash', 'glow', 'aura');
    }
    // Each enemy owns its DOM references and sheet metadata. Target changes are applied between turns.
    const monKeys=['mon','mAct','mImg','mName','mHp','mBar','mHpText','mHud','mSheet'];
    const stateKeys=['mon','monSheetRatio','monBodyHeight','monSheetBody','monFeet','monSheetFeet','monFrameRun','monAtlas','monSheetAction'];
    function saveEnemy(){const e=S.group[S.selected];if(e)for(const k of stateKeys)e[k]=S[k];}
    function focusEnemy(index){saveEnemy();const e=S.group[index];if(!e)return;S.selected=index;for(const k of monKeys)E[k]=e.refs[k];for(const k of stateKeys)S[k]=e[k];}
    function clearGroup(){saveEnemy();for(const e of S.group){e.refs.mon.remove();e.refs.mHud.remove();}S.group=[];S.selected=0;S.pendingTarget=null;S.mon=null;root.classList.remove('group-battle');root.style.removeProperty('--group-height');}
    const enemyTemplate=E.mon.cloneNode(true);E.mon.remove();
    // HUDs are siblings of the world/canvas. A monster's transform stacking context cannot trap a name beneath a spell ring.
    const enemyHudLayer=document.createElement('div');enemyHudLayer.className='enemy-huds';root.append(enemyHudLayer);
    function addEnemy(){
      const mon=enemyTemplate.cloneNode(true);E.world.append(mon);
      const refs={mon,mAct:mon.querySelector('.act'),mImg:mon.querySelector('img'),mName:mon.querySelector('.mname'),mBar:mon.querySelector('.mhp'),mHp:mon.querySelector('.mhp i'),mHpText:mon.querySelector('.mhp b'),mSheet:mon.querySelector('.sheet'),mHud:document.createElement('div')};
      refs.mHud.className='enemy-hud';refs.mHud.hidden=true;refs.mHud.append(refs.mName,refs.mBar);enemyHudLayer.append(refs.mHud);
      refs.mImg.addEventListener('load',fitGroup);const index=S.group.length;S.group.push({refs,mon:null,monFrameRun:0});mon.dataset.enemyIndex=refs.mHud.dataset.enemyIndex=String(index);
      mon.setAttribute('role','button');mon.tabIndex=0;mon.setAttribute('aria-label','選擇攻擊目標');
      const choose=()=>{if(S.group[index]?.mon?.hp>0){S.pendingTarget=index;renderTargets();}};
      mon.addEventListener('click',choose);refs.mHud.addEventListener('click',choose);mon.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();choose();}});focusEnemy(index);
    }
    const targetBar=document.createElement('div');targetBar.className='enemy-targets';targetBar.setAttribute('aria-label','攻擊目標');root.append(targetBar);
    function renderTargets(){
      saveEnemy();targetBar.replaceChildren();
      const requested=S.pendingTarget??S.selected;
      const target=S.group[requested]?.mon?.hp>0?requested:S.group.findIndex(e=>e.mon?.hp>0);
      // Clear every slot, including defeated enemies: a reused slot must never retain an old target cue.
      for(const [i,e]of S.group.entries()){
        const alive=!!e.mon&&e.mon.hp>0,selected=alive&&target===i;
        e.refs.mon.classList.toggle('selected-target',selected);
        e.refs.mName.classList.toggle('is-targeted',selected);
        e.refs.mHud.classList.toggle('selected-target',selected);
        e.refs.mHud.classList.toggle('elite',!!e.mon?.elite);
        e.refs.mon.setAttribute('aria-pressed',String(selected));
        if(!alive)continue;
        const b=document.createElement('button');b.type='button';b.textContent=(e.mon.elite?'★ ':'')+e.mon.name;b.setAttribute('aria-pressed',String(selected));
        b.onclick=()=>{S.pendingTarget=i;renderTargets();};targetBar.append(b);
        e.refs.mon.setAttribute('aria-label',(S.authoritative?'檢視血量 ':'攻擊 ')+e.mon.name);
      }
      E.settlement.style.bottom=(Math.max(34,targetBar.offsetHeight||34)+16)+'px';
    }
    function applyTarget(){saveEnemy();const i=S.pendingTarget;S.pendingTarget=null;if(i!==null&&S.group[i]?.mon?.hp>0)focusEnemy(i);if(!S.mon||S.mon.hp<=0){const next=S.group.findIndex(e=>e.mon?.hp>0);if(next>=0)focusEnemy(next);}renderTargets();}
    function groupSize(){return Math.max(1,Math.min(4,Number(o.groupSize)|| (S.me.battle.monsters?.length>1 ? (root.clientWidth<600?2:2+Math.min(2,Math.floor((Number(S.me.character.mapId||1)-1)/4))) : 1)));}
    function layoutGroup(){
      const n=S.group.length;root.classList.toggle('group-battle',n>1);
      const authored=S.group.some(e=>e.monAtlas),mobile=root.clientWidth<600;
      const heroRight=E.hero.offsetLeft+E.hImg.offsetWidth;
      const reserve=authored&&mobile&&S.group.some(e=>e.refs.mon.offsetWidth>root.clientWidth-heroRight-24)?Number(E.hero.dataset.figureHeight||170)+40:0;
      const rows=mobile?n:Math.ceil(n/2),pitch=Math.max(225,...S.group.map(e=>Number(e.refs.mon.dataset.animationHeight||e.refs.mon.dataset.figureHeight||175)+50));
      const columnPitch=authored?Math.max(225,...S.group.map(e=>e.refs.mon.offsetWidth+24)):225;
      if(n>1||authored){root.style.setProperty('--group-height',Math.max(320,rows*pitch+120+reserve)+'px');root.classList.add('group-battle');}
      for(const [i,e]of S.group.entries()){
        const row=mobile?i:Math.floor(i/2),col=mobile?0:i%2;
        if(n>1||authored){e.refs.mon.style.setProperty('bottom',(64+Number(E.hero.dataset.feetPadding||0)+row*pitch+reserve-Number(e.refs.mon.dataset.feetPadding||0))+'px','important');e.refs.mon.style.setProperty('right',(12+col*columnPitch)+'px','important');e.refs.mon.style.zIndex=String(3+row);}else e.refs.mon.style.zIndex='2';
        for(const label of [e.refs.mName,e.refs.mBar]){const nameW=label.offsetWidth;label.style.left=Math.max(nameW/2+8-e.refs.mon.offsetLeft,Math.min(e.refs.mon.offsetWidth/2,root.clientWidth-e.refs.mon.offsetLeft-nameW/2-8))+'px';}
      }
      positionEnemyHuds();
    }
    function positionEnemyHuds(){
      const stage=root.getBoundingClientRect();
      // Read the wave once after formation changes, then write all HUD coordinates. No per-frame layout reads or new timer.
      const positions=S.group.map(e=>{const box=e.refs.mon.getBoundingClientRect();return {e,left:box.left-stage.left-(root.clientLeft||0),top:box.top-stage.top-(root.clientTop||0),width:e.refs.mon.offsetWidth,height:e.refs.mon.offsetHeight||box.height};});
      for(const {e,left,top,width,height}of positions)Object.assign(e.refs.mHud.style,{left:left+'px',top:top+'px',width:width+'px',height:height+'px'});
    }

    async function spawnGroup(count=groupSize(),elite=false){checkScene();clearGroup();S.groupMap=S.me.character.mapId;for(let i=0;i<count;i++){addEnemy();await spawn(elite);saveEnemy();}focusEnemy(0);layoutGroup();renderTargets();}
      async function groupAttack(hit,skill){checkScene();applyTarget();const main=S.selected;const targets=skill?Math.max(1,Math.min(4,Math.floor(S.me.battle.skill.targets||1))):1;await heroAttack(hit,skill);saveEnemy();if(skill&&targets>1){let remaining=targets-1;for(const [i,e]of S.group.entries()){if(i===main||!e.mon||e.mon.hp<=0)continue;if(remaining--<=0)break;focusEnemy(i);const at=monPt(.45,.45);telegraph(at,['#8dcfff','#ffffff'],320,22);burst(at.x,at.y,10,['#8dcfff','#ffffff'],{speed:2});flash(E.mAct,'w');play(E.mAct,'knock');saveEnemy();await wait(110);}}focusEnemy(main);renderTargets();
    }
    if (RMQ && RMQ.addEventListener) RMQ.addEventListener('change', () => { S.rm = RMQ.matches; root.classList.toggle('rm', S.rm);syncGuardian();if(!S.rm&&S.me&&!paused()){const selected=S.selected;for(let i=0;i<S.group.length;i++){focusEnemy(i);if(S.monAtlas&&S.mon?.hp>0)animateMonsterSheet('idle');saveEnemy();}focusEnemy(selected);} });
    root.classList.toggle('rm', S.rm);
    const paused = () => document.hidden || !root.isConnected;
    document.addEventListener('visibilitychange', () => {root.classList.toggle('paused', document.hidden);syncGuardian();if(!document.hidden&&S.me&&S.group.length){const selected=S.selected;for(let i=0;i<S.group.length;i++){focusEnemy(i);if(S.monAtlas&&S.mon?.hp>0)animateMonsterSheet('idle');saveEnemy();}focusEnemy(selected);}});
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function wait(ms) { const epoch = S.playEpoch; checkScene(epoch); let left = ms; while (left > 0) { const st = Math.min(left, 60); await sleep(st); checkScene(epoch); if (!paused()) left -= st; } }

    // ---------- geometry ----------
    const box = (el) => { const r = el.getBoundingClientRect(), R = root.getBoundingClientRect(); return { x: r.left - R.left, y: r.top - R.top, w: r.width, h: r.height }; };
    /** point inside the hero FIGURE (heroes.json fig box: wide advancement art carries FX beside the body) */
    const heroPt = (fx, fy) => { const b = box((S.heroSheet?.nativePortraitPlacement || S.cls === "sword" && (S.heroSheet?.total === 16 || S.heroSheet?.authoredEffects)) && S.heroSheet.ready ? E.hSheet : E.hImg); const f = S.heroSheet?.nativePortraitPlacement && S.heroSheet.ready ? S.heroSheet.frameFig : S.fig || [0, 0, 1, 1]; return { x: b.x + b.w * (f[0] + (f[2] - f[0]) * fx), y: b.y + b.h * (f[1] + (f[3] - f[1]) * fy) }; };
    const heroCastPt = () => { const s=S.heroSheet,index=s?.releaseFrameIndex??s?.frameIndex??0,raw=s?.castAnchorsPx?.[index],point=Array.isArray(raw)?raw:raw&&[raw.x,raw.y];if(s?.ready&&point?.every(Number.isFinite)){const b=box(E.hSheet);return{x:b.x+b.w*point[0]/(s.cellRatio*s.cellPixelHeight),y:b.y+b.h*point[1]/s.cellPixelHeight};}return heroPt(S.path[0]==='B'?.75:.83,.38); };
    const jit = (el) => el.style.setProperty('--d', rand(0.9, 1.12).toFixed(2));
    /** hit-stop: freeze the acting fighters for a few frames at impact */
    async function hitStop(ms = 70) { if (S.rm) return; const epoch=S.playEpoch,acts=[E.hAct,E.mAct]; for (const el of acts) el.style.animationPlayState = 'paused'; await sleep(ms); for (const el of acts) el.style.animationPlayState = ''; checkScene(epoch); }
    const monPt = (fx = 0.5, fy = 0.45) => { const b = box(E.mImg); return { x: b.x + b.w * fx, y: b.y + b.h * fy }; };

    // ---------- DOM effects ----------
    function play(el, cls, vars) { if (vars) for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v); el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); el.addEventListener('animationend', () => el.classList.remove(cls), { once: true }); }
    function flash(fighterAct, c, kind = 'flash') { const t = E.tint(fighterAct, c); if (t) play(t, kind); }
    function setHeroSheetFrame(frame) {
      const s = S.heroSheet; if (!s) return;
      s.frameIndex=frame;
      const x = frame % s.cols, y = Math.floor(frame / s.cols);
      E.hSheet.style.backgroundPosition = `${s.cols > 1 ? x / (s.cols - 1) * 100 : 0}% ${s.rows > 1 ? y / (s.rows - 1) * 100 : 0}%`;
      window.RpgSwordBranchFX?.actorFrame({hero:E.hero,sheet:E.hSheet,key:S.heroSheetKey,frame,active:E.hero.classList.contains('hero-sheet-active')});
      window.RpgMageHeroFX?.actorFrame({hero:E.hero,sheet:E.hSheet,key:S.heroSheetKey,frame,active:E.hero.classList.contains('hero-sheet-active')});
    }
    function fitAuthoredHero() {
      const s=S.heroSheet;if(!s?.authoredEffects||!s.frameBounds||!E.hImg.offsetWidth)return;
      const w=parseFloat(E.hSheet.style.width),x=E.hero.offsetLeft+parseFloat(E.hSheet.style.left),l=x+w*s.frameBounds[0],r=x+w*s.frameBounds[2];
      const delta=l<12?12-l:r>root.clientWidth-12?root.clientWidth-12-r:0;
      if(Math.abs(delta)>.1)E.hero.style.marginLeft=((parseFloat(E.hero.style.marginLeft)||0)+delta)+"px";
    }
    function fitNativePortraitScale(){const s=S.heroSheet;if(!s?.nativePortraitPlacement||!s.ready)return;const unionWidth=(s.frameBounds[2]-s.frameBounds[0])*s.cellRatio*s.cellPixelHeight,bodyHeight=(s.frameFig[3]-s.frameFig[1])*s.cellPixelHeight;E.hero.style.height=Math.min(160*s.portraitCrop.height/bodyHeight,(root.clientWidth-26)*s.portraitCrop.height/unionWidth)+"px";}
    function heroFrameProgram(s) {
      const first=Math.min(s.firstFrame??3,s.total-1);
      const sequence=s.frameSequence?.length?s.frameSequence:Array.from({length:Math.max(1,s.total-first)},(_,i)=>first+i);
      const raw=s.durationsMs;
      const weights=raw?.length===sequence.length?raw:raw?.length===s.total?sequence.map(i=>raw[i]):null;
      return {sequence,weights};
    }
    function heroSheetTop(s, frameH, portraitH) {
      if (s.nativePortraitPlacement) return -s.portraitCrop.top * frameH / s.cellPixelHeight;
      if (S.cls === 'thief') return portraitH * (S.fig?.[3] ?? 1) - frameH * (s.frameFig?.[3] ?? 1);
      return portraitH - frameH;
    }
    function heroSheetAttack(duration = 680) {
      const s = S.heroSheet; if (!s || S.rm || !s.ready) return;
      const run = ++S.heroSheetRun,{sequence,weights}=heroFrameProgram(s),count=sequence.length;
      fitNativePortraitScale(); const bounds = { width: E.hImg.offsetWidth, height: E.hImg.offsetHeight };
      const frameH = bounds.height * s.heightScale, frameW = frameH * s.cellRatio;
      E.hSheet.style.width = `${frameW}px`; E.hSheet.style.height = `${frameH}px`;
      E.hSheet.style.top = `${heroSheetTop(s, frameH, bounds.height)}px`; E.hSheet.style.maxHeight = 'none';
      E.hSheet.style.left = `${s.nativePortraitPlacement ? -s.portraitCrop.left*frameH/s.cellPixelHeight : S.cls === "sword" && s.total === 16 ? 8-frameW/16 : (bounds.width-frameW)/2}px`;
      fitAuthoredHero();
      E.hero.classList.add('hero-sheet-active');
      const start = performance.now();
      const tick = (now) => {
        if (run !== S.heroSheetRun) return;
        if (document.hidden || !root.isConnected) { E.hero.classList.remove('hero-sheet-active'); setHeroSheetFrame(0); return; }
        const p = Math.min(1, Math.max(0, (now - start) / duration));
        // Ease the eight illustrated poses through anticipation, impact and recovery.
        const phase = s.authoredEffects ? (p < .55 ? .5 * p / .55 : .5 + .5 * (p - .55) / .45) : (p < .40 ? .35 * (p / .40) : p < .64 ? .35 + .38 * ((p - .40) / .24) : .73 + .27 * ((p - .64) / .36));
        let selected=sequence[Math.min(count-1,Math.floor(Math.min(.999,phase)*count))];
        if(weights){let elapsed=p*weights.reduce((n,v)=>n+v,0);for(let i=0;i<weights.length;i++){selected=sequence[i];if(elapsed<weights[i])break;elapsed-=weights[i];}}
        setHeroSheetFrame(selected);
        if (p < 1) requestAnimationFrame(tick);
        else { E.hero.classList.remove('hero-sheet-active'); setHeroSheetFrame(0); }
      };
      requestAnimationFrame(tick);
    }
    function sizeHeroSheet() {
      const s = S.heroSheet; if (!s || !s.ready) return;
      fitNativePortraitScale(); const bounds = { width: E.hImg.offsetWidth, height: E.hImg.offsetHeight };
      const frameH = bounds.height * s.heightScale, frameW = frameH * s.cellRatio;
      E.hSheet.style.width = `${frameW}px`; E.hSheet.style.height = `${frameH}px`;
      E.hSheet.style.top = `${heroSheetTop(s, frameH, bounds.height)}px`; E.hSheet.style.maxHeight = 'none';
      E.hSheet.style.left = `${s.nativePortraitPlacement ? -s.portraitCrop.left*frameH/s.cellPixelHeight : S.cls === "sword" && s.total === 16 ? 8-frameW/16 : (bounds.width-frameW)/2}px`;
      fitAuthoredHero();
      setHeroSheetFrame(0);
    }
    function classAction(cls, duration, callback) {
      const run=++S.actionRun,id = `hero-${cls}-action`; E.hero.dataset.action = id; E.hero.style.setProperty('--action-duration', `${duration}ms`);
      E.hero.classList.remove('hero-action-active'); void E.hero.offsetWidth; E.hero.classList.add('hero-action-active');
      if (callback) callback();
      return wait(duration).catch(e => { if (!e.cancelled) throw e; }).finally(() => { if (S.actionRun === run) E.hero.classList.remove('hero-action-active'); });
    }
    function float(x, y, text, cls = '', color = null) {
      if (E.floats.childElementCount > 14) E.floats.firstElementChild.remove();
      const d = document.createElement('div'); d.className = `fl ${cls}`; d.textContent = text; d.style.left = `${x}px`; d.style.top = `${y}px`; if (color) { d.style.color = color; d.style.borderColor = color; }
      d.addEventListener('animationend', () => d.remove(), { once: true }); E.floats.appendChild(d);
    }
    function shake() { if (!S.rm) play(E.world, 'shake'); }
    function flyToBag(src, from) {
      if (!src || S.rm) { play(E.bag, 'bump'); return; }
      const d = document.createElement('div'); d.className = 'loot'; d.innerHTML = `<img src="${src}" alt="">`; d.style.left = `${from.x - 15}px`; d.style.top = `${from.y - 15}px`; root.appendChild(d);
      const b = box(E.bag); const dx = b.x + b.w / 2 - from.x, dy = b.y + b.h / 2 - from.y;
      const an = d.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${dx * 0.3}px,${dy * 0.3 - 40}px) scale(1.2)`, opacity: 1, offset: 0.35 }, { transform: `translate(${dx}px,${dy}px) scale(.45)`, opacity: 0.9 }], { duration: 850, easing: 'ease-in' });
      an.onfinish = () => { d.remove(); play(E.bag, 'bump'); };
    }
    function bars() {
      const c = S.me && S.me.character; if (!c) return;
      const hp = Math.max(0, Math.min(c.maxHp, c.hp)), mp = Math.max(0, Math.min(c.maxMp, c.mp));
      E.hpBar.style.transform = `scaleX(${c.maxHp ? hp / c.maxHp : 0})`; E.mpBar.style.transform = `scaleX(${c.maxMp ? mp / c.maxMp : 0})`;
    }

    // ---------- canvas particles / projectiles ----------
    const P = []; const FX = []; let rafOn = false; let ctx = null; let W = 0, H = 0;
    function fit() { const d = Math.min(2, window.devicePixelRatio || 1); W = E.fx.clientWidth; H = E.fx.clientHeight; if (E.fx.width !== Math.round(W * d)||E.fx.height!==Math.round(H*d)) { E.fx.width = Math.round(W * d); E.fx.height = Math.round(H * d); } ctx = E.fx.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); }
    function kick() { if (!rafOn) { rafOn = true; requestAnimationFrame(frame); } }
    function burst(x, y, n, colors, { speed = 2.6, life = 0.55, size = 2.2, grav = 0.08, kind = 'spark' } = {}) {
      if (S.rm) return; for (let i = 0; i < n && P.length < MAX_PARTS; i++) { const a = rand(0, Math.PI * 2), s = rand(0.4, 1) * speed; P.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.6, life, max: life, c: colors[i % colors.length], size: rand(0.6, 1.3) * size, grav, kind }); }
      kick();
    }
    function fx(dur, draw) { if (S.rm) return; FX.push({ t0: performance.now(), dur, draw }); kick(); }
    let last = 0;
    function clearTransientFx() {
      P.length = 0; FX.length = 0; last = 0;
      const painter=ctx || E.fx?.getContext?.('2d');
      if(painter){painter.save();painter.setTransform(1,0,0,1,0,0);painter.clearRect(0,0,E.fx.width,E.fx.height);painter.restore();}
    }
    function frame(ts) {
      if (!root.isConnected) { clearTransientFx(); rafOn = false; return; }
      if (document.hidden) { requestAnimationFrame(frame); return; }
      fit(); positionGuardian(); const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016; last = ts; ctx.clearRect(0, 0, W, H);
      for (let i = FX.length - 1; i >= 0; i--) { const f = FX[i]; const k = (ts - f.t0) / f.dur; if (k >= 1) { FX.splice(i, 1); continue; } ctx.save(); f.draw(ctx, Math.max(0, k)); ctx.restore(); }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i]; p.life -= dt; if (p.life <= 0) { P.splice(i, 1); continue; }
        p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.vy += p.grav * dt * 60; const a = p.life / p.max;
        ctx.globalAlpha = a; ctx.fillStyle = p.c;
        if (p.kind === 'spark') { ctx.strokeStyle = p.c; ctx.lineWidth = p.size * 0.8; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + a), 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (FX.length || P.length) requestAnimationFrame(frame); else { rafOn = false; last = 0; ctx.clearRect(0, 0, W, H); }
    }
    function slashArc(c, big) {
      fx(big ? 300 : 230, (g, k) => {
        const r = (big ? 62 : 50); const a0 = -2.3 + k * 0.4, a1 = a0 + 2.6 * Math.min(1, k * 1.8);
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1 - k; g.lineCap = 'round';
        for (const [w, col] of [[14, 'rgba(255,200,120,.35)'], [6, 'rgba(255,240,200,.9)'], [2, '#fff']]) { g.lineWidth = w; g.strokeStyle = col; g.beginPath(); g.arc(c.x - 10, c.y + 6, r, a0, a1); g.stroke(); }
        if (big) { g.lineWidth = 4; g.strokeStyle = 'rgba(255,230,170,.8)'; g.beginPath(); g.arc(c.x - 4, c.y + 14, r * 0.8, a0 + 0.6, a1 + 0.4); g.stroke(); }
      });
    }
    function magicArrowFx(g, magic, k) {
      if (!magic) return;
      g.save(); g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.34; g.strokeStyle = magic.glow; g.lineWidth = 9; g.lineCap = 'round'; g.shadowColor = magic.glow; g.shadowBlur = 12;
      g.beginPath(); g.moveTo(-53, 0); g.lineTo(9, 0); g.stroke();
      g.globalAlpha = 0.92; g.strokeStyle = magic.core; g.lineWidth = 2.2; g.shadowBlur = 5;
      g.beginPath(); g.moveTo(-25, 0); g.lineTo(9, 0); g.stroke();
      g.fillStyle = magic.accent; g.shadowBlur = 9; g.beginPath(); g.moveTo(14, 0); g.lineTo(7, -4); g.lineTo(8, 0); g.lineTo(7, 4); g.closePath(); g.fill();
      for (let i = 0; i < 3; i++) {
        const x = -12 - i * 15, y = Math.sin(k * 18 - i * 1.7) * (2 + i);
        g.globalAlpha = 0.85 - i * 0.18; g.fillStyle = i % 2 ? magic.accent : '#ffffff';
        g.beginPath(); g.arc(x, y, 1.5 + (i === 0 ? 0.5 : 0), 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
    function projectile(from, to, dur, kind, magic = null) {
      return new Promise((res) => {
        if (S.rm) { res(); return; }
        const trail = [];
        fx(dur, (g, k) => {
          const e = kind === 'bolt' ? k : k * k * (3 - 2 * k); const arc = kind === 'arrow' ? Math.max(14, Math.abs(to.x - from.x) * 0.14) : kind === 'bolt' ? 2 : kind === 'glob' ? 34 : 8;
          const x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e - Math.sin(k * Math.PI) * arc;
          trail.push({ x, y }); if (trail.length > 9) trail.shift();
          if (kind === 'arrow' || kind === 'bolt') {
            const ang = Math.atan2(to.y - from.y - Math.cos(k * Math.PI) * arc * Math.PI * 0.5 * (kind === 'bolt' ? 0 : 1), to.x - from.x);
            if (kind === 'bolt') { g.translate(x, y); g.rotate(ang); g.strokeStyle = '#2b2b2b'; g.lineWidth = 3; g.beginPath(); g.moveTo(-16, 0); g.lineTo(6, 0); g.stroke(); g.fillStyle = '#9aa3ad'; g.beginPath(); g.moveTo(11, 0); g.lineTo(4, -4); g.lineTo(4, 4); g.fill(); g.globalAlpha = 0.4; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(-70, 0); g.lineTo(-18, 0); g.stroke(); magicArrowFx(g, magic, k); return; }
            g.translate(x, y); g.rotate(ang); g.strokeStyle = '#4a3420'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(-26, 0); g.lineTo(6, 0); g.stroke();
            g.fillStyle = '#d8d8d8'; g.beginPath(); g.moveTo(10, 0); g.lineTo(3, -3.5); g.lineTo(3, 3.5); g.fill();
            g.fillStyle = '#c94a5a'; g.fillRect(-27, -4, 7, 3); g.fillRect(-27, 1, 7, 3);
            g.globalAlpha = 0.35; g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(-60, 0); g.lineTo(-28, 0); g.stroke();
            magicArrowFx(g, magic, k);
          } else {
            g.globalCompositeOperation = 'lighter';
            const C = typeof kind === 'object' ? kind : kind === 'big' ? { a: '#ffb347', b: '#ffd27a', r: 12 } : { a: '#7fd0ff', b: '#bfe8ff', r: 9 };
            trail.forEach((p, i) => { g.globalAlpha = (i / trail.length) * 0.5; g.fillStyle = C.a; g.beginPath(); g.arc(p.x, p.y, 3 + i * 0.9 * (C.r / 9), 0, Math.PI * 2); g.fill(); });
            g.globalAlpha = 1; const rr = C.r; const gr = g.createRadialGradient(x, y, 1, x, y, rr * 1.8);
            gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, C.b); gr.addColorStop(1, 'rgba(80,140,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr * 1.8, 0, Math.PI * 2); g.fill();
          }
        });
        setTimeout(res, dur);
      });
    }
    function charge(at, dur, tint = 'rgba(150,210,255,.7)') {
      fx(dur, (g, k) => { g.globalCompositeOperation = 'lighter'; const r = 6 + k * k * 22; const gr = g.createRadialGradient(at.x, at.y, 1, at.x, at.y, r * 1.6); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.4, tint); gr.addColorStop(1, 'rgba(90,120,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(at.x, at.y, r * 1.6, 0, Math.PI * 2); g.fill(); });
      burst(at.x, at.y, 8, ['#bfe8ff', '#ffffff', '#8fb8ff'], { speed: 1.2, life: 0.4, size: 1.6, grav: -0.02, kind: 'dot' });
    }

    // ---------- per-path skill look (tier-1 letter decides the family; tier 2 = stronger version) ----------
    const PATHFX = {
      sword: { '': { col: ['#ffe7a0', '#ffffff', '#ffb84a'], label: '#ffe2a0' }, A: { col: ['#ff5a3a', '#ffb0a0', '#ffffff'], label: '#ff8a7a', aura: '#ff3b2a' }, B: { col: ['#7fb8ff', '#ffe08a', '#ffffff'], label: '#bcd8ff', bash: true } },
      mage: { '': { col: ['#bfe8ff', '#ffffff', '#7fb0ff'], label: '#bfe6ff' }, A: { col: null, label: '#ffd0a0', cycle: true }, B: { col: ['#c58cff', '#f0dcff', '#ffffff'], label: '#e0c0ff', missiles: true } },
      archer: { '': { col: ['#fff4c0', '#ffd27a', '#ffffff'], label: '#fff0b0' }, A: { col: ['#d8ffb0', '#ffffff', '#9fe870'], label: '#d8ffb0', rain: true }, B: { col: ['#ffe2a0', '#ffffff', '#c8a060'], label: '#ffe2a0', falcon: true } },
    };
    const ELEMS = [['#ff6a2a', '#ffd27a'], ['#3aa8ff', '#bfe8ff'], ['#7dffb0', '#e0fff0'], ['#c8a060', '#ffe7b0']];   // fire · water · wind · earth
    const pfx = () => { const t = PATHFX[S.cls] || PATHFX.sword; return t[S.path[0] || ''] || t['']; };
    function smear(c, big, col) {   // swordsman slash smear: thick gradient crescent that sweeps then thins
      fx(big ? 340 : 260, (g, k) => {
        const r = big ? 66 : 52; const a0 = -2.4 + k * 0.5, a1 = a0 + 2.8 * Math.min(1, k * 2.2);
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.max(0, 1 - k * 1.1); g.lineCap = 'round';
        for (const [w, cc] of [[18 * (1 - k * 0.6), col[0] + '55'], [8 * (1 - k * 0.5), col[1]], [2.5, '#fff']]) { g.lineWidth = Math.max(1, w); g.strokeStyle = cc; g.beginPath(); g.arc(c.x - 12, c.y + 8, r, a0, a1); g.stroke(); }
        if (big) { g.lineWidth = 5; g.strokeStyle = col[0] + 'aa'; g.beginPath(); g.arc(c.x - 2, c.y + 16, r * 0.78, a0 + 0.6, a1 + 0.5); g.stroke(); }
      });
    }
    function aura(color, dur = 520) {
      const p = heroPt(0.5, 0.55); flash(E.hAct, 'r', 'aura');
      fx(dur, (g, k) => { g.globalCompositeOperation = 'lighter'; const r = 40 + k * 46; const gr = g.createRadialGradient(p.x, p.y, 8, p.x, p.y, r); gr.addColorStop(0, color + '00'); gr.addColorStop(0.7, color + '66'); gr.addColorStop(1, color + '00'); g.globalAlpha = 1 - k; g.fillStyle = gr; g.beginPath(); g.ellipse(p.x, p.y, r * 0.7, r, 0, 0, Math.PI * 2); g.fill(); });
      burst(p.x, p.y + 30, 14, [color, '#ffb0a0', '#fff'], { speed: 1.6, life: 0.7, size: 2.2, grav: -0.09, kind: 'dot' });
    }
    function ringFlash(at, cols, dur = 360) { fx(dur, (g, k) => { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1 - k; g.lineWidth = 6 * (1 - k) + 1; for (let i = 0; i < 2; i++) { g.strokeStyle = cols[i % cols.length]; g.beginPath(); g.arc(at.x, at.y, 10 + k * (40 + i * 16), 0, Math.PI * 2); g.stroke(); } }); }
    function falcon(to, dur = 520) {   // falcon swoop: a wing silhouette on a dive arc from above-left onto the target
      return new Promise((res) => { if (S.rm) { res(); return; } const st = heroPt(0.2, -0.15);
        fx(dur, (g, k) => { const e = k * k; const x = st.x + (to.x - st.x) * k, y = st.y + (to.y - 6 - st.y) * e - Math.sin(k * Math.PI) * 20; const flap = Math.sin(k * 30) * 0.5;
          g.translate(x, y); g.rotate(0.35 + k * 0.4); g.fillStyle = '#3a2a1a'; g.beginPath(); g.moveTo(-14, -8 * (1 + flap)); g.quadraticCurveTo(-4, -2, 0, 0); g.quadraticCurveTo(-4, 2, -14, 8 * (1 + flap)); g.lineTo(-6, 0); g.fill();
          g.fillStyle = '#e8d4a8'; g.beginPath(); g.ellipse(2, 0, 7, 3, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#ffcc33'; g.beginPath(); g.moveTo(9, 0); g.lineTo(13, 1.5); g.lineTo(9, 2.5); g.fill(); });
        setTimeout(res, dur); });
    }
    function arrowRain(to, n = 5, magic = null) {
      if (S.rm) return; for (let i = 0; i < n; i++) { const x0 = to.x + rand(-34, 34), d = rand(0, 260);
        fx(420 + d, (g, k) => { const kk = Math.max(0, (k * (420 + d) - d) / 420); if (kk <= 0) return; const y = to.y - 160 + kk * 168; g.globalAlpha = kk < 0.9 ? 1 : (1 - kk) * 10;
          g.translate(x0 + (1 - kk) * 18, y); g.rotate(1.38); g.strokeStyle = '#4a3420'; g.lineWidth = 2; g.beginPath(); g.moveTo(-20, 0); g.lineTo(5, 0); g.stroke(); g.fillStyle = '#e8e8e8'; g.beginPath(); g.moveTo(9, 0); g.lineTo(3, -3); g.lineTo(3, 3); g.fill(); magicArrowFx(g, magic, kk); }); }
    }

    // ---------- monsters ----------
    function fitMonster() {
      if (!E.hImg.naturalHeight || !E.mImg.naturalHeight || !root.clientWidth) return;
      const hs = getComputedStyle(E.hero);
      const ratio = E.mImg.naturalWidth / E.mImg.naturalHeight;
      const monFigure = visibleBounds(E.mImg);
      const body = monFigure[3]-monFigure[1] || S.monBodyHeight || 1;
      const heroFigure = S.heroSheet?.ready && S.heroSheet.useAsIdle && S.fig ? S.fig : visibleBounds(E.hImg,S.fig || [0,0,1,1]);
      const heroBody = heroFigure[3]-heroFigure[1];
      const heightBoost = (S.mon && S.mon.elite ? 1.2 : 1.12) * heroBody / body;
      // Long quadrupeds and wide wings retain their proportions without becoming stage-wide giants.
      const widthBoost = (S.mon && S.mon.elite ? 1.4 : 1.3) * heroBody / Math.max(.1,ratio*(monFigure[2]-monFigure[0]));
      const boost = S.monAtlas ? heightBoost : Math.min(heightBoost,widthBoost);
      // The deployed hero dimensions are the baseline. Never resize or reposition it here.
      const heroSheetScale=S.heroSheet?.ready&&S.heroSheet.useAsIdle ? S.heroSheet.heightScale*(S.heroSheet.portraitCrop?S.heroSheet.portraitCrop.height/S.heroSheet.cellPixelHeight:1) : S.cls === "sword" && S.heroSheet?.total === 16 ? S.heroSheet.heightScale : 1;
      const heroH = E.hImg.offsetHeight * heroSheetScale;
      E.hero.dataset.figureHeight = String(heroH*heroBody);E.hero.dataset.feetPadding=String(heroH*(1-heroFigure[3]));
      E.mon.dataset.figureHeight = String(heroH*boost*body);
      E.mon.dataset.figureTop=String(heroH*boost*monFigure[1]);E.mon.dataset.feetPadding=String(heroH*boost*(1-monFigure[3]));
      E.mon.dataset.sizeFit = S.monAtlas?'authored-height':widthBoost<heightBoost?'wide-body':'height';
      const sheetH = heroH * boost * body / (S.monSheetBody || 1);
      const sheetW = sheetH * (S.monSheetRatio || ratio);
      const sourceWidth = heroH * boost * ratio;
      const width = sourceWidth*(monFigure[2]-monFigure[0]);
      E.mon.style.setProperty('height', `${heroH * boost}px`, 'important');
      E.mon.style.setProperty('width', `${width}px`, 'important');
      E.mon.style.setProperty('right', '12px', 'important');
      E.mon.style.setProperty('transform', 'none', 'important');
      const monH=heroH*boost;
      const sheetBottom=monH*(1-monFigure[3])-sheetH*(1-(S.monSheetFeet || 1));
      const minPoseY=S.monAtlas?.frameBounds?.length ? Math.min(...S.monAtlas.frameBounds.map(b=>b[1])) : null;
      const poseTop=minPoseY!==null ? monH-sheetBottom-sheetH+sheetH*minPoseY : monH*monFigure[1];
      E.mon.dataset.animationHeight=String(minPoseY!==null ? sheetH*((S.monSheetFeet || 1)-minPoseY) : heroH*boost*body);
      E.mName.style.top=`${poseTop-48}px`;
      E.mName.style.bottom='auto';
      E.mBar.style.top=`${poseTop-13}px`;
      E.mBar.style.bottom='auto';
      const feetOffset=heroH*(1-heroFigure[3])-monH*(1-monFigure[3]);
      const heroRight=E.hero.offsetLeft+E.hImg.offsetWidth*heroFigure[2];
      const overlap=Math.max(0,width-(root.clientWidth-heroRight-24));
      // Wide creatures occupy the rear ground plane on narrow screens, preserving both figures' scale.
      const depth=root.clientWidth<480?Math.min(24,overlap*.3):0;
      E.mon.dataset.groundDepth=String(depth);
      E.mon.style.setProperty('bottom', `${parseFloat(hs.bottom)+feetOffset+depth}px`, 'important');
      const imageLeft=E.mon.classList.contains('face-left')?1-monFigure[2]:monFigure[0];
      Object.assign(E.mImg.style,{width:`${sourceWidth}px`,height:'100%',objectFit:'contain',position:'absolute',left:`${-sourceWidth*imageLeft}px`,bottom:'0'});
      const sheetLeft=S.monAtlas || S.mon?.sheet?.includes('monsters-clean-20261011')?-sheetW*imageLeft:(width-sheetW)/2;
      Object.assign(E.mSheet.style, {inset:'auto',bottom:`${monH*(1-monFigure[3])-sheetH*(1-(S.monSheetFeet || 1))}px`,left:`${sheetLeft}px`,width:`${sheetW}px`,height:`${sheetH}px`});
    }
    function fitGroup(){if(S.heroSheet?.nativePortraitPlacement&&S.heroSheet.ready)sizeHeroSheet();if(!S.group.length){fitMonster();positionGuardian();return;}const selected=S.selected;saveEnemy();for(let i=0;i<S.group.length;i++){focusEnemy(i);fitMonster();saveEnemy();}focusEnemy(selected);layoutGroup();positionGuardian();}
    const monsterResize = new ResizeObserver(fitGroup); monsterResize.observe(root);
    E.hImg.addEventListener('load', fitGroup);
    E.mImg.addEventListener('load', fitGroup);
    function monsterFor(elite) {
      const b = S.me.battle; const list = b.monsters || []; const name = elite ? b.elite : list[(S.monIdx++) % Math.max(1, list.length)];
      return { name, elite, src: o.src(elite ? 'elite' : 'monster', name) || o.src('monster', list[0]), sheet: o.src(elite ? 'eliteAnim' : 'monsterAnim', name) };
    }
    function monsterHealth(){
      const known=S.mon?.known,bar=E.mBar;
      bar.style.display=known?'block':'none';bar.setAttribute('aria-hidden',String(!known));
      if(!known)return;
      const hp=Math.max(0,Math.min(S.mon.max,S.mon.hp));
      E.mHp.style.transform=`scaleX(${hp/S.mon.max})`;
      E.mHpText.textContent=`${o.fmt(hp)}／${o.fmt(S.mon.max)}`;
      bar.setAttribute('role','meter');bar.setAttribute('aria-label',S.mon.name+'生命值');
      bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax',String(S.mon.max));bar.setAttribute('aria-valuenow',String(hp));
      E.mon.dataset.enemyId=S.mon.id;
      E.mHud.dataset.enemyId=S.mon.id;
    }
    async function spawn(elite = false,record=null) {
      const m = record?{...record,src:o.src(record.elite?'elite':'monster',record.name),sheet:o.src(record.elite?'eliteAnim':'monsterAnim',record.name)}:monsterFor(elite); const owner=S.group[S.selected],refs=owner?.refs;
      S.mon = { ...m, known:!!record, max:record?.maxHp||1, hp:record?.hp??1 };
      S.monAtlas=window.RpgMonsterExpansion?.spec(m.spriteKey || m.name);
      saveEnemy();
      S.monSheetRatio = null;
      S.monBodyHeight = 1;
      S.monSheetBody = 1;
      S.monFeet = 1; S.monSheetFeet = 1;
      S.monSheetAction = null;
      E.mon.classList.remove('sheet-active'); S.monFrameRun = (S.monFrameRun || 0) + 1;
      E.mon.classList.toggle('face-left', [1,3].includes(Number(S.me.character.mapId)) && !m.sheet?.includes('monsters-clean-20261011') && !S.monAtlas);
      E.mon.classList.toggle('elite', !!elite); E.mon.classList.remove('sheet-ready'); E.mon.classList.toggle('sheet-single-idle', m.name === '蛇髮女妖'); if (m.src) E.mImg.src = m.src; else E.mImg.removeAttribute('src');
      E.mSheet.style.backgroundImage = m.sheet ? `url("${m.sheet}")` : ''; E.mSheet.classList.remove('attack');
      E.mon.dataset.expansion=String(!!S.monAtlas);
      E.mSheet.style.backgroundSize=S.monAtlas?`${S.monAtlas.cols*100}% ${S.monAtlas.rows*100}%`:'';
      E.mSheet.style.backgroundPosition=S.monAtlas?'0% 0%':'';
      if (m.sheet) {
        const sheetImage = new Image();
        sheetImage.onload = () => {
          if(owner && !S.group.includes(owner))return;
          const selected=S.selected;if(owner)focusEnemy(S.group.indexOf(owner));
          if (!S.mon || S.mon.src !== m.src || S.mon.sheet !== m.sheet) {if(owner)focusEnemy(selected);return;}
          S.monSheetRatio = (sheetImage.naturalWidth / (S.monAtlas?.cols||5)) / (sheetImage.naturalHeight / (S.monAtlas?.rows||2));
          saveEnemy();if(owner)focusEnemy(selected);
          monsterLayouts.then(layout => {
            if(owner && !S.group.includes(owner))return;
            const selected=S.selected;if(owner)focusEnemy(S.group.indexOf(owner));
            if (!S.mon || S.mon.src !== m.src || S.mon.sheet !== m.sheet) {if(owner)focusEnemy(selected);return;}
            S.monSheetBody = S.monAtlas?.bodyHeight || layout[m.sheet.split('/').at(-1).split('?')[0]]?.bodyHeight || 1;
            S.monBodyHeight = S.monAtlas?.bodyHeight || layout[m.src.split('/').at(-1).split('?')[0]]?.bodyHeight || 1;
            S.monFeet = S.monAtlas?.feet || layout[m.src.split('/').at(-1).split('?')[0]]?.feet || 1;
            S.monSheetFeet = S.monAtlas?.feet || layout[m.sheet.split('/').at(-1).split('?')[0]]?.feet || 1;
            fitMonster(); E.mon.classList.add('sheet-ready');saveEnemy();if(S.monAtlas)animateMonsterSheet('move');if(owner)focusEnemy(selected);layoutGroup();
          });
        };
        sheetImage.src = m.sheet;
      }
      fitMonster();
      E.tint(E.mAct, 'w').style.setProperty('--m', `url("${m.src}")`);
      E.mName.textContent = elite ? `★ ${m.name}` : m.name; monsterHealth();
      E.mon.removeAttribute('aria-hidden');E.mon.tabIndex=0;
      saveEnemy(); E.mon.style.opacity = '1';positionEnemyHuds();E.mHud.hidden=false; play(E.mAct, 'spawn'); await wait(S.rm ? 150 : 560);
    }
    function animateMonsterSheet(action = 'attack', actionDuration = null) {
      if (!S.mon || !S.mon.sheet || !E.mon.classList.contains('sheet-ready') || S.rm) return;
      E.mon.classList.add('sheet-active');
      const sheet = S.mon.sheet;const owner=S.group[S.selected],monEl=E.mon,sheetEl=E.mSheet;
      if(S.monAtlas){
        const meta=S.monAtlas,api=window.RpgMonsterExpansion,run=S.monFrameRun=(S.monFrameRun||0)+1;
        S.monSheetAction=action;
        if(owner){owner.monFrameRun=run;owner.monSheetAction=action;}
        const duration=actionDuration || (action==='death'?720:action==='hurt'?240:action==='move'?560:620);
        let start;
        const tick=now=>{
          if(owner?!S.group.includes(owner)||owner.monFrameRun!==run:run!==S.monFrameRun)return;
          if(S.rm){monEl.classList.remove('sheet-active');sheetEl.style.backgroundPosition='0% 0%';return;}
          start??=now;const elapsed=now-start,p=Math.min(1,elapsed/duration);
          sheetEl.style.backgroundPosition=api.position(meta,api.frame(meta,action,p,elapsed/1000));
          if((action==='idle'||p<1)&&!paused())requestAnimationFrame(tick);
          else if(action!=='death'&&action!=='idle'){
            const selected=S.selected;if(owner)focusEnemy(S.group.indexOf(owner));
            animateMonsterSheet('idle');saveEnemy();if(owner)focusEnemy(selected);
          }
        };
        requestAnimationFrame(tick);return;
      }
      if (sheet.includes('monsters-clean-20261011')) {
        const run = S.monFrameRun = (S.monFrameRun || 0) + 1;
        const seq = action === 'cast' ? [5,6,7,4,9] : [0,1,2,3,4,9];
        if(owner)owner.monFrameRun=run;
        let start;
        const tick = now => {
          if (owner ? !S.group.includes(owner)||run!==owner.monFrameRun : run!==S.monFrameRun) return;
          start ??= now; const p = Math.min(1, (now-start)/620);
          const f = seq[Math.min(seq.length-1, Math.floor(p*seq.length))];
          sheetEl.style.backgroundPosition = `${f%5*25}% ${Math.floor(f/5)*100}%`;
          if (p < 1 && !paused()) requestAnimationFrame(tick);
          else monEl.classList.remove('sheet-active');
        };
        requestAnimationFrame(tick);
      } else {
        play(E.mSheet, 'attack');
        E.mSheet.addEventListener('animationend', () => monEl.classList.remove('sheet-active'), {once:true});
      }
    }
    // ---------- one hero attack (class + path specific) → resolves at impact ----------
    async function skillEffect(from, to, remaining, skill = true) {
      if (S.rm || !window.RpgSkillFX) return;
      const profile = { artKey:S.heroSheetKey, ...window.RpgSkillFX.profile(skill ? (S.playSkillName || S.me.battle.skill.name) : "", S.cls, S.path), basic: !skill };
      const theme=window.RpgMonsterExpansion?.themeColor(S.me);if(theme)profile.color=theme;
      const duration = S.cls==='thief'?Math.max(1,remaining):Math.max(160, remaining) / .65;
      const bodyHeight=S.heroSheet?.nativePortraitPlacement?(S.heroSheet.frameFig[3]-S.heroSheet.frameFig[1])*E.hSheet.getBoundingClientRect().height:E.hImg.getBoundingClientRect().height;
      const scale = Math.max(.4, Math.min(1.3, bodyHeight / 350));
      fx(duration, (g, k) => { g.save(); g.translate(from.x, from.y); g.scale(scale, scale);
        profile.poseFrame=S.heroSheet?.frameIndex;
        window.RpgSkillFX.draw(g, k, { x: 0, y: 0 }, { x: (to.x-from.x)/scale, y: (to.y-from.y)/scale }, profile); g.restore(); });
      await wait(duration * (S.cls==='thief'?1:.65));
    }
    async function heroAttack(hit, skill) {
      const epoch=S.playEpoch,c = S.me.character; const b = S.me.battle; const L = pfx();let impactCommitted=false;
      const commitImpact=()=>{if(impactCommitted)return;checkScene(epoch);hit.impact?.();impactCommitted=true;};jit(E.hAct);
      if(!S.rm){
        // Sync already starts these loads. Await the same jobs before the first
        // visual action, so slow decoding cannot silently skip authored phases.
        const key=S.heroSheetKey;
        await Promise.all([
          window.RpgHeroArtFX?.prepare(key),
          window.RpgSwordBranchFX?.warm(key),
          window.RpgMageHeroFX?.warm(key),
          window.RpgSkillFX?.prepare(S.cls,S.path)
        ].map(job=>Promise.resolve(job).catch(()=>null)));
        checkScene(epoch);
      }
      if (skill) { const p = heroPt(0.5, 0.06); float(Math.max(70, p.x), Math.max(58, p.y), hit.skillName||b.skill.name, 'skill', L.label); }
      S.playSkillName=skill?(hit.skillName||b.skill.name):"";
      const target = monPt(0.45, 0.45); let col = L.col; let swordRecovery = null;
      const skillLook = window.RpgSkillFX ? window.RpgSkillFX.profile(skill ? b.skill.name : "", S.cls, S.path) : null;
      if (skillLook) col = [skillLook.color, '#ffffff', skillLook.color];
      if (S.cls === 'sword') {
        const hb = box(E.hImg), mb = box(E.mImg); const lx = Math.max(30, mb.x - (hb.x + hb.w * ((S.fig || [0, 0, 1])[2])) + hb.w * 0.3);
        const sword16 = S.cls === "sword" && S.heroSheet?.total === 16 && /^[AB][12]{1,3}$/.test(S.path);
        const duration = S.rm ? 80 : sword16 ? 1200 : (S.heroSheet && S.heroSheet.total === 8 && (!S.path || /^[AB](?:[12]){0,3}$/.test(S.path)) ? 2000 : 520);
        heroSheetAttack(duration);
        if (skill && L.aura && !S.heroSheet?.authoredEffects) aura(L.aura);
        const action = classAction('sword', duration, () => play(E.hAct, skill && L.bash ? 'bash' : 'slash', { '--lx': `${lx}px` }));
        await wait(S.rm ? 80 : Math.round(duration * (sword16 ? .30 : .55)));
        if (window.RpgSkillFX) await skillEffect(heroPt(.7,.4), target, duration * (sword16 ? .34 : .45), skill);
        else if (skill && L.bash) { ringFlash(target, ['#7fb8ff', '#ffe08a']); flash(E.hAct, 'b', 'glow'); }
        else smear(target, skill, col);
        if(sword16) swordRecovery=action; else await action;
      } else if (S.cls === 'archer') {
        const arrowMagic = S.path[0] === 'B'
          ? { glow: '#8067ff', core: '#d7d1ff', accent: '#7de6ff' }
          : { glow: '#35dfbd', core: '#fff0b0', accent: '#f7bd54' };
        const duration = S.rm ? 80 : (S.heroSheet && S.heroSheet.total === 8 && (!S.path || /^[AB](?:[12]){0,3}$/.test(S.path)) ? 2000 : (S.path[0] === 'B' ? 780 : 850));
        heroSheetAttack(duration);
        const draw = classAction('archer', duration, () => play(E.hAct, 'draw'));
        await wait(S.rm ? 0 : Math.round(duration * .60)); // full two-second animation, release at 60%
        const from = heroPt(0.88, 0.4);
        if (window.RpgSkillFX) await skillEffect(from, target, duration * .40, skill);
        else if (skill && L.falcon) { falcon(target); await wait(160); await projectile(from, target, 200, 'bolt', arrowMagic); }
        else if (skill && L.rain) { projectile({ x: from.x, y: from.y - 4 }, { x: target.x, y: target.y - 60 }, 260, 'arrow', arrowMagic); arrowRain(target, S.path.length > 1 ? 7 : 5, arrowMagic); await wait(460); }
        else { if (skill) { projectile({ x: from.x, y: from.y - 6 }, { x: target.x, y: target.y - 8 }, 260, S.path[0] === 'B' ? 'bolt' : 'arrow', arrowMagic); await wait(90); } await projectile(from, target, S.path[0] === 'B' ? 210 : 300, S.path[0] === 'B' ? 'bolt' : 'arrow', arrowMagic); }
        await draw;
      } else if (S.cls === 'thief') {
        const nativeDuration=S.heroSheet?.durationMs||1000,speed=Math.max(1,Math.min(3,Number(hit.attackSpeedMultiplier||b.attackSpeedMultiplier)||1));
        const duration=S.rm?80:nativeDuration/speed;
        heroSheetAttack(duration);
        const action=classAction('thief',duration,()=>play(E.hAct,'slash',{'--lx':'24px'}));
        const program=S.heroSheet&&heroFrameProgram(S.heroSheet),releaseIndex=S.heroSheet?.releaseFrameIndex,
          releasePosition=program?.sequence.indexOf(releaseIndex),sum=program?.weights.reduce((n,v)=>n+v,0)||1;
        const releaseMs=Number.isFinite(S.heroSheet?.releaseAtMs)?S.heroSheet.releaseAtMs*duration/nativeDuration:(releasePosition>=0?duration*program.weights.slice(0,releasePosition).reduce((n,v)=>n+v,0)/sum:duration*.42);
        await wait(S.rm?0:releaseMs);checkScene(epoch);
        // Timers can resolve just before the RAF that paints this authored pose.
        // Paint the exact release cell synchronously before the one server HP impact.
        if(!S.rm&&S.heroSheet?.ready&&Number.isInteger(releaseIndex)&&program?.sequence.includes(releaseIndex))setHeroSheetFrame(releaseIndex);
        commitImpact();
        if(window.RpgSkillFX)await skillEffect(heroCastPt(),target,Math.max(1,duration-releaseMs),skill);
        else smear(target,skill,col);
        await action;
      } else {
        const twoSecondMageSheet = S.cls === 'mage' && S.heroSheet && ((!S.path && S.heroSheet.total === 8) || (S.path.length === 1 && S.heroSheet.total === 12));
        const duration = S.rm ? 80 : (S.heroSheet?.durationMs || (twoSecondMageSheet ? 2000 : (S.path[0] === 'B' ? 900 : 940)));
        heroSheetAttack(duration);
        const tip = heroPt(c.gender === 'm' ? 0.9 : 0.92, 0.05);
        let orb = skill ? 'big' : 'orb';
        if (L.cycle) { const e = ELEMS[S.elemI++ % ELEMS.length]; orb = { a: e[0], b: e[1], r: skill ? 13 : 9 }; col = [e[0], e[1], '#ffffff']; }
        else if (L.missiles) { orb = { a: '#a35cff', b: '#e6cfff', r: skill ? 8 : 7 }; }
        const casting = classAction('mage', duration, () => { play(E.hAct, 'channel'); if(!S.heroSheet?.durationsMs)charge(tip, duration, skillLook ? skillLook.color + 'bb' : L.missiles ? 'rgba(190,120,255,.7)' : L.cycle ? `${typeof orb === 'object' ? orb.a : '#96d2ff'}bb` : undefined); flash(E.hAct, 'b', 'aura'); });
        const releaseIndex=S.heroSheet?.releaseFrameIndex??(S.heroSheet?.total===4?2:null);
        const releaseProgram=S.heroSheet&&heroFrameProgram(S.heroSheet),releasePosition=releaseProgram?.sequence.indexOf(releaseIndex);
        const releaseMs=S.heroSheet?.releaseAtMs??(releasePosition>=0&&releaseProgram.weights?duration*releaseProgram.weights.slice(0,releasePosition).reduce((n,v)=>n+v,0)/releaseProgram.weights.reduce((n,v)=>n+v,0):Math.round(duration*.53));
          await wait(S.rm ? 0 : releaseMs);
        play(E.hAct, 'cast');
        // Release after the forward cast begins, so the projectile visibly leaves with the staff thrust.
        await wait(S.rm || S.heroSheet?.durationsMs ? 0 : 70);
        if (skillLook) { col = [skillLook.color, '#ffffff', skillLook.color]; await skillEffect(heroCastPt(), target, S.heroSheet?.durationsMs?duration-releaseMs:duration*.47-70, skill); }
        else if (L.missiles && skill) { for (let i = 0; i < 3; i++) { projectile({ x: tip.x, y: tip.y + i * 6 }, { x: target.x + rand(-8, 8), y: target.y + rand(-14, 10) }, 300 + i * 70, orb); } await wait(440); }
        else await projectile(tip, target, 340, orb);
        await casting;
        if (!col) col = ['#bfe8ff', '#ffffff', '#7fb0ff'];
      }
      // impact → hit-stop → knockback
      const at = monPt(0.42, 0.42);
      checkScene(epoch);commitImpact(); animateMonsterSheet('hurt'); flash(E.mAct, 'w'); play(E.mAct, 'knock'); await hitStop(skill ? 70 : 45);
      burst(at.x, at.y, 12, col, { speed: 2.6 });
      if (S.cls === 'mage') burst(at.x, at.y, 10, [col[0], '#ffffff'], { speed: 1.8, life: 0.5, size: 3, grav: 0, kind: 'dot' });
      if(swordRecovery)await swordRecovery;
    }
    // ---------- monster spells (map 2+, elites): telegraph circle → projectile / ground effect ----------
    const SPELL = { 史萊姆: 'poison', 樹妖: 'roots', 骷髏兵: 'darkbolt', 毒蜘蛛: 'poison', 劇毒巨蛛: 'poison', 蛇髮女妖: 'poison', 哥布林突擊隊長: 'bomb', 火蜥蜴: 'firespit', 岩石魔像: 'rock', 炎魔: 'fireball', 炎魔衛兵: 'fireball',
      月光野兔:'wisdom',月桂樹精:'roots',林地花仙:'roots',林精斥候:'wisdom',阿耳忒彌斯巡林長:'wisdom',月桂巨樹精:'roots',青銅衛兵:'stonewave',百柱守護巨像:'stonewave',哥布林酋長:'darkbolt',
      海崖塞壬:'soul',潮汐甲蟲:'frost',波濤飛魚:'frost',海潮巨蟹:'icerock',深海狂暴巨蟹:'icerock',海崖利維坦:'frost',
      迷宮巡邏兵:'stonewave',青銅公牛:'rock',蛇髮女妖幻影:'poison',石化蝙蝠:'stonewave',迷宮巡查將軍:'stonewave',米諾斯魔牛:'rock',
      熔岩火蜥蜴:'firespit',鍛造巨傀儡:'fireball',火晶石魔:'firespit',鍛火魔蝠:'fireball',熔火鍛造長:'fireball',腐朽樹王:'roots',
      迷途遊魂:'soul',斯堤克斯骨兵:'darkbolt',冥府渡鴉:'darkbolt',三頭犬幼崽:'firespit',冥河擺渡鬼將:'soul',冥河擺渡者:'soul',
      神諭幻蟒:'wisdom',阿波羅日鷹:'fireball',預言祭司幽靈:'wisdom',日光石妖:'wisdom',神諭大祭司:'wisdom',皮同巨蟒:'poison',
      泰坦巨足獸:'rock',裂地石魔:'stonewave',山隘狂風鳥:'wisdom',雷霆蜥蜴:'wisdom',泰坦先鋒戰將:'stonewave',熔岩巨像:'fireball',
      雲海天馬:'wisdom',天界巡翼鳥:'wisdom',雲嵐仙女:'soul',聖光石像:'wisdom',雲門神廷禁軍長:'wisdom',雲門守門巨神:'stonewave',
      英雄英靈:'soul',長生鳥:'fireball',純金石獅:'wisdom',至福精靈:'roots',阿基里斯英靈:'wisdom',至福守護王者:'wisdom',
      星穹神侍:'soul',星座巨獸:'darkbolt',日冕精魄:'fireball',虛空吞噬者:'darkbolt',星穹神官長:'soul',霜龍女皇:'frost',
      百柱石像: 'stonewave', 智慧夜梟: 'wisdom', 神殿侍從鬼魂: 'soul', 神殿禁衛百夫長: 'wisdom',
      潘神幼獸: 'roots', 山林仙女: 'roots', 聖角羚羊: 'rock', 古木守衛: 'roots', 狂暴潘神衛士: 'stonewave',
      冰原狼人: 'frost', 霜巨人: 'icerock', 冰龍: 'frost', 霜巨人督軍: 'frost' };
    const SPELLCOL = { roots: ['#4a7a2a', '#a8e070'], darkbolt: ['#6a2bd0', '#d0b0ff'], poison: ['#5ac83a', '#d8ffb0'], bomb: ['#ff8a2a', '#ffe0a0'], firespit: ['#ff5a1a', '#ffd27a'], rock: ['#8a7a6a', '#d8c8b0'], stonewave: ['#9a7a45', '#f4d88a'], wisdom: ['#46a9e8', '#ffe08a'], soul: ['#76dfff', '#d0b7ff'],
      fireball: ['#ff4a10', '#ffe08a'], frost: ['#7fd8ff', '#ffffff'], icerock: ['#a8e8ff', '#ffffff'],water:['#43cfe4','#b7f8ff'],fire:['#ff7637','#ffe0a6'],sun:['#ffc448','#fff1bc'],lightning:['#a997ff','#e4eeff'] };
    const spellOf = (m) => m.spell || window.RpgMonsterExpansion?.spec(m.spriteKey || m.name)?.spell || SPELL[m.name] || (m.elite ? 'darkbolt' : null);
    function telegraph(at, cols, dur, r = 26) {
      fx(dur, (g, k) => { g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(1, k * 3) * (1 - Math.max(0, k - 0.85) / 0.15); g.translate(at.x, at.y); g.scale(1, 0.38); g.rotate(k * 3);
        g.strokeStyle = cols[0]; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); g.strokeStyle = cols[1]; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, r * 0.7, 0, Math.PI * 2); g.stroke();
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7); g.lineTo(Math.cos(a + 2.1) * r * 0.7, Math.sin(a + 2.1) * r * 0.7); g.stroke(); } });
    }
    function thorns(at, cols) { fx(560, (g, k) => { const h = Math.sin(Math.min(1, k * 1.6) * Math.PI) * 46; g.fillStyle = cols[0]; g.strokeStyle = cols[1]; g.lineWidth = 1.2;
      for (let i = -3; i <= 3; i++) { const x = at.x + i * 9, hh = h * (1 - Math.abs(i) * 0.18); g.beginPath(); g.moveTo(x - 5, at.y); g.lineTo(x + i * 1.5, at.y - hh); g.lineTo(x + 5, at.y); g.closePath(); g.fill(); g.stroke(); } }); }
    async function monsterEffect(kind, big, duration) {
      const api=window.RpgSkillFX;if(S.rm||!api?.drawMonster)return false;
      const from=monPt(.35,.4),to=heroPt(.55,.42),profile=api.monsterProfile(kind,big);
      const scale=Math.max(.4,Math.min(1.3,E.hImg.getBoundingClientRect().height/350));
      const total=duration/.65;
      fx(total,(g,k)=>{g.save();g.translate(from.x,from.y);g.scale(scale,scale);api.drawMonster(g,k,{x:0,y:0},{x:(to.x-from.x)/scale,y:(to.y-from.y)/scale},profile);g.restore()});
      await wait(duration);return true;
    }
    async function monsterCast(kind, big) {
      const epoch=S.playEpoch,cols = SPELLCOL[kind] || SPELLCOL.darkbolt; const src = monPt(0.35, 0.4); const hp = heroPt(0.55, 0.42); const feet = heroPt(0.5, 0.98);
      play(E.mAct, 'mcast'); animateMonsterSheet('cast',1040); telegraph(kind === 'roots' || kind === 'frost' ? feet : monPt(0.5, 0.96), cols, 620); await wait(S.rm ? 120 : 520);
      if (await monsterEffect(kind,big,kind==='roots'||kind==='frost'||kind==='rock'||kind==='icerock'?420:360)) { /* Impact remains synchronized with the existing damage resolution. */ }
      else if (kind === 'roots') { telegraph(feet, cols, 380, 34); await wait(200); thorns(feet, cols); await wait(220); }
      else if (kind === 'frost') { fx(520, (g, k) => { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1 - k; const w = (feet.x - src.x); for (let i = 0; i < 18; i++) { const t = (k * 1.4 + i / 18) % 1; g.fillStyle = cols[i % 2]; g.beginPath(); g.arc(src.x + w * t, src.y + (hp.y - src.y) * t + Math.sin(i * 7 + k * 9) * 10, 2.5 + t * 3, 0, Math.PI * 2); g.fill(); } }); await wait(420); }
      else await projectile(src, hp, kind === 'rock' || kind === 'icerock' ? 420 : 360, kind === 'poison' || kind === 'bomb' || kind === 'rock' || kind === 'icerock' ? { a: cols[0], b: cols[1], r: kind === 'rock' || kind === 'icerock' ? 11 : 8 } : { a: cols[0], b: cols[1], r: 10 });
      checkScene(epoch); burst(hp.x, hp.y, 12, [cols[0], cols[1], '#ffffff'], { speed: 2.2, life: 0.55 });
      if (kind === 'frost' || kind === 'icerock') flash(E.hAct, 'b'); else if (kind === 'poison' || kind === 'roots') flash(E.hAct, 'g'); else flash(E.hAct, 'r');
      return true;
    }
    async function monsterAttack(big = false) {
      const epoch=S.playEpoch;if (!S.mon) return; const hb = box(E.hImg), mb = box(E.mImg); const gap = Math.max(30, mb.x - (hb.x + hb.w * ((S.fig || [0, 0, 0.7])[2] * 0.85))); const mx = -Math.max(30, gap - (Number(S.me.character.mapId) === 3 ? 38 : 0));
      const spell = spellOf(S.mon); const mapOk = !!spell;
      const beh = String(window.RpgMonsterExpansion?.spec?.(S.mon.spriteKey || S.mon.name)?.behavior || S.mon.behavior || ''); const alwaysCast = /^(caster|flying|poison|summoner)$/.test(beh); const castP = alwaysCast ? 1 : ((big || S.mon.elite || S.mon.boss) ? 0.85 : 0.7);
      if (spell && mapOk && (alwaysCast || Math.random() < castP)) await monsterCast(spell, big);
      else { jit(E.mAct); animateMonsterSheet('attack'); play(E.mAct, 'mlunge', { '--mx': `${mx}px` });
        if(!await monsterEffect(/狼|犬|蛇|蟒|龍/.test(S.mon.name)?'bite':'claw',big,360))await wait(S.rm ? 80 : 360); }
      checkScene(epoch); const p = heroPt(0.55, 0.3);
      flash(E.hAct, 'r'); play(E.hAct, 'hit'); await hitStop(big ? 90 : 45); burst(p.x, p.y, 6, ['#ff6b6b', '#ffd0d0'], { speed: 2 });
      if (big) shake();
    }
    async function potion(key, n) {
      const it = o.items[key] || {}; const red = /^red_/.test(key); const p = heroPt(0.5, 0.18);
      flash(E.hAct, red ? 'g' : 'b', 'glow');
      burst(p.x, p.y + 30, 14, red ? ['#6dff9a', '#d8ffe4', '#3ad16a'] : ['#8fd0ff', '#ffffff', '#4f8dff'], { speed: 1.4, life: 0.8, size: 2.4, grav: -0.05, kind: 'dot' });
      // The report records consumption, not the effective heal after caps. Never infer recovered HP/MP.
      float(p.x, p.y, `使用 ${it.name || (red ? '紅水' : '藍水')} ×${o.fmt(n)}`, red ? 'heal' : 'mana');
      await wait(S.rm ? 300 : 650);
    }
    async function killMonster(k) {
      checkScene();
      const at = monPt(0.5, 0.5); animateMonsterSheet('death'); play(E.mAct, 'die'); burst(at.x, at.y + 10, 16, ['#d9c7a0', '#b49a6a', '#fff3c8'], { speed: 1.6, life: 0.7, size: 2.6, grav: -0.03, kind: 'dot' });
      await wait(S.rm ? 150 : 330);
      // Representative defeat only; exact kills and gains stay together in the settlement summary.
      await wait(S.rm ? 250 : 520); E.mon.style.opacity = '0';if(E.mHud)E.mHud.hidden=true;E.mon.tabIndex=-1;E.mon.setAttribute('aria-hidden','true'); S.mon = null; saveEnemy();renderTargets(); await wait(250);
    }
    async function levelUp(n) {
      const p = heroPt(0.5, 0.55); E.ring.style.left = `${p.x}px`; E.ring.style.top = `${p.y}px`; play(E.ring, 'on'); play(E.lvup, 'on');
      E.lvup.textContent = n > 1 ? `LEVEL UP ×${n}` : 'LEVEL UP'; flash(E.hAct, 'k', 'glow');
      burst(p.x, p.y, 34, ['#ffe9a6', '#ffc93a', '#ffffff'], { speed: 3.4, life: 1.1, size: 2.6, grav: -0.02, kind: 'dot' }); await wait(S.rm ? 900 : 1500);
    }
    async function die(r) {
      if (!S.mon) await spawnGroup(1,true); await monsterAttack(true); await wait(200);
      E.hero.classList.add('down'); const p = heroPt(0.5, 0.2); await wait(600);
      float(p.x + 30, Math.max(18, p.y), r.exp_lost ? `EXP −${o.fmt(r.exp_lost)}` : r.wards_used ? '🧿 守護符抵銷 EXP 損失' : '不扣 EXP', 'loss');
      await wait(1400); E.mon.style.opacity = '0';if(E.mHud)E.mHud.hidden=true; S.mon = null;
    }

    // ---------- report → episode ----------
    function acceptReport(id, r) {
      if (!r || !(r.ticks > 0)) return false;
      const from = Number(r.from_at), to = Number(r.to_at), key = `${id}:${from}:${to}`;
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || S.seen.has(key) || from < (S.reportTo.get(id) ?? -Infinity)) return false;
      S.seen.add(key); S.reportTo.set(id, to);
      if (S.seen.size > 256) S.seen.delete(S.seen.values().next().value);
      return true;
    }
    function settlementTotals(r) {
      return { kills: r.kills || 0, exp: r.exp_gained || 0, gold: r.gold_gained || 0, expLost: r.exp_lost || 0, drops: { ...(r.drops || {}) }, used: { ...(r.used || {}) }, relics: (r.relics || []).length };
    }
    function publishSettlement(r) {
      const t = settlementTotals(r), label = r.ticks > 5 ? '離線結算' : '本次結算';
      E.settlementMain.textContent = `${label}｜擊敗 ${o.fmt(t.kills)} · 經驗 +${o.fmt(t.exp)}${t.expLost ? ` −${o.fmt(t.expLost)}` : ''} · 金幣 +${o.fmt(t.gold)}`;
      const parts = Object.entries(t.drops).filter(([, n]) => n > 0).map(([k, n]) => `${o.items[k]?.name || k} ×${o.fmt(n)}`);
      if (t.relics) parts.push(`遺物 ×${o.fmt(t.relics)}`);
      for (const [k, n] of Object.entries(t.used)) if (n > 0) parts.push(`使用 ${o.items[k]?.name || k} ×${o.fmt(n)}`);
      E.settlementItems.textContent = parts.join(' · '); E.settlementItems.hidden = !parts.length;
      E.settlement.title = [E.settlementMain.textContent, E.settlementItems.textContent].filter(Boolean).join('\n'); E.settlement.hidden = false;
      root.dataset.lastReport = JSON.stringify(t);
      root.dataset.settlementKey = `${S.me.character.tgId}:${r.from_at}:${r.to_at}`;
    }
    function episode(r) {
      const ticks = r.ticks || 0, kills = Math.max(0, r.kills || 0);
      const V = kills > 0 ? Math.min(kills, 3) : 0;
      const nElite = Math.min(r.elites || 0, V);
      const list = Array.from({ length: V }, (_, i) => ({ elite: i >= V - nElite }));
      const pots = Object.entries(r.used || {}).filter(([k]) => /^(red|blue)_/.test(k)).map(([k, n]) => ({ k, n }));
      return { combat:r.combat, kills: list, totals: settlementTotals(r), pots, levels: r.levels_gained || 0, death: r.deaths ? { exp_lost: r.exp_lost, wards_used: r.wards_used } : null, ticks };
    }
    function sync(me, report) {
      if (!me?.character) return false;
      const previous = S.me?.character, c = me.character;
      if (previous?.tgId === c.tgId && Number(c.revision) < Number(previous.revision)) return false;
      const sceneChanged = !!previous && ['tgId','mapId','state','baseClass','classPath','gender'].some(k => previous[k] !== c[k]);
      const accepted = acceptReport(c.tgId, report);
      const feed=me.battle?.idleCombat,round=report?.combat||feed?.round;
      const enemyChanged=feed?.enemies&&JSON.stringify(feed.enemies)!==JSON.stringify(S.me?.battle?.idleCombat?.enemies);
      const newRound=round&&round.mapId===c.mapId&&!S.roundsSeen.has(round.id);
      if(newRound){S.roundsSeen.add(round.id);if(S.roundsSeen.size>256)S.roundsSeen.delete(S.roundsSeen.values().next().value);}
      if (sceneChanged || accepted || newRound || enemyChanged) cancelScene();
      if (sceneChanged) { E.settlement.hidden = true; delete root.dataset.lastReport; delete root.dataset.settlementKey; }
      S.me = me; S.cls = c.baseClass; S.path = c.classPath || '';
      window.RpgElf4AttackFX?.prepare(S.cls, S.path);
      S.authoritative=!!feed?.enemies?.length;
      q('.combat-caption').textContent=S.authoritative?'真實戰況・血量每分鐘結算':'戰鬥演出・收穫依結算更新';
      if(newRound&&!accepted)S.queue.push({combat:round,ticks:0});
      if(window.RpgSkillFX?.prepare)window.RpgSkillFX.prepare(c.baseClass,c.classPath||'');
      const hk = o.heroKey ? o.heroKey(c) : `${c.baseClass}_${c.gender}`; const heroSrc = o.src('hero', hk); const meta = o.heroMeta ? o.heroMeta(hk) : null; S.fig = meta ? meta.fig : null;
      if (S.heroSheetKey !== hk) {
        window.RpgSwordBranchFX?.clearActor(E.hero);
        window.RpgMageHeroFX?.clearActor(E.hero);
        window.RpgHeroArtFX?.prepare(hk).catch(()=>{});
        window.RpgSwordBranchFX?.warm(hk).catch(()=>{});
        window.RpgMageHeroFX?.warm(hk).catch(()=>{});
        S.heroSheetKey = hk; S.heroSheet = null; S.heroSheetRun += 1; E.hero.classList.remove('hero-sheet-active', 'hero-sheet-ready'); E.hSheet.style.backgroundImage = '';
        const a = o.heroAnim ? o.heroAnim(hk) : null;
        E.hero.dataset.authoredEffects = a?.authoredEffects ? "true" : "false";
        if (a && a.src && a.cols > 0 && a.rows > 0) {
          const image = new Image(); const spec = { cols: a.cols, rows: a.rows, total: a.cols * a.rows, firstFrame: Number.isInteger(a.firstFrame) ? a.firstFrame : 3, frameSequence:a.frameSequence,durationsMs:a.durationsMs,durationMs:a.durationMs,releaseFrameIndex:a.releaseFrameIndex,releaseAtMs:a.releaseAtMs,castAnchorsPx:a.castAnchorsPx,artKey:a.artKey,ready: false, useAsIdle: !!a.useAsIdle, cellRatio: 1, heightScale: Number(a.heightScale) || 1, preservePlacement: !!a.preservePlacement, authoredEffects: !!a.authoredEffects, frameBounds: a.frameBounds,portraitCrop:a.portraitCrop,nativePortraitPlacement:!!a.nativePortraitPlacement,frameFig:a.frameFig };
          S.heroSheet = spec; image.onload = () => { if (S.heroSheet === spec) { spec.ready = true; spec.cellRatio = (image.naturalWidth / a.cols) / (image.naturalHeight / a.rows);spec.cellPixelHeight=image.naturalHeight/a.rows; E.hSheet.style.backgroundImage = `url("${a.src}")`; E.hSheet.style.backgroundSize = `${a.cols * 100}% ${a.rows * 100}%`; if (spec.useAsIdle) { sizeHeroSheet(); E.hero.classList.add('hero-sheet-ready');fitGroup(); } else setHeroSheetFrame(0); } };
          image.onerror = () => { if (S.heroSheet === spec) { S.heroSheet = null; E.hero.classList.remove('hero-sheet-active', 'hero-sheet-ready'); } }; image.src = a.src;
        } else { E.hSheet.style.backgroundImage = ''; E.hero.classList.remove('hero-sheet-ready'); }
      }
      if (E.hImg.getAttribute('src') !== heroSrc) { E.hImg.src = heroSrc; E.cape.src = heroSrc; for (const t of E.hAct.querySelectorAll('.tint')) t.style.setProperty('--m', `url("${heroSrc}")`);
        const place = () => { const f = S.fig || [0.12, 0, 0.88, 1];
          const sword16 = S.cls === "sword" && S.heroSheet?.total === 16;
          const padded = S.heroSheet && S.heroSheet.heightScale > 1 && !S.heroSheet.preservePlacement && !sword16;
          // Preserve normal body height; fit the widest authored pose on narrow phones.
          E.hero.style.height = padded ? `${Math.min(158,Math.max(1,(root.clientWidth-36)*448/843))}px` : '';
          E.hero.style.left = padded ? '40%' : '';
          E.hero.style.marginLeft = sword16 ? '0px' : padded ? `${-E.hImg.getBoundingClientRect().width/2}px` : S.fig && E.hImg.naturalWidth ? `${-Math.round(f[0] * E.hImg.getBoundingClientRect().width)}px` : '';
          if (S.heroSheet?.ready && S.heroSheet.useAsIdle) sizeHeroSheet();
          E.cape.style.setProperty('--c0', `${Math.round((f[0] + (f[2] - f[0]) * 0.3) * 100)}%`); E.cape.style.setProperty('--c1', `${Math.round((f[0] + (f[2] - f[0]) * 0.48) * 100)}%`); };
        if (E.hImg.complete) place(); else E.hImg.addEventListener('load', place, { once: true }); }
      // Restrict hero color masks to transient combat FX; never leave the sprite tinted while idle.
      if (!E.hAct.dataset.maskReady && heroSrc) {
        E.hAct.dataset.maskReady = '1';
        const applyMasks = () => { if (E.hImg.naturalWidth && E.hImg.naturalHeight) { for (const t of E.hAct.querySelectorAll('.tint')) t.style.setProperty('--m', `url("${heroSrc}")`); } };
        if (E.hImg.complete) applyMasks(); else E.hImg.addEventListener('load', applyMasks, { once: true });
      }
      root.dataset.cls = S.cls; root.dataset.path = S.path[0] || ''; root.dataset.gender = c.gender || ''; root.dataset.mapId = String(c.mapId || 1);
      const town = c.state === 'town_no_red'; const scene = window.RpgMaps && window.RpgMaps.get(c.level);
      const bg = o.src('map', town ? 'town' : (scene ? window.RpgMaps.key(c.level) : c.mapId)); E.bg.style.backgroundImage = bg ? `url("${bg}")` : '';
      root.dataset.scene = town || !scene ? '' : String(scene.id);
      E.mon.classList.toggle('face-left', [1,3].includes(Number(c.mapId)) && !S.mon?.sheet?.includes('monsters-clean-20261011') && !S.monAtlas);
      E.mapname.textContent = town ? '🏛️ 城鎮' : (scene ? `${scene.emoji} ${scene.name}` : c.mapName);
      const si = o.stateInfo(me); E.status.textContent = si.text; E.status.className = `status ${si.cls}`;
      if (accepted) { publishSettlement(report); S.queue.push({...report,combat:newRound?round:null}); }
      bars();syncGuardian();
      if (!S.running) loop();
      return true;
    }
    function stallFor(state) {
      if (state === 'town_no_red') return { cls: 'slump', hint: '🧪 紅水用完：補水後會自動出發' };
      if (state === 'gate') return { cls: '', hint: '🔒 經驗已滿：取得材料後轉職' };
      if (state === 'reviving') return { cls: 'down', hint: '🪦 陣亡：10 分鐘後自動復活' };
      return null;
    }
    function applyStall() {
      const st = stallFor(S.me.character.state); S.stalled = st;
      root.classList.toggle('stalled', !!st); E.hint.textContent = st ? st.hint : '';
      E.hero.classList.toggle('slump', !!st && st.cls === 'slump'); E.hero.classList.toggle('down', !!st && st.cls === 'down');
      if (st && S.group.length) { clearGroup();targetBar.replaceChildren(); }
    }
    async function playEpisode(ep) {
      checkScene();
      if(S.authoritative){
        if(ep.combat&&ep.combat.mapId===S.me.character.mapId)await playServerRound(ep.combat);
        else await spawnServerGroup(S.me.battle.idleCombat.enemies);
        for(const p of ep.pots)await potion(p.k,p.n);
        if(ep.levels)await levelUp(ep.levels);
        if(ep.death)await die(ep.death);
        return;
      }
      // The server has a settlement total, not individual kill/attack records. Reprise a few scenes without distributing its totals into invented hits.
      for(let offset=0;offset<ep.kills.length;){const first=ep.kills[offset],size=first.elite?1:Math.min(groupSize(),ep.kills.length-offset);const batch=[];while(batch.length<size&&offset<ep.kills.length&&ep.kills[offset].elite===first.elite)batch.push(ep.kills[offset++]);await spawnGroup(batch.length,first.elite);
        for(let j=0;j<batch.length;j++){focusEnemy(j);await groupAttack({},S.me.character.state==='fighting');focusEnemy(j);await killMonster(batch[j]);saveEnemy();}
      }
      for (const p of ep.pots) await potion(p.k, p.n);
      if (ep.levels) await levelUp(ep.levels);
      if (ep.death) await die(ep.death);
    }
    async function skirmish({ allowLocalSpawn = true } = {}) {
      checkScene();
      if(!S.group.length||!S.group.some(e=>e.mon?.hp>0)){
        if(!allowLocalSpawn)return;
        await spawnGroup();
      }
      applyTarget();
      const casting=S.me.character.state==='fighting'&&Math.random()<.3;
      await groupAttack({},casting);saveEnemy();
      // Between settlements, keep motion vivid without inventing kills, resources or per-hit numbers.
      applyTarget();await wait(S.me.character.state==='no_mp'?1300:800);
      const live=S.group.map((e,i)=>e.mon?.hp>0?i:-1).filter(i=>i>=0);
      if(live.length&&Math.random()<.45){const selected=S.selected;focusEnemy(live[ri(0,live.length-1)]);await monsterAttack(false);await wait(500);focusEnemy(selected);applyTarget();}
    }
    async function spawnServerGroup(enemies){
      checkScene();clearGroup();S.groupMap=S.me.character.mapId;
      for(const enemy of enemies){addEnemy();await spawn(enemy.elite,enemy);saveEnemy();}
      focusEnemy(0);layoutGroup();renderTargets();
    }
    async function playServerRound(round){
      await spawnServerGroup(round.before);root.dataset.playingRound=round.id;
      for(const action of round.presentation?.monsterActions || []){
        if(action.cosmetic!==true||action.attackDirection!==-1)continue;
        const index=S.group.findIndex(e=>e.mon?.id===action.sourceId);if(index<0)continue;
        focusEnemy(index);await monsterCast(action.spell,S.mon.elite);saveEnemy();
      }
      for(const event of round.events){
        checkScene();
        if(event.type==='spawn'){focusEnemy(event.slot);await spawn(event.enemy.elite,event.enemy);saveEnemy();layoutGroup();renderTargets();continue;}
        if(event.type==='elite'){addEnemy();await spawn(true,event.enemy);saveEnemy();layoutGroup();renderTargets();if(event.enemy.spell)await monsterCast(event.enemy.spell,true);continue;}
        const index=S.group.findIndex(e=>e.mon?.id===event.targetId);if(index<0)continue;focusEnemy(index);
        // This is a committed server hit; its actual target owns the name highlight during playback.
        S.pendingTarget=null;renderTargets();
        await heroAttack({skillName:event.skillName,attackSpeedMultiplier:event.attackSpeedMultiplier||round.attackSpeedMultiplier,impact:()=>{
          S.mon.hp=event.afterHp;monsterHealth();saveEnemy();
          const point=monPt(.5,.4);float(point.x,point.y,`−${o.fmt(event.damage)}`,'damage');
          root.dataset.lastHit=JSON.stringify({id:event.targetId,hp:event.afterHp,maxHp:S.mon.max,damage:event.damage});
        }},event.skill);
        if(event.afterHp===0)await killMonster({elite:event.enemy.elite});
      }
      await spawnServerGroup(round.after);root.dataset.playingRound='';root.dataset.completedRound=round.id;
    }
    async function loop() {
      if (S.running) return; S.running = true;
      try {
        for (;;) {
          S.playEpoch = null; await wait(40); if (!S.me) continue;syncGuardian();
          try {
          S.playEpoch = S.visualEpoch;
          if(S.group.length&&S.groupMap!==S.me.character.mapId)clearGroup();
          applyStall();
          if (S.queue.length) { const report = S.queue.pop(); S.queue.length = 0; await playEpisode(episode(report)); applyStall(); continue; }
          if (S.stalled) { await wait(500); continue; }
          E.hero.classList.remove('down', 'slump');
          if(S.authoritative){
            const enemies = S.me.battle?.idleCombat?.enemies;
            if(!S.group.length && enemies?.length) await spawnServerGroup(enemies);
            if(S.group.some(e=>e.mon?.hp>0) && !S.queue.length){
              await skirmish({ allowLocalSpawn: false });
            } else {
              await wait(800);
            }
            continue;
          }
          await skirmish();
          } catch (e) { S.playEpoch = null; if (e.cancelled) continue; console.warn('battle', e); clearGroup(); await wait(1000); }
        }
      } finally { S.running = false; }
    }
    function attach(slot) {
      const detached=!root.isConnected;
      if (slot && root.parentNode !== slot) slot.appendChild(root);
      if (detached && root.isConnected) {
        // Removed stages retain their canvas bitmap but stop scheduling frames.
        // Discard those old effects and resume each living atlas under its owner.
        clearTransientFx();
        if (!S.rm && !document.hidden) {
          const selected=S.selected;saveEnemy();
          for(let i=0;i<S.group.length;i++){
            const enemy=S.group[i];
            if(!enemy.monAtlas || !enemy.mon || enemy.mon.hp<=0 || enemy.monSheetAction==='death')continue;
            focusEnemy(i);animateMonsterSheet('idle');saveEnemy();
          }
          focusEnemy(selected);
        }
      }
      if (root.isConnected && !E.bg.querySelector('.map-motion')) window.RpgMapMotion?.attach(root, E.bg);
      root.classList.toggle('paused', document.hidden);syncGuardian();
      if (S.me && !S.running) loop();
    }
    return { el: root, sync, attach, state: S };
  }
  window.RpgBattle = { create, visibleBounds, layout: {} };
  monsterLayouts.then(layout => { window.RpgBattle.layout = layout; });
})();

