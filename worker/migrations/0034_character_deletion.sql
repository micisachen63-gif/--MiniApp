-- Additive retirement: preserve foreign-key history; only live characters are playable.
ALTER TABLE rpg_characters ADD COLUMN deleted_at INTEGER;
CREATE TABLE rpg_character_deletions (
 char_id TEXT PRIMARY KEY REFERENCES rpg_characters(tg_id),
 account_tg_id TEXT NOT NULL, char_slot INTEGER NOT NULL, original_name TEXT NOT NULL,
 day TEXT NOT NULL, request_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(account_tg_id,day), UNIQUE(account_tg_id,request_id)
);
CREATE INDEX rpg_character_deletions_owner ON rpg_character_deletions(account_tg_id,created_at);
CREATE VIEW rpg_live_characters AS SELECT * FROM rpg_characters WHERE deleted_at IS NULL;
CREATE VIEW rpg_character_origins AS
 SELECT c.tg_id,COALESCE(c.account_tg_id,d.account_tg_id,c.tg_id) account_tg_id,c.created_at
 FROM rpg_characters c LEFT JOIN rpg_character_deletions d ON d.char_id=c.tg_id;
-- D1 restricts compound SELECT terms; correlated EXISTS avoids a long UNION.
CREATE VIEW rpg_character_delete_blocks AS
 SELECT c.tg_id char_id,j.value reason FROM rpg_characters c CROSS JOIN json_each(json_array(
 CASE WHEN c.party_id IS NOT NULL OR EXISTS(SELECT 1 FROM rpg_party_presence WHERE char_id=c.tg_id)
 OR EXISTS(SELECT 1 FROM rpg_party_members m JOIN rpg_parties p ON p.id=m.party_id WHERE m.char_id=c.tg_id AND p.status IN ('lobby','combat'))
 OR EXISTS(SELECT 1 FROM rpg_star_ring_members m JOIN rpg_star_ring_runs p ON p.id=m.run_id WHERE m.char_id=c.tg_id AND m.left_at IS NULL AND p.status IN ('lobby','running')) THEN 'party' END,
 CASE WHEN EXISTS(SELECT 1 FROM rpg_trades WHERE status='open' AND (a_tg=c.tg_id OR b_tg=c.tg_id))
 OR EXISTS(SELECT 1 FROM rpg_trade_requests WHERE status='pending' AND (owner_tg=c.tg_id OR requester_tg=c.tg_id))
 OR EXISTS(SELECT 1 FROM rpg_equipment WHERE tg_id=c.tg_id AND trade_id IS NOT NULL)
 OR EXISTS(SELECT 1 FROM rpg_guardian_sigils WHERE char_id=c.tg_id AND (trade_id IS NOT NULL OR exchange_id IS NOT NULL)) THEN 'trade' END,
 CASE WHEN EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE seller_char=c.tg_id AND status='active') THEN 'market' END,
 CASE WHEN EXISTS(SELECT 1 FROM rpg_pk WHERE status='pending' AND (a_tg=c.tg_id OR b_tg=c.tg_id)) THEN 'pk' END,
 CASE WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE tg_id=c.tg_id AND status IN ('running','processing'))
 OR EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE tg_id=c.tg_id AND status IN ('running','processing'))
 OR EXISTS(SELECT 1 FROM rpg_guardian_auto WHERE char_id=c.tg_id AND status='running') THEN 'background' END,
 CASE WHEN EXISTS(SELECT 1 FROM rpg_fate_lives WHERE char_id=c.tg_id AND status='active')
 OR EXISTS(SELECT 1 FROM rpg_fate_social_choices WHERE (owner_char=c.tg_id OR guest_char=c.tg_id) AND status IN ('scheduled','pending')) THEN 'fate' END,
 CASE WHEN EXISTS(SELECT 1 FROM rpg_boss_attacks a JOIN rpg_boss_instances b ON b.id=a.boss_id WHERE a.tg_id=c.tg_id AND b.settled_at IS NULL) THEN 'boss' END,
 CASE WHEN EXISTS(SELECT 1 FROM rpg_party_members m JOIN rpg_parties p ON p.id=m.party_id WHERE m.char_id=c.tg_id
 AND ((p.kind='dungeon' AND p.status='won') OR (p.kind='tower' AND p.status IN ('won','lost','ended') AND COALESCE(json_extract(p.state_json,'$.clearedFloor'),0)>=COALESCE(json_extract(p.state_json,'$.startFloor'),1)))
 AND NOT EXISTS(SELECT 1 FROM rpg_party_rewards r WHERE r.party_id=p.id AND r.char_id=m.char_id)) THEN 'rewards' END
 )) j WHERE j.value IS NOT NULL;
