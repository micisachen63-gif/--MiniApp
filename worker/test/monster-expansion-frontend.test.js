import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {idleBattleHarness,idleMe,idleReport} from './idle-battle-harness.js';
import {idleCombatState,resolveIdleCombat} from '../src/game/idle-combat.js';
import {mkChar,T0} from './helpers.js';
const read=f=>fs.readFileSync(new URL('../public/'+f,import.meta.url),'utf8'),app=read('app.js'),battle=read('battle.js');
const spec=(key,name,role='normal',ready=true)=>({map:4,key,name,role,ready,folder:'monster-expansion-20261013',cols:4,rows:4,idle:[0,1,2,3],move:[4,5,6,7],attack:[8,9,10,11],cast:[12,13],hurt:[14],death:[15],spell:'water'});
function expansion(catalog=[]){const values=new Map(),context=vm.createContext({window:{RpgMonsterExpansionCatalog:catalog},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}});vm.runInContext(read('monster-expansion.js'),context);return {api:context.window.RpgMonsterExpansion,values,context};}
const json=x=>JSON.parse(JSON.stringify(x));
test('authored actions sample all sixteen distinct cells and a cast actually lunges left on the canvas',()=>{
 const meta=spec('new','新怪'),{api}=expansion([meta]),calls=[],g={save(){},restore(){},beginPath(){},ellipse(){},fill(){},translate(...p){calls.push({translate:p});},scale(){},drawImage(...p){calls.push({image:p});}};
 const c=vm.createContext({expansion:api});vm.runInContext(app.slice(app.indexOf('  function drawSprite('),app.indexOf('  const heroAnimSprite'))+';this.draw=drawSprite;',c);
 const image={complete:true,naturalWidth:1920,naturalHeight:1920},sheet=api.canvasSpec(image,meta),cells=new Set();
 for(const [action,frames]of Object.entries({idle:[0,1,2,3],move:[4,5,6,7],attack:[8,9,10,11],cast:[12,13],hurt:[14],death:[15]}))for(let i=0;i<frames.length;i++){
  calls.length=0;const p=(i+.1)/frames.length,t=(i+.1)/4;c.draw(g,{width:480,height:480},300,250,180,{action,p,t,sheet,attackDirection:-1});
  const args=calls.find(x=>x.image).image,frame=frames[i];assert.equal(args[1],frame%4*480);assert.equal(args[2],Math.floor(frame/4)*480);assert.equal(args[3],480);assert.equal(args[4],480);cells.add(`${args[1]}:${args[2]}`);
  if(action==='cast'||action==='attack')assert.ok(calls.find(x=>x.translate).translate[0]<300);
 }
 assert.equal(cells.size,16);assert.equal(api.frame(meta,'cast',1),13);assert.equal(api.frame(meta,'death',1),15);assert.equal(api.spec('art/x/new_attack.webp?v=1'),meta);
});
test('pending sprites cannot route while the alternate ready boss uses its own atlas instead of the primary map boss',()=>{
 const ready=spec('boss_x13_m04_boss_secondary','深淵潮汐女王','boss'),pending=spec('mon_x13_pending','尚未完工','normal',false),{api}=expansion([ready,pending]);
 const c=vm.createContext({window:{RpgMonsterCatalog:[],RpgMonsterExpansion:api}}),globals='const MODE="v2",V2=true,SWORD_ADV2_HD={},SWORD_ADV3_HD={},SWORD_ADV4_HD={},MAGE_ADV2_HD={},ELF_ADV2_HD={},ELF_ADV3_HD={},ELF_ADV4_HD={},SINGLE_ELF4=/^never$/;';
 vm.runInContext(globals+app.slice(app.indexOf('  const MON ='),app.indexOf('  // Attack sheets'))+app.slice(app.indexOf('  function artFile('),app.indexOf('  const IMG ='))+';this.route=artFile;',c);
 assert.equal(api.spec(pending.key),null);assert.equal(c.route('monster',pending.name),null);assert.match(c.route('boss',ready.key),new RegExp(ready.key+'\\.webp'));assert.match(c.route('bossAnim',ready.key),new RegExp(ready.key+'_attack\\.webp'));assert.match(c.route('boss',4),/boss_aegean_leviathan/);
});
test('unlocked magic colors are isolated by character and cannot enable locked collections',()=>{
 const {api}=expansion(),a={character:{tgId:'a'},collection:{unlocked:[{mapId:4}]}},b={character:{tgId:'b'},collection:{unlocked:[{mapId:1}]}};
 assert.equal(api.chooseTheme(a,4),true);const color=api.themeColor(a);assert.ok(color);assert.equal(api.selectedTheme(b),0);assert.equal(api.chooseTheme(b,4),false);assert.equal(api.chooseTheme(b,1),true);assert.equal(api.selectedTheme(a),4);assert.equal(api.themeColor(a),color);assert.notEqual(api.themeColor(b),color);assert.equal(api.chooseTheme(a,0),true);assert.equal(api.themeColor(a),null);assert.equal(api.selectedTheme(b),1);
});
test('cinematic water/fire/sun/lightning casts project from monster to hero left without drawing damage text',()=>{
 const translations=[],scales=[],endpoints=[],g={save(){},restore(){},translate(...x){translations.push(x);},scale(...x){scales.push(x);}};
 const c=vm.createContext({window:{RpgSkillFX:{draw:(g,k,a,b,p)=>endpoints.push({a,b,p})}},Image:class{complete=false;naturalWidth=0;}});vm.runInContext(read('cinematic-fx.js'),c);
 for(const kind of ['water','fire','sun','lightning']){const p=c.window.RpgSkillFX.monsterProfile(kind);assert.notEqual(p.kind,'slash');c.window.RpgSkillFX.drawMonster(g,.5,{x:320,y:100},{x:100,y:110},p);const last=endpoints.at(-1);assert.equal(last.a.x,0);assert.equal(last.b.x,220);assert.equal(320-last.b.x,100);assert.deepEqual(scales.at(-1),[-1,1]);assert.deepEqual(translations.at(-1),[320,100]);}
});
test('independent monster atlas callbacks survive switching focus and do not overwrite another enemy sheet',()=>{
 const {api}=expansion(),raf=[],cls=()=>{const set=new Set(['sheet-ready']);return {contains:k=>set.has(k),add:k=>set.add(k),remove:k=>set.delete(k)}};
 const enemy=(key,meta)=>({refs:{mon:{classList:cls()},mSheet:{style:{}},mAct:{},mImg:{},mName:{},mHp:{}},mon:{id:key,sheet:key},monAtlas:meta,monFrameRun:0}),a=enemy('a',spec('a','甲')),b=enemy('b',spec('b','乙'));b.monAtlas.cast=[10,11];
 const S={group:[a,b],selected:0,rm:false,mon:a.mon,monAtlas:a.monAtlas,monFrameRun:0},E={...a.refs},c=vm.createContext({S,E,window:{RpgMonsterExpansion:api},requestAnimationFrame:f=>raf.push(f),paused:()=>false});
 const keys=battle.slice(battle.indexOf("    const monKeys="),battle.indexOf('    function clearGroup'));const animation=battle.slice(battle.indexOf('    function animateMonsterSheet('),battle.indexOf('    // ---------- one hero attack'));
 vm.runInContext(keys+animation+';this.animate=animateMonsterSheet;this.focus=focusEnemy;',c);c.animate('cast');c.focus(1);c.animate('cast');
 const callbacks=raf.splice(0);callbacks.forEach(f=>f(0));assert.equal(a.refs.mSheet.style.backgroundPosition,'0% 100%');assert.equal(b.refs.mSheet.style.backgroundPosition,api.position(b.monAtlas,10));
 const advance=raf.splice(0);advance.forEach(f=>f(400));assert.equal(a.refs.mSheet.style.backgroundPosition,api.position(a.monAtlas,13));assert.equal(b.refs.mSheet.style.backgroundPosition,api.position(b.monAtlas,11));assert.equal(S.selected,1);assert.equal(S.mon.id,'b');
 const finish=raf.splice(0);finish.forEach(f=>f(700));assert.equal(S.selected,1);assert.equal(S.mon.id,'b');assert.notEqual(a.monFrameRun,0);assert.notEqual(b.monFrameRun,0);
});
test('switching to reduced motion stops an already-running authored idle frame callback',()=>{
 const {api}=expansion(),raf=[],classes=new Set(['sheet-ready']),mon={classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)}},sheet={style:{}},owner={refs:{mon,mSheet:sheet},mon:{id:'a',sheet:'a'},monAtlas:spec('a','甲'),monFrameRun:0},S={group:[owner],selected:0,rm:false,mon:owner.mon,monAtlas:owner.monAtlas,monFrameRun:0},E={mon,mSheet:sheet};
 const c=vm.createContext({S,E,window:{RpgMonsterExpansion:api},requestAnimationFrame:f=>raf.push(f),paused:()=>false});vm.runInContext(battle.slice(battle.indexOf('    function animateMonsterSheet('),battle.indexOf('    // ---------- one hero attack'))+';this.animate=animateMonsterSheet;',c);c.animate('idle');raf.splice(0).forEach(f=>f(0));S.rm=true;raf.splice(0).forEach(f=>f(250));assert.equal(raf.length,0);
});
test('reduced-motion CSS pins a ready4x4 sheet to its living idle cell while retaining the legacy5x2 idle cell',()=>{
 const css=read('battle.css'),legacy=css.match(/\.bstage\.rm \.mon\.sheet-ready \.sheet\{([^}]+)\}/),authored=css.match(/\.bstage\.rm \.mon\[data-expansion="true"\]\.sheet-ready \.sheet\{([^}]+)\}/);assert.ok(legacy);assert.ok(authored);
 const position=rule=>rule[1].match(/background-position:([^;]+)!important/)[1].trim(),{api}=expansion(),meta=spec('rm','靜態怪');assert.equal(position(authored),api.position(meta,meta.idle[0]));assert.notEqual(position(authored),api.position(meta,meta.death[0]));assert.equal(position(legacy),'100% 100%');assert.ok(css.indexOf(authored[0])>css.indexOf(legacy[0]));
});
test('authored body fit uses actual deployed hero offset size without breathing-transform growth',()=>{
 const style=()=>({setProperty(k,v){this[k]=v;}}),hero={dataset:{},offsetLeft:20},heroImage={naturalHeight:480,naturalWidth:480,offsetHeight:200,offsetWidth:100},monsterImage={naturalHeight:480,naturalWidth:960,style:style()},mon={dataset:{},style:style(),classList:{contains:()=>false}},E={hero,hImg:heroImage,mImg:monsterImage,mon,mName:{style:{}},mBar:{style:{}},mHp:{parentElement:{style:{}}},mSheet:{style:{}}},S={mon:{elite:false},monAtlas:spec('wide','寬怪'),cls:'sword',monSheetBody:.8,monSheetRatio:2,monSheetFeet:.95},root={clientWidth:390};
 const c=vm.createContext({E,S,root,visibleBounds:im=>im===heroImage?[.1,.05,.9,.85]:[.1,.2,.9,.8],getComputedStyle:()=>({bottom:'64px'})});vm.runInContext(battle.slice(battle.indexOf('    function fitMonster()'),battle.indexOf('    function fitGroup()'))+';this.fit=fitMonster;',c);
 c.fit();assert.ok(Math.abs(Number(mon.dataset.figureHeight)-Number(hero.dataset.figureHeight)*1.12)<1e-8);const first=json({hero:hero.dataset,monster:mon.dataset,style:mon.style});c.fit();assert.deepEqual(json({hero:hero.dataset,monster:mon.dataset,style:mon.style}),first);assert.equal(heroImage.offsetHeight,200);assert.ok(Number.parseFloat(mon.style.width)>Number.parseFloat(mon.style.height));
});
function idleHeroBodyFit(meta,cellPixelHeight){
 const style=()=>({setProperty(k,v){this[k]=v;}}),hero={dataset:{},offsetLeft:20},heroImage={naturalHeight:meta.portraitCrop?.height||512,naturalWidth:512,offsetHeight:158,offsetWidth:100},monsterImage={naturalHeight:480,naturalWidth:480,style:style()},mon={dataset:{},style:style(),classList:{contains:()=>false}},E={hero,hImg:heroImage,mImg:monsterImage,mon,mName:{style:{}},mBar:{style:{}},mHp:{parentElement:{style:{}}},mSheet:{style:{}}},S={mon:{elite:false},monAtlas:spec('normal','普通怪'),cls:'archer',fig:meta.fig,heroSheet:{...meta,ready:true,cellPixelHeight},monSheetBody:.75,monSheetRatio:1,monSheetFeet:.9375},root={clientWidth:390};let heroAlphaReads=0;
 // Deliberately return the entire hero canvas (staff/FX included), so a wrong alpha
 // measurement instead of the authored body box produces an observable failure.
 const c=vm.createContext({E,S,root,visibleBounds:im=>{if(im===heroImage){heroAlphaReads++;return [0,0,1,1];}return [.1,.1875,.9,.9375];},getComputedStyle:()=>({bottom:'64px'})});vm.runInContext(battle.slice(battle.indexOf('    function fitMonster()'),battle.indexOf('    function fitGroup()'))+';this.fit=fitMonster;',c);
 return {fit:()=>c.fit(),E,S,get heroAlphaReads(){return heroAlphaReads}};
}
const heroTable=name=>JSON.parse(app.match(new RegExp('const '+name+'=(\\{[^\\n]+\\});'))[1]);
test('actual ELF2 idle metadata produces185.15625px body and207.375px normal monster, ignoring authored spell alpha',()=>{
 const meta=heroTable('ELF_ADV2_HD').adv2_archer_A1_f,h=idleHeroBodyFit(meta,512);h.fit();assert.equal(Number(h.E.hero.dataset.figureHeight),185.15625);assert.ok(Math.abs(Number(h.E.mon.dataset.figureHeight)-207.375)<1e-8);assert.equal(h.heroAlphaReads,0);
 const once=h.E.mon.style.height;for(let i=0;i<5;i++)h.fit();assert.equal(h.E.mon.style.height,once);assert.equal(h.E.hImg.offsetHeight,158);
});
test('actual ELF3 portrait crop cancels1792 atlas scale so body stays131.66667px and monster147.46667px',()=>{
 const meta=heroTable('ELF_ADV3_HD').adv3_archer_A11_f,h=idleHeroBodyFit(meta,1792);assert.equal(meta.portraitCrop.height,1152);h.fit();assert.ok(Math.abs(Number(h.E.hero.dataset.figureHeight)-158*5/6)<1e-8);assert.ok(Math.abs(Number(h.E.mon.dataset.figureHeight)-158*5/6*1.12)<1e-8);assert.equal(h.heroAlphaReads,0);
 const once=h.E.mon.style.height;for(let i=0;i<5;i++)h.fit();assert.equal(h.E.mon.style.height,once);assert.equal(h.E.hImg.offsetHeight,158);
});
test('committed cosmetic casts do not mutate HP/MP or issue combat API calls and duplicate loot is not credited twice',async()=>{
 const c=mkChar(),feed=idleCombatState(c),round=resolveIdleCombat(feed,c,{at:T0+60000,killsBudget:1.3}),h=idleBattleHarness(),me=idleMe();me.battle.idleCombat=feed;
 const report=idleReport({from_at:T0,to_at:T0+60000,combat:round,kills:round.kills,elites:0,drops:{hunt_1_1:2},used:{},gold_gained:17,exp_gained:19});const before=json(me.character);
 h.battle.sync(me,report);await h.advance(16000);assert.equal(h.root.dataset.completedRound,round.id);assert.deepEqual(json(me.character),before);assert.deepEqual(json(h.battle.state.group.map(e=>[e.mon.id,e.mon.hp])),feed.enemies.map(e=>[e.id,e.hp]));const summary=h.root.dataset.lastReport,epoch=h.battle.state.visualEpoch;
 h.battle.sync(me,report);await h.advance(3000);assert.equal(h.root.dataset.lastReport,summary);assert.equal(h.battle.state.visualEpoch,epoch);assert.deepEqual(JSON.parse(summary).drops,{hunt_1_1:2});assert.deepEqual(h.requests,['monster-layout.json']);assert.deepEqual(h.errors,[]);
});
function collectionUiHarness(){
 const option={source:'hunt_12_core',target:'hunt_1_core',have:12,qty:3,gain:1},recipe={id:'collection-1',name:'收藏',gold:100,ingredients:[{item:'hunt_1_core',qty:1,have:0}]},S={me:{character:{tgId:'a'},collection:{recipes:[recipe],refineOptions:[option]}}},refine={dataset:{monsterRefine:'0'}},exchange={dataset:{monsterExchange:recipe.id}},confirm={},input={value:'1'},calls=[];let approve;
 // This fixture mounts collection controls only; the optional wardrobe and full-body art are absent.
 const view={querySelector:s=>['[data-cosmetic-open]','.hero-armory .fig'].includes(s)?null:{insertAdjacentHTML(){}},querySelectorAll:s=>s==='[data-monster-refine]'?[refine]:s==='[data-monster-exchange]'?[exchange]:[]},card={querySelector:s=>s==='#refine-count'?input:confirm};
 const ctx=vm.createContext({window:{RpgMonsterCatalog:[]},S,openCosmeticWardrobe:()=>{throw Error('Wardrobe must not open from a collection-only fixture');},monsterCollectionView:()=>'',sheet:()=>card,$:()=>null,esc:String,itemName:String,fmt:String,act:async(...x)=>{calls.push(x);return {};},toast(){},closeSheet(){},confirmSheet:()=>new Promise(r=>approve=r)});
 vm.runInContext(app.slice(app.indexOf('  function bindBag('),app.indexOf('  /** empty slot'))+';this.bind=bindBag;',ctx);ctx.bind(view);return {S,refine,exchange,confirm,calls,approve:()=>approve(true)};
}
test('refine confirmation opened by character A must never consume character B materials after switching',async()=>{
 const h=collectionUiHarness();await h.refine.onclick();h.S.me.character.tgId='b';await h.confirm.onclick();assert.equal(h.calls.length,0);
});
test('collection confirmation opened by character A must cancel when the active character changes while awaiting approval',async()=>{
 const h=collectionUiHarness(),waiting=h.exchange.onclick();h.S.me.character.tgId='b';h.approve();await waiting;assert.equal(h.calls.length,0);
});
