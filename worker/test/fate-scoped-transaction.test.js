import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter } from '../src/services/player.js';
import * as Fate from '../src/services/fate.js';
import * as Gifts from '../src/services/fate-gifts.js';
import * as Shared from '../src/services/fate-shared.js';
import { operation, RECEIPT_TYPE } from '../src/services/fate-receipt.js';
import { advanceLife, LIFE_MS, CHOICE_MS, addActive } from '../public/fate/life.js';
import { fixture, NOW, OWNER, snapshot, changes, typedId, completeOriginal, syntheticCompletedHistory } from './fate-scene-fixture.js';

const error = code => e => e?.code === code;
const count = (f, table) => f.one('SELECT COUNT(*) n FROM ' + table).n;
const sameReadOnly = async (f, fn) => {
  const before = snapshot(f.db), n = changes(f.db), result = await fn();
  assert.deepEqual(snapshot(f.db), before); assert.equal(changes(f.db), n); return result;
};

test('canonical F1 uses explicit random/country/false/showSign and never persists private birthday input', async t => {
  const f = await fixture(t), b = f.body('start', { showSign: false });
  assert.deepEqual(operation('start', b, 'app').fields, { mode: 'random', country: 'TW', showSign: false, socialInvite: false });
  for (const change of [{ mode: 'birthday' }, { country: 'XX' }, { showSign: 0 }, { socialInvite: true }, { birthDate: '1990-01-01' }, { birth: null }, { profileRevision: 0 }])
    await sameReadOnly(f, async () => assert.rejects(f.run({ ...b, ...change }), error('fate_scene_input')));
  const r = await f.run({ ...b, accountId: 'forged', namespace: 'service', reward: 'forged' });
  assert.equal(r.receipt.requestKey, 'scene:app:' + b.requestId); assert.equal(r.accountId, OWNER);
  assert.deepEqual(r.receipt.costs, { dailyStarts: 1 }); assert.deepEqual(r.receipt.result, r.result);
  const stored = f.one('SELECT state_json FROM rpg_fate_lives WHERE id=?', r.result.lifeId);
  assert.equal(JSON.parse(stored.state_json).zodiac, null);
  assert.equal(count(f, 'rpg_fate_profiles'), 0);
  assert.equal(f.rows('SELECT note FROM rpg_ledger WHERE type=?', RECEIPT_TYPE).some(row => /birthDate|1990-01-01|forged/.test(row.note)), false);
});

test('pure overdue scene preserves persisted answers/completion and original future gift eligibility', async t => {
  const f = await fixture(t), start = await f.run(f.body('start')), row = f.one('SELECT * FROM rpg_fate_lives WHERE id=?', start.result.lifeId);
  const scene = await sameReadOnly(f, () => f.scene({ readSequence: 7 }, NOW + LIFE_MS + 1000));
  assert.equal(scene.readSequence, 7); assert.equal('scene' in scene, false);
  assert.deepEqual(scene.fate.state.active.draft, JSON.parse(row.state_json));
  const timing = scene.fate.state.active.timing;
  assert.equal(timing.completionDue, true); assert.equal(timing.settlementPending, true);
  assert.equal(advanceLife(scene.fate.state.active.draft, timing.storyAt).completed, false);
  assert.equal(advanceLife(scene.fate.state.active.draft, timing.storyAt).draft.answers.length, timing.persistedAnswerCount);
  assert.equal(scene.fate.state.completed, 0); assert.equal(scene.fate.gifts.earned, 0);
  assert.equal(scene.fate.state.last, null); assert.equal(scene.fate.control.startAllowed, false);
});

test('original start no-op has its own immutable original operation and receipt after the life completes', async t => {
  const f = await fixture(t), firstBody = f.body('start'), first = await f.run(firstBody),
    alreadyBody = f.body('start', { showSign: false }), already = await f.run(alreadyBody, NOW + 1);
  assert.deepEqual(already.result, { lifeId: first.result.lifeId, already: true });
  assert.deepEqual(already.receipt.costs, { dailyStarts: 0 }); assert.equal(count(f, 'rpg_fate_operations'), 2);
  assert.equal(f.one('SELECT count FROM rpg_fate_starts WHERE account_id=?', OWNER).count, 1);
  await Fate.sweep(f.env, NOW + LIFE_MS);
  for (const [body, result] of [[firstBody, first.result], [alreadyBody, already.result]]) {
    const read = await sameReadOnly(f, () => f.read(body, NOW + LIFE_MS + 1));
    assert.equal(read.found, true); assert.deepEqual(read.result, result);
    const replay = await sameReadOnly(f, () => f.run(body, NOW + LIFE_MS + 1));
    assert.equal(replay.replayed, true); assert.deepEqual(replay.result, result);
  }
});

