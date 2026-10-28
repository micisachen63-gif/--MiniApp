2026-10-28 角色刪除：選角按鈕＋名稱與勾選確認，帳號每日台北日一次、重建正常新手禮。0034 加 nullable deleted_at／archive／live及origin views；一筆 INSERT trigger 原子收尾，活動與 stale write 保護、收據恢復、防錯帳號與睡眠補算，所有遊戲讀取 live view 並保留舊 SQL alias。元資料先僅0034（正式尚有0026–28未登記，不全量apply），再正常 Worker發布；具體人類授權刪角另用受限單筆INSERT的原服務維護工具，固定原ID、查核與備份留.release-sync，不上Git或發TG。18測試＋320/390/1280真UI/API，完整結果看CI與日誌；詳見docs/CHARACTER_DELETE_20261028.txt，正式版本看deployment-records。

2026-10-28 掛機經驗回饋：首頁顯示目前／升級所需經驗，最近結算顯示實際增加、死亡損失與升級。me 唯讀取同角色且 to_at 不超過回應快照的已提交最近紀錄，與 report 動畫／背包記帳分離；切角清除提示，舊角色／版本回應不污染。320／390／1280 真 MiniApp/API 驗證 cron、30 秒自動更新、重複讀取、延遲舊 me、切角、直接結算、升級、大數字與滿級；無遊戲數值／migration／BOT 變動，快取 exp-progress1。詳見 docs/IDLE_EXP_PROGRESS_20261028.txt，正式版本以 deployment-records 為準。

2026-10-28 全職業尺寸：248造型原hero留白使男性二轉劍士尤其小。遠征lobby/battle接既有alpha fit，戰場42%arena擴繪但姓名/腳線不變、輪廓場內5px，containedActor同步visibleRect避免動畫跳大；保留原圖/倒地、清理斷開及lazy observer、完整快取visible-body1。4960 placement零裁切、手機四職中位可見高約95%slot，B1男戰場61.7→167px；寬橫劍低姿勢保留比例。全量/動畫/真API跨畫面QA與限制見docs/HERO_VISIBLE_SIZE_20261028.txt，無遊戲數值／DB／BOT改動，正式看deployment-records。

2026-10-28 商店篩選全選100件：分類／名稱加品質與T階，全選僅當前結果前100件，換條件及切角清勾選；件數金額固定底部、珍稀明細確認及背景／穿戴／託管保護保留。後端max100，批刪用json_each兩綁定參數、精確changes／rev與一次帳本防重保留；第100件競爭回滾、重疊100防重及390／1280真UI105選100／333300金／取消／切角驗收見docs/SHOP_FILTERED_SALE_100_20261028.txt。無經濟／migration／BOT，快取filter100-1，正式看deployment-records。

2026-10-28 無坦評價補修：optionalGuard仍被finalMatch.missing鎖B，改排除guard降評；advance在新階段計算前設guardRatingVersion=2，涵蓋舊進行中標準隊，已存results／收據不回寫。原戰鬥及收益配方不改，無坦可得真A／S與對應經驗／終章額外裝備。72組戰鬥hash一致、三版A/S與各1000份A掉裝、兩類既有隊真收據／裝備／防重及390／1280實際UI驗收見docs/STAR_RING_GUARD_RATING_20261028.txt。無migration／BOT；快取guard-rating1，正式看deployment-records。

2026-10-28 遠征守護改可選：高難度只強制三個不同隊員分擔破陣／支援／壓制，新出發含既有招募加optionalGuard快照，僅缺守護不鎖傷害，實際盾／承傷／分工評價不改；舊running無旗標完整保留。集結／選單／須知同步，無migration／數值／掉率／BOT改動。Lv40／90真12h30收據與防重、三缺職責拒絕及390／1280真MiniApp出發驗收見docs/STAR_RING_OPTIONAL_GUARD_20261028.txt；正式版本看deployment-records。

2026-10-27 切角可做清單：材料／金幣既有完整select同步保留；背景工坊統一只呈現目前角色，選角隱藏但帳號作業不刪不停止。api的character_changed恢復增加請求actor及epoch，防舊讀取409把新S.me清空，A→B→A亦保護；真現役衝突仍重選。四新回歸＋390／1280真API SQLite四情境，故意延遲me／shop／背景成功與真409，快速往返零重載、兩角色材料金幣及作業提示分離。讀docs/CHARACTER_ACTION_BOARD_20261027.txt；快取character-board1，僅Worker前端無DB／經濟／作業執行／BOT變動。正式版本看deployment-records。

2026-10-27 現在可以做完整盤點：補水須付完整24h費且指定水已解鎖；強化／詞條重鑄驗組隊、同角色背景作業、託管、缺卷＋工費，重鑄改看詞條品質並支援+15；購裝驗目前角色清單／路線／等級／金額；首領用me個人CD與倒地資料，撤未開始倒數。所有點擊先full me核對、購裝再取商店，保留actor／epoch／頁面／防連點，不開過期操作。14新測試與24集中測試、390／1280真API SQLite180金6卷單次扣款、179金過期點擊／作業／首領CD通過。讀docs/ACTION_BOARD_READINESS_20261027.txt；快取action-ready1，僅Worker無經濟／規則／DB／BOT變動。正式版本看deployment-records。

2026-10-27 轉職假提示：gate.canAdvance僅代表等級達標，首頁任務誤寫材料已到手。首頁門檻／現在可以做／傳承紅點統一還要have>=1；缺料顯示等待與實際數量，保留路線預覽與原disabled。四職一至四轉及390／1280真API SQLite完整轉職扣料驗收。讀docs/ADVANCEMENT_READY_PROMPT_20261027.txt；快取advance-ready1，僅Worker前端，無轉職規則／數值／DB／BOT改動。正式狀態看deployment-records。

