import {repeatCard} from './party-card.js';
import {requireTowerEntry} from './tower-daily.js';
import {GameError} from '../game/classes.js';
import {TOWER_RULES,towerRewardable} from '../game/tower-progression.js';
import {guardStmt,outboxStmt} from '../db.js';
import {borrowRunningRingStmt} from './party-presence.js';

// A new immutable battle record keeps each run's rewards and journal evidence.
// The player sees the same roster; no old reward or combat state is reset.
export async function repeatParty(env,p,tg,stmts,now,beginParty){
 if(tg!==p.leader_id)throw new GameError('leader','只有隊長可以續開');
 if(!['won','lost','ended'].includes(p.status)||!Number.isFinite(p.state.combatStartedAt))throw new GameError('closed','請先完成目前這場挑戰');
 if(p.state.disbanded||(p.state.departedMembers||[]).includes(tg))throw new GameError('closed','隊伍已解散，請重新組隊');
 if(p.state.nextPartyId)return {partyId:p.state.nextPartyId};
 if(towerRewardable(p)){
  const paid=(await env.DB.prepare('SELECT char_id FROM rpg_party_rewards WHERE party_id=?').bind(p.id).all()).results||[];
  if(p.state.actors.some(a=>a.actions>0&&!paid.some(r=>r.char_id===a.id)))throw new GameError('reward_pending','本場獎勵仍在結算，請稍後再開始',409);
 }
 const members=p.members.filter(m=>!(p.state.departedMembers||[]).includes(m.char_id));
 for(const m of members){if(p.kind==='tower')await requireTowerEntry(env.DB,m.char_id,now);const account=await env.DB.prepare('SELECT active_char_id FROM rpg_accounts WHERE account_tg_id=?').bind(m.account_id).first();if(account?.active_char_id!==m.char_id)throw new GameError('changed','有隊員已切換角色，請回到原角色或先離開舊隊伍');}
 const id='p'+crypto.randomUUID().replaceAll('-','').slice(0,15),s=p.state;
 const card=await repeatCard(env.DB,p,id,stmts);
 const state={...card,name:s.name,level:s.level,map:s.map,trial:s.trial,dungeonId:s.dungeonId,startFloor:s.startFloor,floor:s.startFloor,round:1,actors:[],actions:{},rewarded:[],revived:false,log:['隊伍整裝再出發，保留仍在隊上的夥伴。'],roleRules:s.roleRules,previousPartyId:p.id,...(p.kind==='tower'?{towerVersion:TOWER_RULES.version,clearedFloor:s.startFloor-1}:{})};
 const next={id,leader_id:tg,kind:p.kind,status:'lobby',rev:-1,state,members:members.map(m=>({...m,ready:1}))};
 stmts.push(env.DB.prepare("INSERT INTO rpg_parties(id,leader_id,kind,state_json,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?)").bind(id,tg,p.kind,JSON.stringify(state),now,now,now+600000),guardStmt(env.DB));
 for(const m of next.members)stmts.push(env.DB.prepare('INSERT INTO rpg_party_members(party_id,char_id,account_id,joined_at,ready) VALUES(?,?,?,?,1)').bind(id,m.char_id,m.account_id,now),borrowRunningRingStmt(env.DB,m.char_id),env.DB.prepare('INSERT INTO rpg_party_presence(account_id,party_id,char_id) VALUES(?,?,?)').bind(m.account_id,id,m.char_id));
 if(next.members.length===3)await beginParty(env,next,stmts,now);
 stmts.push(env.DB.prepare('UPDATE rpg_parties SET status=?,state_json=?,rev=0 WHERE id=? AND rev=0').bind(next.status,JSON.stringify(next.state),id),guardStmt(env.DB),outboxStmt(env.DB,{dedupe:`party:${id}:0`,target:'group',kind:'party_card',payload:{partyId:id}},now));
 p.state.nextPartyId=id;return {partyId:id};
}
