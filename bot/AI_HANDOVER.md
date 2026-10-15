# 星穹旅誌（Star Journal RPG）AI 交接指引與全模組對應手冊

> 📌 **給接手 AI 的最高原則**：
> 1. **服務分立與切換完成**：正式切換與 Cloudflare 雙服務架構已於 2026-10-14 全面生效。
>    - 遊戲 Worker：`elf-rpg-api`（當前版本 `d164e307-7a93-430a-ac8b-0c38636a3611 @100%`）。
>    - 雲端 BOT Worker：`star-journal-rpg-bot`（當前版本 `5777547e-15a8-4f6e-a3c2-df4183ce360c @100%`）。
> 2. **嚴禁洩漏憑證**：嚴禁在對話中輸出、提交或轉載任何 `*.local.json`、`BOT_TOKEN`、`SERVICE_SECRET` 或 Telegram `initData`。
> 3. **BOT 已轉移至 Cloudflare（禁止重啟本機輪詢）**：Telegram Webhook 已切換至雲端 Worker，本機 long-poll 已透過 `state/cloud-migration.json` 安全停止。**嚴禁恢復本機 long-polling 或重啟本機 service.mjs**，以免與雲端 Webhook 競爭。
> 4. **禁止兩服務互相覆蓋**：`elf-rpg-api` 與 `star-journal-rpg-bot` 為獨立 Worker，發布時請分開更新，切勿使用同一份配置覆蓋另一服務。
> 5. **嚴格禁止任意執行 Migration**：D1 既有資料表已上線，嚴禁重新套用歷史遷移腳本、清除正式玩家資料庫或重置抽數/裝備。

---

## 一、系統全景與環境參數

| 項目 | 正式環境設定 | 備註說明 |
| :--- | :--- | :--- |
| **BOT 名稱** | 星穹旅誌 ✨ (`@StarJournalRpgBot`) | Bot ID: `8661366679` |
| **正式超級群組** | 星穹旅誌｜冒險者之庭 🌌 | Supergroup ID: `-1004342516953` |
| **群組邀請連結** | `https://t.me/+5hDQa1rrBv4xMDhl` | 非群組成員無法在私訊開啟遊戲 |
| **Mini App 入口** | `https://t.me/StarJournalRpgBot?start=rpg` | 支援私訊 Menu Button 及 Deep Link |
| **遊戲 Worker** | `https://elf-rpg-api.micisachen.workers.dev` | 託管 Mini App 前端、遊戲 API、素材 (`d164e307`) |
| **雲端 BOT Worker** | `https://star-journal-rpg-bot.micisachen.workers.dev` | 接收 Telegram Webhook、分發指令、渲染動態卡片 (`5777547e`) |
| **Cloudflare D1 資料庫** | `elf-rpg` (`bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4`) | 儲存帳號、角色、裝備、旅團日誌 |
| **Auto Enhance Runner** | Durable Object Namespace: `e9663e6cc0844358893b28f1b613228c` | 自動強化背景排程 |
| **Worker Cron 觸發器** | `* * * * *` (每分排程), `*/30 * * * *` (半小時清理) | 負責戰況更新、定時事件、過期清理 |
| **當前運行節點** | Cloudflare Workers 全雲端架構 | 本機程序已自然停止，免依賴本地網路 |

---

## 二、跨專案目錄與所有模組對應路徑

本系統架構由三大專案目錄共同協同運作：

```
C:/Users/User/Documents/ChatGPT/
├── 星穹旅誌/             # [專案本體] BOT 核心服務、守護進程、獨立測試與美術管線
├── 爆分監控/             # [依賴服務] 共用 RPG 邏輯 (rpg-flow)、Worker 原始碼與正式部署包
└── 營運自動化/           # [維運驗證] 每日委託、審計快照、資料與同步驗證套件
```

### 1. 星穹旅誌 (`C:/Users/User/Documents/ChatGPT/星穹旅誌/`)

