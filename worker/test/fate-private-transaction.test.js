import test from 'node:test';
import assert from 'node:assert/strict';
import * as Fate from '../src/services/fate.js';
import * as PrivateReceipt from '../src/services/fate-private-receipt.js';
import { operation as f1Operation } from '../src/services/fate-receipt.js';
import { createCharacter } from '../src/services/player.js';
import { LIFE_MS } from '../public/fate/life.js';
import { fixture, NOW, OWNER, error, publicBody, readOnly, syntheticBoss } from './fate-private-fixture.js';

const simpleBirth = () => ({ date: '1998-11-03', time: null, placeId: null, sex: null });
const completeBirth = () => ({ date: '1998-11-03', time: '10:30', placeId: 'taipei', sex: 'f', fold: 'earlier' });
const noPrivate = value => {
  const s = JSON.stringify(value);
  assert.ok(!/1998-11-03|2017-06-21|birthDate|birth_json|chart_json|payloadHash|payload_hash|notes_json|placeId|10:30/.test(s),
    'private input or internal hash escaped public metadata');
};
const operationRow = (f, b) => f.one('SELECT * FROM rpg_fate_operations WHERE account_id=? AND request_id=?', OWNER, 'private:app:' + b.requestId);
const withBatch = (f, t, hook) => {
  const original = f.db.batch.bind(f.db);
  f.db.batch = async statements => { await hook(statements); return original(statements); };
  t.after(() => { f.db.batch = original; });
};

test('F2 canonical is stable public metadata, preserves zero/false/null and F1 still rejects private input', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: simpleBirth() }),
    op = PrivateReceipt.operation(b.kind, b, 'app', true);
  noPrivate(op); assert.equal(op.request, 'private:app:' + b.requestId);
  const reordered = { ...b, expected: { daily: { createdAt: null, rev: 0, materialized: false, day: b.expected.daily.day },
    profile: { updatedAt: null, rev: 0, saved: false }, generation: 0 } };
  assert.equal(PrivateReceipt.operation(b.kind, reordered, 'app', true).signature, op.signature);
  assert.throws(() => f1Operation('start', { requestId: 'f2-check-f1', mode: 'random', country: 'TW',
    showSign: false, socialInvite: false, birth: simpleBirth() }), error('fate_scene_input'));
  for (const change of [{ consent: false }, { consent: undefined }]) await readOnly(f, () =>
    assert.rejects(f.privateRun({ ...b, ...change }), error('birth_consent')));
  for (const change of [{ intentNonce: 'guess' }, { birth: { ...simpleBirth(), guessedAge: 28 } },
    { expected: { ...b.expected, generation: -1 } }, { chart: {} }]) await readOnly(f, () =>
    assert.rejects(f.privateRun({ ...b, ...change }), error('fate_private_input')));
});

test('all private views and missing receipt stay pure with overdue life, available evidence and absent daily', async t => {
  const f = await fixture(t); await f.run(f.body('start')); syntheticBoss(f);
  const b = await f.prepare('profile-save', { birth: simpleBirth() });
  await readOnly(f, async () => {
    const view = await f.privateScene({ readSequence: 17 }, NOW + LIFE_MS);
    assert.equal(view.readSequence, 17); assert.equal(view.privateFate.daily.materialized, false);
    assert.equal(view.privateFate.daily.notes.length, 0); assert.equal(view.privateFate.evidence.pending.length, 1);
    assert.equal('birth' in view.privateFate.profile, false); assert.equal('scene' in view, false);
    assert.equal((await f.profile({}, NOW + LIFE_MS)).privateProfile.profile.saved, false);
    const receipt = await f.privateRead(b, NOW + LIFE_MS);
    assert.equal(receipt.found, false); assert.equal(receipt.recoveryAllowed, true); noPrivate(receipt);
    await assert.rejects(PrivateReceipt.view(f.env, f.tg, b, NOW, 'app'), error('fate_private_input'));
  });
  assert.equal(f.count('rpg_fate_daily'), 0);
  assert.equal(f.one("SELECT status FROM rpg_fate_lives WHERE char_id=?", f.tg).status, 'active');
});

