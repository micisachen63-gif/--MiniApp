-- Additive, opt-in equipment archive and character-bound recovery. No legacy grants change.
CREATE TABLE rpg_equipment_archive (
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 entry_id TEXT NOT NULL, rules_version TEXT NOT NULL,
 source_group TEXT NOT NULL, tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 12),
 item_id TEXT NOT NULL UNIQUE, snapshot_json TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(char_id,entry_id)
);
CREATE TABLE rpg_equipment_recovery_balances (
 char_id TEXT PRIMARY KEY REFERENCES rpg_characters(tg_id),
 dust INTEGER NOT NULL DEFAULT 0 CHECK(dust >= 0),
 rev INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE TABLE rpg_equipment_recovery_operations (
 account_id TEXT NOT NULL, request_id TEXT NOT NULL, char_id TEXT NOT NULL,
 realm_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('archive','salvage','reforge')),
 signature TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,request_id)
);
