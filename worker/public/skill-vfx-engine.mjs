/** StarJournal skill VFX. Presentation only: no combat, inventory or network writes. */
import { semanticFor } from './skill-vfx-semantics.mjs';
export const VFX_VERSION = 1;
export const ATLAS_CELLS = Object.freeze({ projectile:0, slash:1, impact:2, rune:3, sigil:4, shards:5, pillar:6, field:7, spark:8 });
const TAU = Math.PI * 2;
const clamp = (n,a=0,b=1) => Math.min(b,Math.max(a,n));
const lerp = (a,b,t) => a+(b-a)*t;
const smooth = t => (t=clamp(t))*t*(3-2*t);
const out = t => 1-Math.pow(1-clamp(t),3);
const finite = (n,fallback) => Number.isFinite(n) ? n : fallback;
const pulse = (t,start,end) => t<=start||t>=end ? 0 : Math.sin(Math.PI*(t-start)/(end-start));
const DIR = { right:0, down:Math.PI/2, left:Math.PI, up:-Math.PI/2 };
export const SUPPORTED_FAMILIES = Object.freeze(['slash','whirlwind','bleed','shield','counter','pierce','volley','rain','snipe','beast','summon','trap','lightning','frost','fireball','meteor','arcane','beam','heal','holy','buff','poison','execute','combo','dash','shadow','time','curse']);
const FAMILY_ALIAS = { arrow:'pierce',ice:'frost',chain:'lightning',chain_lightning:'lightning',wind:'volley',fire:'fireball',recovery:'heal',defend:'shield',guard:'shield',thorns:'trap',multi:'combo',burst:'arcane',strike:'slash' };
const PALETTE = {
 sword:['#ffc774','#fff3d2','#d64c43'], archer:['#73edbc','#e6ffd1','#37a595'],
 mage:['#9bcaff','#f3f2ff','#9770e9'], thief:['#bb9aff','#e6dfff','#6adbb8']
};
const TIME = {slash:1060,whirlwind:1480,bleed:1240,shield:1550,counter:1320,pierce:1180,volley:1520,rain:1800,snipe:1240,beast:1980,summon:2050,trap:1770,lightning:1260,frost:1660,fireball:1440,meteor:1880,arcane:1510,beam:1450,heal:1860,holy:1720,buff:1840,poison:1540,execute:1320,combo:1550,dash:1180,shadow:1600,time:1880,curse:1660};
const ELEMENT_PALETTE = Object.freeze({
 steel:['#e3c49a','#fff5dc','#a77859'], blood:['#ed627b','#ffe5df','#982449'],
 holy:['#f6df91','#fffde3','#c9984f'], nature:['#79db9b','#eaffce','#32876d'],
 wind:['#8fe7d2','#effffa','#3796ac'], lunar:['#c2d4f7','#fbfcff','#7074b1'],
 star:['#b7bcff','#fff3ff','#7562cd'], fire:['#ffb15e','#fff0cc','#d64c35'],
 ice:['#8bdfff','#efffff','#579ad2'], lightning:['#a5dbff','#fffde0','#626de7'],
 arcane:['#bda0ff','#f7eaff','#7650c4'], time:['#8bdbd6','#fff5c7','#548cb9'],
 void:['#b382f2','#e9d8ff','#593584'], poison:['#a5e567','#f5ffd5','#428259'],
 shadow:['#b597df','#f0e4ff','#694677'], water:['#81e3ed','#f2ffff','#358fb7'],
});
const EXTRA_ASSETS={hawk:'hawk.webp','fire-spirit':'fire-spirit.webp',semantic:'semantic-atlas.webp'};
function extraKeys(skill){const asset=semanticFor(skill).asset;return asset?[asset]:[];}
export function hash32(value) { let h=2166136261; for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);} return h>>>0; }
function rand(seed,i) { let a=(seed+Math.imul(i+1,0x9e3779b9))>>>0;a^=a>>>16;a=Math.imul(a,0x21f0aaad);a^=a>>>15;a=Math.imul(a,0x735a2d97);return ((a^(a>>>15))>>>0)/4294967296; }
export function recipeFor(skill) {
 if(!skill?.id||!PALETTE[skill.baseClass])throw new TypeError('A catalogued skill identity and class are required.');
 const family=FAMILY_ALIAS[skill.family]||skill.family;
 if(!SUPPORTED_FAMILIES.includes(family))throw new TypeError('Unsupported VFX family: '+String(skill.family)+' ('+skill.id+')');
 const tier=clamp(Number(skill.tier)||0,0,4), variant=hash32(skill.id);
 const support=['heal','buff','shield'].includes(skill.kind);
 const semantic=semanticFor(skill),colors=[...ELEMENT_PALETTE[semantic.element]];
 const impactAt=['beam','arcane','lightning'].includes(family)?.4:['heal','buff','shield','time','summon','beast'].includes(family)?.32:.57,impactEnd=Math.min(.86,impactAt+.23);
 return Object.freeze({id:skill.id,family,baseClass:skill.baseClass,kind:skill.kind||'attack',tier,variant,
   durationMs:TIME[family]+(variant%4)*30,impactAt,
   colors,support,semantic,phases:[{id:'charge',label:'蓄力',from:0,to:.22},{id:'release',label:'釋放',from:.22,to:impactAt},{id:'impact',label:support?'生效':'命中',from:impactAt,to:impactEnd},{id:'dissolve',label:'消散',from:impactEnd,to:1}],
   art:{atlas:skill.baseClass+'-atlas.webp',grid:[3,3],additional:extraKeys(skill).map(k=>EXTRA_ASSETS[k])},visualOnly:true});
}
export function validateCatalog(catalog) {
 if(catalog?.schemaVersion!==1||!Array.isArray(catalog.skills))throw new TypeError('Unsupported skill catalogue.');
 const ids=new Set();for(const skill of catalog.skills){if(ids.has(skill.id))throw new TypeError('Duplicate skill identity: '+skill.id);ids.add(skill.id);recipeFor(skill);}
 return {skillCount:ids.size,families:[...new Set(catalog.skills.map(s=>recipeFor(s).family))].sort()};
}
function point(p,f) {return {x:finite(p?.x,f.x),y:finite(p?.y,f.y)};}
function curve(a,b,t,bend=0) {const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;return{x:lerp(a.x,b.x,t)-dy/len*Math.sin(Math.PI*t)*bend,y:lerp(a.y,b.y,t)+dx/len*Math.sin(Math.PI*t)*bend};}

