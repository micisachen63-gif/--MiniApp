// Pure advancement budgets. Kept independent from constants/thief-data to avoid
// circular initialization. Mechanics are snapshotted with the native skill.
const THIRD={
 A11:{role:'要害追擊',mult:1.04,cost:1.06,passive:{critPct:.04,lifestealPct:.01},mechanics:{markBurst:.13},text:'標記目標的原生傷害 +13%；偏重爆擊與吸血'},
 A12:{role:'幽影追獵',mult:1,cost:1.02,passive:{mpEfficiencyPct:.03,skillHastePct:.04},mechanics:{markBurst:.19},text:'標記目標的原生傷害 +19%；偏重追擊與特殊技能周轉'},
 A21:{role:'蝕毒淬鍊',mult:1,cost:1.04,passive:{dotPct:.06},mechanics:{poisonPower:1.25},text:'每層毒傷係數由 0.12 提升至 0.15；維持三層、三次跳傷上限'},
 A22:{role:'血棘收割',mult:1.03,cost:1.05,passive:{lifestealPct:.02},mechanics:{poisonBurst:.10},text:'自身毒刃達三層時，原生直接傷害 +10%；偏重吸血續戰'},
 B11:{role:'疾風穿心',mult:1.02,cost:1.04,passive:{critPct:.03},mechanics:{penetrate:.20},text:'原生技能忽略 20% 防禦；偏重穿甲爆擊'},
 B12:{role:'星刃散華',mult:.98,cost:1.10,targets:1,passive:{mpEfficiencyPct:.025},mechanics:{penetrate:.12},text:'原生技能目標 +1，忽略 12% 防禦；偏重多目標清場'},
 B21:{role:'鏡影牽制',mult:1,cost:1.03,passive:{skillHastePct:.05},mechanics:{weakening:.15},text:'原生技能使敵方下一擊傷害 −15%；偏重團隊牽制'},
 B22:{role:'暮光突襲',mult:1.05,cost:1.07,passive:{critPct:.025},mechanics:{weakening:.10,penetrate:.12},text:'保留下一擊削弱 10%，原生技能另忽略 12% 防禦；偏重進攻'},
};
const labels={critPct:'爆擊率',lifestealPct:'攻擊吸血',mpEfficiencyPct:'魔力效率',skillHastePct:'特殊技能冷卻縮減',dotPct:'持續傷害'};
const round=n=>Math.round(n*10000)/10000;
export function thiefSpecialization(path){
 if(!/^[AB][12][12](?:[12])?$/.test(String(path)))return null;
 const base=THIRD[path.slice(0,3)];if(!base)return null;
 const passive={...base.passive},mechanics={...base.mechanics};let mult=base.mult,cost=base.cost,role=base.role;
 if(path.length===4){
  if(path[3]==='1'){
   role+=' · 極意';mult*=1.025;cost*=1.04;
   for(const key of Object.keys(passive))passive[key]=round(passive[key]*1.25);
   const key=path.startsWith('A11')||path.startsWith('A12')?'markBurst':path.startsWith('A21')?'poisonPower':path.startsWith('A22')?'poisonBurst':path.startsWith('B21')?'weakening':'penetrate';
   mechanics[key]=round((mechanics[key]||0)+(key==='poisonPower'?.15:key==='weakening'?.03:.05));
  }else{
   role+=' · 永續';cost*=.97;
   passive.mpEfficiencyPct=round((passive.mpEfficiencyPct||0)+.04);
   passive.lifestealPct=round((passive.lifestealPct||0)+.01);
  }
 }
 // State the final values so previews/books cannot retain stale tier-3 numbers.
 const effects=[];
 if(mechanics.markBurst)effects.push(`標記目標原生傷害 +${round(mechanics.markBurst*100)}%`);
 if(mechanics.poisonPower)effects.push(`每層毒傷 ${round(.12*mechanics.poisonPower)}×ATK`);
 if(mechanics.poisonBurst)effects.push(`自身三層毒刃時原生傷害 +${round(mechanics.poisonBurst*100)}%`);
 if(mechanics.penetrate)effects.push(`原生技能忽略 ${round(mechanics.penetrate*100)}% 防禦`);
 if(mechanics.weakening)effects.push(`敵方下一擊傷害 −${round(mechanics.weakening*100)}%`);
 const bonuses=Object.entries(passive).map(([key,value])=>`${labels[key]} +${round(value*100)}%`);
 const blurb=path.length===4?(path[3]==='1'?'將路線的核心戰技推向極致':'以節魔與吸血維持長時間戰鬥'):base.text.split('；').at(-1);
 return {role,passive,mechanics,blurb,passiveText:`${role}：${bonuses.join('；')}`,skillMult:round(mult),costScale:round(cost),extraTargets:base.targets||0,
  text:`${role}：${[...effects,...bonuses,`原生技能倍率 ×${round(mult)}`,`基礎耗魔 ×${round(cost)}`,...(base.targets?['原生目標 +1']:[])].join('；')}`};
}
export function advanceThiefNode(node,path){
 const spec=thiefSpecialization(path);if(!spec)return node;
 const passive={...node.passive,text:`${node.passive.text}；${spec.passiveText}`};
 for(const [key,value]of Object.entries(spec.passive))passive[key]=round((passive[key]||0)+value);
 return {...node,passive,specialization:spec,blurb:spec.blurb,skill:{...node.skill,mult:round(node.skill.mult*spec.skillMult),cost:Math.max(1,Math.round(node.skill.cost*spec.costScale)),targets:Math.min(5,node.skill.targets+spec.extraTargets),thiefMechanics:{...spec.mechanics}}};
}
