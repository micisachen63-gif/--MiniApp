import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/star-ring-cosmetics.js',import.meta.url),'utf8');
const ids=['star_ring_aura_dawn','star_ring_aura_moon','star_ring_aura_eclipse'];
const catalogue=()=>ids.map((id,i)=>({id,name:['曙星之環','月潮星紋','星蝕王冠'][i],cost:[60,120,180][i],level:40,description:'遠征的星光'}));
const state=(overrides={})=>({ok:true,catalog:catalogue(),owned:[],equipped:null,balance:200,...overrides});
function setup(){const events=new Map(),storage=new Map();let sequence=0;const context=vm.createContext({Date,Math,console,window:{},crypto:{randomUUID:()=>String(++sequence)},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});vm.runInContext(readFileSync(new URL('../public/star-ring-gear-art.js',import.meta.url),'utf8').replace(/^export /gm,''),context);vm.runInContext(source,context);const root={isConnected:true,innerHTML:'',contains:()=>true,addEventListener:(e,f)=>events.set(e,f),removeEventListener:e=>events.delete(e)};return {ui:context.RpgStarRingCosmetics,root,events,storage};}
const flush=()=>new Promise(r=>setImmediate(r));
const click=(s,dataset)=>s.events.get('click')({target:{closest:()=>({dataset,disabled:false})}});
test('only catalog identities may draw an aura; forged URLs never enter style or item icons',()=>{const {ui}=setup();assert.equal(ui.markup({id:'../../secret',art:'https://bad.test/image'}),'');assert.equal(ui.art(ids[0]),'/art/star-ring-rewards-20261018/aura-dawn.webp');assert.match(ui.markup({id:ids[1],art:'javascript:alert(1)'}),/aura-moon.webp/);assert.doesNotMatch(ui.markup(ids[0],'<script>'),/<script>/);});
test('expedition equipment uses distinct class/slot collection art and never an umbrella chestplate or pendant',()=>{const {ui}=setup();for(const classReq of ['sword','mage','archer','thief'])for(const slot of ['helmet','armor','gloves','boots'])assert.equal(ui.gearArt({source:'star_ring',slot,classReq}),'/art/star-ring-gear-20261020/'+classReq+'-'+slot+'.webp');for(const slot of ['belt','undershirt','ring','earring'])assert.equal(ui.gearArt({source:'star_ring',slot,classReq:'any'}),'/art/star-ring-gear-20261020/shared-'+slot+'.webp');assert.equal(ui.gearArt({source:'elite',slot:'helmet',classReq:'archer'}),null);assert.equal(ui.gearArt({source:'star_ring',slot:'weapon',classReq:'mage',kind:'wand'}),'/art/star-ring-gear-20261020/weapon-wand.webp');assert.equal(ui.gearArt({source:'star_ring',slot:'helmet',classReq:'unknown'}),null);assert.equal(ui.itemArt('blessed_scroll_w'),'/art/items-scrolls-cutout-20261011/blessed_scroll_w.webp');});

test('armory and short-party containment keeps the complete foot-ring above the stage edge while preview geometry stays unchanged',()=>{
 const {ui}=setup(),container={getBoundingClientRect:()=>({left:0,top:0,width:180,height:200})},image={naturalWidth:200,naturalHeight:200,getBoundingClientRect:()=>({left:0,top:0,width:180,height:200})};
 const preview=ui.placement(image,container),fitted=ui.placement(image,container,{contain:true});
 assert.ok(preview.top+preview.height/2>200,'raw centered-foot preview would cross a clipped stage');
 assert.ok(fitted.top+fitted.height/2<=196,'bottom sparkles remain within the four-pixel stage margin');
 assert.ok(fitted.top-fitted.height/2>=4);assert.ok(fitted.left-fitted.width/2>=4);assert.ok(fitted.left+fitted.width/2<=176);
 assert.ok(Math.abs(fitted.width/fitted.height-2)<1e-9,'authored 2:1 star-ring proportions stay intact');
 assert.equal(ui.placement(image,container).top,preview.top,'opt-in stage containment never moves wardrobe previews');
 const node={style:{}};ui.position(node,image,container,{contain:true});assert.equal(node.style.top,fitted.top+'px');
});


test('wide armory portrait bounds do not inflate the ring into a knee-high circle',()=>{
 const {ui}=setup(),container={getBoundingClientRect:()=>({left:0,top:0,width:500,height:490})},image={naturalWidth:600,naturalHeight:600,getBoundingClientRect:()=>({left:0,top:0,width:500,height:490})};
 const standard=ui.placement(image,container,{contain:true}),armory=ui.placement(image,container,{contain:true,maxWidthRatio:.52,maxHeightRatio:.6});
 assert.ok(standard.width>armory.width*1.8,'test recreates the wide full-body portrait box');
 assert.equal(armory.width,260);assert.equal(armory.height,130);assert.ok(armory.top>=420,'smaller aura stays beside the feet instead of being lifted toward knees');assert.ok(armory.top+armory.height/2<=486);
 assert.equal(ui.placement(image,container).width,588,'wardrobe and five-player default sizing is unchanged');
});
