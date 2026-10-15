// Native painted fourth-advancement sword effects; presentation only.
(()=>{
  'use strict';const api=window.RpgSkillFX;if(!api)return;
  const base='art/sword-adv4-magic-20261013/fx/',images=new Map(),jobs=new Map(),stats={draws:0};
  const codes=new Set(['A111','A112','A121','A122','A211','A212','A221','A222','B111','B112','B121','B122','B211','B212','B221','B222']);
  const previousPrepare=api.prepare,previousProfile=api.profile,previousDraw=api.draw;
  function load(code){if(jobs.has(code))return jobs.get(code);const im=new Image();images.set(code,im);const job=new Promise(resolve=>{im.onload=()=>resolve(true);im.onerror=()=>resolve(false)});jobs.set(code,job);im.src=base+'fx_sword_adv4_'+code+'.webp?v=20261013-sword4-magic1';return job;}
  function prepare(cls,path){if(cls==='sword'&&codes.has(path))return load(path);return previousPrepare?previousPrepare(cls,path):Promise.resolve(false);}
  function draw(g,k,from,to,p){
    if(p.cls!=='sword'||!codes.has(p.path))return false;
    if(k>=1)return true;
    const im=images.get(p.path);if(!im?.complete||!im.naturalWidth)return false;
    const cw=im.naturalWidth/4,ch=im.naturalHeight/2,index=Math.min(7,Math.floor(Math.max(0,k)*8));
    const width=p.basic?150:235,height=width*ch/cw;
    const x=to.x-width*.5,y=to.y-height*.5;
    // The caller clears the whole FX canvas each frame. Draw exactly one native cell.
    g.save();g.globalCompositeOperation='source-over';g.drawImage(im,index%4*cw,Math.floor(index/4)*ch,cw,ch,x,y,width,height);g.restore();stats.draws++;return true;
  }
  api.prepare=prepare;
  api.profile=(name,cls='sword',path='')=>({...previousProfile(name,cls,path),cls,path});
  api.draw=(g,k,from,to,p)=>{if(!draw(g,k,from,to,p))previousDraw(g,k,from,to,p)};
  window.RpgSwordAdv4FX={prepare,draw,stats,codes,ready:code=>!!images.get(code)?.naturalWidth};
})();
