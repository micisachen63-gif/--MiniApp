# 🤖 星穹旅誌 (Star Journal RPG) - AI 專案續行交接手冊 (AI_HANDOVER.md)

2026-10-19 遠征背包全盤修正：天使合成／回收／解綁、交易所三類物品完整買賣取回、雙人天使全流程、手動／自動洗屬性、材料與技能書兌換／學習／分享均支援真實running遠征。保留穿戴／啟用／託管／綁定交易保護；使用者確認綁定天使仍可合成及商店回收。必要0031只替換兩個舊guardian party trigger，不重建表、不盲跑歷史migration；先查正式trigger與帳本再精準套用。27項新回歸含全部舊資料保留、12h戰鬥及30份獎勵一致；接手先讀docs/STAR_RING_INVENTORY_ACCESS_20261019.txt。僅Worker發布，正式狀態看deployment-records與即時schema。


2026-10-19 CI與發布工具交接：原始碼走PR及「Worker and BOT tests」必要檢查合入main，不可直接push／繞過；CI只測試、不自動部署。正式收據權威位置改為origin/deployment-records:docs/deployment/*.json，main同名檔保留歷史快照，不再回寫。發布／sync:check讀專用分支，補收據用receipts:record:worker／bot，禁止為了收據重發正式機。先讀AGENTS.md及docs/CI_AND_RELEASE_RECORDS_20261019.txt；本次開發工具改動不需部署遊戲／BOT。

2026-10-19 轉蛋新增qty（1..9999、舊客戶端預設1），數量／總價視窗及原子整批購買；遠征中允許未穿戴未綁定背包裝備與可交易道具掛賣，實際membership及提交SQL guard雙重驗證、當趟快照／戰力／收益不變。守護天使及前景短隊原限制保留。新增17項回歸、完整Mini App隔離遠征角色手機尺寸購買／入庫／上架驗收；讀docs/GACHA_BULK_RING_MARKET_20261019.txt。僅Worker，無migration／BOT改動，正式版本看最新收據。

2026-10-19 遠征期間開放未穿戴、未交易背包裝備的手動／自動強化，真實running membership驗證、當趟快照／戰力／12h全部收益不變；穿戴及前景短戰限制保留。交易另修主動開窗漏接、雙方完整重鑄／遺物／附加屬性、最終確認offerRev及成交歷史快照。新增20+5項回歸、隔離雙人桌機／手機尺寸流程驗收；接手讀docs/STAR_RING_BACKPACK_ENHANCE_20261019.txt、docs/TRADE_WINDOW_FIX_20261019.txt。僅Worker、無migration／BOT改動，正式版本與完整測試看部署收據；CI／按需載入／素材保存仍為後續項目。

2026-10-19 打寶／爬塔改用原定deadline補齊5/15秒回合，不因離線排程30秒節奏逐回合延後或舊30分鐘牆鐘逾時；每分鐘Worker獨立sweep直接發獎、缺獎重試，整隊多回合原子保存／一次扣藍水／圖卡合併。新增14項離在線對照、技能／喝水／跨層／併發／排程測試，相關62項通過，無migration／BOT改動。接手讀docs/PARTY_OFFLINE_CLOCK_20261019.txt，正式版本看收據。

2026-10-19 並行補驗：打寶／爬塔各六次前景戰鬥跨完整12h，逐段與單獨遠征比對戰鬥與全部獎勵完全一致；背包加總、防重、前景HP/MP/state/presence保護均通過。共63相關測試、正式runtime與排程唯讀核對完成，僅新增測試／文件、不重發。見docs/STAR_RING_PARALLEL_VERIFICATION_20261019.txt。

2026-10-19 遠征頁新增打寶／爬塔快捷鍵，兩頁可一鍵返回同一遠征戰況（含唯讀通知角色與已結束戰報）；保留前景短隊、換角色清除回程、舊讀取失效化。桌機／手機尺寸隔離API實際往返驗收完成。詳docs/STAR_RING_SHORTCUTS_20261019.txt；僅Worker、無migration，正式版本看收據。

2026-10-19 同角色可於已啟程的星環遠征期間參加打寶／爬塔：running遠征暫借前景presence，短隊結束／離隊／逾時後原子恢復仍有效遠征。遠征結算保留前景HP/MP/party_id，完成／撤退不清掉另一場短隊；兩邊清單可並存，普通掛機仍暫停。v1/v2/v3既有隊伍即時適用，無migration、不重置、不變獎勵配方。接手讀docs/STAR_RING_PARALLEL_PARTY_20261019.txt；僅Worker發布，版本看收據。


2026-10-19 星環遠征v3：新建隊伍增加實際擊倒菁英／首領獵賞（最高額外144分鐘基準經驗、6普通卷、12綁定星冕核心、1低機率直接必成卷）。60核心自選武器／防具必成卷；v1/v2隊伍維持原收益，36組v2戰鬥與全員收益hash保護，原combat/loot RNG不變。核心原創alpha圖、雙幣兌換、待入袋／已入袋、BOT私人完成獎勵名稱已接齊。接手讀 docs/STAR_RING_RANK_REWARDS_20261019.txt 及經濟量測JSON；不跑migration、不重置玩家。正式發布看兩服務收據。


2026-10-19 星環遠征v2擴充48個身份：每圖2普通／1菁英／1既有首領、36隻新原創16姿勢alpha怪，伺服器獨立seed依波數／時間選種，離線及線上同源；v1歷史36個完整階段hash保持一致。新建隊伍用v2，既有隊伍維持v1，無migration、無重設次數／收益。前端rank／已遇清單、舊敵倒地→新敵進場，並補每小時system-only換圖時英雄不停播。接手讀docs/STAR_RING_MONSTER_POOLS_20261019.txt；美術／像素／桌手機驗收在docs/art/STAR_RING_POOL_*，正式發布看Worker收據。

2026-10-19 星環戰鬥顯示補修：五人／魔物持續播放交戰演出，首beat不再空等，擊倒接下一波進場；server view提供spawn投影，保留v1模擬、RNG、收益與存檔。終章不重生，隱藏／減少動態停播；原20秒同步不變。詳docs/STAR_RING_COMBAT_PLAYBACK_20261019.txt，發布看Worker收據。

2026-10-19 星環遠征補上群組招募圖卡：建立／狀態變更以原子outbox排程，同房間更新原卡、合併待送版本、準確ring deep link、圖片拒絕fallback與不確定結果防重。原先只有完成DM，沒有開隊通知。先BOT後Worker發布，保留藥水設定；無migration。詳docs/STAR_RING_RECRUIT_NOTICE_20261019.txt，版本看兩服務收據。

2026-10-18 三款遠征足下光環新增地面旋轉：曙星32秒順轉、月潮38秒逆轉、星蝕28秒順轉，衣櫥與戰場共用，保持足下定位，減少動態時停轉。驗收與接手見docs/art/STAR_RING_AURA_ROTATION_20261018.txt；僅前端CSS與快取版本，無DB／BOT改動，正式版本看收據。

2026-10-18 自動洗屬性修正：完整鎖定且已達標的能力不再讓剩餘詞條誤判完成；所選能力都已鎖住時，依設定品質判斷剩餘每條。種類鎖仍會洗品質；費用／預算不變。接手讀docs/AUTO_REROLL_LOCKS_FIX_20261018.txt；無migration或BOT改動，發布看正式收據。

2026-10-18 星環外觀補齊：三款角色綁定純視覺足下光環、徽記兌換／預覽／穿卸、四職業武器與防具／飾品原創圖，接至武裝／掛機／英雄殿堂／三人副本／五人遠征。接手讀docs/STAR_RING_COSMETICS_HANDOVER_20261018.txt；0030僅新增兩表，禁止盲跑所有migration。正式發布看最新收據。

2026-10-18 星環遠征已完成實作與驗收：神戰→組隊新增40級起、每10級解鎖、五個真帳號、每角色台北日一次、固定12小時；12張原創地圖逐張交GROK生成影片，每小時換圖/換全新怪，每2小時六次原子結算。12怪皆真4×4/16幀去背動作，桌機/手機尺寸24景核可；角色動作contain校準與局部特效縮放只對新玩法啟用。完整Worker1605/Bot153測試通過、隔離HTTP走完12h/30份收益/5次私人完成通知/兌換防重。保留已上線組隊大廳43dc2fd。接手先讀docs/STAR_RING_HANDOVER_20261018.txt，美術/GROK/畫面QA在docs/art/STAR_RING_*；部署狀態只看最新兩服務收據。0029僅新增七表，遠端26–28帳本歷史缺口不可盲目migrations apply。

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


## 2026-10-18 命運旅章真實統計參照

十國 v8/v9 的生活卡、預設收合圖表、原幣轉台幣、UBS/WHO/UNESCO來源與日期、PNG/TG圖卡/文案共用狀態已補齊。固定快照與方法限制詳見 `docs/fate/WORLD_COMPARISON_HANDOVER_20261018.txt`；勿將分組占比誤稱個人百分位。正式部署仍以兩服務收據為準。


## 2026-10-18 命運旅章私訊分流補強

一般fate_event連舊group佇列也只走私訊，重新核對權威帳號；403不回退群組。只有fate_social與fate_cast保留群組，詳見 `docs/fate/PRIVATE_NOTIFICATIONS_20261018.txt`。
