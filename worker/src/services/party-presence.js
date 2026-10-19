// Running expeditions own immutable snapshots. A foreground short party may
// temporarily own the shared live-character slot; lobbies cannot be borrowed.
export const runningRingSql=char=>`(SELECT r.id FROM rpg_star_ring_members rm JOIN rpg_star_ring_runs r ON r.id=rm.run_id WHERE rm.char_id=${char} AND rm.left_at IS NULL AND r.status='running' ORDER BY rm.joined_at DESC LIMIT 1)`;
export async function runningRingId(db,charId){return (await db.prepare(`SELECT ${runningRingSql('c.tg_id')} AS id FROM rpg_characters c WHERE c.tg_id=?`).bind(String(charId)).first())?.id||null;}
// Only an actual running expedition may relax equipment maintenance. Its
// immutable departure snapshot never reads these unequipped items again.
export function canEnhanceInParty(char,item,ringId){return !char.party_id||!!(ringId&&char.party_id===ringId&&Number(item.is_equipped||0)===0);}
export function borrowRunningRingStmt(db,charId){return db.prepare(`DELETE FROM rpg_party_presence WHERE char_id=? AND party_id IN (SELECT r.id FROM rpg_star_ring_members m JOIN rpg_star_ring_runs r ON r.id=m.run_id WHERE m.char_id=? AND m.left_at IS NULL AND r.status='running')`).bind(String(charId),String(charId));}
export function restoreRingPresenceStmt(db,partyId,charId=null){
 const who=charId?'m.char_id=?':'m.char_id IN (SELECT char_id FROM rpg_party_members WHERE party_id=?)';
 return db.prepare(`INSERT OR IGNORE INTO rpg_party_presence(account_id,party_id,char_id) SELECT 'ring:'||m.char_id,r.id,m.char_id FROM rpg_star_ring_members m JOIN rpg_star_ring_runs r ON r.id=m.run_id WHERE ${who} AND m.left_at IS NULL AND r.status='running'`).bind(String(charId||partyId));
}
