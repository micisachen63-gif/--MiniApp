import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Exercise the DOM presentation with explicit present-time facts, so a scenario
// generator change cannot silently weaken accessibility, disclosure or stability.
const reference={usdTwd:31.438,fxDate:'2025-12-31',wealth:[{min:0,max:10000,share:40.7},{min:10000,max:100000,share:41.3},{min:100000,max:1000000,share:16.4},{min:1000000,max:Infinity,share:1.6}],education:[{label:'國小',rate:88},{label:'國中',rate:78},{label:'高中職',rate:61},{label:'大專以上',rate:24}],fertility:2.25,sources:[{label:'財富資料',url:'https://example.com/report',year:2025,detail:'參考範圍'},{label:'無效來源',url:'javascript:alert(1)'}]};
const fixtureModule=`export const METRIC_REFERENCE=${JSON.stringify(reference).replace('"max":null','"max":Infinity')};export const metricsForLife=life=>life.metrics;export const metricPortrait=m=>({cards:[{key:'health',title:'健康',status:'身心尚穩',detail:'健康 '+Math.round(m.health)+'／100'},{key:'education',title:'學歷',status:m.education.label,detail:'一路走過的學習日常。'},{key:'wealth',title:'財富',status:'生活有了底氣',detail:'此世淨資產換算台幣。'},{key:'children',title:'子女',status:m.children+'名子女',detail:'目前故事裡的家庭日常。'}],question:'如果再活一次，你最想留住什麼？',comparison:'淨資產等值約'+Math.round(m.wealthTwd/29500)+'個月台灣平均生活費（非存款）',wealthMonths:Math.round(m.wealthTwd/29500)});`;
const fixtureUrl='data:text/javascript;base64,'+Buffer.from(fixtureModule).toString('base64');
const source=(await readFile(new URL('../public/fate/metrics-ui.js',import.meta.url),'utf8')).replace("'./life-metrics-v1.js'",JSON.stringify(fixtureUrl));
const {renderMetrics,renderLegacyMetrics}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.attributes={};this.className='';this._text='';this.open=false;}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;this._text='';}
 setAttribute(k,v){this.attributes[k]=String(v);}
 getAttribute(k){return this.attributes[k]??null;}
 querySelectorAll(selector){const matches=e=>selector.startsWith('.')?e.className.split(' ').includes(selector.slice(1)):e.tagName.toLowerCase()===selector;return this.children.flatMap(e=>[...(matches(e)?[e]:[]),...e.querySelectorAll(selector)]);}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
}
const doc={createElement:tag=>new Element(tag)},base=()=>({version:6,metrics:{version:1,birth:{name:'海岸之國'},age:29,health:73,education:{label:'高中職',index:3},wealthUsd:65000,wealthTwd:2043470,children:1}});
function render(life=base()){const target=new Element('div');renderMetrics(target,life,[],life.metrics.age,{doc});return target;}

test('first view presents four story portraits and one conversation question while comparison charts and sources start closed',()=>{
 const target=render(),portraits=target.querySelector('.fate-metric-portraits'),comparison=target.querySelector('.fate-metric-comparison');
 assert.equal(portraits.children.length,4);assert.deepEqual(portraits.children.map(c=>c.dataset.metric),['health','education','wealth','children']);
 assert.ok(portraits.children.every(c=>c.querySelector('.fate-metric-portrait-status')?.textContent&&c.querySelector('.fate-metric-portrait-detail')?.textContent));
 assert.equal(comparison.open,false);assert.equal(target.querySelector('.fate-metric-sources').open,false);assert.equal(comparison.querySelector('summary').textContent,'看看這一世落在哪裡');
 assert.equal(target.querySelectorAll('.fate-metric-question').length,1);assert.equal(portraits.querySelector('.fate-metric-chart'),null);assert.match(comparison.querySelector('.fate-metric-living').textContent,/淨資產等值約69個月台灣平均生活費（非存款）/);
 assert.doesNotMatch(portraits.textContent,/全球前|擊敗|百分位|命盤|命理|3人.*半夜|72%/);
});

test('four distinct charts expose current facts in readable text and accessible health meter without a fictitious global rank',()=>{
 const target=render(),cards=target.querySelector('.fate-metric-comparison').querySelectorAll('.fate-metric-card'),meter=target.querySelector('.fate-metric-health');
 assert.deepEqual(cards.map(c=>c.querySelector('h3').textContent),['健康','學歷','財富','子女']);
 assert.equal(meter.getAttribute('role'),'meter');assert.equal(meter.getAttribute('aria-valuenow'),'73');assert.equal(meter.getAttribute('aria-valuemax'),'100');assert.match(meter.getAttribute('aria-valuetext'),/73／100/);
 assert.match(target.textContent,/海岸之國 · 29 歲/);assert.match(cards[2].textContent,/NT\$ 204\.3萬/);assert.match(cards[3].querySelector('.fate-metric-reading').textContent,/1名 · 目前/);
 assert.doesNotMatch(target.textContent,/全球前|勝過|超越.*玩家|真實玩家|預計.*子女|終身.*子女/);
});

