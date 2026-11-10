/* Full-screen Phaser scene. Display-only demo combat (no server, no polling). Locked sizes vs stage height:
   hero 22%, minions 16-20%, elite 28%, boss 40%. Hero auto-roams toward the densest cluster; spin-slash area skill. */
(function(){
'use strict';
var ringG,rim,ghost,ga=0;var Q=new URLSearchParams(location.search),UI=window.UI,META,HS,G,hero,mons=[],sc,fxL,hpG,lastShot=0,bossOut=false,sat;
var visual, debugState={actor:'archer',action:'auto',direction:'auto'}, debugCycle=0, debugFired=false;
// Fixed sword inspection frustum. Source BODY300, footY470 and sprite scale stay unchanged.
// One 1024-unit width covers the supported containers; never fit an actor or animation frame.
var swordInspectionScene=null,swordInspectionCameraKey='';
function swordInspectionZoom(width,height,enabled){
 if(!enabled)return 1;
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=32||height<=0)return null;
 return Math.min(1,(width-32)/(1024*(height*.20/300)));
}
function updateSwordInspectionCamera(){
 if(!visual||!visual.scene)return;
 var scene=visual.scene,camera=scene.cameras.main;
 if(swordInspectionScene!==scene){
  swordInspectionScene=scene;swordInspectionCameraKey='';
  scene.scale.on('resize',updateSwordInspectionCamera);
 }
 var enabled=!!(visual.ready&&/^adv[1-4]_sword_/.test(visual.actor.id)&&debugState.action!=='auto');
 var width=scene.scale.width,height=scene.scale.height,zoom=swordInspectionZoom(width,height,enabled);
 if(zoom===null)return;
 var key=width+'|'+height+'|'+enabled,policyChanged=key!==swordInspectionCameraKey;
 if(policyChanged||Math.abs(camera.zoomX-zoom)>1e-9||Math.abs(camera.zoomY-zoom)>1e-9||camera.followOffset.x!==0||camera.followOffset.y!==0){
  camera.setZoom(zoom);camera.setFollowOffset(0,0);if(enabled&&policyChanged)camera.centerOn(visual.sprite.x,visual.sprite.y);swordInspectionCameraKey=key;
 }
}
function initializeThiefAutoPose(){
 if(debugState.action==='auto'&&visual?.ready&&visual.isThiefPreviewLocomotion()){
  visual.stepThiefPreviewMotion(0,false,visual.direction);visual.update(0);
 }
}
function loadCharacter(id){
 if(!visual)return;
 var loading=visual.load(id);updateSwordInspectionCamera();
 loading.then(function(){if(debugState.actor!==id)return;debugCycle=0;debugFired=false;visual.play(debugState.action==='auto'?'idle':debugState.action,debugState.direction==='auto'?visual.direction:debugState.direction,true);initializeThiefAutoPose();updateSwordInspectionCamera();}).catch(function(error){updateSwordInspectionCamera();parent.postMessage({type:'character-error',message:error.message},location.origin);});
}
window.addEventListener('message',function(event){
 if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='character-preview')return;
 var d=event.data;
 if(!["sword", "archer", "mage", "thief", "sword_m", "archer_m", "mage_m", "thief_m", "adv1_sword_A_f", "adv1_sword_A_m", "adv1_sword_B_f", "adv1_sword_B_m", "adv1_archer_A_f", "adv1_archer_A_m", "adv1_archer_B_f", "adv1_archer_B_m", "adv1_mage_A_f", "adv1_mage_A_m", "adv1_mage_B_f", "adv1_mage_B_m", "adv1_thief_A_f", "adv1_thief_A_m", "adv1_thief_B_f", "adv1_thief_B_m", "adv2_sword_A1_f", "adv2_sword_A1_m", "adv2_sword_A2_f", "adv2_sword_A2_m", "adv2_sword_B1_f", "adv2_sword_B1_m", "adv2_sword_B2_f", "adv2_sword_B2_m", "adv3_sword_A11_f", "adv3_sword_A11_m", "adv3_sword_A12_f", "adv3_sword_A12_m", "adv3_sword_A21_f", "adv3_sword_A21_m", "adv3_sword_A22_f", "adv3_sword_A22_m", "adv3_sword_B11_f", "adv3_sword_B11_m", "adv3_sword_B12_f", "adv3_sword_B12_m", "adv3_sword_B21_f", "adv3_sword_B21_m", "adv3_sword_B22_f", "adv3_sword_B22_m", "adv4_sword_B222_f", "adv4_sword_B222_m", "adv2_archer_A1_f", "adv2_archer_A1_m", "adv2_archer_A2_f", "adv2_archer_A2_m", "adv2_archer_B1_f", "adv2_archer_B1_m", "adv2_archer_B2_f", "adv2_archer_B2_m", "adv3_archer_A11_f", "adv3_archer_A11_m", "adv3_archer_A12_f", "adv3_archer_A12_m", "adv3_archer_A21_f", "adv3_archer_A21_m", "adv3_archer_A22_f", "adv3_archer_A22_m", "adv3_archer_B11_f", "adv3_archer_B11_m", "adv3_archer_B12_f", "adv3_archer_B12_m", "adv3_archer_B21_f", "adv3_archer_B21_m", "adv3_archer_B22_f", "adv2_mage_A1_f", "adv2_mage_A1_m", "adv2_mage_A2_f", "adv2_mage_A2_m", "adv2_mage_B1_f", "adv2_mage_B1_m", "adv2_mage_B2_f", "adv2_mage_B2_m", "adv3_mage_A11_f", "adv3_mage_A11_m", "adv3_mage_A12_f", "adv3_mage_A12_m", "adv3_mage_A21_f", "adv3_mage_A21_m", "adv3_mage_A22_f", "adv3_mage_A22_m", "adv3_mage_B11_f", "adv3_mage_B11_m", "adv3_mage_B12_f", "adv3_mage_B12_m", "adv3_mage_B21_f", "adv3_mage_B21_m", "adv3_mage_B22_f", "adv3_mage_B22_m", "adv2_thief_A1_f", "adv2_thief_A1_m", "adv2_thief_A2_f", "adv2_thief_A2_m", "adv2_thief_B1_f", "adv2_thief_B1_m", "adv2_thief_B2_f", "adv2_thief_B2_m", "adv3_thief_A11_f", "adv3_thief_A11_m", "adv3_thief_A12_f", "adv3_thief_A12_m", "adv3_thief_A21_m", "adv3_thief_A22_m", "adv3_thief_B11_m", "adv4_mage_A111_f", "adv4_mage_A111_m", "adv4_mage_A112_m", "adv4_mage_A121_f", "adv4_mage_A122_m", "adv4_mage_A121_m", "adv4_sword_B221_f", "adv4_sword_B221_m", "adv4_sword_B212_f", "adv4_sword_B212_m", "adv4_mage_A112_f", "adv4_mage_A221_f", "adv4_mage_A212_m", "adv4_mage_B111_m", "adv4_sword_B211_m", "adv4_sword_B122_f", "adv4_mage_B111_f", "adv4_mage_A222_m", "adv4_mage_B121_m", "adv4_sword_B122_m", "adv4_mage_B121_f", "adv4_sword_B211_f", "adv4_sword_B121_m", "adv4_mage_A122_f", "adv4_mage_B211_m", "adv4_mage_B112_m", "adv4_sword_B121_f", "adv4_mage_B211_f", "adv4_mage_B122_m", "adv4_mage_B221_m", "adv4_mage_B221_f", "adv4_sword_B112_m", "adv4_mage_A221_m", "adv4_sword_B111_m", "adv4_mage_A212_f", "adv4_mage_B122_f", "adv4_mage_A211_f", "adv4_mage_B212_m", "adv4_sword_B112_f", "adv4_mage_B212_f", "adv4_mage_B222_m", "adv4_mage_B112_f", "adv4_sword_B111_f", "adv4_mage_B222_f", "adv4_mage_A211_m", "adv4_mage_A222_f", "adv4_sword_A112_m", "adv4_sword_A111_m", "adv4_sword_A112_f", "adv4_sword_A122_m", "adv4_sword_A111_f", "adv4_sword_A121_m", "adv3_thief_A22_f", "adv4_thief_A111_m", "adv4_sword_A121_f", "adv4_sword_A212_m", "adv3_thief_A21_f", "adv4_sword_A211_f", "adv4_thief_A111_f", "adv3_thief_B12_m", "adv4_sword_A122_f", "adv4_sword_A211_m", "adv4_sword_A221_m", "adv3_thief_B11_f", "adv4_sword_A221_f", "adv4_sword_A212_f", "adv4_sword_A222_f", "adv4_sword_A222_m", "adv4_thief_A211_m", "adv3_thief_B21_m", "adv4_thief_A112_m", "adv3_thief_B12_f", "adv3_thief_B22_m", "adv4_thief_B222_f", "adv4_thief_A121_m", "adv4_thief_A221_m", "adv4_thief_B212_f", "adv4_thief_B221_f", "adv4_thief_A212_m", "adv4_thief_B221_m", "adv3_thief_B22_f", "adv4_thief_B211_f", "adv4_thief_B112_f", "adv4_thief_B111_m", "adv4_thief_A112_f", "adv4_thief_B111_f", "adv4_thief_A122_m", "adv4_thief_B211_m", "adv4_thief_A222_m", "adv4_thief_B222_m", "adv4_thief_A122_f", "adv4_thief_A221_f", "adv4_thief_A121_f", "adv4_thief_A211_f", "adv4_thief_B122_m", "adv4_thief_A222_f", "adv4_thief_B112_m", "adv4_thief_B122_f", "adv4_thief_B121_m", "adv4_thief_B121_f", "adv3_thief_B21_f", "adv4_thief_A212_f", "adv4_thief_B212_m", "adv4_archer_A111_f", "adv4_archer_A111_m", "adv4_archer_A112_f", "adv4_archer_A112_m", "adv3_archer_B22_m", "adv4_archer_A121_f", "adv4_archer_A121_m", "adv4_archer_A122_f", "adv4_archer_A122_m", "adv4_archer_A211_f", "adv4_archer_A211_m", "adv4_archer_A212_f", "adv4_archer_A212_m", "adv4_archer_A221_f", "adv4_archer_A221_m", "adv4_archer_A222_f", "adv4_archer_A222_m", "adv4_archer_B111_f", "adv4_archer_B111_m", "adv4_archer_B112_f", "adv4_archer_B112_m", "adv4_archer_B121_f", "adv4_archer_B121_m", "adv4_archer_B122_f", "adv4_archer_B122_m", "adv4_archer_B211_f", "adv4_archer_B211_m", "adv4_archer_B212_f", "adv4_archer_B212_m", "adv4_archer_B221_f", "adv4_archer_B221_m", "adv4_archer_B222_f", "adv4_archer_B222_m"].includes(d.actor)||!['auto','walk','attack','idle','death'].includes(d.action)||!['auto','up','down','left','right'].includes(d.direction))return;
 if(visual)visual.cancelThiefPreviewMotion();
 var changed=d.actor!==debugState.actor; debugState={actor:d.actor,action:d.action,direction:d.direction};debugCycle=0;debugFired=false;
 if(d.action!=='auto'&&hero&&G&&G.w){hero.x=G.w/2;hero.y=G.h*.6;}
 if(changed)loadCharacter(d.actor);
 if(visual?.ready){visual.play(d.action==='auto'?'idle':d.action,d.direction==='auto'?'down':d.direction,true);initializeThiefAutoPose();}
 updateSwordInspectionCamera();
});
function projectileTo(target,damage){
 var dir=visual.direction,vector=dir==='up'?[0,-1]:dir==='down'?[0,1]:dir==='left'?[-1,0]:[1,0];
 var startX=hero.x+vector[0]*HS*.055,startY=hero.y-HS*.115+vector[1]*HS*.025;
 var origin=visual.releaseOrigin();if(origin){startX=hero.x+origin.x*HS*.20;startY=hero.y+origin.y*HS*.20;}
 var tx=target?target.x:startX+vector[0]*HS*.4,ty=target?target.y-HS*target.pct*.5:startY+vector[1]*HS*.32;
 // Only these exact reviewed LEFT sources contain their visible released arrow.
 var expectedSource=visual.actor.id==='adv4_archer_B222_m'?'6ed91beed5fb0ccd515ad0d7977b8cf47429f4c0661ce38126c0ae3646c8f838':visual.actor.id==='adv4_archer_B222_f'?'7c1a8fde0f745975a7873462d442026ba9e5a7002c53196a5bf5a6e9c7ea5a8a':null;
 var source=visual.current()?.source,presentation=source?.projectilePresentation;
 var sourceAuthored=!!(expectedSource&&visual.action==='attack'&&visual.activeDirection==='left'
  &&source.authoredEffects===true&&source.sourceSha256===expectedSource&&presentation?.kind==='source-authored'&&presentation.sourceSha256===expectedSource
  &&Array.isArray(source.frames)&&source.frames.length===4&&source.frames.every(function(frame){return frame.sourceSha256===expectedSource;}));
 // Keep the original 300ms shot tween and completion/hit timing; suppress presentation only.
 var shot=sourceAuthored?{x:startX,y:startY}:sc.add.graphics({x:startX,y:startY}).setDepth(9700),isMage=(visual.actor.family||visual.actor.id)==='mage';
 if(!sourceAuthored){
  if(isMage){shot.fillStyle(0xb0d9ff,1).fillCircle(0,0,4);shot.lineStyle(3,0x6aa0ff,.7).lineBetween(-14,0,0,0);}
  else{shot.lineStyle(2,0xe9dba5,1).lineBetween(-20,0,4,0);shot.fillStyle(0xe9dba5,1).fillTriangle(6,0,-1,-3,-1,3);}
  shot.setRotation(Math.atan2(ty-startY,tx-startX));
 }
 sc.tweens.add({targets:shot,x:tx,y:ty,duration:300,ease:'Linear',onComplete:function(){if(!sourceAuthored)shot.destroy();if(target&&alive(target)&&damage)hit(target,damage,false);}});
}
function performPreviewAttack(target){
 var damage=Math.round(75+Math.random()*60),ranged=['archer','mage'].includes(visual.actor.family||visual.actor.id);
 if(ranged)projectileTo(target,damage);else if(target&&alive(target))hit(target,damage,false);
}
function updateCharacterPreview(dt){
 if(!visual?.ready)return;
 var dir=debugState.direction==='auto'?(Math.floor(debugCycle/3)%2?'up':'down'):debugState.direction;
 if(debugState.action!=='auto'){
  visual.cancelMagePreviewMotion();
  visual.cancelThiefPreviewMotion();
  debugCycle+=dt;
  if(visual.activeDirection!==dir)debugFired=false;
  if(debugState.action==='walk'){
   visual.play('walk',dir);
  }else if(debugState.action==='attack'){
   visual.play('attack',dir);
   if(visual.elapsed>=visual.releaseDelay()&&!debugFired){debugFired=true;if(['archer','mage'].includes(visual.actor.family||visual.actor.id))projectileTo(null,0);}
   if(visual.elapsed>=visual.duration('attack')+400){visual.play('attack',dir,true);debugFired=false;}
  }else visual.play(debugState.action,dir);
 }
 visual.update(dt*1000);
 updateSwordInspectionCamera();
}

