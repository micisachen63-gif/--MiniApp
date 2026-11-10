// Fate F1 immutable evidence and captured-actor guards. Reads never advance a life.
import { GameError } from '../game/classes.js';
import { ledgerStmt } from '../db.js';
import { COUNTRY_METADATA_V9 } from '../../public/fate/country-runtime-v9.js';
import { GIFT_ITEM, GIFT_NAME, GIFT_INTERVAL, GIFT_POOL } from './fate-gifts.js';

export const RECEIPT_TYPE = '命運場景操作收據';
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const stable = value => Array.isArray(value) ? value.map(stable) : plain(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const keys = (value, expected) => plain(value) && same(Object.keys(value).sort(), [...expected].sort());
const input = message => { throw new GameError('fate_scene_input', message, 400); };
const corrupt = () => { throw new GameError('fate_receipt_corrupt', '原命運操作目前無法完整核對，請保留原操作編號', 409); };
const parse = value => { try { return JSON.parse(value); } catch { return corrupt(); } };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
const requireId = value => { if (!identifier(value)) input('旅章或星輝匣識別無效'); return value; };
export const hashJSON = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(JSON.stringify(value))))).map(n => n.toString(16).padStart(2, '0')).join('');

export function operation(kind, body = {}, namespace = 'service') {
  if (!plain(body) || !['app', 'service'].includes(namespace) || typeof body.requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,64}$/.test(body.requestId)) input('需要有效的原操作編號');
  // F1 never accepts birth/profile data, even as an unused transport extra.
  if (['birthDate', 'birth', 'profile', 'profileRevision'].some(key => has(body, key)))
    input('這個入口僅提供隨機人生；出生檔案請使用原設定入口');
  let fields;
  if (kind === 'start') {
    if (body.mode !== 'random' || typeof body.showSign !== 'boolean' || body.socialInvite !== false ||
        (body.country !== 'TW' && !Object.hasOwn(COUNTRY_METADATA_V9, body.country)))
      input('請明確選擇出生地、星座顯示與隨機人生設定');
    fields = { mode: 'random', country: body.country, showSign: body.showSign, socialInvite: false };
  } else if (kind === 'choice') {
    if (!integer(body.index) || ![0, 1].includes(body.answer)) input('請保留原人生的選擇頁與答案');
    // The original versioned chooseLife decides the actual index/time bounds.
    fields = { lifeId: requireId(body.lifeId), index: body.index, answer: body.answer };
  } else if (kind === 'keep') {
    if (typeof body.code !== 'string' || !body.code || body.code.length > 512 || /[\u0000-\u001f]/.test(body.code))
      input('請保留完整的原旅章結果');
    fields = { code: body.code };
  } else if (kind === 'gift-claim') {
    const milestones = body.expectedMilestones;
    if (!Array.isArray(milestones) || milestones.length > 25 || milestones.some((n, i) =>
        !integer(n) || n < GIFT_INTERVAL || n % GIFT_INTERVAL || i > 0 && n <= milestones[i - 1]))
      input('請核對這次完整的四世禮盒里程碑');
    fields = { expectedMilestones: [...milestones] };
  } else if (kind === 'gift-open') fields = { giftId: requireId(body.giftId) };
  else input('命運操作種類無效');
  return { kind, fields, requestId: body.requestId, request: 'scene:' + namespace + ':' + body.requestId,
    signature: JSON.stringify({ kind, ...fields }) };
}

