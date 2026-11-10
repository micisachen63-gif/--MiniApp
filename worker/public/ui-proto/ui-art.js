/* Procedural Greek-myth UI art: marble, meander (Greek key), laurel, gold corners, starfield, divine-light orbs, bronze medallions. */
(function(){
'use strict';
function cv(w,h){var c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function rnd(s){return function(){s=(s*16807)%2147483647;return s/2147483647;};}
function noise(w,h,amt,seed){var c=cv(w,h),x=c.getContext('2d'),d=x.createImageData(w,h),r=rnd(seed||7);
 for(var i=0;i<d.data.length;i+=4){var v=128+(r()-.5)*amt;d.data[i]=d.data[i+1]=d.data[i+2]=v;d.data[i+3]=255;}x.putImageData(d,0,0);return c;}
/* veined marble (tiles seamlessly enough at low alpha) */
function marble(){var S=256,c=noise(S,S,26,9),x=c.getContext('2d'),r=rnd(21);x.globalCompositeOperation='multiply';x.fillStyle='#d8d2c4';x.fillRect(0,0,S,S);x.globalCompositeOperation='source-over';
 for(var k=0;k<14;k++){var px=r()*S,py=r()*S,w=r()*1.6+.3;x.strokeStyle='rgba(70,80,105,'+(.12+r()*.25)+')';x.lineWidth=w;x.beginPath();x.moveTo(px,py);
  for(var j=0;j<9;j++){px+=(r()-.3)*40;py+=(r()-.5)*40;x.lineTo(px,py);}x.stroke();}
 x.strokeStyle='rgba(201,164,92,.25)';x.lineWidth=.8;x.beginPath();x.moveTo(0,r()*S);x.bezierCurveTo(80,r()*S,170,r()*S,S,r()*S);x.stroke();return c;}
/* Greek key strip, one repeat = 2u wide, u tall */
function meander(u,col){var c=cv(u*2,u),x=c.getContext('2d'),k=u/10;x.strokeStyle=col||'#d9b56a';x.lineWidth=Math.max(1.2,k*1.3);x.lineCap='square';
 x.beginPath();x.moveTo(0,9*k);x.lineTo(20*k,9*k);x.moveTo(0,1*k);x.lineTo(20*k,1*k);
 x.moveTo(2*k,9*k);x.lineTo(2*k,3*k);x.lineTo(10*k,3*k);x.lineTo(10*k,7*k);x.lineTo(6*k,7*k);x.lineTo(6*k,5*k);
 x.moveTo(12*k,1*k);x.lineTo(12*k,7*k);x.lineTo(18*k,7*k);x.lineTo(18*k,3*k);x.lineTo(15*k,3*k);x.lineTo(15*k,5*k);x.stroke();return c;}
function goldGrad(x,y0,y1){var g=x.createLinearGradient(0,y0,0,y1);g.addColorStop(0,'#fff4cf');g.addColorStop(.35,'#e2bd6b');g.addColorStop(.7,'#9a7232');g.addColorStop(1,'#5a3e16');return g;}
/* laurel branch, drawn along an arc */
function laurelArc(x,cx,cy,R,a0,a1,dir,leaf){var n=Math.round(Math.abs(a1-a0)/.2);x.save();
 x.strokeStyle='#8a6a2c';x.lineWidth=leaf*.18;x.beginPath();x.arc(cx,cy,R,Math.min(a0,a1),Math.max(a0,a1));x.stroke();
 for(var i=0;i<=n;i++){var a=a0+(a1-a0)*i/n,px=cx+Math.cos(a)*R,py=cy+Math.sin(a)*R,sz=leaf*(1-i/n*.45);
  [-1,1].forEach(function(sd){x.save();x.translate(px,py);x.rotate(a+(dir>0?Math.PI/2:-Math.PI/2)+sd*.55);
   var g=x.createLinearGradient(0,0,sz*1.6,0);g.addColorStop(0,'#f6dc92');g.addColorStop(1,'#8d6526');x.fillStyle=g;
   x.beginPath();x.moveTo(0,0);x.quadraticCurveTo(sz*.8,-sz*.45,sz*1.7,0);x.quadraticCurveTo(sz*.8,sz*.45,0,0);x.fill();
   x.strokeStyle='rgba(60,40,10,.6)';x.lineWidth=.6;x.beginPath();x.moveTo(sz*.2,0);x.lineTo(sz*1.4,0);x.stroke();x.restore();});}
 x.restore();}
/* panel corner: gold step-meander bracket + palmette */
function corner(){var c=cv(72,72),x=c.getContext('2d'),g=goldGrad(x,0,72);x.shadowColor='rgba(0,0,0,.85)';x.shadowBlur=3;x.strokeStyle=g;x.fillStyle=g;x.lineCap='square';
 x.lineWidth=4;x.beginPath();x.moveTo(5,66);x.lineTo(5,5);x.lineTo(66,5);x.stroke();
 x.lineWidth=2;x.beginPath();x.moveTo(12,52);x.lineTo(12,12);x.lineTo(52,12);x.moveTo(12,30);x.lineTo(22,30);x.lineTo(22,22);x.lineTo(30,22);x.lineTo(30,12);x.stroke();
 x.save();x.translate(9,9);for(var i=0;i<5;i++){x.save();x.rotate(-Math.PI/4+(i-2)*.32);x.beginPath();x.ellipse(0,-9,2.4,7,0,0,7);x.fill();x.restore();}x.restore();
 x.fillStyle='#1d3f86';x.beginPath();x.arc(9,9,3.2,0,7);x.fill();x.fillStyle='rgba(220,235,255,.9)';x.beginPath();x.arc(8.2,8.2,1.1,0,7);x.fill();return c;}
/* starfield for the sky veil */
function stars(w,h){var c=cv(w,h),x=c.getContext('2d'),r=rnd(77);for(var i=0;i<260;i++){var px=r()*w,py=Math.pow(r(),1.6)*h,s=r()<.06?1.8:r()*.9+.3;
 x.fillStyle='rgba('+(r()<.3?'255,236,190':'220,232,255')+','+(.35+r()*.6)+')';x.beginPath();x.arc(px,py,s,0,7);x.fill();
 if(s>1.5){x.strokeStyle='rgba(255,240,200,.5)';x.lineWidth=.6;x.beginPath();x.moveTo(px-6,py);x.lineTo(px+6,py);x.moveTo(px,py-6);x.lineTo(px,py+6);x.stroke();}}return c;}
var R=document.documentElement.style;
R.setProperty('--noise','url('+noise(128,128,90,5).toDataURL()+')');
R.setProperty('--marble','url('+marble().toDataURL()+')');
R.setProperty('--meander','url('+meander(10).toDataURL()+')');
R.setProperty('--meanderS','url('+meander(7,'#c9a45c').toDataURL()+')');
R.setProperty('--corner','url('+corner().toDataURL()+')');
R.setProperty('--stars','url('+stars(520,260).toDataURL()+')');

/* divine-light orb: glass sphere of liquid light in a gold ring with meander band and laurel */
function Orb(canvas,col){this.c=canvas;this.x=canvas.getContext('2d');this.col=col;this.v=1;this.t=Math.random()*9;
 var s=canvas.width,f=cv(s,s),fx=f.getContext('2d'),cx=s/2,R=s*.36;
 laurelArc(fx,cx,cx,R*1.24,Math.PI*.92,Math.PI*.30,1,s*.045);laurelArc(fx,cx,cx,R*1.24,Math.PI*.08,Math.PI*.70,-1,s*.045);
 fx.fillStyle=goldGrad(fx,cx-R*1.15,cx+R*1.15);fx.beginPath();fx.arc(cx,cx,R*1.14,0,Math.PI*2);fx.arc(cx,cx,R*.995,0,Math.PI*2,true);fx.fill('evenodd');
 fx.fillStyle='#0e1a3a';fx.beginPath();fx.arc(cx,cx,R*1.10,0,Math.PI*2);fx.arc(cx,cx,R*1.035,0,Math.PI*2,true);fx.fill('evenodd');
 var n=28;fx.strokeStyle='#e9c878';fx.lineWidth=1;for(var i=0;i<n;i++){var a=i/n*Math.PI*2,r1=R*1.045,r2=R*1.09;fx.save();fx.translate(cx,cx);fx.rotate(a);
  fx.beginPath();fx.moveTo(r1,-2);fx.lineTo(r2,-2);fx.lineTo(r2,2);fx.lineTo(r1+2,2);fx.stroke();fx.restore();}
 fx.strokeStyle='rgba(0,0,0,.7)';fx.lineWidth=1.5;fx.beginPath();fx.arc(cx,cx,R*1.0,0,7);fx.stroke();
 // top gem
 fx.fillStyle=goldGrad(fx,cx-R*1.3,cx-R*1.0);fx.beginPath();fx.moveTo(cx,cx-R*1.32);fx.lineTo(cx+7,cx-R*1.12);fx.lineTo(cx,cx-R*1.0);fx.lineTo(cx-7,cx-R*1.12);fx.closePath();fx.fill();
 fx.fillStyle=col[0];fx.beginPath();fx.arc(cx,cx-R*1.15,2.6,0,7);fx.fill();
 this.frame=f;this.R=R;this.cx=cx;}
Orb.prototype.draw=function(dt){var x=this.x,s=this.c.width,cx=this.cx,R=this.R,c=this.col;this.t+=dt;
 x.clearRect(0,0,s,s);x.drawImage(this.frame,0,0);x.save();x.beginPath();x.arc(cx,cx,R,0,Math.PI*2);x.clip();
 x.fillStyle='rgba(6,10,24,.82)';x.fillRect(0,0,s,s);
 var lv=cx+R-(2*R*this.v),t=this.t;
 var g=x.createRadialGradient(cx,cx+R*.2,R*.05,cx,cx,R*1.1);g.addColorStop(0,c[0]);g.addColorStop(.55,c[1]);g.addColorStop(1,c[2]);x.fillStyle=g;
 x.beginPath();x.moveTo(0,s);for(var px=0;px<=s;px+=4)x.lineTo(px,lv+Math.sin(px*.06+t*2.2)*2.2+Math.sin(px*.11-t*3.1)*1.4);x.lineTo(s,s);x.fill();
 x.globalCompositeOperation='lighter';
 for(var k=0;k<3;k++){var a=t*.6+k*2.1,rx=cx+Math.cos(a)*R*.35,ry=Math.max(lv+R*.2,cx+Math.sin(a*1.3)*R*.35);
  var gl=x.createRadialGradient(rx,ry,0,rx,ry,R*.5);gl.addColorStop(0,c[3]);gl.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=gl;x.fillRect(0,lv,s,s);}
 // rising motes of divine light
 for(k=0;k<7;k++){var ph=(t*.18+k*.143)%1,mx=cx+Math.sin(k*2.7+t*.8)*R*.55,my=cx+R-ph*2*R;if(my>lv){x.fillStyle='rgba(255,244,210,'+(.55*(1-ph))+')';x.beginPath();x.arc(mx,my,1.3+k%2,0,7);x.fill();}}
 var sl=x.createLinearGradient(0,lv-3,0,lv+5);sl.addColorStop(0,'rgba(255,245,215,0)');sl.addColorStop(.5,'rgba(255,245,215,.55)');sl.addColorStop(1,'rgba(255,245,215,0)');x.fillStyle=sl;x.fillRect(0,lv-3,s,8);
 x.globalCompositeOperation='source-over';
 var sh=x.createRadialGradient(cx,cx,R*.5,cx,cx,R);sh.addColorStop(0,'rgba(0,0,0,0)');sh.addColorStop(1,'rgba(0,4,20,.65)');x.fillStyle=sh;x.fillRect(0,0,s,s);
 var hl=x.createRadialGradient(cx-R*.35,cx-R*.45,0,cx-R*.35,cx-R*.45,R*.55);hl.addColorStop(0,'rgba(255,255,255,.5)');hl.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=hl;x.beginPath();x.ellipse(cx-R*.3,cx-R*.42,R*.42,R*.24,-.5,0,7);x.fill();
 x.restore();};

/* engraved icon painter: draws glyph paths with gold emboss on dark stone */
var GLYPH={
 slash:function(x){x.moveTo(-14,14);x.lineTo(12,-12);x.moveTo(8,-14);x.lineTo(14,-8);x.moveTo(-8,6);x.lineTo(-4,10);},
 spin:function(x){x.arc(0,0,11,0.3,5.6);x.moveTo(11,-4);x.lineTo(15,2);x.lineTo(7,2);x.moveTo(0,-5);x.lineTo(0,5);x.moveTo(-5,0);x.lineTo(5,0);},
 charge:function(x){x.moveTo(-14,0);x.lineTo(10,0);x.moveTo(4,-7);x.lineTo(12,0);x.lineTo(4,7);x.moveTo(-14,-7);x.lineTo(-6,-7);x.moveTo(-14,7);x.lineTo(-6,7);},
 shout:function(x){x.arc(-4,0,5,0,7);x.moveTo(4,-8);x.quadraticCurveTo(10,0,4,8);x.moveTo(8,-12);x.quadraticCurveTo(16,0,8,12);},
 quake:function(x){x.moveTo(-14,10);x.lineTo(-6,2);x.lineTo(-2,8);x.lineTo(4,-4);x.lineTo(8,4);x.lineTo(14,-10);x.moveTo(-14,14);x.lineTo(14,14);},
 potion:function(x){x.moveTo(-3,-14);x.lineTo(3,-14);x.moveTo(-2,-14);x.lineTo(-2,-7);x.arc(0,3,10,-2.1,5.2);x.moveTo(2,-7);x.lineTo(2,-14);},
 helm:function(x){x.moveTo(-12,8);x.lineTo(-12,-2);x.quadraticCurveTo(-12,-14,0,-14);x.quadraticCurveTo(12,-14,12,-2);x.lineTo(12,8);x.lineTo(4,8);x.lineTo(4,0);x.lineTo(-4,0);x.lineTo(-4,8);x.closePath();x.moveTo(0,-14);x.lineTo(0,-4);},
 armor:function(x){x.moveTo(-6,-13);x.lineTo(-14,-8);x.lineTo(-11,2);x.lineTo(-8,0);x.lineTo(-8,13);x.lineTo(8,13);x.lineTo(8,0);x.lineTo(11,2);x.lineTo(14,-8);x.lineTo(6,-13);x.quadraticCurveTo(0,-7,-6,-13);},
 under:function(x){x.moveTo(-9,-12);x.lineTo(9,-12);x.lineTo(11,12);x.lineTo(-11,12);x.closePath();x.moveTo(-9,-4);x.lineTo(9,-4);x.moveTo(-10,4);x.lineTo(10,4);},
 belt:function(x){x.rect(-14,-4,28,8);x.rect(-5,-7,10,14);x.moveTo(0,-3);x.lineTo(0,3);},
 glove:function(x){x.moveTo(-8,13);x.lineTo(-8,-2);x.lineTo(-11,-8);x.moveTo(-8,-2);x.lineTo(-6,-13);x.lineTo(-2,-3);x.lineTo(0,-14);x.lineTo(2,-3);x.lineTo(5,-12);x.lineTo(6,-1);x.lineTo(9,-7);x.lineTo(8,13);x.closePath();},
 boot:function(x){x.moveTo(-6,-14);x.lineTo(4,-14);x.lineTo(4,6);x.lineTo(14,9);x.lineTo(14,14);x.lineTo(-6,14);x.closePath();x.moveTo(-6,0);x.lineTo(4,0);},
 earring:function(x){x.arc(0,-8,4,0,7);x.moveTo(0,-4);x.lineTo(0,0);x.moveTo(0,0);x.lineTo(-6,8);x.lineTo(0,14);x.lineTo(6,8);x.closePath();},
 ring:function(x){x.arc(0,3,10,0,7);x.moveTo(-5,-7);x.lineTo(0,-14);x.lineTo(5,-7);x.closePath();},
 sword:function(x){x.moveTo(-12,12);x.lineTo(10,-10);x.lineTo(13,-13);x.lineTo(10,-6);x.moveTo(-6,2);x.lineTo(-2,6);x.moveTo(-12,12);x.lineTo(-14,14);},
 gem:function(x){x.moveTo(0,-13);x.lineTo(11,-3);x.lineTo(0,13);x.lineTo(-11,-3);x.closePath();x.moveTo(-11,-3);x.lineTo(11,-3);x.moveTo(-5,-3);x.lineTo(0,13);x.lineTo(5,-3);},
 scroll:function(x){x.rect(-10,-11,20,22);x.moveTo(-6,-5);x.lineTo(6,-5);x.moveTo(-6,0);x.lineTo(6,0);x.moveTo(-6,5);x.lineTo(3,5);},
 rage:function(x){x.moveTo(0,-14);x.quadraticCurveTo(10,-2,4,12);x.quadraticCurveTo(0,4,-4,12);x.quadraticCurveTo(-10,-2,0,-14);},
 shield:function(x){x.moveTo(0,-14);x.lineTo(12,-9);x.quadraticCurveTo(12,8,0,14);x.quadraticCurveTo(-12,8,-12,-9);x.closePath();x.moveTo(0,-8);x.lineTo(0,8);}
};
var TINT={slash:'#e07a4a',spin:'#f0c060',charge:'#6fb6ff',shout:'#c69aff',quake:'#e8d070',potion:'#ff6a5a',rage:'#ff8a4a',shield:'#7fe0d0'};
function strokeGlyph(x,name,col,lw){x.lineJoin='round';x.lineCap='round';x.beginPath();GLYPH[name](x);x.strokeStyle='rgba(0,0,0,.85)';x.lineWidth=lw+2;x.translate(.6,1);x.stroke();x.translate(-.6,-1);
 var gg=x.createLinearGradient(0,-14,0,14);gg.addColorStop(0,'#fffbe8');gg.addColorStop(.55,col);gg.addColorStop(1,'#6a4a1a');x.strokeStyle=gg;x.lineWidth=lw;x.shadowColor=col;x.shadowBlur=7;x.stroke();x.shadowBlur=0;}
/* bronze medallion (skills / buffs): beaded bronze rim, lapis enamel, gold glyph */
function medal(name,size){var c=cv(size,size),x=c.getContext('2d'),cx=size/2,R=size*.48,col=TINT[name]||'#e2bd6b';
 var g=x.createRadialGradient(cx-R*.3,cx-R*.4,R*.1,cx,cx,R);g.addColorStop(0,'#f2d28a');g.addColorStop(.5,'#a1742f');g.addColorStop(1,'#3e2a10');x.fillStyle=g;x.beginPath();x.arc(cx,cx,R,0,7);x.fill();
 for(var i=0;i<24;i++){var a=i/24*Math.PI*2;x.fillStyle=i%2?'#ffe9b0':'#6a4a1c';x.beginPath();x.arc(cx+Math.cos(a)*R*.9,cx+Math.sin(a)*R*.9,size*.018,0,7);x.fill();}
 var e=x.createRadialGradient(cx,cx-R*.25,R*.05,cx,cx,R*.78);e.addColorStop(0,'#2b4f9e');e.addColorStop(1,'#07122e');x.fillStyle=e;x.beginPath();x.arc(cx,cx,R*.78,0,7);x.fill();
 x.strokeStyle='rgba(0,0,0,.8)';x.lineWidth=1.5;x.stroke();x.strokeStyle='rgba(255,230,170,.35)';x.lineWidth=1;x.beginPath();x.arc(cx,cx,R*.72,0,7);x.stroke();
 x.save();x.translate(cx,cx);x.scale(size/52,size/52);strokeGlyph(x,name,col,2.6);x.restore();
 var hl=x.createLinearGradient(0,0,0,size);hl.addColorStop(0,'rgba(255,255,255,.18)');hl.addColorStop(.5,'rgba(255,255,255,0)');x.fillStyle=hl;x.beginPath();x.arc(cx,cx,R*.78,Math.PI,0);x.fill();return c;}
/* fallback square icon (items without art) */
function icon(name,size,rc){var c=cv(size,size),x=c.getContext('2d');var g=x.createRadialGradient(size*.5,size*.4,0,size*.5,size*.5,size*.75);g.addColorStop(0,'#203a78');g.addColorStop(1,'#060c1e');x.fillStyle=g;x.fillRect(0,0,size,size);
 x.save();x.translate(size/2,size/2);x.scale(size/36,size/36);strokeGlyph(x,name,rc||TINT[name]||'#e2bd6b',2.2);x.restore();return c;}
window.UIArt={Orb:Orb,icon:icon,medal:medal,cv:cv,noise:noise,laurelArc:laurelArc,meander:meander};
})();
