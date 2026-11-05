#!/usr/bin/env node
/**
 * Replay unmodified descriptors from the real resolver fixture through the real
 * legacy planner/player. This is deterministic presentation evidence, not live
 * gameplay or browser-pixel evidence; its geometry is deliberately controlled.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { legacySurface, geometryFor } from '../test/skill-vfx-legacy-harness.js';
import { validateLegacyDescriptor } from '../public/skill-vfx-legacy.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const inputPath='.release-sync/skill-vfx-20261104/legacy-coverage-events.json';
const outputPath='.release-sync/skill-vfx-20261104/legacy-coverage-presentation.json';
const read=path=>readFileSync(resolve(root,path));
const sha=path=>createHash('sha256').update(read(path)).digest('hex');
const fixture=JSON.parse(read(inputPath)),catalog=JSON.parse(read('worker/public/skill-vfx-catalog.json'));
const skills=catalog.skills.filter(skill=>['native','special'].includes(skill.system));
const failures=[],cases=[],selected=[];
if(fixture.status!=='passed')failures.push({reason:'resolver-fixture-not-passed',status:fixture.status});
for(const source of fixture.sourceFiles||[]){
 try{if(sha(source.path)!==source.sha256)failures.push({reason:'stale-resolver-source',path:source.path});}
 catch(error){failures.push({reason:'missing-resolver-source',path:source.path,message:error.message});}
}
for(const skill of skills){
 const candidate=(fixture.cases||[]).filter(row=>row.id===skill.id).map(row=>({row,raw:(row.events||[]).find(raw=>raw.skillId===skill.id&&raw.kind==='cast')})).find(candidate=>candidate.raw);
 if(!candidate){failures.push({id:skill.id,reason:'no-real-resolver-cast'});continue;}
 const validation=validateLegacyDescriptor(candidate.raw,catalog);
 if(!validation.accepted){failures.push({id:skill.id,reason:validation.reason});continue;}
 selected.push(candidate);
}
const surface=legacySurface(),layer=await surface.create({catalog,mode:'party',contextKey:'resolver-presentation-check'});
await layer.prepare(selected.map(row=>row.raw));
try{
 for(const {row,raw}of selected){
  const saved=JSON.stringify(raw),before=surface.drawCalls(),geometry=geometryFor(raw);
  const result=await layer.play(raw,geometry);surface.advance(170);
  const draws=surface.drawCalls()-before,stats=layer.stats();
  if(!result.accepted||draws<=0||JSON.stringify(raw)!==saved){
   failures.push({id:row.id,reason:result.reason||'no-draw-or-mutated-receipt',draws});layer.clear('next-identity');continue;
  }
  cases.push({id:row.id,mode:row.mode,evidenceKind:'presentation',sourceEvidenceKind:row.evidenceKind,
   rendererMode:'party',geometryEvidence:'controlled-test-surface',events:[raw],
   accepted:true,playerCalls:stats.lastEvent.commands,drawCalls:draws,durationMs:result.durationMs,
   remainingMs:result.remainingMs,presentationMode:raw.presentationMode,source:raw.source});
  layer.clear('next-identity');
 }
}finally{layer.destroy();}
const sourcePaths=[inputPath,'worker/public/skill-vfx-catalog.json','worker/public/skill-vfx-engine.mjs', 'worker/public/skill-vfx-semantics.mjs', 'worker/public/art/skill-vfx-20261104/semantic-atlas.webp',
 'worker/public/skill-vfx-legacy.mjs','worker/test/skill-vfx-legacy-harness.js',
 'worker/tools/skill-vfx-legacy-presentation-check.mjs'];
const byPresentationMode={},bySourceMode={};
for(const row of cases){byPresentationMode[row.presentationMode]=(byPresentationMode[row.presentationMode]||0)+1;bySourceMode[row.mode]=(bySourceMode[row.mode]||0)+1;}
const result={schemaVersion:1,status:failures.length||cases.length!==184?'failed':'passed',generatedAt:new Date().toISOString(),
 scope:'Unmodified real resolver descriptors -> canonical legacy planner -> actual createVfxPlayer Canvas commands. Controlled geometry; does not claim browser pixels or five-mode gameplay.',
 sourceFiles:sourcePaths.map(path=>({path,sha256:sha(path)})),resolverSourceFiles:fixture.sourceFiles||[],
 cases,failures,summary:{expectedIdentities:184,acceptedIdentities:cases.length,drawCalls:cases.reduce((n,row)=>n+row.drawCalls,0),
  byPresentationMode,bySourceMode,destroyed:layer.stats().destroyed,activeAfterDestroy:layer.stats().player.active,rafAfterDestroy:surface.rafCount()}};
mkdirSync(dirname(resolve(root,outputPath)),{recursive:true});
writeFileSync(resolve(root,outputPath),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({path:outputPath,status:result.status,summary:result.summary,failures},null,2));
if(result.status!=='passed')process.exitCode=1;