test('profile save is account-owned consented authority with metadata-only history and exact private replay', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: simpleBirth() }), resources = f.resources(),
    result = await f.privateRun(b);
  assert.deepEqual(result.result, { saved: true, coverage: 'inspiration' }); noPrivate(result);
  assert.equal(f.resources(), resources); assert.equal(f.count('rpg_fate_operations'), 1);
  assert.equal(f.count('rpg_fate_profiles'), 1);
  const internal = operationRow(f, b), proof = JSON.parse(internal.result_json);
  assert.equal(proof.payloadHash, internal.payload_hash);
  assert.equal(proof.proofId, result.receipt.authority.proofId);
  assert.ok(!internal.result_json.includes(b.birth.date), 'authority metadata copied raw birth');
  const view = await readOnly(f, () => f.privateScene());
  noPrivate(view.privateFate.history); noPrivate(view.privateFate.domain);
  const h = view.privateFate.history.receipts[0];
  assert.equal(h.requestId, b.requestId); assert.equal(h.intent.expected.generation, 0);
  const detail = await readOnly(f, () => f.profile());
  assert.ok(detail.privateProfile.profile.birth.date === b.birth.date);
  assert.equal(detail.privateProfile.profile.birth.sex, null);
  assert.equal(detail.privateProfile.profile.birth.complete, false);
  const replay = await readOnly(f, () => f.privateRun(b, NOW + 1000));
  assert.deepEqual(replay.result, result.result); assert.equal(replay.replayed, true);
  await readOnly(f, () => assert.rejects(f.privateRun({ ...b, birth: { ...b.birth, date: '2017-06-21' } }), error('request_changed')));
  await readOnly(f, () => assert.rejects(f.privateRun({ ...b, intentNonce: 'f'.repeat(32) }), error('request_reused')));
  const another = await f.addActor(); f.active(another);
  const sameAccount = await readOnly(f, () => f.profile({ selectedCharacterId: another }));
  assert.equal(sameAccount.privateProfile.profile.saved, true);
  assert.ok(sameAccount.privateProfile.profile.birth.date === b.birth.date);
  await readOnly(f, () => assert.rejects(f.privateRead(b), error('character_changed')));
});

test('complete custom birth preserves explicit zero coordinates and sex; young synthetic date uses same private contract', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save',
    { birth: { date: '2017-06-21', time: '00:00', placeId: 'custom', lat: 0, lon: 0, zone: 'UTC', placeLabel: '合成出生地', sex: 'm' } });
  const saved = await f.privateRun(b); assert.equal(saved.result.coverage, 'three-traditions'); noPrivate(saved);
  const p = (await f.profile()).privateProfile.profile;
  assert.equal(p.birth.place.lat, 0); assert.equal(p.birth.place.lon, 0); assert.equal(p.birth.sex, 'm');
  assert.equal('age' in p, false); assert.equal('minor' in p, false);
  const f1 = await readOnly(f, () => f.scene()); noPrivate(f1);
});

