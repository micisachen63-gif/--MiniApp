-- Private opt-in cooperative side stories. No existing life or player is rewritten.
CREATE TABLE IF NOT EXISTS rpg_fate_social_preferences (
 account_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 allow_mentions INTEGER NOT NULL DEFAULT 0 CHECK(allow_mentions IN (0,1)),
 quiet_until INTEGER NOT NULL DEFAULT 0, active_at INTEGER NOT NULL, rev INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rpg_fate_social_choices (
 id TEXT PRIMARY KEY, life_id TEXT NOT NULL UNIQUE REFERENCES rpg_fate_lives(id),
 owner_account TEXT NOT NULL, owner_char TEXT NOT NULL, owner_name TEXT NOT NULL,
 guest_account TEXT NOT NULL, guest_char TEXT NOT NULL, guest_name TEXT NOT NULL,
 story_key TEXT NOT NULL DEFAULT 'garden' CHECK(story_key IN ('garden','harbor','lamp','workshop','map','book')),
 pair_key TEXT NOT NULL, day TEXT NOT NULL, opened_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL,
 next_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('scheduled','pending','answered','declined','withdrawn','auto')),
 answer INTEGER CHECK(answer IN (0,1)), source TEXT NOT NULL DEFAULT 'auto',
 resolved_at INTEGER, rev INTEGER NOT NULL DEFAULT 0,
 CHECK(owner_account<>guest_account), CHECK(deadline_at>opened_at)
);
CREATE INDEX IF NOT EXISTS rpg_fate_social_due ON rpg_fate_social_choices(next_at) WHERE status IN ('scheduled','pending');
CREATE INDEX IF NOT EXISTS rpg_fate_social_owner ON rpg_fate_social_choices(owner_account,opened_at DESC);
CREATE INDEX IF NOT EXISTS rpg_fate_social_guest ON rpg_fate_social_choices(guest_account,opened_at DESC);
CREATE TABLE IF NOT EXISTS rpg_fate_social_locks (
 account_id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES rpg_fate_social_choices(id)
);
CREATE TABLE IF NOT EXISTS rpg_fate_social_pairs (
 pair_key TEXT NOT NULL, day TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(pair_key,day)
);
CREATE TABLE IF NOT EXISTS rpg_fate_social_limits (
 account_id TEXT NOT NULL, day TEXT NOT NULL, mentions INTEGER NOT NULL DEFAULT 0 CHECK(mentions BETWEEN 0 AND 2),
 PRIMARY KEY(account_id,day)
);
CREATE TABLE IF NOT EXISTS rpg_fate_social_operations (
 account_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(account_id,request_id)
);
