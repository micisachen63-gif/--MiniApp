// Aggregate successful, authenticated Mini App use, never scheduler/polling traffic.
// Unique account/day/event avoids inflating participating-user counts on retries.
import {taipeiDay} from '../game/time.js';
export const BEHAVIOR_LABELS=Object.freeze({
 'character/delete':'刪除角色',login:'開啟選角',create:'建立角色',select:'進入角色',daily:'領取每日獎勵',
 gacha:'購買轉蛋','gacha/open':'開啟轉蛋',enhance:'強化裝備',reroll:'重鑄屬性',
 'guardian/summon':'召喚天使','guardian/fuse':'合成天使','exchange/create':'交易所掛賣',
 'exchange/buy':'交易所購買','trade/confirm':'確認交易','fate/start':'開啟輪迴',
 'fate/choice':'輪迴抉擇','party/create':'建立打寶／爬塔','party/join':'加入打寶／爬塔',
 'party/start':'開始打寶／爬塔','star-ring/create':'建立遠征','star-ring/join':'加入遠征',
 'star-ring/start':'開始遠征','boss/attack':'參加群組首領',
});
export function behaviorEvent(action,body={}){
 if(action==='behavior/visit')return 'login';
 if(action==='party/action'||action==='star-ring/action'){
  const suffix=body.action==='join-ready'?'join':body.action;
  const key=action.replace('/action','/')+suffix;return BEHAVIOR_LABELS[key]?key:null;
 }
 return BEHAVIOR_LABELS[action]?action:null;
}
export async function recordBehavior(env,account,action,body,now){
 const event=behaviorEvent(action,body);if(!event)return;
 try{await env.DB.prepare(`INSERT INTO rpg_behavior_daily(day,account_tg_id,event,first_at,last_at)
  VALUES(?,?,?,?,?) ON CONFLICT(day,account_tg_id,event) DO UPDATE SET first_at=MIN(first_at,excluded.first_at),last_at=MAX(last_at,excluded.last_at)`)
  .bind(taipeiDay(now),String(account),event,now,now).run();}
 catch{/* Analytics must never turn a committed game action into an error/retry. */}
}