| 檔案 / 目錄路徑 | 模組職責與說明 |
| :--- | :--- |
| `service.mjs` | **服務入口進程**。提供 `start`、`stop`、`status`、`run` 指令。管理單一實例鎖定 (`state/service.lock`)、心跳 (`state/heartbeat.json`)、Telegram 輪詢 (`getUpdates`) 及定時 tick (10秒)。 |
| `bot.mjs` | **BOT 訊息分發與驗證**。包含指令設定 (`/start`, `/rpg`, `/group`, `/help`, `/trade`, `/duel`)、群組資格快取檢查 (`isGroupMember`)、Callback 轉發至 `rpg-flow.js`。 |
| `watchdog.mjs` | **守護行程**。每 5 分鐘檢查一次服務狀態，若 `service.lock` 消失且無 `stop-request` 標記，則自動透過 `service.mjs start` 重啟服務。 |
| `launch-watchdog.vbs` | Windows 登入自動啟動腳本，完全隱藏執行視窗，指向 `watchdog.mjs`。已加入 Startup 捷徑。 |
| `game-fetch.mjs` | **原生安全 HTTP 傳輸模組**。強制 IPv4、連線池 (`keepAlive`)、支援 gzip/br/deflate 解壓。針對 GET 具連線重試能力，**嚴禁對非冪等變更請求 (POST/PUT/DELETE) 進行重試**。 |
| `network-ipv4.mjs` | 修正本機 Dual-Stack 網路問題，攔截 DNS 查詢並將 `api.telegram.org` 及 `*.workers.dev` 強制解析為 IPv4。 |
| `telegram-media.mjs` | **媒體優化傳輸層**。將本機發送的大圖轉向讀取 Worker 上已部署的公開網址 (`/telegram-media/`)，大於 200KB 的 PNG 自動壓縮為 92% JPEG 並快取，防止發送逾時。 |
| `publish-telegram-art.mjs` | 部署工具。將 12 隻首領與歡迎圖壓制成 JPEG 並同步至 Worker 的 `public/telegram-media/` 目錄。 |
| `post-welcome.mjs` | 自動於正式群組發送歡迎封面圖並設為置頂訊息。 |
| `post-relocation.mjs` | 於舊群組透過舊小精靈發送搬家公告與新群引導。 |
| `fix-boss-card.mjs` | 群組首領文案修正工具，清理重複卡片與更新獎勵文案。 |
| `verify-backup.mjs` | 記憶體內 SQLite 驗證切換前備份 (`backup/cutover-20261012/elf-rpg.sql`) 之完整性。 |
| `telegram.local.json` | **機密設定**。存放 `botToken`, `chatId`, `botUsername`, `active`, `inviteLink`, `appUrl`。 |
| `rpg.local.json` | **機密設定**。存放 `apiUrl`, `serviceSecret`, `appUrl`, `mainMiniApp`, `enabled`。 |
| `state/` | 執行期狀態：`service.lock`, `heartbeat.json`, `telegram.json` (offset 與卡片紀錄)。 |
| `logs/` | 服務日誌：`service.log`。 |
| `test/` | 本機單元測試：`game-fetch.test.mjs`, `isolation.test.mjs`, `media.test.mjs`。 |
| `tools/` | 人物美術轉職管線：劍士進階職 (sword2, sword3, sword4) 自動打包、生成、QA 與驗收。 |
| `art-work/` | 人物素材與畫格快照 (如 `sword-adv4-20261012/`)。 |
| `assets/` | 頭像與歡迎圖原檔 (`bot-avatar.png`, `group-avatar.png`, `group-welcome.jpg`)。 |

---

### 2. 爆分監控（共用與 Worker 後端）

| 檔案 / 目錄路徑 | 模組職責與說明 |
| :--- | :--- |
| `爆分監控/src/rpg-flow.js` | **TG 互動核心邏輯**。定義所有 `rpg:*` 回調處理、指令回應、裝備卡片生成、首領戰況廣播、出件箱 (`outbox`) 交付。 |
| `爆分監控/src/rpg-api.js` | Worker 溝通客戶端。封裝所有帶有 `X-Service-Secret` 的後端 API 調用。 |
| `爆分監控/src/telegram.js` | Telegram Bot API 底層封裝。 |
| `爆分監控/src/rpg-party-flow.js` | 組隊、副本討伐、爬塔互動處理邏輯。 |
| `爆分監控/src/rpg-pk-animation-flow.js` | 玩家決鬥 (PK) 動畫與群組回放處理。 |
| `爆分監控/src/rpg-boss-card.js` | 首領戰況即時卡片圖片生成器。 |
| `爆分監控/art-runtime/` | 戰鬥動畫影格、首領插畫 (`rpg-boss/`)、裝備卡片底圖、武器與防具圖鑑。 |
| `爆分監控/deploy-staging/elf-rpg-20261008-v051/worker/` | **Cloudflare Worker 部署主目錄**。包含 `wrangler.toml`、後端 API 路由 (`src/routes/`)、業務層 (`src/services/`)、資料庫遷移 (`migrations/`) 與靜態頁面 (`public/`)。 |
| `.../worker/src/services/journal.js` | **每日旅團日誌服務**。負責日誌任務計算、防刷校驗、領獎 revision guard 與交易安全發放。 |
| `.../worker/public/journal.js` | Mini App 每日旅團日誌前端 UI 模組。 |
| `.../worker/migrations/0015_daily_journal.sql` | 旅團日誌資料庫表結構與查詢索引（正式環境已套用）。 |

---

### 3. 營運自動化（審計與驗證目錄）

