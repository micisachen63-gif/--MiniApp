import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {freshDb} from './d1-shim.js';
import {CurrentClientRequest} from './client-request.js';
import {createCharacter} from '../src/services/player.js';
import {handle} from '../src/index.js';
import * as FATE from '../src/services/fate.js';
import {peers,snapshot,PEER_AGGREGATE_SQL} from '../src/services/fate-peer.js';
import {createLife,advanceLife,LIFE_MS,validLife} from '../public/fate/life.js';
import {readFileSync} from 'node:fs';
const TOKEN='123456789:FAKE_PEER_TEST_ONLY',SECRET='peer-test-service-secret',T=Date.parse('2026-10-16T08:00:00+08:00');
const rid=()=>crypto.randomUUID().replaceAll('-','');
function signed(id){const fields={auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:Number(id),first_name:'同期測試'})},secret=createHmac('sha256','WebAppData').update(TOKEN).digest();return new URLSearchParams({...fields,hash:createHmac('sha256',secret).update(Object.keys(fields).sort().map(key=>key+'='+fields[key]).join('\n')).digest('hex')}).toString();}
async function fixture(t){
 const env={DB:freshDb(),BOT_TOKEN:TOKEN,SERVICE_SECRET:SECRET,ENVIRONMENT:'development',ALLOW_DEBUG_TIME:'true'},db=env.DB.sqlite;t.after(()=>db.close());
 const characters={};for(const account of ['101','202','303','404']){characters[account]=(await createCharacter(env,{tgId:account,name:'同期'+account,baseClass:'sword',gender:'m'},T)).char.tg_id;}
 const sibling=(await createCharacter(env,{tgId:'202',name:'同期分身',baseClass:'mage',gender:'f'},T)).char.tg_id;
 function add(account,{completedAt=T,wealth=100,bonds=50,char=characters[account],version=6,status='complete',summary=true,id=rid()}={}){
  const draft={version,seed:'deadbeef',...(summary?{resultMetrics:{version:1,wealthTwd:wealth,bonds,health:50,educationIndex:3,children:1}}:{})};
  db.prepare('INSERT INTO rpg_fate_lives(id,char_id,account_id,state_json,status,started_at,completed_at,next_at) VALUES(?,?,?,?,?,?,?,?)').run(id,char,account,JSON.stringify(draft),status,completedAt-LIFE_MS,status==='complete'?completedAt:null,completedAt);return id;
 }
 const api=async(body,account='101',headers={})=>{const response=await handle(new CurrentClientRequest('https://game.test/app/api/fate/peers',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Init-Data':signed(account),'X-Debug-Now':String(T+86400000),...headers},body:JSON.stringify(body)}),env);return {status:response.status,...await response.json()};};
 return {env,db,characters,sibling,add,api};
}

test('completion generates the v6 summary on the server and ignores forged start/body metrics',async t=>{
 const f=await fixture(t),forged={version:1,wealthTwd:999999999999999,bonds:100,health:100,children:999,educationIndex:4};
 const started=await FATE.start(f.env,f.characters['101'],{requestId:rid(),mode:'random',resultMetrics:forged},T);
 const before=JSON.parse(f.db.prepare('SELECT state_json FROM rpg_fate_lives WHERE id=?').get(started.result.lifeId).state_json);assert.equal(before.version,6);assert.equal(before.resultMetrics,undefined);
 assert.equal(validLife({...before,resultMetrics:forged}).resultMetrics,undefined);
 await FATE.state(f.env,f.characters['101'],T+LIFE_MS);
 const done=JSON.parse(f.db.prepare('SELECT state_json FROM rpg_fate_lives WHERE id=?').get(started.result.lifeId).state_json);
 assert.deepEqual(done.resultMetrics,snapshot(done));assert.notEqual(done.resultMetrics.wealthTwd,forged.wealthTwd);assert.ok(done.resultMetrics.children<=8);
 const result=await f.api({lifeId:started.result.lifeId,resultMetrics:forged,wealthTwd:forged.wealthTwd});assert.equal(result.ok,true);assert.equal(result.comparison.wealth.value,done.resultMetrics.wealthTwd);
 const old=createLife({version:5,orbit:3,seed:'deadbeef',startedAt:T});assert.equal(snapshot(advanceLife(old,T+LIFE_MS).draft),null);
 assert.throws(()=>snapshot(before),/completed life/);
});

test('cohort uses latest life per other account while requested life overrides newer own lives',async t=>{
 const f=await fixture(t),own=f.add('101',{wealth:100,bonds:50});f.add('101',{completedAt:T+1,wealth:9000,bonds:100});
 f.add('202',{wealth:9999,bonds:99});f.add('202',{completedAt:T+2,wealth:200,bonds:75,char:f.sibling});f.add('303',{wealth:300,bonds:25});
 const result=await f.api({lifeId:own});assert.equal(result.status,200);assert.equal(result.available,true);assert.equal(result.sampleCount,3);assert.equal(result.date,'2026-10-16');
 assert.deepEqual(result.comparison,{wealth:{rank:3,average:200,value:100},bonds:{rank:2,average:50,value:50}});
 assert.deepEqual(Object.keys(result).sort(),['available','comparison','date','label','ok','sampleCount','status']);
 assert.doesNotMatch(JSON.stringify(result),/account|tgId|charId|同期101|同期202|seed|birth|story|lifeId/);
});

test('Taipei completion date excludes adjacent days, old versions, incomplete lives, and missing server snapshots',async t=>{
 const f=await fixture(t),own=f.add('101');f.add('202',{wealth:200});f.add('303',{wealth:300});
 const midnight=Date.parse('2026-10-16T00:00:00+08:00');
 f.add('404',{completedAt:midnight-1,wealth:999999});f.add('404',{completedAt:midnight+86400000,wealth:999999});f.add('404',{version:5,wealth:999999});f.add('404',{summary:false});f.add('404',{status:'active',wealth:999999});
 const result=await peers(f.env,f.characters['101'],{lifeId:own},T+86400000);assert.equal(result.sampleCount,3);assert.equal(result.comparison.wealth.average,200);
});

test('ties receive competition rank and stable latest-life tie breaking',async t=>{
 const f=await fixture(t),own=f.add('101',{wealth:200,bonds:50});
 f.add('202',{wealth:900,bonds:99,id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'});f.add('202',{wealth:200,bonds:50,id:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',char:f.sibling});f.add('303',{wealth:100,bonds:75});
 const result=await peers(f.env,f.characters['101'],{lifeId:own},T+1);assert.equal(result.sampleCount,3);assert.equal(result.comparison.wealth.rank,1);assert.equal(result.comparison.bonds.rank,2);assert.equal(result.comparison.wealth.average,500/3);
});

test('fewer than three distinct accounts never manufacture rankings or cohort averages',async t=>{
 const f=await fixture(t),own=f.add('101');f.add('202',{wealth:200});f.add('202',{wealth:999,char:f.sibling});
 const result=await f.api({lifeId:own});assert.equal(result.available,false);assert.equal(result.sampleCount,2);assert.match(result.reason,/樣本尚不足/);assert.deepEqual(result.comparison.wealth,{rank:null,average:null,value:100});assert.equal(result.comparison.bonds.rank,null);
});

test('real Telegram HMAC gates the endpoint, pins character ownership, and rejects service requests without secret',async t=>{
 const f=await fixture(t),own=f.add('101'),other=f.add('202');
 const noAuth=await f.api({lifeId:own},'101',{'X-Telegram-Init-Data':''});assert.equal(noAuth.status,401);
 assert.equal((await f.api({lifeId:own},'101',{'X-Telegram-Init-Data':'user=%7B%22id%22%3A101%7D&auth_date=123&hash=forged'})).status,401);
 assert.equal((await f.api({lifeId:other,tgId:f.characters['202'],accountId:'202'})).status,404);
 assert.equal((await f.api({lifeId:own,selectedCharacterId:f.characters['202']})).status,409);
 assert.equal((await f.api({lifeId:own},'202')).status,404);
 const response=await handle(new Request('https://game.test/rpg/fate/peers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tgId:'101',lifeId:own})}),f.env);assert.equal(response.status,401);
});

test('manual comparison is read-only and leaves new or completed lives untouched',async t=>{
 const f=await fixture(t),own=f.add('101');f.add('202');f.add('303');
 const active=createLife({version:6,orbit:3,seed:'deadbeef',startedAt:T}),activeId=rid();f.db.prepare("INSERT INTO rpg_fate_lives(id,char_id,account_id,state_json,status,started_at,next_at) VALUES(?,?,?,?,'active',?,?)").run(activeId,f.characters['404'],'404',JSON.stringify(active),T,T+1000);
 const before=f.db.prepare('SELECT * FROM rpg_fate_lives ORDER BY id').all();await f.api({lifeId:own});assert.deepEqual(f.db.prepare('SELECT * FROM rpg_fate_lives ORDER BY id').all(),before);
 assert.equal((await f.api({lifeId:activeId},'404')).status,404);
 const source=readFileSync(new URL('../public/fate/app.js',import.meta.url),'utf8');assert.doesNotMatch(source.slice(source.indexOf('async function syncCloud'),source.indexOf('function cloudDisplayLife')),/fate\/peers/);
});

test('daily aggregate uses the additive partial completion index',async t=>{
 const f=await fixture(t),plan=f.db.prepare('EXPLAIN QUERY PLAN '+PEER_AGGREGATE_SQL).all(T,T+86400000,T+86400000,'101',1,1,1,1);
 assert.match(JSON.stringify(plan),/rpg_fate_v6_peer_completion/);
 assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='rpg_fate_v6_peer_completion'").get());
});
