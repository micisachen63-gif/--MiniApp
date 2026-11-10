// Deterministic, local-only publication of the reviewed scene. Original artwork
// is copied byte-for-byte; no production API or database is contacted here.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {boundPreviewInputPaths,boundPreviewResponse} from './scene-preview-bindings.mjs';
import {withEntryGate} from './entry-gate-html.mjs';
import {collectReleaseAssets} from './scene-release-assets.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const publicRoot = path.join(repo,'worker/public');
const args = Object.fromEntries(process.argv.slice(2).map(arg=>{const m=/^--(source-root|index-sha|renderer-sha)=(.+)$/.exec(arg);if(!m)throw Error('Use --source-root=... --index-sha=... --renderer-sha=...');return [m[1],m[2]];}));
if(!args['source-root']||![args['index-sha'],args['renderer-sha']].every(x=>/^[a-f0-9]{64}$/.test(x||'')))throw Error('Reviewed source root and exact catalog/renderer hashes required');
const sourceRoot = await fs.realpath(args['source-root']);
const sha = data=>createHash('sha256').update(data).digest('hex');
const inside = (root,file)=>{const r=path.relative(root,file);return r!== '..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
const entries = new Map(), previousFile = path.join(publicRoot,'scene-production-manifest.json');
const composedPaths = new Set(boundPreviewInputPaths().map(x=>x.requestPath));
let previous={};try{previous=JSON.parse(await fs.readFile(previousFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const old = new Map((previous.entries||[]).map(x=>[x.url,x]));
async function bytes(root,relative){const file=await fs.realpath(path.join(root,relative));if(!inside(root,file))throw Error('Source escapes declared root: '+relative);const before=await fs.stat(file);if(!before.isFile()||before.size>25*1024*1024)throw Error('Invalid static file: '+relative);const data=await fs.readFile(file),after=await fs.stat(file);if(before.mtimeMs!==after.mtimeMs||before.size!==after.size)throw Error('Source changed during packaging: '+relative);return data;}
async function write(url,data,kind,source=null){
 if(!url.startsWith('/')||url.includes('?')||url.includes('#'))throw Error('Invalid published URL');
 const file=path.resolve(publicRoot,'.'+url);if(!inside(publicRoot,file))throw Error('Destination escapes public root');
 const hash=sha(data),entry={url,bytes:data.length,sha256:hash,kind,...(source?{source}: {})};
 if(entries.has(url)){if(entries.get(url).sha256!==hash)throw Error('Conflicting runtime alias: '+url);return;}
 let current;try{current=await fs.readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(current&&!current.equals(data)&&kind==='original'&&url.startsWith('/ui-generated-20261030/characters-v1/assets/'))throw Error('Immutable character artwork needs a new versioned URL: '+url);
 if(current&&!current.equals(data)&&sha(current)!==old.get(url)?.sha256)throw Error('Refusing to overwrite an unowned public file: '+url);
 if(!current||!current.equals(data)){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data);if(sha(await fs.readFile(file))!==hash)throw Error('Written file hash mismatch: '+url);}
 entries.set(url,entry);
}
async function copy(relative,url='/'+relative,root=sourceRoot,kind='original'){if(composedPaths.has(url))return;await write(url,await bytes(root,relative),kind,relative);}
const indexRelative='ui-generated-20261030/characters-v1/character-preview-index.json';
const rendererRelative='ui-generated-20261030/characters-v1/character-sprites.js';
const indexBytes=await bytes(sourceRoot,indexRelative),rendererBytes=await bytes(sourceRoot,rendererRelative);
if(sha(indexBytes)!==args['index-sha']||sha(rendererBytes)!==args['renderer-sha'])throw Error('Character catalog/renderer changed since review');
const index=JSON.parse(indexBytes),ids=new Set();
if(index.actors?.length!==248)throw Error('Expected all 248 original appearances');
const requested = new Set();
function urls(value){if(Array.isArray(value))value.forEach(urls);else if(value&&typeof value==='object')Object.values(value).forEach(urls);else if(typeof value==='string'&&value.startsWith('/ui-generated-20261030/')){const u=new URL(value,'http://assets.invalid');if(/\.(json|png|webp|jpg|js|css)$/.test(u.pathname))requested.add(u.pathname);}}
for(const ref of index.actors){
 if(ids.has(ref.id))throw Error('Duplicate appearance');ids.add(ref.id);
 const url=new URL(ref.actorUrl,'http://assets.invalid');if(url.origin!=='http://assets.invalid'||!url.pathname.startsWith('/ui-generated-20261030/characters-v1/'))throw Error('Invalid actor reference');
 const actor=JSON.parse(await bytes(sourceRoot,url.pathname.slice(1)));if(actor.id!==ref.id)throw Error('Actor identity mismatch');
 for(const a of ['idle','walk','attack','death'])for(const d of ['up','down','right','left'])if(!actor.clips?.[a]?.[d]?.frames?.length)throw Error('Incomplete actor: '+ref.id+' '+a+'.'+d);
 urls(ref.actorUrl);urls(actor);
}
requested.add('/'+indexRelative);requested.add('/'+rendererRelative);
for(const url of [...requested].sort())await copy(url.slice(1),url);
const staticTypes=/\.(?:html|js|mjs|css|json|png|webp|jpe?g|svg|woff2?|ttf|wasm)$/i;
async function tree(relative){const folder=path.join(sourceRoot,relative);for(const e of await fs.readdir(folder,{withFileTypes:true})){const r=relative+'/'+e.name;if(e.isSymbolicLink())throw Error('Source symlink is not publishable: '+r);if(e.isDirectory())await tree(r);else if(staticTypes.test(e.name))await copy(r);}}
// The runtime uses the small index and individual actor JSONs above. Historical
// all-in-one review catalogs exceed static-file limits and are never fetched.
for(const e of await fs.readdir(path.join(sourceRoot,'ui-generated-20261030/characters-v1'),{withFileTypes:true}))if(e.isFile()&&/\.js$/.test(e.name))await copy('ui-generated-20261030/characters-v1/'+e.name);
for(const dir of ['ui-proto','ui-generated-20261030/hud-v2','ui-generated-20261030/progression-maps-20261102',...Array.from({length:12},(_,i)=>'map'+(i+1))])await tree(dir);
for(const name of ['preview.css','hud-v2.css','orb-frame-dark-v1.png','function-icons-sheet-dark-v1.png','dark-ui.css'])await copy('ui-generated-20261030/'+name);

const social='/ui-generated-20261030/hud-angels-20261102/';
// These are identical aliases of the committed UI modules, not separate clients.
for(const e of await fs.readdir(publicRoot,{withFileTypes:true}))if(e.isFile()&&/\.(?:js|css)$/.test(e.name))await copy(e.name,social+e.name,publicRoot,'alias');
for(const name of ['hud-angels.js','hud-angels.css','angel-good-left-v1.png','angel-fallen-right-v1.png','unified-rail-v1.png'])await copy('art/hud-angels-20261102/'+name,social+name,publicRoot,'alias');
const config='<script src="'+social+'monster-expansion-catalog.js"></script><script>window.__RpgScenePreviewConfig={live:true,telegram:true,sceneOrigin:location.origin,endpoint:location.origin+"/app/api/"};</script>';
const sdk='<script src="https://telegram.org/js/telegram-web-app.js?57"></script>';
for(const input of boundPreviewInputPaths()){
 let {body}=await boundPreviewResponse(input.requestPath,sourceRoot);
 if(input.type.startsWith('text/html')){
  body=body.replace('<head>','<head>'+config);
  body=body.replace(/<title>[^<]*<\/title>/,'<title>星穹旅誌</title>');
  if(input.requestPath.endsWith('/scene.html')){
   body=body.replace('<script src="'+social+'scene-live-session.js"></script>','$&<script src="'+social+'scene-live-auth.js"></script>');
   body=body.replace('<script src="'+social+'scene-social-preview.js"></script>','<script src="'+social+'scene-window-manager.js"></script>$&');
  }else{
   body=body.replace('<head>','<head>'+sdk);
   body=body.replace(/<aside class="test-controls">[\s\S]*?<\/aside>/,'<aside class="test-controls" hidden inert><button id="show" hidden></button><div id="controls" hidden><input id="hp" value="0"><output id="hpValue"></output><input id="mp" value="0"><output id="mpValue"></output><button id="compare"></button></div></aside>');
   body=body.replace('title="2D 人物與 HUD 本機預覽"','title="星穹旅誌冒險"');
  }
 }
 if(!old.has(input.requestPath))old.set(input.requestPath,{sha256:sha(await bytes(sourceRoot,input.relativePath))});
 await write(input.requestPath,Buffer.from(body),'composed',input.relativePath);
}
const classic=path.join(publicRoot,'classic.html');
try{await fs.access(classic);}catch(e){if(e.code!=='ENOENT')throw e;const legacy=await fs.readFile(path.join(publicRoot,'index.html'));if(!legacy.includes(Buffer.from('src="app.js')))throw Error('Original classic entry not found');await fs.writeFile(classic,legacy);}
const main=entries.get('/ui-generated-20261030/preview.html');
// index.html is the one deliberate entrypoint replacement. Its original bytes
// are retained as classic.html; any later rebuild is guarded by the manifest.
if(!old.has('/index.html'))old.set('/index.html',{sha256:sha(await fs.readFile(path.join(publicRoot,'index.html')))});
// The restored classic splash and 選擇角色 layer (entry-gate.js) opens the scene.
await write('/index.html',Buffer.from(withEntryGate(await fs.readFile(path.join(publicRoot,'.'+main.url),'utf8'))),'entrypoint');
// Bind the generated choreography sidecar when it belongs to this exact catalog.
// First build copies reviewed sources; generate policies, then build once more.
try{
 const policyBytes=await fs.readFile(path.join(publicRoot,'scene-native-cast-profiles.json')),policy=JSON.parse(policyBytes);
 if(policy.catalogSha256===args['index-sha'])entries.set('/scene-native-cast-profiles.json',{url:'/scene-native-cast-profiles.json',bytes:policyBytes.length,sha256:sha(policyBytes),kind:'choreography',source:'packaged-character-clips'});
}catch(error){if(error.code!=='ENOENT')throw error;}
// Versioned item/button art joins the same hash-bound release inventory (see scene-release-assets.mjs).
for(const entry of await collectReleaseAssets(publicRoot))entries.set(entry.url,entry);
const inventory=[];async function scan(folder){for(const e of await fs.readdir(folder,{withFileTypes:true})){const p=path.join(folder,e.name);if(e.isSymbolicLink())throw Error('Public symlink: '+p);if(e.isDirectory())await scan(p);else{const size=(await fs.stat(p)).size;if(size>25*1024*1024)throw Error('Public asset exceeds 25 MiB: '+p);inventory.push(p);}}}await scan(publicRoot);
if(inventory.length+1>20000)throw Error('Public inventory exceeds conservative 20,000 file ceiling');
const manifest={schemaVersion:1,reviewedCatalogSha256:args['index-sha'],reviewedRendererSha256:args['renderer-sha'],appearances:248,populatedSlots:3968,sourceWritten:false,sourcePixelsModified:false,finalArtApprovalPromoted:false,publicFileCount:inventory.length+Number(!inventory.includes(previousFile)),entries:[...entries.values()].sort((a,b)=>a.url.localeCompare(b.url))};
await fs.writeFile(previousFile,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({appearances:248,slots:3968,packagedFiles:entries.size,packagedBytes:[...entries.values()].reduce((n,e)=>n+e.bytes,0),publicFiles:manifest.publicFileCount,sourceWritten:false}));
