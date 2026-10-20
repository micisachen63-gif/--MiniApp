import {runningRingId} from './party-presence.js';
// Read current membership even while a short party borrows the foreground slot.
// Do not call a view/action that advances either battle from the home indicator.
export async function homeActivity(db,char){
 const id=await runningRingId(db,char.tg_id);
 if(id){const row=await db.prepare("SELECT state_json FROM rpg_star_ring_runs WHERE id=? AND status='running'").bind(id).first();if(row){const s=JSON.parse(row.state_json);return {kind:'star-ring',id,name:s.name,startedAt:s.startedAt,endsAt:s.endsAt};}}
 return char.party_id?{kind:'party',id:char.party_id}:null;
}
