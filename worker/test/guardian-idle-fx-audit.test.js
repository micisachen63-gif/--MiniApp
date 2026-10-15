import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {guardianEffect,guardianStatsView} from '../src/game/guardian-effects.js';

const read=name=>fs.readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const types=['melee','ranged','magic','loot'],qualities=['white','green','blue','purple','red','gold','pink','cyan'];
class Element {
  constructor(tag='div') {
    this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.dataset={};this.attrs={};this.listeners=new Map();this.hidden=false;this.isConnected=true;
    this.style={setProperty(key,value){this[key]=value;}};
    const classes=new Set();this.classList={toggle:(key,on)=>{on?classes.add(key):classes.delete(key);},contains:key=>classes.has(key)};
    this.complete=false;this.naturalWidth=0;this.html='';
  }
  set innerHTML(value) {
    this.html=value;this.children=[];this.images=[];this.detail=null;this.toggle=null;
    for(const match of value.matchAll(/<img\b[^>]*src="([^"]*)"[^>]*>/g)){const image=new Element('img');image.src=match[1];image.parentElement=this;this.images.push(image);this.children.push(image);}
    if(value.includes('data-guardian-buff-toggle')){this.toggle=new Element('button');this.toggle.parentElement=this;this.toggle.closest=()=>this.toggle;this.children.push(this.toggle);}
    if(value.includes('guardian-idle-buff-detail')){this.detail=new Element();this.detail.hidden=true;this.detail.parentElement=this;this.children.push(this.detail);}
  }
  get innerHTML(){return this.html;}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}}
  contains(node){return this.children.includes(node)||this.children.some(child=>child.contains(node));}
  querySelectorAll(query){return query==='img'?this.images||[]:[];}
  querySelector(query){return query==='.guardian-idle-buff-detail'?this.detail:query==='[data-guardian-buff-toggle]'?this.toggle:null;}
  addEventListener(name,fn){this.listeners.set(name,fn);}
  removeEventListener(name){this.listeners.delete(name);}
  setAttribute(name,value){this.attrs[name]=String(value);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
}
function setup({lateContract=false}={}) {
  const document={createElement:tag=>new Element(tag)};
  const window={},context=vm.createContext({window,document,Map,Set,console,fetch(){throw Error('unexpected network');},setTimeout(){throw Error('unexpected timer');},requestAnimationFrame(){throw Error('unexpected animation loop');}});
  if(!lateContract)vm.runInContext(read('guardian-sigil-contract.js'),context);
  vm.runInContext(read('guardian-idle-fx.js'),context);
  if(lateContract)vm.runInContext(read('guardian-sigil-contract.js'),context);
  return {api:window.RpgGuardianIdleFX,root:new Element()};
}
function snapshot({type='magic',quality=4,damageType='magic',state='fighting',actor='hero-a',...extra}={}) {
  const guardian=guardianEffect({id:'feather-a',type,quality}),char={guardian,damageType};
  return {character:{tgId:actor,state,partyId:null},guardian,stats:guardianStatsView({atk:100,power:100,skill:{mult:1},def:0,maxHp:100,maxMp:100},char),...extra};
}

test('all 32 server guardian types/qualities display the exact permanent PvE bonus and visual threshold',()=>{
  const {api}=setup();
  for(const type of types)for(let rank=1;rank<=8;rank++){
    const me=snapshot({type,quality:rank,damageType:type==='loot'?'magic':type}),m=api.model(me);
    assert.equal(m.bonus,type==='loot'?me.guardian.lootBonus:me.stats.guardianAttackPct);
    assert.equal(m.rank,rank);assert.equal(m.visual,rank>=4);assert.equal(m.quality,qualities[rank-1]);
    assert.ok(m.value.startsWith('+'));assert.ok(api.buffMarkup(m).includes('data-guardian-buff-toggle'));
    assert.equal(api.projectionMarkup(m).includes('guardian-idle-angel'),rank>=4);
  }
});

test('damage mismatch is shown as no bonus even if a high-quality feather advertises one',()=>{
  const {api}=setup(),me=snapshot({type:'melee',quality:8,damageType:'magic'}),m=api.model(me);
  assert.equal(me.guardian.damageBonus,.3);assert.equal(m.bonus,0);assert.equal(m.value,'未加成');assert.equal(m.useful,false);
  assert.match(api.buffMarkup(m),/此角色的攻擊類型不符/);assert.doesNotMatch(api.buffMarkup(m),/\+30%/);
});

