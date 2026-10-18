import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {freshDb} from './d1-shim.js';
import {CurrentClientRequest} from './client-request.js';
import {handle} from '../src/index.js';
import {createCharacter} from '../src/services/player.js';
import * as F from '../src/services/fate.js';
import {createLife,advanceLife,chooseLife,lifeSchedule,addActive,lifeAge,LIFE_MS,CHOICE_MS,validLife} from '../public/fate/life.js';
import {decodeResult,encodeResult,telegramUrl} from '../public/fate/model.js';
import {replayTaiwanLife,taiwanProfile} from '../public/fate/decision-engine-v8.js';
import {formalEvents,plannedContent,narrativeProfile} from '../public/fate/formal-events.js';
import {endingForLife} from '../public/fate/ending-story.js';
import {readSoul,rememberSoul,seedForNextLife} from '../public/fate/cycles.js';
import {TAIWAN_MEMORIES_V8,TAIWAN_CAREER_CHAPTERS_V8,TAIWAN_TEACHER_CHAPTERS_V8} from '../public/fate/taiwan-content-v8.js';
import {narrativeV8Inventory} from '../public/fate/narrative-v8.js';
import {fatePublic} from '../src/fate-public.js';
const T=Date.parse('2026-10-16T06:00:00+08:00'),TOKEN='123456789:FAKE_LOCALIZATION_TEST_TOKEN';
const draft=(seed='00000001',orbit=11)=>createLife({version:8,country:'TW',seed,orbit,zodiac:4,startedAt:T});
function play(seed,answer=0,orbit=11){let d=draft(seed,orbit);for(let i=0;i<10;i++){const v=advanceLife(d,d.clockAt);if(v.completed)break;const now=v.available?d.clockAt:v.nextAt;const next=advanceLife(d,now);if(next.available){const scene=replayTaiwanLife({...next.draft,auto:next.draft.sources.map(s=>s==='auto'?1:0)},{activeMs:now-T}).pending;d=chooseLife(next.draft,answer,now,next.index).draft;d=advanceLife(d,addActive(T,scene.deadlineMs)).draft;}else{d=next.draft;if(now>=T+LIFE_MS)break;}}return advanceLife(d,T+LIFE_MS);}

test('localized draft and public codec carry an explicit enabled country, retain identity and reject unsupported or incomplete countries',()=>{
 assert.equal(validLife({...draft(),country:'JP'}),null);assert.throws(()=>createLife({...draft(),country:'JP'}));
 const done=advanceLife(draft(),T+LIFE_MS),result=decodeResult(done.code);assert.equal(result.version,8);assert.equal(result.country,'TW');assert.equal(result.code.length,33);assert.match(result.identity[0],/女性|男性/);assert.match(result.identity[1],/臺灣/);assert.equal(encodeResult(result),done.code);assert.ok(telegramUrl(done.code).split('start=')[1].length<=64);
 assert.equal(decodeResult(done.code.replace('f8tw','f8jp')),null);assert.equal(decodeResult(done.code.slice(0,5)+'0'+done.code.slice(6)),null);assert.throws(()=>encodeResult({...draft(),auto:[]}));
 assert.equal(decodeResult(done.code+'0'),null);assert.equal(decodeResult(done.code.replace('tw','TW')),null);
});

test('localized life keeps the fixed two active hours and pauses across midnight without re-rolling identity or events',()=>{
 const at=Date.parse('2026-10-16T23:00:00+08:00'),d=createLife({...draft(),startedAt:at});
 const a=advanceLife(d,Date.parse('2026-10-17T00:00:00+08:00')),b=advanceLife(a.draft,Date.parse('2026-10-17T05:59:00+08:00'));
 assert.equal(a.night,true);assert.equal(b.available,false);assert.equal(lifeAge(a.draft,a.draft.clockAt),lifeAge(b.draft,b.draft.clockAt));assert.deepEqual(a.draft.answers,b.draft.answers);assert.equal(advanceLife(b.draft,Date.parse('2026-10-17T07:00:00+08:00')).completed,true);
});

