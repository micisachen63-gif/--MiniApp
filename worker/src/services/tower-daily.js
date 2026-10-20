import {taipeiDay,taipeiAt} from '../game/time.js';
import {GameError} from '../game/classes.js';
export const towerEntryId=(tg,now)=>`tower-entry:${tg}:${taipeiDay(now)}`;
export async function towerEntry(db,tg,now){
 const day=taipeiDay(now),from=taipeiAt(day,0),to=from+86400000;
 const receipt=await db.prepare('SELECT note FROM rpg_ledger WHERE event_id=? AND tg_id=?').bind(towerEntryId(tg,now),String(tg)).first();
 if(receipt)return {used:true,day,resetAt:to};
 // Pre-upgrade runs also count. Membership history is retained when leaving a
 // completed team, so this cannot be reset by leaving or changing the leader.
 const previous=await db.prepare("SELECT p.id FROM rpg_party_members m JOIN rpg_parties p ON p.id=m.party_id WHERE m.char_id=? AND p.kind='tower' AND COALESCE(json_extract(p.state_json,'$.combatStartedAt'),CASE WHEN json_array_length(p.state_json,'$.actors')>0 THEN p.created_at END)>=? AND COALESCE(json_extract(p.state_json,'$.combatStartedAt'),p.created_at)<? LIMIT 1").bind(String(tg),from,to).first();
 return {used:!!previous,day,resetAt:to};
}
export async function requireTowerEntry(db,tg,now){if((await towerEntry(db,tg,now)).used)throw new GameError('tower_daily','這隻角色今天已挑戰爬塔，台灣時間 00:00 後可再次出發',409);}
