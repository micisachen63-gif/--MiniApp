CREATE TABLE rpg_auto_enhance (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, tg_id TEXT NOT NULL, item_id TEXT NOT NULL,
 item_name TEXT NOT NULL, target INTEGER NOT NULL CHECK(target BETWEEN 1 AND 15), blessed INTEGER NOT NULL,
 status TEXT NOT NULL, reason TEXT, level INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 spent_gold INTEGER NOT NULL DEFAULT 0, spent_scrolls INTEGER NOT NULL DEFAULT 0,
 rev INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX rpg_auto_enhance_owner ON rpg_auto_enhance(owner) WHERE status IN ('running','processing');
CREATE INDEX rpg_auto_enhance_due ON rpg_auto_enhance(status,next_at);
CREATE TRIGGER rpg_auto_enhance_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=OLD.id AND status='running')
BEGIN SELECT RAISE(ABORT,'auto_enhance_locked'); END;
CREATE TRIGGER rpg_auto_enhance_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=OLD.id AND status='running')
BEGIN SELECT RAISE(ABORT,'auto_enhance_locked'); END;
