// Assemble reviewed native packages only. This tool cannot open the product release gate.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {THIEF_IDENTITIES,THIEF_RELEASE_READY} from '../src/game/thief-data.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),pub=path.join(root,'worker/public');
assert.equal(THIEF_RELEASE_READY,false,'Candidate assembly must not enable production creation');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
const keyOf=c=>c.classPath?`adv${c.classPath.length}_thief_${c.classPath}_${c.gender}`:`thief_${c.gender}`;
const expected=new Map(THIEF_IDENTITIES.map(c=>[keyOf(c),c]));
const registry=await json('worker/public/hero-art-registry.json');
const legacy=Object.fromEntries(Object.entries(registry.heroes).filter(([,e])=>e.baseClass!=='thief'));
async function walk(dir){const files=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())files.push(...await walk(file));else if(entry.name==='fragment.json')files.push(file);}return files;}
const candidates=new Map([['thief_f',registry.heroes.thief_f]]);
for(const [key,entry]of Object.entries(registry.heroes))if(entry.baseClass==='thief'&&key!=='thief_f')delete registry.heroes[key];
const directories=(await fs.readdir(path.join(root,'docs/thief'),{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name.startsWith('art-'));
for(const dir of directories)for(const file of await walk(path.join(root,'docs/thief',dir.name))){const entry=JSON.parse(await fs.readFile(file,'utf8'));assert(expected.has(entry.key),'Unknown thief identity '+entry.key);assert(!candidates.has(entry.key),'Duplicate fragment '+entry.key);candidates.set(entry.key,entry);}
const receipts=[],frameHashes=new Set();
for(const [key,entry] of [...candidates].sort(([a],[b])=>a.localeCompare(b))){
 const identity=expected.get(key);assert(entry&&identity,key);assert.equal(entry.baseClass,'thief');assert.equal(entry.classPath,identity.classPath);assert.equal(entry.gender,identity.gender);assert.equal(entry.guardianCategory,'melee');
 const proof=await json(entry.provenance.packingEvidence),a=entry.animation;
 assert.equal(proof.frames.length,12);assert.equal(new Set(proof.frames.map(f=>f.rgbaSHA256)).size,12);assert(proof.nativePixelsPreserved&&proof.noUpscaling&&proof.noBackgroundEditing);
 for(const frame of proof.frames){assert(!frameHashes.has(frame.rgbaSHA256),'Cross-identity reused frame '+key);frameHashes.add(frame.rgbaSHA256);assert.equal(frame.footBaseline,600);assert(frame.nativePixelsPreserved);}
 for(const [file,digest] of Object.entries(proof.outputs)){const bytes=await fs.readFile(path.join(pub,'art/thief-20261015',key,file));assert.equal(sha(bytes),digest,key+'/'+file);}
 assert.equal(a.frames,12);assert.equal(a.cols,4);assert.equal(a.rows,3);assert.equal(a.durationMs,1000);assert.equal(a.durationsMs.reduce((n,v)=>n+v,0),1000);assert.equal(a.releaseFrameIndex,6);
 assert.equal(a.castAnchorsPx.length,12);assert(a.castAnchorsPx.every(p=>p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<640)));assert.equal(a.useAsIdle,false);
 const height=(entry.heroBounds[3]-entry.heroBounds[1])/(a.bodyBounds[3]-a.bodyBounds[1]);assert(Math.abs(height-a.heightScale)<.01,'Wrong portrait/animation height '+key);
 entry.normalFx={...entry.normalFx,kind:entry.classPath.startsWith('B')?'pierce':'dagger'};
 const skillKind=entry.classPath.startsWith('A2')?'poison':entry.classPath.startsWith('B2')?'mirror':entry.classPath.startsWith('B')?'flying':entry.classPath.startsWith('A1')?'execute':'cross';
 assert.equal(entry.skillFx.kind,skillKind,'Wrong native skill FX metadata '+key);
 const visualAccepted=entry.visualAccepted===true,runtimeAccepted=entry.actualEventVerified===true;
 // Review receipts live in docs. Keep render inputs stable when acceptance evidence is updated.
 delete entry.status;delete entry.visualAccepted;delete entry.actualEventVerified;
 registry.heroes[key]=entry;
 receipts.push({key,name:entry.name,classPath:entry.classPath,gender:entry.gender,nativePacked:true,visualAccepted,runtimeAccepted,
  guardianCategory:'melee',nativeFrames:12,entrySHA256:sha(JSON.stringify(entry)),outputs:proof.outputs,packingEvidence:entry.provenance.packingEvidence});
}
const missing=[...expected].filter(([key])=>!candidates.has(key)).map(([key,c])=>({key,name:c.name,classPath:c.classPath,gender:c.gender}));
if(process.argv.includes('--require-complete'))assert.equal(missing.length,0,'Missing '+missing.map(c=>c.key).join(','));
for(const [key,entry]of Object.entries(legacy))assert.deepEqual(registry.heroes[key],entry,'Legacy hero changed '+key);
const thiefEntries=Object.fromEntries([...candidates.keys()].sort().map(key=>[key,registry.heroes[key]]));
registry.version='20261015-thief-native-'+sha(JSON.stringify(thiefEntries)).slice(0,12);
let js=await fs.readFile(path.join(pub,'hero-art-registry.js'),'utf8');
const begin=js.indexOf('const entries=')+'const entries='.length,end=js.indexOf('\nfunction key',begin);assert(begin>12&&end>begin);assert(js.includes('RpgThiefFX.profile'),'Missing native Canvas adapter');
js=js.slice(0,begin)+JSON.stringify(registry.heroes)+';'+js.slice(end);js=js.replace(/version:'[^']+'/,"version:'"+registry.version+"'");
const report={releaseReady:false,plannedIdentities:62,registeredIdentities:receipts.length,nativePackedIdentities:receipts.length,
 visualAcceptedIdentities:receipts.filter(r=>r.visualAccepted).length,runtimeAcceptedIdentities:receipts.filter(r=>r.runtimeAccepted).length,
 completedIdentities:receipts.filter(r=>r.visualAccepted&&r.runtimeAccepted).length,existingHeroesUnchanged:Object.keys(legacy).length,
 registryVersion:registry.version,realPlayerEventsVerified:false,missing,identities:receipts};
await fs.writeFile(path.join(pub,'hero-art-registry.json'),JSON.stringify(registry,null,2)+'\n');await fs.writeFile(path.join(pub,'hero-art-registry.js'),js);
await fs.writeFile(path.join(root,'docs/thief/art-readiness.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({registryVersion:registry.version,nativePacked:receipts.length,missing:missing.length,legacyUnchanged:Object.keys(legacy).length,releaseReady:false}));
