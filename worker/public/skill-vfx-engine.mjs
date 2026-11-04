/** StarJournal skill VFX. Presentation only: no combat, inventory or network writes. */
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
const EXTRA_ASSETS={hawk:'hawk.webp','fire-spirit':'fire-spirit.webp'};
function extraKeys(skill){return skill.family==='beast'?['hawk']:skill.family==='summon'?['fire-spirit']:[];}
export function hash32(value) { let h=2166136261; for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);} return h>>>0; }
function rand(seed,i) { let a=(seed+Math.imul(i+1,0x9e3779b9))>>>0;a^=a>>>16;a=Math.imul(a,0x21f0aaad);a^=a>>>15;a=Math.imul(a,0x735a2d97);return ((a^(a>>>15))>>>0)/4294967296; }
export function recipeFor(skill) {
 if(!skill?.id||!PALETTE[skill.baseClass])throw new TypeError('A catalogued skill identity and class are required.');
 const family=FAMILY_ALIAS[skill.family]||skill.family;
 if(!SUPPORTED_FAMILIES.includes(family))throw new TypeError('Unsupported VFX family: '+String(skill.family)+' ('+skill.id+')');
 const tier=clamp(Number(skill.tier)||0,0,4), variant=hash32(skill.id);
 const support=['heal','buff','shield'].includes(skill.kind);
 const colors=[...PALETTE[skill.baseClass]];
 if(['poison','trap'].includes(family)){colors[0]='#86e8aa';colors[2]='#428f87';}
 if(['fireball','meteor','bleed'].includes(family)){colors[0]='#ffac66';colors[2]='#da5949';}
 if(['frost','lightning'].includes(family)){colors[0]='#8fdcff';colors[2]='#739ce2';}
 if(['heal','holy'].includes(family)){colors[0]='#f2df9a';colors[1]='#f8ffe8';}
 const impactAt=['beam','arcane','lightning'].includes(family)?.4:['heal','buff','shield','time','summon','beast'].includes(family)?.32:.57,impactEnd=Math.min(.86,impactAt+.23);
 return Object.freeze({id:skill.id,family,baseClass:skill.baseClass,kind:skill.kind||'attack',tier,variant,
   durationMs:TIME[family]+(variant%4)*30,impactAt,
   colors,support,phases:[{id:'charge',label:'蓄力',from:0,to:.22},{id:'release',label:'釋放',from:.22,to:impactAt},{id:'impact',label:support?'生效':'命中',from:impactAt,to:impactEnd},{id:'dissolve',label:'消散',from:impactEnd,to:1}],
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
 const family=recipe.support?(skill.kind==='shield'?'shield':skill.kind==='heal'?'heal':recipe.family==='time'?'time':'buff'):recipe.family;
 const body=clamp(finite(options.bodyHeight,150),36,480),scale=body/150;
 const from=point(options.from,{x:160,y:240}),dir=DIR[options.direction]??0;
 let to=point(options.to,{x:from.x+Math.cos(dir)*body*1.7,y:from.y+Math.sin(dir)*body*1.7});
 if(recipe.support)to={...from};
 const theta=Math.atan2(to.y-from.y,to.x-from.x)||dir;
 const targets=(Array.isArray(options.targets)?options.targets:[]).filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)).slice(0,5);
 const seed=hash32(String(options.seed??recipe.variant)+skill.id),low=options.quality==='low';
 const layers=[],geometry=[]; const limit=low?48:94;
 function sprite(cell,x,y,w,h=w,rotation=0,alpha=1,blend='screen') {
   if(alpha<=.004||w<=0||h<=0||layers.length>=limit)return;
   layers.push({cell,x,y,w:w*scale,h:h*scale,rotation,alpha:clamp(alpha),blend,flipX:recipe.baseClass==='sword'&&cell===1});
 }
 function ring(p,r,alpha,tilt=.38,width=1.3,color=recipe.colors[0],rotation=0) {
   if(alpha<=.004)return;geometry.push({kind:'ring',x:p.x,y:p.y,r:r*scale,tilt,width:width*scale,alpha:clamp(alpha),color,rotation});
 }
 function line(points,alpha,width=2,color=recipe.colors[0],glow=10) {
   if(alpha<=.004)return;geometry.push({kind:'line',points,width:width*scale,alpha:clamp(alpha),color,glow:glow*scale});
 }
 function burst(p,k,power=1,angle=0) {
   if(k<=0||k>=1)return;const fade=Math.pow(1-k,1.7),radius=(22+out(k)*88)*power;
   const impactCell=recipe.baseClass==='mage'?(['fireball','meteor'].includes(family)?2:['frost','shield'].includes(family)?5:8):2;
   sprite(impactCell,p.x,p.y,(38+out(k)*152)*power,(38+out(k)*152)*power,angle,fade*.93);
   ring(p,radius,fade*.5,.72,1.3);
   const n=low?7:13;
   for(let i=0;i<n;i++){
     const a=i/n*TAU+rand(seed,i)*.5+angle,r=radius*(.6+rand(seed,i+100)*.7)*scale;
     const px=p.x+Math.cos(a)*r,py=p.y+Math.sin(a)*r*.7;
     const size=(7+rand(seed,i+200)*13)*(1-k)*power;
     const particleCell=recipe.baseClass==='mage'?(['fireball','meteor'].includes(family)?0:['frost','shield'].includes(family)&&i%3===0?5:8):(i%3===0?5:8);
     sprite(particleCell,px,py,size,size,a,fade*(.4+rand(seed,i+300)*.5));
   }
 }
 function projectile(a,b,start,end,offset=0,cell=0,size=85,bend=0) {
   const q=(t-start)/(end-start);if(q<0||q>1)return;
   const p=curve(a,b,smooth(q),bend),prev=curve(a,b,clamp(smooth(q)-.03),bend);
   const angle=Math.atan2(p.y-prev.y,p.x-prev.x)||theta;
   const points=Array.from({length:7},(_,i)=>curve(a,b,clamp(smooth(q)-i*.025),bend));
   line(points,Math.sin(Math.PI*q)*.8,3,recipe.colors[0],8);
   sprite(cell,p.x,p.y+offset*scale,size,size*.72,angle,.92*pulse(q,-.08,1.12));
   for(let i=0;i<(low?3:6);i++){const z=curve(a,b,clamp(smooth(q)-i*.045),bend);sprite(8,z.x,z.y+Math.sin(i*2+t*24)*4*scale,8*(1-i/8),8*(1-i/8),angle,(1-i/7)*pulse(q,-.1,1.12)*.5);}
 }
 function slash(p,start,end,angle=theta,power=1) {
   const q=(t-start)/(end-start);if(q<=0||q>=1)return;
   const a=angle+lerp(-.62,.38,out(q)),size=(100+out(q)*68)*power;
   sprite(1,p.x,p.y,size,size*.8,a,pulse(q,0,1)*.96);
   sprite(8,p.x+Math.cos(a)*35*scale,p.y+Math.sin(a)*35*scale,20,20,0,pulse(q,0,.8)*.6);
 }
 function field(p,k,power=1) {
   if(k<=0||k>=1)return;const alpha=pulse(k,0,1)*.6;
   sprite(7,p.x,p.y+body*.34,140*power,58*power,k*.22,alpha);
   sprite(3,p.x,p.y+body*.35,144*power,54*power,-k*.35,alpha*.67);
   ring({x:p.x,y:p.y+body*.35},71*power,alpha,.37,1.2);
 }
 function spirit(asset,p,size,angle,alpha){if(alpha<=.004||layers.length>=limit)return;layers.push({asset,cell:0,x:p.x,y:p.y,w:size*scale,h:size*scale,rotation:Math.sin(angle)*.16,alpha:clamp(alpha),blend:'source-over',flipX:Math.cos(angle)<-.15});}
 const ground={x:from.x,y:from.y+body*.42};
 const composite=options.blendMode==='source-over'?'source-over':null;
 if(t<=0||t>=1)return {recipe,progress:t,layers,geometry,bodyHeight:body,composite};
 if(options.reducedMotion){
   const p=recipe.support?from:to,a=pulse(t,0,1)*.65;
   const cell=recipe.support?4:recipe.baseClass==='mage'?(['fireball','meteor'].includes(family)?2:family==='frost'?5:8):2;
   sprite(cell,p.x,p.y,92,92,0,a);ring({x:p.x,y:p.y+body*.3},43,a*.4,.38);
   return {recipe,progress:t,layers,geometry,bodyHeight:body,composite};
 }
 // Wind-up is an actual expanding rune and inward-moving motes, not a static full-frame flash.
 const charge=pulse(t,0,.38);
 sprite(3,ground.x,ground.y,80+smooth(t/.22)*32,30+smooth(t/.22)*12,0,charge*.52);
 ring(ground,lerp(24,57,smooth(t/.22)),charge*.4,.36,1);
 sprite(8,from.x,from.y,18+charge*28,18+charge*28,-t,charge*.53);
 for(let i=0;i<(low?4:7);i++){const a=i/7*TAU+recipe.variant%10,r=(68-48*smooth(t/.22))*scale;sprite(8,from.x+Math.cos(a)*r,from.y+Math.sin(a)*r*.5,7,7,a,charge*.4);}
 const hit=(t-recipe.impactAt)/(1-recipe.impactAt);
 switch(family){
   case 'pierce': case 'snipe': {
     const extended=family==='pierce'?{x:to.x+(to.x-from.x)*.22,y:to.y+(to.y-from.y)*.22}:to;
     projectile(from,extended,.19,.65,0,0,family==='snipe'?105:80);
     if(family==='snipe'){ring(to,47,pulse(t,.1,.62),1,1);line([{x:to.x-34*scale,y:to.y},{x:to.x+34*scale,y:to.y}],pulse(t,.1,.58)*.4,.8);}
     burst(to,hit,family==='snipe'?1.05:.8,theta);break;
   }
   case 'volley': {
     for(let i=0;i<3;i++){const dest=targets[i]||{x:to.x+Math.sin(theta)*((i-1)*26)*scale,y:to.y-Math.cos(theta)*((i-1)*26)*scale};projectile(from,dest,.18+i*.07,.52+i*.07,0,0,65,(i-1)*22*scale);burst(dest,(t-(.52+i*.07))/.32,.59,theta);}
     break;
   }
   case 'rain': {
     field(to,(t-.13)/.82,1.2);
     for(let i=0;i<(low?5:9);i++){const dst={x:to.x+(rand(seed,i)-.5)*140*scale,y:to.y+(rand(seed,i+20)-.5)*50*scale},start=.25+(i%3)*.08;projectile({x:dst.x-50*scale,y:dst.y-180*scale},dst,start,start+.25,0,0,60);burst(dst,(t-start-.25)/.28,.42);}
     break;
   }
   case 'lightning': {
     const chain=[from,to,...targets.filter(p=>Math.hypot(p.x-to.x,p.y-to.y)>3)].slice(0,5);
     if(chain.length===2&&options.showcaseTargets){chain.push({x:to.x+45*scale,y:to.y-62*scale},{x:to.x+83*scale,y:to.y+25*scale});}
     for(let i=1;i<chain.length;i++){
       const k=(t-(.29+i*.075))/.3,alpha=pulse(k,0,1);if(alpha<=0)continue;
       const a=chain[i-1],b=chain[i],pts=Array.from({length:11},(_,j)=>{const p=curve(a,b,j/10);if(j>0&&j<10){p.x+=(rand(seed+Math.floor(t*10),j+i*20)-.5)*22*scale;p.y+=(rand(seed,j+i*40)-.5)*22*scale;}return p;});
       line(pts,alpha*.6,7,recipe.colors[2],17);line(pts,alpha,2,recipe.colors[1],6);sprite(8,b.x,b.y,44,44,t,alpha);burst(b,clamp(k-.3)*1.4,.65);
     }break;
   }
   case 'fireball': {
     projectile(from,to,.2,.58,0,0,110,-17*scale);burst(to,hit,1.12,theta);
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
     const a=pulse(t,.2,.92),asset=family==='beast'?'hawk':'fire-spirit';sprite(3,from.x,from.y-23*scale,115,126,0,a*.35);
     const count=family==='beast'&&skill.system==='atlas'?2:1;
     for(let i=0;i<count;i++){const q=(t-.22-i*.06)/.59;if(q<=0||q>=1)continue;const p=curve(from,to,smooth(q),(i-(count-1)/2)*73*scale);spirit(asset,{x:p.x,y:p.y-12*scale},family==='beast'?112:110,theta+Math.sin(t*8)*.08,pulse(q,0,1)*.95);}
     burst(to,(t-.67)/.31,.88);break;
   }
   case 'shield': {
     const a=pulse(t,.13,.99);field(from,(t-.07)/.92,.9);
     sprite(4,from.x,from.y,112+out(t/.3)*8,142,0,a*.85);
     ring(from,62,a*.35,1.12,1.5);for(let i=0;i<5;i++){const ang=i/5*TAU+t*.4;sprite(8,from.x+Math.cos(ang)*61*scale,from.y+Math.sin(ang)*72*scale,11,11,ang,a*.7);}
     if(!recipe.support){projectile(from,to,.29,.57,0,4,92);burst(to,hit,.95);}break;
   }
   case 'heal': case 'holy': case 'buff': case 'time': case 'curse': {
     const p=recipe.support?from:to,k=(t-.1)/.89,a=pulse(t,.14,.99);field(p,k,1.05);
     if(family==='holy'||family==='heal'){sprite(6,p.x,p.y-18*scale,104,184,0,a*.68);sprite(4,p.x,p.y-18*scale,83,83,0,a*.55);}
     else if(family==='time'){sprite(3,p.x,p.y,147,147,t*.2,a*.7);ring(p,70,a*.65,1,1.6,recipe.colors[0],t*.2);for(let i=0;i<12;i++){const ang=i/12*TAU;line([{x:p.x+Math.cos(ang)*58*scale,y:p.y+Math.sin(ang)*58*scale},{x:p.x+Math.cos(ang)*66*scale,y:p.y+Math.sin(ang)*66*scale}],a*.7,1);}}
     else sprite(7,p.x,p.y,142,161,-t*.25,a*.62);
     for(let i=0;i<(low?7:12);i++){const q=(t*1.3+rand(seed,i))%1,x=p.x+(rand(seed,i+20)-.5)*95*scale,y=p.y+55*scale-q*150*scale;sprite(i%3===0?5:8,x,y,11+rand(seed,i+40)*10,17,rand(seed,i+60)*TAU,a*Math.sin(q*Math.PI)*.65);}
     if(!recipe.support)burst(to,hit,.86);break;
   }
 }
 // Boundary-safe alpha fade guarantees every clip starts and ends fully transparent.
 const edge=Math.min(1,t/.045,(1-t)/.13);
 for(const l of layers)l.alpha*=edge;
 for(const g of geometry)g.alpha*=edge;
 return {recipe,progress:t,layers,geometry,bodyHeight:body,composite};
}

