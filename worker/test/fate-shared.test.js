import {ensureCountryPack} from '../public/fate/country-runtime-v9.js';
import {COUNTRY_METADATA_V9} from '../public/fate/country-runtime-v9.js';
import {countryProfile} from '../public/fate/country-engine-v9.js';
import {hash as storyHash} from '../public/fate/world.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {createCharacter} from '../src/services/player.js';
import * as S from '../src/services/fate-shared.js';
import {createLife,addActive,LIFE_MS} from '../public/fate/life.js';
import {formalEvents} from '../public/fate/formal-events.js';
import {sharedMemories} from '../public/fate/shared-story.js';

const at=s=>Date.parse(s+'+08:00'),T=at('2026-10-16T09:00:00'),M=60000;
const rid=()=>crypto.randomUUID();
const error=code=>e=>e.code===code;
async function fixture(t){
 const checks=[],members=new Set(['101','202','303','404']);
 const env={DB:freshDb(),GROUP_CHAT_ID:'-100555',FATE_SOCIAL_MEMBERSHIP:async accounts=>{checks.push(accounts);return {ok:true,members:accounts.map(accountId=>({accountId,member:members.has(accountId)}))}}};
 t.after(()=>env.DB.sqlite.close());
 for(const id of ['101','202','303','404'])await createCharacter(env,{tgId:id,name:'旅人'+id,baseClass:'sword',gender:'m'},T);
 const db=env.DB.sqlite,one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 async function enable(id,now=T){return S.savePreferences(env,id,{enabled:true,allowMentions:true,consent:true,requestId:rid()},now)}
 let n=0;
 async function begin(id='101',now=T,version=4,country='JP'){
  if(version===9)await ensureCountryPack(country);
  const lifeId='life-'+id+'-'+n++,draft=createLife({version,country:version===8?'TW':version===9?country:undefined,orbit:3,seed:'deadbeef',startedAt:now});
  run("INSERT INTO rpg_fate_lives(id,char_id,account_id,state_json,status,started_at,next_at) VALUES(?,?,?,?,'active',?,?)",lifeId,id,id,JSON.stringify(draft),now,now+24*M);
  return {lifeId,charId:id,accountId:id,name:'旅人'+id,draft};
 }
 async function paired(now=T){await enable('101',now);await enable('202',now);const life=await begin('101',now);assert.equal((await S.schedule(env,life,now)).scheduled,true);return {...one('SELECT * FROM rpg_fate_social_choices WHERE life_id=?',life.lifeId),life};}
 return {env,db,one,all,run,enable,begin,paired,members,checks};
}

test('cooperation defaults off, consent is explicit, quiet today expires at Taipei midnight and receipts are stable',async t=>{
 const f=await fixture(t);assert.deepEqual((await S.preferences(f.env,'101',T)).preferences,{enabled:false,allowMentions:false,quietToday:false,quietUntil:0,rev:0});
 await assert.rejects(S.savePreferences(f.env,'101',{enabled:true,allowMentions:true,requestId:rid()},T),error('consent'));
 const b={enabled:true,allowMentions:true,consent:true,quietToday:true,requestId:rid()},first=await S.savePreferences(f.env,'101',b,T);
 assert.equal(first.result.preferences.quietUntil,at('2026-10-17T00:00:00'));assert.equal((await S.savePreferences(f.env,'101',b,T+1)).replayed,true);
 await assert.rejects(S.savePreferences(f.env,'101',{...b,quietToday:false},T+2),error('request_changed'));
 assert.equal((await S.preferences(f.env,'101',at('2026-10-17T06:00:00'))).preferences.quietToday,false);
});

test('only consenting recent current group members join the private pool; own account and unknown membership never do',async t=>{
 const f=await fixture(t);await f.enable('101');const life=await f.begin();assert.equal((await S.schedule(f.env,life,T)).scheduled,false);
 await f.enable('202');f.members.delete('202');assert.equal((await S.schedule(f.env,life,T)).scheduled,false);
 f.members.add('202');f.run('UPDATE rpg_fate_social_preferences SET active_at=? WHERE account_id=?',T-86400001,'202');assert.equal((await S.schedule(f.env,life,T)).scheduled,false);
 await S.preferences(f.env,'202',T);f.env.FATE_SOCIAL_MEMBERSHIP=async()=>{throw Error('timeout')};assert.equal((await S.schedule(f.env,life,T)).scheduled,false);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_choices').n,0);
});

test('one private event per life and per pending account; open at minute40 atomically queues only opaque eventId',async t=>{
 const f=await fixture(t),r=await f.paired();assert.equal(r.opened_at,T+40*M);assert.equal(r.deadline_at,T+50*M);
 assert.equal((await S.schedule(f.env,r.life,T+1)).scheduled,true);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_choices').n,1);
 await f.enable('303');const other=await f.begin('303');assert.equal((await S.schedule(f.env,other,T)).scheduled,false,'owner and guest account locks both exclude pending accounts');
 await S.sweep(f.env,T+40*M-1);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_outbox').n,0);
 await Promise.all([S.sweep(f.env,T+40*M),S.sweep(f.env,T+40*M)]);
 const out=f.all("SELECT * FROM rpg_outbox WHERE kind='fate_social'");assert.equal(out.length,1);assert.deepEqual(JSON.parse(out[0].payload_json),{eventId:r.id});
 assert.equal(f.one('SELECT status FROM rpg_fate_social_choices').status,'pending');assert.deepEqual(f.all('SELECT mentions FROM rpg_fate_social_limits').map(x=>x.mentions),[1,1]);
});

