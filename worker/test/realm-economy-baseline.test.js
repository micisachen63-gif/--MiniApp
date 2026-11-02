import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { freshDb } from './d1-shim.js';
import { createCharacter } from '../src/services/player.js';
import { assertReadOnlySql, buildBaselineQueries, executeBaseline, parseBaselineArgs } from '../tools/realm-economy-baseline.mjs';
import { NOW, gameplaySnapshot } from './realm-test-helpers.js';

async function data(t) {
  const DB = freshDb(); t.after(() => DB.sqlite.close());
  for (const [index, baseClass] of ['sword', 'mage', 'archer', 'thief'].entries()) {
    const tgId = String(150001 + index);
    await createCharacter({ DB }, { tgId, name: 'PRIVATE_P' + index, gender: 'm', baseClass }, NOW);
    DB.sqlite.prepare('UPDATE rpg_characters SET level = 21, gold = ?, special_json = ? WHERE tg_id = ?').run((index + 1) * 10, JSON.stringify({ towerBest: 20 }), tgId);
  }
  const extra = await createCharacter({ DB }, { tgId: '150001', name: 'PRIVATE_ALT', gender: 'f', baseClass: 'sword' }, NOW);
  DB.sqlite.prepare('UPDATE rpg_characters SET gold = 1000 WHERE tg_id = ?').run(extra.char.tg_id);
  DB.sqlite.prepare("UPDATE rpg_accounts SET active_char_id = '150001' WHERE account_tg_id = '150001'").run();
  DB.sqlite.prepare("UPDATE rpg_equipment SET enhance_level = 12, grade = 'relic', element_tier = 'common' WHERE tg_id = '150001'").run();
  const report = DB.sqlite.prepare('INSERT INTO rpg_idle_reports(tg_id,from_at,to_at,ticks,skipped_ticks,kills,exp_gained,exp_lost,deaths,elites,gold_gained,used_json,drops_json,levels_gained,end_state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  report.run('150001', NOW - 120 * 60_000, NOW - 1, 120, 5, 200, 5000, 500, 2, 3, 600, JSON.stringify({ red_1: 6, blue_2: 4, guardian_summon_stone: 1 }), '{}', 1, 'fighting', NOW - 1);
  report.run('150002', NOW - 60 * 60_000, NOW - 1, 60, 0, 300, 2000, 0, 0, 2, 900, JSON.stringify({ blue_2: 12 }), '{}', 0, 'fighting', NOW - 1);
  report.run('150001', NOW - 9 * 86_400_000, NOW - 8 * 86_400_000, 1440, 0, 1, 1, 0, 0, 0, 99999, '{}', '{}', 0, 'fighting', NOW - 8 * 86_400_000);
  report.run('150001', NOW, NOW + 60_000, 1, 0, 1, 1, 0, 0, 0, 99999, '{}', '{}', 0, 'fighting', NOW);
  const ledger = DB.sqlite.prepare('INSERT INTO rpg_ledger(event_id,tg_id,type,gold_delta,item,item_delta,note,created_at) VALUES(?,?,?,?,?,?,?,?)');
  ledger.run('PRIVATE_EVENT_1', '150001', 'baseline_test_flow', 100, 'equip:PRIVATE_EQUIPMENT_ID', 1, 'PRIVATE_MESSAGE_WITH_TG_ID_150001', NOW - 1);
  ledger.run('PRIVATE_EVENT_2', '150001', 'baseline_test_flow', -40, 'blue_2', -2, 'PRIVATE_MESSAGE_WITH_TG_ID_150001', NOW - 1);
  const queries = buildBaselineQueries({ asOf: NOW, days: 7 });
  const before = gameplaySnapshot(DB);
  const sections = Object.fromEntries(queries.map(query => [query.name, DB.sqlite.prepare(query.sql).all().map(row => ({ ...row }))]));
  return { DB, before, sections, queries };
}

test('all baseline queries are truly read-only and aggregate known balances, class counts and unchanged +N', async t => {
  const { DB, before, sections, queries } = await data(t);
  assert.equal(queries.length, 13);
  assert.deepEqual(gameplaySnapshot(DB), before);
  assert.equal(sections.population[0].live_accounts, 4);
  assert.equal(sections.population[0].live_characters, 5);
  assert.equal(sections.population[0].selected_characters, 4);
  assert.equal(sections.population[0].characters_with_idle_settlements, 2);
  const all = sections.gold_distribution.find(row => row.population === 'all_live');
  const selected = sections.gold_distribution.find(row => row.population === 'selected');
  assert.equal(all.total_gold, '1100'); assert.equal(all.p50, 30); assert.equal(all.p90, 1000);
  assert.equal(selected.total_gold, '100'); assert.equal(selected.p50, 20);
  const preserved = sections.equipment_distribution.filter(row => row.enhance_level === 12);
  assert.equal(preserved.reduce((sum, row) => sum + row.equipment, 0), DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_equipment WHERE enhance_level = 12').get().n);
  assert(preserved.every(row => row.effective_rarity === 'legendary'));
});

test('idle rates use actual resolved minutes, exclude old/future accrual and keep consumption separate from gold expense', async t => {
  const { sections } = await data(t);
  const sword = sections.idle_rates.find(row => row.current_class === 'sword');
  assert.equal(sword.resolved_minutes, 120); assert.equal(sword.skipped_minutes, 5);
  assert.equal(sword.gross_gold_per_resolved_hour, 300);
  assert.equal(sword.net_experience_per_resolved_hour, 2250);
  assert.equal(sword.deaths_per_resolved_hour, 1);
  const red = sections.idle_consumables.find(row => row.current_class === 'sword' && row.consumable === 'red_1');
  assert.equal(red.consumed, 6); assert.equal(red.consumed_per_resolved_hour, 3);
  const flow = sections.ledger_flows.filter(row => row.activity === 'baseline_test_flow');
  assert.equal(flow.reduce((sum, row) => sum + Number(row.gold_in), 0), 100);
  assert.equal(flow.reduce((sum, row) => sum + Number(row.gold_out), 0), 40);
});

test('baseline never exports player identifiers, names, instance identifiers, event IDs or ledger messages', async t => {
  const { sections } = await data(t), serialized = JSON.stringify(sections);
  for (const secret of ['PRIVATE_P', 'PRIVATE_ALT', 'PRIVATE_EQUIPMENT', 'PRIVATE_EVENT', 'PRIVATE_MESSAGE', '150001', '150002', '150003', '150004']) assert(!serialized.includes(secret), secret);
  assert(sections.ledger_flows.some(row => row.item_category === 'equipment_instance'));
  assert(!Object.values(sections).flat().some(row => ['tg_id', 'name', 'note', 'event_id', 'char_id', 'message_id'].some(key => key in row && key !== 'name')));
});

test('CLI defaults to SQL review, requires explicit remote database, and refuses repository output or write SQL', () => {
  assert.equal(parseBaselineArgs([]).mode, 'dry-run');
  assert.throws(() => parseBaselineArgs(['--remote']), /explicit --database/);
  assert.throws(() => parseBaselineArgs(['--remote', '--database', 'elf-rpg', '--local']), /exactly one/);
  assert.equal(parseBaselineArgs(['--remote', '--database', 'elf-rpg']).mode, 'remote');
  assert.throws(() => parseBaselineArgs(['--output', fileURLToPath(new URL('../../docs/baseline-data.json', import.meta.url))]), /outside the Git repository/);
  assert.throws(() => executeBaseline(parseBaselineArgs([])), /explicit --local or --remote/);
  for (const sql of ['UPDATE rpg_characters SET gold = 0', 'SELECT 1; DELETE FROM rpg_equipment', 'PRAGMA writable_schema = ON', 'WITH x AS (SELECT 1) DELETE FROM rpg_inventory']) assert.throws(() => assertReadOnlySql(sql), /read-only/);
  assertReadOnlySql('PRAGMA table_info(rpg_characters)');
});

test('remote execution uses the read-query command API, never file import, and runs without interactive login', async t => {
  const { DB, before, queries } = await data(t);
  const options = parseBaselineArgs(['--remote', '--database', 'elf-rpg', '--as-of', new Date(NOW).toISOString()]);
  let calls = 0;
  const result = executeBaseline(options, { run: (_node, args, runtime) => {
    calls++;
    assert(args.includes('--remote')); assert(args.includes('--command')); assert(!args.includes('--file'));
    assert.equal(runtime.env.CI, 'true'); assert.equal(runtime.stdio[0], 'ignore');
    const sql = args[args.indexOf('--command') + 1];
    assert(sql.includes('-- gold_distribution'));
    return JSON.stringify(queries.map(query => ({ success: true, results: DB.sqlite.prepare(query.sql).all() })));
  } });
  assert.equal(calls, 1); assert.equal(result.source.mode, 'remote');
  assert.equal(Object.keys(result.sections).length, 13);
  assert.deepEqual(gameplaySnapshot(DB), before);
});
