import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),tests=join(root,'test');mkdirSync(tests,{recursive:true});
for(const file of ['rpg-delivery.test.js','rpg-journal.test.js','rpg-showcase.test.js','rpg-blessed-delivery.test.js','rpg-boss-loot-caption.test.js']){
 const source=readFileSync(join('C:/Users/User/Documents/ChatGPT/爆分監控/test',file),'utf8').replaceAll("'../src/rpg-flow.js'","'../rpg-flow.js'");
 writeFileSync(join(tests,file),source);
}
console.log('Copied five existing pure mock regressions against the cloud adapter.');