var CAP=Number(Q.get('cap'))||24;// monster cap (alive)
var NAMES={titan_hoof_beast:'泰坦巨足獸',earthsplit_stone_demon:'裂地石魔',thunder_lizard:'雷霆蜥蜴',storm_acolyte:'風暴祭徒',magnet_stone_bug:'磁岩蟲',titan_soldier:'泰坦遺兵',titan_vanguard:'泰坦先鋒戰將',lava_colossus:'熔岩巨像'};
var MIN=['titan_hoof_beast','earthsplit_stone_demon','thunder_lizard','storm_acolyte','magnet_stone_bug','titan_soldier'];
var stage=document.getElementById('stage');
function preload(){var L=this.load;L.image('ground','assets/ground.webp');L.json('meta','assets/meta.json');
 ['walk_right','attack_right','idle','death_down'].forEach(function(n){L.spritesheet('hero_'+n,'assets/hero_'+n+'.webp',{frameWidth:312,frameHeight:248});});
 L.spritesheet('fx_whirlwind','assets/fx_whirlwind.webp',{frameWidth:224,frameHeight:224});L.spritesheet('fx_hit_sparks','assets/fx_hit_sparks.webp',{frameWidth:224,frameHeight:224});
 L.on('filecomplete-json-meta',function(k,t,d){Object.keys(d).forEach(function(n){L.spritesheet(n,'assets/'+n+'.webp',{frameWidth:d[n].cw,frameHeight:d[n].ch,endFrame:d[n].frames-1});});});}
