// Committed Star Ring evidence. Reads never advance, settle, repair or enqueue.
import { GameError } from '../game/classes.js';
import { ledgerStmt } from '../db.js';
import { CORE, SHOP, TACTICS, TIERS } from '../game/star-ring.js';
import { cosmeticById } from '../game/star-ring-cosmetics.js';
import { MAX_OPEN_MAP, SLOTS } from '../game/constants.js';

const TYPE = '星環操作收據';
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const sorted = value => Array.isArray(value) ? value.map(sorted) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const input = message => { throw new GameError('star_ring_receipt_input', message, 400); };
const corrupt = () => { throw new GameError('star_ring_receipt_corrupt', '原遠征操作目前無法完整核對，請保留待核對狀態', 409); };
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function partyIdentity(value) {
  if (typeof value !== 'string' || !/^ring:[a-f0-9]{32}$/.test(value)) input('需要有效的原遠征識別');
  return value;
}
export function characterIdentity(value) {
  if (typeof value !== 'string' || !/^(?:\d{1,20}|c[a-f0-9]{32})$/i.test(value)) input('角色識別無效');
  return value;
}

export function operation(kind, body = {}, namespace = 'service') {
  if (!plain(body) || !['app', 'service'].includes(namespace)) input('遠征操作來源無效');
  const id = body.requestId, pattern = namespace === 'app' ? /^[A-Za-z0-9_-]{8,64}$/ : /^[A-Za-z0-9_-]{8,80}$/;
  if (typeof id !== 'string' || !pattern.test(id)) input('需要有效的原操作編號');
  let fields;
  if (kind === 'create') {
    if (!Number.isInteger(body.tier) || !TIERS.some(tier => tier.id === body.tier)
      || !['normal', 'advanced'].includes(body.difficulty) || !TACTICS.some(tactic => tactic.id === body.tactic))
      input('請核對遠征等級、難度與戰術');
    fields = { tier: body.tier, difficulty: body.difficulty, tactic: body.tactic };
  } else if (kind === 'action') {
    const partyId = partyIdentity(body.partyId), action = body.action;
    if (!['join', 'join-ready', 'ready', 'start', 'tactic', 'leave'].includes(action)) input('遠征動作無效');
    if (action === 'ready' && typeof body.ready !== 'boolean') input('需要明確的準備狀態');
    if (action === 'tactic' && !TACTICS.some(tactic => tactic.id === body.tactic)) input('遠征戰術無效');
    fields = { partyId, action, ...(action === 'ready' ? { ready: body.ready } : {}),
      ...(action === 'tactic' ? { tactic: body.tactic } : {}) };
  } else if (kind === 'shop') {
    if (typeof body.offerId !== 'string' || !SHOP.some(offer => offer.id === body.offerId)) input('遠征補給品項無效');
    fields = { offerId: body.offerId };
  } else if (kind === 'cosmetic') {
    if (!has(body, 'cosmeticId') || !(body.cosmeticId === null || typeof body.cosmeticId === 'string' && cosmeticById(body.cosmeticId)))
      input('請明確選擇星紋或卸下');
    fields = { cosmeticId: body.cosmeticId };
  } else input('遠征紀錄種類無效');
  return { kind, fields, requestId: id, request: 'scene:' + namespace + ':' + id,
    signature: JSON.stringify({ kind, ...fields }) };
}

export async function actorContext(env, tg, now) {
  const characterId = characterIdentity(String(tg));
  const actor = await env.DB.prepare(
    'SELECT c.tg_id,c.account_tg_id,c.rev,a.active_char_id FROM rpg_live_characters c ' +
    'LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?'
  ).bind(characterId).first();
  if (!actor) throw new GameError('no_character', '找不到目前帳號的角色', 404);
  if (actor.active_char_id && String(actor.active_char_id) !== characterId)
    throw new GameError('character_changed', '角色已切換，請回到原角色核對這筆紀錄', 409);
  return { actor, context: { ok: true, now, realmId: env.REALM_CONTEXT?.id || 'permanent',
    accountId: String(actor.account_tg_id || characterId), characterId, revision: Number(actor.rev || 0) } };
}
export function requireActiveRealm(env) {
  if (env.REALM_CONTEXT?.phase && env.REALM_CONTEXT.phase !== 'ACTIVE')
    throw new GameError('realm_read_only', '這個世界已停止接受新操作，目前僅供查看', 409);
}

