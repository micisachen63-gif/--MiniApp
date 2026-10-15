// Three class-specific material atlases; every frame is deterministic and independently drawable.
(() => {
 'use strict';
 const api=window.RpgSkillFX;if(!api)return;
 const previous=api.draw,oldProfile=api.profile,images={};
 api.ready=Promise.resolve(false);
 function loadClass(cls){if(!['sword','archer','mage'].includes(cls))cls='mage';if(!images[cls]){const image=images[cls]=new Image();image.fxClass=cls;image.failed=false;api.ready=new Promise(resolve=>{image.onload=()=>resolve(true);image.onerror=()=>{image.failed=true;resolve(false)};});image.src=`art/hero-lavish-fx-20261012/${cls}.png?v=1`;}return images[cls];}
 api.profile=(name,cls='sword',path='')=>{const branch={sword:{A:'旋風斬',B:'盾擊',A1:'血之狂怒',A2:'一閃',B1:'神聖制裁',B2:'不動如山'},archer:{A:'箭雨',B:'獵鷹助攻',A1:'穿透狙擊',A2:'疾風連射',B1:'野獸之王',B2:'爆裂陷阱'},mage:{A:'連鎖閃電',B:'奧術飛彈',A1:'隕石術',A2:'暴風雪',B1:'時間扭曲',B2:'召喚火精靈'}};const resolved=name&&!api.profiles[name]?(branch[cls]?.[path.slice(0,2)]||branch[cls]?.[path[0]]||name):name;return {...oldProfile(resolved,cls,path),name,cls,path};};
 const clamp=v=>Math.max(0,Math.min(1,v)),smooth=v=>{v=clamp(v);return v*v*(3-2*v)},rnd=i=>{const n=Math.sin(i*127.1+47.7)*43758.5453;return n-Math.floor(n)},TAU=Math.PI*2;
 function material(g,image,id,x,y,w,h=w,rot=0,alpha=1,blend='source-over'){
  if(alpha<=0||w<=0||h<=0)return;
  // Thin projectiles need substantially more thickness than shields and summons.
  const cls=image.fxClass,projectile=cls==='archer'?[0,1,2].includes(id):cls==='mage'?[0,1,2,8].includes(id):id===2;
  const body=cls==='sword'?[0,1,3,4,9].includes(id):cls==='archer'?[3,12,13,14].includes(id):[4,5,6,7,9,15].includes(id);
  w*=projectile?(cls==='mage'&&id===2?1:1.3):body?1.3:1.1;
  h*=projectile?2.15:body?1.35:1;
  // Keep enlarged, rotated texture bounds inside the actual battle canvas, including DPR scaling.
  const matrix=g.getTransform();if(matrix.a>0&&matrix.d>0&&Math.abs(matrix.b)<.001&&Math.abs(matrix.c)<.001){
   const margin=g.canvas.width*.015,c=Math.abs(Math.cos(rot)),s=Math.abs(Math.sin(rot));
   let hx=(w*c+h*s)*matrix.a/2,hy=(w*s+h*c)*matrix.d/2;
   const fit=Math.min(1,(g.canvas.width-2*margin)/(2*hx),(g.canvas.height-2*margin)/(2*hy));w*=fit;h*=fit;hx*=fit;hy*=fit;
   const px=x*matrix.a+matrix.e,py=y*matrix.d+matrix.f;
   x+=(Math.max(margin+hx,Math.min(g.canvas.width-margin-hx,px))-px)/matrix.a;
   y+=(Math.max(margin+hy,Math.min(g.canvas.height-margin-hy,py))-py)/matrix.d;
  }
  g.save();g.globalAlpha*=clamp(alpha);g.globalCompositeOperation=blend;g.translate(x,y);g.rotate(rot);
  g.drawImage(image,id%4*512,Math.floor(id/4)*512,512,512,-w/2,-h/2,w,h);
  if(projectile||body){g.globalCompositeOperation='screen';g.globalAlpha*=.2;g.drawImage(image,id%4*512,Math.floor(id/4)*512,512,512,-w/2,-h/2,w,h);}
  g.restore();
 }
 function light(g,x,y,r,color,alpha){if(alpha<=0)return;g.save();g.globalAlpha*=alpha;g.globalCompositeOperation='screen';const grad=g.createRadialGradient(x,y,0,x,y,r);grad.addColorStop(0,color+'77');grad.addColorStop(.4,color+'33');grad.addColorStop(1,color+'00');g.fillStyle=grad;g.fillRect(x-r,y-r,r*2,r*2);g.restore();}
 function motes(g,at,t,color,count=28,extent=100,seed=0){g.save();g.globalCompositeOperation='screen';g.lineCap='round';for(let i=0;i<count;i++){const a=rnd(i+seed)*TAU,d=(.15+rnd(i+seed+90))*extent*smooth(t),alpha=Math.pow(1-clamp(t),1.2);g.globalAlpha*=1;g.globalAlpha=alpha*.8;g.strokeStyle=i%5?color:'#ffffff';g.lineWidth=.6+rnd(i+seed+30)*1.8;const x=at.x+Math.cos(a)*d,y=at.y+Math.sin(a)*d+t*t*22;g.beginPath();g.moveTo(x,y);g.lineTo(x-Math.cos(a)*(3+8*(1-t)),y-Math.sin(a)*(3+8*(1-t)));g.stroke();}g.restore();}
 function strands(g,a,b,t,color,n=3){g.save();g.globalCompositeOperation='screen';g.lineCap='round';for(let i=0;i<n;i++){const offset=(i-(n-1)/2)*15*Math.sin(t*Math.PI);const grad=g.createLinearGradient(a.x,a.y,b.x,b.y);grad.addColorStop(0,color+'00');grad.addColorStop(.65,color+'99');grad.addColorStop(1,'#ffffffee');g.strokeStyle=grad;g.lineWidth=i===1?8:3;g.beginPath();g.moveTo(a.x,a.y);g.bezierCurveTo(a.x+(b.x-a.x)*.4,a.y+offset,b.x-35,b.y-offset,b.x,b.y);g.stroke();}g.restore();}
 api.draw=(g,k,from,to,p)=>{
  if(k<0||k>=1)return;
  const cls=p.cls||(['slash','whirlwind','rage','flash','shield','guard','holy'].includes(p.kind)?'sword':['double','rain','volley','snipe','falcon','beasts','trap'].includes(p.kind)?'archer':'mage'),image=loadClass(cls);
  if(!image.complete||!image.naturalWidth){previous(g,k,from,to,{...p,deferCinematic:!image.failed});return;}
  const kind=p.kind,C=p.color,basic=p.basic,scale=Math.max(1.25,p.power||1)*(basic?.85:1),charge=smooth(k/.22),travel=clamp((k-.22)/.43),impact=clamp((k-.65)/.35),fade=1-smooth((k-.76)/.24),at={x:from.x+(to.x-from.x)*travel,y:from.y+(to.y-from.y)*travel},angle=Math.atan2(to.y-from.y,to.x-from.x),s=(id,x,y,w,h=w,r=0,a=1,blend='source-over')=>material(g,image,id,x,y,w*scale,h*scale,r,a,blend);
  g.save();g.globalAlpha*=basic?.9:1;
  if(k<.32){const a=(1-smooth((k-.22)/.1));const id=cls==='sword'?(kind==='guard'||kind==='shield'?8:7):cls==='archer'?15:kind==='blizzard'?13:['fire','meteor','summon'].includes(kind)?14:12;s(id,from.x,from.y+52,70+charge*105,30+charge*48,0,a*.8);light(g,from.x,from.y,25+charge*48,C,a*charge*.5);for(let i=0;i<10;i++){const q=1-charge,r=20+q*35,a0=i*2.3999+k*2;light(g,from.x+Math.cos(a0)*r,from.y+Math.sin(a0)*r,2+rnd(i)*3,C,a*.7);}}
  if(k>=.22&&k<.73){
   switch(kind){
    case 'slash':case 'rage':case 'flash':case 'whirlwind':{
     const n=kind==='whirlwind'?4:kind==='rage'?3:kind==='flash'?2:2;
     for(let i=0;i<n;i++){const q=clamp(travel*1.12-i*.08),a=Math.sin(q*Math.PI)*fade;if(a<=0)continue;const id=kind==='rage'?1:kind==='flash'?2:0,rot=kind==='whirlwind'?k*9+i*1.55:kind==='rage'?(i%2?1.5:-.5):-.5+i*.35;s(id,to.x-8,to.y+i*4,210+i*12,230-i*12,rot,a);}
     if(kind==='whirlwind')s(4,to.x,to.y+25,210,190,k*3,.65*fade);if(kind==='rage')s(9,to.x,to.y,205,230,k*.1,.65*fade);if(kind==='flash'){strands(g,from,{x:to.x+55,y:to.y-12},travel,C,5);s(2,to.x,to.y,260,65,-.08,fade);}break;
    }
    case 'shield':case 'guard':{const a=kind==='guard'?from:to;s(5,a.x,a.y,170,220,Math.sin(k*8)*.06,fade);s(13,a.x,a.y,220,220,-k*.5,.65*fade);s(8,a.x,a.y+75,235,75,0,.8*fade);if(kind==='shield')strands(g,from,to,travel,C,3);break;}
    case 'holy':s(6,to.x,to.y-55,245,330,0,fade);s(7,to.x,to.y+65,250,92,0,.9*fade);s(12,to.x,to.y+45,160+travel*100,65,0,.6*fade);break;
    case 'double':case 'snipe':case 'volley':case 'rain':{
     const n=kind==='rain'?18:kind==='volley'?8:kind==='double'?2:1;
     for(let i=0;i<n;i++){const q=clamp(travel*1.25-i*(kind==='rain'?.035:.07));if(q<=0)continue;const a=kind==='rain'?{x:to.x-140+i*16,y:to.y-250-rnd(i)*35}:{x:from.x,y:from.y+(i%3-1)*10},b={x:to.x+(kind==='rain'?(i-8)*9:0),y:to.y+(i%3-1)*9},pt={x:a.x+(b.x-a.x)*q,y:a.y+(b.y-a.y)*q};s(kind==='snipe'?1:0,pt.x,pt.y,kind==='snipe'?285:185,kind==='snipe'?85:65,Math.atan2(b.y-a.y,b.x-a.x),fade);if(i<3)strands(g,a,pt,q,C,2);}
     if(kind==='snipe')s(2,at.x-55,at.y,260,95,angle,.6*fade);break;
    }
    case 'falcon':case 'beasts':{const bird={x:at.x,y:at.y-35-Math.sin(travel*Math.PI)*50};s(4,bird.x,bird.y,220,190,Math.sin(k*19)*.055,fade);s(8,bird.x-50,bird.y,145,110,k,.65*fade);s(0,at.x,at.y+12,160,42,angle,fade);if(kind==='beasts'){s(5,at.x-55,at.y+55,230,150,Math.sin(k*25)*.02,fade);s(6,at.x-125,at.y+67,205,145,Math.sin(k*25+2)*.02,.85*fade);s(15,from.x,from.y+75,225,82,0,.6*fade);if(p.path?.startsWith('B12')){s(7,from.x+90,from.y-20,165,215,Math.sin(k*7)*.025,.7*fade);s(9,at.x,at.y,200,175,k,.55*fade);}}break;}
    case 'trap':s(10,to.x,to.y+65,230,85,0,fade);s(11,to.x,to.y+30,200,155,0,smooth(travel)*fade);s(9,to.x,to.y+10,190,150,k,.6*fade);break;
    case 'fire':case 'missiles':{const n=kind==='missiles'?3:1;for(let i=0;i<n;i++){const q={x:at.x,y:at.y+(kind==='missiles'?Math.sin(travel*Math.PI)*(i-1)*45:0)};s(kind==='fire'?0:1,q.x,q.y,kind==='fire'?220:180,kind==='fire'?125:75,angle+Math.sin(k*25+i)*.025,fade);strands(g,{x:Math.max(from.x,q.x-150),y:q.y},q,travel,C,3);light(g,q.x,q.y,75,C,.25*fade);}break;}
    case 'meteor':{const q={x:to.x-170*(1-travel),y:to.y-260*(1-travel)};s(3,q.x,q.y,270,270,0,fade);light(g,q.x,q.y,110,C,.3*fade);break;}
    case 'lightning':{const length=Math.hypot(to.x-from.x,to.y-from.y);s(2,(from.x+to.x)/2,(from.y+to.y)/2,length+90,125+Math.sin(k*75)*18,angle,fade*(.7+rnd(Math.floor(k*75))*.3),'screen');for(let i=0;i<3;i++)s(2,to.x+35,to.y+(i-1)*30,125,70,(i-1)*.8,fade*.75,'screen');s(6,to.x,to.y,145,145,k,.65*fade);break;}
    case 'blizzard':{s(9,to.x,to.y-20,240,260,k*.15,.75*fade);for(let i=0;i<14;i++){const q=(travel*1.3+i/14)%1;s(8,to.x-105+rnd(i)*210,to.y-180+q*220,40+rnd(i+9)*30,70+rnd(i+2)*30,.12,.8*fade);}s(7,to.x,to.y+55,210,175,0,smooth(travel)*fade);break;}
    case 'time':s(11,to.x,to.y,245,245,-k*1.5,.95*fade);s(15,to.x,to.y,210,210,k*2,.65*fade);for(let i=0;i<3;i++)s(1,to.x+Math.cos(k*12+i*TAU/3)*80,to.y+Math.sin(k*12+i*TAU/3)*60,100,45,k*12+i*TAU/3+.5,.6*fade);break;
    case 'summon':s(14,from.x,from.y+65,210,78,0,.8*fade);s(10,at.x,at.y-25,190,250,Math.sin(k*16)*.035,fade);s(0,at.x+55,at.y,145,85,angle,.8*fade);break;
    default:previous(g,k,from,to,p);
   }
  }
  if(k>=.65){const growth=smooth(impact),a=Math.pow(1-impact,1.45);let id=cls==='sword'?(kind==='flash'||kind==='shield'||kind==='guard'?11:10):cls==='archer'?(kind==='trap'?12:kind==='falcon'||kind==='beasts'?13:3):kind==='lightning'?6:kind==='blizzard'?7:kind==='time'||kind==='missiles'?5:4;
   s(id,to.x,to.y+5,110+growth*190,120+growth*190,kind==='lightning'?impact*.7:0,a);const ring=cls==='sword'?12:cls==='archer'?14:kind==='blizzard'?13:kind==='fire'||kind==='meteor'||kind==='summon'?14:12;s(ring,to.x,to.y+50,100+growth*230,35+growth*80,0,a*.65);light(g,to.x,to.y,65+growth*90,C,a*.45);motes(g,to,impact,C,basic?22:46,135*scale,kind.length*4);
   if(cls==='archer'&&['falcon','beasts'].includes(kind))s(8,to.x,to.y,210,185,impact*.8,a*.65);if(kind==='trap')s(11,to.x,to.y+35,210,160,0,a*.6);
  }
  g.restore();
 };
 api.heroAtlases=images;api.quality='lavish-bold-v2';
})();