test('save update keeps current daily notes, delete clears all private rows and historic receipts do not restore them', async t => {
  const f = await fixture(t), save = await f.prepare('profile-save', { birth: completeBirth() }), s = await f.privateRun(save);
  syntheticBoss(f);
  const sync = await f.prepare('daily-sync'), d = await f.privateRun(sync), notes = f.one('SELECT notes_json FROM rpg_fate_daily WHERE account_id=?', OWNER).notes_json;
  noPrivate(d); assert.equal(d.result.unlocked, 1);
  const update = await f.prepare('profile-save', { birth: simpleBirth() }); await f.privateRun(update, NOW + 20);
  assert.ok(f.one('SELECT notes_json FROM rpg_fate_daily WHERE account_id=?', OWNER).notes_json === notes);
  const erase = await f.prepare('profile-delete'), deleted = await f.privateRun(erase, NOW + 30);
  assert.equal(f.count('rpg_fate_profiles'), 0); assert.equal(f.count('rpg_fate_daily'), 0);
  for (const [body, original] of [[save, s], [sync, d], [erase, deleted]]) await readOnly(f, async () => {
    const found = await f.privateRead(body, NOW + 40); assert.deepEqual(found.result, original.result); noPrivate(found);
  });
  const recreated = await f.prepare('profile-save', { birth: completeBirth() }); await f.privateRun(recreated, NOW + 50);
  const before = f.digest(); await f.privateRun(erase, NOW + 60);
  assert.equal(f.digest(), before); assert.equal(f.count('rpg_fate_profiles'), 1, 'old delete replay erased new consent');
  assert.deepEqual((await f.privateRead(save)).result, s.result);
});

test('operation generation catches exact equal-time/equal-rev legacy delete/recreate ABA', async t => {
  const f = await fixture(t);
  await Fate.saveProfile(f.env, f.tg, { requestId: 'legacy-save-before', consent: true, birth: simpleBirth() }, NOW);
  const stale = await f.prepare('profile-delete'), initial = f.one('SELECT birth_json,chart_json,rev,updated_at FROM rpg_fate_profiles WHERE account_id=?', OWNER);
  await Fate.deleteProfile(f.env, f.tg, { requestId: 'legacy-erase-middle' }, NOW);
  await Fate.saveProfile(f.env, f.tg, { requestId: 'legacy-save-after', consent: true, birth: simpleBirth() }, NOW);
  assert.ok(JSON.stringify(f.one('SELECT birth_json,chart_json,rev,updated_at FROM rpg_fate_profiles WHERE account_id=?', OWNER)) === JSON.stringify(initial));
  const current = (await f.privateScene()).privateFate.domain;
  assert.equal(current.generation, stale.expected.generation + 2);
  await readOnly(f, () => assert.rejects(f.privateRun(stale), error('fate_private_changed')));
  const cancelled = await f.cancel(stale); assert.equal(cancelled.outcome, 'cancelled');
  assert.equal(f.count('rpg_fate_profiles'), 1, 'cancelling stale delete applied it');
});

