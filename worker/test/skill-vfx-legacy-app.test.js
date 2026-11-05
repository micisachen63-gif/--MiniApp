import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('async function playBossSkillReceipt'),app.indexOf('let bossWaitingCleanup'));
const descriptor=(kind='cast',eventId='boss:cast')=>({schemaVersion:1,source:'committed-combat',eventId,
 skillId:kind==='cast'?'native:sword:base':'special:skill_02_3',kind,actorId:'hero',atMs:1000,
 targetKind:'enemy',targetIds:['boss'],presentationMode:kind==='cast'?'full':'impact'});
function setup(result,{onPrepare,onLoad}={}){
 const played=[],prepared=[],geometry={actorId:'hero',from:{x:60,y:100},foot:{x:60,y:160},bodyHeight:100,targets:[{id:'boss',point:{x:360,y:80}}]};
 let destroyed=0,casts=0,created=0;
 const scene={isConnected:true},S={realmId:'permanent',tab:'boss',me:{character:{tgId:'hero'}}},BF={result},document={hidden:false};
 const layer={prepare:async rows=>{prepared.push(...rows);await onPrepare?.({S,BF,scene,document});},
  play:async(raw,supplied)=>{played.push({raw,geometry:supplied});return {accepted:true,remainingMs:30};},
  destroy:()=>destroyed++};
 const context=vm.createContext({S,BF,document,bossVfxCleanup:null,
  setTimeout:callback=>{queueMicrotask(callback);return 1;},clearTimeout(){},
  loadLegacySkillVfx:async()=>{await onLoad?.({S,BF,scene,document});return {createLegacyVfxLayer:async(_scene,options)=>{created++;assert.equal(_scene,scene);assert.equal(options.mode,'boss');return layer;}};}});
 vm.runInContext(source+'\nthis.play=playBossSkillReceipt;',context);
 return {played,prepared,S,BF,scene,document,geometry,counts:()=>({destroyed,casts,created}),
  run:()=>context.play(scene,{id:'boss-1'},result,'hero',()=>geometry,()=>casts++)};
}
test('boss receipt player consumes actual action casts and final-hit reflection effects outside actions in order',async()=>{
 const cast=descriptor(),pulse=descriptor('effect','boss:action:pulse'),reflection=descriptor('effect','boss:final:reflect');
 const result={actions:[{vfx:cast,vfxEvents:[pulse]},{vfx:{...cast,eventId:'foreign',actorId:'other'}}],vfxEvents:[reflection]};
 const before=JSON.stringify(result),s=setup(result);await s.run();
 assert.deepEqual(s.played.map(row=>row.raw.eventId),['boss:cast','boss:action:pulse','boss:final:reflect']);
 assert.ok(s.played.every(row=>row.geometry===s.geometry));
 assert.equal(s.counts().casts,1,'effect receipts cannot create another caster windup');
 assert.equal(s.counts().destroyed,1);assert.equal(JSON.stringify(result),before);
});
test('old boss damage summaries never become guessed skill events',async()=>{
 const s=setup({damage:999,actions:[{label:'斬擊',skillId:'attack',damage:999}]});await s.run();
 assert.deepEqual(s.counts(),{destroyed:0,casts:0,created:0});assert.equal(s.played.length,0);
});
test('boss context changing during receipt preparation prevents delayed VFX and cleans the layer',async()=>{
 for(const change of [
  state=>state.S.realmId='season-other',state=>state.S.me.character.tgId='other',
  state=>state.S.tab='home',state=>state.scene.isConnected=false,
  state=>state.document.hidden=true,state=>state.BF.result={}
 ]){
  const s=setup({actions:[{vfx:descriptor()}]},{onPrepare:change});await s.run();
  assert.equal(s.played.length,0);assert.equal(s.counts().destroyed,1);assert.equal(s.counts().casts,0);
 }
});
test('boss context changing while the optional module loads never creates a stale canvas',async()=>{
 const s=setup({actions:[{vfx:descriptor()}]},{onLoad:state=>state.S.tab='home'});await s.run();
 assert.equal(s.counts().created,0);assert.equal(s.played.length,0);
});

