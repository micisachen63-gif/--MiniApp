/* HUD + floating panels. All data is mock / display-only. */
(function(){
'use strict';
var A=window.UIArt,$=function(s){return document.querySelector(s);};
var RC=['#d8d2c4','#6fb0ff','#c48cff','#ffc94a','#ff6a4a'],RN=['普通','高級','極品','傳說','遺物'];
var ART={sword:1,helm:1,armor:1,under:1,belt:1,glove:1,boot:1,earring:1,ring:1},ART1={potion:1,scroll:1,gem:1};
function artSrc(n,r){return ART[n]?'assets/items/'+n+'_'+r+'.webp':ART1[n]?'assets/items/'+n+'.webp':null;}
var UI=window.UI={skills:[],paused:false,open:null};
// orbs
var orbs=[].map.call(document.querySelectorAll('.orb canvas'),function(c,i){return new A.Orb(c,i?['#bfe8ff','#2f6fd0','#0a1d55','rgba(150,210,255,.30)']:['#ffb08a','#c0241a','#3a0606','rgba(255,170,110,.25)']);});
UI.hp=[1,1];UI.mp=[1,1];
UI.setHP=function(v,m){orbs[0].v=Math.max(0,v/m);$('#hpTxt').textContent=Math.round(v);};
UI.setMP=function(v,m){orbs[1].v=Math.max(0,v/m);$('#mpTxt').textContent=Math.round(v);};
// skills
var SK=[['slash','斬擊',0,0],['spin','旋風斬',4.5,25],['charge','衝鋒',6,15],['shout','戰吼',12,20],['quake','地裂',9,30],['potion','治療藥水',15,0]];
SK.forEach(function(s,i){var d=document.createElement('div');d.className='sk';var ic=A.medal(s[0],96);ic.className='ic';d.appendChild(ic);
 var cd=A.cv(96,96);cd.className='cd';d.appendChild(cd);var k=document.createElement('span');k.className='k';k.textContent=i+1;d.appendChild(k);
 var t=document.createElement('span');t.className='t';d.appendChild(t);
 var o={el:d,name:s[0],label:s[1],cd:s[2],cost:s[3],left:0,cv:cd,t:t};UI.skills.push(o);
 d.addEventListener('pointerdown',function(e){e.stopPropagation();d.classList.add('press');setTimeout(function(){d.classList.remove('press');},120);UI.cast&&UI.cast(i);});
 d.addEventListener('pointerenter',function(){tip(d,{n:s[1],r:-1,sub:'技能・快捷鍵 '+(i+1),lines:[s[2]?'冷卻 '+s[2]+' 秒':'無冷卻',s[3]?'消耗 '+s[3]+' 怒氣':'產生 8 怒氣'],u:''});});
 d.addEventListener('pointerleave',hideTip);$('#skills').appendChild(d);});
UI.trigger=function(i){var s=UI.skills[i];if(s.left>0)return false;s.left=s.cd;return true;};
function drawCD(s){var x=s.cv.getContext('2d');if(s.left<=0){if(s.t.textContent){x.clearRect(0,0,96,96);s.t.textContent='';}return;}x.clearRect(0,0,96,96);
 var f=s.left/s.cd,a=-Math.PI/2+f*Math.PI*2;x.fillStyle='rgba(2,6,20,.66)';x.beginPath();x.moveTo(48,48);x.arc(48,48,44,-Math.PI/2,a);x.closePath();x.fill();
 x.strokeStyle='rgba(255,236,180,.95)';x.lineWidth=3;x.beginPath();x.arc(48,48,44,a,-Math.PI/2+Math.PI*2);x.stroke();
 s.t.textContent=s.left>=1?Math.ceil(s.left):s.left.toFixed(1);}
// buffs
[['rage',3],['shield',0],['spin',12]].forEach(function(b){var d=document.createElement('div');d.className='buff';d.appendChild(A.medal(b[0],56));if(b[1]){var e=document.createElement('em');e.textContent=b[1];d.appendChild(e);}$('#buffs').appendChild(d);});
// function buttons
var FN=[['背包','inv','belt'],['裝備','eq','helm'],['補給','sup','potion'],['技能','sk','spin'],['地圖','map','quake'],['設定','set','shield']];
FN.forEach(function(f){var d=document.createElement('div');d.className='fb';d.appendChild(A.medal(f[2],40));d.appendChild(Object.assign(document.createElement('span'),{textContent:f[0]}));d.dataset.p=f[1];d.addEventListener('pointerdown',function(e){e.stopPropagation();if(f[1])UI.toggle(f[1]);else UI.toast(f[0]+'（原型未實作）','此按鈕於原型中為佔位','scroll');});$('#fn').appendChild(d);});
// toasts
UI.toast=function(title,sub,glyph){var d=document.createElement('div');d.className='toast';d.innerHTML='<div class="em"><span></span></div><div class="tx"><b></b><span></span></div>';
 d.querySelector('.em span').appendChild(Object.assign(A.medal(glyph||'sword',80),{style:'width:40px;height:40px;display:block'}));d.querySelector('b').textContent=title;d.querySelector('.tx span').textContent=sub||'';
 var h=$('#toasts');h.appendChild(d);while(h.children.length>3)h.removeChild(h.firstChild);requestAnimationFrame(function(){d.classList.add('on');});
 setTimeout(function(){d.classList.remove('on');setTimeout(function(){d.remove();},500);},3600);};
// target bar
UI.target=function(name,role,f){var t=$('#target');if(!name){t.classList.add('hide');return;}t.classList.remove('hide');var n=$('#tname');n.textContent=name;n.className='tn '+(role||'');$('#tfill').style.width=(Math.max(0,f)*100)+'%';};
UI.kills=0;UI.addKill=function(){UI.kills++;$('#qk').textContent=Math.min(40,UI.kills);};
UI.setXP=function(f){$('#xpfill').style.width=(f*100)+'%';};
// items (mock)
var ITEMS=[['sword','泰坦裂空劍',3,'劍盾',['+412 攻擊力','+18% 暴擊傷害','+9% 攻擊速度'],'「風暴在劍鋒上低語。」'],['helm','斯巴達青銅盔',2,'頭盔',['+86 護甲','+6% 生命'],''],['armor','赫菲斯托斯胸甲',1,'盔甲',['+140 護甲'],''],['ring','奧林帕斯之戒',4,'戒指',['+12% 全屬性','技能冷卻 -10%','擊殺回復 3% 生命'],'「眾神遺落的誓約。」'],['gem','碎雷寶石',2,'寶石',['鑲嵌：+30 雷擊傷害'],''],['potion','大型治療藥水',0,'消耗品',['立即回復 40% 生命'],''],['boot','赫密士戰靴',1,'長靴',['+8% 移動速度'],''],['glove','泰坦青銅護手',2,'手套',['+5% 攻擊速度','+40 力量'],''],['earring','月神耳墜',3,'耳環',['+15% 魔法尋寶','+60 智力'],''],['belt','獅紋腰帶',0,'腰帶',['+30 體力'],''],['under','亞麻戰袍',0,'內衣',['+10 護甲'],''],['scroll','回城卷軸',0,'消耗品',['傳送回營地'],'']];
var iconCache={};function ic(n,r){var k=n+r;return iconCache[k]||(iconCache[k]=A.icon(n,84,r>0?RC[r]:null));}
function slotEl(it,cnt){var d=document.createElement('div');d.className='slot'+(it?' r'+it[2]:' empty');if(it){var src=artSrc(it[0],it[2]);if(src){var im=new Image();im.src=src;im.draggable=false;d.appendChild(im);}else{var c=document.createElement('canvas');c.width=c.height=84;c.getContext('2d').drawImage(ic(it[0],it[2]),0,0);d.appendChild(c);}
 if(cnt){var e=document.createElement('em');e.textContent=cnt;d.appendChild(e);}d.addEventListener('pointerenter',function(){tip(d,{n:it[1],r:it[2],sub:RN[it[2]]+'・'+it[3],lines:it[4],u:it[5]});});d.addEventListener('pointerdown',function(e){e.stopPropagation();tip(d,{n:it[1],r:it[2],sub:RN[it[2]]+'・'+it[3],lines:it[4],u:it[5]});});d.addEventListener('pointerleave',hideTip);}return d;}
function tip(el,o){var t=$('#tip'),rc=o.r<0?'#c9a45c':RC[o.r];t.style.setProperty('--rc',rc);
 t.innerHTML='<div class="h"><b></b><span></span></div><div class="b"></div>';t.querySelector('b').textContent=o.n;t.querySelector('.h span').textContent=o.sub;
 var b=t.querySelector('.b');o.lines.forEach(function(l,i){var d=document.createElement('div');d.textContent=l;if(i==0)d.className='w';b.appendChild(d);});if(o.u){b.appendChild(Object.assign(document.createElement('div'),{className:'sep'}));b.appendChild(Object.assign(document.createElement('div'),{className:'u',textContent:o.u}));}
 var r=el.getBoundingClientRect(),s=$('#stage').getBoundingClientRect(),x=r.left-s.left+r.width/2-100;x=Math.max(6,Math.min(s.width-206,x));t.style.left=x+'px';t.classList.add('on');var h=t.offsetHeight,y=r.top-s.top-h-8;if(y<6)y=r.bottom-s.top+8;t.style.top=y+'px';}
function hideTip(){$('#tip').classList.remove('on');}UI.tip=tip;
function panel(id,title){var p=document.createElement('div');p.className='panel';p.id='p-'+id;p.innerHTML='<i class="mt"></i><canvas class="ped" width="300" height="88"></canvas><i class="cn tl"></i><i class="cn tr"></i><i class="cn bl"></i><i class="cn br"></i><h2></h2><span class="x">✕</span><div class="body" style="display:flex;flex-direction:column;flex:1;min-height:0"></div>';
 p.querySelector('h2').textContent=title;var pc=p.querySelector('.ped').getContext('2d');A.laurelArc(pc,150,130,118,Math.PI*1.07,Math.PI*1.36,1,9);A.laurelArc(pc,150,130,118,Math.PI*1.93,Math.PI*1.64,-1,9);
 p.querySelectorAll('.tab').forEach(function(){});p.addEventListener('click',function(e){var t=e.target.closest('.tab');if(t){t.parentNode.querySelectorAll('.tab').forEach(function(q){q.classList.toggle('on',q===t);});}});p.querySelector('.x').addEventListener('pointerdown',function(e){e.stopPropagation();UI.toggle(id);});p.addEventListener('pointerdown',function(e){e.stopPropagation();});return p;}
var P={};
P.inv=function(){var p=panel('inv','背　包'),b=p.querySelector('.body');b.innerHTML='<div class="tabs"><span class="tab on">裝備</span><span class="tab">消耗品</span><span class="tab">素材</span><span class="tab">任務</span></div>';
 var g=document.createElement('div');g.className='grid';var fill=[0,3,1,8,4,5,7,2,null,6,9,11,4,null,null,10,null,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null];
 fill.forEach(function(k,i){g.appendChild(slotEl(k==null?null:ITEMS[k],k==5?12:k==11?3:k==4?2:0));});b.appendChild(g);
 b.insertAdjacentHTML('beforeend','<div class="inv-foot"><span>容量 14 / 36</span><span style="color:#e8c46a">金幣 12,480</span></div>');return p;};
P.eq=function(){var p=panel('eq','裝　備'),b=p.querySelector('.body');var e=document.createElement('div');e.className='eq';
 var order=[['頭盔',1],['盔甲',2],['內衣',10],['腰帶',9],['手套',7],['長靴',6],['耳環',8],['戒指',3]];
 function col(list,cls){var c=document.createElement('div');c.className='eqcol '+cls;list.forEach(function(o){var it=ITEMS[o[1]],r=document.createElement('div');r.className='eqs';r.appendChild(slotEl(it));
  var l=document.createElement('div');l.className='l';l.innerHTML='<b></b><span></span>';l.querySelector('b').textContent=it[1];l.querySelector('b').style.color=RC[it[2]];l.querySelector('span').textContent=o[0];r.appendChild(l);c.appendChild(r);});return c;}
 e.appendChild(col(order.slice(0,4),'l'));var d=document.createElement('div');d.className='doll';d.innerHTML='<i class="col a"></i><i class="col b"></i><img src="assets/hero_full.webp" alt="">';e.appendChild(d);e.appendChild(col(order.slice(4),'r'));b.appendChild(e);
 b.insertAdjacentHTML('beforeend','<div class="stats"><div>攻擊力<b>1,284</b></div><div>護甲<b>2,140</b></div><div>生命<b>3,600</b></div><div>暴擊率<b>18.5%</b></div><div>攻擊速度<b>1.32</b></div><div>移動速度<b>+8%</b></div></div>');return p;};
P.sup=function(){var p=panel('sup','補　給'),b=p.querySelector('.body');b.innerHTML='<div class="tabs"><span class="tab on">藥水</span><span class="tab">卷軸</span><span class="tab">強化</span></div>';var s=document.createElement('div');s.className='sup';
 [[5,'恢復 40% 生命，冷卻 15 秒',120,'×12'],[11,'立即傳送回營地',60,'×3'],[4,'鑲嵌於武器或飾品',880,'×2'],[[ 'rage','怒氣精華',2,'消耗品',['30 秒內怒氣產生 +50%'],''],'30 秒內怒氣產生 +50%',450,'×0'],[['shield','守護藥劑',1,'消耗品',['受到傷害 -15%，持續 60 秒'],''],'受到傷害 -15%，60 秒',300,'×1']].forEach(function(r){var it=typeof r[0]=='number'?ITEMS[r[0]]:r[0];
  var row=document.createElement('div');row.className='sr';row.appendChild(slotEl(it));row.insertAdjacentHTML('beforeend','<div class="d"><b></b><span></span></div><div class="price"></div><div class="btn">購買</div>');
  row.querySelector('b').textContent=it[1]+'  '+r[3];row.querySelector('b').style.color=RC[it[2]];row.querySelector('.d span').textContent=r[1];row.querySelector('.price').textContent='◈ '+r[2];
  row.querySelector('.btn').addEventListener('pointerdown',function(e){e.stopPropagation();UI.toast('已購買 '+it[1],'原型展示：未連線伺服器','potion');});s.appendChild(row);});b.appendChild(s);return p;};
// skills panel
var SKD={slash:'對前方敵人揮出一記重斬',spin:'旋轉劍刃，傷害周圍所有敵人',charge:'衝向目標並短暫暈眩',shout:'提升自身與隊友攻擊力 20%',quake:'劈裂大地，對直線敵人造成傷害',potion:'快速飲用治療藥水'};
P.sk=function(){var p=panel('sk','技　能'),b=p.querySelector('.body');b.innerHTML='<div class="tabs"><span class="tab on">主動</span><span class="tab">被動</span><span class="tab">天賦</span></div>';var l=document.createElement('div');l.className='lst';
 SK.forEach(function(s,i){var r=document.createElement('div');r.className='sr';var m=A.medal(s[0],92);m.style.cssText='width:46px;height:46px;flex:none';r.appendChild(m);
  r.insertAdjacentHTML('beforeend','<div class="d"><b></b><span></span></div><div class="lv"></div>');r.querySelector('b').textContent=s[1]+'　鍵 '+(i+1);r.querySelector('.d span').textContent=SKD[s[0]]+(s[2]?'・冷卻 '+s[2]+'s':'');r.querySelector('.lv').textContent='Lv '+[12,9,7,5,6,1][i];l.appendChild(r);});
 b.appendChild(l);b.insertAdjacentHTML('beforeend','<div class="inv-foot"><span>技能點 3</span><span style="color:#e8c46a">自動施放：開</span></div>');return p;};
// map panel (12 maps, thumbnails from existing ground art)
var MAPS=['阿耳忒彌斯月桂林','雅典娜百柱神殿','阿卡迪亞山林','愛琴海崖','米諾斯迷宮','赫菲斯托斯熔爐','冥河斯堤克斯渡口','德爾菲阿波羅神諭谷','奧林帕斯泰坦山隘','雲海神門','至福樂土','奧林帕斯星穹聖殿'];
P.map=function(){var p=panel('map','地　圖'),b=p.querySelector('.body');var l=document.createElement('div');l.className='lst';
 MAPS.forEach(function(n,i){var r=document.createElement('div');r.className='sr'+(i==8?' cur':i>8?' lock':'');r.innerHTML='<img class="mth" alt=""><div class="d"><b></b><span></span></div>'+(i<=8?'<div class="btn">'+(i==8?'所在':'前往')+'</div>':'<div class="lv">未解鎖</div>');
  r.querySelector('img').src='assets/maps/map'+(i+1)+'.webp';r.querySelector('b').textContent=(i+1)+'．'+n;r.querySelector('.d span').textContent='建議等級 '+(1+i*3)+'–'+(5+i*3)+(i==8?'・目前位置':'');
  var bt=r.querySelector('.btn');if(bt)bt.addEventListener('pointerdown',function(e){e.stopPropagation();UI.toast(i==8?'你已在此地圖':'前往 '+n,'原型展示：未連線伺服器','quake');});l.appendChild(r);});
 b.appendChild(l);setTimeout(function(){var c=l.querySelector('.cur');if(c)l.scrollTop=c.offsetTop-l.offsetTop-60;},0);return p;};
// settings panel (localStorage only)
var SET_KEY='xq_ui_settings';function getSet(){try{return Object.assign({music:true,sfx:true,shake:true,dmg:true,lang:'trad'},JSON.parse(localStorage.getItem(SET_KEY)||'{}'));}catch(e){return {music:true,sfx:true,shake:true,dmg:true,lang:'trad'};}}
function saveSet(o){try{localStorage.setItem(SET_KEY,JSON.stringify(o));}catch(e){}UI.settings=o;}UI.settings=getSet();
P.set=function(){var p=panel('set','設　定'),b=p.querySelector('.body'),o=getSet(),l=document.createElement('div');l.className='lst';
 [['music','背景音樂','戰鬥與城鎮配樂'],['sfx','音效','技能、打擊與介面音效'],['shake','畫面震動','受擊與首領技能'],['dmg','傷害數字','顯示浮動傷害']].forEach(function(t){var r=document.createElement('div');r.className='set';r.innerHTML='<span><b></b><small></small></span><i class="tg"></i>';r.querySelector('b').textContent=t[1];r.querySelector('small').textContent=t[2];
  var g=r.querySelector('.tg');g.classList.toggle('on',!!o[t[0]]);r.addEventListener('pointerdown',function(e){e.stopPropagation();o[t[0]]=!o[t[0]];g.classList.toggle('on',o[t[0]]);saveSet(o);});l.appendChild(r);});
 var r=document.createElement('div');r.className='set';r.innerHTML='<span><b>文字風格</b><small>介面用語</small></span><div class="seg"><i data-v="trad">繁體</i><i data-v="myth">神話古風</i></div>';
 r.querySelectorAll('.seg i').forEach(function(x){x.classList.toggle('on',o.lang==x.dataset.v);x.addEventListener('pointerdown',function(e){e.stopPropagation();o.lang=x.dataset.v;r.querySelectorAll('.seg i').forEach(function(y){y.classList.toggle('on',y===x);});saveSet(o);});});l.appendChild(r);
 b.appendChild(l);b.insertAdjacentHTML('beforeend','<div class="inv-foot"><span>設定僅存於本機</span><span style="color:#e8c46a">版本 原型</span></div>');return p;};
UI.toggle=function(id){var host=$('#panelHost');hideTip();var cur=UI.open;if(cur){var el=$('#p-'+cur);el.classList.remove('on');setTimeout(function(){el.remove();},230);UI.open=null;document.querySelectorAll('.fb').forEach(function(f){f.classList.remove('on');});}
 $('#ui').classList.toggle('pop',cur!==id);if(cur===id)return;var p=P[id]();host.appendChild(p);requestAnimationFrame(function(){p.classList.add('on');});UI.open=id;var fb=document.querySelector('.fb[data-p="'+id+'"]');if(fb)fb.classList.add('on');};
document.addEventListener('pointerdown',function(){hideTip();});
// chat (mock, local timer only — no network)
var CHAT=[['世界','阿基里斯','有人一起打熔岩巨像嗎？缺坦。'],['公會','雅典娜之盾','今晚 21:00 公會遠征，記得補給藥水'],['世界','海倫','出售 傳說・雷鳴戰盔，私訊'],['系統','','奧林帕斯神殿的星門將於 10 分鐘後開啟'],['世界','佩爾修斯','泰坦山隘第三層怪好多，好爽'],['隊伍','奧德修斯','我先拉，大家跟上']],LOG=[],ci=0;
function pushChat(){var m=CHAT[ci++%CHAT.length];LOG.push(m);if(LOG.length>40)LOG.shift();var l=$('#chatLine');l.innerHTML='';$('#chat .ch').textContent=m[0];
 if(m[1])l.appendChild(Object.assign(document.createElement('b'),{textContent:m[1]+'：'}));l.appendChild(document.createTextNode(m[2]));var c=$('#chat');c.classList.remove('new');void c.offsetWidth;c.classList.add('new');if(UI.open==='chat')renderLog();}
function renderLog(){var g=$('#p-chat .chatlog');if(!g)return;g.innerHTML='';LOG.forEach(function(m){var d=document.createElement('div');if(m[0]=='系統')d.className='sys';d.innerHTML='<span class="chn"></span>';d.firstChild.textContent=m[0];if(m[1])d.appendChild(Object.assign(document.createElement('b'),{textContent:m[1]+'：'}));d.appendChild(document.createTextNode(m[2]));g.appendChild(d);});g.scrollTop=1e6;}
P.chat=function(){var p=panel('chat','聊　天'),b=p.querySelector('.body');b.innerHTML='<div class="tabs"><span class="tab on">全部</span><span class="tab">世界</span><span class="tab">公會</span><span class="tab">隊伍</span></div><div class="chatlog"></div><div class="chatin"><div>輸入訊息…（原型）</div><div class="btn">傳送</div></div>';setTimeout(renderLog,0);return p;};
for(var k=0;k<4;k++)pushChat();setInterval(pushChat,7000);
$('#chat').addEventListener('pointerdown',function(e){e.stopPropagation();UI.toggle('chat');});
$('#quest').addEventListener('pointerdown',function(e){e.stopPropagation();this.classList.toggle('col');});
// portrait from the game's own character art
(function(){var im=new Image();im.onload=function(){var x=$('#pc').getContext('2d');x.drawImage(im,im.width*.30,im.height*.06,im.width*.32,im.width*.32,0,0,112,112);};im.src='assets/hero_full.webp';})();
// loop for orbs / cooldowns
var last=performance.now();(function loop(t){var dt=Math.min(.1,(t-last)/1000);last=t;orbs.forEach(function(o){o.draw(dt);});UI.skills.forEach(function(s){if(s.left>0){s.left-=dt;if(s.left<=0){s.left=0;s.el.classList.add('ready');setTimeout(function(){s.el.classList.remove('ready');},500);}}drawCD(s);});requestAnimationFrame(loop);})(last);
})();
