# 帳務紀錄與星紋衣櫥入口整合（2026-11-06）

本批承接已驗收的 F2＋HUD v2＋viewport。新增主浮窗帳務紀錄與既有星紋衣櫥捷徑；本文件於本機提交前保存。精確最終 commit、提交後完整 Worker／BOT gate、preview 原 PID 與結案狀態，請讀：
D:/StarJournal/handoff/non-character/ledger-integration-20261106/FINAL_STATUS.json、STATUS.json、WORKING_HANDOFF.md。

## 版本、範圍與原有功能

- 工作樹：D:/StarJournal/worktree-snapshots/star-journal-ledger-integration-20261106
- 分支：codex/ledger-integration-20261106
- 父版本：9ffc6ace975951da1a2a71f1564d30107eade312
- 父版本已含使用者指定 ui-generated-20261030/hud-v2、真 HP/MP、補給／技能槽，以及窄直向／短橫向 viewport 修正。本批沒有重做或覆寫其生成原檔。
- 新抓取的 origin/main=3c6729aa9167223a3a915c5dc19fcc075cbad0ed 為父版本祖先。
- Node v24.7.0；離線 npm ci 原 exit0，四份 manifests 不變，node_modules 為本工作樹實體目錄。

舊「英雄武裝／衣櫥」是原十一槽裝備頁，已由裝備／背包整合。三款星紋外觀的兌換、穿戴與卸下也已有原星環服務。本批補角色 hub「星紋衣櫥」捷徑，導向既有 star-ring-shop 的 cosmetics 頁；沿單一浮窗、原權威及原畫面，不新增另一套衣物或換裝規則。

舊 ledger 只有最近15筆且不含 exp_delta。新增 ledger/history 讓目前角色分頁查看資料庫實際已入帳的紀錄；保留舊 /app/api/ledger 與 /rpg/ledger 契約、所有入帳／獎勵 writers。不推算未記錄的歷史經驗、不重建餘額、不重送或修補交易。

## 後端契約與隔離

新的 /app/api/ledger/history 及受 service 認證的 /rpg/ledger/history 共用純 SELECT 服務。

輸入必須包含 realmId、selectedCharacterId 與非負安全整數 contextEpoch；App 同時核對可信帳號、角色歸屬與 X-Realm-Id。分類為 all、gold、items、experience。固定每頁30筆，讀31筆決定是否還有更早紀錄。分類分別檢查非零 gold_delta、item_delta 或 exp_delta。

沿原 idx_rpg_ledger_owner，以 created_at DESC、id DESC 排序並使用 keyset cursor；沒有 OFFSET 或全表排序。游標綁定帳號、世界、角色、分類、contextEpoch 及時間／id，拒絕跨作用域重用。讀前後核對 active selection 與角色 revision；讀途中改變則拒絕回傳過期頁。

回應欄位：
ok、schemaVersion、accountId、realmId、characterId、contextEpoch、revision、serverNow、pageSize、category、entries、nextCursor。

每列只公開：
id、createdAt、type、goldDelta、item、itemName、itemDelta、expDelta、summary。

不回傳原 note、event_id 或 typed receipt payload。結構化／損壞 JSON 與 typed receipt 使用一般提示；一般摘要移除控制字元並截長。未知物品使用安全名稱，catalogue 查找採 own-property，數值必須是安全整數。這些文字不能代替原功能操作收據，也不代表重新確認某個未知操作成功。

此路由在原泛用 behavior writer 前回傳；不經 settle、withPlayer、獎勵、重播或新 schema。永久／季世界與凍結季世界的純讀由真 API 契約驗證。

## 前端行為

角色 hub 新增帳務入口；RpgSceneLedger 延遲載入，沿原 session 與單浮窗 manager。

