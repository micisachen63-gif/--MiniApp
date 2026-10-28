import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {freshDb,D1Shim} from './d1-shim.js';
import {handle} from '../src/index.js';
import * as P from '../src/services/player.js';
import {CurrentClientRequest} from './client-request.js';
const NOW=Date.parse('2026-10-20T10:00:00+08:00');
const app=(env,action,b={})=>handle(new CurrentClientRequest('https://test.local/app/api/'+action,{method:'POST',headers:{'content-type':'application/json','X-Dev-Tg-Id':'101','X-Debug-Now':String(NOW)},body:JSON.stringify(b)}),env);
function fixture(t){const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};t.after(()=>env.DB.sqlite.close());return env;}
test('real authenticated MiniApp records first successful visit and creation under verified account, ignoring caller identity',async t=>{
 const env=fixture(t);await app(env,'characters',{tgId:'999'});assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_behavior_daily').get().n,0);await app(env,'behavior/visit',{tgId:'999'});const result=await app(env,'create',{name:'真實旅人',baseClass:'sword',gender:'f',tgId:'999'});assert.equal(result.status,200);
 const rows=env.DB.sqlite.prepare('SELECT account_tg_id,event FROM rpg_behavior_daily ORDER BY event').all();assert.equal(rows.length,2);assert.ok(rows.every(x=>x.account_tg_id==='101'));assert.deepEqual(rows.map(x=>x.event),['create','login']);
});
test('polling reads, rejected actions and unverified attempts never count as deliberate gameplay participation',async t=>{
 const env=fixture(t);await P.createCharacter(env,{tgId:'101',name:'真正玩家',baseClass:'sword',gender:'f'},NOW);
 await app(env,'meta');await app(env,'star-ring/list');await app(env,'enhance',{itemId:'missing',requestId:'request0001'});
 await handle(new Request('https://test.local/app/api/characters',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env);
 assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_behavior_daily').get().n,0);
});
test('analytics write outage never turns a committed game action into an error or a duplicate economic action',async t=>{
 const env=fixture(t),prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=sql=>{if(sql.includes('rpg_behavior_daily'))throw Error('unavailable analytics');return prepare(sql);};
 const response=await app(env,'create',{name:'不受影響',baseClass:'mage',gender:'f'});assert.equal(response.status,200);assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_characters WHERE tg_id='101'").get().n,1);
});
test('admin API route is isolated from game debug authentication and the internal service secret',async t=>{
 const env=fixture(t);env.SERVICE_SECRET='internal-service-secret-test';
 const r=await handle(new Request('https://test.local/admin/api/dashboard',{method:'POST',headers:{Origin:'https://test.local','content-type':'application/json','X-Dev-Tg-Id':'101','X-Service-Secret':env.SERVICE_SECRET},body:'{}'}),env);assert.equal(r.status,401);assert.equal((await r.json()).error,'admin_login');
});
test('0033 only adds administration tables and indexes, leaving all existing game rows and active combats byte-for-byte unchanged',async t=>{
 const db=new D1Shim();t.after(()=>db.sqlite.close());const dir=new URL('../migrations/',import.meta.url);
 for(const file of fs.readdirSync(dir).filter(x=>x.endsWith('.sql')&&x<'0033').sort())db.sqlite.exec(fs.readFileSync(new URL(file,dir),'utf8').replaceAll('\r\n','\n'));
 // Current services use the live view; this historical fixture predates retirement fields.
 db.sqlite.exec('CREATE VIEW rpg_live_characters AS SELECT * FROM rpg_characters');
 await P.createCharacter({DB:db},{tgId:'101',name:'保留玩家',baseClass:'thief',gender:'f'},NOW);
 db.sqlite.prepare("UPDATE rpg_characters SET level=80,party_id='ring:original',special_json=? WHERE tg_id='101'").run('{"loadout":["skill01"],"auto":{"on":true}}');
 db.sqlite.prepare("INSERT INTO rpg_star_ring_runs(id,leader_id,status,state_json,created_at,updated_at,expires_at,next_at) VALUES('ring:original','101','running',?,?,?,?,?)").run('{"actors":[{"atk":500}],"rewards":["pending"]}',NOW,NOW,NOW+43200000,NOW+1000);
 const names=db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rpg_%' ORDER BY name").all().map(x=>x.name),before=names.map(name=>[name,db.sqlite.prepare('SELECT * FROM "'+name+'"').all()]);
 db.sqlite.exec(fs.readFileSync(new URL('0033_admin_console.sql',dir),'utf8').replaceAll('\r\n','\n'));
 assert.deepEqual(names.map(name=>[name,db.sqlite.prepare('SELECT * FROM "'+name+'"').all()]),before);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('rpg_admin_sessions','rpg_admin_login_approvals','rpg_admin_grants','rpg_behavior_daily')").get().n,4);
});
test('admin root link and narrow browser pairing parameter preserve Telegram authentication hash and do not reinterpret ordinary game deep links',()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.ok(source.includes("spx==='admin'||/^admin_[0-9a-f]{64}$/.test(spx)"));assert.ok(source.includes("spx.slice(6))+location.hash"));
 const admin=/^admin_[0-9a-f]{64}$/;for(const value of ['ring_'+'1'.repeat(32),'bag','trade_t123','admin_../','admin_'+'x'.repeat(64)])assert.equal(admin.test(value),false);assert.equal(admin.test('admin_'+'a'.repeat(64)),true);
});