2026-10-26 環身特效移出人物：撤前景光帶，原透明圖等比例左右面板向身側分離／內緣漸隱，光流掃光與星點全部低於人物；五人遠征與短隊共用低場景層，避免蓋隊友。248造型×3×8×2=11904檢查，四職真API全畫面與五人穿戴；48組開關特效比較1033593近不透明人物像素，無超透明度容許範圍覆蓋。讀docs/SURROUND_OUTSIDE_BODY_20261026.txt；快取perimeter1，僅Worker呈現，無數值／權益／migration／BOT。正式版本看deployment-records。

2026-10-26 環身特效華麗度：內建imagegen三款新版金羽／月牙晶光／紫金碎晶，透明WebP合計386KB；前後分層加掃光、六顆雙軌反向彗星、多人亮度與錯峰保留。非同步縮放後軌跡以即時像素尺寸更新，防沿舊框跑。248造型×3×8完整週期×2版型=11904檢查，四職真API全流程含五人同時穿外觀；原ID／擁有權／價格／戰力不改。讀docs/SURROUND_LUXURY_20261026.txt，原圖／完整提示／QA在worker/art-production/star-ring-surround-20261026；僅Worker無migration／BOT，正式版本看deployment-records。

2026-10-25 星環外觀重製：依使用者改環身光流，內建imagegen三款透明新圖，前後景遮罩／星點軌跡／穩定錯峰，依可見身高等比定位與框內裁切；撤足下盤及掛機上移，不轉動整張bitmap。248造型×3主題×8時點×2版型=11904檢查＋四職真API全畫面；隱藏暫停、reduced-motion、男女／手機與動態預覽。讀docs/SURROUND_AURA_ART_20261025.txt；/preview-star-ring-surround.html；原圖／提示／QA在worker/art-production/star-ring-surround-20261025。既有IDs／擁有權／價格／戰力不改，僅Worker無migration／BOT，正式版本看deployment-records。

2026-10-25 光環跨畫面顯示：共用alpha腳底定位跟隨圖片load／尺寸／正規化，掛機依真戰報高度留地面並重算背景載入atlas；打寶爬塔圖層、自他英雄武裝、殿堂實際圖騰及防重／清理，遠征衣櫥即時讀回外觀。5新UI回歸＋390／1280px四職真API全畫面與三外觀穿卸驗收，衣櫥兌換／丟回覆同收據也重跑。讀docs/AURA_VISIBILITY_FIX_20261025.txt；僅Worker靜態前端，無migration／數值／快照／BOT改動，正式版本看deployment-records。

2026-10-25 衣櫥兌換無反應：preview paint誤用未定義scene，已快取圖重畫在try外拋錯導致busy永久卡住。改用原衣櫥幾何、重畫入try保證復原，戰場contain保留；主頁／iframe／示意頁快取版本更新。3新UI回歸＋25集中測試，390／1280px原碼重現與修後真API83→23解鎖一次、穿戴／卸下；丟失成功回覆同ID重試不多扣。讀docs/WARDROBE_REDEMPTION_FIX_20261025.txt；僅Worker、無migration／補發／價格改動，正式版本看deployment-records。

2026-10-21 組隊體力阻擋顯示：party/get成員帶stamina完整投影，readyAt沿原6分鐘anchor算到20門檻、不重算等待；隊員體力數字／按鈕旁不足名單、缺額、恢復時間及招募先到期提醒，出發／續刷鍵明示原因；現有輪詢恢復後才啟用。5新測試＋390／1280px真API隔離測試含全準備19點、自動輪詢回20、真出發只扣一次及真通關後低體力續刷提示。規則、恢復速率、扣除、獎勵皆不改。讀docs/PARTY_STAMINA_UI_20261021.txt；僅Worker無migration／BOT，正式狀態看deployment-records。

2026-10-21 組隊三技／離線補驗：風縛箭陣addsOnly僅限制首領戰的附帶減傷，修autoPartyAction錯跳過整招1.8A傷害，三種玩法共用；遠征事件顯示實際技能名。9新回歸，普通／職責打寶爬塔真排程對照，以及遠征v1–v3完整12h／各30份收益與五人背包、MP／CD對照；重跑不重發、遠征不覆蓋live配置，無倍率／時程／獎勵常數改動。既有未處理回合適用，已結算階段不回寫。讀docs/PARTY_THREE_SKILLS_OFFLINE_20261021.txt；僅Worker無migration，正式狀態看deployment-records。

2026-10-21 普通掛機技能防飢餓：成功自動施放後持久輪替下一格，保留每分鐘一動、各招CD／條件／魔力／預算、手動優先與無特殊技後備行動；首次兩招以上自動結算保護舊離線分鐘，不改遠征或短戰快照。補給低耗水改文字，指定水種非地圖使用限制。8新回歸＋390／1280px隔離真API驗收；實際配置6h模型360／0／0改120／120／120，回魔足所以仍0藍水，功能型技能輪替會影響收益，未調倍率補償。讀docs/IDLE_AUTO_ROTATION_POTION_20261021.txt；僅Worker無migration，正式版本看deployment-records。

2026-10-21 星環群組直接加入準備：招募主鈕改Telegram callback，驗指定群組／成員／原卡ID，Worker服務以帳號選目前角色、原子active guard與跨角色操作收據恢復；零開遊戲／私訊／自動啟程，不扣出發次數。舊卡正常維護每次最多2張同訊息改按鈕，純SELECT投影、失敗退避、不猜pending；running/complete以private start提供web_app戰況入口，修mainMiniApp=false卻硬用startapp問題。12 Worker＋4 BOT新增隔離測試。讀docs/STAR_RING_TELEGRAM_JOIN_20261021.txt；先Worker後BOT，無migration／玩家重設，正式狀態看deployment-records。