function create(){sc=this;META=this.cache.json.get('meta');HS=this.scale.height;
 var gi=this.textures.get('ground').getSourceImage(),k=Math.max(HS*2.6/gi.height,this.scale.width*1.8/gi.width);G={w:gi.width*k,h:gi.height*k};
 this.add.image(0,0,'ground').setOrigin(0).setScale(k);
 this.cameras.main.setBounds(0,0,G.w,G.h);
 // no full-screen colour filter (FPS): mood comes from the CSS sky/vignette overlay
 // anims
 var A=this.anims;function mk(key,tex,fr,rate,rep){if(!A.exists(key))A.create({key:key,frames:A.generateFrameNumbers(tex,fr),frameRate:rate,repeat:rep});}
 mk('h_walk','hero_walk_right',{},13,-1);mk('h_atk','hero_attack_right',{},20,0);mk('h_idle','hero_idle',{frames:[4,5]},3,-1);
 Object.keys(META).forEach(function(n){var a=n.split('_').pop();mk(n,n,{},a=='attack'?14:a=='death'?10:a=='walk'?(META[n].frames<8?6:11):6,(a=='idle'||a=='walk')?-1:0);});
 mk('fx_spin','fx_whirlwind',{},22,0);mk('fx_hit','fx_hit_sparks',{},28,0);
 hero=this.add.sprite(G.w/2,G.h*.6,'hero_idle').setOrigin(.5,.9355);hero.setScale(HS*.22/205);hero.play('h_idle');
 ringG=this.add.graphics().setDepth(1);
 rim=this.add.sprite(0,0,'hero_idle').setOrigin(.5,.9355).setTintFill(0xfff0c0).setBlendMode(Phaser.BlendModes.ADD).setAlpha(.0);
 ghost=this.add.sprite(0,0,'hero_idle').setOrigin(.5,.9355).setTintFill(0xbfe0ff).setDepth(9300).setAlpha(0);
 hero.hp=3600;hero.mhp=3600;hero.rage=60;hero.atkT=0;hero.face=1;hero.busy=0;
 this.cameras.main.startFollow(hero,true,.08,.08);
 hpG=this.add.graphics().setDepth(9000);fxL=this.add.layer().setDepth(9500);
 horde(this,10+Math.floor(Math.random()*6));
 if(Q.get('boss'))spawnBoss(this,true);
 visual=new CharacterSprites.Animator(this,hero);visual.enableMagePreviewLocomotion();visual.enableThiefPreviewLocomotion();hero.play=function(key,ignore){if(visual.ready)visual.play(key==='h_walk'?'walk':key==='h_atk'?'attack':'idle',visual.direction,!ignore);return hero;};loadCharacter(debugState.actor);
 UI.cast=function(i){if(visual?.ready)castSkill(i,true);};
 this.time.addEvent({delay:9000,loop:true,callback:function(){var n=mons.filter(alive).length;if(n<CAP-8)horde(sc,Math.min(8+Math.floor(Math.random()*8),CAP-n));}});
 this.time.addEvent({delay:21000,loop:true,callback:function(){spawnElite(sc);}});
 spawnElite(this);
 // portrait + doll
 UI.setHP(hero.hp,hero.mhp);UI.setMP(hero.rage,100);UI.setXP(.62);
 setTimeout(function(){UI.toast('進入 奧林帕斯泰坦山隘','建議等級 25–30・世界階級 Ⅱ','helm');},600);
 if(Q.get('panel'))setTimeout(function(){UI.toggle(Q.get('panel'));},400);
 this.scale.on('resize',function(s){HS=s.height;});window.addEventListener('resize',function(){var b=stage.getBoundingClientRect();sc.scale.setParentSize(b.width,b.height);});
}
var SLOTS=7;function ringR(m){return HS*(m.role=='boss'?.21:m.role=='elite'?.17:.13+(m.pct-.16)*.5);}
function alive(m){return m.active&&m.hp>0;}
function mkMon(s,name,role,x,y){var base=name+'_',M=META[base+'walk'],pct=role=='boss'?.40:role=='elite'?.28:(.16+Math.random()*.04);
 var m=s.add.sprite(x,y,base+'walk').setOrigin(M.ox,M.oy);m.setScale(HS*pct/M.body);m.play(base+'walk');m.anims.setProgress(Math.random());
 m.nm=name;m.role=role;m.mhp=role=='boss'?9000:role=='elite'?1600:220;m.hp=m.mhp;m.spd=(role=='minion'?55:40)*HS/700;m.atkT=Math.random()*2;m.pct=pct;mons.push(m);return m;}
