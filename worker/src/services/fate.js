import {GameError} from '../game/classes.js';
import {guardStmt,outboxStmt,classifyDbError} from '../db.js';
import {taipeiDay} from '../game/time.js';
import {createLife,advanceLife,chooseLife,lifeSchedule,CHOICE_MS,addActive,isOpenTime,activeBetween} from '../../public/fate/life.js';
import {decodeResult,newSeed,randomOrbit,validBirth,zodiacFor,generatedZodiac} from '../../public/fate/model.js';
import {seedForNextLife,scenesFor,SOUL_ACHIEVEMENTS} from '../../public/fate/cycles.js';
import {natal} from '../game/fate-chart.js';
import {makeReminders} from '../game/fate-reminders.js';
import {fateEvidence} from './fate-quests.js';
import {snapshotSocialCast} from './fate-social.js';
import * as SHARED from './fate-shared.js';
const parse=(s,fallback=null)=>{try{return JSON.parse(s)}catch{return fallback}};
const owner=async(db,tg)=>{const c=await db.prepare('SELECT tg_id,account_tg_id,name FROM rpg_characters WHERE tg_id=?').bind(String(tg)).first();if(!c)throw new GameError('no_character','先建立角色，再開啟命運旅章',404);return {...c,account:String(c.account_tg_id||c.tg_id)};};
const canonical=o=>o&&typeof o==='object'?(Array.isArray(o)?o.map(canonical):Object.fromEntries(Object.keys(o).sort().filter(k=>!['requestId','selectedCharacterId','tgId'].includes(k)).map(k=>[k,canonical(o[k])]))):o;
async function fingerprint(kind,b){const a=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({kind,body:canonical(b)})));return [...new Uint8Array(a)].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function mutation(env,tg,b,now,kind,fn){
 if(typeof b.requestId!=='string'||!/^[A-Za-z0-9:_-]{6,90}$/.test(b.requestId))throw new GameError('request','需要有效的操作編號');
 const c=await owner(env.DB,tg),db=env.DB,hash=await fingerprint(kind,{...b,_character:String(tg)});
 for(let attempt=0;attempt<4;attempt++){
  const old=await db.prepare('SELECT payload_hash,result_json FROM rpg_fate_operations WHERE account_id=? AND request_id=?').bind(c.account,b.requestId).first();
  if(old){if(old.payload_hash!==hash)throw new GameError('request_changed','這個操作編號已用於不同的選擇，請更新畫面',409);return {ok:true,result:parse(old.result_json),replayed:true};}
  const {stmts=[],result={}}=await fn(c,db);stmts.push(db.prepare('INSERT INTO rpg_fate_operations(account_id,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)').bind(c.account,b.requestId,hash,JSON.stringify(result),now));
  try{await db.batch(stmts);return {ok:true,result};}catch(e){const classified=classifyDbError(e);if(attempt<3&&(classified?.code==='conflict'||/UNIQUE constraint failed: rpg_fate_/.test(String(e.message))))continue;throw classified||e;}
 }
 throw new GameError('conflict','旅章正同步中，請稍後重試',409);
}
const activeRow=(db,tg)=>db.prepare("SELECT * FROM rpg_fate_lives WHERE char_id=? AND status='active'").bind(String(tg)).first();
const activeView=(row,now)=>row?{id:row.id,rev:row.rev,draft:advanceLife(parse(row.state_json),now).draft,nextAt:row.next_at}:null;
async function progressRow(env,row,now){
 for(let attempt=0;attempt<4&&row?.status==='active';attempt++){
  const d=parse(row.state_json),memories=await SHARED.outcomes(env,row.id,now),v=advanceLife(d,now),notify=v.available&&row.notified_index<v.index;
  if(memories.length)v.draft.sharedMemories=memories;
  const next=v.available?addActive(v.slots[v.index],CHOICE_MS):v.nextAt,changed=v.completed||v.draft.answers.length!==d.answers.length||notify||row.next_at<=now||JSON.stringify(v.draft.sharedMemories)!==JSON.stringify(d.sharedMemories);
  if(!changed)return row;
  const notified=notify?v.index:row.notified_index,db=env.DB,stmts=[db.prepare('UPDATE rpg_fate_lives SET state_json=?,status=?,completed_at=?,next_at=?,code=?,notified_index=?,rev=rev+1 WHERE id=? AND rev=? AND status=\'active\'').bind(JSON.stringify(v.draft),v.completed?'complete':'active',v.completed?v.endAt:null,next,v.code,notified,row.id,row.rev),guardStmt(db)];
  if(notify&&isOpenTime(now)&&env.GROUP_CHAT_ID){const c=await owner(db,row.char_id),scene=scenesFor(d)[v.index];stmts.push(outboxStmt(db,{dedupe:`fate:${row.id}:${v.index}`,target:'group',kind:'fate_event',payload:{...(d.version===8?{country:'TW'}:{}),lifeId:row.id,charId:row.char_id,accountId:c.account,name:c.name,index:v.index,age:scene.age,title:scene.title,text:scene.text,deadline:next}},now));}
  try{await db.batch(stmts);return await db.prepare('SELECT * FROM rpg_fate_lives WHERE id=?').bind(row.id).first();}catch(e){if(classifyDbError(e)?.code!=='conflict'||attempt===3)throw e;row=await db.prepare('SELECT * FROM rpg_fate_lives WHERE id=?').bind(row.id).first();}
 }
 return row;
}
export async function sweep(env,now){
 const rows=(await env.DB.prepare("SELECT * FROM rpg_fate_lives WHERE status='active' AND next_at<=? ORDER BY next_at LIMIT 40").bind(now).all()).results||[];
 let count=0;for(const row of rows){await progressRow(env,row,now);count++;}return count;
}
export async function state(env,tg,now){
 const c=await owner(env.DB,tg),row=await progressRow(env,await activeRow(env.DB,tg),now);
 const [starts,total,last]=await env.DB.batch([
  env.DB.prepare('SELECT count FROM rpg_fate_starts WHERE account_id=? AND day=?').bind(c.account,taipeiDay(now)),
  env.DB.prepare("SELECT COUNT(*) n FROM rpg_fate_lives WHERE char_id=? AND status='complete'").bind(String(tg)),
  env.DB.prepare("SELECT id,code,started_at,completed_at,state_json FROM rpg_fate_lives WHERE char_id=? AND status='complete' ORDER BY started_at DESC LIMIT 1").bind(String(tg)),
 ]);
 const count=total.results?.[0]?.n||0;
 return {ok:true,now,heroName:c.name,active:row?.status==='active'?activeView(row,now):null,completed:count,startedToday:starts.results?.[0]?.count||0,limit:4,night:!isOpenTime(now),milestone:[...SOUL_ACHIEVEMENTS].reverse().find(m=>count>=m.at)||null,last:last.results?.[0]?{id:last.results[0].id,code:last.results[0].code,at:last.results[0].completed_at,draft:parse(last.results[0].state_json)}:null};
}
export async function me(env,tg,now){return {...await state(env,tg,now),...await history(env,tg,{},now),profile:await profileView(env,tg,false)};}
export async function history(env,tg,b,now){
 await owner(env.DB,tg);const before=Number.isSafeInteger(b.before)&&b.before>0?b.before:9007199254740991;
 const rows=(await env.DB.prepare("SELECT id,code,completed_at,state_json,started_at FROM rpg_fate_lives WHERE char_id=? AND status='complete' AND started_at<? ORDER BY started_at DESC LIMIT 11").bind(String(tg),before).all()).results||[];
 const memorials=(await env.DB.prepare('SELECT code,created_at FROM rpg_fate_memorials WHERE char_id=? ORDER BY created_at DESC LIMIT 30').bind(String(tg)).all()).results||[];
 return {ok:true,entries:rows.slice(0,10).map(r=>({id:r.id,code:r.code,at:r.completed_at,draft:parse(r.state_json)})),next:rows.length>10?rows[9].started_at:null,memorials:memorials.map(r=>({code:r.code,at:r.created_at})),now};
}
export async function start(env,tg,b,now){
 if(b.country!==undefined&&b.country!=='TW')throw new GameError('fate_country','這個出生地仍在製作中，請選擇已開放的台灣。');
 await progressRow(env,await activeRow(env.DB,tg),now);
 const response=await mutation(env,tg,b,now,'start',async(c,db)=>{
  const existing=await activeRow(db,tg);if(existing)return {result:{lifeId:existing.id,already:true}};
  if(!isOpenTime(now))throw new GameError('fate_night','星穹已入夜，06:00 再開啟下一世');
  const day=taipeiDay(now),starts=await db.prepare('SELECT count FROM rpg_fate_starts WHERE account_id=? AND day=?').bind(c.account,day).first();if(starts?.count>=4)throw new GameError('fate_limit','今天已展開四世，明天再開啟新的旅程');
  const past=(await db.prepare("SELECT code FROM rpg_fate_lives WHERE char_id=? AND status='complete' ORDER BY started_at DESC LIMIT 3").bind(String(tg)).all()).results||[];
  let zodiac=null,identityZodiac=null;if(b.mode==='birthday'){const profile=await db.prepare('SELECT birth_json FROM rpg_fate_profiles WHERE account_id=?').bind(c.account).first(),[year,month,date]=taipeiDay(now).split('-').map(Number),birth=validBirth(b.birthDate||parse(profile?.birth_json)?.date,{getFullYear:()=>year,getMonth:()=>month-1,getDate:()=>date});if(!birth)throw new GameError('birth_date','請先設定生日，或選擇交給命運');identityZodiac=zodiacFor(birth.month,birth.day);if(b.showSign!==false)zodiac=identityZodiac;}
  const orbit=randomOrbit(zodiac),seed=seedForNextLife(newSeed(),past.reverse(),8,orbit,'TW'),draft=createLife({version:8,country:'TW',orbit,zodiac,seed,startedAt:now}),id=crypto.randomUUID().replaceAll('-','');
  identityZodiac??=generatedZodiac(seed);draft.identityZodiac=identityZodiac;if(b.mode!=='birthday'&&b.showSign!==false)draft.zodiac=identityZodiac;
  const socialCast=await snapshotSocialCast(db,c.account,draft);if(socialCast)draft.socialCast=socialCast;
  return {stmts:[db.prepare('INSERT INTO rpg_fate_starts(account_id,day,count) VALUES(?,?,1) ON CONFLICT(account_id,day) DO UPDATE SET count=count+1 WHERE count<4').bind(c.account,day),guardStmt(db),db.prepare("INSERT INTO rpg_fate_lives(id,char_id,account_id,state_json,status,started_at,next_at) VALUES(?,?,?,?,'active',?,?)").bind(id,String(tg),c.account,JSON.stringify(draft),now,lifeSchedule(now,draft)[0])],result:{lifeId:id}};
 });
 // The life commits independently. A missing eligible partner or an unavailable
 // membership service must never block a two-hour life or consume another start.
 // Replaying the same start repairs an interrupted schedule via UNIQUE(life_id).
 if(b.socialInvite===true){
  const row=await env.DB.prepare("SELECT * FROM rpg_fate_lives WHERE id=? AND char_id=? AND status='active'").bind(response.result.lifeId,String(tg)).first();
  if(row){const c=await owner(env.DB,tg);try{await SHARED.schedule(env,{lifeId:row.id,charId:String(tg),accountId:c.account,name:c.name,draft:parse(row.state_json)},now);}catch{console.warn('Fate shared invitation unavailable; life continues');}}
 }
 return response;
}
export async function choose(env,tg,b,now){
 return mutation(env,tg,b,now,'choice',async(c,db)=>{
  const row=await db.prepare('SELECT * FROM rpg_fate_lives WHERE id=? AND char_id=?').bind(String(b.lifeId),String(tg)).first();if(!row||row.status!=='active')throw new GameError('fate_finished','這一世已經落款，請更新旅章',409);
  let v;try{v=chooseLife(parse(row.state_json),b.answer,now,b.index);}catch(e){throw new GameError('fate_choice',e.message,409)}
  return {stmts:[db.prepare('UPDATE rpg_fate_lives SET state_json=?,next_at=?,rev=rev+1 WHERE id=? AND char_id=? AND rev=? AND status=\'active\'').bind(JSON.stringify(v.draft),v.nextAt,row.id,String(tg),row.rev),guardStmt(db)],result:{lifeId:row.id,index:b.index,answer:b.answer}};
 });
}
export async function keep(env,tg,b,now){if(!decodeResult(b.code))throw new GameError('fate_code','這張旅人來信無法辨識');return mutation(env,tg,b,now,'keep',async(c,db)=>({stmts:[db.prepare('INSERT OR IGNORE INTO rpg_fate_memorials(char_id,code,created_at) VALUES(?,?,?)').bind(String(tg),b.code,now)],result:{saved:true,countsAsLife:false}}));}
export async function profileView(env,tg,full=true){const c=await owner(env.DB,tg),r=await env.DB.prepare('SELECT * FROM rpg_fate_profiles WHERE account_id=?').bind(c.account).first();return r?{saved:true,rev:r.rev,coverage:parse(r.chart_json)?.coverage,updatedAt:r.updated_at,...(full?{birth:parse(r.birth_json)}:{})}:{saved:false,rev:0,coverage:'inspiration'};}
export async function saveProfile(env,tg,b,now){
 if(b.consent!==true)throw new GameError('birth_consent','請先同意將出生資料儲存於自己的帳號，供每日旅箋使用');
 const chart=natal(b.birth,now);
 return mutation(env,tg,b,now,'profile-save',async(c,db)=>({stmts:[db.prepare('INSERT INTO rpg_fate_profiles(account_id,birth_json,chart_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET birth_json=excluded.birth_json,chart_json=excluded.chart_json,updated_at=excluded.updated_at,rev=rev+1').bind(c.account,JSON.stringify(chart.birth),JSON.stringify(chart),now)],result:{saved:true,coverage:chart.coverage}}));
}
export async function deleteProfile(env,tg,b,now){return mutation(env,tg,b,now,'profile-delete',async(c,db)=>({stmts:[db.prepare('DELETE FROM rpg_fate_profiles WHERE account_id=?').bind(c.account),db.prepare('DELETE FROM rpg_fate_daily WHERE account_id=?').bind(c.account)],result:{deleted:true}}));}
export async function daily(env,tg,now,retry=0){
 if(retry>=4)throw new GameError('conflict','出生檔案剛有變更，請重新開啟旅箋',409);
 const c=await owner(env.DB,tg),db=env.DB,day=taipeiDay(now),profile=await db.prepare('SELECT chart_json,rev FROM rpg_fate_profiles WHERE account_id=?').bind(c.account).first();
 let row=await db.prepare('SELECT * FROM rpg_fate_daily WHERE account_id=? AND day=?').bind(c.account,day).first();
 if(!row){const recent=(await db.prepare('SELECT notes_json FROM rpg_fate_daily WHERE account_id=? ORDER BY day DESC LIMIT 7').bind(c.account).all()).results||[],notes=makeReminders(profile?parse(profile.chart_json):null,day,recent.flatMap(r=>parse(r.notes_json,[]).map(n=>n.id)));
  // An older in-flight read must not resurrect derived birth data after erase.
  await db.prepare("INSERT OR IGNORE INTO rpg_fate_daily(account_id,day,notes_json,profile_rev,created_at) SELECT ?,?,?,?,? WHERE COALESCE((SELECT chart_json FROM rpg_fate_profiles WHERE account_id=?),'')=? AND COALESCE((SELECT rev FROM rpg_fate_profiles WHERE account_id=?),0)=?").bind(c.account,day,JSON.stringify(notes),profile?.rev||0,now,c.account,profile?.chart_json||'',c.account,profile?.rev||0).run();row=await db.prepare('SELECT * FROM rpg_fate_daily WHERE account_id=? AND day=?').bind(c.account,day).first();if(!row)return daily(env,tg,now,retry+1);}
 const evidence=await fateEvidence(env,c.account,now);
 for(let n=0;n<4;n++){const unlocks=parse(row.unlocks_json,[]),next=[...unlocks];for(const e of evidence)if(!next.some(x=>x.id===e.id)&&next.length<3)next.push(e);
  if(next.length===unlocks.length)break;
  try{await db.batch([db.prepare('UPDATE rpg_fate_daily SET unlocks_json=?,rev=rev+1 WHERE account_id=? AND day=? AND rev=?').bind(JSON.stringify(next),c.account,day,row.rev),guardStmt(db)]);row={...row,unlocks_json:JSON.stringify(next)};break;}catch(e){if(classifyDbError(e)?.code!=='conflict'||n===3)throw e;row=await db.prepare('SELECT * FROM rpg_fate_daily WHERE account_id=? AND day=?').bind(c.account,day).first();if(!row)return daily(env,tg,now,retry+1);}
 }
 const unlocks=parse(row.unlocks_json,[]),notes=parse(row.notes_json,[]);
 const liveProfile=await db.prepare('SELECT chart_json FROM rpg_fate_profiles WHERE account_id=?').bind(c.account).first();if(profile&&!liveProfile)return daily(env,tg,now,retry+1);
 return {ok:true,day,unlocked:unlocks.length,unlocks,notes:notes.map((note,index)=>index<unlocks.length?{...note,locked:false}:{topic:note.topic,locked:true}),profile:liveProfile?{saved:true,coverage:parse(liveProfile.chart_json)?.coverage}:{saved:false,coverage:'inspiration'},now};
}

export async function notification(env,b,now){
 const row=await env.DB.prepare('SELECT * FROM rpg_fate_lives WHERE id=?').bind(String(b.lifeId)).first();
 const invalid={ok:true,valid:false,night:false,pending:false,remainingMs:0};if(!row||row.status!=='active'||!Number.isInteger(b.index)||b.index<0||b.index>([7,8].includes(parse(row.state_json)?.version)?8:2))return invalid;
 const v=advanceLife(parse(row.state_json),now);if(!Number.isSafeInteger(v.slots[b.index]))return invalid;const deadline=addActive(v.slots[b.index],CHOICE_MS);
 if(v.completed||v.index!==b.index||now<v.slots[b.index]||now>=deadline)return invalid;
 const c=await owner(env.DB,row.char_id),scene=scenesFor(v.draft)[b.index];
 return {ok:true,valid:v.available,night:v.night,pending:true,remainingMs:activeBetween(now,deadline),retryAt:v.night?addActive(now,0):now,payload:{...(v.draft.version===8?{country:'TW'}:{}),lifeId:row.id,charId:row.char_id,accountId:c.account,name:c.name,index:b.index,age:scene.age,title:scene.title,text:scene.text,deadline}};
}
