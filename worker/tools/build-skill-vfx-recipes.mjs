import {readFile,writeFile} from 'node:fs/promises';
import {recipeFor,validateCatalog,VFX_VERSION} from '../public/skill-vfx-engine.mjs';

const catalog=JSON.parse(await readFile(new URL('../public/skill-vfx-catalog.json',import.meta.url),'utf8'));
const check=validateCatalog(catalog);
const result={schemaVersion:VFX_VERSION,sourceCommit:catalog.sourceCommit,scope:'presentation-only',
 summary:{skillIdentities:catalog.skills.length,visualFamilies:check.families.length,classAtlases:4,atlasCells:36,summonAssets:2,semanticProfiles:catalog.skills.length,semanticAtlases:1,semanticAtlasCells:9,directions:['up','down','left','right']},
 policies:{gender:'Same skill identity shares VFX; character size is provided by the caller.',
  combat:'No damage, targets, resource changes or cooldowns are calculated by the renderer.',
  identity:'Skill identities and route names are not counts of independently painted assets.',
  planned:'The 16 planned awakening skills are excluded; no implemented server IDs exist.',
  support:'Passive talents and support modifiers do not independently cast.',
  live:'Only explicit authoritative cast/effect descriptors may drive playback. Per-identity and per-mode evidence is tracked in skill-vfx-coverage.json; summaries never create casts.'},
 skills:catalog.skills.map(skill=>({id:skill.id,sourceId:skill.sourceId,name:skill.name,system:skill.system,baseClass:skill.baseClass,kind:skill.kind,source:skill.source,recipe:recipeFor(skill)}))};
const target=new URL('../public/skill-vfx-recipes.json',import.meta.url);
if(process.argv.includes('--check')){
 const actual=JSON.parse(await readFile(target,'utf8'));
 if(JSON.stringify(actual)!==JSON.stringify(result))throw new Error('VFX recipes differ from the current catalog or renderer. Rebuild recipes.');
}else await writeFile(target,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({ok:true,mode:process.argv.includes('--check')?'check':'build',...result.summary}));