function horde(s,n){var cx=Phaser.Math.Clamp(hero.x+(Math.random()-.5)*HS*1.6,HS*.3,G.w-HS*.3),cy=Phaser.Math.Clamp(hero.y+(Math.random()-.5)*HS*1.4,HS*.4,G.h-HS*.2);
 var kinds=Phaser.Utils.Array.Shuffle(MIN.slice()).slice(0,2);for(var i=0;i<n;i++){var a=Math.random()*6.28,r=Math.sqrt(Math.random())*HS*.32;mkMon(s,kinds[i%2],'minion',cx+Math.cos(a)*r,cy+Math.sin(a)*r*.7);}}
function spawnElite(s){if(debugState.action!=='auto')return;var a=Math.random()*6.28;var m=mkMon(s,'titan_vanguard','elite',Phaser.Math.Clamp(hero.x+Math.cos(a)*HS*.6,100,G.w-100),Phaser.Math.Clamp(hero.y+Math.sin(a)*HS*.5,HS*.4,G.h-60));UI.toast('精英出現：泰坦先鋒戰將','擊敗可獲得稀有以上裝備','shield');}
function spawnBoss(s,near){if(bossOut)return;bossOut=true;var m=mkMon(s,'lava_colossus','boss',Phaser.Math.Clamp(hero.x+HS*.16,200,G.w-200),hero.y-HS*.02);s.cameras.main.shake(400,.006);UI.toast('首領降臨：熔岩巨像','山隘的大地在顫抖……','rage');}
function dmgText(x,y,v,col,big){var t=sc.add.text(x,y,v,{fontFamily:'"Noto Serif TC","Noto Sans CJK TC",serif',fontSize:Math.round(HS*(big?.036:.024))+'px',fontStyle:'bold',color:col,stroke:'#000',strokeThickness:Math.max(3,HS*.005)}).setOrigin(.5).setDepth(9800);
 sc.tweens.add({targets:t,y:y-HS*.07,alpha:{from:1,to:0},scale:{from:big?1.4:1,to:.9},duration:900,ease:'Cubic.out',onComplete:function(){t.destroy();}});}
function hit(m,d,crit){if(!alive(m))return;m.hp-=d;dmgText(m.x+(Math.random()-.5)*30,m.y-m.displayHeight*m.pct*0+(-HS*m.pct),crit?d+'!':d,crit?'#ffd36a':'#f2efe6',crit);
 m.setTintFill(0xffffff);sc.time.delayedCall(60,function(){m.clearTint();});m.x+=(m.x>hero.x?1:-1)*HS*.008;
 var f=sc.add.sprite(m.x,m.y-HS*m.pct*.5,'fx_hit_sparks').setBlendMode(Phaser.BlendModes.ADD).setScale(HS*.12/224).setDepth(9400);f.play('fx_hit');f.on('animationcomplete',function(){f.destroy();});
 if(m.hp<=0)kill(m);}
