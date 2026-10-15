-- Existing background jobs keep their original 5/10 count. The new flag allows
-- one-draw jobs without rebuilding the live table or changing old CHECKs.
ALTER TABLE rpg_guardian_auto ADD COLUMN single_draw INTEGER NOT NULL DEFAULT 0 CHECK(single_draw IN (0,1));
