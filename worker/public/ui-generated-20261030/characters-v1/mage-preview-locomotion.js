/* Mage auto-demo locomotion only. Pure controller: source pixels and bone lengths are immutable. */
'use strict';
(function install(root){
 const EPS=1e-9,mod=x=>((x%1)+1)%1,smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
 function profile(actor,direction){
  const clip=actor.clips.walk?.[direction],frame=clip?.frames?.[0],source=frame?.layered||clip?.layered;
  if(actor.family!=='mage'||!source||!frame)throw Error('Mage demo requires a layered mage walk');
  const layer={...source,staticPose:false};
  if(layer.rig)layer.gaitProfile='contact-continuous-v1';
  else if(layer.view==='right'||layer.view==='left')layer.sideRegistration=layer.sideRegistration||{near:{x:-12,groundOffset:0},far:{x:43,groundOffset:-8}};
  const cycleMs=clip.frames.reduce((n,f)=>n+(f.durationMs||125),0);
  return {direction,clip,frame,layer,cycleMs,bodyHeight:frame.bodyHeight,mirror:!!clip.mirrorX!==!!frame.mirrorX?-1:1,
   startPhase:layer.rig?.3:.25,stopWindowStart:layer.rig?.1:0,stopWindowLength:layer.rig?.2:.25,
   supportBoundary:layer.rig?.6:.5,stopBudgetBodyUnits:4*layer.stride/frame.bodyHeight};
 }
 function sole(leg){return leg.sole?leg.sole.reduce((a,b)=>b[1]>a[1]?b:a):[leg.x,leg.y];}
 class Controller{
  constructor(actor,renderer,direction='down'){this.actor=actor;this.renderer=renderer;this.stage='idle';this.configure(direction);this.lastStep=null;}
  configure(direction){this.profile=profile(this.actor,direction);this.direction=direction;this.phase=this.profile.startPhase;this.stage='idle';this.stopStart=null;this.stopEnd=null;}
  amount(phase=this.phase){if(this.stage==='idle')return 0;if(this.stage==='starting')return smooth((phase-this.rampStart)/(.5-this.profile.startPhase));if(this.stage==='stopping')return 1-smooth((phase-this.stopStart)/(this.stopEnd-this.stopStart));return 1;}
  pose(phase=this.phase,amount=this.amount(phase)){return this.renderer.computePose({...this.profile.layer,phase,motionScale:amount});}
  supportSide(phase=this.phase){const p=mod(phase),side=p<this.profile.supportBoundary-EPS;return this.profile.layer.rig||['right','left'].includes(this.profile.layer.view)?(side?'near':'far'):(side?'left':'right');}
  nextContactBoundary(){const p=this.phase,n=Math.floor(p+EPS),b=this.profile.supportBoundary;return p<n+b-EPS?n+b:n+1;}
  scheduleStop(){const b=this.profile.stopWindowStart;this.stopStart=b+Math.ceil((this.phase-b-EPS)/.5)*.5;if(this.stopStart<this.phase-EPS)this.stopStart+=.5;this.stopEnd=this.stopStart+this.profile.stopWindowLength;this.stage=this.stopStart<=this.phase+EPS?'stopping':'waiting-stop';}
  step(ms,{moving=false,direction=this.direction}={}){
   if(!Number.isFinite(ms)||ms<0||ms>100)throw Error('Mage preview step must be 0..100ms');
   const result={direction:this.direction,deltaBody:[0,0],segments:[],neutralViewChange:false,neutralReached:false,consumedMs:0};
   if(this.stage==='idle'){
    if(direction!==this.direction){this.configure(direction);result.neutralViewChange=true;result.direction=direction;}
    if(!moving){result.settled=true;result.stage=this.stage;result.amount=0;this.lastStep=result;return result;}
    this.phase=this.profile.startPhase;this.rampStart=this.phase;this.rampEnd=.5;this.stage='starting';
   }
   let remaining=ms,iterations=0;
   while(remaining>EPS&&this.stage!=='idle'){
    if(++iterations>20)throw Error('Mage demo integration iteration limit');
    const stopRequested=!moving||direction!==this.direction;
    if(this.stage==='walking'&&stopRequested)this.scheduleStop();
    else if(this.stage==='waiting-stop'&&!stopRequested){this.stage='walking';this.stopStart=this.stopEnd=null;}
    if(this.stage==='waiting-stop'&&this.phase>=this.stopStart-EPS)this.stage='stopping';
    let boundary=this.nextContactBoundary();
    if(this.stage==='starting')boundary=Math.min(boundary,this.rampEnd);
    if(this.stage==='waiting-stop')boundary=Math.min(boundary,this.stopStart);
    if(this.stage==='stopping')boundary=Math.min(boundary,this.stopEnd);
    const dt=Math.min(remaining,(boundary-this.phase)*this.profile.cycleMs);
    if(dt<=EPS){if(this.stage==='starting'&&this.phase>=this.rampEnd-EPS){this.stage='walking';continue;}if(this.stage==='waiting-stop'&&this.phase>=this.stopStart-EPS){this.stage='stopping';continue;}throw Error('Non-progressing mage demo interval');}
    const p0=this.phase,p1=Math.abs(dt-(boundary-p0)*this.profile.cycleMs)<1e-7?boundary:p0+dt/this.profile.cycleMs,side=this.supportSide(p0+1e-8),a0=this.amount(p0),a1=this.amount(p1),q0=this.pose(p0,a0),q1=this.pose(p1,a1),foot0=sole(q0.legs.find(x=>x.side===side)),foot1=sole(q1.legs.find(x=>x.side===side));
    const delta=[-(foot1[0]-foot0[0])*this.profile.mirror/this.profile.bodyHeight,-(foot1[1]-foot0[1])/this.profile.bodyHeight];
    result.deltaBody[0]+=delta[0];result.deltaBody[1]+=delta[1];result.segments.push({side,phase0:p0,phase1:p1,amount0:a0,amount1:a1,point0:foot0,point1:foot1,deltaBody:delta});
    this.phase=p1;remaining-=dt;result.consumedMs+=dt;
    if(this.stage==='starting'&&this.phase>=this.rampEnd-EPS)this.stage='walking';
    if(this.stage==='waiting-stop'&&this.phase>=this.stopStart-EPS)this.stage='stopping';
    if(this.stage==='stopping'&&this.phase>=this.stopEnd-EPS){this.stage='idle';result.neutralReached=true;break;}
   }
   result.direction=this.direction;result.stage=this.stage;result.amount=this.amount();result.phase=mod(this.phase);result.absolutePhase=this.phase;
   result.settled=this.stage==='idle';result.stopBudgetBodyUnits=this.profile.stopBudgetBodyUnits;this.lastStep=result;return result;
  }
 }
 function targetDirection(dx,dy,previous='down'){
  if(!dx&&!dy)return previous;
  const ax=Math.abs(dx),ay=Math.abs(dy),horizontal=previous==='left'||previous==='right';
  const useHorizontal=horizontal?ay<=ax*1.35:ax>ay*1.35;
  return useHorizontal?(dx<0?'left':'right'):(dy<0?'up':'down');
 }
 const api=Object.freeze({Controller,profile,sole,targetDirection,version:'mage-auto-contact-v1'});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MagePreviewLocomotion=api;
})(globalThis);
