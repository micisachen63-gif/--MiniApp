-- 小精靈 RPG 掛機冒險 — D1 schema v0.3 (P1). Separate database from minigame-pet.
-- Money/items are changed only through rpg_ledger (event_id UNIQUE) inside D1 batches; CHECK constraints stop negatives.

CREATE TABLE IF NOT EXISTS rpg_characters (
  tg_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tg_name TEXT,
  gender TEXT NOT NULL CHECK (gender IN ('m','f')),
  base_class TEXT NOT NULL CHECK (base_class IN ('mage','sword','archer')),
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
);

CREATE TABLE IF NOT EXISTS rpg_inventory (
  tg_id TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (tg_id, item)
);

CREATE TABLE IF NOT EXISTS rpg_equipment (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('weapon','helmet','armor','gloves','boots')),
  kind TEXT NOT NULL,
  class_req TEXT NOT NULL CHECK (class_req IN ('mage','sword','archer')),
  branch_req TEXT CHECK (branch_req IS NULL OR branch_req IN ('A','B')),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 4),
  level_req INTEGER NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'shop',
  base_stat INTEGER NOT NULL,
  bonus_json TEXT,
  element TEXT,
  element_stat INTEGER NOT NULL DEFAULT 0,
  element_tier TEXT NOT NULL DEFAULT 'common',
  enhance_level INTEGER NOT NULL DEFAULT 0,
  is_equipped INTEGER NOT NULL DEFAULT 0,
  convert_token INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rpg_equipment_owner ON rpg_equipment(tg_id, is_equipped);

CREATE TABLE IF NOT EXISTS rpg_ledger (
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
);
CREATE INDEX IF NOT EXISTS idx_rpg_ledger_owner ON rpg_ledger(tg_id, created_at);

CREATE TABLE IF NOT EXISTS rpg_idle_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  from_at INTEGER, to_at INTEGER, ticks INTEGER, skipped_ticks INTEGER,
  kills INTEGER, exp_gained INTEGER, exp_lost INTEGER, deaths INTEGER, elites INTEGER, gold_gained INTEGER,
  used_json TEXT, drops_json TEXT, levels_gained INTEGER, end_state TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rpg_reports_owner ON rpg_idle_reports(tg_id, created_at);

CREATE TABLE IF NOT EXISTS rpg_class_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL, tier INTEGER NOT NULL, from_path TEXT, to_path TEXT, kind TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rpg_boss_instances (
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
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','settling','killed','fled','vanished')),
  message_chat_id TEXT, message_id INTEGER,
  result_json TEXT,
  settled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rpg_boss_status ON rpg_boss_instances(status, ends_at);

CREATE TABLE IF NOT EXISTS rpg_boss_attacks (
  boss_id TEXT NOT NULL,
  tg_id TEXT NOT NULL,
  win INTEGER NOT NULL,                -- one attack per player per 3-minute window
  damage INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (boss_id, tg_id, win)
);

CREATE TABLE IF NOT EXISTS rpg_daily_counters (
  tg_id TEXT NOT NULL, day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tg_id, day, key)
);

CREATE TABLE IF NOT EXISTS rpg_outbox (            -- messages for 小精靈 to deliver (the Worker never calls Telegram in P1)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT UNIQUE,
  target TEXT NOT NULL CHECK (target IN ('group','dm')),
  tg_id TEXT,
  kind TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rpg_outbox_pending ON rpg_outbox(claimed_at, id);

CREATE TABLE IF NOT EXISTS rpg_admin_audit (
  id TEXT PRIMARY KEY, admin_tg_id TEXT, action TEXT NOT NULL, details TEXT, created_at INTEGER NOT NULL
);

-- optimistic-lock guard: `INSERT INTO rpg_guard(ok) SELECT NULL WHERE changes() = 0` aborts the whole batch
CREATE TABLE IF NOT EXISTS rpg_guard (ok INTEGER NOT NULL);
