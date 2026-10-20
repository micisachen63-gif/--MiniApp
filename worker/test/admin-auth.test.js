import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {freshDb} from './d1-shim.js';
import * as A from '../src/admin/auth.js';
import {handleAdmin} from '../src/admin/index.js';

const NOW=Date.parse('2026-10-20T10:00:00+08:00');
const TOKEN='123456789:FAKE_ADMIN_AUTH_TEST_TOKEN';
const BASE='https://admin.test';
function signed(id='101',date=NOW/1000,extra={}) {
 const fields={auth_date:String(date),user:JSON.stringify({id:Number(id),first_name:'管理者'}),...extra};
 const key=createHmac('sha256','WebAppData').update(TOKEN).digest();
 const text=Object.keys(fields).sort().map(k=>`${k}=${fields[k]}`).join('\n');
 return new URLSearchParams({...fields,hash:createHmac('sha256',key).update(text).digest('hex')}).toString();
}
const request=(headers={},path='/admin/api/session')=>new Request(BASE+path,{headers});
const code=expected=>e=>e?.code===expected;
function fixture(t){
 const env={BOT_TOKEN:TOKEN,GROUP_CHAT_ID:'-100900000001',DB:freshDb(),ENVIRONMENT:'production'};
 t.after(()=>env.DB.sqlite.close());
 let role='administrator',replyId='101',bot=false,failure=null,calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls++;assert.equal(url,`https://api.telegram.org/bot${TOKEN}/getChatMember`);
  assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{chat_id:env.GROUP_CHAT_ID,user_id:'101'});
  if(failure==='network')throw Error('network disconnected');
  if(failure==='json')return new Response('not json',{status:502});
  if(failure==='api')return Response.json({ok:false,error_code:400},{status:400});
  return Response.json({ok:true,result:{status:role,user:{id:Number(replyId),first_name:'管理者',is_bot:bot}}});
 });
 return {env,get calls(){return calls;},set role(v){role=v;},set replyId(v){replyId=v;},set bot(v){bot=v;},set failure(v){failure=v;},
  one:(sql,...args)=>env.DB.sqlite.prepare(sql).get(...args),run:(sql,...args)=>env.DB.sqlite.prepare(sql).run(...args)};
}
async function login(f){const admin=await A.telegramAdmin(request({'X-Telegram-Init-Data':signed()}),f.env,NOW);return A.newSession(f.env,admin,NOW);}
const cookieToken=result=>result.cookie.split(';')[0];

