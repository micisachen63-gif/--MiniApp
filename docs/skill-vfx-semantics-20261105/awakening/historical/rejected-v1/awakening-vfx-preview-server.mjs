import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const option=process.argv.find(a=>a.startsWith('--port='));
const port=Number(option?.split('=')[1]||9894);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use --port=<1024..65535>');
const allowed=new Set(['awakening-vfx-preview.html','awakening-vfx-preview.css','awakening-vfx-preview.mjs','awakening-vfx-engine.mjs','awakening-vfx-data.mjs','awakening-vfx-audit.json','skill-vfx-engine.mjs','skill-vfx-semantics.mjs',...['sword-atlas','archer-atlas','mage-atlas','thief-atlas','semantic-atlas','hawk'].map(n=>'art/skill-vfx-20261104/'+n+'.webp')]);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'};
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{...headers,Allow:'GET, HEAD'});res.end();return;}
  let route;try{route=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400,headers);res.end();return;}
  if(route==='/__awakening/health'){res.writeHead(200,{...headers,'Content-Type':mime['.json']});res.end(req.method==='HEAD'?undefined:JSON.stringify({ok:true,readOnly:true,previewOnly:true,productionAccess:false,liveSkillRegistration:false,plannedSkills:16,sourceId:null,root,port,pid:process.pid}));return;}
  if(route==='/favicon.ico'){res.writeHead(204,headers);res.end();return;}
  const name=route==='/'?'awakening-vfx-preview.html':route.slice(1);
  if(!allowed.has(name)){res.writeHead(404,headers);res.end('Not found');return;}
  try{const file=path.join(root,name),info=await stat(file);if(!info.isFile())throw new Error('Not a file');const body=await readFile(file);res.writeHead(200,{...headers,'Content-Type':mime[path.extname(name)]||'application/octet-stream','Content-Length':body.length});res.end(req.method==='HEAD'?undefined:body);}catch{res.writeHead(404,headers);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${port}/awakening-vfx-preview.html`,readOnly:true,previewOnly:true,pid:process.pid})));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
