# AGENTS.md — 星穹旅誌 (Star Journal RPG) 智能代理開發與協同規範

> 本檔案專為所有 AI 助理（CODEX、Antigravity、Claude Code、Cursor 等）設計。  
> 任何 AI 載入此專案時，應優先閱讀本規範與 `AI_HANDOVER.md`。

## 正式機與 GitHub 同步（使用者於 2026-10-15 指定）

唯一開發來源為 `https://github.com/micisachen63-gif/--MiniApp`，本機工作目錄為此倉庫。先 fetch 最新 main，再在 `codex/` 分支實作；不可從舊營運自動化薄副本、歷史 candidate 或爆分監控快照直接部署覆蓋新功能。

完成相關測試、提交並推送／合併 GitHub 後，從乾淨且等於 origin/main 的提交執行根目錄 `npm run deploy:worker` 或 `npm run deploy:bot`。流程會建置、執行既有服務測試、檢查正式版本未漂移、標記 Git commit、發布、核對實際 runtime/public 與健康狀態，並把版本對應紀錄提交推送至 `docs/deployment/`。只有最後 GitHub push 與線上驗證都成功，才可回報「已同步」。主分支 push 本身不會自動發布。

`npm run sync:check` 是唯讀正式環境核對及本機 dry-run 建置，不發布、不更動玩家。先 `npm ci`；Wrangler 固定於根目錄 package-lock.json。核對腳本的 public 檢查範圍寫入收據，不得宣稱初次接管已重新下載驗證所有歷史二進位素材。UI 改動仍須自行完成相應畫面／動作驗收。

正式版本、namespace 與 Git commit 的有效對應以 `docs/deployment/*.json` 和即時 Cloudflare 狀態為準；下方與其他歷史文件內固定版本號只作歷史參考。合法來源漂移要先合併、重驗，不能還原舊版讓檢查通過。保留完整 public、遠端秘密、DB／DO namespace、service bindings 與各服務 cron；不啟動歷史 bot/ 長輪詢，不順便跑 D1 migrations。

部署工具異常退出或收據 push 失敗時，保留 `.release-sync/`，先用 `sync:check` 查明 live 狀態，禁止自動重部署。若正式版本正確，只補齊驗證紀錄並正常提交推送，不為了寫收據再發布一次。

## 正式環境與 GitHub 同步（使用者於 2026-10-15 明確要求）

- 開發唯一來源為本倉庫 `https://github.com/micisachen63-gif/--MiniApp`。不得再從舊的「爆分監控／星穹旅誌」目錄或歷史快照修改、部署正式程式。
- 開工先確認 `origin`、目前分支、工作區與遠端最新提交。保留其他人的未提交修改；有分歧時先整合，禁止強推、硬重置或用整包舊檔覆蓋。
- 每次功能修正均需完成相關驗證、提交並推送對應程式與必要素材，再從該筆已提交的內容部署受影響服務。不得把未提交的功能混入正式發布。
- 發布前再次檢查工作區；若有其他開發中的修改，使用該筆提交的獨立乾淨 checkout/worktree 發布。新建分支使用 `codex/` 前綴。
- 遊戲／Mini App 部署 `worker/` 的 `elf-rpg-api`；TG BOT 部署 `cloud-bot/` 的 `star-journal-rpg-bot`。只部署本次受影響的服務。歷史 `bot/` 不得啟動長輪詢，也不得與 Webhook 同時接收訊息。
- 成功發布後，核對正式健康檢查、受影響資產或功能入口、Cloudflare 生效版本及流量比例；記錄「Git commit SHA → 服務名稱 → Cloudflare version ID → 驗證結果」。涉及設定時，同時核對既有 D1、Durable Object namespace、Service Binding、群組與排程。
- GitHub 推送或正式部署任一步驟失敗，明確回報哪一端尚未同步；不得把「本機完成」或「檔案已上傳」當作兩端同步完成。不得以重啟舊服務或重新 seed 玩家／TG 狀態處理發布失敗。
- 金鑰、登入資料、玩家與 Telegram 執行期狀態不進 Git。資料庫資料與遠端 Secrets 沿用正式環境，不做檔案式覆蓋同步。
- 本規範為後續開發與發布流程；僅調整文件時不需為此重發遊戲或 BOT。

---

## 🏛️ 專案總體架構速查

本專案為 **100% 雲端化** 的 Telegram RPG 服務，由兩個 Cloudflare Worker 協同驅動：

1. **`worker/` (`elf-rpg-api`)**：
   - 核心遊戲引擎（戰鬥、裝備、鍛造、背包、職業分支、掛機結算）
   - Telegram WebApp Mini App 前端（位於 `worker/public/`）
   - Cloudflare D1 資料庫：`elf-rpg` (ID: `bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4`)
   - Durable Objects 協調器：`AutoEnhanceRunner`
   - 目前線上正式版本：以 `docs/deployment/elf-rpg-api.json` 及即時 Cloudflare 狀態為準。

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
