[RPG_CLOUD_BOT_COMPLETE_20261014]
TG BOT已正式移到Cloudflare star-journal-rpg-bot（5777547e-15a8-4f6e-a3c2-df4183ce360c@100），原遊戲elf-rpg-api仍95407746-ab1e-47cb-8730-1de9033f9f9a@100完全保留。讀 C:\Users\User\Documents\ChatGPT\營運自動化/rpg-seal-20261014/最新接手入口.txt 及 C:\Users\User\Documents\ChatGPT\營運自動化\cloud-bot-migration-20261014/雲端BOT完成與接手.txt。Cloudflare webhook+SQLite BotCoordinator接收/去重/通知、ServiceBinding原gameAPI、WASM完整GIF/圖卡；本機consumer停止、stop-request保持，不得service.mjs start。遠端secret私密，無新訂閱/玩家遷移/流量壓測。此段覆蓋下面舊cloud HOLD/尚未遷移描述；前版封存不回放。
[/RPG_CLOUD_BOT_COMPLETE_20261014]

# 星穹旅誌工作指引

旅團日誌（2026-10-13）：最新驗證交接 C:/Users/User/Documents/ChatGPT/營運自動化/rpg-journal-20261013/驗證交接_先讀.txt。共用 rpg-flow.js 新增每日群組照片卡、jc 報到／jv 個人進度 callback；每天08:00後透過原 tick 一次申請 publish，原 outbox 交付。傳送成功先保存訊息 ID，再同步 Worker，重試不再貼第二張卡；領卷在遊戲神戰頁。不可還原舊 adapter 或移除 checked 日期／card ID，亦不可開第二個 getUpdates 程序。原小精靈對接保持停用、BOT雲端化保持 HOLD。

先閱讀 MIGRATION_HANDOFF.md。使用者已於 2026-10-12 明確說「開始吧」，授權正式切換新 BOT 與群組、驗證後停用原小精靈遊戲對接。
切換期間避免其他工作視窗同時部署 Worker；角色素材製作不受影響。完成後部署必須保留新 GROUP_CHAT_ID -1004342516953 與新 BOT_TOKEN。
local.json 為憑證設定，不輸出或提交。準備模式必須不呼叫 RPG tick/outbox、不產生正式遊戲場次。

驗證接手入口（RPG_VERIFY_HANDOFF_20261012）：先讀 C:/Users/User/Documents/ChatGPT/營運自動化/rpg-audit-20261012/驗證交接_先讀.txt。驗證腳本為同目錄 handoff/Verify-Rpg.ps1；預設 Local 只跑記憶體/mock 測試，ReadOnlyWeb 只 GET 公開頁面。Full 會精確辨認既有10項失敗並回 REVIEW_REQUIRED；不是全綠。該 audit 目錄是快照，勿重跑 scripts/apply-*.mjs 或覆蓋後續新工作。

最新動畫／數值同步驗證（RPG_EVENT_SYNC_20261012）：C:/Users/User/Documents/ChatGPT/營運自動化/rpg-sync-20261012/驗證交接_先讀.txt。TG 回放使用伺服器快照的真實傷害／有效治療量與舊樓層敵人上限；既有原生 GIF worker 每個新回合讀最新 renderer，這輪无需重啟 BOT。已發送 GIF 不會回溯重製。雲端化目前 HOLD，使用者要求不得增加費用，未授權升級 Cloudflare／另購主機／切換 webhook。原小精靈遊戲對接不得恢復。

