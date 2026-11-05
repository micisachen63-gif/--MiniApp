// Scoped entry points retain the existing expedition authorities and clocks.
import * as Ring from './star-ring.js';
import * as Cosmetics from './star-ring-cosmetics.js';
import { GameError } from '../game/classes.js';
import { actorContext, operation, record, receiptStatement, requireActiveRealm, scopedStarRingEnv } from './star-ring-receipt.js';

const envelope = (context, op, saved, replayed) => ({ ...context, kind: op.kind,
  requestId: op.requestId, signature: op.signature, result: saved.result, receipt: saved.receipt, replayed });

export async function run(env, tg, kind, body = {}, now, namespace = 'service') {
  const op = operation(kind, body, namespace), { actor, context } = await actorContext(env, tg, now);
  requireActiveRealm(env);
  if (body.recipientCharId != null && String(body.recipientCharId) !== String(tg))
    throw new GameError('read_only_report', '另一角色的遠征報告僅供查看', 409);
  const before = await record(env, tg, op);
  if (before.found) return envelope(context, op, before, true);
  if (!before.recoveryAllowed)
    throw new GameError('star_ring_receipt_unverified', '已有未完整核對的原操作，請保留原編號並查詢紀錄', 409);
  const scoped = scopedStarRingEnv(env, actor), payload = { ...op.fields, requestId: op.request };
  // This function is private to the trusted service call. Nothing in body can
  // provide a receipt hook or select an account, namespace or alternate character.
  const options = { receipt: (result, costs) => receiptStatement(scoped.DB, tg, op, result, costs, now) };
  try {
    if (kind === 'create') await Ring.create(scoped, tg, payload, now, options);
    else if (kind === 'action') await Ring.action(scoped, tg, payload, now, options);
    else if (kind === 'shop') await Ring.shop(scoped, tg, payload, now, options);
    else await Cosmetics.equip(scoped, tg, payload, now, options);
  } catch (error) {
    // A failure after the final transaction may still have a complete original
    // receipt. Never rerun a purchase or regenerate random gear to recover it.
    const { context: current } = await actorContext(env, tg, now);
    const saved = await record(env, tg, op);
    if (saved.found) return envelope(current, op, saved, true);
    throw error;
  }
  const { context: current } = await actorContext(env, tg, now), saved = await record(env, tg, op);
  if (!saved.found) throw new GameError('star_ring_receipt_pending', '原操作結果尚待核對，請保留原編號', 409);
  return envelope(current, op, saved, false);
}
