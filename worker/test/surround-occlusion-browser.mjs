// Near-opaque character pixels may differ only by their source transparency plus 2 RGB rounding levels.
import {createRequire} from 'node:module';import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const {chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')),root=path.resolve('worker/public'),folder='.release-sync/outside-pixels',errors=[],cases=[];await fs.mkdir(folder,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const f=path.join(root,new URL(req.url,'http://local').pathname);res.setHeader('Content-Type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'image/webp');res.end(await fs.readFile(f));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:2000}});page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/preview-star-ring-surround.html');
  // Keep the character raster surface stable when the effect is hidden for comparison.
  await page.addStyleTag({content:'.fig>img{will-change:transform}'});
  for(let gender=0;gender<2;gender++){if(gender)await page.locator('[data-gender]').click();for(const tone of ['dawn','moon','eclipse']){await page.locator('[data-tone="'+tone+'"]').click();await page.waitForFunction(()=>document.querySelectorAll('.hero-size-normalized').length===4);await page.waitForTimeout(140);await page.evaluate(async()=>{document.getAnimations().forEach(a=>{a.pause();a.currentTime=1700;});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
   for(let i=0;i<4;i++){const fig=page.locator('.gallery .fig').nth(i),name=width+'-'+gender+'-'+tone+'-'+i;await fig.scrollIntoViewIfNeeded();await page.waitForTimeout(60);const box=await fig.boundingBox(),scroll=await page.evaluate(()=>({x:scrollX,y:scrollY})),clip={x:Math.floor(box.x+scroll.x),y:Math.floor(box.y+scroll.y),width:Math.ceil(box.x+box.width+scroll.x)-Math.floor(box.x+scroll.x),height:Math.ceil(box.y+box.height+scroll.y)-Math.floor(box.y+scroll.y)};
    const mask=await fig.evaluate((n,clip)=>{const img=n.querySelector('img'),c=n.getBoundingClientRect(),r=img.getBoundingClientRect(),canvas=document.createElement('canvas');canvas.width=clip.width;canvas.height=clip.height;canvas.getContext('2d').drawImage(img,r.left+scrollX-clip.x,r.top+scrollY-clip.y,r.width,r.height);return canvas.toDataURL();},clip);await fs.writeFile(folder+'/'+name+'-mask.png',Buffer.from(mask.split(',')[1],'base64'));
    await page.screenshot({clip,captureBeyondViewport:true,path:folder+'/'+name+'-on.png'});await fig.locator('.star-ring-aura').evaluate(n=>n.style.visibility='hidden');await page.screenshot({clip,captureBeyondViewport:true,path:folder+'/'+name+'-off.png'});await fig.locator('.star-ring-aura').evaluate(n=>n.style.visibility='');cases.push(name);
   }
  }}await page.close();
 }
 assert.deepEqual(errors,[]);await fs.writeFile(folder+'/cases.json',JSON.stringify(cases));
 const python=process.env.RPG_PYTHON||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'),result=spawnSync(python,['-c',`from PIL import Image,ImageFilter,ImageChops
from pathlib import Path
import json
p=Path('${folder}'); reports=[]
for name in json.loads((p/'cases.json').read_text()):
 a=Image.open(p/(name+'-on.png')).convert('RGB'); b=Image.open(p/(name+'-off.png')).convert('RGB'); mask=Image.open(p/(name+'-mask.png')).getchannel('A').filter(ImageFilter.MinFilter(5)); assert a.size==b.size==mask.size,(name,a.size,b.size,mask.size)
 d=ImageChops.difference(a,b); rgb=list(d.get_flattened_data()); alpha=list(mask.get_flattened_data()); valid=[i for i,v in enumerate(alpha) if v>=250]; assert len(valid)>300,(name,len(valid)); peak=max(max(rgb[i]) for i in valid); changed=sum(max(rgb[i])>255-alpha[i]+2 for i in valid); assert changed==0,(name,peak,changed,len(valid)); reports.append(dict(case=name,nearOpaquePixels=len(valid),maximumDifference=peak))
(p/'results.json').write_text(json.dumps(dict(cases=len(reports),nearOpaquePixels=sum(r['nearOpaquePixels'] for r in reports),pixelsExceedingTransparencyBound=0,reports=reports),indent=2));print(json.dumps(dict(cases=len(reports),nearOpaquePixels=sum(r['nearOpaquePixels'] for r in reports),pixelsExceedingTransparencyBound=0)))`],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr||result.stdout);console.log(result.stdout.trim());
}finally{await browser.close();await new Promise(r=>server.close(r));}
