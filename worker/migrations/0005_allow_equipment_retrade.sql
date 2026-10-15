-- Equipment may be transferred repeatedly. Active escrow is still protected by
-- rpg_equipment.trade_id plus the guarded UPDATE in trade.js; historical trade
-- rows must not reserve an equipment id forever.
DROP INDEX IF EXISTS idx_rpg_trade_items_equip;
