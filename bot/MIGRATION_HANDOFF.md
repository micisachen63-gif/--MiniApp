# 星穹旅誌專屬 BOT 交接

狀態：2026-10-12 **已正式切換**。使用者明確說「開始吧」授權切換，人物模組工作可繼續；後续部署必須沿用新 BOT 與群組設定。

## 新資源

- BOT：星穹旅誌 ✨，https://t.me/StarJournalRpgBot ，BOT ID 8661366679。
- 專屬群組：星穹旅誌｜冒險者之庭 🌌。
- 正式超級群組 ID：`-1004342516953`。TG Web URL 的 `-4342516953` 不能直接當 Bot API 群組 ID。
- 邀請連結：https://t.me/+5hDQa1rrBv4xMDhl 。
- 群組與 BOT 已套用星空神殿、古金星穹徽章頭像。
- 程式位置：`C:/Users/User/Documents/ChatGPT/星穹旅誌`。
- 新服務採 `telegram.local.json` 的 `active:true` 正式模式，負責遊戲指令、群組戰況、BOSS、PK、組隊與通知佇列。
- Telegram token 與後端 serviceSecret 僅存於 local.json，不可輸出、提交到版本庫或貼到工作視窗。
- 共用原有 `爆分監控/src/rpg-flow.js` 與戰況、美術模組；不複製遊戲規則或玩家資料。

## 正式部署與已完成驗證

Worker：https://elf-rpg-api.micisachen.workers.dev 。
Worker 專案：`C:/Users/User/Documents/ChatGPT/爆分監控/deploy-staging/elf-rpg-20261008-v051/worker`。
D1：elf-rpg，`bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4`。
Worker BOT_TOKEN 已改為 @StarJournalRpgBot；wrangler.toml 的 GROUP_CHAT_ID 為 `-1004342516953`。一般 deploy 保留遠端 secret，不要重新寫入原小精靈 token。
最後確認部署版本：`e3ec7957-ae3d-4fa9-b8b4-d251af13fb0d`。部署程式與素材仍在原 Worker 專案，不需要搬庫或另建角色。
原小精靈的 RPG adapter、通知輪詢、/rpg 指令選單與鍵盤遊戲入口已移除；rpg.local.json 為 enabled:false。舊 /rpg 與舊按鈕只提示搬家。小精靈其他功能保留，life 服務已重新啟動。
新群組已置頂圖文入口，原群已送出搬家公告。首隻正式新群組 BOSS 已確認 `message_chat_id=-1004342516953`、`message_id=8`。
新成員歷史訊息已設為可見，可以看到置頂入口與既有群組戰況。大圖傳送逾時產生的舊卡已標示過期並停用攻擊按鈕，只連向最新卡片。群組首領文案已改為首領精華與現行掉落，不再顯示 undefined 轉職材料。
新 token 登入 HTTP 200、原 token HTTP 401；Telegram 真實 Mini App 已選回「白色毛衣 Lv.39」，確認掛機、金幣與技能快捷欄。D1 保留 4 帳號、4 角色；備份 217 件裝備，檢查時 220 件（正常掛機持續增加）。沒有重建或清空角色、背包、金幣、技能。
測試：Worker 組隊、副本、爬塔、交易 31 項通過；BOT 移除、照片、通知重試、首領文案與新服務隔離 19 項通過。多人實際通關沒有操作玩家帳號進行模擬，使用既有服務層測試驗證。
遊戲透過私訊 inline web_app 與「開啟旅誌」menu button 開啟；Main Mini App 尚未啟用，mainMiniApp:false，群組 deep link 採 ?start=rpg，組隊與交易依既有 /start 路由開啟。
大圖改由 Telegram 直接讀取已部署的公開圖網址，避免本機大檔上傳逾時；群組 BOSS 保留原 12 張遊戲圖，高品質 JPEG 副本位於 Worker `public/telegram-media/`。裝備分享保留原公開圖 URL，動態 PNG 卡片壓縮為 JPEG，動畫仍沿用原 GIF 流程。不要移除 telegram-media 靜態資產。

