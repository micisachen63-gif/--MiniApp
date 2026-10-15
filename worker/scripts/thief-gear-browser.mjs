// Real Mini App renderer with clearly marked local equipment/catalogue fixtures. No messages or player writes.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
import {createThiefPreview} from './thief-preview.mjs';import {gearOffers,makeGear} from '../src/game/gear.js';import {equipmentView} from '../src/views.js';import {THIEF_SKILLS} from '../src/game/thief-skills.js';import {eligible} from '../src/game/special.js';import {thiefGearArt,thiefGearCardPhoto} from '../src/game/gear-art.js';import {T0} from '../test/helpers.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),output=path.join(root,'docs/thief/gear-art/browser-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(output,{recursive:true});
const gearOnly=process.argv.includes('--gear-only'),require=createRequire(import.meta.url),{chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const offers=new Map();for(const route of ['A','B'])for(const o of gearOffers({base_class:'thief',class_path:route,level:120}))offers.set(o.name,o);
const rows=[...offers.values()].map((o,index)=>makeGear({id:'qa-gear-'+index,tgId:'811',cls:'thief',slot:o.slot,kind:o.kind,tier:o.tier,rng:()=>.5,now:T0,forceRarity:'common'}));
for(const slot of ['weapon','helmet','armor','gloves','boots','belt','undershirt','earring','ring']){const choices=rows.filter(e=>e.slot===slot);choices[0].is_equipped=1;if(['earring','ring'].includes(slot))choices[1].is_equipped=2;}
const gearViews=rows.map(e=>equipmentView({base_class:'thief',class_path:'A',level:120,tg_id:'811'},e));
const preview=await createThiefPreview(),browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:390,height:1050}}),errors=[],badResponses=[],cases=[];
page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.url().startsWith(preview.origin)&&response.status()>=400)badResponses.push({url:response.url().slice(preview.origin.length),status:response.status()});});
await page.route('**/*',async route=>{
 const url=route.request().url();if(!url.startsWith(preview.origin))return route.abort();
 if(url.includes('/app.js?'))return route.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(path.join(root,'worker/public/app.js'),'utf8').replace('  boot();','  window.__GearQA={state:S,render,gearIcon,artSrc};\n  boot();')});
 if(!gearOnly&&url.endsWith('/app/api/expedition/me')){
  const response=await route.fetch(),data=await response.json();
  data.character={...data.character,baseClass:'thief',classPath:'B2',gender:'f',level:120,className:'幻刃使'};
  data.skills=[...(data.skills||[]).filter(s=>s.eligibleBase!=='thief'),...THIEF_SKILLS];
  data.eligible=data.skills.filter(s=>eligible({base_class:'thief',class_path:'B2',level:120},s)).map(s=>s.id);
  data.inventory={...data.inventory,research_fragment:160,...Object.fromEntries(THIEF_SKILLS.map(s=>['book_'+s.id,1]))};
  return route.fulfill({response,json:data});
 }
 return route.continue();
});
const expectedIcon=e=>thiefGearArt(e)?.iconSrc||'art/v2/'+e.art+'.webp';
async function decoded(locator){await locator.evaluateAll(images=>Promise.all(images.map(async image=>{image.loading='eager';await image.decode();})));}
try{
 await page.goto(preview.origin+'/?devTg=811');await page.locator('[data-select="811"]').click();await page.waitForFunction(()=>window.__GearQA?.state.me);
 for(const width of [390,768]){
  await page.setViewportSize({width,height:1050});
  await page.evaluate(({gearViews,books})=>{const q=__GearQA;q.state.me.equipment=gearViews;if(books){Object.assign(q.state.meta.items,Object.fromEntries(books.map(s=>['book_'+s.id,{name:s.bookType+' · '+s.name}])));Object.assign(q.state.me.inventory,Object.fromEntries(books.map(s=>['book_'+s.id,1])));}q.state.tab='bag';q.state.bagEquipSlot='all';q.render();},{gearViews,books:gearOnly?null:THIEF_SKILLS});
  const items=page.locator('.bag-equip-list>.item');assert.equal(await items.count(),130);await decoded(items.locator('.ic img'));
  const sources=await items.evaluateAll(items=>items.map(item=>({id:item.dataset.item,src:item.querySelector('.ic img')?.getAttribute('src'),width:item.querySelector('.ic img')?.naturalWidth,height:item.querySelector('.ic img')?.naturalHeight})));
  for(const item of sources){const e=gearViews.find(e=>e.id===item.id);assert.ok(item.src.split('?')[0]===expectedIcon(e),e.name+' wrong browser source '+item.src);assert.ok(item.width>0&&item.height>0);}
  await page.locator('[data-panel="wardrobe"]').click();
  await decoded(page.locator('.hero-armory .slot.has img'));assert.equal(await page.locator('.hero-armory .slot.has').count(),11);
  await page.locator('.hero-armory').screenshot({path:path.join(output,width+'-armory-11-slots.png')});
  cases.push({surface:'bag-and-armory',width,equipment:130,physicalSlots:11,correctIconSources:130,sources});
  await page.locator('[data-panel="vault"]').click();
  for(const slot of ['weapon','armor','belt','ring']){
   await page.locator('[data-bag-filter="'+slot+'"]').click();
   await page.locator('.bag-equipment').screenshot({path:path.join(output,width+'-bag-'+slot+'.png')});
   cases.push({surface:'bag-filter',slot,width,visible:await page.locator('.bag-equip-list>.item:visible').count()});
  }
 }
 if(!gearOnly){
  await page.locator('[data-panel="items"]').click();
  await decoded(page.locator('.skill-book-icon'));assert.equal(await page.locator('.skill-book-icon').count(),6);
  await page.locator('[data-tab="home"]').click({force:true});await page.evaluate(()=>{window.Telegram={WebApp:{initData:'thief-local-ui-fixture'}};RpgExpeditionOpen('skills');});
  const handle=await page.locator('#expedition-overlay iframe').elementHandle(),frame=await handle.contentFrame();
  await frame.locator('.skill-card').first().waitFor();assert.equal(await frame.locator('.skill-card').count(),6,'authoritative thief catalogue must replace the legacy static list');
  await decoded(frame.locator('.skill-card img'));await frame.locator('.skill-grid').screenshot({path:path.join(output,'study-six-thief-books.png')});
  for(const [filter,count] of [['available',3],['learned',0],['all',6]]){await frame.locator('[data-filter="'+filter+'"]').click();assert.equal(await frame.locator('.skill-card').count(),count);cases.push({surface:'study-filter',filter,count});}
  await frame.locator('#scope').selectOption('all');assert.equal(await frame.locator('.skill-card').count(),60);await frame.locator('#scope').selectOption('own');assert.equal(await frame.locator('.skill-card').count(),6);
  await frame.locator('#skill-search').fill('鏡影');assert.equal(await frame.locator('.skill-card').count(),1);await frame.locator('#skill-search').fill('');cases.push({surface:'study-scope-and-search',all:60,own:6,search:1});
  for(const s of THIEF_SKILLS){
   await frame.locator('[data-detail="'+s.id+'"]').click();await decoded(frame.locator('#detail img'));
   const legal=s.eligiblePaths.some(p=>'B2'.startsWith(p));assert.equal(await frame.locator('[data-redeem="'+s.id+'"]').isEnabled(),legal);
   assert.equal((await frame.locator('#detail img').getAttribute('src')).split('/').at(-1),s.id+'.webp');
   if(legal){await frame.locator('[data-redeem="'+s.id+'"]').click();await frame.locator('#detail').screenshot({path:path.join(output,'research-'+s.id+'.png')});assert.ok((await frame.locator('#detail').innerText()).includes('研究碎片 '+(s.rarity==='普通'?80:160)+' 個'));}
   await frame.locator('[data-close]').click();cases.push({surface:'research-detail',skillId:s.id,legal,icon:s.id+'.webp'});
  }
  await page.locator('#expedition-overlay>header button').click();
  for(const s of THIEF_SKILLS){await page.evaluate(id=>RpgExpeditionOpen(id),s.id);const handle=await page.locator('#expedition-overlay iframe').elementHandle(),deep=await handle.contentFrame();await deep.locator('#detail h2').waitFor();assert.equal(await deep.locator('#detail h2').innerText(),s.name);await decoded(deep.locator('#detail img'));await deep.locator('#detail').screenshot({path:path.join(output,'deeplink-'+s.id+'.png')});await page.locator('#expedition-overlay>header button').click();cases.push({surface:'skill-deeplink',skillId:s.id,detailName:s.name});}
 }
 const plan=JSON.parse(fs.readFileSync(path.join(root,'docs/thief/gear-art/new-assets-plan.json'),'utf8')),cardSources=[];
 for(const group of plan.classDesignGroups){
  const id=Object.values(group.tierKeys)[0],item=plan.entries.find(e=>e.key===id);
  for(const rarity of ['common','advanced','epic','legendary','supreme','relic']){
   const src=item.cardPattern.replace('worker/public/','/').replace('{rarity}',rarity);
   const decoded=await page.evaluate(src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve({src,width:i.naturalWidth,height:i.naturalHeight});i.onerror=()=>reject(Error('card load failed '+src));i.src=src;}),src);
   assert.equal(decoded.width,480);assert.equal(decoded.height,480);cardSources.push(decoded);
  }
 }
 const sample=cardSources.filter(e=>e.src.includes('laurel_dagger_'));
 await page.evaluate(sources=>{const host=document.createElement('section');host.id='qa-share-card-preview';host.style='position:relative;padding:20px;background:#151827;display:grid;grid-template-columns:repeat(3,240px);gap:8px;width:max-content';for(const s of sources){const image=new Image();image.src=s.src;image.style='width:240px;height:240px';host.append(image);}document.body.append(host);},sample);
 await decoded(page.locator('#qa-share-card-preview img'));await page.locator('#qa-share-card-preview').screenshot({path:path.join(output,'derived-share-cards-six-rarities.png')});
 cases.push({surface:'static-share-card-http-decode',cards:cardSources.length,sources:cardSources,telegramMessagesSent:0});
 assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);
 const report={passed:true,actualAppBootstrap:true,gearOnly,productionWrites:false,telegramMessagesSent:0,injectedEquipmentViewsFromRealPureRules:true,skillCatalogueFixtureOverride:!gearOnly,productReleaseReady:false,cases,errors,badResponses,sourceSHA256:Object.fromEntries(['worker/public/app.js','worker/public/thief-gear-art.js','worker/public/expedition/live.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]))};
 fs.writeFileSync(path.join(output,'verified.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,cases:cases.length,output:path.relative(root,output).replaceAll('\\','/')}));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,cases,errors,badResponses},null,2));throw error;}finally{await browser.close();await preview.close();}

