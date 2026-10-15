(() => {
  'use strict';
  const positions = new Map(), mounts = new WeakMap();
  function mount(scene, options = {}) {
    mounts.get(scene)?.cleanup();
    const C = window.RpgGuardianContract, items = [], listeners = [];
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const connection = window.navigator?.connection;
    const hasObserver = typeof IntersectionObserver === 'function';
    let disposed = false, visible = !hasObserver, interacting = false, pageActive = true, angelVisible = options.resultMode !== true;
    const listen = (node, name, fn, opts) => {
      node?.addEventListener?.(name, fn, opts);
      listeners.push(() => node?.removeEventListener?.(name, fn, opts));
    };
    const allowed = () => !disposed && pageActive && visible && !document.hidden && !reduced?.matches && !connection?.saveData;
    const safe = value => C?.safeArtUrl?.(value) || null;
    const usable = value => {const url = safe(value); return url && /\.(?:mp4|webm)(?:\?.*)?$/i.test(url) ? url : null;};
    const readyClass = item => item.kind === 'tree' ? 'is-tree-video-ready' : 'is-angel-video-ready';
    function display(item, ready) {
      item.ready = !!ready;
      scene.classList.toggle(readyClass(item), item.ready);
    }
    function pause(item) {try {item.video.pause();} catch {}}
    function fail(item) {
      if (item.failed) return;
      item.failed = true; item.wanted = false; item.resumeAfterPending = false;
      pause(item); display(item, false);
      item.video.removeAttribute('src');
      try {item.video.load();} catch {}
    }
    function start(item) {
      if (disposed || !item.wanted || item.failed || item.blocked || item.pending) return;
      item.pending = true;
      let result;
      try {result = item.video.play();} catch (error) {settle(false); return;}
      Promise.resolve(result).then(() => settle(true), () => settle(false));
      function settle(success) {
        item.pending = false;
        if (disposed || item.failed) return;
        const restart = item.resumeAfterPending;
        item.resumeAfterPending = false;
        if (!item.wanted) {pause(item); return;}
        // An in-flight play can be aborted by pause before the tab becomes visible again.
        if (restart && item.video.paused) {start(item); return;}
        if (!success) {item.blocked = true; display(item, false); return;}
        if (item.frameReady) display(item, true);
      }
    }
    function reconcile(retryBlocked = false) {
      for (const item of items) {
        if (item.failed) continue;
        const retry = retryBlocked && item.blocked;
        if (retry) item.blocked = false;
        const wanted = allowed() && !(item.kind === 'angel' && (interacting || !angelVisible));
        const changed = item.wanted !== wanted;
        if (!wanted) {
          if (changed) {item.wanted = false; item.resumeAfterPending = false; pause(item);}
          continue;
        }
        if (!item.loaded) {item.loaded = true; item.video.src = item.url;}
        item.wanted = true;
        if (item.pending) {if (changed) item.resumeAfterPending = true; continue;}
        // Progress/layout updates never create new play promises for an unchanged state.
        if (changed || retry) start(item);
      }
    }
    function restoreTime(item) {
      if (item.restored || !Number.isFinite(item.video.duration) || item.video.duration <= 0) return;
      const time = positions.get(item.url);
      if (Number.isFinite(time) && time >= 0) {
        try {item.video.currentTime = time % item.video.duration;} catch {return;}
      }
      item.restored = true;
    }
    function add(kind, value, selector, poster) {
      const url = usable(value), container = scene.querySelector(selector);
      if (!url || !container) return;
      const video = document.createElement('video');
      if (kind === 'angel' && !video.canPlayType?.('video/webm; codecs="vp9"')) return;
      video.className = kind === 'tree' ? 'guardian-tree-video' : 'guardian-angel-video';
      video.muted = true; video.defaultMuted = true; video.loop = true; video.playsInline = true; video.preload = 'none';
      video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.setAttribute('aria-hidden', 'true');
      const posterUrl = safe(poster); if (posterUrl) video.poster = posterUrl;
      const item = {kind, url, video, failed: false, ready: false, frameReady: false, alphaChecked: false,
        loaded: false, restored: false, wanted: false, pending: false, blocked: false, resumeAfterPending: false};
      items.push(item); container.append(video);
      listen(video, 'loadedmetadata', () => {if (!disposed && !item.failed) restoreTime(item);});
      listen(video, 'loadeddata', () => {
        if (disposed || item.failed) return;
        if (kind === 'angel' && !item.alphaChecked) {
          item.alphaChecked = true;
          // Some browsers decode VP9 but discard its alpha plane. Keep the original transparent art.
          try {
            if (!(video.videoWidth > 0 && video.videoHeight > 0)) throw Error('No decoded frame');
            const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
            const ctx = canvas.getContext('2d', {willReadFrequently: true});
            ctx.drawImage(video, 0, 0, 2, 2, 0, 0, 2, 2);
            if (ctx.getImageData(0, 0, 1, 1).data[3] > 32) throw Error('Alpha unavailable');
          } catch {fail(item); return;}
        }
        restoreTime(item); item.frameReady = true;
        if (!item.blocked) display(item, true);
      });
      listen(video, 'error', () => {if (!disposed) fail(item);});
    }
    add('tree', options.treeVideoUrl || scene.dataset?.guardianTreeVideo, '.guardian-worldtree-background', options.treeArtUrl);
    add('angel', options.deityVideoUrl || scene.dataset?.guardianDeityVideo, '.guardian-angel-foreground', options.deityArtUrl);
    const update = () => reconcile();
    listen(document, 'visibilitychange', update);
    listen(reduced, 'change', update); listen(connection, 'change', update);
    listen(scene, 'pointerdown', () => reconcile(true), {passive: true});
    listen(window, 'pagehide', () => {pageActive = false; reconcile();});
    listen(window, 'pageshow', () => {pageActive = true; reconcile();});
    const observer = hasObserver ? new IntersectionObserver(entries => {
      if (disposed) return;
      const entry = entries.find(value => value.target === scene) || entries[entries.length - 1];
      if (entry) {visible = !!entry.isIntersecting; reconcile();}
    }) : null;
    observer?.observe(scene);
    if (!hasObserver) {
      const checkPosition = () => {
        const box = scene.getBoundingClientRect?.();
        const height = window.innerHeight || document.documentElement?.clientHeight;
        const width = window.innerWidth || document.documentElement?.clientWidth;
        visible = !box || !height || !width || box.bottom > 0 && box.right > 0 && box.top < height && box.left < width;
        reconcile();
      };
      listen(window, 'scroll', checkPosition, {passive: true}); listen(window, 'resize', checkPosition, {passive: true});
      checkPosition();
    }
    function setInteracting(value) {
      if (disposed || interacting === !!value) return;
      interacting = !!value; scene.classList.toggle('is-angel-interacting', interacting); reconcile();
    }
    function setAngelVisible(value) {
      if (disposed || angelVisible === !!value) return;
      angelVisible = !!value; reconcile();
    }
    function cleanup() {
      if (disposed) return;
      disposed = true; observer?.disconnect(); listeners.splice(0).forEach(fn => fn());
      for (const item of items) {
        if (item.loaded && item.frameReady && Number.isFinite(item.video.currentTime)) {
          positions.delete(item.url); positions.set(item.url, item.video.currentTime);
        }
        item.wanted = false; pause(item); item.video.removeAttribute('src');
        try {item.video.load();} catch {}
        item.video.remove();
      }
      while (positions.size > 8) positions.delete(positions.keys().next().value);
      scene.classList.remove('is-tree-video-ready', 'is-angel-video-ready', 'is-angel-interacting');
      if (mounts.get(scene) === api) mounts.delete(scene);
    }
    const api = Object.freeze({setInteracting, setAngelVisible, cleanup,
      getState: () => ({disposed, visible, interacting, angelVisible, media: items.map(x => ({kind: x.kind, ready: x.ready, failed: x.failed, paused: x.video.paused, pending: x.pending, blocked: x.blocked}))})});
    mounts.set(scene, api); reconcile(); return api;
  }
  window.RpgGuardianSceneMedia=Object.freeze({mount});
})();
