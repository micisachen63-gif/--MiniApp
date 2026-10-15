import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {withReleaseLock} from './release-lock.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),service=process.argv[2];
if(!['worker','bot'].includes(service))throw Error('Choose worker or bot.');
const result=spawnSync('git',['rev-parse','--git-common-dir'],{cwd:root,encoding:'utf8',windowsHide:true});
if(result.status!==0)throw Error('Cannot locate shared Git directory.');
const lock=path.resolve(root,result.stdout.trim(),'rpg-release.lock');
await withReleaseLock(lock,{service,checkout:root},()=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[path.join(root,'scripts/release-sync.mjs'),'deploy',service],{cwd:root,stdio:'inherit',windowsHide:true});
 child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error(`Release stopped (${code??signal}); inspect .release-sync before retrying.`)));
})).catch(error=>{console.error(error.message);process.exitCode=1;});
