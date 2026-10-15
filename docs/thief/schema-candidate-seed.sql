-- SYNTHETIC LOCAL FIXTURE ONLY. Contains no player data.
-- Apply after the repository migrations to an empty local test database only.

INSERT INTO "rpg_characters" ("tg_id","name","tg_name","gender","base_class","class_path","pending_tier","level","exp","hp","mp","map_id","idle_state","state_until","auto_red_pct","auto_blue","gold","last_settle_at","last_daily_gold_day","penalty_day","penalties_today","drop_day","drops_today","deaths_total","last_reselect_at","boss_down_until","ladder_points","pvp_wins","pvp_losses","created_day","created_at","updated_at","rev","tg_username","account_tg_id","char_slot","special_json","party_id","idle_combat_json","guardian_draw_remainder","collection_active_map") VALUES ('fixture-sword','測試角色_fixture-sword','synthetic_fixture','m','sword','A111',NULL,120,123456,712,231,12,'fighting',NULL,50,1,456789,1792025345679,'2026-10-14','2026-10-15',2,'2026-10-15','{"scroll_w":17,"relic":1}',7,1792024100000,1792026090000,387,11,3,'2026-09-01',1791936000000,1792025999679,42,'fixture_fixture-sword','fixture-account-a',1,'{"learned":["skill_01_1"],"cooldowns":{"skill_01_1":1792026000001},"loadout":["skill_01_1"]}',NULL,'{"mapId":12,"remainder":0.375,"target":1}',3,12);

INSERT INTO "rpg_characters" ("tg_id","name","tg_name","gender","base_class","class_path","pending_tier","level","exp","hp","mp","map_id","idle_state","state_until","auto_red_pct","auto_blue","gold","last_settle_at","last_daily_gold_day","penalty_day","penalties_today","drop_day","drops_today","deaths_total","last_reselect_at","boss_down_until","ladder_points","pvp_wins","pvp_losses","created_day","created_at","updated_at","rev","tg_username","account_tg_id","char_slot","special_json","party_id","idle_combat_json","guardian_draw_remainder","collection_active_map") VALUES ('fixture-mage','測試角色_fixture-mage','synthetic_fixture','f','mage','A111',NULL,120,123456,712,231,12,'fighting',NULL,50,1,456789,1792025345679,'2026-10-14','2026-10-15',2,'2026-10-15','{"scroll_w":17,"relic":1}',7,1792024100000,1792026090000,387,11,3,'2026-09-01',1791936000000,1792025999679,42,'fixture_fixture-mage','fixture-account-b',1,'{"learned":["skill_01_1"],"cooldowns":{"skill_01_1":1792026000001},"loadout":["skill_01_1"]}',NULL,'{"mapId":12,"remainder":0.375,"target":1}',3,12);

INSERT INTO "rpg_characters" ("tg_id","name","tg_name","gender","base_class","class_path","pending_tier","level","exp","hp","mp","map_id","idle_state","state_until","auto_red_pct","auto_blue","gold","last_settle_at","last_daily_gold_day","penalty_day","penalties_today","drop_day","drops_today","deaths_total","last_reselect_at","boss_down_until","ladder_points","pvp_wins","pvp_losses","created_day","created_at","updated_at","rev","tg_username","account_tg_id","char_slot","special_json","party_id","idle_combat_json","guardian_draw_remainder","collection_active_map") VALUES ('fixture-archer','測試角色_fixture-archer','synthetic_fixture','f','archer','A111',NULL,120,123456,712,231,12,'fighting',NULL,50,1,456789,1792025345679,'2026-10-14','2026-10-15',2,'2026-10-15','{"scroll_w":17,"relic":1}',7,1792024100000,1792026090000,387,11,3,'2026-09-01',1791936000000,1792025999679,42,'fixture_fixture-archer','fixture-account-a',2,'{"learned":["skill_01_1"],"cooldowns":{"skill_01_1":1792026000001},"loadout":["skill_01_1"]}',NULL,'{"mapId":12,"remainder":0.375,"target":1}',3,12);

