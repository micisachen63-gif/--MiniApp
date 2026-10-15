-- New/pristine database initializer ONLY; never apply this file to a populated production database.
-- Existing databases require the separately reviewed atomic data-preserving expansion and migration tracking.
-- Execute this complete migration atomically. Foreign keys and CHECK constraints remain enabled.
-- The first statement is read-only and errors before any DDL when any affected row or sequence history exists.
SELECT json(CASE WHEN NOT EXISTS (SELECT 1 FROM "rpg_characters")
  AND NOT EXISTS (SELECT 1 FROM "rpg_equipment")
  AND NOT EXISTS (SELECT 1 FROM "rpg_exchange_listings")
  AND NOT EXISTS (SELECT 1 FROM "rpg_guardian_operations")
  AND NOT EXISTS (SELECT 1 FROM "rpg_guardian_sigils")
  AND NOT EXISTS (SELECT 1 FROM "rpg_guardian_voucher_grants")
  AND NOT EXISTS (SELECT 1 FROM "rpg_guardian_welcome")
  AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name IN ('rpg_characters','rpg_equipment','rpg_exchange_listings','rpg_guardian_operations','rpg_guardian_sigils','rpg_guardian_voucher_grants','rpg_guardian_welcome'))
  THEN 'true' ELSE 'thief_empty_initializer_requires_pristine_database' END);

-- drop-trigger: collection_blessing_keep_delete
DROP TRIGGER "collection_blessing_keep_delete";

-- drop-trigger: collection_blessing_keep_update
DROP TRIGGER "collection_blessing_keep_update";

-- drop-trigger: collection_blessing_owner
DROP TRIGGER "collection_blessing_owner";

-- drop-trigger: collection_blessing_party
DROP TRIGGER "collection_blessing_party";

-- drop-trigger: guardian_grant_guard
DROP TRIGGER "guardian_grant_guard";

-- drop-trigger: guardian_grant_no_delete
DROP TRIGGER "guardian_grant_no_delete";

-- drop-trigger: guardian_grant_no_update
DROP TRIGGER "guardian_grant_no_update";

-- drop-trigger: guardian_grant_resources
DROP TRIGGER "guardian_grant_resources";

-- drop-trigger: guardian_sigil_delete_guard
DROP TRIGGER "guardian_sigil_delete_guard";

-- drop-trigger: guardian_sigil_delete_revision
DROP TRIGGER "guardian_sigil_delete_revision";

-- drop-trigger: guardian_sigil_insert_revision
DROP TRIGGER "guardian_sigil_insert_revision";

-- drop-trigger: guardian_sigil_party_delete
DROP TRIGGER "guardian_sigil_party_delete";

-- drop-trigger: guardian_sigil_party_update
DROP TRIGGER "guardian_sigil_party_update";

-- drop-trigger: guardian_sigil_transfer_guard
DROP TRIGGER "guardian_sigil_transfer_guard";

-- drop-trigger: guardian_sigil_update_revision
DROP TRIGGER "guardian_sigil_update_revision";

-- drop-trigger: guardian_welcome_guard
DROP TRIGGER "guardian_welcome_guard";

-- drop-trigger: guardian_welcome_no_delete
DROP TRIGGER "guardian_welcome_no_delete";

-- drop-trigger: guardian_welcome_no_update
DROP TRIGGER "guardian_welcome_no_update";

-- drop-trigger: guardian_welcome_resources
DROP TRIGGER "guardian_welcome_resources";

-- drop-trigger: rpg_auto_enhance_equipment_delete
DROP TRIGGER "rpg_auto_enhance_equipment_delete";

-- drop-trigger: rpg_auto_enhance_equipment_update
DROP TRIGGER "rpg_auto_enhance_equipment_update";

-- drop-trigger: rpg_auto_reroll_equipment_delete
DROP TRIGGER "rpg_auto_reroll_equipment_delete";

-- drop-trigger: rpg_auto_reroll_equipment_update
DROP TRIGGER "rpg_auto_reroll_equipment_update";

-- drop-trigger: rpg_exchange_enhance_resume
DROP TRIGGER "rpg_exchange_enhance_resume";

-- drop-trigger: rpg_exchange_enhance_start
DROP TRIGGER "rpg_exchange_enhance_start";

-- drop-trigger: rpg_exchange_equipment_delete
DROP TRIGGER "rpg_exchange_equipment_delete";

