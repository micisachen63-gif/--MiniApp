// Pure release gate shared by catalogue, item registration and dungeon acquisition.
// Importing this module alone never publishes a thief skill or mutates legacy pools.
import {THIEF_RELEASE_READY} from './thief-data.js';
import {THIEF_SKILLS} from './thief-skills.js';
export function withThiefSkills(legacy,{releaseReady=THIEF_RELEASE_READY}={}){
 return releaseReady?[...legacy.filter(skill=>skill.eligibleBase!=='thief'),...THIEF_SKILLS]:legacy;
}
export function skillBookItems(skills){
 return Object.fromEntries(skills.map(s=>['book_'+s.id,{name:s.bookType+' · '+s.name,emoji:s.bookType==='精靈水晶'?'💎':'📖',kind:'skill_book',desc:s.eligibleJob+' Lv.'+s.level+'｜'+s.damage+'｜'+s.effect,skillId:s.id}]));
}
export function dungeonSkillPool(skills,skillLevels,character,{releaseReady=THIEF_RELEASE_READY}={}){
 const legacy=skills.filter(s=>s.eligibleBase!=='thief'&&skillLevels.includes(s.level));
 if(!releaseReady||character.base_class!=='thief')return legacy;
 const route=String(character.class_path||'');
 const legal=THIEF_SKILLS.filter(s=>character.level>=s.level&&route.length>=s.advancementTier&&s.eligiblePaths.some(prefix=>route.startsWith(prefix)));
 const exact=legal.filter(s=>skillLevels.includes(s.level));
 // Later treasure dungeons retain useful legal thief books without diluting existing jobs' drops.
 return exact.length?exact:legal.filter(s=>s.level<=Math.max(0,...skillLevels));
}