export async function actorContext(env, tg, now, body = null) {
  const characterId = String(tg), realmId = env.REALM_CONTEXT?.id || 'permanent';
  if (!/^(?:\d{1,20}|c[a-f0-9]{32})$/i.test(characterId)) input('角色識別無效');
  if (body && (body.realmId !== realmId || body.selectedCharacterId !== characterId))
    throw new GameError(body.realmId !== realmId ? 'realm_mismatch' : 'character_changed',
      '遊戲環境或目前角色已變更，請回到原角色核對', 409);
  const actor = await env.DB.prepare('SELECT c.tg_id,c.account_tg_id,c.name,c.rev,a.active_char_id FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?')
    .bind(characterId).first();
  if (!actor) throw new GameError('no_character', '找不到目前帳號的角色', 404);
  if (actor.active_char_id && String(actor.active_char_id) !== characterId)
    throw new GameError('character_changed', '角色已切換，請回到原角色核對這筆紀錄', 409);
  return { actor, context: { ok: true, now, realmId, accountId: String(actor.account_tg_id || characterId),
    characterId, revision: Number(actor.rev || 0) } };
}
export function requireActiveRealm(env) {
  if (env.REALM_CONTEXT?.phase && env.REALM_CONTEXT.phase !== 'ACTIVE')
    throw new GameError('realm_read_only', '這個世界目前僅供查看', 409);
}
export function scopedFateEnv(env, actor) {
  const db = env.DB, statements = new WeakMap(), characterId = String(actor.tg_id),
    accountId = String(actor.account_tg_id || characterId);
  const guard = () => db.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=? AND COALESCE(c.account_tg_id,c.tg_id)=? AND (a.active_char_id IS NULL OR a.active_char_id=c.tg_id))')
    .bind(characterId, accountId);
  async function execute(items) {
    const entries = items.map(item => {
      const entry = statements.get(item);
      if (!entry) throw new Error('Fate scoped statement belongs to another database');
      return entry;
    });
    const writing = entries.some(entry => !entry.readOnly);
    // The underlying realm DB keeps its phase/fence guard. This adds an actor
    // guard to every original transaction, including preflight/social writes.
    const result = await db.batch([...(writing ? [guard()] : []), ...entries.map(entry => entry.statement)]);
    return writing ? result.slice(1) : result;
  }
  function wrap(statement, readOnly) {
    const wrapped = {
      bind(...values) { return wrap(statement.bind(...values), readOnly); },
      async all() { return (await execute([wrapped]))[0]; },
      async run() { return (await execute([wrapped]))[0]; },
      async first(column) {
        const row = (await execute([wrapped]))[0]?.results?.[0] ?? null;
        return column && row ? row[column] : row;
      }
    };
    statements.set(wrapped, { statement, readOnly }); return wrapped;
  }
  return { ...env, DB: { prepare(sql) { return wrap(db.prepare(sql), /^\s*SELECT\b/i.test(sql)); }, batch: execute } };
}

const scopeOf = context => ({ realmId: context.realmId, accountId: context.accountId, characterId: context.characterId });
const eventId = (context, op) => 'fate-scene-receipt:' + context.characterId + ':' + op.request;
const costsFor = (op, result) => op.kind === 'gift-open' ? { [GIFT_ITEM]: 1 } :
  op.kind === 'start' ? { dailyStarts: result.already === true ? 0 : 1 } : {};
export function receiptStatement(db, context, op, result, now, proof = null) {
  return ledgerStmt(db, { event_id: eventId(context, op), tg_id: context.characterId, type: RECEIPT_TYPE,
    note: JSON.stringify({ version: 1, kind: op.kind, signature: op.signature, scope: scopeOf(context),
      createdAt: now, result, proof, costs: costsFor(op, result) }) }, now);
}
export function claimGuards(db, context, op, facts) {
  if (!same(facts.milestones, op.fields.expectedMilestones))
    throw new GameError('fate_claim_changed', '可領取里程碑已更新，請保留原紀錄並重新核對', 409);
  // Snapshot the original authority used to select this exact batch. Completion
  // and ownership can change without a player revision, so guard them in SQL.
  return [db.prepare("INSERT INTO rpg_guard(ok) SELECT NULL WHERE (SELECT COUNT(*) FROM rpg_fate_lives WHERE char_id=? AND status='complete')<>? OR COALESCE((SELECT json_group_array(milestone) FROM (SELECT milestone FROM rpg_fate_gifts WHERE char_id=? ORDER BY milestone)),'[]')<>?")
    .bind(context.characterId, facts.completed, context.characterId, JSON.stringify(facts.ownedMilestones))];
}

const originalCanonical = value => value && typeof value === 'object' ? (Array.isArray(value) ?
  value.map(originalCanonical) : Object.fromEntries(Object.keys(value).sort()
    .filter(key => !['requestId', 'selectedCharacterId', 'tgId'].includes(key)).map(key => [key, originalCanonical(value[key])]))) : value;
