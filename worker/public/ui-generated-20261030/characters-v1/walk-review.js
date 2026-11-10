// Local review only: renders the selected source rectangles without changing source pixels.
(async()=>{
  const params=new URLSearchParams(location.search);
  await import('./character-catalog-loader.js');
  const catalog=await fetch(params.get('catalog')==='advancement'?'advancement-index.json':'catalog-index.json').then(r=>r.json());
  const actor=document.getElementById('actor'),direction=document.getElementById('direction'),frames=document.getElementById('frames'),status=document.getElementById('status'),play=document.getElementById('play'),animated=document.getElementById('animated');
  const images=new Map();let generation=0,current=null,raf=0,start=0;
  for(const item of catalog.actors){const option=document.createElement('option');option.value=item.id;option.textContent=item.label;actor.append(option);}
  actor.value=catalog.actors.some(a=>a.id===params.get('actor'))?params.get('actor'):(catalog.actors.find(a=>a.id==='sword_m')||catalog.actors.find(a=>a.clips.walk)||catalog.actors[0]).id;
  direction.value=['up','down','left','right'].includes(params.get('direction'))?params.get('direction'):'right';
  async function getImage(url){if(!images.has(url))images.set(url,new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=url;}));return images.get(url);}
  function draw(canvas,frame,clip,image){
    const ctx=canvas.getContext('2d'),scale=230/frame.bodyHeight,[x,y,w,h]=frame.rect,[ax,ay]=frame.anchor;
    ctx.clearRect(0,0,360,310);ctx.strokeStyle='#80909d66';ctx.beginPath();ctx.moveTo(0,280);ctx.lineTo(360,280);ctx.stroke();
    ctx.save();ctx.translate(180,280);if(clip.mirrorX)ctx.scale(-1,1);
    if(clip.render==='layered-walk-v1'){
      ctx.scale(scale,scale);ctx.translate(0,-clip.layered.ground);
      LayeredWalkRenderer.drawPose(ctx,{image,...clip.layered,phase:frame.phase});ctx.restore();return;
    }
    if(frame.sourceClipPolygon){ctx.beginPath();frame.sourceClipPolygon.forEach((p,n)=>ctx[n?'lineTo':'moveTo']((p[0]-ax)*scale,(p[1]-ay)*scale));ctx.closePath();ctx.clip();}
    ctx.drawImage(image,x,y,w,h,-ax*scale,-ay*scale,w*scale,h*scale);ctx.restore();
  }
  function stop(){cancelAnimationFrame(raf);raf=0;animated.replaceChildren();play.textContent='播放';}
  async function render(){
    const id=++generation;stop();current=null;frames.replaceChildren();
    const reference=catalog.actors.find(a=>a.id===actor.value),item=await window.CharacterCatalogLoader.loadActor(reference);
    if(id!==generation)return;
    const clip=item.clips.walk?.[direction.value];
    if(!clip){status.textContent=item.label+'・此方向行走尚未選用';play.disabled=true;return;}
    play.disabled=false;status.textContent=item.label+'・'+clip.frames.length+' 個姿勢・'+(clip.gaitAccepted?'四關鍵幀步態可用（非完整角色驗收）':'候選／未完成步態驗收');
    const loaded=await Promise.all(clip.frames.map(f=>getImage(f.url)));if(id!==generation)return;
    const heading=document.createElement('h2');heading.textContent=clip.render==='layered-walk-v1'?'分層長袍輕步：固定尺度、獨立腿部、每循環 12 相位':'固定人物尺度與接地線；跨步 A → 收腳 B → 換腳 C → 收腳 D';frames.append(heading);
    const row=document.createElement('div');row.className='row';frames.append(row);
    clip.frames.forEach((frame,i)=>{const card=document.createElement('div');card.className='frame';const canvas=document.createElement('canvas');canvas.width=360;canvas.height=310;canvas.setAttribute('aria-label','姿勢 '+(i+1));draw(canvas,frame,clip,loaded[i]);const label=document.createElement('div');label.className='label';label.textContent=(i+1)+' · '+frame.label+' · '+frame.durationMs+'ms';card.append(canvas,label);row.append(card);});
    current={clip,loaded};
  }
  play.addEventListener('click',()=>{if(raf){stop();return;}if(!current)return;const canvas=document.createElement('canvas');canvas.width=360;canvas.height=310;animated.append(canvas);play.textContent='停止';const total=current.clip.frames.reduce((n,f)=>n+f.durationMs,0);start=performance.now();
    function tick(now){if(document.hidden){stop();return;}let t=(now-start)%total,index=0;while(index<current.clip.frames.length-1&&t>=current.clip.frames[index].durationMs)t-=current.clip.frames[index++].durationMs;draw(canvas,current.clip.frames[index],current.clip,current.loaded[index]);raf=requestAnimationFrame(tick);}raf=requestAnimationFrame(tick);
  });
  actor.addEventListener('change',render);direction.addEventListener('change',render);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  render().catch(error=>status.textContent='讀取失敗：'+error.message);
})().catch(error=>document.getElementById('status').textContent='讀取失敗：'+error.message);
