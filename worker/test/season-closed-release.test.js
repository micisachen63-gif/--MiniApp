import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {handleAdmin} from '../src/admin/index.js';
import * as Auth from '../src/admin/auth.js';

test('closed release rejects every retired season maintenance route even with old flag enabled, preserving all data',async t=>{
 const env={DB:freshDb(),BOT_TOKEN:'synthetic-season-closed-test-token',GROUP_CHAT_ID:'-100111',SEASON_TRANSFER_ENABLED:'true'};
 t.after(()=>env.DB.sqlite.close());
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({ok:true,result:{status:'creator',user:{id:101,first_name:'QA',is_bot:false}}});
 t.after(()=>{globalThis.fetch=originalFetch;});
 const now=Date.parse('2026-11-10T00:00:00Z'),session=await Auth.newSession(env,{id:'101',name:'QA',role:'creator'},now);
 const tables=env.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rpg_%' ORDER BY name").all().map(x=>x.name);
 const snapshot=()=>tables.map(name=>[name,env.DB.sqlite.prepare('SELECT * FROM "'+name+'"').all()]);
 const before=snapshot();
 Object.defineProperty(env,'DB_SEASON',{get(){throw Error('Closed season database must not be accessed');}});
 for(const action of ['status','freeze','drain','seal','import','unknown']){
  const request=new Request('https://test.local/admin/api/season/'+action,{method:'POST',headers:{Origin:'https://test.local','Content-Type':'application/json',Cookie:session.cookie.split(';')[0],'X-Admin-CSRF':session.admin.csrf},body:JSON.stringify({realmId:'season-qa',expectedPhase:'ACTIVE',expectedFenceEpoch:0})});
  const response=await handleAdmin(request,env,now,env);
  assert.equal(response.status,403,action);assert.equal((await response.json()).error,'season_maintenance_disabled',action);
 }
 assert.deepEqual(snapshot(),before);
 const denied=await handleAdmin(new Request('https://test.local/admin/api/season/import',{method:'POST',headers:{Origin:'https://test.local','Content-Type':'application/json'},body:'{}'}),env,now,env);
 assert.equal(denied.status,401);
});
