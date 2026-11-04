import { GameError } from '../game/classes.js';
import { TOWER_OFFERS } from '../game/tower-progression.js';

const invalid = message => { throw new GameError('tower_receipt_input', message, 400); };

function validResult(result, body, row) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.op !== body.op
    || !Number.isSafeInteger(result.cost) || result.cost < 0 || row.item !== 'tower_fragment' || row.item_delta !== -result.cost) return false;
  if (body.op === 'redeem') {
    const offer = TOWER_OFFERS.find(entry => entry.id === body.offerId);
    return !!offer && result.item === offer.item && Number.isSafeInteger(result.quantity) && result.quantity > 0;
  }
  if (body.op === 'imprint') return typeof result.itemId === 'string' && result.itemId === body.itemId
    && Number.isSafeInteger(result.from) && result.from >= 0 && result.from === body.from
    && Number.isSafeInteger(result.to) && result.to === result.from + 1;
  if (result.cost !== 0) return false;
  if (!body.titleId) return result.title === null;
  return !!result.title && typeof result.title === 'object' && !Array.isArray(result.title)
    && result.title.id === body.titleId && typeof result.title.name === 'string' && result.title.name.length > 0
    && Number.isSafeInteger(result.title.floor) && result.title.floor > 0;
}

// Route-selected namespace is trusted; a body cannot change it.
// A missing row remains unconfirmed and never authorizes replaying the write.
export async function view(env, tg, body = {}, now, namespace = 'service') {
  const tgId = String(tg), requestId = body.requestId;
  if (!/^(?:\d{1,20}|c[\da-f]{32})$/i.test(tgId)) invalid('角色識別無效');
  if (namespace !== 'app' && namespace !== 'service') invalid('操作來源無效');
  const valid = namespace === 'app' ? /^[A-Za-z0-9_-]{6,64}$/ : /^[\w:-]{1,160}$/;
  if (typeof requestId !== 'string' || !valid.test(requestId)) invalid('需要有效的原操作編號');
  if (!['redeem', 'imprint', 'title'].includes(body.op)) invalid('工坊操作種類無效');
  // Exact canonical signature from tower.action, including raw types and '' vs null.
  const signature = JSON.stringify({ op: body.op, offerId: body.offerId ?? null, itemId: body.itemId ?? null, from: body.from ?? null, titleId: body.titleId ?? null });
  const db = env.DB;
  const actor = await db.prepare(
    'SELECT c.tg_id,c.account_tg_id,a.active_char_id FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?'
  ).bind(tgId).first();
  if (!actor) throw new GameError('no_character', '找不到目前可用的角色', 404);
  if (actor.active_char_id && String(actor.active_char_id) !== tgId)
    throw new GameError('character_changed', '角色已切換，請回到原角色核對這筆紀錄', 409);
  const storedRequestId = namespace === 'app' ? 'app:' + requestId : requestId;
  const row = await db.prepare(
    'SELECT type,item,item_delta,note,created_at FROM rpg_ledger WHERE event_id=? AND tg_id=?'
  ).bind('tower-action:' + tgId + ':' + storedRequestId, tgId).first();
  const context = { ok: true, now, realmId: env.REALM_CONTEXT?.id || 'permanent', accountId: String(actor.account_tg_id || tgId), characterId: tgId, requestId };
  if (!row) return { ...context, found: false, result: null, receipt: null };
  let saved;
  try { saved = JSON.parse(row.note); } catch {}
  if (!saved || typeof saved.signature !== 'string' || !saved.result || typeof saved.result !== 'object' || Array.isArray(saved.result))
    throw new GameError('tower_receipt_corrupt', '原操作紀錄目前無法核對，請保留待核對狀態', 409);
  if (saved.signature !== signature) throw new GameError('request_reused', '同一操作編號不能用於不同內容', 409);
  if (!validResult(saved.result, body, row))
    throw new GameError('tower_receipt_corrupt', '原操作結果與內容不相符，請保留待核對狀態', 409);
  return {
    ...context, found: true, result: saved.result,
    receipt: { createdAt: row.created_at, type: row.type, item: row.item, itemDelta: row.item_delta },
  };
}
