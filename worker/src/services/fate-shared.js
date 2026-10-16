import {GameError} from '../game/classes.js';
import {guardStmt,outboxStmt,classifyDbError} from '../db.js';
import {addActive,activeBetween,isOpenTime,taipeiDay,LIFE_MS} from '../../public/fate/life.js';
import {publicNickname} from '../../public/fate/social-cast.js';

const MINUTE=60000,DAY=86400000;
const STORIES={
 garden:{title:'屋頂花園的約定',text:(o,g)=>`${o}與${g}一起修好了屋頂花園。風暴將至，這一頁正等候旅人的回應。`,choices:['留下，一起照看屋頂花園','出發，把沿途的種子寄回來'],
  endings:[(o,g)=>`${g}選擇留下。你們把屋頂花園分成幾個輪值，讓風暴後的每一株嫩芽都有人照看。`,(o,g)=>`${g}帶著祝福出發。此後寄來的種子，讓你們的屋頂花園開出了遠方的顏色。`],auto:(o,g)=>`風暴過後，${o}與${g}各自留下一袋種子。沒有說出口的約定，也在屋頂花園慢慢發芽。`},
 harbor:{title:'下一班潮汐',text:(o,g)=>`${o}替${g}留了一張渡船票。潮水正漲，是同行越過海灣，還是先在港口相聚？`,choices:['搭船同行，記下彼岸的風景','留在港口，準備迎接歸來的晚餐'],
  endings:[(o,g)=>`${g}趕上了那班渡船。你們在甲板上把沿岸燈塔一座座數過，陌生的彼岸從此也有共同的記憶。`,(o,g)=>`${g}留在港口備好晚餐。${o}歸來時，風乾的外套旁已有一碗熱湯，遠行終於有了回家的方向。`],auto:(o,g)=>`潮水退去，${o}與${g}把兩張船票夾進航海簿。下一次晴天，仍有值得一起抵達的地方。`},
 lamp:{title:'星燈修好之前',text:(o,g)=>`節日前夜，${o}與${g}發現舊街的星燈熄了。只剩一份燈油，${g}會把它留在哪裡？`,choices:['點亮街口，為晚歸的人指路','帶往河岸，陪等待的人看星星'],
  endings:[(o,g)=>`${g}把燈油留在街口。${o}替燈罩擋住了風，晚歸的旅人從此記得這條始終亮著的小巷。`,(o,g)=>`${g}提燈走向河岸。${o}跟著坐下，兩人沒有急著說話，倒影中的星光已把長夜照得溫柔。`],auto:(o,g)=>`天亮前，${o}與${g}輪流守著那盞小燈。節日沒有錯過任何人，這段守候也被悄悄記住。`},
 workshop:{title:'工坊最後一張草圖',text:(o,g)=>`${o}和${g}接下一件來不及完成的委託。桌上有兩張草圖，哪一張值得共同試一回？`,choices:['修復舊物，保留原本的使用痕跡','重做新樣，試試從未用過的巧思'],
  endings:[(o,g)=>`${g}挑了修復舊物的草圖。${o}把磨損的邊角補好，兩人留住的不只是物件，還有曾被珍惜的歲月。`,(o,g)=>`${g}選了新的設計。${o}陪著反覆試作，失敗的零件排滿窗邊，第一件成品卻也因此有了只屬於你們的模樣。`],auto:(o,g)=>`收工時，${o}與${g}把兩張草圖並排收好。有些答案可以慢一點，共同動手的下午已留下了痕跡。`},
 map:{title:'地圖上沒有名字的小徑',text:(o,g)=>`${o}把一份缺角的地圖交給${g}。前方的山徑分成兩條，是探路，還是先幫人立起路標？`,choices:['一起探路，補上地圖空白','沿途立路標，讓後來的人走得安心'],
  endings:[(o,g)=>`${g}選擇走進未命名的小徑。${o}記下泉水與山脊，你們在地圖邊角畫上一朵雲，作為共同發現的記號。`,(o,g)=>`${g}停下來立起路標。${o}把字刻得清楚，後來的旅人或許不認識你們，卻都曾被這份細心照顧。`],auto:(o,g)=>`${o}與${g}在分岔口留下一張清楚的便箋。山路仍向前延伸，這份互相照應也成了地圖的一部分。`},
 book:{title:'寄給未來的一頁',text:(o,g)=>`${o}與${g}在舊書中找到一張空白信紙。若留下一頁給多年後重讀，${g}會寫下什麼？`,choices:['寫下今天的小事，珍藏此刻的生活','寫下尚未完成的願望，等未來接續'],
  endings:[(o,g)=>`${g}寫下今天的麵包香與窗外的雨。${o}補上一行謝意，平凡的一天因此成了多年後仍能翻開的溫暖。`,(o,g)=>`${g}寫下還想去的遠方。${o}在旁畫了一顆星，多年後讀起，你們才發現那張信紙早已悄悄指引旅程。`],auto:(o,g)=>`${o}與${g}各在信紙上留下一行字，再把書輕輕合起。未來的某天，這一頁會替你們記得相遇。`}
};
const storyFor=row=>STORIES[row.story_key]||STORIES.garden;
const pending=r=>r&&['scheduled','pending'].includes(r.status);
const parse=s=>JSON.parse(s);
const fail=(code,message,status=409)=>{throw new GameError(code,message,status)};
async function actor(db,tg){
 const c=await db.prepare('SELECT c.tg_id,c.name,COALESCE(c.account_tg_id,c.tg_id) account,a.active_char_id FROM rpg_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=COALESCE(c.account_tg_id,c.tg_id) WHERE c.tg_id=?').bind(String(tg)).first();
 if(!c)fail('no_character','先建立角色，再開啟旅章',404);
 if(c.active_char_id&&String(c.active_char_id)!==String(tg))fail('character_changed','角色已切換，請重新開啟旅章');
 return {...c,account:String(c.account)};
}
const pref=(db,account)=>db.prepare('SELECT * FROM rpg_fate_social_preferences WHERE account_id=?').bind(account).first();
const allowed=(p,now)=>!!(p?.enabled&&p.allow_mentions&&p.quiet_until<=now);
// Creating this private row is the owner's explicit per-life consent. Receiving
// other players' invitations remains a separate, default-off account setting.
const ownerAllowed=(p,now)=>(p?.quiet_until||0)<=now;
const prefView=(p,now)=>({enabled:!!p?.enabled,allowMentions:!!p?.allow_mentions,quietToday:(p?.quiet_until||0)>now,quietUntil:p?.quiet_until||0,rev:p?.rev||0});
const rowFor=(db,id)=>db.prepare('SELECT * FROM rpg_fate_social_choices WHERE id=?').bind(String(id||'')).first();
// Recheck DB authority inside the same transaction as invitation/answer writes.
// Membership is external; bound-character ownership and consent are local and
// must not race a deletion/reassignment after the last async eligibility read.
const authorityGuard=(db,row,now)=>db.prepare(`INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT (
 EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=? AND COALESCE(account_tg_id,tg_id)=?)
 AND EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=? AND COALESCE(account_tg_id,tg_id)=?)
 AND EXISTS(SELECT 1 FROM rpg_fate_social_preferences WHERE account_id=? AND enabled=1 AND allow_mentions=1 AND quiet_until<=?)
 AND COALESCE((SELECT quiet_until FROM rpg_fate_social_preferences WHERE account_id=?),0)<=?
 AND EXISTS(SELECT 1 FROM rpg_fate_lives WHERE id=? AND char_id=? AND account_id=? AND status='active')
 )`).bind(row.owner_char,row.owner_account,row.guest_char,row.guest_account,row.guest_account,now,row.owner_account,now,row.life_id,row.owner_char,row.owner_account);
