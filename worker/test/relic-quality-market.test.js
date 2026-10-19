import test from 'node:test';import assert from 'node:assert/strict';
import {configurationExpedition} from './star-ring-configuration-fixture.js';import {NOW} from './star-ring-skill-fixture.js';
import {makeGear} from '../src/game/gear.js';import {insertEquipStmt} from '../src/db.js';import {equipmentView} from '../src/views.js';import {unbindCost} from '../src/game/share.js';
import * as Trade from '../src/services/trade.js';import * as Market from '../src/services/market-exchange.js';

for(const rarity of ['common','advanced','epic'])test(`legacy ${rarity} relic is legendary in backpack, trade and both market filters without rewriting escrow or history`,async t=>{
 const f=await configurationExpedition();t.after(f.close);const owner=f.ids[0],raw={...makeGear({id:'legacy-relic',tgId:owner,cls:'sword',slot:'boots',tier:7,relic:true,forceRarity:rarity,rng:()=>.5,now:NOW}),element_tier:rarity,enhance_level:7};await insertEquipStmt(f.env.DB,raw).run();
 const row=()=>f.db.prepare("SELECT * FROM rpg_equipment WHERE id='legacy-relic'").get(),initial=row(),cost=unbindCost(raw),view=equipmentView(f.character(),initial);
 assert.equal(view.rarity,'legendary');assert.equal(view.rarityName,'傳說');assert.equal(view.unbindCost,cost,'grandfather existing unbind cost');assert.deepEqual(row(),initial);
 const opened=await Trade.openWithEquip(f.env,{tgId:owner,target:{tgId:f.ids[1]},equipId:raw.id,requestId:'legacy-quality-trade'},NOW+1),trade=await Trade.tradeView(f.env,opened.tradeId,owner,NOW+2);
 const line=trade.a.lines[0];assert.equal(line.rarity,'legendary');assert.equal(line.rarityName,'傳說');assert.equal(line.stat,view.stat);
 await Trade.cancel(f.env,{tgId:owner,tradeId:opened.tradeId},NOW+3);assert.deepEqual(row(),initial);
 const filters={category:'equipment',quality:'legendary'},sellable=await Market.sellable(f.env,owner,{filters});assert.ok(sellable.items.some(e=>e.equipId===raw.id&&e.quality==='legendary'&&e.equipment.rarity==='legendary'));
 assert.ok(!(await Market.sellable(f.env,owner,{filters:{...filters,quality:rarity}})).items.some(e=>e.equipId===raw.id));
 const listed=await Market.create(f.env,owner,{characterId:owner,equipId:raw.id,qty:1,price:1000,requestId:crypto.randomUUID()},NOW+4),id=listed.result.listingId;
 // Reproduce an already-active pre-upgrade listing (frozen low-rarity snapshot).
 f.db.prepare('UPDATE rpg_exchange_listings SET quality=? WHERE id=?').run(rarity,id);
 const historical=f.db.prepare('SELECT snapshot_json FROM rpg_exchange_listings WHERE id=?').get(id).snapshot_json;
 const seen=await Market.list(f.env,f.ids[1],{filters});assert.ok(seen.items.some(e=>e.id===id&&e.quality==='legendary'&&e.equipment.rarity==='legendary'));
 assert.ok(!(await Market.list(f.env,f.ids[1],{filters:{...filters,quality:rarity}})).items.some(e=>e.id===id));
 assert.equal(f.db.prepare('SELECT snapshot_json FROM rpg_exchange_listings WHERE id=?').get(id).snapshot_json,historical);assert.equal(row().element_tier,rarity);
 await Market.cancel(f.env,owner,{characterId:owner,listingId:id,requestId:crypto.randomUUID()},NOW+5);assert.deepEqual(row(),initial);
});
