-- Read-only cohort aggregation acceleration; no existing life/player is rewritten.
CREATE INDEX IF NOT EXISTS rpg_fate_v6_peer_completion
 ON rpg_fate_lives(completed_at,account_id)
 WHERE status='complete' AND json_extract(state_json,'$.version')=6;