test('Taiwan lives have 240 nonrepeating age-appropriate authored ticks and only actual work and family facts',()=>{
 const inventory=narrativeV8Inventory();assert.equal(inventory.memoryCount,1738);assert.equal(inventory.careerCount,16);assert.equal(inventory.careerChapters,170);
 for(let i=0;i<48;i++){
  const seed=i.toString(16).padStart(8,'0'),d=advanceLife(draft(seed,i%12),T+LIFE_MS).draft,rows=plannedContent(d),memories=rows.filter(row=>['memory','career'].includes(row.kind));
  assert.equal(memories.length,240);assert.equal(new Set(memories.map(row=>row.text)).size,240);assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);assert.doesNotMatch(rows.map(row=>row.text).join(''),/星曆|城邦|白石神殿|航海簿|感恩節/);
  assert.ok(rows.every(row=>row.activeMs>=0&&row.activeMs<=LIFE_MS));
  for(const row of rows.filter(row=>row.kind==='career'))assert.equal(row.state.workActive,true);
  for(const row of rows.filter(row=>row.id==='tw8-infant-3'||row.id==='tw8-infant-12'||row.id==='tw8-infant-18'))assert.ok(row.age>=1,'walking, spoon feeding and speaking do not occur in the newborn months');
  for(const row of rows.filter(row=>row.kind==='memory')){const source=TAIWAN_MEMORIES_V8.find(item=>item.id===row.id);if(source){assert.ok(Math.floor(row.age)>=source.minAge&&Math.floor(row.age)<=source.maxAge,row.id);for(const flag of source.requires||[])assert.equal(row.state[flag],true);if(source.needsChildren)assert.ok(row.state.children>0);}}
  const story=endingForLife(d),result=decodeResult(advanceLife(d,T+LIFE_MS).code);assert.equal(story.chapters[0].age,0);assert.equal(story.chapters.at(-1).age,result.deathAge);assert.ok(story.chapters.every((row,j)=>!j||row.age>=story.chapters[j-1].age));assert.match(story.paragraphs.join(''),/\d+歲｜/);assert.equal(story.illustration,'/art/fate-taiwan-v8/river-memory.webp');
 }
});

test('teacher chapters occur only after the complete actual qualification and hiring chain',()=>{
 const life={version:8,country:'TW',seed:'0000001d',orbit:11,answers:[0,0,0,0,0,1,0,0],auto:Array(8).fill(0)},run=replayTaiwanLife(life),rows=plannedContent(life);assert.equal(run.state.teacherHired,true);
 const hire=run.resolved.find(row=>row.stateAfter.teacherHired);assert.ok(hire);const teacherTexts=new Set(TAIWAN_TEACHER_CHAPTERS_V8.map(row=>row.text));assert.ok(rows.some(row=>teacherTexts.has(row.text)));for(const row of rows.filter(row=>teacherTexts.has(row.text))){assert.ok(row.activeMs>=hire.atMs);for(const flag of TAIWAN_TEACHER_CHAPTERS_V8[0].gate.requires)assert.equal(row.state[flag],true);}
 const administrative=new Set(TAIWAN_CAREER_CHAPTERS_V8.early_childhood_assistant.map(row=>row.text));assert.ok(rows.filter(row=>row.activeMs>=hire.atMs).every(row=>!administrative.has(row.text)));
});

test('completion memories and public replay preserve every actual localized decision without private birth fields',()=>{
 const done=play('00000001'),rows=plannedContent(done.draft),record=readSoul(JSON.stringify(rememberSoul({entries:[]},done.code,T+LIFE_MS,rows)));
 for(const row of rows.filter(row=>row.kind==='choice'))assert.ok(record.entries[0].memories.some(item=>item.id===row.id&&item.text===row.text));
 const result=decodeResult(done.code);assert.deepEqual(plannedContent(result).filter(row=>row.kind==='choice').map(row=>row.text),rows.filter(row=>row.kind==='choice').map(row=>row.text));assert.equal(result.country,'TW');assert.equal(narrativeProfile(result).country,'TW');
 assert.throws(()=>seedForNextLife('00000001',[],8,11,'JP'));assert.equal(seedForNextLife('00000001',[],8,11,'TW'),'00000001');
});

test('localized public shell and game use the same entry tags and the Taiwan card renderer version',async()=>{
 const code=advanceLife(draft(),T+LIFE_MS).code,html=await fatePublic(new Request('https://test/fate/r/'+code)).text(),entry=readFileSync(new URL('../public/fate/index.html',import.meta.url),'utf8');
 assert.match(html,/20261018-world1/);for(const file of ['app.js','style.css','daily.css']){const re=new RegExp('/fate/'+file.replace('.','\\.')+'\\?v=([^"<>]+)');assert.equal(html.match(re)?.[1],entry.match(re)?.[1]);}assert.match(readFileSync(new URL('../public/fate-entry.js',import.meta.url),'utf8'),/8tw/);
});

