-- Strong over-safe enhancement successes post an equipment card to the group.
-- Allow those posts to retain their distinct kind for bot captions and buttons.
CREATE TABLE rpg_shares_new (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,
  equip_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('share','relic','pk','enhance')),
  snapshot_json TEXT NOT NULL,
  context_json TEXT,
  tradeable INTEGER NOT NULL DEFAULT 1,
  likes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','traded')),
  chat_id TEXT,
  message_id INTEGER,
  created_at INTEGER NOT NULL
);
INSERT INTO rpg_shares_new (id,tg_id,equip_id,kind,snapshot_json,context_json,tradeable,likes,status,chat_id,message_id,created_at)
  SELECT id,tg_id,equip_id,kind,snapshot_json,context_json,tradeable,likes,status,chat_id,message_id,created_at FROM rpg_shares;
DROP TABLE rpg_shares;
ALTER TABLE rpg_shares_new RENAME TO rpg_shares;
CREATE INDEX IF NOT EXISTS idx_rpg_shares_owner ON rpg_shares(tg_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rpg_shares_equip ON rpg_shares(equip_id, created_at);