function kill(m){var b=m.nm+'_';m.play(b+'death');m.hp=0;UI.addKill();hero.rage=Math.min(100,hero.rage+5);
 dmgText(m.x,m.y-HS*m.pct*1.1,'+'+(m.role=='boss'?2400:m.role=='elite'?380:42)+' 經驗值','#c8b6ff',false);
 if(m.role=='elite')UI.toast('擊敗精英：泰坦先鋒戰將','獲得 稀有・雷鳴戰盔','helm');
 if(m.role=='boss'){UI.toast('首領已擊敗：熔岩巨像','獲得 傳奇・泰坦裂空劍','sword');bossOut=false;}
 sc.tweens.add({targets:m,alpha:0,delay:1400,duration:600,onComplete:function(){m.destroy();mons.splice(mons.indexOf(m),1);}});
 if(UI.kills==40&&!bossOut)spawnBoss(sc);}
function castSkill(i,user){var name=UI.skills[i].name;if(name!='slash'&&!UI.trigger(i))return;
 if(name=='spin'){hero.busy=Math.max(.8,visual.duration('attack')/1000);var f=sc.add.sprite(hero.x,hero.y-HS*.06,'fx_whirlwind').setBlendMode(Phaser.BlendModes.ADD).setScale(HS*.5/224).setDepth(hero.depth+1);f.play('fx_spin');f.on('animationcomplete',function(){f.destroy();});
  sc.tweens.add({targets:hero,angle:{from:0,to:0},duration:500});hero.play('h_atk');sc.cameras.main.shake(160,.004);
  mons.filter(alive).forEach(function(m){var d=Phaser.Math.Distance.Between(hero.x,hero.y,m.x,m.y);if(d<HS*.24)hit(m,Math.round((180+Math.random()*90)*(m.role=='minion'?1:.6)),Math.random()<.25);});}
 else if(name=='potion'){hero.hp=Math.min(hero.mhp,hero.hp+hero.mhp*.4);dmgText(hero.x,hero.y-HS*.25,'+1440','#7dff8a',true);}
 else if(name=='shout'){UI.toast('戰吼','攻擊力 +20%・持續 10 秒','shout');}
 else if(name=='quake'||name=='charge'){sc.cameras.main.shake(260,.007);mons.filter(alive).forEach(function(m){if(Phaser.Math.Distance.Between(hero.x,hero.y,m.x,m.y)<HS*.34)hit(m,Math.round(260+Math.random()*140),Math.random()<.3);});}}
function dens(m,list){var c=0;for(var j=0;j<list.length;j++)if(Phaser.Math.Distance.Between(m.x,m.y,list[j].x,list[j].y)<HS*.25)c++;return c;}
// Display-only mage auto movement follows the actual planted foot. Manual playback is unchanged.
function mageDemoAutoStep(near,nd,target,dt){
 var close=near&&nd<ringR(near)*1.12+HS*.02;
 var dx=target?target.x-hero.x:0,dy=target?target.y-hero.y:0;
 var previous=visual.mageController?.direction||visual.direction;
 var direction=debugState.direction==='auto'?MagePreviewLocomotion.targetDirection(dx,dy,previous):debugState.direction;
 var moving=!!target&&!close;
 var active=visual.mageController?.profile||MagePreviewLocomotion.profile(visual.actor,direction);
 var margin=active.stopBudgetBodyUnits*HS*.20+2,travel=visual.mageController?.direction||direction;
 // Stop before the existing scene clamp; do not advance a planted pose into a wall.
 if((travel==='right'&&G.w-HS*.15-hero.x<=margin)||(travel==='left'&&hero.x-HS*.15<=margin)||
    (travel==='down'&&G.h-HS*.08-hero.y<=margin)||(travel==='up'&&hero.y-HS*.35<=margin))moving=false;
 var step=visual.stepMagePreviewMotion(dt*1000,moving,direction);
 hero.x+=step.deltaBody[0]*HS*.20;hero.y+=step.deltaBody[1]*HS*.20;
 if(step.settled&&close&&hero.atkT<=0){
  visual.face(near.x-hero.x,near.y-hero.y);if(debugState.direction!=='auto')visual.direction=debugState.direction;
  hero.atkT=visual.duration('attack')/1000+.18;hero.play('h_atk');hero.busy=visual.duration('attack')/1000;
  var attackTarget=near,attackGeneration=visual.generation;
  sc.time.delayedCall(visual.releaseDelay(),function(){
   if(visual.ready&&visual.generation===attackGeneration&&debugState.action==='auto'&&alive(attackTarget))performPreviewAttack(attackTarget);
  });
 }
}

// Thief auto movement and pose use the same planted-foot controller result.
function thiefDemoAutoStep(near,nd,target,dt){
 var close=near&&nd<ringR(near)*1.12+HS*.02;
 var dx=target?target.x-hero.x:0,dy=target?target.y-hero.y:0;
 var previous=visual.thiefController?.direction||visual.direction;
 var direction=debugState.direction==='auto'?ThiefPreviewLocomotion.targetDirection(dx,dy,previous):debugState.direction;
 var moving=!!target&&!close;
 var active=visual.thiefController?.profile||ThiefPreviewLocomotion.profile(visual.actor,direction);
 var margin=active.stopBudgetBodyUnits*HS*.20+2,travel=visual.thiefController?.direction||direction;
 if((travel==='right'&&G.w-HS*.15-hero.x<=margin)||(travel==='left'&&hero.x-HS*.15<=margin)||
    (travel==='down'&&G.h-HS*.08-hero.y<=margin)||(travel==='up'&&hero.y-HS*.35<=margin))moving=false;
 var step=visual.stepThiefPreviewMotion(dt*1000,moving,direction);
 hero.x+=step.deltaBody[0]*HS*.20;hero.y+=step.deltaBody[1]*HS*.20;
 if(step.settled&&close&&hero.atkT<=0){
  visual.face(near.x-hero.x,near.y-hero.y);if(debugState.direction!=='auto')visual.direction=debugState.direction;
  hero.atkT=visual.duration('attack')/1000+.18;hero.play('h_atk');hero.busy=visual.duration('attack')/1000;
  var attackTarget=near,attackGeneration=visual.generation;
  sc.time.delayedCall(visual.releaseDelay(),function(){
   if(visual.ready&&visual.generation===attackGeneration&&debugState.action==='auto'&&alive(attackTarget))performPreviewAttack(attackTarget);
  });
 }
}
function thiefPaintedAutoStep(target,dt){
 var a=Math.atan2(target.y-hero.y,target.x-hero.x),dx=Math.cos(a),dy=Math.sin(a);
 visual.face(dx,dy);if(debugState.direction!=='auto')visual.direction=debugState.direction;
 var speed=window.ThiefPreviewLocomotion?.paintedSpeedBodyUnits(visual.actor,visual.direction,window.ThiefPreviewMotionProfiles);
 if(!Number.isFinite(speed)||speed<=0){
  visual.thiefMissingMotionProfile=visual.actor.id+'/'+visual.direction;
  hero.play('h_idle',true);return;
 }
 visual.thiefMissingMotionProfile=null;
 var distance=speed*HS*.20*dt;hero.x+=dx*distance;hero.y+=dy*distance;hero.play('h_walk',true);
}

