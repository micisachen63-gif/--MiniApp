-- Additive only: no existing character, item, +N or account is rewritten.
CREATE TABLE rpg_atlas_talents (
  char_id TEXT PRIMARY KEY REFERENCES rpg_characters(tg_id),
  rules_version TEXT NOT NULL DEFAULT 'atlas-talents-v1',
  allocated_json TEXT NOT NULL DEFAULT '[]',
  tutorial_step INTEGER NOT NULL DEFAULT 0 CHECK(tutorial_step IN (0,1,2)),
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
