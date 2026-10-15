import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),dir=path.join(root,'state');fs.mkdirSync(dir,{recursive:true});
const alive=file=>{try{const d=JSON.parse(fs.readFileSync(file));process.kill(d.pid,0);return true;}catch{return false;}};
const own=path.join(dir,'watchdog.lock');if(alive(own))process.exit(0);try{fs.unlinkSync(own);}catch{}fs.writeFileSync(own,JSON.stringify({pid:process.pid}),{flag:'wx'});
function check(){if(fs.existsSync(path.join(dir,'stop-request'))||alive(path.join(dir,'service.lock')))return;const p=spawn(process.execPath,['--dns-result-order=ipv4first',path.join(root,'service.mjs'),'start'],{cwd:root,stdio:'ignore',windowsHide:true});p.unref();}
check();setInterval(check,300000);
