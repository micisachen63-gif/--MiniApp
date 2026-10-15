import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
function fixture(api){
 const state={create:{step:2,name:'測試盜賊',cls:'thief',gender:'f',slot:2},meta:{classes:{thief:{releaseReady:true}}},me:null,creating:true},pending=new Map(),calls=[],toasts=[];let sequence=0,go;
 const context=vm.createContext({S:state,tg:{initDataUnsafe:{user:{id:111}}},devTg:null,window:{RpgThiefClass:{selectableClasses:x=>x}},
  $:selector=>selector==='#go'?go:null,render(){},haptic(){},toast:x=>toasts.push(x),openCharacterSelect(){},
  pendingRequestId:key=>{if(!pending.has(key))pending.set(key,'creation_ui_'+(++sequence));return pending.get(key);},clearPendingRequest:key=>pending.delete(key),
  api:async(action,body)=>{calls.push({action,body});return api(action,body,calls.length);}});
 vm.runInContext(slice('  function mutationKey(','  function pendingRequestId(')+slice('  function bindCreate(','  function characterSelectView('),context);
 const bind=()=>{go={disabled:false};context.bindCreate({querySelectorAll:()=>[]});return go;};
 return {state,pending,calls,toasts,bind};
}
test('create uses its committed response list without an extra fallible characters read',async()=>{
 const chars=[{charId:'new-thief',slot:2}],f=fixture(async()=>({ok:true,characters:chars}));await f.bind().onclick();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'create');assert.deepEqual(f.state.characters,chars);assert.equal(f.state.choosing,true);assert.equal(f.pending.size,0);
});
test('uncertain response retains draft and account-scoped UUID even if refresh discovers the new first character',async()=>{
 const f=fixture(async(_action,_body,n)=>{if(n===1)throw Object.assign(Error('lost response'),{uncertain:true});return {characters:[{charId:'new-thief',slot:2}]};});
 await f.bind().onclick();assert.equal(f.state.creating,true);assert.equal(f.state.create.name,'測試盜賊');assert.match(f.toasts[0],/不會重複建立/);
 f.state.me={character:{tgId:'newly-discovered'}};await f.bind().onclick();
 assert.equal(f.calls[0].body.requestId,f.calls[1].body.requestId);assert.equal(f.state.choosing,true);assert.equal(f.pending.size,0);
});
test('rerendered submit is blocked while the previous creation is in flight; changed input gets a fresh request',async()=>{
 let complete;const f=fixture(()=>new Promise(resolve=>complete=resolve));const first=f.bind().onclick();
 await f.bind().onclick();assert.equal(f.calls.length,1);complete({characters:[]});await first;assert.equal(f.state.creationFlight,false);
 const failure=fixture(async()=>{throw Error('角色名稱已被使用');});await failure.bind().onclick();failure.state.create.name='另一個盜賊';await failure.bind().onclick();assert.notEqual(failure.calls[0].body.requestId,failure.calls[1].body.requestId);
});
