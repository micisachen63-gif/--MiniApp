import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {createCharacter} from '../src/services/player.js';
import * as S from '../src/services/fate-shared.js';
import {createLife,addActive,LIFE_MS} from '../public/fate/life.js';

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
 async function begin(id='101',now=T){
  const lifeId='life-'+id+'-'+n++,draft=createLife({version:4,orbit:3,seed:'deadbeef',startedAt:now});
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
