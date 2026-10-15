// Authored Canvas weapon/effect geometry. Presentation only: never settles damage or mana.
(() => {
 'use strict';
 const clamp=x=>Math.max(0,Math.min(1,x));
 const colors={base:'#d5e8ff',A:'#d7d0ff',B:'#9bdde8',A1:'#c9b7ff',A2:'#91dcad',B1:'#a3e9f1',B2:'#b9a8fa'};
 function profile(name='',path='',{basic=false}={}){
  const route=String(path).slice(0,2),book={破綻標記:'mark',煙幕幻步:'smoke',無聲處刑:'execute',淬毒祕術:'poison',穿心飛刃:'pierce',鏡影反制:'mirror'}[name];
  return {name,thief:true,route,basic,kind:basic?(route[0]==='B'?'pierce':'dagger'):book||(route==='A2'?'poison':route==='B2'?'mirror':route[0]==='B'?'flying':route==='A1'?'execute':'cross'),color:colors[route]||colors.base,power:Math.min(1.25,1+String(path).length*.05)};
 }
 function stroke(g,pts,color,width,alpha=1){g.globalAlpha=alpha;g.strokeStyle=color;g.lineWidth=width;g.lineCap='round';g.lineJoin='round';g.beginPath();pts.forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.stroke();}
 function blade(g,at,angle,size,color,alpha){
  g.save();g.translate(at.x,at.y);g.rotate(angle);g.globalAlpha=alpha;g.fillStyle=color;g.beginPath();g.moveTo(size,0);g.lineTo(-size*.15,-size*.19);g.lineTo(-size*.4,0);g.lineTo(-size*.15,size*.19);g.closePath();g.fill();stroke(g,[{x:-size*.65,y:0},{x:size*.65,y:0}],'#ffffff',1.2,alpha);g.restore();
 }
 function arc(g,at,radius,angle,progress,color,width,alpha){g.globalAlpha=alpha;g.strokeStyle=color;g.lineWidth=width;g.beginPath();g.ellipse(at.x,at.y,radius,radius*.46,angle,-2.1,-2.1+Math.PI*1.25*progress);g.stroke();}
 function draw(g,phase,from,to,p={}){
  if(!Number.isFinite(phase)||![from.x,from.y,to.x,to.y].every(Number.isFinite))return;
  const t=clamp(phase),travel=clamp((t-.18)/.34),hit=clamp((t-.48)/.52),fade=t>.75?(1-t)/.25:1,C=p.color||colors.base,scale=p.basic?.7:(p.power||1),angle=Math.atan2(to.y-from.y,to.x-from.x);
  const pos={x:from.x+(to.x-from.x)*travel,y:from.y+(to.y-from.y)*travel},kind=p.kind||'dagger';
  g.save();g.globalCompositeOperation='lighter';g.shadowColor=C;g.shadowBlur=5;g.globalAlpha=fade;
  if(t<.24){for(let i=0;i<(p.basic?2:4);i++){const q=t/.24;stroke(g,[{x:from.x-10+i*5,y:from.y+8},{x:from.x-6+i*5+q*12,y:from.y-5}],C,1.2,(1-q)*.55);}}
  if(t>=.16&&t<.66){
   if(['flying','pierce'].includes(kind)){
    const count=kind==='pierce'?1:3;for(let i=0;i<count;i++){const q=clamp(travel*1.3-i*.12),bend=(i-1)*14*Math.sin(q*Math.PI),pt={x:from.x+(to.x-from.x)*q,y:from.y+(to.y-from.y)*q+bend};stroke(g,[{x:pt.x-Math.cos(angle)*25,y:pt.y-Math.sin(angle)*25},pt],C,2,fade*.65);blade(g,pt,angle+q*5,kind==='pierce'?14:10,C,fade);}
   }else if(kind==='smoke'){
    for(let i=0;i<4;i++){g.globalAlpha=fade*.16;g.fillStyle=C;g.beginPath();g.ellipse(from.x+(i-1.5)*13,from.y+12-Math.sin(t*4+i)*6,10+travel*9,6+travel*5,0,0,Math.PI*2);g.fill();}
   }else{
    const radius=(kind==='dagger'?22:36)*scale;
    arc(g,to,radius,-.6,travel,C,p.basic?2:3.5,fade);
    if(kind!=='dagger')arc(g,to,radius*.82,.9,travel,'#eef4ff',1.3,fade*.8);
    if(kind==='mirror'){for(let i=0;i<2;i++){const off=(i?1:-1)*13;arc(g,{x:to.x+off,y:to.y-5},radius*.8,.4+i,travel,C,1.5,fade*.4);}}
    if(kind==='execute')stroke(g,[{x:pos.x-14,y:pos.y+8},{x:pos.x+16,y:pos.y-9}],'#f3efff',2,fade);
   }
  }
  if(t>=.48){
   const sparks=p.basic?4:8;for(let i=0;i<sparks;i++){const a=i*Math.PI*2/sparks+.3,r=5+hit*(p.basic?15:24),pt={x:to.x+Math.cos(a)*r,y:to.y+Math.sin(a)*r};stroke(g,[pt,{x:pt.x+Math.cos(a)*4,y:pt.y+Math.sin(a)*4}],i%3?C:'#ffffff',1.2,fade*(1-hit));}
   if(kind==='poison'){for(let i=0;i<3;i++){const a=i*2.1+t*1.5;g.globalAlpha=fade*(1-hit)*.7;g.strokeStyle=C;g.lineWidth=1.5;g.beginPath();g.ellipse(to.x+Math.cos(a)*13,to.y+Math.sin(a)*12-hit*12,4,7,-a,0,Math.PI*2);g.stroke();}}
   if(kind==='mark'||kind==='execute'){const r=12;stroke(g,[{x:to.x-r,y:to.y},{x:to.x,y:to.y-r},{x:to.x+r,y:to.y},{x:to.x,y:to.y+r},{x:to.x-r,y:to.y}],C,1.4,fade*(1-hit));}
   if(kind==='mirror'){for(let i=0;i<4;i++){const x=to.x+(i-1.5)*12,y=to.y-hit*15+(i%2?8:-8);stroke(g,[{x,y:y-5},{x:x+4,y},{x,y:y+7},{x:x-3,y},{x,y:y-5}],C,1.2,fade*(1-hit));}}
  }
  g.restore();
 }
 window.RpgThiefFX={profile,draw,colors};
})();
