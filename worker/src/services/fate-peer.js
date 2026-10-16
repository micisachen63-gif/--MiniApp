import {GameError} from '../game/classes.js';
import {formalEvents} from '../../public/fate/formal-events.js';
import {metricsForLife} from '../../public/fate/life-metrics-v1.js';
import {lifeTiming} from '../../public/fate/timing-v5.js';
import {activeBetween,LIFE_MS,taipeiDay} from '../../public/fate/life.js';

// Only the trusted life-completion path calls this. Never consume request-body
// metrics or a participant's birth profile, and never retroactively rewrite v1-v5.
export function snapshot(life){
 if(life?.version!==6)return null;
 if(activeBetween(life.startedAt,life.clockAt)<LIFE_MS)throw new Error('Peer summary requires a completed life');
 const age=lifeTiming(life)?.deathAge,rows=formalEvents(life,life.clockAt),metrics=metricsForLife(life,rows,age);
 const bonds=[...rows].reverse().find(row=>row.state)?.state.bonds;
 const result={version:1,wealthTwd:metrics.wealthTwd,bonds:Math.round(Math.max(0,Math.min(100,bonds))),health:metrics.health,educationIndex:metrics.education.index,children:metrics.children};
 if(Object.values(result).some(value=>!Number.isSafeInteger(value)))throw new Error('Invalid server-generated peer summary');
 return result;
}

// The partial index restricts this window operation to one completion day of v6
// lives. One latest record per other account; the requested life represents self.
export const PEER_AGGREGATE_SQL=`WITH daily AS (
 SELECT account_id,
  json_extract(state_json,'$.resultMetrics.wealthTwd') wealth,
  json_extract(state_json,'$.resultMetrics.bonds') bonds,
  ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY completed_at DESC,id DESC) ordinal
 FROM rpg_fate_lives
 WHERE status='complete' AND json_extract(state_json,'$.version')=6
  AND completed_at>=? AND completed_at<? AND completed_at<=?
  AND json_extract(state_json,'$.resultMetrics.version')=1
  AND json_type(state_json,'$.resultMetrics.wealthTwd')='integer'
  AND json_type(state_json,'$.resultMetrics.bonds')='integer'
  AND json_extract(state_json,'$.resultMetrics.bonds') BETWEEN 0 AND 100
), participants AS (
 SELECT wealth,bonds FROM daily WHERE ordinal=1 AND account_id<>?
 UNION ALL SELECT ?,?
)
SELECT COUNT(*) sampleCount,AVG(wealth) wealthAverage,AVG(bonds) bondsAverage,
 1+SUM(CASE WHEN wealth>? THEN 1 ELSE 0 END) wealthRank,
 1+SUM(CASE WHEN bonds>? THEN 1 ELSE 0 END) bondsRank FROM participants`;

export async function peers(env,tg,b,now){
 const actor=await env.DB.prepare('SELECT c.tg_id,COALESCE(c.account_tg_id,c.tg_id) account,a.active_char_id FROM rpg_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=COALESCE(c.account_tg_id,c.tg_id) WHERE c.tg_id=?').bind(String(tg)).first();
 if(!actor)throw new GameError('no_character','先建立角色，再查看同期旅人',404);
 if(actor.active_char_id&&String(actor.active_char_id)!==String(tg))throw new GameError('character_changed','角色已切換，請重新開啟旅章',409);
 const life=await env.DB.prepare("SELECT state_json,completed_at FROM rpg_fate_lives WHERE id=? AND char_id=? AND account_id=? AND status='complete' AND completed_at<=?").bind(typeof b.lifeId==='string'?b.lifeId:'',String(tg),String(actor.account),now).first();
 if(!life)throw new GameError('fate_life_not_found','找不到這位英雄已落款的旅章',404);
 const draft=JSON.parse(life.state_json),summary=draft.resultMetrics;
 if(draft.version!==6||summary?.version!==1||!Number.isSafeInteger(summary.wealthTwd)||!Number.isInteger(summary.bonds)||summary.bonds<0||summary.bonds>100)throw new GameError('fate_peers_unavailable','這一世沒有新版同期比較資料，請在下一世落款後查看',409);
 const date=taipeiDay(life.completed_at),start=Date.parse(date+'T00:00:00+08:00');
 const aggregate=await env.DB.prepare(PEER_AGGREGATE_SQL).bind(start,start+86400000,now,String(actor.account),summary.wealthTwd,summary.bonds,summary.wealthTwd,summary.bonds).first();
 const sampleCount=aggregate.sampleCount,available=sampleCount>=3;
 return {ok:true,available,sampleCount,date,label:'同期旅人',...(available?{}:{reason:'樣本尚不足；至少需要 3 位不同帳號的同期旅人落款。'}),comparison:{
  wealth:{rank:available?aggregate.wealthRank:null,average:available?aggregate.wealthAverage:null,value:summary.wealthTwd},
  bonds:{rank:available?aggregate.bondsRank:null,average:available?aggregate.bondsAverage:null,value:summary.bonds}
 }};
}
