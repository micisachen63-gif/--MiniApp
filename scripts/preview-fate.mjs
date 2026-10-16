import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {createHmac} from 'node:crypto';import {pathToFileURL,fileURLToPath} from 'node:url';
// Isolated localhost-only fixture. Never connects to Cloudflare or Telegram.
const root=fileURLToPath(new URL('../',import.meta.url));
const {freshDb}=await import(pathToFileURL(root+'/worker/test/d1-shim.js'));
const P=await import(pathToFileURL(root+'/worker/src/services/player.js'));
const {handle}=await import(pathToFileURL(root+'/worker/src/index.js'));
const TOKEN='12345:isolated-fate-fixture-only',env={DB:freshDb(),ENVIRONMENT:'production',BOT_TOKEN:TOKEN,GROUP_CHAT_ID:'-1004342516953'};
await P.createCharacter(env,{tgId:'111',name:'星燈驗收旅人',gender:'m',baseClass:'mage'},Date.now());
const F=await import(pathToFileURL(root+'/worker/src/services/fate.js'));
const fixtureChar=(await env.DB.prepare('SELECT tg_id FROM rpg_characters WHERE account_tg_id=?').bind('111').first()).tg_id;
for(let i=0;i<4;i++){const t=Date.parse('2026-10-15T06:00:00+08:00')+i*7200000;await F.start(env,fixtureChar,{requestId:crypto.randomUUID(),mode:'random'},t);await F.state(env,fixtureChar,t+7200000);}
await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,3)').bind(fixtureChar,'guaranteed_scroll_w').run();
await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,3)').bind(fixtureChar,'guaranteed_scroll_a').run();
await env.DB.prepare('INSERT INTO rpg_app_access(tg_id,granted_at,expires_at) VALUES(?,?,?)').bind('333',Date.now(),Date.now()+86400000).run();
await env.DB.prepare('INSERT INTO rpg_app_access(tg_id,granted_at,expires_at) VALUES(?,?,?)').bind('444',Date.now(),Date.now()+86400000).run();
function init(id){const f={auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:Number(id),first_name:'隔離驗收旅人'})},key=createHmac('sha256','WebAppData').update(TOKEN).digest(),dcs=Object.keys(f).sort().map(k=>k+'='+f[k]).join('\n');return new URLSearchParams({...f,hash:createHmac('sha256',key).update(dcs).digest('hex')}).toString();}
const base=path.resolve(root,'worker/public');
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/share-qa/'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});return res.end('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>分享文案貼上驗證</title><h1>隔離驗收：分享文案</h1><textarea aria-label="貼上檢查" rows="12" cols="80"></textarea><button onclick="navigator.clipboard.readText().then(v=>document.querySelector(\'textarea\').value=v).catch(e=>document.querySelector(\'p\').textContent=e.message)">讀取剛複製的文案</button><p>只讀取剪貼簿，不上傳或發文。</p></html>');}
 if(url.pathname.startsWith('/app/api/')||url.pathname.startsWith('/fate/r/')){
  const data=[];for await(const chunk of req)data.push(chunk);
  const options={method:req.method,headers:req.headers};if(req.method==='POST')options.body=Buffer.concat(data);
  const response=await handle(new Request('https://fixture'+url.pathname,options),env);res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(await response.text());
 }
 let rel=decodeURIComponent(url.pathname);if(rel.endsWith('/'))rel+='index.html';
 const file=path.resolve(base,'.'+rel);if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 let data=fs.readFileSync(file);if(rel==='/index.html'){
  const candidate=url.searchParams.get('fixture'),id=['333','444'].includes(candidate)?candidate:'111';
  const shim={initData:init(id),initDataUnsafe:{user:{id:Number(id),first_name:'隔離驗收旅人'}},themeParams:{},platform:'web'};
  const script=`<script>window.Telegram={WebApp:${JSON.stringify(shim)}};for(const key of ['ready','expand','setHeaderColor','setBackgroundColor','onEvent','enableClosingConfirmation','disableVerticalSwipes'])Telegram.WebApp[key]=()=>{};Telegram.WebApp.HapticFeedback={impactOccurred(){},notificationOccurred(){},selectionChanged(){}};Telegram.WebApp.BackButton={hide(){},show(){},onClick(){},offClick(){}};</script>`;
  data=Buffer.from(data.toString().replace(/<script src="https:\/\/telegram\.org[^>]+><\/script>/,script));
 }
 const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm'};
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(data);
}catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:String(e.message)}));}}).listen(9555,'127.0.0.1',()=>console.log('ISOLATED_FATE_PREVIEW http://127.0.0.1:9555/fate/'));
