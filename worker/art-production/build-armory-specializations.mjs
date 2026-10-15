import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {designs} from './armory-specializations.mjs';
import {nodeFor} from '../src/game/stats.js';

// Original vector emblems. Geometry remains transparent outside each stroke/shape.
const EMBLEMS={
 fang:'<path d="M-24-27-5-9 0 25 8-9 25-27 17 11 0 32-17 11Z"/>',
 blood:'<path d="M0-30C-5-10-19-1-19 12a19 19 0 0 0 38 0C19-1 5-10 0-30Z"/><path d="M-10 10q-3 12 8 15"/>',
 tide:'<path d="M-30 0q14-22 26-5t27 0M-30 15q14-22 26-5t27 0M-23-15q12-19 22-5t22 0"/>',
 sword:'<path d="M0-33 7-10 4 15-4 15-7-10ZM-15 17H15M0 17V32M-5 32H5"/>',
 slash:'<path d="M-28 24Q-13-7 28-29L0 6ZM-24 32Q0 10 31-4M-31 8Q-13-18 9-30"/>',
 cross:'<path d="M-6-30H6V-6H28V6H6V30H-6V6H-28V-6H-6Z"/>',
 shield:'<path d="M0-31 25-20 21 12Q14 25 0 33Q-14 25-21 12L-25-20ZM0-22V24M-17-15 0-22 17-15"/>',
 wall:'<path d="M-29 29V-25H-17V-13H-6V-25H6V-13H17V-25H29V29ZM-29 2H29M-29 17H29M-12 2V17M12 17V29M9-13V2"/>',
 thunder:'<path d="M8-33-23 6H-3L-10 34 24-10H4Z"/>',
 feather:'<path d="M-18 28Q-32-9 22-31Q32 8-18 28ZM-20 32 18-23M-16 13 4 12M-8-1 15-3M0-12 21-17"/>',
 arrow:'<path d="M0-34 13-10 3-14V29H-3V-14L-13-10ZM-3 18-14 11V23L-3 30M3 18 14 11V23L3 30"/>',
 star:'<path d="M0-32 8-9 32 0 8 9 0 32-8 9-32 0-8-9Z"/><circle r="5"/>',
 crown:'<path d="M-26-21-17 10H17L26-21 10-8 0-28-10-8ZM-17 17H17M-15 24H15"/><circle cy="-29" r="3"/>',
 wind:'<path d="M-30-13H10q19 0 13-13t-15 1M-26 1H22q18 0 8 14t-15-1M-18 18H0q14 0 10 11"/>',
 beast:'<path d="M-26-28-8-16H8L26-28 22 8 10 27H-10L-22 8ZM-17-3-7 2M17-3 7 2M-7 14 0 20 7 14M0 20V27"/>',
 leaf:'<path d="M-23 28Q-38-19 27-31Q40 17-23 28ZM-25 32 23-26M-16 17 6 17M-5 3 18 1M-7 0-11-15"/>',
 tree:'<path d="M-5 30V-7L-26-18M5 30V-7L26-18M0-3V-30M0-17-12-29M0-13 14-27M-5 18-23 30M5 18 23 30M-7 5-27 8M7 5 27 8"/>',
 moon:'<path d="M12-30A31 31 0 1 0 16 28C-15 27-22-16 12-30Z"/><path d="m21-10 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/>',
 thorn:'<path d="M-20 30Q20 12-9-3T13-30M-15 22-31 15-21 7M1 10 23 8 14-4M-9-6-26-17-10-21M4-23 25-27 19-13"/>',
 sun:'<circle r="17"/><path d="M0-33V-23M0 23V33M-33 0H-23M23 0H33M-24-24-17-17M17 17 24 24M24-24 17-17M-17 17-24 24"/>',
 flame:'<path d="M3-34C17-11-3-11 17 0L23-12C45 33-26 40-25 5L-13-14C-19 8 2 4 3-34ZM0 3C15 19 10 31-4 28S-15 13 0 3Z"/>',
 meteor:'<path d="M-10 4 19-31 11-7 31-20 12 15M-21-5 3-29M-28 8-7-19"/><circle cx="-10" cy="18" r="14"/><path d="m-16 17 6-5 5 7-7 5Z"/>',
 crystal:'<path d="M0-34 20-12 12 24 0 34-12 24-20-12ZM0-34V34M-20-12 0 1 20-12M-12 24 0 1 12 24"/>',
 snow:'<path d="M0-34V34M-29-17 29 17M-29 17 29-17M-7-25 0-18 7-25M-7 25 0 18 7 25M-25-8-16-9-17-18M25 8 16 9 17 18M-25 8-16 9-17 18M25-8 16-9 17-18"/>',
 ribbon:'<path d="M-27-31C37-14-41 7 22 31M-17-31C47-14-31 7 32 31M-31-9C-3 1-3 7-26 17"/>',
 clock:'<circle r="28"/><circle r="22"/><path d="M0-19V1L13 12M0-28V-23M28 0H23M0 28V23M-28 0H-23"/>',
 thread:'<path d="M-30-24C30-30-30 30 30 24M-30 24C30 30-30-30 30-24M-30 0H30M-12-30C12-10-12 10 12 30"/><circle cx="-17" cy="-10" r="4"/><circle cx="17" cy="10" r="4"/>',
 void:'<ellipse rx="28" ry="20" transform="rotate(-35)"/><ellipse rx="18" ry="30" transform="rotate(35)"/><path d="m-3-30-8 18 18 13-14 15 7 14"/>',
 portal:'<ellipse rx="22" ry="32"/><ellipse rx="14" ry="25"/><path d="M-28-12-21-17M21 17 28 12M-23 20-29 25M23-20 29-25"/>',
 spirit:'<path d="M-23 27V-5a23 23 0 0 1 46 0V27L12 19 0 30-12 19ZM-12-3-5 1M12-3 5 1M-8 12Q0 17 8 12"/>',
 gate:'<path d="M-25 31V-12Q0-46 25-12V31M-17 31V-10Q0-33 17-10V31M-31 31H-10M31 31H10M0-30V-16M-25-5-32-10M25-5 32-10"/>',
 dagger:'<path d="M0-34 9-9 4 11-4 11-9-9ZM-14 13 0 17 14 13M-3 18V31H3V18M0-28V10"/>',
 eye:'<path d="M-33 0Q0-29 33 0Q0 29-33 0ZM-23-17-17-12M23-17 17-12M-23 17-17 12M23 17 17 12"/><circle r="9"/><path d="M0-7V7"/>',
 serpent:'<path d="M19-27C-33-38-33-5 0-6S35 28-10 29M19-27 29-23 21-15 10-19ZM-7 29-19 22-25 28M24-22l7-8"/>',
 drop:'<path d="M0-33C-2-15-19-4-19 11a19 19 0 0 0 38 0C19-4 2-15 0-33Z"/><circle cx="-5" cy="10" r="4"/><circle cx="7" cy="17" r="3"/>',
 scythe:'<path d="M-18 32 6-31M-9-16Q21-40 32-7Q14-18-9-16ZM-22 25-9 30"/>',
 fan:'<path d="M0 1-29-20-7-14 0-34 7-14 29-20ZM0 1 29 20 7 14 0 34-7 14-29 20Z"/><circle r="5"/>',
 comet:'<path d="M-17 10 24-30 11-3 33-14 0 23M-29-1-2-28M-31 15-5-9"/><path d="m-16 8 5 12 12 4-12 4-5 9-4-10-12-5 11-3Z"/>',
 orbit:'<ellipse rx="32" ry="12" transform="rotate(-35)"/><ellipse rx="32" ry="12" transform="rotate(35)"/><circle r="5"/><circle cx="24" cy="-15" r="4"/>',
 mirror:'<path d="M-3-34 18-15 11 27-9 34-22 6ZM-3-34 0-2 11 27M0-2 18-15M0-2-22 6"/>',
 web:'<path d="M-27-27 27 27M-27 27 27-27M0-34V34M-34 0H34M-19-19Q0-6 19-19Q6 0 19 19Q0 6-19 19Q-6 0-19-19ZM-9-9Q0-3 9-9Q3 0 9 9Q0 3-9 9Q-3 0-9-9Z"/>',
 eclipse:'<circle r="24"/><path d="M9-22A24 24 0 0 0 9 22Q-6 0 9-22ZM0-34V-28M0 28V34M-34 0H-28M28 0H34"/>',
};
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const assetRoot='art/ui/armory-specializations-20261016';
const PUBLIC=path.join(ROOT,'worker/public');
const placements={
 rail:[[70,245,1,0],[330,365,1,0],[70,435,.55,-15],[330,175,.55,15]],
 trail:[[64,265,1,-24],[336,340,1,24],[82,440,.6,-30],[318,170,.6,30]],
 wing:[[65,235,1,-18],[335,235,1,18],[80,420,.65,15],[320,420,.65,-15]],
 halo:[[70,285,1,0],[330,285,1,0],[70,440,.6,0],[330,440,.6,0]],
 ripple:[[72,335,1,-12],[328,335,1,12],[68,180,.6,0],[332,180,.6,0]],
};
const framing={
 rail:'<path d="M70 150V500M330 150V500M57 180H83M317 470H343"/>',
 trail:'<path d="M90 150 28 280 85 490M310 150 372 280 315 490" stroke-dasharray="22 18"/>',
 wing:'<path d="M100 150Q0 180 35 410M300 150Q400 180 365 410M90 175Q26 230 54 440M310 175Q374 230 346 440"/>',
 halo:'<ellipse cx="70" cy="285" rx="48" ry="100"/><ellipse cx="330" cy="285" rx="48" ry="100"/>',
 ripple:'<path d="M82 150C-12 230 138 350 38 490M318 150C412 230 262 350 362 490M62 180C0 260 116 370 58 480M338 180C400 260 284 370 342 480"/>',
};
const sha=x=>createHash('sha256').update(x).digest('hex');
const glyph=(name,color,opacity=1,width=2.4)=>`<g color="${color}" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" fill="none">${EMBLEMS[name]}</g>`;
export function build() {
 const profiles=designs();assert.equal(profiles.length,96);
 const geometryKeys=new Set();
 fs.mkdirSync(path.join(PUBLIC,assetRoot),{recursive:true});
 const rows=profiles.map((p,index)=>{
  assert.ok(EMBLEMS[p.primary]&&EMBLEMS[p.secondary]&&placements[p.layout],p.id);
  const geometryKey=[p.primary,p.secondary,p.layout].join(':');assert.ok(!geometryKeys.has(geometryKey),'Repeated geometry '+p.id);geometryKeys.add(geometryKey);
  const node=nodeFor(p.baseClass,p.path),positions=placements[p.layout];
  const emblems=positions.map(([x,y,s,r],i)=>`<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})">${glyph(i<2?p.primary:p.secondary,i<2?p.light:p.accent,i<2?.9:.75)}</g>`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" fill="none"><title>${node.name} · ${p.brief}</title><defs><clipPath id="sides"><path d="M0 80H132V525H0ZM268 80H400V525H268Z"/></clipPath><radialGradient id="glow"><stop stop-color="${p.light}" stop-opacity=".3"/><stop offset="1" stop-color="${p.light}" stop-opacity="0"/></radialGradient></defs><g clip-path="url(#sides)"><g fill="url(#glow)"><ellipse cx="70" cy="330" rx="62" ry="175"/><ellipse cx="330" cy="330" rx="62" ry="175"/></g><g stroke="${p.accent}" stroke-width=".9" stroke-opacity=".5">${framing[p.layout]}</g>${emblems}</g><path d="M95 558Q200 594 305 558M116 570Q200 594 284 570" stroke="${p.light}" stroke-opacity=".35"/></svg>\n`;
  const particle=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-38 -38 76 76" fill="none">${glyph(p.primary,'#ffffff',1,3.2)}</svg>\n`;
  const art=`${assetRoot}/${p.id}.svg`,particleArt=`${assetRoot}/${p.id}-particle.svg`;
  fs.writeFileSync(path.join(PUBLIC,art),svg);fs.writeFileSync(path.join(PUBLIC,particleArt),particle);
  return {...p,name:node.name,skill:node.skill.name,theme:'advanced-'+p.id,advanced:true,tier:p.path.length,art,particleArt,
   duration:Number((6+index*.07).toFixed(2)),cadence:Number((3.2+index*.031).toFixed(3)),intensity:.60,density:p.path.length===4?8:6,
   phase:index%7,artSHA256:sha(svg),particleSHA256:sha(particle),geometryKey};
 });
 const table=Object.fromEntries(rows.map(p=>[`${p.baseClass}:${p.path}`,p]));
 const js=`/* Generated by worker/art-production/build-armory-specializations.mjs; each exact identity is authored. */\n(function(root){'use strict';const rows=${JSON.stringify(table)};for(const row of Object.values(rows))Object.freeze(row);Object.freeze(rows);root.RpgArmorySpecializations=Object.freeze({entries:rows,resolve(base,path){return rows[base+':'+String(path||'')]||null;}});})(typeof window!=='undefined'?window:globalThis);\n`;
 fs.writeFileSync(path.join(PUBLIC,'armory-specializations.js'),js);
 fs.mkdirSync(path.join(ROOT,'docs/armory-specializations'),{recursive:true});
 fs.writeFileSync(path.join(ROOT,'docs/armory-specializations/designs.json'),JSON.stringify({count:96,profiles:rows},null,2)+'\n');
 const header='職業\t路徑\t名稱\t原生技能\t展示主題\t主紋\t輔紋\t動態\t構圖\n';
 fs.writeFileSync(path.join(ROOT,'docs/armory-specializations/designs.tsv'),header+rows.map(r=>[r.baseClass,r.path,r.name,r.skill,r.brief,r.primary,r.secondary,r.motion,r.layout].join('\t')).join('\n')+'\n');
 console.log(`Built ${rows.length} exact profiles, ${rows.length*2} original SVG assets; ${geometryKeys.size} distinct compositions.`);
 return rows;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))build();
