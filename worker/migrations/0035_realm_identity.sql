-- Additive realm metadata only. Applying this schema does NOT enable realms,
-- initialize an identity, seed a season, or change any existing player row.
CREATE TABLE rpg_realm_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  realm_id TEXT NOT NULL UNIQUE,
  realm_type TEXT NOT NULL CHECK (realm_type IN ('permanent', 'season')),
  database_token TEXT NOT NULL UNIQUE,
  instance_nonce TEXT NOT NULL UNIQUE,
  rules_version TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('ACTIVE', 'FREEZE', 'DRAIN', 'SEALED', 'IMPORTING', 'COMPLETE')),
  fence_epoch INTEGER NOT NULL CHECK (fence_epoch >= 0),
  cutoff_at INTEGER,
  manifest_hash TEXT,
  completion_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (realm_type = 'season' OR phase = 'ACTIVE'),
  CHECK ((phase = 'ACTIVE' AND cutoff_at IS NULL) OR (phase <> 'ACTIVE' AND cutoff_at IS NOT NULL)),
  CHECK (phase NOT IN ('SEALED', 'IMPORTING', 'COMPLETE') OR (manifest_hash IS NOT NULL AND length(manifest_hash) = 64)),
  CHECK (phase <> 'COMPLETE' OR (completion_hash IS NOT NULL AND length(completion_hash) = 64))
);

-- Permanent DB retains these reservations even after a season binding is removed.
-- The per-database nonce prevents a newly initialized DB from reusing an old ID,
-- including when an operator accidentally repeats the same configuration token.
CREATE TABLE rpg_realm_registry (
  realm_id TEXT PRIMARY KEY,
  realm_type TEXT NOT NULL CHECK (realm_type IN ('permanent', 'season')),
  database_token TEXT NOT NULL UNIQUE,
  instance_nonce TEXT NOT NULL UNIQUE,
  rules_version TEXT NOT NULL,
  registered_at INTEGER NOT NULL
);

-- A successful assertion inserts no rows. A failed assertion aborts its entire
-- D1 batch, including all player writes, through the NOT NULL constraint.
CREATE TABLE rpg_realm_commit_guard (ok INTEGER NOT NULL);

CREATE TABLE rpg_realm_phase_history (
  realm_id TEXT NOT NULL,
  from_phase TEXT NOT NULL,
  to_phase TEXT NOT NULL,
  fence_epoch INTEGER NOT NULL,
  cutoff_at INTEGER,
  evidence_hash TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (realm_id, to_phase)
);

CREATE TRIGGER rpg_realm_identity_no_replace BEFORE INSERT ON rpg_realm_identity
WHEN EXISTS (SELECT 1 FROM rpg_realm_identity)
BEGIN SELECT RAISE(ABORT, 'realm_identity_exists'); END;

CREATE TRIGGER rpg_realm_identity_initial_state BEFORE INSERT ON rpg_realm_identity
WHEN NEW.phase <> 'ACTIVE' OR NEW.fence_epoch <> 0 OR NEW.cutoff_at IS NOT NULL
  OR NEW.manifest_hash IS NOT NULL OR NEW.completion_hash IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'realm_initial_state_invalid'); END;

CREATE TRIGGER rpg_realm_identity_immutable BEFORE UPDATE ON rpg_realm_identity
WHEN NEW.singleton IS NOT OLD.singleton OR NEW.realm_id IS NOT OLD.realm_id
  OR NEW.realm_type IS NOT OLD.realm_type OR NEW.database_token IS NOT OLD.database_token
  OR NEW.instance_nonce IS NOT OLD.instance_nonce OR NEW.rules_version IS NOT OLD.rules_version
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'realm_identity_immutable'); END;

CREATE TRIGGER rpg_realm_identity_no_delete BEFORE DELETE ON rpg_realm_identity
BEGIN SELECT RAISE(ABORT, 'realm_identity_immutable'); END;

CREATE TRIGGER rpg_realm_phase_order BEFORE UPDATE ON rpg_realm_identity
WHEN OLD.realm_type <> 'season' OR NEW.fence_epoch <> OLD.fence_epoch + 1
  OR NEW.updated_at < OLD.updated_at
  OR (OLD.cutoff_at IS NOT NULL AND NEW.cutoff_at IS NOT OLD.cutoff_at)
  OR (OLD.manifest_hash IS NOT NULL AND NEW.manifest_hash IS NOT OLD.manifest_hash)
  OR (OLD.completion_hash IS NOT NULL AND NEW.completion_hash IS NOT OLD.completion_hash)
  OR NOT (
    (OLD.phase = 'ACTIVE' AND NEW.phase = 'FREEZE') OR
    (OLD.phase = 'FREEZE' AND NEW.phase = 'DRAIN') OR
    (OLD.phase = 'DRAIN' AND NEW.phase = 'SEALED') OR
    (OLD.phase = 'SEALED' AND NEW.phase = 'IMPORTING') OR
    (OLD.phase = 'IMPORTING' AND NEW.phase = 'COMPLETE')
  )
BEGIN SELECT RAISE(ABORT, 'realm_phase_transition_invalid'); END;

CREATE TRIGGER rpg_realm_registry_no_replace BEFORE INSERT ON rpg_realm_registry
WHEN EXISTS (SELECT 1 FROM rpg_realm_registry
  WHERE realm_id = NEW.realm_id OR database_token = NEW.database_token OR instance_nonce = NEW.instance_nonce)
BEGIN SELECT RAISE(ABORT, 'realm_id_reused'); END;

CREATE TRIGGER rpg_realm_registry_no_update BEFORE UPDATE ON rpg_realm_registry
BEGIN SELECT RAISE(ABORT, 'realm_registry_immutable'); END;

CREATE TRIGGER rpg_realm_registry_no_delete BEFORE DELETE ON rpg_realm_registry
BEGIN SELECT RAISE(ABORT, 'realm_registry_immutable'); END;
