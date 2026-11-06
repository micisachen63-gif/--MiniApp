# HUD viewport 整合紀錄 — 2026-11-06

## 版本與範圍

本批在已驗收 F2＋HUD v2 上整合主戰場安全區，處理原交接留下的窄畫面資訊卡遮住角色頭部，以及短橫向畫面 HUD 遮住角色腳部問題。使用者指定的 `ui-generated-20261030/hud-v2` 已由父版本納入，本批保留其原始素材、真實 HP／MP、兩格補給與三格技能資料。

- 工作樹：`D:/StarJournal/worktree-snapshots/star-journal-hud-viewport-integration-20261106`
- 分支：`codex/hud-viewport-integration-20261106`
- 已驗收父版本：`f38855d30a935b984c9e11c973a28b7e33c58b8c`（F2＋HUD v2）。
- F2：`9d33dd047e026311f936afed7ed6b0e0753abe19`。
- fresh origin/main：`3c6729aa9167223a3a915c5dc19fcc075cbad0ed`，已確認為父版本祖先。
- 原 HUD 完整 gate：Worker 3511＋BOT 205＝3716，原程序正常結束、來源穩定；此數字僅屬父版本，不代表本批最終 gate。
- 本批最終 commit、提交後完整 gate 與所有最新接續狀態，以外部 `D:/StarJournal/handoff/non-character/hud-viewport-integration-20261106/FINAL_STATUS.json`、`STATUS.json`、`WORKING_HANDOFF.md` 為準。本文在 commit 前保存，不預先宣稱最終 gate 通過。

F3 仍由原工作線管理。讀取時主交接為 `paused-concurrent-writer-coordination`，沒有可供本批合併的已驗收 F3 commit；本批不改 F3 的鎖、來源、原預覽或主交接指標。

## 行為

1. 以實際角色 screen bounds、聊天區與 UI 幾何測量可用空間，維持角色與控制項間距；不調整戰鬥 authority、相機、角色資產或人物比例。
2. 可容納完整資訊時保留原卡片。空間不足時改成至少 44px 的「查看出征狀態」按鈕；點擊使用既有單一浮窗，搬入原 status DOM。
3. 低於 44px 可用空間時隱藏浮動資訊與按鈕，改由常設「冒險 → 出征狀態」入口開啟完整原面板，不裁掉進度、補給、警告、戰報、敵人或事件內容。
4. 短橫向及窄直向畫面縮小 HUD 裝飾高度，五個實際操作格維持至少 44px；HP／MP、補給數量、技能順序與原資料入口保持不變。
5. 由 ResizeObserver 與兩次 requestAnimationFrame 合併測量，等待相機矩陣更新；簽章避免重複寫入，dispose 清理 observer 與排程。
6. 完整卡片／收合按鈕切換時移動鍵盤焦點。狀態頁跳到同窗其他 route 後，保留原回焦意圖至最後 dialog 關閉，並以 account／realm／character／epoch 綁定；scope 改變即丟棄舊意圖。MutationObserver 僅監看 #ui 直接 childList。
7. 原 panel 的節點、parent／sibling、inert 與 handler 在離開時還原；不新增第二個 modal，也不為此增加 API 讀取。

參考既有隔離工作線 `2fea38aa2c7c21bc48b7e2cbee7bcf5581cabc6d` 的 dock 需求，但沒有整批 cherry-pick 固定高度方案或其工作線其他變更。

## HUD 素材的跨平台 byte 保留

新 Windows checkout 的 autocrlf 曾令 accepted-layout.json、hud-v2.css、source-manifest.json 與原素材 byte hash 不同。原資產驗證因此正確失敗；沒有修改其斷言或來源 manifest 來接受差異。

本批恢復父版本／原素材相同的 LF bytes，並在 .gitattributes 為 `worker/public/ui/hud-v2/*.json`、`*.css` 設定 `text eol=lf`。兩張 WebP 一直相同。修正收據為 `.release-sync/hud-viewport-20261106/asset-checkout-normalization-receipt.json`，原 grok 檔案未改。

## 驗證與範圍

所有本批證據根目錄：`.release-sync/hud-viewport-20261106/`。成功與失敗原件均保留。

