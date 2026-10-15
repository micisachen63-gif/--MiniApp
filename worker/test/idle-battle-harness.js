import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/battle.js', import.meta.url), 'utf8');
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.nodes = new Map(); this.dataset = {}; this.attrs = {}; this.style = {setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}};
    const classes = new Set(); this.classList = {add(...cs){cs.forEach(c=>classes.add(c));},remove(...cs){cs.forEach(c=>classes.delete(c));},contains:c=>classes.has(c),toggle(c,on){on ??= !classes.has(c);on?classes.add(c):classes.delete(c);return on;}};
    this.isConnected = true; this.clientWidth = 390; this.clientHeight = 240; this.offsetWidth = 70; this.offsetLeft = 0; this.naturalWidth = 0; this.hidden = false; this.textContent = ''; this.listeners = new Map();
  }
  querySelector(s) { if (!this.nodes.has(s)) this.nodes.set(s, new Element(s.includes('img')?'img':'div')); return this.nodes.get(s); }
  querySelectorAll(s) { return s === '.tint' ? ['r','g','b','k'].map(c=>this.querySelector('.tint.'+c)) : []; }
  cloneNode() { return new Element(this.tagName); }
  append(...nodes) { for(const n of nodes){this.children.push(n);n.parentNode=this;} }
  appendChild(n) { this.append(n);return n; }
  replaceChildren(...nodes) { this.children.length=0;this.append(...nodes); }
  remove() { if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this); }
  setAttribute(k,v) { this.attrs[k]=String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k,f) { this.listeners.set(k,f); }
  getBoundingClientRect() { return {x:0,y:0,left:0,top:0,width:100,height:150}; }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0]; }
}

export function idleBattleHarness({reducedMotion=true,groupSize=4,random=()=>0.9}={}) {
  const timers = new Map(), errors = [], requests = []; let clock=0, next=0;
  const document = {hidden:false,createElement:t=>new Element(t),addEventListener(){}};
  const context = vm.createContext({window:{matchMedia:()=>({matches:reducedMotion,addEventListener(){}})},document,console:{warn:(...a)=>errors.push(a)},Image:class {},ResizeObserver:class {observe(){}},fetch:url=>{requests.push(url);return Promise.resolve({ok:true,json:async()=>({})});},performance:{now:()=>clock},requestAnimationFrame(){},setTimeout(f,ms){const id=++next;timers.set(id,{at:clock+ms,f});return id;},clearTimeout:id=>timers.delete(id),Math:Object.assign(Object.create(Math),{random}),Map,Set});
  vm.runInContext(source,context);
  const battle=context.window.RpgBattle.create({groupSize,src:(kind,key)=>`${kind}/${key}`,items:{red_1:{name:'小紅水',heal:1000},scroll:{name:'強化卷軸'}},fmt:String,stateInfo:me=>({text:me.character.state,cls:''})});
  async function advance(ms) {
    const end=clock+ms;
    for(let guard=0;guard<5000;guard++) {
      for(let i=0;i<12;i++)await Promise.resolve();
      const event=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];
      if(!event||event[1].at>end){clock=end;return;}
      clock=event[1].at;timers.delete(event[0]);event[1].f();
    }
    throw new Error('fake clock did not settle');
  }
  return {battle,root:battle.el,advance,document,errors,requests};
}

export const idleMe = (change={}) => ({character:{tgId:'111',revision:1,baseClass:'sword',classPath:'',gender:'m',mapId:1,level:20,state:'fighting',hp:77,maxHp:100,mp:31,maxMp:50,...change},battle:{monsters:['史萊姆','樹妖','骷髏兵','毒蜘蛛'],elite:'劇毒巨蛛',atk:500,crit:1,hpLossPerTick:100,eliteBurst:1000,skill:{name:'烈焰斬',mult:10,cost:500,targets:4}}});
export const idleReport = (change={}) => ({from_at:0,to_at:60000,ticks:1,kills:8,exp_gained:123,gold_gained:77,elites:1,exp_lost:0,drops:{scroll:7},used:{red_1:2},relics:[],...change});
