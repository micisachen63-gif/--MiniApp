import {elementalDamage} from './elements.js';
// v0.5 群組決鬥 (1v1 PK) rules + duel simulation (pure). Persistence lives in services/pk.js.
import { PK } from './constants.js';
import { GameError } from './classes.js';

/** eligibility for a challenge/accept between two characters (levels only; caps/cooldowns need the DB) */
export function pkBlock(a, b) {
  if (!a) return ['no_character', '你還沒有角色，私訊小精靈輸入 /rpg 開始冒險'];
  if (!b) return ['no_target', '對方還沒有 RPG 角色（或找不到這個人）'];
  if (String(a.tg_id) === String(b.tg_id)) return ['self', '不能跟自己決鬥'];
  if (a.level < PK.minLevel) return ['level', `決鬥需要 Lv${PK.minLevel}（你 Lv${a.level}）`];
  if (b.level < PK.minLevel) return ['level', `對方要 Lv${PK.minLevel} 才能決鬥（對方 Lv${b.level}）`];
  if (Math.abs(a.level - b.level) > PK.maxLevelGap) return ['level_gap', `等級差超過 ${PK.maxLevelGap}（Lv${a.level} vs Lv${b.level}），不能決鬥`];
  return null;
}
export function checkPk(a, b) { const x = pkBlock(a, b); if (x) throw new GameError(x[0], x[1], x[0] === 'no_character' || x[0] === 'no_target' ? 404 : 400); }

/**
 * Turn-based duel from two computeStats() results. Full HP/MP snapshots (a duel never touches idle HP).
 * Each turn: the actor casts its skill if it has the MP (else a basic hit at 60%), crit = 5% + critPct (×1.5),
 * ±10% variance, damage × (1 − def/(def + 6·L + 40)) × taken × PK.dmgScale. First actor: coin flip.
 * ≤ PK.maxRounds rounds (one round = both act), then the higher HP% wins (ties → defender b).
 */
export function simulateDuel(sa, sb, rng) {
  const f = (s) => ({ hp: s.maxHp, max: s.maxHp, mp: s.maxMp, maxMp: s.maxMp, s });
  const F = { a: f(sa), b: f(sb) }; const log = []; let turn = rng() < 0.5 ? 'a' : 'b'; let rounds = 0;
  const snapshot = () => ({ hp: { a: F.a.hp, b: F.b.hp }, mp: { a: F.a.mp, b: F.b.mp } });
  const initial = snapshot(), maxMp = { a: F.a.maxMp, b: F.b.maxMp };
  const result = (winner, ko) => ({ winner, loser: winner === 'a' ? 'b' : 'a', rounds: ko ? rounds + 1 : rounds, log,
    hp: snapshot().hp, mp: snapshot().mp, max: { a: F.a.max, b: F.b.max }, maxMp, initial, ko });
  const hit = (x, y) => {
    const useSkill = x.mp >= x.s.skill.cost; if (useSkill) x.mp -= x.s.skill.cost; else x.mp = Math.min(x.maxMp, x.mp + Math.ceil(x.maxMp * 0.08) + 1);
    const crit = rng() < 0.05 + (x.s.pct?.critPct || 0); const variance = 0.9 + rng() * 0.2;
    const dr = y.s.def / (y.s.def + 6 * y.s.level + 40);
    const raw = elementalDamage(x.s.atk * (useSkill ? x.s.skill.mult : 0.6),x.s,y.s) * (crit ? PK.critMult : 1) * variance;
    return { dmg: Math.max(1, Math.round(raw * (1 - dr) * y.s.taken * PK.dmgScale)), crit, skill: useSkill };
  };
  while (rounds < PK.maxRounds) {
    for (let k = 0; k < 2; k++) {
      const x = F[turn]; const o = turn === 'a' ? 'b' : 'a'; const y = F[o];
      const before = snapshot();
      const h = hit(x, y); y.hp = Math.max(0, y.hp - h.dmg);
      // v0.5 二轉 sustain: 吸血 % of damage dealt, 施法回 % max HP on a skill cast
      const heal = Math.round(h.dmg * (x.s.pct?.lifestealPct || 0) + (h.skill ? x.max * (x.s.pct?.healPerCastPct || 0) : 0));
      if (heal > 0 && y.hp > 0) x.hp = Math.min(x.max, x.hp + heal);
      log.push({ by: turn, dmg: h.dmg, crit: h.crit, skill: h.skill, hp: y.hp, before, after: snapshot(), healed: x.hp - before.hp[turn], ...(heal > 0 ? { heal, self: x.hp } : {}) });
      if (y.hp <= 0) return result(turn, true);
      turn = o;
    }
    rounds += 1;
  }
  const pa = F.a.hp / F.a.max, pb = F.b.hp / F.b.max; const winner = pa > pb ? 'a' : 'b';
  return result(winner, false);
}

/** loser gear drop: 20% → a ward in the bag absorbs it (consumed), else ONE random equipped piece (weapons included) */
export function rollDrop(rng, loserEquipped, wards) {
  if (rng() >= PK.dropChance) return { drop: false };
  if (wards > 0) return { drop: true, ward: true };
  if (!loserEquipped.length) return { drop: true, ward: false, item: null };
  return { drop: true, ward: false, item: loserEquipped[Math.floor(rng() * loserEquipped.length)] };
}
