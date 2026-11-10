
(function(root){
'use strict';
const POLICY='archer-b21-death-source-components-v4';
const SOURCES={up:'a407e965b856e9c49f52209389d9e9774e08e23456d79b15ba7c8f193f021d15',down:'fc65317491e7216342448b5cde2a9a30ff037c6b14b5ed45cfd9a5f7bdb713ed',right:'80d8facb5eb7f144ca40dc5e0e5d8cdef7771704b4a85a1ba26be6c50bc5ef1a'};
const INPUTS={up:'df7bd5d4c6cfee3c4f7497e8faa3fbba72d0a0a27227c92617c24b57ea956596',down:'604fe8dc9907b318c264e360620df0d234a3e5491154345008f65a5f7609fa54',right:'604fe8dc9907b318c264e360620df0d234a3e5491154345008f65a5f7609fa54'};
const UP_RECTS=[[35,32,687,499],[28,570,813,454],[25,1089,963,310]],GROUNDS={up:[[512,526],[512,1017],[512,1360]],down:[[512,546],[512,1030],[512,1400]],right:[[512,537],[512,1050],[512,1400]]};
const WEAPON_URL='/ui-generated-20261030/characters-v1/assets/adv3_archer_B21_m-death-up-v1-a407e965b856.png';
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b),poly=p=>Array.isArray(p)&&p.length>=3&&p.every(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite));
function validate(o){
const{actor,action,direction,source,frame,image,images,scale}=o,r=source?.componentRegistration,i=frame?.componentPhaseIndex,l=frame?.sourceLayers;
if(actor?.id!=='adv3_archer_B21_m'||actor.family!=='archer'||action!=='death'||!Object.hasOwn(SOURCES,direction))throw Error('B21 component draw outside exact three death slots');
if(r?.policyId!==POLICY||r.sourceSha256!==SOURCES[direction]||r.sourcePartitionSha256!==INPUTS[direction]||r.previewAuthorized!==true||r.approved!==false)throw Error('Unbound B21 component source contract');
if(source.mirrorX||frame.mirrorX||source.loop!==false||source.bodyHeight!==1000||frame.bodyHeight!==1000||Math.abs(scale-.3)>1e-12)throw Error('B21 anatomy, loop or mirror contract mismatch');
if(!Number.isInteger(i)||i<0||i>2||frame.durationMs!==[220,240,700][i]||!Array.isArray(l)||l.length!==2)throw Error('B21 source phase mismatch');
if(image?.width!==1024||image?.height!==1536)throw Error('B21 human atlas dimension mismatch');
const rect=direction==='up'?UP_RECTS[i]:[0,0,1024,1536],ground=GROUNDS[direction][i],[body,weapon]=l;
if(body.role!=='body'||body.uniformScale!==1||!eq(body.offset,[0,0])||!eq(body.rect,rect)||!eq(body.anchor,[ground[0]-rect[0],ground[1]-rect[1]])||!poly(body.sourceClipPolygon))throw Error('B21 original human registration changed');
if(weapon.role!=='weapon'||weapon.url!==WEAPON_URL||weapon.sourceSha256!==SOURCES.up||weapon.uniformScale!==1.35||!eq(weapon.rect,[578,398,411,156])||!eq(weapon.anchor,[354,153])||!eq(weapon.offset,[700,128.33333333333334])||!poly(weapon.sourceClipPolygon))throw Error('B21 common original weapon contract changed');
const wi=images?.get(weapon.url);if(!wi)throw Error('Missing required original UP ground-weapon image; refusing to omit the weapon');
if(wi.width!==1024||wi.height!==1536)throw Error('B21 shared weapon atlas dimension mismatch');
return[{layer:body,image},{layer:weapon,image:wi}];
}
function draw(ctx,options){for(const{layer,image}of validate(options)){const[sx,sy,w,h]=layer.rect,[ax,ay]=layer.anchor;ctx.save();try{ctx.scale(options.scale,options.scale);ctx.translate(...layer.offset);ctx.scale(layer.uniformScale,layer.uniformScale);ctx.beginPath();layer.sourceClipPolygon.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x-ax,y-ay));ctx.closePath();ctx.clip();ctx.drawImage(image,sx,sy,w,h,-ax,-ay,w,h);}finally{ctx.restore();}}}
const api=Object.freeze({policyId:POLICY,validate,draw});if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.B21DeathComponentRenderer=api;
})(globalThis);

