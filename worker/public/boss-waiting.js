(() => {
  const poster = 'art/map-video/boss-wait-v1.webp';
  function markup(label) {
    return `<div class="bossbox boss-wait"><img class="boss-wait-poster" src="${poster}" alt="星光下的空曠神殿與雲海"><video class="boss-wait-video" muted playsinline loop preload="none" aria-hidden="true"></video><div class="tag">${label}</div><div class="boss-wait-caption"><span>星穹靜候・諸神將至</span><small>雲海之外，下一場神戰正在醞釀</small></div></div>`;
  }
  function mount(root) {
    if (!root) return () => {};
    const video = root.querySelector('video');
    video.muted = true; video.defaultMuted = true;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false, disposed = false, failed = false;
    const allowed = () => visible && !document.hidden && !motion.matches && !navigator.connection?.saveData;
    function play() {
      if (!disposed && allowed() && !failed) video.play().catch(() => {});
    }
    function update() {
      if (disposed) return;
      if (!allowed()) { video.pause(); if (motion.matches || navigator.connection?.saveData) video.classList.remove('ready'); return; }
      const source = 'art/map-video/boss-wait-' + (innerWidth <= 768 ? '540' : '720') + 'p-v1.mp4';
      if (video.getAttribute('src') !== source) {
        video.classList.remove('ready'); failed = false; video.src = source; video.preload = 'auto';
      }
      play();
    }
    video.addEventListener('playing', () => { if (allowed() && !disposed) video.classList.add('ready'); else video.pause(); });
    video.addEventListener('error', () => { failed = true; video.classList.remove('ready'); });
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); });
    observer.observe(root);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('resize', update);
    motion.addEventListener('change', update);
    navigator.connection?.addEventListener('change', update);
    root.addEventListener('pointerdown', play);
    return () => {
      disposed = true; observer.disconnect(); video.pause(); video.removeAttribute('src'); video.load();
      document.removeEventListener('visibilitychange', update); window.removeEventListener('resize', update);
      motion.removeEventListener('change', update); navigator.connection?.removeEventListener('change', update);
      root.removeEventListener('pointerdown', play);
    };
  }
  window.RpgBossWaiting = Object.freeze({markup, mount});
})();
