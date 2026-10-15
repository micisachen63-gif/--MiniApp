import * as REROLL_AUTO from './services/auto-reroll.js';
import * as GUARDIAN_AUTO from './services/guardian-auto.js';
import {step,INTERVAL_MS} from './services/auto-enhance.js';

/** One durable alarm per job. D1 remains the authority for money, revisions and stop state. */
export class AutoEnhanceRunner {
 constructor(state,env){this.state=state;this.env=env;}
 async job(id,kind='enhance'){return this.env.DB.prepare(kind==='reroll'?'SELECT id,status,next_at FROM rpg_auto_reroll WHERE id=?':kind==='guardian'?'SELECT id,status,next_at FROM rpg_guardian_auto WHERE id=?':'SELECT id,status,next_at FROM rpg_auto_enhance WHERE id=?').bind(id).first();}
 async fetch(request){
  const {jobId,kind='enhance'}=await request.json();if(!['enhance','guardian','reroll'].includes(kind))return new Response('Invalid kind',{status:400});
  if(!/^[\da-f-]{36}$/i.test(String(jobId)))return new Response('Invalid job',{status:400});
  const row=await this.job(jobId,kind);if(!row||row.status!=='running')return new Response('Ended');
  await this.state.storage.put('jobId',jobId);await this.state.storage.put('kind',kind);
  const desired=Math.max(Date.now()+10,row.next_at),alarm=await this.state.storage.getAlarm();
  if(alarm==null||alarm>desired)await this.state.storage.setAlarm(desired);
  return new Response('Scheduled',{status:202});
 }
 async alarm(){
  const id=await this.state.storage.get('jobId');if(!id)return;const kind=await this.state.storage.get('kind')||'enhance';
  // Register recovery before doing I/O: a crash cannot leave a paid job without a future wake-up.
  await this.state.storage.setAlarm(Date.now()+30_000);
  try{
   let row=await this.job(id,kind),progressed=true;
   if(row?.status==='running'&&row.next_at<=Date.now())progressed=await (kind==='reroll'?REROLL_AUTO.step:kind==='guardian'?GUARDIAN_AUTO.step:step)(this.env,id,Date.now());
   row=await this.job(id,kind);
   if(row?.status==='running')await this.state.storage.setAlarm(Math.max(Date.now()+(progressed?100:350+Math.floor(Math.random()*650)),row.next_at));
   else{await this.state.storage.deleteAlarm();await this.state.storage.delete('jobId');await this.state.storage.delete('kind');}
  }catch(e){console.error('auto enhancement alarm',id,e.message);await this.state.storage.setAlarm(Date.now()+Math.max(INTERVAL_MS,30_000));}
 }
}
