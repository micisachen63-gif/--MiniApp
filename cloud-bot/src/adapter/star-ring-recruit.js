// One group recruitment post per expedition; later revisions edit that same post.
// No Telegram callback can join a room: the authenticated Mini App owns admission.
export function createStarRingRecruitFlow({api,send,st,save,chatId,botUsername,appUrl,now,rejectedImage}){
 const clean=(v,n=60)=>String(v??'').replace(/[\r\n\t]+/g,' ').slice(0,n);
 async function deliver(item){
  if(item.kind!=='star_ring_recruit')return false;
  if(item.target!=='group')return true;
  const p=item.payload?.party,id=String(item.payload?.partyId||'');
  if(!/^ring:[0-9a-f]{32}$/.test(id)||p?.id!==id)return true;
  const cards=st().starRingRecruitCards??={},old=cards[id];
  if(!old&&(p.status!=='lobby'||!(p.expiresAt>now())))return true;
  if(old?.pending)throw Error('星環招募通知送達待核對：'+id);
  if(old&&old.rev>=p.rev)return true;
  const username=String(botUsername()||'').replace(/^@/,'');
  if(!/^[A-Za-z0-9_]+$/.test(username))throw Error('星環招募缺少遊戲入口設定');
  const members=(p.members||[]).filter(m=>!m.left).slice(0,5),leader=members.find(m=>m.id===p.leaderId);
  const lobby=p.status==='lobby'&&p.expiresAt>now(),running=p.status==='running';
  const caption=[`✦ 星環遠征 · ${lobby?'旅人招募':running?'隊伍已啟程':'遠征已結束'}`,'',clean(p.name),
   `Lv.${Number(p.tier)||40} 起 · ${p.difficulty==='advanced'?'深入遠征':'標準遠征'} · 十二小時`,
   `隊長：${clean(leader?.name||'旅人',40)}`,
   `同行 ${members.length}／5${lobby?' · 尚缺 '+Math.max(0,5-members.length)+' 人':''}`,
   ...members.map(m=>`${m.ready?'✓':'◇'} ${clean(m.name,40)} · Lv.${Number(m.level)||0}`),'',
   lobby?'每小時換景、離線持續前進。進入隊伍後加入並準備，五個不同帳號齊聚即可出發。':running?'旅人已踏上星環邊境，點下方查看即時戰況。':'本次招募已關閉，可在遊戲內查看遠征紀錄。'].join('\n').slice(0,1000);
  const reply_markup={inline_keyboard:[[{text:lobby?'查看／加入隊伍':running?'查看遠征戰況':'查看遠征紀錄',url:`https://t.me/${username}?startapp=ring_${id.slice(5)}`}]]};
  if(old){
   try{await api.call(old.photo?'editMessageCaption':'editMessageText',{chat_id:old.chatId,message_id:old.messageId,...(old.photo?{caption}:{text:caption}),reply_markup});}
   catch(e){if(!/not modified/i.test(String(e.description||e.message)))throw e;}
   cards[id]={...old,rev:p.rev,at:now()};save();return true;
  }
  // Persist intent before sending: an uncertain Telegram response must not create a second post.
  cards[id]={pending:true,at:now()};save();
  try{
   let m,photo=false;
   if(appUrl){try{m=await api.call('sendPhoto',{chat_id:chatId,photo:new URL('/art/star-ring-20261018/background.jpg',appUrl).href,caption,reply_markup},{retries429:0,timeoutMs:15000});photo=!!m;}catch(e){if(!rejectedImage(e))throw e;}}
   if(!m)m=await send(caption,{reply_markup},chatId);
   const messageId=m?.message_id??m?.result?.message_id;if(!messageId)throw Error('Telegram 未確認星環招募通知');
   cards[id]={chatId,messageId,photo,rev:p.rev,at:now()};save();
  }catch(e){if(e?.definite===true){delete cards[id];save();}throw e;}
  return true;
 }
 return {deliver};
}
