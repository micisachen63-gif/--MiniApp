/**
 * Reproducible, presentation-only audit of named skill VFX profiles.
 * Build: node worker/tools/build-skill-vfx-semantic-audit.mjs
 * Check without writes: append --check.
 * Optional evidence references: --evidence=.release-sync/path/result.json
 * Reuse the same evidence arguments when rebuilding or checking a report.
 * Evidence is fingerprinted, never promoted to a pass by this generator.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {semanticFor,SEMANTIC_PROFILES,SEMANTIC_ENUMS,SEMANTIC_SCHEMA_VERSION} from '../public/skill-vfx-semantics.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const paths={catalog:'worker/public/skill-vfx-catalog.json',semantics:'worker/public/skill-vfx-semantics.mjs',builder:'worker/tools/build-skill-vfx-semantic-audit.mjs',output:'worker/public/skill-vfx-semantic-audit.json'};
const args=process.argv.slice(2);
for(const arg of args) if(arg!=='--check'&&!arg.startsWith('--evidence=')) throw new Error('Unknown argument: '+arg);
const checking=args.includes('--check');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function workspacePath(path){
  const absolute=resolve(root,path),base=resolve(root);
  if(absolute!==base&&!absolute.startsWith(base+sep)) throw new Error('Audit input must remain in this worktree: '+path);
  return absolute;
}
function fingerprint(path){
  const absolute=workspacePath(path),normalized=relative(root,absolute).split(sep).join('/');
  if(!existsSync(absolute)) return {path:normalized,exists:false,bytes:null,sha256:null};
  const bytes=readFileSync(absolute);
  return {path:normalized,exists:true,bytes:bytes.length,sha256:sha256(bytes)};
}
const catalog=JSON.parse(readFileSync(workspacePath(paths.catalog),'utf8'));
assert.equal(catalog.schemaVersion,1,'Unsupported skill catalog');
assert.equal(SEMANTIC_PROFILES.length,catalog.skills.length,'Authored profiles and current catalog differ');
assert.deepEqual(SEMANTIC_PROFILES.map(p=>p.id).sort(),catalog.skills.map(s=>s.id).sort(),'Identity coverage differs');

const zh={
  element:{steel:'鋼銀與暖金',blood:'血紅',holy:'聖金',nature:'森綠',wind:'風青',lunar:'銀月',star:'星紫與星白',fire:'炎橙',ice:'冰藍',lightning:'電藍',arcane:'秘法紫',time:'時序青金',void:'虛空靛',poison:'毒綠',shadow:'影紫',water:'泉藍'},
  motif:{blade:'刃紋',shield:'盾紋',crown:'冠冕',wing:'羽翼',leaf:'枝葉',thorn:'荊棘',star:'星芒',sun:'日冕',snowflake:'六角冰晶',clock:'時鐘刻度',rift:'空間裂隙',mirror:'鏡片',moon:'月牙',serpent:'蛇形',seal:'契約印記',banner:'戰旗',beast:'靈獸',soul:'魂光',flame:'焰紋',rune:'法術符文',eye:'瞄準眼紋',crack:'地裂紋',drop:'光滴',web:'交織網紋'},
  accent:{rays:'放射光芒',orbit:'環繞光軌',halo:'光環',shards:'碎片',ripple:'波紋',glyph:'符文刻線',echo:'重疊殘影',trail:'拖尾'},
  routeAccent:{base:'基礎路線構圖',assault:'精進路線的外放鋒芒框',ward:'守望路線的環繞護框（純裝飾，不授予護盾）'},
  family:{slash:'斬擊',whirlwind:'旋風斬',bleed:'裂傷斬',shield:'盾形',counter:'反擊',pierce:'穿透投射',volley:'連射',rain:'降落箭雨',snipe:'狙擊',beast:'靈獸',summon:'召喚',trap:'陷阱',lightning:'閃電',frost:'冰霜',fireball:'火球',meteor:'隕石',arcane:'秘法脈衝',beam:'光束',heal:'回復',holy:'聖光',buff:'增益',poison:'淬毒',execute:'終結斬',combo:'連擊',dash:'突進',shadow:'幻影',time:'時間',curse:'標記'},
};
const styleDescriptions={
  inherit:skill=>'保留'+zh.family[skill.family]+'的核心動作',
  orbit:()=> '刃片沿弧線繞行與回旋',
  'blade-rain':()=> '刃片由高處降落至權威目標位置',
  'double-shot':()=> '兩枚箭依序指向同一權威目標',
  pack:(_skill,p)=>p.multiplicity>1?'多道靈獸主體沿突襲軌跡前進':'靈獸主體沿協擊軌跡前進',
  summon:()=> '具體召喚主體由法陣顯現',
  void:()=> '空間裂隙展開並向內收縮',
  clock:()=> '時鐘刻度與時間軌跡轉動',
  banner:()=> '戰旗升起並展開環繞光紋',
  smoke:()=> '煙幕展開並浮出影分身',
  mirror:()=> '鏡片與反射殘影分層展開',
  tree:()=> '世界樹主體與枝葉、根系光紋展開',
  serpent:()=> '蛇形軌跡彎曲纏繞',
  fountain:()=> '光泉向上湧起，光滴向外回落',
  groundwave:()=> '地面波紋與裂紋由中心向外擴散',
  aurora:()=> '極光帶形成流動的寒光帷幕',
  starfall:()=> '星光或投射物由上方向目標區域降下',
  cage:()=> '交織線條圍成封鎖光框',
  sunburst:()=> '放射冠冕由內向外擴張',
  storm:()=> '旋風環帶環繞主題中心流動',
  crosscut:()=> '斬光交錯切入主題中心',
  comet:()=> '弧形長尾沿追跡方向伸展',
};
const semanticCells=[
  {cell:0,key:'wolf',nameZh:'狼'},
  {cell:1,key:'star-spirit',nameZh:'星靈'},
  {cell:2,key:'abyss-wraith',nameZh:'深淵幽魂'},
  {cell:3,key:'world-tree',nameZh:'世界樹'},
  {cell:4,key:'battle-banner',nameZh:'戰旗'},
  {cell:5,key:'ancestral-stag',nameZh:'祖靈鹿'},
  {cell:6,key:'underworld-gate',nameZh:'冥門'},
  {cell:7,key:'nine-headed-hydra',nameZh:'九頭蛇'},
  {cell:8,key:'smoke-double',nameZh:'煙霧影分身'},
];
const assetRoot='worker/public/art/skill-vfx-20261104/';
const assetDefinitions=[
  ...['sword','archer','mage','thief'].map(baseClass=>({key:baseClass,path:assetRoot+baseClass+'-atlas.webp',grid:[3,3],usage:'既有職業基礎特效圖集'})),
  {key:'hawk',path:assetRoot+'hawk.webp',grid:[1,1],usage:'具名獵鷹主體'},
  {key:'fire-spirit',path:assetRoot+'fire-spirit.webp',grid:[1,1],usage:'具名火精靈主體'},
  {key:'semantic',path:assetRoot+'semantic-atlas.webp',grid:[3,3],usage:'具名主題素材',cells:semanticCells},
];
const assets=assetDefinitions.map(asset=>({...asset,...fingerprint(asset.path)}));
const byAsset=new Map(assets.map(asset=>[asset.key,asset]));
function subjectName(profile){
  if(profile.asset==='semantic') return semanticCells[profile.cell].nameZh;
  if(profile.asset==='hawk') return '獵鷹';
  if(profile.asset==='fire-spirit') return '火精靈';
  return null;
}
function effectDescription(skill,profile){
  const subject=subjectName(profile),parts=[
    '「'+skill.name+'」採'+zh.element[profile.element]+'色系，以'+zh.motif[profile.motif]+'作為主題。',
    styleDescriptions[profile.style](skill,profile)+'，加入'+zh.accent[profile.accent]+'。',
    '視覺重數為'+profile.multiplicity+'；使用'+zh.routeAccent[profile.routeAccent]+'。',
  ];
  if(subject) parts.push('具體主體素材為'+subject+'。');
  if(['heal','shield','buff'].includes(skill.kind)) parts.push('僅在權威事件指定的受益者位置呈現支援效果。');
  else if(skill.kind==='summon') parts.push('依權威召喚事件顯現，後續命中仍須由獨立的真實命中事件驅動。');
  else parts.push('攻擊與命中只跟隨權威事件的實際目標和時序。');
  parts.push('畫面重複、護框與元素色不新增傷害、受益者、護盾或遊戲元素。');
  return parts.join('');
}
for(const [key,values] of Object.entries(SEMANTIC_ENUMS)){
  const dictionary=key==='style'?styleDescriptions:zh[key];
  for(const value of values) assert.ok(dictionary?.[value],'Missing Chinese semantic explanation: '+key+'/'+value);
}
const skills=catalog.skills.map(skill=>{
  const profile=semanticFor(skill);
  assert.equal(profile.label,skill.name,'Canonical skill name differs: '+skill.id);
  assert.ok(zh.family[skill.family],'Unknown original visual family: '+skill.id);
  const requiredAssets=[skill.baseClass,...(profile.asset?[profile.asset]:[])].map(key=>{
    const asset=byAsset.get(key);assert.ok(asset,'Unknown asset: '+key);
    return {key,path:asset.path,cell:key===profile.asset?profile.cell:null,exists:asset.exists,sha256:asset.sha256};
  });
  return {
    id:skill.id,name:skill.name,sourceId:skill.sourceId,system:skill.system,baseClass:skill.baseClass,
    originalFamily:skill.family,originalKind:skill.kind,originalVisualElement:skill.visualElement,
    source:skill.source,profile,
    effectDescriptionZh:effectDescription(skill,profile),
    assets:requiredAssets,
    status:'authored-profile-only',
  };
});
const evidence=args.filter(arg=>arg.startsWith('--evidence=')).map(arg=>{
  const path=arg.slice('--evidence='.length);if(!path) throw new Error('Evidence path cannot be empty');
  const item=fingerprint(path);if(!item.exists) throw new Error('Evidence file does not exist: '+path);
  return {...item,verification:'reference-recorded-only; content and success are not interpreted by this generator'};
});
const counts=field=>Object.fromEntries(SEMANTIC_ENUMS[field].map(value=>[value,skills.filter(skill=>skill.profile[field]===value).length]));
const sourceFiles=[paths.catalog,paths.semantics,paths.builder].map(fingerprint);
const missingAssets=assets.filter(asset=>!asset.exists).map(asset=>asset.path);
const report={
  schemaVersion:1,semanticSchemaVersion:SEMANTIC_SCHEMA_VERSION,
  scope:'presentation-only named-skill VFX audit',
  catalogSourceCommit:catalog.sourceCommit,
  sourceFiles,
  coverage:{
    profile:{status:'passed-data-validation',implementedIdentities:catalog.skills.length,authoredProfiles:skills.length,exactIdentityMatches:skills.length,exactCanonicalNameMatches:skills.length,distinctVisibleFieldCombinations:new Set(skills.map(skill=>skill.profile.signatureKey)).size},
    assets:{status:missingAssets.length?'incomplete':'present-and-fingerprinted',expected:assets.length,present:assets.length-missingAssets.length,missing:missingAssets},
    renderEvidence:{framePlans:'not-asserted-by-this-generator',browser:'not-asserted-by-this-generator',humanVisualReview:'not-asserted-by-this-generator',noteZh:'配方覆蓋與唯一簽章不等於畫面已驗收。本工具不執行Canvas、瀏覽器、戰鬥或測試；素材存在與SHA一致也不等於圖像品質通過。',references:evidence},
  },
  composition:{elements:counts('element'),motifs:counts('motif'),styles:counts('style'),accents:counts('accent'),routeAccents:counts('routeAccent')},
  assets,
  exclusions:{
    planned:{count:catalog.planned.length,policyZh:'16項規劃覺醒尚無已實裝伺服器技能ID；不列入196技能覆蓋，不宣稱已有實戰特效。',skills:catalog.planned.map(skill=>({id:skill.id,name:skill.name,baseClass:skill.baseClass,implemented:skill.implemented,status:skill.status,idScope:skill.idScope}))},
    supports:{count:catalog.supports.length,policyZh:'6項支援屬於既有技能的修飾器；只調整權威事件所允許的呈現，不獨立創造施放、傷害或目標。',items:catalog.supports.map(support=>({id:support.id,name:support.name,description:support.description,modifierOnly:support.modifierOnly,visualPolicy:support.visualPolicy}))},
    talents:{nodesIncludingOrigins:catalog.talents.reduce((sum,tree)=>sum+tree.nodes.length,0),allocatableNodes:catalog.talents.reduce((sum,tree)=>sum+tree.nodes.filter(node=>node.cost>0).length,0),originNodes:catalog.talents.reduce((sum,tree)=>sum+tree.nodes.filter(node=>node.kind==='origin').length,0),policyZh:'120可配置天賦與4個起點是被動修飾；不當作124個獨立可施放技能。若真實被動事件產生護盾或命中，仍須依事件證據呈現。',trees:catalog.talents.map(tree=>({baseClass:tree.baseClass,visualPolicy:tree.visualPolicy,nodes:tree.nodes.map(node=>({id:node.id,name:node.name,kind:node.kind,cost:node.cost}))}))},
  },
  policies:{
    semanticExclusivityZh:'每個已實裝身份有明確的元素、主題、動作、裝飾、視覺重數與路線構圖；signatureKey取自這些可繪製欄位，不由隨機hash或技能ID作為專屬性證據。',
    authoritativePlaybackZh:'保留原family、kind、mechanics與權威事件契約；美術元素不是戰鬥元素。敵人、受益者、傷害與施放次數均不得從美術名稱推導。',
    multiplicityZh:'視覺重數僅是同一權威效果內的裝飾或同目標投射；例如二連射的兩箭、群狼的多狼與九首的多頭，均不自動產生多次傷害。',
    supportZh:'護盾、回復、增益保留名稱主題，只對真實受益者呈現；不因追求華麗而添加敵方攻擊。',
    provenanceZh:'本報告由目前catalog、語意module與素材檔案的SHA生成；--check只比較資料與來源一致性，不能取代瀏覽器或人工畫面驗收。',
    productionZh:'本工具沒有網路、資料庫、部署或Git寫入操作。',
  },
  skills,
};
const output=workspacePath(paths.output);
if(checking){
  if(!existsSync(output)) throw new Error('Semantic audit is missing. Build it before --check.');
  const actual=JSON.parse(readFileSync(output,'utf8'));
  if(JSON.stringify(actual)!==JSON.stringify(report)){
    const sourceDrift=sourceFiles.filter(source=>JSON.stringify(source)!==JSON.stringify(actual.sourceFiles?.find(item=>item.path===source.path))).map(source=>source.path);
    const assetDrift=assets.filter(asset=>JSON.stringify(asset)!==JSON.stringify(actual.assets?.find(item=>item.key===asset.key))).map(asset=>asset.path);
    console.error(JSON.stringify({status:'failed',mode:'check',reason:'semantic audit differs from current catalog, profiles, assets or evidence arguments',sourceDrift,assetDrift,action:'Rebuild this audit with the same intended --evidence arguments.'}));
    process.exitCode=1;
  }else console.log(JSON.stringify({status:'passed-data-validation',mode:'check',identities:skills.length,assetsPresent:assets.length-missingAssets.length,assetsExpected:assets.length,missingAssets,browserPassClaimed:false,output:paths.output}));
}else{
  mkdirSync(dirname(output),{recursive:true});
  const temporary=output+'.tmp-'+process.pid;
  const content=JSON.stringify(report,null,2)+'\n';
  writeFileSync(temporary,content,'utf8');renameSync(temporary,output);
  console.log(JSON.stringify({status:'written',identities:skills.length,assetsPresent:assets.length-missingAssets.length,assetsExpected:assets.length,missingAssets,browserPassClaimed:false,output:paths.output,bytes:Buffer.byteLength(content),sha256:sha256(content)}));
}
