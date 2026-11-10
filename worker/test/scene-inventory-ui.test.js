import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/scene-inventory-ui.js',import.meta.url),'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve,reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
const settle = async () => { await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve)); };
const attribute = (tag,name) => {
  const value = tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'))?.[1];
  return value?.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
};
class Root {
  constructor(){this.innerHTML='';this.scrollTop=0;this.events=new Map();this.ownerDocument={activeElement:null};}
  set innerHTML(value){this.html=value;this.controls=null;}
  get innerHTML(){return this.html;}
  contains(target){return target?.root===this;}
  addEventListener(kind,fn){if(!this.events.has(kind))this.events.set(kind,new Set());this.events.get(kind).add(fn);}
  removeEventListener(kind,fn){this.events.get(kind)?.delete(fn);}
  querySelectorAll(selector){
    const name=selector.match(/^\[name="([^"]+)"\]$/)?.[1];
    if(!name)return [];
    if(!this.controls)this.controls=[...this.innerHTML.matchAll(/<(?:input|select)\b[^>]*>/g)].map(m=>m[0]).map(tag=>{
      const itemId=attribute(tag,'data-item-id');
      return this.target({name:attribute(tag,'name')||'',value:attribute(tag,'value')||'',dataset:itemId===undefined?{}:{itemId},checked:/\schecked(?:\s|>)/.test(tag),disabled:/\sdisabled(?:\s|>)/.test(tag)});
    });
    return this.controls.filter(control=>control.name===name);
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  target(props={}){
    const root=this;
    return {root,dataset:{},name:'',value:'',disabled:false,selectionStart:0,selectionEnd:0,...props,
      closest(selector){return selector==='[data-inv-action]'&&this.dataset.invAction?this:null;},
      focus(){root.ownerDocument.activeElement=this;},
      setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}
    };
  }
  button(action,id){
    const tag=[...this.innerHTML.matchAll(/<button\b[^>]*>/g)].map(m=>m[0]).find(t=>attribute(t,'data-inv-action')===action&&(id===undefined||attribute(t,'data-item-id')===id));
    assert.ok(tag,'Expected visible action '+action+(id?' for '+id:''));
    const dataset={};
    for(const [,key,value]of tag.matchAll(/\sdata-([a-z-]+)="([^"]*)"/g))dataset[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value.replaceAll('&amp;','&');
    return this.target({dataset,disabled:/\sdisabled(?:\s|>)/.test(tag)});
  }
  async fire(kind,target,extra={}){for(const fn of [...this.events.get(kind)||[]])await fn({target,...extra});}
  click(action,id){return this.fire('click',this.button(action,id));}
  change(name,value,{id,checked}={}){return this.fire('change',this.target({name,value,checked,dataset:id?{itemId:id}:{}}));}
  async type(value,{composing=false}={}){const input=this.querySelector('[name="inventorySearch"]')||this.target({name:'inventorySearch'});Object.assign(input,{value,selectionStart:value.length,selectionEnd:value.length});this.ownerDocument.activeElement=input;await this.fire('input',input,{isComposing:composing});return input;}
}
function equipment(id,extra={}){
  return {id,name:'月桂木劍 '+id,slot:'weapon',slotName:'武器',position:0,tier:1,rarity:'common',rarityName:'一般',grade:'normal',gradeName:null,
    enhance:0,equipped:false,bound:false,inTrade:null,tradeBlock:null,shareBlock:null,sellPrice:10,sellBlock:null,cannotEquip:null,stat:24,statName:'攻擊力',
    elemStat:2,element:'wind',elementName:'風',classReq:'sword',className:'劍士',levelReq:1,source:'elite',art:'wpn_sword',extras:{hp:5},pct:{critPct:.01},
    affixes:{quality:'一般',slots:1,lines:[{name:'攻擊',value:.02,quality:'一般'}]},growth:{base:24,enhancement:0},towerImprint:{level:0,max:10,bonusPct:0},...extra};
}
function player(items=[equipment('one'),equipment('two')],extra={}){
  return {ok:true,character:{tgId:'c1',name:'靖澄',revision:1,level:20,gold:100,partyId:null},inventory:{red_1:8,scroll_w:5,gacha_weapon:1,fate_cycle_gift:1,book_slash:1,boss_essence:3},equipment:items,
    activity:null,autoEnhance:null,autoReroll:null,...extra};
}
function memoryStorage(){const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function harness({mode='inventory',itemId,me=player(),draft={},override,api,storage=memoryStorage(),document,context={accountId:'a1',realmId:'permanent',characterId:'c1',epoch:1}}={}){
  const root=new Root(), calls=[], navigations=[], changed=[];
  if(document)root.ownerDocument=document;
  let current=true, value=clone(me), ctx={...context}, serial=0;
  const meta={items:{
    red_1:{name:'初級紅藥水',kind:'red',desc:'戰鬥自動補給',emoji:'🧪'},scroll_w:{name:'武器強化捲',kind:'scroll',desc:'強化武器'},
    gacha_weapon:{name:'武器轉蛋',kind:'gacha',desc:'按角色等級與職業開啟'},fate_cycle_gift:{name:'四世星輝匣',kind:'fate_gift',desc:'輪迴贈禮'},
    book_slash:{name:'斬擊技能書',kind:'book',desc:'在技能系統學習'},boss_essence:{name:'首領精華',kind:'boss_resource',desc:'兌換材料'}
  },trade:{tradeableItems:['red_1','scroll_w','gacha_weapon','book_slash']}};
  const host={draft,storage,current:()=>current,getContext:()=>({...ctx}),getActor:()=>value.character,artUrl:path=>'https://assets.invalid'+path,
    navigate:(route,params)=>navigations.push({route,params:clone(params)}),back:()=>{},onChanged:data=>changed.push(clone(data)),
    request:async(action,body={},opts={})=>{
      calls.push({action,body:clone(body),signal:opts.signal});
      const custom=override&&await override(action,body,{get me(){return value;},set me(next){value=clone(next);},calls});
      if(custom!==undefined)return custom;
      if(action==='me')return clone(value);
      if(action==='meta')return {ok:true,meta:clone(meta)};
      if(action==='atlas/status')return {ok:true,realmId:ctx.realmId,characterId:ctx.characterId,enabled:true,materials:{laurel_shard:7},run:{status:'running'}};
      if(action==='atlas/catalog')return {ok:true,catalog:{materials:[{id:'laurel_shard',name:'月桂碎片'}]}};
      if(action==='equipment-recovery')return {ok:true,realmId:ctx.realmId,characterId:ctx.characterId,enabled:true,dust:9,items:[]};
      if(action==='fate/gifts/summary')return {ok:true,completed:4,claimable:0,unopened:value.inventory.fate_cycle_gift||0,pool:[{chance:100,items:{scroll_w:2}}]};
      if(action==='sell-gear'||action==='sell-gear-batch'){
        const ids=body.itemIds||[body.itemId], selected=value.equipment.filter(e=>ids.includes(e.id));
        const gold=selected.reduce((sum,e)=>sum+e.sellPrice,0);
        value.equipment=value.equipment.filter(e=>!ids.includes(e.id));value.character.gold+=gold;value.character.revision++;
        return {...clone(value),result:{count:selected.length,gold}};
      }
      if(action==='equip'||action==='unequip'){
        const item=value.equipment.find(e=>e.id===body.itemId);
        if(action==='equip'){
          for(const e of value.equipment)if(e.slot===item.slot&&e.position===body.position){e.equipped=false;e.position=0;}
          item.equipped=true;item.position=body.position;item.bound=true;
        }else{item.equipped=false;item.position=0;}
        value.character.revision++;
        return {...clone(value),result:{itemId:item.id}};
      }
      if(action==='gacha/open'){value.inventory['gacha_'+body.type]--;const item=equipment('drawn-'+(++serial));value.equipment.push(item);value.character.revision++;return {...clone(value),result:{item,rarity:'common',type:body.type}};}
      if(action==='fate/gifts/open'){value.inventory.fate_cycle_gift=0;value.inventory.scroll_w+=2;value.character.revision++;return {ok:true,result:{giftId:'gift-one',items:{scroll_w:2}}};}
      throw new Error('Unexpected action: '+action);
    }};
  if(!api){const sandbox={AbortController,console,Intl,Date,Math,URL,sessionStorage:storage,crypto:{randomUUID:()=>String(++serial).padStart(32,'0')}};
    vm.runInNewContext(source,sandbox,{filename:'scene-inventory-ui.js'});api=sandbox.RpgSceneInventory;}
  const module=api.mount(root,host,{mode,itemId});
  return {root,host,module,api,storage,calls,navigations,changed,draft,setContext:next=>{ctx={...ctx,...next};},setCurrent:next=>{current=next;},setMe:next=>{value=clone(next);},getMe:()=>clone(value)};
}
const writes=h=>h.calls.filter(c=>['equip','unequip','sell-gear','sell-gear-batch','gacha/open','fate/gifts/open'].includes(c.action));

test('owned inventory combines equipment, actual inventory, Atlas materials and character dust; updates never poll',async()=>{
  const h=harness();await settle();
  assert.match(h.root.innerHTML,/月桂碎片/);assert.match(h.root.innerHTML,/data-inv-row="atlas:laurel_shard"/);assert.match(h.root.innerHTML,/裝備精煉材料/);
  assert.match(h.root.innerHTML,/首領精華/);assert.match(h.root.innerHTML,/初級紅藥水/);
  assert.match(h.root.innerHTML,/https:\/\/assets\.invalid\/art\/v2\/wpn_sword\.webp/);
  assert.equal(h.calls.filter(c=>c.action==='me').length,1);
  for(let i=0;i<10;i++)h.module.update({scene:{revision:i}});
  await settle();assert.equal(h.calls.filter(c=>c.action==='me').length,1);assert.equal(writes(h).length,0);
  h.module.dispose();
});

test('search, selection, caret and scroll survive fresh background projections and remount; Chinese composition is not replaced',async()=>{
  const draft={},h=harness({draft});await settle();
  await h.root.change('inventorySelected','',{id:'one',checked:true});
  const before=h.root.innerHTML,input=await h.root.type('月',{composing:true});
  assert.equal(h.root.innerHTML,before);assert.equal(draft.query,'月');
  await h.root.fire('compositionend',input);
  assert.equal(h.root.ownerDocument.activeElement.name,'inventorySearch');assert.equal(h.root.ownerDocument.activeElement.selectionStart,1);
  h.root.scrollTop=183;await h.root.fire('scroll',h.root.target());
  const next=h.getMe();next.character.revision=2;next.character.gold=200;next.equipment[0].affixes.lines[0].value=.03;
  h.module.update(next);
  assert.equal(draft.query,'月');assert.deepEqual([...draft.selected],['one']);assert.equal(h.root.scrollTop,183);
  assert.match(h.root.innerHTML,/value="月"/);h.module.dispose();
  const again=harness({draft,me:next});await settle();
  assert.match(again.root.innerHTML,/value="月"/);assert.equal(again.root.scrollTop,183);assert.deepEqual([...draft.selected],['one']);
  again.module.dispose();
});

test('all 11 equipped positions and real item lock reasons remain visible',async()=>{
  const locked=equipment('locked',{inTrade:'trade-1',tradeBlock:'已在交易中',sellBlock:'交易中的裝備不能出售'});
  const h=harness({mode:'equipment',me:player([locked])});await settle();
  assert.equal((h.root.innerHTML.match(/class="si-slot /g)||[]).length,11);
  assert.match(h.root.innerHTML,/交易託管中/);assert.match(h.root.innerHTML,/交易中的裝備不能出售/);
  await h.root.change('inventorySelected','',{id:'locked',checked:true});assert.equal(h.draft.selected.length,0);
  h.module.dispose();
});

test('detail uses complete gear values, comparison position and real equip body; binding and departure snapshot are explained',async()=>{
  const ring=equipment('new-ring',{slot:'ring',slotName:'戒指',enhance:4,statName:'魔力',stat:40,grade:'relic',gradeName:'遺物',affix:{atkPct:.03},towerImprint:{level:2,max:10,bonusPct:10},growth:{base:24,enhancement:16}});
  const old=equipment('old-ring',{slot:'ring',slotName:'戒指',equipped:true,position:2,stat:18,statName:'魔力'});
  const h=harness({mode:'item',itemId:'new-ring',me:player([ring,old])});await settle();
  assert.match(h.root.innerHTML,/\+4 月桂木劍 new-ring/);assert.match(h.root.innerHTML,/塔印 2／10/);assert.match(h.root.innerHTML,/攻擊/);assert.match(h.root.innerHTML,/基礎 24 ＋ 強化 16/);
  await h.root.change('inventoryPosition','2');assert.match(h.root.innerHTML,/單件主屬性差 \+22/);
  await h.root.click('preview-equip','new-ring');assert.match(h.root.innerHTML,/穿戴後這件裝備會綁定/);assert.match(h.root.innerHTML,/出發快照/);
  await h.root.click('confirm');
  assert.deepEqual(writes(h).map(c=>({action:c.action,body:c.body})),[{action:'equip',body:{itemId:'new-ring',position:2}}]);
  assert.equal(h.changed.length,1);h.module.dispose();
});

test('short party and background job locks stop equip and sale; running star-ring snapshot allows backpack maintenance',async()=>{
  const item=equipment('one'),me=player([item],{autoEnhance:{itemId:'one',status:'running'},activity:{kind:'party',id:'p1'}});
  me.character.partyId='p1';
  const h=harness({mode:'item',itemId:'one',me});await settle();
  assert.match(h.root.innerHTML,/背景強化進行中/);assert.equal(h.root.button('preview-equip','one').disabled,true);assert.equal(h.root.button('preview-sell','one').disabled,true);
  const party=clone(me);party.autoEnhance=null;party.character.revision=2;h.module.update(party);
  assert.match(h.root.innerHTML,/請先結束目前的組隊戰鬥/);
  party.character.revision=3;party.activity={kind:'star-ring',id:'p1'};h.module.update(party);
  assert.equal(h.root.button('preview-equip','one').disabled,false);
  h.module.dispose();
});

test('safe bulk selection excludes precious and locked gear, caps 100 and sends one atomic batch after preview',async()=>{
  const items=Array.from({length:130},(_,i)=>equipment('gear-'+i));
  items.push(equipment('relic',{grade:'relic'}),equipment('enhanced',{enhance:1}),equipment('legendary',{rarity:'legendary'}),equipment('trade',{inTrade:'t1'}));
  const h=harness({me:player(items)});await settle();
  await h.root.click('select-visible');
  assert.equal(h.draft.selected.length,100);assert.equal(new Set(h.draft.selected).size,100);
  for(const id of ['relic','enhanced','legendary','trade'])assert.ok(!h.draft.selected.includes(id));
  await h.root.click('preview-batch');
  assert.match(h.root.innerHTML,/共 100 件，取得 1,000 金幣/);assert.equal(writes(h).length,0);
  await h.root.click('confirm');
  assert.equal(writes(h).length,1);assert.equal(writes(h)[0].action,'sell-gear-batch');assert.equal(writes(h)[0].body.itemIds.length,100);
  assert.match(writes(h)[0].body.requestId,/^[A-Za-z0-9_-]{6,64}$/);assert.equal(h.draft.selected.length,0);h.module.dispose();
});

test('precious sale needs explicit checkbox, back cancels, and a changed gear projection invalidates preview',async()=>{
  const me=player([equipment('precious',{rarity:'supreme',enhance:7})]);
  const h=harness({mode:'item',itemId:'precious',me});await settle();
  await h.root.click('preview-sell','precious');
  assert.match(h.root.innerHTML,/珍貴裝備/);assert.equal(h.root.button('confirm').disabled,true);
  await h.root.click('confirm');assert.equal(writes(h).length,0);
  assert.equal(h.module.handleBack(),true);assert.equal(h.module.handleBack(),false);
  await h.root.click('preview-sell','precious');
  await h.root.change('inventoryPreciousAck','',{checked:true});assert.equal(h.root.button('confirm').disabled,false);
  const next=h.getMe();next.character.revision=2;next.equipment[0].enhance=8;h.module.update(next);
  assert.doesNotMatch(h.root.innerHTML,/data-inv-confirm/);assert.match(h.root.innerHTML,/請重新預覽/);assert.equal(writes(h).length,0);
  h.module.dispose();
});

test('explicitly acknowledged precious sale uses server price and single-item API',async()=>{
  const h=harness({mode:'item',itemId:'rare',me:player([equipment('rare',{enhance:3,sellPrice:73})])});await settle();
  await h.root.click('preview-sell','rare');await h.root.change('inventoryPreciousAck','',{checked:true});await h.root.click('confirm');
  assert.equal(writes(h)[0].action,'sell-gear');assert.equal(writes(h)[0].body.itemId,'rare');assert.match(h.root.innerHTML,/取得 73 金幣/);
  h.module.dispose();
});

test('potions and skill books never invent use APIs; material and supply navigation stays in host shell',async()=>{
  const potion=harness({mode:'item',itemId:'red_1'});await settle();
  assert.doesNotMatch(potion.root.innerHTML,/data-inv-action="preview-use"/);assert.match(potion.root.innerHTML,/戰鬥依補給設定使用/);
  const supply=[...potion.root.innerHTML.matchAll(/<button\b[^>]*>/g)].map(m=>m[0]).find(t=>attribute(t,'data-route')==='supplies');
  await potion.root.fire('click',potion.root.target({dataset:{invAction:'navigate',route:attribute(supply,'data-route')}}));
  assert.equal(potion.navigations[0].route,'supplies');assert.equal(writes(potion).length,0);potion.module.dispose();
  const book=harness({mode:'item',itemId:'book_slash'});await settle();
  assert.match(book.root.innerHTML,/主場技能操作尚未移入/);assert.doesNotMatch(book.root.innerHTML,/data-route="skills"/);assert.equal(writes(book).length,0);book.module.dispose();
  const material=harness({mode:'item',itemId:'atlas:laurel_shard'});await settle();
  assert.match(material.root.innerHTML,/data-route="inscription"/);material.module.dispose();
});

test('late initial load and mismatched actor projections cannot cross character/realm context',async()=>{
  const wait=deferred(),h=harness({override:action=>action==='me'?wait.promise:undefined});
  const html=h.root.innerHTML;h.setContext({characterId:'c2',realmId:'season_2',epoch:2});wait.resolve(player());
  await settle();assert.equal(h.root.innerHTML,html);assert.equal(h.changed.length,0);h.module.dispose();
  const same=harness();await settle();const original=same.root.innerHTML,wrong=player();
  wrong.character.tgId='c2';wrong.character.name='另一角色';wrong.character.revision=99;same.module.update(wrong);
  assert.equal(same.root.innerHTML,original);assert.doesNotMatch(same.root.innerHTML,/另一角色/);same.module.dispose();
});

test('non-receipted lost gacha response only reads back, does not retry on update/remount, and requires acknowledgement',async()=>{
  let throws=0;
  const h=harness({mode:'item',itemId:'gacha_weapon',override:action=>{
    if(action==='gacha/open'){throws++;throw Object.assign(new Error('connection lost'),{uncertain:true});}
  }});await settle();
  await h.root.click('preview-use','gacha_weapon');await h.root.click('confirm');
  assert.equal(throws,1);assert.equal(writes(h).length,1);assert.ok(h.draft.pending);assert.equal(h.draft.pending.receipt,false);
  assert.match(h.root.innerHTML,/不會自動再執行/);assert.doesNotMatch(h.root.innerHTML,/data-inv-action="recover"/);
  h.module.update();await h.root.click('refresh');assert.equal(throws,1);
  const saved=clone(h.draft);h.module.dispose();
  const again=harness({mode:'item',itemId:'gacha_weapon',draft:saved,api:h.api,storage:h.storage});await settle();
  assert.equal(writes(again).length,0);assert.ok(again.draft.pending);
  await again.root.click('acknowledge');assert.equal(again.draft.pending,undefined);assert.equal(writes(again).length,0);again.module.dispose();
});

test('Fate gift uncertain result can recover only by explicit click using original exact receipt payload',async()=>{
  let opens=0,first;
  const h=harness({mode:'item',itemId:'fate_cycle_gift',override:(action,body,world)=>{
    if(action!=='fate/gifts/open')return;
    opens++;
    if(opens===1){first=clone(body);const next=world.me;next.inventory.fate_cycle_gift=0;next.inventory.scroll_w+=2;next.character.revision++;world.me=next;throw Object.assign(new Error('lost after commit'),{uncertain:true});}
    assert.deepEqual(clone(body),first);return {ok:true,replayed:true,result:{giftId:'gift-one',items:{scroll_w:2}}};
  }});await settle();
  await h.root.click('preview-use','fate_cycle_gift');await h.root.click('confirm');
  assert.equal(opens,1);assert.equal(h.draft.pending.receipt,true);assert.match(h.root.innerHTML,/以原編號查回結果/);
  h.module.update();await settle();assert.equal(opens,1);
  await h.root.click('recover');assert.equal(opens,2);assert.deepEqual(writes(h)[0].body,writes(h)[1].body);
  assert.equal(h.draft.pending,undefined);assert.equal(h.getMe().inventory.scroll_w,7);assert.equal(h.changed.length,1);h.module.dispose();
});

test('late completed write after a context switch cannot update new UI or notify its host',async()=>{
  const wait=deferred();
  const h=harness({mode:'item',itemId:'gacha_weapon',override:action=>action==='gacha/open'?wait.promise:undefined});await settle();
  await h.root.click('preview-use','gacha_weapon');
  const running=h.root.click('confirm');await settle();
  assert.equal(writes(h).length,1);assert.equal(h.module.handleBack(),true);
  const html=h.root.innerHTML,reads=h.calls.filter(c=>c.action==='me').length;
  h.setContext({characterId:'c2',realmId:'s2',epoch:2});wait.resolve({ok:true,result:{item:equipment('late')}});
  await running;assert.equal(h.root.innerHTML,html);assert.equal(h.changed.length,0);assert.ok(h.draft.pending);
  assert.equal(h.calls.filter(c=>c.action==='me').length,reads);h.module.dispose();
});

test('successful action stays acknowledged when follow-up me fails; low revision cannot overwrite newer full data',async()=>{
  let completed=false;
  const h=harness({mode:'item',itemId:'gacha_weapon',override:(action,body,world)=>{
    if(action==='gacha/open'){completed=true;const next=world.me;next.inventory.gacha_weapon=0;next.character.revision=5;world.me=next;return {...clone(next),result:{item:equipment('reward')}};}
    if(action==='me'&&completed)throw Object.assign(new Error('read offline'),{uncertain:true});
  }});await settle();
  await h.root.click('preview-use','gacha_weapon');await h.root.click('confirm');
  assert.equal(h.draft.pending,undefined);assert.equal(writes(h).length,1);assert.equal(h.changed.length,1);
  assert.match(h.root.innerHTML,/操作已完成，最新背包暫時未同步/);assert.doesNotMatch(h.root.innerHTML,/上次操作結果待確認/);
  h.module.dispose();
  const next=player();next.character.revision=8;const k=harness({me:next});await settle();
  const old=player();old.character.revision=1;old.character.name='過期名字';k.module.update(old);assert.doesNotMatch(k.root.innerHTML,/過期名字/);k.module.dispose();
});

test('disposed module removes every listener and aborts outstanding reads',async()=>{
  const wait=deferred(),h=harness({override:action=>action==='me'?wait.promise:undefined});
  const signal=h.calls[0].signal,html=h.root.innerHTML;h.module.dispose();
  assert.equal(signal.aborted,true);
  for(const listeners of h.root.events.values())assert.equal(listeners.size,0);
  wait.resolve(player());await settle();assert.equal(h.root.innerHTML,html);assert.equal(h.changed.length,0);
});

test('second sale checkbox retains exact item focus after selection and reordered background redraw while draft selections persist',async()=>{
  const draft={selected:['one']},h=harness({draft});await settle();
  const boxes=h.root.querySelectorAll('[name="inventorySelected"]');
  assert.equal(boxes.length,2);assert.equal(boxes[1].dataset.itemId,'two');
  boxes[1].focus();boxes[1].checked=true;
  await h.root.fire('change',boxes[1]);
  assert.equal(h.root.ownerDocument.activeElement.name,'inventorySelected');
  assert.equal(h.root.ownerDocument.activeElement.dataset.itemId,'two');
  assert.equal(h.root.ownerDocument.activeElement.checked,true);
  assert.deepEqual([...draft.selected],['one','two']);
  const next=h.getMe();next.character.revision=2;next.equipment.reverse();
  h.module.update(next);
  assert.equal(h.root.ownerDocument.activeElement.dataset.itemId,'two');
  assert.equal(h.root.ownerDocument.activeElement.checked,true);
  assert.deepEqual([...draft.selected],['one','two']);
  assert.equal(h.calls.filter(c=>c.action==='me').length,1);
  h.module.dispose();
});

test('IME composition keeps the same input DOM through background updates and paints accepted data only after composition ends',async()=>{
  const draft={selected:['one']},h=harness({draft});await settle();
  const input=h.root.querySelector('[name="inventorySearch"]');
  input.focus();await h.root.fire('compositionstart',input);
  input.value='月';input.selectionStart=1;input.selectionEnd=1;
  await h.root.fire('input',input,{isComposing:true});
  const html=h.root.innerHTML;
  const next=h.getMe();next.character.revision=2;next.character.gold=987;next.equipment[0].name='月桂新裝備';
  h.module.update(next);
  assert.equal(h.root.innerHTML,html);
  assert.equal(h.root.querySelector('[name="inventorySearch"]'),input);
  assert.equal(h.root.ownerDocument.activeElement,input);
  assert.equal(draft.query,'月');
  input.value='月桂';input.selectionStart=2;input.selectionEnd=2;
  await h.root.fire('input',input,{isComposing:true});
  next.character.revision=3;next.equipment.reverse();h.module.update({me:next});
  assert.equal(h.root.querySelector('[name="inventorySearch"]'),input);
  assert.deepEqual([...draft.selected],['one']);
  await h.root.fire('compositionend',input);
  const restored=h.root.querySelector('[name="inventorySearch"]');
  assert.notEqual(restored,input);
  assert.equal(restored.value,'月桂');assert.equal(restored.selectionStart,2);
  assert.equal(h.root.ownerDocument.activeElement,restored);
  assert.match(h.root.innerHTML,/金幣 <b>987<\/b>/);assert.match(h.root.innerHTML,/月桂新裝備/);
  assert.deepEqual([...draft.selected],['one']);assert.equal(h.calls.filter(c=>c.action==='me').length,1);
  h.module.dispose();
  for(const listeners of h.root.events.values())assert.equal(listeners.size,0);
});

test('pending receipt survives character switches with fresh form drafts and isolates other account, realm and character identities',async()=>{
  const storage=memoryStorage();
  const first=harness({mode:'item',itemId:'fate_cycle_gift',storage,draft:{query:'舊搜尋',selected:['one']},override:action=>{
    if(action==='fate/gifts/open')throw Object.assign(new Error('lost receipt'),{uncertain:true});
  }});await settle();
  await first.root.click('preview-use','fate_cycle_gift');await first.root.click('confirm');
  const original=clone(first.draft.pending),body=clone(writes(first)[0].body);
  first.setContext({characterId:'c2',epoch:2});first.module.dispose();
  for(const context of [
    {accountId:'a1',realmId:'permanent',characterId:'c2',epoch:2},
    {accountId:'a2',realmId:'permanent',characterId:'c1',epoch:2},
    {accountId:'a1',realmId:'season',characterId:'c1',epoch:2}
  ]){
    const me=player();me.character.tgId=context.characterId;
    const other=harness({api:first.api,storage,context,me});await settle();
    assert.equal(other.draft.pending,undefined);assert.doesNotMatch(other.root.innerHTML,/data-inv-pending/);
    assert.equal(writes(other).length,0);other.module.dispose();
  }
  const returned=harness({api:first.api,storage,mode:'inventory',context:{accountId:'a1',realmId:'permanent',characterId:'c1',epoch:3},override:(action,payload)=>{
    if(action==='fate/gifts/open'){assert.deepEqual(clone(payload),body);return {ok:true,replayed:true,result:{giftId:'saved-gift',items:{scroll_w:2}}};}
  }});await settle();
  assert.deepEqual(clone(returned.draft.pending),original);
  assert.equal(returned.draft.query,'');assert.deepEqual([...returned.draft.selected],[]);
  assert.equal(writes(returned).length,0);assert.match(returned.root.innerHTML,/以原編號查回結果/);
  await returned.root.click('recover');
  assert.equal(writes(returned).length,1);assert.deepEqual(writes(returned)[0].body,body);
  assert.equal(returned.draft.pending,undefined);returned.module.dispose();
});

test('non-receipted pending survives a fresh module and epoch but a cleared operation cannot be resurrected by another route draft',async()=>{
  const storage=memoryStorage(),first=harness({mode:'item',itemId:'gacha_weapon',storage,override:action=>{
    if(action==='gacha/open')throw Object.assign(new Error('unknown result'),{uncertain:true});
  }});await settle();
  await first.root.click('preview-use','gacha_weapon');await first.root.click('confirm');
  const staleDraft=clone(first.draft),original=clone(first.draft.pending);
  first.module.dispose();
  // A fresh VM models reloading the module; sessionStorage, not route draft, restores it.
  const returned=harness({mode:'inventory',storage,context:{accountId:'a1',realmId:'permanent',characterId:'c1',epoch:5}});await settle();
  assert.deepEqual(clone(returned.draft.pending),original);assert.equal(writes(returned).length,0);
  assert.doesNotMatch(returned.root.innerHTML,/data-inv-action="recover"/);
  await returned.root.click('acknowledge');assert.equal(returned.draft.pending,undefined);returned.module.dispose();
  const otherRoute=harness({mode:'equipment',api:returned.api,storage,draft:staleDraft,context:{accountId:'a1',realmId:'permanent',characterId:'c1',epoch:5}});await settle();
  assert.equal(otherRoute.draft.pending,undefined);assert.doesNotMatch(otherRoute.root.innerHTML,/data-inv-pending/);assert.equal(writes(otherRoute).length,0);otherRoute.module.dispose();
  const freshAfterClear=harness({storage,draft:{...clone(staleDraft),pending:clone(original)},context:{accountId:'a1',realmId:'permanent',characterId:'c1',epoch:6}});await settle();
  assert.equal(freshAfterClear.draft.pending,undefined);assert.doesNotMatch(freshAfterClear.root.innerHTML,/data-inv-pending/);freshAfterClear.module.dispose();
});

test('disposed old completion cannot clear a newer pending operation for the same identity',async()=>{
  const storage=memoryStorage(),late=deferred();
  const first=harness({mode:'item',itemId:'gacha_weapon',storage,override:action=>action==='gacha/open'?late.promise:undefined});await settle();
  await first.root.click('preview-use','gacha_weapon');const running=first.root.click('confirm');await settle();
  const old=clone(first.draft.pending);first.module.dispose();
  const current=harness({mode:'item',itemId:'gacha_weapon',api:first.api,storage,context:{accountId:'a1',realmId:'permanent',characterId:'c1',epoch:3},override:action=>{
    if(action==='gacha/open')throw Object.assign(new Error('new result unknown'),{uncertain:true});
  }});await settle();
  assert.equal(current.draft.pending.id,old.id);
  await current.root.click('acknowledge');await current.root.click('preview-use','gacha_weapon');await current.root.click('confirm');
  const newer=clone(current.draft.pending);assert.notEqual(newer.id,old.id);
  const persisted=[...storage.values.values()];
  late.resolve({ok:true,result:{item:equipment('late-reward')}});await running;
  current.module.update();
  assert.deepEqual(clone(current.draft.pending),newer);assert.deepEqual([...storage.values.values()],persisted);
  assert.equal(first.changed.length,0);assert.match(current.root.innerHTML,/data-inv-pending/);current.module.dispose();
});

test('blocked session storage uses identity memory across switches and keeps cleared tombstones over stale route mirrors',async()=>{
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  const first=harness({mode:'item',itemId:'gacha_weapon',storage:blocked,override:action=>{
    if(action==='gacha/open')throw Object.assign(new Error('unknown'),{uncertain:true});
  }});await settle();await first.root.click('preview-use','gacha_weapon');await first.root.click('confirm');
  const oldDraft=clone(first.draft),pending=clone(first.draft.pending);first.module.dispose();
  const again=harness({api:first.api,storage:blocked,context:{accountId:'a1',realmId:'permanent',characterId:'c1',epoch:9}});await settle();
  assert.deepEqual(clone(again.draft.pending),pending);assert.equal(writes(again).length,0);
  await again.root.click('acknowledge');again.module.dispose();
  const oldRoute=harness({api:first.api,storage:blocked,draft:oldDraft,mode:'equipment',context:{accountId:'a1',realmId:'permanent',characterId:'c1',epoch:9}});await settle();
  assert.equal(oldRoute.draft.pending,undefined);assert.doesNotMatch(oldRoute.root.innerHTML,/data-inv-pending/);assert.equal(writes(oldRoute).length,0);oldRoute.module.dispose();
});

test('inventory mounts its stylesheet once per document using the module URL and can retry a failed link on a later mount',async()=>{
  const links=[],appended=[];
  const doc={activeElement:null,baseURI:'http://127.0.0.1:9693/nested/view.html',
    querySelector(selector){if(selector==='link[data-scene-inventory-style]')return links.find(link=>link.dataset.sceneInventoryStyle)||null;if(selector==='script[src*="scene-inventory-ui.js"]')return {src:'http://127.0.0.1:9693/scene-inventory-ui.js?v=unified-ui-20261104'};return null;},
    createElement(tag){assert.equal(tag,'link');return {dataset:{},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},remove(){const at=links.indexOf(this);if(at>=0)links.splice(at,1);}};},
    head:{append(link){links.push(link);appended.push(link);}}
  };
  const first=harness({document:doc});await settle();
  assert.equal(links.length,1);assert.equal(links[0].rel,'stylesheet');assert.equal(links[0].dataset.sceneInventoryStyle,'true');
  assert.equal(links[0].href,'http://127.0.0.1:9693/scene-inventory-ui.css?v=unified-ui-20261104');first.module.dispose();
  const second=harness({document:doc,api:first.api,storage:first.storage,mode:'equipment'});await settle();
  assert.equal(links.length,1);assert.equal(appended.length,1);second.module.dispose();
  links[0].listeners.error();
  const third=harness({document:doc,api:first.api,storage:first.storage,mode:'item',itemId:'one'});await settle();
  assert.equal(links.length,1);assert.equal(appended.length,2);third.module.dispose();
});

test('real session HTTP 200 version races wait for me scene refresh and reread stale material status once without a false warning',async t=>{
  const sessionSource=fs.readFileSync(new URL('../public/scene-live-session.js',import.meta.url),'utf8');
  const endpoint='http://127.0.0.1:9692/app/api/',net=[],clientErrors=[];
  const fetch=(url,options)=>{const pending=deferred();const call={action:url.slice(endpoint.length),body:JSON.parse(options.body),reply(data){call.status=200;pending.resolve({ok:true,status:200,json:async()=>clone(data)});}};net.push(call);return pending.promise;};
  let timer=0;
  const sandbox={AbortController,queueMicrotask,console,fetch,setTimeout:()=>++timer,clearTimeout(){},setInterval:()=>++timer,clearInterval(){}};
  vm.runInNewContext(sessionSource,sandbox,{filename:'scene-live-session.js'});
  const client=sandbox.RpgSceneSession.create({endpoint,fetch,accountId:'a1',realmId:'permanent',characterId:'c1'});
  const scene=revision=>({schemaVersion:1,accountId:'a1',realmId:'permanent',characterId:'c1',serverNow:1000*revision,character:{name:'靖澄',level:20},live:{revision,partyId:null,activeRunId:null},run:null});
  const status=(revision,quantity)=>({ok:true,realmId:'permanent',characterId:'c1',enabled:true,scene:scene(revision),materials:{laurel_shard:quantity},run:null});
  const h=harness({override:async(action,body)=>{try{return await client.request(action,body);}catch(error){clientErrors.push({action,code:error.code});throw error;}}});
  t.after(()=>{h.module.dispose();client.dispose();});
  assert.deepEqual(net.map(call=>call.action),['me']);
  net[0].reply(player());await settle();
  assert.deepEqual(net.map(call=>call.action),['me','atlas/status']);
  // This first status belongs to /me's side-effect refresh; the inventory must await it.
  net[1].reply(status(1,3));await settle();
  assert.deepEqual(net.slice(2).map(call=>call.action),['meta','atlas/status','atlas/catalog','equipment-recovery']);
  const oldStatus=net[3];
  net[2].reply({ok:true,meta:{items:{},trade:{tradeableItems:[]}}});
  net[4].reply({ok:true,catalog:{materials:[{id:'laurel_shard',name:'月桂碎片'}]}});
  net[5].reply({ok:true,realmId:'permanent',characterId:'c1',enabled:true,dust:9,items:[]});
  // A legitimate background read wins the session version barrier before the old material read.
  const background=client.refresh();net.at(-1).reply(status(2,7));await background;
  oldStatus.reply(status(1,3));await settle();
  assert.equal(net.filter(call=>call.action==='atlas/status').length,4);
  net.at(-1).reply(status(2,7));await settle();
  assert.deepEqual(clientErrors,[{action:'atlas/status',code:'stale_response'}]);
  assert.ok(net.every(call=>call.status===200));
  assert.doesNotMatch(h.root.innerHTML,/星圖持有材料暫時未同步/);
  assert.match(h.root.innerHTML,/data-inv-row="atlas:laurel_shard"[\s\S]*?<span class="si-row-value">×7/);
  for(let i=0;i<8;i++)h.module.update(scene(2));
  assert.equal(net.filter(call=>call.action==='me').length,1);assert.equal(writes(h).length,0);
});

test('true Atlas material failures remain visible and repeated stale reads are bounded without repeating me',async()=>{
  for(const [code,expected]of [['connection_failed',1],['stale_response',2]]){
    const h=harness({override:action=>{if(action==='atlas/status')throw Object.assign(new Error('material read unavailable'),{code,uncertain:false});}});await settle();
    assert.equal(h.calls.filter(call=>call.action==='atlas/status').length,expected);
    assert.match(h.root.innerHTML,/星圖持有材料暫時未同步/);
    for(let i=0;i<5;i++)h.module.update();
    assert.equal(h.calls.filter(call=>call.action==='me').length,1);
    assert.equal(h.calls.filter(call=>call.action==='atlas/status').length,expected);assert.equal(writes(h).length,0);h.module.dispose();
  }
});

test('stale material status is never retried after the character context changes',async()=>{
  const delayed=deferred(),h=harness({override:action=>action==='atlas/status'?delayed.promise:undefined});await settle();
  assert.equal(h.calls.filter(call=>call.action==='atlas/status').length,1);
  const html=h.root.innerHTML;h.setContext({characterId:'c2',epoch:2});
  delayed.reject(Object.assign(new Error('stale from old character'),{code:'stale_response',uncertain:false}));await settle();
  assert.equal(h.calls.filter(call=>call.action==='atlas/status').length,1);assert.equal(h.root.innerHTML,html);h.module.dispose();
});


test('original inventory art and new Atlas materials survive list/detail projections without consuming items',async()=>{
 const h=harness({override:async action=>{
  if(action==='meta')return {ok:true,meta:{items:{red_1:{name:'red',kind:'red',iconSrc:'/art/potions-20261019/red_1.webp'},scroll_w:{name:'scroll',kind:'scroll',iconSrc:'/art/items-scrolls-cutout-20261011/scroll_w.webp'}}}};
  if(action==='atlas/status')return {ok:true,enabled:true,realmId:'permanent',characterId:'c1',materials:{atlas_shard:7}};
  if(action==='atlas/catalog')return {ok:true,catalog:{materials:[{id:'atlas_shard',name:'shard',iconSrc:'/art/materials-20261110/atlas_shard.png'}]}};
 }});await settle();
 for(const path of ['/art/potions-20261019/red_1.webp','/art/items-scrolls-cutout-20261011/scroll_w.webp','/art/materials-20261110/atlas_shard.png','/art/materials-20261110/recovery_dust.png'])assert.ok(h.root.innerHTML.includes('https://assets.invalid'+path),path);
 await h.root.click('detail','atlas:atlas_shard');assert.ok(h.root.innerHTML.includes('/art/materials-20261110/atlas_shard.png'));assert.equal(writes(h).length,0);h.module.dispose();
});

test('classic item stats: quality colour, compact stat line, 部位分頁 tabs and full detail rows from existing fields',async()=>{
  const ring=equipment('ring-1',{slot:'ring',slotName:'戒指',name:'星環指環',rarity:'epic',rarityName:'極品',mode:'hell',modeName:'地獄',levelReq:481,statName:'魔力',stat:90,
    enhance:3,enhanceNext:{success:.4,nothing:.5,break:.1},enhanceGrowth:{statName:'魔力',byLevel:[60,70,80,90,99]},towerImprint:{level:2,max:5,bonusPct:4},affix:{critPct:.02},
    affixes:{quality:'S',slots:2,lines:[{name:'暴擊',value:.031,quality:'S',recommended:true}]}});
  const h=harness({me:player([equipment('one'),ring]),override:action=>action==='equipment-recovery'?{ok:true,realmId:'permanent',characterId:'c1',enabled:true,dust:0,items:[{id:'ring-1',archived:true}]}:undefined});
  await settle();
  const html=h.root.innerHTML;
  assert.match(html,/<nav class="si-slot-tabs" aria-label="裝備部位分頁">/);
  for(const name of ['全部','武器','頭盔','盔甲','手套','長靴','腰帶','內衣','耳環','戒指'])assert.match(html,new RegExp('data-inv-action="slot-tab" data-slot="[a-z]+" aria-pressed="(?:true|false)">'+name+'<small>'));
  assert.match(html,/data-slot="all" aria-pressed="true">全部<small>2<\/small>/);
  assert.match(html,/<strong class="sis-q-epic">\+3 星環指環<\/strong>/,'quality colour + enhancement on the list title');
  assert.match(html,/魔力 90 · 風 \+2 · 生命值 \+5 · 爆擊 \+1% · ✦遺物詞條 · 詞條 1\/2 S · 塔印 2/,'compact line: main, element, extras, relic, affix summary, imprint');
  assert.match(html,/極品 · 地獄 · T1 · 戒指 · Lv\.481/);
  await h.root.fire('click',h.root.button('slot-tab'));
  const tab=h.root.target({dataset:{invAction:'slot-tab',slot:'ring'}});await h.root.fire('click',tab);
  assert.equal(h.draft.slot,'ring');assert.equal(h.draft.category,'equipment');
  assert.doesNotMatch(h.root.innerHTML,/data-inv-row="one"/);assert.match(h.root.innerHTML,/data-inv-row="ring-1"/);
  assert.match(h.root.innerHTML,/data-slot="ring" aria-pressed="true">戒指/);
  await h.root.fire('click',h.root.target({dataset:{invAction:'slot-tab',slot:'all'}}));
  assert.equal(h.draft.slot,'all');assert.equal(h.draft.category,'all');assert.match(h.root.innerHTML,/data-inv-row="one"/);
  const stats=h.api.stats;
  assert.equal(stats.enhanceText(ring),'+3 → +4：成功 40% · 爆裝 10%');
  assert.deepEqual(clone(stats.gain(ring)),{name:'魔力',before:90,after:99,delta:9,from:3,to:4});
  const rows=Object.fromEntries(stats.kvRows(ring,{archived:true}));
  assert.equal(rows['裝備階'],'T1 · Lv.481');assert.equal(rows['世界模式'],'地獄');assert.equal(rows['遺物詞條'],'爆擊 +2%');assert.equal(rows['典藏'],'已典藏');
  assert.equal(rows['塔印'],'2／5 · 主能力 +4%（已計入）');assert.equal(rows['交易'],'可交易');
  assert.equal(stats.modeName({mode:'normal',modeName:'普通'}),'','normal mode stays implicit like classic names');
  assert.equal(stats.compactLine({}),'','absent fields are skipped, never invented');
  const d=harness({mode:'item',itemId:'ring-1',me:player([ring]),override:action=>action==='equipment-recovery'?{ok:true,realmId:'permanent',characterId:'c1',enabled:true,dust:0,items:[{id:'ring-1',archived:true}]}:undefined});
  await settle();
  const detail=d.root.innerHTML;
  assert.match(detail,/<h3 class="sis-q-epic">\+3 星環指環<\/h3>/);
  for(const [k,v] of [['裝備階','T1 · Lv.481'],['世界模式','地獄'],['強化','+3 → +4：成功 40% · 爆裝 10%'],['典藏','已典藏']])assert.ok(detail.includes('<dt>'+k+'</dt><dd>'+v+'</dd>'),k);
  assert.match(detail,/強化成功後 · \+3 → \+4：魔力 90 → <b>99<\/b>（\+9）/);
});
