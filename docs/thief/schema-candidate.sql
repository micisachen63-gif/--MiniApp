-- REVIEW ONLY. NOT A PRODUCTION MIGRATION. Keep outside worker/migrations.
-- Must run as one atomic operation after live-schema matching, verified backup and explicit approval.
-- No BEGIN/COMMIT, FK disable or constraint-ignore workaround.

-- 1. preflight
CREATE TABLE "_thief_review_guard" (ok INTEGER NOT NULL CHECK(ok=1));

-- 2. preflight-schema
WITH expected(type,name,tbl_name,sql) AS (VALUES ('index','idx_guardian_grants_day','rpg_guardian_voucher_grants','CREATE INDEX idx_guardian_grants_day ON rpg_guardian_voucher_grants(account_id,day)'),
('index','idx_guardian_one_active','rpg_guardian_sigils','CREATE UNIQUE INDEX idx_guardian_one_active ON rpg_guardian_sigils(char_id) WHERE active=1'),
('index','idx_guardian_operations_owner','rpg_guardian_operations','CREATE INDEX idx_guardian_operations_owner ON rpg_guardian_operations(char_id,created_at,operation_id)'),
('index','idx_guardian_owner','rpg_guardian_sigils','CREATE INDEX idx_guardian_owner ON rpg_guardian_sigils(char_id,created_at,id)'),
('index','idx_guardian_trade','rpg_guardian_sigils','CREATE INDEX idx_guardian_trade ON rpg_guardian_sigils(trade_id) WHERE trade_id IS NOT NULL'),
('index','idx_rpg_boss_attack_owner_day','rpg_boss_attacks','CREATE INDEX idx_rpg_boss_attack_owner_day ON rpg_boss_attacks(tg_id,created_at)'),
('index','idx_rpg_boss_status','rpg_boss_instances','CREATE INDEX idx_rpg_boss_status ON rpg_boss_instances(status, ends_at)'),
('index','idx_rpg_characters_account','rpg_characters','CREATE INDEX idx_rpg_characters_account ON rpg_characters(account_tg_id, char_slot)'),
('index','idx_rpg_characters_account_slot','rpg_characters','CREATE UNIQUE INDEX idx_rpg_characters_account_slot ON rpg_characters(account_tg_id, char_slot)'),
('index','idx_rpg_characters_username','rpg_characters','CREATE INDEX idx_rpg_characters_username ON rpg_characters(tg_username COLLATE NOCASE)'),
('index','idx_rpg_equipment_owner','rpg_equipment','CREATE INDEX idx_rpg_equipment_owner ON rpg_equipment(tg_id, is_equipped)'),
('index','idx_rpg_equipment_trade','rpg_equipment','CREATE INDEX idx_rpg_equipment_trade ON rpg_equipment(trade_id) WHERE trade_id IS NOT NULL'),
('index','idx_rpg_ledger_owner','rpg_ledger','CREATE INDEX idx_rpg_ledger_owner ON rpg_ledger(tg_id, created_at)'),
('index','idx_rpg_likes_owner_day','rpg_share_likes','CREATE INDEX idx_rpg_likes_owner_day ON rpg_share_likes(tg_id,created_at)'),
('index','idx_rpg_outbox_delivery','rpg_outbox','CREATE INDEX idx_rpg_outbox_delivery
  ON rpg_outbox(delivered_at, claimed_at, id)'),
('index','idx_rpg_outbox_failed','rpg_outbox','CREATE INDEX idx_rpg_outbox_failed ON rpg_outbox(failed_at) WHERE failed_at IS NOT NULL'),
('index','idx_rpg_outbox_pending','rpg_outbox','CREATE INDEX idx_rpg_outbox_pending ON rpg_outbox(claimed_at, id)'),
('index','idx_rpg_outbox_retry','rpg_outbox','CREATE INDEX idx_rpg_outbox_retry
 ON rpg_outbox(next_attempt_at,claimed_at,id)
 WHERE delivered_at IS NULL AND failed_at IS NULL'),
('index','idx_rpg_party_member_account','rpg_party_members','CREATE INDEX idx_rpg_party_member_account ON rpg_party_members(account_id,party_id)'),
('index','idx_rpg_pk_a','rpg_pk','CREATE INDEX idx_rpg_pk_a ON rpg_pk(a_tg, status, decided_at)'),
('index','idx_rpg_pk_b','rpg_pk','CREATE INDEX idx_rpg_pk_b ON rpg_pk(b_tg, status, decided_at)'),
('index','idx_rpg_pk_open','rpg_pk','CREATE INDEX idx_rpg_pk_open ON rpg_pk(status, expires_at)'),
('index','idx_rpg_reports_owner','rpg_idle_reports','CREATE INDEX idx_rpg_reports_owner ON rpg_idle_reports(tg_id, created_at)'),
('index','idx_rpg_shares_equip','rpg_shares','CREATE INDEX idx_rpg_shares_equip ON rpg_shares(equip_id, created_at)'),
('index','idx_rpg_shares_owner','rpg_shares','CREATE INDEX idx_rpg_shares_owner ON rpg_shares(tg_id, created_at)'),
('index','idx_rpg_trade_log_trade','rpg_trade_log','CREATE INDEX idx_rpg_trade_log_trade ON rpg_trade_log(trade_id, id)'),
('index','idx_rpg_trades_a','rpg_trades','CREATE INDEX idx_rpg_trades_a ON rpg_trades(a_tg, status)'),
('index','idx_rpg_trades_b','rpg_trades','CREATE INDEX idx_rpg_trades_b ON rpg_trades(b_tg, status)'),
('index','idx_rpg_trades_open','rpg_trades','CREATE INDEX idx_rpg_trades_open ON rpg_trades(status, expires_at)'),
('index','idx_rpg_treq_once','rpg_trade_requests','CREATE UNIQUE INDEX idx_rpg_treq_once ON rpg_trade_requests(share_id, requester_tg) WHERE status = ''pending'''),
('index','idx_rpg_treq_owner','rpg_trade_requests','CREATE INDEX idx_rpg_treq_owner ON rpg_trade_requests(owner_tg, status)'),
('index','idx_rpg_treq_req','rpg_trade_requests','CREATE INDEX idx_rpg_treq_req ON rpg_trade_requests(requester_tg, status)'),
('index','rpg_auto_enhance_due','rpg_auto_enhance','CREATE INDEX rpg_auto_enhance_due ON rpg_auto_enhance(status,next_at)'),
('index','rpg_auto_enhance_owner','rpg_auto_enhance','CREATE UNIQUE INDEX rpg_auto_enhance_owner ON rpg_auto_enhance(owner) WHERE status IN (''running'',''processing'')'),
('index','rpg_auto_reroll_due','rpg_auto_reroll','CREATE INDEX rpg_auto_reroll_due ON rpg_auto_reroll(status,next_at)'),
('index','rpg_auto_reroll_item','rpg_auto_reroll','CREATE INDEX rpg_auto_reroll_item ON rpg_auto_reroll(item_id,status)'),
('index','rpg_auto_reroll_owner','rpg_auto_reroll','CREATE UNIQUE INDEX rpg_auto_reroll_owner ON rpg_auto_reroll(owner) WHERE status IN (''running'',''processing'')'),
('index','rpg_background_operations_pending','rpg_background_operations','CREATE INDEX rpg_background_operations_pending ON rpg_background_operations(owner,dismissed_at,seq)'),
('index','rpg_exchange_active','rpg_exchange_listings','CREATE INDEX rpg_exchange_active ON rpg_exchange_listings(status,seq DESC)'),
('index','rpg_exchange_category','rpg_exchange_listings','CREATE INDEX rpg_exchange_category ON rpg_exchange_listings(status,category,seq DESC)'),
('index','rpg_exchange_class','rpg_exchange_listings','CREATE INDEX rpg_exchange_class ON rpg_exchange_listings(status,class_req,seq DESC)'),
('index','rpg_exchange_enhance_item','rpg_auto_enhance','CREATE INDEX rpg_exchange_enhance_item ON rpg_auto_enhance(item_id,status)'),
('index','rpg_exchange_equipment','rpg_exchange_listings','CREATE UNIQUE INDEX rpg_exchange_equipment ON rpg_exchange_listings(ref) WHERE status=''active'' AND kind=''equip'''),
('index','rpg_exchange_guardian','rpg_exchange_listings','CREATE UNIQUE INDEX rpg_exchange_guardian ON rpg_exchange_listings(ref) WHERE status=''active'' AND kind=''guardian'''),
('index','rpg_exchange_history','rpg_exchange_listings','CREATE INDEX rpg_exchange_history ON rpg_exchange_listings(seller_account,seq DESC)'),
('index','rpg_exchange_quality','rpg_exchange_listings','CREATE INDEX rpg_exchange_quality ON rpg_exchange_listings(status,quality,seq DESC)'),
('index','rpg_exchange_seller','rpg_exchange_listings','CREATE INDEX rpg_exchange_seller ON rpg_exchange_listings(seller_account,status,seq DESC)'),
('index','rpg_exchange_tier','rpg_exchange_listings','CREATE INDEX rpg_exchange_tier ON rpg_exchange_listings(status,tier,seq DESC)'),
('index','rpg_guardian_auto_due','rpg_guardian_auto','CREATE INDEX rpg_guardian_auto_due ON rpg_guardian_auto(status,next_at)'),
('index','rpg_guardian_auto_notice','rpg_guardian_auto','CREATE INDEX rpg_guardian_auto_notice ON rpg_guardian_auto(owner,seen_at,created_at)'),
('index','rpg_guardian_auto_owner','rpg_guardian_auto','CREATE UNIQUE INDEX rpg_guardian_auto_owner ON rpg_guardian_auto(owner) WHERE status=''running'''),
('index','rpg_guardian_exchange','rpg_guardian_sigils','CREATE UNIQUE INDEX rpg_guardian_exchange ON rpg_guardian_sigils(exchange_id) WHERE exchange_id IS NOT NULL'),
('index','rpg_parties_open','rpg_parties','CREATE INDEX rpg_parties_open ON rpg_parties(status,expires_at)'),
('table','rpg_accounts','rpg_accounts','CREATE TABLE rpg_accounts (
  account_tg_id TEXT PRIMARY KEY,
  active_char_id TEXT,
  updated_at INTEGER NOT NULL
)'),
('table','rpg_admin_audit','rpg_admin_audit','CREATE TABLE rpg_admin_audit (
  id TEXT PRIMARY KEY, admin_tg_id TEXT, action TEXT NOT NULL, details TEXT, created_at INTEGER NOT NULL
)'),
('table','rpg_app_access','rpg_app_access','CREATE TABLE rpg_app_access (
  tg_id TEXT PRIMARY KEY,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
)'),
('table','rpg_auto_enhance','rpg_auto_enhance','CREATE TABLE rpg_auto_enhance (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, tg_id TEXT NOT NULL, item_id TEXT NOT NULL,
 item_name TEXT NOT NULL, target INTEGER NOT NULL CHECK(target BETWEEN 1 AND 15), blessed INTEGER NOT NULL,
 status TEXT NOT NULL, reason TEXT, level INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 spent_gold INTEGER NOT NULL DEFAULT 0, spent_scrolls INTEGER NOT NULL DEFAULT 0,
 rev INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)'),
('table','rpg_auto_reroll','rpg_auto_reroll','CREATE TABLE rpg_auto_reroll (
 id TEXT PRIMARY KEY,owner TEXT NOT NULL,tg_id TEXT NOT NULL,item_id TEXT NOT NULL,item_name TEXT NOT NULL,
 request_id TEXT NOT NULL,config_json TEXT NOT NULL,class_snapshot TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN (''running'',''processing'',''ended'')),reason TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,spent_gold INTEGER NOT NULL DEFAULT 0,spent_scrolls INTEGER NOT NULL DEFAULT 0,
 result_json TEXT NOT NULL DEFAULT ''{}'',rev INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 UNIQUE(owner,request_id)
)'),
('table','rpg_background_operations','rpg_background_operations','CREATE TABLE rpg_background_operations (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN (''auto_enhance_end'',''guardian_auto'',''auto_reroll_end'')),
 ref_id TEXT NOT NULL,created_at INTEGER NOT NULL,dismissed_at INTEGER,
 UNIQUE(kind,ref_id)
)'),
('table','rpg_book_trade_operations','rpg_book_trade_operations','CREATE TABLE rpg_book_trade_operations (
 char_id TEXT NOT NULL, request_id TEXT NOT NULL, trade_id TEXT NOT NULL,
 PRIMARY KEY(char_id,request_id)
)'),
('table','rpg_boss_attacks','rpg_boss_attacks','CREATE TABLE rpg_boss_attacks (
  boss_id TEXT NOT NULL,
  tg_id TEXT NOT NULL,
  win INTEGER NOT NULL,                -- one attack per player per 3-minute window
  damage INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (boss_id, tg_id, win)
)'),
('table','rpg_boss_instances','rpg_boss_instances','CREATE TABLE rpg_boss_instances (
  id TEXT PRIMARY KEY,                 -- b<YYYYMMDD><HH> (Taipei slot) — one boss per slot
  chat_id TEXT,
  map_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  element TEXT,
  base_hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  hp INTEGER NOT NULL CHECK (hp >= 0),
  participants INTEGER NOT NULL DEFAULT 0,
  spawn_reason TEXT,
  started_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT ''active'' CHECK (status IN (''active'',''settling'',''killed'',''fled'',''vanished'')),
  message_chat_id TEXT, message_id INTEGER,
  result_json TEXT,
  settled_at INTEGER
)'),
('table','rpg_characters','rpg_characters','CREATE TABLE rpg_characters (
  tg_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tg_name TEXT,
  gender TEXT NOT NULL CHECK (gender IN (''m'',''f'')),
  base_class TEXT NOT NULL CHECK (base_class IN (''mage'',''sword'',''archer'')),
  class_path TEXT NOT NULL DEFAULT '''',
  pending_tier INTEGER,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 120),
  exp INTEGER NOT NULL DEFAULT 0 CHECK (exp >= 0),
  hp INTEGER NOT NULL,
  mp INTEGER NOT NULL,
  map_id INTEGER NOT NULL DEFAULT 1,
  idle_state TEXT NOT NULL DEFAULT ''fighting'' CHECK (idle_state IN (''fighting'',''no_mp'',''town_no_red'',''reviving'',''gate'')),
  state_until INTEGER,
  auto_red_pct INTEGER NOT NULL DEFAULT 50 CHECK (auto_red_pct BETWEEN 20 AND 80),
  auto_blue INTEGER NOT NULL DEFAULT 1,
  gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
  last_settle_at INTEGER NOT NULL,
  last_daily_gold_day TEXT,
  penalty_day TEXT,
  penalties_today INTEGER NOT NULL DEFAULT 0,
  drop_day TEXT,                       -- Taipei day of drops_today (idle scroll daily caps)
  drops_today TEXT,                    -- JSON {scroll_w,scroll_a,scroll_r}
  deaths_total INTEGER NOT NULL DEFAULT 0,
  last_reselect_at INTEGER,
  boss_down_until INTEGER,
  ladder_points INTEGER NOT NULL DEFAULT 100,
  pvp_wins INTEGER NOT NULL DEFAULT 0,
  pvp_losses INTEGER NOT NULL DEFAULT 0,
  created_day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0
, tg_username TEXT, account_tg_id TEXT, char_slot INTEGER NOT NULL DEFAULT 1 CHECK (char_slot BETWEEN 1 AND 4), special_json TEXT NOT NULL DEFAULT ''{}'', party_id TEXT, idle_combat_json TEXT, guardian_draw_remainder INTEGER NOT NULL DEFAULT 0
 CHECK(guardian_draw_remainder BETWEEN 0 AND 4), collection_active_map INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(collection_active_map)=''integer'' AND collection_active_map BETWEEN 0 AND 12))'),
('table','rpg_class_changes','rpg_class_changes','CREATE TABLE rpg_class_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL, tier INTEGER NOT NULL, from_path TEXT, to_path TEXT, kind TEXT NOT NULL, created_at INTEGER NOT NULL
)'),
('table','rpg_daily_counters','rpg_daily_counters','CREATE TABLE rpg_daily_counters (
  tg_id TEXT NOT NULL, day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tg_id, day, key)
)'),
('table','rpg_equipment','rpg_equipment','CREATE TABLE "rpg_equipment" (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN (''weapon'',''helmet'',''armor'',''gloves'',''boots'',''belt'',''undershirt'',''earring'',''ring'')),
  kind TEXT NOT NULL,
  class_req TEXT NOT NULL CHECK (class_req IN (''mage'',''sword'',''archer'',''any'')),
  branch_req TEXT CHECK (branch_req IS NULL OR branch_req IN (''A'',''B'')),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 12),
  level_req INTEGER NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT ''shop'',
  base_stat INTEGER NOT NULL,
  bonus_json TEXT,
  element TEXT,
  element_stat INTEGER NOT NULL DEFAULT 0,
  element_tier TEXT NOT NULL DEFAULT ''common'',
  enhance_level INTEGER NOT NULL DEFAULT 0,
  is_equipped INTEGER NOT NULL DEFAULT 0 CHECK (is_equipped BETWEEN 0 AND 2),
  convert_token INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  grade TEXT NOT NULL DEFAULT ''normal'' CHECK (grade IN (''normal'',''relic'')),
  affix_json TEXT,
  bound INTEGER NOT NULL DEFAULT 0,
  trade_id TEXT, affixes_json TEXT NOT NULL DEFAULT ''[]'',
  CHECK (trade_id IS NULL OR is_equipped = 0)
)'),
('table','rpg_exchange_listings','rpg_exchange_listings','CREATE TABLE rpg_exchange_listings (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 seller_account TEXT NOT NULL, seller_char TEXT NOT NULL, buyer_char TEXT,
 kind TEXT NOT NULL CHECK(kind IN (''equip'',''item'',''guardian'')), ref TEXT NOT NULL,
 qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 99999),
 price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 1000000),
 fee INTEGER NOT NULL CHECK(fee=(price+19)/20),
 category TEXT NOT NULL CHECK(category IN (''equipment'',''scroll'',''collection'',''skillbook'',''other'',''guardian'')),
 class_req TEXT NOT NULL CHECK(class_req IN (''any'',''sword'',''archer'',''mage'')), tier INTEGER CHECK(tier BETWEEN 1 AND 12),
 quality TEXT, enhance INTEGER, snapshot_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN (''active'',''sold'',''cancelled'')),
 rev INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 closed_at INTEGER, CHECK(kind=''item'' OR qty=1)
)'),
('table','rpg_exchange_operations','rpg_exchange_operations','CREATE TABLE rpg_exchange_operations (
 account_tg_id TEXT NOT NULL, request_id TEXT NOT NULL, char_id TEXT NOT NULL,
 action TEXT NOT NULL, payload_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(account_tg_id,request_id)
)'),
('table','rpg_guard','rpg_guard','CREATE TABLE rpg_guard (ok INTEGER NOT NULL)'),
('table','rpg_guardian_auto','rpg_guardian_auto','CREATE TABLE rpg_guardian_auto (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, char_id TEXT NOT NULL,
 request_id TEXT NOT NULL, pool TEXT NOT NULL CHECK(pool IN (''normal'',''featured'')),
 draw_count INTEGER NOT NULL CHECK(draw_count IN (5,10)),
 target_type TEXT NOT NULL CHECK(target_type IN (''any'',''attack'',''melee'',''ranged'',''magic'',''loot'')),
 target_rank INTEGER NOT NULL CHECK(target_rank BETWEEN 0 AND 6),
 max_gold INTEGER CHECK(max_gold IS NULL OR max_gold>=0),
 status TEXT NOT NULL CHECK(status IN (''running'',''ended'')), reason TEXT, match_id TEXT,
 batches INTEGER NOT NULL DEFAULT 0, total_draws INTEGER NOT NULL DEFAULT 0,
 spent_gold INTEGER NOT NULL DEFAULT 0, spent_vouchers INTEGER NOT NULL DEFAULT 0,
 used_free INTEGER NOT NULL DEFAULT 0, counts_json TEXT NOT NULL DEFAULT ''[0,0,0,0,0,0,0,0]'',
 rev INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,seen_at INTEGER,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL, single_draw INTEGER NOT NULL DEFAULT 0 CHECK(single_draw IN (0,1)),UNIQUE(owner,request_id)
)'),
('table','rpg_guardian_operations','rpg_guardian_operations','CREATE TABLE rpg_guardian_operations (
 operation_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 6 AND 100),
 action TEXT NOT NULL CHECK(action IN(''summon'',''fuse'',''activate'',''lock'',''unbind'',''share'')),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 config_version TEXT NOT NULL,
 cost_json TEXT NOT NULL CHECK(json_valid(cost_json)),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at INTEGER NOT NULL,
 UNIQUE(char_id,request_id)
)'),
('table','rpg_guardian_sigils','rpg_guardian_sigils','CREATE TABLE rpg_guardian_sigils (
 id TEXT PRIMARY KEY,
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 type TEXT NOT NULL CHECK(type IN(''melee'',''ranged'',''magic'',''loot'')),
 quality INTEGER NOT NULL CHECK(quality BETWEEN 1 AND 8),
 bound INTEGER NOT NULL DEFAULT 0 CHECK(bound IN(0,1)),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),
 locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN(0,1)),
 trade_id TEXT REFERENCES rpg_trades(id),
 rev INTEGER NOT NULL DEFAULT 0 CHECK(rev>=0),
 source_operation_id TEXT NOT NULL REFERENCES rpg_guardian_operations(operation_id),
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL, exchange_id TEXT REFERENCES rpg_exchange_listings(id),
 CHECK(active=0 OR bound=1),
 CHECK(trade_id IS NULL OR (active=0 AND bound=0 AND locked=0))
)'),
('table','rpg_guardian_voucher_grants','rpg_guardian_voucher_grants','CREATE TABLE rpg_guardian_voucher_grants (
 account_id TEXT NOT NULL REFERENCES rpg_accounts(account_tg_id),
 boss_id TEXT NOT NULL REFERENCES rpg_boss_instances(id),
 day TEXT NOT NULL,
 recipient_char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,boss_id),
 CHECK(day=date(created_at/1000,''unixepoch'',''+8 hours''))
)'),
('table','rpg_guardian_welcome','rpg_guardian_welcome','CREATE TABLE rpg_guardian_welcome (
 account_id TEXT PRIMARY KEY REFERENCES rpg_accounts(account_tg_id),
 recipient_char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 draws INTEGER NOT NULL DEFAULT 200 CHECK(draws=200),
 created_at INTEGER NOT NULL
)'),
('table','rpg_idle_reports','rpg_idle_reports','CREATE TABLE rpg_idle_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  from_at INTEGER, to_at INTEGER, ticks INTEGER, skipped_ticks INTEGER,
  kills INTEGER, exp_gained INTEGER, exp_lost INTEGER, deaths INTEGER, elites INTEGER, gold_gained INTEGER,
  used_json TEXT, drops_json TEXT, levels_gained INTEGER, end_state TEXT, created_at INTEGER NOT NULL
)'),
('table','rpg_inventory','rpg_inventory','CREATE TABLE rpg_inventory (
  tg_id TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (tg_id, item)
)'),
('table','rpg_journal_cards','rpg_journal_cards','CREATE TABLE rpg_journal_cards (
 day TEXT PRIMARY KEY, chat_id TEXT NOT NULL, message_id INTEGER
)'),
('table','rpg_journals','rpg_journals','CREATE TABLE rpg_journals (
 account_id TEXT NOT NULL, day TEXT NOT NULL, char_id TEXT NOT NULL,
 tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 12), checked_at INTEGER,
 claims_json TEXT NOT NULL DEFAULT ''{}'', claim_count INTEGER NOT NULL DEFAULT 0 CHECK(claim_count BETWEEN 0 AND 3),
 bonus_claimed INTEGER NOT NULL DEFAULT 0 CHECK(bonus_claimed IN(0,1)),
 rev INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,day)
)'),
('table','rpg_ledger','rpg_ledger','CREATE TABLE rpg_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  tg_id TEXT NOT NULL,
  type TEXT NOT NULL,
  gold_delta INTEGER NOT NULL DEFAULT 0,
  item TEXT,
  item_delta INTEGER NOT NULL DEFAULT 0,
  exp_delta INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL
)'),
('table','rpg_notice_dismissals','rpg_notice_dismissals','CREATE TABLE rpg_notice_dismissals (
 account_tg_id TEXT NOT NULL REFERENCES rpg_accounts(account_tg_id),
 kind TEXT NOT NULL CHECK(kind IN(''auto_enhance_end'',''guardian_summon'',''guardian_fuse'')),
 ref_id TEXT NOT NULL CHECK(length(ref_id) BETWEEN 8 AND 120),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(account_tg_id,kind,ref_id)
)'),
('table','rpg_outbox','rpg_outbox','CREATE TABLE rpg_outbox (            -- messages for 小精靈 to deliver (the Worker never calls Telegram in P1)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT UNIQUE,
  target TEXT NOT NULL CHECK (target IN (''group'',''dm'')),
  tg_id TEXT,
  kind TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER
, delivered_at INTEGER, claim_token TEXT, claim_attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, failed_at INTEGER, last_error_code INTEGER, last_error TEXT)'),
('table','rpg_parties','rpg_parties','CREATE TABLE rpg_parties (
 id TEXT PRIMARY KEY, leader_id TEXT NOT NULL, kind TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT ''lobby'', rev INTEGER NOT NULL DEFAULT 0,
 state_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, chat_id TEXT, message_id INTEGER
)'),
('table','rpg_party_members','rpg_party_members','CREATE TABLE rpg_party_members (
 party_id TEXT NOT NULL REFERENCES rpg_parties(id), char_id TEXT NOT NULL,
 account_id TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0,
 joined_at INTEGER NOT NULL, PRIMARY KEY(party_id,char_id), UNIQUE(party_id,account_id)
)'),
('table','rpg_party_operations','rpg_party_operations','CREATE TABLE rpg_party_operations (
 party_id TEXT NOT NULL, char_id TEXT NOT NULL, request_id TEXT NOT NULL,
 result_json TEXT NOT NULL, PRIMARY KEY(party_id,char_id,request_id)
)'),
('table','rpg_party_presence','rpg_party_presence','CREATE TABLE rpg_party_presence (
 account_id TEXT PRIMARY KEY, party_id TEXT NOT NULL, char_id TEXT NOT NULL UNIQUE
)'),
('table','rpg_party_rewards','rpg_party_rewards','CREATE TABLE rpg_party_rewards (
 party_id TEXT NOT NULL, char_id TEXT NOT NULL, reward_json TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(party_id,char_id)
)'),
('table','rpg_pk','rpg_pk','CREATE TABLE rpg_pk (
  id TEXT PRIMARY KEY,
  a_tg TEXT NOT NULL,                  -- challenger
  b_tg TEXT NOT NULL,                  -- challenged
  status TEXT NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'',''done'',''declined'',''cancelled'',''expired'')),
  origin TEXT NOT NULL DEFAULT ''app'',  -- app | group
  chat_id TEXT, message_id INTEGER,    -- group card
  winner_tg TEXT, loser_tg TEXT,
  seed INTEGER,                        -- crypto-random at accept time (replayable, not predictable)
  rounds INTEGER, log_json TEXT,       -- summary for the card / Mini App replay
  drop_equip_id TEXT, drop_json TEXT, ward_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER,
  CHECK (a_tg <> b_tg)
)'),
('table','rpg_share_likes','rpg_share_likes','CREATE TABLE rpg_share_likes (
  share_id TEXT NOT NULL, tg_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, tg_id)
)'),
('table','rpg_shares','rpg_shares','CREATE TABLE "rpg_shares" (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,
  equip_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (''share'',''relic'',''pk'',''enhance'')),
  snapshot_json TEXT NOT NULL,
  context_json TEXT,
  tradeable INTEGER NOT NULL DEFAULT 1,
  likes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT ''open'' CHECK (status IN (''open'',''traded'')),
  chat_id TEXT,
  message_id INTEGER,
  created_at INTEGER NOT NULL
, object_kind TEXT NOT NULL DEFAULT ''equip'' CHECK(object_kind IN (''equip'',''sigil'')))'),
('table','rpg_trade_items','rpg_trade_items','CREATE TABLE "rpg_trade_items" (
 trade_id TEXT NOT NULL,
 side TEXT NOT NULL CHECK(side IN (''a'',''b'')),
 kind TEXT NOT NULL CHECK(kind IN (''equip'',''item'',''sigil'')),
 ref TEXT NOT NULL,
 qty INTEGER NOT NULL DEFAULT 1 CHECK(qty>0),
 snapshot_json TEXT,
 PRIMARY KEY(trade_id,side,kind,ref)
)'),
('table','rpg_trade_log','rpg_trade_log','CREATE TABLE rpg_trade_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL,
  tg_id TEXT,
  action TEXT NOT NULL,                -- open | add | remove | gold | confirm | unconfirm | done | cancel | expire
  details TEXT,
  created_at INTEGER NOT NULL
)'),
('table','rpg_trade_operations','rpg_trade_operations','CREATE TABLE rpg_trade_operations (
  trade_id TEXT NOT NULL,
  tg_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trade_id, tg_id, request_id)
)'),
('table','rpg_trade_requests','rpg_trade_requests','CREATE TABLE rpg_trade_requests (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  equip_id TEXT NOT NULL,
  owner_tg TEXT NOT NULL,
  requester_tg TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'',''accepted'',''rejected'',''expired'',''cancelled'')),
  trade_id TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER, object_kind TEXT NOT NULL DEFAULT ''equip'' CHECK(object_kind IN (''equip'',''sigil'')),
  CHECK (owner_tg <> requester_tg)
)'),
('table','rpg_trades','rpg_trades','CREATE TABLE rpg_trades (
  id TEXT PRIMARY KEY,
  a_tg TEXT NOT NULL,                  -- initiator
  b_tg TEXT NOT NULL,                  -- counterparty
  status TEXT NOT NULL DEFAULT ''open'' CHECK (status IN (''open'',''done'',''cancelled'',''expired'')),
  a_gold INTEGER NOT NULL DEFAULT 0 CHECK (a_gold BETWEEN 0 AND 1000000),   -- escrowed gold (already taken from the wallet)
  b_gold INTEGER NOT NULL DEFAULT 0 CHECK (b_gold BETWEEN 0 AND 1000000),
  a_ok INTEGER NOT NULL DEFAULT 0, b_ok INTEGER NOT NULL DEFAULT 0,
  offer_rev INTEGER NOT NULL DEFAULT 0,   -- content version: any change resets both confirmations; confirm must name it
  rev INTEGER NOT NULL DEFAULT 0,         -- row lock (every write)
  origin TEXT NOT NULL DEFAULT ''app'',     -- app | group
  chat_id TEXT, message_id INTEGER,       -- group trade card
  tax_gold INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  closed_at INTEGER, closed_by TEXT, a_lock INTEGER NOT NULL DEFAULT 0, b_lock INTEGER NOT NULL DEFAULT 0, share_id TEXT, request_id TEXT,
  CHECK (a_tg <> b_tg)
)'),
('trigger','background_enhance_dismiss','rpg_notice_dismissals','CREATE TRIGGER background_enhance_dismiss AFTER INSERT ON rpg_notice_dismissals WHEN NEW.kind=''auto_enhance_end''
BEGIN UPDATE rpg_background_operations SET dismissed_at=COALESCE(dismissed_at,NEW.created_at) WHERE owner=NEW.account_tg_id AND kind=NEW.kind AND ref_id=NEW.ref_id; END'),
('trigger','background_enhance_start','rpg_auto_enhance','CREATE TRIGGER background_enhance_start AFTER INSERT ON rpg_auto_enhance
BEGIN INSERT INTO rpg_background_operations(owner,kind,ref_id,created_at) VALUES(NEW.owner,''auto_enhance_end'',NEW.id,NEW.created_at); END'),
('trigger','background_guardian_seen','rpg_guardian_auto','CREATE TRIGGER background_guardian_seen AFTER UPDATE OF seen_at ON rpg_guardian_auto WHEN NEW.seen_at IS NOT NULL AND NEW.status=''ended''
BEGIN UPDATE rpg_background_operations SET dismissed_at=COALESCE(dismissed_at,NEW.seen_at) WHERE owner=NEW.owner AND kind=''guardian_auto'' AND ref_id=NEW.id; END'),
('trigger','background_guardian_start','rpg_guardian_auto','CREATE TRIGGER background_guardian_start AFTER INSERT ON rpg_guardian_auto
BEGIN INSERT INTO rpg_background_operations(owner,kind,ref_id,created_at) VALUES(NEW.owner,''guardian_auto'',NEW.id,NEW.created_at); END'),
('trigger','background_reroll_start','rpg_auto_reroll','CREATE TRIGGER background_reroll_start AFTER INSERT ON rpg_auto_reroll
BEGIN INSERT INTO rpg_background_operations(owner,kind,ref_id,created_at) VALUES(NEW.owner,''auto_reroll_end'',NEW.id,NEW.created_at); END'),
('trigger','collection_blessing_keep_delete','rpg_inventory','CREATE TRIGGER collection_blessing_keep_delete BEFORE DELETE ON rpg_inventory
WHEN OLD.item LIKE ''collection_%'' BEGIN
 SELECT RAISE(ABORT,''collection_active_owned'') WHERE EXISTS(
  SELECT 1 FROM rpg_characters WHERE tg_id=OLD.tg_id AND collection_active_map>0 AND OLD.item=''collection_''||collection_active_map);
END'),
('trigger','collection_blessing_keep_update','rpg_inventory','CREATE TRIGGER collection_blessing_keep_update BEFORE UPDATE OF quantity,item,tg_id ON rpg_inventory
WHEN OLD.item LIKE ''collection_%'' AND (NEW.quantity<1 OR NEW.item<>OLD.item OR NEW.tg_id<>OLD.tg_id) BEGIN
 SELECT RAISE(ABORT,''collection_active_owned'') WHERE EXISTS(
  SELECT 1 FROM rpg_characters WHERE tg_id=OLD.tg_id AND collection_active_map>0 AND OLD.item=''collection_''||collection_active_map);
END'),
('trigger','collection_blessing_owner','rpg_characters','CREATE TRIGGER collection_blessing_owner BEFORE UPDATE OF collection_active_map ON rpg_characters
WHEN NEW.collection_active_map<>OLD.collection_active_map AND NEW.collection_active_map>0 BEGIN
 SELECT RAISE(ABORT,''collection_not_owned'') WHERE NOT EXISTS(
  SELECT 1 FROM rpg_inventory WHERE tg_id=NEW.tg_id AND item=''collection_''||NEW.collection_active_map AND quantity>0);
END'),
('trigger','collection_blessing_party','rpg_characters','CREATE TRIGGER collection_blessing_party BEFORE UPDATE OF collection_active_map ON rpg_characters
WHEN NEW.collection_active_map<>OLD.collection_active_map AND OLD.party_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,''collection_party_locked'');
END'),
('trigger','guardian_grant_guard','rpg_guardian_voucher_grants','CREATE TRIGGER guardian_grant_guard BEFORE INSERT ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,''guardian_invalid_participant'') WHERE NOT EXISTS(
  SELECT 1 FROM rpg_characters c JOIN rpg_boss_attacks a ON a.tg_id=c.tg_id
  WHERE c.tg_id=NEW.recipient_char_id AND c.account_tg_id=NEW.account_id
   AND a.boss_id=NEW.boss_id AND a.damage>0
 );
 SELECT RAISE(ABORT,''guardian_voucher_daily_cap'') WHERE COALESCE((SELECT n FROM rpg_daily_counters
  WHERE tg_id=NEW.account_id AND day=NEW.day AND key=''guardian_voucher''),0)>=4
 ;
END'),
('trigger','guardian_grant_no_delete','rpg_guardian_voucher_grants','CREATE TRIGGER guardian_grant_no_delete BEFORE DELETE ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,''guardian_grant_immutable'');
END'),
('trigger','guardian_grant_no_update','rpg_guardian_voucher_grants','CREATE TRIGGER guardian_grant_no_update BEFORE UPDATE ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,''guardian_grant_immutable'');
END'),
('trigger','guardian_grant_resources','rpg_guardian_voucher_grants','CREATE TRIGGER guardian_grant_resources AFTER INSERT ON rpg_guardian_voucher_grants BEGIN
 INSERT INTO rpg_daily_counters(tg_id,day,key,n) VALUES(NEW.account_id,NEW.day,''guardian_voucher'',1)
 ON CONFLICT(tg_id,day,key) DO UPDATE SET n=n+1;
 INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(NEW.recipient_char_id,''guardian_voucher'',1)
 ON CONFLICT(tg_id,item) DO UPDATE SET quantity=quantity+1;
 INSERT INTO rpg_ledger(event_id,tg_id,type,item,item_delta,note,created_at)
 VALUES(''guardian-voucher:''||NEW.boss_id||'':''||NEW.account_id,NEW.recipient_char_id,
  ''守護神召喚憑證'',''guardian_voucher'',1,NEW.boss_id,NEW.created_at);
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.created_at WHERE tg_id=NEW.recipient_char_id;
END'),
('trigger','guardian_sigil_delete_guard','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_delete_guard BEFORE DELETE ON rpg_guardian_sigils
 WHEN OLD.active=1 OR OLD.locked=1 OR OLD.trade_id IS NOT NULL
 BEGIN SELECT RAISE(ABORT,''guardian_sigil_protected''); END'),
('trigger','guardian_sigil_delete_revision','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_delete_revision AFTER DELETE ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=OLD.char_id;
END'),
('trigger','guardian_sigil_insert_revision','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_insert_revision AFTER INSERT ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.updated_at WHERE tg_id=NEW.char_id;
END'),
('trigger','guardian_sigil_party_delete','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_party_delete BEFORE DELETE ON rpg_guardian_sigils
 WHEN EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=OLD.char_id AND party_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,''guardian_party_locked''); END'),
('trigger','guardian_sigil_party_update','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_party_update BEFORE UPDATE ON rpg_guardian_sigils
 WHEN EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=OLD.char_id AND party_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,''guardian_party_locked''); END'),
('trigger','guardian_sigil_transfer_guard','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_transfer_guard BEFORE UPDATE OF char_id ON rpg_guardian_sigils
 WHEN NEW.char_id<>OLD.char_id AND (OLD.active=1 OR OLD.bound=1 OR OLD.locked=1)
 BEGIN SELECT RAISE(ABORT,''guardian_transfer_protected''); END'),
('trigger','guardian_sigil_update_revision','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_update_revision AFTER UPDATE ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.updated_at WHERE tg_id=OLD.char_id OR tg_id=NEW.char_id;
END'),
('trigger','guardian_welcome_guard','rpg_guardian_welcome','CREATE TRIGGER guardian_welcome_guard BEFORE INSERT ON rpg_guardian_welcome BEGIN
 SELECT RAISE(ABORT,''guardian_welcome_locked'') WHERE NOT EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=NEW.recipient_char_id
  AND account_tg_id=NEW.account_id AND level>=15);
END'),
('trigger','guardian_welcome_no_delete','rpg_guardian_welcome','CREATE TRIGGER guardian_welcome_no_delete BEFORE DELETE ON rpg_guardian_welcome BEGIN SELECT RAISE(ABORT,''guardian_welcome_immutable''); END'),
('trigger','guardian_welcome_no_update','rpg_guardian_welcome','CREATE TRIGGER guardian_welcome_no_update BEFORE UPDATE ON rpg_guardian_welcome BEGIN SELECT RAISE(ABORT,''guardian_welcome_immutable''); END'),
('trigger','guardian_welcome_resources','rpg_guardian_welcome','CREATE TRIGGER guardian_welcome_resources AFTER INSERT ON rpg_guardian_welcome BEGIN
 INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(NEW.recipient_char_id,''guardian_free_normal'',NEW.draws)
 ON CONFLICT(tg_id,item) DO UPDATE SET quantity=quantity+excluded.quantity;
 INSERT INTO rpg_ledger(event_id,tg_id,type,item,item_delta,note,created_at)
 VALUES(''guardian-welcome:''||NEW.account_id,NEW.recipient_char_id,''守護神初見贈禮'',''guardian_free_normal'',NEW.draws,''首次進入；免費普通召喚'',NEW.created_at);
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.created_at WHERE tg_id=NEW.recipient_char_id;
END'),
('trigger','rpg_auto_enhance_equipment_delete','rpg_equipment','CREATE TRIGGER rpg_auto_enhance_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=OLD.id AND status=''running'')
BEGIN SELECT RAISE(ABORT,''auto_enhance_locked''); END'),
('trigger','rpg_auto_enhance_equipment_update','rpg_equipment','CREATE TRIGGER rpg_auto_enhance_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=OLD.id AND status=''running'')
BEGIN SELECT RAISE(ABORT,''auto_enhance_locked''); END'),
('trigger','rpg_auto_enhance_start_guard','rpg_auto_enhance','CREATE TRIGGER rpg_auto_enhance_start_guard BEFORE INSERT ON rpg_auto_enhance
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=NEW.item_id AND status IN (''running'',''processing''))
BEGIN SELECT RAISE(ABORT,''background_item_locked''); END'),
('trigger','rpg_auto_reroll_equipment_delete','rpg_equipment','CREATE TRIGGER rpg_auto_reroll_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=OLD.id AND status=''running'')
BEGIN SELECT RAISE(ABORT,''auto_reroll_locked''); END'),
('trigger','rpg_auto_reroll_equipment_update','rpg_equipment','CREATE TRIGGER rpg_auto_reroll_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=OLD.id AND status=''running'')
BEGIN SELECT RAISE(ABORT,''auto_reroll_locked''); END'),
('trigger','rpg_auto_reroll_start_guard','rpg_auto_reroll','CREATE TRIGGER rpg_auto_reroll_start_guard BEFORE INSERT ON rpg_auto_reroll
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=NEW.item_id AND status IN (''running'',''processing''))
BEGIN SELECT RAISE(ABORT,''background_item_locked''); END'),
('trigger','rpg_exchange_enhance_resume','rpg_auto_enhance','CREATE TRIGGER rpg_exchange_enhance_resume BEFORE UPDATE OF status,item_id ON rpg_auto_enhance
WHEN NEW.status IN (''running'',''processing'') AND EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE ''exchange:%'')
BEGIN SELECT RAISE(ABORT,''exchange_equipment_locked''); END'),
('trigger','rpg_exchange_enhance_start','rpg_auto_enhance','CREATE TRIGGER rpg_exchange_enhance_start BEFORE INSERT ON rpg_auto_enhance
WHEN EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE ''exchange:%'')
BEGIN SELECT RAISE(ABORT,''exchange_equipment_locked''); END'),
('trigger','rpg_exchange_equipment_delete','rpg_equipment','CREATE TRIGGER rpg_exchange_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN OLD.trade_id LIKE ''exchange:%'' AND EXISTS(
 SELECT 1 FROM rpg_exchange_listings WHERE id=substr(OLD.trade_id,10) AND status=''active'' AND kind=''equip'' AND ref=OLD.id
)
BEGIN SELECT RAISE(ABORT,''exchange_equipment_locked''); END'),
('trigger','rpg_exchange_equipment_update','rpg_equipment','CREATE TRIGGER rpg_exchange_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN OLD.trade_id LIKE ''exchange:%'' AND EXISTS(
 SELECT 1 FROM rpg_exchange_listings WHERE id=substr(OLD.trade_id,10) AND status=''active'' AND kind=''equip'' AND ref=OLD.id
)
BEGIN SELECT RAISE(ABORT,''exchange_equipment_locked''); END'),
('trigger','rpg_exchange_guardian_claim','rpg_guardian_sigils','CREATE TRIGGER rpg_exchange_guardian_claim BEFORE UPDATE OF exchange_id ON rpg_guardian_sigils
WHEN NEW.exchange_id IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,''exchange_guardian_locked'') WHERE NEW.bound<>0 OR NEW.active<>0 OR NEW.locked<>0 OR NEW.trade_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=NEW.exchange_id AND status=''active'' AND kind=''guardian'' AND ref=NEW.id AND seller_char=NEW.char_id);
END'),
('trigger','rpg_exchange_guardian_delete','rpg_guardian_sigils','CREATE TRIGGER rpg_exchange_guardian_delete BEFORE DELETE ON rpg_guardian_sigils
WHEN OLD.exchange_id IS NOT NULL AND EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=OLD.exchange_id AND status=''active'' AND kind=''guardian'' AND ref=OLD.id)
BEGIN SELECT RAISE(ABORT,''exchange_guardian_locked''); END'),
('trigger','rpg_exchange_guardian_request','rpg_trade_requests','CREATE TRIGGER rpg_exchange_guardian_request BEFORE INSERT ON rpg_trade_requests
WHEN NEW.object_kind=''sigil'' AND EXISTS(SELECT 1 FROM rpg_guardian_sigils WHERE id=NEW.equip_id AND exchange_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,''exchange_guardian_locked''); END'),
('trigger','rpg_exchange_guardian_share','rpg_shares','CREATE TRIGGER rpg_exchange_guardian_share BEFORE INSERT ON rpg_shares
WHEN NEW.object_kind=''sigil'' AND EXISTS(SELECT 1 FROM rpg_guardian_sigils WHERE id=NEW.equip_id AND exchange_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,''exchange_guardian_locked''); END'),
('trigger','rpg_exchange_guardian_update','rpg_guardian_sigils','CREATE TRIGGER rpg_exchange_guardian_update BEFORE UPDATE ON rpg_guardian_sigils
WHEN OLD.exchange_id IS NOT NULL AND EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=OLD.exchange_id AND status=''active'' AND kind=''guardian'' AND ref=OLD.id)
BEGIN SELECT RAISE(ABORT,''exchange_guardian_locked''); END'),
('trigger','rpg_exchange_reroll_resume','rpg_auto_reroll','CREATE TRIGGER rpg_exchange_reroll_resume BEFORE UPDATE OF status,item_id ON rpg_auto_reroll
WHEN NEW.status IN (''running'',''processing'') AND EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE ''exchange:%'')
BEGIN SELECT RAISE(ABORT,''exchange_equipment_locked''); END'),
('trigger','rpg_exchange_reroll_start','rpg_auto_reroll','CREATE TRIGGER rpg_exchange_reroll_start BEFORE INSERT ON rpg_auto_reroll
WHEN EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE ''exchange:%'')
BEGIN SELECT RAISE(ABORT,''exchange_equipment_locked''); END')), actual AS (SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT GLOB '_thief_*' AND name<>'d1_migrations')
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM actual) AND NOT EXISTS (SELECT * FROM actual EXCEPT SELECT * FROM expected)) THEN 1 ELSE 0 END;

-- 3. preflight-fk: rpg_guardian_operations
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_operations" c WHERE c."char_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_characters" p WHERE p."tg_id"=c."char_id"))) THEN 1 ELSE 0 END;

-- 4. preflight-fk: rpg_guardian_sigils
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_sigils" c WHERE c."exchange_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_exchange_listings" p WHERE p."id"=c."exchange_id"))) THEN 1 ELSE 0 END;

-- 5. preflight-fk: rpg_guardian_sigils
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_sigils" c WHERE c."source_operation_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_guardian_operations" p WHERE p."operation_id"=c."source_operation_id"))) THEN 1 ELSE 0 END;

-- 6. preflight-fk: rpg_guardian_sigils
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_sigils" c WHERE c."trade_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_trades" p WHERE p."id"=c."trade_id"))) THEN 1 ELSE 0 END;

-- 7. preflight-fk: rpg_guardian_sigils
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_sigils" c WHERE c."char_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_characters" p WHERE p."tg_id"=c."char_id"))) THEN 1 ELSE 0 END;

-- 8. preflight-fk: rpg_guardian_voucher_grants
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_voucher_grants" c WHERE c."recipient_char_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_characters" p WHERE p."tg_id"=c."recipient_char_id"))) THEN 1 ELSE 0 END;

-- 9. preflight-fk: rpg_guardian_voucher_grants
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_voucher_grants" c WHERE c."boss_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_boss_instances" p WHERE p."id"=c."boss_id"))) THEN 1 ELSE 0 END;

-- 10. preflight-fk: rpg_guardian_voucher_grants
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_voucher_grants" c WHERE c."account_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_accounts" p WHERE p."account_tg_id"=c."account_id"))) THEN 1 ELSE 0 END;

-- 11. preflight-fk: rpg_guardian_welcome
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_welcome" c WHERE c."recipient_char_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_characters" p WHERE p."tg_id"=c."recipient_char_id"))) THEN 1 ELSE 0 END;

-- 12. preflight-fk: rpg_guardian_welcome
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_welcome" c WHERE c."account_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_accounts" p WHERE p."account_tg_id"=c."account_id"))) THEN 1 ELSE 0 END;

-- 13. preflight-fk: rpg_notice_dismissals
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_notice_dismissals" c WHERE c."account_tg_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_accounts" p WHERE p."account_tg_id"=c."account_tg_id"))) THEN 1 ELSE 0 END;

-- 14. preflight-fk: rpg_party_members
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_party_members" c WHERE c."party_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_parties" p WHERE p."id"=c."party_id"))) THEN 1 ELSE 0 END;

-- 15. backup: rpg_characters
CREATE TABLE "_thief_backup_rpg_characters" AS SELECT rowid AS "__thief_saved_rowid","tg_id","name","tg_name","gender","base_class","class_path","pending_tier","level","exp","hp","mp","map_id","idle_state","state_until","auto_red_pct","auto_blue","gold","last_settle_at","last_daily_gold_day","penalty_day","penalties_today","drop_day","drops_today","deaths_total","last_reselect_at","boss_down_until","ladder_points","pvp_wins","pvp_losses","created_day","created_at","updated_at","rev","tg_username","account_tg_id","char_slot","special_json","party_id","idle_combat_json","guardian_draw_remainder","collection_active_map" FROM "rpg_characters";

-- 16. backup: rpg_equipment
CREATE TABLE "_thief_backup_rpg_equipment" AS SELECT rowid AS "__thief_saved_rowid","id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json" FROM "rpg_equipment";

-- 17. backup: rpg_exchange_listings
CREATE TABLE "_thief_backup_rpg_exchange_listings" AS SELECT rowid AS "__thief_saved_rowid","seq","id","seller_account","seller_char","buyer_char","kind","ref","qty","price","fee","category","class_req","tier","quality","enhance","snapshot_json","status","rev","created_at","updated_at","closed_at" FROM "rpg_exchange_listings";

-- 18. backup: rpg_guardian_operations
CREATE TABLE "_thief_backup_rpg_guardian_operations" AS SELECT rowid AS "__thief_saved_rowid","operation_id","account_id","char_id","request_id","action","payload_hash","config_version","cost_json","result_json","created_at" FROM "rpg_guardian_operations";

-- 19. backup: rpg_guardian_sigils
CREATE TABLE "_thief_backup_rpg_guardian_sigils" AS SELECT rowid AS "__thief_saved_rowid","id","char_id","type","quality","bound","active","locked","trade_id","rev","source_operation_id","created_at","updated_at","exchange_id" FROM "rpg_guardian_sigils";

-- 20. backup: rpg_guardian_voucher_grants
CREATE TABLE "_thief_backup_rpg_guardian_voucher_grants" AS SELECT rowid AS "__thief_saved_rowid","account_id","boss_id","day","recipient_char_id","created_at" FROM "rpg_guardian_voucher_grants";

-- 21. backup: rpg_guardian_welcome
CREATE TABLE "_thief_backup_rpg_guardian_welcome" AS SELECT rowid AS "__thief_saved_rowid","account_id","recipient_char_id","draws","created_at" FROM "rpg_guardian_welcome";

-- 22. backup-sequence
CREATE TABLE "_thief_backup_sequence" AS SELECT name,seq FROM sqlite_sequence;

-- 23. drop-trigger: collection_blessing_keep_delete
DROP TRIGGER "collection_blessing_keep_delete";

-- 24. drop-trigger: collection_blessing_keep_update
DROP TRIGGER "collection_blessing_keep_update";

-- 25. drop-trigger: collection_blessing_owner
DROP TRIGGER "collection_blessing_owner";

-- 26. drop-trigger: collection_blessing_party
DROP TRIGGER "collection_blessing_party";

-- 27. drop-trigger: guardian_grant_guard
DROP TRIGGER "guardian_grant_guard";

-- 28. drop-trigger: guardian_grant_no_delete
DROP TRIGGER "guardian_grant_no_delete";

-- 29. drop-trigger: guardian_grant_no_update
DROP TRIGGER "guardian_grant_no_update";

-- 30. drop-trigger: guardian_grant_resources
DROP TRIGGER "guardian_grant_resources";

-- 31. drop-trigger: guardian_sigil_delete_guard
DROP TRIGGER "guardian_sigil_delete_guard";

-- 32. drop-trigger: guardian_sigil_delete_revision
DROP TRIGGER "guardian_sigil_delete_revision";

-- 33. drop-trigger: guardian_sigil_insert_revision
DROP TRIGGER "guardian_sigil_insert_revision";

-- 34. drop-trigger: guardian_sigil_party_delete
DROP TRIGGER "guardian_sigil_party_delete";

-- 35. drop-trigger: guardian_sigil_party_update
DROP TRIGGER "guardian_sigil_party_update";

-- 36. drop-trigger: guardian_sigil_transfer_guard
DROP TRIGGER "guardian_sigil_transfer_guard";

-- 37. drop-trigger: guardian_sigil_update_revision
DROP TRIGGER "guardian_sigil_update_revision";

-- 38. drop-trigger: guardian_welcome_guard
DROP TRIGGER "guardian_welcome_guard";

-- 39. drop-trigger: guardian_welcome_no_delete
DROP TRIGGER "guardian_welcome_no_delete";

-- 40. drop-trigger: guardian_welcome_no_update
DROP TRIGGER "guardian_welcome_no_update";

-- 41. drop-trigger: guardian_welcome_resources
DROP TRIGGER "guardian_welcome_resources";

-- 42. drop-trigger: rpg_auto_enhance_equipment_delete
DROP TRIGGER "rpg_auto_enhance_equipment_delete";

-- 43. drop-trigger: rpg_auto_enhance_equipment_update
DROP TRIGGER "rpg_auto_enhance_equipment_update";

-- 44. drop-trigger: rpg_auto_reroll_equipment_delete
DROP TRIGGER "rpg_auto_reroll_equipment_delete";

-- 45. drop-trigger: rpg_auto_reroll_equipment_update
DROP TRIGGER "rpg_auto_reroll_equipment_update";

-- 46. drop-trigger: rpg_exchange_enhance_resume
DROP TRIGGER "rpg_exchange_enhance_resume";

-- 47. drop-trigger: rpg_exchange_enhance_start
DROP TRIGGER "rpg_exchange_enhance_start";

-- 48. drop-trigger: rpg_exchange_equipment_delete
DROP TRIGGER "rpg_exchange_equipment_delete";

-- 49. drop-trigger: rpg_exchange_equipment_update
DROP TRIGGER "rpg_exchange_equipment_update";

-- 50. drop-trigger: rpg_exchange_guardian_claim
DROP TRIGGER "rpg_exchange_guardian_claim";

-- 51. drop-trigger: rpg_exchange_guardian_delete
DROP TRIGGER "rpg_exchange_guardian_delete";

-- 52. drop-trigger: rpg_exchange_guardian_request
DROP TRIGGER "rpg_exchange_guardian_request";

-- 53. drop-trigger: rpg_exchange_guardian_share
DROP TRIGGER "rpg_exchange_guardian_share";

-- 54. drop-trigger: rpg_exchange_guardian_update
DROP TRIGGER "rpg_exchange_guardian_update";

-- 55. drop-trigger: rpg_exchange_reroll_resume
DROP TRIGGER "rpg_exchange_reroll_resume";

-- 56. drop-trigger: rpg_exchange_reroll_start
DROP TRIGGER "rpg_exchange_reroll_start";

-- 57. drop-table-leaf-first: rpg_guardian_welcome
DROP TABLE "rpg_guardian_welcome";

-- 58. drop-table-leaf-first: rpg_guardian_voucher_grants
DROP TABLE "rpg_guardian_voucher_grants";

-- 59. drop-table-leaf-first: rpg_guardian_sigils
DROP TABLE "rpg_guardian_sigils";

-- 60. drop-table-leaf-first: rpg_guardian_operations
DROP TABLE "rpg_guardian_operations";

-- 61. drop-table-leaf-first: rpg_exchange_listings
DROP TABLE "rpg_exchange_listings";

-- 62. drop-table-leaf-first: rpg_equipment
DROP TABLE "rpg_equipment";

-- 63. drop-table-leaf-first: rpg_characters
DROP TABLE "rpg_characters";

-- 64. create-table-parent-first: rpg_characters
CREATE TABLE rpg_characters (
  tg_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tg_name TEXT,
  gender TEXT NOT NULL CHECK (gender IN ('m','f')),
  base_class TEXT NOT NULL CHECK (base_class IN ('mage','sword','archer','thief')),
  class_path TEXT NOT NULL DEFAULT '',
  pending_tier INTEGER,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 120),
  exp INTEGER NOT NULL DEFAULT 0 CHECK (exp >= 0),
  hp INTEGER NOT NULL,
  mp INTEGER NOT NULL,
  map_id INTEGER NOT NULL DEFAULT 1,
  idle_state TEXT NOT NULL DEFAULT 'fighting' CHECK (idle_state IN ('fighting','no_mp','town_no_red','reviving','gate')),
  state_until INTEGER,
  auto_red_pct INTEGER NOT NULL DEFAULT 50 CHECK (auto_red_pct BETWEEN 20 AND 80),
  auto_blue INTEGER NOT NULL DEFAULT 1,
  gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
  last_settle_at INTEGER NOT NULL,
  last_daily_gold_day TEXT,
  penalty_day TEXT,
  penalties_today INTEGER NOT NULL DEFAULT 0,
  drop_day TEXT,                       -- Taipei day of drops_today (idle scroll daily caps)
  drops_today TEXT,                    -- JSON {scroll_w,scroll_a,scroll_r}
  deaths_total INTEGER NOT NULL DEFAULT 0,
  last_reselect_at INTEGER,
  boss_down_until INTEGER,
  ladder_points INTEGER NOT NULL DEFAULT 100,
  pvp_wins INTEGER NOT NULL DEFAULT 0,
  pvp_losses INTEGER NOT NULL DEFAULT 0,
  created_day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0
, tg_username TEXT, account_tg_id TEXT, char_slot INTEGER NOT NULL DEFAULT 1 CHECK (char_slot BETWEEN 1 AND 4), special_json TEXT NOT NULL DEFAULT '{}', party_id TEXT, idle_combat_json TEXT, guardian_draw_remainder INTEGER NOT NULL DEFAULT 0
 CHECK(guardian_draw_remainder BETWEEN 0 AND 4), collection_active_map INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(collection_active_map)='integer' AND collection_active_map BETWEEN 0 AND 12));

-- 65. create-table-parent-first: rpg_equipment
CREATE TABLE "rpg_equipment" (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('weapon','helmet','armor','gloves','boots','belt','undershirt','earring','ring')),
  kind TEXT NOT NULL,
  class_req TEXT NOT NULL CHECK (class_req IN ('mage','sword','archer','any','thief')),
  branch_req TEXT CHECK (branch_req IS NULL OR branch_req IN ('A','B')),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 12),
  level_req INTEGER NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'shop',
  base_stat INTEGER NOT NULL,
  bonus_json TEXT,
  element TEXT,
  element_stat INTEGER NOT NULL DEFAULT 0,
  element_tier TEXT NOT NULL DEFAULT 'common',
  enhance_level INTEGER NOT NULL DEFAULT 0,
  is_equipped INTEGER NOT NULL DEFAULT 0 CHECK (is_equipped BETWEEN 0 AND 2),
  convert_token INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  grade TEXT NOT NULL DEFAULT 'normal' CHECK (grade IN ('normal','relic')),
  affix_json TEXT,
  bound INTEGER NOT NULL DEFAULT 0,
  trade_id TEXT, affixes_json TEXT NOT NULL DEFAULT '[]',
  CHECK (trade_id IS NULL OR is_equipped = 0)
);

-- 66. create-table-parent-first: rpg_exchange_listings
CREATE TABLE rpg_exchange_listings (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 seller_account TEXT NOT NULL, seller_char TEXT NOT NULL, buyer_char TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('equip','item','guardian')), ref TEXT NOT NULL,
 qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 99999),
 price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 1000000),
 fee INTEGER NOT NULL CHECK(fee=(price+19)/20),
 category TEXT NOT NULL CHECK(category IN ('equipment','scroll','collection','skillbook','other','guardian')),
 class_req TEXT NOT NULL CHECK(class_req IN ('any','sword','archer','mage','thief')), tier INTEGER CHECK(tier BETWEEN 1 AND 12),
 quality TEXT, enhance INTEGER, snapshot_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','sold','cancelled')),
 rev INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 closed_at INTEGER, CHECK(kind='item' OR qty=1)
);

-- 67. create-table-parent-first: rpg_guardian_operations
CREATE TABLE rpg_guardian_operations (
 operation_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 6 AND 100),
 action TEXT NOT NULL CHECK(action IN('summon','fuse','activate','lock','unbind','share')),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 config_version TEXT NOT NULL,
 cost_json TEXT NOT NULL CHECK(json_valid(cost_json)),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at INTEGER NOT NULL,
 UNIQUE(char_id,request_id)
);

-- 68. create-table-parent-first: rpg_guardian_sigils
CREATE TABLE rpg_guardian_sigils (
 id TEXT PRIMARY KEY,
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 type TEXT NOT NULL CHECK(type IN('melee','ranged','magic','loot')),
 quality INTEGER NOT NULL CHECK(quality BETWEEN 1 AND 8),
 bound INTEGER NOT NULL DEFAULT 0 CHECK(bound IN(0,1)),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),
 locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN(0,1)),
 trade_id TEXT REFERENCES rpg_trades(id),
 rev INTEGER NOT NULL DEFAULT 0 CHECK(rev>=0),
 source_operation_id TEXT NOT NULL REFERENCES rpg_guardian_operations(operation_id),
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL, exchange_id TEXT REFERENCES rpg_exchange_listings(id),
 CHECK(active=0 OR bound=1),
 CHECK(trade_id IS NULL OR (active=0 AND bound=0 AND locked=0))
);

-- 69. create-table-parent-first: rpg_guardian_voucher_grants
CREATE TABLE rpg_guardian_voucher_grants (
 account_id TEXT NOT NULL REFERENCES rpg_accounts(account_tg_id),
 boss_id TEXT NOT NULL REFERENCES rpg_boss_instances(id),
 day TEXT NOT NULL,
 recipient_char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,boss_id),
 CHECK(day=date(created_at/1000,'unixepoch','+8 hours'))
);

-- 70. create-table-parent-first: rpg_guardian_welcome
CREATE TABLE rpg_guardian_welcome (
 account_id TEXT PRIMARY KEY REFERENCES rpg_accounts(account_tg_id),
 recipient_char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 draws INTEGER NOT NULL DEFAULT 200 CHECK(draws=200),
 created_at INTEGER NOT NULL
);

-- 71. restore-data-before-triggers: rpg_characters
INSERT INTO "rpg_characters" (rowid,"tg_id","name","tg_name","gender","base_class","class_path","pending_tier","level","exp","hp","mp","map_id","idle_state","state_until","auto_red_pct","auto_blue","gold","last_settle_at","last_daily_gold_day","penalty_day","penalties_today","drop_day","drops_today","deaths_total","last_reselect_at","boss_down_until","ladder_points","pvp_wins","pvp_losses","created_day","created_at","updated_at","rev","tg_username","account_tg_id","char_slot","special_json","party_id","idle_combat_json","guardian_draw_remainder","collection_active_map") SELECT "__thief_saved_rowid","tg_id","name","tg_name","gender","base_class","class_path","pending_tier","level","exp","hp","mp","map_id","idle_state","state_until","auto_red_pct","auto_blue","gold","last_settle_at","last_daily_gold_day","penalty_day","penalties_today","drop_day","drops_today","deaths_total","last_reselect_at","boss_down_until","ladder_points","pvp_wins","pvp_losses","created_day","created_at","updated_at","rev","tg_username","account_tg_id","char_slot","special_json","party_id","idle_combat_json","guardian_draw_remainder","collection_active_map" FROM "_thief_backup_rpg_characters" ORDER BY "__thief_saved_rowid";

-- 72. restore-data-before-triggers: rpg_equipment
INSERT INTO "rpg_equipment" (rowid,"id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") SELECT "__thief_saved_rowid","id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json" FROM "_thief_backup_rpg_equipment" ORDER BY "__thief_saved_rowid";

-- 73. restore-data-before-triggers: rpg_exchange_listings
INSERT INTO "rpg_exchange_listings" ("seq","id","seller_account","seller_char","buyer_char","kind","ref","qty","price","fee","category","class_req","tier","quality","enhance","snapshot_json","status","rev","created_at","updated_at","closed_at") SELECT "seq","id","seller_account","seller_char","buyer_char","kind","ref","qty","price","fee","category","class_req","tier","quality","enhance","snapshot_json","status","rev","created_at","updated_at","closed_at" FROM "_thief_backup_rpg_exchange_listings" ORDER BY "__thief_saved_rowid";

-- 74. restore-data-before-triggers: rpg_guardian_operations
INSERT INTO "rpg_guardian_operations" (rowid,"operation_id","account_id","char_id","request_id","action","payload_hash","config_version","cost_json","result_json","created_at") SELECT "__thief_saved_rowid","operation_id","account_id","char_id","request_id","action","payload_hash","config_version","cost_json","result_json","created_at" FROM "_thief_backup_rpg_guardian_operations" ORDER BY "__thief_saved_rowid";

-- 75. restore-data-before-triggers: rpg_guardian_sigils
INSERT INTO "rpg_guardian_sigils" (rowid,"id","char_id","type","quality","bound","active","locked","trade_id","rev","source_operation_id","created_at","updated_at","exchange_id") SELECT "__thief_saved_rowid","id","char_id","type","quality","bound","active","locked","trade_id","rev","source_operation_id","created_at","updated_at","exchange_id" FROM "_thief_backup_rpg_guardian_sigils" ORDER BY "__thief_saved_rowid";

-- 76. restore-data-before-triggers: rpg_guardian_voucher_grants
INSERT INTO "rpg_guardian_voucher_grants" (rowid,"account_id","boss_id","day","recipient_char_id","created_at") SELECT "__thief_saved_rowid","account_id","boss_id","day","recipient_char_id","created_at" FROM "_thief_backup_rpg_guardian_voucher_grants" ORDER BY "__thief_saved_rowid";

-- 77. restore-data-before-triggers: rpg_guardian_welcome
INSERT INTO "rpg_guardian_welcome" (rowid,"account_id","recipient_char_id","draws","created_at") SELECT "__thief_saved_rowid","account_id","recipient_char_id","draws","created_at" FROM "_thief_backup_rpg_guardian_welcome" ORDER BY "__thief_saved_rowid";

-- 78. restore-sequence: rpg_exchange_listings
DELETE FROM sqlite_sequence WHERE name='rpg_exchange_listings';

-- 79. restore-sequence: rpg_exchange_listings
INSERT INTO sqlite_sequence (name,seq) SELECT name,seq FROM "_thief_backup_sequence" WHERE name='rpg_exchange_listings';

-- 80. restore-index: idx_guardian_grants_day
CREATE INDEX idx_guardian_grants_day ON rpg_guardian_voucher_grants(account_id,day);

-- 81. restore-index: idx_guardian_one_active
CREATE UNIQUE INDEX idx_guardian_one_active ON rpg_guardian_sigils(char_id) WHERE active=1;

-- 82. restore-index: idx_guardian_operations_owner
CREATE INDEX idx_guardian_operations_owner ON rpg_guardian_operations(char_id,created_at,operation_id);

-- 83. restore-index: idx_guardian_owner
CREATE INDEX idx_guardian_owner ON rpg_guardian_sigils(char_id,created_at,id);

-- 84. restore-index: idx_guardian_trade
CREATE INDEX idx_guardian_trade ON rpg_guardian_sigils(trade_id) WHERE trade_id IS NOT NULL;

-- 85. restore-index: idx_rpg_characters_account
CREATE INDEX idx_rpg_characters_account ON rpg_characters(account_tg_id, char_slot);

-- 86. restore-index: idx_rpg_characters_account_slot
CREATE UNIQUE INDEX idx_rpg_characters_account_slot ON rpg_characters(account_tg_id, char_slot);

-- 87. restore-index: idx_rpg_characters_username
CREATE INDEX idx_rpg_characters_username ON rpg_characters(tg_username COLLATE NOCASE);

-- 88. restore-index: idx_rpg_equipment_owner
CREATE INDEX idx_rpg_equipment_owner ON rpg_equipment(tg_id, is_equipped);

-- 89. restore-index: idx_rpg_equipment_trade
CREATE INDEX idx_rpg_equipment_trade ON rpg_equipment(trade_id) WHERE trade_id IS NOT NULL;

-- 90. restore-index: rpg_exchange_active
CREATE INDEX rpg_exchange_active ON rpg_exchange_listings(status,seq DESC);

-- 91. restore-index: rpg_exchange_category
CREATE INDEX rpg_exchange_category ON rpg_exchange_listings(status,category,seq DESC);

-- 92. restore-index: rpg_exchange_class
CREATE INDEX rpg_exchange_class ON rpg_exchange_listings(status,class_req,seq DESC);

-- 93. restore-index: rpg_exchange_equipment
CREATE UNIQUE INDEX rpg_exchange_equipment ON rpg_exchange_listings(ref) WHERE status='active' AND kind='equip';

-- 94. restore-index: rpg_exchange_guardian
CREATE UNIQUE INDEX rpg_exchange_guardian ON rpg_exchange_listings(ref) WHERE status='active' AND kind='guardian';

-- 95. restore-index: rpg_exchange_history
CREATE INDEX rpg_exchange_history ON rpg_exchange_listings(seller_account,seq DESC);

-- 96. restore-index: rpg_exchange_quality
CREATE INDEX rpg_exchange_quality ON rpg_exchange_listings(status,quality,seq DESC);

-- 97. restore-index: rpg_exchange_seller
CREATE INDEX rpg_exchange_seller ON rpg_exchange_listings(seller_account,status,seq DESC);

-- 98. restore-index: rpg_exchange_tier
CREATE INDEX rpg_exchange_tier ON rpg_exchange_listings(status,tier,seq DESC);

-- 99. restore-index: rpg_guardian_exchange
CREATE UNIQUE INDEX rpg_guardian_exchange ON rpg_guardian_sigils(exchange_id) WHERE exchange_id IS NOT NULL;

-- 100. restore-trigger: collection_blessing_keep_delete
CREATE TRIGGER collection_blessing_keep_delete BEFORE DELETE ON rpg_inventory
WHEN OLD.item LIKE 'collection_%' BEGIN
 SELECT RAISE(ABORT,'collection_active_owned') WHERE EXISTS(
  SELECT 1 FROM rpg_characters WHERE tg_id=OLD.tg_id AND collection_active_map>0 AND OLD.item='collection_'||collection_active_map);
END;

-- 101. restore-trigger: collection_blessing_keep_update
CREATE TRIGGER collection_blessing_keep_update BEFORE UPDATE OF quantity,item,tg_id ON rpg_inventory
WHEN OLD.item LIKE 'collection_%' AND (NEW.quantity<1 OR NEW.item<>OLD.item OR NEW.tg_id<>OLD.tg_id) BEGIN
 SELECT RAISE(ABORT,'collection_active_owned') WHERE EXISTS(
  SELECT 1 FROM rpg_characters WHERE tg_id=OLD.tg_id AND collection_active_map>0 AND OLD.item='collection_'||collection_active_map);
END;

-- 102. restore-trigger: collection_blessing_owner
CREATE TRIGGER collection_blessing_owner BEFORE UPDATE OF collection_active_map ON rpg_characters
WHEN NEW.collection_active_map<>OLD.collection_active_map AND NEW.collection_active_map>0 BEGIN
 SELECT RAISE(ABORT,'collection_not_owned') WHERE NOT EXISTS(
  SELECT 1 FROM rpg_inventory WHERE tg_id=NEW.tg_id AND item='collection_'||NEW.collection_active_map AND quantity>0);
END;

-- 103. restore-trigger: collection_blessing_party
CREATE TRIGGER collection_blessing_party BEFORE UPDATE OF collection_active_map ON rpg_characters
WHEN NEW.collection_active_map<>OLD.collection_active_map AND OLD.party_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'collection_party_locked');
END;

-- 104. restore-trigger: guardian_grant_guard
CREATE TRIGGER guardian_grant_guard BEFORE INSERT ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,'guardian_invalid_participant') WHERE NOT EXISTS(
  SELECT 1 FROM rpg_characters c JOIN rpg_boss_attacks a ON a.tg_id=c.tg_id
  WHERE c.tg_id=NEW.recipient_char_id AND c.account_tg_id=NEW.account_id
   AND a.boss_id=NEW.boss_id AND a.damage>0
 );
 SELECT RAISE(ABORT,'guardian_voucher_daily_cap') WHERE COALESCE((SELECT n FROM rpg_daily_counters
  WHERE tg_id=NEW.account_id AND day=NEW.day AND key='guardian_voucher'),0)>=4
 ;
END;

-- 105. restore-trigger: guardian_grant_no_delete
CREATE TRIGGER guardian_grant_no_delete BEFORE DELETE ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,'guardian_grant_immutable');
END;

-- 106. restore-trigger: guardian_grant_no_update
CREATE TRIGGER guardian_grant_no_update BEFORE UPDATE ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,'guardian_grant_immutable');
END;

-- 107. restore-trigger: guardian_grant_resources
CREATE TRIGGER guardian_grant_resources AFTER INSERT ON rpg_guardian_voucher_grants BEGIN
 INSERT INTO rpg_daily_counters(tg_id,day,key,n) VALUES(NEW.account_id,NEW.day,'guardian_voucher',1)
 ON CONFLICT(tg_id,day,key) DO UPDATE SET n=n+1;
 INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(NEW.recipient_char_id,'guardian_voucher',1)
 ON CONFLICT(tg_id,item) DO UPDATE SET quantity=quantity+1;
 INSERT INTO rpg_ledger(event_id,tg_id,type,item,item_delta,note,created_at)
 VALUES('guardian-voucher:'||NEW.boss_id||':'||NEW.account_id,NEW.recipient_char_id,
  '守護神召喚憑證','guardian_voucher',1,NEW.boss_id,NEW.created_at);
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.created_at WHERE tg_id=NEW.recipient_char_id;
END;

-- 108. restore-trigger: guardian_sigil_delete_guard
CREATE TRIGGER guardian_sigil_delete_guard BEFORE DELETE ON rpg_guardian_sigils
 WHEN OLD.active=1 OR OLD.locked=1 OR OLD.trade_id IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'guardian_sigil_protected'); END;

-- 109. restore-trigger: guardian_sigil_delete_revision
CREATE TRIGGER guardian_sigil_delete_revision AFTER DELETE ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=OLD.char_id;
END;

-- 110. restore-trigger: guardian_sigil_insert_revision
CREATE TRIGGER guardian_sigil_insert_revision AFTER INSERT ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.updated_at WHERE tg_id=NEW.char_id;
END;

-- 111. restore-trigger: guardian_sigil_party_delete
CREATE TRIGGER guardian_sigil_party_delete BEFORE DELETE ON rpg_guardian_sigils
 WHEN EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=OLD.char_id AND party_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'guardian_party_locked'); END;

-- 112. restore-trigger: guardian_sigil_party_update
CREATE TRIGGER guardian_sigil_party_update BEFORE UPDATE ON rpg_guardian_sigils
 WHEN EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=OLD.char_id AND party_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'guardian_party_locked'); END;

-- 113. restore-trigger: guardian_sigil_transfer_guard
CREATE TRIGGER guardian_sigil_transfer_guard BEFORE UPDATE OF char_id ON rpg_guardian_sigils
 WHEN NEW.char_id<>OLD.char_id AND (OLD.active=1 OR OLD.bound=1 OR OLD.locked=1)
 BEGIN SELECT RAISE(ABORT,'guardian_transfer_protected'); END;

-- 114. restore-trigger: guardian_sigil_update_revision
CREATE TRIGGER guardian_sigil_update_revision AFTER UPDATE ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.updated_at WHERE tg_id=OLD.char_id OR tg_id=NEW.char_id;
END;

-- 115. restore-trigger: guardian_welcome_guard
CREATE TRIGGER guardian_welcome_guard BEFORE INSERT ON rpg_guardian_welcome BEGIN
 SELECT RAISE(ABORT,'guardian_welcome_locked') WHERE NOT EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=NEW.recipient_char_id
  AND account_tg_id=NEW.account_id AND level>=15);
END;

-- 116. restore-trigger: guardian_welcome_no_delete
CREATE TRIGGER guardian_welcome_no_delete BEFORE DELETE ON rpg_guardian_welcome BEGIN SELECT RAISE(ABORT,'guardian_welcome_immutable'); END;

-- 117. restore-trigger: guardian_welcome_no_update
CREATE TRIGGER guardian_welcome_no_update BEFORE UPDATE ON rpg_guardian_welcome BEGIN SELECT RAISE(ABORT,'guardian_welcome_immutable'); END;

-- 118. restore-trigger: guardian_welcome_resources
CREATE TRIGGER guardian_welcome_resources AFTER INSERT ON rpg_guardian_welcome BEGIN
 INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(NEW.recipient_char_id,'guardian_free_normal',NEW.draws)
 ON CONFLICT(tg_id,item) DO UPDATE SET quantity=quantity+excluded.quantity;
 INSERT INTO rpg_ledger(event_id,tg_id,type,item,item_delta,note,created_at)
 VALUES('guardian-welcome:'||NEW.account_id,NEW.recipient_char_id,'守護神初見贈禮','guardian_free_normal',NEW.draws,'首次進入；免費普通召喚',NEW.created_at);
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.created_at WHERE tg_id=NEW.recipient_char_id;
END;

-- 119. restore-trigger: rpg_auto_enhance_equipment_delete
CREATE TRIGGER rpg_auto_enhance_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=OLD.id AND status='running')
BEGIN SELECT RAISE(ABORT,'auto_enhance_locked'); END;

-- 120. restore-trigger: rpg_auto_enhance_equipment_update
CREATE TRIGGER rpg_auto_enhance_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=OLD.id AND status='running')
BEGIN SELECT RAISE(ABORT,'auto_enhance_locked'); END;

-- 121. restore-trigger: rpg_auto_reroll_equipment_delete
CREATE TRIGGER rpg_auto_reroll_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=OLD.id AND status='running')
BEGIN SELECT RAISE(ABORT,'auto_reroll_locked'); END;

-- 122. restore-trigger: rpg_auto_reroll_equipment_update
CREATE TRIGGER rpg_auto_reroll_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=OLD.id AND status='running')
BEGIN SELECT RAISE(ABORT,'auto_reroll_locked'); END;

-- 123. restore-trigger: rpg_exchange_enhance_resume
CREATE TRIGGER rpg_exchange_enhance_resume BEFORE UPDATE OF status,item_id ON rpg_auto_enhance
WHEN NEW.status IN ('running','processing') AND EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE 'exchange:%')
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;

-- 124. restore-trigger: rpg_exchange_enhance_start
CREATE TRIGGER rpg_exchange_enhance_start BEFORE INSERT ON rpg_auto_enhance
WHEN EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE 'exchange:%')
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;

-- 125. restore-trigger: rpg_exchange_equipment_delete
CREATE TRIGGER rpg_exchange_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN OLD.trade_id LIKE 'exchange:%' AND EXISTS(
 SELECT 1 FROM rpg_exchange_listings WHERE id=substr(OLD.trade_id,10) AND status='active' AND kind='equip' AND ref=OLD.id
)
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;

-- 126. restore-trigger: rpg_exchange_equipment_update
CREATE TRIGGER rpg_exchange_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN OLD.trade_id LIKE 'exchange:%' AND EXISTS(
 SELECT 1 FROM rpg_exchange_listings WHERE id=substr(OLD.trade_id,10) AND status='active' AND kind='equip' AND ref=OLD.id
)
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;

-- 127. restore-trigger: rpg_exchange_guardian_claim
CREATE TRIGGER rpg_exchange_guardian_claim BEFORE UPDATE OF exchange_id ON rpg_guardian_sigils
WHEN NEW.exchange_id IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,'exchange_guardian_locked') WHERE NEW.bound<>0 OR NEW.active<>0 OR NEW.locked<>0 OR NEW.trade_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=NEW.exchange_id AND status='active' AND kind='guardian' AND ref=NEW.id AND seller_char=NEW.char_id);
END;

-- 128. restore-trigger: rpg_exchange_guardian_delete
CREATE TRIGGER rpg_exchange_guardian_delete BEFORE DELETE ON rpg_guardian_sigils
WHEN OLD.exchange_id IS NOT NULL AND EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=OLD.exchange_id AND status='active' AND kind='guardian' AND ref=OLD.id)
BEGIN SELECT RAISE(ABORT,'exchange_guardian_locked'); END;

-- 129. restore-trigger: rpg_exchange_guardian_request
CREATE TRIGGER rpg_exchange_guardian_request BEFORE INSERT ON rpg_trade_requests
WHEN NEW.object_kind='sigil' AND EXISTS(SELECT 1 FROM rpg_guardian_sigils WHERE id=NEW.equip_id AND exchange_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'exchange_guardian_locked'); END;

-- 130. restore-trigger: rpg_exchange_guardian_share
CREATE TRIGGER rpg_exchange_guardian_share BEFORE INSERT ON rpg_shares
WHEN NEW.object_kind='sigil' AND EXISTS(SELECT 1 FROM rpg_guardian_sigils WHERE id=NEW.equip_id AND exchange_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'exchange_guardian_locked'); END;

-- 131. restore-trigger: rpg_exchange_guardian_update
CREATE TRIGGER rpg_exchange_guardian_update BEFORE UPDATE ON rpg_guardian_sigils
WHEN OLD.exchange_id IS NOT NULL AND EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=OLD.exchange_id AND status='active' AND kind='guardian' AND ref=OLD.id)
BEGIN SELECT RAISE(ABORT,'exchange_guardian_locked'); END;

-- 132. restore-trigger: rpg_exchange_reroll_resume
CREATE TRIGGER rpg_exchange_reroll_resume BEFORE UPDATE OF status,item_id ON rpg_auto_reroll
WHEN NEW.status IN ('running','processing') AND EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE 'exchange:%')
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;

-- 133. restore-trigger: rpg_exchange_reroll_start
CREATE TRIGGER rpg_exchange_reroll_start BEFORE INSERT ON rpg_auto_reroll
WHEN EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE 'exchange:%')
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;

-- 134. verify-all-columns-rowid-types-bytes: rpg_characters
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT a.rowid,typeof(a."tg_id"),hex(a."tg_id"),typeof(a."name"),hex(a."name"),typeof(a."tg_name"),hex(a."tg_name"),typeof(a."gender"),hex(a."gender"),typeof(a."base_class"),hex(a."base_class"),typeof(a."class_path"),hex(a."class_path"),typeof(a."pending_tier"),hex(a."pending_tier"),typeof(a."level"),hex(a."level"),typeof(a."exp"),hex(a."exp"),typeof(a."hp"),hex(a."hp"),typeof(a."mp"),hex(a."mp"),typeof(a."map_id"),hex(a."map_id"),typeof(a."idle_state"),hex(a."idle_state"),typeof(a."state_until"),hex(a."state_until"),typeof(a."auto_red_pct"),hex(a."auto_red_pct"),typeof(a."auto_blue"),hex(a."auto_blue"),typeof(a."gold"),hex(a."gold"),typeof(a."last_settle_at"),hex(a."last_settle_at"),typeof(a."last_daily_gold_day"),hex(a."last_daily_gold_day"),typeof(a."penalty_day"),hex(a."penalty_day"),typeof(a."penalties_today"),hex(a."penalties_today"),typeof(a."drop_day"),hex(a."drop_day"),typeof(a."drops_today"),hex(a."drops_today"),typeof(a."deaths_total"),hex(a."deaths_total"),typeof(a."last_reselect_at"),hex(a."last_reselect_at"),typeof(a."boss_down_until"),hex(a."boss_down_until"),typeof(a."ladder_points"),hex(a."ladder_points"),typeof(a."pvp_wins"),hex(a."pvp_wins"),typeof(a."pvp_losses"),hex(a."pvp_losses"),typeof(a."created_day"),hex(a."created_day"),typeof(a."created_at"),hex(a."created_at"),typeof(a."updated_at"),hex(a."updated_at"),typeof(a."rev"),hex(a."rev"),typeof(a."tg_username"),hex(a."tg_username"),typeof(a."account_tg_id"),hex(a."account_tg_id"),typeof(a."char_slot"),hex(a."char_slot"),typeof(a."special_json"),hex(a."special_json"),typeof(a."party_id"),hex(a."party_id"),typeof(a."idle_combat_json"),hex(a."idle_combat_json"),typeof(a."guardian_draw_remainder"),hex(a."guardian_draw_remainder"),typeof(a."collection_active_map"),hex(a."collection_active_map") FROM "rpg_characters" a EXCEPT SELECT b."__thief_saved_rowid",typeof(b."tg_id"),hex(b."tg_id"),typeof(b."name"),hex(b."name"),typeof(b."tg_name"),hex(b."tg_name"),typeof(b."gender"),hex(b."gender"),typeof(b."base_class"),hex(b."base_class"),typeof(b."class_path"),hex(b."class_path"),typeof(b."pending_tier"),hex(b."pending_tier"),typeof(b."level"),hex(b."level"),typeof(b."exp"),hex(b."exp"),typeof(b."hp"),hex(b."hp"),typeof(b."mp"),hex(b."mp"),typeof(b."map_id"),hex(b."map_id"),typeof(b."idle_state"),hex(b."idle_state"),typeof(b."state_until"),hex(b."state_until"),typeof(b."auto_red_pct"),hex(b."auto_red_pct"),typeof(b."auto_blue"),hex(b."auto_blue"),typeof(b."gold"),hex(b."gold"),typeof(b."last_settle_at"),hex(b."last_settle_at"),typeof(b."last_daily_gold_day"),hex(b."last_daily_gold_day"),typeof(b."penalty_day"),hex(b."penalty_day"),typeof(b."penalties_today"),hex(b."penalties_today"),typeof(b."drop_day"),hex(b."drop_day"),typeof(b."drops_today"),hex(b."drops_today"),typeof(b."deaths_total"),hex(b."deaths_total"),typeof(b."last_reselect_at"),hex(b."last_reselect_at"),typeof(b."boss_down_until"),hex(b."boss_down_until"),typeof(b."ladder_points"),hex(b."ladder_points"),typeof(b."pvp_wins"),hex(b."pvp_wins"),typeof(b."pvp_losses"),hex(b."pvp_losses"),typeof(b."created_day"),hex(b."created_day"),typeof(b."created_at"),hex(b."created_at"),typeof(b."updated_at"),hex(b."updated_at"),typeof(b."rev"),hex(b."rev"),typeof(b."tg_username"),hex(b."tg_username"),typeof(b."account_tg_id"),hex(b."account_tg_id"),typeof(b."char_slot"),hex(b."char_slot"),typeof(b."special_json"),hex(b."special_json"),typeof(b."party_id"),hex(b."party_id"),typeof(b."idle_combat_json"),hex(b."idle_combat_json"),typeof(b."guardian_draw_remainder"),hex(b."guardian_draw_remainder"),typeof(b."collection_active_map"),hex(b."collection_active_map") FROM "_thief_backup_rpg_characters" b) AND NOT EXISTS (SELECT b."__thief_saved_rowid",typeof(b."tg_id"),hex(b."tg_id"),typeof(b."name"),hex(b."name"),typeof(b."tg_name"),hex(b."tg_name"),typeof(b."gender"),hex(b."gender"),typeof(b."base_class"),hex(b."base_class"),typeof(b."class_path"),hex(b."class_path"),typeof(b."pending_tier"),hex(b."pending_tier"),typeof(b."level"),hex(b."level"),typeof(b."exp"),hex(b."exp"),typeof(b."hp"),hex(b."hp"),typeof(b."mp"),hex(b."mp"),typeof(b."map_id"),hex(b."map_id"),typeof(b."idle_state"),hex(b."idle_state"),typeof(b."state_until"),hex(b."state_until"),typeof(b."auto_red_pct"),hex(b."auto_red_pct"),typeof(b."auto_blue"),hex(b."auto_blue"),typeof(b."gold"),hex(b."gold"),typeof(b."last_settle_at"),hex(b."last_settle_at"),typeof(b."last_daily_gold_day"),hex(b."last_daily_gold_day"),typeof(b."penalty_day"),hex(b."penalty_day"),typeof(b."penalties_today"),hex(b."penalties_today"),typeof(b."drop_day"),hex(b."drop_day"),typeof(b."drops_today"),hex(b."drops_today"),typeof(b."deaths_total"),hex(b."deaths_total"),typeof(b."last_reselect_at"),hex(b."last_reselect_at"),typeof(b."boss_down_until"),hex(b."boss_down_until"),typeof(b."ladder_points"),hex(b."ladder_points"),typeof(b."pvp_wins"),hex(b."pvp_wins"),typeof(b."pvp_losses"),hex(b."pvp_losses"),typeof(b."created_day"),hex(b."created_day"),typeof(b."created_at"),hex(b."created_at"),typeof(b."updated_at"),hex(b."updated_at"),typeof(b."rev"),hex(b."rev"),typeof(b."tg_username"),hex(b."tg_username"),typeof(b."account_tg_id"),hex(b."account_tg_id"),typeof(b."char_slot"),hex(b."char_slot"),typeof(b."special_json"),hex(b."special_json"),typeof(b."party_id"),hex(b."party_id"),typeof(b."idle_combat_json"),hex(b."idle_combat_json"),typeof(b."guardian_draw_remainder"),hex(b."guardian_draw_remainder"),typeof(b."collection_active_map"),hex(b."collection_active_map") FROM "_thief_backup_rpg_characters" b EXCEPT SELECT a.rowid,typeof(a."tg_id"),hex(a."tg_id"),typeof(a."name"),hex(a."name"),typeof(a."tg_name"),hex(a."tg_name"),typeof(a."gender"),hex(a."gender"),typeof(a."base_class"),hex(a."base_class"),typeof(a."class_path"),hex(a."class_path"),typeof(a."pending_tier"),hex(a."pending_tier"),typeof(a."level"),hex(a."level"),typeof(a."exp"),hex(a."exp"),typeof(a."hp"),hex(a."hp"),typeof(a."mp"),hex(a."mp"),typeof(a."map_id"),hex(a."map_id"),typeof(a."idle_state"),hex(a."idle_state"),typeof(a."state_until"),hex(a."state_until"),typeof(a."auto_red_pct"),hex(a."auto_red_pct"),typeof(a."auto_blue"),hex(a."auto_blue"),typeof(a."gold"),hex(a."gold"),typeof(a."last_settle_at"),hex(a."last_settle_at"),typeof(a."last_daily_gold_day"),hex(a."last_daily_gold_day"),typeof(a."penalty_day"),hex(a."penalty_day"),typeof(a."penalties_today"),hex(a."penalties_today"),typeof(a."drop_day"),hex(a."drop_day"),typeof(a."drops_today"),hex(a."drops_today"),typeof(a."deaths_total"),hex(a."deaths_total"),typeof(a."last_reselect_at"),hex(a."last_reselect_at"),typeof(a."boss_down_until"),hex(a."boss_down_until"),typeof(a."ladder_points"),hex(a."ladder_points"),typeof(a."pvp_wins"),hex(a."pvp_wins"),typeof(a."pvp_losses"),hex(a."pvp_losses"),typeof(a."created_day"),hex(a."created_day"),typeof(a."created_at"),hex(a."created_at"),typeof(a."updated_at"),hex(a."updated_at"),typeof(a."rev"),hex(a."rev"),typeof(a."tg_username"),hex(a."tg_username"),typeof(a."account_tg_id"),hex(a."account_tg_id"),typeof(a."char_slot"),hex(a."char_slot"),typeof(a."special_json"),hex(a."special_json"),typeof(a."party_id"),hex(a."party_id"),typeof(a."idle_combat_json"),hex(a."idle_combat_json"),typeof(a."guardian_draw_remainder"),hex(a."guardian_draw_remainder"),typeof(a."collection_active_map"),hex(a."collection_active_map") FROM "rpg_characters" a) AND (SELECT COUNT(*) FROM "rpg_characters")=(SELECT COUNT(*) FROM "_thief_backup_rpg_characters")) THEN 1 ELSE 0 END;

-- 135. verify-all-columns-rowid-types-bytes: rpg_equipment
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT a.rowid,typeof(a."id"),hex(a."id"),typeof(a."tg_id"),hex(a."tg_id"),typeof(a."slot"),hex(a."slot"),typeof(a."kind"),hex(a."kind"),typeof(a."class_req"),hex(a."class_req"),typeof(a."branch_req"),hex(a."branch_req"),typeof(a."tier"),hex(a."tier"),typeof(a."level_req"),hex(a."level_req"),typeof(a."name"),hex(a."name"),typeof(a."source"),hex(a."source"),typeof(a."base_stat"),hex(a."base_stat"),typeof(a."bonus_json"),hex(a."bonus_json"),typeof(a."element"),hex(a."element"),typeof(a."element_stat"),hex(a."element_stat"),typeof(a."element_tier"),hex(a."element_tier"),typeof(a."enhance_level"),hex(a."enhance_level"),typeof(a."is_equipped"),hex(a."is_equipped"),typeof(a."convert_token"),hex(a."convert_token"),typeof(a."created_at"),hex(a."created_at"),typeof(a."grade"),hex(a."grade"),typeof(a."affix_json"),hex(a."affix_json"),typeof(a."bound"),hex(a."bound"),typeof(a."trade_id"),hex(a."trade_id"),typeof(a."affixes_json"),hex(a."affixes_json") FROM "rpg_equipment" a EXCEPT SELECT b."__thief_saved_rowid",typeof(b."id"),hex(b."id"),typeof(b."tg_id"),hex(b."tg_id"),typeof(b."slot"),hex(b."slot"),typeof(b."kind"),hex(b."kind"),typeof(b."class_req"),hex(b."class_req"),typeof(b."branch_req"),hex(b."branch_req"),typeof(b."tier"),hex(b."tier"),typeof(b."level_req"),hex(b."level_req"),typeof(b."name"),hex(b."name"),typeof(b."source"),hex(b."source"),typeof(b."base_stat"),hex(b."base_stat"),typeof(b."bonus_json"),hex(b."bonus_json"),typeof(b."element"),hex(b."element"),typeof(b."element_stat"),hex(b."element_stat"),typeof(b."element_tier"),hex(b."element_tier"),typeof(b."enhance_level"),hex(b."enhance_level"),typeof(b."is_equipped"),hex(b."is_equipped"),typeof(b."convert_token"),hex(b."convert_token"),typeof(b."created_at"),hex(b."created_at"),typeof(b."grade"),hex(b."grade"),typeof(b."affix_json"),hex(b."affix_json"),typeof(b."bound"),hex(b."bound"),typeof(b."trade_id"),hex(b."trade_id"),typeof(b."affixes_json"),hex(b."affixes_json") FROM "_thief_backup_rpg_equipment" b) AND NOT EXISTS (SELECT b."__thief_saved_rowid",typeof(b."id"),hex(b."id"),typeof(b."tg_id"),hex(b."tg_id"),typeof(b."slot"),hex(b."slot"),typeof(b."kind"),hex(b."kind"),typeof(b."class_req"),hex(b."class_req"),typeof(b."branch_req"),hex(b."branch_req"),typeof(b."tier"),hex(b."tier"),typeof(b."level_req"),hex(b."level_req"),typeof(b."name"),hex(b."name"),typeof(b."source"),hex(b."source"),typeof(b."base_stat"),hex(b."base_stat"),typeof(b."bonus_json"),hex(b."bonus_json"),typeof(b."element"),hex(b."element"),typeof(b."element_stat"),hex(b."element_stat"),typeof(b."element_tier"),hex(b."element_tier"),typeof(b."enhance_level"),hex(b."enhance_level"),typeof(b."is_equipped"),hex(b."is_equipped"),typeof(b."convert_token"),hex(b."convert_token"),typeof(b."created_at"),hex(b."created_at"),typeof(b."grade"),hex(b."grade"),typeof(b."affix_json"),hex(b."affix_json"),typeof(b."bound"),hex(b."bound"),typeof(b."trade_id"),hex(b."trade_id"),typeof(b."affixes_json"),hex(b."affixes_json") FROM "_thief_backup_rpg_equipment" b EXCEPT SELECT a.rowid,typeof(a."id"),hex(a."id"),typeof(a."tg_id"),hex(a."tg_id"),typeof(a."slot"),hex(a."slot"),typeof(a."kind"),hex(a."kind"),typeof(a."class_req"),hex(a."class_req"),typeof(a."branch_req"),hex(a."branch_req"),typeof(a."tier"),hex(a."tier"),typeof(a."level_req"),hex(a."level_req"),typeof(a."name"),hex(a."name"),typeof(a."source"),hex(a."source"),typeof(a."base_stat"),hex(a."base_stat"),typeof(a."bonus_json"),hex(a."bonus_json"),typeof(a."element"),hex(a."element"),typeof(a."element_stat"),hex(a."element_stat"),typeof(a."element_tier"),hex(a."element_tier"),typeof(a."enhance_level"),hex(a."enhance_level"),typeof(a."is_equipped"),hex(a."is_equipped"),typeof(a."convert_token"),hex(a."convert_token"),typeof(a."created_at"),hex(a."created_at"),typeof(a."grade"),hex(a."grade"),typeof(a."affix_json"),hex(a."affix_json"),typeof(a."bound"),hex(a."bound"),typeof(a."trade_id"),hex(a."trade_id"),typeof(a."affixes_json"),hex(a."affixes_json") FROM "rpg_equipment" a) AND (SELECT COUNT(*) FROM "rpg_equipment")=(SELECT COUNT(*) FROM "_thief_backup_rpg_equipment")) THEN 1 ELSE 0 END;

-- 136. verify-all-columns-rowid-types-bytes: rpg_exchange_listings
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT a.rowid,typeof(a."seq"),hex(a."seq"),typeof(a."id"),hex(a."id"),typeof(a."seller_account"),hex(a."seller_account"),typeof(a."seller_char"),hex(a."seller_char"),typeof(a."buyer_char"),hex(a."buyer_char"),typeof(a."kind"),hex(a."kind"),typeof(a."ref"),hex(a."ref"),typeof(a."qty"),hex(a."qty"),typeof(a."price"),hex(a."price"),typeof(a."fee"),hex(a."fee"),typeof(a."category"),hex(a."category"),typeof(a."class_req"),hex(a."class_req"),typeof(a."tier"),hex(a."tier"),typeof(a."quality"),hex(a."quality"),typeof(a."enhance"),hex(a."enhance"),typeof(a."snapshot_json"),hex(a."snapshot_json"),typeof(a."status"),hex(a."status"),typeof(a."rev"),hex(a."rev"),typeof(a."created_at"),hex(a."created_at"),typeof(a."updated_at"),hex(a."updated_at"),typeof(a."closed_at"),hex(a."closed_at") FROM "rpg_exchange_listings" a EXCEPT SELECT b."__thief_saved_rowid",typeof(b."seq"),hex(b."seq"),typeof(b."id"),hex(b."id"),typeof(b."seller_account"),hex(b."seller_account"),typeof(b."seller_char"),hex(b."seller_char"),typeof(b."buyer_char"),hex(b."buyer_char"),typeof(b."kind"),hex(b."kind"),typeof(b."ref"),hex(b."ref"),typeof(b."qty"),hex(b."qty"),typeof(b."price"),hex(b."price"),typeof(b."fee"),hex(b."fee"),typeof(b."category"),hex(b."category"),typeof(b."class_req"),hex(b."class_req"),typeof(b."tier"),hex(b."tier"),typeof(b."quality"),hex(b."quality"),typeof(b."enhance"),hex(b."enhance"),typeof(b."snapshot_json"),hex(b."snapshot_json"),typeof(b."status"),hex(b."status"),typeof(b."rev"),hex(b."rev"),typeof(b."created_at"),hex(b."created_at"),typeof(b."updated_at"),hex(b."updated_at"),typeof(b."closed_at"),hex(b."closed_at") FROM "_thief_backup_rpg_exchange_listings" b) AND NOT EXISTS (SELECT b."__thief_saved_rowid",typeof(b."seq"),hex(b."seq"),typeof(b."id"),hex(b."id"),typeof(b."seller_account"),hex(b."seller_account"),typeof(b."seller_char"),hex(b."seller_char"),typeof(b."buyer_char"),hex(b."buyer_char"),typeof(b."kind"),hex(b."kind"),typeof(b."ref"),hex(b."ref"),typeof(b."qty"),hex(b."qty"),typeof(b."price"),hex(b."price"),typeof(b."fee"),hex(b."fee"),typeof(b."category"),hex(b."category"),typeof(b."class_req"),hex(b."class_req"),typeof(b."tier"),hex(b."tier"),typeof(b."quality"),hex(b."quality"),typeof(b."enhance"),hex(b."enhance"),typeof(b."snapshot_json"),hex(b."snapshot_json"),typeof(b."status"),hex(b."status"),typeof(b."rev"),hex(b."rev"),typeof(b."created_at"),hex(b."created_at"),typeof(b."updated_at"),hex(b."updated_at"),typeof(b."closed_at"),hex(b."closed_at") FROM "_thief_backup_rpg_exchange_listings" b EXCEPT SELECT a.rowid,typeof(a."seq"),hex(a."seq"),typeof(a."id"),hex(a."id"),typeof(a."seller_account"),hex(a."seller_account"),typeof(a."seller_char"),hex(a."seller_char"),typeof(a."buyer_char"),hex(a."buyer_char"),typeof(a."kind"),hex(a."kind"),typeof(a."ref"),hex(a."ref"),typeof(a."qty"),hex(a."qty"),typeof(a."price"),hex(a."price"),typeof(a."fee"),hex(a."fee"),typeof(a."category"),hex(a."category"),typeof(a."class_req"),hex(a."class_req"),typeof(a."tier"),hex(a."tier"),typeof(a."quality"),hex(a."quality"),typeof(a."enhance"),hex(a."enhance"),typeof(a."snapshot_json"),hex(a."snapshot_json"),typeof(a."status"),hex(a."status"),typeof(a."rev"),hex(a."rev"),typeof(a."created_at"),hex(a."created_at"),typeof(a."updated_at"),hex(a."updated_at"),typeof(a."closed_at"),hex(a."closed_at") FROM "rpg_exchange_listings" a) AND (SELECT COUNT(*) FROM "rpg_exchange_listings")=(SELECT COUNT(*) FROM "_thief_backup_rpg_exchange_listings")) THEN 1 ELSE 0 END;

-- 137. verify-all-columns-rowid-types-bytes: rpg_guardian_operations
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT a.rowid,typeof(a."operation_id"),hex(a."operation_id"),typeof(a."account_id"),hex(a."account_id"),typeof(a."char_id"),hex(a."char_id"),typeof(a."request_id"),hex(a."request_id"),typeof(a."action"),hex(a."action"),typeof(a."payload_hash"),hex(a."payload_hash"),typeof(a."config_version"),hex(a."config_version"),typeof(a."cost_json"),hex(a."cost_json"),typeof(a."result_json"),hex(a."result_json"),typeof(a."created_at"),hex(a."created_at") FROM "rpg_guardian_operations" a EXCEPT SELECT b."__thief_saved_rowid",typeof(b."operation_id"),hex(b."operation_id"),typeof(b."account_id"),hex(b."account_id"),typeof(b."char_id"),hex(b."char_id"),typeof(b."request_id"),hex(b."request_id"),typeof(b."action"),hex(b."action"),typeof(b."payload_hash"),hex(b."payload_hash"),typeof(b."config_version"),hex(b."config_version"),typeof(b."cost_json"),hex(b."cost_json"),typeof(b."result_json"),hex(b."result_json"),typeof(b."created_at"),hex(b."created_at") FROM "_thief_backup_rpg_guardian_operations" b) AND NOT EXISTS (SELECT b."__thief_saved_rowid",typeof(b."operation_id"),hex(b."operation_id"),typeof(b."account_id"),hex(b."account_id"),typeof(b."char_id"),hex(b."char_id"),typeof(b."request_id"),hex(b."request_id"),typeof(b."action"),hex(b."action"),typeof(b."payload_hash"),hex(b."payload_hash"),typeof(b."config_version"),hex(b."config_version"),typeof(b."cost_json"),hex(b."cost_json"),typeof(b."result_json"),hex(b."result_json"),typeof(b."created_at"),hex(b."created_at") FROM "_thief_backup_rpg_guardian_operations" b EXCEPT SELECT a.rowid,typeof(a."operation_id"),hex(a."operation_id"),typeof(a."account_id"),hex(a."account_id"),typeof(a."char_id"),hex(a."char_id"),typeof(a."request_id"),hex(a."request_id"),typeof(a."action"),hex(a."action"),typeof(a."payload_hash"),hex(a."payload_hash"),typeof(a."config_version"),hex(a."config_version"),typeof(a."cost_json"),hex(a."cost_json"),typeof(a."result_json"),hex(a."result_json"),typeof(a."created_at"),hex(a."created_at") FROM "rpg_guardian_operations" a) AND (SELECT COUNT(*) FROM "rpg_guardian_operations")=(SELECT COUNT(*) FROM "_thief_backup_rpg_guardian_operations")) THEN 1 ELSE 0 END;

-- 138. verify-all-columns-rowid-types-bytes: rpg_guardian_sigils
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT a.rowid,typeof(a."id"),hex(a."id"),typeof(a."char_id"),hex(a."char_id"),typeof(a."type"),hex(a."type"),typeof(a."quality"),hex(a."quality"),typeof(a."bound"),hex(a."bound"),typeof(a."active"),hex(a."active"),typeof(a."locked"),hex(a."locked"),typeof(a."trade_id"),hex(a."trade_id"),typeof(a."rev"),hex(a."rev"),typeof(a."source_operation_id"),hex(a."source_operation_id"),typeof(a."created_at"),hex(a."created_at"),typeof(a."updated_at"),hex(a."updated_at"),typeof(a."exchange_id"),hex(a."exchange_id") FROM "rpg_guardian_sigils" a EXCEPT SELECT b."__thief_saved_rowid",typeof(b."id"),hex(b."id"),typeof(b."char_id"),hex(b."char_id"),typeof(b."type"),hex(b."type"),typeof(b."quality"),hex(b."quality"),typeof(b."bound"),hex(b."bound"),typeof(b."active"),hex(b."active"),typeof(b."locked"),hex(b."locked"),typeof(b."trade_id"),hex(b."trade_id"),typeof(b."rev"),hex(b."rev"),typeof(b."source_operation_id"),hex(b."source_operation_id"),typeof(b."created_at"),hex(b."created_at"),typeof(b."updated_at"),hex(b."updated_at"),typeof(b."exchange_id"),hex(b."exchange_id") FROM "_thief_backup_rpg_guardian_sigils" b) AND NOT EXISTS (SELECT b."__thief_saved_rowid",typeof(b."id"),hex(b."id"),typeof(b."char_id"),hex(b."char_id"),typeof(b."type"),hex(b."type"),typeof(b."quality"),hex(b."quality"),typeof(b."bound"),hex(b."bound"),typeof(b."active"),hex(b."active"),typeof(b."locked"),hex(b."locked"),typeof(b."trade_id"),hex(b."trade_id"),typeof(b."rev"),hex(b."rev"),typeof(b."source_operation_id"),hex(b."source_operation_id"),typeof(b."created_at"),hex(b."created_at"),typeof(b."updated_at"),hex(b."updated_at"),typeof(b."exchange_id"),hex(b."exchange_id") FROM "_thief_backup_rpg_guardian_sigils" b EXCEPT SELECT a.rowid,typeof(a."id"),hex(a."id"),typeof(a."char_id"),hex(a."char_id"),typeof(a."type"),hex(a."type"),typeof(a."quality"),hex(a."quality"),typeof(a."bound"),hex(a."bound"),typeof(a."active"),hex(a."active"),typeof(a."locked"),hex(a."locked"),typeof(a."trade_id"),hex(a."trade_id"),typeof(a."rev"),hex(a."rev"),typeof(a."source_operation_id"),hex(a."source_operation_id"),typeof(a."created_at"),hex(a."created_at"),typeof(a."updated_at"),hex(a."updated_at"),typeof(a."exchange_id"),hex(a."exchange_id") FROM "rpg_guardian_sigils" a) AND (SELECT COUNT(*) FROM "rpg_guardian_sigils")=(SELECT COUNT(*) FROM "_thief_backup_rpg_guardian_sigils")) THEN 1 ELSE 0 END;

-- 139. verify-all-columns-rowid-types-bytes: rpg_guardian_voucher_grants
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT a.rowid,typeof(a."account_id"),hex(a."account_id"),typeof(a."boss_id"),hex(a."boss_id"),typeof(a."day"),hex(a."day"),typeof(a."recipient_char_id"),hex(a."recipient_char_id"),typeof(a."created_at"),hex(a."created_at") FROM "rpg_guardian_voucher_grants" a EXCEPT SELECT b."__thief_saved_rowid",typeof(b."account_id"),hex(b."account_id"),typeof(b."boss_id"),hex(b."boss_id"),typeof(b."day"),hex(b."day"),typeof(b."recipient_char_id"),hex(b."recipient_char_id"),typeof(b."created_at"),hex(b."created_at") FROM "_thief_backup_rpg_guardian_voucher_grants" b) AND NOT EXISTS (SELECT b."__thief_saved_rowid",typeof(b."account_id"),hex(b."account_id"),typeof(b."boss_id"),hex(b."boss_id"),typeof(b."day"),hex(b."day"),typeof(b."recipient_char_id"),hex(b."recipient_char_id"),typeof(b."created_at"),hex(b."created_at") FROM "_thief_backup_rpg_guardian_voucher_grants" b EXCEPT SELECT a.rowid,typeof(a."account_id"),hex(a."account_id"),typeof(a."boss_id"),hex(a."boss_id"),typeof(a."day"),hex(a."day"),typeof(a."recipient_char_id"),hex(a."recipient_char_id"),typeof(a."created_at"),hex(a."created_at") FROM "rpg_guardian_voucher_grants" a) AND (SELECT COUNT(*) FROM "rpg_guardian_voucher_grants")=(SELECT COUNT(*) FROM "_thief_backup_rpg_guardian_voucher_grants")) THEN 1 ELSE 0 END;

-- 140. verify-all-columns-rowid-types-bytes: rpg_guardian_welcome
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT a.rowid,typeof(a."account_id"),hex(a."account_id"),typeof(a."recipient_char_id"),hex(a."recipient_char_id"),typeof(a."draws"),hex(a."draws"),typeof(a."created_at"),hex(a."created_at") FROM "rpg_guardian_welcome" a EXCEPT SELECT b."__thief_saved_rowid",typeof(b."account_id"),hex(b."account_id"),typeof(b."recipient_char_id"),hex(b."recipient_char_id"),typeof(b."draws"),hex(b."draws"),typeof(b."created_at"),hex(b."created_at") FROM "_thief_backup_rpg_guardian_welcome" b) AND NOT EXISTS (SELECT b."__thief_saved_rowid",typeof(b."account_id"),hex(b."account_id"),typeof(b."recipient_char_id"),hex(b."recipient_char_id"),typeof(b."draws"),hex(b."draws"),typeof(b."created_at"),hex(b."created_at") FROM "_thief_backup_rpg_guardian_welcome" b EXCEPT SELECT a.rowid,typeof(a."account_id"),hex(a."account_id"),typeof(a."recipient_char_id"),hex(a."recipient_char_id"),typeof(a."draws"),hex(a."draws"),typeof(a."created_at"),hex(a."created_at") FROM "rpg_guardian_welcome" a) AND (SELECT COUNT(*) FROM "rpg_guardian_welcome")=(SELECT COUNT(*) FROM "_thief_backup_rpg_guardian_welcome")) THEN 1 ELSE 0 END;

-- 141. verify-sequence
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT name,seq FROM sqlite_sequence EXCEPT SELECT name,seq FROM "_thief_backup_sequence") AND NOT EXISTS (SELECT name,seq FROM "_thief_backup_sequence" EXCEPT SELECT name,seq FROM sqlite_sequence)) THEN 1 ELSE 0 END;

-- 142. verify-fk: rpg_guardian_operations
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_operations" c WHERE c."char_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_characters" p WHERE p."tg_id"=c."char_id"))) THEN 1 ELSE 0 END;

-- 143. verify-fk: rpg_guardian_sigils
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_sigils" c WHERE c."exchange_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_exchange_listings" p WHERE p."id"=c."exchange_id"))) THEN 1 ELSE 0 END;

-- 144. verify-fk: rpg_guardian_sigils
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_sigils" c WHERE c."source_operation_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_guardian_operations" p WHERE p."operation_id"=c."source_operation_id"))) THEN 1 ELSE 0 END;

-- 145. verify-fk: rpg_guardian_sigils
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_sigils" c WHERE c."trade_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_trades" p WHERE p."id"=c."trade_id"))) THEN 1 ELSE 0 END;

-- 146. verify-fk: rpg_guardian_sigils
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_sigils" c WHERE c."char_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_characters" p WHERE p."tg_id"=c."char_id"))) THEN 1 ELSE 0 END;

-- 147. verify-fk: rpg_guardian_voucher_grants
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_voucher_grants" c WHERE c."recipient_char_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_characters" p WHERE p."tg_id"=c."recipient_char_id"))) THEN 1 ELSE 0 END;

-- 148. verify-fk: rpg_guardian_voucher_grants
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_voucher_grants" c WHERE c."boss_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_boss_instances" p WHERE p."id"=c."boss_id"))) THEN 1 ELSE 0 END;

-- 149. verify-fk: rpg_guardian_voucher_grants
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_voucher_grants" c WHERE c."account_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_accounts" p WHERE p."account_tg_id"=c."account_id"))) THEN 1 ELSE 0 END;

-- 150. verify-fk: rpg_guardian_welcome
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_welcome" c WHERE c."recipient_char_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_characters" p WHERE p."tg_id"=c."recipient_char_id"))) THEN 1 ELSE 0 END;

-- 151. verify-fk: rpg_guardian_welcome
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_guardian_welcome" c WHERE c."account_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_accounts" p WHERE p."account_tg_id"=c."account_id"))) THEN 1 ELSE 0 END;

-- 152. verify-fk: rpg_notice_dismissals
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_notice_dismissals" c WHERE c."account_tg_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_accounts" p WHERE p."account_tg_id"=c."account_tg_id"))) THEN 1 ELSE 0 END;

-- 153. verify-fk: rpg_party_members
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT 1 FROM "rpg_party_members" c WHERE c."party_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rpg_parties" p WHERE p."id"=c."party_id"))) THEN 1 ELSE 0 END;

-- 154. verify-schema
WITH expected(type,name,tbl_name,sql) AS (VALUES ('index','idx_guardian_grants_day','rpg_guardian_voucher_grants','CREATE INDEX idx_guardian_grants_day ON rpg_guardian_voucher_grants(account_id,day)'),
('index','idx_guardian_one_active','rpg_guardian_sigils','CREATE UNIQUE INDEX idx_guardian_one_active ON rpg_guardian_sigils(char_id) WHERE active=1'),
('index','idx_guardian_operations_owner','rpg_guardian_operations','CREATE INDEX idx_guardian_operations_owner ON rpg_guardian_operations(char_id,created_at,operation_id)'),
('index','idx_guardian_owner','rpg_guardian_sigils','CREATE INDEX idx_guardian_owner ON rpg_guardian_sigils(char_id,created_at,id)'),
('index','idx_guardian_trade','rpg_guardian_sigils','CREATE INDEX idx_guardian_trade ON rpg_guardian_sigils(trade_id) WHERE trade_id IS NOT NULL'),
('index','idx_rpg_boss_attack_owner_day','rpg_boss_attacks','CREATE INDEX idx_rpg_boss_attack_owner_day ON rpg_boss_attacks(tg_id,created_at)'),
('index','idx_rpg_boss_status','rpg_boss_instances','CREATE INDEX idx_rpg_boss_status ON rpg_boss_instances(status, ends_at)'),
('index','idx_rpg_characters_account','rpg_characters','CREATE INDEX idx_rpg_characters_account ON rpg_characters(account_tg_id, char_slot)'),
('index','idx_rpg_characters_account_slot','rpg_characters','CREATE UNIQUE INDEX idx_rpg_characters_account_slot ON rpg_characters(account_tg_id, char_slot)'),
('index','idx_rpg_characters_username','rpg_characters','CREATE INDEX idx_rpg_characters_username ON rpg_characters(tg_username COLLATE NOCASE)'),
('index','idx_rpg_equipment_owner','rpg_equipment','CREATE INDEX idx_rpg_equipment_owner ON rpg_equipment(tg_id, is_equipped)'),
('index','idx_rpg_equipment_trade','rpg_equipment','CREATE INDEX idx_rpg_equipment_trade ON rpg_equipment(trade_id) WHERE trade_id IS NOT NULL'),
('index','idx_rpg_ledger_owner','rpg_ledger','CREATE INDEX idx_rpg_ledger_owner ON rpg_ledger(tg_id, created_at)'),
('index','idx_rpg_likes_owner_day','rpg_share_likes','CREATE INDEX idx_rpg_likes_owner_day ON rpg_share_likes(tg_id,created_at)'),
('index','idx_rpg_outbox_delivery','rpg_outbox','CREATE INDEX idx_rpg_outbox_delivery
  ON rpg_outbox(delivered_at, claimed_at, id)'),
('index','idx_rpg_outbox_failed','rpg_outbox','CREATE INDEX idx_rpg_outbox_failed ON rpg_outbox(failed_at) WHERE failed_at IS NOT NULL'),
('index','idx_rpg_outbox_pending','rpg_outbox','CREATE INDEX idx_rpg_outbox_pending ON rpg_outbox(claimed_at, id)'),
('index','idx_rpg_outbox_retry','rpg_outbox','CREATE INDEX idx_rpg_outbox_retry
 ON rpg_outbox(next_attempt_at,claimed_at,id)
 WHERE delivered_at IS NULL AND failed_at IS NULL'),
('index','idx_rpg_party_member_account','rpg_party_members','CREATE INDEX idx_rpg_party_member_account ON rpg_party_members(account_id,party_id)'),
('index','idx_rpg_pk_a','rpg_pk','CREATE INDEX idx_rpg_pk_a ON rpg_pk(a_tg, status, decided_at)'),
('index','idx_rpg_pk_b','rpg_pk','CREATE INDEX idx_rpg_pk_b ON rpg_pk(b_tg, status, decided_at)'),
('index','idx_rpg_pk_open','rpg_pk','CREATE INDEX idx_rpg_pk_open ON rpg_pk(status, expires_at)'),
('index','idx_rpg_reports_owner','rpg_idle_reports','CREATE INDEX idx_rpg_reports_owner ON rpg_idle_reports(tg_id, created_at)'),
('index','idx_rpg_shares_equip','rpg_shares','CREATE INDEX idx_rpg_shares_equip ON rpg_shares(equip_id, created_at)'),
('index','idx_rpg_shares_owner','rpg_shares','CREATE INDEX idx_rpg_shares_owner ON rpg_shares(tg_id, created_at)'),
('index','idx_rpg_trade_log_trade','rpg_trade_log','CREATE INDEX idx_rpg_trade_log_trade ON rpg_trade_log(trade_id, id)'),
('index','idx_rpg_trades_a','rpg_trades','CREATE INDEX idx_rpg_trades_a ON rpg_trades(a_tg, status)'),
('index','idx_rpg_trades_b','rpg_trades','CREATE INDEX idx_rpg_trades_b ON rpg_trades(b_tg, status)'),
('index','idx_rpg_trades_open','rpg_trades','CREATE INDEX idx_rpg_trades_open ON rpg_trades(status, expires_at)'),
('index','idx_rpg_treq_once','rpg_trade_requests','CREATE UNIQUE INDEX idx_rpg_treq_once ON rpg_trade_requests(share_id, requester_tg) WHERE status = ''pending'''),
('index','idx_rpg_treq_owner','rpg_trade_requests','CREATE INDEX idx_rpg_treq_owner ON rpg_trade_requests(owner_tg, status)'),
('index','idx_rpg_treq_req','rpg_trade_requests','CREATE INDEX idx_rpg_treq_req ON rpg_trade_requests(requester_tg, status)'),
('index','rpg_auto_enhance_due','rpg_auto_enhance','CREATE INDEX rpg_auto_enhance_due ON rpg_auto_enhance(status,next_at)'),
('index','rpg_auto_enhance_owner','rpg_auto_enhance','CREATE UNIQUE INDEX rpg_auto_enhance_owner ON rpg_auto_enhance(owner) WHERE status IN (''running'',''processing'')'),
('index','rpg_auto_reroll_due','rpg_auto_reroll','CREATE INDEX rpg_auto_reroll_due ON rpg_auto_reroll(status,next_at)'),
('index','rpg_auto_reroll_item','rpg_auto_reroll','CREATE INDEX rpg_auto_reroll_item ON rpg_auto_reroll(item_id,status)'),
('index','rpg_auto_reroll_owner','rpg_auto_reroll','CREATE UNIQUE INDEX rpg_auto_reroll_owner ON rpg_auto_reroll(owner) WHERE status IN (''running'',''processing'')'),
('index','rpg_background_operations_pending','rpg_background_operations','CREATE INDEX rpg_background_operations_pending ON rpg_background_operations(owner,dismissed_at,seq)'),
('index','rpg_exchange_active','rpg_exchange_listings','CREATE INDEX rpg_exchange_active ON rpg_exchange_listings(status,seq DESC)'),
('index','rpg_exchange_category','rpg_exchange_listings','CREATE INDEX rpg_exchange_category ON rpg_exchange_listings(status,category,seq DESC)'),
('index','rpg_exchange_class','rpg_exchange_listings','CREATE INDEX rpg_exchange_class ON rpg_exchange_listings(status,class_req,seq DESC)'),
('index','rpg_exchange_enhance_item','rpg_auto_enhance','CREATE INDEX rpg_exchange_enhance_item ON rpg_auto_enhance(item_id,status)'),
('index','rpg_exchange_equipment','rpg_exchange_listings','CREATE UNIQUE INDEX rpg_exchange_equipment ON rpg_exchange_listings(ref) WHERE status=''active'' AND kind=''equip'''),
('index','rpg_exchange_guardian','rpg_exchange_listings','CREATE UNIQUE INDEX rpg_exchange_guardian ON rpg_exchange_listings(ref) WHERE status=''active'' AND kind=''guardian'''),
('index','rpg_exchange_history','rpg_exchange_listings','CREATE INDEX rpg_exchange_history ON rpg_exchange_listings(seller_account,seq DESC)'),
('index','rpg_exchange_quality','rpg_exchange_listings','CREATE INDEX rpg_exchange_quality ON rpg_exchange_listings(status,quality,seq DESC)'),
('index','rpg_exchange_seller','rpg_exchange_listings','CREATE INDEX rpg_exchange_seller ON rpg_exchange_listings(seller_account,status,seq DESC)'),
('index','rpg_exchange_tier','rpg_exchange_listings','CREATE INDEX rpg_exchange_tier ON rpg_exchange_listings(status,tier,seq DESC)'),
('index','rpg_guardian_auto_due','rpg_guardian_auto','CREATE INDEX rpg_guardian_auto_due ON rpg_guardian_auto(status,next_at)'),
('index','rpg_guardian_auto_notice','rpg_guardian_auto','CREATE INDEX rpg_guardian_auto_notice ON rpg_guardian_auto(owner,seen_at,created_at)'),
('index','rpg_guardian_auto_owner','rpg_guardian_auto','CREATE UNIQUE INDEX rpg_guardian_auto_owner ON rpg_guardian_auto(owner) WHERE status=''running'''),
('index','rpg_guardian_exchange','rpg_guardian_sigils','CREATE UNIQUE INDEX rpg_guardian_exchange ON rpg_guardian_sigils(exchange_id) WHERE exchange_id IS NOT NULL'),
('index','rpg_parties_open','rpg_parties','CREATE INDEX rpg_parties_open ON rpg_parties(status,expires_at)'),
('table','rpg_accounts','rpg_accounts','CREATE TABLE rpg_accounts (
  account_tg_id TEXT PRIMARY KEY,
  active_char_id TEXT,
  updated_at INTEGER NOT NULL
)'),
('table','rpg_admin_audit','rpg_admin_audit','CREATE TABLE rpg_admin_audit (
  id TEXT PRIMARY KEY, admin_tg_id TEXT, action TEXT NOT NULL, details TEXT, created_at INTEGER NOT NULL
)'),
('table','rpg_app_access','rpg_app_access','CREATE TABLE rpg_app_access (
  tg_id TEXT PRIMARY KEY,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
)'),
('table','rpg_auto_enhance','rpg_auto_enhance','CREATE TABLE rpg_auto_enhance (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, tg_id TEXT NOT NULL, item_id TEXT NOT NULL,
 item_name TEXT NOT NULL, target INTEGER NOT NULL CHECK(target BETWEEN 1 AND 15), blessed INTEGER NOT NULL,
 status TEXT NOT NULL, reason TEXT, level INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 spent_gold INTEGER NOT NULL DEFAULT 0, spent_scrolls INTEGER NOT NULL DEFAULT 0,
 rev INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)'),
('table','rpg_auto_reroll','rpg_auto_reroll','CREATE TABLE rpg_auto_reroll (
 id TEXT PRIMARY KEY,owner TEXT NOT NULL,tg_id TEXT NOT NULL,item_id TEXT NOT NULL,item_name TEXT NOT NULL,
 request_id TEXT NOT NULL,config_json TEXT NOT NULL,class_snapshot TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN (''running'',''processing'',''ended'')),reason TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,spent_gold INTEGER NOT NULL DEFAULT 0,spent_scrolls INTEGER NOT NULL DEFAULT 0,
 result_json TEXT NOT NULL DEFAULT ''{}'',rev INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 UNIQUE(owner,request_id)
)'),
('table','rpg_background_operations','rpg_background_operations','CREATE TABLE rpg_background_operations (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN (''auto_enhance_end'',''guardian_auto'',''auto_reroll_end'')),
 ref_id TEXT NOT NULL,created_at INTEGER NOT NULL,dismissed_at INTEGER,
 UNIQUE(kind,ref_id)
)'),
('table','rpg_book_trade_operations','rpg_book_trade_operations','CREATE TABLE rpg_book_trade_operations (
 char_id TEXT NOT NULL, request_id TEXT NOT NULL, trade_id TEXT NOT NULL,
 PRIMARY KEY(char_id,request_id)
)'),
('table','rpg_boss_attacks','rpg_boss_attacks','CREATE TABLE rpg_boss_attacks (
  boss_id TEXT NOT NULL,
  tg_id TEXT NOT NULL,
  win INTEGER NOT NULL,                -- one attack per player per 3-minute window
  damage INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (boss_id, tg_id, win)
)'),
('table','rpg_boss_instances','rpg_boss_instances','CREATE TABLE rpg_boss_instances (
  id TEXT PRIMARY KEY,                 -- b<YYYYMMDD><HH> (Taipei slot) — one boss per slot
  chat_id TEXT,
  map_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  element TEXT,
  base_hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  hp INTEGER NOT NULL CHECK (hp >= 0),
  participants INTEGER NOT NULL DEFAULT 0,
  spawn_reason TEXT,
  started_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT ''active'' CHECK (status IN (''active'',''settling'',''killed'',''fled'',''vanished'')),
  message_chat_id TEXT, message_id INTEGER,
  result_json TEXT,
  settled_at INTEGER
)'),
('table','rpg_characters','rpg_characters','CREATE TABLE rpg_characters (
  tg_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tg_name TEXT,
  gender TEXT NOT NULL CHECK (gender IN (''m'',''f'')),
  base_class TEXT NOT NULL CHECK (base_class IN (''mage'',''sword'',''archer'',''thief'')),
  class_path TEXT NOT NULL DEFAULT '''',
  pending_tier INTEGER,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 120),
  exp INTEGER NOT NULL DEFAULT 0 CHECK (exp >= 0),
  hp INTEGER NOT NULL,
  mp INTEGER NOT NULL,
  map_id INTEGER NOT NULL DEFAULT 1,
  idle_state TEXT NOT NULL DEFAULT ''fighting'' CHECK (idle_state IN (''fighting'',''no_mp'',''town_no_red'',''reviving'',''gate'')),
  state_until INTEGER,
  auto_red_pct INTEGER NOT NULL DEFAULT 50 CHECK (auto_red_pct BETWEEN 20 AND 80),
  auto_blue INTEGER NOT NULL DEFAULT 1,
  gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
  last_settle_at INTEGER NOT NULL,
  last_daily_gold_day TEXT,
  penalty_day TEXT,
  penalties_today INTEGER NOT NULL DEFAULT 0,
  drop_day TEXT,                       -- Taipei day of drops_today (idle scroll daily caps)
  drops_today TEXT,                    -- JSON {scroll_w,scroll_a,scroll_r}
  deaths_total INTEGER NOT NULL DEFAULT 0,
  last_reselect_at INTEGER,
  boss_down_until INTEGER,
  ladder_points INTEGER NOT NULL DEFAULT 100,
  pvp_wins INTEGER NOT NULL DEFAULT 0,
  pvp_losses INTEGER NOT NULL DEFAULT 0,
  created_day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0
, tg_username TEXT, account_tg_id TEXT, char_slot INTEGER NOT NULL DEFAULT 1 CHECK (char_slot BETWEEN 1 AND 4), special_json TEXT NOT NULL DEFAULT ''{}'', party_id TEXT, idle_combat_json TEXT, guardian_draw_remainder INTEGER NOT NULL DEFAULT 0
 CHECK(guardian_draw_remainder BETWEEN 0 AND 4), collection_active_map INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(collection_active_map)=''integer'' AND collection_active_map BETWEEN 0 AND 12))'),
('table','rpg_class_changes','rpg_class_changes','CREATE TABLE rpg_class_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL, tier INTEGER NOT NULL, from_path TEXT, to_path TEXT, kind TEXT NOT NULL, created_at INTEGER NOT NULL
)'),
('table','rpg_daily_counters','rpg_daily_counters','CREATE TABLE rpg_daily_counters (
  tg_id TEXT NOT NULL, day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tg_id, day, key)
)'),
('table','rpg_equipment','rpg_equipment','CREATE TABLE "rpg_equipment" (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN (''weapon'',''helmet'',''armor'',''gloves'',''boots'',''belt'',''undershirt'',''earring'',''ring'')),
  kind TEXT NOT NULL,
  class_req TEXT NOT NULL CHECK (class_req IN (''mage'',''sword'',''archer'',''any'',''thief'')),
  branch_req TEXT CHECK (branch_req IS NULL OR branch_req IN (''A'',''B'')),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 12),
  level_req INTEGER NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT ''shop'',
  base_stat INTEGER NOT NULL,
  bonus_json TEXT,
  element TEXT,
  element_stat INTEGER NOT NULL DEFAULT 0,
  element_tier TEXT NOT NULL DEFAULT ''common'',
  enhance_level INTEGER NOT NULL DEFAULT 0,
  is_equipped INTEGER NOT NULL DEFAULT 0 CHECK (is_equipped BETWEEN 0 AND 2),
  convert_token INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  grade TEXT NOT NULL DEFAULT ''normal'' CHECK (grade IN (''normal'',''relic'')),
  affix_json TEXT,
  bound INTEGER NOT NULL DEFAULT 0,
  trade_id TEXT, affixes_json TEXT NOT NULL DEFAULT ''[]'',
  CHECK (trade_id IS NULL OR is_equipped = 0)
)'),
('table','rpg_exchange_listings','rpg_exchange_listings','CREATE TABLE rpg_exchange_listings (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 seller_account TEXT NOT NULL, seller_char TEXT NOT NULL, buyer_char TEXT,
 kind TEXT NOT NULL CHECK(kind IN (''equip'',''item'',''guardian'')), ref TEXT NOT NULL,
 qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 99999),
 price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 1000000),
 fee INTEGER NOT NULL CHECK(fee=(price+19)/20),
 category TEXT NOT NULL CHECK(category IN (''equipment'',''scroll'',''collection'',''skillbook'',''other'',''guardian'')),
 class_req TEXT NOT NULL CHECK(class_req IN (''any'',''sword'',''archer'',''mage'',''thief'')), tier INTEGER CHECK(tier BETWEEN 1 AND 12),
 quality TEXT, enhance INTEGER, snapshot_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN (''active'',''sold'',''cancelled'')),
 rev INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 closed_at INTEGER, CHECK(kind=''item'' OR qty=1)
)'),
('table','rpg_exchange_operations','rpg_exchange_operations','CREATE TABLE rpg_exchange_operations (
 account_tg_id TEXT NOT NULL, request_id TEXT NOT NULL, char_id TEXT NOT NULL,
 action TEXT NOT NULL, payload_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(account_tg_id,request_id)
)'),
('table','rpg_guard','rpg_guard','CREATE TABLE rpg_guard (ok INTEGER NOT NULL)'),
('table','rpg_guardian_auto','rpg_guardian_auto','CREATE TABLE rpg_guardian_auto (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, char_id TEXT NOT NULL,
 request_id TEXT NOT NULL, pool TEXT NOT NULL CHECK(pool IN (''normal'',''featured'')),
 draw_count INTEGER NOT NULL CHECK(draw_count IN (5,10)),
 target_type TEXT NOT NULL CHECK(target_type IN (''any'',''attack'',''melee'',''ranged'',''magic'',''loot'')),
 target_rank INTEGER NOT NULL CHECK(target_rank BETWEEN 0 AND 6),
 max_gold INTEGER CHECK(max_gold IS NULL OR max_gold>=0),
 status TEXT NOT NULL CHECK(status IN (''running'',''ended'')), reason TEXT, match_id TEXT,
 batches INTEGER NOT NULL DEFAULT 0, total_draws INTEGER NOT NULL DEFAULT 0,
 spent_gold INTEGER NOT NULL DEFAULT 0, spent_vouchers INTEGER NOT NULL DEFAULT 0,
 used_free INTEGER NOT NULL DEFAULT 0, counts_json TEXT NOT NULL DEFAULT ''[0,0,0,0,0,0,0,0]'',
 rev INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,seen_at INTEGER,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL, single_draw INTEGER NOT NULL DEFAULT 0 CHECK(single_draw IN (0,1)),UNIQUE(owner,request_id)
)'),
('table','rpg_guardian_operations','rpg_guardian_operations','CREATE TABLE rpg_guardian_operations (
 operation_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 6 AND 100),
 action TEXT NOT NULL CHECK(action IN(''summon'',''fuse'',''activate'',''lock'',''unbind'',''share'')),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 config_version TEXT NOT NULL,
 cost_json TEXT NOT NULL CHECK(json_valid(cost_json)),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at INTEGER NOT NULL,
 UNIQUE(char_id,request_id)
)'),
('table','rpg_guardian_sigils','rpg_guardian_sigils','CREATE TABLE rpg_guardian_sigils (
 id TEXT PRIMARY KEY,
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 type TEXT NOT NULL CHECK(type IN(''melee'',''ranged'',''magic'',''loot'')),
 quality INTEGER NOT NULL CHECK(quality BETWEEN 1 AND 8),
 bound INTEGER NOT NULL DEFAULT 0 CHECK(bound IN(0,1)),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),
 locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN(0,1)),
 trade_id TEXT REFERENCES rpg_trades(id),
 rev INTEGER NOT NULL DEFAULT 0 CHECK(rev>=0),
 source_operation_id TEXT NOT NULL REFERENCES rpg_guardian_operations(operation_id),
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL, exchange_id TEXT REFERENCES rpg_exchange_listings(id),
 CHECK(active=0 OR bound=1),
 CHECK(trade_id IS NULL OR (active=0 AND bound=0 AND locked=0))
)'),
('table','rpg_guardian_voucher_grants','rpg_guardian_voucher_grants','CREATE TABLE rpg_guardian_voucher_grants (
 account_id TEXT NOT NULL REFERENCES rpg_accounts(account_tg_id),
 boss_id TEXT NOT NULL REFERENCES rpg_boss_instances(id),
 day TEXT NOT NULL,
 recipient_char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,boss_id),
 CHECK(day=date(created_at/1000,''unixepoch'',''+8 hours''))
)'),
('table','rpg_guardian_welcome','rpg_guardian_welcome','CREATE TABLE rpg_guardian_welcome (
 account_id TEXT PRIMARY KEY REFERENCES rpg_accounts(account_tg_id),
 recipient_char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 draws INTEGER NOT NULL DEFAULT 200 CHECK(draws=200),
 created_at INTEGER NOT NULL
)'),
('table','rpg_idle_reports','rpg_idle_reports','CREATE TABLE rpg_idle_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  from_at INTEGER, to_at INTEGER, ticks INTEGER, skipped_ticks INTEGER,
  kills INTEGER, exp_gained INTEGER, exp_lost INTEGER, deaths INTEGER, elites INTEGER, gold_gained INTEGER,
  used_json TEXT, drops_json TEXT, levels_gained INTEGER, end_state TEXT, created_at INTEGER NOT NULL
)'),
('table','rpg_inventory','rpg_inventory','CREATE TABLE rpg_inventory (
  tg_id TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (tg_id, item)
)'),
('table','rpg_journal_cards','rpg_journal_cards','CREATE TABLE rpg_journal_cards (
 day TEXT PRIMARY KEY, chat_id TEXT NOT NULL, message_id INTEGER
)'),
('table','rpg_journals','rpg_journals','CREATE TABLE rpg_journals (
 account_id TEXT NOT NULL, day TEXT NOT NULL, char_id TEXT NOT NULL,
 tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 12), checked_at INTEGER,
 claims_json TEXT NOT NULL DEFAULT ''{}'', claim_count INTEGER NOT NULL DEFAULT 0 CHECK(claim_count BETWEEN 0 AND 3),
 bonus_claimed INTEGER NOT NULL DEFAULT 0 CHECK(bonus_claimed IN(0,1)),
 rev INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,day)
)'),
('table','rpg_ledger','rpg_ledger','CREATE TABLE rpg_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  tg_id TEXT NOT NULL,
  type TEXT NOT NULL,
  gold_delta INTEGER NOT NULL DEFAULT 0,
  item TEXT,
  item_delta INTEGER NOT NULL DEFAULT 0,
  exp_delta INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL
)'),
('table','rpg_notice_dismissals','rpg_notice_dismissals','CREATE TABLE rpg_notice_dismissals (
 account_tg_id TEXT NOT NULL REFERENCES rpg_accounts(account_tg_id),
 kind TEXT NOT NULL CHECK(kind IN(''auto_enhance_end'',''guardian_summon'',''guardian_fuse'')),
 ref_id TEXT NOT NULL CHECK(length(ref_id) BETWEEN 8 AND 120),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(account_tg_id,kind,ref_id)
)'),
('table','rpg_outbox','rpg_outbox','CREATE TABLE rpg_outbox (            -- messages for 小精靈 to deliver (the Worker never calls Telegram in P1)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT UNIQUE,
  target TEXT NOT NULL CHECK (target IN (''group'',''dm'')),
  tg_id TEXT,
  kind TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER
, delivered_at INTEGER, claim_token TEXT, claim_attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, failed_at INTEGER, last_error_code INTEGER, last_error TEXT)'),
('table','rpg_parties','rpg_parties','CREATE TABLE rpg_parties (
 id TEXT PRIMARY KEY, leader_id TEXT NOT NULL, kind TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT ''lobby'', rev INTEGER NOT NULL DEFAULT 0,
 state_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, chat_id TEXT, message_id INTEGER
)'),
('table','rpg_party_members','rpg_party_members','CREATE TABLE rpg_party_members (
 party_id TEXT NOT NULL REFERENCES rpg_parties(id), char_id TEXT NOT NULL,
 account_id TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0,
 joined_at INTEGER NOT NULL, PRIMARY KEY(party_id,char_id), UNIQUE(party_id,account_id)
)'),
('table','rpg_party_operations','rpg_party_operations','CREATE TABLE rpg_party_operations (
 party_id TEXT NOT NULL, char_id TEXT NOT NULL, request_id TEXT NOT NULL,
 result_json TEXT NOT NULL, PRIMARY KEY(party_id,char_id,request_id)
)'),
('table','rpg_party_presence','rpg_party_presence','CREATE TABLE rpg_party_presence (
 account_id TEXT PRIMARY KEY, party_id TEXT NOT NULL, char_id TEXT NOT NULL UNIQUE
)'),
('table','rpg_party_rewards','rpg_party_rewards','CREATE TABLE rpg_party_rewards (
 party_id TEXT NOT NULL, char_id TEXT NOT NULL, reward_json TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(party_id,char_id)
)'),
('table','rpg_pk','rpg_pk','CREATE TABLE rpg_pk (
  id TEXT PRIMARY KEY,
  a_tg TEXT NOT NULL,                  -- challenger
  b_tg TEXT NOT NULL,                  -- challenged
  status TEXT NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'',''done'',''declined'',''cancelled'',''expired'')),
  origin TEXT NOT NULL DEFAULT ''app'',  -- app | group
  chat_id TEXT, message_id INTEGER,    -- group card
  winner_tg TEXT, loser_tg TEXT,
  seed INTEGER,                        -- crypto-random at accept time (replayable, not predictable)
  rounds INTEGER, log_json TEXT,       -- summary for the card / Mini App replay
  drop_equip_id TEXT, drop_json TEXT, ward_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER,
  CHECK (a_tg <> b_tg)
)'),
('table','rpg_share_likes','rpg_share_likes','CREATE TABLE rpg_share_likes (
  share_id TEXT NOT NULL, tg_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, tg_id)
)'),
('table','rpg_shares','rpg_shares','CREATE TABLE "rpg_shares" (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,
  equip_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (''share'',''relic'',''pk'',''enhance'')),
  snapshot_json TEXT NOT NULL,
  context_json TEXT,
  tradeable INTEGER NOT NULL DEFAULT 1,
  likes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT ''open'' CHECK (status IN (''open'',''traded'')),
  chat_id TEXT,
  message_id INTEGER,
  created_at INTEGER NOT NULL
, object_kind TEXT NOT NULL DEFAULT ''equip'' CHECK(object_kind IN (''equip'',''sigil'')))'),
('table','rpg_trade_items','rpg_trade_items','CREATE TABLE "rpg_trade_items" (
 trade_id TEXT NOT NULL,
 side TEXT NOT NULL CHECK(side IN (''a'',''b'')),
 kind TEXT NOT NULL CHECK(kind IN (''equip'',''item'',''sigil'')),
 ref TEXT NOT NULL,
 qty INTEGER NOT NULL DEFAULT 1 CHECK(qty>0),
 snapshot_json TEXT,
 PRIMARY KEY(trade_id,side,kind,ref)
)'),
('table','rpg_trade_log','rpg_trade_log','CREATE TABLE rpg_trade_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL,
  tg_id TEXT,
  action TEXT NOT NULL,                -- open | add | remove | gold | confirm | unconfirm | done | cancel | expire
  details TEXT,
  created_at INTEGER NOT NULL
)'),
('table','rpg_trade_operations','rpg_trade_operations','CREATE TABLE rpg_trade_operations (
  trade_id TEXT NOT NULL,
  tg_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trade_id, tg_id, request_id)
)'),
('table','rpg_trade_requests','rpg_trade_requests','CREATE TABLE rpg_trade_requests (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  equip_id TEXT NOT NULL,
  owner_tg TEXT NOT NULL,
  requester_tg TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'',''accepted'',''rejected'',''expired'',''cancelled'')),
  trade_id TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER, object_kind TEXT NOT NULL DEFAULT ''equip'' CHECK(object_kind IN (''equip'',''sigil'')),
  CHECK (owner_tg <> requester_tg)
)'),
('table','rpg_trades','rpg_trades','CREATE TABLE rpg_trades (
  id TEXT PRIMARY KEY,
  a_tg TEXT NOT NULL,                  -- initiator
  b_tg TEXT NOT NULL,                  -- counterparty
  status TEXT NOT NULL DEFAULT ''open'' CHECK (status IN (''open'',''done'',''cancelled'',''expired'')),
  a_gold INTEGER NOT NULL DEFAULT 0 CHECK (a_gold BETWEEN 0 AND 1000000),   -- escrowed gold (already taken from the wallet)
  b_gold INTEGER NOT NULL DEFAULT 0 CHECK (b_gold BETWEEN 0 AND 1000000),
  a_ok INTEGER NOT NULL DEFAULT 0, b_ok INTEGER NOT NULL DEFAULT 0,
  offer_rev INTEGER NOT NULL DEFAULT 0,   -- content version: any change resets both confirmations; confirm must name it
  rev INTEGER NOT NULL DEFAULT 0,         -- row lock (every write)
  origin TEXT NOT NULL DEFAULT ''app'',     -- app | group
  chat_id TEXT, message_id INTEGER,       -- group trade card
  tax_gold INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  closed_at INTEGER, closed_by TEXT, a_lock INTEGER NOT NULL DEFAULT 0, b_lock INTEGER NOT NULL DEFAULT 0, share_id TEXT, request_id TEXT,
  CHECK (a_tg <> b_tg)
)'),
('trigger','background_enhance_dismiss','rpg_notice_dismissals','CREATE TRIGGER background_enhance_dismiss AFTER INSERT ON rpg_notice_dismissals WHEN NEW.kind=''auto_enhance_end''
BEGIN UPDATE rpg_background_operations SET dismissed_at=COALESCE(dismissed_at,NEW.created_at) WHERE owner=NEW.account_tg_id AND kind=NEW.kind AND ref_id=NEW.ref_id; END'),
('trigger','background_enhance_start','rpg_auto_enhance','CREATE TRIGGER background_enhance_start AFTER INSERT ON rpg_auto_enhance
BEGIN INSERT INTO rpg_background_operations(owner,kind,ref_id,created_at) VALUES(NEW.owner,''auto_enhance_end'',NEW.id,NEW.created_at); END'),
('trigger','background_guardian_seen','rpg_guardian_auto','CREATE TRIGGER background_guardian_seen AFTER UPDATE OF seen_at ON rpg_guardian_auto WHEN NEW.seen_at IS NOT NULL AND NEW.status=''ended''
BEGIN UPDATE rpg_background_operations SET dismissed_at=COALESCE(dismissed_at,NEW.seen_at) WHERE owner=NEW.owner AND kind=''guardian_auto'' AND ref_id=NEW.id; END'),
('trigger','background_guardian_start','rpg_guardian_auto','CREATE TRIGGER background_guardian_start AFTER INSERT ON rpg_guardian_auto
BEGIN INSERT INTO rpg_background_operations(owner,kind,ref_id,created_at) VALUES(NEW.owner,''guardian_auto'',NEW.id,NEW.created_at); END'),
('trigger','background_reroll_start','rpg_auto_reroll','CREATE TRIGGER background_reroll_start AFTER INSERT ON rpg_auto_reroll
BEGIN INSERT INTO rpg_background_operations(owner,kind,ref_id,created_at) VALUES(NEW.owner,''auto_reroll_end'',NEW.id,NEW.created_at); END'),
('trigger','collection_blessing_keep_delete','rpg_inventory','CREATE TRIGGER collection_blessing_keep_delete BEFORE DELETE ON rpg_inventory
WHEN OLD.item LIKE ''collection_%'' BEGIN
 SELECT RAISE(ABORT,''collection_active_owned'') WHERE EXISTS(
  SELECT 1 FROM rpg_characters WHERE tg_id=OLD.tg_id AND collection_active_map>0 AND OLD.item=''collection_''||collection_active_map);
END'),
('trigger','collection_blessing_keep_update','rpg_inventory','CREATE TRIGGER collection_blessing_keep_update BEFORE UPDATE OF quantity,item,tg_id ON rpg_inventory
WHEN OLD.item LIKE ''collection_%'' AND (NEW.quantity<1 OR NEW.item<>OLD.item OR NEW.tg_id<>OLD.tg_id) BEGIN
 SELECT RAISE(ABORT,''collection_active_owned'') WHERE EXISTS(
  SELECT 1 FROM rpg_characters WHERE tg_id=OLD.tg_id AND collection_active_map>0 AND OLD.item=''collection_''||collection_active_map);
END'),
('trigger','collection_blessing_owner','rpg_characters','CREATE TRIGGER collection_blessing_owner BEFORE UPDATE OF collection_active_map ON rpg_characters
WHEN NEW.collection_active_map<>OLD.collection_active_map AND NEW.collection_active_map>0 BEGIN
 SELECT RAISE(ABORT,''collection_not_owned'') WHERE NOT EXISTS(
  SELECT 1 FROM rpg_inventory WHERE tg_id=NEW.tg_id AND item=''collection_''||NEW.collection_active_map AND quantity>0);
END'),
('trigger','collection_blessing_party','rpg_characters','CREATE TRIGGER collection_blessing_party BEFORE UPDATE OF collection_active_map ON rpg_characters
WHEN NEW.collection_active_map<>OLD.collection_active_map AND OLD.party_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,''collection_party_locked'');
END'),
('trigger','guardian_grant_guard','rpg_guardian_voucher_grants','CREATE TRIGGER guardian_grant_guard BEFORE INSERT ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,''guardian_invalid_participant'') WHERE NOT EXISTS(
  SELECT 1 FROM rpg_characters c JOIN rpg_boss_attacks a ON a.tg_id=c.tg_id
  WHERE c.tg_id=NEW.recipient_char_id AND c.account_tg_id=NEW.account_id
   AND a.boss_id=NEW.boss_id AND a.damage>0
 );
 SELECT RAISE(ABORT,''guardian_voucher_daily_cap'') WHERE COALESCE((SELECT n FROM rpg_daily_counters
  WHERE tg_id=NEW.account_id AND day=NEW.day AND key=''guardian_voucher''),0)>=4
 ;
END'),
('trigger','guardian_grant_no_delete','rpg_guardian_voucher_grants','CREATE TRIGGER guardian_grant_no_delete BEFORE DELETE ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,''guardian_grant_immutable'');
END'),
('trigger','guardian_grant_no_update','rpg_guardian_voucher_grants','CREATE TRIGGER guardian_grant_no_update BEFORE UPDATE ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,''guardian_grant_immutable'');
END'),
('trigger','guardian_grant_resources','rpg_guardian_voucher_grants','CREATE TRIGGER guardian_grant_resources AFTER INSERT ON rpg_guardian_voucher_grants BEGIN
 INSERT INTO rpg_daily_counters(tg_id,day,key,n) VALUES(NEW.account_id,NEW.day,''guardian_voucher'',1)
 ON CONFLICT(tg_id,day,key) DO UPDATE SET n=n+1;
 INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(NEW.recipient_char_id,''guardian_voucher'',1)
 ON CONFLICT(tg_id,item) DO UPDATE SET quantity=quantity+1;
 INSERT INTO rpg_ledger(event_id,tg_id,type,item,item_delta,note,created_at)
 VALUES(''guardian-voucher:''||NEW.boss_id||'':''||NEW.account_id,NEW.recipient_char_id,
  ''守護神召喚憑證'',''guardian_voucher'',1,NEW.boss_id,NEW.created_at);
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.created_at WHERE tg_id=NEW.recipient_char_id;
END'),
('trigger','guardian_sigil_delete_guard','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_delete_guard BEFORE DELETE ON rpg_guardian_sigils
 WHEN OLD.active=1 OR OLD.locked=1 OR OLD.trade_id IS NOT NULL
 BEGIN SELECT RAISE(ABORT,''guardian_sigil_protected''); END'),
('trigger','guardian_sigil_delete_revision','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_delete_revision AFTER DELETE ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=OLD.char_id;
END'),
('trigger','guardian_sigil_insert_revision','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_insert_revision AFTER INSERT ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.updated_at WHERE tg_id=NEW.char_id;
END'),
('trigger','guardian_sigil_party_delete','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_party_delete BEFORE DELETE ON rpg_guardian_sigils
 WHEN EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=OLD.char_id AND party_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,''guardian_party_locked''); END'),
('trigger','guardian_sigil_party_update','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_party_update BEFORE UPDATE ON rpg_guardian_sigils
 WHEN EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=OLD.char_id AND party_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,''guardian_party_locked''); END'),
('trigger','guardian_sigil_transfer_guard','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_transfer_guard BEFORE UPDATE OF char_id ON rpg_guardian_sigils
 WHEN NEW.char_id<>OLD.char_id AND (OLD.active=1 OR OLD.bound=1 OR OLD.locked=1)
 BEGIN SELECT RAISE(ABORT,''guardian_transfer_protected''); END'),
('trigger','guardian_sigil_update_revision','rpg_guardian_sigils','CREATE TRIGGER guardian_sigil_update_revision AFTER UPDATE ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.updated_at WHERE tg_id=OLD.char_id OR tg_id=NEW.char_id;
END'),
('trigger','guardian_welcome_guard','rpg_guardian_welcome','CREATE TRIGGER guardian_welcome_guard BEFORE INSERT ON rpg_guardian_welcome BEGIN
 SELECT RAISE(ABORT,''guardian_welcome_locked'') WHERE NOT EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=NEW.recipient_char_id
  AND account_tg_id=NEW.account_id AND level>=15);
END'),
('trigger','guardian_welcome_no_delete','rpg_guardian_welcome','CREATE TRIGGER guardian_welcome_no_delete BEFORE DELETE ON rpg_guardian_welcome BEGIN SELECT RAISE(ABORT,''guardian_welcome_immutable''); END'),
('trigger','guardian_welcome_no_update','rpg_guardian_welcome','CREATE TRIGGER guardian_welcome_no_update BEFORE UPDATE ON rpg_guardian_welcome BEGIN SELECT RAISE(ABORT,''guardian_welcome_immutable''); END'),
('trigger','guardian_welcome_resources','rpg_guardian_welcome','CREATE TRIGGER guardian_welcome_resources AFTER INSERT ON rpg_guardian_welcome BEGIN
 INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(NEW.recipient_char_id,''guardian_free_normal'',NEW.draws)
 ON CONFLICT(tg_id,item) DO UPDATE SET quantity=quantity+excluded.quantity;
 INSERT INTO rpg_ledger(event_id,tg_id,type,item,item_delta,note,created_at)
 VALUES(''guardian-welcome:''||NEW.account_id,NEW.recipient_char_id,''守護神初見贈禮'',''guardian_free_normal'',NEW.draws,''首次進入；免費普通召喚'',NEW.created_at);
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.created_at WHERE tg_id=NEW.recipient_char_id;
END'),
('trigger','rpg_auto_enhance_equipment_delete','rpg_equipment','CREATE TRIGGER rpg_auto_enhance_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=OLD.id AND status=''running'')
BEGIN SELECT RAISE(ABORT,''auto_enhance_locked''); END'),
('trigger','rpg_auto_enhance_equipment_update','rpg_equipment','CREATE TRIGGER rpg_auto_enhance_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=OLD.id AND status=''running'')
BEGIN SELECT RAISE(ABORT,''auto_enhance_locked''); END'),
('trigger','rpg_auto_enhance_start_guard','rpg_auto_enhance','CREATE TRIGGER rpg_auto_enhance_start_guard BEFORE INSERT ON rpg_auto_enhance
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=NEW.item_id AND status IN (''running'',''processing''))
BEGIN SELECT RAISE(ABORT,''background_item_locked''); END'),
('trigger','rpg_auto_reroll_equipment_delete','rpg_equipment','CREATE TRIGGER rpg_auto_reroll_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=OLD.id AND status=''running'')
BEGIN SELECT RAISE(ABORT,''auto_reroll_locked''); END'),
('trigger','rpg_auto_reroll_equipment_update','rpg_equipment','CREATE TRIGGER rpg_auto_reroll_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=OLD.id AND status=''running'')
BEGIN SELECT RAISE(ABORT,''auto_reroll_locked''); END'),
('trigger','rpg_auto_reroll_start_guard','rpg_auto_reroll','CREATE TRIGGER rpg_auto_reroll_start_guard BEFORE INSERT ON rpg_auto_reroll
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=NEW.item_id AND status IN (''running'',''processing''))
BEGIN SELECT RAISE(ABORT,''background_item_locked''); END'),
('trigger','rpg_exchange_enhance_resume','rpg_auto_enhance','CREATE TRIGGER rpg_exchange_enhance_resume BEFORE UPDATE OF status,item_id ON rpg_auto_enhance
WHEN NEW.status IN (''running'',''processing'') AND EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE ''exchange:%'')
BEGIN SELECT RAISE(ABORT,''exchange_equipment_locked''); END'),
('trigger','rpg_exchange_enhance_start','rpg_auto_enhance','CREATE TRIGGER rpg_exchange_enhance_start BEFORE INSERT ON rpg_auto_enhance
WHEN EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE ''exchange:%'')
BEGIN SELECT RAISE(ABORT,''exchange_equipment_locked''); END'),
('trigger','rpg_exchange_equipment_delete','rpg_equipment','CREATE TRIGGER rpg_exchange_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN OLD.trade_id LIKE ''exchange:%'' AND EXISTS(
 SELECT 1 FROM rpg_exchange_listings WHERE id=substr(OLD.trade_id,10) AND status=''active'' AND kind=''equip'' AND ref=OLD.id
)
BEGIN SELECT RAISE(ABORT,''exchange_equipment_locked''); END'),
('trigger','rpg_exchange_equipment_update','rpg_equipment','CREATE TRIGGER rpg_exchange_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN OLD.trade_id LIKE ''exchange:%'' AND EXISTS(
 SELECT 1 FROM rpg_exchange_listings WHERE id=substr(OLD.trade_id,10) AND status=''active'' AND kind=''equip'' AND ref=OLD.id
)
BEGIN SELECT RAISE(ABORT,''exchange_equipment_locked''); END'),
('trigger','rpg_exchange_guardian_claim','rpg_guardian_sigils','CREATE TRIGGER rpg_exchange_guardian_claim BEFORE UPDATE OF exchange_id ON rpg_guardian_sigils
WHEN NEW.exchange_id IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,''exchange_guardian_locked'') WHERE NEW.bound<>0 OR NEW.active<>0 OR NEW.locked<>0 OR NEW.trade_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=NEW.exchange_id AND status=''active'' AND kind=''guardian'' AND ref=NEW.id AND seller_char=NEW.char_id);
END'),
('trigger','rpg_exchange_guardian_delete','rpg_guardian_sigils','CREATE TRIGGER rpg_exchange_guardian_delete BEFORE DELETE ON rpg_guardian_sigils
WHEN OLD.exchange_id IS NOT NULL AND EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=OLD.exchange_id AND status=''active'' AND kind=''guardian'' AND ref=OLD.id)
BEGIN SELECT RAISE(ABORT,''exchange_guardian_locked''); END'),
('trigger','rpg_exchange_guardian_request','rpg_trade_requests','CREATE TRIGGER rpg_exchange_guardian_request BEFORE INSERT ON rpg_trade_requests
WHEN NEW.object_kind=''sigil'' AND EXISTS(SELECT 1 FROM rpg_guardian_sigils WHERE id=NEW.equip_id AND exchange_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,''exchange_guardian_locked''); END'),
('trigger','rpg_exchange_guardian_share','rpg_shares','CREATE TRIGGER rpg_exchange_guardian_share BEFORE INSERT ON rpg_shares
WHEN NEW.object_kind=''sigil'' AND EXISTS(SELECT 1 FROM rpg_guardian_sigils WHERE id=NEW.equip_id AND exchange_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,''exchange_guardian_locked''); END'),
('trigger','rpg_exchange_guardian_update','rpg_guardian_sigils','CREATE TRIGGER rpg_exchange_guardian_update BEFORE UPDATE ON rpg_guardian_sigils
WHEN OLD.exchange_id IS NOT NULL AND EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=OLD.exchange_id AND status=''active'' AND kind=''guardian'' AND ref=OLD.id)
BEGIN SELECT RAISE(ABORT,''exchange_guardian_locked''); END'),
('trigger','rpg_exchange_reroll_resume','rpg_auto_reroll','CREATE TRIGGER rpg_exchange_reroll_resume BEFORE UPDATE OF status,item_id ON rpg_auto_reroll
WHEN NEW.status IN (''running'',''processing'') AND EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE ''exchange:%'')
BEGIN SELECT RAISE(ABORT,''exchange_equipment_locked''); END'),
('trigger','rpg_exchange_reroll_start','rpg_auto_reroll','CREATE TRIGGER rpg_exchange_reroll_start BEFORE INSERT ON rpg_auto_reroll
WHEN EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE ''exchange:%'')
BEGIN SELECT RAISE(ABORT,''exchange_equipment_locked''); END')), actual AS (SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT GLOB '_thief_*' AND name<>'d1_migrations')
INSERT INTO "_thief_review_guard" (ok) SELECT CASE WHEN (NOT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM actual) AND NOT EXISTS (SELECT * FROM actual EXCEPT SELECT * FROM expected)) THEN 1 ELSE 0 END;

-- 155. verify-fk-diagnostic
PRAGMA foreign_key_check;

-- 156. verify-integrity-diagnostic
PRAGMA quick_check;

-- 157. cleanup-staging: rpg_characters
DROP TABLE "_thief_backup_rpg_characters";

-- 158. cleanup-staging: rpg_equipment
DROP TABLE "_thief_backup_rpg_equipment";

-- 159. cleanup-staging: rpg_exchange_listings
DROP TABLE "_thief_backup_rpg_exchange_listings";

-- 160. cleanup-staging: rpg_guardian_operations
DROP TABLE "_thief_backup_rpg_guardian_operations";

-- 161. cleanup-staging: rpg_guardian_sigils
DROP TABLE "_thief_backup_rpg_guardian_sigils";

-- 162. cleanup-staging: rpg_guardian_voucher_grants
DROP TABLE "_thief_backup_rpg_guardian_voucher_grants";

-- 163. cleanup-staging: rpg_guardian_welcome
DROP TABLE "_thief_backup_rpg_guardian_welcome";

-- 164. cleanup-staging
DROP TABLE "_thief_backup_sequence";

-- 165. cleanup-staging
DROP TABLE "_thief_review_guard";
