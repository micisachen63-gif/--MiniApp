import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=process.cwd(),base=path.join(root,'docs/thief/visual-main'),manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'))),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
// These observations were recorded after manual inspection of each displayed
// dark/light preview and all 12 native frames, not inferred from native-pack PASS.
const observations={
 thief_f:['海軍藍希臘紋短披肩、棕黑輕皮甲與銀色雙短刃；臉型與捲髮延續試作母系。','第3/4格短刺、第5/6格交錯刀光、第8至11格收勢可辨，雙腳與刀尖完整。'],
 thief_m:['男性捲髮與鬍鬚、單肩藍披布及露臂皮甲一致；與女版共享材質畫風而非誤用女圖。','起手低刀、前刺與交叉收勢連貫，兩手持刃可辨，身形維持輕裝近戰。'],
 A_f:['酒紅披布與金色希臘邊紋清楚區隔基礎藍版，女性面孔與髮色延續。','兩把銀匕首、交錯白藍光與短刺姿勢保持一致，皮甲與腰帶細節延續12格。'],
 A_m:['酒紅單肩披布、金邊及雙銀匕首與男版原畫一致；男性臉孔與手臂比例自然。','低重心起手、短刺與交錯刀光完整，收勢保留雙刀，未見切掉靴底或額外肢體。'],
 B_f:['青藍短披肩與胸前備用投刃帶可辨；備刃屬裝備配件，未見多手或漂浮武器錯誤。','藍白刃尖與迴旋弧線區隔刺客紅系，投刃動作與12格衣裝一致。'],
 B_m:['青藍單肩披布、胸前備刃與男版露臂輕甲一致；男女性別身份清楚。','第6/7格的伸臂投刃與手中剩餘短刃可辨，備刃沒有變成大劍或法杖。'],
 A1_f:['藍紫披布、紫色寶石月桂扣與銀色雙匕首，紫色影刃從原畫延續至12格。','短刺與第6格紫色刀弧完整，人物仍是輕皮甲刺客，沒有法師袍、翅膀或重甲。'],
 A1_m:['男版藍紫披布與紫色扣飾、銀紋雙刀可辨；臉孔和棕黑皮甲材質一致。','兩個前刺、交叉影刃與回身收勢輪廓明確，深淺底未見矩形殘底。'],
 A11_f:['銀月扣、暗紫單肩短披風與尖片腰甲構成獨立高轉造型；女版面孔與母系一致。','第6格交叉紫弧、第7/8格回身與末段低刀收勢可辨，手部與刀尖完整。'],
 A11_m:['暗紫月扣短披布、銀邊窄護腕與三角腰片一致；男版露臂輪廓與女版有清楚差別。','第7格寬幅雙刀完整；經核准的左19/右20px邊界沒有造成視覺裁刀，收勢比例自然。'],
 A111_f:['雙肩月相披片、銀色月相飾鏈和短立領與母系月扣版有明確差別。','銀紋短匕與紫色弧光一致，12格服裝保持月相飾鏈，起手與末段站姿相近。'],
 A111_m:['雙肩月相披片、銀鍊、短領皮衣與男版面孔一致，銀色細節仍維持輕甲輪廓。','第3格有反手向左伸臂動作，後段有自然屈膝；頭腳完整，靜態可接受但應確認動態朝向與銜接。'],
 A112_f:['斷環扣飾、幾何胸帶與單側尖角紫披布清楚區別月相裁決者；雙刃仍為完整短刀。','交叉紫弧與回身短刺可辨，刀刃的斷紋是紋飾，未見斷裂浮刃或缺手。'],
 A112_m:['男版斷環、幾何胸帶與尖片腰甲在12格持續出現；黑皮革與銀邊材質一致。','回身與收勢短刃完整，深淺底輪廓連續，沒有把披布誤畫成大翅膀。'],
 A2_f:['森林綠短兜肩、蛇扣與腰間毒瓶和綠色毒刃一致；保留女性母系面孔。','綠色刀光附著在雙刃動作，起手、交叉命中與收勢可辨，沒有大片毒霧遮臉。'],
 A2_m:['森林綠肩布、蛇扣、腰瓶及男性輕甲輪廓一致，毒光局限於雙短刃。','蹲身、前刺、交錯毒弧與末段收刀完整，沒有多手、裁腳或誤用其他性別圖片。'],
 A21_f:['斜肩綠披片、胸前毒瓶帶與分叉短圍片，明確區隔母系綠兜肩，曲刃辨識清楚。','綠色細弧與藥瓶配件持續出現，前刺及交叉釋放完整，人物沒有變成持杖藥師。'],
 A21_m:['男版露臂、三瓶斜帶與綠色斜肩皮甲一致，波紋短刃與毒液局部細節清楚。','第7格以透明間隙分離後，左右刀尖與毒滴完整，無鄰格武器混入。'],
 A22_f:['酒紅棘紋肩披、橄欖拼片與鉤形短刃可辨，毒瓶和綠刃區隔普通紅系刺客。','12格棘刺護腕與紅披布一致，綠色刀弧保持局部，不遮住臉與手。'],
 A22_m:['酒紅短披、棘紋護腕與綠色鉤刃在男版原畫和12格一致，男性輪廓自然。','低重心突刺、交錯毒刃與回身收勢可辨，衣甲未增加成重裝騎士。'],
 A211_f:['深綠蛇紋短披與多枚蛇形扣件、蛇鏈腰帶，比煉師更精細但仍是輕裝雙刃。','綠色蛇刃弧線與肩部蛇紋延續，頭髮、手部、刀尖與靴子完整。'],
 A211_m:['深綠蛇扣披肩、蛇鏈與短毒刃在男版維持一致，銀青毒光沒有改成法師大法陣。','長前刺刀光保留完整，未見鄰格靴子混入，收勢的兩刃與蛇形裝飾可辨。'],
 A212_f:['黑色短皮衣、深綠半兜肩、暗紫內襯與雙色蛇刃清楚區隔深綠九首版。','一側紫光、另一側綠光的短刃延續12格；衣尾短而輕，沒有死靈法師袍。'],
 A212_m:['男版黑短衣與綠兜肩、紫內襯和蛇扣一致，面孔延續母系。','紫綠兩刃及交錯刀弧完整，前刺與回身可辨，靴底與手部沒有裁切。'],
 A221_f:['深紅月桂棘邊披肩、多扣腰帶和毒瓶構成血棘高轉服裝，保持女版母系面孔。','紅金披布與綠刃在12格一致；與A22同紅系但月桂邊和多扣腰帶有區別。'],
 A221_m:['男版深紅月桂邊、三扣腰帶與雙短刃一致，沒有冠冕、大披袍或重甲。','前刺、交叉毒弧與收勢完整；紅金細節與綠刃形成清楚職業色彩。'],
 A222_f:['煙黑短皮衣、紫色短肩披與淡綠符扣，雙刃仍是短匕而非鐮刀。','紫綠刀刃及腰衣輪廓在12格一致，魂紋僅是局部裝飾，未變成法師大光圈。'],
 A222_m:['男版煙黑皮衣與紫肩披、魂紋扣和雙刃一致；身形精瘦，沒有死神長袍。','綠色釋放刀弧與紫色細節保持局部，回身與收勢有完整兩手兩腳。']
};
const explicitKeys=new Set(['thief_f','thief_m',...['A','B','A1','A11','A111','A112','A2','A21','A22','A211','A212','A221','A222'].flatMap(p=>['f','m'].map(g=>`adv${p.length}_thief_${p}_${g}`))]);
const reviews=[];for(const e of manifest.entries){if(!explicitKeys.has(e.key))throw Error('Unreviewed key '+e.key);for(const [rel,digest]of Object.entries(e.sourceSHA256))if(sha(path.join(root,rel))!==digest)throw Error('Asset changed since inspection: '+rel);if(sha(path.join(root,e.preview))!==e.previewSHA256)throw Error('Preview drift '+e.key);
 const id=e.classPath?`${e.classPath}_${e.gender}`:e.key,findings=observations[id];if(!findings)throw Error('No individual findings '+id);
 const rawGroup=e.group==='art-base'?null:e.group==='art-base-adv1'?'base-adv1':e.group==='art-A1'?'A1':e.group==='art-A1-left'?'A1-left':'A2',raw=path.join(root,'worker/art-production/thief-20261015',...(rawGroup?[rawGroup,e.key]:[e.key]));const rawSHA={};for(const name of ['hero.png','attack-0-5.png','attack-6-11.png'])rawSHA[path.relative(root,path.join(raw,name)).replaceAll('\\','/')]=sha(path.join(raw,name));
 const tracked=e.key==='adv4_thief_A111_m'?[{severity:'low',finding:'第3格反手向左、末段屈膝，站姿末段/起手頭腳高度約0.939；靜態輪廓完整。',next:'全場景矩陣確認朝敵方向、釋放點與收勢銜接，不因本人工驗收推定runtime通過。',status:'runtime-review-pending'}]:[];
 const review={schemaVersion:1,key:e.key,classPath:e.classPath,gender:e.gender,name:e.name,reviewDate:'2026-10-16',reviewer:'/root/thief_frontend',manualVisualAccepted:true,acceptanceScope:'manual-art-only',runtimeVerified:false,actualEventVerified:false,qualityBand:tracked.length?'達共同標準；低風險動態追蹤':'達共同美術標準',method:'逐份人工查看真原畫／原生12格與Chromium在深色#111827及淺色#f1ede3底的實際像素預覽；自製預覽僅閱讀公開素材，未改圖。未用native PASS代替目視。',checks:{genderAndFace:{passed:true,detail:findings[0]},outfitAndWeaponsAcross12Frames:{passed:true,detail:findings[1]},sharedPaintedGreekStyle:{passed:true,detail:'自然成人比例、皮革／布料／金屬材質和母系一致，短披布與雙刃維持輕裝職業。'},completeSilhouette:{passed:true,detail:'逐格看過頭髮、手臂、刀尖與靴底，未見缺肢、硬裁人物或鄰格殘片。'},transparentCutoutOnDarkAndLight:{passed:true,detail:'兩種實際底色均未見矩形底圖、棋盤格殘底或明顯異色邊；發光區為局部刀光。'},standingProportions:{passed:true,detail:tracked.length?'收勢略屈膝，留動態追蹤；無明顯拉伸壓扁。':'起手／收勢成人身形自然，無明顯拉伸、壓扁或不同性別套圖。'},normalSkillVisualDistinction:{passed:true,detail:'在實際RpgThiefFX.draw phase0.56比較basic與skill：普攻較小，技能有交叉弧／處刑標記／多飛刃／毒紋。兩者共用同一12格原生動畫，沒有聲稱是兩套獨立原生格帶。',scope:'static-renderer-impact-phase-only'}} ,findings,trackedItems:tracked,evidence:{preview:e.preview,previewSHA256:e.previewSHA256,outputSHA256:e.sourceSHA256,sourceSHA256:rawSHA,fxSHA256:e.fxSHA256,sourcePixelsChangedDuringReview:false},remainingVerification:['正式場景欄位比例與天使間距','真普攻/技能事件、1.8攻速、完整12格、切場清場及reduced-motion由root矩陣驗證']};if(e.key==='adv3_thief_A11_m')review.findings.push('已目視具名例外第7格的寬幅短刃：左19/右20px透明邊界，刀尖完整；不影響其餘20px規則。');
 const file=path.join(root,e.reviewFile);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(review,null,2));reviews.push({...review,reviewFile:e.reviewFile});}
