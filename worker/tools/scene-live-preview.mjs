// Read-only composition of the current art source, paired with disposable Atlas data.
// node worker/tools/scene-live-preview.mjs --grok-root=D:/StarJournal/grok-assets
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
let bindingVersion='',currentBindings=null;
async function composeResponse(requestPath,grokRoot){
 const source=fileURLToPath(new URL('./scene-preview-bindings.mjs',import.meta.url));
 const stat=await fs.stat(source),version=stat.mtimeMs+':'+stat.size;
 if(version!==bindingVersion){currentBindings=await import(pathToFileURL(source).href+'?v='+encodeURIComponent(version));bindingVersion=version;}
 return currentBindings.boundPreviewResponse(requestPath,grokRoot);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..'), publicRoot = path.resolve(here, '../public');
const args = new Map();
for (const value of process.argv.slice(2)) {
  const match = /^--(grok-root|port|api-port)=(.+)$/.exec(value);
  if (!match || args.has(match[1])) throw Error('Use --grok-root=... [--port=9653] [--api-port=9652]');
  args.set(match[1], match[2]);
}
if (!args.has('grok-root')) throw Error('A local --grok-root is required');
const grokRoot = await fs.realpath(path.resolve(args.get('grok-root')));
const port = Number(args.get('port') || 9653), apiPort = Number(args.get('api-port') || 9652);
for (const number of [port, apiPort]) if (!Number.isInteger(number) || number < 1024 || number > 65535) throw Error('Invalid loopback port');
if (port === apiPort) throw Error('The scene and API need separate ports');
const origin = `http://127.0.0.1:${port}`;
const config = { live: true, sceneOrigin: origin, endpoint: `http://127.0.0.1:${apiPort}/app/api/`, accountId: '90101', realmId: 'permanent' };
const injected = `<script>window.__RpgScenePreviewConfig=${JSON.stringify(config)};</script>`;
const socialPrefix = '/ui-generated-20261030/hud-angels-20261102/';
const buttonMaterialPrefix = '/ui/button-materials/';
const virtualSocial = new Set([
  'scene-live-session.js','scene-live-view.js','scene-live-view.css','scene-window-manager.js',
  'scene-inventory-ui.js','scene-inventory-ui.css','scene-workshop-ui.js','scene-workshop-ui.css','scene-supply-ui.js','scene-supply-ui.css',
  'scene-skills-ui.js','scene-skills-ui.css',
  'scene-party-ui.js','scene-party-ui.css',
  'scene-tower-ui.js','scene-tower-ui.css',
  'scene-boss-ui.js','scene-boss-ui.css',
  'scene-social-preview.js','scene-social-preview.css','scene-chat-ui.js','scene-chat-ui.css',
  'scene-atlas-guide.js','atlas-talents-ui.js','atlas-talents-ui.css','atlas-progression-ui.js',
  'equipment-recovery-ui.js','equipment-recovery-ui.css','equipment-collection-ui.js','equipment-collection-ui.css','scene-hero-readability.js','scene-hero-readability.css',
]);
const angelFiles = new Set(['hud-angels.js','hud-angels.css','angel-good-left-v1.png','angel-fallen-right-v1.png','unified-rail-v1.png']);
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp4':'video/mp4','.woff2':'font/woff2' };
let apiProcess = null, stopping = false, apiReady = false;

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
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const url = new URL(req.url, origin);
    if (url.pathname === '/') { res.writeHead(302, { Location: '/ui-generated-20261030/preview.html' }); res.end(); return; }
    if (url.pathname === '/__preview/health') {
      res.writeHead(200, { 'Content-Type':'application/json','Cache-Control':'no-store' });
      res.end(JSON.stringify({ ok:true, liveScene:true, isolated:true, ephemeral:true, productionAccess:false, apiReady, sceneOrigin:origin, apiOrigin:`http://127.0.0.1:${apiPort}`, generatedInputsReadOnly:true })); return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const requestPath = decodeURIComponent(url.pathname);
    if (requestPath.includes('\\') || requestPath.includes('\0') || requestPath.split('/').includes('..') || (!requestPath.startsWith(buttonMaterialPrefix) && !/^\/(?:ui-proto|ui-generated-20261030|map(?:[1-9]|1[0-2]))\//.test(requestPath))) {
      res.writeHead(404); res.end('Asset not found'); return;
    }
    const bound = requestPath.startsWith(buttonMaterialPrefix) ? null : await composeResponse(requestPath, grokRoot);
    if (bound) {
      let body = bound.type.startsWith('text/html') ? bound.body.replace('<head>', '<head>' + injected).replace(/<title>[^<]*<\/title>/, '<title>星穹旅誌・真實出征整合</title>') : bound.body;
      if(bound.type.startsWith('text/html'))body=body.replace('<script src="'+socialPrefix+'scene-social-preview.js"></script>','<script src="'+socialPrefix+'scene-window-manager.js"></script><script src="'+socialPrefix+'scene-social-preview.js"></script>');
      if (bound.type.startsWith('text/html') && !body.includes('window.__RpgScenePreviewConfig=')) throw Error('Scene configuration hook changed');
      res.writeHead(200, { 'Content-Type':bound.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Scene-Integration':'20261104' });
      res.end(req.method === 'HEAD' ? undefined : body); return;
    }
    let file;
    if (requestPath.startsWith(buttonMaterialPrefix)) file = await realFile(publicRoot, requestPath.slice(1));
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
  apiProcess = spawn(process.execPath, [path.join(here,'atlas-local-preview.mjs'),`--port=${apiPort}`,`--preview-origin=${origin}`], { cwd:repo, stdio:['ignore','pipe','pipe'], windowsHide:true });
  apiProcess.stdout.on('data', chunk => { process.stdout.write(chunk); if (chunk.toString().includes('"isolated":true')) apiReady = true; });
  apiProcess.stderr.on('data', chunk => process.stderr.write(chunk));
  apiProcess.on('error', error => { console.error(error.message); stop(); process.exitCode = 1; });
  apiProcess.on('exit', code => { apiReady = false; if (!stopping) { console.error('Isolated Atlas service exited: ' + code); stop(); process.exitCode = 1; } });
  console.log(JSON.stringify({ url:origin, api:`http://127.0.0.1:${apiPort}`, localOnly:true, generatedInputsReadOnly:true, pid:process.pid, apiPid:apiProcess.pid }));
});
function stop() {
  if (stopping) return; stopping = true;
  server.closeAllConnections(); server.close();
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill();
}
process.once('SIGINT', stop); process.once('SIGTERM', stop);
