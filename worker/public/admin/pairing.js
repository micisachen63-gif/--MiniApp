// 32-byte public challenge, encoded to fit Telegram's 64-character /start limit.
// The browser's private verifier is never passed to either function or to Telegram.
export function encodeAdminChallenge(hex){
 if(typeof hex!=='string'||!/^[0-9a-f]{64}$/.test(hex))throw new TypeError('Invalid admin challenge');
 const bytes=hex.match(/../g).map(x=>parseInt(x,16));
 return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function decodeAdminChallenge(token){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
 try{
  const bytes=atob(token.replaceAll('-','+').replaceAll('_','/')+'=');
  if(bytes.length!==32)return null;
  const hex=Array.from(bytes,x=>x.charCodeAt(0).toString(16).padStart(2,'0')).join('');
  return encodeAdminChallenge(hex)===token?hex:null;
 }catch{return null;}
}
export const adminLoginCommand=hex=>'/start admin_'+encodeAdminChallenge(hex);
export const adminLoginLink=hex=>'https://t.me/StarJournalRpgBot?start=admin_'+encodeAdminChallenge(hex);
