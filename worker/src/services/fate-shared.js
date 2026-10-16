import {getCountryPack,ensureCountryPack,COUNTRY_METADATA_V9} from '../../public/fate/country-runtime-v9.js';
import {countryProfile} from '../../public/fate/country-engine-v9.js';
import {hash as storyHash} from '../../public/fate/world.js';
import {GameError} from '../game/classes.js';
import {guardStmt,outboxStmt,classifyDbError} from '../db.js';
import {addActive,activeBetween,isOpenTime,taipeiDay,LIFE_MS} from '../../public/fate/life.js';
import {publicNickname} from '../../public/fate/social-cast.js';

const MINUTE=60000,DAY=86400000;
const STORIES={
 garden:{title:'屋頂花園的約定',text:(o,g)=>`${o}與${g}一起修好了屋頂花園。風暴將至，這一頁正等候旅人的回應。`,choices:['留下，一起照看屋頂花園','出發，把沿途的種子寄回來'],
  endings:[(o,g)=>`${g}選擇留下。你們把屋頂花園分成幾個輪值，讓風暴後的每一株嫩芽都有人照看。`,(o,g)=>`${g}帶著祝福出發。此後寄來的種子，讓你們的屋頂花園開出了遠方的顏色。`],auto:(o,g)=>`風暴過後，${o}與${g}各自留下一袋種子。沒有說出口的約定，也在屋頂花園慢慢發芽。`},
 harbor:{title:'下一班潮汐',text:(o,g)=>`${o}替${g}留了一張渡船票。潮水正漲，是同行越過海灣，還是先在港口相聚？`,choices:['搭船同行，記下彼岸的風景','留在港口，準備迎接歸來的晚餐'],
  endings:[(o,g)=>`${g}趕上了那班渡船。你們在甲板上把沿岸燈塔一座座數過，陌生的彼岸從此也有共同的記憶。`,(o,g)=>`${g}留在港口備好晚餐。${o}歸來時，風乾的外套旁已有一碗熱湯，遠行終於有了回家的方向。`],auto:(o,g)=>`潮水退去，${o}與${g}把兩張船票夾進航海簿。下一次晴天，仍有值得一起抵達的地方。`},
 lamp:{title:'星燈修好之前',text:(o,g)=>`節日前夜，${o}與${g}發現舊街的星燈熄了。只剩一份燈油，${g}會把它留在哪裡？`,choices:['點亮街口，為晚歸的人指路','帶往河岸，陪等待的人看星星'],
  endings:[(o,g)=>`${g}把燈油留在街口。${o}替燈罩擋住了風，晚歸的旅人從此記得這條始終亮著的小巷。`,(o,g)=>`${g}提燈走向河岸。${o}跟著坐下，兩人沒有急著說話，倒影中的星光已把長夜照得溫柔。`],auto:(o,g)=>`天亮前，${o}與${g}輪流守著那盞小燈。節日沒有錯過任何人，這段守候也被悄悄記住。`},
 workshop:{title:'工坊最後一張草圖',text:(o,g)=>`${o}和${g}接下一件來不及完成的委託。桌上有兩張草圖，哪一張值得共同試一回？`,choices:['修復舊物，保留原本的使用痕跡','重做新樣，試試從未用過的巧思'],
  endings:[(o,g)=>`${g}挑了修復舊物的草圖。${o}把磨損的邊角補好，兩人留住的不只是物件，還有曾被珍惜的歲月。`,(o,g)=>`${g}選了新的設計。${o}陪著反覆試作，失敗的零件排滿窗邊，第一件成品卻也因此有了只屬於你們的模樣。`],auto:(o,g)=>`收工時，${o}與${g}把兩張草圖並排收好。有些答案可以慢一點，共同動手的下午已留下了痕跡。`},
 map:{title:'地圖上沒有名字的小徑',text:(o,g)=>`${o}把一份缺角的地圖交給${g}。前方的山徑分成兩條，是探路，還是先幫人立起路標？`,choices:['一起探路，補上地圖空白','沿途立路標，讓後來的人走得安心'],
  endings:[(o,g)=>`${g}選擇走進未命名的小徑。${o}記下泉水與山脊，你們在地圖邊角畫上一朵雲，作為共同發現的記號。`,(o,g)=>`${g}停下來立起路標。${o}把字刻得清楚，後來的旅人或許不認識你們，卻都曾被這份細心照顧。`],auto:(o,g)=>`${o}與${g}在分岔口留下一張清楚的便箋。山路仍向前延伸，這份互相照應也成了地圖的一部分。`},
 book:{title:'寄給未來的一頁',text:(o,g)=>`${o}與${g}在舊書中找到一張空白信紙。若留下一頁給多年後重讀，${g}會寫下什麼？`,choices:['寫下今天的小事，珍藏此刻的生活','寫下尚未完成的願望，等未來接續'],
  endings:[(o,g)=>`${g}寫下今天的麵包香與窗外的雨。${o}補上一行謝意，平凡的一天因此成了多年後仍能翻開的溫暖。`,(o,g)=>`${g}寫下還想去的遠方。${o}在旁畫了一顆星，多年後讀起，你們才發現那張信紙早已悄悄指引旅程。`],auto:(o,g)=>`${o}與${g}各在信紙上留下一行字，再把書輕輕合起。未來的某天，這一頁會替你們記得相遇。`}
};
// Never edit the legacy dictionary: an already-scheduled invitation must keep
// its original choices and outcome. New Taiwan lives use their own story keys.
const TW_STORIES={
 tw8_moving:{title:'公寓樓梯的搬家日',text:(o,g)=>`週末午後，${o}與${g}在雙北一棟公寓門口，遇到正為搬家紙箱發愁的鄰居。樓梯不寬，${g}想怎麼分工？`,choices:['先整理樓梯動線，再一起搬輕的紙箱','留在樓下清點標籤，幫忙把箱子送對樓層'],
  endings:[(o,g)=>`${g}先把樓梯轉角空出來，${o}陪著把輕的紙箱一趟趟送上樓。鄰居記住了你們的名字，隔天在樓梯口留下一袋分裝好的餅乾。`,(o,g)=>`${g}在樓下核對箱子的樓層標籤，${o}幫忙招呼來往的人。原本差點送錯的相簿回到主人手裡，你們還收到一張手寫的謝卡。`],auto:(o,g)=>`搬家車離開前，${o}與${g}幫忙把散落的包裝紙收進回收袋。公寓門口恢復了通行，這個忙碌的下午留下一聲鄰居的謝謝。`},
 tw8_parcel:{title:'超商櫃臺的小插曲',text:(o,g)=>`傍晚的超商裡，${o}與${g}發現待取包裹的標籤可能對不上，紙箱都還沒有拆開。店員正在確認，${g}會先怎麼做？`,choices:['把疑問告訴店員，留在櫃臺核對取件資料','先把未拆的包裹交回店員，改天確認後再來'],
  endings:[(o,g)=>`${g}請店員重新核對取件資料，${o}一起等候。包裹交回正確的取件人時，對方連說了兩次謝謝，你們才笑著走出超商。`,(o,g)=>`${g}把未拆的包裹交回店員，${o}記下再確認的時間。隔天再見面時，店員已把標籤釐清，你們為這段小插曲各挑了一瓶茶。`],auto:(o,g)=>`${o}與${g}把未拆的包裹留在櫃臺，請店員確認後再通知。等候的片刻，變成你們往後經過超商時會想起的一次相逢。`},
 tw8_repair:{title:'樓梯間的那盞燈',text:(o,g)=>`${o}與${g}在社區樓梯間看見忽明忽暗的照明。有人晚歸會經過這裡，${g}想先把這件事交給誰接手？`,choices:['向管理窗口報修，整理故障的樓層與時間','向社區窗口反映，請合格人員安排檢修'],
  endings:[(o,g)=>`${g}整理好故障的樓層與時間，${o}把報修資訊交給管理窗口。燈修好的那天，你們特地繞回樓梯間，發現轉角終於不必摸黑。`,(o,g)=>`${g}請社區窗口安排合格人員檢修，${o}陪著確認公告。之後樓梯口多了一張維修完成的通知，你們約好往後遇到問題也先找對窗口。`],auto:(o,g)=>`${o}與${g}把故障位置寫清楚，交給社區窗口處理。轉角重新亮起時，你們知道那封反映沒有白送。`},
 tw8_market:{title:'週末市集的一張空桌',text:(o,g)=>`河濱的週末公益市集臨時多出一張空桌，${o}與${g}被問到願不願意幫忙。募款規則已寫在現場公告上，${g}想怎麼讓這張桌子熱鬧起來？`,choices:['整理大家捐出的二手書，讓每一本找到新讀者','做一張清楚的攤位小地圖，幫逛市集的人找路'],
  endings:[(o,g)=>`${g}按主題排好捐出的二手書，${o}幫忙貼上現場公告的價格。有人找到找了很久的那一本，離開前還回頭向你們揮手。`,(o,g)=>`${g}畫好公益市集的小地圖，${o}把飲水處與出入口標得清楚。傍晚收桌時，那張被指過無數次的紙，成了你們一起留下的紀念。`],auto:(o,g)=>`${o}與${g}先把公益市集的空桌擦乾淨，再協助收好公告與指示牌。傍晚的河風把紙角吹起，你們替逛市集的人留了最後一段方便。`},
 tw8_umbrella:{title:'捷運出口的一場雨',text:(o,g)=>`午後雷陣雨突然落下，${o}與${g}停在雙北的捷運出口，手邊只有一把傘。下一段路不急，${g}想怎麼安排？`,choices:['在出口內等雨小一點，把沒聊完的話慢慢說完','沿有遮雨的路線走到公車站，把傘留給沒遮蔽的路段'],
  endings:[(o,g)=>`${g}決定先等雨小，${o}陪著站在不擋通行的位置。你們從晚餐聊到常走的路，等到雨停才發現，原來平常錯過了這麼多小事。`,(o,g)=>`${g}找好有遮雨的路線，${o}一路留意來往行人。到了公車站，你們抖掉傘上的水，替這次沒有淋透的同行留下了一句玩笑。`],auto:(o,g)=>`${o}與${g}先在捷運出口等雨，讓趕路的人從旁邊通過。雨勢小下來時，你們各自道別，也記住了這場被迫慢下來的午後。`},
 tw8_bookstore:{title:'書店留言板的空白角落',text:(o,g)=>`${o}與${g}走進巷內書店，店主邀請客人在公開留言板留一句話。角落還有一張空白紙卡，${g}想寫什麼？`,choices:['寫下今天遇見的一件好事，留給下一位讀者','推薦一本喜歡的書，邀請陌生人接著寫感想'],
  endings:[(o,g)=>`${g}在紙卡上寫下今天遇見的一件好事，${o}補了一句謝謝。下次經過書店，你們發現旁邊多了好幾張回應，原來小小的善意也有人願意接話。`,(o,g)=>`${g}留下一本書的推薦，${o}寫下最想和人聊的那一頁。再來書店時，有讀者接著寫了不同的看法，你們多了一個願意回來看的角落。`],auto:(o,g)=>`${o}與${g}各留下一句適合公開分享的話，再把紙卡交給店主。紙卡旁的小燈亮起，這次走進巷內書店的記憶也留在了板上。`}
};
const TW_KEYS={garden:'tw8_moving',harbor:'tw8_parcel',lamp:'tw8_repair',workshop:'tw8_market',map:'tw8_umbrella',book:'tw8_bookstore'};
function taiwanEdition(raw){try{const life=JSON.parse(raw);return life?.version===8&&life.country==='TW';}catch{return false;}}
// DB storage retains the six original CHECK-constrained enum values. The
// server-owned parent life's immutable edition chooses the authored dictionary.
const authoredKey=row=>countryEdition(row.story_life_state)?'v9_'+countryEdition(row.story_life_state).toLowerCase()+'_'+LOCAL_KEYS[row.story_key]:taiwanEdition(row.story_life_state)?TW_KEYS[row.story_key]:row.story_key;
const LOCAL_KEYS={garden:'moving',harbor:'parcel',lamp:'repair',workshop:'market',map:'umbrella',book:'bookstore'};
function countryEdition(raw){try{const d=JSON.parse(raw);return d.version===9&&Object.hasOwn(COUNTRY_METADATA_V9,d.country)?d.country:null;}catch{return null;}}
function countryStory(row){const country=countryEdition(row.story_life_state);if(!country)return null;const authored=getCountryPack(country).shared.find(s=>s.id===LOCAL_KEYS[row.story_key]);if(!authored)throw Error('Missing local shared story');const fill=(text,o,g)=>text.replaceAll('{owner}',o).replaceAll('{guest}',g);return {title:authored.title,text:(o,g)=>fill(authored.text,o,g),choices:authored.choices.map(c=>c.label),endings:authored.choices.map(c=>(o,g)=>fill(c.outcome,o,g)),auto:(o,g)=>`${o}與${g}沒有在這次相逢期限內回應，先各自保留原來的安排；尚未做出的選擇不會被寫成已完成的承諾。`};}
const storyFor=row=>countryStory(row)||TW_STORIES[authoredKey(row)]||STORIES[row.story_key]||STORIES.garden;
const outcomeText=row=>{const story=storyFor(row);return (row.answer===0||row.answer===1?story.endings[row.answer]:story.auto)(row.owner_name,row.guest_name);};
const pending=r=>r&&['scheduled','pending'].includes(r.status);
const parse=s=>JSON.parse(s);
const fail=(code,message,status=409)=>{throw new GameError(code,message,status)};
async function actor(db,tg){
 const c=await db.prepare('SELECT c.tg_id,c.name,COALESCE(c.account_tg_id,c.tg_id) account,a.active_char_id FROM rpg_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=COALESCE(c.account_tg_id,c.tg_id) WHERE c.tg_id=?').bind(String(tg)).first();
 if(!c)fail('no_character','先建立角色，再開啟旅章',404);
 if(c.active_char_id&&String(c.active_char_id)!==String(tg))fail('character_changed','角色已切換，請重新開啟旅章');
 return {...c,account:String(c.account)};
}
const pref=(db,account)=>db.prepare('SELECT * FROM rpg_fate_social_preferences WHERE account_id=?').bind(account).first();
const allowed=(p,now)=>!!(p?.enabled&&p.allow_mentions&&p.quiet_until<=now);
// Creating this private row is the owner's explicit per-life consent. Receiving
// other players' invitations remains a separate, default-off account setting.
const ownerAllowed=(p,now)=>(p?.quiet_until||0)<=now;
const prefView=(p,now)=>({enabled:!!p?.enabled,allowMentions:!!p?.allow_mentions,quietToday:(p?.quiet_until||0)>now,quietUntil:p?.quiet_until||0,rev:p?.rev||0});
async function warmRow(row){const country=countryEdition(row?.story_life_state);if(country)await ensureCountryPack(country);return row;}
const rowFor=async(db,id)=>warmRow(await db.prepare('SELECT s.*,l.state_json story_life_state FROM rpg_fate_social_choices s LEFT JOIN rpg_fate_lives l ON l.id=s.life_id WHERE s.id=?').bind(String(id||'')).first());
// Recheck DB authority inside the same transaction as invitation/answer writes.
// Membership is external; bound-character ownership and consent are local and
// must not race a deletion/reassignment after the last async eligibility read.
const authorityGuard=(db,row,now)=>db.prepare(`INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT (
 EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=? AND COALESCE(account_tg_id,tg_id)=?)
 AND EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=? AND COALESCE(account_tg_id,tg_id)=?)
 AND EXISTS(SELECT 1 FROM rpg_fate_social_preferences WHERE account_id=? AND enabled=1 AND allow_mentions=1 AND quiet_until<=?)
 AND COALESCE((SELECT quiet_until FROM rpg_fate_social_preferences WHERE account_id=?),0)<=?
 AND EXISTS(SELECT 1 FROM rpg_fate_lives WHERE id=? AND char_id=? AND account_id=? AND status='active')
 AND NOT EXISTS(SELECT 1 FROM rpg_fate_lives ol JOIN rpg_fate_lives gl ON gl.char_id=? AND gl.status='active' WHERE ol.id=?
  AND (json_extract(ol.state_json,'$.version')=9 OR json_extract(gl.state_json,'$.version')=9)
  AND (json_extract(ol.state_json,'$.version')<>9 OR json_extract(gl.state_json,'$.version')<>9 OR json_extract(ol.state_json,'$.country')<>json_extract(gl.state_json,'$.country')))
 AND NOT EXISTS(SELECT 1 FROM rpg_fate_lives gl WHERE gl.char_id=? AND gl.status='active' AND
  (COALESCE(json_type(gl.state_json,'$.startedAt'),'')<>'integer' OR json_extract(gl.state_json,'$.startedAt')+7200000+
   CASE WHEN (json_extract(gl.state_json,'$.startedAt')+28800000)%86400000>79200000 THEN 21600000 ELSE 0 END<?))
 )`).bind(row.owner_char,row.owner_account,row.guest_char,row.guest_account,row.guest_account,now,row.owner_account,now,row.life_id,row.owner_char,row.owner_account,row.guest_char,row.life_id,row.guest_char,row.deadline_at);
