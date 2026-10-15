"""Build reviewed A2 source rectangles using transparent gutters only.
All anatomical torso centers, blade-hand anchors and neutral body bounds are
manually recorded from source inspection; no resizing or pixel edits occur.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[3]
def layout(key, centers, anchors, body):
 frames=[]
 for half,source in enumerate(['attack-0-5.png','attack-6-11.png']):
  image=Image.open(ROOT/'worker/art-production/thief-20261015/A2'/key/source)
  assert image.size==(1536,1024)
  alpha=np.array(image.getchannel('A'))>=8
  rows=np.where(~alpha.any(axis=1))[0]
  middle=[y for y in rows if 450<=y<=575]
  assert middle, (key,source,'No separating row gutter')
  y=int(min(middle,key=lambda y:abs(y-512)))
  for row,(top,bottom) in enumerate([(0,y),(y,1024)]):
   cols=np.where(~alpha[top:bottom,:].any(axis=0))[0]
   cuts=[]
   for nominal in [512,1024]:
    candidates=[x for x in cols if abs(x-nominal)<=150 and not alpha[top:bottom,max(0,x-2):min(1536,x+3)].any()]
    if not candidates: candidates=[x for x in cols if abs(x-nominal)<=150 and not alpha[top:bottom,max(0,x-1):min(1536,x+2)].any()]
    if not candidates: candidates=[x for x in cols if abs(x-nominal)<=150]
    assert candidates,(key,source,row,nominal,'No column gutter')
    cuts.append(int(min(candidates,key=lambda x:abs(x-nominal))))
   for col,(left,right) in enumerate(zip([0]+cuts,cuts+[1536])):
    i=half*6+row*3+col
    frames.append({'sourceRect':[left,top,right,bottom],'bodyCenterX':centers[i],'castAnchorPx':anchors[i]})
 out={'key':key,'skillKind':'poison','releaseFrameIndex':6,'neutralBodyBoundsPx':body,'frames':frames,'reviewMethod':'Manual torso/head/feet/active blade-hand landmarks from displayed original source; rectangles follow inspected true-alpha gutters; no anatomy inference, resizing or pixel edits.'}
 target=ROOT/'docs/thief/art-A2'/key/'layout.json'
 target.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
 print(key, [f['sourceRect'] for f in frames])