/** Deterministic frame plan; shared by live player, scrubbing and CPU tests. Coordinates are CSS pixels. */
export function buildEffectFrame(skill,progress,options={}) {
 const recipe=recipeFor(skill),t=clamp(finite(progress,0));
 const semantic=recipe.semantic,ancillarySupport=options.presentationMode==='support'&&!recipe.support;
 const supporting=recipe.support||options.presentationMode==='support';
 const supportKind=options.presentationMode==='support'&&['heal','shield','buff'].includes(options.supportKind)?options.supportKind:skill.kind;
 const family=supporting?(supportKind==='shield'?'shield':supportKind==='heal'?'heal':recipe.family==='time'?'time':'buff'):recipe.family;
 const body=clamp(finite(options.bodyHeight,150),36,480),scale=body/150;
 const from=point(options.from,{x:160,y:240}),dir=DIR[options.direction]??0;
 const summoning=options.presentationMode==='summon'||(skill.kind==='summon'&&options.presentationMode!=='impact');
 const local=(supporting&&options.presentationMode!=='impact')||options.presentationMode==='placement'||summoning;
 let to=point(options.to,{x:from.x+Math.cos(dir)*body*1.7,y:from.y+Math.sin(dir)*body*1.7});
 if(local)to={...from};
 // Supplied recipients are authoritative, including an explicitly empty list.
 // Match the live adapter's bound; near neighbours remain separate recipients.
 const explicitTargets=Array.isArray(options.targets),targets=[];
 for(const p of explicitTargets?options.targets:[to]){
   if(!Number.isFinite(p?.x)||!Number.isFinite(p?.y)||targets.some(q=>q.x===p.x&&q.y===p.y))continue;
   targets.push({x:p.x,y:p.y});if(targets.length===32)break;
 }
 if(!local&&targets.length)to={...targets[0]};
 const theta=to.x===from.x&&to.y===from.y?dir:Math.atan2(to.y-from.y,to.x-from.x);
 if(!local&&!explicitTargets&&options.showcaseTargets&&options.presentationMode!=='impact'){
   if(family==='volley')for(const side of [-1,1])targets.push({x:to.x+Math.sin(theta)*side*26*scale,y:to.y-Math.cos(theta)*side*26*scale});
   if(family==='lightning')targets.push({x:to.x+45*scale,y:to.y-62*scale},{x:to.x+83*scale,y:to.y+25*scale});
 }
 const seed=hash32(String(options.seed??recipe.variant)+skill.id),low=options.quality==='low';
 const layers=[],geometry=[]; const limit=low?48:94;
 function sprite(cell,x,y,w,h=w,rotation=0,alpha=1,blend='screen') {
   if(alpha<=.004||w<=0||h<=0||layers.length>=limit)return;
   layers.push({cell,x,y,w:w*scale,h:h*scale,rotation,alpha:clamp(alpha),blend,tint:recipe.colors[0],flipX:recipe.baseClass==='sword'&&cell===1});
 }
 function ring(p,r,alpha,tilt=.38,width=1.3,color=recipe.colors[0],rotation=0) {
   if(alpha<=.004||geometry.length>=64)return;geometry.push({kind:'ring',x:p.x,y:p.y,r:r*scale,tilt,width:width*scale,alpha:clamp(alpha),color,rotation});
 }
 function line(points,alpha,width=2,color=recipe.colors[0],glow=10) {
   if(alpha<=.004||geometry.length>=64)return;geometry.push({kind:'line',points,width:width*scale,alpha:clamp(alpha),color,glow:glow*scale});
 }
 function burst(p,k,power=1,angle=0,part='all') {
   if(k<=0||k>=1)return;const fade=Math.pow(1-k,1.7),radius=(22+out(k)*88)*power;
   if(part!=='detail'){
     const impactCell=recipe.baseClass==='mage'?(['fireball','meteor'].includes(family)?2:['frost','shield'].includes(family)?5:8):2;
     sprite(impactCell,p.x,p.y,(38+out(k)*152)*power,(38+out(k)*152)*power,angle,fade*.93);
     ring(p,radius,fade*.5,.72,1.3);
   }
   if(part==='core'||layers.length>=limit)return;
   const n=low?7:13;
   for(let i=0;i<n&&layers.length<limit;i++){
     const a=i/n*TAU+rand(seed,i)*.5+angle,r=radius*(.6+rand(seed,i+100)*.7)*scale;
     const px=p.x+Math.cos(a)*r,py=p.y+Math.sin(a)*r*.7;
     const size=(7+rand(seed,i+200)*13)*(1-k)*power;
     const particleCell=recipe.baseClass==='mage'?(['fireball','meteor'].includes(family)?0:['frost','shield'].includes(family)&&i%3===0?5:8):(i%3===0?5:8);
     sprite(particleCell,px,py,size,size,a,fade*(.4+rand(seed,i+300)*.5));
   }
 }
 function projectile(a,b,start,end,offset=0,cell=0,size=85,bend=0,part='all',contact=null) {
   const q=(t-start)/(end-start);if(q<0||q>1)return;
   function position(value){
     if(!contact)return curve(a,b,smooth(value),bend);
     const split=(contact.at-start)/(end-start);
     return value<=split?curve(a,contact.point,smooth(value/split),bend):curve(contact.point,b,smooth((value-split)/(1-split)));
   }
   const tail=back=>contact?position(clamp(q-back)):curve(a,b,clamp(smooth(q)-back),bend);
   const p=position(q),prev=tail(.03),dx=p.x-prev.x,dy=p.y-prev.y;
   const angle=dx===0&&dy===0?theta:Math.atan2(dy,dx);
   if(part!=='detail')sprite(cell,p.x,p.y+offset*scale,size,size*.72,angle,.92*pulse(q,-.08,1.12));
   if(part==='core')return;
   const points=Array.from({length:7},(_,i)=>tail(i*.025));
   line(points,Math.sin(Math.PI*q)*.8,3,recipe.colors[0],8);
   for(let i=0;i<(low?3:6)&&layers.length<limit;i++){const z=tail(i*.045);sprite(8,z.x,z.y+Math.sin(i*2+t*24)*4*scale,8*(1-i/8),8*(1-i/8),angle,(1-i/7)*pulse(q,-.1,1.12)*.5);}
 }
 function slash(p,start,end,angle=theta,power=1) {
   const q=(t-start)/(end-start);if(q<=0||q>=1)return;
   const a=angle+lerp(-.62,.38,out(q)),size=(100+out(q)*68)*power;
   sprite(1,p.x,p.y,size,size*.8,a,pulse(q,0,1)*.96);
   sprite(8,p.x+Math.cos(a)*35*scale,p.y+Math.sin(a)*35*scale,20,20,0,pulse(q,0,.8)*.6);
 }
 function field(p,k,power=1,atGround=false) {
   if(k<=0||k>=1)return;const alpha=pulse(k,0,1)*.6;
   sprite(7,p.x,p.y+(atGround?0:body*.34),140*power,58*power,k*.22,alpha);
   sprite(3,p.x,p.y+(atGround?0:body*.35),144*power,54*power,-k*.35,alpha*.67);
   ring({x:p.x,y:p.y+(atGround?0:body*.35)},71*power,alpha,.37,1.2);
 }
 function spirit(asset,p,size,angle,alpha,cell=semantic.cell??0){if(!asset||alpha<=.004||layers.length>=limit)return;layers.push({asset,cell,grid:asset==='semantic'?[3,3]:[1,1],x:p.x,y:p.y,w:size*scale,h:size*scale,rotation:Math.sin(angle)*.16,alpha:clamp(alpha),blend:'source-over',flipX:Math.cos(angle)<-.15,subject:semantic.label});}
 // Authored silhouettes use small polylines, not text labels or a random ID glyph.
 // They are decorative: their repetitions never add a recipient or damage event.
 function glyph(p,size,alpha,motif=semantic.motif,minimal=false,rotation=0) {
   const s=size*scale,co=Math.cos(rotation),si=Math.sin(rotation),c=recipe.colors;
   const pts=values=>values.map(([x,y])=>({x:p.x+(x*co-y*si)*s,y:p.y+(x*si+y*co)*s}));
   const stroke=(values,a=alpha,w=1.45,color=c[0])=>line(pts(values),a,w,color,4);
   const circle=(r=1,n=24)=>Array.from({length:n+1},(_,i)=>[Math.cos(i/n*TAU)*r,Math.sin(i/n*TAU)*r]);
   const star=(n=5,inner=.42)=>Array.from({length:n*2+1},(_,i)=>{const a=i/n*Math.PI-Math.PI/2,r=i%2?inner:1;return [Math.cos(a)*r,Math.sin(a)*r];});
   switch(motif){
     case 'blade':stroke([[0,-1],[.17,.25],[0,.55],[-.17,.25],[0,-1]]);if(!minimal)stroke([[-.38,.35],[.38,.35],[0,.35],[0,.85]],alpha*.7);break;
     case 'shield':stroke([[-.76,-.66],[0,-.94],[.76,-.66],[.62,.3],[0,.92],[-.62,.3],[-.76,-.66]]);if(!minimal)stroke([[0,-.55],[0,.5]],alpha*.6);break;
     case 'crown':stroke([[-.9,.45],[-.9,-.35],[-.4,.03],[0,-.78],[.4,.03],[.9,-.35],[.9,.45],[-.9,.45]]);break;
     case 'wing':stroke([[-1,-.55],[-.73,.32],[-.2,.6],[0,.15],[.2,.6],[.73,.32],[1,-.55],[.28,-.12],[0,.15],[-.28,-.12],[-1,-.55]]);break;
     case 'leaf':stroke([[0,-1],[.68,-.5],[.8,.12],[.42,.65],[0,1],[-.52,.35],[-.69,-.28],[0,-1]]);if(!minimal)stroke([[0,-.75],[0,.8],[-.4,.3],[0,.55],[.42,-.1],[0,.15]],alpha*.65);break;
     case 'thorn':stroke(Array.from({length:19},(_,i)=>{const a=i/18*TAU,r=i%3===0?1:.52;return [Math.cos(a)*r,Math.sin(a)*r*.65];}));break;
     case 'star':stroke(star());break;
     case 'sun':stroke(star(8,.67));if(!minimal)stroke(circle(.4),alpha*.6);break;
     case 'snowflake':stroke([[0,-1],[0,1],[0,0],[-.87,-.5],[.87,.5],[0,0],[-.87,.5],[.87,-.5]]);if(!minimal){stroke([[-.25,-.65],[0,-.45],[.25,-.65]],alpha*.75);stroke([[-.25,.65],[0,.45],[.25,.65]],alpha*.75);}break;
     case 'clock':stroke(circle());if(!minimal)stroke([[0,-.72],[0,0],[.53,.26]],alpha,2,c[1]);break;
     case 'rift':stroke([[.15,-1],[-.18,-.56],[.08,-.2],[-.24,.23],[.14,.55],[-.08,1]]);if(!minimal)stroke([[-.12,-.85],[-.48,-.28],[-.24,.23],[-.42,.79]],alpha*.5);break;
     case 'mirror':stroke([[0,-1],[.62,-.55],[.62,.55],[0,1],[-.62,.55],[-.62,-.55],[0,-1]]);if(!minimal)stroke([[-.3,.48],[.3,-.48]],alpha*.5);break;
     case 'moon':stroke([...Array.from({length:17},(_,i)=>{const a=-Math.PI/2+i/16*Math.PI;return [Math.cos(a),Math.sin(a)];}),...Array.from({length:13},(_,i)=>{const a=Math.PI/2-i/12*Math.PI;return [.23+.5*Math.cos(a),Math.sin(a)];})]);break;
     case 'serpent':stroke(Array.from({length:25},(_,i)=>{const q=i/24;return [Math.sin(q*TAU*1.35)*(.6-q*.27),q*2-1];}));if(!minimal)stroke([[-.1,-.87],[.1,-1.07],[.25,-.86]],alpha*.8);break;
     case 'seal':stroke([[0,-1],[.87,-.5],[.87,.5],[0,1],[-.87,.5],[-.87,-.5],[0,-1],[-.87,.5],[.87,.5],[0,-1]]);break;
     case 'banner':stroke([[-.45,1],[-.45,-1],[.72,-.85],[.5,-.25],[.72,.2],[-.45,.02]]);break;
     case 'beast':stroke([[-.62,.6],[-.55,.03],[-.33,-.17],[-.35,-.75],[-.12,-1],[.02,-.48],[.15,-1],[.4,-.75],[.38,-.17],[.6,.03],[.65,.6],[0,.9],[-.62,.6]]);break;
     case 'soul':stroke([[0,-1],[.45,-.43],[.6,.1],[.35,.57],[0,1],[-.35,.57],[-.6,.1],[-.45,-.43],[0,-1]]);if(!minimal)stroke(star(4,.25).map(([x,y])=>[x*.35,y*.35]),alpha*.65);break;
     case 'flame':stroke([[0,-1],[.17,-.2],[.5,-.65],[.71,.2],[.42,.7],[0,1],[-.5,.63],[-.7,.03],[-.32,-.65],[-.18,.05],[0,-1]]);break;
     case 'rune':stroke([[0,-1],[.95,.31],[-.59,.81],[.59,.81],[-.95,.31],[0,-1]]);break;
     case 'eye':stroke([[-1,0],[-.52,-.45],[0,-.65],[.52,-.45],[1,0],[.52,.45],[0,.65],[-.52,.45],[-1,0]]);if(!minimal)stroke(circle(.28),alpha*.8);break;
     case 'crack':stroke([[-1,.4],[-.55,.05],[-.31,.21],[.02,-.22],[.18,.07],[.63,-.42],[1,-.3]]);if(!minimal)stroke([[-.31,.21],[-.42,.7],[.02,-.22],[-.1,-.85],[.63,-.42],[.77,-.92]],alpha*.6);break;
     case 'drop':stroke([[0,-1],[.36,-.44],[.64,.15],[.56,.64],[0,1],[-.56,.64],[-.64,.15],[-.36,-.44],[0,-1]]);break;
     case 'web':stroke(Array.from({length:25},(_,i)=>{const a=Math.floor(i/4)*TAU/6,r=i%4===0?0:i%4===2?.5:1;return [Math.cos(a)*r,Math.sin(a)*r*.7];}));break;
   }
 }
 function decoration(p,alpha) {
   if(alpha<=.004)return;
   if(ancillarySupport){glyph(p,32,alpha*.5,supportKind==='heal'?'leaf':supportKind==='shield'?'shield':'rune',true);return;}
   const count=semantic.multiplicity,n=Math.min(count,low?5:9),r=(30+count*2.4)*scale;
   glyph({x:p.x,y:p.y-12*scale},30+count*1.1,alpha*.75);
   for(let i=0;i<n;i++){
     const a=i/n*TAU+t*.65,q={x:p.x+Math.cos(a)*r,y:p.y+Math.sin(a)*r*.62};
     switch(semantic.accent){
       case 'rays':line([q,{x:p.x+Math.cos(a)*(r+18*scale),y:p.y+Math.sin(a)*(r+18*scale)*.62}],alpha*.55,1.2);break;
       case 'orbit':sprite(8,q.x,q.y,9+count*.6,9+count*.6,a,alpha*.65);break;
       case 'halo':{const rr=(29+i*8+count)*scale;line(Array.from({length:25},(_,j)=>{const a=j/24*TAU;return{x:p.x+Math.cos(a)*rr,y:p.y+Math.sin(a)*rr*.52};}),alpha*.26,1);break;}
       case 'shards':line([{x:q.x-5*scale,y:q.y},{x:q.x+2*scale,y:q.y-10*scale},{x:q.x+5*scale,y:q.y+5*scale},{x:q.x-5*scale,y:q.y}],alpha*.65,1.2);break;
       case 'ripple':{const rr=(17+(i+out(t))*9+count)*scale;line(Array.from({length:18},(_,j)=>{const a=.2+j/17*Math.PI*1.55;return{x:p.x+Math.cos(a)*rr,y:p.y+Math.sin(a)*rr*.35};}),alpha*.4,1.1);break;}
       case 'glyph':glyph(q,7+count*.8,alpha*.4,semantic.motif,true,-t*.4);break;
       case 'echo':glyph({x:p.x-Math.cos(theta)*(i+1)*14*scale,y:p.y-Math.sin(theta)*(i+1)*14*scale},22+count,alpha*.32/(1+i*.25),semantic.motif,true);break;
       case 'trail':line([{x:q.x-Math.cos(theta)*(14+count*3)*scale,y:q.y-Math.sin(theta)*(14+count*3)*scale},q],alpha*.45,1.2);break;
     }
   }
   if(semantic.routeAccent==='assault')glyph({x:p.x,y:p.y-30*scale},44,alpha*.6,'blade',true,theta+Math.PI/2);
   if(semantic.routeAccent==='ward')glyph(p,67,alpha*.55,'shield',true);
 }
 let subjectDrawn=false;
 function subject(p,size,alpha){if(!ancillarySupport&&semantic.asset){spirit(semantic.asset,p,size,theta,alpha);subjectDrawn=true;}}
 function contacts(k,power=.8){if(local)return;for(const p of targets)burst(p,k,power,theta,'core');for(const p of targets)burst(p,k,power,theta,'detail');}
 function namedDelivery(){
   if(ancillarySupport)return false;
   const p=local?from:to,a=pulse(t,.18,.96),n=Math.min(semantic.multiplicity,low?5:9),hit=(t-recipe.impactAt)/(1-recipe.impactAt);
   switch(semantic.style){
     case 'orbit':{
       if(local)return false;
       contacts(hit,.77);
       const returning=t>recipe.impactAt,q=returning?(t-recipe.impactAt)/(.91-recipe.impactAt):(t-.22)/(recipe.impactAt-.22);
       if(q>=0&&q<=1)for(const dest of targets){const center=curve(returning?dest:from,returning?from:dest,smooth(q));
         for(let i=0;i<n;i++){const spin=t*TAU*3+i/n*TAU,r=Math.sin(q*Math.PI)*26*scale;sprite(0,center.x+Math.cos(spin)*r,center.y+Math.sin(spin)*r*.7,70,50,spin,a*.9);}
       }
       return true;
     }
     case 'blade-rain':{
       if(local)return false;
       contacts(hit,.83);
       for(const dest of targets)for(let i=0;i<n;i++){const arrival=recipe.impactAt+i/n*.15,start=arrival-.25;projectile({x:dest.x+(i-(n-1)/2)*27*scale,y:dest.y-165*scale},dest,start,arrival,0,0,58,0,'core');}
       return true;
     }
     case 'void':{
       if(semantic.asset)subject({x:p.x,y:p.y-9*scale},157,a*.85);
       const r=(1-smooth((t-.23)/.66))*60+14;glyph(p,r,a,'rift',false);
       for(let i=0;i<n+2;i++){const ang=i/(n+2)*TAU-t*2,rad=(r+16)*scale;line([{x:p.x+Math.cos(ang)*rad,y:p.y+Math.sin(ang)*rad*.75},{x:p.x+Math.cos(ang+.3)*rad*.42,y:p.y+Math.sin(ang+.3)*rad*.32}],a*.5,1.4);}
       contacts(hit,.84);return true;
     }
     case 'banner':field(p,(t-.08)/.9,1);subject({x:p.x,y:p.y-18*scale},166,a*.92);if(!semantic.asset)glyph(p,65,a,'banner');return true;
     case 'smoke':{
       for(let i=0;i<3;i++){const ang=i/3*TAU+t*.7;sprite(7,p.x+Math.cos(ang)*22*scale,p.y+Math.sin(ang)*10*scale,110,135,ang,a*.26);}
       subject({x:p.x,y:p.y-7*scale},145,a*.8);field(p,(t-.12)/.86,.85);
       if(!supporting){contacts(hit,.8);slash(p,.36,.79,theta,.93);}return true;
     }
     case 'tree':{
       subject({x:p.x,y:p.y-14*scale},166,a*.9);field(p,(t-.08)/.9,1.12);
       for(let i=0;i<n;i++){const ang=i/n*TAU,root={x:p.x+Math.cos(ang)*70*scale,y:p.y+32*scale+Math.sin(ang)*25*scale};line([{x:p.x,y:p.y+30*scale},{x:lerp(p.x,root.x,.55),y:root.y-12*scale},root],a*.55,2);glyph({x:root.x,y:root.y-(15+out(t)*25)*scale},9,a*.6,'leaf',true);}
       contacts(hit,.7);return true;
     }
     case 'fountain':{
       field(p,(t-.09)/.9,1.1);
       // A holy attack with a healing route is still an attack. Actual recovery
       // is rendered separately at the committed support-event beneficiary.
       if(!supporting){contacts(hit,.9);line([{x:p.x,y:p.y-90*scale},p],pulse(t,.35,.78)*.7,4,recipe.colors[1],10);}
       for(let i=0;i<n+2;i++){const side=i/(n+1)*2-1,points=Array.from({length:17},(_,j)=>{const q=j/16;return{x:p.x+side*q*61*scale,y:p.y+body*.28-Math.sin(q*Math.PI*.83)*body*.65};});line(points,a*.55,1.6);const q=(t*1.4+i/(n+2))%1;sprite(8,p.x+side*q*61*scale,p.y+body*.28-Math.sin(q*Math.PI*.83)*body*.65,11,16,0,a*.85);}
       return true;
     }
     case 'groundwave':{
       const k=clamp((t-.25)/.65),r=(20+out(k)*85)*scale;
       for(let i=0;i<n+2;i++){const ang=i/(n+2)*TAU;line([{x:p.x,y:p.y+20*scale},{x:p.x+Math.cos(ang-.12)*r*.55,y:p.y+20*scale+Math.sin(ang-.12)*r*.22},{x:p.x+Math.cos(ang)*r,y:p.y+20*scale+Math.sin(ang)*r*.4}],a*.7,1.6);}
       if(!supporting)contacts(hit,.9);return true;
     }
     case 'mirror':if(supporting){for(let i=0;i<n+1;i++){const ang=i/(n+1)*TAU-t*.3;glyph({x:p.x+Math.cos(ang)*42*scale,y:p.y+Math.sin(ang)*45*scale},30,a*.72,'mirror',false,Math.sin(ang)*.2);}subject(p,141,a*.7);return true;}break;
   }
   // Preserve the authoritative family's travel/contact timing for these styles.
   return false;
 }
 function namedDecoration(){
   const p=local?from:['whirlwind'].includes(family)?from:to,a=pulse(t,.2,.96),n=Math.min(semantic.multiplicity,low?5:9);
   if(ancillarySupport){decoration(p,a);return;}
   if(semantic.asset&&!subjectDrawn)subject({x:p.x,y:p.y-12*scale},145,a*.8);
   switch(semantic.style){
     case 'clock':{const angle=(semantic.accent==='trail'?t*5:t*1.8)*TAU;line([p,{x:p.x+Math.cos(angle)*48*scale,y:p.y+Math.sin(angle)*48*scale}],a*.8,2,recipe.colors[1]);line([p,{x:p.x+Math.cos(-angle*.4)*32*scale,y:p.y+Math.sin(-angle*.4)*32*scale}],a*.75,2);break;}
     case 'mirror':for(let i=0;i<n;i++){const ang=i/n*TAU;glyph({x:p.x+Math.cos(ang)*55*scale,y:p.y+Math.sin(ang)*42*scale},25,a*.55,'mirror',false,ang*.18);}break;
     case 'serpent':for(let i=0;i<n;i++){const ang=i/n*TAU;glyph({x:p.x+Math.cos(ang)*35*scale,y:p.y+Math.sin(ang)*25*scale},30,a*.7,'serpent',true,ang);}break;
     case 'aurora':for(let i=0;i<3;i++){const points=Array.from({length:25},(_,j)=>{const q=j/24;return{x:p.x+(q-.5)*170*scale,y:p.y+(-58+i*18+Math.sin(q*TAU+t*2+i*.8)*18)*scale};});line(points,a*.42,9-i*2,recipe.colors[i%3],12);}break;
     case 'starfall':for(let i=0;i<n;i++){const q=clamp((t-.24-i*.025)/.36),start={x:p.x+(i-(n-1)/2)*31*scale-35*scale,y:p.y-155*scale},z=curve(start,p,smooth(q));if(t<.64+i*.025){glyph(z,12,a*.75,semantic.element==='fire'?'flame':'star',true);line([z,{x:z.x-15*scale,y:z.y-35*scale}],a*.45,2);}}break;
     case 'cage':for(let i=0;i<n;i++){const x=(i/(Math.max(1,n-1))-.5)*100*scale,top=p.y-(48+Math.sin(i)*10)*scale;line([{x:p.x+x,y:p.y+45*scale},{x:p.x+x*.78,y:top},{x:p.x+x*.45,y:top-18*scale}],a*.6,semantic.element==='ice'?3:1.6);}break;
     case 'sunburst':for(let i=0;i<n+5;i++){const ang=i/(n+5)*TAU+t*.3,r=(30+out((t-.3)/.5)*35)*scale;line([{x:p.x+Math.cos(ang)*r*.48,y:p.y+Math.sin(ang)*r*.48},{x:p.x+Math.cos(ang)*r,y:p.y+Math.sin(ang)*r}],a*.7,2);}break;
     case 'storm':for(let i=0;i<3;i++){const points=Array.from({length:25},(_,j)=>{const a=j/24*TAU*1.4+t*3+i*TAU/3,r=(24+j*1.7)*scale;return{x:p.x+Math.cos(a)*r,y:p.y+Math.sin(a)*r*.45};});line(points,a*.4,2,recipe.colors[i%3],5);}break;
     case 'crosscut':for(let i=0;i<2;i++){const ang=theta+(i?-.7:.7),r=62*scale;line([{x:p.x-Math.cos(ang)*r,y:p.y-Math.sin(ang)*r},{x:p.x+Math.cos(ang)*r,y:p.y+Math.sin(ang)*r}],a*.8,2,recipe.colors[1],7);}break;
     case 'comet':if(!local){const q=smooth((t-.22)/(recipe.impactAt-.22)),z=curve(from,to,q);for(let i=0;i<n;i++){const offset=(i-(n-1)/2)*9*scale;line([{x:z.x-Math.cos(theta)*85*scale-Math.sin(theta)*offset,y:z.y-Math.sin(theta)*85*scale+Math.cos(theta)*offset},z],pulse(t,.22,recipe.impactAt+.13)*.5,2);} }break;
   }
   decoration(p,a);
 }
 const ground={x:from.x,y:from.y+body*.42};
 const composite=options.blendMode==='source-over'?'source-over':null;
 function finish(){const edge=Math.min(1,t/.045,(1-t)/.13);for(const l of layers)l.alpha*=edge;for(const g of geometry)g.alpha*=edge;return {recipe,progress:t,layers,geometry,bodyHeight:body,composite};}
 if(t<=0||t>=1)return {recipe,progress:t,layers,geometry,bodyHeight:body,composite};
 if(!local&&!targets.length)return finish();
 if(options.reducedMotion){
   const a=pulse(t,0,1)*.65;
   const cell=supporting||options.presentationMode==='summon'?4:recipe.baseClass==='mage'?(['fireball','meteor'].includes(family)?2:family==='frost'?5:8):2;
   for(const p of local?[from]:targets){
     if(semantic.asset==='semantic'&&options.presentationMode!=='impact'&&options.presentationMode!=='placement'&&!ancillarySupport){const before=layers.length;spirit('semantic',p,112,dir,a);if(layers.length>before)layers.at(-1).rotation=0;}
     else sprite(cell,p.x,p.y,92,92,0,a);
     ring({x:p.x,y:p.y+(options.presentationMode==='placement'?0:body*.3)},43,a*.4,.38);
     // A single static silhouette keeps identity readable without extra motion.
     if(options.presentationMode!=='placement')glyph(p,28,a*.55,ancillarySupport?(supportKind==='heal'?'leaf':'shield'):semantic.motif,true);
   }
   return {recipe,progress:t,layers,geometry,bodyHeight:body,composite};
 }
 // Recorded passive hits have no new actor wind-up; trap placement has no hit.
 if(options.presentationMode==='impact'){
   // Reserve one visible contact for every recipient before spending on sparks.
   for(const p of targets)burst(p,t,.78,theta,'core');
   for(const p of targets)burst(p,t,.78,theta,'detail');
   return finish();
 }
 if(options.presentationMode==='placement'){
   // Placement receives the actual foot point, already in ground coordinates.
   field(from,(t-.05)/.95,.95,true);
   sprite(3,from.x,from.y,136,50,-t*.12,pulse(t,.04,.98)*.8);
   const before=geometry.length;glyph(from,46,pulse(t,.04,.98)*.65,semantic.motif,true);
   // The footprint's polyline is explicitly grouped around the same foot origin.
   for(const shape of geometry.slice(before)){shape.x=from.x;shape.y=from.y;}
   return finish();
 }
 if(summoning){
   // A recorded non-damaging summon creates one local companion. It neither
   // travels to an enemy nor claims that any of its later pulses already hit.
   field(from,(t-.05)/.95,.95);
   const a=pulse(t,.08,.99),asset=semantic.asset;
   sprite(3,from.x,from.y-12*scale,108,108,-t*.2,a*.5);
   spirit(asset,{x:from.x+Math.cos(dir)*body*.28,y:from.y-body*.18-Math.sin(t*Math.PI)*body*.08},106,dir,a*.9);
   decoration(from,a*.7);
   return finish();
 }
 // Wind-up is an actual expanding rune and inward-moving motes, not a static full-frame flash.
 function windup(){
   const charge=pulse(t,0,.38);
   sprite(3,ground.x,ground.y,80+smooth(t/.22)*32,30+smooth(t/.22)*12,0,charge*.52);
   ring(ground,lerp(24,57,smooth(t/.22)),charge*.4,.36,1);
   sprite(8,from.x,from.y,18+charge*28,18+charge*28,-t,charge*.53);
   for(let i=0;i<(low?4:7);i++){const a=i/7*TAU+recipe.variant%10,r=(68-48*smooth(t/.22))*scale;sprite(8,from.x+Math.cos(a)*r,from.y+Math.sin(a)*r*.5,7,7,a,charge*.4);}
 }
 // Fan-out families reserve recipient cores before any ornamental draw calls.
 if(family!=='volley'&&family!=='lightning')windup();
 const hit=(t-recipe.impactAt)/(1-recipe.impactAt);
 if(!namedDelivery())switch(family){
   case 'pierce': case 'snipe': {
     const extended=family==='pierce'?{x:to.x+(to.x-from.x)*.22,y:to.y+(to.y-from.y)*.22}:to;
     // A piercing shot contacts the real target before continuing beyond it.
     projectile(from,extended,.22,family==='pierce'?.65:recipe.impactAt,0,0,family==='snipe'?105:80,0,'all',family==='pierce'?{point:to,at:recipe.impactAt}:null);
     if(family==='snipe'){ring(to,47,pulse(t,.1,.62),1,1);line([{x:to.x-34*scale,y:to.y},{x:to.x+34*scale,y:to.y}],pulse(t,.1,.58)*.4,.8);}
     burst(to,hit,family==='snipe'?1.05:.8,theta);break;
   }
   case 'volley': {
     const shots=targets.map((dest,i)=>{
       const spread=targets.length>1?i/(targets.length-1):0,arrival=recipe.impactAt+spread*Math.min(.16,(targets.length-1)*.07);
       return {dest,arrival,start:arrival-(recipe.impactAt-.22),bend:targets.length>1?(spread-.5)*44*scale:0};
     });
     for(const shot of shots){
       projectile(from,shot.dest,shot.start,shot.arrival,0,0,65,shot.bend,'core');
       if(t>=shot.arrival)burst(shot.dest,Math.max(.002,(t-shot.arrival)/Math.min(.32,1-shot.arrival)),.59,theta,'core');
     }
     windup();
     // A named two-shot or wind barrage repeats the arrow on the SAME true
     // recipient. Extra artwork is not an extra hit, target, or combat event.
     if(['double-shot','storm'].includes(semantic.style))for(const shot of shots){
       const repeats=Math.min(semantic.multiplicity,low?3:5);
       for(let i=1;i<repeats;i++)projectile(from,shot.dest,shot.start+i*.025,shot.arrival,0,0,57,shot.bend+(i%2?1:-1)*(10+i*7)*scale,'core');
     }
     for(const shot of shots){
       projectile(from,shot.dest,shot.start,shot.arrival,0,0,65,shot.bend,'detail');
       if(t>=shot.arrival)burst(shot.dest,Math.max(.002,(t-shot.arrival)/Math.min(.32,1-shot.arrival)),.59,theta,'detail');
     }
     break;
   }
   case 'rain': {
     field(to,(t-.13)/.82,1.2);
     for(let i=0;i<(low?5:9);i++){const dst={x:to.x+(rand(seed,i)-.5)*140*scale,y:to.y+(rand(seed,i+20)-.5)*50*scale},start=.25+(i%3)*.08;projectile({x:dst.x-50*scale,y:dst.y-180*scale},dst,start,start+.25,0,0,60);burst(dst,(t-start-.25)/.28,.42);}
     break;
   }
   case 'lightning': {
     const stagger=Math.min(.24,(targets.length-1)*.075);
     const arcs=targets.map((dest,i)=>{
       const spread=targets.length>1?i/(targets.length-1):0,arrival=recipe.impactAt+spread*stagger;
       const start=i?recipe.impactAt+(i-1)/(targets.length-1)*stagger:arrival-.12,alpha=pulse(t,start,arrival+.3),a=i?targets[i-1]:from;
       const head=curve(a,dest,smooth((t-start)/(arrival-start)));
       const points=Array.from({length:11},(_,j)=>{const p=curve(a,head,j/10);if(j>0&&j<10){p.x+=(rand(seed+Math.floor(t*10),j+(i+1)*20)-.5)*22*scale;p.y+=(rand(seed,j+(i+1)*40)-.5)*22*scale;}return p;});
       return {dest,arrival,alpha,head,points,impact:(t-arrival)/.3};
     });
     // Caster is not a target; compressed staggering keeps every contact in-clip.
     for(const arc of arcs){
       if(arc.alpha<=.004)continue;
       line(arc.points,arc.alpha,2,recipe.colors[1],6);
       if(t>=arc.arrival)burst(arc.dest,Math.max(.002,arc.impact),.65,theta,'core');
       else sprite(8,arc.head.x,arc.head.y,44,44,t,arc.alpha);
     }
     windup();
     for(const arc of arcs){
       if(arc.alpha<=.004)continue;
       line(arc.points,arc.alpha*.6,7,recipe.colors[2],17);
       if(t>=arc.arrival)burst(arc.dest,Math.max(.002,arc.impact),.65,theta,'detail');
     }
     break;
   }
   case 'fireball': {
     projectile(from,to,.22,recipe.impactAt,0,0,110,-17*scale);burst(to,hit,1.12,theta);
     sprite(0,to.x,to.y-20*scale,138,90,-Math.PI/2,pulse(t,.57,.93)*.65);break;
   }
   case 'meteor': {
     ring({x:to.x,y:to.y+20*scale},76,pulse(t,.1,.64),.35,1.4);
     projectile({x:to.x-140*scale,y:to.y-210*scale},to,.22,.59,0,0,150);
     burst(to,hit,1.4);sprite(0,to.x,to.y-30*scale,190,140,-Math.PI/2,pulse(t,.59,.98)*.75);break;
   }
   case 'arcane': {
     const charge=pulse(t,.12,.48);sprite(3,from.x,from.y,86,86,-t*.8,charge*.72);
     projectile(from,to,.22,.42,0,8,88,-18*scale);
     const q=(t-.4)/.56;
     if(q>0&&q<1){const spread=out(q),fade=Math.pow(1-q,1.5);
       sprite(7,to.x,to.y,64+spread*92,64+spread*92,t*.55,pulse(q,0,1)*.72);
       ring(to,24+spread*84,fade*.75,.82,1.8,recipe.colors[2]);
       for(let i=0;i<5;i++){const a=i/5*TAU+t*.3,r=(24+spread*70)*scale;sprite(8,to.x+Math.cos(a)*r,to.y+Math.sin(a)*r*.82,14,14,a,fade*.8);}
     }
     burst(to,(t-.4)/.58,1.03);break;
   }
   case 'beam': {
     const a=pulse(t,.22,.79);if(a){const pts=[from,to];line(pts,a*.14,32,recipe.colors[2],18);line(pts,a*.65,7,recipe.colors[0],8);line(pts,a*.94,1.7,recipe.colors[1],3);
       for(let i=0;i<(low?4:7);i++){const q=(t*2+i/7)%1,p=curve(from,to,q);sprite(8,p.x,p.y,12,12,t,a*.8);}
       sprite(3,from.x,from.y,75,75,-t*.6,a*.6);sprite(7,to.x,to.y,92,92,t*.4,a*.7);}
     burst(to,clamp((t-.61)/.37),1.0);break;
   }
   case 'frost': {
     field(to,(t-.18)/.8,1.18);
     for(let i=0;i<(low?4:7);i++){const a=i/7*TAU,k=(t-.35-i*.022)/.5;if(k<=0||k>=1)continue;const r=out(k)*56*scale,p={x:to.x+Math.cos(a)*r,y:to.y+Math.sin(a)*r*.45};sprite(5,p.x,p.y-26*scale,48,86,Math.cos(a)*.3,pulse(k,0,1)*.95);}
     sprite(4,from.x,from.y,106,128,0,pulse(t,.22,.94)*.48);burst(to,hit,.86);break;
   }
   case 'whirlwind': {
     const a=pulse(t,.18,.92),r=(30+smooth((t-.18)/.55)*40)*scale;
     for(let i=0;i<3;i++){const ang=t*TAU*1.5+i*TAU/3;sprite(1,from.x+Math.cos(ang)*r*.45,from.y+Math.sin(ang)*r*.2,174,126,ang,a*.8);}
     field(from,(t-.14)/.83,1.2);burst(from,(t-.65)/.33,.8);break;
   }
   case 'slash': case 'bleed': case 'counter': case 'execute': case 'combo': case 'dash': case 'shadow': case 'poison': {
     const approach=curve(from,to,smooth((t-.22)/.3));
     if(['dash','shadow','execute'].includes(family)){projectile(from,to,.18,.49,0,7,78);for(let i=0;i<3;i++){const p=curve(from,to,clamp((t-.18)/.31-i*.1));sprite(1,p.x,p.y,60,75,theta,pulse(t,.2,.55)*(.25-i*.05));}}
     else if(family==='counter')sprite(4,from.x,from.y,108,132,0,pulse(t,.13,.56)*.8);
     else line([from,approach],pulse(t,.24,.54)*.35,1.4);
     if(family==='combo'){slash(to,.35,.63,theta-.35,.86);slash(to,.46,.75,theta+1.35,.9);slash(to,.61,.89,theta-.7,1.15);burst(to,(t-.66)/.32,.9);}
     else if(family==='execute'){slash(to,.43,.76,theta+.65,1.2);slash(to,.47,.81,theta-.65,1.2);sprite(6,to.x,to.y-25*scale,95,140,0,pulse(t,.58,.92)*.55);burst(to,hit,1.1);}
     else{slash(to,.36,.77,theta,1+(recipe.tier*.035));burst(to,hit,.83);}
     if(['poison','bleed','shadow'].includes(family)){const q=(t-.55)/.45;field(to,q,.8);for(let i=0;i<5;i++){const a=i/5*TAU;const k=clamp(q);sprite(family==='bleed'?5:8,to.x+Math.cos(a)*(18+25*k)*scale,to.y+(family==='bleed'?k*38:-k*35)*scale,18,23,a,pulse(q,0,1)*.65);}}
     break;
   }
   case 'trap': {
     const base={x:to.x,y:to.y+body*.3};
     sprite(3,base.x,base.y,154,56,0,pulse(t,.11,.77)*.85);
     for(let i=0;i<6;i++){const a=i/6*TAU,r=60*scale;line([base,{x:base.x+Math.cos(a)*r,y:base.y+Math.sin(a)*r*.36}],pulse(t,.24,.64)*.55,1);const k=(t-.51)/.41;sprite(5,base.x+Math.cos(a)*r,base.y-22*scale+Math.sin(a)*r*.36,47,82,-Math.cos(a)*.4,pulse(k,0,1)*.85);}
     burst(to,hit,1.0);break;
   }
   case 'summon': case 'beast': {
     field(from,(t-.09)/.9,1.05);
     const a=pulse(t,.2,.92),asset=semantic.asset;sprite(3,from.x,from.y-23*scale,115,126,0,a*.35);
     const count=Math.min(semantic.multiplicity,low?5:9);subjectDrawn=true;
     for(let i=0;i<count;i++){const q=(t-.22-i*.015)/.59;if(q<=0||q>=1)continue;const p=curve(from,to,smooth(q),(i-(count-1)/2)*37*scale);spirit(asset,{x:p.x,y:p.y-12*scale},family==='beast'?112:110,theta+Math.sin(t*8)*.08,pulse(q,0,1)*.95);}
     burst(to,(t-.67)/.31,.88);break;
   }
   case 'shield': {
     const a=pulse(t,.13,.99);field(from,(t-.07)/.92,.9);
     sprite(4,from.x,from.y,112+out(t/.3)*8,142,0,a*.85);
     ring(from,62,a*.35,1.12,1.5);for(let i=0;i<5;i++){const ang=i/5*TAU+t*.4;sprite(8,from.x+Math.cos(ang)*61*scale,from.y+Math.sin(ang)*72*scale,11,11,ang,a*.7);}
     if(!supporting){projectile(from,to,.29,.57,0,4,92);burst(to,hit,.95);}break;
   }
   case 'heal': case 'holy': case 'buff': case 'time': case 'curse': {
     const p=supporting?from:to,k=(t-.1)/.89,a=pulse(t,.14,.99);field(p,k,1.05);
     if(family==='holy'||family==='heal'){sprite(6,p.x,p.y-18*scale,104,184,0,a*.68);sprite(4,p.x,p.y-18*scale,83,83,0,a*.55);}
     else if(family==='time'){sprite(3,p.x,p.y,147,147,t*.2,a*.7);ring(p,70,a*.65,1,1.6,recipe.colors[0],t*.2);for(let i=0;i<12;i++){const ang=i/12*TAU;line([{x:p.x+Math.cos(ang)*58*scale,y:p.y+Math.sin(ang)*58*scale},{x:p.x+Math.cos(ang)*66*scale,y:p.y+Math.sin(ang)*66*scale}],a*.7,1);}}
     else sprite(7,p.x,p.y,142,161,-t*.25,a*.62);
     for(let i=0;i<(low?7:12);i++){const q=(t*1.3+rand(seed,i))%1,x=p.x+(rand(seed,i+20)-.5)*95*scale,y=p.y+55*scale-q*150*scale;sprite(i%3===0?5:8,x,y,11+rand(seed,i+40)*10,17,rand(seed,i+60)*TAU,a*Math.sin(q*Math.PI)*.65);}
     if(!supporting)burst(to,hit,.86);break;
   }
 }
 namedDecoration();
 // Boundary-safe alpha fade guarantees every clip starts and ends fully transparent.
 return finish();
}

