import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { THIEF_NODES, THIEF_PATHS } from '../src/game/thief-data.js';

const publicRoot = new URL('../public/', import.meta.url);
const app = readFileSync(new URL('app.js', publicRoot), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(readFileSync(new URL('thief-class.js', publicRoot), 'utf8'), context);
const helper = context.window.RpgThiefClass;
const metadata = { lineageNodes: Object.entries(THIEF_NODES).map(([path,node]) => ({ ...node, path })) };

function appFunction(name, next) {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const finish = app.indexOf(next, start);
  assert.ok(finish > start, next);
  return app.slice(start, finish);
}

test('creation gate requires an explicit ready value for thief and retains legacy metadata compatibility', () => {
  const classes = { sword: {}, archer: {}, mage: {}, thief: {} };
  assert.deepEqual(Object.keys(helper.selectableClasses(classes)), ['sword','archer','mage']);
  classes.thief.releaseReady = false;
  assert.equal(helper.selectableClasses(classes).thief, undefined);
  classes.thief.releaseReady = true;
  assert.ok(helper.selectableClasses(classes).thief);
  classes.sword.releaseReady = false;
  assert.equal(helper.selectableClasses(classes).sword, undefined);
});

test('all 62 thief identities retain the exact gender and full path', () => {
  const keys = new Set();
  for (const path of THIEF_PATHS) for (const gender of ['m','f']) {
    const key = helper.heroKey('thief', gender, path);
    assert.equal(key, path ? `adv${path.length}_thief_${path}_${gender}` : `thief_${gender}`);
    assert.ok(helper.isThiefKey(key));
    keys.add(key);
  }
  assert.equal(keys.size, 62);
  assert.equal(helper.heroKey('thief','m','A1111'), null);
  assert.equal(helper.heroKey('thief','m','sword'), null);
});

test('all portrait surfaces refuse legacy, parent or guessed thief artwork when registry has no exact art', () => {
  const ctx = { window: { RpgThiefClass: helper, RpgHeroArtRegistry: { resolve: () => null } }, MODE: 'v2' };
  vm.createContext(ctx);
  vm.runInContext(appFunction('artFile', '  for(const key of Object.keys(ELF_ADV4_HD))'), ctx);
  for (const path of THIEF_PATHS) for (const gender of ['m','f']) {
    const key=helper.heroKey('thief',gender,path);
    for (const kind of ['hero','sprite','portrait','heroAnim']) assert.equal(ctx.artFile(kind,key),null,`${kind}:${key}`);
  }
  ctx.window.RpgHeroArtRegistry.resolve = (key,kind) => `/exact/${kind}/${key}.webp`;
  assert.equal(ctx.artFile('hero','adv4_thief_B222_f'),'/exact/hero/adv4_thief_B222_f.webp');
});

test('lineage renders the authoritative 31 names, both genders and missing-art placeholders without null URLs', () => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, '');
  for (const gender of ['m','f']) {
    const requested=[];
    const ctx={ window:{RpgThiefClass:helper}, S:{meta:{classes:{thief:metadata}}}, esc:escape,
      lineagePortrait:key=>{requested.push(key);return null;} };
    vm.createContext(ctx);
    vm.runInContext(appFunction('thiefPathPreview','  function classView()'),ctx);
    const result=ctx.thiefPathPreview({gender,classPath:'',classTier:0});
    assert.equal((result.match(/class="elf-node /g)||[]).length,31);
    for (const node of Object.values(THIEF_NODES)) assert.ok(result.includes(node.name),node.name);
    assert.equal(requested.length,31);
    assert.ok(requested.every(key=>key.endsWith('_'+gender)));
    assert.doesNotMatch(result,/src="(?:null|undefined)|sword_|mage_|archer_/);
    assert.equal((result.match(/盜賊外觀製作中/g)||[]).length,31);
  }
});

test('skill widget isolates thief books by explicit eligibleBase instead of reusing sword books',()=>{
  const source=readFileSync(new URL('special-skill-widgets.js',publicRoot),'utf8');
  const start=source.indexOf(' function grid(d)'),finish=source.indexOf(' function hydrate(',start);
  const ctx={escape:String,icon:id=>'/fixture/'+id};vm.createContext(ctx);vm.runInContext(source.slice(start,finish),ctx);
  const result=ctx.grid({character:{baseClass:'thief'},special:{learned:[]},skills:[
    {id:'thief_book',name:'盜賊技能',bookType:'影技祕卷',eligibleBase:'thief',level:30,mp:10},
    {id:'sword_book',name:'劍士技能',bookType:'技術書',level:30,mp:10}
  ]});
  assert.match(result,/thief_book/);assert.doesNotMatch(result,/sword_book/);
});

test('guardian explanations consistently classify all thief paths as melee',()=>{
  const auto=readFileSync(new URL('guardian-auto-ui.js',publicRoot),'utf8');
  const assist=readFileSync(new URL('guardian-assist-widget.js',publicRoot),'utf8');
  assert.match(auto,/近攻（劍士／盜賊）/);
  assert.match(assist,/盜賊所有路線套用近戰守護；飛刃與幻刃同樣適用/);
  assert.match(app,/c.baseClass==='thief'\?' · 近戰・極速・脆皮'/);
});

test('actual create screen removes a stale thief selection and adapts to four approved classes',()=>{
  const classes=Object.fromEntries(['sword','archer','mage','thief'].map(key=>[key,{key,name:key,releaseReady:key==='thief'?false:true}]));
  const state={create:{step:2,cls:'thief',gender:'f',name:'fixture'},characters:[],meta:{classes}};
  const ctx={window:{RpgThiefClass:helper},S:state,esc:String};vm.createContext(ctx);
  vm.runInContext(appFunction('createView','  function bindCreate('),ctx);
  const closed=ctx.createView();assert.equal(state.create.step,1);assert.equal(state.create.cls,null);
  assert.equal((closed.match(/data-cls=/g)||[]).length,3);assert.doesNotMatch(closed,/data-cls="thief"/);
  classes.thief.releaseReady=true;
  const opened=ctx.createView();assert.equal((opened.match(/data-cls=/g)||[]).length,4);assert.match(opened,/pick3 pick4/);
});

test('thief traits explain very high speed and fragility without inventing a multiplier',()=>{
  const base=helper.traits({});
  assert.match(base,/極高攻速/);assert.match(base,/脆皮/);assert.match(base,/生命與防禦較低/);assert.doesNotMatch(base,/×|1\.8/);
  const supplied=helper.traits({attackSpeedMultiplier:1.8});assert.match(supplied,/攻擊頻率 ×1\.8/);
  for(const speed of [undefined,null,NaN,Infinity,'1.8',0,-1])assert.doesNotMatch(helper.traits({attackSpeedMultiplier:speed}),/×/);
});

test('unready thief branch cards show a placeholder instead of requesting /null',()=>{
  const ctx={S:{me:{character:{gender:'f'}}},esc:String,lineagePortrait:()=>null};vm.createContext(ctx);
  vm.runInContext(appFunction('branchCard','  const ELF_STAGES'),ctx);
  const html=ctx.branchCard('thief',{branch:'A',name:'刺客',skill:{name:'交錯刃擊',cost:8,mult:2.1},passive:'fixture'});
  assert.doesNotMatch(html,/<img|src="null"|src="undefined"/);assert.match(html,/刺客外觀製作中/);
});

test('PK native strike display accepts only contiguous authoritative thief hits',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(appFunction('pkNativeStrikes','  function pkReplay('),ctx);
 const strikes=[{damage:10,beforeHp:100,afterHp:90},{damage:15,beforeHp:90,afterHp:75}];
 assert.equal(ctx.pkNativeStrikes({strikes,directDamage:25},{baseClass:'thief'}).length,2);
 for(const baseClass of ['sword','mage','archer'])assert.equal(ctx.pkNativeStrikes({strikes},{baseClass}).length,0);
 assert.equal(ctx.pkNativeStrikes({strikes,directDamage:50},{baseClass:'thief'}).length,0);
 assert.equal(ctx.pkNativeStrikes({strikes:[strikes[0],{...strikes[1],beforeHp:80}]},{baseClass:'thief'}).length,0);
});
