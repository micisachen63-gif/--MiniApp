-- Keep all historical trade lines and share/request identifiers; extend the
-- existing escrow engine with a guardian subtype, never another marketplace.
CREATE TABLE rpg_trade_items_guardian (
 trade_id TEXT NOT NULL,
 side TEXT NOT NULL CHECK(side IN ('a','b')),
 kind TEXT NOT NULL CHECK(kind IN ('equip','item','sigil')),
 ref TEXT NOT NULL,
 qty INTEGER NOT NULL DEFAULT 1 CHECK(qty>0),
 snapshot_json TEXT,
 PRIMARY KEY(trade_id,side,kind,ref)
);
INSERT INTO rpg_trade_items_guardian SELECT * FROM rpg_trade_items;
DROP TABLE rpg_trade_items;
ALTER TABLE rpg_trade_items_guardian RENAME TO rpg_trade_items;
ALTER TABLE rpg_shares ADD COLUMN object_kind TEXT NOT NULL DEFAULT 'equip' CHECK(object_kind IN ('equip','sigil'));
ALTER TABLE rpg_trade_requests ADD COLUMN object_kind TEXT NOT NULL DEFAULT 'equip' CHECK(object_kind IN ('equip','sigil'));
