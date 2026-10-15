import {GameError} from '../game/classes.js';
import {MAX_OPEN_MAP} from '../game/constants.js';
import {mapForLevel} from '../game/formulas.js';
import {taipeiDay,taipeiAt,taipeiHM} from '../game/time.js';
import {guardStmt,invDeltaStmt,ledgerStmt,bumpRevStmt,classifyDbError,outboxStmt} from '../db.js';

export const QUESTS=Object.freeze([
 {id:'checkin',name:'今日相逢',icon:'☀',goal:1,min:1,description:'在群組今日旅誌按下「今日報到」。',action:'group',button:'群組報到'},
 {id:'cheer',name:'為你喝采',icon:'✧',goal:2,min:1,description:'為兩位不同旅人的裝備分享按「超讚」。',action:'group',button:'前往群組'},
 {id:'boss',name:'並肩討伐',icon:'⚔',goal:1,min:1,description:'與另一位旅人同場討伐群組首領，造成有效傷害。',action:'boss',button:'前往討伐',combat:true},
 {id:'dungeon',name:'結伴尋寶',icon:'🗝',goal:1,min:30,description:'三人通關打寶副本，至少手動選擇一次有效戰術。',action:'dungeons',button:'組隊打寶',combat:true},
 {id:'tower',name:'向星而行',icon:'♜',goal:5,min:30,description:'同一場三人爬塔成功推進五層，並手動參戰。',action:'tower',button:'組隊爬塔',combat:true},
 {id:'share',name:'分享收穫',icon:'◇',goal:1,min:1,description:'分享一件可分享的裝備，獲另一位旅人的「超讚」。',action:'bag',button:'分享裝備'},
]);
const character=async(db,tg)=>{const c=await db.prepare('SELECT tg_id,account_tg_id,name,level FROM rpg_characters WHERE tg_id=?').bind(String(tg)).first();if(!c)throw new GameError('no_character','先建立角色，再寫下今天的旅誌',404);return c;};
const account=c=>String(c.account_tg_id||c.tg_id);
const rowFor=(db,acct,day)=>db.prepare('SELECT * FROM rpg_journals WHERE account_id=? AND day=?').bind(acct,day).first();
const tierFor=c=>Math.min(MAX_OPEN_MAP,mapForLevel(c.level));

