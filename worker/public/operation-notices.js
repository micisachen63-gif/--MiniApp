(() => {
 'use strict';
 // Shared operation-notice gate. Guardian code can use .current without changing its own workflow.
 const types=new Set(['auto_enhance_end','guardian_summon','guardian_fuse','guardian_auto','auto_reroll_end']);
 function create({api,owner}){
  let store;try{store=JSON.parse(localStorage.getItem('rpgOperationNoticeDismissals')||'{}');}catch{store={};}if(!store||typeof store!=='object'||Array.isArray(store))store={};const flights=new Map();
  const identity=n=>{const account=String(n.ownerAccountId||owner()||'');if(!account||!types.has(n.kind)||!/^[A-Za-z0-9:_-]{8,120}$/.test(n.refId||''))return null;return {key:account+':'+n.kind+':'+n.refId,account,kind:n.kind,refId:n.refId};};
  function save(){const entries=Object.entries(store).filter(([,v])=>v&&typeof v==='object'&&Number.isFinite(v.at)).sort((a,b)=>b[1].at-a[1].at);store=Object.fromEntries([...entries.filter(([,v])=>v.pending),...entries.filter(([,v])=>!v.pending).slice(0,500)]);try{localStorage.setItem('rpgOperationNoticeDismissals',JSON.stringify(store));}catch{}}
  function hidden(n){const i=identity(n);return !!(n.dismissed||i&&store[i.key]);}
  async function ack(i){if(flights.has(i.key))return flights.get(i.key);const p=Promise.resolve().then(async()=>{try{await api(['guardian_auto','auto_reroll_end'].includes(i.kind)?'background/dismiss':'notice/dismiss',{kind:i.kind,refId:i.refId});if(store[i.key])store[i.key].pending=false;save();return true;}catch{return false;}finally{flights.delete(i.key);}});flights.set(i.key,p);return p;}
  async function dismiss(n){const i=identity(n);if(!i)throw Error('通知編號無效');store[i.key]={account:i.account,kind:i.kind,refId:i.refId,at:Date.now(),pending:true};save();return ack(i);}
  async function visible(n){if(hidden(n))return false;const r=await api(['guardian_auto','auto_reroll_end'].includes(n.kind)?'background/notice-status':'notice/status',{kind:n.kind,refId:n.refId});return !r.notice.dismissed;}
  async function flush(){const account=String(owner()||'');await Promise.all(Object.entries(store).filter(([,n])=>n.pending&&n.account===account).slice(0,10).map(([key,n])=>ack({key,...n})));}
  const gate={hidden,dismiss,visible,flush};window.RpgOperationNotices.current=gate;return gate;
 }
 window.RpgOperationNotices={create,current:null};
})();
