import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {enhancementGrowth} from '../src/game/enhance-preview.js';import {itemStat} from '../src/game/stats.js';import {enhance} from '../src/game/enhance.js';
import {makeGear} from '../src/game/gear.js';import {CLASS_KEYS,SLOTS,GENERAL_WEAPON,RARITY_KEYS} from '../src/game/constants.js';
import {equipmentView} from '../src/views.js';import {mkChar,T0} from './helpers.js';import {freshDb} from './d1-shim.js';import {insertEquipStmt} from '../src/db.js';import {handle} from '../src/index.js';import {CurrentClientRequest} from './client-request.js';import * as P from '../src/services/player.js';
const raw=(cls,slot,tier,rarity,source)=>({...makeGear({id:'preview-item',tgId:'111',cls,slot,kind:slot==='weapon'?GENERAL_WEAPON[cls]:null,tier,forceRarity:rarity,rng:()=>.5,now:T0,relic:source==='relic_boss',source}),bonus_json:source==='star_ring'?JSON.stringify({starRingGearVersion:1}):'{}'});
for(const cls of CLASS_KEYS)test(`${cls}: every projected gain matches successful real enhancement across slots, tiers, rarities and ordinary/relic/expedition sources`,()=>{
 for(const slot of SLOTS)for(const tier of [1,3,7,12])for(const rarity of RARITY_KEYS)for(const source of ['shop','relic_boss','star_ring'])for(const level of [0,4,7,9,14]){
  const e={...raw(cls,slot,tier,rarity,source),enhance_level:level},before=structuredClone(e),growth=enhancementGrowth(e,cls);
  assert.equal(growth.byLevel.length,16);assert.equal(growth.byLevel[level],itemStat(e,cls).main);
  const outcome=enhance(e,{scroll_w:100,scroll_a:100},()=>0);assert.equal(outcome.result,'success');assert.equal(growth.byLevel[level+1],itemStat(e,cls).main);
  assert.ok(growth.byLevel[level+1]>=growth.byLevel[level]);assert.deepEqual({...e,enhance_level:level},before);
 }
});
test('ordinary, blessed and guaranteed successful outcomes share the same stats; failure and break do not invent an earned gain',()=>{
 const original={...raw('archer','helmet',7,'legendary','star_ring'),base_stat:13,enhance_level:7};const growth=enhancementGrowth(original,'archer');
 assert.equal(growth.byLevel[7],1083);assert.equal(growth.byLevel[8],1383);
 for(const [blessed,guaranteed] of [[false,false],[true,false],[false,true]]){const e=structuredClone(original),r=enhance(e,{scroll_a:100,blessed_scroll_a:1,guaranteed_scroll_a:1},()=>0,blessed,guaranteed);assert.equal(r.result,'success');assert.equal(itemStat(e,'archer').main,1383);}
 for(const roll of [.5,.99]){const e=structuredClone(original),r=enhance(e,{scroll_a:100},()=>roll);assert.notEqual(r.result,'success');assert.equal(itemStat(e,'archer').main,1083);}
 assert.equal(enhancementGrowth({...original,enhance_level:15},'archer'),null);
});
test('equipment view labels attack, defense and mana in Chinese and shares its current stat with the preview',()=>{
 for(const [slot,label] of [['weapon','攻擊力'],['helmet','防禦力'],['earring','魔力']]){
  const e={...raw('archer',slot,7,'legendary','star_ring'),enhance_level:7},v=equipmentView(mkChar({base_class:'archer',level:80,class_path:'A1'}),e);assert.equal(v.statName,label);assert.equal(v.enhanceGrowth.statName,label);assert.equal(v.enhanceGrowth.byLevel[7],v.stat);
 }
});
const ritual=fs.readFileSync(new URL('../public/forge-ritual.js',import.meta.url),'utf8');
test('gain renderer shows the exact next-step and selected target amounts, escapes captions and rejects absent or invalid projections',()=>{
 const ctx=vm.createContext({window:{}});vm.runInContext(ritual,ctx);const render=ctx.window.RpgForgeRitual.gainPreview;
 const e={enhance:7,enhanceGrowth:{statName:'防禦力',byLevel:[0,0,0,0,0,0,0,1083,1383,1833,2283,0,0,0,0,0]}};
 const next=render(e);assert.match(next,/1,083/);assert.match(next,/1,383/);assert.match(next,/\+300 防禦力/);assert.match(next,/27\.7%/);assert.doesNotMatch(next,/\bDEF\b/);
 const goal=render(e,10,'若達成目標',true);assert.match(goal,/2,283/);assert.match(goal,/\+1,200 防禦力/);assert.match(goal,/fr-gain-compact/);
 assert.doesNotMatch(render(e,8,'<img src=x>'),/<img/);
 for(const x of [null,{}, {...e,enhance:15},{...e,enhanceGrowth:null}])assert.equal(render(x),'');
 for(const target of [7,16,-1,8.5,'invalid'])assert.equal(render(e,target),'');
});
test('display translation preserves character names, IDs, keys, stats and saved battle messages while explaining skill/passive text',()=>{
 const ctx=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(new URL('../public/request-client.js',import.meta.url),'utf8'),ctx);
 const source={name:'ATK',id:'DEF',url:'/art/HP.png',stats:{atk:12,def:8},desc:'ATK +15%、DEF −5%、20MP',passive:{text:'MaxHP +3%／EXP +2%'},effect:'敵方 HP≤25% 時傷害提高',text:'玩家 HP 的留言',enhanceGrowth:{statName:'DEF',byLevel:[3,5]}};
 const out=JSON.parse(JSON.stringify(ctx.window.RpgRequest.localizeStats(source)));assert.equal(out.name,'ATK');assert.equal(out.id,'DEF');assert.equal(out.url,source.url);assert.deepEqual(out.stats,source.stats);assert.equal(out.text,source.text);assert.equal(out.desc,'攻擊力 +15%、防禦力 −5%、20魔力');assert.equal(out.passive.text,'生命上限 +3%／經驗值 +2%');assert.equal(out.enhanceGrowth.statName,'防禦力');assert.equal(source.desc,'ATK +15%、DEF −5%、20MP');
});
test('real MiniApp guaranteed enhancement returns the same +300 defense shown before consumption and advances the next preview',async t=>{
 const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};t.after(()=>env.DB.sqlite.close());await P.createCharacter(env,{tgId:'111',name:'強化預覽驗收',baseClass:'archer',gender:'f'},T0);
 env.DB.sqlite.prepare("UPDATE rpg_characters SET level=80,class_path='A1',last_settle_at=? WHERE tg_id='111'").run(T0);
 const e={...raw('archer','helmet',7,'legendary','star_ring'),base_stat:13,enhance_level:7};await insertEquipStmt(env.DB,e).run();env.DB.sqlite.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('111','guaranteed_scroll_a',1)").run();
 const api=async(action,body={})=>{const r=await handle(new CurrentClientRequest('http://local/app/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'111','X-Debug-Now':String(T0)},body:JSON.stringify(body)}),env);assert.equal(r.status,200);return r.json();};
 const before=(await api('me')).equipment.find(x=>x.id===e.id),after=await api('enhance',{itemId:e.id,guaranteed:true,requestId:'gain-once'}),next=after.equipment.find(x=>x.id===e.id);
 assert.equal(next.stat,before.enhanceGrowth.byLevel[8]);assert.equal(next.stat-before.stat,300);assert.equal(next.enhance,8);assert.equal(after.inventory.guaranteed_scroll_a,0);assert.equal(next.enhanceGrowth.byLevel[9],1833);
});
