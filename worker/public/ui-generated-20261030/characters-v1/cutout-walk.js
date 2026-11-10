(function (global) {
  'use strict';
  const TAU = Math.PI * 2, EPS = 1e-4;
  const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const cycle = v => ((finite(v) % 1) + 1) % 1;
  const point = p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite);
  const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const polygons = p => !Array.isArray(p) ? [] : point(p[0]) ? [p] : p;
  const usable = p => Array.isArray(p) && p.length >= 3 && p.every(point);
  function path(ctx, poly) {
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
  }
  function bob(rig, phase) {
    const amount = clamp(finite(rig.bob, 1.5), 0, 5);
    return -amount * (1 - Math.cos(cycle(phase) * TAU * 2)) / 2;
  }
  // sampleLeg(leg, rig, phase, offset): all joints and targets are local source pixels.
  function sampleLeg(leg, rig, phase, offset = 0) {
    rig = rig || {};
    if (!leg || ![leg.hip, leg.knee, leg.ankle].every(point)) return null;
    const upper = distance(leg.hip, leg.knee), lower = distance(leg.knee, leg.ankle);
    if (upper < EPS || lower < EPS) return null;
    const p = cycle(cycle(phase) + finite(offset)), stance = clamp(finite(rig.stanceFraction, .6), .1, .9);
    const stride = clamp(finite(rig.stride, 50), 0, upper + lower);
    const lift = clamp(finite(rig.lift, 15), 0, (upper + lower) * .5);
    const swing = p >= stance, t = swing ? (p - stance) / (1 - stance) : p / stance;
    const progress = swing ? t * t * (3 - 2 * t) : t;
    const ground = finite(rig.groundY, leg.ankle[1]), ankleOffset = ground - leg.ankle[1];
    const target = [leg.hip[0] + stride * (swing ? progress - .5 : .5 - progress),
      ground - ankleOffset - (swing ? lift * Math.sin(Math.PI * t) : 0)];
    const hip = [leg.hip[0], leg.hip[1] + bob(rig, phase)];
    let dx = target[0] - hip[0], dy = target[1] - hip[1], raw = Math.hypot(dx, dy);
    if (raw < EPS) { dx = leg.ankle[0] - leg.hip[0]; dy = leg.ankle[1] - leg.hip[1]; }
    let norm = Math.hypot(dx, dy); if (norm < EPS) { dx = 0; dy = 1; norm = 1; }
    const ux = dx / norm, uy = dy / norm;
    const reach = clamp(raw, Math.abs(upper - lower) + EPS, upper + lower - EPS);
    const along = (upper * upper + reach * reach - lower * lower) / (2 * reach);
    const height = Math.sqrt(Math.max(0, upper * upper - along * along));
    const cross = (leg.ankle[0] - leg.hip[0]) * (leg.knee[1] - leg.hip[1])
      - (leg.ankle[1] - leg.hip[1]) * (leg.knee[0] - leg.hip[0]);
    const sign = Math.sign(finite(leg.kneeBendSign, finite(rig.kneeBendSign, Math.sign(cross) || -1))) || -1;
    return { hip, knee: [hip[0] + ux * along - uy * height * sign, hip[1] + uy * along + ux * height * sign],
      ankle: [hip[0] + ux * reach, hip[1] + uy * reach], target, swing, phase: p, clamped: Math.abs(raw - reach) > EPS };
  }
  function render(ctx, image, rig, phase = 0) {
    const rect = rig && rig.rect, iw = image && (image.naturalWidth || image.videoWidth || image.width);
    const ih = image && (image.naturalHeight || image.videoHeight || image.height);
    if (!ctx || !image || !rect || rect.length !== 4 || !rect.every(Number.isFinite)
      || rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0 || !iw || !ih
      || rect[0] + rect[2] > iw || rect[1] + rect[3] > ih) return { valid: false, reason: 'invalid image or source rect' };
    const near = sampleLeg(rig.near, rig, phase), far = sampleLeg(rig.far, rig, phase, .5);
    if (!near || !far) return { valid: false, reason: 'invalid leg joints' };
    if ([rig.near, rig.far].some(s => ['upper', 'lower', 'foot'].some(k => !polygons(s[k]).some(usable))))
      return { valid: false, reason: 'missing limb polygons' };
    const draw = () => ctx.drawImage(image, ...rect, 0, 0, rect[2], rect[3]);
    function limb(polys, source, target, angle) {
      const valid = polygons(polys).filter(usable); if (!valid.length) return;
      ctx.save(); ctx.translate(target[0], target[1]); ctx.rotate(angle); ctx.translate(-source[0], -source[1]);
      ctx.beginPath(); valid.forEach(p => path(ctx, p)); ctx.clip(); draw(); ctx.restore();
    }
    const angle = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
    function leg(source, pose) {
      limb(source.upper, source.hip, pose.hip, angle(pose.hip, pose.knee) - angle(source.hip, source.knee));
      limb(source.lower, source.knee, pose.knee, angle(pose.knee, pose.ankle) - angle(source.knee, source.ankle));
      limb(source.foot, source.ankle, pose.ankle, 0);
    }
    ctx.save(); leg(rig.far, far); leg(rig.near, near);
    ctx.save(); ctx.translate(0, bob(rig, phase)); ctx.beginPath();
    const body = polygons(rig.bodyPolygon).filter(usable);
    if (body.length) body.forEach(p => path(ctx, p)); else ctx.rect(0, 0, rect[2], rect[3]);
    ctx.clip();
    // Intersect separate complements: overlapping joint masks must not restore old pixels.
    for (const source of [rig.far, rig.near]) for (const part of ['upper', 'lower', 'foot'])
      for (const poly of polygons(source[part]).filter(usable)) {
        ctx.beginPath(); ctx.rect(0, 0, rect[2], rect[3]); path(ctx, poly); ctx.clip('evenodd');
      }
    draw(); ctx.restore();
    if (rig.debug) {
      ctx.lineWidth = 1; ctx.strokeStyle = '#00e5ff';
      for (const pose of [far, near]) { ctx.beginPath(); ctx.moveTo(...pose.hip); ctx.lineTo(...pose.knee); ctx.lineTo(...pose.ankle); ctx.stroke(); }
    }
    ctx.restore(); return { valid: true, phase: cycle(phase), bob: bob(rig, phase), near, far };
  }
  // Compile selected poses into canvases; this full-image mesh is not a per-game-frame renderer.
  function renderMesh(ctx, image, rig, phase = 0) {
    const rect = rig && rig.rect, iw = image && (image.naturalWidth || image.videoWidth || image.width);
    const ih = image && (image.naturalHeight || image.videoHeight || image.height);
    if (!ctx || !image || !rect || rect.length !== 4 || !rect.every(Number.isFinite)
      || rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0 || !iw || !ih
      || rect[0] + rect[2] > iw || rect[1] + rect[3] > ih) return { valid: false, reason: 'invalid image or source rect' };
    const near = sampleLeg(rig.near, rig, phase), far = sampleLeg(rig.far, rig, phase, .5);
    if (!near || !far) return { valid: false, reason: 'invalid leg joints' };
    const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const angle = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
    const averageHip = (rig.near.hip[1] + rig.far.hip[1]) / 2;
    const start = finite(rig.skinStartY, averageHip - 20), full = Math.max(start + EPS, finite(rig.skinFullY, averageHip + 30));
    const bobY = bob(rig, phase), step = clamp(finite(rig.meshStep, 12), 4, 64);
    const columns = Math.min(256, Math.ceil(rect[2] / step)), rows = Math.min(256, Math.ceil(rect[3] / step));
    function segmentDistance(p, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / Math.max(EPS, dx * dx + dy * dy), 0, 1);
      return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
    }
    function bone(a, b, targetA, targetB) {
      const turn = targetB ? angle(targetA, targetB) - angle(a, b) : 0, c = Math.cos(turn), s = Math.sin(turn);
      return p => [targetA[0] + c * (p[0] - a[0]) - s * (p[1] - a[1]), targetA[1] + s * (p[0] - a[0]) + c * (p[1] - a[1])];
    }
    function skin(source, pose) {
      const upper = bone(source.hip, source.knee, pose.hip, pose.knee);
      const lower = bone(source.knee, source.ankle, pose.knee, pose.ankle), foot = bone(source.ankle, null, pose.ankle, null);
      const axis = [source.ankle[0] - source.hip[0], source.ankle[1] - source.hip[1]], length = Math.hypot(...axis) || 1;
      const signed = (p, joint) => ((p[0] - joint[0]) * axis[0] + (p[1] - joint[1]) * axis[1]) / length;
      return { distance: p => Math.min(segmentDistance(p, source.hip, source.knee), segmentDistance(p, source.knee, source.ankle)),
        deform: p => mix(mix(upper(p), lower(p), smooth((signed(p, source.knee) + 18) / 36)), foot(p), smooth((signed(p, source.ankle) + 10) / 18)) };
    }
    const nearSkin = skin(rig.near, near), farSkin = skin(rig.far, far), vertices = [];
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
      const p = [x * rect[2] / columns, y * rect[3] / rows], weight = smooth((p[1] - start) / (full - start));
      const isNear = nearSkin.distance(p) <= farSkin.distance(p);
      const q = mix([p[0], p[1] + bobY], (isNear ? nearSkin : farSkin).deform(p), weight);
      vertices.push({ p, q, depth: weight * (isNear ? 1 : 0) });
      bounds[0] = Math.min(bounds[0], q[0]); bounds[1] = Math.min(bounds[1], q[1]);
      bounds[2] = Math.max(bounds[2], q[0]); bounds[3] = Math.max(bounds[3], q[1]);
    }
    const triangles = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const a = y * (columns + 1) + x, b = a + 1, c = a + columns + 1, d = c + 1;
      triangles.push([vertices[a], vertices[b], vertices[d]], [vertices[a], vertices[d], vertices[c]]);
    }
    triangles.sort((a, b) => a.reduce((n, v) => n + v.depth, 0) - b.reduce((n, v) => n + v.depth, 0));
    const ct = ctx.getTransform ? ctx.getTransform() : { a: 1, b: 0, c: 0, d: 1 };
    const bleed = Math.min(2, .5 / Math.max(EPS, Math.hypot(ct.a, ct.b), Math.hypot(ct.c, ct.d)));
    let foldedTriangles = 0, degenerateTriangles = 0;
    for (const triangle of triangles) {
      const [p0, p1, p2] = triangle.map(v => v.p), [q0, q1, q2] = triangle.map(v => v.q);
      const sx = p1[0] - p0[0], sy = p1[1] - p0[1], tx = p2[0] - p0[0], ty = p2[1] - p0[1], det = sx * ty - sy * tx;
      const ux = q1[0] - q0[0], uy = q1[1] - q0[1], vx = q2[0] - q0[0], vy = q2[1] - q0[1], area = ux * vy - uy * vx;
      if (area < 0) foldedTriangles++; if (Math.abs(area) < EPS) { degenerateTriangles++; continue; }
      const a = (ux * ty - vx * sy) / det, b = (uy * ty - vy * sy) / det;
      const c = (vx * sx - ux * tx) / det, d = (vy * sx - uy * tx) / det;
      const center = [(q0[0] + q1[0] + q2[0]) / 3, (q0[1] + q1[1] + q2[1]) / 3];
      const expanded = [q0, q1, q2].map(q => { const length = distance(center, q) || 1;
        return [q[0] + (q[0] - center[0]) * bleed / length, q[1] + (q[1] - center[1]) * bleed / length]; });
      ctx.save(); ctx.beginPath(); path(ctx, expanded); ctx.clip();
      ctx.transform(a, b, c, d, q0[0] - a * p0[0] - c * p0[1], q0[1] - b * p0[0] - d * p0[1]);
      ctx.drawImage(image, ...rect, 0, 0, rect[2], rect[3]); ctx.restore();
    }
    return { valid: true, mode: 'mesh', phase: cycle(phase), bob: bobY, near, far, bounds,
      vertices: vertices.length, triangles: triangles.length, foldedTriangles, degenerateTriangles };
  }
  global.CutoutWalk = Object.freeze({ render, renderMesh, sampleLeg });
})(window);