test('administration accepts authentic fresh Telegram identity and independently verifies the configured group role',async t=>{
 const f=fixture(t),admin=await A.telegramAdmin(request({'X-Telegram-Init-Data':signed()}),f.env,NOW);
 assert.deepEqual(admin,{id:'101',role:'administrator',name:'管理者'});assert.equal(f.calls,1);
 f.role='creator';assert.equal((await A.telegramAdmin(request({'X-Telegram-Init-Data':signed()}),f.env,NOW)).role,'creator');
});
test('production administration rejects game debug identity and service credentials without Telegram HMAC',async t=>{
 const f=fixture(t);Object.assign(f.env,{ALLOW_DEV_AUTH:'true',SERVICE_SECRET:'fake-service-secret'});
 for(const headers of [{'X-Dev-Tg-Id':'101'},{'X-Service-Secret':'fake-service-secret'},{'X-Telegram-Init-Data':'user=101&hash=invalid'}])
  await assert.rejects(A.telegramAdmin(request(headers),f.env,NOW),code('admin_login'));
 assert.equal(f.calls,0);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions').n,0);
});
test('signed identity tampering, stale, future and malformed dates fail before Telegram role fetch',async t=>{
 const f=fixture(t);
 for(const init of [signed().replace('101','102'),signed('101',NOW/1000-301),signed('101',NOW/1000+301),signed('101','NaN'),signed('101',0),'x'.repeat(16001)])
  await assert.rejects(A.telegramAdmin(request({'X-Telegram-Init-Data':init}),f.env,NOW),code('admin_login'));
 assert.equal(f.calls,0);
});
test('ordinary member, kicked, left and bot identities cannot become console administrators',async t=>{
 const f=fixture(t);
 for(const role of ['member','restricted','left','kicked']){f.role=role;await assert.rejects(A.adminRole(f.env,'101'),code('admin_denied'));}
 f.role='administrator';f.bot=true;await assert.rejects(A.adminRole(f.env,'101'),code('admin_denied'));
 f.bot=false;f.replyId='102';await assert.rejects(A.adminRole(f.env,'101'),code('admin_denied'));
});
test('optional admin allowlist narrows group administrator access and does not replace real Telegram verification',async t=>{
 const f=fixture(t);f.env.ADMIN_TG_IDS='102, 103';await assert.rejects(A.adminRole(f.env,'101'),code('admin_denied'));assert.equal(f.calls,0);
 f.env.ADMIN_TG_IDS=' 101,102 ';f.role='member';await assert.rejects(A.adminRole(f.env,'101'),code('admin_denied'));assert.equal(f.calls,1);
 f.role='administrator';assert.equal((await A.adminRole(f.env,'101')).id,'101');
});
test('missing configuration, invalid account IDs and Telegram transport/API failures fail closed without exposing token',async t=>{
 const f=fixture(t);
 for(const id of ['','-101','101x','1'.repeat(21)])await assert.rejects(A.adminRole(f.env,id),code('admin_denied'));
 for(const key of ['BOT_TOKEN','GROUP_CHAT_ID']){const old=f.env[key];delete f.env[key];await assert.rejects(A.adminRole(f.env,'101'),code('admin_unavailable'));f.env[key]=old;}
 for(const failure of ['network','api','json']){f.failure=failure;await assert.rejects(A.adminRole(f.env,'101'),e=>e.code==='admin_unavailable'&&!e.message.includes(TOKEN));}
});
test('new session is random, stored only as SHA256 and returns a path-limited secure HttpOnly cookie',async t=>{
 const f=fixture(t),a=await login(f),b=await login(f),token=cookieToken(a).split('=')[1];
 assert.match(token,/^[0-9a-f]{64}$/);assert.notEqual(a.cookie,b.cookie);
 for(const flag of ['Path=/admin/','HttpOnly','Secure','SameSite=Strict','Max-Age=3600'])assert.ok(a.cookie.includes(flag));
 assert.equal(a.admin.expiresAt,NOW+3600_000);assert.match(a.admin.csrf,/^[0-9a-f]{64}$/);
 const row=f.one('SELECT * FROM rpg_admin_sessions WHERE token_hash=?',await A.digest(token));
 assert.equal(row.admin_tg_id,'101');assert.equal(row.revoked_at,null);assert.notEqual(row.token_hash,token);
 const audit=f.one('SELECT * FROM rpg_admin_audit WHERE id=?','console:login:'+row.token_hash);
 assert.equal(audit.admin_tg_id,'101');assert.equal(audit.action,'後台登入');assert.ok(!JSON.stringify(audit).includes(token));
});
test('every authenticated read rechecks live Telegram role; revocation and Telegram outage invalidate existing sessions',async t=>{
 const f=fixture(t),a=await login(f),req=request({Cookie:cookieToken(a)});
 assert.equal((await A.session(req,f.env,NOW+1)).id,'101');assert.equal(f.calls,2);
 f.role='member';await assert.rejects(A.session(req,f.env,NOW+2),code('admin_denied'));assert.equal(f.calls,3);
 f.role='administrator';f.failure='network';await assert.rejects(A.session(req,f.env,NOW+3),code('admin_unavailable'));
 f.failure=null;f.env.ADMIN_TG_IDS='202';await assert.rejects(A.session(req,f.env,NOW+4),code('admin_denied'));
});
test('missing, invented, malformed and expired cookies cannot authenticate or query group membership',async t=>{
 const f=fixture(t),a=await login(f),before=f.calls;
 for(const header of ['', '__Secure-rpg_admin=garbage','__Secure-rpg_admin='+ 'a'.repeat(64),'__Secure-rpg_admin='+ 'A'.repeat(64)])
  await assert.rejects(A.session(request({Cookie:header}),f.env,NOW),code('admin_login'));
 await assert.rejects(A.session(request({Cookie:cookieToken(a)}),f.env,NOW+3600_000),code('admin_login'));
 assert.equal(f.calls,before);
});
test('revoked sessions remain unusable and a logout cookie removes only the same admin cookie path',async t=>{
 const f=fixture(t),a=await login(f),token=cookieToken(a).split('=')[1];
 f.run('UPDATE rpg_admin_sessions SET revoked_at=? WHERE token_hash=?',NOW+1,await A.digest(token));
 await assert.rejects(A.session(request({Cookie:cookieToken(a)}),f.env,NOW+2),code('admin_login'));
 assert.match(A.cookie('',0),/^__Secure-rpg_admin=; Path=\/admin\/; HttpOnly; Secure; SameSite=Strict; Max-Age=0$/);
});
test('write CSRF token is session-specific and rejects missing, incorrect or another session token',async t=>{
 const f=fixture(t),a=await login(f),b=await login(f);
 for(const csrf of ['', '0'.repeat(64),b.admin.csrf])
  await assert.rejects(A.session(request({Cookie:cookieToken(a),'X-Admin-CSRF':csrf}),f.env,NOW+1,{csrf:true}),code('admin_csrf'));
 const valid=await A.session(request({Cookie:'other=ok; '+cookieToken(a),'X-Admin-CSRF':a.admin.csrf}),f.env,NOW+2,{csrf:true});
 assert.equal(valid.id,'101');assert.equal(valid.csrf,a.admin.csrf);
});
test('admin writes require exact same HTTPS origin and JSON content type',()=>{
 for(const origin of ['', 'null','https://evil.test','http://admin.test','https://admin.test.evil.test'])
  assert.throws(()=>A.sameOrigin(request({Origin:origin,'Content-Type':'application/json'})),code('admin_origin'));
 for(const type of ['', 'text/plain','application/x-www-form-urlencoded'])
  assert.throws(()=>A.sameOrigin(request({Origin:BASE,'Content-Type':type})),code('admin_content'));
 A.sameOrigin(request({Origin:BASE,'Content-Type':'application/json; charset=utf-8'}));
});
test('a failed atomic session/audit transaction does not leave an authenticatable partial session',async t=>{
 const f=fixture(t),admin=await A.adminRole(f.env,'101');
 await assert.rejects(A.newSession(f.env,admin,NOW,[f.env.DB.prepare('INSERT INTO no_such_admin_table VALUES(1)')]));
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions').n,0);assert.equal(f.one("SELECT COUNT(*) n FROM rpg_admin_audit WHERE action='後台登入'").n,0);
});

