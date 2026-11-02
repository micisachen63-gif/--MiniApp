# POE 掛機重構：2026-11-02 接續檢查點

## 使用者確認與目前狀態

本分支 `codex/poe-realms-preserve-progress` 從 `origin/main` 的 `3c6729aa9167223a3a915c5dc19fcc075cbad0ed` 開始。使用者先前對話遺失，提供的文字包含歷史工作進度，不能把那些文字當作本分支已通過的測試，尤其不能宣稱完整季末移轉已找回。

目標是一個永久環境、一個當期賽季環境，以及有配裝取捨、刷圖、製作與長期目標的 POE 掛機玩法。永久環境必須有新玩法引導及長期任務。

**硬性限制：所有現有角色資料保留；道具能力可以重新平衡，每件裝備的強化值 +N 不得更動。** 保留金幣、材料、天使、收藏、輪迴、技能、裝備歸屬及其他進度，包含 +0 裝備與強化紀錄。此次不藉調整既有強化曲線讓 +N 名義保留、實質歸零。天使抽取／管理、旅章／輪迴、鍛造、組隊、交易與圖鑑繼續使用原服務。

本分支尚未部署，沒有執行遠端 migration 或改寫正式玩家。`ATLAS_ENABLED` 預設關閉，沒有變更正式 Wrangler binding，也沒有建立正式季庫。

## 已實作的可驗收範圍

| 模組 | 行為 |
| --- | --- |
| Realm 路由 | 永久與賽季使用不同 D1；新 Atlas API 要求 `X-Realm-Id`；未知 ID、header/body 不一致及錯綁 DB 均拒絕 |
| 身分與階段 | 不可重用的季 ID、database token、nonce 登記；提交時驗證 identity／phase／fence；季庫不可回退為永久 |
| 背景工作 | 強化、重鑄、天使自動操作的 DO 使用環境名稱與不可重綁身分；舊工作固定永久；凍結或錯綁時停 alarm |
| 星圖試作 | 四職各三流派、六輔助、三自動施放策略、三教學圖與一首領；伺服器固定快照及 seed |
| 離線結算 | 最長八小時、最多 96 圖、單次最多 2,000 引擎步；不同分段得到相同結果；狀態、報酬、材料與收據同交易 |
| 補給與停止 | 使用原背包紅藍水，出發保留、結束退還未用部分；停止時間不可延後；季末只計到 cutoff |
| 互斥與重試 | 同帳號同環境一趟主要出征；阻擋切角、刪角與組隊競爭；Atlas 時間不再產生同段普通掛機收益 |
| 定向製作 | 三配方、每件最多三次；能力允許清單；保留每件 +N、歸屬、穿戴及養成版本；沿用託管與作業鎖 |
| 永久任務 | 18 個定義、帳號進度與唯一領獎；真實事件與原操作一起提交；換角、連點、斷線不重發 |
| 前端 | 常駐營地、六導航、天使／旅章快捷與共同浮層；環境／角色 epoch 防護；季服 pending storage 與永久隔離 |

技能、地圖、配方與任務報酬均標記 **prototype**。原裝備能力未做全庫重算，既有強化公式未改。不同流派傷害、藥費及淨收益仍有差距，不能宣稱完成正式玩家平衡。

## 永久任務

| 類型 | 任務 | 持續性 |
| --- | --- | --- |
| 教學 | 儲存流派、首次出征、首次通關、首次製作、首次首領 | 每帳號一次；右上追蹤區帶到下一目標 |
| 每日 | 工坊整備、指定主題星圖 | 今天與前兩天已完成的獎勵可補領 |
| 每週 | 三種主題、三種實際通關流派 | DISTINCT 計數；前一週補領至本週結束 |
| 長期 | 三圖各 10／50 次踏查、首領 3／15 次、累計 100 張 | 不隨日界週界清除；只要求已開放內容 |

事件時間為 `(startedAt + reward.elapsedSeconds) * 1000`，按台北日／ISO 週分類，不以登入補算時間代替。改下一趟配置不會算成已通關另一流派。`account + quest + period` 唯一領取，材料入首次成功領取角色；跨角重試顯示原 `rewardCharacterId`。目前只給少量 Atlas 材料，未加連續登入懲罰或全局戰力倍率。

後續仍需高階星圖、首領變體、獨特裝備與長期製作目標。這 18 個任務不代表完整終局已完成。

## 正式機證據與尚缺資料

2026-11-01 23:58 UTC 的唯讀公開檢查：`/health` 回 HTTP 200、`ok:true`。四個文字入口 `app.js`、`index.html`、`request-client.js`、`styles.css` 正規化 CRLF 後與上述 main 一致。這不等於後端 runtime 或全部歷史美術素材驗證。

