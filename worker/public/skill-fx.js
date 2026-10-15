// Deterministic Canvas skill art. Presentation only; no damage or resource changes.
(() => {
 'use strict';
 const profiles={
  '強力斬':['slash','#ffd16f'],'旋風斬':['whirlwind','#ff5749'],'盾擊':['shield','#8acfff'],
  '血之狂怒':['rage','#ff344f'],'一閃':['flash','#e6f5ff'],'神聖制裁':['holy','#ffe6a0'],'不動如山':['guard','#99d6ff'],
  '二連射':['double','#68edcd'],'箭雨':['rain','#85ffdf'],'獵鷹助攻':['falcon','#ffdc89'],
  '穿透狙擊':['snipe','#adffe9'],'疾風連射':['volley','#6fe5d9'],'野獸之王':['beasts','#e6ce91'],'爆裂陷阱':['trap','#ffba66'],
  '火球術':['fire','#ff8f44'],'連鎖閃電':['lightning','#a8ddff'],'奧術飛彈':['missiles','#c997ff'],
  '隕石術':['meteor','#ff8a4a'],'暴風雪':['blizzard','#abeaff'],'時間扭曲':['time','#b5a4ff'],'召喚火精靈':['summon','#ffae59']
 };
 const mageFourthAliases={"日冕焚界":"隕石術","熾天裁決":"隕石術","星核崩滅":"隕石術","隕日終審":"隕石術","永霜王域":"暴風雪","零界封絕":"暴風雪","極光聖降":"暴風雪","蒼穹冰葬":"暴風雪","時序崩解":"時間扭曲","命運斷章":"時間扭曲","虛空湮滅":"時間扭曲","次元裂隙":"時間扭曲","萬靈降臨":"召喚火精靈","星界御令":"召喚火精靈","深淵魔召":"召喚火精靈","冥界開門":"召喚火精靈"};
 function profile(name,cls='sword',path=''){const p=profiles[mageFourthAliases[name]||name]||profiles[cls==='mage'?'火球術':cls==='archer'?'二連射':'強力斬'];return {name,kind:p[0],color:p[1],power:Math.min(1.4,1+path.length*.1)}}
 const TAU=Math.PI*2;
 function line(g,pts,color,width=2){g.strokeStyle=color;g.lineWidth=width;g.lineCap='round';g.beginPath();pts.forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.stroke()}
 function ring(g,p,r,color,alpha=1){g.globalAlpha=alpha;g.strokeStyle=color;g.lineWidth=2;g.beginPath();g.arc(p.x,p.y,r,0,TAU);g.stroke()}
 function glow(g,p,r,color){const d=g.createRadialGradient(p.x,p.y,0,p.x,p.y,r);d.addColorStop(0,'#ffffff');d.addColorStop(.2,color+'dd');d.addColorStop(1,color+'00');g.fillStyle=d;g.beginPath();g.arc(p.x,p.y,r,0,TAU);g.fill()}
 function rune(g,p,r,color,t){g.save();g.translate(p.x,p.y);g.rotate(t);ring(g,{x:0,y:0},r,color,.65);ring(g,{x:0,y:0},r*.78,color,.8);for(let i=0;i<8;i++){const a=i*TAU/8;line(g,[{x:Math.cos(a)*r*.78,y:Math.sin(a)*r*.78},{x:Math.cos(a)*r,y:Math.sin(a)*r}],color,2)}g.beginPath();for(let i=0;i<7;i++){const a=i*TAU/6,x=Math.cos(a)*r*.65,y=Math.sin(a)*r*.65;i?g.lineTo(x,y):g.moveTo(x,y)}g.stroke();g.restore()}
 function arrow(g,a,b,t,color){const p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};g.save();g.translate(p.x,p.y);g.rotate(Math.atan2(b.y-a.y,b.x-a.x));line(g,[{x:-56,y:0},{x:12,y:0}],color,5);line(g,[{x:-32,y:0},{x:12,y:0}],'#fff',1.5);line(g,[{x:5,y:-5},{x:14,y:0},{x:5,y:5}],color,2);g.restore()}
 function bird(g,p,color,t){g.save();g.translate(p.x,p.y);g.scale(1.7,1.7);g.strokeStyle=color;g.fillStyle=color+'77';g.lineWidth=1.5;const wing=25+Math.sin(t*24)*9;g.beginPath();g.moveTo(18,0);g.lineTo(10,-4);g.quadraticCurveTo(-2,-15,-24,-wing);for(let i=0;i<5;i++){g.lineTo(-24+i*4,-wing+6+i*2);g.lineTo(-19+i*4,-wing+13+i*2)}g.lineTo(-9,-4);g.lineTo(-23,0);g.lineTo(-9,4);for(let i=4;i>=0;i--){g.lineTo(-19+i*4,wing-13-i*2);g.lineTo(-24+i*4,wing-6-i*2)}g.lineTo(-24,wing);g.quadraticCurveTo(-2,15,10,4);g.closePath();g.fill();g.stroke();glow(g,{x:6,y:0},5,color);g.restore()}
 function draw(g,k,from,to,p){
  const C=p.color,pow=p.power||1,charge=Math.min(1,k/.22),travel=Math.max(0,Math.min(1,(k-.22)/.43)),impact=Math.max(0,(k-.65)/.35),alpha=k>.82?(1-k)/.18:1;
  g.save();g.globalCompositeOperation='lighter';g.globalAlpha=alpha;g.shadowColor=C;g.shadowBlur=9;
  if(k<.28){rune(g,from,12+charge*19,C,k*2);glow(g,from,12+charge*15,C)}
  if(k>=.22&&k<.72){
   const pos={x:from.x+(to.x-from.x)*travel,y:from.y+(to.y-from.y)*travel};
   // Fine energy motes enrich the moving effect without covering faces or retaining old frames.
   for(let i=0;i<18;i++){const q=(travel+i/18)%1,a=i*2.39996+k*3,point={x:pos.x-Math.cos(a)*q*45,y:pos.y+Math.sin(a)*q*30};g.globalAlpha=alpha*(1-q)*.65;line(g,[point,{x:point.x-4,y:point.y+2}],i%4?C:'#ffffff',1)}g.globalAlpha=alpha;
   if(['slash','rage','flash','whirlwind'].includes(p.kind)){const radius=(p.kind==='rage'?70:58)*pow;g.lineWidth=p.kind==='flash'?3:8;g.strokeStyle=C;g.beginPath();g.arc(to.x,to.y,radius,-2.6,-2.6+travel*4.5);g.stroke();if(p.kind==='whirlwind'){for(let i=0;i<3;i++){g.beginPath();g.ellipse(to.x,to.y+i*12,radius*(1-i*.15),radius*.36,k*5+i,0,TAU*.78);g.stroke()}}if(p.kind==='rage'){g.lineWidth=2;g.beginPath();g.arc(to.x,to.y,radius*.76,.4,.4-travel*4.5,true);g.stroke()}if(p.kind==='flash')line(g,[from,{x:to.x+45,y:to.y-22}],C,6)}
   else if(['shield','guard','holy'].includes(p.kind)){rune(g,to,28+travel*30,C,-k);if(p.kind==='holy'){for(let i=0;i<5;i++)line(g,[{x:to.x+(i-2)*22,y:to.y-140},{x:to.x+(i-2)*22,y:to.y+30}],C,3)}else{g.beginPath();g.moveTo(to.x-30,to.y-30);g.lineTo(to.x+30,to.y-30);g.lineTo(to.x+24,to.y+20);g.lineTo(to.x,to.y+42);g.lineTo(to.x-24,to.y+20);g.closePath();g.stroke();}}
   else if(p.kind==='lightning'){const pts=[];for(let i=0;i<=22;i++){const q=i/22;pts.push({x:from.x+(to.x-from.x)*q,y:from.y+(to.y-from.y)*q+(i===0||i===22?0:(i%2?1:-1)*(12+(i*13+Math.floor(k*21)*7)%23))})}line(g,pts,C,4);line(g,pts,'#fff',1);for(let i=0;i<5;i++){const origin=pts[4+i*4];line(g,[origin,{x:origin.x+14,y:origin.y-30+i*7},{x:origin.x+28,y:origin.y+18-i*11},{x:origin.x+45,y:origin.y-46+i*13}],C,1.3)}for(let i=0;i<3;i++)line(g,[to,{x:to.x+25+i*18,y:to.y-50+i*40},{x:to.x+55+i*12,y:to.y-60+i*50}],C,2)}
   else if(['rain','volley','double','snipe'].includes(p.kind)){const n=p.kind==='rain'?11:p.kind==='volley'?6:p.kind==='double'?2:1;for(let i=0;i<n;i++){const t=Math.max(0,Math.min(1,travel*1.4-i*.07)),a=p.kind==='rain'?{x:to.x-60+i*12,y:to.y-170}:{x:from.x,y:from.y+(i%3-1)*8},b={x:to.x+(p.kind==='rain'?(i-5)*9:0),y:to.y+(i%3-1)*6};if(t>0)arrow(g,a,b,t,C)}if(p.kind==='snipe')line(g,[from,{x:to.x+65,y:to.y}],C,3)}
   else if(['falcon','beasts'].includes(p.kind)){const b={x:pos.x,y:pos.y-Math.sin(travel*Math.PI)*65};bird(g,b,C,k);arrow(g,from,to,travel,C);if(p.kind==='beasts'){for(let j=0;j<2;j++){g.save();g.translate(pos.x-j*26,pos.y+40);g.strokeStyle=C;g.beginPath();g.moveTo(-25,12);g.lineTo(-12,-8);g.lineTo(0,-12);g.lineTo(8,-24);g.lineTo(15,-8);g.lineTo(29,0);g.lineTo(15,5);g.lineTo(4,12);g.lineTo(-2,23);g.lineTo(-7,10);g.closePath();g.stroke();g.restore()}}}
   else if(p.kind==='trap'){rune(g,{x:to.x,y:to.y+38},28+travel*25,C,k);for(let i=0;i<6;i++)line(g,[{x:to.x+Math.cos(i*TAU/6)*40,y:to.y+38+Math.sin(i*TAU/6)*16},to],C,1)}
   else if(p.kind==='blizzard'){for(let i=0;i<28;i++){const x=to.x-65+(i*37%130),y=to.y-130+((travel*170+i*21)%170);line(g,[{x,y},{x:x-12,y:y+20}],C,2)}rune(g,to,40,C,-k)}
   else if(p.kind==='time'){rune(g,to,38+Math.sin(k*10)*5,C,-k*3);for(let i=0;i<12;i++){const a=i*TAU/12;line(g,[{x:to.x+Math.cos(a)*32,y:to.y+Math.sin(a)*32},{x:to.x+Math.cos(a)*37,y:to.y+Math.sin(a)*37}],C,2)}line(g,[to,{x:to.x+Math.cos(k*14)*26,y:to.y+Math.sin(k*14)*26}],'#fff',2)}
   else{const n=p.kind==='missiles'?3:1;for(let i=0;i<n;i++){const q={x:pos.x,y:pos.y+Math.sin(travel*Math.PI)*(i-1)*28};if(p.kind==='meteor'){q.x=to.x-85*(1-travel);q.y=to.y-160*(1-travel)}glow(g,q,p.kind==='meteor'?30:p.kind==='fire'||p.kind==='summon'?22:14,C);line(g,[{x:q.x-35,y:q.y-(p.kind==='meteor'?55:0)},q],C,5);if(p.kind==='summon'){rune(g,from,28,C,k);g.beginPath();g.moveTo(q.x,q.y-32);g.quadraticCurveTo(q.x-35,q.y+15,q.x,q.y+24);g.quadraticCurveTo(q.x+35,q.y+15,q.x,q.y-32);g.strokeStyle=C;g.stroke();glow(g,{x:q.x-5,y:q.y-3},3,'#ffffff');glow(g,{x:q.x+5,y:q.y-3},3,'#ffffff')}}}
  }
  if(k>=.65){const r=(10+impact*65)*pow;ring(g,to,r,C,(1-impact)*alpha);ring(g,to,r*.67,'#fff',(1-impact)*.6);glow(g,to,Math.max(1,38*(1-impact)),C);for(let i=0;i<18;i++){const a=i*2.39996,d=12+impact*(24+(i%5)*9),point={x:to.x+Math.cos(a)*d,y:to.y+Math.sin(a)*d};line(g,[point,{x:point.x+Math.cos(a)*6,y:point.y+Math.sin(a)*6}],i%3?C:'#fff',1.5)}}
  g.restore();
 }
 window.RpgSkillFX={profile,draw,profiles};
})();

