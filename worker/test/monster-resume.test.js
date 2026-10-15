import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/battle.js',import.meta.url),'utf8');
const section=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));

function fixture({reducedMotion=false}={}){
  const callbacks=[],clears=[],effects=[],calls={guardian:0,map:0,loop:0};
  const classList=()=>{const values=new Set(['sheet-ready']);return {
    contains:k=>values.has(k),add:k=>values.add(k),remove:k=>values.delete(k),
    toggle(k,on){on??=!values.has(k);on?values.add(k):values.delete(k);}
  };};
  const enemy=(id,idle)=>({
    refs:{mon:{classList:classList()},mSheet:{style:{}}},
    mon:{id,hp:100,max:100,sheet:id},monAtlas:{cols:4,rows:4,idle,attack:[8,9],death:[15]},
    monFrameRun:0,monSheetRatio:id==='a'?1:2,monSheetBody:.75,monSheetFeet:.9375
  });
  const group=[enemy('a',[0,1,2,3]),enemy('b',[4,5,6,7])];
  const S={group,selected:1,pendingTarget:0,rm:reducedMotion,me:{},running:true,queue:[{combat:'next-round'}],visualEpoch:9};
  for(const key of ['mon','monAtlas','monFrameRun','monSheetRatio','monSheetBody','monSheetFeet'])S[key]=group[1][key];
  const painter={save(){},restore(){},setTransform(){},clearRect(...args){clears.push(args);}};
  const E={...group[1].refs,bg:{querySelector:()=>null},fx:{width:780,height:1200,getContext:()=>painter}};
  const root={isConnected:true,parentNode:null,classList:classList()};
  const slot={appendChild(node){node.parentNode=this;node.isConnected=true;}};
  const document={hidden:false};
  const window={RpgMonsterExpansion:{
    frame:(meta,action,p,seconds)=>{const seq=meta[action]||meta.idle;return seq[action==='idle'?Math.floor(seconds*4)%seq.length:Math.min(seq.length-1,Math.floor(p*seq.length))];},
    position:(meta,index)=>`${index%meta.cols/(meta.cols-1)*100}% ${Math.floor(index/meta.cols)/(meta.rows-1)*100}%`
  },RpgMapMotion:{attach(){calls.map++;}}};
  const context=vm.createContext({S,E,root,window,document,P:[],FX:[],rafOn:false,last:0,ctx:painter,W:390,H:600,
    performance:{now:()=>1000},requestAnimationFrame:callback=>callbacks.push(callback),
    paused:()=>!root.isConnected||document.hidden,syncGuardian(){calls.guardian++;},positionGuardian(){},fit(){},
    loop(){calls.loop++;}
  });
  vm.runInContext(
    section('    const monKeys=','    function clearGroup(')+
    section('    function animateMonsterSheet(','    // ---------- one hero attack')+
    section('    function clearTransientFx(','    function slashArc(')+
    section('    function kick()','    function burst(')+
    section('    function fx(','    let last =')+
    section('    function attach(','    return { el: root')+
    ';this.api={animate:animateMonsterSheet,focus:focusEnemy,save:saveEnemy,attach,frame,fx};',context);
  const api=context.api;
  const tick=time=>{const batch=callbacks.splice(0);for(const callback of batch)callback(time);};
  const start=()=>{for(let i=0;i<group.length;i++){api.focus(i);api.animate('idle');api.save();}api.focus(1);};
  const detach=()=>{root.isConnected=false;root.parentNode=null;};
  return {api,S,E,root,slot,group,context,callbacks,clears,effects,calls,tick,start,detach};
}