test('two independently confirmed saves and save/delete races cannot silently overwrite the first commit', async t => {
  const f = await fixture(t), a = await f.prepare('profile-save', { birth: simpleBirth() }),
    b = await f.prepare('profile-save', { birth: completeBirth() });
  const settled = await Promise.allSettled([f.privateRun(a), f.privateRun(b)]);
  assert.equal(settled.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(f.count('rpg_fate_profiles'), 1); assert.equal(f.count('rpg_fate_operations'), 1);
  const c = await f.prepare('profile-save', { birth: simpleBirth() }), d = await f.prepare('profile-delete');
  const race = await Promise.allSettled([f.privateRun(c), f.privateRun(d)]);
  assert.equal(race.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(f.count('rpg_fate_operations'), 2);
});

for (const kind of ['profile-save', 'profile-delete', 'daily-sync', 'birthday-start']) test(kind + ' authority rows and receipts roll back together on typed receipt failure', async t => {
  const f = await fixture(t);
  if (kind === 'profile-delete') await f.privateRun(await f.prepare('profile-save', { birth: simpleBirth() }));
  const fields = kind === 'profile-save' ? { birth: simpleBirth() } : kind === 'birthday-start' ? { birthDate: simpleBirth().date } : {};
  const b = await f.prepare(kind, fields), before = f.digest();
  f.sql.exec("CREATE TRIGGER synthetic_private_receipt_failure BEFORE INSERT ON rpg_ledger WHEN NEW.type='命運私人操作收據' BEGIN SELECT RAISE(ABORT,'synthetic receipt fault'); END");
  await assert.rejects(f.privateRun(b), /synthetic receipt fault/);
  assert.equal(f.digest(), before); assert.equal(operationRow(f, b), undefined);
  assert.equal(f.one('SELECT event_id FROM rpg_ledger WHERE event_id=?', f.typedId(b)), undefined);
});

for (const kind of ['profile-save', 'profile-delete', 'daily-sync', 'birthday-start']) test(kind + ' commit with lost reply recovers exact original metadata without replay', async t => {
  const f = await fixture(t);
  if (kind === 'profile-delete') await f.privateRun(await f.prepare('profile-save', { birth: simpleBirth() }));
  const fields = kind === 'profile-save' ? { birth: simpleBirth() } : kind === 'birthday-start' ? { birthDate: simpleBirth().date } : {};
  const b = await f.prepare(kind, fields), original = f.db.batch.bind(f.db); let lost = false;
  f.db.batch = async statements => {
    const result = await original(statements);
    if (!lost && statements.some(s => s.sql.startsWith('INSERT INTO rpg_fate_operations') && s.params[1] === 'private:app:' + b.requestId)) {
      lost = true; throw new Error('synthetic commit reply lost');
    }
    return result;
  };
  t.after(() => { f.db.batch = original; });
  const recovered = await f.privateRun(b); assert.equal(lost, true); assert.equal(recovered.outcome, 'committed');
  noPrivate(recovered);
  const count = f.count('rpg_fate_operations');
  await readOnly(f, async () => {
    const found = await f.privateRead(publicBody(b), NOW + 1000);
    assert.deepEqual(found.receipt, recovered.receipt);
    assert.deepEqual((await f.privateRun(b, NOW + 1000)).result, recovered.result);
  });
  assert.equal(f.count('rpg_fate_operations'), count);
});

for (const kind of ['profile-save', 'profile-delete', 'daily-sync', 'birthday-start']) test(kind + ' every authority write uses captured actor guard', async t => {
  const f = await fixture(t), second = await f.addActor(); f.active(f.tg);
  if (kind === 'profile-delete') await f.privateRun(await f.prepare('profile-save', { birth: simpleBirth() }));
  const fields = kind === 'profile-save' ? { birth: simpleBirth() } : kind === 'birthday-start' ? { birthDate: simpleBirth().date } : {},
    b = await f.prepare(kind, fields); let changed = false;
  withBatch(f, t, statements => {
    if (!changed && statements.some(s => s.sql.startsWith('INSERT INTO rpg_fate_operations') && s.params[1] === 'private:app:' + b.requestId)) {
      changed = true; f.active(second);
    }
  });
  await assert.rejects(f.privateRun(b), error('character_changed'));
  assert.equal(changed, true); assert.equal(operationRow(f, b), undefined);
  assert.equal(f.one('SELECT event_id FROM rpg_ledger WHERE event_id=?', f.typedId(b)), undefined);
});

test('cancel seals a lost-memory never-sent ID, survives later generation/day changes, and blocks late private body', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: completeBirth() });
  await Fate.saveProfile(f.env, f.tg, { requestId: 'legacy-after-confirm', consent: true, birth: simpleBirth() }, NOW);
  const before = f.resources(), c = await f.cancel(publicBody(b), NOW + 86400000);
  assert.equal(c.outcome, 'cancelled'); assert.deepEqual(c.result, { cancelled: true }); noPrivate(c);
  assert.equal(f.resources(), before);
  const p = (await f.profile()).privateProfile.profile; assert.equal(p.coverage, 'inspiration');
  await readOnly(f, async () => {
    const late = await f.privateRun(b, NOW + 86400001); assert.equal(late.outcome, 'cancelled');
    assert.deepEqual(late.receipt, c.receipt); assert.deepEqual((await f.cancel(b)).receipt, c.receipt);
  });
});

