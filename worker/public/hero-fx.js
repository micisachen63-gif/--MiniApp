/* Generated, transparent ornament plates animate independently of the hero art. */
(() => {
  'use strict';
  const ROOT = 'art/ui/hero-fx-20261011/';
  const VERSION = '20261016-advanced-armory1';
  const PALETTES = {
    aegis: { light: '#ecd99e', duration: 12, intensity: .54 },
    fury: { light: '#f9ae79', duration: 9, intensity: .47 },
    wind: { light: '#c2e6cc', duration: 15, intensity: .53 },
    lunar: { light: '#b9d9f5', duration: 17, intensity: .55 },
    ember: { light: '#efb876', duration: 11, intensity: .50 },
    frost: { light: '#bfebff', duration: 16, intensity: .54 },
    chrono: { light: '#d1b9ed', duration: 20, intensity: .54 },
    summon: { light: '#a9dfce', duration: 18, intensity: .53 },
    'thief-shadow': { light: '#c9b7ff', duration: 7, intensity: .38 },
    'thief-venom': { light: '#91dcad', duration: 10, intensity: .40 },
    'thief-flying': { light: '#a3e9f1', duration: 6, intensity: .38 },
    'thief-mirror': { light: '#b9a8fa', duration: 12, intensity: .42 },
  };
  function profile(c = {}) {
    const cls = c.baseClass || 'sword', path = String(c.classPath || '');
    const advanced = window.RpgArmorySpecializations?.resolve(cls, path);
    if (advanced) return { ...advanced, mirror: c.gender === 'm' };
    let theme;
    if (cls === 'thief') theme = path.startsWith('A2') ? 'thief-venom' : path.startsWith('B2') ? 'thief-mirror' : path.startsWith('B') ? 'thief-flying' : 'thief-shadow';
    else if (cls === 'mage') theme = path.startsWith('A2') ? 'frost' : path.startsWith('B1') ? 'chrono' : path.startsWith('B2') ? 'summon' : path === 'B' ? 'chrono' : 'ember';
    else if (cls === 'archer') theme = path.startsWith('B2') || path.startsWith('A2') ? 'lunar' : path === 'B' || path.startsWith('B1') ? 'summon' : 'wind';
    else theme = path.startsWith('A1') || path === 'A' ? 'fury' : path.startsWith('A2') ? 'lunar' : 'aegis';
    const tier = Math.min(4, Number(c.classTier) || path.length);
    // Male/female variants retain the same class language; placement follows pose.
    return { theme, ...PALETTES[theme], tier, mirror: c.gender === 'm', density: tier >= 2 ? 8 : 6,
      ...(cls === 'thief' ? { thief: true, motif: theme.slice(6) } : {}) };
  }
  let observer;
  function syncVisibility(stage, inView) {
    stage.dataset.fxRunning = String(inView && !document.hidden);
  }
  document.addEventListener('visibilitychange', () => {
    document.querySelectorAll('[data-hero-fx]').forEach(s => syncVisibility(s, s.dataset.fxVisible === 'true'));
  });
  function reset() {
    observer?.disconnect();
    observer = null;
  }
  function mount(wardrobe, character) {
    const stage = wardrobe?.querySelector('.doll');
    if (!stage || stage.querySelector('.hero-fx')) return;
    const p = profile(character);
    stage.dataset.heroFx = p.theme;
    stage.dataset.fxTier = String(p.tier);
    stage.dataset.fxRunning = 'false';
    const art = p.art || (p.thief ? 'art/ui/thief-armory-fx-20261016/' + p.theme + '.svg' : ROOT + p.theme + '.webp');
    if (p.thief) stage.dataset.thiefArmoryFx = p.motif;
    if (p.advanced) {
      stage.dataset.advancedArmoryFx = p.id;
      stage.dataset.fxMotion = p.motion;
      stage.style.setProperty('--mote-art', 'url("' + p.particleArt + '?v=' + VERSION + '")');
      stage.style.setProperty('--fx-accent', p.accent);
      stage.style.setProperty('--advanced-motion', 'armory-' + p.motion);
    }
    stage.style.setProperty('--fx-art', 'url("' + art + '?v=' + VERSION + '")');
    stage.style.setProperty('--fx-light', p.light);
    stage.style.setProperty('--fx-duration', p.duration + 's');
    stage.style.setProperty('--fx-intensity', p.intensity);
    stage.style.setProperty('--fx-direction', p.mirror ? '-1' : '1');
    const back = document.createElement('div');
    back.className = 'hero-fx hero-fx--back';
    back.setAttribute('aria-hidden', 'true');
    for (const name of ['hero-fx-art', 'hero-fx-floor']) {
      const layer = document.createElement('div'); layer.className = name; back.append(layer);
    }
    const front = document.createElement('div');
    front.className = 'hero-fx hero-fx--front';
    front.setAttribute('aria-hidden', 'true');
    const aura = document.createElement('div');
    aura.className = 'hero-fx-aura';
    front.append(aura);
    for (let i = 0; i < p.density; i++) {
      const mote = document.createElement('i');
      mote.className = 'hero-fx-mote';
      if (p.thief) mote.classList.add('thief-fx-' + p.motif);
      // Keep every mote on the sides, leaving the face and torso readable.
      const side = i % 2, step = Math.floor(i / 2);
      mote.style.setProperty('--mote-x', (side ? 72 + step * 2 : 24 - step * 2) + '%');
      mote.style.setProperty('--mote-y', (93 - step * 17) + '%');
      mote.style.setProperty('--mote-size', (i % 3 === 0 ? 28 : 19) + 'px');
      mote.style.setProperty('--mote-time', ((p.cadence || 3.6) + i * .35 + p.tier * .2) + 's');
      mote.style.setProperty('--mote-delay', (-i * 1.7 - p.tier - (p.phase || 0) * .23) + 's');
      mote.style.setProperty('--mote-drift', ((side ? -1 : 1) * (10 + step * 3)) + 'px');
      front.append(mote);
    }
    stage.prepend(back);
    stage.append(front);
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (!e.target.isConnected) continue;
          e.target.dataset.fxVisible = String(e.isIntersecting);
          syncVisibility(e.target, e.isIntersecting);
        }
      }, { threshold: .05 });
      observer.observe(stage);
    } else { stage.dataset.fxVisible = 'true'; syncVisibility(stage, true); }
  }
  window.RpgHeroEffects = { mount, reset, profile };
})();

