# 🤖 星穹旅誌 (Star Journal RPG) - AI 專案續行交接手冊 (AI_HANDOVER.md)

> **致接手的 AI 助手（無論在哪台電腦）**：  
> 本手冊包含「星穹旅誌」截至 2026-10-15 的最新架構狀態、線上版本、部署流程與開發規範。  
> 閱讀本文件後，你將具備與前任助理 100% 相同的專案上下文，請立即接續使用者需求提供支援。

> 2026-10-15 使用者要求後續以本 GitHub 倉庫開發並與正式機同步。請先讀 AGENTS.md 的「正式機與 GitHub 同步」及 docs/deployment/*.json；本文固定版本號為歷史資料。根目錄 npm run deploy:worker／deploy:bot 已改為 GitHub 提交與線上版本的同步流程，勿再直接執行子目錄 wrangler deploy 繞過核對。只需核對時執行 npm run sync:check。推送 main 不會自動上線。

---

## 一、目前系統線上架構與即時狀態

星穹旅誌已經 **100% 全面雲端化**，由 Cloudflare 上的兩個獨立 Worker 服務支撐，**完全不依賴本機運行**：

### 1. 遊戲核心與 Mini App 服務：`elf-rpg-api`
- **目錄**：`worker/`
- **服務網址**：https://elf-rpg-api.micisachen.workers.dev
- **健康檢查**：`GET /health` -> `{"ok":true,"service":"elf-rpg-api"}`
- **目前線上版本**：以 `docs/deployment/elf-rpg-api.json` 及即時 Cloudflare 狀態為準；下方版本屬歷史紀錄。
- **核心架構**：
  - 後端：Cloudflare Worker (`src/index.js`)，處理戰鬥、裝備、鍛造、掉寶、職業分支、掛機結算。
  - 前端：Telegram WebApp Mini App (`public/`)，包含 7,000+ 個靜態資源與全角色高階傳承美術圖鑑。
  - 資料庫：Cloudflare D1 (`elf-rpg`, ID: `bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4`)。
  - 狀態協調：Durable Objects (`AutoEnhanceRunner`)。

### 2. 雲端 Telegram 機器人：`star-journal-rpg-bot`
- **目錄**：`cloud-bot/`
- **服務網址**：https://star-journal-rpg-bot.micisachen.workers.dev
- **健康檢查**：`GET /health` -> `{"ok":true,"service":"StarJournalRpgBot","mode":"cloud"}`
- **Telegram Webhook**：`https://star-journal-rpg-bot.micisachen.workers.dev/telegram/webhook`
- **核心架構**：
  - 採用 Cloudflare Worker + Durable Objects (`BotCoordinator`) 24 小時駐留監聽 Telegram Webhook。
  - 內建 WASM 動態 GIF 渲染引擎與隊伍卡片生成器 (`src/renderer/`)。
  - 透過 Cloudflare Service Binding (`RPG_API`) 直接與 `elf-rpg-api` 通訊。

### 3. 本機歷史備份：`bot/`
- 舊版 Windows 本機 Node.js 長輪詢服務，已完整遷移至 `cloud-bot/`，留作歷史代碼備份。

---

## 二、最新完成的任務與修改紀錄 (2026-10-14 ~ 10-15)

1. **轉職冷卻時間調整**：
   - 將「命運轉職書」重新選擇職業分支的冷卻時間從 **7 天** 改為 **30 分鐘**。
   - 異動檔案：
     - `worker/src/game/constants.js`: `RESELECT_COOLDOWN_MS = 30 * 60_000;`
     - `worker/src/game/classes.js`: 錯誤提示支援小於 1 小時顯示「剩餘 X 分鐘」。
     - `worker/public/app.js`: 命運轉職書 I 與 II 卡片統一標記「30 分鐘冷卻」。
   - 已完成正式發布與驗證（版本 `49a27728`）。

2. **全角色美術與戰鬥特效完整統一發布**：
   - 劍士、法師、精靈弓箭手 1~4 轉全外觀與戰鬥粒子特效已全量上線。

3. **專案 Monorepo 整合與 GitHub 儲存庫建立**：
   - 倉庫網址：`https://github.com/micisachen63-gif/--MiniApp.git`
   - 機密脫敏：所有 `.local.json` 與實體 Token 均已透過 `.gitignore` 隔離。

---

## 三、在家開發與發布指令指南

接手 AI 請依照下列規範協助使用者開發與發布：

1. **執行測試**：
   - 測試遊戲核心與轉職：`npm run test:worker`
   - 測試機器人適配器：`npm run test:bot`

2. **發布部署**：
   - 在根目錄先 `npm ci`；修改完成並測試、提交／合併及推送 main。
   - 部署遊戲核心/前端：根目錄執行 `npm run deploy:worker`
   - 部署雲端機器人：根目錄執行 `npm run deploy:bot`
   - 必須確認 GitHub 收據推送與線上驗證成功，才算同步完成。

3. **規範約束**：
   - 除非使用者特別要求，否則嚴禁執行未經審查的 D1 破壞性 migration。
   - 遠端 Secrets (`BOT_TOKEN`, `SERVICE_SECRET`) 均已在 Cloudflare 雲端配置，`wrangler.toml` 設有 `keep_vars = true`，部署時會自動保留。
