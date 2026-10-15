import test from 'node:test';import assert from 'node:assert/strict';import {freshDb} from './d1-shim.js';import {T0} from './helpers.js';import * as P from '../src/services/player.js';import * as H from '../src/services/hero-hall.js';
test('hero hall uses actual characters, equipment, stats and excludes private inventory and balances',async()=>{const env={DB:freshDb()};for(const [id,cls,gender]of [['111','sword','m'],['222','archer','f']])await P.createCharacter(env,{tgId:id,name:'殿堂'+id,baseClass:cls,gender},T0);const listing=await H.list(env,T0);assert.equal(listing.heroes.length,2);assert.equal(listing.refreshSeconds,300);for(const h of listing.heroes){const detail=await H.get(env,h.id,T0);assert.equal(detail.hero.power,h.power);assert.equal(detail.hero.gender,h.gender);assert(detail.hero.equipment.length>0);assert(detail.hero.equipment.every(e=>e.equipped));assert(!('inventory' in detail.hero));assert(!('gold' in detail.hero));assert(!('account_tg_id' in h));}await assert.rejects(H.get(env,'missing',T0),e=>e.code==='not_found');});

test('hero hall ranks by level before power, and uses power only for equal levels',async()=>{
 const env={DB:freshDb()};
 for(const id of ['111','222','333'])await P.createCharacter(env,{tgId:id,name:'排行'+id,gender:'f',baseClass:'sword'},T0,()=>.5);
 await env.DB.prepare('UPDATE rpg_characters SET level=CASE tg_id WHEN ? THEN 50 ELSE 51 END').bind('111').run();
 await env.DB.prepare('UPDATE rpg_equipment SET base_stat=99999 WHERE tg_id=?').bind('111').run();
 await env.DB.prepare('UPDATE rpg_equipment SET base_stat=1000 WHERE tg_id=?').bind('222').run();
 const result=await H.list(env,T0);
 assert.deepEqual(result.heroes.map(h=>h.id),['222','333','111']);
 assert.ok(result.heroes[2].power>result.heroes[0].power,'lower-level player is stronger but still ranks below higher levels');
});