export function drawEffectFrame(ctx,atlas,frame,extras={}) {
 let calls=0;
 for(const g of frame.geometry){ctx.save();ctx.globalCompositeOperation=frame.composite||'screen';ctx.globalAlpha=g.alpha;ctx.strokeStyle=g.color;ctx.lineWidth=g.width;ctx.lineCap='round';ctx.lineJoin='round';
   if(g.kind==='ring'){ctx.translate(g.x,g.y);ctx.rotate(g.rotation||0);ctx.beginPath();ctx.ellipse(0,0,g.r,g.r*g.tilt,0,0,TAU);ctx.stroke();}
   else{ctx.shadowColor=g.color;ctx.shadowBlur=g.glow;ctx.beginPath();g.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}ctx.restore();calls++;
 }
 if(atlas)for(const l of frame.layers){const source=l.asset?extras[l.asset]:atlas;if(!source)continue;const col=l.cell%3,row=Math.floor(l.cell/3),sx=l.asset?0:Math.round(col*source.width/3),sy=l.asset?0:Math.round(row*source.height/3),sw=l.asset?source.width:Math.round((col+1)*source.width/3)-sx,sh=l.asset?source.height:Math.round((row+1)*source.height/3)-sy;ctx.save();ctx.globalAlpha=l.alpha;ctx.globalCompositeOperation=frame.composite||l.blend;ctx.translate(l.x,l.y);ctx.rotate(l.rotation);if(l.flipX)ctx.scale(-1,1);ctx.drawImage(source,sx,sy,sw,sh,-l.w/2,-l.h/2,l.w,l.h);ctx.restore();calls++;}
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
   const age=Math.max(0,finite(options.ageMs,0))+Math.max(0,now()-loadStarted),durationMs=isReduced()?420:recipeFor(skill).durationMs;
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
