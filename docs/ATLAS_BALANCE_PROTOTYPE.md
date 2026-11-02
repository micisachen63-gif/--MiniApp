# Atlas 掛機原型：平衡樣本、永久任務與資產保留

更新日期：2026-11-02。本文描述開發中工作樹的原型，不是正式機玩家統計，也不是最終平衡報告。檢查時的基底提交為 `3c6729aa9167223a3a915c5dc19fcc075cbad0ed`；Atlas 變更仍在其上的工作樹，重現需包含本批 Atlas 程式與遷移。

目前戰鬥規則為 `atlas-v1`，平衡設定為 `prototype-20261101`，任務規則為 `atlas-quests-v1`。正式發布的功能旗標維持關閉；只有明確設定 `ATLAS_ENABLED='true'` 才能開啟新的 Atlas 操作。未設定旗標等同關閉。正式機角色、裝備、強化與經濟分布尚未取得可用基準，因此本文不能作為開啟正式服的依據。完整賽季結束流程，包括維護階段的排空、跨資料庫匯入與實際維運驗收，仍未全部完成，不得把局部移轉測試視為賽季已可上線。

## 1. 這一版實際包含什麼

戰鬥保留原有 12 個地圖主題，先實作三張教學星圖和一個首領試煉。四職各三個流派，共 12 個機制方向；每組配置包含一個主技能、最多兩個輔助與一種自動施放策略。首版派遣最長 28,800 秒、最多 96 張同類星圖，每次結算最多推進 2,000 個步驟，仍未追完的時間由後續呼叫繼續處理。這些上限是原型規格，不是已驗證適合正式玩家的節奏。[規則目錄](../worker/src/game/atlas-catalog.js)、[純戰鬥引擎](../worker/src/game/atlas-engine.js)

| 星圖 | 等級門檻 | 前置完成 | 主要定向材料 |
| --- | ---: | --- | --- |
| `laurel_intro` 月桂林教學 | 1 | 無 | 月桂精鐵 |
| `pillar_intro` 百柱神殿教學 | 5 | 月桂林教學 | 神殿餘燼 |
| `grove_intro` 聖林教學 | 10 | 百柱神殿教學 | 聖林毒晶 |
| `laurel_warden` 月桂試煉 | 10 | 聖林教學 | 守望者核心 |

每趟出征由伺服器建立種子，保存當下的 `computeStats` 戰力、主技能、輔助、施放策略、敵人與平衡設定快照。敵人的基礎能力由地圖決定，不跟著玩家的裝備同比放大。原有 `enhance_level` 已經參與角色能力計算；盜賊的原生每擊倍率也已經包含在 `atk`，引擎不能再乘一次。途中改下一趟配置，不會改寫正在執行的出征。[能力計算](../worker/src/game/stats.js)、[Atlas 服務](../worker/src/services/atlas.js)

出征保留實際背包中的 `red_1`、`blue_1`，結束退回未使用數量；死亡終止整條佇列，沒有自動復活後繼續耗藥。已通過房間的獎勵保留，未完成地圖不發完整通關獎勵。Atlas 啟動期間，原掛機結算不再同時產出另一份收益。這是有限預算的派遣模型，不能把單場結果直接外推為永久連續掛機收入。[Atlas 服務](../worker/src/services/atlas.js)、[玩家服務](../worker/src/services/player.js)

## 2. 這次可重現的樣本

以下所有戰鬥表格來自同一次固定輸入試跑，沒有混用先前的隨機服務種子。執行環境為 Node `v24.22.1`。

| 輸入 | 本次值 |
| --- | --- |
| 新手裝備 RNG | 每職各自重新建立 `mulberry32(7)` |
| 戰鬥與掉落種子 | `atlas-doc-20261102` |
| 出征起點 | `2026-11-02T00:00:00Z` |
| 派遣上限／張數 | 3,600 秒／1 張，通關即停止 |
| 攜帶紅水／藍水 | 各 20 瓶 |
| 每瓶恢復 | 紅水 50 HP、藍水 40 MP，讀取原版 `POTIONS` |
| 補給估價 | 紅水與藍水各 6 金，讀取原版 `POTIONS` |
| 技能配置 | 各流派目錄中的推薦輔助與推薦自動施放策略 |
| 平衡 profile | `prototype-20261101`，敵人／獎勵／移動倍率均為 1 |

