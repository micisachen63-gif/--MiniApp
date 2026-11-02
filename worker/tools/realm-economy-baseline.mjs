#!/usr/bin/env node
// Read-only, aggregate-only economy baseline. Default mode prints reviewable SQL.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gearRaritySql } from '../src/game/gear-quality.js';
import { POTIONS } from '../src/game/constants.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DAY_MS = 86_400_000;
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const itemCategory = field => `CASE WHEN ${field} LIKE 'equip:%' THEN 'equipment_instance' WHEN ${field} LIKE 'sigil:%' THEN 'guardian_instance' WHEN instr(${field}, ':') > 0 THEN 'other_instance' ELSE ${field} END`;
const selected = "c.tg_id = COALESCE(a.active_char_id, c.account_tg_id, c.tg_id)";
const levelBucket = 'CAST((c.level - 1) / 10 AS INTEGER) * 10 + 1';

export function assertReadOnlySql(sql) {
  if (!/^(SELECT|WITH|PRAGMA)\b/i.test(sql.trim())
    || sql.includes(';')
    || /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH|REINDEX|ANALYZE)\b/i.test(sql)
    || /\bPRAGMA\b/i.test(sql) && !/^PRAGMA\s+(?:table_info|table_xinfo|index_list|index_info|foreign_key_list)\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\)\s*$/i.test(sql.trim())) {
    throw new Error('Baseline query rejected: only audited read-only SQL is allowed.');
  }
}

