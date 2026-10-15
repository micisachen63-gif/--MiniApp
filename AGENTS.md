# AGENTS.md — 星穹旅誌 (Star Journal RPG) 智能代理開發與協同規範

> 本檔案專為所有 AI 助理（CODEX、Antigravity、Claude Code、Cursor 等）設計。  
> 任何 AI 載入此專案時，應優先閱讀本規範與 `AI_HANDOVER.md`。

---

## 🏛️ 專案總體架構速查

本專案為 **100% 雲端化** 的 Telegram RPG 服務，由兩個 Cloudflare Worker 協同驅動：

1. **`worker/` (`elf-rpg-api`)**：
   - 核心遊戲引擎（戰鬥、裝備、鍛造、背包、職業分支、掛機結算）
   - Telegram WebApp Mini App 前端（位於 `worker/public/`）
   - Cloudflare D1 資料庫：`elf-rpg` (ID: `bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4`)
   - Durable Objects 協調器：`AutoEnhanceRunner`
   - 目前線上正式版本：`49a27728-4b6a-4020-ba96-4b542165d332` @ 100%

2. **`cloud-bot/` (`star-journal-rpg-bot`)**：
   - Telegram 雲端機器人（Webhook 24h 駐留接收）
   - 透過 Cloudflare Service Binding (`RPG_API`) 與 `elf-rpg-api` 內部直連通訊
   - Durable Objects：`BotCoordinator`（持久儲存訊息狀態與定時任務）
   - 內建 WASM resvg + gifenc 即時繪製戰鬥動畫與隊伍大卡

3. **`bot/`**：
   - 歷史長輪詢本機版機器人（已遷移至 `cloud-bot/`，留作參考備份）

---

## 🛡️ 開發與修改嚴格原則

1. **不可破壞生產資料庫**：
   - 嚴禁執行破壞性 D1 migration（如 DROP TABLE、TRUNCATE），除非使用者有明確指令。
2. **零機密外洩**：
   - 絕對不可將 `*.local.json`、真實 `BOT_TOKEN`、`SERVICE_SECRET` 寫入程式碼或提交至 Git。
   - 所有 Cloudflare 遠端秘密均已配置在雲端，`wrangler.toml` 設有 `keep_vars = true`。
3. **保持高階美術資產完整性**：
   - `worker/public/art` 包含全角色 1~4 轉美術圖鑑與動畫粒子，修改代碼時不可誤刪資產。

---

## 🚀 常用指令

- **測試遊戲規則**：`npm run test:worker`
- **測試機器人流程**：`npm run test:bot`
- **部署遊戲 Worker**：`npm run deploy:worker`
- **部署雲端 Bot**：`npm run deploy:bot`

詳細上下文與版本演進請參閱：[`AI_HANDOVER.md`](./AI_HANDOVER.md) 與 [`docs/HOME_DEVELOPMENT_GUIDE.md`](./docs/HOME_DEVELOPMENT_GUIDE.md)。