INSERT INTO "rpg_accounts" ("account_tg_id","active_char_id","updated_at") VALUES ('fixture-account-a','fixture-archer',1792026000000);

INSERT INTO "rpg_accounts" ("account_tg_id","active_char_id","updated_at") VALUES ('fixture-account-b','fixture-mage',1792026000000);

INSERT INTO "rpg_inventory" ("tg_id","item","quantity") VALUES ('fixture-sword','collection_12',1);

INSERT INTO "rpg_inventory" ("tg_id","item","quantity") VALUES ('fixture-sword','red_4',137);

INSERT INTO "rpg_inventory" ("tg_id","item","quantity") VALUES ('fixture-mage','collection_12',1);

INSERT INTO "rpg_inventory" ("tg_id","item","quantity") VALUES ('fixture-mage','red_4',137);

INSERT INTO "rpg_inventory" ("tg_id","item","quantity") VALUES ('fixture-archer','collection_12',1);

INSERT INTO "rpg_inventory" ("tg_id","item","quantity") VALUES ('fixture-archer','red_4',137);

INSERT INTO "rpg_trades" ("id","a_tg","b_tg","status","a_gold","b_gold","a_ok","b_ok","offer_rev","rev","origin","chat_id","message_id","tax_gold","created_at","updated_at","expires_at","closed_at","closed_by","a_lock","b_lock","share_id","request_id") VALUES ('fixture-trade','fixture-sword','fixture-mage','open',71,39,0,0,7,11,'app',NULL,NULL,0,1792025996000,1792025998000,1792026120000,NULL,NULL,1,0,NULL,'fixture-trade-request');

INSERT INTO "rpg_boss_instances" ("id","chat_id","map_id","name","element","base_hp","max_hp","hp","participants","spawn_reason","started_at","ends_at","status","message_chat_id","message_id","result_json","settled_at") VALUES ('fixture-boss',NULL,12,'測試首領','dark',90000,125000,9001,3,'fixture',1792025993000,1792026100000,'active',NULL,NULL,NULL,NULL);

INSERT INTO "rpg_boss_attacks" ("boss_id","tg_id","win","damage","created_at") VALUES ('fixture-boss','fixture-sword',1,5678,1792025999999);

INSERT INTO "rpg_guardian_operations" ("operation_id","account_id","char_id","request_id","action","payload_hash","config_version","cost_json","result_json","created_at") VALUES ('fixture-guardian-operation','fixture-account-a','fixture-sword','fixture-summon-request','summon','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','fixture-v1','{"gold":1234}','{"ids":["fixture-active-guardian"]}',1792026000000);

INSERT INTO "rpg_exchange_listings" ("seq","id","seller_account","seller_char","buyer_char","kind","ref","qty","price","fee","category","class_req","tier","quality","enhance","snapshot_json","status","rev","created_at","updated_at","closed_at") VALUES (10,'fixture-equip-listing','fixture-account-a','fixture-sword',NULL,'equip','fixture-escrow-equipment',1,12345,618,'equipment','sword',12,'legendary',7,'{"name":"完整測試快照","nested":{"roll":0.375}}','active',3,1792025994000,1792025997000,NULL);

INSERT INTO "rpg_exchange_listings" ("seq","id","seller_account","seller_char","buyer_char","kind","ref","qty","price","fee","category","class_req","tier","quality","enhance","snapshot_json","status","rev","created_at","updated_at","closed_at") VALUES (20,'fixture-guardian-listing','fixture-account-a','fixture-sword',NULL,'guardian','fixture-exchange-guardian',1,12345,618,'guardian','any',NULL,'legendary',NULL,'{"name":"完整測試快照","nested":{"roll":0.375}}','active',3,1792025994000,1792025997000,NULL);

INSERT INTO "rpg_guardian_sigils" ("id","char_id","type","quality","bound","active","locked","trade_id","rev","source_operation_id","created_at","updated_at","exchange_id") VALUES ('fixture-active-guardian','fixture-sword','melee',6,1,1,0,NULL,17,'fixture-guardian-operation',1792025999900,1792025999950,NULL);

