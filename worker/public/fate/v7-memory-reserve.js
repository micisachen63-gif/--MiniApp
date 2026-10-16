import {LEGACY_MEMORIES} from './formal-ambient-v4.js';
import {NEW_MEMORIES} from './formal-catalog-v4.js';
import {FURTHER_MEMORIES} from './formal-days-v4.js';
import {V5_MEMORIES} from './formal-days-v5.js';

// Human-reviewed reuse list, not a regular expression pretending to understand
// a biography. Text is never rewritten, concatenated or multiplied for volume.
// The old catalogues stay immutable; IDs are the same ones v4/v5 actually used.
// Freeze this list and gate recipe before v7 is published.
const PICKS=Object.freeze({
 legacy:{
  child:'1 2 3 4 5 7 8 10 11 12 13 14 16 17 18 19 20 21 22 23 25 26 27 28 29 30',
  youth:'1 3 4 6 8 9 12 13 14 15 16 17 19 20 21 22 24 25 27 28 29 30',
  adult:'1 2 5 6 7 8 10 11 12 13 14 15 16 17 20 21 23 25 26 27 28 29 30',
  middle:'1 6 7 8 9 10 12 15 16 17 19 20 21 23 24 25 26 28',
  late:'1 3 4 5 7 8 10 11 12 14 15 16 17 18 21 22 23 24 25 26 28 29 30',
  elder:'1 2 5 6 7 8 9 10 13 14 15 16 18 19 20 21 23 25 26 27 28 29'
 },
 new:{
  child:'0 2 3 4 5 6 7 8 9 10 11 12 14 15 16 17 18 20 21 22 23',
  youth:'0 2 4 5 6 7 9 10 11 12 14 15 17 18 19 20 21 22 23',
  adult:'0 1 2 3 4 5 6 7 8 9 11 12 13 14 15 16 17 18 19 20 21 22 23',
  middle:'0 1 2 3 5 6 8 9 10 11 12 13 17 18 19 20 21 22 23',
  late:'0 1 2 3 4 5 6 7 8 9 11 12 13 14 15 16 17 19 20 21 22 23',
  elder:'0 1 2 3 5 6 7 8 9 10 11 12 13 15 16 17 18 19 20 21 22 23'
 },
 further:{
  child:'0 1 2 3 4 5 6 7 8 9 10 12 13 14 15 16 18 19 20 21 22 23 24 25 26 27 28 29',
  youth:'2 3 4 5 6 10 11 15 16 17 18 20 21 25 26 27 28 29',
  adult:'0 2 4 5 6 7 8 9 11 12 13 14 15 16 17 18 22 23 24 29',
  middle:'0 1 4 6 7 8 9 10 11 12 13 16 17 18 20 21 24 25 28 29',
  late:'0 2 3 4 5 8 9 10 11 12 13 14 16 17 18 19 20 22 23 25 26 28 29',
  elder:'0 2 6 7 8 9 10 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29'
 },
 day5:{
  child:'',youth:'',adult:'',
  middle:'5 8 9 11 13 16 20 21 24 28 31 33 35 36 40 41 42 44 45 49',
  late:'7 11 13 14 17 18 20 22 27 28 30 31 33 35 39 40 42 44 46 49',
  elder:'0 1 3 4 5 7 9 10 11 13 14 15 16 17 20 23 24 26 27 29 31 33 35 36 38 39 40 41 42 46 48 49'
 }
});
const AGE_WINDOWS=Object.freeze({child:[6,13],youth:[18,24],adult:[24,40],middle:[40,56],late:[56,74],elder:[74,105]});
// Final semantic review removes employment, completed projects, formal lessons,
// mentoring and long-distance travel. A generic workActive boolean cannot prove
// a particular contract, professional role, exhibition or former career existed.
const REJECTED_AFTER_REVIEW=new Set(`
 v4-youth-08 v4-youth-13 v4-youth-22 v4-youth-27 v4-youth-28
 v4-adult-01 v4-adult-05 v4-adult-10 v4-adult-17 v4-adult-21 v4-adult-27
 v4-middle-08 v4-new-youth-11 v4-new-youth-22
 v4-new-adult-1 v4-new-adult-2 v4-new-adult-4 v4-new-adult-6
 v4-new-adult-12 v4-new-adult-20 v4-new-middle-2
 v4-day-youth-3 v4-day-middle-6 v4-day-late-18 v4-day-late-19
 v5-day-middle-9 v5-day-middle-13 v5-day-middle-28 v5-day-middle-31
 v5-day-middle-36 v5-day-middle-40 v5-day-late-14 v5-day-late-20
 v5-day-late-30 v5-day-late-31 v5-day-late-35 v5-day-late-39 v5-day-late-40
 v4-adult-14 v4-adult-28 v4-new-youth-12 v4-new-middle-9
 v4-new-middle-10 v4-new-middle-12 v4-new-middle-21
 v4-day-youth-4 v4-day-youth-16 v4-day-adult-5 v4-day-adult-11
 v4-day-adult-15 v4-day-adult-16 v4-day-middle-7 v4-day-middle-9
 v4-day-middle-18 v5-day-middle-8 v5-day-middle-44 v5-day-middle-45
 v4-late-10 v4-day-late-3 v4-day-late-8 v4-new-late-7 v4-youth-19
 v4-elder-05 v4-elder-07 v4-elder-13 v5-day-elder-17 v5-day-elder-20 v5-day-elder-29
 v5-day-late-42
`.trim().split(/\s+/));
const legacy=new Map(LEGACY_MEMORIES.map(row=>[row.id,row]));
const groups={new:NEW_MEMORIES,further:FURTHER_MEMORIES,day5:V5_MEMORIES};
function record(source,phase,index){
 if(source==='legacy'){
  const raw=legacy.get(phase+'-'+String(index).padStart(2,'0'));
  if(!raw)throw new Error('Missing reviewed legacy memory');
  return {id:'v4-'+raw.id,phase:raw.phase,text:raw.text,source:'formal-ambient-v4'};
 }
 const text=groups[source][phase][index];if(typeof text!=='string')throw new Error('Missing reviewed memory');
 const prefixes={new:'v4-new-',further:'v4-day-',day5:'v5-day-'};
 return {id:prefixes[source]+phase+'-'+index,phase,text,source:{new:'formal-catalog-v4',further:'formal-days-v4',day5:'formal-days-v5'}[source]};
}
function gates(row){
 // This is a conservative extra gate on an already reviewed whitelist, not an
 // automatic safety classifier. Minor everyday hobbies do not grant engine skills.
 const peer=/朋友|老友|舊友|友誼|同伴|夥伴|親友|玩伴|鄰家的孩子/.test(row.text);
 return {requiresAll:Object.freeze(peer?['trustedPeer']:[]),requiresAny:Object.freeze([])};
}
const rawRows=[];
for(const [source,phases]of Object.entries(PICKS))for(const [phase,indices]of Object.entries(phases))for(const index of indices.split(' ').filter(Boolean).map(Number))rawRows.push(record(source,phase,index));
// Exact duplicate source prose is counted once, with the first stable source ID.
// This avoids inflating catalogue size when old version shelves share a paragraph.
const seenTexts=new Set(),duplicateSourceIds=[];
const rows=rawRows.filter(row=>!REJECTED_AFTER_REVIEW.has(row.id)).filter(row=>{if(seenTexts.has(row.text)){duplicateSourceIds.push(row.id);return false;}seenTexts.add(row.text);return true;}).map(row=>Object.freeze({...row,minAge:AGE_WINDOWS[row.phase][0],maxAge:AGE_WINDOWS[row.phase][1],...gates(row)}));
export const V7_MEMORY_RESERVE=Object.freeze(rows);
export function eligibleV7MemoryReserve(age,state={}){
 if(!Number.isFinite(age)||!state||typeof state!=='object')return [];
 return V7_MEMORY_RESERVE.filter(row=>age>=row.minAge&&age<row.maxAge&&row.requiresAll.every(flag=>state[flag]===true)&&(!row.requiresAny.length||row.requiresAny.some(flag=>state[flag]===true)));
}
export function memoryReserveInventory(){
 return {sourceCandidates:804,reviewedSourceRows:rawRows.length,excludedAfterReview:REJECTED_AFTER_REVIEW.size,uniqueReserve:V7_MEMORY_RESERVE.length,duplicateSourceIds:[...duplicateSourceIds],
  byPhase:Object.fromEntries(Object.keys(AGE_WINDOWS).map(phase=>[phase,rows.filter(row=>row.phase===phase).length])),
  conditional:rows.filter(row=>row.requiresAll.length||row.requiresAny.length).length,
  noCondition:rows.filter(row=>!row.requiresAll.length&&!row.requiresAny.length).length,
  sources:Object.fromEntries(['formal-ambient-v4','formal-catalog-v4','formal-days-v4','formal-days-v5'].map(source=>[source,rows.filter(row=>row.source===source).length])),
  replayContract:'Selection may depend on seed, elapsed age, actual replayed flags and same-life used IDs. Do not filter using private recent-life history: public result codes do not carry that history. Next-life seed search can score past actual IDs without changing replay.',
  limits:'A catalogue count is not the number eligible for each life. Infant ages below 6 use no reserve. Specific employment, formal training, professional mentoring, completed projects and long-distance travel were excluded; friendship prose needs an actual trustedPeer flag. Generic family means existing carers or kin, never an invented spouse or child. This is fictional-world daily prose, not researched country localization. No cross-life overlap target is asserted.'};
}
