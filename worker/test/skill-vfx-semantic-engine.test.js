import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEffectFrame, createVfxPlayer, drawEffectFrame, recipeFor } from '../public/skill-vfx-engine.mjs';
import { semanticFor } from '../public/skill-vfx-semantics.mjs';

const catalog=JSON.parse(readFileSync(new URL('../public/skill-vfx-catalog.json',import.meta.url),'utf8'));
const skills=new Map(catalog.skills.map(skill=>[skill.id,skill]));
const skill=id=>{assert.ok(skills.has(id),id);return skills.get(id);};
const from={x:400,y:400},to={x:700,y:400};
const near=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<1e-6;
const frame=(id,t=.5,extra={})=>buildEffectFrame(skill(id),t,{from,to,targets:[to],bodyHeight:150,direction:'right',...extra});
const materialLayers=f=>f.layers.filter(layer=>layer.asset);
const coreAt=(f,p)=>f.layers.some(layer=>near(layer,p)&&[2,5,8].includes(layer.cell)&&!layer.asset);

test('named wolves, star spirits, abyss spirits, trees and the nether gate select visible cropped subjects',()=>{
 const expected=[['special:skill_13_1',0,3],['native:mage:B21',1,1],['native:mage:B22',2,1],
   ['native:archer:B121',3,1],['native:archer:B122',5,1],['native:mage:B222',6,1],['native:thief:A211',7,1]];
 for(const [id,cell,minimum] of expected)for(const quality of ['high','low']){
   const subjects=materialLayers(frame(id,.5,{quality}));
   assert.ok(subjects.length>=minimum,id+': actual subject artwork, not a recipe-only label');
   assert.ok(subjects.every(layer=>layer.asset==='semantic'&&layer.cell===cell),id+': named subject');
   assert.ok(subjects.every(layer=>layer.grid[0]===3&&layer.grid[1]===3),id+': one cell, not the full nine-subject sheet');
 }
 assert.equal(semanticFor(skill('atlas:archer_beast')).asset,'hawk','the actual hawk keeps its hawk');
 assert.equal(semanticFor(skill('special:skill_18_1')).asset,'fire-spirit','the actual fire spirit keeps its fire spirit');
});

test('war banner and smoke doubles survive defensive kind routing and stay on their beneficiary',()=>{
 for(const [id,cell] of [['special:skill_19_2',4],['special:skill_18_2',8],['special:skill_thief_02',8]]){
   assert.equal(skill(id).kind,'shield');
   const a=frame(id,.56),b=frame(id,.56,{to:{x:-9000,y:9000},targets:[{x:9000,y:-9000}]});
   assert.deepEqual({layers:a.layers,geometry:a.geometry},{layers:b.layers,geometry:b.geometry},id+': no enemy interaction');
   assert.ok(materialLayers(a).some(layer=>layer.asset==='semantic'&&layer.cell===cell),id+': distinct support silhouette');
   assert.ok(!coreAt(a,to),id+': support cannot imply a hostile impact');
 }
 const mirror=frame('special:skill_thief_06',.56);
 assert.ok(mirror.geometry.filter(g=>g.kind==='line'&&g.points.length>=7).length>=3,'mirror counter uses several mirror planes');
 assert.ok(!coreAt(mirror,to),'mirror defense cannot invent a target hit');
});

test('two-shot sends two visible arrows to one authoritative recipient without inventing another target',()=>{
 const id='native:archer:base';
 for(const quality of ['high','low']){
   const travelling=frame(id,.42,{quality});
   const arrows=travelling.layers.filter(layer=>layer.cell===0&&[57,65].includes(layer.w));
   assert.equal(arrows.length,2,'a one-target two-shot still shows two arrows');
   assert.ok(Math.hypot(arrows[0].x-arrows[1].x,arrows[0].y-arrows[1].y)>1,'the arrows can be distinguished');
   const hit=frame(id,.6,{quality});
   assert.ok(hit.geometry.some(g=>g.kind==='ring'&&near(g,to)),'the true target receives contact');
   assert.ok(hit.geometry.filter(g=>g.kind==='ring').every(g=>near(g,to)),'there is no ornamental enemy destination');
   const none=frame(id,.42,{quality,targets:[]});assert.equal(none.layers.length+none.geometry.length,0);
 }
});

