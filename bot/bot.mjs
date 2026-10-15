import {createRpgFlow,RPG_CALLBACK_RE} from './flows/rpg-flow.js';
import {gameFetch} from './game-fetch.mjs';

export const commands=[{command:'start',description:'✨ 開始星穹旅誌'},{command:'rpg',description:'🎮 開啟冒險與角色'},{command:'group',description:'🌌 加入冒險者之庭'},{command:'help',description:'📖 冒險指引'},{command:'trade',description:'🤝 裝備交易指引'},{command:'duel',description:'⚔️ 挑戰群組玩家'}];
export function createGameBot({config,api,store,log=console,rpgApi}){
 const send=(text,extra={},cid=config.chatId)=>api.call('sendMessage',{chat_id:cid,text:config.active?String(text).replaceAll('小精靈','星穹旅誌'):text,...extra});
 const inGroup=chat=>String(chat?.id)===String(config.chatId);
 const privateChat=(chat,user)=>chat?.type==='private'&&String(chat.id)===String(user?.id);
 const members=new Map(),lookups=new Map();
 const isGroupMember=async user=>{
  const id=String(user.id),cached=members.get(id);if(cached&&Date.now()-cached<30000)return true;
  if(lookups.has(id))return lookups.get(id);
  const lookup=(async()=>{let failure;for(let attempt=0;attempt<2;attempt++){try{
   const m=await api.call('getChatMember',{chat_id:config.chatId,user_id:user.id},{timeoutMs:5000,retries429:0});
   if(!['member','administrator','creator','restricted','left','kicked'].includes(m?.status))throw Error('Unknown membership response');
   const ok=['member','administrator','creator'].includes(m.status)||(m.status==='restricted'&&m.is_member===true);
   if(ok){if(members.size>=1000)members.delete(members.keys().next().value);members.set(id,Date.now())}else members.delete(id);
   return ok;
  }catch(e){failure=e;if(e.definite)break}}
  log.warn('Membership lookup unavailable: '+(failure?.name||'Error'));
  throw Object.assign(Error('暫時無法確認群組資格，請稍後重試；角色建立進度已保留。'),{code:'membership_unknown'});
  })();lookups.set(id,lookup);try{return await lookup}finally{lookups.delete(id)}
 };
 const answer=(cq,text='')=>api.call('answerCallbackQuery',{callback_query_id:cq.id,text});
 const flow=createRpgFlow({api,send,answer,log,tgStore:store,inGroup,inUserPrivate:privateChat,isGroupMember,chatId:config.chatId,botUsername:()=>config.botUsername,configFile:config.rpgConfigFile,rpgApi,fetchImpl:gameFetch,mode:'life'});
 async function handleUpdate(update){
  const cq=update.callback_query,msg=update.message||cq?.message,user=cq?.from||msg?.from;
  if(!msg||!user||user.is_bot||(!inGroup(msg.chat)&&!privateChat(msg.chat,user)))return;
  if(!config.active){if(cq)return answer(cq,'新庭院正在準備中，原遊戲仍照常運作。');if(/^\/(start|rpg|help|group)(?:@\w+)?(?:\s|$)/i.test(msg.text||''))return send('✨ 歡迎來到《星穹旅誌》\n\n冒險者之庭已點亮星燈，正在準備迎接大家。\n目前仍請從原小精靈遊玩；正式轉移後，同一個 Telegram 帳號可接續原角色與收藏。\n\n🌌 轉移時間會另行通知。',{reply_markup:{inline_keyboard:[[{text:'🌌 冒險者之庭',url:config.inviteLink}]]}},msg.chat.id);return;}
  if(cq){try{await api.call('answerCallbackQuery',{callback_query_id:cq.id},{timeoutMs:3000,retries429:0})}catch(e){if(e.definite&&/query is too old|query ID is invalid/i.test(e.description||e.message)){log.warn('Expired callback ignored before game operation');return {ignored:'expired callback'}}log.warn('Callback acknowledgement unavailable: '+(e.name||'Error'))}}
  if(privateChat(msg.chat,user)&&!await isGroupMember(user)){if(cq)return answer(cq,'請先加入冒險者之庭。');return send('🌌 先加入冒險者之庭，再回來開啟你的旅誌。',{reply_markup:{inline_keyboard:[[{text:'加入專屬群組',url:config.inviteLink}]]}},msg.chat.id);}
  if(cq){const m=RPG_CALLBACK_RE.exec(String(cq.data||''));if(m)return flow.onCallback(cq,m[1],m[2]);return answer(cq);}
  let text=String(msg.text||'').trim();const suffix=/^\/\w+@([A-Za-z0-9_]+)/.exec(text);if(suffix&&suffix[1].toLowerCase()!==config.botUsername.toLowerCase())return;
  if(/^\/group(?:@\w+)?$/i.test(text)||/^\/start\s+journal$/i.test(text))return send('🌌 星穹旅誌｜冒險者之庭\n與夥伴組隊、挑戰首領，將遠方寫成故事。\n每日旅團日誌上午 08:00 發布；請在今天的卡片報到，並到遊戲神戰頁領取強化卷。',{reply_markup:{inline_keyboard:[[{text:'前往冒險者之庭',url:config.inviteLink}]]}},msg.chat.id);
  if(/^\/help(?:@\w+)?$/i.test(text))return send('📖 冒險指引\n\n/rpg 開啟遊戲：角色、技能、裝備、掛機與交易\n/group 前往專屬群組\n/trade 查看裝備交易方式\n/duel @玩家 發起決鬥\n\n在遊戲「神戰」組隊打寶、轉職試煉與爬塔；隊伍戰況會同步到群組。\n群組首領每小時整點出現，01:00～07:59 休息。',{},msg.chat.id);
  if(/^\/start(?:@\w+)?$/i.test(text))text='/rpg';
  return flow.onMessage(msg,text);
 }
 async function handle(update){try{return await handleUpdate(update)}catch(e){if(e.code!=='membership_unknown')throw e;const cq=update.callback_query,msg=update.message||cq?.message;if(cq)return answer(cq,e.message);if(msg)return send('⚠️ '+e.message,{},msg.chat.id)}}
 return {handle,tick:()=>config.active?flow.tick():Promise.resolve({staged:true}),active:config.active===true};
}