// Recolor each source cell once while preserving its luminance and exact alpha.
// A bounded LRU avoids filtering dozens of sprites on every animation frame and
// prevents the workshop's 196-profile tour from retaining an unbounded texture set.
const COLORED_CELLS=new WeakMap();
const COLORED_CELL_LIMIT=24;
function coloredCell(ctx,source,rectangle,color){
 if(!color)return null;
 const scope=ctx.canvas?.ownerDocument?.defaultView||globalThis,doc=ctx.canvas?.ownerDocument;
 if(typeof scope.OffscreenCanvas!=='function'&&!doc?.createElement)return null;
 let cache=COLORED_CELLS.get(source);if(!cache){cache=new Map();COLORED_CELLS.set(source,cache);}
 const key=rectangle.join(':')+':'+color;
 if(cache.has(key)){const hit=cache.get(key);cache.delete(key);cache.set(key,hit);return hit;}
 const [sx,sy,sw,sh]=rectangle;
 let canvas;
 try{
   canvas=typeof scope.OffscreenCanvas==='function'?new scope.OffscreenCanvas(sw,sh):doc.createElement('canvas');
   canvas.width=sw;canvas.height=sh;const paint=canvas.getContext('2d',{alpha:true});if(!paint)return null;
   paint.fillStyle=color;paint.fillRect(0,0,sw,sh);
   paint.globalCompositeOperation='luminosity';paint.drawImage(source,sx,sy,sw,sh,0,0,sw,sh);
   paint.globalCompositeOperation='destination-in';paint.drawImage(source,sx,sy,sw,sh,0,0,sw,sh);
   paint.globalCompositeOperation='source-over';
 }catch(_){return null;}
 cache.set(key,canvas);while(cache.size>COLORED_CELL_LIMIT){const first=cache.keys().next().value,old=cache.get(first);cache.delete(first);old.width=old.height=1;}
 return canvas;
}