2026-10-20 中高等PVE難度v2：普通Lv31起壓力／菁英曲線，第一次實際結算保護舊離線分鐘；新出發45+打寶固定敵方HP／反擊／防禦尺度，強裝更快更省水，不隨隊伍ATK拉血。背包紅水依原門檻／種類、只在真正反擊前飲用，離在線原子扣紅藍水／獎勵防重；舊已出發照原快照。低階30、塔／試煉／世界首領／遠征與所有裝備能力／掉率／體力不改。2592掛機模型0死、藥費最高14.33%，270真連刷通關，強化裝0倒地。讀docs/PVE_DIFFICULTY_V2_20261020.txt與docs/economy/PVE_BALANCE_V2_20261020.json；僅Worker、無migration，正式狀態看deployment-records。

2026-10-20 技能進修保命補驗：不屈血誓延長保護跨分鐘後，普通掛機實際擋下致命菁英時立即持久扣除唯一保命次數；非致命不扣，避免同次施放跨兩分鐘重複保命。固定seed真掛機重現修前失敗／修後通過，見docs/IDLE_LAST_STAND_SINGLE_USE_20261020.txt；只Worker，無migration／怪物數值／掉率／裝備變動。

2026-10-20 打寶體力100／出發20／每小時10，三人原子扣除、舊已出發不追扣、爬塔與試煉／遠征豁免；技能Lv.1–10同書進修與四分之一碎片回收，內容指紋與早讀競爭收據恢復，遠征快照不變；首頁真running遠征專屬GROK動畫／掛機暫停與返回戰況，短隊借位仍顯示，完成恢復。無migration／BOT／怪物調值。讀docs/PARTY_STAMINA_SKILL_MASTERY_HOME_20261020.txt；另有唯讀普通圖與組隊難度盤點docs/MAP_DIFFICULTY_AUDIT_20261020.txt，不宣稱已平衡高階怪物。正式狀態看deployment-records。

2026-10-20 原隊連刷沿用群組圖卡：既有訊息更新第N場、GIF／按鈕／連結；每場戰鬥／獎勵仍獨立。根通知JSON指標與續開原子提交、BOT根鍵序列化／場次rev防回退、dirty重啟／defer競爭處理，舊通知與更新按鈕定位最新場；重新開隊才新卡。8新測試含三場真戰鬥九收據隔離整合，無真TG測訊。讀docs/PARTY_REPEAT_SINGLE_CARD_20261020.txt；先BOT再Worker，無migration，正式狀態看deployment-records。

2026-10-20 爬塔展開區塊修正：5／30秒輪詢不再重建未變的徽記操作面板；保留稱號／塔印／兌換各自展開與收合、裝備選項及聚焦選單，真數據更新仍保留開關，跨角色不延續。隊伍／角色輪詢不停；無經濟／API／DB／BOT變動。真MiniApp隔離390／1280px跨35秒驗收，讀docs/TOWER_PANEL_REFRESH_FIX_20261020.txt；正式狀態看deployment-records。

2026-10-20 組隊續開與爬塔徽記：同隊未離隊者保留準備，一場一個不可重設的戰鬥／獎勵紀錄，隊長續開滿三人直接出發，唯一後繼與舊收據防重；完場離隊保留歷史。爬塔每角色台灣日一次、出發才扣，舊已出發塔不改原收益／時程，新出發（含舊招募）最多15分鐘，三區全通10／15／20徽記、部分依真通關比例，保留最高層與旅團日誌。徽記兌換普通／祝福卷；塔印只成長既有裝備，每階2%主能力五階10%，20／30／45／65／90徽記，未穿戴／未託管／未背景作業才可，原強化詞條外觀保留；交易與轉武器保留，稱號純外觀。三版遠征全12h與30收益對照無變。讀docs/TOWER_BADGES_REPEAT_20261020.txt；僅Worker，無migration／BOT／新裝備／新美術。正式版本查deployment-records。

2026-10-20 強化能力預覽：equipmentView 由真 itemStat 提供+0..15主能力，詳情／單次儀式／目標選擇／自動確認均顯示目前→成功後與差值；成功後以新裝備更新下次與目標預覽，必過取消零消耗，+15無虛構+16。介面能力縮寫中文化，request-client僅轉描述欄位，保留名稱／數值／既有戰鬥資料；組隊iframe同步載入。新增9測試、360／390／1280px真API隔離UI操作，讀docs/ENHANCE_GAIN_PREVIEW_20261020.txt；僅Worker，無migration／BOT／經濟數值改動。正式狀態以deployment-records為準。

# 🤖 星穹旅誌 (Star Journal RPG) - AI 專案續行交接手冊 (AI_HANDOVER.md)

2026-10-20 遠征裝備件數v2：每2h保底8件、完整48–55件，最低傳說／25%能力優勢不變。新掉裝starRingYieldVersion=2回收為原基準18%，舊裝／補給所兌換不改，轉路線保留來源價版且不進戰鬥pct。running v1–v3下次階段新收據補足已領舊階段缺少的保底、穩定ID／catchup防重，原收據／已出售物品／戰鬥不回寫，完成與離隊歷史排除。批賣支援160字長ID。大廳／集結／須知／販售說明同步。10k件數／4級各1k金幣模型、11新相容測試與390/1280px真隔離API驗收見docs/STAR_RING_VOLUME_V2_20261020.txt，模型在docs/economy。僅Worker、無migration；正式狀態看deployment-records。

