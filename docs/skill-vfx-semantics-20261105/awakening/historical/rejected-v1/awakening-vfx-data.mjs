/** Planned awakening art only. Presentation timing is not a gameplay cooldown. */
export const AWAKENING_SCHEMA_VERSION = 1;
export const AWAKENING_CLASSES = Object.freeze({sword:'劍士',archer:'妖精',mage:'法師',thief:'盜賊'});
export const AWAKENING_MODES = Object.freeze({
  elite:Object.freeze({label:'菁英',accent:'#e9d3a1'}),
  expert:Object.freeze({label:'專家',accent:'#a8deef'}),
  nightmare:Object.freeze({label:'惡夢',accent:'#c0a2ef'}),
  hell:Object.freeze({label:'地獄',accent:'#f7a978'})
});
const rows = [
  ['sword','elite','戰神破勢','armor-break',3200,'#f3c76c','#fff3c8','破甲接連擊。','金色裂甲紋先張開，三道交錯巨刃逐拍落下，最後以破碎甲片與戰神冠環收束。',['破勢蓄光','裂甲開路','三刃連斬','餘鋒散落']],
  ['sword','expert','壁壘回響','bulwark-echo',3600,'#a1dbe9','#f0fcff','防護接反擊。','層疊六角壁壘迎接入射光，護壁漣漪轉成朝目標推進的反向波環。',['築起壁壘','迎光格擋','回響反推','護紋消退']],
  ['sword','nightmare','血誓狂潮','blood-tide',3700,'#ed657b','#ffd0c8','以資源代價換取持續壓力；提案尚未定數值。','血誓菱印與暗紅環帶凝成契約，連續三層赤色弦月向前湧動，留下血色潮痕。',['血誓凝印','赤潮初湧','連環狂潮','誓紋餘燼']],
  ['sword','hell','諸神斷罪','divine-verdict',4300,'#f4d682','#fffdf0','蓄勢換取首領輸出。','多層聖環長時間向劍脊匯聚，巨大聖劍垂直貫落，審判光冠沿落點向外展開。',['聖環蓄勢','神劍成形','斷罪落刃','金輝退散']],
  ['archer','elite','逐星連矢','star-pursuit',3300,'#92d9ee','#f0fbff','穿透清群。','星座節點沿射線逐一點亮，多束細長星矢追過節點並穿過預覽目標。',['星座定位','逐星起弦','連矢穿行','星塵散去']],
  ['archer','expert','群靈共獵','spirit-hunt',3700,'#a7dfa4','#efffd3','強化召喚協擊。','狼靈、祖靈鹿與獵鷹以不同弧線包抄，同時匯向同一狩獵印；保留三種生物的外形。',['林靈甦醒','三靈出獵','協獵合擊','靈光歸林']],
  ['archer','nightmare','月蝕獵印','eclipse-mark',3700,'#bfa3ee','#f4eaff','寵物、陷阱與本體共用目標。','偏心月蝕環鎖住目標，獸靈綠線、陷阱地紋與紫色主矢三種軌跡共赴同一獵印。',['月蝕標記','獵線連結','三路共狩','暗月殘印']],
  ['archer','hell','蒼穹裁決','sky-judgment',4000,'#9dddf2','#fff4c6','在範圍與單體之間選擇。','蒼穹弓門在高處展翼；單靶呈現集中光矢，三靶呈現分區箭雨，均由天弧引導落點。',['天弓開門','裁決聚矢','天穹落箭','長空餘光']],
  ['mage','elite','星雷共鳴','stellar-resonance',3400,'#a8beff','#eef6ff','連鎖與耗魔取捨。','五芒星節點逐段串接成折線電弧，每次抵達節點都展開同心共鳴環。',['星核點亮','雷鏈接通','節點共鳴','電光退散']],
  ['mage','expert','霜鏡回流','frost-return',3800,'#94e3ec','#efffff','以實際吸收傷害換取有限回魔。','立體冰鏡接住外來光束，冰晶邊緣亮起後，三股柔和青藍流線回到施術端；僅展示吸收回流意象。',['霜鏡立起','入光吸收','晶流回返','冰華消融']],
  ['mage','nightmare','元素裂解','element-fracture',3900,'#c8a3f2','#f6e7ff','對元素抗性施壓。','火、冰、雷、自然四束不同顏色與折線形狀的能量交叉入核，中央稜晶沿四向解離。',['四元聚合','元素交織','稜核裂解','碎光游離']],
  ['mage','hell','太初星爆','primordial-burst',4500,'#a8bcff','#fff1cc','消耗法力或蓄能換取爆發。','螺旋星塵向極小星核收縮，核心短暫靜止後展開多層星芒與寬廣同心衝環。',['太初聚星','星核壓縮','原初星爆','宇塵飄散']],
  ['thief','elite','影襲連鎖','shadow-chain',3300,'#ae9cdc','#f0e5ff','形成多段節奏。','三道煙霧影身依序切入不同側角，逐拍留下短刃線與節點，最後由一記交叉斬銜接。',['暗影分步','第一影襲','連鎖追斬','影痕消失']],
  ['thief','expert','淬毒散華','venom-bloom',3500,'#9fe78e','#edffbd','擴散毒素。','淬毒刃尖先凝成五瓣毒花，再向外散開帶有綠色液滴的刀瓣與毒霧細環。',['淬毒凝露','刃花初綻','毒華擴散','青霧退散']],
  ['thief','nightmare','暗月處決','dark-moon',3900,'#b49ce6','#f6eaff','利用低血量窗口。','巨大偏心暗月逐漸合攏於預覽目標，兩把冷紫斷刃交錯穿過月心，再以細月弧留白收束。',['暗月鎖定','月弧合攏','交刃處決','月痕消退']],
  ['thief','hell','永夜分身','endless-night',4200,'#a49ad2','#e6dcff','有限追擊並有續航代價。','三具獨立煙影分身先錯位成陣，再依次追擊；每具影身都化為煙絲退場，沒有無限循環的分身。',['夜幕展影','三影成陣','有限追擊','歸於夜霧']]
];
function freezeProfile(row){
  const [baseClass,mode,name,composition,durationMs,color,highlight,concept,description,labels]=row;
  const boundaries=composition==='divine-verdict'?[0,.38,.58,.82,1]:composition==='primordial-burst'?[0,.3,.56,.82,1]:[0,.24,.48,.78,1];
  return Object.freeze({
    id:`preview:awakening:${baseClass}:${mode}`,
    sourceCatalogId:`planned:${baseClass}:${mode}`,
    sourceId:null,implemented:false,previewOnly:true,status:'planned-visual-preview',
    baseClass,classLabel:AWAKENING_CLASSES[baseClass],mode,modeLabel:AWAKENING_MODES[mode].label,
    name,composition,durationMs,colors:Object.freeze([color,highlight]),
    modeAccent:AWAKENING_MODES[mode].accent,concept,description,
    phases:Object.freeze(labels.map((label,i)=>Object.freeze({label,start:boundaries[i],end:boundaries[i+1]}))),
    assetSubjects:Object.freeze(composition==='spirit-hunt'?['semantic:0','semantic:5','hawk']:composition==='eclipse-mark'?['semantic:0']:['shadow-chain','endless-night'].includes(composition)?['semantic:8']:[])
  });
}
export const AWAKENING_PROFILES=Object.freeze(rows.map(freezeProfile));
const byId=new Map(AWAKENING_PROFILES.map(p=>[p.id,p]));
export function awakeningFor(id){const p=byId.get(typeof id==='object'?id?.id:id);if(!p)throw new RangeError('Unknown awakening preview ID: '+String(id?.id??id));return p;}
export function phaseFor(profile,progress){const p=awakeningFor(profile);return p.phases.find(x=>progress>=x.start&&progress<x.end)||p.phases[progress>=1?3:0];}
export const AWAKENING_ASSETS=Object.freeze(Object.fromEntries(['sword','archer','mage','thief'].map(k=>[k,`/art/skill-vfx-20261104/${k}-atlas.webp`]).concat([['semantic','/art/skill-vfx-20261104/semantic-atlas.webp'],['hawk','/art/skill-vfx-20261104/hawk.webp']])));
