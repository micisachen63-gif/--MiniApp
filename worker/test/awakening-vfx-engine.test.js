import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AWAKENING_PROFILES,awakeningFor} from '../public/awakening-vfx-data.mjs';
import {buildAwakeningFrame,layoutForAwakening} from '../public/awakening-vfx-engine.mjs';
const catalog=JSON.parse(readFileSync(new URL('../public/skill-vfx-catalog.json',import.meta.url),'utf8'));
const directions=['right','down','left','up'];
const frame=(id,t=.63,opts={})=>buildAwakeningFrame('preview:awakening:'+id,t,{...layoutForAwakening(880,430,'right',1),...opts});
function finite(value){if(typeof value==='number')assert.ok(Number.isFinite(value),'finite geometry');else if(value&&typeof value==='object')Object.values(value).forEach(finite);}
test('16 preview identities match the planned names and remain outside all 196 live skills',()=>{
  assert.equal(AWAKENING_PROFILES.length,16);assert.equal(catalog.skills.length,196);
  assert.equal(new Set(AWAKENING_PROFILES.map(p=>p.id)).size,16);
  for(const p of AWAKENING_PROFILES){const source=catalog.planned.find(s=>s.id===p.sourceCatalogId);assert.ok(source);assert.equal(p.name,source.name);assert.equal(p.concept,source.description);assert.equal(p.baseClass,source.baseClass);assert.equal(p.mode,source.mode);assert.equal(p.sourceId,null);assert.equal(p.implemented,false);assert.equal(p.previewOnly,true);assert.ok(p.id.startsWith('preview:awakening:'));assert.ok(!catalog.skills.some(s=>s.id===p.id));assert.equal(p.phases.length,4);assert.equal(p.presentationRevision,'ornate-v2');assert.deepEqual(p.art.grid,[2,2]);assert.equal(p.art.asset,'awakening-'+p.baseClass);assert.equal(p.art.cell,['elite','expert','nightmare','hell'].indexOf(p.mode));assert.equal(p.phases[0].start,0);assert.equal(p.phases[3].end,1);assert.ok(!('mpCost' in p)&&!('damageMultiplier' in p)&&!('cooldown' in p));}
  assert.throws(()=>awakeningFor('planned:mage:hell'),RangeError);
  assert.throws(()=>awakeningFor('native:mage:A1'),RangeError);
});
test('all 16 compositions produce finite, bounded, transparent-ended four-direction multistage frames',()=>{
  for(const p of AWAKENING_PROFILES)for(const direction of directions)for(const quality of ['high','low'])for(const reducedMotion of [false,true]){
    const options={...layoutForAwakening(880,430,direction,3),quality,reducedMotion};
    for(const t of [0,.001,.15,.36,.63,.88,.999,1]){const f=buildAwakeningFrame(p,t,options);finite(f);assert.equal(f.recipe.sourceId,null);assert.equal(f.recipe.previewOnly,true);assert.ok(f.layers.length<=f.metrics.layerBudget);assert.ok(f.geometry.length<=f.metrics.geometryBudget);for(const s of [...f.layers,...f.geometry])assert.ok(s.alpha>=0&&s.alpha<=1);if(t===0||t===1)assert.equal(f.layers.length+f.geometry.length,0);else if(t>.01&&t<.99)assert.ok(f.layers.length+f.geometry.length>0,p.name+' stage '+t);}
  }
});
test('four-direction and phone layouts use equal scale and keep every control point on stage',()=>{
  for(const [w,h] of [[880,520],[358,410]]){let body;for(const direction of directions){const layout=layoutForAwakening(w,h,direction,3);if(body)assert.equal(layout.bodyHeight,body);body=layout.bodyHeight;for(const point of [layout.from,...layout.targets])assert.ok(point.x>20&&point.x<w-20&&point.y>20&&point.y<h-20);for(const p of AWAKENING_PROFILES)for(const t of [.18,.38,.63,.88]){const f=buildAwakeningFrame(p,t,layout);for(const s of f.geometry){const points=s.kind==='ring'?[{x:s.x-s.r,y:s.y-s.r*s.tilt},{x:s.x+s.r,y:s.y+s.r*s.tilt}]:s.points;for(const point of points)assert.ok(point.x>=0&&point.x<=w&&point.y>=0&&point.y<=h,p.name+' '+direction+' geometry cropped');}}}}
});
test('sixteen visual constructions remain distinct after all colors and labels are stripped',()=>{
  const silhouettes=AWAKENING_PROFILES.map(p=>JSON.stringify([.2,.4,.63,.85].map(t=>{const f=frame(p.id.replace('preview:awakening:',''),t);return {layers:f.layers.map(({x,y,w,h,rotation,cell,asset,grid})=>({x,y,w,h,rotation,cell,asset,grid})),geometry:f.geometry.map(({kind,x,y,r,tilt,points,width})=>({kind,x,y,r,tilt,points,width}))};})));
  assert.equal(new Set(silhouettes).size,16);
});
test('dedicated paintings are large, exact-cell, full-color principal subjects',()=>{
  for(const p of AWAKENING_PROFILES){const f=frame(p.id.replace('preview:awakening:',''),.67),main=f.layers.filter(l=>l.role==='awakening-principal');assert.equal(main.length,1);assert.equal(main[0].asset,p.art.asset);assert.equal(main[0].cell,p.art.cell);assert.deepEqual(main[0].grid,[2,2]);assert.equal(main[0].blend,'source-over');assert.ok(main[0].w>f.bodyHeight*3,p.name+' principal must fill the stage');assert.ok(f.paintPasses.some(pass=>pass.name==='foreground-burst'&&pass.layers.length));}
  const wide=frame('mage:hell',.67,{principalAspect:1.5}),main=wide.layers.find(l=>l.role==='awakening-principal');assert.ok(Math.abs(main.w/main.h-1.5)<1e-9);

});
test('sky judgment switches focused shaft and distributed rain without adding gameplay fields',()=>{
  const one=frame('archer:hell',.52),three=frame('archer:hell',.52,layoutForAwakening(880,430,'right',3));
  assert.ok(three.layers.filter(l=>l.cell===0).length>one.layers.filter(l=>l.cell===0).length);
  assert.equal(one.targets.length,1);assert.equal(three.targets.length,3);
  for(const f of [one,three])assert.ok(!('events' in f)&&!('damage' in f)&&!('cast' in f));
});
test('reduced motion freezes composition and low quality keeps the defining subjects',()=>{
  for(const p of AWAKENING_PROFILES){const a=frame(p.id.replace('preview:awakening:',''),.3,{reducedMotion:true,quality:'low'}),b=frame(p.id.replace('preview:awakening:',''),.7,{reducedMotion:true,quality:'low'});assert.deepEqual(a.layers,b.layers);assert.deepEqual(a.geometry,b.geometry);assert.ok(a.layers.length+a.geometry.length>0);}
  const hunt=frame('archer:expert',.63,{quality:'low',reducedMotion:true});assert.equal(hunt.metrics.subjectCount,1);assert.equal(hunt.layers.find(l=>l.role==='awakening-principal').asset,'awakening-archer');
  const clones=frame('thief:hell',.63,{quality:'low',reducedMotion:true});assert.equal(clones.metrics.subjectCount,1);assert.equal(clones.layers.find(l=>l.role==='awakening-principal').asset,'awakening-thief');
});
test('transparent padding is compensated without stretching or shifting the visible principal',()=>{
  for(const direction of directions){const options=layoutForAwakening(358,410,direction,1),plain=frame('mage:hell',.67,options),padded=frame('mage:hell',.67,{...options,principalBounds:{x:.17,y:.08,width:.62,height:.8}});const a=plain.layers.find(l=>l.role==='awakening-principal'),b=padded.layers.find(l=>l.role==='awakening-principal');assert.ok(Math.abs(Math.max(b.w*.62,b.h*.8)-Math.max(a.w,a.h))<1e-7);const ox=(.17+.62/2-.5)*b.w*(b.flipX?-1:1),oy=(.08+.8/2-.5)*b.h;assert.ok(Math.abs(b.x+ox-a.x)<1e-7);assert.ok(Math.abs(b.y+oy-a.y)<1e-7);}
});
test('spirits and shadow bodies make independent journeys after the painted cut-in',()=>{
  const a=frame('archer:expert',.34),b=frame('archer:expert',.65),actors=f=>f.layers.filter(l=>l.role==='awakening-motion-actor');
  assert.deepEqual(actors(a).map(l=>[l.asset,l.cell]),[['semantic',0],['semantic',5],['hawk',0]]);assert.equal(actors(b).length,3);assert.ok(actors(a).every((l,i)=>Math.hypot(l.x-actors(b)[i].x,l.y-actors(b)[i].y)>a.bodyHeight*.3));assert.ok(actors(b).every(l=>l.w>=b.bodyHeight));
  const first=actors(frame('thief:elite',.21)),middle=actors(frame('thief:elite',.45)),last=actors(frame('thief:elite',.88));assert.equal(first.length,1);assert.equal(middle.length,3);assert.equal(last.length,1);assert.ok(middle.every(l=>l.asset==='semantic'&&l.cell===8));
});
test('sky-judgment upward entry keeps the complete arrow shaft and glow off the stage edge',()=>{
  for(const [width,height] of [[1061,520],[358,410]])for(const t of [.31,.36,.4]){
    const f=frame('archer:hell',t,layoutForAwakening(width,height,'up',1)),g=f.paintPasses.find(pass=>pass.name==='gathering');
    for(const shape of g.geometry)if(shape.kind==='line')for(const point of shape.points)assert.ok(point.y>12,'upward sky arrow tail must spawn below the top glow margin');
  }
});
test('frost reveal recedes for three distinct return tips beyond the mirror in every direction',()=>{
  for(const direction of directions){
    const options=layoutForAwakening(358,410,direction,1),early=frame('mage:expert',.29,options),release=frame('mage:expert',.68,options),late=frame('mage:expert',.8,options),main=f=>f.layers.find(l=>l.role==='awakening-principal'),tips=f=>f.layers.filter(l=>l.role==='awakening-frost-return-head');
    assert.ok(main(early).alpha>.6);assert.ok(main(release).alpha<.25);assert.equal(tips(release).length,3);assert.equal(tips(late).length,3);assert.equal(early.layers.filter(l=>l.role==='awakening-frost-incoming-head').length,1);
    const origin={x:(options.from.x+options.to.x)/2,y:(options.from.y+options.to.y)/2},length=Math.hypot(options.from.x-origin.x,options.from.y-origin.y),dx=(options.from.x-origin.x)/length,dy=(options.from.y-origin.y)/length;
    for(const tip of tips(release))assert.ok(((tip.x-origin.x)*dx+(tip.y-origin.y)*dy)/options.bodyHeight>.95);
    for(const tip of tips(late)){assert.ok(((tip.x-origin.x)*dx+(tip.y-origin.y)*dy)/options.bodyHeight>1.45);assert.ok(tip.x>15&&tip.x<343&&tip.y>15&&tip.y<395);}
  }
});
