-- Additive; existing finished collections remain owned, no ability auto-selected.
ALTER TABLE rpg_characters ADD COLUMN collection_active_map INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(collection_active_map)='integer' AND collection_active_map BETWEEN 0 AND 12);
CREATE TRIGGER collection_blessing_owner BEFORE UPDATE OF collection_active_map ON rpg_characters
WHEN NEW.collection_active_map<>OLD.collection_active_map AND NEW.collection_active_map>0 BEGIN
 SELECT RAISE(ABORT,'collection_not_owned') WHERE NOT EXISTS(
  SELECT 1 FROM rpg_inventory WHERE tg_id=NEW.tg_id AND item='collection_'||NEW.collection_active_map AND quantity>0);
END;
CREATE TRIGGER collection_blessing_party BEFORE UPDATE OF collection_active_map ON rpg_characters
WHEN NEW.collection_active_map<>OLD.collection_active_map AND OLD.party_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'collection_party_locked');
END;
CREATE TRIGGER collection_blessing_keep_update BEFORE UPDATE OF quantity,item,tg_id ON rpg_inventory
WHEN OLD.item LIKE 'collection_%' AND (NEW.quantity<1 OR NEW.item<>OLD.item OR NEW.tg_id<>OLD.tg_id) BEGIN
 SELECT RAISE(ABORT,'collection_active_owned') WHERE EXISTS(
  SELECT 1 FROM rpg_characters WHERE tg_id=OLD.tg_id AND collection_active_map>0 AND OLD.item='collection_'||collection_active_map);
END;
CREATE TRIGGER collection_blessing_keep_delete BEFORE DELETE ON rpg_inventory
WHEN OLD.item LIKE 'collection_%' BEGIN
 SELECT RAISE(ABORT,'collection_active_owned') WHERE EXISTS(
  SELECT 1 FROM rpg_characters WHERE tg_id=OLD.tg_id AND collection_active_map>0 AND OLD.item='collection_'||collection_active_map);
END;
