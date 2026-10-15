2026-10-15：正式開發來源已轉移至本 Monorepo。遵守根目錄 AGENTS.md 的 GitHub／正式同步流程，以 docs/deployment/star-journal-rpg-bot.json 和即時 Cloudflare 為準。從根目錄 npm run deploy:bot 發布；下方固定版本號、舊營運自動化路徑為歷史交接，不能回放舊 release 或啟動 bot/ 長輪詢。

[RPG_CLOUD_BOT_COMPLETE_20261014]
TG BOT已正式移到Cloudflare star-journal-rpg-bot（5777547e-15a8-4f6e-a3c2-df4183ce360c@100），原遊戲elf-rpg-api仍95407746-ab1e-47cb-8730-1de9033f9f9a@100完全保留。讀 C:\Users\User\Documents\ChatGPT\營運自動化/rpg-seal-20261014/最新接手入口.txt 及 C:\Users\User\Documents\ChatGPT\營運自動化\cloud-bot-migration-20261014/雲端BOT完成與接手.txt。Cloudflare webhook+SQLite BotCoordinator接收/去重/通知、ServiceBinding原gameAPI、WASM完整GIF/圖卡；本機consumer停止、stop-request保持，不得service.mjs start。遠端secret私密，無新訂閱/玩家遷移/流量壓測。此段覆蓋下面舊cloud HOLD/尚未遷移描述；前版封存不回放。
[/RPG_CLOUD_BOT_COMPLETE_20261014]

本目錄為正式雲端BOT；勿部署遊戲不完整Git public、勿從本機再接收TG。秘密与TG狀態不入版本控制。
