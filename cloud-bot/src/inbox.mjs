// Sequential and bounded: speed up only while work is queued. Never replay an
// uncertain Telegram update: game receipts cannot prove a message wasn't sent.
export async function drainInbox(sql,bot,{now=Date.now,maxUpdates=16,budgetMs=5000}={}){
 const started=now();let processed=0;
 while(processed<maxUpdates&&(processed===0||now()-started<budgetMs)){
  const row=sql.exec("SELECT id,body FROM inbox WHERE status='queued' ORDER BY id LIMIT 1").toArray()[0];
  if(!row)break;
  sql.exec("UPDATE inbox SET status='running' WHERE id=? AND status='queued'",row.id);
  try{await bot.handle(JSON.parse(row.body));sql.exec("UPDATE inbox SET status='done',finished=? WHERE id=?",now(),row.id);}
  catch(e){sql.exec("UPDATE inbox SET status='uncertain',finished=?,last_error=? WHERE id=?",now(),String(e?.code||e?.name||'unknown').slice(0,100),row.id);}
  processed++;
 }
 return {processed,backlog:sql.exec("SELECT COUNT(*) AS n FROM inbox WHERE status='queued'").toArray()[0].n};
}
export function inboxSummary(sql,now=Date.now()){
 const queued=sql.exec("SELECT COUNT(*) AS n,MIN(created) AS oldest FROM inbox WHERE status='queued'").toArray()[0];
 return {queued:queued.n,oldestQueuedMs:queued.oldest==null?0:Math.max(0,now-queued.oldest),uncertain:sql.exec("SELECT COUNT(*) AS n FROM inbox WHERE status='uncertain'").toArray()[0].n};
}
export function inspectUncertain(sql,{beforeId=Number.MAX_SAFE_INTEGER,limit=20}={}){
 if(!Number.isSafeInteger(beforeId)||beforeId<0||!Number.isInteger(limit)||limit<1||limit>50)throw Error('Invalid inbox inspection range');
 return sql.exec("SELECT id,created,finished,last_error FROM inbox WHERE status='uncertain' AND id<? ORDER BY id DESC LIMIT ?",beforeId,limit).toArray().map(row=>{
  const operations=sql.exec('SELECT key,value FROM operations WHERE key LIKE ? ORDER BY key',`update:${row.id}:%`).toArray().map(item=>{
   const r=JSON.parse(item.value);return {key:item.key,path:r.path,requestId:r.requestId,status:r.status,errorCode:r.error?.code||null};
  });
  const reconciled=operations.length>0&&operations.every(r=>['done','failed'].includes(r.status));
  return {...row,operations,receiptState:reconciled?'game_results_known':'manual_verification_required',messageState:'delivery_unconfirmed'};
 });
}
export function closeUncertain(sql,{updateId,resolution,note,expectedError},now=Date.now()){
 if(!Number.isSafeInteger(updateId)||updateId<0||!['verified','abandoned'].includes(resolution)||typeof note!=='string'||note.trim().length<10||note.length>500||typeof expectedError!=='string')throw Error('請提供原始編號、錯誤識別與至少十字的人工核對紀錄。');
 const row=sql.exec('SELECT status,last_error FROM inbox WHERE id=?',updateId).toArray()[0];
 if(!row||row.status!=='uncertain'||row.last_error!==expectedError)throw Error('紀錄狀態已改變，請重新檢查。');
 sql.exec('INSERT INTO inbox_reviews(update_id,resolution,note,reviewed_at) VALUES(?,?,?,?)',updateId,resolution,note.trim(),now);
 sql.exec("UPDATE inbox SET status='reviewed',finished=? WHERE id=? AND status='uncertain'",now,updateId);
 return {ok:true,updateId,resolution,replayed:false};
}
