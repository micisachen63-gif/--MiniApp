// 小精靈 RPG — procedural chibi art (Canvas 2D). All art here is code-drawn placeholder art (no image files).
(function () {
  const TAU = Math.PI * 2;
  const PAL = {
    sword: { '': ['#8ea4c4', '#c0392b', '#d9dde6'], A: ['#7b2d2d', '#e0533b', '#c9b18a'], B: ['#3c63b0', '#f2c14e', '#e7ecf5'] },
    archer: { '': ['#4f9a52', '#7a5230', '#e8d7a8'], A: ['#2f8f8a', '#2d5a3d', '#c8f0e6'], B: ['#8a5a2b', '#3e6b2f', '#f0dcb0'] },
    mage: { '': ['#7a4fc4', '#3a2a6b', '#f1c40f'], A: ['#c2462e', '#f39c12', '#ffe08a'], B: ['#2c3e8f', '#8e7cf0', '#bfe3ff'] },
  };
  const HAIR = { m: ['#3b2a1e', '#6b4226', '#20262e'], f: ['#e7b46a', '#8a3b2e', '#f3d9b1'] };
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function shade(hex, k) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255; r = Math.max(0, Math.min(255, r + k)); g = Math.max(0, Math.min(255, g + k)); b = Math.max(0, Math.min(255, b + k)); return `rgb(${r},${g},${b})`; }

  /** hero: o = { cls, gender, path, t (seconds), action: idle|attack|hurt|rest|dead|cast, flip } ; s = scale (1 ≈ 64px tall) */
  function hero(ctx, x, y, s, o) {
    const cls = o.cls || 'sword'; const br = String(o.path || '')[0] || ''; const [main, accent, light] = (PAL[cls][br] || PAL[cls]['']);
    const t = o.t || 0; const act = o.action || 'idle';
    const bob = act === 'rest' ? 0 : Math.sin(t * 4) * 1.5; const lunge = act === 'attack' ? Math.sin(Math.min(1, (o.p ?? 0)) * Math.PI) * 10 : 0;
    const hurt = act === 'hurt' ? Math.sin(t * 60) * 2 : 0;
    ctx.save(); ctx.translate(x + lunge + hurt, y); ctx.scale(s * (o.flip ? -1 : 1), s);
    if (act === 'dead') { ctx.globalAlpha = 0.85; tomb(ctx); ctx.restore(); return; }
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 18, 5, 0, 0, TAU); ctx.fill();
    ctx.translate(0, act === 'rest' ? 8 : bob);
    // cape / robe back
    if (cls === 'sword' || cls === 'mage') { ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(-10, -34); ctx.quadraticCurveTo(-18, -12, -14, -2); ctx.lineTo(10, -2); ctx.quadraticCurveTo(14, -16, 10, -34); ctx.fill(); }
    // legs
    ctx.fillStyle = shade(main, -40); rr(ctx, -9, -12, 7, 12, 3); ctx.fill(); rr(ctx, 2, -12, 7, 12, 3); ctx.fill();
    ctx.fillStyle = '#3a2a20'; rr(ctx, -10, -4, 9, 5, 2); ctx.fill(); rr(ctx, 1, -4, 9, 5, 2); ctx.fill();
    // body
    ctx.fillStyle = main; if (cls === 'mage') { ctx.beginPath(); ctx.moveTo(-12, -36); ctx.lineTo(12, -36); ctx.lineTo(16, -8); ctx.lineTo(-16, -8); ctx.closePath(); ctx.fill(); }
    else { rr(ctx, -12, -36, 24, 26, 7); ctx.fill(); }
    ctx.fillStyle = shade(main, 30); rr(ctx, -9, -33, 18, 6, 3); ctx.fill();
    ctx.fillStyle = accent; ctx.fillRect(-12, -16, 24, 4);  // belt
    ctx.fillStyle = light; ctx.fillRect(-2, -16, 4, 4);
    // arms
    ctx.fillStyle = shade(main, -15); rr(ctx, -17, -33, 7, 16, 3); ctx.fill(); rr(ctx, 10, -33, 7, 16, 3); ctx.fill();
    ctx.fillStyle = '#f5cfa8'; ctx.beginPath(); ctx.arc(-13.5, -16, 3.5, 0, TAU); ctx.arc(13.5, -16, 3.5, 0, TAU); ctx.fill();
    // weapon
    weapon(ctx, cls, br, act, o.p ?? 0, accent, light);
    // head
    const g = o.gender === 'f' ? 'f' : 'm'; const hair = HAIR[g][(cls.length + br.length) % 3];
    ctx.fillStyle = '#f5cfa8'; ctx.beginPath(); ctx.arc(0, -50, 15, 0, TAU); ctx.fill();
    ctx.fillStyle = hair;
    if (g === 'f') { ctx.beginPath(); ctx.arc(0, -53, 16, Math.PI, TAU); ctx.fill(); rr(ctx, -16, -55, 7, 26, 4); ctx.fill(); rr(ctx, 9, -55, 7, 26, 4); ctx.fill(); ctx.beginPath(); ctx.arc(12, -64, 5, 0, TAU); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(-16, -50); for (let i = 0; i <= 6; i++) ctx.lineTo(-16 + i * 5.3, -60 - (i % 2 ? 8 : 2)); ctx.lineTo(16, -50); ctx.quadraticCurveTo(0, -58, -16, -50); ctx.fill(); }
    // face
    const blink = (Math.floor(t * 10) % 37) === 0;
    ctx.fillStyle = '#2b1d14';
    if (act === 'rest' || blink) { ctx.fillRect(-7, -49, 5, 1.6); ctx.fillRect(2, -49, 5, 1.6); }
    else { ctx.beginPath(); ctx.ellipse(-5, -49, 2.2, 3, 0, 0, TAU); ctx.ellipse(5, -49, 2.2, 3, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillRect(-5.5, -51, 1.2, 1.2); ctx.fillRect(4.5, -51, 1.2, 1.2); }
    if (g === 'f') { ctx.fillStyle = 'rgba(255,120,140,.45)'; ctx.beginPath(); ctx.arc(-9, -44, 2.5, 0, TAU); ctx.arc(9, -44, 2.5, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = '#7a3b2a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, -44, 2.4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    // headgear
    if (cls === 'mage') { ctx.fillStyle = main; ctx.beginPath(); ctx.moveTo(-18, -60); ctx.lineTo(18, -60); ctx.lineTo(4, -86); ctx.quadraticCurveTo(12, -90, 14, -84); ctx.lineTo(2, -60); ctx.fill(); ctx.fillStyle = accent; ctx.fillRect(-18, -62, 36, 4); ctx.fillStyle = light; ctx.beginPath(); ctx.arc(0, -70, 2.5, 0, TAU); ctx.fill(); }
    if (cls === 'sword') { ctx.fillStyle = light; rr(ctx, -15, -66, 30, 8, 4); ctx.fill(); if (br === 'B') { ctx.fillStyle = accent; ctx.fillRect(-2, -72, 4, 8); } if (br === 'A') { ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(-14, -64); ctx.lineTo(-20, -74); ctx.lineTo(-10, -66); ctx.moveTo(14, -64); ctx.lineTo(20, -74); ctx.lineTo(10, -66); ctx.fill(); } }
    if (cls === 'archer') { ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(-16, -58); ctx.quadraticCurveTo(0, -72, 16, -58); ctx.lineTo(18, -55); ctx.lineTo(-18, -55); ctx.fill(); ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, -64); ctx.quadraticCurveTo(20, -74, 26, -70); ctx.stroke(); }
    if (br === 'B' && cls === 'archer') falcon(ctx, -22, -70, t);
    if (act === 'rest') { ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('z', 16, -66 - (t * 8) % 10); ctx.fillText('Z', 22, -78 - (t * 6) % 10); }
    ctx.restore();
  }
  function weapon(ctx, cls, br, act, p, accent, light) {
    ctx.save(); ctx.translate(14, -18);
    const phase = Math.max(0, Math.min(1, p));
    // Readable attack silhouettes: wind-up, impact, and recovery are all visible in the 350 ms window.
    const swing = act === 'attack' ? (phase < 0.32 ? -2.25 + phase * 1.2 : phase < 0.62 ? -1.85 + (phase - 0.32) * 12 : 1.75 - (phase - 0.62) * 5.6) : -0.5;
    if (cls === 'sword') {
      ctx.rotate(swing); const big = br === 'A';
      ctx.fillStyle = '#5b3a1e'; ctx.fillRect(-2, -2, 4, 10); ctx.fillStyle = accent; ctx.fillRect(-7, -4, 14, 4);
      ctx.fillStyle = '#e8eef7'; ctx.beginPath(); ctx.moveTo(-(big ? 5 : 3), -4); ctx.lineTo(big ? 5 : 3, -4); ctx.lineTo(0, -(big ? 40 : 30)); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(-0.6, -28, 1.2, 22);
      ctx.restore();
      if (br === 'B') { ctx.save(); ctx.translate(-16, -22); ctx.fillStyle = '#3c63b0'; ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(8, -10); ctx.lineTo(8, 4); ctx.quadraticCurveTo(0, 14, -8, 4); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = '#f2c14e'; ctx.fillRect(-1, -7, 2, 12); ctx.fillRect(-5, -2, 10, 2); ctx.restore(); }
      return;
    }
    if (cls === 'archer') {
      const draw = act === 'attack' ? (phase < 0.36 ? phase / 0.36 : phase < 0.58 ? 1 : Math.max(0, 1 - (phase - 0.58) / 0.42)) : 0;
      ctx.rotate(act === 'attack' ? -0.4 - draw * 0.18 : -0.4); ctx.strokeStyle = '#7a4a22'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -8, 16, -1.2, 1.2); ctx.stroke();
      ctx.strokeStyle = '#eee'; ctx.lineWidth = 1; const pull = draw * 11; ctx.beginPath(); ctx.moveTo(Math.cos(-1.2) * 16, -8 + Math.sin(-1.2) * 16); ctx.lineTo(-pull, -8); ctx.lineTo(Math.cos(1.2) * 16, -8 + Math.sin(1.2) * 16); ctx.stroke();
      if (act !== 'attack' || phase < 0.56) { ctx.strokeStyle = '#c9a36a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-pull, -8); ctx.lineTo(22, -8); ctx.stroke(); ctx.fillStyle = '#ccc'; ctx.beginPath(); ctx.moveTo(26, -8); ctx.lineTo(21, -11); ctx.lineTo(21, -5); ctx.fill(); }
      else { ctx.save(); ctx.globalAlpha = Math.max(0, 1 - (phase - 0.56) * 2); ctx.strokeStyle = '#ffe7a3'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(20, -8); ctx.lineTo(44, -8); ctx.stroke(); ctx.restore(); }
      ctx.restore(); return;
    }
    ctx.rotate(act === 'cast' ? -1.15 : act === 'attack' ? -0.25 - Math.sin(phase * Math.PI) * 0.75 : -0.25);
    ctx.fillStyle = '#6b4226'; ctx.fillRect(-2, -34, 4, 44);
    const glow = (act === 'cast' ? 11 : act === 'attack' ? 4 : 2) + Math.sin((p || 0) * Math.PI) * 7; const orb = br === 'A' ? '#ff8a3d' : br === 'B' ? '#9fd4ff' : light;
    ctx.shadowColor = orb; ctx.shadowBlur = glow * 2; ctx.fillStyle = orb; ctx.beginPath(); ctx.arc(0, -38, 6, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    ctx.restore();
  }
  function falcon(ctx, x, y, t) { ctx.save(); ctx.translate(x, y + Math.sin(t * 3) * 3); ctx.fillStyle = '#7a5230'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 4, 0, 0, TAU); ctx.fill(); const w = Math.sin(t * 14) * 5; ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(-10, -4 - w); ctx.lineTo(-4, 2); ctx.moveTo(2, 0); ctx.lineTo(10, -4 - w); ctx.lineTo(4, 2); ctx.fill(); ctx.fillStyle = '#f1c40f'; ctx.fillRect(5, -1, 3, 2); ctx.restore(); }
  function tomb(ctx) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 18, 5, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#9aa3ad'; rr(ctx, -12, -34, 24, 34, 10); ctx.fill(); ctx.fillStyle = '#6d757e'; ctx.fillRect(-1.5, -28, 3, 16); ctx.fillRect(-6, -24, 12, 3); }

  const MON = {
    '史萊姆': (ctx, t, c) => { const sq = 1 + Math.sin(t * 6) * 0.08; ctx.scale(1 / sq, sq); ctx.fillStyle = c || '#5ccf6b'; ctx.beginPath(); ctx.moveTo(-18, 0); ctx.quadraticCurveTo(-20, -26, 0, -28); ctx.quadraticCurveTo(20, -26, 18, 0); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.ellipse(-7, -19, 4, 6, -0.4, 0, TAU); ctx.fill(); eyes(ctx, -6, 6, -14); },
    '野狼': (ctx, t) => { ctx.fillStyle = '#7d8790'; rr(ctx, -22, -24, 34, 16, 8); ctx.fill(); ctx.beginPath(); ctx.moveTo(-24, -26); ctx.lineTo(-36, -22); ctx.lineTo(-24, -14); ctx.fill(); ctx.beginPath(); ctx.moveTo(-20, -24); ctx.lineTo(-17, -34); ctx.lineTo(-13, -24); ctx.fill(); ctx.fillStyle = '#5d666e'; const k = Math.sin(t * 8) * 3; [-18, -8, 2, 8].forEach((lx, i) => ctx.fillRect(lx, -10, 4, 10 + (i % 2 ? k : -k) * 0.3)); ctx.beginPath(); ctx.moveTo(12, -20); ctx.quadraticCurveTo(24, -30 + k, 22, -14); ctx.fill(); ctx.fillStyle = '#ffdf5d'; ctx.fillRect(-26, -24, 3, 3); },
    '哥布林': (ctx, t) => { ctx.fillStyle = '#6aa84f'; ctx.beginPath(); ctx.arc(0, -30, 11, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(-10, -32); ctx.lineTo(-20, -38); ctx.lineTo(-9, -27); ctx.moveTo(10, -32); ctx.lineTo(20, -38); ctx.lineTo(9, -27); ctx.fill(); ctx.fillStyle = '#7a5230'; rr(ctx, -9, -20, 18, 16, 5); ctx.fill(); ctx.fillStyle = '#6aa84f'; ctx.fillRect(-8, -5, 5, 5); ctx.fillRect(3, -5, 5, 5); eyes(ctx, -4, 4, -31, '#ffef5d'); ctx.save(); ctx.translate(-12, -14); ctx.rotate(-0.6 + Math.sin(t * 5) * 0.3); ctx.fillStyle = '#ccc'; ctx.fillRect(-1, -14, 3, 14); ctx.restore(); },
    '骷髏兵': (ctx, t) => { ctx.fillStyle = '#ecebe4'; ctx.beginPath(); ctx.arc(0, -36, 10, 0, TAU); ctx.fill(); ctx.fillStyle = '#222'; ctx.fillRect(-6, -38, 4, 4); ctx.fillRect(2, -38, 4, 4); ctx.fillStyle = '#ecebe4'; for (let i = 0; i < 4; i++) ctx.fillRect(-8, -24 + i * 4, 16, 2); ctx.fillRect(-1, -26, 2, 18); ctx.fillRect(-6, -8, 3, 8); ctx.fillRect(3, -8, 3, 8); ctx.save(); ctx.translate(10, -18); ctx.rotate(-0.4 + Math.sin(t * 4) * 0.2); ctx.fillStyle = '#9aa'; ctx.fillRect(-1, -22, 3, 22); ctx.restore(); },
    '毒蜘蛛': (ctx, t) => { ctx.strokeStyle = '#3b1f4a'; ctx.lineWidth = 3; for (let i = 0; i < 4; i++) { const a = Math.sin(t * 10 + i) * 3; ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-22, -20 + i * 6 + a); ctx.lineTo(-26, -4 + i * 2); ctx.moveTo(6, -12); ctx.lineTo(22, -20 + i * 6 - a); ctx.lineTo(26, -4 + i * 2); ctx.stroke(); } ctx.fillStyle = '#5b2a73'; ctx.beginPath(); ctx.ellipse(0, -14, 14, 11, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#a6e22e'; ctx.beginPath(); ctx.arc(0, -16, 4, 0, TAU); ctx.fill(); eyes(ctx, -5, 5, -8, '#ff4d4d'); },
    '樹妖': (ctx, t) => { ctx.fillStyle = '#6b4a2b'; rr(ctx, -10, -40, 20, 40, 6); ctx.fill(); ctx.fillStyle = '#3f7a3a'; const w = Math.sin(t * 2) * 2; ctx.beginPath(); ctx.arc(-10 + w, -44, 12, 0, TAU); ctx.arc(10 - w, -46, 13, 0, TAU); ctx.arc(0, -56, 13, 0, TAU); ctx.fill(); eyes(ctx, -4, 4, -28, '#ffd34d'); ctx.fillStyle = '#2b1d14'; ctx.fillRect(-4, -20, 8, 3); },
  };
  function eyes(ctx, x1, x2, y, c = '#222') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x1, y, 3.5, 0, TAU); ctx.arc(x2, y, 3.5, 0, TAU); ctx.fill(); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x1 - 0.5, y, 1.8, 0, TAU); ctx.arc(x2 - 0.5, y, 1.8, 0, TAU); ctx.fill(); }
  function monster(ctx, x, y, s, o) {
    ctx.save(); ctx.translate(x + (o.hurt ? Math.sin((o.t || 0) * 70) * 2 : 0), y); ctx.globalAlpha = o.alpha ?? 1; if (o.hurt) ctx.filter = 'brightness(1.8)';
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 18 * s, 5 * s, 0, 0, TAU); ctx.fill();
    ctx.scale(s, s); if (o.elite) { ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 18; }
    const f = MON[o.name] || MON['史萊姆']; f(ctx, o.t || 0, o.color);
    // (hurt flash handled via ctx.filter at save time; a source-atop fill would whiten the opaque background as a rectangle)
    ctx.restore();
  }
  function boss(ctx, x, y, s, o) {
    const t = o.t || 0; ctx.save(); ctx.translate(x + (o.hurt ? Math.sin(t * 70) * 3 : 0), y); ctx.scale(s, s); if (o.hurt) ctx.filter = 'brightness(1.8)';
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, 0, 44, 10, 0, 0, TAU); ctx.fill();
    const breathe = Math.sin(t * 2) * 2;
    if (o.mapId === 2) {
      ctx.fillStyle = '#4a3220'; rr(ctx, -26, -96 - breathe, 52, 96 + breathe, 14); ctx.fill();
      ctx.fillStyle = '#2f5d2b'; [[-30, -104], [28, -106], [0, -124], [-14, -118], [16, -120]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(a, b - breathe, 26, 0, TAU); ctx.fill(); });
      ctx.fillStyle = '#6b8f3a'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(-30 + i * 12, -112 - breathe + Math.sin(t + i) * 4, 4, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#ffcc33'; ctx.shadowColor = '#ffcc33'; ctx.shadowBlur = 12; ctx.beginPath(); ctx.ellipse(-10, -66, 6, 4, 0.3, 0, TAU); ctx.ellipse(10, -66, 6, 4, -0.3, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#1d120a'; ctx.beginPath(); ctx.ellipse(0, -44, 14, 7 + Math.sin(t * 3) * 2, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#4a3220'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-26, -60); ctx.quadraticCurveTo(-50, -40 + Math.sin(t * 2) * 6, -44, -10); ctx.moveTo(26, -60); ctx.quadraticCurveTo(50, -40 - Math.sin(t * 2) * 6, 44, -10); ctx.stroke();
    } else {
      ctx.fillStyle = '#5f9a45'; ctx.beginPath(); ctx.arc(0, -78 - breathe, 26, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-22, -82); ctx.lineTo(-46, -96); ctx.lineTo(-20, -70); ctx.moveTo(22, -82); ctx.lineTo(46, -96); ctx.lineTo(20, -70); ctx.fill();
      ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.moveTo(-18, -100 - breathe); for (let i = 0; i < 5; i++) { ctx.lineTo(-18 + i * 9, -118 - breathe); ctx.lineTo(-13.5 + i * 9, -102 - breathe); } ctx.lineTo(18, -100 - breathe); ctx.fill();
      ctx.fillStyle = '#7a4a22'; rr(ctx, -28, -56, 56, 46, 12); ctx.fill(); ctx.fillStyle = '#c0392b'; ctx.fillRect(-28, -30, 56, 6);
      ctx.fillStyle = '#5f9a45'; rr(ctx, -24, -12, 14, 12, 4); ctx.fill(); rr(ctx, 10, -12, 14, 12, 4); ctx.fill();
      eyes(ctx, -9, 9, -82 - breathe, '#ff3b3b'); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-10, -66 - breathe); ctx.lineTo(-6, -60 - breathe); ctx.lineTo(-2, -66 - breathe); ctx.moveTo(2, -66 - breathe); ctx.lineTo(6, -60 - breathe); ctx.lineTo(10, -66 - breathe); ctx.fill();
      ctx.save(); ctx.translate(34, -40); ctx.rotate(-0.5 + Math.sin(t * 1.5) * 0.25); ctx.fillStyle = '#6b4226'; rr(ctx, -5, -46, 10, 50, 4); ctx.fill(); ctx.fillStyle = '#8b5a2b'; ctx.beginPath(); ctx.arc(0, -48, 11, 0, TAU); ctx.fill(); ctx.fillStyle = '#aaa'; [[-8, -54], [8, -52], [0, -60]].forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(a * 1.6, b - 6); ctx.lineTo(a + 2, b + 2); ctx.fill(); }); ctx.restore();
    }
    // (hurt flash handled via ctx.filter at save time; a source-atop fill would whiten the opaque background as a rectangle)
    ctx.restore();
  }
  const SKY = { 1: ['#7ec8f2', '#d6f0ff', '#79c267', '#5aa64a'], 2: ['#2d3b55', '#5b6f8a', '#2f5131', '#213b24'], 3: ['#7a2e1d', '#f08a4b', '#4a2a22', '#2d1712'], 4: ['#9cc9e8', '#eef7ff', '#d9e8f3', '#b8cfe0'], town: ['#f6b26b', '#ffe3b3', '#c9a46b', '#a9864f'] };
  function scene(ctx, w, h, o) {
    const k = o.town ? 'town' : (o.mapId || 1); const [a, b, g1, g2] = SKY[k]; const t = o.t || 0;
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7); sky.addColorStop(0, a); sky.addColorStop(1, b); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    if (k === 2) { ctx.fillStyle = 'rgba(255,255,230,.8)'; ctx.beginPath(); ctx.arc(w * 0.82, h * 0.16, 12, 0, TAU); ctx.fill(); for (let i = 0; i < 18; i++) { ctx.fillStyle = `rgba(200,255,150,${0.3 + 0.3 * Math.sin(t * 2 + i)})`; ctx.fillRect((i * 53 + t * 8) % w, (i * 37) % (h * 0.6), 2, 2); } }
    else { ctx.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 3; i++) { const cx = ((i * w / 2.4 + t * (6 + i * 3)) % (w + 120)) - 60; const cy = h * (0.12 + i * 0.07); ctx.beginPath(); ctx.arc(cx, cy, 12, 0, TAU); ctx.arc(cx + 14, cy - 5, 15, 0, TAU); ctx.arc(cx + 30, cy, 11, 0, TAU); ctx.fill(); } }
    ctx.fillStyle = shade(g1, -10); ctx.beginPath(); ctx.moveTo(0, h * 0.62); for (let x = 0; x <= w; x += 20) ctx.lineTo(x, h * 0.58 + Math.sin(x / 47 + 1) * 10); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    if (k === 2) { for (let i = 0; i < 7; i++) { const tx = (i * w / 6 + 10) % w; ctx.fillStyle = '#1b2e1d'; ctx.beginPath(); ctx.moveTo(tx, h * 0.3); ctx.lineTo(tx - 22, h * 0.66); ctx.lineTo(tx + 22, h * 0.66); ctx.fill(); } }
    if (k === 'town') { for (let i = 0; i < 4; i++) { const hx = 20 + i * (w / 4); ctx.fillStyle = ['#e9d8b4', '#d7c29b', '#efe0c0', '#dcc7a0'][i]; ctx.fillRect(hx, h * 0.42, 54, 40); ctx.fillStyle = ['#c0392b', '#2c6e9b', '#8e44ad', '#d35400'][i]; ctx.beginPath(); ctx.moveTo(hx - 6, h * 0.42); ctx.lineTo(hx + 27, h * 0.3); ctx.lineTo(hx + 60, h * 0.42); ctx.fill(); ctx.fillStyle = '#5b3a1e'; ctx.fillRect(hx + 21, h * 0.42 + 22, 12, 18); } }
    const gr = ctx.createLinearGradient(0, h * 0.66, 0, h); gr.addColorStop(0, g1); gr.addColorStop(1, g2); ctx.fillStyle = gr; ctx.fillRect(0, h * 0.68, w, h * 0.32);
    ctx.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 26; i++) ctx.fillRect((i * 37 + (o.scroll || 0)) % w, h * 0.72 + (i * 13) % (h * 0.24), 6, 2);
  }
  /** portrait (bust) for cards */
  function portrait(canvas, o) { const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height; ctx.clearRect(0, 0, w, h); const s = h / 95; hero(ctx, w / 2, h - 4, s, o); }
  window.RpgArt = { hero, monster, boss, scene, portrait, rr };
})();
