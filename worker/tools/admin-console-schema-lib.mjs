import assert from 'node:assert/strict';

// Wrangler --file can print upload progress even with --json. A write's stdout
// is not its receipt: verify the live schema with a separate strict JSON read.
export function commandResult(result,{json=true,onFailure=()=>{}}={}){
 if(result.error||result.status!==0||result.signal){
  onFailure(result.stderr||result.stdout||String(result.error||'CLI failed'));
  throw Error('D1 command failed; inspect .release-sync/admin-schema-error.txt and live schema before continuing. Do not blindly retry.');
 }
 if(!json)return;
 return JSON.parse(result.stdout.replace(/^\uFEFF/,''));
}

// node:sqlite returns null-prototype rows while Wrangler JSON returns ordinary
// objects. Normalize only the prototype, retaining every field and exact SQL.
export const schemaRows=rows=>rows.map(row=>({...row}));

export function schemaState(response,expected){
 assert(Array.isArray(response)&&response.length===2,'Invalid schema inspection response');
 for(const part of response)assert(part?.success!==false&&Array.isArray(part?.results),'Invalid schema inspection query result');
 const present=response[0].results,receipts=response[1].results;
 assert(receipts.every(row=>row?.name==='0033_admin_console.sql'),'Unexpected admin migration receipt');
 const recorded=receipts.length===1;
 if(present.length){
  assert.deepEqual(schemaRows(present),schemaRows(expected),'Partial or different admin schema detected; stop for inspection');
  assert(recorded,'Schema exists without its migration receipt; inspect before recording');
  return {installed:true,objects:present.length};
 }
 assert(!receipts.length,'Migration receipt exists but admin objects are absent');
 return {installed:false,objects:0};
}

export function applyReviewedSchema({inspect,write}){
 const before=inspect();
 if(before.installed)return {...before,changed:false};
 write();
 // Never infer success from a CLI status or retry an uncertain write. Require
 // the reviewed objects and migration receipt to exist on the next read.
 const after=inspect();
 assert(after.installed,'D1 write finished without verified admin schema; inspect live state before continuing. Do not retry automatically.');
 return {...after,changed:true};
}