### 2.1 真正創角流程的四職入門快照

樣本呼叫原有 `P.createCharacter`，取得一級角色及實際發放的兩件 `source='starter'`、`+0` 裝備，再將原版 `computeStats` 的結果交給純引擎。沒有給角色完整標準套裝，沒有改寫正式玩家。這是「真正創角程式產生的本機樣本」，不是抽取四名正式玩家，也不是整段 API 結算流程的效能測試。[創角流程](../worker/src/services/player.js)、[模擬工具](../worker/src/game/atlas-balance.js)

四職均使用目前服務預設選取的第一個本職業流派，測試月桂林教學圖：

| 職業／流派 | ATK／DEF | 最大 HP／MP | 完成秒數 | 消耗紅／藍 | 金幣毛額 | 補給重置成本 | 扣補給後淨額 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 劍士／旋風掃蕩 | 25／15 | 148／33 | 137 | 3／2 | 60 | 30 | 30 |
| 弓箭手／穿透獵風 | 26／10 | 113／44 | 129 | 3／1 | 60 | 24 | 36 |
| 法師／雷鏈清場 | 27／8 | 94／69 | 105 | 2／3 | 60 | 30 | 30 |
| 盜賊／層毒蔓延 | 15／6 | 69／48 | 107 | 4／2 | 60 | 36 | 24 |

四筆的終態都是 `completed`，各取得星圖碎屑 11、月桂精鐵 1。本表未加入任務領獎。淨額使用 `金幣毛額 − 已用紅水 × 6 − 已用藍水 × 6`，代表補回消耗品的估算成本；實際出征先保留已持有的藥水，並不另外從金幣再扣這筆估價。

這只證明上述四個固定快照、推薦配置、種子和攜帶量可以完成第一張圖。它沒有證明所有新手裝備浮動、低血入場、補給不足、連續多張、升級進程或其他流派都能形成正收益循環，也不能從四筆成功計算正式玩家通關率。

### 2.2 十二流派的同批機制比較

這一組刻意改用十級、原版 `standardSet(baseClass, 10)` 的完整普通 `+0` 標準套裝，以方便同一職業的三個流派互相比較。它是人工測試快照，並非創角發放內容。各職仍沿用自己的原生能力，並未強行設成相同 ATK；各流派使用各自推薦輔助，所以結果衡量的是「整套推薦配置」，不能單憑表格分離某一個係數的效果。[標準套裝與能力計算](../worker/src/game/stats.js)

時間包含入場與房間移動。「清群秒數」是四間一般房間的戰鬥時間總和，不含精英與移動；首領總秒數包含 15 秒入場。表內 24 趟都完成，但每個格子只有一個種子，沒有平均值或信賴區間。

| 流派 | 推薦輔助 | 聖林總秒數 | 清群秒數 | 聖林紅／藍 | 首領總秒數 | 首領紅／藍 | 聖林／首領淨金幣 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 旋風掃蕩 | 擴散、節流 | 187 | 82 | 7／1 | 196 | 14／2 | 152／44 |
| 裂傷追獵 | 延續、擴散 | 110 | 42 | 1／0 | 93 | 3／1 | 194／116 |
| 壁壘反擊 | 護持、節流 | 197 | 96 | 0／0 | 192 | 0／0 | 200／140 |
| 穿透獵風 | 擴散、節流 | 163 | 74 | 6／1 | 160 | 11／1 | 158／68 |
| 靈獸協擊 | 凝聚、節流 | 121 | 60 | 2／0 | 82 | 3／0 | 188／122 |
| 棘網爆發 | 擴散、護持 | 139 | 56 | 0／2 | 140 | 0／4 | 188／116 |
| 雷鏈清場 | 迅發、節流 | 111 | 36 | 2／5 | 114 | 7／8 | 158／50 |
| 冰盾消磨 | 擴散、節流 | 181 | 84 | 0／0 | 184 | 0／0 | 200／140 |
| 秘法燃魔 | 凝聚、節流 | 117 | 60 | 2／2 | 72 | 3／1 | 176／116 |
| 層毒蔓延 | 延續、擴散 | 115 | 46 | 8／1 | 94 | 10／2 | 146／68 |
| 印記處決 | 凝聚、節流 | 139 | 76 | 8／0 | 92 | 10／0 | 152／80 |
| 鏡刃連擊 | 迅發、節流 | 179 | 108 | 12／3 | 109 | 12／5 | 110／38 |