test('guest alone answers, strangers and another character cannot decide; fixed deadline reveals a safe outcome only',async t=>{
 const f=await fixture(t),r=await f.paired(),now=T+40*M;await S.sweep(f.env,now);
 await assert.rejects(S.reply(f.env,'101',{eventId:r.id,answer:1,requestId:rid()},now),error('designated_player'));
 await assert.rejects(S.event(f.env,'303',{eventId:r.id},now),error('not_found'));
 await assert.rejects(S.reply(f.env,'202',{eventId:r.id,answer:2,requestId:rid()},now),error('answer'));
 const before=f.one('SELECT state_json,rev FROM rpg_fate_lives WHERE id=?',r.life_id),b={eventId:r.id,answer:0,requestId:rid()};
 const done=await S.reply(f.env,'202',b,now);assert.equal(done.result.event.status,'answered');assert.equal((await S.reply(f.env,'202',b,now+1)).replayed,true);
 await assert.rejects(S.reply(f.env,'202',{...b,answer:1},now+2),error('request_changed'));
 assert.deepEqual(await S.outcomes(f.env,r.life_id,r.deadline_at-1),[]);
 const outcome=await S.outcomes(f.env,r.life_id,r.deadline_at);assert.equal(outcome[0].answer,0);assert.ok(outcome[0].text.includes('旅人202'));assert.match(outcome[0].id,/^shared-(garden|harbor|lamp|workshop|map|book)$/);
 assert.ok(!/account|char|202|101|life-/.test(JSON.stringify(outcome).replaceAll('旅人101','甲').replaceAll('旅人202','乙')));
 assert.deepEqual(f.one('SELECT state_json,rev FROM rpg_fate_lives WHERE id=?',r.life_id),before,'no owner or guest life snapshot overwritten');assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_locks').n,0);
 const view=(await S.event(f.env,'202',{eventId:r.id},now)).event;assert.ok(!Object.keys(view).some(k=>/account|charId|lifeId/i.test(k)));
});

test('answer races with another answer, expiry or withdrawal produce one immutable terminal receipt',async t=>{
 const f=await fixture(t),r=await f.paired(),now=T+40*M;await S.sweep(f.env,now);
 const both=await Promise.all([S.reply(f.env,'202',{eventId:r.id,answer:0,requestId:rid()},now),S.reply(f.env,'202',{eventId:r.id,answer:1,requestId:rid()},now)]);
 const row=f.one('SELECT * FROM rpg_fate_social_choices');assert.equal(row.status,'answered');assert.ok([0,1].includes(row.answer));assert.ok(both.every(result=>result.result.event.answer===row.answer));
 await S.withdraw(f.env,'101',{eventId:r.id,requestId:rid()},now+1);await S.sweep(f.env,r.deadline_at);assert.equal(f.one('SELECT answer FROM rpg_fate_social_choices').answer,row.answer);
});

test('silent decline and owner withdrawal end invitations without blocking or penalizing life completion',async t=>{
 for(const kind of ['decline','withdraw']){const f=await fixture(t),r=await f.paired(),now=T+40*M;await S.sweep(f.env,now);
  const result=await S[kind](f.env,kind==='decline'?'202':'101',{eventId:r.id,requestId:rid()},now);assert.equal(result.result.event.status,kind==='decline'?'declined':'withdrawn');
  assert.equal((await S.notification(f.env,{eventId:r.id},now)).valid,false);const outcome=await S.outcomes(f.env,r.life_id,r.deadline_at);assert.equal(outcome[0].answer,null);assert.ok(outcome[0].text.length>25);
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_ledger WHERE type LIKE ?', '%fate%').n,0);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_locks').n,0);
 }
});

test('guest-disabled preferences revoke work and leaving the group fails closed, but temporary character switching preserves the event',async t=>{
 const f=await fixture(t),r=await f.paired(),now=T+40*M;await S.sweep(f.env,now);f.members.delete('202');
 assert.equal((await S.notification(f.env,{eventId:r.id,guestAccountId:'404'},now)).valid,false);assert.equal(f.one('SELECT status FROM rpg_fate_social_choices').status,'auto');
 const g=await fixture(t),q=await g.paired();await S.savePreferences(g.env,'202',{enabled:false,allowMentions:false,requestId:rid()},T+1);assert.equal(g.one('SELECT status FROM rpg_fate_social_choices').status,'auto');
 const h=await fixture(t),z=await h.paired();h.run('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?','unavailable-alt','202');
 await S.sweep(h.env,z.opened_at);assert.equal(h.one('SELECT status FROM rpg_fate_social_choices').status,'pending');assert.equal(h.one('SELECT COUNT(*) n FROM rpg_outbox').n,1);
 assert.equal((await S.notification(h.env,{eventId:z.id},z.opened_at)).valid,true,'the originally bound character still exists and belongs to the guest account');
});

