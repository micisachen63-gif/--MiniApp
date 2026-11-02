// Install an independent response-composition layer, preserving generated inputs.
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {bindScene,bindSceneHtml,bindUi,bindPreviewHtml} from './scene-preview-bindings.mjs';
const arg=/^--grok-root=(.+)$/.exec(process.argv[2]||'');if(!arg||process.argv.length!==3)throw Error('Use --grok-root=...');
const root=path.resolve(arg[1]),generated=path.join(root,'ui-generated-20261030'),bound=path.join(generated,'scene-bound-20261102'),server=path.join(generated,'serve-preview.mjs');
const inputs=['ui-generated-20261030/characters-v1/scene.js','ui-generated-20261030/characters-v1/scene.html','ui-proto/ui.js','ui-generated-20261030/preview.html'];
const original=await Promise.all(inputs.map(p=>fs.readFile(path.join(root,p),'utf8')));
// Fail before installing if the latest visual generator changed a required hook.
bindScene(original[0]);bindSceneHtml(original[1]);bindUi(original[2]);bindPreviewHtml(original[3]);
await fs.mkdir(bound,{recursive:true});await fs.copyFile('worker/tools/scene-preview-bindings.mjs',path.join(bound,'scene-preview-bindings.mjs'));
await fs.copyFile('worker/public/scene-map-preview-controls.js',path.join(generated,'progression-maps-20261102/scene-map-preview-controls.js'));
const social=path.join(generated,'hud-angels-20261102');await fs.mkdir(social,{recursive:true});
for(const file of ['atlas-talents-ui.js','atlas-talents-ui.css','atlas-progression-ui.js','scene-atlas-guide.js','scene-chat-ui.js','scene-chat-ui.css','scene-social-preview.js','scene-social-preview.css','scene-hero-readability.js','scene-hero-readability.css'])await fs.copyFile(path.join('worker/public',file),path.join(social,file));
for(const file of ['hud-angels.js','hud-angels.css','angel-good-left-v1.png','angel-fallen-right-v1.png','unified-rail-v1.png'])await fs.copyFile(path.join('worker/public/art/hud-angels-20261102',file),path.join(social,file));
let s=await fs.readFile(server,'utf8');
if(!s.includes('map(?:[1-9]|1[0-2])')){const old='(?:ui-proto|ui-generated-20261030)';if(s.split(old).length!==3)throw Error('Static allowlist changed');s=s.replaceAll(old,'(?:ui-proto|ui-generated-20261030|map(?:[1-9]|1[0-2]))');}
if(!s.includes('boundPreviewResponse')){
 const anchor='  const file=join(root,path),stat=await lstat(file),actual=await realpath(file),rel=relative(root,actual);';
 if(s.split(anchor).length!==2)throw Error('Preview server changed; refusing broad edit');
 s="import {boundPreviewResponse} from './scene-bound-20261102/scene-preview-bindings.mjs';\n"+s;
 s=s.replace(anchor,"  let bound;try{bound=await boundPreviewResponse(path,root);}catch(error){console.error(error.message);res.writeHead(500,{'content-type':'text/plain; charset=utf-8'});return res.end('Local preview bindings need review');}\n  if(bound){res.writeHead(200,{'content-type':bound.type,'cache-control':'no-store','x-content-type-options':'nosniff','x-scene-bindings':'20261102'});return res.end(bound.body);}\n"+anchor);
 const backup=path.resolve('.release-sync/scene-encounter-backups');await fs.mkdir(backup,{recursive:true});try{await fs.access(path.join(backup,'server-before-bound.mjs'));}catch{await fs.copyFile(server,path.join(backup,'server-before-bound.mjs'));}
 await fs.writeFile(server,s);
}
const hashes=[];for(let i=0;i<inputs.length;i++){const current=await fs.readFile(path.join(root,inputs[i]),'utf8');if(current!==original[i])throw Error('Visual input changed concurrently; reinstall against latest');hashes.push({file:inputs[i],sha256:createHash('sha256').update(current).digest('hex')});}
await fs.writeFile(path.resolve('.release-sync/scene-encounter-source-hashes.json'),JSON.stringify(hashes,null,2));
console.log(JSON.stringify({installed:true,generatedInputsUntouched:true,bindings:bound,restart9593Required:true}));
