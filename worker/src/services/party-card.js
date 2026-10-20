// Notification identity is separate from immutable battles and reward receipts.
export async function cardRecord(db, party) {
 const state = typeof party.state_json === 'string' ? JSON.parse(party.state_json) : party.state;
 const rootId = state.cardRootId || party.id;
 const root = rootId === party.id ? {...party, state} : await db.prepare('SELECT id,state_json,chat_id,message_id FROM rpg_parties WHERE id=?').bind(rootId).first();
 const rootState = root.state || JSON.parse(root.state_json);
 return {rootId, latestId: rootState.cardLatestId || rootId, run: Math.max(1, Number(state.cardRun) || 1), chatId: root.chat_id, messageId: root.message_id};
}

export async function repeatCard(db, party, nextId, stmts) {
 const card = await cardRecord(db, party);
 if (card.rootId === party.id) {
  party.state.cardRootId = card.rootId;
  party.state.cardRun = card.run;
  party.state.cardLatestId = nextId;
 } else {
  stmts.push(db.prepare("UPDATE rpg_parties SET state_json=json_set(state_json,'$.cardLatestId',?),rev=rev+1 WHERE id=?").bind(nextId, card.rootId));
 }
 return {cardRootId: card.rootId, cardRun: card.run + 1};
}
