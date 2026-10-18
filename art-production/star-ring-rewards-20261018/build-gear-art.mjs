import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const src=path.join(root,'art-production/star-ring-rewards-20261018');
const out=path.join(root,'worker/public/art/star-ring-rewards-20261018');
await fs.mkdir(out,{recursive:true});
const jobs=[
 ['weapon','exec-9751e77f-7a76-4b85-b470-25e9ea7a867d.png'],
 ['armor','exec-6f3bcc98-c1b1-4166-8bc5-99225c6dcb30.png'],
 ['accessory','exec-1e43b04f-0677-4e14-9ba1-5a0672051447.png'],
 ['weapon-mage','exec-c36c556a-14f4-46a3-b723-c84f4beb79e8.png'],
 ['weapon-archer','exec-3e2d268a-ec27-4018-8aef-d3e8c6af8439.png'],
 ['weapon-thief','exec-b1e0e81d-804a-4240-8bf1-b2805db13b5c.png']
];
const qa=[];
for(const [name,file] of jobs){
 const original=path.join(src,name+'-original.png');
 const output=path.join(out,'gear-'+name+'.webp');
 await sharp(original).resize(432,432,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).extend({top:40,bottom:40,left:40,right:40,background:{r:0,g:0,b:0,alpha:0}}).webp({quality:94,alphaQuality:100,effort:6}).toFile(output);
 const buf=await fs.readFile(output);
 const {data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let transparent=0,partial=0,minX=512,minY=512,maxX=-1,maxY=-1,edgeAlpha=0;
 for(let y=0;y<512;y++)for(let x=0;x<512;x++){
  const a=data[(y*512+x)*4+3];
  if(a===0)transparent++;else {if(a<255)partial++; minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  if(x===0||y===0||x===511||y===511)edgeAlpha=Math.max(edgeAlpha,a);
 }
 const entry={name,path:path.relative(root,output).replaceAll('\\','/'),bytes:buf.length,width:info.width,height:info.height,hasAlpha:true,transparentPixels:transparent,partialAlphaPixels:partial,alphaBounds:{minX,minY,maxX,maxY},edgeAlpha,sha256:crypto.createHash('sha256').update(buf).digest('hex'),sourceSha256:crypto.createHash('sha256').update(await fs.readFile(original)).digest('hex')};
 if(info.width!==512||info.height!==512||!transparent||edgeAlpha)throw new Error('Invalid alpha/padding '+name);
 qa.push(entry);
}
await fs.writeFile(path.join(src,'gear-art-qa.json'),JSON.stringify({date:'2026-10-18',generator:'builtin image_gen',assets:qa},null,2)+'\n');
console.log(JSON.stringify(qa,null,2));

