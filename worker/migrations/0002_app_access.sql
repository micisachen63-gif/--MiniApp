-- Mini App: creating a character from the Mini App needs a short-lived pass that 小精靈 issues only after its
-- internal-group membership check (private /rpg). Existing characters do not need it.
CREATE TABLE IF NOT EXISTS rpg_app_access (
  tg_id TEXT PRIMARY KEY,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
