// Minimal Cloudflare D1 API on top of node:sqlite (Node ≥22) for unit/API tests. batch() is atomic like D1.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

class Stmt {
  constructor(d1, sql, params = []) { this.d1 = d1; this.sql = sql; this.params = params; }
  bind(...p) {
    for (const v of p) if (v === undefined) throw new Error('D1_TYPE_ERROR: Type \'undefined\' not supported for value \'undefined\'');
    return new Stmt(this.d1, this.sql, p);
  }
  _exec() {
    const s = this.d1.sqlite.prepare(this.sql);
    const p = this.params.map((v) => (typeof v === 'boolean' ? Number(v) : v));
    if (s.columns().length > 0) { const rows = s.all(...p); return { success: true, results: rows.map((r) => ({ ...r })), meta: { changes: this.d1.sqlite.prepare('SELECT changes() AS c').get().c } }; }
    const r = s.run(...p); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async all() { return this._exec(); }
  async run() { return this._exec(); }
  async first(col) { const r = this._exec().results[0] ?? null; return col && r ? r[col] : r; }
}

export class D1Shim {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this, sql); }
  async batch(stmts) {
    this.sqlite.exec('BEGIN');
    try { const out = stmts.map((s) => s._exec()); this.sqlite.exec('COMMIT'); return out; }
    catch (e) { this.sqlite.exec('ROLLBACK'); throw new Error(`D1_ERROR: ${e.message}`); }
  }
  async exec(sql) { this.sqlite.exec(sql); }
}

export function freshDb() {
  const db = new D1Shim();
  // Match the repository's eol=lf migration contract in pre-existing Windows worktrees too.
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) db.sqlite.exec(readFileSync(join(MIGRATIONS, f), 'utf8').replace(/\r\n/g, '\n'));
  return db;
}
