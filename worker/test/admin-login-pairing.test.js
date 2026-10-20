import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {handle} from '../src/index.js';
import {handleAdmin} from '../src/admin/index.js';
import {digest} from '../src/admin/auth.js';
import {encodeAdminChallenge,decodeAdminChallenge,adminLoginCommand,adminLoginLink} from '../public/admin/pairing.js';
const NOW=Date.now(),BASE='https://game.test';
function fixture(t){const env={DB:freshDb(),BOT_TOKEN:'test-pairing-bot-token',SERVICE_SECRET:'test-pairing-service-secret',GROUP_CHAT_ID:'-100123',ENVIRONMENT:'production'};t.after(()=>env.DB.sqlite.close());let role='administrator';t.mock.method(globalThis,'fetch',async(url,opts)=>{assert.equal(url,`https://api.telegram.org/bot${env.BOT_TOKEN}/getChatMember`);const args=JSON.parse(opts.body);return Response.json({ok:true,result:{status:role,user:{id:Number(args.user_id),is_bot:false,first_name:'管理者'}}});});return {env,db:env.DB.sqlite,setRole:r=>role=r};}
const internal=(f,b,secret=f.env.SERVICE_SECRET)=>handle(new Request(BASE+'/rpg/admin/login/approve',{method:'POST',headers:{'content-type':'application/json','X-Service-Secret':secret},body:JSON.stringify(b)}),f.env);
test('public challenge codec retains all256bits and produces Telegram start/callback payloads under64bytes',()=>{
 for(let i=0;i<256;i++){const bytes=crypto.getRandomValues(new Uint8Array(32)),hex=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join(''),token=encodeAdminChallenge(hex);assert.equal(token.length,43);assert.equal(decodeAdminChallenge(token),hex);assert.equal(adminLoginCommand(hex),'/start admin_'+token);const link=new URL(adminLoginLink(hex));assert.equal(link.searchParams.get('start'),'admin_'+token);assert.equal(link.searchParams.has('startapp'),false);assert.ok(new TextEncoder().encode('adm:approve:'+token).length<=64);assert.ok(link.searchParams.get('start').length<=64);}
});
test('invalid hex, unsafe characters, wrong lengths and noncanonical padding bits never become different aliases for one challenge',()=>{
 for(const hex of ['',null,'A'.repeat(64),'1'.repeat(63),'../'.repeat(22)])assert.throws(()=>encodeAdminChallenge(hex));
 const canonical=encodeAdminChallenge('0'.repeat(64));assert.equal(canonical,'A'.repeat(43));
 for(const token of ['',null,canonical+'=',canonical.slice(0,-1)+'B',canonical.replace(/^A/,'+'),canonical.replace(/^A/,'/'),'x'.repeat(44),'a b','💫'.repeat(43)])assert.equal(decodeAdminChallenge(token),null);
});
test('only the authenticated internal BOT service can approve a private account; game dev or fake service headers cannot bypass it',async t=>{
 const f=fixture(t),challenge='a'.repeat(64);
 for(const secret of ['', 'not-valid']){const result=await internal(f,{adminTgId:'101',challenge},secret);assert.equal(result.status,401);}
 const publicResult=await handleAdmin(new Request(BASE+'/admin/api/login/approve',{method:'POST',headers:{Origin:BASE,'content-type':'application/json','X-Dev-Tg-Id':'101','X-Service-Secret':f.env.SERVICE_SECRET},body:JSON.stringify({adminTgId:'101',challenge})}),f.env,NOW);assert.equal(publicResult.status,401);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_admin_login_approvals').get().n,0);
});
test('BOT service approval still rechecks current Telegram administrator rights rather than trusting submitted role or character IDs',async t=>{
 const f=fixture(t);f.setRole('member');const r=await internal(f,{adminTgId:'101',challenge:'a'.repeat(64),role:'creator',isAdmin:true});assert.equal(r.status,403);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_admin_login_approvals').get().n,0);
 for(const id of ['c'+'a'.repeat(32),'',null,'../101']){const out=await internal(f,{adminTgId:id,challenge:'a'.repeat(64)});assert.equal(out.status,403);}
});
test('private BOT approval works for a manager without any game character, then browser verifier redeems once without initData',async t=>{
 const f=fixture(t),verifier='b'.repeat(64),challenge=await digest(verifier);
 const approved=await internal(f,{adminTgId:'101',challenge});assert.equal(approved.status,200);assert.equal((await approved.json()).approved,true);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_characters').get().n,0);
 const response=await handleAdmin(new Request(BASE+'/admin/api/login/redeem',{method:'POST',headers:{Origin:BASE,'content-type':'application/json'},body:JSON.stringify({verifier})}),f.env,NOW+10);assert.equal(response.status,200);assert.equal((await response.json()).admin.id,'101');assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 const repeat=await internal(f,{adminTgId:'101',challenge});assert.equal(repeat.status,409);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_admin_sessions').get().n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_ledger').get().n,0);
});
test('BOT approval replay cannot change approver or expiry, and granting group privileges later cannot reuse a consumed approval',async t=>{
 const f=fixture(t),challenge='c'.repeat(64);assert.equal((await internal(f,{adminTgId:'101',challenge})).status,200);const before=f.db.prepare('SELECT * FROM rpg_admin_login_approvals').get();assert.equal((await internal(f,{adminTgId:'101',challenge})).status,200);assert.deepEqual(f.db.prepare('SELECT * FROM rpg_admin_login_approvals').get(),before);
 assert.equal((await internal(f,{adminTgId:'102',challenge})).status,409);assert.deepEqual(f.db.prepare('SELECT * FROM rpg_admin_login_approvals').get(),before);f.db.prepare('UPDATE rpg_admin_login_approvals SET used_at=?').run(NOW);assert.equal((await internal(f,{adminTgId:'101',challenge})).status,409);
});
test('public hash, compact Telegram token or fake verifier cannot redeem another browser login',async t=>{
 const f=fixture(t),verifier='d'.repeat(64),challenge=await digest(verifier);await internal(f,{adminTgId:'101',challenge});
 for(const secret of [challenge,encodeAdminChallenge(challenge),'e'.repeat(64)]){const r=await handleAdmin(new Request(BASE+'/admin/api/login/redeem',{method:'POST',headers:{Origin:BASE,'content-type':'application/json'},body:JSON.stringify({verifier:secret})}),f.env,NOW+10);assert.notEqual(r.status,200);assert.equal(r.headers.get('set-cookie'),null);}
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_admin_sessions').get().n,0);
});
