import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {metaView} from '../src/app.js';
import {nodeFor,computeStats} from '../src/game/stats.js';
import {branchChoices} from '../src/game/classes.js';
import {thiefPrimaryMechanics,applyThiefPrimary} from '../src/game/thief-skills.js';

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const meta=metaView();
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export function lineageContext(gender='f') {
  const ctx={S:{meta,me:{character:{gender}}},esc,window:{RpgThiefClass:{traits:()=> '極高攻速・脆皮・近戰守護'}},lineagePortrait:key=>'/exact/'+key+'.webp'};
  vm.createContext(ctx);
  for(const name of ['ELF_STAGES','MAGE_STAGES'])vm.runInContext(app.match(new RegExp(`  const ${name} = \\[.*\\];`))[0],ctx);
  vm.runInContext(app.slice(app.indexOf('  function lineageNumber('),app.indexOf('  function classView(')),ctx);
  vm.runInContext(app.slice(app.indexOf('  function branchCard('),app.indexOf('  const ELF_STAGES')),ctx);
  return ctx;
}

test('all 124 lineage descriptions use combat skills and cumulative passives, with complete ancestry and requirements',()=>{
  for(const [cls,data] of Object.entries(meta.classes)) {
    assert.equal(data.lineageNodes.length,31,cls);
    assert.equal(new Set(data.lineageNodes.map(n=>n.path)).size,31);
    for(const n of data.lineageNodes) {
      const actual=nodeFor(cls,n.path);
      assert.deepEqual(n.skill,actual.skill,cls+':'+n.path);
      assert.equal(n.passive.text,actual.passiveText);
      for(const field of ['name','blurb','basePassive','weapon'])assert.ok(n[field],cls+':'+n.path+':'+field);
      assert.equal(n.level,n.tier?n.tier*30:1);
      if(n.tier) {
        assert.equal(n.parentName,nodeFor(cls,n.path.slice(0,-1)).name);
        assert.equal(n.material,`${n.tier>=3?'trial':'mat'}_${n.tier}`);
        assert.ok(n.materialName&&n.materialSource);
        const choice=branchChoices(cls,n.tier,n.parentPath).find(b=>b.path===n.path);
        assert.deepEqual(n.skill,choice.skill);
      }
      if(n.tier>=2)assert.ok(n.inheritance);
      if(cls==='thief')assert.ok(n.effect);
    }
  }
});

test('all classes render 31 complete nodes for both genders and preserve alternative advanced paths',()=>{
  for(const gender of ['m','f'])for(const cls of Object.keys(meta.classes)) {
    const ctx=lineageContext(gender);
    const html=ctx.classPathPreview({baseClass:cls,gender,classPath:'A111',classTier:4});
    assert.equal((html.match(/class="elf-node /g)||[]).length,31);
    assert.equal((html.match(/class="lineage-skill"/g)||[]).length,31);
    assert.equal((html.match(/class="lineage-passive"/g)||[]).length,31);
    assert.equal((html.match(/aria-current="step"/g)||[]).length,1);
    for(const n of meta.classes[cls].lineageNodes) {
      assert.ok(html.includes(esc(n.name)));
      assert.ok(html.includes(esc(n.skill.name)));
      const key=n.path?`adv${n.tier}_${cls}_${n.path}_${gender}`:`${cls}_${gender}`;
      assert.ok(html.includes(`data-lineage-key="${key}"`));
    }
    for(const material of ['酋長之證','樹王之心','三人試煉之證','星穹覺醒之證'])assert.ok(html.includes(material));
    assert.doesNotMatch(html,/undefined|null|規劃中|尚未開放|4\.949999/);
    assert.match(html,/戰技書需另外取得、學習並配置/);
  }
});

test('branch comparisons show inherited passives, human-readable weapon names and explicit single-target counts',()=>{
  const ctx=lineageContext();
  for(const [cls,data] of Object.entries(meta.classes))for(const n of data.lineageNodes.filter(n=>n.tier)) {
    const choice=branchChoices(cls,n.tier,n.parentPath).find(b=>b.path===n.path);
    const html=ctx.branchCard(cls,{...choice,passive:choice.passive.text},{path:n.path});
    assert.ok(html.includes(esc(n.passive.text)));
    assert.ok(html.includes(esc(n.weapon)));
    assert.ok(html.includes(`${n.skill.targets}體`));
    assert.doesNotMatch(html,/\[object Object\]|undefined/);
  }
});

test('current lineage and every advancement gate render complete descriptions without missing values',()=>{
  for(const [cls,data] of Object.entries(meta.classes))for(const n of data.lineageNodes) {
    const ctx=lineageContext();
    const canAdvance=n.tier<4,next=data.lineageNodes.find(v=>v.tier===n.tier+1);
    ctx.portraitHtml=()=>'<img id="cpt">';ctx.bar=()=>'';
    ctx.S.me={character:{name:'驗收',gender:'f',baseClass:cls,classPath:n.path,classTier:n.tier,className:n.name,level:Math.max(20,n.tier*30)},
      stats:{...computeStats({base_class:cls,class_path:n.path,level:120}),passive:n.passive.text},inventory:{},
      gate:{canAdvance,atGate:false,have:0,materialName:next?.materialName},
      branches:branchChoices(cls,canAdvance?n.tier+1:1,canAdvance?n.path:'').map(b=>({...b,passive:b.passive.text})),
      branches2:canAdvance?[]:branchChoices(cls,2,n.path).map(b=>({...b,passive:b.passive.text}))};
    vm.runInContext(app.slice(app.indexOf('  function classView('),app.indexOf('  function bindClass(')),ctx);
    const html=ctx.classView();
    assert.doesNotMatch(html,/undefined|null|\[object Object\]/,cls+':'+n.path);
    assert.ok(html.includes(esc(n.passive.text)));
    assert.ok(html.includes(esc(n.skill.name)));
    if(canAdvance)assert.ok(html.includes(esc(next.materialSource)));
    if(n.effect)assert.ok(html.includes(esc(n.effect)));
  }
});

test('thief descriptions correspond to real primary mechanics instead of tactical-book effects',()=>{
  const target=()=>({id:'enemy',hp:1000,buffs:[]});
  const actor=path=>({id:'self',base:'thief',path,atk:100,affixPct:{}});
  const now=100000,enemy=target();
  const a1=actor('A111');applyThiefPrimary(a1,enemy,now,{damage:1});
  assert.equal(enemy.buffs[0].value,.04);assert.equal(enemy.buffs[0].until,now+90000);
  assert.equal(thiefPrimaryMechanics(a1,enemy,now).damageMultiplier,1.1);
  assert.equal(thiefPrimaryMechanics(actor('B111'),target(),now).penetrate,.1);
  const poisoned=target();for(let i=0;i<4;i++)applyThiefPrimary(actor('A211'),poisoned,now,{damage:1});
  assert.equal(poisoned.dots[0].stacks,3);assert.equal(poisoned.dots[0].left,3);assert.equal(poisoned.dots[0].next,now+30000);
  assert.equal(poisoned.dots[0].damage,36);
  const weakened=target();applyThiefPrimary(actor('B211'),weakened,now,{damage:1});
  assert.equal(weakened.buffs[0].value,.1);assert.equal(weakened.buffs[0].until,now+60000);
  const nodes=meta.classes.thief.lineageNodes;
  assert.match(nodes.find(n=>n.path==='A111').effect,/4%.*90 秒.*10%/);
  assert.match(nodes.find(n=>n.path==='A211').effect,/3 層.*30 秒.*0.12.*3 次/);
});
