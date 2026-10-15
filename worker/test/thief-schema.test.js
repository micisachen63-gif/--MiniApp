import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { repositorySchemaDatabase, buildThiefSchemaCandidate, schemaRows, ident, literal } from '../scripts/prepare-thief-schema-candidate.mjs';
import { seedThiefSchemaFixture } from './thief-schema-fixture.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function captureAllData(db) {
  const tables = schemaRows(db).filter(row => row.type === 'table');
  return Object.fromEntries(tables.map(table => {
    const columns = db.prepare(`PRAGMA table_info(${literal(table.name)})`).all().map(column => column.name);
    const expr = ['rowid', ...columns.flatMap(column => [`typeof(${ident(column)})`, `hex(${ident(column)})`])].join(',');
    const rows = db.prepare(`SELECT ${expr} FROM ${ident(table.name)} ORDER BY rowid`).all();
    return [table.name, { rows: rows.length, sha256: sha(rows) }];
  }).concat([['sqlite_sequence', { sha256: sha(db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all()) }]]));
}
function runAtomic(db, candidate, hook = () => {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [index, statement] of candidate.statements.entries()) {
      hook(statement, index);
      db.exec(statement.sql);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
const fixture = () => { const db = repositorySchemaDatabase(); seedThiefSchemaFixture(db); return db; };

test('review candidate reproduces all 41 business tables and preserves every value, rowid, sequence, index and trigger', () => {
  const db = fixture();
  try {
    const data = captureAllData(db), before = schemaRows(db), plan = buildThiefSchemaCandidate(db);
    assert.equal(Object.values(data).filter(row => row.rows > 0).length, 41);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rpg_equipment WHERE is_equipped>0").get().n, 11);
    assert.equal(plan.createOrder.length, 7);
    assert.equal(plan.productionReady, false);
    assert.ok(plan.statements.every(statement => !/PRAGMA\s+(foreign_keys|ignore_check_constraints|defer_foreign_keys)\s*=/i.test(statement.sql)));
    runAtomic(db, plan);
    assert.deepEqual(captureAllData(db), data);
    const expected = before.map(row => row.type === 'table' && plan.roots[row.name] ? { ...row, sql: plan.tablePlans.find(table => table.table === row.name).afterSQL } : row);
    assert.deepEqual(schemaRows(db), expected);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='rpg_exchange_listings'").get().seq, 5000);
    const columns = db.prepare("PRAGMA table_info('rpg_characters')").all().map(row => row.name);
    const existing = db.prepare("SELECT * FROM rpg_characters WHERE tg_id='fixture-mage'").get();
    db.prepare(`INSERT INTO rpg_characters (${columns.map(ident).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(column => column === 'tg_id' ? 'fixture-new-thief' : column === 'name' ? '候選盜賊' : column === 'base_class' ? 'thief' : column === 'char_slot' ? 2 : existing[column]));
    assert.throws(() => db.prepare("UPDATE rpg_characters SET base_class='invalid-class' WHERE tg_id='fixture-new-thief'").run(), /CHECK constraint failed/);
    db.prepare("UPDATE rpg_equipment SET class_req='thief' WHERE id='fixture-equipped-armor'").run();
    db.prepare("UPDATE rpg_exchange_listings SET class_req='thief' WHERE id='fixture-equip-listing'").run();
    assert.throws(() => db.prepare("UPDATE rpg_exchange_listings SET class_req='invalid-class' WHERE id='fixture-equip-listing'").run(), /CHECK constraint failed/);
  } finally { db.close(); }
});

test('restored triggers enforce immutable grants, party/collection ownership, escrow and background item locks', () => {
  const db = fixture();
  try {
    runAtomic(db, buildThiefSchemaCandidate(db));
    const checks = [
      ["UPDATE rpg_guardian_welcome SET draws=200", /guardian_welcome_immutable/],
      ["DELETE FROM rpg_guardian_voucher_grants", /guardian_grant_immutable/],
      ["UPDATE rpg_guardian_sigils SET quality=5 WHERE id='fixture-locked-guardian'", /guardian_party_locked/],
      ["DELETE FROM rpg_guardian_sigils WHERE id='fixture-active-guardian'", /guardian_party_locked|guardian_sigil_protected/],
      ["UPDATE rpg_equipment SET enhance_level=8 WHERE id='fixture-enhance-equipment'", /auto_enhance_locked/],
      ["DELETE FROM rpg_equipment WHERE id='fixture-reroll-equipment'", /auto_reroll_locked/],
      ["UPDATE rpg_equipment SET name='changed' WHERE id='fixture-escrow-equipment'", /exchange_equipment_locked/],
      ["DELETE FROM rpg_inventory WHERE tg_id='fixture-sword' AND item='collection_12'", /collection_active_owned/],
      ["UPDATE rpg_characters SET collection_active_map=11 WHERE tg_id='fixture-sword'", /collection_not_owned|collection_party_locked/],
    ];
    for (const [sql, error] of checks) assert.throws(() => db.exec(sql), error, sql);
    assert.equal(db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id='fixture-sword' AND item='guardian_free_normal'").get().quantity, 200);
    assert.equal(db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id='fixture-sword' AND item='guardian_voucher'").get().quantity, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rpg_ledger WHERE type='守護神召喚憑證'").get().n, 1);
  } finally { db.close(); }
});

test('schema drift fails before any original table is dropped and leaves all records unchanged', () => {
  const db = fixture();
  try {
    const plan = buildThiefSchemaCandidate(db);
    db.exec('CREATE INDEX fixture_new_index ON rpg_characters(gold)');
    const before = captureAllData(db), schema = schemaRows(db);
    assert.throws(() => runAtomic(db, plan), /CHECK constraint failed/);
    assert.deepEqual(captureAllData(db), before); assert.deepEqual(schemaRows(db), schema);
  } finally { db.close(); }
});

test('faults at every destructive and restoration phase roll the full candidate back', () => {
  for (const phase of ['backup', 'drop-trigger', 'drop-table-leaf-first', 'create-table-parent-first', 'restore-data-before-triggers', 'restore-sequence', 'restore-index', 'restore-trigger', 'verify-all-columns-rowid-types-bytes', 'verify-schema', 'cleanup-staging']) {
    const db = fixture();
    try {
      const plan = buildThiefSchemaCandidate(db), before = captureAllData(db), schema = schemaRows(db);
      let seen = false;
      assert.throws(() => runAtomic(db, plan, statement => { if (statement.phase === phase && !seen) { seen = true; throw new Error(`injected:${phase}`); } }), /injected:/);
      assert.equal(seen, true); assert.deepEqual(captureAllData(db), before, phase); assert.deepEqual(schemaRows(db), schema, phase);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { db.close(); }
  }
});

test('a failed byte/type/data guard after table restoration rolls all records and schema back', () => {
  const db = fixture();
  try {
    const before = captureAllData(db), schema = schemaRows(db), plan = buildThiefSchemaCandidate(db);
    let injected = false;
    assert.throws(() => runAtomic(db, plan, statement => {
      if (statement.phase === 'verify-all-columns-rowid-types-bytes' && !injected) { injected = true; db.exec('UPDATE "_thief_backup_rpg_characters" SET gold=gold+1'); }
    }), /CHECK constraint failed/);
    assert.deepEqual(captureAllData(db), before); assert.deepEqual(schemaRows(db), schema);
  } finally { db.close(); }
});

test('CASCADE, SET NULL and RESTRICT descendant closures preserve child records and their original actions', () => {
  const db = fixture();
  try {
    db.exec("CREATE TABLE fixture_cascade(id TEXT PRIMARY KEY, op TEXT REFERENCES rpg_guardian_operations(operation_id) ON DELETE CASCADE)");
    db.exec("CREATE TABLE fixture_set_null(id TEXT PRIMARY KEY, ancestor TEXT REFERENCES fixture_cascade(id) ON DELETE SET NULL)");
    db.exec("CREATE TABLE fixture_restrict(id TEXT PRIMARY KEY, hero TEXT REFERENCES rpg_characters(tg_id) ON DELETE RESTRICT)");
    db.exec("INSERT INTO fixture_cascade VALUES('cascade','fixture-guardian-operation'); INSERT INTO fixture_set_null VALUES('null','cascade'); INSERT INTO fixture_restrict VALUES('restrict','fixture-sword')");
    db.exec('CREATE VIEW fixture_hero_view AS SELECT tg_id,name,gold FROM rpg_characters');
    db.exec('CREATE VIEW fixture_nested_view AS SELECT * FROM fixture_hero_view');
    const before = captureAllData(db), schema = schemaRows(db), plan = buildThiefSchemaCandidate(db);
    assert.ok(plan.createOrder.includes('fixture_set_null')); assert.ok(plan.affectedViews.includes('fixture_nested_view'));
    assert.ok(plan.dropOrder.indexOf('fixture_set_null') < plan.dropOrder.indexOf('fixture_cascade'));
    assert.ok(plan.dropOrder.indexOf('fixture_cascade') < plan.dropOrder.indexOf('rpg_guardian_operations'));
    assert.ok(plan.dropOrder.indexOf('fixture_restrict') < plan.dropOrder.indexOf('rpg_characters'));
    runAtomic(db, plan); assert.deepEqual(captureAllData(db), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fixture_nested_view').get().n, 3);
    for (const row of schema.filter(row => row.type !== 'table' || !plan.roots[row.name])) assert.deepEqual(schemaRows(db).find(after => after.name === row.name), row);
    assert.equal(db.prepare("PRAGMA foreign_key_list('fixture_cascade')").get().on_delete, 'CASCADE');
    assert.equal(db.prepare("PRAGMA foreign_key_list('fixture_set_null')").get().on_delete, 'SET NULL');
    assert.equal(db.prepare("PRAGMA foreign_key_list('fixture_restrict')").get().on_delete, 'RESTRICT');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('deferring foreign keys alone demonstrably does not prevent child deletion on parent DROP', () => {
  const db = repositorySchemaDatabase();
  try {
    db.exec('CREATE TABLE fixture_parent(id INTEGER PRIMARY KEY); CREATE TABLE fixture_child(id INTEGER PRIMARY KEY,pid INTEGER REFERENCES fixture_parent(id) ON DELETE CASCADE)');
    db.exec('INSERT INTO fixture_parent VALUES(1); INSERT INTO fixture_child VALUES(1,1)');
    db.exec('BEGIN; PRAGMA defer_foreign_keys=ON; DROP TABLE fixture_parent');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fixture_child').get().n, 0);
    db.exec('ROLLBACK'); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fixture_child').get().n, 1);
  } finally { db.close(); }
});

test('unusual TEXT/BLOB/REAL storage, including embedded NUL, survives the exact byte guard', () => {
  const db = fixture();
  try {
    db.prepare("UPDATE rpg_characters SET tg_name=?,exp=? WHERE tg_id='fixture-sword'").run('文字\0NUL', 123456.375);
    db.prepare("UPDATE rpg_characters SET tg_name=? WHERE tg_id='fixture-mage'").run(new Uint8Array([0, 1, 254, 255]));
    const before = captureAllData(db); runAtomic(db, buildThiefSchemaCandidate(db)); assert.deepEqual(captureAllData(db), before);
  } finally { db.close(); }
});

test('checked-in SQL and statement manifest reproduce the exact current repository schema candidate', () => {
  const db = repositorySchemaDatabase();
  try {
    const plan = buildThiefSchemaCandidate(db), checkedIn = JSON.parse(readFileSync(new URL('../../docs/thief/schema-candidate.json', import.meta.url), 'utf8'));
    assert.deepEqual(checkedIn, plan);
    assert.ok(!/\bBEGIN\s+(IMMEDIATE|TRANSACTION)|PRAGMA\s+(ignore_check_constraints|foreign_keys)\s*=/i.test(readFileSync(new URL('../../docs/thief/schema-candidate.sql', import.meta.url), 'utf8')));
  } finally { db.close(); }
});
