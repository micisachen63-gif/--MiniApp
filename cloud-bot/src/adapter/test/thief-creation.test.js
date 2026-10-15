import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpgFlow, creationClasses } from '../rpg-flow.js';
import { createOperationApi } from '../operation-api.js';
import { battleHeroAsset } from '../../renderer/assets.mjs';

function setup(meta, draft={name:'測試盜賊',step:'class'}) {
  const requests=[], telegram=[], sent=[];
  const state={data:{rpg:{drafts:{'123':draft}}},save(){}};
  const flow=createRpgFlow({api:{call:async(method,body)=>{telegram.push({method,body});return true;}},
    send:async(text,options)=>{sent.push({text,options});return {message_id:9};}, answer:async()=>{},
    log:{warn(){}},tgStore:state,inGroup:()=>false,inUserPrivate:()=>true,isGroupMember:async()=>true,
    rpgApi:{call:async(path,body)=>{requests.push({path,body});if(path==='/rpg/meta'){if(meta instanceof Error)throw meta;return {ok:true,meta};}throw Error('Unexpected mutation '+path);}},chatId:-1});
  const cq={id:'fixture',from:{id:123},message:{chat:{id:123,type:'private'},message_id:5}};
  return {flow,state,requests,telegram,sent,cq};
}

test('BOT class choices use authoritative gate and keep thief closed without metadata',()=>{
  assert.deepEqual(Object.keys(creationClasses(null)),['sword','archer','mage']);
  assert.equal(creationClasses({classes:{thief:{releaseReady:false}}}).thief,undefined);
  assert.equal(creationClasses({classes:{thief:{}}}).thief,undefined);
  assert.equal(creationClasses({classes:{thief:{releaseReady:true,name:'盜賊',emoji:'🗡️'}}}).thief.n,'盜賊');
});

test('BOT naming menu hides unreleased thief and displays it only after server approval',async()=>{
  for(const ready of [false,true]){
    const t=setup({classes:{thief:{releaseReady:ready}}},{step:'name',promptId:7});
    const result=await t.flow.onMessage({chat:{id:123,type:'private'},from:{id:123},reply_to_message:{message_id:7}},'測試角色');
    assert.equal(result.rpg,'create-class');
    const buttons=t.sent[0].options.reply_markup.inline_keyboard.flat().map(x=>x.callback_data);
    assert.equal(buttons.includes('rpg:cc:thief'),ready);
    assert.equal(t.requests.filter(x=>x.path==='/rpg/meta').length,1);
  }
});

test('stale thief buttons are rejected before create at class, gender and final confirmation steps',async()=>{
  for(const [action,arg,draft] of [['cc','thief',{step:'class',name:'測試盜賊'}],['cg','f',{step:'gender',baseClass:'thief',name:'測試盜賊'}],['ck',undefined,{step:'confirm',baseClass:'thief',gender:'m',name:'測試盜賊'}]]){
    const t=setup({classes:{thief:{releaseReady:false}}},draft);
    const result=await t.flow.onCallback(t.cq,action,arg);
    assert.equal(result.rpg,'stale');
    assert.deepEqual(t.requests.map(x=>x.path),['/rpg/meta']);
  }
});

test('metadata failure cannot open thief, while approved thief reaches gender selection',async()=>{
  const down=setup(Error('unavailable'));
  assert.equal((await down.flow.onCallback(down.cq,'cc','thief')).rpg,'stale');
  const ready=setup({classes:{thief:{releaseReady:true}}});
  assert.equal((await ready.flow.onCallback(ready.cq,'cc','thief')).rpg,'create-gender');
  assert.match(ready.telegram.find(x=>x.method==='editMessageText').body.text,/盜賊/);
});

test('BOT media refuses missing thief identity instead of drawing a sword hero',()=>{
  for(const gender of ['m','f'])for(const classPath of ['', 'A1', 'B222'])assert.throws(()=>battleHeroAsset({base:'thief',gender,classPath}),{code:'hero_art_not_ready'});
  assert.equal(battleHeroAsset({base:'sword',gender:'m',classPath:''}).key,'sword_m');
});


test('creation metadata remains a fresh read when the same Telegram update is retried',async()=>{
  let count=0;
  const store={data:{},save(){}};
  const api=createOperationApi({store,base:{call:async(path,body)=>{
    assert.equal(path,'/rpg/meta');assert.equal(body.requestId,undefined);
    return {meta:{classes:{thief:{releaseReady:++count===1}}}};
  }}});
  const first=await api.runUpdate({update_id:1},()=>api.call('/rpg/meta',{}));
  const second=await api.runUpdate({update_id:1},()=>api.call('/rpg/meta',{}));
  assert.equal(first.meta.classes.thief.releaseReady,true);
  assert.equal(second.meta.classes.thief.releaseReady,false);
  assert.equal(store.data.cloudOperations,undefined);
});