for (const answer of [0, 1]) test('choice ' + answer + ' uses exact original life/index and remains readable after progression', async t => {
  const f = await fixture(t), life = await f.run(f.body('start')), first = f.firstChoice(life.result.lifeId),
    b = f.body('choice', { lifeId: life.result.lifeId, index: 0, answer });
  const scene = await sameReadOnly(f, () => f.scene({}, first.at));
  assert.equal(scene.fate.state.active.timing.available, true);
  const chosen = await f.run(b, first.at); assert.deepEqual(chosen.result, { lifeId: life.result.lifeId, index: 0, answer });
  assert.equal(f.one('SELECT rev FROM rpg_fate_lives WHERE id=?', life.result.lifeId).rev, 1);
  await Fate.sweep(f.env, NOW + LIFE_MS);
  assert.deepEqual((await sameReadOnly(f, () => f.read(b, NOW + LIFE_MS + 1))).result, chosen.result);
  assert.equal(JSON.parse(f.one('SELECT state_json FROM rpg_fate_lives WHERE id=?', life.result.lifeId).state_json).answers[0], answer);
});

test('versioned original engine rejects wrong index and expired choice without new operation', async t => {
  const f = await fixture(t), life = await f.run(f.body('start')), first = f.firstChoice(life.result.lifeId),
    b = f.body('choice', { lifeId: life.result.lifeId, index: 999, answer: 0 });
  await sameReadOnly(f, () => assert.rejects(f.run(b, first.at), error('fate_choice')));
  await sameReadOnly(f, () => assert.rejects(f.run({ ...b, index: 0 }, addActive(first.at, CHOICE_MS)), error('fate_choice')));
  assert.equal(count(f, 'rpg_fate_operations'), 1);
  for (const answer of [false, '0', 2]) await sameReadOnly(f, () =>
    assert.rejects(f.run({ ...b, index: 0, answer }, first.at), error('fate_scene_input')));
});

test('four original completed lives yield one exact claim/open and all historical receipts survive later state', async t => {
  const f = await fixture(t), starts = await completeOriginal(f, 4), now = NOW + 4 * LIFE_MS;
  const scene = await f.scene({}, now);
  assert.equal(scene.fate.state.completed, 4); assert.deepEqual(scene.fate.gifts.claimMilestones, [4]);
  const claimBody = f.body('gift-claim', { expectedMilestones: [4] }), claim = await f.run(claimBody, now),
    giftId = claim.result.giftIds[0], openBody = f.body('gift-open', { giftId }), opened = await f.run(openBody, now + 1);
  assert.equal(claim.result.claimed, 1); assert.equal(f.qty(Gifts.GIFT_ITEM), 0);
  assert.deepEqual(opened.receipt.costs, { fate_cycle_gift: 1 }); assert.equal(opened.result.giftId, giftId);
  for (const [item, qty] of Object.entries(opened.result.items)) assert.equal(f.qty(item), qty);
  const proof = await sameReadOnly(f, () => f.read(claimBody, now + 100));
  assert.deepEqual(proof.result, claim.result); assert.deepEqual(proof.receipt.proof.milestones, [4]);
  assert.equal((await f.read(openBody, now + 100)).found, true);
  assert.equal((await f.scene({ giftStatus: 'opened' }, now + 100)).fate.gifts.entries[0].id, giftId);
  const last = f.one("SELECT code FROM rpg_fate_lives WHERE char_id=? AND status='complete' ORDER BY started_at DESC LIMIT 1", f.tg),
    keepBody = f.body('keep', { code: last.code }), keep = await f.run(keepBody, now + 2);
  assert.deepEqual(keep.result, { saved: true, countsAsLife: false });
  assert.equal((await f.scene({}, now + 3)).fate.state.completed, 4);
  assert.equal((await f.read(keepBody, now + 4)).found, true);
  assert.equal(starts.length, 4);
});

