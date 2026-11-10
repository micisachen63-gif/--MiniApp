# HUD v2 本機整合報告

日期：2026-11-06（Asia/Taipei）。使用者追加要求：納入 ui-generated-20261030/hud-v2。

## 版本與範圍

工作樹：D:/StarJournal/worktree-snapshots/star-journal-hud-v2-integration-20261106
分支：codex/hud-v2-integration-20261106
已驗收父版本：9d33dd047e026311f936afed7ed6b0e0753abe19（F2；原完整 Worker3495＋BOT205）。本批開工 fetch origin/main=3c6729aa9167223a3a915c5dc19fcc075cbad0ed，確認為父版本祖先。

本文件在本機提交前保存。精確最終 commit、clean tree、提交後完整 Worker／BOT gate 的實際數字與原 child exit，以 D:/StarJournal/handoff/non-character/hud-v2-integration-20261106/FINAL_STATUS.json、STATUS.json 及其引用的 .release-sync/hud-v2-20261106/full-final-head-gate/ 原收據為準。不能用前批3700或本批focused185代替最終gate。

F3原工作線仍保有自己的worktree、OWNER與9822/9823測試環境，最新主交接於07:48記為paused-concurrent-writer-coordination。本接續已明確退出F3寫入角色，保存 COORDINATION_928AF2F16DDC.json 與 F3_WRITES_RELINQUISHED.json；此提交是F2＋HUD增量，未包含未提交F3。待原F3完成可驗收提交，再把HUD增量合到後續整合分支並做組合驗證。

## 需求與實作

原素材的accepted-layout核定左生命球、中央五格同列、右魔力球。既有live層已部分掛接HUD，但中央是兩個不可操作補給格與構築／派遣／同步，且仍依賴外部展示CSS。本批沿用現有RpgSceneLiveView.mountHUD與同一五入口／單浮窗，接入實際兩種補給與三個目前配置技能。

1. 將原orb-bezel.webp、action-icons.webp與accepted-layout.json逐byte納入worker/public/ui/hud-v2。原grok素材未改；source-manifest.json保存來源、hash與採用界線。本地hud-v2.css只替換素材URL，live布局調整放在scene-live-view.css。
2. HP／MP沿既有已提交scene快照；補給沿原normalize：有效當趟顯示剩餘reserve，營地顯示當前角色庫存合計。零與未知不同，斷線數字標示為上次同步。沒有固定12／8庫存或展示百分比。
3. 三格技能以原skill-career純讀回傳的special.loadout順序、真實技能名與空格呈現。每格用名稱首字作中性標記；不把示意的三張劍士技能圖套到其他職業。
4. 每次技能讀取綁account、realm、character、epoch與revision；generation、AbortController、microtask前核對及已接受版本下限共同阻擋切換、A→B→A、舊版與晚到回覆。離線／隱藏頁恢復不倒退同scope版本。
5. 點兩個補給格進既有supplies視窗，點任一技能格進既有skills視窗。原確認、未決操作、技能學習／配置與遊戲規則維持；沒有新增即時喝水、即時施法、冷卻倒數或hotkey。既有bindHudV2會在live mode隔離整段prototype操作。
6. Launcher只增加五個exact本地HUD路徑白名單；原decode、NUL／反斜線／parent path拒絕與realpath containment保留，缺檔不退回grok。
7. 手機五格維持44px，裝飾血魔球縮小以保留單列。Root目視後另修聊天定位：依共用導覽的實際底部offset，加max(球高度,槽高度+8px)與12px間距。只改scene-live-view.css，未改API或重啟資料庫。