test('loot uses a relative server multiplier; missing attack stats never invent a class-derived damage buff',()=>{
  const {api}=setup(),loot=api.model(snapshot({type:'loot',quality:4}));assert.equal(loot.value,'+18%');assert.match(loot.scope,/相對倍率/);
  const me=snapshot();delete me.stats;me.character.baseClass='mage';const unknown=api.model(me);assert.equal(unknown.bonus,null);assert.equal(unknown.value,'待同步');assert.match(unknown.effect,/同步/);
});

test('summon-stone support, permanent guardian and waiting state stay distinct without invented double values',()=>{
  const {api}=setup(),base=snapshot(),assist={itemId:'feather-a',remainingBattles:4};
  const active=api.model({...base,guardianSummonEnabled:true,guardianAssist:assist});assert.equal(active.assisting,true);assert.equal(active.support,'參戰中');assert.equal(active.bonus,base.stats.guardianAttackPct);
  const waiting=api.model({...base,guardianSummonEnabled:true,guardianAssist:{...assist,remainingBattles:0},inventory:{guardian_summon_stone:10}});assert.equal(waiting.assisting,false);assert.equal(waiting.support,'等待召喚');
  const stopped=api.model({...base,guardianSummonEnabled:false,guardianAssist:assist});assert.equal(stopped.support,'守護中');assert.equal(stopped.bonus,base.stats.guardianAttackPct);assert.equal(stopped.visual,true);
  const town=api.model({...base,character:{...base.character,state:'town_no_red'},guardianSummonEnabled:true,guardianAssist:assist});assert.equal(town.support,'準備參戰');assert.equal(town.assisting,false);
  const party=api.model({...base,character:{...base.character,partyId:'party-a'},guardianSummonEnabled:true,guardianAssist:assist});assert.equal(party.assisting,false);
  const wrong=api.model({...base,guardianSummonEnabled:true,guardianAssist:{...assist,itemId:'old-feather'}});assert.equal(wrong.support,'守護中');
});

test('malformed snapshots and unsafe art cannot generate executable URLs or a wrong guardian',()=>{
  const {api}=setup();assert.equal(api.model(null),null);assert.equal(api.model({...snapshot(),guardian:null}),null);
  assert.equal(api.model({...snapshot(),guardian:{...snapshot().guardian,type:'unknown'}}),null);
  const unsafe=api.model({...snapshot(),guardian:{...snapshot().guardian,artUrl:'javascript:evil',typeName:'<script>evil</script>'}});
  assert.equal(unsafe.visual,false);assert.equal(unsafe.art,null);assert.doesNotMatch(api.buffMarkup(unsafe),/<script|javascript:/);
});

test('late script/contract loading is safe and the exact current contract is resolved at snapshot time',()=>{
  const {api}=setup({lateContract:true});assert.equal(api.model(snapshot()).art,'/art/guardian-sigil-20261013/magic.webp');
});

test('320/390/768 stage placement preserves the complete portrait within a scene without stretching it',()=>{
  const {api}=setup();
  for(const width of [320,390,768])for(const height of [236,440,980])for(const x of [-50,40,width+100]){
    const p=api.placement({x,y:height-180},width,height);
    assert.ok(p.left-p.width/2>=7.99);assert.ok(p.left+p.width/2<=width-7.99);assert.ok(p.top>=58);assert.ok(p.top+p.height<=height-47.99);assert.ok(p.height>=100&&p.height<=154);
    assert.ok(p.left-p.cloudWidth/2>=7.99);assert.ok(p.left+p.cloudWidth/2<=width-7.99);assert.ok(p.top+p.height-16+p.cloudHeight<=height-9.99);
  }
});

test('changing character, feather or disabling clears old DOM and closes expanded buff details immediately',()=>{
  const {api,root}=setup(),handle=api.create(root),buff=root.children[0],projection=root.children[1];
  handle.update(snapshot());assert.equal(buff.hidden,false);assert.equal(projection.hidden,false);
  buff.listeners.get('click')({target:buff.toggle});assert.equal(buff.detail.hidden,false);assert.equal(buff.toggle.attrs['aria-expanded'],'true');
  handle.update(snapshot({actor:'hero-b',type:'loot',quality:6}));assert.equal(buff.dataset.characterId,'hero-b');assert.equal(buff.detail.hidden,true);assert.match(buff.innerHTML,/掉寶 \+50%/);assert.doesNotMatch(buff.innerHTML,/魔傷/);
  handle.update({...snapshot({actor:'hero-b'}),guardian:null});assert.equal(buff.hidden,true);assert.equal(projection.hidden,true);assert.equal(buff.innerHTML,'');assert.equal(projection.innerHTML,'');
  handle.cleanup();assert.equal(root.children.length,0);
});

