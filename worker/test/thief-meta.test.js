import test from 'node:test';
import assert from 'node:assert/strict';
import {metaView} from '../src/app.js';
import {handle} from '../src/index.js';

test('unreleased thief remains absent from public creation classes but exposes exact planning metadata',()=>{
 const meta=metaView();assert.deepEqual(Object.keys(meta.classes),['sword','archer','mage']);assert.equal(meta.thief.releaseReady,false);assert.equal(meta.thief.guardianCategory,'melee');
 assert.equal(meta.thief.lineageNodes.length,31);assert.equal(new Set(meta.thief.lineageNodes.map(n=>n.path)).size,31);
 assert.equal(meta.thief.attackSpeedMultiplier,1.8);assert.equal(meta.thief.hitAttackMultiplier,.6);
 for(const cls of Object.values(meta.classes)){assert.equal(cls.attackSpeedMultiplier,1);assert.equal(cls.hitAttackMultiplier,1)}
 assert.equal(meta.thief.lineageNodes.find(n=>n.path==='B222').name,'黑月詭術師');
});
test('BOT metadata uses service authentication and never touches the player database',async()=>{
 const env={SERVICE_SECRET:'thief-metadata-test-secret',ENVIRONMENT:'production',DB:new Proxy({},{get(){throw Error('Metadata must not read or mutate players')}})};
 const req=secret=>new Request('https://rpg.test/rpg/meta',{method:'POST',headers:{'content-type':'application/json',...(secret?{'X-Service-Secret':secret}:{})},body:'{}'});
 assert.equal((await handle(req(),env)).status,401);assert.equal((await handle(req('wrong'),env)).status,401);
 const res=await handle(req(env.SERVICE_SECRET),env);assert.equal(res.status,200);const data=await res.json();assert.equal(data.ok,true);assert(!data.meta.classes.thief);assert.equal(data.meta.thief.guardianCategory,'melee');
});
