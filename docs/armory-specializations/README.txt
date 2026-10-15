高階職業獨立武裝特效驗收（2026-10-16）

範圍
四職業各三轉 8、四轉 16，合計 96 個職業，男女共 192 種身分。
各職業有自己的構圖、主紋、輔紋、配色、粒子圖與動態參數。
三、四轉以完整職業路徑解析，不再回退到二轉或三轉父系。

內容
worker/art-production/armory-specializations.mjs：96 個逐項美術設計。
worker/art-production/build-armory-specializations.mjs：原創矢量符紋與可重建工具。
worker/public/armory-specializations.js：瀏覽器精確職業對照。
worker/public/art/ui/armory-specializations-20261016/：96 套裝飾及 96 張粒子紋樣，共 192 個透明 SVG。
職業特效細分.txt：中文逐職業展示說明。
designs.tsv：可排序職業細分表；designs.json：各套設計與素材 SHA。
四張 *-all-24.jpg：各職業系的完整 24 套紋樣總覽。
24 張個別職業 JPG：實際 Mini App 的手機武裝畫面。

驗證
完整 npm test：Worker 1007、BOT 77 全數通過，無跳過。
所有 96 套去除配色與標題後，SVG 構圖仍各自不同。
所有 96 套動態參數組合不同；每套有實際 CSS 關鍵影格。
所有 192 種男女身分與戰鬥節點的職業／技能名稱一致，四轉與父系／兄弟節點使用不同構圖。
高階畫面：192 身分 × 320/390/768/1280px，共 768 組；再加 96 組手機無天使畫面，共 864 組。
每個高階職業各驗證動態實際推進、減少動態模式、離開可視區暫停與離開武裝清除，共 384 項。
96 套裝飾與 96 張粒子均在瀏覽器解碼成功；人物中央區域透明，兩側有可見像素。
低階盜賊額外回歸：14 種身分 × 四寬度，加四路線無天使，共 60 組及 12 項動態生命週期檢查。
特效框與人物展示框對齊，保留天使間距，無水平溢出且不攔截裝備操作。
驗收資料為隔離記憶體 fixture 與明確 UI／回應替換，未讀寫正式玩家。
verification.json 保存逐組結果、像素檢查與驗收開始／結束一致的來源 SHA。

重跑
node worker/art-production/build-armory-specializations.mjs
node worker/test/armory-specializations-browser.mjs
node worker/test/thief-armory-browser.mjs
瀏覽器驗收需要 Playwright 與 Chrome，可用 RPG_PLAYWRIGHT_MODULE 指定模組位置。

整合
已保留最新主線的創角修正與盜賊高階能力；本次僅新增武裝展示特效。
正式版本與 GitHub 提交對應以 docs/deployment/elf-rpg-api.json 為準。