// Exact two-ID archer RIGHT preview. Enabled only when its explicit same-source kit neutral idle is present; URL 0 disables.
var archerRightPreviewState = {adapter:null, visual:null, generation:null, loading:null, error:null, poseOwned:false};
function archerRightPreviewRequested(){
 try{
  const local=new URLSearchParams(location.search).get('archerGaitPreview');
  const parentValue=window.parent!==window?new URLSearchParams(window.parent.location.search).get('archerGaitPreview'):null;
  return local!=='0'&&parentValue!=='0';
 }catch(e){return false;}
}
function clearArcherRightPreview(){
 var a=archerRightPreviewState.adapter;if(a)a.dispose();
 archerRightPreviewState={adapter:null,visual:null,generation:null,loading:null,error:null,poseOwned:false};
 window.__archerRightPreviewState=archerRightPreviewState;
}
function archerRightPreviewDesired(target){
 if(debugState.direction!=='auto')return debugState.direction;
 if(!target)return visual.direction;
 var dx=target.x-hero.x,dy=target.y-hero.y;
 return Math.abs(dx)>Math.abs(dy)?(dx<0?'left':'right'):(dy<0?'up':'down');
}
function archerRightPreviewB1HoldInvalidated(){
 var state=archerRightPreviewState,b=state.b1Binding;
 if(!b||!archerRightPreviewRequested()||!visual?.ready||state.visual!==visual||state.generation!==visual.generation||b.visual!==visual||b.generation!==visual.generation)return false;
 if(!state.b1Invalidated){
  var sameSources=visual.actor===b.actor&&visual.actor.clips?.idle?.right===b.idle&&visual.actor.clips?.walk?.right===b.walk;
  var headerOk=!!(sameSources&&window.ArcherRightPreviewAdapter&&window.ArcherRightPreviewLocomotion&&ArcherRightPreviewLocomotion.eligible(visual.actor,'right'));
  var valid=headerOk&&!state.error&&!state.adapter?.b1Invalidated;
  // Pending B1 source verification is not itself an invalid binding.
  if(valid&&!state.loading)valid=!!state.adapter?.isBound();
  if(!valid){state.b1Invalidated=true;if(state.adapter)state.adapter.dispose();}
 }
 if(state.b1Invalidated){state.poseOwned=false;visual.play('idle','right',false);return true;}
 return false;
}
function archerRightDemoAutoStep(near,nd,target,dt){
 if(archerRightPreviewB1HoldInvalidated())return true;
 if(!archerRightPreviewRequested() || !window.ArcherRightPreviewAdapter || !window.ArcherRightPreviewLocomotion ||
    !visual?.ready || !ArcherRightPreviewLocomotion.eligible(visual.actor,'right')){
  if(archerRightPreviewState.adapter)clearArcherRightPreview();
  return false;
 }
 var state=archerRightPreviewState,desired=archerRightPreviewDesired(target);
 if(state.adapter&&(state.visual!==visual||state.generation!==visual.generation)){clearArcherRightPreview();state=archerRightPreviewState;}
 var active=state.adapter?.isBound()&&state.adapter.controller.stage!=='idle';
 if(desired!=='right'&&!active){if(state.adapter)clearArcherRightPreview();return false;}
 if(!state.adapter){
  state.adapter=new ArcherRightPreviewAdapter(visual,{enabled:true,evaluationOnly:true});
  state.visual=visual;state.generation=visual.generation;
  if(visual.actor?.id==='adv2_archer_B1_m'){state.b1Binding=Object.freeze({visual,generation:visual.generation,actor:visual.actor,idle:visual.actor.clips.idle.right,walk:visual.actor.clips.walk.right});state.b1Invalidated=false;}
  state.loading=state.adapter.bind('right').then(function(ok){state.loading=null;if(!ok)state.error='Actor changed while binding reviewed RIGHT source';}).catch(function(error){state.loading=null;state.error=String(error);console.error(error);});
  window.__archerRightPreviewState=state;
 }
 // Keep the existing portrait idle while the exact source is being verified.
 if(state.loading||state.error||!state.adapter.isBound()){state.poseOwned=false;visual.play('idle','right',false);return true;}
 var close=near&&nd<ringR(near)*1.12+HS*.02;
 var moving=!!target&&!close&&desired==='right';
 visual.face(1,0);visual.play('walk','right',false);
 var step=state.adapter.step(dt*1000,{moving:moving,bounds:{right:G.w-HS*.15}});
 state.lastStep=step;state.poseOwned=!step.settled;
 if(step.settled){
  // Deliberately return to the original portrait idle so the true handoff is reviewable.
  visual.play('idle','right',false);
  if(desired!=='right'){clearArcherRightPreview();return true;}
  if(close&&hero.atkT<=0){
   visual.face(near.x-hero.x,near.y-hero.y);if(debugState.direction!=='auto')visual.direction=debugState.direction;
   hero.atkT=visual.duration('attack')/1000+.18;hero.play('h_atk');hero.busy=visual.duration('attack')/1000;
   var attackTarget=near,attackGeneration=visual.generation;
   sc.time.delayedCall(visual.releaseDelay(),function(){
    if(visual.ready&&visual.generation===attackGeneration&&debugState.action==='auto'&&alive(attackTarget))performPreviewAttack(attackTarget);
   });
  }
 }
 return true;
}
function archerRightPreviewAfterFrame(){
 var state=archerRightPreviewState;
 if(!state.adapter)return;
 if(!archerRightPreviewRequested()||debugState.action!=='auto'||state.visual!==visual||state.generation!==visual.generation||!visual?.ready){clearArcherRightPreview();return;}
 if(state.poseOwned&&visual.action==='walk'&&visual.activeDirection==='right')state.adapter.draw();
}

