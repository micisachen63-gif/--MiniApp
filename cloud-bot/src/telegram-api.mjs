// Telegram cloud transport. Credentials are env secrets and never logged.
export function createTelegramApi(token,{mediaBaseUrl}={}){
 if(!token)throw Error('BOT_TOKEN is not configured');
 async function request(method,body,options={}){
  const multipart=body instanceof FormData;
  let response;
  try{response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',...(multipart?{}:{headers:{'content-type':'application/json'}}),body:multipart?body:JSON.stringify(body||{}),signal:AbortSignal.timeout(options.timeoutMs||30000)});}
  catch{throw Object.assign(Error('Telegram network response unknown'),{name:'TelegramNetworkError',definite:false});}
  let data;try{data=await response.json();}catch{throw Object.assign(Error('Telegram response unknown'),{definite:false,httpStatus:response.status});}
  if(!data.ok)throw Object.assign(Error(data.description||'Telegram request rejected'),{definite:true,errorCode:data.error_code,httpStatus:response.status,description:data.description,parameters:data.parameters});
  return data.result;
 }
 async function media(options,type,edit=false){
  const body={chat_id:options.chatId,...(edit?{message_id:options.messageId}:{}),...(options.caption?{caption:options.caption.slice(0,1024)}:{}),...(options.replyMarkup?{reply_markup:options.replyMarkup}:{}),...(options.parseMode?{parse_mode:options.parseMode}:{}),...(options.replyToMessageId?{reply_to_message_id:options.replyToMessageId,allow_sending_without_reply:true}:{})};
  const boss=/^boss-(\d+)\.png$/.exec(options.fileName||'');
  const photoUrl=options.photoUrl?new URL(options.photoUrl,mediaBaseUrl+'/').href:(!edit&&type==='photo'&&boss?`${mediaBaseUrl}/telegram-media/boss-${boss[1]}.jpg`:null);
  if(photoUrl&&!edit)return request('sendPhoto',{...body,photo:photoUrl},{timeoutMs:45000});
  const form=new FormData();
  for(const [key,value] of Object.entries(body))if(!edit||!['caption','parse_mode'].includes(key))form.set(key,typeof value==='object'?JSON.stringify(value):String(value));
  const blob=new Blob([options.buffer],{type:options.mimeType||(type==='animation'?'image/gif':'image/png')});
  if(edit){form.set('media',JSON.stringify({type:options.mediaType||type,media:'attach://media_file',...(body.caption?{caption:body.caption}:{}),...(body.parse_mode?{parse_mode:body.parse_mode}:{})}));form.set('media_file',blob,options.fileName||'media.gif');}
  else form.set(type,blob,options.fileName||'media.png');
  return request(edit?'editMessageMedia':type==='animation'?'sendAnimation':'sendPhoto',form,{timeoutMs:45000});
 }
 return {call:request,sendPhoto:options=>media(options,'photo'),sendAnimation:options=>media(options,'animation'),editMessageMedia:options=>media(options,options.mediaType||'photo',true)};
}
export async function webhookSecret(secret){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('StarJournalRpgBot Cloudflare webhook v1')))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function equalSecret(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
