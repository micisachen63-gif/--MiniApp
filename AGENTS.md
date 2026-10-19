# AGENTS.md — 星穹旅誌 (Star Journal RPG) 智能代理開發與協同規範

> 本檔案專為所有 AI 助理（CODEX、Antigravity、Claude Code、Cursor 等）設計。  
> 任何 AI 載入此專案時，應優先閱讀本規範與 `AI_HANDOVER.md`。

## 正式機與 GitHub 同步（使用者於 2026-10-15 指定）

唯一開發來源為 `https://github.com/micisachen63-gif/--MiniApp`，本機工作目錄為此倉庫。先 fetch 最新 main，再在 `codex/` 分支實作；不可從舊營運自動化薄副本、歷史 candidate 或爆分監控快照直接部署覆蓋新功能。

原始碼必須經 PR 與 GitHub 必要檢查「Worker and BOT tests」合入 main；不得直接 push main 或繞過保護。完成相關測試、合併後，從乾淨且等於 origin/main 的提交執行根目錄 `npm run deploy:worker` 或 `npm run deploy:bot`。流程會建置、執行既有服務測試、檢查正式版本未漂移、標記 Git commit、發布、核對實際 runtime/public 與健康狀態，並把版本對應紀錄追加至 origin/deployment-records 的 `docs/deployment/`。只有收據 push 與線上驗證都成功，才可回報「已同步」。CI 與主分支合併均不會自動部署。

使用 Node 24（驗證版本 24.19.0）及根目錄 npm ci。根目錄／子目錄 npm test 已統一為完整測試；不得為了部署跳過失敗檔案。deploy 指令會在共享 Git common dir 建立 rpg-release.lock，跨 worktree／服務防止同時發布。鎖未釋放時先檢查 owner.json、執行程序及 .release-sync 與正式版本，不能自動刪鎖或繞過 scripts/deploy-locked.mjs。

`npm run sync:check` 是唯讀正式環境核對及本機 dry-run 建置，不發布、不更動玩家。先 `npm ci`；Wrangler 固定於根目錄 package-lock.json。核對腳本的 public 檢查範圍寫入收據，不得宣稱初次接管已重新下載驗證所有歷史二進位素材。UI 改動仍須自行完成相應畫面／動作驗收。

正式版本、namespace 與 Git commit 的有效對應以 origin/deployment-records 分支的 `docs/deployment/*.json` 和即時 Cloudflare 狀態為準；main 內同名 JSON 是切換前的歷史快照，不能作為未來發布基準。先 fetch deployment-records，用 `git show origin/deployment-records:docs/deployment/elf-rpg-api.json` 或 BOT 同名檔讀取；不要 checkout 或部署收據分支。詳見 docs/CI_AND_RELEASE_RECORDS_20261019.txt。合法來源漂移要先合併、重驗，不能還原舊版讓檢查通過。保留完整 public、遠端秘密、DB／DO namespace、service bindings 與各服務 cron；不啟動歷史 bot/ 長輪詢，不順便跑 D1 migrations。

部署工具異常退出或收據 push 失敗時，保留 `.release-sync/`，先用 `sync:check` 查明 live 狀態，禁止自動重部署。若正式版本正確，使用 `npm run receipts:record:worker` 或 `npm run receipts:record:bot` 重新唯讀驗證並補齊收據；這兩個指令不發布 Worker。禁止為了寫收據再部署一次。

多人協作時，開工先確認 origin、分支、工作區與遠端提交。保留其他人的未提交修改；有分歧先整合，禁止強推、硬重置或整包覆蓋。若有其他開發中的修改，使用已提交內容的獨立乾淨 checkout/worktree 發布；分支採 codex/ 前綴。只部署本次受影響的服務。

GitHub 推送或正式部署失敗時，明確回報哪一端尚未同步。不得以重啟舊服務或重新 seed 玩家／TG 狀態處理發布失敗。金鑰、登入資料、玩家與 Telegram 執行期狀態不進 Git；資料庫與遠端 Secrets 不做檔案式覆蓋同步。僅調整文件或開發工具時不需為此重發遊戲或 BOT。

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
