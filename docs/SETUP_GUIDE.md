# 星穹旅誌 (Star Journal RPG) - 完整建置與 GitHub 操作指南

## 🌟 一、將程式碼上傳到您的 GitHub

如果您尚未在 GitHub 建立倉庫，請依照以下步驟操作：

1. **註冊 / 登入 GitHub**：前往 [https://github.com/](https://github.com/) 註冊或登入。
2. **建立新的儲存庫 (Repository)**：
   - 點擊右上角的 **「+」** -> **「New repository」**。
   - Repository name 輸入：`star-journal-rpg`。
   - 權限強烈建議選擇 **Private**（私人）。
   - **不要**勾選 "Add a README file"（因為本地已經幫您建立好完整的 README）。
   - 點擊 **「Create repository」**。
3. **一鍵推送至 GitHub**：
   - 複製 GitHub 畫面上顯示的 HTTPS 倉庫網址（例如：`https://github.com/YourUsername/star-journal-rpg.git`）。
   - 在本專案根目錄下，雙擊執行 **`push-to-github.cmd`**。
   - 依提示貼上倉庫網址，即可自動完成推送！

---

## 🔧 二、環境配置說明

本專案將機器人與雲端 API 完美解耦，各組件配置如下：

### 1. Telegram Bot (位於 `bot/`)
- `telegram.local.json`：
  - `botToken`：從 [@BotFather](https://t.me/BotFather) 取得的 API Token。
  - `chatId`：超級群組的 Chat ID（例如 `-1004342516953`）。
  - `botUsername`：您的機器人帳號（例如 `StarJournalRpgBot`）。
- `rpg.local.json`：
  - `rpgApi`：您的 Cloudflare Worker 網址（例如 `https://elf-rpg-api.xxx.workers.dev`）。
  - `serviceSecret`：Bot 與 Worker 通訊用的共享密鑰。

### 2. Cloudflare Worker (位於 `worker/`)
- 透過 `wrangler.toml` 管理 Cloudflare 資源：
  - **D1 Database**：存放玩家、裝備、背包、拍賣、決鬥紀錄。
  - **Durable Objects**：自動強化等長時間狀態調度。
  - **Crons**：定時首領刷新與掛機結算。
