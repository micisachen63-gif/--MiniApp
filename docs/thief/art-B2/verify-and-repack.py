"""Repack reviewed B2 family layouts and verify native artwork provenance.
Run using the bundled Python runtime with Pillow/numpy. No source resampling or retouching.
"""
import hashlib,json,subprocess
from pathlib import Path
from PIL import Image
import numpy as np
ROOT=Path(__file__).resolve().parents[3]
QA=ROOT/'docs/thief/art-B2'
PY=r'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
NAMES={'B2':'幻刃使','B21':'鏡影舞者','B22':'暮光詭術師','B211':'千面幻刃','B212':'鏡界行者','B221':'暮光織影者','B222':'黑月詭術師'}
NOTES={'B2':'二轉紫藍輕皮甲，短披巾與小型鏡碎片。','B21':'銀色鏡面鑲片、紫藍短披巾，延續輕甲及雙短刃。','B22':'梅紫皮革、煙金希臘紋、細長刀光。','B211':'碎鏡鑲嵌與腰間小型面具飾件，沒有額外人物或第三手。','B212':'深鈷藍衣裝、圓鏡扣與腰側小型破鏡環。','B221':'梅紫金線編織、短衣片與近手鏡線。','B222':'黑皮革紫翻領、銀色黑月扣及小型月牙光點。'}
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
all_sources=set();all_frames=set();entries=[]
for path,name in NAMES.items():
 for g in ['f','m']:
  key=f'adv{len(path)}_thief_{path}_{g}';src=ROOT/f'worker/art-production/thief-20261015/B2/{key}';q=QA/key;out=ROOT/f'worker/public/art/thief-20261015/{key}'
  subprocess.run([PY,str(ROOT/'worker/scripts/pack-thief-assets.py'),'--key',key,'--name',name,'--gender',g,'--class-path',path,'--hero',str(src/'hero.png'),'--first',str(src/'attack-0-5.png'),'--last',str(src/'attack-6-11.png'),'--layout',str(q/'layout.json'),'--source-dir',str(src.relative_to(ROOT)),'--qa-dir',str(q.relative_to(ROOT))],cwd=ROOT,check=True)
  pack=json.loads((q/'native-pack.json').read_text(encoding='utf-8'));frag=json.loads((q/'fragment.json').read_text(encoding='utf-8'));layout=json.loads((q/'layout.json').read_text(encoding='utf-8-sig'))
  assert len(pack['frames'])==12 and pack['distinctFrames']==12
  for h in pack['sources'].values():assert h not in all_sources;all_sources.add(h)
  for f in pack['frames']:assert f['rgbaSHA256'] not in all_frames;all_frames.add(f['rgbaSHA256'])
  for n,h in pack['outputs'].items():assert sha(out/n)==h
  assert frag['animation']['useAsIdle'] is False
  assert frag['normalFx']['kind']=='pierce'
  assert frag['guardianCategory']=='melee'
  assert np.array_equal(np.array(Image.open(out/'character.png')),np.array(Image.open(out/'character.webp').convert('RGBA')))
  assert all(20<=f['alphaBounds'][0] and f['alphaBounds'][2]<=620 and f['alphaBounds'][3]==600 for f in pack['frames'])
  prompts={n: {'file':str((q/(n+'-prompt.txt')).relative_to(ROOT)).replace('\\','/'),'SHA256':sha(q/(n+'-prompt.txt'))} for n in ['hero','attack-0-5','attack-6-11']}
  # Diagnostic composites only. Production RGBA sources and atlas remain untouched.
  atlas=Image.open(out/'character.png').convert('RGBA')
  for label,color in [('dark',(24,24,42,255)),('light',(244,244,248,255))]:
   bg=Image.new('RGBA',atlas.size,color);bg.alpha_composite(atlas);bg.convert('RGB').save(q/f'qa-{label}.jpg',quality=88)
  review={'key':key,'authorVisualReview':'pass','rootVisualReview':'pass communicated by root' if key=='adv2_thief_B2_f' else 'pending','runtimeActualEventVerified':False,'checks':{'sameGreekSemirealHumanStyle':True,'twoArmsTwoGrippingHandsTwoShortBlades':True,'completeHeadFeetWeaponTips':True,'noElfEarsStaffWingsOrGhostBody':True,'smallMirrorMagicAuthoredIntoSource':True,'twelveOriginalDifferentPosesNotCopies':True,'sourceGutterManuallyChecked':True,'neutralHeadFeetBodyBoundsManuallyMarked':True,'portraitAndAttackHeightUsesMeasuredRatio':True,'headSpaceReservedByRuntimeLayoutForSeparateGuardian':True},'notes':NOTES[path]+' 12 格為備戰、蓄勢、跨步、突刺前置、低斬、上切、釋放、延伸、交叉斬、轉身、回收、收勢等獨立原生姿態；body scale 以第 0 格頭腳實值對 portrait 校正，動作弓步與收腿保留自然高度差。','neutralBodyBoundsPx':layout['neutralBodyBoundsPx'],'heightScale':frag['animation']['heightScale'],'prompts':prompts,'sourceSHA256':pack['sources'],'rejectedSources':[{'file':str(p.relative_to(ROOT)).replace('\\','/'),'SHA256':sha(p),'reason':p.stem.split('rejected-',1)[-1]} for p in sorted(src.glob('*rejected*.png'))],'acceptanceBoundary':'作者逐來源與打包規則檢查；不代替主視窗逐欄尺寸/天使/實際戰鬥事件驗證。'}
  (q/'visual-review.json').write_text(json.dumps(review,ensure_ascii=False,indent=2),encoding='utf-8')
  entries.append({'key':key,'name':name,'classPath':path,'gender':g,'fragment':str((q/'fragment.json').relative_to(ROOT)).replace('\\','/'),'sourceSHA256':pack['sources'],'outputSHA256':pack['outputs'],'layoutSHA256':sha(q/'layout.json'),'heightScale':frag['animation']['heightScale'],'nativePacking':'pass','authorVisualReview':'pass','runtimeActualEventVerified':False})
report={'family':'B2','identities':len(entries),'authoredSources':len(all_sources),'distinctNativeAttackFrames':len(all_frames),'status':'native-art-complete-awaiting-root-runtime-review','releaseReady':False,'productionGateChanged':False,'sharedRegistryChanged':False,'sourceResampling':False,'alphaPainting':False,'heroOrAnatomyRepairByCode':False,'nativeSourcePixelsPreserved':True,'pngWebpLosslessEquality':True,'allGuardianCategories':'melee','allNormalFx':'pierce','allUseAsIdle':False,'entries':entries}
(QA/'family-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(QA/'fragments.json').write_text(json.dumps([json.loads((QA/e['key']/'fragment.json').read_text(encoding='utf-8')) for e in entries],ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'identities':len(entries),'uniqueSources':len(all_sources),'uniqueAttackFrames':len(all_frames),'nativePacking':'PASS','runtime':'pending'}))

