import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
if(Number(process.versions.node.split('.')[0])!==24)throw Error('Tests require Node 24 (validated with 24.19.0).');
const target=process.argv[2]||'all';
if(!['worker','bot','all'].includes(target))throw Error('Use worker, bot or all.');
// Bound file parallelism on shared development machines without changing the
// selected files, assertions or performance thresholds. CI defaults stay native.
const concurrency=process.env.RPG_TEST_CONCURRENCY;
if(concurrency!==undefined&&(!/^[1-9]\d?$/.test(concurrency)||Number(concurrency)>32))throw Error('RPG_TEST_CONCURRENCY must be an integer from 1 to 32.');
for(const service of target==='all'?['worker','bot']:[target]){
  const cwd=path.join(root,service==='worker'?'worker':'cloud-bot');
  const folder=service==='worker'?'test':'src/adapter/test';
  const files=readdirSync(path.join(cwd,folder)).filter(name=>name.endsWith('.test.js')).sort().map(name=>path.join(folder,name));
  if(service==='bot')files.push(...readdirSync(path.join(cwd,'test')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>path.join('test',name)));
  const result=spawnSync(process.execPath,['--test',...(concurrency?['--test-concurrency='+concurrency]:[]),...files],{cwd,stdio:'inherit',windowsHide:true});
  if(result.status!==0)process.exit(result.status||1);
}
