import { computeStats } from './stats.js';
import { expToNext } from './formulas.js';
import { ATLAS_SUPPLY_RULES_VERSION, ATLAS_POTION_KEYS, atlasSupplyPolicyForCharacter, isVersionedAtlasSupplies } from './atlas-supplies.js';

const CLASSES = new Set(['sword', 'archer', 'mage', 'thief']);
const EVENT_TYPES = new Set(['room_entered', 'enemy_defeated', 'map_completed', 'dead', 'completed', 'expired', 'stopped', 'encounter', 'encounter_completed', 'loot_equipment', 'loot_scroll']);
const EVENT_LIMIT = 24;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const nullableNumber = value => value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const copyNumbers = value => Object.fromEntries(Object.entries(value || {}).filter(([, amount]) => Number.isFinite(amount)));

/** The exact actors[].id in character-preview-index.json. Missing identity is
 * deliberately not replaced with a different class, gender, or advancement. */
export function atlasAppearanceKey({ baseClass, gender, classPath = '' }) {
  if (!CLASSES.has(baseClass) || !['m', 'f'].includes(gender)) return null;
  if (classPath === '') return baseClass + (gender === 'm' ? '_m' : '');
  if (typeof classPath !== 'string' || !/^[AB][12]{0,3}$/.test(classPath)) return null;
  return `adv${classPath.length}_${baseClass}_${classPath}_${gender}`;
}

function eventView(event, state, runId) {
  if (!event || !EVENT_TYPES.has(event.type) || !Number.isFinite(event.at) || event.at < 0 || event.at > state.elapsedSeconds) return null;
  const details = {};
  for (const key of ['enemyId', 'source', 'rank', 'reason','encounterId','name','rewardId','itemId','item']) if (typeof event[key] === 'string') details[key] = event[key];
  for (const key of ['mapIndex', 'roomIndex', 'enemies','tier','quantity']) if (Number.isInteger(event[key]) && event[key] >= 0) details[key] = event[key];
  for (const key of ['hpRestored','mpRestored']) if(Number.isFinite(event[key])&&event[key]>=0) details[key]=event[key];
  // The persisted window slides. Its array index and the run revision cannot
  // identify an event: either would replay the same defeat on the next read.
  const identity = [event.at, event.type, details.enemyId ?? null, details.mapIndex ?? null, details.roomIndex ?? null, details.reason ?? null];
  if(details.encounterId||details.rewardId)identity.push(details.encounterId??null,details.rewardId??null,details.itemId??null,details.item??null);
  return {
    id: `${runId}:${JSON.stringify(identity)}`,
    type: event.type, at: event.at, atMs: (state.startedAt + event.at) * 1000,
    ...details,
  };
}

