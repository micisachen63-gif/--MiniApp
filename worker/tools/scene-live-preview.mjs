// Read-only composition of the current art source, paired with disposable Atlas data.
// node worker/tools/scene-live-preview.mjs --grok-root=D:/StarJournal/grok-assets
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
let bindingVersion='',currentBindings=null,pinnedBoundInputs=null;
async function composeResponse(requestPath,grokRoot){
 if(pinnedBoundInputs)return pinnedBoundInputs.get(requestPath)||null;
 const source=fileURLToPath(new URL('./scene-preview-bindings.mjs',import.meta.url));
 const stat=await fs.stat(source),version=stat.mtimeMs+':'+stat.size;
 if(version!==bindingVersion){currentBindings=await import(pathToFileURL(source).href+'?v='+encodeURIComponent(version));bindingVersion=version;}
 return currentBindings.boundPreviewResponse(requestPath,grokRoot);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..'), publicRoot = path.resolve(here, '../public');
const args = new Map();
for (const value of process.argv.slice(2)) {
  const match = /^--(grok-root|port|api-port|qa-input-snapshot-dir|attach-api-pid|qa-attach-state|qa-reuse-input-snapshot-dir|qa-attach-check)=(.+)$/.exec(value);
  if (!match || args.has(match[1])) throw Error('Use --grok-root=... [--port=9653] [--api-port=9652] [--qa-input-snapshot-dir=.release-sync/owned-run]');
  args.set(match[1], match[2]);
}
if (!args.has('grok-root')) throw Error('A local --grok-root is required');
const grokRoot = await fs.realpath(path.resolve(args.get('grok-root')));
const port = Number(args.get('port') || 9653), apiPort = Number(args.get('api-port') || 9652);
for (const number of [port, apiPort]) if (!Number.isInteger(number) || number < 1024 || number > 65535) throw Error('Invalid loopback port');
if (port === apiPort) throw Error('The scene and API need separate ports');

const guardianQA=process.env.RPG_GUARDIAN_QA==='1',fateQA=process.env.RPG_FATE_QA==='1',snapshotArgument=args.get('qa-input-snapshot-dir');
const attachPidArgument=args.get('attach-api-pid'),reuseArgument=args.get('qa-reuse-input-snapshot-dir'),attachStateArgument=args.get('qa-attach-state'),attachCheck=args.get('qa-attach-check');
if(guardianQA&&fateQA)throw Error('Only one isolated QA fixture mode may be enabled');
if(snapshotArgument&&!guardianQA&&!fateQA)throw Error('The QA input snapshot requires RPG_GUARDIAN_QA=1 or RPG_FATE_QA=1 and explicit --qa-input-snapshot-dir');
if((guardianQA||fateQA)&&!snapshotArgument&&!reuseArgument)throw Error('An isolated QA fixture requires explicit --qa-input-snapshot-dir or validated reuse');
if(snapshotArgument&&reuseArgument)throw Error('Capture and reuse are mutually exclusive');
if(attachPidArgument||reuseArgument||attachStateArgument||attachCheck){
 if(!fateQA||guardianQA||!attachPidArgument||!reuseArgument||!attachStateArgument||snapshotArgument||attachCheck&&attachCheck!=='1')throw Error('Existing API attach requires Fate-only mode, expected PID/state and immutable snapshot reuse');
 if(!/^[1-9][0-9]*$/.test(attachPidArgument)||!Number.isSafeInteger(Number(attachPidArgument)))throw Error('Invalid expected isolated API PID');
 for(const flag of ['RPG_STAR_RING_QA','RPG_BOSS_QA','RPG_TOWER_QA','RPG_PARTY_QA','RPG_SKILL_CAREER_QA'])if(process.env[flag]==='1')throw Error('Existing API attach forbids other QA modes');
}
const digest=value=>createHash('sha256').update(value).digest('hex');
async function ownedEvidencePath(argument,directory=false){
 const evidenceRoot=await fs.realpath(path.join(repo,'.release-sync')),target=await fs.realpath(path.resolve(repo,argument)),stat=await fs.stat(target);
 if(!within(repo,evidenceRoot)||target===evidenceRoot||!within(evidenceRoot,target)||(directory?!stat.isDirectory():!stat.isFile()))throw Error('Existing QA evidence escaped this worktree');
 return target;
}
const apiOrigin='http://127.0.0.1:'+apiPort;
const stateIdentity=value=>JSON.stringify({initialInputSha256:value.initialInputSha256,primary:value.primary,alternate:value.alternate,fixtures:value.fixtures,seasonFixtures:value.seasonFixtures,now:value.qaClock?.now,commandInFlight:value.commandInFlight,commands:value.commands,databases:value.databases,permanent:value.permanent,season:value.season,lifeTiming:value.lifeTiming});

// Bootstrap attach is a separate, explicit campaign intent. A missing life is
// never interpreted as permission to restart an existing nonempty campaign.
function requireEmptyFateCampaign(expected,state){
 if(expected.schemaVersion!==1||expected.status!=='preserve-empty-fate-api'||expected.kind!=='empty-fate-campaign'||typeof expected.campaignId!=='string'||!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(expected.campaignId)||Object.hasOwn(expected,'originalLife')||!/^[a-f0-9]{64}$/.test(expected.initialInputSha256||'')||expected.initialInputSha256!==state?.initialInputSha256)throw Error('Incomplete empty Fate campaign intent');
 if(!state||state.syntheticInitialInputOnly!==true||state.noSeededLifeGiftOrReceipt!==true||state.noDispatcher!==true||state.realNotificationsSent!==false||state.initialInputs?.fixtureOnly!==true||state.initialInputs?.notAReceipt!==true||state.commandInFlight!==null||!Array.isArray(state.commands)||state.commands.length||!Array.isArray(state.lifeTiming)||state.lifeTiming.length||!Number.isSafeInteger(state.seededAt)||state.seededAt<=0||state.qaClock?.now!==state.seededAt)throw Error('Empty Fate campaign requires unchanged initial inputs and clock');
 const clock=state.qaClock;
 if(clock.mode!=='manual-development-clock'||clock.debugOnly!==true||clock.lifeMs!==7200000||clock.choiceMs!==90000||clock.automaticFateSweep!==false||clock.deadlinesUnmodified!==true||clock.nightPause!=='00:00-06:00 Asia/Taipei')throw Error('Empty Fate campaign changed original timing');
 if(!state.primary||!state.alternate||!Array.isArray(state.fixtures)||!state.fixtures.length||!Array.isArray(state.seasonFixtures)||!state.seasonFixtures.length)throw Error('Empty Fate campaign needs exact fixture actors');
 const tables=['rpg_fate_lives','rpg_fate_starts','rpg_fate_memorials','rpg_fate_operations','rpg_fate_gifts','rpg_fate_gift_operations','rpg_fate_profiles','rpg_fate_daily','rpg_fate_social_choices','rpg_fate_social_limits','rpg_fate_social_locks','rpg_fate_social_operations','rpg_fate_social_pairs','rpg_fate_social_preferences'];
 for(const realm of ['permanent','season']){
  const raw=state[realm],database=state.databases?.[realm],counts=database?.counts;
  if(!raw||['lives','starts','memorials','operations','gifts','giftOperations','social'].some(key=>!Array.isArray(raw[key])||raw[key].length))throw Error('Empty Fate campaign already has original '+realm+' outcomes');
  if(!counts||!Array.isArray(database.tableNames)||tables.some(name=>!database.tableNames.includes(name)||counts[name]!==0)||Object.entries(counts).some(([name,count])=>name.startsWith('rpg_fate_')&&count!==0))throw Error('Empty Fate campaign has nonempty or missing '+realm+' Fate tables');
  if(!Array.isArray(raw.ledger)||raw.ledger.some(row=>['命運場景操作收據','輪迴贈禮','開啟輪迴禮','星輝匣獎勵'].includes(row.type)||String(row.event_id||'').startsWith('fate-')))throw Error('Empty Fate campaign already has '+realm+' Fate receipts');
  if(!Array.isArray(raw.outbox)||raw.outbox.some(row=>/^fate(?:_|-)/.test(String(row.kind||''))))throw Error('Empty Fate campaign already has '+realm+' Fate delivery rows');
 }
}
let attachedApi=null,attachExpected=null;
if(attachPidArgument){
 const statePath=await ownedEvidencePath(attachStateArgument),stateBytes=await fs.readFile(statePath);
 attachExpected=JSON.parse(stateBytes);
 const emptyCampaign=attachExpected.kind==='empty-fate-campaign';
 if(emptyCampaign){
  if(attachExpected.apiPid!==Number(attachPidArgument)||attachExpected.apiOrigin!==apiOrigin)throw Error('Empty Fate campaign API identity differs');
  requireEmptyFateCampaign(attachExpected,attachExpected.state);
 }else{
  if(Object.hasOwn(attachExpected,'kind'))throw Error('Unknown Fate API preservation kind');
 if(attachExpected.schemaVersion!==1||attachExpected.status!=='preserve-exact-fate-api'||attachExpected.apiPid!==Number(attachPidArgument)||attachExpected.apiOrigin!==apiOrigin||!attachExpected.state||!attachExpected.originalLife)throw Error('Incomplete original Fate API preservation intent');
 }
 const read=async endpoint=>{const response=await fetch(apiOrigin+endpoint,{redirect:'error',signal:AbortSignal.timeout(10000)});if(response.status!==200)throw Error('Existing API refused read-only inspection');return response.json();};
 const [health,state]=await Promise.all([read('/__preview/health'),read('/__preview/fate-qa/state')]);
 if(health.pid!==Number(attachPidArgument)||health.isolated!==true||health.ephemeral!==true||health.productionAccess!==false||health.fateQa!==true||['guardianQa','starRingQa','bossQa','towerQa','partyQa','skillCareerQa'].some(key=>health[key]!==false))throw Error('Existing API identity or isolation differs');
 if(health.qaClock?.mode!=='manual-development-clock'||health.qaClock.lifeMs!==7200000||health.qaClock.choiceMs!==90000||health.qaClock.automaticFateSweep!==false||health.qaClock.deadlinesUnmodified!==true||health.qaClock.nightPause!=='00:00-06:00 Asia/Taipei')throw Error('Existing API changed original Fate timing');
 if(state.isolated!==true||state.ephemeral!==true||state.productionAccess!==false||state.commandInFlight!==null||stateIdentity(state)!==stateIdentity(attachExpected.state))throw Error('Original fixture, actors, both databases, clock or life rows changed');
 if(emptyCampaign){
  requireEmptyFateCampaign(attachExpected,state);
  if(health.qaClock.now!==state.qaClock.now)throw Error('Empty Fate campaign clock changed during inspection');
  attachedApi={pid:health.pid,statePath,stateSha256:digest(stateBytes),fixtureInitialInputSha256:state.initialInputSha256,clockNow:state.qaClock.now,kind:'empty-fate-campaign',campaignId:attachExpected.campaignId,originalLifeId:null,read};
 }else{
 const original=attachExpected.originalLife,life=state.permanent.lives.find(row=>row.id===original.id),operation=state.permanent.operations.find(row=>row.request_id==='scene:app:'+original.startRequestId);
 if(original.realmId!=='permanent'||!life||String(life.char_id)!==original.characterId||String(life.account_id)!==original.accountId||JSON.stringify(state.primary)!==JSON.stringify(attachExpected.state.primary)||!operation||String(operation.account_id)!==original.accountId||JSON.parse(operation.result_json).lifeId!==original.id)throw Error('Existing API no longer contains the exact original start authority');
 attachedApi={pid:health.pid,statePath,stateSha256:digest(stateBytes),fixtureInitialInputSha256:state.initialInputSha256,clockNow:state.qaClock.now,originalLifeId:original.id,read};
 }
}
let generatedInputSnapshot={mode:'dynamic',scope:'Composed generated text is read dynamically; no generated inputs are frozen.'};
if(reuseArgument){
 const destination=await ownedEvidencePath(reuseArgument,true),manifestPath=await realFile(destination,'manifest.json'),manifestBytes=await fs.readFile(manifestPath),manifest=JSON.parse(manifestBytes);
 const source=fileURLToPath(new URL('./scene-preview-bindings.mjs',import.meta.url)),binderSha256=digest(await fs.readFile(source)),bindings=await import(pathToFileURL(source).href),expected=bindings.boundPreviewInputPaths();
 if(manifest.schemaVersion!==1||manifest.status!=='passed'||manifest.sourceCount!==9||manifest.sources?.length!==9||manifest.binderSha256!==binderSha256||manifest.sourceRootWritten!==false||manifest.changed?.length!==0||manifest.bindingErrors?.length!==0||JSON.stringify(manifest.sources.map(({requestPath,relativePath,type})=>({requestPath,relativePath,type})))!==JSON.stringify(expected))throw Error('Original nine-input snapshot manifest is invalid');
 if(attachExpected.inputSnapshotId!==manifest.id||attachExpected.inputSnapshotManifestSha256!==digest(manifestBytes))throw Error('Snapshot differs from the original running fixture');
 const id=digest(JSON.stringify({binderSha256,sources:manifest.sources.map(({requestPath,relativePath,sha256,boundSha256})=>({requestPath,relativePath,sha256,boundSha256}))}));
 if(manifest.id!==id)throw Error('Snapshot identity hash differs');
 const rawRoot=await fs.realpath(path.join(destination,'raw')),boundRoot=await fs.realpath(path.join(destination,'bound'));
 if(!within(destination,rawRoot)||!within(destination,boundRoot))throw Error('Snapshot directory escaped owned evidence');
 pinnedBoundInputs=new Map();
 for(const entry of manifest.sources){
  const raw=await fs.readFile(await realFile(rawRoot,entry.relativePath)),bound=await fs.readFile(await realFile(boundRoot,entry.requestPath.slice(1)));
  if(digest(raw)!==entry.sha256||raw.length!==entry.bytes||digest(bound)!==entry.boundSha256||bound.length!==entry.boundBytes)throw Error('Original captured source or bound snapshot bytes changed');
  pinnedBoundInputs.set(entry.requestPath,Object.freeze({type:entry.type,body:bound.toString('utf8')}));
 }
 generatedInputSnapshot={mode:'pinned-qa-text',id:manifest.id,sourceCount:manifest.sourceCount,manifestPath,scope:manifest.scope,reused:true};
 const after=await attachedApi.read('/__preview/fate-qa/state');
 if(stateIdentity(after)!==stateIdentity(attachExpected.state))throw Error('Existing API changed during read-only snapshot validation');
 if(attachedApi.kind==='empty-fate-campaign')requireEmptyFateCampaign(attachExpected,after);
 if(attachCheck==='1'){
  console.log(JSON.stringify({ok:true,readOnlyPreflight:true,apiPid:attachedApi.pid,apiOrigin,fixtureInitialInputSha256:attachedApi.fixtureInitialInputSha256,clockNow:attachedApi.clockNow,kind:attachedApi.kind||'preserve-exact-fate-api',campaignId:attachedApi.campaignId||null,originalLifeId:attachedApi.originalLifeId,generatedInputSnapshot,stateSha256:attachedApi.stateSha256,apiSpawned:false,apiKilled:false,snapshotWritten:false}));
  // Complete the module naturally so pending fetch cleanup can drain on Windows.
 }
}
if(snapshotArgument){
 const realRepo=await fs.realpath(repo),evidenceRoot=await fs.realpath(path.join(repo,'.release-sync')),requested=path.resolve(repo,snapshotArgument);
 if(!within(realRepo,evidenceRoot)||!within(evidenceRoot,requested)||requested===evidenceRoot)throw Error('QA snapshot destination must be inside this worktree owned .release-sync');
 const realParent=await fs.realpath(path.dirname(requested));
 if(!within(evidenceRoot,realParent))throw Error('QA snapshot parent escaped this worktree owned .release-sync');
 const destination=path.join(realParent,path.basename(requested));
 await fs.mkdir(destination);
 const manifestPath=path.join(destination,'manifest.json');
 try{
  const source=fileURLToPath(new URL('./scene-preview-bindings.mjs',import.meta.url)),stat=await fs.stat(source);
  const bindings=await import(pathToFileURL(source).href+'?qa='+encodeURIComponent(stat.mtimeMs+':'+stat.size));
  const captured=await bindings.captureBoundPreviewInputs(grokRoot);
  for(const input of captured.rawSources){const target=path.join(destination,'raw',input.relativePath);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,input.bytes,{flag:'wx'});}
  for(const [requestPath,response] of captured.responses){const target=path.join(destination,'bound',requestPath.slice(1));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,response.body,{flag:'wx'});}
  await fs.writeFile(manifestPath,JSON.stringify({...captured.manifest,destination,manifestPath},null,2)+'\n',{flag:'wx'});
  if(captured.manifest.status!=='passed')throw Error('QA generated input capture was unstable or could not bind; failed manifest preserved at '+manifestPath);
  pinnedBoundInputs=captured.responses;
  generatedInputSnapshot={mode:'pinned-qa-text',id:captured.manifest.id,sourceCount:captured.manifest.sourceCount,manifestPath,scope:captured.manifest.scope};
 }catch(error){
  await fs.writeFile(manifestPath,JSON.stringify({schemaVersion:1,status:'failed',capturedAt:new Date().toISOString(),sourceRoot:grokRoot,destination,error:error.message,sourceRootWritten:false},null,2)+'\n',{flag:'wx'}).catch(writeError=>{if(writeError.code!=='EEXIST')throw writeError;});
  throw error;
 }
}

