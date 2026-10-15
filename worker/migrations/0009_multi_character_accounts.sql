-- One Telegram account can own up to four independently progressing characters.
-- Existing characters keep their current tg_id so all character-owned rows remain intact.
ALTER TABLE rpg_characters ADD COLUMN account_tg_id TEXT;
ALTER TABLE rpg_characters ADD COLUMN char_slot INTEGER NOT NULL DEFAULT 1 CHECK (char_slot BETWEEN 1 AND 4);

UPDATE rpg_characters SET account_tg_id = tg_id WHERE account_tg_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_rpg_characters_account ON rpg_characters(account_tg_id, char_slot);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rpg_characters_account_slot ON rpg_characters(account_tg_id, char_slot);

CREATE TABLE IF NOT EXISTS rpg_accounts (
  account_tg_id TEXT PRIMARY KEY,
  active_char_id TEXT,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO rpg_accounts (account_tg_id, active_char_id, updated_at)
SELECT account_tg_id, tg_id, updated_at FROM rpg_characters;