test('cross-midnight response pauses until dawn, no midnight answers or notifications, fixed active deadline is final',async t=>{
 const f=await fixture(t),start=at('2026-10-16T23:15:00'),r=await f.paired(start);assert.equal(r.opened_at,at('2026-10-16T23:55:00'));assert.equal(r.deadline_at,at('2026-10-17T06:05:00'));
 await S.sweep(f.env,r.opened_at);const night=at('2026-10-17T03:00:00'),n=await S.notification(f.env,{eventId:r.id},night);assert.equal(n.night,true);assert.equal(n.retryAt,at('2026-10-17T06:00:00'));
 await assert.rejects(S.reply(f.env,'202',{eventId:r.id,answer:1,requestId:rid()},night),error('fate_night'));
 const v=(await S.event(f.env,'202',{eventId:r.id},night)).event;assert.equal(v.remainingMs,5*M);assert.equal(v.canReply,false);
 await S.sweep(f.env,r.deadline_at);await S.reply(f.env,'202',{eventId:r.id,answer:1,requestId:rid()},r.deadline_at);assert.equal(f.one('SELECT answer FROM rpg_fate_social_choices').answer,null);
 assert.equal((await S.outcomes(f.env,r.life_id,addActive(start,LIFE_MS)))[0].source,'auto');
});

test('late scheduler never sends stale invitations and atomic two-mention quota bounds both participating accounts',async t=>{
 const f=await fixture(t),r=await f.paired();await S.sweep(f.env,r.deadline_at+1);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_outbox').n,0);assert.equal(f.one('SELECT status FROM rpg_fate_social_choices').status,'auto');
 const g=await fixture(t),q=await g.paired();g.run('INSERT INTO rpg_fate_social_limits(account_id,day,mentions) VALUES(?,?,2)','202','2026-10-16');
 await S.sweep(g.env,q.opened_at);assert.equal(g.one('SELECT status FROM rpg_fate_social_choices').status,'auto');assert.equal(g.one('SELECT COUNT(*) n FROM rpg_outbox').n,0);assert.equal(g.one('SELECT COUNT(*) n FROM rpg_fate_social_limits WHERE account_id=?','101').n,0,'failed guest quota rolls back owner reservation');
});

test('same pair cannot be scheduled again that Taipei day even after answering; raw lifetime snapshots stay private',async t=>{
 const f=await fixture(t),r=await f.paired();await S.withdraw(f.env,'101',{eventId:r.id,requestId:rid()},T+1);
 f.run("UPDATE rpg_fate_lives SET status='complete' WHERE id=?",r.life_id);const life=await f.begin('101',T+LIFE_MS);assert.equal((await S.schedule(f.env,life,T+LIFE_MS)).scheduled,false);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_choices').n,1);assert.ok(!f.one('SELECT state_json FROM rpg_fate_lives WHERE id=?',life.lifeId).state_json.includes('guest_account'));
});

test('membership calls are one bounded owner-plus-three lookup and malformed or partial responses fail closed',async t=>{
 const f=await fixture(t);for(const id of ['101','202','303','404'])await f.enable(id);
 const life=await f.begin();f.env.FATE_SOCIAL_MEMBERSHIP=async accounts=>{f.checks.push(accounts);return {ok:true,members:[{accountId:'101',member:true},{accountId:'202',member:false},{accountId:'303',member:true}]}};
 assert.equal((await S.schedule(f.env,life,T)).scheduled,true);assert.equal(f.checks.length,1);assert.equal(f.checks[0].length,4);assert.equal(f.one('SELECT guest_account FROM rpg_fate_social_choices').guest_account,'303');
});

test('changing to a real alternate character cannot consume the bound guest answer or replay its receipt',async t=>{
 const f=await fixture(t),r=await f.paired(),now=r.opened_at;await S.sweep(f.env,now);
 const body={eventId:r.id,answer:1,requestId:rid()};await S.reply(f.env,'202',body,now);
 const alt=(await createCharacter(f.env,{tgId:'202',name:'旅人乙分身',baseClass:'mage',gender:'f'},T)).char.tg_id;
 f.run('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?',alt,'202');
 await assert.rejects(S.reply(f.env,alt,body,now+1),error('request_changed'));
 await assert.rejects(S.reply(f.env,alt,{...body,requestId:rid()},now+1),error('character_changed'));
 assert.equal((await S.event(f.env,alt,{eventId:r.id},now+1)).event.characterMatches,false);
 assert.equal(f.one('SELECT answer FROM rpg_fate_social_choices').answer,1);
});

test('preferences quieting races with answer and notification without resurrecting or duplicating the event',async t=>{
 const f=await fixture(t),r=await f.paired(),now=r.opened_at;await S.sweep(f.env,now);
 let release,entered;const gate=new Promise(r=>{release=r}),checking=new Promise(r=>{entered=r});
 f.env.FATE_SOCIAL_MEMBERSHIP=async accounts=>{entered();await gate;return {ok:true,members:accounts.map(accountId=>({accountId,member:true}))}};
 const notification=S.notification(f.env,{eventId:r.id},now+1);await checking;
 await S.savePreferences(f.env,'202',{enabled:true,allowMentions:true,consent:true,quietToday:true,requestId:rid()},now+1);release();
 assert.equal((await notification).valid,false);await S.reply(f.env,'202',{eventId:r.id,answer:1,requestId:rid()},now+1);
 assert.equal(f.one('SELECT status FROM rpg_fate_social_choices').status,'auto');assert.equal(f.one('SELECT answer FROM rpg_fate_social_choices').answer,null);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_outbox').n,1);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_locks').n,0);
});

