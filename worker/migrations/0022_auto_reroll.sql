CREATE TABLE rpg_auto_reroll (
 id TEXT PRIMARY KEY,owner TEXT NOT NULL,tg_id TEXT NOT NULL,item_id TEXT NOT NULL,item_name TEXT NOT NULL,
 request_id TEXT NOT NULL,config_json TEXT NOT NULL,class_snapshot TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','processing','ended')),reason TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,spent_gold INTEGER NOT NULL DEFAULT 0,spent_scrolls INTEGER NOT NULL DEFAULT 0,
 result_json TEXT NOT NULL DEFAULT '{}',rev INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 UNIQUE(owner,request_id)
);
CREATE UNIQUE INDEX rpg_auto_reroll_owner ON rpg_auto_reroll(owner) WHERE status IN ('running','processing');
CREATE INDEX rpg_auto_reroll_due ON rpg_auto_reroll(status,next_at);
CREATE INDEX rpg_auto_reroll_item ON rpg_auto_reroll(item_id,status);
CREATE TRIGGER rpg_auto_reroll_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=OLD.id AND status='running')
BEGIN SELECT RAISE(ABORT,'auto_reroll_locked'); END;
CREATE TRIGGER rpg_auto_reroll_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=OLD.id AND status='running')
BEGIN SELECT RAISE(ABORT,'auto_reroll_locked'); END;
CREATE TRIGGER rpg_auto_reroll_start_guard BEFORE INSERT ON rpg_auto_reroll
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=NEW.item_id AND status IN ('running','processing'))
BEGIN SELECT RAISE(ABORT,'background_item_locked'); END;
CREATE TRIGGER rpg_auto_enhance_start_guard BEFORE INSERT ON rpg_auto_enhance
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=NEW.item_id AND status IN ('running','processing'))
BEGIN SELECT RAISE(ABORT,'background_item_locked'); END;
