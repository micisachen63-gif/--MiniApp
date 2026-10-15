import test from 'node:test';
import assert from 'node:assert/strict';
import {metaView} from '../src/app.js';
import {handle} from '../src/index.js';
import {THIEF_RELEASE_READY} from '../src/game/thief-data.js';

test('public creation classes follow the release gate and expose exact thief metadata',()=>{
 const meta=metaView();assert.deepEqual(Object.keys(meta.classes),[...(THIEF_RELEASE_READY?['thief']:[]),'sword','archer','mage']);assert.equal(meta.thief.releaseReady,THIEF_RELEASE_READY);assert.equal(meta.thief.guardianCategory,'melee');
 assert.equal(meta.thief.lineageNodes.length,31);assert.equal(new Set(meta.thief.lineageNodes.map(n=>n.path)).size,31);
 assert.equal(meta.thief.attackSpeedMultiplier,1.8);assert.equal(meta.thief.hitAttackMultiplier,.6);
 for(const [key,cls] of Object.entries(meta.classes)){assert.equal(cls.attackSpeedMultiplier,key==='thief'?1.8:1);assert.equal(cls.hitAttackMultiplier,key==='thief'?.6:1)}
 assert.equal(meta.thief.lineageNodes.find(n=>n.path==='B222').name,'黑月詭術師');
});
test('BOT metadata uses service authentication and never touches the player database',async()=>{
 const env={SERVICE_SECRET:'thief-metadata-test-secret',ENVIRONMENT:'production',DB:new Proxy({},{get(){throw Error('Metadata must not read or mutate players')}})};
 const req=secret=>new Request('https://rpg.test/rpg/meta',{method:'POST',headers:{'content-type':'application/json',...(secret?{'X-Service-Secret':secret}:{})},body:'{}'});
 assert.equal((await handle(req(),env)).status,401);assert.equal((await handle(req('wrong'),env)).status,401);
 const res=await handle(req(env.SERVICE_SECRET),env);assert.equal(res.status,200);const data=await res.json();assert.equal(data.ok,true);assert.equal(!!data.meta.classes.thief,THIEF_RELEASE_READY);assert.equal(data.meta.thief.guardianCategory,'melee');
});