test('actual signed API starts Taiwan lives, rejects locked country without quota, and persists later choices through completion',async t=>{
 const env={DB:freshDb(),BOT_TOKEN:TOKEN,ENVIRONMENT:'development',ALLOW_DEBUG_TIME:'true',GROUP_CHAT_ID:'-100TEST'};t.after(()=>env.DB.sqlite.close());const owner='808',char=(await createCharacter(env,{tgId:owner,name:'在地測試旅人',baseClass:'mage',gender:'f'},T)).char.tg_id;
 const fields={auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:808,first_name:'隔離驗收'})},key=createHmac('sha256','WebAppData').update(TOKEN).digest(),init=new URLSearchParams({...fields,hash:createHmac('sha256',key).update(Object.keys(fields).sort().map(k=>k+'='+fields[k]).join('\n')).digest('hex')}).toString();
 const api=async(action,body,now=T)=>{const res=await handle(new CurrentClientRequest('https://test/app/api/'+action,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Init-Data':init,'X-Debug-Now':String(now)},body:JSON.stringify({...body,selectedCharacterId:char})}),env);return {status:res.status,...await res.json()};};
 assert.equal((await api('select',{charId:char})).ok,true);const locked=await api('fate/start',{requestId:crypto.randomUUID(),mode:'random',country:'ZZ'});assert.equal(locked.ok,false);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_fate_lives').get().n,0);
 const start=await api('fate/start',{requestId:crypto.randomUUID(),mode:'random',country:'TW'});assert.equal(start.ok,true);const row=env.DB.sqlite.prepare('SELECT * FROM rpg_fate_lives WHERE id=?').get(start.result.lifeId),d={...JSON.parse(row.state_json),seed:'00000001',orbit:11};env.DB.sqlite.prepare('UPDATE rpg_fate_lives SET state_json=?,next_at=? WHERE id=?').run(JSON.stringify(d),lifeSchedule(T,d)[0],row.id);
 let now=T,answerCount=0;for(let i=0;i<12;i++){const view=await F.state(env,char,now);if(!view.active)break;const pending=advanceLife(view.active.draft,now);now=Math.max(now,pending.nextAt);const open=await F.state(env,char,now);if(!open.active)break;const available=advanceLife(open.active.draft,now);if(!available.available)continue;const valid=await F.notification(env,{lifeId:row.id,index:available.index},now);assert.equal(valid.valid,true);const body={requestId:crypto.randomUUID(),lifeId:row.id,index:available.index,answer:0};assert.equal((await api('fate/choice',body,now)).ok,true);assert.equal((await api('fate/choice',body,now+1)).replayed,true);answerCount++;now=addActive(available.slots[available.index],CHOICE_MS);}
 assert.ok(answerCount>3);const end=await F.state(env,char,T+LIFE_MS);assert.equal(end.completed,1);assert.equal(end.active,null);const result=decodeResult(end.last.code);assert.equal(result.version,8);assert.equal(result.country,'TW');assert.ok(formalEvents(end.last.draft,T+LIFE_MS).some(row=>row.kind==='choice'));assert.equal((await F.notification(env,{lifeId:row.id,index:8},T+LIFE_MS)).valid,false);
});

test('successive localized lives avoid the three recent content shelves and public links reproduce the chosen life',()=>{
 const entries=[],recent=[];
 for(let i=0;i<12;i++){
  const raw=(0xabc000+i*7919).toString(16).padStart(8,'0'),orbit=i%12,seed=seedForNextLife(raw,entries,8,orbit,'TW');
  const shelf=parseInt(seed.slice(6),16)&3;assert.ok(recent.slice(-3).every(row=>row.shelf!==shelf));
  const run=replayTaiwanLife({version:8,country:'TW',seed,orbit}),life={version:8,country:'TW',seed,orbit,answers:run.answers,auto:run.auto,zodiac:4};
  const rows=plannedContent(life),memories=rows.filter(row=>row.kind==='memory'),seen=new Set(recent.slice(-3).flatMap(row=>row.texts));
  if(i>=3)assert.ok(memories.filter(row=>seen.has(row.text)).length/memories.length<.08,'recent daily text repetition stays below 8% in this regression sample');
  const code=encodeResult(life);assert.deepEqual(plannedContent(decodeResult(code)),rows);entries.push({code});recent.push({shelf,texts:memories.map(row=>row.text)});
 }
});

test('all localized shared memories survive the soul archive ID contract with their actual text and age',()=>{
 const d=advanceLife(draft('0000001d'),T+LIFE_MS),keys=['moving','parcel','repair','market','umbrella','bookstore'];
 const shared=keys.map((key,i)=>({id:'shared-tw8_'+key,at:T+(i+1)*600000,ownerName:'旅人甲',guestName:'旅人乙',answer:0,source:'manual',text:'你與旅人乙完成了'+key+'的共同故事。'}));
 const rows=plannedContent({...d.draft,sharedMemories:shared});assert.ok(rows.every(row=>/^[a-z0-9-]{1,32}$/.test(row.id)), 'all narrative IDs fit the archive format');
 const record=rememberSoul({entries:[]},d.code,T+LIFE_MS,rows);for(const memory of shared)assert.ok(record.entries[0].memories.some(row=>row.text===memory.text));
});
