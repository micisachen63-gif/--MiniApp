import {legacyStarRingGear,repairStarRingGear} from '../game/star-ring-gear.js';
import {runningRingId} from './party-presence.js';

// Deferred repairs participate in withPlayer's existing rev/atomic batch.
// Never edit escrow, background jobs or a foreground party's live equipment.
export async function repairOwnedStarRingGear(db,player){
 const candidates=player.equipment.filter(e=>legacyStarRingGear(e)&&!e.trade_id);if(!candidates.length)return [];
 const c=player.char;if(c.party_id&&c.party_id!==await runningRingId(db,c.tg_id))return [];
 const jobs=(await db.prepare("SELECT item_id FROM rpg_auto_enhance WHERE tg_id=? AND status IN ('running','processing') UNION SELECT item_id FROM rpg_auto_reroll WHERE tg_id=? AND status IN ('running','processing')").bind(c.tg_id,c.tg_id).all()).results||[],locked=new Set(jobs.map(r=>r.item_id)),ledger=[];
 for(const item of candidates){if(locked.has(item.id))continue;const fixed=repairStarRingGear(item,c),oldTier=item.tier;Object.assign(item,fixed);
  ledger.push({event_id:'star-ring-gear-v1:'+item.id,tg_id:String(c.tg_id),type:'星征裝備補正',item:'equip:'+item.id,note:JSON.stringify({id:item.id,fromTier:oldTier,toTier:item.tier,level:c.level,enhance:item.enhance_level})});
 }return ledger;
}
