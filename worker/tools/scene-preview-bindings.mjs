/* Compose local preview responses from the latest visual-source files.
 * The original character scene and ui-proto files are read, never rewritten. */
import fs from 'node:fs/promises';import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const prefix='/ui-generated-20261030/scene-bound-20261102';
const social='/ui-generated-20261030/hud-angels-20261102';
const maps='/ui-generated-20261030/progression-maps-20261102';
export function bindScene(source){
 let s=source;
 if(!s.includes('var ENCOUNTER=window.RpgSceneEncounter')){
  const patches=[
 ["var stage=document.getElementById('stage');","var ENCOUNTER=window.RpgSceneEncounter?.selected;\nif(ENCOUNTER){MIN=ENCOUNTER.ordinary.slice();Object.assign(NAMES,ENCOUNTER.names);}\nvar ELITE=ENCOUNTER?.elite||'titan_vanguard',BOSS=ENCOUNTER?.boss||'lava_colossus';\nvar stage=document.getElementById('stage');"],
 ["L.image('ground','assets/ground.webp');L.json('meta','assets/meta.json');","L.image('ground',ENCOUNTER?.background||'assets/ground.webp');L.json('meta',ENCOUNTER?.metadata||'assets/meta.json');if(ENCOUNTER)L.image('mode_aura',ENCOUNTER.aura);"],
 ["L.spritesheet(n,'assets/'+n+'.webp',","L.spritesheet(n,d[n].file||'assets/'+n+'.webp',"],
 ["mkMon(s,'titan_vanguard','elite'","mkMon(s,ELITE,'elite'"],
 ["mkMon(s,'lava_colossus','boss'","mkMon(s,BOSS,'boss'"],
 ["UI.toast('精英出現：泰坦先鋒戰將','擊敗可獲得稀有以上裝備','shield');","UI.toast('菁英出現：'+NAMES[ELITE],ENCOUNTER?'美術預覽：展示動作，不發放獎勵':'擊敗可獲得稀有以上裝備','shield');"],
 ["UI.toast('首領降臨：熔岩巨像','山隘的大地在顫抖……','rage');","UI.toast('首領降臨：'+NAMES[BOSS],ENCOUNTER?'美術預覽：展示動作，不發放獎勵':'山隘的大地在顫抖……','rage');"],
 ["UI.toast('擊敗精英：泰坦先鋒戰將','獲得 稀有・雷鳴戰盔','helm');","UI.toast('擊敗菁英：'+NAMES[ELITE],ENCOUNTER?'動作展示完成；沒有發放道具':'獲得 稀有・雷鳴戰盔','helm');"],
 ["UI.toast('首領已擊敗：熔岩巨像','獲得 傳奇・泰坦裂空劍','sword');","UI.toast('首領已擊敗：'+NAMES[BOSS],ENCOUNTER?'動作展示完成；沒有發放道具':'獲得 傳奇・泰坦裂空劍','sword');"],
 ["setTimeout(function(){UI.toast('進入 奧林帕斯泰坦山隘','建議等級 25–30・世界階級 Ⅱ','helm');},600);","setTimeout(function(){UI.toast('進入 '+(ENCOUNTER?.name||'奧林帕斯泰坦山隘'),ENCOUNTER?ENCOUNTER.modeName+' · Lv.'+ENCOUNTER.levelMin+'–'+ENCOUNTER.levelMax+' · 美術預覽':'建議等級 25–30・世界階級 Ⅱ','helm');},600);"],
 ["m.pct=pct;mons.push(m);return m;","m.pct=pct;\n m.on('animationstart',function(anim){var fit=META[anim.key];if(fit){m.setOrigin(fit.ox,fit.oy);m.setScale(HS*m.pct/fit.body);}});\n if(ENCOUNTER&&role!=='minion'&&s.textures.exists('mode_aura')){m.modeAura=s.add.image(x,y-HS*pct*.5,'mode_aura').setDisplaySize(HS*pct*1.35,HS*pct*1.35).setAlpha(role==='boss'?.65:.45).setDepth(y-.5);m.on('destroy',function(){m.modeAura?.destroy();});}\n mons.push(m);return m;"],
 ["mons.concat([hero]).forEach(function(s){s.setDepth(s.y);});","mons.concat([hero]).forEach(function(s){s.setDepth(s.y);if(s.modeAura){s.modeAura.setPosition(s.x,s.y-HS*s.pct*.5).setDepth(s.y-.5).setAlpha(s.hp>0?(.48+Math.sin(t/600)*.12):0);}});"],
 ];
  for(const [old,replacement]of patches){if(s.split(old).length!==2)throw Error('Visual scene changed; binding needs review: '+old.slice(0,80));s=s.replace(old,replacement);}
 }
 if(!s.includes('window.RpgSceneEncounter.inspect=')){
  const anchor="function create(){sc=this;META=this.cache.json.get('meta');HS=this.scale.height;";
  if(s.split(anchor).length!==2)throw Error('Visual scene create hook changed');
  s=s.replace(anchor,anchor+"\n if(ENCOUNTER){window.RpgSceneEncounter.previewBoss=function(){spawnBoss(sc,true);};window.RpgSceneEncounter.inspect=function(){return {mapId:ENCOUNTER.id,sourceCount:ENCOUNTER.sources.length,allAnimationsReady:ENCOUNTER.sources.every(function(m){return ['idle','walk','attack','death'].every(function(a){return sc.anims.exists(m.id+'_'+a);});}),monsters:mons.filter(function(m){return m.active;}).map(function(m){return {id:m.nm,role:m.role,animation:m.anims.currentAnim?.key,width:m.displayWidth,height:m.displayHeight};})};};}");
 }
 if(!s.includes('var HERO_READABILITY=')){
  const actor='visual=new CharacterSprites.Animator(this,hero);';if(s.split(actor).length!==2)throw Error('Hero renderer mount changed');
  s=s.replace(actor,actor+"HERO_READABILITY=window.RpgHeroReadability?.mount(this,{hero:hero,monsters:function(){return mons;},ready:function(){return !!visual?.ready;},hpGraphics:hpG});");
  s='var HERO_READABILITY=null;\n'+s;
  const end='perf(dms);}';if(s.split(end).length!==2)throw Error('Hero frame update hook changed');s=s.replace(end,'HERO_READABILITY?.update();perf(dms);}');
  s=s.replace("var ex=m.role=='minion'?.7:1.15;","var ex=m.role=='minion'?.88:1.30;");
  s=s.replace('mapId:ENCOUNTER.id,sourceCount:', 'visibility:HERO_READABILITY?.inspect(),mapId:ENCOUNTER.id,sourceCount:');
  s=s.replace('window.RpgSceneEncounter.previewBoss=function()',"window.RpgSceneEncounter.reviewVisibility=function(value){sc.scene.pause();HERO_READABILITY?.setEnabled(value);HERO_READABILITY?.update();return HERO_READABILITY?.inspect();};window.RpgSceneEncounter.previewBoss=function()");
  s=s.replace('window.RpgSceneEncounter.previewBoss=function()',"window.RpgSceneEncounter.reviewCrowd=function(){var crowd=mons.filter(alive).slice(0,6),boss=mons.find(function(m){return alive(m)&&m.role==='boss';});if(boss&&!crowd.includes(boss))crowd.push(boss);crowd.forEach(function(m,i){m.x=hero.x+(i-3)*HS*.025;m.y=hero.y+HS*(.06+i*.008);m.setDepth(m.y);m.modeAura?.setPosition(m.x,m.y-HS*m.pct*.5).setDepth(m.y-.5);});sc.scene.pause();HERO_READABILITY?.update();};window.RpgSceneEncounter.previewBoss=function()");
 }
 // Phaser canvas text does not inherit CSS. Keep original art sources intact.
 s=s.replaceAll('fontFamily:\'"Noto Serif TC","Noto Sans CJK TC",serif\'', 'fontFamily:\'"jfOpenHuninn",sans-serif\'');
 return bindLiveScene(s);
}
function once(source,old,replacement){if(source.split(old).length!==2)throw Error('Live scene hook changed: '+old.slice(0,90));return source.replace(old,replacement);}
export function bindLiveScene(source){
 if(source.includes('var LIVE_SCENE=window.__RpgScenePreviewConfig'))return source;
 let s=once(source,"var visual, debugState=","var LIVE_SCENE=window.__RpgScenePreviewConfig?.live===true,LIVE_VIEW=null,sceneGround=null;\nvar visual, debugState=");
 s=once(s,"window.addEventListener('message',function(event){","window.addEventListener('message',function(event){\n if(LIVE_SCENE)return;");
 s=once(s,"function preload(){var L=this.load;","function preload(){if(LIVE_SCENE){var placeholder=document.createElement('canvas');placeholder.width=1;placeholder.height=1;this.textures.addCanvas('ground',placeholder);this.textures.addCanvas('hero_idle',placeholder);this.cache.json.add('meta',{});return;}var L=this.load;");
 s=once(s,"this.add.image(0,0,'ground').setOrigin(0).setScale(k);","sceneGround=this.add.image(0,0,'ground').setOrigin(0).setScale(k);");
 s=once(s,"mk('h_walk','hero_walk_right',{},13,-1);mk('h_atk','hero_attack_right',{},20,0);mk('h_idle','hero_idle',{frames:[4,5]},3,-1);","if(!LIVE_SCENE){mk('h_walk','hero_walk_right',{},13,-1);mk('h_atk','hero_attack_right',{},20,0);mk('h_idle','hero_idle',{frames:[4,5]},3,-1);}");
 s=once(s,"mk('fx_spin','fx_whirlwind',{},22,0);mk('fx_hit','fx_hit_sparks',{},28,0);","if(!LIVE_SCENE){mk('fx_spin','fx_whirlwind',{},22,0);mk('fx_hit','fx_hit_sparks',{},28,0);}");
 s=once(s,"hero.setScale(HS*.22/205);hero.play('h_idle');","hero.setScale(HS*.22/205);if(!LIVE_SCENE)hero.play('h_idle');else hero.setVisible(false);");
 s=once(s,'hero.hp=3600;hero.mhp=3600;hero.rage=60;','hero.hp=LIVE_SCENE?0:3600;hero.mhp=LIVE_SCENE?0:3600;hero.rage=LIVE_SCENE?0:60;');
 s=once(s,';loadCharacter(debugState.actor);',';if(!LIVE_SCENE)loadCharacter(debugState.actor);');
 s=once(s,"UI.cast=function(i){if(visual?.ready)castSkill(i,true);};","UI.cast=function(i){if(!LIVE_SCENE&&visual?.ready)castSkill(i,true);};");
 for(const delay of [9000,21000])s=once(s,'this.time.addEvent({delay:'+delay,'if(!LIVE_SCENE)this.time.addEvent({delay:'+delay);
 s=once(s,'UI.setHP(hero.hp,hero.mhp);UI.setMP(hero.rage,100);UI.setXP(.62);','if(!LIVE_SCENE){UI.setHP(hero.hp,hero.mhp);UI.setMP(hero.rage,100);UI.setXP(.62);}');
 const arrival=/setTimeout\(function\(\)\{UI\.toast\('進入 [^\n]*\},600\);/g,arrivals=[...s.matchAll(arrival)];
 if(arrivals.length!==1)throw Error('Live scene arrival toast changed');s=s.replace(arrival,match=>'if(!LIVE_SCENE)'+match);
 const panel="if(Q.get('panel'))setTimeout(function(){UI.toggle(Q.get('panel'));},400);";
 s=once(s,panel,"if(!LIVE_SCENE&&Q.get('panel'))setTimeout(function(){UI.toggle(Q.get('panel'));},400);\n if(LIVE_SCENE){LIVE_VIEW=window.RpgSceneLiveView?.mount(this,{hero:hero,animator:visual,ui:UI,ground:sceneGround,hpGraphics:hpG,getWorld:function(){return G;},setWorld:function(world){G=world;},setMonsters:function(items){mons=items;},resetReadability:function(){HERO_READABILITY?.reset();},clearDecorations:function(){ringG.clear();rim.setAlpha(0);ghost.setAlpha(0);}});if(!LIVE_VIEW){hero.setVisible(false);sceneGround.setVisible(false);UI.target(null);}}");
 for(const signature of ['function projectileTo(target,damage){','function performPreviewAttack(target){','function horde(s,n){','function spawnElite(s){','function spawnBoss(s,near){','function hit(m,d,crit){','function kill(m){','function castSkill(i,user){'])s=once(s,signature,signature+'if(LIVE_SCENE)return;');
 s=once(s,'function update(t,dms){','function update(t,dms){if(LIVE_SCENE){LIVE_VIEW?.update(dms);HERO_READABILITY?.update();perf(dms);return;}');
 // RESIZE uses cached parentSize before refreshing DOM bounds. Read the new
 // parent first so resize does not restore the previous canvas dimensions.
 const legacyResize="window.addEventListener('resize',function(){var b=stage.getBoundingClientRect();sc.scale.resize(b.width,b.height);});",currentResize="window.addEventListener('resize',function(){var b=stage.getBoundingClientRect();sc.scale.setParentSize(b.width,b.height);});";
 const legacyCount=s.split(legacyResize).length-1,currentCount=s.split(currentResize).length-1;
 if(legacyCount===1&&currentCount===0)s=once(s,legacyResize,"window.addEventListener('resize',function(){var b=stage.getBoundingClientRect();if(LIVE_SCENE)sc.scale.getParentBounds();sc.scale.resize(b.width,b.height);});");
 else if(legacyCount!==0||currentCount!==1)throw Error('Live scene resize hook must be exactly one known form');
 return s;
}
export function bindUi(source){
 let s=source;
 const old='for(var k=0;k<4;k++)pushChat();setInterval(pushChat,7000);';
 if(!s.includes('if(!window.RPG_LIVE_SOCIAL)'))s=once(s,old,`if(!window.RPG_LIVE_SOCIAL){${old}}`);
 if(!s.includes('/* live-preview-ui-guard */')){
  s=once(s,'UI.trigger=function(i){','UI.trigger=function(i){/* live-preview-ui-guard */if(window.__RpgScenePreviewConfig?.live===true)return false;');
  s=once(s,"[['rage',3],['shield',0],['spin',12]].forEach(function(b){","(window.__RpgScenePreviewConfig?.live===true?[]:[['rage',3],['shield',0],['spin',12]]).forEach(function(b){");
  s=once(s,'(function(){var im=new Image();','(function(){if(window.__RpgScenePreviewConfig?.live===true)return;var im=new Image();');
 }
 return s;
}
export function bindSceneHtml(source){
 let s=source.replace(/<link rel="preload" href="assets\/fonts\/xq-serif-tc\.woff2"[^>]*>/g,'');
 // Remove only our former on-disk hooks if present, retaining all art modules.
 s=s.replace(/<script src="\/ui-generated-20261030\/(?:progression-maps-20261102\/encounter-catalog|hud-angels-20261102\/(?:scene-chat-ui|scene-social-preview))\.js"><\/script>/g,'');
 const actorScene='<script src="/ui-generated-20261030/characters-v1/scene.js"></script>';
 if(s.split(actorScene).length!==2)throw Error('Visual HTML scene script changed');
 s=s.replace(actorScene,`<script src="${maps}/encounter-catalog.js"></script><script src="${prefix}/scene.js"></script>`);
 const ui='<script src="ui.js"></script>';if(s.split(ui).length!==2)throw Error('Visual HTML UI script changed');s=s.replace(ui,`<script src="${prefix}/ui.js"></script>`);
 if(!s.includes('window.RPG_LIVE_SOCIAL=true'))s=s.replace('</head>',`<script>window.RPG_LIVE_SOCIAL=true;</script></head>`);
 if(!s.includes('scene-chat-ui.css'))s=s.replace('</head>',`<link rel="stylesheet" href="${social}/scene-chat-ui.css"><link rel="stylesheet" href="${social}/scene-social-preview.css"></head>`);
 if(!s.includes('scene-hero-readability.css'))s=s.replace('</head>',`<link rel="stylesheet" href="${social}/scene-hero-readability.css"></head>`);
 s=s.replace(`<script src="${prefix}/scene.js"></script>`,`<script src="${social}/scene-live-session.js"></script><script src="${social}/scene-live-view.js"></script><script src="${social}/scene-hero-readability.js"></script><script src="${prefix}/scene.js"></script>`);
 s=s.replace('</head>',`<link rel="stylesheet" href="${social}/atlas-talents-ui.css"><link rel="stylesheet" href="${social}/equipment-collection-ui.css"></head>`);
 s=s.replace('</head>',`<link rel="stylesheet" href="${social}/scene-live-view.css"></head>`);
 return s.replace('</body>',`<script src="${social}/atlas-talents-ui.js"></script><script src="${social}/atlas-progression-ui.js"></script><script src="${social}/equipment-collection-ui.js"></script><script src="${social}/scene-atlas-guide.js"></script><script src="${social}/scene-chat-ui.js"></script><script src="${social}/scene-social-preview.js"></script></body>`);
}
export function bindPreviewHtml(source){
 let s=source.replace('src="/ui-generated-20261030/characters-v1/scene.html"',`src="${prefix}/scene.html"`);
 if(!s.includes(`${prefix}/scene.html`))throw Error('Visual preview iframe changed');
 if(!s.includes('hud-angels-20261102/hud-angels.js'))s=s.replace('</body>',`<script src="${social}/hud-angels.js?v=20261102-angels1"></script></body>`);
 if(!s.includes('progression-maps-20261102/scene-map-preview-controls.js'))s=s.replace('</body>',`<script src="${maps}/scene-map-preview-controls.js"></script></body>`);
 if(!s.includes('rel="icon"'))s=s.replace('</head>','<link rel="icon" href="data:,"></head>');
 s=s.replace('</body>',`<script>if(window.__RpgScenePreviewConfig?.live===true){document.getElementById('controls').hidden=true;document.getElementById('controls').inert=true;document.getElementById('show').hidden=true;const artControls=document.querySelector('aside.test-controls');if(artControls){artControls.hidden=true;artControls.inert=true;artControls.style.display='none';}}</script></body>`);
 return s;
}
export function bindPreviewJs(source){
 if(source.includes('/* live-preview-orbs */'))return source;
 return once(source,'function update() {','function update() {\n  /* live-preview-orbs */if(window.__RpgScenePreviewConfig?.live===true){frame.contentWindow?.RpgSceneLiveView?.refreshHUD?.();return;}');
}
export function bindHudV2(source){return `if(window.__RpgScenePreviewConfig?.live===true){window.RpgSceneLiveView?.mountHUD();}else{\n${source}\n}`;}
export function bindArtOnly(source){return `if(window.__RpgScenePreviewConfig?.live!==true){\n${source}\n}`;}
const BOUND_INPUTS=Object.freeze([
 {requestPath:'/ui-generated-20261030/preview.html',relativePath:'ui-generated-20261030/preview.html',type:'text/html; charset=utf-8',bind:bindPreviewHtml},
 {requestPath:prefix+'/scene.html',relativePath:'ui-generated-20261030/characters-v1/scene.html',type:'text/html; charset=utf-8',bind:bindSceneHtml},
 {requestPath:prefix+'/scene.js',relativePath:'ui-generated-20261030/characters-v1/scene.js',type:'text/javascript; charset=utf-8',bind:bindScene},
 {requestPath:prefix+'/ui.js',relativePath:'ui-proto/ui.js',type:'text/javascript; charset=utf-8',bind:bindUi},
 {requestPath:'/ui-generated-20261030/preview.js',relativePath:'ui-generated-20261030/preview.js',type:'text/javascript; charset=utf-8',bind:bindPreviewJs},
 {requestPath:'/ui-generated-20261030/hud-v2.js',relativePath:'ui-generated-20261030/hud-v2.js',type:'text/javascript; charset=utf-8',bind:bindHudV2},
 {requestPath:'/ui-generated-20261030/dark-ui.js',relativePath:'ui-generated-20261030/dark-ui.js',type:'text/javascript; charset=utf-8',bind:bindArtOnly},
 {requestPath:'/ui-generated-20261030/characters-v1/preview-controls.js',relativePath:'ui-generated-20261030/characters-v1/preview-controls.js',type:'text/javascript; charset=utf-8',bind:bindArtOnly},
 {requestPath:maps+'/scene-map-preview-controls.js',relativePath:'ui-generated-20261030/progression-maps-20261102/scene-map-preview-controls.js',type:'text/javascript; charset=utf-8',bind:bindArtOnly}
].map(Object.freeze));
export const boundPreviewInputPaths=()=>BOUND_INPUTS.map(({requestPath,relativePath,type})=>({requestPath,relativePath,type}));
export async function boundPreviewResponse(requestPath,root){
 const input=BOUND_INPUTS.find(x=>x.requestPath===requestPath);
 if(!input)return null;
 return {type:input.type,body:input.bind(await fs.readFile(path.join(root,input.relativePath),'utf8'))};
}
// Explicit isolated QA capture only. This helper reads but never rewrites the
// source root; the caller persists the original bytes in its owned evidence.
export async function captureBoundPreviewInputs(root){
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),startedAt=new Date().toISOString(),realRoot=await fs.realpath(root);
 const sourceModule=fileURLToPath(import.meta.url),binderBefore=await fs.readFile(sourceModule),entries=[],changed=[];
 const within=(base,target)=>{const rel=path.relative(base,target);return rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
 const meta=st=>({bytes:st.size,mtime:st.mtime.toISOString(),ctime:st.ctime.toISOString(),mtimeMs:st.mtimeMs,ctimeMs:st.ctimeMs});
 for(const input of BOUND_INPUTS){
  const sourcePath=await fs.realpath(path.join(realRoot,input.relativePath));
  if(!within(realRoot,sourcePath))throw Error('Bound QA input escaped the declared source root');
  const before=await fs.stat(sourcePath);if(!before.isFile())throw Error('Bound QA input is not a file');
  const bytes=await fs.readFile(sourcePath),captured=await fs.stat(sourcePath);
  entries.push({input,sourcePath,bytes,before:meta(before),captured:meta(captured),sha256:sha(bytes)});
 }
 for(const entry of entries){
  const bytes=await fs.readFile(entry.sourcePath),confirmed=meta(await fs.stat(entry.sourcePath));
  entry.confirmed={...confirmed,sha256:sha(bytes)};
  if(JSON.stringify(entry.before)!==JSON.stringify(entry.captured)||entry.captured.bytes!==entry.bytes.length||entry.confirmed.sha256!==entry.sha256||JSON.stringify(confirmed)!==JSON.stringify(entry.captured))changed.push(entry.input.relativePath);
 }
 const binderAfter=await fs.readFile(sourceModule),binderSha256=sha(binderBefore);
 if(!binderBefore.equals(binderAfter))changed.push('scene-preview-bindings.mjs');
 const responses=new Map(),bindingErrors=[];
 if(!changed.length)for(const entry of entries){
  try{const body=entry.input.bind(entry.bytes.toString('utf8'));responses.set(entry.input.requestPath,Object.freeze({type:entry.input.type,body}));entry.boundSha256=sha(Buffer.from(body));entry.boundBytes=Buffer.byteLength(body);}
  catch(error){bindingErrors.push({requestPath:entry.input.requestPath,message:error.message});}
 }
 const sources=entries.map(entry=>({requestPath:entry.input.requestPath,relativePath:entry.input.relativePath,type:entry.input.type,sourcePath:entry.sourcePath,before:entry.before,captured:entry.captured,confirmed:entry.confirmed,bytes:entry.bytes.length,sha256:entry.sha256,boundSha256:entry.boundSha256||null,boundBytes:entry.boundBytes??null}));
 const id=sha(JSON.stringify({binderSha256,sources:sources.map(s=>({requestPath:s.requestPath,relativePath:s.relativePath,sha256:s.sha256,boundSha256:s.boundSha256}))}));
 return {manifest:{schemaVersion:1,status:changed.length||bindingErrors.length?'failed':'passed',id,startedAt,finishedAt:new Date().toISOString(),sourceRoot:realRoot,binderPath:sourceModule,binderSha256,sourceCount:sources.length,scope:'Only nine composed preview textual inputs; images and other static assets are not globally frozen.',boundBodyStage:'Before scene preview config and window-manager HTML injection; actual HTTP bodies are recorded separately by the browser.',sources,changed,bindingErrors,sourceRootWritten:false},rawSources:entries.map(e=>({relativePath:e.input.relativePath,bytes:e.bytes})),responses};
}
