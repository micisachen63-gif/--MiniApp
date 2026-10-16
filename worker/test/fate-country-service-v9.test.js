import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {freshDb} from './d1-shim.js';
import {CurrentClientRequest} from './client-request.js';
import {handle} from '../src/index.js';
import {createCharacter} from '../src/services/player.js';
import * as F from '../src/services/fate.js';
import {COUNTRY_METADATA_V9,ensureCountryPack} from '../public/fate/country-runtime-v9.js';
import {createLife,advanceLife,addActive,CHOICE_MS,LIFE_MS} from '../public/fate/life.js';
import {replayCountryLife} from '../public/fate/country-engine-v9.js';
import {decodeResult,encodeResult} from '../public/fate/model.js';
import {plannedContent} from '../public/fate/formal-events.js';
import {seedForNextLife} from '../public/fate/cycles.js';
const T=Date.parse('2026-10-16T06:00:00+08:00'),TOKEN='123456789:ISOLATED_COUNTRY_FIXTURE';

test('changing countries keeps all previous editions and avoids the last three same-country shelves across intervening lives',async t=>{
 const env={DB:freshDb()},char=(await createCharacter(env,{tgId:'809',name:'跨國驗收旅人',baseClass:'mage',gender:'f'},T)).char.tg_id;t.after(()=>env.DB.sqlite.close());
 const countries=['JP','US','TW','DE'],shelves=new Map();
 for(let i=0;i<16;i++){const country=countries[i%4],at=T+Math.floor(i/4)*86400000+i%4*LIFE_MS;await F.start(env,char,{requestId:crypto.randomUUID(),country,mode:'random'},at);const state=await F.state(env,char,at+LIFE_MS),d=state.last.draft,result=decodeResult(state.last.code);assert.equal(result.country,country);assert.equal(result.version,country==='TW'?8:9);assert.equal(state.completed,i+1);
  if(result.version===9){const recent=shelves.get(country)||[],shelf=parseInt(d.seed.slice(6),16)&3;assert.ok(recent.slice(-3).every(s=>s!==shelf),'intervening countries cannot erase same-country recent history');recent.push(shelf);shelves.set(country,recent);}
 }
 const history=await F.history(env,char,{},T+4*86400000);assert.equal(history.entries.length,10);assert.deepEqual(new Set(history.entries.map(e=>decodeResult(e.code).country)),new Set(countries));
 await assert.rejects(F.start(env,char,{requestId:crypto.randomUUID(),country:'JP',mode:'random'},T+3*86400000+4*LIFE_MS),e=>e.code==='fate_limit');
});