- 全部、金幣、道具、經驗分類；固定30筆，上一頁／更早紀錄、重新整理、空態與錯誤態。
- 下一頁失敗保留原頁與原 cursor；明確重試同一頁，不偷偷刷新或跳頁。
- client 綁 account／realm／character／contextEpoch、generation 與 abort，校驗 response scope、revision floor、serverNow、欄位形狀、重複 id 及 cursor loop。
- scope 改變、dispose 或遲到回應不能污染新頁。snapshot update 只提升 revision floor，不輪詢。
- 動態資料以 textContent 呈現；只有公開投影進入畫面狀態。
- 工具列維持在原 DOM；分頁成功且焦點仍由該操作持有時，才移至頁標題。重試前把焦點移離即將隱藏的錯誤控制。
- 控制最小44px；320／390／1280幾何與焦點的實際結果另見 browser 證據。

## 有界本機預覽

UI http://127.0.0.1:9853，API http://127.0.0.1:9852。
原ready時間2026-11-06 10:10:35（台灣）；UI PID54508、API PID22712、observer PID2580。

只在新程序開啟 RPG_SKILL_CAREER_QA=1 與 RPG_LEDGER_QA=1，其他特殊fixture關閉。初始化合成帳務共115筆，另保留原starter列；最初劍士76、妖精5、法師1、盜賊2、季旅36筆。它們是開發fixture，不是正式玩家紀錄。永久／季世界各95張資料表；/__preview/ledger-state 只在此 opt-in fixture啟用，用於純讀hash、totalChanges與分類數。

新增UI資產已列入預覽文字白名單，ledger/history已列入API CORS白名單。舊F3 attach兼容未新增ledgerQa欄位的原API；開ledger旗標仍不能attach舊API。

瀏覽器只准純讀與明確的既有select。原select可能沿原流程idle settlement，因此在每次select完成後另取雙DB baseline，再驗純讀區間。禁止reseed、reset、重啟原API或重播既成操作。季世界只用純API oracle，沒有宣稱不存在的UI世界切換已驗收。

## focused 原結果

| 集合 | 結果 | 邊界 |
|---|---:|---|
| ledger UI client／DOM／真session wire | 55/55 | 原exit0，3來源穩定 |
| window manager／live session／star-ring UI | 138/138 | 原exit0，7來源穩定 |
| 真App/service API／SQLite ledger contract | 13/13 | child13120原close exit0，212來源穩定 |
| preview assets／attach工具 | 23/23 | child49812原exit0，4來源穩定；其後CORS一字串修改由browser及最終gate覆蓋 |

集合有重疊，不將focused相加當完整gate。
後端驗證包括真簽章、跨帳號／角色／雙世界隔離、65筆同毫秒分頁與頁間新增、分類／cursor／epoch、全DB與totalChanges不變、凍結世界、正負delta、未知prototype-key物品、安全摘要、legacy15契約、讀途中scope／revision改變及owner index query plan。

後端focused-01原12pass/1fail保留：Node24.7 node:sqlite對含NUL的TEXT讀值截斷；獨立診斷證實儲存bytes完整。只將測試fixture U+0000改U+0001，清理與尾字保留斷言維持，產品沒有為此更改。focused-02才是13/13成功原件。

原route stdout檔名雖為.tap，內容是Node預設reporter；final-source-01已明記，沒有改寫成TAP證據。

## Browser 與跨層審查

acceptance01（10:12:51～10:13:19台灣）12/12主要檢查通過；browser原child26912由observer2028觀察到exit0，browserClosed與browserDisconnected均true，1392份來源集合與raw bytes不變。

劍士真UI走完全部76、金幣26、道具30、經驗25筆；全部頁為30/30/16。獨立seed oracle逐筆核75列的時間與正負delta，並核未知物品與兩筆隱藏摘要，沒有只把同一API與自己比。上一頁維持原序與cursor。

320×740、390×844、1280×900無水平overflow；主控最小44px高／77.3125px寬。一次注入下一頁失聯後，原頁保留且明確重試同一body/cursor；一筆真200延後至dispose後到達，沒有污染新route。星紋衣櫥捷徑進原cosmetics頁，三款星紋存在，Back仍同一dialog。原UI切法師驗items/experience空態，再切妖精驗5筆紀錄與五槽HUD。季旅36／13／15／11只驗純API，未宣稱UI切季。