### 2.3 已知差距與下一次校準重點

這一批資料顯示機制已經會改變戰鬥，但仍不能稱為平衡完成：

- **流血與召喚偏強。** 裂傷追獵在本批聖林的清群、總時間與消耗都優於同職旋風；靈獸協擊也同時優於穿透配置的兩張地圖時間與紅藍消耗。需檢查暖機、轉火、傷害支持連動及持續輸出的成本，讓其他流派有可以解釋的適用場景。
- **反擊、冰盾的節省效果很明顯。** 本次兩張圖均未使用藥水，但完成時間較長。這是這些快照與敵人組合的結果，不代表所有地圖都能零消耗。需要對不同敵人攻擊頻率、玩家裝備與長佇列補給做驗證。
- **雷鏈清群快，補給取捨已出現。** 本批清群只需 36 秒，卻比多個持續傷害配置使用更多藍水。秘法燃魔的首領戰快，且因戰鬥提早結束，這次實際藍水也比雷鏈少；「耗魔」標籤本身不能代替實測成本。
- **穿透、旋風及連擊需要更清楚的優勢。** 尤其鏡刃連擊在這批聖林慢且耗藥，尚不足以支持推薦玩家選它。後續應檢查目標數、追擊轉火與輔助搭配，不先用放大整個職業的方式掩蓋機制問題。
- **目前沒有完整終局經濟。** 只有三種定向鍛造配方，每件裝備最多三次。守望者核心已可獲得與累計，但現行三個配方尚不消耗它。百圖里程碑也不能被當作已驗證的三十日內容量。需補足材料用途與長期選擇後再評估耐玩度。[現行配方](../worker/src/services/atlas.js)

在取得正式基準前，不依這批低等樣本全面削減既有玩家能力、不降低既有強化值，也不把所有流派調成免費運行。先保留可配置 profile 與可重播快照，之後針對具體問題調整候選設定。

## 3. 如何重現

在儲存庫根目錄、已安裝依賴且使用 Node 24 的環境執行。程式只使用記憶體 SQLite 的 `freshDb()`，不連線、不讀取或變更正式 D1；輸出 JSON 留在 `/tmp` 作本機分析。每次以相同工作樹執行，數值表應相同；隨機裝備 ID 不參與能力或戰鬥種子。

