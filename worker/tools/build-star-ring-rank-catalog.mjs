import {writeFile} from 'node:fs/promises';
import {ENGINE_VERSION,RANK_REWARDS,SHOP,CORE} from '../src/game/star-ring.js';
await writeFile(new URL('../public/star-ring-rank-rewards.json',import.meta.url),JSON.stringify({engineVersion:ENGINE_VERSION,policy:RANK_REWARDS,coreOffers:SHOP.filter(o=>o.currency===CORE)},null,2)+'\n');
