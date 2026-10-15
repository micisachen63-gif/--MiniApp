# 星穹旅誌 ✨ (Star Journal RPG)

> 一款深度整合 **Telegram 超級群組社群** 與 **Cloudflare Serverless 邊緣架構** 的現代化沉浸式 RPG 服務。

---

## 🏛️ 系統全景架構

```mermaid
flowchart TD
    subgraph TelegramClient ["📱 Telegram 生態系"]
        TG_USER["玩家 Telegram 私訊"]
        TG_GROUP["超級群組<br/>星穹旅誌｜冒險者之庭"]
        MINI_APP["Telegram WebApp (Mini App 遊戲介面)"]
    end

    subgraph BotHost ["🤖 Cloudflare star-journal-rpg-bot"]
        WEBHOOK["Telegram Webhook"]
        BOT["BotCoordinator<br/>(去重 / 排程 / 通知)"]
        FLOWS["adapter + WASM<br/>(組隊 / PK / 首領 / 圖卡)"]
    end

    subgraph CloudflareCloud ["☁️ Cloudflare 雲端邊緣運算 (elf-rpg-api)"]
        WORKER["Cloudflare Worker<br/>(API 商業邏輯託管)"]
        D1["Cloudflare D1 Database<br/>(SQLite 分散式資料庫)"]
        DO["Durable Objects<br/>(非同步強化排程)"]
        CRON["Cron Triggers<br/>(每分結算 / 定時首領)"]
        ASSETS["Cloudflare Assets<br/>(前端靜態資源 & 全角色美術)"]
    end

    TG_USER <-->|Webhook / 私訊互動| WEBHOOK
    TG_GROUP <-->|社群首領戰 / 即時卡片| WEBHOOK
    WEBHOOK --> BOT
    BOT --> FLOWS
    FLOWS <-->|RPG_API Service Binding| WORKER

    TG_USER <-->|initData 快速登入| MINI_APP
    MINI_APP <-->|RESTful API| WORKER
    WORKER <--> D1
    WORKER <--> DO
    WORKER <--> CRON
    ASSETS --> MINI_APP
```

---

## 📂 專案目錄結構

```
star-journal-rpg/
├── cloud-bot/               # 正式雲端 Webhook / BotCoordinator / WASM
├── bot/                     # 歷史長輪詢備份，不啟動
│   ├── service.mjs          # 機器人啟動入口與服務管理
│   ├── bot.mjs              # 訊息分發、群組指令、權限過濾
│   ├── watchdog.mjs         # 看門狗進程（保證服務 7x24 不中斷）
│   ├── game-fetch.mjs       # 安全 API 傳輸底層
│   ├── flows/               # 核心 RPG 互動流程
│   │   ├── rpg-flow.js      # RPG 核心卡片與互動選單
│   │   ├── rpg-party-flow.js# 三人組隊討伐試煉
│   │   ├── rpg-pk-animation-flow.js # 決鬥對決動畫
│   │   └── rpg-boss-card.js # 群組首領卡片生成
│   ├── assets/              # 群組歡迎圖、按鈕視覺素材
│   ├── telegram.local.example.json # Telegram 連線設定範本
│   └── rpg.local.example.json      # Worker API 連線設定範本
│
├── worker/                  # Cloudflare Worker 遊戲後端與 Mini App
│   ├── src/                 # 後端核心邏輯
│   │   ├── index.js         # API 路由主入口
│   │   ├── game/            # 戰鬥、職業分支、裝備、鍛造、商城
│   │   └── services/        # 玩家數據存取與業務邏輯
│   ├── public/              # Telegram Mini App 前端網頁（含全角色外觀圖鑑與戰鬥動畫）
│   ├── migrations/          # Cloudflare D1 (SQLite) 結構遷移腳本
│   └── wrangler.toml.example# Cloudflare Worker 設定範本
│
├── docs/                    # 完整架構與配置說明
│   └── SETUP_GUIDE.md       # 詳細建置與環境設定教學
│
├── push-to-github.cmd       # Windows 一鍵推送至 GitHub 工具
├── .gitignore               # 嚴格過濾機密金鑰、本地環境檔與日誌
└── README.md                # 專案首頁說明
```

---

## 🚀 快速上手 (Quick Start)

正式服務已在 Cloudflare，`bot/` 僅供歷史參考。本倉庫為開發來源；先閱讀 [AGENTS.md](./AGENTS.md)。

在專案根目錄安裝鎖定版本工具及登入，再執行唯讀核對：

```bash
npm ci
npx wrangler login
npm run sync:check
```

開發完成後，先測試、提交並推送／合併 GitHub main，再於乾淨的 main 發布修改的服務：

```bash
npm run deploy:worker
# 若改到雲端 BOT，另執行：
npm run deploy:bot
```

發布流程會核對提交與正式設定、執行服務測試、驗證線上程式／素材，並將 Git commit 和 Cloudflare 版本的對應紀錄推送至 [docs/deployment](./docs/deployment)。GitHub push 本身不會自動發布。不需為一般程式更新重跑 D1 migrations，遠端秘密維持在 Cloudflare。

---

## 🛡️ 資安與隱私防護

- **零金鑰外洩**：所有敏感性設定檔（包含 `*.local.json`、`.env`）已全數由 `.gitignore` 隔離保護。
- **無狀態認證**：Telegram Mini App 採用標準 Telegram `initData` HMAC-SHA256 密碼學校驗。
- **後端鑑權**：Bot 與 Worker 之間採用專屬 `X-Service-Secret` 雙向簽章，確保外部無法直接偽造首領攻擊或玩家獎勵發放。
