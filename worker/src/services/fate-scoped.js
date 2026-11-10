// F1 delegates gameplay to the original Fate authorities and original RNG.
import * as Fate from './fate.js';
import * as Gifts from './fate-gifts.js';
import { GameError } from '../game/classes.js';
import { actorContext, operation, record, receiptStatement, claimGuards, requireActiveRealm, scopedFateEnv } from './fate-receipt.js';

const envelope = (context, op, saved, replayed) => ({ ...context, kind: op.kind,
  requestId: op.requestId, signature: op.signature, result: saved.result, receipt: saved.receipt, replayed });
export async function run(env, tg, body = {}, now = Date.now(), namespace = 'service') {
  const op = operation(body.kind, body, namespace), { actor, context } = await actorContext(env, tg, now, body);
  requireActiveRealm(env);
  const before = await record(env, context, op);
  if (before.found) return envelope(context, op, before, true);
  if (!before.recoveryAllowed)
    throw new GameError('fate_receipt_unverified', '已有未完整核對的原操作，請保留原編號查詢', 409);
  const scoped = scopedFateEnv(env, actor), payload = { ...op.fields, requestId: op.request };
  let proof = null, execution;
  // These hooks are trusted function arguments, never accepted from transport.
  const options = {
    receipt: result => receiptStatement(scoped.DB, context, op, result, now, proof),
    claimGuards: facts => {
      proof = { completed: facts.completed, ownedMilestones: [...facts.ownedMilestones],
        milestones: [...facts.milestones] };
      return claimGuards(scoped.DB, context, op, proof);
    }
  };
  try {
    if (op.kind === 'start') execution = await Fate.start(scoped, tg, payload, now, options);
    else if (op.kind === 'choice') execution = await Fate.choose(scoped, tg, payload, now, options);
    else if (op.kind === 'keep') execution = await Fate.keep(scoped, tg, payload, now, options);
    else if (op.kind === 'gift-claim') execution = await Gifts.claim(scoped, tg, payload, now, options);
    // The fifth parameter remains the original secure RNG/test injection slot.
    else execution = await Gifts.open(scoped, tg, payload, now, undefined, options);
  } catch (error) {
    const { context: current } = await actorContext(env, tg, now, body), saved = await record(env, current, op);
    if (saved.found) return envelope(current, op, saved, true);
    throw error;
  }
  const { context: current } = await actorContext(env, tg, now, body), saved = await record(env, current, op);
  if (!saved.found)
    throw new GameError('fate_receipt_pending', '原操作結果尚待核對，請保留原操作編號', 409);
  return envelope(current, op, saved, execution?.replayed === true);
}