```bash
node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';
import { freshDb } from './worker/test/d1-shim.js';
import * as P from './worker/src/services/player.js';
import { mulberry32 } from './worker/src/game/rng.js';
import { computeStats, standardSet } from './worker/src/game/stats.js';
import { POTIONS } from './worker/src/game/constants.js';
import {
  ATLAS_BUILDS, ATLAS_RULESET_VERSION, ATLAS_PROTOTYPE_PROFILE,
} from './worker/src/game/atlas-catalog.js';
import { benchmarkAtlasRun } from './worker/src/game/atlas-balance.js';

const now = Date.parse('2026-11-02T00:00:00Z');
const seed = 'atlas-doc-20261102';
const common = {
  realmId: 'permanent', startAt: now / 1000, seed,
  durationSeconds: 3600, mapCount: 1,
  supplies: {
    hp: 20, mp: 20,
    hpRestore: POTIONS.red_1.heal, mpRestore: POTIONS.blue_1.heal,
  },
};
const env = {
  DB: freshDb(), ATLAS_ENABLED: 'true',
  REALM_CONTEXT: { id: 'permanent', type: 'permanent' },
};
const out = {
  settings: {
    node: process.version, seed, gearRng: 7,
    startedAt: new Date(now).toISOString(), durationSeconds: 3600,
    mapCount: 1, supplies: common.supplies,
    supplyPrices: { hp: POTIONS.red_1.price, mp: POTIONS.blue_1.price },
    rulesVersion: ATLAS_RULESET_VERSION, profile: ATLAS_PROTOTYPE_PROFILE,
  },
  starter: [], comparison: [],
};
const simulate = (snapshot, build, mapId, runId) => benchmarkAtlasRun({
  ...common, runId, mapId, snapshot, buildId: build.id,
  supports: build.recommendedSupports,
  automation: build.recommendedAutomation,
}).summary;

try {
  for (const [index, baseClass] of ['sword', 'archer', 'mage', 'thief'].entries()) {
    const player = await P.createCharacter(env, {
      tgId: String(99001 + index), name: `測試角色${index}`,
      gender: 'm', baseClass,
    }, now, mulberry32(7));
    const stats = computeStats(player.char, player.equipment);
    const build = ATLAS_BUILDS.find(row => row.baseClass === baseClass);
    const snapshot = {
      ...stats, characterId: player.char.tg_id, baseClass,
      hp: player.char.hp, mp: player.char.mp,
    };
    out.starter.push({
      baseClass, buildName: build.name,
      equipment: player.equipment.map(item => ({
        slot: item.slot, source: item.source, tier: item.tier,
        grade: item.grade, base_stat: item.base_stat,
        enhance_level: item.enhance_level,
      })),
      stats: {
        level: stats.level, atk: stats.atk, def: stats.def,
        maxHp: stats.maxHp, maxMp: stats.maxMp,
      },
      summary: simulate(snapshot, build, 'laurel_intro', `doc-starter-${baseClass}`),
    });
  }
  for (const build of ATLAS_BUILDS) {
    const character = { base_class: build.baseClass, class_path: '', level: 10 };
    const stats = computeStats(character, standardSet(build.baseClass, 10));
    const snapshot = {
      ...stats, characterId: `doc-standard-${build.baseClass}`,
      baseClass: build.baseClass, hp: stats.maxHp, mp: stats.maxMp,
    };
    out.comparison.push({
      buildId: build.id, buildName: build.name,
      stats: {
        level: stats.level, atk: stats.atk, def: stats.def,
        maxHp: stats.maxHp, maxMp: stats.maxMp,
      },
      grove: simulate(snapshot, build, 'grove_intro', `doc-grove-${build.id}`),
      boss: simulate(snapshot, build, 'laurel_warden', `doc-boss-${build.id}`),
    });
  }
} finally {
  env.DB.sqlite.close();
}
writeFileSync('/tmp/atlas-balance-prototype-sample.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
NODE
```

`benchmarkAtlasRun` 另外提供每有效小時淨金幣、每規劃小時淨金幣，以及指定下一次提升成本的估算欄位。前者除以真正消耗的秒數，後者除以原訂派遣長度；一張圖提早完成後，不會憑空把剩餘一小時補成更多場。`nextUpgradeActiveSeconds` 只在完成且樣本能取得所有目標資源時提供估算，否則為 `null`。這些都是有限模擬的換算，不是玩家實際每小時收入或留存數據。[模擬工具](../worker/src/game/atlas-balance.js)

## 4. 永久世界的 18 項任務

以下均為已實作的原型獎勵，只有少量 Atlas 材料，金幣與經驗獎勵均為零。沒有登入連續獎勵，也沒有帳號共用的戰力增益。主收入來自實際出征；日常和週任務是額外方向，不能用打卡取代遊玩。數量仍待正式經濟基準校準。[任務規則](../worker/src/game/atlas-quests.js)

表中「碎屑／精鐵／餘燼／毒晶／核心」分別是星圖碎屑、月桂精鐵、神殿餘燼、聖林毒晶、守望者核心。

| 類別 | 任務 ID | 實際完成條件 | 原型材料獎勵 |
| --- | --- | --- | --- |
| 新手 | `intro_build` | 保存流派配置 1 次 | 碎屑 2 |
| 新手 | `intro_departure` | 成功登記出征 1 次 | 碎屑 2 |
| 新手 | `intro_clear` | 完整通關任一星圖 1 次 | 碎屑 2、精鐵 1 |
| 新手 | `intro_craft` | 成功定向鍛造 1 次 | 碎屑 2 |
| 新手 | `intro_boss` | 完成月桂首領試煉 1 次 | 碎屑 3 |
| 每日 | `daily_workshop` | 當日成功定向鍛造 1 次 | 碎屑 1 |
| 每日 | `daily_theme` | 當日通過指定主題星圖 1 次 | 碎屑 2 |
| 每週 | `weekly_three_themes` | 當週完成三種不同主題的星圖 | 碎屑 3、精鐵 1 |
| 每週 | `weekly_three_builds` | 當週以三種不同流派完成星圖 | 碎屑 3、餘燼 1 |
| 長期 | `explore_1_10` | 月桂林教學累計 10 次 | 碎屑 3、精鐵 1 |
| 長期 | `explore_1_50` | 月桂林教學累計 50 次 | 碎屑 5、精鐵 2 |
| 長期 | `explore_2_10` | 百柱神殿教學累計 10 次 | 碎屑 3、餘燼 1 |
| 長期 | `explore_2_50` | 百柱神殿教學累計 50 次 | 碎屑 5、餘燼 2 |
| 長期 | `explore_3_10` | 聖林教學累計 10 次 | 碎屑 3、毒晶 1 |
| 長期 | `explore_3_50` | 聖林教學累計 50 次 | 碎屑 5、毒晶 2 |
| 長期 | `warden_3` | 月桂首領試煉累計 3 次 | 碎屑 3、核心 1 |
| 長期 | `warden_15` | 月桂首領試煉累計 15 次 | 碎屑 5、核心 1 |
| 長期 | `atlas_100` | 任意星圖累計 100 次 | 碎屑 6 |