test('empty exact claim is a durable original no-op, never a later surprise grant', async t => {
  const f = await fixture(t), b = f.body('gift-claim', { expectedMilestones: [] }), first = await f.run(b);
  assert.deepEqual(first.result, { claimed: 0, giftIds: [], remaining: 0 });
  assert.equal(count(f, 'rpg_fate_gift_operations'), 1); assert.equal(count(f, 'rpg_fate_gifts'), 0);
  syntheticCompletedHistory(f, 4);
  const replay = await sameReadOnly(f, () => f.run(b, NOW + 1));
  assert.deepEqual(replay.result, first.result); assert.equal(replay.replayed, true);
  assert.deepEqual((await f.scene()).fate.gifts.claimMilestones, [4]);
});

test('exact claim batch is bounded to original 25 and remaining milestones stay claimable', async t => {
  const f = await fixture(t); syntheticCompletedHistory(f, 108);
  const expected = Array.from({ length: 25 }, (_, i) => (i + 1) * 4);
  assert.deepEqual((await f.scene()).fate.gifts.claimMilestones, expected);
  const first = await f.run(f.body('gift-claim', { expectedMilestones: expected }));
  assert.equal(first.result.claimed, 25); assert.equal(first.result.remaining, 2);
  assert.deepEqual((await f.scene()).fate.gifts.claimMilestones, [104, 108]);
  assert.equal(f.qty(Gifts.GIFT_ITEM), 25);
  for (const milestones of [[8, 4], [4, 4], [3], Array.from({ length: 26 }, (_, i) => (i + 1) * 4)])
    await sameReadOnly(f, () => assert.rejects(f.run(f.body('gift-claim', { expectedMilestones: milestones })), error('fate_scene_input')));
});

test('claim confirmation refuses a changed milestone set before any write', async t => {
  const f = await fixture(t); syntheticCompletedHistory(f, 8);
  await sameReadOnly(f, () => assert.rejects(f.run(f.body('gift-claim', { expectedMilestones: [4] })), error('fate_claim_changed')));
  assert.equal(count(f, 'rpg_fate_gifts'), 0);
});

test('in-batch eligibility guard catches completion growth after callback before commit', async t => {
  const f = await fixture(t); syntheticCompletedHistory(f, 7);
  const original = f.db.batch.bind(f.db); let injected = false;
  f.db.batch = async stmts => {
    if (!injected && stmts.some(s => s.sql.startsWith("INSERT INTO rpg_fate_gifts("))) {
      injected = true;
      const row = f.one('SELECT * FROM rpg_fate_lives ORDER BY started_at DESC LIMIT 1');
      f.sql.prepare("INSERT INTO rpg_fate_lives(id,char_id,account_id,state_json,status,started_at,completed_at,next_at,code,rev) VALUES(?,?,?,?,'complete',?,?,?,?,1)")
        .run('concurrent-complete', f.tg, OWNER, row.state_json, NOW - 1000, NOW, NOW, row.code);
    }
    return original(stmts);
  };
  await assert.rejects(f.run(f.body('gift-claim', { expectedMilestones: [4] })), error('fate_claim_changed'));
  assert.equal(injected, true); assert.equal(count(f, 'rpg_fate_gifts'), 0);
  assert.equal(count(f, 'rpg_fate_gift_operations'), 0); assert.equal(f.qty(Gifts.GIFT_ITEM), 0);
  assert.deepEqual((await f.scene()).fate.gifts.claimMilestones, [4, 8]);
});

