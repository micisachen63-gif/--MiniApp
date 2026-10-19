import {freshDb} from './d1-shim.js';
import {CurrentClientRequest} from './client-request.js';
import {handle} from '../src/index.js';
import * as P from '../src/services/player.js';
import * as R from '../src/services/star-ring.js';
import * as Party from '../src/services/party.js';
import {loadPlayer} from '../src/db.js';
import {computeStats} from '../src/game/stats.js';
import {SPECIAL_SKILLS,eligible,specialState} from '../src/game/special.js';

export const NOW=Date.parse('2026-10-19T08:00:00+08:00');
export async function skillExpedition({version=3}={}){
 const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'},db=env.DB.sqlite,ids=['8711','8712','8713','8714','8715'];let choices;
 for(const [i,tgId] of ids.entries()){
  await P.createCharacter(env,{tgId,name:'技能驗收'+i,baseClass:['sword','mage','archer','thief','sword'][i],gender:'m'},NOW);
  db.prepare("UPDATE rpg_characters SET level=80,class_path='A1',last_settle_at=? WHERE tg_id=?").run(NOW,tgId);
  const player=await loadPlayer(env.DB,tgId),stats=computeStats(player.char,player.equipment.filter(e=>e.is_equipped));
  const skills=SPECIAL_SKILLS.filter(s=>eligible(player.char,s)).map(s=>s.id),x=specialState(player.char);
  Object.assign(x,{learned:skills.slice(0,4),loadout:skills.slice(0,3),auto:{[skills[0]]:'ready'},cooldowns:{[skills[0]]:NOW+60000}});
  db.prepare('UPDATE rpg_characters SET hp=?,mp=?,special_json=? WHERE tg_id=?').run(stats.maxHp,stats.maxMp,JSON.stringify(x),tgId);
  if(i===0)choices=skills;
 }
 if(choices.length<5)throw Error('Fixture needs five eligible skills');
 db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,1)').run(ids[0],'book_'+choices[4]);
 const id=(await R.create(env,ids[0],{tier:80},NOW)).party.id;
 const state=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);state.engineVersion=version;
 db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(state),id);
 for(const who of ids.slice(1))await R.action(env,who,{partyId:id,action:'join'},NOW);
 for(const who of ids)await R.action(env,who,{partyId:id,action:'ready'},NOW);
 await R.action(env,ids[0],{partyId:id,action:'start'},NOW);
 const api=async(body,at=NOW+1,who=ids[0])=>{
  const response=await handle(new CurrentClientRequest('https://local/app/api/expedition/action',{method:'POST',headers:{'content-type':'application/json','X-Dev-Tg-Id':who,'X-Debug-Now':String(at)},body:JSON.stringify({selectedCharacterId:who,requestId:crypto.randomUUID(),...body})}),env);
  return {status:response.status,j:await response.json()};
 };
 return {env,db,ids,id,choices,api,close:()=>db.close(),state:()=>JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json),character:()=>db.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get(ids[0])};
}
export async function shortParty(f,kind,at=NOW+1000){
 const who=f.ids.slice(0,3),id=(await Party.create(f.env,who[0],{kind,dungeonId:'pillar',startFloor:1},at)).party.id;
 for(const tg of who.slice(1))await Party.action(f.env,tg,{partyId:id,op:'join'},at);
 for(const tg of who)await Party.action(f.env,tg,{partyId:id,op:'ready'},at);
 await Party.action(f.env,who[0],{partyId:id,op:'start'},at);return id;
}
