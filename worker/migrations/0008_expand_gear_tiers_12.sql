-- 小精靈 RPG: 12 equipment tiers (T1–T12) corresponding to 12 Greek-mythology maps (Lv1–120)
-- Rebuild rpg_equipment table to expand CHECK (tier BETWEEN 1 AND 12)

CREATE TABLE rpg_equipment_v12 (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('weapon','helmet','armor','gloves','boots','belt','undershirt','earring','ring')),
  kind TEXT NOT NULL,
  class_req TEXT NOT NULL CHECK (class_req IN ('mage','sword','archer','any')),
  branch_req TEXT CHECK (branch_req IS NULL OR branch_req IN ('A','B')),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 12),
  level_req INTEGER NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'shop',
  base_stat INTEGER NOT NULL,
  bonus_json TEXT,
  element TEXT,
  element_stat INTEGER NOT NULL DEFAULT 0,
  element_tier TEXT NOT NULL DEFAULT 'common',
  enhance_level INTEGER NOT NULL DEFAULT 0,
  is_equipped INTEGER NOT NULL DEFAULT 0 CHECK (is_equipped BETWEEN 0 AND 2),
  convert_token INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  grade TEXT NOT NULL DEFAULT 'normal' CHECK (grade IN ('normal','relic')),
  affix_json TEXT,
  bound INTEGER NOT NULL DEFAULT 0,
  trade_id TEXT,
  CHECK (trade_id IS NULL OR is_equipped = 0)
);

INSERT INTO rpg_equipment_v12 (id, tg_id, slot, kind, class_req, branch_req, tier, level_req, name, source, base_stat, bonus_json, element, element_stat, element_tier, enhance_level, is_equipped, convert_token, created_at, grade, affix_json, bound, trade_id)
SELECT id, tg_id, slot, kind, class_req, branch_req, tier, level_req, name, source, base_stat, bonus_json, element, element_stat, element_tier, enhance_level, is_equipped, convert_token, created_at, grade, affix_json, bound, trade_id
FROM rpg_equipment;

DROP TABLE rpg_equipment;
ALTER TABLE rpg_equipment_v12 RENAME TO rpg_equipment;
CREATE INDEX IF NOT EXISTS idx_rpg_equipment_owner ON rpg_equipment(tg_id, is_equipped);
CREATE INDEX IF NOT EXISTS idx_rpg_equipment_trade ON rpg_equipment(trade_id) WHERE trade_id IS NOT NULL;
