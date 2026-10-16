import test from 'node:test';
import assert from 'node:assert/strict';
import {createLife,advanceLife,addActive} from '../public/fate/life.js';
import {taiwanLifeState,taiwanStatusCards,renderLifeStatus,paintLifeStatus} from '../public/fate/locality-ui.js';
const start=Date.parse('2026-10-16T06:00:00+08:00'),make=()=>createLife({version:8,country:'TW',orbit:11,seed:'deadbeef',startedAt:start});
const card=(state,key)=>taiwanStatusCards(state).find(item=>item.key===key).text;
class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.className='';this.textContent='';}
 append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=nodes}setAttribute(key,value){this.attributes[key]=value}
 matches(selector){return selector[0]==='.'?this.className.split(' ').includes(selector.slice(1)):this.tagName.toLowerCase()===selector}
 querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)])}querySelector(selector){return this.querySelectorAll(selector)[0]||null}
}
const text=node=>[node.textContent,...node.children.map(text)].join(' ');

test('Taiwan status does not infer automatic outcomes from a stale draft or reveal an early submitted choice before deadline',()=>{
 const life=make(),open=advanceLife(life,start).nextAt,initial=taiwanLifeState(life),stale={...life,clockAt:addActive(open,90000+300000)};
 assert.deepEqual(taiwanLifeState(stale),initial,'past-due display time alone cannot make an unconfirmed answer');
 const submitted={...life,clockAt:open+20000,answers:[0],sources:['manual']};assert.deepEqual(taiwanLifeState(submitted),initial);
 const after={...submitted,clockAt:addActive(open,90000)};assert.notDeepEqual(taiwanLifeState(after),initial);assert.deepEqual(life,make(),'replaying status never changes the original draft');
});

test('night hours do not silently advance a Taiwan status state',()=>{
 const at=Date.parse('2026-10-16T23:58:00+08:00'),life=createLife({version:8,country:'TW',seed:'deadbeef',orbit:11,startedAt:at}),midnight={...life,clockAt:Date.parse('2026-10-17T00:00:00+08:00')},night={...life,clockAt:Date.parse('2026-10-17T03:00:00+08:00')};assert.deepEqual(taiwanLifeState(midnight),taiwanLifeState(night));
});

test('knowledge and an unearned education label cannot turn into a degree',()=>{
 const state=taiwanLifeState(make());for(const patch of [{knowledge:100},{knowledge:100,education:'bachelor'},{teacherDegreeCompleted:true,education:'school'}])assert.doesNotMatch(card({...state,...patch},'education'),/學士|畢業|碩士|博士/);
 assert.match(card({...state,education:'bachelor',teacherDegreeCompleted:true},'education'),/學士學位已完成/);assert.match(card({...state,education:'college-course'},'education'),/試讀/);assert.match(card({...state,education:'work-study'},'education'),/進修/);assert.match(card({...state,education:'paused'},'education'),/暫停/);
});

test('unwritten relationship state does not invent marriage or children and respects each actual family transition',()=>{
 const state=taiwanLifeState(make());assert.match(card(state,'family'),/還沒寫進伴侶／育兒篇章/);assert.doesNotMatch(card(state,'family'),/已走進婚姻|已確認伴侶|照顧 \d+ 名孩子/);
 assert.match(card({...state,partnerCommitted:true},'family'),/已確認伴侶關係/);assert.doesNotMatch(card({...state,partnerCommitted:true},'family'),/已走進婚姻/);assert.match(card({...state,partnerCommitted:true,married:true},'family'),/育兒篇章還沒有開始/);assert.match(card({...state,children:1},'family'),/照顧 1 名孩子/);assert.match(card({...state,childfreeByChoice:true},'family'),/暫不育兒/);
});

test('Taiwan status paints four scene-based cards with a collapsible factual NTD ledger and keeps old lives unchanged',()=>{
 globalThis.document={createElement:tag=>new Element(tag)};const panel=new Element('section'),life=make(),state=taiwanLifeState(life);renderLifeStatus(panel,life);assert.equal(panel.querySelectorAll('.fate-status-card').length,4);const detail=panel.querySelector('details');assert.ok(!detail.open);assert.match(text(panel),/劇情帳/);assert.doesNotMatch(text(panel),/%|全球|百分位|月薪|第\s*\d+\s*名/);
 assert.deepEqual(panel.querySelectorAll('dd').map(node=>node.textContent),[state.moneyNtd,state.debtNtd,state.moneyNtd-state.debtNtd].map(value=>'NT$ '+value.toLocaleString('zh-TW')));
 const open=advanceLife(life,start).nextAt,early={...life,clockAt:open+20000,answers:[0],sources:['manual']},before=text(panel);detail.open=true;paintLifeStatus(panel,early);assert.equal(text(panel),before);paintLifeStatus(panel,{...early,clockAt:addActive(open,90000)});assert.equal(detail.open,true);assert.notEqual(panel.querySelector('.fate-local-status').dataset.state,JSON.stringify(state));
 const old=new Element('section');assert.equal(renderLifeStatus(old,{...life,version:7}),null);paintLifeStatus(old,{...life,version:7});assert.equal(old.children.length,0);
 const finance=card({...state,moneyNtd:125000,debtNtd:85000},'finance');assert.match(finance,/NT\$ 125,000/);assert.match(finance,/NT\$ 85,000/);
});