2026-10-20 裝備成長v2：T4起新增依部位/甲種成長的基礎能力，保留整條+0–15原強化收益；星征由15%改25%，遺物保護/詞條保留、不雙疊。不改物品row或升T補正版本、無migration。v1掛機基準不隨新版抬高，新增效率最多原配置10%且保留2倍總上限。圖例T3霸主+9仍918、T7星征傳說+7由490到1083。31萬組保值/1440效率/128組四職6h配對經濟模型；既有遠征/短戰actor與收據不改，新隊伍用新數值。細節/限制與驗證讀docs/GEAR_GROWTH_V2_20261020.txt，經濟JSON在docs/economy；僅Worker發布，正式狀態看deployment-records。

2026-10-20 管理登入補修：原startapp只開BOT的回報，改普通start短challenge＋私聊8碼批准＋原瀏覽器redeem，備援可複製同一指令；不需創角／MiniApp。批准由service binding再查即時群組管理權，原Cookie/CSRF/一次性收據保留。無migration，0033已安裝勿重跑；乾淨合main後先BOT再Worker，發布看收據。必成卷標籤改明確10px與圖示角落位置，修繼承48px造成撐開。驗證／接手讀docs/ADMIN_LOGIN_TELEGRAM_FIX_20261020.txt。

2026-10-20 管理後台v1：/admin/以MiniApp行為聚合／可解釋洞察及精準角色發獎為核心；Telegram真HMAC＋群組即時管理權、電腦一次核對碼／1h安全Cookie／CSRF；查詢不結算遊戲。發獎白名單、20角色批次、票券確認、原子帳本／入袋／收據與revision、防重與不確定結果恢復，不動當趟遠征／配置。0033僅加管理及聚合表／索引，合main後用worker/tools/admin-console-schema.mjs check/apply精準執行，不跑歷史migration鏈。新增84測試、真API390/1280px隔離驗收；BOT無改動。接手讀docs/ADMIN_CONSOLE_20261020.txt；是否正式上線看deployment-records收據，不能把文件當發布證明。

2026-10-20 星征專屬裝備與通知一鍵入隊：共用純解析器接32種512px alpha圖／192張TG品質卡（28張內建image_gen新圖、4張既有星環武器），前後端／交易source／分享一致；各T階共用種類造型，Tier與數值不改。舊ring_招募連結用上次active角色原select直達，以原子join-ready加入並準備，不自動出發／扣次；只邀請lobby本人執行一次，完成私訊／readonly／已出發只讀。新增29案例、390／1280px完整MiniApp真API驗收；普通入口選角保留，手動取消準備關閉重開不被覆蓋。讀docs/STAR_RING_DEDICATED_ART_JOIN_READY_20261020.txt與美術QA／prompts；無migration，先Worker再BOT，發布狀態看deployment-records兩份收據。

2026-10-20 星環遠征裝備收益：每兩小時未結算階段保底1件、完整6件；v3合法菁英5%／首領25%每階段最多額外1件，保留原終章評價額外，全趟最多13件。獨立掉裝RNG、不動戰鬥與其他收益；v1/v2僅新保底、無推測rank死亡。舊已領階段不重發，running剩餘階段即套用；完成DM累計改在配方替換後，與背包一致。最低傳說／當階段EXP後等級／15%優勢延續，created_at為該階段結束。新增11測試、10k條件經濟模型、390／1280px真API畫面驗收。讀docs/STAR_RING_GEAR_YIELD_20261020.txt與經濟JSON；僅Worker、無migration，正式版本看deployment-records。

2026-10-20 星征裝備修正：service終階依角色EXP入帳後等級產裝，最低傳說、同條件普通裝主屬性含強化／元素／flat副屬性+15%；原v1–v3戰鬥／掉落件數與其他收益不變。舊星征裝於withPlayer原子一次補正，保留強化與原詞條key/score，補足Tier詞條格；bonus_json.starRingGearVersion與唯一ledger防再次升階，轉武器保留標記。託管／背景作業／前景短戰延後，無migration。移除泛用胸甲／墜飾覆蓋，背包、TG圖與結算逐件圖用正確職業部位Tier。26新測試、390／1280px各13件真UI驗收。接手讀docs/STAR_RING_GEAR_FIX_20261020.txt；僅Worker發布，正式狀態看deployment-records。

2026-10-19 遠征換裝／天使配置放寬：equip／unequip、永久啟用與召喚設定（含舊settings入口）允許真實running遠征，新開打寶／爬塔採目前配置，原遠征快照不變；回血升級改用live穿戴上限。0032僅精準替換guardian update trigger，保留active轉移／刪除與託管保護，禁止盲跑歷史migration。遺物最低傳說品質（新生成與舊裝含完整屬性／所有交易顯示及篩選）、強化加成+25%；gearRarity解析舊row，不覆寫託管／歷史；普通裝／掉率／詞條不變；截圖410／256對照改410／526。新增26遠征＋15遺物測試、390／1280px完整UI驗收；接手讀docs/STAR_RING_CONFIGURATION_RELICS_20261019.txt。僅Worker，正式發布看deployment-records。

2026-10-19 技能保留追加補驗：新增12個真通關流程（遠征v1–v3×打寶／爬塔×兩種結束順序），實際施放新技能，通關後再改配置、讀舊戰報／重試領獎及遠征完成都不回寫舊配置；新學技能、自動條件、合法新冷卻與towerBest保留，30份遠征收益對照一致。只增測試／文件，不需部署；合入後sync:check核對正式機即可。詳docs/STAR_RING_SKILL_PERSISTENCE_VERIFICATION_20261019.txt。

