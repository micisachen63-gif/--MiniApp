import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeResult,decodeResult} from '../public/fate/model.js';
import {createLife,validLife,advanceLife,chooseLife,addActive,lifeAge,LIFE_MS,CHOICE_MS} from '../public/fate/life.js';
import {scenesFor,readSoul,seedForNextLife} from '../public/fate/cycles.js';
import {formalScenes} from '../public/fate/formal-events.js';
import {endingForLife} from '../public/fate/ending-story.js';
const at=s=>Date.parse(s+'+08:00'),base={orbit:11,zodiac:null,seed:'deadbeef',startedAt:at('2026-10-16T23:35:00')};
test('f4 cosmetic codec preserves all source bits, legacy f1/f2/f3 byte semantics and Telegram limits',()=>{
 const known=[1,2,3].flatMap(version=>Array.from({length:8},(_,bits)=>encodeResult({...base,version,answers:[bits>>2&1,bits>>1&1,bits&1],auto:[0,1,0]})));
 const legacy=known.map(code=>structuredClone(decodeResult(code)));
 for(const code of known){const r=decodeResult(code);assert.equal(encodeResult(r),code);}
 for(let bits=0;bits<8;bits++){const auto=[bits>>2&1,bits>>1&1,bits&1],r=decodeResult(encodeResult({...base,answers:auto,auto,version:4}));assert.equal(r.code.length,18);assert.deepEqual(r.auto,auto);assert.equal(r.seed,base.seed);assert.equal(r.zodiac,null);assert.ok(('fate_resume:'+r.code).length<=64);assert.equal(encodeResult(r),r.code);}
 for(const code of ['f4b101xdeadbeef','f4b10120axdeadbeef','f6b101101xdeadbeef'])assert.equal(decodeResult(code),null);
 known.forEach((code,i)=>assert.deepEqual(decodeResult(code),legacy[i]));
});
test('f4 retains two active hours, age90 and exact paused 90-second deadline with one-way authoritative choices',()=>{
 const d=createLife({...base,version:4}),slot=advanceLife(d,at('2026-10-16T23:59:00'));
 assert.equal(validLife(d).version,4);assert.equal(createLife(base).version,3);assert.equal(slot.available,true);assert.equal(addActive(slot.slots[0],CHOICE_MS),at('2026-10-17T06:00:30'));
 assert.equal(advanceLife(d,at('2026-10-17T05:59:00')).available,false);
 const manual=chooseLife(d,1,at('2026-10-17T06:00:29'),0);assert.deepEqual(manual.draft.sources,['manual']);
 const expired=advanceLife(d,at('2026-10-17T06:00:30'));assert.deepEqual(expired.draft.sources,['auto']);assert.throws(()=>chooseLife(d,1,at('2026-10-17T06:00:30'),0));
 const end=addActive(d.startedAt,LIFE_MS),done=advanceLife(manual.draft,end);assert.equal(lifeAge(d,end),90);assert.equal(decodeResult(done.code).version,4);assert.deepEqual(decodeResult(done.code).auto,[0,1,1]);assert.equal(advanceLife(done.draft,end+86400000).code,done.code);assert.equal(readSoul({entries:[],draft:d}).draft.version,4);
});
test('legacy third-version scenes remain six-per-act preview scenes with fixed pivotal ages',()=>{
 const titles=new Set();for(let n=0;n<256;n++){const byte=n.toString(16).padStart(2,'0'),r={version:3,seed:byte.repeat(4)};const scenes=scenesFor(r);assert.deepEqual(scenes.map(s=>s.age),[18,40,66]);titles.add(scenes[0].title);}
 assert.equal(titles.size,6);
});
test('formal scene selection, share ending and reopen use the same new story with three-life avoidance',()=>{
 const entries=[];
 for(let i=0;i<40;i++){
  const seed=seedForNextLife(i.toString(16).padStart(8,'0'),entries,4),r=decodeResult(encodeResult({...base,seed,version:4,answers:[i%2,0,1],auto:[0,1,0]}));
  const scenes=scenesFor(r);assert.deepEqual(scenes,formalScenes(r));assert.deepEqual(scenes.map(s=>s.age),[18,40,66]);
  for(const old of entries.slice(-3).map(e=>scenesFor(decodeResult(e.code))))scenes.forEach((s,n)=>{assert.notEqual(s.id,old[n].id);assert.notEqual(s.text,old[n].text);});
  const ending=endingForLife(r);assert.equal(r.ending.title,ending.title);assert.equal(r.ending.body,ending.summary);assert.deepEqual(decodeResult(r.code).ending,r.ending);entries.push({code:r.code});
 }
});