export function buildBaselineQueries({ asOf = Date.now(), days = 7 } = {}) {
  if (!Number.isSafeInteger(asOf) || asOf < 0 || !Number.isInteger(days) || days < 1 || days > 90) throw new Error('Invalid baseline time range.');
  const since = asOf - days * DAY_MS;
  const ledgerWindow = `l.created_at >= ${since} AND l.created_at <= ${asOf}`;
  const reportWindow = `r.created_at >= ${since} AND r.created_at <= ${asOf} AND r.to_at <= ${asOf}`;
  const reports = `SELECT r.*, c.base_class AS current_class, ${levelBucket} AS current_level_bucket
    FROM rpg_idle_reports r JOIN rpg_live_characters c ON c.tg_id = r.tg_id WHERE ${reportWindow}`;
  const potionKeys = Object.keys(POTIONS).map(quote).join(', ');
  const queries = [
    { name: 'schema_presence', sql: `SELECT name, type FROM sqlite_master WHERE name IN ('rpg_live_characters', 'rpg_accounts', 'rpg_equipment', 'rpg_ledger', 'rpg_idle_reports', 'rpg_parties', 'rpg_star_ring_runs', 'rpg_realm_identity') ORDER BY name` },
    { name: 'population', sql: `SELECT COUNT(*) AS live_characters, COUNT(DISTINCT COALESCE(c.account_tg_id, c.tg_id)) AS live_accounts,
      COALESCE(SUM(CASE WHEN ${selected} THEN 1 ELSE 0 END), 0) AS selected_characters,
      (SELECT COUNT(*) FROM rpg_characters WHERE deleted_at IS NOT NULL) AS archived_characters,
      COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM rpg_idle_reports r WHERE r.tg_id = c.tg_id AND ${reportWindow}) THEN c.tg_id END) AS characters_with_idle_settlements,
      COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM rpg_ledger l WHERE l.tg_id = c.tg_id AND ${ledgerWindow}) THEN c.tg_id END) AS characters_with_ledger_activity
      FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id = c.account_tg_id` },
    { name: 'class_level_distribution', sql: `SELECT c.base_class, c.class_path, ${levelBucket} AS level_bucket_start,
      COUNT(*) AS characters, COUNT(DISTINCT COALESCE(c.account_tg_id, c.tg_id)) AS accounts,
      SUM(CASE WHEN ${selected} THEN 1 ELSE 0 END) AS selected_characters,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM rpg_idle_reports r WHERE r.tg_id = c.tg_id AND ${reportWindow}) THEN 1 ELSE 0 END) AS characters_with_idle_settlements
      FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id = c.account_tg_id
      GROUP BY c.base_class, c.class_path, level_bucket_start ORDER BY c.base_class, level_bucket_start, c.class_path` },
    { name: 'gold_distribution', sql: `WITH balances AS (
      SELECT 'all_live' AS population, c.gold FROM rpg_live_characters c
      UNION ALL SELECT 'selected', c.gold FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id = c.account_tg_id WHERE ${selected}
    ), ranked AS (SELECT population, gold, ROW_NUMBER() OVER (PARTITION BY population ORDER BY gold) AS rn, COUNT(*) OVER (PARTITION BY population) AS n FROM balances)
      SELECT population, COUNT(*) AS characters, CAST(SUM(gold) AS TEXT) AS total_gold, ROUND(AVG(gold), 2) AS mean_gold,
      MIN(gold) AS minimum_gold, MAX(gold) AS maximum_gold,
      MAX(CASE WHEN rn = (n * 10 + 99) / 100 THEN gold END) AS p10,
      MAX(CASE WHEN rn = (n * 25 + 99) / 100 THEN gold END) AS p25,
      MAX(CASE WHEN rn = (n * 50 + 99) / 100 THEN gold END) AS p50,
      MAX(CASE WHEN rn = (n * 75 + 99) / 100 THEN gold END) AS p75,
      MAX(CASE WHEN rn = (n * 90 + 99) / 100 THEN gold END) AS p90,
      MAX(CASE WHEN rn = (n * 99 + 99) / 100 THEN gold END) AS p99
      FROM ranked GROUP BY population ORDER BY population` },
    { name: 'equipment_distribution', sql: `SELECT e.class_req, e.tier, e.grade, ${gearRaritySql('e')} AS effective_rarity,
      e.enhance_level, COUNT(*) AS equipment, SUM(CASE WHEN e.is_equipped > 0 THEN 1 ELSE 0 END) AS equipped,
      SUM(CASE WHEN e.bound = 1 THEN 1 ELSE 0 END) AS bound, SUM(CASE WHEN e.trade_id IS NOT NULL THEN 1 ELSE 0 END) AS in_escrow
      FROM rpg_equipment e JOIN rpg_live_characters c ON c.tg_id = e.tg_id
      GROUP BY e.class_req, e.tier, e.grade, effective_rarity, e.enhance_level ORDER BY e.class_req, e.tier, effective_rarity, e.enhance_level` },
    { name: 'inventory_balances', sql: `SELECT ${itemCategory('i.item')} AS item_category, COUNT(DISTINCT i.tg_id) AS holders, CAST(SUM(i.quantity) AS TEXT) AS quantity
      FROM rpg_inventory i JOIN rpg_live_characters c ON c.tg_id = i.tg_id GROUP BY item_category ORDER BY item_category` },
    { name: 'ledger_flows', sql: `SELECT l.type AS activity, ${itemCategory('l.item')} AS item_category,
      COUNT(*) AS ledger_entries, COUNT(DISTINCT l.tg_id) AS characters,
      CAST(SUM(CASE WHEN l.gold_delta > 0 THEN l.gold_delta ELSE 0 END) AS TEXT) AS gold_in,
      CAST(SUM(CASE WHEN l.gold_delta < 0 THEN -l.gold_delta ELSE 0 END) AS TEXT) AS gold_out,
      CAST(SUM(l.gold_delta) AS TEXT) AS gold_net,
      CAST(SUM(CASE WHEN l.item_delta > 0 THEN l.item_delta ELSE 0 END) AS TEXT) AS items_in,
      CAST(SUM(CASE WHEN l.item_delta < 0 THEN -l.item_delta ELSE 0 END) AS TEXT) AS items_out,
      CAST(SUM(l.exp_delta) AS TEXT) AS exp_net
      FROM rpg_ledger l WHERE ${ledgerWindow} GROUP BY activity, item_category ORDER BY activity, item_category` },
    { name: 'idle_rates', sql: `WITH reports AS (${reports})
      SELECT current_class, current_level_bucket, COUNT(*) AS reports, COUNT(DISTINCT tg_id) AS characters,
      SUM(ticks) AS resolved_minutes, SUM(skipped_ticks) AS skipped_minutes, ROUND(SUM(ticks) / 60.0, 4) AS resolved_character_hours,
      SUM(gold_gained) AS gross_gold, SUM(exp_gained) AS experience_gained, SUM(exp_lost) AS experience_lost,
      SUM(kills) AS kills, SUM(deaths) AS deaths, SUM(levels_gained) AS levels_gained,
      ROUND(60.0 * SUM(gold_gained) / NULLIF(SUM(ticks), 0), 4) AS gross_gold_per_resolved_hour,
      ROUND(60.0 * SUM(exp_gained - exp_lost) / NULLIF(SUM(ticks), 0), 4) AS net_experience_per_resolved_hour,
      ROUND(60.0 * SUM(deaths) / NULLIF(SUM(ticks), 0), 4) AS deaths_per_resolved_hour,
      MIN(from_at) AS earliest_accrual_from, MAX(to_at) AS latest_accrual_to
      FROM reports GROUP BY current_class, current_level_bucket ORDER BY current_class, current_level_bucket` },
    { name: 'idle_consumables', sql: `WITH reports AS (${reports}), hours AS (
      SELECT current_class, current_level_bucket, SUM(ticks) / 60.0 AS resolved_hours FROM reports GROUP BY current_class, current_level_bucket
    ), usage AS (
      SELECT r.current_class, r.current_level_bucket, CASE WHEN j.key IN (${potionKeys}) THEN j.key ELSE 'other_consumables' END AS consumable,
      SUM(CAST(j.value AS REAL)) AS consumed FROM reports r, json_each(CASE WHEN json_valid(r.used_json) THEN r.used_json ELSE '{}' END) j
      WHERE j.type IN ('integer', 'real') GROUP BY r.current_class, r.current_level_bucket, consumable
    ) SELECT u.current_class, u.current_level_bucket, u.consumable, u.consumed, ROUND(h.resolved_hours, 4) AS resolved_character_hours,
      ROUND(u.consumed / NULLIF(h.resolved_hours, 0), 4) AS consumed_per_resolved_hour
      FROM usage u JOIN hours h USING(current_class, current_level_bucket) ORDER BY u.current_class, u.current_level_bucket, u.consumable` },
    { name: 'character_progress', sql: `SELECT c.base_class, c.map_id, c.pending_tier,
      CASE WHEN json_valid(c.special_json) THEN COALESCE(json_extract(c.special_json, '$.towerBest'), 0) ELSE NULL END AS highest_tower_floor,
      COUNT(*) AS characters, SUM(c.deaths_total) AS lifetime_deaths
      FROM rpg_live_characters c GROUP BY c.base_class, c.map_id, c.pending_tier, highest_tower_floor ORDER BY c.base_class, c.map_id, highest_tower_floor` },
    { name: 'party_progress', sql: `SELECT kind, status, COUNT(*) AS parties FROM rpg_parties WHERE created_at >= ${since} AND created_at <= ${asOf} GROUP BY kind, status ORDER BY kind, status` },
    { name: 'expedition_progress', sql: `SELECT status,
      CASE WHEN json_valid(state_json) THEN json_extract(state_json, '$.tier') ELSE NULL END AS expedition_tier,
      CASE WHEN json_valid(state_json) THEN COALESCE(json_array_length(state_json, '$.results'), 0) ELSE NULL END AS completed_stages,
      COUNT(*) AS runs FROM rpg_star_ring_runs WHERE created_at >= ${since} AND created_at <= ${asOf}
      GROUP BY status, expedition_tier, completed_stages ORDER BY expedition_tier, status, completed_stages` },
    { name: 'escrow_summary', sql: `SELECT 'open_trade_gold' AS category, COUNT(*) AS entries, CAST(COALESCE(SUM(a_gold + b_gold), 0) AS TEXT) AS quantity
      FROM rpg_trades WHERE status = 'open'
      UNION ALL SELECT 'market_' || kind, COUNT(*), CAST(COALESCE(SUM(qty), 0) AS TEXT) FROM rpg_exchange_listings WHERE status = 'active' GROUP BY kind` },
  ];
  for (const query of queries) assertReadOnlySql(query.sql);
  return queries;
}

