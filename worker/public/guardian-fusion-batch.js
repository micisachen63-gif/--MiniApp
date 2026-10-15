/* Each group retains the existing atomic fuse receipt. A queue never retries
 * an uncertain operation or reuses an output as another group's material. */
(() => {
  'use strict';
  const C=window.RpgGuardianContract;
  function restore(raw,charId){
    if(!raw||raw.charId!==String(charId)||!raw.configVersion||!Array.isArray(raw.groups)||!raw.groups.length)return null;
    const seen=new Set(),groups=[];
    for(const group of raw.groups){
      if(!group||![4,6].includes(group.itemIds?.length)||!group.itemIds.includes(group.primaryId))return null;
      for(const id of group.itemIds)if(typeof id!=='string'||!id||seen.has(id))return null;else seen.add(id);
      groups.push({itemIds:[...group.itemIds],primaryId:group.primaryId,configVersion:raw.configVersion});
    }
    const result={charId:String(charId),configVersion:raw.configVersion,quality:raw.quality,groups,receipts:[]};
    try{for(const receipt of raw.receipts||[])record(result,C.operation(receipt,charId));}catch{return null;}
    return result;
  }
  function create(frozen,charId,quality){return restore({...frozen,charId:String(charId),quality,groups:frozen.groups||[frozen],receipts:[]},charId);}
  function record(plan,receipt){
    if(plan.receipts.some(old=>old.requestId===receipt.requestId))return false;
    const group=plan.groups[plan.receipts.length];
    const resolved=[...receipt.consumedIds,...(receipt.refundedId?[receipt.refundedId]:[])];
    if(!group||receipt.charId!==plan.charId||receipt.action!=='fuse'||receipt.status!=='committed'||receipt.configVersion!==plan.configVersion||receipt.primaryId!==group.primaryId||typeof receipt.success!=='boolean'||receipt.results.length!==1||resolved.length!==group.itemIds.length||new Set(resolved).size!==resolved.length||!group.itemIds.every(id=>resolved.includes(id)))throw Error('合成紀錄與這一組素材不一致，請核對原結果。');
    plan.receipts.push(receipt);return true;
  }
  async function run(plan,{send,persist=()=>{},current=()=>true,onProgress=()=>{}}){
    persist(plan);
    while(current()&&plan.receipts.length<plan.groups.length){
      const group=plan.groups[plan.receipts.length];onProgress(plan);
      const receipt=await send({...group,itemIds:[...group.itemIds]});
      if(!current()||!receipt)break;
      record(plan,receipt);persist(plan);onProgress(plan);
    }
    return plan.receipts.at(-1)||null;
  }
  window.RpgGuardianFusionBatch=Object.freeze({create,restore,record,run});
})();