const origin = `http://127.0.0.1:${port}`;
const config = { live: true, sceneOrigin: origin, endpoint: `http://127.0.0.1:${apiPort}/app/api/`, accountId: '90101', realmId: 'permanent' };
const injected = `<script>window.__RpgScenePreviewConfig=${JSON.stringify(config)};</script>`;
const socialPrefix = '/ui-generated-20261030/hud-angels-20261102/';
const buttonMaterialPrefix = '/ui/button-materials/';
const starArtFiles=new Set(['dawn','moon','eclipse'].flatMap(tone=>['/art/star-ring-rewards-20261018/icon-'+tone+'.webp','/art/star-ring-surround-20261026/surround-'+tone+'.webp']));
const guardianArtFiles=new Set(['melee','ranged','magic','loot'].map(type=>'/art/guardian-sigil-20261013/'+type+'.webp'));
const staticArtFiles=new Set([...starArtFiles,...guardianArtFiles]);
// Only original read-only narrative modules and their published artwork. The
// old iframe application is deliberately not an entry point in this preview.
const fateStaticPath=requestPath=>requestPath==='/scene-fate-story.js'||(
  /^\/fate\/(?:country-packs-v9\/)?[a-z0-9_-]+\.js$/i.test(requestPath)&&requestPath!=='/fate/app.js'
)||/^\/art\/(?:fate-taiwan-v8|fate-countries-v9|fate-ending-20261016)\/[a-z0-9_-]+\.webp$/i.test(requestPath)
||requestPath==='/art/ui/command-collect-20261012.webp'
||/^\/art\/items-scrolls-pink-20261018\/guaranteed_scroll_[wa]\.webp$/.test(requestPath)
||/^\/art\/items-scrolls-cutout-20261011\/scroll_[wa]\.webp$/.test(requestPath);
const virtualSocial = new Set([
  'scene-live-session.js','scene-live-view.js','scene-live-view.css','scene-window-manager.js',
  'scene-inventory-ui.js','scene-inventory-ui.css','scene-workshop-ui.js','scene-workshop-ui.css','scene-supply-ui.js','scene-supply-ui.css',
  'scene-skills-ui.js','scene-skills-ui.css',
  'scene-party-ui.js','scene-party-ui.css',
  'scene-tower-ui.js','scene-tower-ui.css',
  'scene-boss-ui.js','scene-boss-ui.css',
  'scene-star-ring-ui.js','scene-star-ring-ui.css',
  'scene-guardian-ui.js','scene-guardian-ui.css',
  'scene-fate-ui.js','scene-fate-ui.css','scene-fate-story.js',
  'scene-social-preview.js','scene-social-preview.css','scene-chat-ui.js','scene-chat-ui.css',
  'scene-atlas-guide.js','atlas-talents-ui.js','atlas-talents-ui.css','atlas-progression-ui.js',
  'equipment-recovery-ui.js','equipment-recovery-ui.css','equipment-collection-ui.js','equipment-collection-ui.css','scene-hero-readability.js','scene-hero-readability.css',
]);
const angelFiles = new Set(['hud-angels.js','hud-angels.css','angel-good-left-v1.png','angel-fallen-right-v1.png','unified-rail-v1.png']);
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp4':'video/mp4','.woff2':'font/woff2' };
let apiProcess = null, stopping = false, apiReady = !!attachedApi;

