-- Recover notifications after a relay crash and make retried trade actions safe.
ALTER TABLE rpg_outbox ADD COLUMN delivered_at INTEGER;
ALTER TABLE rpg_outbox ADD COLUMN claim_token TEXT;
ALTER TABLE rpg_outbox ADD COLUMN claim_attempts INTEGER NOT NULL DEFAULT 0;

-- Existing rows had already been permanently claimed by the old relay. Do not
-- replay them during rollout; only newly leased rows participate in delivery.
UPDATE rpg_outbox SET delivered_at = claimed_at WHERE claimed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rpg_outbox_delivery
  ON rpg_outbox(delivered_at, claimed_at, id);

CREATE TABLE IF NOT EXISTS rpg_trade_operations (
  trade_id TEXT NOT NULL,
  tg_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trade_id, tg_id, request_id)
);
