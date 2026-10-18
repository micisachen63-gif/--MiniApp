# 🤖 星穹旅誌 (Star Journal RPG) - AI 專案續行交接手冊 (AI_HANDOVER.md)

2026-10-16 使用者要求臺灣完成後接續其餘國家：九國城市先行包v9已完成整合（JP/KR/US/CA/GB/DE/FR/AU/IN），新增13,500日常、108職涯／432專屬抉擇、216人際鏈、54共同故事與9張原創手繪插畫。含自營/受雇/無薪家務分流、不可改寫既有紀事、跨國前三世避重與共同期限雙方涵蓋。接手先讀 docs/fate/COUNTRY_PACKS_V9_HANDOVER_20261016.txt；發布看部署收據。金額為各國貨幣劇情帳，全球分位/台幣換算未宣稱完成。


2026-10-16 命運旅章 v8 台灣雙北先行包已完成實作：1,718 則在地日常＋20 則幼年、16 職涯／170 章、90 種條件抉擇、六篇在地共同支線與新手繪分享圖。新世四內容組避開前三世、保留公開碼確定重播；生活欄位只顯示實際發生狀態。舊人生不換版。範圍／驗證／圖片提示與接手見 `docs/fate/TAIWAN_V8_HANDOVER_20261016.txt`。這是雙北先行包，其他九國仍鎖定，完整人際長鏈與真實統計校準未宣稱完成。使用者要求台灣完成後接續其餘國家，依十國計畫逐一實作與驗收。發布狀態看部署收據。

2026-10-16 新輪迴改用v7條件抉擇：26種情境、每世不同題數／次序／間隔，前因會關閉後續路線；出生性別、因果極端分流、帶年齡的終章時間軸與第4～9次BOT通知均已整合。v1–v5現有存檔照原配方完成。接手見 `docs/fate/V7_CONDITIONAL_HANDOVER_20261016.txt`；正式狀態仍看部署收據。十國是規劃，未開放國別真人生，見 `docs/fate/countries/COUNTRY_ROADMAP_20261016.txt`，未發布v6統計原型留在獨立分支，勿整包部署。

2026-10-16 交織命運補修：通知入口等待真實inbox後定位受邀選項；解決回答與舊inbox請求競爭；固定截止後雙方重疊進行中的人生都收到安全故事後果，歷史不因24小時被抹掉。星座移至標題右側正常排版，375px內頁驗收無遮擋。細節與驗證見 `docs/fate/DUAL_FOLLOWUP_20261016.txt`。本補修沒有更改v5三幕時間引擎；使用者已指出僅微調年齡不符需求，後續須新版本條件事件引擎，不可原地改寫舊人生。

2026-10-16 命運旅章v5新增固定兩小時內的不同終年與事件時點、300則日常紀事、160篇連續故事及24組重大抉擇，保留舊v3／v4人生。新舊重播契約、驗證與接手見 `docs/fate/V5_TIMING_CONTENT_20261016.txt`；v5正式發布後不可原地改seed時序或擴／重排同版catalog，須以新版保護舊紀錄。

2026-10-16「交織命運」已完成實作：六種雙人支線、獨立本世邀請／預設關閉的受邀設定、真人指定角色回覆、固定敘事後果、雙方群提及與防重；並修正通知停掛機首頁、待答定位及BOT積壓延遲。最新接手規則與驗證見 `docs/fate/SHARED_CHOICES_HANDOVER_20261016.txt`；下方僅評估段落屬歷史，正式發布仍以部署JSON及Cloudflare核對為準。

2026-10-16 星座＋輪迴身分分享圖（PNG／TG JPEG）、勾選隱私與可重現驗證見 `docs/fate/ZODIAC_SHARE_20261016.txt`。雙人代選支線目前僅評估，未啟用；設計與權限／通知必要條件見 `docs/fate/SHARED_CHOICES_ASSESSMENT_20261016.txt`。