function within(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
async function realFile(root, relative) {
  const candidate = path.resolve(root, relative);
  if (!within(root, candidate)) throw Object.assign(Error('Invalid asset path'), { status: 404 });
  const actual = await fs.realpath(candidate);
  if (!within(root, actual) || !(await fs.stat(actual)).isFile()) throw Object.assign(Error('Asset not found'), { status: 404 });
  return actual;
}
// Read-only preflight owns no server, child process or signal cleanup handlers.
if(attachCheck!=='1'){
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const url = new URL(req.url, origin);
    if (url.pathname === '/') { res.writeHead(302, { Location: '/ui-generated-20261030/preview.html'+url.search }); res.end(); return; }
    if (url.pathname === '/__preview/health') {
      res.writeHead(200, { 'Content-Type':'application/json','Cache-Control':'no-store' });
      res.end(JSON.stringify({ ok:true, pid:process.pid, apiPid:apiProcess?.pid||attachedApi?.pid||null, apiOwned:!attachedApi, attachedApi:!!attachedApi, attachKind:attachedApi?.kind||null, campaignId:attachedApi?.campaignId||null, liveScene:true, isolated:true, ephemeral:true, productionAccess:false, apiReady, sceneOrigin:origin, apiOrigin:`http://127.0.0.1:${apiPort}`, generatedInputsReadOnly:true, generatedInputSnapshot })); return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const requestPath = decodeURIComponent(url.pathname);
    const directPublic=requestPath.startsWith(buttonMaterialPrefix)||staticArtFiles.has(requestPath)||fateStaticPath(requestPath);
    if (requestPath.includes('\\') || requestPath.includes('\0') || requestPath.split('/').includes('..') || (!directPublic && !/^\/(?:ui-proto|ui-generated-20261030|map(?:[1-9]|1[0-2]))\//.test(requestPath))) {
      res.writeHead(404); res.end('Asset not found'); return;
    }
    const bound = directPublic ? null : await composeResponse(requestPath, grokRoot);
    if (bound) {
      let body = bound.type.startsWith('text/html') ? bound.body.replace('<head>', '<head>' + injected).replace(/<title>[^<]*<\/title>/, '<title>星穹旅誌・真實出征整合</title>') : bound.body;
      if(bound.type.startsWith('text/html'))body=body.replace('<script src="'+socialPrefix+'scene-social-preview.js"></script>','<script src="'+socialPrefix+'scene-window-manager.js"></script><script src="'+socialPrefix+'scene-social-preview.js"></script>');
      if (bound.type.startsWith('text/html') && !body.includes('window.__RpgScenePreviewConfig=')) throw Error('Scene configuration hook changed');
      res.writeHead(200, { 'Content-Type':bound.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Scene-Integration':'20261104','X-Scene-Generated-Mode':generatedInputSnapshot.mode,...(generatedInputSnapshot.id?{'X-Scene-Input-Snapshot':generatedInputSnapshot.id}:{}) });
      res.end(req.method === 'HEAD' ? undefined : body); return;
    }
    let file;
    if (directPublic) file = await realFile(publicRoot, requestPath.slice(1));
    else if (requestPath.startsWith(socialPrefix)) {
      const name = requestPath.slice(socialPrefix.length);
      if (virtualSocial.has(name)) file = await realFile(publicRoot, name);
      else if (angelFiles.has(name)) file = await realFile(publicRoot, `art/hud-angels-20261102/${name}`);
    }
    if (!file) file = await realFile(grokRoot, requestPath.slice(1));
    const stat = await fs.stat(file);
    res.writeHead(200, { 'Content-Type':types[path.extname(file)] || 'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff' });
    if (req.method === 'HEAD') res.end();
    else { const stream = createReadStream(file); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); }
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    const status = error.status || (error.code === 'ENOENT' ? 404 : 503);
    if (status !== 404) console.error(error.stack || error.message);
    res.writeHead(status, { 'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store' });
    res.end(status === 404 ? 'Asset not found' : '整合預覽正在更新，請稍後重新整理。');
  }
});
server.on('error', error => { console.error(error.message); stop(); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  if(attachedApi){
    console.log(JSON.stringify({url:origin,api:apiOrigin,localOnly:true,generatedInputsReadOnly:true,generatedInputSnapshot,pid:process.pid,apiPid:attachedApi.pid,apiOwned:false,attachedApi:true,attachKind:attachedApi.kind||'preserve-exact-fate-api',campaignId:attachedApi.campaignId||null,stateSha256:attachedApi.stateSha256}));
    return;
  }
  apiProcess = spawn(process.execPath, [path.join(here,'atlas-local-preview.mjs'),`--port=${apiPort}`,`--preview-origin=${origin}`], { cwd:repo, stdio:['ignore','pipe','pipe'], windowsHide:true });
  apiProcess.stdout.on('data', chunk => { process.stdout.write(chunk); if (chunk.toString().includes('"isolated":true')) apiReady = true; });
  apiProcess.stderr.on('data', chunk => process.stderr.write(chunk));
  apiProcess.on('error', error => { console.error(error.message); stop(); process.exitCode = 1; });
  apiProcess.on('exit', code => { apiReady = false; if (!stopping) { console.error('Isolated Atlas service exited: ' + code); stop(); process.exitCode = 1; } });
  console.log(JSON.stringify({ url:origin, api:`http://127.0.0.1:${apiPort}`, localOnly:true, generatedInputsReadOnly:true, generatedInputSnapshot, pid:process.pid, apiPid:apiProcess.pid }));
});
function stop() {
  if (stopping) return; stopping = true;
  server.closeAllConnections(); server.close();
  if (!attachedApi && apiProcess && apiProcess.exitCode === null) apiProcess.kill();
}
process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
