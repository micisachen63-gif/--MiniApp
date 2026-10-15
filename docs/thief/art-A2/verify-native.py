"""Verify all fourteen authored A2 identities against their native source contract."""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[3]
qa=ROOT/'docs/thief/art-A2'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
keys=[f'adv{len(path)}_thief_{path}_{g}' for path in ['A2','A21','A22','A211','A212','A221','A222'] for g in ['f','m']]
fragments=[];records=[];source_hashes=[];frame_hashes=[]
for key in keys:
 folder=qa/key;art=ROOT/'worker/public/art/thief-20261015'/key;raw=ROOT/'worker/art-production/thief-20261015/A2'/key
 report=json.loads((folder/'native-pack.json').read_text(encoding='utf8'));entry=json.loads((folder/'fragment.json').read_text(encoding='utf8'));layout=json.loads((folder/'layout.json').read_text(encoding='utf-8-sig'));prompts=json.loads((folder/'prompts.json').read_text(encoding='utf-8-sig'))
 assert all(isinstance(prompts.get(k),str) and len(prompts[k])>100 for k in ['portrait','first','last']),key
 for name,digest in report['sources'].items():
  assert sha(raw/name)==digest,(key,name,'sourceSHA')
  source_hashes.append(digest)
 for name,digest in report['outputs'].items(): assert sha(art/name)==digest,(key,name,'outputSHA')
 assert (art/'hero.png').read_bytes()==(art/'portrait.png').read_bytes()==(raw/'hero.png').read_bytes()
 png=Image.open(art/'character.png').convert('RGBA');webp=Image.open(art/'character.webp').convert('RGBA')
 assert png.size==(2560,1920) and np.array_equal(np.array(png),np.array(webp))
 for f in report['frames']:
  i=f['index'];cell=png.crop((i%4*640,i//4*640,i%4*640+640,i//4*640+640));digest=hashlib.sha256(cell.tobytes()).hexdigest();assert digest==f['rgbaSHA256'];frame_hashes.append(digest)
  b=f['alphaBounds'];assert b[0]>=20 and b[1]>=20 and b[2]<=620 and b[3]==600
  a=f['castAnchorPx'];assert all(0<=v<640 for v in a)
 a=entry['animation'];assert a['totalFrames']==12 and sum(a['durationsMs'])==1000 and a['releaseFrameIndex']==6 and a['useAsIdle'] is False
 assert a['neutralBodyBoundsPx']==layout['neutralBodyBoundsPx'] and a['bodyBounds']==a['frameFig']
 body=layout['neutralBodyBoundsPx'];assert body[1]==report['frames'][0]['alphaBounds'][1] and body[3]==600
 hb=entry['heroBounds'];assert abs(a['heightScale']-(hb[3]-hb[1])/((body[3]-body[1])/640))<1e-12
 assert entry['guardianCategory']=='melee' and entry['visualAccepted'] is False and entry['actualEventVerified'] is False
 old=json.loads((folder/'production.json').read_text(encoding='utf-8-sig')) if (folder/'production.json').exists() else {}
 generated=json.loads((folder/'generated-sources.json').read_text(encoding='utf-8-sig')) if (folder/'generated-sources.json').exists() else {}
 production={**old,'generator':'built-in image_gen','key':key,'status':'native-packing-pass-review-pending','prompts':prompts,'generatedSourcePaths':generated,'sourceSHA256':report['sources'],'outputsSHA256':report['outputs'],'sourceVisualReview':{'identityAndOutfitInspected':True,'completeBodiesAndTwoDaggersInspected':True,'realAlphaGuttersInspected':True,'rootPortraitAccepted':entry['classPath']=='A2','animationMainReviewAccepted':False,'actualEventVerified':False},'nativeContract':{'resized':False,'retouched':False,'distinctAuthoredPoses':12,'nativePixelsPreserved':True,'footBaseline':600,'heightScale':a['heightScale'],'neutralBodyBoundsPx':body},'reviewEvidence':['layout.json','native-pack.json','fragment.json','prompts.json']}
 (folder/'production.json').write_text(json.dumps(production,ensure_ascii=False,indent=2),encoding='utf8')
 fragments.append(entry);records.append({'key':key,'classPath':entry['classPath'],'gender':entry['gender'],'name':entry['name'],'packing':'PASS','sourceSHA256':report['sources'],'outputsSHA256':report['outputs'],'heightScale':a['heightScale'],'neutralBodyBoundsPx':body,'rootPortraitAccepted':entry['classPath']=='A2','visualAccepted':False,'runtimeAccepted':False,'fragment':str((folder/'fragment.json').relative_to(ROOT)).replace('\\','/')})
assert len(source_hashes)==len(set(source_hashes))==42,'Independent identity sources required'
assert len(frame_hashes)==len(set(frame_hashes))==168,'All authored keyposes must be unique'
index={'branch':'A2','status':'native-packing-pass-review-pending','identities':14,'selectedSourceImages':42,'distinctNativeFrames':168,'publicFiles':56,'releaseReady':False,'sharedRegistryModified':False,'requiredNext':['Main review of every portrait and animation','Integrate accepted exact identity fragments','Actual bootstrap field/guardian/action/reduced-motion verification'],'checks':{'sourceAndOutputSHA':True,'trueAlphaBorders':True,'nativePixelsPreserved':True,'pngWebpRGBAEqual':True,'neutralHeightFromReviewedHeadFoot':True,'allGuardiansMelee':True},'entries':records}
(qa/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2),encoding='utf8')
(qa/'registry-fragments.json').write_text(json.dumps(fragments,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({k:v for k,v in index.items() if k!='entries'},ensure_ascii=False))

