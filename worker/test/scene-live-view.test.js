import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { bindLiveScene, bindPreviewJs, bindHudV2, bindArtOnly, bindSceneHtml, bindUi } from '../tools/scene-preview-bindings.mjs';

const viewSource = fs.readFileSync(new URL('../public/scene-live-view.js', import.meta.url), 'utf8');
function viewApi(live = true) {
  const window = { __RpgScenePreviewConfig: { live }, addEventListener() {} };
  vm.runInNewContext(viewSource, { window, Intl, Number, Object, Set, Map, String, Error, Date });
  return window.RpgSceneLiveView;
}
function snapshot() {
  return {
    schemaVersion: 1, realmId: 'permanent', accountId: '90101', characterId: 'A', serverNow: 10000,
    character: { id: 'A', name: '真角色', baseClass: 'mage', gender: 'm', classPath: 'B22', appearanceKey: 'adv3_mage_B22_m', level: 90 },
    live: { hp: 1, mp: 12, maxHp: 100, maxMp: 40, gold: 90, exp: 5, activeRunId: 'R', supplies: { hp: 20, mp: 15 } },
    run: { id: 'R', realmId: 'permanent', characterId: 'A', revision: 5, active: true, status: 'running', map: { id: 'laurel_intro', name: '月桂星圖', themeId: 1, kind: 'tutorial' }, hero: { hp: 26, mp: 3, maxHp: 120, maxMp: 60, shield: 2 }, supplies: { hp: 4, mp: 2 }, enemies: [{ id: '0:0:0', name: '月光野兔', rank: 'normal', hp: 15, maxHp: 70 }], events: [], report: { gold: 10, exp: 20, kills: 2 } },
  };
}
test('scene uses committed expedition vitals and supplies, then live camp values after return', () => {
  const api = viewApi(), data = snapshot(), before = JSON.stringify(data);
  const active = api.normalize(data);
  assert.equal(active.hero.hp, 26); assert.equal(active.hero.maxHp, 120); assert.equal(active.supplies.hp, 4);
  assert.equal(active.character.appearanceKey, 'adv3_mage_B22_m'); assert.equal(active.live.gold, 90); assert.equal(active.run.report.gold, 10);
  assert.equal(JSON.stringify(data), before, 'display projection must not mutate server state');
  data.run.active = false; data.run.status = 'stopped'; data.run.hero.hp = 0; data.live.activeRunId = null;
  data.run.events = [{ id: 'old', type: 'expired' }];
  const camp = api.normalize(data);
  assert.equal(camp.hero.hp, 1); assert.equal(camp.supplies.hp, 20); assert.equal(camp.map, null); assert.equal(camp.enemies.length, 0);
  assert.equal(camp.run.status, 'stopped', 'old terminal event cannot overwrite authoritative status');
});
test('scene rejects missing or cross-character / cross-realm data instead of retaining another actor', () => {
  const api = viewApi(); assert.equal(api.normalize(null), null); assert.equal(api.normalize({}), null);
  for (const change of [s => { s.character.id = 'B'; }, s => { s.run.characterId = 'B'; }, s => { s.run.realmId = 'season-x'; }]) {
    const data = snapshot(); change(data); assert.equal(api.normalize(data), null);
  }
  const data = snapshot(); data.live.activeRunId = 'different-run'; assert.equal(api.normalize(data).active, false);
});
test('camp HUD uses all-tier totals while legacy counters and current-run reserves retain their meanings', () => {
  const api=viewApi(),data=snapshot();
  data.live.supplies={hp:20,mp:15,totals:{hp:47,mp:34},items:{red_1:20,red_2:27,blue_1:15,blue_2:19}};
  const active=api.normalize(data);assert.equal(active.supplies.hp,4);assert.equal(active.supplies.mp,2);
  data.live.activeRunId=null;data.run.active=false;const before=JSON.stringify(data),camp=api.normalize(data);
  assert.equal(camp.supplies.hp,47);assert.equal(camp.supplies.mp,34);assert.equal(camp.supplies.items.red_2,27);
  assert.equal(JSON.stringify(data),before,'rendering cannot rewrite compatibility counters in the response');
  delete data.live.supplies.totals;assert.equal(api.normalize(data).supplies.hp,20);
  data.live.supplies.totals={hp:-1,mp:NaN};assert.equal(api.normalize(data).supplies.hp,20);assert.equal(api.normalize(data).supplies.mp,15);
});
test('exact map and monster whitelist refuses lookalikes, wrong rank and higher-mode art', () => {
  const api = viewApi(), map = snapshot().run.map, enemy = snapshot().run.enemies[0];
  assert.equal(api.enemyAsset(map, enemy).spriteId, 'moon_hare');
  assert.equal(api.enemyAsset({ ...map, themeId: 2 }, enemy), null);
  assert.equal(api.enemyAsset({ ...map, kind: 'boss' }, enemy), null);
  assert.equal(api.enemyAsset(map, { ...enemy, name: '月光野兔2' }), null);
  assert.equal(api.enemyAsset(map, { ...enemy, rank: 'elite' }), null);
  assert.equal(api.mapAsset({ id: 'hell-01', themeId: 1, kind: 'tutorial' }), null);
  assert.equal(api.enemyAsset({ id: 'laurel_warden', themeId: 1, kind: 'boss' }, { name: '月桂巨樹精', rank: 'boss' }).spriteId, 'ancient_laurel');
});
test('sprite metadata uses actual selected frame count and rejects untrusted image paths', () => {
  const api = viewApi(), asset = { spriteId: 'temple_centurion' };
  const entry = { file: 'temple_centurion_death.webp', cellW: 928, cellH: 768, frames: 7, ox: .5, oy: .93, frameInfo: [{ h: 390 }, { h: 410 }] };
  const data = { temple_centurion_death: entry }, result = api.spriteMetadata(data, asset, 'death');
  assert.equal(result.frames, 7); assert.equal(result.body, 400);
  assert.throws(() => api.spriteMetadata({ temple_centurion_death: { ...entry, file: '../other.webp' } }, asset, 'death'));
  assert.throws(() => api.spriteMetadata(data, asset, 'attack'));
  assert.throws(() => api.spriteMetadata({ temple_centurion_death: { ...entry, frames: 0 } }, asset, 'death'));
});
test('art preview never mounts the live scene adapter', () => assert.equal(viewApi(false).mount({}, {}), null));
test('experience bar distinguishes a genuine zero, partial progress, maximum level and missing data', () => {
  const api = viewApi();
  assert.equal(api.experienceProgress(null), null);
  assert.equal(api.experienceProgress({ current: 1, required: null, ratio: 0, maxLevel: false }), null);
  assert.equal(api.experienceProgress({ current: 0, required: 400, ratio: 0, maxLevel: false }).ratio, 0);
  assert.equal(api.experienceProgress({ current: 120, required: 400, ratio: .3, maxLevel: false }).ratio, .3);
  assert.equal(api.experienceProgress({ current: 0, required: null, ratio: 1, maxLevel: true }).maxLevel, true);
});