test('stale portrait load/error after a switch cannot alter the replacement guardian; load failure keeps a buff fallback',()=>{
  const {api,root}=setup(),handle=api.create(root),buff=root.children[0],projection=root.children[1];handle.update(snapshot());const old=projection.images[0];
  handle.update(snapshot({actor:'hero-b',type:'ranged',damageType:'ranged'}));const current=projection.images[0];old.listeners.get('error')();assert.equal(current.classList.contains('is-missing'),false);
  current.naturalWidth=504;current.listeners.get('load')();assert.equal(current.classList.contains('is-ready'),true);
  const icon=buff.images[0];icon.listeners.get('error')();assert.equal(icon.classList.contains('is-missing'),true);assert.match(buff.innerHTML,/遠傷 \+7%/);
  handle.cleanup();current.listeners.get('error')();assert.equal(current.classList.contains('is-missing'),false);
});

test('hidden/reduced-motion state and repeated snapshots use existing CSS only; no network, timers, RAF or decoder',()=>{
  const {api,root}=setup(),handle=api.create(root);handle.update(snapshot(),{paused:true,reducedMotion:true});
  assert.equal(root.classList.contains('guardian-idle-paused'),true);assert.equal(root.classList.contains('guardian-idle-reduced-motion'),true);
  const image=root.children[1].images[0];handle.update(snapshot(),{paused:false,reducedMotion:false});assert.equal(root.children[1].images[0],image);
  assert.equal(root.classList.contains('guardian-idle-paused'),false);handle.position({x:110,y:240},390,440);assert.equal(root.children[1].style.height,'121.44000000000001px');
  root.isConnected=false;const before=root.children[1].style.left;handle.position({x:300,y:100},390,440);assert.equal(root.children[1].style.left,before);
  assert.doesNotMatch(read('guardian-idle-fx.js'),/<video|setInterval\s*\(|setTimeout\s*\(|requestAnimationFrame\s*\(|fetch\s*\(/);handle.cleanup();
});

test('battle delegates guardian motion to existing render/resize lifecycle and no longer starts a perpetual separate frame loop',()=>{
  const source=read('battle.js'),sync=source.slice(source.indexOf('function positionGuardian()'),source.indexOf('    const E ='));
  assert.match(sync,/RpgGuardianIdleFX\.create/);assert.match(sync,/document\.hidden\|\|!root\.isConnected/);assert.doesNotMatch(sync,/requestAnimationFrame|cancelAnimationFrame|guardianFrame/);
  const css=read('guardian-idle-fx.css');assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/animation-play-state:paused/);assert.match(css,/opacity:\.55/);assert.match(css,/object-fit:contain/);
});

test('divine mist reaches the real hero head from the enlarged angel feet without a separate renderer or opaque panel',()=>{
  const {api,root}=setup(),handle=api.create(root);
  for(const quality of qualities){
    const me=snapshot({quality:qualities.indexOf(quality)+1}),m=api.model(me);handle.update(me);
    assert.equal(root.children[1].style['--guardian-idle-color'],m.color);
    assert.equal(root.children[1].innerHTML.includes('guardian-idle-cloud'),m.visual);
  }
  for(const [width,height,y] of [[320,360,240],[390,440,300],[768,980,600]]){
    const p=api.placement({x:width/3,y},width,height);
    assert.ok(Math.abs(p.top+p.height-16+p.cloudHeight-y)<1e-8,'Mist ends at the head anchor');
    assert.ok(p.top+p.height<y,'Angel feet stay above the head');
  }
  const css=read('guardian-idle-fx.css');
  assert.match(css,/divine-mist-atlas\.png/);assert.match(css,/400% 200%/);
  assert.match(css,/guardian-idle-paused \.guardian-idle-cloud/);
  assert.match(css,/guardian-idle-reduced-motion \.guardian-idle-cloud/);
  handle.cleanup();assert.equal(root.children.length,0);
});
