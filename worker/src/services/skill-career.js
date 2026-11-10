// Read-only projection for the shared skills/career window. Opening it must not settle idle time.
import { loadPlayer } from '../db.js';
import { stateView } from './special.js';
import { advance, branchChoices, GameError, reselect } from '../game/classes.js';
import { nodeFor } from '../game/stats.js';
import { researchCost } from '../game/skill-mastery.js';
import { CLASSES, GENERAL_WEAPON, ITEMS, MAX_OPEN_CLASS_TIER, RESELECT_COOLDOWN_MS, WEAPON_KINDS } from '../game/constants.js';

const READ_ONLY_MESSAGE = '這個世界已停止接受新操作，目前僅供查看';

function careerIconSrc(baseClass, path) {
  const key = String(path || '') ? baseClass + '_' + path : baseClass;
  return /^(sword|archer|mage|thief)(?:_[AB][12]{0,3})?$/.test(key) ? '/art/career-skill-icons-20261110/' + key + '.webp' : null;
}
function skillDescription(skill) {
  const damage = Number(skill?.mult), cost = Number(skill?.cost), targets = Number(skill?.targets) || 1;
  const parts = [];
  if (Number.isFinite(damage)) parts.push(damage + '× 攻擊');
  parts.push(targets + ' 個目標');
  if (Number.isFinite(cost)) parts.push('基礎耗魔 ' + cost);
  return parts.join(' · ') + '。';
}
function nodeView(baseClass, path) {
  const node = nodeFor(baseClass, path);
  return {
    path: node.path, tier: node.tier, name: node.name,
    skill: { ...node.skill, description: node.skill?.description || skillDescription(node.skill), iconSrc: careerIconSrc(baseClass, node.path) },
    passive: node.passiveText || '',
    weapon: WEAPON_KINDS[node.weapon || GENERAL_WEAPON[baseClass]]?.type || null,
  };
}

function itemRequirement(inv, id) {
  return { id, name: ITEMS[id].name, required: 1, have: inv[id] || 0 };
}

function reasonFor(action, blocked) {
  if (blocked) return blocked;
  try {
    action();
    return null;
  } catch (error) {
    if (!(error instanceof GameError)) throw error;
    return { code: error.code, message: error.message };
  }
}

function careerView(player, now, readOnlyReason) {
  const { char, inv, equipment } = player;
  const baseClass = char.base_class, path = String(char.class_path || ''), tier = path.length;
  const realmBlock = readOnlyReason ? { code: 'realm_read_only', message: readOnlyReason } : null;
  const advanceBlock = realmBlock || (char.party_id ? { code: 'party', message: '請先結束組隊戰鬥，再轉職' } : null);
  const reselectBlock = realmBlock || (char.party_id ? { code: 'party', message: '請先結束組隊戰鬥，再更換職業' } : null);
  let next = null;
  if (tier < MAX_OPEN_CLASS_TIER) {
    const nextTier = tier + 1;
    const choices = branchChoices(baseClass, nextTier, path).map(choice => ({
      branch: choice.branch, ...nodeView(baseClass, choice.path),
    }));
    const reason = reasonFor(() => advance({ ...char }, { ...inv }, choices[0]?.branch), advanceBlock);
    next = {
      tier: nextTier, requiredLevel: nextTier * 30,
      material: itemRequirement(inv, (nextTier >= 3 ? 'trial_' : 'mat_') + nextTier),
      canAdvance: reason === null, reason, choices,
    };
  }

  const cooldownUntil = char.last_reselect_at ? Number(char.last_reselect_at) + RESELECT_COOLDOWN_MS : null;
  const tiers = Array.from({ length: Math.min(tier, MAX_OPEN_CLASS_TIER) }, (_, index) => {
    const stage = index + 1, bookId = 'reselect_' + stage;
    const unavailable = ITEMS[bookId] ? null : { code: 'reselect_not_available', message: '第 ' + stage + ' 階尚未開放重選' };
    const book = unavailable ? { id: null, name: '此階尚未開放重選', required: 0, have: 0 } : itemRequirement(inv, bookId);
    const choices = branchChoices(baseClass, stage, path.slice(0, index)).map(choice => {
      const selected = path[index] === choice.branch;
      const targetPath = path.slice(0, index) + choice.branch + path.slice(stage);
      const reason = reasonFor(
        () => reselect({ ...char }, { ...inv }, equipment.map(item => ({ ...item })), stage, choice.branch, now),
        reselectBlock || unavailable,
      );
      // A preview uses copies with the book/cooldown requirement satisfied. The real
      // availability above still uses the saved values; no inventory or gear is changed.
      const removed = selected || unavailable ? [] : reselect(
        { ...char, last_reselect_at: null },
        { ...inv, [bookId]: Math.max(1, inv[bookId] || 0) },
        equipment.map(item => ({ ...item })),
        stage, choice.branch, now,
      ).unequipped;
      const unequipped = removed.map(id => {
        const item = equipment.find(row => row.id === id);
        return { id: item.id, name: item.name, slot: item.slot, branchReq: item.branch_req || null };
      });
      return {
        branch: choice.branch, branchName: choice.name, ...nodeView(baseClass, targetPath),
        selected, canReselect: reason === null, reason, unequipped,
      };
    });
    return { tier: stage, currentBranch: path[index], book, choices };
  });

  return {
    maxTier: MAX_OPEN_CLASS_TIER,
    current: { baseClass, baseClassName: CLASSES[baseClass].name, ...nodeView(baseClass, path) },
    next,
    reselect: { cooldownUntil, cooldownRemainingMs: cooldownUntil === null ? 0 : Math.max(0, cooldownUntil - now), tiers },
    activity: { partyId: char.party_id || null, atlasRunId: char.atlas_run_id || null },
  };
}

export async function view(env, tg, now) {
  const player = await loadPlayer(env.DB, String(tg), env);
  if (!player) throw new GameError('no_character', '請先選擇這個環境的角色', 404);
  const readOnly = (env.REALM_CONTEXT?.phase || 'ACTIVE') !== 'ACTIVE';
  const readOnlyReason = readOnly ? READ_ONLY_MESSAGE : null;
  const state = stateView(player, now);
  return {
    ...state, skills: state.skills.map(skill => ({ ...skill, researchCost: researchCost(skill) })),
    realmId: env.REALM_CONTEXT?.id || 'permanent', characterId: String(player.char.tg_id),
    readOnly, readOnlyReason,
    career: careerView(player, now, readOnlyReason),
  };
}
