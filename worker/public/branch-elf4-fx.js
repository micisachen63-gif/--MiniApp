// Exact fourth-advancement elf attack art. Visuals only; battle.js owns impact timing.
(() => {
  'use strict';
  const api = window.RpgSkillFX;
  if (!api || window.RpgElf4AttackFX) return;
  const previousDraw = api.draw, previousProfile = api.profile;
  const ROOT = 'art/elf-adv4-attack-fx-20261013/';
  const VERSION = '20261013-elf4-attack2';
  const PATH = /^[AB][12]{3}$/;
  const PATHS = ['A111', 'A112', 'A121', 'A122', 'A211', 'A212', 'A221', 'A222',
    'B111', 'B112', 'B121', 'B122', 'B211', 'B212', 'B221', 'B222'];
  const PHASES = Object.freeze({ charge: [0], flight: [1, 2, 3], impact: [4, 5, 6, 7] });
  const PET_SKILLS = Object.freeze({ '獵鷹助攻': 'falcon', '獵鷹標記': 'falcon', '靈獸撲擊': 'beast', '野獸之王': 'wolf', '萬獸神尊・終章': 'beast' });
  const PET_PATH = /^B[12]{0,3}$/;
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
  let active = null, epoch = 0, manifestFlight = null;

  function eligible(cls, path) { return cls === 'archer' && typeof path === 'string' && PATH.test(path); }
  function petEligible(cls, path) { return cls === 'archer' && typeof path === 'string' && PET_PATH.test(path); }
  function validateManifest(manifest) {
    if (manifest?.schemaVersion !== 1 || manifest.baseClass !== 'archer' ||
      manifest.genderMode !== 'shared' || manifest.version !== VERSION ||
      manifest.cols !== 4 || manifest.rows !== 2 || manifest.cell !== 512 || manifest.frames !== 8 ||
      !manifest.entries || Object.keys(manifest.entries).length !== PATHS.length)
      throw new Error('Invalid elf-four attack manifest');
    for (const path of PATHS) {
      const entry = manifest.entries[path];
      if (!entry || entry.path !== path || entry.src !== `${ROOT}archer_${path}.webp`)
        throw new Error(`Invalid elf-four attack entry: ${path}`);
      if (entry.layout && (entry.layout.cols !== 1 || entry.layout.rows !== 1 || entry.layout.cell !== 512))
        throw new Error(`Unsupported single-frame layout: ${path}`);
      Object.freeze(entry.layout || {});
      Object.freeze(entry);
    }
    if (manifest.petSkills) {
      for (const [name, type] of Object.entries(PET_SKILLS)) {
        const pet = manifest.petSkills[name];
        if (!pet || pet.type !== type || pet.src !== `${ROOT}pet-${type}.webp`)
          throw new Error(`Invalid elf pet entry: ${name}`);
        Object.freeze(pet);
      }
      Object.freeze(manifest.petSkills);
    }
    Object.freeze(manifest.entries);
    return Object.freeze(manifest);
  }
  function loadManifest() {
    if (!manifestFlight) {
      manifestFlight = fetch(`${ROOT}manifest.json?v=${VERSION}`)
        .then(response => {
          if (!response.ok) throw new Error('Elf-four attack manifest unavailable');
          return response.json();
        })
        .then(validateManifest)
        .catch(error => { manifestFlight = null; throw error; });
    }
    return manifestFlight;
  }
  function settle(state, result) {
    if (state.resolve) { state.resolve(result); state.resolve = null; }
  }
  function dispose() {
    epoch++;
    const state = active;
    active = null;
    if (!state) return;
    state.ready = false;
    settle(state, false);
    for (const resource of Object.values(state.resources || {})) {
      resource.ready = false;
      resource.image.onload = null;
      resource.image.onerror = null;
      resource.image.src = '';
    }
    state.image = null;
    state.resources = {};
  }
  function prepare(cls, path) {
    if (!eligible(cls, path) && !petEligible(cls, path)) {
      if (active) dispose();
      return Promise.resolve(false);
    }
    if (active?.path === path) return active.promise;
    dispose();
    const state = { path, epoch, image: null, entry: null, resources: {}, ready: false, failed: false, resolve: null };
    state.promise = new Promise(resolve => { state.resolve = resolve; });
    active = state;
    loadManifest().then(manifest => {
      if (active !== state || state.epoch !== epoch) return;
      const specs = {};
      if (eligible(cls, path)) specs.attack = manifest.entries[path];
      if (petEligible(cls, path) && manifest.petSkills) {
        for (const pet of Object.values(manifest.petSkills)) specs[pet.type] = pet;
      }
      const loads = Object.entries(specs).map(([key, entry]) => new Promise(resolve => {
        const layout = entry.layout || manifest;
        const image = new Image();
        const resource = state.resources[key] = { image, cols: layout.cols, rows: layout.rows,
          cell: layout.cell, single: layout.cols === 1 && layout.rows === 1, ready: false };
        if (key === 'attack') state.image = image;
        const finish = success => {
          if (active !== state || state.epoch !== epoch || state.resources[key] !== resource) { resolve(false); return; }
          resource.ready = success && image.naturalWidth === resource.cols * resource.cell && image.naturalHeight === resource.rows * resource.cell;
          image.onload = null; image.onerror = null; resolve(resource.ready);
        };
        image.onload = () => finish(true); image.onerror = () => finish(false);
        image.src = `${entry.src}?v=${VERSION}`;
      }));
      Promise.all(loads).then(results => {
        if (active !== state || state.epoch !== epoch) return;
        state.ready = results.length > 0 && results.some(Boolean);
        state.failed = results.some(result => !result);
        settle(state, state.ready);
      });
    }).catch(() => {
      if (active !== state || state.epoch !== epoch) return;
      state.failed = true;
      settle(state, false);
    });
    return state.promise;
  }

  api.profile = (name, cls = 'sword', path = '') => {
    const profile = previousProfile(name, cls, path);
    const pet = petEligible(cls, path) ? PET_SKILLS[name] : null;
    if (!eligible(cls, path) && !pet) return profile;
    const key = pet || 'attack';
    const state = active?.path === path && active.resources[key]?.ready ? active : null;
    // Capture readiness for the whole attack, including while the image finishes loading.
    const companion=key==='wolf' && state?.resources.falcon?.ready ? state.resources.falcon : null;
    return { ...profile, elf4Attack: Object.freeze({ path, epoch, state, key, pet: !!pet, companion }) };
  };
  api.draw = (g, k, from, to, profile) => {
    const snapshot = profile?.elf4Attack;
    if (!snapshot) return previousDraw(g, k, from, to, profile);
    const state = snapshot.state;
    const resource = state?.resources[snapshot.key];
    if (!state || active !== state || snapshot.epoch !== epoch || !resource?.ready || !resource.image)
      return previousDraw(g, k, from, to, profile);
    if (!Number.isFinite(k) || k < 0 || k >= 1) return;
    const basic = !!profile.basic;
    const facing = snapshot.pet && to.x < from.x ? -1 : 1;
    let phase, t, x, y, size, rotation = 0, alpha = 1;
    if (k < .22) {
      phase = 'charge'; t = k / .22; x = from.x; y = from.y;
      size = 68 + smooth(t) * 44;
      alpha = smooth(t / .22) * (1 - smooth((t - .72) / .28));
    } else if (k < .65) {
      phase = 'flight'; t = (k - .22) / .43;
      x = from.x + (to.x - from.x) * t;
      y = from.y + (to.y - from.y) * t;
      size = 170 + Math.sin(t * Math.PI) * 18;
      rotation = snapshot.pet
        ? Math.atan2((to.y-from.y)*facing, Math.abs(to.x-from.x))
        : Math.atan2(to.y - from.y, to.x - from.x);
    } else {
      phase = 'impact'; t = (k - .65) / .35; x = to.x; y = to.y;
      size = 100 + smooth(t) * 164;
      alpha = 1 - smooth((t - .42) / .58);
    }
    const frames = PHASES[phase];
    const frame = resource.single ? 0 : frames[Math.min(frames.length - 1, Math.floor(t * frames.length))];
    size *= basic ? .8 : 1;
    if (alpha <= 0) return;
    g.save();
    g.translate(x, y);
    g.rotate(rotation);
    // Creatures face left by horizontal mirroring, so their bodies stay upright.
    if (snapshot.pet) g.scale(facing, 1);
    g.globalCompositeOperation = 'source-over';
    g.shadowBlur = 0;
    g.globalAlpha *= alpha * (basic ? .92 : 1);
    // Draw exactly one source cell. Canvas clearing is owned by battle.js, never by this wrapper.
    g.drawImage(resource.image, frame % resource.cols * resource.cell, Math.floor(frame / resource.cols) * resource.cell,
      resource.cell, resource.cell, -size / 2, -size / 2, size, size);
    // The wolf and falcon are different companions, drawn from their own current cell.
    // Each follows the same attack phase; neither reuses previous canvas contents.
    const companion=snapshot.companion;
    if(companion?.ready && companion.image){
      const companionFrame=companion.single?0:frame;
      const companionSize=size*.7;
      g.drawImage(companion.image,companionFrame%companion.cols*companion.cell,Math.floor(companionFrame/companion.cols)*companion.cell,
        companion.cell,companion.cell,-companionSize/2,-size*.62-companionSize/2,companionSize,companionSize);
    }
    g.restore();
  };
  window.RpgElf4AttackFX = {
    prepare, dispose,
    status: () => ({ path: active?.path || null, epoch, ready: !!active?.ready, failed: !!active?.failed }),
    version: VERSION
  };
  window.addEventListener('pagehide', dispose);
})();
