-- Additive activity facts for permanent-world objectives. Legacy quest events,
-- claims, requests, character progress and equipment are never rewritten.
CREATE TABLE rpg_atlas_activity_events (
 source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 240),
 realm_id TEXT NOT NULL DEFAULT 'permanent' CHECK(realm_id='permanent'),
 account_id TEXT NOT NULL, char_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('kill','elite','encounter','loot_equipment','loot_scroll','completion','safe_completion','survival','collection','reclaim')),
 quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity BETWEEN 1 AND 1000000),
 map_id TEXT, theme_id INTEGER, build_id TEXT, tag TEXT,
 occurred_at INTEGER NOT NULL CHECK(occurred_at>=0),
 day_key TEXT NOT NULL, week_key TEXT NOT NULL,
 signature TEXT NOT NULL,
 recorded_at INTEGER NOT NULL CHECK(recorded_at>=occurred_at),
 PRIMARY KEY(account_id,kind,source_id)
);
CREATE INDEX rpg_atlas_activity_time ON rpg_atlas_activity_events(account_id,kind,occurred_at);
CREATE INDEX rpg_atlas_activity_region ON rpg_atlas_activity_events(account_id,kind,theme_id,occurred_at);
CREATE TRIGGER rpg_atlas_activity_world BEFORE INSERT ON rpg_atlas_activity_events
WHEN EXISTS(SELECT 1 FROM rpg_realm_identity WHERE realm_type<>'permanent' OR realm_id<>'permanent')
BEGIN SELECT RAISE(ABORT,'atlas_quest_permanent_only'); END;
CREATE TRIGGER rpg_atlas_activity_owner BEFORE INSERT ON rpg_atlas_activity_events
WHEN NOT EXISTS(SELECT 1 FROM rpg_live_characters WHERE tg_id=NEW.char_id AND account_tg_id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'atlas_quest_account_mismatch'); END;
CREATE TRIGGER rpg_atlas_activity_no_update BEFORE UPDATE ON rpg_atlas_activity_events
BEGIN SELECT RAISE(ABORT,'atlas_activity_event_immutable'); END;
CREATE TRIGGER rpg_atlas_activity_no_delete BEFORE DELETE ON rpg_atlas_activity_events
BEGIN SELECT RAISE(ABORT,'atlas_activity_event_immutable'); END;
