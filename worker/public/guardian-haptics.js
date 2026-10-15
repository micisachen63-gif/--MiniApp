(function () {
  'use strict';
  const C = window.RpgGuardianContract;
  if (!C) throw new Error('guardian-sigil-contract.js must load before guardian-haptics.js');
  const sessionSeen = new Set();
  let fallbackOwner = null;
  const patterns = {blue: 12, purple: 18, red: 25, gold: 45, pink: 50, cyan: 60};
  const styles = {blue: 'light', purple: 'medium', red: 'heavy', gold: 'rigid', pink: 'rigid', cyan: 'rigid'};
  /** Fixed-on short feedback, deduplicated per entire committed operation. No player preference or RNG. */
  function create(options = {}) {
    const seen = options.seen || sessionSeen, npcTimers = new Set(),scatterTimers=new Set();
    let storage; try { storage = options.storage === undefined ? window.sessionStorage : options.storage; } catch { storage = null; }
    const telegram = options.telegram === undefined ? window.Telegram : options.telegram;
    const nav = options.navigator === undefined ? window.navigator : options.navigator;
    const later = options.setTimeout || setTimeout, stop = options.clearTimeout || clearTimeout;
    const doc=options.document===undefined?(window.document||(typeof document==='undefined'?null:document)):options.document;
    let scatterListening=false,scatterEpoch=0;
    const pulseOwner = {};
    function vibrate(pattern) {try {if (typeof nav?.vibrate !== 'function' || nav.vibrate(pattern) === false) return false; fallbackOwner = pulseOwner; return true;} catch {return false;}}
    function trigger(value, itemId, progress) {
      if (!(typeof progress === 'number' && progress > .5)) return false;
      let operation; try { operation = C.operation(value, value?.charId); } catch { return false; }
      const item = operation.results.find(entry => entry.id === itemId);
      if (operation.status !== 'committed' || !item || !patterns[item.quality]) return false;
      const key = `guardianHaptic:${operation.operationId}`;
      try { if (seen.has(key) || storage?.getItem(key) === '1') return false; } catch { if (seen.has(key)) return false; }
      seen.add(key); try { storage?.setItem(key, '1'); } catch { /* Memory still prevents repeated feedback on storage-restricted devices. */ }
      const feedback = telegram?.WebApp?.HapticFeedback;
      if (typeof feedback?.impactOccurred === 'function') {
        try { feedback.impactOccurred(styles[item.quality]); } catch { return false; }
        return true;
      }
      if (typeof nav?.vibrate === 'function') return vibrate(patterns[item.quality]);
      return false;
    }
    function revealAll(value) {
      let operation; try { operation = C.operation(value, value?.charId); } catch { return false; }
      const highest = operation.results.reduce((best, item) => !best || C.QUALITY_ORDER.indexOf(item.quality) > C.QUALITY_ORDER.indexOf(best.quality) ? item : best, null);
      return highest ? trigger(operation, highest.id, 1) : false;
    }
    function stopScatter(){scatterEpoch++;scatterTimers.forEach(id=>stop(id));scatterTimers.clear();if(scatterListening){doc?.removeEventListener?.('visibilitychange',scatterVisibility);scatterListening=false;}}
    function scatterVisibility(){if(doc?.hidden){stopScatter();if(fallbackOwner===pulseOwner){fallbackOwner=null;try{nav?.vibrate?.(0);}catch{}}}}
    /** Three deliberate impacts at the receipt's one-time light burst, separate
     * from the quality pulse. Hidden/removed scenes stop remaining impacts. */
    function scatter(value){
      if(doc?.hidden)return false;let operation;try{operation=C.operation(value,value?.charId);}catch{return false;}
      if(operation.status!=='committed'||operation.action!=='summon'||!operation.results.length)return false;
      const key='guardianScatter:'+operation.operationId;try{if(seen.has(key)||storage?.getItem(key)==='1')return false;}catch{if(seen.has(key))return false;}
      seen.add(key);try{storage?.setItem(key,'1');}catch{}stopScatter();const epoch=scatterEpoch;
      const feedback=telegram?.WebApp?.HapticFeedback;
      if(typeof feedback?.impactOccurred==='function'){
        try{feedback.impactOccurred('medium');}catch{return false;}
        if(doc?.addEventListener){doc.addEventListener('visibilitychange',scatterVisibility);scatterListening=true;}
        [110,220].forEach(delay=>{const id=later(()=>{if(epoch!==scatterEpoch)return;scatterTimers.delete(id);if(!doc?.hidden)try{feedback.impactOccurred('medium');}catch{}if(!scatterTimers.size)stopScatter();},delay);scatterTimers.add(id);});return true;
      }
      const result=vibrate([25,85,25,85,25]);if(result&&doc?.addEventListener){doc.addEventListener('visibilitychange',scatterVisibility);scatterListening=true;}return result;
    }
    function npcTap(rapid = false) {
      const feedback = telegram?.WebApp?.HapticFeedback;
      npcTimers.forEach(id => stop(id)); npcTimers.clear();
      if (typeof feedback?.impactOccurred === 'function') {
        try { feedback.impactOccurred('light'); } catch { return false; }
        if (rapid) [40, 80].forEach(delay => {const id = later(() => {npcTimers.delete(id); try { feedback.impactOccurred('light'); } catch {}}, delay); npcTimers.add(id);});
        return true;
      }
      if (typeof nav?.vibrate === 'function') return vibrate(rapid ? [8, 20, 8, 20, 8] : 8);
      return false;
    }
    function cleanup() { npcTimers.forEach(id => stop(id)); npcTimers.clear();stopScatter(); if (fallbackOwner === pulseOwner) {fallbackOwner = null; try { nav?.vibrate?.(0); } catch {}} }
    return {trigger, revealAll,scatter, npcTap, cleanup};
  }
  const defaultHaptics = create();
  window.RpgGuardianHaptics = Object.freeze({create, trigger: defaultHaptics.trigger, revealAll: defaultHaptics.revealAll,scatter:defaultHaptics.scatter, npcTap: defaultHaptics.npcTap, cleanup: defaultHaptics.cleanup});
})();
