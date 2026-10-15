// Load only the active map. The painted background remains visible until playback starts.
(() => {
  const available = new Set(['1','2','3','4','5','6','7','8','9','10','11','12']);
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  function mount(root, bg) {
    const video = document.createElement('video');
    video.className = 'map-video'; video.muted = true; video.defaultMuted = true;
    video.loop = true; video.playsInline = true; video.preload = 'none';
    video.setAttribute('muted', ''); video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true'); video.tabIndex = -1;
    bg.append(video);
    let visible = false, source = '', failed = false, disposed = false, pending = false;
    const active = () => available.has(root.dataset.scene);
    const allowed = () => active() && visible && !document.hidden && !rm.matches && !navigator.connection?.saveData;
    function play() {
      if (!allowed() || failed || disposed || pending) return;
      pending = true;
      video.play().catch(() => { video.classList.remove('ready'); }).finally(() => { pending = false; });
    }
    function update() {
      if (disposed) return;
      root.classList.toggle('video-map', active());
      if (!active()) {
        video.pause(); video.classList.remove('ready'); failed = false;
        if (source) { video.removeAttribute('src'); video.load(); source = ''; }
        return;
      }
      const quality = innerWidth <= 768 ? '540' : '720';
      const desired = 'art/map-video/myth'+String(root.dataset.scene).padStart(2,'0')+'-'+quality+'p-v1.mp4';
      if(source && source!==desired){video.pause();video.classList.remove('ready');video.removeAttribute('src');video.load();source='';failed=false;}
      if (!allowed()) {
        video.pause();
        if (rm.matches || navigator.connection?.saveData) video.classList.remove('ready');
        return;
      }
      if (!source) {
        source = desired;
        video.src = source; video.preload = 'auto';
      }
      play();
    }
    video.addEventListener('playing', () => {
      if (allowed() && !disposed) video.classList.add('ready'); else video.pause();
    });
    video.addEventListener('error', () => { failed = true; video.classList.remove('ready'); });
    const scene = new MutationObserver(update);
    scene.observe(root, { attributes: true, attributeFilter: ['data-scene'] });
    const viewport = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); });
    viewport.observe(root);
    document.addEventListener('visibilitychange', update);
    rm.addEventListener('change', update);
    navigator.connection?.addEventListener('change', update);
    root.addEventListener('pointerdown', play);
    update();
    return () => {
      disposed = true; video.pause(); video.removeAttribute('src'); video.load(); video.remove();
      scene.disconnect(); viewport.disconnect(); rm.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
      navigator.connection?.removeEventListener('change', update);
      root.removeEventListener('pointerdown', play); root.classList.remove('video-map');
    };
  }
  window.RpgMapVideo = Object.freeze({ mount, has: id => available.has(String(id)) });
})();



