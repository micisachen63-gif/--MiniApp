-- Additive, dedicated long-expedition persistence. Existing short parties remain unchanged.
CREATE TABLE rpg_star_ring_runs (
 id TEXT PRIMARY KEY, leader_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('lobby','running','complete','ended')),
 state_json TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 next_at INTEGER NOT NULL
);
CREATE INDEX rpg_star_ring_due ON rpg_star_ring_runs(status,next_at);
CREATE TABLE rpg_star_ring_members (
 run_id TEXT NOT NULL REFERENCES rpg_star_ring_runs(id), char_id TEXT NOT NULL,
 account_id TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN(0,1)),
 joined_at INTEGER NOT NULL, left_at INTEGER,
 PRIMARY KEY(run_id,char_id), UNIQUE(run_id,account_id)
);
CREATE INDEX rpg_star_ring_character ON rpg_star_ring_members(char_id,joined_at);
CREATE TABLE rpg_star_ring_starts (
 char_id TEXT NOT NULL, day TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES rpg_star_ring_runs(id),
 started_at INTEGER NOT NULL, PRIMARY KEY(char_id,day)
);
CREATE TABLE rpg_star_ring_rewards (
 run_id TEXT NOT NULL, char_id TEXT NOT NULL, stage INTEGER NOT NULL CHECK(stage BETWEEN 0 AND 5),
 reward_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(run_id,char_id,stage)
);
CREATE TABLE rpg_star_ring_operations (
 run_id TEXT NOT NULL, char_id TEXT NOT NULL, request_id TEXT NOT NULL, operation TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(run_id,char_id,request_id)
);
CREATE TABLE rpg_star_ring_purchases (
 char_id TEXT NOT NULL, request_id TEXT NOT NULL, reward_json TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(char_id,request_id)
);
CREATE TABLE rpg_star_ring_creations (
 char_id TEXT NOT NULL, request_id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES rpg_star_ring_runs(id),
 config_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(char_id,request_id)
);
