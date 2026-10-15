(function () {
  'use strict';

  /** @typedef {'white'|'green'|'blue'|'purple'|'red'|'gold'|'pink'|'cyan'} GuardianQuality */
  /** @typedef {'melee'|'ranged'|'magic'|'loot'} GuardianType */
  /** @typedef {{summon:boolean,fuse:boolean,activate:boolean,unbind:boolean,trade:boolean}} GuardianActions */
  /** @typedef {{gold:number|null,freeNormalDraws:number|null,voucherCount:number|null,remainder:number|null,availableDraws:number|null}} GuardianBalances */
  /** @typedef {{id:string,type:GuardianType,quality:GuardianQuality,bound:boolean,active:boolean,inTrade:boolean,locked:boolean}} GuardianItem */
  /** @typedef {{schemaVersion:number,configVersion:string,status:string,enabled:boolean,qualityOrder:GuardianQuality[],types:Array,qualities:Array,pools:Object,limits:Object,rules:Object,actions:GuardianActions}} GuardianConfig */
  /** @typedef {{from:GuardianQuality,to:GuardianQuality,materials:number,refundOnFailure:number,successRate:number|null,goldFee:number|null}} GuardianUpgradeStage */
  /** @typedef {{schemaVersion:number,charId:string,revision:number|null,serverNow:number|null,resetAt:number|null,balances:GuardianBalances,daily:Object,activeGuardian:GuardianItem|null,inventory:{items:GuardianItem[],nextCursor:string|null},actions:GuardianActions}} GuardianState */
  /** @typedef {{operationId:string,requestId:string,charId:string,action:string,status:string,configVersion:string,consumed:Object,results:GuardianItem[],createdAt:number|null}} GuardianOperation */
  /** @typedef {{signal?:AbortSignal}} GuardianReadOptions */
  /** @typedef {{requestId?:string,operationId?:string,signal?:AbortSignal}} GuardianRecoveryQuery */
  /**
   * The host delegates reads to the existing authenticated API wrapper.
   * @typedef {Object} RpgGuardianHost
   * @property {function():string} characterId Current selected character, not a client-selected owner.
   * @property {function(GuardianReadOptions):Promise<GuardianConfig>} config Read-only configuration.
   * @property {function(GuardianReadOptions):Promise<GuardianState>} state Read-only inventory and balances.
   * @property {function(GuardianRecoveryQuery):Promise<GuardianOperation>} recover Original request/result lookup; never summon.
   */

  const QUALITY_ORDER = Object.freeze(['white', 'green', 'blue', 'purple', 'red', 'gold', 'pink', 'cyan']);
  const QUALITY_NAMES = Object.freeze({white: '白', green: '綠', blue: '藍', purple: '紫', red: '紅', gold: '金', pink: '粉', cyan: '青'});
  const TYPE_NAMES = Object.freeze({melee: '天使・熾刃', ranged: '天使・星弦', magic: '天使・秘曜', loot: '天使・豐穗'});
  const ACTIONS = Object.freeze(['summon', 'fuse', 'activate', 'unbind', 'trade']);
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const string = value => typeof value === 'string' ? value : '';
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const actor = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  /** Only same-origin art/assets paths, never executable, external or credential-bearing URLs. */
  function safeArtUrl(value) {
    if (typeof value !== 'string' || !/^\/?(?:art|assets)\/[A-Za-z0-9._/%-]+(?:\?[A-Za-z0-9_.=%&-]+)?$/.test(value)) return null;
    try {
      const path = decodeURIComponent(value.split('?')[0]);
      if (path.includes('\\') || path.includes('//') || path.includes('%') || path.split('/').some(part => part === '.' || part === '..') || /[\u0000-\u0020?#"'<>]/.test(path)) return null;
      return value;
    } catch { return null; }
  }
  function fail(code, message) {
    const error = new Error(message); error.code = code; throw error;
  }
  function schema(value) {
    if (value !== undefined && value !== 1) fail('guardian_schema', '守護神資料版本已更新，請重新載入。');
  }
  function actions(value) {
    const source = object(value);
    return Object.fromEntries(ACTIONS.map(key => [key, source[key] === true]));
  }
  function item(value) {
    const source = object(value);
    if (!string(source.id) || !QUALITY_ORDER.includes(source.quality) || !Object.hasOwn(TYPE_NAMES, source.type)) {
      fail('guardian_item', '守護神資料尚未完整，請更新後再查看。');
    }
    return {id: source.id, type: source.type, quality: source.quality, bound: source.bound === true,
      active: source.active === true, inTrade: source.inTrade === true, locked: source.locked === true,
      reasons: Object.fromEntries(Object.entries(object(source.reasons)).filter(([key, value]) => ACTIONS.includes(key) && typeof value === 'string'))};
  }
  function pool(value, id) {
    const source = object(value);
    return {id, name: string(source.name) || (id === 'normal' ? '普通召喚' : '精選召喚'),
      allowedCounts: [...new Set((Array.isArray(source.allowedCounts) ? source.allowedCounts : []).filter(value => count(value) !== null && value > 0))],
      rates: (Array.isArray(source.rates) ? source.rates : []).filter(entry=>QUALITY_ORDER.includes(entry?.quality)&&number(entry.percent)!==null&&entry.percent<=100).map(entry => ({quality:entry.quality,percent:entry.percent})),
      singleGoldPrice: count(source.singleGoldPrice), tenGoldPrice: count(source.tenGoldPrice), drawsPerVoucher: count(source.drawsPerVoucher)};
  }
  function upgradeStages(value) {
    if (value === undefined || Array.isArray(value) && value.length === 0) return [];
    if (!Array.isArray(value) || value.length !== QUALITY_ORDER.length - 1) fail('guardian_upgrade_stages', '守護神升階資料尚未完整，請重新載入。');
    return value.map((entry, index) => {
      const source = object(entry), materials = count(source.materials), refundOnFailure = count(source.refundOnFailure);
      if (source.from !== QUALITY_ORDER[index] || source.to !== QUALITY_ORDER[index + 1] || materials === null || materials < 1 || refundOnFailure === null || refundOnFailure >= materials) {
        fail('guardian_upgrade_stages', '守護神升階資料不一致，請重新載入。');
      }
      const successRate = number(source.successRate);
      if (successRate !== null && successRate > 1) fail('guardian_upgrade_stages', '守護神升階機率資料不一致，請重新載入。');
      return {from: source.from, to: source.to, materials, refundOnFailure, successRate, goldFee: count(source.goldFee),mixedTypes:typeof source.mixedTypes==='boolean'?source.mixedTypes:null,resultType:string(source.resultType),refundCard:string(source.refundCard),binding:string(source.binding)};
    });
  }
  /** Preserve unknown balances as null: unavailable is never presented as zero. */
  function config(value) {
    const source = object(value); schema(source.schemaVersion);
    const order = source.qualityOrder === undefined ? [...QUALITY_ORDER] : source.qualityOrder;
    if (!Array.isArray(order) || order.length !== QUALITY_ORDER.length || order.some((entry, index) => entry !== QUALITY_ORDER[index])) {
      fail('guardian_quality_order', '守護神品質資料不一致，請重新載入。');
    }
    const pools = object(source.pools), limits = object(source.limits);
    const scene=object(source.scene),treeArtUrl=safeArtUrl(scene.treeArtUrl||source.treeArtUrl),deityArtUrl=safeArtUrl(scene.deityArtUrl||source.deityArtUrl),bodyArtUrl=safeArtUrl(scene.bodyArtUrl||scene.archangelBodyArtUrl||source.bodyArtUrl),featherArtUrl=safeArtUrl(scene.featherArtUrl||scene.summonFeatherArtUrl||source.featherArtUrl);
    const treeVideoUrl=safeArtUrl(scene.treeVideoUrl||source.treeVideoUrl),deityVideoUrl=safeArtUrl(scene.deityVideoUrl||source.deityVideoUrl);
    const transitionVideoUrl=safeArtUrl(scene.transitionVideoUrl||source.transitionVideoUrl),transitionDurationMs=count(scene.transitionDurationMs??source.transitionDurationMs);
    const angelPose=(scene.angelPose||source.angelPose)==='portrait'?'portrait':'classic';
    return {schemaVersion: 1, configVersion: string(source.configVersion), status: string(source.status) || 'pending_approval', enabled: source.enabled === true,treeArtUrl,deityArtUrl:bodyArtUrl||deityArtUrl,bodyArtUrl,featherArtUrl,treeVideoUrl,deityVideoUrl,transitionVideoUrl,transitionDurationMs,angelPose,scene:{treeArtUrl,deityArtUrl:bodyArtUrl||deityArtUrl,bodyArtUrl,featherArtUrl,treeVideoUrl,deityVideoUrl,transitionVideoUrl,transitionDurationMs,angelPose,npcKind:'archangel'},
      qualityOrder: [...order], types: Object.entries(TYPE_NAMES).map(([id, fallback]) => {
        const entry = object(source.types?.find?.(entry => entry.id === id));
        return {id, name: string(entry.name) || fallback, artUrl: safeArtUrl(entry.artUrl),guideArtUrl:safeArtUrl(entry.guideArtUrl), alt: string(entry.alt || entry.artAlt) || `${string(entry.name) || fallback}原畫`, description: string(entry.description)};
      }),
      qualities: order.map((id, index) => {
        const entry = object(source.qualities?.find?.(entry => entry.id === id));
        return {id, rank: index + 1, name: string(entry.name) || QUALITY_NAMES[id], damageBonus: number(entry.damageBonus), lootBonus: number(entry.lootBonus)};
      }),
      pools: {normal: pool(pools.normal, 'normal'), featured: pool(pools.featured, 'featured')},
      limits: {dailyVouchers: count(limits.dailyVouchers), maxDraws: count(limits.maxDraws), announcementMinimumRank: count(limits.announcementMinimumRank), visualMinimumRank: count(limits.visualMinimumRank)},
      rules: {...object(source.rules), upgradeStages: upgradeStages(object(source.rules).upgradeStages)}, actions: actions(source.actions)};
  }
  function state(value, expectedCharId) {
    const source = object(value); schema(source.schemaVersion);
    const charId = actor(source.charId);
    if (!charId || (expectedCharId !== undefined && charId !== actor(expectedCharId))) fail('guardian_character_changed', '角色已切換，請重新查看守護神。');
    const balances = object(source.balances), daily = object(source.daily), inventory = object(source.inventory);
    const welcome=object(source.welcome),assist=object(source.assist);
    return {schemaVersion: 1, charId,revision: count(source.revision),level:count(source.level),unlocked:source.unlocked===true,welcome:{claimed:welcome.claimed===true,freeDraws:count(welcome.freeDraws),granted:count(welcome.granted),recipientCharId:actor(welcome.recipientCharId)||null},serverNow: number(source.serverNow), resetAt: number(source.resetAt),
      balances: Object.fromEntries(['gold','freeNormalDraws','voucherCount', 'remainder', 'availableDraws'].map(key => [key, count(balances[key])])),
      daily: {day: string(daily.day), granted: count(daily.granted), remaining: count(daily.remaining)},
      assist:{itemId:string(assist.itemId)||null,remainingBattles:count(assist.remainingBattles),enabled:assist.enabled===true,autoRenew:assist.autoRenew===true,autoBuy:assist.autoBuy===true,stoneCount:count(assist.stoneCount),battlesPerStone:count(assist.battlesPerStone),stoneGold:count(assist.stoneGold)},
      activeGuardian: source.activeGuardian ? item(source.activeGuardian) : null,
      inventory: {items: (Array.isArray(inventory.items) ? inventory.items : []).map(item), nextCursor: string(inventory.nextCursor) || null,
        quality:QUALITY_ORDER.includes(inventory.quality)?inventory.quality:null,totalCount:count(inventory.totalCount),
        qualityCounts:Object.fromEntries(QUALITY_ORDER.map(quality=>[quality,count(object(inventory.qualityCounts)[quality])])),
        eligibleCounts:Object.fromEntries(QUALITY_ORDER.map(quality=>[quality,count(object(inventory.eligibleCounts)[quality])]))},
      actions: actions(source.actions)};
  }
  function operation(value, expectedCharId) {
    const source = object(value), charId = actor(source.charId);
    if (!charId || charId !== actor(expectedCharId)) fail('guardian_character_changed', '角色已切換，請重新查看守護神。');
    if (!string(source.operationId) || !string(source.requestId)) fail('guardian_operation', '操作紀錄尚未完整，請稍後確認。');
    const consumed = object(source.consumed);
    return {operationId: source.operationId, requestId: source.requestId, charId, action: string(source.action), status: string(source.status),
      configVersion: string(source.configVersion), consumed: Object.fromEntries(['gold', 'freeNormalDraws', 'vouchers', 'credits','stones'].map(key => [key, count(consumed[key])])),
      success: typeof source.success==='boolean'?source.success:null,primaryId:string(source.primaryId)||null,refundedId:string(source.refundedId)||null,shareId:string(source.shareId)||null,consumedIds:(Array.isArray(source.consumedIds)?source.consumedIds:[]).filter(value=>typeof value==='string'),inputRank:count(source.inputRank),pool:string(source.pool),count:count(source.count??source.drawCount),drawCount:count(source.count??source.drawCount),usedUnbindScrolls:count(source.usedUnbindScrolls),assistMode:string(source.mode)||null,
      results: (Array.isArray(source.results) ? source.results : []).map(item), createdAt: number(source.createdAt)};
  }
  /** A recovery query identifies the old operation; it never creates a new request ID. */
  function recoveryQuery(value) {
    const source = object(value), requestId = string(source.requestId), operationId = string(source.operationId);
    if (!requestId && !operationId) fail('guardian_recovery_id', '沒有待確認的操作紀錄。');
    return {...(requestId ? {requestId} : {}), ...(operationId ? {operationId} : {})};
  }
  function canAction(config, state, action) {
    return ACTIONS.includes(action) && config?.enabled === true && config?.status === 'approved' && config.actions?.[action] === true && state?.unlocked===true && state?.actions?.[action] === true;
  }
  window.RpgGuardianContract = Object.freeze({QUALITY_ORDER, QUALITY_NAMES, TYPE_NAMES, config, state, operation, recoveryQuery, canAction, safeArtUrl});
})();
