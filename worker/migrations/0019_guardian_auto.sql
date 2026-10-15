CREATE TABLE rpg_guardian_auto (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, char_id TEXT NOT NULL,
 request_id TEXT NOT NULL, pool TEXT NOT NULL CHECK(pool IN ('normal','featured')),
 draw_count INTEGER NOT NULL CHECK(draw_count IN (5,10)),
 target_type TEXT NOT NULL CHECK(target_type IN ('any','attack','melee','ranged','magic','loot')),
 target_rank INTEGER NOT NULL CHECK(target_rank BETWEEN 0 AND 6),
 max_gold INTEGER CHECK(max_gold IS NULL OR max_gold>=0),
 status TEXT NOT NULL CHECK(status IN ('running','ended')), reason TEXT, match_id TEXT,
 batches INTEGER NOT NULL DEFAULT 0, total_draws INTEGER NOT NULL DEFAULT 0,
 spent_gold INTEGER NOT NULL DEFAULT 0, spent_vouchers INTEGER NOT NULL DEFAULT 0,
 used_free INTEGER NOT NULL DEFAULT 0, counts_json TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0]',
 rev INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,seen_at INTEGER,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(owner,request_id)
);
CREATE UNIQUE INDEX rpg_guardian_auto_owner ON rpg_guardian_auto(owner) WHERE status='running';
CREATE INDEX rpg_guardian_auto_due ON rpg_guardian_auto(status,next_at);
CREATE INDEX rpg_guardian_auto_notice ON rpg_guardian_auto(owner,seen_at,created_at);
