import {combatActor,performThiefNativeStrikes,autoPartyAction,validateCast,castSpecial,damageEnemy,periodic,valueOf} from './special.js';
import {spendMana,restoreOnAction} from './combat-passives.js';
// v0.5 群組決鬥 (1v1 PK) rules + duel simulation (pure). Persistence lives in services/pk.js.
import { PK } from './constants.js';
import { GameError } from './classes.js';

/** eligibility for a challenge/accept between two characters (levels only; caps/cooldowns need the DB) */
export function pkBlock(a, b) {
  if (!a) return ['no_character', '你還沒有角色，私訊星穹旅誌輸入 /rpg 開始冒險'];
  if (!b) return ['no_target', '對方還沒有星穹旅誌角色（或找不到這個人）'];
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
export function simulateDuel(sa, sb, rng, characters={}) {
  const fighter=(s,id)=>{
    const c=characters[id]||{base_class:s.baseClass,class_path:s.node?.path||'',level:s.level};
    const a=combatActor(c,s,{id,hp:s.maxHp,mp:s.maxMp});
    // PK has its own HP/MP and encounter cooldowns; PvE guardian bonuses stay out.
    a.guardian=null;a.combatant=true;a.damageScale=PK.dmgScale;a.defenseScale=6*s.level+40;
    a.special.cooldowns={};return a;
  };
  const F={a:fighter(sa,'a'),b:fighter(sb,'b')},log=[];
  let turn=rng()<.5?'a':'b',rounds=0;
  const max={a:sa.maxHp,b:sb.maxHp},maxMp={a:sa.maxMp,b:sb.maxMp};
  const snapshot=()=>({hp:{a:F.a.hp,b:F.b.hp},mp:{a:F.a.mp,b:F.b.mp}});
  const initial=snapshot();
  const result=(winner,ko)=>({winner,loser:winner==='a'?'b':'a',rounds:ko?rounds+1:rounds,log,hp:snapshot().hp,mp:snapshot().mp,max,maxMp,initial,ko});
  while(rounds<PK.maxRounds){
    for(let k=0;k<2;k++){
      const x=F[turn],o=turn==='a'?'b':'a',y=F[o],before=snapshot(),now=rounds*30000;
      y.windup=(rounds+1)%3===0;y.interruptible=true;
      periodic([x],y,now);const periodicDamage=before.hp[o]-y.hp;
      let crit=false,useSkill=false,skillId=null,label='普通攻擊',heal=0,spentMp=0,statuses=[],strikes=[];
      if(y.hp>0&&!x.interrupted){
        const action=autoPartyAction(x,[x],y,now,{});
        if(action.skillId!=='attack'){
          const skill=validateCast({base_class:x.base,class_path:x.path,level:x.level,mp:x.mp,affixPct:x.affixPct},x.special,action.skillId,now);
          const r=castSpecial(x,[x],y,skill,x.id,now,rng,{});
          crit=r.crit;useSkill=true;skillId=skill.id;label=skill.name;spentMp=r.spentMp;heal=r.selfHealed||0;
        }else{
          useSkill=x.mp>=x.skill.cost;
          if(useSkill)spentMp=spendMana(x,x.skill.cost,rng);else x.mp=Math.min(x.maxMp,x.mp+Math.ceil(x.maxMp*.08)+1);
          if(x.base==='thief'){
            const native=performThiefNativeStrikes(x,y,now,{cast:useSkill,baseRaw:x.atk*(useSkill?x.skill.mult:.6),rng,critMultiplier:PK.critMult,variance:true,actionId:`${rounds}:${k}:${turn}`});
            crit=native.crit;strikes=native.strikes;statuses=native.statuses||[];heal=restoreOnAction(x,native.damage,{cast:useSkill,enabled:y.hp>0}).heal;
          }else{
          crit=rng()<Math.min(.8,x.crit+valueOf(x,'critUp',now));
          let raw=x.atk*(useSkill?x.skill.mult:.6)*(crit?PK.critMult:1)*(.9+rng()*.2);
          raw*=(1+valueOf(x,'atkUp',now))*(1+valueOf(x,'damageUp',now))*(1+valueOf(x,'nextDamage',now))*(1-valueOf(x,'enemyNextReduce',now));
          const damage=damageEnemy(y,raw,{},now,x);
          const restored=restoreOnAction(x,damage,{cast:useSkill,enabled:y.hp>0});heal=restored.heal;
          for(const b of x.buffs)if(['nextDamage','critUp','enemyNextReduce'].includes(b.type)&&b.uses>0)b.uses--;
          }
          if(useSkill)label=x.skill.name||'職業技能';
        }
      }else if(x.interrupted){label='蓄力遭打斷';x.interrupted=false;}
      const after=snapshot(),dmg=Math.max(0,before.hp[o]-after.hp[o]);
      log.push({by:turn,...(statuses.length?{statuses}:{}),...(x.base==='thief'?{periodicDamage,directDamage:Math.max(0,dmg-periodicDamage),strikes,attackSpeedMultiplier:x.attackSpeedMultiplier}:{}),dmg,crit,skill:useSkill,skillId,label,spentMp,hp:y.hp,before,after,healed:Math.max(0,x.hp-before.hp[turn]),...(heal>0?{heal,self:x.hp}:{})});
      if(y.hp<=0||x.hp<=0)return result(y.hp<=0?turn:o,true);
      turn=o;
    }
    rounds++;
  }
  return result(F.a.hp/F.a.maxHp>F.b.hp/F.b.maxHp?'a':'b',false);
}

/** loser gear drop: 20% → a ward in the bag absorbs it (consumed), else ONE random equipped piece (weapons included) */
export function rollDrop(rng, loserEquipped, wards) {
  if (rng() >= PK.dropChance) return { drop: false };
  if (wards > 0) return { drop: true, ward: true };
  if (!loserEquipped.length) return { drop: true, ward: false, item: null };
  return { drop: true, ward: false, item: loserEquipped[Math.floor(rng() * loserEquipped.length)] };
}
