import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {freshDb} from './d1-shim.js';
import {CurrentClientRequest} from './client-request.js';
import * as F from '../src/services/fate.js';
import * as SHARED from '../src/services/fate-shared.js';
import {formalEvents} from '../public/fate/formal-events.js';
import {endingForLife} from '../public/fate/ending-story.js';
import {fateEvidence} from '../src/services/fate-quests.js';
import {createCharacter} from '../src/services/player.js';
import {handle} from '../src/index.js';
import {addActive,lifeSchedule,LIFE_MS,CHOICE_MS,lifeAge} from '../public/fate/life.js';
import {encodeResult,decodeResult,generatedZodiac,zodiacFor} from '../public/fate/model.js';
const TOKEN='123456789:FAKE_TEST_ONLY_FATE_TOKEN',SECRET='fate-test-service-secret';
const at=s=>Date.parse(s+'+08:00'),T=at('2026-10-16T06:00:00'),rid=()=>crypto.randomUUID();
const error=(code,status)=>e=>e.code===code&&(!status||e.status===status);
function signed(id,token=TOKEN){const fields={auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:Number(id),first_name:'旅章測試'})};const secret=createHmac('sha256','WebAppData').update(token).digest();return new URLSearchParams({...fields,hash:createHmac('sha256',secret).update(Object.keys(fields).sort().map(k=>`${k}=${fields[k]}`).join('\n')).digest('hex')}).toString();}
async function fixture(t){
 const env={DB:freshDb(),SERVICE_SECRET:SECRET,BOT_TOKEN:TOKEN,ENVIRONMENT:'development',ALLOW_DEBUG_TIME:'true',GROUP_CHAT_ID:'-100555'};t.after(()=>env.DB.sqlite.close());
 const a=(await createCharacter(env,{tgId:'101',name:'星燈甲',baseClass:'sword',gender:'m'},T)).char.tg_id;
 const b=(await createCharacter(env,{tgId:'101',name:'星燈乙',baseClass:'mage',gender:'f'},T)).char.tg_id;
 for(const id of ['202','303'])await createCharacter(env,{tgId:id,name:'旅人'+id,baseClass:'sword',gender:'m'},T);
 const db=env.DB.sqlite,one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),exec=(sql,...args)=>db.prepare(sql).run(...args);
 const api=async(action,body={},now=T,init=signed('101'))=>{const res=await handle(new CurrentClientRequest('https://game.test/app/api/'+action,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Init-Data':init,'X-Debug-Now':String(now)},body:JSON.stringify(body)}),env);return {status:res.status,...await res.json()};};
 const svc=async(path,body={},now=T,secret=SECRET)=>{const res=await handle(new Request('https://game.test/rpg/'+path,{method:'POST',headers:{'content-type':'application/json','X-Service-Secret':secret,'X-Debug-Now':String(now)},body:JSON.stringify(body)}),env);return {status:res.status,...await res.json()};};
 return {env,a,b,db,one,all,exec,api,svc};
}
const begin=(f,char,now=T,extra={})=>F.start(f.env,char,{requestId:rid(),mode:'random',...extra},now);

test('real authenticated shared choice reaches only its designated character and becomes an immutable life memory at deadline',async t=>{
 const f=await fixture(t);f.env.FATE_SOCIAL_MEMBERSHIP=async accounts=>({ok:true,members:accounts.map(accountId=>({accountId,member:true}))});
 await SHARED.savePreferences(f.env,'202',{enabled:true,allowMentions:true,consent:true,requestId:rid()},T);
 const requestId=rid(),body={requestId,mode:'random',socialInvite:true},start=await F.start(f.env,f.a,body,T);
 await F.start(f.env,f.a,body,T+1000);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_social_choices').n,1);
 const row=f.one('SELECT * FROM rpg_fate_social_choices WHERE life_id=?',start.result.lifeId),open=row.opened_at,deadline=row.deadline_at;
 const inbox=await f.api('fate/social/inbox',{},open,signed('202'));assert.equal(inbox.ok,true);const event=inbox.events[0];assert.equal(event.canReply,true);assert.equal(event.side,'guest');assert.doesNotMatch(JSON.stringify(event),/ownerAccount|guestAccount|owner_char|guest_char|life_id/);
 assert.equal((await f.api('fate/social/event',{eventId:event.id},open,signed('303'))).status,404);
 assert.equal((await f.api('fate/social/reply',{eventId:event.id,answer:0,requestId:rid()},open)).status,403);
 const reply={eventId:event.id,answer:1,requestId:rid()};assert.equal((await f.api('fate/social/reply',reply,open+1,signed('202'))).ok,true);
 assert.equal((await f.api('fate/social/reply',reply,open+2,signed('202'))).replayed,true);
 assert.equal((await F.state(f.env,f.a,deadline-1)).active.draft.sharedMemories,undefined);
 const life=(await F.state(f.env,f.a,deadline)).active.draft;assert.equal(life.sharedMemories.length,1);assert.equal(life.sharedMemories[0].answer,1);
 const log=formalEvents(life,deadline);assert.equal(log.filter(e=>e.kind==='shared').length,1);assert.equal(formalEvents(life,deadline-1).filter(e=>e.kind==='shared').length,0);
 assert.doesNotMatch(JSON.stringify(life.sharedMemories),new RegExp(event.id+'|owner_account|guest_account|life_id'));
 const done=await F.state(f.env,f.a,T+LIFE_MS);assert.equal(done.completed,1);assert.equal(done.last.draft.sharedMemories[0].text,life.sharedMemories[0].text);assert.ok(endingForLife(done.last.draft).paragraphs.some(p=>p.includes(life.sharedMemories[0].text)));
 assert.equal(decodeResult(done.last.code).sharedMemories,undefined,'public shortcode carries no private social history');
 assert.equal((await F.history(f.env,f.a,{},T+LIFE_MS)).entries[0].draft.sharedMemories[0].text,life.sharedMemories[0].text);
});

test('time-limited Fate notices claim ahead of ordinary backlog and both Fate kinds remain unclaimed overnight',async t=>{
 const f=await fixture(t);for(const [dedupe,kind]of [['ordinary','test'],['social','fate_social'],['choice','fate_event']])f.exec('INSERT INTO rpg_outbox(dedupe_key,target,kind,payload_json,created_at) VALUES(?,?,?,?,?)',dedupe,'group',kind,'{}',T);
 const first=await f.svc('outbox/claim',{limit:1},T);assert.equal(first.items[0].kind,'fate_social');
 const night=at('2026-10-17T01:00:00'),batch=await f.svc('outbox/claim',{limit:10},night);assert.deepEqual(batch.items.map(x=>x.kind),['test']);
 assert.equal(f.one("SELECT claim_attempts FROM rpg_outbox WHERE dedupe_key='choice'").claim_attempts,0);
});
function boss(f,{id='boss',char=f.a,status='killed',damage=20,group=f.env.GROUP_CHAT_ID,time=T+1000,attackTime=time}={}){f.exec('INSERT INTO rpg_boss_instances(id,chat_id,map_id,name,base_hp,max_hp,hp,started_at,ends_at,status,settled_at) VALUES(?,?,1,?,100,100,0,?,?,?,?)',id,group,'首領測試',time-10000,time+10000,status,time);f.exec('INSERT INTO rpg_boss_attacks(boss_id,tg_id,win,damage,created_at) VALUES(?,?,0,?,?)',id,char,damage,attackTime);}
// Evidence fixtures are committed server rows, not client flags or mocked service responses.
function addParty(f,options={}){const id=options.id||rid(),char=options.char||f.a,time=options.time??T+2000,ids=[char,'202','303'].slice(0,options.members??3),state={actors:ids.map(id=>({id,manualActions:id===char?(options.manual??1):1})),trial:options.trial||false,journalWonAt:time,journalFloors:options.floors||[]};f.exec('INSERT INTO rpg_parties(id,leader_id,kind,status,state_json,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',id,char,options.kind||'dungeon',options.status||'won',JSON.stringify(state),time-1000,time,time+100000);ids.forEach((member,i)=>f.exec('INSERT INTO rpg_party_members(party_id,char_id,account_id,joined_at) VALUES(?,?,?,?)',id,member,i===0?'101':member,time));return id;}

test('authoritative starts share the four-life account limit across characters, with exactly one active life per character',async t=>{const f=await fixture(t),first=await begin(f,f.a),second=await begin(f,f.b),again=await begin(f,f.a);assert.equal(again.result.lifeId,first.result.lifeId);assert.equal(again.result.already,true);assert.notEqual(second.result.lifeId,first.result.lifeId);assert.equal((await F.state(f.env,f.a,T)).startedToday,2);for(const char of [f.a,f.b])await F.state(f.env,char,T+LIFE_MS);await begin(f,f.a,T+LIFE_MS);await begin(f,f.b,T+LIFE_MS);for(const char of [f.a,f.b])await F.state(f.env,char,T+2*LIFE_MS);await assert.rejects(begin(f,f.a,T+2*LIFE_MS),error('fate_limit'));assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_lives').n,4);assert.equal((await F.state(f.env,f.a,T+2*LIFE_MS)).completed,2);await begin(f,'202',T+2*LIFE_MS);assert.equal((await F.state(f.env,'202',T+2*LIFE_MS)).startedToday,1);await begin(f,f.a,T+86400000);assert.equal((await F.state(f.env,f.a,T+86400000)).startedToday,1);});

test('a committed start replays once and a changed retry payload returns 409 without another start',async t=>{const f=await fixture(t),body={requestId:rid(),mode:'random',showSign:true},first=await F.start(f.env,f.a,body,T),replay=await F.start(f.env,f.a,{showSign:true,mode:'random',requestId:body.requestId},T+100);assert.deepEqual(replay.result,first.result);assert.equal(replay.replayed,true);await assert.rejects(F.start(f.env,f.a,{...body,showSign:false},T+200),error('request_changed',409));assert.equal(f.one('SELECT count FROM rpg_fate_starts WHERE account_id=?','101').count,1);});

test('two active hours pause overnight and completion never starts another life automatically',async t=>{const f=await fixture(t),start=at('2026-10-16T23:00:00');await begin(f,f.a,start);const midnight=await F.state(f.env,f.a,at('2026-10-17T00:00:00')),dawn=await F.state(f.env,f.a,at('2026-10-17T05:59:59'));assert.equal(lifeAge(midnight.active.draft,midnight.active.draft.clockAt),45);assert.equal(lifeAge(dawn.active.draft,dawn.active.draft.clockAt),45);assert.equal(dawn.night,true);const done=await F.state(f.env,f.a,at('2026-10-17T07:00:00'));assert.equal(done.active,null);assert.equal(done.completed,1);assert.equal(done.startedToday,0);assert.equal((await F.state(f.env,f.a,at('2026-10-17T12:00:00'))).completed,1);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_lives').n,1);await assert.rejects(begin(f,f.b,at('2026-10-17T01:00:00')),error('fate_night'));});

test('a manual decision is authoritative, replayable, immutable and isolated from another character',async t=>{const f=await fixture(t),started=await begin(f,f.a),slot=lifeSchedule(T)[0],body={requestId:rid(),lifeId:started.result.lifeId,index:0,answer:1};await assert.rejects(F.choose(f.env,f.b,body,slot),error('fate_finished',409));await assert.rejects(F.choose(f.env,f.a,{...body,requestId:rid()},slot-1),error('fate_choice',409));await F.choose(f.env,f.a,body,slot);assert.equal((await F.choose(f.env,f.a,body,slot+100)).replayed,true);await assert.rejects(F.choose(f.env,f.b,body,slot+100),e=>e.status===409,'a committed receipt cannot replay as another character');await assert.rejects(F.choose(f.env,f.a,{...body,answer:0},slot+100),error('request_changed',409));const state=await F.state(f.env,f.a,slot+100);assert.deepEqual(state.active.draft.answers,[1]);assert.deepEqual(state.active.draft.sources,['manual']);});

test('an expired or completed choice cannot overwrite server auto-selection, including a paused night deadline',async t=>{const f=await fixture(t),start=at('2026-10-16T23:35:00'),life=await begin(f,f.a,start),slot=lifeSchedule(start)[0],deadline=addActive(slot,CHOICE_MS);await assert.rejects(F.choose(f.env,f.a,{requestId:rid(),lifeId:life.result.lifeId,index:0,answer:1},deadline),error('fate_choice',409));const s=await F.state(f.env,f.a,deadline);assert.deepEqual(s.active.draft.sources,['auto']);const answer=s.active.draft.answers[0];await assert.rejects(F.choose(f.env,f.a,{requestId:rid(),lifeId:life.result.lifeId,index:0,answer:1-answer},deadline+1000),error('fate_choice',409));await F.state(f.env,f.a,addActive(start,LIFE_MS));await assert.rejects(F.choose(f.env,f.a,{requestId:rid(),lifeId:life.result.lifeId,index:1,answer:0},addActive(start,LIFE_MS)),error('fate_finished',409));});

test('public story imports are memorials only: no completed life, milestone, daily allowance or RPG reward',async t=>{const f=await fixture(t),code=encodeResult({version:4,orbit:3,seed:'deadbeef',answers:[1,0,1],auto:[0,1,0]}),before=f.one('SELECT gold,exp FROM rpg_characters WHERE tg_id=?',f.a);const r=await F.keep(f.env,f.a,{requestId:rid(),code},T);assert.equal(r.result.countsAsLife,false);await F.keep(f.env,f.a,{requestId:rid(),code},T+1);const me=await F.me(f.env,f.a,T+1);assert.equal(me.completed,0);assert.equal(me.milestone,null);assert.equal(me.startedToday,0);assert.equal(me.entries.length,0);assert.equal(me.memorials.length,1);assert.deepEqual(f.one('SELECT gold,exp FROM rpg_characters WHERE tg_id=?',f.a),before);assert.equal((await F.me(f.env,f.b,T)).memorials.length,0);});

test('history pages only contain the selected character and retain authoritative source bits',async t=>{const f=await fixture(t);for(let n=0;n<12;n++){const now=T+n*86400000;await begin(f,f.a,now);await F.state(f.env,f.a,now+LIFE_MS);}await begin(f,f.b,T+12*86400000);await F.state(f.env,f.b,T+12*86400000+LIFE_MS);const page=await F.history(f.env,f.a,{},T+13*86400000);assert.equal(page.entries.length,10);assert.ok(page.next);assert.ok(page.entries.every(e=>e.draft.sources.length===3));const rest=await F.history(f.env,f.a,{before:page.next},T+13*86400000);assert.equal(rest.entries.length,2);assert.equal(rest.next,null);assert.equal(new Set([...page.entries,...rest.entries].map(e=>e.id)).size,12);assert.equal((await F.history(f.env,f.b,{},T+13*86400000)).entries.length,1);});

test('locked daily notes expose no text and tasks unlock health, work, love in fixed order once per account',async t=>{const f=await fixture(t),initial=await F.daily(f.env,f.a,T);assert.equal(initial.unlocked,0);assert.deepEqual(initial.notes,[{topic:'health',locked:true},{topic:'work',locked:true},{topic:'love',locked:true}]);boss(f);let d=await F.daily(f.env,f.b,T+5000);assert.equal(d.unlocked,1);assert.equal(d.notes[0].locked,false);assert.ok(d.notes[0].title&&d.notes[0].scene&&d.notes[0].action&&d.notes[0].reason);assert.deepEqual(d.notes[1],{topic:'work',locked:true});boss(f,{id:'boss-repeat',time:T+6000});assert.equal((await F.daily(f.env,f.a,T+7000)).unlocked,1);addParty(f,{time:T+8000});addParty(f,{kind:'tower',time:T+20000,floors:Array.from({length:5},(_,i)=>({floor:i+1,at:T+10000+i*1000,participants:[f.a]}))});d=await F.daily(f.env,f.a,T+30000);assert.equal(d.unlocked,3);assert.deepEqual(d.unlocks.map(e=>e.id),['boss','dungeon','tower']);assert.ok(d.notes.every(n=>n.locked===false));assert.deepEqual((await F.daily(f.env,f.b,T+30001)).notes,d.notes);});

test('boss evidence requires a real kill, positive damage, correct group and same-day settlement and participation',async t=>{const f=await fixture(t);for(const [id,extra]of [['active',{status:'active'}],['fled',{status:'fled'}],['zero',{damage:0}],['other-group',{group:'-100999'}],['yesterday',{time:T-7*3600000}],['old-hit',{attackTime:T-7*3600000}]])boss(f,{id,...extra});assert.deepEqual(await fateEvidence(f.env,'101',T+10000),[]);boss(f,{id:'valid',char:f.b,time:T+2000});assert.deepEqual(await fateEvidence(f.env,'101',T+10000),[{id:'boss',at:T+2000}]);assert.deepEqual(await fateEvidence(f.env,'202',T+10000),[]);});

test('dungeon evidence requires three distinct accounts, manual participation, non-trial and a completed win today',async t=>{const f=await fixture(t);for(const extra of [{members:2},{manual:0},{trial:true},{status:'lost'},{status:'lobby'},{time:T-7*3600000}])addParty(f,extra);assert.deepEqual(await fateEvidence(f.env,'101',T+10000),[]);addParty(f,{char:f.b,time:T+3000});assert.deepEqual(await fateEvidence(f.env,'101',T+10000),[{id:'dungeon',at:T+3000}]);});

test('tower evidence requires five successful same-day floors credited to this participating character',async t=>{const f=await fixture(t),floors=(n,char=f.a,start=T+1000)=>Array.from({length:n},(_,i)=>({floor:i+1,at:start+i*1000,participants:[char]}));addParty(f,{kind:'tower',floors:floors(4)});addParty(f,{kind:'tower',manual:0,floors:floors(5)});addParty(f,{kind:'tower',floors:floors(5,'202')});addParty(f,{kind:'tower',floors:floors(5,f.a,T-7*3600000)});assert.deepEqual(await fateEvidence(f.env,'101',T+20000),[]);addParty(f,{kind:'tower',char:f.b,time:T+20000,floors:floors(5,f.b,T+10000)});assert.deepEqual(await fateEvidence(f.env,'101',T+30000),[{id:'tower',at:T+14000}]);});

test('birth data requires explicit consent, is account-shared, supports omission and is deletable with stored reminders',async t=>{const f=await fixture(t),birth={date:'1998-11-03',time:null,placeId:null,sex:null};await assert.rejects(F.saveProfile(f.env,f.a,{requestId:rid(),birth},T),error('birth_consent'));assert.equal((await F.profileView(f.env,f.a)).saved,false);const requestId=rid();await F.saveProfile(f.env,f.a,{requestId,consent:true,birth},T);assert.equal((await F.saveProfile(f.env,f.a,{requestId,consent:true,birth},T+1)).replayed,true);const p=await F.profileView(f.env,f.b);assert.equal(p.saved,true);assert.equal(p.coverage,'inspiration');assert.equal(p.birth.sex,null);assert.equal(p.birth.complete,false);assert.equal((await F.profileView(f.env,'202')).saved,false);await F.daily(f.env,f.a,T);const originalNotes=f.one('SELECT notes_json FROM rpg_fate_daily WHERE account_id=?','101').notes_json;await F.saveProfile(f.env,f.a,{requestId:rid(),consent:true,birth:{date:'1998-11-03',time:'10:30',placeId:'taipei',sex:'f',fold:'earlier'}},T+100);assert.equal((await F.profileView(f.env,f.b)).coverage,'three-traditions');assert.equal((await F.profileView(f.env,f.b)).birth.sex,'f','real birth sex comes from explicit consent, not male RPG character');await F.daily(f.env,f.a,T+200);assert.equal(f.one('SELECT notes_json FROM rpg_fate_daily WHERE account_id=?','101').notes_json,originalNotes,'saving a new profile cannot reroll existing daily notes');assert.equal('birth' in (await F.me(f.env,f.a,T+200)).profile,false,'summary does not expose complete birth data');await begin(f,f.a);await F.deleteProfile(f.env,f.b,{requestId:rid()},T+1000);assert.equal((await F.profileView(f.env,f.a)).saved,false);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_daily WHERE account_id=?','101').n,0);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_lives WHERE char_id=?',f.a).n,1);assert.equal((await F.daily(f.env,f.a,T+1001)).profile.coverage,'inspiration');});

test('Mini App requires genuine HMAC, ignores forged tgId and refuses stale or foreign selected characters with 409',async t=>{const f=await fixture(t),requestId=rid();assert.equal((await f.api('fate/me',{},T,'bad')).status,401);assert.equal((await f.api('fate/me',{},T,signed('101','wrong-token'))).status,401);assert.equal((await f.api('fate/me',{tgId:'101'},T,signed('999'))).error,'no_character');assert.equal((await f.api('select',{charId:f.b},T)).ok,true);const good=await f.api('fate/start',{requestId,mode:'random',tgId:'202',selectedCharacterId:f.b},T);assert.equal(good.ok,true,JSON.stringify(good));assert.equal(f.one('SELECT char_id FROM rpg_fate_lives WHERE id=?',good.result.lifeId).char_id,f.b);assert.equal((await f.api('select',{charId:f.a},T)).ok,true);assert.equal((await f.api('fate/choice',{requestId:rid(),lifeId:good.result.lifeId,index:0,answer:0,selectedCharacterId:f.b},lifeSchedule(T)[0])).error,'character_changed');const foreign=await f.api('fate/start',{requestId:rid(),mode:'random',selectedCharacterId:'202'},T);assert.equal(foreign.status,409);assert.equal((await f.svc('fate/notification',{lifeId:good.result.lifeId,index:0},T,'wrong')).status,401);});

test('event sweep queues one notification per choice; night never claims it and dawn resumes the pending event',async t=>{const f=await fixture(t),start=at('2026-10-16T23:35:00'),r=await begin(f,f.a,start),slot=lifeSchedule(start)[0];await F.sweep(f.env,slot);await F.sweep(f.env,slot+1000);await F.state(f.env,f.a,slot+2000);const out=f.all("SELECT * FROM rpg_outbox WHERE kind='fate_event'");assert.equal(out.length,1);assert.equal(out[0].dedupe_key,`fate:${r.result.lifeId}:0`);const night=at('2026-10-17T01:00:00'),status=await F.notification(f.env,{lifeId:r.result.lifeId,index:0},night);assert.equal(status.valid,false);assert.equal(status.night,true);assert.equal(status.pending,true);assert.equal((await f.svc('outbox/claim',{},night)).items.length,0);assert.equal(f.one('SELECT claim_attempts FROM rpg_outbox WHERE id=?',out[0].id).claim_attempts,0);const dawn=at('2026-10-17T06:00:00');assert.equal((await F.notification(f.env,{lifeId:r.result.lifeId,index:0},dawn)).valid,true);const claimed=await f.svc('outbox/claim',{},dawn);assert.equal(claimed.items.length,1);assert.equal(claimed.items[0].kind,'fate_event');assert.equal((await f.svc('outbox/claim',{},dawn+1)).items.length,0);});

test('concurrent starts for one character atomically consume only one daily allowance',async t=>{const f=await fixture(t),both=await Promise.all([begin(f,f.a),begin(f,f.a)]);assert.equal(both[0].result.lifeId,both[1].result.lifeId);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_lives').n,1);assert.equal((await F.state(f.env,f.a,T)).startedToday,1);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_operations').n,2);});

test('deleting a birth profile after daily reads its chart but before INSERT cannot resurrect personal reminders',async t=>{
 const f=await fixture(t);
 await F.saveProfile(f.env,f.a,{requestId:rid(),consent:true,birth:{date:'1998-11-03',time:'10:30',placeId:'taipei',sex:'f',fold:'earlier'}},T);
 boss(f,{time:T+1000});
 const originalPrepare=f.env.DB.prepare.bind(f.env.DB);let interrupted=0;
 t.after(()=>{f.env.DB.prepare=originalPrepare;});
 f.env.DB.prepare=sql=>{
  const stmt=originalPrepare(sql);
  if(!interrupted&&sql.startsWith('INSERT OR IGNORE INTO rpg_fate_daily')){
   const originalBind=stmt.bind.bind(stmt);
   stmt.bind=(...params)=>{
    const bound=originalBind(...params),originalRun=bound.run.bind(bound);
    bound.run=async()=>{
     interrupted++;
     assert.ok(JSON.parse(params[2]).every(note=>note.kind==='個人旅箋'),'the suspended daily request already derived notes from the complete chart');
     assert.ok(params[3]>0,'the pending insertion carries the stale saved-profile revision');
     await F.deleteProfile(f.env,f.b,{requestId:rid()},T+2000);
     assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_profiles WHERE account_id=?','101').n,0);
     assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_daily WHERE account_id=?','101').n,0);
     return originalRun();
    };
    return bound;
   };
  }
  return stmt;
 };
 const result=await F.daily(f.env,f.a,T+3000);
 assert.equal(interrupted,1,'the deletion completed exactly between the chart read and the first insert');
 assert.deepEqual(result.profile,{saved:false,coverage:'inspiration'});
 assert.equal(result.unlocked,1,'genuine task evidence survives the erase');
 assert.equal(result.notes[0].kind,'生活靈感');
 assert.deepEqual(result.notes[1],{topic:'work',locked:true});
 const stored=f.one('SELECT notes_json,profile_rev FROM rpg_fate_daily WHERE account_id=?','101');
 assert.equal(stored.profile_rev,0);
 assert.ok(JSON.parse(stored.notes_json).every(note=>note.kind==='生活靈感'));
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_profiles WHERE account_id=?','101').n,0);
 assert.equal((await F.profileView(f.env,f.a)).saved,false);
});

for(const mode of ['random','birthday'])for(const showSign of [true,false])test(`every ${mode} life keeps its identity zodiac while share visibility=${showSign} remains independent`,async t=>{
 const f=await fixture(t);await begin(f,f.a,T,{mode,showSign,birthDate:'1990-10-24',identityZodiac:99});
 const first=(await F.state(f.env,f.a,T)).active.draft;
 assert.equal(first.identityZodiac,mode==='birthday'?zodiacFor(10,24):generatedZodiac(first.seed));
 assert.equal(first.zodiac,showSign?first.identityZodiac:null);
 const done=await F.state(f.env,f.a,T+LIFE_MS);assert.equal(done.last.draft.identityZodiac,first.identityZodiac);
 assert.equal(decodeResult(done.last.code).zodiac,showSign?first.identityZodiac:null);
 assert.ok(!Object.hasOwn(decodeResult(done.last.code),'identityZodiac'));
});
