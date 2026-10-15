-- Additive Fate Chapter persistence. Does not rewrite players, inventory or existing tables.
CREATE TABLE IF NOT EXISTS rpg_fate_profiles (
 account_id TEXT PRIMARY KEY, birth_json TEXT NOT NULL, chart_json TEXT NOT NULL,
 rev INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rpg_fate_starts (
 account_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL CHECK(count BETWEEN 0 AND 4),
 PRIMARY KEY(account_id,day)
);
CREATE TABLE IF NOT EXISTS rpg_fate_lives (
 id TEXT PRIMARY KEY, char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id), account_id TEXT NOT NULL,
 state_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','complete')),
 started_at INTEGER NOT NULL, completed_at INTEGER, next_at INTEGER NOT NULL,
 code TEXT, memories_json TEXT, notified_index INTEGER NOT NULL DEFAULT -1, rev INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS rpg_fate_one_live_character ON rpg_fate_lives(char_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS rpg_fate_due ON rpg_fate_lives(next_at) WHERE status='active';
CREATE INDEX IF NOT EXISTS rpg_fate_history ON rpg_fate_lives(char_id,started_at DESC);
CREATE TABLE IF NOT EXISTS rpg_fate_memorials (
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id), code TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(char_id,code)
);
CREATE TABLE IF NOT EXISTS rpg_fate_daily (
 account_id TEXT NOT NULL, day TEXT NOT NULL, unlocks_json TEXT NOT NULL DEFAULT '[]',
 notes_json TEXT NOT NULL, profile_rev INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, PRIMARY KEY(account_id,day)
);
CREATE TABLE IF NOT EXISTS rpg_fate_operations (
 account_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(account_id,request_id)
);
CREATE INDEX IF NOT EXISTS rpg_fate_operations_created ON rpg_fate_operations(created_at);
