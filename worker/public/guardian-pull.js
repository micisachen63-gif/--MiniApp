(function () {
  'use strict';
  const C = window.RpgGuardianContract;
  if (!C) throw new Error('guardian-sigil-contract.js must load before guardian-pull.js');
  const mounts = new WeakMap();

  /**
   * Pure result presentation, never a summon request. The caller supplies a committed
   * server operation and selects an existing item ID. Move only changes CSS variables
   * on the same element; no root rendering, random result, timer or network occurs.
   * @param {HTMLElement} element Dedicated card/gesture surface, not the page root.
   * @param {{operation:Object,itemId?:string,distance?:number,eventTarget?:EventTarget,signal?:AbortSignal,onReveal?:Function,onCancel?:Function,cleanupHaptics?:boolean}} options
   */
  function create(element, options = {}) {
    if (!element || typeof element.addEventListener !== 'function') throw new TypeError('A guardian card surface is required');
    mounts.get(element)?.cleanup();
    let operation = null, item = null;
    try {
      const candidate = C.operation(options.operation, options.operation?.charId);
      if (candidate.status === 'committed') { operation = candidate; item = options.itemId ? candidate.results.find(result => result.id === options.itemId) : candidate.results[0]; }
    } catch { /* Missing or untrusted result disables presentation; no quality is invented. */ }
    const enabled = !!(operation && item && C.QUALITY_ORDER.includes(item.quality));
    const target = options.eventTarget || window;
    const distance = Number.isFinite(options.distance) && options.distance > 0 ? options.distance : 140;
    let pointerId = null, startY = 0, progress = 0, disposed = false, revealed = false, paintFrame = null;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const hasFrames = typeof window.requestAnimationFrame === 'function' && typeof window.cancelAnimationFrame === 'function';
    let status = enabled ? 'ready' : 'disabled';
    const listeners = [];
    element.classList.remove('is-pulling', 'is-revealed', 'is-edge-visible', ...C.QUALITY_ORDER.map(quality => `guardian-quality-${quality}`));
    delete element.dataset.guardianQuality;
    element.classList.add('guardian-pull-reveal');
    element.dataset.guardianPullState = status;
    if (enabled) { element.dataset.guardianQuality = item.quality; }
    element.style.setProperty('--guardian-reveal-progress', '0');
    element.style.setProperty('--guardian-pull-distance', '0px');

    function listen(node, name, handler, settings) {
      node.addEventListener(name, handler, settings); listeners.push(() => node.removeEventListener(name, handler, settings));
    }
    function publish() { element.dataset.guardianPullState = status; }
    function captureRelease(id) {
      try { if (id !== null) element.releasePointerCapture?.(id); } catch { /* Capture may already have been released by the browser. */ }
    }
    function paintProgress() {
      if (disposed) return;
      element.style.setProperty('--guardian-reveal-progress', String(progress));
      element.style.setProperty('--guardian-pull-distance', `${progress * distance}px`);
      element.classList.toggle('is-edge-visible', enabled && progress > .5);
      if (enabled) element.classList.toggle(`guardian-quality-${item.quality}`,progress > .5);
      options.onProgress?.(progress,progress*distance);
      if (enabled && progress > .5) (options.haptics || window.RpgGuardianHaptics)?.trigger(operation, item.id, progress);
    }
    function flushProgress() {
      if (paintFrame !== null) { window.cancelAnimationFrame(paintFrame); paintFrame = null; }
      paintProgress();
    }
    function setProgress(value) {
      progress = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      if (!hasFrames || reducedMotion?.matches) { paintProgress(); return; }
      if (paintFrame === null) paintFrame = window.requestAnimationFrame(() => {paintFrame = null; paintProgress();});
    }
    function cancel(reason, notify = true) {
      if (pointerId === null) return;
      const id = pointerId; pointerId = null; status = 'ready';
      element.classList.remove('is-pulling');element.classList.toggle('is-bouncing',reason==='released_early');
      if (notify) options.onCancel?.({operationId: operation.operationId, itemId: item.id, reason});
      setProgress(0); flushProgress(); publish(); captureRelease(id); if (notify) options.onInteractionChange?.(false);
    }
    function down(event) {
      if (!enabled || disposed || revealed || pointerId !== null || options.signal?.aborted || event.isPrimary === false || event.button > 0 || !Number.isFinite(event.clientY) || !Number.isInteger(event.pointerId)) return;
      // Capture is essential: leaving the element must still receive the real release.
      if (typeof element.setPointerCapture !== 'function') return;
      try { element.setPointerCapture(event.pointerId); } catch { return; }
      pointerId = event.pointerId; startY = event.clientY; status = 'pulling';
      event.preventDefault?.(); element.classList.remove('is-bouncing');element.classList.add('is-pulling'); setProgress(0); publish(); options.onInteractionChange?.(true);
    }
    function move(event) {
      if (disposed || pointerId === null || event.pointerId !== pointerId || !Number.isFinite(event.clientY)) return;
      event.preventDefault?.(); setProgress((event.clientY - startY) / distance);
    }
    function up(event) {
      if (disposed || pointerId === null || event.pointerId !== pointerId) return;
      if (!Number.isFinite(event.clientY)) { cancel('invalid_release'); return; }
      event.preventDefault?.(); setProgress((event.clientY - startY) / distance);
      if (progress < 1) { cancel('released_early'); return; }
      flushProgress(); const id = pointerId; pointerId = null; revealed = true; status = 'revealed';
      element.classList.remove('is-pulling'); element.classList.add('is-revealed'); publish(); captureRelease(id);
      options.onReveal?.({operationId: operation.operationId, requestId: operation.requestId, item: {...item}});
      options.onInteractionChange?.(false);
    }
    function pointerCancel(event) { if (event.pointerId === pointerId) cancel('pointercancel'); }
    function lostCapture(event) { if (event.pointerId === pointerId) cancel('capture_lost'); }
    function suspend() { if (!disposed) cancel('suspend'); }
    function cleanup() {
      if (disposed) return;
      disposed = true; cancel('cleanup', false); if (paintFrame !== null) {window.cancelAnimationFrame(paintFrame);paintFrame = null;} status = 'disposed'; publish(); listeners.splice(0).forEach(remove => remove());
      if (options.cleanupHaptics !== false) (options.haptics || window.RpgGuardianHaptics)?.cleanup();
      if (mounts.get(element) === api) mounts.delete(element);
    }
    const api = {suspend, cleanup, isInteracting: () => !disposed && pointerId !== null, getState: () => ({enabled: enabled && !disposed, operationId: operation?.operationId || null, itemId: item?.id || null, progress, revealed, status, primaryPointerId: pointerId})};
    mounts.set(element, api);
    if (enabled && !options.signal?.aborted) {
      listen(element, 'pointerdown', down);
      listen(element, 'lostpointercapture', lostCapture);
      listen(target, 'pointermove', move, {capture: true, passive: false});
      listen(target, 'pointerup', up, {capture: true, passive: false});
      listen(target, 'pointercancel', pointerCancel, true);
      listen(target, 'blur', suspend);
      listen(target, 'pagehide', suspend);
      listen(target, 'resize', suspend);
      if (typeof document !== 'undefined') listen(document, 'visibilitychange', () => {if (document.hidden) suspend();});
      if (options.signal) listen(options.signal, 'abort', cleanup, {once: true});
    } else if (options.signal?.aborted) cleanup();
    return api;
  }
  window.RpgGuardianPull = Object.freeze({create});
})();
