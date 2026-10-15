(() => {
  'use strict';
  const safeReads=new Set(['guardian/config','guardian/inventory','guardian/shop/list','guardian/operation','guardian/history','journal','meta','me','characters','exchange/list','exchange/sellable','exchange/mine','exchange/history','shop','boss','ledger','players','trade/list','trade/get','trade/requests','trade/log','pk/list','pk/get','expedition/me','party/list','party/get','auto-enhance/status','guardian/auto/status','auto-reroll/status','auto-reroll/options','background/status','background/notice-status','notice/status']);
  async function request(action,body,headers,{signal,timeoutMs=20000}={}){
    const safe=safeReads.has(action),attempts=safe?2:1;
    for(let attempt=0;attempt<attempts;attempt++){
      const controller=new AbortController(),cancel=()=>controller.abort();
      if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(cancel,timeoutMs);
      try{
        const res=await fetch(`/app/api/${action}`,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal});
        if(safe&&[408,429,502,503,504].includes(res.status)){if(attempt+1<attempts)continue;throw new Error('temporary_response');}
        const j=await res.json();return {res,j};
      }catch(cause){
        if(signal?.aborted){const error=new Error('資料更新已暫停。');error.code='request_cancelled';error.uncertain=!safe;error.cause=cause;throw error;}
        if(safe&&attempt+1<attempts)continue;
        const error=new Error(safe?'連線暫時不穩，資料尚未更新，稍後會再嘗試。':'連線中斷，操作結果尚未確認。請先確認最新狀態，勿連續重複操作。');
        error.code=safe?'connection_unavailable':'request_uncertain';error.uncertain=!safe;error.cause=cause;throw error;
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
    }
  }
  window.RpgRequest={request,isRead:action=>safeReads.has(action)};
})();
