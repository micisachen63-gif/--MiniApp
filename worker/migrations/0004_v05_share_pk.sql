-- v0.5: 分享至群組 (item photo posts + 超讚), 我要交易 requests, lock-then-OK trade window, 群組決鬥 (PK) — additive only.

-- ---- trade window v0.5: each side 鎖定 (irreversible) before OK; window born from a share request -------------
ALTER TABLE rpg_trades ADD COLUMN a_lock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rpg_trades ADD COLUMN b_lock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rpg_trades ADD COLUMN share_id TEXT;
ALTER TABLE rpg_trades ADD COLUMN request_id TEXT;

-- ---- group item posts: player shares, relic drops, PK gear drops ---------------------------------------
CREATE TABLE IF NOT EXISTS rpg_shares (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,                 -- owner at post time
  equip_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('share','relic','pk')),
  snapshot_json TEXT NOT NULL,         -- item view at post time (caption source)
  context_json TEXT,                   -- relic: {source, boss|elite, map}; pk: {pkId, loser}
  tradeable INTEGER NOT NULL DEFAULT 1,
  likes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','traded')),
  chat_id TEXT, message_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rpg_shares_owner ON rpg_shares(tg_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rpg_shares_equip ON rpg_shares(equip_id, created_at);

CREATE TABLE IF NOT EXISTS rpg_share_likes (
  share_id TEXT NOT NULL, tg_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, tg_id)
);

-- ---- 我要交易 requests (requester clicked = their confirmation; owner 確認 opens the window) ---------------
CREATE TABLE IF NOT EXISTS rpg_trade_requests (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  equip_id TEXT NOT NULL,
  owner_tg TEXT NOT NULL,
  requester_tg TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','expired','cancelled')),
  trade_id TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER,
  CHECK (owner_tg <> requester_tg)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rpg_treq_once ON rpg_trade_requests(share_id, requester_tg) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_rpg_treq_owner ON rpg_trade_requests(owner_tg, status);
CREATE INDEX IF NOT EXISTS idx_rpg_treq_req ON rpg_trade_requests(requester_tg, status);

-- ---- 群組決鬥 1v1 PK ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpg_pk (
  id TEXT PRIMARY KEY,
  a_tg TEXT NOT NULL,                  -- challenger
  b_tg TEXT NOT NULL,                  -- challenged
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','declined','cancelled','expired')),
  origin TEXT NOT NULL DEFAULT 'app',  -- app | group
  chat_id TEXT, message_id INTEGER,    -- group card
  winner_tg TEXT, loser_tg TEXT,
  seed INTEGER,                        -- crypto-random at accept time (replayable, not predictable)
  rounds INTEGER, log_json TEXT,       -- summary for the card / Mini App replay
  drop_equip_id TEXT, drop_json TEXT, ward_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER,
  CHECK (a_tg <> b_tg)
);
CREATE INDEX IF NOT EXISTS idx_rpg_pk_a ON rpg_pk(a_tg, status, decided_at);
CREATE INDEX IF NOT EXISTS idx_rpg_pk_b ON rpg_pk(b_tg, status, decided_at);
CREATE INDEX IF NOT EXISTS idx_rpg_pk_open ON rpg_pk(status, expires_at);
