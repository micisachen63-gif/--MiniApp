import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {HOURLY_ENCOUNTERS,SCENES} from '../src/game/star-ring.js';
const base=new URL('../public/art/star-ring-20261018/',import.meta.url),worker=new URL('../',import.meta.url),sha=x=>createHash('sha256').update(x).digest('hex');
test('all twelve new expedition enemies have sixteen distinct authored actions and matching approved source, atlas and still hashes',()=>{
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8')),entries=manifest.monsters;
 assert.equal(entries.length,12);assert.equal(new Set(entries.map(e=>e.key||e.id)).size,12);
 const atlases=new Set(),stills=new Set();
 for(const stage of HOURLY_ENCOUNTERS){
  const e=entries.find(e=>(e.key||e.id)===stage.enemyId);assert.ok(e,stage.enemyId);
  assert.equal(e.cols,4);assert.equal(e.rows,4);assert.equal(e.frames,16);assert.equal(e.attackDirection,-1);
  assert.equal(e.feet,.9375);assert.equal(e.frameBounds.length,16);
  assert.deepEqual([e.idle,e.move,e.attack,e.cast,e.hurt,e.death],[[0,1,2,3],[4,5,6,7],[8,9,10,11],[12,13],[14],[15]]);
  for(const b of e.frameBounds){assert.equal(b.length,4);assert.ok(b.every(n=>Number.isFinite(n)&&n>=0&&n<=1));assert.ok(b[2]>b[0]&&b[3]>b[1]);}
  const q=e.technicalQA;assert.equal(q.pass,true);assert.equal(q.frames,16);assert.equal(q.distinct,16);assert.ok(q.minMargin>=24);assert.equal(new Set(q.frameHashes).size,16);
  assert.match(e.source,/^art-production\/star-ring-20261018\/source\/[A-Za-z0-9_.-]+\.png$/);
  const sourceHash=sha(readFileSync(new URL(e.source,worker)));assert.equal(sourceHash,e.sourceHash);assert.equal(sourceHash,q.sourceHash);
  const serial=String(stage.artIndex).padStart(2,'0');assert.equal(e.atlas,`monster-${serial}_attack.webp`);assert.equal(e.still,`monster-${serial}.webp`);
  const atlasHash=sha(readFileSync(new URL(e.atlas,base))),stillHash=sha(readFileSync(new URL(e.still,base)));
  assert.equal(atlasHash,q.assetHash);assert.equal(stillHash,q.stillHash);atlases.add(atlasHash);stills.add(stillHash);
  assert.equal(e.sceneQA.desktop,true);assert.equal(e.sceneQA.mobile,true);assert.equal(e.sceneQA.assetHash,atlasHash);assert.equal(e.sceneQA.stillHash,stillHash);assert.equal(e.sceneQA.sourceHash,sourceHash);
 }
 assert.equal(atlases.size,12);assert.equal(stills.size,12);
});
test('each hourly scene has its own real map image and downloaded verified video',()=>{
 assert.equal(SCENES.length,12);const maps=new Set(),movies=new Set();
 for(const [i,s]of SCENES.entries()){
  const serial=String(i+1).padStart(2,'0');assert.equal(s.image,`/art/star-ring-20261018/map-${serial}.webp`);assert.equal(s.video,`/art/star-ring-20261018/map-${serial}.mp4`);
  const picture=readFileSync(new URL(`map-${serial}.webp`,base)),movie=readFileSync(new URL(`map-${serial}.mp4`,base));
  assert.equal(picture.toString('ascii',8,12),'WEBP');assert.ok(movie.includes(Buffer.from('ftyp')));assert.ok(movie.length>100000);maps.add(sha(picture));movies.add(sha(movie));
 }
 assert.equal(maps.size,12);assert.equal(movies.size,12);
});
