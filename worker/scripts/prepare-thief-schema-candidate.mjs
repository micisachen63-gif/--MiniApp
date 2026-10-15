// REVIEW ONLY. Generates a repository-schema candidate; never opens a live database or runs Wrangler.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ident = value => `"${String(value).replaceAll('"', '""')}"`;
export const literal = value => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const digest = value => createHash('sha256').update(value).digest('hex');
const catalogFilter = "name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT GLOB '_thief_*' AND name<>'d1_migrations'";
export const rootChanges = { rpg_characters: 'base_class', rpg_equipment: 'class_req', rpg_exchange_listings: 'class_req' };
const sourceColumn = '__thief_saved_rowid';
const backupName = table => `_thief_backup_${table}`;
const guardName = '_thief_review_guard';
const guard = condition => `INSERT INTO ${ident(guardName)} (ok) SELECT CASE WHEN (${condition}) THEN 1 ELSE 0 END`;
export const schemaRows = db => db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE ${catalogFilter} ORDER BY type,name`).all().map(row => ({ ...row }));
const refersTo = (sql, name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sql || '');

export function repositorySchemaDatabase(transform = sql => sql) {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(resolve(root, 'worker/migrations')).filter(name => name.endsWith('.sql')).sort()) db.exec(transform(readFileSync(resolve(root, 'worker/migrations', file), 'utf8'), file));
  db.exec('PRAGMA foreign_keys=ON');
  return db;
}

function widen(sql, column) {
  const pattern = new RegExp(`(CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\()([^)]*)(\\)\\s*\\))`, 'i');
  const match = sql.match(pattern);
  if (!match || /'thief'/i.test(match[2])) throw new Error(`CHECK shape drift or already widened: ${column}`);
  return sql.replace(pattern, (_, start, values, end) => `${start}${values},'thief'${end}`);
}

function schemaGuard(rows) {
  const values = rows.map(row => `(${[row.type, row.name, row.tbl_name, row.sql].map(literal).join(',')})`).join(',\n');
  return `WITH expected(type,name,tbl_name,sql) AS (VALUES ${values}), actual AS (SELECT type,name,tbl_name,sql FROM sqlite_master WHERE ${catalogFilter})\n${guard('NOT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM actual) AND NOT EXISTS (SELECT * FROM actual EXCEPT SELECT * FROM expected)')}`;
}

function foreignKeys(db, tables) {
  return tables.flatMap(table => {
    const groups = new Map();
    for (const row of db.prepare(`PRAGMA foreign_key_list(${literal(table)})`).all()) {
      const key = `${table}:${row.id}`;
      if (!groups.has(key)) groups.set(key, { table, parent: row.table, id: row.id, onDelete: row.on_delete, onUpdate: row.on_update, columns: [] });
      groups.get(key).columns.push({ from: row.from, to: row.to, seq: row.seq });
    }
    return [...groups.values()].map(fk => ({ ...fk, columns: fk.columns.sort((a, b) => a.seq - b.seq) }));
  });
}

function fkGuard(fk) {
  if (fk.columns.some(column => column.to == null)) throw new Error('Implicit parent PK requires an explicit reviewed FK resolver');
  const present = fk.columns.map(column => `c.${ident(column.from)} IS NOT NULL`).join(' AND ');
  const match = fk.columns.map(column => `p.${ident(column.to)}=c.${ident(column.from)}`).join(' AND ');
  return guard(`NOT EXISTS (SELECT 1 FROM ${ident(fk.table)} c WHERE ${present} AND NOT EXISTS (SELECT 1 FROM ${ident(fk.parent)} p WHERE ${match}))`);
}

export function buildThiefSchemaCandidate(db) {
  const before = schemaRows(db), tableRows = before.filter(row => row.type === 'table');
  const allTables = tableRows.map(row => row.name), fks = foreignKeys(db, allTables);
  const closure = new Set(Object.keys(rootChanges));
  for (let changed = true; changed;) { changed = false; for (const fk of fks) if (closure.has(fk.parent) && !closure.has(fk.table)) { closure.add(fk.table); changed = true; } }
  const createOrder = [], visiting = new Set(), done = new Set();
  function visit(table) {
    if (done.has(table)) return;
    if (visiting.has(table)) throw new Error(`FK cycle requires a separately reviewed plan: ${table}`);
    visiting.add(table);
    for (const fk of fks.filter(row => row.table === table && closure.has(row.parent))) visit(fk.parent);
    visiting.delete(table); done.add(table); createOrder.push(table);
  }
  [...closure].sort().forEach(visit);
  const dropOrder = [...createOrder].reverse();
  const tablePlans = createOrder.map(table => {
    const row = tableRows.find(entry => entry.name === table);
    if (!row || /WITHOUT\s+ROWID|VIRTUAL\s+TABLE/i.test(row.sql)) throw new Error(`Unsupported table form: ${table}`);
    const columns = db.prepare(`PRAGMA table_xinfo(${literal(table)})`).all();
    if (columns.some(column => column.hidden || column.name === sourceColumn)) throw new Error(`Generated/hidden/colliding column requires review: ${table}`);
    if (!columns.some(column => column.pk)) throw new Error(`No declared primary key: ${table}`);
    return { table, columns: columns.map(column => column.name), beforeSQL: row.sql,
      afterSQL: rootChanges[table] ? widen(row.sql, rootChanges[table]) : row.sql,
      integerPrimaryKey: columns.filter(column => column.pk).length === 1 ? columns.find(column => column.pk === 1 && column.type.toUpperCase() === 'INTEGER')?.name || null : null,
      autoincrement: /AUTOINCREMENT/i.test(row.sql) };
  });
  const changedNames = new Set(closure);
  const views = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const row of before.filter(row => row.type === 'view')) if (!changedNames.has(row.name) && [...changedNames].some(name => refersTo(row.sql, name))) { changedNames.add(row.name); views.push(row); changed = true; }
  }
  const triggers = before.filter(row => row.type === 'trigger' && (closure.has(row.tbl_name) || [...changedNames].some(name => refersTo(row.sql, name))));
  const indexes = before.filter(row => row.type === 'index' && closure.has(row.tbl_name) && row.sql);
  const expectedAfter = before.map(row => row.type === 'table' && rootChanges[row.name] ? { ...row, sql: tablePlans.find(plan => plan.table === row.name).afterSQL } : row);
  const statements = [], add = (phase, sql, target = null) => statements.push({ phase, target, sql: sql.replace(/;\s*$/, '') });
  add('preflight', `CREATE TABLE ${ident(guardName)} (ok INTEGER NOT NULL CHECK(ok=1))`);
  add('preflight-schema', schemaGuard(before));
  fks.forEach(fk => add('preflight-fk', fkGuard(fk), fk.table));
  for (const plan of tablePlans) add('backup', `CREATE TABLE ${ident(backupName(plan.table))} AS SELECT rowid AS ${ident(sourceColumn)},${plan.columns.map(ident).join(',')} FROM ${ident(plan.table)}`, plan.table);
  add('backup-sequence', 'CREATE TABLE "_thief_backup_sequence" AS SELECT name,seq FROM sqlite_sequence');
  for (const row of views.slice().reverse()) add('drop-view', `DROP VIEW ${ident(row.name)}`, row.name);
  for (const row of triggers) add('drop-trigger', `DROP TRIGGER ${ident(row.name)}`, row.name);
  for (const table of dropOrder) add('drop-table-leaf-first', `DROP TABLE ${ident(table)}`, table);
  for (const plan of tablePlans) add('create-table-parent-first', plan.afterSQL, plan.table);
  for (const plan of tablePlans) {
    const columns = plan.columns.map(ident).join(',');
    const rowid = plan.integerPrimaryKey ? '' : 'rowid,';
    const saved = plan.integerPrimaryKey ? '' : `${ident(sourceColumn)},`;
    add('restore-data-before-triggers', `INSERT INTO ${ident(plan.table)} (${rowid}${columns}) SELECT ${saved}${columns} FROM ${ident(backupName(plan.table))} ORDER BY ${ident(sourceColumn)}`, plan.table);
  }
  for (const plan of tablePlans.filter(plan => plan.autoincrement)) {
    add('restore-sequence', `DELETE FROM sqlite_sequence WHERE name=${literal(plan.table)}`, plan.table);
    add('restore-sequence', `INSERT INTO sqlite_sequence (name,seq) SELECT name,seq FROM "_thief_backup_sequence" WHERE name=${literal(plan.table)}`, plan.table);
  }
  for (const row of indexes) add('restore-index', row.sql, row.name);
  for (const row of views) add('restore-view', row.sql, row.name);
  for (const row of triggers) add('restore-trigger', row.sql, row.name);
  for (const plan of tablePlans) {
    const bytes = (alias, saved) => [saved ? `${alias}.${ident(sourceColumn)}` : `${alias}.rowid`, ...plan.columns.flatMap(column => [`typeof(${alias}.${ident(column)})`, `hex(${alias}.${ident(column)})`])].join(',');
    const same = `NOT EXISTS (SELECT ${bytes('a', false)} FROM ${ident(plan.table)} a EXCEPT SELECT ${bytes('b', true)} FROM ${ident(backupName(plan.table))} b) AND NOT EXISTS (SELECT ${bytes('b', true)} FROM ${ident(backupName(plan.table))} b EXCEPT SELECT ${bytes('a', false)} FROM ${ident(plan.table)} a) AND (SELECT COUNT(*) FROM ${ident(plan.table)})=(SELECT COUNT(*) FROM ${ident(backupName(plan.table))})`;
    add('verify-all-columns-rowid-types-bytes', guard(same), plan.table);
  }
  add('verify-sequence', guard('NOT EXISTS (SELECT name,seq FROM sqlite_sequence EXCEPT SELECT name,seq FROM "_thief_backup_sequence") AND NOT EXISTS (SELECT name,seq FROM "_thief_backup_sequence" EXCEPT SELECT name,seq FROM sqlite_sequence)'));
  fks.forEach(fk => add('verify-fk', fkGuard(fk), fk.table));
  add('verify-schema', schemaGuard(expectedAfter));
  add('verify-fk-diagnostic', 'PRAGMA foreign_key_check');
  add('verify-integrity-diagnostic', 'PRAGMA quick_check');
  // Only copied, unconstrained staging data is removed here; the verified canonical rows are retained.
  for (const plan of tablePlans) add('cleanup-staging', `DROP TABLE ${ident(backupName(plan.table))}`, plan.table);
  add('cleanup-staging', 'DROP TABLE "_thief_backup_sequence"');
  add('cleanup-staging', `DROP TABLE ${ident(guardName)}`);
  return {
    status: 'blocked-pending-live-schema-backup-authorization-and-D1-rehearsal', productionReady: false,
    remoteReads: 0, remoteWrites: 0, releaseReady: false,
    schemaSha256Before: digest(JSON.stringify(before)), schemaSha256ExpectedAfter: digest(JSON.stringify(expectedAfter)),
    roots: rootChanges, createOrder, dropOrder, tablePlans, foreignKeys: fks,
    affectedTriggers: triggers.map(row => row.name), affectedViews: views.map(row => row.name),
    affectedIndexes: indexes.map(row => row.name),
    transactionContract: 'Execute the complete ordered statements in one proven atomic D1 batch/migration; never split or execute line by line. SQL BEGIN/COMMIT and foreign_keys=OFF are intentionally absent.',
    notAssumed: ['defer_foreign_keys suppresses CASCADE', 'standalone SQLite proves hosted D1 behavior', 'repository schema equals production schema', 'staging tables replace an external backup'],
    statements,
  };
}

export function writeThiefSchemaCandidate() {
  const db = repositorySchemaDatabase();
  try {
    const candidate = buildThiefSchemaCandidate(db), output = resolve(root, 'docs/thief/schema-candidate');
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(`${output}.json`, JSON.stringify(candidate, null, 2) + '\n');
    writeFileSync(`${output}.sql`, '-- REVIEW ONLY. NOT A PRODUCTION MIGRATION. Keep outside worker/migrations.\n-- Must run as one atomic operation after live-schema matching, verified backup and explicit approval.\n-- No BEGIN/COMMIT, FK disable or constraint-ignore workaround.\n\n' + candidate.statements.map((statement, index) => `-- ${index + 1}. ${statement.phase}${statement.target ? `: ${statement.target}` : ''}\n${statement.sql};`).join('\n\n') + '\n');
    console.log(JSON.stringify({ output, status: candidate.status, tables: candidate.createOrder, statements: candidate.statements.length }));
    return candidate;
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) writeThiefSchemaCandidate();