export function drawEffectFrame(ctx,atlas,frame,extras={}) {
 let calls=0;
 for(const g of frame.geometry){ctx.save();ctx.globalCompositeOperation=frame.composite||'screen';ctx.globalAlpha=g.alpha;ctx.strokeStyle=g.color;ctx.lineWidth=g.width;ctx.lineCap='round';ctx.lineJoin='round';
   if(g.kind==='ring'){ctx.translate(g.x,g.y);ctx.rotate(g.rotation||0);ctx.beginPath();ctx.ellipse(0,0,g.r,g.r*g.tilt,0,0,TAU);ctx.stroke();}
   else{ctx.shadowColor=g.color;ctx.shadowBlur=g.glow;ctx.beginPath();g.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}ctx.restore();calls++;
 }
 if(atlas)for(const l of frame.layers){
   const source=l.asset?extras[l.asset]:atlas;if(!source)continue;
   const grid=l.asset?(l.grid||[1,1]):[3,3],col=l.cell%grid[0],row=Math.floor(l.cell/grid[0]);
   const sx=Math.round(col*source.width/grid[0]),sy=Math.round(row*source.height/grid[1]);
   const sw=Math.round((col+1)*source.width/grid[0])-sx,sh=Math.round((row+1)*source.height/grid[1])-sy;
   const colored=!l.asset?coloredCell(ctx,source,[sx,sy,sw,sh],l.tint):null;
   ctx.save();ctx.globalAlpha=l.alpha;ctx.globalCompositeOperation=frame.composite||l.blend;ctx.translate(l.x,l.y);ctx.rotate(l.rotation);if(l.flipX)ctx.scale(-1,1);
   if(colored)ctx.drawImage(colored,0,0,colored.width,colored.height,-l.w/2,-l.h/2,l.w,l.h);
   else ctx.drawImage(source,sx,sy,sw,sh,-l.w/2,-l.h/2,l.w,l.h);
   ctx.restore();calls++;
 }
 return calls;
}