-- drop-trigger: rpg_exchange_equipment_update
DROP TRIGGER "rpg_exchange_equipment_update";

-- drop-trigger: rpg_exchange_guardian_claim
DROP TRIGGER "rpg_exchange_guardian_claim";

-- drop-trigger: rpg_exchange_guardian_delete
DROP TRIGGER "rpg_exchange_guardian_delete";

-- drop-trigger: rpg_exchange_guardian_request
DROP TRIGGER "rpg_exchange_guardian_request";

-- drop-trigger: rpg_exchange_guardian_share
DROP TRIGGER "rpg_exchange_guardian_share";

-- drop-trigger: rpg_exchange_guardian_update
DROP TRIGGER "rpg_exchange_guardian_update";

-- drop-trigger: rpg_exchange_reroll_resume
DROP TRIGGER "rpg_exchange_reroll_resume";

-- drop-trigger: rpg_exchange_reroll_start
DROP TRIGGER "rpg_exchange_reroll_start";

-- drop-table-leaf-first: rpg_guardian_welcome
DROP TABLE "rpg_guardian_welcome";

-- drop-table-leaf-first: rpg_guardian_voucher_grants
DROP TABLE "rpg_guardian_voucher_grants";

-- drop-table-leaf-first: rpg_guardian_sigils
DROP TABLE "rpg_guardian_sigils";

-- drop-table-leaf-first: rpg_guardian_operations
DROP TABLE "rpg_guardian_operations";

-- drop-table-leaf-first: rpg_exchange_listings
DROP TABLE "rpg_exchange_listings";

-- drop-table-leaf-first: rpg_equipment
DROP TABLE "rpg_equipment";

-- drop-table-leaf-first: rpg_characters
DROP TABLE "rpg_characters";

-- create-table-parent-first: rpg_characters
CREATE TABLE rpg_characters (
  tg_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tg_name TEXT,
  gender TEXT NOT NULL CHECK (gender IN ('m','f')),
  base_class TEXT NOT NULL CHECK (base_class IN ('mage','sword','archer','thief')),
  class_path TEXT NOT NULL DEFAULT '',
  pending_tier INTEGER,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 120),
  exp INTEGER NOT NULL DEFAULT 0 CHECK (exp >= 0),
  hp INTEGER NOT NULL,
  mp INTEGER NOT NULL,
  map_id INTEGER NOT NULL DEFAULT 1,
  idle_state TEXT NOT NULL DEFAULT 'fighting' CHECK (idle_state IN ('fighting','no_mp','town_no_red','reviving','gate')),
  state_until INTEGER,
  auto_red_pct INTEGER NOT NULL DEFAULT 50 CHECK (auto_red_pct BETWEEN 20 AND 80),
  auto_blue INTEGER NOT NULL DEFAULT 1,
  gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
  last_settle_at INTEGER NOT NULL,
  last_daily_gold_day TEXT,
  penalty_day TEXT,
  penalties_today INTEGER NOT NULL DEFAULT 0,
  drop_day TEXT,                       -- Taipei day of drops_today (idle scroll daily caps)
  drops_today TEXT,                    -- JSON {scroll_w,scroll_a,scroll_r}
  deaths_total INTEGER NOT NULL DEFAULT 0,
  last_reselect_at INTEGER,
  boss_down_until INTEGER,
  ladder_points INTEGER NOT NULL DEFAULT 100,
  pvp_wins INTEGER NOT NULL DEFAULT 0,
  pvp_losses INTEGER NOT NULL DEFAULT 0,
  created_day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0
, tg_username TEXT, account_tg_id TEXT, char_slot INTEGER NOT NULL DEFAULT 1 CHECK (char_slot BETWEEN 1 AND 4), special_json TEXT NOT NULL DEFAULT '{}', party_id TEXT, idle_combat_json TEXT, guardian_draw_remainder INTEGER NOT NULL DEFAULT 0
 CHECK(guardian_draw_remainder BETWEEN 0 AND 4), collection_active_map INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(collection_active_map)='integer' AND collection_active_map BETWEEN 0 AND 12));

