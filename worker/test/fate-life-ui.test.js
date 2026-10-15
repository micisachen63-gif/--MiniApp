import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderLifeUI,paintLifeUI} from '../public/fate/life-ui.js';
import {createLife,advanceLife} from '../public/fate/life.js';
class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.className='';this.textContent='';this.isConnected=true;this.hidden=false;this.attributes={};this.scrollTop=0;this.scrollHeight=100;this.clientHeight=100;this.classList={add:name=>{this.className+=' '+name;}};}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=[...items];}
 setAttribute(key,value){this.attributes[key]=value;}
 matches(selector){return selector.startsWith('.')?this.className.split(' ').includes(selector.slice(1)):this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){const split=selector.split(' ');if(split.length>1)return this.querySelectorAll(split[0]).flatMap(e=>e.querySelectorAll(split.slice(1).join(' ')));const all=[];for(const e of this.children){if(e.matches(selector))all.push(e);all.push(...e.querySelectorAll(selector));}return all;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
const at=s=>Date.parse(s+'+08:00');
function fixture(){
 globalThis.document={createElement:tag=>new Element(tag)};
 const draft=createLife({version:4,orbit:11,seed:'deadbeef',startedAt:at('2026-10-16T23:35:00')});draft.clockAt=at('2026-10-16T23:59:30');
 const panel=new Element('section');renderLifeUI(panel,{draft,soulCount:0,startedToday:1,preview:false,onChoice(){},onDaily(){},onArchive(){}});return {draft,panel,buttons:()=>panel.querySelectorAll('.fate-live-question button')};
}
test('night immediately closes live choice and the same pending choice reopens at six without changing authoritative answers',()=>{
 const t=fixture(),snapshot=structuredClone(t.draft);assert.ok(t.buttons().every(b=>!b.disabled));
 paintLifeUI(t.panel,t.draft,false,at('2026-10-17T00:00:00'));assert.ok(t.buttons().every(b=>b.disabled));assert.equal(t.panel.querySelector('.fate-night-note').hidden,false);assert.match(t.panel.querySelector('.fate-choice-left').textContent,/夜間暫停/);
 paintLifeUI(t.panel,t.draft,false,at('2026-10-17T06:00:20'));assert.ok(t.buttons().every(b=>!b.disabled));assert.equal(t.panel.querySelector('.fate-night-note').hidden,true);assert.match(t.panel.querySelector('.fate-choice-left').textContent,/10 秒/);assert.deepEqual(t.draft,snapshot);
});
test('exact deadline disables clamped display immediately and never invents a choice or completed life',()=>{
 const t=fixture(),deadline=at('2026-10-17T06:00:30');t.draft.clockAt=deadline-1;const snapshot=structuredClone(t.draft);
 paintLifeUI(t.panel,t.draft,false,deadline);assert.ok(t.buttons().every(b=>b.disabled));assert.match(t.panel.querySelector('.fate-choice-left').textContent,/已截止/);assert.deepEqual(t.draft,snapshot);assert.equal(t.draft.answers.length,0);assert.ok(t.panel.querySelector('.fate-story-feed').children.every(row=>!row.dataset.eventId.startsWith('choice-')));
});
test('cloud painting requests boundary sync once while retaining the server draft and honoring in-flight mutation disable',()=>{
 const source=readFileSync(new URL('../public/fate/app.js',import.meta.url),'utf8'),start=source.indexOf('function paintCloudLife(){'),end=source.indexOf('\nasync function openDaily',start),fn=source.slice(start,end),t=fixture();
 let clock=at('2026-10-17T06:00:30'),syncs=0;const calls=[],context={stage:'life',cloud:{active:{draft:t.draft}},document:{querySelector:()=>t.panel},cloudNow:()=>clock,advanceLife,cloudDisplayLife:()=>t.draft,paintLifeUI:(...args)=>calls.push(args),syncCloud:()=>syncs++,mutating:false};vm.createContext(context);vm.runInContext(fn,context);
 const snapshot=structuredClone(t.draft);context.paintCloudLife();context.paintCloudLife();assert.equal(syncs,1);assert.equal(calls[0][3],clock);assert.deepEqual(t.draft,snapshot);
 context.mutating=true;clock=at('2026-10-16T23:59:40');context.paintCloudLife();assert.ok(t.buttons().every(b=>b.disabled));
});
test('an event opening requests fresh server state immediately instead of waiting for the poll interval',()=>{
 const source=readFileSync(new URL('../public/fate/app.js',import.meta.url),'utf8'),start=source.indexOf('function paintCloudLife(){'),end=source.indexOf('\nasync function openDaily',start),t=fixture();
 t.panel.children=t.panel.children.filter(e=>!e.matches('.fate-live-question'));t.draft.clockAt=at('2026-10-16T23:58:59');let clock=t.draft.clockAt,syncs=0;
 const context={stage:'life',cloud:{active:{draft:t.draft}},document:{querySelector:()=>t.panel},cloudNow:()=>clock,advanceLife,cloudDisplayLife:()=>t.draft,paintLifeUI(){},syncCloud:()=>syncs++,mutating:false};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 context.paintCloudLife();assert.equal(syncs,0);clock=at('2026-10-16T23:59:00');context.paintCloudLife();context.paintCloudLife();assert.equal(syncs,1);assert.deepEqual(t.draft.answers,[]);
});
