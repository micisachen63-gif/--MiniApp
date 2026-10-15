"""Preserve the six authored skill frames with native crop and integer padding only."""
import hashlib,json
from pathlib import Path
from PIL import Image
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'worker/art-production/thief-skills-20261015/source.png'
prompt=source.with_name('source-prompt.json')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
original=sha(source);im=Image.open(source).convert('RGBA');assert im.size==(1536,1024)
proof=[]
for i in range(6):
 x=(i%3)*512;y=(i//3)*512;rect=(x,y,x+512,y+512);crop=im.crop(rect)
 alpha=np.array(crop.getchannel('A'));box=crop.getchannel('A').point(lambda a:255 if a>=16 else 0).getbbox()
 assert box and min(box[:2])>0 and max(box[2:])<512,(i,box,'cropped frame')
 edge=np.concatenate([alpha[0],alpha[-1],alpha[:,0],alpha[:,-1]])
 assert not (edge>=16).any(),(i,'dirty gutter')
 out=ROOT/f'worker/public/expedition/assets/skills-painted-20261011/skill_thief_{i+1:02}.webp'
 out.parent.mkdir(parents=True,exist_ok=True);crop.save(out,lossless=True,exact=True,method=6)
 assert crop.tobytes()==Image.open(out).convert('RGBA').tobytes()
 proof.append({'id':f'skill_thief_{i+1:02}','sourceRect':rect,'translationPx':[0,0],'alphaBounds':box,'edgeAlphaMax':int(edge.max()),'file':out.relative_to(ROOT).as_posix(),'SHA256':sha(out),'nativeRGBAUnchanged':True,'intentionalPaintedInterior':True})
assert sha(source)==original
report={'status':'PASS','source':source.relative_to(ROOT).as_posix(),'sourceSHA256':original,'prompt':prompt.relative_to(ROOT).as_posix(),'promptSHA256':sha(prompt),'noResize':True,'alphaNotEdited':True,'icons':proof}
(ROOT/'docs/thief/gear-art/skill-icons-native-pack.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':'PASS','icons':len(proof)}))
