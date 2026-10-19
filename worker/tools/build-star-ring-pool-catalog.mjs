import {writeFile,mkdir} from 'node:fs/promises';
import {encounterPool} from '../src/game/star-ring.js';
const base=new URL('../public/art/star-ring-pools-20261019/',import.meta.url);
await mkdir(base,{recursive:true});
const maps=Array.from({length:12},(_,hourIndex)=>({hourIndex,monsters:encounterPool(hourIndex).map(e=>({...e,artUrl:e.artUrl||`/art/star-ring-20261018/monster-${String(e.artIndex).padStart(2,'0')}.webp`}))}));
await writeFile(new URL('catalog.json',base),JSON.stringify({schema:1,engineVersion:2,maps},null,2)+'\n');
