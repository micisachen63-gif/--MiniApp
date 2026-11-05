import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createClient } from '../public/scene-fate-private-ui.js';
import { fixture, NOW, OWNER, changes, snapshot } from './fate-scene-fixture.js';
import * as PrivateScene from '../src/services/fate-private-scene.js';
import * as PrivateReceipt from '../src/services/fate-private-receipt.js';
import * as PrivateScoped from '../src/services/fate-private-scoped.js';
import * as FateScene from '../src/services/fate-scene.js';
import * as Fate from '../src/services/fate.js';
import * as Atlas from '../src/services/atlas.js';
import { addActive, LIFE_MS } from '../public/fate/life.js';
import { zodiacFor } from '../public/fate/model.js';

const plain = value => JSON.parse(JSON.stringify(value));
const endpoint = 'http://127.0.0.1:9802/app/api/';
const sessionSource = fs.readFileSync(new URL('../public/scene-live-session.js', import.meta.url), 'utf8');
// Fictional data stays in this test process. Assertions never print its actual values.
const birthA = () => ({date:'2000-02-29',time:'00:00',placeId:'custom',lat:0,lon:0,zone:'UTC',placeLabel:'合成測點',sex:'f'});
const birthB = () => ({date:'2001-07-14'});
const equalPrivate = (a,b,label) => assert.ok(JSON.stringify(a) === JSON.stringify(b), label);
const publicOnly = value => {
  const text = JSON.stringify(value);
  assert.ok(!text.includes(birthA().date) && !text.includes(birthB().date), 'private date never enters public proof or durable pending');
  assert.ok(!/"(?:birth|birthDate|birth_json|chart_json|notes_json|payloadHash|payload_hash)"/.test(text),
    'public proof excludes private fields and private fingerprint');
};
const pureSame = (f,before,n) => {
  equalPrivate(snapshot(f.db), before, 'all SQLite tables stay unchanged during pure read');
  assert.equal(changes(f.db), n);
};
const resources = f => ({
  player: f.one('SELECT gold,exp FROM rpg_characters WHERE tg_id=?', f.tg),
  inventory: f.rows('SELECT * FROM rpg_inventory ORDER BY tg_id,item'),
  gifts: f.rows('SELECT * FROM rpg_fate_gifts ORDER BY id')
});