test('same UUID concurrent replay commits one result and every account keeps its other game state untouched',async t=>{
 const f=await fixture(t),r=await f.paired(),now=r.opened_at;await S.sweep(f.env,now);
 const before=f.all('SELECT tg_id,gold,exp,rev FROM rpg_characters ORDER BY tg_id'),body={eventId:r.id,answer:1,requestId:rid()};
 const [a,b]=await Promise.all([S.reply(f.env,'202',body,now),S.reply(f.env,'202',body,now)]);assert.deepEqual(a.result,b.result);assert.ok(a.replayed===true||b.replayed===true);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_operations WHERE request_id=?',body.requestId).n,1);
 assert.deepEqual(f.all('SELECT tg_id,gold,exp,rev FROM rpg_characters ORDER BY tg_id'),before);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_lives WHERE account_id=?','202').n,0);
});

test('six authored branches have distinct choices and outcomes; the previous three private branches do not immediately repeat',async t=>{
 const titles=new Set(),answers=new Set(),outcomes=new Set();
 for(let seed=0;seed<6;seed++){
  const f=await fixture(t);await f.enable('101');await f.enable('202');const life=await f.begin();life.draft.seed=seed.toString(16).padStart(8,'0');
  f.run('UPDATE rpg_fate_lives SET state_json=? WHERE id=?',JSON.stringify(life.draft),life.lifeId);
  await S.schedule(f.env,life,T);const row=f.one('SELECT * FROM rpg_fate_social_choices'),v=(await S.event(f.env,'202',{eventId:row.id},row.opened_at)).event;
  titles.add(v.title);answers.add(v.choices.join('|'));await S.reply(f.env,'202',{eventId:row.id,answer:0,requestId:rid()},row.opened_at);
  outcomes.add((await S.outcomes(f.env,life.lifeId,row.deadline_at))[0].text);
 }
 assert.equal(titles.size,6);assert.equal(answers.size,6);assert.equal(outcomes.size,6);
 const f=await fixture(t),keys=[];
 for(let n=0;n<7;n++){
  const now=T+n*86400000;await f.enable('101',now);await f.enable('202',now);const life=await f.begin('101',now);await S.schedule(f.env,life,now);
  const row=f.one('SELECT * FROM rpg_fate_social_choices WHERE life_id=?',life.lifeId);assert.ok(!keys.slice(-3).includes(row.story_key));keys.push(row.story_key);
  await S.withdraw(f.env,'101',{eventId:row.id,requestId:rid()},now+1);f.run("UPDATE rpg_fate_lives SET status='complete' WHERE id=?",life.lifeId);
 }
});

test('Taiwan shared invitations have six localized stories, designated reply and the same delayed memory in both lives',async t=>{
 const keys=new Set(),titles=new Set(),outcomes=new Set();
 for(let seed=0;seed<6;seed++)for(const answer of [0,1]){
  const f=await fixture(t);await f.enable('101');await f.enable('202');const owner=await f.begin('101',T,8),guest=await f.begin('202',T,8);owner.draft.seed=seed.toString(16).padStart(8,'0');f.run('UPDATE rpg_fate_lives SET state_json=? WHERE id=?',JSON.stringify(owner.draft),owner.lifeId);
  assert.equal((await S.schedule(f.env,owner,T)).scheduled,true);const row=f.one('SELECT * FROM rpg_fate_social_choices WHERE life_id=?',owner.lifeId);assert.match(row.story_key,/^(garden|harbor|lamp|workshop|map|book)$/);keys.add(row.story_key);assert.equal(row.deadline_at-row.opened_at,10*M);
  await S.sweep(f.env,row.opened_at);const notice=await S.notification(f.env,{eventId:row.id},row.opened_at);assert.equal(notice.valid,true);assert.equal(notice.payload.ownerAccountId,'101');assert.equal(notice.payload.guestAccountId,'202');assert.doesNotMatch(notice.payload.text,/星燈|燈塔|城邦|甲板|航海|燈油|海灣/);titles.add(notice.payload.title);
  const received=(await S.event(f.env,'202',{eventId:row.id},row.opened_at)).event;assert.equal(received.canReply,true);assert.equal(received.choices.length,2);assert.equal((await S.event(f.env,'101',{eventId:row.id},row.opened_at)).event.canReply,false);for(const id of ['101','202'])assert.equal((await S.inbox(f.env,id,row.opened_at)).events[0].title,notice.payload.title);
  const replied=await S.reply(f.env,'202',{eventId:row.id,answer,requestId:rid()},row.opened_at+1);assert.equal(replied.result.event.title,received.title);assert.deepEqual(await S.outcomes(f.env,owner.lifeId,row.deadline_at-1),[]);assert.deepEqual(await S.outcomes(f.env,guest.lifeId,row.deadline_at-1),[]);
  const a=await S.outcomes(f.env,owner.lifeId,row.deadline_at),b=await S.outcomes(f.env,guest.lifeId,row.deadline_at);assert.equal(a.length,1);assert.equal(b.length,1);assert.deepEqual(a,b);assert.match(a[0].id,/^shared-tw8_/);assert.equal(a[0].answer,answer);assert.equal(a[0].source,'manual');assert.ok(a[0].text.includes('旅人101'));assert.ok(a[0].text.includes('旅人202'));outcomes.add(a[0].text);assert.deepEqual(sharedMemories(a),a);
  for(const[l,memory]of[[owner,a],[guest,b]]){const story=formalEvents({...l.draft,clockAt:row.deadline_at,sharedMemories:memory},row.deadline_at);assert.ok(story.some(event=>event.kind==='shared'&&event.text===a[0].text),'both life stories must retain the localized shared memory');}
 }
 assert.equal(keys.size,6);assert.equal(titles.size,6);assert.equal(outcomes.size,12);
});