test('cancel returns original winner when action already committed, never erases or marks it cancelled', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: simpleBirth() }), first = await f.privateRun(b);
  const cancelled = await readOnly(f, () => f.cancel(publicBody(b)));
  assert.equal(cancelled.outcome, 'committed'); assert.deepEqual(cancelled.receipt, first.receipt);
  assert.equal(f.count('rpg_fate_profiles'), 1);
});

test('simultaneous cancel and private action have one unique winner and one immutable receipt', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: simpleBirth() }),
    results = await Promise.all([f.privateRun(b), f.cancel(b)]);
  assert.equal(results[0].outcome, results[1].outcome);
  assert.deepEqual(results[0].receipt, results[1].receipt);
  assert.equal(f.count('rpg_fate_operations'), 1);
  assert.equal(f.rows('SELECT event_id FROM rpg_ledger WHERE type=?', PrivateReceipt.RECEIPT_TYPE).length, 1);
  assert.equal(f.count('rpg_fate_profiles'), results[0].outcome === 'committed' ? 1 : 0);
});

test('partial authority blocks retry/cancel, and corrupt fingerprint or proof cannot masquerade as receipt', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: simpleBirth() });
  f.sql.prepare('INSERT INTO rpg_fate_operations(account_id,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)')
    .run(OWNER, 'private:app:' + b.requestId, '0'.repeat(64), '{}', NOW);
  await readOnly(f, async () => {
    const read = await f.privateRead(b);
    assert.equal(read.found, false); assert.equal(read.recoveryAllowed, false); assert.equal(read.cancellationAllowed, false);
    await assert.rejects(f.privateRun(b), error('fate_private_receipt_unverified'));
    await assert.rejects(f.cancel(b), error('fate_private_receipt_unverified'));
  });
  const next = await f.prepare('profile-save', { birth: simpleBirth() }); await f.privateRun(next);
  f.sql.prepare('UPDATE rpg_fate_operations SET payload_hash=? WHERE request_id=?').run('f'.repeat(64), 'private:app:' + next.requestId);
  await readOnly(f, () => assert.rejects(f.privateRead(next), error('fate_private_receipt_corrupt')));
});

test('temporary birthday uses original country/time/RNG/start allowance and never saves plaintext date', async t => {
  const f = await fixture(t), b = await f.prepare('birthday-start', { country: 'JP', showSign: false, birthDate: simpleBirth().date }),
    r = await f.privateRun(b);
  const row = f.one('SELECT state_json FROM rpg_fate_lives WHERE id=?', r.result.lifeId), draft = JSON.parse(row.state_json);
  assert.equal(draft.country, 'JP'); assert.equal(draft.version, 9); assert.equal(draft.zodiac, null);
  assert.ok(Number.isInteger(draft.identityZodiac)); assert.ok(!row.state_json.includes(b.birthDate));
  assert.equal(f.count('rpg_fate_profiles'), 0); assert.deepEqual(r.receipt.costs, { dailyStarts: 1 }); noPrivate(r);
  const already = await f.prepare('birthday-start', { birthDate: simpleBirth().date }),
    second = await f.privateRun(already, NOW + 1);
  assert.equal(second.result.already, true); assert.equal(second.result.lifeId, r.result.lifeId);
  assert.deepEqual(second.receipt.costs, { dailyStarts: 0 });
  assert.equal(f.one('SELECT count FROM rpg_fate_starts WHERE account_id=?', OWNER).count, 1);
  await Fate.sweep(f.env, NOW + LIFE_MS);
  await readOnly(f, () => f.privateRead(b, NOW + LIFE_MS + 1));
});

