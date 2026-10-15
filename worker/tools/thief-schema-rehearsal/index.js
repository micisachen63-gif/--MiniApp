// Fixed, authenticated, isolated-D1 rehearsal. No arbitrary SQL and no player data responses.
import candidate from '../../../docs/thief/live-schema-candidate.json' with {type:'json'};
import source from '../../../docs/thief/live-schema-source.json' with {type:'json'};
import hostedProof from '../../../docs/thief/hosted-d1-rehearsal.json' with {type:'json'};
const catalogFilter="name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT GLOB '_thief_*' AND name<>'d1_migrations'";
const ident=s=>'"'+s.replaceAll('"','""')+'"';
const encoder=new TextEncoder();
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function schema(db){return (await db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE ${catalogFilter} ORDER BY type,name`).all()).results;}
const tables=new Set(source.objects.filter(r=>r.type==='table').map(r=>r.name));
const faults=new Set(['drop-table-leaf-first','restore-data-before-triggers','verify-all-columns-rowid-types-bytes']);
const initializer='0025_thief_empty_database.sql';
export default {
 async fetch(request,env){
  const isolated=env.MODE==='isolated-rehearsal';
  const proven=hostedProof.status==='PASS'&&hostedProof.apply.ok&&hostedProof.apply.statements===165&&hostedProof.apply.schemaSHA256===candidate.schemaSha256ExpectedAfter&&hostedProof.rollbackProofs.length===3&&hostedProof.rollbackProofs.every(p=>p.ok&&p.rolledBack&&p.schemaSHA256===candidate.schemaSha256Before);
  const production=env.MODE==='authorized-production-expansion'&&env.EXPECTED_DATABASE_ID==='bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4'&&env.AUTHORIZATION==='human-approved-thief-expansion-20261015'&&/^[a-f0-9]{40}$/.test(env.SOURCE_COMMIT||'')&&proven;
  if(request.method!=='POST'||!env.REHEARSAL_TOKEN||(!isolated&&!production))return response({ok:false},404);
  const supplied=request.headers.get('Authorization')||'';
  if(await sha(supplied)!==await sha('Bearer '+env.REHEARSAL_TOKEN))return response({ok:false},404);
  try{
   const body=await request.json(),path=new URL(request.url).pathname,db=env.DB;
   if(production&&!['/schema','/apply','/record-migration'].includes(path))return response({ok:false},404);
   if(production&&['/apply','/record-migration'].includes(path)&&body.sourceCommit!==env.SOURCE_COMMIT)return response({ok:false,reason:'wrong-reviewed-source'},409);
   if(path==='/schema'){
    const rows=await schema(db),hash=await sha(JSON.stringify(rows));
    const fk=await db.prepare('PRAGMA foreign_key_check').all(),quick=await db.prepare('PRAGMA quick_check').all();
    const tracking=production?await db.prepare('SELECT COUNT(*) AS n FROM d1_migrations WHERE name=?').bind(initializer).first():null;
    return response({ok:true,schemaSHA256:hash,objects:rows.length,tables:rows.filter(r=>r.type==='table').length,foreignKeyErrors:fk.results.length,quickCheck:quick.results.map(r=>Object.values(r)[0]),...(production?{initializerRecorded:tracking.n===1}:{})});
   }
   if(path==='/record-migration'&&production){
    if(await sha(JSON.stringify(await schema(db)))!==candidate.schemaSha256ExpectedAfter)return response({ok:false,reason:'expanded-schema-required'},409);
    // Tracking only: never execute the empty-database initializer on populated production.
    // The exact post-expansion schema guard is rechecked inside this atomic bookkeeping batch.
    await db.batch([
     candidate.statements[0].sql,
     candidate.statements.find(s=>s.phase==='verify-schema').sql,
     `INSERT INTO d1_migrations (name) SELECT '${initializer}' WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='${initializer}')`,
     'DROP TABLE "_thief_review_guard"',
    ].map(sql=>db.prepare(sql)));
    return response({ok:true,initializerRecorded:true,migration:initializer});
   }
   if(path==='/page-digest'){
    const {table,offset=0}=body;if(!tables.has(table)||!Number.isSafeInteger(offset)||offset<0)return response({ok:false},400);
    const columns=(await db.prepare(`PRAGMA table_info(${ident(table)})`).all()).results.map(c=>c.name);
    const fields=['CAST(rowid AS TEXT) AS saved_rowid',...columns.flatMap((c,i)=>[`typeof(${ident(c)}) AS t${i}`,`hex(${ident(c)}) AS b${i}`])];
    const rows=(await db.prepare(`SELECT ${fields.join(',')} FROM ${ident(table)} ORDER BY rowid LIMIT 250 OFFSET ?`).bind(offset).all()).results;
    return response({ok:true,table,offset,rows:rows.length,sha256:await sha(rows.map(r=>JSON.stringify(r)+'\n').join(''))});
   }
   if(path==='/sequence-digest'){
    const rows=(await db.prepare('SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name').all()).results;
    return response({ok:true,sha256:await sha(JSON.stringify(rows)),entries:rows.length});
   }
   if(path==='/rollback'||path==='/apply'){
    if(body.expectedBeforeSHA256!==candidate.schemaSha256Before)return response({ok:false,reason:'wrong-candidate'},409);
    const before=await sha(JSON.stringify(await schema(db)));
    if(before!==candidate.schemaSha256Before)return response({ok:false,reason:'schema-drift',schemaSHA256:before},409);
    let statements=candidate.statements.map(s=>s.sql);
    if(path==='/rollback'){
     if(!faults.has(body.phase))return response({ok:false},400);
     const at=candidate.statements.findIndex(s=>s.phase===body.phase);if(at<0)return response({ok:false},400);
     statements=statements.slice(0,at+1).concat('INSERT INTO "_thief_review_guard" (ok) VALUES(0)');
    }
    const start=Date.now();let rolledBack=false;
    try{await db.batch(statements.map(sql=>db.prepare(sql)));}
    catch(error){if(path==='/apply')return response({ok:false,reason:'atomic-batch-rejected',schemaSHA256:await sha(JSON.stringify(await schema(db)))},500);if(!/CHECK constraint failed/.test(String(error)))return response({ok:false,reason:'unexpected-rehearsal-error'},500);rolledBack=true;}
    const after=await sha(JSON.stringify(await schema(db)));
    return response({ok:after===(rolledBack?candidate.schemaSha256Before:candidate.schemaSha256ExpectedAfter),rolledBack,phase:body.phase||null,statements:statements.length,durationMs:Date.now()-start,schemaSHA256:after});
   }
   return response({ok:false},404);
  }catch(error){return response({ok:false,reason:'internal-rehearsal-error'},500);}
 }
};