INSERT INTO "rpg_guardian_sigils" ("id","char_id","type","quality","bound","active","locked","trade_id","rev","source_operation_id","created_at","updated_at","exchange_id") VALUES ('fixture-locked-guardian','fixture-sword','melee',6,0,0,1,NULL,17,'fixture-guardian-operation',1792025999900,1792025999950,NULL);

INSERT INTO "rpg_guardian_sigils" ("id","char_id","type","quality","bound","active","locked","trade_id","rev","source_operation_id","created_at","updated_at","exchange_id") VALUES ('fixture-trade-guardian','fixture-sword','melee',6,0,0,0,'fixture-trade',17,'fixture-guardian-operation',1792025999900,1792025999950,NULL);

INSERT INTO "rpg_guardian_sigils" ("id","char_id","type","quality","bound","active","locked","trade_id","rev","source_operation_id","created_at","updated_at","exchange_id") VALUES ('fixture-exchange-guardian','fixture-sword','melee',6,0,0,0,NULL,17,'fixture-guardian-operation',1792025999900,1792025999950,'fixture-guardian-listing');

INSERT INTO "rpg_guardian_voucher_grants" ("account_id","boss_id","day","recipient_char_id","created_at") VALUES ('fixture-account-a','fixture-boss','2026-10-15','fixture-sword',1792026000000);

