import {skillExpedition,NOW} from './star-ring-skill-fixture.js';
import {CurrentClientRequest} from './client-request.js';
import {handle} from '../src/index.js';
import {insertEquipStmt,loadPlayer} from '../src/db.js';
import {makeGear} from '../src/game/gear.js';
import {computeStats} from '../src/game/stats.js';
import * as G from '../src/services/guardian-sigil.js';
import * as P from '../src/services/player.js';

export async function configurationExpedition({version=3}={}){
 const f=await skillExpedition({version,prepare:async({env,db,ids})=>{
  const owner=ids[0];
  db.prepare('UPDATE rpg_characters SET gold=1000000 WHERE tg_id=?').run(owner);
  for(const [index,label] of ['a','b','c'].entries()){
   const gear={...makeGear({id:'configuration-'+label,tgId:owner,cls:'sword',slot:'helmet',tier:7,rng:()=>.5,now:NOW}),base_stat:30+index*20,bonus_json:JSON.stringify({hp:[500,50,900][index],mp:[200,20,400][index]})};
   await insertEquipStmt(env.DB,gear).run();
  }
  await G.summon(env,owner,{pool:'normal',count:5,requestId:'configuration-seed'},NOW);
  const rows=db.prepare('SELECT id FROM rpg_guardian_sigils WHERE char_id=? ORDER BY id').all(owner);
  for(const [index,row] of rows.entries())db.prepare('UPDATE rpg_guardian_sigils SET type=?,quality=? WHERE id=?').run(['melee','loot','magic','ranged','melee'][index],index+1,row.id);
  db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,10)').run(owner,'guardian_summon_stone');
  await P.withPlayer(env,owner,NOW,(w,ctx)=>P.equip(w,ctx,{itemId:'configuration-a'}));
  await G.assist(env,owner,{mode:'start',itemId:rows[0].id,autoRenew:true,requestId:'configuration-guardian-a'},NOW);
  const player=await loadPlayer(env.DB,owner),stats=computeStats(player.char,player.equipment.filter(e=>e.is_equipped));
  db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp,stats.maxMp,owner);
 }});
 f.feathers=f.db.prepare('SELECT id FROM rpg_guardian_sigils WHERE char_id=? ORDER BY id').all(f.ids[0]).map(r=>r.id);
 f.post=async(path,body={},at=NOW+1,who=f.ids[0])=>{
  const response=await handle(new CurrentClientRequest('https://local/app/api/'+path,{method:'POST',headers:{'content-type':'application/json','X-Dev-Tg-Id':who,'X-Debug-Now':String(at)},body:JSON.stringify({selectedCharacterId:who,requestId:crypto.randomUUID(),...body})}),f.env);
  return {status:response.status,j:await response.json()};
 };
 f.active=()=>f.db.prepare('SELECT * FROM rpg_guardian_sigils WHERE char_id=? AND active=1').get(f.ids[0]);
 f.equipped=()=>f.db.prepare('SELECT id,is_equipped,bound FROM rpg_equipment WHERE tg_id=? AND is_equipped<>0 ORDER BY id').all(f.ids[0]);
 return f;
}
