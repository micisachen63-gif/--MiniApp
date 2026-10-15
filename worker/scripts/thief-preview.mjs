// Actual new-worktree application with an isolated SQLite memory fixture only.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {freshDb} from '../test/d1-shim.js';
import {T0} from '../test/helpers.js';
import * as Player from '../src/services/player.js';
import * as Guardian from '../src/services/guardian-sigil.js';
import {handle} from '../src/index.js';
import {metaView} from '../src/app.js';
import {THIEF_CLASS} from '../src/game/thief-data.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export async function createThiefPreview(){
 const db=freshDb(),env={DB:db,ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};
 const ids=['811','812','813'];
 // This pragma applies only to this brand-new in-memory fixture; no remote DB or migration.
 db.sqlite.exec('PRAGMA ignore_check_constraints=ON');
 for(const id of ids){
  await Player.createCharacter(env,{tgId:id,name:id==='811'?'盜賊女試驗':id==='812'?'盜賊女同伴':'盜賊女分身',baseClass:'sword',gender:'f'},T0);
  await db.prepare("UPDATE rpg_characters SET base_class='thief',class_path='',level=20,gold=300000,last_settle_at=? WHERE tg_id=?").bind(T0,id).run();
  await db.prepare("DELETE FROM rpg_equipment WHERE tg_id=?").bind(id).run();
  const op='thief-ui-guardian-'+id;
  await db.prepare('INSERT INTO rpg_guardian_operations(operation_id,account_id,char_id,request_id,action,payload_hash,config_version,cost_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(op,id,id,op,'summon','0'.repeat(64),'fixture','{}','{}',T0).run();
  await Guardian.insertSigil(db,{id:'thief-ui-angel-'+id,char_id:id,type:'melee',quality:4,source_operation_id:op,created_at:T0}).run();
  await db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').bind(id,'guardian_summon_stone',1).run();
  await Guardian.assist(env,id,{mode:'start',itemId:'thief-ui-angel-'+id,autoRenew:false,requestId:'thief_ui_assist_'+id},T0);
 }
 await db.prepare('UPDATE rpg_characters SET account_tg_id=?,char_slot=2 WHERE tg_id=?').bind('811','813').run();
 const requests=[],served=new Map();
 const allowed=new Set(['meta','characters','select','me','bag','shop','background/status','ledger','classes','hall/list','hall/get','trade/list','trade/requests','pk/list','expedition/me','party/list','journal','guardian/state','guardian/inventory','guardian/config','operation-notices','notice/status']);
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.css':'text/css','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.webm':'video/webm','.mp4':'video/mp4'};
 const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/app/api/')){
   const id=String(req.headers['x-dev-tg-id']||'811');
   if(!ids.includes(id)||(req.headers['x-telegram-init-data']&&req.headers['x-telegram-init-data']!=='thief-local-ui-fixture'))return json(res,403,{ok:false,error:'fixture_identity'});
   const action=url.pathname.slice(9);if(!allowed.has(action))return json(res,403,{ok:false,error:'fixture_action',message:'Read-only isolated fixture'});
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString()||'{}';
   requests.push({action,id});
   const response=await handle(new Request('http://fixture'+url.pathname,{method:'POST',headers:{'X-Monster-Art-Revision':req.headers['x-monster-art-revision']||'','content-type':'application/json','X-Dev-Tg-Id':id,'X-Telegram-Init-Data':'','X-Debug-Now':String(T0)},body}),env);
   const data=await response.json();
   if(action==='meta'&&data.meta){
    const c=THIEF_CLASS;
    // Explicit mock-only release override for pilot previews. Product THIEF_RELEASE_READY stays false.
    data.meta.classes.thief={...data.meta.thief,key:'thief',name:c.name,emoji:c.emoji,blurb:c.blurb,releaseReady:true,skill:c.node.skill,passive:c.node.passive.text,growth:{hp:c.hp,mp:c.mp,atk:c.atk,def:c.def},branches:Object.fromEntries(Object.entries(c.branches).map(([key,node])=>[key,{...node,passive:node.passive.text}]))};
   }
   return json(res,response.status,data);
  }
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{ok:false});
  let rel=decodeURIComponent(url.pathname);if(rel==='/')rel='/index.html';if(rel.endsWith('/'))rel+='index.html';
  const base=path.join(root,'worker/public'),file=path.resolve(base,'.'+rel);
  if(!file.startsWith(base+path.sep))return json(res,403,{ok:false});
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{ok:false,file:rel});
  if(!served.has(file))served.set(file,fs.readFileSync(file));
  const bytes=served.get(file);
  res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(req.method==='HEAD'?null:bytes);
 }catch(error){json(res,500,{ok:false,error:'fixture',message:error.stack});}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {origin:'http://127.0.0.1:'+server.address().port,requests,served,close:()=>new Promise(resolve=>server.close(()=>{db.sqlite.close();resolve();}))};
}
