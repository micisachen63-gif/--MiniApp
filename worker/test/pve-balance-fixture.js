import {freshDb} from './d1-shim.js';import {T0} from './helpers.js';import * as P from '../src/services/player.js';import * as G from '../src/services/party.js';import {loadPlayer,insertEquipStmt} from '../src/db.js';import {makeGear} from '../src/game/gear.js';import {computeStats} from '../src/game/stats.js';import {SLOTS,GENERAL_WEAPON,POTIONS} from '../src/game/constants.js';
export const IDS=['111','222','333'];
export async function pveTeam({dungeon='forge',profile='epic4',composition='balanced',legacy=false,stock=1000,redPct=50,start=true}={}){
 const d=G.DUNGEONS.find(d=>d.id===dungeon),env={DB:freshDb()},db=env.DB.sqlite;
 const classes=composition==='thief'?['sword','archer','thief']:['sword','archer','mage'],routes=composition==='damage'?['A','A','A']:['B','B','A'];
 for(const[i,id]of IDS.entries()){
  const base=classes[i],route=routes[i],path=route+(d.level>=60?'1':'')+(d.level>=90?'1':'')+(d.level>=120?'1':'');
  await P.createCharacter(env,{tgId:id,name:'挑戰驗收'+id,baseClass:base,gender:'m'},T0);db.prepare('UPDATE rpg_characters SET level=?,class_path=?,auto_red_pct=? WHERE tg_id=?').run(d.level,path,redPct,id);db.prepare('DELETE FROM rpg_equipment WHERE tg_id=?').run(id);
  const rarity=profile==='common0'?'common':profile==='epic4'?'epic':'legendary',enhance=profile==='common0'?0:profile==='epic4'?4:7,source=profile==='ring7'?'star_ring':'shop';
  for(const slot of SLOTS)for(let pos=1;pos<=(['earring','ring'].includes(slot)?2:1);pos++){const e=makeGear({id:id+slot+pos,tgId:id,cls:base,slot,kind:GENERAL_WEAPON[base],tier:Math.ceil(d.level/10),forceRarity:rarity,source,rng:()=>.5,now:T0});e.enhance_level=enhance;e.is_equipped=pos;if(source==='star_ring')e.bonus_json=JSON.stringify({...JSON.parse(e.bonus_json),starRingGearVersion:1});await insertEquipStmt(env.DB,e).run();}
  for(const key of Object.keys(POTIONS))db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=?').run(id,key,stock,stock);
  const p=await loadPlayer(env.DB,id),s=computeStats(p.char,p.equipment);db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(s.maxHp,s.maxMp,id);
 }
 let clock=T0,id=(await G.create(env,IDS[0],{kind:'dungeon',dungeonId:d.id},clock)).party.id;for(const who of IDS.slice(1))await G.action(env,who,{partyId:id,op:'join'},clock);for(const who of IDS)await G.action(env,who,{partyId:id,op:'ready'},clock);if(start)await G.action(env,IDS[0],{partyId:id,op:'start'},clock);
 function state(){return JSON.parse(db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json);}
 function edit(fn){const s=state();fn(s);db.prepare('UPDATE rpg_parties SET state_json=? WHERE id=?').run(JSON.stringify(s),id);}
 if(legacy&&start)edit(s=>{delete s.dungeonBalanceVersion;delete s.dungeonBalance;for(const a of s.actors)delete a.defenseScale;delete s.enemy.attack;s.enemy.hp=s.enemy.maxHp=Math.round(s.actors.reduce((n,a)=>n+a.atk,0)*8);});
 const turns=[];async function step(){const s=state();clock=s.deadline;const p=await G.view(env,id,IDS[0],clock);turns.push(state().lastTurn);return p;}
 async function finish(){let p;for(let i=0;i<45;i++){p=await step();if(p.status!=='combat')return p;}throw Error('unbounded battle');}
 async function repeat(){const r=await G.action(env,IDS[0],{partyId:id,op:'repeat',requestId:'next-'+clock},++clock);id=r.party.id;return r.party;}
 function costs(){let red=0,blue=0;for(const who of IDS)for(const row of db.prepare("SELECT item,quantity FROM rpg_inventory WHERE tg_id=? AND (item LIKE 'red_%' OR item LIKE 'blue_%')").all(who)){const cost=(stock-row.quantity)*POTIONS[row.item].price;if(POTIONS[row.item].kind==='red')red+=cost;else blue+=cost;}return {red:red/3,blue:blue/3};}
 return {env,db,ids:IDS,d,id:()=>id,state,edit,step,finish,repeat,costs,turns,clock:()=>clock,close:()=>db.close()};
}
