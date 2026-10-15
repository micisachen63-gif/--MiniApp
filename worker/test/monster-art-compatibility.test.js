import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {MONSTER_ART_REVISION,monsterArtCompatibility} from '../src/game/monster-art-compatibility.js';
import {appAuth,APP_ACTIONS,metaView} from '../src/app.js';
import {freshDb} from './d1-shim.js';import * as P from '../src/services/player.js';import {handle} from '../src/index.js';import {loadPlayer} from '../src/db.js';
import {createHash} from 'node:crypto';import {MONSTER_DATA} from '../src/game/monster-data.js';
import {MONSTER_ART_REVISION as RELEASE_REVISION} from '../src/game/monster-readiness.js';
const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
function appHarness(readyKeys,compatibility=monsterArtCompatibility){
 let mutations=0,reads=0;const env={ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',DB:{prepare(){reads++;throw Error('unexpected database access');}}},respond=(body,status=200)=>new Response(JSON.stringify(body),{status}),fail=(error,message,status=400)=>respond({ok:false,error,message},status);
 const routes=Object.fromEntries(Object.values(APP_ACTIONS).map(path=>[`POST ${path}`,async()=>{mutations++;return {ok:true};}]));
 const ctx=vm.createContext({crypto,appAuth,APP_ACTIONS,metaView,monsterArtCompatibility:(action,revision)=>compatibility(action,revision,{readyKeys}),activeCharacterId:async()=>{reads++;return '111';},listAccountCharacters:async()=>{reads++;return [];},P:{createCharacter:async()=>mutations++},selectAccountCharacter:async()=>{mutations++;return '111';}});
 vm.runInContext(source.slice(source.indexOf('export async function handleApp('),source.indexOf('export { GameError };')).replace('export async','async')+';this.run=handleApp;',ctx);
 const call=async(action,revision)=>{const headers={'Content-Type':'application/json','X-Dev-Tg-Id':'111'};if(revision!==undefined)headers['X-Monster-Art-Revision']=revision;const url=new URL('http://rpg/app/api/'+action),request=new Request(url,{method:'POST',headers,body:JSON.stringify({requestId:'test-client-01',item:'red_1',qty:1})}),response=await ctx.run(request,env,url,{routes,json:respond,fail,nowFor:()=>0});return {status:response.status,...await response.json()};};
 return {call,get mutations(){return mutations},get reads(){return reads}};
}
test('active4x4 release rejects missing/stale revisions before create/select/idle settlement or inventory routes perform any read or write',async()=>{
 const h=appHarness(['new-ready-monster']);for(const action of ['create','select','me','buy','monster-exchange','boss/attack','auto-enhance/start'])for(const revision of [undefined,'old-5x2']){const r=await h.call(action,revision);assert.equal(r.status,409);assert.equal(r.error,'assets_update_required');assert.equal(r.message,'怪物內容已更新，請關閉遊戲後重新開啟，載入新圖與動畫。');}
 assert.equal(h.mutations,0);assert.equal(h.reads,0);
});
test('matching revision reaches the intended mutation once; empty readiness keeps old clients usable',async()=>{
 const current=appHarness(new Set(['new-ready-monster']));assert.equal((await current.call('buy',MONSTER_ART_REVISION)).status,200);assert.equal(current.mutations,1);
 const prior=appHarness([]);assert.equal((await prior.call('buy')).status,200);assert.equal(prior.mutations,1);assert.equal(monsterArtCompatibility('buy',null,{readyKeys:[]}),null);
});
test('metadata/character listing remain read-only bootstrap paths and metadata advertises the exact required art revision',async()=>{
 const h=appHarness(['new-ready-monster']),meta=await h.call('meta'),characters=await h.call('characters');assert.equal(meta.status,200);assert.equal(meta.meta.monsterArtRevision,MONSTER_ART_REVISION);assert.equal(meta.meta.monsterExpansion.revision,MONSTER_ART_REVISION);assert.equal(characters.status,200);assert.deepEqual(characters.characters,[]);assert.equal(h.mutations,0);
});
test('service-authenticated BOT purchase remains independent of Mini App art headers',async()=>{
 const env={DB:freshDb(),SERVICE_SECRET:'test-monster-revision-secret'},now=Date.now();await P.createCharacter(env,{tgId:'111',name:'素材服務測試',gender:'m',baseClass:'sword'},now);
 const response=await handle(new Request('http://rpg/rpg/buy',{method:'POST',headers:{'Content-Type':'application/json','X-Service-Secret':env.SERVICE_SECRET},body:JSON.stringify({tgId:'111',item:'red_1',qty:1,requestId:'service-buy-01'})}),env);assert.equal(response.status,200);const p=await loadPlayer(env.DB,'111');assert.equal(p.inv.red_1,151);assert.equal(p.char.gold,994);
});
test('full108 content digest blocks a cached partial30 catalogue and old fixed v1 before mutations',async()=>{
 const complete=MONSTER_DATA.filter(m=>m.expansion),hash=rows=>'monster16-v2-'+createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0,24),full=hash(complete),partial=hash(complete.slice(0,30));assert.notEqual(full,partial);assert.equal(MONSTER_ART_REVISION,RELEASE_REVISION);
 // Evaluate the actual pure compatibility helper against a simulated release module.
 // No READY keys or release files are changed by the test.
 const fixture=vm.createContext({READY_MONSTER_KEYS:[],MONSTER_ART_REVISION:full}),helper=fs.readFileSync(new URL('../src/game/monster-art-compatibility.js',import.meta.url),'utf8');vm.runInContext(helper.slice(helper.indexOf('export function monsterArtCompatibility')).replace('export function','function')+';this.run=monsterArtCompatibility;',fixture);
 const h=appHarness(complete.map(m=>m.spriteKey),fixture.run);for(const stale of [partial,'20261013-expansion1','pending'])assert.equal((await h.call('buy',stale)).error,'assets_update_required');assert.equal(h.mutations,0);assert.equal(h.reads,0);assert.equal((await h.call('buy',full)).status,200);assert.equal(h.mutations,1);
});
