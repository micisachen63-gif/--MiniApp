import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {semanticFor,SEMANTIC_PROFILES,SEMANTIC_ENUMS} from '../public/skill-vfx-semantics.mjs';

const catalog=JSON.parse(readFileSync(new URL('../public/skill-vfx-catalog.json',import.meta.url),'utf8'));

test('every implemented skill has an authored, canonically named visual profile',()=>{
  assert.equal(catalog.skills.length,196);
  assert.equal(SEMANTIC_PROFILES.length,catalog.skills.length);
  assert.deepEqual(SEMANTIC_PROFILES.map(p=>p.id).sort(),catalog.skills.map(s=>s.id).sort());
  for(const skill of catalog.skills){
    const before=JSON.stringify(skill),profile=semanticFor(skill);
    assert.equal(profile.label,skill.name,skill.id);
    assert.equal(JSON.stringify(skill),before,'art direction must not rewrite gameplay: '+skill.id);
    assert.ok(Object.isFrozen(profile),skill.id);
  }
  assert.equal(new Set(SEMANTIC_PROFILES.map(p=>p.signatureKey)).size,196,'distinct direction must use visible fields, not an ID-only claim');
});

test('wolves, hawks, star spirits, abyssal summons and forest ancestors keep the named subject',()=>{
  const wolves=semanticFor('special:skill_13_1');
  assert.equal(wolves.asset,'semantic');assert.equal(wolves.cell,0);assert.equal(wolves.style,'pack');
  assert.ok(wolves.multiplicity>1,'群狼 needs a visible pack on the same authoritative recipient');
  assert.equal(semanticFor('atlas:archer_beast').asset,'hawk');
  assert.equal(semanticFor('special:skill_18_1').asset,'fire-spirit');
  assert.equal(semanticFor('native:mage:B2').asset,'fire-spirit');
  for(const id of ['native:mage:B21','native:mage:B211','native:mage:B212']){
    assert.equal(semanticFor(id).asset,'semantic');assert.equal(semanticFor(id).cell,1,id);
  }
  for(const id of ['native:mage:B22','native:mage:B221']){
    assert.equal(semanticFor(id).asset,'semantic');assert.equal(semanticFor(id).cell,2,id);
  }
  assert.equal(semanticFor('native:archer:B121').cell,3,'world-tree route needs the tree');
  assert.equal(semanticFor('native:archer:B122').cell,5,'ancestral route needs its spirit');
  assert.equal(semanticFor('native:thief:A211').cell,7,'nine-headed venom needs its hydra subject');
});

test('named double shots, orbiting knives and blade rain request different movement',()=>{
  const double=semanticFor('native:archer:base');
  assert.equal(double.style,'double-shot');assert.equal(double.multiplicity,2);
  const rapid=semanticFor('native:archer:A2');assert.equal(rapid.style,'storm');assert.ok(rapid.multiplicity>1);
  for(const id of ['native:thief:B','native:thief:B1','native:thief:B11','native:thief:B111']) assert.equal(semanticFor(id).style,'orbit',id);
  assert.equal(semanticFor('native:thief:B121').style,'blade-rain');
  assert.equal(semanticFor('native:thief:B122').style,'comet');
  assert.equal(semanticFor('native:thief:B222').motif,'moon');
});

test('defensive skills retain ice, banner, smoke, decoy and mirror identities',()=>{
  const frost=semanticFor('special:skill_16_2');
  assert.equal(frost.element,'ice');assert.equal(frost.motif,'shield');
  const banner=semanticFor('special:skill_19_2');
  assert.equal(banner.style,'banner');assert.equal(banner.cell,4);
  assert.equal(semanticFor('special:skill_thief_02').style,'smoke');
  assert.equal(semanticFor('special:skill_18_2').cell,8);
  assert.equal(semanticFor('special:skill_thief_06').style,'mirror');
  assert.equal(semanticFor('special:skill_21_2').style,'clock');
});

test('void, time, gates, lunar explosions and ground impacts have their named shape',()=>{
  assert.equal(semanticFor('native:mage:B1').style,'clock');
  for(const id of ['native:mage:B12','native:mage:B121','native:mage:B122']) assert.equal(semanticFor(id).style,'void',id);
  const gate=semanticFor('native:mage:B222');assert.equal(gate.asset,'semantic');assert.equal(gate.cell,6);
  const lunar=semanticFor('special:skill_14_1');assert.equal(lunar.element,'lunar');assert.equal(lunar.motif,'moon');
  const quake=semanticFor('special:skill_10_2');assert.equal(quake.style,'groundwave');assert.equal(quake.motif,'crack');
});

test('blood themes and paired fourth-tier sword branches do not collapse to the same presentation',()=>{
  for(const skill of catalog.skills.filter(s=>s.name.includes('血之狂怒'))){
    const profile=semanticFor(skill);assert.equal(profile.element,'blood');
    if(skill.name.endsWith('精進')) assert.equal(profile.routeAccent,'assault');
    if(skill.name.endsWith('守望')) assert.equal(profile.routeAccent,'ward');
  }
  for(const path of ['A11','A12','A21','A22','B11','B12','B21','B22']){
    const attack=semanticFor('native:sword:'+path+'1'),guard=semanticFor('native:sword:'+path+'2');
    assert.equal(attack.routeAccent,'assault');assert.equal(guard.routeAccent,'ward');
    assert.notEqual(attack.signatureKey,guard.signatureKey);
  }
  for(const id of ['special:skill_01_2','special:skill_07_1','special:skill_07_2']) assert.equal(semanticFor(id).element,'blood');
});

test('the renderer contract uses bounded, exercised tokens and rejects uncatalogued identities',()=>{
  for(const [field,allowed] of Object.entries(SEMANTIC_ENUMS)){
    const used=new Set(SEMANTIC_PROFILES.map(p=>p[field]));
    for(const value of used) assert.ok(allowed.includes(value),field+': '+value);
    assert.deepEqual([...used].sort(),[...allowed].sort(),'unused or unhandled '+field+' contract token');
  }
  const profile=semanticFor({id:'native:mage:base'});
  assert.equal(profile.label,'火球術');
  assert.throws(()=>semanticFor({id:'planned:mage:hell'}),/Missing authored/);
  assert.throws(()=>semanticFor({id:'unknown'}),/Missing authored/);
});