const familyOf = op => op.kind.startsWith('gift-') ? 'gift' : 'life';
const originalKind = op => op.kind === 'gift-claim' ? 'claim' : op.kind === 'gift-open' ? 'open' : op.kind;
async function originalHash(context, op) {
  const body = { ...op.fields, requestId: op.request };
  return familyOf(op) === 'gift' ?
    hashJSON({ kind: originalKind(op), char: context.characterId, body: originalCanonical(body) }) :
    hashJSON({ kind: originalKind(op), body: originalCanonical({ ...body, _character: context.characterId }) });
}
const ledger = (db, id) => db.prepare('SELECT * FROM rpg_ledger WHERE event_id=?').bind(id).first();
function ledgerMatches(row, { tg, type, at, item = null, delta = 0, note }) {
  return !!row && String(row.tg_id) === tg && row.type === type && row.created_at === at &&
    row.gold_delta === 0 && row.item === item && row.item_delta === delta && row.exp_delta === 0 &&
    (note === undefined || row.note === note);
}
async function originalOperation(db, context, op, result, at) {
  const family = familyOf(op), table = family === 'gift' ? 'rpg_fate_gift_operations' : 'rpg_fate_operations';
  const row = await db.prepare('SELECT account_id,request_id,payload_hash,result_json,created_at FROM ' + table + ' WHERE account_id=? AND request_id=?')
    .bind(context.accountId, op.request).first();
  if (!row || row.account_id !== context.accountId || row.request_id !== op.request || row.created_at !== at ||
      row.payload_hash !== await originalHash(context, op) || !same(parse(row.result_json), result)) corrupt();
  return { family: family === 'gift' ? 'gift-operations' : 'life-operations', requestKey: op.request };
}
async function verifyLife(db, context, op, result, at) {
  if (op.kind === 'start') {
    if (!(keys(result, ['lifeId']) || keys(result, ['lifeId', 'already']) && result.already === true) ||
        !identifier(result.lifeId)) corrupt();
    const row = await db.prepare('SELECT char_id,account_id,started_at FROM rpg_fate_lives WHERE id=?').bind(result.lifeId).first();
    if (!row || row.char_id !== context.characterId || row.account_id !== context.accountId ||
        (result.already === true ? row.started_at > at : row.started_at !== at)) corrupt();
  } else if (op.kind === 'choice') {
    if (!keys(result, ['lifeId', 'index', 'answer']) || !same(result, op.fields)) corrupt();
    const row = await db.prepare('SELECT char_id,account_id FROM rpg_fate_lives WHERE id=?').bind(result.lifeId).first();
    if (!row || row.char_id !== context.characterId || row.account_id !== context.accountId) corrupt();
  } else {
    if (!keys(result, ['saved', 'countsAsLife']) || result.saved !== true || result.countsAsLife !== false) corrupt();
    const row = await db.prepare('SELECT created_at FROM rpg_fate_memorials WHERE char_id=? AND code=?').bind(context.characterId, op.fields.code).first();
    if (!row || !integer(row.created_at) || row.created_at > at) corrupt();
  }
}
async function verifyClaim(db, context, op, result, proof, at) {
  if (!keys(result, ['claimed', 'giftIds', 'remaining']) || !integer(result.claimed) || !integer(result.remaining) ||
      result.claimed > 25 || !Array.isArray(result.giftIds) || result.giftIds.length !== result.claimed ||
      new Set(result.giftIds).size !== result.claimed || result.giftIds.some(id => !identifier(id)) ||
      !keys(proof, ['completed', 'ownedMilestones', 'milestones']) || !integer(proof.completed) ||
      !Array.isArray(proof.ownedMilestones) || proof.ownedMilestones.some((n, i) =>
        !integer(n) || n < GIFT_INTERVAL || n % GIFT_INTERVAL || i > 0 && n <= proof.ownedMilestones[i - 1]) ||
      !same(proof.milestones, op.fields.expectedMilestones) || result.claimed !== proof.milestones.length) corrupt();
  const eligible = Math.floor(proof.completed / GIFT_INTERVAL), seen = new Set(proof.ownedMilestones), expected = [];
  for (let n = 1; n <= eligible && expected.length < 25; n++) if (!seen.has(n * GIFT_INTERVAL)) expected.push(n * GIFT_INTERVAL);
  if (!same(expected, proof.milestones) || result.remaining !== (result.claimed ?
      Math.max(0, eligible - proof.ownedMilestones.length - result.claimed) : 0)) corrupt();
  for (let i = 0; i < result.giftIds.length; i++) {
    const id = result.giftIds[i], row = await db.prepare('SELECT char_id,milestone,status,created_at FROM rpg_fate_gifts WHERE id=?').bind(id).first();
    if (!row || row.char_id !== context.characterId || row.milestone !== proof.milestones[i] ||
        !['claimed', 'opened'].includes(row.status) || row.created_at !== at) corrupt();
    if (!ledgerMatches(await ledger(db, 'fate-gift:claim:' + id), { tg: context.characterId, type: '輪迴贈禮',
      item: GIFT_ITEM, delta: 1, at, note: '正式完成 ' + row.milestone + ' 世 · ' + GIFT_NAME })) corrupt();
  }
}
async function verifyOpen(db, context, op, result, at) {
  if (!keys(result, ['giftId', 'milestone', 'reward', 'items']) || result.giftId !== op.fields.giftId ||
      !integer(result.milestone) || result.milestone < GIFT_INTERVAL || result.milestone % GIFT_INTERVAL) corrupt();
  const pool = GIFT_POOL.find(entry => entry.id === result.reward);
  if (!pool || !same(result.items, pool.items)) corrupt();
  const row = await db.prepare('SELECT char_id,milestone,status,rewards_json,opened_at FROM rpg_fate_gifts WHERE id=?').bind(result.giftId).first();
  if (!row || row.char_id !== context.characterId || row.milestone !== result.milestone ||
      row.status !== 'opened' || row.opened_at !== at || !same(parse(row.rewards_json), result.items)) corrupt();
  if (!ledgerMatches(await ledger(db, 'fate-gift:consume:' + result.giftId), { tg: context.characterId,
    type: '開啟輪迴禮', item: GIFT_ITEM, delta: -1, at, note: GIFT_NAME })) corrupt();
  for (const [item, quantity] of Object.entries(result.items))
    if (!ledgerMatches(await ledger(db, 'fate-gift:open:' + result.giftId + ':' + item),
      { tg: context.characterId, type: '星輝匣獎勵', item, delta: quantity, at, note: GIFT_NAME })) corrupt();
}
async function partialAuthority(db, context, op) {
  for (const table of ['rpg_fate_operations', 'rpg_fate_gift_operations']) {
    if (await db.prepare('SELECT 1 FROM ' + table + ' WHERE account_id=? AND request_id=?')
      .bind(context.accountId, op.request).first()) return true;
  }
  return false;
}
export async function record(env, context, op) {
  const row = await ledger(env.DB, eventId(context, op));
  if (!row) return { found: false, result: null, receipt: null,
    recoveryAllowed: (!env.REALM_CONTEXT?.phase || env.REALM_CONTEXT.phase === 'ACTIVE') &&
      !await partialAuthority(env.DB, context, op) };
  const saved = parse(row.note);
  if (!plain(saved) || saved.version !== 1 || !integer(saved.createdAt) || !plain(saved.result) ||
      !same(saved.scope, scopeOf(context)) || !ledgerMatches(row,
      { tg: context.characterId, type: RECEIPT_TYPE, at: saved.createdAt })) corrupt();
  if (saved.kind !== op.kind || saved.signature !== op.signature)
    throw new GameError('request_reused', '同一操作編號不可更換內容，請保留原始確認資料', 409);
  const authority = await originalOperation(env.DB, context, op, saved.result, saved.createdAt);
  if (familyOf(op) === 'life') {
    if (saved.proof !== null) corrupt();
    await verifyLife(env.DB, context, op, saved.result, saved.createdAt);
  } else if (op.kind === 'gift-claim') await verifyClaim(env.DB, context, op, saved.result, saved.proof, saved.createdAt);
  else {
    if (saved.proof !== null) corrupt();
    await verifyOpen(env.DB, context, op, saved.result, saved.createdAt);
  }
  const costs = costsFor(op, saved.result);
  if (!same(saved.costs, costs)) corrupt();
  return { found: true, result: saved.result, recoveryAllowed: false,
    receipt: { version: 1, kind: op.kind, requestId: op.requestId, requestKey: op.request,
      signature: op.signature, scope: saved.scope, createdAt: saved.createdAt, result: saved.result, costs, authority,
      ...(saved.proof ? { proof: saved.proof } : {}) } };
}
export async function view(env, tg, body = {}, now = Date.now(), namespace = 'service') {
  const op = operation(body.kind, body, namespace), { context } = await actorContext(env, tg, now, body),
    saved = await record(env, context, op);
  const { context: current } = await actorContext(env, tg, now, body);
  return { ...current, kind: op.kind, requestId: op.requestId, signature: op.signature, ...saved };
}