const pkSource=app.slice(app.indexOf('function pkFrame'),app.indexOf('async function playerPicker'));
function pkSetup(step){
 const additions=[],texts=[],plays=[],timers=new Map();let nextTimer=0,destroyed=0;
 const element=name=>{
  const node={name,style:{},flags:new Set(),offsetWidth:100};
  node.classList={add(...values){values.forEach(value=>{node.flags.add(value);additions.push(name+':'+value);});},remove(...values){values.forEach(value=>node.flags.delete(value));}};
  Object.defineProperty(node,'textContent',{get:()=>node.value||'',set:value=>{node.value=value;texts.push({name,value});}});
  return node;
 };
 const actors={},nodes={},result=element('result'),buttons={'[data-x]':{},'[data-skip]':{}};
 for(const id of ['a','b']){
  const actor=actors[id]=element(id),d=element(id+':damage');actor.querySelector=selector=>selector==='.pkdmg'?d:null;
  nodes['#pk_'+id]=actor;nodes['#pk_'+id+' img']={id};
  for(const kind of ['hp','mp']){const fill=element(id+':'+kind+':fill'),label=element(id+':'+kind+':label');nodes['#pk_'+id+' .bar.'+kind]={querySelector:selector=>selector==='i'?fill:label};}
 }
 const arena={},sheetNode={hidden:false},container={isConnected:true,querySelector:selector=>selector==='#pkres'?result:selector==='.pkarena'?arena:nodes[selector]||buttons[selector],querySelectorAll:()=>Object.values(actors)};
 const me={realmId:'permanent',me:{character:{tgId:'local'}}};
 const layer={prepare:async()=>{},timing:()=>({remainingMs:80}),play:async(raw,geometry)=>{plays.push({raw,geometry});return {accepted:true};},destroy:()=>destroyed++};
 const api={createLegacyVfxLayer:async()=>layer,legacyDescriptors:event=>[event.vfx,...(event.vfxEvents||[])].filter(Boolean),legacyDomGeometry:(_scene,actor,targets,opts)=>({actorId:opts.actorId,actor,targets})};
 const context=vm.createContext({S:me,document:{hidden:false},sheetPlaybackCancel:null,loadLegacySkillVfx:async()=>api,
  sheet:()=>container,$:()=>sheetNode,matchMedia:()=>({matches:false}),
  setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id),
  artSrc:()=>'',heroKey:()=>'',esc:String,bar:()=>'',fmt:String,pct:(value,max)=>value/max*100,
  closeSheet:()=>{container.isConnected=false;}});
 vm.runInContext(pkSource+'\nthis.replay=pkReplay;',context);
 const p={id:'pk-real-receipt',rounds:1,winner:'a',a:{name:'甲',baseClass:'mage',level:40},b:{name:'乙',baseClass:'sword',level:40},
  log:{steps:[step],max:{a:100,b:100},maxMp:{a:50,b:50},initial:{hp:{a:75,b:100},mp:{a:50,b:50}},hp:{...step.after.hp},mp:{...step.after.mp}}};
 const saved=JSON.stringify(p);context.replay(p);
 return {additions,texts,plays,actors,result,p,unchanged:()=>JSON.stringify(p)===saved,counts:()=>({destroyed,timers:timers.size}),
  async flush(){await new Promise(resolve=>setImmediate(resolve));},
  async tick(){const pair=timers.entries().next().value;if(!pair)return false;const [id,fn]=pair;timers.delete(id);fn();await new Promise(resolve=>setImmediate(resolve));return true;}};
}
test('complete PK replay keeps support/summon/pulse receipts distinct from attacks and shows only real HP loss',async()=>{
 const scenarios=[
  {name:'heal',mode:'support',id:'special:skill_04_2',hp:{a:90,b:100},attack:false,hit:false,heal:15,label:'施展支援技能'},
  {name:'buff',mode:'support',id:'special:skill_thief_06',hp:{a:75,b:100},attack:false,hit:false,heal:0,label:'施展支援技能'},
  {name:'summon',mode:'summon',id:'special:skill_18_1',hp:{a:75,b:100},attack:false,hit:false,heal:0,label:'施展召喚'},
  {name:'pulse',mode:'impact',id:'special:skill_18_1',hp:{a:75,b:85},attack:false,hit:true,heal:0,label:'持續效果結算'},
  {name:'blocked-cast',mode:'full',id:'native:mage:base',hp:{a:75,b:100},attack:true,hit:false,heal:0,label:'施展技能'},
  {name:'direct-cast',mode:'full',id:'native:mage:base',hp:{a:75,b:85},attack:true,hit:true,heal:0,label:'施展技能'}
 ];
 for(const scenario of scenarios){
  const support=['support','summon'].includes(scenario.mode),raw={schemaVersion:1,source:'committed-combat',eventId:'pk:'+scenario.name,
   skillId:scenario.id,kind:scenario.mode==='impact'?'effect':'cast',actorId:'a',atMs:1000,targetKind:support?'self':'enemy',targetIds:[support?'a':'b'],presentationMode:scenario.mode};
  const step={by:'a',skill:true,dmg:999,heal:999,before:{hp:{a:75,b:100},mp:{a:50,b:50}},after:{hp:scenario.hp,mp:{a:40,b:50}},...(raw.kind==='effect'?{vfxEvents:[raw]}:{vfx:raw})};
  const s=pkSetup(step);await s.flush();await s.tick();await s.tick();
  assert.equal(s.additions.includes('a:atk'),scenario.attack,scenario.name+': caster pose');
  assert.equal(s.additions.includes('b:hitme'),scenario.hit,scenario.name+': target hit cue');
  const damage=s.texts.filter(row=>row.name==='b:damage').map(row=>row.value);
  assert.deepEqual(damage,scenario.hit?['−15']:[],scenario.name+': real damage only');
  const healed=s.texts.filter(row=>row.name==='a:damage').map(row=>row.value);
  assert.deepEqual(healed,scenario.heal?['+15']:[],scenario.name+': actual capped healing only');
  assert.ok(s.result.textContent.includes(scenario.label),scenario.name+': event label');
  assert.equal(s.plays.length,1);assert.equal(s.plays[0].raw,raw);assert.equal(s.plays[0].geometry.actorId,'a');
  assert.ok(s.unchanged());await s.tick();assert.equal(s.counts().destroyed,1);assert.equal(s.counts().timers,0);
 }
});
test('a PK support cast with a simultaneous real periodic hit shows that hit without a caster attack pose',async()=>{
 const cast={schemaVersion:1,source:'committed-combat',eventId:'pk:support',skillId:'special:skill_04_2',kind:'cast',actorId:'a',atMs:1000,targetKind:'self',targetIds:['a'],presentationMode:'support'};
 const pulse={...cast,eventId:'pk:pulse',skillId:'special:skill_18_1',kind:'effect',targetKind:'enemy',targetIds:['b'],presentationMode:'impact'};
 const s=pkSetup({by:'a',skill:true,vfx:cast,vfxEvents:[pulse],after:{hp:{a:90,b:85},mp:{a:40,b:50}}});
 await s.flush();await s.tick();await s.tick();
 assert.ok(!s.additions.includes('a:atk'));assert.ok(s.additions.includes('b:hitme'));
 assert.deepEqual(s.texts.filter(row=>row.name==='b:damage').map(row=>row.value),['−15']);
 assert.deepEqual(s.texts.filter(row=>row.name==='a:damage').map(row=>row.value),['+15']);
 assert.deepEqual(s.plays.map(row=>row.raw.eventId),['pk:support','pk:pulse']);await s.tick();assert.equal(s.counts().destroyed,1);
});
