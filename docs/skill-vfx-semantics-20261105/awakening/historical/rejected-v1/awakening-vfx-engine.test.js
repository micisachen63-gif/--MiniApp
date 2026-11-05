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
  for(const p of AWAKENING_PROFILES){const source=catalog.planned.find(s=>s.id===p.sourceCatalogId);assert.ok(source);assert.equal(p.name,source.name);assert.equal(p.concept,source.description);assert.equal(p.baseClass,source.baseClass);assert.equal(p.mode,source.mode);assert.equal(p.sourceId,null);assert.equal(p.implemented,false);assert.equal(p.previewOnly,true);assert.ok(p.id.startsWith('preview:awakening:'));assert.ok(!catalog.skills.some(s=>s.id===p.id));assert.equal(p.phases.length,4);assert.equal(p.phases[0].start,0);assert.equal(p.phases[3].end,1);assert.ok(!('mpCost' in p)&&!('damageMultiplier' in p)&&!('cooldown' in p));}
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
  for(const [w,h] of [[880,430],[358,354]]){let body;for(const direction of directions){const layout=layoutForAwakening(w,h,direction,3);if(body)assert.equal(layout.bodyHeight,body);body=layout.bodyHeight;for(const point of [layout.from,...layout.targets])assert.ok(point.x>20&&point.x<w-20&&point.y>20&&point.y<h-20);for(const p of AWAKENING_PROFILES)for(const t of [.18,.38,.63,.88]){const f=buildAwakeningFrame(p,t,layout);for(const s of f.geometry){const points=s.kind==='ring'?[{x:s.x-s.r,y:s.y-s.r*s.tilt},{x:s.x+s.r,y:s.y+s.r*s.tilt}]:s.points;for(const point of points)assert.ok(point.x>=0&&point.x<=w&&point.y>=0&&point.y<=h,p.name+' '+direction+' geometry cropped');}}}}
});
test('sixteen visual constructions remain distinct after all colors and labels are stripped',()=>{
  const silhouettes=AWAKENING_PROFILES.map(p=>JSON.stringify([.2,.4,.63,.85].map(t=>{const f=frame(p.id.replace('preview:awakening:',''),t);return {layers:f.layers.map(({x,y,w,h,rotation,cell,asset,grid})=>({x,y,w,h,rotation,cell,asset,grid})),geometry:f.geometry.map(({kind,x,y,r,tilt,points,width})=>({kind,x,y,r,tilt,points,width}))};})));
  assert.equal(new Set(silhouettes).size,16);
});
test('named spirit subjects, elemental rays, and frost return are explicit rendered subjects',()=>{
  const hunt=frame('archer:expert',.48);assert.deepEqual(hunt.layers.filter(l=>l.asset).map(l=>[l.asset,l.cell]),[['semantic',0],['semantic',5],['hawk',0]]);
  const frost=frame('mage:expert',.68);assert.ok(!frost.layers.some(l=>l.cell===2));assert.ok(frost.layers.every(l=>l.x<frost.to.x));
  const elements=frame('mage:nightmare',.42);for(const color of ['#f29b68','#9be4ef','#d2b1ff','#a1dc93'])assert.ok(elements.geometry.some(g=>g.color===color));
  const shadows=frame('thief:hell',.53);assert.equal(shadows.layers.filter(l=>l.asset==='semantic'&&l.cell===8).length,3);
});
test('sky judgment switches focused shaft and distributed rain without adding gameplay fields',()=>{
  const one=frame('archer:hell',.52),three=frame('archer:hell',.52,layoutForAwakening(880,430,'right',3));
  assert.ok(three.layers.filter(l=>l.cell===0).length>one.layers.filter(l=>l.cell===0).length);
  assert.equal(one.targets.length,1);assert.equal(three.targets.length,3);
  for(const f of [one,three])assert.ok(!('events' in f)&&!('damage' in f)&&!('cast' in f));
});
test('reduced motion freezes composition and low quality keeps the defining subjects',()=>{
  for(const p of AWAKENING_PROFILES){const a=frame(p.id.replace('preview:awakening:',''),.3,{reducedMotion:true,quality:'low'}),b=frame(p.id.replace('preview:awakening:',''),.7,{reducedMotion:true,quality:'low'});assert.deepEqual(a.layers,b.layers);assert.deepEqual(a.geometry,b.geometry);assert.ok(a.layers.length+a.geometry.length>0);}
  const hunt=frame('archer:expert',.63,{quality:'low',reducedMotion:true});assert.equal(hunt.metrics.subjectCount,3);
  const clones=frame('thief:hell',.63,{quality:'low',reducedMotion:true});assert.equal(clones.metrics.subjectCount,3);
});
