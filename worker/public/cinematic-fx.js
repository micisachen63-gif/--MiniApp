// Textured skill rendering: one bounded, frame-cleared Canvas pass; mechanics remain in battle.js.
(() => {
 'use strict';
 const api=window.RpgSkillFX;if(!api)return;const fallback=api.draw,atlas=new Image(),TAU=Math.PI*2;
 let ready=null;api.ready=Promise.resolve(false);
 function loadAtlas(){if(!ready){ready=new Promise(resolve=>{atlas.onload=()=>resolve(true);atlas.onerror=()=>resolve(false)});atlas.src='art/skill-fx-cinematic-20261011/atlas-clean.png?v=2';api.ready=ready;}return ready;}
 const rnd=i=>{const v=Math.sin(i*127.1+311.7)*43758.5453;return v-Math.floor(v)},clamp=v=>Math.max(0,Math.min(1,v));let phase=0;
 function sprite(g,id,x,y,w,h=w,rotation=0,alpha=1,blend='source-over'){
  if(alpha<=0||w<=0||h<=0)return;g.save();g.globalAlpha*=clamp(alpha);g.globalCompositeOperation=blend;g.translate(x,y);g.rotate(rotation);
  const sx=id%4*512,sy=Math.floor(id/4)*512;
  if([0,2,3,8,10,14].includes(id)){
   // Strip deformation adds flame turbulence and wing flex without persistent trail frames.
   const boundary=q=>-h/2+h*q+Math.sin(q*Math.PI)*Math.sin(phase*(id===8?22:31)+q*7)*(id===8?h*.025:h*.012);
   for(let j=0;j<16;j++){const a=boundary(j/16),b=boundary((j+1)/16);g.drawImage(atlas,sx,sy+j*32,512,32,-w/2,a,w,b-a+.3)}
  }else g.drawImage(atlas,sx,sy,512,512,-w/2,-h/2,w,h);g.restore();
 }
 function bloom(g,x,y,r,color,alpha=.3){g.save();g.globalCompositeOperation='screen';g.globalAlpha*=alpha;const a=g.createRadialGradient(x,y,0,x,y,r);a.addColorStop(0,color+'99');a.addColorStop(.35,color+'44');a.addColorStop(1,color+'00');g.fillStyle=a;g.fillRect(x-r,y-r,r*2,r*2);g.restore()}
 function sparks(g,at,k,color,n=42,radius=90){g.save();g.globalCompositeOperation='lighter';for(let i=0;i<n;i++){const a=rnd(i+7)*TAU,s=.3+rnd(i+40),d=radius*s*k,life=clamp((1-k)*(1-rnd(i)*.3));g.globalAlpha=life*.85;const x=at.x+Math.cos(a)*d,y=at.y+Math.sin(a)*d+k*k*20;g.strokeStyle=i%6?'#ffffff':color;g.lineWidth=.5+rnd(i+8)*1.3;g.beginPath();g.moveTo(x,y);g.lineTo(x-Math.cos(a)*(2+6*(1-k)),y-Math.sin(a)*(2+6*(1-k)));g.stroke()}g.restore()}
 function ribbon(g,a,b,color,width,k){g.save();g.globalCompositeOperation='screen';const gr=g.createLinearGradient(a.x,a.y,b.x,b.y);gr.addColorStop(0,color+'00');gr.addColorStop(.65,color+'88');gr.addColorStop(1,'#ffffff');g.strokeStyle=gr;g.lineWidth=width;g.lineCap='round';g.beginPath();g.moveTo(a.x,a.y);g.bezierCurveTo(a.x+(b.x-a.x)*.35,a.y-12*Math.sin(k*8),a.x+(b.x-a.x)*.7,b.y+10,b.x,b.y);g.stroke();g.restore()}
 function bolt(g,a,b,k,alpha=1){const angle=Math.atan2(b.y-a.y,b.x-a.x),len=Math.hypot(b.x-a.x,b.y-a.y);sprite(g,3,(a.x+b.x)/2,(a.y+b.y)/2,len+70,85+Math.sin(k*83)*14,angle,alpha,'screen')}
 function blast(g,at,k,color,fire=false,power=1){const swell=1-Math.pow(1-k,3),fade=Math.pow(1-k,1.5);bloom(g,at.x,at.y,135*power,color,fade*.65);if(fire)sprite(g,1,at.x,at.y,90+swell*185,90+swell*185,k*.12,fade);sprite(g,15,at.x,at.y+12,55+swell*235,28+swell*105,0,fade*.85);sparks(g,at,k,color,48,120*power)}
 function draw(g,k,from,to,p){
  if(p.thief&&window.RpgThiefFX)return window.RpgThiefFX.draw(g,k,from,to,p);
  if(!p.deferCinematic)loadAtlas();
  if(!atlas.complete||!atlas.naturalWidth){fallback(g,k,from,to,p);return}
  if(k<0||k>=1)return;phase=k;const C=p.color,power=p.power||1,t=clamp((k-.22)/.43),hit=clamp((k-.65)/.35),active=k>=.22&&k<.72,tail=1-clamp((k-.67)/.33),pos={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t},angle=Math.atan2(to.y-from.y,to.x-from.x);
  g.save();g.globalAlpha*=k>.94?(1-k)/.06:1;
  // Texture, soft illumination and inward drifting dust replace the old outlined circle.
  if(k<.3){const c=clamp(k/.22),fade=1-clamp((k-.22)/.08);sprite(g,12,from.x,from.y+8,45+c*65,35+c*45,0,fade*.6);bloom(g,from.x,from.y,25+c*55,C,c*fade*.7);for(let i=0;i<22;i++){const a=i*2.39996,r=(1-c)*(30+rnd(i)*38);bloom(g,from.x+Math.cos(a)*r,from.y+Math.sin(a)*r,2+rnd(i+10)*2,C,fade*.65)}}
  if(active){
   switch(p.kind){
    case 'fire':case 'missiles':{
     const n=p.kind==='missiles'?3:1;for(let i=0;i<n;i++){const q={x:pos.x,y:pos.y+Math.sin(t*Math.PI)*(i-1)*42};bloom(g,q.x,q.y,55,C,.3);ribbon(g,{x:q.x-110,y:q.y},q,C,5,k);sprite(g,p.kind==='fire'?0:2,q.x,q.y,p.kind==='fire'?160:120,p.kind==='fire'?95:64,angle+Math.sin(k*17+i)*.035,tail);sparks(g,q,.25+(k*3%1)*.3,C,12,28)}break;
    }
    case 'meteor':{const q={x:to.x-150*(1-t),y:to.y-240*(1-t)};bloom(g,q.x,q.y,80,C,.4);sprite(g,14,q.x,q.y,195,195,-.08,tail);sparks(g,q,t,C,25,55);break}
    case 'summon':{sprite(g,12,from.x,from.y+60,160,80,0,tail*.9);sprite(g,10,pos.x,pos.y-15,140+Math.sin(k*13)*8,160,Math.sin(k*15)*.035,tail);sprite(g,0,pos.x+36,pos.y+4,80,55,angle,.7*tail);bloom(g,pos.x,pos.y,85,C,.35);break}
    case 'lightning':{const flicker=.6+rnd(Math.floor(k*80))*.4;bolt(g,from,to,k,flicker);for(let i=0;i<3;i++){const a={x:to.x-20,y:to.y},b={x:to.x+35+i*22,y:to.y-60+i*58};bolt(g,a,b,k+i,.75)}sprite(g,5,to.x,to.y,100,100,k*3,.25);bloom(g,to.x,to.y,90,C,.35);break}
    case 'slash':case 'whirlwind':case 'rage':case 'flash':{
     const n=p.kind==='whirlwind'?3:p.kind==='rage'?2:1;for(let i=0;i<n;i++){const rot=p.kind==='whirlwind'?k*9+i*2.1:p.kind==='rage'?(i?1.7:-.8):p.kind==='flash'?-1.2:-.55;const a=Math.sin(t*Math.PI)*tail;sprite(g,p.kind==='flash'?5:4,to.x-12,to.y+10+i*9,(150+i*15)*power,(190-i*15)*power,rot,a);if(p.kind==='rage'){bloom(g,to.x,to.y,100,C,.45);sprite(g,1,to.x,to.y,130,130,k,.3*a)}}if(p.kind==='flash'){ribbon(g,from,{x:to.x+60,y:to.y-10},C,9,k);sprite(g,6,to.x,to.y,160,34,-.1,.7)}sparks(g,to,t,C,28,65);break;
    }
    case 'shield':case 'guard':{const at=p.kind==='guard'?from:to;sprite(g,7,at.x,at.y,150,185,Math.sin(k*8)*.08,tail);bloom(g,at.x,at.y,120,C,.25);if(p.kind==='guard'){sprite(g,12,from.x,from.y+70,190,75,0,tail*.8);for(let i=0;i<3;i++)sprite(g,7,from.x+(i-1)*46,from.y+12,100,140,(i-1)*.15,tail*.22)}break}
    case 'holy':sprite(g,13,to.x,to.y-50,210,300,0,tail);sprite(g,12,to.x,to.y+65,210,70,0,.75*tail);bloom(g,to.x,to.y-30,150,C,.3);break;
    case 'double':case 'volley':case 'snipe':case 'rain':{
     const n=p.kind==='rain'?14:p.kind==='volley'?6:p.kind==='double'?2:1;for(let i=0;i<n;i++){const q=clamp(t*1.6-i*(p.kind==='rain'?.045:.08));if(q===0)continue;const a=p.kind==='rain'?{x:to.x-95+i*15,y:to.y-205}:{x:from.x,y:from.y+(i%3-1)*10},b={x:to.x+(p.kind==='rain'?(i-6)*10:0),y:to.y+(i%3-1)*8},pt={x:a.x+(b.x-a.x)*q,y:a.y+(b.y-a.y)*q},rot=Math.atan2(b.y-a.y,b.x-a.x);sprite(g,6,pt.x,pt.y,p.kind==='snipe'?210:115,p.kind==='snipe'?62:40,rot,tail);if(p.kind==='snipe')ribbon(g,from,{x:to.x+65,y:to.y},C,8,k)}break;
    }
    case 'falcon':case 'beasts':{const q={x:pos.x,y:pos.y-30-Math.sin(t*Math.PI)*60};sprite(g,8,q.x,q.y,170,155,Math.sin(k*14)*.1,tail);ribbon(g,{x:q.x-100,y:q.y+8},q,C,6,k);sprite(g,6,pos.x,pos.y+10,95,32,angle,.9*tail);if(p.kind==='beasts')for(let i=0;i<2;i++)sprite(g,9,pos.x-45-i*65,pos.y+55+i*16,175,105,0,tail*(i?.65:1));break}
    case 'blizzard':{sprite(g,15,to.x,to.y+25,230,90,k*2,.3*tail);for(let i=0;i<20;i++){const q=(t+i/20)%1,x=to.x-85+rnd(i)*170-q*18,y=to.y-155+q*190;sprite(g,11,x,y,26+rnd(i+2)*27,38+rnd(i+4)*40,-.3,.75*tail)}sprite(g,11,to.x,to.y+40,175,165,0,clamp(t*2)*tail*.65);bloom(g,to.x,to.y,120,C,.25);break}
    case 'time':{sprite(g,12,to.x,to.y,210,190,k*-1.4,tail);sprite(g,2,to.x,to.y,180,100,k*2,.28*tail);sprite(g,15,to.x,to.y,150,150,-k,.4*tail);g.save();g.globalCompositeOperation='screen';g.strokeStyle='#eadcff';g.lineWidth=2;for(const r of [k*-12,k*-4]){g.beginPath();g.moveTo(to.x,to.y);g.lineTo(to.x+Math.cos(r)*45,to.y+Math.sin(r)*45);g.stroke()}g.restore();break}
    case 'trap':sprite(g,12,to.x,to.y+60,210,70,0,tail);for(let i=0;i<4;i++)sprite(g,14,to.x+(i-1.5)*25,to.y+42,48,50,1.8,.6*tail);bloom(g,to.x,to.y+45,80,C,t*.25);break;
   }
  }
  if(k>=.65){const fiery=['fire','meteor','summon','rage','trap'].includes(p.kind);blast(g,to,hit,C,fiery,power);if(p.kind==='blizzard')sprite(g,11,to.x,to.y+25,180+hit*40,180,0,Math.pow(1-hit,2));if(p.kind==='lightning')sprite(g,3,to.x,to.y,180,130,hit*3,Math.pow(1-hit,2),'screen');if(p.kind==='missiles'||p.kind==='time')sprite(g,2,to.x,to.y,130+hit*100,130+hit*100,hit*4,(1-hit)*.55);}
  g.restore();
 }
 const monsters={claw:['slash','#ffc595'],bite:['rage','#ff796a'],roots:['roots','#9bdd69'],poison:['poison','#a4ec59'],darkbolt:['missiles','#b78aff'],bomb:['fire','#ffb054'],firespit:['fire','#ff793c'],fireball:['fire','#ff793c'],rock:['rock','#dac39d'],stonewave:['rock','#f1d293'],wisdom:['lightning','#b9e7ff'],soul:['missiles','#91e8ff'],frost:['frost','#b8f1ff'],icerock:['frost','#b8f1ff']};
 Object.assign(monsters,{water:['frost','#64e0ec'],fire:['fire','#ff9957'],sun:['lightning','#ffdc75'],lightning:['lightning','#b69dff']});
 api.monsterProfile=(kind,big=false)=>{const p=monsters[kind]||monsters.claw;return {name:kind,kind:p[0],color:p[1],power:big?1.3:1}};
 api.drawMonster=(g,k,from,to,p)=>{
  if(k<0||k>=1)return;
   loadAtlas();
  // Render in a local right-facing space, then mirror the whole effect, including trails.
  g.save();g.translate(from.x,from.y);g.scale(-1,1);
  const a={x:0,y:0},b={x:Math.max(1,from.x-to.x),y:to.y-from.y};
  if(!['roots','poison','rock','frost'].includes(p.kind)){draw(g,k,a,b,p);g.restore();return}
  if(!atlas.complete||!atlas.naturalWidth){fallback(g,k,a,b,{...p,kind:'fire'});g.restore();return}
  phase=k;const t=clamp((k-.22)/.43),hit=clamp((k-.65)/.35),fade=1-clamp((k-.65)/.35),C=p.color;
  if(k<.3){bloom(g,0,0,28+k*150,C,(1-k/.3)*.6);sprite(g,12,0,35,85,40,0,(1-k/.3)*.65)}
  if(k>=.22&&k<.72){const q={x:b.x*t,y:b.y*t};ribbon(g,{x:Math.max(0,q.x-110),y:q.y},q,C,6,k);
   if(p.kind==='rock'){sprite(g,14,q.x,q.y,105,105,k*5,fade);sprite(g,15,q.x-30,q.y+18,140,65,0,fade*.65)}
   else if(p.kind==='frost'){for(let i=0;i<7;i++)sprite(g,11,q.x-i*15,q.y+Math.sin(i*2+k*15)*16,35+i*3,54,-Math.PI/2,fade*(1-i*.09),'screen');bloom(g,q.x,q.y,70,C,fade*.3)}
   else if(p.kind==='roots'){for(let i=0;i<9;i++){const x=b.x*t-i*15;if(x<0)continue;sprite(g,11,x,b.y+35,23,65+Math.sin(i+k*19)*18,-.3,fade*.75)}bloom(g,q.x,q.y+20,65,C,fade*.35)}
   else {for(let i=0;i<5;i++){const x=q.x-i*18,y=q.y+Math.sin(k*19+i)*12;bloom(g,x,y,26-i*2,C,fade*.55);sprite(g,15,x,y+8,60,45,k*2,fade*.4)}sparks(g,q,.3,C,16,35)}
  }
  if(k>=.65){blast(g,b,hit,C,false,p.power);if(p.kind==='frost'||p.kind==='roots')sprite(g,11,b.x,b.y+25,145,150,0,(1-hit)*.85);if(p.kind==='poison')bloom(g,b.x,b.y,125,C,(1-hit)*.45)}
  g.restore();
 };
 api.draw=draw;api.textureAtlas=atlas;api.quality='textured-cinematic';
})();