// Indexed activity reads, only when explicitly opening/refreshing/claiming the journal.
// No timers, whole-server scans, per-hit SQL, or ordinary /me hot-path queries.
async function progress(env,c,now){
 const db=env.DB,acct=account(c),day=taipeiDay(now),from=taipeiAt(day,0),to=from+86400000,group=String(env.GROUP_CHAT_ID||'');
 const [likes,shares,boss,parties]=await db.batch([
  db.prepare(`SELECT DISTINCT COALESCE(o.account_tg_id,o.tg_id) owner FROM rpg_characters me
   JOIN rpg_share_likes l ON l.tg_id=me.tg_id JOIN rpg_shares s ON s.id=l.share_id JOIN rpg_characters o ON o.tg_id=s.tg_id
   WHERE me.account_tg_id=? AND l.created_at>=? AND l.created_at<? AND s.chat_id=? AND s.message_id IS NOT NULL
   AND COALESCE(o.account_tg_id,o.tg_id)<>? LIMIT 2`).bind(acct,from,to,group,acct),
  db.prepare(`SELECT s.id FROM rpg_characters me JOIN rpg_shares s ON s.tg_id=me.tg_id
   WHERE me.account_tg_id=? AND s.created_at>=? AND s.created_at<? AND s.kind='share'
   AND (s.context_json IS NULL OR (json_extract(s.context_json,'$.showcase')=1 AND json_extract(s.context_json,'$.source') IS NULL))
   AND s.chat_id=? AND s.message_id IS NOT NULL
   AND EXISTS(SELECT 1 FROM rpg_share_likes l JOIN rpg_characters o ON o.tg_id=l.tg_id
     WHERE l.share_id=s.id AND l.created_at>=? AND l.created_at<? AND COALESCE(o.account_tg_id,o.tg_id)<>?) LIMIT 1`).bind(acct,from,to,group,from,to,acct),
  db.prepare(`SELECT a.boss_id FROM rpg_characters me JOIN rpg_boss_attacks a ON a.tg_id=me.tg_id JOIN rpg_boss_instances b ON b.id=a.boss_id
   WHERE me.account_tg_id=? AND a.created_at>=? AND a.created_at<? AND a.damage>0 AND b.chat_id=?
   AND EXISTS(SELECT 1 FROM rpg_boss_attacks x JOIN rpg_characters o ON o.tg_id=x.tg_id
     WHERE x.boss_id=a.boss_id AND x.damage>0 AND x.created_at>=? AND x.created_at<? AND COALESCE(o.account_tg_id,o.tg_id)<>?) LIMIT 1`).bind(acct,from,to,group,from,to,acct),
  db.prepare(`SELECT p.kind,p.status,p.state_json,m.char_id FROM rpg_party_members m JOIN rpg_parties p ON p.id=m.party_id
   WHERE m.account_id=? AND p.updated_at>=? AND p.updated_at<? AND p.status<>'lobby'
   AND (SELECT COUNT(DISTINCT account_id) FROM rpg_party_members WHERE party_id=p.id)=3`).bind(acct,from,to),
 ]);
 let dungeon=0,tower=0;
 for(const p of parties.results||[]){const s=JSON.parse(p.state_json),a=s.actors?.find(x=>x.id===p.char_id);if(!(a?.manualActions>0))continue;
  if(p.kind==='dungeon'&&!s.trial&&p.status==='won'&&s.journalWonAt>=from&&s.journalWonAt<to)dungeon=1;
  if(p.kind==='tower')tower=Math.max(tower,Math.min(5,(s.journalFloors||[]).filter(step=>step.at>=from&&step.at<to&&step.participants.includes(p.char_id)).length));
 }
 return {cheer:(likes.results||[]).length,share:(shares.results||[]).length,boss:(boss.results||[]).length,dungeon,tower};
}
export async function view(env,tg,now){
 const c=await character(env.DB,tg),day=taipeiDay(now),[row,p]=await Promise.all([rowFor(env.DB,account(c),day),progress(env,c,now)]);
 const claims=JSON.parse(row?.claims_json||'{}'),count=row?.claim_count||0;
 const quests=QUESTS.map(q=>{const n=q.id==='checkin'?(row?.checked_at?1:0):p[q.id]||0,claimed=!!claims[q.id],locked=c.level<q.min&&!claimed;
  return {...q,progress:claimed?q.goal:Math.min(q.goal,n),claimed,completed:claimed||n>=q.goal,locked,claimable:!claimed&&!locked&&n>=q.goal&&count<3};});
 const combat=quests.some(q=>q.combat&&q.completed),bonusClaimed=!!row?.bonus_claimed;
 const cardRow=await env.DB.prepare('SELECT message_id FROM rpg_journal_cards WHERE day=? AND chat_id=?').bind(day,String(env.GROUP_CHAT_ID||'')).first();
 const groupUrl=cardRow?.message_id?`https://t.me/c/${String(env.GROUP_CHAT_ID).replace(/^-100/,'')}/${cardRow.message_id}`:'https://t.me/StarJournalRpgBot?start=journal';
 return {ok:true,journal:{day,groupUrl,resetAt:taipeiAt(day,0)+86400000,enrolled:!!row,tier:row?.tier||tierFor(c),recipient:row?.char_id||c.tg_id,recipientName:row?(await character(env.DB,row.char_id)).name:c.name,claimed:count,limit:3,completed:quests.filter(q=>q.completed).length,quests,bonus:{completed:count===3&&combat,claimed:bonusClaimed,claimable:count===3&&combat&&!bonusClaimed},combatCompleted:combat}};
}
export async function enroll(env,tg,now){const c=await character(env.DB,tg);await env.DB.prepare('INSERT OR IGNORE INTO rpg_journals(account_id,day,char_id,tier,created_at) VALUES(?,?,?,?,?)').bind(account(c),taipeiDay(now),c.tg_id,tierFor(c),now).run();return view(env,tg,now);}
export async function checkin(env,tg,b,now){
 const day=taipeiDay(now);if(String(b.chatId)!==String(env.GROUP_CHAT_ID)||b.day!==day)throw new GameError('journal_day','請在群組今天的旅誌卡報到');
 const card=await env.DB.prepare('SELECT message_id FROM rpg_journal_cards WHERE day=? AND chat_id=?').bind(day,String(env.GROUP_CHAT_ID)).first();
 if(!card?.message_id||Number(b.messageId)!==card.message_id)throw new GameError('journal_card','請使用群組今天的旅誌卡');
 const c=await character(env.DB,tg);await env.DB.prepare(`INSERT INTO rpg_journals(account_id,day,char_id,tier,checked_at,created_at) VALUES(?,?,?,?,?,?)
  ON CONFLICT(account_id,day) DO UPDATE SET checked_at=COALESCE(checked_at,excluded.checked_at),rev=rev+1`).bind(account(c),day,c.tg_id,tierFor(c),now,now).run();return view(env,tg,now);
}
export async function claim(env,tg,b,now){
 if(!['scroll_w','scroll_a'].includes(b.item)||(!QUESTS.some(q=>q.id===b.questId)&&b.questId!=='bonus'))throw new GameError('journal_reward','請選擇武器卷或防具卷');
 if(b.day!==taipeiDay(now))throw new GameError('journal_day','新的一天已展開，請更新今日委託');
 const c=await character(env.DB,tg),acct=account(c),day=taipeiDay(now),db=env.DB;
 for(let attempt=0;attempt<4;attempt++){
  const row=await rowFor(db,acct,day);if(!row)throw new GameError('journal_enroll','先接取今天的委託，再領取獎勵');
  const claims=JSON.parse(row.claims_json),bonus=b.questId==='bonus';
  if(bonus?row.bonus_claimed:claims[b.questId])return {...await view(env,tg,now),result:{already:true}};
  const j=(await view(env,tg,now)).journal,q=j.quests.find(q=>q.id===b.questId);
  if(!(bonus?j.bonus.claimable:q?.claimable))throw new GameError('journal_incomplete',!bonus&&row.claim_count>=3?'今天已領取三項委託獎勵':'委託尚未完成，請先更新進度');
  const next={...claims,...(!bonus?{[b.questId]:b.item}:{})};
  const stmts=[db.prepare(`UPDATE rpg_journals SET claims_json=?,claim_count=claim_count+?,bonus_claimed=?,rev=rev+1
   WHERE account_id=? AND day=? AND rev=? AND claim_count=? AND bonus_claimed=?`).bind(JSON.stringify(next),bonus?0:1,bonus?1:row.bonus_claimed,acct,day,row.rev,row.claim_count,row.bonus_claimed),guardStmt(db),
   bumpRevStmt(db,row.char_id,now),guardStmt(db),invDeltaStmt(db,row.char_id,b.item,row.tier),ledgerStmt(db,{event_id:`journal:${acct}:${day}:${b.questId}`,tg_id:row.char_id,type:bonus?'旅團同行獎勵':'旅團每日委託',item:b.item,item_delta:row.tier,note:bonus?'完成三項委託與合作戰鬥':q.name},now)];
  try{await db.batch(stmts);return {...await view(env,tg,now),result:{item:b.item,qty:row.tier,recipient:row.char_id,recipientName:j.recipientName}};}catch(e){const error=classifyDbError(e);if(['conflict','duplicate'].includes(error?.code)&&attempt<3)continue;throw error||e;}
 }
}
export async function queueCard(env,now){
 if(!env.GROUP_CHAT_ID||taipeiHM(now)<'08:00')return;
 const day=taipeiDay(now),db=env.DB;
 // Existing cron; a keyed existence read avoids an UPSERT write every minute.
 if(await db.prepare('SELECT 1 FROM rpg_journal_cards WHERE day=?').bind(day).first())return;
 await db.batch([db.prepare('INSERT OR IGNORE INTO rpg_journal_cards(day,chat_id) VALUES(?,?)').bind(day,String(env.GROUP_CHAT_ID)),outboxStmt(db,{dedupe:`journal:${day}`,target:'group',kind:'journal_card',payload:{day}},now)]);
}
export async function card(env,b){const row=await env.DB.prepare('SELECT * FROM rpg_journal_cards WHERE day=?').bind(String(b.day)).first();return {ok:true,card:row};}
export async function setCard(env,b){
 if(String(b.chatId)!==String(env.GROUP_CHAT_ID)||!Number.isSafeInteger(Number(b.messageId))||Number(b.messageId)<1)throw new GameError('journal_card','旅誌卡資料無效');
 await env.DB.prepare('UPDATE rpg_journal_cards SET message_id=? WHERE day=? AND chat_id=? AND (message_id IS NULL OR message_id=?)').bind(Number(b.messageId),String(b.day),String(b.chatId),Number(b.messageId)).run();return {ok:true};
}
