/* Candidate-only UI. Source values come from the unconnected ui-proto DOM. */
(function(){
  'use strict';
  if(document.getElementById('dark-ui-style')) return;
  var css=document.createElement('link');
  css.id='dark-ui-style'; css.rel='stylesheet';
  css.href='/ui-generated-20261030/dark-ui.css';
  document.head.appendChild(css);
  var mid=document.getElementById('mid');
  if(!mid) return;
  var row=document.createElement('div');
  row.className='dark-potions';
  row.setAttribute('aria-label','藥水數量為原型示意，並非實際背包');
  row.title='示意資料：開啟補給後讀取原型清單；魔力藥水數量未提供。未連接玩家背包。';
  row.innerHTML=`<span class="dark-potion-group"><b data-potion-status>示意・開補給</b><span data-potion="life">生命 —</span><span>魔力 未提供</span></span><span class="dark-potion-group"><span data-potion="guard">守護 —</span><span data-potion="rage">怒氣 —</span></span>`;
  mid.insertBefore(row,mid.firstChild);
  var host=document.getElementById('panelHost');
  if(!host) return;
  function syncSupply(){
    var panel=host.querySelector('#p-sup');
    if(!panel) return;
    row.querySelector('[data-potion-status]').textContent='示意';
    var values={life:'—',guard:'—',rage:'—'};
    panel.querySelectorAll('.sr .d b').forEach(function(label){
      var match=label.textContent.match(/^(.*?)\s*[×x]\s*(\d+)\s*$/);
      if(!match) return;
      var kind=/治療藥水/.test(match[1])?'life':/守護藥劑/.test(match[1])?'guard':/怒氣精華/.test(match[1])?'rage':null;
      if(kind) values[kind]=match[2];
    });
    [['life','生命'],['guard','守護'],['rage','怒氣']].forEach(function(entry){
      var target=row.querySelector('[data-potion="'+entry[0]+'"]');
      target.textContent=entry[1]+' '+values[entry[0]];
    });
  }
  new MutationObserver(syncSupply).observe(host,{childList:true,subtree:true,characterData:true});
  syncSupply();
})();
