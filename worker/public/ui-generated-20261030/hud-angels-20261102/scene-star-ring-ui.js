/* Star Ring operations in the shared battle window.
 * Only scene/receipt are reads. Every write is confirmed with its original typed body.
 * Time-based battle projections and pending hunts never count as submitted rewards.
 */
(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>Number.isFinite(Number(v))?Number(v).toLocaleString('zh-TW',{maximumFractionDigits:0}):'—';
  const clone=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v),integer=v=>Number.isSafeInteger(v)&&v>=0;
  const key=(c,epoch=false)=>JSON.stringify((epoch?['accountId','realmId','characterId','epoch']:['accountId','realmId','characterId']).map(k=>String(c?.[k]??'')));
  const reason=v=>typeof v==='string'?v:v?.message||'';
  const runId=v=>typeof v==='string'&&/^ring:[0-9a-f]{32}$/.test(v);
  const actorId=v=>typeof v==='string'&&/^[A-Za-z0-9:_-]{1,100}$/.test(v);
  const TACTICS={steady:'穩健',balanced:'均衡',deep:'深入'},ROLES={guard:'守護',breach:'破陣',aid:'支援',control:'壓制'};
  const STATUS={lobby:'集結中',running:'遠征中',complete:'遠征已完成',ended:'遠征已結束'};
  const TABS=[['current','目前遠征'],['lobby','招募大廳'],['shop','星征補給'],['cosmetics','專屬星紋']];
  const ROUTES={create:'star-ring/create-scoped',action:'star-ring/action-scoped',shop:'star-ring/shop-scoped',cosmetic:'star-ring/cosmetics/equip-scoped'};
  const ITEMS={star_ring_token:'星征徽記',star_ring_core:'星冕核心',scroll_w:'武器強化卷',scroll_a:'防具強化卷',scroll_r:'洗屬性卷',blessed_scroll_w:'祝福武器卷軸',blessed_scroll_a:'祝福防具卷軸',guaranteed_scroll_w:'必過的武器強化卷',guaranteed_scroll_a:'必過的防具強化卷'};
  const pendingMemory=new Map(),sheets=new WeakMap(),scriptUrl=globalThis.document?.currentScript?.src;
  const requestId=()=> 'ssr_'+(globalThis.crypto?.randomUUID?.().replaceAll('-','')||Date.now().toString(36)+Math.random().toString(36).slice(2,14));
  const when=v=>Number.isFinite(Number(v))&&Number(v)>0?new Date(Number(v)).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'—';
  function canonical(kind,body,withId=false){
    if(!plain(body))return null;
    const idKeys=withId?['requestId']:[];
    if(withId&&(typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(body.requestId)))return null;
    let fields,out;
    if(kind==='create'){
      fields=['tier','difficulty','tactic'];if(!integer(body.tier)||body.tier===0||!['normal','advanced'].includes(body.difficulty)||!Object.hasOwn(TACTICS,body.tactic))return null;
      out={tier:body.tier,difficulty:body.difficulty,tactic:body.tactic};
    }else if(kind==='action'){
      if(!runId(body.partyId)||!['join','join-ready','ready','start','tactic','leave'].includes(body.action))return null;
      fields=['partyId','action'];out={partyId:body.partyId,action:body.action};
      if(body.action==='ready'){if(typeof body.ready!=='boolean')return null;fields.push('ready');out.ready=body.ready;}
      if(body.action==='tactic'){if(!Object.hasOwn(TACTICS,body.tactic))return null;fields.push('tactic');out.tactic=body.tactic;}
    }else if(kind==='shop'){
      fields=['offerId'];if(typeof body.offerId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(body.offerId))return null;out={offerId:body.offerId};
    }else if(kind==='cosmetic'){
      fields=['cosmeticId'];if(!Object.hasOwn(body,'cosmeticId')||body.cosmeticId!==null&&(typeof body.cosmeticId!=='string'||!/^star_ring_aura_(dawn|moon|eclipse)$/.test(body.cosmeticId)))return null;
      out={cosmeticId:body.cosmeticId};
    }else return null;
    if(Object.keys(body).length!==fields.length+idKeys.length||Object.keys(body).some(k=>!fields.includes(k)&&!idKeys.includes(k)))return null;
    return out;
  }
  const signature=(kind,body)=>{const c=canonical(kind,body,Object.hasOwn(body||{},'requestId'));return c?JSON.stringify({kind,...c}):null;};
  function validRecord(r,identity){
    return plain(r)&&r.version===1&&r.scope===identity&&Object.hasOwn(ROUTES,r.kind)&&typeof r.id==='string'&&r.id===r.body?.requestId&&!!canonical(r.kind,r.body,true)
      &&typeof r.label==='string'&&r.label.length<=200&&typeof r.details==='string'&&r.details.length<=2400&&plain(r.expected)&&r.signature===signature(r.kind,r.body);
  }
  function validQuery(input={}){
    if(!plain(input)||Object.keys(input).some(k=>!['partyId','recipientCharId'].includes(k)))throw Error('遠征查詢內容不完整');
    const q={};
    if(input.partyId!=null&&input.partyId!==''){if(!runId(input.partyId))throw Error('遠征編號格式不正確');q.partyId=input.partyId;}
    if(input.recipientCharId!=null&&input.recipientCharId!==''){if(!q.partyId||!actorId(input.recipientCharId))throw Error('戰報角色或遠征編號不完整');q.recipientCharId=input.recipientCharId;}
    return q;
  }
  function resultMatches(r,result){
    if(!plain(result))return false;
    const b=r.body,x=r.expected;
    if(r.kind==='create')return runId(result.partyId)&&result.tier===b.tier&&result.difficulty===b.difficulty&&result.tactic===b.tactic;
    if(r.kind==='action')return result.partyId===b.partyId&&result.action===b.action&&(b.action!=='ready'||result.ready===b.ready)&&(b.action!=='tactic'||result.tactic===b.tactic);
    if(r.kind==='cosmetic')return Object.hasOwn(result,'cosmeticId')&&result.cosmeticId===b.cosmeticId;
    if(result.offerId!==b.offerId||!plain(result.items)||!Array.isArray(result.equipment))return false;
    if(x.cosmetic)return result.cosmetic===x.cosmetic&&Object.keys(result.items).length===0&&result.equipment.length===0&&(result.alreadyOwned===undefined||typeof result.alreadyOwned==='boolean');
    if(result.cosmetic!=null||result.alreadyOwned!==undefined)return false;
    if(x.gear)return Object.keys(result.items).length===0&&result.equipment.length===1&&typeof result.equipment[0]?.id==='string'&&result.equipment[0].id.length>0&&typeof result.equipment[0].name==='string';
    return typeof x.item==='string'&&integer(x.qty)&&x.qty>0&&Object.keys(result.items).length===1&&result.items[x.item]===x.qty&&result.equipment.length===0;
  }
  function receiptMatches(r,v){
    const receipt=v?.receipt;if(!plain(receipt)||receipt.version!==1||receipt.kind!==r.kind||receipt.requestId!==r.id||!integer(receipt.createdAt)||!plain(receipt.costs))return false;
    const expected=r.kind==='shop'&&!(r.expected.cosmetic&&v.result?.alreadyOwned===true)?{[r.expected.currency]:r.expected.cost}:{};
    return Object.keys(receipt.costs).length===Object.keys(expected).length&&Object.keys(expected).every(k=>integer(receipt.costs[k])&&receipt.costs[k]===expected[k]);
  }
  function createClient(host){
    const context={...host.getContext?.()},identity=key(context),scope=key(context,true),partyVersions=new Map();
    let storage=host.storage;if(!storage){try{storage=globalThis.sessionStorage;}catch{}}
    const storageKey='rpg-ssr-pending:'+identity;
    const state={data:null,loading:false,busy:false,checking:false,stale:true,error:'',notice:'',confirm:null,receipt:null,lastResult:null,revision:-1,minRevision:-1,receivedAt:0};
    let disposed=false,generation=0,receiptGeneration=0,controller=null,receiptController=null,query={};
    const current=()=>!disposed&&key(host.getContext?.(),true)===scope&&host.current?.()!==false;
    const notify=()=>{if(current())host.onState?.(state);};
    const now=()=>Number(state.data?.now||Date.now())+Math.max(0,Date.now()-state.receivedAt);
    function pending(){
      if(pendingMemory.has(identity))return pendingMemory.get(identity);
      let value=null;try{const r=JSON.parse(storage?.getItem?.(storageKey)||'null');if(validRecord(r,identity))value=r;}catch{}
      pendingMemory.set(identity,value);return value;
    }
    function savePending(value){pendingMemory.set(identity,value);try{if(value)storage?.setItem?.(storageKey,JSON.stringify(value));else storage?.removeItem?.(storageKey);}catch{}}
    function clearPending(id){if(pending()?.id===id){savePending(null);state.receipt=null;}}
    function markRevealed(id){const r=pending();if(r?.id===id&&!r.revealed)savePending({...r,revealed:true});}
    function feedback(message,error=false){if(!current())return;state[error?'error':'notice']=message;notify();}
    function verifyIdentity(value){for(const k of ['accountId','realmId','characterId'])if(String(value?.[k])!==String(context[k]))throw Error('角色或世界已切換，請重新開啟星環遠征');}
    function accept(value,nextQuery){
      if(value?.ok!==true||!plain(value.catalog)||!Array.isArray(value.catalog.tiers)||!Array.isArray(value.catalog.tactics)||!Array.isArray(value.parties)||!Array.isArray(value.history)||!plain(value.daily)||!plain(value.presence)||!plain(value.shop)||!Array.isArray(value.shop.offers)||(!plain(value.shop.cosmetics)||!Array.isArray(value.shop.cosmetics.catalog)||!Array.isArray(value.shop.cosmetics.owned)))throw Error('遠征資料尚未完整，請重新整理');
      verifyIdentity(value);if(String(value.character?.id)!==String(context.characterId))throw Error('目前角色資料不一致');
      if(!integer(value.revision)||value.revision<Math.max(state.revision,state.minRevision))throw Error('收到較早的角色資料，請重新整理');
      if(nextQuery.partyId&&value.party?.id!==nextQuery.partyId)throw Error('遠征戰報與查詢編號不符');
      if(value.party&&String(value.party.recipientCharId)!==String(nextQuery.recipientCharId||context.characterId))throw Error('遠征戰報與查看角色不符');
      const versions=new Map();
      for(const p of [value.active,value.party,...value.parties,...value.history].filter(Boolean)){
        if(!runId(p.id)||!integer(p.rev)||!Array.isArray(p.members)||!Array.isArray(p.stages)||!integer(p.completedStages)||p.rev<(partyVersions.get(p.id)??-1))throw Error('收到較早或不完整的遠征紀錄，請重新整理');
        versions.set(p.id,Math.max(p.rev,versions.get(p.id)??-1));
      }
      for(const [id,rev]of versions)partyVersions.set(id,rev);
      return value.revision;
    }
    const partyFingerprint=p=>p?[p.id,p.rev,p.status,p.readonly,p.recipientCharId,p.me,p.members.map(m=>[m.id,m.ready,m.left]),p.controls,p.tactic,p.nextTactic,p.completedStages,p.settlementPending]:null;
    const fingerprint=()=>JSON.stringify([state.revision,query,state.data?.readOnly,state.data?.daily,state.data?.presence,partyFingerprint(state.data?.party),state.data?.shop]);
    // A revision-only re-read keeps the current buttons until the answer arrives.
    var backgroundRead=false;
    async function refresh(nextQuery=query){
      const quiet=backgroundRead;backgroundRead=false;
      if(!current()||state.busy||state.checking)return false;
      const ticket=++generation,before=fingerprint();controller?.abort();controller=new AbortController();state.loading=true;state.error='';if(!quiet)notify();
      try{
        const q=validQuery(nextQuery),value=await host.request('star-ring/scene',clone(q),{signal:controller.signal});
        if(!current()||ticket!==generation)return false;
        state.revision=accept(value,q);query=q;state.data=clone(value);state.receivedAt=Date.now();state.stale=false;
        if(state.confirm&&before!==fingerprint()){state.confirm=null;state.notice='遠征或角色資料已更新，請重新確認操作。';}
        return true;
      }catch(error){if(!current()||ticket!==generation)return false;state.stale=true;state.confirm=null;state.error=error?.message||'暫時無法讀取遠征資料';return false;}
      finally{if(current()&&ticket===generation){state.loading=false;notify();}}
    }
    function readiness(kind,body,{recover=false}={}){
      if(!current())return '角色或世界已切換';
      if(state.busy||state.loading||state.checking)return '正在更新遠征資料';
      if(!state.data||state.stale||state.revision<state.minRevision)return '請先更新遠征資料';
      if(state.data.readOnly)return reason(state.data.readOnlyReason)||'這個世界目前只能查看資料';
      if(query.recipientCharId||state.data.party?.readonly)return '這是角色戰報，只能查看';
      if(!recover&&pending())return '請先核對上次操作結果';
      if(recover)return '';
      if(kind==='create')return state.data.presence.canCreate===true?'':reason(state.data.presence.reason)||'目前無法建立遠征';
      if(kind==='action'){
        const p=state.data.party;if(!p||p.id!==body?.partyId)return '請先開啟這支遠征隊伍';
        const name=['join','join-ready'].includes(body.action)?'join':body.action,c=p.controls?.[name];
        return c?.allowed===true?'':reason(c?.reason)||'目前無法執行這個隊伍操作';
      }
      if(kind==='shop'||kind==='cosmetic')return state.data.shop.canOperate===true?'':reason(state.data.shop.reason)||'目前無法使用星征補給與星紋';
      return '';
    }
    function prepare(kind,body,label,details,expected={}){
      const c=canonical(kind,body),blocked=readiness(kind,body);if(blocked){feedback(blocked,true);return false;}
      if(!c){feedback('操作內容不完整，請重新選擇。',true);return false;}
      state.error='';state.notice='';state.confirm={kind,body:c,label,details,expected:clone(expected),fingerprint:fingerprint(),recovery:false};notify();return true;
    }
    function prepareCreate(draft){
      const c=canonical('create',draft),catalog=state.data?.catalog;
      if(!c||!catalog?.tiers?.some(t=>t.id===c.tier)||!catalog?.tactics?.some(t=>t.id===c.tactic)){feedback('請選擇有效的遠征階級與戰術',true);return false;}
      const selectedTier=catalog.tiers.find(t=>t.id===c.tier);if(selectedTier.canCreate===false){feedback(reason(selectedTier.reason)||'目前角色不符合這個遠征階級的條件',true);return false;}
      if(Number(state.data.character.level)<c.tier){feedback('目前角色尚未達到這個遠征階級',true);return false;}
      return prepare('create',c,'建立五人遠征','Lv.'+c.tier+' · '+(c.difficulty==='advanced'?'高難度':'標準')+' · '+TACTICS[c.tactic]+'戰術。建立後等待五個不同帳號準備；出發才使用今日次數。',{});
    }
    function prepareAction(action,extra={}){
      const p=state.data?.party;if(!p){feedback('請先開啟遠征隊伍',true);return false;}
      const body={partyId:p.id,action,...extra},name=p.name||'星環遠征';
      const labels={join:'加入遠征', 'join-ready':'加入並準備',ready:body.ready?'準備完成':'取消準備',start:'啟程遠征',tactic:'調整隊伍戰術',leave:p.status==='lobby'?'離開招募隊伍':'提前結束個人遠征'};
      let detail='隊伍：'+name+'。';
      if(['join','join-ready'].includes(action))detail+='以目前角色加入。'+(action==='join-ready'?'加入後設為準備完成。':'')+'出發才使用今日次數。';
      else if(action==='ready')detail+=body.ready?'以目前角色設定為準備完成，隊長可在全員就緒後出發。':'取消目前角色的準備狀態。';
      else if(action==='start')detail+='五個不同帳號全員就緒後，開始 '+fmt((state.data.catalog.duration||43200000)/3600000)+' 小時遠征，使用每位角色今日一次啟程。出發時保存隊員構築；每兩小時結算一個階段。';
      else if(action==='tactic')detail+='改為「'+(TACTICS[body.tactic]||'')+'」。'+(p.status==='running'?'從下一個階段生效，已結算戰果保留。':'出發前套用新的隊伍戰術。');
      else if(action==='leave')detail+=p.status==='lobby'&&p.me?.leader?'隊長離開會解散尚未出發的招募隊伍。':p.status==='running'?'保留已結算階段收益，不退還今日啟程次數；未結算收益不會提前發放。':'離開尚未出發的招募隊伍。';
      return prepare('action',body,labels[action]||'遠征操作',detail,{partyName:name});
    }
    function prepareShop(offerId){
      const offer=state.data?.shop?.offers.find(o=>o.id===offerId);
      if(!offer||offer.canExchange!==true){feedback(reason(offer?.reason)||'目前無法兌換這個品項',true);return false;}
      const currency=offer.currency||'star_ring_token';
      if(!integer(offer.cost)||offer.cost<=0){feedback('商品成本尚未完整',true);return false;}
      return prepare('shop',{offerId:offer.id},'兌換'+offer.name,'消耗 '+fmt(offer.cost)+' '+(offer.currencyName||ITEMS[currency]||currency)+'，取得 '+offer.name+'。'+(offer.gear?'依目前角色職業與等級產生一件隨機裝備；完成後可核對原裝備，不重新抽取。':offer.cosmetic?'永久綁定目前角色，僅改變外觀，不增加能力。':'物品放入目前角色背包。'),{currency,cost:offer.cost,item:offer.item||null,qty:offer.qty||0,gear:offer.gear===true,cosmetic:offer.cosmetic||null,name:offer.name});
    }
    function prepareCosmetic(cosmeticId){
      const c=state.data?.shop?.cosmetics,choice=cosmeticId===null?null:c?.catalog?.find(x=>x.id===cosmeticId);
      if(cosmeticId!==null&&(!choice||!c.owned?.includes(cosmeticId))){feedback('尚未解鎖這款星紋',true);return false;}
      if(Number(state.data?.character?.level)<40){feedback('星環外觀需要 Lv.40',true);return false;}
      return prepare('cosmetic',{cosmeticId},cosmeticId===null?'卸下星紋':'穿戴'+choice.name,'只調整目前角色的環身星紋，不消耗徽記，也不增加戰鬥能力。',{name:choice?.name||'未穿戴'});
    }
    function cancel(){if(!current()||state.busy)return;state.confirm=null;notify();}
    function recoveryReason(id){
      const r=pending();if(!r||r.id!==id)return '找不到這筆原操作';
      const blocked=readiness(r.kind,r.body,{recover:true});if(blocked)return blocked;
      return state.receipt?.found===false&&state.receipt.recoveryAllowed===true?'':'請先查詢這筆原操作的完整收據';
    }
    function prepareRecovery(id){
      const blocked=recoveryReason(id);if(blocked){feedback(blocked,true);return false;}
      const record=clone(pending());state.error='';state.confirm={...record,label:'重試這筆原操作',details:record.label+'。'+record.details+' 尚未查到完成收據，原請求可能仍在處理。確認後只使用完全相同的操作編號與內容；已完成時取回原結果。',record,recovery:true,fingerprint:fingerprint()};notify();return true;
    }
    function responseMatches(r,v){
      return v?.ok===true&&integer(v.revision)&&v.revision>=Math.max(state.revision,state.minRevision)&&v.kind===r.kind&&v.requestId===r.id&&v.signature===r.signature&&resultMatches(r,v.result)&&receiptMatches(r,v);
    }
    async function send(record,recovery){
      savePending(record);state.confirm=null;state.busy=true;state.receipt=null;state.error='';state.notice='';generation++;receiptGeneration++;controller?.abort();receiptController?.abort();notify();let acknowledged=false;
      try{
        const value=await host.request(ROUTES[record.kind],clone(record.body));if(!current())return false;verifyIdentity(value);
        if(!responseMatches(record,value))throw Object.assign(Error('未收到匹配的完整遠征收據'),{uncertain:true});
        clearPending(record.id);acknowledged=true;state.lastResult={...clone(record),result:clone(value.result),costs:clone(value.receipt.costs)};state.stale=true;state.notice=record.label+'已完成。';state.minRevision=Math.max(state.minRevision,value.revision);
        if(record.kind==='create'||record.kind==='action'&&['join','join-ready'].includes(record.body.action))query={partyId:value.result.partyId};
        try{host.onChanged?.(value,{kind:record.kind,body:clone(record.body),recovery});}catch{}
      }catch(error){
        if(!current())return false;
        const status=Number(error?.status),uncertain=recovery||error?.uncertain||!Number.isInteger(status)||status<400||status>=500||/duplicate|request_reused|character_changed|stale|context|receipt|conflict/i.test(String(error?.code||''));
        if(!uncertain)clearPending(record.id);
        state.stale=true;state.error=uncertain?'操作結果待核對。請查詢原操作紀錄，重新整理不會再次送出。':error?.message||'操作尚未完成，請重新確認條件';
      }finally{if(current()){state.busy=false;notify();if(acknowledged||!pending()){const message=state.error;await refresh();if(message&&!state.error){state.error=message;notify();}}}}
      return acknowledged;
    }
    async function submit(){
      if(!current()||!state.confirm)return false;const plan=state.confirm;
      if(plan.fingerprint!==fingerprint()){state.confirm=null;feedback('遠征或角色資料已變更，請重新確認。',true);return false;}
      if(plan.recovery){
        const blocked=recoveryReason(plan.record.id),record=pending();
        if(blocked||!record||!same(record,plan.record)){state.confirm=null;feedback(blocked||'原操作紀錄已變更，請重新核對。',true);return false;}
        return send(clone(record),true);
      }
      const blocked=readiness(plan.kind,plan.body);if(blocked){state.confirm=null;feedback(blocked,true);return false;}
      const id=requestId(),record={version:1,scope:identity,id,kind:plan.kind,body:{...clone(plan.body),requestId:id},signature:signature(plan.kind,plan.body),label:plan.label,details:plan.details,expected:clone(plan.expected),at:Date.now()};
      if(!validRecord(record,identity))throw Error('遠征操作內容不完整');
      return send(record,false);
    }
    async function checkPending(id){
      const record=pending();if(!current()||!record||record.id!==id||state.busy||state.loading||state.checking)return false;
      if(!await refresh()||!current()||pending()?.id!==id)return false;
      const ticket=++receiptGeneration;receiptController?.abort();receiptController=new AbortController();state.checking=true;state.receipt=null;state.error='';notify();
      try{
        const value=await host.request('star-ring/receipt',{kind:record.kind,...clone(record.body)},{signal:receiptController.signal});
        if(!current()||ticket!==receiptGeneration||pending()?.id!==id)return false;verifyIdentity(value);
        if(value?.ok!==true||typeof value.found!=='boolean'||value.kind!==record.kind||value.requestId!==id||value.signature!==record.signature||!integer(value.revision)||value.revision<Math.max(state.revision,state.minRevision))throw Error('遠征收據與原操作或角色版本不符');
        if(value.found&&!responseMatches(record,value))throw Error('收據缺少完整的原始結果或成本');
        if(!value.found&&(value.result!==null||value.receipt!==null||typeof value.recoveryAllowed!=='boolean'))throw Error('收據狀態不一致，請重新查詢');
        if(value.revision>state.revision){state.minRevision=Math.max(state.minRevision,value.revision);state.stale=true;}
        state.receipt=clone(value);state.notice=value.found?'已找到這筆原操作的已提交紀錄。':'尚未查到原操作紀錄。原請求可能仍在處理，待核對紀錄會保留。';return true;
      }catch(error){if(!current()||ticket!==receiptGeneration)return false;state.receipt=null;state.error=error?.message||'暫時無法核對原操作';return false;}
      finally{if(current()&&ticket===receiptGeneration){state.checking=false;notify();}}
    }
    function acknowledge(id){
      const record=pending(),receipt=state.receipt;
      if(!current()||!record||record.id!==id||state.busy||state.loading||state.checking||state.stale||state.revision<state.minRevision||receipt?.found!==true)return false;
      state.lastResult={...clone(record),result:clone(receipt.result),costs:clone(receipt.receipt.costs)};clearPending(id);state.error='';state.notice='已核對原操作的已提交紀錄。';
      const selectsParty=record.kind==='create'||record.kind==='action'&&['join','join-ready'].includes(record.body.action);
      if(selectsParty){query={partyId:receipt.result.partyId};state.stale=true;}
      try{host.onChanged?.(clone(receipt),{kind:record.kind,body:clone(record.body),recovery:false,acknowledged:true});}catch{}
      notify();if(selectsParty)void refresh();return true;
    }
    function update(scene){
      if(!current())return;for(const k of ['accountId','realmId','characterId'])if(scene?.[k]!=null&&String(scene[k])!==String(context[k]))return;
      const rev=scene?.live?.revision??scene?.character?.revision??scene?.revision;if(!integer(rev))return;
      state.minRevision=Math.max(state.minRevision,rev);
      if(rev>state.revision){state.stale=true;if(state.confirm){state.confirm=null;state.notice='角色狀態已更新，請重新確認。';}if(!state.busy&&!state.loading&&!state.checking){backgroundRead=true;void refresh();}else notify();}
    }
    return {state,context,current,now,pending,markRevealed,readiness,recoveryReason,feedback,refresh,getQuery:()=>clone(query),prepareCreate,prepareAction,prepareShop,prepareCosmetic,prepareRecovery,cancel,submit,checkPending,acknowledge,update,
      dispose(){if(disposed)return;disposed=true;generation++;receiptGeneration++;controller?.abort();receiptController?.abort();}};
  }
  function parseDestination(search='',startParam=''){
    const q=new URLSearchParams(String(search||''));let partyId=q.get('ringParty'),recipientCharId=q.get('ringChar'),joinIntent=q.get('ringJoin')==='1';
    if(partyId){if(!runId(partyId)||recipientCharId&&!actorId(recipientCharId))return null;}
    else{const m=/^ring_([0-9a-f]{32})$/.exec(String(startParam||q.get('screen')||q.get('tgWebAppStartParam')||''));if(!m)return null;partyId='ring:'+m[1];joinIntent=true;}
    return {partyId,...(recipientCharId?{recipientCharId}:{}),joinIntent:joinIntent&&!recipientCharId,tab:'current'};
  }
  function invitationUrl(base,partyId){
    if(!runId(partyId))return null;try{const url=new URL(base);if(!['http:','https:'].includes(url.protocol))return null;url.search='';url.hash='';url.searchParams.set('ringParty',partyId);url.searchParams.set('ringJoin','1');return url.href;}catch{return null;}
  }
  function ensureStyle(root){
    const doc=root.ownerDocument;if(!doc?.head||!doc.createElement||sheets.has(doc))return;
    const link=doc.createElement('link');link.rel='stylesheet';link.href=scriptUrl?new URL('scene-star-ring-ui.css?v=20261105',scriptUrl).href:'scene-star-ring-ui.css?v=20261105';link.onerror=()=>{sheets.delete(doc);link.remove?.();};doc.head.appendChild(link);sheets.set(doc,link);
  }
  function mount(root,host,options={}){
    ensureStyle(root);const draft=host.draft||{};
    draft.tab=TABS.some(([k])=>k===(options.tab||draft.tab))?options.tab||draft.tab:'current';
    if(Object.hasOwn(options,'partyId'))draft.partyId=options.partyId;
    if(Object.hasOwn(options,'recipientCharId'))draft.recipientCharId=options.recipientCharId;
    if(Object.hasOwn(options,'joinIntent'))draft.joinIntent=options.joinIntent===true&&!options.recipientCharId;
    draft.tier=Number.isSafeInteger(draft.tier)?draft.tier:40;draft.difficulty=draft.difficulty==='advanced'?'advanced':'normal';draft.tactic=Object.hasOwn(TACTICS,draft.tactic)?draft.tactic:'balanced';
    let disposed=false,timer=null,focusConfirm=false,confirmationOrigin=null,focusAfterCancel=null,savedFocus=null,revealFrame=null,revealId=null,revealedId=null;
    const client=createClient({...host,onState:()=>paint(),onChanged:(value,operation)=>{
      if(!client.current())return;
      if(operation.kind==='create'||operation.kind==='action'&&['join','join-ready'].includes(operation.body.action)){draft.tab='current';draft.partyId=value.result.partyId;delete draft.recipientCharId;draft.joinIntent=false;}
      try{host.onChanged?.(value,operation);}catch{}
    }}),state=client.state,data=()=>state.data,party=()=>data()?.party;
    const query=()=>({...((draft.partyId!=null&&draft.partyId!=='')?{partyId:draft.partyId}:{}),...((draft.recipientCharId!=null&&draft.recipientCharId!=='')?{recipientCharId:draft.recipientCharId}:{})});
    const refresh=()=>client.refresh(query()),locked=()=>state.loading||state.busy||state.checking;
    const muted=t=>'<p class="ssr-muted">'+esc(t)+'</p>';
    const button=(action,label,{id,partyId,recipientCharId,offer,cosmetic,tactic,tab,primary=false,disabled=false}={})=>'<button type="button" data-ssr-action="'+action+'"'+(id?' data-pending-id="'+esc(id)+'"':'')+(partyId?' data-party-id="'+esc(partyId)+'"':'')+(recipientCharId?' data-recipient-char-id="'+esc(recipientCharId)+'"':'')+(offer?' data-offer="'+esc(offer)+'"':'')+(cosmetic!==undefined?' data-cosmetic="'+esc(cosmetic===null?'none':cosmetic)+'"':'')+(tactic?' data-tactic="'+esc(tactic)+'"':'')+(tab?' data-tab="'+esc(tab)+'"':'')+(disabled?' disabled':'')+' class="'+(primary?'ssr-primary':'')+'">'+esc(label)+'</button>';
    function operationResult(r,result,costs){
      if(r.kind==='create')return '已建立遠征 '+result.partyId+'。';
      if(r.kind==='action')return r.label+'已提交至原隊伍 '+result.partyId+'。';
      if(r.kind==='cosmetic')return result.cosmeticId===null?'已卸下星紋。':'已穿戴 '+r.expected.name+'。';
      const spent=Object.entries(costs||{}).map(([id,n])=>fmt(n)+' '+(ITEMS[id]||id)).join('、');
      const items=Object.entries(result.items||{}).map(([id,n])=>(ITEMS[id]||id)+' × '+fmt(n));
      const gear=(result.equipment||[]).map(e=>e.name+'（原裝備 '+e.id+'）');
      return (result.alreadyOwned?'此外觀已解鎖，這筆沒有再次扣款。':spent?'已消耗 '+spent+'。':'')+[...items,...gear,...(result.cosmetic?['已解鎖 '+r.expected.name]:[])].join('；');
    }
    function notices(){
      let html=(state.error?'<p class="ssr-feedback ssr-error" role="alert">'+esc(state.error)+'</p>':'')+(state.notice?'<p class="ssr-feedback" role="status">'+esc(state.notice)+'</p>':'');
      if(state.stale&&data())html+=muted('顯示上次讀取的資料；更新完成後才能確認新操作。');
      if(data()?.readOnly)html+='<p class="ssr-feedback">'+esc(reason(data().readOnlyReason)||'這個世界目前只能查看資料。')+'</p>';
      if(state.lastResult)html+='<section class="ssr-result"><h3>'+esc(state.lastResult.label)+'</h3><p>'+esc(operationResult(state.lastResult,state.lastResult.result,state.lastResult.costs))+'</p></section>';
      const r=client.pending(),receipt=state.receipt;
      if(r)html+='<section class="ssr-pending" data-ssr-pending="'+esc(r.id)+'" data-ssr-receipt-found="'+(receipt?.found===true?'1':'0')+'"><h3>'+esc(r.label)+' · 待核對</h3><p>'+esc(r.details)+'</p>'+muted('原操作編號 '+r.id)+(receipt?.found?'<p>'+esc(operationResult(r,receipt.result,receipt.receipt.costs))+'</p>':receipt?.found===false?muted('尚未查到完成收據；原請求可能仍在處理。已發生的原遠征推進仍以伺服器紀錄為準。'):'')+'<div class="ssr-actions">'+button('check-pending',state.checking?'核對中…':'查詢原操作紀錄',{id:r.id,disabled:locked()})+(receipt?.found?button('acknowledge','已核對這份紀錄',{id:r.id,disabled:locked()||state.stale}):receipt?.recoveryAllowed===true?button('retry','重試這筆原操作',{id:r.id,disabled:!!client.recoveryReason(r.id)}):'')+'</div></section>';
      return html;
    }
    function confirmation(){
      const c=state.confirm;if(!c)return '';return '<section class="ssr-confirm" data-ssr-confirm aria-labelledby="ssr-confirm-title"><h3 id="ssr-confirm-title">'+esc(c.label)+'？</h3><p>'+esc(c.details)+'</p><div class="ssr-actions">'+button('confirm',c.recovery?'確認重試原操作':'確認'+c.label,{primary:true,disabled:locked()||!!(c.recovery?client.recoveryReason(c.record.id):client.readiness(c.kind,c.body))})+button('cancel','取消',{disabled:state.busy})+'</div></section>';
    }
    function liveSummary(){
      const d=data(),c=d?.character;if(!c)return '';
      return '<section class="ssr-live"><div><strong>'+esc(c.name)+'</strong><span>目前角色 · Lv.'+fmt(c.level)+'</span></div><div class="ssr-vitals"><span>生命 '+fmt(c.hp)+' / '+fmt(c.stats?.maxHp)+'</span><span>魔力 '+fmt(c.mp)+' / '+fmt(c.stats?.maxMp)+'</span></div>'+muted('此角色今日啟程 '+(d.daily.used?'1':'0')+' / '+fmt(d.daily.limit)+' · 剩餘 '+fmt(d.daily.remaining)+' 次；每日台灣時間 00:00 重置，下次 '+when(d.daily.resetsAt)+'。')+
        (d.presence.backgroundRunId?muted('背景遠征進行中，普通掛機暫停；出發後可另參加一場組隊副本或爬塔。'):d.presence.reason?muted(reason(d.presence.reason)):'')+
        (d.presence.foregroundPartyId?muted('另有前景隊伍進行中：'+d.presence.foregroundPartyId):'')+'</section>';
    }
    function memberCards(p){
      const members=p.members||[];return '<div class="ssr-members">'+members.map(m=>'<article data-ssr-member="'+esc(m.id)+'"><div><strong>'+esc(m.name)+'</strong><span>Lv.'+fmt(m.level)+(m.id===p.leaderId?' · 隊長':'')+'</span></div><p>'+esc((m.roles||[]).map(r=>ROLES[r]||r).join('、')||'職責尚未確定')+'</p><small>'+esc(m.left?'已離隊':p.status==='lobby'?m.ready?'準備完成':'等待準備':'遠征成員')+'</small></article>').join('')+'</div>';
    }
    function controls(p){
      if(p.readonly||draft.recipientCharId)return '';
      let html='';const member=p.me&&!p.me.left;
      const op=(a,label,extra={})=>button(a,label,{...extra,disabled:!!client.readiness('action',{partyId:p.id,action:a})});
      if(p.status==='lobby'){
        if(!member)html+=op('join-ready','加入並準備',{primary:true});
        else{html+=op('ready',p.me.ready?'取消準備':'我已準備');if(p.me.leader)html+=op('start','啟程 · 12 小時',{primary:true});html+=op('leave','離開隊伍');html+=button('copy-invite','複製招募網址',{disabled:locked()});}
      }else if(p.status==='running'&&member)html+=op('leave','提前結束個人遠征');
      const blocked=Object.entries(p.controls||{}).filter(([name,v])=>v?.allowed===false&&v.reason&&(name==='join'&&!member||name==='start'&&p.me?.leader||name==='ready'&&member&&p.status==='lobby'||name==='leave'&&member));
      return (html?'<div class="ssr-actions">'+html+'</div>':'')+blocked.map(([,v])=>muted(reason(v.reason))).join('');
    }
    function stages(p){
      if(!p.stages?.length)return '';return '<section class="ssr-section"><h3>已結算階段 '+fmt(p.completedStages)+' / '+fmt(p.stages.length)+'</h3>'+muted('只有已保存的階段戰果會列為完成；時間進度不代表已領取獎勵。')+'<ol class="ssr-stages">'+p.stages.map((s,i)=>'<li data-ssr-stage="'+i+'" data-ssr-stage-settled="'+(s.result?'1':'0')+'"><div><b>'+fmt(i+1)+' · '+esc(s.name)+'</b><span>'+esc(s.result?'已結算 · 評價 '+s.result.grade:s.status==='active'&&p.settlementPending?'到期等待結算':s.status==='active'?'目前階段 · 尚未結算':'尚未結算')+'</span></div>'+muted(s.endsAt?'階段期限 '+when(s.endsAt):'出發後開始計時')+'</li>').join('')+'</ol></section>';
    }
    function rewards(p){
      const r=p.me?.rewards;if(!r)return '';
      const items=Object.entries(r.items||{}).filter(([,n])=>Number(n)!==0),equipment=Array.isArray(r.equipment)?r.equipment:[];
      return '<section class="ssr-section ssr-rewards" data-ssr-rewards><h3>這名角色已領收益</h3><div class="ssr-totals"><span>經驗 <b>'+fmt(r.exp)+'</b></span><span>裝備 <b>'+fmt(equipment.length)+' 件</b></span></div>'+(items.length?'<ul>'+items.map(([id,n])=>'<li>'+esc(ITEMS[id]||id)+' × '+fmt(n)+'</li>').join('')+'</ul>':muted('目前沒有已結算的物品收益。'))+(equipment.length?'<details><summary>查看已領裝備（'+fmt(equipment.length)+'）</summary><ul class="ssr-loot">'+equipment.map(e=>'<li>'+esc(e.name||'遠征裝備')+'<small>'+esc(e.id)+'</small></li>').join('')+'</ul></details>':'')+'</section>';
    }
    function battle(p){
      const b=p.battle;if(!b)return '';const preview=b.preview===true||p.status==='running';
      return '<details class="ssr-section ssr-battle"><summary>'+esc(preview?'遠征戰鬥推演 · 尚未結算':'最後已結算戰況')+'</summary>'+muted(preview?'以下生命、魔力與敵人狀態來自出發隊伍的戰鬥推演；與目前角色即時狀態分開。':'以下為最後已保存的階段戰鬥結果。')+(b.enemy?'<h4>'+esc(b.enemy.name)+'</h4><p>敵人生命 '+fmt(b.enemy.hp)+' / '+fmt(b.enemy.maxHp)+'</p>':'')+'<div class="ssr-preview-members">'+(b.members||[]).map(m=>'<p><b>'+esc(m.name)+'</b><span>遠征生命 '+fmt(m.hp)+' / '+fmt(m.maxHp)+' · 遠征魔力 '+fmt(m.mp)+' / '+fmt(m.maxMp)+'</span></p>').join('')+'</div>'+(p.pendingRankReward?muted('本階段獵賞仍為待結算預估，尚未計入已領收益。'):'')+'</details>';
    }
    function tactics(p){
      if(p.readonly||draft.recipientCharId||!p.me?.leader||p.me.left||!['lobby','running'].includes(p.status))return '';
      return '<section class="ssr-section"><h3>隊長戰術</h3>'+muted('目前：'+(TACTICS[p.tactic]||p.tactic)+(p.nextTactic?' · 下一階段：'+(TACTICS[p.nextTactic]||p.nextTactic):''))+'<div class="ssr-actions">'+(data()?.catalog.tactics||[]).map(t=>button('tactic',t.name,{tactic:t.id,disabled:!!client.readiness('action',{partyId:p.id,action:'tactic'})})).join('')+'</div>'+muted(p.status==='running'?'新戰術從下一階段生效，已結算結果保持。':'出發前可調整隊伍戰術。')+'</section>';
    }
    function currentView(){
      const p=party();if(!p)return '<section class="ssr-empty"><h3>目前沒有星環遠征</h3>'+muted('到招募大廳加入隊伍，或建立自己的五人遠征。')+button('tab','查看招募大廳',{tab:'lobby',primary:true,disabled:state.busy})+'</section>';
      const report=!!draft.recipientCharId||p.readonly,missing=p.roleCoverage?.missing||[];
      return '<section class="ssr-party" data-ssr-party="'+esc(p.id)+'" data-ssr-status="'+esc(p.status)+'" data-ssr-completed="'+fmt(p.completedStages)+'">'+
        (report?'<p class="ssr-feedback" data-ssr-report>這是角色戰報，只能查看；目前操作角色維持 '+esc(data()?.character.name)+'。</p>':'')+
        (draft.joinIntent&&!report&&p.status==='lobby'&&(!p.me||p.me.left)?'<p class="ssr-feedback" data-ssr-join-intent>你正在查看招募邀請。確認「加入並準備」後，才會以目前角色加入。</p>':'')+
        '<span class="ssr-kicker">'+esc(STATUS[p.status]||p.status)+'</span><h3>'+esc(p.name||'星環遠征')+'</h3><p>Lv.'+fmt(p.tier)+' · '+(p.difficulty==='advanced'?'高難度':'標準遠征')+' · '+esc(TACTICS[p.tactic]||p.tactic)+'</p>'+
        (p.settlementPending?'<p class="ssr-feedback" data-ssr-settlement-pending>期限已到，等待伺服器結算。已完成階段與已領收益以保存的紀錄為準。</p>':'')+
        '<div class="ssr-times"><span>'+esc(p.status==='lobby'?'招募期限':'遠征期限')+' '+when(p.status==='lobby'?p.expiresAt:p.endsAt)+'</span>'+(p.status==='running'?'<span>下次階段 '+when(p.nextAt)+'</span>':'')+'</div>'+
        memberCards(p)+(p.status==='lobby'?muted('目前 '+fmt(p.members.filter(m=>!m.left).length)+' / 5 人。'+(missing.length?'尚缺 '+missing.map(r=>ROLES[r]||r).join('、')+'；':'')+'守護可自由搭配，高難度仍需破陣／支援／壓制。'):'')+controls(p)+tactics(p)+stages(p)+rewards(p)+battle(p)+
        (p.log?.length?'<details class="ssr-section"><summary>已保存的遠征紀錄</summary><ol class="ssr-log">'+p.log.map(l=>'<li><small>'+when(l.at)+'</small><span>'+esc(l.text||'')+'</span></li>').join('')+'</ol></details>':'')+'</section>';
    }
    function partyCard(p,history=false){
      return '<article class="ssr-card"><span class="ssr-kicker">'+esc(STATUS[p.status]||p.status)+'</span><h4>'+esc(p.name||'星環遠征')+'</h4><p>Lv.'+fmt(p.tier)+' · '+(p.difficulty==='advanced'?'高難度':'標準')+' · '+fmt(p.members?.filter(m=>!m.left).length||0)+' / 5 人</p>'+muted(history?'已結算 '+fmt(p.completedStages)+' / 6 階段':'招募至 '+when(p.expiresAt))+
        button('view',history?'查看戰報':'查看隊伍',{partyId:p.id,...(history?{recipientCharId:String(client.context.characterId)}:{}),disabled:state.busy})+'</article>';
    }
    function lobbyView(){
      const d=data(),tiers=d.catalog.tiers,base=client.readiness('create')||reason(tiers.find(t=>t.id===draft.tier)?.reason),under=Number(d.character.level)<draft.tier;
      return '<section class="ssr-section"><h3>籌組五人遠征</h3>'+muted('五個不同帳號全員準備，由隊長啟程。每角色每日一次，出發才計次。')+'<div class="ssr-fields"><label>遠征階級<select data-ssr-field="tier"'+(locked()?' disabled':'')+'>'+tiers.map(t=>'<option value="'+t.id+'"'+(draft.tier===t.id?' selected':'')+(t.id>d.character.level||t.canCreate===false?' disabled':'')+'>Lv.'+t.id+' · '+esc(t.name)+'</option>').join('')+'</select></label><label>挑戰強度<select data-ssr-field="difficulty"'+(locked()?' disabled':'')+'><option value="normal"'+(draft.difficulty==='normal'?' selected':'')+'>標準遠征</option><option value="advanced"'+(draft.difficulty==='advanced'?' selected':'')+'>高難度</option></select></label><label>出發戰術<select data-ssr-field="tactic"'+(locked()?' disabled':'')+'>'+d.catalog.tactics.map(t=>'<option value="'+esc(t.id)+'"'+(draft.tactic===t.id?' selected':'')+'>'+esc(t.name)+'</option>').join('')+'</select></label></div>'+button('create','建立五人遠征',{primary:true,disabled:!!base||under})+(base?muted(base):under?muted('目前角色尚未達此遠征階級。'):'')+'</section>'+
        '<section class="ssr-section"><h3>招募中的隊伍</h3>'+(d.parties.length?'<div class="ssr-card-grid">'+d.parties.map(p=>partyCard(p)).join('')+'</div>':muted('目前沒有招募中的遠征隊伍。'))+'</section>'+
        (d.active?'<section class="ssr-section"><h3>目前參與</h3>'+partyCard(d.active)+'</section>':'')+
        '<section class="ssr-section"><h3>這名角色的歷史戰報</h3>'+(d.history.length?'<div class="ssr-card-grid">'+d.history.map(p=>partyCard(p,true)).join('')+'</div>':muted('尚無已結束或已離隊的遠征紀錄。'))+'</section>';
    }
    function balances(){
      const b=data()?.shop?.balances||{};return '<div class="ssr-balances">'+['star_ring_token','star_ring_core'].map(id=>'<div><span>'+ITEMS[id]+'</span><strong data-ssr-currency="'+id+'">'+fmt(b[id]||0)+'</strong></div>').join('')+'</div>';
    }
    function shopView(){
      const shop=data().shop,blocked=client.readiness('shop');return balances()+(blocked?muted(blocked):'')+'<div class="ssr-card-grid">'+shop.offers.filter(o=>!o.cosmetic).map(o=>'<article class="ssr-card ssr-offer"><h3>'+esc(o.name)+'</h3><p>'+fmt(o.cost)+' '+esc(o.currencyName||ITEMS[o.currency||'star_ring_token']||o.currency)+'</p>'+muted(o.gear?'依本職業與目前等級隨機產生一件遠征裝備。':'每次取得 '+fmt(o.qty)+' 件。')+(o.reason?muted(reason(o.reason)):'')+button('buy','兌換',{offer:o.id,primary:true,disabled:!!blocked||o.canExchange!==true})+'</article>').join('')+'</div>';
    }
    function safeArt(path){return typeof path==='string'&&/^\/art\/[A-Za-z0-9_./-]+$/.test(path)&&!path.includes('..')?(host.artUrl?.(path)||path):'';}
    function cosmeticsView(){
      const c=data().shop.cosmetics,owned=new Set(c.owned||[]),selected=c.catalog.find(x=>x.id===draft.cosmeticPreview)||c.equipped||c.catalog[0],blocked=client.readiness('cosmetic'),art=safeArt(selected?.art);
      return balances()+'<section class="ssr-section"><h3>星環專屬星紋</h3>'+muted('永久綁定此角色；同時穿戴一種，不佔裝備欄位，也不增加戰鬥能力。')+(selected?'<figure class="ssr-aura-preview">'+(art?'<img src="'+esc(art)+'" alt="'+esc(selected.name)+'星紋素材預覽">':'')+'<figcaption><span>星紋素材預覽</span><b>'+esc(selected.name)+'</b></figcaption></figure>':'')+(blocked?muted(blocked):'')+'<div class="ssr-card-grid">'+c.catalog.map(a=>{const own=owned.has(a.id),on=c.equipped?.id===a.id,offer=data().shop.offers.find(o=>o.id===a.id),icon=safeArt(a.icon);return '<article class="ssr-card"><button type="button" data-ssr-action="preview-cosmetic" data-cosmetic="'+esc(a.id)+'" class="ssr-cosmetic-select" aria-pressed="'+(selected?.id===a.id)+'">'+(icon?'<img src="'+esc(icon)+'" alt="">':'')+'<b>'+esc(a.name)+'</b></button>'+muted(a.description)+'<p>'+esc(on?'穿戴中':own?'已永久解鎖':fmt(a.cost)+' 枚星征徽記')+'</p>'+
        (own?button('equip',on?'卸下':'穿戴',{cosmetic:on?null:a.id,primary:!on,disabled:!!blocked||Number(data().character.level)<Number(a.level||40)}):button('buy','兌換星紋',{offer:a.id,primary:true,disabled:!!blocked||offer?.canExchange!==true}))+(offer?.reason&&!own?muted(reason(offer.reason)):'')+'</article>';}).join('')+'</div></section>';
    }
    function focusIdentity(node){return node?{action:node.dataset?.ssrAction,id:node.dataset?.pendingId,partyId:node.dataset?.partyId,recipientCharId:node.dataset?.recipientCharId,offer:node.dataset?.offer,cosmetic:node.dataset?.cosmetic,tactic:node.dataset?.tactic,tab:node.dataset?.tab,field:node.dataset?.ssrField}:null;}
    function cancelReveal(){if(revealFrame!==null)globalThis.cancelAnimationFrame?.(revealFrame);revealFrame=null;revealId=null;}
    function revealPendingOnce(){
      const r=client.pending();if(!r||r.revealed||revealedId===r.id){cancelReveal();return;}
      if(locked()||state.confirm||typeof globalThis.requestAnimationFrame!=='function')return;
      if(revealFrame!==null&&revealId===r.id)return;cancelReveal();const id=r.id;revealId=id;
      const active=root.ownerDocument?.activeElement,atSchedule=root.contains?.(active)?JSON.stringify(focusIdentity(active)):active;
      revealFrame=globalThis.requestAnimationFrame(()=>{if(revealId!==id)return;revealFrame=null;revealId=null;if(disposed||!client.current()||!root.isConnected||root.ownerDocument?.hidden||locked()||state.confirm||client.pending()?.id!==id)return;
        const entry=[...root.querySelectorAll?.('[data-ssr-action="check-pending"]')||[]].find(n=>n.dataset.pendingId===id),panel=entry?.closest?.('[data-ssr-pending]');if(!entry||entry.disabled||!panel)return;
        const active=root.ownerDocument?.activeElement,atRun=root.contains?.(active)?JSON.stringify(focusIdentity(active)):active;revealedId=id;client.markRevealed(id);if(atRun!==atSchedule)return;
        savedFocus=null;panel.scrollIntoView?.({block:'nearest',behavior:'auto'});entry.focus?.({preventScroll:true});});
    }
    function paint(){
      if(disposed||!client.current())return;const top=root.scrollTop,doc=root.ownerDocument,active=doc?.activeElement;
      if(focusAfterCancel){savedFocus=focusAfterCancel;focusAfterCancel=null;}else if(root.contains?.(active))savedFocus=focusIdentity(active);else if(active&&active!==doc?.body&&active!==doc?.documentElement)savedFocus=null;
      const focus=savedFocus;
      root.innerHTML='<div class="ssr-panel" data-ssr-ready="'+(!state.loading&&!state.stale&&!!data()?'1':'0')+'" data-ssr-tab="'+draft.tab+'" aria-busy="'+locked()+'"><header class="ssr-header"><div><h2>星環遠征</h2><p>五人同行 · 十二小時</p></div>'+button('refresh',state.loading?'更新中…':'更新資料',{disabled:locked()})+'</header>'+
        '<nav class="ssr-tabs" aria-label="星環遠征功能">'+TABS.map(([tab,label])=>button('tab',label,{tab,disabled:state.busy})).join('')+'</nav>'+notices()+confirmation()+
        (!data()?muted('正在讀取遠征與角色資料…'):liveSummary()+(draft.tab==='current'?currentView():draft.tab==='lobby'?lobbyView():draft.tab==='shop'?shopView():cosmeticsView()))+
        '<nav class="ssr-shortcuts" aria-label="前景組隊活動">'+button('dungeon','組隊副本',{disabled:state.busy})+button('tower','三人爬塔',{disabled:state.busy})+'</nav></div>';
      root.scrollTop=top;
      for(const b of root.querySelectorAll?.('[data-ssr-action="tab"]')||[])b.setAttribute?.('aria-pressed',String(b.dataset.tab===draft.tab));
      if(state.confirm&&focusConfirm){focusConfirm=false;root.querySelector?.('[data-ssr-confirm]')?.scrollIntoView?.({block:'nearest'});root.querySelector?.('[data-ssr-action="cancel"]')?.focus?.({preventScroll:true});}
      else if(focus){const selector=focus.field?'[data-ssr-field]':'button',node=[...root.querySelectorAll?.(selector)||[]].find(n=>same(focusIdentity(n),focus));node?.focus?.({preventScroll:true});}
      revealPendingOnce();
    }
    function cancelConfirmation(){if(state.confirm&&!state.busy){focusAfterCancel=confirmationOrigin;confirmationOrigin=null;}client.cancel();}
    function prepare(origin,fn){confirmationOrigin=focusIdentity(origin);focusConfirm=true;if(!fn()){focusConfirm=false;confirmationOrigin=null;}}
    async function click(event){
      const b=event.target?.closest?.('[data-ssr-action]');if(!b||b.disabled||!root.contains?.(b)||!client.current())return;const action=b.dataset.ssrAction;
      cancelReveal();const pending=client.pending();if(pending){revealedId=pending.id;client.markRevealed(pending.id);}
      if(action==='refresh')return refresh();if(action==='cancel')return cancelConfirmation();if(action==='confirm')return client.submit();
      if(action==='check-pending')return client.checkPending(b.dataset.pendingId);if(action==='acknowledge')return client.acknowledge(b.dataset.pendingId);if(action==='retry')return prepare(b,()=>client.prepareRecovery(b.dataset.pendingId));
      if(state.busy||state.checking)return;
      if(action==='tab'){
        if(!TABS.some(([k])=>k===b.dataset.tab))return;draft.tab=b.dataset.tab;client.cancel();
        if(draft.tab!=='current'&&(draft.recipientCharId||draft.partyId&&draft.tab==='lobby')){delete draft.partyId;delete draft.recipientCharId;draft.joinIntent=false;return refresh();}
        paint();return;
      }
      if(action==='view'){draft.tab='current';draft.partyId=b.dataset.partyId;draft.recipientCharId=b.dataset.recipientCharId||null;draft.joinIntent=false;client.cancel();return refresh();}
      if(action==='create')return prepare(b,()=>client.prepareCreate({tier:draft.tier,difficulty:draft.difficulty,tactic:draft.tactic}));
      if(['join-ready','start','leave'].includes(action))return prepare(b,()=>client.prepareAction(action));
      if(action==='ready')return prepare(b,()=>client.prepareAction('ready',{ready:!party()?.me?.ready}));
      if(action==='tactic')return prepare(b,()=>client.prepareAction('tactic',{tactic:b.dataset.tactic}));
      if(action==='buy')return prepare(b,()=>client.prepareShop(b.dataset.offer));
      if(action==='equip')return prepare(b,()=>client.prepareCosmetic(b.dataset.cosmetic==='none'?null:b.dataset.cosmetic));
      if(action==='preview-cosmetic'){draft.cosmeticPreview=b.dataset.cosmetic;paint();return;}
      if(action==='dungeon'||action==='tower'){host.navigate?.(action==='dungeon'?'party':'tower');return;}
      if(action==='copy-invite'){
        const p=party();if(!p||p.readonly||draft.recipientCharId||!p.me||p.me.left)return;
        let base=globalThis.location?.href||root.ownerDocument?.location?.href;
        try{if(globalThis.parent&&globalThis.parent!==globalThis&&globalThis.parent.location.origin===globalThis.location?.origin)base=globalThis.parent.location.href;}catch{}
        const url=invitationUrl(base,p.id);
        if(!url){client.feedback('招募隊伍編號：'+p.id);return;}
        try{if(!globalThis.navigator?.clipboard?.writeText)throw Error('clipboard unavailable');await globalThis.navigator.clipboard.writeText(url);if(client.current())client.feedback('已複製招募網址；對方開啟後仍需確認加入。');}catch{if(client.current())client.feedback('招募網址：'+url);}
      }
    }
    function change(event){
      if(!client.current()||locked())return;const field=event.target?.dataset?.ssrField;if(!['tier','difficulty','tactic'].includes(field))return;
      draft[field]=field==='tier'?Number(event.target.value):String(event.target.value);client.cancel();paint();
    }
    const visibility=()=>{if(!root.ownerDocument?.hidden&&client.current()&&!locked()&&!state.confirm)void refresh();};
    root.addEventListener('click',click);root.addEventListener('change',change);root.ownerDocument?.addEventListener?.('visibilitychange',visibility);
    timer=globalThis.setInterval?.(()=>{if(client.current()&&!root.ownerDocument?.hidden&&!locked()&&!state.confirm)void refresh();},15000);
    paint();void refresh();
    return {refresh,update:client.update,handleBack(){if(state.confirm){cancelConfirmation();return true;}return false;},
      dispose(){if(disposed)return;disposed=true;cancelReveal();client.dispose();if(timer!==null)globalThis.clearInterval?.(timer);root.removeEventListener('click',click);root.removeEventListener('change',change);root.ownerDocument?.removeEventListener?.('visibilitychange',visibility);}};
  }
  globalThis.RpgSceneStarRing={createClient,mount,parseDestination,invitationUrl};
})();