/** Canvas lifecycle controller. clear() invalidates in-flight image loads and pending casts. */
export function createVfxPlayer(canvas,{catalog,assetBase='/art/skill-vfx-20261104/',maxActive=8,quality='high',reducedMotion,onRender=()=>{},onError=()=>{}}={}) {
 validateCatalog(catalog);
 if(!canvas?.getContext)throw new TypeError('A canvas is required.');
 const ctx=canvas.getContext('2d',{alpha:true}),skills=new Map(catalog.skills.map(s=>[s.id,s])),images=new Map(),loads=new Map(),pending=new Map();
 const scope=canvas.ownerDocument?.defaultView||globalThis,doc=canvas.ownerDocument;
 const raf=scope.requestAnimationFrame?.bind(scope)||((fn)=>setTimeout(()=>fn(performance.now()),16));
 const caf=scope.cancelAnimationFrame?.bind(scope)||clearTimeout;
 const reducedQuery=scope.matchMedia?.('(prefers-reduced-motion: reduce)');
 let destroyed=false,generation=0,instances=[],frameHandle=0,nextId=0,width=canvas.clientWidth||canvas.width||800,height=canvas.clientHeight||canvas.height||500,dpr=1,lastRender={active:0,drawCalls:0,frameMs:0};
 let manual=null;
 const isReduced=()=>typeof reducedMotion==='boolean'?reducedMotion:!!reducedQuery?.matches;
 const now=()=>scope.performance?.now?.()??performance.now();
 const limit=clamp(Math.floor(finite(Number(maxActive),8)),1,12);
 function erase(){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.setTransform(dpr,0,0,dpr,0,0);}
 function resize(w=canvas.clientWidth,h=canvas.clientHeight,pixelRatio=scope.devicePixelRatio||1){if(destroyed)return; width=Math.max(1,Math.round(finite(w,width)));height=Math.max(1,Math.round(finite(h,height)));dpr=clamp(finite(pixelRatio,1),1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);if(manual)renderManual();}
 function prepare(baseClass){
   if(destroyed)return Promise.reject(new Error('destroyed'));if(images.has(baseClass))return Promise.resolve(images.get(baseClass));if(loads.has(baseClass))return loads.get(baseClass);
   if(!PALETTE[baseClass]&&!EXTRA_ASSETS[baseClass])return Promise.reject(new Error('unknown_class'));
   const promise=new Promise((resolve,reject)=>{const img=new scope.Image();pending.set(baseClass,{img,reject});img.decoding='async';img.onload=()=>{pending.delete(baseClass);img.onload=img.onerror=null;if(destroyed){reject(new Error('destroyed'));return;}if(img.width<3||img.height<3){reject(new Error('invalid_atlas'));return;}images.set(baseClass,img);resolve(img);};img.onerror=()=>{pending.delete(baseClass);img.onload=img.onerror=null;reject(new Error('Unable to load '+baseClass+' VFX atlas.'));};img.src=assetBase+(EXTRA_ASSETS[baseClass]||baseClass+'-atlas.webp');});
   loads.set(baseClass,promise);promise.catch(()=>loads.delete(baseClass));return promise;
 }
 const extras=()=>Object.fromEntries(Object.keys(EXTRA_ASSETS).map(k=>[k,images.get(k)]));
 async function prepareSkill(skill){await Promise.all([skill.baseClass,...extraKeys(skill)].map(prepare));}
 function renderManual(){if(!manual||destroyed)return;const start=now();erase();const skill=skills.get(manual.skillId);if(!skill)return;const frame=buildEffectFrame(skill,manual.progress,{...manual,quality:manual.quality||quality,reducedMotion:isReduced()});const drawCalls=drawEffectFrame(ctx,images.get(skill.baseClass),frame,extras());lastRender={active:0,drawCalls,frameMs:now()-start,manual:true};onRender(lastRender);}
 function tick(timestamp){frameHandle=0;if(destroyed)return;if(doc?.hidden){clear();return;}const start=now();erase();let drawCalls=0;instances=instances.filter(i=>timestamp-i.startedAt<i.durationMs);
   for(const i of instances){const progress=(timestamp-i.startedAt)/i.durationMs;if(progress<0)continue;drawCalls+=drawEffectFrame(ctx,images.get(i.skill.baseClass),buildEffectFrame(i.skill,progress,{...i.options,quality:i.options.quality||quality,reducedMotion:isReduced()}),extras());}
   lastRender={active:instances.length,drawCalls,frameMs:now()-start,manual:false};onRender(lastRender);if(instances.length)frameHandle=raf(tick);
 }
 async function play(options={}){
   if(destroyed)return{accepted:false,reason:'destroyed'};if(doc?.hidden)return{accepted:false,reason:'hidden'};
   const skill=skills.get(options.skillId);if(!skill)return{accepted:false,reason:'unknown_skill'};const version=generation,loadStarted=now();
   try{await prepareSkill(skill);}catch(error){if(destroyed||version!==generation)return{accepted:false,reason:destroyed?'destroyed':'superseded'};onError(error);return{accepted:false,reason:'asset_failed'};}
   if(destroyed||version!==generation)return{accepted:false,reason:'superseded'};if(doc?.hidden)return{accepted:false,reason:'hidden'};
   if(typeof options.canStart==='function'&&!options.canStart())return{accepted:false,reason:'superseded'};
   const normalDuration=recipeFor(skill).durationMs,durationMs=isReduced()?420:options.presentationMode==='impact'?650:options.presentationMode==='placement'?Math.min(1200,normalDuration):normalDuration;
   const age=clamp(finite(options.startProgress,0))*durationMs+Math.max(0,finite(options.ageMs,0))+Math.max(0,now()-loadStarted);
   if(age>=durationMs)return{accepted:false,reason:'expired'};manual=null;
   if(instances.length>=limit)return{accepted:false,reason:'capacity'};
   const instanceId=++nextId;instances.push({instanceId,skill,options:{...options},startedAt:now()-age,durationMs});if(!frameHandle)frameHandle=raf(tick);return{accepted:true,instanceId,durationMs};
 }
 async function renderFrame(options={}){
   if(destroyed)return{accepted:false,reason:'destroyed'};const skill=skills.get(options.skillId);if(!skill)return{accepted:false,reason:'unknown_skill'};
   clear();const version=generation;try{await prepareSkill(skill);}catch(error){if(destroyed||version!==generation)return{accepted:false,reason:destroyed?'destroyed':'superseded'};onError(error);return{accepted:false,reason:'asset_failed'};}
   if(destroyed||version!==generation)return{accepted:false,reason:'superseded'};manual={...options,progress:clamp(finite(options.progress,0))};renderManual();return{accepted:true,drawCalls:lastRender.drawCalls};
 }
 function clear(){generation++;instances=[];manual=null;if(frameHandle)caf(frameHandle);frameHandle=0;erase();lastRender={active:0,drawCalls:0,frameMs:0};}
 function visibility(){if(doc?.hidden)clear();}
 function reducedChanged(){clear();}
 function destroy(){if(destroyed)return;clear();destroyed=true;for(const {img,reject}of pending.values()){img.onload=img.onerror=null;img.removeAttribute?.('src');reject(new Error('destroyed'));}pending.clear();images.clear();loads.clear();doc?.removeEventListener('visibilitychange',visibility);reducedQuery?.removeEventListener?.('change',reducedChanged);canvas.width=canvas.height=1;}
 doc?.addEventListener('visibilitychange',visibility);reducedQuery?.addEventListener?.('change',reducedChanged);resize();
 return Object.freeze({prepare,play,renderFrame,clear,destroy,resize,hasSkill:id=>skills.has(id),stats:()=>({...lastRender,width,height,dpr,active:instances.length,loadedAtlases:images.size,pendingLoads:pending.size,generation,destroyed,reducedMotion:isReduced(),maxActive:limit}),getSkill:id=>skills.get(id),getRecipe:id=>skills.has(id)?recipeFor(skills.get(id)):null});
}
