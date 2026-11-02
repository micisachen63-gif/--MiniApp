// Build art/encounter candidates only. No game balance or player data changes.
import fs from 'node:fs/promises';import path from 'node:path';
const options=Object.fromEntries(process.argv.slice(2).map(a=>{const m=/^--(art-root|grok-root)=(.+)$/.exec(a);if(!m)throw Error('Use --art-root=... --grok-root=...');return[m[1],m[2]];}));
if(!options['art-root']||!options['grok-root'])throw Error('Both asset roots are required');
const artRoot=path.resolve(options['art-root']),grokRoot=path.resolve(options['grok-root']);
const managed=path.resolve('worker/art-production/progression-maps-20261102'),preview=path.join(grokRoot,'ui-generated-20261030/progression-maps-20261102');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const catalog=await read(path.join(artRoot,'map-catalog-draft.json')),review=await read('worker/public/monster-expansion-review-data.json');
const sourceMaps=new Map(),monsters=new Map();
for(let n=1;n<=12;n++){
 const meta=await read(path.join(grokRoot,`map${n}/meta.json`)),ids=Object.keys(meta).filter(k=>k.endsWith('_idle')).map(k=>k.slice(0,-5));
 const rows=review.items.filter(r=>r.map===n),matched=new Set(),named=new Map();
 for(const row of rows){const id=row.key.replace(/^(mon|elite|boss)_/,'').replace(/^x13_m\d+_/,'');if(ids.includes(id)){named.set(id,row);matched.add(row.key);}}
 const remainingIds=ids.filter(id=>!named.has(id));
 for(const row of rows.filter(r=>!matched.has(r.key))){let index;if(row.role==='boss')index=remainingIds.length-1;else index=0;const id=remainingIds.splice(index,1)[0];if(!id)throw Error(`Missing monster name ${row.key}`);named.set(id,row);}
 if(named.size!==15)throw Error(`Map ${n} does not have 15 named monsters`);
 const list=[];
 for(const id of ids){const row=named.get(id),animations={};for(const action of ['idle','walk','attack','death']){
   const m=meta[`${id}_${action}`];if(!m?.file||!m.cellW||!m.cellH||!m.frames)throw Error(`Missing animation ${id} ${action}`);
   const file=path.resolve(grokRoot,`map${n}`,m.file),rel=path.relative(path.join(grokRoot,`map${n}`),file);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Invalid monster source');await fs.access(file);
   const heights=(m.frameInfo||[]).map(f=>Number(f.h)).filter(h=>h>0&&Number.isFinite(h));
   animations[`${id}_${action}`]={file:`/map${n}/${m.file}`,cw:m.cellW,ch:m.cellH,frames:m.frames,ox:m.ox??.5,oy:m.oy??.92,body:heights.length?heights.reduce((a,b)=>a+b,0)/heights.length:m.cellH*.78,facing:m.facing||'right'};
  }
  const monster={id,name:row.name,role:row.role,map:n,animations};monsters.set(id,monster);list.push(monster);
 }
 sourceMaps.set(n,list);
}
const modes=['elite','expert','nightmare','hell'];
const primary={elite:[2,1,2,4,5,6,8,9,10,11,12,10],expert:[12,1,2,4,5,6,7,8,9,10,12,2],nightmare:[7,1,2,4,5,6,7,8,9,10,11,12],hell:[6,1,2,4,5,6,7,8,9,10,12,12]};
const secondary=[11,3,8,7,2,9,12,3,6,12,8,10];
const manifest=[];
await fs.mkdir(path.join(managed,'maps'),{recursive:true});await fs.mkdir(path.join(preview,'maps'),{recursive:true});await fs.mkdir(path.join(preview,'encounters'),{recursive:true});await fs.mkdir(path.join(preview,'fx'),{recursive:true});
for(const row of catalog.maps){
 const rank=modes.indexOf(row.mode),a=sourceMaps.get(primary[row.mode][row.chapter-1]),b=sourceMaps.get(secondary[row.chapter-1]);
 const na=a.filter(m=>m.role==='normal'),nb=b.filter(m=>m.role==='normal');
 const rotate=(list,n)=>[...list.slice(n%list.length),...list.slice(0,n%list.length)];
 const ordinary=[...new Set([...rotate(na,rank*2).slice(0,4),...rotate(nb,rank+row.chapter).slice(0,2)].map(m=>m.id))];
 if(ordinary.length<4)throw Error('Not enough ordinary monsters');
 const elite=a.filter(m=>m.role==='elite')[rank%3];let boss=a.filter(m=>m.role==='boss')[rank%2];
 // Historical source ordering contains a forest boss in the forge and an ice
 // queen in astral areas. Select a thematically correct existing asset by ID.
 if(boss.id==='rotten_tree_king')boss=monsters.get('lava_colossus');
 if(boss.id==='frost_dragon_queen'&&!(row.mode==='expert'&&row.chapter===1))boss=monsters.get('void_meteor_dragon_emperor');
 const selected=[...ordinary.map(id=>monsters.get(id)),elite,boss],metadata=Object.assign({},...selected.map(m=>m.animations));
 const id=`${row.mode}-${String(row.chapter).padStart(2,'0')}`,record={id,mode:row.mode,modeName:row.modeName,chapter:row.chapter,name:row.name,levelMin:row.totalLevelMin,levelMax:row.totalLevelMax,background:`/ui-generated-20261030/progression-maps-20261102/${row.proposedAsset}`,metadata:`/ui-generated-20261030/progression-maps-20261102/encounters/${id}.json`,ordinary,elite:elite.id,boss:boss.id,names:Object.fromEntries(selected.map(m=>[m.id,`${row.modeName} · ${m.name}`])),sources:selected.map(m=>({id:m.id,name:m.name,role:m.role,sourceMap:m.map})),aura:`/ui-generated-20261030/progression-maps-20261102/fx/${row.mode}-aura-v1.png`,status:'visual-preview-only; not balance configuration'};
 manifest.push(record);
 await fs.copyFile(path.join(artRoot,row.proposedAsset),path.join(managed,row.proposedAsset));await fs.copyFile(path.join(artRoot,row.proposedAsset),path.join(preview,row.proposedAsset));
 await fs.writeFile(path.join(preview,`encounters/${id}.json`),JSON.stringify(metadata));
}
for(const mode of modes)await fs.copyFile(path.join(artRoot,`fx/${mode}-aura-v1.png`),path.join(preview,`fx/${mode}-aura-v1.png`));
const data={status:'local visual preview; NOT production rules',productionDeployed:false,levelsPerMap:10,maps:manifest,sourceMonsterCount:monsters.size};
await fs.writeFile(path.join(managed,'catalog.json'),JSON.stringify(data,null,2));await fs.writeFile(path.join(preview,'catalog.json'),JSON.stringify(data));
for(const name of ['map-asset-provenance.json','map-44-asset-provenance.json'])await fs.copyFile(path.join(artRoot,name),path.join(managed,name));
const script=`/* Local candidate catalog. Invalid IDs never select arbitrary assets. */\n(()=>{const maps=${JSON.stringify(manifest)};let id;try{id=new URLSearchParams(parent.location.search).get('map');}catch{}const selected=maps.find(m=>m.id===id)||null;window.RpgSceneEncounter={maps,selected};if(selected)document.addEventListener('DOMContentLoaded',()=>{const zone=document.querySelector('#zone b'),level=document.querySelector('#zone span');if(zone)zone.textContent=selected.name;if(level)level.textContent=selected.modeName+' · Lv.'+selected.levelMin+'–'+selected.levelMax+'（美術預覽）';});})();\n`;
await fs.writeFile(path.join(preview,'encounter-catalog.js'),script);
console.log(JSON.stringify({maps:manifest.length,monsterCount:monsters.size,animationBindings:manifest.reduce((n,m)=>n+m.sources.length*4,0),managed,preview}));