async function api(f,action,body={},headers={},now=NOW){
 const response=await handleAdmin(new Request(BASE+'/admin/api/'+action,{method:'POST',headers:{Origin:BASE,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),f.env,now);
 return {response,status:response.status,body:await response.json()};
}
const tgHeaders=()=>({'X-Telegram-Init-Data':signed()});
async function approve(f,verifier=A.randomToken(),now=NOW){
 const challenge=await A.digest(verifier),r=await api(f,'login/approve',{challenge},tgHeaders(),now);
 assert.equal(r.status,200,JSON.stringify(r.body));return {verifier,challenge};
}
test('HTTP admin login and session reads expose no-store privacy headers and never return a raw session credential',async t=>{
 const f=fixture(t),r=await api(f,'login/tg',{},tgHeaders());
 assert.equal(r.status,200);const raw=r.response.headers.get('set-cookie').split(';')[0],token=raw.split('=')[1];
 for(const [key,value]of [['cache-control','no-store'],['referrer-policy','no-referrer'],['x-content-type-options','nosniff'],['x-frame-options','DENY']])assert.equal(r.response.headers.get(key),value);
 assert.ok(!JSON.stringify(r.body).includes(token));
 const read=await handleAdmin(request({Cookie:raw}),f.env,NOW+1);assert.equal(read.status,200);const sessionBody=await read.json();assert.equal(sessionBody.admin.id,'101');
 assert.deepEqual(Object.keys(sessionBody.admin).sort(),['id','name','role','csrf','expiresAt'].sort());
 const unsigned=await api(f,'dashboard',{},{});assert.equal(unsigned.status,401);assert.equal(unsigned.body.error,'admin_login');
});
test('HTTP writes cannot bypass same-origin, CSRF or JSON/body bounds even with a valid admin session',async t=>{
 const f=fixture(t),r=await api(f,'login/tg',{},tgHeaders()),headers={Cookie:r.response.headers.get('set-cookie').split(';')[0]};
 const noCsrf=await api(f,'logout',{},headers);assert.equal(noCsrf.status,403);assert.equal(noCsrf.body.error,'admin_csrf');
 const cross=await api(f,'logout',{}, {...headers,'X-Admin-CSRF':r.body.admin.csrf,Origin:'https://evil.test'});assert.equal(cross.status,403);assert.equal(cross.body.error,'admin_origin');
 const text=await api(f,'login/tg',{}, {...tgHeaders(),'Content-Type':'text/plain'});assert.equal(text.status,415);
 const large=await api(f,'login/tg',{pad:'x'.repeat(20001)},tgHeaders());assert.equal(large.status,413);
 for(const payload of ['{broken','null','[]']){
  const invalid=await handleAdmin(new Request(BASE+'/admin/api/login/tg',{method:'POST',headers:{Origin:BASE,'Content-Type':'application/json',...tgHeaders()},body:payload}),f.env,NOW);
  assert.equal(invalid.status,400);
 }
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions WHERE revoked_at IS NOT NULL').n,0);
});
test('unauthenticated pending browser redemption cannot insert approvals, sessions or audit records',async t=>{
 const f=fixture(t),verifier=A.randomToken();
 const r=await api(f,'login/redeem',{verifier});assert.equal(r.status,202);assert.deepEqual(r.body,{ok:true,pending:true});
 for(const table of ['rpg_admin_login_approvals','rpg_admin_sessions','rpg_admin_audit'])assert.equal(f.one('SELECT COUNT(*) n FROM '+table).n,0);
 assert.equal(f.calls,0);
 for(const invalid of ['', 'x'.repeat(64),'a'.repeat(63),'A'.repeat(64)]){const bad=await api(f,'login/redeem',{verifier:invalid});assert.equal(bad.status,400);}
});
test('browser approval requires fresh authentic admin and challenge alone never redeems its session',async t=>{
 const f=fixture(t),verifier=A.randomToken(),challenge=await A.digest(verifier);
 let r=await api(f,'login/approve',{challenge},{'X-Dev-Tg-Id':'101'});assert.equal(r.status,401);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_login_approvals').n,0);
 f.role='member';r=await api(f,'login/approve',{challenge},tgHeaders());assert.equal(r.status,403);
 f.role='administrator';await approve(f,verifier);
 r=await api(f,'login/redeem',{verifier:challenge});assert.equal(r.status,202);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions').n,0);
 r=await api(f,'login/redeem',{verifier});assert.equal(r.status,200);assert.ok(r.response.headers.get('set-cookie'));
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions').n,1);
 assert.equal(f.one('SELECT used_at FROM rpg_admin_login_approvals WHERE challenge=?',challenge).used_at,NOW);
 r=await api(f,'login/redeem',{verifier});assert.equal(r.status,401);assert.equal(r.body.error,'challenge');
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions').n,1);
});
test('replayed browser approval cannot refresh expiry, change approver or reactivate a consumed challenge',async t=>{
 const f=fixture(t),{verifier,challenge}=await approve(f),before=f.one('SELECT * FROM rpg_admin_login_approvals WHERE challenge=?',challenge);
 assert.equal((await api(f,'login/approve',{challenge},tgHeaders(),NOW+10000)).status,200);
 assert.deepEqual(f.one('SELECT * FROM rpg_admin_login_approvals WHERE challenge=?',challenge),before);
 assert.equal((await api(f,'login/redeem',{verifier},{},NOW+300000)).status,401);
 assert.equal((await api(f,'login/approve',{challenge},tgHeaders(),NOW+300000)).status,409);
 const live=await approve(f);assert.equal((await api(f,'login/redeem',{verifier:live.verifier})).status,200);
 assert.equal((await api(f,'login/approve',{challenge:live.challenge},tgHeaders(),NOW+1)).status,409);
});
test('browser redemption revalidates group admin after approval and preserves unconsumed challenge when Telegram is unavailable',async t=>{
 const f=fixture(t),{verifier,challenge}=await approve(f);
 f.role='member';let r=await api(f,'login/redeem',{verifier});assert.equal(r.status,403);
 assert.equal(f.one('SELECT used_at FROM rpg_admin_login_approvals WHERE challenge=?',challenge).used_at,null);
 f.role='administrator';f.failure='network';r=await api(f,'login/redeem',{verifier});assert.equal(r.status,503);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions').n,0);
 f.failure=null;r=await api(f,'login/redeem',{verifier});assert.equal(r.status,200);
});
test('two overlapping browser redeems consume one approval and atomically create exactly one session and login audit',async t=>{
 const f=fixture(t),{verifier}=await approve(f),batch=f.env.DB.batch.bind(f.env.DB);let arrivals=0,release;
 const barrier=new Promise(resolve=>release=resolve);
 f.env.DB.batch=async stmts=>{if(stmts.some(s=>s.sql.startsWith('UPDATE rpg_admin_login_approvals'))){if(++arrivals===2)release();await barrier;}return batch(stmts);};
 // Suppress the intentionally generic internal-error log for the losing SQL guard.
 t.mock.method(console,'error',()=>{});
 const r=await Promise.all([api(f,'login/redeem',{verifier}),api(f,'login/redeem',{verifier})]);
 assert.equal(arrivals,2);assert.equal(r.filter(x=>x.status===200).length,1);
 assert.ok(r.every(x=>x.status===200||x.status===503||x.status===401));
 assert.equal(r.filter(x=>x.response.headers.has('set-cookie')).length,1);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions').n,1);
 assert.equal(f.one("SELECT COUNT(*) n FROM rpg_admin_audit WHERE action='後台登入'").n,1);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_login_approvals WHERE used_at IS NOT NULL').n,1);
});
test('HTTP logout revokes current session, leaves another valid session intact and clears the browser cookie',async t=>{
 const f=fixture(t),a=await api(f,'login/tg',{},tgHeaders()),b=await api(f,'login/tg',{},tgHeaders());
 const current=a.response.headers.get('set-cookie').split(';')[0],other=b.response.headers.get('set-cookie').split(';')[0];
 const r=await api(f,'logout',{}, {Cookie:current,'X-Admin-CSRF':a.body.admin.csrf},NOW+1);
 assert.equal(r.status,200);assert.equal(r.response.headers.get('set-cookie'),A.cookie('',0));
 const read=await handleAdmin(request({Cookie:current}),f.env,NOW+2);assert.equal(read.status,401);
 const second=await handleAdmin(request({Cookie:other}),f.env,NOW+2);assert.equal(second.status,200);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions WHERE revoked_at IS NOT NULL').n,1);
});
test('Telegram login ignores an attacker-supplied session cookie and browser challenges cannot fix its new session token',async t=>{
 const f=fixture(t),fixed='b'.repeat(64),r=await api(f,'login/tg',{}, {...tgHeaders(),Cookie:'__Secure-rpg_admin='+fixed});
 assert.equal(r.status,200);assert.ok(!r.response.headers.get('set-cookie').includes(fixed));
 assert.equal(f.one('SELECT token_hash FROM rpg_admin_sessions WHERE token_hash=?',await A.digest(fixed)),undefined);
 const {verifier,challenge}=await approve(f),browser=await api(f,'login/redeem',{verifier},{Cookie:'__Secure-rpg_admin='+fixed});
 assert.equal(browser.status,200);
 const next=browser.response.headers.get('set-cookie').split(';')[0].split('=')[1];
 assert.notEqual(next,fixed);assert.notEqual(next,verifier);assert.notEqual(next,challenge);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions').n,2);
});
test('an expired or consumed browser code never writes a new session even with a still-valid Telegram identity header',async t=>{
 const f=fixture(t),expired=await approve(f);
 assert.equal((await api(f,'login/redeem',{verifier:expired.verifier},tgHeaders(),NOW+300001)).status,401);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions').n,0);
 const used=await approve(f);assert.equal((await api(f,'login/redeem',{verifier:used.verifier})).status,200);
 assert.equal((await api(f,'login/redeem',{verifier:used.verifier},tgHeaders(),NOW+1)).status,401);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions').n,1);
});
test('chunked UTF8 requests are bounded by bytes without relying on a trustworthy Content-Length header',async t=>{
 const f=fixture(t),encoded=new TextEncoder().encode(JSON.stringify({reason:'繁'.repeat(7500)}));let canceled=false;
 const body=new ReadableStream({start(c){c.enqueue(encoded.subarray(0,10000));c.enqueue(encoded.subarray(10000));},cancel(){canceled=true;}});
 const r=await handleAdmin(new Request(BASE+'/admin/api/login/tg',{method:'POST',duplex:'half',headers:{Origin:BASE,'Content-Type':'application/json',...tgHeaders()},body}),f.env,NOW);
 assert.equal(r.status,413);assert.equal((await r.json()).error,'too_large');assert.equal(canceled,true);
 assert.equal(f.calls,0);assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_sessions').n,0);
});
test('all analytics, player and reward HTTP operations require a live admin session and session-specific CSRF',async t=>{
 const f=fixture(t),actions=['dashboard','players','player','segments','teams','audit','catalog','grant/preview','grant/commit','grant/status','logout'];
 for(const action of actions){const r=await api(f,action,{});assert.equal(r.status,401,action);assert.equal(r.body.error,'admin_login',action);}
 const login=await api(f,'login/tg',{},tgHeaders()),Cookie=login.response.headers.get('set-cookie').split(';')[0];
 for(const action of actions){const r=await api(f,action,{}, {Cookie});assert.equal(r.status,403,action);assert.equal(r.body.error,'admin_csrf',action);}
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_grants').n,0);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_ledger').n,0);
});
test('revoked live group administrator cannot preview, commit or inspect rewards using a previously valid browser session',async t=>{
 const f=fixture(t),login=await api(f,'login/tg',{},tgHeaders());
 const headers={Cookie:login.response.headers.get('set-cookie').split(';')[0],'X-Admin-CSRF':login.body.admin.csrf};
 f.role='member';
 for(const action of ['grant/preview','grant/commit','grant/status','catalog','players']){
  const r=await api(f,action,{requestId:crypto.randomUUID(),charIds:['101'],gold:1000000,reason:'未授權測試'},headers,NOW+1);
  assert.equal(r.status,403,action);assert.equal(r.body.error,'admin_denied',action);
 }
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_admin_grants').n,0);
 assert.equal(f.one('SELECT COUNT(*) n FROM rpg_ledger').n,0);
});
