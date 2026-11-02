-- Additive, opt-in collection. Never consume or register any existing item here.
ALTER TABLE rpg_characters ADD COLUMN equipment_collection_json TEXT NOT NULL DEFAULT '[]';
CREATE TABLE rpg_equipment_collection_entries (
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 collection_id TEXT NOT NULL, requirement_id TEXT NOT NULL,
 item_id TEXT NOT NULL UNIQUE, snapshot_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(char_id,collection_id,requirement_id)
);
CREATE TABLE rpg_equipment_collection_operations (
 account_id TEXT NOT NULL,request_id TEXT NOT NULL,
 signature TEXT NOT NULL,result_json TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,request_id)
);
CREATE TABLE rpg_equipment_collection_completions (
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),collection_id TEXT NOT NULL,
 rules_version TEXT NOT NULL,bonuses_json TEXT NOT NULL,completed_at INTEGER NOT NULL,
 PRIMARY KEY(char_id,collection_id)
);