function committedRunView(row, character, scope, activeRunId) {
  if (!row) return null;
  const state = typeof row.state_json === 'string' ? JSON.parse(row.state_json) : row.state_json;
  if (!state?.hero || !state.snapshot) return null;
  // Do not project a foreign or mismatched stored run even if a caller supplied
  // the wrong row. The public route independently resolves the authenticated
  // account's selected character inside the explicit realm.
  if (String(row.char_id) !== character.id || String(row.realm_id) !== scope ||
      String(state.runId) !== String(row.id) || String(state.realmId) !== scope ||
      String(state.snapshot.characterId) !== character.id) return null;

  const metrics = copyNumbers(state.metrics);
  const supplies = {
    hp: number(state.supplies?.hp), mp: number(state.supplies?.mp),
    hpUsed: number(state.supplies?.hpUsed), mpUsed: number(state.supplies?.mpUsed),
  };
  if (isVersionedAtlasSupplies(state.supplies)) Object.assign(supplies, {
    supplyRulesVersion: state.supplies.supplyRulesVersion,
    items: copyNumbers(state.supplies.items), initialItems: copyNumbers(state.supplies.initialItems), usedItems: copyNumbers(state.supplies.usedItems),
    policy: { ...state.supplies.policy },
  });
  const events = (Array.isArray(state.events) ? state.events : []).slice(-EVENT_LIMIT)
    .map(event => eventView(event, state, String(row.id))).filter(Boolean);
  return {
    id: String(row.id), realmId: scope, characterId: character.id,
    revision: number(row.rev), committedAt: nullableNumber(row.updated_at),
    active: activeRunId === String(row.id) && row.status === 'running',
    rulesetVersion: state.ruleset_version, status: row.status,
    startedAt: state.startedAt * 1000, processedAt: state.processedAt * 1000,
    processedSeconds: number(state.elapsedSeconds),
    map: { id: state.mapId, name: state.map?.name ?? null, themeId: state.map?.themeId ?? null, kind: state.map?.kind ?? null },
    mapIndex: number(state.mapIndex), roomIndex: number(state.roomIndex),
    transitionSeconds: number(state.transitionSeconds),
    hero: {
      hp: number(state.hero.hp), mp: number(state.hero.mp),
      maxHp: number(state.snapshot.maxHp), maxMp: number(state.snapshot.maxMp),
      shield: number(state.hero.shield),
    },
    supplies,
    enemies: (Array.isArray(state.enemies) ? state.enemies : []).map(enemy => ({
      id: String(enemy.id), name: String(enemy.name), rank: enemy.rank,
      hp: number(enemy.hp), maxHp: number(enemy.maxHp),
    })),
    events, eventHistory: { limit: EVENT_LIMIT, complete: false },
    report: {
      gold: number(state.totals?.gold), exp: number(state.totals?.exp),
      materials: copyNumbers(state.totals?.materials), ...(state.ruleset_version==='atlas-v4'?{equipment:number(state.totals?.equipment),items:copyNumbers(state.totals?.items)}:{}), kills: number(state.metrics?.kills),
      deaths: row.status === 'failed' ? 1 : 0,
      used: { hp: supplies.hpUsed, mp: supplies.mpUsed },
      reason: state.stopReason ?? null, metrics,
    },
  };
}

/** Read-only projection of already committed rows. This function never advances
 * the engine or extrapolates HP, enemies, damage, rewards, or potion use to now.
 * live is the character row; run is the latest persisted expedition, including a
 * finished one. Its battle HP can be zero while the returned character has 1 HP. */
export function projectAtlasScene({ player, run = null, realmId, now }) {
  const { char, inv, equipment } = player;
  const scope = String(realmId);
  const stats = computeStats(char, equipment.filter(item => item.is_equipped));
  const character = {
    id: String(char.tg_id), name: char.name, baseClass: char.base_class,
    gender: char.gender, classPath: char.class_path || '',
    level: number(char.level), revision: number(char.rev),
  };
  character.appearanceKey = atlasAppearanceKey(character);
  const activeRunId = char.atlas_run_id == null ? null : String(char.atlas_run_id);
  const currentExperience = number(char.exp), requiredExperience = expToNext(char.level);
  const maxLevel = !Number.isFinite(requiredExperience);
  const availableItems = Object.fromEntries(ATLAS_POTION_KEYS.map(key => [key, number(inv[key])]));
  const countSupplies = kind => ATLAS_POTION_KEYS.filter(key => key.startsWith(kind + '_')).reduce((sum, key) => sum + availableItems[key], 0);
  return {
    schemaVersion: 1, realmId: scope,
    accountId: String(char.account_tg_id || char.tg_id), characterId: character.id,
    serverNow: now, character,
    live: {
      revision: character.revision, updatedAt: nullableNumber(char.updated_at),
      hp: number(char.hp), mp: number(char.mp),
      maxHp: number(stats.maxHp), maxMp: number(stats.maxMp),
      gold: number(char.gold), exp: currentExperience,
      experience: { current: currentExperience, required: maxLevel ? null : requiredExperience,
        ratio: maxLevel ? 1 : Math.max(0, Math.min(1, currentExperience / requiredExperience)), maxLevel },
      activeRunId, partyId: char.party_id == null ? null : String(char.party_id),
      supplies: { hp: availableItems.red_1, mp: availableItems.blue_1, totals: { hp: countSupplies('red'), mp: countSupplies('blue') }, items: availableItems,
        policy: atlasSupplyPolicyForCharacter(char), supplyRulesVersion: ATLAS_SUPPLY_RULES_VERSION },
    },
    run: committedRunView(run, character, scope, activeRunId),
  };
}
