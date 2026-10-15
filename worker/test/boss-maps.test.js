import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=app.indexOf('  function bindBoss(view)'),end=app.indexOf('  const TSTATUS',start),bind=app.slice(start,end);
test('all twelve boss tiers render their own Greek map independent of player map',()=>{
 for(let mapId=1;mapId<=12;mapId++){
 const requested=[],draws=[],drawers=[],image={width:1280,height:720};
 const context=vm.createContext({V2:true,window:{},BOSS_ANIM:{},S:{boss:{mapId,hp:1,status:'active'},me:{character:{mapId:12,tgId:'memory'}}},drawers,$:()=>null,artImg:(kind,key)=>{if(kind==='map'){requested.push(key);return image}return null},BF:{hitT:-100},BATTLE:false,heroSprite:()=>null,bossAnimSprite:()=>null,drawSprite:()=>true,heroOpts:()=>({}),A:{scene(){throw Error('Fallback used despite existing map')}},expansion:null});
 vm.runInContext(bind+';this.bind=bindBoss;',context);context.bind({});drawers[0].fn({drawImage:(...args)=>draws.push(args)},390,220,1);
 assert.deepEqual(requested,['myth'+String(mapId).padStart(2,'0')]);assert.equal(draws.length,1);assert.equal(draws[0][0],image);
 const file=new URL('../public/art/v2/bg_'+requested[0]+'.webp',import.meta.url);assert(fs.statSync(file).size>1000);
 }
});
test('empty boss scene still mounts the dedicated waiting background',()=>{let mounted=false;const context=vm.createContext({S:{boss:null},window:{RpgBossWaiting:{mount(){mounted=true;return ()=>{}}}}});vm.runInContext(bind+';this.bind=bindBoss;',context);context.bind({querySelector:()=>({})});assert.equal(mounted,true)});
