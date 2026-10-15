"""Manual reviewed v3 source selection and anchors; never resample/paint alpha."""
import hashlib,json,shutil,subprocess
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[3];QA=ROOT/'docs/thief/art-B2';PY=r'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
specs={
'adv4_thief_B221_f':{'name':'暮光織影者','body':[154,58,370,487],'centers':[260,790,1290,260,800,1290,285,770,1280,285,780,1275],'anchors':[[350,285],[835,412],[1242,97],[409,678],[652,826],[1190,584],[401,231],[724,235],[1368,402],[390,780],[840,767],[1357,756]],'reason':'both daggers visibly curved in all poses, matching portrait'},
'adv4_thief_B221_m':{'name':'暮光織影者','body':[136,74,366,488],'centers':[250,785,1290,255,790,1290,280,770,1280,285,780,1280],'anchors':[[350,323],[887,367],[1198,128],[160,715],[896,873],[1195,595],[183,186],[721,221],[1422,373],[139,771],[854,769],[1385,697]],'reason':'both daggers visibly curved in all poses, matching portrait'},
'adv4_thief_B222_f':{'name':'黑月詭術師','body':[139,50,350,486],'centers':[245,785,1290,250,785,1290,285,770,1280,285,780,1280],'anchors':[[354,290],[897,327],[1214,101],[351,663],[811,905],[1420,620],[389,158],[720,175],[1455,352],[352,750],[841,766],[1410,750]],'reason':'full continuous black leather sleeves on both arms in every pose, matching portrait'},
}
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
entries=[]
for key,spec in specs.items():
 src=ROOT/'worker/art-production/thief-20261015/B2'/key;q=QA/key
 for n in ['attack-0-5','attack-6-11']:
  old=src/(n+'.png');rejected=src/(n+'-rejected-portrait-inconsistency.png')
  if not rejected.exists():shutil.copyfile(old,rejected)
  shutil.copyfile(src/(n+'-v3.png'),old)
  oldprompt=q/(n+'-prompt.txt');oldbackup=q/(n+'-rejected-portrait-inconsistency-prompt.txt')
  if not oldbackup.exists():shutil.copyfile(oldprompt,oldbackup)
  shutil.copyfile(q/(n+'-v3-prompt.txt'),oldprompt)
 frames=[]
 for i in range(12):
  j=i%6;x=(j%3)*512;y=(j//3)*512
  frames.append({'sourceRect':[x,y,x+512,y+512],'bodyCenterX':spec['centers'][i],'castAnchorPx':spec['anchors'][i]})
 alpha=Image.open(src/'attack-0-5.png').getchannel('A').crop((0,0,512,512)).point(lambda a:255 if a>=16 else 0).getbbox()
 # In these three neutral poses the alpha top/bottom are the visible hair/boot
 # pixels (all magic is beside the hands), confirmed visually; include their edge pixels.
 spec['body'][1]=alpha[1];spec['body'][3]=alpha[3]
 dx=320-spec['centers'][0];dy=600-alpha[3];b=spec['body'];body=[b[0]+dx,b[1]+dy,b[2]+dx,b[3]+dy]
 layout={'releaseFrameIndex':6,'skillKind':'mirror','neutralBodyBoundsPx':body,'frames':frames,'manualReview':'v3 portrait consistency repair: '+spec['reason']}
 (q/'layout.json').write_text(json.dumps(layout,ensure_ascii=False,indent=2),encoding='utf-8')
 subprocess.run([PY,str(ROOT/'worker/scripts/pack-thief-assets.py'),'--key',key,'--name',spec['name'],'--gender',key[-1],'--class-path',key.split('_')[-2],'--hero',str(src/'hero.png'),'--first',str(src/'attack-0-5.png'),'--last',str(src/'attack-6-11.png'),'--layout',str(q/'layout.json'),'--source-dir',str(src.relative_to(ROOT)),'--qa-dir',str(q.relative_to(ROOT))],cwd=ROOT,check=True)
 frag=json.loads((q/'fragment.json').read_text(encoding='utf-8'));pack=json.loads((q/'native-pack.json').read_text(encoding='utf-8'))
 atlas=Image.open(ROOT/'worker/public/art/thief-20261015'/key/'character.png').convert('RGBA')
 for label,color in [('dark',(24,24,42,255)),('light',(244,244,248,255))]:
  bg=Image.new('RGBA',atlas.size,color);bg.alpha_composite(atlas);bg.convert('RGB').save(q/f'qa-{label}.jpg',quality=90)
 review={'key':key,'authorVisualReview':'pass-v3-portrait-consistency','rootVisualReview':'pending','rootAccepted':False,'runtimeActualEventVerified':False,'reason':spec['reason'],'manualBodySourceBounds':b,'neutralBodyBoundsPx':body,'heightScale':frag['animation']['heightScale'],'checks':{'allTwelvePosesOriginal':True,'twoHandsTwoBlades':True,'fullHeadFeetTips':True,'transparentRectangularGutters':True,'weaponsMatchPortrait':True,'sleevesMatchPortrait':True,'noResamplingOrAlphaEditing':True},'prompts':{n:{'file':(q/(n+'-prompt.txt')).relative_to(ROOT).as_posix(),'SHA256':sha(q/(n+'-prompt.txt'))} for n in ['hero','attack-0-5','attack-6-11']},'sourceSHA256':pack['sources'],'supersededSources':[{ 'file':p.relative_to(ROOT).as_posix(),'SHA256':sha(p),'reason':'earlier candidate before portrait/gutter corrections'} for p in sorted(src.glob('*-v2.png'))]+[{'file':p.relative_to(ROOT).as_posix(),'SHA256':sha(p),'reason':'original weapon or sleeve mismatch'} for p in sorted(src.glob('*-rejected-portrait-inconsistency.png'))]}
 if (q/'visual-review.json').exists():
  previous=json.loads((q/'visual-review.json').read_text(encoding='utf-8'))
  if previous.get('sourceSHA256')==pack['sources'] and previous.get('neutralBodyBoundsPx')==body:
   for field in ['rootAccepted','rootVisualReview','rootReviewNote','rootReviewedAt']:
    if field in previous:review[field]=previous[field]
 (q/'visual-review.json').write_text(json.dumps(review,ensure_ascii=False,indent=2),encoding='utf-8');entries.append({'key':key,'fragment':(q/'fragment.json').relative_to(ROOT).as_posix(),'sourceSHA256':pack['sources'],'outputSHA256':pack['outputs'],'rootAccepted':False,'reason':spec['reason']})
report={'status':'native-pack-pass-awaiting-root-review','repairedIdentities':entries,'unchangedMaleB222':{'key':'adv4_thief_B222_m','rootAccepted':False,'authorVisualReview':'pass','reason':'portrait has rolled sleeves with exposed elbow above bracer; all 12 poses preserve the same rolled-sleeve cut and silver crescent straight dagger guards. Female full-length sleeves are a different identity, not the male reference.'},'registryChanged':False,'appChanged':False}
(QA/'portrait-consistency-repair.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'repaired':len(entries),'status':'PASS','rootReview':'pending'}))