-- create-table-parent-first: rpg_equipment
CREATE TABLE "rpg_equipment" (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('weapon','helmet','armor','gloves','boots','belt','undershirt','earring','ring')),
  kind TEXT NOT NULL,
  class_req TEXT NOT NULL CHECK (class_req IN ('mage','sword','archer','any','thief')),
  branch_req TEXT CHECK (branch_req IS NULL OR branch_req IN ('A','B')),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 12),
  level_req INTEGER NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'shop',
  base_stat INTEGER NOT NULL,
  bonus_json TEXT,
  element TEXT,
  element_stat INTEGER NOT NULL DEFAULT 0,
  element_tier TEXT NOT NULL DEFAULT 'common',
  enhance_level INTEGER NOT NULL DEFAULT 0,
  is_equipped INTEGER NOT NULL DEFAULT 0 CHECK (is_equipped BETWEEN 0 AND 2),
  convert_token INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  grade TEXT NOT NULL DEFAULT 'normal' CHECK (grade IN ('normal','relic')),
  affix_json TEXT,
  bound INTEGER NOT NULL DEFAULT 0,
  trade_id TEXT, affixes_json TEXT NOT NULL DEFAULT '[]',
  CHECK (trade_id IS NULL OR is_equipped = 0)
);

-- create-table-parent-first: rpg_exchange_listings
CREATE TABLE rpg_exchange_listings (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 seller_account TEXT NOT NULL, seller_char TEXT NOT NULL, buyer_char TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('equip','item','guardian')), ref TEXT NOT NULL,
 qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 99999),
 price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 1000000),
 fee INTEGER NOT NULL CHECK(fee=(price+19)/20),
 category TEXT NOT NULL CHECK(category IN ('equipment','scroll','collection','skillbook','other','guardian')),
 class_req TEXT NOT NULL CHECK(class_req IN ('any','sword','archer','mage','thief')), tier INTEGER CHECK(tier BETWEEN 1 AND 12),
 quality TEXT, enhance INTEGER, snapshot_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','sold','cancelled')),
 rev INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 closed_at INTEGER, CHECK(kind='item' OR qty=1)
);

-- create-table-parent-first: rpg_guardian_operations
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

-- create-table-parent-first: rpg_guardian_sigils
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
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL, exchange_id TEXT REFERENCES rpg_exchange_listings(id),
 CHECK(active=0 OR bound=1),
 CHECK(trade_id IS NULL OR (active=0 AND bound=0 AND locked=0))
);

-- create-table-parent-first: rpg_guardian_voucher_grants
CREATE TABLE rpg_guardian_voucher_grants (
 account_id TEXT NOT NULL REFERENCES rpg_accounts(account_tg_id),
 boss_id TEXT NOT NULL REFERENCES rpg_boss_instances(id),
 day TEXT NOT NULL,
 recipient_char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,boss_id),
 CHECK(day=date(created_at/1000,'unixepoch','+8 hours'))
);

-- create-table-parent-first: rpg_guardian_welcome
CREATE TABLE rpg_guardian_welcome (
 account_id TEXT PRIMARY KEY REFERENCES rpg_accounts(account_tg_id),
 recipient_char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 draws INTEGER NOT NULL DEFAULT 200 CHECK(draws=200),
 created_at INTEGER NOT NULL
);

-- restore-index: idx_guardian_grants_day
CREATE INDEX idx_guardian_grants_day ON rpg_guardian_voucher_grants(account_id,day);

-- restore-index: idx_guardian_one_active
CREATE UNIQUE INDEX idx_guardian_one_active ON rpg_guardian_sigils(char_id) WHERE active=1;

-- restore-index: idx_guardian_operations_owner
CREATE INDEX idx_guardian_operations_owner ON rpg_guardian_operations(char_id,created_at,operation_id);

-- restore-index: idx_guardian_owner
CREATE INDEX idx_guardian_owner ON rpg_guardian_sigils(char_id,created_at,id);

-- restore-index: idx_guardian_trade
CREATE INDEX idx_guardian_trade ON rpg_guardian_sigils(trade_id) WHERE trade_id IS NOT NULL;

-- restore-index: idx_rpg_characters_account
CREATE INDEX idx_rpg_characters_account ON rpg_characters(account_tg_id, char_slot);

-- restore-index: idx_rpg_characters_account_slot
CREATE UNIQUE INDEX idx_rpg_characters_account_slot ON rpg_characters(account_tg_id, char_slot);

-- restore-index: idx_rpg_characters_username
CREATE INDEX idx_rpg_characters_username ON rpg_characters(tg_username COLLATE NOCASE);

-- restore-index: idx_rpg_equipment_owner
CREATE INDEX idx_rpg_equipment_owner ON rpg_equipment(tg_id, is_equipped);