async function memberSet(env,accounts){
 try{
  const value=typeof env.FATE_SOCIAL_MEMBERSHIP==='function'?await env.FATE_SOCIAL_MEMBERSHIP(accounts):await (async()=>{
   if(!env.SERVICE_SECRET)return null;
   const res=await fetch('https://star-journal-rpg-bot.micisachen.workers.dev/internal/fate-membership',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+env.SERVICE_SECRET},body:JSON.stringify({accountIds:accounts}),signal:AbortSignal.timeout(6000)});
   return res.ok?res.json():null;
  })();
  return new Set(value?.ok===true?accounts.filter(account=>value.members?.some(m=>String(m.accountId)===account&&m.member===true)):[]);
 }catch{return new Set()}
}
async function memberships(env,accounts){const valid=await memberSet(env,accounts);return accounts.every(account=>valid.has(account));}
async function localEligible(env,row,now){
 const [a,b,oc,gc,life]=await Promise.all([
  pref(env.DB,row.owner_account),pref(env.DB,row.guest_account),
  env.DB.prepare('SELECT c.tg_id,COALESCE(c.account_tg_id,c.tg_id) account,a.active_char_id FROM rpg_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=COALESCE(c.account_tg_id,c.tg_id) WHERE c.tg_id=?').bind(row.owner_char).first(),
  env.DB.prepare('SELECT c.tg_id,COALESCE(c.account_tg_id,c.tg_id) account,a.active_char_id FROM rpg_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=COALESCE(c.account_tg_id,c.tg_id) WHERE c.tg_id=?').bind(row.guest_char).first(),
  env.DB.prepare('SELECT status FROM rpg_fate_lives WHERE id=?').bind(row.life_id).first()
 ]);
 return ownerAllowed(a,now)&&allowed(b,now)&&oc&&gc&&String(oc.account)===row.owner_account&&String(gc.account)===row.guest_account&&life?.status==='active';
}
// An account can revoke consent or lose its bound character while Telegram is checked.
// Re-read authority after that network boundary; the final event write is CAS.
async function eligible(env,row,now){return await localEligible(env,row,now)&&await memberships(env,[row.owner_account,row.guest_account])&&await localEligible(env,row,now);}
function view(row,c,now){
 const side=c.account===row.owner_account?'owner':'guest',bound=String(c.tg_id)===(side==='owner'?row.owner_char:row.guest_char),story=storyFor(row);
 return {id:row.id,side,characterMatches:bound,ownerName:row.owner_name,guestName:row.guest_name,title:story.title,
  text:story.text(row.owner_name,row.guest_name),choices:[...story.choices],status:row.status,
  opensAt:row.opened_at,deadline:row.deadline_at,remainingMs:activeBetween(now,row.deadline_at),night:!isOpenTime(now),
  canReply:bound&&side==='guest'&&row.status==='pending'&&now>=row.opened_at&&now<row.deadline_at&&isOpenTime(now),
  canWithdraw:bound&&side==='owner'&&pending(row),answer:row.answer,source:row.source};
}
const terminalStatements=(db,row,status,answer,source,now)=>[
 db.prepare("UPDATE rpg_fate_social_choices SET status=?,answer=?,source=?,resolved_at=?,next_at=deadline_at,rev=rev+1 WHERE id=? AND rev=? AND status IN ('scheduled','pending')").bind(status,answer,source,now,row.id,row.rev),guardStmt(db),
 db.prepare('DELETE FROM rpg_fate_social_locks WHERE event_id=?').bind(row.id)
];
async function close(env,row,status,answer,source,now){
 if(!pending(row))return row;
 try{await env.DB.batch(terminalStatements(env.DB,row,status,answer,source,now));}catch(e){if(classifyDbError(e)?.code!=='conflict')throw e;}
 return rowFor(env.DB,row.id);
}
async function progress(env,row,now){
 if(!pending(row))return row;
 if(now>=row.deadline_at)return close(env,row,'auto',null,'auto',now);
 if(row.status==='scheduled'&&now>=row.opened_at){
  if(!isOpenTime(now))return row;
  if(!await eligible(env,row,now))return close(env,row,'auto',null,'unavailable',now);
  const db=env.DB,day=taipeiDay(now),stmts=[db.prepare("UPDATE rpg_fate_social_choices SET status='pending',next_at=deadline_at,rev=rev+1 WHERE id=? AND rev=? AND status='scheduled'").bind(row.id,row.rev),guardStmt(db),authorityGuard(db,row,now)];
  for(const account of [row.owner_account,row.guest_account])stmts.push(db.prepare('INSERT INTO rpg_fate_social_limits(account_id,day,mentions) VALUES(?,?,1) ON CONFLICT(account_id,day) DO UPDATE SET mentions=mentions+1 WHERE mentions<2').bind(account,day),guardStmt(db));
  if(env.GROUP_CHAT_ID)stmts.push(outboxStmt(db,{dedupe:`fate-social:${row.id}:invite`,target:'group',kind:'fate_social',payload:{eventId:row.id}},now));
  try{await db.batch(stmts);}catch(e){if(classifyDbError(e)?.code!=='conflict')throw e;const current=await rowFor(db,row.id);return current?.status==='scheduled'?close(env,current,'auto',null,'unavailable',now):current;}
  return rowFor(db,row.id);
 }
 return row;
}
export async function preferences(env,tg,now){const c=await actor(env.DB,tg);await env.DB.prepare('UPDATE rpg_fate_social_preferences SET active_at=? WHERE account_id=?').bind(now,c.account).run();return {ok:true,preferences:prefView(await pref(env.DB,c.account),now),now};}
const canonical=o=>o&&typeof o==='object'?(Array.isArray(o)?o.map(canonical):Object.fromEntries(Object.keys(o).sort().filter(k=>!['requestId','selectedCharacterId','tgId'].includes(k)).map(k=>[k,canonical(o[k])]))):o;
async function operation(env,tg,b,now,kind,fn){
 if(typeof b.requestId!=='string'||!/^[A-Za-z0-9:_-]{6,90}$/.test(b.requestId))fail('request','需要有效的操作編號',400);
 const c=await actor(env.DB,tg),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({kind,char:String(tg),body:canonical(b)}))))].map(x=>x.toString(16).padStart(2,'0')).join('');
 for(let attempt=0;attempt<4;attempt++){
  const old=await env.DB.prepare('SELECT payload_hash,result_json FROM rpg_fate_social_operations WHERE account_id=? AND request_id=?').bind(c.account,b.requestId).first();
  if(old){if(old.payload_hash!==hash)fail('request_changed','這個操作編號已用於其他選擇');return {ok:true,result:parse(old.result_json),replayed:true};}
  const {stmts,result}=await fn(c);
  try{await env.DB.batch([...stmts,env.DB.prepare('INSERT INTO rpg_fate_social_operations(account_id,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)').bind(c.account,b.requestId,hash,JSON.stringify(result),now)]);return {ok:true,result};}
  catch(e){if(attempt<3&&(classifyDbError(e)?.code==='conflict'||/UNIQUE constraint failed: rpg_fate_social_operations/.test(e.message)))continue;throw classifyDbError(e)||e;}
 }
 fail('conflict','旅章正在同步，請稍後重試');
}
export async function savePreferences(env,tg,b,now){
 if(typeof b.enabled!=='boolean'||typeof b.allowMentions!=='boolean')fail('preferences','請確認協作與群組提及設定',400);
 if((b.enabled||b.allowMentions)&&b.consent!==true)fail('consent','請先同意協作邀請與群組提及',400);
 return operation(env,tg,b,now,'preferences',async c=>{
  const db=env.DB,p=await pref(db,c.account),quiet=b.quietToday===true?Date.parse(taipeiDay(now)+'T00:00:00+08:00')+DAY:0;
  const stmts=[db.prepare('INSERT INTO rpg_fate_social_preferences(account_id,enabled,allow_mentions,quiet_until,active_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET enabled=excluded.enabled,allow_mentions=excluded.allow_mentions,quiet_until=excluded.quiet_until,active_at=excluded.active_at,updated_at=excluded.updated_at,rev=rev+1').bind(c.account,+b.enabled,+b.allowMentions,quiet,now,now)];
  if(!b.enabled||!b.allowMentions||quiet>now){
   const rows=(await db.prepare("SELECT * FROM rpg_fate_social_choices WHERE (guest_account=? OR (?=1 AND owner_account=?)) AND status IN ('scheduled','pending')").bind(c.account,quiet>now?1:0,c.account).all()).results||[];
   for(const row of rows)stmts.push(...terminalStatements(db,row,'auto',null,'unavailable',now));
  }
  return {stmts,result:{preferences:{enabled:b.enabled,allowMentions:b.allowMentions,quietToday:quiet>now,quietUntil:quiet,rev:p?p.rev+1:0}}};
 });
}
export async function schedule(env,{lifeId,charId,accountId,name,draft},now){
 const db=env.DB,account=String(accountId),already=await db.prepare('SELECT id FROM rpg_fate_social_choices WHERE life_id=?').bind(lifeId).first();if(already)return {scheduled:true};
 if(!env.GROUP_CHAT_ID||!ownerAllowed(await pref(db,account),now))return {scheduled:false};
 const c=await actor(db,charId);if(c.account!==account)return {scheduled:false};
 const life=await db.prepare("SELECT id FROM rpg_fate_lives WHERE id=? AND char_id=? AND account_id=? AND status='active'").bind(lifeId,String(charId),account).first();if(!life)return {scheduled:false};
 const rows=(await db.prepare('SELECT p.account_id,c.tg_id,c.name FROM rpg_fate_social_preferences p JOIN rpg_accounts a ON a.account_tg_id=p.account_id JOIN rpg_characters c ON c.tg_id=a.active_char_id AND COALESCE(c.account_tg_id,c.tg_id)=p.account_id LEFT JOIN rpg_fate_social_locks l ON l.account_id=p.account_id WHERE p.account_id<>? AND p.enabled=1 AND p.allow_mentions=1 AND p.quiet_until<=? AND p.active_at>=? AND l.account_id IS NULL ORDER BY p.active_at DESC,p.account_id LIMIT 12').bind(account,now,now-DAY).all()).results||[];
 const open=addActive(draft.startedAt,40*MINUTE),deadline=Math.min(addActive(open,10*MINUTE),addActive(draft.startedAt,LIFE_MS)),day=taipeiDay(open);
 if(now>=deadline)return {scheduled:false};
 const recent=(await db.prepare('SELECT story_key FROM rpg_fate_social_choices WHERE owner_account=? ORDER BY opened_at DESC LIMIT 3').bind(account).all()).results||[];
 const pool=Object.keys(STORIES).filter(k=>!recent.some(r=>r.story_key===k)),storyKey=pool[parseInt(draft.seed,16)%pool.length];
 // One bounded lookup for the owner and three candidates, rather than serial
 // network waits per candidate. The Bot endpoint accepts at most four accounts.
 const candidates=rows.slice(0,3);if(!candidates.length)return {scheduled:false};
 const validMembers=await memberSet(env,[account,...candidates.map(g=>String(g.account_id))]);
 if(!validMembers.has(account))return {scheduled:false};
 for(const guest of candidates){
  const guestAccount=String(guest.account_id),pair=[account,guestAccount].sort().join(':'),id=crypto.randomUUID().replaceAll('-','');
  const [lock,pairUsed]=await Promise.all([db.prepare('SELECT account_id FROM rpg_fate_social_locks WHERE account_id=?').bind(account).first(),db.prepare('SELECT event_id FROM rpg_fate_social_pairs WHERE pair_key=? AND day=?').bind(pair,day).first()]);if(lock)return {scheduled:false};if(pairUsed)continue;
  if(!validMembers.has(guestAccount))continue;
  try{await db.batch([
   db.prepare("INSERT INTO rpg_fate_social_choices(id,life_id,owner_account,owner_char,owner_name,guest_account,guest_char,guest_name,story_key,pair_key,day,opened_at,deadline_at,next_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'scheduled')").bind(id,lifeId,account,String(charId),publicNickname(name)||'星燈旅人',guestAccount,String(guest.tg_id),publicNickname(guest.name)||'同行旅人',storyKey,pair,day,open,deadline,open),
   db.prepare('INSERT INTO rpg_fate_social_locks(account_id,event_id) VALUES(?,?),(?,?)').bind(account,id,guestAccount,id),
   db.prepare('INSERT INTO rpg_fate_social_pairs(pair_key,day,event_id) VALUES(?,?,?)').bind(pair,day,id),
   authorityGuard(db,{owner_char:String(charId),owner_account:account,guest_char:String(guest.tg_id),guest_account:guestAccount,life_id:lifeId},now)
  ]);return {scheduled:true};}catch(e){if(classifyDbError(e)?.code==='conflict'||/UNIQUE constraint failed: rpg_fate_social_/.test(e.message))continue;throw e;}
 }
 return {scheduled:false};
}
export async function sweep(env,now){const rows=(await env.DB.prepare("SELECT * FROM rpg_fate_social_choices WHERE status IN ('scheduled','pending') AND next_at<=? ORDER BY next_at LIMIT 40").bind(now).all()).results||[];for(const row of rows)await progress(env,row,now);return rows.length;}
export async function inbox(env,tg,now){
 const c=await actor(env.DB,tg);await env.DB.prepare('UPDATE rpg_fate_social_preferences SET active_at=? WHERE account_id=?').bind(now,c.account).run();
 const rows=(await env.DB.prepare('SELECT * FROM rpg_fate_social_choices WHERE (owner_account=? OR guest_account=?) AND deadline_at>? ORDER BY opened_at DESC LIMIT 8').bind(c.account,c.account,now-DAY).all()).results||[];
 const events=[];for(const row of rows)events.push(view(await progress(env,row,now),c,now));return {ok:true,events,preferences:prefView(await pref(env.DB,c.account),now),now};
}
async function authorized(env,c,id){const row=await rowFor(env.DB,id);if(!row||![row.owner_account,row.guest_account].includes(c.account))fail('not_found','找不到這頁共同旅章',404);return row;}
export async function event(env,tg,b,now){const c=await actor(env.DB,tg),row=await progress(env,await authorized(env,c,b.eventId),now);return {ok:true,event:view(row,c,now),now};}
async function answerOperation(env,tg,b,now,kind){
 return operation(env,tg,b,now,kind,async c=>{
  let row=await progress(env,await authorized(env,c,b.eventId),now);const side=c.account===row.owner_account?'owner':'guest';
  if(String(c.tg_id)!==(side==='owner'?row.owner_char:row.guest_char))fail('character_changed','請切換回參與這頁旅章的角色');
  if(kind==='withdraw'&&side!=='owner'||kind!=='withdraw'&&side!=='guest')fail('designated_player','這個選擇需要由指定旅人回應',403);
  if(!pending(row))return {stmts:[],result:{event:view(row,c,now),settled:true}};
  if(!isOpenTime(now))fail('fate_night','旅章已入夜，06:00 再回應');
  if(kind!=='withdraw'&&(row.status!=='pending'||now<row.opened_at))fail('not_open','這一頁還未展開');
  if(kind==='reply'&&![0,1].includes(b.answer))fail('answer','請選擇一個回應',400);
  if(!await eligible(env,row,now)){row=await close(env,row,'auto',null,'unavailable',now);return {stmts:[],result:{event:view(row,c,now),settled:true}};}
  const status=kind==='reply'?'answered':kind==='decline'?'declined':'withdrawn',answer=kind==='reply'?b.answer:null,source=kind==='reply'?'manual':kind;
  return {stmts:[...terminalStatements(env.DB,row,status,answer,source,now),authorityGuard(env.DB,row,now)],result:{event:view({...row,status,answer,source},c,now)}};
 });
}
export const reply=(env,tg,b,now)=>answerOperation(env,tg,b,now,'reply');
export const decline=(env,tg,b,now)=>answerOperation(env,tg,b,now,'decline');
export const withdraw=(env,tg,b,now)=>answerOperation(env,tg,b,now,'withdraw');
export async function notification(env,b,now){
 const invalid={ok:true,valid:false,night:false,pending:false,remainingMs:0},row=await rowFor(env.DB,b.eventId);if(!row)return invalid;
 const r=await progress(env,row,now);if(r.status!=='pending'||now<r.opened_at||now>=r.deadline_at)return invalid;
 if(!isOpenTime(now))return {...invalid,night:true,pending:true,retryAt:addActive(now,0)};
 if(!await eligible(env,r,now)){await close(env,r,'auto',null,'unavailable',now);return invalid;}
 const latest=await rowFor(env.DB,r.id);if(latest?.status!=='pending'||latest.rev!==r.rev)return invalid;
 const story=storyFor(r);
 return {ok:true,valid:true,night:false,pending:true,remainingMs:activeBetween(now,r.deadline_at),payload:{eventId:r.id,ownerAccountId:r.owner_account,guestAccountId:r.guest_account,ownerName:r.owner_name,guestName:r.guest_name,title:story.title,text:story.text(r.owner_name,r.guest_name),choices:[...story.choices],deadline:r.deadline_at}};
}
export async function outcomes(env,lifeId,now){
 const row=await env.DB.prepare('SELECT * FROM rpg_fate_social_choices WHERE life_id=? AND deadline_at<=?').bind(String(lifeId),now).first();if(!row)return [];
 const r=await progress(env,row,now),story=storyFor(r),text=(r.answer===0||r.answer===1?story.endings[r.answer]:story.auto)(r.owner_name,r.guest_name);
 return [{id:'shared-'+r.story_key,at:r.deadline_at,ownerName:r.owner_name,guestName:r.guest_name,answer:r.answer,source:r.source,text}];
}
