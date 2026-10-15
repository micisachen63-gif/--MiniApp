-- Preserve existing rarity, element, enhancement and relic bonuses.
ALTER TABLE rpg_equipment ADD COLUMN affixes_json TEXT NOT NULL DEFAULT '[]';
