import { RealmError } from './errors.js';

const statements = new WeakMap();
const RESERVED = /\brpg_realm_(?:identity|registry|commit_guard|phase_history)\b/i;

// Only an ordinary SELECT is considered read-only. WITH, PRAGMA, DDL and other
// ambiguous forms never gain a read-only exemption. Existing services use SELECT.
function readOnly(sql) {
  // Skip quoted literals/identifiers before removing comments: a '--' inside a
  // string must not hide a following semicolon and a second SQL statement.
  let normalized = '';
  for (let i = 0; i < sql.length; i++) {
    const character = sql[i];
    if (character === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i + 2); i = end < 0 ? sql.length : end;
      normalized += ' '; continue;
    }
    if (character === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) throw new RealmError('realm_statement_invalid', '資料庫指令註解未結束');
      i = end + 1; normalized += ' '; continue;
    }
    if (["'", '"', '`', '['].includes(character)) {
      const closing = character === '[' ? ']' : character;
      let closed = false;
      while (++i < sql.length) {
        if (sql[i] !== closing) continue;
        if (closing !== ']' && sql[i + 1] === closing) { i++; continue; }
        closed = true; break;
      }
      if (!closed) throw new RealmError('realm_statement_invalid', '資料庫指令字串未結束');
      normalized += '?'; continue;
    }
    normalized += character;
  }
  normalized = normalized.trim().replace(/;\s*$/, '');
  if (normalized.includes(';')) throw new RealmError('realm_statement_invalid', '每個資料庫指令只能包含一段 SQL');
  if (!/^(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(normalized)) throw new RealmError('realm_maintenance_required', '遊戲操作不允許修改資料庫結構', 403);
  return /^SELECT\b/i.test(normalized);
}

export function realmCommitGuard(DB, identity, { write = true,maintenance=false } = {}) {
  return DB.prepare(`INSERT INTO rpg_realm_commit_guard(ok) SELECT NULL WHERE NOT EXISTS (
    SELECT 1 FROM rpg_realm_identity WHERE singleton = 1 AND realm_id = ? AND realm_type = ?
    AND database_token = ? AND instance_nonce = ? AND rules_version = ? AND phase = ? AND fence_epoch = ?
    ${write ? (maintenance?"AND phase = 'DRAIN'":"AND phase = 'ACTIVE'") : ''}
  )`).bind(identity.realm_id, identity.realm_type, identity.database_token, identity.instance_nonce, identity.rules_version, identity.phase, identity.fence_epoch);
}

function guardError(error) {
  if (/rpg_realm_commit_guard\.ok/.test(String(error?.message || error))) return new RealmError('realm_fence_changed', '世界狀態已更新或已停止操作，請重新整理', 409, { cause: error });
  return error;
}

/**
 * D1.batch is transactional. Prepending the assertion to the SAME batch closes
 * the check/write race and preserves changes()-based guards between old SQLs.
 * Neither raw statements nor another realm's prepared statements are accepted.
 * This object deliberately exposes no raw DB / exec escape hatch.
 */
export function createRealmGuardedDB(rawDB, identity,{maintenance=false}={}) {
  const owner = {};
  async function execute(items) {
    if (!Array.isArray(items)) throw new RealmError('realm_statement_invalid', '資料庫操作無效');
    if (!items.length) return [];
    const source = items.map(item => {
      const statement = statements.get(item);
      if (!statement || statement.owner !== owner) throw new RealmError('realm_statement_mismatch', '資料庫操作不屬於目前世界');
      return statement;
    });
    const write = source.some(statement => !statement.readOnly);
    if (write && identity.phase !== (maintenance?'DRAIN':'ACTIVE')) throw new RealmError('realm_read_only', '這個世界已停止接受新操作', 409);
    try {
      const result = await rawDB.batch([realmCommitGuard(rawDB, identity, { write,maintenance }), ...source.map(statement => statement.raw)]);
      return result.slice(1);
    } catch (error) { throw guardError(error); }
  }
  function wrap(raw, sql) {
    const statement = {
      bind(...values) { return wrap(raw.bind(...values), sql); },
      async all() { return (await execute([statement]))[0]; },
      async run() { return (await execute([statement]))[0]; },
      async first(column) {
        const result = (await execute([statement]))[0].results?.[0] ?? null;
        if (column && result && !Object.prototype.hasOwnProperty.call(result, column)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
        return column && result ? result[column] : result;
      },
    };
    statements.set(statement, { owner, raw, readOnly: readOnly(sql) });
    return Object.freeze(statement);
  }
  const DB = {
    prepare(sql) {
      if (typeof sql !== 'string' || !sql.trim()) throw new RealmError('realm_statement_invalid', '資料庫操作無效');
      const isRead = readOnly(sql);
      if (!isRead && RESERVED.test(sql)) throw new RealmError('realm_maintenance_required', '世界狀態只能由維護流程更新', 403);
      return wrap(rawDB.prepare(sql), sql);
    },
    batch: execute,
    async exec() { throw new RealmError('realm_maintenance_required', '世界資料庫不允許未受保護的批次指令', 403); },
  };
  // A session still uses the same fence and never returns its raw prepared SQL.
  if (typeof rawDB.withSession === 'function') DB.withSession = constraint => createRealmGuardedDB(rawDB.withSession(constraint), identity,{maintenance});
  if (typeof rawDB.getBookmark === 'function') DB.getBookmark = () => rawDB.getBookmark();
  return Object.freeze(DB);
}