test('highlighted wealth range is correct at its USD boundaries and all observed shares remain visible',()=>{
 for(const [wealth,selected]of [[-100,0],[9999.99,0],[10000,1],[99999.99,1],[100000,2],[1000000,3]]){
  const life=base();life.metrics.wealthUsd=wealth;life.metrics.wealthTwd=wealth*reference.usdTwd;
  const rows=render(life).querySelector('.fate-metric-comparison').querySelectorAll('.fate-metric-card')[2].querySelectorAll('li');assert.equal(rows.length,4);assert.equal(rows.filter(r=>r.getAttribute('aria-current')==='true').length,1);assert.equal(rows[selected].getAttribute('aria-current'),'true');
  assert.deepEqual(rows.map(r=>r.querySelector('.fate-metric-bar-value').textContent),['40.7%','41.3%','16.4%','1.6%']);
 }
});

test('education stages are completion references and children are explicitly model estimates, never invented observed population',()=>{
 const target=render(),cards=target.querySelector('.fate-metric-comparison').querySelectorAll('.fate-metric-card'),education=cards[1],children=cards[3];
 assert.match(education.textContent,/不同年齡群體/);assert.match(education.textContent,/不相加/);assert.equal(education.querySelector('.is-current').querySelector('.fate-metric-bar-label').textContent,'高中職此世');
 assert.match(children.textContent,/模型參照/);assert.match(children.textContent,/並非真實家庭分布/);assert.equal(children.querySelector('.is-current').querySelector('.fate-metric-bar-label').textContent,'1 名此世');
 const early=base();early.metrics.education={label:'未完成小學',index:0};early.metrics.children=0;
 const earlyCards=render(early).querySelector('.fate-metric-comparison').querySelectorAll('.fate-metric-card');assert.equal(earlyCards[1].querySelector('.is-current'),null);assert.equal(earlyCards[3].querySelector('.is-current').querySelector('.fate-metric-bar-label').textContent,'0 名此世');
 for(const label of ['國小在學','尚未入學']){early.metrics.education.label=label;assert.equal(render(early).querySelector('.fate-metric-comparison').querySelectorAll('.fate-metric-card')[1].querySelector('.is-current'),null,'enrolment must not be presented as a completed qualification');}
});

test('under-eighteen balances and zero children are not located inside adult comparison bands, and markers start at adulthood',()=>{
 for(const age of [0,6,17.99,18]){
  const life=base();life.metrics.age=age;life.metrics.children=0;const target=render(life),comparison=target.querySelector('.fate-metric-comparison'),cards=comparison.querySelectorAll('.fate-metric-card'),wealth=cards[2],family=cards[3];
  if(age<18){
   assert.equal(wealth.querySelector('.is-current'),null);assert.equal(family.querySelector('.is-current'),null);assert.match(wealth.querySelector('.fate-metric-reading').textContent,/個人零用積蓄/);assert.match(wealth.textContent,/成人樣本僅作背景/);assert.match(family.textContent,/尚未到家庭階段/);assert.equal(comparison.querySelector('.fate-metric-living'),null);
  }else{assert.ok(wealth.querySelector('.is-current'));assert.ok(family.querySelector('.is-current'));assert.match(wealth.querySelector('.fate-metric-reading').textContent,/淨資產/);assert.ok(comparison.querySelector('.fate-metric-living'));}
 }
});

test('real v6 metric source and portrait integrate with presentation without leaking future family facts',async()=>{
 const {renderMetrics:actualRender}=await import('../public/fate/metrics-ui.js'),{metricsForLife,metricPortrait}=await import('../public/fate/life-metrics-v1.js');
 const life={version:6,seed:'deadbeef'},rows=[{age:12,kind:'education',educationIndex:1},{age:24,kind:'family',childCount:1},{age:28,kind:'family',childCount:2}];
 for(const age of [17,18,25,29]){
  const target=new Element('div'),metrics=metricsForLife(life,rows,age),portrait=metricPortrait(metrics);actualRender(target,life,rows,age,{doc});
  assert.deepEqual(target.querySelectorAll('.fate-metric-portrait-status').map(n=>n.textContent),portrait.cards.map(n=>n.status));
  const family=target.querySelector('.fate-metric-comparison').querySelectorAll('.fate-metric-card')[3];assert.match(family.querySelector('.fate-metric-reading').textContent,new RegExp('^'+(age<24?0:age<28?1:2)+'名'));
  assert.equal(Boolean(family.querySelector('.is-current')),age>=18);assert.equal(target.querySelector('.fate-metric-comparison').open,false);
 }
});

