import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { freshDb } from './d1-shim.js';
import { repositorySchemaDatabase, buildThiefSchemaCandidate, schemaRows, ident } from '../scripts/prepare-thief-schema-candidate.mjs';
import { seedThiefSchemaFixture } from './thief-schema-fixture.mjs';

const migration = readFileSync(new URL('../migrations/0025_thief_empty_database.sql', import.meta.url), 'utf8');
const tables = ['rpg_characters', 'rpg_equipment', 'rpg_exchange_listings', 'rpg_guardian_operations', 'rpg_guardian_sigils', 'rpg_guardian_voucher_grants', 'rpg_guardian_welcome'];
const snapshot = db => ({
  schema: db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),
  data: Object.fromEntries(schemaRows(db).filter(row => row.type === 'table').map(row => [row.name, db.prepare(`SELECT rowid,* FROM ${ident(row.name)} ORDER BY rowid`).all()])),
  sequence: db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all(),
});

test('fresh initialization preserves historical definitions except explicit class CHECK and expedition guardian migrations', () => {
  const historical = repositorySchemaDatabase(), current = freshDb().sqlite;
  try {
    const before = schemaRows(historical), plan = buildThiefSchemaCandidate(historical);
    assert.deepEqual(plan.createOrder, tables);
    const guardianMigration=readFileSync(new URL('../migrations/0031_star_ring_guardian_backpack.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
    const guardianTriggers=new Map([...guardianMigration.matchAll(/CREATE TRIGGER (guardian_sigil_party_\w+)[\s\S]*?END;/g)].map(m=>[m[1],m[0].slice(0,-1)]));
    const configurationMigration=readFileSync(new URL('../migrations/0032_star_ring_guardian_configuration.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
    for(const m of configurationMigration.matchAll(/CREATE TRIGGER (guardian_sigil_party_\w+)[\s\S]*?END;/g))guardianTriggers.set(m[1],m[0].slice(0,-1));
    assert.equal(guardianTriggers.size,2);
    const expected = before.map(row => row.type === 'table' && plan.roots[row.name]
      ? { ...row, sql: plan.tablePlans.find(table => table.table === row.name).afterSQL } : guardianTriggers.has(row.name)?{...row,sql:guardianTriggers.get(row.name)}:row);
    // 0025's frozen contract covers the pre-existing schema. 0026 only adds
    // independent Fate tables/indexes; 0029 adds isolated expedition tables.
    // 0031 replaces two blanket guardian party locks; 0032 allows self-owned
    // activation on real expeditions. Each populated migration test separately
    // verifies every row and all other schema objects.
    assert.deepEqual(schemaRows(current).filter(row=>!row.name.startsWith('rpg_fate_')&&!row.tbl_name.startsWith('rpg_star_ring_')), expected);
    assert.equal(current.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(current.prepare('PRAGMA ignore_check_constraints').get().ignore_check_constraints, 0);
    assert.deepEqual(current.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(current.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.ok(!/PRAGMA\s+(?:foreign_keys|ignore_check_constraints|defer_foreign_keys)\s*=/i.test(migration));
  } finally { historical.close(); current.close(); }
});

test('fresh database accepts four classes and rejects illegal classes in all three real CHECKs', () => {
  const db = freshDb().sqlite;
  try {
    const character = db.prepare("INSERT INTO rpg_characters(tg_id,name,gender,base_class,last_settle_at,created_day,created_at,updated_at,hp,mp) VALUES(?,?,?,?,1,'2026-10-15',1,1,100,40)");
    const gear = db.prepare("INSERT INTO rpg_equipment(id,tg_id,slot,kind,class_req,tier,level_req,name,base_stat,created_at) VALUES(?,?,'weapon','dagger',?,1,1,'測試裝備',12,1)");
    const listing = db.prepare("INSERT INTO rpg_exchange_listings(id,seller_account,seller_char,kind,ref,qty,price,fee,category,class_req,tier,snapshot_json,status,created_at,updated_at) VALUES(?,?,?,'equip',?,1,100,5,'equipment',?,1,'{}','cancelled',1,1)");
    for (const cls of ['sword', 'archer', 'mage', 'thief']) {
      character.run(`fresh-${cls}`, cls, 'm', cls);
      gear.run(`gear-${cls}`, `fresh-${cls}`, cls);
      listing.run(`listing-${cls}`, `fresh-${cls}`, `fresh-${cls}`, `gear-${cls}`, cls);
    }
    assert.throws(() => character.run('bad', 'bad', 'm', 'invalid-class'), /CHECK constraint failed/);
    assert.throws(() => gear.run('bad', 'fresh-thief', 'invalid-class'), /CHECK constraint failed/);
    assert.throws(() => listing.run('bad', 'fresh-thief', 'fresh-thief', 'gear-thief', 'invalid-class'), /CHECK constraint failed/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('populated historical database is refused before any DDL even without an outer transaction', () => {
  const db = repositorySchemaDatabase();
  try {
    seedThiefSchemaFixture(db);
    for (const table of tables) assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM ${ident(table)}`).get().n > 0, table);
    const before = snapshot(db);
    assert.throws(() => db.exec(migration), /malformed JSON/);
    assert.deepEqual(snapshot(db), before);
  } finally { db.close(); }
});

for (const table of tables) test(`the read-only preflight independently rejects rows in ${table}`, () => {
  // Isolate each guard operand: the real schema/FK/trigger restoration is verified above.
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of tables) db.exec(`CREATE TABLE ${ident(name)}(id INTEGER PRIMARY KEY)`);
    db.exec('CREATE TABLE untouched(id INTEGER PRIMARY KEY AUTOINCREMENT)');
    db.exec(`INSERT INTO ${ident(table)}(id) VALUES(1)`);
    const before = snapshot(db);
    assert.throws(() => db.exec(migration), /malformed JSON/);
    assert.deepEqual(snapshot(db), before);
  } finally { db.close(); }
});

test('a genuinely deleted listing retains its historical sequence and cannot be mistaken for a new database', () => {
  const db = repositorySchemaDatabase();
  try {
    db.exec("INSERT INTO rpg_exchange_listings(seq,id,seller_account,seller_char,kind,ref,qty,price,fee,category,class_req,tier,snapshot_json,status,created_at,updated_at) VALUES(5000,'deleted-fixture','account','character','equip','item',1,100,5,'equipment','sword',1,'{}','cancelled',1,1)");
    db.exec("DELETE FROM rpg_exchange_listings WHERE id='deleted-fixture'");
    for (const table of tables) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${ident(table)}`).get().n, 0);
    const before = snapshot(db);
    assert.throws(() => db.exec(migration), /malformed JSON/);
    assert.deepEqual(snapshot(db), before);
  } finally { db.close(); }
});

for (const table of tables) for (const highWater of [0, 5000]) test(`empty tables with ${table} sequence history ${highWater} fail closed without changing schema or sequence`, () => {
  const db = repositorySchemaDatabase();
  try {
    db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run(table, highWater);
    const before = snapshot(db);
    assert.throws(() => db.exec(migration), /malformed JSON/);
    assert.deepEqual(snapshot(db), before);
  } finally { db.close(); }
});

test('unaffected data and sequence high water survive fresh initialization', () => {
  const db = repositorySchemaDatabase();
  try {
    db.exec("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('untouched','scroll_w',7)");
    db.exec("INSERT INTO sqlite_sequence(name,seq) VALUES('unaffected_fixture',9000)");
    db.exec(migration);
    assert.equal(db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id='untouched'").get().quantity, 7);
    assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='unaffected_fixture'").get().seq, 9000);
  } finally { db.close(); }
});

test('class, combat and metadata suites pass under explicit false and true module hooks', () => {
  for (const ready of ['false', 'true']) {
    const env = { ...process.env, THIEF_TEST_RELEASE_READY: ready };
    delete env.NODE_TEST_CONTEXT; // A nested CLI runner must create its own reporter, not inherit parent IPC.
    const result = spawnSync(process.execPath, ['--import', new URL('./thief-release-test-hook.mjs', import.meta.url).href, '--test', ...['thief-class.test.js', 'thief-combat.test.js', 'thief-meta.test.js'].map(file => fileURLToPath(new URL(file, import.meta.url)))], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), env, encoding: 'utf8', windowsHide: true,
    });
    assert.equal(result.status, 0, `${ready}: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /(?:# fail 0|ℹ fail 0)/);
  }
});

