import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {THIEF_IDENTITIES} from '../src/game/thief-data.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),pub=root+'/worker/public';
const qa=JSON.parse(await fs.readFile(root+'/docs/thief/pilot-native-pack.json'));
const registry=JSON.parse(await fs.readFile(pub+'/hero-art-registry.json'));
const prefix='art/thief-20261015/thief_f/',url=name=>prefix+name+'?v='+qa.outputs[name].slice(0,12);
const normalized=b=>b.map(v=>v/qa.cellSize),boxes=qa.frames.map(f=>normalized(f.alphaBounds));
const union=[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
const rawAnchors=[[374,287],[918,303],[1412,253],[373,646],[938,656],[1384,699],[246,150],[650,171],[1317,187],[338,643],[832,662],[1408,789]];
const anchors=qa.frames.map((f,i)=>[rawAnchors[i][0]-f.sourceRect[0]+f.translation[0],rawAnchors[i][1]-f.sourceRect[1]+f.translation[1]]);
const old=new Map(Object.entries(registry.heroes).filter(([key])=>!key.includes('thief')).map(([key,value])=>[key,JSON.stringify(value)]));
registry.heroes.thief_f={key:'thief_f',name:'盜賊・女',baseClass:'thief',classPath:'',gender:'f',
 hero:url('hero.png'),portrait:url('portrait.png'),heroBounds:qa.heroBounds.map((v,i)=>v/qa.heroDimensions[i%2]),
 heroMeta:{fig:qa.heroBounds.map((v,i)=>v/qa.heroDimensions[i%2])},
 animation:{src:url('character.webp'),png:url('character.png'),cols:4,rows:3,firstFrame:0,totalFrames:12,frames:12,cellWidth:640,cellHeight:640,
  durationMs:1000,durationsMs:[100,70,70,65,65,70,90,80,80,90,110,110],frameBounds:union,frameBoundsPerFrame:boxes,
  frameFig:[.253125,.225,.7484375,.9375],bodyBounds:[.253125,.225,.7484375,.9375],footBaseline:600,
  neutralBodyBoundsPx:[162,144,479,600],heightScale:(qa.heroBounds[3]-qa.heroBounds[1])/qa.heroDimensions[1]/((600-144)/640),useAsIdle:false,
  releaseFrameIndex:6,releaseAtMs:440,castAnchorsPx:anchors,castAnchorRole:'active-dagger-hand',
  castAnchorMethod:'Manual native hand coordinates, translated without resampling; verify impact in runtime pilot.',
  nativePixelsPreserved:true,authoredEffects:true,preservePlacement:true},
 normalFx:{renderer:'thief-native-canvas',kind:'dagger',durationMs:360},skillFx:{renderer:'thief-native-canvas',kind:'cross',durationMs:560},
 guardianCategory:'melee',status:'pilot-native-packed',visualAccepted:false,actualEventVerified:false,
 provenance:{generator:'built-in image_gen',nativePacking:'worker/scripts/pack-thief-pilot.py',sourceSHA256:qa.sources,packingEvidence:'docs/thief/pilot-native-pack.json'}};
for(const [key,value]of old)assert.equal(JSON.stringify(registry.heroes[key]),value,'Existing hero changed '+key);
const version='20261015-thief-pilot-'+createHash('sha256').update(JSON.stringify(registry.heroes.thief_f)).digest('hex').slice(0,12);
registry.version=version;await fs.writeFile(pub+'/hero-art-registry.json',JSON.stringify(registry,null,2)+'\n');
let js=await fs.readFile(pub+'/hero-art-registry.js','utf8');
const start=js.indexOf('const entries=')+'const entries='.length,end=js.indexOf('\nfunction key',start);assert(start>12&&end>start);
js=js.slice(0,start)+JSON.stringify(registry.heroes)+';'+js.slice(end);
js=js.replace("['sword','archer','mage'].includes(base)","['sword','archer','mage','thief'].includes(base)");
const previousFx="function fx(k,kind){const r=get(k);return r?(kind==='normal'?r.normalFx:kind==='skill'?r.skillFx:null):null;}";
const newFx="function fx(k,kind){const r=get(k);if(!r)return null;const spec=kind==='normal'?r.normalFx:kind==='skill'?r.skillFx:null;if(r.baseClass!=='thief'||!spec)return spec;return{...spec,draw:(g,p,from,to,e={})=>window.RpgThiefFX?.draw(g,p,from,to,window.RpgThiefFX.profile(e.label||e.skillName||'',r.classPath,{basic:kind==='normal'}))};}";
if(js.includes(previousFx))js=js.replace(previousFx,newFx);else assert(js.includes(newFx),'Unexpected FX adapter drift');
js=js.replace(/version:'[^']+'/,"version:'"+version+"'");await fs.writeFile(pub+'/hero-art-registry.js',js);
await fs.writeFile(root+'/docs/thief/art-readiness.json',JSON.stringify({releaseReady:false,plannedIdentities:62,registeredPilot:'thief_f',completedIdentities:0,
 nativePackedIdentities:1,visualAndRuntimeReviewPending:true,missing:THIEF_IDENTITIES.filter(e=>!(e.gender==='f'&&!e.classPath)),
 existingHeroesUnchanged:old.size,registryVersion:version,realPlayerEventsVerified:false},null,2)+'\n');
console.log(JSON.stringify({version,existingHeroesUnchanged:old.size,pilotFrames:12,releaseReady:false}));
