// Painted elf second-tier skills. All time and damage remain owned by combat playback.
(() => {
  'use strict';
  const api=window.RpgSkillFX;if(!api)return;
  const base='art/elf-adv2-skills-20261013/',images=new Map(),jobs=new Map(),TAU=Math.PI*2;
  const branches={A1:{kind:'snipe',arrow:'snipe',color:'#81f0d5'},A2:{kind:'volley',arrow:'volley',color:'#a6ddff'},B1:{kind:'beasts',arrow:'snipe',color:'#addb8f'},B2:{kind:'trap',arrow:'volley',color:'#c6adff'}};
  const stats={draws:0,snipe:0,volley:0,beasts:0,trap:0,basic:0};
  const clamp=x=>Math.min(1,Math.max(0,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
  function load(key){if(jobs.has(key))return jobs.get(key);const image=new Image();images.set(key,image);let promise;promise=new Promise(resolve=>{image.onload=()=>resolve(images.get(key)===image);image.onerror=()=>{if(images.get(key)===image)images.delete(key);if(jobs.get(key)===promise)jobs.delete(key);resolve(false);};});jobs.set(key,promise);image.src=base+key+'.webp?v=20261013-elf2-skills1';return promise;}
  // prepare is reached through the final renderer chain after all index scripts load.
  // A later generic atlas wrapper must not silently shadow these exact-tier assets.
  let priorityDraw=null;
  function installPriority(){
    if(api.draw===priorityDraw)return;
    const next=api.draw;
    priorityDraw=(g,k,from,to,p)=>{
      // Preserve the separately authored wolf/falcon/beast dispatcher for its named pet actions.
      if(p?.elf4Attack?.pet)return next(g,k,from,to,p);
      if(!draw(g,k,from,to,p))return next(g,k,from,to,p);
    };
    api.draw=priorityDraw;
  }
  function prepare(cls,path){if(cls!=='archer'||!branches[path])return Promise.resolve(false);installPriority();const b=branches[path];return Promise.all([...new Set([b.arrow,b.kind,'charge_'+path])].map(load)).then(a=>a.every(Boolean));}
  function ready(key){const im=images.get(key);return im&&im.complete&&im.naturalWidth?im:null;}
  function image(g,key,x,y,width,{alpha=1,rotation=0,squeeze=1}={}){const im=ready(key);if(!im||alpha<=0)return;g.save();g.globalAlpha*=clamp(alpha);g.translate(x,y);g.scale(1,squeeze);g.rotate(rotation);const height=width*im.naturalHeight/im.naturalWidth;g.drawImage(im,-width/2,-height/2,width,height);g.restore();}
  function glow(g,x,y,r,color,alpha){if(alpha<=0)return;g.save();g.globalCompositeOperation='lighter';g.globalAlpha*=clamp(alpha);const d=g.createRadialGradient(x,y,0,x,y,r);d.addColorStop(0,'#fff');d.addColorStop(.18,color);d.addColorStop(1,color+'00');g.fillStyle=d;g.fillRect(x-r,y-r,r*2,r*2);g.restore();}
  function sparks(g,to,q,color,count=24){if(q<0||q>=1)return;g.save();g.globalCompositeOperation='lighter';g.lineCap='round';for(let i=0;i<count;i++){const a=i*2.399963,d=18+q*(35+i%6*12),x=to.x+Math.cos(a)*d,y=to.y+Math.sin(a)*d*.75;g.globalAlpha=(1-q)*(1-q)*(.55+i%3*.15);g.strokeStyle=i%4?color:'#fff4c8';g.lineWidth=1.2+i%3*.65;g.beginPath();g.moveTo(x,y);g.lineTo(x+Math.cos(a)*(5+q*10),y+Math.sin(a)*(5+q*10));g.stroke();}g.restore();}
  function rings(g,to,q,color){if(q<0||q>=1)return;g.save();g.globalCompositeOperation='lighter';g.globalAlpha=(1-q)*.75;g.strokeStyle=color;g.lineWidth=2.1;for(let i=0;i<2;i++){g.beginPath();g.ellipse(to.x,to.y,15+q*82+i*9,9+q*42+i*5,-.2,0,TAU);g.stroke();}g.restore();}
  function fly(g,key,from,to,q,width,bend=0,overshoot=0){q=clamp(q);const dx=to.x-from.x,dy=to.y-from.y,angle=Math.atan2(dy,dx),x=from.x+dx*q-Math.cos(angle)*width*.44+overshoot,y=from.y+dy*q-Math.sin(angle)*width*.44-Math.sin(q*Math.PI)*bend;image(g,key,x,y,width,{rotation:angle,alpha:Math.min(1,q*8)});}
  function draw(g,k,from,to,p){const b=branches[p.path];if(p.cls!=='archer'||!b)return false;if(k>=1)return true;
    const main=p.basic?b.arrow:b.kind;if(!ready(main)||!ready('charge_'+p.path))return false;
    stats.draws++;stats[p.basic?'basic':b.kind]++;const impact=clamp((k-.65)/.35),fade=k>.83?(1-k)/.17:1,travel=clamp((k-.15)/.5),C=b.color;
    g.save();g.globalCompositeOperation='source-over';g.globalAlpha=fade;
    if(k<.27){const charge=smooth(k/.22);image(g,'charge_'+p.path,from.x,from.y,36+charge*(p.basic?26:64),{rotation:k*2.2,alpha:(1-k/.27)*.85});glow(g,from.x,from.y,12+charge*12,C,.45);}
    if(p.basic){if(k>=.12&&k<.67)fly(g,b.arrow,from,to,clamp((k-.12)/.53),135,4);if(k>=.65){glow(g,to.x,to.y,22*(1-impact)+1,C,(1-impact)*.7);sparks(g,to,impact,C,12);}}
    else if(b.kind==='snipe'){
      if(k>=.12&&k<.76){const q=clamp((k-.12)/.53),dx=to.x-from.x,dy=to.y-from.y;fly(g,'snipe',from,to,q,250,0,Math.max(0,(k-.65)/.11)*130);g.save();g.globalCompositeOperation='lighter';g.globalAlpha=.25*(1-impact);g.strokeStyle=C;g.lineWidth=2.4;g.beginPath();g.moveTo(from.x,from.y);g.lineTo(from.x+dx*q+90*impact,from.y+dy*q);g.stroke();g.restore();}
      if(k>=.65){rings(g,to,impact,C);sparks(g,to,impact,C,32);glow(g,to.x,to.y,45*(1-impact)+1,C,(1-impact)*.8);}
    }else if(b.kind==='volley'){
      for(let i=0;i<6;i++){const start=.12+i*.045,end=.47+i*.036;if(k>=start&&k<end){const q=(k-start)/(end-start),spread=(i%3-1)*18;fly(g,'volley',{x:from.x,y:from.y+spread*.35},{x:to.x,y:to.y+spread},q,140,20+(i%2)*14);}}
      if(k>=.47){const q=clamp((k-.47)/.53);for(let i=0;i<3;i++)sparks(g,{x:to.x,y:to.y+(i-1)*17},q,C,10);}if(k>=.65)rings(g,to,impact,C);
    }else if(b.kind==='beasts'){
      if(k>=.12&&k<.76){const q=clamp((k-.12)/.53),size=150+smooth(q)*70,x=from.x+(to.x-from.x)*q,y=from.y+(to.y-from.y)*q-22-Math.sin(q*Math.PI)*40;image(g,'beasts',x,y,size,{alpha:Math.min(1,(k-.12)*9)*(k>.65?1-(k-.65)/.11:1),rotation:Math.sin(q*Math.PI)*-.08});image(g,'charge_B1',x,y+25,70+q*50,{alpha:.28,rotation:k*3});}
      if(k>=.65){sparks(g,to,impact,C,30);rings(g,to,impact,C);glow(g,to.x,to.y,46*(1-impact)+1,C,(1-impact)*.8);}
    }else if(b.kind==='trap'){
      const ground={x:to.x,y:to.y+72};if(k>=.15&&k<.51)fly(g,'volley',from,ground,clamp((k-.15)/.36),112,-12);
      if(k>=.26&&k<.76){const q=smooth((k-.26)/.35);image(g,'charge_B2',ground.x,ground.y,70+q*120,{alpha:.85*(k>.65?1-impact:1),rotation:k*2.6,squeeze:.43});}
      if(k>=.59){const q=clamp((k-.59)/.41),size=90+smooth(q/.45)*170;image(g,'trap',ground.x,ground.y-size*.33,size,{alpha:q<.12?q/.12:1-smooth((q-.5)/.5)});sparks(g,{x:ground.x,y:ground.y-34},clamp((k-.65)/.35),'#ffc273',36);rings(g,ground,impact,C);}
    }
    g.restore();return true;
  }
  const originalProfile=api.profile,originalDraw=api.draw;
  api.profile=(name,cls='sword',path='')=>({...originalProfile(name,cls,path),cls,path});
  api.prepare=prepare;
  api.draw=(g,k,from,to,p)=>{if(!draw(g,k,from,to,p))originalDraw(g,k,from,to,p)};
  window.RpgElfSkillFX={prepare,draw,stats,branches,installPriority,ready:path=>{const b=branches[path];return!!b&&!!ready(b.arrow)&&!!ready(b.kind)&&!!ready('charge_'+path)}};
})();
