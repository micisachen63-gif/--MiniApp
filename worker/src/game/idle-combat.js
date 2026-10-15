import {chooseMonster,monsterIdentity,monsterPool} from './monsters.js';
import {MAPS} from './constants.js';
import {mapForLevel} from './formulas.js';

// Persistent enemy HP, advanced only by a committed idle minute. No frontend HP simulation.
const copy = value => Array.isArray(value)?value.map(e=>({...e})):{...value};
export const idleMonsterHp = (mapId, elite=false) => (120 + MAPS[mapId].min * 25) * (elite ? 3 : 1);
function spawn(state, char, elite=false) {
  const serial=state.serial++,identity=chooseMonster(state.mapId,elite?'elite':'normal',serial);
  const maxHp=idleMonsterHp(state.mapId,elite);
  return {...identity,id:`idle:${char.tg_id}:${state.mapId}:${state.generation}:${serial}`,mapId:state.mapId,elite,hp:maxHp,maxHp};
}
export function idleCombatState(char) {
  const mapId=mapForLevel(char.level);let state;
  try{state=JSON.parse(char.idle_combat_json||'null');}catch{}
  if(state?.v!==1||state.mapId!==mapId||!Array.isArray(state.enemies)||state.enemies.length!==2||
    !state.enemies.every(e=>e.mapId===mapId&&Number.isInteger(e.hp)&&e.hp>0&&Number.isInteger(e.maxHp)&&e.hp<=e.maxHp&&typeof e.id==='string'&&monsterPool(mapId).some(m=>m.name===e.name))){
    state={v:1,mapId,generation:char.last_settle_at,serial:0,target:0,remainder:0,enemies:[],round:null};
    state.enemies=[spawn(state,char),spawn(state,char)];
  }
  state.enemies=state.enemies.map(e=>({...monsterIdentity(mapId,e.name),...e}));
  return state;
}
export function resolveIdleCombat(state,char,{at,killsBudget,cast=false,skillName='',crit=false,elite=false,eliteMonster=null,strikePlan=null,attackSpeedMultiplier=1,record=true}) {
  const round={id:`idle-round:${char.tg_id}:${at}`,at,mapId:state.mapId,before:record?copy(state.enemies):null,events:[],defeated:[],kills:0};
  // Presentation only: replay one authored spell from the committed starting wave.
  // This is not another damage event and must never change character HP/MP or rewards.
  if(record){const enemy=state.enemies[Math.floor(at/60000)%state.enemies.length];round.presentation={monsterActions:[{sourceId:enemy.id,spriteKey:enemy.spriteKey,name:enemy.name,spell:enemy.spell,behavior:enemy.behavior,action:'cast',attackDirection:-1,cosmetic:true}]};}
  // The original kills/minute efficiency becomes a damage budget. Kills now require HP reaching zero.
  // Fractional progress remains on the same enemy between minutes instead of being rounded away.
  const damageBudget=Math.max(0,killsBudget)*idleMonsterHp(state.mapId);
  let remaining=Math.floor(damageBudget+(state.remainder||0)),target=state.target===1?1:0;
  state.remainder=damageBudget+(state.remainder||0)-remaining;
  const plan=char.base_class==='thief'&&Array.isArray(strikePlan)&&strikePlan.length>0&&strikePlan.length<=9?strikePlan:null;
  if(plan){round.strikes=[];round.attackSpeedMultiplier=attackSpeedMultiplier;round.damage=remaining;}
  let remainingWeight=plan?.reduce((sum,s)=>sum+Math.max(.01,s.weight||1),0)||3;
  for(let strike=0;strike<(plan?.length||3);strike++){
    const weight=plan?Math.max(.01,plan[strike].weight||1):1;
    let amount=strike===(plan?.length||3)-1?remaining:Math.floor(remaining*weight/remainingWeight);remaining-=amount;remainingWeight-=weight;
    const strikeResult=plan?{index:strike,crit:!!plan[strike].crit,damage:amount,hits:[]}:null;
    while(amount>0){
      const enemy=state.enemies[target],damage=Math.min(enemy.hp,amount),before=enemy.hp;
      enemy.hp-=damage;amount-=damage;
      if(strikeResult)strikeResult.hits.push({targetId:enemy.id,beforeHp:before,afterHp:enemy.hp,damage});
      if(record)round.events.push({type:'hit',targetId:enemy.id,enemy:copy(enemy),beforeHp:before,afterHp:enemy.hp,damage,crit:plan?!!plan[strike].crit:crit,...(plan?{attackSpeedMultiplier}:{}),skill:cast&&strike===0,skillName:cast&&strike===0?skillName:'普通攻擊',strike});
      if(enemy.hp===0){round.defeated.push(copy(enemy));round.kills++;state.enemies[target]=spawn(state,char);if(record)round.events.push({type:'spawn',slot:target,enemy:copy(state.enemies[target])});target=1-target;}
    }
    if(strikeResult)round.strikes.push(strikeResult);
  }
  if(elite){
    const enemy={...spawn(state,char,true),...(eliteMonster||{})};
    round.defeated.push({...enemy,hp:0});
    if(record){round.events.push({type:'elite',enemy:copy(enemy)});
    round.events.push({type:'hit',targetId:enemy.id,enemy:{...enemy,hp:0},beforeHp:enemy.hp,afterHp:0,damage:enemy.hp,skill:true,skillName:'菁英反擊',strike:plan?'elite':3});}
    round.eliteKills=1;
  }
  state.target=target;round.after=record?copy(state.enemies):null;
  if(round.events.length>60){round.events=[];round.summarized=true;}
  state.round=record?round:null;return round;
}