async function bridge(t) {
  const f = await fixture(t), storage = new Map(), clients = [];
  const h = { f, storage, clients, now:NOW, sequence:0, nonce:0, calls:[], writes:[],
    loseNextWrite:false, dropNextWrite:false, holdNextScene:false, fate:null };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [h.now])); }
    static now() { return h.now; }
  }
  const sandbox = {AbortController,URL,URLSearchParams,console,Date:Clock,
    crypto:globalThis.crypto,setTimeout,clearTimeout,queueMicrotask};
  vm.createContext(sandbox); vm.runInContext(sessionSource,sandbox);
  const session = sandbox.RpgSceneSession.create({
    endpoint,accountId:OWNER,realmId:'permanent',characterId:f.tg,now:()=>h.now,
    fetch:async (url, options) => {
      const action = url.slice(endpoint.length), body = JSON.parse(options.body), at = h.now;
      // Full wires exist only in RAM to compare the actual private payload and exercise late arrival.
      h.calls.push({action,body,at});
      assert.equal(options.method,'POST');
      assert.equal(options.headers['X-Dev-Tg-Id'],OWNER);
      assert.equal(options.headers['X-Realm-Id'],'permanent');
      assert.equal(body.selectedCharacterId,f.tg);
      if (action.startsWith('fate/')) assert.equal(body.realmId,'permanent');
      const writing = ['fate/private/action-scoped','fate/private/cancel'].includes(action);
      if (writing && h.dropNextWrite) { h.dropNextWrite = false; throw Error('Deliberate request loss before original service'); }
      let value;
      try {
        if (action === 'fate/private/scene') value = await PrivateScene.view(f.env,f.tg,body,at,'app');
        else if (action === 'fate/private/profile') value = await PrivateScene.profile(f.env,f.tg,body,at,'app');
        else if (action === 'fate/private/receipt') value = await PrivateReceipt.view(f.env,f.tg,body,at,'app');
        else if (action === 'fate/private/action-scoped') value = await PrivateScoped.run(f.env,f.tg,body,at,'app');
        else if (action === 'fate/private/cancel') value = await PrivateScoped.cancel(f.env,f.tg,body,at,'app');
        else if (action === 'atlas/status') value = await Atlas.status(f.env,f.tg,at);
        else throw Error('Unexpected wire route');
      } catch (error) {
        return {ok:false,status:error.status || 400,json:async()=>({ok:false,error:error.code || 'bridge_error',message:error.message})};
      }
      if (writing) {
        publicOnly(value);
        h.writes.push({action,kind:body.kind,id:body.requestId,result:plain(value)});
        if (h.loseNextWrite) { h.loseNextWrite = false; throw Error('Deliberate committed reply loss'); }
      }
      if (action === 'fate/private/scene' && h.holdNextScene) {
        h.holdNextScene = false;
        await new Promise(resolve => { h.releaseScene = resolve; h.sceneHeld?.(); });
      }
      return {ok:true,status:200,json:async()=>plain(value)};
    }
  });
  h.remount = () => {
    h.client?.dispose();
    h.client = createClient({
      getContext:()=>session.getContext(),current:()=>true,request:(...args)=>session.request(...args),
      now:()=>h.now,newRequestId:()=> 'private-bridge-' + String(++h.sequence).padStart(10,'0'),
      newIntentNonce:()=> (++h.nonce).toString(16).padStart(32,'0'),
      getFateState:()=>h.fate,
      storage:{getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}
    });
    clients.push(h.client); return h.client;
  };
  h.refreshFate = async () => { h.fate = (await FateScene.view(f.env,f.tg,f.scope(),h.now,'app')).fate; };
  h.session = session; h.remount();
  t.after(()=>{for(const c of clients)c.dispose();session.dispose();h.calls.length=0;storage.clear();});
  return h;
}
async function submit(h,prepare,kind) {
  const c = h.client;
  assert.equal(prepare(),true,c.state.error || c.state.notice);
  publicOnly(c.state.confirm);
  assert.equal(await c.submit(),true,c.state.error || c.state.notice);
  const op = h.writes.at(-1);
  assert.equal(op.kind,kind); assert.equal(op.result.outcome,'committed');
  assert.equal(c.pending(),null); publicOnly(op.result);
  return op;
}
function lookupBody(record) {
  return {realmId:record.context.realmId,selectedCharacterId:record.context.characterId,
    requestId:record.id,...plain(record.intent)};
}

test('F2 real client/session saves once after a lost response, reloads metadata only, and keeps erase-safe historical proof', async t => {
  const h = await bridge(t), f = h.f; let c = h.client;
  const initial = snapshot(f.db), n = changes(f.db), assets = resources(f);
  assert.equal(await c.refresh(),true,c.state.error);
  pureSame(f,initial,n);
  assert.equal(c.prepareSave(birthA(),false),false);
  assert.equal(c.prepareSave(birthA(),true),true,c.state.error);
  publicOnly(c.state.confirm);
  h.loseNextWrite = true;
  assert.equal(await c.submit(),false);
  const pending = plain(c.pending()), saved = h.writes.at(-1);
  publicOnly(pending); for(const value of h.storage.values())publicOnly(JSON.parse(value));
  const sent = h.calls.find(call=>call.action === 'fate/private/action-scoped').body;
  assert.ok(sent.birth.lat === 0 && sent.birth.lon === 0 && sent.birth.time === '00:00',
    'wire preserves explicit zero coordinates and midnight');
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_operations').n,1);
  equalPrivate(resources(f),assets,'profile save changes no resources');
  c = h.remount(); assert.equal(c.hasPrivatePayload(pending.id),false);
  assert.equal(c.state.profile,null);
  const after = snapshot(f.db), committedChanges = changes(f.db);
  assert.equal(await c.checkPending(pending.id),true,c.state.error);
  assert.equal(c.state.receipt.found,true);
  equalPrivate(c.state.receipt.result,saved.result.result,'lookup returns original nonprivate result');
  pureSame(f,after,committedChanges);
  h.now += 1000;
  assert.equal(await c.refresh(),true,c.state.error);
  assert.equal(c.acknowledge(pending.id),true,'later pure refresh does not invalidate verified immutable receipt');
  assert.equal(await c.refresh(),true,c.state.error);
  assert.equal(await c.viewProfile(),true,c.state.error);
  assert.ok(c.state.profile?.birth?.date === birthA().date,'explicit owner view returns the saved profile in memory');
  assert.equal(await c.refresh(),true,c.state.error);
  await submit(h,()=>c.prepareDelete(),'profile-delete');
  assert.equal(c.state.profile,null);
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_profiles').n,0);
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_daily').n,0);
  await submit(h,()=>c.prepareSave(birthB(),true),'profile-save');
  const current = snapshot(f.db), m = changes(f.db);
  const historical = await h.session.request('fate/private/receipt',lookupBody(pending));
  assert.equal(historical.found,true); publicOnly(historical);
  equalPrivate(historical.result,saved.result.result,'old proof is independent of current profile');
  pureSame(f,current,m);
  for(const row of f.rows('SELECT note FROM rpg_ledger WHERE type=?','命運私人操作收據'))publicOnly(JSON.parse(row.note));
  assert.equal(h.writes.filter(x=>x.id===pending.id).length,1);
});

