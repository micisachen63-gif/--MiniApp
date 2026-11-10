(() => {
 'use strict';
 // Shared operation-notice gate. Legacy dismissals belong to permanent only.
 const types=new Set(['auto_enhance_end','guardian_summon','guardian_fuse','guardian_auto','auto_reroll_end']);
 function create({api,owner,realmId,contextEpoch}){
  const realm=()=>String(realmId?.()||'permanent'),epoch=()=>contextEpoch?.()||0;
  let store;try{store=JSON.parse(localStorage.getItem('rpgOperationNoticeDismissals')||'{}');}catch{store={};}
  if(!store||typeof store!=='object'||Array.isArray(store))store={};
  const flights=new Map();
  const identity=n=>{
   const account=String(n.ownerAccountId||owner()||''),scope=realm();
   if(!account||!types.has(n.kind)||!/^[A-Za-z0-9:_-]{8,120}$/.test(n.refId||'')||n.realmId!==undefined&&n.realmId!==scope)return null;
   return {key:(scope==='permanent'?'':scope+':')+account+':'+n.kind+':'+n.refId,account,kind:n.kind,refId:n.refId,realmId:scope,epoch:epoch()};
  };
  const current=i=>i.realmId===realm()&&i.epoch===epoch()&&i.account===String(owner()||'');
  function save(){const entries=Object.entries(store).filter(([,v])=>v&&typeof v==='object'&&Number.isFinite(v.at)).sort((a,b)=>b[1].at-a[1].at);store=Object.fromEntries([...entries.filter(([,v])=>v.pending),...entries.filter(([,v])=>!v.pending).slice(0,500)]);try{localStorage.setItem('rpgOperationNoticeDismissals',JSON.stringify(store));}catch{}}
  function hidden(n){const i=identity(n);return !!(n.dismissed||i&&store[i.key]);}
  async function ack(i){
   if(!current(i))return false;
   const existing=flights.get(i.key);if(existing?.epoch===i.epoch)return existing.promise;
   const flight={epoch:i.epoch,promise:null};
   flight.promise=Promise.resolve().then(async()=>{
    try{
     if(!current(i))return false;
     await api(['guardian_auto','auto_reroll_end'].includes(i.kind)?'background/dismiss':'notice/dismiss',{kind:i.kind,refId:i.refId});
     if(!current(i))return false;
     if(store[i.key])store[i.key].pending=false;save();return true;
    }catch{return false;}finally{if(flights.get(i.key)===flight)flights.delete(i.key);}
   });
   flights.set(i.key,flight);return flight.promise;
  }
  async function dismiss(n){const i=identity(n);if(!i)throw Error('通知編號無效');store[i.key]={account:i.account,kind:i.kind,refId:i.refId,realmId:i.realmId,at:Date.now(),pending:true};save();return ack(i);}
  async function visible(n){const i=identity(n);if(!i||hidden(n)||!current(i))return false;const r=await api(['guardian_auto','auto_reroll_end'].includes(i.kind)?'background/notice-status':'notice/status',{kind:i.kind,refId:i.refId});return current(i)&&!r.notice.dismissed;}
  async function flush(){const account=String(owner()||''),scope=realm(),version=epoch();await Promise.all(Object.entries(store).filter(([,n])=>n?.pending&&n.account===account&&(n.realmId===undefined?'permanent':n.realmId)===scope).slice(0,10).map(([key,n])=>ack({...n,key,realmId:scope,epoch:version})));}
  const gate={hidden,dismiss,visible,flush};window.RpgOperationNotices.current=gate;return gate;
 }
 window.RpgOperationNotices={create,current:null};
})();
