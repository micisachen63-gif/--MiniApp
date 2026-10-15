import {createCloudBot} from './adapter/index.mjs';
import {createTelegramApi,webhookSecret} from './telegram-api.mjs';
import {createRpgMediaRenderer} from './renderer/media.mjs';
import wasmModule from './renderer/deps/resvg.wasm';
import {pk as smokePk} from './smoke-fixture.mjs';
import {drainInbox,inboxSummary,inspectUncertain,closeUncertain} from './inbox.mjs';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export class BotCoordinator {
 constructor(state,env){
  this.state=state;this.env=env;this.sql=state.storage.sql;this.chain=Promise.resolve();this.bot=null;
  this.sql.exec('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY,path TEXT NOT NULL,value TEXT NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS operations (key TEXT PRIMARY KEY,value TEXT NOT NULL,at INTEGER NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY,body TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,finished INTEGER,last_error TEXT)');
  this.sql.exec('CREATE INDEX IF NOT EXISTS inbox_status ON inbox(status,id)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS inbox_reviews (update_id INTEGER PRIMARY KEY,resolution TEXT NOT NULL,note TEXT NOT NULL,reviewed_at INTEGER NOT NULL)');
  // A started callback is never blindly replayed after an isolate crash.
  this.sql.exec("UPDATE inbox SET status='uncertain',last_error='execution interrupted' WHERE status='running'");
 }
 get(key,fallback=null){const row=this.sql.exec('SELECT value FROM config WHERE key=?',key).toArray()[0];return row?JSON.parse(row.value):fallback;}
 set(key,value){this.sql.exec('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value));}
 exclusive(fn){const current=this.chain.then(fn,fn);this.chain=current.catch(()=>{});return current;}
 store(){
  const data={rpg:{}},saved=new Map();
  for(const row of this.sql.exec('SELECT key,path,value FROM store').toArray()){const path=JSON.parse(row.path);let node=data;for(const part of path.slice(0,-1))node=node[part]??={};node[path.at(-1)]=JSON.parse(row.value);saved.set(row.key,row.value);}
  const save=()=>{
   const next=new Map();
   for(const [group,value] of Object.entries(data.rpg||{})){
    const parts=value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value).map(([id,v])=>[['rpg',group,id],v]):[[['rpg',group],value]];
    for(const [path,v] of parts){const key=JSON.stringify(path),encoded=JSON.stringify(v);if(encoded===undefined)continue;next.set(key,encoded);if(saved.get(key)!==encoded)this.sql.exec('INSERT INTO store(key,path,value) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,key,encoded);}
   }
   for(const key of saved.keys())if(!next.has(key))this.sql.exec('DELETE FROM store WHERE key=?',key);saved.clear();for(const [k,v] of next)saved.set(k,v);
  };
  return {data,save,operations:{get:key=>{const row=this.sql.exec('SELECT value FROM operations WHERE key=?',key).toArray()[0];return row?JSON.parse(row.value):null;},put:(key,value)=>this.sql.exec('INSERT INTO operations(key,value,at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,at=excluded.at',key,JSON.stringify(value),Date.now())}};
 }
 async init(){
  if(this.bot)return this.bot;
  const env=this.env,appUrl='https://elf-rpg-api.micisachen.workers.dev/',api=createTelegramApi(env.BOT_TOKEN,{mediaBaseUrl:appUrl.replace(/\/$/,'')});
  const asset=async path=>{if(!/^[A-Za-z0-9_/.-]+$/.test(path)||path.includes('..'))throw Error('Invalid art path');const r=await env.ASSETS.fetch(new Request('https://assets.internal/'+path));if(!r.ok)throw Error('Cloud art unavailable: '+path);return new Uint8Array(await r.arrayBuffer());};
  const renderer=createRpgMediaRenderer({wasmModule,loadFont:()=>asset('fonts/NotoSansTC.ttf'),loadPartyAsset:file=>asset('rpg-party/'+file),loadBossAsset:map=>asset(`rpg-boss/boss-${map}.png`)});
  this.media=renderer;
  const rpgApi={call:async(path,body)=>{
   const r=await env.RPG_API.fetch(new Request('https://elf-rpg-api.micisachen.workers.dev'+path,{method:'POST',headers:{'content-type':'application/json','X-Service-Secret':env.SERVICE_SECRET},body:JSON.stringify(body||{})}));
   let result;try{result=await r.json();}catch{throw Object.assign(Error('遊戲回應不明'),{code:'network',status:0});}
   if(!result.ok)throw Object.assign(Error(result.message||'遊戲操作未完成'),{code:result.error,status:r.status});return result;
  }};
  this.bot=createCloudBot({config:{active:true,chatId:env.GROUP_CHAT_ID,botUsername:'StarJournalRpgBot',appUrl,inviteLink:env.INVITE_LINK,mainMiniApp:false},api,store:this.store(),log:{info:()=>{},warn:(label)=>console.warn(String(label).replace(/\d{8,12}:[A-Za-z0-9_-]{30,}/g,'[redacted]').slice(0,180)),error:(label)=>console.error(String(label).slice(0,180))},rpgApi,renderBattleAnimation:renderer.renderBattleAnimation,renderPartyCard:renderer.renderPartyCard,bossCardBytes:renderer.bossCardBytes,fetchImpl:fetch});
  return this.bot;
 }
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path==='/status')return json({ok:true,service:'StarJournalRpgBot',mode:this.get('enabled',false)?'cloud':'staged',heartbeat:this.get('heartbeat'),lastCycleError:this.get('lastError'),processed:this.sql.exec("SELECT COUNT(*) AS n FROM inbox WHERE status='done'").toArray()[0].n,reviewed:this.sql.exec("SELECT COUNT(*) AS n FROM inbox WHERE status='reviewed'").toArray()[0].n,...inboxSummary(this.sql),gameApi:'elf-rpg-api'});
  if(path==='/receive'){
   if(!this.get('enabled',false))return json({ok:false,error:'staged'},503);
   const body=await request.text(),u=JSON.parse(body);if(Date.now()<this.get('minimumUpdateIdUntil',0)&&u.update_id<this.get('minimumUpdateId',0))return json({ok:true,alreadyProcessed:true});
   this.sql.exec("INSERT OR IGNORE INTO inbox(id,body,status,created) VALUES(?,?,'queued',?)",u.update_id,body,Date.now());await this.wake();return json({ok:true});
  }
  if(path==='/wake'){if(this.get('enabled',false))await this.wake();return json({ok:true});}
  if(path==='/admin')return this.exclusive(async()=>{
   const b=await request.json();
   if(b.action==='inbox-inspect'){try{return json({ok:true,...inboxSummary(this.sql),items:inspectUncertain(this.sql,b)});}catch{return json({ok:false,error:'invalid_range'},400);}}
   if(b.action==='inbox-close'){try{return json(this.state.storage.transactionSync(()=>closeUncertain(this.sql,b)));}catch(e){return json({ok:false,error:'review_conflict',message:e.message},409);}}
   if(b.action==='webhook-status'){const api=createTelegramApi(this.env.BOT_TOKEN),info=await api.call('getWebhookInfo'),me=await api.call('getMe');return json({ok:true,username:me.username,url:info.url,pending_update_count:info.pending_update_count,max_connections:info.max_connections,last_error_message:info.last_error_message||null});}
   if(b.action==='install-webhook'){const api=createTelegramApi(this.env.BOT_TOKEN),url='https://star-journal-rpg-bot.micisachen.workers.dev/telegram/webhook';try{await api.call('setWebhook',{url,secret_token:await webhookSecret(this.env.SERVICE_SECRET),max_connections:1,allowed_updates:['message','callback_query','my_chat_member'],drop_pending_updates:false});}catch{const actual=await api.call('getWebhookInfo');if(actual.url!==url)throw Error('Webhook outcome requires inspection');}const info=await api.call('getWebhookInfo');return json({ok:info.url===url,url:info.url,pending_update_count:info.pending_update_count,max_connections:info.max_connections});}
   if(b.action==='check'){const bot=await this.init(),me=await createTelegramApi(this.env.BOT_TOKEN).call('getMe');const meta=await this.env.RPG_API.fetch(new Request('https://elf-rpg-api.micisachen.workers.dev/rpg/guardian/config',{method:'POST',headers:{'content-type':'application/json','X-Service-Secret':this.env.SERVICE_SECRET},body:'{}'}));const game=await meta.json(),gif=await this.media.renderBattleAnimation('pk',smokePk),magic=new TextDecoder().decode(gif.slice(0,6));return json({ok:me.username==='StarJournalRpgBot'&&bot.active===true&&game.ok&&magic==='GIF89a',username:me.username,handlerReady:typeof bot.handle==='function'&&typeof bot.tick==='function',cloudGifBytes:gif.length,cloudGifFormat:magic,noMessagesSent:true,noRealPlayerData:true});}
   if(b.action==='bootstrap'){
    if(this.get('enabled',false))return json({ok:false,error:'already_active'},409);
    if(!b.data||!Number.isSafeInteger(b.minimumUpdateId)||b.minimumUpdateId<0)return json({ok:false},400);
    const store=this.store();store.data.rpg=b.data.rpg||{};store.save();this.set('minimumUpdateId',b.minimumUpdateId);this.set('minimumUpdateIdUntil',Date.now()+86400000);this.set('seedDigest',b.seedDigest);this.bot=null;return json({ok:true,seedDigest:b.seedDigest,minimumUpdateId:b.minimumUpdateId,rows:this.sql.exec('SELECT COUNT(*) AS n FROM store').toArray()[0].n});
   }
   if(b.action==='enable'){if(!this.get('seedDigest'))return json({ok:false,error:'not_bootstrapped'},409);this.set('enabled',true);await this.wake();return json({ok:true,enabled:true});}
   if(b.action==='disable'){this.set('enabled',false);await this.state.storage.deleteAlarm();return json({ok:true,enabled:false});}
   return json({ok:false,error:'unknown_action'},400);
  });
  return json({ok:false},404);
 }
 async wake(){const alarm=await this.state.storage.getAlarm(),soon=Date.now()+100;if(alarm==null||alarm>soon)await this.state.storage.setAlarm(soon);}
 async alarm(){return this.exclusive(async()=>{
  if(!this.get('enabled',false))return;
  await this.state.storage.setAlarm(Date.now()+30000);
  try{
   const bot=await this.init();
   await drainInbox(this.sql,bot);
   await bot.tick();this.set('heartbeat',new Date().toISOString());this.set('lastError',null);
   if(Date.now()-this.get('lastPrune',0)>86400000){this.sql.exec("DELETE FROM inbox WHERE status='done' AND finished<?",Date.now()-7*86400000);this.sql.exec('DELETE FROM operations WHERE at<?',Date.now()-14*86400000);this.set('lastPrune',Date.now());}
  }catch(e){this.set('lastError',String(e.code||e.name||'unknown').slice(0,100));console.warn('Cloud bot cycle failed');}
  if(this.get('enabled',false)){
   const desired=Date.now()+(inboxSummary(this.sql).queued?1000:10000),pending=await this.state.storage.getAlarm();
   await this.state.storage.setAlarm(pending==null?desired:Math.min(desired,pending));
  }
 });}
}
