// Pure dungeon/trial projection. The caller cannot select another party kind.
import { loadPlayer } from '../db.js';
import { DUNGEONS } from './party.js';
import { readPartyScene, readReason } from './party-scene-common.js';
import { DUNGEON_BALANCE } from '../game/pve-balance.js';
import { briefing, encounterPlan } from '../game/party-roles.js';
import { SPECIAL_SKILLS } from '../game/special.js';
import { dungeonSkillPool } from '../game/thief-skill-catalog.js';

export async function view(env, tg, body = {}, now) {
  const player = await loadPlayer(env.DB, String(tg), env);
  const scene = await readPartyScene(env, player, body, now, 'dungeon'), { char } = player;
  const dungeons = DUNGEONS.map(dungeon => {
    const unavailable = scene.blockedReason || (char.level < dungeon.level ? readReason('level', '需要 Lv.' + dungeon.level)
      : dungeon.trial && String(char.class_path || '').length < dungeon.trial - 1 ? readReason('trial', '轉職階段不符合此試煉') : null);
    return {
      ...dungeon, challenge: !!DUNGEON_BALANCE[dungeon.id],
      dropSkillIds: dungeon.trial ? [] : dungeonSkillPool(SPECIAL_SKILLS, dungeon.skillLevels, char).map(skill => skill.id),
      cooperation: briefing(encounterPlan('dungeon', dungeon.id), []),
      canCreate: unavailable === null, reason: unavailable,
    };
  });
  return { ...scene, dungeons };
}