export function parseBaselineArgs(argv) {
  const options = { mode: 'dry-run', days: 7, asOf: Date.now(), config: join(REPO, 'worker/wrangler.toml'), database: 'DB', output: null, persistTo: null };
  let explicitMode = null, databaseSpecified = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (['--dry-run', '--local', '--remote'].includes(arg)) {
      const mode = arg.slice(2);
      if (explicitMode && explicitMode !== mode) throw new Error('Choose exactly one of --dry-run, --local or --remote.');
      explicitMode = mode; options.mode = mode; continue;
    }
    if (arg === '--help') { options.help = true; continue; }
    if (!['--database', '--config', '--days', '--as-of', '--output', '--persist-to'].includes(arg)) throw new Error('Unknown option. Run with --help.');
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error('Missing option value.');
    if (arg === '--database') { options.database = value; databaseSpecified = true; }
    else if (arg === '--config') options.config = resolve(value);
    else if (arg === '--days') options.days = Number(value);
    else if (arg === '--as-of') options.asOf = Date.parse(value);
    else if (arg === '--output') options.output = resolve(value);
    else if (arg === '--persist-to') options.persistTo = resolve(value);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(options.database)) throw new Error('Invalid database name or binding.');
  if (options.mode === 'remote' && !databaseSpecified) throw new Error('--remote also requires an explicit --database.');
  if (options.persistTo && options.mode !== 'local') throw new Error('--persist-to is only valid with --local.');
  buildBaselineQueries(options); // Validate time range before any execution.
  if (options.output) {
    const parent = realpathSync(dirname(options.output)), relativeParent = relative(REPO, parent);
    if (!(relativeParent === '..' || relativeParent.startsWith('..' + sep) || isAbsolute(relativeParent))) throw new Error('Write baseline output outside the Git repository; use a private path such as /tmp.');
  }
  return options;
}