// Each original write transaction is scoped. Preliminary advance/idle transactions
// remain separate original authorities; only the final operation records its receipt.
export function scopedStarRingEnv(env, actor) {
  const db = env.DB, statements = new WeakMap(), characterId = String(actor.tg_id);
  const accountId = String(actor.account_tg_id || characterId);
  const guard = () => db.prepare(
    'INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT EXISTS (' +
    'SELECT 1 FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id ' +
    'WHERE c.tg_id=? AND c.account_tg_id=? AND (a.active_char_id IS NULL OR a.active_char_id=c.tg_id))'
  ).bind(characterId, accountId);
  async function execute(items) {
    const entries = items.map(item => {
      const entry = statements.get(item);
      if (!entry) throw new Error('star-ring scoped statement belongs to another database');
      return entry;
    });
    const writing = entries.some(entry => !entry.readOnly);
    const out = await db.batch([...(writing ? [guard()] : []), ...entries.map(entry => entry.statement)]);
    return writing ? out.slice(1) : out;
  }
  function wrap(statement, readOnly) {
    const wrapped = {
      bind(...values) { return wrap(statement.bind(...values), readOnly); },
      async all() { return (await execute([wrapped]))[0]; },
      async run() { return (await execute([wrapped]))[0]; },
      async first(column) {
        const row = (await execute([wrapped]))[0]?.results?.[0] ?? null;
        return column && row ? row[column] : row;
      },
    };
    statements.set(wrapped, { statement, readOnly }); return wrapped;
  }
  return { ...env, DB: { prepare(sql) { return wrap(db.prepare(sql), /^\s*SELECT\b/i.test(sql)); },
    batch(items) { return execute(items); } } };
}

const eventId = (tg, op) => 'star-ring-receipt:' + String(tg) + ':' + op.request;
function expectedCosts(op, result) {
  if (op.kind !== 'shop') return {};
  const offer = SHOP.find(offer => offer.id === op.fields.offerId);
  return result.alreadyOwned === true ? {} : { [offer.currency || 'star_ring_token']: offer.cost };
}
function validResult(op, result, costs, tg) {
  if (!plain(result) || !plain(costs) || !same(costs, expectedCosts(op, result))) return false;
  if (Object.values(costs).some(value => !integer(value) || value <= 0)) return false;
  if (op.kind === 'create') return typeof result.partyId === 'string' && /^ring:[a-f0-9]{32}$/.test(result.partyId)
    && same(result, { partyId: result.partyId, ...op.fields });
  if (op.kind === 'action' || op.kind === 'cosmetic') return same(result, op.fields);
  const offer = SHOP.find(offer => offer.id === op.fields.offerId);
  if (result.offerId !== offer.id || !plain(result.items) || !Array.isArray(result.equipment)) return false;
  if (offer.cosmetic) {
    const expected = { offerId: offer.id, items: {}, equipment: [], cosmetic: offer.cosmetic,
      ...(result.alreadyOwned === true ? { alreadyOwned: true } : {}) };
    return same(result, expected);
  }
  if (offer.gear) {
    if (!same(Object.keys(result).sort(), ['equipment', 'items', 'offerId'])
      || Object.keys(result.items).length || result.equipment.length !== 1) return false;
    const item = result.equipment[0];
    return plain(item) && typeof item.id === 'string' && /^ringshop:[a-f0-9-]{36}$/.test(item.id)
      && String(item.tg_id) === String(tg) && item.source === 'star_ring'
      && typeof item.name === 'string' && item.name.length > 0 && SLOTS.includes(item.slot)
      && Number.isInteger(item.tier) && item.tier >= 1 && item.tier <= MAX_OPEN_MAP;
  }
  return same(result, { offerId: offer.id, items: { [offer.item]: offer.qty }, equipment: [] });
}
export function receiptStatement(db, tg, op, result, costs, now) {
  if (!integer(now) || !validResult(op, result, costs, tg)) corrupt();
  return ledgerStmt(db, { event_id: eventId(tg, op), tg_id: String(tg), type: TYPE,
    note: JSON.stringify({ version: 1, kind: op.kind, signature: op.signature, result, costs }) }, now);
}

