-- 小精靈 RPG v0.4: 11 equipment positions (6 armor slots + 2 earrings + 2 rings), 遺物 relic grade, trade escrow/bind, group trading.
-- Safe for existing rows: every v0.3 item keeps its id/slot/stats ('armor' = 盔甲); equipped items stay equipped (is_equipped 1).
-- SQLite can't ALTER a CHECK constraint, so rpg_equipment is rebuilt (copy → drop → rename) inside this migration.

CREATE TABLE rpg_equipment_v4 (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('weapon','helmet','armor','gloves','boots','belt','undershirt','earring','ring')),
  kind TEXT NOT NULL,
  class_req TEXT NOT NULL CHECK (class_req IN ('mage','sword','archer','any')),
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
  is_equipped INTEGER NOT NULL DEFAULT 0 CHECK (is_equipped BETWEEN 0 AND 2),   -- earring/ring: position 1|2
  convert_token INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  grade TEXT NOT NULL DEFAULT 'normal' CHECK (grade IN ('normal','relic')),
  affix_json TEXT,                                                               -- 遺物 extra affix line
  bound INTEGER NOT NULL DEFAULT 0,                                              -- 1 = ever equipped / starter → not tradeable
  trade_id TEXT,                                                                 -- escrowed in this open trade
  CHECK (trade_id IS NULL OR is_equipped = 0)
);
INSERT INTO rpg_equipment_v4 (id, tg_id, slot, kind, class_req, branch_req, tier, level_req, name, source, base_stat, bonus_json, element, element_stat,
  element_tier, enhance_level, is_equipped, convert_token, created_at, grade, affix_json, bound, trade_id)
SELECT id, tg_id, slot, kind, class_req, branch_req, tier, level_req, name, source, base_stat, bonus_json, element, element_stat,
  element_tier, enhance_level, CASE WHEN is_equipped THEN 1 ELSE 0 END, convert_token, created_at, 'normal', NULL,
  CASE WHEN is_equipped OR source = 'starter' THEN 1 ELSE 0 END, NULL
FROM rpg_equipment;
DROP TABLE rpg_equipment;
ALTER TABLE rpg_equipment_v4 RENAME TO rpg_equipment;
CREATE INDEX IF NOT EXISTS idx_rpg_equipment_owner ON rpg_equipment(tg_id, is_equipped);
CREATE INDEX IF NOT EXISTS idx_rpg_equipment_trade ON rpg_equipment(trade_id) WHERE trade_id IS NOT NULL;

-- @username lookup for "/交易 @user" (filled from Mini App initData / the bot when the player uses the game)
ALTER TABLE rpg_characters ADD COLUMN tg_username TEXT;
CREATE INDEX IF NOT EXISTS idx_rpg_characters_username ON rpg_characters(tg_username COLLATE NOCASE);

-- ---- trading -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpg_trades (
  id TEXT PRIMARY KEY,
  a_tg TEXT NOT NULL,                  -- initiator
  b_tg TEXT NOT NULL,                  -- counterparty
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled','expired')),
  a_gold INTEGER NOT NULL DEFAULT 0 CHECK (a_gold BETWEEN 0 AND 1000000),   -- escrowed gold (already taken from the wallet)
  b_gold INTEGER NOT NULL DEFAULT 0 CHECK (b_gold BETWEEN 0 AND 1000000),
  a_ok INTEGER NOT NULL DEFAULT 0, b_ok INTEGER NOT NULL DEFAULT 0,
  offer_rev INTEGER NOT NULL DEFAULT 0,   -- content version: any change resets both confirmations; confirm must name it
  rev INTEGER NOT NULL DEFAULT 0,         -- row lock (every write)
  origin TEXT NOT NULL DEFAULT 'app',     -- app | group
  chat_id TEXT, message_id INTEGER,       -- group trade card
  tax_gold INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  closed_at INTEGER, closed_by TEXT,
  CHECK (a_tg <> b_tg)
);
CREATE INDEX IF NOT EXISTS idx_rpg_trades_a ON rpg_trades(a_tg, status);
CREATE INDEX IF NOT EXISTS idx_rpg_trades_b ON rpg_trades(b_tg, status);
CREATE INDEX IF NOT EXISTS idx_rpg_trades_open ON rpg_trades(status, expires_at);

-- escrowed lines. kind 'equip': ref = equipment id (also stamped rpg_equipment.trade_id); kind 'item': ref = item key, qty escrowed
CREATE TABLE IF NOT EXISTS rpg_trade_items (
  trade_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('a','b')),
  kind TEXT NOT NULL CHECK (kind IN ('equip','item')),
  ref TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  snapshot_json TEXT,
  PRIMARY KEY (trade_id, side, kind, ref)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rpg_trade_items_equip ON rpg_trade_items(ref) WHERE kind = 'equip';   -- an item can't be in two trades

CREATE TABLE IF NOT EXISTS rpg_trade_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL,
  tg_id TEXT,
  action TEXT NOT NULL,                -- open | add | remove | gold | confirm | unconfirm | done | cancel | expire
  details TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rpg_trade_log_trade ON rpg_trade_log(trade_id, id);
