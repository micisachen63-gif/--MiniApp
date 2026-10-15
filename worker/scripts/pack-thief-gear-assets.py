"""Native crop + integer padding for the 82 thief equipment designs. No resampling/alpha editing."""
import argparse,hashlib,json
from pathlib import Path
from PIL import Image
import numpy as np
ROOT=Path(__file__).resolve().parents[2];QA=ROOT/'docs/thief/gear-art'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def bounds(im):return im.getchannel('A').point(lambda a:255 if a>=16 else 0).getbbox()
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--groups',default='');args=parser.parse_args()
 plan=json.loads((QA/'new-assets-plan.json').read_text(encoding='utf-8'));groups=plan['classDesignGroups']
 if args.groups:
  requested=set(args.groups.split(','));groups=[g for g in groups if g['group'] in requested];assert requested=={g['group'] for g in groups}
 entries={e['key']:e for e in plan['entries']};proofs=[];missing=[];seen=set();sources={}
 for group in groups:
  name=group['group'];folder=ROOT/'worker/art-production/thief-gear-20261015'/name
  layout=json.loads((QA/'native-layouts'/f'{name}.json').read_text(encoding='utf-8'));assert layout['cellSize']==640
  for spec in layout['frames']:
   key=group['tierKeys'].get(str(spec['tier']))
   if key is None:continue # Branch-specific weapons intentionally do not have T1 gameplay items.
   file=folder/spec['source']
   if not file.is_file():missing.append(str(file.relative_to(ROOT)));continue
   digest=sha(file);sources[str(file.relative_to(ROOT)).replace('\\','/')]=digest
   image=Image.open(file).convert('RGBA');assert image.size==(1536,1024)
   rect=spec['sourceRect'];crop=image.crop(rect);box=bounds(crop)
   assert box and min(box[:2])>0 and box[2]<crop.width and box[3]<crop.height,(key,'source clipping / wrong gutter',rect,box)
   left=(640-(box[2]-box[0]))//2-box[0];top=(640-(box[3]-box[1]))//2-box[1]
   packed=Image.new('RGBA',(640,640),(0,0,0,0));packed.paste(crop,(left,top))
   assert packed.crop((left+box[0],top+box[1],left+box[2],top+box[3])).tobytes()==crop.crop(box).tobytes()
   b=bounds(packed);assert min(b[:2])>=32 and max(b[2:])<=608,(key,'packed margin',b)
   # Full alpha-edge audit: rejects opaque backgrounds, never removes them.
   alpha=np.array(packed.getchannel('A'));edge=np.concatenate([alpha[0],alpha[-1],alpha[:,0],alpha[:,-1]])
   assert alpha.min()==0 and (alpha<=8).mean()>.1 and not(edge>=16).any(),(key,'background or alpha border')
   rgba=hashlib.sha256(packed.tobytes()).hexdigest();assert rgba not in seen,(key,'duplicate');seen.add(rgba)
   png=folder/'packed'/f'{key}.png';png.parent.mkdir(parents=True,exist_ok=True);packed.save(png)
   webp=ROOT/entries[key]['icon'];webp.parent.mkdir(parents=True,exist_ok=True);packed.save(webp,lossless=True,exact=True,method=6)
   assert np.array_equal(np.array(packed),np.array(Image.open(webp).convert('RGBA'))),(key,'WebP differs')
   assert sha(file)==digest,'Authored source mutated during packing'
   proofs.append({'key':key,'tier':spec['tier'],'group':name,'source':str(file.relative_to(ROOT)).replace('\\','/'),'sourceSHA256':digest,'sourceRect':rect,'sourceAlphaBounds':list(box),'translationPx':[left,top],'packedAlphaBounds':list(b),'nativePixelsPreserved':True,'noResampling':True,'alphaNotEdited':True,'rgbaSHA256':rgba,'transparentFraction':float((alpha<=8).mean()),'PNG':{'file':str(png.relative_to(ROOT)).replace('\\','/'),'SHA256':sha(png)},'WebP':{'file':entries[key]['icon'],'SHA256':sha(webp)},'losslessWebPEquality':True})
 report={'status':'PASS' if not missing and len(proofs)==sum(g['count'] for g in groups) else 'partial-waiting-for-sources','expected':sum(g['count'] for g in groups),'packed':len(proofs),'distinctNativeIcons':len(seen),'cellSize':640,'sourceSHA256':sources,'missingSources':sorted(set(missing)),'proofs':proofs}
 (QA/'native-pack.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'status':report['status'],'packed':len(proofs),'expected':report['expected'],'missingSources':len(set(missing))}))
if __name__=='__main__':main()

