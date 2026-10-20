-- Additive administration and first-party daily behavior aggregates; no player rewrites.
CREATE TABLE rpg_admin_sessions (
 token_hash TEXT PRIMARY KEY, admin_tg_id TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX rpg_admin_sessions_expiry ON rpg_admin_sessions(expires_at);
CREATE TABLE rpg_admin_login_approvals (
 challenge TEXT PRIMARY KEY, admin_tg_id TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE TABLE rpg_admin_grants (
 admin_tg_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
 payload_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(admin_tg_id,request_id)
);
CREATE INDEX rpg_admin_grants_created ON rpg_admin_grants(created_at);
CREATE TABLE rpg_behavior_daily (
 day TEXT NOT NULL, account_tg_id TEXT NOT NULL, event TEXT NOT NULL,
 first_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
 PRIMARY KEY(day,account_tg_id,event)
);
CREATE INDEX rpg_behavior_account_day ON rpg_behavior_daily(account_tg_id,day);
CREATE INDEX rpg_ledger_created ON rpg_ledger(created_at);
CREATE INDEX rpg_characters_created ON rpg_characters(created_at);
CREATE INDEX rpg_admin_audit_created ON rpg_admin_audit(created_at);