for(const country of Object.keys(COUNTRY_METADATA_V9)){
 test(country+' named colleagues begin only at actual employment and stop at its end',async()=>{
  await ensureCountryPack(country);let colleagueRows=0;
  const socialCast={v:1,people:[{thread:'rooftop',name:'驗收鄰居'},{thread:'rival',name:'驗收同行'},{thread:'letter',name:'驗收朋友'}]};
  for(let i=0;i<100;i++){const raw={version:9,country,seed:(Math.imul(i+1,2654435761)>>>0).toString(16).padStart(8,'0'),orbit:i%12},run=replayCountryLife(raw),d={...raw,answers:run.answers,auto:run.auto,socialCast},rows=plannedContent(d).filter(r=>r.kind==='relationship');
   assert.equal(new Set(rows.map(r=>r.text)).size,rows.length);for(const r of rows){assert.ok(r.actor.startsWith('驗收'));assert.doesNotMatch(r.text,/\{name\}/);if(r.role==='colleague'){colleagueRows++;assert.ok(r.age>=18&&r.state.workActive&&r.state.employed);assert.notEqual(r.state.careerId,'household-care');const first=run.resolved.find(s=>s.stateAfter.workActive&&s.stateAfter.employed);assert.ok(first&&r.activeMs>first.atMs);const end=run.resolved.find(s=>s.atMs>first.atMs&&(!s.stateAfter.workActive||!s.stateAfter.employed||s.stateAfter.careerId!==first.stateAfter.careerId));if(end)assert.ok(r.activeMs<end.atMs);}}
  }assert.ok(colleagueRows>0);
 });
 test(country+' a later job cannot rewrite already witnessed named memories',async()=>{
  await ensureCountryPack(country);const socialCast={v:1,people:[{thread:'ferry',name:'驗收旅人'},{thread:'rooftop',name:'驗收鄰居'},{thread:'letter',name:'驗收朋友'}]};
  for(let i=0;i<80;i++){const raw={version:9,country,seed:i.toString(16).padStart(8,'0'),orbit:i%12},complete=replayCountryLife(raw),full=plannedContent({...raw,answers:complete.answers,auto:complete.auto,socialCast});
   for(const cut of [2400000,3346398,4800000]){const early=replayCountryLife(raw,{activeMs:cut}),before=plannedContent({...raw,answers:early.answers,auto:early.auto,socialCast},{activeMs:cut});assert.deepEqual(before,full.filter(r=>r.activeMs<=cut),'future employment must not select a different childhood relationship');}
  }
 });
 test(country+' six thousand causal runs reach all 48 authored job dilemmas and keep care unpaid',async()=>{
  const pack=await ensureCountryPack(country),seen=new Set(),outcomes=new Set();let cares=0;
  for(let i=0;i<6000;i++){const run=replayCountryLife({version:9,country,seed:(Math.imul(i+1,2654435761)>>>0).toString(16).padStart(8,'0'),orbit:i%12});outcomes.add(run.terminalOutcome);
   let completedStudy=false,previous=null;for(const r of run.resolved){if(previous?.workActive&&r.stateAfter.workActive&&previous.careerId===r.stateAfter.careerId)assert.ok(r.stateAfter.careerStage>=previous.careerStage,'later ordinary work cannot lower an established career stage');previous=r.stateAfter;if(r.id.startsWith('job-'))seen.add(r.id);if(['career-entry','restart-entry'].includes(r.id)&&r.answer===0&&pack.careers.find(c=>c.id===r.stateAfter.careerId)?.employmentMode==='self-employed'){assert.equal(r.stateAfter.employed,false);assert.equal(r.stateAfter.selfEmployed,true);assert.equal(r.stateAfter.ventureOpen,true);assert.ok(r.consequences.delta.money<=0);}if(r.id==='study-complete'&&r.answer===0)completedStudy=true;if(completedStudy)assert.equal(r.stateAfter.education,'course-completed','ending work practice cannot erase a separately completed course');if(r.stateAfter.careerId==='household-care'){cares++;assert.equal(r.stateAfter.employed,false);assert.equal(r.stateAfter.ventureOpen,false);assert.ok(!['work-delivery','work-renewal','business-start','business-pressure'].includes(r.id));if(['career-entry','restart-entry'].includes(r.id))assert.ok(r.consequences.delta.money<=0);}}
  }
  assert.deepEqual([...seen].sort(),pack.careers.flatMap(c=>c.dilemmas.map(d=>'job-'+d.id)).sort());assert.ok(cares>0);assert.ok(outcomes.has('venture-builder')&&outcomes.has('debt-rebuilding')&&outcomes.has('family-care')&&outcomes.has('career-transition'));
 });
 test(country+' signed start, variable decisions, public replay and recent-life diversity',async t=>{
  const pack=await ensureCountryPack(country),env={DB:freshDb(),BOT_TOKEN:TOKEN,ENVIRONMENT:'development',ALLOW_DEBUG_TIME:'true',GROUP_CHAT_ID:'-100TEST'};t.after(()=>env.DB.sqlite.close());
  const char=(await createCharacter(env,{tgId:'808',name:'國別驗收旅人',baseClass:'mage',gender:'f'},T)).char.tg_id,fields={auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:808,first_name:'隔離驗收'})},key=createHmac('sha256','WebAppData').update(TOKEN).digest(),init=new URLSearchParams({...fields,hash:createHmac('sha256',key).update(Object.keys(fields).sort().map(k=>k+'='+fields[k]).join('\n')).digest('hex')}).toString();
  const api=async(action,body={},now=T)=>{const response=await handle(new CurrentClientRequest('https://test/app/api/'+action,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Init-Data':init,'X-Debug-Now':String(now)},body:JSON.stringify({...body,selectedCharacterId:char})}),env);return {status:response.status,...await response.json()};};
  assert.equal((await api('select',{charId:char})).ok,true);assert.equal((await api('fate/start',{requestId:crypto.randomUUID(),country:'ZZ',mode:'random'})).ok,false);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_fate_lives').get().n,0);
  const body={requestId:crypto.randomUUID(),country,mode:'random',seed:'client-seed-is-ignored'},start=await api('fate/start',body);assert.equal(start.ok,true);assert.equal((await api('fate/start',body)).replayed,true);
  const row=env.DB.sqlite.prepare('SELECT * FROM rpg_fate_lives WHERE id=?').get(start.result.lifeId),d=JSON.parse(row.state_json);assert.equal(d.version,9);assert.equal(d.country,country);assert.match(d.seed,/^[a-f0-9]{8}$/);
  let now=T,count=0;for(let i=0;i<12;i++){const current=await F.state(env,char,now);if(!current.active)break;const gate=advanceLife(current.active.draft,now);now=gate.nextAt;const opened=await F.state(env,char,now);if(!opened.active)break;const available=advanceLife(opened.active.draft,now);if(!available.available)continue;
   const notice=await F.notification(env,{lifeId:row.id,index:available.index},now);assert.equal(notice.valid,true);assert.equal(notice.payload.country,country);const answer={requestId:crypto.randomUUID(),lifeId:row.id,index:available.index,answer:0};assert.equal((await api('fate/choice',answer,now)).ok,true);assert.equal((await api('fate/choice',answer,now+1)).replayed,true);count++;now=addActive(available.slots[available.index],CHOICE_MS);
  }
  assert.ok(count>0);const done=await F.state(env,char,T+LIFE_MS),result=decodeResult(done.last.code);assert.equal(done.completed,1);assert.equal(done.active,null);assert.equal(result.country,country);assert.equal(result.version,9);assert.deepEqual(plannedContent(result).filter(r=>r.kind==='choice').map(r=>r.text),plannedContent(done.last.draft).filter(r=>r.kind==='choice').map(r=>r.text));
  const page=await handle(new Request('https://test/fate/r/'+result.code),env);assert.equal(page.status,200);assert.match(await page.text(),/countries9/);
  const history=[],recent=[];for(let i=0;i<12;i++){const seed=seedForNextLife((0xabc000+i*7919).toString(16).padStart(8,'0'),history,9,i%12,country),run=replayCountryLife({version:9,country,seed,orbit:i%12}),life={version:9,country,seed,orbit:i%12,answers:run.answers,auto:run.auto,zodiac:4},memories=plannedContent(life).filter(r=>r.kind==='memory'),seen=new Set(recent.slice(-3).flatMap(r=>r.texts)),shelf=parseInt(seed.slice(6),16)&3;
   assert.ok(recent.slice(-3).every(r=>r.shelf!==shelf));if(i>=3)assert.ok(memories.filter(r=>seen.has(r.text)).length/memories.length<.08,'recent daily sentence overlap under 8% in the regression sample');history.push({code:encodeResult(life)});recent.push({shelf,texts:memories.map(r=>r.text)});
  }
  assert.equal(pack.careers.length,12);
 });
 test(country+' thousand real books retain 240 unique ticks, age windows and every career entry',async()=>{
  const pack=await ensureCountryPack(country),careers=new Set(),ages=new Set(),shelves=new Set();
  for(let i=0;i<1000;i++){const seed=(Math.imul(i+1,2654435761)>>>0).toString(16).padStart(8,'0'),raw={version:9,country,seed,orbit:i%12},run=replayCountryLife(raw),d={...raw,answers:run.answers,auto:run.auto,zodiac:4},rows=plannedContent(d),memory=rows.filter(r=>['memory','career'].includes(r.kind));assert.equal(memory.length,240);assert.equal(new Set(memory.map(r=>r.text)).size,240);assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);assert.ok(rows.every(r=>/^[a-z0-9-]{1,32}$/.test(r.id)));assert.ok(rows.filter(r=>r.kind==='career').every(r=>r.state.workActive));
   const decoded=decodeResult(encodeResult(d));assert.deepEqual(plannedContent(decoded),rows);if(run.state.careerId)careers.add(run.state.careerId);ages.add(run.profile.deathAge);shelves.add(parseInt(seed.slice(6),16)&3);
   for(const r of run.resolved)if(r.stateAfter.careerId==='household-care'){assert.equal(r.stateAfter.employed,false);assert.equal(r.stateAfter.ventureOpen,false);}
  }
  assert.equal(careers.size,pack.careers.length);assert.equal(ages.size,45);assert.equal(shelves.size,4);
 });
}
