import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpgFlow } from '../rpg-flow.js';

const CHAT = -12345;
const share = (id) => ({ id, kind: 'share', ownerName: '測試玩家', item: { name: '測試長劍', slot: 'weapon', slotName: '武器', statName: 'ATK', stat: 10, rarityName: '普通', classReq: 'any', tier: 1, levelReq: 1 }, tradeable: true, likes: 0 });
function setup({ pending = [], initial = {}, failSend = 0, failEdit = 0 } = {}) {
  const clock = { value: 100000 };
  const data = { rpg: { drafts: {}, cards: {}, scards: {}, pcards: {}, pq: pending, ...initial } };
  const store = { data, saves: 0, save() { this.saves++; } };
  const calls = []; const sends = [];
  let msgId = 500; let sendFailures = failSend; let editFailures = failEdit;
  const api = { async call(method, body) {
    calls.push({ method, body });
    if (method === 'editMessageReplyMarkup') {
      if (editFailures-- > 0) throw new Error('fetch failed');
      return true;
    }
    return true;
  } };
  let claimed = [];
  const rpgApi = { async call(path, body) {
    calls.push({ path, body });
    if (path === '/rpg/outbox/claim') { const items = claimed; claimed = []; return { ok: true, items }; }
    if (path === '/rpg/share/get') return { ok: true, share: share(body.shareId) };
    return { ok: true };
  } };
  const send = async (text, options, chatId) => {
    sends.push({ text, options, chatId });
    if (sendFailures-- > 0) throw new Error('Telegram temporarily unavailable');
    return { message_id: ++msgId };
  };
  const flow = createRpgFlow({ api, send, answer: async () => {}, log: { info() {}, warn() {} }, now: () => clock.value, tgStore: store, inGroup: (chat) => String(chat?.id) === String(CHAT), inUserPrivate: () => false, chatId: CHAT, rpgApi, outboxEveryMs: 30000, photoGapMs: 6000, likeThrottleMs: 3000, appUrl: null });
  return { flow, data: data.rpg, store, clock, calls, sends, claim: (items) => { claimed = items; } };
}

test('RPG: background enhancement completion is sent privately and only then acknowledged',async()=>{
  const t=setup();t.claim([{id:31,target:'dm',tgId:'111',kind:'auto_enhance_end',claimToken:'test-token',payload:{itemName:'月桂短劍',target:5,level:5,attempts:8,spentGold:500,spentScrolls:8,reason:'target'}}]);
  await t.flow.tick();assert.equal(t.sends.length,1);assert.equal(t.sends[0].chatId,'111');assert.match(t.sends[0].text,/願望成真/);assert.match(t.sends[0].text,/共強化 8 次/);assert.ok(t.calls.some(c=>c.path==='/rpg/outbox/ack'&&c.body.ids.includes(31)));
});
test('RPG: failed notification reports its leased item for backoff without acknowledging delivery',async()=>{
 const t=setup({failSend:1});t.claim([{id:32,target:'dm',tgId:'111',kind:'auto_enhance_end',claimToken:'test-token',payload:{itemName:'月桂短劍',target:5,level:3,attempts:3,spentGold:0,spentScrolls:3,reason:'resources'}}]);await t.flow.tick();assert.ok(t.calls.some(c=>c.path==='/rpg/outbox/fail'&&c.body.ids.includes(32)));assert.ok(!t.calls.some(c=>c.path==='/rpg/outbox/ack'&&c.body.ids.includes(32)));
});
test('RPG: alternate-character trade notification names the other player',async()=>{
 const t=setup();t.claim([{id:33,target:'dm',tgId:'111',kind:'trade_open',claimToken:'test-token',payload:{recipientCharId:'c111',trade:{id:'trade',a:{tgId:'c111',name:'我的分身'},b:{tgId:'222',name:'真正對方'}}}}]);await t.flow.tick();assert.match(t.sends[0].text,/真正對方 確認/);assert.doesNotMatch(t.sends[0].text,/我的分身 確認/);
});
test('RPG: single share remains queued after Telegram failure and is delivered on retry', async () => {
  const t = setup({ failSend: 1 });
  t.claim([{ id: 1, target: 'group', kind: 'share', payload: { share: share('s1') }, claimToken: 'test-token' }]);
  await t.flow.tick();
  assert.equal(t.data.pq.length, 1, 'failed share remains persisted');
  assert.equal(Object.keys(t.data.scards).length, 0);
  t.clock.value += 7000;
  await t.flow.tick();
  assert.equal(t.data.pq.length, 0, 'successful retry removes share');
  assert.equal(t.data.scards.s1.messageId, 501);
  assert.equal(t.sends.length, 2);
});

test('RPG: failed send preserves every share until its individual card is delivered', async () => {
  const t = setup({ pending: [1, 2, 3, 4, 5].map((x) => share('s' + x)), failSend: 1 });
  await t.flow.tick();
  assert.equal(t.data.pq.length, 5, 'a failed send must not discard queued shares');
  for(let i=0;i<5;i++){
    t.clock.value += 7000;
    await t.flow.tick();
    assert.equal(t.data.pq.length,4-i);
    assert.ok(t.data.scards['s'+(i+1)]?.messageId,'each item retains its own actionable card');
  }
  assert.equal(t.data.pq.length, 0);
  assert.equal(t.sends.length, 6,'one failed attempt plus five separate item cards');
});

test('RPG: failed share-card edit stays dirty and retries successfully', async () => {
  const t = setup({ initial: { scards: { s1: { chatId: CHAT, messageId: 99, photo: false, lastEdit: 0, at: 100000 } } }, failEdit: 2 });
  t.claim([{ id: 2, target: 'group', kind: 'share_update', payload: { share: share('s1') }, claimToken: 'test-token' }]);
  await t.flow.tick();
  assert.equal(t.data.scards.s1.lastEdit, 0, 'failed edit must not mark success');
  t.clock.value += 4000;
  await t.flow.tick();
  assert.equal(t.data.scards.s1.lastEdit, t.clock.value, 'retry updates card timestamp');
  assert.equal(t.calls.filter((c) => c.method === 'editMessageReplyMarkup').length, 3);
});

test('RPG: duplicated share outbox does not enqueue the same item twice', async () => {
  const t = setup({ pending: [share('s1')] });
  t.claim([{ id: 3, target: 'group', kind: 'share', payload: { share: share('s1') }, claimToken: 'test-token' }]);
  await t.flow.tick();
  assert.equal(t.sends.length, 1, 'existing pending share is posted only once');
  assert.equal(t.data.pq.length, 0);
});
