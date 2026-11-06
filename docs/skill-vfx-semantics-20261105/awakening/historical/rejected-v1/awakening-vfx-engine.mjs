import {drawEffectFrame} from './skill-vfx-engine.mjs';
import {awakeningFor,phaseFor} from './awakening-vfx-data.mjs';

// Only the existing canvas renderer is shared. These plans never enter the live
// skill registry, event adapter, server cast flow, or damage calculation.
export {drawEffectFrame as drawAwakeningFrame};
const TAU=Math.PI*2;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=v=>{const x=clamp(v);return x*x*(3-2*x);};
const mix=(a,b,t)=>a+(b-a)*t;
const windowAlpha=(t,a,b)=>t<=a||t>=b?0:Math.sin(Math.PI*(t-a)/(b-a));
const DIRECTIONS=Object.freeze({right:[1,0],down:[0,1],left:[-1,0],up:[0,-1]});

export function layoutForAwakening(width,height,direction='right',targetCount=1){
  if(!DIRECTIONS[direction])throw new RangeError('Unknown direction');
  const w=Math.max(1,Number(width)||1),h=Math.max(1,Number(height)||1);
  const bodyHeight=Math.min(140,w/4.6,h/4.5),[dx,dy]=DIRECTIONS[direction];
  const center={x:w*.5,y:h*.54},distance=bodyHeight*.78;
  const from={x:center.x-dx*distance,y:center.y-dy*distance};
  const to={x:center.x+dx*distance,y:center.y+dy*distance};
  const targets=targetCount===3?[to,{x:to.x-dy*bodyHeight*.48,y:to.y+dx*bodyHeight*.48},{x:to.x+dy*bodyHeight*.48,y:to.y-dx*bodyHeight*.48}]:[to];
  return {from,to,targets,bodyHeight,direction,width:w,height:h};
}