test('Taiwan shared branches avoid the last three keys while unimplemented countries cannot schedule a fantasy fallback',async t=>{
 const f=await fixture(t),keys=[];
 for(let n=0;n<7;n++){const now=T+n*86400000;await f.enable('101',now);await f.enable('202',now);const life=await f.begin('101',now,8);assert.equal((await S.schedule(f.env,life,now)).scheduled,true);const row=f.one('SELECT * FROM rpg_fate_social_choices WHERE life_id=?',life.lifeId);assert.match(row.story_key,/^(garden|harbor|lamp|workshop|map|book)$/);assert.ok(!keys.slice(-3).includes(row.story_key));keys.push(row.story_key);await S.withdraw(f.env,'101',{eventId:row.id,requestId:rid()},now+1);f.run("UPDATE rpg_fate_lives SET status='complete' WHERE id=?",life.lifeId);}
 const unpublished=await f.begin('101',T+8*86400000,8);unpublished.draft.country='JP';f.run('UPDATE rpg_fate_lives SET state_json=? WHERE id=?',JSON.stringify(unpublished.draft),unpublished.lifeId);assert.equal((await S.schedule(f.env,unpublished,T+8*86400000)).scheduled,false);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_choices WHERE life_id=?',unpublished.lifeId).n,0);
});

test('localized shared story edition follows the stored parent life rather than supplied draft claims',async t=>{
 for(const version of [4,8]){const f=await fixture(t);await f.enable('101');await f.enable('202');const life=await f.begin('101',T,version);const claimed={...life,draft:{...life.draft,version:version===8?4:8,country:version===8?undefined:'TW'}};assert.equal((await S.schedule(f.env,claimed,T)).scheduled,true);
  const row=f.one('SELECT * FROM rpg_fate_social_choices'),event=(await S.event(f.env,'202',{eventId:row.id},row.opened_at)).event;assert.equal(event.title,version===8?'書店留言板的空白角落':'寄給未來的一頁');assert.ok(!Object.keys(event).some(key=>/story_life_state|state_json/.test(key)));
 }
});

test('production membership transport uses only the fixed protected Bot endpoint and private stored accounts',async t=>{
 const f=await fixture(t);await f.enable('101');await f.enable('202');const life=await f.begin();delete f.env.FATE_SOCIAL_MEMBERSHIP;f.env.SERVICE_SECRET='fixture-not-real-secret';
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});let called=0;
 globalThis.fetch=async(url,options)=>{called++;assert.equal(url,'https://star-journal-rpg-bot.micisachen.workers.dev/internal/fate-membership');assert.equal(options.headers.authorization,'Bearer fixture-not-real-secret');assert.deepEqual(JSON.parse(options.body),{accountIds:['101','202']});return Response.json({ok:true,members:[{accountId:'101',member:true},{accountId:'202',member:true}]})};
 assert.equal((await S.schedule(f.env,{...life,forgedAccount:'404'},T)).scheduled,true);assert.equal(called,1);
});

test('per-life owner consent works independently of default-off receiving preferences; quieting still cancels both sides',async t=>{
 const f=await fixture(t);await f.enable('202');const life=await f.begin();assert.equal((await S.preferences(f.env,'101',T)).preferences.enabled,false);
 assert.equal((await S.schedule(f.env,life,T)).scheduled,true,'the start checkbox is owner consent, not permission to receive invitations');
 const row=f.one('SELECT * FROM rpg_fate_social_choices');await S.savePreferences(f.env,'101',{enabled:false,allowMentions:false,requestId:rid()},T+1);
 assert.equal(f.one('SELECT status FROM rpg_fate_social_choices').status,'scheduled','disabling reception does not silently revoke a separately authorized owned life');
 await S.sweep(f.env,row.opened_at);assert.equal((await S.notification(f.env,{eventId:row.id},row.opened_at)).valid,true);
 await S.savePreferences(f.env,'101',{enabled:false,allowMentions:false,quietToday:true,requestId:rid()},row.opened_at+1);
 assert.equal(f.one('SELECT status FROM rpg_fate_social_choices').status,'auto');assert.equal((await S.notification(f.env,{eventId:row.id},row.opened_at+2)).valid,false);
});

