import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderLifeCountry,renderLifeIdentity,lifeIdentity} from '../public/fate/locality-ui.js';

class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.style={};this.value='';this.textContent='';this.className='';this.classList={add:name=>{this.className+=' '+name;}};}
 append(...children){this.children.push(...children);}
 setAttribute(key,value){this.attributes[key]=value;}
 all(tag){return this.children.flatMap(child=>[...(child.tagName===tag.toUpperCase()?[child]:[]),...child.all(tag)]);}
}
const copy=node=>[node.textContent,...node.children.map(copy)].join(' ');
const app=readFileSync(new URL('../public/fate/app.js',import.meta.url),'utf8');

test('life country offers only the authored Taiwan pack and labels nine future countries without a false global lottery',()=>{
 globalThis.document={createElement:tag=>new Element(tag)};const panel=new Element('section'),country=renderLifeCountry(panel),select=panel.all('select')[0];
 assert.equal(select.attributes['aria-label'],'這一世的出生地');assert.equal(select.children.length,10);
 assert.deepEqual(select.children.filter(item=>!item.disabled).map(item=>[item.value,item.textContent]),[['TW','台灣 · 台北／新北']]);
 assert.ok(select.children.slice(1).every(item=>item.disabled&&item.textContent.endsWith('製作中')));assert.equal(country.read(),'TW');
 select.value='US';assert.equal(country.read(),'TW','a manipulated selection cannot request an unpublished country');assert.doesNotMatch(copy(panel),/全球|機率/);
});

test('fictional Taiwan identity displays the generated city gender and family and leaves older lives untouched',()=>{
 globalThis.document={createElement:tag=>new Element(tag)};const observed=new Set();
 for(const seed of ['00000000','12345678','deadbeef','87654321']){const life={version:8,country:'TW',seed,orbit:11},panel=new Element('section'),id=lifeIdentity(life);renderLifeIdentity(panel,life);const text=copy(panel);
  assert.equal(panel.children[0].attributes['aria-label'],'這一世的出身');assert.match(id.place,/^[臺台]灣 · /);assert.ok(/[臺台]北|新北/.test(id.place));assert.ok(id.family&&id.title);assert.ok(text.includes(id.gender));assert.ok(text.includes(id.place));assert.ok(text.includes(id.family));observed.add(id.gender);
 }
 assert.equal(observed.size,2);for(const version of [1,4,5,7]){const panel=new Element('section');assert.equal(renderLifeIdentity(panel,{version,seed:'deadbeef',orbit:11}),null);assert.equal(panel.children.length,0);}
});

test('embedded launch sends the fictional country separately and never sends private optional birthplace or birth time in start',()=>{
 let request;const start=app.slice(app.indexOf('function startCycle(){'),app.indexOf('\nfunction persistLife()',app.indexOf('function startCycle(){')));
 const ctx={embedded:true,cloud:{},mode:'birthday',birthDetail:{date:'1990-01-01',time:'08:35',placeId:'tokyo',sex:'f'},showSign:true,sharedUI:{invite:false},cloudMutation:(action,body)=>{request={action,body}}};vm.runInNewContext(start,ctx);ctx.startCycle();
 assert.equal(request.action,'fate/start');assert.equal(request.body.country,'TW');assert.equal(request.body.birthDate,'1990-01-01');assert.ok(!('time'in request.body));assert.ok(!('placeId'in request.body));assert.ok(!('sex'in request.body));assert.equal(request.body.mode,'birthday');
});

test('v8 playback uses Taiwan dusk artwork while old lives retain their established media',()=>{
 const start=app.indexOf('function setupMedia(bg){'),end=app.indexOf('\nfunction render(){',start),fn=app.slice(start,end);let paused=0,played=0;
 const media={pause:()=>paused++,play:()=>{played++;return Promise.resolve()}};
 const ctx={stage:'life',currentLife:{version:8},result:null,media,document:{hidden:false}};vm.runInNewContext(fn,ctx);const taiwan=new Element('div');ctx.setupMedia(taiwan);
 assert.equal(paused,1);assert.equal(played,0);assert.equal(taiwan.children.length,0);assert.match(taiwan.style.backgroundImage,/fate-taiwan-v8\/taipei-dusk.webp/);
 ctx.currentLife={version:7};const old=new Element('div');ctx.setupMedia(old);assert.equal(played,1);assert.equal(old.children[0],media);assert.equal(old.style.backgroundImage,undefined);
});

test('Taiwan chronology retains authoritative consequence rows without adding old generic answer captions',()=>{
 const start=app.indexOf('function appendMemories('),end=app.indexOf('\nfunction renderSoul(',start),fn=app.slice(start,end);let sceneReads=0;
 const ctx={el:(tag,cls,text)=>{const n=new Element(tag);n.textContent=text||'';return n},ageLabel:age=>`${age} 歲`,scenesFor:()=>{sceneReads++;return [{age:18,choices:[['','','generic old answer']]}]}};vm.runInNewContext(fn,ctx);
 for(const version of [7,8]){const list=new Element('ol');ctx.appendMemories(list,{version,answers:[0]},[{age:21,kind:'choice',text:'你接下台北咖啡店的輪班工作。'}]);assert.equal(list.children.length,1);assert.equal(list.children[0].textContent,'21 歲 · 你接下台北咖啡店的輪班工作。');}
 assert.equal(sceneReads,2);
});
