// Isolated verification of the *packaged* release, with production authentication.
// No grok fallback, production credentials, cron or outbound network exists here.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHmac} from 'node:crypto';
import {freshDb} from '../test/d1-shim.js';
import {seedEndgameQa} from './endgame-qa-fixture.mjs';
import {handle} from '../src/index.js';
import {resolveRealm,scopeEnvForRealm} from '../src/realm/index.js';
import * as AutoEnhance from '../src/services/auto-enhance.js';
import * as AutoReroll from '../src/services/auto-reroll.js';

const option=/^--port=(\d+)$/.exec(process.argv[2]||'');
if(!option||process.argv.length!==3)throw Error('Use --port=<unused loopback port>');
const port=Number(option[1]);if(port<1024||port>65535)throw Error('Invalid local port');
const origin='http://127.0.0.1:'+port,root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const token='999999:'+randomBytes(32).toString('hex');
globalThis.fetch=async input=>{const url=String(input?.url||input);if(url.startsWith('https://api.telegram.org/bot'+token+'/getChatMember'))return Response.json({ok:true,result:{status:'member'}});throw Error('Outbound network disabled in signed release fixture');};
const env={DB:freshDb(),ENVIRONMENT:'production',BOT_TOKEN:token,GROUP_CHAT_ID:'-1000000001',ATLAS_ENABLED:'true',EQUIPMENT_COLLECTION_ENABLED:'true',EQUIPMENT_RECOVERY_ENABLED:'true'};
const fixtures=await seedEndgameQa(env,Date.now());
for(const account of ['90101','90199'])await env.DB.prepare('INSERT INTO rpg_app_access(tg_id,granted_at,expires_at) VALUES(?,?,?)').bind(account,Date.now(),Date.now()+86400000).run();
const operations=[];
const permanent=scopeEnvForRealm(env,await resolveRealm(env,'permanent'));let sweeping=false;
const timer=setInterval(async()=>{if(sweeping)return;sweeping=true;try{await AutoEnhance.sweep(permanent,Date.now());await AutoReroll.sweep(permanent,Date.now());}catch(error){console.error('Isolated workshop sweep:',error.message);}finally{sweeping=false;}},1000);
serverCleanup();
function serverCleanup(){process.once('SIGTERM',()=>{clearInterval(timer);process.exit(0);});}

function credentials(account){
 if(!['90101','90199'].includes(account))return null;
 const user={id:Number(account),first_name:'發布驗證'},p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),query_id:'isolated-release-'+account,user:JSON.stringify(user)});
 const dcs=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
 const secret=createHmac('sha256','WebAppData').update(token).digest();p.set('hash',createHmac('sha256',secret).update(dcs).digest('hex'));
 return {synthetic:true,initData:p.toString(),user};
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.wasm':'application/wasm'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,origin);
  if(req.method==='GET'&&url.pathname==='/__qa/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,pid:process.pid,isolated:true,ephemeral:true,synthetic:true,productionAccess:false,packagedAssetsOnly:true,productionAuthentication:true,fixtures,operations}));return;}
  if(req.method==='GET'&&url.pathname==='/__qa/session'){const session=credentials(url.searchParams.get('accountId'));res.writeHead(session?200:404,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(session||{ok:false}));return;}
  if(url.pathname.startsWith('/app/api/')){
   const parts=[];let size=0;for await(const b of req){size+=b.length;if(size>1048576)throw Error('Body too large');parts.push(b);}
   const headers=new Headers(req.headers),body=Buffer.concat(parts),method=req.method;
   const result=await handle(new Request(url,{method,headers,...(['GET','HEAD'].includes(method)?{}:{body})}),env);
   operations.push({at:Date.now(),action:url.pathname.slice(9),signed:headers.has('X-Telegram-Init-Data'),developerHeader:headers.has('X-Dev-Tg-Id'),status:result.status});
   res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
  }
  const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname),file=path.resolve(root,'.'+relative),within=path.relative(root,file);
  if(within==='..'||within.startsWith('..'+path.sep)||path.isAbsolute(within)||!types[path.extname(file)]){res.writeHead(404);res.end();return;}
  const actual=await fs.realpath(file),actualRelative=path.relative(root,actual);if(actualRelative==='..'||actualRelative.startsWith('..'+path.sep)||path.isAbsolute(actualRelative))throw Error('Static escape');
  res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});res.end(await fs.readFile(actual));
 }catch(error){res.writeHead(error.code==='ENOENT'?404:500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:error.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({origin,pid:process.pid,isolated:true,productionAccess:false,packagedAssetsOnly:true,productionAuthentication:true})));
