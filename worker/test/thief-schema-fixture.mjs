// Entirely synthetic preservation fixture. Never sourced from player data or a live database.
import { ident, literal } from '../scripts/prepare-thief-schema-candidate.mjs';
export const fixtureNow = Date.parse('2026-10-15T01:00:00Z');
export function seedThiefSchemaFixture(db) {
  const statements = [], now = fixtureNow;
  const exec = sql => { db.exec(sql); statements.push(sql); };
  const insert = (table, supplied = {}) => {
    const columns = db.prepare(`PRAGMA table_info(${literal(table)})`).all();
    const values = columns.map(column => {
      if (Object.hasOwn(supplied, column.name)) return supplied[column.name];
      if (column.dflt_value != null) return db.prepare(`SELECT ${column.dflt_value} AS value`).get().value;
      if (column.pk && column.type === 'INTEGER') return null;
      if (!column.notnull) return null;
      return /INT|REAL|NUM|DEC/i.test(column.type) ? 1 : `fixture-${table}-${column.name}`;
    });
    const sql = `INSERT INTO ${ident(table)} (${columns.map(column => ident(column.name)).join(',')}) VALUES (${values.map(literal).join(',')})`;
    exec(sql);
  };
  const char = (id, base, account, slot, gender) => ({
    tg_id: id, name: `測試角色_${id}`, tg_name: 'synthetic_fixture', gender, base_class: base, class_path: 'A111', pending_tier: null,
    level: 120, exp: 123456, hp: 712, mp: 231, map_id: 12, idle_state: 'fighting', state_until: null, auto_red_pct: 50, auto_blue: 1,
    gold: 456789, last_settle_at: now - 654321, last_daily_gold_day: '2026-10-14', penalty_day: '2026-10-15', penalties_today: 2,
    drop_day: '2026-10-15', drops_today: '{"scroll_w":17,"relic":1}', deaths_total: 7, last_reselect_at: now - 1900000,
    boss_down_until: now + 90000, ladder_points: 387, pvp_wins: 11, pvp_losses: 3,
    created_day: '2026-09-01', created_at: now - 90000000, updated_at: now - 321, rev: 42, tg_username: `fixture_${id}`,
    account_tg_id: account, char_slot: slot, special_json: '{"learned":["skill_01_1"],"cooldowns":{"skill_01_1":1792026000001},"loadout":["skill_01_1"]}',
    party_id: null, idle_combat_json: '{"mapId":12,"remainder":0.375,"target":1}', guardian_draw_remainder: 3, collection_active_map: 12,
  });
  insert('rpg_characters', char('fixture-sword', 'sword', 'fixture-account-a', 1, 'm'));
  insert('rpg_characters', char('fixture-mage', 'mage', 'fixture-account-b', 1, 'f'));
  insert('rpg_characters', char('fixture-archer', 'archer', 'fixture-account-a', 2, 'f'));
  insert('rpg_accounts', { account_tg_id: 'fixture-account-a', active_char_id: 'fixture-archer', updated_at: now });
  insert('rpg_accounts', { account_tg_id: 'fixture-account-b', active_char_id: 'fixture-mage', updated_at: now });
  for (const id of ['fixture-sword', 'fixture-mage', 'fixture-archer']) {
    insert('rpg_inventory', { tg_id: id, item: 'collection_12', quantity: 1 });
    insert('rpg_inventory', { tg_id: id, item: 'red_4', quantity: 137 });
  }
  insert('rpg_trades', { id: 'fixture-trade', a_tg: 'fixture-sword', b_tg: 'fixture-mage', status: 'open', a_gold: 71, b_gold: 39,
    a_lock: 1, b_lock: 0, offer_rev: 7, rev: 11, created_at: now - 4000, updated_at: now - 2000, expires_at: now + 120000, request_id: 'fixture-trade-request' });
  insert('rpg_boss_instances', { id: 'fixture-boss', map_id: 12, name: '測試首領', element: 'dark', base_hp: 90000, max_hp: 125000, hp: 9001,
    participants: 3, spawn_reason: 'fixture', started_at: now - 7000, ends_at: now + 100000, status: 'active' });
  insert('rpg_boss_attacks', { boss_id: 'fixture-boss', tg_id: 'fixture-sword', win: 1, damage: 5678, created_at: now - 1 });
  insert('rpg_guardian_operations', { operation_id: 'fixture-guardian-operation', account_id: 'fixture-account-a', char_id: 'fixture-sword', request_id: 'fixture-summon-request',
    action: 'summon', payload_hash: 'a'.repeat(64), config_version: 'fixture-v1', cost_json: '{"gold":1234}', result_json: '{"ids":["fixture-active-guardian"]}', created_at: now });
  for (const [id, kind, ref, category, class_req, seq] of [
    ['fixture-equip-listing', 'equip', 'fixture-escrow-equipment', 'equipment', 'sword', 10],
    ['fixture-guardian-listing', 'guardian', 'fixture-exchange-guardian', 'guardian', 'any', 20],
  ]) insert('rpg_exchange_listings', { seq, id, seller_account: 'fixture-account-a', seller_char: 'fixture-sword', buyer_char: null, kind, ref, qty: 1, price: 12345, fee: 618,
    category, class_req, tier: kind === 'equip' ? 12 : null, quality: 'legendary', enhance: kind === 'equip' ? 7 : null,
    snapshot_json: '{"name":"完整測試快照","nested":{"roll":0.375}}', status: 'active', rev: 3, created_at: now - 6000, updated_at: now - 3000, closed_at: null });
  const guardian = (id, overrides) => ({ id, char_id: 'fixture-sword', type: 'melee', quality: 6, bound: 0, active: 0, locked: 0, trade_id: null,
    rev: 17, source_operation_id: 'fixture-guardian-operation', created_at: now - 100, updated_at: now - 50, exchange_id: null, ...overrides });
  insert('rpg_guardian_sigils', guardian('fixture-active-guardian', { bound: 1, active: 1 }));
  insert('rpg_guardian_sigils', guardian('fixture-locked-guardian', { locked: 1 }));
  insert('rpg_guardian_sigils', guardian('fixture-trade-guardian', { trade_id: 'fixture-trade' }));
  insert('rpg_guardian_sigils', guardian('fixture-exchange-guardian', { exchange_id: 'fixture-guardian-listing' }));
  insert('rpg_guardian_voucher_grants', { account_id: 'fixture-account-a', boss_id: 'fixture-boss', day: '2026-10-15', recipient_char_id: 'fixture-sword', created_at: now });
  insert('rpg_guardian_welcome', { account_id: 'fixture-account-a', recipient_char_id: 'fixture-sword', draws: 200, created_at: now });
  const equipment = (id, slot, pos = 0, extra = {}) => ({ id, tg_id: 'fixture-sword', slot, kind: slot === 'weapon' ? 'greatsword' : ['belt', 'undershirt', 'earring', 'ring'].includes(slot) ? slot : 'plate',
    class_req: ['belt', 'undershirt', 'earring', 'ring'].includes(slot) ? 'any' : 'sword', branch_req: slot === 'weapon' ? 'A' : null,
    tier: 12, level_req: 111, name: `測試完整裝備_${id}`, source: 'relic_boss', base_stat: 163, bonus_json: '{"critPct":0.05,"hp":73}', element: 'dark', element_stat: 49,
    element_tier: 'legendary', enhance_level: 7, is_equipped: pos, convert_token: slot === 'weapon' ? 1 : 0, created_at: now - 777,
    grade: 'relic', affix_json: '{"atk":95}', bound: 1, trade_id: null, affixes_json: '[{"key":"meleePct","score":99,"value":0.035}]', ...extra });
  for (const slot of ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'belt', 'undershirt']) insert('rpg_equipment', equipment(`fixture-equipped-${slot}`, slot, 1));
  for (const slot of ['earring', 'ring']) for (const pos of [1, 2]) insert('rpg_equipment', equipment(`fixture-equipped-${slot}-${pos}`, slot, pos));
  insert('rpg_equipment', equipment('fixture-escrow-equipment', 'weapon', 0, { bound: 0, trade_id: 'exchange:fixture-equip-listing' }));
  insert('rpg_equipment', equipment('fixture-traded-equipment', 'weapon', 0, { bound: 0, trade_id: 'fixture-trade' }));
  insert('rpg_equipment', equipment('fixture-enhance-equipment', 'weapon'));
  insert('rpg_equipment', equipment('fixture-reroll-equipment', 'armor'));
  insert('rpg_auto_enhance', { id: 'fixture-enhance', owner: 'fixture-account-a', tg_id: 'fixture-sword', item_id: 'fixture-enhance-equipment', item_name: '測試強化', target: 15, blessed: 1,
    status: 'running', level: 7, attempts: 21, spent_gold: 987, spent_scrolls: 36, rev: 4, next_at: now + 60000, created_at: now - 99, updated_at: now - 11 });
  insert('rpg_auto_reroll', { id: 'fixture-reroll', owner: 'fixture-account-b', tg_id: 'fixture-sword', item_id: 'fixture-reroll-equipment', item_name: '測試洗鍊', request_id: 'fixture-reroll-request',
    config_json: '{"locks":[0]}', class_snapshot: 'sword:A111', status: 'running', attempts: 11, spent_gold: 765, spent_scrolls: 24, result_json: '{"score":88}', rev: 5,
    next_at: now + 60000, created_at: now - 88, updated_at: now - 10 });
  insert('rpg_guardian_auto', { id: 'fixture-auto-guardian', owner: 'fixture-account-a', char_id: 'fixture-sword', request_id: 'fixture-guardian-auto-request', pool: 'featured', draw_count: 5,
    target_type: 'melee', target_rank: 6, max_gold: 9999, status: 'running', batches: 3, total_draws: 15, spent_gold: 1122, spent_vouchers: 2, used_free: 5, rev: 6, next_at: now + 30000, created_at: now - 55, updated_at: now - 9 });
  insert('rpg_parties', { id: 'fixture-party', leader_id: 'fixture-sword', kind: 'trial', status: 'active', rev: 12, state_json: '{"enemies":[{"hp":987}]}', created_at: now - 44, updated_at: now - 8, expires_at: now + 120000 });
  insert('rpg_party_members', { party_id: 'fixture-party', char_id: 'fixture-sword', account_id: 'fixture-account-a', ready: 1, joined_at: now - 40 });
  exec("UPDATE rpg_characters SET party_id='fixture-party' WHERE tg_id='fixture-sword'");
  // Populate every remaining business table so unintended side effects cannot hide behind empty tables.
  const leftovers = {
    rpg_admin_audit: { id: 'fixture-audit', action: 'fixture-review', details: '{"synthetic":true}', created_at: now },
    rpg_app_access: { tg_id: 'fixture-account-a', granted_at: now - 10, expires_at: now + 100000 },
    rpg_book_trade_operations: { char_id: 'fixture-sword', request_id: 'fixture-book-operation', trade_id: 'fixture-trade' },
    rpg_class_changes: { tg_id: 'fixture-sword', tier: 4, from_path: 'A11', to_path: 'A111', kind: 'advance', created_at: now - 100000 },
    rpg_exchange_operations: { account_tg_id: 'fixture-account-a', request_id: 'fixture-exchange-operation', char_id: 'fixture-sword', action: 'sell', payload_json: '{"fixture":true}', result_json: '{"id":"fixture-equip-listing"}', created_at: now },
    rpg_guard: { ok: 1 },
    rpg_idle_reports: { tg_id: 'fixture-sword', ticks: 71, kills: 123, gold_gained: 999, created_at: now },
    rpg_journal_cards: { day: '2026-10-15', chat_id: 'fixture-chat', message_id: 777 },
    rpg_journals: { account_id: 'fixture-account-a', day: '2026-10-15', char_id: 'fixture-sword', tier: 12, claims_json: '{"daily":true}', claim_count: 2, rev: 3, created_at: now },
    rpg_notice_dismissals: { account_tg_id: 'fixture-account-a', kind: 'guardian_summon', ref_id: 'fixture-notice-ref', created_at: now },
    rpg_outbox: { dedupe_key: 'fixture-outbox', target: 'group', tg_id: 'fixture-sword', kind: 'fixture', payload_json: '{"notSent":true}', created_at: now },
    rpg_party_operations: { party_id: 'fixture-party', char_id: 'fixture-sword', request_id: 'fixture-party-operation', result_json: '{"ok":true}' },
    rpg_party_presence: { account_id: 'fixture-account-a', party_id: 'fixture-party', char_id: 'fixture-sword' },
    rpg_party_rewards: { party_id: 'fixture-party', char_id: 'fixture-sword', reward_json: '{"gold":123}', created_at: now },
    rpg_pk: { id: 'fixture-pk', a_tg: 'fixture-sword', b_tg: 'fixture-mage', status: 'pending', created_at: now, expires_at: now + 100000 },
    rpg_share_likes: { share_id: 'fixture-share', tg_id: 'fixture-mage', created_at: now },
    rpg_shares: { id: 'fixture-share', tg_id: 'fixture-sword', equip_id: 'fixture-traded-equipment', kind: 'share', snapshot_json: '{"fixture":true}', likes: 2, status: 'open', created_at: now },
    rpg_trade_items: { trade_id: 'fixture-trade', side: 'a', kind: 'equip', ref: 'fixture-traded-equipment', qty: 1, snapshot_json: '{"enhance":7}' },
    rpg_trade_log: { trade_id: 'fixture-trade', tg_id: 'fixture-sword', action: 'lock', details: '{"offer_rev":7}', created_at: now },
    rpg_trade_operations: { trade_id: 'fixture-trade', tg_id: 'fixture-sword', request_id: 'fixture-trade-operation', result_json: '{"ok":true}', created_at: now },
    rpg_trade_requests: { id: 'fixture-request', share_id: 'fixture-share', equip_id: 'fixture-traded-equipment', owner_tg: 'fixture-sword', requester_tg: 'fixture-mage', status: 'accepted', trade_id: 'fixture-trade', created_at: now, expires_at: now + 100000 },
  };
  for (const [table, values] of Object.entries(leftovers)) insert(table, values);
  // A previously deleted high ID must not become reusable after table reconstruction.
  exec("UPDATE sqlite_sequence SET seq=5000 WHERE name='rpg_exchange_listings'");
  return statements;
}
