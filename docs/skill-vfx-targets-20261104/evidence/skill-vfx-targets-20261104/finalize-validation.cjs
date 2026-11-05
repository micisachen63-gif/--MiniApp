const fs=require('fs'),cp=require('child_process'),crypto=require('crypto'),assert=require('assert');
const dir='.release-sync/skill-vfx-targets-20261104';
fs.cpSync(dir+'/target-browser',dir+'/target-browser-before-capture-fix',{recursive:true,errorOnExist:true,force:false});
const before=crypto.createHash('sha256').update(fs.readFileSync('worker/public/skill-vfx-engine.mjs')).digest('hex');
assert.equal(before,'669ee45ee62f0dc624864b7e8c29fa6ddf53e4a9940b9ce6b89310e0fbb93fa0');
const env={...process.env,CODEX_PRIMARY_RUNTIME_NODE_MODULES:'D:/StarJournal/worktree-snapshots/star-journal-button-polish-20261104/.release-sync/browser-tools/node_modules',VFX_TARGET_QA_DIR:dir+'/target-browser'};
const commands=[
 ['target-browser-capture-fixed',['worker/tools/skill-vfx-target-browser.cjs']],
 ['normalize',['worker/tools/build-skill-vfx-browser-evidence.mjs','--gameplay='+dir+'/execution-2026-11-04T10-32-31-984Z-16516/legacy-gameplay/results.json','--atlas='+dir+'/atlas-live/results.json','--out=.release-sync/skill-vfx-20261104/gameplay-coverage-browser.json']],
 ['coverage-build',['worker/tools/build-skill-vfx-coverage.mjs','--require-legacy-completion']],
 ['coverage-check',['worker/tools/build-skill-vfx-coverage.mjs','--check','--require-legacy-completion']]
];
const report={schemaVersion:1,startedAt:new Date().toISOString(),engineBefore:before,steps:[]};
for(const[name,args]of commands){const start=Date.now(),r=cp.spawnSync(process.execPath,args,{env,encoding:'utf8',maxBuffer:64*1024*1024,timeout:120000});fs.writeFileSync(dir+'/'+name+'.stdout.log',r.stdout||'');fs.writeFileSync(dir+'/'+name+'.stderr.log',r.stderr||'');report.steps.push({name,args,exitCode:r.status,signal:r.signal,error:r.error?.message||null,durationMs:Date.now()-start});fs.writeFileSync(dir+'/final-validation-execution.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.steps.at(-1)));if(r.status!==0){process.exitCode=1;break;}}
report.engineAfter=crypto.createHash('sha256').update(fs.readFileSync('worker/public/skill-vfx-engine.mjs')).digest('hex');assert.equal(report.engineAfter,before);
report.finishedAt=new Date().toISOString();report.passed=report.steps.length===commands.length&&report.steps.every(s=>s.exitCode===0);fs.writeFileSync(dir+'/final-validation-execution.json',JSON.stringify(report,null,2)+'\n');
const coverage=JSON.parse(fs.readFileSync('worker/public/skill-vfx-coverage.json','utf8'));console.log(JSON.stringify({passed:report.passed,coverageSummary:coverage.summary,coverageFiles:coverage.sourceFiles.length,receipts:coverage.receipts.length},null,2));
