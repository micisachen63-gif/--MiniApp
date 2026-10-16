(function () {
  'use strict';
  const TYPES = Object.freeze({melee:'近戰傷害',ranged:'遠程傷害',magic:'魔法傷害',loot:'隨機掉寶率'});
  const SHORT = Object.freeze({melee:'近傷',ranged:'遠傷',magic:'魔傷',loot:'掉寶'});
  const ORDER = ['white','green','blue','purple','red','gold','pink','cyan'];
  const COLORS = Object.freeze({white:'#d3d5dc',green:'#a0c69c',blue:'#91b8d7',purple:'#b59aca',red:'#d59591',gold:'#dec27f',pink:'#dda9c5',cyan:'#9bcbd0'});
  const esc = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const pct = value => (value*100).toLocaleString('zh-TW',{maximumFractionDigits:2});

  /** Only the selected character's server snapshot determines the buff.
   * guardianAttackPct already uses the exact PvE damage category. Never infer
   * a damage bonus from a base class, animation, or the equipped feather alone.
   * Additional summon-stone support stays separate from this permanent bonus. */
  function model(me) {
    const C = window.RpgGuardianContract;
    const guardian = me?.guardian, actor = String(me?.character?.tgId ?? '');
    if (!actor || !guardian?.id || !Object.hasOwn(TYPES,guardian.type) || !ORDER.includes(guardian.quality)) return null;
    const known = guardian.type === 'loot' ? finite(guardian.lootBonus) : finite(me?.stats?.guardianAttackPct);
    const bonus = known ? (guardian.type === 'loot' ? guardian.lootBonus : me.stats.guardianAttackPct) : null;
    const rank = ORDER.indexOf(guardian.quality)+1;
    const assist = me.guardianAssist, fighting = me.character.state === 'fighting' && !me.character.partyId;
    const enabled = me.guardianSummonEnabled === true;
    const selected = assist?.itemId === guardian.id;
    const assisting = enabled && selected && Number.isSafeInteger(assist.remainingBattles) && assist.remainingBattles > 0 && fighting;
    const support = assisting ? '參戰中' : enabled && selected ? (fighting ? '等待召喚' : '準備參戰') : '守護中';
    const art = C?.safeArtUrl?.(guardian.artUrl) || null;
    const typeName = C?.TYPE_NAMES?.[guardian.type] || TYPES[guardian.type];
    const qualityName = C?.QUALITY_NAMES?.[guardian.quality] || guardian.quality;
    return {
      actor,id:String(guardian.id),type:guardian.type,typeName,quality:guardian.quality,qualityName,rank,
      art,color:COLORS[guardian.quality],visual:guardian.visual === true && rank >= 4 && !!art,
      bonus,known,useful:known && bonus > 0,ability:TYPES[guardian.type],short:SHORT[guardian.type],
      value:!known?'待同步':bonus > 0?`+${pct(bonus)}%`:'未加成',
      effect:!known?'能力資料同步中':bonus > 0?`${TYPES[guardian.type]} +${pct(bonus)}%`:guardian.type==='loot'?'目前沒有掉寶加成':'此角色的攻擊類型不符，傷害未加成',
      scope:guardian.type==='loot'?'掉寶採相對倍率，只影響符合資格的隨機收穫。':'適用掛機、群組 BOSS 與組隊副本；不影響 PK。',
      assisting,support,remaining:assisting?assist.remainingBattles:null
    };
  }

  function buffMarkup(m) {
    if (!m) return '';
    return `<button type="button" class="guardian-idle-buff-button ${m.useful?'is-useful':'is-inactive'}" data-guardian-buff-toggle aria-expanded="false" aria-label="${esc(`${m.qualityName}色 ${m.typeName}，${m.effect}，${m.support}`)}"><span class="guardian-idle-buff-icon" aria-hidden="true">${m.art?`<img src="${esc(m.art)}" alt="" decoding="async" draggable="false">`:''}<i>✦</i><b>${esc(m.qualityName)}</b></span><span class="guardian-idle-buff-copy"><strong>${esc(m.short)} ${esc(m.value)}</strong><small>${esc(m.support)}</small></span></button><div class="guardian-idle-buff-detail" hidden><header><strong>${esc(m.typeName)}</strong><span>${esc(m.qualityName)}色羽毛</span></header><p>${esc(m.effect)}</p><small>${esc(m.scope)}</small><small>${esc(m.assisting?'召喚石支援額外加成依實際戰鬥結算；此處主值為常駐守護。':m.support==='等待召喚'?'等待下一次實際戰鬥確認召喚石；尚未顯示參戰加成。':'啟用的常駐能力持續生效，同時只套用一位守護天使。')}</small></div>`;
  }

  function projectionMarkup(m) {
    if (!m?.visual) return '';
    return `<span class="guardian-idle-cloud" aria-hidden="true"><i></i><b></b></span><span class="guardian-idle-apparition ${m.assisting?'is-assisting':'is-guarding'}" aria-hidden="true"><span class="guardian-idle-halo"><i></i><b></b></span><span class="guardian-idle-radiance"></span><img class="guardian-idle-angel" src="${esc(m.art)}" alt="" decoding="async" draggable="false"><span class="guardian-idle-stars"><i></i><i></i><i></i><i></i><i></i></span></span>`;
  }

  /** Fits the complete angel into the stage. Image proportions remain intact. */
  function placement(point,width,height) {
    const w = Math.max(1,Number(width)||1), h = Math.max(1,Number(height)||1);
    const head=Math.max(0,Math.min(h,Number(point?.y)||h*.65));
    // Keep clear of the collapsed BUFF (bottom 89px), hover and rotation.
    const ceiling=104, gap=28, available=head-gap-ceiling;
    const angelHeight=Math.max(1,Math.min(180,Math.max(120,h*.34),available));
    const angelWidth=Math.min(angelHeight*.72,Math.max(1,w-16));
    const cloudWidth=Math.min(156,Math.max(88,angelWidth*1.45),Math.max(1,w-16));
    const top=Math.max(ceiling,head-angelHeight-gap);
    return {height:angelHeight,width:angelWidth,cloudWidth,cloudHeight:40,hidden:available<60,
      left:Math.max(cloudWidth/2+8,Math.min(w-cloudWidth/2-8,Number(point?.x)||w*.25)),top};
  }

  /** No network, timer, RAF or video decoder. The existing battle renderer
   * owns snapshots and positioning; transform-only CSS supplies the motion. */
  function create(root) {
    const buff = document.createElement('div'), projection = document.createElement('div');
    buff.className='guardian-idle-buff';projection.className='guardian-idle-projection';
    buff.hidden=true;projection.hidden=true;root.append(buff,projection);
    let key='',current=null,disposed=false,generation=0;
    const click = event => {
      const toggle=event.target.closest?.('[data-guardian-buff-toggle]');
      if(!toggle || !buff.contains(toggle))return;
      const detail=buff.querySelector('.guardian-idle-buff-detail');if(!detail)return;
      detail.hidden=!detail.hidden;toggle.setAttribute('aria-expanded',String(!detail.hidden));
    };
    buff.addEventListener('click',click);
    function bindArt(container,epoch) {
      for(const image of container.querySelectorAll('img')) {
        const finish = ok => {
          if(disposed || epoch!==generation || !container.contains(image))return;
          image.classList.toggle('is-ready',ok);image.classList.toggle('is-missing',!ok);
          image.parentElement?.classList.toggle('has-missing-art',!ok);
        };
        image.addEventListener('load',()=>finish(true),{once:true});
        image.addEventListener('error',()=>finish(false),{once:true});
        if(image.complete)finish(image.naturalWidth>0);
      }
    }
    function update(me,{paused=false,reducedMotion=false}={}) {
      if(disposed)return;
      const next=model(me),nextKey=next?JSON.stringify(next):'';
      current=next;
      root.classList.toggle('guardian-idle-paused',paused);
      root.classList.toggle('guardian-idle-reduced-motion',reducedMotion);
      if(nextKey===key)return;
      key=nextKey;generation++;
      buff.hidden=!next;projection.hidden=!next?.visual;
      buff.innerHTML=buffMarkup(next);projection.innerHTML=projectionMarkup(next);
      for(const node of [buff,projection]){node.style.setProperty('--guardian-idle-color',next?.color||COLORS.white);node.dataset.guardianId=next?.id||'';node.dataset.characterId=next?.actor||'';}
      bindArt(buff,generation);bindArt(projection,generation);
    }
    function position(point,width,height) {
      if(disposed || !current?.visual || !root.isConnected)return;
      const p=placement(point,width,height);
      projection.hidden=p.hidden||!current?.visual;
      projection.style.left=p.left+'px';projection.style.top=p.top+'px';
      projection.style.width=p.width+'px';projection.style.height=p.height+'px';
      projection.style.setProperty('--guardian-cloud-width',p.cloudWidth+'px');
      projection.style.setProperty('--guardian-cloud-height',p.cloudHeight+'px');
    }
    function cleanup() {disposed=true;generation++;buff.removeEventListener('click',click);buff.remove();projection.remove();current=null;}
    return Object.freeze({update,position,cleanup,get current(){return current;}});
  }
  window.RpgGuardianIdleFX=Object.freeze({model,buffMarkup,projectionMarkup,placement,create});
})();
