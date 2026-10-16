import {publicNickname} from './social-cast.js';

// A private participant row never belongs in a life draft or public share code.
// Rebuild this deliberately small narrative record instead of spreading input.
export function sharedMemories(raw){
 if(!Array.isArray(raw))return [];
 return raw.slice(0,1).flatMap(m=>{
  if(!m||!/^shared-(garden|harbor|lamp|workshop|map|book)$/.test(m.id)||!Number.isSafeInteger(m.at)||m.at<1||![0,1,null].includes(m.answer)||!['manual','auto','decline','withdraw','unavailable'].includes(m.source)||typeof m.text!=='string'||m.text.length>600)return [];
  const ownerName=publicNickname(m.ownerName),guestName=publicNickname(m.guestName);if(!ownerName||!guestName)return [];
  return [{id:m.id,at:m.at,ownerName,guestName,answer:m.answer,source:m.source,text:m.text}];
 });
}
