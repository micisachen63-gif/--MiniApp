import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {packagedCombatReadiness} from './scene-combat-readiness.mjs';

const flags=['ATLAS_ENABLED','EQUIPMENT_COLLECTION_ENABLED','EQUIPMENT_RECOVERY_ENABLED'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sorted=rows=>[...rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const inside=(root,file)=>{const r=path.relative(root,file);return r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
export function expectedSceneBindings(before,enabled){
 if(!enabled)return before;
 for(const binding of before)if(flags.includes(binding.name))assert.equal(binding.type,'plain_text','Scene activation cannot replace a secret or resource binding');
 const next=before.filter(b=>!flags.includes(b.name));
 for(const name of flags)next.push({name,type:'plain_text',valueSHA256:sha('true')});
 return sorted(next);
}
// Whitespace, comments and quoted identifier spelling do not change SQLite
// semantics. String literals remain case-sensitive, including CHECK values.
export function normalizedSql(sql){
 const tokens=String(sql||'').match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\s]/g)||[];
 const parts=tokens.filter(t=>!t.startsWith('--')&&!t.startsWith('/*')).map(t=>t.startsWith("'")?t:/^["`\[]/.test(t)?t.slice(1,-1).toLowerCase():t.toLowerCase()),out=[];
 for(let i=0;i<parts.length;i++){if(parts[i]==='if'&&parts[i+1]==='not'&&parts[i+2]==='exists'){i+=2;continue;}out.push(parts[i]);}return out.join(' ');
}
export function publishedAssetFile(publicRoot,url){assert(/^\/[A-Za-z0-9_./-]+$/.test(url),'Invalid scene asset URL');const file=path.resolve(publicRoot,'.'+url);assert(inside(publicRoot,file),'Scene asset escapes public');return file;}
export function compareSceneSchema(required,actual,forbidden=[]){
 const found=new Map(actual.map(row=>[row.type+':'+row.name,row]));
 return {missing:required.filter(r=>!found.has(r.type+':'+r.name)).map(r=>r.name),
  mismatched:required.filter(r=>found.has(r.type+':'+r.name)&&normalizedSql(r.sql)!==normalizedSql(found.get(r.type+':'+r.name).sql)).map(r=>r.name),
  forbidden:actual.filter(r=>forbidden.includes(r.name)).map(r=>r.name)};
}
export function assertSceneSchema(requirements,actual){
 const result=compareSceneSchema(requirements.schema,actual,requirements.forbidden);
 assert(!result.missing.length&&!result.mismatched.length&&!result.forbidden.length,'Production scene schema not ready: '+JSON.stringify(result));return result;
}
export async function sceneReleaseRequirements(root){
 const publicRoot=path.join(root,'worker/public');let manifest;
 try{manifest=JSON.parse(await fs.readFile(path.join(publicRoot,'scene-production-manifest.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;const entry=await fs.readFile(path.join(publicRoot,'index.html'),'utf8');assert(!/telegram:true/.test(entry),'Production scene manifest is missing');return null;}
 assert.equal(manifest.schemaVersion,1);assert.equal(manifest.appearances,248);assert.equal(manifest.populatedSlots,3968);assert.equal(manifest.sourcePixelsModified,false);
 const config=await fs.readFile(path.join(root,'worker/wrangler.toml'),'utf8');
 for(const name of flags)assert(new RegExp('^'+name+'\\s*=\\s*"true"','m').test(config),'Scene feature not enabled: '+name);
 const entries=new Map();
 for(const entry of manifest.entries){
  assert(!entries.has(entry.url),'Duplicate scene asset');
  const file=await fs.realpath(publishedAssetFile(publicRoot,entry.url));assert(inside(publicRoot,file),'Scene asset escapes public');
  const data=await fs.readFile(file);assert(data.length<=25*1024*1024,'Scene asset too large');assert.equal(data.length,entry.bytes);assert.equal(sha(data),entry.sha256,'Packaged scene asset changed: '+entry.url);
  if(entry.kind==='alias'){const source=await fs.realpath(path.join(publicRoot,entry.source));assert(inside(publicRoot,source),'Alias source escapes public');assert.equal(sha(await fs.readFile(source)),entry.sha256,'Scene alias is stale: '+entry.url);}
  entries.set(entry.url,entry);
 }
 const indexPath='/ui-generated-20261030/characters-v1/character-preview-index.json',index=JSON.parse(await fs.readFile(path.join(publicRoot,indexPath),'utf8'));
 assert.equal(entries.get(indexPath)?.sha256,manifest.reviewedCatalogSha256);assert.equal(index.actors.length,248);
 const ids=new Set();
 for(const ref of index.actors){
  assert(!ids.has(ref.id),'Duplicate character');ids.add(ref.id);
  const u=new URL(ref.actorUrl,'http://assets.invalid');assert.equal(u.origin,'http://assets.invalid');assert(entries.has(u.pathname),'Missing actor metadata');
  const actor=JSON.parse(await fs.readFile(path.join(publicRoot,u.pathname),'utf8'));assert.equal(actor.id,ref.id);
  for(const action of ['idle','walk','attack','death'])for(const direction of ['up','down','right','left']){
   const clip=actor.clips?.[action]?.[direction];assert(clip?.frames?.length,'Incomplete character: '+ref.id);
   for(const frame of clip.frames){const url=new URL(frame.url,'http://assets.invalid');assert.equal(url.origin,'http://assets.invalid');assert(entries.has(url.pathname),'Missing character frame: '+frame.url);}
  }
 }
 for(const name of ['/index.html','/ui-generated-20261030/scene-bound-20261102/scene.html']){
  const body=await fs.readFile(path.join(publicRoot,name),'utf8');assert(/telegram:true/.test(body),'Release entry is not signed Telegram mode');assert(!body.includes('127.0.0.1:'),'Release entry contains loopback endpoint');
 }
 assert.equal(entries.get('/ui-generated-20261030/characters-v1/character-sprites.js')?.sha256,manifest.reviewedRendererSha256);
 const combat=await packagedCombatReadiness(publicRoot,index);
 assert.equal(combat.failures.length,0,'Character combat release metadata is incomplete: '+JSON.stringify({slots:combat.slots,ready:combat.ready,examples:combat.failures.slice(0,6)}));
 return {enabled:true,assetFiles:entries.size,appearances:ids.size,combatSlots:combat.slots,...await sceneSchemaRequirements(root)};
}
export async function sceneSchemaRequirements(root){
 const db=new DatabaseSync(':memory:'),names=new Set(['rpg_characters','rpg_live_characters']),forbidden=[];
 try{
  const dir=path.join(root,'worker/migrations');
  for(const name of (await fs.readdir(dir)).filter(n=>n.endsWith('.sql')).sort()){
   const sql=(await fs.readFile(path.join(dir,name),'utf8')).replace(/\r\n/g,'\n');db.exec(sql);
   if(name>='0035'){
    for(const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/gi))names.add(m[1]);
    for(const m of sql.matchAll(/DROP\s+INDEX\s+([A-Za-z0-9_]+)/gi))forbidden.push(m[1]);
   }
  }
  const schema=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all().filter(row=>names.has(row.name));
  return {schema,forbidden:forbidden.filter(n=>!names.has(n))};
 }finally{db.close();}
}