### 期別與來源

同一永久環境的同帳號角色共用進度，沒有換角色再領一份的機會。週任務的三種流派以實際通關時的出征快照計數；只保存三套配置不算三次實戰。主題輪替只使用目前已開放的月桂、神殿、聖林；月桂首領可以計入月桂「主題」條件，但不算月桂「教學星圖」踏查次數。長期目標不要求尚未開放的其餘九個主題。

每日按台北時間零點分日，已完成獎勵可在完成當日與其後兩日領取，總共三個日曆日。每週使用台北時間的 ISO 週，已完成獎勵延長到該週結束後七日。補領不會補造過去的遊玩紀錄；在錯過的日期沒有完成事件，就沒有那期獎勵。新手與長期目標沒有到期日。

`configure`、`start`、`craft` 事件與其原始操作的資產變更、收據在同一個交易中寫入。通關事件必須來自引擎 `completion` 獎勵，其時間為：

```js
occurredAt = (run.startedAt + reward.elapsedSeconds) * 1000;
```

因此離線跨日後才回來結算，進度仍落在真正通關的日／週；不使用打開畫面、輪詢或領獎的時間重算。重試同一個 `sourceId` 不會新增進度；同一來源若改送不同內容會整筆回滾。[服務接線](../worker/src/services/atlas.js)、[事件與領獎服務](../worker/src/services/atlas-quests.js)

### 領獎、材料與功能回滾

領獎唯一鍵為 `(account_id, quest_id, period_key)`，操作收據另外按帳號與 `requestId` 去重。進度查核、角色選取防護、領獎紀錄、材料增加與帳本紀錄在同一個 SQL batch 中完成。任一環節失敗不會留下半筆材料。材料存放在當次領獎角色的 `rpg_atlas_materials`，不是同帳號每隻角色都複製一份。[資料庫約束](../worker/migrations/0037_atlas_quests.sql)

換角色後重播已完成的領獎，仍返回原收據與 `rewardCharacterId`，不改變原收件角色；失去網路回應、跨日或過期後，用原成功請求重試也會核對到已提交的收據。查詢只讀實際事件與收據，不會因為開啟任務畫面而推進任務。

永久任務同時檢查伺服器環境與資料庫身分，賽季不能領永久獎勵。關閉 `ATLAS_ENABLED` 後不再開放新的任務領獎，但既有成功請求仍可核對；已開始的 Atlas 出征仍可結算／停止，退回未用補給，並記錄真正發生的完成事件。這些行為用來保護回滾期間的資產，不代表在環境進入正式維護封存後可以繞過資料庫寫入防護。[任務服務](../worker/src/services/atlas-quests.js)、[Atlas 服務](../worker/src/services/atlas.js)

## 5. 已驗證的規則與待完成的正式驗收

本次直接執行以下命令：

```bash
node --test --test-isolation=none --test-reporter=tap worker/test/atlas-engine.test.js worker/test/atlas-balance.test.js
node --test --test-isolation=none --test-reporter=tap worker/test/atlas-quests.test.js
```

第一組實際執行 16 個案例，全部通過；第二組實際執行 20 個案例，全部通過，沒有跳過。此處列的是本次核對的範圍，不代替完整 `npm test`、GitHub 必要檢查、瀏覽器操作驗收或正式環境檢查。