// A deliberately small scene implements the public binding contract. Executing
// both modes proves that the original demo cannot mutate the live renderer.
const fixture = `(function(){
var UI=window.UI,Q=new URLSearchParams(),hero=window.hero,ringG=window.ringG,rim=window.rim,ghost=window.ghost,hpG={},G={w:100,h:100},mons=[],sc=window.scene,stage=window.stage;
var visual, debugState={actor:'archer'};
window.addEventListener('message',function(event){window.calls.message++;});
function preload(){var L=this.load;window.calls.artPreload++;}
function loadCharacter(){window.calls.actorLoad++;}
function mk(){window.calls.artAnimation++;}
function create(){var HS=100,k=1;
this.add.image(0,0,'ground').setOrigin(0).setScale(k);
mk('h_walk','hero_walk_right',{},13,-1);mk('h_atk','hero_attack_right',{},20,0);mk('h_idle','hero_idle',{frames:[4,5]},3,-1);
mk('fx_spin','fx_whirlwind',{},22,0);mk('fx_hit','fx_hit_sparks',{},28,0);
hero.setScale(HS*.22/205);hero.play('h_idle');
hero.hp=3600;hero.mhp=3600;hero.rage=60;
visual={ready:true};loadCharacter(debugState.actor);
UI.cast=function(i){if(visual?.ready)castSkill(i,true);};
this.time.addEvent({delay:9000,loop:true});this.time.addEvent({delay:21000,loop:true});
horde();spawnElite();spawnBoss();
UI.setHP(hero.hp,hero.mhp);UI.setMP(hero.rage,100);UI.setXP(.62);
setTimeout(function(){UI.toast('進入 示意戰場','假獎勵','helm');},600);
if(Q.get('panel'))setTimeout(function(){UI.toggle(Q.get('panel'));},400);
this.scale.on('resize',function(s){HS=s.height;});window.addEventListener('resize',function(){var b=stage.getBoundingClientRect();sc.scale.resize(b.width,b.height);});
}
function projectileTo(target,damage){window.calls.attack++;}
function performPreviewAttack(target){window.calls.attack++;}
function horde(s,n){window.calls.spawn++;}
function spawnElite(s){window.calls.spawn++;}
function spawnBoss(s,near){window.calls.spawn++;}
function hit(m,d,crit){window.calls.damage++;}
function kill(m){window.calls.reward++;}
function castSkill(i,user){window.calls.cast++;}
function update(t,dms){window.calls.demoUpdate++;}
window.fixture={preload,create,update,projectileTo,performPreviewAttack,horde,spawnElite,spawnBoss,hit,kill,castSkill};
})();`;
function runScene(live, resize = false) {
  const calls = Object.fromEntries(['message','artPreload','actorLoad','artAnimation','spawn','attack','damage','reward','cast','demoUpdate','liveUpdate','timers','timeout','hud','mount'].map(key => [key, 0]));
  const chain = { setScale(){return this;},setVisible(){return this;},setOrigin(){return this;},play(){return this;},setAlpha(){return this;},clear(){} };
  const window = { __RpgScenePreviewConfig: { live }, calls, hero: { ...chain }, ringG: chain, rim: chain, ghost: chain, handlers: [] };
  window.addEventListener = (type, fn) => window.handlers.push({ type, fn });
  window.UI = { setHP(){calls.hud++;},setMP(){calls.hud++;},setXP(){calls.hud++;},target(){},toast(){},toggle(){} };
  window.RpgSceneLiveView = { mount(){calls.mount++;return {update(){calls.liveUpdate++;}};} };
  let bounds = { width: 390, height: 844 };
  // Phaser RESIZE refresh first sizes from its cached parent, then measures DOM.
  // Without the live binding's pre-measure, a viewport resize stays at 390x844.
  const scale = { width: 390, height: 844, parentSize: { ...bounds }, on() {},
    getParentBounds() { this.parentSize = { ...bounds }; },
    resize(width, height) { this.width = width; this.height = height; this.width = this.parentSize.width; this.height = this.parentSize.height; this.getParentBounds(); },
  };
  const scene = { scale, add: { image(){return chain;} }, time: { addEvent(){calls.timers++;} }, textures: { addCanvas(){} }, cache: { json: { add(){} } } };
  window.scene = scene; window.stage = { getBoundingClientRect: () => bounds };
  vm.runInNewContext(bindLiveScene(fixture), { window, URLSearchParams, document:{createElement(){return {};}}, HERO_READABILITY:null, perf(){},setTimeout(){calls.timeout++;} });
  window.fixture.preload.call(scene); window.fixture.create.call(scene);
  window.handlers.filter(handler => handler.type === 'message').forEach(handler => handler.fn({}));
  if (resize) { bounds = { width: 1280, height: 900 }; window.handlers.filter(handler => handler.type === 'resize').forEach(handler => handler.fn()); }
  for (const name of ['projectileTo','performPreviewAttack','horde','spawnElite','spawnBoss','hit','kill','castSkill']) window.fixture[name]();
  window.UI.cast(1); window.fixture.update(100,16);
  return { ...calls, scaleWidth: scale.width, scaleHeight: scale.height };
}
test('live binding suppresses every simulated combat entry and initial fake HUD / texture preload', () => {
  const calls = runScene(true);
  for (const key of ['message','artPreload','actorLoad','artAnimation','spawn','attack','damage','reward','cast','demoUpdate','timers','timeout','hud']) assert.equal(calls[key], 0, key);
  assert.equal(calls.mount, 1); assert.equal(calls.liveUpdate, 1);
});
test('same response binding preserves original art-review behavior when config.live is false', () => {
  const calls = runScene(false);
  for (const key of ['message','artPreload','actorLoad','artAnimation','spawn','attack','damage','reward','cast','demoUpdate','timers','timeout','hud']) assert.ok(calls[key] > 0, key);
  assert.equal(calls.mount, 0); assert.equal(calls.liveUpdate, 0);
});
test('live viewport resize measures the parent before Phaser can restore cached phone dimensions', () => {
  const live = runScene(true, true), art = runScene(false, true);
  assert.equal(live.scaleWidth, 1280); assert.equal(live.scaleHeight, 900);
  assert.equal(art.scaleWidth, 390); assert.equal(art.scaleHeight, 844, 'art preview retains its original resize path');
});
test('changed required source hooks fail visibly instead of silently returning simulated battle', () => {
  assert.throws(() => bindLiveScene(fixture.replace('function update(t,dms){', 'function tick(t,dms){')), /hook changed/);
  const bound = bindLiveScene(fixture); assert.equal(bindLiveScene(bound), bound);
});
test('candidate orb updater and HUD scripts cannot restore manual numbers or fake potion actions in live mode', () => {
  const source = 'function update() { window.manual++; } update();';
  const calls = { manual: 0, hud: 0, art: 0, refresh: 0 }, window = { __RpgScenePreviewConfig: {live:true}, manual:0, RpgSceneLiveView:{mountHUD(){calls.hud++;}} };
  vm.runInNewContext(bindPreviewJs(source), {window,frame:{contentWindow:{RpgSceneLiveView:{refreshHUD(){calls.refresh++;}}}}});
  vm.runInNewContext(bindHudV2('window.manual++;'), {window}); vm.runInNewContext(bindArtOnly('window.manual++;'), {window});
  assert.equal(window.manual, 0); assert.equal(calls.hud, 1); assert.equal(calls.refresh, 1);
  window.__RpgScenePreviewConfig.live=false; vm.runInNewContext(bindHudV2('window.manual++;'), {window}); vm.runInNewContext(bindArtOnly('window.manual++;'), {window});
  assert.equal(window.manual, 2);
});
test('scene HTML loads one shared session before the renderer and social adapter', () => {
  const input = '<html><head></head><body><script src="ui.js"></script><script src="/ui-generated-20261030/characters-v1/scene.js"></script></body></html>';
  const result = bindSceneHtml(input);
  assert.equal((result.match(/scene-live-session\.js/g)||[]).length,1);
  assert.ok(result.indexOf('scene-live-session.js') < result.indexOf('scene-live-view.js'));
  assert.ok(result.indexOf('scene-live-view.js') < result.indexOf('scene-bound-20261102/scene.js'));
  assert.ok(result.indexOf('scene-live-session.js') < result.indexOf('scene-social-preview.js'));
  assert.ok(result.includes('scene-live-view.css'));
});
test('UI trigger, prototype buffs and default portrait are guarded without disabling art review', () => {
  const source = "var UI=window.UI;UI.trigger=function(i){window.calls++;};[['rage',3],['shield',0],['spin',12]].forEach(function(b){window.calls++;});(function(){var im=new Image();window.calls++;})();for(var k=0;k<4;k++)pushChat();setInterval(pushChat,7000);";
  const window={__RpgScenePreviewConfig:{live:true},RPG_LIVE_SOCIAL:true,UI:{},calls:0};
  const bound=bindUi(source);vm.runInNewContext(bound,{window,Image:function(){},pushChat(){},setInterval(){}});window.UI.trigger(0);
  assert.equal(window.calls,0);assert.equal(bindUi(bound),bound);
});