async function partialAuthority(db, tg, op) {
  // A missing new receipt must never turn an older/partial authority into a fresh write.
  const statements = [
    db.prepare('SELECT 1 FROM rpg_star_ring_creations WHERE char_id=? AND request_id=?').bind(String(tg), op.request),
    db.prepare('SELECT 1 FROM rpg_star_ring_operations WHERE char_id=? AND request_id=?').bind(String(tg), op.request),
    db.prepare('SELECT 1 FROM rpg_star_ring_purchases WHERE char_id=? AND request_id=?').bind(String(tg), op.request),
    db.prepare('SELECT 1 FROM rpg_star_ring_cosmetic_operations WHERE char_id=? AND request_id=?').bind(String(tg), op.request),
    db.prepare('SELECT 1 FROM rpg_ledger WHERE tg_id=? AND event_id=?').bind(String(tg), 'star-ring-shop:' + String(tg) + ':' + op.request),
  ];
  return (await db.batch(statements)).some(result => (result.results || []).length > 0);
}
async function verifyAuthority(db, tg, op, saved, row) {
  if (op.kind === 'create') {
    const original = await db.prepare('SELECT run_id,config_json,created_at FROM rpg_star_ring_creations WHERE char_id=? AND request_id=?')
      .bind(String(tg), op.request).first();
    let config; try { config = JSON.parse(original?.config_json); } catch {}
    return !!original && original.run_id === saved.result.partyId && original.created_at === row.created_at && same(config, op.fields);
  }
  if (op.kind === 'action') {
    const original = await db.prepare('SELECT operation,created_at FROM rpg_star_ring_operations WHERE run_id=? AND char_id=? AND request_id=?')
      .bind(op.fields.partyId, String(tg), op.request).first();
    return !!original && original.operation === op.fields.action && original.created_at === row.created_at;
  }
  if (op.kind === 'cosmetic') {
    const original = await db.prepare('SELECT cosmetic_id,created_at FROM rpg_star_ring_cosmetic_operations WHERE char_id=? AND request_id=?')
      .bind(String(tg), op.request).first();
    return !!original && original.cosmetic_id === op.fields.cosmeticId && original.created_at === row.created_at;
  }
  const original = await db.prepare('SELECT reward_json,created_at FROM rpg_star_ring_purchases WHERE char_id=? AND request_id=?')
    .bind(String(tg), op.request).first();
  let reward; try { reward = JSON.parse(original?.reward_json); } catch {}
  if (!original || original.created_at !== row.created_at || !same(reward, saved.result)) return false;
  const cost = await db.prepare('SELECT type,item,item_delta,gold_delta,exp_delta,created_at FROM rpg_ledger WHERE tg_id=? AND event_id=?')
    .bind(String(tg), 'star-ring-shop:' + String(tg) + ':' + op.request).first();
  if (saved.result.alreadyOwned === true) return cost === null;
  const offer = SHOP.find(offer => offer.id === op.fields.offerId), currency = offer.currency || 'star_ring_token';
  return !!cost && cost.type === (currency === CORE ? '星冕核心兌換' : '星征徽記兌換')
    && cost.item === currency && cost.item_delta === -offer.cost && cost.gold_delta === 0
    && cost.exp_delta === 0 && cost.created_at === row.created_at;
}

export async function record(env, tg, op) {
  const row = await env.DB.prepare(
    'SELECT type,item,item_delta,gold_delta,exp_delta,note,created_at FROM rpg_ledger WHERE event_id=? AND tg_id=?'
  ).bind(eventId(tg, op), String(tg)).first();
  if (!row) {
    const partial = await partialAuthority(env.DB, tg, op);
    return { found: false, result: null, receipt: null, signature: op.signature,
      recoveryAllowed: !partial && (!env.REALM_CONTEXT?.phase || env.REALM_CONTEXT.phase === 'ACTIVE'),
      ...(partial ? { unverified: true, reason: 'legacy_or_partial_authority' } : {}) };
  }
  let saved; try { saved = JSON.parse(row.note); } catch {}
  if (!plain(saved) || typeof saved.signature !== 'string') corrupt();
  if (saved.signature !== op.signature)
    throw new GameError('request_reused', '同一操作編號不能用於不同的遠征內容', 409);
  if (saved.version !== 1 || saved.kind !== op.kind || row.type !== TYPE || row.item !== null
    || row.item_delta !== 0 || row.gold_delta !== 0 || row.exp_delta !== 0 || !integer(row.created_at)
    || !validResult(op, saved.result, saved.costs, tg) || !await verifyAuthority(env.DB, tg, op, saved, row)) corrupt();
  return { found: true, signature: op.signature, result: saved.result, recoveryAllowed: false,
    receipt: { kind: op.kind, version: 1, requestId: op.requestId, createdAt: row.created_at, costs: saved.costs } };
}

export async function view(env, tg, body = {}, now, namespace = 'service') {
  const { context } = await actorContext(env, tg, now), op = operation(body.kind, body, namespace);
  return { ...context, kind: op.kind, requestId: op.requestId, ...await record(env, tg, op) };
}
