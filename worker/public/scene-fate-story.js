/* Pure presentation adapter for persisted Fate lives.
 * Original country books, timing and narrative engines are imported unchanged.
 * No start/choice/storage/network mutation, seed generation or reward calculation occurs here.
 */
import {validLife,advanceLife,lifeAge,lifeGrowth,activeBetween,LIFE_MS,isOpenTime,addActive,CHOICE_MS} from './fate/life.js';
import {scenesFor} from './fate/cycles.js';
import {decodeResult,encodeResult,ORBITS,ZODIAC} from './fate/model.js';
import {formalEvents,plannedContent} from './fate/formal-events.js';
import {narrativeEvents} from './fate/event-catalog-v1.js';
import {endingForLife} from './fate/ending-story.js';
import {endingTimeline} from './fate/ending-timeline.js';
import {lifeIdentity,taiwanLifeState,taiwanStatusCards} from './fate/locality-ui.js';
import {ensureCountryPack,ensureCountryCodes} from './fate/country-runtime-v9.js';

const copy = value => JSON.parse(JSON.stringify(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const timestamp = value => Number.isSafeInteger(value) && value > 0;
const ageLabel = age => age > 0 && age < 1 ? Math.max(1,Math.round(age * 12)) + ' 月' : Math.floor(age) + ' 歲';
async function originalLife(raw) {
  if (raw?.version === 9) await ensureCountryPack(raw.country);
  const life = validLife(raw);
  if (!life) throw Error('這一世的原始紀錄尚未完整，請重新同步。');
  return life;
}
function identity(life) {
  const value = lifeIdentity(life);
  const zodiac = Number.isInteger(life.zodiac) ? ZODIAC[life.zodiac] + '座' : '';
  return value ? {title:value.title,place:value.place,gender:value.gender,family:value.family,zodiac}
    : {title:ORBITS[life.orbit]?.[0] || '星穹旅人',place:'星穹世界',gender:'',family:'',zodiac};
}
function eventsFor(life,completed = false) {
  let rows = completed && !timestamp(life.startedAt) ? (life.version >= 4 ? plannedContent(life) : [])
    : life.version >= 4 ? formalEvents(life,life.clockAt) : narrativeEvents(life,life.clockAt);
  rows = rows.filter(row => life.version >= 7 || row.kind !== 'choice');
  if (life.version < 7) {
    const scenes = scenesFor(life);
    for (let i=0;i<life.answers.length;i++) {
      const source = life.sources?.[i] || (life.auto?.[i] ? 'auto' : 'manual');
      rows.push({id:'choice-'+i,age:scenes[i].age,kind:'choice',choiceIndex:i,source,
        text:(source === 'auto' ? '命運代選 · ' : '親自選擇 · ') + scenes[i].choices[life.answers[i]][2]});
    }
  }
  return rows.filter(row => typeof row.text === 'string' && Number.isFinite(row.age))
    .sort((a,b) => a.age - b.age || String(a.id || '').localeCompare(String(b.id || '')))
    .map(row => ({id:String(row.id || row.kind + ':' + row.age),age:row.age,ageLabel:ageLabel(row.age),
      text:row.text,kind:row.kind || 'memory',...(row.choiceIndex !== undefined ? {choiceIndex:row.choiceIndex} : {}),
      ...(row.source ? {source:row.source} : {})}));
}
export function remainingChoice(timing,now = timing?.displayAt) {
  if (!timing || !timestamp(now) || !timestamp(timing.deadline)) return {open:false,night:timestamp(now) ? !isOpenTime(now) : false,seconds:0};
  const night = !isOpenTime(now);
  return {open:timing.available === true && !night && now < timing.deadline && (!timestamp(timing.opensAt) || now >= timing.opensAt),
    night,seconds:Math.max(0,Math.ceil(activeBetween(now,timing.deadline)/1000))};
}
export async function projectCurrent(active) {
  if (!active || active.status !== 'active' || !active.id || !Number.isSafeInteger(active.rev) || !active.timing) throw Error('目前旅章尚未完整，請重新同步。');
  const raw = copy(active.draft), life = await originalLife(raw), timing = active.timing;
  if (!timestamp(timing.displayAt) || timing.displayAt < life.startedAt) throw Error('旅章時鐘尚未同步。');
  const endAt = addActive(life.startedAt,LIFE_MS);
  let storyAt = timestamp(timing.storyAt) ? timing.storyAt : life.clockAt;
  storyAt = Math.max(life.clockAt,Math.min(storyAt,endAt-1));
  let rendered = advanceLife(life,storyAt);
  // A presentation clock may reveal ordinary prose, but never an uncommitted
  // automatic answer or completed life. Fail closed to the persisted clock.
  if (rendered.completed || !same(rendered.draft.answers,life.answers) || !same(rendered.draft.sources,life.sources)) {
    storyAt = Math.min(life.clockAt,endAt-1);
    rendered = advanceLife(life,storyAt);
    if (rendered.completed || !same(rendered.draft.answers,life.answers) || !same(rendered.draft.sources,life.sources)) throw Error('此世仍待背景同步，原始選擇會保留。');
  }
  const display = {...life,clockAt:storyAt}, gate = advanceLife(life,timing.displayAt);
  const unchangedAnswers = same(gate.draft.answers,life.answers) && same(gate.draft.sources,life.sources);
  let question = null;
  if (timing.available === true && gate.available && unchangedAnswers && gate.index === timing.index && gate.index === life.answers.length && !gate.completed) {
    const scene = scenesFor(gate.draft)[gate.index];
    if (scene?.choices?.length === 2) {
      const deadline = addActive(gate.slots[gate.index],CHOICE_MS);
      if (timing.deadline !== deadline) throw Error('這個抉擇的原始期限已變更，請重新同步。');
      question = {index:gate.index,age:scene.age,ageLabel:ageLabel(scene.age),title:scene.title,text:scene.text,
        deadline,choices:scene.choices.map((choice,answer) => ({answer,label:choice[0],reason:choice[1]}))};
    }
  }
  const events = eventsFor(display), status = taiwanLifeState(display);
  return {kind:'current',id:active.id,rev:active.rev,committed:false,countsAsLife:false,
    persistedAnswers:copy(life.answers),persistedSources:copy(life.sources),storyAt,displayAt:timing.displayAt,
    settlementPending:timing.settlementPending === true || gate.completed || !unchangedAnswers,
    night:!isOpenTime(timing.displayAt),age:lifeAge(display,storyAt),growth:lifeGrowth(display).label,
    progress:Math.max(0,Math.min(100,activeBetween(display.startedAt,storyAt)/LIFE_MS*100)),
    remainingMs:Math.max(0,LIFE_MS-activeBetween(display.startedAt,storyAt)),identity:identity(display),events,
    status:status ? taiwanStatusCards(status) : [],question,
    image:display.version === 9 ? '/art/fate-countries-v9/' + display.country.toLowerCase() + '-memory.webp'
      : display.version === 8 ? '/art/fate-taiwan-v8/taipei-dusk.webp' : null};
}
async function resultProjection(entry,completed) {
  if (!entry || typeof entry.code !== 'string') throw Error('旅章代碼尚未完整。');
  await ensureCountryCodes([entry.code]);
  const result = decodeResult(entry.code);
  if (!result) throw Error('這張旅人來信無法辨識。');
  const life = completed ? await originalLife(entry.draft) : result;
  if (completed) {
    if (!entry.id || !timestamp(entry.at)) throw Error('正式旅章缺少完成紀錄。');
    let code;
    try { code = encodeResult({...life,auto:life.sources.map(source => source === 'auto' ? 1 : 0)}); } catch { throw Error('旅章代碼與原始紀錄不符，請重新同步。'); }
    if (code !== entry.code) throw Error('旅章代碼與原始紀錄不符，請重新同步。');
  }
  const events = eventsFor(life,true), story = life.version >= 4 ? endingForLife(life) : null;
  return {kind:completed ? 'completed' : 'memorial',committed:completed,countsAsLife:completed,
    id:completed ? entry.id : null,code:entry.code,at:entry.at || null,identity:identity(life),
    title:story?.title || result.ending.title,summary:story?.summary || result.ending.body,
    paragraphs:story?.paragraphs || [result.ending.body],quote:story?.quote || result.ending.quote,
    question:story?.question || result.ending.question,image:story?.illustration || null,events,
    timeline:story?.chapters || endingTimeline({...life,deathAge:result.deathAge},events),
    originalEnding:{title:result.ending.title,body:result.ending.body,quote:result.ending.quote},
    deathAge:result.deathAge ?? null};
}
export const projectCompleted = entry => resultProjection(entry,true);
export const projectMemorial = entry => resultProjection(entry,false);