test('temporary guest and owner character switches can be reversed; deleting the bound guest revokes eligibility',async t=>{
 const f=await fixture(t),r=await f.paired();
 const alt=(await createCharacter(f.env,{tgId:'202',name:'暫時出門的分身',baseClass:'mage',gender:'f'},T)).char.tg_id;
 f.run('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?',alt,'202');await S.sweep(f.env,r.opened_at);
 assert.equal((await S.event(f.env,alt,{eventId:r.id},r.opened_at)).event.characterMatches,false);
 await assert.rejects(S.reply(f.env,alt,{eventId:r.id,answer:0,requestId:rid()},r.opened_at),error('character_changed'));
 f.run('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?','202','202');
 assert.equal((await S.event(f.env,'202',{eventId:r.id},r.opened_at+1)).event.canReply,true);
 f.run('DELETE FROM rpg_characters WHERE tg_id=?','202');assert.equal((await S.notification(f.env,{eventId:r.id},r.opened_at+1)).valid,false);
 assert.equal(f.one('SELECT status FROM rpg_fate_social_choices').status,'auto');
});

for(const stage of ['schedule','open','answer'])for(const mutation of ['guest-deleted','guest-reassigned','owner-reassigned','guest-consent-revoked','owner-quiet'])test(`atomic ${stage} rejects ${mutation} after the final eligibility read but before commit`,async t=>{
 const f=await fixture(t);await f.enable('101');await f.enable('202');const life=await f.begin();
 let row;
 if(stage!=='schedule'){await S.schedule(f.env,life,T);row=f.one('SELECT * FROM rpg_fate_social_choices');if(stage==='answer')await S.sweep(f.env,row.opened_at);}
 const original=f.env.DB.batch.bind(f.env.DB);t.after(()=>{f.env.DB.batch=original});let changed=false;
 const pattern=stage==='schedule'?'INSERT INTO rpg_fate_social_choices':stage==='open'?"UPDATE rpg_fate_social_choices SET status='pending'":'UPDATE rpg_fate_social_choices SET status=?';
 f.env.DB.batch=async stmts=>{
  if(!changed&&stmts.some(s=>s.sql.startsWith(pattern))){
   changed=true;
   if(mutation==='guest-deleted')f.run('DELETE FROM rpg_characters WHERE tg_id=?','202');
   if(mutation==='guest-reassigned')f.run('UPDATE rpg_characters SET account_tg_id=? WHERE tg_id=?','909','202');
   if(mutation==='owner-reassigned')f.run('UPDATE rpg_characters SET account_tg_id=? WHERE tg_id=?','909','101');
   if(mutation==='guest-consent-revoked')f.run('UPDATE rpg_fate_social_preferences SET enabled=0 WHERE account_id=?','202');
   if(mutation==='owner-quiet')f.run('UPDATE rpg_fate_social_preferences SET quiet_until=? WHERE account_id=?',T+86400000,'101');
  }
  return original(stmts);
 };
 if(stage==='schedule'){
  assert.equal((await S.schedule(f.env,life,T)).scheduled,false);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_choices').n,0);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_pairs').n,0);
 }else if(stage==='open'){
  await S.sweep(f.env,row.opened_at);assert.equal(f.one('SELECT status FROM rpg_fate_social_choices').status,'auto');assert.equal(f.one('SELECT COUNT(*) n FROM rpg_outbox').n,0);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_limits').n,0);
 }else{
  const response=await S.reply(f.env,'202',{eventId:row.id,answer:1,requestId:rid()},row.opened_at+1);assert.equal(response.result.event.status,'auto');assert.equal(response.result.event.answer,null);
  assert.equal(f.one('SELECT status FROM rpg_fate_social_choices').status,'auto');assert.equal(f.one('SELECT answer FROM rpg_fate_social_choices').answer,null);
 }
 assert.equal(changed,true,'the authority mutation happened exactly at the transaction boundary');assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_locks').n,0);
});

for(const country of Object.keys(COUNTRY_METADATA_V9))test(country+' localized shared notice opens actual recipient options and preserves both stories after either answer',async t=>{
 const openings=new Set(),keys=new Set(),outcomes=new Set();
 for(let seed=0;seed<6;seed++)for(const answer of [0,1]){
  const f=await fixture(t);await f.enable('101');await f.enable('202');const owner=await f.begin('101',T,9,country),guest=await f.begin('202',T,9,country);owner.draft.seed=seed.toString(16).padStart(8,'0');f.run('UPDATE rpg_fate_lives SET state_json=? WHERE id=?',JSON.stringify(owner.draft),owner.lifeId);
  assert.equal((await S.schedule(f.env,{...owner,draft:{...owner.draft,country:'TW',seed:'ffffffff'}},T)).scheduled,true,'server edition and seed come from the saved parent life');const row=f.one('SELECT * FROM rpg_fate_social_choices WHERE life_id=?',owner.lifeId);keys.add(row.story_key);openings.add(row.opened_at);assert.ok((row.opened_at-T)/LIFE_MS*countryProfile(owner.draft.seed,3,country).deathAge>=18);assert.equal(row.deadline_at-row.opened_at,10*M);
  await S.sweep(f.env,row.opened_at);const notice=await S.notification(f.env,{eventId:row.id},row.opened_at);assert.equal(notice.valid,true);assert.equal(notice.payload.country,country);assert.equal(notice.payload.guestAccountId,'202');const event=(await S.event(f.env,'202',{eventId:row.id},row.opened_at)).event;assert.equal(event.canReply,true);assert.equal(event.choices.length,2);assert.equal((await S.event(f.env,'101',{eventId:row.id},row.opened_at)).event.canReply,false);
  const body={eventId:row.id,answer,requestId:rid()};assert.equal((await S.reply(f.env,'202',body,row.opened_at+1)).ok,true);assert.equal((await S.reply(f.env,'202',body,row.opened_at+2)).replayed,true);assert.deepEqual(await S.outcomes(f.env,owner.lifeId,row.deadline_at-1),[]);
  const a=await S.outcomes(f.env,owner.lifeId,row.deadline_at),b=await S.outcomes(f.env,guest.lifeId,row.deadline_at);assert.equal(a.length,1);assert.deepEqual(a,b);assert.match(a[0].id,new RegExp('^shared-v9_'+country.toLowerCase()+'_'));assert.deepEqual(sharedMemories(a),a);outcomes.add(a[0].text);
  for(const[l,memory]of[[owner,a],[guest,b]])assert.ok(formalEvents({...l.draft,clockAt:row.deadline_at,sharedMemories:memory},row.deadline_at).some(r=>r.kind==='shared'&&r.text===a[0].text));
 }
 assert.equal(keys.size,6);assert.equal(outcomes.size,12);assert.ok(openings.size>3,'shared invitations no longer all open forty minutes after start');
});

