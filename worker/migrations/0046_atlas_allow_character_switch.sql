-- 2026-11-10 owner rule: an account may switch to another character while one
-- character is on a 星圖派遣 (Atlas) run. The run keeps its departure snapshot and
-- is advanced by the cron sweep; inactive characters never farm legacy idle
-- (settleSelectedPlayer skips characters with atlas_run_id). Only this switch
-- guard is removed. Starting a run still requires the selected character, one
-- running run per account, and party/delete guards are unchanged.
DROP TRIGGER IF EXISTS rpg_atlas_character_switch_guard;
