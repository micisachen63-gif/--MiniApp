import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {fateMembership} from '../src/fate-membership.mjs';
const env={SERVICE_SECRET:'offline-membership-secret',BOT_TOKEN:'offline-token',GROUP_CHAT_ID:'-100123'};
const req=(body,headers={},method='POST')=>new Request('https://bot.test/internal/fate-membership',{method,headers:{Authorization:'Bearer '+env.SERVICE_SECRET,...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})});
const hooks=registerHooks({load(url,context,next){return url.endsWith('/resvg.wasm')?{format:'module',source:'export default {};',shortCircuit:true}:next(url,context);}});
const entry=(await import('../src/index.mjs')).default;hooks.deregister();
test('membership entry rejects unauthenticated calls before any coordinator or Telegram access',async()=>{
 for(const headers of [{Authorization:'wrong'},{Authorization:'', 'X-Service-Secret':env.SERVICE_SECRET}])assert.equal((await entry.fetch(req({accountIds:['7']},headers),env,{})).status,403);
 assert.equal((await entry.fetch(req({}, {},'GET'),env,{})).status,404);
 assert.equal((await fateMembership(req({accountIds:['7']}),{...env,SERVICE_SECRET:''})).status,403);
});
test('membership is bounded to four unique canonical accounts and a configured fixed group',async()=>{
 const forbidden=()=>assert.fail('invalid lookup reached Telegram');
 for(const input of [null,{}, {accountIds:[]},{accountIds:['1','2','3','4','5']},{accountIds:['7',7]},{accountIds:['07']},{accountIds:['-1']},{accountIds:['9007199254740992']},{accountIds:[{}]},{accountIds:[1.5]}])assert.equal((await fateMembership(req(input),env,{apiFactory:forbidden})).status,400);
 assert.equal((await fateMembership(req({accountIds:['7']}),{...env,GROUP_CHAT_ID:''},{apiFactory:forbidden})).status,503);
 assert.equal((await fateMembership(req({accountIds:['7'],extra:'x'.repeat(2048)}),env,{apiFactory:forbidden})).status,413);
});
test('membership uses no retry, fixed group and bounded timeout; restricted requires explicit current membership',async()=>{
 const statuses=[{status:'member'},{status:'administrator'},{status:'creator'},{status:'restricted',is_member:true},{status:'restricted',is_member:false},{status:'restricted'},{status:'left'},{status:'kicked'},{status:'unknown'},null];
 for(const [i,status] of statuses.entries()){
  let called=0;
  const apiFactory=token=>{assert.equal(token,env.BOT_TOKEN);return {async call(method,body,options){called++;assert.equal(method,'getChatMember');assert.deepEqual(body,{chat_id:env.GROUP_CHAT_ID,user_id:'7'});assert.deepEqual(options,{timeoutMs:5000,retries429:0});return status;}};};
  const response=await fateMembership(req({accountIds:[7],groupId:'-100999',method:'sendMessage'}),env,{apiFactory});
  assert.equal(called,1);assert.deepEqual(await response.json(),{ok:true,members:[{accountId:'7',member:i<4}]});
 }
});
test('unknown Telegram errors fail closed independently without leaking details',async()=>{
 const response=await fateMembership(req({accountIds:['7','8']}),env,{apiFactory:()=>({async call(method,body){if(body.user_id==='7')throw Error(env.BOT_TOKEN);return {status:'member'};}})});
 assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{ok:true,members:[{accountId:'7',member:false},{accountId:'8',member:true}]});
});