產品來源：scene-live-view.js、scene-live-view.css、scene-live-preview.mjs；五個HUD資產／來源檔；兩個可由官方test/*.test.js收錄的HUD測試。沒有新增後端路由、migration、遊戲數值或獎勵。

## 驗證與原件

證據根：本工作樹 .release-sync/hud-v2-20261106/。

| 驗證 | 實際結果 | 範圍與原件 |
| --- | --- | --- |
| 候選focused | 16/16，exit0 | DOM／Promise VM與真launcher handler的隔離測試；包含scope/revision/空值與資產邊界。不是瀏覽器結果。 |
| 套入後既有＋新focused | 185/185，exit0，1378來源前後一致 | focused-01/receipt.json；八個測試檔，位於聊天CSS小修之前。 |
| 真HTTP素材 | 五檔GET/HEAD皆200、MIME與bytes/SHA相符；三個未列入／越界路徑404 | preview-01/health-assets-01.json。 |
| Browser01功能 | 9 checks通過，原child exit0/signalnull、browserClosed=true、38來源前後相同 | qa/runs/browser01/；原result SHA 1e8a19dacb9e136e3a2355c310f99cdda545afa5ba2f0cc993fd2113139cd6c8；process SHA29fea211e35f8db394eb0f074b9a0afc65ec5a459d240e248f352b4cf2082650。 |
| 慢切四職與原版面診斷 | 真exit0/closed、40來源穩定，186requests僅4個原select；無request/page/HTTP/blocked failures | qa/visual-probe-01/original/。四職人物可見，劍士三技、其餘空槽；同時確證320/390聊天重疊，因此不是最終版面通過。 |
| 聊天CSS修正後三尺寸 | 320／390／1280全部幾何與點擊assertions通過；真exit0/closed，40來源穩定，70requests、無顯式mutation與失敗 | qa/visual-probe-01/fixed/；result SHA48ab4bb68a542bad19a2446db026a8a0c7c8b6e86ee9e4a852fedfd8a1dc7538，process SHAe183de83f7ebe71c591777e95799153e0168726a290892cbd623be32bf66f112；geometry-assertions.json SHA c1cffc080f4b4f0130abd846ae7126368e0218182edd3f9e0e793f6f498e0fa5。 |

Browser01先驗四職真空配置與當前血魔／庫存，再經原技能UI完成三次學習、三次裝備。六個原request ID各只送一次；三本書10→9、3→2、3→2，配置依序加入裂甲重斬、血性戰吼、斬殺追擊。兩次故障注入使用原回應bytes：同scope較舊revision被拒；真正晚到回應跨A→B→A不能覆蓋新scope。另驗五入口與五HUD格的正確單浮窗、輸入／modal／composition鍵不產生額外HUD操作。

原Browser01有17筆request failures，不能稱零錯誤：11人物素材與4讀取為ERR_ABORTED，原紀錄不足以逐項歸因scope／取消原因；另2筆是明確的離線注入。原件與expected:false保持。review/independent-review-02-qa.json逐項列明；後續慢切原probe與修正後probe的零失敗是不同次、不同範圍的補充證據，不改標原run。

既有背包／補給可能讀取/me並結算legacy idle，已與純讀及明確mutation分開。沒有宣稱整段UI巡覽資料庫完全不變。瀏覽器四職DOM均限permanent；兩realm僅分別讀characters清單，不冒稱完整跨realm UI驗收。

Root已目視原320／390／1280及修正後320／390圖，修正後聊天清楚分離；三尺寸DOM均保留12px間距，手機槽44×44、桌面64×64。320既有左上資訊卡局部遮住角色頭部仍屬全局版面後續項目，不宣稱本批解決。

## 最終來源與驗收邊界

最終scene-live-view.js SHA e133ffa9af5c61f661b23090e8b67de848c190ec1fc1c654ff4e100b3a0de298。
最終scene-live-view.css SHA c3e6e73d2288bd42e089cd0cf7d44462a8585236dc05b509849eaf221334bbf5。
Launcher SHA 7e600d860ce0f8c5de5a9bf5f5b4ad42d67c23cc4cdf0163ed21e76c25c38696。
最終CSS相對browser01唯一產品變化是聊天offset兩條規則，來源差異與原圖保存在chat-clearance-01。

完整gate必須在此提交的精確clean HEAD執行：官方動態Worker test/*.test.js與BOT adapter/main完整清單，兩個真child exit0，fail/cancel/skip/todo皆0，前後所有tracked sources／HEAD／分支／clean狀態穩定，runner receipt與observer-result都通過。現準備清單Worker311檔、BOT23檔；實際測試數以最終原收據為準。

## 預覽與接續

- UI：http://127.0.0.1:9833/，PID32536。
- API：http://127.0.0.1:9832/，PID17956；isolated/ephemeral、productionAccess=false，RPG_SKILL_CAREER_QA=1。
- 劍士三技已透過原流程學習／裝備，其他三職空槽；不要重播browser01的初始化或六個操作，也不要reset/reseed來湊結果。資料為本機記憶體，服務關閉即消失；不是持久DB備份。
- 原F1/F2/F3及其他工作線預覽、人物／FX與grok資產未改。此工作樹generated文字來源仍動態讀取，每次驗收有九份before/after hashes，不宣稱全域角色美術永久凍結。
- 本批handoff：D:/StarJournal/handoff/non-character/hud-v2-integration-20261106/。StarJournal-HUDv2-Checkpoint-30m為PT30M，只記錄STATUS與git觀測，不自動測試、提交或操作遊戲；原主線排程維持。
- 本批僅本機整合，不push／PR／merge／deploy。F3、交易、衣櫥／完整帳務、第四階重選、跨季完整移轉、角色／FX事件接線、正式Telegram／真機與整體經濟平衡仍依主交接後續處理。
