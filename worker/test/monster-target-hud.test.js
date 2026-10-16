import test from 'node:test';
import assert from 'node:assert/strict';
import {idleBattleHarness,idleMe,idleReport} from './idle-battle-harness.js';

const enemy=(id,name,hp=100)=>({id,name,mapId:4,hp,maxHp:100,elite:false});
const before=()=>[enemy('siren','海崖塞壬'),enemy('beetle','潮汐甲蟲')];
function fixture(round=null,options={}){
  const h=idleBattleHarness(options),me=idleMe({mapId:4,level:35});
  me.battle.idleCombat={enemies:round?.after||before(),round};
  h.battle.sync(me,round?idleReport({combat:round,kills:round.kills||0,elites:0,used:{}}):null);
  return h;
}
function highlighted(h){return Array.from(h.battle.state.group).filter(e=>e.refs.mName.classList.contains('is-targeted')).map(e=>e.mon?.id);}
function sameCues(h){
  for(const e of h.battle.state.group){
    const selected=e.refs.mName.classList.contains('is-targeted');
    assert.equal(e.refs.mon.classList.contains('selected-target'),selected);
    assert.equal(e.refs.mon.getAttribute('aria-pressed'),String(selected));
    if(selected)assert.ok(e.mon?.hp>0);
  }
}

test('either sea-cliff monster can be selected by sprite, keyboard or name button with the same name cue',async()=>{
  const h=fixture();await h.advance(3000);const [siren,beetle]=h.battle.state.group;
  assert.deepEqual(highlighted(h),['siren']);
  beetle.refs.mon.listeners.get('click')();assert.deepEqual(highlighted(h),['beetle']);sameCues(h);
  siren.refs.mHud.listeners.get('click')();assert.deepEqual(highlighted(h),['siren']);sameCues(h);
  let prevented=false;siren.refs.mon.listeners.get('keydown')({key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.deepEqual(highlighted(h),['siren']);sameCues(h);
  const targetBar=h.root.children.find(node=>node.className==='enemy-targets');
  targetBar.children[1].onclick();
  assert.deepEqual(highlighted(h),['beetle']);sameCues(h);
  assert.deepEqual(targetBar.children.map(b=>b.getAttribute('aria-pressed')),['false','true']);
  const hp=h.battle.state.group.map(e=>e.mon.hp);await h.advance(6000);
  assert.deepEqual(h.battle.state.group.map(e=>e.mon.hp),hp);assert.deepEqual(h.errors,[]);
});

test('committed group hits highlight the actual monster at impact instead of the previous working slot',async()=>{
  const enemies=before(),round={id:'focus-two-hits',mapId:4,before:enemies,after:[{...enemies[0],hp:80},{...enemies[1],hp:90}],events:[
    {type:'hit',targetId:'beetle',enemy:enemies[1],damage:10,beforeHp:100,afterHp:90,skill:true,skillName:'群攻'},
    {type:'hit',targetId:'siren',enemy:enemies[0],damage:20,beforeHp:100,afterHp:80,skill:true,skillName:'群攻'}
  ]};
  const h=fixture(round,{reducedMotion:false}),seen=new Set();
  for(let i=0;i<6000&&!h.root.dataset.completedRound;i++){
    await h.advance(10);const hit=h.root.dataset.lastHit&&JSON.parse(h.root.dataset.lastHit);
    if(!hit||seen.has(hit.id))continue;
    seen.add(hit.id);assert.deepEqual(highlighted(h),[hit.id]);sameCues(h);
  }
  assert.deepEqual([...seen],['beetle','siren']);assert.equal(h.root.dataset.completedRound,round.id);
  assert.deepEqual(h.errors,[]);assert.deepEqual(h.requests,['monster-layout.json']);
});

test('a defeated selected monster loses all cues and the live replacement slot starts clean',async()=>{
  const enemies=before(),replacement=enemy('siren-next','海崖塞壬'),round={id:'focus-defeat',mapId:4,kills:1,before:enemies,after:[replacement,enemies[1]],events:[
    {type:'hit',targetId:'siren',enemy:enemies[0],damage:100,beforeHp:100,afterHp:0,skill:false},
    {type:'spawn',slot:0,enemy:replacement}
  ]};
  const h=fixture(round);let deadSlotChecked=false;
  for(let i=0;i<400&&!h.root.dataset.completedRound;i++){
    await h.advance(10);const slot=h.battle.state.group[0];
    if(!slot||slot.mon!==null||slot.refs.mon.style.opacity!=='0')continue;
    deadSlotChecked=true;assert.equal(slot.refs.mon.classList.contains('selected-target'),false);
    assert.equal(slot.refs.mName.classList.contains('is-targeted'),false);assert.equal(slot.refs.mHud.hidden,true);sameCues(h);
    assert.deepEqual(highlighted(h),['beetle']);
  }
  assert.equal(deadSlotChecked,true);assert.equal(h.root.dataset.completedRound,round.id);
  sameCues(h);assert.deepEqual(highlighted(h),['siren-next']);assert.deepEqual(h.errors,[]);
});

test('each name and real HP live above the canvas in an independent HUD and refit with the wave',async()=>{
  const h=fixture();await h.advance(3000);const layer=h.root.children.find(node=>node.className==='enemy-huds');
  assert.equal(layer.parentNode,h.root);assert.equal(layer.children.length,2);
  h.root.getBoundingClientRect=()=>({left:20,top:40,width:390,height:600});h.root.clientLeft=2;h.root.clientTop=2;
  for(const [i,e]of h.battle.state.group.entries()){
    assert.equal(e.refs.mName.parentNode,e.refs.mHud);assert.equal(e.refs.mBar.parentNode,e.refs.mHud);
    assert.equal(e.refs.mHud.parentNode,layer);assert.equal(e.refs.mHud.hidden,false);
    e.refs.mon.offsetLeft=200;e.refs.mon.offsetWidth=160;e.refs.mon.offsetHeight=180;
    e.refs.mon.getBoundingClientRect=()=>({left:222,top:142+i*225,width:160,height:180});
  }
  h.battle.state.group[0].refs.mImg.listeners.get('load')();
  assert.deepEqual(Array.from(h.battle.state.group,e=>[e.refs.mHud.style.left,e.refs.mHud.style.top,e.refs.mHud.style.width,e.refs.mHud.style.height]),[['200px','100px','160px','180px'],['200px','325px','160px','180px']]);
  h.root.clientWidth=320;
  for(const [i,e]of h.battle.state.group.entries()){
    e.refs.mon.offsetLeft=248;e.refs.mon.getBoundingClientRect=()=>({left:270,top:122+i*225,width:160,height:180});
  }
  h.battle.state.group[1].refs.mImg.listeners.get('load')();
  assert.deepEqual(Array.from(h.battle.state.group,e=>[e.refs.mHud.style.left,e.refs.mHud.style.top]),[['248px','80px'],['248px','305px']]);
  for(const e of h.battle.state.group){
    const nameCenter=parseFloat(e.refs.mHud.style.left)+parseFloat(e.refs.mName.style.left);
    assert.ok(nameCenter+e.refs.mName.offsetWidth/2<=h.root.clientWidth-8);
    assert.equal(e.refs.mBar.getAttribute('aria-valuenow'),String(e.mon.hp));
  }
  h.battle.sync(idleMe({mapId:5,revision:2}));
  assert.equal(layer.children.length,0);await h.advance(5000);
  assert.equal(layer.children.length,h.battle.state.group.length);assert.deepEqual(h.errors,[]);
});