## 切換記錄與回復原則

以下為切換時檢查清單，已執行適用項目；Main Mini App 是選用功能，上述正式 menu button 與 inline 開啟方式已實際驗證。

1. 取得使用者明確同意切換，與其他部署視窗協調，避免並行部署覆蓋設定。
2. 確認原群沒有進行中的組隊、BOSS 與 PK；交易不清空，角色與物品資料不搬庫、不重建。
3. 備份 Worker 設定、原 BOT 對接設定、D1 與通知傳送狀態；記錄回復方案。
4. 檢查佇列與舊卡片引用：分享、交易請求、PK、BOSS、隊伍都可能有舊 BOT 的 message_id / chat_id。新 BOT 無法編輯原 BOT 的訊息；必須決定已結束卡片不重送、有效請求重建新卡片並更新引用。
5. 原 BOT 停止遊戲 tick / outbox 消費後，再切 Worker BOT_TOKEN 與 GROUP_CHAT_ID；同一時間僅有一個遊戲通知消費者。
6. 新 BOT 設定 Main Mini App 與遊戲 menu button、說明、群組入口；更新前端登入提示及舊 BOT footer/連結。若啟用 Main Mini App，才將 rpg.local.json 的 mainMiniApp 設為 true。
7. 新服務 active:true 後驗證 Telegram 真實 initData 登入、原角色/背包/技能/金幣、創角、掛機、交易、分享、PK、組隊打寶、轉職試煉、爬塔、BOSS 與動畫通知。未開始新 BOT 私訊的玩家必須自行按 START；新 BOT 不能先主動私訊這些玩家。
8. 驗證通過後，依使用者要求移除原小精靈的遊戲對接、RPG commands 與鍵盤入口；保留小精靈其他功能。
9. 本交接已更新為「已切換」。尚未主動傳送訊息至其他工作視窗；使用者可貼交接文字，或指定接收視窗後授權傳送。

備份目錄：`backup/cutover-20261012/`，包含 D1 完整 SQL、原設定與傳送狀態、新設定、wrangler.toml，以及新登入角色核對。只變更舊群訊息引用，不變更玩家物品或資產。回復時先停新服務，再還原原 BOT token / 群組與 adapter，避免兩個通知消費者；不要將資料庫整份倒回，否則會覆蓋切換後玩家的進度。

## 執行與維運

以 bundled Node 執行 `service.mjs start|stop|status`；start 使用 windowsHide 隱藏背景程序。獨立 state 與 logs 不混用原小精靈。
已建立目前使用者的 Startup 捷徑 `星穹旅誌.lnk`，以 `launch-watchdog.vbs` 隱藏啟動 watchdog.mjs；登入後啟動，每五分鐘確認服務。作業排程註冊因 Windows 權限不足未成功，使用者登入啟動方案已套用，不需要系統管理員權限。`service.mjs stop` 留下停止標記，守護程序不會擅自再啟動；再次 start 才清除標記。
目前仍依賴此 Windows 電腦運行；雲端 Worker / D1 沿用原服務，BOT 搬雲端尚未實作。
如果人物模組更新也改了 `爆分監控/art-runtime/`、TG 戰況素材或共用 rpg-flow / renderer 程式，請重新啟動「星穹旅誌」服務讓快取更新，不要只重新啟動小精靈。純 Worker 前端人物素材更新則照常部署即可。

## 頭像製作

使用內建 imagegen。成品：`assets/bot-avatar.png`、`assets/group-avatar.png`。
BOT 提示方向：古金八角星、藍寶石、希臘月桂、天文儀環、午夜藍星空；高級奇幻遊戲繪畫，中心圓形裁切安全區、無文字。
群組提示方向：古希臘白色大理石神殿、金色星芒、藍色星空傳送門、古金雕刻與星雲；同風格、中心圓形裁切安全區、無文字。
