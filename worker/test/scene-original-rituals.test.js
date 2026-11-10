import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/scene-original-rituals.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(kind='enhance'){let resolveGesture,resolveCommit,disposed=0;const reveals=[],calls=[];const node=()=>({className:'',hidden:false,isConnected:true,children:[],dataset:{},classList:{add(){},remove(){}},setAttribute(){},append(...v){this.children.push(...v);if(this===head)for(const n of v)n.onload?.();},remove(){this.isConnected=false;},focus(){},querySelectorAll(){return [];}});
 const head=node(),box=node(),label=node(),fg=node();box.querySelector=s=>s==='.fr-auto'?null:s==='.fg-box'?fg:label;
 const doc={head,querySelector(){return null;},createElement(){return box;}};const parent=node(),root={ownerDocument:doc,inert:false,closest:()=>parent};
 const api={dispose(){disposed++;},prepare(){return new Promise(r=>resolveGesture=r);},reveal(...v){reveals.push(v);}};
 const env={document:doc,window:{RpgForgeRitual:api},Map,Promise,Date,setTimeout:fn=>{fn();return 1;}};vm.runInNewContext(source,env);
 const h=env.window.RpgSceneRituals.forge(root,{item:{},plan:{kind,mode:'normal',cost:{name:'原卷',scrolls:1,gold:0}},icon:'',current:()=>true,commit(){calls.push('commit');return new Promise(r=>resolveCommit=r);}});
 return {h,root,box,reveals,calls,gesture:v=>resolveGesture(v),result:v=>resolveCommit(v),disposed:()=>disposed};
}
test('original forge cancellation does not submit an enhancement',async()=>{const f=fixture();await flush();assert.equal(f.root.inert,true);assert.equal(f.calls.length,0);f.gesture(false);await flush();await f.h.done;assert.equal(f.calls.length,0);assert.equal(f.root.inert,false);assert.equal(f.disposed(),1);});
test('forge submits only after original gesture, blocks close while pending and reveals the actual result',async()=>{const f=fixture();await flush();f.gesture(true);await flush();assert.equal(f.calls.length,1);assert.equal(f.h.close(),false);assert.equal(f.reveals.length,0);f.result({action:'enhance',result:{result:'break',to:9}});await flush();assert.equal(f.reveals[0][1],'break');assert.equal(f.h.close(),true);assert.equal(f.root.inert,false);assert.equal(f.disposed(),1);});
test('unknown forge outcome cannot invent a success or shatter presentation',async()=>{const f=fixture();await flush();f.gesture(true);await flush();f.result(null);await flush();assert.equal(f.reveals.length,0);assert.match(f.box.querySelector('.fr-instruction').textContent,/待核對/);f.h.close();});

test('the retained reroll animation displays the committed before and after quality',async()=>{const f=fixture('reroll');await flush();f.gesture(true);await flush();f.result({action:'reroll',result:{itemName:'原裝備',before:{quality:'B'},after:{quality:'C'}}});await flush();assert.equal(f.reveals[0][1],'reroll');assert.equal(f.box.querySelector('.fr-name').textContent,'原裝備 · 品質 B → C');f.h.close();});
