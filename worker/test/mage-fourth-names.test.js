import {specializationFor} from '../src/game/advanced-specializations.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {MAGE_FOURTH} from '../src/game/mage-fourth.js';import {BRANCHES2,MAX_OPEN_CLASS_TIER} from '../src/game/constants.js';import {nodeFor} from '../src/game/stats.js';import {branchChoices} from '../src/game/classes.js';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),catalog=JSON.parse(app.match(/const MAGE_STAGES = (\[.*\]);/)[1]).find(s=>s.tier===4);
test('all sixteen mage fourth paths have matching catalog, combat and advancement names with authoritative specialization numbers',()=>{
 assert.equal(Object.keys(MAGE_FOURTH).length,16);assert.equal(new Set(Object.values(MAGE_FOURTH).map(n=>n.skillName)).size,16);
 for(const [path,names] of Object.entries(MAGE_FOURTH)){
 const node=nodeFor('mage',path),base=BRANCHES2.mage[path[0]][path[1]],entry=catalog.entries.find(e=>e.path===path),choice=branchChoices('mage',4,path.slice(0,3)).find(e=>e.path===path);
 assert.equal(node.name,names.name);assert.equal(node.skill.name,names.skillName);assert.equal(choice.name,names.name);assert.equal(choice.skill.name,names.skillName);assert(node.passiveText.startsWith(names.passiveName+'：'));assert(choice.passive.text.startsWith(names.passiveName+'：'));
 assert.deepEqual(choice.skill,node.skill);assert.ok(node.specialization);assert.notDeepEqual(node.skill,base.skill);
 assert.equal(entry.skill.cost,path.endsWith('1')?44:48);assert.equal(entry.skill.mult,path.endsWith('1')?4.85:5.15);assert.equal(entry.skill.targets,path.startsWith('A')?5:path.startsWith('B1')?2:4);
 assert.equal(entry.skill.name,names.skillName);assert(entry.passive.text.startsWith(names.passiveName+'：'));
 if(path.endsWith('1'))assert.equal(entry.passive.atkPct,.1);else assert.equal(entry.passive.takenPct,-.1);
 assert.notDeepEqual(node.passive,nodeFor('mage',path.slice(0,2)).passive);
 }
 assert.equal(catalog.preview,true);assert.equal(catalog.title,'四轉・神域覺醒（尚未開放）');assert.equal(MAX_OPEN_CLASS_TIER,4);
});
test('first and second stages retain identities while advanced routes expose their specialization',()=>{assert.equal(nodeFor('mage','A1').skill.name,'隕石術');assert.equal(nodeFor('mage','B1').skill.name,'時間扭曲');for(const cls of ['sword','archer','mage'])assert.ok(nodeFor(cls,'A111').passiveText.includes(specializationFor(cls,'A111').role));});
test('renamed skills retain their existing meteor, blizzard, time and summon FX profiles',()=>{const context={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../public/skill-fx.js',import.meta.url),'utf8'),context);for(const [path,names] of Object.entries(MAGE_FOURTH)){assert.equal(context.window.RpgSkillFX.profile(names.skillName,'mage',path).kind,{'A1':'meteor','A2':'blizzard','B1':'time','B2':'summon'}[path.slice(0,2)])}});
