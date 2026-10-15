import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {freshDb} from './d1-shim.js';
import {CurrentClientRequest} from './client-request.js';
import {handle} from '../src/index.js';
import * as P from '../src/services/player.js';
import {CLASS_KEYS} from '../src/game/constants.js';
const TOKEN='12345:test-only-creation-auth-token';
function signed(id,age=0){const fields={auth_date:String(Math.floor(Date.now()/1000)-age),user:JSON.stringify({id:Number(id),first_name:'測試旅人'})};const text=Object.keys(fields).sort().map(k=>k+'='+fields[k]).join('\n'),key=createHmac('sha256','WebAppData').update(TOKEN).digest();return new URLSearchParams({...fields,hash:createHmac('sha256',key).update(text).digest('hex')}).toString();}
function setup(){const env={DB:freshDb(),BOT_TOKEN:TOKEN,ENVIRONMENT:'production'};const call=async(id,action,body={},init=signed(id))=>{const r=await handle(new CurrentClientRequest('https://local/app/api/'+action,{method:'POST',headers:{'content-type':'application/json',...(init?{'X-Telegram-Init-Data':init}:{})},body:JSON.stringify(body)}),env);return {status:r.status,...await r.json()};};return {env,call};}
for(const cls of CLASS_KEYS)for(const gender of ['m','f'])test(`verified existing account creates ${cls}/${gender} with expired or missing admission and safely selects it`,async()=>{
 const {env,call}=setup(),now=Date.now();
 try{
  await P.createCharacter(env,{tgId:'111',name:'原有旅人',baseClass:'mage',gender:'m'},now);
  if(gender==='f')await env.DB.prepare('INSERT INTO rpg_app_access(tg_id,expires_at,granted_at) VALUES(?,?,0)').bind('111',now-1).run();
  const before=env.DB.sqlite.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get('111');
  const made=await call('111','create',{tgId:'999',account_tg_id:'999',selectedCharacterId:'999',name:'新增旅人',baseClass:cls,gender,charSlot:2,requestId:'creation-test-1'});
  assert.equal(made.status,200,JSON.stringify(made));assert.equal(made.characters.length,2);
  const alt=made.characters.find(c=>c.slot===2);assert.equal(alt.baseClass,cls);assert.equal(alt.gender,gender);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get('111'),before);
  assert.equal(env.DB.sqlite.prepare('SELECT account_tg_id FROM rpg_characters WHERE tg_id=?').get(alt.charId).account_tg_id,'111');
  const list=await call('111','characters');assert.equal(list.characters.length,2);
  const selected=await call('111','select',{charId:alt.charId});assert.equal(selected.status,200);assert.equal(selected.character.baseClass,cls);
  const me=await call('111','me',{selectedCharacterId:alt.charId});assert.equal(me.character.tgId,alt.charId);assert.equal(me.character.name,'新增旅人');
  assert.equal((await call('222','select',{charId:alt.charId})).error,'character_not_owned');
 }finally{env.DB.sqlite.close();}
});
test('fresh account still needs its own unexpired admission, and forged ownership cannot grant it',async()=>{
 const {env,call}=setup();try{
  await P.createCharacter(env,{tgId:'222',name:'別人的旅人',baseClass:'sword',gender:'m'},Date.now());
  const body={tgId:'222',account_tg_id:'222',selectedCharacterId:'222',name:'新旅人',baseClass:'thief',gender:'f'};
  assert.equal((await call('111','create',body)).error,'no_pass');
  await env.DB.prepare('INSERT INTO rpg_app_access(tg_id,expires_at,granted_at) VALUES(?,?,0)').bind('111',Date.now()-1).run();
  assert.equal((await call('111','create',body)).error,'no_pass');
  await env.DB.prepare('UPDATE rpg_app_access SET expires_at=? WHERE tg_id=?').bind(Date.now()+60000,'111').run();
  assert.equal((await call('111','create',body)).status,200);
 }finally{env.DB.sqlite.close();}
});
test('existing characters never bypass missing, forged, stale or another account Telegram authentication',async()=>{
 const {env,call}=setup();try{
  await P.createCharacter(env,{tgId:'111',name:'驗證旅人',baseClass:'sword',gender:'m'},Date.now());
  const body={tgId:'111',name:'不能建立',baseClass:'thief',gender:'m'};
  for(const init of ['',signed('111',90000),signed('111').replace('111','112')])assert.equal((await call('111','create',body,init)).status,401);
  assert.equal((await call('222','create',body)).error,'no_pass');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_characters').get().n,1);
 }finally{env.DB.sqlite.close();}
});
test('all four classes can occupy one account; gaps, invalid input, full slots and parallel creation keep ownership and grants intact',async()=>{
 const {env,call}=setup();try{
  await P.createCharacter(env,{tgId:'111',name:'第一旅人',baseClass:'sword',gender:'m'},Date.now());
  assert.equal((await call('111','create',{name:'第三旅人',baseClass:'mage',gender:'f',charSlot:3})).status,200);
  const defaults=await call('111','create',{name:'第二旅人',baseClass:'archer',gender:'m'});assert.equal(defaults.characters.find(c=>c.name==='第二旅人').slot,2);
  for(const patch of [{charSlot:3},{charSlot:5},{baseClass:'fake'},{gender:'x'},{name:'!'}])assert.equal((await call('111','create',{name:'第四旅人',baseClass:'thief',gender:'f',charSlot:4,...patch})).ok,false);
  const raced=await Promise.all(['第四甲甲','第四乙乙'].map(name=>call('111','create',{name,baseClass:'thief',gender:'f',charSlot:4})));
  assert.equal(raced.filter(x=>x.ok).length,1);assert.equal((await call('111','characters')).characters.length,4);
  assert.equal((await call('111','create',{name:'第五旅人',baseClass:'thief',gender:'f'})).error,'character_limit');
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='新手禮包'").get().n,4);
  assert.deepEqual(env.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{env.DB.sqlite.close();}
});

test('committed-response loss, parallel identical retries and replay after full slots return one creation and one starter grant',async()=>{
 const {env,call}=setup();try{
  await P.createCharacter(env,{tgId:'111',name:'原有角色',baseClass:'sword',gender:'m'},Date.now());
  const body={name:'重試盜賊',baseClass:'thief',gender:'f',charSlot:2,requestId:'one-creation-receipt'};
  const pair=await Promise.all([call('111','create',body),call('111','create',body)]);
  assert.ok(pair.every(r=>r.ok));assert.equal(new Set(pair.flatMap(r=>r.characters.filter(c=>c.slot===2).map(c=>c.charId))).size,1);
  for(const slot of [3,4])await call('111','create',{name:'追加角色'+slot,baseClass:'mage',gender:'m',charSlot:slot});
  assert.equal((await call('111','create',body)).ok,true);
  assert.equal((await call('111','create',{...body,gender:'m'})).error,'request_reused');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_characters').get().n,4);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='新手禮包'").get().n,4);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE event_id=?").get('character-create:111:app:'+body.requestId).n,1);
 }finally{env.DB.sqlite.close();}
});
