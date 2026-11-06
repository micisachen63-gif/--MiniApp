# 旅人交易所純讀主浮窗整合

更新：2026-11-06（Asia/Taipei）。本文件在本機提交前保存。產品、聚焦測試及真瀏覽器驗收已完成；本批最終 commit 與提交後完整 Worker/BOT gate 以外部 FINAL_STATUS.json 和原收據為準，不以基底或 focused 數量代替。

## 目的與版本

將原旅人交易所的瀏覽寶物、我的刊登、成交紀錄及原物品快照詳情接入主戰場同一近透明浮窗，沿用玩家目前帳號、世界與角色，不另掛載帶交易寫入的舊頁。

- 工作樹：D:/StarJournal/worktree-snapshots/star-journal-exchange-read-integration-20261106
- 分支：codex/exchange-read-integration-20261106
- 已驗收基底：3330589bc844fb5f59fec921fb8c63f4038c6d54
- 版本鏈：F2 9d33dd0 → HUD v2 f38855d → viewport 9ffc6ac → Ledger 3330589 → 本批。
- HUD 原來源 ui-generated-20261030/hud-v2 已完整承接，未重製或改動原 grok 素材。
- 外部交接：D:/StarJournal/handoff/non-character/exchange-read-integration-20261106/
- 本批證據：.release-sync/exchange-read-20261106/

## 完成的使用流程

營地的「旅人交易所」在原單一浮窗中開啟。瀏覽寶物保留物品分類、適用職業、裝備T階、品質、強化上下限六種篩選；列表沿原權威固定每頁30筆與keyset游標，支援前後頁、刷新、空頁與明確重試。

「我的刊登」維持帳號層範圍，同帳號其他角色的刊登仍可見。「成交紀錄」沿目前角色的原ledger與買入／賣出分類，不推算餘額、不建立歷史。點物品直接展開已接受列表中的原快照；裝備保留實際+N與原屬性，天使保留原公開投影。缺少歷史快照時呈現可得資料，不用目前物品回填。詳情返回保留同列表、捲動和原控制項焦點。

讀取失敗保留原頁，使用者可明確重試相同query與cursor。切角色、切route、關閉窗或較新的請求會使舊回覆失效。輸入篩選採明確套用，不以每次輸入發出請求。

本批只有純讀整合。上架／購買／撤回與雙人交換仍由後續批次接入；本批沒有改變既有交易經濟規則、價格、稅率、託管、獎勵或消耗。

## 契約與程式邊界

exchange/scene只委派原market-exchange.list、mine與market-exchange-history。App與service route先沿原認證、世界與角色歸屬驗證，直接返回純讀結果，繞過一般behavior writer。adapter讀取前後檢查選角與revision。

外層cursor綁定account、realm、character、contextEpoch、tab、正規化篩選和原keyset；改scope或篩選不能沿用舊游標。回覆保留原30筆、原公開資料及server revision/time。

UI核對captured scope、request generation、AbortController、revision/serverNow floor、row shape、重複ID及cursor loop。詳情不追加交易API；所有動態文字以textContent建立，圖片限合法本機art/expedition路徑。焦點只在原route仍有效且元素連接時還原。

preview新增獨立exchange合成fixture，需development/isolated並拒絕既有非空交易資料。exchange模式只允許明確純讀路由及驗收用角色選擇；拒絕其餘寫入。Atlas／工坊／party背景timer在此fixture停用。純讀前後以兩世界全部96表的schema、rows、sqlite_sequence及total_changes核對。

## 驗證證據

### 既有聚焦測試

| 範圍 | 原紀錄 | 證據 |
|---|---:|---|
| 後端scope／cursor／純讀／race | 59/59 | backend/focused-01/receipt.json |
| UI與既有Ledger/window/session回歸 | 199/199 | ui-focused-02/receipt.json |
| fixture／preview最終聚焦 | 5/5 | qa/focused-03/receipt.json |

聚焦集合互有重疊，不相加為完整測試總數。原首輪測資makeGear缺kind失敗與後續修正收據保留。

獨立靜態跨層審查覆蓋新adapter、兩入口、UI資料與焦點、preview allowlist/timer、原authority與相應測試。13產品／測試／工具檔審查前後SHA一致，未發現blocker。該審查沒有重跑測試或操作DB；原件review/cross-layer-review-01.json，SHA a87fd3e7c7c44b3d0bbc2e070c3e4633879f33c08929f058634904709abc5794。

### 原失敗與QA修復