已 fetch `origin/deployment-records`，最新遊戲收據：2026-10-29 03:19:42 UTC、source commit 為上述 main、production version `d2695468-4c75-4aa7-9e7c-eb9b57303a00`。它是歷史收據，並非本次即時控制台版本查詢。

**正式 D1 角色及經濟聚合尚未取得。** CLI 沒有已配置 Cloudflare 憑證；管理頁需登入，轉到 Google 後自動批准審核拒絕觀察該網域，需使用者明確授權登入步驟後續接。沒有把模擬數據冒充正式玩家基線。

唯讀工具 `worker/tools/realm-economy-baseline.mjs` 涵蓋角色／職業／等級、金幣分位數、裝備品質與 +N、背包、七天帳本流入流出、收益／死亡／藥水及既有進度。見 [REALM_ECONOMY_BASELINE.md](REALM_ECONOMY_BASELINE.md)。正式匯出不放 Git，不包含玩家姓名、Telegram ID、訊息或裝備實例 ID。

## 季末移轉尚未完成

目前僅驗證 `ACTIVE → FREEZE → DRAIN → SEALED → IMPORTING → COMPLETE` 的順序、fence 及證據雜湊格式；一般服務僅允許 ACTIVE 寫入。**尚無維護 drain、封存 manifest、跨 D1 匯入、溢出角色 slot 或取出專用倉庫的完整實作。** 呼叫 transition 並傳入任意雜湊不等於資產已移轉。因此不可正式啟用賽季。

待完成並在隔離環境驗證：

1. 凍結新增工作；既有出征、背景作業、組隊及交易託管收尾到同一 cutoff，維護權限不可暴露給正常服務。
2. 逐類定義保留／季限轉換清單，完整保存角色、關聯 ID 與每件 +N，不覆寫永久原資料。
3. 封存 manifest，目的端分批新增隔離實體與唯一收據；每個提交點中斷、重跑與來源完成標記失敗都不複製資產。
4. 原永久四角色加季末四角色全部保留；超出建立上限仍能看見／選用，不能因四格 UI 或 slot 限制丟失。
5. 帳號級核對後才開放轉入資料，既有永久角色繼續可玩。
6. Cloud Bot、群組通知、跨世界分享與季末管理入口需另外驗收 Realm 合約；本次未修改或發布 BOT。

## 驗證與接續

核心服務整合目前 51 案例通過：Atlas service 23、永久任務 20、HTTP Realm 8。Realm 身分／phase／migration／背景及基線工具亦有獨立測試。完整 Worker／BOT 與 browser 最後結果見下方驗證區；SQLite 隔離驗證不是正式 D1 查詢。

```sh
npm ci
npm test
node --test --test-isolation=none --test-reporter=tap worker/test/atlas-service.test.js worker/test/atlas-quests.test.js worker/test/realm-api.test.js
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config worker/wrangler.toml --outdir /tmp/poe-worker-build
```

本次沙箱的 Node test 子程序會只報檔案級一個 case，而未執行檔內案例。針對性測試使用 `--test-isolation=none`；完整 `npm test` 必須在允許正常子程序的環境執行並檢查實際案例數。不得修改 runner、刪除失敗測試或跳過 BOT 來取得綠燈。

`worker/test/atlas-browser.mjs` 用本機 HTTP、真服務、隔離 SQLite 驗收 1280×960 與 390×844：天使抽取及啟用、生日輸入、技能／組隊入口、Atlas 補給／停止／去重／製作、永久任務連點領獎及環境切換。結果與截圖存 `.release-sync/atlas-ui/`。需要本機 Playwright Chromium；可用 `ATLAS_BROWSER_EXECUTABLE` 指定已安裝瀏覽器。這不是 Telegram 原生容器或手機實機測試。

## 後續發布順序

先取得正式聚合，建立代表配裝的收益、藥費、存活與完成時間比較，確認高強化玩家的投入仍有可感知效果；再完成季末移轉與進階玩法。依正式 schema 審核 0035、0036、0037 的精確新增內容；migration 需獨立規劃備份與授權，不得對現有缺漏登記直接全量 apply。

停用 `ATLAS_ENABLED` 不刪除資料；已有出征仍能結算、停止與退還補給，已成功收據仍可重播。更新規則不得替換既有進行中的快照。

依 AGENTS.md 經 PR 與「Worker and BOT tests」gate 合入後，仍須從乾淨且等於最新 `origin/main` 的 checkout 使用根目錄發布流程。draft PR、dry-run 或 CI 成功都不代表正式已上線；不得直接部署本工作分支或自動套用遠端 SQL。
