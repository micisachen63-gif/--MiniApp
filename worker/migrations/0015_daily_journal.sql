-- Account-wide daily quests. Additive only; no gameplay resets or per-hit writes.
CREATE TABLE rpg_journals (
 account_id TEXT NOT NULL, day TEXT NOT NULL, char_id TEXT NOT NULL,
 tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 12), checked_at INTEGER,
 claims_json TEXT NOT NULL DEFAULT '{}', claim_count INTEGER NOT NULL DEFAULT 0 CHECK(claim_count BETWEEN 0 AND 3),
 bonus_claimed INTEGER NOT NULL DEFAULT 0 CHECK(bonus_claimed IN(0,1)),
 rev INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,day)
);
CREATE TABLE rpg_journal_cards (
 day TEXT PRIMARY KEY, chat_id TEXT NOT NULL, message_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rpg_likes_owner_day ON rpg_share_likes(tg_id,created_at);
CREATE INDEX IF NOT EXISTS idx_rpg_party_member_account ON rpg_party_members(account_id,party_id);
CREATE INDEX IF NOT EXISTS idx_rpg_boss_attack_owner_day ON rpg_boss_attacks(tg_id,created_at);
