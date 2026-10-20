import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import * as P from '../src/services/player.js';
import * as A from '../src/admin/data.js';
import {behaviorEvent,recordBehavior} from '../src/admin/behavior.js';

const DAY=86400000,NOW=Date.parse('2026-10-20T00:05:00+08:00');
const at=day=>Date.parse(day+'T12:00:00+08:00');
function fixture(t){const env={DB:freshDb()},db=env.DB.sqlite;t.after(()=>db.close());return {env,db};}
async function character(f,id,born=NOW,extra={}){return (await P.createCharacter(f.env,{tgId:String(id),name:'旅人'+id,gender:'f',baseClass:'sword',...extra},born)).char;}
function behavior(f,id,day,event='select'){const time=at(day);f.db.prepare('INSERT INTO rpg_behavior_daily(day,account_tg_id,event,first_at,last_at) VALUES(?,?,?,?,?)').run(day,String(id),event,time,time);}
function ledger(f,type,gold,time=NOW,id=crypto.randomUUID()){f.db.prepare('INSERT INTO rpg_ledger(event_id,tg_id,type,gold_delta,created_at) VALUES(?,?,?,?,?)').run(id,'1',type,gold,time);}
function short(f,id,status,time=NOW){f.db.prepare('INSERT INTO rpg_parties(id,leader_id,kind,status,state_json,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'1','tower',status,JSON.stringify({deadline:NOW-60000,actors:[],rewarded:[],tier:40}),time,time,NOW-1);}
function ring(f,id,status,time=NOW){f.db.prepare('INSERT INTO rpg_star_ring_runs(id,leader_id,status,state_json,created_at,updated_at,expires_at,next_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'1',status,'{"tier":40}',time,time,NOW-1,NOW-1);}
function snapshot(f){return JSON.stringify(f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rpg_%' ORDER BY name").all().map(({name})=>[name,f.db.prepare('SELECT * FROM "'+name+'"').all()]));}

test('behavior recognizes deliberate participation and rejects reads, polling and scheduler traffic',()=>{
 for(const action of ['characters','state','settle','guardian/inventory','party/get','party/list','star-ring/get','star-ring/list','fate/get','equipment','exchange/list','characters/poll','internal/party/sweep','admin/dashboard'])assert.equal(behaviorEvent(action),null,action);
 for(const action of ['ready','get','view','leave','auto','attack'])assert.equal(behaviorEvent('star-ring/action',{action}),null,action);
 assert.equal(behaviorEvent('behavior/visit'),'login');assert.equal(behaviorEvent('star-ring/action',{action:'join-ready'}),'star-ring/join');assert.equal(behaviorEvent('party/action',{action:'create'}),'party/create');
});

test('retry and multiple characters produce one account/day/event participant while first/last timestamps remain ordered',async t=>{
 const f=fixture(t),account='21';await character(f,account,NOW-2*DAY);await character(f,account,NOW-DAY,{charSlot:2,name:'旅人分身'});
 await recordBehavior(f.env,account,'select',{},NOW+3000);await recordBehavior(f.env,account,'select',{},NOW+1000);await recordBehavior(f.env,account,'select',{},NOW+3000);await recordBehavior(f.env,account,'select',{},NOW+5000);
 const row=f.db.prepare('SELECT * FROM rpg_behavior_daily').get();assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_behavior_daily').get().n,1);assert.equal(row.account_tg_id,account);assert.equal(row.first_at,NOW+1000);assert.equal(row.last_at,NOW+5000);
 const out=await A.dashboard(f.env,{days:7},NOW+6000);assert.equal(out.totals.accounts,1);assert.equal(out.totals.characters,2);assert.equal(out.totals.activeToday,1);assert.equal(out.features.find(x=>x.event==='select').users,1);
});

test('Taipei midnight splits activity days and never equates request count with users',async t=>{
 const f=fixture(t);await character(f,'22',NOW-DAY);const midnight=A.dayStart('2026-10-20');await recordBehavior(f.env,'22','select',{},midnight-1);await recordBehavior(f.env,'22','select',{},midnight);await recordBehavior(f.env,'22','daily',{},midnight+1);
 const out=await A.dashboard(f.env,{days:7},NOW);assert.equal(out.today,'2026-10-20');assert.equal(out.trend.at(-2).active,1);assert.equal(out.trend.at(-1).active,1);assert.equal(out.features.find(x=>x.event==='select').users,1);assert.equal(out.trend.at(-1).partial,true);assert.equal(out.trend.at(-2).partial,false);
});

test('analytics recording failure cannot turn a successful game operation into a retry',async()=>{
 await assert.doesNotReject(recordBehavior({DB:{prepare(){throw Error('analytics unavailable');}}},'1','select',{},NOW));
 let called=false;await recordBehavior({DB:{prepare(){called=true;throw Error('must not log poll');}}},'1','state',{},NOW);assert.equal(called,false);
});

test('absence of tracking history is unknown rather than zero retention',async t=>{
 const f=fixture(t);await character(f,'31',at('2026-10-12'));const out=await A.dashboard(f.env,{days:14},NOW);assert.equal(out.trackedSince,null);assert.ok(out.trend.every(x=>x.observed===false));assert.deepEqual(out.retention.map(x=>[x.size,x.d1,x.d7]),[[1,null,null]]);
});

test('D1 and D7 require a completely observed return day and use account cohorts, not character slots',async t=>{
 const f=fixture(t);for(const [id,day]of [['40','2026-10-10'],['41','2026-10-12'],['42','2026-10-17'],['43','2026-10-18'],['44','2026-10-19']])await character(f,id,at(day));
 await character(f,'42',at('2026-10-19'),{charSlot:2,name:'後創分身'});
 behavior(f,'40','2026-10-12');behavior(f,'41','2026-10-13');behavior(f,'41','2026-10-19');behavior(f,'42','2026-10-18');behavior(f,'43','2026-10-19');behavior(f,'44','2026-10-20');
 const out=await A.dashboard(f.env,{days:14},NOW),cohort=day=>out.retention.find(x=>x.day===day);
 assert.equal(cohort('2026-10-10').d1,null);assert.equal(cohort('2026-10-10').d7,null);assert.equal(cohort('2026-10-12').d1,1);assert.equal(cohort('2026-10-12').d7,1);assert.equal(cohort('2026-10-17').size,1);assert.equal(cohort('2026-10-17').d1,1);assert.equal(cohort('2026-10-17').d7,null);assert.equal(cohort('2026-10-18').d1,1);assert.equal(cohort('2026-10-19').size,1);assert.equal(cohort('2026-10-19').d1,null);
 assert.equal(out.totals.newAccounts,5);assert.equal(out.totals.characters,6);
});

test('gold inflow and outflow include all source types and both signs, bounded by the selected Taipei window',async t=>{
 const f=fixture(t);for(let n=1;n<=55;n++){ledger(f,'來源'+n,n);ledger(f,'來源'+n,-2*n);}
 ledger(f,'old',999999,A.dayStart('2026-10-14')-1);ledger(f,'future',999999,NOW+1);
 const out=await A.dashboard(f.env,{days:7},NOW);assert.equal(out.economy.totals.inflow,1540);assert.equal(out.economy.totals.outflow,3080);assert.equal(out.economy.sources.reduce((s,x)=>s+x.entries,0),110);assert.ok(out.economy.sources.every(x=>!['old','future'].includes(x.type)));
});

test('transfer proceeds and administrator grants remain visible in gross totals without masquerading as game inflation',async t=>{
 const f=fixture(t);ledger(f,'交易所成交',2000000);ledger(f,'交易託管',-1000);ledger(f,'管理發獎',1000000);ledger(f,'管理回收',-500);ledger(f,'打寶獎勵',5000);ledger(f,'裝備強化',-2000);
 let out=await A.dashboard(f.env,{days:7},NOW);assert.deepEqual(out.economy.totals,{inflow:3005000,outflow:3500});assert.deepEqual(out.economy.transfer,{inflow:2000000,outflow:1000});assert.deepEqual(out.economy.admin,{inflow:1000000,outflow:500});assert.deepEqual(out.economy.game,{inflow:5000,outflow:2000});assert.ok(!out.insights.some(x=>x.title==='遊戲獎勵產出高於回收'));
 ledger(f,'遠征獎勵',100000);out=await A.dashboard(f.env,{days:7},NOW);assert.ok(out.insights.some(x=>x.title==='遊戲獎勵產出高於回收'));assert.deepEqual(out.economy.game,{inflow:105000,outflow:2000});
});

test('mode completion separates resolved cohorts from live lobbies and combat using actual game statuses',async t=>{
 const f=fixture(t);for(const [i,status]of ['lobby','combat','won','lost','ended'].entries())short(f,'s'+i,status);for(const [i,status]of ['lobby','running','complete','ended'].entries())ring(f,'r'+i,status);short(f,'older','won',NOW-40*DAY);
 const out=await A.dashboard(f.env,{days:7},NOW),shortMode=out.modes.find(x=>x.mode==='short'),ringMode=out.modes.find(x=>x.mode==='ring');
 assert.deepEqual([shortMode.total,shortMode.complete,shortMode.ended,shortMode.running,shortMode.lobby],[5,1,2,1,1]);assert.deepEqual([ringMode.total,ringMode.complete,ringMode.ended,ringMode.running,ringMode.lobby],[4,1,1,1,1]);
});

test('risk means previously observed, absent for three Taipei dates; dashboard and list use existing accounts',async t=>{
 const f=fixture(t);for(const id of ['51','52','53','54'])await character(f,id,at('2026-10-01'));behavior(f,'51','2026-10-17');behavior(f,'52','2026-10-18');behavior(f,'54','2026-10-01');behavior(f,'deleted','2026-10-01');
 const out=await A.dashboard(f.env,{days:7},NOW),list=await A.segment(f.env,{segment:'risk'},NOW);assert.equal(out.segments.risk,2);assert.deepEqual(list.items.map(x=>x.account).sort(),['51','54']);assert.ok(!list.items.some(x=>x.account==='53'));
});

test('engaged segment counts seven distinct recent days, not multiple events or old lifetime use',async t=>{
 const f=fixture(t);for(const id of ['61','62','63'])await character(f,id,at('2026-09-01'));
 for(let n=0;n<7;n++){behavior(f,'61','2026-10-'+String(13+n).padStart(2,'0'));behavior(f,'62','2026-09-'+String(10+n));}for(const event of ['select','daily','create','login','enhance','reroll','fate/start'])behavior(f,'63','2026-10-19',event);
 const list=await A.segment(f.env,{segment:'engaged'},NOW);assert.deepEqual(list.items.map(x=>x.account),['61']);assert.equal(list.items[0].activeDays,7);
});

test('new segment uses earliest character birth and displays current active character without counting alts as newcomers',async t=>{
 const f=fixture(t);await character(f,'70',at('2026-10-01'));const alt=await character(f,'70',at('2026-10-19'),{charSlot:2,name:'資深分身'});await character(f,'71',at('2026-10-14'));const active=await character(f,'71',at('2026-10-19'),{charSlot:2,name:'新人分身'});f.db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(active.tg_id,'71');
 const list=await A.segment(f.env,{segment:'new'},NOW);assert.deepEqual(list.items.map(x=>x.account),['71']);assert.equal(list.items[0].charId,active.tg_id);assert.notEqual(list.items[0].charId,alt.tg_id);
});

test('player search treats wildcards and SQL fragments literally and validates cursor',async t=>{
 const f=fixture(t);await character(f,'80',NOW,{name:'真的_名字'});await character(f,'81',NOW,{name:'真的甲名字'});
 assert.deepEqual((await A.players(f.env,{q:'_'})).items.map(x=>x.id),['80']);assert.equal((await A.players(f.env,{q:'%'})).items.length,0);assert.equal((await A.players(f.env,{q:"' OR 1=1 --"})).items.length,0);await assert.rejects(A.players(f.env,{cursor:"1' OR 1=1"}),e=>e.code==='cursor');
});

test('player and segment keyset pagination returns every account exactly once',async t=>{
 const f=fixture(t);for(let n=100;n<145;n++){await character(f,String(n),NOW-DAY);behavior(f,String(n),'2026-10-17');}
 for(const [loader,args,key]of [[A.players,{},'id'],[A.segment,{segment:'risk'},'account']]){let cursor=null,all=[];do{const page=await loader(f.env,{...args,cursor},NOW);all.push(...page.items.map(x=>x[key]));cursor=page.nextCursor;}while(cursor);assert.equal(all.length,45);assert.equal(new Set(all).size,45);}
});

test('audit keyset cursor preserves all same-millisecond entries and rejects malformed cursors',async t=>{
 const f=fixture(t);for(let n=0;n<85;n++)f.db.prepare('INSERT INTO rpg_admin_audit(id,admin_tg_id,action,details,created_at) VALUES(?,?,?,?,?)').run('audit-'+String(n).padStart(3,'0'),'9','grant','{"reason":"測試"}',NOW);
 let cursor=null,all=[];do{const page=await A.audit(f.env,{cursor});all.push(...page.items);cursor=page.nextCursor;}while(cursor);assert.equal(all.length,85);assert.equal(new Set(all.map(x=>x.id)).size,85);assert.equal(all[0].id,'audit-084');assert.equal(all.at(-1).id,'audit-000');assert.equal(all[0].details.reason,'測試');
 for(const invalid of ['not-a-cursor','null','[]','true','{}','{"at":-1,"id":"x"}','{"at":1,"id":4}'])await assert.rejects(A.audit(f.env,{cursor:invalid}),e=>e.code==='cursor',invalid);
});

test('all admin analytics reads preserve every game row and never settle expired parties, idle income or rewards',async t=>{
 const f=fixture(t);await character(f,'91',NOW-30*DAY);short(f,'expired-lobby','lobby',NOW-DAY);short(f,'due-combat','combat',NOW-DAY);ring(f,'due-ring','running',NOW-DAY);behavior(f,'91','2026-10-17');const before=snapshot(f);
 await A.dashboard(f.env,{days:30},NOW);await A.players(f.env,{});await A.player(f.env,{id:'91'},NOW);await A.segment(f.env,{segment:'risk'},NOW);const live=await A.teams(f.env);await A.audit(f.env,{});A.catalog();assert.equal(live.items.length,3);assert.equal(snapshot(f),before);
});

test('retention insight uses only mature observed cohorts and does not dilute results with today newcomers',async t=>{
 const f=fixture(t);for(let n=200;n<210;n++)await character(f,String(n),at('2026-10-17'));for(let n=210;n<225;n++)await character(f,String(n),NOW-1000);behavior(f,'200','2026-10-17');behavior(f,'200','2026-10-18');behavior(f,'201','2026-10-18');
 const out=await A.dashboard(f.env,{days:7},NOW),insight=out.insights.find(x=>x.title==='新玩家隔日回訪偏低');assert.ok(insight);assert.match(insight.evidence,/10 人/);assert.match(insight.evidence,/2 人（20%）/);assert.equal(out.retention.find(x=>x.day==='2026-10-20').d1,null);
});

test('unfinished teams are excluded from completion insight denominator and low samples produce no diagnosis',async t=>{
 const f=fixture(t);for(let n=0;n<20;n++)short(f,'live-'+n,'combat');for(let n=0;n<4;n++)short(f,'finished-'+n,'won');
 let out=await A.dashboard(f.env,{days:7},NOW);assert.ok(!out.insights.some(x=>x.title.includes('完成率')));
 for(let n=0;n<6;n++)short(f,'lost-'+n,'lost');out=await A.dashboard(f.env,{days:7},NOW);const insight=out.insights.find(x=>x.title.includes('完成率'));assert.ok(insight);assert.match(insight.evidence,/10 組/);assert.match(insight.evidence,/完成 4、中止／失敗 6/);assert.match(insight.action,/不能證明難度過高/);
});

test('player detail reports one account across all character actions while keeping each inventory and ledger separate',async t=>{
 const f=fixture(t),main=await character(f,'92',NOW-DAY),alt=await character(f,'92',NOW-DAY,{charSlot:2,name:'另一旅人'});await recordBehavior(f.env,'92','daily',{},NOW);ledger(f,'僅主角色',99,NOW);f.db.prepare('UPDATE rpg_ledger SET tg_id=? WHERE type=?').run(main.tg_id,'僅主角色');
 const before=snapshot(f),one=await A.player(f.env,{id:main.tg_id},NOW),two=await A.player(f.env,{id:alt.tg_id},NOW);assert.equal(one.character.accountId,two.character.accountId);assert.deepEqual(one.behavior,two.behavior);assert.ok(one.ledger.some(x=>x.type==='僅主角色'));assert.ok(!two.ledger.some(x=>x.type==='僅主角色'));assert.ok(one.inventory.length>0);assert.ok(two.inventory.length>0);assert.equal(snapshot(f),before);
});

test('future account and behavior dates do not contaminate current cohorts, tracked-since or recent segments',async t=>{
 const f=fixture(t);await character(f,'300',at('2026-10-01'));await character(f,'301',NOW+DAY);behavior(f,'300','2026-10-17');behavior(f,'300','2026-10-21');behavior(f,'301','2026-10-21');
 const out=await A.dashboard(f.env,{days:7},NOW);assert.equal(out.trackedSince,'2026-10-17');assert.equal(out.totals.newAccounts,0);assert.equal(out.totals.activeToday,0);assert.ok(!out.retention.some(x=>x.day==='2026-10-21'));assert.deepEqual((await A.segment(f.env,{segment:'risk'},NOW)).items.map(x=>x.account),['300']);assert.equal((await A.segment(f.env,{segment:'new'},NOW)).items.length,0);
});

test('stale or foreign active-character pointers fall back to an owned character without crossing accounts',async t=>{
 const f=fixture(t);await character(f,'310',NOW-DAY);await character(f,'311',NOW-DAY);await character(f,'312',NOW-DAY);f.db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run('311','310');f.db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run('deleted-char','312');
 const list=await A.segment(f.env,{segment:'new'},NOW);assert.equal(list.items.length,3);assert.deepEqual(list.items.map(x=>[x.account,x.charId]),[['310','310'],['311','311'],['312','312']]);
});

test('activity-drop insight requires actual completed observed baseline days, not padded prelaunch zeros',async t=>{
 const f=fixture(t);for(let n=400;n<440;n++){await character(f,String(n),at('2026-10-01'));behavior(f,String(n),'2026-10-18');}
 const out=await A.dashboard(f.env,{days:14},NOW);assert.equal(out.trackedSince,'2026-10-18');assert.equal(out.trend.filter(x=>x.observed&&!x.partial).length,2);assert.ok(!out.insights.some(x=>x.title==='昨日活躍明顯回落'));
 // Add actual older observations: a genuine decline now has enough complete baseline dates.
 for(let day=12;day<18;day++)for(let n=400;n<410;n++)behavior(f,String(n),'2026-10-'+day);
 const established=await A.dashboard(f.env,{days:14},NOW);assert.ok(established.insights.some(x=>x.title==='昨日活躍明顯回落'));
});
