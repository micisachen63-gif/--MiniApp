import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAIWAN_MEMORIES_V8 as memories,
  TAIWAN_CAREER_CHAPTERS_V8 as careers,
  TAIWAN_TEACHER_CHAPTERS_V8 as teachers,
  TAIWAN_BIRTH_SCENES_V8 as births,
  TAIWAN_CONTENT_RULES_V8 as rules,
} from '../public/fate/taiwan-content-v8.js';

test('Taiwan has at least 600 separately authored memories, not duplicate-text ID padding', () => {
  assert.equal(memories.length, 618);
  assert.equal(new Set(memories.map(item => item.text)).size, memories.length);
  const counts = Object.fromEntries(['child', 'youth', 'adult', 'late', 'any'].map(phase => [
    phase, memories.filter(item => item.phase === phase).length,
  ]));
  assert.deepEqual(counts, {child: 120, youth: 120, adult: 228, late: 120, any: 30});
  for (const memory of memories) {
    assert.ok(memory.text.length >= 20, memory.id);
    assert.ok(!/[{}]|\$\{|<[^>]+>/.test(memory.text), memory.id);
  }
});

test('memory and chapter identities are stable, bounded and unique across content collections', () => {
  const all = [...memories, ...Object.values(careers).flat(), ...teachers];
  assert.equal(new Set(all.map(item => item.id)).size, all.length);
  for (const item of all) {
    assert.match(item.id, /^tw8-[a-z0-9_-]+$/);
    assert.ok(item.id.length <= 32, item.id);
    assert.ok(Object.isFrozen(item), item.id);
  }
  assert.ok(Object.isFrozen(memories));
  assert.ok(Object.isFrozen(careers));
});

test('school memories are confined to school ages; toddler fallback has no school or work assignment', () => {
  for (const memory of memories) {
    assert.ok(Number.isInteger(memory.minAge), memory.id);
    assert.ok(Number.isInteger(memory.maxAge), memory.id);
    assert.ok(memory.minAge <= memory.maxAge, memory.id);
    if (memory.phase === 'child') {
      assert.ok(memory.minAge >= 6 && memory.maxAge <= 12, memory.id);
      if (memory.text.includes('畢業紀念冊')) assert.ok(memory.minAge >= 11);
    }
    if (memory.phase === 'youth') assert.ok(memory.minAge >= 13 && memory.maxAge <= 17, memory.id);
    if (memory.phase === 'adult') assert.ok(memory.minAge >= 18, memory.id);
    if (memory.phase === 'late') assert.ok(memory.minAge >= 60, memory.id);
    if (memory.phase === 'any') {
      assert.equal(memory.minAge, 3);
      assert.ok(!/段考|補習班|志願表|入職|上班|薪資|結婚|自己的孩子/.test(memory.text), memory.id);
    }
  }
});

test('graduation and preference-form moments cannot appear for a 13-year-old just entering junior high', () => {
  const yearbook = memories.find(item => item.text.includes('畢業紀念冊'));
  const graduation = memories.find(item => item.text.includes('畢業照拍完'));
  const preference = memories.find(item => item.text.startsWith('志願表上'));
  const mockExam = memories.find(item => item.text.startsWith('模擬考前'));
  assert.equal(yearbook.id, 'tw8-child-096');
  assert.equal(yearbook.minAge, 11);
  assert.equal(graduation.id, 'tw8-youth-118');
  assert.equal(graduation.minAge, 15);
  assert.equal(graduation.maxAge, 15);
  assert.equal(preference.minAge, 15);
  assert.equal(mockExam.minAge, 14);
});

test('ungated daily moments do not award personal employment, a tenancy, spouse, children or a chronic prescription', () => {
  const ungated = memories.filter(item => !item.requires?.length && !item.needsChildren && !item.needsMarried && !item.needsPartner);
  for (const item of ungated) {
    assert.doesNotMatch(item.text,
      /你(?:的)?(?:下班|上班|同事|薪資|房東|租約|伴侶|丈夫|妻子|兒子|女兒)|你和(?:室友|伴侶)|你的孩子|你的房東|退租前你|搬進房間前，你|停掉原來的藥/,
      item.id);
  }
  for (const id of ['tw8-adult-001', 'tw8-adult-002', 'tw8-adult-003', 'tw8-adult-009', 'tw8-adult-012']) {
    assert.match(memories.find(item => item.id === id).text, /陪|說明會|鄰居|幫人|有人向你/);
  }
});

test('local metropolitan details do not silently retain foreign festivals or legacy fantasy places', () => {
  const text = [...memories, ...Object.values(careers).flat(), ...teachers].map(item => item.text).join('\n');
  assert.doesNotMatch(text, /星曆|星火平原|城邦|符文|感恩節|感恩節火雞|巡迴師傅|水路測繪員/);
  for (const detail of ['捷運', '聯絡簿', '補習班', '機車', '雨衣', '夜市', '豆漿', '垃圾車',
    '颱風', '騎樓', '悠遊卡', '租屋', '點交', '社區', '超商', '家長', '滷味', '河濱']) {
    assert.ok(text.includes(detail), `missing urban detail ${detail}`);
  }
});

test('all 16 careers have ten progressive chapters behind actual work and responsibility gates', () => {
  assert.equal(Object.keys(careers).length, 16);
  for (const [careerId, chapters] of Object.entries(careers)) {
    assert.equal(chapters.length, 10, careerId);
    assert.ok(Object.isFrozen(chapters), careerId);
    for (const [index, chapter] of chapters.entries()) {
      assert.equal(chapter.stage, index, chapter.id);
      assert.equal(chapter.gate.careerId, careerId, chapter.id);
      assert.equal(chapter.gate.workActive, true, chapter.id);
      assert.equal(chapter.gate.minCareerStage, index < 3 ? 1 : index < 7 ? 2 : 3, chapter.id);
      assert.ok(Object.isFrozen(chapter.gate), chapter.id);
      assert.ok(chapter.minAge >= 18, chapter.id);
      assert.ok(chapter.text.length >= 25, chapter.id);
    }
  }
});

test('regulated teacher work cannot be unlocked merely by an administrative career, age or practice', () => {
  assert.equal(teachers.length, 10);
  for (const chapter of teachers) {
    assert.equal(chapter.gate.careerId, 'early_childhood_assistant');
    assert.equal(chapter.gate.workActive, true);
    assert.equal(chapter.gate.minCareerStage, 2);
    assert.ok(chapter.minAge >= 23);
    assert.deepEqual(chapter.gate.requires, ['teacherDegreeCompleted', 'teacherPreEducationCompleted',
      'teacherExamPassed', 'teacherInternshipPassed', 'teacherCertificateGranted', 'teacherHired']);
    assert.ok(Object.isFrozen(chapter.gate.requires));
  }
  assert.match(careers.early_childhood_assistant[0].text, /合資格人員負責/);
  assert.match(careers.early_childhood_assistant[9].text, /不是假裝自己成了老師/);
});

test('teacher and support chapter IDs remain different when sharing the same career ID', () => {
  const support = new Set(careers.early_childhood_assistant.map(item => item.id));
  for (const teacher of teachers) assert.equal(support.has(teacher.id), false, teacher.id);
});

test('night reception is adult work in the specified licensed Taipei setting, not a gender lock', () => {
  assert.equal(rules.nightReceptionProductMinAge, 21);
  assert.equal(rules.genderIsCareerGate, false);
  const chapters = careers.night_reception;
  assert.ok(chapters.every(chapter => chapter.minAge === 21));
  assert.match(chapters[0].text, /台北.*許可酒家.*陪侍接待/);
  assert.match(chapters[3].text, /拒絕勉強飲酒/);
  assert.ok(chapters.every(chapter => chapter.gender === undefined && chapter.gate.gender === undefined));
});

test('birth and professional support prose remain metropolitan fiction without invented financial percentiles', () => {
  assert.equal(births.length, 6);
  assert.ok(births.every(text => /台北|新北/.test(text)));
  const text = [...memories, ...Object.values(careers).flat(), ...teachers].map(item => item.text).join('\n');
  assert.doesNotMatch(text, /全球前\s*\d|同年代\s*\d+%|保證月薪|保證年薪|取得護理師資格|自動獲得教師證/);
  assert.match(careers.care_support[0].text, /需要資格的專業服務/);
  assert.match(careers.repair_assistant[1].text, /不讓新人獨自/);
  assert.match(careers.beauty_assistant[0].text, /不自行操作/);
});
