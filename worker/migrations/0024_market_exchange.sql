-- Player exchange. Inventory is escrowed at creation; gear keeps its existing trade lock.
CREATE TABLE rpg_exchange_listings (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 seller_account TEXT NOT NULL, seller_char TEXT NOT NULL, buyer_char TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('equip','item','guardian')), ref TEXT NOT NULL,
 qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 99999),
 price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 1000000),
 fee INTEGER NOT NULL CHECK(fee=(price+19)/20),
 category TEXT NOT NULL CHECK(category IN ('equipment','scroll','collection','skillbook','other','guardian')),
 class_req TEXT NOT NULL CHECK(class_req IN ('any','sword','archer','mage')), tier INTEGER CHECK(tier BETWEEN 1 AND 12),
 quality TEXT, enhance INTEGER, snapshot_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','sold','cancelled')),
 rev INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 closed_at INTEGER, CHECK(kind='item' OR qty=1)
);
CREATE INDEX rpg_exchange_active ON rpg_exchange_listings(status,seq DESC);
CREATE INDEX rpg_exchange_category ON rpg_exchange_listings(status,category,seq DESC);
CREATE INDEX rpg_exchange_class ON rpg_exchange_listings(status,class_req,seq DESC);
CREATE INDEX rpg_exchange_tier ON rpg_exchange_listings(status,tier,seq DESC);
CREATE INDEX rpg_exchange_quality ON rpg_exchange_listings(status,quality,seq DESC);
CREATE INDEX rpg_exchange_seller ON rpg_exchange_listings(seller_account,status,seq DESC);
CREATE INDEX rpg_exchange_history ON rpg_exchange_listings(seller_account,seq DESC);
-- Sellable/old equipment guards look up a particular job, not every active job.
CREATE INDEX rpg_exchange_enhance_item ON rpg_auto_enhance(item_id,status);
CREATE UNIQUE INDEX rpg_exchange_equipment ON rpg_exchange_listings(ref) WHERE status='active' AND kind='equip';
CREATE UNIQUE INDEX rpg_exchange_guardian ON rpg_exchange_listings(ref) WHERE status='active' AND kind='guardian';
CREATE TABLE rpg_exchange_operations (
 account_tg_id TEXT NOT NULL, request_id TEXT NOT NULL, char_id TEXT NOT NULL,
 action TEXT NOT NULL, payload_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(account_tg_id,request_id)
);
-- Guardian trade_id keeps its original FK to real person-to-person trades.
-- An independent nullable FK avoids counterfeit trades and their timeout path.
ALTER TABLE rpg_guardian_sigils ADD COLUMN exchange_id TEXT REFERENCES rpg_exchange_listings(id);
CREATE UNIQUE INDEX rpg_guardian_exchange ON rpg_guardian_sigils(exchange_id) WHERE exchange_id IS NOT NULL;
CREATE TRIGGER rpg_exchange_guardian_claim BEFORE UPDATE OF exchange_id ON rpg_guardian_sigils
WHEN NEW.exchange_id IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,'exchange_guardian_locked') WHERE NEW.bound<>0 OR NEW.active<>0 OR NEW.locked<>0 OR NEW.trade_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=NEW.exchange_id AND status='active' AND kind='guardian' AND ref=NEW.id AND seller_char=NEW.char_id);
END;
CREATE TRIGGER rpg_exchange_guardian_update BEFORE UPDATE ON rpg_guardian_sigils
WHEN OLD.exchange_id IS NOT NULL AND EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=OLD.exchange_id AND status='active' AND kind='guardian' AND ref=OLD.id)
BEGIN SELECT RAISE(ABORT,'exchange_guardian_locked'); END;
CREATE TRIGGER rpg_exchange_guardian_delete BEFORE DELETE ON rpg_guardian_sigils
WHEN OLD.exchange_id IS NOT NULL AND EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=OLD.exchange_id AND status='active' AND kind='guardian' AND ref=OLD.id)
BEGIN SELECT RAISE(ABORT,'exchange_guardian_locked'); END;
-- Sharing does not UPDATE a sigil, so protect its publication/request INSERTs too.
CREATE TRIGGER rpg_exchange_guardian_share BEFORE INSERT ON rpg_shares
WHEN NEW.object_kind='sigil' AND EXISTS(SELECT 1 FROM rpg_guardian_sigils WHERE id=NEW.equip_id AND exchange_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'exchange_guardian_locked'); END;
CREATE TRIGGER rpg_exchange_guardian_request BEFORE INSERT ON rpg_trade_requests
WHEN NEW.object_kind='sigil' AND EXISTS(SELECT 1 FROM rpg_guardian_sigils WHERE id=NEW.equip_id AND exchange_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'exchange_guardian_locked'); END;
-- Protect escrow from older mutation paths as well as new ones. Buy/cancel closes the
-- listing first in its atomic batch, then changes the gear; unrelated trades are untouched.
CREATE TRIGGER rpg_exchange_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN OLD.trade_id LIKE 'exchange:%' AND EXISTS(
 SELECT 1 FROM rpg_exchange_listings WHERE id=substr(OLD.trade_id,10) AND status='active' AND kind='equip' AND ref=OLD.id
)
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;
CREATE TRIGGER rpg_exchange_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN OLD.trade_id LIKE 'exchange:%' AND EXISTS(
 SELECT 1 FROM rpg_exchange_listings WHERE id=substr(OLD.trade_id,10) AND status='active' AND kind='equip' AND ref=OLD.id
)
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;
CREATE TRIGGER rpg_exchange_enhance_start BEFORE INSERT ON rpg_auto_enhance
WHEN EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE 'exchange:%')
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;
CREATE TRIGGER rpg_exchange_reroll_start BEFORE INSERT ON rpg_auto_reroll
WHEN EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE 'exchange:%')
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;
CREATE TRIGGER rpg_exchange_enhance_resume BEFORE UPDATE OF status,item_id ON rpg_auto_enhance
WHEN NEW.status IN ('running','processing') AND EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE 'exchange:%')
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;
CREATE TRIGGER rpg_exchange_reroll_resume BEFORE UPDATE OF status,item_id ON rpg_auto_reroll
WHEN NEW.status IN ('running','processing') AND EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE 'exchange:%')
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;
