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
