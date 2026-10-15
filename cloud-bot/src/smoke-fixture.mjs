// Invented actors and combat snapshots only; no credentials, player data or network.
export const pk={id:'cloud-animation-fixture-pk',status:'done',decidedAt:1,a:{name:'測試劍聖',baseClass:'sword',gender:'f',classPath:'B'},b:{name:'測試妖精',baseClass:'archer',gender:'m',classPath:'A121'},winner:'a',rounds:3,log:{max:{a:1000,b:900},initial:{hp:{a:1000,b:900},mp:{a:80,b:120}},maxMp:{a:80,b:120},hp:{a:600,b:0},steps:[{by:'a',dmg:200,hp:700},{by:'b',dmg:100,hp:900},{by:'a',dmg:200,skill:true,hp:500},{by:'b',dmg:100,hp:800},{by:'a',dmg:200,hp:300},{by:'b',dmg:200,crit:true,skill:true,hp:600},{by:'a',dmg:300,crit:true,skill:true,hp:0}]}};
const members=[{id:'1',name:'測試劍士',base:'sword',gender:'m',classPath:'A12',level:90,maxHp:1000,hp:900},{id:'2',name:'測試妖精',base:'archer',gender:'f',classPath:'B121',level:120,maxHp:800,hp:700},{id:'3',name:'測試法師',base:'mage',gender:'f',classPath:'B12',level:90,maxHp:600,hp:500}];
const snap=(enemyHp,hp=[900,700,500])=>({enemyHp,enemyMaxHp:3000,enemyName:'試煉泰坦',members:members.map((m,i)=>({id:m.id,maxHp:m.maxHp,hp:hp[i]}))});
const events=[
 {actorId:'1',label:'劍刃突襲',damage:200,after:snap(2800)},
 {actorId:'2',label:'穿透箭',damage:300,after:snap(2500)},
 {actorId:'3',label:'群體治療',healed:350,targets:['1','2','3'],after:snap(2500,[1000,800,550])},
 {actorId:'boss',label:'泰坦重擊',damage:300,hits:[{id:'1',damage:80},{id:'2',damage:100},{id:'3',damage:120}],after:snap(2500,[920,700,430])},
 {actorId:'1',label:'防禦',skillId:'defend',shielded:50,after:snap(2500,[920,700,430])},
 {actorId:'2',label:'爆擊箭',damage:500,crit:true,after:snap(2000,[920,700,430])},
];
export const party={id:'cloud-animation-fixture-party',status:'combat',kind:'dungeon',dungeonId:'titan',floor:1,round:2,rev:2,name:'三人泰坦試煉',map:2,members,log:['試煉泰坦：真實戰況回放'],enemy:{name:'試煉泰坦',hp:2000,maxHp:3000},battleTurn:{id:'cloud-animation-fixture-party:1:1',floor:1,round:1,before:snap(3000),events,after:events.at(-1).after}};