test('spinning blades rotate and return while star-blade rain descends from above the actual target',()=>{
 const spin=frame('native:thief:B',.41),later=frame('native:thief:B',.48),returning=frame('native:thief:B',.84);
 const blades=f=>f.layers.filter(l=>!l.asset&&l.cell===0);
 assert.ok(blades(spin).length>=2&&blades(returning).length>=2,'multiple spinning blades remain visible');
 assert.notEqual(blades(spin)[0].rotation,blades(later)[0].rotation,'blade orientation actually rotates');
 assert.ok(blades(returning).every(l=>l.x<to.x-100),'boomerang artwork travels back after true contact');
 assert.ok(frame('native:thief:B',.62).geometry.some(g=>g.kind==='ring'&&near(g,to)));
 const rain=blades(frame('native:thief:B121',.46));
 assert.ok(rain.length>=3&&rain.every(l=>l.y<to.y),'star-blade rain approaches from above');
 assert.ok(coreAt(frame('native:thief:B121',.62),to),'rain retains the actual impact');
});

test('custom spinning blades and blade rain reserve contacts for all 32 targets before ornaments',()=>{
 const targets=Array.from({length:32},(_,i)=>({x:700+i*43,y:400+i%3*60}));
 for(const id of ['native:thief:B111','native:thief:B121'])for(const quality of ['high','low']){
   const f=frame(id,.64,{quality,targets});
   assert.ok(f.layers.length<=(quality==='low'?48:94)&&f.geometry.length<=64);
   for(const p of targets)assert.ok(coreAt(f,p),id+': every supplied target gets its core');
 }
});

test('void tears differ from clockwork and damaging fountain or smoke routes keep true impacts',()=>{
 const voidFrame=frame('native:mage:B121',.6),clockFrame=frame('native:mage:B111',.6);
 assert.ok(voidFrame.geometry.some(g=>g.kind==='line'&&g.points.length===6),'void has a jagged vertical tear');
 assert.ok(clockFrame.geometry.some(g=>g.kind==='line'&&g.points.length===2&&near(g.points[0],to)),'clock has an animated hand anchored at the dial');
 assert.notDeepEqual(voidFrame.geometry,clockFrame.geometry);
 for(const id of ['native:sword:B11','native:sword:B111','native:sword:B112','native:thief:B22']){
   assert.equal(skill(id).kind,'attack');assert.ok(coreAt(frame(id,.7),to),id+': route decoration does not erase damage contact');
 }
 assert.ok(!coreAt(frame('special:skill_04_2',.7),to),'the true fountain heal has no hostile impact');
 assert.ok(!coreAt(frame('special:skill_thief_02',.7),to),'the true smoke defense has no hostile impact');
});

test('reduced motion handles almost-transparent semantic sprites and keeps one static silhouette per recipient',()=>{
 for(const id of ['special:skill_13_1','special:skill_19_2','special:skill_thief_02','native:mage:B222']){
   for(const progress of [0,.00001,.001,.5,.999,.99999,1]){
     const f=frame(id,progress,{reducedMotion:true});
     assert.ok(f.layers.length<=2&&f.geometry.length<=2,id+': unchanged reduced-motion budget');
     assert.ok(f.layers.every(l=>Number.isFinite(l.rotation)&&l.rotation===0),id+': static image');
   }
 }
});

function drawHarness({paint=false}={}){
 const draws=[],made=[],operations=[];let depth=0;
 class OffscreenCanvas{
   constructor(width,height){this.width=width;this.height=height;made.push(this);}
   getContext(){const owner=this;return{fillStyle:null,globalCompositeOperation:'source-over',
     fillRect(...args){operations.push({owner,op:'fill',color:this.fillStyle,args});},
     drawImage(image,...args){operations.push({owner,op:this.globalCompositeOperation,image,args});}};}
 }
 const ctx={canvas:paint?{ownerDocument:{defaultView:{OffscreenCanvas}}}:undefined,
   save(){depth++;},restore(){depth--;assert.ok(depth>=0);},translate(){},rotate(){},scale(){},
   beginPath(){},ellipse(){},stroke(){},moveTo(){},lineTo(){},drawImage(image,...args){draws.push({image,args});}};
 return{ctx,draws,made,operations,depth:()=>depth};
}

