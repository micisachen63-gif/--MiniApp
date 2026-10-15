-- Notice receipts are account-wide; they never alter a job, money, inventory or a summon result.
CREATE TABLE rpg_notice_dismissals (
 account_tg_id TEXT NOT NULL REFERENCES rpg_accounts(account_tg_id),
 kind TEXT NOT NULL CHECK(kind IN('auto_enhance_end','guardian_summon','guardian_fuse')),
 ref_id TEXT NOT NULL CHECK(length(ref_id) BETWEEN 8 AND 120),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(account_tg_id,kind,ref_id)
);
