import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {gearOffers} from '../src/game/gear.js';
import {gearArt,cardPhoto,CARD_FRAMES} from '../src/game/share.js';
import {thiefGearArt,isThiefClassGear,thiefGearCardPhoto,iconForArtId,THIEF_GEAR_ART_IDS} from '../src/game/gear-art.js';
import {THIEF_RELEASE_READY} from '../src/game/thief-data.js';
const root=new URL('../../',import.meta.url),publicRoot=new URL('../public/',import.meta.url);
function browserContract(){
 const app=fs.readFileSync(new URL('app.js',publicRoot),'utf8'),ctx={window:{},MODE:'v2',V2:true};
 for(const key of ['SWORD_ADV2_HD','SWORD_ADV3_HD','MAGE_ADV2_HD','ELF_ADV4_HD','ELF_ADV3_HD','ELF_ADV2_HD','SWORD_ADV4_HD'])ctx[key]={};
 vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(new URL('gear-names.js',publicRoot),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(new URL('thief-gear-art.js',publicRoot),'utf8').replaceAll('export ',''),ctx);
 vm.runInContext(app.slice(app.indexOf('  const WPN ='),app.indexOf('  const AV1 =')),ctx);
 vm.runInContext(app.slice(app.indexOf('  function artFile('),app.indexOf('  for(const key of Object.keys(ELF_ADV4_HD))HERO_DISPLAY')),ctx);
 vm.runInContext(app.slice(app.indexOf('  const artSrc ='),app.indexOf('  // Retry failed reads')),ctx);
 vm.runInContext(app.match(/^  const gearIcon = .+$/m)[0]+';globalThis.icon=gearIcon;globalThis.src=artSrc;',ctx);
 return ctx;
}
test('all 82 real thief designs resolve through the actual browser gearIcon chain and shared server contract',()=>{
 const browser=browserContract(),offers=new Map();
 for(const route of ['A','B'])for(const item of gearOffers({base_class:'thief',class_path:route,level:120}))offers.set(item.name,{...item,classReq:'thief'});
 const specialized=[...offers.values()].filter(isThiefClassGear);
 assert.equal(specialized.length,82);assert.equal(THIEF_GEAR_ART_IDS.length,82);assert.equal(new Set(THIEF_GEAR_ART_IDS).size,82);
 for(const item of specialized){
  const art=thiefGearArt(item);assert.ok(art);assert.equal(gearArt(item),art.artId);assert.equal(iconForArtId(art.artId),art.iconSrc);
  assert.equal(browser.src('gear',item),art.iconSrc,item.name);assert.ok(browser.icon(item,'?').includes('src="'+art.iconSrc+'"'),item.name);
  assert.ok(!art.artId.includes('sword')&&!art.artId.endsWith('_plate'));
  for(const rarity of CARD_FRAMES){assert.equal(thiefGearCardPhoto(item,rarity),art.cardPrefix+'_'+rarity+'.jpg');assert.equal(cardPhoto({...item,rarity,grade:rarity==='relic'?'relic':'normal'}),THIEF_RELEASE_READY?art.cardPrefix+'_'+rarity+'.jpg':null);}
 }
});
test('invalid or unregistered thief IDs cannot borrow another class image or escape public paths',()=>{
 for(const id of ['wpn_sword','gear_wpn_laurel_dual_daggers','gear_wpn_laurel_throwing_blades','gear_wpn_unknown_dagger','gear_helm_laurel_plate','../gear_wpn_laurel_dagger','gear_wpn_laurel_dagger.webp','gear_wpn_laurel_dagger?x=1',null,{}])assert.equal(iconForArtId(id),null);
 for(const item of [{slot:'weapon',kind:'sword',classReq:'thief',tier:1},{slot:'weapon',kind:'dual_daggers',classReq:'thief',tier:1},{slot:'armor',kind:'light_leather',classReq:'thief',tier:0},{slot:'helmet',class_req:'thief',tier:13}]){assert.equal(thiefGearArt(item),null);assert.equal(gearArt(item),null);assert.equal(cardPhoto(item),null);}
});
test('legacy 294 designs and all 48 shared thief designs keep their existing named icon/card sources',()=>{
 const browser=browserContract();let legacy=0;
 for(const base of ['sword','archer','mage']){
  const unique=new Map();
  for(const route of ['A','B'])for(const item of gearOffers({base_class:base,class_path:route,level:120}))unique.set(item.name,{...item,classReq:base});
  for(const item of unique.values()){assert.equal(thiefGearArt(item),null);const src=browser.src('gear',item);assert.match(src,new RegExp('^art/v2/'+gearArt(item)+'\\.webp'));assert.ok(fs.existsSync(new URL(cardPhoto(item).slice(1),publicRoot)));}
  legacy+=unique.size;
 }
 const names=new Set();for(const route of ['A','B'])for(const item of gearOffers({base_class:'thief',class_path:route,level:120})){if(!isThiefClassGear({...item,classReq:'thief'})){assert.equal(thiefGearArt({...item,classReq:'thief'}),null);assert.ok(browser.src('gear',{...item,classReq:'thief'}).startsWith('art/v2/'));names.add(item.name);}}
 assert.equal(legacy,390);assert.equal(names.size,48); // Shared 48 designs are repeated across the three class offer sets.
});
test('false and true release branches use real memory acquisition, learn, loadout, cast, share and escrow pipelines',()=>{
 for(const ready of ['false','true']){
  const result=spawnSync(process.execPath,[new URL('./thief-release-fixture.mjs',import.meta.url).pathname.replace(/^\/(?:([A-Z]):)/,'$1:'),ready],{cwd:new URL('../../',import.meta.url),encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stdout,/\"passed\":true/);
 }
 assert.ok(fs.readFileSync(new URL('../src/game/thief-data.js',import.meta.url),'utf8').includes('export const THIEF_RELEASE_READY = '+THIEF_RELEASE_READY+';'));
});

