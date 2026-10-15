// Painted environments: bounded 30 fps, image-space water masks, no gameplay state.
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const cache = new Map();
  const foams = new WeakMap();
  const clouds = new WeakMap();
  function water(image,id=4) {
    if (cache.has(image.src)) return cache.get(image.src);
    const c = document.createElement('canvas'); c.width = 720; c.height = Math.round(720 * image.height / image.width);
    const x = c.getContext('2d'); x.drawImage(image, 0, 0, c.width, c.height);
    try {
      const d = x.getImageData(0, 0, c.width, c.height);
      for (let y = 0; y < c.height; y++) for (let i = y * c.width * 4; i < (y + 1) * c.width * 4; i += 4) {
        const [r,g,b] = d.data.subarray(i,i+3);
        const blue = id===6 ? Math.min(1,Math.max(0,(r-Math.max(g,b)-30)/70)) : Math.min(1, Math.max(0, (Math.min(g,b)-r-(id===7?2:8))/24));
        const bounds=id===3?[.36,.59]:id===7?[.39,.66]:id===6?[.31,.61]:[.30,.665];
        const band = Math.min(1,Math.max(0,(y/c.height-bounds[0])*40),Math.max(0,(bounds[1]-y/c.height)*45));
        d.data[i+3] = Math.round(255 * blue * band);
      }
      x.putImageData(d,0,0);
    } catch { x.clearRect(0,0,c.width,c.height); }
    cache.set(image.src,c); return c;
  }

  const profiles = Object.freeze({
    1: { title:'月光穿林 · 螢火與溪霧', tint:'#9dbfff', wind:.5, leaves:22, fog:.12, rays:.11 },
    2: { title:'聖殿日光 · 長明火與金塵', tint:'#ffe2a3', wind:.7, dust:24, rays:.15, flames:[[.06,.43],[.94,.43]] },
    3: { title:'瀑布飛沫 · 林風與泉水', tint:'#c3efd4', wind:.8, leaves:25, fog:.13, falls:[[.46,.37,.022,.17],[.53,.38,.015,.16]], rays:.11 },
    4: { title:'湧浪拍岸 · 海風與鹽霧', tint:'#c5eaff', wind:1.4, fog:.09, spray:24 },
    5: { title:'暮色迷宮 · 飛沙與門前火光', tint:'#ffbd72', wind:1.2, dust:30, rays:.07, flames:[[.475,.53],[.635,.53]] },
    6: { title:'熔岩脈動 · 熱浪與升騰火星', tint:'#ff7b36', wind:.8, embers:42, fog:.16 },
    7: { title:'冥河幽流 · 漂游魂火與低霧', tint:'#9cb4d2', wind:.35, souls:18, fog:.28 },
    8: { title:'神諭光柱 · 山谷雲霧與聖符', tint:'#ffe4a7', wind:.5, dust:20, fog:.12, rays:.18, runes:true },
    9: { title:'山隘風雪 · 雲層與冰晶', tint:'#d7e9ff', wind:2, snow:65, fog:.17 },
    10: { title:'雲海流動 · 天光與浮羽', tint:'#fff0c2', wind:.6, feathers:17, fog:.24, rays:.16 },
    11: { title:'暖風花海 · 花瓣與金色暮光', tint:'#ffcf99', wind:.65, petals:30, fog:.08, rays:.12 },
    12: { title:'星穹流光 · 星軌與神域極光', tint:'#b8c7ff', wind:.25, stars:45, fog:.10, aurora:true }
  });
  const fract=n=>n-Math.floor(n);
  const hash=n=>fract(Math.sin(n*127.1+311.7)*43758.5453);
  function glow(ctx,x,y,rx,ry,color,alpha) {
    ctx.save();ctx.translate(x,y);ctx.scale(rx,ry);ctx.globalAlpha=alpha;
    const g=ctx.createRadialGradient(0,0,0,0,0,1);g.addColorStop(0,color);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(-1,-1,2,2);ctx.restore();
  }

  function cloudLayer(image,id) {
    if(clouds.has(image))return clouds.get(image);
    const c=document.createElement('canvas');c.width=640;c.height=Math.round(640*image.naturalHeight/image.naturalWidth);const x=c.getContext('2d');x.drawImage(image,0,0,c.width,c.height);
    try{const d=x.getImageData(0,0,c.width,c.height);for(let y=0;y<c.height;y++)for(let xx=0;xx<c.width;xx++){
      const i=(y*c.width+xx)*4,r=d.data[i],g=d.data[i+1],b=d.data[i+2],v=Math.min(r,g,b),sat=Math.max(r,g,b)-v;
      const edge=Math.min(1,Math.max(0,(xx/c.width-.31)*25),Math.max(0,(.87-xx/c.width)*25));
      const top=[9,10,12].includes(id)?.41:.26;
      const band=Math.min(1,Math.max(0,(top-y/c.height)*25));
      d.data[i+3]=Math.round(255*edge*band*Math.min(1,Math.max(0,(v-140)/65))*Math.max(0,1-sat/110));
    }x.putImageData(d,0,0);}catch{x.clearRect(0,0,c.width,c.height);}clouds.set(image,c);return c;
  }

  function scenic(ctx,w,h,t,id,image,position) {
    const p=profiles[id];if(!p)return;
    if(image?.naturalWidth){
      const cloud=cloudLayer(image,id),scale=Math.max(w/cloud.width,h/cloud.height),dw=cloud.width*scale,dh=cloud.height*scale;
      ctx.save();ctx.globalAlpha=.48;
      ctx.drawImage(cloud,(w-dw)/2+Math.sin(t*.15)*dw*.007,(h-dh)*position+Math.cos(t*.12)*dh*.002,dw,dh);ctx.restore();
    }
    // Anchor effects in the original painting so phone cropping preserves their location.
    const iw=image?.naturalWidth||1664, ih=image?.naturalHeight||941,scale=Math.max(w/iw,h/ih);
    const dw=iw*scale,dh=ih*scale,ox=(w-dw)/2,oy=(h-dh)*position;
    ctx.save();ctx.translate(ox,oy);ctx.scale(dw,dh);
    if(p.rays){
      ctx.globalCompositeOperation='screen';
      for(let i=0;i<3;i++){
        const x=(id===1?.56:.82)+Math.sin(t*.09+i)*.035-i*.14;
        const g=ctx.createLinearGradient(x,0,x-.15,.72);g.addColorStop(0,p.tint);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.globalAlpha=p.rays*(.65+.35*Math.sin(t*.27+i));
        ctx.beginPath();ctx.moveTo(x-.012,.04);ctx.lineTo(x+.003,.04);ctx.lineTo(x-.02,.75);ctx.lineTo(x-.24,.75);ctx.closePath();ctx.fill();
      }ctx.globalCompositeOperation='source-over';
    }
    if(p.fog)for(let i=0;i<4;i++) {
      const x=fract(i*.29+t*.008*p.wind)*1.5-.25;
      glow(ctx,x,.49+Math.sin(t*.16+i)*.025,.32,.045+(id===10?.045:0),id===6?'#a87b72':p.tint,p.fog*(.85+.35*Math.sin(t*.4+i)));
    }
    if(p.falls)for(const [x,y,ww,hh] of p.falls){
      ctx.save();ctx.beginPath();ctx.rect(x-ww,y,ww*2,hh);ctx.clip();
      for(let i=0;i<14;i++){const yy=y+fract(t*.55+i/14)*hh;ctx.globalAlpha=.16+hash(i)*.16;ctx.strokeStyle='#d7ffff';ctx.lineWidth=.001;
        ctx.beginPath();ctx.moveTo(x+(hash(i+2)-.5)*ww,yy);ctx.lineTo(x+(hash(i+2)-.5)*ww+.001,yy+.026);ctx.stroke();}
      ctx.restore();glow(ctx,x,y+hh,ww*3,.022,'#d9faff',.16+.05*Math.sin(t*1.3));
    }
    if(p.flames)for(const [x,y] of p.flames){
      glow(ctx,x,y,.035,.065,'#ff7e22',.15+.06*Math.sin(t*5+x*10));
      for(let j=0;j<4;j++){ctx.globalAlpha=.28;ctx.fillStyle=j%2?'#ffe6a0':'#ff9a3b';ctx.beginPath();ctx.moveTo(x-.0015,y);ctx.quadraticCurveTo(x-.003,y-.016,x+Math.sin(t*7+j)*.004,y-.022-hash(j)*.008);ctx.quadraticCurveTo(x+.003,y-.012,x+.0015,y);ctx.fill();}
    }
    if(id===6){glow(ctx,.5,.48,.48,.13,'#ff631b',.10+.06*Math.sin(t*1.8));}
    if(p.runes){
      ctx.save();ctx.translate(.365,.31);ctx.scale(1,iw/ih);ctx.rotate(t*.10);ctx.strokeStyle='#ffe4a1';ctx.lineWidth=.001;ctx.globalAlpha=.3;
      ctx.beginPath();ctx.arc(0,0,.027,0,Math.PI*2);ctx.stroke();
      for(let i=0;i<8;i++){const a=i*Math.PI/4;ctx.beginPath();ctx.moveTo(Math.cos(a)*.019,Math.sin(a)*.019);ctx.lineTo(Math.cos(a)*.035,Math.sin(a)*.035);ctx.stroke();}ctx.restore();
    }
    if(p.aurora){
      ctx.save();ctx.beginPath();ctx.rect(0,0,1,.36);ctx.clip();
      for(let j=0;j<3;j++){ctx.beginPath();for(let x=0;x<=1.01;x+=.01){const y=.12+j*.035+Math.sin(x*8+t*.22+j)*.045;x?ctx.lineTo(x,y):ctx.moveTo(x,y);}
        ctx.strokeStyle=['#8fe8dd','#b1a3ff','#91bbff'][j];ctx.lineWidth=.018;ctx.globalAlpha=.08;ctx.stroke();}ctx.restore();
      const cycle=t%15;if(cycle<1.5){const u=cycle/1.5;ctx.globalAlpha=Math.sin(u*Math.PI)*.65;ctx.strokeStyle='#edf4ff';ctx.lineWidth=.0013;ctx.beginPath();ctx.moveTo(.7-u*.25,.05+u*.12);ctx.lineTo(.75-u*.25,.025+u*.12);ctx.stroke();}
    }
    ctx.restore();
    // Near and far particles use distinct sizes and velocities to create depth.
    const kind=['leaves','dust','embers','souls','snow','feathers','petals','stars','spray'].find(k=>p[k]);
    for(let i=0;i<(p[kind]||0);i++){
      const near=i%3===0,depth=near?1:.45,rate=kind==='embers'?-.075:kind==='snow'?.065:kind==='spray'?-.04:.018;
      const x=fract(hash(i+1)+t*.016*p.wind*depth+Math.sin(t*.4+i)*.018)*w;
      const y=fract(hash(i+70)+t*rate*depth)*h;
      if(kind==='stars'&&y>h*.42)continue;
      if(kind==='spray'&&(y<h*.38||y>h*.66))continue;
      ctx.globalAlpha=(near?.65:.32)*(.55+.45*Math.sin(t*.7+i)**2);
      ctx.fillStyle=kind==='embers'?'#ffb459':kind==='petals'?'#ffe0ce':kind==='leaves'?'#bdd092':kind==='souls'?'#88c9eb':p.tint;
      const size=(near?2.4:1)*Math.min(1.6,w/430);
      if(['leaves','petals','feathers'].includes(kind)){
        ctx.save();ctx.translate(x,y);ctx.rotate(t*.8+i);ctx.beginPath();ctx.ellipse(0,0,size*1.7,Math.max(.4,size*.45),0,0,Math.PI*2);ctx.fill();ctx.restore();
      }else if(kind==='snow'){
        ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=near?1.1:.65;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+p.wind*size,y+size*2);ctx.stroke();
      }else{ctx.beginPath();ctx.arc(x,y,kind==='souls'?size*1.5:size*.65,0,Math.PI*2);ctx.fill();if(kind==='souls')glow(ctx,x,y,size*5,size*5,'#83caef',.13);}
    }
    // Soft edge shading gives the lit middle distance a stronger sense of depth.
    const shade=ctx.createRadialGradient(w*.5,h*.42,w*.20,w*.5,h*.45,w*.75);shade.addColorStop(0,'transparent');shade.addColorStop(1,id===7?'rgba(5,12,26,.32)':'rgba(7,13,25,.18)');ctx.globalAlpha=1;ctx.fillStyle=shade;ctx.fillRect(0,0,w,h);
  }

  function paint(ctx,w,h,t,id,image,position=.88) {
    if (window.RpgMapVideo?.has(id)) return;
    if (!id || reduced.matches || (image && !image.complete)) return;
    ctx.save();
    if ([3,4,6,7].includes(id) && image?.complete && image.naturalWidth) {
      const sea = water(image,id), scale = Math.max(w/sea.width,h/sea.height);
      const dw=sea.width*scale,dh=sea.height*scale,ox=(w-dw)/2,oy=(h-dh)*position;
      // Refracted water moves independently; masonry and rocks remain stationary.
      ctx.globalAlpha=.95;
      for(let y=0;y<sea.height;y+=3) {
        const depth=Math.max(0,y/sea.height-.30);
        const dx=Math.sin(t*1.5+y*.075)*depth*(id===4?16:id===6?8:6);
        ctx.drawImage(sea,0,y,sea.width,Math.min(3,sea.height-y),ox+dx,oy+y*scale,dw,Math.min(3,sea.height-y)*scale+.5);
      }
      // Rolling crests advance toward the shore, masked to actual blue water.
      let foam=foams.get(sea);if(!foam){foam=document.createElement('canvas');foam.width=sea.width;foam.height=sea.height;foams.set(sea,foam);}
      const f=foam.getContext('2d');f.clearRect(0,0,foam.width,foam.height);f.globalCompositeOperation='source-over';f.lineWidth=1.1;
      for(let k=0;k<(id===4?9:5);k++) {
        const p=(t*(id===4?.11:.055)+k/(id===4?9:5))%1, yy=sea.height*((id===3?.38:.32)+(id===3?.18:.33)*p);
        f.strokeStyle=id===6?`rgba(255,173,64,${Math.sin(p*Math.PI)*.28})`:`rgba(230,255,255,${Math.sin(p*Math.PI)*(id===4?.85:.35)})`;f.beginPath();
        for(let xx=0;xx<=sea.width;xx+=4) {const y=yy+Math.sin(xx*.037+t*1.3+k)*2.5*p;xx?f.lineTo(xx,y):f.moveTo(xx,y);} f.stroke();
      }
      f.globalCompositeOperation='destination-in';f.drawImage(sea,0,0);
      ctx.globalAlpha=.9;ctx.drawImage(foam,ox,oy,dw,dh);
    }
    scenic(ctx,w,h,t,id,image,position);
    ctx.restore();
  }
  function attach(root,bg) {
    const stopVideo=window.RpgMapVideo?.mount(root,bg);
    const canvas=document.createElement('canvas');canvas.className='map-motion';canvas.setAttribute('aria-hidden','true');bg.append(canvas);
    const ctx=canvas.getContext('2d');let image=null,url='',raf=0,last=0,inView=true;
    function start(){if(!raf&&!document.hidden&&inView&&!reduced.matches&&root.isConnected)raf=requestAnimationFrame(frame);}
    function frame(ts){raf=0;if(!root.isConnected){cleanup();return;}if(reduced.matches){canvas.width=canvas.width;return;}if(document.hidden||!inView)return;
      if(ts-last>=33){last=ts;const r=bg.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5),w=Math.round(r.width*dpr),h=Math.round(r.height*dpr);
        if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
        ctx.clearRect(0,0,w,h);const source=getComputedStyle(bg).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]||'';
        if(source!==url){url=source;image=new Image();image.src=url;}
        paint(ctx,w,h,ts/1000,Number(root.dataset.scene),image,parseFloat(getComputedStyle(bg).backgroundPositionY)/100||.88);
      }start();
    }
    const visibility=()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else start();};
    const motion=()=>{canvas.width=canvas.width;cancelAnimationFrame(raf);raf=0;start();};
    const observer=new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;if(!inView){cancelAnimationFrame(raf);raf=0;}else start();});observer.observe(root);
    document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',motion);
    // Detached stages must release observers even if removed while the tab is hidden.
    const removal=new MutationObserver(()=>{if(!root.isConnected)cleanup();else start();});removal.observe(document.body,{childList:true,subtree:true});
    function cleanup(){stopVideo?.();cancelAnimationFrame(raf);raf=0;observer.disconnect();removal.disconnect();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',motion);canvas.remove();}
    start();return cleanup;
  }
  window.RpgMapMotion=Object.freeze({attach,paint,profiles});
})();
