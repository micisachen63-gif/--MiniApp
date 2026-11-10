-- Additive cursor and partial index only; no player or reward data is changed.
-- One checkpoint per scoped realm. The cursor is claimed with a revision CAS.
CREATE TABLE rpg_atlas_sweep_cursor (
 realm_id TEXT PRIMARY KEY,
 cursor TEXT NOT NULL DEFAULT '',
 rev INTEGER NOT NULL DEFAULT 0 CHECK(rev>=0),
 updated_at INTEGER NOT NULL
);
CREATE INDEX rpg_atlas_running_sweep ON rpg_atlas_runs(realm_id,id) WHERE status='running';
