import {taipeiDay,taipeiAt} from '../game/time.js';
// Reuse authoritative battle evidence; no client-completed flags or reward claims.
export async function fateEvidence(env,account,now){
 const from=taipeiAt(taipeiDay(now),0),to=from+86400000;
 const [boss,parties]=await env.DB.batch([
  env.DB.prepare(`SELECT MIN(b.settled_at) at FROM rpg_boss_attacks a JOIN rpg_live_characters c ON c.tg_id=a.tg_id
   JOIN rpg_boss_instances b ON b.id=a.boss_id WHERE c.account_tg_id=? AND a.damage>0 AND b.status='killed'
   AND b.chat_id=? AND b.settled_at>=? AND b.settled_at<? AND a.created_at>=? AND a.created_at<?`)
   .bind(account,String(env.GROUP_CHAT_ID||''),from,to,from,to),
  env.DB.prepare(`SELECT p.kind,p.status,p.state_json,m.char_id FROM rpg_party_members m JOIN rpg_parties p ON p.id=m.party_id
   WHERE m.account_id=? AND p.updated_at>=? AND p.updated_at<? AND p.status<>'lobby'
   AND (SELECT COUNT(DISTINCT account_id) FROM rpg_party_members WHERE party_id=p.id)=3`).bind(account,from,to),
 ]);
 const found=new Map();if(boss.results?.[0]?.at)found.set('boss',boss.results[0].at);
 for(const p of parties.results||[]){let s;try{s=JSON.parse(p.state_json)}catch{continue}const actor=s.actors?.find(a=>a.id===p.char_id);if(!(actor?.manualActions>0))continue;
  if(p.kind==='dungeon'&&!s.trial&&p.status==='won'&&s.journalWonAt>=from&&s.journalWonAt<to)found.set('dungeon',Math.min(found.get('dungeon')||Infinity,s.journalWonAt));
  if(p.kind==='tower'){const floors=(s.journalFloors||[]).filter(f=>f.at>=from&&f.at<to&&f.participants?.includes(p.char_id)).sort((a,b)=>a.at-b.at);if(floors.length>=5)found.set('tower',Math.min(found.get('tower')||Infinity,floors[4].at));}
 }
 return [...found].map(([id,at])=>({id,at})).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
}
