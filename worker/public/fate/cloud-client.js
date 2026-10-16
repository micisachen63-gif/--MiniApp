import {validRpcId,friendlyError} from './bridge-protocol.js';
export function createCloudClient(host=window){
 let context=null,disposed=false;const waiting=new Map(),contexts=new Set();
 const receive=e=>{
  if(e.origin!==host.location.origin||e.source!==host.parent)return;
  const m=e.data;if(m?.type==='star-fate-context-ready'&&m.charId&&(!context||String(m.charId)===context.charId)){context={charId:String(m.charId),heroName:String(m.heroName||'').slice(0,24),native:m.native||{}};for(const p of contexts){host.clearTimeout(p.timer);p.resolve(context);}contexts.clear();}
  if(m?.type!=='star-fate-rpc-result'||!validRpcId(m.id)||!context||String(m.charId)!==context.charId)return;
  const p=waiting.get(m.id);if(!p)return;waiting.delete(m.id);host.clearTimeout(p.timer);m.error?p.reject(Error(friendlyError(m.error))):p.resolve(m.value);
 };
 host.addEventListener('message',receive);
 const connect=()=>disposed?Promise.reject(Error('旅章已關閉')):context?Promise.resolve(context):new Promise((resolve,reject)=>{const p={resolve,reject};p.timer=host.setTimeout(()=>{contexts.delete(p);reject(Error('連線逾時，請返回冒險後重新開啟旅章。'))},15000);contexts.add(p);host.parent.postMessage({type:'star-fate-context'},host.location.origin);});
 const transport=async(type,action,body={},id=host.crypto.randomUUID())=>{
  await connect();if(disposed)throw Error('旅章已關閉');return new Promise((resolve,reject)=>{const timer=host.setTimeout(()=>{waiting.delete(id);reject(Error(friendlyError('timeout')))},type==='star-fate-native'&&['share-message','download-image'].includes(action)?120000:20000);waiting.set(id,{resolve,reject,timer});host.parent.postMessage({type,id,charId:context.charId,action,body},host.location.origin);});
 };
 return {connect,request:(action,body,id)=>transport('star-fate-rpc',action,body,id),native:(action,body,id)=>transport('star-fate-native',action,body,id),dispose(){disposed=true;host.removeEventListener('message',receive);for(const p of waiting.values()){host.clearTimeout(p.timer);p.reject(Error('旅章已關閉'));}waiting.clear();for(const p of contexts){host.clearTimeout(p.timer);p.reject(Error('旅章已關閉'));}contexts.clear();}};
}