-- restore-index: idx_rpg_equipment_trade
CREATE INDEX idx_rpg_equipment_trade ON rpg_equipment(trade_id) WHERE trade_id IS NOT NULL;

-- restore-index: rpg_exchange_active
CREATE INDEX rpg_exchange_active ON rpg_exchange_listings(status,seq DESC);

-- restore-index: rpg_exchange_category
CREATE INDEX rpg_exchange_category ON rpg_exchange_listings(status,category,seq DESC);

-- restore-index: rpg_exchange_class
CREATE INDEX rpg_exchange_class ON rpg_exchange_listings(status,class_req,seq DESC);

-- restore-index: rpg_exchange_equipment
CREATE UNIQUE INDEX rpg_exchange_equipment ON rpg_exchange_listings(ref) WHERE status='active' AND kind='equip';

-- restore-index: rpg_exchange_guardian
CREATE UNIQUE INDEX rpg_exchange_guardian ON rpg_exchange_listings(ref) WHERE status='active' AND kind='guardian';

-- restore-index: rpg_exchange_history
CREATE INDEX rpg_exchange_history ON rpg_exchange_listings(seller_account,seq DESC);

-- restore-index: rpg_exchange_quality
CREATE INDEX rpg_exchange_quality ON rpg_exchange_listings(status,quality,seq DESC);

-- restore-index: rpg_exchange_seller
CREATE INDEX rpg_exchange_seller ON rpg_exchange_listings(seller_account,status,seq DESC);

-- restore-index: rpg_exchange_tier
CREATE INDEX rpg_exchange_tier ON rpg_exchange_listings(status,tier,seq DESC);

-- restore-index: rpg_guardian_exchange
CREATE UNIQUE INDEX rpg_guardian_exchange ON rpg_guardian_sigils(exchange_id) WHERE exchange_id IS NOT NULL;

-- restore-trigger: collection_blessing_keep_delete
CREATE TRIGGER collection_blessing_keep_delete BEFORE DELETE ON rpg_inventory
WHEN OLD.item LIKE 'collection_%' BEGIN
 SELECT RAISE(ABORT,'collection_active_owned') WHERE EXISTS(
  SELECT 1 FROM rpg_characters WHERE tg_id=OLD.tg_id AND collection_active_map>0 AND OLD.item='collection_'||collection_active_map);
END;

-- restore-trigger: collection_blessing_keep_update
CREATE TRIGGER collection_blessing_keep_update BEFORE UPDATE OF quantity,item,tg_id ON rpg_inventory
WHEN OLD.item LIKE 'collection_%' AND (NEW.quantity<1 OR NEW.item<>OLD.item OR NEW.tg_id<>OLD.tg_id) BEGIN
 SELECT RAISE(ABORT,'collection_active_owned') WHERE EXISTS(
  SELECT 1 FROM rpg_characters WHERE tg_id=OLD.tg_id AND collection_active_map>0 AND OLD.item='collection_'||collection_active_map);
END;

-- restore-trigger: collection_blessing_owner
CREATE TRIGGER collection_blessing_owner BEFORE UPDATE OF collection_active_map ON rpg_characters
WHEN NEW.collection_active_map<>OLD.collection_active_map AND NEW.collection_active_map>0 BEGIN
 SELECT RAISE(ABORT,'collection_not_owned') WHERE NOT EXISTS(
  SELECT 1 FROM rpg_inventory WHERE tg_id=NEW.tg_id AND item='collection_'||NEW.collection_active_map AND quantity>0);
END;

-- restore-trigger: collection_blessing_party
CREATE TRIGGER collection_blessing_party BEFORE UPDATE OF collection_active_map ON rpg_characters
WHEN NEW.collection_active_map<>OLD.collection_active_map AND OLD.party_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'collection_party_locked');
END;

-- restore-trigger: guardian_grant_guard
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

-- restore-trigger: guardian_grant_no_delete
CREATE TRIGGER guardian_grant_no_delete BEFORE DELETE ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,'guardian_grant_immutable');
END;

-- restore-trigger: guardian_grant_no_update
CREATE TRIGGER guardian_grant_no_update BEFORE UPDATE ON rpg_guardian_voucher_grants BEGIN
 SELECT RAISE(ABORT,'guardian_grant_immutable');
END;

-- restore-trigger: guardian_grant_resources
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