test('saved birthday requires captured saved generation, temporary never falls back, and save/start remain separate', async t => {
  const f = await fixture(t), absent = await f.prepare('birthday-start', { source: 'saved' });
  await readOnly(f, () => assert.rejects(f.privateRun(absent), error('birth_date')));
  const save = await f.prepare('profile-save', { birth: simpleBirth() }), saved = await f.privateRun(save);
  const b = await f.prepare('birthday-start', { source: 'saved' });
  await readOnly(f, () => assert.rejects(f.privateRun({ ...b, birthDate: simpleBirth().date }), error('fate_private_input')));
  const temp = await f.prepare('birthday-start', { source: 'temporary' });
  await readOnly(f, () => assert.rejects(f.privateRun(temp), error('fate_private_input')));
  await Fate.saveProfile(f.env, f.tg, { requestId: 'legacy-profile-changed', consent: true, birth: completeBirth() }, NOW + 10);
  await readOnly(f, () => assert.rejects(f.privateRun(b), error('fate_private_changed')));
  assert.deepEqual((await f.privateRead(save)).result, saved.result);
  const fresh = await f.prepare('birthday-start', { source: 'saved' }), started = await f.privateRun(fresh);
  assert.equal(started.outcome, 'committed'); assert.equal(f.count('rpg_fate_lives'), 1);
});

test('original account four-start limit and midnight day/night semantics remain intact', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++) {
    const now = NOW + i * LIFE_MS, b = await f.prepare('birthday-start', { birthDate: simpleBirth().date }, now);
    await f.privateRun(b, now); await Fate.sweep(f.env, now + LIFE_MS);
  }
  const over = await f.prepare('birthday-start', { birthDate: simpleBirth().date }, NOW + 4 * LIFE_MS);
  await assert.rejects(f.privateRun(over, NOW + 4 * LIFE_MS), error('fate_limit'));
  assert.equal(f.one('SELECT count FROM rpg_fate_starts WHERE account_id=?', OWNER).count, 4);
  const nextDay = NOW + 18 * 3600000, night = await f.prepare('birthday-start', { birthDate: simpleBirth().date }, nextDay);
  await assert.rejects(f.privateRun(night, nextDay), error('fate_night'));
});

test('daily read shows pending evidence only, explicit sync writes original ordered notes and no resources', async t => {
  const f = await fixture(t); syntheticBoss(f);
  const pending = await readOnly(f, () => f.privateScene({}, NOW + 10000));
  assert.equal(pending.privateFate.daily.unlocked, 0); assert.equal(pending.privateFate.evidence.pending.length, 1);
  const b = await f.prepare('daily-sync', {}, NOW + 10000), resources = f.resources(), first = await f.privateRun(b, NOW + 10000);
  assert.deepEqual(first.result, { day: b.day, materialized: true, created: true, unlocked: 1, added: 1, revision: 1 });
  assert.equal(f.resources(), resources); noPrivate(first);
  const scene = await readOnly(f, () => f.privateScene({}, NOW + 10000));
  assert.equal(scene.privateFate.daily.notes[0].locked, false);
  assert.deepEqual(scene.privateFate.daily.notes.slice(1), [{ topic: 'work', locked: true }, { topic: 'love', locked: true }]);
  assert.equal(scene.privateFate.evidence.pending.length, 0);
  syntheticBoss(f, { id: 'synthetic-f2-repeat', at: NOW + 11000 });
  const next = await f.prepare('daily-sync', {}, NOW + 12000), second = await f.privateRun(next, NOW + 12000);
  assert.deepEqual(second.result, { day: b.day, materialized: true, created: false, unlocked: 1, added: 0, revision: 1 });
  assert.equal(f.resources(), resources);
  assert.equal(f.rows("SELECT event_id FROM rpg_ledger WHERE type='每日補給金'").length, 0);
});

test('two daily syncs at absent row cannot duplicate notes or unlocks; later explicit sync is metadata no-op', async t => {
  const f = await fixture(t); syntheticBoss(f);
  const a = await f.prepare('daily-sync'), b = await f.prepare('daily-sync'),
    settled = await Promise.allSettled([f.privateRun(a), f.privateRun(b)]);
  assert.equal(settled.filter(s => s.status === 'fulfilled').length, 1); assert.equal(f.count('rpg_fate_daily'), 1);
  const winner = settled.find(s => s.status === 'fulfilled').value;
  assert.equal(winner.result.unlocked, 1);
  const later = await f.prepare('daily-sync'), result = await f.privateRun(later);
  assert.equal(result.result.added, 0); assert.equal(result.result.revision, 1);
});