if(reviews.length!==28)throw Error('Expected28');
const primary=reviews.filter(r=>!r.reviewFile.includes('/art-A2/')),a2=reviews.filter(r=>r.reviewFile.includes('/art-A2/'));
function summary(name,items){const data={reviewDate:'2026-10-16',scope:'manual-art-only',manualVisualAccepted:items.every(x=>x.manualVisualAccepted),runtimeVerified:false,count:items.length,criticalVisualFindings:0,trackedItems:items.flatMap(x=>x.trackedItems.map(t=>({key:x.key,...t}))),qualityStandard:['同一希臘半寫實成人畫風','男女身份與服裝武器在原畫/12格一致','完整輪廓與深淺底乾淨透明','自然站姿與輕裝雙刃','普技由實際FX層區分，非兩套原生格帶'],entries:items.map(r=>({key:r.key,name:r.name,gender:r.gender,qualityBand:r.qualityBand,manualVisualAccepted:r.manualVisualAccepted,runtimeVerified:false,findings:r.findings,reviewFile:r.reviewFile,preview:r.evidence.preview,outputSHA256:r.evidence.outputSHA256,sourceSHA256:r.evidence.sourceSHA256}))};fs.writeFileSync(path.join(base,name+'.json'),JSON.stringify(data,null,2));const lines=['# '+(name==='priority-14'?'基礎／初階／影襲與夜幕左枝 14 身份':'毒刃家族 14 身份')+'人工美術驗收','','人工目視通過 '+items.length+'／'+items.length+'。此結論僅涵蓋原畫、12 格與深淺底靜態刀光；實際場景與事件仍由主窗矩陣驗證。','','| 身份 | 品質 | 具體觀察 |','| --- | --- | --- |',...items.map(r=>'| '+r.key+' | '+r.qualityBand+' | '+r.findings.join(' ')+' |'),'','原生格帶為普攻／技能共用；技能差異來自實際 FX 層。淺底發光色較淡，未見殘底。所有查驗 SHA、預覽與逐角色結論見同名 JSON。'];if(data.trackedItems.length)lines.push('','低風險追蹤：A111 男第 3 格反手向左、末段屈膝，確認動態朝向／銜接。');fs.writeFileSync(path.join(base,name+'.md'),lines.join('\n'));}
summary('priority-14',primary);summary('A2-14',a2);fs.writeFileSync(path.join(base,'manual-review-index.json'),JSON.stringify({reviewDate:'2026-10-16',scope:'manual-art-only',manualVisualAccepted:true,runtimeVerified:false,count:28,criticalVisualFindings:0,lowRiskTrackedIdentities:['adv4_thief_A111_m'],groups:['docs/thief/visual-main/priority-14.json','docs/thief/visual-main/A2-14.json'],reviews:reviews.map(r=>({key:r.key,manualVisualAccepted:r.manualVisualAccepted,reviewFile:r.reviewFile,preview:r.evidence.preview}))},null,2));console.log(JSON.stringify({perKeyReviews:reviews.length,priority:primary.length,A2:a2.length,manualVisualAccepted:true,runtimeVerified:false}));
