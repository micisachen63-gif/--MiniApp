(() => {
  'use strict';
  // Translate display fields only; never names, IDs, payload keys or combat state.
  const labels={MaxHP:'生命上限',MaxMP:'魔力上限',ATK:'攻擊力',DEF:'防禦力',DPS:'每秒傷害',EXP:'經驗值',HP:'生命值',MP:'魔力',CD:'冷卻'};
  const displayFields=new Set(['desc','description','effect','passive','passiveText','statName']);
  const statText=s=>s.replace(/(?<![A-Za-z_])(MaxHP|MaxMP|ATK|DEF|DPS|EXP|HP|MP|CD)(?![A-Za-z_])/g,k=>labels[k]);
  function localizeStats(value,parent=''){
    if(Array.isArray(value))return value.map(v=>localizeStats(v,parent));
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,typeof v==='string'&&(displayFields.has(k)||k==='text'&&parent==='passive')?statText(v):localizeStats(v,k)]));
  }
  const safeReads=new Set(['character/delete-preview','character/delete-status','guardian/config','guardian/inventory','guardian/shop/list','guardian/operation','guardian/history','journal','meta','me','characters','exchange/list','exchange/sellable','exchange/mine','exchange/history','shop','boss','ledger','players','trade/list','trade/get','trade/requests','trade/log','pk/list','pk/get','expedition/me','tower/status','party/list','party/get','party/hall','party/hall/get','star-ring/list','star-ring/me','star-ring/get','auto-enhance/status','guardian/auto/status','auto-reroll/status','auto-reroll/options','background/status','background/notice-status','notice/status']);
  async function request(action,body,headers,{signal,timeoutMs=20000}={}){
    const safe=safeReads.has(action),attempts=safe?2:1;
    for(let attempt=0;attempt<attempts;attempt++){
      const controller=new AbortController(),cancel=()=>controller.abort();
      if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(cancel,timeoutMs);
      try{
        const res=await fetch(`/app/api/${action}`,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal});
        if(safe&&[408,429,502,503,504].includes(res.status)){if(attempt+1<attempts)continue;throw new Error('temporary_response');}
        const j=localizeStats(await res.json());return {res,j};
      }catch(cause){
        if(signal?.aborted){const error=new Error('資料更新已暫停。');error.code='request_cancelled';error.uncertain=!safe;error.cause=cause;throw error;}
        if(safe&&attempt+1<attempts)continue;
        const error=new Error(safe?'連線暫時不穩，資料尚未更新，稍後會再嘗試。':'連線中斷，操作結果尚未確認。請先確認最新狀態，勿連續重複操作。');
        error.code=safe?'connection_unavailable':'request_uncertain';error.uncertain=!safe;error.cause=cause;throw error;
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
    }
  }
  window.RpgRequest={request,statText,localizeStats,isRead:action=>safeReads.has(action)};
})();
