// Synthetic local rehearsal only. No remote credentials, production bindings or Wrangler execution.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { repositorySchemaDatabase, historicalSchemaMigrationFiles, buildThiefSchemaCandidate, schemaRows, ident } from './prepare-thief-schema-candidate.mjs';
import { seedThiefSchemaFixture } from '../test/thief-schema-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'docs/thief');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const schemaQuery = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT GLOB '_thief_*' AND name<>'d1_migrations' ORDER BY type,name";
const db = repositorySchemaDatabase(), plan = buildThiefSchemaCandidate(db), seed = seedThiefSchemaFixture(db);
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'schema-candidate-seed.sql'), '-- SYNTHETIC LOCAL FIXTURE ONLY. Contains no player data.\n-- Apply after the repository migrations to an empty local test database only.\n\n' + seed.map(sql => sql + ';').join('\n\n') + '\n');
const reads = schemaRows(db).filter(row => row.type === 'table').map(table => {
  const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table.name)})`).all().map(column => column.name);
  return { table: table.name, sql: `SELECT rowid,${columns.flatMap(column => [`typeof(${ident(column)})`, `hex(${ident(column)})`]).join(',')} FROM ${ident(table.name)} ORDER BY rowid` };
});
reads.push({ table: 'sqlite_sequence', sql: 'SELECT name,seq FROM sqlite_sequence ORDER BY name' });
const memoryData = Object.fromEntries(reads.map(read => { const rows = db.prepare(read.sql).all(); return [read.table, { rows: rows.length, sha256: hash(rows) }]; }));
const memorySchemaBefore = schemaRows(db);
const receipt = {
  status: 'blocked-pending-live-schema-backup-explicit-authorization-and-hosted-D1-rehearsal',
  productionReady: false, releaseReady: false, remoteReads: 0, remoteWrites: 0, hostedD1Rehearsed: false,
  roots: plan.roots, tablesRebuilt: plan.createOrder, statements: plan.statements.length,
  maximumStatementBytes: Math.max(...plan.statements.map(statement => Buffer.byteLength(statement.sql))),
  syntheticSeed: { businessTables: reads.length - 1, statements: seed.length, completeCharacterColumns: 41, completeEquipmentColumns: 24,
    equippedPositions: 11, guardianStates: ['active/bound', 'locked', 'trade escrow', 'exchange escrow'], deletedAutoincrementHighWater: 5000 },
  beforeData: memoryData,
  officialSources: [
    { url: 'https://developers.cloudflare.com/d1/sql-api/foreign-keys/', supports: 'Foreign keys remain enabled; temporary deferral is not disabling and does not solve cascade deletion.' },
    { url: 'https://developers.cloudflare.com/d1/sql-api/sql-statements/', supports: 'defer_foreign_keys does not prevent ON DELETE CASCADE; sqlite_master and integrity/FK inspection pragmas.' },
    { url: 'https://developers.cloudflare.com/d1/worker-api/d1-database/', supports: 'D1 batch statements are transactional; failure aborts or rolls back the sequence.' },
    { url: 'https://developers.cloudflare.com/workers/wrangler/commands/d1/', supports: 'Failed individual migration rollback; do not infer that arbitrary split --file ingestion is equivalent.' },
    { url: 'https://www.sqlite.org/foreignkeys.html', supports: 'DROP has implicit DELETE and can execute FK actions; renaming a parent rewrites children.' },
  ],
  remainingGates: ['Explicit authorization for the final reviewed destructive production migration', 'Fresh live sqlite_master/FK/column/index/trigger comparison and generation from that exact schema', 'Verified D1 recovery bookmark and external export; restore rehearsal', 'Quiesce all game/BOT/cron/DO writes without starting the historical long-poll BOT', 'Hosted disposable D1 full-copy rehearsal with data size, duration and storage headroom verification', 'One atomic execution method proved on hosted D1; no split/line-by-line application', 'Release remains closed until 62 character-art acceptance and all feature acceptance complete'],
};

let miniflare;
try {
  db.exec('BEGIN IMMEDIATE');
  try { for (const statement of plan.statements) db.exec(statement.sql); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
  const afterMemory = Object.fromEntries(reads.map(read => { const rows = db.prepare(read.sql).all(); return [read.table, { rows: rows.length, sha256: hash(rows) }]; }));
  assert.deepEqual(afterMemory, memoryData);
  receipt.sqliteMemory = { passed: true, businessTables: reads.length - 1, allRowBytesTypesRowidsAndSequencePreserved: true,
    foreignKeyCheck: db.prepare('PRAGMA foreign_key_check').all(), integrityCheck: db.prepare('PRAGMA integrity_check').get().integrity_check };
  if (!process.argv.includes('--local-d1')) {
    receipt.localD1 = { attempted: false, reason: 'Use --local-d1 only to run the isolated Miniflare simulator. No hosted D1 client exists in this script.' };
    console.log(JSON.stringify({ sqliteMemory: 'PASS', businessTables: reads.length - 1, statements: plan.statements.length, localD1: 'not requested', productionReady: false }));
  } else {
  const localRequire = createRequire(resolve(root, 'package.json'));
  let runtimeRequire = localRequire;
  try { runtimeRequire.resolve('miniflare'); }
  catch {
    const sibling = resolve(root, '../star-journal-rpg/package.json');
    if (!existsSync(sibling)) throw new Error('Install the pinned root dependencies to obtain Miniflare');
    runtimeRequire = createRequire(sibling);
  }
  const { Miniflare, convertV4MiniflareOptions } = runtimeRequire('miniflare');
  const { unstable_splitSqlQuery: splitSql } = runtimeRequire('wrangler');
  receipt.localRuntime = { miniflareVersion: runtimeRequire('miniflare/package.json').version, wranglerVersion: runtimeRequire('wrangler/package.json').version, type: 'local Cloudflare simulator, not hosted D1' };
  const localDir = mkdtempSync(join(tmpdir(), 'thief-schema-local-'));
  const localOptions = { name: 'thief-schema-review-local-only', modules: true,
    script: 'export default { fetch() { return new Response("synthetic local schema rehearsal only"); } };',
    compatibilityDate: '2026-10-15', d1Databases: { DB: randomUUID() },
    resourcePersistencePath: join(localDir, 'state'), resourceTmpPath: join(localDir, 'tmp'),
    host: '127.0.0.1', port: 0, logRequests: false, telemetry: { enabled: false } };
  miniflare = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(localOptions) : localOptions);
  const d1 = await miniflare.getD1Database('DB');
  for (const file of historicalSchemaMigrationFiles()) {
    const queries = splitSql(readFileSync(resolve(root, 'worker/migrations', file), 'utf8'));
    await d1.batch(queries.map(sql => d1.prepare(sql)));
  }
  await d1.batch(seed.map(sql => d1.prepare(sql)));
  const capture = async () => {
    const results = await d1.batch(reads.map(read => d1.prepare(read.sql)));
    return Object.fromEntries(reads.map((read, index) => [read.table, { rows: results[index].results.length, sha256: hash(results[index].results) }]));
  };
  const before = await capture(), schemaBefore = (await d1.prepare(schemaQuery).all()).results;
  assert.deepEqual(before, memoryData, 'The synthetic Miniflare fixture must match SQLite byte-for-byte');
  assert.deepEqual(schemaBefore, memorySchemaBefore, 'Miniflare schema must match the exact pinned repository candidate');
  receipt.localD1 = { seedMatchesSQLite: true, schemaMatchesSQLite: true, foreignKeysEnabled: (await d1.prepare('PRAGMA foreign_keys').first()).foreign_keys === 1, faultRollbacks: [] };
  for (const phase of ['drop-table-leaf-first', 'verify-all-columns-rowid-types-bytes']) {
    const index = plan.statements.findIndex(statement => statement.phase === phase) + 1;
    const broken = plan.statements.map(statement => statement.sql);
    broken.splice(index, 0, 'INSERT INTO "_thief_review_guard"(ok) VALUES(0)');
    await assert.rejects(d1.batch(broken.map(sql => d1.prepare(sql))), /CHECK constraint failed/);
    assert.deepEqual(await capture(), before, `Atomic failure must restore every table: ${phase}`);
    assert.deepEqual((await d1.prepare(schemaQuery).all()).results, schemaBefore);
    receipt.localD1.faultRollbacks.push({ injectedAfter: phase, allDataAndSchemaRestored: true });
  }
  const result = await d1.batch(plan.statements.map(statement => d1.prepare(statement.sql)));
  assert.deepEqual(await capture(), before);
  assert.deepEqual((await d1.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.equal((await d1.prepare('PRAGMA quick_check').first()).quick_check, 'ok');
  receipt.localD1.fullCandidateBatchPassed = true;
  receipt.localD1.everyBusinessRowByteAndRowidPreserved = true;
  receipt.localD1.sequenceHighWaterPreserved = (await d1.prepare("SELECT seq FROM sqlite_sequence WHERE name='rpg_exchange_listings'").first()).seq === 5000;
  receipt.localD1.statementsExecutedInOneBatch = result.length;
  receipt.localD1.foreignKeyCheck = 'PASS'; receipt.localD1.quickCheck = 'ok';
  receipt.localD1.afterData = await capture();
  console.log(JSON.stringify({ localD1: 'PASS', tables: receipt.syntheticSeed.businessTables, statements: result.length, faultRollbacks: receipt.localD1.faultRollbacks.length, productionReady: false }));
  }
} catch (error) {
  receipt.localD1 ??= {};
  receipt.localD1.error = String(error.stack || error);
  process.exitCode = 1;
  console.error(String(error.stack || error));
} finally {
  try { await miniflare?.dispose(); } catch (error) { receipt.localD1 ??= {}; receipt.localD1.disposeError = String(error.message || error); }
  db.close();
  writeFileSync(join(output, 'schema-candidate-rehearsal.json'), JSON.stringify(receipt, null, 2) + '\n');
}
