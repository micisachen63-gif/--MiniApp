// Release-gated catalogue: importing this module does not add books to global drops.
// Combat metadata is numerical and independent of translated names and animation hits.
export const THIEF_SKILLS = [
 {id:'skill_thief_01',eligibleBase:'thief',eligiblePaths:['A','B'],eligibleJob:'盜賊一轉',bookType:'技術書',advancementTier:1,name:'破綻標記',level:30,damage:'2.4A，單體',effect:'目標承受隊伍傷害 +8%，60 秒；不與其他標記相加',mp:18,cooldownSeconds:90,rarity:'普通'},
 {id:'skill_thief_02',eligibleBase:'thief',eligiblePaths:['A','B'],eligibleJob:'盜賊一轉',bookType:'技術書',advancementTier:1,name:'煙幕幻步',level:40,damage:'無直接傷害',effect:'自身下次承傷 −25%，60 秒內',mp:20,cooldownSeconds:90,rarity:'普通'},
 {id:'skill_thief_03',eligibleBase:'thief',eligiblePaths:['A1'],eligibleJob:'影襲刺客',bookType:'技術書',advancementTier:2,name:'無聲處刑',level:60,damage:'3.4A，單體',effect:'目標 HP≤25% 時傷害 +20%；不依目標最大 HP 計傷',mp:30,cooldownSeconds:120,rarity:'高級'},
 {id:'skill_thief_04',eligibleBase:'thief',eligiblePaths:['A2'],eligibleJob:'毒刃刺客',bookType:'技術書',advancementTier:2,name:'淬毒祕術',level:60,damage:'2.5A，單體',effect:'增加 1 層毒刃，最多每人 3 層；每 30 秒基礎每層 0.12A，受淬毒專精與持續傷害加成；最多 3 次，刷新不提前跳傷',mp:28,cooldownSeconds:90,rarity:'高級'},
 {id:'skill_thief_05',eligibleBase:'thief',eligiblePaths:['B1'],eligibleJob:'飛刃遊俠',bookType:'技術書',advancementTier:2,name:'穿心飛刃',level:60,damage:'3.2A，單體',effect:'本次計傷忽略 25% DEF',mp:28,cooldownSeconds:90,rarity:'高級'},
 {id:'skill_thief_06',eligibleBase:'thief',eligiblePaths:['B2'],eligibleJob:'幻刃使',bookType:'技術書',advancementTier:2,name:'鏡影反制',level:60,damage:'無直接傷害',effect:'自身下次承傷 −20%；承受有效傷害後，下次攻擊 +20%，60 秒內',mp:26,cooldownSeconds:120,rarity:'高級'},
];
export const THIEF_SKILL_MAP=Object.fromEntries(THIEF_SKILLS.map(skill=>[skill.id,skill]));
export const THIEF_MECHANICS={
 skill_thief_01:{mark:.08},skill_thief_02:{nextReduce:.25},
 skill_thief_03:{execute:.25,executeBonus:.2},skill_thief_04:{thiefPoison:true},
 skill_thief_05:{penetrate:.25},skill_thief_06:{nextReduce:.2,thiefCounter:.2},
};
const active=(actor,type,now)=>(actor.buffs||[]).some(b=>b.type===type&&b.until>now&&(b.uses==null||b.uses>0));
// Fixed-point cadence: exactly nine real strikes per five native actions at 1.8x.
// Carry lives in the encounter snapshot; replay must never call this mutating scheduler.
export function nextThiefStrikeCount(actor,baseCount=1){
 if((actor.base||actor.base_class)!=='thief')return baseCount;
 const speed=Math.min(3,Math.max(1,Number(actor.attackSpeedMultiplier)||1.8));
 const units=Math.round(speed*1000)*baseCount+(Number.isInteger(actor.thiefAttackCarry)?actor.thiefAttackCarry:0);
 actor.thiefAttackCarry=units%1000;return Math.max(1,Math.floor(units/1000));
}
function putBuff(actor,type,value,now,uses=1,seconds=60){
 actor.buffs=(actor.buffs||[]).filter(b=>b.type!==type);
 actor.buffs.push({type,value,until:now+seconds*1000,uses});
}
export function thiefPrimaryMechanics(actor,enemy,now,{cast=true}={}){
 if((actor.base||actor.base_class)!=='thief'||!cast)return {damageMultiplier:1,penetrate:0};
 const route=String(actor.path??actor.class_path??'').slice(0,2);
 const cfg=actor.skill?.thiefMechanics||{};
 const poisoned=(enemy.dots||[]).some(d=>d.kind==='thiefPoison'&&String(d.owner)===String(actor.id)&&d.left>0&&d.until>now&&d.stacks>=3);
 const markBonus=route==='A1'&&active(enemy,'mark',now)?cfg.markBurst??.1:0;
 const poisonBonus=route==='A2'&&poisoned?cfg.poisonBurst||0:0;
 return {damageMultiplier:1+markBonus+poisonBonus,penetrate:cfg.penetrate??(route==='B1'?.1:0)};
}
export function addThiefPoison(actor,enemy,now){
 if((actor.base||actor.base_class)!=='thief'||enemy.hp<=0)return null;
 enemy.dots=(enemy.dots||[]).filter(dot=>dot.kind!=='thiefPoison'||dot.left>0&&dot.until>now);
 const owner=String(actor.id),old=enemy.dots.find(dot=>dot.kind==='thiefPoison'&&String(dot.owner)===owner);
 const stacks=Math.min(3,(old?.stacks||0)+1),perStack=Math.max(0,actor.atk)*.12*(actor.skill?.thiefMechanics?.poisonPower||1)*(1+Math.min(.45,Math.max(0,actor.affixPct?.dotPct||0)));
 const source={element:actor.element,weaponElem:0,affixPct:actor.affixPct,base:'thief',guardian:actor.guardian};
 const dot={kind:'thiefPoison',owner:actor.id,source,stacks,damage:perStack*stacks,left:3,next:old?.next??now+30000,until:now+90000};
 if(old)Object.assign(old,dot);else enemy.dots.push(dot);
 return {type:'poison',owner:actor.id,stacks,remaining:3,next:dot.next,until:dot.until};
}
export function applyThiefPrimary(actor,enemy,now,{cast=true,damage=0,actionId=null}={}){
 if((actor.base||actor.base_class)!=='thief'||!cast||damage<=0||enemy.hp<=0)return [];
 // The adapter's atomic request guard owns damage. This guard also makes status hooks safe to replay.
 if(actionId!=null){actor.thiefStatusActions??=[];if(actor.thiefStatusActions.includes(String(actionId)))return [];actor.thiefStatusActions.push(String(actionId));actor.thiefStatusActions=actor.thiefStatusActions.slice(-16);}
 const route=String(actor.path??actor.class_path??'').slice(0,2);
 if(route==='A1'){if(active(enemy,'mark',now))return [];putBuff(enemy,'mark',.04,now,null,90);enemy.buffs.at(-1).origin='thiefPrimary';return [{type:'mark',value:.04,until:now+90000}];}
 if(route==='A2'){const status=addThiefPoison(actor,enemy,now);return status?[status]:[];}
 if(route==='B2'){const existing=(enemy.buffs||[]).find(b=>b.type==='enemyNextReduce'&&b.until>now&&(b.uses==null||b.uses>0)),weakening=Math.max(actor.skill?.thiefMechanics?.weakening??.1,existing?.value||0);putBuff(enemy,'enemyNextReduce',weakening,now,1);enemy.buffs.at(-1).origin='thiefPrimary';return [{type:'enemyNextReduce',value:weakening,until:now+60000}];}
 return [];
}
export function armThiefCounter(actor,now,value=.2){if((actor.base||actor.base_class)==='thief')putBuff(actor,'thiefCounter',value,now,1);}
export function triggerThiefCounter(actor,taken,now){
 if(taken<=0||(actor.base||actor.base_class)!=='thief')return;
 const counter=(actor.buffs||[]).find(b=>b.type==='thiefCounter'&&b.until>now&&b.uses>0);
 if(counter){counter.uses=0;const prior=(actor.buffs||[]).find(b=>b.type==='nextDamage'&&b.until>now&&b.uses>0);putBuff(actor,'nextDamage',Math.max(counter.value,prior?.value||0),now,1);}
}
