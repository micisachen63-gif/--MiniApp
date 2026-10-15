-- Each character stores two authoritative idle enemies and its latest resolved minute.
-- Reuses the existing optimistic player batch; no per-hit rows, polling or cron are added.
ALTER TABLE rpg_characters ADD COLUMN idle_combat_json TEXT;
