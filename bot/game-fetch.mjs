// Native HTTP transport for the game service. No automatic retry of mutations.
// Hostnames and TLS verification stay intact; IPv4 avoids this host's dual-stack resets.
import http from 'node:http';import https from 'node:https';import {gunzipSync,brotliDecompressSync,inflateSync} from 'node:zlib';
const pooledAgents={'http:':new http.Agent({keepAlive:true,maxSockets:8,maxFreeSockets:2,timeout:30000}),'https:':new https.Agent({keepAlive:true,maxSockets:8,maxFreeSockets:2,timeout:30000})};
export async function gameFetch(url,options={}){
 const request=new Request(url,options),target=new URL(request.url),body=request.body?Buffer.from(await request.arrayBuffer()):null;
 if(request.signal.aborted)throw request.signal.reason;
 const headers=Object.fromEntries(request.headers);headers['accept-encoding']='identity';headers['user-agent']||='star-journal-rpg/1.0';headers.accept||='application/json';if(body)headers['content-length']=String(body.length);
 const once=()=>new Promise((resolve,reject)=>{
  const transport=target.protocol==='https:'?https:http;
  const abort=()=>req.destroy(request.signal.reason||new DOMException('Aborted','AbortError'));
  const req=transport.request(target,{method:request.method,headers,family:4,agent:pooledAgents[target.protocol]},res=>{
   const chunks=[];res.on('data',part=>chunks.push(part));res.on('error',reject);
   res.on('end',()=>{try{let bytes=Buffer.concat(chunks);const encoding=res.headers['content-encoding'];if(encoding==='gzip')bytes=gunzipSync(bytes);else if(encoding==='br')bytes=brotliDecompressSync(bytes);else if(encoding==='deflate')bytes=inflateSync(bytes);resolve(new Response([204,205,304].includes(res.statusCode)?null:bytes,{status:res.statusCode,headers:res.headers}));}catch(e){reject(e);}});
  });
  request.signal.addEventListener('abort',abort,{once:true});req.once('close',()=>request.signal.removeEventListener('abort',abort));req.once('error',reject);
  req.end(body||undefined);
 });
 const telegramRead=target.hostname==='api.telegram.org'&&['getMe','getChat','getChatMember','getMyCommands','getChatMenuButton','getWebhookInfo','getUpdates','getFile'].includes(target.pathname.split('/').at(-1));
 const safeRead=['GET','HEAD'].includes(request.method)||(request.method==='POST'&&telegramRead);
 try{return await once()}catch(e){if(safeRead&&!request.signal.aborted&&['ECONNRESET','ETIMEDOUT','EAI_AGAIN','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH'].includes(e.code))return once();throw e}
}