test('cross-midnight pending daily does not silently create tomorrow; cancellation still resolves old intent', async t => {
  const f = await fixture(t), b = await f.prepare('daily-sync');
  await readOnly(f, () => assert.rejects(f.privateRun(b, NOW + 86400000), error('fate_private_day_changed')));
  assert.equal(f.count('rpg_fate_daily'), 0);
  const cancelled = await f.cancel(b, NOW + 86400000);
  assert.equal(cancelled.outcome, 'cancelled'); assert.equal(f.count('rpg_fate_daily'), 0);
});

test('private generation guard rejects a scoped daily calculation interrupted by legacy erase/recreate', async t => {
  const f = await fixture(t); await Fate.saveProfile(f.env, f.tg, { requestId: 'legacy-race-save-a', consent: true, birth: completeBirth() }, NOW);
  const b = await f.prepare('daily-sync'); let interrupted = false;
  withBatch(f, t, async statements => {
    if (!interrupted && statements.some(s => s.sql.startsWith('INSERT INTO rpg_fate_daily('))) {
      interrupted = true;
      await Fate.deleteProfile(f.env, f.tg, { requestId: 'legacy-race-erase' }, NOW);
      await Fate.saveProfile(f.env, f.tg, { requestId: 'legacy-race-save-b', consent: true, birth: completeBirth() }, NOW);
    }
  });
  await assert.rejects(f.privateRun(b), error('conflict'));
  assert.equal(interrupted, true); assert.equal(f.count('rpg_fate_daily'), 0);
  assert.equal(operationRow(f, b), undefined);
});

test('legacy daily generation guard rejects identical-profile ABA before insertion then recomputes current authority', async t => {
  const f = await fixture(t); await Fate.saveProfile(f.env, f.tg, { requestId: 'legacy-aba-save-a', consent: true, birth: completeBirth() }, NOW);
  const original = f.db.prepare.bind(f.db); let intercepted = false, staleChanges = null;
  f.db.prepare = sql => {
    const stmt = original(sql);
    if (sql.startsWith('INSERT OR IGNORE INTO rpg_fate_daily')) {
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...params) => {
        const bound = bind(...params), run = bound.run.bind(bound);
        bound.run = async () => {
          if (!intercepted) {
            intercepted = true;
            await Fate.deleteProfile(f.env, f.tg, { requestId: 'legacy-aba-delete' }, NOW);
            await Fate.saveProfile(f.env, f.tg, { requestId: 'legacy-aba-save-b', consent: true, birth: completeBirth() }, NOW);
            const result = await run(); staleChanges = result.meta.changes; return result;
          }
          return run();
        };
        return bound;
      };
    }
    return stmt;
  };
  t.after(() => { f.db.prepare = original; });
  const result = await Fate.daily(f.env, f.tg, NOW);
  assert.equal(intercepted, true); assert.equal(staleChanges, 0, 'old private calculation escaped the generation fence');
  assert.equal(result.profile.saved, true); assert.equal(f.count('rpg_fate_daily'), 1);
});

test('private scene retries erase during read and never returns stale birth-derived notes', async t => {
  const f = await fixture(t); await f.privateRun(await f.prepare('profile-save', { birth: completeBirth() }));
  syntheticBoss(f); await f.privateRun(await f.prepare('daily-sync'));
  let erased = false;
  withBatch(f, t, async statements => {
    if (!erased && statements.some(s => s.sql.includes('SELECT MIN(b.settled_at)'))) {
      erased = true; await Fate.deleteProfile(f.env, f.tg, { requestId: 'legacy-scene-erase' }, NOW + 1);
    }
  });
  const scene = await f.privateScene({}, NOW + 2);
  assert.equal(erased, true); assert.equal(scene.privateFate.profile.saved, false);
  assert.equal(scene.privateFate.daily.materialized, false); assert.equal(scene.privateFate.daily.notes.length, 0);
});