test('F2 lost private input requires same-ID cancellation and a late original birthday cannot create a life', async t => {
  const h = await bridge(t), f = h.f; let c = h.client;
  await h.refreshFate(); assert.equal(await c.refresh(),true,c.state.error);
  assert.equal(c.prepareBirthday('temporary','JP',false,birthA().date),true,c.state.error);
  h.dropNextWrite = true; assert.equal(await c.submit(),false);
  const pending = plain(c.pending()), original = plain(h.calls.find(x=>x.action==='fate/private/action-scoped').body);
  assert.equal(original.showSign,false); assert.equal(original.socialInvite,false);
  assert.equal(h.writes.length,0); assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_operations').n,0);
  c = h.remount(); assert.equal(c.hasPrivatePayload(pending.id),false);
  assert.equal(await c.checkPending(pending.id),true,c.state.error);
  assert.equal(c.state.receipt.found,false); assert.equal(c.prepareRecovery(pending.id),false);
  assert.equal(c.prepareCancel(pending.id),true,c.state.error);
  h.loseNextWrite = true; assert.equal(await c.submit(),false);
  assert.equal(c.pending().cancelRequested,true);
  c = h.remount(); assert.equal(await c.checkPending(pending.id),true,c.state.error);
  assert.equal(c.state.receipt.outcome,'cancelled'); assert.equal(c.acknowledge(pending.id),true);
  assert.equal(await c.refresh(),true,c.state.error);
  const before = snapshot(f.db), n = changes(f.db);
  const late = await PrivateScoped.run(f.env,f.tg,original,h.now,'app');
  assert.equal(late.outcome,'cancelled'); publicOnly(late); pureSame(f,before,n);
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_lives').n,0);
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_starts').n,0);
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_profiles').n,0);
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_operations').n,1);
  assert.equal(h.writes.length,1);
});

test('F2 daily client explicitly materializes original locked notes without rewards and does not move an old intent across midnight', async t => {
  const h = await bridge(t), f = h.f, c = h.client;
  assert.equal(await c.refresh(),true,c.state.error);
  assert.equal(c.state.data.privateFate.daily.materialized,false);
  const assets = resources(f);
  await submit(h,()=>c.prepareDaily(),'daily-sync');
  assert.equal(c.state.data.privateFate.daily.notes.length,3);
  assert.ok(c.state.data.privateFate.daily.notes.every(x=>x.locked && Object.keys(x).sort().join(',')==='locked,topic'),
    'locked entries disclose only topic and locked flag');
  const originalNotes = f.one('SELECT notes_json FROM rpg_fate_daily').notes_json;
  await submit(h,()=>c.prepareSave(birthA(),true),'profile-save');
  assert.ok(f.one('SELECT notes_json FROM rpg_fate_daily').notes_json === originalNotes,
    'saving profile does not reroll existing daily notes');
  const before = snapshot(f.db), n = changes(f.db);
  assert.equal(await c.refresh(),true,c.state.error); pureSame(f,before,n);
  assert.equal(c.prepareDaily(),true,c.state.error);
  h.now = Date.parse('2026-11-06T00:00:00+08:00');
  assert.equal(await c.submit(),false);
  const old = plain(c.pending());
  assert.equal(old.intent.day,'2026-11-05');
  assert.equal(await c.checkPending(old.id),true,c.state.error);
  assert.equal(c.state.receipt.found,false);
  assert.equal(c.prepareCancel(old.id),true,c.state.error); assert.equal(await c.submit(),true,c.state.error);
  assert.equal(c.state.data.privateFate.daily.materialized,false);
  await submit(h,()=>c.prepareDaily(),'daily-sync');
  assert.equal(c.state.data.privateFate.day,'2026-11-06');
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_daily').n,2);
  equalPrivate(resources(f),assets,'daily/profile/cancel operations have no currency or inventory effects');
  assert.equal(f.one("SELECT COUNT(*) n FROM rpg_ledger WHERE type='每日補給金'").n,0);
});