| 證據 | 實際結果與適用範圍 |
| --- | --- |
| root-focused-03/receipt.json | 44/44，原 child exit 0、來源穩定；驗證 live view／lifecycle／HUD 與素材。執行時 JS 為 cefdea2d…，早於最後限定焦點修正。 |
| route-review/route-wiring-02/focused-receipt.json | 78/78，原 child exit 0、來源穩定；最終 route 與測試檔，實際執行冒險 hub tile、route table、單窗 mount、history。 |
| qa/runs/acceptance03/ | 四職 × 八尺寸＝32/32 幾何；28/28 原面板開關及 hub 入口；3/3 resize 焦點流程。原 child 45612、observer 38828，exit 0、browserClosed。 |
| qa/runs/bridge-n1-02/ | 最終 JS 的單一跨 route 焦點案例通過。child 40408、observer 51164，exit 0、browserClosed；status → 原星圖派遣導航 → 600×551 → 關窗，回焦可見 Adventure，原 panel／parent／資料完整還原。 |
| gate-tools/candidate-review-03.json | 獨立靜態審查通過；前兩個 P2 與 N1 已修，無 blocker。寫收據時 browser bridge 標 pending；root 隨後核對 bridge-n1-02 原程序成功，不改寫舊審查。 |
| full-final-head-gate/ | 待本機 commit 後以精確 clean HEAD 執行官方完整 Worker／BOT；最終結果記在外部 FINAL_STATUS.json。不得用前述 focused、父版本或尚在執行的結果代替。 |

八尺寸為 320×740、390×844、600×740、1280×900、320×568、844×390、600×551、320×480。原幾何檢查保留 8px 淨距及 44px 操作目標。三條 focus resize 流程涵蓋完整卡片轉收合、收合轉完整、開窗後轉極小畫面再關窗。

acceptance03 綁定 JS `cefdea2df2096c1921ad3f49fbf56574ae1538ad98d4fc78fa9e55c6082020d6`，187 個來源及 131 份實際 HTTP 靜態回應穩定。最後 bridge 綁定 JS `e2de77a69a3c5433eb67322b5a7746586220b436e498de95a783950cae257bfd`，187 個來源及 63 份 HTTP 靜態回應穩定。

兩者間只有 scene-live-view.js 的限定焦點／生命週期差異，其餘 182 個非 harness 來源完全相同，CSS、route 與幾何邏輯未變。bridge 的 base-reference.json 與 review03 的全檔反向差異 hash 核對保存此範圍，因此保留原 32＋3 驗收，沒有宣稱對最後 JS 重跑全部瀏覽器矩陣。兩次成功驗收均無 page error、request failure、HTTP error、blocked action 或 static drift。

root 已另目視 acceptance03 的 320×740 與 844×390 截圖，確認角色頭腳完整、HUD 與聊天／狀態控制分離；代理亦檢視極小畫面及完整 status 浮窗。

### 保留的失敗

- root-focused-01：44 項中的原素材 byte 驗證失敗，以上述 LF 屬性修復後通過。
- qa/runs/acceptance01：QA 將聊天文字 span 當成整個 44px target；原 handler 實際掛在 160×44 的 #chat。校正 selector，保留原失敗。
- qa/runs/bridge-n1-01：焦點與原資料已正確，但 QA 將 serverNow 時鐘視為不可變資料。核對 status() 投影後，第二次仍深度比對其他全部資料，並要求時鐘精確符合當下 snapshot.serverNow；未刪除時鐘正確性要求。校正收據為 qa/bridge-n1-sync-assertion-correction.json。
- 原 candidate-review.json、candidate-review-02.json 及 clarification 保留，不覆寫成事後通過。

## 保留環境與接續

- 本批 UI：`http://127.0.0.1:9843/`，原 PID 36272；API：`http://127.0.0.1:9842/`，原 PID 32488。以最新 PID／health 收據為準。
- 使用隔離 SkillCareer 合成雙世界 fixture，API 為 ephemeral memory，productionAccess=false。保留原程序，不重啟、不 reseed、不重播先前成功的學習、裝備或派遣動作。
- acceptance03 僅四次原角色 select；select 內部可進行既有 idle settlement，故不宣稱資源完全未變。最後 bridge 無 select 或 legacy /me，只有同窗導航，沒有實際派遣、消費或角色配置 mutation。
- 原 HUD 9832／9833、F3 9822／9823 及其他工作線保留。
- 本批隔離任務 `StarJournal-HUDViewport-Checkpoint-30m` 每 PT30M 記錄自身 Git／STATUS 快照；已實際於台灣時間 08:40:29、09:10:29 執行。重要里程碑另立即記錄，快照不代表背景 AI 持續修改程式。
- 本批 owner 為 `hud-viewport-root-7b3ce96de9b6-20261106`；只寫本批 handoff。不要改全域 task 狀態或 F3 的 OWNER／STATUS／LATEST／START_HERE。

## 尚未處理

F3 原線仍需取得原 browser 剩餘案例、已驗收 commit 與精確 HEAD 完整 gate，之後在新隔離組合工作樹整合 F3 與本批（本批已包含 HUD v2），對交互功能及最終新 commit 再驗收。切勿把未提交 F3 工作目錄視為已驗收來源。

其他全案待辦依原主交接：交易／衣櫃／完整帳本、四階重置、賽季 drain／manifest／跨 D1／玩家留存、人物與 FX／逐次攻擊事件、正式 Telegram 宿主／實機／經濟驗收。本批不將這些列為完成。

本批僅本機提交，沒有 push、PR、merge、部署、production DB、Secrets 或 migration 修改。