test('all survey maps reuse only their exact theme and normal or elite assets', () => {
  const api = viewApi();
  const cases = [
    ['laurel_survey', 1, '月光野兔', 'moon_hare', '阿耳忒彌斯巡林長', 'artemis_ranger'],
    ['pillar_survey', 2, '百柱石像', 'temple_statue', '神殿禁衛百夫長', 'temple_centurion'],
    ['grove_survey', 3, '潘神幼獸', 'pan_cub', '狂暴潘神衛士', 'pan_warden'],
  ];
  for (const [id, themeId, normal, normalSprite, elite, eliteSprite] of cases) {
    const map = { id, themeId, kind: 'survey' };
    assert.equal(api.mapAsset(map).sourceMap, themeId);
    assert.equal(api.enemyAsset(map, { rank: 'normal', name: normal }).spriteId, normalSprite);
    assert.equal(api.enemyAsset(map, { rank: 'elite', name: elite }).spriteId, eliteSprite);
    assert.equal(api.enemyAsset(map, { rank: 'normal', name: elite }), null);
    assert.equal(api.enemyAsset(map, { rank: 'boss', name: elite }), null);
    assert.equal(api.mapAsset({ ...map, themeId: themeId + 1 }), null);
    assert.equal(api.mapAsset({ ...map, kind: 'tutorial' }), null);
  }
});

