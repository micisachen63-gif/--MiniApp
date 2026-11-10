-- Additive expansion. No player table is rebuilt, reset or deleted.
ALTER TABLE rpg_characters ADD COLUMN progression_level INTEGER CHECK(progression_level BETWEEN 121 AND 600);
ALTER TABLE rpg_characters ADD COLUMN retention_group TEXT NOT NULL DEFAULT 'native';
ALTER TABLE rpg_characters ADD COLUMN origin_realm_id TEXT;
ALTER TABLE rpg_characters ADD COLUMN origin_character_id TEXT;
-- Replace only the slot index: four native slots PLUS four slots per retained season.
CREATE UNIQUE INDEX idx_rpg_characters_retention_slot ON rpg_characters(account_tg_id,retention_group,char_slot);
DROP INDEX idx_rpg_characters_account_slot;
DROP VIEW rpg_live_characters;
CREATE VIEW rpg_live_characters AS SELECT c.tg_id,c.name,c.tg_name,c.gender,c.base_class,c.class_path,c.pending_tier,COALESCE(c.progression_level,c.level) AS level,c.exp,c.hp,c.mp,c.map_id,c.idle_state,c.state_until,c.auto_red_pct,c.auto_blue,c.gold,c.last_settle_at,c.last_daily_gold_day,c.penalty_day,c.penalties_today,c.drop_day,c.drops_today,c.deaths_total,c.last_reselect_at,c.boss_down_until,c.ladder_points,c.pvp_wins,c.pvp_losses,c.created_day,c.created_at,c.updated_at,c.rev,c.tg_username,c.account_tg_id,c.char_slot,c.special_json,c.party_id,c.idle_combat_json,c.guardian_draw_remainder,c.collection_active_map,c.deleted_at,c.atlas_run_id,c.equipment_collection_json,c.progression_level,c.retention_group,c.origin_realm_id,c.origin_character_id FROM rpg_characters c WHERE c.deleted_at IS NULL;
CREATE TABLE rpg_season_transfer_manifests (
 realm_id TEXT PRIMARY KEY,source_nonce TEXT NOT NULL,cutoff_at INTEGER NOT NULL,
 manifest_hash TEXT NOT NULL,manifest_json TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE TABLE rpg_season_transfer_chunks (
 realm_id TEXT NOT NULL,chunk_no INTEGER NOT NULL,chunk_hash TEXT NOT NULL,payload_json TEXT NOT NULL,
 PRIMARY KEY(realm_id,chunk_no)
);
CREATE TABLE rpg_season_transfer_imports (
 realm_id TEXT PRIMARY KEY,manifest_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('copying','hydrating','complete')),
 completion_hash TEXT,updated_at INTEGER NOT NULL
);
CREATE TABLE rpg_season_retained_characters (
 realm_id TEXT NOT NULL,source_char_id TEXT NOT NULL,account_id TEXT NOT NULL,target_char_id TEXT NOT NULL UNIQUE,
 source_name TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('pending','complete')),result_json TEXT,updated_at INTEGER NOT NULL,
 PRIMARY KEY(realm_id,source_char_id)
);
