// Read-only comparison of an already captured schema-only CLI result. No network or player data.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {repositorySchemaDatabase,schemaRows} from './prepare-thief-schema-candidate.mjs';
const input=process.argv[2];
if(!input)throw new Error('Pass a captured schema-only JSON result');
const raw=fs.readFileSync(input),decoded=raw.toString(raw[0]===255&&raw[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'');
const response=JSON.parse(decoded),rows=response.flatMap(r=>r.results||[]);
const include=r=>!r.name.startsWith('sqlite_')&&!r.name.startsWith('_cf_')&&!r.name.startsWith('_thief_')&&r.name!=='d1_migrations';
const live=rows.filter(include),db=repositorySchemaDatabase(),local=schemaRows(db);db.close();
const digest=s=>createHash('sha256').update(s).digest('hex');
const map=new Map(live.map(r=>[r.name,r])),localMap=new Map(local.map(r=>[r.name,r]));
const differences=[],lineEndingOnly=[];
const normalized=r=>JSON.stringify({type:r.type,name:r.name,tbl_name:r.tbl_name,sql:r.sql?.replaceAll('\r\n','\n')??null});
for(const r of local){const found=map.get(r.name);if(!found)differences.push({name:r.name,kind:'missing-live'});else if(JSON.stringify(found)!==JSON.stringify(r)){if(normalized(found)===normalized(r))lineEndingOnly.push(r.name);else differences.push({name:r.name,kind:'definition-drift',local:r,live:found});}}
for(const r of live)if(!localMap.has(r.name))differences.push({name:r.name,kind:'extra-live',live:r});
const report={scope:'schema-only read; no player rows or remote writes',capturedAt:new Date().toISOString(),productionWrites:0,
 captureSHA256:digest(raw),liveObjects:live.length,repositoryObjects:local.length,
 repositorySchemaSHA256:digest(JSON.stringify(local)),liveSchemaSHA256:digest(JSON.stringify(live)),
 exactMatch:differences.length===0&&lineEndingOnly.length===0,sameDefinitionsAfterLineEndingNormalization:differences.length===0,
 lineEndingOnly,differences,releaseReady:false,productionMigrationAuthorized:false,
 executionNote:'The current candidate guards intentionally require exact SQL. Regenerate from the captured live schema and execute structured JSON statements, preserving literal newlines; review SQL files are not an execution source.'};
fs.writeFileSync('docs/thief/live-schema-comparison.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({exactMatch:report.exactMatch,liveObjects:live.length,repositoryObjects:local.length,differences:differences.map(r=>({name:r.name,kind:r.kind}))}));