test('returning to the stage resumes both living atlases with their own metadata and preserves the selected target',()=>{
  const h=fixture();h.start();h.tick(0);h.tick(250);
  h.detach();h.tick(500);assert.equal(h.callbacks.length,0);
  const hp=h.group.map(e=>e.mon.hp),queue=h.S.queue,metadata=h.group.map(e=>e.monAtlas);
  h.api.attach(h.slot);assert.equal(h.callbacks.length,2);
  assert.equal(h.S.selected,1);assert.equal(h.S.mon.id,'b');assert.equal(h.S.pendingTarget,0);
  assert.equal(h.S.queue,queue);assert.equal(h.S.visualEpoch,9);
  assert.deepEqual(h.group.map(e=>e.mon.hp),hp);assert.deepEqual(h.group.map(e=>e.monAtlas),metadata);
  assert.deepEqual(h.group.map(e=>e.monSheetRatio),[1,2]);
  h.tick(1000);h.tick(1250);
  assert.equal(h.group[0].refs.mSheet.style.backgroundPosition,'33.33333333333333% 0%');
  assert.equal(h.group[1].refs.mSheet.style.backgroundPosition,'33.33333333333333% 33.33333333333333%');
  assert.equal(h.S.selected,1);assert.equal(h.S.monAtlas,h.group[1].monAtlas);
  const runs=h.group.map(e=>e.monFrameRun);
  h.api.attach(h.slot);h.api.attach(h.slot);
  assert.equal(h.callbacks.length,2);assert.deepEqual(h.group.map(e=>e.monFrameRun),runs);
  assert.equal(h.calls.guardian,3);assert.equal(h.calls.map,3);assert.equal(h.calls.loop,0);
});

test('reattaching does not restart a death pose, a zero-HP enemy, or reduced-motion animation',()=>{
  const h=fixture();h.start();h.api.focus(0);h.api.animate('death');h.api.save();h.api.focus(1);
  h.tick(0);h.detach();h.tick(100);assert.equal(h.callbacks.length,0);
  const deathRun=h.group[0].monFrameRun;
  h.api.attach(h.slot);assert.equal(h.callbacks.length,1);
  assert.equal(h.group[0].monFrameRun,deathRun);assert.equal(h.group[0].monSheetAction,'death');
  h.detach();h.tick(200);h.group[1].mon.hp=0;h.api.attach(h.slot);assert.equal(h.callbacks.length,0);
  const reduced=fixture({reducedMotion:true});reduced.detach();reduced.api.attach(reduced.slot);
  assert.equal(reduced.callbacks.length,0);assert.equal(reduced.S.selected,1);
});

test('detaching clears the old canvas and transient particles without discarding a committed round or replaying a spell',()=>{
  const h=fixture(),queue=h.S.queue;
  h.api.fx(1000,()=>h.effects.push('old spell'));h.tick(1000);
  assert.deepEqual(h.effects,['old spell']);assert.equal(h.callbacks.length,1);
  h.context.P.push({life:.5});h.detach();h.tick(1100);
  assert.equal(h.context.FX.length,0);assert.equal(h.context.P.length,0);assert.equal(h.context.last,0);
  assert.equal(h.context.rafOn,false);assert.equal(h.callbacks.length,0);
  assert.deepEqual(h.clears.at(-1),[0,0,780,1200]);assert.equal(h.S.queue,queue);
  h.api.attach(h.slot);h.tick(1200);assert.deepEqual(h.effects,['old spell']);
  h.api.fx(1000,()=>h.effects.push('new round'));h.tick(1300);
  assert.deepEqual(h.effects,['old spell','new round']);assert.equal(h.S.queue,queue);
  assert.deepEqual(h.group.map(e=>e.mon.hp),[100,100]);
});

test('a detach and reattach before the pending canvas callback also discards its old bitmap and effect',()=>{
  const h=fixture();h.api.fx(1000,()=>h.effects.push('old spell'));h.tick(1000);
  h.detach();h.api.attach(h.slot);
  assert.equal(h.context.FX.length,0);assert.deepEqual(h.clears.at(-1),[0,0,780,1200]);
  h.tick(1100);assert.deepEqual(h.effects,['old spell']);assert.equal(h.context.rafOn,false);
});
