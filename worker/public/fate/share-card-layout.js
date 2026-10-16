import {ZODIAC_CRESTS} from './zodiac-sign.js';

// Both browser PNG and Telegram JPEG use this composition. No private life data.
export function cardLayout(format='post'){
 if(!['post','story'].includes(format))throw Error('不支援的名帖尺寸');
 const story=format==='story';
 return {width:1080,height:story?1920:1350,artHeight:story?1320:900,
  crest:{x:story?330:380,y:story?830:435,size:story?420:320},
  signY:story?1302:793,latinY:story?1340:830,identityY:story?1435:913,
  endingY:story?1506:979,quoteY:story?1590:1055,quoteLine:44,
  invitationY:story?1740:1183,urlY:story?1818:1250,creditY:story?1862:1287};
}
export function cardIdentity(result){
 const sign=Number.isInteger(result?.zodiac)&&result.zodiac>=0&&result.zodiac<12?ZODIAC_CRESTS[result.zodiac]:null;
 return {crestId:sign?.id||'wheel',name:sign?sign.name+'座':'此世星印',latin:sign?.latin||'A SOUL THROUGH MANY LIVES',identity:result.identity[0],hasSign:!!sign};
}

// Keep legacy card typography unchanged. Taiwan's longer localized identities
// have a separate location/gender line and a fitted occupation/origin line.
export function cardIdentityLines(result,layout=cardLayout()){
 const identity=cardIdentity(result).identity;
 if(result?.version!==8||result.country!=='TW')return [{text:identity,y:layout.identityY,size:58}];
 const parts=String(identity).split(/\s*[·・]\s*/).filter(Boolean),gender=parts.find(part=>part==='女性'||part==='男性'),city=parts.find(part=>/[臺台]北|新北/.test(part)),details=parts.filter(part=>part!==gender&&part!==city&&part!=='臺灣'&&part!=='台灣');
 const location=['臺灣',city,gender].filter(Boolean).join(' · '),title=details.join(' · ')||'這一世的旅人';
 const fit=(text,max)=>Math.min(max,Math.max(12,Math.floor(880/Math.max(1,[...text].length))));
 return [{text:location,y:layout.identityY-31,size:fit(location,26)},{text:title,y:layout.identityY+17,size:fit(title,43)}];
}

export const TAIWAN_CARD_WEBP='/art/fate-taiwan-v8/river-memory.webp';
export const TAIWAN_CARD_JPEG='/art/fate-taiwan-v8/river-memory.jpg';
