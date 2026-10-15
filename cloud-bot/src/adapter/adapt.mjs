// Reproducible adaptation of the latest allowlisted BOT source. Writes ONLY this directory.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));
const original='C:/Users/User/Documents/ChatGPT/爆分監控/src';
const botPath='C:/Users/User/Documents/ChatGPT/星穹旅誌/bot.mjs';
mkdirSync(root,{recursive:true});
const sources=[];
function read(path){const source=readFileSync(path,'utf8');sources.push({path,sha256:createHash('sha256').update(source).digest('hex')});return source.replaceAll('\r\n','\n');}
function once(source,from,to,label){if(source.split(from).length!==2)throw new Error('Source anchor changed: '+label);return source.replace(from,to);}
let flow=read(join(original,'rpg-flow.js'));
flow=flow.replace("import path from 'node:path';\n",'').replace("import { createRpgApi, loadRpgConfig } from './rpg-api.js';\n",'').replace("import { bossCardBytes } from './rpg-boss-card.js';\n",'');
flow="import {persistentMap,synchronousSave} from './persistent-map.js';\n"+flow;
flow=once(flow,"chatId, botUsername = () => '', rpgApi = null, configFile = path.resolve(import.meta.dirname, '..', 'rpg.local.json'), readFile, mode = 'all',", "chatId, botUsername = () => '', rpgApi = null, mode = 'all', renderPartyCard, animationRenderer, outboxClaimLimit = 2,",'flow config');
const configStart=flow.indexOf("  if (!client && mode !== 'operations') {");
const configEnd=flow.indexOf("  if (mode === 'operations')",configStart);
if(configStart<0||configEnd<configStart)throw Error('flow config block missing');
flow=flow.slice(0,configStart)+"  // Cloud mode receives an internal game API and explicit configuration; it never reads local files.\n"+flow.slice(configEnd);
flow=once(flow,'const save = () => tgStore?.save();','const save = () => synchronousSave(tgStore);','synchronous store contract');
flow=once(flow,'d.scards ??= {}; d.pcards ??= {}; d.pq ??= []; delete d.tcards; return d;', 'd.drafts ??= {}; d.cards ??= {}; d.scards ??= {}; d.pcards ??= {}; d.pq ??= []; delete d.tcards; return d;', 'bootstrap empty store maps');
flow=once(flow,"const members = new Map(); const dirty = new Map(); const sdirty = new Map(); const photoCache = new Map(); let lastClaim = 0; let lastPhoto = 0; let ticking = false;", "const members = new Map(); const dirty = persistentMap(st,save,'dirtyBoss'); const sdirty = persistentMap(st,save,'dirtyShare');\n  const timing=()=>st().cloudTiming??={lastClaim:0,lastPhoto:0}; let lastClaim=timing().lastClaim||0,lastPhoto=timing().lastPhoto||0,ticking=false;",'durable dirty maps');
flow=once(flow,"const partyFlow=createPartyFlow({api,client,send,popup,st,save,chatId,deepLink,appBtn,now,warn});", "const partyFlow=createPartyFlow({api,client,send,popup,st,save,chatId,deepLink,appBtn,now,warn,animationRenderer,renderPartyCard});",'party dependencies');
flow=once(flow,"const pkAnimations=createPkAnimationFlow({api,client,send,editText:editMsg,st,save,chatId,now,warn,text:pkText,keyboard:pkKeyboard});", "const pkAnimations=createPkAnimationFlow({api,client,send,editText:editMsg,st,save,chatId,now,warn,text:pkText,keyboard:pkKeyboard,animationRenderer});",'PK dependencies');
const cardStart=flow.indexOf('  async function cardBytes(photo) {');
const cardEnd=flow.indexOf('  async function postShare(sh) {',cardStart);
if(cardStart<0||cardEnd<cardStart)throw Error('card block missing');
flow=flow.slice(0,cardStart)+`  function photoReference(photo) {
    if(!photo||!app.url)return null;try{const url=new URL(photo,app.url);return url.protocol==='https:'?url.href:null;}catch{return null;}
  }
  function rejectedImage(error){const code=Number(error?.errorCode||error?.httpStatus);return error?.definite===true&&[400,404].includes(code)&&/photo|image|file(?:[_ ]id)?|failed to get http url content|wrong type of (?:the )?web page content/i.test(error?.description||'');}
  async function sendCardPhoto(input){return api.sendPhoto(input);}
`+flow.slice(cardEnd);
flow=once(flow,"const buf = typeof api.sendPhoto === 'function' ? await cardBytes(sh.item?.photo) : null;", "const photoUrl = typeof api.sendPhoto === 'function' ? photoReference(sh.item?.photo) : null;",'share photo URL');
flow=once(flow,"if (buf) { try { m = await sendCardPhoto({ chatId, buffer: buf, photoUrl:sh.item.photo, mimeType: 'image/jpeg', fileName: (sh.item.photo.split('/').pop() || 'item.jpg'), caption, replyMarkup: { inline_keyboard: kb } }); photo = true; } catch (error) { warn('share photo', error); } }", "if (photoUrl) { try { m = await sendCardPhoto({ chatId, photoUrl, mimeType: 'image/jpeg', fileName: (sh.item.photo.split('/').pop() || 'item.jpg'), caption, replyMarkup: { inline_keyboard: kb } }); photo = true; } catch (error) { if(!rejectedImage(error))throw error;warn('share photo', error); } }",'share safe fallback');
flow=once(flow,"q.shift(); save(); lastPhoto = now();", "q.shift(); lastPhoto = now();timing().lastPhoto=lastPhoto;save();",'photo timing');
flow=once(flow,"const buffer = typeof api.sendPhoto === 'function' ? bossCardBytes(p.boss) : null;\n        const photo = Boolean(buffer);", "const map=Math.max(1,Math.min(12,Math.trunc(Number(p.boss.mapId)||2)));\n        const photoUrl=typeof api.sendPhoto==='function'?photoReference('/telegram-media/boss-'+map+'.jpg'):null;\n        const photo=Boolean(photoUrl);",'boss existing URL');
flow=once(flow,"{ chatId, buffer, mimeType: 'image/png', fileName: `boss-${p.boss.mapId}.png`, caption: bossCaption(p.boss), replyMarkup: { inline_keyboard: bossKeyboard(p.boss) } }", "{ chatId, photoUrl, mimeType: 'image/jpeg', fileName: `boss-${map}.jpg`, caption: bossCaption(p.boss), replyMarkup: { inline_keyboard: bossKeyboard(p.boss) } }",'boss photo args');
flow=once(flow,"const buf = typeof api.sendPhoto === 'function' ? await cardBytes(gearShare.item?.photo) : null;", "const photoUrl = typeof api.sendPhoto === 'function' ? photoReference(gearShare.item?.photo) : null;",'boss gear URL');
flow=once(flow,"if (buf) {\n              try {", "if (photoUrl) {\n              try {",'boss gear predicate');
flow=once(flow,"{ chatId, buffer: buf, photoUrl:gearShare.item.photo, mimeType: 'image/jpeg'", "{ chatId, photoUrl, mimeType: 'image/jpeg'",'boss gear args');
flow=once(flow,"} catch (error) { warn('boss gear photo', error); }", "} catch (error) { if(!rejectedImage(error))throw error;warn('boss gear photo', error); }",'boss gear safe fallback');
flow=once(flow,'  async function tick() {','  async function tick({forceOutbox=false}={}) {','tick force option');
flow=once(flow,'if (t - lastClaim >= outboxEveryMs) {','if (forceOutbox || t - lastClaim >= outboxEveryMs) {','tick interval');
flow=once(flow,'lastClaim = t; const slot = currentSlot(t);','lastClaim = t;timing().lastClaim=t;save();const slot = currentSlot(t);','claim timing');
flow=once(flow,"const ob = await client.call('/rpg/outbox/claim', { limit: 20 }).catch((e) => warn('outbox', e));", "const ob = await client.call('/rpg/outbox/claim', { limit: Math.max(1,Math.min(20,Math.trunc(outboxClaimLimit)||2)) }).catch((e) => warn('outbox', e));\n        out.claimed=ob?.items?.length||0;out.hasMore=out.claimed>=Math.max(1,Math.min(20,Math.trunc(outboxClaimLimit)||2));",'two-item lease');
flow=once(flow,'      return out;\n    } finally { ticking = false; }', "      out.pendingPhotos=st().pq.length;out.pendingPartyEdits=st().dirtyParty?.length||0;out.nextWakeAt=Math.min(lastClaim+outboxEveryMs,st().pq.length?lastPhoto+photoGapMs:Infinity,dirty.size||sdirty.size||out.pendingPartyEdits?now()+editThrottleMs:Infinity);\n      return out;\n    } finally { ticking = false; }",'wake result');
writeFileSync(join(root,'rpg-flow.js'),flow);
let party=read(join(original,'rpg-party-flow.js'));
party=party.replace("import {renderPartyCard,partyCaption} from './rpg-party-card.js';", "import {partyCaption} from './party-caption.js';\nimport {persistentMap} from './persistent-map.js';");
party=party.replace("import {renderBattleAnimation,battleKey} from './rpg-battle-animation.js';", "import {battleKey} from './battle-key.js';");
party=once(party,'animationRenderer=renderBattleAnimation})','animationRenderer,renderPartyCard})','party renderer args');
party=once(party,'const dirty=new Map(),inflight=new Map();',"const dirty=persistentMap(st,save,'dirtyParty'),inflight=new Map();",'party durable dirty');
party=party.replaceAll('buffer:renderPartyCard(p)','buffer:await renderPartyCard(p)');
party=once(party,"catch(e){animation=null;warn('party animation upload',e);}", "catch(e){if(e?.definite===false)throw e;animation=null;warn('party animation upload',e);}",'party new GIF ambiguity');
party=once(party,"catch(e){warn('party art',e);}", "catch(e){if(e?.definite===false)throw e;warn('party art',e);}",'party new photo ambiguity');
party=once(party,"catch(e){warn('party animation upload',e);animation=null;", "catch(e){if(e?.definite===false)throw e;warn('party animation upload',e);animation=null;",'party edit ambiguity');
writeFileSync(join(root,'rpg-party-flow.js'),party);
let pk=read(join(original,'rpg-pk-animation-flow.js'));
pk=pk.replace("import {renderBattleAnimation,battleKey} from './rpg-battle-animation.js';", "import {battleKey} from './battle-key.js';");
pk=once(pk,'animationRenderer=renderBattleAnimation})','animationRenderer})','PK renderer args');
pk=once(pk,"catch(e){warn('pk animation',e);}","catch(e){if(e?.definite===false)throw e;warn('pk animation',e);}",'PK ambiguity');
writeFileSync(join(root,'rpg-pk-animation-flow.js'),pk);
const nativeCard=read(join(original,'rpg-party-card.js'));
const caption=nativeCard.split('\n').find(line=>line.startsWith('export function partyCaption('));
if(!caption)throw Error('party caption missing');writeFileSync(join(root,'party-caption.js'),caption+'\n');
const nativeAnimation=read(join(original,'rpg-battle-animation.js'));
const battleKey=nativeAnimation.split('\n').find(line=>line.startsWith('export function battleKey('));
if(!battleKey)throw Error('battleKey missing');writeFileSync(join(root,'battle-key.js'),battleKey+'\n');
let bot=read(botPath);
bot=bot.replace("import {createRpgFlow,RPG_CALLBACK_RE} from '../爆分監控/src/rpg-flow.js';", "import {createRpgFlow,RPG_CALLBACK_RE} from './rpg-flow.js';\nimport {createOperationApi} from './operation-api.js';");
bot=bot.replace("import {gameFetch} from './game-fetch.mjs';\n",'');
bot=once(bot,'export function createGameBot({config,api,store,log=console,rpgApi}){', "export function createCloudBot({config,api,store,log=console,rpgApi,renderBattleAnimation,renderPartyCard,fetchImpl=globalThis.fetch,now=()=>Date.now(),outboxClaimLimit=2}){\n if(!store||typeof store.save!=='function')throw new TypeError('Cloud BOT needs a synchronous durable store');\n if(!rpgApi||typeof rpgApi.call!=='function')throw new TypeError('Cloud BOT needs the internal game API');\n if(typeof renderBattleAnimation!=='function'||typeof renderPartyCard!=='function')throw new TypeError('Cloud BOT requires both real animation and party-card renderers');\n const operations=createOperationApi({base:rpgApi,store,now});",'cloud BOT entry');
bot=bot.replaceAll('Date.now()', 'now()');
// Restore the default clock expression after replacing original membership cache clock references.
bot=bot.replace('now=()=>now()', 'now=()=>Date.now()');
bot=once(bot,"configFile:config.rpgConfigFile,rpgApi,fetchImpl:gameFetch,mode:'life'", "rpgApi:operations,fetchImpl,mode:'life',appUrl:config.appUrl,mainMiniApp:config.mainMiniApp===true,now,animationRenderer:renderBattleAnimation,renderPartyCard,outboxClaimLimit",'injected cloud dependencies');
bot=once(bot,"return {handle,tick:()=>config.active?flow.tick():Promise.resolve({staged:true}),active:config.active===true};", "let queue=Promise.resolve();const serial=task=>{const next=queue.catch(()=>{}).then(task);queue=next;return next;};\n return {handle:update=>serial(()=>operations.runUpdate(update,()=>handle(update))),tick:options=>serial(()=>config.active?flow.tick(options):Promise.resolve({staged:true})),active:config.active===true,commands};",'serialized operation context');
writeFileSync(join(root,'cloud-bot.js'),bot);
writeFileSync(join(root,'package.json'),JSON.stringify({private:true,type:'module'},null,2)+'\n');
writeFileSync(join(root,'adaptation-source.json'),JSON.stringify({adaptedAt:new Date().toISOString(),liveFilesModified:false,secretsRead:false,sources,notes:['No source config, service process, Telegram state or credentials were read or changed.','Refresh only this adapter from the newest code if the original source changes before deployment.','Original game API remains injected; this adapter never calls Windows or filesystem configuration.']},null,2)+'\n');
console.log(JSON.stringify({adapted:true,files:['cloud-bot.js','rpg-flow.js','rpg-party-flow.js','rpg-pk-animation-flow.js','party-caption.js','battle-key.js'],sources:sources.length}));
