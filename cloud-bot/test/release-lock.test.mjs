import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {withReleaseLock,assertKnownRelease} from '../../scripts/release-lock.mjs';
import {isStaticAsset} from '../../scripts/static-assets.mjs';
import {retryRead} from '../../scripts/read-only-network.mjs';
test('read-only verification retries only bounded transport failures, never definite errors',async()=>{
 let attempts=0;assert.equal(await retryRead(async()=>{if(++attempts<3)throw Object.assign(Error('reset'),{code:'ECONNRESET'});return 'verified';}),'verified');assert.equal(attempts,3);
 attempts=0;await assert.rejects(retryRead(async()=>{attempts++;throw Object.assign(Error('denied'),{code:'forbidden'});}),/denied/);assert.equal(attempts,1);
 attempts=0;await assert.rejects(retryRead(async()=>{attempts++;throw Object.assign(Error('reset'),{code:'ECONNRESET'});}),/reset/);assert.equal(attempts,3);
});
test('verification excludes Cloudflare metadata and ignored history but retains real runtime assets',()=>{
 for(const file of ['worker/public/.assetsignore','public/_headers','public/_redirects','public/app.js.20261010.bak','public/app.js.backup-original','public/battle.js.before-fix'])assert.equal(isStaticAsset(file),false,file);
 for(const file of ['worker/public/app.js','public/art/hero.webp','public/advanced-specializations.css','public/expedition/index.html'])assert.equal(isStaticAsset(file),true,file);
});
test('an unrecorded version, binding or schedule blocks publication instead of overwriting another window',()=>{
 const state={versions:[{version_id:'known',percentage:100}],bindings:[{name:'DB',id:'original'}],crons:['* * * * *']},receipt={status:'VERIFIED',protectedState:state};
 assert.doesNotThrow(()=>assertKnownRelease(receipt,structuredClone(state)));
 for(const update of [{versions:[{version_id:'other',percentage:100}]},{bindings:[]},{crons:[]}])assert.throws(()=>assertKnownRelease(receipt,{...state,...update}),/Production differs/);
 assert.throws(()=>assertKnownRelease({status:'PENDING'},state),/verified production receipt/);
});
test('one shared release lock excludes concurrent services/checkouts and releases on success or failure',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rpg-release-test-')),lock=path.join(dir,'lock');let finish;
 try{
  const first=withReleaseLock(lock,{service:'worker'},()=>new Promise(resolve=>{finish=resolve;}));
  // Use file existence as readiness, without a timing-sensitive sleep.
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(withReleaseLock(lock,{service:'bot'},()=>{throw Error('must not run');}),/Another release/);
  finish('ok');assert.equal(await first,'ok');await assert.rejects(fs.stat(lock),e=>e.code==='ENOENT');
  await assert.rejects(withReleaseLock(lock,{},()=>{throw Error('publication uncertain');}),/publication uncertain/);
  await assert.rejects(fs.stat(lock),e=>e.code==='ENOENT');
 }finally{await fs.rmdir(dir);}
});
