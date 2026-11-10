最新續作（2026-11-02）：PR #43 已增加主場景半透明浮窗、四職天賦星盤與引導教學；新出征為 atlas-v3，舊 v1／v2 保留。詳見 docs/ATLAS_TALENTS_SCENE_WINDOWS_20261102.txt。以下保留較早檢查點，不代表新增天賦已部署。

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

**正式 D1 唯讀基線已取得。** 2026-11-02 經使用者明確批准 Wrangler 裝置授權後，已成功查詢現有 `elf-rpg`。11 個必要資料表／檢視與欄位預檢通過；13 類聚合完整取得，所有查詢收據的 `rows_written` 均為 0、`changed_db` 均為 false。事件窗口為 2026-10-26T01:25:47.847Z 至 2026-11-02T01:25:47.847Z；最後查詢完成於 2026-11-02T01:28:47.958Z。現存餘額與裝備是查詢當下值，不是停服快照。原始聚合與收據保存在私有查核資料，不放入 Git。

本次只使用帳號／使用者唯讀及 D1 權限，未取得 Worker 管理權限；因此這次成功不代表重新核對了正式 Worker runtime。Google 網頁登入問題已由獨立的官方命令列裝置授權途徑解決存取需求；後續先確認既有 Wrangler 登入狀態，不需再要求使用者手動貼 SQL。授權是否可用仍依當前工作環境為準。正式資料取得與完成數值校準是不同里程碑；全職業代表配置、收益／消耗與高強化投入的新版重播仍待完成。

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


## 最終驗證紀錄

GitHub 草稿 [PR #42](https://github.com/micisachen63-gif/--MiniApp/pull/42) 已保存本次程式、測試、規格與驗收截圖。被測程式與 GitHub 提交 `9807cee9eddee2c2f33e96dfa34eabc3ec82bdc5` 的 Git tree 完全一致；本地原始兩筆提交另保存在 `codex/poe-realms-local-checkpoint`，沒有強推或改寫 main。

- 完整 `npm test` 成功結束，exit 0：Worker **2,409／2,409**、BOT **205／205**，合計 **2,614**；fail、cancelled、skipped、todo 均為 0。
- 首輪發現的三個失敗來自新增 schema 預期及 BOT metadata 讀取 DB 的相容問題，已修正後重跑全套。初始化預期逐項比對已審閱新增表／索引／trigger，歷史結構嚴格比較保留；metadata 仍需 service authentication，但不讀玩家資料。
- 前端相關 177 個案例全部通過；它們包含在完整 Worker 回歸中，不能再與總數相加。
- 最終 browser 兩種尺寸通過：1280×960、390×844；無 page errors、error toasts 或橫向溢出。請以 `docs/atlas-qa-20261102/results.json` 為準，沒有重新驗證所有舊玩法的每個分支，也不是原生 Telegram 手機驗收。
- Wrangler 整合 dry-run 建置成功，包含 8,973 個現有與新增 public 檔案；沒有發布。
- 正式公開查核的原始範圍記錄在 `docs/atlas-qa-20261102/public-baseline.json`；後續正式 D1 聚合已如上取得，兩者是不同範圍的證據。

後續查核修正：正式執行時發現 Wrangler 會把 `--command` 後方以 `--` 註解開頭的分開參數視為新旗標。工具改用單一 `--command=<SQL>` 參數，保留 SQL 與 dry-run 註解；新增真 Wrangler CLI 的離線解析回歸，針對性測試 6／6 通過。沒有因此重跑已成功的正式聚合。上述 2,614 案完整測試對應先前程式提交；此工具修正的完整遠端 gate 以最新 PR CI 為準。

GitHub CI 是獨立檢查，應以 PR 當下結果為準。上述本機全部通過不表示 PR 已合併或正式已部署。