2026-10-16 命運旅章分享、啟程出生時間、四世星輝匣/真正100%必成卷、其他玩家暱稱社交鏈，接手與實測界線見 `docs/fate/SHARING_GIFTS_HANDOVER_20261016.txt`、`docs/fate/SOCIAL_CAST.txt`。iPhone/Android原生相簿/IG附圖必須實機驗收，不得將契約測試當實測。發布狀態仍以最新部署收據為準。

2026-10-16 命運旅章第一期的正式人生、雲端旅誌、任務解鎖提醒、出生檔案、架空年鑑、
手繪終章與TG事件通知已完成整合。規則、測試與低強度模型接手步驟見
`docs/fate/FORMAL_HANDOVER.txt`、內容量測見 `docs/fate/NARRATIVE_V4.txt`。
是否已發布仍以 `docs/deployment/*.json` 與即時Cloudflare為準；先前預覽文件屬歷史記錄。

> **致接手的 AI 助手（無論在哪台電腦）**：  
> 本手冊包含「星穹旅誌」截至 2026-10-15 的最新架構狀態、線上版本、部署流程與開發規範。  
> 閱讀本文件後，你將具備與前任助理 100% 相同的專案上下文，請立即接續使用者需求提供支援。

> 2026-10-15 使用者要求後續以本 GitHub 倉庫開發並與正式機同步。請先讀 AGENTS.md 的「正式機與 GitHub 同步」及 docs/deployment/*.json；本文固定版本號為歷史資料。根目錄 npm run deploy:worker／deploy:bot 已改為 GitHub 提交與線上版本的同步流程，勿再直接執行子目錄 wrangler deploy 繞過核對。只需核對時執行 npm run sync:check。推送 main 不會自動上線。

---

## 2026-10-15 審查修正分支

2026-10-16 已加入四職業後期三人職責機制（含盜賊）、90／105／120級打寶與三四轉試煉、高層25／30層塔王；配隊匹配、15秒機制回合、實際戰技、破陣護甲、TG及手機介面、舊場次相容與接手驗證見 `docs/class-combat/LATE_PARTY_ROLES_HANDOVER.txt`。下方「後期配隊另一期」屬歷史記錄；正式是否已發布仍以最新部署收據為準。

2026-10-16 後續已修正既有帳號新增角色的通行證誤擋，並實作盜賊24個三／四轉專精。最新接手文件為 `docs/thief/ADVANCEMENT_AND_CREATION_HANDOVER.txt`，包含正式HMAC創角、收據重試、各模式戰鬥與UI驗證；下段上線後審查所列的高階缺口屬歷史狀態。

2026-10-16 盜賊正式上線後核對與漏接修正見 `docs/thief/POST_RELEASE_AUDIT.txt`。本次補齊自動洗屬性攻擊目標及交易所職業／近戰天使篩選；盜賊三、四轉仍沿用二轉能力，勿將外觀完成誤認為玩法專精完成。發布狀態以最新 docs/deployment 收據為準。

`codex/review-remediation` 修復交易部分取回道具遺失、統一完整測試、補 Bot 積壓／uncertain 核對與發布互斥，並加入現有三職業 72 條三四轉數值專精與成長樹真實數值。詳細範圍、驗證及低強度模型接手步驟見 `docs/class-combat/REVIEW_REMEDIATION_HANDOVER.txt`。完整資源累積／手動戰技與後期配隊副本仍屬另一期；人物／盜賊由其他視窗處理。此段不是發布收據，正式啟用仍以 docs/deployment 與即時 Cloudflare 為準。

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


## 2026-10-18 星輝必成卷專屬粉光圖

100% 武器／防具卷新增透明粉光素材，背包、強化與輪迴禮開匣同步；祝福卷保留金光。詳見 `docs/art/GUARANTEED_SCROLL_PINK_20261018.txt`，正式版本以部署收據為準。