var tgt=null,retarget=0;
function update(t,dms){var dt=Math.min(.05,dms/1000),live=mons.filter(alive);if(!visual?.ready){rim.setAlpha(0);ghost.setAlpha(0);return;}
 retarget-=dt;if(retarget<=0||!tgt||!alive(tgt)){retarget=.8;var best=null,bs=-1;live.forEach(function(m){var s=dens(m,live)*(m.role=='boss'?3:1)-Phaser.Math.Distance.Between(hero.x,hero.y,m.x,m.y)/(HS*.6);if(s>bs){bs=s;best=m;}});tgt=best;}
 hero.atkT-=dt;hero.busy-=dt;
 var near=null,nd=1e9;live.forEach(function(m){var d=Phaser.Math.Distance.Between(hero.x,hero.y,m.x,m.y);if(d<nd){nd=d;near=m;}});
 if(debugState.action==='auto'&&visual?.ready&&hero.busy<=0&&archerRightDemoAutoStep(near,nd,tgt,dt)){
  // Only the two source-verified archer RIGHT actors own this preview movement.
 }else if(debugState.action==='auto'&&visual?.ready&&hero.busy<=0&&visual.isMagePreviewLocomotion()){
  mageDemoAutoStep(near,nd,tgt,dt);
 }else if(debugState.action==='auto'&&visual?.ready&&hero.busy<=0&&visual.isThiefPreviewLocomotion()){
  thiefDemoAutoStep(near,nd,tgt,dt);
 }else if(debugState.action==='auto'&&visual?.ready&&hero.busy<=0){
  if(near&&nd<ringR(near)*1.12+HS*.02){if(hero.atkT<=0){visual.face(near.x-hero.x,near.y-hero.y);if(debugState.direction!=='auto')visual.direction=debugState.direction;hero.atkT=visual.duration('attack')/1000+.18;hero.play('h_atk');hero.busy=visual.duration('attack')/1000;
    var cnt=live.filter(function(m){return Phaser.Math.Distance.Between(hero.x,hero.y,m.x,m.y)<HS*.22;}).length;
    if((visual.actor.family||visual.actor.id)==='sword'&&cnt>=4&&UI.skills[1].left<=0&&hero.rage>=25){hero.rage-=25;castSkill(1);}else{var attackTarget=near,attackGeneration=visual.generation;sc.time.delayedCall(visual.releaseDelay(),function(){if(visual.ready&&visual.generation===attackGeneration&&debugState.action==='auto'&&alive(attackTarget))performPreviewAttack(attackTarget);});}}
   else if(!hero.anims.isPlaying||hero.anims.currentAnim.key=='h_walk')hero.play('h_idle',true);}
  else if(tgt){if(visual.actor.family==='thief'&&/^adv[1-4]_thief_/.test(visual.actor.id))thiefPaintedAutoStep(tgt,dt);else{var a=Math.atan2(tgt.y-hero.y,tgt.x-hero.x),sp=HS*.33*dt;hero.x+=Math.cos(a)*sp;hero.y+=Math.sin(a)*sp;visual.face(Math.cos(a),Math.sin(a));if(debugState.direction!=='auto')visual.direction=debugState.direction;hero.play('h_walk',true);}}
  else hero.play('h_idle',true);}
 updateCharacterPreview(dt);
 archerRightPreviewAfterFrame();
 // ring formation: nearest SLOTS monsters take a ring around the hero (no stacking on the hero's feet, front arc kept open),
 // the rest queue on an outer ring -> siege feel without hiding the hero.
 var srt=live.slice().sort(function(p,q){return Phaser.Math.Distance.Between(hero.x,hero.y,p.x,p.y)-Phaser.Math.Distance.Between(hero.x,hero.y,q.x,q.y);});
 srt.forEach(function(m,idx){var b=m.nm+'_',d=Phaser.Math.Distance.Between(hero.x,hero.y,m.x,m.y);m.atkT-=dt;
  var eng=idx<SLOTS||m.role!='minion',rr=ringR(m)*(eng?1:1.75),a=Math.atan2((m.y-hero.y)/.62,m.x-hero.x);
  var fa=a-Math.PI/2;var ex=m.role=='minion'?.7:1.15;if(Math.abs(fa)<ex)a=Math.PI/2+(fa<0?-ex:ex);// keep the arc directly in front (below) the hero open
  var tx=hero.x+Math.cos(a)*rr,ty=hero.y+Math.sin(a)*rr*.62,dd=Math.hypot(tx-m.x,ty-m.y);
  if(d<HS*1.1&&dd>HS*.012){var k=Math.min(1,m.spd*dt/dd);m.x+=(tx-m.x)*k;m.y+=(ty-m.y)*k;m.setFlipX(hero.x<m.x);if(m.anims.currentAnim.key!=b+'attack'||!m.anims.isPlaying)m.play(b+'walk',true);}
  else if(eng&&d<=rr*1.25&&m.atkT<=0){m.atkT=m.role=='boss'?2.4:1.6+Math.random();m.setFlipX(hero.x<m.x);m.play(b+'attack');var dmg=m.role=='boss'?260:m.role=='elite'?90:14;sc.time.delayedCall(350,function(){if(debugState.action==='auto'&&alive(m)){hero.hp=Math.max(hero.mhp*.15,hero.hp-dmg);dmgText(hero.x,hero.y-HS*.2,'-'+dmg,'#ff5a48',false);}});}
  else if(!m.anims.isPlaying)m.play(b+'idle',true);});
 // separation
 for(var i=0;i<live.length;i++)for(var j=i+1;j<live.length;j++){var p=live[i],q=live[j],dx=q.x-p.x,dy=(q.y-p.y)*1.4,dd=Math.hypot(dx,dy)||1,mn=HS*(p.pct+q.pct)*.3;if(dd<mn){var f=(mn-dd)/dd*.5;p.x-=dx*f;p.y-=dy*f/1.4;q.x+=dx*f;q.y+=dy*f/1.4;}}
 hero.x=Phaser.Math.Clamp(hero.x,HS*.15,G.w-HS*.15);hero.y=Phaser.Math.Clamp(hero.y,HS*.35,G.h-HS*.08);
 mons.concat([hero]).forEach(function(s){s.setDepth(s.y);});
 // hero readability: gold ground ring, rim light, x-ray silhouette when something stands in front
 var sc2=hero.scaleX,pul=.5+.5*Math.sin(t/260);ringG.clear();if(debugState.action!=='death')ringG.lineStyle(3,0xfff0c0,.55+.25*pul).strokeEllipse(hero.x,hero.y-2,HS*.13,HS*.045);
 if(debugState.action!=='death')ringG.lineStyle(1.5,0x6fb0ff,.6).strokeEllipse(hero.x,hero.y-2,HS*.17,HS*.06);if(debugState.action!=='death')ringG.fillStyle(0xfff0c0,.12).fillEllipse(hero.x,hero.y-2,HS*.13,HS*.045);
 [rim,ghost].forEach(function(g){g.setTexture(hero.texture.key,hero.frame.name);g.setPosition(hero.x,hero.y);g.setFlipX(false);g.setOrigin(hero.originX,hero.originY);});
 rim.setScale(sc2*1.045).setDepth(hero.depth-.5).setAlpha(.04);
 var occ=live.some(function(m){return m.y>hero.y&&m.y-hero.y<HS*m.pct*.9&&Math.abs(m.x-hero.x)<HS*(.07+m.pct*.25);});
 ga+=((occ?.42:0)-ga)*Math.min(1,dt*8);ghost.setScale(sc2).setAlpha(0);
 // thin enemy hp bars
 hpG.clear();live.forEach(function(m){if(m.hp>=m.mhp&&m.role=='minion')return;var w=HS*(m.role=='boss'?.16:m.role=='elite'?.09:.05),h=Math.max(3,HS*.006),x=m.x-w/2,y=m.y-HS*m.pct*1.08;
  hpG.fillStyle(0x000000,.75).fillRect(x-1,y-1,w+2,h+2);hpG.fillStyle(m.role=='boss'?0xd8a03a:m.role=='elite'?0x5aa0ff:0xc8352a,1).fillRect(x,y,w*m.hp/m.mhp,h);});
 hero.hp=Math.min(hero.mhp,hero.hp+hero.mhp*.012*dt);hero.rage=Math.min(100,hero.rage+2*dt);UI.setHP(hero.hp,hero.mhp);UI.setMP(hero.rage,100);
 // target banner: boss > elite > current
 var bt=live.find(function(m){return m.role=='boss';})||live.find(function(m){return m.role=='elite'&&Phaser.Math.Distance.Between(hero.x,hero.y,m.x,m.y)<HS*.5;})||(near&&nd<HS*.3?near:null);
 if(bt)UI.target(NAMES[bt.nm]+(bt.role=='boss'?'・首領':bt.role=='elite'?'・精英':''),bt.role,bt.hp/bt.mhp);else UI.target(null);
 if(UI.dollCanvas&&!UI.dollDone){UI.drawDoll(UI.dollCanvas);UI.dollDone=true;}if(!UI.open)UI.dollDone=false;
 mons.forEach(function(m){m.setVisible(debugState.action==='auto');});if(debugState.action!=='auto'){hpG.clear();UI.target(null);}minimap(debugState.action==='auto'?live:[]);perf(dms);}