test('corrupt history metadata is redacted instead of forwarding attacker/private extras', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: simpleBirth() }); await f.privateRun(b);
  const row = f.one('SELECT note FROM rpg_ledger WHERE event_id=?', f.typedId(b)), changed = JSON.parse(row.note);
  changed.result.birth = simpleBirth();
  f.sql.prepare('UPDATE rpg_ledger SET note=? WHERE event_id=?').run(JSON.stringify(changed), f.typedId(b));
  const history = (await readOnly(f, () => f.privateScene())).privateFate.history;
  assert.deepEqual(history.receipts, [{ createdAt: NOW, corrupt: true }]); noPrivate(history);
  await readOnly(f, () => assert.rejects(f.privateRead(b), error('fate_private_receipt_corrupt')));
});

test('frozen realm is read-only for private views and terminal receipts, with every new action/cancel fenced', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: simpleBirth() }); await f.privateRun(b);
  const next = await f.prepare('profile-delete'); f.env.REALM_CONTEXT.phase = 'FREEZE';
  await readOnly(f, async () => {
    assert.equal((await f.privateScene()).privateFate.control.writable, false);
    assert.equal((await f.profile()).privateProfile.control.writable, false);
    assert.equal((await f.privateRead(b)).found, true);
    assert.equal((await f.privateRead(next)).recoveryAllowed, false);
    await assert.rejects(f.privateRun(next), error('realm_read_only'));
    await assert.rejects(f.cancel(next), error('realm_read_only'));
  });
});

test('same raw ID cannot collide across app/service namespaces or read another account private profile', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: simpleBirth() }), first = await f.privateRun(b);
  assert.equal(first.receipt.requestKey, 'private:app:' + b.requestId);
  assert.equal((await readOnly(f, () => f.privateRead(b, NOW, 'service'))).found, false);
  const other = (await createCharacter(f.env, { tgId: '19862', name: '私人資料測乙', baseClass: 'mage', gender: 'f' }, NOW)).char.tg_id;
  const foreign = await readOnly(f, () => f.profile({ selectedCharacterId: other }));
  assert.equal(foreign.privateProfile.profile.saved, false);
});

for (const kind of ['profile-save', 'profile-delete', 'birthday-start']) test('reserved private namespace is inaccessible to direct legacy ' + kind + ' before side effects', async t => {
  const f = await fixture(t);
  if (kind === 'profile-delete') await f.privateRun(await f.prepare('profile-save', { birth: simpleBirth() }));
  const fields = kind === 'profile-save' ? { birth: simpleBirth() } : kind === 'birthday-start' ? { birthDate: simpleBirth().date } : {},
    body = await f.prepare(kind, fields), original = await f.privateRun(body),
    op = PrivateReceipt.operation(kind, body, 'app', true), raw = PrivateReceipt.payload(op, body),
    method = kind === 'profile-save' ? Fate.saveProfile : kind === 'profile-delete' ? Fate.deleteProfile : Fate.start;
  await readOnly(f, async () => {
    await assert.rejects(method(f.env, f.tg, raw, NOW + LIFE_MS), error('fate_private_namespace'));
    const found = await f.privateRead(body, NOW + LIFE_MS); assert.deepEqual(found.receipt, original.receipt); noPrivate(found);
  });
});
test('reserved private namespace cannot be claimed by a new ordinary legacy operation or body-only marker', async t => {
  const f = await fixture(t); await f.run(f.body('start'));
  await readOnly(f, () => assert.rejects(Fate.start(f.env, f.tg,
    { requestId: 'private:app:reserved-new-intent', mode: 'random', privateAuthority: true }, NOW + LIFE_MS), error('fate_private_namespace')));
  assert.equal(f.count('rpg_fate_operations'), 1);
});