test('larger guardian and original cloud stay above every opaque hero head and inside the HUD edges',()=>{
 const api=viewApi(),root={left:10,top:20,width:390,height:844};
 for(const hero of [{x:130,y:280,width:95,height:170},{x:140,y:330,width:120,height:210},{x:120,y:400,width:160,height:230},{x:145,y:500,width:110,height:150}]){
  const p=api.guardianPlacement(hero,root);assert.ok(p.size>82,'visible angel is larger than old cap');assert.ok(p.top>=64);assert.ok(p.top+p.size<=p.cloudTop+.01);assert.ok(p.cloudTop+p.cloudHeight<=hero.y-root.top-10+.01,'mist cannot cover the hero face');assert.ok(p.cloudLeft>=8&&p.cloudLeft+p.cloudWidth<=root.width-8);
 }
});
test('guardian compresses safely near the ceiling and hides when no separate overhead room remains',()=>{
 const api=viewApi(),root={left:0,top:0,width:320,height:390};assert.equal(api.guardianPlacement({x:90,y:150,width:100,height:160},root),null);const p=api.guardianPlacement({x:-25,y:225,width:70,height:130},root);assert.ok(p&&p.top>=64);assert.ok(p.cloudLeft>=8);assert.ok(p.cloudTop+p.cloudHeight<=215);
});


