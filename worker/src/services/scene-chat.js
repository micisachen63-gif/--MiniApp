import { GameError } from '../game/classes.js';

export const CHAT_MAX_LENGTH = 200;
export const CHAT_INTERVAL_MS = 3000;
export const CHAT_RETENTION_MS = 7 * 86400000;
const PAGE_SIZE = 50;
const realmId = env => env.REALM_CONTEXT?.id || 'permanent';
const time = now => { if (!Number.isSafeInteger(now) || now < 0) throw new GameError('chat_input','聊天時間無效'); };
function enabled(env) { if (String(env.ATLAS_ENABLED) !== 'true') throw new GameError('chat_unavailable','新版聊天尚未開放',503); }
function text(value) {
  if (typeof value !== 'string') throw new GameError('chat_input','請輸入訊息');
  const body=value.normalize('NFC').replace(/\r\n?/g,'\n').trim();
  if (!body || [...body].length > CHAT_MAX_LENGTH || body.split('\n').length > 3 || /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(body)) throw new GameError('chat_input','訊息限200字、最多3行，請移除無效字元');
  return body;
}
async function actor(db,charId) {
  const c=await db.prepare('SELECT c.tg_id,c.account_tg_id,a.active_char_id FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(charId).first();
  if (!c) throw new GameError('no_character','請先選擇角色',404);
  const account=String(c.account_tg_id||c.tg_id);
  if (c.active_char_id && String(c.active_char_id)!==String(charId)) throw new GameError('character_changed','角色已切換，請重新選擇角色',409);
  return {charId:String(c.tg_id),account};
}
const shortMembership=`EXISTS(SELECT 1 FROM rpg_party_presence pp JOIN rpg_parties p ON p.id=pp.party_id JOIN rpg_party_members m ON m.party_id=p.id AND m.char_id=pp.char_id WHERE pp.account_id=c.account_tg_id AND pp.char_id=c.tg_id AND m.account_id=c.account_tg_id AND p.status IN ('lobby','combat') AND 'party:'||p.id=?)`;
const ringMembership=`EXISTS(SELECT 1 FROM rpg_star_ring_members m JOIN rpg_star_ring_runs r ON r.id=m.run_id WHERE m.char_id=c.tg_id AND m.account_id=c.account_tg_id AND m.left_at IS NULL AND r.status IN ('lobby','running') AND 'ring:'||r.id=?)`;
async function channelsFor(db,a) {
  const rows=await db.prepare(`SELECT 'party:'||p.id AS id,CASE WHEN p.kind='tower' THEN '爬塔隊伍' ELSE '打寶隊伍' END AS name FROM rpg_party_presence pp JOIN rpg_parties p ON p.id=pp.party_id JOIN rpg_party_members m ON m.party_id=p.id AND m.char_id=pp.char_id WHERE pp.account_id=? AND pp.char_id=? AND m.account_id=? AND p.status IN ('lobby','combat')
    UNION ALL SELECT 'ring:'||r.id AS id,'遠征隊伍' AS name FROM rpg_star_ring_members m JOIN rpg_star_ring_runs r ON r.id=m.run_id WHERE m.char_id=? AND m.account_id=? AND m.left_at IS NULL AND r.status IN ('lobby','running') ORDER BY id`).bind(a.account,a.charId,a.account,a.charId,a.account).all();
  return [{id:'world',channel:'world',name:'世界',enabled:true},
    {id:'guild',channel:'guild',name:'公會',enabled:false,reason:'公會系統尚未開放'},
    ...(rows.results.length?rows.results.map(r=>({...r,channel:'party',enabled:true})):[{id:'party',channel:'party',name:'隊伍',enabled:false,reason:'加入招募中或進行中的隊伍後即可聊天'}])];
}
const publicMessage=(m,a)=>({seq:m.seq,channel:m.channel,roomId:m.room_id,name:m.sender_name,level:m.sender_level,baseClass:m.base_class,text:m.body,createdAt:m.created_at,own:m.account_id===a.account});
const cursor=value=>{if(value===undefined||value===null)return null;if(!Number.isSafeInteger(value)||value<0)throw new GameError('chat_input','聊天游標無效');return value;};
export async function view(env,charId,body={},now) {
  enabled(env);time(now);
  const a=await actor(env.DB,charId),channels=await channelsFor(env.DB,a),channel=body.channel||'all';
  if(!['all','world','guild','party'].includes(channel))throw new GameError('chat_input','聊天頻道無效');
  const allowed=channels.filter(c=>c.enabled&&(channel==='all'||c.channel===channel));
  if(body.roomId!==undefined && !allowed.some(c=>c.id===body.roomId))throw new GameError('chat_room','你目前無法查看這個聊天頻道',403);
  const rooms=body.roomId?[body.roomId]:allowed.map(c=>c.id),after=cursor(body.afterSeq),before=cursor(body.beforeSeq);
  if(after!==null&&before!==null)throw new GameError('chat_input','請選擇一個聊天游標');
  let rows=[];
  if(rooms.length){
    const values=[...rooms,now-CHAT_RETENTION_MS];
    let where=`message.room_id IN (${rooms.map(()=>'?').join(',')}) AND message.created_at>=?`;
    if(after!==null){where+=' AND message.seq>?';values.push(after);}
    if(before!==null){where+=' AND message.seq<?';values.push(before);}
    const shortRead=shortMembership.replace("'party:'||p.id=?","'party:'||p.id=message.room_id"),ringRead=ringMembership.replace("'ring:'||r.id=?","'ring:'||r.id=message.room_id");
    const result=await env.DB.prepare(`SELECT message.* FROM rpg_scene_chat_messages message JOIN rpg_live_characters c ON c.tg_id=? LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id
      WHERE COALESCE(c.account_tg_id,c.tg_id)=? AND (a.active_char_id IS NULL OR a.active_char_id=c.tg_id) AND ${where}
      AND (message.channel='world' OR ${shortRead} OR ${ringRead}) ORDER BY message.seq ${after!==null?'ASC':'DESC'} LIMIT ${PAGE_SIZE+1}`).bind(a.charId,a.account,...values).all();rows=result.results;
  }
  const hasMore=rows.length>PAGE_SIZE;rows=rows.slice(0,PAGE_SIZE);if(after===null)rows.reverse();
  return {ok:true,realmId:realmId(env),characterId:a.charId,channels,messages:rows.map(m=>publicMessage(m,a)),hasMore,
    firstSeq:rows[0]?.seq??null,lastSeq:rows.at(-1)?.seq??after??null,maxLength:CHAT_MAX_LENGTH,pollSeconds:5,now};
}
export async function send(env,charId,body,now) {
  time(now);
  const db=env.DB,a=await actor(db,charId),content=text(body?.text),channel=body?.channel,room=body?.roomId,requestId=body?.requestId;
  if(!['world','party'].includes(channel)||typeof room!=='string'||room.length>180)throw new GameError('chat_input',channel==='guild'?'公會系統尚未開放':'請選擇可傳送的聊天頻道');
  if(!/^[A-Za-z0-9_:-]{6,96}$/.test(requestId||''))throw new GameError('request','需要有效的訊息編號');
  if(String(env.ATLAS_ENABLED)!=='true'){
    const schema=await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rpg_scene_chat_messages'").first();
    if(!schema)enabled(env);
  }
  const signature=JSON.stringify([a.charId,channel,room,content]);
  async function replay(){const row=await db.prepare('SELECT * FROM rpg_scene_chat_messages WHERE account_id=? AND request_id=?').bind(a.account,requestId).first();if(!row)return null;if(row.signature!==signature)throw new GameError('request_reused','訊息編號已用於其他內容',409);return {ok:true,realmId:realmId(env),characterId:a.charId,message:publicMessage(row,a),alreadySent:true,now};}
  const previous=await replay();if(previous)return previous;
  enabled(env);
  if(env.REALM_CONTEXT?.phase&&env.REALM_CONTEXT.phase!=='ACTIVE'||env.REALM_CONTEXT?.cutoffAt!=null&&now>=env.REALM_CONTEXT.cutoffAt)throw new GameError('realm_closed','這個環境已停止新的操作',409);
  const available=await channelsFor(db,a);
  if(!available.some(c=>c.enabled&&c.channel===channel&&c.id===room))throw new GameError('chat_room','隊伍或頻道已改變，請重新選擇',403);
  const membership=channel==='world'?'?=\'world\'':`(${shortMembership} OR ${ringMembership})`;
  const roomBindings=channel==='world'?[room]:[room,room];
  try {await db.batch([
    db.prepare('INSERT INTO rpg_scene_chat_rate(account_id,last_sent_at) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET last_sent_at=excluded.last_sent_at WHERE last_sent_at<=?').bind(a.account,now,now-CHAT_INTERVAL_MS),
    db.prepare('INSERT INTO rpg_scene_chat_guard(ok) SELECT NULL WHERE changes()<>1'),
    db.prepare(`INSERT INTO rpg_scene_chat_messages(account_id,char_id,channel,room_id,sender_name,sender_level,base_class,body,request_id,signature,created_at)
      SELECT ?,c.tg_id,?,?,c.name,c.level,c.base_class,?,?,?,? FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id
      WHERE c.tg_id=? AND COALESCE(c.account_tg_id,c.tg_id)=? AND (a.active_char_id IS NULL OR a.active_char_id=c.tg_id) AND ${membership}`).bind(a.account,channel,room,content,requestId,signature,now,a.charId,a.account,...roomBindings),
    db.prepare('INSERT INTO rpg_scene_chat_guard(ok) SELECT NULL WHERE changes()<>1'),
    db.prepare('DELETE FROM rpg_scene_chat_messages WHERE seq IN (SELECT seq FROM rpg_scene_chat_messages WHERE created_at<? ORDER BY created_at LIMIT 200)').bind(now-CHAT_RETENTION_MS),
  ]);}catch(error){const saved=await replay();if(saved)return saved;await actor(db,charId);if(!(await channelsFor(db,a)).some(c=>c.enabled&&c.id===room))throw new GameError('chat_room','隊伍已改變，訊息沒有傳送',403);if(/rpg_scene_chat_guard/.test(String(error?.message))){const rate=await db.prepare('SELECT last_sent_at FROM rpg_scene_chat_rate WHERE account_id=?').bind(a.account).first();if(rate&&rate.last_sent_at>now-CHAT_INTERVAL_MS)throw new GameError('chat_rate','傳送太快，請稍等3秒再傳送',429);throw new GameError('chat_context','角色或隊伍已改變，請重新同步',409);}throw error;}
  const saved=await replay();return {...saved,alreadySent:false};
}