test('competing exact claims cannot duplicate or silently switch to an empty result', async t => {
  const f = await fixture(t); syntheticCompletedHistory(f, 4);
  const results = await Promise.allSettled([f.run(f.body('gift-claim', { expectedMilestones: [4] })),
    f.run(f.body('gift-claim', { expectedMilestones: [4] }))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected')[0].reason.code, 'fate_claim_changed');
  assert.equal(count(f, 'rpg_fate_gifts'), 1); assert.equal(f.qty(Gifts.GIFT_ITEM), 1);
});

test('same-ID concurrent claims return the same immutable IDs once', async t => {
  const f = await fixture(t); syntheticCompletedHistory(f, 8);
  const b = f.body('gift-claim', { expectedMilestones: [4, 8] }), results = await Promise.all([f.run(b), f.run(b)]);
  assert.deepEqual(results[0].result, results[1].result);
  assert.equal(count(f, 'rpg_fate_gifts'), 2); assert.equal(count(f, 'rpg_fate_gift_operations'), 1);
  assert.equal(f.rows('SELECT event_id FROM rpg_ledger WHERE type=?', RECEIPT_TYPE).length, 1);
});

test('open always binds one exact gift; competing requests never consume a later gift', async t => {
  const f = await fixture(t); syntheticCompletedHistory(f, 8);
  const claim = await f.run(f.body('gift-claim', { expectedMilestones: [4, 8] })),
    giftId = claim.result.giftIds[0], other = claim.result.giftIds[1];
  await sameReadOnly(f, () => assert.rejects(f.run(f.body('gift-open')), error('fate_scene_input')));
  const results = await Promise.allSettled([f.run(f.body('gift-open', { giftId })), f.run(f.body('gift-open', { giftId }))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected')[0].reason.code, 'fate_no_gift');
  assert.equal(f.one('SELECT status FROM rpg_fate_gifts WHERE id=?', other).status, 'claimed');
  assert.equal(f.qty(Gifts.GIFT_ITEM), 1);
});

test('lost final commit reply is recovered from exact original evidence without rerolling', async t => {
  const f = await fixture(t); syntheticCompletedHistory(f, 4);
  const claim = await f.run(f.body('gift-claim', { expectedMilestones: [4] })),
    b = f.body('gift-open', { giftId: claim.result.giftIds[0] }),
    original = f.db.batch.bind(f.db); let lost = false, opens = 0;
  f.db.batch = async stmts => {
    const opening = stmts.some(s => s.sql.startsWith("UPDATE rpg_fate_gifts SET status='opened'"));
    if (opening) opens++;
    const result = await original(stmts);
    if (opening && !lost) { lost = true; throw new Error('synthetic lost commit transport'); }
    return result;
  };
  const result = await f.run(b, NOW + 1), read = await sameReadOnly(f, () => f.read(b, NOW + 2)),
    replay = await sameReadOnly(f, () => f.run(b, NOW + 3));
  assert.deepEqual(read.result, result.result); assert.deepEqual(replay.result, result.result);
  assert.equal(replay.replayed, true); assert.equal(opens, 1);
  assert.equal(f.qty(Gifts.GIFT_ITEM), 0);
});

test('failed inventory consumption rolls back gift, typed receipt, original operation and all awards', async t => {
  const f = await fixture(t); syntheticCompletedHistory(f, 4);
  const claim = await f.run(f.body('gift-claim', { expectedMilestones: [4] })),
    b = f.body('gift-open', { giftId: claim.result.giftIds[0] });
  f.sql.prepare('UPDATE rpg_inventory SET quantity=0 WHERE tg_id=? AND item=?').run(f.tg, Gifts.GIFT_ITEM);
  const before = snapshot(f.db);
  await assert.rejects(f.run(b, NOW + 1));
  assert.deepEqual(snapshot(f.db), before); assert.equal((await f.read(b)).found, false);
});

test('reused request body, false/zero distinctions and trusted namespaces remain exact', async t => {
  const f = await fixture(t), b = f.body('start', { showSign: false }), result = await f.run(b);
  await sameReadOnly(f, () => assert.rejects(f.run({ ...b, showSign: true }), error('request_reused')));
  await sameReadOnly(f, () => assert.rejects(f.read({ ...b, country: 'JP' }), error('request_reused')));
  const service = await sameReadOnly(f, () => f.read({ ...b, namespace: 'app' }, NOW, 'service'));
  assert.equal(service.found, false); assert.equal(service.recoveryAllowed, true);
  assert.equal((await f.read({ ...b, namespace: 'service' })).result.lifeId, result.result.lifeId);
});

test('missing typed proof with existing original operation blocks recovery and is SELECT-only', async t => {
  const f = await fixture(t), b = f.body('start'); await f.run(b);
  f.sql.prepare('DELETE FROM rpg_ledger WHERE event_id=?').run(typedId(b));
  const missing = await sameReadOnly(f, () => f.read(b, NOW + LIFE_MS));
  assert.equal(missing.found, false); assert.equal(missing.recoveryAllowed, false);
  await sameReadOnly(f, () => assert.rejects(f.run(b, NOW + LIFE_MS), error('fate_receipt_unverified')));
});

for (const corruption of ['original-result', 'typed-scope', 'typed-result', 'original-hash']) test('corrupt ' + corruption + ' never becomes a successful or retryable receipt', async t => {
  const f = await fixture(t), b = f.body('start'); await f.run(b);
  if (corruption === 'original-result') f.sql.prepare('UPDATE rpg_fate_operations SET result_json=?').run('{"lifeId":"wrong"}');
  else if (corruption === 'original-hash') f.sql.prepare('UPDATE rpg_fate_operations SET payload_hash=?').run('0'.repeat(64));
  else {
    const row = f.one('SELECT note FROM rpg_ledger WHERE event_id=?', typedId(b)), note = JSON.parse(row.note);
    if (corruption === 'typed-scope') note.scope.accountId = 'other';
    else note.result.lifeId = 'wrong';
    f.sql.prepare('UPDATE rpg_ledger SET note=? WHERE event_id=?').run(JSON.stringify(note), typedId(b));
  }
  await sameReadOnly(f, () => assert.rejects(f.read(b), error('fate_receipt_corrupt')));
  await sameReadOnly(f, () => assert.rejects(f.run(b), error('fate_receipt_corrupt')));
});

test('claim/open ledger corruption is rejected after the gift has already been consumed', async t => {
  const f = await fixture(t); syntheticCompletedHistory(f, 4);
  const claimBody = f.body('gift-claim', { expectedMilestones: [4] }), claim = await f.run(claimBody),
    b = f.body('gift-open', { giftId: claim.result.giftIds[0] }); await f.run(b, NOW + 1);
  f.sql.prepare('DELETE FROM rpg_ledger WHERE event_id=?').run('fate-gift:consume:' + b.giftId);
  await sameReadOnly(f, () => assert.rejects(f.read(b), error('fate_receipt_corrupt')));
  assert.equal((await f.read(claimBody)).found, true);
  f.sql.prepare('DELETE FROM rpg_ledger WHERE event_id=?').run('fate-gift:claim:' + b.giftId);
  await sameReadOnly(f, () => assert.rejects(f.read(claimBody), error('fate_receipt_corrupt')));
});

test('cross-character account-key reuse cannot forge ownership or create a second life', async t => {
  const f = await fixture(t), b = f.body('start'); await f.run(b); const other = await f.addActor(); f.active(other);
  await sameReadOnly(f, () => assert.rejects(f.read(b), error('character_changed')));
  const otherBody = { ...b, selectedCharacterId: other };
  const miss = await sameReadOnly(f, () => f.read(otherBody));
  assert.equal(miss.found, false); assert.equal(miss.recoveryAllowed, false);
  await sameReadOnly(f, () => assert.rejects(f.run(otherBody), error('fate_receipt_unverified')));
  assert.equal(count(f, 'rpg_fate_lives'), 1);
});

test('life, memorial, profile, daily and social revisions change domain freshness without player rev', async t => {
  const f = await fixture(t), start = await f.run(f.body('start')), scene = await f.scene(), revision = scene.revision;
  const first = f.firstChoice(start.result.lifeId);
  await f.run(f.body('choice', { lifeId: start.result.lifeId, index: 0, answer: 0 }), first.at);
  let next = await f.scene({}, first.at); assert.equal(next.revision, revision);
  assert.notEqual(next.fate.domain.token, scene.fate.domain.token); assert.equal(next.fate.domain.life.rev, 1);
  const tokens = [next.fate.domain.token];
  await Fate.saveProfile(f.env, f.tg, { requestId: 'legacy-profile-one', consent: true, birth: { date: '1990-01-01' } }, first.at + 1);
  next = await f.scene({}, first.at + 1); tokens.push(next.fate.domain.token);
  assert.equal(JSON.stringify(next).includes('1990-01-01'), false);
  await Fate.daily(f.env, f.tg, first.at + 2);
  next = await f.scene({}, first.at + 2); tokens.push(next.fate.domain.token);
  await Fate.deleteProfile(f.env, f.tg, { requestId: 'legacy-profile-delete' }, first.at + 3);
  next = await f.scene({}, first.at + 3); tokens.push(next.fate.domain.token);
  await Shared.savePreferences(f.env, f.tg, { requestId: 'legacy-social-pref', enabled: false, allowMentions: false, consent: true }, first.at + 4);
  next = await f.scene({}, first.at + 4); tokens.push(next.fate.domain.token);
  assert.equal(new Set(tokens).size, tokens.length); assert.equal(next.revision, revision);
  assert.equal(JSON.stringify(next).includes('birth'), false);
});

test('scene retries one concurrent domain revision then refuses persistent races without own writes', async t => {
  const f = await fixture(t); await f.run(f.body('start'));
  const original = f.db.batch.bind(f.db); let arrivals = 0, enabled = true;
  f.db.batch = async stmts => {
    const result = await original(stmts);
    if (enabled && stmts.some(s => s.sql.includes('MAX(started_at)'))) {
      arrivals++;
      f.sql.prepare('UPDATE rpg_fate_lives SET rev=rev+1 WHERE char_id=?').run(f.tg);
    }
    return result;
  };
  const beforeOps = count(f, 'rpg_fate_operations'), beforeOutbox = count(f, 'rpg_outbox');
  await assert.rejects(f.scene(), error('fate_snapshot_changed'));
  assert.equal(arrivals, 4); assert.equal(count(f, 'rpg_fate_operations'), beforeOps); assert.equal(count(f, 'rpg_outbox'), beforeOutbox);
  enabled = false;
  const read = await sameReadOnly(f, () => f.scene({ readSequence: 9 }));
  assert.equal(read.readSequence, 9); assert.equal(read.fate.domain.life.rev, arrivals);
});

test('archive/gift pagination keeps actual completed lives separate from cosmetic memorials', async t => {
  const f = await fixture(t); syntheticCompletedHistory(f, 48);
  const first = await f.scene(), second = await f.scene({ before: first.fate.history.next });
  assert.equal(first.fate.history.entries.length, 10); assert.equal(second.fate.history.entries.length, 10);
  assert.equal(new Set([...first.fate.history.entries, ...second.fate.history.entries].map(row => row.id)).size, 20);
  const b = f.body('keep', { code: first.fate.history.entries[0].code }); await f.run(b);
  const after = await f.scene(); assert.equal(after.fate.state.completed, 48); assert.equal(after.fate.history.memorials.length, 1);
  assert.equal(after.fate.history.receipts.some(row => row.requestKey === 'scene:app:' + b.requestId), true);
  assert.equal((await f.scene({}, NOW, 'service')).fate.history.receipts.length, 0);
});

for (const kind of ['start', 'choice', 'keep', 'gift-claim', 'gift-open']) test('actor switch at original ' + kind + ' authority batch rolls back that whole write', async t => {
  const f = await fixture(t), other = await f.addActor(); f.active(f.tg);
  let b, now = NOW, match;
  if (kind === 'start') { b = f.body(kind); match = 'INSERT INTO rpg_fate_starts'; }
  else if (kind === 'choice') {
    const started = await f.run(f.body('start')), first = f.firstChoice(started.result.lifeId);
    b = f.body(kind, { lifeId: started.result.lifeId, index: 0, answer: 0 }); now = first.at; match = 'UPDATE rpg_fate_lives SET';
  } else if (kind === 'keep') {
    syntheticCompletedHistory(f, 1); b = f.body(kind, { code: f.one('SELECT code FROM rpg_fate_lives').code }); match = 'INSERT OR IGNORE INTO rpg_fate_memorials';
  } else {
    syntheticCompletedHistory(f, 4);
    if (kind === 'gift-claim') { b = f.body(kind, { expectedMilestones: [4] }); match = 'INSERT INTO rpg_fate_gifts('; }
    else {
      const claim = await f.run(f.body('gift-claim', { expectedMilestones: [4] }));
      b = f.body(kind, { giftId: claim.result.giftIds[0] }); match = "UPDATE rpg_fate_gifts SET status='opened'";
    }
  }
  const original = f.db.batch.bind(f.db), before = snapshot(f.db); let switched = false;
  f.db.batch = async stmts => {
    if (!switched && stmts.some(s => s.sql.startsWith(match))) { switched = true; f.active(other); }
    return original(stmts);
  };
  await assert.rejects(f.run(b, now), error('character_changed'));
  assert.equal(switched, true); f.active(f.tg);
  assert.deepEqual(snapshot(f.db), before);
  assert.equal((await f.read(b, now)).found, false);
});

test('start preflight progression is guarded independently before its new life transaction', async t => {
  const f = await fixture(t), old = await f.run(f.body('start')), other = await f.addActor(); f.active(f.tg);
  const original = f.db.batch.bind(f.db); let switched = false;
  f.db.batch = async stmts => {
    if (!switched && stmts.some(s => s.sql.startsWith('UPDATE rpg_fate_lives SET'))) { switched = true; f.active(other); }
    return original(stmts);
  };
  await assert.rejects(f.run(f.body('start'), NOW + LIFE_MS), error('character_changed'));
  assert.equal(switched, true); assert.equal(f.one('SELECT status FROM rpg_fate_lives WHERE id=?', old.result.lifeId).status, 'active');
  assert.equal(count(f, 'rpg_fate_lives'), 1); assert.equal(count(f, 'rpg_fate_operations'), 1);
});

test('postcommit cast write is actor-guarded while a committed original start stays recoverable', async t => {
  const f = await fixture(t), other = await f.addActor();
  const foreign = await createCharacter(f.env, { tgId: '19862', name: '同行測乙', baseClass: 'sword', gender: 'm' }, NOW);
  f.active(f.tg); f.env.GROUP_CHAT_ID = '-10019861';
  f.env.FATE_SOCIAL_MEMBERSHIP = async accounts => ({ ok: true, members: accounts.map(accountId => ({ accountId, member: true })) });
  await Shared.savePreferences(f.env, foreign.char.tg_id, { requestId: 'foreign-optin-test', enabled: true, allowMentions: true, consent: true }, NOW);
  const original = f.db.batch.bind(f.db), body = f.body('start'); let switched = false;
  f.db.batch = async stmts => {
    if (!switched && stmts.some(s => s.sql.startsWith('INSERT INTO rpg_fate_social_limits'))) { switched = true; f.active(other); }
    return original(stmts);
  };
  await assert.rejects(f.run(body), error('character_changed'));
  assert.equal(switched, true); assert.equal(count(f, 'rpg_fate_lives'), 1);
  assert.equal(f.rows("SELECT * FROM rpg_outbox WHERE kind='fate_cast'").length, 0);
  f.active(f.tg);
  const receipt = await sameReadOnly(f, () => f.read(body, NOW + 1));
  assert.equal(receipt.found, true); assert.deepEqual(receipt.receipt.costs, { dailyStarts: 1 });
});

test('original gift open retains its fifth RNG parameter with the new private sixth hook absent', async t => {
  const f = await fixture(t); syntheticCompletedHistory(f, 4);
  const claim = await Gifts.claim(f.env, f.tg, { requestId: 'legacy-claim-compat' }, NOW);
  const body = { requestId: 'legacy-open-compat', giftId: claim.result.giftIds[0] },
    result = await Gifts.open(f.env, f.tg, body, NOW + 1, () => 0.05);
  assert.equal(result.result.reward, 'armor');
  const replay = await Gifts.open(f.env, f.tg, body, NOW + 2, () => { throw new Error('never reroll legacy'); });
  assert.deepEqual(replay.result, result.result); assert.equal(replay.replayed, true);
  assert.equal(f.rows('SELECT * FROM rpg_ledger WHERE type=?', RECEIPT_TYPE).length, 0);
});

test('existing birthday lives remain readable without exposing the stored birth profile or birthDate', async t => {
  const f = await fixture(t), birthDate = '1990-01-01';
  await Fate.saveProfile(f.env, f.tg, { requestId: 'legacy-private-profile', consent: true, birth: { date: birthDate } }, NOW);
  const original = await Fate.start(f.env, f.tg, { requestId: 'legacy-private-birthday', mode: 'birthday',
    birthDate, showSign: false, socialInvite: false }, NOW);
  const active = await sameReadOnly(f, () => f.scene());
  assert.equal(active.fate.state.active.id, original.result.lifeId);
  assert.equal(active.fate.state.active.draft.zodiac, null);
  assert.deepEqual(Object.keys(active.fate.domain.profile).sort(), ['rev', 'updatedAt']);
  for (const prohibited of [birthDate, '"birthDate"', '"birth_json"', '"chart_json"'])
    assert.equal(JSON.stringify(active).includes(prohibited), false, prohibited);
  await Fate.sweep(f.env, NOW + LIFE_MS);
  const history = await sameReadOnly(f, () => f.scene({}, NOW + LIFE_MS));
  assert.equal(history.fate.state.last.id, original.result.lifeId);
  assert.equal(history.fate.history.entries[0].id, original.result.lifeId);
  for (const prohibited of [birthDate, '"birthDate"', '"birth_json"', '"chart_json"'])
    assert.equal(JSON.stringify(history).includes(prohibited), false, prohibited);
});
