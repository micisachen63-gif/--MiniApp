import fs from 'node:fs';import {telegramPhoto} from './telegram-media.mjs';
const out='../爆分監控/deploy-staging/elf-rpg-20261008-v051/worker/public/telegram-media';fs.mkdirSync(out,{recursive:true});
for(let i=1;i<=12;i++){const b=fs.readFileSync('../爆分監控/art-runtime/rpg-boss/boss-'+i+'.png');fs.writeFileSync(out+'/boss-'+i+'.jpg',telegramPhoto(b)||b);}
fs.copyFileSync('assets/group-welcome.jpg',out+'/welcome.jpg');console.log('12 real boss cards and welcome image prepared for direct Telegram fetch');
