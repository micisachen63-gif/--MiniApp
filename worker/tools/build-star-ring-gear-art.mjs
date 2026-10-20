// Offline asset export only. No game data, runtime dependency or paid API.
// Set RPG_ART_NODE_MODULES to a local folder containing sharp and @napi-rs/canvas.
import {fileURLToPath} from 'node:url';import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {STAR_RING_ART_IDS} from '../public/star-ring-gear-art.js';
const require=createRequire(import.meta.url),modules=process.env.RPG_ART_NODE_MODULES;
const sharp=require(modules?path.join(modules,'sharp'):'sharp'),{createCanvas,loadImage,GlobalFonts}=require(modules?path.join(modules,'@napi-rs/canvas'):'@napi-rs/canvas');
if(process.env.RPG_ART_FONT)GlobalFonts.registerFromPath(process.env.RPG_ART_FONT,'GameTC');
const root=fileURLToPath(new URL('../../',import.meta.url)),sources=path.resolve(process.argv.find(a=>a.startsWith('--sources='))?.slice(10)||path.join(root,'.release-sync/ring-art-sources'));
const out=path.join(root,'worker/public/art/star-ring-gear-20261020'),qa=path.join(root,'docs/art');await fs.mkdir(path.join(out,'cards'),{recursive:true});await fs.mkdir(qa,{recursive:true});
const reused={'weapon-sword':'gear-weapon.webp','weapon-staff':'gear-weapon-mage.webp','weapon-longbow':'gear-weapon-archer.webp','weapon-dual_daggers':'gear-weapon-thief.webp'};
const classNames={sword:'劍士',mage:'法師',archer:'弓手',thief:'盜賊',shared:'共用'},slotNames={helmet:'頭盔',armor:'胸甲',gloves:'手套',boots:'靴子',belt:'腰帶',undershirt:'內衣',earring:'耳飾',ring:'戒指'},weaponNames={sword:'單手劍',greatsword:'雙手巨劍',sword_shield:'劍盾',staff:'法杖',elem_staff:'元素法杖',wand:'魔導書',longbow:'長弓',compound_bow:'複合弓',crossbow:'十字弩',dagger:'短匕首',dual_daggers:'雙匕首',throwing_blades:'投擲刃'};
const rarities={common:['一般','#c8ccd6'],advanced:['高級','#2ed573'],epic:['極品','#1e90ff'],legendary:['傳說','#b68aff'],supreme:['霸主','#ff6676'],relic:['遺物','#efcf82']};
const hash=b=>createHash('sha256').update(b).digest('hex'),records=[];
for(const id of STAR_RING_ART_IDS){
 const source=reused[id]?path.join(root,'worker/public/art/star-ring-rewards-20261018',reused[id]):path.join(sources,id+'.png'),original=await fs.readFile(source);
 const {data,info}=await sharp(original).ensureAlpha().raw().toBuffer({resolveWithObject:true});let left=info.width,top=info.height,right=-1,bottom=-1,transparent=0,border=0;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const a=data[(y*info.width+x)*4+3];if(a<9)transparent++;if(a>=16){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);if(x===0||y===0||x===info.width-1||y===info.height-1)border++;}}
 assert.ok(transparent/(info.width*info.height)>.1,id+' needs transparent alpha');assert.ok(right>left&&bottom>top,id+' is empty');
 const normalized=await sharp(original).extract({left,top,width:right-left+1,height:bottom-top+1}).resize(448,448,{fit:'inside'}).png().toBuffer(),size=await sharp(normalized).metadata();
 const icon=await sharp({create:{width:512,height:512,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:normalized,left:Math.floor((512-size.width)/2),top:Math.floor((512-size.height)/2)}]).webp({quality:91,alphaQuality:100,effort:6}).toBuffer();await fs.writeFile(path.join(out,id+'.webp'),icon);
 const name=id.startsWith('weapon-')?weaponNames[id.slice(7)]:classNames[id.split('-')[0]]+'·'+slotNames[id.split('-')[1]],image=await loadImage(icon),cards={};
 for(const [rarity,[label,tone]]of Object.entries(rarities)){
  const canvas=createCanvas(480,480),g=canvas.getContext('2d');g.fillStyle='#101b2d';g.fillRect(0,0,480,480);
  const gradient=g.createRadialGradient(240,190,5,240,190,270);gradient.addColorStop(0,'#23364c');gradient.addColorStop(1,'#0b1424');g.fillStyle=gradient;g.fillRect(16,16,448,448);
  g.strokeStyle='#d9bb79';g.lineWidth=3;g.strokeRect(6,6,468,468);g.lineWidth=1;g.strokeRect(20,20,440,440);g.strokeStyle=tone;g.lineWidth=3;g.strokeRect(13,13,454,454);
  g.strokeStyle='#d9bb79';g.lineWidth=2;for(const [x,y]of [[31,31],[449,31],[31,449],[449,449]]){g.beginPath();g.moveTo(x-10,y);g.lineTo(x,y-10);g.lineTo(x+10,y);g.lineTo(x,y+10);g.closePath();g.stroke();}
  g.drawImage(image,55,22,370,370);g.fillStyle='#101727';g.fillRect(42,389,396,66);g.strokeStyle='#b39457';g.lineWidth=1;g.strokeRect(42,389,396,66);g.textAlign='center';g.fillStyle='#f1dfaf';g.font='bold 22px GameTC, "Microsoft JhengHei"';g.fillText('星征·'+name,240,416);g.fillStyle=tone;g.font='bold 20px GameTC, "Microsoft JhengHei"';g.fillText(label+' · 星環遠征',240,444);
  const jpg=await canvas.encode('jpeg',92),file='cards/'+id+'_'+rarity+'.jpg';await fs.writeFile(path.join(out,file),jpg);cards[rarity]={file,sha256:hash(jpg),bytes:jpg.length};
 }
 records.push({id,name,reusedFrom:reused[id]?'art/star-ring-rewards-20261018/'+reused[id]:null,sourceSha256:hash(original),sourceSize:[info.width,info.height],sourceAlphaBounds:[left,top,right+1,bottom+1],sourceBorderPixels:border,transparentFraction:transparent/(info.width*info.height),icon:{file:id+'.webp',width:512,height:512,sha256:hash(icon),bytes:icon.length},cards});
}
const catalog=records.map(r=>({id:r.id,name:r.name,icon:'/art/star-ring-gear-20261020/'+r.icon.file,photo:'/art/star-ring-gear-20261020/'+r.cards.legendary.file}));
await fs.writeFile(path.join(out,'catalog.json'),JSON.stringify({version:1,items:catalog},null,2)+'\n');
await fs.writeFile(path.join(qa,'STAR_RING_EQUIPMENT_20261020.json'),JSON.stringify({tool:'built-in image_gen',newImages:28,reusedImages:4,technicalExport:'alpha-preserving crop, scale, padding and compression; separate generated Greek rarity frames',icons:records.length,cards:records.length*6,records},null,2)+'\n');
const sheet=createCanvas(2048,Math.ceil(records.length/8)*280),g=sheet.getContext('2d');g.fillStyle='#101b2d';g.fillRect(0,0,sheet.width,sheet.height);g.textAlign='center';g.font='bold 18px GameTC, "Microsoft JhengHei"';
for(let i=0;i<records.length;i++){const x=i%8*256,y=Math.floor(i/8)*280;g.drawImage(await loadImage(path.join(out,records[i].icon.file)),x+16,y+8,224,224);g.fillStyle='#e6cf96';g.fillText(records[i].name,x+128,y+258);}
await fs.writeFile(path.join(root,'.release-sync/ring-art-contact.png'),await sheet.encode('png'));console.log(JSON.stringify({icons:records.length,cards:records.length*6,newImages:28,reused:4,borderWarnings:records.filter(r=>r.sourceBorderPixels>0).map(r=>({id:r.id,pixels:r.sourceBorderPixels}))}));
