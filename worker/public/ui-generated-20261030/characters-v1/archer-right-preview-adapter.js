/* Private evaluation adapter. Not installed into the shared scene. No game-speed or catalog changes. */
(function(root){
 'use strict';
 const SPEC={"adv1_archer_A_f":{"sha256":"438c14205a61cde1400eabd3e2b6dcd84d126a37bf0d76eb8b6705426e448fed","body":995},"adv2_archer_B2_m":{"sha256":"cface2c7065c661466203f921923bd1eb02d16e2d29835b46b8155a522dff5ea","body":1140},"adv2_archer_A2_f":{"sha256":"1f173193717807d3079a96e170dd9957e6473cc126df263c4c0758c571513fd4","body":1080},"adv2_archer_A2_m":{"sha256":"4fff66d169e9979d30ccf5af1b6db9b43770b70588290d63f6b0cedab8508972","body":995},"adv3_archer_A12_f":{"sha256":"238e4d1e5df99592af9110037f30ec00c2fc709937944183a84d1dbdf25f5cff","body":1180.970732},"adv3_archer_B12_m":{"sha256":"6128a5ad5961da5d08f2a70e9fcf9c37fb9b9e92b91d8b54233ddde9643834e2","body":1100.885272},"adv3_archer_A21_f":{"sha256":"b18d072d4294b6c2f439eec718463f8159042b4e83a02060b2021c539472f147","body":945.063519},"adv3_archer_B22_f":{"sha256":"74f9eaf7ce9f1711ffd23f646ca71df02700c4080b22ae27c052fdf9e8a066c1","body":1127},"adv2_archer_B2_f":{"sha256":"d0d8629952e5594f6edd278d64a4ac1e27468dbe6178f8dd54b8123b7d20c88f","body":1230},"adv3_archer_A21_m":{"sha256":"143528b5637b9784a128afc5469e92432831ece3b45bc136c26cf972580443f0","body":1107.850625},"adv3_archer_B21_m":{"sha256":"46da87427bd40efe5af232cfae6cb420afefb12425e9bf0af2df8e903a152cac","body":1081},"adv2_archer_B1_m":{"sha256":"6f01eb20f7db99e881c4e61ce991116e056a858f06b5129a219033111d6a5e8f","body":1225}};
 class Adapter{
  constructor(visual,{enabled=false,evaluationOnly=true}={}){
   this.visual=visual;this.enabled=enabled===true&&evaluationOnly===true;this.binding=0;this.image=null;this.controller=null;this.dynamic=null;this.lastPose=null;this.lastStep=null;
  }
  eligible(direction){const v=this.visual;return this.enabled&&v.ready&&root.ArcherRightPreviewLocomotion?.eligible(v.actor,direction)&&!!SPEC[v.actor.id];}
  async bind(direction='right'){
   if(!this.eligible(direction))throw Error('Archer RIGHT private adapter is not eligible');
   const v=this.visual,token=++this.binding,generation=v.generation,actor=v.actor,frame=actor.clips.walk.right.frames[0],spec=SPEC[actor.id];
   if(actor.id==='adv2_archer_B1_m'){
    this.b1BindingAttempt=Object.freeze({actorId:actor.id,actor,generation,token,idle:actor.clips.idle.right,walk:actor.clips.walk.right});
    this.b1BindingPending=true;this.b1Invalidated=false;
   }else if(this.b1BindingAttempt){this.b1BindingAttempt=null;this.b1BindingPending=false;this.b1Invalidated=false;}
   this.releaseOwnedResources();
   try{
   const response=await fetch(frame.url);if(!response.ok)throw Error('Reviewed RIGHT source unavailable');
   const bytes=await response.arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
   if(digest!==spec.sha256)throw Error('Reviewed RIGHT source SHA changed');
   const image=await createImageBitmap(new Blob([bytes]));
   if(token!==this.binding||generation!==v.generation||actor!==v.actor){image.close();return false;}
   if(actor.id==='adv2_archer_B1_m'){
    const b=this.b1BindingAttempt;
    if(!b||b.token!==token||b.actor!==actor||b.generation!==generation||b.idle!==actor.clips?.idle?.right||b.walk!==actor.clips?.walk?.right||!root.ArcherRightPreviewLocomotion.eligible(actor,'right')){image.close();this.b1Invalidated=true;return false;}
    let controller;
    try{controller=new root.ArcherRightPreviewLocomotion.Controller(actor,root.LayeredWalkRenderer,'right');}
    catch(error){image.close();this.b1Invalidated=true;throw error;}
    this.image=image;this.actorId=actor.id;this.generation=generation;this.controller=controller;this.sourceSha256=digest;this.b1Invalidated=false;
    return true;
   }
   this.image=image;this.actorId=actor.id;this.generation=generation;this.controller=new root.ArcherRightPreviewLocomotion.Controller(actor,root.LayeredWalkRenderer,'right');this.sourceSha256=digest;
   return true;
   }finally{if(this.b1BindingAttempt?.token===token)this.b1BindingPending=false;}
  }
  isBound(){
   if(this.b1BindingAttempt){
    if(this.b1BindingPending)return false;
    const b=this.b1BindingAttempt;
    const valid=!!(!this.b1Invalidated&&this.enabled&&this.image&&this.visual.ready&&this.binding===b.token&&this.generation===b.generation&&this.generation===this.visual.generation&&this.actorId===b.actorId&&this.visual.actor===b.actor&&this.actorId===this.visual.actor?.id&&this.sourceSha256===SPEC['adv2_archer_B1_m'].sha256&&this.controller?.b1SourceBinding&&this.controller.b1SourceCurrent(this.visual.actor));
    if(!valid&&!this.b1Invalidated){this.binding++;this.releaseOwnedResources();this.b1Invalidated=true;}
    return valid;
   }
   return !!(this.enabled&&this.image&&this.controller&&this.visual.ready&&this.generation===this.visual.generation&&this.actorId===this.visual.actor?.id);}
  step(ms,{moving=false,bounds=null}={}){
   if(!this.isBound())throw Error('Bind the exact source before private preview motion');
   const v=this.visual,sprite=v.sprite,unit=v.scene.scale.height*.20,profile=this.controller.profile;
   if(this.b1BindingAttempt){
    // Reserve this tick's maximum advance plus the complete stop budget.
    const threshold=(profile.stopBudgetBodyUnits+profile.boundsMaxNativePerCycle*ms/profile.cycleMs/profile.bodyHeight)*unit+2;
    if(bounds&&bounds.right-sprite.x<=threshold)moving=false;
   }else{
   if(bounds&&bounds.right-sprite.x<=profile.stopBudgetBodyUnits*unit+2)moving=false;
   }
   const before={x:sprite.x,y:sprite.y},result=this.controller.step(ms,{moving,direction:'right'});
   sprite.x+=result.deltaBody[0]*unit;sprite.y+=result.deltaBody[1]*unit;
   // Preserve catalog clips. This evaluation pose is rendered after normal visual.update().
   this.lastStep={...result,worldBefore:before,worldAfter:{x:sprite.x,y:sprite.y},unit};
   return this.lastStep;
  }
  draw(){
   if(!this.isBound())return false;
   const v=this.visual,scene=v.scene,p=this.controller.profile;
   if(v.action!=='walk'||v.activeDirection!=='right')return false;
   if(!this.dynamic){
    const canvas=document.createElement('canvas');canvas.width=480;canvas.height=512;canvas.getContext('2d');
    const key=v.texturePrefix+'-archer-right-private-'+v.generation;
    const texture=scene.textures.addCanvas(key,canvas);texture.add(0,0,0,0,480,512);this.dynamic={key,canvas,texture};
   }
   const c=this.dynamic.canvas,ctx=c.getContext('2d');ctx.clearRect(0,0,480,512);ctx.save();
   ctx.translate(240,470);ctx.scale(300/p.bodyHeight,300/p.bodyHeight);ctx.translate(0,-p.layer.ground);
   this.lastPose=root.LayeredWalkRenderer.drawPose(ctx,{...p.layer,image:this.image,phase:this.controller.phase,motionScale:this.controller.amount()});
   ctx.restore();this.dynamic.texture.refresh();
   v.sprite.anims.stop();v.sprite.setTexture(this.dynamic.key,0).setOrigin(.5,470/512).setScale(scene.scale.height*.20/300).setFlipX(false);
   return true;
  }
  worldFeet(){
   if(!this.lastPose||!this.isBound()||this.visual.sprite.texture.key!==this.dynamic?.key)return null;
   const p=this.controller.profile,s=this.visual.sprite,unit=this.visual.scene.scale.height*.20;
   return Object.fromEntries(this.lastPose.legs.map(leg=>{
    const n=p.nativeContacts[leg.side],point=[leg.foot.x+n[0],leg.foot.y+n[1]];
    return [leg.side,{nativePoint:point,world:[s.x+point[0]/p.bodyHeight*unit,s.y+(point[1]-p.layer.ground)/p.bodyHeight*unit],lift:leg.lift,contact:leg.lift<1e-7}];
   }));
  }
  releaseOwnedResources(){
   if(this.dynamic){this.visual.scene.textures.remove(this.dynamic.key);this.dynamic=null;}
   if(this.image){this.image.close();this.image=null;}
   this.controller=null;this.lastPose=null;this.lastStep=null;this.visual.lastFrame='';
  }
  dispose(){this.binding++;this.releaseOwnedResources();}
 }
 root.ArcherRightPreviewAdapter=Adapter;
})(globalThis);
