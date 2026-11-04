/**
 * Receipts from legacy combat already own identity, targets, damage and order.
 * This renderer consumes their explicit VFX descriptors only. Receipt replay has
 * its own presentation clock; it is never an Atlas live-event timestamp.
 */
import { createVfxPlayer, recipeFor, hash32 } from './skill-vfx-engine.mjs';

const MODES = new Set(['full', 'support', 'summon', 'impact']);
const SOURCES = new Set(['committed-combat', 'deterministic-projection']);
const finite = Number.isFinite;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const point = value => value && finite(value.x) && finite(value.y);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const activeLayers = new Set(), completedLayers = [];
let catalogPromise = null, nextLayer = 0;

export function legacyDescriptors(event) {
  if (!object(event) || event.cosmetic || event.presentationOnly) return [];
  return [event.vfx, ...(Array.isArray(event.vfxEvents) ? event.vfxEvents : [])].filter(object);
}

/** No labels, class paths, hit counts or damage summaries are used to guess IDs. */
export function validateLegacyDescriptor(raw, catalog, { allowProjection = false } = {}) {
  if (!object(raw) || raw.schemaVersion !== 1 || !SOURCES.has(raw.source)
    || (raw.source === 'deterministic-projection' && !allowProjection)) return { accepted: false, reason: 'unsupported-source' };
  if (!id(raw.eventId) || !id(raw.actorId) || !id(raw.skillId)
    || !['cast', 'effect'].includes(raw.kind) || !finite(raw.atMs) || raw.atMs < 0
    || !['enemy', 'ally', 'self'].includes(raw.targetKind) || !MODES.has(raw.presentationMode)
    || !Array.isArray(raw.targetIds) || raw.targetIds.length > 12
    || !raw.targetIds.every(id) || new Set(raw.targetIds).size !== raw.targetIds.length) {
    return { accepted: false, reason: 'invalid-descriptor' };
  }
  const skill = catalog?.skills?.find(entry => entry.id === raw.skillId);
  if (!skill || !['native', 'special'].includes(skill.system)) return { accepted: false, reason: 'unknown-skill' };
  if ((raw.kind === 'effect') !== (raw.presentationMode === 'impact')) return { accepted: false, reason: 'invalid-effect-mode' };
  if (raw.presentationMode === 'summon' && !(skill.kind === 'summon' && Number(skill.mechanics?.coefficient) === 0)) {
    return { accepted: false, reason: 'invalid-summon-mode' };
  }
  if (raw.presentationMode === 'full' && ['heal', 'shield', 'buff', 'summon'].includes(skill.kind)) {
    return { accepted: false, reason: 'invalid-offensive-mode' };
  }
  if (raw.presentationMode === 'support' && !['heal', 'shield', 'buff'].includes(skill.kind)) {
    return { accepted: false, reason: 'invalid-support-mode' };
  }
  if (raw.presentationMode !== 'summon' && raw.targetIds.length === 0) return { accepted: false, reason: 'missing-targets' };
  if (raw.targetKind === 'self' && raw.targetIds.some(target => target !== raw.actorId)) return { accepted: false, reason: 'invalid-self-target' };
  if (raw.recipientEffects !== undefined && (!Array.isArray(raw.recipientEffects) || raw.recipientEffects.length > 12
    || !raw.recipientEffects.every(effect => object(effect) && ['heal', 'shield', 'buff'].includes(effect.kind)
      && Array.isArray(effect.targetIds) && effect.targetIds.length > 0 && effect.targetIds.length <= 12
      && effect.targetIds.every(id) && new Set(effect.targetIds).size === effect.targetIds.length))) {
    return { accepted: false, reason: 'invalid-recipient-effects' };
  }
  return { accepted: true, skill };
}

