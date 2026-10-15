// Read repository migration SQL into an ephemeral SQLite database. Never opens D1 or a player database.
// This is a design inventory, not an executable thief migration.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${value.replaceAll("'", "''")}'`;

export function auditThiefSchema() {
  const db = new DatabaseSync(':memory:');
  try {
    const migrations = readdirSync(resolve(root, 'worker/migrations')).filter(name => name.endsWith('.sql')).sort().map(file => {
      const sql = readFileSync(resolve(root, 'worker/migrations', file), 'utf8');
      db.exec(sql);
      return { file, sha256: sha(sql) };
    });
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all().map(row => ({ ...row }));
    const tableNames = schema.filter(row => row.type === 'table').map(row => row.name);
    const allForeignKeys = tableNames.flatMap(table => db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all().map(row => ({ ownerTable: table, ...row })));
    const tables = Object.fromEntries(['rpg_characters', 'rpg_equipment', 'rpg_exchange_listings'].map(table => [table, {
      schemaSQL: schema.find(row => row.type === 'table' && row.name === table).sql,
      columns: db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(row => ({ ...row })),
      indexes: db.prepare(`PRAGMA index_list(${quote(table)})`).all().map(row => ({ ...row, columns: db.prepare(`PRAGMA index_xinfo(${quote(row.name)})`).all().map(column => ({ ...column })), sql: schema.find(entry => entry.name === row.name)?.sql || null })),
      outgoingForeignKeys: allForeignKeys.filter(row => row.ownerTable === table),
      incomingForeignKeys: allForeignKeys.filter(row => row.table === table),
      attachedTriggers: schema.filter(row => row.type === 'trigger' && row.tbl_name === table),
      referencingTriggers: schema.filter(row => row.type === 'trigger' && row.tbl_name !== table && new RegExp(`\\b${table}\\b`, 'i').test(row.sql)),
      referencingViews: schema.filter(row => row.type === 'view' && new RegExp(`\\b${table}\\b`, 'i').test(row.sql)),
      laterAddedColumns: migrations.flatMap(({ file }) => {
        const sql = readFileSync(resolve(root, 'worker/migrations', file), 'utf8');
        return [...sql.matchAll(new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+(\\w+)[^;]*;`, 'gi'))].map(match => ({ migration: file, column: match[1], statement: match[0] }));
      }),
    }]));
    return {
      status: 'design-only-not-applied', scope: 'repository-migrations-in-memory-sqlite', liveDatabaseInspected: false,
      remoteQueries: 0, remoteWrites: 0, productionMigrationCreated: false, reviewSQLCandidateCreated: true, releaseReady: false,
      migrations, schemaSha256: sha(JSON.stringify(schema)), tables,
      requiredChange: {
        rpg_characters: { column: 'base_class', addAllowedValue: 'thief', preserveAllowedValues: ['mage', 'sword', 'archer'] },
        rpg_equipment: { column: 'class_req', addAllowedValue: 'thief', preserveAllowedValues: ['mage', 'sword', 'archer', 'any'] },
        rpg_exchange_listings: { column: 'class_req', addAllowedValue: 'thief', preserveAllowedValues: ['any', 'sword', 'archer', 'mage'] },
        newColumnsRequired: [], newEquipmentSlotsRequired: [],
      },
      reviewPlan: [
        'Keep THIEF_RELEASE_READY false, reject creation server-side, exclude from public class lists and global relic pools.',
        'Before drafting migration, read live sqlite_schema and PRAGMA table_info/index_list/index_xinfo/foreign_key_list for all tables; compare to this repository snapshot and stop on unexplained drift.',
        'SQLite cannot widen these CHECK constraints with ADD COLUMN. A candidate rebuild remains under docs/thief for review and local synthetic tests only; promotion into worker/migrations or execution on production requires separate review and explicit authorization.',
        'Take a verified recoverable D1 backup and rehearse the full plan on an isolated copy with all existing schema, indexes, triggers and relationships.',
        'Preserve every current column and constraint, especially all laterAddedColumns; use explicit named copy columns with no conversions, defaults substituted for existing values, or reset counters.',
        'Preserve primary and unique keys, COLLATE NOCASE, partial indexes, guardian foreign keys, all attached and referencing trigger definitions, and all old class checks plus thief only.',
        'Coordinate writes during the eventual change: equipment exchange/background locks and guardian welcome/grant triggers must not be bypassed by normal player requests.',
        'Record D1 foreign-key and transaction semantics during rehearsal; do not assume PRAGMA foreign_keys=OFF works on production D1 or permit cascades while rebuilding a referenced parent.',
        'Compare row counts and per-row hashes for both tables and all dependent tables before/after; require foreign_key_check and integrity_check success and exact index/trigger schema preservation.',
        'Verify legacy players, all 11 equipped positions, bound/traded/relic/affixed gear, account active selection, collection blessings, guardian ownership/counters, background operations and exchange escrow remain unchanged.',
        'Only after migration, 62-art acceptance, all combat modes and GitHub/live deployment verification pass, separately consider setting releaseReady true.',
      ],
      preservation: {
        characterColumns: tables.rpg_characters.columns.map(row => row.name),
        equipmentColumns: tables.rpg_equipment.columns.map(row => row.name),
        exchangeListingColumns: tables.rpg_exchange_listings.columns.map(row => row.name),
        preserveAutoincrementHighWater: 'rpg_exchange_listings.sqlite_sequence',
        preserveExistingIdentifiers: ['tg_id', 'account_tg_id', 'char_slot', 'id', 'trade_id', 'party_id'],
        preserveBalancesProgressAndLocks: true, reseedPlayersOrBotState: false,
      },
    };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = resolve(root, 'docs/thief/schema-readiness.json');
  const audit = auditThiefSchema();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(audit, null, 2) + '\n');
  console.log(JSON.stringify({ output, status: audit.status, migrations: audit.migrations.length, columns: Object.fromEntries(Object.entries(audit.tables).map(([name, table]) => [name, table.columns.length])) }));
}