export function buildAwakeningFrame(id,progress,options={}){
  const profile=awakeningFor(id),actual=clamp(Number.isFinite(progress)?progress:0);
  const reduced=options.reducedMotion===true,low=options.quality==='low',t=reduced?.63:actual;
  const body=Math.max(1,Number(options.bodyHeight)||110),scale=body/100;
  const direction=options.direction||'right';if(!DIRECTIONS[direction])throw new RangeError('Unknown direction');
  const [ux,uy]=DIRECTIONS[direction],vx=-uy,vy=ux,theta=Math.atan2(uy,ux);
  const finitePoint=(p,f)=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?{x:p.x,y:p.y}:{...f};
  const from=finitePoint(options.from,{x:180,y:240}),to=finitePoint(options.to,{x:400,y:240});
  const targets=(Array.isArray(options.targets)&&options.targets.length?options.targets:[to]).slice(0,3).map(p=>finitePoint(p,to));
  const layers=[],geometry=[],[color,white]=profile.colors;
  const fade=smooth(actual/.075)*smooth((1-actual)/.14);
  const at=(p,x,y=0)=>({x:p.x+(ux*x+vx*y)*body,y:p.y+(uy*x+vy*y)*body});
  const world=(p,x,y)=>({x:p.x+x*body,y:p.y+y*body});
  const between=(a,b,q,bend=0)=>({x:mix(a.x,b.x,q)+vx*Math.sin(q*Math.PI)*bend*body,y:mix(a.y,b.y,q)+vy*Math.sin(q*Math.PI)*bend*body});
  function line(points,alpha=1,width=1.6,tint=color,glow=3){if(alpha>.003)geometry.push({kind:'line',points,alpha:clamp(alpha),width:width*scale,color:tint,glow:glow*scale});}
  function ring(p,r,alpha=1,tilt=1,width=1.5,tint=color,rotation=0){if(alpha>.003)geometry.push({kind:'ring',x:p.x,y:p.y,r:r*body,tilt,width:width*scale,alpha:clamp(alpha),color:tint,rotation});}
  function sprite(cell,p,w,h=w,rotation=0,alpha=1,tint=color){if(alpha>.003)layers.push({cell,x:p.x,y:p.y,w:w*body,h:h*body,rotation,alpha:clamp(alpha),blend:'screen',tint,flipX:false});}
  function subject(asset,cell,p,size,alpha=1){if(alpha>.003)layers.push({asset,cell,grid:asset==='semantic'?[3,3]:[1,1],x:p.x,y:p.y,w:size*body,h:size*body,rotation:0,alpha:clamp(alpha),blend:'source-over',flipX:direction==='left'});}
  function polygon(p,r,n,alpha=1,rotation=-Math.PI/2,tint=color){line(Array.from({length:n+1},(_,i)=>world(p,Math.cos(rotation+i/n*TAU)*r,Math.sin(rotation+i/n*TAU)*r)),alpha,1.5,tint);}
  function star(p,r,alpha=1,tint=white,n=5,rotation=-Math.PI/2){line(Array.from({length:n*2+1},(_,i)=>{const a=rotation+i/n*Math.PI,k=i%2?.4:1;return world(p,Math.cos(a)*r*k,Math.sin(a)*r*k);}),alpha,1.3,tint);}
  function arc(p,r,start,end,alpha=1,width=2,tint=color,flatten=1){line(Array.from({length:17},(_,i)=>{const a=mix(start,end,i/16);return world(p,Math.cos(a)*r,Math.sin(a)*r*flatten);}),alpha,width,tint);}
  function blade(p,length,rotation,alpha=1,tint=color){
    const a={x:Math.cos(rotation),y:Math.sin(rotation)},b={x:-a.y,y:a.x};
    const point=(x,y)=>({x:p.x+(a.x*x+b.x*y)*body,y:p.y+(a.y*x+b.y*y)*body});
    line([point(-length*.45,0),point(length*.22,-.045),point(length*.55,0),point(length*.22,.045),point(-length*.45,0)],alpha,1.4,tint,4);
    line([point(-length*.28,-.12),point(-length*.28,.12)],alpha,2,tint,3);
    sprite(1,p,length,.6,rotation,alpha*.52,tint);
  }
  function arrow(a,b,q,alpha=1,tint=color,size=.3){
    const p=between(a,b,q),ang=Math.atan2(b.y-a.y,b.x-a.x),v={x:Math.cos(ang),y:Math.sin(ang)},w={x:-v.y,y:v.x};
    const pt=(x,y)=>({x:p.x+(v.x*x+w.x*y)*body,y:p.y+(v.y*x+w.y*y)*body});
    line([pt(-size,0),p],alpha,1.7,tint,5);line([pt(-size*.3,-size*.22),p,pt(-size*.3,size*.22)],alpha,1.5,white);
    sprite(0,p,size*1.7,size*.62,ang,alpha*.5,tint);
  }
  function shards(p,r,alpha=1,tint=color,n=6){for(let i=0;i<(low?Math.ceil(n*.6):n);i++){const a=i/n*TAU+.22,k=r*(.8+(i%3)*.1);sprite(5,world(p,Math.cos(a)*k,Math.sin(a)*k),.11,.23,a,alpha*.7,tint);}}
  function impact(p,alpha=1,size=.8,tint=color){sprite(2,p,size,size,0,alpha*.7,tint);ring(p,size*.45,alpha*.55,.72,1.5,tint);}
  function charge(p,r=.5,a=1){sprite(3,p,r*2,r*2,-t*.5,a*.34);ring(p,r,a*.45);star(p,r*.4,a*.55);}
  function flow(a,b,start,end,bend,alpha=1,tint=color){const q=smooth((t-start)/(end-start));if(t>start&&t<end+.16){const pts=Array.from({length:13},(_,i)=>between(a,b,q*i/12,bend));line(pts,alpha*windowAlpha(t,start,end+.16),2,tint,5);sprite(8,between(a,b,q,bend),.16,.16,0,alpha*windowAlpha(t,start,end+.16),tint);}}
  const chargeA=windowAlpha(t,0,.5),hitA=windowAlpha(t,.38,1),tailA=windowAlpha(t,.6,1);
  // A modest mode crest is secondary to the actual skill element and subject.
  ring(world(from,0,.32),.28,windowAlpha(t,0,1)*.24,.3,1,profile.modeAccent);
  switch(profile.composition){
    case 'armor-break':{
      const a=windowAlpha(t,.06,.55),p=at(to,-.12);
      polygon(p,.42,6,a);line([at(p,-.25,-.24),at(p,.03,-.06),at(p,-.08,.08),at(p,.25,.29)],a,2.5,white);
      charge(from,.32,chargeA);
      for(let i=0;i<3;i++){const start=.27+i*.14,k=(t-start)/.28;if(k>0&&k<1){const alpha=Math.sin(k*Math.PI),rot=theta+[-.7,.75,-.05][i];blade(at(to,(k-.5)*.13),1.26,rot,alpha);}}
      impact(to,hitA*.7,.72);shards(to,.3+smooth((t-.48)/.46)*.5,tailA);
      arc(world(to,0,-.24),.46,Math.PI*1.1,Math.PI*1.9,hitA*.6);break;
    }
    case 'bulwark-echo':{
      const p=at(from,.12),a=windowAlpha(t,.03,.9);
      for(let i=0;i<3;i++)polygon(at(p,i*.07),.48-i*.045,6,a*(.7-i*.12),theta+Math.PI/6);
      sprite(4,p,.92,1.14,0,a*.42);
      arrow(to,p,smooth((t-.16)/.26),windowAlpha(t,.12,.48),white,.42);
      for(let i=0;i<3;i++){const k=(t-.42-i*.07)/.42;if(k>0&&k<1){const q=between(p,to,smooth(k));arc(q,.32+i*.08,theta-1.2,theta+1.2,Math.sin(k*Math.PI),2.2);}}
      ring(p,.2+smooth((t-.32)/.45)*.55,hitA*.5,1.1);impact(to,windowAlpha(t,.7,1)*.6,.62);break;
    }
    case 'blood-tide':{
      charge(from,.45,chargeA);polygon(from,.35,4,windowAlpha(t,.05,.84),theta);polygon(from,.2,4,windowAlpha(t,.05,.7),theta);
      for(let i=0;i<3;i++){const k=(t-.2-i*.14)/.44;if(k>0&&k<1){const p=between(from,to,smooth(k));arc(p,.32+i*.1,theta-Math.PI*.7,theta+Math.PI*.7,Math.sin(k*Math.PI),3.5);sprite(1,p,.88,.85,theta,Math.sin(k*Math.PI)*.48);}}
      for(let i=0;i<(low?3:6);i++){const k=smooth((t-.5)/.5),a=i/6*TAU;sprite(8,world(to,Math.cos(a)*(.2+k*.45),Math.sin(a)*(.2+k*.45)),.09,.17,a,tailA*.65);}
      ring(to,.42,hitA*.35,.4,2);break;
    }
    case 'divine-verdict':{
      const high=world(to,0,-.7),charge=windowAlpha(t,.02,.66);
      for(let i=0;i<3;i++){ring(world(to,0,-.85+i*.25),.58-i*.09,charge*(.7-i*.1),.28,1.5);}
      for(let i=0;i<(low?4:8);i++){const a=i/8*TAU;line([world(high,Math.cos(a)*.64,Math.sin(a)*.5),world(high,Math.cos(a)*.2,Math.sin(a)*.17)],charge*.6,1);}
      const k=smooth((t-.42)/.2),p=world(to,0,mix(-.76,0,k));
      blade(p,1.72,Math.PI/2,windowAlpha(t,.23,.85),white);
      sprite(6,world(to,0,-.25),.74,1.65,0,windowAlpha(t,.5,.94)*.65);
      impact(to,windowAlpha(t,.51,1),1.12);ring(to,.25+smooth((t-.54)/.4)*.72,tailA,.4,2.1);star(to,.8,tailA*.6,color,8);break;
    }
    case 'star-pursuit':{
      const nodes=Array.from({length:5},(_,i)=>between(from,at(to,.32),i/4,Math.sin(i)*.16));
      line(nodes,windowAlpha(t,.04,.88)*.45,1);nodes.forEach((p,i)=>star(p,.1+i*.015,windowAlpha(t,.04+i*.025,.9),white));
      for(let i=0;i<4;i++){const k=(t-.16-i*.09)/.4;if(k>0&&k<1)arrow(at(from,0,(i-1.5)*.07),at(to,.52,(i-1.5)*.07),smooth(k),Math.sin(k*Math.PI),color,.44);}
      targets.forEach(p=>impact(p,windowAlpha(t,.5,.94)*.65,.64));shards(at(to,.2),.54,tailA,white,7);break;
    }
    case 'spirit-hunt':{
      charge(from,.44,chargeA);polygon(to,.28,5,hitA*.55,-Math.PI/2,white);
      const group=[{asset:'semantic',cell:0,bend:-.53,size:.85},{asset:'semantic',cell:5,bend:.48,size:.96},{asset:'hawk',cell:0,bend:-.02,size:.74}];
      group.forEach((g,i)=>{const k=clamp((t-.14-i*.035)/.68),p=between(at(from,0,(i-1)*.2),to,smooth(k),g.bend);subject(g.asset,g.cell,p,g.size,windowAlpha(t,.09+i*.025,.95));line(Array.from({length:13},(_,j)=>between(from,to,j/12,g.bend)),hitA*.18,1,i===1?'#c7e9b3':color);});
      impact(to,windowAlpha(t,.64,.98)*.65,.8);ring(to,.5,hitA*.4,.4);break;
    }
    case 'eclipse-mark':{
      ring(to,.5,windowAlpha(t,.05,.97),1,2.4);arc(world(to,.16,-.06),.42,.6,TAU-.5,windowAlpha(t,.05,.95),5,'#4a3869');
      star(to,.19,hitA*.8);const wolfStart=at(from,-.05,-.4),trap=at(to,-.1,.5);
      const k=smooth((t-.23)/.48);subject('semantic',0,between(wolfStart,to,k,-.3),.66,windowAlpha(t,.13,.84));
      flow(wolfStart,to,.25,.69,-.32,.65,'#9ed7af');polygon(trap,.19,4,windowAlpha(t,.1,.85),theta,'#d2a6ef');flow(trap,to,.32,.7,.17,.7,'#dfb4ee');
      arrow(from,to,smooth((t-.28)/.42),windowAlpha(t,.22,.82),white,.45);ring(to,.2+smooth((t-.66)/.3)*.3,tailA,.7);break;
    }
    case 'sky-judgment':{
      const gate=world(to,0,-.9),a=windowAlpha(t,.05,.85);
      arc(gate,.64,Math.PI*.05,Math.PI*.95,a,2,white,.6);arc(gate,.5,Math.PI*.05,Math.PI*.95,a*.6,1.5,color,.6);
      line([world(gate,-.64,.06),world(gate,-.8,-.12),world(gate,-.65,-.07)],a*.7);line([world(gate,.64,.06),world(gate,.8,-.12),world(gate,.65,-.07)],a*.7);
      star(gate,.2,a);const count=targets.length===1?1:(low?6:9);
      for(let i=0;i<count;i++){const target=targets[i%targets.length],side=count===1?0:(Math.floor(i/targets.length)-1)*.12,start=world(gate,side*2,0),end=world(target,side,0),k=(t-.3-(i%3)*.035)/.38;if(k>0&&k<1)arrow(start,end,smooth(k),Math.sin(k*Math.PI),white,count===1?.72:.35);}
      if(targets.length===1){line([gate,to],windowAlpha(t,.49,.79)*.45,7,white,13);star(to,.54,hitA*.6,white,8);}
      targets.forEach(p=>impact(p,windowAlpha(t,.56,.97),targets.length===1?1.02:.55));break;
    }
    case 'stellar-resonance':{
      const points=[from,between(from,to,.32,-.35),between(from,to,.6,.25),...targets];
      points.forEach((p,i)=>{const a=windowAlpha(t,.04+i*.05,.98);star(p,.14,a,white);ring(p,.13+smooth((t-.38-i*.025)/.4)*.22,a*.35,1,1);});
      for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],start=.16+(i-1)*.075,k=clamp((t-start)/.2),head=between(a,b,k);const pts=Array.from({length:9},(_,j)=>{const p=between(a,head,j/8);return j>0&&j<8?{x:p.x+vx*(j%2?1:-1)*body*.07,y:p.y+vy*(j%2?1:-1)*body*.07}:p;});const alpha=windowAlpha(t,start,.91);line(pts,alpha*.45,6,color,9);line(pts,alpha,1.4,white,4);}
      targets.forEach(p=>impact(p,hitA*.55,.6));break;
    }
    case 'frost-return':{
      const mirror=at(from,.2),a=windowAlpha(t,.05,.97);polygon(mirror,.5,6,a,-Math.PI/2);polygon(mirror,.39,6,a*.5,-Math.PI/2);
      sprite(5,mirror,.7,1.1,0,a*.5);line([world(mirror,-.22,.28),world(mirror,.19,-.3)],a*.75,2,white);line([world(mirror,-.3,.06),world(mirror,.09,-.35)],a*.35,1,white);
      arrow(to,mirror,smooth((t-.13)/.3),windowAlpha(t,.1,.52),white,.4);
      for(let i=0;i<3;i++){const dest=at(from,-.3,(i-1)*.13);flow(mirror,dest,.42+i*.035,.83,(i-1)*.35,.9);}
      ring(mirror,.14+smooth((t-.33)/.4)*.44,hitA*.65,1,1.3);sprite(8,at(from,-.3),.32,.32,0,windowAlpha(t,.65,.98)*.8,white);break;
    }
    case 'element-fracture':{
      const cols=['#f29b68','#9be4ef','#d2b1ff','#a1dc93'];
      for(let i=0;i<4;i++){const a=theta+i*Math.PI/2,start=world(to,Math.cos(a)*.84,Math.sin(a)*.84),k=smooth((t-.15-i*.025)/.4);star(start,.14,windowAlpha(t,.04,.73),cols[i],i===0?4:5);const pts=Array.from({length:9},(_,j)=>{const q=j/8,p=between(start,to,q*k);return {x:p.x+Math.sin(q*Math.PI*4)*(i%2?1:-1)*body*.035,y:p.y+Math.sin(q*Math.PI*3)*body*.04};});line(pts,windowAlpha(t,.14+i*.02,.78),2,cols[i],6);}
      polygon(to,.28,6,windowAlpha(t,.05,.65));const k=smooth((t-.47)/.45);for(let i=0;i<4;i++){const a=theta+i*Math.PI/2,p=world(to,Math.cos(a)*k*.55,Math.sin(a)*k*.55);polygon(p,.11,3,hitA,a,cols[i]);line([world(p,-.06,0),world(p,.05,.08)],hitA*.8,1,white);}
      impact(to,hitA*.6,.8,white);break;
    }
    case 'primordial-burst':{
      const contract=smooth(t/.56),a=windowAlpha(t,.02,.65);
      for(let j=0;j<(low?3:5);j++){const pts=Array.from({length:20},(_,i)=>{const q=i/19,ang=q*TAU*1.1+j*TAU/5-t*.6,r=(.87*(1-q)+.06)*(1-contract*.7);return world(to,Math.cos(ang)*r,Math.sin(ang)*r*.72);});line(pts,a*.6,1.5,j%2?white:color);}
      sprite(8,to,.2+contract*.1,.2+contract*.1,0,a,white);star(to,.12,windowAlpha(t,.1,.68),white,8);
      const k=smooth((t-.53)/.42),burst=windowAlpha(t,.53,1);
      for(let i=0;i<3;i++)ring(to,(.16+k*.9)*(1-i*.18),burst*(.75-i*.15),i===1?.65:1,2-i*.3,i===1?white:color,theta+i*.15);
      star(to,.2+k*.84,burst*.8,white,8,theta);sprite(2,to,.5+k*1.1,.5+k*1.1,0,burst*.75,white);shards(to,.2+k*.9,burst*.65,color,10);break;
    }
    case 'shadow-chain':{
      for(let i=0;i<3;i++){const start=.09+i*.13,k=(t-start)/.45,a=windowAlpha(t,start,start+.6);if(k>0){const begin=at(from,0,(i-1)*.42),p=between(begin,to,smooth(k),i%2?.15:-.15);subject('semantic',8,p,.78,a*.76);line([begin,p],a*.3,1.2);if(k>.4)blade(at(to,0,(i-1)*.08),.75,theta+(i-1)*.65,windowAlpha(t,start+.23,start+.59));}}
      star(to,.18,hitA*.55);ring(to,.33,tailA*.35,.5);break;
    }
    case 'venom-bloom':{
      charge(to,.28,chargeA);const k=smooth((t-.24)/.58);
      for(let i=0;i<5;i++){const a=i/5*TAU+theta,p=world(to,Math.cos(a)*(.08+k*.58),Math.sin(a)*(.08+k*.58));blade(p,.47,a,windowAlpha(t,.11+i*.02,.95));sprite(8,world(p,Math.cos(a)*.12,Math.sin(a)*.12),.12,.16,a,hitA,white);}
      ring(to,.2+k*.6,hitA*.45,.72,2);arc(to,.14+k*.37,theta,theta+TAU*.84,hitA*.5,1.3);sprite(7,to,.8+k*.4,.8+k*.4,t*.15,hitA*.22);break;
    }
    case 'dark-moon':{
      const closing=smooth((t-.12)/.43),a=windowAlpha(t,.03,.87),offset=.34*(1-closing);
      arc(world(to,-offset,0),.64,Math.PI*.45,Math.PI*1.55,a,3.3);arc(world(to,offset,0),.53,-Math.PI*.55,Math.PI*.55,a,2.5,white);
      sprite(7,to,1.08,1.08,0,a*.2,'#7760a4');
      for(let i=0;i<2;i++)blade(to,1.18,theta+(i?-.7:.7),windowAlpha(t,.45+i*.04,.85),i?white:color);
      impact(to,windowAlpha(t,.53,.92)*.8,.72);arc(to,.3,Math.PI*.25,Math.PI*1.45,tailA*.6,1.5);break;
    }
    case 'endless-night':{
      const a=windowAlpha(t,.03,.96);ring(from,.55,a*.28,.5,1.5);sprite(7,from,1.2,.8,0,a*.2);
      for(let i=0;i<3;i++){const start=.13+i*.13,begin=at(from,-.05,(i-1)*.54),k=smooth((t-start-.13)/.35),p=between(begin,to,k,(i-1)*.22),alpha=windowAlpha(t,.04+i*.03,.8+i*.055);subject('semantic',8,p,.91,alpha*.85);if(t>start+.16)blade(p,.67,theta+(i-1)*.55,windowAlpha(t,start+.16,start+.52));const mist=smooth((t-.61-i*.05)/.3);for(let j=0;j<(low?2:4);j++)sprite(7,world(p,(j-1.5)*.1,(-.1-j*.07)*mist),.23+mist*.3,.24+mist*.2,0,tailA*.15);}
      arc(to,.34,theta-.8,theta+.8,tailA*.4);break;
    }
    default:throw new Error('Unrendered awakening composition '+profile.composition);
  }
  const maxLayers=low?36:64,maxGeometry=low?64:100;
  const outputLayers=layers.slice(0,maxLayers).map(l=>({...l,alpha:l.alpha*fade})).filter(l=>l.alpha>.001);
  const outputGeometry=geometry.slice(0,maxGeometry).map(g=>({...g,alpha:g.alpha*fade})).filter(g=>g.alpha>.001);
  return {recipe:{id:profile.id,label:profile.name,sourceId:null,implemented:false,previewOnly:true,durationMs:profile.durationMs,composition:profile.composition},profile,progress:actual,phase:phaseFor(profile,actual).label,layers:outputLayers,geometry:outputGeometry,bodyHeight:body,reducedMotion:reduced,quality:low?'low':'high',direction,targets,from,to,metrics:{layerCount:outputLayers.length,geometryCount:outputGeometry.length,subjectCount:outputLayers.filter(l=>l.asset).length,layerBudget:maxLayers,geometryBudget:maxGeometry}};
}
