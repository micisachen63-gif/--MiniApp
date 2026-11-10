'use strict';
const source=document.querySelector('#source'),motion=document.querySelector('#motion'),s=source.getContext('2d'),m=motion.getContext('2d');
let rig,img,playing=false,phase=.5,last=0;
const guides=document.querySelector('#guides'),grid=document.querySelector('#grid');
guides.checked=false;document.querySelector('#play').textContent='播放';
function path(ctx,points,color){ctx.beginPath();points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](...p));ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();}
function joint(ctx,p,color){ctx.fillStyle=color;ctx.beginPath();ctx.arc(...p,2.5,0,Math.PI*2);ctx.fill();}
function draw(){if(!rig||!img)return;for(const ctx of[s,m]){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,662,904);ctx.scale(2,2);}
 s.drawImage(img,...rig.rect,0,0,rig.rect[2],rig.rect[3]);
 if(guides.checked)for(const [side,color]of[['near','#ff5858'],['far','#58b6ff']]){for(const part of['upper','lower','foot'])path(s,rig[side][part],color);for(const name of['hip','knee','ankle'])joint(s,rig[side][name],color);}
 const pose=CutoutWalk.renderMesh(m,img,{...rig,debug:guides.checked},phase);
 if(grid.checked)for(const ctx of[s,m]){ctx.strokeStyle='#ffffff22';ctx.fillStyle='#fff';ctx.font='8px monospace';for(let x=0;x<331;x+=25){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,452);ctx.stroke();ctx.fillText(x,x+1,11);}for(let y=25;y<452;y+=25){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(331,y);ctx.stroke();ctx.fillText(y,1,y-2);}}
 document.querySelector('#status').textContent='相位 '+phase.toFixed(2)+' · 網格翻折 '+pose.foldedTriangles;
}
function frame(t){if(!playing)return;if(last)phase=(phase+Math.min(t-last,50)/1000)%1;last=t;document.querySelector('#phase').value=Math.round(phase*1000);draw();requestAnimationFrame(frame);}
document.querySelector('#play').onclick=()=>{playing=!playing;document.querySelector('#play').textContent=playing?'暫停':'播放';if(playing){last=0;requestAnimationFrame(frame);}};
document.querySelector('#phase').oninput=e=>{playing=false;document.querySelector('#play').textContent='播放';phase=Number(e.target.value)/1000;draw();};
guides.onchange=draw;grid.onchange=draw;
Promise.all([fetch('cutout-config.json').then(r=>r.json())]).then(async([all])=>{rig=all.sword;img=new Image();img.src=rig.image;await img.decode();draw();}).catch(e=>document.querySelector('#status').textContent=e.message);
