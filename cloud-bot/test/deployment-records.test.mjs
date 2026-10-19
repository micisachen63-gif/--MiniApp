import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {RECORD_SERVICES,initializeDeploymentRecords,readDeploymentRecords,appendDeploymentReceipt} from '../../scripts/deployment-records.mjs';
function run(root,args){const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'rpg-records-')),remote=path.join(base,'remote.git'),root=path.join(base,'checkout');fs.mkdirSync(root);
 t.after(()=>{assert(path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep+'rpg-records-'));fs.rmSync(base,{recursive:true,force:true});});run(base,['init','--bare',remote]);run(root,['init','-b','main']);run(root,['config','user.email','isolated-test@example.invalid']);run(root,['config','user.name','Isolated receipt test']);
 fs.writeFileSync(path.join(root,'README.md'),'Source');run(root,['add','.']);run(root,['commit','-m','Initial source']);const source=run(root,['rev-parse','HEAD']);
 const reports=Object.fromEntries(RECORD_SERVICES.map((s,i)=>[s,{status:'VERIFIED',repository:'https://github.com/micisachen63-gif/--MiniApp',service:s,sourceCommit:source,productionVersion:'version-'+i,activePercentage:100,verifiedAt:'2026-10-19T00:00:00.000Z',noPlayerMutations:true,runtimeSHA256:{'index.js':'a'.repeat(64)},protectedState:{versions:[{version_id:'version-'+i,percentage:100}],bindings:[],crons:[]}}]));
 fs.mkdirSync(path.join(root,'docs/deployment'),{recursive:true});for(const s of RECORD_SERVICES)fs.writeFileSync(path.join(root,'docs/deployment',s+'.json'),JSON.stringify(reports[s],null,2)+'\n');run(root,['add','.']);run(root,['commit','-m','Existing verified receipts']);run(root,['remote','add','origin',remote]);run(root,['push','origin','main']);run(root,['fetch','origin','main']);
 return {root,remote,reports,head:run(root,['rev-parse','HEAD'])};
}
function next(report,sourceCommit,label='next'){const r=structuredClone(report);r.sourceCommit=sourceCommit;r.productionVersion=label;r.verifiedAt='2026-10-19T01:00:00.000Z';r.protectedState.versions=[{version_id:label,percentage:100}];return r;}
function unchanged(f){assert.equal(run(f.root,['rev-parse','HEAD']),f.head);assert.equal(run(f.root,['rev-parse','origin/main']),f.head);assert.equal(run(f.root,['status','--porcelain']),'');}
test('initialization preserves both verified receipts on metadata-only history without changing main or checkout',t=>{
 const f=fixture(t),initial=initializeDeploymentRecords(f.root);assert.deepEqual(initial.receipts,f.reports);assert.equal(initializeDeploymentRecords(f.root).head,initial.head);unchanged(f);
 for(const s of RECORD_SERVICES)assert.equal(run(f.root,['rev-parse',`origin/main:docs/deployment/${s}.json`]),run(f.root,['rev-parse',`origin/deployment-records:docs/deployment/${s}.json`]));
});
test('append succeeds with main protected and retains the other service, lineage and exact source identity',t=>{
 const f=fixture(t),initial=initializeDeploymentRecords(f.root);fs.writeFileSync(path.join(f.remote,'hooks/update'),'#!/bin/sh\nif [ "$1" = "refs/heads/main" ]; then echo "main requires PR and CI" >&2; exit 1; fi\n',{mode:0o755});
 const report=next(f.reports[RECORD_SERVICES[0]],f.head),record=appendDeploymentReceipt(f.root,RECORD_SERVICES[0],report,initial),read=readDeploymentRecords(f.root);assert.equal(read.head,record.head);assert.deepEqual(read.receipts[RECORD_SERVICES[0]],report);assert.deepEqual(read.receipts[RECORD_SERVICES[1]],f.reports[RECORD_SERVICES[1]]);assert.equal(run(f.root,['rev-parse',record.head+'^']),initial.head);unchanged(f);
});
test('concurrent other-service update is preserved; same-service replacement is refused; uncertain retry is idempotent',t=>{
 const f=fixture(t),initial=initializeDeploymentRecords(f.root),a=next(f.reports[RECORD_SERVICES[0]],f.head,'worker-next'),b=next(f.reports[RECORD_SERVICES[1]],f.head,'bot-next');appendDeploymentReceipt(f.root,RECORD_SERVICES[0],a,initial);appendDeploymentReceipt(f.root,RECORD_SERVICES[1],b,initial);
 const read=readDeploymentRecords(f.root);assert.deepEqual(read.receipts,{[RECORD_SERVICES[0]]:a,[RECORD_SERVICES[1]]:b});assert.equal(appendDeploymentReceipt(f.root,RECORD_SERVICES[0],a,initial).head,read.head);
 assert.throws(()=>appendDeploymentReceipt(f.root,RECORD_SERVICES[0],next(a,f.head,'overwrite'),initial),/Another release/);unchanged(f);
});
test('failed receipt publication leaves source intact and can recover without another deployment',t=>{
 const f=fixture(t),initial=initializeDeploymentRecords(f.root),hook=path.join(f.remote,'hooks/update'),report=next(f.reports[RECORD_SERVICES[0]],f.head);
 fs.writeFileSync(hook,'#!/bin/sh\necho "temporary receipt push rejection" >&2\nexit 1\n',{mode:0o755});assert.throws(()=>appendDeploymentReceipt(f.root,RECORD_SERVICES[0],report,initial),/do not redeploy/);assert.deepEqual(readDeploymentRecords(f.root).receipts,f.reports);unchanged(f);
 fs.unlinkSync(hook);appendDeploymentReceipt(f.root,RECORD_SERVICES[0],report,initial);assert.deepEqual(readDeploymentRecords(f.root).receipts[RECORD_SERVICES[0]],report);unchanged(f);
});
test('invalid reports and receipt sources outside main are rejected before publication',t=>{
 const f=fixture(t),initial=initializeDeploymentRecords(f.root);for(const update of [{status:'PENDING'},{service:'wrong'},{noPlayerMutations:false},{sourceCommit:'f'.repeat(40)}])assert.throws(()=>appendDeploymentReceipt(f.root,RECORD_SERVICES[0],{...next(f.reports[RECORD_SERVICES[0]],f.head),...update},initial));assert.equal(readDeploymentRecords(f.root).head,initial.head);unchanged(f);
});