test('guardian reserves camera overhead on full-height scenes and keeps cloud before angel',()=>{
 const api=viewApi();assert.equal(api.guardianCameraOffset(844),84.4);assert.equal(api.guardianCameraOffset(390),0);assert.equal(api.guardianCameraOffset(1200),92);
 const root={left:0,top:0,width:390,height:844};const hero={x:150,y:253+api.guardianCameraOffset(844),width:85,height:170};const p=api.guardianPlacement(hero,root);
 assert.ok(p.size>=179&&p.size/124.8>=1.4);assert.ok(p.cloudHeight>=54);assert.ok(p.top>=64);assert.ok(p.top+p.size<=p.cloudTop+.01);assert.ok(p.cloudTop+p.cloudHeight<=hero.y-10+.01);
 const cloud=viewSource.indexOf('guardianCloud.hidden=false;',viewSource.indexOf('function placeGuardian'));assert.ok(cloud<viewSource.indexOf('if(!guardianReady)',cloud));
});

// Restored classic 星環遠征中 / 組隊冒險中 away view.
const awaySource = fs.readFileSync(new URL('../public/expedition-away.js', import.meta.url), 'utf8');
function awayHarness() {
  const navigations = [], heads = [], htmlClasses = new Set();
  const stage = { id: 'stage', children: [], insertBefore(node, ref) { node.parentNode = stage; this.children.splice(this.children.indexOf(ref), 0, node); return node; }, appendChild(node) { node.parentNode = stage; this.children.push(node); return node; } };
  const ui = { id: 'ui', parentNode: stage }; stage.children.push({ id: 'game' }, ui);
  const video = { paused: true, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, addEventListener() {}, classList: { add() {} } };
  const element = tag => {
    const node = { tagName: tag, className: '', innerHTML: '', dataset: {}, setAttribute() {},
      remove() { const i = stage.children.indexOf(node); if (i >= 0) stage.children.splice(i, 1); node.parentNode = null; },
      querySelector(selector) {
        if (selector !== '.expedition-away' || !node.innerHTML.includes('class="expedition-away"')) return null;
        if (node.section?.html !== node.innerHTML) {
          const button = { dataset: { awayOpen: /data-away-open="([^"]+)"/.exec(node.innerHTML)[1] } };
          node.section = { html: node.innerHTML, isConnected: true, querySelector: s => s === 'video' ? video : s === '[data-away-open]' ? button : null, button };
        }
        return node.section;
      } };
    return node;
  };
  const document = { hidden: false, head: { appendChild: n => heads.push(n) }, documentElement: { classList: { add: c => htmlClasses.add(c), remove: c => htmlClasses.delete(c) } },
    getElementById: id => ({ stage, ui })[id] || null, querySelector: () => null, createElement: element, addEventListener() {}, removeEventListener() {} };
  const window = { __RpgScenePreviewConfig: { live: true }, addEventListener() {}, document, RpgSceneNavigation: { navigate: (...args) => navigations.push(args) } };
  const context = { window, document, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), setInterval: () => 1, clearInterval() {}, Intl, Number, Object, Set, Map, String, Error, Date, Promise };
  vm.createContext(context);
  vm.runInContext(awaySource, context); vm.runInContext(viewSource, context);
  const layer = () => stage.children.find(n => n.className === 'scene-away-layer');
  return { api: window.RpgSceneLiveView, window, stage, video, heads, htmlClasses, navigations, layer };
}
function awaySnapshot(partyId) {
  const data = snapshot(); data.run.active = false; data.run.status = 'stopped'; data.live.activeRunId = null; data.live.partyId = partyId; return data;
}
test('server party state maps to the classic away activity; an active Atlas run or no party keeps the normal scene', () => {
  const api = viewApi(), ring = 'ring:' + 'ab'.repeat(16);
  assert.deepEqual(JSON.parse(JSON.stringify(api.awayActivity(api.normalize(awaySnapshot(ring))))), { kind: 'star-ring', id: ring });
  assert.deepEqual(JSON.parse(JSON.stringify(api.awayActivity(api.normalize(awaySnapshot('p-42'))))), { kind: 'party', id: 'p-42' });
  assert.equal(api.awayActivity(api.normalize(awaySnapshot(null))), null);
  const running = snapshot(); running.live.partyId = ring; assert.equal(api.awayActivity(api.normalize(running)), null);
  assert.equal(api.awayActivity(null), null);
});
test('a 星環 expedition renders the classic 星環遠征中 full-screen video under the HUD and clears on return', async () => {
  const h = awayHarness(), ring = 'ring:' + 'cd'.repeat(16);
  const layer = await h.api.syncAway(h.api.normalize(awaySnapshot(ring)));
  assert.equal(layer, h.layer()); assert.ok(h.htmlClasses.has('rpg-scene-away'));
  assert.ok(h.stage.children.indexOf(layer) < h.stage.children.findIndex(n => n.id === 'ui'), 'HUD stays above the away view');
  for (const text of ['星環遠征中', '一般掛機暫停 · 戰果由隊伍獨立結算', '/art/expedition-away-20261020/loop.mp4', '/art/expedition-away-20261020/poster.webp', '查看遠征戰況']) assert.ok(layer.innerHTML.includes(text), text);
  assert.equal(h.video.paused, false, 'loop video plays');
  layer.querySelector('.expedition-away').button.onclick({ currentTarget: layer.querySelector('.expedition-away').button });
  assert.deepEqual(JSON.parse(JSON.stringify(h.navigations)), [['star-ring', {}]]);
  assert.equal(await h.api.syncAway(h.api.normalize(awaySnapshot(ring))), layer, 'same expedition is not remounted');
  await h.api.syncAway(h.api.normalize(awaySnapshot(null)));
  assert.equal(h.layer(), undefined); assert.ok(!h.htmlClasses.has('rpg-scene-away')); assert.equal(h.video.paused, true);
});
test('a party expedition shows 組隊冒險中 and opens the current party', async () => {
  const h = awayHarness(), layer = await h.api.syncAway(h.api.normalize(awaySnapshot('p-7')));
  assert.ok(layer.innerHTML.includes('組隊冒險中') && layer.innerHTML.includes('查看組隊戰況'));
  const section = layer.querySelector('.expedition-away'); section.button.onclick({ currentTarget: section.button });
  assert.deepEqual(JSON.parse(JSON.stringify(h.navigations)), [['party', { tab: 'current' }]]);
});
test('the away view styles keep the full-screen video under the HUD (stylesheet braces balanced)', () => {
  const css = fs.readFileSync(new URL('../public/scene-live-view.css', import.meta.url), 'utf8');
  let depth = 0; for (const c of css.replace(/\/\*[\s\S]*?\*\//g, '')) { depth += c === '{' ? 1 : c === '}' ? -1 : 0; assert.ok(depth >= 0); }
  assert.equal(depth, 0);
  const tail = css.slice(css.indexOf('.scene-away-layer {'));
  assert.match(tail, /^\.scene-away-layer \{ position: absolute; inset: 0;/); assert.doesNotMatch(tail.split('}')[0], /z-index/);
  assert.match(css, /\.scene-away-layer \.expedition-away \{ position: absolute; inset: 0; aspect-ratio: auto; min-height: 0; \}/);
});
