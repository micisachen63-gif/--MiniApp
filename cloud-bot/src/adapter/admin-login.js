import {decodeAdminChallenge} from '../../../worker/public/admin/pairing.js';

// This flow never selects/creates a game character. The Worker independently
// checks the service secret and current Telegram administrator role on approval.
export function createAdminLogin({config,api,rpgApi,log=console}){
 const ownPrivate=(chat,user)=>chat?.type==='private'&&String(chat.id)===String(user?.id);
 const send=(chatId,text,extra={})=>api.call('sendMessage',{chat_id:chatId,text,...extra});
 const answer=async(cq,text)=>{try{await api.call('answerCallbackQuery',{callback_query_id:cq.id,text,show_alert:true},{timeoutMs:3000,retries429:0});}catch{ /* The outer adapter may already have acknowledged this callback. */ }};
 const keyboard=token=>({inline_keyboard:[[{text:'核對相同代碼，批准登入',callback_data:'adm:approve:'+token}]]});
 const edit=(cq,text,reply_markup={inline_keyboard:[]})=>api.call('editMessageText',{chat_id:cq.message.chat.id,message_id:cq.message.message_id,text,reply_markup});
 async function handle({msg,user,cq}){
  const command=/^\/start(?:@([A-Za-z0-9_]+))?\s+(admin(?:[_:]|$).*)$/i.exec(String(msg.text||'').trim());
  const callback=String(cq?.data||'').startsWith('adm:');
  if(!command&&!callback)return false;
  if(command?.[1]&&command[1].toLowerCase()!==String(config.botUsername).toLowerCase())return true;
  if(!ownPrivate(msg.chat,user)){
   if(cq)await answer(cq,'請回到你與機器人的私人聊天核對登入。');
   else await send(msg.chat.id,'管理後台登入請從瀏覽器開啟連結，並在與機器人的私人聊天核對。');
   return true;
  }
  const token=callback?/^adm:approve:([A-Za-z0-9_-]{43})$/.exec(cq.data)?.[1]:/^admin_([A-Za-z0-9_-]{43})$/.exec(command[2])?.[1];
  const challenge=decodeAdminChallenge(token);
  if(!challenge){
   if(cq)await answer(cq,'這個登入按鈕已不適用，請回管理後台重新開始。');
   else await send(msg.chat.id,'登入連結格式無效或已不適用，請回管理後台重新開始。');
   return true;
  }
  const code=challenge.slice(0,8).toUpperCase();
  if(!cq){
   let member;
   try{member=await api.call('getChatMember',{chat_id:config.chatId,user_id:user.id},{timeoutMs:5000,retries429:0});}
   catch{log.warn('Admin login membership lookup unavailable');await send(msg.chat.id,'暫時無法確認管理資格，請稍後重新點擊瀏覽器的 Telegram 驗證按鈕。');return true;}
   if(!['creator','administrator'].includes(member?.status)||String(member?.user?.id)!==String(user.id)||member?.user?.is_bot!==false){
    await send(msg.chat.id,'管理後台僅供冒險者之庭目前的群組管理員使用。');return true;
   }
   await send(msg.chat.id,'星穹旅誌｜管理後台登入\n\n核對碼：'+code+'\n\n請先確認瀏覽器也顯示相同核對碼。僅批准你本人剛剛發起的登入；若不是你本人操作，請忽略這則訊息。\n\n按下批准後，回到原本的瀏覽器即可繼續，無須開啟遊戲或建立角色。',{reply_markup:keyboard(token)});
   return true;
  }
  try{
   // Approval is idempotent for this exact challenge/account pair. A retry after
   // a lost reply may safely recheck it; no gameplay mutation or award is called.
   const result=await rpgApi.call('/rpg/admin/login/approve',{adminTgId:String(user.id),challenge});
   if(result?.ok!==true||result?.approved!==true)throw Error('Unconfirmed admin approval');
  }catch(e){
   const status=Number(e?.status||e?.httpStatus)||0;
   const reason=status===403?'目前管理資格未通過確認，請確認群組權限後再試。':(['challenge','admin_challenge'].includes(e?.code)||status===409)?'這組登入代碼已失效，請回管理後台重新開始。':'暫時未能確認登入結果。請再按一次核對按鈕；若仍無法完成，請回管理後台重新開始。';
   await edit(cq,'星穹旅誌｜管理後台登入\n\n核對碼：'+code+'\n\n'+reason,keyboard(token));
   await answer(cq,reason);return true;
  }
  await edit(cq,'星穹旅誌｜管理後台登入\n\n核對碼：'+code+'\n\n已批准，請回到剛剛發起登入的瀏覽器繼續。');
  await answer(cq,'已批准，請回到管理後台。');return true;
 }
 return {handle};
}