2026-10-19 遠征技能配置放寬：expedition/action 的 loadout／auto 允許本人真實running遠征沿用背包存取驗證與原子guard；學習仍可，前景打寶／爬塔及施放／天使settings限制保留。當趟v1–v3 actor快照不變，新配置用於新開戰鬥且不被結算覆蓋。新增16項回歸含三版本完整12h／30份收益JSON對照、真新打寶爬塔配置、提交競爭與資格保護；390／1280px隔離正式iframe實際操作通過。詳docs/STAR_RING_SKILL_CONFIGURATION_20261019.txt；僅Worker、無migration，正式發布看deployment-records。

2026-10-19 第三輪複查補修：雙人交易守護羽毛選取器增加40筆游標「載入更多」與原頁重試，固定角色／epoch／交易代數／面板身分，防晚回應及舊按鈕污染；星輝匣將fn狀態讀取納入失敗後收據恢復，僅相同帳號／操作編號／內容指紋回原結果，不吞真正錯誤。新增30項回歸，完整Worker1827／BOT163通過；隔離完整MiniApp390／1280px分頁、斷線重試及第81張真託管驗收。詳docs/TRADE_PAGES_GIFT_REPLAY_20261019.txt；僅Worker，無migration或BOT改動，發布看deployment-records。

2026-10-19 遠征背包全盤修正：天使合成／回收／解綁、交易所三類物品完整買賣取回、雙人天使全流程、手動／自動洗屬性、材料與技能書兌換／學習／分享均支援真實running遠征。保留穿戴／啟用／託管／綁定交易保護；使用者確認綁定天使仍可合成及商店回收。必要0031只替換兩個舊guardian party trigger，不重建表、不盲跑歷史migration；先查正式trigger與帳本再精準套用。27項新回歸含全部舊資料保留、12h戰鬥及30份獎勵一致；接手先讀docs/STAR_RING_INVENTORY_ACCESS_20261019.txt。僅Worker發布，正式狀態看deployment-records與即時schema。


