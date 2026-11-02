-- Additive opt-in Atlas state. No existing character, inventory, equipment,
-- enhancement or ledger value is reset, copied or rebalanced by this migration.
ALTER TABLE rpg_characters ADD COLUMN atlas_run_id TEXT;

CREATE TABLE rpg_atlas_profiles (
 char_id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
 build_id TEXT NOT NULL, supports_json TEXT NOT NULL DEFAULT '[]',
 automation TEXT NOT NULL DEFAULT 'balanced', rev INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
CREATE TABLE rpg_atlas_runs (
 id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, account_id TEXT NOT NULL,
 char_id TEXT NOT NULL, status TEXT NOT NULL,
 state_json TEXT NOT NULL, started_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL, stop_at INTEGER,
 rev INTEGER NOT NULL DEFAULT 0,
 CHECK(status IN ('running','completed','failed','expired','stopped'))
);
CREATE UNIQUE INDEX rpg_atlas_one_active_account ON rpg_atlas_runs(account_id) WHERE status='running';
CREATE INDEX rpg_atlas_character_runs ON rpg_atlas_runs(char_id,started_at DESC);
CREATE TABLE rpg_atlas_materials (
 char_id TEXT NOT NULL, material TEXT NOT NULL,
 quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),
 PRIMARY KEY(char_id,material)
);
CREATE TABLE rpg_atlas_progress (
 char_id TEXT NOT NULL, map_id TEXT NOT NULL,
 completions INTEGER NOT NULL DEFAULT 0 CHECK(completions>=0),
 first_completed_at INTEGER NOT NULL, last_completed_at INTEGER NOT NULL,
 PRIMARY KEY(char_id,map_id)
);
CREATE TABLE rpg_atlas_operations (
 account_id TEXT NOT NULL, request_id TEXT NOT NULL,
 kind TEXT NOT NULL, signature TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,request_id)
);
CREATE TABLE rpg_atlas_forges (
 item_id TEXT PRIMARY KEY, crafts INTEGER NOT NULL CHECK(crafts BETWEEN 1 AND 3),
 updated_at INTEGER NOT NULL
);

-- Close the race between selected-character switches, parties and run starts.
CREATE TRIGGER rpg_atlas_start_guard BEFORE INSERT ON rpg_atlas_runs
WHEN NEW.status='running'
BEGIN
 SELECT CASE WHEN NOT EXISTS (
   SELECT 1 FROM rpg_live_characters c JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id
   WHERE c.tg_id=NEW.char_id AND c.account_tg_id=NEW.account_id
     AND a.active_char_id=c.tg_id AND c.atlas_run_id IS NULL AND c.party_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM rpg_party_presence pp JOIN rpg_live_characters pc ON pc.tg_id=pp.char_id WHERE pc.account_tg_id=NEW.account_id)
 ) THEN RAISE(ABORT,'atlas_character_busy') END;
END;
CREATE TRIGGER rpg_atlas_presence_guard BEFORE INSERT ON rpg_party_presence
WHEN EXISTS (
 SELECT 1 FROM rpg_atlas_runs r JOIN rpg_live_characters c ON c.account_tg_id=r.account_id
 WHERE c.tg_id=NEW.char_id AND r.status='running'
)
BEGIN SELECT RAISE(ABORT,'atlas_character_busy'); END;
CREATE TRIGGER rpg_atlas_character_switch_guard BEFORE UPDATE OF active_char_id ON rpg_accounts
WHEN OLD.active_char_id IS NOT NEW.active_char_id AND EXISTS (
 SELECT 1 FROM rpg_characters c WHERE c.tg_id=OLD.active_char_id AND c.atlas_run_id IS NOT NULL
)
BEGIN SELECT RAISE(ABORT,'atlas_character_busy'); END;
CREATE TRIGGER rpg_atlas_party_guard BEFORE UPDATE OF party_id ON rpg_characters
WHEN NEW.party_id IS NOT NULL AND NEW.party_id IS NOT OLD.party_id AND OLD.atlas_run_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'atlas_character_busy'); END;
CREATE TRIGGER rpg_atlas_delete_guard BEFORE UPDATE OF deleted_at ON rpg_characters
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND OLD.atlas_run_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'atlas_character_busy'); END;
