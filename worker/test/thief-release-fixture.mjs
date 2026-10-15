// Test-only module-loader override. Never modifies thief-data.js or a remote environment.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import fs from 'node:fs';
const releaseReady=process.argv[2]==='true';
registerHooks({load(url,context,nextLoad){const result=nextLoad(url,context);if(url.endsWith('/worker/src/game/thief-data.js')){const source=String(result.source);assert.match(source,/export const THIEF_RELEASE_READY = (?:true|false);/);return {...result,source:source.replace(/export const THIEF_RELEASE_READY = (?:true|false);/,'export const THIEF_RELEASE_READY = '+releaseReady+';')};}return result;}});
const [{freshDb},{T0},{THIEF_RELEASE_READY,THIEF_PATHS},{THIEF_SKILLS},{SPECIAL_SKILLS,LEGACY_SPECIAL_SKILLS,BOOK_ITEMS},Catalog,Special,Party,Player,Trade,DB,Rules,Constants,Stats]=await Promise.all([
 import('./d1-shim.js'),import('./helpers.js'),import('../src/game/thief-data.js'),import('../src/game/thief-skills.js'),import('../src/game/special-data.js'),import('../src/game/thief-skill-catalog.js'),import('../src/services/special.js'),import('../src/services/party.js'),import('../src/services/player.js'),import('../src/services/trade.js'),import('../src/db.js'),import('../src/game/special.js'),import('../src/game/constants.js'),import('../src/game/stats.js')
]);
assert.equal(THIEF_RELEASE_READY,releaseReady);
assert.equal(SPECIAL_SKILLS.length,54+(releaseReady?6:0));
const results=[],legacyChecks=[];
for(const base of ['sword','archer','mage'])for(const d of Party.DUNGEONS.filter(d=>!d.trial)){
 const expected=LEGACY_SPECIAL_SKILLS.filter(s=>d.skillLevels.includes(s.level)),actual=Catalog.dungeonSkillPool(SPECIAL_SKILLS,d.skillLevels,{base_class:base,class_path:'A111',level:120});
 assert.equal(JSON.stringify(actual),JSON.stringify(expected));legacyChecks.push({base,dungeon:d.id,count:actual.length,SHA:JSON.stringify(actual)});
}
let count=0;const request=()=>('thief-pipeline-'+(++count));
async function setup(route='A1'){
 const env={DB:freshDb()};
 // The fresh initializer must satisfy the real constraints in both release-gate states.
 assert.equal(env.DB.sqlite.prepare('PRAGMA ignore_check_constraints').get().ignore_check_constraints,0);
 for(const id of ['111','222','333']){
  const base=id==='333'?'sword':releaseReady?'thief':'sword';
  await Player.createCharacter(env,{tgId:id,name:'測試'+id,gender:'f',baseClass:base},T0);
  await env.DB.prepare('UPDATE rpg_characters SET level=120,class_path=?,base_class=?,auto_blue=0,auto_red_pct=20 WHERE tg_id=?').bind(id==='333'?'B1':route,id==='333'?'sword':'thief',id).run();
  const p=await DB.loadPlayer(env.DB,id),s=Stats.computeStats(p.char,p.equipment);
  await env.DB.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').bind(s.maxHp,s.maxMp,id).run();
 }
 return env;
}
const call=(env,tg,b,now=T0)=>Special.action(env,tg,{...b,requestId:request()},now);
if(!releaseReady){
 const env=await setup();
 for(const book of THIEF_SKILLS){
  assert.equal(Rules.SKILL_MAP[book.id],undefined);assert.equal(BOOK_ITEMS['book_'+book.id],undefined);assert.equal(Constants.ITEMS['book_'+book.id],undefined);
  assert.ok(!Constants.TRADE.tradeableItems.includes('book_'+book.id));
  await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,1)').bind('111','book_'+book.id).run();
  await assert.rejects(call(env,'111',{op:'learn',skillId:book.id}),e=>e.code==='skill');
  await assert.rejects(call(env,'111',{op:'redeem',skillId:book.id}),e=>e.code==='skill');
  await assert.rejects(call(env,'111',{op:'loadout',loadout:[book.id]}),e=>e.code==='loadout');
  await assert.rejects(call(env,'111',{op:'cast',skillId:book.id}),e=>e.code==='skill');
  await assert.rejects(Special.share(env,'111',{skillId:book.id,requestId:request()},T0),e=>e.code==='book');
  await assert.rejects(Special.tradeBook(env,'111',{skillId:book.id,target:{name:'測試222'},requestId:request()},T0),e=>e.code==='book');
  results.push({skillId:book.id,published:false,learnBlocked:true,redeemBlocked:true,loadoutBlocked:true,castBlocked:true,shareBlocked:true,tradeBlocked:true});
 }
 env.DB.sqlite.close();
}else{
 // Deterministically exercise the existing 35% reward path and a known legal book index.
 const realCrypto=globalThis.crypto;
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:{randomUUID:realCrypto.randomUUID.bind(realCrypto),getRandomValues(array){array.fill(0);return array;}}});
 for(const book of THIEF_SKILLS){
  assert.equal(Rules.SKILL_MAP[book.id]?.id,book.id);assert.equal(BOOK_ITEMS['book_'+book.id]?.skillId,book.id);
  assert.equal(Constants.ITEMS['book_'+book.id]?.kind,'skill_book');assert.ok(Constants.TRADE.tradeableItems.includes('book_'+book.id));
  for(const route of THIEF_PATHS){
   const c={base_class:'thief',class_path:route,level:120},legal=Rules.eligible(c,book);
   assert.equal(Catalog.dungeonSkillPool(SPECIAL_SKILLS,[book.level],c).some(s=>s.id===book.id),legal);
  }
  const env=await setup(book.eligiblePaths[0]),cost=book.rarity==='普通'?80:160;
  await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').bind('111','research_fragment',cost).run();
  await env.DB.prepare('UPDATE rpg_characters SET level=? WHERE tg_id=?').bind(book.level-1,'111').run();
  await assert.rejects(call(env,'111',{op:'redeem',skillId:book.id}),e=>e.code==='skill');
  await env.DB.prepare('UPDATE rpg_characters SET level=120 WHERE tg_id=?').bind('111').run();
  const redeemed=await call(env,'111',{op:'redeem',skillId:book.id});assert.equal(redeemed.inventory.research_fragment,0);assert.equal(redeemed.inventory['book_'+book.id],1);
  await Special.share(env,'111',{skillId:book.id,requestId:request()},T0);
  const learned=await call(env,'111',{op:'learn',skillId:book.id});assert.ok(learned.special.learned.includes(book.id));assert.equal(learned.inventory['book_'+book.id],0);
  await assert.rejects(call(env,'111',{op:'learn',skillId:book.id}),e=>e.code==='learned');
  await call(env,'111',{op:'loadout',loadout:[book.id]});
  const dungeonId=book.level===30?'pillar':book.level===40?'aegean':'forge';
  const made=await Party.create(env,'111',{kind:'dungeon',dungeonId},T0),partyId=made.party.id;
  for(const tg of ['222','333'])await Party.action(env,tg,{partyId,op:'join',requestId:request()},T0);
  for(const tg of ['111','222','333'])await Party.action(env,tg,{partyId,op:'ready',requestId:request()},T0);
  await Party.action(env,'111',{partyId,op:'start',requestId:request()},T0);
  let now=T0,p,event;
  for(let i=0;i<40;i++){
   p=await Party.view(env,partyId,'111',now);if(p.status!=='combat')break;
   for(const tg of ['111','222','333'])await Party.action(env,tg,{partyId,op:'submit',skillId:i===0&&tg==='111'?book.id:'attack',round:p.round,requestId:request()},now);
   now+=30000;
   const after=await Party.view(env,partyId,'111',now);
   if(i===0){event=after.battleTurn.events.find(e=>e.actorId==='111');assert.equal(event.skillId,book.id);assert.equal(event.spentMp,book.mp);assert.ok(Number.isFinite(event.damage));}
  }
  p=await Party.view(env,partyId,'111',now);assert.equal(p.status,'won');
  const reward=await Party.reward(env,'111',{partyId,requestId:request()},now),again=await Party.reward(env,'111',{partyId,requestId:request()},now);
  assert.deepEqual(again.reward,reward.reward);assert.equal(reward.reward.items.research_fragment,8);assert.equal(reward.reward.items['book_'+book.id],1);
  const beforeTrade=(await DB.loadPlayer(env.DB,'222')).inv['book_'+book.id]||0;
  const trade=await Special.tradeBook(env,'111',{skillId:book.id,target:{name:'測試222'},requestId:request()},now);
  assert.equal(trade.trade.a.lines[0].ref,'book_'+book.id);
  for(const tgId of ['111','222'])await Trade.lock(env,{tgId,tradeId:trade.tradeId,requestId:request()},now);
  for(const tgId of ['111','222'])await Trade.confirm(env,{tgId,tradeId:trade.tradeId,requestId:request()},now);
  assert.equal((await DB.loadPlayer(env.DB,'111')).inv['book_'+book.id]||0,0);
  assert.equal((await DB.loadPlayer(env.DB,'222')).inv['book_'+book.id],beforeTrade+1);
  const castAt=now+300000,owner=await DB.loadPlayer(env.DB,'111'),stats=Stats.computeStats(owner.char,owner.equipment);
  await env.DB.prepare("UPDATE rpg_characters SET hp=?,mp=?,last_settle_at=?,idle_state='fighting' WHERE tg_id=?").bind(stats.maxHp,stats.maxMp,castAt,'111').run();
  const pending=await call(env,'111',{op:'cast',skillId:book.id},castAt);assert.equal(pending.special.pending,book.id);
  const cast=await Special.view(env,'111',castAt+60000);assert.equal(cast.special.pending,undefined);assert.ok(cast.special.cooldowns[book.id]>castAt+60000);assert.ok(cast.character.mp<pending.character.mp);
  const outbox=(await env.DB.prepare("SELECT payload_json FROM rpg_outbox WHERE kind='skill_book'").all()).results;
  assert.ok(outbox.some(row=>JSON.parse(row.payload_json).skill.id===book.id));
  results.push({skillId:book.id,level:book.level,path:book.eligiblePaths[0],redeemCost:cost,dungeon:dungeonId,researchPerRun:8,dropBook:book.id,dropCount:1,duplicateRewardStable:true,learnConsumesOne:true,loadout:true,partyCast:{skillId:event.skillId,spentMp:event.spentMp,damage:event.damage},idleCast:true,shareOutbox:true,tradeTransferredExactlyOne:true});
  env.DB.sqlite.close();
 }
}
const report={passed:true,releaseReadyUnderTest:releaseReady,overrideMethod:'test-only Node module load hook for both release states; no file changes',productionWrites:false,isolatedInMemoryFixture:true,legacyPoolByteEquality:true,legacyPoolChecks:legacyChecks.length,dropChance:.35,researchPerRun:8,bookQuantity:1,skills:results};
// The standard suite is read-only with respect to tracked acceptance evidence.
// A deliberate acceptance run may opt in to writing a separate report path.
if(process.env.THIEF_PIPELINE_REPORT)fs.writeFileSync(process.env.THIEF_PIPELINE_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,releaseReady,skills:results.length,legacyPoolChecks:legacyChecks.length}));

