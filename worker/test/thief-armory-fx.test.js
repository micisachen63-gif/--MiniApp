import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {THIEF_PATHS} from '../src/game/thief-data.js';

const source=fs.readFileSync(new URL('../public/hero-fx.js',import.meta.url),'utf8');
function setup() {
  class Element {
    constructor(){this.children=[];this.dataset={};this.style={setProperty:(key,value)=>this.style[key]=value};this.isConnected=true;this.className='';this.classList={add:c=>{this.className+=' '+c;}};}
    setAttribute(){}
    append(node){this.children.push(node);}
    prepend(node){this.children.unshift(node);}
    querySelector(selector){return selector==='.doll'?this.stage:selector==='.hero-fx'?this.children.find(n=>n.className.split(' ').includes('hero-fx')):null;}
  }
  const listeners={},observers=[],stages=[],document={hidden:false,addEventListener:(name,fn)=>listeners[name]=fn,querySelectorAll:()=>stages,createElement:()=>new Element()};
  class Observer {constructor(callback){this.callback=callback;observers.push(this);}observe(stage){this.stage=stage;}disconnect(){this.disconnected=true;}}
  const window={IntersectionObserver:Observer};
  vm.runInNewContext(source,{window,document,IntersectionObserver:Observer});
  const wardrobe=new Element();wardrobe.stage=new Element();stages.push(wardrobe.stage);
  return {api:window.RpgHeroEffects,wardrobe,document,observers,listeners};
}
const motif=path=>path.startsWith('A2')?'venom':path.startsWith('B2')?'mirror':path.startsWith('B')?'flying':'shadow';

test('all 62 thief identities select their exclusive armory art and retain the tier-2 route through fourth advancement',()=>{
  const {api}=setup();
  for(const path of THIEF_PATHS)for(const gender of ['m','f']) {
    const p=api.profile({baseClass:'thief',classPath:path,classTier:path.length,gender});
    assert.equal(p.thief,true);assert.equal(p.motif,motif(path));assert.equal(p.theme,'thief-'+motif(path));
    assert.equal(p.tier,path.length);assert.equal(p.mirror,gender==='m');
    assert.ok(p.light&&p.intensity<=.42);
  }
});

test('legacy armory themes are preserved across every class path and gender',()=>{
  const {api}=setup();
  for(const path of THIEF_PATHS)for(const gender of ['m','f'])for(const cls of ['sword','archer','mage']) {
    const expected=cls==='mage'?(path.startsWith('A2')?'frost':path.startsWith('B1')?'chrono':path.startsWith('B2')?'summon':path==='B'?'chrono':'ember'):
      cls==='archer'?(path.startsWith('B2')||path.startsWith('A2')?'lunar':path==='B'||path.startsWith('B1')?'summon':'wind'):
      path.startsWith('A1')||path==='A'?'fury':path.startsWith('A2')?'lunar':'aegis';
    const p=api.profile({baseClass:cls,classPath:path,classTier:path.length,gender});assert.equal(p.theme,expected);assert.equal(p.thief,undefined);
  }
});

test('exclusive layers use local SVGs and custom particles; visibility pauses motion without duplicating layers',()=>{
  for(const path of ['','A','B','A111','A211','B111','B211']) {
    const {api,wardrobe,observers,document,listeners}=setup(),stage=wardrobe.stage;
    api.mount(wardrobe,{baseClass:'thief',classPath:path,gender:'f'});
    assert.equal(stage.dataset.thiefArmoryFx,motif(path));assert.match(stage.style['--fx-art'],new RegExp('thief-armory-fx-20261016/thief-'+motif(path)+'\\.svg'));
    assert.doesNotMatch(stage.style['--fx-art'],/hero-fx-20261011|\.webp/);
    assert.equal(stage.children.length,2);const front=stage.children[1];
    assert.ok(front.children.slice(1).every(n=>n.className.includes('thief-fx-'+motif(path))));
    api.mount(wardrobe,{baseClass:'thief',classPath:path});assert.equal(stage.children.length,2);
    observers[0].callback([{target:stage,isIntersecting:true}]);assert.equal(stage.dataset.fxRunning,'true');
    document.hidden=true;listeners.visibilitychange();assert.equal(stage.dataset.fxRunning,'false');
    document.hidden=false;listeners.visibilitychange();assert.equal(stage.dataset.fxRunning,'true');
    observers[0].callback([{target:stage,isIntersecting:false}]);assert.equal(stage.dataset.fxRunning,'false');
    api.reset();assert.equal(observers[0].disconnected,true);
  }
});

test('all four ornament plates are distinct transparent native vectors without external dependencies',()=>{
  const arts=['shadow','venom','flying','mirror'].map(key=>fs.readFileSync(new URL(`../public/art/ui/thief-armory-fx-20261016/thief-${key}.svg`,import.meta.url),'utf8'));
  assert.equal(new Set(arts).size,4);
  for(const art of arts) {assert.match(art,/viewBox="0 0 400 600" fill="none"/);assert.doesNotMatch(art,/<script|<image|<foreignObject|href="(?:https?:|data:)|<rect/);}
});