規則測試涵蓋相同時間的分段結算等價、JSON 儲存後繼續結算、八小時絕對上限、死亡停止、持續傷害最後擊殺、無法支付技能時不空燒藍水、同地圖更強裝備仍有提升，以及各機制確實參與戰鬥。任務測試包含真正的 configure/start/settle/craft 接線、離線跨日／週、同帳號跨角色唯一、併發與失去回應後重試、帳本失敗全筆回滾、季服拒絕與旗標回滾。[引擎測試](../worker/test/atlas-engine.test.js)、[流派測試](../worker/test/atlas-balance.test.js)、[任務測試](../worker/test/atlas-quests.test.js)

既有流派回歸測試使用十級完整標準套裝、12 流派、3 教學圖、3 個固定種子，共 108 個模擬情境。它是回歸樣本，與本文真正兩件新手裝備的四筆資料不同；不能因測試名稱含有 starter recommendations，就把它當作正式創角裝備驗證。服務層另有實際新手、`+N` 保留、補給退款、斷線重試、舊掛機互斥、組隊互斥、截止時間與中途停止測試。[服務測試](../worker/test/atlas-service.test.js)

### 正式 baseline 與 Beta 最少度量

取得經授權的正式機唯讀基準後，至少要保留匿名的職業／轉職、等級、裝備類型與品質、強化值、現行能力、補給存量、金幣與當前取得速度分布。不要用本文的單一十級標準套裝代替所有投入程度的玩家。基準不必包含 Telegram 名稱或其他可識別個資。

| 問題 | 至少記錄的數據 | 比較方式 |
| --- | --- | --- |
| 能否安全完成派遣 | 完成數、死亡數與原因、完成所需秒數、未完成房間 | 同一匿名快照與固定種子，分職業、投入程度、補給預算比較 |
| 清群與單體是否有取捨 | 一般房間／精英／首領戰時間，實際紅藍耗量 | 同職不同配置；同配置不同敵人組合，另做多種子分布 |
| 能否維持遊玩 | 毛金幣、藥水替換成本、淨金幣、材料來源與消耗 | 同時看有效小時與整段離線時間，包含失敗及提早停止 |
| 下一次提升是否可理解 | 指定配方所缺材料、實際取得時間、鍛造後改變 | 同角色鍛造前後使用相同地圖與種子，不偷偷提高敵人能力 |
| 任務會不會變成主要收入 | 任務材料占總取得比例、領獎與實際事件吻合度 | 以原型目標比較有做與沒做日常的正常遊玩，不先假定打卡必要 |
| 資產與收據是否安全 | 重複獎勵、負庫存、遺失物件、變更的強化或欄位 | 必須為零；競態、重播、斷線及回滾均驗證 |

Beta 至少要證明各職入門路徑在合理補給下可持續、各推薦流派有可說明的適用場景、失敗能解釋且不會無限燒資源。高投入玩家必須用自己的原始快照檢查改版前後的能力、補給、每小時淨收益與下一次提升時間。是否需要改敵人、配方或收益，要以這些資料決定，門檻需在開放測試前明訂。本文沒有任何正式玩家留存率、三十日遊玩率或長期經濟穩定性的實證。

## 6. 玩家保留原則

永久環境延續玩家已有角色、裝備、強化、天使、輪迴／旅章、鍛造、組隊、交易與圖鑑資產及入口；新介面與新玩法不得成為刪除或重建舊角色的理由。Atlas 只接收現行能力快照，定向鍛造使用既有物件的受控更新，保留 `enhance_level`、原有詞綴與其餘中繼資料。讀取能力不等於所有天使、輪迴或組隊的主動機制已完整進入新戰鬥；每個入口與操作仍需按原功能驗收。[資產保留工具](../worker/src/realm/asset-preservation.js)

賽季環境需使用獨立角色、物品、交易、任務與進度，不能把永久天使、輪迴、圖鑑知識或帳號增益當作隱藏數值帶入新賽季。保存永久資產與維持賽季公平要同時成立：不刪永久投入，也不讓新賽季角色繼承數值優勢。季末角色與物品的保留、超出一般創角欄位的安置、凍結期結算、跨庫匯入與失敗重試，都需要完整操作流程與驗收；目前仍是正式開季前的必要門檻。

本版只建立第一個可操作、可結算、可核對資產的核心循環。後續的流派深度、材料消耗與長期目標要在正式基準上增加，不用清空帳號、抹平強化或讓敵人同步成長來製造內容長度。