/** Pure projection into supplied, real scene geometry. Missing targets fail closed. */
export function planLegacyVfx(raw, geometry, catalog, options = {}) {
  const validation = validateLegacyDescriptor(raw, catalog, options);
  if (!validation.accepted) return validation;
  if (!object(geometry) || geometry.actorId !== raw.actorId || !point(geometry.from)
    || !point(geometry.foot) || !finite(geometry.bodyHeight) || geometry.bodyHeight <= 0
    || !Array.isArray(geometry.targets)) return { accepted: false, reason: 'missing-actor-geometry' };
  const targets = new Map(geometry.targets.filter(target => id(target?.id) && point(target.point)).map(target => [target.id, target]));
  const required = [...raw.targetIds, ...(raw.recipientEffects || []).flatMap(effect => effect.targetIds)];
  if (required.some(targetId => !targets.has(targetId))) return { accepted: false, reason: 'missing-target-geometry' };
  const { skill } = validation, recipe = recipeFor(skill);
  const first = raw.targetIds.length ? targets.get(raw.targetIds[0]).point : geometry.from;
  const dx = first.x - geometry.from.x, dy = first.y - geometry.from.y;
  const direction = ['up', 'down', 'left', 'right'].includes(geometry.direction) ? geometry.direction
    : Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
  const startProgress = raw.kind === 'effect' ? 0 : .22;
  const base = { skillId: skill.id, from: { ...geometry.from }, to: { ...first },
    bodyHeight: geometry.bodyHeight, direction, startProgress,
    seed: hash32(raw.eventId), presentationMode: raw.presentationMode,
    targets: raw.targetIds.map(targetId => ({ ...targets.get(targetId).point })) };
  const commands = [];
  if (raw.presentationMode === 'support') {
    for (const targetId of raw.targetIds) {
      const target = targets.get(targetId);
      commands.push({ ...base, from: { ...target.point }, to: { ...target.point }, targets: [{ ...target.point }],
        bodyHeight: target.bodyHeight > 0 ? target.bodyHeight : geometry.bodyHeight,
        supportKind: skill.kind, recipientId: targetId });
    }
  } else commands.push(base);
  for (const effect of raw.recipientEffects || []) for (const targetId of effect.targetIds) {
    const target = targets.get(targetId);
    commands.push({ ...base, presentationMode: 'support', supportKind: effect.kind,
      from: { ...target.point }, to: { ...target.point }, targets: [{ ...target.point }],
      bodyHeight: target.bodyHeight > 0 ? target.bodyHeight : geometry.bodyHeight,
      seed: hash32(raw.eventId + ':' + effect.kind + ':' + targetId), recipientId: targetId });
  }
  if (commands.length > 12) return { accepted: false, reason: 'too-many-recipients' };
  return { accepted: true, commands, skill, recipe, source: raw.source,
    targetIds: required, actorId: raw.actorId, eventId: raw.eventId };
}

function visualRect(node) {
  if (!node || node.isConnected === false || typeof node.getBoundingClientRect !== 'function') return null;
  const rect = node.getBoundingClientRect(), width = rect.width, height = rect.height;
  if (!(width > 0 && height > 0)) return null;
  const normalized = globalThis.RpgHeroSize?.visibleRect?.(node, rect);
  if (normalized) return normalized;
  let x = rect.x ?? rect.left, y = rect.y ?? rect.top, w = width, h = height;
  const nw = Number(node.naturalWidth), nh = Number(node.naturalHeight);
  const scope = node.ownerDocument?.defaultView || globalThis, style = scope.getComputedStyle?.(node);
  if (style?.objectFit === 'contain' && nw > 0 && nh > 0) {
    const scale = Math.min(width / nw, height / nh); w = nw * scale; h = nh * scale;
    const position = String(style.objectPosition || '50% 100%').split(/\s+/);
    const fraction = (value, fallback) => value === 'left' || value === 'top' ? 0
      : value === 'right' || value === 'bottom' ? 1 : value === 'center' ? .5
      : /^-?[\d.]+%$/.test(value) ? Number.parseFloat(value) / 100 : fallback;
    x += (width - w) * fraction(position[0], .5); y += (height - h) * fraction(position[1], 1);
  }
  return { x, y, width: w, height: h, bottom: y + h };
}

export function legacyDomGeometry(scene, actor, targetNodes, { actorId, from, foot, bodyHeight, direction } = {}) {
  const sceneRect = scene?.getBoundingClientRect?.(), a = visualRect(actor);
  if (!sceneRect || !a) return null;
  const sx = sceneRect.x ?? sceneRect.left, sy = sceneRect.y ?? sceneRect.top;
  const scaleX = sceneRect.width > 0 ? (scene.clientWidth || sceneRect.width) / sceneRect.width : 1;
  const scaleY = sceneRect.height > 0 ? (scene.clientHeight || sceneRect.height) / sceneRect.height : 1;
  const at = (r, fx, fy) => ({ x: (r.x + r.width * fx - sx) * scaleX, y: (r.y + r.height * fy - sy) * scaleY });
  const targets = [];
  for (const target of targetNodes || []) {
    const rect = visualRect(target.node);
    if (rect && id(target.id)) targets.push({ id: target.id, point: at(rect, .5, .45), bodyHeight: rect.height * scaleY });
  }
  return { actorId, from: point(from) ? { ...from } : at(a, .62, .43),
    foot: point(foot) ? { ...foot } : at(a, .5, 1), bodyHeight: finite(bodyHeight) && bodyHeight > 0 ? bodyHeight : a.height * scaleY,
    direction, targets };
}

