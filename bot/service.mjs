import './network-ipv4.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createGameTelegramApi} from './telegram-media.mjs';
import {createGameBot,commands} from './bot.mjs';
import {gameFetch} from './game-fetch.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),stateDir=path.join(root,'state'),logsDir=path.join(root,'logs'),lock=path.join(stateDir,'service.lock'),stopFile=path.join(stateDir,'stop-request');
fs.mkdirSync(stateDir,{recursive:true});fs.mkdirSync(logsDir,{recursive:true});
const alive=()=>{try{const p=JSON.parse(fs.readFileSync(lock));process.kill(p.pid,0);return p.pid;}catch{return null;}};
const command=process.argv[2]||'status';
if(command==='status'){const pid=alive();console.log(JSON.stringify({running:!!pid,pid,heartbeat:fs.existsSync(path.join(stateDir,'heartbeat.json'))?JSON.parse(fs.readFileSync(path.join(stateDir,'heartbeat.json'))):null}));}
else if(command==='start'){if(alive())console.log('Already running');else{try{fs.unlinkSync(stopFile);}catch{}const p=spawn(process.execPath,['--dns-result-order=ipv4first',fileURLToPath(import.meta.url),'run'],{cwd:root,detached:true,stdio:'ignore',windowsHide:true});p.unref();console.log('Started game service: '+p.pid);}}
else if(command==='stop'){fs.writeFileSync(stopFile,'stop');console.log('Stop requested');}
else if(command==='run'){
 if(alive())process.exit(0);try{fs.unlinkSync(lock);}catch{}fs.writeFileSync(lock,JSON.stringify({pid:process.pid,at:Date.now()}),{flag:'wx'});
 const log=Object.fromEntries(['info','warn','error'].map(level=>[level,(text)=>fs.appendFileSync(path.join(logsDir,'service.log'),`${new Date().toISOString()} ${level} ${String(text).replace(/\d{8,12}:[A-Za-z0-9_-]{30,}/g,'[redacted]')}\n`)]));
 try{
 const config=JSON.parse(fs.readFileSync(path.join(root,'telegram.local.json'),'utf8'));
 const api=createGameTelegramApi(config.botToken,{fetchImpl:gameFetch});
 const setupCall=async(method,body={})=>{for(let attempt=0;;attempt++){try{return await api.call(method,body);}catch(e){if(e.definite||attempt>=2)throw e;await new Promise(r=>setTimeout(r,1000));}}};
 const me=await setupCall('getMe'),group=await setupCall('getChat',{chat_id:config.chatId}),member=await setupCall('getChatMember',{chat_id:config.chatId,user_id:me.id});
 if(me.username!==config.botUsername||String(group.id)!==config.chatId||group.type!=='supergroup'||member.status!=='administrator')throw Error('Bot/group identity or admin validation failed');
 const storeFile=path.join(stateDir,'telegram.json');let data={};try{data=JSON.parse(fs.readFileSync(storeFile));}catch{}const store={data,save(){const tmp=storeFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data));fs.renameSync(tmp,storeFile);}};
 const bot=createGameBot({config,api,store,log});
 await setupCall('setMyCommands',{commands});
 await setupCall('setChatMenuButton',{menu_button:config.active?{type:'web_app',text:'開啟旅誌',web_app:{url:config.appUrl}}:{type:'commands'}});
 let ticking=false;const tick=async()=>{if(ticking||!config.active)return;ticking=true;try{await bot.tick();}catch(e){log.warn(e.message);}finally{ticking=false;}};
 const timer=setInterval(tick,10000);log.info(`Ready @${me.username}, group ${group.id}, mode ${config.active?'active':'staged'} (no RPG ticks in staged mode)`);
 while(!fs.existsSync(stopFile)){
  fs.writeFileSync(path.join(stateDir,'heartbeat.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,mode:config.active?'active':'staged',botUsername:me.username,chatId:String(group.id)}));
  try{const updates=await api.call('getUpdates',{offset:data.offset||0,timeout:20,allowed_updates:['message','callback_query','my_chat_member']},{timeoutMs:30000});for(const u of updates){try{if(u.message?.migrate_to_chat_id){log.error('Group migrated; service stopped pending explicit ID update');fs.writeFileSync(stopFile,'migration');break;}await bot.handle(u);}catch(e){log.warn(`Update ${u.update_id}: ${e.message}`);}data.offset=u.update_id+1;store.save();}}
  catch(e){log.warn(e.message);await new Promise(r=>setTimeout(r,3000));}
 }
 clearInterval(timer);log.info('Stopped');
 }catch(e){log.error(e.message);process.exitCode=1;}finally{try{fs.unlinkSync(lock);}catch{}}
}
else throw Error('Use start, stop, status, run');
