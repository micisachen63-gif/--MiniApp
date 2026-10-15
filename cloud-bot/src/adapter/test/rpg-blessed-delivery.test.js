import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpgFlow } from '../rpg-flow.js';

for (const source of ['elite', 'boss']) {
  test(`blessed scroll group notification: ${source}`, async () => {
    const sent = []; const calls = []; let queue = [{ id: 9701, target: 'group', kind: 'blessed_scroll', claimToken: 'blessed-test', payload: { name: '卷軸玩家', itemName: '受祝福的武器強化卷軸', source, boss: '星淵守護獸', elite: '菁英巨獸', map: '古老森林' } }];
    const store = { data: {}, save() {} };
    const client = { async call(path, body) { calls.push({path,body}); if (path === '/rpg/outbox/claim') { const items = queue; queue = []; return {ok:true, items}; } return {ok:true}; } };
    const flow = createRpgFlow({ api: { async call() { return true; } }, send: async (text, options, chatId) => { sent.push({text,chatId}); return {message_id: 981}; }, answer: async () => {}, log: { info() {}, warn() {} }, now: () => 150000, tgStore: store, inGroup: () => true, inUserPrivate: () => false, chatId: -12345, rpgApi: client, outboxEveryMs: 30000, photoGapMs: 6000, likeThrottleMs: 3000, appUrl: null });
    await flow.tick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].chatId, -12345);
    assert.match(sent[0].text, /受祝福的武器強化卷軸/);
    assert.match(sent[0].text, /成功率 \+10/);
    assert.match(sent[0].text, source === 'boss' ? /星淵守護獸/ : /菁英巨獸/);
    assert.ok(sent[0].text.includes('\n'), 'Telegram announcement should have readable line breaks');
    assert.ok(calls.some(x => x.path === '/rpg/outbox/ack'), 'delivery should be acknowledged');
  });
}