/* Local sprite playback. Source artwork is preserved; framing occurs at render time. */
(function () {
  'use strict';
  const ROOT = '/ui-generated-20261030/characters-v1/';
  const TILE_W = 480, TILE_H = 512, FOOT_X = 240, FOOT_Y = 470, BODY = 300;
  let catalogPromise, nextAnimatorId = 0;
  const textureNamespace = window.__characterSpriteNamespace = (window.__characterSpriteNamespace || 0) + 1;
  function catalog() {
    return catalogPromise ||= fetch(ROOT + 'character-preview-index.json').then(r => {
      if (!r.ok) throw Error('人物目錄讀取失敗'); return r.json();
    }).catch(error => { catalogPromise = null; throw error; });
  }
  function nativeCanvasClip(source) {
    const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    if (!source || typeof source !== 'object' || source.render === 'layered-walk-v1' || has(source, 'layered') || has(source, 'sourceLayers')) return false;
    const frames = source.frames, sequence = source.sourceFrameSequence;
    if (!Number.isInteger(source.nativeFrameCount) || source.nativeFrameCount <= 0 || !Number.isInteger(source.sourceCellCount) || source.sourceCellCount < source.nativeFrameCount || !Array.isArray(frames) || !frames.length || !Array.isArray(sequence) || sequence.length !== frames.length) return false;
    if (has(source, 'playableFrameCount') && source.playableFrameCount !== frames.length) return false;
    return frames.every((frame, index) => frame && typeof frame === 'object' && frame.render !== 'layered-walk-v1' && !has(frame, 'layered') && !has(frame, 'sourceLayers') && Number.isInteger(sequence[index]) && sequence[index] >= 0 && sequence[index] < source.sourceCellCount && Number.isInteger(frame.sourceFrameIndex) && frame.sourceFrameIndex === sequence[index]);
  }
  // Two exact source-reviewed B death containers; no generic archer resize permission.
  const EXACT_B_DEATH_CONTAINERS = [{"policyId":"archer-two-exact-reviewed-death-containers-20261109-v1","identity":{"id":"adv4_archer_A211_f","key":"adv4_archer_A211_f","family":"archer","advancement":4,"classPath":"A211","gender":"f"},"action":"death","direction":"up","width":512,"height":512,"footX":240,"footY":470,"displayBody":300,"nativeBodyHeight":426,"primarySourceSha256":"097238e9d93149fce8993d21d7558e9e9f84bf438ae174962b55f6f9471bcb83","review":{"path":"D:/StarJournal/character-production/archer-integration-20261104/four-dialog-plan-20261105-1911/group-B/resume-20261106-e94e56cb1605/a211-f-death-remaining/ROOT_PRIVATE_CANDIDATE_ACCEPTANCE_UP_V2_CANVAS512_V1.json","bytes":83929,"sha256":"e5efef4fe39c9453971462d5290281e74223ceaa2a1d4ccd43f0a9d6925cfa7a"},"frameGeometry":[[[724,0,724,724],[390.0,697],611,"/ui-generated-20261030/characters-v1/assets/adv4_archer_A211_f-directional-idle-0e32440ccdfc0f64.png",180,false,"D:/StarJournal/character-production/archer-integration-20261104/batch7-20261105/attempts/a211-f-turnaround-v1/turnaround-v1.original.png"],[[1024,0,512,512],[242,478],426,"/ui-generated-20261030/characters-v1/assets/adv4_archer_A211_f-canvas2-097238e9d93149fc.png",220,false,"D:/StarJournal/character-production/archer-integration-20261104/four-dialog-plan-20261105-1911/group-B/motion-a21/attempts/a211-f-death-up-bow-rest-v2/original.png"],[[0,512,448,512],[273.5,443],426,"/ui-generated-20261030/characters-v1/assets/adv4_archer_A211_f-canvas2-097238e9d93149fc.png",240,false,"D:/StarJournal/character-production/archer-integration-20261104/four-dialog-plan-20261105-1911/group-B/motion-a21/attempts/a211-f-death-up-bow-rest-v2/original.png"],[[480,512,544,512],[184,473],426,"/ui-generated-20261030/characters-v1/assets/adv4_archer_A211_f-canvas2-097238e9d93149fc.png",700,false,"D:/StarJournal/character-production/archer-integration-20261104/four-dialog-plan-20261105-1911/group-B/motion-a21/attempts/a211-f-death-up-bow-rest-v2/original.png"]],"neutralGeometry":[[724,0,724,724],[390.0,697],611,"/ui-generated-20261030/characters-v1/assets/adv4_archer_A211_f-directional-idle-0e32440ccdfc0f64.png",1000,false,"D:/StarJournal/character-production/archer-integration-20261104/batch7-20261105/attempts/a211-f-turnaround-v1/turnaround-v1.original.png"]},{"policyId":"archer-two-exact-reviewed-death-containers-20261109-v1","identity":{"id":"adv4_archer_A212_f","key":"adv4_archer_A212_f","family":"archer","advancement":4,"classPath":"A212","gender":"f"},"action":"death","direction":"left","width":480,"height":544,"footX":240,"footY":470,"displayBody":300,"nativeBodyHeight":546,"primarySourceSha256":"855e883a6da1543dde0458b6a4c7dcfec24648468bc28b2e6cf8a9a568967e89","review":{"path":"D:/StarJournal/character-production/archer-integration-20261104/four-dialog-plan-20261105-1911/group-B/resume-20261106-e94e56cb1605/a212-f-death-left/ROOT_PRIVATE_CANDIDATE_ACCEPTANCE_LEFT_V2_CANVAS544_V1.json","bytes":53045,"sha256":"ebb38f1c4762dca5afa32aca4b0690e914ca6d12c56ddbff565fddf05553ff26"},"frameGeometry":[[[1328,0,592,819],[196.5,771],668,"/ui-generated-20261030/characters-v1/assets/adv4_archer_A212_f-directional-idle-f3bb26ec0ddec089.png",180,false,"D:/StarJournal/character-production/archer-integration-20261104/batch7-20261105/attempts/a212-f-turnaround-v1/turnaround-v1.original.png"],[[630,0,682,650],[277,623],546,"/ui-generated-20261030/characters-v1/assets/adv4_archer_A212_f-canvas2-855e883a6da1543d.png",220,false,"D:/StarJournal/character-production/archer-integration-20261104/four-dialog-plan-20261105-1911/group-B/motion-a21/attempts/a212-f-death-left-bow-scale-nocks-v2/original.png"],[[0,650,606,549],[273,463],546,"/ui-generated-20261030/characters-v1/assets/adv4_archer_A212_f-canvas2-855e883a6da1543d.png",240,false,"D:/StarJournal/character-production/archer-integration-20261104/four-dialog-plan-20261105-1911/group-B/motion-a21/attempts/a212-f-death-left-bow-scale-nocks-v2/original.png"],[[606,650,706,549],[351,427],546,"/ui-generated-20261030/characters-v1/assets/adv4_archer_A212_f-canvas2-855e883a6da1543d.png",700,false,"D:/StarJournal/character-production/archer-integration-20261104/four-dialog-plan-20261105-1911/group-B/motion-a21/attempts/a212-f-death-left-bow-scale-nocks-v2/original.png"]],"neutralGeometry":[[1328,0,592,819],[196.5,771],668,"/ui-generated-20261030/characters-v1/assets/adv4_archer_A212_f-directional-idle-f3bb26ec0ddec089.png",1000,false,"D:/StarJournal/character-production/archer-integration-20261104/batch7-20261105/attempts/a212-f-turnaround-v1/turnaround-v1.original.png"]}];
  function exactBDeathContainer(actor, action, direction, source) {
    const token=source.reviewedCanvasContract;
    if(!token)return null;
    const c=EXACT_B_DEATH_CONTAINERS.find(x=>x.identity.id===actor.id&&x.action===action&&x.direction===direction);
    const fail=why=>{throw Error('Exact reviewed B death canvas: '+why);};
    if(!c||actor.approved!==false||!Object.entries(c.identity).every(([k,v])=>actor[k]===v))fail('identity/slot');
    const equal=(a,b)=>{if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return ak.length===bk.length&&ak.every((k,i)=>k===bk[i]&&equal(a[k],b[k]));};
    if(!equal(token,c))fail('bound source/review/geometry contract');
    const rr=source.rootPrivateAcceptance;
    if(!rr||rr.path!==c.review.path||rr.bytes!==c.review.bytes||rr.sha256!==c.review.sha256)fail('root review SHA');
    if(BODY!==c.displayBody||FOOT_Y!==c.footY||source.bodyHeight!==c.nativeBodyHeight||source.sourceSha256!==c.primarySourceSha256)fail('native anatomical scale/source');
    if(source.approved!==false||source.directionVerified!==true||source.anatomicalScaleVerified!==true||source.verifiedForCoreCoverage!==true||source.loop!==false||source.holdLastFrame!==true||source.mirrorX!==false)fail('candidate timing/facing');
    if(c.width===512?(source.canvasWidthPx!==512||Object.hasOwn(source,'canvasHeightPx')):(source.canvasHeightPx!==544||Object.hasOwn(source,'canvasWidthPx')))fail('exact container dimensions');
    const forbidden=['render','layered','sourceLayers','runtimeSourceMap','sourceClipPolygon','componentRegistration','componentRegistrationPolicy','scale','uniformScale','offset','footX','footY','origin'];
    if(forbidden.some(k=>Object.hasOwn(source,k))||!Array.isArray(source.frames)||source.frames.length!==4)fail('alternate render/four keyframes');
    const g=f=>[f.rect,f.anchor,f.bodyHeight,f.url,f.durationMs,!!f.mirrorX,f.source];
    if(source.frames.some(f=>forbidden.concat(['canvasWidthPx','canvasHeightPx']).some(k=>Object.hasOwn(f,k)))||JSON.stringify(source.frames.map(g))!==JSON.stringify(c.frameGeometry))fail('exact four-keyframe source geometry');
    const neutral=actor.clips?.idle?.[direction];
    if(!neutral||neutral.loop!==true||neutral.frames?.length!==1||neutral.mirrorX===true||JSON.stringify(g(neutral.frames[0]))!==JSON.stringify(c.neutralGeometry))fail('original accepted matching neutral');
    if(forbidden.concat(['canvasWidthPx','canvasHeightPx']).some(k=>Object.hasOwn(neutral,k)||Object.hasOwn(neutral.frames[0],k)))fail('neutral render path');
    return {width:c.width,height:c.height,footX:c.footX,footY:c.footY};
  }
  function reviewedRasterDeathCanvas(actor, action, direction, source, runtime) {
    const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
    if (!own(source, 'reviewedRasterCanvas')) return null;
    const fail = why => { throw Error('Reviewed raster death canvas: ' + why); };
    const object = o => !!o && typeof o === 'object' && !Array.isArray(o);
    const equal = (a, b) => {
      if (a === b) return true;
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
      const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
      return ak.length === bk.length && ak.every((k, i) => k === bk[i] && equal(a[k], b[k]));
    };
    const exactKeys = (o, keys) => object(o) && equal(Object.keys(o).sort(), keys.slice().sort());
    const sha = s => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
    const c = source.reviewedRasterCanvas, slot = action + '.' + direction;
    const walk = c?.policyId === 'archer-reviewed-single-png-four-key-walk-canvas-v1-symmetric';
    const symmetric = walk || c?.policyId === 'archer-reviewed-single-png-four-key-death-canvas-v2-symmetric';
    const policyAction = walk ? 'walk' : symmetric || c?.policyId === 'archer-reviewed-single-png-four-key-death-canvas-v1' ? 'death' : c?.policyId === 'archer-reviewed-single-png-four-key-attack-canvas-v2' ? 'attack' : null;
    const keys = ['policyId', 'actorId', 'slot', 'sourceSha256', 'nativeBH', 'fixedBODY', 'footX', 'footY', 'width', 'height', 'rootReviewRef', 'frameGeometry'];
    if (symmetric) keys.push('mirrorX', 'sourceFacing');
    if (walk) keys.push('gaitMode');
    if (policyAction === 'attack') keys.push('releaseFrame', 'releaseAnchorPx');
    if (!policyAction || !exactKeys(c, keys)) fail('policy/schema');
    if (!actor || actor.family !== 'archer' || actor.approved !== false || action !== policyAction
        || !['up', 'down', 'left', 'right'].includes(direction) || typeof actor.id !== 'string' || !actor.id
        || c.actorId !== actor.id || (own(actor, 'key') && actor.key !== actor.id) || c.slot !== slot) fail('identity/slot');
    const validSymmetricFacing = (['left', 'right'].includes(direction) && ['left', 'right'].includes(c.sourceFacing))
      || (walk && ['up', 'down'].includes(direction) && c.sourceFacing === direction && c.mirrorX === false);
    if (symmetric && (!validSymmetricFacing || typeof c.mirrorX !== 'boolean'
        || c.mirrorX !== source.mirrorX || c.sourceFacing !== source.sourceFacing
        || (c.mirrorX ? c.sourceFacing === direction : c.sourceFacing !== direction))) fail('symmetric horizontal facing/mirror');
    const bySlot = actor.reviewedRasterCanvasBySlot;
    if (!object(bySlot) || !own(bySlot, slot) || !equal(c, bySlot[slot])) fail('root actor/slot binding');
    const ref = c.rootReviewRef;
    if (!exactKeys(ref, ['path', 'bytes', 'sha256']) || typeof ref.path !== 'string' || !ref.path.trim()
        || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0 || !sha(ref.sha256)) fail('root receipt reference');
    if (!runtime || runtime.body !== 300 || runtime.footX !== 240 || runtime.footY !== 470
        || c.fixedBODY !== 300 || (symmetric ? c.footX !== c.width / 2 : c.footX !== 240) || c.footY !== 470) fail('fixed world body/foot');
    if (!Number.isInteger(c.width) || c.width < 480 || c.width > 1024 || c.width % 32 !== 0
        || !Number.isInteger(c.height) || c.height < 512 || c.height > 1024 || c.height % 32 !== 0) fail('canvas dimensions');
    if (!Number.isFinite(c.nativeBH) || c.nativeBH <= 0 || source.bodyHeight !== c.nativeBH
        || !sha(c.sourceSha256) || source.sourceSha256 !== c.sourceSha256) fail('native body/source');
    if (source.approved !== false || source.directionVerified !== true || source.anatomicalScaleVerified !== true
        || (!symmetric && source.sourceFacing !== direction) || source.loop !== walk || source.holdLastFrame !== !walk
        || (!symmetric && source.mirrorX !== false)) fail('candidate timing/facing/scale');
    if (walk && (c.gaitMode !== 'procedural-four-key-in-place' || source.gaitMode !== c.gaitMode || source.gaitAccepted !== true
        || source.authoredFrameCount !== 0 || source.derivedFrameCount !== 4 || source.nativeFrameCount !== 4
        || source.sourceCellCount !== 4 || source.playableFrameCount !== 4 || c.width !== 704 || c.height !== 640 || c.nativeBH !== 300)) fail('recorded derived walk gait/container');
    // No core/UI flag is read or promoted here. Geometry approval alone is not art approval.
    const forbidden = ['render', 'layered', 'sourceLayers', 'components', 'runtimeSourceMap', 'sourceClipPolygon', 'componentRegistration',
      'componentRegistrationPolicy', 'companionAttachment', 'scale', 'uniformScale', 'offset', 'footX', 'footY', 'origin',
      'reviewedCanvasContract', 'canvasRegistration'];
    if (forbidden.some(k => own(source, k))) fail('alternate render/registration');
    for (const [key, value] of [['canvasWidthPx', c.width], ['canvasHeightPx', c.height]]) {
      if (own(source, key) && source[key] !== value) fail('conflicting legacy canvas dimension');
    }
    if (['nativeFrameCount', 'sourceCellCount', 'playableFrameCount'].concat(walk ? [] : ['authoredFrameCount']).some(k => own(source, k) && source[k] !== 4)
        || (own(source, 'sourceFrameSequence') && !equal(source.sourceFrameSequence, [0, 1, 2, 3]))
        || !Array.isArray(source.frames) || source.frames.length !== 4
        || !Array.isArray(c.frameGeometry) || c.frameGeometry.length !== 4) fail('four native raster keyframes');
    let pngUrl;
    const rects = new Set();
    source.frames.forEach((f, index) => {
      if (!object(f) || forbidden.concat(['canvasWidthPx', 'canvasHeightPx']).some(k => own(f, k))
          || f.mirrorX !== false || f.sourceFrameIndex !== index) fail('native frame/render');
      if (!Array.isArray(f.rect) || f.rect.length !== 4 || !f.rect.every(Number.isSafeInteger)
          || f.rect[0] < 0 || f.rect[1] < 0 || f.rect[2] <= 0 || f.rect[3] <= 0
          || !Array.isArray(f.anchor) || f.anchor.length !== 2 || !f.anchor.every(Number.isFinite)
          || !Number.isFinite(f.durationMs) || f.durationMs <= 0) fail('frame rect/anchor/duration');
      if (walk && (f.rect[2] !== 704 || f.rect[3] !== 640 || !equal(f.anchor, [352, 470]) || f.durationMs !== 220)) fail('walk fixed native geometry/timing');
      const rectKey = JSON.stringify(f.rect);
      if (rects.has(rectKey)) fail('repeated native source window');
      rects.add(rectKey);
      if (typeof f.url !== 'string' || !/^\/ui-generated-20261030\/characters-v1\/assets\/[^/?#]+\.png$/.test(f.url)
          || (index && f.url !== pngUrl) || f.sourceSha256 !== c.sourceSha256 || f.bodyHeight !== c.nativeBH) fail('single PNG/common body/source');
      pngUrl = f.url;
      if (!equal([f.rect, f.anchor, f.bodyHeight, f.url, f.durationMs, f.sourceSha256], c.frameGeometry[index])) fail('bound frame geometry');
    });
    if (action === 'attack') {
      const p = source.releaseAnchorPx, f = source.frames[2];
      if (source.releaseFrame !== 2 || c.releaseFrame !== 2 || !equal(p, c.releaseAnchorPx) || !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || p[0] < 0 || p[1] < 0 || p[0] >= f.rect[2] || p[1] >= f.rect[3]) fail('attack release geometry');
    }
    return {width: c.width, height: c.height, footX: c.footX, footY: c.footY};
  }
  function clipGeometry(actor, action, direction, source = {}) {
    const reviewedRaster = reviewedRasterDeathCanvas(actor, action, direction, source, {body:BODY, footX:FOOT_X, footY:FOOT_Y});
    if (reviewedRaster) return reviewedRaster;
    const exactB=exactBDeathContainer(actor,action,direction,source);
    if(exactB)return exactB;
    const sideAttack = actor.family === 'sword' && action === 'attack' && (direction === 'right' || direction === 'left');
    let width = sideAttack ? 640 : TILE_W;
    let height = actor.family === 'sword' && action === 'death' ? 576 : TILE_H;
    const nativeSide = sideAttack && nativeCanvasClip(source);
    // One explicit archer exception, backed by accepted source-review provenance.
    const nativeReview = actor.nativeSourceReviewPolicy;
    const nativeArcherRight = actor.family === 'archer' && actor.id === 'adv4_archer_A211_m'
      && action === 'attack' && direction === 'right' && nativeCanvasClip(source)
      && source.nativeFrameCount === 8 && source.frames.length === 8 && !source.mirrorX
      && nativeReview?.policyId === 'archer-batch7-reviewed-native-source-v1'
      && nativeReview?.batchId === 'archer-batch7-20261105' && nativeReview.candidateAccepted === true
      && nativeReview.runtimeAcceptanceIncluded === false
      && nativeReview.publishedCandidateSlots?.includes('attack.right')
      && typeof nativeReview.rootReviewEvidence?.path === 'string'
      && source.reviewEvidence === nativeReview.rootReviewEvidence.path
      && source.directionVerified === true && source.anatomicalScaleVerified === true
      && source.verifiedForCoreCoverage === true && source.status === 'reviewed-native-right-candidate';
    // Exact reviewed B22 RIGHT death container; source/body/world foot are unchanged.
    const repair = source.canvasRegistration, evidence = source.reviewEvidence;
    const binding = actor.archerMotionReviewPolicy?.rootReviewEvidenceBySlot?.['death.right'];
    const reviewedB22Right = actor.family === 'archer' && actor.id === 'adv3_archer_B22_m'
      && action === 'death' && direction === 'right'
      && repair?.policyId === 'archer-b22-right-death-repair-canvas-v1'
      && repair.candidateAccepted === true && repair.approved === false
      && repair.bodyPx === BODY && repair.footY === FOOT_Y && repair.heightPx === TILE_H
      && evidence && typeof evidence.path === 'string' && /^[0-9a-f]{64}$/.test(evidence.sha256)
      && repair.reviewSha256 === evidence.sha256 && binding?.sha256 === evidence.sha256
      && binding.path === evidence.path && binding.bytes === evidence.bytes
      && actor.archerMotionReviewPolicy?.policyId === 'archer-reviewed-motion-candidates-v1'
      && actor.archerMotionReviewPolicy.publishedCandidateSlots?.includes('death.right')
      && source.approved === false && source.directionVerified === true
      && source.anatomicalScaleVerified === true && source.verifiedForCoreCoverage === true
      && source.loop === false && source.holdLastFrame === true && !source.mirrorX
      && Array.isArray(source.frames) && source.frames.length === 4
      && source.frames.every((f,i) => f?.durationMs === [180,220,240,700][i] && !f.mirrorX)
      && source.frames[0].bodyHeight === 773
      && JSON.stringify(source.frames[0].anchor) === '[758,875]'
      && JSON.stringify(repair.frameGeometry) === JSON.stringify(source.frames.map(f => [f.rect,f.anchor,f.bodyHeight,f.url]));
    if (Object.prototype.hasOwnProperty.call(source, 'canvasWidthPx')) {
      const requested = source.canvasWidthPx;
      if (nativeArcherRight) {
        if (requested !== 512) throw Error('Invalid explicit reviewed archer canvas width');
        width = requested;
      } else if (reviewedB22Right) {
        if (requested !== 512) throw Error('Invalid exact B22 RIGHT death canvas width');
        width = requested;
      } else {
        const supportedAction = action === 'death' || action === 'attack' && (direction === 'up' || direction === 'down') || nativeSide;
        const minimum = nativeSide ? 640 : TILE_W;
        if (actor.family !== 'sword' || !supportedAction || !Number.isInteger(requested) || requested < minimum || requested > 1024 || requested % 32 !== 0) {
          throw Error('Invalid explicit sword canvas width');
        }
        width = requested;
      }
    }
    if (Object.prototype.hasOwnProperty.call(source, 'canvasHeightPx')) {
      const requested = source.canvasHeightPx;
      if (!nativeSide || !Number.isInteger(requested) || requested < TILE_H || requested > 1024 || requested % 32 !== 0) {
        throw Error('Invalid explicit native sword side-attack canvas height');
      }
      height = requested;
    }
    return {width, height, footX: width / 2, footY: FOOT_Y};
  }
  class Animator {
    constructor(scene, sprite) { this.scene = scene; this.sprite = sprite; this.actor = null; this.clips = {}; this.desiredDirection = 'down'; this.activeDirection = null; this.action = 'idle'; this.elapsed = 0; this.generation = 0; this.keys = []; this.lastFrame = ''; this.ready = false; this.loadController = null; this.texturePrefix = 'char-' + textureNamespace + '-' + (++nextAnimatorId); }
    // Existing scene callers read/write direction as desired facing. The clip
    // currently playing has its own direction, so face() cannot hide a turn.
    get direction() { return this.desiredDirection; }
    set direction(value) { this.desiredDirection = value; }
    async load(id) {
      const generation = ++this.generation;
      this.loadController?.abort();
      const controller = this.loadController = new AbortController();
      const isCurrent = () => generation === this.generation && this.loadController === controller;
      const images = new Map(), newKeys = [];
      let committed = false;
      this.ready = false; this.sprite.setVisible(false);
      this.cancelMagePreviewMotion(true);
      this.cancelThiefPreviewMotion(true);
      try {
      const data = await catalog(), reference = data.actors.find(a => a.id === id);
      if (!isCurrent()) return false;
      if (!reference) throw Error('找不到人物');
      if (!window.CharacterCatalogLoader) await import(ROOT + 'character-catalog-loader.js');
      const actor = await window.CharacterCatalogLoader.loadActor(reference, {signal: controller.signal});
      if (!isCurrent()) return false;
      let companionRenderer = null;
      if (Object.values(actor.clips).some(ds => Object.values(ds).some(c => c.companionAttachment != null))) {
        if (!window.LayeredWalkRenderer) await import(ROOT + 'layered-walk-renderer.js');
        if (!window.ReviewedCompanionOverlay) await import(ROOT + 'reviewed-companion-overlay.js');
        companionRenderer = window.ReviewedCompanionOverlay;
      }
      const idleDirections = Object.keys(actor.clips.idle || {});
      const initialDirection = idleDirections.includes(this.desiredDirection) ? this.desiredDirection : idleDirections.includes('right') ? 'right' : idleDirections[0];
      if (!initialDirection) throw Error('人物沒有可用待機姿勢');
      const urls = [...new Set([...Object.values(actor.clips).flatMap(d => Object.values(d).flatMap(c => c.frames.map(f => f.url))), ...(companionRenderer?.collectUrls(actor) || [])])];
      let cursor = 0, loadError;
      await Promise.all(Array.from({length: Math.min(4, urls.length)}, async () => {
        while (isCurrent() && !loadError && cursor < urls.length) {
          try {
          const url = urls[cursor++], response = await fetch(url, {signal: controller.signal});
          if (!response.ok) throw Error('人物圖檔讀取失敗');
          const blob = await response.blob();
          if (!isCurrent() || loadError) return;
          const bitmap = await createImageBitmap(blob);
          if (!isCurrent() || loadError) { bitmap.close(); return; }
          images.set(url, bitmap);
          } catch (error) { loadError ||= error; controller.abort(); }
        }
      }));
      if (!isCurrent()) return false;
      if (loadError) throw loadError;
      const clips = {};
      for (const [action, directions] of Object.entries(actor.clips)) {
        clips[action] = {};
        for (const [direction, source] of Object.entries(directions)) {
          // Explicit action width changes the container only; source scale and ground stay fixed.
          const geometry = clipGeometry(actor, action, direction, source);
          const companion = companionRenderer?.validateSpec(actor, action, direction, source) || null;
          const tileWidth = geometry.width, tileHeight = geometry.height, footX = geometry.footX;
          const columns = Math.min(4,source.frames.length);
          const canvas = document.createElement('canvas'); canvas.width = tileWidth * columns; canvas.height = tileHeight * Math.ceil(source.frames.length/columns);
          const ctx = canvas.getContext('2d');
          source.frames.forEach((f, index) => {
            const [sx, sy, sw, sh] = f.rect, [ax, ay] = f.anchor, scale = BODY / f.bodyHeight;
            const x = index % columns * tileWidth, y = Math.floor(index / columns) * tileHeight;
            ctx.save(); ctx.beginPath(); ctx.rect(x, y, tileWidth, tileHeight); ctx.clip();
            ctx.translate(x + footX, y + FOOT_Y);
            if (!!source.mirrorX !== !!f.mirrorX) ctx.scale(-1, 1);
            companionRenderer?.draw(ctx, companion, f, index, images, scale, 'behind-base');
            if (f.render === 'layered-walk-v1' || source.render === 'layered-walk-v1') {
              const layered=f.layered||source.layered;
              const {ground = 570} = layered;
              ctx.scale(scale, scale);
              ctx.translate(0, -ground);
              window.LayeredWalkRenderer.drawPose(ctx, {
                ...layered, image: images.get(f.url), phase: f.phase??0
              });
            } else if (f.componentRegistrationPolicy === 'archer-b21-death-source-components-v4') {
              if (!window.B21DeathComponentRenderer) throw Error('Missing B21 component renderer');
              window.B21DeathComponentRenderer.draw(ctx,{actor,action,direction,source,frame:f,image:images.get(f.url),images,scale});
            } else if (f.sourceLayers?.length) {
              window.LayeredWalkRenderer.drawPaintedFrame(ctx, {image: images.get(f.url), frame: f, scale});
            } else {
              if (f.sourceClipPolygon) {
                ctx.beginPath(); f.sourceClipPolygon.forEach((p,n) => ctx[n ? 'lineTo' : 'moveTo']((p[0]-ax)*scale,(p[1]-ay)*scale)); ctx.closePath(); ctx.clip();
              }
              ctx.drawImage(images.get(f.url), sx, sy, sw, sh, -ax * scale, -ay * scale, sw * scale, sh * scale);
            }
            companionRenderer?.draw(ctx, companion, f, index, images, scale, 'in-front-of-base');
            ctx.restore();
          });
          const key = this.texturePrefix + '-' + generation + '-' + action + '-' + direction;
          const texture = this.scene.textures.addCanvas(key, canvas);
          newKeys.push(key);
          source.frames.forEach((_, i) => texture.add(i, 0, i % columns * tileWidth, Math.floor(i / columns) * tileHeight, tileWidth, tileHeight));
          const durations = source.frames.map(f => f.durationMs || 125);
          clips[action][direction] = { key, durations, duration: durations.reduce((a,b)=>a+b,0), loop: source.loop, source, origin: [footX / tileWidth, FOOT_Y / tileHeight] };
        }
      }
      this.keys.forEach(key => this.scene.textures.remove(key)); this.keys = newKeys;
      this.actor = actor; this.clips = clips; this.elapsed = 0; this.lastFrame = ''; this.ready = true;
      if (this.magePreviewEnabled && actor.family === 'mage' && /^adv[1-4]_mage_/.test(actor.id)) {
        this.mageSourceImages = new Map();
        const walkUrls = new Set(Object.values(actor.clips.walk).flatMap(c => c.frames.map(f => f.url)));
        for (const url of walkUrls) { this.mageSourceImages.set(url, images.get(url)); images.delete(url); }
      }
      if (this.thiefPreviewEnabled && /^adv[1-4]_thief_/.test(actor.id) && window.ThiefPreviewLocomotion?.supportsActor(actor)) {
        this.thiefSourceImages = new Map();
        const walkUrls = new Set(Object.values(actor.clips.walk).flatMap(c => c.frames.map(f => f.url)));
        for (const url of walkUrls) { this.thiefSourceImages.set(url, images.get(url)); images.delete(url); }
      }
      committed = true;
      window.CharacterSprites.activePortrait = actor.portrait;
      const doll = document.querySelector('.doll img'); if (doll) doll.src = actor.portrait;
      this.sprite.setOrigin(FOOT_X / TILE_W, FOOT_Y / TILE_H).setFlipX(false).setVisible(true);
      this.play('idle', initialDirection, true); this.update(0);
      document.querySelector('#topL .who b').textContent = actor.label;
      const portrait = new Image(); portrait.onload = () => {
        if (generation !== this.generation) return;
        const ctx = document.getElementById('pc').getContext('2d'); ctx.clearRect(0,0,112,112);
        const size = Math.min(portrait.width, portrait.height) * .5;
        ctx.drawImage(portrait, (portrait.width-size)/2, portrait.height*.03, size, size, 0,0,112,112);
      }; portrait.src = actor.portrait;
      parent.postMessage({type:'character-ready', id, label:actor.label}, location.origin);
      return true;
      } catch (error) {
        if (!isCurrent()) return false;
        this.ready = false; this.missing = 'load/' + id;
        throw error;
      } finally {
        images.forEach(bitmap => bitmap.close());
        if (!committed) newKeys.forEach(key => this.scene.textures.remove(key));
        if (this.loadController === controller) this.loadController = null;
      }
    }

    enableMagePreviewLocomotion() { this.magePreviewEnabled = true; return this; }
    isMagePreviewLocomotion() {
      return !!(this.ready && this.magePreviewEnabled && this.actor?.family === 'mage' && /^adv[1-4]_mage_/.test(this.actor.id) &&
        this.mageSourceImages?.size && window.MagePreviewLocomotion);
    }
    cancelMagePreviewMotion(releaseSources = false) {
      if (this.mageController || this.mageDynamicTexture) {
        this.mageController = null; this.magePoseActive = false; this.lastFrame = '';
        if (this.mageDynamicTexture) this.scene.textures.remove(this.mageDynamicTexture.key);
        this.mageDynamicTexture = null;
      }
      if (releaseSources && this.mageSourceImages) {
        this.mageSourceImages.forEach(image => image.close()); this.mageSourceImages = null;
      }
    }
    stepMagePreviewMotion(ms, moving, direction = this.desiredDirection) {
      if (!this.isMagePreviewLocomotion()) return null;
      if (!this.mageController) this.mageController = new window.MagePreviewLocomotion.Controller(this.actor, window.LayeredWalkRenderer, direction);
      const step = this.mageController.step(ms, {moving, direction});
      this.magePoseActive = !step.settled;
      // Neutral is rendered by the original idle atlas, whose equality is tested.
      this.play(step.settled ? 'idle' : 'walk', step.direction, false);
      return step;
    }
    drawMagePreviewPose() {
      if (!this.magePoseActive || !this.mageController) return false;
      const started = performance.now(), controller = this.mageController, p = controller.profile;
      const image = this.mageSourceImages?.get(p.frame.url);
      if (!image) throw Error('Mage preview source bitmap is unavailable');
      if (!this.mageDynamicTexture) {
        const canvas = document.createElement('canvas'); canvas.width = TILE_W; canvas.height = TILE_H; canvas.getContext('2d');
        const key = this.texturePrefix + '-mage-demo-' + this.generation;
        const texture = this.scene.textures.addCanvas(key, canvas);
        texture.add(0, 0, 0, 0, TILE_W, TILE_H);
        this.mageDynamicTexture = {key, canvas, texture};
      }
      const dynamic = this.mageDynamicTexture, ctx = dynamic.canvas.getContext('2d');
      ctx.clearRect(0, 0, TILE_W, TILE_H); ctx.save();
      ctx.translate(FOOT_X, FOOT_Y); ctx.scale(p.mirror * BODY / p.bodyHeight, BODY / p.bodyHeight);
      ctx.translate(0, -p.layer.ground);
      window.LayeredWalkRenderer.drawPose(ctx, {...p.layer, image, phase: controller.phase, motionScale: controller.amount()});
      ctx.restore(); dynamic.texture.refresh();
      this.sprite.anims.stop(); this.sprite.setTexture(dynamic.key, 0).setOrigin(FOOT_X / TILE_W, FOOT_Y / TILE_H);
      this.sprite.setScale(this.scene.scale.height * .20 / BODY).setFlipX(false);
      this.elapsed = controller.phase * p.cycleMs; this.lastFrame = dynamic.key + ':dynamic';
      this.mageRenderLastMs = performance.now() - started; this.mageRenderCount = (this.mageRenderCount || 0) + 1;
      return true;
    }

    // Opt-in is limited to supported thief actors; other families keep their existing playback.
    enableThiefPreviewLocomotion() { this.thiefPreviewEnabled = true; return this; }
    isThiefPreviewLocomotion() {
      return !!(this.ready && this.thiefPreviewEnabled && /^adv[1-4]_thief_/.test(this.actor?.id) && this.thiefSourceImages?.size &&
        window.ThiefPreviewLocomotion?.supportsActor(this.actor));
    }
    cancelThiefPreviewMotion(releaseSources = false) {
      if (this.thiefController || this.thiefDynamicTexture) {
        this.thiefController = null; this.thiefPoseActive = false; this.thiefRenderOptions = null; this.lastFrame = '';
        if (this.thiefDynamicTexture) this.scene.textures.remove(this.thiefDynamicTexture.key);
        this.thiefDynamicTexture = null;
      }
      if (releaseSources && this.thiefSourceImages) {
        this.thiefSourceImages.forEach(image => image.close()); this.thiefSourceImages = null;
      }
    }
    stepThiefPreviewMotion(ms, moving, direction = this.desiredDirection) {
      if (!this.isThiefPreviewLocomotion()) return null;
      if (!this.thiefController) this.thiefController = new window.ThiefPreviewLocomotion.Controller(this.actor, window.LayeredWalkRenderer, direction);
      const step = this.thiefController.step(ms, {moving, direction});
      this.thiefRenderOptions = this.thiefController.renderOptions();
      // Auto idle keeps the same rig neutral; manual commands explicitly cancel this pose.
      this.thiefPoseActive = true;
      this.play(step.settled ? 'idle' : 'walk', step.direction, false);
      return step;
    }
    drawThiefPreviewPose() {
      if (!this.thiefPoseActive || !this.thiefController || !this.thiefRenderOptions) return false;
      const started = performance.now(), controller = this.thiefController, p = controller.profile;
      const image = this.thiefSourceImages?.get(p.frame.url);
      if (!image) throw Error('Thief preview source bitmap is unavailable');
      if (!this.thiefDynamicTexture) {
        const canvas = document.createElement('canvas'); canvas.width = TILE_W; canvas.height = TILE_H; canvas.getContext('2d');
        const key = this.texturePrefix + '-thief-demo-' + this.generation;
        const texture = this.scene.textures.addCanvas(key, canvas);
        texture.add(0, 0, 0, 0, TILE_W, TILE_H);
        this.thiefDynamicTexture = {key, canvas, texture};
      }
      const dynamic = this.thiefDynamicTexture, ctx = dynamic.canvas.getContext('2d'), options = this.thiefRenderOptions;
      ctx.clearRect(0, 0, TILE_W, TILE_H); ctx.save();
      ctx.translate(FOOT_X, FOOT_Y); ctx.scale(p.mirror * BODY / p.bodyHeight, BODY / p.bodyHeight);
      ctx.translate(0, -(options.ground ?? 570));
      // Reuse the exact phase and motion amount that produced this tick's world displacement.
      window.LayeredWalkRenderer.drawPose(ctx, {...options, image});
      ctx.restore(); dynamic.texture.refresh();
      this.sprite.anims.stop(); this.sprite.setTexture(dynamic.key, 0).setOrigin(FOOT_X / TILE_W, FOOT_Y / TILE_H);
      this.sprite.setScale(this.scene.scale.height * .20 / BODY).setFlipX(false);
      this.elapsed = controller.phase * p.cycleMs; this.lastFrame = dynamic.key + ':dynamic';
      this.thiefRenderLastMs = performance.now() - started; this.thiefRenderCount = (this.thiefRenderCount || 0) + 1;
      return true;
    }

    face(dx, dy) { if (dx || dy) this.desiredDirection = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'); return this.desiredDirection; }
    play(action, direction = this.desiredDirection, restart = false) {
      this.desiredDirection = direction;
      if (!this.ready) return false;
      const clip = this.clips[action]?.[direction];
      if (!clip) { this.missing = action + '/' + direction; return false; }
      this.missing = null;
      if (this.action !== action || this.activeDirection !== direction || restart) this.elapsed = 0;
      if (action === 'attack' || action === 'death') this.cancelMagePreviewMotion();
      if (action !== 'walk') this.magePoseActive = false;
      if (action === 'attack' || action === 'death') this.cancelThiefPreviewMotion();
      if (action !== 'walk' && action !== 'idle') this.thiefPoseActive = false;
      this.action = action; this.activeDirection = direction;
      return true;
    }
    current() { return this.clips[this.action]?.[this.activeDirection]; }
    update(ms) {
      if (!this.ready) return;
      if (this.magePoseActive && this.action === 'walk' && this.drawMagePreviewPose()) return;
      if (this.thiefPoseActive && (this.action === 'walk' || this.action === 'idle') && this.drawThiefPreviewPose()) return;
      const clip = this.current(); if (!clip) return;
      this.elapsed += ms;
      let t = clip.loop ? this.elapsed % clip.duration : Math.min(this.elapsed, clip.duration - 1), frame = 0;
      while (frame < clip.durations.length - 1 && t >= clip.durations[frame]) t -= clip.durations[frame++];
      const signature = clip.key + ':' + frame;
      if (this.lastFrame !== signature) { this.sprite.anims.stop(); this.sprite.setTexture(clip.key, frame).setOrigin(clip.origin[0], clip.origin[1]); this.lastFrame = signature; }
      this.sprite.setScale(this.scene.scale.height * .20 / BODY).setFlipX(false);
    }
    duration(action, direction = this.desiredDirection) { return this.clips[action]?.[direction]?.duration || 0; }
    releaseDelay() {
      const direction = this.action === 'attack' ? this.activeDirection : this.desiredDirection;
      const c = this.clips.attack?.[direction]; if (!c) return 0;
      const marker = c.source.releaseFrame ?? c.source.hitFrame;
      if (Number.isInteger(marker) && marker >= 0 && marker < c.durations.length) return c.durations.slice(0, marker).reduce((a,b)=>a+b,0);
      if (Number.isFinite(c.source.releaseAtMs)) return Math.max(0, Math.min(c.duration, c.source.releaseAtMs));
      // Existing source clips without authored markers retain a timing estimate.
      return c.duration / 2;
    }
    releaseOrigin() {
      const direction = this.action === 'attack' ? this.activeDirection : this.desiredDirection;
      const clip = this.clips.attack?.[direction]?.source;
      const index = clip?.releaseFrame ?? clip?.hitFrame;
      const point = clip?.releaseAnchorPx, frame = clip?.frames?.[index];
      if (!frame || !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return null;
      return {x:(point[0]-frame.anchor[0])/frame.bodyHeight*(!!clip.mirrorX!==!!frame.mirrorX?-1:1),y:(point[1]-frame.anchor[1])/frame.bodyHeight};
    }
    destroy() { this.cancelMagePreviewMotion(true); this.cancelThiefPreviewMotion(true); ++this.generation; this.loadController?.abort(); this.loadController = null; this.ready = false; this.keys.forEach(key => this.scene.textures.remove(key)); this.keys = []; }
  }
  window.CharacterSprites = { Animator, catalog, clipGeometry };
  const toggle = window.UI.toggle;
  window.UI.toggle = function (id) { const result = toggle.call(this,id); const doll = document.querySelector('.doll img'); if(doll && window.CharacterSprites.activePortrait)doll.src=window.CharacterSprites.activePortrait; return result; };
})();
