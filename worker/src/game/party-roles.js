// Versioned, encounter-local cooperation. No timers, database writes or paid services.
import {GameError} from './classes.js';
import {MECHANICS,damageEnemy,valueOf} from './special.js';

export const ROLE_NAMES={guard:'守護',breach:'破陣',aid:'支援',control:'壓制'};
const NAMES={sword:{guard:'挺身守護',breach:'碎甲重斬',aid:'聖光救援',control:'盾擊截斷'},archer:{guard:'森靈庇護',breach:'弱點狙擊',aid:'自然復甦',control:'封喉風矢'},mage:{guard:'霜晶結界',breach:'元素解構',aid:'淨化祈願',control:'時空封鎖'},thief:{breach:'拆解要害',control:'暗影截脈'}};
const DESCRIPTIONS={guard:'全隊獲得各自最大生命 10% 的護盾',breach:'造成 1.4 倍攻擊傷害、穿透 25% 防禦，削弱首領防禦 15%',aid:'全隊恢復各自最大生命 12%，解除一層負面狀態與咒印',control:'造成 0.8 倍攻擊傷害，打斷蓄力並使首領下一擊降低 20%'};
const phase=(name,roles)=>({name,roles});
const TITAN=[phase('泰坦重甲',['guard','breach'])];
const ORACLE=[phase('神諭咒印',['aid','control'])];
const STARS=[phase('星門重甲',['guard','breach']),phase('失序咒印',['aid','control']),phase('終焉共鳴',['guard','aid','control'])];
export function encounterPlan(kind,id,floor=1){
 const phases=kind==='tower'?(floor===25?TITAN:floor===30?STARS:null):({titan:TITAN,trial3:TITAN,oracle:ORACLE,stars:STARS,trial4:STARS})[id];
 return phases?{version:1,phases:structuredClone(phases),roundSeconds:15,windowRounds:3}:null;
}
export function roleSkills(a){
 const base=a.base||a.base_class,path=String(a.path??a.class_path??'');
 if(Number(a.level)<90||!/^([AB])[12](?:[12]{0,2})$/.test(path)||!NAMES[base])return [];
 const roles=base==='sword'?['guard',path.startsWith('A')?'breach':path.startsWith('B1')?'aid':'control']:
  base==='archer'?['control',path.startsWith('B1')?'aid':path.startsWith('B')?'guard':'breach']:
  base==='mage'?['aid',path.startsWith('A2')||path.startsWith('B2')?'guard':path.startsWith('B1')?'control':'breach']:['breach','control'];
 return roles.map(role=>({id:`role_${role}`,role,name:NAMES[base][role],description:DESCRIPTIONS[role],mp:Math.max(1,Math.ceil((a.maxMp||100)*.1)),cooldownRounds:3}));
}
export function validateRole(a,id,s){
 const skill=roleSkills(a).find(x=>x.id===id);
 if(!s.cooperation||!skill)throw new GameError('role','這個角色無法使用此組隊戰技');
 if(a.hp<=0)throw new GameError('down','倒地時無法處理機制');
 if((a.roleCooldowns?.[id]||0)>s.round)throw new GameError('cooldown','組隊戰技仍在回合冷卻中');
 if(a.mp<skill.mp)throw new GameError('mp','魔力不足，請保留組隊戰技所需魔力');
 return skill;
}
// Maximum matching, rather than greedy coverage: one hero may not fill two duties in a phase.
export function assignRoles(roles,actors,can=(a,r)=>roleSkills(a).some(s=>s.role===r),used=new Set()){
 const search=(index,result)=>{
  if(index===roles.length)return result;
  for(const a of actors){if(used.has(a.id)||!can(a,roles[index]))continue;
   used.add(a.id);const found=search(index+1,{...result,[roles[index]]:a.id});used.delete(a.id);if(found)return found;
  }return null;
 };return search(0,{});
}
export function briefing(plan,actors){
 if(!plan)return null;
 const phases=plan.phases.map(p=>({...p,assignment:assignRoles(p.roles,actors)}));
 return {version:plan.version,roundSeconds:15,windowRounds:3,phases,ready:phases.every(p=>p.assignment),
  guide:'每道機制需不同隊員分工；每回合 15 秒，三回合內完成。護甲封印期間無法扣血，破解後開放輸出；下一道封印前會保留首領血量。未手動選招時自動協調可用戰技，仍需保留魔力。',
  roles:ROLE_NAMES};
}
export function assertRoster(plan,actors){
 const b=briefing(plan,actors),bad=b?.phases.find(p=>!p.assignment);
 if(bad)throw new GameError('party_roles',`${bad.name}需要不同隊員分擔${bad.roles.map(r=>ROLE_NAMES[r]).join('／')}；目前分工不足，請調整職業分支或隊員`);
}
export function initCooperation(s,plan){
 if(!plan){delete s.cooperation;return;}
 // Role cooldowns count rounds within one boss, unlike real-time special-book cooldowns.
 for(const a of s.actors)a.roleCooldowns={};
 s.cooperation={version:1,plan:structuredClone(plan),index:0,cleared:0,startedRound:s.round,progress:{},history:[]};
}
export function currentPhase(s){const c=s.cooperation;return c&&!c.complete&&!c.restUntil?c.plan.phases[c.index]:null;}
export function prepareMechanic(s,now){
 const c=s.cooperation;if(!c)return;
 if(c.restUntil&&s.round>=c.restUntil){delete c.restUntil;c.startedRound=s.round;c.progress={};}
 const p=currentPhase(s),e=s.enemy;
 // A real damage budget protects all future checkpoints, including DOT, reflect and multi-hit attacks.
 const remaining=c.plan.phases.length-c.cleared;
 c.hpFloor=c.complete?0:Math.ceil(e.maxHp*remaining/(c.plan.phases.length+1));
 e.damageBudget=p?0:Math.max(0,e.hp-c.hpFloor);
 if(p?.roles.includes('control')){e.windup=true;e.interruptible=true;}
 if(p?.roles.includes('aid')&&c.cursedIndex!==c.index){for(const a of s.actors)if(a.hp>0)(a.debuffs??=[]).push({type:'party-curse',until:now+180000});c.cursedIndex=c.index;}
}
export function roleEvidence(skillId,result,s){
 if(skillId.startsWith('role_'))return [skillId.slice(5)];
 const m=MECHANICS[skillId];if(!m)return [];
 const roles=[];
 if(result.shielded>0||m.guard||m.all&&(m.nextReduce||m.reduce))roles.push('guard');
 if(m.cleanse||result.healed>0&&(m.heal||m.healDamage))roles.push('aid');
 if(m.breakDef||m.mark||m.penetrate&&result.damage>0)roles.push('breach');
 if(m.interrupt&&s.enemy.windup&&s.enemy.interrupted)roles.push('control');
 return roles;
}
export function creditMechanic(s,a,roles){
 const c=s.cooperation,p=currentPhase(s);if(!p||Object.values(c.progress).includes(a.id))return;
 // Save one contribution per hero per phase. An AoE/multi-function book cannot solo the check.
 const role=p.roles.find(r=>!c.progress[r]&&roles.includes(r));if(role)c.progress[role]=a.id;
}
export function automaticRoleAction(s,a){
 const p=currentPhase(s),c=s.cooperation;if(!p||Object.values(c.progress).includes(a.id))return null;
 const roles=p.roles.filter(r=>!c.progress[r]),alive=s.actors.filter(x=>x.hp>0&&!Object.values(c.progress).includes(x.id)&&!s.actions[x.id]);
 const can=(x,r)=>{try{return !!validateRole(x,`role_${r}`,s);}catch{return false;}};
 const assignment=assignRoles(roles,alive,can);
 const role=assignment?roles.find(r=>assignment[r]===a.id):roles.find(r=>can(a,r));
 return role?{skillId:`role_${role}`,targetId:a.id}:null;
}
function put(a,type,value,now,uses=null){a.buffs=(a.buffs||[]).filter(b=>b.type!==type);a.buffs.push({type,value,until:now+60000,uses});}
export function castRole(a,s,id,now){
 const skill=validateRole(a,id,s);a.mp-=skill.mp;(a.roleCooldowns??={})[id]=s.round+skill.cooldownRounds;
 let damage=0,healed=0,shielded=0;
 if(skill.role==='guard')for(const target of s.actors.filter(x=>x.hp>0)){const shield=Math.round(target.maxHp*.1*(1+(a.affixPct?.shieldPct||0)));shielded+=shield;put(target,'shield',Math.max(valueOf(target,'shield',now),shield),now);}
 if(skill.role==='aid')for(const target of s.actors.filter(x=>x.hp>0)){const gain=Math.min(target.maxHp-target.hp,Math.round(target.maxHp*.12*(1+(a.affixPct?.healingPct||0))));target.hp+=gain;healed+=gain;target.debuffs=(target.debuffs||[]).filter(d=>d.type!=='party-curse').slice(1);}
 if(skill.role==='breach'){damage=damageEnemy(s.enemy,a.atk*1.4,{penetrate:.25},now,a);put(s.enemy,'breakDef',.15,now);}
 if(skill.role==='control'){damage=damageEnemy(s.enemy,a.atk*.8,{},now,a);put(s.enemy,'enemyNextReduce',.2,now,1);if(s.enemy.windup&&s.enemy.interruptible)s.enemy.interrupted=true;}
 return {damage,healed,shielded,spentMp:skill.mp,role:skill.role,label:skill.name};
}
export function resolveMechanic(s){
 const c=s.cooperation,p=currentPhase(s);if(!p)return null;
 const missing=p.roles.filter(r=>!c.progress[r]);
 if(!missing.length){
  const result={name:p.name,round:s.round,progress:{...c.progress},success:true};c.history.push(result);c.cleared++;c.index++;
  c.progress={};c.complete=c.index>=c.plan.phases.length;if(!c.complete)c.restUntil=s.round+3;
  return {...result,text:`${p.name}已破解！${c.complete?'首領失去機制護甲，全力進攻！':'獲得兩回合輸出窗口。'}`};
 }
 if(s.round-c.startedRound>=c.plan.windowRounds-1){c.failed=true;return {success:false,text:`${p.name}失守：未完成${missing.map(r=>ROLE_NAMES[r]).join('／')}。請由不同隊員處理，並預留魔力與戰技冷卻。`};}
 return {pending:true,text:`${p.name}：待${missing.map(r=>ROLE_NAMES[r]).join('／')}，剩 ${c.plan.windowRounds-(s.round-c.startedRound)-1} 回合。`};
}
export function cooperationView(s){
 const c=s.cooperation;if(!c)return null;
 const p=currentPhase(s);
 return {version:1,cleared:c.cleared,total:c.plan.phases.length,complete:!!c.complete,failed:!!c.failed,
  name:p?.name|| (c.complete?'破陣完成':'輸出窗口'),roles:p?.roles||[],progress:c.progress,
  roundsLeft:p?Math.max(0,c.plan.windowRounds-(s.round-c.startedRound)):0,
  next:c.restUntil?{round:c.restUntil,...c.plan.phases[c.index]}:null,history:c.history,hpFloor:c.hpFloor||0};
}