acceptance01於12:03:39結束為failed。QA在保存results.json時遇UNKNOWN檔案open錯誤；原browser47240 exit1、browserClosed/disconnected。已保存的6check、16筆UI讀取及前後雙DB相等有效保留，不能將整個failed interval改成passed。原結果SHA ca6b26d03e180d3e8c0927f13922f18998816b7accbd009f9b05d2bfe9c5ff08。

12:27再次核原1,400份來源完全一致，原UI24228/API15136與DB保持。12:29僅修QA persist為同目錄唯一暫存檔後rename；最多4次暫時檔案錯誤重試，記錄code/errno/syscall/path，永久錯誤仍使run失敗。原harness封存，產品檔未改；node --check exit0。candidate-freeze-02明列只有這個QA差異，原freeze01保留。

### 完整瀏覽器驗收 acceptance02

12:29:36至12:30:20，21/21主要checks通過。原browser child42476 exit0、observer15300核browser closed/disconnected及原結果SHA，1,400來源前後相同。此run使用原預覽與DB，未重啟／reset／reseed。

- browse與mine各65筆，30/30/5完整逐頁；history61筆，30/30/1；買31、賣30，明確核同時刻資料不漏重與上一頁原cursor。
- 六欄篩選、30/31界線、空頁、裝備長名/真+N、守護天使、缺少歷史快照與原詳情返回。
- 一次注入讀取斷線保留原頁，重試完整原body/cursor；一次真200在dispose後到達不重繪其他route。
- 可見UI切法師時history為空但帳號mine共享；切妖精時只見其3筆歷史，原五槽HUD仍在。
- 原Ledger第一頁投影與衣櫥cosmetics入口、單一dialog返回有有限回歸。
- 320×740、390×844、1280×900幾何與44px操作目標通過。共14張圖，root目視6張：320/1280列表篩選、390天使詳情、長裝備名詳情、妖精歷史與關窗HUD。
- 四段純讀區間各核雙世界96表hash、tableCount、totalChanges、刊登/帳務筆數完全相同。兩次新角色select在區間外，原選角結算使ledger283→284，未重播原select。
- 31次接受的UI exchange讀取、34次獨立Node oracle與145份實際browser HTTP來源body核對。唯一request failure為預期注入；其餘page/HTTP/route/external/blocked-write錯誤為0。
- 另一帳號與季世界只驗純API oracle。既有場景沒有對應可見selector，不宣稱UI切帳號／世界。

原結果：qa/runs/acceptance02/results.json，SHA a03d6b38cdf8fcf705c67e7368b9abfc8860e0aa142aec909e4b3ae0d2cb8fc2。
原observer：qa/runs/acceptance02/observer-result.json，SHA 30f987f5574d00d714ebce3b3cc550651ad6d7d5d7d35648a30ef966837773f5。
root目視與核對：review/root-browser-review-02.json，SHA 8d11d7e5a1e073f5377e765f3bbc7f5f02376e59d99c01ea4533dd57a0699a25。

### 提交後完整gate

白名單13個產品／測試／工具檔加本報告與AI_HANDOVER。全部產品bytes須與acceptance02來源相同；只允許新增報告和更新交接。

提交後從精確clean HEAD執行既有exchange-launch-final-head-gate.cjs，使用新run-id。工具綁原owner、branch、Node24、官方runner hash及動態完整Worker/BOT清單；每服務一次、concurrency1，不跳過或自動重試。完整結果與原service/runner close收據保存在full-final-head-gate/<run-id>/。本文件不預填尚未執行的結果。

## 預覽、交接與後續

預覽：http://127.0.0.1:9863/ui-generated-20261030/preview.html；API：http://127.0.0.1:9862。synthetic/ephemeral、productionAccess=false；最後選角是測試妖精，DB以acceptance02最後完整快照為接續基準。保留原API與全部其他預覽，不reseed或重播成功／未知操作。

StarJournal-ExchangeRead-Checkpoint-30m保持原PT30M。重要里程碑更新本批STATUS與WORKING_HANDOFF後執行既有checkpoint；排程只觀測檔案，不表示AI背景持續開發。

F3由原工作線持有且未合入，本批保持F2＋HUD/viewport＋Ledger完整鏈。角色/FX、正式Telegram宿主、真機與經濟平衡、完整季末／跨D1保留、第四階重選仍各待處理。下一批應以本批最終已驗收commit接上原交易寫入，不可退回不含HUD與本批的舊基底。

本批local-only，未push／PR／merge／deploy，未改正式DB、Secrets、migration、角色／FX／grok原件或共享全域MCP任務。
