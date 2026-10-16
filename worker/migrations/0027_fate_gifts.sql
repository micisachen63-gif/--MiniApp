-- Additive, per-character Fate milestone receipts; no player data is rewritten.
CREATE TABLE IF NOT EXISTS rpg_fate_gifts (
 id TEXT PRIMARY KEY,
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 milestone INTEGER NOT NULL CHECK(milestone > 0 AND milestone % 4 = 0),
 status TEXT NOT NULL CHECK(status IN ('claimed','opened')),
 rewards_json TEXT,
 created_at INTEGER NOT NULL,
 opened_at INTEGER,
 UNIQUE(char_id,milestone)
);
CREATE INDEX IF NOT EXISTS rpg_fate_gifts_character ON rpg_fate_gifts(char_id,status,created_at);
CREATE TABLE IF NOT EXISTS rpg_fate_gift_operations (
 account_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,request_id)
);
