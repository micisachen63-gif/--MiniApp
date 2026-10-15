import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {createThiefPreview} from '../scripts/thief-preview.mjs';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),output=path.join(root,'docs/thief/pilot-ui'),preview=await createThiefPreview(),browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:390,height:1050}}),errors=[],cases=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',async route=>{const url=route.request().url();if(!url.startsWith(preview.origin))return route.abort();if(url.includes('/app.js?'))return route.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(path.join(root,'worker/public/app.js'),'utf8').replace('  boot();','  window.__ThiefQA={battle:BATTLE,state:S,pkReplay};\n  boot();')});return route.continue();});
try{
 await page.goto(preview.origin+'/?devTg=811');await page.locator('[data-select="811"]').click();
 for(const reduced of [false,true]){
  await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
  await page.evaluate(()=>{
   const actor={tgId:'811',name:'盜賊女試驗',baseClass:'thief',classPath:'',gender:'f',level:20,className:'盜賊'};
   const p={a:actor,b:{...actor,tgId:'812',name:'盜賊女同伴'},rounds:1,winner:'a',log:{initial:{hp:{a:100,b:100},mp:{a:50,b:50}},max:{a:100,b:100},maxMp:{a:50,b:50},hp:{a:100,b:70},mp:{a:46,b:50},steps:[{by:'a',skill:true,attackSpeedMultiplier:1.8,directDamage:25,periodicDamage:5,strikes:[{index:0,damage:10,beforeHp:95,afterHp:85,crit:false},{index:1,damage:15,beforeHp:85,afterHp:70,crit:false}],after:{hp:{a:100,b:70},mp:{a:46,b:50}}}]}};
   __ThiefQA.pkReplay(p);window.__PkTrace={hp:['HP 100 / 100'],damage:[],motions:[]};
   const target=document.querySelector('#pk_b');new MutationObserver(()=>{const hp=target.querySelector('.bar.hp b').textContent;if(__PkTrace.hp.at(-1)!==hp)__PkTrace.hp.push(hp);const damage=target.querySelector('.pkdmg').textContent;if(damage&&__PkTrace.damage.at(-1)!==damage)__PkTrace.damage.push(damage);}).observe(target,{childList:true,subtree:true});
   new MutationObserver(()=>{const actor=document.querySelector('#pk_a');if(actor?.classList.contains('atk'))__PkTrace.motions.push(performance.now());}).observe(document.querySelector('#pk_a'),{attributes:true,attributeFilter:['class']});
  });
  await page.waitForFunction(()=>document.querySelector('#pkres')?.textContent.includes('2 擊'));
  const result=await page.evaluate(()=>({...__PkTrace,result:document.querySelector('#pkres').textContent,mp:document.querySelector('#pk_a .bar.mp b').textContent}));
  assert.deepEqual(result.hp,['HP 100 / 100','HP 70 / 100']);assert.equal(result.mp,'MP 46 / 50');assert.match(result.result,/2 擊（10＋15） · 持續傷害 5/);
  if(!reduced){assert.ok(result.damage.includes('−10')&&result.damage.includes('−15'));assert.ok(result.motions.length>=2);assert.ok(Math.max(...result.motions)-Math.min(...result.motions)>=345,'350ms native poke completes before second poke');}else assert.ok(result.damage.includes('2擊'));
  await page.screenshot({path:path.join(output,'390-pk-'+(reduced?'reduced':'normal')+'.png')});cases.push({kind:reduced?'reduced':'normal',...result});await page.locator('[data-x]').last().evaluate(button=>button.click());
 }
 assert.equal(errors.length,0);fs.writeFileSync(path.join(output,'pk-actions.json'),JSON.stringify({passed:true,actualAppBootstrap:true,productionWrites:false,fixture:true,sourceSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'worker/public/app.js'))).digest('hex'),cases,errors},null,2));console.log(JSON.stringify({passed:true,cases:cases.length}));
}finally{await browser.close();await preview.close();}
