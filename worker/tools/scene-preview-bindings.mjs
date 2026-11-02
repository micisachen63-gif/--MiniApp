/* Compose local preview responses from the latest visual-source files.
 * The original character scene and ui-proto files are read, never rewritten. */
import fs from 'node:fs/promises';import path from 'node:path';
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
 return s;
}
export function bindUi(source){
 if(source.includes('if(!window.RPG_LIVE_SOCIAL)'))return source;
 const old='for(var k=0;k<4;k++)pushChat();setInterval(pushChat,7000);';
 if(source.split(old).length!==2)throw Error('Visual mock-chat bootstrap changed');
 return source.replace(old,`if(!window.RPG_LIVE_SOCIAL){${old}}`);
}
export function bindSceneHtml(source){
 let s=source;
 // Remove only our former on-disk hooks if present, retaining all art modules.
 s=s.replace(/<script src="\/ui-generated-20261030\/(?:progression-maps-20261102\/encounter-catalog|hud-angels-20261102\/(?:scene-chat-ui|scene-social-preview))\.js"><\/script>/g,'');
 const actorScene='<script src="/ui-generated-20261030/characters-v1/scene.js"></script>';
 if(s.split(actorScene).length!==2)throw Error('Visual HTML scene script changed');
 s=s.replace(actorScene,`<script src="${maps}/encounter-catalog.js"></script><script src="${prefix}/scene.js"></script>`);
 const ui='<script src="ui.js"></script>';if(s.split(ui).length!==2)throw Error('Visual HTML UI script changed');s=s.replace(ui,`<script src="${prefix}/ui.js"></script>`);
 if(!s.includes('window.RPG_LIVE_SOCIAL=true'))s=s.replace('</head>',`<script>window.RPG_LIVE_SOCIAL=true;</script></head>`);
 if(!s.includes('scene-chat-ui.css'))s=s.replace('</head>',`<link rel="stylesheet" href="${social}/scene-chat-ui.css"><link rel="stylesheet" href="${social}/scene-social-preview.css"></head>`);
 if(!s.includes('scene-hero-readability.css'))s=s.replace('</head>',`<link rel="stylesheet" href="${social}/scene-hero-readability.css"></head>`);
 s=s.replace(`<script src="${prefix}/scene.js"></script>`,`<script src="${social}/scene-hero-readability.js"></script><script src="${prefix}/scene.js"></script>`);
 s=s.replace('</head>',`<link rel="stylesheet" href="${social}/atlas-talents-ui.css"><link rel="stylesheet" href="${social}/equipment-collection-ui.css"></head>`);
 return s.replace('</body>',`<script src="${social}/atlas-talents-ui.js"></script><script src="${social}/atlas-progression-ui.js"></script><script src="${social}/equipment-collection-ui.js"></script><script src="${social}/scene-atlas-guide.js"></script><script src="${social}/scene-chat-ui.js"></script><script src="${social}/scene-social-preview.js"></script></body>`);
}
export function bindPreviewHtml(source){
 let s=source.replace('src="/ui-generated-20261030/characters-v1/scene.html"',`src="${prefix}/scene.html"`);
 if(!s.includes(`${prefix}/scene.html`))throw Error('Visual preview iframe changed');
 if(!s.includes('hud-angels-20261102/hud-angels.js'))s=s.replace('</body>',`<script src="${social}/hud-angels.js?v=20261102-angels1"></script></body>`);
 if(!s.includes('progression-maps-20261102/scene-map-preview-controls.js'))s=s.replace('</body>',`<script src="${maps}/scene-map-preview-controls.js"></script></body>`);
 if(!s.includes('rel="icon"'))s=s.replace('</head>','<link rel="icon" href="data:,"></head>');
 return s;
}
export async function boundPreviewResponse(requestPath,root){
 if(requestPath==='/ui-generated-20261030/preview.html')return {type:'text/html; charset=utf-8',body:bindPreviewHtml(await fs.readFile(path.join(root,'ui-generated-20261030/preview.html'),'utf8'))};
 if(requestPath===`${prefix}/scene.html`)return {type:'text/html; charset=utf-8',body:bindSceneHtml(await fs.readFile(path.join(root,'ui-generated-20261030/characters-v1/scene.html'),'utf8'))};
 if(requestPath===`${prefix}/scene.js`)return {type:'text/javascript; charset=utf-8',body:bindScene(await fs.readFile(path.join(root,'ui-generated-20261030/characters-v1/scene.js'),'utf8'))};
 if(requestPath===`${prefix}/ui.js`)return {type:'text/javascript; charset=utf-8',body:bindUi(await fs.readFile(path.join(root,'ui-proto/ui.js'),'utf8'))};
 return null;
}
