// Server-authoritative, deterministic expedition simulation. No browser clock/power/loot input.
import {rngFor} from './rng.js';
import {roleSkills,assignRoles,castRole} from './party-roles.js';
import {combatActor,autoPartyAction,castSpecial,validateCast,periodic,receiveDamage,damageEnemy,performThiefNativeStrikes,valueOf,SKILL_MAP} from './special.js';
import {spendMana,restoreOnAction} from './combat-passives.js';
import {computeStats,idleStats,standardStats} from './stats.js';
import {expPerTick} from './formulas.js';
import {makeEliteGear} from './gear.js';
import {GameError} from './classes.js';
import {guardianChance} from './guardian-effects.js';
import {COSMETICS,equippedAura} from './star-ring-cosmetics.js';
import {mapPool,selectEncounter,encounterSchedule} from './star-ring-pools.js';
import {CORE,RANK_REWARDS,hasRankRewards,rankReward} from './star-ring-rank-rewards.js';
export {CORE,RANK_REWARDS,hasRankRewards,rankReward} from './star-ring-rank-rewards.js';

// v1 and v2 retain their published combat/reward rules. v3 only adds a defeat
// ledger and rank rewards; it never rewrites an existing twelve-hour snapshot.
export const ENGINE_VERSION=3;
export const DURATION=12*3600000, STAGE_MS=2*3600000, BEAT_MS=30000, BEATS=STAGE_MS/BEAT_MS;
export const HOUR_MS=3600000,HOUR_BEATS=HOUR_MS/BEAT_MS;
export const TIERS=['初星征途','星砂巡路','銀針古道','縛月隘口','九曜邊境','裂環深境','寂星哨域','黯曜王庭','星蝕禁域'].map((name,i)=>({id:40+i*10,level:40+i*10,name,gearTier:4+i}));
export const TACTICS=[{id:'steady',name:'穩健',description:'優先恢復與守護，降低負傷。'},{id:'balanced',name:'均衡',description:'兼顧突破與補給。'},{id:'deep',name:'深入',description:'更積極施放戰技，承受較強反擊。'}];
export const SHOP=[{id:'reroll',name:'洗屬性卷 ×5',cost:5,item:'scroll_r',qty:5},{id:'weapon',name:'武器強化卷 ×4',cost:5,item:'scroll_w',qty:4},{id:'armor',name:'防具強化卷 ×4',cost:5,item:'scroll_a',qty:4},{id:'blessedWeapon',name:'祝福武器卷軸',cost:80,item:'blessed_scroll_w',qty:1},{id:'blessedArmor',name:'祝福防具卷軸',cost:80,item:'blessed_scroll_a',qty:1},{id:'gear',name:'本職業遠征裝備',cost:40,gear:true},...COSMETICS.map(c=>({...c,cosmetic:c.id}))];
SHOP.push(...['w','a'].map((slot,i)=>({id:'core-'+slot,name:['必過的武器強化卷','必過的防具強化卷'][i],currency:CORE,cost:RANK_REWARDS.coreCost,item:'guaranteed_scroll_'+slot,qty:1})));
export const STAGES=[
 {name:'星砂伏擊',enemyId:'star_ring_scorpion',enemyName:'星砂晶螯蠍',roles:['guard'],spell:'晶毒尾刺',behavior:'尾刺留下短暫晶毒；守護吸收傷害，支援可清除毒素。'},
 {name:'裂環重甲',enemyId:'star_ring_sentinel',enemyName:'裂環鑄衛',roles:['breach'],spell:'裂環震擊',behavior:'每波展開重甲護盾；破陣可摧毀額外護盾。'},
 {name:'銀針網障',enemyId:'star_ring_weaver',enemyName:'銀針鏡蛛',roles:['aid'],spell:'銀針汲能',behavior:'蛛網抽走全隊魔力；支援戰技同時協助補充魔力。'},
 {name:'縛月詠唱',enemyId:'star_ring_lament',enemyName:'縛月哀歌者',roles:['control'],spell:'縛月安魂曲',behavior:'頻繁詠唱高傷安魂曲；壓制可中斷整次施法。'},
 {name:'九曜獸域',enemyId:'star_ring_behemoth',enemyName:'九曜棘冠獸',roles:['guard','breach','aid'],spell:'九曜橫掃',behavior:'對前衛重擊並橫掃全隊；守護護盾降低連帶傷害。'},
 {name:'星蝕審判',enemyId:'star_ring_judge',enemyName:'星蝕審判者',roles:['guard','breach','aid','control'],spell:'星蝕審判',behavior:'詠唱施加短暫咒印並引爆星蝕；壓制打斷、支援解咒、守護承傷、破陣突破。'}
];
const NEW_ENCOUNTERS=[
 {enemyId:'star_ring_bird',enemyName:'星帆銅羽鳥',artIndex:7,mechanic:'swoop',roles:['control'],spell:'銅羽掠空',behavior:'俯衝鎖定狀態最弱的旅人；壓制可以打斷整次俯衝。'},
 {enemyId:'star_ring_lantern',enemyName:'空心星燈靈',artIndex:8,mechanic:'hollow',roles:['breach'],spell:'空心折光',behavior:'星燈以折光護盾遮蔽本體；破陣摧毀護盾並打開攻擊窗口。'},
 {enemyId:'star_ring_serpent',enemyName:'晶瀑蛇鰻',artIndex:9,mechanic:'torrent',roles:['aid','control'],spell:'晶瀑奔流',behavior:'奔流吸走魔力並留下晶寒；壓制打斷奔流，支援解寒與補充魔力。'},
 {enemyId:'star_ring_gargoyle',enemyName:'逆風石翼獸',artIndex:10,mechanic:'gust',roles:['guard','control'],spell:'逆風石翼',behavior:'逆風連擊捲向全隊；守護承受衝擊，壓制可使石翼失衡。'},
 {enemyId:'star_ring_tide',enemyName:'潮汐深冠獸',artIndex:11,mechanic:'tide',roles:['aid','breach'],spell:'深冠潮湧',behavior:'潮汐護殼與濕寒交替覆蓋；破陣打開護殼，支援移除濕寒。'},
 {enemyId:'star_ring_astromancer',enemyName:'失序織星者',artIndex:12,mechanic:'unravel',roles:['guard','breach','aid'],spell:'失序星線',behavior:'星線交織護盾與咒印；守護、破陣與支援共同維持戰線。'}
];
const ORIGINAL_MECHANICS=['venom','shield','drain','song','cleave','curse'];
const original=(index)=>({...STAGES[index],artIndex:index+1,mechanic:ORIGINAL_MECHANICS[index],originalStage:index});
export const HOURLY_ENCOUNTERS=[original(0),NEW_ENCOUNTERS[0],original(1),NEW_ENCOUNTERS[1],original(2),NEW_ENCOUNTERS[2],original(3),NEW_ENCOUNTERS[3],original(4),NEW_ENCOUNTERS[4],NEW_ENCOUNTERS[5],original(5)];
// Add only real, downloaded and verified Grok files (e.g. 'map-01.mp4').
// Missing videos deliberately expose null so mobile never requests fake media.
export const AVAILABLE_SCENE_VIDEOS=Object.freeze(["map-01.mp4","map-02.mp4","map-03.mp4","map-04.mp4","map-05.mp4","map-06.mp4","map-07.mp4","map-08.mp4","map-09.mp4","map-10.mp4","map-11.mp4","map-12.mp4"]);
export const SCENES=['星砂裂岸','白曜浮階','裂環巨廊','鏡月回廊','銀針幽庭','琉璃晶瀑','縛月祭壇','蒼穹風脊','九曜獸域','黯曜潮汐','寂星王庭','星蝕終殿'].map((name,hourIndex)=>{
 const serial=String(hourIndex+1).padStart(2,'0'),video=`map-${serial}.mp4`;return {hourIndex,mapId:`star-ring-map-${serial}`,name,image:`/art/star-ring-20261018/map-${serial}.webp`,video:AVAILABLE_SCENE_VIDEOS.includes(video)?`/art/star-ring-20261018/${video}`:null};
});
export function sceneFor(state,hourIndex){const index=Math.max(0,Math.min(11,hourIndex));return {...SCENES[index],startsAt:state.startedAt+index*HOUR_MS,endsAt:state.startedAt+(index+1)*HOUR_MS};}
export const rolesOf=a=>{
 if(Number(a.level)<40)return [];
 if(Number(a.level)>=90)return roleSkills(a).map(s=>s.role);
 return ({sword:['guard','breach'],archer:['control','breach'],mage:['aid','control'],thief:['breach','control']})[a.base||a.base_class]||[];
};
export function stageRoles(tier,index){
 if(tier>=90)return STAGES[index].roles;
 if(index<4)return STAGES[index].roles;
 if(index===4)return ['guard','breach'];
 return tier<=50?['guard','aid']:tier===60?['guard','control']:tier===70?['guard','aid','control']:['guard','breach','aid','control'];
}
export function encounterRoles(tier,hourIndex){const def=HOURLY_ENCOUNTERS[hourIndex];return def.originalStage!=null?stageRoles(tier,def.originalStage):tier<=60&&def.roles.length>2?def.roles.slice(0,2):def.roles;}
export function castExpeditionRole(a,s,role,now){
 const cleanseBefore=role==='aid'?s.actors.reduce((n,t)=>n+(t.debuffs||[]).filter(d=>['ring-venom','ring-chill','party-curse'].includes(d.type)).length,0):0;
 if(Number(a.level)>=90){const result=castRole(a,s,`role_${role}`,now);speciesRoleBonus(a,s,role,result,now,cleanseBefore);return result;}
 const cost=Math.max(1,Math.ceil(a.maxMp*.1)),id=`role_${role}`;
 if(!rolesOf(a).includes(role)||a.hp<=0||a.mp<cost||(a.roleCooldowns?.[id]||0)>s.round)throw new GameError('role','遠征職責目前不可用');
 a.mp-=cost;(a.roleCooldowns??={})[id]=s.round+3;let damage=0,healed=0,shielded=0;
 const put=(target,type,value,uses=null)=>{target.buffs=(target.buffs||[]).filter(x=>x.type!==type);target.buffs.push({type,value,until:now+60000,uses});};
 if(role==='guard')for(const t of s.actors.filter(t=>t.hp>0)){const n=Math.round(t.maxHp*.1*(1+(a.affixPct?.shieldPct||0)));shielded+=n;put(t,'shield',Math.max(valueOf(t,'shield',now),n));}
 if(role==='aid')for(const t of s.actors.filter(t=>t.hp>0)){const n=Math.min(t.maxHp-t.hp,Math.round(t.maxHp*.12*(1+(a.affixPct?.healingPct||0))));t.hp+=n;healed+=n;t.debuffs=(t.debuffs||[]).slice(1);}
 if(role==='breach'){damage=damageEnemy(s.enemy,a.atk*1.4,{penetrate:.25},now,a);put(s.enemy,'breakDef',.15);}
 if(role==='control'){damage=damageEnemy(s.enemy,a.atk*.8,{},now,a);put(s.enemy,'enemyNextReduce',.2,1);if(s.enemy.windup&&s.enemy.interruptible)s.enemy.interrupted=true;}
 const result={damage,healed,shielded,spentMp:cost,role,label:({guard:'遠征守護',aid:'遠征救援',breach:'遠征破甲',control:'遠征截斷'})[role]};speciesRoleBonus(a,s,role,result,now,cleanseBefore);return result;
}
function speciesRoleBonus(a,s,role,result,now,cleanseBefore=0){
 if(role==='breach'&&['shield','hollow','tide','unravel'].includes(s.enemy.mechanic)&&s.enemy.shield>0){const broken=Math.min(s.enemy.shield,Math.round(s.enemy.maxHp*.08));s.enemy.shield-=broken;result.shieldBroken=broken;}
 if(role==='aid'){
  let cleansed=0;for(const target of s.actors){const before=(target.debuffs||[]).length;target.debuffs=(target.debuffs||[]).filter(d=>!['ring-venom','ring-chill','party-curse'].includes(d.type));cleansed+=before-target.debuffs.length;}
  result.cleansed=Math.max(cleansed,cleanseBefore);
  if(['drain','torrent'].includes(s.enemy.mechanic)){result.restoredMp=0;for(const target of s.actors.filter(t=>t.hp>0)){const n=Math.min(target.maxMp-target.mp,Math.ceil(target.maxMp*.08));target.mp+=n;result.restoredMp+=n;}}
 }
}
export const windupAt=(index,beat)=>index===0?beat%7===6:index===3?beat%3===2:index>=4?beat%4===3:beat%5===4;
export const encounterWindup=(def,beat)=>def.originalStage!=null?windupAt(def.originalStage,beat):def.mechanic==='swoop'?beat%4===1:def.mechanic==='hollow'?beat%6===4:def.mechanic==='torrent'?beat%5===3:def.mechanic==='gust'?beat%4===2:def.mechanic==='tide'?beat%6===5:beat%4===3;
export function coverage(actors,roles=['guard','breach','aid','control']){
 const can=(a,r)=>rolesOf(a).includes(r),assignment=assignRoles(roles,actors,can);if(assignment)return {assignment,missing:[]};
 // Maximum partial matching, never assign one person two duties.
 for(let n=roles.length-1;n>=0;n--){for(let mask=0;mask<(1<<roles.length);mask++){
  const subset=roles.filter((_,i)=>mask&(1<<i));if(subset.length!==n)continue;
  const found=assignRoles(subset,actors,can);if(found)return {assignment:found,missing:roles.filter(r=>!subset.includes(r))};
 }}return {assignment:{},missing:roles};
}
export function snapshot(player){
 const c=player.char,equipped=player.equipment.filter(e=>e.is_equipped),st=computeStats(c,equipped),idle=idleStats(c,equipped);
 const a=combatActor(c,st,{hp:st.maxHp,mp:st.maxMp});
 // Snapshot native skill/learned loadout, passive stats, collection and active guardian.
 // Baseline is the existing supplied normal-idle minute (gear speed, EXP affixes,
 // target bonus, guardian). Combat native/passive advantages affect expedition
 // performance separately; damage-based multi-hit multipliers are not EXP multipliers.
 a.baselineExpPerMinute=Math.max(1,Math.round(expPerTick(c.level)*idle.g*idle.expFactor));
 a.standardAttack=standardStats(c.base_class,c.class_path,c.level).atk;
 a.equipment=equipped.map(e=>({...e}));a.roles=rolesOf(a);a.baseClass=c.base_class;a.classPath=c.class_path;a.gender=c.gender;a.departureAtk=a.atk;a.aura=equippedAura(c);
 return a;
}
function enemyFor(state,hourIndex,strength){
 const def=HOURLY_ENCOUNTERS[hourIndex],index=Math.floor(hourIndex/2);
 const maxHp=Math.max(100,Math.round(strength*(state.difficulty==='advanced'?17:14)*(1+index*.04)));
 return {id:def.enemyId,name:def.enemyName,spell:def.spell,behavior:def.behavior,mechanic:def.mechanic,counterRoles:encounterRoles(state.tier,hourIndex),artIndex:def.artIndex,artUrl:`/art/star-ring-20261018/monster-${String(def.artIndex).padStart(2,'0')}.webp`,level:state.tier,maxHp,hp:maxHp,def:state.tier*1.3,element:hourIndex%2?'dark':'earth',buffs:[],dots:[],shield:['shield','hollow','tide','unravel'].includes(def.mechanic)?Math.round(maxHp*(def.mechanic==='hollow'?.22:.18)):0,windup:false,interruptible:true};
}
export const usesPools=state=>[2,3].includes(state.engineVersion);
export const encounterPool=hourIndex=>mapPool(hourIndex,HOURLY_ENCOUNTERS);
function pooledEnemy(state,hourIndex,strength,def){
 const base=enemyFor(state,hourIndex,strength),maxHp=Math.max(100,Math.round(base.maxHp*({normal:.88,elite:1.18,boss:1.7})[def.rank]));
 const roles=def.rank==='boss'?encounterRoles(state.tier,hourIndex):def.rank==='elite'?[...new Set([...encounterRoles(state.tier,hourIndex),...def.roles])]:def.roles;
 return {...base,id:def.enemyId,name:def.enemyName,rank:def.rank,mechanic:def.mechanic,spell:def.spell,behavior:def.behavior,
  basicAttack:def.basicAttack||null,counterRoles:state.tier<=60&&def.rank!=='boss'?roles.slice(0,2):roles,
  artIndex:def.artIndex||null,artUrl:def.artUrl||base.artUrl,maxHp,hp:maxHp,shield:['shield','hollow','tide','unravel'].includes(def.mechanic)?Math.round(maxHp*(def.mechanic==='hollow'?.22:.18)):0};
}
function spawnPooled(b,state,localBeat=0){
 const seen=b.poolSeen??={elite:false,boss:false},wave=b.waves-b.hourStartWave;
 const def=selectEncounter(state,b.hourIndex,wave,seen,localBeat,HOURLY_ENCOUNTERS,b.enemy?.id);
 if(def.rank!=='normal')seen[def.rank]=true;
 b.enemy=pooledEnemy(state,b.hourIndex,b.strength,def);
 b.poolSerial=(b.poolSerial||0)+1;
 (b.sightings??=[]).push({hourIndex:b.hourIndex,at:state.startedAt+b.hourIndex*HOUR_MS+localBeat*BEAT_MS,id:def.enemyId,name:def.enemyName,rank:def.rank,wave:b.waves+1});
}
function pooledDue(b,state,localBeat){
 const plan=encounterSchedule(state.seed,b.hourIndex);
 return !b.poolSeen?.boss&&localBeat>=plan.bossBeat||!b.poolSeen?.elite&&localBeat>=plan.eliteBeat;
}
// Used both by the battle step and its next-wave presentation. No damage/loot
// RNG is touched and the original dead combat snapshot remains immutable.
export function nextWaveEnemy(state,b){
 if(!usesPools(state))return {...b.enemy,hp:b.enemy.maxHp,buffs:[],dots:[],shield:['shield','hollow','tide','unravel'].includes(b.enemy.mechanic)?Math.round(b.enemy.maxHp*(b.enemy.mechanic==='hollow'?.22:.18)):0,windup:false,interrupted:false};
 const copy=structuredClone(b),localBeat=b.sequence%HOUR_BEATS;
 spawnPooled(copy,state,localBeat);return copy.enemy;
}
function initBattle(state,index,actors){
 const strength=actors.reduce((n,a)=>n+(a.standardAttack||a.atk),0),hourIndex=index*2;
 const b={stageIndex:index,hourIndex,scene:sceneFor(state,hourIndex),enemy:enemyFor(state,hourIndex,strength),actors:structuredClone(actors).map(a=>{const{equipment,...combat}=a;return {...combat,hp:Math.max(a.hp,a.maxHp*.45),mp:a.maxMp,buffs:[],debuffs:[],roleCooldowns:{}};}),events:[],sequence:index*BEATS,contribution:{},round:1,waves:0,objective:(state.difficulty==='advanced'?34:30)+index*2,encounters:[],roleFailures:[],strength,hourStartWave:0};
 if(usesPools(state)){b.enemy=null;spawnPooled(b,state);}return b;
}
function finishArea(b,state){
 if(b.encounters.some(e=>e.hourIndex===b.hourIndex))return;
 b.encounters.push({hourIndex:b.hourIndex,scene:b.scene,enemyId:b.enemy.id,enemyName:b.enemy.name,artIndex:b.enemy.artIndex,waves:b.waves-b.hourStartWave,endsAt:state.startedAt+(b.hourIndex+1)*HOUR_MS,...(usesPools(state)?{enemies:b.sightings.filter(e=>e.hourIndex===b.hourIndex)}:{})});
}
function nextArea(b,state,hourIndex){
 finishArea(b,state);b.hourIndex=hourIndex;b.scene=sceneFor(state,hourIndex);b.enemy=enemyFor(state,hourIndex,b.strength);b.hourStartWave=b.waves;
 if(usesPools(state)){b.poolSeen={elite:false,boss:false};b.enemy=null;spawnPooled(b,state);}
}
function monsterAttack(b,beat,at,pressure,tactic,missing,events){
 const e=b.enemy;if(e.hp<=0)return;
 if(e.interrupted){events.push({actorId:'boss',label:`${e.spell}已被打斷`,interrupted:true});return;}
 const factor=(tactic==='deep'?1.18:tactic==='steady'?.8:1)*(1+missing*.2)*(e.rank?({normal:.85,elite:1.1,boss:1.3})[e.rank]:1),front=b.actors.filter(a=>a.hp>0).slice().sort((a,c)=>c.maxHp-a.maxHp)[0];
 const mechanic=e.mechanic,weakest=b.actors.filter(a=>a.hp>0).slice().sort((a,c)=>a.hp/a.maxHp-c.hp/c.maxHp)[0];
 const heavy=e.windup?({song:3.2,curse:2.8,cleave:2.2,swoop:2.4,gust:2.1,torrent:1.9,tide:2.1,unravel:2.4})[mechanic]||2:1;
 if(['curse','unravel'].includes(mechanic)&&e.windup)for(const a of b.actors){a.debuffs=(a.debuffs||[]).filter(d=>d.type!=='party-curse');a.debuffs.push({type:'party-curse',source:'star-ring',until:at+120000});events.push({actorId:'boss',targetId:a.id,label:mechanic==='curse'?'星蝕咒印':'星線束縛',status:'party-curse'});}
 if(mechanic==='hollow'&&e.windup){e.shield=Math.max(e.shield,Math.round(e.maxHp*.15));events.push({actorId:'boss',label:'折光護盾展開',shielded:Math.round(e.maxHp*.15)});}
 for(const a of b.actors){
  const cleave=mechanic==='cleave'?(a.id===front?.id?1.6:1.05):mechanic==='swoop'&&e.windup?(a.id===weakest?.id?1.8:.55):1;
  const curse=(a.debuffs||[]).some(d=>d.type==='party-curse'&&d.until>at)?1.25:1,chill=(a.debuffs||[]).some(d=>d.type==='ring-chill'&&d.until>at)?1.15:1;
  const damage=receiveDamage(a,pressure*factor*heavy*cleave*curse*chill*(1-valueOf(e,'enemyNextReduce',at)),b.actors,e,at);
  events.push({actorId:'boss',targetId:a.id,label:e.windup?e.spell:e.basicAttack||({venom:'晶螯突刺',shield:'鑄衛槌擊',drain:'銀針穿刺',song:'哀歌殘響',cleave:'棘冠撕咬',curse:'審判斬擊',swoop:'銅羽散射',hollow:'星燈灼光',torrent:'晶鰻尾擊',gust:'石翼拍擊',tide:'深冠衝撞',unravel:'星線切割'})[mechanic],damage});
  if(mechanic==='venom'&&e.windup&&a.hp>0){a.debuffs=(a.debuffs||[]).filter(d=>d.type!=='ring-venom');a.debuffs.push({type:'ring-venom',until:at+90000});events.push({actorId:'boss',targetId:a.id,label:'晶毒附著',status:'ring-venom'});}
  if((mechanic==='drain'&&beat%6===5||mechanic==='torrent'&&e.windup)&&a.hp>0){const lost=Math.min(a.mp,Math.ceil(a.maxMp*(mechanic==='torrent'?.15:.2)));a.mp-=lost;events.push({actorId:'boss',targetId:a.id,label:e.spell,drainedMp:lost});}
  if(['torrent','tide'].includes(mechanic)&&e.windup&&a.hp>0){a.debuffs=(a.debuffs||[]).filter(d=>d.type!=='ring-chill');a.debuffs.push({type:'ring-chill',until:at+90000});events.push({actorId:'boss',targetId:a.id,label:'濕寒侵襲',status:'ring-chill'});}
  if(mechanic==='gust'&&e.windup){const second=receiveDamage(a,pressure*factor*.75,b.actors,e,at);events.push({actorId:'boss',targetId:a.id,label:'逆風追擊',damage:second});}
 }
 for(const buff of e.buffs)if(buff.type==='enemyNextReduce'&&buff.uses>0)buff.uses--;
}
/** Project exactly the same combat steps used by checkpoint settlement; projections never write rewards. */
export function simulateStage(state,index,beats=BEATS){
 if(state.engineVersion!=null&&![1,2,3].includes(state.engineVersion))throw new GameError('engine_version','這趟遠征需要對應版本的戰鬥引擎',409);
 const initial=index?state.results[index-1]?.actors:state.actors;
 const stageStart=state.startedAt+index*STAGE_MS;
 const active=(initial||state.actors).filter(a=>!state.departed?.[a.id]||state.departed[a.id]>stageStart);
 const b=initBattle(state,index,active),rng=rngFor(`${state.seed}:combat:${index}`),tactic=state.stageTactics?.[index]||state.tactic;
 for(const a of b.actors)a.atk=(a.departureAtk||a.atk)*(tactic==='deep'?1.12:tactic==='steady'?.96:1);
 const pressure=active.reduce((n,a)=>n+a.maxHp,0)/Math.max(1,active.length)*.025*(state.difficulty==='advanced'?1.2:1);
 let resolvedBeat=null;
 const steps=Math.min(BEATS,Math.max(0,Math.floor(beats)));
 for(let beat=0;beat<steps;beat++){
  const at=stageStart+beat*BEAT_MS;b.round=beat+1;b.sequence++;
  b.actors=b.actors.filter(a=>!state.departed?.[a.id]||state.departed[a.id]>at);
  const hourIndex=index*2+Math.floor(beat/HOUR_BEATS);
  if(hourIndex!==b.hourIndex)nextArea(b,state,hourIndex);
  const localBeat=beat%HOUR_BEATS,arrival=[];
  if(usesPools(state)&&(b.enemy.hp<=0||pooledDue(b,state,localBeat))){
   const defeated=b.enemy.hp<=0,previous={id:b.enemy.id,name:b.enemy.name};spawnPooled(b,state,localBeat);
   arrival.push({actorId:'system',label:`${defeated?'下一波':'前方魔物退開，'}${({normal:'普通魔物',elite:'菁英',boss:'首領'})[b.enemy.rank]}「${b.enemy.name}」現身`,arrival:true,enemyId:b.enemy.id,previousId:previous.id});
   if(defeated)for(const a of b.actors){a.hp=Math.min(a.maxHp,a.hp+a.maxHp*.02);a.mp=Math.min(a.maxMp,a.mp+a.maxMp*.04);}
  }
  const required=usesPools(state)?b.enemy.counterRoles:encounterRoles(state.tier,hourIndex),def=usesPools(state)?{mechanic:b.enemy.mechanic}:HOURLY_ENCOUNTERS[hourIndex];
  const currentMatch=coverage(b.actors,required);
  b.roleFailures=[...new Set([...b.roleFailures,...currentMatch.missing])];
  // Only new departures waive the guard seal; old battle snapshots replay unchanged.
  b.enemy.damageBudget=state.difficulty==='advanced'&&currentMatch.missing.some(r=>r!=='guard'||state.optionalGuard!==true)?0:Infinity;
  b.enemy.windup=encounterWindup(def,localBeat);b.enemy.interrupted=false;b.enemy.interruptible=true;
  if(b.enemy.hp<=0){b.enemy.hp=b.enemy.maxHp;b.enemy.buffs=[];b.enemy.dots=[];b.enemy.shield=['shield','hollow','tide','unravel'].includes(b.enemy.mechanic)?Math.round(b.enemy.maxHp*(b.enemy.mechanic==='hollow'?.22:.18)):0;for(const a of b.actors){a.hp=Math.min(a.maxHp,a.hp+a.maxHp*.02);a.mp=Math.min(a.maxMp,a.mp+a.maxMp*.04);}}
  const events=arrival;periodic(b.actors,b.enemy,at);
  for(const a of b.actors){a.debuffs=(a.debuffs||[]).filter(d=>d.until>at);if(a.debuffs.some(d=>d.type==='ring-venom')){const damage=receiveDamage(a,a.maxHp*.025,b.actors,b.enemy,at,{elementApplied:true,defApplied:true});events.push({actorId:'boss',targetId:a.id,label:'晶毒侵蝕',damage,status:'ring-venom'});}}
  for(const a of b.actors){
   if(a.hp<=0){a.hp=Math.ceil(a.maxHp*.3);a.mp=Math.ceil(a.maxMp*.25);a.wounds=(a.wounds||0)+1;events.push({actorId:a.id,label:'補給救援',healed:a.hp});continue;}
   a.mp=Math.min(a.maxMp,a.mp+Math.ceil(a.maxMp*.1));
   let action=autoPartyAction(a,b.actors,b.enemy,at,b),result;
   const assignedDuty=Object.entries(currentMatch.assignment).find(([,id])=>id===a.id)?.[0];
   const aidNeeded=b.actors.some(t=>(t.debuffs||[]).some(d=>['ring-venom','ring-chill','party-curse'].includes(d.type)));
   const duty=assignedDuty||(aidNeeded&&rolesOf(a).includes('aid')?'aid':undefined);
   const roleDue=duty==='control'?b.enemy.windup:duty==='guard'?b.enemy.windup||beat%4===0:duty==='aid'?b.actors.some(t=>t.hp/t.maxHp<.82||(t.debuffs||[]).length)||beat%4===0:beat%4===0;
   if(duty&&roleDue&&a.mp>=a.maxMp*.1){
    // castRole shares the actual role permissions/costs/effects with short-party combat.
    const roleState={...b,cooperation:{},round:beat+1};
    try{result=castExpeditionRole(a,roleState,duty,at);action={skillId:`role_${duty}`};}catch{}
   }
   try{
    if(!result&&action.skillId!=='attack'&&action.skillId!=='defend'){
     const skill=validateCast({base_class:a.base,class_path:a.path,level:a.level,mp:a.mp,affixPct:a.affixPct},a.special,action.skillId,at);
     result=castSpecial(a,b.actors,b.enemy,skill,action.targetId,at,rng,b);
    }
   }catch{result=null;}
   if(!result){
    const cast=a.mp>=(a.skill?.cost||0),mult=cast?(a.skill?.mult||1.5):1.5;
    if(a.base==='thief')result=performThiefNativeStrikes(a,b.enemy,at,{cast,baseRaw:a.atk*mult,rng,actionId:`${state.seed}:${index}:${beat}:${a.id}`});
    else result={damage:damageEnemy(b.enemy,a.atk*mult*(1+valueOf(a,'atkUp',at))*(1+valueOf(a,'damageUp',at))*(rng()<a.crit?1.5:1),{},at,a)};
    if(cast)spendMana(a,a.skill?.cost||0,rng);
    restoreOnAction(a,result.damage||0,{cast,enabled:true});action={skillId:'attack'};
   }
   const c=b.contribution[a.id]??={damage:0,healing:0,roles:0};c.damage+=result.damage||0;c.healing+=result.healed||0;c.roles+=action.skillId.startsWith('role_')?1:0;
   events.push({actorId:a.id,skillId:action.skillId,label:result.label||SKILL_MAP[action.skillId]?.name||a.skill?.name||'戰技',damage:result.damage||0,healed:result.healed||0,...(result.restoredMp?{restoredMp:result.restoredMp}:{}),...(result.cleansed?{cleansed:result.cleansed}:{}),...(result.shieldBroken?{shieldBroken:result.shieldBroken}:{})});
  }
  monsterAttack(b,localBeat,at,pressure,tactic,currentMatch.missing.length,events);
  if(b.enemy.hp<=0){b.waves++;if(b.waves>=b.objective)resolvedBeat??=beat;events.push({actorId:'boss',label:`已擊退第 ${b.waves} 波`,wave:b.waves});if(hasRankRewards(state)&&b.enemy.rank!=='normal')(b.defeats??=[]).push({hourIndex:b.hourIndex,serial:b.poolSerial,id:b.enemy.id,name:b.enemy.name,rank:b.enemy.rank,at});}
  b.events=events;b.actors.forEach(a=>{a.buffs=a.buffs.filter(x=>x.until>at&&(x.uses==null||x.uses>0));});
 }
 // Exactly at the one-hour boundary show the new place/foe without inventing
 // its first combat action. Both online projections and offline replay use it.
 if(steps===HOUR_BEATS){nextArea(b,state,index*2+1);b.events=[{actorId:'system',label:`隊伍抵達${b.scene.name}`}];}
 if(steps===BEATS)finishArea(b,state);
 const finalMatch=coverage(b.actors,usesPools(state)?b.enemy.counterRoles:encounterRoles(state.tier,b.hourIndex));
 finalMatch.missing=[...new Set([...b.roleFailures,...finalMatch.missing])];
 const defeated=b.waves>=b.objective,grade=defeated&&!finalMatch.missing.length?(resolvedBeat!=null&&resolvedBeat<BEATS*.65?'S':'A'):'B';
 delete b.enemy.damageBudget;
 return {...b,grade,defeated,coverage:finalMatch,expHours:grade==='S'?4:grade==='A'?22/6:3};
}
export function stageReward(state,actor,index,result){
 const exp=Math.round(actor.baselineExpPerMinute*60*result.expHours),rng=rngFor(`${state.seed}:loot:${actor.id}:${index}`);
 const items={};if(index===1)items.scroll_w=2;if(index===3)items.scroll_a=2;if(index===4)items.scroll_r=2;
 const equipment=[];
 if(index===5){items.star_ring_token=(state.difficulty==='advanced'?11:10)+(state.results.filter(x=>x.grade==='S').length>=4?1:0);
  const tier=TIERS.find(t=>t.id===state.tier).gearTier;
  equipment.push(makeEliteGear({id:`ringgear:${state.id}:${actor.id}:0`,tgId:actor.id,cls:actor.base,classPath:actor.path,tier,rng,now:state.endsAt}));
  const extraChance=state.difficulty==='advanced'?(result.grade==='S'?.6:result.grade==='A'?.25:0):result.grade==='S'?.35:0;
  if(extraChance>0&&rng()<guardianChance(extraChance,actor))equipment.push(makeEliteGear({id:`ringgear:${state.id}:${actor.id}:1`,tgId:actor.id,cls:actor.base,classPath:actor.path,tier,rng,now:state.endsAt}));
  equipment.forEach(e=>{e.source='star_ring';e.name=e.name.replace(/^菁英/,'星征');});
 }
 if(hasRankRewards(state)){
  const bonus=rankReward(state,actor,index,result);for(const[k,v]of Object.entries(bonus.items))items[k]=(items[k]||0)+v;
  return {exp:exp+bonus.exp,baseExp:exp,bonus,items,equipment,grade:result.grade,expHours:result.expHours};
 }
 return {exp,items,equipment,grade:result.grade,expHours:result.expHours};
}
