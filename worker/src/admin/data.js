import {taipeiDay} from '../game/time.js';
import {BEHAVIOR_LABELS} from './behavior.js';
import {grantCatalog} from './catalog.js';
import {GameError} from '../game/classes.js';
const DAY=86400_000;
export const dayStart=day=>Date.parse(day+'T00:00:00+08:00');
const rows=r=>r.results||[];
const safeJson=s=>{try{return JSON.parse(s||'{}');}catch{return {};}};
export const catalog=grantCatalog;
const charSelect='tg_id AS id,COALESCE(account_tg_id,tg_id) AS accountId,name,base_class AS baseClass,class_path AS classPath,level,gold,map_id AS mapId,created_at AS createdAt';
export async function players(env,b){
 const q=String(b.q||'').trim().slice(0,80),cursor=String(b.cursor||'');
 if(cursor&&!/^(?:\d{1,20}|c[0-9a-f]{32})$/i.test(cursor))throw new GameError('cursor','分頁無效');
 const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
 const result=rows(await env.DB.prepare(`SELECT ${charSelect} FROM rpg_live_characters
  WHERE (?='' OR tg_id=? OR account_tg_id=? OR name LIKE ? ESCAPE '\\') AND tg_id>? ORDER BY tg_id LIMIT 41`)
  .bind(q,q,q,pattern,cursor).all());
 return {items:result.slice(0,40),nextCursor:result.length>40?result[39].id:null};
}
export async function player(env,b,now){
 const id=String(b.id||'');
 const c=await env.DB.prepare(`SELECT ${charSelect},idle_state AS idleState,party_id AS partyId FROM rpg_live_characters AS rpg_characters WHERE tg_id=?`).bind(id).first();
 if(!c)throw new GameError('not_found','找不到角色',404);
 const result=await env.DB.batch([
  env.DB.prepare('SELECT item,quantity FROM rpg_inventory WHERE tg_id=? ORDER BY item LIMIT 250').bind(id),
  env.DB.prepare('SELECT id,type,gold_delta,item,item_delta,exp_delta,created_at FROM rpg_ledger WHERE tg_id=? ORDER BY created_at DESC,id DESC LIMIT 30').bind(id),
  env.DB.prepare('SELECT event,MIN(first_at) firstAt,MAX(last_at) lastAt,COUNT(*) activeDays FROM rpg_behavior_daily WHERE account_tg_id=? AND day>=? GROUP BY event ORDER BY activeDays DESC').bind(c.accountId,taipeiDay(now-29*DAY)),
 ]);
 return {character:c,inventory:rows(result[0]),ledger:rows(result[1]),behavior:rows(result[2]).map(x=>({...x,label:BEHAVIOR_LABELS[x.event]||x.event}))};
}
export function insights({trend,features,retention,economy,modes,segments}){
 const out=[],feature=id=>features.find(x=>x.event===id)?.users||0;
 const today=trend.at(-1);
 // Today is incomplete; compare the last fully observed day with its preceding week.
 const yesterday=trend.at(-2),previous=trend.slice(-9,-2).filter(x=>x.observed&&!x.partial),avg=previous.length?previous.reduce((s,x)=>s+x.active,0)/previous.length:0;
 if(yesterday?.observed&&avg>=5&&previous.length>=5&&yesterday.active<avg*.65)out.push({level:'attention',title:'昨日活躍明顯回落',evidence:`昨日 ${yesterday.active} 人，之前 ${previous.length} 天平均 ${avg.toFixed(1)} 人。`,action:'查看「可能流失」名單，先確認更新、登入或玩法障礙，再決定是否發回流獎勵。',target:'segments'});
 const mature=retention.filter(x=>x.d1!==null&&x.size>=5),n=mature.reduce((s,x)=>s+x.size,0),back=mature.reduce((s,x)=>s+x.d1,0);
 if(n>=10&&back/n<.3)out.push({level:'attention',title:'新玩家隔日回訪偏低',evidence:`可完整觀測的新帳號 ${n} 人，隔日回訪 ${back} 人（${Math.round(back/n*100)}%）。`,action:'優先檢查首次創角到進入玩法的引導；少量新手獎勵應搭配障礙修正。',target:'retention'});
 for(const mode of modes){const resolved=mode.complete+mode.ended;if(resolved>=5&&mode.complete/resolved<.5)out.push({level:'attention',title:mode.label+'結束後完成率偏低',evidence:`期間建立且已有結局的隊伍 ${resolved} 組：完成 ${mode.complete}、中止／失敗 ${mode.ended}；仍在進行的隊伍不納入分母。`,action:'查看該玩法的等級與隊伍詳情，區分配隊、傷害與中途退出問題。這個比例本身不能證明難度過高。',target:'teams'});}
 const inflow=economy.game?.inflow||0,outflow=economy.game?.outflow||0;
 if(inflow>=100000&&inflow>Math.max(1,outflow)*3)out.push({level:'attention',title:'遊戲獎勵產出高於回收',evidence:`排除帳本類別中的交易移轉與管理發獎後，期間入帳 ${inflow.toLocaleString('en-US')}、扣除 ${outflow.toLocaleString('en-US')} 金幣。`,action:'查看主要玩法來源與回收項目，再評估是否需要調整。跨期保管款與交易稅應另查，不直接提高價格。',target:'economy'});
 if(feature('select')>=10&&feature('party/join')+feature('party/create')===0)out.push({level:'opportunity',title:'有玩家進入，組隊入口還沒帶動參與',evidence:`${feature('select')} 個帳號進入角色，尚無打寶／爬塔建立或加入紀錄。`,action:'檢查開放等級與入口可見性；這是參與缺口，不代表玩家不喜歡組隊。',target:'features'});
 if(segments.risk>0)out.push({level:'opportunity',title:'有曾活躍的玩家值得關心',evidence:`${segments.risk} 個帳號曾有觀測紀錄，已連續至少 3 個台北日未回來。`,action:'查看名單與最後使用玩法，挑選合適對象發放回流獎勵，避免全體無差別撒幣。',target:'segments'});
 if(!out.length)out.push({level:'neutral',title:'持續累積觀測，暫無足夠異常證據',evidence:`今日已觀測 ${today?.active||0} 人；異常提示需要足夠樣本與完整日期。`,action:'先觀察參與人數、留存與玩法完成率。新上線的追蹤不會回填成虛構歷史。',target:'features'});
 return out.slice(0,6);
}
export async function dashboard(env,b,now){
 const days=[7,14,30].includes(Number(b.days))?Number(b.days):14,today=taipeiDay(now),start=dayStart(today)-(days-1)*DAY,from=taipeiDay(start);
 const result=await env.DB.batch([
  env.DB.prepare('SELECT COUNT(*) characters,COUNT(DISTINCT COALESCE(account_tg_id,tg_id)) accounts,COALESCE(SUM(gold),0) gold FROM rpg_live_characters'),
  env.DB.prepare('SELECT day,COUNT(DISTINCT account_tg_id) active FROM rpg_behavior_daily WHERE day>=? AND day<=? GROUP BY day').bind(from,today),
  env.DB.prepare(`SELECT date(MIN(created_at)/1000,'unixepoch','+8 hours') day,COALESCE(account_tg_id,tg_id) account FROM rpg_character_origins GROUP BY account HAVING MIN(created_at)>=? AND MIN(created_at)<=?`).bind(start,now),
  env.DB.prepare('SELECT event,COUNT(DISTINCT account_tg_id) users FROM rpg_behavior_daily WHERE day>=? AND day<=? GROUP BY event ORDER BY users DESC').bind(from,today),
  env.DB.prepare('SELECT base_class name,COUNT(*) count FROM rpg_live_characters GROUP BY base_class'),
  env.DB.prepare('SELECT CAST((level-1)/10 AS INTEGER)*10+1 low,COUNT(*) count FROM rpg_live_characters GROUP BY low ORDER BY low'),
  env.DB.prepare('SELECT MIN(day) day FROM rpg_behavior_daily WHERE day<=?').bind(today),
  env.DB.prepare(`SELECT type,COUNT(*) entries,COALESCE(SUM(CASE WHEN gold_delta>0 THEN gold_delta ELSE 0 END),0) inflow,COALESCE(SUM(CASE WHEN gold_delta<0 THEN -gold_delta ELSE 0 END),0) outflow FROM rpg_ledger WHERE created_at>=? AND created_at<=? GROUP BY type ORDER BY inflow+outflow DESC`).bind(start,now),
  env.DB.prepare(`WITH cohorts AS (SELECT COALESCE(account_tg_id,tg_id) account,MIN(created_at) born FROM rpg_character_origins GROUP BY account)
   SELECT date(born/1000,'unixepoch','+8 hours') day,COUNT(*) size,
   SUM(EXISTS(SELECT 1 FROM rpg_behavior_daily b WHERE b.account_tg_id=c.account AND b.day=date((c.born+86400000)/1000,'unixepoch','+8 hours'))) d1,
   SUM(EXISTS(SELECT 1 FROM rpg_behavior_daily b WHERE b.account_tg_id=c.account AND b.day=date((c.born+604800000)/1000,'unixepoch','+8 hours'))) d7
   FROM cohorts c WHERE born>=? AND born<=? GROUP BY day ORDER BY day`).bind(start,now),
  env.DB.prepare("SELECT 'short' mode,status,COUNT(*) count FROM rpg_parties WHERE created_at>=? AND created_at<=? GROUP BY status UNION ALL SELECT 'ring' mode,status,COUNT(*) count FROM rpg_star_ring_runs WHERE created_at>=? AND created_at<=? GROUP BY status").bind(start,now,start,now),
  env.DB.prepare(`SELECT COUNT(*) observed,SUM(CASE WHEN lastDay<=? THEN 1 ELSE 0 END) risk FROM (SELECT b.account_tg_id,MAX(b.day) lastDay FROM rpg_behavior_daily b WHERE b.day<=? AND EXISTS(SELECT 1 FROM rpg_live_characters c WHERE COALESCE(c.account_tg_id,c.tg_id)=b.account_tg_id) GROUP BY b.account_tg_id)`).bind(taipeiDay(now-3*DAY),today),
  env.DB.prepare('SELECT COUNT(*) count FROM rpg_behavior_daily WHERE day>=? AND day<=? AND event=?').bind(from,today,'select'),
 ]);
 const active=new Map(rows(result[1]).map(x=>[x.day,x.active])),newAccounts=new Map();
 for(const x of rows(result[2]))newAccounts.set(x.day,(newAccounts.get(x.day)||0)+1);
 const trackedSince=rows(result[6])[0]?.day||null;
 const trend=Array.from({length:days},(_,i)=>{const day=taipeiDay(start+i*DAY);return {day,active:active.get(day)||0,newAccounts:newAccounts.get(day)||0,observed:trackedSince!==null&&day>=trackedSince,partial:day===today};});
 const features=rows(result[3]).map(x=>({...x,label:BEHAVIOR_LABELS[x.event]||x.event}));
 const retention=rows(result[8]).map(x=>({...x,d1:!trackedSince||x.day<trackedSince||dayStart(x.day)+2*DAY>dayStart(today)?null:x.d1,d7:!trackedSince||x.day<trackedSince||dayStart(x.day)+8*DAY>dayStart(today)?null:x.d7}));
 const sources=rows(result[7]).map(x=>({...x,category:x.type.startsWith('交易')?'transfer':x.type.startsWith('管理')?'admin':'game'}));
 const sumMoney=items=>items.reduce((s,x)=>({inflow:s.inflow+x.inflow,outflow:s.outflow+x.outflow}),{inflow:0,outflow:0});
 const economy={sources,totals:sumMoney(sources),game:sumMoney(sources.filter(x=>x.category==='game')),admin:sumMoney(sources.filter(x=>x.category==='admin')),transfer:sumMoney(sources.filter(x=>x.category==='transfer'))};
 const modes=['short','ring'].map(mode=>{const data=rows(result[9]).filter(x=>x.mode===mode),sum=status=>data.filter(x=>status.includes(x.status)).reduce((s,x)=>s+x.count,0);return {mode,label:mode==='ring'?'星環遠征':'打寶／爬塔',total:sum(data.map(x=>x.status)),complete:sum(['complete','won','victory']),ended:sum(['ended','lost','failed','expired']),running:sum(['running','combat']),lobby:sum(['lobby'])};});
 const segments={observed:rows(result[10])[0]?.observed||0,risk:rows(result[10])[0]?.risk||0};
 return {now,days,from,today,trackedSince,totals:{...rows(result[0])[0],activeToday:active.get(today)||0,newAccounts:rows(result[2]).length},trend,features,classes:rows(result[4]),levels:rows(result[5]),retention,economy,modes,segments,insights:insights({trend,features,retention,economy,modes,segments})};
}
export async function segment(env,b,now){
 const cursor=String(b.cursor||''),kind=['risk','new','engaged'].includes(b.segment)?b.segment:'risk';
 if(cursor&&!/^\d{1,20}$/.test(cursor))throw new GameError('cursor','分頁無效');
 const condition=kind==='risk'?'lastDay<=?':kind==='new'?'born>=?':'activeDays>=?';
 const threshold=kind==='risk'?taipeiDay(now-3*DAY):kind==='new'?dayStart(taipeiDay(now))-6*DAY:7;
 const items=rows(await env.DB.prepare(`WITH activity AS(SELECT account_tg_id account,MAX(day) lastDay,COUNT(DISTINCT CASE WHEN day>=? THEN day END) activeDays FROM rpg_behavior_daily WHERE day<=? GROUP BY account),
  accounts AS(SELECT COALESCE(account_tg_id,tg_id) account,MIN(created_at) born FROM rpg_character_origins GROUP BY account),
  members AS(SELECT a.account,a.born,b.lastDay,COALESCE(b.activeDays,0) activeDays FROM accounts a LEFT JOIN activity b ON b.account=a.account)
  SELECT m.*,c.tg_id charId,c.name,c.level,c.base_class baseClass FROM members m JOIN rpg_live_characters c ON COALESCE(c.account_tg_id,c.tg_id)=m.account
  AND c.tg_id=COALESCE((SELECT owned.tg_id FROM rpg_live_characters owned JOIN rpg_accounts a ON a.active_char_id=owned.tg_id WHERE a.account_tg_id=m.account AND COALESCE(owned.account_tg_id,owned.tg_id)=m.account),(SELECT tg_id FROM rpg_live_characters AS rpg_characters WHERE COALESCE(account_tg_id,tg_id)=m.account ORDER BY char_slot LIMIT 1))
  WHERE ${condition} AND born<=? AND m.account>? ORDER BY m.account LIMIT 41`).bind(taipeiDay(now-13*DAY),taipeiDay(now),threshold,now,cursor).all());
 return {items:items.slice(0,40),nextCursor:items.length>40?items[39].account:null,segment:kind};
}
export async function teams(env){
 const result=await env.DB.batch([
  env.DB.prepare("SELECT id,leader_id,status,created_at,updated_at,expires_at,state_json FROM rpg_star_ring_runs WHERE status IN ('lobby','running') ORDER BY updated_at DESC LIMIT 30"),
  env.DB.prepare("SELECT id,leader_id,status,kind,created_at,updated_at,expires_at,state_json FROM rpg_parties WHERE status IN ('lobby','combat') ORDER BY updated_at DESC LIMIT 30"),
 ]);
 return {items:result.flatMap((r,i)=>rows(r).map(x=>{const s=safeJson(x.state_json);return {id:x.id,mode:i?'short':'ring',kind:x.kind||'遠征',status:x.status,leaderId:x.leader_id,createdAt:x.created_at,updatedAt:x.updated_at,expiresAt:x.expires_at,tier:s.tier||null};}))};
}
export async function audit(env,b){
 let cursor={at:Number.MAX_SAFE_INTEGER,id:'\uffff'};
 if(b.cursor){try{cursor=JSON.parse(b.cursor);}catch{throw new GameError('cursor','分頁無效');}}
 if(!cursor||typeof cursor!=='object'||Array.isArray(cursor)||!Number.isSafeInteger(cursor.at)||cursor.at<=0||typeof cursor.id!=='string'||cursor.id.length>200)throw new GameError('cursor','分頁無效');
 const result=rows(await env.DB.prepare('SELECT id,admin_tg_id adminId,action,details,created_at createdAt FROM rpg_admin_audit WHERE created_at<? OR (created_at=? AND id<?) ORDER BY created_at DESC,id DESC LIMIT 41').bind(cursor.at,cursor.at,cursor.id).all());
 // Compound ordering keeps same-millisecond entries available; the frontend uses the opaque cursor.
 return {items:result.slice(0,40).map(x=>({...x,details:safeJson(x.details)})),nextCursor:result.length>40?JSON.stringify({at:result[39].createdAt,id:result[39].id}):null};
}