INSERT INTO "rpg_guardian_welcome" ("account_id","recipient_char_id","draws","created_at") VALUES ('fixture-account-a','fixture-sword',200,1792026000000);

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-equipped-weapon','fixture-sword','weapon','greatsword','sword','A',12,111,'測試完整裝備_fixture-equipped-weapon','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,1,1,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-equipped-helmet','fixture-sword','helmet','plate','sword',NULL,12,111,'測試完整裝備_fixture-equipped-helmet','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,1,0,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-equipped-armor','fixture-sword','armor','plate','sword',NULL,12,111,'測試完整裝備_fixture-equipped-armor','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,1,0,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-equipped-gloves','fixture-sword','gloves','plate','sword',NULL,12,111,'測試完整裝備_fixture-equipped-gloves','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,1,0,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-equipped-boots','fixture-sword','boots','plate','sword',NULL,12,111,'測試完整裝備_fixture-equipped-boots','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,1,0,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-equipped-belt','fixture-sword','belt','belt','any',NULL,12,111,'測試完整裝備_fixture-equipped-belt','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,1,0,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-equipped-undershirt','fixture-sword','undershirt','undershirt','any',NULL,12,111,'測試完整裝備_fixture-equipped-undershirt','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,1,0,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-equipped-earring-1','fixture-sword','earring','earring','any',NULL,12,111,'測試完整裝備_fixture-equipped-earring-1','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,1,0,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-equipped-earring-2','fixture-sword','earring','earring','any',NULL,12,111,'測試完整裝備_fixture-equipped-earring-2','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,2,0,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-equipped-ring-1','fixture-sword','ring','ring','any',NULL,12,111,'測試完整裝備_fixture-equipped-ring-1','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,1,0,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-equipped-ring-2','fixture-sword','ring','ring','any',NULL,12,111,'測試完整裝備_fixture-equipped-ring-2','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,2,0,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-escrow-equipment','fixture-sword','weapon','greatsword','sword','A',12,111,'測試完整裝備_fixture-escrow-equipment','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,0,1,1792025999223,'relic','{"atk":95}',0,'exchange:fixture-equip-listing','[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-traded-equipment','fixture-sword','weapon','greatsword','sword','A',12,111,'測試完整裝備_fixture-traded-equipment','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,0,1,1792025999223,'relic','{"atk":95}',0,'fixture-trade','[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-enhance-equipment','fixture-sword','weapon','greatsword','sword','A',12,111,'測試完整裝備_fixture-enhance-equipment','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,0,1,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_equipment" ("id","tg_id","slot","kind","class_req","branch_req","tier","level_req","name","source","base_stat","bonus_json","element","element_stat","element_tier","enhance_level","is_equipped","convert_token","created_at","grade","affix_json","bound","trade_id","affixes_json") VALUES ('fixture-reroll-equipment','fixture-sword','armor','plate','sword',NULL,12,111,'測試完整裝備_fixture-reroll-equipment','relic_boss',163,'{"critPct":0.05,"hp":73}','dark',49,'legendary',7,0,0,1792025999223,'relic','{"atk":95}',1,NULL,'[{"key":"meleePct","score":99,"value":0.035}]');

INSERT INTO "rpg_auto_enhance" ("id","owner","tg_id","item_id","item_name","target","blessed","status","reason","level","attempts","spent_gold","spent_scrolls","rev","next_at","created_at","updated_at") VALUES ('fixture-enhance','fixture-account-a','fixture-sword','fixture-enhance-equipment','測試強化',15,1,'running',NULL,7,21,987,36,4,1792026060000,1792025999901,1792025999989);

INSERT INTO "rpg_auto_reroll" ("id","owner","tg_id","item_id","item_name","request_id","config_json","class_snapshot","status","reason","attempts","spent_gold","spent_scrolls","result_json","rev","next_at","created_at","updated_at") VALUES ('fixture-reroll','fixture-account-b','fixture-sword','fixture-reroll-equipment','測試洗鍊','fixture-reroll-request','{"locks":[0]}','sword:A111','running',NULL,11,765,24,'{"score":88}',5,1792026060000,1792025999912,1792025999990);

INSERT INTO "rpg_guardian_auto" ("id","owner","char_id","request_id","pool","draw_count","target_type","target_rank","max_gold","status","reason","match_id","batches","total_draws","spent_gold","spent_vouchers","used_free","counts_json","rev","next_at","seen_at","created_at","updated_at","single_draw") VALUES ('fixture-auto-guardian','fixture-account-a','fixture-sword','fixture-guardian-auto-request','featured',5,'melee',6,9999,'running',NULL,NULL,3,15,1122,2,5,'[0,0,0,0,0,0,0,0]',6,1792026030000,NULL,1792025999945,1792025999991,0);

INSERT INTO "rpg_parties" ("id","leader_id","kind","status","rev","state_json","created_at","updated_at","expires_at","chat_id","message_id") VALUES ('fixture-party','fixture-sword','trial','active',12,'{"enemies":[{"hp":987}]}',1792025999956,1792025999992,1792026120000,NULL,NULL);

INSERT INTO "rpg_party_members" ("party_id","char_id","account_id","ready","joined_at") VALUES ('fixture-party','fixture-sword','fixture-account-a',1,1792025999960);

UPDATE rpg_characters SET party_id='fixture-party' WHERE tg_id='fixture-sword';

INSERT INTO "rpg_admin_audit" ("id","admin_tg_id","action","details","created_at") VALUES ('fixture-audit',NULL,'fixture-review','{"synthetic":true}',1792026000000);

INSERT INTO "rpg_app_access" ("tg_id","granted_at","expires_at") VALUES ('fixture-account-a',1792025999990,1792026100000);

INSERT INTO "rpg_book_trade_operations" ("char_id","request_id","trade_id") VALUES ('fixture-sword','fixture-book-operation','fixture-trade');

INSERT INTO "rpg_class_changes" ("id","tg_id","tier","from_path","to_path","kind","created_at") VALUES (NULL,'fixture-sword',4,'A11','A111','advance',1792025900000);

INSERT INTO "rpg_exchange_operations" ("account_tg_id","request_id","char_id","action","payload_json","result_json","created_at") VALUES ('fixture-account-a','fixture-exchange-operation','fixture-sword','sell','{"fixture":true}','{"id":"fixture-equip-listing"}',1792026000000);

INSERT INTO "rpg_guard" ("ok") VALUES (1);

INSERT INTO "rpg_idle_reports" ("id","tg_id","from_at","to_at","ticks","skipped_ticks","kills","exp_gained","exp_lost","deaths","elites","gold_gained","used_json","drops_json","levels_gained","end_state","created_at") VALUES (NULL,'fixture-sword',NULL,NULL,71,NULL,123,NULL,NULL,NULL,NULL,999,NULL,NULL,NULL,NULL,1792026000000);

INSERT INTO "rpg_journal_cards" ("day","chat_id","message_id") VALUES ('2026-10-15','fixture-chat',777);

INSERT INTO "rpg_journals" ("account_id","day","char_id","tier","checked_at","claims_json","claim_count","bonus_claimed","rev","created_at") VALUES ('fixture-account-a','2026-10-15','fixture-sword',12,NULL,'{"daily":true}',2,0,3,1792026000000);

INSERT INTO "rpg_notice_dismissals" ("account_tg_id","kind","ref_id","created_at") VALUES ('fixture-account-a','guardian_summon','fixture-notice-ref',1792026000000);

INSERT INTO "rpg_outbox" ("id","dedupe_key","target","tg_id","kind","payload_json","created_at","claimed_at","delivered_at","claim_token","claim_attempts","next_attempt_at","failed_at","last_error_code","last_error") VALUES (NULL,'fixture-outbox','group','fixture-sword','fixture','{"notSent":true}',1792026000000,NULL,NULL,NULL,0,0,NULL,NULL,NULL);

INSERT INTO "rpg_party_operations" ("party_id","char_id","request_id","result_json") VALUES ('fixture-party','fixture-sword','fixture-party-operation','{"ok":true}');

INSERT INTO "rpg_party_presence" ("account_id","party_id","char_id") VALUES ('fixture-account-a','fixture-party','fixture-sword');

INSERT INTO "rpg_party_rewards" ("party_id","char_id","reward_json","created_at") VALUES ('fixture-party','fixture-sword','{"gold":123}',1792026000000);

INSERT INTO "rpg_pk" ("id","a_tg","b_tg","status","origin","chat_id","message_id","winner_tg","loser_tg","seed","rounds","log_json","drop_equip_id","drop_json","ward_used","created_at","expires_at","decided_at") VALUES ('fixture-pk','fixture-sword','fixture-mage','pending','app',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,1792026000000,1792026100000,NULL);

INSERT INTO "rpg_share_likes" ("share_id","tg_id","created_at") VALUES ('fixture-share','fixture-mage',1792026000000);

INSERT INTO "rpg_shares" ("id","tg_id","equip_id","kind","snapshot_json","context_json","tradeable","likes","status","chat_id","message_id","created_at","object_kind") VALUES ('fixture-share','fixture-sword','fixture-traded-equipment','share','{"fixture":true}',NULL,1,2,'open',NULL,NULL,1792026000000,'equip');

INSERT INTO "rpg_trade_items" ("trade_id","side","kind","ref","qty","snapshot_json") VALUES ('fixture-trade','a','equip','fixture-traded-equipment',1,'{"enhance":7}');

INSERT INTO "rpg_trade_log" ("id","trade_id","tg_id","action","details","created_at") VALUES (NULL,'fixture-trade','fixture-sword','lock','{"offer_rev":7}',1792026000000);

INSERT INTO "rpg_trade_operations" ("trade_id","tg_id","request_id","result_json","created_at") VALUES ('fixture-trade','fixture-sword','fixture-trade-operation','{"ok":true}',1792026000000);

INSERT INTO "rpg_trade_requests" ("id","share_id","equip_id","owner_tg","requester_tg","status","trade_id","created_at","expires_at","decided_at","object_kind") VALUES ('fixture-request','fixture-share','fixture-traded-equipment','fixture-sword','fixture-mage','accepted','fixture-trade',1792026000000,1792026100000,NULL,'equip');

UPDATE sqlite_sequence SET seq=5000 WHERE name='rpg_exchange_listings';
