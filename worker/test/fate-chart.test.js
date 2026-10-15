import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBirth,localInstant} from '../src/game/fate-birth.js';
import {natal,dailySignals,ayanamsa,sky,ascendant,dasha} from '../src/game/fate-chart.js';
import {PLACES} from '../public/fate/places.js';
import * as Astronomy from 'astronomy-engine';
const NOW=Date.parse('2026-10-16T12:00:00Z');
const full={date:'1998-11-03',time:'10:30',placeId:'taipei',sex:'f'};
const errorCode=code=>e=>e.code===code;
test('birth accepts Gregorian leap days and rejects invalid, future and malformed dates/times',()=>{
 assert.equal(normalizeBirth({date:'2000-02-29'},NOW).date,'2000-02-29');
 for(const date of ['1900-02-29','2025-02-29','2026-04-31','2026-2-01','1899-12-31'])assert.throws(()=>normalizeBirth({date},NOW),errorCode('birth_date'));
 assert.throws(()=>normalizeBirth({date:'2026-10-17'},NOW),errorCode('birth_future'));
 for(const time of ['24:00','12:60','9:00'])assert.throws(()=>normalizeBirth({...full,time},NOW),errorCode('birth_time'));
 assert.throws(()=>normalizeBirth({...full,date:'2026-10-16',time:'21:00'},NOW),errorCode('birth_future'));
});
test('historical IANA time zones reject DST gaps and resolve repeated hours explicitly',()=>{
 assert.throws(()=>localInstant('2024-03-10','02:30','America/New_York'),errorCode('birth_gap'));
 const early=localInstant('2024-11-03','01:30','America/New_York'),late=localInstant('2024-11-03','01:30','America/New_York','later');
 assert.equal(early.at,Date.parse('2024-11-03T05:30:00Z'));assert.equal(late.at,Date.parse('2024-11-03T06:30:00Z'));assert.equal(early.ambiguous,true);assert.equal(late.at-early.at,3600000);
 assert.equal(localInstant('2024-01-01','12:00','Asia/Kolkata').at,Date.parse('2024-01-01T06:30:00Z'));
 assert.throws(()=>localInstant('2024-10-06','02:15','Australia/Lord_Howe'),errorCode('birth_gap'));
 assert.equal(localInstant('2024-04-07','01:45','Australia/Lord_Howe','later').at-localInstant('2024-04-07','01:45','Australia/Lord_Howe').at,1800000);
 assert.throws(()=>localInstant('2011-12-30','12:00','Pacific/Apia'),errorCode('birth_gap'));
 assert.throws(()=>localInstant('2000-01-01','12:00','Fake/Nowhere'),errorCode('birth_zone'));
});
test('birth cities and explicit custom locations preserve coordinates without default geolocation',()=>{
 assert.equal(PLACES.length,40);assert.equal(new Set(PLACES.map(p=>p[0])).size,40);
 for(const p of PLACES){const b=normalizeBirth({...full,placeId:p[0]},NOW);assert.equal(b.place.zone,p[2]);assert.equal(b.complete,true);}
 const custom={...full,placeId:'custom',zone:'Europe/Paris',lat:65,lon:-180};
 assert.equal(normalizeBirth(custom,NOW).place.lat,65);
 for(const change of [{lat:65.01},{lon:180.01},{lat:null},{lat:''},{lon:' '},{zone:'Fake/Nowhere'}])assert.throws(()=>normalizeBirth({...custom,...change},NOW));
 assert.equal(normalizeBirth({date:full.date},NOW).place,null);
});
test('birth civil today follows the selected zone and Unix epoch is a valid instant',()=>{
 const now=Date.parse('2026-10-16T16:30:00Z');
 assert.equal(normalizeBirth({date:'2026-10-17',placeId:'taipei'},now).date,'2026-10-17');
 assert.equal(normalizeBirth({...full,date:'1970-01-01',time:'08:00'},NOW).instant,0);
});
test('published lunar library four-pillar fixtures preserve midnight day convention',()=>{
 // Upstream published fixtures: https://github.com/6tail/lunar-javascript/blob/master/__tests__/EightChar.test.js
 const fixtures=[['2005-12-23','08:37',['乙酉','戊子','辛巳','壬辰']],['1988-02-15','23:30',['戊辰','甲寅','庚子','戊子']],['1988-02-02','22:30',['丁卯','癸丑','丁亥','辛亥']]];
 for(const [date,time,expected] of fixtures)assert.deepEqual(natal({...full,date,time},NOW).bazi.pillars,expected);
});
test('solar term year/month change at Li Chun independently of lunar new year and birth time zone',()=>{
 const before=natal({...full,date:'2024-02-04',time:'16:26'},NOW),after=natal({...full,date:'2024-02-04',time:'16:28'},NOW);
 assert.deepEqual(before.bazi.pillars.slice(0,2),['癸卯','乙丑']);assert.deepEqual(after.bazi.pillars.slice(0,2),['甲辰','丙寅']);
 assert.deepEqual(before.purple,after.purple); // Ziwei keeps civil lunar year/hour while Bazi changes at the solar term.
 assert.equal(natal({...full,date:'2024-02-08'},NOW).bazi.pillars[0],'甲辰');
 const ny=natal({...full,date:'2024-02-04',time:'03:28',placeId:'newyork'},NOW);assert.deepEqual(ny.bazi.pillars.slice(0,2),after.bazi.pillars.slice(0,2));
});
test('missing time, birthplace or sex remains inspiration and never fabricates purple/vedic charts',()=>{
 for(const missing of [{time:null},{placeId:null},{sex:null},{sex:'unknown'}]){
  const chart=natal({...full,...missing},NOW);assert.equal(chart.coverage,'inspiration');assert.equal(chart.purple,null);assert.equal(chart.vedic,null);
  const signals=dailySignals(chart,'2026-10-16');assert.equal(signals.purple,null);assert.equal(signals.vedic,null);assert.equal(chart.birth.sex,missing.sex!==undefined?null:'f');
 }
 assert.equal(natal({...full,time:null},NOW).bazi.pillars.length,3);
});
test('complete chart covers twelve palaces, seven planets and distinct yearly/monthly/daily flows',()=>{
 const chart=natal(full,NOW),signal=dailySignals(chart,'2026-10-16'),next=dailySignals(chart,'2026-10-17');
 assert.equal(chart.coverage,'three-traditions');assert.equal(chart.purple.palaces.length,12);assert.equal(new Set(chart.purple.palaces.map(p=>p.name)).size,12);
 assert.equal(Object.keys(chart.vedic.planets).length,7);assert.ok(Object.values(chart.vedic.planets).every(n=>Number.isFinite(n)&&n>=0&&n<360));
 for(const category of ['health','work','love']){const rows=signal.purple[category];assert.equal(rows.length,3);assert.deepEqual(rows.map(x=>x.index),[4,9,3]);assert.ok(rows.every(p=>p.palace&&p.mutagen.length===4));}
 assert.equal(signal.flow[0],next.flow[0]);assert.equal(signal.flow[1],next.flow[1]);assert.notEqual(signal.flow[2],next.flow[2]);assert.notEqual(signal.purple.health[2].index,next.purple.health[2].index);
 assert.ok(Object.values(signal.vedic.houses).every(v=>v>=1&&v<=12));assert.ok(signal.vedic.dasha.start<=Date.parse('2026-10-16T12:00:00+08:00'));assert.ok(signal.vedic.dasha.end>Date.parse('2026-10-16T12:00:00+08:00'));
});
test('approximate Lahiri mean is anchored to published Swiss Ephemeris and stays within stated tolerance',()=>{
 // https://www.astro.com/swisseph/swisseph.htm Appendix E: mean, non-nutated TT reference values.
 const reference=[[Date.UTC(2000,0,1,12),23+51/60+25.5324/3600],[Date.UTC(2019,0,1,12),24+7/60+21.1353/3600],[Date.UTC(2020,0,1,12),24+8/60+11.3962/3600]];
 for(const [at,value] of reference)assert.ok(Math.abs(ayanamsa(at)-value)<2/60);
 // Same document Appendix C Test 3: geocentric apparent Mars longitude at 2016-10-25 00:00 TT.
 const at=Date.UTC(2016,9,25)-68507,tropical=(sky(at).Mars+ayanamsa(at))%360;assert.ok(Math.abs(tropical-288.970071)<2/60);
 assert.ok(ascendant(NOW,65,180)>=0&&ascendant(NOW,-65,-180)<360);
});
test('Vimshottari boundary advances exactly at the period end',()=>{
 const at=Date.UTC(2000,0,1),first=dasha(at,0,at),last=dasha(at,0,first.end-1),next=dasha(at,0,first.end+1);
 assert.equal(first.lord,'Ketu');assert.equal(last.lord,'Ketu');assert.equal(next.lord,'Venus');assert.ok(next.end>first.end);
 const partial=dasha(at,20/3,at),halfPeriod=3.5*365.2425*86400000;assert.equal(partial.start,Math.round(at-halfPeriod));assert.equal(partial.end,Math.round(at+halfPeriod));
});
test('computed ascendant geometrically lies on the eastern horizon across supported latitudes',()=>{
 for(const [lat,lon] of [[25.033,121.5654],[65,180],[-65,-180],[0,0]]){
  const date=new Date(NOW),tropical=(ascendant(NOW,lat,lon)+ayanamsa(NOW))%360;
  const ecliptic=Astronomy.VectorFromSphere(new Astronomy.Spherical(0,tropical,1),date);
  const equatorial=Astronomy.EquatorFromVector(Astronomy.RotateVector(Astronomy.Rotation_ECT_EQD(date),ecliptic));
  const horizon=Astronomy.Horizon(date,new Astronomy.Observer(lat,lon,0),equatorial.ra,equatorial.dec);
  assert.ok(Math.abs(horizon.altitude)<.01,`ascendant altitude ${horizon.altitude}`);assert.ok(horizon.azimuth>0&&horizon.azimuth<180);
 }
});
