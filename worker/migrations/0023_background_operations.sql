CREATE TABLE rpg_background_operations (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('auto_enhance_end','guardian_auto','auto_reroll_end')),
 ref_id TEXT NOT NULL,created_at INTEGER NOT NULL,dismissed_at INTEGER,
 UNIQUE(kind,ref_id)
);
CREATE INDEX rpg_background_operations_pending ON rpg_background_operations(owner,dismissed_at,seq);
-- Import only the currently visible legacy result, not every old operation.
INSERT INTO rpg_background_operations(owner,kind,ref_id,created_at,dismissed_at)
SELECT owner,kind,id,created_at,dismissed_at FROM (
 SELECT j.owner,'auto_enhance_end' AS kind,j.id,j.created_at,n.created_at AS dismissed_at FROM rpg_auto_enhance j
 LEFT JOIN rpg_notice_dismissals n ON n.account_tg_id=j.owner AND n.kind='auto_enhance_end' AND n.ref_id=j.id
 WHERE j.status='running' OR j.id=(SELECT id FROM rpg_auto_enhance x WHERE x.owner=j.owner ORDER BY created_at DESC,rowid DESC LIMIT 1)
 UNION ALL
 SELECT j.owner,'guardian_auto',j.id,j.created_at,j.seen_at FROM rpg_guardian_auto j
 WHERE j.status='running' OR j.id=(SELECT id FROM rpg_guardian_auto x WHERE x.owner=j.owner ORDER BY created_at DESC,rowid DESC LIMIT 1)
) ORDER BY created_at,kind,id;
CREATE TRIGGER background_enhance_start AFTER INSERT ON rpg_auto_enhance
BEGIN INSERT INTO rpg_background_operations(owner,kind,ref_id,created_at) VALUES(NEW.owner,'auto_enhance_end',NEW.id,NEW.created_at); END;
CREATE TRIGGER background_guardian_start AFTER INSERT ON rpg_guardian_auto
BEGIN INSERT INTO rpg_background_operations(owner,kind,ref_id,created_at) VALUES(NEW.owner,'guardian_auto',NEW.id,NEW.created_at); END;
CREATE TRIGGER background_reroll_start AFTER INSERT ON rpg_auto_reroll
BEGIN INSERT INTO rpg_background_operations(owner,kind,ref_id,created_at) VALUES(NEW.owner,'auto_reroll_end',NEW.id,NEW.created_at); END;
CREATE TRIGGER background_enhance_dismiss AFTER INSERT ON rpg_notice_dismissals WHEN NEW.kind='auto_enhance_end'
BEGIN UPDATE rpg_background_operations SET dismissed_at=COALESCE(dismissed_at,NEW.created_at) WHERE owner=NEW.account_tg_id AND kind=NEW.kind AND ref_id=NEW.ref_id; END;
CREATE TRIGGER background_guardian_seen AFTER UPDATE OF seen_at ON rpg_guardian_auto WHEN NEW.seen_at IS NOT NULL AND NEW.status='ended'
BEGIN UPDATE rpg_background_operations SET dismissed_at=COALESCE(dismissed_at,NEW.seen_at) WHERE owner=NEW.owner AND kind='guardian_auto' AND ref_id=NEW.id; END;