-- restore-trigger: guardian_sigil_delete_guard
CREATE TRIGGER guardian_sigil_delete_guard BEFORE DELETE ON rpg_guardian_sigils
 WHEN OLD.active=1 OR OLD.locked=1 OR OLD.trade_id IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'guardian_sigil_protected'); END;

-- restore-trigger: guardian_sigil_delete_revision
CREATE TRIGGER guardian_sigil_delete_revision AFTER DELETE ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=OLD.char_id;
END;

-- restore-trigger: guardian_sigil_insert_revision
CREATE TRIGGER guardian_sigil_insert_revision AFTER INSERT ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.updated_at WHERE tg_id=NEW.char_id;
END;

-- restore-trigger: guardian_sigil_party_delete
CREATE TRIGGER guardian_sigil_party_delete BEFORE DELETE ON rpg_guardian_sigils
 WHEN EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=OLD.char_id AND party_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'guardian_party_locked'); END;

-- restore-trigger: guardian_sigil_party_update
CREATE TRIGGER guardian_sigil_party_update BEFORE UPDATE ON rpg_guardian_sigils
 WHEN EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=OLD.char_id AND party_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'guardian_party_locked'); END;

-- restore-trigger: guardian_sigil_transfer_guard
CREATE TRIGGER guardian_sigil_transfer_guard BEFORE UPDATE OF char_id ON rpg_guardian_sigils
 WHEN NEW.char_id<>OLD.char_id AND (OLD.active=1 OR OLD.bound=1 OR OLD.locked=1)
 BEGIN SELECT RAISE(ABORT,'guardian_transfer_protected'); END;

-- restore-trigger: guardian_sigil_update_revision
CREATE TRIGGER guardian_sigil_update_revision AFTER UPDATE ON rpg_guardian_sigils BEGIN
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.updated_at WHERE tg_id=OLD.char_id OR tg_id=NEW.char_id;
END;

-- restore-trigger: guardian_welcome_guard
CREATE TRIGGER guardian_welcome_guard BEFORE INSERT ON rpg_guardian_welcome BEGIN
 SELECT RAISE(ABORT,'guardian_welcome_locked') WHERE NOT EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=NEW.recipient_char_id
  AND account_tg_id=NEW.account_id AND level>=15);
END;

-- restore-trigger: guardian_welcome_no_delete
CREATE TRIGGER guardian_welcome_no_delete BEFORE DELETE ON rpg_guardian_welcome BEGIN SELECT RAISE(ABORT,'guardian_welcome_immutable'); END;

-- restore-trigger: guardian_welcome_no_update
CREATE TRIGGER guardian_welcome_no_update BEFORE UPDATE ON rpg_guardian_welcome BEGIN SELECT RAISE(ABORT,'guardian_welcome_immutable'); END;

-- restore-trigger: guardian_welcome_resources
CREATE TRIGGER guardian_welcome_resources AFTER INSERT ON rpg_guardian_welcome BEGIN
 INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(NEW.recipient_char_id,'guardian_free_normal',NEW.draws)
 ON CONFLICT(tg_id,item) DO UPDATE SET quantity=quantity+excluded.quantity;
 INSERT INTO rpg_ledger(event_id,tg_id,type,item,item_delta,note,created_at)
 VALUES('guardian-welcome:'||NEW.account_id,NEW.recipient_char_id,'守護神初見贈禮','guardian_free_normal',NEW.draws,'首次進入；免費普通召喚',NEW.created_at);
 UPDATE rpg_characters SET rev=rev+1,updated_at=NEW.created_at WHERE tg_id=NEW.recipient_char_id;
END;

-- restore-trigger: rpg_auto_enhance_equipment_delete
CREATE TRIGGER rpg_auto_enhance_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=OLD.id AND status='running')
BEGIN SELECT RAISE(ABORT,'auto_enhance_locked'); END;

-- restore-trigger: rpg_auto_enhance_equipment_update
CREATE TRIGGER rpg_auto_enhance_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_enhance WHERE item_id=OLD.id AND status='running')
BEGIN SELECT RAISE(ABORT,'auto_enhance_locked'); END;

-- restore-trigger: rpg_auto_reroll_equipment_delete
CREATE TRIGGER rpg_auto_reroll_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=OLD.id AND status='running')
BEGIN SELECT RAISE(ABORT,'auto_reroll_locked'); END;