test('unchanged ticks preserve DOM and open sources; changed facts redraw while retaining the open source disclosure',()=>{
 const life=base(),target=render(life),section=target.children[0],details=target.querySelector('.fate-metric-sources'),comparison=target.querySelector('.fate-metric-comparison');details.open=true;comparison.open=true;
 renderMetrics(target,life,[],30,{doc});assert.equal(target.children[0],section);assert.equal(target.querySelector('.fate-metric-sources'),details);assert.equal(details.open,true);
 life.metrics={...life.metrics,age:29.002,health:73.1};renderMetrics(target,life,[],30,{doc});assert.equal(target.children[0],section,'sub-year/sub-point clock drift does not rebuild visually identical charts');
 life.metrics={...life.metrics,health:74};renderMetrics(target,life,[],30,{doc});assert.notEqual(target.children[0],section);assert.equal(target.querySelector('.fate-metric-sources').open,true);assert.equal(target.querySelector('.fate-metric-comparison').open,true);assert.equal(target.querySelector('.fate-metric-health').getAttribute('aria-valuenow'),'74');
});

test('old lives retain caller content; displayed source links and metrics are rendered as inert text',()=>{
 const target=new Element('div'),old=new Element('span');old.textContent='舊世紀錄';target.append(old);assert.equal(renderMetrics(target,{version:5},[],0,{doc}),false);assert.equal(target.children[0],old);
 const life=base();life.metrics.birth.name='<img src=x onerror=alert(1)>';life.metrics.education.label='<script>bad</script>';life.metrics.health=180;
 const result=render(life);assert.match(result.textContent,/<img src=x/);assert.equal(result.querySelector('img'),null);assert.equal(result.querySelector('script'),null);assert.equal(result.querySelector('.fate-metric-health').getAttribute('aria-valuenow'),'100');
 const links=result.querySelectorAll('a');assert.equal(links.length,1);assert.equal(links[0].href,'https://example.com/report');assert.equal(links[0].rel,'noopener noreferrer');
});

test('legacy portraits provide four human-readable statuses without fabricating diplomas, currency or family counts',()=>{
 const target=new Element('div'),life={version:5},rows=[{age:2,state:{energy:82,knowledge:100,wealth:88,bonds:60,reputation:42}},{age:40,state:{energy:10,knowledge:1,wealth:3,bonds:1,reputation:1}}];
 assert.equal(renderLegacyMetrics(target,life,rows,20,{doc}),true);const cards=target.querySelector('.fate-metric-portraits').children;
 assert.equal(cards.length,4);assert.match(cards[0].textContent,/還有力氣/);assert.match(cards[1].textContent,/這冊未記錄學歷/);assert.match(cards[2].textContent,/能說「不」/);assert.match(cards[3].textContent,/這冊未記錄家庭/);
 assert.doesNotMatch(cards.map(n=>n.textContent).join(''),/[0-9]|NT\$|台幣|臺幣|大學|大專|個孩子|名子女|全球前|排名/);
 const details=target.querySelector('.fate-metric-comparison');assert.equal(details.open,false);assert.equal(details.querySelectorAll('.fate-legacy-indicator').length,5);assert.match(details.textContent,/學習不等於學歷/);assert.match(details.textContent,/家計也不是實際資產/);
 assert.deepEqual(details.querySelectorAll('.fate-metric-health').map(n=>n.getAttribute('aria-valuenow')),['82','100','88','60','42'],'future states must not replace the current story scores');
});

test('legacy unchanged values retain cards and disclosure; updates preserve disclosure and unknown scores stay unknown',()=>{
 const target=new Element('div'),life={version:4},rows=[{age:2,state:{energy:50,knowledge:60,wealth:55,bonds:60,reputation:42}}];
 renderLegacyMetrics(target,life,rows,3,{doc});const first=target.children[0];target.querySelector('.fate-metric-comparison').open=true;
 renderLegacyMetrics(target,life,rows,4,{doc});assert.equal(target.children[0],first);assert.equal(target.querySelector('.fate-metric-comparison').open,true);
 renderLegacyMetrics(target,life,[...rows,{age:5,state:{energy:20,knowledge:60,wealth:25,bonds:60,reputation:42}}],5,{doc});assert.notEqual(target.children[0],first);assert.equal(target.querySelector('.fate-metric-comparison').open,true);assert.match(target.querySelector('.fate-metric-portraits').children[0].textContent,/休息/);
 const unknown=new Element('div');renderLegacyMetrics(unknown,{version:3},[],0,{doc});assert.ok(unknown.querySelectorAll('.fate-metric-health').every(n=>n.getAttribute('aria-valuenow')===null));assert.equal(unknown.querySelectorAll('.fate-metric-bar-value').filter(n=>n.textContent==='未記錄').length,5);assert.doesNotMatch(unknown.querySelector('.fate-metric-portraits').textContent,/0|零|NT\$/);
 assert.equal(renderLegacyMetrics(unknown,{version:6},[],0,{doc}),false);
});
