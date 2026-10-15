import test from 'node:test';
import assert from 'node:assert/strict';
import rehearsal from '../tools/thief-schema-rehearsal/index.js';
const db={prepare(){throw Error('Unauthorised request reached DB');},batch(){throw Error('Unauthorised request reached DB');}};
const request=(path,token,body={})=>new Request('https://isolated.invalid'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('rehearsal requires the isolated mode and secret before accessing any database',async()=>{
 for(const env of [{DB:db},{DB:db,MODE:'production',REHEARSAL_TOKEN:'correct'},{DB:db,MODE:'isolated-rehearsal',REHEARSAL_TOKEN:'correct'}]){
  const response=await rehearsal.fetch(request('/apply','wrong',{sql:'DROP TABLE players'}),env);assert.equal(response.status,404);
 }
});
test('authenticated rehearsal has no arbitrary SQL endpoint and restricts digest tables and candidate',async()=>{
 const env={DB:db,MODE:'isolated-rehearsal',REHEARSAL_TOKEN:'correct'};
 for(const [path,body,status] of [['/query',{sql:'DROP TABLE players'},404],['/page-digest',{table:'sqlite_master'},400],['/page-digest',{table:'rpg_characters',offset:-1},400],['/apply',{expectedBeforeSHA256:'invented',sql:'anything'},409]]){
  const response=await rehearsal.fetch(request(path,'correct',body),env);assert.equal(response.status,status);
 }
});
