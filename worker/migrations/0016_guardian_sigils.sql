-- Additive guardian-angel schema; existing character and inventory data remain intact.
-- Existing money, stack inventory, daily counters, ledger and outbox are reused.
ALTER TABLE rpg_characters ADD COLUMN guardian_draw_remainder INTEGER NOT NULL DEFAULT 0
 CHECK(guardian_draw_remainder BETWEEN 0 AND 4);

CREATE TABLE rpg_guardian_operations (
 operation_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 6 AND 100),
 action TEXT NOT NULL CHECK(action IN('summon','fuse','activate','lock','unbind','share')),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 config_version TEXT NOT NULL,
 cost_json TEXT NOT NULL CHECK(json_valid(cost_json)),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at INTEGER NOT NULL,
 UNIQUE(char_id,request_id)
);
CREATE INDEX idx_guardian_operations_owner ON rpg_guardian_operations(char_id,created_at,operation_id);

CREATE TABLE rpg_guardian_sigils (
 id TEXT PRIMARY KEY,
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 type TEXT NOT NULL CHECK(type IN('melee','ranged','magic','loot')),
 quality INTEGER NOT NULL CHECK(quality BETWEEN 1 AND 8),
 bound INTEGER NOT NULL DEFAULT 0 CHECK(bound IN(0,1)),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),
 locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN(0,1)),
 trade_id TEXT REFERENCES rpg_trades(id),
 rev INTEGER NOT NULL DEFAULT 0 CHECK(rev>=0),
 source_operation_id TEXT NOT NULL REFERENCES rpg_guardian_operations(operation_id),
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 CHECK(active=0 OR bound=1),
 CHECK(trade_id IS NULL OR (active=0 AND bound=0 AND locked=0))
);
CREATE INDEX idx_guardian_owner ON rpg_guardian_sigils(char_id,created_at,id);
CREATE UNIQUE INDEX idx_guardian_one_active ON rpg_guardian_sigils(char_id) WHERE active=1;
CREATE INDEX idx_guardian_trade ON rpg_guardian_sigils(trade_id) WHERE trade_id IS NOT NULL;

CREATE TABLE rpg_guardian_voucher_grants (
 account_id TEXT NOT NULL REFERENCES rpg_accounts(account_tg_id),
 boss_id TEXT NOT NULL REFERENCES rpg_boss_instances(id),
 day TEXT NOT NULL,
 recipient_char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,boss_id),
 CHECK(day=date(created_at/1000,'unixepoch','+8 hours'))
);
CREATE INDEX idx_guardian_grants_day ON rpg_guardian_voucher_grants(account_id,day);

CREATE TABLE rpg_guardian_welcome (
 account_id TEXT PRIMARY KEY REFERENCES rpg_accounts(account_tg_id),
 recipient_char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 draws INTEGER NOT NULL DEFAULT 200 CHECK(draws=200),
 created_at INTEGER NOT NULL
);
CREATE TRIGGER guardian_welcome_guard BEFORE INSERT ON rpg_guardian_welcome BEGIN
 SELECT RAISE(ABORT,'guardian_welcome_locked') WHERE NOT EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=NEW.recipient_char_id
  AND account_tg_id=NEW.account_id AND level>=15);
END;
CREATE TRIGGER guardian_welcome_resources AFTER INSERT ON rpg_guardian_welcome BEGIN
 INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(NEW.recipient_char_id,'guardian_free_normal',NEW.draws)
 ON CONFLICT(tg_id,item) DO UPDATE SET quantity=quantity+excluded.quantity;
 INSERT INTO rpg_ledger(event_id,tg_id,type,item,item_delta,note,created_at)
 VALUES('guardian-welcome:'||NEW.account_id,NEW.recipient_char_id,'守護神初見贈禮','guardian_free_normal',NEW.draws,'首次進入；免費普通召喚',NEW.created_at);
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.created_at WHERE tg_id=NEW.recipient_char_id;
END;
CREATE TRIGGER guardian_welcome_no_update BEFORE UPDATE ON rpg_guardian_welcome BEGIN SELECT RAISE(ABORT,'guardian_welcome_immutable'); END;
CREATE TRIGGER guardian_welcome_no_delete BEFORE DELETE ON rpg_guardian_welcome BEGIN SELECT RAISE(ABORT,'guardian_welcome_immutable'); END;