test('local shared invitations do not teleport an active player between country books',async t=>{
 const f=await fixture(t);await f.enable('101');await f.enable('202');const owner=await f.begin('101',T,9,'JP');await f.begin('202',T,9,'US');assert.equal((await S.schedule(f.env,owner,T)).scheduled,false);
});

// Use the saved FR edition and the real randomized opening, so these regressions
// cover the country path rather than relying on the legacy forty-minute slot.
const countrySharedWindow=draft=>{
 const death=countryProfile(draft.seed,draft.orbit,draft.country).deathAge,min=Math.ceil(18/death*LIFE_MS);
 const offset=min+storyHash('v9-shared-open:'+draft.country+':'+draft.seed)%(100*M-min),open=addActive(draft.startedAt,offset);
 return {open,deadline:Math.min(addActive(open,10*M),addActive(draft.startedAt,LIFE_MS))};
};
const retimeGuest=(f,life,startedAt)=>{
 const draft={...life.draft,startedAt,clockAt:startedAt};
 f.run('UPDATE rpg_fate_lives SET state_json=?,started_at=? WHERE id=?',JSON.stringify(draft),startedAt,life.lifeId);
 return draft;
};

test('deadline coverage refuses a same-country guest whose life has only one minute left at opening',async t=>{
 const f=await fixture(t);await f.enable('101');await f.enable('202');const owner=await f.begin('101',T,9,'FR'),window=countrySharedWindow(owner.draft);
 const guest=await f.begin('202',window.open-LIFE_MS+M,9,'FR');
 assert.equal(addActive(guest.draft.startedAt,LIFE_MS),window.open+M);assert.ok(window.open+M<window.deadline);
 assert.equal((await S.schedule(f.env,owner,T)).scheduled,false);
 for(const table of ['rpg_fate_social_choices','rpg_fate_social_locks','rpg_fate_social_pairs','rpg_outbox'])assert.equal(f.one('SELECT COUNT(*) n FROM '+table).n,0);
});

for(const stage of ['open','answer'])test('deadline coverage closes an invitation when a too-short same-country life replaces the guest before '+stage,async t=>{
 const f=await fixture(t);await f.enable('101');await f.enable('202');const owner=await f.begin('101',T,9,'FR'),guest=await f.begin('202',T,9,'FR');
 assert.equal((await S.schedule(f.env,owner,T)).scheduled,true);const row=f.one('SELECT * FROM rpg_fate_social_choices');
 if(stage==='answer'){await S.sweep(f.env,row.opened_at);assert.equal(f.one('SELECT status FROM rpg_fate_social_choices').status,'pending');}
 f.run("UPDATE rpg_fate_lives SET status='complete' WHERE id=?",guest.lifeId);
 const replacement=await f.begin('202',row.opened_at-LIFE_MS+M,9,'FR');assert.ok(addActive(replacement.draft.startedAt,LIFE_MS)<row.deadline_at);
 if(stage==='open')await S.sweep(f.env,row.opened_at);
 else{const response=await S.reply(f.env,'202',{eventId:row.id,answer:1,requestId:rid()},row.opened_at+1);assert.equal(response.result.event.status,'auto');assert.equal(response.result.event.answer,null);}
 const closed=f.one('SELECT status,answer,source FROM rpg_fate_social_choices');assert.equal(closed.status,'auto');assert.equal(closed.answer,null);assert.equal(closed.source,'unavailable');
 assert.equal((await S.notification(f.env,{eventId:row.id},row.opened_at+2)).valid,false);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_outbox').n,stage==='answer'?1:0);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_locks').n,0);
});

