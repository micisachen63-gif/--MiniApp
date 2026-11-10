/* Exact opt-in for the root-reviewed B111 female RIGHT companion repair.
   Original atlas and generated companion pixels are never modified. */
(() => {
  'use strict';
  const ACTOR = 'adv4_archer_B111_f';
  const BASE_SHA = '4cf1db3151f26bab0e1adffb479ba281f9198c645cc035b0c89092d147720660';
  const BIRD_SHA = '7760f2c65556566205e0d6be0dc424c70fac329064f384ab4b79c0288923ee26';
  const CONFIG_SHA = 'b282a8bfe4b608c84cc14c7bcdc66b200cebca59537d60b1b21ce2de127316f3';
  const REVIEW_SHA = 'ffd26b55d362c56e52f5f225b3ce46b34729785a43cc35d062c38726b08ef6e9';
  const BASE_URL = '/ui-generated-20261030/characters-v1/assets/adv4_archer_B111_f-hero_adv4_archer_B111_f_attack-4cf1db3151f2.webp';
  const BIRD_URL = '/ui-generated-20261030/characters-v1/assets/adv4_archer_B111_f-shoulder-bird-v1-7760f2c65556.png';
  const SCHEMA = 'b111-f-shoulder-companion-attachment-v2';
  const EXPECTED_PLACEMENTS = [{"sourceFrameIndex":0,"enabled":false,"bakedInBase":true,"shoulderAnchor":[244.5,576.5],"rotationRad":0,"zOrder":"original-baked-bird","foregroundOccluders":[]},{"sourceFrameIndex":1,"enabled":true,"bakedInBase":false,"shoulderAnchor":[246,576],"rotationRad":0,"zOrder":"in-front-of-base","foregroundOccluders":[]},{"sourceFrameIndex":2,"enabled":true,"bakedInBase":false,"shoulderAnchor":[243,566],"rotationRad":0,"zOrder":"in-front-of-base","foregroundOccluders":[[[239,538],[241,535],[245,533],[249,531],[254,529],[260,528],[267,529],[277,531],[277,548],[272,550],[268,552],[265,554],[261,555],[257,554],[252,552],[247,550],[243,547],[240,543]]]},{"sourceFrameIndex":3,"enabled":true,"bakedInBase":false,"shoulderAnchor":[217,559],"rotationRad":0,"zOrder":"in-front-of-base","foregroundOccluders":[[[185,527],[188,524],[193,522],[197,520],[202,518],[207,517],[212,516],[217,517],[224,519],[232,521],[240,523],[251,524],[251,558],[246,557],[240,555],[233,553],[226,551],[219,548],[213,545],[207,543],[201,540],[196,537],[191,534],[187,532]]]},{"sourceFrameIndex":4,"enabled":true,"bakedInBase":false,"shoulderAnchor":[218,568],"rotationRad":0,"zOrder":"in-front-of-base","foregroundOccluders":[[[166,548],[169,545],[173,541],[178,537],[184,534],[191,531],[200,528],[209,526],[218,523],[223,522],[225,529],[223,532],[217,534],[211,538],[205,541],[198,546],[190,551],[182,555],[175,556],[170,554],[166,551]],[[224,522],[229,519],[233,516],[235,516],[236,519],[240,520],[242,524],[242,528],[237,530],[231,529],[226,530]],[[232,519],[235,515],[239,512],[243,509],[246,506],[248,505],[249,505],[248,508],[245,511],[241,515],[238,518],[235,521]],[[235,518],[240,516],[247,515],[253,515],[255,515],[255,517],[249,518],[241,520],[236,522]],[[235,521],[241,520],[247,521],[252,523],[253,524],[251,525],[245,523],[239,523],[235,524]],[[233,524],[238,524],[243,527],[248,529],[249,530],[247,531],[242,529],[237,527],[233,527]]]},{"sourceFrameIndex":5,"enabled":true,"bakedInBase":false,"shoulderAnchor":[246,576],"rotationRad":0,"zOrder":"in-front-of-base","foregroundOccluders":[]},{"sourceFrameIndex":6,"enabled":true,"bakedInBase":false,"shoulderAnchor":[249,580],"rotationRad":0,"zOrder":"in-front-of-base","foregroundOccluders":[]},{"sourceFrameIndex":7,"enabled":false,"bakedInBase":true,"shoulderAnchor":[244.5,576.5],"rotationRad":0,"zOrder":"original-baked-bird","foregroundOccluders":[]}];
  const CHECKS = ['identityVerified','perchContactVerified','armHairArmorOcclusionVerified',
    'allEightFramesReviewed','transitionContinuityVerified','combinedCanvasBoundsVerified',
    'singleBirdScaleVerified','baseBytesUnchanged'];
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k,stable(value[k])])) : value;
  const exact = (a,b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  const requireValue = (ok,message) => { if (!ok) throw Error('Companion overlay: '+message); };
  function validateSpec(actor,action,direction,source) {
    const c=source.companionAttachment;
    if(c==null)return null;
    requireValue(actor.id===ACTOR && actor.family==='archer' && action==='attack' && direction==='right','explicit B111 female attack.right scope required');
    requireValue(c.schema===SCHEMA && c.actorId===ACTOR && c.slot==='attack.right','schema or scope mismatch');
    requireValue(c.candidateAccepted===true && c.approved===false && c.evaluationOnly===false &&
      c.runtimeAcceptanceIncluded===false,'candidate review required; final art approval remains false');
    requireValue(c.sourceClassification==='mixed-native-atlas-and-generated-companion' &&
      c.baseSourceSha256===BASE_SHA && c.baseUrl===BASE_URL && c.attachmentConfigSha256===CONFIG_SHA,'exact mixed sources and reviewed configuration required');
    const m=actor.mixedSourceReviewPolicy;
    requireValue(m?.policyId==='archer-b111-f-reviewed-companion-repair-v1' &&
      m.candidateAccepted===true && m.runtimeAcceptanceIncluded===false &&
      exact(m.publishedCandidateSlots,['attack.right']) && m.rootReviewEvidence?.sha256===REVIEW_SHA,'mixed source policy is missing');
    requireValue(source.status==='reviewed-mixed-source-companion-candidate' && source.directionVerified===true &&
      source.anatomicalScaleVerified===true && source.verifiedForCoreCoverage===true &&
      source.sourceFacing==='right' && source.bodyHeight===390 && !source.mirrorX &&
      source.nativeFrameCount===8 && source.playableFrameCount===8 &&
      exact(source.sourceFrameSequence,[0,1,2,3,4,5,6,7]),'native RIGHT and fixed registration required');
    requireValue(!Object.hasOwn(source,'releaseFrame') && !Object.hasOwn(source,'releaseTimeMs') &&
      !Object.hasOwn(source,'canvasWidthPx') && !Object.hasOwn(source,'canvasHeightPx'),'no added release event or changed canvas');
    requireValue(Array.isArray(source.frames)&&source.frames.length===8,'eight original frames required');
    source.frames.forEach((f,i)=>requireValue(f.url===BASE_URL && f.sourceFrameIndex===i &&
      exact(f.rect,[(i%4)*640,Math.floor(i/4)*960,640,960]) &&
      exact(f.anchor,[287,900]) && f.bodyHeight===390 && f.durationMs===125 &&
      !f.mirrorX && !f.sourceLayers && !f.sourceClipPolygon && !f.render,'original source cells and timing required'));
    const b=c.bird;
    requireValue(b?.url===BIRD_URL && b.sha256===BIRD_SHA && b.width===1254 && b.height===1254 &&
      exact(b.rect,[0,0,1254,1254]) && exact(b.talonPivot,[655.5,862.5]) &&
      b.uniformScaleToBase===0.082,'one unchanged 1254 source, fixed talon pivot and 0.082 scale required');
    requireValue(exact(c.placements,EXPECTED_PLACEMENTS),'placements or exact reviewed limb contours changed');
    const r=c.review;
    requireValue(r?.acceptedByRoot===true && r.rootReviewSha256===REVIEW_SHA &&
      r.birdSourceSha256===BIRD_SHA && r.baseSourceSha256===BASE_SHA &&
      r.attachmentConfigSha256===CONFIG_SHA && CHECKS.every(k=>r[k]===true),'source-bound root visual review required');
    return c;
  }
  function collectUrls(actor) {
    const urls=[];
    for(const [action,directions]of Object.entries(actor.clips))
      for(const [direction,source]of Object.entries(directions)){
        const c=validateSpec(actor,action,direction,source);if(c)urls.push(c.bird.url);
      }
    return [...new Set(urls)];
  }
  function draw(ctx,c,frame,index,images,baseScale,zOrder) {
    if(!c)return;
    const p=c.placements[index];
    if(!p.enabled||p.zOrder!==zOrder)return;
    requireValue(baseScale===300/390 && exact(frame.anchor,[287,900]),'fixed human projection required');
    const b=c.bird,bitmap=images.get(b.url),base=images.get(c.baseUrl);
    requireValue(bitmap?.width===1254 && bitmap.height===1254 && base?.width===2560 && base.height===1920,'loaded source dimensions changed');
    ctx.save();
    ctx.translate((p.shoulderAnchor[0]-287)*baseScale,(p.shoulderAnchor[1]-900)*baseScale);
    const scale=baseScale*b.uniformScaleToBase;
    ctx.scale(scale,scale);
    ctx.drawImage(bitmap,...b.rect,-b.talonPivot[0],-b.talonPivot[1],b.rect[2],b.rect[3]);
    ctx.restore();
    if(p.foregroundOccluders.length){
      requireValue(typeof window.LayeredWalkRenderer?.drawPaintedFrame==='function','existing sourceClipPolygon renderer required');
      window.LayeredWalkRenderer.drawPaintedFrame(ctx,{image:base,scale:baseScale,
        frame:{sourceLayers:p.foregroundOccluders.map(poly=>({rect:frame.rect,anchor:frame.anchor,sourceClipPolygon:poly}))}});
    }
  }
  window.ReviewedCompanionOverlay=Object.freeze({version:SCHEMA,validateSpec,collectUrls,draw});
})();

