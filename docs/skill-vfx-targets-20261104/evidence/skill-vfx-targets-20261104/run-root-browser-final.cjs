const fs=require('fs'),cp=require('child_process'),crypto=require('crypto'),assert=require('assert');
const dir='.release-sync/skill-vfx-targets-20261104',root='D:/StarJournal',gitPath='C:/Users/User/Documents/ChatGPT/tools/git/cmd/git.exe';
const statusPath=root+'/handoff/skill-vfx/STATUS.json',status=JSON.parse(fs.readFileSync(statusPath,'utf8'));
assert.equal(status.activeBatch.name,'skill-vfx-targets-20261104');
status.updatedAt=new Date().toISOString();status.summary='多目標與彈體時序修正已完成：同一最終engine的既有23＋新20測試通過；工坊48畫面＋12操作通過。正刷新完整196身份、32真API情境與獨立五敵提交證據，尚未提交。';
status.completed.push('多目標批：engine已完成，明確targets最多32為呈現契約邊界、現行Atlas最多5；單敵不添假散射、第五段雷鏈與減少動態不漏目標、箭與火球中心對齊.57；最終engine669ee45，23既有＋20新回歸全過。','多目標批：工坊新增1/3/5靶標與自身支援隔離；修正新控制選擇器衝突後，320/390/1280共48畫面＋12控制通過，0頁面／HTTP錯誤。原失敗保留；全面工坊首輪因30秒執行上限中止，將只重跑未完成的全目錄步驟。');
status.inProgress=['刷新本版196技能身份呈現／瀏覽器證據、Atlas16與legacy16真API情境；補獨立五敵真提交及最終動畫截圖。'];
status.nextSteps=['等候當前本線兩個驗收wrapper，按各自execution receipt讀取，不操作全域MCP task。','將新canonical與原始報告完整歸檔並重建coverage；舊版8a證據保留原版本歸屬。','確認最終來源與受保護backend/catalog/按鈕SHA，再保存本機提交與交接；不部署。'];
const temporary=statusPath+'.targets-progress.tmp';fs.writeFileSync(temporary,JSON.stringify(status,null,2)+'\n');fs.renameSync(temporary,statusPath);
cp.execFileSync(process.execPath,['handoff/skill-vfx/.tooling/checkpoint-progress.mjs','--root='+root,'--git='+gitPath],{cwd:root,stdio:'ignore'});
const paths=['worker/src/game/atlas-engine.js','worker/src/game/atlas-combat-observer.js','worker/src/game/atlas-catalog.js','worker/src/game/atlas-talents.js','worker/src/services/atlas.js','worker/public/scene-live-session.js','worker/public/scene-live-view.js','worker/public/scene-live-view.css','worker/public/skill-vfx-engine.mjs','worker/public/skill-vfx-combat-adapter.mjs','worker/public/skill-vfx-actor-bridge.mjs','worker/public/skill-vfx-catalog.json','worker/public/skill-vfx-recipes.json','worker/public/skill-vfx-actor-profiles.json','worker/tools/skill-vfx-live-browser.cjs','worker/tools/skill-vfx-browser.cjs','worker/public/skill-vfx-preview.mjs','worker/public/skill-vfx-preview.css','worker/public/preview-skill-vfx.html'];
const hash=()=>Object.fromEntries(paths.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const record={schemaVersion:1,startedAt:new Date().toISOString(),before:hash(),steps:[]};
assert.equal(record.before['worker/public/skill-vfx-engine.mjs'],'669ee45ee62f0dc624864b7e8c29fa6ddf53e4a9940b9ce6b89310e0fbb93fa0');
const env={...process.env,CODEX_PRIMARY_RUNTIME_NODE_MODULES:'D:/StarJournal/worktree-snapshots/star-journal-button-polish-20261104/.release-sync/browser-tools/node_modules',VFX_QA_DIR:dir+'/workshop-final',SKILL_VFX_LIVE_QA_DIR:dir+'/atlas-live'};
for(const [name,args,timeout] of [['workshop-full-final',['worker/tools/skill-vfx-browser.cjs'],180000],['atlas-live-final',['worker/tools/skill-vfx-live-browser.cjs'],450000]]){
 const step={name,args,startedAt:new Date().toISOString(),status:'running'};record.steps.push(step);fs.writeFileSync(dir+'/root-browser-execution.json',JSON.stringify(record,null,2)+'\n');
 const out=fs.openSync(dir+'/'+name+'.stdout.log','w'),err=fs.openSync(dir+'/'+name+'.stderr.log','w');
 let result;try{result=cp.spawnSync(process.execPath,args,{env,stdio:['ignore',out,err],timeout});}finally{fs.closeSync(out);fs.closeSync(err);}
 Object.assign(step,{finishedAt:new Date().toISOString(),exitCode:result.status,signal:result.signal,error:result.error?.message||null,status:result.status===0?'passed':'failed'});
 record.after=hash();record.sourceStable=JSON.stringify(record.before)===JSON.stringify(record.after);
 fs.writeFileSync(dir+'/root-browser-execution.json',JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(step));
 if(result.status!==0||!record.sourceStable){process.exitCode=1;break;}
}
record.finishedAt=new Date().toISOString();record.passed=record.steps.length===2&&record.steps.every(s=>s.exitCode===0)&&record.sourceStable;fs.writeFileSync(dir+'/root-browser-execution.json',JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({passed:record.passed,sourceStable:record.sourceStable}));
