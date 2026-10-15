import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {withReleaseLock,assertKnownRelease} from '../../scripts/release-lock.mjs';
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
