// Metadata-only Git history. Never checks out a branch or calls Cloudflare.
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const RECORD_BRANCH='deployment-records';
export const RECORD_SERVICES=['elf-rpg-api','star-journal-rpg-bot'];
const REPO='https://github.com/micisachen63-gif/--MiniApp';
const receiptPath=service=>`docs/deployment/${service}.json`;
const README='# Deployment records\n\nAppend-only verified production receipts. Source code is reviewed on main; this branch contains metadata only.\nDo not deploy this branch, force-push it, or replace receipts without verifying the live runtime.\n';
function invoke(root,args,input){return spawnSync('git',args,{cwd:root,input,encoding:'utf8',windowsHide:true,maxBuffer:16e6});}
function git(root,args,input){const r=invoke(root,args,input);assert.equal(r.status,0,`Git ${args[0]} failed: ${r.stderr||r.error?.message||'unknown error'}`);return r.stdout;}
export function validateReceipt(service,report){
 assert(RECORD_SERVICES.includes(service),'Unknown receipt service');
 assert.equal(report?.status,'VERIFIED','Receipt must be VERIFIED');assert.equal(report.repository,REPO,'Unexpected receipt repository');assert.equal(report.service,service,'Receipt service mismatch');
 assert.match(report.sourceCommit||'',/^[0-9a-f]{40}$/,'Invalid receipt source commit');assert.equal(report.activePercentage,100);assert.equal(report.noPlayerMutations,true);
 assert(Number.isFinite(Date.parse(report.verifiedAt)),'Invalid verification time');
 assert.deepEqual(report.protectedState?.versions,[{version_id:report.productionVersion,percentage:100}],'Receipt version differs from verified runtime');
 assert(Object.keys(report.runtimeSHA256||{}).length,'Receipt requires verified runtime hashes');
 return report;
}
function remoteHead(root){return git(root,['ls-remote','origin',`refs/heads/${RECORD_BRANCH}`]).trim().split(/\s+/)[0]||null;}
export function readDeploymentRecords(root){
 assert(remoteHead(root),'Deployment receipt branch is missing; initialize verified records before release.');
 git(root,['fetch','origin',`refs/heads/${RECORD_BRANCH}:refs/remotes/origin/${RECORD_BRANCH}`]);
 const head=git(root,['rev-parse',`origin/${RECORD_BRANCH}`]).trim();
 const files=git(root,['ls-tree','-r','--name-only',head]).trim().split(/\r?\n/).sort();
 assert.deepEqual(files,['README.md',...RECORD_SERVICES.map(receiptPath)].sort(),'Receipt branch must contain metadata only');
 const texts=Object.fromEntries(RECORD_SERVICES.map(s=>[s,git(root,['show',`${head}:${receiptPath(s)}`])]));
 const receipts=Object.fromEntries(RECORD_SERVICES.map(s=>[s,validateReceipt(s,JSON.parse(texts[s]))]));
 return {head,texts,receipts};
}
function recordCommit(root,texts,parent,message){
 const blob=input=>git(root,['hash-object','-w','--stdin'],input).trim();
 const deployment=git(root,['mktree'],RECORD_SERVICES.map(s=>`100644 blob ${blob(texts[s])}\t${s}.json\n`).join('')).trim();
 const docs=git(root,['mktree'],`040000 tree ${deployment}\tdeployment\n`).trim();
 const tree=git(root,['mktree'],`100644 blob ${blob(README)}\tREADME.md\n040000 tree ${docs}\tdocs\n`).trim();
 return git(root,['commit-tree',tree,...(parent?['-p',parent]:[]),'-m',message]).trim();
}
export function initializeDeploymentRecords(root){
 if(remoteHead(root))return readDeploymentRecords(root);
 git(root,['fetch','origin','main']);
 const texts=Object.fromEntries(RECORD_SERVICES.map(s=>[s,git(root,['show',`origin/main:${receiptPath(s)}`])]));
 for(const s of RECORD_SERVICES)validateReceipt(s,JSON.parse(texts[s]));
 const commit=recordCommit(root,texts,null,'Preserve existing verified production receipts');
 const pushed=invoke(root,['push','origin',`${commit}:refs/heads/${RECORD_BRANCH}`]);
 // A concurrent initializer may win; only reuse it if its verified data agrees.
 const result=readDeploymentRecords(root);if(pushed.status!==0)for(const s of RECORD_SERVICES)assert.deepEqual(result.receipts[s],JSON.parse(texts[s]),'Concurrent initialization differs; inspect receipts');
 return result;
}
export function appendDeploymentReceipt(root,service,report,expected){
 validateReceipt(service,report);assert(expected?.receipts?.[service],'Original verified receipt is required');
 assert.equal(invoke(root,['merge-base','--is-ancestor',report.sourceCommit,'origin/main']).status,0,'Receipt source must be in GitHub main history');
 for(let attempt=0;attempt<3;attempt++){
  const current=readDeploymentRecords(root);
  if(JSON.stringify(current.receipts[service])===JSON.stringify(report))return {head:current.head,url:`${REPO}/blob/${RECORD_BRANCH}/${receiptPath(service)}`};
  assert.deepEqual(current.receipts[service],expected.receipts[service],'Another release changed this service receipt; inspect live state, never overwrite it');
  const texts={...current.texts,[service]:JSON.stringify(report,null,2)+'\n'},commit=recordCommit(root,texts,current.head,`Record ${service} release ${report.productionVersion}`);
  const pushed=invoke(root,['push','origin',`${commit}:refs/heads/${RECORD_BRANCH}`]);
  if(pushed.status!==0)continue; // Fast-forward only; refresh and preserve the other service on retry.
  const verified=readDeploymentRecords(root);assert.deepEqual(verified.receipts[service],report,'Remote receipt verification failed');
  return {head:verified.head,url:`${REPO}/blob/${RECORD_BRANCH}/${receiptPath(service)}`};
 }
 throw Error('Receipt push failed. Keep .release-sync/verified.json and recover with receipts:record; do not redeploy.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.argv[2],'init','Use npm run receipts:init');
 const root=fileURLToPath(new URL('../',import.meta.url));const result=initializeDeploymentRecords(root);
 console.log(`Verified existing receipt metadata on ${RECORD_BRANCH}: ${result.head}`);
}
