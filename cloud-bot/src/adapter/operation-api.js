import {synchronousSave} from './persistent-map.js';
const READS=new Set(['/rpg/meta','/rpg/me','/rpg/shop','/rpg/boss/get','/rpg/share/get','/rpg/trade/get','/rpg/pk/get','/rpg/party/get','/rpg/expedition/me','/rpg/journal','/rpg/journal/card','/rpg/outbox/status','/rpg/guardian/state','/rpg/background/status']);
const REPLAY_SAFE=new Set(['/rpg/star-ring/recruit/join','/rpg/daily','/rpg/refill','/rpg/buy','/rpg/buy-gear','/rpg/enhance','/rpg/advance','/rpg/reselect','/rpg/party/action','/rpg/party/reward','/rpg/expedition/trade']);
const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
function error(code,message,status=0){return Object.assign(new Error(message),{code,status});}
export function createOperationApi({base,store,now=()=>Date.now()}){
  let context=null;
  const fallback=()=>store.data.cloudOperations??={};
  const get=key=>store.operations?.get?store.operations.get(key):fallback()[key];
  const put=(key,value)=>{
    if(store.operations?.put){const result=store.operations.put(key,value);if(result&&typeof result.then==='function')throw new TypeError('BOT operation receipts must commit synchronously');}
    else{fallback()[key]=value;synchronousSave(store);}
  };
  async function call(path,originalBody={}){
    // Tick uses the existing outbox lease/ACK contract. Only a handled update has an operation context.
    if(!context||READS.has(path))return base.call(path,originalBody);
    const routeIndex=(context.routes.get(path)||0)+1;context.routes.set(path,routeIndex);
    const operationKey=context.id+':'+path+':'+routeIndex;
    const requestId=originalBody.requestId||'tg-'+(await sha(operationKey)).slice(0,48);
    const body={...originalBody,requestId};
    const fingerprint=await sha(stable({path,body}));
    let cached=get(operationKey);
    if(cached&&cached.fingerprint!==fingerprint)throw error('bot_operation_mismatch','同一操作的內容已改變，原紀錄已保留。',409);
    if(cached?.status==='done')return structuredClone(cached.value);
    if(cached?.status==='failed')throw error(cached.error.code,cached.error.message,cached.error.status);
    if(cached){
      if(typeof base.recoverOperation==='function'){
        const recovered=await base.recoverOperation({path,body,requestId,operationKey});
        if(recovered?.found===true){put(operationKey,{...cached,status:'done',value:recovered.value,completedAt:now()});return recovered.value;}
        if(recovered?.retrySafe===true)cached={...cached,retrySafe:true};
      }
      const certified=cached.retrySafe===true||REPLAY_SAFE.has(path)||(typeof base.isIdempotent==='function'&&base.isIdempotent(path)===true);
      if(!certified)throw error('bot_operation_unknown','這次操作的回覆尚未確認，原進度已保留；請稍後查看遊戲結果。');
    }else{
      cached={version:1,path,body,requestId,fingerprint,status:'prepared',createdAt:now()};
      put(operationKey,cached);
    }
    try{
      let value;try{value=await base.call(path,body);}catch(e){if(e?.code==='conflict')value=await base.call(path,body);else throw e;}
      put(operationKey,{...cached,status:'done',value,completedAt:now()});
      return value;
    }catch(e){
      const status=Number(e?.status||e?.httpStatus)||0;
      const definite=e?.definite===true||(status>=400&&status<500)||['no_character','invalid','forbidden','untradeable','boss_over','cooldown','trade_closed','party_closed','request_mismatch'].includes(e?.code);
      put(operationKey,{...cached,status:definite?'failed':'ambiguous',lastAttemptAt:now(),...(definite?{error:{code:e?.code||'error',message:String(e?.message||'操作未完成'),status}}:{})});
      throw e;
    }
  }
  async function runUpdate(update,fn){
    if(context)throw new Error('Cloud update operations must be serialized');
    if(!Number.isSafeInteger(update?.update_id))throw error('invalid_update','Telegram update_id 不正確',400);
    context={id:'update:'+update.update_id,routes:new Map()};
    try{return await fn();}finally{context=null;}
  }
  return {call,runUpdate};
}