| 檔案 / 目錄路徑 | 模組職責與說明 |
| :--- | :--- |
| `營運自動化/rpg-journal-20261013/` | **2026-10-13 最新版本驗證交接目錄**。包含最新 baseline、已驗證結果與完整測試腳本。 |
| `.../scripts/Verify-Sync.ps1` | **標準安全驗證腳本**。支援 `-Mode Local`（離線測試，129項全過）與 `-Mode ReadOnlyWeb`（唯讀 GET 公開頁面雜湊校驗）。 |
| `營運自動化/rpg-audit-20261012/` | 切換基準審計紀錄，包含已記錄的既有 10 項已審閱失敗項目。 |
| `營運自動化/rpg-sync-20261012/` | 動畫與伺服器戰鬥數值同步驗證快照。 |

---

## 三、最新功能版本：旅團日誌（2026-10-13 發布）

### 1. 核心玩法與獎勵機制
- **結算時間**：台北時間每日 `00:00` 重置。
- **委託任務（六選三）**：
  1. `今日相逢`：於群組當日登記卡片按報到。
  2. `為你喝采`：為 2 個不同玩家的群組裝備分享按「超讚」。
  3. `並肩討伐`：與其他玩家共同參與當日群組首領討伐（造成傷害 > 0 即可）。
  4. `結伴尋寶`：3 人通關組隊打寶副本，自己至少執行一次成功的手動戰術。
  5. `向星而行`：3 人組隊爬塔，單場累計通關 5 層（手動戰術後計層）。
  6. `分享收穫`：手動分享可交易裝備至群組，並獲得其他帳號點讚。
- **獎勵內容**：
  - 每完成一項自選「武器強化捲」或「防具強化捲」×T（T 為接取時角色之裝備階級）。
  - 完成三項且完成任意一項合作戰鬥，額外獲得同行贈禮 ×T（每日最高 4T 強化捲，不含祝福捲）。
- **帳號限制**：同一個 Telegram 帳號下所有角色共用每日 3 項上限，獎勵統一發放至當日首次確認之綁定角色。

### 2. 每日群組照片卡流程
- 每日上午 `08:00` 後，BOT 原有定時 tick 會向後端申請 `publish`。
- 由 Outbox 生成一筆 `journal_card` 交付給 BOT 發送。
- 發送成功後**先保存訊息 ID 於本機，再同步給 Worker 標記**。
- 若同步失敗，重試時只使用既有訊息 ID，**嚴禁發送第二張卡片**。
- 領卷統一於 Mini App 神戰頁操作，群組卡片只彈出 Callback 通知，不洗版。

---

## 四、AI 接手操作指南（SOP）

### 1. 日常狀態確認
若要確認 BOT 當前運行狀態，直接執行：
```powershell
node service.mjs status
```
*預期回傳*：`{"running":true, "pid":13224, "heartbeat":{...}}`。

### 2. 重啟服務標準流程
若修改了共用模組 (`rpg-flow.js`、`art-runtime/` 或通訊傳輸)，需重啟服務使快取生效：
```powershell
node service.mjs stop
# 等待約 2~3 秒直到程序完全退出
node service.mjs start
```

### 3. 執行本機單元測試
星穹旅誌本機隔離測試（12 項全部通過）：
```powershell
node --test test/game-fetch.test.mjs test/isolation.test.mjs test/media.test.mjs
```

### 4. 執行同步安全驗證
使用專用 PowerShell 執行驗證（禁止使用未經授權的部署指令）：
```powershell
& 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe' -NoProfile -File 'C:/Users/User/Documents/ChatGPT/營運自動化/rpg-journal-20261013/scripts/Verify-Sync.ps1' -Mode Local
```

---

## 五、重大紅線與禁止事項（AI 嚴格防呆）

1. ❌ **禁止洩露金鑰**：切勿輸出 `telegram.local.json`、`rpg.local.json`、API Tokens、Service Secrets。
2. ❌ **禁止重啟舊小精靈對接**：舊小精靈中的 RPG 模組必須永遠為 `enabled: false`，舊群僅保留搬家提示。
3. ❌ **禁止清空或重建資料庫**：D1 資料庫 `elf-rpg` 內有玩家真實資料與進度（220+ 件裝備、掛機資產），嚴禁執行 `DROP TABLE`、無條件 `DELETE` 或覆蓋整個資料庫。
4. ❌ **禁止非冪等 HTTP 重試**：`game-fetch.mjs` 中已嚴格限制，POST 請求若遇網路錯誤絕不可重送，避免重複扣款、重複發裝或領獎併發異常。
5. ❌ **禁止破壞 IPv4 傳輸設定**：本主機環境存有 IPv6 連線重置缺陷，所有對外請求必須使用 IPv4 優先。
6. ❌ **禁止未授權上雲或增加費用**：目前維持本機運行 + 免費額度 Worker，嚴禁升級付費方案或未經許可改裝 Webhook。