test('F2 actual private scene rejects a late snapshot after equal-time legacy erase and recreate', async t => {
  const h = await bridge(t), f = h.f, c = h.client;
  assert.equal(await c.refresh(),true,c.state.error);
  await submit(h,()=>c.prepareSave(birthA(),true),'profile-save');
  assert.equal(await c.viewProfile(),true,c.state.error);
  const held = new Promise(resolve=>{h.sceneHeld=resolve;});
  h.holdNextScene = true; const late = c.refresh(); await held;
  const oldGeneration = c.state.data.privateFate.domain.generation;
  await Fate.deleteProfile(f.env,f.tg,{requestId:'legacy-delete-bridge'},h.now);
  await Fate.saveProfile(f.env,f.tg,{requestId:'legacy-recreate-bridge',consent:true,birth:birthA()},h.now);
  assert.equal(f.one('SELECT rev FROM rpg_fate_profiles').rev,1);
  assert.equal(await c.refresh(),true,c.state.error);
  const currentGeneration = c.state.data.privateFate.domain.generation;
  assert.equal(currentGeneration,oldGeneration+2);
  assert.equal(c.state.profile,null,'new generation clears explicitly revealed private cache');
  h.releaseScene(); assert.equal(await late,false);
  assert.equal(c.state.data.privateFate.domain.generation,currentGeneration);
  assert.equal(c.state.profile,null);
});

test('F2 real temporary and saved birthday starts retain original life authority and separate profile consent', async t => {
  const h = await bridge(t), f = h.f, c = h.client;
  await h.refreshFate(); assert.equal(await c.refresh(),true,c.state.error);
  const temp = await submit(h,()=>c.prepareBirthday('temporary','JP',false,birthA().date),'birthday-start');
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_profiles').n,0);
  const first = f.one('SELECT state_json,started_at FROM rpg_fate_lives WHERE id=?',temp.result.result.lifeId);
  const draft = JSON.parse(first.state_json);
  assert.equal(draft.version,9); assert.equal(draft.country,'JP'); assert.equal(draft.zodiac,null);
  assert.equal(draft.identityZodiac,zodiacFor(2,29));
  assert.ok(!first.state_json.includes(birthA().date),'life authority stores no temporary DOB');
  h.now = addActive(first.started_at,LIFE_MS); await Fate.sweep(f.env,h.now);
  await h.refreshFate(); assert.equal(await c.refresh(),true,c.state.error);
  await submit(h,()=>c.prepareSave(birthB(),true),'profile-save');
  await h.refreshFate();
  const saved = await submit(h,()=>c.prepareBirthday('saved','TW',true),'birthday-start');
  const second = JSON.parse(f.one('SELECT state_json FROM rpg_fate_lives WHERE id=?',saved.result.result.lifeId).state_json);
  assert.equal(second.version,8); assert.equal(second.zodiac,zodiacFor(7,14));
  const wire = h.calls.filter(x=>x.action==='fate/private/action-scoped').at(-1).body;
  assert.equal(Object.hasOwn(wire,'birthDate'),false);
  assert.equal(f.one('SELECT count FROM rpg_fate_starts WHERE account_id=?',OWNER).count,2);
  assert.equal(f.one("SELECT COUNT(*) n FROM rpg_fate_lives WHERE status='complete'").n,1);
  assert.equal(f.one("SELECT COUNT(*) n FROM rpg_fate_lives WHERE status='active'").n,1);
});