async function getCatalog(fetcher = globalThis.fetch?.bind(globalThis)) {
  if (!catalogPromise) catalogPromise = Promise.resolve().then(async () => {
    if (typeof fetcher !== 'function') throw new Error('VFX catalogue loader unavailable');
    const response = await fetcher(new URL('./skill-vfx-catalog.json', import.meta.url).href);
    if (!response.ok) throw new Error('VFX catalogue unavailable');
    const result = await response.json();
    if (result?.schemaVersion !== 1 || !Array.isArray(result.skills)) throw new Error('Invalid VFX catalogue');
    return result;
  }).catch(error => { catalogPromise = null; throw error; });
  return catalogPromise;
}

export async function createLegacyVfxLayer(scene, { catalog: providedCatalog, contextKey, mode, allowProjection = false,
  isCurrent = () => true, fetch: fetcher, playerFactory = createVfxPlayer } = {}) {
  if (!scene || !id(contextKey) || !['idle', 'party', 'star-ring', 'pk', 'boss'].includes(mode)) return null;
  const catalog = providedCatalog || await getCatalog(fetcher);
  if (scene.isConnected === false || !isCurrent()) return null;
  const doc = scene.ownerDocument || globalThis.document, scope = doc?.defaultView || globalThis;
  const canvas = doc.createElement('canvas');
  canvas.className = 'legacy-skill-vfx';
  canvas.setAttribute?.('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10';
  const priorPosition = scene.style?.position;
  const changedPosition = scope.getComputedStyle?.(scene)?.position === 'static';
  if (changedPosition) scene.style.position = 'relative';
  scene.append(canvas);
  let destroyed = false, generation = 0, size = '', layer;
  const seen = new Map();
  const counts = { layerId: ++nextLayer, mode, contextKey, received: 0, accepted: 0, rejected: 0,
    commands: 0, drawFrames: 0, drawCalls: 0, byReason: {}, lastEvent: null, lastRender: null };
  function publish() { if (scene.dataset) scene.dataset.legacyVfx = JSON.stringify({ mode, accepted: counts.accepted,
    rejected: counts.rejected, commands: counts.commands, drawFrames: counts.drawFrames,
    lastSkillId: counts.lastEvent?.skillId || null, lastSource: counts.lastEvent?.source || null }); }
  function reject(reason) { counts.rejected++; counts.byReason[reason] = (counts.byReason[reason] || 0) + 1; publish(); return { accepted: false, reason }; }
  const current = () => !destroyed && scene.isConnected !== false && !doc.hidden && isCurrent();
  const player = playerFactory(canvas, { catalog, maxActive: 12, onRender(result) {
    counts.lastRender = { ...result };
    if (result.drawCalls > 0) { counts.drawFrames++; counts.drawCalls += result.drawCalls; }
    publish();
  }, onError() { counts.byReason['asset-error'] = (counts.byReason['asset-error'] || 0) + 1; } });
  const resize = () => {
    if (destroyed) return;
    const w = scene.clientWidth || scene.getBoundingClientRect?.().width || 1;
    const h = scene.clientHeight || scene.getBoundingClientRect?.().height || 1;
    const next = w + ':' + h;
    if (next === size) return;
    if (size) layer?.clear('layout-changed');
    size = next; player.resize(w, h, scope.devicePixelRatio || 1);
  };
  const resizeObserver = typeof scope.ResizeObserver === 'function' ? new scope.ResizeObserver(resize) : null;
  const visibility = () => { if (doc.hidden) layer?.clear('hidden'); };
  const pagehide = () => layer?.destroy();
  const stats = () => ({ ...counts, byReason: { ...counts.byReason }, destroyed, generation,
    remembered: seen.size, pending: [...seen.values()].filter(value => value === 'pending').length, player: player.stats() });
  layer = {
    async prepare(descriptors = []) {
      const keys = new Set();
      for (const raw of descriptors) {
        const result = validateLegacyDescriptor(raw, catalog, { allowProjection });
        if (!result.accepted) continue;
        keys.add(result.skill.baseClass);
        for (const extra of recipeFor(result.skill).art.additional) keys.add(extra.replace(/\.webp$/, ''));
      }
      const results = await Promise.allSettled([...keys].map(key => player.prepare(key)));
      return results.every(result => result.status === 'fulfilled');
    },
    timing(raw) {
      const valid = validateLegacyDescriptor(raw, catalog, { allowProjection });
      if (!valid.accepted) return null;
      const reduced = !!scope.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const recipe = recipeFor(valid.skill), durationMs = reduced ? 420 : raw.kind === 'effect' ? 650 : recipe.durationMs;
      const startProgress = raw.kind === 'effect' ? 0 : .22;
      return { durationMs, remainingMs: durationMs * (1 - startProgress),
        impactDelayMs: reduced || raw.kind === 'effect' || raw.presentationMode !== 'full' ? 0 : Math.max(0, recipe.impactAt - startProgress) * durationMs };
    },
    async play(raw, geometry, { canStart = () => true } = {}) {
      counts.received++;
      if (!current() || !canStart()) return reject('inactive-context');
      const plan = planLegacyVfx(raw, geometry, catalog, { allowProjection });
      if (!plan.accepted) return reject(plan.reason);
      if (seen.has(raw.eventId)) return reject('duplicate-event');
      if (seen.size >= 512) return reject('receipt-window-full');
      const version = generation; seen.set(raw.eventId, 'pending');
      const admitted = () => current() && version === generation && canStart();
      const results = await Promise.all(plan.commands.map(command => player.play({ ...command, canStart: admitted })));
      if (!admitted()) { if (seen.get(raw.eventId) === 'pending') seen.delete(raw.eventId); return reject('superseded'); }
      const accepted = results.filter(result => result?.accepted);
      if (!accepted.length) { seen.delete(raw.eventId); return reject(results[0]?.reason || 'player-rejected'); }
      seen.set(raw.eventId, 'accepted'); counts.accepted++; counts.commands += accepted.length;
      counts.lastEvent = { eventId: raw.eventId, skillId: raw.skillId, actorId: raw.actorId,
        source: raw.source, presentationMode: raw.presentationMode, targetIds: plan.targetIds.slice(),
        damageModel: raw.damageModel || null, from: { ...geometry.from }, commands: plan.commands.map(command => ({
          from: command.from, to: command.to, targets: command.targets, mode: command.presentationMode,
          bodyHeight: command.bodyHeight, supportKind: command.supportKind || null })) };
      publish();
      return { accepted: true, eventId: raw.eventId, commands: accepted.length, ...layer.timing(raw) };
    },
    clear(reason = 'clear') {
      if (destroyed) return;
      generation++; player.clear();
      for (const [key, value] of seen) if (value === 'pending') seen.delete(key);
      counts.lastClear = reason; publish();
    },
    destroy() {
      if (destroyed) return;
      layer.clear('destroy'); destroyed = true; player.destroy(); resizeObserver?.disconnect();
      doc.removeEventListener?.('visibilitychange', visibility); scope.removeEventListener?.('pagehide', pagehide);
      canvas.remove(); if (changedPosition && scene.style.position === 'relative') scene.style.position = priorPosition || '';
      activeLayers.delete(layer); completedLayers.push(stats()); if (completedLayers.length > 24) completedLayers.shift();
    },
    stats
  };
  resize(); resizeObserver?.observe(scene);
  doc.addEventListener?.('visibilitychange', visibility); scope.addEventListener?.('pagehide', pagehide);
  activeLayers.add(layer); publish(); return Object.freeze(layer);
}

export function inspectLegacyVfx() {
  for (const layer of [...activeLayers]) if (layer.stats().destroyed) activeLayers.delete(layer);
  return { active: [...activeLayers].map(layer => layer.stats()), completed: completedLayers.map(entry => ({ ...entry })) };
}
if (typeof window !== 'undefined') window.RpgLegacySkillVFX = Object.freeze({ inspect: inspectLegacyVfx });
