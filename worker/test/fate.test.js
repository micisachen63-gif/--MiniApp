import test from 'node:test';
import assert from 'node:assert/strict';
import {validBirth,zodiacFor,encodeResult,decodeResult,publicUrl,telegramUrl,shareText} from '../public/fate/model.js';
import {handle} from '../src/index.js';
import {parseCalendar} from '../../scripts/audit-fate-calendar.mjs';
import {scenesFor,rememberSoul,readSoul,soulMilestone,seedForNextLife} from '../public/fate/cycles.js';
import {createLife,advanceLife,chooseLife,activeBetween,addActive,lifeAge,startStatus,LIFE_MS,CHOICE_MS,taipeiDay} from '../public/fate/life.js';
import {EVENTS,narrativeEvents} from '../public/fate/event-catalog-v1.js';
const base={orbit:11,answers:[1,0,1],zodiac:10,seed:'deadbeef'};
test('public story codec contains only cosmetic indices, rejects malformed/future/injected payloads',()=>{
 const code=encodeResult(base),r=decodeResult(code);assert.equal(r.identity[0],'無名旅人');assert.equal(r.ending.title,'織星同行者');assert.equal(code,'f1b101adeadbeef');
 for(const bad of ['','f3b101adeadbeef','f1c101adeadbeef','f1b201adeadbeef','f1b101zdeadbeef',code+'/','<script>',code+'2000-12-01'])assert.equal(decodeResult(bad),null);
 assert.ok(telegramUrl(code).split('start=')[1].length<=64);assert.ok(!publicUrl(code).includes('生日'));assert.throws(()=>publicUrl('no'));
 const hidden=decodeResult(encodeResult({...base,zodiac:null}));assert.equal(hidden.zodiac,null);assert.ok(!shareText(hidden).includes('天蠍'));assert.ok(shareText(r).includes('天蠍'));
});
test('eight distinct decision paths resolve to all four stable authored endings',()=>{
 const counts=new Map();for(let bits=0;bits<8;bits++){const answers=[bits>>2&1,bits>>1&1,bits&1],r=decodeResult(encodeResult({...base,answers}));counts.set(r.ending.title,(counts.get(r.ending.title)||0)+1);assert.deepEqual(r.answers,answers);assert.deepEqual(decodeResult(r.code),r);}assert.equal(counts.size,4);assert.deepEqual([...counts.values()],[1,3,3,1]);
});
test('a new incarnation changes events; its seed preserves choices and ages when reopened',()=>{
 const a=decodeResult(encodeResult({...base,version:2,seed:'00000000'})),b=decodeResult(encodeResult({...base,version:2,seed:'01010101'}));
 assert.notDeepEqual(scenesFor(a).map(s=>s.title),scenesFor(b).map(s=>s.title));assert.deepEqual(scenesFor(a),scenesFor(decodeResult(a.code)));assert.deepEqual(scenesFor(a).map(s=>s.age),[18,30,55]);assert.ok(scenesFor(b)[0].age<scenesFor(b)[1].age&&scenesFor(b)[1].age<scenesFor(b)[2].age);
 const old=decodeResult(encodeResult(base));assert.equal(scenesFor(old)[0].title,'風起之前，你遇見了誰？');
});
test('soul journal retains every completed life once, reconstructs memories, and milestones do not leak between characters',()=>{
 let first=readSoul(null);const other=readSoul(null);
 for(let i=0;i<5;i++){const code=encodeResult({...base,version:2,seed:i.toString(16).padStart(8,'0')});first=rememberSoul(first,code,1000+i);first=rememberSoul(first,code,9000);}
 assert.equal(first.entries.length,5);assert.equal(other.entries.length,0);assert.equal(soulMilestone(first).current.title,'拾光之魂');assert.equal(soulMilestone(first).next.at,10);assert.deepEqual(readSoul(JSON.stringify(first)),first);assert.deepEqual(rememberSoul(first,'<script>'),first);
});
test('birthday validation uses Gregorian dates, leap years and rejects future dates',()=>{
 const today=new Date('2030-12-31T12:00:00Z');assert.equal(validBirth('2028-02-29',today).day,29);for(const d of ['2027-02-29','2026-04-31','2026-00-01','2026-13-01','1899-12-31','2031-01-01','2026-2-1'])assert.equal(validBirth(d,today),null);
 assert.equal(zodiacFor(1,19),0);assert.equal(zodiacFor(1,20),1);assert.equal(zodiacFor(12,22),0);assert.equal(zodiacFor(10,24),10);
});
test('daily task boundary uses Taipei midnight rather than the browser locale',()=>{
 assert.equal(taipeiDay(Date.parse('2026-10-16T15:59:59Z')),'2026-10-16');
 assert.equal(taipeiDay(Date.parse('2026-10-16T16:00:00Z')),'2026-10-17');
});
test('public story OG is readable without login, DB access or player info, existing private API remains protected',async()=>{
 const env={SERVICE_SECRET:'fixture-only-long-enough',DB:new Proxy({},{get(){assert.fail('public page touched DB')}})},code=encodeResult(base);
 const r=await handle(new Request('https://fixture/fate/r/'+code),env);assert.equal(r.status,200);const html=await r.text();assert.match(html,/og:title/);assert.match(html,/織星同行者/);assert.ok(html.includes('https://star-journal-rpg-bot.micisachen.workers.dev/fate-card/'+code+'/post.jpg'));assert.match(html,/og:image:width[^>]+1080/);assert.match(html,/og:image:height[^>]+1350/);assert.ok(!html.includes('tg_id'));assert.ok(!html.includes('fixture-only'));assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'self'/);
 assert.equal((await handle(new Request('https://fixture/fate/r/no'),env)).status,404);
 assert.equal(await(await handle(new Request('https://fixture/fate/r/no',{method:'HEAD'}),env)).text(),'');
 assert.equal((await handle(new Request('https://fixture/fate/r/'+code,{method:'POST'}),env)).status,405);
 assert.equal(await(await handle(new Request('https://fixture/fate/r/'+code,{method:'HEAD'}),env)).text(),'');
 assert.equal((await handle(new Request('https://fixture/rpg/me',{method:'POST',body:'{}'}),env)).status,401);
});
function fixtureCalendar(year){let n=0;return Array.from({length:12},(_,i)=>{const days=new Date(Date.UTC(year,i+1,0)).getUTCDate();return `${year}年\n${i+1} 月\n星期日\n`+Array.from({length:days},(_,d)=>`${d+1}\n初一\n\n${'甲乙丙丁戊己庚辛壬癸'[n%10]}${'子丑寅卯辰巳午未申酉戌亥'[n++%12]}\n\n`).join('')+'二十四節氣: [小寒] 5d12h00m [大寒] 20d12h00m\n';}).join('\n');}
test('user calendar parser detects missing, duplicate and broken cycle dates, handles leap day',()=>{
 assert.equal(parseCalendar(fixtureCalendar(2028),2028).dayCount,366);assert.equal(parseCalendar(fixtureCalendar(2026),2026).dayCount,365);
 assert.throws(()=>parseCalendar(fixtureCalendar(2028).replace('29\n初一\n\n壬辰','28\n初一\n\n壬辰'),2028));
 assert.throws(()=>parseCalendar(fixtureCalendar(2026).replace('甲子','乙丑'),2026),/cycle/);
});
const at=s=>Date.parse(s+'+08:00');
test('life is exactly two active hours; Taipei midnight pauses age and resumes at six',()=>{
 const begin=at('2026-10-16T23:00:00'),d=createLife({...base,startedAt:begin});
 assert.equal(advanceLife(d,begin+LIFE_MS).completed,false);
 assert.equal(lifeAge(d,at('2026-10-17T00:00:00')),45);
 assert.equal(lifeAge(d,at('2026-10-17T05:59:59')),45);
 const end=addActive(begin,LIFE_MS);assert.equal(end,at('2026-10-17T07:00:00'));
 assert.equal(activeBetween(begin,end),LIFE_MS);assert.equal(advanceLife(d,end-1).completed,false);
 const done=advanceLife(d,end);assert.equal(done.completed,true);assert.equal(done.draft.answers.length,3);assert.deepEqual(done.draft.sources,['auto','auto','auto']);
 assert.equal(decodeResult(done.code).version,3);assert.deepEqual(decodeResult(done.code).auto,[1,1,1]);assert.ok(done.code.length<64);
 assert.deepEqual(advanceLife(done.draft,end+999999).draft,done.draft); // no next life, no duplicate selections
 assert.throws(()=>createLife({...base,startedAt:at('2026-10-17T02:00:00')}));
});
test('choice deadlines also pause at night; manual response cannot overwrite an expired choice',()=>{
 const d=createLife({...base,startedAt:at('2026-10-16T23:35:00')}),v=advanceLife(d,at('2026-10-16T23:59:00'));
 assert.equal(v.available,true);assert.equal(addActive(v.slots[0],CHOICE_MS),at('2026-10-17T06:00:30'));
 const night=advanceLife(d,at('2026-10-17T04:00:00'));assert.equal(night.draft.answers.length,0);assert.equal(night.available,false);
 const manual=chooseLife(night.draft,0,at('2026-10-17T06:00:20'),0);assert.deepEqual(manual.draft.sources,['manual']);
 const expired=advanceLife(d,at('2026-10-17T06:00:30'));assert.deepEqual(expired.draft.sources,['auto']);
 assert.throws(()=>chooseLife(expired.draft,1,at('2026-10-17T06:00:31'),0));
 assert.equal(advanceLife(manual.draft,d.startedAt).draft.clockAt,manual.draft.clockAt); // no rollback
});
test('four starts per Taipei day, no night starts, next day opens again',()=>{
 const now=at('2026-10-16T12:00:00'),starts=[0,1,2,3].map(i=>now+i*1000);
 assert.equal(startStatus(starts.slice(0,3),now).allowed,true);assert.equal(startStatus(starts,now).allowed,false);
 assert.equal(startStatus([],at('2026-10-17T05:59:59')).night,true);
 assert.equal(startStatus(starts,at('2026-10-17T06:00:00')).allowed,true);
});
test('authored event library prevents repeats in a life and respects the previous three lives',()=>{
 assert.equal(EVENTS.length,180);assert.equal(new Set(EVENTS.map(e=>e.id)).size,180);
 assert.equal(new Set(EVENTS.map(e=>e.text)).size,180);
 const recent=[],seen=new Set();let previous=null;
 for(let i=0;i<4;i++){
  const d=createLife({...base,seed:(i+10).toString(16).padStart(8,'0'),startedAt:at('2026-10-16T08:00:00')});
  d.recentEventIds=recent.slice(-63);const final=advanceLife(d,addActive(d.startedAt,LIFE_MS)),rows=narrativeEvents(final.draft,final.endAt).filter(e=>e.id!=='birth');
  assert.equal(new Set(rows.map(e=>e.id)).size,rows.length);
  for(const e of rows){assert.ok(!seen.has(e.id),'repeated event '+e.id);seen.add(e.id);recent.push(e.id);}
  const r=decodeResult(final.code),remember=rememberSoul({entries:[]},r.code,1,rows);assert.deepEqual(readSoul(JSON.stringify(remember)).entries[0].memories,rows.map(e=>({id:e.id,age:e.age,text:e.text})));
  assert.ok(rows.find(e=>e.age===30).text.includes(scenesFor(r)[0].choices[r.answers[0]][2]));previous=final;
 }
 assert.ok(previous.completed);
});

test('consecutive lives avoid repeating any major choice from the previous three lives',()=>{
 let journal={entries:[]};for(let i=0;i<40;i++){
  const recent=journal.entries.slice(-3).map(e=>scenesFor(decodeResult(e.code)));
  const seed=seedForNextLife('000000'+i.toString(16).padStart(2,'0'),journal.entries),r=decodeResult(encodeResult({...base,seed,version:3,auto:[0,0,0]}));
  scenesFor(r).forEach((s,n)=>assert.ok(!recent.some(rows=>rows[n].title===s.title)));
  journal=rememberSoul(journal,r.code);assert.equal(journal.entries.length,i+1);
 }
});