function coversDeadline(raw,deadline){try{const d=JSON.parse(raw);return Number.isSafeInteger(d.startedAt)&&addActive(d.startedAt,LIFE_MS)>=deadline;}catch{return false;}}
async function memberSet(env,accounts){
 try{
  const value=typeof env.FATE_SOCIAL_MEMBERSHIP==='function'?await env.FATE_SOCIAL_MEMBERSHIP(accounts):await (async()=>{
   if(!env.SERVICE_SECRET)return null;
   const res=await fetch('https://star-journal-rpg-bot.micisachen.workers.dev/internal/fate-membership',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+env.SERVICE_SECRET},body:JSON.stringify({accountIds:accounts}),signal:AbortSignal.timeout(6000)});
   return res.ok?res.json():null;
  })();
  return new Set(value?.ok===true?accounts.filter(account=>value.members?.some(m=>String(m.accountId)===account&&m.member===true)):[]);
 }catch{return new Set()}
}
async function memberships(env,accounts){const valid=await memberSet(env,accounts);return accounts.every(account=>valid.has(account));}
async function localEligible(env,row,now){
 const [a,b,oc,gc,life,guestLife]=await Promise.all([
  pref(env.DB,row.owner_account),pref(env.DB,row.guest_account),
  env.DB.prepare('SELECT c.tg_id,COALESCE(c.account_tg_id,c.tg_id) account,a.active_char_id FROM rpg_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=COALESCE(c.account_tg_id,c.tg_id) WHERE c.tg_id=?').bind(row.owner_char).first(),
  env.DB.prepare('SELECT c.tg_id,COALESCE(c.account_tg_id,c.tg_id) account,a.active_char_id FROM rpg_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=COALESCE(c.account_tg_id,c.tg_id) WHERE c.tg_id=?').bind(row.guest_char).first(),
  env.DB.prepare('SELECT status,state_json FROM rpg_fate_lives WHERE id=?').bind(row.life_id).first(),
  env.DB.prepare("SELECT state_json FROM rpg_fate_lives WHERE char_id=? AND status='active'").bind(row.guest_char).first()
 ]);
 const origin=countryEdition(life?.state_json),guestCountry=countryEdition(guestLife?.state_json);if(guestLife&&(origin||guestCountry)&&origin!==guestCountry)return false;
 if(guestLife&&!coversDeadline(guestLife.state_json,row.deadline_at))return false;
 return ownerAllowed(a,now)&&allowed(b,now)&&oc&&gc&&String(oc.account)===row.owner_account&&String(gc.account)===row.guest_account&&life?.status==='active';
}
// An account can revoke consent or lose its bound character while Telegram is checked.
// Re-read authority after that network boundary; the final event write is CAS.
async function eligible(env,row,now){return await localEligible(env,row,now)&&await memberships(env,[row.owner_account,row.guest_account])&&await localEligible(env,row,now);}
function view(row,c,now){
 const side=c.account===row.owner_account?'owner':'guest',bound=String(c.tg_id)===(side==='owner'?row.owner_char:row.guest_char),story=storyFor(row);
 return {id:row.id,side,characterMatches:bound,ownerName:row.owner_name,guestName:row.guest_name,title:story.title,
  text:story.text(row.owner_name,row.guest_name),choices:[...story.choices],status:row.status,
  opensAt:row.opened_at,deadline:row.deadline_at,remainingMs:activeBetween(now,row.deadline_at),night:!isOpenTime(now),
  canReply:bound&&side==='guest'&&row.status==='pending'&&now>=row.opened_at&&now<row.deadline_at&&isOpenTime(now),
  canWithdraw:bound&&side==='owner'&&pending(row),answer:row.answer,source:row.source,
  outcome:now>=row.deadline_at&&!pending(row)?outcomeText(row):null};
}
const terminalStatements=(db,row,status,answer,source,now)=>[
 db.prepare("UPDATE rpg_fate_social_choices SET status=?,answer=?,source=?,resolved_at=?,next_at=deadline_at,rev=rev+1 WHERE id=? AND rev=? AND status IN ('scheduled','pending')").bind(status,answer,source,now,row.id,row.rev),guardStmt(db),
 db.prepare('DELETE FROM rpg_fate_social_locks WHERE event_id=?').bind(row.id)
];
async function close(env,row,status,answer,source,now){
 if(!pending(row))return row;
 try{await env.DB.batch(terminalStatements(env.DB,row,status,answer,source,now));}catch(e){if(classifyDbError(e)?.code!=='conflict')throw e;}
 return rowFor(env.DB,row.id);
}
async function progress(env,row,now){
 await warmRow(row);
 if(!pending(row))return row;
 if(now>=row.deadline_at)return close(env,row,'auto',null,'auto',now);
 if(row.status==='scheduled'&&now>=row.opened_at){
  if(!isOpenTime(now))return row;
  if(!await eligible(env,row,now))return close(env,row,'auto',null,'unavailable',now);
  const db=env.DB,day=taipeiDay(now),stmts=[db.prepare("UPDATE rpg_fate_social_choices SET status='pending',next_at=deadline_at,rev=rev+1 WHERE id=? AND rev=? AND status='scheduled'").bind(row.id,row.rev),guardStmt(db),authorityGuard(db,row,now)];
  for(const account of [row.owner_account,row.guest_account])stmts.push(db.prepare('INSERT INTO rpg_fate_social_limits(account_id,day,mentions) VALUES(?,?,1) ON CONFLICT(account_id,day) DO UPDATE SET mentions=mentions+1 WHERE mentions<2').bind(account,day),guardStmt(db));
  if(env.GROUP_CHAT_ID)stmts.push(outboxStmt(db,{dedupe:`fate-social:${row.id}:invite`,target:'group',kind:'fate_social',payload:{eventId:row.id}},now));
  try{await db.batch(stmts);}catch(e){if(classifyDbError(e)?.code!=='conflict')throw e;const current=await rowFor(db,row.id);return current?.status==='scheduled'?close(env,current,'auto',null,'unavailable',now):current;}
  return rowFor(db,row.id);
 }
 return row;
}
export async function preferences(env,tg,now){const c=await actor(env.DB,tg);await env.DB.prepare('UPDATE rpg_fate_social_preferences SET active_at=? WHERE account_id=?').bind(now,c.account).run();return {ok:true,preferences:prefView(await pref(env.DB,c.account),now),now};}
const canonical=o=>o&&typeof o==='object'?(Array.isArray(o)?o.map(canonical):Object.fromEntries(Object.keys(o).sort().filter(k=>!['requestId','selectedCharacterId','tgId'].includes(k)).map(k=>[k,canonical(o[k])]))):o;
async function operation(env,tg,b,now,kind,fn){
 if(typeof b.requestId!=='string'||!/^[A-Za-z0-9:_-]{6,90}$/.test(b.requestId))fail('request','需要有效的操作編號',400);
 const c=await actor(env.DB,tg),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({kind,char:String(tg),body:canonical(b)}))))].map(x=>x.toString(16).padStart(2,'0')).join('');
 for(let attempt=0;attempt<4;attempt++){
  const old=await env.DB.prepare('SELECT payload_hash,result_json FROM rpg_fate_social_operations WHERE account_id=? AND request_id=?').bind(c.account,b.requestId).first();
  if(old){if(old.payload_hash!==hash)fail('request_changed','這個操作編號已用於其他選擇');return {ok:true,result:parse(old.result_json),replayed:true};}
  const {stmts,result}=await fn(c);
  try{await env.DB.batch([...stmts,env.DB.prepare('INSERT INTO rpg_fate_social_operations(account_id,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)').bind(c.account,b.requestId,hash,JSON.stringify(result),now)]);return {ok:true,result};}
  catch(e){if(attempt<3&&(classifyDbError(e)?.code==='conflict'||/UNIQUE constraint failed: rpg_fate_social_operations/.test(e.message)))continue;throw classifyDbError(e)||e;}
 }
 fail('conflict','旅章正在同步，請稍後重試');
}
export async function savePreferences(env,tg,b,now){
 if(typeof b.enabled!=='boolean'||typeof b.allowMentions!=='boolean')fail('preferences','請確認協作與群組提及設定',400);
 if((b.enabled||b.allowMentions)&&b.consent!==true)fail('consent','請先同意協作邀請與群組提及',400);
 return operation(env,tg,b,now,'preferences',async c=>{
  const db=env.DB,p=await pref(db,c.account),quiet=b.quietToday===true?Date.parse(taipeiDay(now)+'T00:00:00+08:00')+DAY:0;
  const stmts=[db.prepare('INSERT INTO rpg_fate_social_preferences(account_id,enabled,allow_mentions,quiet_until,active_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET enabled=excluded.enabled,allow_mentions=excluded.allow_mentions,quiet_until=excluded.quiet_until,active_at=excluded.active_at,updated_at=excluded.updated_at,rev=rev+1').bind(c.account,+b.enabled,+b.allowMentions,quiet,now,now)];
  if(!b.enabled||!b.allowMentions||quiet>now){
   const rows=(await db.prepare("SELECT * FROM rpg_fate_social_choices WHERE (guest_account=? OR (?=1 AND owner_account=?)) AND status IN ('scheduled','pending')").bind(c.account,quiet>now?1:0,c.account).all()).results||[];
   for(const row of rows)stmts.push(...terminalStatements(db,row,'auto',null,'unavailable',now));
  }
  return {stmts,result:{preferences:{enabled:b.enabled,allowMentions:b.allowMentions,quietToday:quiet>now,quietUntil:quiet,rev:p?p.rev+1:0}}};
 });
}
export async function schedule(env,{lifeId,charId,accountId,name,draft},now){
 const db=env.DB,account=String(accountId),already=await db.prepare('SELECT id FROM rpg_fate_social_choices WHERE life_id=?').bind(lifeId).first();if(already)return {scheduled:true};
 if(!env.GROUP_CHAT_ID||!ownerAllowed(await pref(db,account),now))return {scheduled:false};
 const c=await actor(db,charId);if(c.account!==account)return {scheduled:false};
 const life=await db.prepare("SELECT id,state_json FROM rpg_fate_lives WHERE id=? AND char_id=? AND account_id=? AND status='active'").bind(lifeId,String(charId),account).first();if(!life)return {scheduled:false};
 let stored;try{stored=JSON.parse(life.state_json);}catch{return {scheduled:false};}if(stored.version===8&&stored.country!=='TW')return {scheduled:false};if(stored.version===9){if(!Object.hasOwn(COUNTRY_METADATA_V9,stored.country))return {scheduled:false};await ensureCountryPack(stored.country);}
 const rows=(await db.prepare('SELECT p.account_id,c.tg_id,c.name FROM rpg_fate_social_preferences p JOIN rpg_accounts a ON a.account_tg_id=p.account_id JOIN rpg_characters c ON c.tg_id=a.active_char_id AND COALESCE(c.account_tg_id,c.tg_id)=p.account_id LEFT JOIN rpg_fate_social_locks l ON l.account_id=p.account_id WHERE p.account_id<>? AND p.enabled=1 AND p.allow_mentions=1 AND p.quiet_until<=? AND p.active_at>=? AND l.account_id IS NULL ORDER BY p.active_at DESC,p.account_id LIMIT 12').bind(account,now,now-DAY).all()).results||[];
 let offset=40*MINUTE;if(stored.version===9){const death=countryProfile(stored.seed,stored.orbit,stored.country).deathAge,min=Math.ceil(18/death*LIFE_MS);offset=min+storyHash('v9-shared-open:'+stored.country+':'+stored.seed)%(100*MINUTE-min);}
 const open=addActive(stored.startedAt,offset),deadline=Math.min(addActive(open,10*MINUTE),addActive(stored.startedAt,LIFE_MS)),day=taipeiDay(open);
 if(now>=deadline)return {scheduled:false};
 const recent=(await db.prepare('SELECT story_key FROM rpg_fate_social_choices WHERE owner_account=? ORDER BY opened_at DESC LIMIT 3').bind(account).all()).results||[];
 const catalog=[8,9].includes(stored.version)?TW_KEYS:STORIES,pool=Object.keys(catalog).filter(k=>!recent.some(r=>r.story_key===k)),storyKey=pool[parseInt(stored.seed,16)%pool.length];
 // One bounded lookup for the owner and three candidates, rather than serial
 // network waits per candidate. The Bot endpoint accepts at most four accounts.
 const nearby=await Promise.all(rows.map(async guest=>{const active=await db.prepare("SELECT state_json FROM rpg_fate_lives WHERE char_id=? AND status='active'").bind(String(guest.tg_id)).first(),guestCountry=countryEdition(active?.state_json),origin=stored.version===9?stored.country:null;return active&&(((origin||guestCountry)&&origin!==guestCountry)||!coversDeadline(active.state_json,deadline))?null:guest;}));const candidates=nearby.filter(Boolean).slice(0,3);if(!candidates.length)return {scheduled:false};
 const validMembers=await memberSet(env,[account,...candidates.map(g=>String(g.account_id))]);
 if(!validMembers.has(account))return {scheduled:false};
 for(const guest of candidates){
  const guestAccount=String(guest.account_id),pair=[account,guestAccount].sort().join(':'),id=crypto.randomUUID().replaceAll('-','');
  const [lock,pairUsed]=await Promise.all([db.prepare('SELECT account_id FROM rpg_fate_social_locks WHERE account_id=?').bind(account).first(),db.prepare('SELECT event_id FROM rpg_fate_social_pairs WHERE pair_key=? AND day=?').bind(pair,day).first()]);if(lock)return {scheduled:false};if(pairUsed)continue;
  if(!validMembers.has(guestAccount))continue;
  try{await db.batch([
   db.prepare("INSERT INTO rpg_fate_social_choices(id,life_id,owner_account,owner_char,owner_name,guest_account,guest_char,guest_name,story_key,pair_key,day,opened_at,deadline_at,next_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'scheduled')").bind(id,lifeId,account,String(charId),publicNickname(name)||'星燈旅人',guestAccount,String(guest.tg_id),publicNickname(guest.name)||'同行旅人',storyKey,pair,day,open,deadline,open),
   db.prepare('INSERT INTO rpg_fate_social_locks(account_id,event_id) VALUES(?,?),(?,?)').bind(account,id,guestAccount,id),
   db.prepare('INSERT INTO rpg_fate_social_pairs(pair_key,day,event_id) VALUES(?,?,?)').bind(pair,day,id),
   authorityGuard(db,{owner_char:String(charId),owner_account:account,guest_char:String(guest.tg_id),guest_account:guestAccount,life_id:lifeId,deadline_at:deadline},now)
  ]);return {scheduled:true};}catch(e){if(classifyDbError(e)?.code==='conflict'||/UNIQUE constraint failed: rpg_fate_social_/.test(e.message))continue;throw e;}
 }
 return {scheduled:false};
}
export async function sweep(env,now){const rows=(await env.DB.prepare("SELECT s.*,l.state_json story_life_state FROM rpg_fate_social_choices s LEFT JOIN rpg_fate_lives l ON l.id=s.life_id WHERE s.status IN ('scheduled','pending') AND s.next_at<=? ORDER BY s.next_at LIMIT 40").bind(now).all()).results||[];for(const row of rows)await progress(env,row,now);return rows.length;}
export async function inbox(env,tg,now){
 const c=await actor(env.DB,tg);await env.DB.prepare('UPDATE rpg_fate_social_preferences SET active_at=? WHERE account_id=?').bind(now,c.account).run();
 const rows=(await env.DB.prepare('SELECT s.*,l.state_json story_life_state FROM rpg_fate_social_choices s LEFT JOIN rpg_fate_lives l ON l.id=s.life_id WHERE (s.owner_account=? OR s.guest_account=?) ORDER BY s.opened_at DESC LIMIT 8').bind(c.account,c.account).all()).results||[];
 const events=[];for(const row of rows)events.push(view(await progress(env,row,now),c,now));return {ok:true,events,preferences:prefView(await pref(env.DB,c.account),now),now};
}
async function authorized(env,c,id){const row=await rowFor(env.DB,id);if(!row||![row.owner_account,row.guest_account].includes(c.account))fail('not_found','找不到這頁共同旅章',404);return row;}
export async function event(env,tg,b,now){const c=await actor(env.DB,tg),row=await progress(env,await authorized(env,c,b.eventId),now);return {ok:true,event:view(row,c,now),now};}
async function answerOperation(env,tg,b,now,kind){
 return operation(env,tg,b,now,kind,async c=>{
  let row=await progress(env,await authorized(env,c,b.eventId),now);const side=c.account===row.owner_account?'owner':'guest';
  if(String(c.tg_id)!==(side==='owner'?row.owner_char:row.guest_char))fail('character_changed','請切換回參與這頁旅章的角色');
  if(kind==='withdraw'&&side!=='owner'||kind!=='withdraw'&&side!=='guest')fail('designated_player','這個選擇需要由指定旅人回應',403);
  if(!pending(row))return {stmts:[],result:{event:view(row,c,now),settled:true}};
  if(!isOpenTime(now))fail('fate_night','旅章已入夜，06:00 再回應');
  if(kind!=='withdraw'&&(row.status!=='pending'||now<row.opened_at))fail('not_open','這一頁還未展開');
  if(kind==='reply'&&![0,1].includes(b.answer))fail('answer','請選擇一個回應',400);
  if(!await eligible(env,row,now)){row=await close(env,row,'auto',null,'unavailable',now);return {stmts:[],result:{event:view(row,c,now),settled:true}};}
  const status=kind==='reply'?'answered':kind==='decline'?'declined':'withdrawn',answer=kind==='reply'?b.answer:null,source=kind==='reply'?'manual':kind;
  return {stmts:[...terminalStatements(env.DB,row,status,answer,source,now),authorityGuard(env.DB,row,now)],result:{event:view({...row,status,answer,source},c,now)}};
 });
}
export const reply=(env,tg,b,now)=>answerOperation(env,tg,b,now,'reply');
export const decline=(env,tg,b,now)=>answerOperation(env,tg,b,now,'decline');
export const withdraw=(env,tg,b,now)=>answerOperation(env,tg,b,now,'withdraw');
export async function notification(env,b,now){
 const invalid={ok:true,valid:false,night:false,pending:false,remainingMs:0},row=await rowFor(env.DB,b.eventId);if(!row)return invalid;
 const r=await progress(env,row,now);if(r.status!=='pending'||now<r.opened_at||now>=r.deadline_at)return invalid;
 if(!isOpenTime(now))return {...invalid,night:true,pending:true,retryAt:addActive(now,0)};
 if(!await eligible(env,r,now)){await close(env,r,'auto',null,'unavailable',now);return invalid;}
 const latest=await rowFor(env.DB,r.id);if(latest?.status!=='pending'||latest.rev!==r.rev)return invalid;
 const story=storyFor(r);
 return {ok:true,valid:true,night:false,pending:true,remainingMs:activeBetween(now,r.deadline_at),payload:{...(countryEdition(r.story_life_state)?{country:countryEdition(r.story_life_state)}:taiwanEdition(r.story_life_state)?{country:'TW'}:{}),eventId:r.id,ownerAccountId:r.owner_account,guestAccountId:r.guest_account,ownerName:r.owner_name,guestName:r.guest_name,title:story.title,text:story.text(r.owner_name,r.guest_name),choices:[...story.choices],deadline:r.deadline_at}};
}
export async function outcomes(env,lifeId,now){
 const life=await env.DB.prepare('SELECT char_id,account_id,started_at,state_json FROM rpg_fate_lives WHERE id=?').bind(String(lifeId)).first();if(!life)return [];
 const end=addActive(life.started_at,LIFE_MS),rows=(await env.DB.prepare(`SELECT s.*,l.state_json story_life_state FROM rpg_fate_social_choices s LEFT JOIN rpg_fate_lives l ON l.id=s.life_id WHERE s.deadline_at<=? AND
  (s.life_id=? OR (s.guest_account=? AND s.guest_char=? AND s.status='answered' AND s.opened_at>=? AND s.deadline_at<=?))
  ORDER BY s.deadline_at,s.id LIMIT 8`).bind(now,String(lifeId),life.account_id,life.char_id,life.started_at,end).all()).results||[];
 const memories=[];for(const row of rows){const local=countryEdition(row.story_life_state),current=countryEdition(life.state_json);if(row.life_id!==String(lifeId)&&(local||current)&&local!==current)continue;const r=await progress(env,row,now);memories.push({id:'shared-'+authoredKey(r),at:r.deadline_at,ownerName:r.owner_name,guestName:r.guest_name,answer:r.answer,source:r.source,text:outcomeText(r)});}return memories;
}
