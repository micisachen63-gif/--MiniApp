import {GameError} from '../game/classes.js';

const invalid=message=>{throw new GameError('forge_receipt_input',message,400);};

/**
 * Exact, read-only ledger lookup for an already authenticated, selected character.
 * The route supplies namespace; a caller's body must never choose it.
 * Missing rows mean unconfirmed, not proof that an attempt never ran.
 */
export async function view(env,{tgId,kind,requestId,namespace='service'}={},now=Date.now()){
  if(typeof tgId!=='string'||!/^(?:\d{1,20}|c[\da-f]{32})$/i.test(tgId))invalid('角色識別無效');
  if(kind!=='enhance'&&kind!=='reroll')invalid('只支援查詢強化或洗鍊紀錄');
  if(namespace!=='app'&&namespace!=='service')invalid('操作來源無效');
  const validId=namespace==='app'?/^[A-Za-z0-9_-]{6,64}$/:/^[A-Za-z0-9_:-]{1,96}$/;
  if(typeof requestId!=='string'||!validId.test(requestId))invalid('需要有效的原操作編號');
  // Read the supplied realm binding only. The HTTP route owns account authorization.
  const db=env.DB;
  const actor=await db.prepare(`SELECT c.tg_id,a.active_char_id FROM rpg_live_characters c
    LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?`).bind(tgId).first();
  if(!actor)throw new GameError('no_character','找不到目前可用的角色',404);
  if(actor.active_char_id&&String(actor.active_char_id)!==tgId)
    throw new GameError('character_changed','角色已切換，請回到原角色核對這筆紀錄',409);

  const storedRequestId=namespace==='app'?'app:'+requestId:requestId;
  const main=kind+':'+tgId+':'+storedRequestId;
  const purchase=(kind==='enhance'?'buy-enhance-scroll':'buy-reroll-scroll')+':'+tgId+':'+storedRequestId;
  const rows=await db.prepare(`SELECT event_id,type,gold_delta,item,item_delta,note,created_at
    FROM rpg_ledger WHERE tg_id=? AND event_id IN (?,?) ORDER BY id`).bind(tgId,main,purchase).all();
  void now; // A lookup never advances idle time or alters the original receipt timestamp.
  return {ok:true,found:rows.results.some(row=>row.event_id===main),kind,requestId,
    entries:rows.results.map(row=>({type:row.type,goldDelta:row.gold_delta,item:row.item,
      itemDelta:row.item_delta,note:row.note,createdAt:row.created_at}))};
}
