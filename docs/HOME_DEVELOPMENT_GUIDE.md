# 🏡 星穹旅誌 (Star Journal RPG) - 在家開發與營運完整交接手冊

> 專為在家中電腦（Windows / Mac / Linux）直接接手開發與營運所準備的 100% 獨立作業指南。  
> 只要有這份手冊與 GitHub 倉庫，**完全不需要依賴公司電腦的任何檔案**。

---

## 🚀 一、第一次在居家電腦建立環境（5 分鐘內搞定）

### 步驟 1：安裝基礎環境
1. 下載並安裝 **Node.js**（推薦 v20 或 v22 LTS）：[https://nodejs.org/](https://nodejs.org/)
2. 下載並安裝 **Git**：[https://git-scm.com/](https://git-scm.com/)

### 步驟 2：從 GitHub 下載完整專案
開啟終端機（PowerShell、CMD 或 Terminal），執行：
```bash
git clone https://github.com/micisachen63-gif/--MiniApp.git star-journal-rpg
cd star-journal-rpg
```

---

## 🔑 二、居家電腦 Cloudflare 部署授權

本專案使用 Cloudflare Workers 與 D1 資料庫。在家只要登入一次 Cloudflare 帳號：

```bash
# 登入 Cloudflare（會自動開啟瀏覽器按授權即可）
npx wrangler login
```

登入後，您的電腦便擁有對生產環境 `elf-rpg-api` 與 `star-journal-rpg-bot` 的完全控制與部署權限！

---

## 📂 三、專案三大核心服務一覽

| 目錄 | 線上服務名稱 | 核心功能 |
| :--- | :--- | :--- |
| **`worker/`** | `elf-rpg-api` | 遊戲世界引擎、D1 資料庫、角色、背包、掉寶、交易與 Telegram Mini App 前端 |
| **`cloud-bot/`** | `star-journal-rpg-bot` | **線上正在跑的 TG 雲端機器人**（Webhook 接收、首領卡片與 24h 守護） |
| **`bot/`** | *(本地輪詢版)* | 舊版本地長輪詢 Bot（已完整雲端化，留存作為本機備份） |

---

## 🛠️ 四、在家如何執行測試與更新發布

### 1. 執行自動化測試（驗證業務邏輯）
在專案根目錄執行：
```bash
# 測試遊戲規則與轉職邏輯
npm run test:worker

# 測試雲端機器人流程
npm run test:bot
```

### 2. 修改程式後如何推送到正式環境（部署上線）
- 先在根目錄 `npm ci`，完成測試，再將程式提交／合併並推送 GitHub main；保持工作目錄乾淨。`npm run sync:check` 可只讀核對正式機與 GitHub 程式，不會部署。
- **若修改了遊戲核心、數值或 Mini App 前端介面（在 `worker/`），於根目錄執行**：
  ```bash
  npm run deploy:worker
  ```
- **若修改了 Telegram 機器人回應或首領通知卡片（在 `cloud-bot/`），於根目錄執行**：
  ```bash
  npm run deploy:bot
  ```

工具會核對遠端提交、建置並跑服務測試，檢查原正式設定後發布、驗證線上 runtime 與 public，最後提交推送 `docs/deployment/` 的版本對應紀錄。main 的 push 本身不會自動上線。若任一步驟失敗，先檢查 `.release-sync/` 的紀錄與正式版本，不要直接重跑部署；只有驗證及收據 push 都成功才算同步完成。新 UI／美術仍要先完成對應畫面驗收，不以雜湊核對取代視覺檢查。

---

## 🔒 五、遠端生產金鑰與設定備忘（已妥善保存在 Cloudflare）

- **Cloudflare Account ID**：`48259a9f84c8307f8de8ceaf704b9f8f`
- **D1 Database ID (elf-rpg)**：`bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4`
- **Telegram 超級群組 ID**：`-1004342516953`（星穹旅誌｜冒險者之庭）
- **遠端 Secrets（Cloudflare 雲端保存，部署時會自動繼承，無須重複設定）**：
  - `BOT_TOKEN`：Telegram Bot Token
  - `SERVICE_SECRET`：Worker 與 Bot 之間的通信金鑰

---

## 📌 六、健康檢查與狀態監控網址

- **遊戲 API 健康檢查**：[https://elf-rpg-api.micisachen.workers.dev/health](https://elf-rpg-api.micisachen.workers.dev/health)
- **雲端機器人健康檢查**：[https://star-journal-rpg-bot.micisachen.workers.dev/health](https://star-journal-rpg-bot.micisachen.workers.dev/health)
