import {AWAKENING_PROFILES,AWAKENING_CLASSES,AWAKENING_ASSETS,awakeningFor,phaseFor} from './awakening-vfx-data.mjs';
import {buildAwakeningFrame,drawAwakeningFrame,layoutForAwakening} from './awakening-vfx-engine.mjs';
const $=id=>document.getElementById(id),canvas=$('effectCanvas'),ctx=canvas.getContext('2d',{alpha:true});
const media=matchMedia('(prefers-reduced-motion: reduce)'),images={},errors=[];
const state={id:AWAKENING_PROFILES[0].id,progress:.62,direction:'right',targetCount:1,quality:'high',reducedMotion:media.matches,playing:false,loop:false,ready:false,width:1,height:1,dpr:1,renderCount:0,drawCalls:0,frameMs:0};
let raf=0,lastTime=0,frame=null,destroyed=false;
try{const candidate=decodeURIComponent(location.hash.slice(1));if(candidate)state.id=awakeningFor(candidate).id;}catch{}
const classIcons={sword:'⚔',archer:'➶',mage:'✦',thief:'◈'};
function error(error){const message=error?.message||String(error);errors.push(message);$('errorMessage').hidden=false;$('errorMessage').textContent='預覽載入失敗：'+message;$('renderStatus').textContent='素材未就緒';}
function button(text,action,className=''){const b=document.createElement('button');b.type='button';b.className=className;b.textContent=text;b.addEventListener('click',action);return b;}
function updateSelection(){
  const p=awakeningFor(state.id);document.documentElement.style.setProperty('--accent',p.colors[0]);
  $('skillName').textContent=p.name;$('skillMode').textContent=p.classLabel+' · '+p.modeLabel+'覺醒';$('classHeading').textContent=p.classLabel+'覺醒';
  $('duration').textContent='演出 '+(p.durationMs/1000).toFixed(1)+' 秒';$('concept').textContent=p.concept;$('visualDescription').textContent=p.description;
  $('previewIdentity').textContent='16 招覺醒 · 美術演出預覽';canvas.setAttribute('aria-label',p.name+'覺醒特效畫布');
  document.title=p.name+' · 覺醒星圖 · 星穹旅誌';
  $('classTabs').replaceChildren();
  for(const [key,label] of Object.entries(AWAKENING_CLASSES)){const b=button('',()=>select(AWAKENING_PROFILES.find(x=>x.baseClass===key).id));b.dataset.class=key;b.setAttribute('aria-pressed',String(p.baseClass===key));const icon=document.createElement('span');icon.className='class-glyph';icon.textContent=classIcons[key];icon.setAttribute('aria-hidden','true');b.append(icon,document.createTextNode(label));$('classTabs').append(b);}
  $('skillList').replaceChildren();
  AWAKENING_PROFILES.filter(x=>x.baseClass===p.baseClass).forEach((s,i)=>{const b=button('',()=>select(s.id),'skill-card'+(s.id===p.id?' active':''));b.dataset.skill=s.id;b.setAttribute('aria-pressed',String(s.id===p.id));b.style.setProperty('--accent',s.colors[0]);const numeral=document.createElement('span');numeral.className='ordinal';numeral.textContent=['I','II','III','IV'][i];const text=document.createElement('span');const name=document.createElement('strong');name.textContent=s.name;const subtitle=document.createElement('small');subtitle.textContent=s.modeLabel+'覺醒 · '+(s.durationMs/1000).toFixed(1)+' s';text.append(name,subtitle);b.append(numeral,text);$('skillList').append(b);});
  $('mobileSkill').value=p.id;$('phaseButtons').replaceChildren();
  p.phases.forEach((phase,i)=>{const b=button('',()=>seek((phase.start+phase.end)/2));const order=document.createElement('span');order.textContent='0'+(i+1);b.append(order,document.createTextNode(phase.label));b.dataset.phase=i;$('phaseButtons').append(b);});
  history.replaceState(null,'','#'+encodeURIComponent(p.id));updateTransport();
}
function updateTransport(){const p=awakeningFor(state.id),phase=phaseFor(p,state.progress);$('playButton').textContent=state.playing?'Ⅱ 暫停':'▶ 播放';$('playButton').setAttribute('aria-label',state.playing?'暫停演出':'播放演出');$('playButton').setAttribute('aria-pressed',String(state.playing));$('seek').value=String(Math.round(state.progress*1000));$('seek').setAttribute('aria-valuetext',Math.round(state.progress*100)+'% · '+phase.label);$('timeDisplay').textContent=(state.progress*p.durationMs/1000).toFixed(2)+' / '+(p.durationMs/1000).toFixed(2)+' s';$('phaseLabel').textContent=phase.label;$('motionLabel').textContent=state.reducedMotion?'靜態構圖 · 柔和淡化':'完整演出';$('directionLabel').textContent=({right:'朝右',left:'朝左',up:'朝上',down:'朝下'}[state.direction])+' · 等比顯示';$('phaseButtons').querySelectorAll('button').forEach((b,i)=>{const active=p.phases[i]===phase;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
function positionMarker(id,p,body,hidden=false){const marker=$(id);marker.hidden=hidden;marker.style.display=hidden?'none':'grid';if(hidden)return;marker.style.left=p.x+'px';marker.style.top=p.y+'px';marker.style.height=body*.68+'px';marker.style.width=body*.4+'px';}
function render(){
  if(destroyed||!state.ready)return;
  const start=performance.now(),layout=layoutForAwakening(state.width,state.height,state.direction,state.targetCount);
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.setTransform(state.dpr,0,0,state.dpr,0,0);
  frame=buildAwakeningFrame(state.id,state.progress,{...layout,quality:state.quality,reducedMotion:state.reducedMotion});
  state.drawCalls=drawAwakeningFrame(ctx,images[frame.profile.baseClass],frame,{semantic:images.semantic,hawk:images.hawk});
  positionMarker('casterMarker',layout.from,layout.bodyHeight);for(let i=0;i<3;i++)positionMarker('targetMarker'+i,layout.targets[i]||layout.to,layout.bodyHeight,!layout.targets[i]);
  state.renderCount++;state.frameMs=performance.now()-start;$('renderStatus').textContent=(state.quality==='low'?'精簡細節':'完整細節')+' · 素材就緒';
  canvas.dataset.profile=state.id;canvas.dataset.direction=state.direction;canvas.dataset.progress=String(state.progress);updateTransport();
}
function resize(){const box=$('stage').getBoundingClientRect();state.width=Math.max(1,Math.round(box.width));state.height=Math.max(1,Math.round(box.height));state.dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(state.width*state.dpr);canvas.height=Math.round(state.height*state.dpr);render();}
function pause(){state.playing=false;if(raf)cancelAnimationFrame(raf);raf=0;lastTime=0;updateTransport();}
function tick(now){raf=0;if(destroyed||!state.playing)return;if(document.hidden){pause();return;}const p=awakeningFor(state.id);if(lastTime)state.progress+=(now-lastTime)/p.durationMs;lastTime=now;if(state.progress>=1){if(state.loop)state.progress%=1;else{state.progress=1;pause();}}render();if(state.playing)raf=requestAnimationFrame(tick);}
function play(){if(!state.ready||destroyed)return false;if(state.progress>=.999)state.progress=0;state.playing=true;lastTime=0;if(!raf)raf=requestAnimationFrame(tick);updateTransport();return true;}
function seek(progress){pause();state.progress=Math.max(0,Math.min(1,Number(progress)||0));render();return stats();}
function select(id){const p=awakeningFor(id);pause();state.id=p.id;state.progress=.62;updateSelection();render();return stats();}
function setDirection(value){if(!['right','left','up','down'].includes(value))throw new RangeError('Unknown direction');state.direction=value;$('directionButtons').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.direction===value)));render();return stats();}
function setQuality(value){state.quality=value==='low'?'low':'high';$('quality').value=state.quality;render();return stats();}
function setReducedMotion(value){state.reducedMotion=!!value;$('reducedMotion').checked=state.reducedMotion;render();return stats();}
function setTargetCount(value){state.targetCount=Number(value)===3?3:1;$('targetCount').value=String(state.targetCount);render();return stats();}
function stats(){return {...state,sourceId:null,previewOnly:true,implemented:false,profileCount:AWAKENING_PROFILES.length,composition:frame?.profile.composition,metrics:frame?.metrics||null,bodyHeight:frame?.bodyHeight||null,loadedAssets:Object.keys(images),errors:[...errors],pendingAnimationFrame:!!raf};}
function snapshot(){return {stats:stats(),frame:frame?JSON.parse(JSON.stringify(frame)):null};}
function dispose(){pause();destroyed=true;observer.disconnect();document.removeEventListener('visibilitychange',visibility);media.removeEventListener?.('change',mediaChanged);Object.keys(images).forEach(k=>delete images[k]);ctx.clearRect(0,0,canvas.width,canvas.height);}
function visibility(){if(document.hidden)pause();}
function mediaChanged(event){setReducedMotion(event.matches);}
const observer=new ResizeObserver(resize);observer.observe($('stage'));
$('mobileSkill').replaceChildren(...AWAKENING_PROFILES.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.classLabel+' · '+p.modeLabel+'｜'+p.name;return o;}));
$('mobileSkill').addEventListener('change',e=>select(e.target.value));$('playButton').addEventListener('click',()=>state.playing?pause():play());$('restartButton').addEventListener('click',()=>{seek(0);play();});$('stepButton').addEventListener('click',()=>seek(Math.min(1,state.progress+1000/60/awakeningFor(state.id).durationMs)));$('seek').addEventListener('input',e=>seek(Number(e.target.value)/1000));$('loopToggle').addEventListener('change',e=>state.loop=e.target.checked);
$('directionButtons').addEventListener('click',e=>{const b=e.target.closest('button[data-direction]');if(b)setDirection(b.dataset.direction);});$('targetCount').addEventListener('change',e=>setTargetCount(e.target.value));$('quality').addEventListener('change',e=>setQuality(e.target.value));$('reducedMotion').checked=state.reducedMotion;$('reducedMotion').addEventListener('change',e=>setReducedMotion(e.target.checked));$('background').addEventListener('change',e=>{$('stage').dataset.background=e.target.value;});
document.addEventListener('visibilitychange',visibility);media.addEventListener?.('change',mediaChanged);addEventListener('pagehide',dispose,{once:true});
updateSelection();resize();
const ready=Promise.all(Object.entries(AWAKENING_ASSETS).map(([key,path])=>new Promise((resolve,reject)=>{const img=new Image();img.decoding='async';img.onload=()=>{if(destroyed){reject(new Error('Preview was closed'));return;}images[key]=img;resolve();};img.onerror=()=>reject(new Error('無法載入 '+path));img.src=path;}))).then(()=>{state.ready=true;render();document.documentElement.dataset.awakeningReady='true';return stats();}).catch(error);
window.__awakeningVfxPreview=Object.freeze({ready,profiles:AWAKENING_PROFILES,select,seek,play,pause,setDirection,setQuality,setReducedMotion,setTargetCount,stats,snapshot});
