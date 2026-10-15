-- Permanent failures and bounded retries must not starve newer game notifications.
ALTER TABLE rpg_outbox ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rpg_outbox ADD COLUMN failed_at INTEGER;
ALTER TABLE rpg_outbox ADD COLUMN last_error_code INTEGER;
ALTER TABLE rpg_outbox ADD COLUMN last_error TEXT;
CREATE INDEX idx_rpg_outbox_retry
 ON rpg_outbox(next_attempt_at,claimed_at,id)
 WHERE delivered_at IS NULL AND failed_at IS NULL;
CREATE INDEX idx_rpg_outbox_failed ON rpg_outbox(failed_at) WHERE failed_at IS NOT NULL;
