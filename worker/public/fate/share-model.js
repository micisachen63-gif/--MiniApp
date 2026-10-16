import {decodeResult,publicUrl,shareText} from './model.js';
export const CARD_ORIGIN='https://star-journal-rpg-bot.micisachen.workers.dev';
export const CARD_VERSION='20261016-share1';
export function shareDetails(code,format='post'){
 const result=decodeResult(code);if(!result||!['post','story'].includes(format))throw Error('這頁旅章無法分享，請重新開啟。');
 const url=publicUrl(result.code),text=shareText(result);
 return {code:result.code,format,url,text,caption:text+'\n'+url,imageUrl:`${CARD_ORIGIN}/fate-card/${result.code}/${format}.jpg?v=${CARD_VERSION}`,fileName:`star-journal-${result.code}-${format}.jpg`};
}
export const telegramShareUrl=code=>{const s=shareDetails(code);return 'https://t.me/share/url?'+new URLSearchParams({url:s.url,text:s.text})};
export const threadsShareUrl=code=>{const s=shareDetails(code);return 'https://www.threads.com/intent/post?'+new URLSearchParams({text:s.text,url:s.url})};
export const NATIVE_ACTIONS=Object.freeze(['prepare-share','share-message','download-image','telegram-link','threads-draft','instagram']);
export function validNative(m,charId){return m?.type==='star-fate-native'&&typeof m.id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(m.id)&&String(m.charId)===String(charId)&&NATIVE_ACTIONS.includes(m.action)&&m.body&&typeof m.body==='object'&&!Array.isArray(m.body);}
// A new snapshot invalidates asynchronous decoding/toBlob without publishing old privacy choices.
export function createCardGuard(){let revision=0;return {invalidate(){return ++revision},begin(){return ++revision},current:token=>token===revision};}
