'use strict';
// Deterministic pose calculation and drawing only: no DOM, clock, loading,
// canvas resize, or mutation of source parts. Callers own viewport and timing.
(function install(root) {
  const TAU = Math.PI * 2;
  const configurations = Object.freeze({
    front: Object.freeze({ body: 'body_front', left: 'leg_front_left', right: 'leg_front_right', depthSign: 1 }),
    back: Object.freeze({ body: 'body_back', left: 'leg_back_left', right: 'leg_back_right', depthSign: -1 }),
    right: Object.freeze({ body: 'body_right', near: 'leg_right_near', far: 'leg_right_far', ground: 600, referenceBodyHeightPx: 930 }),
    left: Object.freeze({ body: 'body_left', near: 'leg_left_near', far: 'leg_left_far', ground: 600, referenceBodyHeightPx: 930 })
  });

  function solveLeg(hip, ankle, upperLength, lowerLength) {
    const dx=ankle[0]-hip[0], dy=ankle[1]-hip[1];
    const distance=Math.hypot(dx,dy);
    if (distance > upperLength+lowerLength || distance < Math.abs(upperLength-lowerLength)) throw new Error('Articulated leg target is unreachable');
    const angle=Math.atan2(dy,dx)-Math.acos(Math.max(-1,Math.min(1,(upperLength**2+distance**2-lowerLength**2)/(2*upperLength*distance))));
    return [hip[0]+Math.cos(angle)*upperLength,hip[1]+Math.sin(angle)*upperLength];
  }

  function articulatedPose({phase=0,stride=65,ground=435,staticPose=false,bodyMotion=true,rig,gaitProfile,motionScale=1}) {
    stride *= motionScale;
    const p=((phase%1)+1)%1, bob=(!staticPose&&bodyMotion?3*(Math.cos(p*TAU*2)-1):0)*motionScale;
    const legs=['far','near'].map(side=>{
      const config=rig[side],u=(p+(side==='far'?0.5:0))%1;
      if(config.gaitFootCenterX!==undefined&&!Number.isFinite(config.gaitFootCenterX))throw new Error('Articulated gaitFootCenterX must be a finite number');
      const stance=u<0.6, t=stance?u/0.6:(u-0.6)/0.4;
      // Opt-in C1 foot contact: match stance velocity at lift-off/landing.
      // The legacy branch remains byte-for-byte numerically unchanged.
      const continuous = gaitProfile === 'contact-continuous-v1';
      const smooth = t*t*(3-2*t);
      const tangent = -2*stride/0.6*0.4;
      const swingTravel = continuous
        ? -stride + 2*stride*smooth + tangent*(2*t*t*t-3*t*t+t)
        : -stride+2*stride*(t*t*(3-2*t));
      const travel=staticPose?0:stance?stride*(1-2*t):swingTravel;
      const lift=staticPose||stance?0:continuous
        ? Math.sin(t*Math.PI)**2*rig.lift*motionScale
        : Math.sin(t*Math.PI)*rig.lift*motionScale;
      const floor=ground+(config.depth||0),hip=[config.hip[0],config.hip[1]+bob];
      const ankle=[staticPose||config.gaitFootCenterX===undefined?hip[0]+travel:hip[0]+(config.gaitFootCenterX-hip[0])*motionScale+travel,floor-lift-Math.max(...config.sole.map(point=>point[1]))];
      const knee=solveLeg(hip,ankle,config.upperLength,config.lowerLength);
      const angle=Math.atan2(ankle[1]-knee[1],ankle[0]-knee[0])-config.lowerSourceAngle;
      const lower={partId:config.lower,x:knee[0],y:knee[1],rotation:angle};
      const upper={partId:config.upper,x:hip[0],y:hip[1],rotation:Math.atan2(knee[1]-hip[1],knee[0]-hip[0])-config.upperSourceAngle};
      return {side,hip,knee,ankle,upper,lower,foot:{x:ankle[0],y:ankle[1],rotation:0},lift,groundY:floor,x:ankle[0],y:ankle[1],sole:config.sole.map(([x,y])=>[ankle[0]+x,ankle[1]+y])};
    });
    return {view:'right',phase:p,ground,legs,articulated:true,body:{partId:'body_right',x:0,y:bob,rotation:0}};
  }

  function checkedSideRegistration(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'far,near')
      throw new Error('Side registration requires exactly near and far');
    const result = {};
    for (const side of ['near', 'far']) {
      const leg = value[side];
      if (!leg || typeof leg !== 'object' || Array.isArray(leg) ||
          Object.keys(leg).sort().join(',') !== 'groundOffset,x' ||
          !Number.isFinite(leg.x) || !Number.isFinite(leg.groundOffset))
        throw new Error('Side registration requires finite numeric x and groundOffset');
      result[side] = {x: leg.x, groundOffset: leg.groundOffset};
    }
    return result;
  }

  function computePose({ view = 'front', phase = 0, stride = (view === 'right' || view === 'left') ? 40 : 24, ground = (view === 'right' || view === 'left') ? 600 : 570, staticPose = false, bodyMotion = true, stanceWidth = 45, rig, gaitProfile, sideRegistration, motionScale = 1 } = {}) {
    if (!Number.isFinite(motionScale) || motionScale < 0 || motionScale > 1) throw new Error('Motion scale must be within 0..1');
    if (sideRegistration !== undefined && (rig || (view !== 'right' && view !== 'left')))
      throw new Error('Side registration requires a non-articulated side view');
    if (gaitProfile !== undefined && gaitProfile !== 'contact-continuous-v1')
      throw new Error('Unsupported layered gait profile: ' + gaitProfile);
    if (gaitProfile !== undefined && (!rig || view !== 'right'))
      throw new Error('Continuous contact gait requires a right-facing articulated rig');
    if(rig) {
      if(view!=='right') throw new Error('Articulated kit currently requires right-facing anatomy');
      return articulatedPose({phase,stride,ground,staticPose,bodyMotion,rig,gaitProfile,motionScale});
    }
    stride *= motionScale;
    const config = configurations[view];
    if (!config) throw new Error('Unsupported layered view: ' + view);
    const sideView = view === 'right' || view === 'left';
    const registeredSide = sideRegistration === undefined ? null : checkedSideRegistration(sideRegistration);
    if (view === 'left' && !registeredSide)
      throw new Error('A separately painted left view requires explicit side registration');
    const facingSign = view === 'left' ? -1 : 1;
    const normalizedPhase = ((phase % 1) + 1) % 1;
    const legs = sideView ? ['far', 'near'].map(side => {
      const near = side === 'near';
      const angle = normalizedPhase * TAU + (near ? 0 : Math.PI);
      const swing = staticPose ? 0 : Math.max(0, -Math.sin(angle));
      // Registered pure side views keep a fixed ground plane. Legacy right
      // projection retains its original depth and offsets when not opted in.
      const depth = staticPose || registeredSide ? 0 : Math.cos(angle) * stride * 0.1;
      const lift = swing * stride * 0.65;
      const floor = ground + (registeredSide ? registeredSide[side].groundOffset : (near ? 0 : -8)) + depth;
      return {
        side, partId: config[side],
        x: (registeredSide ? registeredSide[side].x : (near ? -12 : 43)) + (staticPose ? 0 : facingSign * stride * Math.cos(angle)),
        groundY: floor, y: floor - lift,
        rotation: -facingSign * swing * 0.055 * motionScale, lift
      };
    }) : ['left', 'right'].map(side => {
      const sideSign = side === 'left' ? -1 : 1;
      const angle = normalizedPhase * TAU + (side === 'right' ? Math.PI : 0);
      const depth = staticPose ? 0 : config.depthSign * stride * Math.cos(angle);
      const swing = staticPose ? 0 : Math.max(0, -Math.sin(angle));
      const lift = swing * stride * 0.85;
      return {
        side, partId: config[side],
        x: sideSign * stanceWidth + (staticPose ? 0 : sideSign * Math.sin(angle) * stride * 0.08),
        groundY: ground + depth, y: ground + depth - lift,
        rotation: sideSign * swing * 0.055 * motionScale, lift
      };
    });
    const movingBody = !staticPose && bodyMotion && stride > 0;
    return {
      view, phase: normalizedPhase, ground, legs,
      // Source-space bounds: y in [-6,0], twice per cycle; rotation in ±0.4°.
      // The source body pivot is its measured waist; the entire body is rigid.
      body: {
        partId: config.body, x: 0,
        y: movingBody ? 3 * (Math.cos(normalizedPhase * TAU * 2) - 1) * motionScale : 0,
        rotation: movingBody ? facingSign * Math.sin(normalizedPhase * TAU) * (0.4 * Math.PI / 180) * motionScale : 0
      }
    };
  }

  function drawPart(ctx, image, part, pose, guides, color) {
    const [sx, sy, width, height] = part.sourceRect;
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.rotation);
    ctx.scale((part.mirrorX ? -1 : 1) * (part.scale ?? 1), part.scale ?? 1);
    if(part.sourceClipPolygon) {
      ctx.beginPath();part.sourceClipPolygon.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x-part.pivot[0],y-part.pivot[1]));ctx.closePath();ctx.clip();
    }
    ctx.drawImage(image, sx, sy, width, height, -part.pivot[0], -part.pivot[1], width, height);
    if (guides) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(-part.pivot[0], -part.pivot[1], width, height);
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // Optional front/back masks use body.sourceRect-local pixels, just like
  // right-facing rig.foregroundPolygons. Source parts are never changed.
  function checkedForegroundPolygons(polygons, part) {
    const [, , width, height] = part.sourceRect;
    if (!Array.isArray(polygons) || !polygons.length)
      throw new Error('Foreground polygons must be a nonempty array');
    return polygons.map(polygon => {
      if (!Array.isArray(polygon) || polygon.length < 3 ||
          polygon.some(point => !Array.isArray(point) || point.length !== 2 ||
            !point.every(Number.isFinite) || point[0] < 0 || point[0] > width ||
            point[1] < 0 || point[1] > height))
        throw new Error('Foreground polygon must stay within the body source rectangle');
      const area = polygon.reduce((sum, [x, y], i) => {
        const next = polygon[(i + 1) % polygon.length];
        return sum + x * next[1] - next[0] * y;
      }, 0);
      if (!area) throw new Error('Foreground polygon must enclose an area');
      // Equal winding makes overlapping masks a union rather than a hole.
      return area < 0 ? [...polygon].reverse() : polygon;
    });
  }

  function drawForegroundBody(ctx, image, part, pose, polygons, guides) {
    ctx.save();
    try {
      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.rotation);
      ctx.scale((part.mirrorX ? -1 : 1) * (part.scale ?? 1), part.scale ?? 1);
      ctx.beginPath();
      for (const polygon of polygons) {
        polygon.forEach(([x, y], i) =>
          ctx[i ? 'lineTo' : 'moveTo'](x - part.pivot[0], y - part.pivot[1]));
        ctx.closePath();
      }
      ctx.clip();
      drawPart(ctx, image, {...part, mirrorX: false, scale: 1},
        {x: 0, y: 0, rotation: 0}, guides, '#d5b977');
    } finally {
      ctx.restore();
    }
  }

  function drawPose(ctx, { image, parts, guides = false, groundGuide = false, noGroundShadow = false, ...options }) {
    const pose = computePose(options);
    const getPart = id => parts instanceof Map ? parts.get(id) : parts[id];
    for (const item of [...pose.legs, pose.body]) {
      for(const id of pose.articulated&&item.upper?[item.upper.partId,item.lower.partId]:[item.partId])
        if (!getPart(id)) throw new Error('Missing layered part: ' + id);
    }
    const foregroundPolygons = !pose.articulated &&
      (pose.view === 'front' || pose.view === 'back') &&
      options.foregroundPolygons !== undefined
      ? checkedForegroundPolygons(options.foregroundPolygons, getPart(pose.body.partId))
      : null;
    ctx.save();
    try {
      if (!noGroundShadow) for (const leg of pose.legs) {
        ctx.fillStyle = 'rgba(5,10,17,' + Math.max(0.05, 0.22 - leg.lift / 500).toFixed(3) + ')';
        ctx.beginPath();
        ctx.ellipse(leg.x, leg.groundY + 2, 37, 8, 0, 0, TAU);
        ctx.fill();
      }
      if (guides || groundGuide) {
        ctx.strokeStyle = '#b8c4d977';
        ctx.lineWidth = groundGuide ? 4 : 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(-210, pose.ground);
        ctx.lineTo(210, pose.ground);
        ctx.stroke();
      }
      // Side-view limb occlusion is anatomical: far always precedes near.
      const drawOrder = pose.view === 'right' || pose.view === 'left' ? pose.legs : [...pose.legs].sort((a, b) => a.groundY - b.groundY);
      if(pose.articulated || foregroundPolygons) drawPart(ctx,image,getPart(pose.body.partId),pose.body,false,'#d5b977');
      for (const leg of drawOrder) {
        const color=leg.side === 'left' || leg.side === 'far' ? '#6dbbf2' : '#e0aa70';
        if(pose.articulated) {
          const lower=getPart(leg.lower.partId),split=options.rig[leg.side].footSplit;
          const [x,y,w,h]=lower.sourceRect;
          drawPart(ctx,image,{sourceRect:[x,y,w,split.shinBottom],pivot:lower.pivot,scale:lower.scale},leg.lower,guides,color);
          drawPart(ctx,image,{sourceRect:[x,y+split.footTop,w,h-split.footTop],pivot:[split.anklePivot[0],split.anklePivot[1]-split.footTop],scale:lower.scale},leg.foot,guides,color);
          drawPart(ctx,image,getPart(leg.upper.partId),leg.upper,guides,color);
        } else drawPart(ctx, image, getPart(leg.partId), leg, guides,color);
      }
      if(pose.articulated) {
        const part=getPart(pose.body.partId);
        ctx.save();ctx.translate(pose.body.x,pose.body.y);ctx.beginPath();
        for(const polygon of options.rig.foregroundPolygons) {
          polygon.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x-part.pivot[0],y-part.pivot[1]));ctx.closePath();
        }
        ctx.clip();drawPart(ctx,image,part,{x:0,y:0,rotation:0},guides,'#d5b977');ctx.restore();
      } else if (foregroundPolygons) {
        drawForegroundBody(ctx, image, getPart(pose.body.partId), pose.body, foregroundPolygons, guides);
      } else
      drawPart(ctx, image, getPart(pose.body.partId), pose.body, guides, '#d5b977');
    } finally {
      ctx.restore();
    }
    return pose;
  }

  function drawPaintedFrame(ctx, {image, frame, scale = 1}) {
    if (!frame.sourceLayers?.length || !(scale > 0)) throw new Error('Invalid painted-layer pose');
    for (const layer of frame.sourceLayers) {
      const [sx, sy, width, height] = layer.rect, [ax, ay] = layer.anchor;
      ctx.save();
      try {
        ctx.scale(scale, scale);
        if (layer.sourceClipPolygon) {
          ctx.beginPath();layer.sourceClipPolygon.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x-ax,y-ay));ctx.closePath();ctx.clip();
        }
        ctx.drawImage(image,sx,sy,width,height,-ax,-ay,width,height);
      } finally { ctx.restore(); }
    }
  }

  const api = Object.freeze({ configurations, computePose, drawPose, drawPaintedFrame });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LayeredWalkRenderer = api;
})(globalThis);

