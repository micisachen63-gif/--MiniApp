-- Additive, account-scoped permanent-world objectives. No old character,
-- equipment, enhancement, inventory or historical reward is rewritten.
CREATE TABLE rpg_atlas_quest_events (
 source_id TEXT PRIMARY KEY NOT NULL,
 realm_id TEXT NOT NULL DEFAULT 'permanent' CHECK(realm_id='permanent'),
 account_id TEXT NOT NULL, char_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('configure','start','completion','craft')),
 map_id TEXT, theme_id INTEGER, build_id TEXT,
 occurred_at INTEGER NOT NULL CHECK(occurred_at>=0),
 day_key TEXT NOT NULL, week_key TEXT NOT NULL,
 signature TEXT NOT NULL, recorded_at INTEGER NOT NULL
);
CREATE INDEX rpg_atlas_quest_event_time ON rpg_atlas_quest_events(account_id,kind,occurred_at);
CREATE INDEX rpg_atlas_quest_event_map ON rpg_atlas_quest_events(account_id,kind,map_id,occurred_at);

CREATE TABLE rpg_atlas_quest_claims (
 account_id TEXT NOT NULL, quest_id TEXT NOT NULL, period_key TEXT NOT NULL,
 receipt_id TEXT NOT NULL UNIQUE, reward_char_id TEXT NOT NULL,
 rules_version TEXT NOT NULL, rewards_json TEXT NOT NULL CHECK(json_valid(rewards_json)),
 claimed_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,quest_id,period_key)
);
CREATE TABLE rpg_atlas_quest_requests (
 account_id TEXT NOT NULL, request_id TEXT NOT NULL,
 quest_id TEXT NOT NULL, period_key TEXT NOT NULL,
 receipt_id TEXT NOT NULL, requested_char_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,request_id)
);
CREATE TABLE rpg_atlas_quest_guard (ok INTEGER NOT NULL);

CREATE TRIGGER rpg_atlas_quest_event_world BEFORE INSERT ON rpg_atlas_quest_events
WHEN EXISTS(SELECT 1 FROM rpg_realm_identity WHERE realm_type<>'permanent' OR realm_id<>'permanent')
BEGIN SELECT RAISE(ABORT,'atlas_quest_permanent_only'); END;
CREATE TRIGGER rpg_atlas_quest_claim_world BEFORE INSERT ON rpg_atlas_quest_claims
WHEN EXISTS(SELECT 1 FROM rpg_realm_identity WHERE realm_type<>'permanent' OR realm_id<>'permanent')
BEGIN SELECT RAISE(ABORT,'atlas_quest_permanent_only'); END;
CREATE TRIGGER rpg_atlas_quest_request_world BEFORE INSERT ON rpg_atlas_quest_requests
WHEN EXISTS(SELECT 1 FROM rpg_realm_identity WHERE realm_type<>'permanent' OR realm_id<>'permanent')
BEGIN SELECT RAISE(ABORT,'atlas_quest_permanent_only'); END;
CREATE TRIGGER rpg_atlas_quest_event_owner BEFORE INSERT ON rpg_atlas_quest_events
WHEN NOT EXISTS(SELECT 1 FROM rpg_live_characters WHERE tg_id=NEW.char_id AND account_tg_id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'atlas_quest_account_mismatch'); END;
CREATE TRIGGER rpg_atlas_quest_claim_owner BEFORE INSERT ON rpg_atlas_quest_claims
WHEN NOT EXISTS(SELECT 1 FROM rpg_live_characters WHERE tg_id=NEW.reward_char_id AND account_tg_id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'atlas_quest_account_mismatch'); END;

CREATE TRIGGER rpg_atlas_quest_event_no_update BEFORE UPDATE ON rpg_atlas_quest_events
BEGIN SELECT RAISE(ABORT,'atlas_quest_event_immutable'); END;
CREATE TRIGGER rpg_atlas_quest_event_no_delete BEFORE DELETE ON rpg_atlas_quest_events
BEGIN SELECT RAISE(ABORT,'atlas_quest_event_immutable'); END;
CREATE TRIGGER rpg_atlas_quest_claim_no_update BEFORE UPDATE ON rpg_atlas_quest_claims
BEGIN SELECT RAISE(ABORT,'atlas_quest_claim_immutable'); END;
CREATE TRIGGER rpg_atlas_quest_claim_no_delete BEFORE DELETE ON rpg_atlas_quest_claims
BEGIN SELECT RAISE(ABORT,'atlas_quest_claim_immutable'); END;
CREATE TRIGGER rpg_atlas_quest_request_no_update BEFORE UPDATE ON rpg_atlas_quest_requests
BEGIN SELECT RAISE(ABORT,'atlas_quest_request_immutable'); END;
CREATE TRIGGER rpg_atlas_quest_request_no_delete BEFORE DELETE ON rpg_atlas_quest_requests
BEGIN SELECT RAISE(ABORT,'atlas_quest_request_immutable'); END;
