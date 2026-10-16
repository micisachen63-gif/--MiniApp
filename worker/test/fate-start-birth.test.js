import test from 'node:test';
import assert from 'node:assert/strict';
import {renderStartBirthFields} from '../public/fate/profile-ui.js';
import {PLACES} from '../public/fate/places.js';
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.listeners={};this.value='';this.hidden=false;}
 set value(v){this._value=String(v);}
 get value(){return this._value;}
 append(...children){this.children.push(...children);}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(type,fn){this.listeners[type]=fn;}
 all(tag){return this.children.filter(c=>typeof c==='object').flatMap(c=>[...(c.tag===tag?[c]:[]),...c.all(tag)]);}
 change(value){this.value=value;this.listeners.change?.();}
}
test('entry birth details expose optional time and forty city choices without duplicating birthday or requiring consent',()=>{
 globalThis.document={createElement:tag=>new Element(tag)};const p=new Element('div'),changes=[];
 const fields=renderStartBirthFields(p,{onChange:state=>changes.push(state)}),inputs=p.all('input'),selects=p.all('select');
 assert.equal(inputs.filter(i=>i.type==='time').length,1);assert.equal(inputs.filter(i=>i.type==='date').length,0);
 const place=selects.find(i=>i.attributes['aria-label']==='出生地 · 選填');assert.equal(place.children.length,PLACES.length+2);assert.equal(place.hidden,false);
 assert.equal(fields.consented(),false);assert.deepEqual(fields.read(),{time:null,placeId:null,sex:null,fold:'earlier'});assert.equal(changes.length,0);
 inputs.find(i=>i.type==='time').change('08:35');place.change('taipei');assert.equal(fields.read().time,'08:35');assert.equal(fields.read().placeId,'taipei');assert.equal(changes.at(-1).consent,false);assert.ok(!('date'in changes.at(-1)));
});
test('entry custom place fields appear only on selection and round-trip memory/consent independently of submit data',()=>{
 globalThis.document={createElement:tag=>new Element(tag)};const p=new Element('div'),states=[];
 const fields=renderStartBirthFields(p,{value:{time:'01:30',placeId:'custom',sex:'f',fold:'later',placeLabel:'Queens',zone:'America/New_York',lat:40.7,lon:-73.8,consent:true},onChange:state=>states.push(state)});
 const custom=p.children[0].children.find(i=>i.className==='fate-custom-place');assert.equal(custom.hidden,false);assert.equal(fields.consented(),true);assert.deepEqual(fields.read(),{time:'01:30',placeId:'custom',sex:'f',fold:'later',placeLabel:'Queens',zone:'America/New_York',lat:40.7,lon:-73.8});
 const place=p.all('select').find(i=>i.attributes['aria-label']==='出生地 · 選填');place.change('tokyo');assert.equal(custom.hidden,true);assert.ok(!('lat'in fields.read()));assert.equal(states.at(-1).zone,'America/New_York');
 const p2=new Element('div'),restored=renderStartBirthFields(p2,{value:states.at(-1)});assert.equal(restored.consented(),true);const restoredPlace=p2.all('select').find(i=>i.attributes['aria-label']==='出生地 · 選填');restoredPlace.change('custom');assert.equal(restored.read().zone,'America/New_York');
 const check=p2.all('input').find(i=>i.type==='checkbox');check.checked=false;check.change(check.value);assert.equal(restored.consented(),false);
 const lat=p2.all('input').find(i=>i.attributes['aria-label']==='緯度（-65 至 65）');lat.change('');assert.equal(restored.read().lat,null,'empty coordinate does not silently turn into zero');
});