test('semantic sheet subjects are cropped to the correct 418px cell while original single-image companions remain whole',()=>{
 const h=drawHarness(),atlas={width:1254,height:1254},semantic={width:1254,height:1254},hawk={width:840,height:840};
 const banner=frame('special:skill_19_2',.5);drawEffectFrame(h.ctx,atlas,banner,{semantic});
 const actual=h.draws.filter(d=>d.image===semantic);assert.ok(actual.length>0);
 for(const d of actual)assert.deepEqual(d.args.slice(0,4),[418,418,418,418]);
 drawEffectFrame(h.ctx,atlas,frame('atlas:archer_beast',.5),{hawk});
 const whole=h.draws.find(d=>d.image===hawk);assert.ok(whole);assert.deepEqual(whole.args.slice(0,4),[0,0,840,840]);
 assert.equal(h.depth(),0);
});

test('blood, holy and ice colors recolor actual bitmap cells with luminance and original alpha, and reuse the bounded cache',()=>{
 const h=drawHarness({paint:true}),atlas={width:1254,height:1254};
 for(const [id,element] of [['native:sword:A1','blood'],['special:skill_09_1','holy'],['special:skill_16_2','ice']]){
   const f=frame(id,.6);assert.equal(f.recipe.semantic.element,element);
   const before=h.made.length;drawEffectFrame(h.ctx,atlas,f);assert.ok(h.made.length>before,id+': a tinted bitmap is really prepared');
   assert.ok(h.operations.some(op=>op.op==='fill'&&op.color===recipeFor(skill(id)).colors[0]),id+': material uses the requested element color');
   assert.ok(h.operations.some(op=>op.op==='luminosity'&&op.image===atlas),'paint retains source luminance');
   assert.ok(h.operations.some(op=>op.op==='destination-in'&&op.image===atlas),'paint restores the original alpha mask');
   assert.ok(h.draws.some(d=>h.made.includes(d.image)),'the real renderer draws the recolored cell');
   const ready=h.made.length;drawEffectFrame(h.ctx,atlas,f);assert.equal(h.made.length,ready,'no per-frame recoloring');
 }
 for(const s of catalog.skills)drawEffectFrame(h.ctx,atlas,buildEffectFrame(s,.6,{from,to,targets:[to]}));
 assert.ok(h.made.filter(c=>c.width>1&&c.height>1).length<=24,'the 196-profile tour cannot retain unlimited raster cells');
 assert.equal(h.depth(),0);
});

test('a semantic texture pending during clear or destroy cannot resurrect an obsolete cast',async()=>{
 for(const action of ['clear','destroy']){
   const images=[],pending=new Map();let clock=0,rafId=0;
   class Image{constructor(){this.width=this.height=1254;images.push(this);}set src(v){this.source=v;}succeed(){this.onload?.();}removeAttribute(){}}
   const h=drawHarness(),scope={Image,performance:{now:()=>clock},requestAnimationFrame:fn=>{const id=++rafId;pending.set(id,fn);return id;},cancelAnimationFrame:id=>pending.delete(id),matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};
   const doc={defaultView:scope,hidden:false,addEventListener(){},removeEventListener(){}};
   Object.assign(h.ctx,{setTransform(){},clearRect(){}});
   const canvas={width:900,height:600,clientWidth:900,clientHeight:600,ownerDocument:doc,getContext:()=>h.ctx};
   const player=createVfxPlayer(canvas,{catalog}),playing=player.play({skillId:'special:skill_13_1'});
   assert.equal(images.length,2,'class and semantic atlases load together');
   assert.ok(images.some(i=>i.source.endsWith('semantic-atlas.webp')));
   images[0].succeed();player[action]();images[1].succeed();
   const result=await playing;assert.equal(result.accepted,false);assert.equal(player.stats().active,0);assert.equal(pending.size,0);assert.equal(h.draws.length,0);
   if(action!=='destroy')player.destroy();
 }
});