for(const stage of ['schedule','open','answer'])test('deadline coverage atomically rejects guest startedAt replacement at the '+stage+' commit boundary',async t=>{
 const f=await fixture(t);await f.enable('101');await f.enable('202');const owner=await f.begin('101',T,9,'FR'),guest=await f.begin('202',T,9,'FR'),window=countrySharedWindow(owner.draft);
 let row;if(stage!=='schedule'){assert.equal((await S.schedule(f.env,owner,T)).scheduled,true);row=f.one('SELECT * FROM rpg_fate_social_choices');if(stage==='answer')await S.sweep(f.env,row.opened_at);}
 const original=f.env.DB.batch.bind(f.env.DB);t.after(()=>{f.env.DB.batch=original});let changed=false;
 const prefix=stage==='schedule'?'INSERT INTO rpg_fate_social_choices':stage==='open'?"UPDATE rpg_fate_social_choices SET status='pending'":'UPDATE rpg_fate_social_choices SET status=?';
 f.env.DB.batch=async stmts=>{
  if(!changed&&stmts.some(stmt=>stmt.sql.startsWith(prefix))){changed=true;retimeGuest(f,guest,window.open-LIFE_MS+M);}
  return original(stmts);
 };
 if(stage==='schedule'){
  assert.equal((await S.schedule(f.env,owner,T)).scheduled,false);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_choices').n,0);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_pairs').n,0);
 }else if(stage==='open'){
  await S.sweep(f.env,row.opened_at);assert.equal(f.one('SELECT status FROM rpg_fate_social_choices').status,'auto');assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_limits').n,0);
 }else{
  const body={eventId:row.id,answer:0,requestId:rid()},response=await S.reply(f.env,'202',body,row.opened_at+1);
  assert.equal(response.result.event.status,'auto');assert.equal(response.result.event.answer,null);assert.equal((await S.reply(f.env,'202',body,row.opened_at+2)).replayed,true);
  assert.equal(f.one('SELECT status FROM rpg_fate_social_choices').status,'auto');assert.equal(f.one('SELECT answer FROM rpg_fate_social_choices').answer,null);
  const receipt=f.one('SELECT result_json FROM rpg_fate_social_operations WHERE request_id=?',body.requestId);assert.equal(JSON.parse(receipt.result_json).event.status,'auto');
 }
 assert.equal(changed,true,'replacement occurs after async eligibility reads and before the atomic write');
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_outbox').n,stage==='answer'?1:0);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_locks').n,0);
});

test('deadline coverage includes a 22:30 guest through 06:30 across the quiet night and updates both stories',async t=>{
 const f=await fixture(t),ownerStart=at('2026-10-16T23:00:00'),guestStart=at('2026-10-16T22:30:00');await f.enable('101',ownerStart);await f.enable('202',ownerStart);
 const owner=await f.begin('101',ownerStart,9,'FR'),guest=await f.begin('202',guestStart,9,'FR');assert.equal(addActive(guestStart,LIFE_MS),at('2026-10-17T06:30:00'));
 assert.equal((await S.schedule(f.env,owner,ownerStart)).scheduled,true);const row=f.one('SELECT * FROM rpg_fate_social_choices');assert.ok(row.opened_at>=at('2026-10-17T06:00:00'));assert.ok(row.deadline_at<=at('2026-10-17T06:30:00'));
 await S.sweep(f.env,row.opened_at);assert.equal((await S.notification(f.env,{eventId:row.id},row.opened_at)).valid,true);
 const response=await S.reply(f.env,'202',{eventId:row.id,answer:1,requestId:rid()},row.opened_at+1);assert.equal(response.result.event.status,'answered');
 assert.deepEqual(await S.outcomes(f.env,owner.lifeId,row.deadline_at-1),[]);assert.deepEqual(await S.outcomes(f.env,guest.lifeId,row.deadline_at-1),[]);
 const a=await S.outcomes(f.env,owner.lifeId,row.deadline_at),b=await S.outcomes(f.env,guest.lifeId,row.deadline_at);assert.equal(a.length,1);assert.deepEqual(a,b);
 for(const [life,memories]of[[owner,a],[guest,b]])assert.ok(formalEvents({...life.draft,clockAt:row.deadline_at,sharedMemories:memories},row.deadline_at).some(event=>event.kind==='shared'&&event.text===a[0].text));
});

test('deadline coverage does not add a quiet-night bonus to an exact 22:00 guest at the atomic guard',async t=>{
 const f=await fixture(t),ownerStart=at('2026-10-16T23:00:00');await f.enable('101',ownerStart);await f.enable('202',ownerStart);
 const owner=await f.begin('101',ownerStart,9,'FR'),guest=await f.begin('202',at('2026-10-16T22:30:00'),9,'FR');assert.equal(addActive(at('2026-10-16T22:00:00'),LIFE_MS),at('2026-10-17T00:00:00'));
 const original=f.env.DB.batch.bind(f.env.DB);t.after(()=>{f.env.DB.batch=original});let changed=false;
 f.env.DB.batch=async stmts=>{if(!changed&&stmts.some(stmt=>stmt.sql.startsWith('INSERT INTO rpg_fate_social_choices'))){changed=true;retimeGuest(f,guest,at('2026-10-16T22:00:00'));}return original(stmts)};
 assert.equal((await S.schedule(f.env,owner,ownerStart)).scheduled,false);assert.equal(changed,true);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_choices').n,0);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_locks').n,0);
});