var mm=document.getElementById('minic').getContext('2d'),mmT=0;
function minimap(live){if((mmT=(mmT+1)%6))return;var w=200,h=140,s=sc.textures.get('ground').getSourceImage(),k=G.w/s.width,vx=hero.x/k-160,vy=hero.y/k-112;
 mm.globalAlpha=1;mm.drawImage(s,vx,vy,320,224,0,0,w,h);mm.fillStyle='rgba(20,14,8,.35)';mm.fillRect(0,0,w,h);
 var sx=w/320/k;live.forEach(function(m){mm.fillStyle=m.role=='boss'?'#ffb040':m.role=='elite'?'#6ab0ff':'#e04030';var x=w/2+(m.x-hero.x)*sx,y=h/2+(m.y-hero.y)*sx;mm.fillRect(x-(m.role=='minion'?1.5:3),y-(m.role=='minion'?1.5:3),m.role=='minion'?3:6,m.role=='minion'?3:6);});
 mm.strokeStyle='rgba(120,200,255,.8)';mm.lineWidth=1.5;mm.beginPath();mm.arc(w/2,h/2,26,0,7);mm.stroke();
 mm.fillStyle='#fff';mm.beginPath();mm.moveTo(w/2,h/2-6);mm.lineTo(w/2+4,h/2+4);mm.lineTo(w/2-4,h/2+4);mm.fill();
 var v=mm.createRadialGradient(w/2,h/2,40,w/2,h/2,120);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,.7)');mm.fillStyle=v;mm.fillRect(0,0,w,h);}
var fr=[],pe=Q.get('perf')?Object.assign(document.createElement('div'),{style:'position:absolute;left:50%;bottom:2px;transform:translateX(-50%);font:10px monospace;color:#9f9;z-index:30'}):null;if(pe)stage.appendChild(pe);
function perf(dms){if(!pe)return;fr.push(dms);if(fr.length>60)fr.shift();var a=fr.reduce(function(x,y){return x+y;},0)/fr.length;pe.textContent=(1000/a).toFixed(0)+' fps · '+mons.length+' mons';window.__fps=1000/a;}
var r=stage.getBoundingClientRect();
new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:'#050505',scale:{mode:Phaser.Scale.RESIZE,width:r.width,height:r.height},resolution:1,render:{antialias:true,pixelArt:false},scene:{preload:preload,create:create,update:update}});
})();
