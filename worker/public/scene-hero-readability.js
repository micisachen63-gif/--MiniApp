/* Preserve dense crowds. Only pixels hiding the actual current hero pose are
 * cut out of a shared foreground layer. Counts, AI, damage and rewards stay intact. */
(() => {
 'use strict';
 function mount(scene,{hero,monsters,ready,hpGraphics}){
  document.documentElement.classList.add('hero-readable');
  const foreground=scene.add.layer(),shape=scene.make.image({key:hero.texture.key,frame:hero.frame.name,add:false});
  const outline=scene.add.image(hero.x,hero.y,hero.texture.key,hero.frame.name).setTintFill(0xffdf9d).setAlpha(0);
  const webgl=!!scene.game.renderer.gl&&typeof foreground.setMask==='function';
  const mask=webgl?shape.createBitmapMask():null;if(mask){mask.invertAlpha=true;foreground.setMask(mask);hpGraphics?.setMask(mask);}
  const fallback=webgl?null:scene.add.image(hero.x,hero.y,hero.texture.key,hero.frame.name).setDepth(9100).setAlpha(0);
  const live=window.__RpgScenePreviewConfig?.live===true,placeholder={key:hero.texture.key,frame:hero.frame.name};
  let affected=0,total=0,frontCount=0,dead=false,enabled=true,suspended=false;
  const overlap=(a,b)=>a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y;
  const validFrame=sprite=>!!sprite?.frame?.data?.sourceSize;
  // Actor textures are transient. Detach every mask/outline before the animator
  // removes them; hidden Phaser images still retain their destroyed Frame.
  function reset(){
   if(dead)return;suspended=true;affected=0;frontCount=0;total=0;
   foreground.clearMask();hpGraphics?.clearMask();
   for(const image of [shape,outline,fallback])if(image)image.setTexture(placeholder.key,placeholder.frame).setAlpha(0);
   if(!webgl)for(const m of monsters().filter(m=>m.active)){m.setAlpha(1);if(m.modeAura?.active)m.modeAura.setAlpha(.45);}
  }
  function update(){
   if(dead)return;const all=monsters().filter(m=>m.active),active=ready()&&hero.visible;
   if(live&&(!active||!validFrame(hero))){if(!suspended)reset();total=all.filter(m=>m.hp>0).length;return;}
   if(suspended){suspended=false;if(mask&&enabled){foreground.setMask(mask);hpGraphics?.setMask(mask);}}
   shape.setTexture(hero.texture.key,hero.frame.name).setOrigin(hero.originX,hero.originY).setPosition(hero.x,hero.y).setScale(hero.scaleX*1.10,hero.scaleY*1.10).setFlip(hero.flipX,hero.flipY).setAlpha(active?1:0);
   outline.setTexture(hero.texture.key,hero.frame.name).setOrigin(hero.originX,hero.originY).setPosition(hero.x,hero.y).setScale(hero.scaleX*1.045,hero.scaleY*1.045).setFlip(hero.flipX,hero.flipY).setDepth(hero.depth-.02);
   foreground.setDepth(hero.depth+.01);const bounds=hero.getBounds();affected=0;frontCount=0;total=all.filter(m=>m.hp>0).length;
   for(const m of all){const front=m.y>hero.y,cover=active&&front&&m.hp>0&&overlap(m.getBounds(),bounds);if(front)frontCount++;if(cover)affected++;
    const destination=front?foreground:scene.sys.displayList;
    if(m.displayList!==destination)m.addToDisplayList(destination);
    if(m.modeAura?.active&&m.modeAura.displayList!==destination)m.modeAura.addToDisplayList(destination);
    if(!webgl&&m.hp>0){m.setAlpha(enabled&&cover?.10:1);if(m.modeAura?.active)m.modeAura.setAlpha(enabled&&cover?.08:.45);}
   }
   outline.setAlpha(active&&enabled?(affected?.46:.12):0);
   if(fallback)fallback.setTexture(hero.texture.key,hero.frame.name).setOrigin(hero.originX,hero.originY).setPosition(hero.x,hero.y).setScale(hero.scaleX,hero.scaleY).setFlip(hero.flipX,hero.flipY).setAlpha(active&&enabled&&affected?1:0);
  }
  function inspect(){return {enabled,suspended,strategy:webgl?'shared-inverse-hero-silhouette':'canvas-occluder-alpha',totalLiving:total,frontCount,affected,foregroundChildren:foreground.length,heroTexture:hero.texture?.key||null,heroFrame:hero.frame?.name??null,maskTexture:shape.texture?.key||null,maskFrame:shape.frame?.name??null,maskOrigin:{x:shape.originX,y:shape.originY},heroOrigin:{x:hero.originX,y:hero.originY},maskAlpha:shape.alpha,outlineAlpha:outline.alpha};}
  function setEnabled(value){enabled=!!value;if(mask){if(enabled&&!suspended){foreground.setMask(mask);hpGraphics?.setMask(mask);}else{foreground.clearMask();hpGraphics?.clearMask();}}}
  scene.events.once('shutdown',()=>{dead=true;hpGraphics?.clearMask();foreground.clearMask();mask?.destroy();shape.destroy();outline.destroy();fallback?.destroy();});
  return {update,inspect,setEnabled,reset};
 }
 window.RpgHeroReadability={mount};
})();
