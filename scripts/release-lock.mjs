import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

export function assertKnownRelease(receipt,current){
 assert.equal(receipt?.status,'VERIFIED','A verified production receipt is required before publishing.');
 assert.deepEqual(current,receipt.protectedState,'Production differs from its last verified receipt. Inspect the other release; do not overwrite it.');
}

export async function withReleaseLock(directory,metadata,run){
 const owner={...metadata,id:randomUUID(),pid:process.pid,startedAt:new Date().toISOString()};
 try{await fs.mkdir(directory);}catch(e){
  if(e.code!=='EEXIST')throw e;
  throw Error(`Another release is running or needs inspection: ${path.join(directory,'owner.json')}. Verify its process and live version before clearing an abandoned lock.`);
 }
 const file=path.join(directory,'owner.json');
 try{await fs.writeFile(file,JSON.stringify(owner,null,2));return await run();}
 finally{
  // Only the owner releases its own lock. A hard process crash intentionally
  // leaves evidence for a read-only live-state check before manual recovery.
  const current=JSON.parse(await fs.readFile(file,'utf8').catch(()=>'{"id":null}'));
  if(current.id===owner.id){await fs.unlink(file);await fs.rmdir(directory);}
 }
}