-- restore-trigger: rpg_auto_reroll_equipment_update
CREATE TRIGGER rpg_auto_reroll_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN EXISTS(SELECT 1 FROM rpg_auto_reroll WHERE item_id=OLD.id AND status='running')
BEGIN SELECT RAISE(ABORT,'auto_reroll_locked'); END;

-- restore-trigger: rpg_exchange_enhance_resume
CREATE TRIGGER rpg_exchange_enhance_resume BEFORE UPDATE OF status,item_id ON rpg_auto_enhance
WHEN NEW.status IN ('running','processing') AND EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE 'exchange:%')
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;

-- restore-trigger: rpg_exchange_enhance_start
CREATE TRIGGER rpg_exchange_enhance_start BEFORE INSERT ON rpg_auto_enhance
WHEN EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE 'exchange:%')
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;

-- restore-trigger: rpg_exchange_equipment_delete
CREATE TRIGGER rpg_exchange_equipment_delete BEFORE DELETE ON rpg_equipment
WHEN OLD.trade_id LIKE 'exchange:%' AND EXISTS(
 SELECT 1 FROM rpg_exchange_listings WHERE id=substr(OLD.trade_id,10) AND status='active' AND kind='equip' AND ref=OLD.id
)
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;

-- restore-trigger: rpg_exchange_equipment_update
CREATE TRIGGER rpg_exchange_equipment_update BEFORE UPDATE ON rpg_equipment
WHEN OLD.trade_id LIKE 'exchange:%' AND EXISTS(
 SELECT 1 FROM rpg_exchange_listings WHERE id=substr(OLD.trade_id,10) AND status='active' AND kind='equip' AND ref=OLD.id
)
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;

-- restore-trigger: rpg_exchange_guardian_claim
CREATE TRIGGER rpg_exchange_guardian_claim BEFORE UPDATE OF exchange_id ON rpg_guardian_sigils
WHEN NEW.exchange_id IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,'exchange_guardian_locked') WHERE NEW.bound<>0 OR NEW.active<>0 OR NEW.locked<>0 OR NEW.trade_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=NEW.exchange_id AND status='active' AND kind='guardian' AND ref=NEW.id AND seller_char=NEW.char_id);
END;

-- restore-trigger: rpg_exchange_guardian_delete
CREATE TRIGGER rpg_exchange_guardian_delete BEFORE DELETE ON rpg_guardian_sigils
WHEN OLD.exchange_id IS NOT NULL AND EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=OLD.exchange_id AND status='active' AND kind='guardian' AND ref=OLD.id)
BEGIN SELECT RAISE(ABORT,'exchange_guardian_locked'); END;

-- restore-trigger: rpg_exchange_guardian_request
CREATE TRIGGER rpg_exchange_guardian_request BEFORE INSERT ON rpg_trade_requests
WHEN NEW.object_kind='sigil' AND EXISTS(SELECT 1 FROM rpg_guardian_sigils WHERE id=NEW.equip_id AND exchange_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'exchange_guardian_locked'); END;

-- restore-trigger: rpg_exchange_guardian_share
CREATE TRIGGER rpg_exchange_guardian_share BEFORE INSERT ON rpg_shares
WHEN NEW.object_kind='sigil' AND EXISTS(SELECT 1 FROM rpg_guardian_sigils WHERE id=NEW.equip_id AND exchange_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'exchange_guardian_locked'); END;

-- restore-trigger: rpg_exchange_guardian_update
CREATE TRIGGER rpg_exchange_guardian_update BEFORE UPDATE ON rpg_guardian_sigils
WHEN OLD.exchange_id IS NOT NULL AND EXISTS(SELECT 1 FROM rpg_exchange_listings WHERE id=OLD.exchange_id AND status='active' AND kind='guardian' AND ref=OLD.id)
BEGIN SELECT RAISE(ABORT,'exchange_guardian_locked'); END;

-- restore-trigger: rpg_exchange_reroll_resume
CREATE TRIGGER rpg_exchange_reroll_resume BEFORE UPDATE OF status,item_id ON rpg_auto_reroll
WHEN NEW.status IN ('running','processing') AND EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE 'exchange:%')
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;

-- restore-trigger: rpg_exchange_reroll_start
CREATE TRIGGER rpg_exchange_reroll_start BEFORE INSERT ON rpg_auto_reroll
WHEN EXISTS(SELECT 1 FROM rpg_equipment WHERE id=NEW.item_id AND trade_id LIKE 'exchange:%')
BEGIN SELECT RAISE(ABORT,'exchange_equipment_locked'); END;