CREATE TRIGGER rpg_delete_busy BEFORE UPDATE OF deleted_at ON rpg_characters
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM rpg_character_delete_blocks WHERE char_id=OLD.tg_id)
BEGIN SELECT RAISE(ABORT,'character_delete_busy'); END;
CREATE TRIGGER rpg_deleted_immutable BEFORE UPDATE ON rpg_characters WHEN OLD.deleted_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_party_members_live_insert BEFORE INSERT ON rpg_party_members
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.char_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_party_members_live_update BEFORE UPDATE ON rpg_party_members
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.char_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_party_presence_live_insert BEFORE INSERT ON rpg_party_presence
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.char_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_party_presence_live_update BEFORE UPDATE ON rpg_party_presence
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.char_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_star_ring_members_live_insert BEFORE INSERT ON rpg_star_ring_members
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.char_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_star_ring_members_live_update BEFORE UPDATE ON rpg_star_ring_members
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.char_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_trades_live_insert BEFORE INSERT ON rpg_trades
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.a_tg,NEW.b_tg) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_trades_live_update BEFORE UPDATE ON rpg_trades
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.a_tg,NEW.b_tg) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_trade_requests_live_insert BEFORE INSERT ON rpg_trade_requests
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.owner_tg,NEW.requester_tg) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_trade_requests_live_update BEFORE UPDATE ON rpg_trade_requests
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.owner_tg,NEW.requester_tg) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_pk_live_insert BEFORE INSERT ON rpg_pk
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.a_tg,NEW.b_tg) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_pk_live_update BEFORE UPDATE ON rpg_pk
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.a_tg,NEW.b_tg) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_exchange_listings_live_insert BEFORE INSERT ON rpg_exchange_listings
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.seller_char) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_exchange_listings_live_update BEFORE UPDATE ON rpg_exchange_listings
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.seller_char) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_fate_lives_live_insert BEFORE INSERT ON rpg_fate_lives
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.char_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_fate_lives_live_update BEFORE UPDATE ON rpg_fate_lives
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.char_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_fate_social_choices_live_insert BEFORE INSERT ON rpg_fate_social_choices
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.owner_char,NEW.guest_char) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_fate_social_choices_live_update BEFORE UPDATE ON rpg_fate_social_choices
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.owner_char,NEW.guest_char) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_boss_attacks_live_insert BEFORE INSERT ON rpg_boss_attacks
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.tg_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_boss_attacks_live_update BEFORE UPDATE ON rpg_boss_attacks
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.tg_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_auto_enhance_live_insert BEFORE INSERT ON rpg_auto_enhance
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.tg_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_auto_enhance_live_update BEFORE UPDATE ON rpg_auto_enhance
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.tg_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_auto_reroll_live_insert BEFORE INSERT ON rpg_auto_reroll
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.tg_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_auto_reroll_live_update BEFORE UPDATE ON rpg_auto_reroll
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.tg_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_guardian_auto_live_insert BEFORE INSERT ON rpg_guardian_auto
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.char_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_guardian_auto_live_update BEFORE UPDATE ON rpg_guardian_auto
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.char_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_ledger_live_insert BEFORE INSERT ON rpg_ledger
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.tg_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_ledger_live_update BEFORE UPDATE ON rpg_ledger
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.tg_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_inventory_live_insert BEFORE INSERT ON rpg_inventory
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.tg_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_inventory_live_update BEFORE UPDATE ON rpg_inventory
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.tg_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_equipment_live_insert BEFORE INSERT ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.tg_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_equipment_live_update BEFORE UPDATE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.tg_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_guardian_sigils_live_insert BEFORE INSERT ON rpg_guardian_sigils
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.char_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_guardian_sigils_live_update BEFORE UPDATE ON rpg_guardian_sigils
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id IN (NEW.char_id) AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
CREATE TRIGGER rpg_account_active_live BEFORE UPDATE OF active_char_id ON rpg_accounts
WHEN EXISTS(SELECT 1 FROM rpg_character_deletions d JOIN rpg_characters c ON c.tg_id=d.char_id WHERE d.char_id=NEW.active_char_id AND c.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'character_deleted'); END;
-- One INSERT is the entire retirement transaction, including maintenance callers.
CREATE TRIGGER rpg_character_delete_commit AFTER INSERT ON rpg_character_deletions
BEGIN
 SELECT RAISE(ABORT,'character_delete_changed') WHERE NOT EXISTS(
  SELECT 1 FROM rpg_characters c WHERE c.tg_id=NEW.char_id AND c.account_tg_id=NEW.account_tg_id
  AND c.deleted_at IS NULL AND c.name=NEW.original_name AND c.char_slot=NEW.char_slot
  AND c.rev=json_extract(NEW.snapshot_json,'$.rev') AND c.gold=json_extract(NEW.snapshot_json,'$.gold')
 );
 SELECT RAISE(ABORT,'character_delete_busy') WHERE EXISTS(SELECT 1 FROM rpg_character_delete_blocks WHERE char_id=NEW.char_id);
 SELECT RAISE(ABORT,'character_delete_day') WHERE NEW.day<>date(NEW.created_at/1000,'unixepoch','+8 hours');
 INSERT OR IGNORE INTO rpg_accounts(account_tg_id,active_char_id,updated_at) VALUES(NEW.account_tg_id,NULL,NEW.created_at);
 UPDATE rpg_characters SET last_settle_at=NEW.created_at,updated_at=NEW.created_at,rev=rev+1
 WHERE tg_id=(SELECT tg_id FROM rpg_live_characters WHERE account_tg_id=NEW.account_tg_id AND tg_id<>NEW.char_id ORDER BY char_slot LIMIT 1)
 AND EXISTS(SELECT 1 FROM rpg_accounts WHERE account_tg_id=NEW.account_tg_id AND (active_char_id=NEW.char_id OR (active_char_id IS NULL AND NEW.char_id=NEW.account_tg_id)));
 UPDATE rpg_accounts SET active_char_id=(SELECT tg_id FROM rpg_live_characters WHERE account_tg_id=NEW.account_tg_id AND tg_id<>NEW.char_id ORDER BY char_slot LIMIT 1),updated_at=NEW.created_at
 WHERE account_tg_id=NEW.account_tg_id AND (active_char_id=NEW.char_id OR (active_char_id IS NULL AND NEW.char_id=NEW.account_tg_id));
 INSERT INTO rpg_ledger(event_id,tg_id,type,gold_delta,item,item_delta,exp_delta,note,created_at)
 SELECT 'character-delete:'||NEW.char_id,NEW.char_id,'角色刪除',-gold,NULL,0,0,json_object('name',NEW.original_name,'slot',NEW.char_slot,'day',NEW.day),NEW.created_at FROM rpg_characters WHERE tg_id=NEW.char_id;
 INSERT OR IGNORE INTO rpg_notice_dismissals(account_tg_id,kind,ref_id,created_at)
 SELECT NEW.account_tg_id,'auto_enhance_end',j.id,NEW.created_at FROM rpg_auto_enhance j JOIN rpg_background_operations o ON o.kind='auto_enhance_end' AND o.ref_id=j.id WHERE j.tg_id=NEW.char_id AND j.status='ended' AND o.dismissed_at IS NULL;
 UPDATE rpg_guardian_auto SET seen_at=COALESCE(seen_at,NEW.created_at) WHERE char_id=NEW.char_id AND status='ended' AND seen_at IS NULL;
 UPDATE rpg_background_operations SET dismissed_at=COALESCE(dismissed_at,NEW.created_at) WHERE owner=NEW.account_tg_id AND (
 (kind='auto_enhance_end' AND ref_id IN(SELECT id FROM rpg_auto_enhance WHERE tg_id=NEW.char_id AND status='ended')) OR
 (kind='auto_reroll_end' AND ref_id IN(SELECT id FROM rpg_auto_reroll WHERE tg_id=NEW.char_id AND status='ended')) OR
 (kind='guardian_auto' AND ref_id IN(SELECT id FROM rpg_guardian_auto WHERE char_id=NEW.char_id AND status='ended')));
 UPDATE rpg_characters SET deleted_at=NEW.created_at,account_tg_id=NULL,name='~deleted:'||tg_id,gold=0,idle_state='town_no_red',last_settle_at=NEW.created_at,rev=rev+1,updated_at=NEW.created_at WHERE tg_id=NEW.char_id;
 UPDATE rpg_shares SET tradeable=0 WHERE tg_id=NEW.char_id;
 UPDATE rpg_outbox SET failed_at=NEW.created_at,last_error='character_deleted' WHERE target='dm' AND delivered_at IS NULL AND failed_at IS NULL AND json_valid(payload_json) AND json_extract(payload_json,'$.recipientCharId')=NEW.char_id;
END;
