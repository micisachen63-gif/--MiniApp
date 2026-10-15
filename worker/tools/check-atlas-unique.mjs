import fs from 'fs';import {createHash} from 'crypto';
const h=d=>createHash('sha256').update(d).digest('hex');
const w={};new Function('window',fs.readFileSync('public/monster-expansion-catalog.js','utf8'))(w);
const dir='public/art/monster-expansion-20261013/';
const A=new Map(),S=new Map();let bad=0;
for(const m of w.RpgMonsterExpansionCatalog){
 const a=h(fs.readFileSync(dir+m.key+'_attack.webp')),s=h(fs.readFileSync(dir+m.key+'.webp'));
 if(a!==m.technicalQA.assetHash||s!==m.technicalQA.stillHash){bad++;console.log('MISMATCH',m.key)}
 if(A.has(a))console.log('DUP atlas',m.key,A.get(a));A.set(a,m.key);
 if(S.has(s))console.log('DUP still',m.key,S.get(s));S.set(s,m.key);
}
console.log('entries',w.RpgMonsterExpansionCatalog.length,'uniqueAtlas',A.size,'uniqueStill',S.size,'hashMismatch',bad);