四個純讀區間各核雙世界95表hash、tableCount、ledgerCount、totalChanges完全不變。兩次原UI select放在區間外，其中合法結算使永久ledger84→85，原證據保留。最後目前角色為測試妖精。

14次已接受UI ledger讀取與19次Node oracle分開計數；115/115 browser靜態body成功讀取並比對來源，另15次Node HTTP檢查。唯一request failure為預定注入讀取失聯；非預期request/HTTP/page/external/route錯誤及blocked writes均0。未buy/equip、未額外settle。

8張圖原件均保存；root實際目視320與1280帳務、390原頁失聯及原衣櫥4張，沒有把未看圖片寫成已目視。root-browser-review-01.json SHA95f4a2542cbcfc28190320ce5e3465984badeb37af4d4af8dddc0bf91498bfd5。

results.json SHA fc11d9f2c614db3cdf9f7e8fe370cae50a3aae3a40ff958fd26f29f159cb1fda；observer-result.json SHA80655dd88f47a6f55481e71301662e2505d11b4526c144c839da0f2f15ab3795。獨立跨層靜態review核10項契約與10份穩定來源，無blocker，SHA85eca9d8014ff80a58f9aa323db4b12282318e8f2fadc2927bf00207b8bd45c0。browser完成後只新增本報告及AI_HANDOVER前言，提交橋接另核產品bytes。

## 原證據與最終 gate

所有本批原證據位於工作樹 .release-sync/ledger-20261106/：

- ui-review/：ledger-client-01、route-wiring-01、final-source-01。
- backend-review/：focused-01、NUL診斷／fixture修正、focused-02、review-summary-01，以及cross-layer-review-01。
- preview-focused-01/：原23項結果。
- preview/ledger-preview-20261106-01/：原launch intent／observer／ready及進程證據。
- qa/：有界browser原意圖、來源、結果、圖片及原child close。
- gate-tools/：已核定動態選取完整官方 Worker／BOT 的原runner與獨立observer。
- full-final-head-gate/ledger-final-20261106-01/：本文件提交後才可產生的完整gate結果。

已核後端成功receipt SHA：
b789ecb61493d7a321cda8b4adf8566ab6add22ad277b9f6fa3cd5ee837751d5。

原preview ready SHA：
6ff3214f1a2577b9b77823e8435edaee6d2d6813271f2c1d4fc4fb298afbe135。

文件與白名單local commit完成後，以精確clean HEAD執行完整官方Worker/BOT gate。必須同讀receipt.json與observer-result.json，取得兩服務與原runner實際exit/close、tests=pass、fail/cancel/skip/todo0，以及全tracked來源／HEAD／branch／owner穩定。這些結果以外部FINAL_STATUS為準，不能用父版本3718項或focused成功替代。

## 進度保存與未處理部分

StarJournal-Ledger-Checkpoint-30m持續每30分鐘記錄；10:10:30排程原結果0，重要里程碑另即時快照。接手先讀本批STATUS／FINAL_STATUS／WORKING_HANDOFF及原PID與receipt，不因MCP斷線直接重送action。排程只觀測，不自動開發、測試、提交或發布。

F3仍屬原owner，paused-concurrent-writer-coordination；原未提交來源、原預覽、三筆既成操作及preserved DB鏈保留。不能以本批fresh fixture替代F3剩餘七browser案例，也不能把F3宣稱已合入。未來組合須以本批已驗收commit為基礎，再納入其正式結案commit。

交易、第四階重選、完整季末drain／manifest／跨D1玩家保留、角色／FX及逐擊戰鬥事件、正式Telegram／真機／經濟平衡等仍為各自後續工作。本批帳務只呈現原資料已有列；若某類歷史EXP從未入帳，不在本批補造。

本批只本機整合；未push／PR／merge／deploy，不改production DB、Secrets或migration，不改人物／FX／grok原件，不使用共享全域MCP任務狀態。所有失敗原證據與其他owner工作樹／預覽保留。
