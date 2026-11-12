/* Boss and essence workshop in the shared battle window.
 * Only boss/scene and boss/receipt are reads. Attack targets retain their original window.
 * Unknown attacks are never replayed. Exchange recovery requires a matching atomic receipt contract.
 */
(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('zh-TW',{maximumFractionDigits:2}):'—';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const identityKey=c=>JSON.stringify(['accountId','realmId','characterId'].map(k=>String(c?.[k]??'')));
  const scopeKey=c=>JSON.stringify(['accountId','realmId','characterId','epoch'].map(k=>String(c?.[k]??'')));
  const reasonText=value=>typeof value==='string'?value:value?.message||'';
  const safeInt=value=>Number.isSafeInteger(value)&&value>=0;
  const pendingMemory=new Map(),sheets=new WeakMap(),scriptUrl=globalThis.document?.currentScript?.src;
  const TABS=[['battle','世界首領'],['exchange','精華兌換'],['recycle','材料回收']];
  const requestId=()=> 'sb_'+(globalThis.crypto?.randomUUID?.().replaceAll('-','')||Date.now().toString(36)+Math.random().toString(36).slice(2,14));
  function validMaterials(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&safeInt(value.mat_3)&&safeInt(value.mat_4);}
  function validBody(kind,body,withId=false){
    if(!body||typeof body!=='object'||Array.isArray(body))return false;
    if(kind==='attack')return Object.keys(body).length===2&&typeof body.bossId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(body.bossId)&&safeInt(body.expectedWin);
    if(kind!=='exchange'||typeof body.offer!=='string'||!body.offer||body.offer.length>80||Object.keys(body).some(k=>!['offer','requestId','expectedMaterials'].includes(k)))return false;
    if(withId&&(typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(body.requestId)))return false;
    return body.offer==='legacy'?validMaterials(body.expectedMaterials):body.expectedMaterials===undefined;
  }
  function validRecord(record,identity){
    return !!record&&record.version===1&&record.scope===identity&&['attack','exchange'].includes(record.kind)&&validBody(record.kind,record.body,true)
      &&typeof record.id==='string'&&record.id.length<=220&&(record.kind!=='exchange'||record.id===record.body.requestId)
      &&typeof record.label==='string'&&record.label.length<=180&&typeof record.details==='string'&&record.details.length<=2200
      &&record.expected&&typeof record.expected==='object'&&!Array.isArray(record.expected);
  }
  function exchangeSignature(body){return JSON.stringify({offer:body.offer,...(body.offer==='legacy'?{expectedMaterials:{mat_3:body.expectedMaterials.mat_3,mat_4:body.expectedMaterials.mat_4}}:{})});}
  function exchangeResultMatches(record,result){
    if(!result||typeof result!=='object'||!result.items||typeof result.items!=='object'||Array.isArray(result.items))return false;
    const x=record.expected;
    if(record.body.offer==='relic')return Object.keys(result.items).length===0&&!!result.equipment&&typeof result.equipment.id==='string'&&result.equipment.id.length>0&&typeof result.equipment.name==='string';
    const item=record.body.offer==='legacy'?'boss_essence':x.item,quantity=record.body.offer==='legacy'?x.total:x.quantity;
    return typeof item==='string'&&safeInt(quantity)&&quantity>0&&Object.keys(result.items).length===1&&result.items[item]===quantity&&!result.equipment;
  }
  function legacySources(legacy){
    if(!validMaterials(legacy?.expectedMaterials))return [];
    return [['mat_3','三轉舊材料',12],['mat_4','四轉舊材料',16]].map(([item,name,rate])=>({item,name:legacy.materials?.find(m=>m.key===item)?.name||name,quantity:legacy.expectedMaterials[item],rate}));
  }
  function bossStatus(boss,now=Date.now()){
    if(boss.status==='killed')return '首領已擊敗';
    if(boss.status==='fled')return '首領已逃離';
    if(boss.status==='vanished')return '首領已消散';
    if(boss.status==='settling')return '戰果結算中';
    if(boss.status==='active'&&(boss.expired||Number(boss.endsAt)<=now))return '期限已到，等待服務結算';
    if(boss.status==='active'&&(boss.settlementPending||boss.hp<=0))return '首領已倒下，等待戰果結算';
    return boss.status==='active'?'挑戰進行中':'已提交紀錄';
  }
  function createClient(host){
    const context={...host.getContext?.()},identity=identityKey(context),scope=scopeKey(context);
    let storage=host.storage;if(!storage){try{storage=globalThis.sessionStorage;}catch{}}
    const storageKey='rpg-sb-pending:'+identity;
    const state={data:null,loading:false,checking:false,busy:false,stale:true,error:'',notice:'',confirm:null,receipts:{},lastResult:null,revision:-1,minRevision:-1,receivedAt:0};
    let disposed=false,generation=0,receiptGeneration=0,controller=null,receiptController=null;
    const current=()=>!disposed&&scopeKey(host.getContext?.())===scope&&host.current?.()!==false;
    const notify=()=>{if(current())host.onState?.(state);};
    const now=()=>Number(state.data?.now||Date.now())+Math.max(0,Date.now()-state.receivedAt);
    function pendingList(){
      if(pendingMemory.has(identity))return pendingMemory.get(identity);
      let values=[];try{const saved=JSON.parse(storage?.getItem?.(storageKey)||'[]');if(Array.isArray(saved)&&saved.length<=32&&saved.every(r=>validRecord(r,identity))&&new Set(saved.map(r=>r.id)).size===saved.length)values=saved;}catch{}
      pendingMemory.set(identity,values);return values;
    }
    const pending=id=>id?pendingList().find(r=>r.id===id)||null:pendingList().at(-1)||null;
    function saveRecords(values){pendingMemory.set(identity,values);try{if(values.length)storage?.setItem?.(storageKey,JSON.stringify(values));else storage?.removeItem?.(storageKey);}catch{}}
    function savePending(record){const list=pendingList();saveRecords([...list.filter(r=>r.id!==record.id),record]);}
    function markRevealed(id){saveRecords(pendingList().map(r=>r.id===id?{...r,revealed:true}:r));}
    function clearPending(id){saveRecords(pendingList().filter(r=>r.id!==id));delete state.receipts[id];}
    function feedback(message,error=false){if(!current())return;state[error?'error':'notice']=message;notify();}
    function verifyIdentity(value){
      for(const k of ['accountId','realmId','characterId'])if(String(value?.[k])!==String(context[k]))throw Error('角色或世界已切換，請重新開啟首領面板');
    }
    function accept(value){
      if(!value||value.ok!==true||!Array.isArray(value.history)||!value.essence||!value.exchange||!Array.isArray(value.exchange.offers))throw Error('首領資料尚未完整，請重新整理');
      verifyIdentity(value);
      const revision=value.revision;
      if(!safeInt(revision)||revision<Math.max(state.revision,state.minRevision))throw Error('收到較早的角色資料，請重新整理');
      return revision;
    }
    const fingerprint=()=>JSON.stringify([state.revision,state.data?.readOnly,state.data?.boss?.id,state.data?.boss?.status,state.data?.boss?.hp,state.data?.boss?.me,state.data?.essence,state.data?.exchange]);
    // A revision-only re-read keeps the current buttons until the answer arrives.
    var backgroundRead=false;
    async function refresh(){
      const quiet=backgroundRead;backgroundRead=false;
      if(!current()||state.busy||state.checking)return false;
      const ticket=++generation,before=fingerprint();controller?.abort();controller=new AbortController();state.loading=true;state.error='';if(!quiet)notify();
      try{
        const value=await host.request('boss/scene',{}, {signal:controller.signal});
        if(!current()||ticket!==generation)return false;
        state.revision=accept(value);state.data=clone(value);state.receivedAt=Date.now();state.stale=false;
        if(state.confirm&&before!==fingerprint()){state.confirm=null;state.notice='角色或首領狀態已更新，請重新確認操作。';}
        return true;
      }catch(error){if(!current()||ticket!==generation)return false;state.stale=true;state.confirm=null;state.error=error?.message||'暫時無法讀取首領資料';return false;}
      finally{if(current()&&ticket===generation){state.loading=false;notify();}}
    }
    function attackEnd(boss=state.data?.boss){
      const duration=Number(boss?.attackWindowMinutes)*60000;
      return Number.isFinite(duration)&&duration>0&&safeInt(boss?.me?.window)?Number(boss.startedAt)+(boss.me.window+1)*duration:null;
    }
    function readiness(kind='exchange'){
      if(!current())return '角色或世界已切換';
      if(state.busy||state.loading||state.checking)return '正在更新首領資料';
      if(state.data?.readOnly)return state.data.readOnlyReason||'這個世界目前只能查看資料';
      if(!state.data||state.stale||state.revision<state.minRevision)return '請先更新首領資料';
      if(pendingList().length>=32)return '請先核對並確認先前已完成的操作';
      if(kind==='attack'){
        const boss=state.data.boss;
        if(!boss||boss.me?.canAttack!==true)return reasonText(boss?.me?.reason)||'目前沒有可攻擊的首領';
        if(boss.status!=='active'||Number(boss.endsAt)<=now())return '本場首領期限已到，請更新資料';
        if(Number(boss.me.downUntil)>now())return '角色仍在倒地恢復中';
        if(attackEnd(boss)==null||attackEnd(boss)<=now())return '攻擊回合已更新，請先重新整理';
        const blocked=pendingList().find(r=>r.kind==='attack'&&(r.body.bossId===boss.id&&r.body.expectedWin===boss.me.window||state.receipts[r.id]?.found!==false));
        if(blocked)return '請先查詢並核對原攻擊紀錄';
      }else{
        if(pendingList().some(r=>r.kind==='exchange'))return '請先核對上次兌換結果';
        if(state.data.exchange.canOperate!==true||state.data.exchange.blockedReason!=null)return reasonText(state.data.exchange.blockedReason)||'目前無法使用首領精華工坊';
      }
      return '';
    }
    function prepareAttack(){
      const reason=readiness('attack');if(reason){feedback(reason,true);return false;}
      const b=state.data.boss,body={bossId:b.id,expectedWin:b.me.window};
      if(!validBody('attack',body))return false;
      const details='目標：'+b.name+'，'+b.mapName+'。本次最多施放 '+fmt(state.data.rules?.castsPerAttack??5)+' 次技能，會消耗魔力，並依補給設定使用背包藥水。首領可能反擊；倒地後需等待 '+fmt((state.data.rules?.downMs??600000)/60000)+' 分鐘。原攻擊回合 '+fmt(body.expectedWin+1)+'；回合過期後必須重新確認。'+(pendingList().some(r=>r.kind==='attack')?' 先前未查到的攻擊紀錄會繼續保留；這是目前回合的新攻擊。':'');
      state.error='';state.notice='';state.confirm={kind:'attack',body,label:'攻擊「'+b.name+'」',details,expected:{bossName:b.name},fingerprint:fingerprint(),recovery:false};notify();return true;
    }
    function prepareExchange(offerId){
      const reason=readiness('exchange');if(reason){feedback(reason,true);return false;}
      const exchange=state.data.exchange;
      let body,expected,label,details;
      if(offerId==='legacy'){
        const legacy=exchange.legacy;
        if(!legacy||legacy.canExchange!==true){feedback(reasonText(legacy?.reason)||'沒有可回收的三、四轉舊材料',true);return false;}
        const materials=legacy.expectedMaterials;
        if(!validMaterials(materials)||!safeInt(legacy.essence)||legacy.essence<=0||legacy.essence!==materials.mat_3*12+materials.mat_4*16)return false;
        const sources=legacySources(legacy);body={offer:'legacy',expectedMaterials:clone(materials)};expected={total:legacy.essence,materials:sources};
        label='回收全部舊三、四轉材料';details=sources.map(x=>x.name+' × '+fmt(x.quantity)+'（每件 '+fmt(x.rate)+' 精華，共 '+fmt(x.quantity*x.rate)+'）').join('；')+'。將消耗上述全部持有材料，取得 '+fmt(legacy.essence)+' 首領精華。';
      }else{
        const offer=exchange.offers.find(o=>o.id===offerId);
        if(!offer||offer.canExchange!==true){feedback(reasonText(offer?.reason)||'目前無法兌換這個品項',true);return false;}
        body={offer:offer.id};expected={cost:offer.cost,currency:offer.currency,item:offer.item||null,quantity:offer.qty,name:offer.name};
        label='兌換'+offer.name;details='消耗 '+fmt(offer.cost)+' '+(offer.currency==='relic_fragment'?'遺物碎片':'首領精華')+'，取得 '+offer.name+'。'+(offer.id==='relic'?'部位隨機，依目前角色職業與可用階級產生裝備，結果確定後存入背包。':'存入目前角色背包。');
      }
      if(!validBody('exchange',body))return false;
      state.error='';state.notice='';state.confirm={kind:'exchange',body,label,details,expected,fingerprint:fingerprint(),recovery:false};notify();return true;
    }
    function cancel(){if(!current()||state.busy)return;state.confirm=null;notify();}
    function recoveryReason(id){
      const record=pending(id);
      if(!current())return '角色或世界已切換';
      if(state.busy||state.loading||state.checking)return '正在核對上次操作';
      if(!record||record.kind!=='exchange')return '攻擊只查詢原戰果，不會重新送出';
      if(state.data?.readOnly)return state.data.readOnlyReason||'這個世界目前只能查看資料';
      if(!state.data||state.stale||state.revision<state.minRevision)return '請先更新首領資料';
      const receipt=state.receipts[id];
      if(receipt?.found!==false||receipt.recoveryAllowed!==true)return '請先查詢這筆原操作的完整收據';
      return '';
    }
    function prepareRecovery(id){
      const reason=recoveryReason(id);if(reason){feedback(reason,true);return false;}
      const record=clone(pending(id));state.error='';state.confirm={...record,label:'重試這筆原兌換',details:record.label+'。'+record.details+' 尚未查到完成收據，原操作可能仍在處理。確認後只會使用完全相同的操作編號與內容；已完成時會取回原結果。',record,recovery:true,fingerprint:fingerprint()};notify();return true;
    }
    function directMatches(record,value){
      if(!value||value.ok!==true||!safeInt(value.revision)||value.revision<Math.max(state.revision,state.minRevision))return false;
      if(record.kind==='attack'){
        if(value.bossId!==record.body.bossId||value.win!==record.body.expectedWin||!value.result||!safeInt(value.result.damage))return false;
        if(value.resultEvidence==='attack-row')return value.result.bossId===record.body.bossId&&value.result.win===record.body.expectedWin&&safeInt(value.result.createdAt);
        return value.resultEvidence==='response'&&safeInt(value.result.counter)&&safeInt(value.result.crits)&&typeof value.result.downed==='boolean';
      }
      return value.requestId===record.id&&value.offer===record.body.offer&&value.signature===exchangeSignature(record.body)&&exchangeResultMatches(record,value.result);
    }
    async function send(record,recovery){
      savePending(record);state.confirm=null;state.busy=true;delete state.receipts[record.id];state.error='';state.notice='';
      generation++;receiptGeneration++;controller?.abort();receiptController?.abort();notify();let acknowledged=false;
      try{
        const value=await host.request(record.kind==='attack'?'boss/attack-scoped':'boss/exchange-scoped',clone(record.body));
        if(!current())return false;verifyIdentity(value);
        if(!directMatches(record,value))throw Object.assign(Error('未收到匹配的首領操作收據'),{uncertain:true});
        clearPending(record.id);acknowledged=true;state.stale=true;state.lastResult={kind:record.kind,label:record.label,expected:clone(record.expected),result:clone(value.result),complete:record.kind!=='attack'||value.resultEvidence==='response'};state.notice=record.label+'已完成。';
        state.minRevision=Math.max(state.minRevision,value.revision);
        try{host.onChanged?.(value,{body:clone(record.body),kind:record.kind,recovery});}catch{}
      }catch(error){
        if(!current())return false;
        const status=Number(error?.status),uncertain=recovery||error?.uncertain||!Number.isInteger(status)||status<400||status>=500||/duplicate|request_reused|character_changed|stale|context|boss_receipt_(?:legacy|corrupt)/i.test(String(error?.code||''));
        if(!uncertain)clearPending(record.id);
        state.stale=true;state.error=uncertain?'操作結果待核對。請查詢這筆原操作紀錄；重新整理不會再次送出。':error?.message||'操作尚未完成，請重新確認條件';
      }finally{
        if(current()){state.busy=false;notify();if(acknowledged||!pending(record.id)){const error=state.error;await refresh();if(error&&!state.error){state.error=error;notify();}}}
      }
      return acknowledged;
    }
    async function submit(){
      if(!current()||!state.confirm)return false;
      const plan=state.confirm;
      if(plan.fingerprint!==fingerprint()){state.confirm=null;feedback('資料已更新，請重新確認這次操作。',true);return false;}
      if(plan.recovery){
        const reason=recoveryReason(plan.record.id),record=pending(plan.record.id);
        if(reason||!record||!same(record,plan.record)){state.confirm=null;feedback(reason||'原操作紀錄已變更，請重新核對。',true);return false;}
        return send(clone(record),true);
      }
      const reason=readiness(plan.kind);if(reason){state.confirm=null;feedback(reason,true);return false;}
      if(plan.kind==='attack'&&(plan.body.bossId!==state.data.boss?.id||plan.body.expectedWin!==state.data.boss?.me?.window)){state.confirm=null;feedback('首領或攻擊回合已變更，請重新確認。',true);return false;}
      const id=plan.kind==='attack'?'attack:'+plan.body.bossId+':'+plan.body.expectedWin:requestId();
      const record={version:1,scope:identity,id,kind:plan.kind,body:{...clone(plan.body),...(plan.kind==='exchange'?{requestId:id}:{})},label:plan.label,details:plan.details,expected:clone(plan.expected),at:Date.now()};
      if(!validRecord(record,identity))throw Error('首領操作內容不完整');
      return send(record,false);
    }
    async function checkPending(id){
      const record=pending(id);if(!current()||!record||state.busy||state.loading||state.checking)return false;
      if(!await refresh()||!current()||!pending(id))return false;
      const ticket=++receiptGeneration;receiptController?.abort();receiptController=new AbortController();state.checking=true;delete state.receipts[id];state.error='';notify();
      const body=record.kind==='attack'?{kind:'attack',bossId:record.body.bossId,win:record.body.expectedWin}:{kind:'exchange',...clone(record.body)};
      try{
        const value=await host.request('boss/receipt',body,{signal:receiptController.signal});
        if(!current()||ticket!==receiptGeneration||!pending(id))return false;verifyIdentity(value);
        if(value?.ok!==true||typeof value.found!=='boolean'||value.kind!==record.kind)throw Error('未收到這筆原操作的有效紀錄');
        if(!safeInt(value.revision)||value.revision<Math.max(state.revision,state.minRevision))throw Error('收到較早的角色紀錄，請重新核對');
        if(record.kind==='attack'){
          if(value.bossId!==record.body.bossId||value.win!==record.body.expectedWin)throw Error('攻擊紀錄與原首領或回合不符');
          if(value.found&&(!value.result||value.result.bossId!==record.body.bossId||value.result.win!==record.body.expectedWin||!safeInt(value.result.damage)||!safeInt(value.result.createdAt)))throw Error('攻擊紀錄內容不完整');
        }else{
          if(value.requestId!==record.id||value.offer!==record.body.offer||value.signature!==exchangeSignature(record.body))throw Error('兌換收據與原操作內容不符');
          if(value.found&&!exchangeResultMatches(record,value.result))throw Error('兌換收據缺少原始結果');
        }
        if(!value.found&&(value.result!=null||value.receipt!=null))throw Error('收據狀態不一致，請重新查詢');
        if(value.revision>state.revision){state.minRevision=Math.max(state.minRevision,value.revision);state.stale=true;}
        state.receipts[id]=clone(value);state.notice=value.found?'已找到這筆原操作的已提交紀錄。':'尚未查到原操作紀錄，原請求可能仍在處理；紀錄會繼續保留。';return true;
      }catch(error){if(!current()||ticket!==receiptGeneration)return false;delete state.receipts[id];state.error=error?.message||'暫時無法核對原操作';return false;}
      finally{if(current()&&ticket===receiptGeneration){state.checking=false;notify();}}
    }
    function acknowledge(id){
      const record=pending(id),receipt=state.receipts[id];
      if(!current()||!record||state.busy||state.loading||state.checking||state.stale||state.revision<state.minRevision||receipt?.found!==true)return false;
      state.lastResult={kind:record.kind,label:record.label,expected:clone(record.expected),result:clone(receipt.result),complete:record.kind==='exchange'};clearPending(id);state.error='';state.notice='已核對原操作的已提交紀錄。';notify();return true;
    }
    function update(scene){
      if(!current())return;
      for(const k of ['accountId','realmId','characterId'])if(scene?.[k]!=null&&String(scene[k])!==String(context[k]))return;
      const revision=scene?.live?.revision??scene?.character?.revision??scene?.actor?.revision??scene?.revision;if(!safeInt(revision))return;
      state.minRevision=Math.max(state.minRevision,revision);
      if(revision>state.revision){state.stale=true;if(state.confirm){state.confirm=null;state.notice='角色狀態已更新，請重新確認。';}if(!state.busy&&!state.loading&&!state.checking){backgroundRead=true;void refresh();}else notify();}
    }
    return {state,context,current,now,pending,pendingList,markRevealed,readiness,recoveryReason,feedback,refresh,prepareAttack,prepareExchange,prepareRecovery,cancel,submit,checkPending,acknowledge,update,
      dispose(){if(disposed)return;disposed=true;generation++;receiptGeneration++;controller?.abort();receiptController?.abort();}};
  }
  function ensureStyle(root){
    const doc=root.ownerDocument;if(!doc?.head||!doc.createElement||sheets.has(doc))return;
    const link=doc.createElement('link');link.rel='stylesheet';link.href=scriptUrl?new URL('scene-boss-ui.css?v=20261105',scriptUrl).href:'scene-boss-ui.css?v=20261105';
    link.onerror=()=>{sheets.delete(doc);link.remove?.();};doc.head.appendChild(link);sheets.set(doc,link);
  }
  function mount(root,host,options={}){
    ensureStyle(root);const draft=host.draft||{};draft.tab=TABS.some(([key])=>key===(options.tab||draft.tab))?options.tab||draft.tab:'battle';
    let disposed=false,timer=null,focusConfirm=false,savedFocus=null,confirmationOrigin=null,focusAfterCancel=null,revealFrame=null,revealId=null;const revealedIds=new Set();
    const client=createClient({...host,onState:()=>paint(),onChanged:(value,operation)=>{if(client.current())host.onChanged?.(value,operation);}});
    const state=client.state,data=()=>state.data,muted=value=>'<p class="sb-muted">'+esc(value)+'</p>';
    const button=(action,label,{id,offer,tab,primary=false,disabled=false}={})=>'<button type="button" data-sb-action="'+action+'"'+(id?' data-pending-id="'+esc(id)+'"':'')+(offer?' data-offer="'+esc(offer)+'"':'')+(tab?' data-tab="'+esc(tab)+'"':'')+(disabled?' disabled':'')+(primary?' class="sb-primary is-primary"':'')+'>'+esc(label)+'</button>';
    const date=value=>Number.isFinite(Number(value))?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(Number(value)):'—';
    const remaining=value=>{const seconds=Math.max(0,Math.ceil((Number(value)-client.now())/1000));return seconds>=3600?Math.floor(seconds/3600)+'時 '+Math.floor(seconds%3600/60)+'分':Math.floor(seconds/60)+'分 '+seconds%60+'秒';};
    function resultText(record,result,complete=false){
      if(!result)return '';
      if(record.kind==='attack')return '已提交傷害 '+fmt(result.damage)+(complete?' · 首領反擊 '+fmt(result.counter)+' · 爆擊 '+fmt(result.crits)+' 次'+(result.downed?' · 本次倒地':''):' · 提交時間 '+date(result.createdAt)+'（台灣時間）');
      if(result.equipment)return '已取得「'+result.equipment.name+'」。';
      return Object.entries(result.items||{}).map(([item,n])=>item==='boss_essence'?'首領精華 × '+fmt(n):record.expected?.name||item+' × '+fmt(n)).join('；');
    }
    function notices(){
      let html=state.error?'<p class="sb-feedback sb-error" role="alert">'+esc(state.error)+'</p>':'';
      if(state.notice)html+='<p class="sb-feedback" role="status">'+esc(state.notice)+'</p>';
      if(data()?.readOnly)html+='<p class="sb-feedback">'+esc(data().readOnlyReason||'這個世界目前只能查看資料')+'</p>';
      if(state.lastResult)html+='<section class="sb-result"><h3>'+esc(state.lastResult.label)+'</h3><p>'+esc(resultText(state.lastResult,state.lastResult.result,state.lastResult.complete))+'</p>'+(state.lastResult.kind==='attack'&&!state.lastResult.complete?muted('原攻擊紀錄只保存傷害與時間，沒有反擊、爆擊或當時血魔明細。'):'')+'</section>';
      for(const r of client.pendingList()){
        const receipt=state.receipts[r.id],locked=state.busy||state.loading||state.checking;
        html+='<section class="sb-pending" data-sb-pending="'+esc(r.id)+'" data-sb-receipt-found="'+(receipt?.found===true?'1':'0')+'"><h3>'+esc(r.label)+' · 待核對</h3><p>'+esc(r.details)+'</p>'+muted(r.kind==='attack'?'原首領 '+r.body.bossId+' · 原攻擊回合 '+fmt(r.body.expectedWin+1)+'。查詢只會讀這次紀錄。':'原兌換編號 '+r.id)+
          (receipt?.found?'<p>'+esc(resultText(r,receipt.result,false))+'</p>'+(r.kind==='attack'?muted('此紀錄只確認傷害與提交時間；沒有保存反擊、爆擊或當時血魔明細。'):''):receipt?.found===false?muted('尚未查到紀錄。原請求可能仍在處理，這筆待核對項目會保留。'):'')+
          '<div class="sb-actions">'+button('check-pending',state.checking?'核對中…':'查詢原操作紀錄',{id:r.id,disabled:locked})+
          (receipt?.found?button('acknowledge','已核對這份紀錄',{id:r.id,disabled:locked||state.stale}):r.kind==='exchange'&&receipt?.recoveryAllowed===true?button('retry','重試這筆原兌換',{id:r.id,disabled:!!client.recoveryReason(r.id)}):'')+'</div></section>';
      }
      return html;
    }
    function confirmation(){
      const c=state.confirm;if(!c)return '';
      return '<section class="sb-confirm" data-sb-confirm aria-labelledby="sb-confirm-title"><h3 id="sb-confirm-title">'+esc(c.label)+'？</h3><p>'+esc(c.details)+'</p><div class="sb-actions">'+button('confirm',c.recovery?'確認重試原兌換':'確認'+c.label,{primary:true,disabled:!!(c.recovery?client.recoveryReason(c.record.id):client.readiness(c.kind))})+button('cancel','取消',{disabled:state.busy})+'</div></section>';
    }
    function vitals(){
      const c=data()?.character,s=c?.stats;
      if(!c||!s)return '';
      return '<div class="sb-vitals">'+[['生命',c.hp,s.maxHp],['魔力',c.mp,s.maxMp]].filter(([,n,max])=>Number.isFinite(n)&&Number.isFinite(max)).map(([label,n,max])=>'<span>'+label+' <b>'+fmt(n)+'</b> / '+fmt(max)+'</span>').join('')+'</div>';
    }
    function rewardText(result){
      if(!result)return '';
      const id=String(client.context.characterId),items=[];
      if(Number(result.gold?.[id])>0)items.push('金幣 '+fmt(result.gold[id]));
      for(const x of result.materials||[])if(String(x.tgId)===id)items.push((x.itemName||x.item)+' × 1');
      for(const x of result.monsterMaterials||[])if(String(x.tgId)===id&&safeInt(x.qty)&&x.qty>0)items.push((x.itemName||x.item)+' × '+fmt(x.qty));
      for(const x of result.essences||[])if(String(x.tgId)===id)items.push('首領精華 × '+fmt(x.qty));
      if(result.gear&&String(result.gear.tgId)===id)items.push(result.gear.itemName);
      for(const key of ['relics','blessedScrolls'])for(const x of result[key]||[])if(String(x.tgId)===id)items.push(x.itemName||x.item);
      return items.join(' · ');
    }
    function battle(){
      const b=data()?.boss,me=b?.me;
      let html='';
      if(!b)html='<section class="sb-empty"><span class="sb-kicker">等待下一場挑戰</span><h3>目前沒有首領</h3>'+muted('更新資料可查看已出現的首領與已提交戰果。')+'</section>';
      else{
        const active=b.status==='active'&&Number(b.endsAt)>client.now()&&Number(b.hp)>0&&!b.settlementPending,reason=client.readiness('attack');
        html='<section class="sb-boss" data-sb-boss-id="'+esc(b.id)+'"><span class="sb-kicker">'+esc(b.mapName)+' · '+esc(b.elementName||'')+'</span><h3>'+esc(b.name)+'</h3><div class="sb-health"><strong>'+fmt(b.hp)+' / '+fmt(b.maxHp)+'</strong><progress value="'+Math.max(0,Number(b.hp)||0)+'" max="'+Math.max(1,Number(b.maxHp)||1)+'" aria-label="首領生命"></progress></div>'+
          '<div class="sb-deadlines"><span>本場期限 <b>'+date(b.endsAt)+'</b>（台灣時間）</span><span>'+(active?'剩餘 '+remaining(b.endsAt):bossStatus(b,client.now()))+'</span></div>'+
          '<div class="sb-vitals"><span>我的累計傷害 <b>'+fmt(me?.damage)+'</b></span><span>已攻擊 '+fmt(me?.hits)+' 次</span></div>'+vitals()+
          (Number(me?.downUntil)>client.now()?'<p class="sb-feedback">倒地恢復至 '+date(me.downUntil)+'（台灣時間），剩餘 '+remaining(me.downUntil)+'。</p>':'')+
          (me?.attackedThisWindow?muted('本回合已攻擊。下一回合 '+date(me.nextAttackAt)+'（台灣時間）。'):muted('每 '+fmt(b.attackWindowMinutes)+' 分鐘可攻擊一次。'))+
          (reason?muted(reason):'')+'<div class="sb-actions">'+button('attack',active?'攻擊這隻首領':'本場已結束',{primary:true,disabled:!!reason})+button('supplies','調整補給')+'</div>'+
          muted('攻擊會使用魔力與背包藥水，首領可能反擊。確認時會列出目標與倒地風險。')+'</section>';
      }
      html+='<section class="sb-history"><h3>已提交戰果</h3>'+(data().history.length?data().history.map(h=>'<article class="sb-history-row"><h4>'+esc(h.name||h.bossName||h.id)+'</h4>'+muted(bossStatus(h,client.now())+' · '+date(h.endsAt??h.createdAt))+
        (h.me?'<p>我的傷害 '+fmt(h.me.damage)+' · '+fmt(h.me.hits)+' 次攻擊</p>':'')+'<p>'+esc(rewardText(h.result)||'尚無本角色的已提交獎勵')+'</p></article>').join(''):muted('目前沒有已提交戰果。'))+'</section>';
      return daily()+html;
    }
    function daily(){
      const d=data()?.essence?.daily;if(!d)return '';
      return '<section class="sb-daily"><p>此帳號今日已領精華的擊殺次數 <strong>'+fmt(d.used)+' / '+fmt(d.limit)+'</strong>，剩餘 '+fmt(d.remaining)+' 次。</p>'+muted('有造成傷害的擊殺才計入；由實際貢獻角色領取。台灣時間每日 00:00 重置，下次 '+date(d.resetsAt)+'。')+(d.remaining===0?muted('今日精華獎勵次數已用完，仍可攻擊首領。'):'')+'</section>';
    }
    function balance(){
      const e=data()?.essence;
      return '<section class="sb-balances"><div><span class="sb-kicker">首領精華</span><strong data-sb-essence>'+fmt(e.quantity)+'</strong></div><div><span class="sb-kicker">遺物碎片</span><strong>'+fmt(e.fragments)+'</strong></div></section>'+daily();
    }
    function exchanges(){
      const x=data().exchange;
      return balance()+'<section><h3>將戰果化為下一次突破</h3>'+(x.blockedReason?muted(reasonText(x.blockedReason)):'')+'<div class="sb-card-grid">'+x.offers.map(o=>'<article class="sb-offer" data-sb-offer="'+esc(o.id)+'"><h4>'+esc(o.name)+'</h4><p>'+fmt(o.cost)+' '+(o.currency==='relic_fragment'?'遺物碎片':'首領精華')+'</p>'+muted(o.id==='relic'?'本職業隨機部位遺物；兌換前再次確認。':'每次取得 '+fmt(o.qty)+' 件')+(o.reason?muted(reasonText(o.reason)):'')+button('exchange','兌換',{offer:o.id,primary:true,disabled:!!client.readiness('exchange')||o.canExchange!==true})+'</article>').join('')+'</div></section>';
    }
    function recycle(){
      const legacy=data().exchange.legacy;
      if(!legacy)return balance()+muted('目前無法讀取材料回收資料，請更新後再試。');
      return balance()+'<section class="sb-recycle"><span class="sb-kicker">舊材料回收</span><h3>回收全部舊三、四轉材料</h3>'+muted('確認後消耗下列全部持有材料；來源數量改變時，必須重新確認。')+
        '<div class="sb-materials">'+legacySources(legacy).map(m=>'<article><div><strong>'+esc(m.name)+'</strong><span>持有 '+fmt(m.quantity)+' 件 · 每件 '+fmt(m.rate)+' 精華</span></div><b>'+fmt(m.quantity*m.rate)+'</b></article>').join('')+'</div><p class="sb-total">可取得 <strong>'+fmt(legacy.essence)+'</strong> 首領精華</p>'+
        (legacy.reason?muted(reasonText(legacy.reason)):'')+'<div class="sb-actions">'+button('exchange','確認回收全部材料',{offer:'legacy',primary:true,disabled:!!client.readiness('exchange')||legacy.canExchange!==true})+'</div></section>';
    }
    function focusIdentity(node){return node?{action:node.dataset?.sbAction,id:node.dataset?.pendingId,offer:node.dataset?.offer,tab:node.dataset?.tab}:null;}
    function cancelReveal(){if(revealFrame!==null)globalThis.cancelAnimationFrame?.(revealFrame);revealFrame=null;revealId=null;}
    function revealPendingOnce(){
      const record=[...client.pendingList()].reverse().find(r=>!r.revealed&&!revealedIds.has(r.id));if(!record){cancelReveal();return;}
      if(state.busy||state.loading||state.checking||state.confirm||typeof globalThis.requestAnimationFrame!=='function')return;
      if(revealFrame!==null&&revealId===record.id)return;cancelReveal();const id=record.id;revealId=id;
      const active=root.ownerDocument?.activeElement,focusAtSchedule=root.contains?.(active)?JSON.stringify(focusIdentity(active)):active;
      revealFrame=globalThis.requestAnimationFrame(()=>{if(revealId!==id)return;revealFrame=null;revealId=null;if(disposed||!client.current()||!root.isConnected||root.ownerDocument?.hidden||state.busy||state.loading||state.checking||state.confirm||!client.pending(id))return;
        const entry=[...root.querySelectorAll?.('[data-sb-action="check-pending"]')||[]].find(n=>n.dataset.pendingId===id),panel=entry?.closest?.('[data-sb-pending]');if(!entry||entry.disabled||!panel)return;
        const active=root.ownerDocument?.activeElement,focusNow=root.contains?.(active)?JSON.stringify(focusIdentity(active)):active;
        for(const r of client.pendingList()){revealedIds.add(r.id);client.markRevealed(r.id);}
        if(focusAtSchedule!==focusNow)return;
        savedFocus=null;panel.scrollIntoView?.({block:'nearest',behavior:'auto'});entry.focus?.({preventScroll:true});});
    }
    function paint(){
      if(disposed||!client.current())return;
      const top=root.scrollTop,doc=root.ownerDocument,active=doc?.activeElement;
      if(focusAfterCancel){savedFocus=focusAfterCancel;focusAfterCancel=null;}
      else if(root.contains?.(active))savedFocus=focusIdentity(active);
      else if(active&&active!==doc?.body&&active!==doc?.documentElement)savedFocus=null;
      const focus=savedFocus;
      root.innerHTML='<div class="sb-panel" data-sb-ready="'+(!state.loading&&!state.stale&&!!data()?'1':'0')+'" data-sb-tab="'+draft.tab+'" aria-busy="'+(state.loading||state.busy||state.checking)+'">'+
        '<header class="sb-header"><div><h2>'+(draft.tab==='battle'?'世界首領':'首領精華')+'</h2><p>'+esc(data()?.character?.name||host.getActor?.()?.name||'')+'</p></div>'+button('refresh',state.loading?'更新中…':'更新資料',{disabled:state.loading||state.busy||state.checking})+'</header>'+
        '<nav class="sb-tabs" aria-label="首領與精華">'+TABS.map(([key,label])=>button('tab',label,{tab:key,disabled:state.busy})).join('')+'</nav>'+
        notices()+confirmation()+(!data()?muted('正在讀取首領戰況與精華…'):draft.tab==='battle'?battle():draft.tab==='exchange'?exchanges():recycle())+'</div>';
      root.scrollTop=top;
      for(const b of root.querySelectorAll?.('[data-sb-action="tab"]')||[])b.setAttribute?.('aria-pressed',String(b.dataset.tab===draft.tab));
      if(state.confirm&&focusConfirm){focusConfirm=false;root.querySelector?.('[data-sb-confirm]')?.scrollIntoView?.({block:'nearest'});root.querySelector?.('[data-sb-action="cancel"]')?.focus?.({preventScroll:true});}
      else if(focus){const node=[...root.querySelectorAll?.('button')||[]].find(n=>n.dataset.sbAction===focus.action&&n.dataset.pendingId===focus.id&&n.dataset.offer===focus.offer&&n.dataset.tab===focus.tab);node?.focus?.({preventScroll:true});}
      revealPendingOnce();
    }
    function cancelConfirmation(){if(state.confirm&&!state.busy){focusAfterCancel=confirmationOrigin;confirmationOrigin=null;}client.cancel();}
    function prepare(origin,fn){confirmationOrigin=focusIdentity(origin);focusConfirm=true;if(!fn()){focusConfirm=false;confirmationOrigin=null;}}
    async function click(event){
      const b=event.target?.closest?.('[data-sb-action]');if(!b||b.disabled||!root.contains?.(b)||!client.current())return;const action=b.dataset.sbAction;
      cancelReveal();for(const r of client.pendingList()){revealedIds.add(r.id);client.markRevealed(r.id);}
      if(action==='refresh')return client.refresh();
      if(action==='cancel')return cancelConfirmation();
      if(action==='confirm')return client.submit();
      if(action==='check-pending')return client.checkPending(b.dataset.pendingId);
      if(action==='acknowledge')return client.acknowledge(b.dataset.pendingId);
      if(action==='retry')return prepare(b,()=>client.prepareRecovery(b.dataset.pendingId));
      if(state.busy||state.checking)return;
      if(action==='supplies'){host.navigate?.('supplies');return;}
      if(action==='tab'){if(!TABS.some(([key])=>key===b.dataset.tab))return;draft.tab=b.dataset.tab;client.cancel();paint();return;}
      if(action==='attack')return prepare(b,()=>client.prepareAttack());
      if(action==='exchange')return prepare(b,()=>client.prepareExchange(b.dataset.offer));
    }
    const visibility=()=>{if(!root.ownerDocument?.hidden&&client.current()&&!state.busy&&!state.loading&&!state.checking&&!state.confirm)void client.refresh();};
    root.addEventListener('click',click);root.ownerDocument?.addEventListener?.('visibilitychange',visibility);
    timer=globalThis.setInterval?.(()=>{if(client.current()&&!root.ownerDocument?.hidden&&!state.busy&&!state.loading&&!state.checking&&!state.confirm)void client.refresh();},15000);
    paint();void client.refresh();
    return {refresh:client.refresh,update:client.update,handleBack(){if(state.confirm){cancelConfirmation();return true;}return false;},
      dispose(){if(disposed)return;disposed=true;cancelReveal();client.dispose();if(timer!==null)globalThis.clearInterval?.(timer);root.removeEventListener('click',click);root.ownerDocument?.removeEventListener?.('visibilitychange',visibility);}};
  }
  globalThis.RpgSceneBoss={createClient,mount};
})();