-- Runtime must use conditional INSERT ... SELECT when below the cap. A capped
-- player is skipped rather than aborting other participants' boss settlement.
-- This trigger is a final integrity guard, not the ordinary cap-control path.
CREATE TRIGGER guardian_grant_guard BEFORE INSERT ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,'guardian_invalid_participant') WHERE NOT EXISTS(
  SELECT 1 FROM rpg_characters c JOIN rpg_boss_attacks a ON a.tg_id=c.tg_id
  WHERE c.tg_id=NEW.recipient_char_id AND c.account_tg_id=NEW.account_id
   AND a.boss_id=NEW.boss_id AND a.damage>0
 );
 SELECT RAISE(ABORT,'guardian_voucher_daily_cap') WHERE COALESCE((SELECT n FROM rpg_daily_counters
  WHERE tg_id=NEW.account_id AND day=NEW.day AND key='guardian_voucher'),0)>=4
 ;
END;
CREATE TRIGGER guardian_grant_resources AFTER INSERT ON rpg_guardian_voucher_grants BEGIN
 INSERT INTO rpg_daily_counters(tg_id,day,key,n) VALUES(NEW.account_id,NEW.day,'guardian_voucher',1)
 ON CONFLICT(tg_id,day,key) DO UPDATE SET n=n+1;
 INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(NEW.recipient_char_id,'guardian_voucher',1)
 ON CONFLICT(tg_id,item) DO UPDATE SET quantity=quantity+1;
 INSERT INTO rpg_ledger(event_id,tg_id,type,item,item_delta,note,created_at)
 VALUES('guardian-voucher:'||NEW.boss_id||':'||NEW.account_id,NEW.recipient_char_id,
  '守護神召喚憑證','guardian_voucher',1,NEW.boss_id,NEW.created_at);
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.created_at WHERE tg_id=NEW.recipient_char_id;
END;
CREATE TRIGGER guardian_grant_no_update BEFORE UPDATE ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,'guardian_grant_immutable');
END;
CREATE TRIGGER guardian_grant_no_delete BEFORE DELETE ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,'guardian_grant_immutable');
END;

-- Sigil mutations conflict with stale player/party snapshots. Party has to end
-- before activation, consumption, unbinding or ownership transfer is permitted.
CREATE TRIGGER guardian_sigil_party_update BEFORE UPDATE ON rpg_guardian_sigils
 WHEN EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=OLD.char_id AND party_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'guardian_party_locked'); END;
CREATE TRIGGER guardian_sigil_party_delete BEFORE DELETE ON rpg_guardian_sigils
 WHEN EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=OLD.char_id AND party_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'guardian_party_locked'); END;
-- Escrow and active material deletion cannot bypass the API checks.
CREATE TRIGGER guardian_sigil_delete_guard BEFORE DELETE ON rpg_guardian_sigils
 WHEN OLD.active=1 OR OLD.locked=1 OR OLD.trade_id IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'guardian_sigil_protected'); END;
CREATE TRIGGER guardian_sigil_transfer_guard BEFORE UPDATE OF char_id ON rpg_guardian_sigils
 WHEN NEW.char_id<>OLD.char_id AND (OLD.active=1 OR OLD.bound=1 OR OLD.locked=1)
 BEGIN SELECT RAISE(ABORT,'guardian_transfer_protected'); END;
CREATE TRIGGER guardian_sigil_insert_revision AFTER INSERT ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.updated_at WHERE tg_id=NEW.char_id;
END;
CREATE TRIGGER guardian_sigil_update_revision AFTER UPDATE ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.updated_at WHERE tg_id=OLD.char_id OR tg_id=NEW.char_id;
END;
CREATE TRIGGER guardian_sigil_delete_revision AFTER DELETE ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=OLD.char_id;
END;
-- Migration 0017 extends the existing trade/share engine with the sigil subtype.
