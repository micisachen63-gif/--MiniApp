import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import * as F from '../src/services/fate.js';
import * as SHARED from '../src/services/fate-shared.js';
import {createCharacter} from '../src/services/player.js';
import {handle} from '../src/index.js';
const SECRET='fate-dm-test-secret',at=s=>Date.parse(s+'+08:00'),T=at('2026-10-16T06:30:00'),rid=()=>crypto.randomUUID();
async function fixture(t,{members=['202','303']}={}){
 const set=new Set(members),checks=[];
 const env={DB:freshDb(),SERVICE_SECRET:SECRET,ENVIRONMENT:'development',ALLOW_DEBUG_TIME:'true',GROUP_CHAT_ID:'-100555',FATE_SOCIAL_MEMBERSHIP:async accounts=>{checks.push(accounts);return {ok:true,members:accounts.map(accountId=>({accountId,member:set.has(accountId)}))};}};
 t.after(()=>env.DB.sqlite.close());
 for(const id of ['101','202','303'])await createCharacter(env,{tgId:id,name:'旅人'+id,baseClass:'sword',gender:'m'},T);
 const db=env.DB.sqlite,one=(sql,...a)=>db.prepare(sql).get(...a),all=(sql,...a)=>db.prepare(sql).all(...a),exec=(sql,...a)=>db.prepare(sql).run(...a);
 const svc=async(path,body={},now=T)=>{const res=await handle(new Request('https://game.test/rpg/'+path,{method:'POST',headers:{'content-type':'application/json','X-Service-Secret':SECRET,'X-Debug-Now':String(now)},body:JSON.stringify(body)}),env);return {status:res.status,...await res.json()};};
 const enable=(id,now=T)=>SHARED.savePreferences(env,id,{enabled:true,allowMentions:true,consent:true,requestId:rid()},now);
 return {env,one,all,exec,svc,enable,set,checks};
}
test('starting a life tags only opted-in group members whose nickname joined the cast, once, without leaking other accounts',async t=>{
 const f=await fixture(t);await f.enable('202');
 const body={requestId:rid(),country:'TW'};
 // An opaque life UUID may contain another account's digits without exposing it.
 const forced=t.mock.method(crypto,'randomUUID',()=> '00000303-0000-4000-8000-000000000000');
 try{await F.start(f.env,'101',body,T);}finally{forced.mock.restore();}
 const rows=f.all("SELECT * FROM rpg_outbox WHERE kind='fate_cast'");assert.equal(rows.length,1);
 const row=rows[0],payload=JSON.parse(row.payload_json);assert.equal(row.target,'group');assert.equal(payload.accountId,'202');assert.equal(payload.castName,'旅人202');assert.equal(payload.ownerName,'旅人101');assert.ok(payload.role);assert.match(payload.lifeId,/^[0-9a-f]{32}$/);assert.ok(payload.lifeId.includes('303'));
 const {lifeId,...identityFields}=payload;assert.ok(!JSON.stringify(identityFields).includes('303'));
 assert.deepEqual(Object.keys(payload).sort(),['lifeId','accountId','castName','ownerName','thread','role'].sort());
 await F.start(f.env,'101',body,T+1000);assert.equal(f.all("SELECT * FROM rpg_outbox WHERE kind='fate_cast'").length,1);
 assert.equal(f.one('SELECT mentions FROM rpg_fate_social_limits WHERE account_id=?','202').mentions,1);
});
test('cast notice honours opt-in, quiet day, membership, night and the two-tags-a-day limit',async t=>{
 const f=await fixture(t,{members:['202']}),people=lifeId=>[{account:'202',name:'旅人202',thread:'ferry'},{account:'303',name:'旅人303',thread:'rival'}];
 const count=()=>f.all("SELECT * FROM rpg_outbox WHERE kind='fate_cast'").length;
 assert.equal((await SHARED.castNotice(f.env,{lifeId:'life-aaaa0001',ownerName:'旅人101',people:people()},T)).sent,0);
 await f.enable('202');await f.enable('303');
 assert.equal((await SHARED.castNotice(f.env,{lifeId:'life-aaaa0002',ownerName:'旅人101',people:people()},at('2026-10-16T02:00:00'))).sent,0);
 assert.equal((await SHARED.castNotice(f.env,{lifeId:'life-aaaa0003',ownerName:'旅人101',people:people()},T)).sent,1);assert.equal(count(),1);
 assert.deepEqual(f.checks.at(-1).sort(),['202','303']);
 await SHARED.castNotice(f.env,{lifeId:'life-aaaa0004',ownerName:'旅人101',people:people()},T);await SHARED.castNotice(f.env,{lifeId:'life-aaaa0005',ownerName:'旅人101',people:people()},T);
 assert.equal(count(),2);assert.equal(f.one('SELECT mentions FROM rpg_fate_social_limits WHERE account_id=?','202').mentions,2);
 f.exec('UPDATE rpg_fate_social_preferences SET quiet_until=? WHERE account_id=?',at('2026-10-17T00:00:00'),'202');
 assert.equal((await SHARED.castNotice(f.env,{lifeId:'life-aaaa0006',ownerName:'旅人101',people:people()},at('2026-10-17T00:00:00')-1000)).sent,0);
 f.env.GROUP_CHAT_ID='';assert.equal((await SHARED.castNotice(f.env,{lifeId:'life-aaaa0007',ownerName:'旅人101',people:people()},T)).sent,0);
});
test('general fate events become private messages to the account, independent of the group chat id; deduped per page',async t=>{
 const f=await fixture(t);f.env.GROUP_CHAT_ID='';
 await F.start(f.env,'101',{requestId:rid(),country:'TW'},T);
 const slot=f.one("SELECT next_at FROM rpg_fate_lives WHERE status='active'").next_at;
 await F.sweep(f.env,slot);await F.sweep(f.env,slot+1000);
 const rows=f.all("SELECT * FROM rpg_outbox WHERE kind='fate_event'");assert.equal(rows.length,1);
 assert.equal(rows[0].target,'dm');assert.equal(rows[0].tg_id,'101');assert.equal(JSON.parse(rows[0].payload_json).accountId,'101');
 assert.equal(f.all("SELECT * FROM rpg_outbox WHERE kind='fate_event' AND target='group'").length,0);
 const claimed=await f.svc('outbox/claim',{limit:5},slot+2000);assert.ok(claimed.items.some(i=>i.kind==='fate_event'&&i.target==='dm'&&i.tgId==='101'));
});
test('a 403 private-message failure raises the derived start-the-bot hint; a later delivery or /start clears it; no table needed',async t=>{
 const f=await fixture(t);
 await F.start(f.env,'101',{requestId:rid(),country:'TW'},T);const slot=f.one("SELECT next_at FROM rpg_fate_lives WHERE status='active'").next_at;await F.sweep(f.env,slot);
 assert.equal((await F.state(f.env,'101',slot)).dmBlocked,false);
 let claim=await f.svc('outbox/claim',{limit:5},slot+10),item=claim.items.find(i=>i.kind==='fate_event');
 const fail=await f.svc('outbox/fail',{ids:[item.id],claimToken:item.claimToken,errorCode:403,error:'Forbidden: bot can\'t initiate conversation with a user'},slot+20);assert.equal(fail.failed,1);
 assert.equal((await F.state(f.env,'101',slot+30)).dmBlocked,true);assert.equal((await F.state(f.env,'202',slot+30)).dmBlocked,false);
 assert.equal((await F.state(f.env,'101',slot+31*86400000)).dmBlocked,false);
 // /start in private chat clears it
 assert.equal((await f.svc('notify/dm-reachable',{tgId:'101'},slot+40)).cleared,1);assert.equal((await F.state(f.env,'101',slot+50)).dmBlocked,false);
 // a delivered private message also clears it
 f.exec("UPDATE rpg_outbox SET last_error=substr(last_error,9) WHERE failed_at IS NOT NULL");assert.equal((await F.state(f.env,'101',slot+60)).dmBlocked,true);
 f.exec("INSERT INTO rpg_outbox(dedupe_key,target,tg_id,kind,payload_json,created_at) VALUES('dm:101:x','dm','101','low_supply','{}',?)",slot);
 claim=await f.svc('outbox/claim',{limit:5},slot+70);const dm=claim.items.find(i=>i.kind==='low_supply');
 await f.svc('outbox/ack',{ids:[dm.id],claimToken:dm.claimToken},slot+80);assert.equal((await F.state(f.env,'101',slot+90)).dmBlocked,false);
});
test('403 stays a permanent failure for the outbox row (no retry storm)',async t=>{
 const f=await fixture(t);f.exec("INSERT INTO rpg_outbox(dedupe_key,target,tg_id,kind,payload_json,created_at) VALUES('dm:101:y','dm','101','fate_event','{}',?)",T);
 const item=(await f.svc('outbox/claim',{limit:5},T+1)).items[0];await f.svc('outbox/fail',{ids:[item.id],claimToken:item.claimToken,errorCode:403,error:'Forbidden'},T+2);
 const row=f.one("SELECT failed_at,last_error_code FROM rpg_outbox WHERE dedupe_key='dm:101:y'");assert.ok(row.failed_at);assert.equal(row.last_error_code,403);assert.equal((await f.svc('outbox/claim',{limit:5},T+3600000)).items.length,0);
});
import fs from 'node:fs';
import {MONSTER_DATA} from '../src/game/monster-data.js';
import {ITEMS} from '../src/game/constants.js';
import {bossView} from '../src/views.js';
test('every one of the 24 bosses has its own 960x760 Telegram card image, and the boss view carries spriteKey and collection material name',()=>{
 const bosses=MONSTER_DATA.filter(m=>m.role==='boss');assert.equal(bosses.length,24);
 for(const b of bosses){
  const bytes=fs.readFileSync(new URL('../public/telegram-media/boss/'+b.spriteKey+'.jpg',import.meta.url));assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8);
  let i=2,w=0,h=0;while(i<bytes.length){if(bytes[i]!==0xff){i++;continue;}const m=bytes[i+1];if(m>=0xc0&&m<=0xc3){h=bytes.readUInt16BE(i+5);w=bytes.readUInt16BE(i+7);break;}i+=2+bytes.readUInt16BE(i+2);}
  assert.deepEqual([w,h],[960,760],b.spriteKey);assert.ok(bytes.length>100000&&bytes.length<400000,b.spriteKey+' '+bytes.length);
  const v=bossView({id:'x',map_id:b.mapId,name:b.name,element:'fire',max_hp:100,hp:100,participants:0,status:'active',started_at:0,ends_at:60000},[],0);
  assert.equal(v.spriteKey,b.spriteKey);assert.equal(v.collectionMaterialName,ITEMS[b.material].name);
 }
});
