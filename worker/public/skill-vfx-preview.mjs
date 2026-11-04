import { createVfxPlayer, recipeFor, validateCatalog } from './skill-vfx-engine.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const CLASS={sword:'劍士',archer:'妖精',mage:'法師',thief:'盜賊'};
const SYSTEM={atlas:'Atlas 主技能',native:'職業原生技能',special:'特殊技能書'};
const KIND={attack:'攻擊',heal:'治療',shield:'防護',buff:'增益',control:'控制',summon:'召喚'};
const FAMILY={slash:'弧光斬擊',whirlwind:'環形旋斬',bleed:'裂傷刀光',shield:'防護結界',counter:'盾鋒反擊',pierce:'穿透彈道',volley:'扇形連射',rain:'天降箭雨',snipe:'蓄勢狙擊',beast:'靈獸協擊',summon:'召喚契約',trap:'棘網引爆',lightning:'連鎖雷電',frost:'冰晶脈衝',fireball:'火球爆破',meteor:'隕石墜擊',arcane:'奧術聚束',beam:'秘法光束',heal:'生命回流',holy:'神聖光柱',buff:'強化光環',poison:'淬毒殘響',execute:'交叉處決',combo:'三重刃影',dash:'突進斬擊',shadow:'暗影殘像',time:'時空法環',curse:'咒印擴散'};
const SYMBOL={sword:'⚔',archer:'⌁',mage:'✦',thief:'⟡'};
const canvas=$('[data-vfx-canvas]'),stage=$('[data-stage]'),loading=$('[data-loading]');
let catalog,player,selected,classFilter='sword',systemFilter='all',search='',direction='right',progress=.58,quality='high',bodyHeight=130,layout={},playing=false,frame=0,startTime=0,loopWait=0,selectionEpoch=0,ready=false,destroyed=false,resizeObserver;
let resolveReady,rejectReady;const readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
function error(message){const el=$('[data-error]');el.textContent=message;el.hidden=false;}
function clearError(){$('[data-error]').hidden=true;}
function text(selector,value){$(selector).textContent=String(value??'');}
function el(tag,cls,content){const node=document.createElement(tag);if(cls)node.className=cls;if(content!=null)node.textContent=content;return node;}
function setPressed(selector,key){$$(selector).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset[key]===({class:classFilter,system:systemFilter,direction}[key]))));}
function filteredSkills(){return catalog.skills.filter(s=>s.baseClass===classFilter&&(systemFilter==='all'||s.system===systemFilter)&&(!search||[s.id,s.name,s.job,s.description].join(' ').toLowerCase().includes(search.toLowerCase())));}
function renderList(){
 const list=$('[data-skill-list]'),select=$('[data-skill-select]'),skills=filteredSkills();list.replaceChildren();select.replaceChildren();text('[data-visible-count]',skills.length+' 招');
 for(const system of ['atlas','native','special']){const rows=skills.filter(s=>s.system===system);if(!rows.length)continue;list.append(el('p','list-section-label',SYSTEM[system]+' / '+String(rows.length).padStart(2,'0')));const group=document.createElement('optgroup');group.label=SYSTEM[system];select.append(group);
   for(const skill of rows){const option=document.createElement('option');option.value=skill.id;option.textContent=skill.name;option.selected=skill.id===selected?.id;group.append(option);
     const button=el('button','skill-item');button.type='button';button.dataset.skillId=skill.id;button.setAttribute('aria-current',String(skill.id===selected?.id));const icon=el('span','skill-thumb',SYMBOL[skill.baseClass]);icon.setAttribute('aria-hidden','true');button.append(icon);const labels=el('span');labels.append(el('strong','',skill.name),el('small','',(KIND[skill.kind]||'技能')+' · '+(skill.classPath&&skill.classPath!=='base'?skill.classPath:FAMILY[skill.family]||skill.family)));button.append(labels,el('span','item-arrow','›'));button.addEventListener('click',()=>selectSkill(skill.id));list.append(button);
   }
 }
 if(!skills.length)list.append(el('p','list-section-label','沒有符合的技能。'));
 setPressed('[data-class]','class');setPressed('[data-system]','system');
}
function placeMarkers(){
 const w=stage.clientWidth,h=stage.clientHeight,angle={right:0,left:Math.PI,up:-Math.PI/2,down:Math.PI/2}[direction];
 bodyHeight=w<500?88:132;const distance=Math.min(w*.43,h*.43),cx=w*.5,cy=h*.49;
 layout={from:{x:cx-Math.cos(angle)*distance*.5,y:cy-Math.sin(angle)*distance*.5},to:{x:cx+Math.cos(angle)*distance*.5,y:cy+Math.sin(angle)*distance*.5}};
 const caster=$('[data-caster-marker]'),target=$('[data-target-marker]');
 for(const [node,p] of [[caster,layout.from],[target,layout.to]]){node.style.left=p.x+'px';node.style.top=p.y+'px';node.style.width=bodyHeight*.5+'px';node.style.height=bodyHeight*.7+'px';}
 target.style.opacity=selected&&recipeFor(selected).support?'.27':'1';
 text('[data-scale-label]',bodyHeight+' px · 四向等比');setPressed('[data-direction]','direction');
}
function effectOptions(extra={}){return {skillId:selected.id,...layout,bodyHeight,direction,quality,seed:selected.id,showcaseTargets:false,blendMode:['light','checker'].includes(stage.dataset.background)?'source-over':'screen',...extra};}
function phaseLabel(){if(!selected)return '就緒';return recipeFor(selected).phases.find(p=>progress<p.to)?.label||'消散';}
function updateTime(){if(!selected)return;const recipe=recipeFor(selected),duration=recipe.durationMs/1000;text('[data-time]',(progress*duration).toFixed(2));text('[data-total-time]',duration.toFixed(2));$('[data-progress]').value=Math.round(progress*1000);text('[data-phase]',phaseLabel());const phase=recipe.phases.findIndex(p=>progress<p.to);$$('.phase-ticks span').forEach((n,i)=>{n.textContent=recipe.phases[i].label;n.classList.toggle('is-current',i===(phase<0?3:phase));});}
function stopPlayback(clear=true){playing=false;loopWait=0;if(frame)cancelAnimationFrame(frame);frame=0;$('[data-play]').setAttribute('aria-pressed','false');if(clear)player?.clear();}
async function seek(value){if(!player||!selected||destroyed)return{accepted:false,reason:'not_ready'};stopPlayback(false);progress=Math.max(0,Math.min(1,Number(value)||0));updateTime();return player.renderFrame(effectOptions({progress}));}
async function selectSkill(id){
 if(!catalog||destroyed)return{accepted:false,reason:'not_ready'};const skill=catalog.skills.find(s=>s.id===id);if(!skill)return{accepted:false,reason:'unknown_skill'};const epoch=++selectionEpoch;stopPlayback();selected=skill;classFilter=skill.baseClass;
 if(systemFilter!=='all'&&systemFilter!==skill.system)systemFilter='all';search='';$('[data-search]').value='';
 document.documentElement.style.setProperty('--accent',{sword:'#e1c28b',archer:'#9cd3ae',mage:'#a5bdf2',thief:'#c3a3e8'}[skill.baseClass]);renderList();
 text('[data-source-label]',SYSTEM[skill.system]+' / '+CLASS[skill.baseClass]);text('[data-skill-name]',skill.name);text('[data-kind]',KIND[skill.kind]||'技能');text('[data-duration]',(recipeFor(skill).durationMs/1000).toFixed(2)+' 秒');text('[data-description]',skill.description||skill.job||'依據目前職業路線的技能資料，製作對應動作與特效。');text('[data-selected-skill-id]',skill.id+' · '+(FAMILY[skill.family]||skill.family));
 loading.hidden=false;loading.textContent='正在準備'+CLASS[skill.baseClass]+'特效素材…';clearError();placeMarkers();
 try{await player.prepare(skill.baseClass);if(destroyed||epoch!==selectionEpoch)return{accepted:false,reason:'superseded'};loading.hidden=true;return await seek(.58);}catch(e){if(epoch===selectionEpoch){loading.textContent='素材尚未就緒，請稍後重新載入。';error(e.message);}return{accepted:false,reason:'asset_failed'};}
}
async function setDirection(value){if(!['up','down','left','right'].includes(value))return{accepted:false,reason:'invalid_direction'};direction=value;stopPlayback();placeMarkers();return seek(progress);}
async function play(){
 if(!player||!selected||destroyed||document.hidden)return{accepted:false,reason:'not_ready'};stopPlayback();const epoch=selectionEpoch;clearError();
 const result=await player.play(effectOptions());if(!result.accepted)return result;if(epoch!==selectionEpoch)return{accepted:false,reason:'superseded'};
 playing=true;progress=0;startTime=performance.now();$('[data-play]').setAttribute('aria-pressed','true');
 const duration=result.durationMs;
 function tick(now){frame=0;if(!playing||destroyed||epoch!==selectionEpoch)return;progress=Math.min(1,(now-startTime)/duration);updateTime();if(progress<1){frame=requestAnimationFrame(tick);return;}
   if($('[data-loop]').checked&&!matchMedia('(prefers-reduced-motion: reduce)').matches){if(!loopWait)loopWait=now;if(now-loopWait<500){frame=requestAnimationFrame(tick);return;}playing=false;play();}
   else{playing=false;$('[data-play]').setAttribute('aria-pressed','false');}
 }
 frame=requestAnimationFrame(tick);return result;
}
function buildAuditCard(item,{node=false}={}){const card=el('article','audit-card'+(item.kind==='keystone'?' keystone':''));card.append(el('h3','',item.name),el('p','',item.description));if(node)card.append(el('small','',(item.kind==='keystone'?'核心天賦 · ':'')+'等級 '+item.minLevel+' · '+item.cost+' 點'));else card.append(el('small','',item.id));return card;}
function showAudit(type){if(!catalog)return;const content=$('[data-audit-content]');content.replaceChildren();
 if(type==='talents'){text('[data-audit-title]','天賦核對');text('[data-audit-description]','四職各 30 個可配置節點，合計 120 個；另有四個起點。每職最多 24 點。這些是目前程式中的被動修正，此處僅供核對，不更動配置。');for(const tree of catalog.talents){content.append(el('h3','audit-class-title',CLASS[tree.baseClass]+' / 30 節點'));const grid=el('div','audit-grid');for(const node of tree.nodes.filter(n=>n.kind!=='origin'))grid.append(buildAuditCard(node,{node:true}));content.append(grid);}}
 else if(type==='supports'){text('[data-audit-title]','支援技能');text('[data-audit-description]','6 個支援修改主技能的效果。動畫只在收到有效施放與目標資料時使用對應變化；支援本身不獨立施放攻擊。');const grid=el('div','audit-grid');for(const s of catalog.supports)grid.append(buildAuditCard(s));content.append(grid);}
 else{text('[data-audit-title]','覺醒技能規劃');text('[data-audit-description]','以下 16 招仍屬設計提案，尚無實裝的伺服器技能身份，因此未計入 196 筆技能映射，也不列為已完成動畫。');for(const base of Object.keys(CLASS)){content.append(el('h3','audit-class-title',CLASS[base]));const grid=el('div','audit-grid');for(const s of catalog.planned.filter(s=>s.baseClass===base))grid.append(buildAuditCard(s));content.append(grid);}}
 $('[data-audit-dialog]').showModal();
}
function inspect(){return{ready,selectedSkillId:selected?.id,skillId:selected?.id,direction,progress,bodyHeight,layout,playing,skillCount:catalog?.skills.length||0,catalogIds:catalog?.skills.map(s=>s.id)||[],recipe:selected?recipeFor(selected):null,player:player?.stats(),canvasSelector:'[data-vfx-canvas]',error:$('[data-error]').hidden?null:$('[data-error]').textContent};}
function destroy(){if(destroyed)return;stopPlayback();destroyed=true;ready=false;selectionEpoch++;resizeObserver?.disconnect();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',destroy);player?.destroy();}
function visibility(){if(document.hidden){stopPlayback();$('[data-loop]').checked=false;}}
window.__VFX_PREVIEW__={ready:readyPromise,selectSkill,setDirection,seek,play,inspect,destroy};
async function init(){
 const response=await fetch('/skill-vfx-catalog.json');if(!response.ok)throw new Error('無法載入技能目錄 ('+response.status+')');catalog=await response.json();validateCatalog(catalog);text('[data-total]',catalog.skills.length);
 player=createVfxPlayer(canvas,{catalog,quality,onRender:stats=>{text('[data-render-state]',stats.active?'播放中':'可逐幀檢視');},onError:e=>{if(!destroyed)error(e.message);}});
 $$('[data-class]').forEach(button=>button.addEventListener('click',()=>{classFilter=button.dataset.class;search='';systemFilter='all';const skill=catalog.skills.find(s=>s.baseClass===classFilter&&s.system==='atlas');selectSkill(skill.id);}));
 $$('[data-system]').forEach(button=>button.addEventListener('click',()=>{systemFilter=button.dataset.system;renderList();const rows=filteredSkills();if(rows.length&&!rows.some(s=>s.id===selected.id))selectSkill(rows[0].id);}));
 $('[data-search]').addEventListener('input',e=>{search=e.target.value;renderList();});$('[data-skill-select]').addEventListener('change',e=>selectSkill(e.target.value));
 $$('[data-direction]').forEach(button=>button.addEventListener('click',()=>setDirection(button.dataset.direction)));
 $('[data-play]').addEventListener('click',()=>play());$('[data-pause]').addEventListener('click',()=>seek(progress));$('[data-step]').addEventListener('click',()=>seek(Math.min(1,progress+1000/30/recipeFor(selected).durationMs)));$('[data-progress]').addEventListener('input',e=>seek(Number(e.target.value)/1000));
 $('[data-bg]').addEventListener('change',e=>{stage.dataset.background=e.target.value;seek(progress);});$('[data-quality]').addEventListener('change',e=>{quality=e.target.value;seek(progress);});
 $$('[data-audit]').forEach(b=>b.addEventListener('click',()=>showAudit(b.dataset.audit)));$('[data-close-dialog]').addEventListener('click',()=>$('[data-audit-dialog]').close());
 document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',destroy);
 let resizeFrame=0;resizeObserver=new ResizeObserver(()=>{if(resizeFrame)cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;if(destroyed)return;player.resize();placeMarkers();if(selected)seek(progress);});});resizeObserver.observe(stage);
 const result=await selectSkill('atlas:sword_whirlwind');ready=result.accepted;resolveReady(inspect());
}
init().catch(e=>{loading.textContent='載入失敗';error(e.message);rejectReady(e);});