2026-10-19 CI與發布工具交接：原始碼走PR及「Worker and BOT tests」必要檢查合入main，不可直接push／繞過；CI只測試、不自動部署。正式收據權威位置改為origin/deployment-records:docs/deployment/*.json，main同名檔保留歷史快照，不再回寫。發布／sync:check讀專用分支，補收據用receipts:record:worker／bot，禁止為了收據重發正式機。先讀AGENTS.md及docs/CI_AND_RELEASE_RECORDS_20261019.txt；本次開發工具改動不需部署遊戲／BOT。

2026-10-19 轉蛋新增qty（1..9999、舊客戶端預設1），數量／總價視窗及原子整批購買；遠征中允許未穿戴未綁定背包裝備與可交易道具掛賣，實際membership及提交SQL guard雙重驗證、當趟快照／戰力／收益不變。守護天使及前景短隊原限制保留。新增17項回歸、完整Mini App隔離遠征角色手機尺寸購買／入庫／上架驗收；讀docs/GACHA_BULK_RING_MARKET_20261019.txt。僅Worker，無migration／BOT改動，正式版本看最新收據。

2026-10-19 遠征期間開放未穿戴、未交易背包裝備的手動／自動強化，真實running membership驗證、當趟快照／戰力／12h全部收益不變；穿戴及前景短戰限制保留。交易另修主動開窗漏接、雙方完整重鑄／遺物／附加屬性、最終確認offerRev及成交歷史快照。新增20+5項回歸、隔離雙人桌機／手機尺寸流程驗收；接手讀docs/STAR_RING_BACKPACK_ENHANCE_20261019.txt、docs/TRADE_WINDOW_FIX_20261019.txt。僅Worker、無migration／BOT改動，正式版本與完整測試看部署收據；CI／按需載入／素材保存仍為後續項目。

2026-10-19 打寶／爬塔改用原定deadline補齊5/15秒回合，不因離線排程30秒節奏逐回合延後或舊30分鐘牆鐘逾時；每分鐘Worker獨立sweep直接發獎、缺獎重試，整隊多回合原子保存／一次扣藍水／圖卡合併。新增14項離在線對照、技能／喝水／跨層／併發／排程測試，相關62項通過，無migration／BOT改動。接手讀docs/PARTY_OFFLINE_CLOCK_20261019.txt，正式版本看收據。

2026-10-19 並行補驗：打寶／爬塔各六次前景戰鬥跨完整12h，逐段與單獨遠征比對戰鬥與全部獎勵完全一致；背包加總、防重、前景HP/MP/state/presence保護均通過。共63相關測試、正式runtime與排程唯讀核對完成，僅新增測試／文件、不重發。見docs/STAR_RING_PARALLEL_VERIFICATION_20261019.txt。

2026-10-19 遠征頁新增打寶／爬塔快捷鍵，兩頁可一鍵返回同一遠征戰況（含唯讀通知角色與已結束戰報）；保留前景短隊、換角色清除回程、舊讀取失效化。桌機／手機尺寸隔離API實際往返驗收完成。詳docs/STAR_RING_SHORTCUTS_20261019.txt；僅Worker、無migration，正式版本看收據。

2026-10-19 同角色可於已啟程的星環遠征期間參加打寶／爬塔：running遠征暫借前景presence，短隊結束／離隊／逾時後原子恢復仍有效遠征。遠征結算保留前景HP/MP/party_id，完成／撤退不清掉另一場短隊；兩邊清單可並存，普通掛機仍暫停。v1/v2/v3既有隊伍即時適用，無migration、不重置、不變獎勵配方。接手讀docs/STAR_RING_PARALLEL_PARTY_20261019.txt；僅Worker發布，版本看收據。


2026-10-19 星環遠征v3：新建隊伍增加實際擊倒菁英／首領獵賞（最高額外144分鐘基準經驗、6普通卷、12綁定星冕核心、1低機率直接必成卷）。60核心自選武器／防具必成卷；v1/v2隊伍維持原收益，36組v2戰鬥與全員收益hash保護，原combat/loot RNG不變。核心原創alpha圖、雙幣兌換、待入袋／已入袋、BOT私人完成獎勵名稱已接齊。接手讀 docs/STAR_RING_RANK_REWARDS_20261019.txt 及經濟量測JSON；不跑migration、不重置玩家。正式發布看兩服務收據。


2026-10-19 星環遠征v2擴充48個身份：每圖2普通／1菁英／1既有首領、36隻新原創16姿勢alpha怪，伺服器獨立seed依波數／時間選種，離線及線上同源；v1歷史36個完整階段hash保持一致。新建隊伍用v2，既有隊伍維持v1，無migration、無重設次數／收益。前端rank／已遇清單、舊敵倒地→新敵進場，並補每小時system-only換圖時英雄不停播。接手讀docs/STAR_RING_MONSTER_POOLS_20261019.txt；美術／像素／桌手機驗收在docs/art/STAR_RING_POOL_*，正式發布看Worker收據。

2026-10-19 星環戰鬥顯示補修：五人／魔物持續播放交戰演出，首beat不再空等，擊倒接下一波進場；server view提供spawn投影，保留v1模擬、RNG、收益與存檔。終章不重生，隱藏／減少動態停播；原20秒同步不變。詳docs/STAR_RING_COMBAT_PLAYBACK_20261019.txt，發布看Worker收據。

2026-10-19 星環遠征補上群組招募圖卡：建立／狀態變更以原子outbox排程，同房間更新原卡、合併待送版本、準確ring deep link、圖片拒絕fallback與不確定結果防重。原先只有完成DM，沒有開隊通知。先BOT後Worker發布，保留藥水設定；無migration。詳docs/STAR_RING_RECRUIT_NOTICE_20261019.txt，版本看兩服務收據。

2026-10-18 三款遠征足下光環新增地面旋轉：曙星32秒順轉、月潮38秒逆轉、星蝕28秒順轉，衣櫥與戰場共用，保持足下定位，減少動態時停轉。驗收與接手見docs/art/STAR_RING_AURA_ROTATION_20261018.txt；僅前端CSS與快取版本，無DB／BOT改動，正式版本看收據。

2026-10-18 自動洗屬性修正：完整鎖定且已達標的能力不再讓剩餘詞條誤判完成；所選能力都已鎖住時，依設定品質判斷剩餘每條。種類鎖仍會洗品質；費用／預算不變。接手讀docs/AUTO_REROLL_LOCKS_FIX_20261018.txt；無migration或BOT改動，發布看正式收據。

2026-10-18 星環外觀補齊：三款角色綁定純視覺足下光環、徽記兌換／預覽／穿卸、四職業武器與防具／飾品原創圖，接至武裝／掛機／英雄殿堂／三人副本／五人遠征。接手讀docs/STAR_RING_COSMETICS_HANDOVER_20261018.txt；0030僅新增兩表，禁止盲跑所有migration。正式發布看最新收據。

2026-10-18 星環遠征已完成實作與驗收：神戰→組隊新增40級起、每10級解鎖、五個真帳號、每角色台北日一次、固定12小時；12張原創地圖逐張交GROK生成影片，每小時換圖/換全新怪，每2小時六次原子結算。12怪皆真4×4/16幀去背動作，桌機/手機尺寸24景核可；角色動作contain校準與局部特效縮放只對新玩法啟用。完整Worker1605/Bot153測試通過、隔離HTTP走完12h/30份收益/5次私人完成通知/兌換防重。保留已上線組隊大廳43dc2fd。接手先讀docs/STAR_RING_HANDOVER_20261018.txt，美術/GROK/畫面QA在docs/art/STAR_RING_*；部署狀態只看最新兩服務收據。0029僅新增七表，遠端26–28帳本歷史缺口不可盲目migrations apply。

2026-10-16 使用者要求臺灣完成後接續其餘國家：九國城市先行包v9已完成整合（JP/KR/US/CA/GB/DE/FR/AU/IN），新增13,500日常、108職涯／432專屬抉擇、216人際鏈、54共同故事與9張原創手繪插畫。含自營/受雇/無薪家務分流、不可改寫既有紀事、跨國前三世避重與共同期限雙方涵蓋。接手先讀 docs/fate/COUNTRY_PACKS_V9_HANDOVER_20261016.txt；發布看部署收據。金額為各國貨幣劇情帳，全球分位/台幣換算未宣稱完成。


2026-10-16 命運旅章 v8 台灣雙北先行包已完成實作：1,718 則在地日常＋20 則幼年、16 職涯／170 章、90 種條件抉擇、六篇在地共同支線與新手繪分享圖。新世四內容組避開前三世、保留公開碼確定重播；生活欄位只顯示實際發生狀態。舊人生不換版。範圍／驗證／圖片提示與接手見 `docs/fate/TAIWAN_V8_HANDOVER_20261016.txt`。這是雙北先行包，其他九國仍鎖定，完整人際長鏈與真實統計校準未宣稱完成。使用者要求台灣完成後接續其餘國家，依十國計畫逐一實作與驗收。發布狀態看部署收據。

2026-10-16 新輪迴改用v7條件抉擇：26種情境、每世不同題數／次序／間隔，前因會關閉後續路線；出生性別、因果極端分流、帶年齡的終章時間軸與第4～9次BOT通知均已整合。v1–v5現有存檔照原配方完成。接手見 `docs/fate/V7_CONDITIONAL_HANDOVER_20261016.txt`；正式狀態仍看部署收據。十國是規劃，未開放國別真人生，見 `docs/fate/countries/COUNTRY_ROADMAP_20261016.txt`，未發布v6統計原型留在獨立分支，勿整包部署。

2026-10-16 交織命運補修：通知入口等待真實inbox後定位受邀選項；解決回答與舊inbox請求競爭；固定截止後雙方重疊進行中的人生都收到安全故事後果，歷史不因24小時被抹掉。星座移至標題右側正常排版，375px內頁驗收無遮擋。細節與驗證見 `docs/fate/DUAL_FOLLOWUP_20261016.txt`。本補修沒有更改v5三幕時間引擎；使用者已指出僅微調年齡不符需求，後續須新版本條件事件引擎，不可原地改寫舊人生。

2026-10-16 命運旅章v5新增固定兩小時內的不同終年與事件時點、300則日常紀事、160篇連續故事及24組重大抉擇，保留舊v3／v4人生。新舊重播契約、驗證與接手見 `docs/fate/V5_TIMING_CONTENT_20261016.txt`；v5正式發布後不可原地改seed時序或擴／重排同版catalog，須以新版保護舊紀錄。

2026-10-16「交織命運」已完成實作：六種雙人支線、獨立本世邀請／預設關閉的受邀設定、真人指定角色回覆、固定敘事後果、雙方群提及與防重；並修正通知停掛機首頁、待答定位及BOT積壓延遲。最新接手規則與驗證見 `docs/fate/SHARED_CHOICES_HANDOVER_20261016.txt`；下方僅評估段落屬歷史，正式發布仍以部署JSON及Cloudflare核對為準。

2026-10-16 星座＋輪迴身分分享圖（PNG／TG JPEG）、勾選隱私與可重現驗證見 `docs/fate/ZODIAC_SHARE_20261016.txt`。雙人代選支線目前僅評估，未啟用；設計與權限／通知必要條件見 `docs/fate/SHARED_CHOICES_ASSESSMENT_20261016.txt`。

2026-10-16 命運旅章分享、啟程出生時間、四世星輝匣/真正100%必成卷、其他玩家暱稱社交鏈，接手與實測界線見 `docs/fate/SHARING_GIFTS_HANDOVER_20261016.txt`、`docs/fate/SOCIAL_CAST.txt`。iPhone/Android原生相簿/IG附圖必須實機驗收，不得將契約測試當實測。發布狀態仍以最新部署收據為準。

2026-10-16 命運旅章第一期的正式人生、雲端旅誌、任務解鎖提醒、出生檔案、架空年鑑、
手繪終章與TG事件通知已完成整合。規則、測試與低強度模型接手步驟見
`docs/fate/FORMAL_HANDOVER.txt`、內容量測見 `docs/fate/NARRATIVE_V4.txt`。
是否已發布仍以 `docs/deployment/*.json` 與即時Cloudflare為準；先前預覽文件屬歷史記錄。

> **致接手的 AI 助手（無論在哪台電腦）**：  
> 本手冊包含「星穹旅誌」截至 2026-10-15 的最新架構狀態、線上版本、部署流程與開發規範。  
> 閱讀本文件後，你將具備與前任助理 100% 相同的專案上下文，請立即接續使用者需求提供支援。

> 2026-10-15 使用者要求後續以本 GitHub 倉庫開發並與正式機同步。請先讀 AGENTS.md 的「正式機與 GitHub 同步」及 docs/deployment/*.json；本文固定版本號為歷史資料。根目錄 npm run deploy:worker／deploy:bot 已改為 GitHub 提交與線上版本的同步流程，勿再直接執行子目錄 wrangler deploy 繞過核對。只需核對時執行 npm run sync:check。推送 main 不會自動上線。

---

## 2026-10-15 審查修正分支

2026-10-16 已加入四職業後期三人職責機制（含盜賊）、90／105／120級打寶與三四轉試煉、高層25／30層塔王；配隊匹配、15秒機制回合、實際戰技、破陣護甲、TG及手機介面、舊場次相容與接手驗證見 `docs/class-combat/LATE_PARTY_ROLES_HANDOVER.txt`。下方「後期配隊另一期」屬歷史記錄；正式是否已發布仍以最新部署收據為準。

2026-10-16 後續已修正既有帳號新增角色的通行證誤擋，並實作盜賊24個三／四轉專精。最新接手文件為 `docs/thief/ADVANCEMENT_AND_CREATION_HANDOVER.txt`，包含正式HMAC創角、收據重試、各模式戰鬥與UI驗證；下段上線後審查所列的高階缺口屬歷史狀態。

2026-10-16 盜賊正式上線後核對與漏接修正見 `docs/thief/POST_RELEASE_AUDIT.txt`。本次補齊自動洗屬性攻擊目標及交易所職業／近戰天使篩選；盜賊三、四轉仍沿用二轉能力，勿將外觀完成誤認為玩法專精完成。發布狀態以最新 docs/deployment 收據為準。

`codex/review-remediation` 修復交易部分取回道具遺失、統一完整測試、補 Bot 積壓／uncertain 核對與發布互斥，並加入現有三職業 72 條三四轉數值專精與成長樹真實數值。詳細範圍、驗證及低強度模型接手步驟見 `docs/class-combat/REVIEW_REMEDIATION_HANDOVER.txt`。完整資源累積／手動戰技與後期配隊副本仍屬另一期；人物／盜賊由其他視窗處理。此段不是發布收據，正式啟用仍以 docs/deployment 與即時 Cloudflare 為準。

---

## 一、目前系統線上架構與即時狀態

星穹旅誌已經 **100% 全面雲端化**，由 Cloudflare 上的兩個獨立 Worker 服務支撐，**完全不依賴本機運行**：

### 1. 遊戲核心與 Mini App 服務：`elf-rpg-api`
- **目錄**：`worker/`
- **服務網址**：https://elf-rpg-api.micisachen.workers.dev
- **健康檢查**：`GET /health` -> `{"ok":true,"service":"elf-rpg-api"}`
- **目前線上版本**：以 `docs/deployment/elf-rpg-api.json` 及即時 Cloudflare 狀態為準；下方版本屬歷史紀錄。
- **核心架構**：
  - 後端：Cloudflare Worker (`src/index.js`)，處理戰鬥、裝備、鍛造、掉寶、職業分支、掛機結算。
  - 前端：Telegram WebApp Mini App (`public/`)，包含 7,000+ 個靜態資源與全角色高階傳承美術圖鑑。
  - 資料庫：Cloudflare D1 (`elf-rpg`, ID: `bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4`)。
  - 狀態協調：Durable Objects (`AutoEnhanceRunner`)。

### 2. 雲端 Telegram 機器人：`star-journal-rpg-bot`
- **目錄**：`cloud-bot/`
- **服務網址**：https://star-journal-rpg-bot.micisachen.workers.dev
- **健康檢查**：`GET /health` -> `{"ok":true,"service":"StarJournalRpgBot","mode":"cloud"}`
- **Telegram Webhook**：`https://star-journal-rpg-bot.micisachen.workers.dev/telegram/webhook`
- **核心架構**：
  - 採用 Cloudflare Worker + Durable Objects (`BotCoordinator`) 24 小時駐留監聽 Telegram Webhook。
  - 內建 WASM 動態 GIF 渲染引擎與隊伍卡片生成器 (`src/renderer/`)。
  - 透過 Cloudflare Service Binding (`RPG_API`) 直接與 `elf-rpg-api` 通訊。

### 3. 本機歷史備份：`bot/`
- 舊版 Windows 本機 Node.js 長輪詢服務，已完整遷移至 `cloud-bot/`，留作歷史代碼備份。

---

## 二、最新完成的任務與修改紀錄 (2026-10-14 ~ 10-15)

1. **轉職冷卻時間調整**：
   - 將「命運轉職書」重新選擇職業分支的冷卻時間從 **7 天** 改為 **30 分鐘**。
   - 異動檔案：
     - `worker/src/game/constants.js`: `RESELECT_COOLDOWN_MS = 30 * 60_000;`
     - `worker/src/game/classes.js`: 錯誤提示支援小於 1 小時顯示「剩餘 X 分鐘」。
     - `worker/public/app.js`: 命運轉職書 I 與 II 卡片統一標記「30 分鐘冷卻」。
   - 已完成正式發布與驗證（版本 `49a27728`）。

2. **全角色美術與戰鬥特效完整統一發布**：
   - 劍士、法師、精靈弓箭手 1~4 轉全外觀與戰鬥粒子特效已全量上線。

3. **專案 Monorepo 整合與 GitHub 儲存庫建立**：
   - 倉庫網址：`https://github.com/micisachen63-gif/--MiniApp.git`
   - 機密脫敏：所有 `.local.json` 與實體 Token 均已透過 `.gitignore` 隔離。

---

## 三、在家開發與發布指令指南

接手 AI 請依照下列規範協助使用者開發與發布：

1. **執行測試**：
   - 測試遊戲核心與轉職：`npm run test:worker`
   - 測試機器人適配器：`npm run test:bot`

2. **發布部署**：
   - 在根目錄先 `npm ci`；修改完成並測試、提交／合併及推送 main。
   - 部署遊戲核心/前端：根目錄執行 `npm run deploy:worker`
   - 部署雲端機器人：根目錄執行 `npm run deploy:bot`
   - 必須確認 GitHub 收據推送與線上驗證成功，才算同步完成。

3. **規範約束**：
   - 除非使用者特別要求，否則嚴禁執行未經審查的 D1 破壞性 migration。
   - 遠端 Secrets (`BOT_TOKEN`, `SERVICE_SECRET`) 均已在 Cloudflare 雲端配置，`wrangler.toml` 設有 `keep_vars = true`，部署時會自動保留。


## 2026-10-18 星輝必成卷專屬粉光圖

100% 武器／防具卷新增透明粉光素材，背包、強化與輪迴禮開匣同步；祝福卷保留金光。詳見 `docs/art/GUARANTEED_SCROLL_PINK_20261018.txt`，正式版本以部署收據為準。


## 2026-10-18 命運旅章真實統計參照

十國 v8/v9 的生活卡、預設收合圖表、原幣轉台幣、UBS/WHO/UNESCO來源與日期、PNG/TG圖卡/文案共用狀態已補齊。固定快照與方法限制詳見 `docs/fate/WORLD_COMPARISON_HANDOVER_20261018.txt`；勿將分組占比誤稱個人百分位。正式部署仍以兩服務收據為準。


## 2026-10-18 命運旅章私訊分流補強

一般fate_event連舊group佇列也只走私訊，重新核對權威帳號；403不回退群組。只有fate_social與fate_cast保留群組，詳見 `docs/fate/PRIVATE_NOTIFICATIONS_20261018.txt`。
