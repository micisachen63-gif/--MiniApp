import {shareDetails,telegramShareUrl,threadsShareUrl,CARD_ORIGIN} from './share-model.js';
export function nativeCapabilities(tg){const v=typeof tg?.isVersionAtLeast==='function'&&tg.isVersionAtLeast('8.0');return {telegram:!!tg?.initData,prepared:!!v&&typeof tg.shareMessage==='function',download:!!v&&typeof tg.downloadFile==='function'};}
export function createNativeShareHost({tg,fetcher=fetch,open=(url)=>window.open(url,'_blank','noopener,noreferrer'),now=()=>Date.now()}={}){
 const allowed=new Map();
 return {capabilities:nativeCapabilities(tg),async act(action,body){
  if(action==='prepare-share'){
   if(!nativeCapabilities(tg).prepared||!tg.initData)throw Error('這個TG版本未支援原生圖片分享，可改用TG連結。');
   const s=shareDetails(body.code,body.format);let response;try{response=await fetcher(CARD_ORIGIN+'/fate/share/prepare',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Init-Data':tg.initData},body:JSON.stringify({code:s.code,format:s.format}),signal:AbortSignal.timeout(15000)});}catch{throw Error('TG分享準備較慢，圖卡仍可儲存；請重試。');}
   const value=await response.json();if(!response.ok||!value.ok||typeof value.id!=='string'||value.id.length>512||!Number.isFinite(value.expirationDate)||value.expirationDate*1000<=now()||value.imageUrl!==s.imageUrl)throw Error('TG暫時無法準備圖卡，請重試或分享連結。');
   for(const [id,expiry]of allowed)if(expiry<=now())allowed.delete(id);if(allowed.size>=16)allowed.delete(allowed.keys().next().value);allowed.set(value.id,value.expirationDate*1000);return {id:value.id,expirationDate:value.expirationDate};
  }
  if(action==='share-message'){
   if(!nativeCapabilities(tg).prepared||!allowed.has(body.id)||allowed.get(body.id)<=now())throw Error('這張TG圖卡已過期，請重新準備。');
   return new Promise((resolve,reject)=>{try{tg.shareMessage(body.id,sent=>resolve({sent:sent===true,cancelled:sent!==true}));}catch{reject(Error('TG未能開啟分享選單，請重試或改用TG連結。'));}});
  }
  if(action==='download-image'){
   if(!nativeCapabilities(tg).download)throw Error('這個TG版本未支援圖片下載，可長按名帖儲存。');const s=shareDetails(body.code,body.format);
   return new Promise((resolve,reject)=>{try{tg.downloadFile({url:s.imageUrl,file_name:s.fileName},accepted=>resolve({accepted:accepted===true}));}catch{reject(Error('TG未能開啟下載，請長按名帖儲存。'));}});
  }
  const url=action==='telegram-link'?telegramShareUrl(body.code):action==='threads-draft'?threadsShareUrl(body.code):action==='instagram'?'https://www.instagram.com/':null;if(!url)throw Error('不支援的分享操作');
  if(action==='telegram-link'&&typeof tg?.openTelegramLink==='function'){tg.openTelegramLink(url);return {opened:true};}
  if(action!=='telegram-link'&&typeof tg?.openLink==='function'){tg.openLink(url);return {opened:true};}
  const opened=open(url);return {opened:!!opened,url};
 }};
}
