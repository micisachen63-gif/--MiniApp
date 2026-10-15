// Compact painted bow magic for six low-tier elf identities. Visuals only.
(()=>{
 'use strict';const api=window.RpgSkillFX;if(!api)return;
 const images=new Map(),jobs=new Map(),palettes={base:'A11',A:'A21',B:'B11'},stats={draws:0,base:0,A:0,B:0,poseFramesSeen:[]};let installed=null,renderDepth=0;
 const eligible=p=>p?.cls==='archer'&&['','A','B'].includes(p.path||'');
 function load(path=''){const theme=palettes[path||'base'];if(jobs.has(theme))return jobs.get(theme);const im=new Image();images.set(theme,im);const ready=new Promise(resolve=>{im.onload=()=>resolve(true);im.onerror=()=>resolve(false);});im.src='/art/elf3-phase-fx-20261014/fx_'+theme+'.webp';jobs.set(theme,ready);return ready;}
 function draw(g,k,from,p){if(!eligible(p)||k<0||k>=1)return false;const path=p.path||'base',im=images.get(palettes[path]);if(!im?.complete||!im.naturalWidth)return false;
  const poseFrame=Number.isInteger(p.poseFrame)?Math.max(0,Math.min(7,p.poseFrame)):Math.min(7,Math.floor(k*8)),pulse=[.35,.6,.85,1,.7,.45,.25,.2][poseFrame],width=(p.basic?42:59)*(1+pulse*.15),alpha=(p.basic?.48:.72)*pulse;
  // Use exactly the authored charge cell. No tint, blur, rerendering or fabricated cell count.
  const cw=im.naturalWidth/4,ch=im.naturalHeight;
  g.save();g.globalAlpha*=alpha;g.globalCompositeOperation='source-over';g.drawImage(im,0,0,cw,ch,from.x-width*.5,from.y-width*.5,width,width*ch/cw);g.restore();
  stats.draws++;stats[path]++;if(!stats.poseFramesSeen.includes(poseFrame))stats.poseFramesSeen.push(poseFrame);return true;
 }
 function install(){if(api.draw===installed)return;const next=api.draw;installed=(g,k,from,to,p)=>{renderDepth++;try{next(g,k,from,to,p);}finally{renderDepth--;}if(renderDepth===0)draw(g,k,from,p);};api.draw=installed;}
 const previousPrepare=api.prepare;api.prepare=(cls,path='')=>{const prior=previousPrepare?previousPrepare(cls,path):Promise.resolve(false);if(cls!=='archer'||!['','A','B'].includes(path))return prior;if(!installed)install();return Promise.all([prior,load(path)]).then(a=>!!a[1]);};
 window.RpgElfLowTierWeaponFX={prepare:(path='')=>load(path),draw,install,stats,eligible};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
