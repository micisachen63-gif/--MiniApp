// Restore byte-exact accepted evidence into this worktree; never overwrite different evidence.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const check=process.argv.includes('--check');
assert(process.argv.slice(2).every(a=>a==='--check'),'Usage: node docs/skill-vfx-semantics-20261105/restore-evidence.cjs [--check]');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'combat/manifest.json'),'utf8'));
const rows=manifest.entries.filter(row=>row.restoreTarget);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const within=p=>{const rel=path.relative(root,p);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
const prepared=rows.map(row=>{
  assert(/^\.release-sync\/skill-vfx-(?:20261104|semantics-20261105)\/.+\.json$/.test(row.restoreTarget),'Unexpected target: '+row.restoreTarget);
  const source=path.resolve(root,row.path),target=path.resolve(root,row.restoreTarget);
  assert(within(source)&&within(target),'Evidence must remain within this worktree');
  const bytes=fs.readFileSync(source);
  assert.equal(bytes.length,row.bytes,'Archive size changed: '+row.path);
  assert.equal(hash(bytes),row.sha256,'Archive SHA changed: '+row.path);
  const exists=fs.existsSync(target);
  if(exists)assert.equal(hash(fs.readFileSync(target)),row.sha256,'Refusing to overwrite different evidence; preserve the existing file first: '+row.restoreTarget);
  return {row,target,bytes,exists};
});
for(const entry of prepared)if(!check&&!entry.exists){
  fs.mkdirSync(path.dirname(entry.target),{recursive:true});
  fs.writeFileSync(entry.target,entry.bytes,{flag:'wx'});
}
console.log(JSON.stringify({status:'passed',mode:check?'check':'restore',artifacts:prepared.length,alreadyPresent:prepared.filter(x=>x.exists).length,written:check?0:prepared.filter(x=>!x.exists).length,missing:check?prepared.filter(x=>!x.exists).map(x=>x.row.restoreTarget):[]}));
