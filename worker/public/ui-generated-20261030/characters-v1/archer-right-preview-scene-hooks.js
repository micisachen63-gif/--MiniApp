// Exact two-ID archer RIGHT preview. Enabled only when its explicit same-source kit neutral idle is present; URL 0 disables.
var archerRightPreviewState = {adapter:null, visual:null, generation:null, loading:null, error:null, poseOwned:false};
function archerRightPreviewRequested(){
 try{
  const local=new URLSearchParams(location.search).get('archerGaitPreview');
  const parentValue=window.parent!==window?new URLSearchParams(window.parent.location.search).get('archerGaitPreview'):null;
  return local!=='0'&&parentValue!=='0';
 }catch(e){return false;}
}
function clearArcherRightPreview(){
 var a=archerRightPreviewState.adapter;if(a)a.dispose();
 archerRightPreviewState={adapter:null,visual:null,generation:null,loading:null,error:null,poseOwned:false};
 window.__archerRightPreviewState=archerRightPreviewState;
}
function archerRightPreviewDesired(target){
 if(debugState.direction!=='auto')return debugState.direction;
 if(!target)return visual.direction;
 var dx=target.x-hero.x,dy=target.y-hero.y;
 return Math.abs(dx)>Math.abs(dy)?(dx<0?'left':'right'):(dy<0?'up':'down');
}
function archerRightPreviewB1HoldInvalidated(){
 var state=archerRightPreviewState,b=state.b1Binding;
 if(!b||!archerRightPreviewRequested()||!visual?.ready||state.visual!==visual||state.generation!==visual.generation||b.visual!==visual||b.generation!==visual.generation)return false;
 if(!state.b1Invalidated){
  var sameSources=visual.actor===b.actor&&visual.actor.clips?.idle?.right===b.idle&&visual.actor.clips?.walk?.right===b.walk;
  var headerOk=!!(sameSources&&window.ArcherRightPreviewAdapter&&window.ArcherRightPreviewLocomotion&&ArcherRightPreviewLocomotion.eligible(visual.actor,'right'));
  var valid=headerOk&&!state.error&&!state.adapter?.b1Invalidated;
  // Pending B1 source verification is not itself an invalid binding.
  if(valid&&!state.loading)valid=!!state.adapter?.isBound();
  if(!valid){state.b1Invalidated=true;if(state.adapter)state.adapter.dispose();}
 }
 if(state.b1Invalidated){state.poseOwned=false;visual.play('idle','right',false);return true;}
 return false;
}
function archerRightDemoAutoStep(near,nd,target,dt){
 if(archerRightPreviewB1HoldInvalidated())return true;
 if(!archerRightPreviewRequested() || !window.ArcherRightPreviewAdapter || !window.ArcherRightPreviewLocomotion ||
    !visual?.ready || !ArcherRightPreviewLocomotion.eligible(visual.actor,'right')){
  if(archerRightPreviewState.adapter)clearArcherRightPreview();
  return false;
 }
 var state=archerRightPreviewState,desired=archerRightPreviewDesired(target);
 if(state.adapter&&(state.visual!==visual||state.generation!==visual.generation)){clearArcherRightPreview();state=archerRightPreviewState;}
 var active=state.adapter?.isBound()&&state.adapter.controller.stage!=='idle';
 if(desired!=='right'&&!active){if(state.adapter)clearArcherRightPreview();return false;}
 if(!state.adapter){
  state.adapter=new ArcherRightPreviewAdapter(visual,{enabled:true,evaluationOnly:true});
  state.visual=visual;state.generation=visual.generation;
  if(visual.actor?.id==='adv2_archer_B1_m'){state.b1Binding=Object.freeze({visual,generation:visual.generation,actor:visual.actor,idle:visual.actor.clips.idle.right,walk:visual.actor.clips.walk.right});state.b1Invalidated=false;}
  state.loading=state.adapter.bind('right').then(function(ok){state.loading=null;if(!ok)state.error='Actor changed while binding reviewed RIGHT source';}).catch(function(error){state.loading=null;state.error=String(error);console.error(error);});
  window.__archerRightPreviewState=state;
 }
 // Keep the existing portrait idle while the exact source is being verified.
 if(state.loading||state.error||!state.adapter.isBound()){state.poseOwned=false;visual.play('idle','right',false);return true;}
 var close=near&&nd<ringR(near)*1.12+HS*.02;
 var moving=!!target&&!close&&desired==='right';
 visual.face(1,0);visual.play('walk','right',false);
 var step=state.adapter.step(dt*1000,{moving:moving,bounds:{right:G.w-HS*.15}});
 state.lastStep=step;state.poseOwned=!step.settled;
 if(step.settled){
  // Deliberately return to the original portrait idle so the true handoff is reviewable.
  visual.play('idle','right',false);
  if(desired!=='right'){clearArcherRightPreview();return true;}
  if(close&&hero.atkT<=0){
   visual.face(near.x-hero.x,near.y-hero.y);if(debugState.direction!=='auto')visual.direction=debugState.direction;
   hero.atkT=visual.duration('attack')/1000+.18;hero.play('h_atk');hero.busy=visual.duration('attack')/1000;
   var attackTarget=near,attackGeneration=visual.generation;
   sc.time.delayedCall(visual.releaseDelay(),function(){
    if(visual.ready&&visual.generation===attackGeneration&&debugState.action==='auto'&&alive(attackTarget))performPreviewAttack(attackTarget);
   });
  }
 }
 return true;
}
function archerRightPreviewAfterFrame(){
 var state=archerRightPreviewState;
 if(!state.adapter)return;
 if(!archerRightPreviewRequested()||debugState.action!=='auto'||state.visual!==visual||state.generation!==visual.generation||!visual?.ready){clearArcherRightPreview();return;}
 if(state.poseOwned&&visual.action==='walk'&&visual.activeDirection==='right')state.adapter.draw();
}