export function baselineSql(queries) {
  return queries.map(query => `-- ${query.name}\n${query.sql};`).join('\n\n') + '\n';
}

export function executeBaseline(options, { run = execFileSync } = {}) {
  if (!['local', 'remote'].includes(options.mode)) throw new Error('Database execution requires explicit --local or --remote.');
  const queries = buildBaselineQueries(options), folder = mkdtempSync(join(tmpdir(), 'realm-baseline-'));
  try {
    // Wrangler --remote --file uses D1's import API, which can take the DB
    // offline and does not return SELECT rows. --command uses its query API.
    const args = [join(REPO, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', options.database, '--config', options.config,
      '--' + options.mode, '--command', baselineSql(queries), '--json', '--yes'];
    if (options.persistTo) args.push('--persist-to', options.persistTo);
    let raw;
    try {
      raw = run(process.execPath, args, { cwd: REPO, encoding: 'utf8', timeout: 55_000, maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true', BROWSER: 'none', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(folder, 'wrangler.log') } });
    } catch {
      throw new Error('Read-only baseline query failed. Check existing Cloudflare authorization, database binding and schema. This tool does not log in, migrate or retry with write access.');
    }
    let results;
    try { results = JSON.parse(raw); } catch { throw new Error('Wrangler did not return valid JSON; no baseline was produced.'); }
    if (!Array.isArray(results) || results.length !== queries.length || results.some(result => result.success === false || !Array.isArray(result.results))) throw new Error('Incomplete baseline response; no partial result was published.');
    return { format: 'realm-economy-baseline-v1', source: { mode: options.mode, database: options.database }, queriedAt: new Date().toISOString(),
      eventWindow: { from: new Date(options.asOf - options.days * DAY_MS).toISOString(), to: new Date(options.asOf).toISOString(), days: options.days },
      definitions: { balances: 'Current live rows at query time; as-of is an event filter, not a historical balance snapshot.', activity: 'Selected characters and committed settlements/ledger activity, not human login activity.', idleRate: 'Per 60 resolved character-minutes; class and level buckets are current values.', ledgerFlow: 'Gross account inflows/outflows include transfers and escrow; they are not all currency creation/destruction.', privacy: 'Aggregates only; no names, Telegram IDs, character IDs, instance IDs, messages or ledger notes.' },
      sections: Object.fromEntries(queries.map((query, index) => [query.name, results[index].results])) };
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

function main() {
  const options = parseBaselineArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node worker/tools/realm-economy-baseline.mjs [--dry-run | --local | --remote --database NAME] [--as-of ISO_DATE] [--days 7] [--config PATH] [--persist-to PATH] [--output /private/path]\nDefault: prints aggregate SELECT SQL without contacting any database. Execution is non-interactive and uses existing Wrangler credentials only.\n');
    return;
  }
  const output = options.mode === 'dry-run' ? baselineSql(buildBaselineQueries(options)) : JSON.stringify(executeBaseline(options), null, 2) + '\n';
  if (options.output) writeFileSync(options.output, output, { mode: 0o600, flag: 'wx' });
  else process.stdout.write(output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
}
